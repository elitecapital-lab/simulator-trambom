"""Sinh docs/06-so-sanh-dien-nang-chat-luong.md từ docs/ket-qua/kpi.json (chạy sau `python -m trambom compare`)."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = json.load(open(os.path.join(ROOT, "docs", "ket-qua", "kpi.json"), encoding="utf-8"))
SC = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "config", "scenarios.json"), encoding="utf-8"))["scenarios"]}


def f(v, nd=1):
    if v is None:
        return "–"
    return ("%." + str(nd) + "f") % v if not isinstance(v, int) else "%d" % v


def vn(s):
    return s.replace(".", ",")


def sav(sc, lv):
    return 100.0 * (1.0 - K[sc][lv]["energy_kwh"] / K[sc]["fixed"]["energy_kwh"])


def det(incs):
    out = []
    for i in incs:
        out.append("không phát hiện" if i["detected"] is None else "%d phút" % round((i["detected"] - i["t"]) / 60.0))
    return "; ".join(out) if out else "–"


def main():
    w, d = K["S10"], K["S1"]
    L = []
    L += ["# So sánh điện năng và chất lượng dịch vụ: lịch cố định và điều khiển thông minh", "",
          "> Sinh tự động bởi `python tools/gen_summary.py` từ `docs/ket-qua/kpi.json`. Bảng chi tiết, biểu đồ và diễn biến từng kịch bản:",
          "> [docs/ket-qua/README.md](ket-qua/README.md).", "",
          "Ba phương án chạy song song trong cùng một mô phỏng, với **cùng chuỗi nhu cầu, nguồn nước và sự cố**:",
          "", "- **Lịch cố định**: bơm 50 Hz theo khung giờ (1 bơm 05:00–22:00, 2 bơm 06:00–08:00 và 17:30–20:30), van đẩy mở một phần, tắt bơm ban đêm, đổi bơm theo ngày, không giám sát chất lượng.",
          "- **Thông minh – cơ bản**: edge gateway, điều khiển theo ngưỡng.",
          "- **Thông minh – nâng cao**: edge gateway, điều khiển dự báo theo mẫu giờ × ngày.", "",
          "## 1. Một tuần vận hành bình thường (S10) – bảng so sánh chính", "",
          "| Chỉ số | Lịch cố định | Thông minh – cơ bản | Thông minh – nâng cao |", "|---|---:|---:|---:|"]
    rows = [("Điện năng tiêu thụ (kWh/tuần)", "energy_kwh", 1), ("Suất điện năng (kWh/m³)", "specific_kwh_m3", 3),
            ("Áp lực ngoài dải (phút/tuần)", "t_out_min", 0), ("  · điểm bất lợi < 1,4 bar", "t_low_min", 0),
            ("  · đầu ra > 4,0 bar", "t_high_min", 0), ("Thời gian đạt dải áp (%)", "pct_in_band", 1),
            ("Số lần vi phạm chất lượng nước", "quality_episodes", 0), ("Số lần khởi động bơm", "starts_total", 0),
            ("Rò rỉ trên mạng lưới (m³)", "leak_m3", 0), ("Áp đầu ra lớn nhất (bar)", "p_out_max", 2)]
    for name, key, nd in rows:
        L.append("| %s | %s | %s | %s |" % (name, vn(f(w["fixed"][key], nd)), vn(f(w["basic"][key], nd)), vn(f(w["advanced"][key], nd))))
    L.append("| Tiết kiệm điện so với lịch cố định | – | %s %% | %s %% |" % (vn(f(sav("S10", "basic"))), vn(f(sav("S10", "advanced")))))
    L += ["", "## 2. Tổng hợp các kịch bản", "",
          "| Kịch bản | kWh cố định / cơ bản / nâng cao | Tiết kiệm (cơ bản, nâng cao) | Phút ngoài dải áp | Vi phạm chất lượng (đợt; m³ nước không đạt) | Khởi động bơm | Phát hiện sự cố (cố định / cơ bản / nâng cao) |",
          "|---|---:|---:|---:|---:|---:|---|"]
    for sid in [k for k in SC if k in K]:
        r = K[sid]
        L.append("| %s | %s / %s / %s | %s %%, %s %% | %s / %s / %s | %s; %s / %s; %s / %s; %s | %d / %d / %d | %s / %s / %s |" % (
            SC[sid]["name"], vn(f(r["fixed"]["energy_kwh"], 0)), vn(f(r["basic"]["energy_kwh"], 0)), vn(f(r["advanced"]["energy_kwh"], 0)),
            vn(f(sav(sid, "basic"), 0)), vn(f(sav(sid, "advanced"), 0)),
            vn(f(r["fixed"]["t_out_min"], 0)), vn(f(r["basic"]["t_out_min"], 0)), vn(f(r["advanced"]["t_out_min"], 0)),
            r["fixed"]["quality_episodes"], vn(f(r["fixed"]["quality_viol_m3"])), r["basic"]["quality_episodes"], vn(f(r["basic"]["quality_viol_m3"])),
            r["advanced"]["quality_episodes"], vn(f(r["advanced"]["quality_viol_m3"])),
            r["fixed"]["starts_total"], r["basic"]["starts_total"], r["advanced"]["starts_total"],
            det(r["fixed"]["incidents"]), det(r["basic"]["incidents"]), det(r["advanced"]["incidents"])))
    s7 = K["S7"]
    L += ["", "Đọc cột tiết kiệm cùng với lượng nước cấp được: ở S7, lịch cố định tốn ít điện hơn (%s kWh so với %s kWh) chỉ vì "
          "không bơm được nước từ 08:00 đến 16:30 (cấp %s m³ so với %s m³). Suất điện năng mới là thước đo công bằng: %s so với %s kWh/m³."
          % (vn(f(s7["fixed"]["energy_kwh"], 0)), vn(f(s7["basic"]["energy_kwh"], 0)), vn(f(s7["fixed"]["delivered_m3"], 0)),
             vn(f(s7["basic"]["delivered_m3"], 0)), vn(f(s7["fixed"]["specific_kwh_m3"], 3)), vn(f(s7["basic"]["specific_kwh_m3"], 3)))]
    s4, s6, s8, s9 = K["S4"], K["S6"], K["S8"], K["S9"]
    L += ["", "## 3. Phân tích", "",
          "### Điện năng",
          "",
          "Trong tuần S10, điều khiển thông minh tiêu thụ %s kWh (cơ bản) và %s kWh (nâng cao) so với %s kWh của lịch cố định, tức tiết kiệm %s %% và %s %%, "
          "dù trạm thông minh chạy **24 giờ** còn lịch cố định tắt bơm 7 giờ mỗi đêm. Suất điện năng giảm từ %s xuống %s kWh/m³. Ba nguyên nhân chính:"
          % (vn(f(w["basic"]["energy_kwh"], 0)), vn(f(w["advanced"]["energy_kwh"], 0)), vn(f(w["fixed"]["energy_kwh"], 0)), vn(f(sav("S10", "basic"), 0)), vn(f(sav("S10", "advanced"), 0)),
             vn(f(w["fixed"]["specific_kwh_m3"], 3)), vn(f(w["advanced"]["specific_kwh_m3"], 3))),
          "",
          "1. **Bỏ áp dư**: lịch cố định chạy 50 Hz nên áp đầu ra 3,5–4,4 bar khi nhu cầu thấp; điều khiển thông minh giữ áp vừa đủ theo lưu lượng "
          "(khoảng 1,9–2,1 bar ban đêm, 2,8–3,7 bar giờ cao điểm). Công suất tỉ lệ với cột áp, và theo luật tương tự còn giảm theo lập phương tốc độ.",
          "2. **Bỏ tổn thất tiết lưu**: van đẩy mở một phần trong lịch cố định tiêu hao năng lượng thành nhiệt.",
          "3. **Giảm rò rỉ** (FAVAD, $Q_L \\propto P^{1,18}$): áp trung bình thấp hơn nên lượng nước phải bơm ít hơn (rò rỉ %s m³ so với %s m³/tuần)."
          % (vn(f(w["advanced"]["leak_m3"], 0)), vn(f(w["fixed"]["leak_m3"], 0))),
          "",
          "Mức nâng cao tiết kiệm thêm khoảng %s %% so với mức cơ bản nhờ biên áp thích nghi (biên nhỏ khi ban đêm ổn định). Đổi lại, nó ghép bơm sớm "
          "nên khởi động nhiều hơn (%d so với %d lần/tuần) – vẫn ít hơn lịch cố định (%d lần) và trong giới hạn 6 lần/giờ."
          % (vn(f(100 * (1 - w["advanced"]["energy_kwh"] / w["basic"]["energy_kwh"]), 1)), w["advanced"]["starts_total"], w["basic"]["starts_total"], w["fixed"]["starts_total"]),
          "",
          "### Chất lượng dịch vụ (áp lực)",
          "",
          "Lịch cố định chỉ đạt dải áp %s %% thời gian: mất áp ở điểm bất lợi khi tắt bơm ban đêm và khi buổi sáng bồn mái các hộ nạp bù "
          "(%s phút/tuần), và quá 4,0 bar khi nhu cầu thấp (%s phút/tuần). Điều khiển thông minh đạt %s %% (cơ bản) và %s %% (nâng cao). "
          "Phần ngoài dải còn lại của mức cơ bản chủ yếu là các lần sụt áp ngắn khi một bơm đã chạy hết công suất và phải chờ 20 s mới ghép bơm thứ hai; mức nâng cao "
          "ghép bơm theo mô hình khả năng một bơm nên tránh được."
          % (vn(f(w["fixed"]["pct_in_band"], 1)), vn(f(w["fixed"]["t_low_min"], 0)), vn(f(w["fixed"]["t_high_min"], 0)), vn(f(w["basic"]["pct_in_band"], 2)), vn(f(w["advanced"]["pct_in_band"], 2))),
          "",
          "### Chất lượng nước",
          "",
          "Khi nước nguồn đục (S4), lịch cố định cấp %s m³ nước vượt 2 NTU vào mạng vì không có thiết bị đo; gateway chỉ để lọt %s m³ (cơ bản) trong thời gian xác nhận 60 s "
          "và trễ của máy đo, rồi dừng an toàn và đóng van MV-02. Cái giá là %s phút mất áp khi trạm dừng – bồn mái của hộ dân bù được nên không ai thiếu nước thực sự. "
          "Với clo dư giảm trong khi mất mạng (S9), gateway tự quyết định dừng an toàn và gửi SMS; lịch cố định cấp %s m³ nước thiếu clo."
          % (vn(f(s4["fixed"]["quality_viol_m3"])), vn(f(s4["basic"]["quality_viol_m3"])), vn(f(s4["basic"]["t_low_min"], 0)), vn(f(s9["fixed"]["quality_viol_m3"]))),
          "",
          "### Phát hiện sự cố và an toàn thiết bị",
          "",
          "- Hỏng bơm (S7): gateway chuyển bơm dự phòng trong vài giây; lịch cố định chờ tới lượt kiểm tra 16:30, khu dân cư mất áp từ 08:00 đến 16:30.",
          "- Mất nước nguồn (S6): lịch cố định chạy khô %s phút trước khi phao cơ khí cắt; gateway dừng ở 0,6 m, không chạy khô. Mức nâng cao còn ước lượng thời điểm cạn bể (cảnh báo khi còn dưới 6 h) để trung tâm điều xe bồn hoặc báo cho dân, và khi giảm áp chủ động chỉ bỏ phần biên an toàn, không hạ dưới chuẩn dịch vụ."
          % vn(f(s6["fixed"]["dry_run_min"])),
          "- Vỡ ống ban đêm (S8): chỉ mức nâng cao phát hiện (so sánh lưu lượng với mẫu dự báo); áp lực đầu ra vẫn bình thường nên điều khiển theo ngưỡng không thấy. "
          "Lưu ý: vì giữ áp 24/24 nên trạm thông minh mất qua chỗ vỡ %s m³ so với %s m³ của lịch cố định (tắt bơm ban đêm) – phát hiện sớm là điều kiện để lợi ích này đảo chiều."
          % (vn(f(s8["advanced"]["burst_m3"] if "burst_m3" in s8["advanced"] else 0)), vn(f(s8["fixed"]["burst_m3"] if "burst_m3" in s8["fixed"] else 0))),
          "",
          "### So sánh công bằng",
          "",
          "Kết quả phụ thuộc cách vận hành của phương án đối chứng. Ở đây lịch cố định khá điển hình cho trạm thủ công nhưng chưa tối ưu (van đẩy tiết lưu, tắt bơm đêm). "
          "Học viên nên thử phương án đối chứng tốt hơn (sửa `baseline` trong `config/station.json`) trước khi kết luận về hiệu quả đầu tư.", ""]
    # chèn bảng chính vào README
    i0 = L.index("## 1. Một tuần vận hành bình thường (S10) – bảng so sánh chính")
    i1 = L.index("## 2. Tổng hợp các kịch bản")
    block = ["Một tuần vận hành bình thường (kịch bản S10, cùng nhu cầu cho cả ba phương án):", ""] + L[i0 + 2:i1 - 1]
    rp = os.path.join(ROOT, "README.md")
    txt = open(rp, encoding="utf-8").read()
    a, b = txt.index("<!-- KQ-START -->"), txt.index("<!-- KQ-END -->")
    txt = txt[:a] + "<!-- KQ-START -->\n" + "\n".join(block) + "\n" + txt[b:]
    open(rp, "w", encoding="utf-8").write(txt)
    path = os.path.join(ROOT, "docs", "06-so-sanh-dien-nang-chat-luong.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print("Đã ghi", path)


if __name__ == "__main__":
    main()
