# Thành phần trạm bơm, tham số vật lý và dải làm việc

> Tệp này được sinh tự động bởi `python tools/gen_docs.py` từ `config/components.json` và `config/station.json`.
> Sửa tham số ở file cấu hình rồi chạy lại lệnh để cập nhật tài liệu.

Trạm ST-01 phục vụ khu dân cư A (≈2.400 người, 160 L/người/ngày, nhu cầu trung bình 16 m³/h, giờ cao điểm
≈28–34 m³/h). Trạm không có người trực; công nhân đi kiểm tra theo lượt (07:30 và 16:30 trong phương án lịch cố định).


Mỗi thiết bị được gắn nhãn phạm vi: **hiện trạng** (nhà máy đã có), **giải pháp** (đưa vào để tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ bằng mini PC) hoặc **khuyến nghị** (nên có để vận hành trơn tru). Bảng tổng hợp, sơ đồ đấu nối và phân tích "nếu không lắp" ở [07-hien-trang-va-giai-phap.md](07-hien-trang-va-giai-phap.md).

## Danh mục thành phần

### Hiện trạng nhà máy (đã có)

#### T-01 · Bể chứa nước sạch (bể ngầm/bán ngầm)

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Bể bê tông cốt thép nhận nước từ ống cấp thành phố qua van phao, là nguồn hút cho cụm bơm và là bộ đệm chất lượng nước (trộn đều).

| Mục | Nội dung |
|---|---|
| Vai trò | Nguồn hút và bộ đệm thể tích/chất lượng của trạm. |
| Giao tiếp với mini PC | Không nối trực tiếp; được đo bằng LT-101 (giải pháp) và phao LSLL-101 (hiện trạng). |
| Nếu không có | — |
| Khi hỏng / dự phòng | Mất tín hiệu LT-101 → phao LSLL-101 vẫn cắt bơm. Cải tạo nhỏ: giá lắp LT-101 trên nắp bể, ống luồn cáp kín nước. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Kích thước trong | 8 × 6 × 4,2 | m |
| Diện tích đáy | 48 | m² |
| Mức tràn | 4,0 | m |
| Dung tích hữu ích (0,6–3,8 m) | ≈154 | m³ |
| Thời gian lưu trung bình | ≈8–9 | h |
| Phân rã clo khối (k_b) | 0,4 | 1/ngày |
| Lắng cặn (k_s) | 0,2 | 1/h |

**Dải làm việc:** Mức làm việc 1,2–3,8 m; dừng bơm < 0,6 m; khóa an toàn < 0,5 m; phao cứng LSLL 0,35 m

#### FV-01 · Van phao cấp nước vào bể

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Van phao điều biến cơ khí: mở dần khi mức nước giảm dưới 3,8 m, mở hoàn toàn ở 3,4 m. Lưu lượng phụ thuộc áp lực ống cấp thành phố (giảm vào giờ cao điểm).

| Mục | Nội dung |
|---|---|
| Vai trò | Tự cấp nước vào bể theo mức, không cần điện. |
| Giao tiếp với mini PC | Không nối mini PC. Trạng thái suy ra từ lưu lượng vào (FT-100 hoặc cân bằng khối lượng). |
| Khi hỏng / dự phòng | Lớp 0 (cơ khí): vẫn hoạt động khi mất điện và khi mini PC hỏng. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Lưu lượng cấp tối đa | 26 | m³/h |
| Mức đóng hoàn toàn | 3,8 | m |
| Dải điều biến | 0,4 | m |
| Hệ số cấp giờ cao điểm | 0,75–0,8 | – |

**Dải làm việc:** 0–26 m³/h

#### VX-01 · Van xả đáy bể

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Van xả cặn/súc rửa bể. Hiện trạng vận hành tay; lệnh flush_tank của trung tâm được thực hiện bằng tay hoặc bằng bộ truyền động điện VX-01A nếu lắp thêm.

| Mục | Nội dung |
|---|---|
| Vai trò | Xả cặn/súc rửa bể sau sự cố chất lượng. |
| Giao tiếp với mini PC | Hiện trạng là van tay: kỹ thuật viên mở theo lệnh xả của trung tâm. Nếu lắp bộ truyền động VX-01A (khuyến nghị) thì điều khiển bằng DO của IO-01. |
| Khi hỏng / dự phòng | Lệnh flush_tank chỉ được chấp nhận khi trạm đang dừng an toàn. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Lưu lượng xả | 120 | m³/h |
| Cỡ van | DN150 | – |

**Dải làm việc:** Đóng/Mở

#### P-01 · Bơm ly tâm trục ngang số 1 (5,5 kW)

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Bơm ly tâm một tầng cánh, động cơ 5,5 kW, chạy qua biến tần VFD-01. Đường đặc tính H = H0·(f/50)² − K·Q²; công suất trục theo luật tương tự.

| Mục | Nội dung |
|---|---|
| Vai trò | Bơm chính/dự phòng luân phiên; công suất thủy lực của trạm. |
| Giao tiếp với mini PC | Gián tiếp qua biến tần VFD-01 (hiện trạng, cấu hình lại). |
| Khi hỏng / dự phòng | Hỏng → GW-01 chuyển bơm dự phòng P-02 ngay; báo PUMP_FAULT. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cột áp đóng van H0 @50 Hz | 44 | m |
| Hệ số đặc tính K | 0,015 | m/(m³/h)² |
| Điểm hiệu suất tốt nhất (BEP) | 24 m³/h · 35,4 m | – |
| Hiệu suất bơm cực đại | 72 | % |
| Hiệu suất động cơ + biến tần | 88 | % |
| Công suất động cơ | 5,5 | kW |
| Dải tần số | 25–50 | Hz |
| Tốc độ tăng/giảm tần | 2,5 | Hz/s |

**Dải làm việc:** Q 0–38 m³/h; H 0–44 m; tần số 25–50 Hz; tối đa 6 lần khởi động/giờ

#### P-02 · Bơm ly tâm trục ngang số 2 (5,5 kW)

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Giống P-01. Hai bơm chạy luân phiên theo giờ chạy (bơm chính/bơm dự phòng) và ghép song song khi nhu cầu cao.

| Mục | Nội dung |
|---|---|
| Vai trò | Bơm thứ hai: dự phòng nóng và ghép song song khi nhu cầu cao. |
| Giao tiếp với mini PC | Gián tiếp qua biến tần VFD-02. |
| Khi hỏng / dự phòng | Như P-01. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cột áp đóng van H0 @50 Hz | 44 | m |
| Hệ số đặc tính K | 0,015 | m/(m³/h)² |
| Công suất động cơ | 5,5 | kW |
| Dải tần số | 25–50 | Hz |

**Dải làm việc:** Như P-01

#### VFD-01 · Biến tần bơm P-01 (hiện có)

*Hiện trạng nhà máy · cấu hình lại · bắt buộc · nhóm điện – điều khiển*

Hiện trạng chỉ dùng như khởi động mềm, chạy 50 Hz bằng bàn phím. Giải pháp giữ nguyên phần cứng, cấu hình lại: nhận tần số đặt qua Modbus RTU, PID nội theo PT-101 khi rơ-le watchdog nhả.

| Mục | Nội dung |
|---|---|
| Vai trò | Điều khiển tốc độ bơm P-01 theo lệnh mini PC; PID nội làm dự phòng khi mini PC hỏng. |
| Giao tiếp với mini PC | Modbus RTU (RS-485 COM1 của MPC-01, địa chỉ 1, 19 200 bps): ghi tần số đặt, đọc f, I, kW, kWh, mã lỗi. Lệnh chạy: DO IO-01 → SA-01 (TỰ ĐỘNG) → WDR-01 → đầu cực FWD. AI2 nhận PT-101 qua ISO-101 cho PID dự phòng. |
| Thông số điển hình | Khóa f_max 50 Hz; f_min 25 Hz; tăng/giảm 20 s; bảo vệ non tải (chạy khô); tự khởi động lại sau mất điện có trễ lệch giữa 2 biến tần; timeout Modbus 3–5 s → giữ tần số cuối; PID nội 3,0 bar (Kp 6 Hz/bar, Ti 15 s); mất phản hồi PID → 40 Hz. |
| Nếu không có | Không có RS-485: dùng phương án đầu cực (AO 4–20 mA tần số, DI/AI trạng thái). Không có PID nội: thay biến tần chuyên dụng cho bơm. |
| Khi hỏng / dự phòng | Lớp 2: bảo vệ nội của biến tần. Lớp 7: PID nội giữ áp khi mini PC treo. |
| Thử trong mô phỏng | Kịch bản S11; tắt tùy chọn VFD_PID_fallback để thấy I/O giữ lệnh cuối. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Công suất | 5,5 | kW |
| Dải tần số làm việc | 25–50 | Hz |
| Tăng/giảm tần | 2,5 | Hz/s |
| Điểm đặt PID dự phòng | 3,0 | bar |
| Hiệu suất động cơ + biến tần | 88 | % |

**Dải làm việc:** 25–50 Hz

#### VFD-02 · Biến tần bơm P-02 (hiện có)

*Hiện trạng nhà máy · cấu hình lại · bắt buộc · nhóm điện – điều khiển*

Như VFD-01, địa chỉ Modbus 2. Khởi động lại sau mất điện trễ hơn VFD-01 (≈40 s so với ≈10 s) để không đóng điện cùng lúc.

| Mục | Nội dung |
|---|---|
| Vai trò | Điều khiển tốc độ bơm P-02; nhận quyền PID nội nếu VFD-01 lỗi. |
| Giao tiếp với mini PC | Modbus RTU COM1 địa chỉ 2; lệnh chạy qua SA-02 → WDR-01; AI2 nhận PT-101 qua ISO-101. |
| Thông số điển hình | Như VFD-01. |
| Khi hỏng / dự phòng | Như VFD-01. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Công suất | 5,5 | kW |
| Dải tần số làm việc | 25–50 | Hz |

**Dải làm việc:** 25–50 Hz

#### CV-01/02 · Van một chiều sau bơm

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Ngăn dòng chảy ngược qua bơm đang dừng; trong mô hình thể hiện bằng ràng buộc Q ≥ 0.

| Mục | Nội dung |
|---|---|
| Vai trò | Ngăn dòng ngược qua bơm đang dừng. |
| Giao tiếp với mini PC | Không nối mini PC. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ van | DN80 | – |
| Áp lực danh định | PN16 | – |

**Dải làm việc:** Q ≥ 0

#### HV-01..04 · Van tay chặn hút và van đẩy từng bơm

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Hiện trạng van đẩy đang được mở một phần để tiết lưu (cách vận hành lịch cố định). Sau cải tạo mở hết và niêm phong: biến tần thay vai trò tiết lưu, tránh mất năng lượng qua van.

| Mục | Nội dung |
|---|---|
| Vai trò | Van tay chặn hút/đẩy từng bơm để bảo trì. |
| Giao tiếp với mini PC | Không nối mini PC. |
| Khi hỏng / dự phòng | Ghi lại vị trí cũ làm cơ sở so sánh với phương án lịch cố định. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ van | DN80–DN100 | – |

**Dải làm việc:** Mở hết khi vận hành

#### HT-01 · Bình tích áp màng (thủy khí)

*Hiện trạng nhà máy · giữ nguyên · nên có · nhóm thủy lực*

Bình màng làm mềm dao động áp lực, cấp nước khi bơm ngủ đông. Khí nén đẳng nhiệt: V_khí = V·(p0+1)/(p+1).

| Mục | Nội dung |
|---|---|
| Vai trò | Làm mềm dao động áp, cho phép bơm ngủ đông khi lưu lượng rất nhỏ. |
| Giao tiếp với mini PC | Không nối mini PC (áp lực đo bằng PT-101/102). |
| Nếu không có | Nếu trạm chưa có: nên bổ sung; không có thì tắt chức năng ngủ đông (sleep.enabled = false). |
| Khi hỏng / dự phòng | Kiểm tra áp nạp trước 1,7–1,8 bar mỗi 6 tháng. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Thể tích bình | 300 | L |
| Áp nạp trước | 1,8 | bar |
| Độ đàn hồi đường ống | 0,005 | m³/bar |

**Dải làm việc:** 1,8–6,0 bar

#### PSV-01 · Van an toàn cơ khí (xả về bể)

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

Lớp bảo vệ cuối cùng, độc lập với điện tử: mở khi áp lực ống đẩy vượt 6,0 bar.

| Mục | Nội dung |
|---|---|
| Vai trò | Lớp bảo vệ cơ khí cuối cùng khi áp quá cao. |
| Giao tiếp với mini PC | Không nối mini PC; trạng thái xả thấy được qua lưu lượng. |
| Nếu không có | Nếu trạm chưa có: bắt buộc bổ sung trước khi giao quyền điều khiển tự động. |
| Khi hỏng / dự phòng | Lớp 0 (cơ khí): độc lập hoàn toàn với điện tử. Thử hằng năm. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Áp lực mở | 6,0 | bar |
| Hệ số xả | 40 | m³/h/bar |

**Dải làm việc:** Đóng < 6,0 bar

#### PI-101/102 · Đồng hồ áp lực cơ trên ống đẩy từng bơm

*Hiện trạng nhà máy · giữ nguyên · nên có · nhóm cảm biến*

Đồng hồ kim Bourdon, mặt 100 mm, chỉ thị tại chỗ (không nối gateway). Dùng cho kiểm tra hiện trường và đối chiếu.

| Mục | Nội dung |
|---|---|
| Vai trò | Chỉ thị tại chỗ để đối chiếu với PT-101/102. |
| Giao tiếp với mini PC | Không nối mini PC. |
| Khi hỏng / dự phòng | Lắp thêm van 3 ngả/cổng thử để kiểm tra cảm biến. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Cấp chính xác | 1,6 | – |

**Dải làm việc:** 0–10 bar

#### FT-100 · Đồng hồ nước vào bể (Woltmann hiện có + đầu phát xung)

*Hiện trạng nhà máy · nâng cấp · nên có · nhóm cảm biến*

Đồng hồ Woltmann thương mại hiện có của công ty cấp nước. Giải pháp chỉ gắn thêm đầu phát xung (10 L/xung) – cần phối hợp đơn vị cấp nước và niêm chì lại.

| Mục | Nội dung |
|---|---|
| Vai trò | Đo nước mua vào: cân bằng nước, dự báo thời gian cạn bể, phát hiện mất nguồn. |
| Giao tiếp với mini PC | Xung → DI đếm xung của IO-01 (≥ 100 Hz), tính lưu lượng trượt 60 s. |
| Nếu không có | Gateway ước lượng lưu lượng vào bằng cân bằng khối lượng: Q_vào ≈ Q_ra (FT-101) + A·dH/dt (LT-101), cửa sổ 15 phút. |
| Khi hỏng / dự phòng | Như khi không có (cân bằng khối lượng). |
| Thử trong mô phỏng | S6 – tắt FT-100_pulse: phát hiện mất nguồn gần như không đổi (dư thừa phân tích). |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ ống | DN100 | – |
| Dải đo | 0–50 | m³/h |

**Dải làm việc:** 0–50 m³/h

#### LSLL-101 · Phao chống cạn cơ khí (mạch cứng)

*Hiện trạng nhà máy · nâng cấp · bắt buộc · nhóm cảm biến*

Phao hiện có, cắt bơm trực tiếp qua mạch khởi động khi mức < 0,35 m, đặt lại ở 0,6 m. Cải tạo: đấu lại kiểu thường đóng (đứt dây = dừng), thêm rơ-le KA-LS lấy tiếp điểm giám sát về mini PC, đặt phao trong ống lặng.

| Mục | Nội dung |
|---|---|
| Vai trò | Chống chạy khô bằng mạch cứng, độc lập phần mềm. |
| Giao tiếp với mini PC | Mạch cứng IL-01 trong CP-01 (tác động ở mọi chế độ Tay/Tự động/PID nội). Tiếp điểm phụ → DI IO-01 (chỉ để giám sát). |
| Khi hỏng / dự phòng | Lớp 1 (liên động cứng): vẫn bảo vệ khi mini PC hỏng. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Mức cắt | 0,35 | m |
| Mức đặt lại | 0,6 | m |

**Dải làm việc:** Cắt < 0,35 m

#### CP-01 · Tủ động lực MCC hiện có (CP-01)

*Hiện trạng nhà máy · nâng cấp · bắt buộc · nhóm điện – điều khiển*

Hiện trạng: MCCB tổng và từng bơm, 2 biến tần, contactor, rơ-le nhiệt, đồng hồ V/A, nút bấm. Cải tạo: lắp công tắc Tay/0/Tự động SA-01/02 và dừng khẩn trên cửa, rơ-le watchdog WDR-01, rơ-le liên động, đồng hồ điện EM-101, chống sét SPD-01 ở đầu vào; thêm hàng kẹp sang tủ mới CP-02.

| Mục | Nội dung |
|---|---|
| Vai trò | Tủ động lực hiện có: cấp điện và bảo vệ cho 2 bơm/biến tần. |
| Giao tiếp với mini PC | Hàng kẹp X-IF sang CP-02: lệnh chạy, trạng thái, RS-485, 4–20 mA, nguồn 230 VAC cho CP-02. |
| Khi hỏng / dự phòng | Mạch liên động cứng (LSLL-101, dừng khẩn, van MV-02 đóng → cấm chạy) nằm trong CP-01 và đấu kiểu thường đóng. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Nguồn | 3 pha 400 V | – |
| Cấp bảo vệ | IP54 | – |

**Dải làm việc:** –

#### MANG-LUOI · Mạng lưới phân phối khu dân cư A (DMA-A)

*Hiện trạng nhà máy · giữ nguyên · bắt buộc · nhóm thủy lực*

≈2.400 người, 160 L/người/ngày, phần lớn hộ có bồn mái. Nhu cầu phụ thuộc áp lực (mô hình Wagner, như EPANET 2.2), rò rỉ theo FAVAD (Q = C·P^1,18).

| Mục | Nội dung |
|---|---|
| Vai trò | Đối tượng phục vụ; áp tại điểm bất lợi là chỉ tiêu dịch vụ. |
| Giao tiếp với mini PC | Không nối trực tiếp; logger PL-301 (khuyến nghị) gửi áp điểm bất lợi về trung tâm. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Nhu cầu trung bình | 16 | m³/h |
| Chênh cao điểm bất lợi | +4 | m |
| Tổn thất đến điểm bất lợi | 0,00111·Q² | bar |
| Áp đủ cấp đủ nhu cầu | 1,0 | bar |
| Hệ số rò rỉ C | 0,7 | m³/h/bar^1,18 |
| Dung tích bồn mái quy đổi | 300 | m³ |

**Dải làm việc:** Áp tại điểm bất lợi ≥ 1,4 bar; áp đầu ra ≤ 4,0 bar

### Giải pháp đưa vào (tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ)

#### MPC-01 · Mini PC công nghiệp không quạt (phần cứng edge gateway)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Máy tính công nghiệp gắn DIN trong tủ CP-02. Chạy Linux LTS phân vùng gốc chỉ đọc, các dịch vụ: io (Modbus TCP tới IO-01), drive (Modbus RTU tới biến tần), meter (EM-101, AIT, FT-101), control (lõi GW-01 chu kỳ 1 s – chính là mã đã kiểm chứng trong mô phỏng), comms (MQTT/TLS + bộ đệm SQLite trên SSD), hmi (web HMI).

| Mục | Nội dung |
|---|---|
| Vai trò | Phần cứng edge gateway: tiếp nhận, xử lý, điều khiển tín hiệu tại chỗ; chạy GW-01 và web HMI. |
| Giao tiếp với mini PC | LAN1 ↔ RT-01 (WAN). LAN2 ↔ SW-01 (mạng OT: IO-01, HMI-01). COM1 RS-485 cách ly ↔ VFD-01/02. COM2 RS-485 cách ly ↔ EM-101, AIT, FT-101. Nguồn 24 VDC từ UPS-01. |
| Thông số điển hình | x86 hoặc ARM công nghiệp 4 nhân, RAM 4–8 GB, SSD công nghiệp pSLC 64–128 GB, 2 LAN, 2 RS-485 cách ly, watchdog phần cứng, TPM 2.0, RTC có pin, 9–36 VDC, −20…60 °C, 10–15 W. |
| Nếu không có | Không có bộ điều khiển tại chỗ: trạm quay về vận hành lịch cố định (phương án so sánh) – mất toàn bộ chế độ (a)–(d). |
| Khi hỏng / dự phòng | Watchdog 3 tầng (dịch vụ → phần cứng → WDR-01). Mini PC treo > 5 s: biến tần chạy PID nội; khởi động lại thì nạp kịch bản/bộ đệm từ SSD, đồng bộ lại (chế độ c). |
| Thử trong mô phỏng | S11: mini PC treo 17:00–23:00. Tab Sự cố → "Mini PC treo". |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Chu kỳ điều khiển | 1 | s |
| Bộ đệm lưu-và-chuyển | 4.320 bản ghi + nén | – |
| Công suất | 10–15 | W |

**Dải làm việc:** −20…60 °C

#### GW-01 · Phần mềm edge gateway GW-01 (chạy trên MPC-01)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm phần mềm*

Thu thập dữ liệu chu kỳ 1 s, kiểm tra hợp lệ tín hiệu, lớp an toàn ưu tiên cao nhất, kịch bản điều khiển có phiên bản, bộ đệm lưu-và-chuyển, đồng bộ với máy chủ qua MQTT.

| Mục | Nội dung |
|---|---|
| Vai trò | Phần mềm edge gateway chạy trên MPC-01 (lõi đã mô phỏng trong dự án này). |
| Giao tiếp với mini PC | Đọc/ghi I/O qua dịch vụ io/drive/meter; MQTT/TLS 8883 tới SRV-01; web HMI cho HMI-01. |
| Khi hỏng / dự phòng | Lớp an toàn phần mềm luôn chạy sau kịch bản và có thể ghi đè. Kịch bản mới có giám sát 10 phút và tự quay lui. |
| Thử trong mô phỏng | Mọi kịch bản S1–S12. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Chu kỳ quét | 1 | s |
| Gói dữ liệu đo xa | 10 | s |
| Nhịp tim (heartbeat) | 10 | s |
| Phát hiện mất mạng | 60 | s |
| Bộ đệm | 4.320 bản ghi (12 h) + nén | – |
| Tốc độ phát lại | 20 | bản ghi/s |

**Dải làm việc:** –

#### IO-01 · Mô-đun I/O từ xa Modbus TCP

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Tập trung các tín hiệu hiện trường về mini PC. Có giá trị an toàn khi mất truyền thông cho từng DO.

| Mục | Nội dung |
|---|---|
| Vai trò | Mô-đun vào/ra từ xa: số hóa tín hiệu 4–20 mA, tiếp điểm, xung; xuất lệnh. |
| Giao tiếp với mini PC | Modbus TCP qua SW-01 (chu kỳ 100–200 ms). Cấp nguồn vòng cho cảm biến 2 dây. |
| Thông số điển hình | ≥ 8 AI 4–20 mA 16 bit (phát hiện đứt dây), ≥ 16 DI 24 VDC (2 kênh đếm xung), ≥ 8 DO (≥ 1 kênh bán dẫn cho xung watchdog), 2 AO; cách ly 1,5 kV; dư ≥ 20 % kênh. |
| Nếu không có | Dùng card I/O gắn trực tiếp mini PC (kém linh hoạt, khó thay nóng). |
| Khi hỏng / dự phòng | Mất truyền thông 2–5 s: DO lệnh chạy về 0 – không gây mất nước vì WDR-01 đã chuyển biến tần sang PID nội. |

#### CP-02 · Tủ điều khiển & truyền thông mới (CP-02)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Tủ treo tường cạnh CP-01, chứa MPC-01, IO-01, SW-01, RT-01, UPS-01, bộ cách ly tín hiệu ISO-101 và chống sét tín hiệu; màn HMI-01 trên cửa (khuyến nghị).

| Mục | Nội dung |
|---|---|
| Vai trò | Tủ mới của giải pháp: tách thiết bị điện tử, truyền thông khỏi tủ động lực. |
| Giao tiếp với mini PC | Cáp tín hiệu, RS-485 và nguồn 230 VAC từ CP-01 qua hàng kẹp X-IF. |
| Thông số điển hình | ≈ 600 × 800 × 250 mm, IP54–55, quạt lọc + thermostat 35 °C, sưởi + hygrostat 70 %RH, ổ cắm bảo trì, khóa, công tắc cửa. |
| Nếu không có | Có thể làm ngăn riêng trong CP-01 nếu đủ chỗ và đủ mát (khó bảo trì, nhiễu từ biến tần). |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Kích thước | ≈600 × 800 × 250 | mm |
| Cấp bảo vệ | IP54–55 | – |

**Dải làm việc:** ≤ 50 °C trong tủ

#### SW-01 · Switch Ethernet công nghiệp (mạng OT)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm truyền thông*

Switch công nghiệp cho mạng OT trong tủ CP-02.

| Mục | Nội dung |
|---|---|
| Vai trò | Switch công nghiệp cho mạng OT trong tủ CP-02. |
| Giao tiếp với mini PC | Nối MPC-01 (LAN2), IO-01, HMI-01, cổng bảo trì. |
| Thông số điển hình | 5–8 cổng, 24 VDC, DIN, −10…60 °C. |
| Nếu không có | Mini PC có đủ cổng thì nối trực tiếp. |

#### RT-01 · Router 4G/LTE công nghiệp 2 SIM có SMS

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm truyền thông*

MQTT/TLS tới máy chủ điều hành qua APN riêng/VPN, chỉ kết nối ra ngoài. Khi mất IP, báo động nghiêm trọng gửi SMS tới tổ trực.

| Mục | Nội dung |
|---|---|
| Vai trò | Kết nối 4G tới trung tâm; gửi SMS dự phòng khi mất IP. |
| Giao tiếp với mini PC | Ethernet ↔ MPC-01 LAN1; API SMS của router. |
| Thông số điển hình | LTE Cat 4, 2 SIM tự chuyển, ăng-ten ngoài có chống sét, 24 VDC. |
| Nếu không có | Không có liên lạc với trung tâm: trạm chỉ tự vận hành (chế độ b), dữ liệu nằm trong bộ đệm. |
| Khi hỏng / dự phòng | Chuyển SIM thứ hai; mất hẳn → chế độ (b), SMS cho báo động khẩn. |
| Thử trong mô phỏng | S2, S3, S9; tắt tùy chọn SMS ở tab Thiết bị. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Độ trễ điển hình | 0,4 | s |
| Giao thức | MQTT 3.1.1/5 trên TLS 1.2 | – |

**Dải làm việc:** –

#### UPS-01 · Nguồn 24 VDC + DC-UPS + ắc quy

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Giữ mini PC, I/O, router, cảm biến ≥ 4 h khi mất điện lưới.

| Mục | Nội dung |
|---|---|
| Vai trò | Giữ mini PC, I/O, router, cảm biến ≥ 4 h khi mất điện lưới. |
| Giao tiếp với mini PC | Tiếp điểm mất điện lưới / ắc quy yếu → DI IO-01. |
| Thông số điển hình | Nguồn 230 VAC/24 VDC 10 A; DC-UPS; ắc quy AGM 2 × 12 V ≈ 20–26 Ah hoặc LiFePO4; tải 40–80 W trong 4 h. |
| Nếu không có | Mất điện: mất đo, mất cảnh báo, khởi động lại mini PC mỗi lần chập chờn – dễ hỏng SSD. |
| Khi hỏng / dự phòng | Có điện lại: biến tần khởi động lệch nhau, mini PC lấy lại quyền theo trình tự không giật. |

#### WDR-01 · Rơ-le watchdog (giám sát xung sống) lắp trong CP-01

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Mini PC đảo một DO sau mỗi chu kỳ điều khiển thành công. Mất xung 5 s: rơ-le nhả, biến tần bơm chính chuyển nguồn tần số sang PID nội theo PT-101, bơm còn lại dừng. Đi kèm rơ-le chốt dừng an toàn K-SS: nếu trạm đang dừng an toàn do chất lượng nước thì mạch dự phòng KHÔNG được chạy bơm. Chỉ trả quyền khi mini PC khỏe liên tục ≥ 60 s.

| Mục | Nội dung |
|---|---|
| Vai trò | Cắt quyền điều khiển của mini PC khi nó ngừng phát xung sống, chuyển biến tần sang PID nội. |
| Giao tiếp với mini PC | Đầu vào: DO bán dẫn của IO-01 (xung 1 Hz). Đầu ra: DI chọn nguồn tần số của VFD-01/02, chuyển lệnh chạy sang mạch chọn bơm dự phòng. |
| Thông số điển hình | Rơ-le giám sát xung 24 VDC, chỉnh 1–30 s (đặt 5 s), 2 tiếp điểm C/O, nút thử. |
| Nếu không có | Mini PC treo: mô-đun I/O giữ nguyên lệnh cuối – bơm chạy "mù" theo tần số cũ (S11: áp ngoài dải 213 phút so với 1 phút). |
| Khi hỏng / dự phòng | Bản thân WDR-01 là lớp dự phòng; thử hằng quý bằng cách dừng dịch vụ điều khiển. |
| Thử trong mô phỏng | S11 có/không VFD_PID_fallback. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Thời gian giám sát | 5 | s |
| Điểm đặt PID dự phòng | 3,0 | bar |

**Dải làm việc:** –

#### ISO-101 · Bộ cách ly và chia tín hiệu 4–20 mA

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Chia tín hiệu PT-101 cho cả IO-01 và PID nội của 2 biến tần; cách ly chống nhiễu.

| Mục | Nội dung |
|---|---|
| Vai trò | Chia tín hiệu PT-101 cho cả IO-01 và PID nội của 2 biến tần; cách ly chống nhiễu. |
| Giao tiếp với mini PC | PT-101 → ISO-101 (1 vào 3 ra) → IO-01 AI1, VFD-01 AI2, VFD-02 AI2. Các kênh khác dùng loại 1 vào 1 ra. |
| Thông số điển hình | Cách ly 3 cổng 1,5–2,5 kV, sai số ≤ 0,1 % FS, đáp ứng < 50 ms, truyền được mức lỗi NAMUR (< 3,6 mA). |
| Nếu không có | Biến tần không có tín hiệu áp để chạy PID dự phòng. |

#### SA-01/02 · Công tắc chọn chế độ, đèn báo, dừng khẩn

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

TỰ ĐỘNG: cho phép lệnh từ mini PC hoặc PID nội. TAY: chạy tại chỗ theo bàn phím biến tần, vẫn qua liên động cứng. 0: khóa để bảo trì. Khác với chế độ TAY trên HMI (lệnh phần mềm qua mini PC).

| Mục | Nội dung |
|---|---|
| Vai trò | Công tắc Tay/0/Tự động từng bơm, đèn báo và nút dừng khẩn trên cửa CP-01. |
| Giao tiếp với mini PC | 2 DI/bơm (Tay, Tự động) → IO-01; đèn Chạy/Lỗi/Tự động/Dự phòng PID. |
| Khi hỏng / dự phòng | Vận hành tay hoàn toàn bằng phần cứng khi mini PC và IO-01 cùng hỏng. |

#### PT-101 · Cảm biến áp lực đầu ra (điều khiển)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm cảm biến*

Áp lực kế điện tử màng gốm, 4–20 mA, dùng cho vòng điều khiển PI.

| Mục | Nội dung |
|---|---|
| Vai trò | Áp đầu ra cho vòng điều khiển PI và PID dự phòng của biến tần. |
| Giao tiếp với mini PC | AI 4–20 mA 2 dây → ISO-101 → IO-01 AI1 (+ VFD-01/02 AI2). |
| Nếu không có | Không thể điều khiển áp theo lưu lượng; gateway chạy 40 Hz an toàn (NO_PRESSURE). |
| Khi hỏng / dự phòng | Biểu quyết với PT-102 và mô hình bơm; mất cả hai → 40 Hz. |
| Thử trong mô phỏng | S5 (PT-101 kẹt 2,1 bar). |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Sai số | ±0,25 % FS | – |
| Thời gian đáp ứng | < 200 | ms |
| Tín hiệu lỗi (NAMUR NE43) | < 3,6 mA | – |

**Dải làm việc:** 0–10 bar

#### PT-102 · Cảm biến áp lực đầu ra (bảo vệ, dự phòng)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm cảm biến*

Cảm biến độc lập thứ hai cho lớp an toàn (cắt áp rất cao) và đối chiếu chéo với PT-101.

| Mục | Nội dung |
|---|---|
| Vai trò | Áp đầu ra cho lớp an toàn (cắt áp rất cao) và đối chiếu chéo với PT-101. |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI2; điểm trích áp riêng. |
| Nếu không có | PT-101 kẹt/trôi không bị phát hiện ở mức cơ bản: S5 – áp > 4,0 bar suốt 119 phút, đỉnh 4,56 bar. |
| Khi hỏng / dự phòng | Mức nâng cao còn phát hiện kẹt bằng kiểm tra giá trị đứng yên + mô hình bơm. |
| Thử trong mô phỏng | S5 có/không PT-102 (tab Thiết bị). |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Sai số | ±0,25 % FS | – |
| Ngưỡng lệch PT-101/PT-102 | 0,3 bar / 10 s | – |

**Dải làm việc:** 0–10 bar

#### FT-101 · Đồng hồ lưu lượng điện từ đầu ra

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm cảm biến*

Đo lưu lượng cấp vào mạng lưới, đầu vào cho đường đặt áp theo lưu lượng và phát hiện rò rỉ ban đêm.

| Mục | Nội dung |
|---|---|
| Vai trò | Lưu lượng ra mạng: đường đặt áp P_set(Q), dự báo, phát hiện rò rỉ đêm. |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI3; tổng m³ qua Modbus RTU COM2. |
| Nếu không có | Phải đặt áp cố định cao (≈3,3 bar): tốn điện, tăng rò rỉ; mất phát hiện bất thường lưu lượng. |
| Khi hỏng / dự phòng | Mất tín hiệu: ước lượng Q từ mô hình bơm, đặt P_set ở mức cao. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ ống | DN100 | – |
| Dải đo | 0–80 | m³/h |
| Sai số | ±0,5 % | – |
| Ngưỡng cắt lưu lượng nhỏ | 0,3 | m³/h |

**Dải làm việc:** 0–80 m³/h

#### LT-101 · Cảm biến mức siêu âm

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm cảm biến*

Cảm biến mức siêu âm/radar đo từ nắp bể.

| Mục | Nội dung |
|---|---|
| Vai trò | Mức bể: dừng chống chạy khô theo kịch bản, tiết kiệm nước, dự báo thời gian cạn bể. |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI4 qua chống sét tín hiệu. |
| Nếu không có | Chỉ còn phao LSLL-101 (cắt muộn ở 0,35 m, không có cảnh báo sớm). |
| Khi hỏng / dự phòng | Mất tín hiệu: giữ giá trị cuối + phao cứng; khuyến nghị thêm LT-102 thủy tĩnh dự phòng. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–5 | m |
| Sai số | ±3 | mm |
| Phao chống cạn LSLL-101 | 0,35 (reset 0,6) | m |

**Dải làm việc:** 0–5 m

#### AIT-201 · Máy đo clo dư tự do (amperometric)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm chất lượng nước*

Lấy mẫu liên tục từ ống đẩy. QCVN 01-1:2018/BYT: clo dư tự do 0,2–1,0 mg/L.

| Mục | Nội dung |
|---|---|
| Vai trò | Clo dư online: dừng an toàn khi < 0,2 mg/L (QCVN 01-1:2018/BYT). |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI5 (hoặc Modbus RTU COM2); chỉ hợp lệ khi công tắc dòng mẫu FS-201 báo có nước. |
| Nếu không có | Clo thấp chỉ phát hiện khi xét nghiệm định kỳ hoặc dân phản ánh. |
| Khi hỏng / dự phòng | Mất tín hiệu → cảnh báo (không dừng giả); đối chiếu DPD cầm tay hằng tuần. |
| Thử trong mô phỏng | S9 có/không AIT-201. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–5 | mg/L |
| Sai số | ±0,03 | mg/L |
| Thời gian đáp ứng T90 | ≈90 | s |
| Cảnh báo / Dừng | <0,3 hoặc >0,8 / <0,2 hoặc >1,0 | mg/L |

**Dải làm việc:** Làm việc 0,3–0,8 mg/L

#### AIT-202 · Máy đo độ đục (nephelometric)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm chất lượng nước*

QCVN 01-1:2018/BYT: độ đục ≤ 2 NTU.

| Mục | Nội dung |
|---|---|
| Vai trò | Độ đục online: dừng an toàn khi > 2 NTU kéo dài 60 s. |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI6. |
| Nếu không có | S4: 28,3 m³ nước > 2 NTU cấp ra mạng (có máy: 0,4 m³). |
| Khi hỏng / dự phòng | Mất tín hiệu → cảnh báo; vệ sinh buồng đo 2–4 tuần. |
| Thử trong mô phỏng | S4 có/không AIT-202. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–100 | NTU |
| Sai số | ±2 % hoặc ±0,02 | NTU |
| Thời gian đáp ứng | ≈30 | s |
| Cảnh báo / Dừng | > 1,0 / > 2,0 (60 s) | NTU |

**Dải làm việc:** Làm việc < 1,0 NTU

#### SP-201 · Panel lấy mẫu + công tắc dòng mẫu FS-201

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm chất lượng nước*

Trích mẫu từ ống đẩy sau bơm, lưu lượng mẫu ổn định, xả về bể/thoát. FS-201 báo mất dòng mẫu để gateway không dùng số đo sai.

| Mục | Nội dung |
|---|---|
| Vai trò | Panel lấy mẫu liên tục cho máy phân tích, kèm công tắc dòng mẫu FS-201. |
| Giao tiếp với mini PC | FS-201 → DI IO-01. |
| Nếu không có | Máy phân tích đo nước đứng yên → giá trị sai, báo động giả. |

#### EM-101 · Đồng hồ điện đa năng 3 pha có Modbus

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Lắp ở đầu vào CP-01 và ghi 2–4 tuần TRƯỚC khi giao quyền điều khiển để có đường cơ sở điện năng của cách vận hành hiện tại.

| Mục | Nội dung |
|---|---|
| Vai trò | Đo điện năng toàn trạm: chỉ tiêu kWh/m³ và đường cơ sở trước cải tạo. |
| Giao tiếp với mini PC | Modbus RTU COM2, địa chỉ 10–11; 3 biến dòng ở đầu tổng. |
| Thông số điển hình | kWh cấp 0,5S hoặc 1. |
| Nếu không có | Chỉ còn bộ đếm kWh của biến tần (thiếu phụ tải phụ, sai số lớn) – khó chứng minh tiết kiệm. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cấp chính xác | 0,5S | – |

**Dải làm việc:** –

#### KIT-01 · Bộ đo chất lượng nước cầm tay

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm chất lượng nước*

Bộ đo cầm tay clo dư (DPD), độ đục, pH để hiệu chuẩn máy online và nội kiểm.

| Mục | Nội dung |
|---|---|
| Vai trò | Bộ đo cầm tay clo dư (DPD), độ đục, pH để hiệu chuẩn máy online và nội kiểm. |
| Giao tiếp với mini PC | Không nối mini PC; kết quả nhập vào HMI/nhật ký. |
| Nếu không có | Không kiểm chứng được máy online – trôi số đo không bị phát hiện. |

#### SPD-01 · Chống sét lan truyền (nguồn, tín hiệu, ăng-ten)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm điện – điều khiển*

Chống sét lan truyền đường nguồn, tín hiệu và ăng-ten; nối đất đẳng thế.

| Mục | Nội dung |
|---|---|
| Vai trò | Chống sét lan truyền đường nguồn, tín hiệu và ăng-ten; nối đất đẳng thế. |
| Giao tiếp với mini PC | Đầu vào 3 pha CP-01, đường 230 VAC sang CP-02, cáp tín hiệu LT-101/PT ngoài trời, ăng-ten RT-01. |
| Nếu không có | Mùa mưa bão dễ hỏng mini PC, I/O, router, cảm biến cùng lúc. |

#### SRV-01 · Máy chủ điều hành & SCADA trung tâm (dùng chung ST-01…ST-04)

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm truyền thông*

Máy chủ điều hành trung tâm + SCADA: nhận dữ liệu, phát hành kịch bản, lệnh từ xa, cảnh báo tập trung.

| Mục | Nội dung |
|---|---|
| Vai trò | Máy chủ điều hành trung tâm + SCADA: nhận dữ liệu, phát hành kịch bản, lệnh từ xa, cảnh báo tập trung. |
| Giao tiếp với mini PC | MQTT broker + REST API; dashboard; giữ kịch bản retained, hàng đợi lệnh có thời hạn. |
| Khi hỏng / dự phòng | Trạm không phụ thuộc máy chủ để vận hành an toàn (chế độ b). |

#### SEC-01 · Hạ tầng an ninh mạng & quản lý thiết bị

*Giải pháp đưa vào · bổ sung mới · bắt buộc · nhóm phần mềm*

Trạm chỉ kết nối ra ngoài (MQTT/TLS 8883 hoặc VPN), không mở cổng vào; khóa riêng lưu trong TPM của MPC-01; ACL theo chủ đề MQTT; kịch bản điều khiển có chữ ký số và kiểm tra theo script_schema; đổi toàn bộ mật khẩu mặc định (router, IO, biến tần, HMI). Áp dụng nguyên tắc IEC 62443 và phân loại cấp độ an toàn hệ thống thông tin theo quy định hiện hành.

| Mục | Nội dung |
|---|---|
| Vai trò | An ninh mạng và quản lý thiết bị: chứng chỉ X.509 từng trạm, VPN/APN riêng, cập nhật OTA ký số, sao lưu cấu hình. |
| Giao tiếp với mini PC | Chạy trên MPC-01, RT-01 và SRV-01. |
| Nếu không có | Lệnh/kịch bản giả mạo có thể điều khiển bơm từ xa – rủi ro an toàn cấp nước. |

### Khuyến nghị bổ sung (để vận hành trơn tru nhất)

#### AIT-203 · Máy đo pH (điện cực thủy tinh)

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm chất lượng nước*

QCVN 01-1:2018/BYT: pH 6,0–8,5.

| Mục | Nội dung |
|---|---|
| Vai trò | pH online: dừng an toàn khi ngoài 6,0–8,5; bù pH cho phép đo clo. |
| Giao tiếp với mini PC | AI 4–20 mA → IO-01 AI7. |
| Nếu không có | pH nước thành phố ít biến động – kiểm tra bằng KIT-01 theo lịch nội kiểm. |
| Thử trong mô phỏng | Tắt AIT-203 rồi tiêm sự cố pH 9,2 ở tab Sự cố. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–14 | pH |
| Sai số | ±0,05 | pH |
| Cảnh báo / Dừng | <6,5 hoặc >8,0 / <6,0 hoặc >8,5 | pH |

**Dải làm việc:** Làm việc 6,5–8,0

#### MV-02 · Van điện đầu ra mạng lưới

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm thủy lực*

Van bướm điện cách ly trạm khỏi mạng lưới khi dừng an toàn do chất lượng nước.

| Mục | Nội dung |
|---|---|
| Vai trò | Cách ly trạm khỏi mạng khi dừng an toàn; trình tự mở van trước – chạy bơm sau. |
| Giao tiếp với mini PC | DO mở/đóng → bộ truyền động; DI vị trí mở/đóng → IO-01. Đóng hẳn → liên động cấm chạy bơm. |
| Nếu không có | Dừng an toàn chỉ dừng bơm (bình tích áp vẫn xả nước ra mạng); không có trình tự khởi động êm. |
| Khi hỏng / dự phòng | Mất điện: giữ vị trí. |

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ van | DN100 | – |
| Thời gian hành trình | 20 | s |

**Dải làm việc:** 0–100 % mở

#### HMI-01 · Màn hình cảm ứng HMI tại chỗ

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm điện – điều khiển*

Hiển thị web HMI do GW-01 phục vụ (xem chế độ "Màn hình HMI" của bản mô phỏng). Đăng nhập PIN theo vai trò, ghi nhật ký thao tác. Quyền tại chỗ ưu tiên hơn lệnh từ trung tâm.

| Mục | Nội dung |
|---|---|
| Vai trò | Màn cảm ứng tại chỗ trên cửa CP-02 để kỹ thuật viên vận hành, xem báo động, điều khiển tay. |
| Giao tiếp với mini PC | Ethernet qua SW-01, trình duyệt kiosk mở web HMI của MPC-01. |
| Thông số điển hình | 7–10 inch, mặt trước IP65, ≥ 400 nit, 24 VDC. |
| Nếu không có | Kỹ thuật viên dùng laptop/máy tính bảng nối mạng OT của tủ; hoặc chỉ thao tác trên bàn phím biến tần (không qua lớp an toàn phần mềm). |
| Thử trong mô phỏng | S12; chế độ "Màn hình HMI" → "Tại trạm · HMI-01". |

#### PL-301 · Logger áp lực điểm bất lợi (NB-IoT/LTE-M)

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm cảm biến*

Đo áp tại điểm bất lợi để hiệu chỉnh đường đặt áp và chứng minh chất lượng dịch vụ.

| Mục | Nội dung |
|---|---|
| Vai trò | Đo áp tại điểm bất lợi để hiệu chỉnh đường đặt áp và chứng minh chất lượng dịch vụ. |
| Giao tiếp với mini PC | Không nối mini PC; gửi thẳng về SRV-01 mỗi 15 phút (gửi ngay khi < 1,2 bar). Trung tâm chỉnh p_crit_target, r_est. |
| Thông số điển hình | 0–10 bar, ±0,25 % FS, pin 3–5 năm, IP68. |
| Nếu không có | Áp điểm bất lợi chỉ suy ra từ mô hình (r_est); chỉ biết thiếu áp khi dân phản ánh. |

#### PSHH-101 · Công tắc áp cao cơ khí (mạch cứng)

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm cảm biến*

Công tắc áp cao cơ khí cắt bơm bằng mạch cứng (≈ 4,8 bar).

| Mục | Nội dung |
|---|---|
| Vai trò | Công tắc áp cao cơ khí cắt bơm bằng mạch cứng (≈ 4,8 bar). |
| Giao tiếp với mini PC | Tiếp điểm NC trong chuỗi liên động IL-01 của CP-01; tiếp điểm phụ → DI IO-01. |
| Nếu không có | Bảo vệ áp cao chỉ còn phần mềm (PT-101/102) và van an toàn PSV-01 6 bar. |

#### GSM-01 · Bộ báo động SMS độc lập

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm truyền thông*

Bộ báo động SMS độc lập có pin: báo "mất bộ điều khiển", mất điện, ngập.

| Mục | Nội dung |
|---|---|
| Vai trò | Bộ báo động SMS độc lập có pin: báo "mất bộ điều khiển", mất điện, ngập. |
| Giao tiếp với mini PC | DI từ WDR-01, UPS-01, LSH-01; SIM riêng. |
| Nếu không có | Mini PC hỏng đồng thời mất 4G thì trung tâm không biết ngay. |

#### LSH-01 · Phao báo ngập phòng bơm

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm cảm biến*

Phao báo ngập phòng bơm (vỡ ống trong trạm).

| Mục | Nội dung |
|---|---|
| Vai trò | Phao báo ngập phòng bơm (vỡ ống trong trạm). |
| Giao tiếp với mini PC | DI → IO-01 (và GSM-01). |

#### LSHH-101 · Phao báo tràn bể

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm cảm biến*

Phao báo tràn bể khi van phao FV-01 kẹt mở.

| Mục | Nội dung |
|---|---|
| Vai trò | Phao báo tràn bể khi van phao FV-01 kẹt mở. |
| Giao tiếp với mini PC | DI → IO-01. |

#### TH-01 · Giám sát nhiệt ẩm tủ + quạt/sưởi

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm điện – điều khiển*

Giám sát nhiệt độ/độ ẩm tủ, điều khiển quạt và sưởi chống ngưng tụ.

| Mục | Nội dung |
|---|---|
| Vai trò | Giám sát nhiệt độ/độ ẩm tủ, điều khiển quạt và sưởi chống ngưng tụ. |
| Giao tiếp với mini PC | Modbus RTU COM2 hoặc DI cảnh báo. |

#### ZS-01 · Công tắc cửa trạm / nắp bể

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm cảm biến*

Công tắc cửa trạm, cửa tủ, nắp bể – an ninh nguồn nước.

| Mục | Nội dung |
|---|---|
| Vai trò | Công tắc cửa trạm, cửa tủ, nắp bể – an ninh nguồn nước. |
| Giao tiếp với mini PC | DI → IO-01; báo động khi mở ngoài lịch bảo trì. |

#### VX-01A · Bộ truyền động điện van xả đáy

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm thủy lực*

Bộ truyền động điện cho van xả đáy để xả bể từ xa theo lệnh trung tâm.

| Mục | Nội dung |
|---|---|
| Vai trò | Bộ truyền động điện cho van xả đáy để xả bể từ xa theo lệnh trung tâm. |
| Giao tiếp với mini PC | DO mở/đóng + DI vị trí → IO-01. |
| Nếu không có | Lệnh xả bể (flush_tank) phải chờ kỹ thuật viên tới mở tay. |

#### PT-100 · Cảm biến áp ống cấp đầu vào

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm cảm biến*

Áp ống cấp thành phố: phân biệt mất nguồn với van phao kẹt.

| Mục | Nội dung |
|---|---|
| Vai trò | Áp ống cấp thành phố: phân biệt mất nguồn với van phao kẹt. |
| Giao tiếp với mini PC | AI → IO-01 AI8. |

#### LT-102 · Cảm biến mức dự phòng (thủy tĩnh)

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm cảm biến*

Cảm biến mức thủy tĩnh dự phòng, đối chiếu chéo với LT-101.

| Mục | Nội dung |
|---|---|
| Vai trò | Cảm biến mức thủy tĩnh dự phòng, đối chiếu chéo với LT-101. |
| Giao tiếp với mini PC | AI → IO-01 kênh dự phòng. |

#### VT-01/02 · Cảm biến rung, nhiệt ổ bi bơm

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm cảm biến*

Rung và nhiệt độ ổ bi bơm – bảo trì theo tình trạng.

| Mục | Nội dung |
|---|---|
| Vai trò | Rung và nhiệt độ ổ bi bơm – bảo trì theo tình trạng. |
| Giao tiếp với mini PC | Modbus RTU hoặc AI. |

#### CAM-01 · Camera IP

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm truyền thông*

Camera IP quan sát trạm, xác nhận sự cố từ xa.

| Mục | Nội dung |
|---|---|
| Vai trò | Camera IP quan sát trạm, xác nhận sự cố từ xa. |
| Giao tiếp với mini PC | Ethernet, tách VLAN khỏi mạng OT. |

#### DOS-01 · Châm clo bổ sung tại trạm

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm chất lượng nước*

Bơm định lượng châm clo bổ sung (NaOCl) khi clo nguồn thấp kéo dài.

| Mục | Nội dung |
|---|---|
| Vai trò | Bơm định lượng châm clo bổ sung (NaOCl) khi clo nguồn thấp kéo dài. |
| Giao tiếp với mini PC | AO/xung từ IO-01 theo AIT-201. |
| Nếu không có | Clo nguồn thấp kéo dài (S9) chỉ có thể dừng cấp nước. |

#### DP-01 · Vật tư dự phòng + mini PC dự phòng nguội

*Khuyến nghị bổ sung · bổ sung mới · nên có · nhóm điện – điều khiển*

Bộ vật tư dự phòng: mini PC đã nạp sẵn ảnh hệ thống, cảm biến áp, cầu chì, rơ-le.

| Mục | Nội dung |
|---|---|
| Vai trò | Bộ vật tư dự phòng: mini PC đã nạp sẵn ảnh hệ thống, cảm biến áp, cầu chì, rơ-le. |
| Giao tiếp với mini PC | — |
| Nếu không có | Thời gian khắc phục phụ thuộc mua hàng (ngày–tuần). |

#### GEN-01 · Điểm đấu máy phát và cầu dao đảo nguồn

*Khuyến nghị bổ sung · bổ sung mới · tùy chọn · nhóm điện – điều khiển*

Điểm đấu máy phát di động + cầu dao đảo nguồn cho mất điện dài.

| Mục | Nội dung |
|---|---|
| Vai trò | Điểm đấu máy phát di động + cầu dao đảo nguồn cho mất điện dài. |
| Giao tiếp với mini PC | DI trạng thái nguồn → IO-01. |

## Bảng ngưỡng tham số

| Tham số | Ngưỡng | Ghi chú |
|---|---|---|
| Áp lực tối thiểu tại điểm bất lợi | ≥ 1,4 bar | Chất lượng dịch vụ (≈14 m cột nước, nhà 2 tầng) |
| Áp lực tối đa đầu ra trạm | ≤ 4,0 bar | Giới hạn áp lực tự do mạng lưới (40 m) |
| Áp lực đặt đầu ra P_set(Q) | 1,9–3,6 bar | P_set = 1,60 + 0,39 + 0,00111·Q² |
| Cảnh báo áp thấp đầu ra | < 1,6 bar (30 s) | Cảnh báo |
| Nghi vỡ ống | P < 1,2 bar và Q > 40 m³/h (60 s) | Báo động khẩn |
| Áp cao – giới hạn tần số | > 4,0 bar | Giảm trần tần số 0,5 Hz/s |
| Áp rất cao – cắt bơm | > 4,5 bar (3 s) | Tự chạy lại sau 300 s; 3 lần/giờ → khóa |
| Van an toàn cơ khí PSV-01 | 6,0 bar | Độc lập với điện tử |
| Mức nước: van phao đóng | 3,8 m | Tràn ở 4,0 m |
| Mức thấp – giảm áp tiết kiệm | < 1,2 m | P_set -0,3 bar (không dưới 1,7 bar) |
| Mức dừng bơm (kịch bản) | < 0,6 m, chạy lại > 1,5 m | Chống chạy khô |
| Mức rất thấp (lớp an toàn) | < 0,5 m, chạy lại > 1,0 m | Phao cứng LSLL 0,35 m |
| Clo dư tự do | cảnh báo < 0,3 / > 0,8; dừng < 0,2 / > 1,0 mg/L | QCVN 01-1:2018/BYT: 0,2–1,0 mg/L; xác nhận 120 s |
| Độ đục | cảnh báo > 1,0; dừng > 2,0 NTU | QCVN: ≤ 2 NTU; xác nhận 60 s |
| pH | cảnh báo < 6,5 / > 8,0; dừng < 6,0 / > 8,5 | QCVN: 6,0–8,5; xác nhận 120 s |
| Thời gian trễ phát hiện mất mạng | 60 s | Nhịp tim 10 s |
| Biên áp lực khi mất mạng | +0,1 bar (> 24 h: +0,2 bar) | Bù cho việc mất giám sát trung tâm |
| Thời hạn lệnh ghi đè từ xa | 15 phút | Hết hạn → quay về kịch bản đã lưu |
| Bộ đệm lưu-và-chuyển | 4320 bản ghi (12 h) | Nén khi đầy 80 % |
| Giới hạn khởi động bơm | 6 lần/giờ, nghỉ ≥ 60 s | Bảo vệ động cơ |

Giới hạn chất lượng nước theo QCVN 01-1:2018/BYT (ban hành kèm Thông tư 41/2018/TT-BYT): clo dư tự do 0,2–1,0 mg/L, độ đục ≤ 2 NTU, pH 6,0–8,5. Ngưỡng áp lực dịch vụ (1,4 bar tại điểm bất lợi, tối đa 4,0 bar) là giả định học tập, tham khảo cách xác định áp lực tự do theo số tầng nhà trong TCXDVN 33:2006 và TCVN 13606:2023. Khi áp dụng thực tế cần đối chiếu văn bản gốc và quy chuẩn địa phương đang có hiệu lực.


## Mô hình toán học dùng trong mô phỏng

| Thành phần | Phương trình | Ghi chú |
|---|---|---|
| Bơm + biến tần | $H = H_0 s^2 - K Q^2,\; s = f/50$ | Luật tương tự: $Q \propto s$, $H \propto s^2$, $P \propto s^3$ |
| Hiệu suất bơm | $\eta = \eta_{max}\,x(2-x),\; x = Q/(s\,Q_{BEP})$ | Parabol, cực đại tại BEP |
| Công suất trục | $P = \rho g H s Q_{BEP} / (\eta_{max}(2-x))$ | Không suy biến khi $Q \to 0$ (công suất đóng van ≈45 % định mức) |
| Công suất điện | $P_{el} = P/\eta_{motor+VFD} + P_{chờ}$ | $\eta_{motor+VFD} = 0{,}88$; 25 W chờ mỗi biến tần |
| Bình tích áp | $V_{nước} = V(1 - (p_0+1)/(p+1))$ khi $p > p_0$ | Khí nén đẳng nhiệt (áp suất tuyệt đối) |
| Cân bằng ống đẩy | $S(p_{n+1}) - S(p_n) = \Delta t\,[Q_{bơm}(p) - Q_{mạng}(p) - Q_{xả}(p)]$ | Euler lùi + Newton có chặn, ổn định vô điều kiện |
| Nhu cầu phụ thuộc áp | $Q_d = Q_{yc}\sqrt{(p_c - p_{0})/(p_{đủ} - p_{0})}$ | Mô hình Wagner (như EPANET 2.2), $p_0=0{,}1$, $p_{đủ}=1{,}0$ bar |
| Áp điểm bất lợi | $p_c = p_{ra} - \Delta z/10{,}19 - r Q^2$ | $\Delta z = 4$ m, $r = 0{,}00111$ bar/(m³/h)² |
| Rò rỉ mạng lưới | $Q_L = C\,\bar p^{\,N_1}$, $N_1 = 1{,}18$ | FAVAD; áp thấp hơn → rò rỉ ít hơn |
| Bồn mái hộ dân | $dB/dt = Q_{tiêu thụ} - Q_d$; $Q_{yc} = Q_{tiêu thụ} + \min(15, B/1{,}5\,h)$ | Thiếu nước thực sự khi $B > 300$ m³ |
| Bể chứa | $A\,dh/dt = Q_{vào} + Q_{xả về} - \sum Q_{bơm} - Q_{xả đáy}$ | Van phao điều biến 3,4–3,8 m |
| Clo dư trong bể | $dC/dt = \frac{Q_{vào}}{V}(C_{vào}-C) - k_b C$ | $k_b = 0{,}4$/ngày |
| Độ đục trong bể | $dT/dt = \frac{Q_{vào}}{V}(T_{vào}-T) - k_s (T - T_{nền}) + e(h)$ | Lắng $k_s = 0{,}2$/h; cuốn cặn khi mức < 0,8 m |
| Cảm biến | $y \leftarrow y + (x-y)(1-e^{-\Delta t/\tau}) + \sigma\varepsilon$ | Bão hòa 4–20 mA, lỗi: kẹt, lệch, trôi, mất tín hiệu |
| Nhu cầu nước | $Q = \bar Q \cdot m_{giờ}(t) \cdot k_{ngày} \cdot (1 + \xi_{AR(1)})$ | Mẫu 24 giờ ngày thường/cuối tuần, nhiễu AR(1) σ = 7 %, τ = 5 phút |

