"""Xuất báo cáo: bảng so sánh KPI (Markdown) và biểu đồ theo thời gian (matplotlib)."""
import json
import math
import os

from .util import fmt_hm

SMART = "#2a78d6"
SMART2 = "#6250d6"
FIXED = "#eb6834"
CRIT = "#1baf7a"
MUTED = "#898781"
GRID = "#e1e0d9"
INK = "#52514e"
BAND = "#cde2fb"
OFFLINE = "#ecebe6"
STOP = "#f6d6d6"


def _f(v, nd=1, unit=""):
    if v is None:
        return "–"
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return "–"
    if isinstance(v, (int,)) and not isinstance(v, bool):
        return "%d%s" % (v, unit)
    s = ("%." + str(nd) + "f") % v
    s = s.replace(".", ",")
    return s + unit


def detection_text(incidents):
    if not incidents:
        return "–"
    parts = []
    for inc in incidents:
        if inc["detected"] is None:
            parts.append("không phát hiện")
        else:
            parts.append("%.0f phút" % ((inc["detected"] - inc["t"]) / 60.0))
    return "; ".join(parts)


def kpi_rows(fixed, basic, adv):
    """Các dòng của bảng so sánh: (tên chỉ số, lịch cố định, thông minh cơ bản, thông minh nâng cao)."""
    cols = [fixed, basic, adv]

    def g(key, nd=1, unit=""):
        return [_f(c.get(key) if c else None, nd, unit) for c in cols]

    def saving(c):
        if c is None or fixed is None or not fixed["energy_kwh"]:
            return "–"
        return _f(100.0 * (1.0 - c["energy_kwh"] / fixed["energy_kwh"]), 1, " %")

    rows = [
        ("Điện năng tiêu thụ (kWh)", g("energy_kwh", 1)),
        ("Tiết kiệm so với lịch cố định", ["–", saving(basic), saving(adv)]),
        ("Suất điện năng (kWh/m³ cấp vào mạng)", g("specific_kwh_m3", 3)),
        ("Nước cấp vào mạng (m³)", g("delivered_m3", 0)),
        ("Rò rỉ trên mạng (m³)", g("leak_m3", 1)),
        ("Thiếu nước thực sự – bồn mái cạn (m³)", g("unserved_m3", 1)),
        ("Áp lực ngoài dải – tổng (phút)", g("t_out_min", 0)),
        ("  · áp điểm bất lợi < 1,4 bar (phút)", g("t_low_min", 0)),
        ("  · áp đầu ra > 4,0 bar (phút)", g("t_high_min", 0)),
        ("Thời gian đạt dải áp (%)", g("pct_in_band", 1)),
        ("Áp đầu ra lớn nhất (bar)", g("p_out_max", 2)),
        ("Số đợt cấp nước không đạt QCVN", g("quality_episodes", 0)),
        ("Lượng nước không đạt QCVN đã cấp (m³)", g("quality_viol_m3", 1)),
        ("Số lần khởi động bơm (P-01 + P-02)", [("%d (%d + %d)" % (c["starts_total"], c["starts"][0], c["starts"][1])) if c else "–" for c in cols]),
        ("Giờ chạy P-01 / P-02 (h)", [("%s / %s" % (_f(c["run_h"][0], 1), _f(c["run_h"][1], 1))) if c else "–" for c in cols]),
        ("Thời gian bơm chạy khô (phút)", g("dry_run_min", 1)),
        ("Thời gian phát hiện sự cố", [detection_text(c["incidents"]) if c else "–" for c in cols]),
    ]
    return rows


def kpi_table_md(fixed, basic, adv):
    lines = ["| Chỉ số | Lịch cố định | Thông minh – cơ bản (ngưỡng) | Thông minh – nâng cao (dự báo) |",
             "|---|---:|---:|---:|"]
    for name, vals in kpi_rows(fixed, basic, adv):
        lines.append("| %s | %s |" % (name, " | ".join(vals)))
    return "\n".join(lines)


def comms_table_md(basic, adv):
    lines = ["| Chỉ số truyền thông & đồng bộ | Cơ bản | Nâng cao |", "|---|---:|---:|"]

    def row(name, fn):
        lines.append("| %s | %s | %s |" % (name, fn(basic), fn(adv)))

    row("Thời gian mất mạng (phút)", lambda c: _f(c["comms"]["offline_s"] / 60.0, 0))
    row("Bản ghi đo xa sinh ra", lambda c: "%d" % c["comms"]["generated"])
    row("Độ đầy bộ đệm lớn nhất (%)", lambda c: _f(100 * c["comms"]["max_fill"], 1))
    row("Số lần nén bộ đệm", lambda c: "%d" % c["comms"]["compactions"])
    row("Bản ghi bị mất do tràn", lambda c: "%d" % c["comms"]["dropped"])
    row("Độ đầy đủ dữ liệu tại máy chủ (%)", lambda c: _f(100 * c.get("completeness", 1.0), 1))
    row("Bản ghi đến muộn (phát lại sau đồng bộ)", lambda c: "%d" % c.get("server_late", 0))
    row("Số xung đột tham số đã giải quyết", lambda c: "%d" % c.get("conflicts", 0))
    row("SMS dự phòng đã gửi", lambda c: "%d" % c.get("sms", 0))
    row("Dữ liệu lên / xuống (kB)", lambda c: "%s / %s" % (_f(c["bytes_up"] / 1000.0, 0), _f(c["bytes_down"] / 1000.0, 0)))
    row("Sai số dự báo MAPE (%)", lambda c: _f(100 * c["forecast_mape"], 1) if c.get("forecast_mape") is not None else "–")
    return "\n".join(lines)


def _spans(t, flag):
    spans = []
    start = None
    for ti, f in zip(t, flag):
        if f and start is None:
            start = ti
        elif not f and start is not None:
            spans.append((start, ti))
            start = None
    if start is not None:
        spans.append((start, t[-1]))
    return spans


def plot_result(res_basic, res_adv, path, title=""):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    hb = res_basic["smart_hist"]
    ha = res_adv["smart_hist"] if res_adv else None
    hf = res_basic["fixed_hist"]
    th = [x / 3600.0 for x in hb["t"]]
    tf = [x / 3600.0 for x in hf["t"]]
    ta = [x / 3600.0 for x in ha["t"]] if ha else None
    plt.rcParams.update({"font.size": 9, "axes.edgecolor": "#c3c2b7", "axes.labelcolor": INK, "xtick.color": INK,
                         "ytick.color": INK, "axes.titlesize": 10, "axes.titleweight": "bold", "axes.titlecolor": "#0b0b0b",
                         "axes.titlelocation": "left"})
    fig, axes = plt.subplots(6, 1, figsize=(11, 15), sharex=True)
    offline = _spans(th, [o < 0.5 for o in hb["online"]])
    dstop = _spans(th, [m == 3 for m in hb["mode"]])

    def shade(ax):
        for a, b in offline:
            ax.axvspan(a, b, color=OFFLINE, lw=0, zorder=0)
        for a, b in dstop:
            ax.axvspan(a, b, color=STOP, lw=0, zorder=0, alpha=0.7)
        ax.grid(True, color=GRID, lw=0.6)
        ax.set_axisbelow(True)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)

    ax = axes[0]
    shade(ax)
    ax.axhspan(1.4, 4.0, color=BAND, alpha=0.35, lw=0, zorder=0)
    ax.plot(tf, hf["p_out"], color=FIXED, lw=1.0, label="Đầu ra – lịch cố định")
    ax.plot(th, hb["p_out"], color=SMART, lw=1.2, label="Đầu ra – thông minh cơ bản")
    if ha:
        ax.plot(ta, ha["p_out"], color=SMART2, lw=1.0, label="Đầu ra – thông minh nâng cao")
    ax.plot(th, hb["p_crit"], color=CRIT, lw=1.0, label="Điểm bất lợi – thông minh cơ bản")
    ax.axhline(1.4, color=MUTED, lw=0.8, ls="--")
    ax.axhline(4.0, color=MUTED, lw=0.8, ls="--")
    ax.set_ylabel("bar")
    ax.set_ylim(-0.5, 5.0)
    ax.set_title("Áp lực (dải cho phép: điểm bất lợi ≥ 1,4 bar, đầu ra ≤ 4,0 bar)")
    ax.legend(loc="upper right", ncol=2, fontsize=8, frameon=False)

    ax = axes[1]
    shade(ax)
    ax.plot(tf, hf["q_out"], color=FIXED, lw=1.0, label="Lịch cố định")
    ax.plot(th, hb["q_out"], color=SMART, lw=1.2, label="Thông minh cơ bản")
    if ha:
        ax.plot(ta, ha["q_out"], color=SMART2, lw=1.0, label="Thông minh nâng cao")
        ax.plot(ta, ha["q_fc"], color=MUTED, lw=1.0, ls="--", label="Dự báo (nâng cao)")
    ax.set_ylabel("m³/h")
    ax.set_title("Lưu lượng cấp vào mạng lưới")
    ax.legend(loc="upper right", ncol=4, fontsize=8, frameon=False)

    ax = axes[2]
    shade(ax)
    ax.plot(tf, hf["kw"], color=FIXED, lw=1.0, label="Lịch cố định")
    ax.plot(th, hb["kw"], color=SMART, lw=1.2, label="Thông minh cơ bản")
    if ha:
        ax.plot(ta, ha["kw"], color=SMART2, lw=1.0, label="Thông minh nâng cao")
    ax.set_ylabel("kW")
    ax.set_title("Công suất điện tiêu thụ")
    ax.legend(loc="upper right", ncol=3, fontsize=8, frameon=False)

    ax = axes[3]
    shade(ax)
    ax.plot(tf, hf["kwh"], color=FIXED, lw=1.5, label="Lịch cố định")
    ax.plot(th, hb["kwh"], color=SMART, lw=1.5, label="Thông minh cơ bản")
    if ha:
        ax.plot(ta, ha["kwh"], color=SMART2, lw=1.5, label="Thông minh nâng cao")
    for x, y, c in ((tf[-1], hf["kwh"][-1], FIXED), (th[-1], hb["kwh"][-1], SMART)):
        ax.annotate("%.1f kWh" % y, (x, y), xytext=(4, 0), textcoords="offset points", fontsize=8, color=INK, va="center")
    ax.set_ylabel("kWh")
    ax.set_title("Điện năng lũy kế")
    ax.legend(loc="upper left", ncol=3, fontsize=8, frameon=False)

    ax = axes[4]
    shade(ax)
    ax.plot(tf, hf["level"], color=FIXED, lw=1.0, label="Lịch cố định")
    ax.plot(th, hb["level"], color=SMART, lw=1.2, label="Thông minh cơ bản")
    if ha:
        ax.plot(ta, ha["level"], color=SMART2, lw=1.0, label="Thông minh nâng cao")
    ax.axhline(0.6, color=MUTED, lw=0.8, ls="--")
    ax.set_ylabel("m")
    ax.set_ylim(0, 4.2)
    ax.set_title("Mực nước bể chứa T-01 (đường đứt: mức dừng bơm 0,6 m)")
    ax.legend(loc="lower left", ncol=3, fontsize=8, frameon=False)

    ax = axes[5]
    shade(ax)
    ax.plot(th, hb["ntu"], color=SMART, lw=1.2, label="Độ đục (NTU)")
    ax.plot(th, hb["cl"], color=CRIT, lw=1.2, label="Clo dư (mg/L)")
    ax.axhline(2.0, color=MUTED, lw=0.8, ls="--")
    ax.axhline(0.2, color=MUTED, lw=0.8, ls=":")
    ax.set_title("Chất lượng nước trong bể (đứt: độ đục 2 NTU; chấm: clo dư 0,2 mg/L)")
    ax.legend(loc="upper right", ncol=2, fontsize=8, frameon=False)
    ax.set_xlabel("Giờ kể từ 00:00 Thứ Hai (nền xám: mất mạng; nền hồng: chế độ (d) cảnh báo/dừng an toàn)")
    hours = th[-1]
    step = 2 if hours <= 24 else (6 if hours <= 48 else 24)
    ax.set_xticks([i for i in range(0, int(hours) + 1, step)])
    if title:
        fig.suptitle(title, x=0.01, ha="left", fontsize=12, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.98))
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)


def timeline_md(res, max_lines=40, levels=("alarm", "critical", "safety", "info", "warning")):
    lines = []
    for l in res["gw_logs"]:
        if l["level"] in levels and "Hết báo động" not in l["text"]:
            day = int(l["t"] // 86400)
            lines.append("- `N%d %s` %s" % (day + 1, fmt_hm(l["t"]), l["text"]))
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ["- … (%d dòng nữa)" % (len(lines) - max_lines)]
    return "\n".join(lines)


def save_json(obj, path):
    def clean(o):
        if isinstance(o, float):
            return None if (math.isnan(o) or math.isinf(o)) else round(o, 5)
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items() if k not in ("seen", "series", "link")}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, set):
            return len(o)
        return o
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, ensure_ascii=False, indent=1)
