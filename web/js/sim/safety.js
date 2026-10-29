// Lớp an toàn & quản lý bơm – tương đương trambom/safety.py
export const QUALITY_TAGS = { cl: 'AIT-201', ntu: 'AIT-202', ph: 'AIT-203' };
export const QUALITY_NAME = { cl: 'Clo dư', ntu: 'Độ đục', ph: 'pH' };
export const QUALITY_UNIT = { cl: 'mg/L', ntu: 'NTU', ph: '' };
const DEADBAND = { cl: 0.04, ntu: 0.1, ph: 0.1 };

export class SafetyLayer {
  constructor(cfg) {
    this.s = cfg.safety;
    this.q_auto = cfg.safety.quality_auto_restart ?? false;
    const pm = cfg.pump_model;
    this.f_min = pm.f_min_hz; this.f_max = pm.f_max_hz; this.f_cap = this.f_max;
    this.hh_timer = 0; this.high_timer = 0; this.trip_active = false; this.trip_t = 0; this.trip_times = []; this.trip_count = 0;
    this.lockout = false; this.low_timer = 0; this.burst_timer = 0; this.level_trip = false;
    this.safe_stop = false; this.safe_reason = ''; this.safe_t = null;
    this.q_timer = { cl: 0, ntu: 0, ph: 0 }; this.ok_timer = 0; this.last_block = ''; this.limiting = false; this.state = 'normal';
  }
  _bands(key) {
    const s = this.s;
    if (key === 'cl') return [s.cl_warn_low, s.cl_warn_high, s.cl_trip_low, s.cl_trip_high, s.cl_delay_s];
    if (key === 'ntu') return [-1e9, s.ntu_warn, -1e9, s.ntu_trip, s.ntu_delay_s];
    return [s.ph_warn_low, s.ph_warn_high, s.ph_trip_low, s.ph_trip_high, s.ph_delay_s];
  }
  // Chỉ xét các máy phân tích thực sự được lắp; máy đã lắp mà mất tín hiệu thì chưa cho đặt lại
  qualityOkForReset(sig, installed = null) {
    const s = this.s;
    const ok = { cl: (v) => s.cl_trip_low + 0.05 <= v && v <= s.cl_trip_high - 0.05, ntu: (v) => v < s.ntu_reset_max,
      ph: (v) => s.ph_trip_low + 0.2 <= v && v <= s.ph_trip_high - 0.2 };
    for (const [key, tag] of Object.entries(QUALITY_TAGS)) {
      if (installed !== null && !installed.has(tag)) continue;
      const v = sig[key];
      if (v === null || v === undefined || !ok[key](v)) return false;
    }
    return true;
  }
  requestReset(t, gw) {
    if (this.lockout && !this.safe_stop) {
      this.lockout = false; this.trip_times = []; gw.alarms.clear(t, 'LOCKOUT'); gw.alarms.clear(t, 'P_HH_TRIP'); this.trip_active = false;
      return [true, 'Đã mở khóa bảo vệ áp lực'];
    }
    if (!this.safe_stop) return [true, 'Trạm không ở trạng thái dừng an toàn'];
    const hold = this.s.quality_reset_hold_s;
    if (this.ok_timer < hold) return [false, `Chất lượng nước chưa ổn định đủ ${(hold / 60).toFixed(0)} phút (mới ${(this.ok_timer / 60).toFixed(0)} phút)`];
    this._clearSafeStop(t, gw, 'lệnh đặt lại');
    return [true, 'Đã đặt lại dừng an toàn'];
  }
  _clearSafeStop(t, gw, why) {
    this.safe_stop = false; this.safe_reason = '';
    for (const k of ['cl', 'ntu', 'ph']) gw.alarms.clear(t, k.toUpperCase() + '_TRIP');
    gw.alarms.clear(t, 'SAFE_STOP');
    gw.logEvent(t, 'info', `Kết thúc dừng an toàn (${why}) – mở van đầu ra, chạy lại bơm`);
  }
  evaluate(t, dt, sig, co, gw, meas) {
    const s = this.s; const A = gw.alarms; const pp = sig.p_prot;
    if (pp !== null && pp > s.p_highhigh_bar) this.hh_timer += dt; else this.hh_timer = 0;
    if (this.hh_timer >= s.p_hh_delay_s && !this.trip_active && !this.lockout) {
      this.trip_active = true; this.trip_t = t; this.trip_count += 1;
      this.trip_times = this.trip_times.filter((x) => t - x < 3600.0).concat([t]);
      A.raise_(t, 'P_HH_TRIP', 'critical', `Áp lực ${pp.toFixed(2)} bar > ${s.p_highhigh_bar.toFixed(1)} bar – cắt bơm khẩn cấp`);
      if (this.trip_times.length >= s.p_trip_max_per_h) {
        this.lockout = true;
        A.raise_(t, 'LOCKOUT', 'critical', `Cắt áp cao ${this.trip_times.length} lần/giờ – khóa trạm, cần đặt lại`);
      }
    }
    if (this.trip_active && !this.lockout && t - this.trip_t >= s.p_trip_restart_s && (pp === null || pp < s.p_high_bar)) {
      this.trip_active = false; A.clear(t, 'P_HH_TRIP');
      gw.logEvent(t, 'info', 'Hết thời gian chờ sau cắt áp cao – cho phép khởi động lại');
    }
    if (pp !== null && pp > s.p_high_bar) {
      this.f_cap = Math.max(this.f_min, this.f_cap - s.p_limiter_down_hz_s * dt); this.high_timer += dt;
    } else {
      if (pp === null || pp < s.p_high_bar - 0.15) this.f_cap = Math.min(this.f_max, this.f_cap + s.p_limiter_up_hz_s * dt);
      if (pp === null || pp < s.p_high_bar - 0.1) this.high_timer = 0;
    }
    if (this.high_timer >= 5.0) A.raise_(t, 'P_HIGH', 'alarm', `Áp lực đầu ra ${pp.toFixed(2)} bar > ${s.p_high_bar.toFixed(1)} bar – giới hạn tần số bơm`);
    else if (this.high_timer === 0) A.clear(t, 'P_HIGH');
    this.limiting = this.f_cap < this.f_max - 0.5;
    const p = sig.p_ctrl; const q = sig.q_f;
    const running = sig.pumps.some((x) => x.running);
    if (running && p !== null && p < s.p_low_bar) this.low_timer += dt; else this.low_timer = 0;
    A.set(t, 'P_LOW', this.low_timer >= s.p_low_delay_s, 'warning', `Áp lực đầu ra thấp < ${s.p_low_bar.toFixed(1)} bar`);
    if (p !== null && q !== null && p < s.p_lowlow_bar && q > s.burst_q_m3h) this.burst_timer += dt; else this.burst_timer = 0;
    A.set(t, 'BURST_SUSPECT', this.burst_timer >= s.burst_delay_s, 'critical', 'Áp rất thấp + lưu lượng rất lớn – nghi vỡ ống chính');
    if (sig.level_valid) {
      if (!this.level_trip && sig.level < s.level_ll_m) {
        this.level_trip = true;
        A.raise_(t, 'LEVEL_LL', 'critical', `Mức bể ${sig.level.toFixed(2)} m < ${s.level_ll_m.toFixed(1)} m – khóa chống chạy khô`);
      } else if (this.level_trip && sig.level > s.level_ll_restart_m) { this.level_trip = false; A.clear(t, 'LEVEL_LL'); }
    }
    A.set(t, 'DRY_RUN_FLOAT', meas['LSLL-101'], 'critical', 'Phao LSLL-101 báo cạn – mạch cứng cắt bơm');
    const installed = gw.sig_proc.installed;
    for (const key of ['cl', 'ntu', 'ph']) {
      const v = sig[key];
      const [wl, wh, tl, th, delay] = this._bands(key);
      const K = key.toUpperCase();
      if (!installed.has(QUALITY_TAGS[key])) { this.q_timer[key] = 0; continue; } // không có máy phân tích online
      if (v === null) {
        this.q_timer[key] = s.quality_sensor_fault_action === 'safe_stop' ? this.q_timer[key] + dt : 0;
        A.clear(t, K + '_WARN');
      } else {
        const db = DEADBAND[key];
        A.setHyst(t, dt, K + '_WARN', v < wl || v > wh, wl + db < v && v < wh - db, 'warning',
          `${QUALITY_NAME[key]} ${v.toFixed(2)} ${QUALITY_UNIT[key]} ngoài dải làm việc`, 10.0, 60.0);
        if (v < tl || v > th) this.q_timer[key] += dt; else this.q_timer[key] = 0;
      }
      if (this.q_timer[key] >= delay) {
        const vv = v === null ? 'mất tín hiệu ' + QUALITY_TAGS[key] : `${v.toFixed(2)} ${QUALITY_UNIT[key]}`;
        A.raise_(t, K + '_TRIP', 'critical', `${QUALITY_NAME[key]} vượt ngưỡng QCVN (${vv}) quá ${delay.toFixed(0)} s`);
        if (!this.safe_stop) {
          this.safe_stop = true; this.safe_t = t; this.safe_reason = QUALITY_NAME[key];
          A.raise_(t, 'SAFE_STOP', 'critical', `DỪNG AN TOÀN: ${QUALITY_NAME[key]} không đạt – dừng bơm, đóng van MV-02`);
        }
      }
    }
    if (this.qualityOkForReset(sig, installed)) this.ok_timer += dt; else this.ok_timer = 0;
    if (this.safe_stop && this.q_auto && this.ok_timer >= s.quality_reset_hold_s) this._clearSafeStop(t, gw, 'tự động theo cấu hình');
    let block = '';
    if (this.lockout) block = 'khóa sau nhiều lần cắt áp cao';
    else if (this.trip_active) block = `cắt áp cao, chờ ${Math.max(0, s.p_trip_restart_s - (t - this.trip_t)).toFixed(0)} s`;
    else if (this.safe_stop) block = 'dừng an toàn do ' + this.safe_reason;
    else if (this.level_trip || meas['LSLL-101']) block = 'mức bể rất thấp';
    else if (meas.outlet_frac < 0.95) block = 'chờ van MV-02 mở hết (trình tự: mở van trước, chạy bơm sau)';
    const n = block ? 0 : co.n;
    if (block && co.n > 0 && block !== this.last_block) gw.logEvent(t, 'safety', `Ưu tiên an toàn: chặn lệnh chạy ${co.n} bơm ${gw.manual !== null ? 'của người vận hành' : 'của kịch bản'} (${block})`);
    this.last_block = block;
    let fRef = co.f_ref;
    if (fRef > this.f_cap) fRef = this.f_cap;
    if (this.lockout || this.trip_active) this.state = 'trip';
    else if (this.safe_stop) this.state = 'safe_stop';
    else if (this.level_trip || meas['LSLL-101']) this.state = 'level_stop';
    else if (this.limiting) this.state = 'limiting';
    else this.state = 'normal';
    return { n, f_ref: fRef, order: co.order, outlet_open: !this.safe_stop, block };
  }
}

export class PumpManager {
  constructor(cfg, tags) {
    this.tags = tags; this.n = tags.length; this.max_starts = cfg.safety.max_starts_per_h; this.min_off = cfg.safety.min_off_s;
    this.cmd = new Array(this.n).fill(false); this.start_times = tags.map(() => []); this.stop_t = new Array(this.n).fill(-1e9);
  }
  startsLastHour(i, t) { return this.start_times[i].filter((x) => t - x < 3600.0).length; }
  apply(t, n, order, pumps, gw) {
    const chosen = [];
    for (const i of order) {
      if (chosen.length >= n) break;
      if (pumps[i].fault) continue;
      if (this.cmd[i]) { chosen.push(i); continue; }
      if (this.startsLastHour(i, t) >= this.max_starts) {
        gw.alarms.raise_(t, 'STARTS_LIMIT_' + this.tags[i], 'warning', `${this.tags[i]} đã khởi động ${this.max_starts} lần/giờ – tạm cấm khởi động (bảo vệ động cơ)`);
        continue;
      }
      if (t - this.stop_t[i] < this.min_off) continue;
      chosen.push(i);
    }
    for (let i = 0; i < this.n; i++) {
      if (this.startsLastHour(i, t) < this.max_starts) gw.alarms.clear(t, 'STARTS_LIMIT_' + this.tags[i]);
      const want = chosen.includes(i);
      if (want && !this.cmd[i]) this.start_times[i] = this.start_times[i].filter((x) => t - x < 3600.0).concat([t]);
      if (!want && this.cmd[i]) this.stop_t[i] = t;
      this.cmd[i] = want;
    }
    return [...this.cmd];
  }
}
