// Mô hình cảm biến – tương đương sensors.py
import { stream } from './rng.js';

export const TAG_SOURCE = { 'PT-101': 'p', 'PT-102': 'p', 'FT-101': 'q_out', 'FT-100': 'q_in', 'LT-101': 'level', 'AIT-201': 'cl', 'AIT-202': 'ntu', 'AIT-203': 'ph' };
export const TAG_ORDER = ['PT-101', 'PT-102', 'FT-101', 'FT-100', 'LT-101', 'AIT-201', 'AIT-202', 'AIT-203'];

// Các cảm biến thực sự được lắp theo tùy chọn cfg.hardware (mặc định: lắp đủ)
export function installedTags(cfg) {
  const hw = cfg.hardware ?? {};
  const out = new Set(TAG_ORDER);
  if (hw['PT-102'] === false) out.delete('PT-102');
  if (hw['FT-100_pulse'] === false) out.delete('FT-100');
  for (const t of ['AIT-201', 'AIT-202', 'AIT-203']) if (hw[t] === false) out.delete(t);
  return out;
}

export class AnalogSensor {
  constructor(tag, spec) {
    this.tag = tag; this.lo = spec.lo; this.hi = spec.hi; this.sd = spec.sd; this.tau = spec.tau_s;
    this.cutoff = spec.cutoff ?? null; this.y = null; this.fault = null; this.fault_value = 0; this.fault_t0 = 0; this.value = null;
  }
  setFault(mode, value, t) { this.fault = mode; this.fault_value = value; this.fault_t0 = t; }
  clearFault() { this.fault = null; }
  read(x, dt, t, z) {
    if (this.y === null || this.tau <= 0.0) this.y = x;
    else this.y += (x - this.y) * (1.0 - Math.exp(-dt / this.tau));
    let sd = this.sd;
    let v = this.y;
    const f = this.fault;
    if (f === 'noisy') sd *= this.fault_value;
    v += sd * z;
    if (f === 'bias') v += this.fault_value;
    else if (f === 'drift') v += this.fault_value * (t - this.fault_t0) / 3600.0;
    else if (f === 'stuck') v = this.fault_value;
    else if (f === 'dead') { this.value = null; return null; }
    if (this.cutoff !== null && v < this.cutoff) v = 0.0;
    const span = this.hi - this.lo;
    const lo = this.lo - 0.0125 * span; const hi = this.hi + 0.031 * span;
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    this.value = v;
    return v;
  }
}

export class SensorSet {
  constructor(cfg, station = {}, seed = null) {
    seed = seed ?? cfg.sim.seed;
    this.rng = stream(seed + (station.seed_offset ?? 0), 2);
    this.sensors = {};
    for (const tag of TAG_ORDER) this.sensors[tag] = new AnalogSensor(tag, cfg.sensors[tag]);
    this.installed = installedTags(cfg);
    this.lsll_trip = cfg.safety.float_lsll_m; this.lsll_reset = cfg.safety.float_lsll_reset_m; this.lsll = false;
  }
  read(plant, dt, t) {
    const meas = {};
    const src = { p: plant.p, q_out: plant.q_out, q_in: plant.q_in, level: plant.level, cl: plant.cl, ntu: plant.ntu, ph: plant.ph };
    for (const tag of TAG_ORDER) {
      const z = this.rng.gauss(); // luôn rút số ngẫu nhiên để các phương án lắp đặt dùng chung chuỗi nhiễu
      const v = this.sensors[tag].read(src[TAG_SOURCE[tag]], dt, t, z);
      meas[tag] = this.installed.has(tag) ? v : null;
    }
    if (!this.lsll && plant.level < this.lsll_trip) this.lsll = true;
    else if (this.lsll && plant.level > this.lsll_reset) this.lsll = false;
    meas['LSLL-101'] = this.lsll;
    meas.pumps = plant.pumps.map((pu) => ({ running: pu.running, f: pu.f, fault: pu.fault, kw: pu.kw, amps: pu.amps, run_s: pu.run_s, starts: pu.starts }));
    meas.kw = plant.kw;
    meas.kwh = plant.pumps[0].energy_kwh + plant.pumps[1].energy_kwh;
    meas.outlet_frac = plant.outlet_frac;
    meas.drain_open = plant.drain_open;
    return meas;
  }
  setFault(tag, mode, value, t) { this.sensors[tag].setFault(mode, value, t); }
  clearFault(tag) { this.sensors[tag].clearFault(); }
}
