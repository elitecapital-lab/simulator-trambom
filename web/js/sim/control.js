// Kịch bản điều khiển (ngưỡng / dự báo) và bộ dự báo – tương đương trambom/control.py
import { clamp, pmod } from './util.js';

export class Forecaster {
  constructor(profile, startDow) {
    this.mean = profile.map(Number);
    this.var = this.mean.map((m) => (0.12 * m) ** 2 + 0.25);
    this.start_dow = startDow;
    this.min_idx = null; this.acc = 0; this.acc_n = 0; this.acc_learn = true;
    this.hour_idx = null; this.h_acc = 0; this.h_n = 0; this.h_bad = false;
    this.err = 0.15; this.resid = 0; this.last_qm = null; this.last_f = null;
    this.anom_min = 0; this.clear_min = 0; this.anomaly = false; this.minutes = 0; this.abs_err_sum = 0; this.abs_err_n = 0;
  }
  how(t) { return pmod(this.start_dow * 24.0 + t / 3600.0, 168.0); }
  _interp(arr, t) {
    const x = this.how(t) - 0.5;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = arr[pmod(i0, 168)]; const b = arr[pmod(i0 + 1, 168)];
    return a + (b - a) * f;
  }
  meanAt(t) { return this._interp(this.mean, t); }
  sigmaAt(t) { return Math.sqrt(Math.max(this._interp(this.var, t), 0.0)); }
  maxOver(t0, t1) {
    let m = this.meanAt(t0);
    for (let k = 1; t0 + k * 300.0 <= t1; k++) { const v = this.meanAt(t0 + k * 300.0); if (v > m) m = v; }
    return m;
  }
  avgOver(t0, t1) {
    let s = 0, n = 0;
    for (let k = 0; t0 + k * 900.0 <= t1; k++) { s += this.meanAt(t0 + k * 900.0); n++; }
    return n ? s / n : this.meanAt(t0);
  }
  update(t, q, learn, pd) {
    const mi = Math.floor(t / 60);
    if (this.min_idx === null) this.min_idx = mi;
    if (mi !== this.min_idx) {
      if (this.acc_n > 0) this._minute(this.min_idx, this.acc / this.acc_n, pd, this.acc_learn);
      this.min_idx = mi; this.acc = 0; this.acc_n = 0; this.acc_learn = true;
    }
    if (this.acc_n === 0) this.acc_learn = true;
    if (q !== null && q !== undefined) { this.acc += q; this.acc_n += 1; }
    if (!learn) this.acc_learn = false;
  }
  _minute(mi, qm, pd, learn) {
    const tc = mi * 60.0 + 30.0;
    const f = this.meanAt(tc); const sd = this.sigmaAt(tc);
    const r = qm - f;
    this.last_qm = qm; this.last_f = f; this.resid = r;
    if (!learn) { this.anom_min = 0; return; }
    this.minutes += 1;
    const e = Math.abs(r) / Math.max(f, 2.0);
    this.err += (e - this.err) / 60.0;
    this.abs_err_sum += e; this.abs_err_n += 1;
    const thr = Math.max(pd.anomaly_min_m3h, pd.anomaly_k * sd);
    if (r > thr) { this.anom_min += 1; this.clear_min = 0; }
    else { this.anom_min = 0; if (r < 0.5 * thr) this.clear_min += 1; }
    if (!this.anomaly && this.anom_min >= pd.anomaly_t_min) this.anomaly = true;
    else if (this.anomaly && this.clear_min >= 10) this.anomaly = false;
    const hb = Math.floor(this.how(tc)) % 168;
    if (!this.anomaly && Math.abs(r) < 4.0 * sd) { const v = this.var[hb]; this.var[hb] = v + 0.02 * (r * r - v); }
    if (this.hour_idx === null) this.hour_idx = hb;
    if (hb !== this.hour_idx) {
      if (this.h_n >= 30 && !this.h_bad) this.mean[this.hour_idx] += pd.learn_alpha * (this.h_acc / this.h_n - this.mean[this.hour_idx]);
      this.hour_idx = hb; this.h_acc = 0; this.h_n = 0; this.h_bad = false;
    }
    this.h_acc += qm; this.h_n += 1;
    if (this.anomaly) this.h_bad = true;
  }
  mape() { return this.abs_err_n ? this.abs_err_sum / this.abs_err_n : null; }
}

export class Controller {
  constructor(cfg, nPumps) {
    this.pmod = cfg.pump_model;
    this.m_per_bar = 1.0e5 / (cfg.constants.rho * cfg.constants.g);
    this.z_s = cfg.tank.z_suction_m; this.area = cfg.tank.area_m2; this.max_starts = cfg.safety.max_starts_per_h;
    this.n_pumps = nPumps;
    this.I = this.pmod.f_min_hz; this.n = 0; this.duty = 0; this.duty_run_s = 0; this.swap_until = null; this.force_rotate = false;
    this.stage_timer = 0; this.destage_timer = 0; this.sleep_state = 'awake'; this.sleep_timer = 0; this.boost_until = 0;
    this.level_stop = false; this.fallback = false; this.ff_on = false; this.ff_n = 1; this.last_f_ref = 0; this.p_set = 2.0;
    this.q_ff = 0; this.margin = 0; this.tte_h = null; this.next_tte = 0; this.no_inflow_s = 0; this.conserve = 0;
    this.strategy_used = 'threshold'; this.custom_mem = {}; this.prestaged = false;
  }
  fEstimate(pSet, level, q, n) {
    const pm = this.pmod;
    n = Math.max(1, n);
    const hNeed = pSet * this.m_per_bar - (level + this.z_s) + pm.k_m_per_m3h2 * (q / n) ** 2;
    return clamp(pm.f_rated_hz * Math.sqrt(Math.max(0.0, hNeed) / pm.h0_m), pm.f_min_hz, pm.f_max_hz);
  }
  step(t, dt, sig, gw) {
    const P = gw.script.params;
    const pr = P.pressure, st = P.staging, lv = P.level, sl = P.sleep, off = P.offline, pd = P.predictive, feat = P.features, alt = P.alternation;
    const pm = this.pmod; const fMin = pm.f_min_hz, fMax = pm.f_max_hz; const fc = gw.forecaster;
    const q = sig.q_f ?? 0.0; const pMeas = sig.p_ctrl; const level = sig.level; const pumps = sig.pumps;
    const strategy = gw.script.strategy;
    const A = gw.alarms;

    if (strategy === 'predictive') {
      if (!this.fallback && fc.err > pd.fallback_err) {
        this.fallback = true;
        A.raise_(t, 'FORECAST_FALLBACK', 'info', `Sai số dự báo ${(100 * fc.err).toFixed(0)}% > ngưỡng – tạm dùng điều khiển theo ngưỡng`);
      } else if (this.fallback && fc.err < pd.recover_err) { this.fallback = false; A.clear(t, 'FORECAST_FALLBACK'); }
    }
    const predictive = strategy === 'predictive' && !this.fallback;
    this.strategy_used = predictive ? 'predictive' : strategy === 'predictive' ? 'fallback' : 'threshold';

    let qFF, margin, pSet;
    if (predictive) {
      const qh0 = fc.meanAt(t); const qh1 = fc.meanAt(t + pd.lead_min * 60.0); const sq = fc.sigmaAt(t);
      qFF = q + Math.max(0.0, qh1 - qh0);
      margin = clamp(pd.margin_min_bar + pd.k_sigma * 2.0 * pr.r_est * qFF * sq, pd.margin_min_bar, pd.margin_max_bar);
      pSet = pd.p_crit_req_bar + margin + pr.dz_bar + pr.r_est * qFF * qFF;
    } else {
      qFF = q;
      margin = pr.p_crit_target_bar - pd.p_crit_req_bar;
      pSet = pr.p_crit_target_bar + pr.dz_bar + pr.r_est * q * q;
    }
    pSet = clamp(pSet, pr.p_set_min_bar, pr.p_set_max_bar);
    if (gw.offline_since !== null) {
      const offH = (t - gw.offline_since) / 3600.0;
      pSet += offH >= off.long_after_h ? off.long_margin_bar : off.margin_bar;
    }
    if (gw.override !== null) {
      if (t < gw.override.until) pSet = gw.override.p_set;
      else { gw.logEvent(t, 'info', 'Lệnh ghi đè áp lực từ xa hết hạn – quay về kịch bản đã lưu'); gw.override = null; }
    }

    let cons = 0.0;
    this.conserve = 0;
    if (level < lv.conserve_m) { cons = lv.conserve_delta_bar; this.conserve = 2; }
    A.setHyst(t, dt, 'LEVEL_LOW', level < lv.conserve_m, level > lv.conserve_m + 0.05, 'warning',
      `Mức bể thấp (< ${lv.conserve_m.toFixed(1)} m) – giảm áp tiết kiệm nước`, 5.0, 60.0);
    if (t >= this.next_tte) {
      this.next_tte = t + 60.0;
      const qIn = sig.q_in_f ?? 0.0;
      const usable = Math.max(0.0, (level - lv.stop_m) * this.area);
      const netDraw = fc.avgOver(t, t + 3 * 3600.0) - qIn;
      this.tte_h = netDraw > 0.5 ? usable / netDraw : null;
    }
    let consTte = 0.0;
    if (feat.tte_conservation && this.tte_h !== null) {
      if (this.tte_h < pd.tte_crit_h) { consTte = pd.tte_delta2_bar; this.conserve = Math.max(this.conserve, 2); }
      else if (this.tte_h < pd.tte_warn_h) { consTte = pd.tte_delta1_bar; this.conserve = Math.max(this.conserve, 1); }
      A.setHyst(t, dt, 'TTE_LOW', this.tte_h < pd.tte_warn_h, this.tte_h > pd.tte_warn_h + 0.5, 'warning',
        `Dự báo bể cạn sau ${this.tte_h.toFixed(1)} h – chủ động giảm áp`, 0.0, 300.0);
    } else if (this.tte_h === null) A.clear(t, 'TTE_LOW');
    const pBase = pSet;
    if (cons < 0.0) pSet = Math.max(pBase + cons, Math.min(pBase, lv.p_set_conserve_min_bar));
    if (consTte < 0.0) {
      const floor = pd.p_crit_req_bar + pd.margin_min_bar + pr.dz_bar + pr.r_est * qFF * qFF;
      pSet = Math.min(pSet, Math.max(pBase + consTte, Math.min(pBase, floor)));
    }
    const qInNow = sig.q_in_f ?? 0.0;
    if (qInNow < 0.5 && level < 3.4) this.no_inflow_s += dt; else this.no_inflow_s = 0.0;
    A.setHyst(t, dt, 'SUPPLY_LOST', this.no_inflow_s >= lv.supply_lost_s, qInNow > 2.0, 'warning',
      'Không có nước vào bể (FT-100 ≈ 0) dù van phao mở – nghi mất nước nguồn', 0.0, 60.0);

    if (this.level_stop) {
      if (level > lv.restart_m) {
        this.level_stop = false; A.clear(t, 'LEVEL_STOP');
        gw.logEvent(t, 'info', `Mức bể hồi phục > ${lv.restart_m.toFixed(1)} m – cho phép chạy bơm lại`);
      }
    } else if (level < lv.stop_m) {
      this.level_stop = true;
      A.raise_(t, 'LEVEL_STOP', 'alarm', `Mức bể < ${lv.stop_m.toFixed(1)} m – kịch bản dừng bơm chống chạy khô`);
    }

    let other = 1 - this.duty;
    if (pumps[this.duty].running) this.duty_run_s += dt;
    if (pumps[this.duty].fault && !pumps[other].fault) {
      gw.logEvent(t, 'alarm', `Bơm ${gw.pump_tags[this.duty]} lỗi – chuyển bơm dự phòng ${gw.pump_tags[other]} làm bơm chính`);
      this.duty = other; other = 1 - this.duty; this.duty_run_s = 0; this.swap_until = null;
    }
    if ((this.duty_run_s >= alt.runtime_h * 3600.0 || this.force_rotate) && !pumps[other].fault && this.swap_until === null && this.n >= 1) {
      gw.logEvent(t, 'info', `Luân phiên bơm: ${gw.pump_tags[this.duty]} → ${gw.pump_tags[other]} (${this.force_rotate ? 'theo lệnh' : 'đủ ' + alt.runtime_h.toFixed(0) + ' h chạy'})`);
      this.duty = other; other = 1 - this.duty; this.duty_run_s = 0; this.swap_until = t + alt.overlap_s; this.force_rotate = false;
    }
    const avail = pumps.filter((p) => !p.fault).length;

    if (gw.safety.last_block) {
      this.n = 0; this.I = fMin; this.stage_timer = 0; this.destage_timer = 0; this.sleep_state = 'awake'; this.last_f_ref = 0; this.p_set = pSet;
      return { n: 0, f_ref: 0.0, order: [this.duty, 1 - this.duty], p_set: pSet };
    }
    if (gw.custom_fn) {
      const out = this._custom(t, dt, sig, gw, pSet, q, level);
      if (out !== null) return out;
    }

    const prevN = this.n;
    if (this.level_stop || avail === 0) { this.n = 0; this.sleep_state = 'awake'; }
    else {
      if (this.n === 0 && this.sleep_state === 'awake') this.n = 1;
      const startsRecent = gw.pm.startsLastHour(this.duty, t);
      if (sl.enabled && this.n === 1 && this.sleep_state === 'awake') {
        if (q < sl.q_on_m3h && this.last_f_ref <= fMin + 1.0 && startsRecent < this.max_starts - 2) this.sleep_timer += dt;
        else this.sleep_timer = 0;
        if (this.sleep_timer >= sl.t_s) {
          this.sleep_state = 'boost'; this.boost_until = t + 20.0; this.sleep_timer = 0;
          gw.logEvent(t, 'info', 'Lưu lượng rất nhỏ – tăng áp nạp bình tích áp rồi cho bơm ngủ');
        }
      }
      if (this.sleep_state === 'boost') { pSet += sl.boost_bar; if (t >= this.boost_until) this.sleep_state = 'sleep'; }
      if (this.sleep_state === 'sleep') {
        this.n = 0;
        if ((pMeas !== null && pMeas < pSet - sl.wake_delta_bar) || q > 2.0 * sl.q_on_m3h) {
          this.sleep_state = 'awake'; this.n = 1; gw.logEvent(t, 'info', 'Áp lực giảm – đánh thức bơm');
        }
      }
      const err = pMeas !== null ? pSet - pMeas : 0.0;
      if (this.n === 1) {
        if (this.last_f_ref >= st.f_on_hz - 1e-6 && err > st.err_on_bar) this.stage_timer += dt; else this.stage_timer = 0;
        let pre = predictive && q > 0.9 * pd.prestage_q_m3h && fc.maxOver(t, t + 2.0 * pd.lead_min * 60.0) > pd.prestage_q_m3h;
        if (predictive && !pre) {
          const hAv = pm.h0_m - (pSet * this.m_per_bar - (level + this.z_s));
          const qCap = hAv > 0 ? Math.sqrt(hAv / pm.k_m_per_m3h2) : 0.0;
          pre = qFF > 0.97 * qCap;
        }
        if (avail >= 2 && (this.stage_timer >= st.t_on_s || pre)) {
          this.n = 2; this.stage_timer = 0; this.destage_timer = 0; this.prestaged = pre;
          gw.logEvent(t, 'info', 'Ghép bơm thứ hai ' + (pre ? 'sớm theo dự báo' : '(bơm chính đã max tần số)'));
        }
      } else if (this.n === 2) {
        if (this.last_f_ref <= st.f_off_hz) this.destage_timer += dt; else this.destage_timer = 0;
        if (this.destage_timer >= st.t_off_s) {
          const guard = predictive && fc.maxOver(t, t + pd.destage_guard_min * 60.0) > pd.prestage_q_m3h;
          if (!guard) { this.n = 1; this.destage_timer = 0; gw.logEvent(t, 'info', 'Tách bơm – một bơm đủ đáp ứng'); }
          else this.destage_timer = st.t_off_s;
        }
        if (avail < 2) this.n = 1;
      }
    }
    let nOut = this.n;
    const order = [this.duty, 1 - this.duty];
    if (this.swap_until !== null) {
      if (t < this.swap_until && this.n === 1) nOut = 2;
      else if (t >= this.swap_until) this.swap_until = null;
    }
    let fRef;
    if (nOut === 0) { this.I = fMin; fRef = 0.0; }
    else {
      const ffOn = predictive;
      let nEff = 0;
      for (let i = 0; i < pumps.length; i++) if (gw.pm.cmd[i] && pumps[i].running && pumps[i].f >= fMin - 0.5) nEff++;
      if (nEff === 0) nEff = 1;
      if (nOut < nEff) nEff = nOut;
      const ff = ffOn ? this.fEstimate(pSet, level, qFF, nEff) : 0.0;
      if (prevN === 0) this.I = this.fEstimate(pSet, level, q, nOut) - ff;
      else if (ffOn !== this.ff_on) this.I += (this.ff_on ? this.fEstimate(pSet, level, q, nEff) : 0.0) - ff;
      else if (ffOn && nEff > this.ff_n) this.I += this.fEstimate(pSet, level, qFF, this.ff_n) - ff;
      this.ff_on = ffOn; this.ff_n = nEff;
      if (pMeas === null) {
        fRef = 40.0;
        A.raise_(t, 'NO_PRESSURE', 'alarm', 'Mất tín hiệu áp lực – chạy tần số an toàn 40 Hz');
      } else {
        A.clear(t, 'NO_PRESSURE');
        const e = pSet - pMeas;
        const kp = pr.kp_hz_per_bar;
        let u = ff + kp * e + this.I;
        let rampLimited = false;
        for (let i = 0; i < this.n_pumps; i++) if (pumps[i].running && Math.abs(pumps[i].f - this.last_f_ref) > 1.0 && this.last_f_ref > 0) rampLimited = true;
        const satHi = u >= fMax && e > 0; const satLo = u <= fMin && e < 0;
        if (!rampLimited && !satHi && !satLo) this.I += kp * dt / pr.ti_s * e;
        this.I = clamp(this.I, fMin - ff - 10.0, fMax - ff + 10.0);
        u = ff + kp * e + this.I;
        fRef = clamp(u, fMin, fMax);
      }
    }
    this.last_f_ref = fRef; this.p_set = pSet; this.q_ff = qFF; this.margin = margin;
    return { n: nOut, f_ref: fRef, order, p_set: pSet };
  }
  _custom(t, dt, sig, gw, pSetDefault, q, level) {
    const fc = gw.forecaster;
    const inp = {
      t, hour: (t % 86400) / 3600.0, dow: (gw.start_dow + Math.floor(t / 86400)) % 7,
      p: sig.p_ctrl, q, level, q_in: sig.q_in_f, cl: sig.cl, ntu: sig.ntu, ph: sig.ph,
      online: gw.offline_since === null, pumps: sig.pumps, dt, p_set_default: pSetDefault, duty: this.duty, tte_h: this.tte_h,
      du_bao: (giay = 0) => fc.meanAt(t + giay), do_lech: (giay = 0) => fc.sigmaAt(t + giay), du_bao_max: (giay) => fc.maxOver(t, t + giay),
    };
    try {
      const out = gw.custom_fn(inp, this.custom_mem, gw.script.params);
      const n = Math.trunc(Number(out.n_pumps ?? 1));
      const fRef = Number(out.f_ref ?? 0.0);
      if (!(n >= 0 && n <= this.n_pumps) || Number.isNaN(fRef)) throw new Error('đầu ra không hợp lệ');
      const pSet = Number(out.p_set ?? pSetDefault);
      const order = out.order ?? [this.duty, 1 - this.duty];
      this.strategy_used = 'custom'; this.p_set = pSet; this.last_f_ref = fRef; this.n = n;
      return { n, f_ref: fRef, order: [...order], p_set: pSet };
    } catch (exc) {
      gw.custom_fn = null;
      gw.alarms.raise_(t, 'SCRIPT_ERROR', 'alarm', `Kịch bản học viên lỗi (${exc.message}) – chuyển về kịch bản ngưỡng dựng sẵn`);
      return null;
    }
  }
}
