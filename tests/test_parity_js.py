"""Đối chiếu lõi mô phỏng Python và JavaScript (bản web 3D) trên cùng kịch bản, cùng hạt giống.

Hai bản dùng cùng bộ sinh ngẫu nhiên mulberry32 nên chuỗi nhiễu trùng khớp; sai khác còn lại chỉ do
hàm toán học (exp, log, cos) của hai thư viện chuẩn – kết quả KPI phải gần như trùng nhau."""
import json
import os
import shutil
import subprocess

import pytest

from trambom.engine import TwinSim, load_config, load_scenarios

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

# (kịch bản, mức, số giờ, thiết bị không lắp)
CASES = [("S3", "basic", 15.0, ()), ("S4", "basic", 16.0, ()), ("S5", "advanced", 10.0, ()), ("S8", "advanced", 4.0, ()),
         ("S11", "basic", 24.0, ()), ("S11", "basic", 24.0, ("VFD_PID_fallback",)), ("S12", "basic", 17.0, ()),
         ("S5", "basic", 10.0, ("PT-102",)), ("S4", "basic", 16.0, ("AIT-202",)), ("S6", "advanced", 11.0, ("FT-100_pulse",)),
         ("S9", "basic", 41.0, ("SMS",)), ("S13", "basic", 22.0, ()), ("S4", "basic", 22.0, ("MV-02",)),
         ("S12", "advanced", 17.0, ())]


def run_js(sid, level, hours, off=()):
    args = [NODE, os.path.join(ROOT, "tools", "run_js_sim.mjs"), sid, level, str(hours)]
    if off:
        args.append("--off=" + ",".join(off))
    out = subprocess.run(args, capture_output=True, text=True, check=True, cwd=ROOT)
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="cần Node.js để chạy bản JavaScript")
@pytest.mark.parametrize("sid,level,hours,off", CASES)
def test_python_and_js_engines_agree(sid, level, hours, off):
    cfg = load_config()
    for o in off:
        cfg["hardware"][o] = False
    py = TwinSim(cfg, load_scenarios()[sid], level).run(hours=hours)
    js = run_js(sid, level, hours, off)
    for side in ("smart", "fixed"):
        a, b = py[side], js[side]
        assert abs(a["energy_kwh"] - b["energy_kwh"]) <= 0.01 * a["energy_kwh"] + 0.05, (side, a["energy_kwh"], b["energy_kwh"])
        assert abs(a["t_out_min"] - b["t_out_min"]) <= 0.02 * a["t_out_min"] + 1.0, (side, a["t_out_min"], b["t_out_min"])
        assert abs(a["delivered_m3"] - b["delivered_m3"]) <= 0.01 * a["delivered_m3"] + 0.1
        assert abs(a["quality_viol_m3"] - b["quality_viol_m3"]) <= 0.3
        assert abs(a["starts_total"] - b["starts_total"]) <= 1
    assert py["smart"]["comms"]["generated"] == js["smart"]["comms"]["generated"]
    assert py["smart"]["conflicts"] == js["smart"]["conflicts"]
    assert py["smart"]["alarms_raised"] == js["smart"]["alarms_raised"]
    a, b = py["smart"], js["smart"]
    assert abs(a["manual_min"] - b["manual_min"]) <= 0.1
    assert abs(a["gw_down_min"] - b["gw_down_min"]) <= 0.1
    assert abs(a["notify"]["max_delay_min"] - b["notify"]["max_delay_min"]) <= 0.5
    pd = [[i["kind"], None if i["detected"] is None else i["detected"] - i["t"], i["how"]] for i in a["incidents"]]
    for x, y in zip(pd, js["detect"]):
        assert x[0] == y[0] and x[2] == y[2], (x, y)
        assert (x[1] is None) == (y[1] is None) and (x[1] is None or abs(x[1] - y[1]) <= 5.0), (x, y)
