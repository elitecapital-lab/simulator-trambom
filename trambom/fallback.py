"""Trạm khi mini PC (edge gateway) ngừng hoạt động: rơ-le watchdog và PID nội của biến tần.

Có dự phòng (hardware.VFD_PID_fallback = true):
    mini PC ngừng phát xung sống > watchdog_s -> rơ-le watchdog WDR-01 nhả TRƯỚC khi mô-đun I/O hết thời gian chờ
    truyền thông (io_timeout_s ≥ 2 × watchdog_s): biến tần của bơm chính chuyển sang PID nội với cảm biến áp riêng
    (VFD-01 ← PT-101, VFD-02 ← PT-102 qua bộ chia tín hiệu; không có PT-102 thì cả hai dùng PT-101), giữ áp p_set_bar.
    Bơm chính = bơm mini PC đã chốt lên rơ-le KA-DUTY (bơm đang chạy); biến tần bơm chính lỗi thì KA-FB chuyển sang bơm kia.
    Bơm thứ hai dừng; van MV-02 giữ vị trí.
Không có dự phòng:
    mô-đun I/O giữ lệnh cuối cho tới io_timeout_s rồi đưa DO về trạng thái an toàn io_safe_state:
    "off" – lệnh chạy về 0, bơm dừng (cấu hình khuyến nghị cho I/O); "hold" – giữ nguyên lệnh cuối, bơm chạy "mù".
Cả hai trường hợp: trạm đang dừng an toàn/khóa khi mini PC hỏng thì vẫn giữ dừng (rơ-le chốt K-SS).
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
        self.installed = gw.sig_proc.installed
        n = len(plant.pumps)
        last = gw.out or {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": True}
        self.hold = {"run": list(last["run"]), "f_ref": list(last["f_ref"]), "outlet_open": last["outlet_open"],
                     "drain_open": False}
        self.inhibit = gw.safety.safe_stop or gw.safety.lockout
        running = [i for i, pu in enumerate(plant.pumps) if pu.running and not pu.fault]
        duty = gw.ctrl.duty
        if duty not in running and running:
            duty = running[0]  # KA-DUTY theo bơm đang chạy (kể cả khi đang chạy TAY)
        if plant.pumps[duty].fault:
            duty = 1 - duty
        self.duty = duty
        pu = plant.pumps[duty]
        self.I = pu.f if pu.running else self.f_min
        self.active = False
        self.io_off = False
        self.p_set = None
        self.restarted = False  # mini PC đã khởi động lại, đang theo dõi trước khi tiếp quản

    def note(self):
        if self.inhibit:
            return "trạm giữ trạng thái dừng an toàn đã chốt"
        if self.enabled:
            return "biến tần %s chạy PID nội giữ %.1f bar" % (self.tags[self.duty], self.fb["p_set_bar"])
        if self.fb.get("io_safe_state", "off") == "hold":
            return "không có dự phòng, mô-đun I/O giữ nguyên lệnh cuối"
        return "không có dự phòng, mô-đun I/O đưa lệnh chạy về 0 – bơm dừng"

    def _pt(self, i):
        return "PT-102" if i == 1 and "PT-102" in self.installed else "PT-101"

    def step(self, t, dt, meas):
        n = len(meas["pumps"])
        fb = self.fb
        if self.inhibit:
            return {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": False, "drain_open": False}
        if not self.enabled:
            if fb.get("io_safe_state", "off") == "off" and t - self.t0 >= fb["io_timeout_s"]:
                if not self.io_off:
                    self.io_off = True
                    self.logs.append({"t": t, "level": "safety", "text": "Mô-đun I/O mất truyền thông %.0f s – đưa lệnh chạy về 0: bơm dừng (không có mạch dự phòng PID)" % fb["io_timeout_s"]})
                return {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": self.hold["outlet_open"], "drain_open": False}
            return self.hold
        if t - self.t0 < fb["watchdog_s"]:
            return self.hold
        if not self.hold["outlet_open"]:
            # MV-02 giữ vị trí (đang đóng) → liên động cứng "MV-02 không mở hết thì cấm chạy" vẫn hiệu lực
            return {"run": [False] * n, "f_ref": [0.0] * n, "outlet_open": False, "drain_open": False}
        pumps = meas["pumps"]
        if not self.active:
            self.active = True
            self.p_set = fb["p_set_bar"]
            self.logs.append({"t": t, "level": "safety", "text": "Rơ-le watchdog nhả sau %.0f s – biến tần %s chuyển PID nội giữ %.1f bar theo %s, bơm còn lại dừng"
                              % (fb["watchdog_s"], self.tags[self.duty], fb["p_set_bar"], self._pt(self.duty))})
        other = 1 - self.duty
        if pumps[self.duty]["fault"] and not pumps[other]["fault"]:
            self.logs.append({"t": t, "level": "safety", "text": "Biến tần %s lỗi – rơ-le KA-FB chuyển PID dự phòng sang %s"
                              % (self.tags[self.duty], self.tags[other])})
            self.duty = other
            self.I = self.f_min
        p = meas[self._pt(self.duty)]
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
        run = [i == self.duty and not pumps[i]["fault"] for i in range(n)]
        return {"run": run, "f_ref": [f if r else 0.0 for r in run], "outlet_open": self.hold["outlet_open"], "drain_open": False}
