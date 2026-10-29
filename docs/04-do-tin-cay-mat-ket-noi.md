# Độ tin cậy khi mất kết nối: rủi ro, giới hạn, dự phòng và kiểm thử

Nguyên tắc nền: **trạm phải an toàn và cấp nước được khi không có máy chủ**. Máy chủ làm cho trạm *tốt hơn* (dữ liệu
mạng lưới, kế hoạch, giám sát của con người), nhưng không được là điều kiện để trạm *an toàn*. Số liệu dẫn chứng lấy từ các
kịch bản S2, S3, S3b, S9 – xem [kết quả so sánh](ket-qua/README.md).

## 1. Rủi ro khi mất kết nối

| # | Rủi ro | Hậu quả | Cách hệ thống xử lý |
|---|---|---|---|
| R1 | Trung tâm không thấy trạm | Sự cố không được điều phối, dân phản ánh trước khi biết | Gateway vẫn tự xử lý; báo động nghiêm trọng gửi **SMS** qua kênh độc lập; máy chủ hiện “mất kết nối” sau 60 s (LWT) |
| R2 | Lệnh gửi trong lúc mất mạng được thực thi muộn, dựa trên trạng thái cũ | Ví dụ ghi đè áp lực lúc 06:30 được áp dụng lúc 14:00 khi nhu cầu đã khác | Lệnh có `expires_at`; máy chủ hủy lệnh hết hạn; gateway kiểm tra lại hạn; ghi đè áp có “hợp đồng thuê” tối đa 15 phút |
| R3 | Hai phía cùng sửa kịch bản | Mâu thuẫn tham số, mất chỉnh sửa của một bên | Hợp nhất 3 chiều; tham số dịch vụ/an toàn chọn giá trị bảo thủ; xung đột được ghi lại (S3, S9) |
| R4 | Mất dữ liệu đo xa | Báo cáo điện năng/chất lượng không đầy đủ, mất bằng chứng sự cố | Bộ đệm lưu-và-chuyển 12 h + nén; sự kiện không bao giờ bị nén; S9 mất mạng 20 h: nén 5 lần, **0** bản ghi mất, 100 % dữ liệu về máy chủ |
| R5 | Trùng dữ liệu khi phát lại | Đếm sai điện năng, cảnh báo lặp | `seq` chống trùng phía máy chủ; bộ đếm đơn điệu (kWh) do gateway giữ |
| R6 | Đồng hồ gateway trôi | Nhãn thời gian sai khi ghép dữ liệu | Ước lượng lệch khi đồng bộ (≈1,9 s sau 20 h trong S9), hiệu chỉnh tuyến tính |
| R7 | Kịch bản đã lưu không biết thông tin mới | Không biết lịch cắt nước, trạm lân cận hỏng, ống truyền tải sửa chữa, logger điểm bất lợi báo áp thấp | Biên áp +0,1 bar (+0,2 bar sau 24 h); cảnh báo mất nước nguồn và dự báo cạn bể dùng số đo tại chỗ |
| R8 | Không có người đặt lại sau dừng an toàn | Trạm dừng lâu hơn cần thiết khi chất lượng đã ổn (S9: dừng từ 35 h đến 41 h) | Chính sách mặc định: chờ lệnh đặt lại; tùy chọn `safety.quality_auto_restart` cho phép tự chạy lại khi nước đạt 10 phút – đánh đổi cần thảo luận |
| R9 | Mất mạng kéo dài nhiều ngày | Bộ đệm phải nén thô, dự báo không được hiệu chỉnh từ trung tâm | Nén có giới hạn 64 bản ghi/gộp rồi mới bỏ bản ghi cũ; bộ dự báo vẫn học tại chỗ; lùi về điều khiển theo ngưỡng khi sai số > 35 % |
| R10 | Mất điện lưới kèm mất mạng | Gateway và router tắt | UPS 4 h cho gateway + router; mạch cứng (phao LSLL, van an toàn) không phụ thuộc điện tử |

## 2. Giới hạn của kịch bản đã lưu

Kịch bản đã lưu là **tham số + luật** được kiểm thử trước. Nó không thay được hiểu biết của trung tâm:

1. **Không quan sát được điểm bất lợi.** Gateway ước lượng áp điểm bất lợi qua $r_{est} Q^2$. Nếu mạng lưới thay đổi
   (van khu vực đóng để sửa ống, $r$ thực tăng), gateway vẫn giữ áp như cũ và dân yếu nước; chỉ logger ở trung tâm thấy.
   Biên +0,1 bar khi mất mạng là cách “mua bảo hiểm” cho sai số này (S2 tốn thêm khoảng 1 kWh trong 8 h).
2. **Không biết sự kiện bên ngoài.** Lịch cắt nước của công ty cấp nước, sự cố trạm lân cận, nhu cầu bất thường (lễ, Tết).
   Bộ dự báo chỉ biết quá khứ, và có thể sai lớn đúng vào những ngày đặc biệt.
3. **Không có con người trong vòng quyết định.** Các quyết định cần đánh đổi giá trị (ngừng cấp nước cho 2.400 người vì
   clo 0,18 mg/L, hay tiếp tục cấp và khuyến cáo đun sôi?) được mã hóa sẵn một chiều. S9 cho thấy gateway tự dừng an toàn
   vào khoảng giờ thứ 35 khi không ai có thể xác nhận; dân sống nhờ bồn mái gần 6 giờ cho tới khi có lệnh đặt lại.
4. **Tiêu chí giám sát kịch bản mới bị giới hạn bởi cái đo được.** Ở mức cơ bản, S3b phát hiện PI quá yếu sau 8 phút vì
   phát hành đúng lúc nhu cầu tăng. Ở mức nâng cao, bù trước giữ áp gần điểm đặt nên **cùng kịch bản lỗi vượt qua 10 phút
   giám sát**, được xác nhận, rồi gây quá áp 4,03 bar khi ghép bơm lúc 06:40 (bộ giới hạn áp cao của lớp an toàn chặn lại).
   Phát hành lúc 03:00 cũng sẽ lọt qua. Cải tiến: giám sát qua ít nhất một chu kỳ cao điểm, triển khai thử một trạm trước.
5. **Không học được lỗi hệ thống.** Một cảm biến trôi chậm (ví dụ LT-101 lệch dần) có thể nằm trong phạm vi hợp lệ; chỉ đối
   chiếu cân bằng nước (FT-100, FT-101, mức) hoặc so sánh nhiều trạm mới phát hiện.

## 3. Chiến lược dự phòng (theo lớp)

| Lớp | Chiến lược | Trong mô phỏng |
|---|---|---|
| Thiết kế an toàn mặc định | Lớp an toàn tách khỏi kịch bản; giá trị mặc định thiên về an toàn khi mất thông tin (dùng giá trị lớn nhất của 2 cảm biến áp cho bảo vệ quá áp) | `safety.py` |
| Dự phòng cảm biến | 2 cảm biến áp + mô hình bơm biểu quyết 2/3; phát hiện kẹt; mất tín hiệu áp → chạy 40 Hz cố định | S5 |
| Dự phòng thiết bị | 2 bơm luân phiên; chuyển bơm dự phòng tức thì; giới hạn khởi động | S7 |
| Dự phòng kịch bản | Kịch bản học viên lỗi → kịch bản dựng sẵn; dự báo kém → theo ngưỡng; kịch bản mới xấu → quay lui | S3b, `test_broken_student_script_falls_back_to_builtin` |
| Dự phòng truyền thông | SMS cho báo động nghiêm trọng; bộ đệm + phát lại; LWT | S2, S9 |
| Chế độ suy giảm theo thời gian mất mạng | Biên áp tăng sau 24 h; có thể mở rộng: tắt ngủ đông, giảm số lần ghép/tách | `script.params.offline` |
| Con người | Lượt kiểm tra định kỳ vẫn cần thiết; quy trình xả bể, đặt lại có hướng dẫn | Lệnh `flush_tank`, `reset_safe_stop` (S4) |

Đề xuất mở rộng cho học viên nâng cao: **kịch bản ngoại tuyến phân tầng theo thời gian** (0–1 h: như bình thường; 1–24 h:
biên áp +0,1; > 24 h: biên +0,2, cấm ngủ đông, gửi SMS tóm tắt mỗi 6 h; > 72 h: chuyển sang điều khiển theo ngưỡng thuần
túy, ít trạng thái nhất), và **trung tâm phát trước “kế hoạch dự phòng”** (lịch cắt nước, ngày lễ) như một phần của kịch bản
để gateway vẫn có khi mất mạng.

## 4. Kiểm thử

| Mức | Nội dung | Có sẵn |
|---|---|---|
| Đơn vị | Mô hình bơm, bình tích áp, cân bằng khối lượng, van an toàn, hợp nhất 3 chiều, kiểm tra kịch bản | `tests/test_physics.py`, `tests/test_server_merge.py` |
| Tích hợp gateway | Thời gian phát hiện mất mạng, nén bộ đệm không mất dữ liệu, lệnh hết hạn, ghi đè hết hạn, từ chối kịch bản sai, dừng an toàn & điều kiện đặt lại, chuyển bơm, biểu quyết cảm biến, chống chạy khô | `tests/test_gateway.py` |
| Kịch bản | Mọi kịch bản chạy được; điều khiển thông minh tốt hơn lịch cố định về điện năng và dải áp | `tests/test_scenarios.py` |
| Đối chiếu hai bản cài đặt | Python và JavaScript cho cùng KPI, cùng số báo động | `tests/test_parity_js.py` |
| Chấm bài | 9 tiêu chí cho kịch bản học viên | `python -m trambom check-student` |
| Tiêm lỗi (đề xuất mở rộng) | Ma trận: {mất mạng ngắn/dài} × {sự cố chất lượng, hỏng bơm, mất nguồn, cảm biến kẹt} × {thời điểm: đêm, cao điểm}; ngẫu nhiên hóa hạt giống; kiểm tra bất biến: không chạy khô, áp ≤ 4,5 bar, không cấp nước vượt 2 NTU quá 1 m³, không mất sự kiện | Viết thêm bằng `TwinSim` + vòng lặp hạt giống |
| Phần cứng trong vòng lặp (HIL) | Gateway thật (PLC/Raspberry Pi) chạy kịch bản, mô hình trạm chạy trên máy tính qua Modbus/MQTT; ngắt mạng thật bằng tường lửa | Mô hình Python có thể làm “trạm ảo” |
| Thử nghiệm hiện trường | Chạy song song (shadow) – gateway tính nhưng chưa điều khiển, so sánh với vận hành thủ công vài tuần; sau đó chuyển dần quyền điều khiển | – |

Bất biến nên kiểm tra trong mọi kịch bản tiêm lỗi (đều đo được từ `KpiTracker`): thời gian chạy khô = 0; áp đầu ra lớn nhất
≤ ngưỡng cắt; lượng nước không đạt QCVN đã cấp ≤ lưu lượng × (thời gian xác nhận + trễ máy đo); độ đầy đủ dữ liệu tại máy
chủ = 100 % khi mất mạng ngắn hơn khả năng bộ đệm; không lệnh nào được thực thi sau hạn.

## 5. Câu hỏi thảo luận (DOK 3)

1. Bạn chọn *dừng an toàn* hay *cấp tiếp và cảnh báo* khi clo dư 0,15 mg/L, mất mạng, bồn mái đủ 3 h? Thay đổi gì nếu đủ 12 h?
2. Thời gian phát hiện mất mạng 60 s: hậu quả nếu giảm còn 15 s? tăng lên 5 phút?
3. Nếu kẻ xấu chiếm được máy chủ và phát hành kịch bản “p_set_max = 4,0, kp = 60”, những lớp nào còn bảo vệ trạm?
4. Với dữ liệu của S10, ước tính dung lượng bộ đệm cần để chịu được mất mạng 3 ngày ở độ phân giải 1 phút.
