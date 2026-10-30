"""Mạng lưới Hà Nội (config/hanoi.json): dữ liệu hợp lệ và lõi JavaScript chạy được nhiều trạm với sự cố rải trên từng trạm.

Phần Python (lõi mô phỏng 4 trạm trong station.json) không đổi; hanoi.json chỉ dùng cho màn Mạng lưới của bản web."""
import json
import os
import shutil
import subprocess

import pytest

from trambom.engine import load_config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def hanoi():
    with open(os.path.join(ROOT, "config", "hanoi.json"), encoding="utf-8") as f:
        return json.load(f)


def test_sites_are_valid_and_inside_the_map():
    d = hanoi()
    ids = [s["id"] for s in d["sites"]]
    assert len(ids) == len(set(ids)) >= 12, "mỗi trạm có mã riêng, đủ nhiều để thể hiện quản lý mạng lưới"
    assert len({s["seed_offset"] for s in d["sites"]}) == len(ids), "mỗi trạm cần hạt giống riêng"
    m = d["map"]
    for s in d["sites"]:
        assert m["lon0"] < s["lon"] < m["lon1"] and m["lat0"] < s["lat"] < m["lat1"], s["id"] + " nằm ngoài bản đồ"
        assert 105.5 < s["lon"] < 106.1 and 20.8 < s["lat"] < 21.3, s["id"] + " không nằm ở Hà Nội"
        assert 0.3 <= s["demand_scale"] <= 1.6 and 0 <= s["dz_crit_m"] <= 12 and s["households"] > 0


def test_first_stations_keep_the_physics_of_station_json():
    """ST-01…ST-04 phải giữ nguyên tham số vật lý để bài học và tài liệu cũ vẫn đúng."""
    cfg = load_config()
    for base, site in zip(cfg["stations"], hanoi()["sites"]):
        assert base["id"] == site["id"]
        for k in ("demand_scale", "dz_crit_m", "seed_offset"):
            assert base[k] == site[k], f'{site["id"]}.{k}'


def test_scenario_events_reference_known_stations_and_types():
    d = hanoi()
    ids = {s["id"] for s in d["sites"]}
    known = {"link_down", "link_up", "burst", "inflow_quality", "sensor_fault", "sensor_repair", "pump_fault", "pump_repair", "gateway_fail",
             "gateway_restore", "supply", "demand_scale", "server_command"}
    ev = d["scenario"]["events"]
    assert ev and all(e["station"] in ids and e["type"] in known for e in ev)
    # sự cố rải trên nhiều trạm khác nhau (không dồn vào một trạm)
    assert len({e["station"] for e in ev}) >= 8
    # mỗi sự cố có cặp khôi phục hợp lý: link_down → link_up, pump_fault → pump_repair, gateway_fail → gateway_restore
    for down, up in (("link_down", "link_up"), ("pump_fault", "pump_repair"), ("gateway_fail", "gateway_restore"), ("sensor_fault", "sensor_repair")):
        for e in (x for x in ev if x["type"] == down):
            assert any(x["type"] == up and x["station"] == e["station"] and x["t_h"] > e["t_h"] for x in ev), f'{e["station"]} {down} chưa có {up}'


@pytest.mark.skipif(NODE is None, reason="cần Node.js để chạy bản JavaScript")
def test_js_fleet_runs_and_incidents_show_on_the_right_stations():
    out = subprocess.run([NODE, os.path.join(ROOT, "tools", "run_js_fleet.mjs"), "8", "advanced"], capture_output=True, text=True, check=True, cwd=ROOT)
    r = json.loads(out.stdout)
    d = hanoi()
    assert r["n"] == len(d["sites"]) and r["ids"] == [s["id"] for s in d["sites"]]
    seen = set(r["status_seen"])
    # trong 8 giờ đầu: ST-06 mất 4G (0,6–2,8 h), ST-14 vỡ ống, ST-13 hỏng bơm P-01 (3,2 h), ST-04 mini PC treo (4–6,5 h)
    assert "ST-06:offline" in seen, "trung tâm phải phát hiện ST-06 mất kết nối"
    assert "ST-13:crit" in seen or "ST-13:warn" in seen
    assert "ST-04:crit" in seen or "ST-04:offline" in seen
    codes = set(r["alarm_codes"])
    assert "ST-06:STATION_OFFLINE" in codes and "ST-13:PUMP_FAULT_P-01" in codes and "ST-04:GW_WATCHDOG" in codes
    # trạm không có sự cố vẫn bình thường suốt thời gian chạy
    for sid in ("ST-01", "ST-07", "ST-15"):
        assert not any(s.startswith(sid + ":") and not s.endswith(":ok") for s in seen), sid + " không được báo bất thường"
    # sau khi hết sự cố, mọi trạm quay lại bình thường hoặc đang xử lý – tiết kiệm điện vẫn dương toàn mạng
    assert r["totals"]["saved_pct"] > 10
    assert r["totals"]["households"] == sum(s["households"] for s in d["sites"])


@pytest.mark.skipif(NODE is None, reason="cần Node.js để chạy bản JavaScript")
def test_map_projection_is_web_mercator_like_osm_tiles():
    """Marker trạm phải trùng khít nền OpenStreetMap: phép chiếu của bản đồ là Web Mercator (EPSG:3857), kiểm tra bằng công thức độc lập."""
    import math

    d = hanoi()
    m = d["map"]
    script = ("import { mapXY, mapAspect } from './web/js/sim/fleet.js';"
              f"const m = {json.dumps(m)}, sites = {json.dumps(d['sites'])};"
              "console.log(JSON.stringify({ a: mapAspect(m), p: sites.map((s) => mapXY(m, s.lon, s.lat)) }));")
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, check=True, cwd=ROOT)
    r = json.loads(out.stdout)

    def merc(lat):  # y của Web Mercator (đơn vị bán kính)
        return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

    ry = merc(m["lat1"]) - merc(m["lat0"])
    assert abs(r["a"] - ry / math.radians(m["lon1"] - m["lon0"])) < 1e-9
    for s, p in zip(d["sites"], r["p"]):
        assert abs(p["x"] - (s["lon"] - m["lon0"]) / (m["lon1"] - m["lon0"])) < 1e-9
        assert abs(p["y"] - (merc(m["lat1"]) - merc(s["lat"])) / ry) < 1e-9
