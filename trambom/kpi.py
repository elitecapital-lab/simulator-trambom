"""Chỉ số so sánh: điện năng, chất lượng dịch vụ (áp lực), chất lượng nước, tuổi thọ thiết bị."""

INCIDENT_CODES = {
    "pump_fault": ["PUMP_FAULT"],
    "inflow_quality:ntu": ["NTU_"],
    "inflow_quality:cl": ["CL_"],
    "inflow_quality:ph": ["PH_"],
    "supply": ["SUPPLY_LOST", "LEVEL_LOW", "TTE_LOW", "LEVEL_STOP", "LEVEL_LL"],
    "burst": ["FLOW_ANOMALY", "BURST_SUSPECT", "P_LOW"],
    "sensor_fault": ["PT_DEVIATION", "PT_STUCK", "SENSOR_FAULT", "SENSOR_RANGE", "P_HIGH"],
}
MANUAL_DETECTABLE = {"pump_fault", "supply"}


class KpiTracker:
    def __init__(self, cfg):
        self.svc = cfg["service"]
        self.ql = cfg["quality_limits"]
        self.energy_kwh = 0.0
        self.pumped_m3 = 0.0
        self.delivered_m3 = 0.0
        self.served_m3 = 0.0
        self.consumption_m3 = 0.0
        self.leak_m3 = 0.0
        self.burst_m3 = 0.0
        self.t_total = 0.0
        self.t_low = 0.0
        self.t_high = 0.0
        self.t_out = 0.0
        self.viol_s = 0.0
        self.viol_m3 = 0.0
        self.viol_episodes = 0
        self.in_episode = False
        self.last_bad = -1e9
        self.p_max = -1e9
        self.p_min = 1e9
        self.p_crit_min = 1e9
        self.p_sum = 0.0
        self.incidents = []

    def update(self, t, dt, pl):
        dt_h = dt / 3600.0
        self.energy_kwh += pl.kw * dt_h
        self.pumped_m3 += pl.q_pumps * dt_h
        self.delivered_m3 += pl.q_out * dt_h
        self.served_m3 += pl.q_served * dt_h
        self.consumption_m3 += pl.q_cons * dt_h
        self.leak_m3 += pl.q_leak * dt_h
        self.burst_m3 += pl.q_burst * dt_h
        self.t_total += dt
        low = pl.p_crit < self.svc["p_crit_min_bar"]
        high = pl.p_net > self.svc["p_out_max_bar"]
        if low:
            self.t_low += dt
        if high:
            self.t_high += dt
        if low or high:
            self.t_out += dt
        if pl.p_net > self.p_max:
            self.p_max = pl.p_net
        if pl.p_net < self.p_min:
            self.p_min = pl.p_net
        if pl.p_crit < self.p_crit_min:
            self.p_crit_min = pl.p_crit
        self.p_sum += pl.p_net * dt
        ql = self.ql
        bad = pl.cl < ql["cl_min"] or pl.cl > ql["cl_max"] or pl.ntu > ql["ntu_max"] or pl.ph < ql["ph_min"] or pl.ph > ql["ph_max"]
        delivering = pl.q_out > self.svc["delivering_min_m3h"] and pl.outlet_frac > 0.0
        if bad and delivering:
            self.viol_s += dt
            self.viol_m3 += pl.q_out * dt_h
            if not self.in_episode:
                self.viol_episodes += 1
                self.in_episode = True
            self.last_bad = t
        elif self.in_episode and t - self.last_bad > 600.0:
            self.in_episode = False

    def add_incident(self, kind, t, label):
        self.incidents.append({"kind": kind, "t": t, "label": label, "detected": None, "how": None})

    def detect_codes(self, t, code):
        for inc in self.incidents:
            if inc["detected"] is None and t >= inc["t"]:
                for prefix in INCIDENT_CODES.get(inc["kind"], []):
                    if code.startswith(prefix):
                        inc["detected"] = t
                        inc["how"] = code
                        break

    def detect_kind(self, t, kind, how):
        for inc in self.incidents:
            if inc["detected"] is None and t >= inc["t"] and inc["kind"] == kind:
                inc["detected"] = t
                inc["how"] = how

    def detect_manual(self, t, found):
        for inc in self.incidents:
            if inc["detected"] is None and t >= inc["t"] and inc["kind"] in found:
                inc["detected"] = t
                inc["how"] = "công nhân kiểm tra"

    def summary(self, pl):
        hours = self.t_total / 3600.0 if self.t_total else 1.0
        return {
            "hours": hours,
            "energy_kwh": self.energy_kwh,
            "kwh_per_day": self.energy_kwh / hours * 24.0,
            "specific_kwh_m3": self.energy_kwh / self.delivered_m3 if self.delivered_m3 > 0 else None,
            "pumped_m3": self.pumped_m3,
            "delivered_m3": self.delivered_m3,
            "served_m3": self.served_m3,
            "consumption_m3": self.consumption_m3,
            "leak_m3": self.leak_m3,
            "burst_m3": self.burst_m3,
            "unserved_m3": pl.unserved_m3,
            "backlog_end_m3": pl.backlog,
            "t_low_min": self.t_low / 60.0,
            "t_high_min": self.t_high / 60.0,
            "t_out_min": self.t_out / 60.0,
            "pct_in_band": 100.0 * (1.0 - self.t_out / self.t_total) if self.t_total else 100.0,
            "p_out_max": self.p_max,
            "p_out_min": self.p_min,
            "p_out_avg": self.p_sum / self.t_total if self.t_total else 0.0,
            "p_crit_min": self.p_crit_min,
            "quality_episodes": self.viol_episodes,
            "quality_viol_min": self.viol_s / 60.0,
            "quality_viol_m3": self.viol_m3,
            "starts": [pu.starts for pu in pl.pumps],
            "starts_total": sum(pu.starts for pu in pl.pumps),
            "run_h": [pu.run_s / 3600.0 for pu in pl.pumps],
            "dry_run_min": sum(pu.dry_run_s for pu in pl.pumps) / 60.0,
            "level_min": None,
            "incidents": [dict(i) for i in self.incidents],
        }
