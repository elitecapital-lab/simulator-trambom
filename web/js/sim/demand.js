// Nhiễu ngoại sinh: nhu cầu, nguồn cấp, chất lượng nước nguồn, vỡ ống – tương đương demand.py
import { stream } from './rng.js';
import { round3 } from './util.js';

const normalize = (p) => { const m = p.reduce((a, b) => a + b, 0) / p.length; return p.map((v) => v / m); };

export class Disturbances {
  constructor(cfg, station = {}, seed = null) {
    this.cfg = cfg;
    const d = cfg.demand;
    this.mean = d.mean_m3h * (station.demand_scale ?? 1.0);
    this.weekday = normalize(d.weekday);
    this.weekend = normalize(d.weekend);
    this.weekend_scale = d.weekend_scale;
    this.day_sigma = d.day_sigma;
    this.noise_sigma = d.noise_sigma;
    this.noise_tau = d.noise_tau_s;
    this.start_dow = cfg.sim.start_dow;
    seed = seed ?? cfg.sim.seed;
    this.rng = stream(seed + (station.seed_offset ?? 0), 1);
    this.supply_hourly = cfg.inlet.supply_factor_hourly;
    const q = cfg.quality;
    this.base_quality = { cl: q.cl_in_mgl, ntu: q.ntu_in, ph: q.ph_in };
    this.ar = 0.0;
    this.day_index = -1;
    this.day_factor = 1.0;
    this.overrides = [];
    this.last = {};
  }
  applyEvent(ev, t) {
    const tEnd = ev.until_h !== undefined && ev.until_h !== null ? ev.until_h * 3600 : 1e18;
    const map = { inflow_quality: 'q_' + ev.param, supply: 'supply', burst: 'burst', demand_scale: 'demand' };
    const val = { inflow_quality: ev.value, supply: ev.factor, burst: ev.q_m3h, demand_scale: ev.factor }[ev.type];
    if (map[ev.type]) this.overrides.push({ kind: map[ev.type], value: val, t_end: tEnd });
  }
  clearOverride(kind) { this.overrides = this.overrides.filter((o) => o.kind !== kind); }
  _override(kind, t, def) {
    let val = def;
    for (const o of this.overrides) if (o.kind === kind && t < o.t_end) val = o.value;
    return val;
  }
  profileMult(t) {
    const day = Math.floor(t / 86400);
    const dow = (this.start_dow + day) % 7;
    const weekend = dow >= 5;
    const pat = weekend ? this.weekend : this.weekday;
    const x = (t % 86400) / 3600 - 0.5;
    const i0 = Math.floor(x);
    const frac = x - i0;
    const a = pat[(i0 + 24) % 24];
    const b = pat[(i0 + 25) % 24];
    return (a + (b - a) * frac) * (weekend ? this.weekend_scale : 1.0);
  }
  step(t, dt) {
    const day = Math.floor(t / 86400);
    while (this.day_index < day) {
      this.day_index += 1;
      this.day_factor = 1.0 + this.day_sigma * this.rng.gauss();
    }
    const phi = Math.exp(-dt / this.noise_tau);
    this.ar = phi * this.ar + Math.sqrt(1.0 - phi * phi) * this.noise_sigma * this.rng.gauss();
    const hour = Math.floor((t % 86400) / 3600);
    let qc = this.mean * this.profileMult(t) * this.day_factor * Math.max(0.0, 1.0 + this.ar);
    qc *= this._override('demand', t, 1.0);
    const out = {
      q_cons: qc,
      supply: this.supply_hourly[hour] * this._override('supply', t, 1.0),
      cl_in: this._override('q_cl', t, this.base_quality.cl),
      ntu_in: this._override('q_ntu', t, this.base_quality.ntu),
      ph_in: this._override('q_ph', t, this.base_quality.ph),
      q_burst: this._override('burst', t, 0.0),
    };
    this.last = out;
    return out;
  }
  expectedProfile(leak = 1.6) {
    const prof = [];
    for (let h = 0; h < 168; h++) {
      const dow = Math.floor(h / 24);
      const hr = h % 24;
      const pat = dow >= 5 ? this.weekend : this.weekday;
      const sc = dow >= 5 ? this.weekend_scale : 1.0;
      prof.push(round3(this.mean * pat[hr] * sc + leak));
    }
    return prof;
  }
}
