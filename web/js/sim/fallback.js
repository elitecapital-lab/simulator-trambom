// Trạm khi mini PC (edge gateway) ngừng hoạt động: rơ-le watchdog + PID nội biến tần – tương đương trambom/fallback.py
import { clamp } from './util.js';

export class GatewayFallback {
  constructor(cfg, gw, plant, t0) {
    this.fb = cfg.fallback; this.enabled = cfg.hardware?.VFD_PID_fallback ?? true;
    this.f_min = cfg.pump_model.f_min_hz; this.f_max = cfg.pump_model.f_max_hz;
    this.t0 = t0; this.logs = gw.logs; this.gw = gw; this.tags = gw.pump_tags;
    const n = plant.pumps.length;
    const last = gw.out ?? { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: true };
    this.hold = { run: [...last.run], f_ref: [...last.f_ref], outlet_open: last.outlet_open, drain_open: false };
    this.inhibit = gw.safety.safe_stop || gw.safety.lockout;
    let duty = gw.ctrl.duty;
    if (plant.pumps[duty].fault) duty = 1 - duty;
    this.duty = duty;
    const pu = plant.pumps[duty];
    this.I = pu.running ? pu.f : this.f_min;
    this.active = false; this.p_set = null;
  }
  note() {
    if (this.inhibit) return 'trạm giữ trạng thái dừng an toàn đã chốt';
    if (this.enabled) return `biến tần ${this.tags[this.duty]} chạy PID nội giữ ${this.fb.p_set_bar.toFixed(1)} bar`;
    return 'không có dự phòng, mô-đun I/O giữ nguyên lệnh cuối';
  }
  step(t, dt, meas) {
    const n = meas.pumps.length;
    if (this.inhibit) return { run: new Array(n).fill(false), f_ref: new Array(n).fill(0), outlet_open: false, drain_open: false };
    if (!this.enabled || t - this.t0 < this.fb.watchdog_s) return this.hold;
    const fb = this.fb;
    if (!this.active) {
      this.active = true; this.p_set = fb.p_set_bar;
      const e = { t, level: 'safety', text: `Rơ-le watchdog nhả sau ${fb.watchdog_s.toFixed(0)} s – biến tần ${this.tags[this.duty]} chuyển PID nội giữ ${fb.p_set_bar.toFixed(1)} bar theo PT-101, bơm còn lại dừng` };
      this.logs.push(e); if (this.gw.onLog) this.gw.onLog(e);
    }
    const p = meas['PT-101'];
    let f;
    if (p === null || p === undefined) f = 40.0;
    else {
      const e = fb.p_set_bar - p, kp = fb.kp_hz_per_bar;
      const u = this.I + kp * e;
      if (!((u >= this.f_max && e > 0) || (u <= this.f_min && e < 0))) this.I += kp * dt / fb.ti_s * e;
      this.I = clamp(this.I, this.f_min, this.f_max);
      f = clamp(this.I + kp * e, this.f_min, this.f_max);
    }
    const run = meas.pumps.map((pp, i) => i === this.duty && !pp.fault);
    return { run, f_ref: run.map((r) => (r ? f : 0.0)), outlet_open: true, drain_open: false };
  }
}
