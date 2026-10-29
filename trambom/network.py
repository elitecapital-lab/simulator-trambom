"""Tầng tích hợp mạng lưới: nhiều trạm bơm tăng áp cùng báo về một máy chủ điều hành.

Cung cấp số liệu điều hành tổng quát: lưu lượng và áp lực các trạm, tổng điện năng, tỷ lệ thất thoát
(rò rỉ / cấp vào mạng), cảnh báo tập trung, tình trạng kết nối."""
from .engine import StationSim, dispatch_event, load_config
from .server import OperationsServer


class NetworkSim:
    def __init__(self, cfg=None, level="basic", with_fixed=True, events=None, dt=None):
        self.cfg = cfg or load_config()
        self.server = OperationsServer(self.cfg)
        self.smart = [StationSim(self.cfg, "smart", st, level, self.server, dt=dt) for st in self.cfg["stations"]]
        self.fixed = [StationSim(self.cfg, "fixed", st, dt=dt) for st in self.cfg["stations"]] if with_fixed else []
        self.by_id = {s.sid: i for i, s in enumerate(self.smart)}
        self.events = sorted(events or [], key=lambda e: e["t_h"])
        self.ev_idx = 0
        self.t = 0.0
        self.dt = self.smart[0].dt

    def step(self):
        t = self.t
        while self.ev_idx < len(self.events) and self.events[self.ev_idx]["t_h"] * 3600.0 <= t + 1e-9:
            ev = self.events[self.ev_idx]
            i = self.by_id.get(ev.get("station", "ST-01"), 0)
            dispatch_event(ev, t, self.smart[i], self.fixed[i] if self.fixed else None, self.server)
            self.ev_idx += 1
        for s in self.smart:
            s.step()
        for s in self.fixed:
            s.step()
        self.server.step(t)
        self.t = self.smart[0].t

    def run(self, hours):
        for _ in range(int(round(hours * 3600.0 / self.dt))):
            self.step()
        return self.summary()

    def dashboard(self):
        """Ảnh chụp bảng điều khiển trung tâm (dữ liệu máy chủ nhận được, không phải giá trị thật)."""
        rows = []
        for s in self.smart:
            st = self.server.stations[s.sid]
            last = st["last"] or {}
            rows.append({"id": s.sid, "name": s.station.get("name", s.sid), "online": st["online"],
                         "p": last.get("p"), "q": last.get("q"), "kw": last.get("kw"), "kwh": last.get("kwh"),
                         "level": last.get("level"), "mode": last.get("mode"),
                         "alarms": [a for (sid, _), a in self.server.alarms.items() if sid == s.sid]})
        return rows

    def summary(self):
        out = {"stations": [], "totals": {}}
        tot = {"smart_kwh": 0.0, "fixed_kwh": 0.0, "smart_m3": 0.0, "fixed_m3": 0.0, "smart_leak": 0.0, "fixed_leak": 0.0,
               "smart_out_min": 0.0, "fixed_out_min": 0.0}
        for i, s in enumerate(self.smart):
            ks = s.summary()
            row = {"id": s.sid, "name": s.station.get("name"), "smart": ks}
            tot["smart_kwh"] += ks["energy_kwh"]
            tot["smart_m3"] += ks["delivered_m3"]
            tot["smart_leak"] += ks["leak_m3"]
            tot["smart_out_min"] += ks["t_out_min"]
            if self.fixed:
                kf = self.fixed[i].summary()
                row["fixed"] = kf
                tot["fixed_kwh"] += kf["energy_kwh"]
                tot["fixed_m3"] += kf["delivered_m3"]
                tot["fixed_leak"] += kf["leak_m3"]
                tot["fixed_out_min"] += kf["t_out_min"]
            out["stations"].append(row)
        tot["smart_nrw_pct"] = 100.0 * tot["smart_leak"] / tot["smart_m3"] if tot["smart_m3"] else 0.0
        tot["fixed_nrw_pct"] = 100.0 * tot["fixed_leak"] / tot["fixed_m3"] if tot["fixed_m3"] else 0.0
        tot["central_alarms"] = len(self.server.alarm_history)
        out["totals"] = tot
        return out
