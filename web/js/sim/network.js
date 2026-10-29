// Tích hợp mạng lưới: nhiều trạm cùng báo về một máy chủ – tương đương network.py (thêm tiện ích cho giao diện)
import { StationSim, dispatchEvent } from './engine.js';
import { OperationsServer } from './server.js';

export class NetworkSim {
  constructor(cfg, level = 'basic', { withFixed = 'all', events = [], dt = null, customFn = null } = {}) {
    this.cfg = cfg; this.level = level;
    this.server = new OperationsServer(cfg);
    this.smart = cfg.stations.map((st, i) => new StationSim(cfg, 'smart', st, level, this.server, i === 0 ? customFn : null, null, dt));
    this.fixed = cfg.stations.map((st, i) => (withFixed === 'all' || (withFixed === 'first' && i === 0) ? new StationSim(cfg, 'fixed', st, level, null, null, null, dt) : null));
    this.by_id = Object.fromEntries(this.smart.map((s, i) => [s.sid, i]));
    this.events = [...events].sort((a, b) => a.t_h - b.t_h);
    this.ev_idx = 0; this.t = 0; this.dt = this.smart[0].dt;
    this.onEvent = null;
  }
  applyEvent(ev, t = this.t) {
    const i = this.by_id[ev.station ?? 'ST-01'] ?? 0;
    dispatchEvent(ev, t, this.smart[i], this.fixed[i], this.server);
    if (this.onEvent) this.onEvent(ev, t);
  }
  step() {
    const t = this.t;
    while (this.ev_idx < this.events.length && this.events[this.ev_idx].t_h * 3600.0 <= t + 1e-9) this.applyEvent(this.events[this.ev_idx++], t);
    for (const s of this.smart) s.step();
    for (const s of this.fixed) if (s) s.step();
    this.server.step(t);
    for (const s of this.smart) if (s.gw_dead && !s.gw_dead.restarted && !this.server.stations[s.sid].online) s.kpi.detectKind(t, 'gateway_fail', 'máy chủ mất nhịp tim (LWT)');
    this.t = this.smart[0].t;
  }
  totals() {
    let sk = 0, fk = 0, sm = 0, sl = 0, fm = 0, fl = 0;
    this.smart.forEach((s, i) => {
      sk += s.kpi.energy_kwh; sm += s.kpi.delivered_m3; sl += s.kpi.leak_m3;
      const f = this.fixed[i];
      if (f) { fk += f.kpi.energy_kwh; fm += f.kpi.delivered_m3; fl += f.kpi.leak_m3; }
    });
    return { smart_kwh: sk, fixed_kwh: fk, smart_m3: sm, fixed_m3: fm, smart_leak: sl, fixed_leak: fl,
      smart_nrw_pct: sm ? 100 * sl / sm : 0, fixed_nrw_pct: fm ? 100 * fl / fm : 0 };
  }
}
