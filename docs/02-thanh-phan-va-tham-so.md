# Thành phần trạm bơm, tham số vật lý và dải làm việc

> Tệp này được sinh tự động bởi `python tools/gen_docs.py` từ `config/components.json` và `config/station.json`.
> Sửa tham số ở file cấu hình rồi chạy lại lệnh để cập nhật tài liệu.

Trạm ST-01 phục vụ khu dân cư A (≈2.400 người, 160 L/người/ngày, nhu cầu trung bình 16 m³/h, giờ cao điểm
≈28–34 m³/h). Trạm không có người trực; công nhân đi kiểm tra theo lượt (07:30 và 16:30 trong phương án lịch cố định).


## Danh mục thành phần

### Thủy lực

#### T-01 · Bể chứa nước sạch (bể ngầm/bán ngầm)

Bể bê tông cốt thép nhận nước từ ống cấp thành phố qua van phao, là nguồn hút cho cụm bơm và là bộ đệm chất lượng nước (trộn đều).

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

Van phao điều biến cơ khí: mở dần khi mức nước giảm dưới 3,8 m, mở hoàn toàn ở 3,4 m. Lưu lượng phụ thuộc áp lực ống cấp thành phố (giảm vào giờ cao điểm).

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Lưu lượng cấp tối đa | 26 | m³/h |
| Mức đóng hoàn toàn | 3,8 | m |
| Dải điều biến | 0,4 | m |
| Hệ số cấp giờ cao điểm | 0,75–0,8 | – |

**Dải làm việc:** 0–26 m³/h

#### VX-01 · Van xả đáy bể

Van xả cặn/súc rửa bể, điều khiển từ gateway theo lệnh của trung tâm (quy trình khôi phục sau sự cố chất lượng).

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Lưu lượng xả | 120 | m³/h |
| Cỡ van | DN150 | – |

**Dải làm việc:** Đóng/Mở

#### P-01 · Bơm ly tâm trục ngang số 1 + biến tần VFD-01

Bơm ly tâm một tầng cánh, động cơ 5,5 kW, điều khiển tốc độ bằng biến tần. Đường đặc tính H = H0·(f/50)² − K·Q²; công suất trục theo luật tương tự.

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

#### P-02 · Bơm ly tâm trục ngang số 2 + biến tần VFD-02

Giống P-01. Hai bơm chạy luân phiên theo giờ chạy (bơm chính/bơm dự phòng) và ghép song song khi nhu cầu cao.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cột áp đóng van H0 @50 Hz | 44 | m |
| Hệ số đặc tính K | 0,015 | m/(m³/h)² |
| Công suất động cơ | 5,5 | kW |
| Dải tần số | 25–50 | Hz |

**Dải làm việc:** Như P-01

#### CV-01/02 · Van một chiều sau bơm

Ngăn dòng chảy ngược qua bơm đang dừng; trong mô hình thể hiện bằng ràng buộc Q ≥ 0.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ van | DN80 | – |
| Áp lực danh định | PN16 | – |

**Dải làm việc:** Q ≥ 0

#### HT-01 · Bình tích áp màng (thủy khí)

Bình màng làm mềm dao động áp lực, cấp nước khi bơm ngủ đông. Khí nén đẳng nhiệt: V_khí = V·(p0+1)/(p+1).

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Thể tích bình | 300 | L |
| Áp nạp trước | 1,8 | bar |
| Độ đàn hồi đường ống | 0,005 | m³/bar |

**Dải làm việc:** 1,8–6,0 bar

#### PSV-01 · Van an toàn cơ khí (xả về bể)

Lớp bảo vệ cuối cùng, độc lập với điện tử: mở khi áp lực ống đẩy vượt 6,0 bar.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Áp lực mở | 6,0 | bar |
| Hệ số xả | 40 | m³/h/bar |

**Dải làm việc:** Đóng < 6,0 bar

#### MV-02 · Van điện đầu ra mạng lưới

Van bướm điện cách ly trạm khỏi mạng lưới khi dừng an toàn do chất lượng nước.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ van | DN100 | – |
| Thời gian hành trình | 20 | s |

**Dải làm việc:** 0–100 % mở

#### MANG-LUOI · Mạng lưới phân phối khu dân cư A (DMA-A)

≈2.400 người, 160 L/người/ngày, phần lớn hộ có bồn mái. Nhu cầu phụ thuộc áp lực (mô hình Wagner, như EPANET 2.2), rò rỉ theo FAVAD (Q = C·P^1,18).

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Nhu cầu trung bình | 16 | m³/h |
| Chênh cao điểm bất lợi | +4 | m |
| Tổn thất đến điểm bất lợi | 0,00111·Q² | bar |
| Áp đủ cấp đủ nhu cầu | 1,0 | bar |
| Hệ số rò rỉ C | 0,7 | m³/h/bar^1,18 |
| Dung tích bồn mái quy đổi | 300 | m³ |

**Dải làm việc:** Áp tại điểm bất lợi ≥ 1,4 bar; áp đầu ra ≤ 4,0 bar

### Cảm biến

#### PT-101 · Cảm biến áp lực đầu ra (điều khiển)

Áp lực kế điện tử màng gốm, 4–20 mA, dùng cho vòng điều khiển PI.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Sai số | ±0,25 % FS | – |
| Thời gian đáp ứng | < 200 | ms |
| Tín hiệu lỗi (NAMUR NE43) | < 3,6 mA | – |

**Dải làm việc:** 0–10 bar

#### PT-102 · Cảm biến áp lực đầu ra (bảo vệ, dự phòng)

Cảm biến độc lập thứ hai cho lớp an toàn (cắt áp rất cao) và đối chiếu chéo với PT-101.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Sai số | ±0,25 % FS | – |
| Ngưỡng lệch PT-101/PT-102 | 0,3 bar / 10 s | – |

**Dải làm việc:** 0–10 bar

#### PI-101/102 · Đồng hồ áp lực cơ trên ống đẩy từng bơm

Đồng hồ kim Bourdon, mặt 100 mm, chỉ thị tại chỗ (không nối gateway). Dùng cho kiểm tra hiện trường và đối chiếu.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–10 | bar |
| Cấp chính xác | 1,6 | – |

**Dải làm việc:** 0–10 bar

#### FT-101 · Đồng hồ lưu lượng điện từ đầu ra

Đo lưu lượng cấp vào mạng lưới, đầu vào cho đường đặt áp theo lưu lượng và phát hiện rò rỉ ban đêm.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ ống | DN100 | – |
| Dải đo | 0–80 | m³/h |
| Sai số | ±0,5 % | – |
| Ngưỡng cắt lưu lượng nhỏ | 0,3 | m³/h |

**Dải làm việc:** 0–80 m³/h

#### FT-100 · Đồng hồ lưu lượng nước vào bể

Đồng hồ Woltmann có đầu xung, dùng cân bằng nước và dự báo thời gian cạn bể.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Cỡ ống | DN100 | – |
| Dải đo | 0–50 | m³/h |

**Dải làm việc:** 0–50 m³/h

#### LT-101 · Cảm biến mức siêu âm

Đo mức nước bể từ nắp bể. Phao cứng LSLL-101 (0,35 m) độc lập, nối thẳng mạch khởi động bơm.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–5 | m |
| Sai số | ±3 | mm |
| Phao chống cạn LSLL-101 | 0,35 (reset 0,6) | m |

**Dải làm việc:** 0–5 m

### Chất lượng nước

#### AIT-201 · Máy đo clo dư tự do (amperometric)

Lấy mẫu liên tục từ ống đẩy. QCVN 01-1:2018/BYT: clo dư tự do 0,2–1,0 mg/L.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–5 | mg/L |
| Sai số | ±0,03 | mg/L |
| Thời gian đáp ứng T90 | ≈90 | s |
| Cảnh báo / Dừng | <0,3 hoặc >0,8 / <0,2 hoặc >1,0 | mg/L |

**Dải làm việc:** Làm việc 0,3–0,8 mg/L

#### AIT-202 · Máy đo độ đục (nephelometric)

QCVN 01-1:2018/BYT: độ đục ≤ 2 NTU.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–100 | NTU |
| Sai số | ±2 % hoặc ±0,02 | NTU |
| Thời gian đáp ứng | ≈30 | s |
| Cảnh báo / Dừng | > 1,0 / > 2,0 (60 s) | NTU |

**Dải làm việc:** Làm việc < 1,0 NTU

#### AIT-203 · Máy đo pH (điện cực thủy tinh)

QCVN 01-1:2018/BYT: pH 6,0–8,5.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Dải đo | 0–14 | pH |
| Sai số | ±0,05 | pH |
| Cảnh báo / Dừng | <6,5 hoặc >8,0 / <6,0 hoặc >8,5 | pH |

**Dải làm việc:** Làm việc 6,5–8,0

### Điều khiển

#### CP-01 · Tủ điều khiển trạm

Gồm edge gateway, 2 biến tần, công tơ điện EM-101, UPS, router 4G và màn hình HMI tại chỗ. Mạch an toàn cứng (phao LSLL, rơ-le nhiệt) độc lập với phần mềm.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Nguồn | 3 pha 400 V | – |
| UPS cho gateway + router | 4 | h |
| Cấp bảo vệ | IP54 | – |
| Nhiệt độ làm việc | 0–50 | °C |

**Dải làm việc:** –

#### GW-01 · Edge gateway (PLC/IoT gateway)

Thu thập dữ liệu chu kỳ 1 s, kiểm tra hợp lệ tín hiệu, lớp an toàn ưu tiên cao nhất, kịch bản điều khiển có phiên bản, bộ đệm lưu-và-chuyển, đồng bộ với máy chủ qua MQTT.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Chu kỳ quét | 1 | s |
| Gói dữ liệu đo xa | 10 | s |
| Nhịp tim (heartbeat) | 10 | s |
| Phát hiện mất mạng | 60 | s |
| Bộ đệm | 4.320 bản ghi (12 h) + nén | – |
| Tốc độ phát lại | 20 | bản ghi/s |

**Dải làm việc:** –

### Truyền thông

#### RT-01 · Router 4G/LTE + kênh SMS dự phòng

Kết nối MQTT/TLS tới máy chủ điều hành; khi mất IP, cảnh báo nghiêm trọng gửi qua SMS tới tổ trực.

| Tham số | Giá trị | Đơn vị |
|---|---:|---|
| Độ trễ điển hình | 0,4 | s |
| Giao thức | MQTT 3.1.1/5 trên TLS 1.2 | – |

**Dải làm việc:** –

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

