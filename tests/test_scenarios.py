"""Kiểm thử khói (smoke) cho tất cả kịch bản + một số khẳng định định lượng ngắn."""
import pytest

from trambom.engine import TwinSim, load_config, load_scenarios

SCEN = load_scenarios()


@pytest.mark.parametrize("sid", sorted(SCEN))
def test_every_scenario_runs_two_hours(sid):
    tw = TwinSim(load_config(), SCEN[sid], "advanced")
    res = tw.run(hours=2.0)
    assert res["smart"]["energy_kwh"] > 0
    assert res["fixed"]["energy_kwh"] >= 0
    assert len(res["smart_hist"]["t"]) == 720


def test_smart_beats_fixed_on_energy_and_pressure_band():
    tw = TwinSim(load_config(), SCEN["S1"], "basic")
    res = tw.run(hours=12.0)
    s, f = res["smart"], res["fixed"]
    assert s["energy_kwh"] < 0.8 * f["energy_kwh"]
    assert s["pct_in_band"] > 98.0
    assert s["pct_in_band"] > f["pct_in_band"]


def test_scenario_events_reference_known_types():
    known = {"link_down", "link_up", "server_command", "server_publish", "local_edit", "inflow_quality", "supply",
             "burst", "demand_scale", "pump_fault", "pump_repair", "sensor_fault", "sensor_repair"}
    for sc in SCEN.values():
        for ev in sc["events"]:
            assert ev["type"] in known, (sc["id"], ev)
            assert 0.0 <= ev["t_h"] <= sc["duration_h"]
