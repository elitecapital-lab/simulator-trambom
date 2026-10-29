# So sánh điện năng và chất lượng dịch vụ: lịch cố định và điều khiển thông minh

> Sinh tự động bởi `python tools/gen_summary.py` từ `docs/ket-qua/kpi.json`. Bảng chi tiết, biểu đồ và diễn biến từng kịch bản:
> [docs/ket-qua/README.md](ket-qua/README.md).

Ba phương án chạy song song trong cùng một mô phỏng, với **cùng chuỗi nhu cầu, nguồn nước và sự cố**:

- **Lịch cố định**: bơm 50 Hz theo khung giờ (1 bơm 05:00–22:00, 2 bơm 06:00–08:00 và 17:30–20:30), van đẩy mở một phần, tắt bơm ban đêm, đổi bơm theo ngày, không giám sát chất lượng.
- **Thông minh – cơ bản**: edge gateway, điều khiển theo ngưỡng.
- **Thông minh – nâng cao**: edge gateway, điều khiển dự báo theo mẫu giờ × ngày.

## 1. Một tuần vận hành bình thường (S10) – bảng so sánh chính

| Chỉ số | Lịch cố định | Thông minh – cơ bản | Thông minh – nâng cao |
|---|---:|---:|---:|
| Điện năng tiêu thụ (kWh/tuần) | 527,4 | 317,1 | 307,5 |
| Suất điện năng (kWh/m³) | 0,174 | 0,105 | 0,102 |
| Áp lực ngoài dải (phút/tuần) | 5292 | 1 | 0 |
|   · điểm bất lợi < 1,4 bar | 3631 | 1 | 0 |
|   · đầu ra > 4,0 bar | 1661 | 0 | 0 |
| Thời gian đạt dải áp (%) | 47,5 | 100,0 | 100,0 |
| Số lần vi phạm chất lượng nước | 0 | 0 | 0 |
| Số lần khởi động bơm | 21 | 15 | 18 |
| Rò rỉ trên mạng lưới (m³) | 311 | 267 | 257 |
| Áp đầu ra lớn nhất (bar) | 4,39 | 3,68 | 3,73 |
| Tiết kiệm điện so với lịch cố định | – | 39,9 % | 41,7 % |

## 2. Tổng hợp các kịch bản

| Kịch bản | kWh cố định / cơ bản / nâng cao | Tiết kiệm (cơ bản, nâng cao) | Phút ngoài dải áp | Vi phạm chất lượng (đợt; m³ nước không đạt) | Khởi động bơm | Phát hiện sự cố (cố định / cơ bản / nâng cao) |
|---|---:|---:|---:|---:|---:|---|
| S1 · Vận hành bình thường có kết nối | 74 / 45 / 44 | 39 %, 41 % | 777 / 0 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 3 / 2 / 3 | – / – / – |
| S2 · Mất mạng 8 giờ – gateway tự vận hành | 74 / 46 / 45 | 38 %, 40 % | 777 / 0 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 3 / 2 / 3 | – / – / – |
| S3 · Khôi phục kết nối, đồng bộ và xử lý xung đột | 74 / 49 / 45 | 34 %, 40 % | 777 / 0 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 3 / 3 / 3 | – / – / – |
| S3b · Kịch bản mới bị lỗi – tự động quay lui | 32 / 20 / 22 | 36 %, 32 % | 400 / 4 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 2 / 1 / 1 | – / – / – |
| S4 · Sự cố độ đục – cảnh báo và dừng an toàn | 74 / 44 / 43 | 41 %, 42 % | 777 / 320 / 318 | 1; 65,5 / 1; 0,4 / 1; 0,5 | 3 / 3 / 3 | không phát hiện / 42 phút / 43 phút |
| S5 · Cảm biến áp lực PT-101 bị kẹt – áp lực vượt ngưỡng | 32 / 22 / 20 | 29 %, 38 % | 400 / 0 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 2 / 1 / 1 | – / 0 phút / 0 phút |
| S6 · Mất nước nguồn 10 giờ – mức bể thấp | 51 / 38 / 37 | 24 %, 27 % | 935 / 493 / 487 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 5 / 3 / 3 | 450 phút / 29 phút / 27 phút |
| S7 · Hỏng bơm P-01 giờ cao điểm – chuyển bơm dự phòng | 42 / 45 / 43 | -5 %, -2 % | 1232 / 1 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 4 / 1 / 1 | 525 phút / 0 phút / 0 phút |
| S8 · Vỡ ống ban đêm – phát hiện bất thường lưu lượng | 78 / 58 / 57 | 25 %, 26 % | 910 / 34 / 34 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 3 / 2 / 3 | không phát hiện / không phát hiện / 15 phút |
| S9 · Tổng hợp DOK3: mất mạng dài + clo giảm + mất nguồn | 148 / 97 / 95 | 35 %, 36 % | 1429 / 496 / 482 | 1; 29,0 / 1; 1,4 / 1; 2,5 | 6 / 4 / 5 | không phát hiện; không phát hiện / 416 phút; 33 phút / 421 phút; 11 phút |
| S10 · Một tuần vận hành – so sánh điện năng | 527 / 317 / 308 | 40 %, 42 % | 5292 / 1 / 0 | 0; 0,0 / 0; 0,0 / 0; 0,0 | 21 / 15 / 18 | – / – / – |

Đọc cột tiết kiệm cùng với lượng nước cấp được: ở S7, lịch cố định tốn ít điện hơn (42 kWh so với 45 kWh) chỉ vì không bơm được nước từ 08:00 đến 16:30 (cấp 271 m³ so với 430 m³). Suất điện năng mới là thước đo công bằng: 0,156 so với 0,104 kWh/m³.

## 3. Phân tích

### Điện năng

Trong tuần S10, điều khiển thông minh tiêu thụ 317 kWh (cơ bản) và 308 kWh (nâng cao) so với 527 kWh của lịch cố định, tức tiết kiệm 40 % và 42 %, dù trạm thông minh chạy **24 giờ** còn lịch cố định tắt bơm 7 giờ mỗi đêm. Suất điện năng giảm từ 0,174 xuống 0,102 kWh/m³. Ba nguyên nhân chính:

1. **Bỏ áp dư**: lịch cố định chạy 50 Hz nên áp đầu ra 3,5–4,4 bar khi nhu cầu thấp; điều khiển thông minh giữ áp vừa đủ theo lưu lượng (khoảng 1,9–2,1 bar ban đêm, 2,8–3,7 bar giờ cao điểm). Công suất tỉ lệ với cột áp, và theo luật tương tự còn giảm theo lập phương tốc độ.
2. **Bỏ tổn thất tiết lưu**: van đẩy mở một phần trong lịch cố định tiêu hao năng lượng thành nhiệt.
3. **Giảm rò rỉ** (FAVAD, $Q_L \propto P^{1,18}$): áp trung bình thấp hơn nên lượng nước phải bơm ít hơn (rò rỉ 257 m³ so với 311 m³/tuần).

Mức nâng cao tiết kiệm thêm khoảng 3,0 % so với mức cơ bản nhờ biên áp thích nghi (biên nhỏ khi ban đêm ổn định). Đổi lại, nó ghép bơm sớm nên khởi động nhiều hơn (18 so với 15 lần/tuần) – vẫn ít hơn lịch cố định (21 lần) và trong giới hạn 6 lần/giờ.

### Chất lượng dịch vụ (áp lực)

Lịch cố định chỉ đạt dải áp 47,5 % thời gian: mất áp ở điểm bất lợi khi tắt bơm ban đêm và khi buổi sáng bồn mái các hộ nạp bù (3631 phút/tuần), và quá 4,0 bar khi nhu cầu thấp (1661 phút/tuần). Điều khiển thông minh đạt 99,99 % (cơ bản) và 100,00 % (nâng cao). Phần ngoài dải còn lại của mức cơ bản chủ yếu là các lần sụt áp ngắn khi một bơm đã chạy hết công suất và phải chờ 20 s mới ghép bơm thứ hai; mức nâng cao ghép bơm theo mô hình khả năng một bơm nên tránh được.

### Chất lượng nước

Khi nước nguồn đục (S4), lịch cố định cấp 65,5 m³ nước vượt 2 NTU vào mạng vì không có thiết bị đo; gateway chỉ để lọt 0,4 m³ (cơ bản) trong thời gian xác nhận 60 s và trễ của máy đo, rồi dừng an toàn và đóng van MV-02. Cái giá là 320 phút mất áp khi trạm dừng – bồn mái của hộ dân bù được nên không ai thiếu nước thực sự. Với clo dư giảm trong khi mất mạng (S9), gateway tự quyết định dừng an toàn và gửi SMS; lịch cố định cấp 29,0 m³ nước thiếu clo.

### Phát hiện sự cố và an toàn thiết bị

- Hỏng bơm (S7): gateway chuyển bơm dự phòng trong vài giây; lịch cố định chờ tới lượt kiểm tra 16:30, khu dân cư mất áp từ 08:00 đến 16:30.
- Mất nước nguồn (S6): lịch cố định chạy khô 25,6 phút trước khi phao cơ khí cắt; gateway dừng ở 0,6 m, không chạy khô. Mức nâng cao còn ước lượng thời điểm cạn bể (cảnh báo khi còn dưới 6 h) để trung tâm điều xe bồn hoặc báo cho dân, và khi giảm áp chủ động chỉ bỏ phần biên an toàn, không hạ dưới chuẩn dịch vụ.
- Vỡ ống ban đêm (S8): chỉ mức nâng cao phát hiện (so sánh lưu lượng với mẫu dự báo); áp lực đầu ra vẫn bình thường nên điều khiển theo ngưỡng không thấy. Lưu ý: vì giữ áp 24/24 nên trạm thông minh mất qua chỗ vỡ 79,5 m³ so với 51,6 m³ của lịch cố định (tắt bơm ban đêm) – phát hiện sớm là điều kiện để lợi ích này đảo chiều.

### So sánh công bằng

Kết quả phụ thuộc cách vận hành của phương án đối chứng. Ở đây lịch cố định khá điển hình cho trạm thủ công nhưng chưa tối ưu (van đẩy tiết lưu, tắt bơm đêm). Học viên nên thử phương án đối chứng tốt hơn (sửa `baseline` trong `config/station.json`) trước khi kết luận về hiệu quả đầu tư.

