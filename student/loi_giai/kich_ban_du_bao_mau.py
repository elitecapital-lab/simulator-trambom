"""LỜI GIẢI THAM KHẢO (giảng viên) – điều khiển dự báo. So sánh: python -m trambom run S10 --script <file>."""

F_MIN, F_MAX = 25.0, 50.0


def _clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def dieu_khien(inp, mem, params):
    pr, st, lv, pd = params["pressure"], params["staging"], params["level"], params["predictive"]
    dt = inp["dt"]
    q = inp["q"] or 0.0
    level = inp["level"]
    lead = pd["lead_min"] * 60.0
    sigma = inp["do_lech"](0.0)
    q_ff = q + max(0.0, inp["du_bao"](lead) - inp["du_bao"](0.0))
    margin = _clamp(pd["margin_min_bar"] + pd["k_sigma"] * 2.0 * pr["r_est"] * q_ff * sigma, pd["margin_min_bar"], pd["margin_max_bar"])
    p_set = _clamp(pd["p_crit_req_bar"] + margin + pr["dz_bar"] + pr["r_est"] * q_ff * q_ff, pr["p_set_min_bar"], pr["p_set_max_bar"])
    if not inp["online"]:
        p_set += params["offline"]["margin_bar"]
    delta = lv["conserve_delta_bar"] if level < lv["conserve_m"] else 0.0
    tte = inp["tte_h"]
    if tte is not None:
        if tte < pd["tte_crit_h"]:
            delta = min(delta, pd["tte_delta2_bar"])
        elif tte < pd["tte_warn_h"]:
            delta = min(delta, pd["tte_delta1_bar"])
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
    if n == 1:
        mem["t_on"] = mem.get("t_on", 0.0) + dt if (f_ref >= st["f_on_hz"] and e > st["err_on_bar"]) else 0.0
        pre = q > 0.9 * pd["prestage_q_m3h"] and inp["du_bao_max"](2.0 * lead) > pd["prestage_q_m3h"]
        h_av = 44.0 - (p_set * 10.194 - (level + 0.3))
        if h_av > 0 and q_ff > 0.97 * (h_av / 0.015) ** 0.5:
            pre = True
        if mem["t_on"] >= st["t_on_s"] or pre:
            n, mem["t_on"], mem["t_off"] = 2, 0.0, 0.0
    else:
        mem["t_off"] = mem.get("t_off", 0.0) + dt if f_ref <= st["f_off_hz"] else 0.0
        if mem["t_off"] >= st["t_off_s"]:
            if inp["du_bao_max"](pd["destage_guard_min"] * 60.0) > pd["prestage_q_m3h"]:
                mem["t_off"] = st["t_off_s"]
            else:
                n, mem["t_off"] = 1, 0.0
    mem["n"] = n
    return {"n_pumps": n, "f_ref": f_ref, "p_set": p_set, "order": order}
