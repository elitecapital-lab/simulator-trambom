"""BÀI TẬP NÂNG CAO – Điều phối nhiều trạm từ trung tâm điều hành (tích hợp mạng lưới).

Bối cảnh: 4 trạm (ST-01..ST-04) báo về một máy chủ. Mỗi khu có một logger áp lực ở điểm bất lợi
(truyền NB-IoT, chu kỳ 15 phút). Gateway tại trạm KHÔNG đo được điểm bất lợi – nó chỉ ước lượng qua
r_est·Q². Trung tâm thì thấy cả hai.

Nhiệm vụ: viết hàm dieu_phoi(ban_tin) chạy mỗi giờ ở máy chủ, trả về các bản vá kịch bản cho từng trạm,
ví dụ hiệu chỉnh r_est hoặc p_crit_target_bar để áp điểm bất lợi sát 1,4–1,6 bar mà không lãng phí điện.

Chạy:  python student/mang_luoi_nang_cao.py   (mặc định 24 h; so sánh với khi không điều phối)
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trambom.network import NetworkSim  # noqa: E402


def dieu_phoi(ban_tin):
    """ban_tin: danh sách dict mỗi trạm:
        id, online, q (m³/h), p_out (bar), p_crit_logger (bar – trung bình giờ qua, có nhiễu),
        script (tham số hiện tại của trạm), kwh_gio (kWh giờ qua)
    Trả về {station_id: {"pressure.r_est": ..., ...}} – để trống nếu không đổi gì."""
    patches = {}
    for st in ban_tin:
        if not st["online"] or st["p_crit_logger"] is None:
            continue
        # TODO: so sánh p_crit_logger với mục tiêu 1,5 bar; nếu cao hơn nhiều -> giảm p_crit_target_bar
        #       (hoặc hiệu chỉnh r_est theo Q), nếu thấp hơn 1,4 -> tăng. Giới hạn bước thay đổi mỗi giờ
        #       (ví dụ ±0,05 bar) để tránh dao động, và tôn trọng giới hạn trong script_schema.
        pass
    return patches


def chay(hours=24, co_dieu_phoi=True, seed=7):
    rnd = random.Random(seed)
    n = NetworkSim(level="basic", with_fixed=False)
    acc = {s.sid: {"pc": 0.0, "n": 0, "kwh0": 0.0} for s in n.smart}
    steps_h = int(3600 / n.dt)
    for h in range(int(hours)):
        for _ in range(steps_h):
            n.step()
            if int(n.t) % 900 == 0:  # logger 15 phút
                for s in n.smart:
                    a = acc[s.sid]
                    a["pc"] += s.plant.p_crit + rnd.gauss(0, 0.02)
                    a["n"] += 1
        ban_tin = []
        for s in n.smart:
            st = n.server.stations[s.sid]
            a = acc[s.sid]
            last = st["last"] or {}
            ban_tin.append({"id": s.sid, "online": st["online"], "q": last.get("q"), "p_out": last.get("p"),
                            "p_crit_logger": a["pc"] / a["n"] if a["n"] else None,
                            "script": st["repo"][st["target"]]["params"], "kwh_gio": s.kpi.energy_kwh - a["kwh0"]})
            a.update({"pc": 0.0, "n": 0, "kwh0": s.kpi.energy_kwh})
        if co_dieu_phoi:
            for sid, patch in dieu_phoi(ban_tin).items():
                if patch:
                    n.server.publish_script(sid, patch, n.t, "Bộ điều phối trung tâm", "hiệu chỉnh theo logger")
    return n.summary()


if __name__ == "__main__":
    hours = float(sys.argv[1]) if len(sys.argv) > 1 else 24
    for flag in (False, True):
        s = chay(hours, flag)
        t = s["totals"]
        print("%-22s tổng %.1f kWh, áp ngoài dải %.0f phút, rò rỉ %.1f m³" % ("Có điều phối:" if flag else "Không điều phối:",
              t["smart_kwh"], t["smart_out_min"], t["smart_leak"]))
        for r in s["stations"]:
            k = r["smart"]
            print("   %-32s %.1f kWh  p_crit_min %.2f bar  ngoài dải %.0f phút" % (r["name"], k["energy_kwh"], k["p_crit_min"], k["t_out_min"]))
