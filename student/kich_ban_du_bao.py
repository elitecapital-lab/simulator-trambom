"""BÀI TẬP NÂNG CAO – Điều khiển dự báo theo mẫu sử dụng nước theo giờ và ngày.

Xuất phát từ kịch bản theo ngưỡng (đã hoàn chỉnh trong file này), bổ sung các phần TODO:
  A. Biên áp lực theo độ bất định của dự báo (thay vì biên cố định 0,2 bar).
  B. Bù trước (feed-forward) lưu lượng sắp tăng trong lead_min phút tới.
  C. Ghép bơm sớm khi dự báo lưu lượng vượt khả năng một bơm; không tách bơm nếu sắp tới lại cao điểm.
  D. Giảm áp sớm khi dự báo bể sắp cạn (inp["tte_h"] – giờ còn lại trước khi bể chạm mức dừng).

Hàm dự báo có trong inp:
  inp["du_bao"](giay)      – lưu lượng dự báo (m³/h) tại thời điểm t + giay
  inp["do_lech"](giay)     – độ lệch chuẩn dự báo (m³/h)
  inp["du_bao_max"](giay)  – lưu lượng dự báo lớn nhất trong khoảng [t, t + giay]
  inp["tte_h"]             – dự báo thời gian cạn bể (h) hoặc None

Chạy và so sánh với kịch bản dựng sẵn mức nâng cao:
  python -m trambom run S10 --script student/kich_ban_du_bao.py
  python -m trambom run S10 --level advanced
Tiêu chí gợi ý: kWh ≤ kịch bản ngưỡng, phút áp thấp không tăng, số lần khởi động bơm không tăng.
"""

F_MIN, F_MAX = 25.0, 50.0


def _clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def dieu_khien(inp, mem, params):
    pr, st, lv, pd = params["pressure"], params["staging"], params["level"], params["predictive"]
    dt = inp["dt"]
    q = inp["q"] or 0.0
    level = inp["level"]

    # --- A. biên áp lực theo độ bất định ---
    # TODO A: margin = margin_min_bar + k_sigma · 2·r_est·Q·σ  (kẹp trong [margin_min_bar, margin_max_bar])
    #         rồi dùng p_crit_req_bar + margin thay cho p_crit_target_bar
    p_crit = pr["p_crit_target_bar"]

    # --- B. bù trước lưu lượng ---
    # TODO B: q_ff = q + max(0, du_bao(lead_min·60) − du_bao(0))
    q_ff = q

    p_set = _clamp(p_crit + pr["dz_bar"] + pr["r_est"] * q_ff * q_ff, pr["p_set_min_bar"], pr["p_set_max_bar"])
    if not inp["online"]:
        p_set += params["offline"]["margin_bar"]

    # --- D. giảm áp sớm theo dự báo cạn bể ---
    # TODO D: nếu tte_h < tte_crit_h giảm tte_delta2_bar; nếu < tte_warn_h giảm tte_delta1_bar
    delta = lv["conserve_delta_bar"] if level < lv["conserve_m"] else 0.0
    if delta < 0:
        p_set = max(p_set + delta, min(p_set, lv["p_set_conserve_min_bar"]))

    order = [inp["duty"], 1 - inp["duty"]]
    if mem.get("dung_muc"):
        if level > lv["restart_m"]:
            mem["dung_muc"] = False
    elif level < lv["stop_m"]:
        mem["dung_muc"] = True
    if mem.get("dung_muc"):
        mem["I"], mem["n"] = F_MIN, 0
        return {"n_pumps": 0, "f_ref": 0.0, "p_set": p_set, "order": order}

    n = mem.get("n", 0) or 1
    if mem.get("n", 0) == 0:
        mem["I"] = 35.0
    p = inp["p"]
    if p is None:
        return {"n_pumps": n, "f_ref": 40.0, "p_set": p_set, "order": order}
    e = p_set - p
    kp, ti = pr["kp_hz_per_bar"], pr["ti_s"]
    I = mem.get("I", 35.0)
    u = kp * e + I
    if not ((u >= F_MAX and e > 0) or (u <= F_MIN and e < 0)):
        I += kp * dt / ti * e
    mem["I"] = I = _clamp(I, F_MIN - 10, F_MAX + 10)
    f_ref = _clamp(kp * e + I, F_MIN, F_MAX)

    # --- C. ghép / tách bơm ---
    if n == 1:
        mem["t_on"] = mem.get("t_on", 0.0) + dt if (f_ref >= st["f_on_hz"] and e > st["err_on_bar"]) else 0.0
        # TODO C1: ghép sớm nếu q > 0,9·prestage_q và du_bao_max(2·lead_min·60) > prestage_q_m3h
        # TODO C3 (tùy chọn): ghép theo mô hình – khả năng một bơm ở 50 Hz với áp đặt hiện tại:
        #          q_cap = sqrt((H0 − (p_set·10,19 − (level + 0,3))) / K); ghép nếu q_ff > 0,97·q_cap
        if mem["t_on"] >= st["t_on_s"]:
            n, mem["t_on"] = 2, 0.0
    else:
        mem["t_off"] = mem.get("t_off", 0.0) + dt if f_ref <= st["f_off_hz"] else 0.0
        # TODO C2: không tách nếu du_bao_max(destage_guard_min·60) > prestage_q_m3h
        if mem["t_off"] >= st["t_off_s"]:
            n, mem["t_off"] = 1, 0.0
    mem["n"] = n
    return {"n_pumps": n, "f_ref": f_ref, "p_set": p_set, "order": order}
