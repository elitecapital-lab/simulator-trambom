"""Nạp và chấm kịch bản điều khiển do học viên viết (student/*.py)."""
import importlib.util
import os

from .engine import TwinSim, load_config, load_scenarios


def load_custom(path):
    spec = importlib.util.spec_from_file_location("kich_ban_hoc_vien", os.path.abspath(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "dieu_khien"):
        raise AttributeError("File %s phải định nghĩa hàm dieu_khien(inp, mem, params)" % path)
    return mod.dieu_khien


def _run(fn, sc_id, hours, patch=None):
    cfg = load_config()
    if patch:
        for path, v in patch.items():
            cur = cfg
            keys = path.split(".")
            for k in keys[:-1]:
                cur = cur[k]
            cur[keys[-1]] = v
    sc = load_scenarios()[sc_id]
    twin = TwinSim(cfg, sc, "basic", fn)
    # đếm thời gian bơm chạy khi mức bể dưới ngưỡng dừng của kịch bản
    low_run = 0.0
    n = int(round(hours * 3600.0 / twin.dt))
    for _ in range(n):
        twin.step()
        pl = twin.smart.plant
        if pl.level < cfg["script"]["params"]["level"]["stop_m"] - 0.02 and any(p.running for p in pl.pumps):
            low_run += twin.dt
    res = twin.result()
    res["low_run_min"] = low_run / 60.0
    res["custom_failed"] = twin.smart.gw.custom_fn is None
    return res


def check(path, quick=False):
    """Chạy bộ kiểm tra tự động cho kịch bản theo ngưỡng của học viên. Trả về danh sách (tên, đạt?, chi tiết)."""
    fn = load_custom(path)
    results = []
    h = 8 if quick else 24
    r1 = _run(fn, "S1", h)
    s, f = r1["smart"], r1["fixed"]
    results.append(("Kịch bản chạy không lỗi suốt S1", not r1["custom_failed"], "gateway %s chuyển về kịch bản dự phòng" % ("ĐÃ" if r1["custom_failed"] else "không")))
    results.append(("Áp lực đạt dải ≥ 98 % thời gian (S1)", s["pct_in_band"] >= 98.0, "%.1f %%" % s["pct_in_band"]))
    results.append(("Điện năng thấp hơn lịch cố định ≥ 20 % (S1)", s["energy_kwh"] <= 0.8 * f["energy_kwh"],
                    "%.1f kWh so với %.1f kWh" % (s["energy_kwh"], f["energy_kwh"])))
    results.append(("Áp đầu ra không vượt 4,0 bar (S1)", s["t_high_min"] < 1.0, "%.1f phút > 4,0 bar" % s["t_high_min"]))
    results.append(("Số lần khởi động bơm ≤ 12 (S1)", s["starts_total"] <= 12, "%d lần" % s["starts_total"]))
    r6 = _run(fn, "S6", 24 if not quick else 20)
    results.append(("Dừng bơm khi mức < 0,6 m (S6: không chạy dưới ngưỡng)", r6["low_run_min"] < 1.0, "%.1f phút bơm chạy dưới 0,58 m" % r6["low_run_min"]))
    results.append(("Không chạy khô (S6)", r6["smart"]["dry_run_min"] == 0.0, "%.1f phút" % r6["smart"]["dry_run_min"]))
    r7 = _run(fn, "S7", 12)
    results.append(("Vẫn cấp nước khi bơm chính hỏng (S7: đạt dải ≥ 95 %)", r7["smart"]["pct_in_band"] >= 95.0, "%.1f %%" % r7["smart"]["pct_in_band"]))
    ra = _run(fn, "S1", 10, {"script.params.alternation.runtime_h": 4.0})
    rh = ra["smart"]["run_h"]
    results.append(("Luân phiên bơm (runtime 4 h → cả hai bơm đều chạy ≥ 2 h trong 10 h)", min(rh) >= 2.0, "P-01 %.1f h, P-02 %.1f h" % tuple(rh)))
    return results
