"""Kịch bản mẫu của học viên phải chạy được; lời giải mẫu phải giữ áp trong dải."""
import os

from trambom.engine import TwinSim, load_config, load_scenarios
from trambom.student import load_custom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(path, hours=6.0, sid="S1", level="basic"):
    fn = load_custom(os.path.join(ROOT, path))
    tw = TwinSim(load_config(), load_scenarios()[sid], level, fn, with_fixed=False)
    res = tw.run(hours=hours)
    return tw, res


def test_template_runs_without_falling_back():
    tw, res = _run("student/kich_ban_nguong.py", 2.0)
    assert tw.smart.gw.custom_fn is not None


def test_reference_threshold_solution_holds_band():
    tw, res = _run("student/loi_giai/kich_ban_nguong_mau.py", 8.0)
    assert tw.smart.gw.custom_fn is not None
    assert res["smart"]["pct_in_band"] > 98.0


def test_reference_predictive_solution_runs():
    tw, res = _run("student/loi_giai/kich_ban_du_bao_mau.py", 4.0, level="advanced")
    assert tw.smart.gw.custom_fn is not None
    assert res["smart"]["pct_in_band"] > 98.0


def test_broken_student_script_falls_back_to_builtin():
    tw = TwinSim(load_config(), load_scenarios()["S1"], "basic", lambda i, m, p: 1 / 0, with_fixed=False)
    res = tw.run(hours=0.5)
    assert tw.smart.gw.custom_fn is None
    assert "SCRIPT_ERROR" in tw.smart.gw.alarms.active
    assert res["smart"]["pct_in_band"] > 95.0
