"""Lớp an toàn (ưu tiên cao nhất) và bộ quản lý bơm của edge gateway.

Thứ tự ưu tiên khi các mục tiêu xung đột:
    1. An toàn con người & thiết bị (áp lực rất cao, chạy khô)
    2. Chất lượng nước theo QCVN 01-1:2018/BYT
    3. Áp lực dịch vụ tối thiểu
    4. Tuổi thọ thiết bị (giới hạn số lần khởi động)
    5. Tiết kiệm điện năng
Lớp này chạy SAU kịch bản điều khiển và có thể ghi đè mọi đầu ra của kịch bản.
"""
from .util import clamp

QUALITY_TAGS = {"cl": "AIT-201", "ntu": "AIT-202", "ph": "AIT-203"}
QUALITY_NAME = {"cl": "Clo dư", "ntu": "Độ đục", "ph": "pH"}
QUALITY_UNIT = {"cl": "mg/L", "ntu": "NTU", "ph": ""}
DEADBAND = {"cl": 0.04, "ntu": 0.1, "ph": 0.1}


class SafetyLayer:
    def __init__(self, cfg):
        self.s = cfg["safety"]
        self.q_auto = cfg["safety"].get("quality_auto_restart", False)
        pm = cfg["pump_model"]
        self.f_min = pm["f_min_hz"]
        self.f_max = pm["f_max_hz"]
        self.f_cap = self.f_max
        self.hh_timer = 0.0
        self.high_timer = 0.0
        self.trip_active = False
        self.trip_t = 0.0
        self.trip_times = []
        self.trip_count = 0
        self.lockout = False
        self.low_timer = 0.0
        self.burst_timer = 0.0
        self.level_trip = False
        self.safe_stop = False
        self.safe_reason = ""
        self.safe_t = None
        self.q_timer = {"cl": 0.0, "ntu": 0.0, "ph": 0.0}
        self.ok_timer = 0.0
        self.last_block = ""
        self.limiting = False
        self.state = "normal"

    # ---------- chất lượng nước ----------
    def _quality_bands(self, key):
        s = self.s
        if key == "cl":
            return (s["cl_warn_low"], s["cl_warn_high"], s["cl_trip_low"], s["cl_trip_high"], s["cl_delay_s"])
        if key == "ntu":
            return (-1e9, s["ntu_warn"], -1e9, s["ntu_trip"], s["ntu_delay_s"])
        return (s["ph_warn_low"], s["ph_warn_high"], s["ph_trip_low"], s["ph_trip_high"], s["ph_delay_s"])

    def quality_ok_for_reset(self, sig):
        s = self.s
        cl, ntu, ph = sig["cl"], sig["ntu"], sig["ph"]
        if cl is None or ntu is None or ph is None:
            return False
        return (s["cl_trip_low"] + 0.05 <= cl <= s["cl_trip_high"] - 0.05 and ntu < s["ntu_reset_max"]
                and s["ph_trip_low"] + 0.2 <= ph <= s["ph_trip_high"] - 0.2)

    def request_reset(self, t, gw):
        if self.lockout and not self.safe_stop:
            self.lockout = False
            self.trip_times = []
            gw.alarms.clear(t, "LOCKOUT")
            gw.alarms.clear(t, "P_HH_TRIP")
            self.trip_active = False
            return True, "Đã mở khóa bảo vệ áp lực"
        if not self.safe_stop:
            return True, "Trạm không ở trạng thái dừng an toàn"
        hold = self.s["quality_reset_hold_s"]
        if self.ok_timer < hold:
            return False, "Chất lượng nước chưa ổn định đủ %.0f phút (mới %.0f phút)" % (hold / 60, self.ok_timer / 60)
        self._clear_safe_stop(t, gw, "lệnh đặt lại")
        return True, "Đã đặt lại dừng an toàn"

    def _clear_safe_stop(self, t, gw, why):
        self.safe_stop = False
        self.safe_reason = ""
        for k in ("cl", "ntu", "ph"):
            gw.alarms.clear(t, k.upper() + "_TRIP")
        gw.alarms.clear(t, "SAFE_STOP")
        gw.log_event(t, "info", "Kết thúc dừng an toàn (%s) – mở van đầu ra, chạy lại bơm" % why)

    # ---------- đánh giá mỗi chu kỳ ----------
    def evaluate(self, t, dt, sig, co, gw, meas):
        s = self.s
        A = gw.alarms
        pp = sig["p_prot"]
        # 1) áp lực rất cao -> cắt bơm
        if pp is not None and pp > s["p_highhigh_bar"]:
            self.hh_timer += dt
        else:
            self.hh_timer = 0.0
        if self.hh_timer >= s["p_hh_delay_s"] and not self.trip_active and not self.lockout:
            self.trip_active = True
            self.trip_t = t
            self.trip_count += 1
            self.trip_times = [x for x in self.trip_times if t - x < 3600.0] + [t]
            A.raise_(t, "P_HH_TRIP", "critical", "Áp lực %.2f bar > %.1f bar – cắt bơm khẩn cấp" % (pp, s["p_highhigh_bar"]))
            if len(self.trip_times) >= s["p_trip_max_per_h"]:
                self.lockout = True
                A.raise_(t, "LOCKOUT", "critical", "Cắt áp cao %d lần/giờ – khóa trạm, cần đặt lại" % len(self.trip_times))
        if self.trip_active and not self.lockout and t - self.trip_t >= s["p_trip_restart_s"] and (pp is None or pp < s["p_high_bar"]):
            self.trip_active = False
            A.clear(t, "P_HH_TRIP")
            gw.log_event(t, "info", "Hết thời gian chờ sau cắt áp cao – cho phép khởi động lại")
        # 2) bộ giới hạn áp cao: giảm trần tần số
        if pp is not None and pp > s["p_high_bar"]:
            self.f_cap = max(self.f_min, self.f_cap - s["p_limiter_down_hz_s"] * dt)
            self.high_timer += dt
        else:
            if pp is None or pp < s["p_high_bar"] - 0.15:
                self.f_cap = min(self.f_max, self.f_cap + s["p_limiter_up_hz_s"] * dt)
            if pp is None or pp < s["p_high_bar"] - 0.1:
                self.high_timer = 0.0
        if self.high_timer >= 5.0:
            A.raise_(t, "P_HIGH", "alarm", "Áp lực đầu ra %.2f bar > %.1f bar – giới hạn tần số bơm" % (pp, s["p_high_bar"]))
        elif self.high_timer == 0.0:
            A.clear(t, "P_HIGH")
        self.limiting = self.f_cap < self.f_max - 0.5
        # 3) áp thấp / nghi vỡ ống
        p = sig["p_ctrl"]
        q = sig["q_f"]
        running = any(x["running"] for x in sig["pumps"])
        if running and p is not None and p < s["p_low_bar"]:
            self.low_timer += dt
        else:
            self.low_timer = 0.0
        A.set(t, "P_LOW", self.low_timer >= s["p_low_delay_s"], "warning", "Áp lực đầu ra thấp < %.1f bar" % s["p_low_bar"])
        if p is not None and q is not None and p < s["p_lowlow_bar"] and q > s["burst_q_m3h"]:
            self.burst_timer += dt
        else:
            self.burst_timer = 0.0
        A.set(t, "BURST_SUSPECT", self.burst_timer >= s["burst_delay_s"], "critical",
              "Áp rất thấp + lưu lượng rất lớn – nghi vỡ ống chính")
        # 4) mức nước rất thấp (chống chạy khô)
        if sig["level_valid"]:
            if not self.level_trip and sig["level"] < s["level_ll_m"]:
                self.level_trip = True
                A.raise_(t, "LEVEL_LL", "critical", "Mức bể %.2f m < %.1f m – khóa chống chạy khô" % (sig["level"], s["level_ll_m"]))
            elif self.level_trip and sig["level"] > s["level_ll_restart_m"]:
                self.level_trip = False
                A.clear(t, "LEVEL_LL")
        A.set(t, "DRY_RUN_FLOAT", meas["LSLL-101"], "critical", "Phao LSLL-101 báo cạn – mạch cứng cắt bơm")
        # 5) chất lượng nước
        for key in ("cl", "ntu", "ph"):
            v = sig[key]
            tag = QUALITY_TAGS[key]
            wl, wh, tl, th, delay = self._quality_bands(key)
            if v is None:
                self.q_timer[key] = (self.q_timer[key] + dt) if s["quality_sensor_fault_action"] == "safe_stop" else 0.0
                A.clear(t, key.upper() + "_WARN")
            else:
                db = DEADBAND[key]
                A.set_hyst(t, dt, key.upper() + "_WARN", v < wl or v > wh, wl + db < v < wh - db, "warning",
                           "%s %.2f %s ngoài dải làm việc" % (QUALITY_NAME[key], v, QUALITY_UNIT[key]), 10.0, 60.0)
                if v < tl or v > th:
                    self.q_timer[key] += dt
                else:
                    self.q_timer[key] = 0.0
            if self.q_timer[key] >= delay:
                vv = "mất tín hiệu %s" % tag if v is None else "%.2f %s" % (v, QUALITY_UNIT[key])
                A.raise_(t, key.upper() + "_TRIP", "critical", "%s vượt ngưỡng QCVN (%s) quá %.0f s" % (QUALITY_NAME[key], vv, delay))
                if not self.safe_stop:
                    self.safe_stop = True
                    self.safe_t = t
                    self.safe_reason = QUALITY_NAME[key]
                    A.raise_(t, "SAFE_STOP", "critical", "DỪNG AN TOÀN: %s không đạt – dừng bơm, đóng van MV-02" % QUALITY_NAME[key])
        if self.quality_ok_for_reset(sig):
            self.ok_timer += dt
        else:
            self.ok_timer = 0.0
        if self.safe_stop and self.q_auto and self.ok_timer >= s["quality_reset_hold_s"]:
            self._clear_safe_stop(t, gw, "tự động theo cấu hình")

        # 6) tổng hợp
        block = ""
        if self.lockout:
            block = "khóa sau nhiều lần cắt áp cao"
        elif self.trip_active:
            block = "cắt áp cao, chờ %.0f s" % max(0.0, s["p_trip_restart_s"] - (t - self.trip_t))
        elif self.safe_stop:
            block = "dừng an toàn do %s" % self.safe_reason
        elif self.level_trip or meas["LSLL-101"]:
            block = "mức bể rất thấp"
        elif meas["outlet_frac"] < 0.95:
            block = "chờ van MV-02 mở hết (trình tự: mở van trước, chạy bơm sau)"
        n = co["n"] if not block else 0
        if block and co["n"] > 0 and block != self.last_block:
            gw.log_event(t, "safety", "Ưu tiên an toàn: chặn lệnh chạy %d bơm của kịch bản (%s)" % (co["n"], block))
        self.last_block = block
        f_ref = co["f_ref"]
        if f_ref > self.f_cap:
            f_ref = self.f_cap
        if self.lockout or self.trip_active:
            self.state = "trip"
        elif self.safe_stop:
            self.state = "safe_stop"
        elif self.level_trip or meas["LSLL-101"]:
            self.state = "level_stop"
        elif self.limiting:
            self.state = "limiting"
        else:
            self.state = "normal"
        return {"n": n, "f_ref": f_ref, "order": co["order"], "outlet_open": not self.safe_stop,
                "block": block}


class PumpManager:
    """Chọn bơm cụ thể theo thứ tự ưu tiên, bảo đảm giới hạn khởi động và thời gian nghỉ tối thiểu."""

    def __init__(self, cfg, tags):
        self.tags = tags
        self.n = len(tags)
        self.max_starts = cfg["safety"]["max_starts_per_h"]
        self.min_off = cfg["safety"]["min_off_s"]
        self.cmd = [False] * self.n
        self.start_times = [[] for _ in range(self.n)]
        self.stop_t = [-1e9] * self.n

    def starts_last_hour(self, i, t):
        return sum(1 for x in self.start_times[i] if t - x < 3600.0)

    def apply(self, t, n, order, pumps, gw):
        chosen = []
        for i in order:
            if len(chosen) >= n:
                break
            if pumps[i]["fault"]:
                continue
            if self.cmd[i]:
                chosen.append(i)
                continue
            if self.starts_last_hour(i, t) >= self.max_starts:
                gw.alarms.raise_(t, "STARTS_LIMIT_" + self.tags[i], "warning",
                                 "%s đã khởi động %d lần/giờ – tạm cấm khởi động (bảo vệ động cơ)" % (self.tags[i], self.max_starts))
                continue
            if t - self.stop_t[i] < self.min_off:
                continue
            chosen.append(i)
        for i in range(self.n):
            if self.starts_last_hour(i, t) < self.max_starts:
                gw.alarms.clear(t, "STARTS_LIMIT_" + self.tags[i])
            want = i in chosen
            if want and not self.cmd[i]:
                self.start_times[i] = [x for x in self.start_times[i] if t - x < 3600.0] + [t]
            if not want and self.cmd[i]:
                self.stop_t[i] = t
            self.cmd[i] = want
        return list(self.cmd)


def clamp_f(f, lo, hi):
    return clamp(f, lo, hi)
