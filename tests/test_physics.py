"""Kiểm thử mô hình vật lý: đường đặc tính bơm, bảo toàn khối lượng, bình tích áp, van an toàn."""
import math

from trambom.engine import load_config
from trambom.physics import Plant
from trambom.rng import Rng

DIST = {"q_cons": 16.0, "supply": 1.0, "cl_in": 0.65, "ntu_in": 0.3, "ph_in": 7.2, "q_burst": 0.0}


def run(pl, n, dist=DIST, dt=1.0):
    for _ in range(n):
        pl.step(dt, dist)


def test_rng_matches_javascript_mulberry32():
    r = Rng(1)
    vals = [round(r.random(), 6) for _ in range(4)]
    assert vals == [0.627074, 0.002736, 0.527447, 0.981051]


def test_pump_operating_point_on_curve():
    cfg = load_config()
    pl = Plant(cfg)
    pl.pumps[0].cmd_run = True
    pl.pumps[0].f_ref = 45.0
    run(pl, 900)
    pm = cfg["pump_model"]
    pu = pl.pumps[0]
    s = pu.f / 50.0
    h_curve = pm["h0_m"] * s * s - pm["k_m_per_m3h2"] * pu.q ** 2
    assert abs(pu.h - h_curve) < 1e-6
    # áp đầu ra = cột áp bơm + cột áp hút (mức bể + z) quy đổi bar
    p_expected = (pu.h + pl.level + cfg["tank"]["z_suction_m"]) / pl.m_per_bar
    assert abs(pl.p - p_expected) < 0.01
    # trạng thái dừng: lưu lượng bơm = lưu lượng ra mạng
    assert abs(pl.q_pumps - pl.q_out) < 0.05


def test_affinity_power_scales_with_speed_cubed_at_shutoff():
    cfg = load_config()
    powers = []
    for f in (30.0, 45.0):
        pl = Plant(cfg)
        pl.outlet_cmd = False
        pl.outlet_frac = 0.0
        pl.pumps[0].cmd_run = True
        pl.pumps[0].f_ref = f
        run(pl, 600, dict(DIST, q_cons=0.0))
        powers.append(pl.pumps[0].kw - cfg["pump_model"]["standby_w"] / 1000.0)
    ratio = powers[1] / powers[0]
    assert abs(ratio - (45.0 / 30.0) ** 3) < 0.05


def test_tank_mass_balance():
    cfg = load_config()
    pl = Plant(cfg)
    pl.pumps[0].cmd_run = True
    pl.pumps[0].f_ref = 40.0
    v0 = pl.volume()
    vin = vout = 0.0
    for _ in range(3600):
        pl.step(1.0, DIST)
        vin += (pl.q_in + pl.q_relief) / 3600.0
        vout += (pl.q_pumps + pl.q_drain) / 3600.0
    assert abs((pl.volume() - v0) - (vin - vout)) < 1e-6 + pl.overflow_m3


def test_hydro_tank_storage_monotonic():
    pl = Plant(load_config())
    prev = -1.0
    for i in range(100):
        p = -0.5 + 0.07 * i
        v = pl.storage(p)
        assert v > prev
        assert pl.storage_deriv(p) > 0
        prev = v


def test_relief_valve_limits_pressure():
    cfg = load_config()
    cfg["pump_model"]["h0_m"] = 80.0  # bơm "quá cỡ" để thử van an toàn
    pl = Plant(cfg)
    pl.outlet_cmd = False
    pl.outlet_frac = 0.0
    pl.pumps[0].cmd_run = True
    pl.pumps[0].f_ref = 50.0
    run(pl, 600, dict(DIST, q_cons=0.0))
    assert pl.q_relief > 0.0
    assert pl.p < cfg["relief_valve"]["set_bar"] + 1.0


def test_pressure_dependent_demand_and_leakage():
    cfg = load_config()
    pl = Plant(cfg)
    run(pl, 1200)  # không bơm: áp về 0, không cấp được
    assert pl.q_served < 0.5
    assert pl.backlog > 0.0
    pl.pumps[0].cmd_run = True
    pl.pumps[0].f_ref = 46.0
    run(pl, 1200)
    assert pl.q_served > DIST["q_cons"]  # nạp bù bồn mái
    leak_hi = pl.q_leak
    pl.pumps[0].f_ref = 36.0
    run(pl, 1200)
    assert pl.q_leak < leak_hi  # áp thấp hơn -> rò rỉ ít hơn (FAVAD)


def test_dry_run_detected_when_tank_empty():
    cfg = load_config()
    cfg["tank"]["level_init_m"] = 0.42
    pl = Plant(cfg)
    pl.pumps[0].cmd_run = True
    pl.pumps[0].f_ref = 50.0
    run(pl, 600, dict(DIST, supply=0.0))
    assert pl.pumps[0].dry_run_s > 0.0
    assert pl.suction_psi() < 1.0
    assert not math.isnan(pl.p)
