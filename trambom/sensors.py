"""Mô hình cảm biến: trễ quán tính bậc 1, nhiễu Gauss, bão hòa 4–20 mA và các kiểu lỗi.

Kiểu lỗi (fault):
    stuck – kẹt ở một giá trị cố định
    bias  – lệch không đổi (+value)
    drift – trôi tuyến tính (value đơn vị/giờ)
    dead  – mất tín hiệu (dòng < 3,6 mA theo NAMUR NE43) -> giá trị None
    noisy – nhiễu tăng gấp 'value' lần
"""
import math

from .rng import stream

TAG_SOURCE = {
    "PT-101": "p",
    "PT-102": "p",
    "FT-101": "q_out",
    "FT-100": "q_in",
    "LT-101": "level",
    "AIT-201": "cl",
    "AIT-202": "ntu",
    "AIT-203": "ph",
}
TAG_ORDER = ["PT-101", "PT-102", "FT-101", "FT-100", "LT-101", "AIT-201", "AIT-202", "AIT-203"]


def installed_tags(cfg):
    """Các cảm biến thực sự được lắp theo tùy chọn cfg["hardware"] (mặc định: lắp đủ)."""
    hw = cfg.get("hardware", {})
    out = set(TAG_ORDER)
    if not hw.get("PT-102", True):
        out.discard("PT-102")
    if not hw.get("FT-100_pulse", True):
        out.discard("FT-100")
    for tag in ("AIT-201", "AIT-202", "AIT-203"):
        if not hw.get(tag, True):
            out.discard(tag)
    return out


class AnalogSensor:
    def __init__(self, tag, spec):
        self.tag = tag
        self.lo = spec["lo"]
        self.hi = spec["hi"]
        self.sd = spec["sd"]
        self.tau = spec["tau_s"]
        self.cutoff = spec.get("cutoff", None)
        self.y = None
        self.fault = None
        self.fault_value = 0.0
        self.fault_t0 = 0.0
        self.value = None

    def set_fault(self, mode, value, t):
        self.fault = mode
        self.fault_value = value
        self.fault_t0 = t

    def clear_fault(self):
        self.fault = None

    def read(self, x, dt, t, z):
        if self.y is None or self.tau <= 0.0:
            self.y = x
        else:
            self.y += (x - self.y) * (1.0 - math.exp(-dt / self.tau))
        sd = self.sd
        v = self.y
        f = self.fault
        if f == "noisy":
            sd *= self.fault_value
        v += sd * z
        if f == "bias":
            v += self.fault_value
        elif f == "drift":
            v += self.fault_value * (t - self.fault_t0) / 3600.0
        elif f == "stuck":
            v = self.fault_value
        elif f == "dead":
            self.value = None
            return None
        if self.cutoff is not None and v < self.cutoff:
            v = 0.0
        span = self.hi - self.lo
        lo = self.lo - 0.0125 * span
        hi = self.hi + 0.031 * span
        if v < lo:
            v = lo
        if v > hi:
            v = hi
        self.value = v
        return v


class SensorSet:
    def __init__(self, cfg, station=None, seed=None):
        station = station or {}
        seed = cfg["sim"]["seed"] if seed is None else seed
        self.rng = stream(seed + station.get("seed_offset", 0), 2)
        self.sensors = {tag: AnalogSensor(tag, cfg["sensors"][tag]) for tag in TAG_ORDER}
        self.installed = installed_tags(cfg)
        s = cfg["safety"]
        self.lsll_trip = s["float_lsll_m"]
        self.lsll_reset = s["float_lsll_reset_m"]
        self.lsll = False  # True = phao báo cạn (mạch cứng cắt bơm)

    def read(self, plant, dt, t):
        meas = {}
        src = {"p": plant.p, "q_out": plant.q_out, "q_in": plant.q_in, "level": plant.level,
               "cl": plant.cl, "ntu": plant.ntu, "ph": plant.ph}
        for tag in TAG_ORDER:
            z = self.rng.gauss()  # luôn rút số ngẫu nhiên để các phương án lắp đặt dùng chung chuỗi nhiễu
            v = self.sensors[tag].read(src[TAG_SOURCE[tag]], dt, t, z)
            meas[tag] = v if tag in self.installed else None
        # phao cứng LSLL-101 có trễ
        if not self.lsll and plant.level < self.lsll_trip:
            self.lsll = True
        elif self.lsll and plant.level > self.lsll_reset:
            self.lsll = False
        meas["LSLL-101"] = self.lsll
        meas["pumps"] = [{"running": pu.running, "f": pu.f, "fault": pu.fault, "kw": pu.kw,
                          "amps": pu.amps, "run_s": pu.run_s, "starts": pu.starts} for pu in plant.pumps]
        meas["kw"] = plant.kw
        meas["kwh"] = plant.pumps[0].energy_kwh + plant.pumps[1].energy_kwh
        meas["outlet_frac"] = plant.outlet_frac
        meas["drain_open"] = plant.drain_open
        return meas

    def set_fault(self, tag, mode, value, t):
        self.sensors[tag].set_fault(mode, value, t)

    def clear_fault(self, tag):
        self.sensors[tag].clear_fault()
