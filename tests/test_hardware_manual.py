"""Kiểm thử phân loại thiết bị, tùy chọn "không lắp", mini PC hỏng (watchdog + PID biến tần)
và điều khiển bơm bằng tay từ xa / tại chỗ (HMI)."""
import json
import os

from trambom.engine import TwinSim, load_config
from trambom.whatif import config_with, table_md

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def twin(events, cfg=None, level="basic"):
    cfg = cfg or load_config()
    return TwinSim(cfg, {"id": "T", "duration_h": 1, "events": events}, level, with_fixed=False)


def run_until(tw, hours):
    n = int(round(hours * 3600 / tw.dt)) - int(round(tw.t / tw.dt))
    for _ in range(n):
        tw.step()
    return tw


# ---------------- danh mục thiết bị ----------------
def test_component_catalog_scopes_are_complete():
    comps = json.load(open(os.path.join(ROOT, "config", "components.json"), encoding="utf-8"))["components"]
    tags = [c["tag"] for c in comps]
    assert len(tags) == len(set(tags))
    scopes = {c["tag"]: c["scope"] for c in comps}
    assert set(scopes.values()) == {"hien_trang", "giai_phap", "khuyen_nghi"}
    for c in comps:
        assert c["change"] in ("giu_nguyen", "cau_hinh_lai", "nang_cap", "bo_sung", "thay_the"), c["tag"]
        assert c["priority"] in ("bat_buoc", "nen_co", "tuy_chon"), c["tag"]
        assert c.get("role"), c["tag"]
        if c["scope"] != "hien_trang":
            assert c["change"] == "bo_sung", c["tag"]
    # hiện trạng nhà máy: bơm, biến tần; giải pháp: mini PC và phần tiếp nhận tín hiệu
    for t in ("P-01", "P-02", "VFD-01", "VFD-02", "T-01", "CP-01"):
        assert scopes[t] == "hien_trang"
    for t in ("MPC-01", "GW-01", "IO-01", "CP-02", "WDR-01", "PT-101", "RT-01", "UPS-01"):
        assert scopes[t] == "giai_phap"
    for t in ("HMI-01", "MV-02", "AIT-203", "PL-301"):
        assert scopes[t] == "khuyen_nghi"
    # mọi tùy chọn phần cứng mô phỏng được đều trỏ tới thiết bị có trong danh mục
    hw = load_config()["hardware"]
    for opt in hw:
        if opt in ("note", "SMS", "VFD_PID_fallback", "FT-100_pulse"):
            continue
        assert opt in scopes, opt


# ---------------- tùy chọn "không lắp" ----------------
def test_pt102_not_installed_is_not_a_signal_fault():
    tw = run_until(twin([{"t_h": 0.2, "type": "server_command", "cmd": {"type": "select_pt", "args": {"tag": "PT-102"}}}],
                        cfg=config_with(["PT-102"])), 0.3)
    gw = tw.smart.gw
    assert gw.sig["p2"] is None
    assert not any(h["code"] == "SENSOR_FAULT_PT-102" for h in gw.alarms.history)
    res = [c for c in gw.cmd_results if c["type"] == "select_pt"]
    assert res and res[0]["status"] == "rejected"


def test_inflow_estimated_by_mass_balance_without_ft100():
    tw = run_until(twin([], cfg=config_with(["FT-100_pulse"])), 0.6)
    est = tw.smart.gw.sig["q_in_f"]
    true = tw.smart.plant.q_in
    assert est is not None
    assert abs(est - true) < 3.0, (est, true)
    assert "SUPPLY_LOST" not in tw.smart.gw.alarms.active


def test_no_turbidity_analyzer_means_no_safe_stop():
    ev = [{"t_h": 0.1, "type": "inflow_quality", "param": "ntu", "value": 15, "until_h": 3.5}]
    with_ait = run_until(twin(ev), 3.5).smart
    without = run_until(twin(ev, cfg=config_with(["AIT-202"])), 3.5).smart
    assert with_ait.gw.safety.safe_stop or any(h["code"] == "SAFE_STOP" for h in with_ait.gw.alarms.history)
    assert not any(h["code"].startswith("NTU_") for h in without.gw.alarms.history)
    assert without.kpi.viol_m3 > with_ait.kpi.viol_m3 + 1.0


def test_without_sms_critical_alarm_waits_for_network():
    ev = [{"t_h": 0.1, "type": "link_down"}, {"t_h": 0.2, "type": "inflow_quality", "param": "ntu", "value": 15, "until_h": 3.0},
          {"t_h": 3.2, "type": "link_up"}]
    a = run_until(twin(ev), 3.4).smart.summary()["notify"]
    b = run_until(twin(ev, cfg=config_with(["SMS"])), 3.4).smart.summary()["notify"]
    assert a["critical"] >= 1 and a["max_delay_min"] < 0.1 and "SMS" in a["via"]
    assert b["max_delay_min"] > 20.0 and "chờ mạng" in b["via"]


# ---------------- mini PC hỏng ----------------
def test_gateway_failure_vfd_pid_holds_pressure_and_restart_resyncs():
    ev = [{"t_h": 0.2, "type": "gateway_fail"}, {"t_h": 0.8, "type": "gateway_restore"}]
    tw = twin(ev)
    run_until(tw, 0.5)
    s = tw.smart
    assert s.gw_dead is not None and s.gw_dead.active
    assert abs(s.plant.p_net - load_config()["fallback"]["p_set_bar"]) < 0.25
    assert not tw.server.stations["ST-01"]["online"], "máy chủ phải phát hiện mất nhịp tim (LWT)"
    inc = s.kpi.incidents[0]
    assert inc["kind"] == "gateway_fail" and inc["detected"] is not None and inc["detected"] - inc["t"] < 120
    run_until(tw, 1.0)
    assert s.gw_dead is None
    assert any(h["code"] == "GW_WATCHDOG" for h in s.gw.alarms.history)
    assert s.gw.comms.state == "online" and tw.server.stations["ST-01"]["online"]
    assert abs(s.summary()["gw_down_min"] - 36.0) < 0.1


def test_gateway_failure_without_fallback_holds_last_output():
    tw = run_until(twin([{"t_h": 0.2, "type": "gateway_fail"}], cfg=config_with(["VFD_PID_fallback"])), 0.6)
    s = tw.smart
    hold = s.gw_dead.hold
    for i, pu in enumerate(s.plant.pumps):
        assert pu.f_ref == hold["f_ref"][i]
    assert not s.gw_dead.active


def test_gateway_failure_keeps_latched_safe_stop():
    ev = [{"t_h": 0.05, "type": "inflow_quality", "param": "ntu", "value": 15, "until_h": 4}, {"t_h": 3.0, "type": "gateway_fail"}]
    tw = run_until(twin(ev), 2.99)
    assert tw.smart.gw.safety.safe_stop
    run_until(tw, 3.3)
    s = tw.smart
    assert s.gw_dead.inhibit, "đang dừng an toàn thì mạch dự phòng không được chạy bơm"
    assert not any(pu.running for pu in s.plant.pumps)


# ---------------- điều khiển tay từ xa / tại chỗ ----------------
def test_remote_manual_reverts_to_auto_on_comms_loss():
    ev = [{"t_h": 0.2, "type": "server_command", "cmd": {"type": "set_mode", "args": {"mode": "manual"}}},
          {"t_h": 0.21, "type": "server_command", "cmd": {"type": "pump_speed", "args": {"pump": 0, "f_hz": 42}}},
          {"t_h": 0.4, "type": "link_down"}]
    tw = twin(ev)
    run_until(tw, 0.3)
    gw = tw.smart.gw
    assert gw.control_src() == "remote"
    assert abs(tw.smart.plant.pumps[0].f - 42.0) < 0.5
    run_until(tw, 0.45)
    assert gw.control_src() == "auto", "mất kết nối khi đang điều khiển tay từ xa → tự về tự động"


def test_remote_manual_lease_expires():
    cfg = load_config()
    cfg["gateway"]["manual_lease_s"] = 300
    tw = run_until(twin([{"t_h": 0.2, "type": "server_command", "cmd": {"type": "set_mode", "args": {"mode": "manual"}}}], cfg=cfg), 0.3)
    assert tw.smart.gw.control_src() == "auto"
    assert any("hết thời hạn" in l["text"] for l in tw.smart.gw.logs)


def test_local_hmi_has_priority_over_remote():
    ev = [{"t_h": 0.2, "type": "local_command", "cmd": {"type": "set_mode", "args": {"mode": "manual"}}},
          {"t_h": 0.25, "type": "server_command", "cmd": {"type": "pump_speed", "args": {"pump": 0, "f_hz": 48}}}]
    tw = run_until(twin(ev), 0.3)
    gw = tw.smart.gw
    assert gw.control_src() == "local"
    rej = [c for c in gw.cmd_results if c["type"] == "pump_speed"]
    assert rej and rej[0]["status"] == "rejected"
    assert gw.manual["f"][0] != 48.0


def test_manual_valve_interlock_and_high_pressure_limiter():
    ev = [{"t_h": 0.2, "type": "local_command", "cmd": {"type": "set_mode", "args": {"mode": "manual"}}},
          {"t_h": 0.25, "type": "local_command", "cmd": {"type": "valve", "args": {"open": False}}},
          {"t_h": 0.35, "type": "local_command", "cmd": {"type": "valve", "args": {"open": True}}},
          {"t_h": 0.4, "type": "local_command", "cmd": {"type": "pump_speed", "args": {"pump": 0, "f_hz": 50}}}]
    tw = twin(ev)
    run_until(tw, 0.3)
    assert not any(pu.running for pu in tw.smart.plant.pumps), "van đóng → liên động cấm chạy bơm"
    run_until(tw, 0.7)
    s = tw.smart
    assert s.plant.pumps[0].running, "van mở lại → bơm chạy tiếp theo lệnh tay"
    assert s.kpi.p_max < 4.2, "lớp an toàn hạ tần số tay khi áp tới 4,0 bar"


def test_whatif_table_formats():
    rows = [{"option": "PT-102", "label": "PT-102", "scenario": "S5", "level": "basic", "metrics": ["t_high_min", "detect_min"],
             "with": {"t_high_min": 0.0, "detect_min": 0.1, "detect_how": "PT_DEVIATION"},
             "without": {"t_high_min": 119.4, "detect_min": None, "detect_how": None}}]
    md = table_md(rows)
    assert "119" in md and "không phát hiện" in md and "0,1 (PT_DEVIATION)" in md
