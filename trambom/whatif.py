"""Phân tích "nếu không lắp": giá trị của từng hạng mục giải pháp/khuyến nghị, đo bằng KPI mô phỏng.

Mỗi trường hợp chạy cùng một kịch bản hai lần (có lắp / không lắp), cùng chuỗi nhiễu, chỉ khác cfg["hardware"].
"""
from .engine import TwinSim, load_config, load_scenarios

HW_LABEL = {
    "VFD_PID_fallback": "Rơ-le watchdog + PID nội biến tần",
    "PT-102": "Cảm biến áp lực thứ hai PT-102",
    "AIT-201": "Máy đo clo dư online AIT-201",
    "AIT-202": "Máy đo độ đục online AIT-202",
    "AIT-203": "Máy đo pH online AIT-203",
    "MV-02": "Van điện đầu ra MV-02",
    "SMS": "Modem 4G có SMS dự phòng",
    "FT-100_pulse": "Đầu ra xung của đồng hồ nước vào FT-100",
}
METRIC_LABEL = {
    "t_out_min": ("Áp ngoài dải dịch vụ", "phút", 0),
    "t_high_min": ("Áp đầu ra > 4,0 bar", "phút", 0),
    "p_out_max": ("Áp đầu ra lớn nhất", "bar", 2),
    "p_crit_min": ("Áp nhỏ nhất tại điểm bất lợi", "bar", 2),
    "energy_kwh": ("Điện năng", "kWh", 1),
    "quality_viol_m3": ("Nước không đạt QCVN đã cấp", "m³", 1),
    "detect_min": ("Thời gian phát hiện sự cố", "phút", 1),
    "notify_max_min": ("Báo động nghiêm trọng tới người trực chậm nhất", "phút", 1),
    "unserved_m3": ("Nước dân thiếu (bồn mái cạn)", "m³", 1),
}
# (tùy chọn phần cứng, kịch bản, mức, các chỉ số cần so sánh[, cấu hình bổ sung, nhãn bổ sung])
CASES = [
    ("VFD_PID_fallback", "S11", "basic", ["t_out_min", "p_crit_min", "unserved_m3"]),
    ("VFD_PID_fallback", "S11", "basic", ["t_out_min", "p_crit_min"], {"fallback.io_safe_state": "hold"}, "I/O cấu hình giữ lệnh cuối"),
    ("PT-102", "S5", "basic", ["t_high_min", "p_out_max", "detect_min"]),
    ("PT-102", "S5", "advanced", ["t_high_min", "t_out_min", "detect_min"]),
    ("AIT-202", "S4", "basic", ["quality_viol_m3", "detect_min"]),
    ("AIT-201", "S9", "basic", ["quality_viol_m3", "detect_min"]),
    ("AIT-203", "S13", "basic", ["quality_viol_m3", "detect_min"]),
    ("MV-02", "S4", "basic", ["quality_viol_m3", "t_out_min"]),
    ("SMS", "S9", "basic", ["notify_max_min"]),
    ("FT-100_pulse", "S6", "advanced", ["detect_min", "t_out_min"]),
]


def config_with(off=(), cfg=None):
    cfg = cfg or load_config()
    for opt in off:
        if opt not in cfg["hardware"] or opt == "note":
            raise KeyError("không có tùy chọn phần cứng '%s' (có: %s)" % (opt, ", ".join(k for k in cfg["hardware"] if k != "note")))
        cfg["hardware"][opt] = False
    return cfg


def metrics(s):
    inc = s["incidents"][0] if s["incidents"] else None
    det = None
    if inc is not None and inc["detected"] is not None:
        det = (inc["detected"] - inc["t"]) / 60.0
    return {"t_out_min": s["t_out_min"], "t_high_min": s["t_high_min"], "t_low_min": s["t_low_min"],
            "p_out_max": s["p_out_max"], "p_crit_min": s["p_crit_min"], "energy_kwh": s["energy_kwh"],
            "quality_viol_m3": s["quality_viol_m3"], "detect_min": det, "detect_how": inc["how"] if inc else None,
            "notify_max_min": s["notify"]["max_delay_min"], "dry_run_min": s["dry_run_min"], "unserved_m3": s["unserved_m3"]}


def _apply(cfg, overrides):
    for path, v in (overrides or {}).items():
        node = cfg
        keys = path.split(".")
        for k in keys[:-1]:
            node = node[k]
        node[keys[-1]] = v
    return cfg


def run_case(job):
    opt, sc_id, level, installed, overrides = job
    cfg = _apply(load_config(), dict(overrides))
    cfg["hardware"][opt] = installed
    r = TwinSim(cfg, load_scenarios()[sc_id], level, with_fixed=False).run()
    return job, metrics(r["smart"])


def run_all(jobs=4, progress=None):
    from concurrent.futures import ProcessPoolExecutor
    cases = [(c[0], c[1], c[2], c[3], tuple(sorted((c[4] if len(c) > 4 else {}).items())), c[5] if len(c) > 5 else "") for c in CASES]
    work = [(o, sc, lv, inst, ov) for o, sc, lv, _, ov, _ in cases for inst in (True, False)]
    res = {}
    with ProcessPoolExecutor(max_workers=jobs) as ex:
        for job, m in ex.map(run_case, work):
            res[job] = m
            if progress:
                progress(job)
    out = []
    for o, sc, lv, keys, ov, note in cases:
        out.append({"option": o, "label": HW_LABEL[o] + (" – " + note if note else ""), "scenario": sc, "level": lv, "metrics": keys,
                    "with": res[(o, sc, lv, True, ov)], "without": res[(o, sc, lv, False, ov)]})
    return out


def _fmt(v, nd):
    if v is None:
        return "không phát hiện"
    return ("%.*f" % (nd, v)).replace(".", ",")


def table_md(rows):
    lv_name = {"basic": "cơ bản", "advanced": "nâng cao"}
    md = ["| Hạng mục (tắt đi để thử) | Kịch bản · mức | Chỉ số | Có lắp | Không lắp |", "|---|---|---|---:|---:|"]
    for r in rows:
        for i, k in enumerate(r["metrics"]):
            name, unit, nd = METRIC_LABEL[k]
            a, b = r["with"][k], r["without"][k]
            if k == "detect_min":
                a_s = _fmt(a, nd) + (" (%s)" % r["with"]["detect_how"] if a is not None else "")
                b_s = _fmt(b, nd) + (" (%s)" % r["without"]["detect_how"] if b is not None else "")
            else:
                a_s, b_s = _fmt(a, nd), _fmt(b, nd)
            head = "**%s** `%s`" % (r["label"], r["option"]) if i == 0 else ""
            sc = "%s · %s" % (r["scenario"], lv_name[r["level"]]) if i == 0 else ""
            md.append("| %s | %s | %s (%s) | %s | %s |" % (head, sc, name, unit, a_s, b_s))
    return "\n".join(md)
