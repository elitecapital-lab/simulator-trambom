"""Nhiễu ngoại sinh: nhu cầu dùng nước, nguồn cấp vào bể, chất lượng nước nguồn, sự cố vỡ ống.

Các đại lượng này KHÔNG phụ thuộc vào cách điều khiển, nên hai phương án (thông minh và lịch cố
định) chạy song song với cùng một chuỗi nhiễu – so sánh công bằng.
"""
import math

from .rng import stream
from .util import clamp


def normalize(pattern):
    m = sum(pattern) / len(pattern)
    return [v / m for v in pattern]


class Disturbances:
    def __init__(self, cfg, station=None, seed=None):
        station = station or {}
        self.cfg = cfg
        d = cfg["demand"]
        self.mean = d["mean_m3h"] * station.get("demand_scale", 1.0)
        self.weekday = normalize(d["weekday"])
        self.weekend = normalize(d["weekend"])
        self.weekend_scale = d["weekend_scale"]
        self.day_sigma = d["day_sigma"]
        self.noise_sigma = d["noise_sigma"]
        self.noise_tau = d["noise_tau_s"]
        self.start_dow = cfg["sim"]["start_dow"]
        seed = cfg["sim"]["seed"] if seed is None else seed
        self.rng = stream(seed + station.get("seed_offset", 0), 1)
        self.supply_hourly = cfg["inlet"]["supply_factor_hourly"]
        q = cfg["quality"]
        self.base_quality = {"cl": q["cl_in_mgl"], "ntu": q["ntu_in"], "ph": q["ph_in"]}
        self.ar = 0.0
        self.day_index = -1
        self.day_factor = 1.0
        # nhiễu theo sự kiện: danh sách {kind, value, t_end}
        self.overrides = []
        self.last = {}

    # ---- sự kiện kịch bản ----
    def apply_event(self, ev, t):
        typ = ev["type"]
        until = ev.get("until_h")
        t_end = until * 3600.0 if until is not None else 1e18
        if typ == "inflow_quality":
            self.overrides.append({"kind": "q_" + ev["param"], "value": ev["value"], "t_end": t_end})
        elif typ == "supply":
            self.overrides.append({"kind": "supply", "value": ev["factor"], "t_end": t_end})
        elif typ == "burst":
            self.overrides.append({"kind": "burst", "value": ev["q_m3h"], "t_end": t_end})
        elif typ == "demand_scale":
            self.overrides.append({"kind": "demand", "value": ev["factor"], "t_end": t_end})

    def _override(self, kind, t, default):
        val = default
        for o in self.overrides:
            if o["kind"] == kind and t < o["t_end"]:
                val = o["value"]
        return val

    def profile_mult(self, t):
        """Hệ số nhu cầu theo giờ (nội suy tuyến tính giữa tâm các giờ)."""
        day = int(t // 86400)
        dow = (self.start_dow + day) % 7
        weekend = dow >= 5
        pat = self.weekend if weekend else self.weekday
        x = (t % 86400) / 3600.0 - 0.5
        i0 = int(math.floor(x))
        frac = x - i0
        a = pat[(i0 + 24) % 24]
        b = pat[(i0 + 25) % 24]
        m = a + (b - a) * frac
        return m * (self.weekend_scale if weekend else 1.0)

    def step(self, t, dt):
        day = int(t // 86400)
        while self.day_index < day:
            self.day_index += 1
            self.day_factor = 1.0 + self.day_sigma * self.rng.gauss()
        phi = math.exp(-dt / self.noise_tau)
        self.ar = phi * self.ar + math.sqrt(1.0 - phi * phi) * self.noise_sigma * self.rng.gauss()
        hour = int((t % 86400) // 3600)
        q_cons = self.mean * self.profile_mult(t) * self.day_factor * max(0.0, 1.0 + self.ar)
        q_cons *= self._override("demand", t, 1.0)
        out = {
            "q_cons": q_cons,
            "supply": self.supply_hourly[hour] * self._override("supply", t, 1.0),
            "cl_in": self._override("q_cl", t, self.base_quality["cl"]),
            "ntu_in": self._override("q_ntu", t, self.base_quality["ntu"]),
            "ph_in": self._override("q_ph", t, self.base_quality["ph"]),
            "q_burst": self._override("burst", t, 0.0),
        }
        self.last = out
        return out

    def expected_profile(self, leak_m3h=1.6):
        """Hồ sơ 168 giờ (Thứ Hai 00h ...) mà trung tâm 'huấn luyện trước' từ dữ liệu lịch sử."""
        prof = []
        for h in range(168):
            dow = h // 24
            hr = h % 24
            pat = self.weekend if dow >= 5 else self.weekday
            sc = self.weekend_scale if dow >= 5 else 1.0
            prof.append(round(self.mean * pat[hr] * sc + leak_m3h, 3))
        return prof


def clamp01(x):
    return clamp(x, 0.0, 1.0)
