"""Kiểm thử edge gateway: phát hiện mất mạng, bộ đệm, lệnh hết hạn, kiểm tra kịch bản, lớp an toàn."""
from trambom.engine import TwinSim, load_config
from trambom.gateway import validate_params


def twin(events, level="basic", cfg=None, with_fixed=False):
    cfg = cfg or load_config()
    return TwinSim(cfg, {"id": "T", "duration_h": 1, "events": events}, level, with_fixed=with_fixed)


def run_until(tw, hours):
    n = int(round(hours * 3600 / tw.dt))
    for _ in range(n):
        tw.step()
    return tw


def test_offline_detected_after_timeout_and_buffer_replayed():
    tw = run_until(twin([{"t_h": 0.5, "type": "link_down"}, {"t_h": 1.5, "type": "link_up"}]), 2.0)
    gw = tw.smart.gw
    logs = [l for l in gw.logs if "Mất kết nối máy chủ" in l["text"]]
    assert logs, "gateway phải phát hiện mất mạng"
    delay = logs[0]["t"] - 1800.0
    # 60 s tính từ ACK nhịp tim cuối cùng (nhịp tim 10 s) -> 50..70 s sau thời điểm mất mạng
    assert 45.0 <= delay <= 75.0
    st = tw.server.stations["ST-01"]
    gen = gw.comms.stats["generated"]
    assert st["records"] == gen or st["records"] >= gen - 2  # đủ dữ liệu sau phát lại
    assert gw.comms.state == "online"
    assert st["sync_log"], "phải có phiên đồng bộ"


def test_buffer_compaction_keeps_coverage_without_loss():
    cfg = load_config()
    cfg["gateway"]["buffer_capacity"] = 200  # bộ đệm nhỏ để ép nén
    tw = run_until(twin([{"t_h": 0.1, "type": "link_down"}, {"t_h": 2.1, "type": "link_up"}], cfg=cfg), 2.4)
    c = tw.smart.gw.comms.stats
    assert c["compactions"] >= 1
    assert c["dropped"] == 0
    st = tw.server.stations["ST-01"]
    assert st["records_agg"] > 0
    assert st["records"] >= c["generated"] - 2


def test_command_expires_while_offline():
    ev = [{"t_h": 0.2, "type": "link_down"},
          {"t_h": 0.3, "type": "server_command", "cmd": {"type": "set_override", "args": {"p_set_bar": 2.9}}, "ttl_s": 600},
          {"t_h": 0.35, "type": "server_command", "cmd": {"type": "rotate_pumps", "args": {}}, "ttl_s": 7200},
          {"t_h": 0.8, "type": "link_up"}]
    tw = run_until(twin(ev), 1.0)
    st = tw.server.stations["ST-01"]
    statuses = {(c["id"], c["status"]) for c in st["cmd_log"]}
    assert ("C0001", "expired_server") in statuses
    assert ("C0002", "ok") in statuses
    assert tw.smart.gw.override is None


def test_override_has_lease_and_expires():
    ev = [{"t_h": 0.2, "type": "server_command", "cmd": {"type": "set_override", "args": {"p_set_bar": 2.9, "ttl_s": 300}}, "ttl_s": 3600}]
    tw = run_until(twin(ev), 0.25)
    assert tw.smart.gw.override is not None
    assert abs(tw.smart.gw.ctrl.p_set - 2.9) < 1e-9
    run_until(tw, 0.15)
    assert tw.smart.gw.override is None


def test_script_validation_rejects_out_of_range():
    cfg = load_config()
    params = cfg["script"]["params"]
    assert validate_params(params, cfg["script_schema"]) == []
    bad = dict(params, pressure=dict(params["pressure"], p_crit_target_bar=0.5))
    errs = validate_params(bad, cfg["script_schema"])
    assert any("p_crit_target_bar" in e for e in errs)
    bad2 = dict(params, level=dict(params["level"], restart_m=0.55))
    assert validate_params(bad2, cfg["script_schema"])


def test_rejected_script_keeps_previous_version():
    ev = [{"t_h": 0.1, "type": "server_publish", "patch": {"pressure.p_crit_target_bar": 0.9}}]
    tw = run_until(twin(ev), 0.2)
    assert tw.smart.gw.script["version"] == 3
    assert "SCRIPT_REJECTED" in tw.smart.gw.alarms.active


def test_quality_trip_safe_stop_and_reset_permissive():
    ev = [{"t_h": 0.05, "type": "inflow_quality", "param": "ntu", "value": 60.0, "until_h": 0.6},
          {"t_h": 1.0, "type": "server_command", "cmd": {"type": "reset_safe_stop", "args": {}}, "ttl_s": 600}]
    tw = run_until(twin(ev, with_fixed=True), 1.1)
    gw = tw.smart.gw
    assert any(h["code"] == "SAFE_STOP" for h in gw.alarms.history)
    assert gw.safety.safe_stop, "đặt lại bị từ chối khi độ đục chưa đạt"
    assert tw.smart.plant.outlet_frac == 0.0
    assert all(not p.running for p in tw.smart.plant.pumps)
    rejected = [c for c in gw.cmd_results if c["type"] == "reset_safe_stop"]
    assert rejected and rejected[0]["status"] == "rejected"
    # chỉ một lượng nhỏ nước không đạt được cấp trong thời gian xác nhận (60 s) + trễ đo
    assert tw.smart.kpi.viol_m3 < 1.0


def test_pump_fault_switches_to_standby_quickly():
    tw = run_until(twin([{"t_h": 0.2, "type": "pump_fault", "pump": 0}]), 0.3)
    pl = tw.smart.plant
    assert not pl.pumps[0].running
    assert pl.pumps[1].running
    assert tw.smart.kpi.incidents[0]["detected"] - tw.smart.kpi.incidents[0]["t"] <= 2.0


def test_stuck_sensor_voting_advanced():
    tw = run_until(twin([{"t_h": 0.2, "type": "sensor_fault", "tag": "PT-101", "mode": "stuck", "value": 2.0}], level="advanced"), 0.4)
    gw = tw.smart.gw
    assert gw.sig_proc.faulty["PT-101"]
    assert gw.sig_proc.pt_used == "PT-102"
    assert tw.smart.kpi.p_max < 4.0


def test_stuck_sensor_basic_relies_on_pressure_limiter():
    tw = run_until(twin([{"t_h": 0.2, "type": "sensor_fault", "tag": "PT-101", "mode": "stuck", "value": 2.0}], level="basic"), 0.6)
    gw = tw.smart.gw
    assert gw.sig_proc.pt_used == "PT-101"
    assert tw.smart.kpi.p_max < 4.3  # bộ giới hạn áp cao (PT-102) giữ áp gần 4,0 bar
    assert any(h["code"] in ("P_HIGH", "PT_DEVIATION") for h in gw.alarms.history)


def test_level_protection_never_runs_dry():
    cfg = load_config()
    cfg["tank"]["level_init_m"] = 1.0
    # mất nguồn từ đầu; lịch cố định bắt đầu bơm lúc 05:00 nên chạy tới 06:30
    tw = run_until(twin([{"t_h": 0.0, "type": "supply", "factor": 0.0, "until_h": 7.0}], cfg=cfg, with_fixed=True), 6.5)
    assert tw.smart.plant.pumps[0].dry_run_s == 0.0 and tw.smart.plant.pumps[1].dry_run_s == 0.0
    assert tw.smart.gw.ctrl.level_stop
    assert tw.smart.plant.level > 0.55
    assert tw.fixed.plant.pumps[0].dry_run_s + tw.fixed.plant.pumps[1].dry_run_s > 0.0


def test_local_edit_online_gets_new_version():
    ev = [{"t_h": 0.1, "type": "local_edit", "patch": {"pressure.p_crit_target_bar": 1.7}}]
    tw = run_until(twin(ev), 0.15)
    gw = tw.smart.gw
    assert gw.script["version"] == 4 and not gw.script["local_modified"]
    assert tw.server.stations["ST-01"]["target"] == 4
