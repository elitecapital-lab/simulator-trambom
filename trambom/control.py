"""Kịch bản điều khiển của edge gateway: theo ngưỡng (cơ bản) và dự báo (nâng cao).

Kịch bản chỉ ĐỀ XUẤT số bơm chạy, thứ tự ưu tiên bơm và tần số. Lớp an toàn (safety.py) luôn được
áp dụng sau đó và có quyền ghi đè – kịch bản không thể vượt qua khóa liên động.
"""
import math

from .util import clamp


class Forecaster:
    """Dự báo lưu lượng theo mẫu 168 giờ trong tuần (giờ × ngày), học trực tuyến bằng EMA."""

    def __init__(self, profile, start_dow):
        self.mean = [float(v) for v in profile]
        self.var = [(0.12 * m) ** 2 + 0.25 for m in self.mean]
        self.start_dow = start_dow
        self.min_idx = None
        self.acc = 0.0
        self.acc_n = 0
        self.acc_learn = True
        self.hour_idx = None
        self.h_acc = 0.0
        self.h_n = 0
        self.h_bad = False
        self.err = 0.15
        self.resid = 0.0
        self.last_qm = None
        self.last_f = None
        self.anom_min = 0
        self.clear_min = 0
        self.anomaly = False
        self.minutes = 0
        self.abs_err_sum = 0.0
        self.abs_err_n = 0

    def how(self, t):
        return (self.start_dow * 24.0 + t / 3600.0) % 168.0

    def _interp(self, arr, t):
        x = self.how(t) - 0.5
        i0 = int(math.floor(x))
        f = x - i0
        a = arr[i0 % 168]
        b = arr[(i0 + 1) % 168]
        return a + (b - a) * f

    def mean_at(self, t):
        return self._interp(self.mean, t)

    def sigma_at(self, t):
        return math.sqrt(max(self._interp(self.var, t), 0.0))

    def max_over(self, t0, t1):
        m = self.mean_at(t0)
        k = 1
        while t0 + k * 300.0 <= t1:
            v = self.mean_at(t0 + k * 300.0)
            if v > m:
                m = v
            k += 1
        return m

    def avg_over(self, t0, t1):
        s = 0.0
        n = 0
        k = 0
        while t0 + k * 900.0 <= t1:
            s += self.mean_at(t0 + k * 900.0)
            n += 1
            k += 1
        return s / n if n else self.mean_at(t0)

    def update(self, t, q, learn, pd):
        mi = int(t // 60)
        if self.min_idx is None:
            self.min_idx = mi
        if mi != self.min_idx:
            if self.acc_n > 0:
                self._minute(self.min_idx, self.acc / self.acc_n, pd, self.acc_learn)
            self.min_idx = mi
            self.acc = 0.0
            self.acc_n = 0
            self.acc_learn = True
        if self.acc_n == 0:
            self.acc_learn = True
        if q is not None:
            self.acc += q
            self.acc_n += 1
        if not learn:
            self.acc_learn = False

    def _minute(self, mi, qm, pd, learn):
        tc = mi * 60.0 + 30.0
        f = self.mean_at(tc)
        sd = self.sigma_at(tc)
        r = qm - f
        self.last_qm = qm
        self.last_f = f
        self.resid = r
        if not learn:
            self.anom_min = 0
            return
        self.minutes += 1
        e = abs(r) / max(f, 2.0)
        self.err += (e - self.err) / 60.0
        self.abs_err_sum += e
        self.abs_err_n += 1
        thr = max(pd["anomaly_min_m3h"], pd["anomaly_k"] * sd)
        if r > thr:
            self.anom_min += 1
            self.clear_min = 0
        else:
            self.anom_min = 0
            if r < 0.5 * thr:
                self.clear_min += 1
        if not self.anomaly and self.anom_min >= pd["anomaly_t_min"]:
            self.anomaly = True
        elif self.anomaly and self.clear_min >= 10:
            self.anomaly = False
        hb = int(self.how(tc)) % 168
        if not self.anomaly and abs(r) < 4.0 * sd:
            v = self.var[hb]
            self.var[hb] = v + 0.02 * (r * r - v)
        if self.hour_idx is None:
            self.hour_idx = hb
        if hb != self.hour_idx:
            if self.h_n >= 30 and not self.h_bad:
                a = pd["learn_alpha"]
                self.mean[self.hour_idx] += a * (self.h_acc / self.h_n - self.mean[self.hour_idx])
            self.hour_idx = hb
            self.h_acc = 0.0
            self.h_n = 0
            self.h_bad = False
        self.h_acc += qm
        self.h_n += 1
        if self.anomaly:
            self.h_bad = True

    def mape(self):
        return self.abs_err_sum / self.abs_err_n if self.abs_err_n else None


class Controller:
    def __init__(self, cfg, n_pumps):
        self.pmod = cfg["pump_model"]
        self.m_per_bar = 1.0e5 / (cfg["constants"]["rho"] * cfg["constants"]["g"])
        self.z_s = cfg["tank"]["z_suction_m"]
        self.area = cfg["tank"]["area_m2"]
        self.max_starts = cfg["safety"]["max_starts_per_h"]
        self.n_pumps = n_pumps
        self.I = self.pmod["f_min_hz"]
        self.n = 0
        self.duty = 0
        self.duty_run_s = 0.0
        self.swap_until = None
        self.force_rotate = False
        self.stage_timer = 0.0
        self.destage_timer = 0.0
        self.sleep_state = "awake"
        self.sleep_timer = 0.0
        self.boost_until = 0.0
        self.level_stop = False
        self.fallback = False
        self.ff_on = False
        self.ff_n = 1
        self.last_f_ref = 0.0
        self.p_set = 2.0
        self.q_ff = 0.0
        self.margin = 0.0
        self.tte_h = None
        self.next_tte = 0.0
        self.no_inflow_s = 0.0
        self.conserve = 0
        self.strategy_used = "threshold"
        self.custom_mem = {}
        self.prestaged = False

    def f_estimate(self, p_set, level, q, n):
        pm = self.pmod
        n = max(1, n)
        h_need = p_set * self.m_per_bar - (level + self.z_s) + pm["k_m_per_m3h2"] * (q / n) ** 2
        f = pm["f_rated_hz"] * math.sqrt(max(0.0, h_need) / pm["h0_m"])
        return clamp(f, pm["f_min_hz"], pm["f_max_hz"])

    def step(self, t, dt, sig, gw):
        P = gw.script["params"]
        pr = P["pressure"]
        st = P["staging"]
        lv = P["level"]
        sl = P["sleep"]
        off = P["offline"]
        pd = P["predictive"]
        feat = P["features"]
        alt = P["alternation"]
        pm = self.pmod
        f_min = pm["f_min_hz"]
        f_max = pm["f_max_hz"]
        fc = gw.forecaster
        q = sig["q_f"] if sig["q_f"] is not None else 0.0
        p_meas = sig["p_ctrl"]
        level = sig["level"]
        pumps = sig["pumps"]
        strategy = gw.script["strategy"]

        # ---- dự phòng khi dự báo kém ----
        if strategy == "predictive":
            if not self.fallback and fc.err > pd["fallback_err"]:
                self.fallback = True
                gw.alarms.raise_(t, "FORECAST_FALLBACK", "info", "Sai số dự báo %.0f%% > ngưỡng – tạm dùng điều khiển theo ngưỡng" % (100 * fc.err))
            elif self.fallback and fc.err < pd["recover_err"]:
                self.fallback = False
                gw.alarms.clear(t, "FORECAST_FALLBACK")
        predictive = strategy == "predictive" and not self.fallback
        self.strategy_used = "predictive" if predictive else ("fallback" if strategy == "predictive" else "threshold")

        # ---- áp lực đặt theo lưu lượng ----
        if predictive:
            qh0 = fc.mean_at(t)
            qh1 = fc.mean_at(t + pd["lead_min"] * 60.0)
            sq = fc.sigma_at(t)
            q_ff = q + max(0.0, qh1 - qh0)
            margin = clamp(pd["margin_min_bar"] + pd["k_sigma"] * 2.0 * pr["r_est"] * q_ff * sq,
                           pd["margin_min_bar"], pd["margin_max_bar"])
            p_set = pd["p_crit_req_bar"] + margin + pr["dz_bar"] + pr["r_est"] * q_ff * q_ff
        else:
            q_ff = q
            margin = pr["p_crit_target_bar"] - P["predictive"]["p_crit_req_bar"]
            p_set = pr["p_crit_target_bar"] + pr["dz_bar"] + pr["r_est"] * q * q
        p_set = clamp(p_set, pr["p_set_min_bar"], pr["p_set_max_bar"])
        if gw.offline_since is not None:
            off_h = (t - gw.offline_since) / 3600.0
            p_set += off["long_margin_bar"] if off_h >= off["long_after_h"] else off["margin_bar"]
        if gw.override is not None:
            if t < gw.override["until"]:
                p_set = gw.override["p_set"]
            else:
                gw.log_event(t, "info", "Lệnh ghi đè áp lực từ xa hết hạn – quay về kịch bản đã lưu")
                gw.override = None

        # ---- bảo vệ mức nước & tiết kiệm nước ----
        cons = 0.0
        self.conserve = 0
        if level < lv["conserve_m"]:
            cons = lv["conserve_delta_bar"]
            self.conserve = 2
        gw.alarms.set_hyst(t, dt, "LEVEL_LOW", level < lv["conserve_m"], level > lv["conserve_m"] + 0.05, "warning",
                           "Mức bể thấp (< %.1f m) – giảm áp tiết kiệm nước" % lv["conserve_m"], 5.0, 60.0)
        hi = gw.cfg["safety"]["level_high_m"]
        gw.alarms.set_hyst(t, dt, "LEVEL_HIGH", level > hi, level < hi - 0.05, "warning",
                           "Mức bể > %.1f m – nghi van phao FV-01 kẹt mở, sắp tràn" % hi, 60.0, 60.0)
        if t >= self.next_tte:
            # dự báo thời gian cạn bể: thể tích còn dùng được / (lưu lượng ra dự báo 3 h tới - lưu lượng vào)
            self.next_tte = t + 60.0
            q_in = sig["q_in_f"] if sig["q_in_f"] is not None else 0.0
            usable = max(0.0, (level - lv["stop_m"]) * self.area)
            net_draw = fc.avg_over(t, t + 3 * 3600.0) - q_in
            self.tte_h = usable / net_draw if net_draw > 0.5 else None
        cons_tte = 0.0
        if feat["tte_conservation"] and self.tte_h is not None:
            if self.tte_h < pd["tte_crit_h"]:
                cons_tte = pd["tte_delta2_bar"]
                self.conserve = max(self.conserve, 2)
            elif self.tte_h < pd["tte_warn_h"]:
                cons_tte = pd["tte_delta1_bar"]
                self.conserve = max(self.conserve, 1)
            gw.alarms.set_hyst(t, dt, "TTE_LOW", self.tte_h < pd["tte_warn_h"], self.tte_h > pd["tte_warn_h"] + 0.5, "warning",
                               "Dự báo bể cạn sau %.1f h – chủ động giảm áp" % self.tte_h, 0.0, 300.0)
        elif self.tte_h is None:
            gw.alarms.clear(t, "TTE_LOW")
        p_base = p_set
        if cons < 0.0:
            # mức bể thấp: giảm áp "cấp hạn chế" (chấp nhận áp dưới chuẩn để kéo dài thời gian cấp)
            p_set = max(p_base + cons, min(p_base, lv["p_set_conserve_min_bar"]))
        if cons_tte < 0.0:
            # giảm áp chủ động theo dự báo: chỉ bỏ phần biên an toàn, KHÔNG xuống dưới áp tối thiểu tại điểm bất lợi
            floor = pd["p_crit_req_bar"] + pd["margin_min_bar"] + pr["dz_bar"] + pr["r_est"] * q_ff * q_ff
            p_set = min(p_set, max(p_base + cons_tte, min(p_base, floor)))
        # mất nước nguồn: lưu lượng vào (FT-100 hoặc ước lượng cân bằng khối lượng) ~ 0 trong khi van phao đang mở (mức < 3,4 m)
        q_in_now = sig["q_in_f"] if sig["q_in_f"] is not None else 0.0
        if sig["q_in_f"] is not None and q_in_now < 0.5 and level < 3.4:
            self.no_inflow_s += dt
        else:
            self.no_inflow_s = 0.0
        gw.alarms.set_hyst(t, dt, "SUPPLY_LOST", self.no_inflow_s >= lv["supply_lost_s"], q_in_now > 2.0, "warning",
                           "Không có nước vào bể (lưu lượng vào ≈ 0) dù van phao mở – nghi mất nước nguồn", 0.0, 60.0)

        if self.level_stop:
            if level > lv["restart_m"]:
                self.level_stop = False
                gw.alarms.clear(t, "LEVEL_STOP")
                gw.log_event(t, "info", "Mức bể hồi phục > %.1f m – cho phép chạy bơm lại" % lv["restart_m"])
        elif level < lv["stop_m"]:
            self.level_stop = True
            gw.alarms.raise_(t, "LEVEL_STOP", "alarm", "Mức bể < %.1f m – kịch bản dừng bơm chống chạy khô" % lv["stop_m"])

        # ---- luân phiên & dự phòng bơm ----
        other = 1 - self.duty
        if pumps[self.duty]["running"]:
            self.duty_run_s += dt
        if pumps[self.duty]["fault"] and not pumps[other]["fault"]:
            gw.log_event(t, "alarm", "Bơm %s lỗi – chuyển bơm dự phòng %s làm bơm chính" % (gw.pump_tags[self.duty], gw.pump_tags[other]))
            self.duty = other
            other = 1 - self.duty
            self.duty_run_s = 0.0
            self.swap_until = None
        if (self.duty_run_s >= alt["runtime_h"] * 3600.0 or self.force_rotate) and not pumps[other]["fault"] \
                and self.swap_until is None and self.n >= 1:
            gw.log_event(t, "info", "Luân phiên bơm: %s → %s (%s)" % (gw.pump_tags[self.duty], gw.pump_tags[other],
                                                                     "theo lệnh" if self.force_rotate else "đủ %.0f h chạy" % alt["runtime_h"]))
            self.duty = other
            other = 1 - self.duty
            self.duty_run_s = 0.0
            self.swap_until = t + alt["overlap_s"]
            self.force_rotate = False
        avail = sum(1 for p in pumps if not p["fault"])

        # ---- lớp an toàn đang chặn: giữ bộ điều khiển ở trạng thái dừng (không tích phân, không ghép bơm) ----
        if gw.safety.last_block:
            self.n = 0
            self.I = f_min
            self.stage_timer = 0.0
            self.destage_timer = 0.0
            self.sleep_state = "awake"
            self.last_f_ref = 0.0
            self.p_set = p_set
            return {"n": 0, "f_ref": 0.0, "order": [self.duty, 1 - self.duty], "p_set": p_set}

        # ---- chế độ TAY hoặc đang theo dõi sau khởi động lại: kịch bản tạm ngưng; trạng thái được đặt lại để tiếp quản êm ----
        if gw.manual is not None or gw.observe_until is not None:
            self.n = 0
            self.I = f_min
            self.stage_timer = 0.0
            self.destage_timer = 0.0
            self.sleep_state = "awake"
            self.last_f_ref = 0.0
            self.p_set = p_set
            return {"n": 0, "f_ref": 0.0, "order": [self.duty, 1 - self.duty], "p_set": p_set}

        # ---- kịch bản tùy biến của học viên ----
        if gw.custom_fn is not None:
            out = self._custom(t, dt, sig, gw, p_set, q, level)
            if out is not None:
                return out

        # ---- số bơm chạy ----
        prev_n = self.n
        if self.level_stop or avail == 0:
            self.n = 0
            self.sleep_state = "awake"
        else:
            if self.n == 0 and self.sleep_state == "awake":
                self.n = 1
            # ngủ đông khi lưu lượng rất nhỏ
            starts_recent = gw.pm.starts_last_hour(self.duty, t)
            if sl["enabled"] and self.n == 1 and self.sleep_state == "awake":
                if q < sl["q_on_m3h"] and self.last_f_ref <= f_min + 1.0 and starts_recent < self.max_starts - 2:
                    self.sleep_timer += dt
                else:
                    self.sleep_timer = 0.0
                if self.sleep_timer >= sl["t_s"]:
                    self.sleep_state = "boost"
                    self.boost_until = t + 20.0
                    self.sleep_timer = 0.0
                    gw.log_event(t, "info", "Lưu lượng rất nhỏ – tăng áp nạp bình tích áp rồi cho bơm ngủ")
            if self.sleep_state == "boost":
                p_set += sl["boost_bar"]
                if t >= self.boost_until:
                    self.sleep_state = "sleep"
            if self.sleep_state == "sleep":
                self.n = 0
                if (p_meas is not None and p_meas < p_set - sl["wake_delta_bar"]) or q > 2.0 * sl["q_on_m3h"]:
                    self.sleep_state = "awake"
                    self.n = 1
                    gw.log_event(t, "info", "Áp lực giảm – đánh thức bơm")
            # ghép / tách bơm
            err = (p_set - p_meas) if p_meas is not None else 0.0
            if self.n == 1:
                if self.last_f_ref >= st["f_on_hz"] - 1e-6 and err > st["err_on_bar"]:
                    self.stage_timer += dt
                else:
                    self.stage_timer = 0.0
                pre = predictive and q > 0.9 * pd["prestage_q_m3h"] and \
                    fc.max_over(t, t + 2.0 * pd["lead_min"] * 60.0) > pd["prestage_q_m3h"]
                if predictive and not pre:
                    # ghép theo mô hình: lưu lượng sắp vượt khả năng một bơm ở 50 Hz với áp đặt hiện tại
                    h_av = pm["h0_m"] - (p_set * self.m_per_bar - (level + self.z_s))
                    q_cap = math.sqrt(h_av / pm["k_m_per_m3h2"]) if h_av > 0 else 0.0
                    pre = q_ff > 0.97 * q_cap
                if avail >= 2 and (self.stage_timer >= st["t_on_s"] or pre):
                    self.n = 2
                    self.stage_timer = 0.0
                    self.destage_timer = 0.0
                    self.prestaged = pre
                    gw.log_event(t, "info", "Ghép bơm thứ hai %s" % ("sớm theo dự báo" if pre else "(bơm chính đã max tần số)"))
            elif self.n == 2:
                if self.last_f_ref <= st["f_off_hz"]:
                    self.destage_timer += dt
                else:
                    self.destage_timer = 0.0
                if self.destage_timer >= st["t_off_s"]:
                    guard = predictive and fc.max_over(t, t + pd["destage_guard_min"] * 60.0) > pd["prestage_q_m3h"]
                    if not guard:
                        self.n = 1
                        self.destage_timer = 0.0
                        gw.log_event(t, "info", "Tách bơm – một bơm đủ đáp ứng")
                    else:
                        self.destage_timer = st["t_off_s"]
                if avail < 2:
                    self.n = 1
        n_out = self.n
        order = [self.duty, 1 - self.duty]
        if self.swap_until is not None:
            if t < self.swap_until and self.n == 1:
                n_out = 2
            elif t >= self.swap_until:
                self.swap_until = None

        # ---- PI + bù trước (feed-forward) ----
        if n_out == 0:
            self.I = f_min
            f_ref = 0.0
        else:
            ff_on = predictive
            # số bơm thực sự đang góp lưu lượng (đã đạt tần số tối thiểu) – tránh "hụt" khi bơm mới còn đang tăng tốc
            n_eff = sum(1 for i, p in enumerate(pumps) if gw.pm.cmd[i] and p["running"] and p["f"] >= f_min - 0.5) or 1
            if n_out < n_eff:
                n_eff = n_out  # bơm sắp tách không còn được tính -> bơm còn lại tăng tốc ngay
            ff = self.f_estimate(p_set, level, q_ff, n_eff) if ff_on else 0.0
            if prev_n == 0:
                self.I = self.f_estimate(p_set, level, q, n_out) - ff
            elif ff_on != self.ff_on:
                self.I += (self.f_estimate(p_set, level, q, n_eff) if self.ff_on else 0.0) - ff
            elif ff_on and n_eff > self.ff_n:
                # ghép bơm: giữ nguyên tần số bơm chính cho tới khi bơm mới thực sự góp lưu lượng
                self.I += self.f_estimate(p_set, level, q_ff, self.ff_n) - ff
            self.ff_on = ff_on
            self.ff_n = n_eff
            if p_meas is None:
                f_ref = 40.0
                gw.alarms.raise_(t, "NO_PRESSURE", "alarm", "Mất tín hiệu áp lực – chạy tần số an toàn 40 Hz")
            else:
                gw.alarms.clear(t, "NO_PRESSURE")
                e = p_set - p_meas
                kp = pr["kp_hz_per_bar"]
                u = ff + kp * e + self.I
                ramp_limited = False
                for i in range(self.n_pumps):
                    if pumps[i]["running"] and abs(pumps[i]["f"] - self.last_f_ref) > 1.0 and self.last_f_ref > 0:
                        ramp_limited = True
                sat_hi = u >= f_max and e > 0
                sat_lo = u <= f_min and e < 0
                if not ramp_limited and not sat_hi and not sat_lo:
                    self.I += kp * dt / pr["ti_s"] * e
                self.I = clamp(self.I, f_min - ff - 10.0, f_max - ff + 10.0)
                u = ff + kp * e + self.I
                f_ref = clamp(u, f_min, f_max)
        self.last_f_ref = f_ref
        self.p_set = p_set
        self.q_ff = q_ff
        self.margin = margin
        return {"n": n_out, "f_ref": f_ref, "order": order, "p_set": p_set}

    def _custom(self, t, dt, sig, gw, p_set_default, q, level):
        inp = {
            "t": t, "hour": (t % 86400) / 3600.0, "dow": (gw.start_dow + int(t // 86400)) % 7,
            "p": sig["p_ctrl"], "q": q, "level": level, "q_in": sig["q_in_f"],
            "cl": sig["cl"], "ntu": sig["ntu"], "ph": sig["ph"],
            "online": gw.offline_since is None, "pumps": sig["pumps"], "dt": dt,
            "p_set_default": p_set_default, "duty": self.duty,
            "tte_h": self.tte_h,
            # hàm dự báo cho bài nâng cao: lưu lượng và độ lệch chuẩn dự báo sau 'giay' giây
            "du_bao": lambda giay=0.0: gw.forecaster.mean_at(t + giay),
            "do_lech": lambda giay=0.0: gw.forecaster.sigma_at(t + giay),
            "du_bao_max": lambda giay: gw.forecaster.max_over(t, t + giay),
        }
        try:
            out = gw.custom_fn(inp, self.custom_mem, gw.script["params"])
            n = int(out.get("n_pumps", 1))
            f_ref = float(out.get("f_ref", 0.0))
            if n < 0 or n > self.n_pumps or not (f_ref == f_ref):
                raise ValueError("đầu ra không hợp lệ")
            p_set = float(out.get("p_set", p_set_default))
            order = out.get("order", [self.duty, 1 - self.duty])
            self.strategy_used = "custom"
            self.p_set = p_set
            self.last_f_ref = f_ref
            self.n = n
            return {"n": n, "f_ref": f_ref, "order": list(order), "p_set": p_set}
        except Exception as exc:  # kịch bản lỗi -> dự phòng
            gw.custom_fn = None
            gw.alarms.raise_(t, "SCRIPT_ERROR", "alarm", "Kịch bản học viên lỗi (%s) – chuyển về kịch bản ngưỡng dựng sẵn" % exc)
            return None
