# Mô phỏng 3D trạm bơm tăng áp thông minh (ST-01)

Mô phỏng tương tác hệ thống điều khiển tự động cho một trạm bơm tăng áp nhỏ **không người trực** phục vụ khu dân cư,
dành cho sinh viên các học phần Tự động hóa, Hệ thống nhúng/IoT và Kỹ thuật cấp thoát nước.

- **Bản web 3D** (Three.js, chạy trong trình duyệt): mô hình trạm bơm với bể chứa, 2 bơm biến tần, đường ống, van, đồng hồ
  áp lực, cảm biến lưu lượng, mức nước, chất lượng nước (clo dư, độ đục, pH), bình tích áp, tủ điều khiển với edge gateway;
  biểu đồ theo thời gian; bảng so sánh trực tiếp với phương án lịch cố định; tiêm sự cố; trình soạn kịch bản cho học viên;
  bảng điều khiển trung tâm cho 4 trạm.
- **Lõi mô phỏng Python** (chỉ thư viện chuẩn): chạy kịch bản không giao diện, xuất bảng KPI và biểu đồ, kiểm thử tự động,
  chấm bài học viên. Lõi JavaScript của bản web là bản chuyển đổi một-một, được kiểm thử đối chiếu cho cùng kết quả.

![Kết quả so sánh S9](docs/ket-qua/img/S9.png)

## Cài đặt và chạy

Yêu cầu: Python ≥ 3.9. Trình duyệt hiện đại có WebGL (Chrome, Edge, Firefox, Safari). Node.js chỉ cần nếu muốn chạy kiểm thử
đối chiếu Python–JavaScript.

```bash
git clone <địa chỉ kho> simulator-trambom
cd simulator-trambom
python -m pip install -r requirements.txt   # matplotlib (biểu đồ báo cáo) và pytest (kiểm thử)
```

### Bản web 3D

```bash
python -m trambom web
```

Lệnh này chạy máy chủ web tĩnh tại `http://127.0.0.1:8000/web/` và mở trình duyệt. Có thể dùng bất kỳ máy chủ tĩnh nào
**phục vụ từ thư mục gốc của kho** (bản web đọc cấu hình chung ở `config/`), ví dụ `python -m http.server 8000` rồi mở
`/web/`. Không mở trực tiếp `index.html` bằng `file://` vì trình duyệt chặn ES module. Three.js được đóng gói sẵn trong
`web/vendor/` nên chạy được khi không có Internet (phông chữ sẽ dùng phông hệ thống).

Mở thẳng một kịch bản: `http://127.0.0.1:8000/web/#S4-advanced`.

### Mô phỏng Python (không giao diện)

```bash
python -m trambom list                       # danh sách kịch bản
python -m trambom thresholds                 # bảng ngưỡng tham số
python -m trambom run S3 --level advanced    # chạy một kịch bản, in bảng KPI + diễn biến, lưu out/S3_advanced.png
python -m trambom compare                    # chạy mọi kịch bản ở cả hai mức → docs/ket-qua/README.md + hình
python -m trambom network --hours 24         # 4 trạm trong mạng lưới, bảng điều hành tổng quát
python -m trambom check-student student/kich_ban_nguong.py   # chấm kịch bản theo ngưỡng của học viên
```

### Kiểm thử

```bash
python -m pytest -q
```

Gồm kiểm thử mô hình vật lý (đường đặc tính, luật tương tự, bảo toàn khối lượng, van an toàn), gateway (phát hiện mất mạng,
nén bộ đệm không mất dữ liệu, lệnh hết hạn, từ chối kịch bản sai, dừng an toàn, biểu quyết cảm biến), hợp nhất xung đột,
mọi kịch bản, mẫu bài học viên, và đối chiếu Python–JavaScript (cần Node.js).

## Bốn chế độ vận hành được mô phỏng

| Chế độ | Diễn biến | Kịch bản |
|---|---|---|
| (a) Bình thường có kết nối | Áp đặt theo lưu lượng + PI biến tần, ghép/tách và luân phiên bơm, dừng khi mức thấp; đo xa 10 s | S1, S10 |
| (b) Mất mạng – tự vận hành | Phát hiện sau 60 s không có ACK nhịp tim; chạy kịch bản đã lưu, cộng biên áp an toàn, lưu đệm và nén dữ liệu, SMS dự phòng | S2, S9 |
| (c) Đồng bộ khi có mạng lại | Bắt tay đồng bộ, hợp nhất 3 chiều tham số (bảo thủ cho tham số an toàn), lệnh hết hạn bị hủy, phát lại bộ đệm, quay lui kịch bản lỗi | S3, S3b, S9 |
| (d) Cảnh báo và dừng an toàn | Độ đục/clo/pH vượt QCVN → dừng bơm, đóng van đầu ra, chờ đặt lại; áp cao → giới hạn tần số, áp rất cao → cắt bơm; chống chạy khô | S4, S5, S6, S7, S8, S9 |

## Kết quả chính (từ `python -m trambom compare`)

Bảng đầy đủ cho từng kịch bản: [docs/ket-qua/README.md](docs/ket-qua/README.md). Tóm tắt và phân tích:
[docs/06-so-sanh-dien-nang-chat-luong.md](docs/06-so-sanh-dien-nang-chat-luong.md).

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [01 – Kiến trúc hệ thống](docs/01-kien-truc-he-thong.md) | Tầng cảm biến, edge gateway, truyền thông, máy chủ điều hành, tích hợp mạng lưới; chu kỳ quét; máy trạng thái 4 chế độ; thứ tự ưu tiên; các lớp bảo vệ |
| [02 – Thành phần và tham số](docs/02-thanh-phan-va-tham-so.md) | Tham số vật lý và dải làm việc từng thiết bị, bảng ngưỡng, phương trình mô hình (sinh tự động từ cấu hình) |
| [03 – Giao thức truyền thông](docs/03-giao-thuc-truyen-thong.md) | Chủ đề MQTT, thông điệp mẫu, phát hiện mất mạng, bộ đệm lưu-và-chuyển, bắt tay đồng bộ, quy tắc xử lý xung đột, REST API |
| [04 – Độ tin cậy khi mất kết nối](docs/04-do-tin-cay-mat-ket-noi.md) | Rủi ro, giới hạn của kịch bản đã lưu, chiến lược dự phòng, kế hoạch kiểm thử |
| [05 – Hướng dẫn học tập](docs/05-huong-dan-hoc-tap.md) | Mục tiêu Bloom/DOK, trình tự bài thực hành, phân hóa cơ bản/nâng cao, thang đánh giá |
| [06 – So sánh điện năng và chất lượng dịch vụ](docs/06-so-sanh-dien-nang-chat-luong.md) | Bảng tổng hợp lịch cố định so với điều khiển thông minh và phân tích |

## Cấu trúc thư mục

```
config/      station.json (tham số, ngưỡng, kịch bản điều khiển), scenarios.json, components.json – dùng chung Python & web
trambom/     lõi mô phỏng Python: physics, sensors, gateway, control, safety, comms, server, baseline, kpi, engine, network
web/         bản 3D: index.html, css/, js/sim (lõi JS), js/ui (cảnh 3D, biểu đồ, bảng), vendor/three (Three.js r160, MIT)
student/     mẫu bài tập (theo ngưỡng, dự báo, điều phối mạng lưới) và loi_giai/ (lời giải tham khảo cho giảng viên)
tests/       pytest
tools/       sinh tài liệu, chạy lõi JS bằng Node, định dạng JSON
docs/        tài liệu và kết quả so sánh
```

## Giả định và giới hạn của mô hình

- Mạng lưới được rút gọn thành một nút điểm bất lợi với tổn thất $rQ^2$, nhu cầu phụ thuộc áp (Wagner) và rò rỉ FAVAD; bồn mái
  của hộ dân được gộp thành một kho chứa 300 m³. Không mô phỏng búa nước, chất lượng nước trong mạng lưới, giá điện theo giờ.
- Các ngưỡng áp lực dịch vụ là giả định học tập; giới hạn chất lượng nước lấy theo QCVN 01-1:2018/BYT. Khi áp dụng thực tế cần
  đối chiếu văn bản hiện hành.
- Phương án lịch cố định là một cách vận hành thủ công điển hình (tắt bơm 22:00–05:00, van đẩy mở một phần, đổi bơm theo
  ngày). Có thể sửa `baseline` trong `config/station.json` để so sánh công bằng hơn với cách vận hành của đơn vị bạn.

## Giấy phép

Mã nguồn dùng cho mục đích giáo dục. Three.js thuộc bản quyền các tác giả three.js, giấy phép MIT (`web/vendor/three/LICENSE`).
