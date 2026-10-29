// Chỉ số so sánh – tương đương kpi.py
export const INCIDENT_CODES = {
  pump_fault: ['PUMP_FAULT'], 'inflow_quality:ntu': ['NTU_'], 'inflow_quality:cl': ['CL_'], 'inflow_quality:ph': ['PH_'],
  supply: ['SUPPLY_LOST', 'LEVEL_LOW', 'TTE_LOW', 'LEVEL_STOP', 'LEVEL_LL'], burst: ['FLOW_ANOMALY', 'BURST_SUSPECT', 'P_LOW'],
  sensor_fault: ['PT_DEVIATION', 'PT_STUCK', 'SENSOR_FAULT', 'SENSOR_RANGE', 'P_HIGH'],
};

export class KpiTracker {
  constructor(cfg) {
    this.svc = cfg.service; this.ql = cfg.quality_limits;
    this.energy_kwh = 0; this.pumped_m3 = 0; this.delivered_m3 = 0; this.served_m3 = 0; this.consumption_m3 = 0; this.leak_m3 = 0; this.burst_m3 = 0;
    this.t_total = 0; this.t_low = 0; this.t_high = 0; this.t_out = 0; this.viol_s = 0; this.viol_m3 = 0; this.viol_episodes = 0;
    this.in_episode = false; this.last_bad = -1e9; this.p_max = -1e9; this.p_min = 1e9; this.p_crit_min = 1e9; this.p_sum = 0; this.incidents = [];
  }
  update(t, dt, pl) {
    const dtH = dt / 3600.0;
    this.energy_kwh += pl.kw * dtH; this.pumped_m3 += pl.q_pumps * dtH; this.delivered_m3 += pl.q_out * dtH; this.served_m3 += pl.q_served * dtH;
    this.consumption_m3 += pl.q_cons * dtH; this.leak_m3 += pl.q_leak * dtH; this.burst_m3 += pl.q_burst * dtH; this.t_total += dt;
    const low = pl.p_crit < this.svc.p_crit_min_bar; const high = pl.p_net > this.svc.p_out_max_bar;
    if (low) this.t_low += dt;
    if (high) this.t_high += dt;
    if (low || high) this.t_out += dt;
    if (pl.p_net > this.p_max) this.p_max = pl.p_net;
    if (pl.p_net < this.p_min) this.p_min = pl.p_net;
    if (pl.p_crit < this.p_crit_min) this.p_crit_min = pl.p_crit;
    this.p_sum += pl.p_net * dt;
    const ql = this.ql;
    const bad = pl.cl < ql.cl_min || pl.cl > ql.cl_max || pl.ntu > ql.ntu_max || pl.ph < ql.ph_min || pl.ph > ql.ph_max;
    const delivering = pl.q_out > this.svc.delivering_min_m3h && pl.outlet_frac > 0.0;
    if (bad && delivering) {
      this.viol_s += dt; this.viol_m3 += pl.q_out * dtH;
      if (!this.in_episode) { this.viol_episodes += 1; this.in_episode = true; }
      this.last_bad = t;
    } else if (this.in_episode && t - this.last_bad > 600.0) this.in_episode = false;
  }
  addIncident(kind, t, label) { this.incidents.push({ kind, t, label, detected: null, how: null }); }
  detectCodes(t, code) {
    for (const inc of this.incidents) {
      if (inc.detected === null && t >= inc.t) {
        for (const prefix of INCIDENT_CODES[inc.kind] ?? []) if (code.startsWith(prefix)) { inc.detected = t; inc.how = code; break; }
      }
    }
  }
  detectKind(t, kind, how) {
    for (const inc of this.incidents) if (inc.detected === null && t >= inc.t && inc.kind === kind) { inc.detected = t; inc.how = how; }
  }
  detectManual(t, found) {
    for (const inc of this.incidents) if (inc.detected === null && t >= inc.t && found.has(inc.kind)) { inc.detected = t; inc.how = 'công nhân kiểm tra'; }
  }
  summary(pl) {
    const hours = this.t_total ? this.t_total / 3600.0 : 1.0;
    return {
      hours, energy_kwh: this.energy_kwh, kwh_per_day: this.energy_kwh / hours * 24.0,
      specific_kwh_m3: this.delivered_m3 > 0 ? this.energy_kwh / this.delivered_m3 : null,
      pumped_m3: this.pumped_m3, delivered_m3: this.delivered_m3, served_m3: this.served_m3, consumption_m3: this.consumption_m3,
      leak_m3: this.leak_m3, burst_m3: this.burst_m3, unserved_m3: pl.unserved_m3, backlog_end_m3: pl.backlog,
      t_low_min: this.t_low / 60.0, t_high_min: this.t_high / 60.0, t_out_min: this.t_out / 60.0,
      pct_in_band: this.t_total ? 100.0 * (1.0 - this.t_out / this.t_total) : 100.0,
      p_out_max: this.p_max, p_out_min: this.p_min, p_out_avg: this.t_total ? this.p_sum / this.t_total : 0, p_crit_min: this.p_crit_min,
      quality_episodes: this.viol_episodes, quality_viol_min: this.viol_s / 60.0, quality_viol_m3: this.viol_m3,
      starts: pl.pumps.map((p) => p.starts), starts_total: pl.pumps.reduce((a, p) => a + p.starts, 0),
      run_h: pl.pumps.map((p) => p.run_s / 3600.0), dry_run_min: pl.pumps.reduce((a, p) => a + p.dry_run_s, 0) / 60.0,
      level_min: null, incidents: this.incidents.map((i) => ({ ...i })),
    };
  }
}
