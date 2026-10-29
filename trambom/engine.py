"""Ghép mô hình: một trạm (thông minh hoặc lịch cố định), cặp song sinh (twin) để so sánh trực tiếp."""
import math
import time

from .baseline import FixedSchedule
from .demand import Disturbances
from .fallback import GatewayFallback
from .gateway import MANUAL_CMDS, Gateway
from .kpi import KpiTracker, MANUAL_DETECTABLE
from .link import Link
from .physics import Plant
from .sensors import SensorSet
from .server import OperationsServer
from .util import deep_copy, load_json

HIST_FIELDS = ["t", "p_out", "p_set", "p_crit", "q_out", "q_req", "q_in", "q_fc", "level", "cl", "ntu", "ph",
               "kw", "kwh", "f1", "f2", "mode", "buf", "online", "tte", "q_leak", "backlog", "manual"]
CTL_CODE = {"auto": 0, "remote": 1, "local": 2}
MODE_CODE = {"a": 0, "b": 1, "c": 2, "d": 3, "x": 4}  # x: mini PC ngừng, mạch dự phòng điều khiển
NAN = float("nan")


def load_config():
    return load_json("station.json")


def load_scenarios():
    return {s["id"]: s for s in load_json("scenarios.json")["scenarios"]}


def build_script(cfg, level, station):
    doc = deep_copy(cfg["script"])
    lv = cfg["levels"][level]
    doc["strategy"] = lv["strategy"]
    doc["params"]["features"].update(lv["features"])
    m_per_bar = 1.0e5 / (cfg["constants"]["rho"] * cfg["constants"]["g"])
    dz = station.get("dz_crit_m", cfg["network"]["dz_crit_m"])
    doc["params"]["pressure"]["dz_bar"] = round(dz / m_per_bar, 3)
    return doc


class History:
    def __init__(self, period):
        self.period = period
        self.next_t = period
        self.data = {k: [] for k in HIST_FIELDS}

    def due(self, t):
        if t + 1e-9 >= self.next_t:
            self.next_t += self.period
            return True
        return False

    def add(self, row):
        for k in HIST_FIELDS:
            self.data[k].append(row.get(k, NAN))


class StationSim:
    def __init__(self, cfg, kind, station=None, level="basic", server=None, custom_fn=None, seed=None, dt=None):
        self.cfg = cfg
        self.kind = kind
        self.station = station or cfg["stations"][0]
        self.sid = self.station["id"]
        self.dt = dt or cfg["sim"]["dt_s"]
        self.t = 0.0
        self.plant = Plant(cfg, self.station)
        self.dist = Disturbances(cfg, self.station, seed)
        self.kpi = KpiTracker(cfg)
        self.hist = History(cfg["sim"]["history_period_s"])
        self.level_min = 1e9
        self.gw = None
        self.base = None
        self.server = server
        self._alarm_seen = 0
        self.gw_dead = None
        self.gw_down_s = 0.0
        if kind == "smart":
            self.sensors = SensorSet(cfg, self.station, seed)
            self.link = Link(cfg, self.station.get("seed_offset", 0))
            script = build_script(cfg, level, self.station)
            profile = self.dist.expected_profile(leak_m3h=1.8)
            self.gw = Gateway(cfg, self.station, self.link, script, profile, level)
            self.gw.custom_fn = custom_fn
            self._warm_start()
            if server is not None:
                server.register(self.sid, self.link, script, self.station.get("name", ""))
        else:
            self.base = FixedSchedule(cfg)
            for pu in self.plant.pumps:
                pu.throttle_k = cfg["baseline"]["throttle_k"]
            self.lsll = False

    def _warm_start(self):
        """Trạm thông minh đang vận hành ổn định lúc 00:00 (P-01 chạy ~32 Hz) – tránh quá độ khởi động giả."""
        pu = self.plant.pumps[0]
        pu.running = True
        pu.cmd_run = True
        pu.f = pu.f_ref = 32.0
        self.gw.pm.cmd[0] = True
        self.gw.pm.start_times[0] = []
        self.gw.ctrl.n = 1
        self.gw.ctrl.I = 32.0
        self.gw.ctrl.last_f_ref = 32.0

    def step(self):
        t = self.t
        dt = self.dt
        pl = self.plant
        d = self.dist.step(t, dt)
        if self.kind == "smart":
            meas = self.sensors.read(pl, dt, t)
            if self.gw_dead is None:
                out = self.gw.step(t, dt, meas)
            else:
                self.link.recv_gateway(t)  # bản tin tới mini PC đang treo bị mất
                out = self.gw_dead.step(t, dt, meas)
            lsll = meas["LSLL-101"]
            hist = self.gw.alarms.history
            while self._alarm_seen < len(hist):
                h = hist[self._alarm_seen]
                self._alarm_seen += 1
                if h["action"] == "raise":
                    self.kpi.detect_codes(h["t"], h["code"])
        else:
            out = self.base.step(t, dt, pl)
            if out["found"]:
                self.kpi.detect_manual(t, set(out["found"]))
            s = self.cfg["safety"]
            if self.cfg["baseline"]["float_protection"]:
                if not self.lsll and pl.level < s["float_lsll_m"]:
                    self.lsll = True
                elif self.lsll and pl.level > s["float_lsll_reset_m"]:
                    self.lsll = False
            lsll = self.lsll
        for i, pu in enumerate(pl.pumps):
            pu.cmd_run = bool(out["run"][i]) and not lsll
            pu.f_ref = out["f_ref"][i]
        pl.outlet_cmd = out["outlet_open"]
        pl.drain_open = out["drain_open"]
        pl.step(dt, d)
        self.kpi.update(t, dt, pl)
        if pl.level < self.level_min:
            self.level_min = pl.level
        self.t = t + dt
        if self.hist.due(self.t):
            self.hist.add(self.snapshot())

    def fail_gateway(self, t):
        if self.gw_dead is not None:
            return
        self.gw_dead = GatewayFallback(self.cfg, self.gw, self.plant, t)
        self.gw.logs.append({"t": t, "level": "critical",
                             "text": "Mini PC (edge gateway) ngừng hoạt động – mất thu thập, điều khiển, an toàn mềm và truyền thông"})
        self.kpi.add_incident("gateway_fail", t, "gateway_fail")

    def restore_gateway(self, t):
        fb = self.gw_dead
        if fb is None:
            return
        self.gw_dead = None
        self.gw_down_s += t - fb.t0
        pumps = [{"running": pu.running, "f": pu.f} for pu in self.plant.pumps]
        self.gw.restart(t, fb.t0, pumps, fb.note())

    def snapshot(self):
        pl = self.plant
        row = {"t": self.t, "p_out": pl.p_net, "p_crit": pl.p_crit, "q_out": pl.q_out, "q_req": pl.q_req, "q_in": pl.q_in,
               "level": pl.level, "cl": pl.cl, "ntu": pl.ntu, "ph": pl.ph, "kw": pl.kw, "kwh": self.kpi.energy_kwh,
               "f1": pl.pumps[0].f, "f2": pl.pumps[1].f, "q_leak": pl.q_leak, "backlog": pl.backlog}
        if self.gw is not None and self.gw_dead is not None:
            g = self.gw
            row["p_set"] = self.gw_dead.p_set if self.gw_dead.p_set is not None else NAN
            row["q_fc"] = g.forecaster.mean_at(self.t)
            row["mode"] = MODE_CODE["x"]
            row["buf"] = len(g.comms.buf) / float(self.cfg["gateway"]["buffer_capacity"])
            row["online"] = 0.0
        elif self.gw is not None:
            g = self.gw
            row["p_set"] = g.ctrl.p_set
            row["q_fc"] = g.forecaster.mean_at(self.t)
            row["mode"] = MODE_CODE[g.mode()]
            row["buf"] = len(g.comms.buf) / float(self.cfg["gateway"]["buffer_capacity"])
            row["online"] = 1.0 if g.comms.state != "offline" else 0.0
            row["tte"] = g.ctrl.tte_h if g.ctrl.tte_h is not None else NAN
            row["manual"] = CTL_CODE[g.control_src()]
        else:
            row["mode"] = -1
        return row

    def summary(self):
        s = self.kpi.summary(self.plant)
        s["level_min"] = self.level_min
        if self.gw is not None:
            g = self.gw
            c = g.comms.stats
            s["alarms_raised"] = dict(g.alarms.raised_count)
            s["comms"] = dict(c)
            s["forecast_mape"] = g.forecaster.mape()
            s["sms"] = c["sms"]
            s["script_version"] = g.script["version"]
            s["manual_min"] = g.manual_s / 60.0
            s["gw_down_min"] = (self.gw_down_s + (self.t - self.gw_dead.t0 if self.gw_dead is not None else 0.0)) / 60.0
            delays = [((n["t_notified"] if n["t_notified"] is not None else self.t) - n["t"]) / 60.0 for n in g.notify]
            s["notify"] = {"critical": len(delays), "max_delay_min": max(delays) if delays else 0.0,
                           "via": sorted(set(n["via"] for n in g.notify))}
            if self.server is not None:
                st = self.server.stations[self.sid]
                s["server_records"] = st["records"]
                s["completeness"] = st["records"] / c["generated"] if c["generated"] else 1.0
                s["server_records_agg"] = st["records_agg"]
                s["server_late"] = st["late"]
                s["conflicts"] = len(st["conflicts"])
            s["bytes_up"] = self.link.bytes_up
            s["bytes_down"] = self.link.bytes_down
        return s


def dispatch_event(ev, t, smart, fixed, server):
    """Áp dụng một sự kiện kịch bản cho trạm thông minh (và trạm lịch cố định nếu là nhiễu vật lý)."""
    typ = ev["type"]
    sims = [x for x in (smart, fixed) if x is not None]
    sid = smart.sid
    if typ in ("inflow_quality", "supply", "burst", "demand_scale"):
        for s in sims:
            s.dist.apply_event(ev, t)
        kind = "inflow_quality:" + ev["param"] if typ == "inflow_quality" else typ
        if typ != "demand_scale":
            for s in sims:
                s.kpi.add_incident(kind, t, typ)
    elif typ in ("pump_fault", "pump_repair"):
        for s in sims:
            s.plant.pumps[ev["pump"]].fault = typ == "pump_fault"
            if typ == "pump_fault":
                s.kpi.add_incident("pump_fault", t, typ)
    elif typ == "sensor_fault":
        smart.sensors.set_fault(ev["tag"], ev["mode"], ev.get("value", 0.0), t)
        smart.kpi.add_incident("sensor_fault", t, typ)
    elif typ == "sensor_repair":
        smart.sensors.clear_fault(ev["tag"])
    elif typ == "link_down":
        smart.link.set_up(False, t)
    elif typ == "link_up":
        smart.link.set_up(True, t)
    elif typ == "server_command":
        ttl = ev.get("ttl_s", smart.cfg["gateway"]["manual_cmd_ttl_s"] if ev["cmd"]["type"] in MANUAL_CMDS else 900.0)
        server.send_command(sid, ev["cmd"]["type"], ev["cmd"].get("args", {}), t, ttl)
    elif typ == "server_publish":
        server.publish_script(sid, ev["patch"], t, ev.get("by", "Điều độ viên"), ev.get("reason", ""), ev.get("strategy"))
    elif typ == "local_edit":
        smart.gw.local_edit(ev["patch"], t, ev.get("by", "HMI"), ev.get("reason", ""))
    elif typ == "local_command":
        smart.gw.local_command(ev["cmd"]["type"], ev["cmd"].get("args", {}), t)
    elif typ == "gateway_fail":
        smart.fail_gateway(t)
    elif typ == "gateway_restore":
        smart.restore_gateway(t)


class TwinSim:
    """Chạy song song trạm thông minh (có gateway + máy chủ) và trạm lịch cố định với cùng nhiễu."""

    def __init__(self, cfg, scenario, level="basic", custom_fn=None, dt=None, seed=None, with_fixed=True):
        self.cfg = cfg
        self.scenario = scenario
        self.level = level
        self.server = OperationsServer(cfg)
        self.smart = StationSim(cfg, "smart", cfg["stations"][0], level, self.server, custom_fn, seed, dt)
        self.fixed = StationSim(cfg, "fixed", cfg["stations"][0], level, None, None, seed, dt) if with_fixed else None
        self.events = sorted(scenario.get("events", []), key=lambda e: e["t_h"])
        self.ev_idx = 0
        self.t = 0.0
        self.dt = self.smart.dt
        self.event_log = []

    def apply_event(self, ev, t):
        dispatch_event(ev, t, self.smart, self.fixed, self.server)
        self.event_log.append({"t": t, "type": ev["type"]})

    def step(self):
        t = self.t
        while self.ev_idx < len(self.events) and self.events[self.ev_idx]["t_h"] * 3600.0 <= t + 1e-9:
            self.apply_event(self.events[self.ev_idx], t)
            self.ev_idx += 1
        self.smart.step()
        if self.fixed is not None:
            self.fixed.step()
        self.server.step(t)
        if self.smart.gw_dead is not None and not self.server.stations[self.smart.sid]["online"]:
            self.smart.kpi.detect_kind(t, "gateway_fail", "máy chủ mất nhịp tim (LWT)")
        self.t = self.smart.t

    def run(self, hours=None, progress=None):
        hours = hours if hours is not None else self.scenario.get("duration_h", 24)
        n = int(round(hours * 3600.0 / self.dt))
        t0 = time.time()
        for i in range(n):
            self.step()
            if progress and i % 36000 == 0:
                progress(i / float(n), time.time() - t0)
        return self.result()

    def result(self):
        res = {"scenario": self.scenario.get("id"), "level": self.level, "dt": self.dt,
               "smart": self.smart.summary(), "smart_hist": self.smart.hist.data,
               "gw_logs": self.smart.gw.logs, "server_logs": self.server.logs,
               "server": self.server.stations[self.smart.sid], "alarm_history": self.smart.gw.alarms.history,
               "event_log": self.event_log, "cmd_results": self.smart.gw.cmd_results, "sms": self.smart.gw.sms_log}
        if self.fixed is not None:
            res["fixed"] = self.fixed.summary()
            res["fixed_hist"] = self.fixed.hist.data
        return res


def run_scenario(scenario_id, level="basic", hours=None, dt=None, custom_fn=None, cfg=None, progress=None, seed=None):
    cfg = cfg or load_config()
    sc = load_scenarios()[scenario_id]
    twin = TwinSim(cfg, sc, level, custom_fn, dt, seed)
    return twin.run(hours, progress)


def isnan(x):
    return isinstance(x, float) and math.isnan(x)
