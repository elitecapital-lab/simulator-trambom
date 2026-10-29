// Phương án so sánh: vận hành thủ công theo lịch cố định – tương đương baseline.py
export class FixedSchedule {
  constructor(cfg) { this.b = cfg.baseline; this.n_pumps = cfg.pumps.length; this.known_fault = new Array(this.n_pumps).fill(false); this.rounds_done = new Set(); this.observations = []; }
  nRequired(t) {
    const hour = (t % 86400) / 3600.0;
    let n = 0;
    for (const w of this.b.windows) if (w.start_h <= hour && hour < w.end_h) n = Math.max(n, w.pumps);
    return n;
  }
  operatorRound(t, plant) {
    const day = Math.floor(t / 86400); const hour = (t % 86400) / 3600.0;
    for (let i = 0; i < this.b.operator_rounds_h.length; i++) {
      const key = day + ':' + i;
      if (hour >= this.b.operator_rounds_h[i] && !this.rounds_done.has(key)) {
        this.rounds_done.add(key);
        const found = [];
        plant.pumps.forEach((pu, k) => {
          if (pu.fault && !this.known_fault[k]) { this.known_fault[k] = true; found.push('pump_fault'); }
          if (!pu.fault && this.known_fault[k]) this.known_fault[k] = false;
        });
        if (plant.level < 1.2) found.push('supply');
        this.observations.push({ t, found });
        return found;
      }
    }
    return [];
  }
  step(t, dt, plant) {
    const found = this.operatorRound(t, plant);
    const n = this.nRequired(t);
    const day = Math.floor(t / 86400);
    const duty = this.b.alternate_daily ? day % 2 : 0;
    let order = [duty];
    for (let i = 0; i < this.n_pumps; i++) if (i !== duty) order.push(i);
    order = order.filter((i) => !this.known_fault[i]).concat(order.filter((i) => this.known_fault[i]));
    const run = new Array(this.n_pumps).fill(false);
    for (const i of order.slice(0, n)) run[i] = true;
    return { run, f_ref: run.map((r) => (r ? this.b.freq_hz : 0.0)), outlet_open: true, drain_open: false, found };
  }
}
