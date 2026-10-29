"""Kiểm thử hợp nhất 3 chiều và quy tắc giải quyết xung đột."""
from trambom.engine import load_config
from trambom.server import three_way_merge

POLICY = load_config()["merge_policy"]


def test_only_one_side_changed():
    base = {"a": {"x": 1.0, "y": 2.0}}
    server = {"a": {"x": 1.5, "y": 2.0}}
    local = {"a": {"x": 1.0, "y": 3.0}}
    merged, conflicts, decisions = three_way_merge(base, server, local, POLICY)
    assert merged == {"a": {"x": 1.5, "y": 3.0}}
    assert conflicts == []
    assert {d["path"] for d in decisions} == {"a.x", "a.y"}


def test_service_parameter_takes_conservative_max():
    base = {"pressure": {"p_crit_target_bar": 1.6}}
    server = {"pressure": {"p_crit_target_bar": 1.55}}
    local = {"pressure": {"p_crit_target_bar": 1.7}}
    merged, conflicts, _ = three_way_merge(base, server, local, POLICY)
    assert merged["pressure"]["p_crit_target_bar"] == 1.7
    assert len(conflicts) == 1 and "bảo thủ" in conflicts[0]["rule"]


def test_operational_parameter_server_wins():
    base = {"alternation": {"runtime_h": 24.0}}
    server = {"alternation": {"runtime_h": 12.0}}
    local = {"alternation": {"runtime_h": 48.0}}
    merged, conflicts, _ = three_way_merge(base, server, local, POLICY)
    assert merged["alternation"]["runtime_h"] == 12.0
    assert "máy chủ thắng" in conflicts[0]["rule"]


def test_both_sides_same_change_is_not_conflict():
    base = {"level": {"stop_m": 0.6}}
    same = {"level": {"stop_m": 0.7}}
    merged, conflicts, decisions = three_way_merge(base, same, same, POLICY)
    assert merged["level"]["stop_m"] == 0.7
    assert conflicts == [] and decisions == []


def test_sleep_disable_is_conservative_min():
    base = {"sleep": {"enabled": True}}
    server = {"sleep": {"enabled": True, "t_s": 60}}
    local = {"sleep": {"enabled": False, "t_s": 300}}
    server2 = {"sleep": {"enabled": True, "t_s": 60}}
    base2 = {"sleep": {"enabled": False, "t_s": 120}}
    merged, conflicts, _ = three_way_merge(base, server, local, POLICY)
    assert merged["sleep"]["enabled"] is False
    merged2, conflicts2, _ = three_way_merge(base2, {"sleep": {"enabled": True, "t_s": 60}}, {"sleep": {"enabled": False, "t_s": 300}}, POLICY)
    assert merged2["sleep"]["t_s"] == 60  # vận hành: máy chủ thắng
    assert server2["sleep"]["t_s"] == 60
