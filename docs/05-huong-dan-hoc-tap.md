# Hướng dẫn học tập và gợi ý phân hóa

Dành cho các học phần **Tự động hóa**, **Hệ thống nhúng/IoT** và **Kỹ thuật cấp thoát nước**.

## 1. Mục tiêu

| Mức | Người học có thể… |
|---|---|
| Bloom – Áp dụng | Dùng đường đặc tính bơm, luật tương tự và mô hình mạng lưới để tính áp đặt theo lưu lượng; cấu hình và chạy các kịch bản điều khiển; đọc biểu đồ áp lực, lưu lượng, điện năng |
| Bloom – Phân tích | So sánh định lượng lịch cố định và điều khiển thông minh; tách nguyên nhân chênh lệch (áp dư, rò rỉ, hiệu suất bơm, tắt bơm ban đêm); truy nguyên chuỗi sự kiện trong nhật ký gateway |
| DOK 3 – Lập luận chiến lược | Bảo vệ một quyết định thiết kế khi thông tin không chắc chắn: mất mạng, nhu cầu biến động, cảm biến có thể sai, hai mục tiêu xung đột (điện năng và an toàn) |

## 2. Hỗ trợ trước khi bắt đầu (bắt buộc đọc)

1. **Sơ đồ khối hệ thống** – hộp thoại *Hướng dẫn → 1 · Sơ đồ khối* trên web, hoặc [kiến trúc](01-kien-truc-he-thong.md).
2. **Bảng ngưỡng tham số** – *Hướng dẫn → 2 · Bảng ngưỡng*, hoặc `python -m trambom thresholds`, hoặc
   [thành phần và tham số](02-thanh-phan-va-tham-so.md#bảng-ngưỡng-tham-số). Bảng gồm áp lực min/max, mức nước thấp/cao,
   ngưỡng clo dư, độ đục, pH, thời gian trễ mất mạng, biên áp khi mất mạng, dung lượng bộ đệm.
3. **Chọn mức độ kịch bản** – *Hướng dẫn → 3*: **Cơ bản** (điều khiển theo ngưỡng) hoặc **Nâng cao** (điều khiển dự báo theo
   mẫu sử dụng theo giờ và ngày).

Câu hỏi khởi động (5 phút): *Ở lưu lượng 30 m³/h, áp đầu ra cần tối thiểu bao nhiêu để điểm bất lợi đạt 1,4 bar?*
Đáp án: $1{,}4 + 4/10{,}19 + 0{,}00111 \cdot 30^2 \approx 2{,}79$ bar.

## 3. Trình tự bài thực hành gợi ý (4 buổi × 2 tiết)

| Buổi | Kịch bản | Hoạt động | Sản phẩm |
|---|---|---|---|
| 1 | S1, S10 | Quan sát mô hình 3D, tra tham số thiết bị; đọc biểu đồ; giải thích vì sao điều khiển thông minh tiết kiệm ≈40 % điện | Bảng KPI có chú thích nguyên nhân |
| 2 | S2, S3, S3b | Mất mạng, đồng bộ, xung đột tham số, kịch bản lỗi; đọc nhật ký gateway và máy chủ | Biểu đồ trình tự (sequence) của một phiên đồng bộ, nhận xét từng quyết định hợp nhất |
| 3 | S4, S5, S6, S7, S8 | Sự cố chất lượng nước, cảm biến kẹt, mất nước nguồn, hỏng bơm, vỡ ống | Bảng “sự cố – phát hiện – phản ứng – thời gian” cho hai phương án |
| 4 | S9 + bài phân hóa | Tình huống tổng hợp DOK 3; hoàn thiện kịch bản của nhóm | Báo cáo + bảo vệ thiết kế |

Câu hỏi phân tích của từng kịch bản nằm trong `config/scenarios.json` và tab **Bài học** trên web.

## 4. Phân hóa

### Học viên cơ bản – hoàn thiện kịch bản theo ngưỡng

- Python: sửa các khối `TODO` trong `student/kich_ban_nguong.py`, chạy
  `python -m trambom run S1 --script student/kich_ban_nguong.py` và tự chấm
  `python -m trambom check-student student/kich_ban_nguong.py`.
- Web: tab **Kịch bản → Mẫu bài tập**, sửa hàm `dieuKhien`, bấm **Nạp vào gateway**, so sánh KPI trực tiếp.
- Tiêu chí đạt (bộ chấm tự động, 9 tiêu chí): áp đạt dải ≥ 98 %; tiết kiệm ≥ 20 % điện so với lịch cố định; không vượt
  4,0 bar; ≤ 12 lần khởi động/ngày; dừng bơm khi mức < 0,6 m; không chạy khô; vẫn cấp nước khi bơm chính hỏng; luân phiên bơm.
- Bài mở rộng nhỏ: thêm quy tắc cảnh báo rò rỉ ban đêm đơn giản (lưu lượng 02:00–04:00 > ngưỡng cố định) và thử với S8.

### Học viên nâng cao – điều khiển dự báo và tích hợp mạng lưới

1. **Điều khiển dự báo**: hoàn thiện `student/kich_ban_du_bao.py` (biên áp theo độ bất định, bù trước, ghép bơm sớm,
   giảm áp theo dự báo cạn bể). So sánh với kịch bản dựng sẵn: `python -m trambom run S10 --script …` và
   `python -m trambom run S10 --level advanced`. Phân tích: dự báo giúp gì (sụt áp lúc ghép bơm, giảm áp sớm khi mất nguồn,
   phát hiện rò rỉ) và không giúp gì (điện năng chỉ giảm vài phần trăm so với điều khiển theo ngưỡng).
2. **Mô hình hóa tích hợp mạng lưới**: hoàn thiện `student/mang_luoi_nang_cao.py` – bộ điều phối ở trung tâm dùng logger
   áp điểm bất lợi để hiệu chỉnh tham số từng trạm mỗi giờ. Đánh giá theo tổng kWh và số phút ngoài dải của 4 trạm.
3. **Mở rộng tùy chọn**: thay mô hình mạng lưới một nút bằng mô hình EPANET qua thư viện WNTR; ghép nhiều vùng cấp nước
   (DMA) có van liên thông; thêm trạm châm clo bổ sung.

## 5. Thang đánh giá gợi ý

| Tiêu chí | Đạt (5) | Tốt (7) | Xuất sắc (9–10) |
|---|---|---|---|
| Kịch bản điều khiển | Qua bộ chấm cơ bản | Thêm 1 cải tiến có đo lường | Kịch bản dự báo hoặc điều phối mạng lưới, chứng minh bằng S10/S9 |
| Phân tích số liệu | Bảng KPI đúng | Giải thích nguyên nhân bằng mô hình (áp dư, FAVAD, hiệu suất) | Phân tích độ nhạy (ví dụ biên áp, k_σ, thời gian xác nhận chất lượng) |
| Lập luận độ tin cậy | Liệt kê rủi ro mất mạng | Đề xuất chiến lược dự phòng có kiểm chứng mô phỏng | Phản biện giới hạn của chính giải pháp, đề xuất kiểm thử |
| Trình bày | Rõ ràng | Có sơ đồ trình tự / trạng thái | Bảo vệ được trước câu hỏi “nếu… thì sao?” |

## 6. Câu hỏi DOK 3 cho thảo luận cuối khóa

1. Khi mất mạng 20 h và clo dư giảm dần (S9), gateway dừng cấp nước. Dân có bồn mái nên chưa thiếu nước ngay. Nếu
   bồn mái chỉ đủ 3 h thì quyết định có còn đúng không? Đề xuất một chính sách phân tầng.
2. Biên áp +0,1 bar khi mất mạng tốn bao nhiêu điện trong S2? Khi nào nên tăng biên, khi nào nên giảm?
3. Kịch bản dự báo lùi về điều khiển theo ngưỡng khi sai số > 35 %. Ngưỡng này nên đặt dựa trên dữ liệu nào?
4. Bộ đệm 12 h có đủ không nếu mất mạng 3 ngày do bão? Bạn chọn bỏ gì, giữ gì?
5. So sánh công bằng: nếu công nhân ở phương án lịch cố định được phép chỉnh van đẩy theo mùa thì chênh lệch điện năng còn
   bao nhiêu? (sửa `baseline.throttle_k`, `baseline.windows` trong `config/station.json`).
