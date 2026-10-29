"""LỜI GIẢI THAM KHẢO (dành cho giảng viên) – kịch bản điều khiển theo ngưỡng.

python -m trambom check-student student/loi_giai/kich_ban_nguong_mau.py
"""

F_MIN, F_MAX = 25.0, 50.0


def _clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def dieu_khien(inp, mem, params):
    pr, st, lv, alt = params["pressure"], params["staging"], params["level"], params["alternation"]
    dt = inp["dt"]
    q = inp["q"] or 0.0
    level = inp["level"]
    pumps = inp["pumps"]

    # 1) áp lực đặt theo lưu lượng
    p_set = _clamp(pr["p_crit_target_bar"] + pr["dz_bar"] + pr["r_est"] * q * q, pr["p_set_min_bar"], pr["p_set_max_bar"])
    if not inp["online"]:
        p_set += params["offline"]["margin_bar"]
    if level < lv["conserve_m"]:
        p_set = max(p_set + lv["conserve_delta_bar"], min(p_set, lv["p_set_conserve_min_bar"]))

    # 5) luân phiên theo giờ chạy (tính trước để dùng cho thứ tự)
    duty = mem.setdefault("duty", 0)
    run_now = pumps[duty]["run_s"]
    mem.setdefault("run_mark", run_now)
    other = 1 - duty
    if pumps[duty]["fault"] and not pumps[other]["fault"]:
        duty, mem["run_mark"] = other, pumps[other]["run_s"]
    elif run_now - mem["run_mark"] >= alt["runtime_h"] * 3600.0 and not pumps[other]["fault"]:
        duty, mem["run_mark"] = other, pumps[other]["run_s"]
    mem["duty"] = duty
    order = [duty, 1 - duty]

    # 2) dừng theo mức có trễ
    if mem.get("dung_muc"):
        if level > lv["restart_m"]:
            mem["dung_muc"] = False
    elif level < lv["stop_m"]:
        mem["dung_muc"] = True
    if mem.get("dung_muc"):
        mem["I"] = F_MIN
        mem["n"] = 0
        return {"n_pumps": 0, "f_ref": 0.0, "p_set": p_set, "order": order}

    n = mem.get("n", 0) or 1
    if mem.get("n", 0) == 0:
        mem["I"] = 35.0  # khởi động không giật
    p = inp["p"]
    if p is None:
        f_ref = 40.0
    else:
        # 3) PI có chống bão hòa
        e = p_set - p
        kp, ti = pr["kp_hz_per_bar"], pr["ti_s"]
        I = mem.get("I", 35.0)
        u = kp * e + I
        if not ((u >= F_MAX and e > 0) or (u <= F_MIN and e < 0)):
            I += kp * dt / ti * e
        I = _clamp(I, F_MIN - 10.0, F_MAX + 10.0)
        mem["I"] = I
        f_ref = _clamp(kp * e + I, F_MIN, F_MAX)
        # 4) ghép / tách bơm
        if n == 1:
            mem["t_on"] = mem.get("t_on", 0.0) + dt if (f_ref >= st["f_on_hz"] and e > st["err_on_bar"]) else 0.0
            if mem["t_on"] >= st["t_on_s"]:
                n, mem["t_on"] = 2, 0.0
        else:
            mem["t_off"] = mem.get("t_off", 0.0) + dt if f_ref <= st["f_off_hz"] else 0.0
            if mem["t_off"] >= st["t_off_s"]:
                n, mem["t_off"] = 1, 0.0
    mem["n"] = n
    return {"n_pumps": n, "f_ref": f_ref, "p_set": p_set, "order": order}
