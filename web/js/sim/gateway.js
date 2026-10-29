// Edge gateway GW-01 – tương đương trambom/gateway.py
import { CommsClient } from './comms.js';
import { Controller, Forecaster } from './control.js';
import { PumpManager, SafetyLayer } from './safety.js';
import { installedTags } from './sensors.js';
import { canonical, clamp, deepCopy, flatten, fnv1a, getPath, setPath } from './util.js';

export const SEV_RANK = { info: 0, warning: 1, alarm: 2, critical: 3 };
export const D_PREFIXES = ['P_HIGH', 'P_HH_TRIP', 'LOCKOUT', 'P_LOW', 'BURST_SUSPECT', 'LEVEL_LL', 'LEVEL_STOP', 'DRY_RUN_FLOAT',
  'CL_', 'NTU_', 'PH_', 'SAFE_STOP', 'PT_DEVIATION', 'PT_STUCK', 'NO_PRESSURE', 'SENSOR_FAULT', 'PUMP_FAULT', 'FLOW_ANOMALY'];
// Tùy chọn lắp đặt: thiếu khóa = có lắp; mọi giá trị "falsy" khác = không lắp (giống Python: not hw.get(k, True))
export const hwOn = (cfg, k) => { const v = cfg.hardware?.[k]; return v === undefined ? true : Boolean(v); };
export const EVENT_ALARMS = ['SCRIPT_ROLLBACK', 'SCRIPT_REJECTED', 'SCRIPT_ERROR', 'GW_WATCHDOG'];
// Lệnh vận hành bằng tay (từ xa qua MQTT hoặc tại chỗ qua HMI)
export const MANUAL_CMDS = ['set_mode', 'pump_start', 'pump_stop', 'pump_speed', 'valve'];
export const SRC_NAME = { local: 'tại chỗ (HMI)', remote: 'từ xa (trung tâm)' };

export function validateParams(params, schema) {
  const errs = [];
  const flat = flatten(params);
  for (const [path, [lo, hi]] of Object.entries(schema)) {
    if (!(path in flat)) { errs.push('thiếu ' + path); continue; }
    const v = flat[path];
    if (typeof v !== 'number' || Number.isNaN(v)) errs.push(`${path} không phải số`);
    else if (v < lo || v > hi) errs.push(`${path}=${v} ngoài [${lo}, ${hi}]`);
  }
  try {
    if (params.pressure.p_set_min_bar >= params.pressure.p_set_max_bar) errs.push('p_set_min_bar phải < p_set_max_bar');
    if (params.level.restart_m <= params.level.stop_m) errs.push('restart_m phải > stop_m');
    if (params.staging.f_off_hz >= params.staging.f_on_hz) errs.push('f_off_hz phải < f_on_hz');
  } catch (e) { errs.push('cấu trúc kịch bản không hợp lệ'); }
  return errs;
}
export const scriptHash = (doc) => fnv1a(canonical({ strategy: doc.strategy, params: doc.params }));

export class AlarmManager {
  constructor(gw) { this.gw = gw; this.active = new Map(); this.timers = new Map(); this.history = []; this.raised_count = { info: 0, warning: 0, alarm: 0, critical: 0 }; }
  raise_(t, code, sev, msg) {
    if (this.active.has(code)) return false;
    const a = { code, sev, msg, t, acked: false };
    this.active.set(code, a); this.raised_count[sev] += 1;
    this.history.push({ t, action: 'raise', code, sev, msg });
    this.gw.onAlarm(t, a, 'raise');
    return true;
  }
  clear(t, code) {
    const a = this.active.get(code);
    if (!a) return;
    this.active.delete(code);
    this.history.push({ t, action: 'clear', code, sev: a.sev, msg: a.msg });
    this.gw.onAlarm(t, a, 'clear');
  }
  set(t, code, cond, sev, msg) { if (cond) this.raise_(t, code, sev, msg); else if (this.active.has(code)) this.clear(t, code); }
  setHyst(t, dt, code, raiseCond, clearCond, sev, msg, onDelay = 0, offDelay = 0) {
    let tm = this.timers.get(code) ?? 0;
    if (this.active.has(code)) {
      tm = clearCond ? tm + dt : 0;
      if (tm >= offDelay) { this.clear(t, code); tm = 0; }
    } else {
      tm = raiseCond ? tm + dt : 0;
      if (raiseCond && tm >= onDelay) { this.raise_(t, code, sev, msg); tm = 0; }
    }
    this.timers.set(code, tm);
  }
  ack(code, t = null) {
    const a = this.active.get(code);
    if (!a) return false;
    a.acked = true;
    if (EVENT_ALARMS.includes(code) && t !== null) this.clear(t, code);
    return true;
  }
  expireEvents(t) { for (const code of EVENT_ALARMS) { const a = this.active.get(code); if (a && t - a.t > 1800.0) this.clear(t, code); } }
  dActive() { for (const code of this.active.keys()) if (D_PREFIXES.some((p) => code.startsWith(p))) return true; return false; }
  maxSev() { let m = -1; for (const a of this.active.values()) m = Math.max(m, SEV_RANK[a.sev]); return m; }
}

const TAGS = ['PT-101', 'PT-102', 'FT-101', 'FT-100', 'LT-101', 'AIT-201', 'AIT-202', 'AIT-203'];

export class SignalProcessor {
  constructor(cfg) {
    this.cfg = cfg; this.sensors = cfg.sensors; this.pm = cfg.pump_model;
    this.m_per_bar = 1.0e5 / (cfg.constants.rho * cfg.constants.g); this.z_s = cfg.tank.z_suction_m;
    this.p_f = null; this.q_f = null; this.qin_f = null; this.level = cfg.tank.level_init_m; this.forced_pt = null;
    this.faulty = { 'PT-101': false, 'PT-102': false }; this.dev_timer = 0; this.agree_timer = 0;
    this.stuck = { 'PT-101': [null, 0], 'PT-102': [null, 0] }; this.pt_used = 'PT-101'; this.p_model = null;
    this.qf = { cl: null, ntu: null, ph: null };
    this.installed = installedTags(cfg); this.area = cfg.tank.area_m2; this.drain_q = cfg.tank.drain_q_m3h;
    this.mb_lv = null; this.mb_vout = 0; this.mb_hist = [];
  }
  // Mini PC khởi động lại: bộ lọc và cửa sổ cân bằng khối lượng bắt đầu lại từ đầu
  restart() {
    this.p_f = null; this.q_f = null; this.qin_f = null; this.mb_lv = null; this.mb_vout = 0; this.mb_hist = [];
    this.qf = { cl: null, ntu: null, ph: null }; this.dev_timer = 0; this.agree_timer = 0;
    for (const st of Object.values(this.stuck)) { st[0] = null; st[1] = 0; }
  }
  // Ước lượng lưu lượng vào ≈ lưu lượng ra (FT-101 + xả đáy) + A·dH/dt, cửa sổ trượt 15 phút.
  // Dùng khi không lắp FT-100 hoặc FT-100 mất tín hiệu. FT-101 lỗi → không ước lượng được (null).
  _inflowMassBalance(t, dt, lv, qOut, drain) {
    if (qOut === null || qOut === undefined) { this.mb_hist = []; this.mb_lv = null; return null; }
    const a = 1.0 - Math.exp(-dt / 30.0);
    this.mb_lv = this.mb_lv === null ? lv : this.mb_lv + (lv - this.mb_lv) * a;
    this.mb_vout += (qOut + (drain ? this.drain_q : 0)) * dt / 3600.0;
    const H = this.mb_hist;
    if (!H.length || t - H[H.length - 1][0] >= 60.0 - 1e-9) { H.push([t, this.mb_lv, this.mb_vout]); if (H.length > 16) H.shift(); }
    if (H.length < 16) return null;
    const [t0, l0, v0] = H[0], [t1, l1, v1] = H[H.length - 1];
    return Math.max(0, (this.area * (l1 - l0) + (v1 - v0)) * 3600.0 / (t1 - t0));
  }
  // NAMUR NE43: 3,8–20,5 mA (kể cả bão hòa ngoài thang) vẫn hợp lệ, được dùng cho lớp an toàn; chỉ mất tín hiệu mới là lỗi
  _valid(tag, v) {
    if (v === null || v === undefined) return false;
    const sp = this.sensors[tag]; const span = sp.hi - sp.lo;
    return sp.lo - 0.0126 * span <= v && v <= sp.hi + 0.0311 * span;
  }
  _saturated(tag, v) {
    const sp = this.sensors[tag]; const span = sp.hi - sp.lo;
    return v <= sp.lo - 0.0124 * span || v >= sp.hi + 0.0309 * span;
  }
  process(t, dt, meas, gw) {
    const A = gw.alarms; const P = gw.script.params; const voting = P.features.pressure_voting; const s = gw.cfg.safety;
    const valid = {};
    for (const tag of TAGS) {
      const ok = this._valid(tag, meas[tag]);
      valid[tag] = ok;
      if (!this.installed.has(tag)) continue; // không lắp: không phải lỗi tín hiệu
      A.set(t, 'SENSOR_FAULT_' + tag, !ok, 'alarm', `Lỗi tín hiệu ${tag} (mất tín hiệu < 3,6 mA)`);
      A.set(t, 'SENSOR_RANGE_' + tag, ok && this._saturated(tag, meas[tag]), 'warning', `${tag} bão hòa ngoài thang đo (3,8 / 20,5 mA) – giá trị thật có thể còn xa hơn`);
    }
    const running = meas.pumps.some((p) => p.running);
    for (const tag of ['PT-101', 'PT-102']) {
      const v = meas[tag]; const st = this.stuck[tag];
      if (v !== null && st[0] !== null && Math.abs(v - st[0]) < 1e-7 && running) st[1] += dt; else st[1] = 0;
      st[0] = v;
      if (voting && st[1] >= 30.0 && !this.faulty[tag]) {
        this.faulty[tag] = true;
        A.raise_(t, 'PT_STUCK_' + tag, 'alarm', `${tag} không đổi giá trị 30 s khi bơm chạy – nghi kẹt, loại khỏi điều khiển`);
      }
    }
    const p1 = valid['PT-101'] ? meas['PT-101'] : null;
    const p2 = valid['PT-102'] ? meas['PT-102'] : null;
    const qRaw = valid['FT-101'] ? meas['FT-101'] : null;
    const lv = valid['LT-101'] ? meas['LT-101'] : this.level;
    this.level = lv;
    const run = meas.pumps.filter((p) => p.running && p.f >= this.pm.f_min_hz - 0.5);
    this.p_model = null;
    if (run.length && qRaw !== null) {
      const sMean = run.reduce((a, p) => a + p.f, 0) / run.length / this.pm.f_rated_hz;
      const qn = qRaw / run.length;
      const h = this.pm.h0_m * sMean * sMean - this.pm.k_m_per_m3h2 * qn * qn;
      this.p_model = (h + lv + this.z_s) / this.m_per_bar;
    }
    if (p1 !== null && p2 !== null) {
      const d = Math.abs(p1 - p2);
      if (d > s.pt_deviation_bar) { this.dev_timer += dt; this.agree_timer = 0; }
      else { this.dev_timer = 0; if (d < 0.1) this.agree_timer += dt; }
      if (this.dev_timer >= s.pt_deviation_delay_s) {
        if (A.raise_(t, 'PT_DEVIATION', 'alarm', `PT-101 (${p1.toFixed(2)}) và PT-102 (${p2.toFixed(2)}) lệch ${d.toFixed(2)} bar`)) {
          if (voting && this.p_model !== null) {
            const bad = Math.abs(p1 - this.p_model) > Math.abs(p2 - this.p_model) ? 'PT-101' : 'PT-102';
            this.faulty[bad] = true;
            gw.logEvent(t, 'safety', `Biểu quyết 2/3 với mô hình bơm (${this.p_model.toFixed(2)} bar): loại ${bad} khỏi điều khiển`);
          }
        }
      }
      if (d < 0.5 * s.pt_deviation_bar) A.clear(t, 'PT_DEVIATION');
      if (this.agree_timer >= 60.0) {
        for (const tag of ['PT-101', 'PT-102']) {
          if (this.faulty[tag] && this.stuck[tag][1] === 0) {
            this.faulty[tag] = false; A.clear(t, 'PT_STUCK_' + tag); gw.logEvent(t, 'info', `${tag} khớp trở lại – đưa vào sử dụng`);
          }
        }
      }
    }
    const cand = [];
    if (this.forced_pt !== null) cand.push(this.forced_pt);
    cand.push('PT-101', 'PT-102');
    let pCtrlRaw = null, used = null;
    for (const tag of cand) {
      const v = tag === 'PT-101' ? p1 : p2;
      if (v !== null && !this.faulty[tag]) { pCtrlRaw = v; used = tag; break; }
    }
    if (used !== this.pt_used && used !== null) gw.logEvent(t, 'info', 'Cảm biến áp lực cho điều khiển: ' + used);
    this.pt_used = used;
    const tau = P.pressure.filter_tau_s;
    if (pCtrlRaw === null) this.p_f = null;
    else if (this.p_f === null || tau <= 0.0) this.p_f = pCtrlRaw;
    else this.p_f += (pCtrlRaw - this.p_f) * (1.0 - Math.exp(-dt / tau));
    let prot = [['PT-101', p1], ['PT-102', p2]].filter(([tag, v]) => v !== null && !this.faulty[tag]).map((x) => x[1]);
    if (!prot.length) prot = [p1, p2].filter((v) => v !== null);
    const pProt = prot.length ? Math.max(...prot) : null;
    if (qRaw !== null) this.q_f = this.q_f === null ? qRaw : this.q_f + (qRaw - this.q_f) * (1.0 - Math.exp(-dt / 10.0));
    const mb = this._inflowMassBalance(t, dt, lv, qRaw, meas.drain_open);
    if (this.installed.has('FT-100') && valid['FT-100']) {
      const qin = meas['FT-100']; // lưu lượng trượt ≈ 60 s từ bộ đếm xung
      this.qin_f = this.qin_f === null ? qin : this.qin_f + (qin - this.qin_f) * (1.0 - Math.exp(-dt / 60.0));
    } else this.qin_f = mb;
    const aq = 1.0 - Math.exp(-dt / 20.0);
    for (const [key, tag] of [['cl', 'AIT-201'], ['ntu', 'AIT-202'], ['ph', 'AIT-203']]) {
      const v = valid[tag] ? meas[tag] : null;
      if (v === null) this.qf[key] = null;
      else if (this.qf[key] === null) this.qf[key] = v;
      else this.qf[key] += (v - this.qf[key]) * aq;
    }
    return {
      p_ctrl: this.p_f, p_ctrl_raw: pCtrlRaw, p_prot: pProt, pt_used: used, p1, p2, p_model: this.p_model,
      q: qRaw, q_f: this.q_f, q_in_f: this.qin_f, level: lv, level_valid: valid['LT-101'],
      cl: this.qf.cl, ntu: this.qf.ntu, ph: this.qf.ph, pumps: meas.pumps,
    };
  }
}

export class Gateway {
  constructor(cfg, station, link, scriptDoc, profile, levelName = 'basic') {
    this.cfg = cfg; this.id = station.id ?? 'ST-01'; this.pump_tags = [...cfg.pumps]; this.start_dow = cfg.sim.start_dow; this.t = 0;
    this.script = deepCopy(scriptDoc);
    if (this.script.local_modified === undefined) this.script.local_modified = false;
    this.script.hash = scriptHash(this.script);
    this.script_prev = null; this.watch = null; this.local_changes = []; this.logs = [];
    this.alarms = new AlarmManager(this); this.sig_proc = new SignalProcessor(cfg); this.safety = new SafetyLayer(cfg);
    this.ctrl = new Controller(cfg, this.pump_tags.length); this.forecaster = new Forecaster(profile, this.start_dow);
    this.pm = new PumpManager(cfg, this.pump_tags); this.comms = new CommsClient(cfg, link, this);
    this.override = null; this.offline_since = null; this.last_offline_since = null; this.flush = null; this.applied_cmds = [];
    this.custom_fn = null; this.clock_offset = 0; this.sig = null; this.out = null; this.level_name = levelName; this.sms_log = [];
    this.last = {}; this.cmd_results = []; this.conflicts = []; this.stopped_s = 0; this.recover_until = 0;
    this.notify = []; this.manual = null; this.manual_s = 0; this.local_seq = 0; this.observe_until = null;
    this.onLog = null;
  }
  logEvent(t, level, text) {
    const e = { t, level, text };
    this.logs.push(e);
    if (this.logs.length > 5000) this.logs = this.logs.slice(-4000);
    if (this.onLog) this.onLog(e);
    if (['alarm', 'safety', 'critical'].includes(level)) this.comms.pushEvent({ kind: 'log', t, sev: 'warning', text });
  }
  onAlarm(t, a, action) {
    const e = action === 'raise' ? { t, level: a.sev, text: `BÁO ĐỘNG [${a.code}] ${a.msg}` } : { t, level: 'info', text: `Hết báo động [${a.code}]` };
    this.logs.push(e);
    if (this.onLog) this.onLog(e);
    this.comms.pushEvent({ kind: 'alarm', action, code: a.code, sev: a.sev, msg: a.msg, t });
    if (action === 'raise' && a.sev === 'critical') {
      // thời điểm tổ trực thực sự biết: khi máy chủ xác nhận sự kiện (evt_ack) hoặc khi SMS được gửi
      const n = { t, code: a.code, msg: a.msg, via: null, t_notified: null, eseq: this.comms.eseq };
      this.notify.push(n);
      if (this.offline_since !== null) this._notifySms(t, n);
    }
  }
  _notifySms(t, n) {
    let s;
    if (this.cfg.gateway.sms_fallback && hwOn(this.cfg, 'SMS')) {
      this.sms_log.push({ t, text: `[${this.id}] ${n.msg}` });
      this.comms.stats.sms += 1;
      s = { t, level: 'info', text: 'Mất mạng IP – gửi SMS dự phòng tới tổ trực: ' + n.msg };
      n.via = 'SMS'; n.t_notified = t;
    } else {
      s = { t, level: 'info', text: 'Mất mạng IP, trạm không có modem SMS – báo động chờ gửi khi có mạng: ' + n.msg };
      n.via = 'chờ mạng';
    }
    this.logs.push(s); if (this.onLog) this.onLog(s);
  }
  onEventsAcked(ids, t) {
    for (const n of this.notify) if (n.t_notified === null && ids.has(n.eseq)) { n.t_notified = t; if (n.via === null) n.via = 'IP'; }
  }
  onOffline(t, lastAck) {
    this.offline_since = t; this.last_offline_since = lastAck;
    this.logEvent(t, 'alarm', `Mất kết nối máy chủ > ${this.cfg.gateway.offline_after_s.toFixed(0)} s – chuyển chế độ (b) tự vận hành bằng kịch bản v${this.script.version} đã lưu`);
    this.alarms.raise_(t, 'COMMS_OFFLINE', 'warning', 'Mất kết nối máy chủ điều hành');
    // báo động khẩn phát sinh khi mạng đã đứt nhưng chưa phát hiện (≤ 60 s): gửi SMS ngay khi phát hiện
    for (const n of this.notify) if (n.t_notified === null && n.via === null) this._notifySms(t, n);
  }
  onOnline(t) {
    const dur = this.offline_since !== null ? t - this.offline_since : 0;
    this.offline_since = null;
    this.alarms.clear(t, 'COMMS_OFFLINE');
    this.logEvent(t, 'info', `Khôi phục kết nối sau ${(dur / 60).toFixed(1)} phút – chế độ (c) đồng bộ: gửi bản tin chào, ${this.comms.buf.length} bản ghi đệm`);
  }
  // Mini PC khởi động lại sau khi treo: nạp kịch bản, dự báo, bộ đệm từ ổ SSD; tiếp quản không xung
  restart(t, tFail, pumps, note) {
    const down = t - tFail;
    if (this.manual !== null) {
      // phiên điều khiển tay không được "sống lại" sau khi mini PC khởi động lại
      this.manual = null; this.alarms.clear(t, 'MANUAL_MODE');
      this.logEvent(t, 'info', 'Mini PC khởi động lại – hủy phiên điều khiển TAY trước đó');
    }
    this.sig_proc.restart();
    pumps.forEach((p, i) => { this.pm.cmd[i] = p.running; });
    this.comms.restart(t);
    this.offline_since = t; this.last_offline_since = tFail;
    this.observe_until = t + this.cfg.fallback.takeover_s;
    this.alarms.raise_(t, 'GW_WATCHDOG', 'alarm', `Mini PC ngừng ${(down / 60).toFixed(0)} phút (watchdog phát hiện) – ${note}; đã khởi động lại`);
    this.logEvent(t, 'info', `Mini PC khởi động lại: nạp kịch bản v${this.script.version}, mô hình dự báo và ${this.comms.buf.length} bản ghi đệm từ ổ SSD – theo dõi ${this.cfg.fallback.takeover_s.toFixed(0)} s trước khi tiếp quản`);
  }
  // Hết thời gian theo dõi: tiếp quản từ PID nội biến tần theo kiểu không xung
  _takeover(t, pumps) {
    this.observe_until = null;
    const c = this.ctrl;
    c.n = 0; c.sleep_state = 'awake'; c.stage_timer = 0; c.destage_timer = 0; c.swap_until = null; c.next_tte = t;
    const running = pumps.map((p, i) => (p.running ? i : -1)).filter((i) => i >= 0);
    if (running.length) c.duty = running[0];
    pumps.forEach((p, i) => { this.pm.cmd[i] = p.running; });
    this.logEvent(t, 'info', 'Mini PC tiếp quản điều khiển (không xung) – biến tần thôi chạy PID nội');
  }
  applyScript(doc, t, source) {
    const errs = validateParams(doc.params, this.cfg.script_schema);
    if (errs.length) {
      this.alarms.raise_(t, 'SCRIPT_REJECTED', 'warning', `Từ chối kịch bản v${doc.version}: ${errs.slice(0, 3).join('; ')}`);
      this.comms.sendDirect(t, { type: 'script_status', station: this.id, version: doc.version, status: 'rejected', reason: errs }, 'ack');
      return false;
    }
    this.script_prev = this.script;
    const nw = deepCopy(doc);
    nw.local_modified = false; nw.hash = scriptHash(nw);
    this.script = nw;
    this.watch = { t0: t, until: t + this.cfg.gateway.script_watch_s, err_s: 0, n_s: 0, trips0: this.safety.trip_count };
    this.logEvent(t, 'info', `Áp dụng kịch bản v${nw.version} (${source}, ${nw.strategy}) – giám sát ${(this.cfg.gateway.script_watch_s / 60).toFixed(0)} phút trước khi xác nhận`);
    this.comms.sendDirect(t, { type: 'script_status', station: this.id, version: nw.version, status: 'applied' }, 'ack');
    return true;
  }
  _watchStep(t, dt) {
    const w = this.watch;
    if (!w) return;
    if (this.manual !== null || this.observe_until !== null) {
      // kịch bản không điều khiển lúc này: tạm dừng cửa sổ giám sát
      w.until += dt; w.t0 += dt; w.trips0 = this.safety.trip_count;
      return;
    }
    const g = this.cfg.gateway; const sig = this.sig;
    if (sig.pumps.some((p) => p.running) && sig.p_ctrl !== null) {
      w.n_s += dt;
      if (Math.abs(sig.p_ctrl - this.ctrl.p_set) > g.script_rollback_err_bar) w.err_s += dt;
    }
    const elapsed = t - w.t0;
    const frac = w.n_s > 0 ? w.err_s / w.n_s : 0;
    const bad = (elapsed >= 120.0 && w.n_s >= 60.0 && frac > g.script_rollback_err_frac) || this.safety.trip_count > w.trips0;
    if (bad && this.script_prev !== null) {
      const badv = this.script.version;
      this.script = this.script_prev; this.script_prev = null; this.watch = null;
      this.alarms.raise_(t, 'SCRIPT_ROLLBACK', 'alarm', `Kịch bản v${badv} gây sai lệch áp ${(100 * frac).toFixed(0)}% thời gian – quay lui v${this.script.version}`);
      this.comms.sendDirect(t, { type: 'script_status', station: this.id, version: badv, status: 'rollback', restored: this.script.version }, 'ack');
    } else if (t >= w.until) {
      this.logEvent(t, 'info', `Kịch bản v${this.script.version} vận hành ổn định ${(elapsed / 60).toFixed(0)} phút – xác nhận (commit)`);
      this.comms.sendDirect(t, { type: 'script_status', station: this.id, version: this.script.version, status: 'committed' }, 'ack');
      this.watch = null; this.script_prev = null;
    }
  }
  handleScript(doc, t, source) {
    if (this.script.local_modified) this.logEvent(t, 'info', `Nhận kịch bản v${doc.version} trong khi có chỉnh sửa tại chỗ – chờ máy chủ hợp nhất`);
    this.applyScript(doc, t, source);
  }
  localEdit(patch, t, by = 'HMI', reason = '') {
    const params = deepCopy(this.script.params);
    for (const [path, v] of Object.entries(patch)) setPath(params, path, v);
    const errs = validateParams(params, this.cfg.script_schema);
    if (errs.length) { this.logEvent(t, 'alarm', 'HMI: từ chối chỉnh sửa (' + errs.join('; ') + ')'); return false; }
    const changes = Object.entries(patch).map(([path, v]) => ({ path, old: getPath(this.script.params, path), new: v, t, by, reason }));
    this.script.params = params; this.script.local_modified = true; this.script.hash = scriptHash(this.script);
    this.local_changes.push(...changes);
    this.logEvent(t, 'info', `HMI tại trạm (${by}): ` + changes.map((c) => `${c.path}=${c.new}`).join(', '));
    if (this.offline_since === null && this.comms.state === 'online') {
      this.comms.sendDirect(t, { type: 'local_change', station: this.id, base_version: this.script.version, changes }, 'sync');
    }
    return true;
  }
  onVersionAssigned(msg, t) {
    this.script.version = msg.version; this.script.local_modified = false; this.local_changes = [];
    this.logEvent(t, 'info', `Máy chủ ghi nhận chỉnh sửa tại chỗ thành kịch bản v${msg.version}`);
  }
  handleSyncPlan(msg, t) {
    const off = msg.clock_offset ?? 0;
    if (Math.abs(off) > 0) this.logEvent(t, 'info', `Hiệu chỉnh đồng hồ gateway: lệch ${off.toFixed(2)} s sau thời gian mất mạng`);
    this.clock_offset = 0;
    this.conflicts = msg.conflicts ?? [];
    for (const c of this.conflicts) this.logEvent(t, 'info', `Xung đột ${c.path}: server=${c.server}, tại chỗ=${c.local} → ${c.result} (${c.rule})`);
    if (msg.script) { this.applyScript(msg.script, t, 'đồng bộ sau mất mạng'); this.local_changes = []; }
    else if (msg.accepted_version !== null && msg.accepted_version !== undefined) {
      this.script.version = msg.accepted_version; this.script.local_modified = false; this.local_changes = [];
      this.logEvent(t, 'info', `Máy chủ chấp nhận chỉnh sửa tại chỗ thành v${msg.accepted_version}`);
    }
    for (const cmd of msg.commands ?? []) this.handleCommand(cmd, t, 'đồng bộ');
  }
  handleCommand(cmd, t, via, src = 'remote') {
    const cid = cmd.id;
    if (this.applied_cmds.includes(cid)) { this._ackCmd(t, cmd, 'duplicate', 'đã thực thi trước đó'); return; }
    const now = t + this.clock_offset;
    if (now > cmd.expires_at) {
      this._ackCmd(t, cmd, 'expired', `hết hạn lúc ${cmd.expires_at.toFixed(0)} s (nhận lúc ${now.toFixed(0)} s)`);
      this.logEvent(t, 'info', `Từ chối lệnh ${cmd.type} (${via}): đã hết hạn – tránh thực thi lệnh dựa trên trạng thái cũ`);
      this.applied_cmds.push(cid);
      return;
    }
    const a = cmd.args ?? {};
    let ok = true, why = 'ok';
    switch (cmd.type) {
      case 'set_override': {
        const ttl = Math.min(a.ttl_s ?? this.script.params.offline.override_ttl_s, cmd.expires_at - now);
        this.override = { p_set: a.p_set_bar, until: t + ttl, id: cid };
        why = `ghi đè áp đặt ${a.p_set_bar.toFixed(2)} bar trong ${(ttl / 60).toFixed(0)} phút`;
        break;
      }
      case 'clear_override': this.override = null; break;
      case 'rotate_pumps': this.ctrl.force_rotate = true; why = 'sẽ luân phiên bơm'; break;
      case 'reset_safe_stop': [ok, why] = this.safety.requestReset(t, this); break;
      case 'ack_alarm': ok = this.alarms.ack(a.code ?? '', t); why = ok ? 'đã xác nhận' : 'không có báo động'; break;
      case 'flush_tank':
        if (this.safety.safe_stop) { this.flush = { target: a.target_m ?? 1.4 }; why = `mở van xả VX-01 tới mức ${this.flush.target.toFixed(1)} m`; }
        else { ok = false; why = 'chỉ xả bể khi trạm đang dừng an toàn'; }
        break;
      case 'select_pt':
        if (this.sig_proc.installed.has(a.tag)) { this.sig_proc.forced_pt = a.tag ?? null; why = `dùng ${a.tag} cho điều khiển`; }
        else { ok = false; why = `${a.tag} không được lắp đặt tại trạm`; }
        break;
      default:
        if (MANUAL_CMDS.includes(cmd.type)) [ok, why] = this._manualCmd(cmd.type, a, t, src);
        else { ok = false; why = 'lệnh không hỗ trợ'; }
    }
    this.applied_cmds.push(cid);
    if (src === 'local') {
      const text = `HMI tại trạm – ${cmd.type}: ` + (ok ? why : 'TỪ CHỐI – ' + why);
      this.cmd_results.push({ t, id: cid, type: cmd.type, status: ok ? 'ok' : 'rejected', reason: why });
      const e = { t, level: ok ? 'info' : 'alarm', text };
      this.logs.push(e); if (this.onLog) this.onLog(e);
      this.comms.pushEvent({ kind: 'log', t, sev: 'info', text });
      return [ok, why];
    }
    this._ackCmd(t, cmd, ok ? 'ok' : 'rejected', why);
    this.logEvent(t, ok ? 'info' : 'alarm', `Lệnh từ xa ${cmd.type} (${via}): ` + (ok ? why : 'TỪ CHỐI – ' + why));
    return [ok, why];
  }
  // Lệnh của kỹ thuật viên trên màn hình HMI tại tủ điều khiển (không qua mạng, không hết hạn)
  localCommand(type, args, t) {
    this.local_seq += 1;
    const cmd = { id: 'L' + String(this.local_seq).padStart(4, '0'), type, args: { ...(args ?? {}) }, expires_at: t + 1e9 };
    return this.handleCommand(cmd, t, 'HMI tại trạm', 'local');
  }
  controlSrc() { return this.manual === null ? 'auto' : this.manual.src; }
  // Vận hành bằng tay: quyền tại chỗ ưu tiên hơn từ xa; lệnh từ xa có thời hạn; mọi lệnh tay vẫn qua lớp an toàn
  _manualCmd(typ, a, t, src) {
    const m = this.manual, n = this.pump_tags.length, pm = this.cfg.pump_model, lease = this.cfg.gateway.manual_lease_s;
    if (this.observe_until !== null) return [false, 'mini PC vừa khởi động lại, đang theo dõi trước khi tiếp quản – thử lại sau'];
    if (src === 'remote' && m !== null && m.src === 'local') return [false, 'trạm đang điều khiển TẠI CHỖ – quyền HMI tại trạm ưu tiên, từ chối lệnh từ xa'];
    if (typ === 'set_mode') {
      if ((a.mode ?? 'manual') === 'auto') {
        if (m === null) return [true, 'trạm đã ở chế độ tự động'];
        this._endManual(t, 'lệnh ' + SRC_NAME[src]);
        return [true, `trở về TỰ ĐỘNG theo kịch bản v${this.script.version}`];
      }
      const pumps = this.sig ? this.sig.pumps : Array.from({ length: n }, () => ({ running: false, f: 0 }));
      if (m === null) {
        this.manual = { src, t0: t, until: src === 'remote' ? t + lease : null, run: this.pm.cmd.map(Boolean),
          f: pumps.map((p) => (p.running ? p.f : 40.0)), valve: true };
        this.alarms.raise_(t, 'MANUAL_MODE', 'warning', `Trạm ở chế độ TAY – điều khiển ${SRC_NAME[src]}; kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động`);
      } else this._takeOver(t, src, lease);
      return [true, `chuyển sang chế độ TAY ${SRC_NAME[src]}` + (src === 'remote' ? `, quyền có hạn ${(lease / 60).toFixed(0)} phút, tự trở về tự động khi mất kết nối` : '')];
    }
    if (m === null) return [false, 'trạm đang ở chế độ TỰ ĐỘNG – cần chuyển sang TAY trước'];
    this._takeOver(t, src, lease);
    if (typ === 'valve') {
      if (!hwOn(this.cfg, 'MV-02')) return [false, 'trạm không lắp van điện MV-02'];
      m.valve = a.open === undefined ? true : Boolean(a.open);
      return [true, (m.valve ? 'mở' : 'đóng') + ' van MV-02'];
    }
    const i = Math.trunc(a.pump ?? 0);
    if (i < 0 || i >= n) return [false, 'không có bơm ' + i];
    const tag = this.pump_tags[i];
    if (a.f_hz !== undefined) m.f[i] = clamp(+a.f_hz, pm.f_min_hz, pm.f_max_hz);
    if (typ === 'pump_start') {
      if (this.sig && this.sig.pumps[i].fault) return [false, `${tag} đang báo lỗi biến tần/bơm`];
      m.run[i] = true;
      return [true, `chạy ${tag} ở ${m.f[i].toFixed(1)} Hz`];
    }
    if (typ === 'pump_stop') { m.run[i] = false; return [true, 'dừng ' + tag]; }
    return [true, `đặt tần số ${tag} = ${m.f[i].toFixed(1)} Hz`];
  }
  _takeOver(t, src, lease) {
    const m = this.manual;
    if (m.src !== src) {
      this.logEvent(t, 'info', 'Quyền điều khiển TAY chuyển sang ' + SRC_NAME[src]);
      m.src = src;
      const al = this.alarms.active.get('MANUAL_MODE');
      if (al) al.msg = `Trạm ở chế độ TAY – điều khiển ${SRC_NAME[src]}; kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động`;
    }
    m.until = src === 'remote' ? t + lease : null;
  }
  _endManual(t, why) {
    const m = this.manual;
    this.manual = null;
    const running = this.pm.cmd.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (running.length) this.ctrl.duty = running[0];
    this.alarms.clear(t, 'MANUAL_MODE');
    this.logEvent(t, 'info', `Kết thúc chế độ TAY ${SRC_NAME[m.src]} sau ${((t - m.t0) / 60).toFixed(0)} phút (${why}) – kịch bản v${this.script.version} tiếp quản`);
  }
  _manualOutput(t, dt) {
    const m = this.manual;
    if (m.src === 'remote') {
      if (this.offline_since !== null) {
        this.logEvent(t, 'safety', 'Mất kết nối khi đang điều khiển TAY từ xa – tự trở về TỰ ĐỘNG (không để trạm chạy theo lệnh cũ)');
        this._endManual(t, 'mất kết nối');
        return null;
      }
      if (t >= m.until) { this._endManual(t, 'hết thời hạn quyền điều khiển từ xa'); return null; }
    }
    this.manual_s += dt;
    const n = m.run.length;
    const idx = [...Array(n).keys()];
    // chỉ những bơm người vận hành đã ra lệnh chạy – không để bộ quản lý bơm tự chọn bơm khác
    const order = idx.filter((i) => m.run[i]);
    const fs = idx.filter((i) => m.run[i]).map((i) => m.f[i]);
    return { n: fs.length, f_ref: fs.length ? Math.max(...fs) : 0.0, order, p_set: this.ctrl.p_set };
  }
  _ackCmd(t, cmd, status, reason) {
    this.cmd_results.push({ t, id: cmd.id, type: cmd.type, status, reason });
    this.comms.pushEvent({ kind: 'cmd_ack', id: cmd.id, status, reason, t, sev: 'info' });
  }
  makeRecord(t) {
    const L = this.last; const p = L.p ?? null; const q = L.q ?? null;
    return {
      t0: t, t1: t, ts0: t + this.clock_offset, ts1: t + this.clock_offset, p, p_min: p ?? 0, p_max: p ?? 0, p_set: L.p_set ?? null,
      q, q_min: q ?? 0, q_max: q ?? 0, q_in: L.q_in ?? null, level: L.level ?? null, cl: L.cl ?? null, ntu: L.ntu ?? null, ph: L.ph ?? null,
      kw: L.kw ?? null, kwh: L.kwh ?? null, f1: L.f1 ?? null, f2: L.f2 ?? null, mode: this.mode(), ctl: this.controlSrc(),
    };
  }
  mode() {
    if (this.safety.state !== 'normal' || this.alarms.dActive()) return 'd';
    if (this.comms.state === 'resync') return 'c';
    if (this.comms.state === 'offline') return 'b';
    return 'a';
  }
  step(t, dt, meas) {
    this.t = t;
    if (this.offline_since !== null) this.clock_offset += this.cfg.gateway.clock_drift_ppm * 1e-6 * dt;
    this.comms.receive(t);
    const sig = this.sig_proc.process(t, dt, meas, this);
    this.sig = sig;
    meas.pumps.forEach((p, i) => this.alarms.set(t, 'PUMP_FAULT_' + this.pump_tags[i], p.fault, 'alarm', `Biến tần/bơm ${this.pump_tags[i]} báo lỗi`));
    const running = meas.pumps.some((p) => p.running);
    const delivering = running && meas.outlet_frac > 0.99 && !this.safety.safe_stop;
    if (delivering) {
      if (this.stopped_s > 600.0) {
        const win = Math.max(3.0 * 3600.0, 1.5 * this.stopped_s);
        this.recover_until = t + win;
        this.logEvent(t, 'info', `Cấp nước trở lại sau ${(this.stopped_s / 60).toFixed(0)} phút ngừng – bồn mái nạp bù, tạm dừng học dự báo và phát hiện bất thường ${(win / 3600).toFixed(1)} h`);
      }
      this.stopped_s = 0;
    } else if (this.ctrl.sleep_state !== 'sleep') this.stopped_s += dt;
    const learn = delivering && this.ctrl.conserve === 0 && !this.ctrl.level_stop && t >= this.recover_until;
    const pd = this.script.params.predictive;
    this.forecaster.update(t, sig.q_f, learn, pd);
    if (this.script.params.features.anomaly_detection && t >= this.recover_until) {
      this.alarms.set(t, 'FLOW_ANOMALY', this.forecaster.anomaly, 'alarm', `Lưu lượng cao hơn dự báo ${this.forecaster.resid.toFixed(1)} m³/h kéo dài – nghi rò rỉ/vỡ ống`);
    } else this.alarms.clear(t, 'FLOW_ANOMALY');
    if (this.observe_until !== null && t >= this.observe_until) this._takeover(t, meas.pumps);
    let mo = this.manual !== null ? this._manualOutput(t, dt) : null;
    if (this.observe_until !== null) {
      // đang theo dõi sau khởi động lại: bám theo trạng thái bơm do PID nội biến tần điều khiển
      const runI = meas.pumps.map((p, i) => (p.running ? i : -1)).filter((i) => i >= 0);
      mo = { n: runI.length, f_ref: runI.length ? Math.max(...runI.map((i) => meas.pumps[i].f)) : 0.0, order: runI, p_set: this.ctrl.p_set };
    }
    let co = this.ctrl.step(t, dt, sig, this);
    if (mo !== null) co = mo;
    const fo = this.safety.evaluate(t, dt, sig, co, this, meas);
    const run = this.pm.apply(t, fo.n, fo.order, meas.pumps, this);
    const m = this.manual;
    const man = m !== null && mo !== null;
    if (man) {
      meas.pumps.forEach((p, i) => {
        if (p.fault && m.run[i]) { m.run[i] = false; this.logEvent(t, 'safety', `${this.pump_tags[i]} báo lỗi khi đang chạy TAY – dừng, cần lệnh chạy lại sau khi sửa`); }
      });
    }
    if (man && fo.block && !fo.block.startsWith('chờ van')) {
      // liên động/cắt an toàn ở chế độ tay: bơm không tự chạy lại, người vận hành phải ra lệnh mới
      m.run.forEach((r, i) => { if (r) { m.run[i] = false; this.logEvent(t, 'safety', `Liên động an toàn dừng ${this.pump_tags[i]} khi đang chạy TAY (${fo.block}) – cần lệnh chạy lại`); } });
    }
    let drain = false;
    if (this.flush !== null) {
      if (!this.safety.safe_stop || sig.level <= this.flush.target) { this.logEvent(t, 'info', `Xả bể kết thúc ở mức ${sig.level.toFixed(2)} m`); this.flush = null; }
      else drain = true;
    }
    this._watchStep(t, dt);
    if (Math.trunc(t) % 60 === 0) this.alarms.expireEvents(t);
    const fRef = fo.f_ref;
    const fEach = man ? run.map((r, i) => (r ? Math.min(m.f[i], this.safety.f_cap) : 0.0))
      : mo !== null ? run.map((r, i) => (r ? meas.pumps[i].f : 0.0)) : run.map((r) => (r ? fRef : 0.0));
    this.last = { p: sig.p_ctrl, p_set: this.ctrl.p_set, q: sig.q_f, q_in: sig.q_in_f, level: sig.level, cl: sig.cl, ntu: sig.ntu, ph: sig.ph, kw: meas.kw, kwh: meas.kwh, f1: meas.pumps[0].f, f2: meas.pumps[1].f };
    this.comms.tick(t, dt);
    this.out = { run, f_ref: fEach, outlet_open: fo.outlet_open && (!man || m.valve), drain_open: drain };
    return this.out;
  }
}
