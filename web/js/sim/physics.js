// Mô hình vật lý trạm bơm – tương đương trambom/physics.py (xem chú thích phương trình ở bản Python)
import { clamp } from './util.js';

export class PumpUnit {
  constructor(tag, pm) {
    this.tag = tag; this.pm = pm;
    this.cmd_run = false; this.f_ref = 0; this.f = 0; this.running = false; this.fault = false; this.throttle_k = 0;
    this.starts = 0; this.run_s = 0; this.energy_kwh = 0; this.dry_run_s = 0;
    this.q = 0; this.h = 0; this.kw = 0; this.amps = 0; this.gauge = 0;
  }
  updateDrive(dt) {
    const pm = this.pm;
    const want = this.cmd_run && !this.fault;
    if (want) {
      if (!this.running) { this.running = true; this.starts += 1; }
      const target = clamp(this.f_ref, pm.f_min_hz, pm.f_max_hz);
      const step = pm.ramp_hz_s * dt;
      this.f = this.f < target ? Math.min(target, this.f + step) : Math.max(target, this.f - step);
    } else if (this.running) {
      const rate = this.fault ? 10.0 : pm.ramp_hz_s;
      this.f = Math.max(0.0, this.f - rate * dt);
      if (this.f <= 0.0) this.running = false;
    }
  }
}

export class Plant {
  constructor(cfg, station = {}) {
    this.cfg = cfg;
    this.rho = cfg.constants.rho; this.g = cfg.constants.g;
    this.m_per_bar = 1.0e5 / (this.rho * this.g);
    this.tank = cfg.tank; this.inlet = cfg.inlet; this.pm = cfg.pump_model; this.ht = cfg.hydro_tank; this.rv = cfg.relief_valve;
    this.net = { ...cfg.network };
    if (station.dz_crit_m !== undefined) this.net.dz_crit_m = station.dz_crit_m;
    this.dz_bar = this.net.dz_crit_m / this.m_per_bar;
    this.qual = cfg.quality;
    this.pumps = cfg.pumps.map((tag) => new PumpUnit(tag, this.pm));
    this.level = this.tank.level_init_m; this.p = 2.2; this.p_net = 2.2; this.backlog = 0;
    this.cl = this.qual.cl_init_mgl; this.ntu = this.qual.ntu_init; this.ph = this.qual.ph_init;
    this.outlet_cmd = true; this.outlet_frac = 1.0; this.drain_open = false; this.inlet_enabled = true; this.q_prev = 0;
    this.q_in = 0; this.q_out = 0; this.q_req = 0; this.q_served = 0; this.q_leak = 0; this.q_burst = 0; this.q_relief = 0;
    this.q_drain = 0; this.q_pumps = 0; this.p_crit = 0; this.kw = 0; this.unserved_m3 = 0; this.overflow_m3 = 0; this.q_cons = 0;
    this.newton_iters = 0;
  }
  storage(p) {
    let v = this.ht.c_pipe_m3_per_bar * p;
    const p0 = this.ht.precharge_bar;
    if (p > p0) v += this.ht.volume_m3 * (1.0 - (p0 + 1.0) / (p + 1.0));
    return v;
  }
  storageDeriv(p) {
    let d = this.ht.c_pipe_m3_per_bar;
    const p0 = this.ht.precharge_bar;
    if (p > p0) d += this.ht.volume_m3 * (p0 + 1.0) / ((p + 1.0) * (p + 1.0));
    return d;
  }
  htWaterL() {
    const p0 = this.ht.precharge_bar;
    return this.p <= p0 ? 0 : 1000 * this.ht.volume_m3 * (1 - (p0 + 1) / (this.p + 1));
  }
  suctionPsi() {
    const lv = this.tank.vortex_level_m; const la = this.tank.air_level_m;
    if (this.level >= lv) return 1.0;
    return clamp((this.level - la) / (lv - la), 0.0, 1.0);
  }
  volume() { return this.level * this.tank.area_m2; }

  step(dt, dist) {
    const pm = this.pm; const net = this.net; const mpb = this.m_per_bar; const dtH = dt / 3600.0;
    for (const pu of this.pumps) pu.updateDrive(dt);
    const travel = this.cfg.outlet_valve.travel_s;
    const target = this.outlet_cmd ? 1.0 : 0.0;
    if (this.outlet_frac < target) this.outlet_frac = Math.min(target, this.outlet_frac + dt / travel);
    else if (this.outlet_frac > target) this.outlet_frac = Math.max(target, this.outlet_frac - dt / travel);
    const vfrac = this.outlet_frac;
    this.q_cons = dist.q_cons;
    const refill = Math.min(net.rooftop_refill_max_m3h, this.backlog / net.rooftop_tau_h);
    const qReq = this.q_cons + refill;
    this.q_req = qReq;
    const qbNom = dist.q_burst;
    const psi = this.suctionPsi();
    const hSuc = this.level + this.tank.z_suction_m;
    const h0 = pm.h0_m; const kk = pm.k_m_per_m3h2;
    const loss = net.r_bar_per_m3h2 * this.q_prev * this.q_prev;
    const dz = this.dz_bar; const pZero = net.p_zero_bar; const pFull = net.p_full_bar;
    const leakC = net.leak_c; const n1 = net.leak_n1; const rvSet = this.rv.set_bar; const rvK = this.rv.k_m3h_per_bar;
    const active = [];
    for (const pu of this.pumps) {
      if (pu.running && pu.f > 0.0) { const s = pu.f / pm.f_rated_hz; active.push([psi * h0 * s * s, kk + pu.throttle_k]); }
    }
    const sOld = this.storage(this.p);
    const residual = (p) => {
      let qp = 0, dqp = 0;
      const hReq = p * mpb - hSuc;
      for (const [hav, kt] of active) {
        const dh = hav - hReq;
        if (dh > 0.0) { const q = Math.sqrt(dh / kt); qp += q; dqp += mpb / (2.0 * kt * Math.max(q, 0.05)); }
      }
      let qo = 0, dqo = 0;
      if (vfrac > 0.0) {
        const pc = p - dz - loss;
        let qd, dqd;
        if (pc <= pZero) { qd = 0; dqd = 0; }
        else if (pc >= pFull) { qd = qReq; dqd = 0; }
        else {
          const r = (pc - pZero) / (pFull - pZero); const sq = Math.sqrt(r);
          qd = qReq * sq; dqd = qReq * 0.5 / (Math.max(sq, 0.02) * (pFull - pZero));
        }
        let pa, dpa;
        if (pc > 0.0) { pa = 0.5 * (p + pc); dpa = 1.0; } else { pa = 0.5 * p; dpa = 0.5; }
        let ql = 0, dql = 0, qbb = 0, dqb = 0;
        if (pa > 0.0) {
          ql = leakC * Math.pow(pa, n1);
          dql = leakC * n1 * Math.pow(Math.max(pa, 0.01), n1 - 1.0) * dpa;
          qbb = qbNom * Math.sqrt(pa / 2.0);
          dqb = qbNom > 0 ? qbNom * 0.25 / Math.sqrt(2.0 * Math.max(pa, 0.01) / 2.0) * dpa : 0.0;
        }
        qo = vfrac * (qd + ql + qbb); dqo = vfrac * (dqd + dql + dqb);
      }
      let qr = 0, dqr = 0;
      if (p > rvSet) { qr = rvK * (p - rvSet); dqr = rvK; }
      return [this.storage(p) - sOld - dtH * (qp - qo - qr), this.storageDeriv(p) + dtH * (dqp + dqo + dqr)];
    };
    let lo = -0.9, hi = 12.0, p = this.p, it = 0;
    while (it < 60) {
      it += 1;
      const [g, gp] = residual(p);
      if (Math.abs(g) < 1e-11) break;
      if (g > 0.0) hi = p; else lo = p;
      let pn = p - g / gp;
      if (!(lo < pn && pn < hi)) pn = 0.5 * (lo + hi);
      if (Math.abs(pn - p) < 1e-10) { p = pn; break; }
      p = pn;
    }
    this.newton_iters = it;
    this.p = p;

    const hReq = p * mpb - hSuc;
    let qPumps = 0;
    for (const pu of this.pumps) {
      if (pu.running && pu.f > 0.0) {
        const s = pu.f / pm.f_rated_hz;
        const hav = psi * h0 * s * s;
        const kt = kk + pu.throttle_k;
        const dh = hav - hReq;
        const q = dh > 0.0 ? Math.sqrt(dh / kt) : 0.0;
        pu.q = q;
        pu.h = Math.max(0.0, hav - kk * q * q);
        const x = clamp(q / (s * pm.q_bep_m3h), 0.0, 1.8);
        const pShaft = this.rho * this.g * pu.h * s * (pm.q_bep_m3h / 3600.0) / (pm.eta_max * (2.0 - x));
        pu.kw = pShaft / pm.eta_motor_vfd / 1000.0 + pm.standby_w / 1000.0;
        pu.run_s += dt;
        if (this.level < this.tank.vortex_level_m) pu.dry_run_s += dt;
        pu.gauge = (pu.h - pu.throttle_k * q * q + hSuc) / mpb;
        qPumps += q;
      } else {
        pu.q = 0; pu.h = 0; pu.kw = pm.standby_w / 1000.0; pu.gauge = hSuc / mpb;
      }
      pu.amps = pu.kw * 1000.0 / (Math.sqrt(3.0) * pm.voltage_v * pm.cos_phi);
      pu.energy_kwh += pu.kw * dtH;
    }
    this.q_pumps = qPumps;
    let qd = 0, ql = 0, qbb = 0;
    if (vfrac > 0.0) {
      const pc = p - dz - loss;
      if (pc <= pZero) qd = 0;
      else if (pc >= pFull) qd = qReq;
      else qd = qReq * Math.sqrt((pc - pZero) / (pFull - pZero));
      let pa = pc > 0.0 ? 0.5 * (p + pc) : 0.5 * p;
      pa = Math.max(pa, 0.0);
      ql = pa > 0 ? leakC * Math.pow(pa, n1) : 0;
      qbb = pa > 0 ? qbNom * Math.sqrt(pa / 2.0) : 0;
    }
    this.q_served = vfrac * qd; this.q_leak = vfrac * ql; this.q_burst = vfrac * qbb;
    this.q_out = this.q_served + this.q_leak + this.q_burst;
    this.q_relief = p > rvSet ? rvK * (p - rvSet) : 0.0;
    this.q_prev = this.q_out;
    if (vfrac >= 0.999) this.p_net = p;
    else { const a = 1.0 - Math.exp(-dt / net.net_decay_s); this.p_net += (vfrac * p - this.p_net) * a; }
    this.p_crit = this.p_net - dz - net.r_bar_per_m3h2 * this.q_out * this.q_out;

    const A = this.tank.area_m2;
    const fracIn = clamp((this.inlet.float_close_m - this.level) / this.inlet.float_band_m, 0.0, 1.0);
    this.q_in = this.inlet_enabled ? this.inlet.q_max_m3h * dist.supply * fracIn : 0.0;
    this.q_drain = this.drain_open && this.level > 0.05 ? this.tank.drain_q_m3h : 0.0;
    const dv = (this.q_in + this.q_relief - qPumps - this.q_drain) * dtH;
    this.level += dv / A;
    if (this.level > this.tank.overflow_m) { this.overflow_m3 += (this.level - this.tank.overflow_m) * A; this.level = this.tank.overflow_m; }
    if (this.level < 0.0) this.level = 0.0;
    const vol = A * Math.max(this.level, 0.1);
    const aIn = this.q_in / 3600.0 / vol;
    const kb = this.qual.cl_decay_per_day / 86400.0;
    const ks = this.qual.ntu_settle_per_h / 3600.0;
    let ent = 0.0;
    const el = this.qual.entrain_level_m;
    if (qPumps > 0.0 && this.level < el) ent = this.qual.entrain_ntu_per_h / 3600.0 * (el - this.level) / el * Math.min(1.0, qPumps / 30.0);
    this.cl += dt * (aIn * (dist.cl_in - this.cl) - kb * this.cl);
    this.ntu += dt * (aIn * (dist.ntu_in - this.ntu) - ks * (this.ntu - this.qual.ntu_floor) + ent);
    this.ph += dt * aIn * (dist.ph_in - this.ph);
    this.backlog += (this.q_cons - this.q_served) * dtH;
    if (this.backlog < 0.0) this.backlog = 0.0;
    const cap = net.rooftop_capacity_m3;
    if (this.backlog > cap) { this.unserved_m3 += this.backlog - cap; this.backlog = cap; }
    this.kw = this.pumps.reduce((a, pu) => a + pu.kw, 0);
  }
}
