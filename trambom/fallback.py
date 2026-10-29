"""Trạm khi mini PC (edge gateway) ngừng hoạt động: rơ-le watchdog và PID nội của biến tần.

Có dự phòng (hardware.VFD_PID_fallback = true):
    mini PC ngừng phát xung sống > watchdog_s -> rơ-le watchdog nhả: cắt lệnh chạy/tần số từ mô-đun I/O,
    biến tần của bơm chính chuyển sang PID nội với tín hiệu PT-101 (qua bộ chia tín hiệu 4–20 mA),
    giữ áp cố định p_set_bar; bơm thứ hai dừng; van MV-02 giữ vị trí.
Không có dự phòng:
    mô-đun I/O giữ nguyên đầu ra cuối cùng (lệnh chạy, tần số) – bơm chạy "mù" theo tần số cũ.
Cả hai trường hợp: nếu trạm đang dừng an toàn/khóa khi mini PC hỏng thì vẫn giữ dừng (rơ-le chốt).
Mạch cứng vẫn còn: phao LSLL-101 cắt bơm, van an toàn PSV-01, bảo vệ nội của biến tần.
Mất hẳn: dừng an toàn theo chất lượng, ghép/tách và luân phiên bơm, đo xa, SMS.
"""
from .util import clamp


class GatewayFallback:
    def __init__(self, cfg, gw, plant, t0):
        self.fb = cfg["fallback"]
        self.enabled = cfg.get("hardware", {}).get("VFD_PID_fallback", True)
        pm = cfg["pump_model"]
        self.f_min = pm["f_min_hz"]
        self.f_max = pm["f_max_hz"]
        self.t0 = t0
        self.logs = gw.logs
        self.tags = gw.pump_tags
        n = len(plant.pumps)
        last = gw.out or {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": True}
        self.hold = {"run": list(last["run"]), "f_ref": list(last["f_ref"]), "outlet_open": last["outlet_open"],
                     "drain_open": False}
        self.inhibit = gw.safety.safe_stop or gw.safety.lockout
        duty = gw.ctrl.duty
        if plant.pumps[duty].fault:
            duty = 1 - duty
        self.duty = duty
        pu = plant.pumps[duty]
        self.I = pu.f if pu.running else self.f_min
        self.active = False
        self.p_set = None

    def note(self):
        if self.inhibit:
            return "trạm giữ trạng thái dừng an toàn đã chốt"
        if self.enabled:
            return "biến tần %s chạy PID nội giữ %.1f bar" % (self.tags[self.duty], self.fb["p_set_bar"])
        return "không có dự phòng, mô-đun I/O giữ nguyên lệnh cuối"

    def step(self, t, dt, meas):
        n = len(meas["pumps"])
        if self.inhibit:
            return {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": False, "drain_open": False}
        if not self.enabled or t - self.t0 < self.fb["watchdog_s"]:
            return self.hold
        fb = self.fb
        if not self.active:
            self.active = True
            self.p_set = fb["p_set_bar"]
            self.logs.append({"t": t, "level": "safety", "text": "Rơ-le watchdog nhả sau %.0f s – biến tần %s chuyển PID nội giữ %.1f bar theo PT-101, bơm còn lại dừng"
                              % (fb["watchdog_s"], self.tags[self.duty], fb["p_set_bar"])})
        p = meas["PT-101"]
        if p is None:
            f = 40.0
        else:
            e = fb["p_set_bar"] - p
            kp = fb["kp_hz_per_bar"]
            u = self.I + kp * e
            if not ((u >= self.f_max and e > 0) or (u <= self.f_min and e < 0)):
                self.I += kp * dt / fb["ti_s"] * e
            self.I = clamp(self.I, self.f_min, self.f_max)
            f = clamp(self.I + kp * e, self.f_min, self.f_max)
        run = [i == self.duty and not meas["pumps"][i]["fault"] for i in range(n)]
        return {"run": run, "f_ref": [f if r else 0.0 for r in run], "outlet_open": True, "drain_open": False}
