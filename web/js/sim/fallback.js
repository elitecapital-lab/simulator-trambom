// Trạm khi mini PC (edge gateway) ngừng hoạt động: rơ-le watchdog + PID nội biến tần – tương đương trambom/fallback.py
import { hwOn } from './gateway.js';
import { clamp } from './util.js';

export class GatewayFallback {
  constructor(cfg, gw, plant, t0) {
    this.fb = cfg.fallback; this.enabled = hwOn(cfg, 'VFD_PID_fallback');
    this.f_min = cfg.pump_model.f_min_hz; this.f_max = cfg.pump_model.f_max_hz;
    this.t0 = t0; this.logs = gw.logs; this.gw = gw; this.tags = gw.pump_tags; this.installed = gw.sig_proc.installed;
    const n = plant.pumps.length;
    const last = gw.out ?? { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: true };
    this.hold = { run: [...last.run], f_ref: [...last.f_ref], outlet_open: last.outlet_open, drain_open: false };
    this.inhibit = gw.safety.safe_stop || gw.safety.lockout;
    const running = plant.pumps.map((pu, i) => (pu.running && !pu.fault ? i : -1)).filter((i) => i >= 0);
    let duty = gw.ctrl.duty;
    if (!running.includes(duty) && running.length) duty = running[0]; // KA-DUTY theo bơm đang chạy
    if (plant.pumps[duty].fault) duty = 1 - duty;
    this.duty = duty;
    const pu = plant.pumps[duty];
    this.I = pu.running ? pu.f : this.f_min;
    this.active = false; this.io_off = false; this.p_set = null; this.restarted = false;
  }
  note() {
    if (this.inhibit) return 'trạm giữ trạng thái dừng an toàn đã chốt';
    if (this.enabled) return `biến tần ${this.tags[this.duty]} chạy PID nội giữ ${this.fb.p_set_bar.toFixed(1)} bar`;
    if ((this.fb.io_safe_state ?? 'off') === 'hold') return 'không có dự phòng, mô-đun I/O giữ nguyên lệnh cuối';
    return 'không có dự phòng, mô-đun I/O đưa lệnh chạy về 0 – bơm dừng';
  }
  _pt(i) { return i === 1 && this.installed.has('PT-102') ? 'PT-102' : 'PT-101'; }
  _log(t, level, text) { const e = { t, level, text }; this.logs.push(e); if (this.gw.onLog) this.gw.onLog(e); }
  step(t, dt, meas) {
    const n = meas.pumps.length, fb = this.fb;
    if (this.inhibit) return { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: false, drain_open: false };
    if (!this.enabled) {
      if ((fb.io_safe_state ?? 'off') === 'off' && t - this.t0 >= fb.io_timeout_s) {
        if (!this.io_off) { this.io_off = true; this._log(t, 'safety', `Mô-đun I/O mất truyền thông ${fb.io_timeout_s.toFixed(0)} s – đưa lệnh chạy về 0: bơm dừng (không có mạch dự phòng PID)`); }
        return { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: this.hold.outlet_open, drain_open: false };
      }
      return this.hold;
    }
    if (t - this.t0 < fb.watchdog_s) return this.hold;
    // MV-02 giữ vị trí (đang đóng) → liên động cứng "MV-02 không mở hết thì cấm chạy" vẫn hiệu lực
    if (!this.hold.outlet_open) return { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: false, drain_open: false };
    const pumps = meas.pumps;
    if (!this.active) {
      this.active = true; this.p_set = fb.p_set_bar;
      this._log(t, 'safety', `Rơ-le watchdog nhả sau ${fb.watchdog_s.toFixed(0)} s – biến tần ${this.tags[this.duty]} chuyển PID nội giữ ${fb.p_set_bar.toFixed(1)} bar theo ${this._pt(this.duty)}, bơm còn lại dừng`);
    }
    const other = 1 - this.duty;
    if (pumps[this.duty].fault && !pumps[other].fault) {
      this._log(t, 'safety', `Biến tần ${this.tags[this.duty]} lỗi – rơ-le KA-FB chuyển PID dự phòng sang ${this.tags[other]}`);
      this.duty = other; this.I = this.f_min;
    }
    const p = meas[this._pt(this.duty)];
    let f;
    if (p === null || p === undefined) f = 40.0;
    else {
      const e = fb.p_set_bar - p, kp = fb.kp_hz_per_bar;
      const u = this.I + kp * e;
      if (!((u >= this.f_max && e > 0) || (u <= this.f_min && e < 0))) this.I += kp * dt / fb.ti_s * e;
      this.I = clamp(this.I, this.f_min, this.f_max);
      f = clamp(this.I + kp * e, this.f_min, this.f_max);
    }
    const run = pumps.map((pp, i) => i === this.duty && !pp.fault);
    return { run, f_ref: run.map((r) => (r ? f : 0.0)), outlet_open: this.hold.outlet_open, drain_open: false };
  }
}
