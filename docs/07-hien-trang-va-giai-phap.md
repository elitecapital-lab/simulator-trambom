# Hiện trạng nhà máy, giải pháp đưa vào và khuyến nghị bổ sung

Tài liệu này tách bạch ba nhóm thiết bị của trạm bơm tăng áp ST-01:

| Nhóm | Ý nghĩa | Ví dụ | Màu trong mô phỏng |
|---|---|---|---|
| **Hiện trạng** | Thiết bị nhà máy **đã có** trước khi cải tạo. Giữ nguyên, cấu hình lại hoặc nâng cấp nhỏ. | Bể chứa, van phao, 2 bơm, 2 biến tần, van một chiều, phao chống cạn, tủ động lực CP-01 | nâu đồng |
| **Giải pháp** | Thiết bị **đưa vào** để tiếp nhận, xử lý và điều khiển tín hiệu tại chỗ. Đây là tập tối thiểu để có đủ 4 chế độ (a)–(d), lớp an toàn ưu tiên cao nhất và khả năng tự vận hành khi mất mạng. | Mini PC công nghiệp MPC-01 chạy edge gateway GW-01, I/O từ xa IO-01, cảm biến áp, lưu lượng, mức, clo, độ đục, router 4G, UPS, rơ-le watchdog, tủ CP-02 | tím |
| **Khuyến nghị** | **Nên có** để hệ thống vận hành trơn tru nhất. Thiếu vẫn chạy được, nhưng rủi ro hoặc thiệt hại lớn hơn. | Van điện đầu ra MV-02, máy đo pH, màn HMI tại chỗ, logger áp điểm bất lợi, công tắc áp cao cơ khí, phao báo ngập… | xanh ngọc |

Trong bản mô phỏng 3D, nút **Hiện trạng / Giải pháp / Khuyến nghị** trên khung hình tô màu đúng nhóm và làm mờ các nhóm còn lại. Tab **Thiết bị** liệt kê đủ 56 hạng mục. Mỗi hạng mục có vai trò, cách đấu nối với mini PC, hậu quả nếu không có và dự phòng khi hỏng. Danh mục gốc ở `config/components.json`. Phần [2](02-thanh-phan-va-tham-so.md) và bảng ở mục 8 được sinh tự động từ tệp này.

## 1. Tiêu chí phân loại

Một thiết bị được xếp vào **giải pháp** khi không có nó thì **không đạt được ít nhất một yêu cầu** của đề bài:

- điều khiển áp theo lưu lượng;
- luân phiên bơm;
- dừng khi mức bể thấp;
- tự vận hành khi mất mạng;
- đồng bộ khi có mạng lại;
- dừng an toàn khi vượt ngưỡng chất lượng hoặc áp lực.

Một thiết bị được xếp vào **khuyến nghị** khi nó làm hệ thống **tin cậy hơn, an toàn hơn hoặc dễ vận hành hơn**, nhưng các yêu cầu trên vẫn đạt khi thiếu nó.

Thiết bị chỉ được khuyến nghị khi chứng minh được bằng **mô phỏng "nếu không lắp"** (mục 9) hoặc bằng một rủi ro cụ thể đã nêu ở cột "Nếu không có". Cảm tính không đủ.

Ba chuyên gia đề xuất (tự động hóa OT, cấp nước, IoT/hệ thống nhúng) không hoàn toàn thống nhất ở ranh giới hai nhóm sau:

| Thiết bị | Chuyên gia khác xếp | Dự án xếp | Lý do |
|---|---|---|---|
| PT-102 | khuyến nghị | **giải pháp** | Lớp an toàn áp lực cần cảm biến độc lập với vòng điều khiển. Không có PT-102 thì ở mức cơ bản, PT-101 kẹt không bị phát hiện: áp > 4,0 bar suốt 119 phút trong S5. |
| AIT-201, AIT-202 | khuyến nghị | **giải pháp** | Đề bài yêu cầu dừng an toàn theo chất lượng. Không đo online thì không thể dừng. Không có AIT-202, S4 cấp 28,3 m³ nước > 2 NTU ra mạng; có máy thì chỉ 0,4 m³. |
| AIT-203 (pH) | giải pháp | **khuyến nghị** | Nước thành phố đã xử lý, pH ít biến động. Kiểm tra định kỳ bằng bộ đo cầm tay KIT-01 là đủ. |
| WDR-01 + ISO-101 | khuyến nghị | **giải pháp** | Mini PC là điểm hỏng đơn lẻ. Không có dự phòng thì khi mini PC treo 6 giờ, áp ngoài dải 213 phút; có dự phòng thì 1 phút (S11). |
| EM-101 | khuyến nghị | **giải pháp** | Phải so sánh kWh với lịch cố định. Cần đường cơ sở điện năng đo **trước** khi cải tạo. |
| MV-02 | — | **khuyến nghị** | Dừng an toàn vẫn đạt bằng cách dừng bơm. MV-02 thêm cách ly hẳn và trình tự "mở van trước, chạy bơm sau". |
| HMI-01 | — | **khuyến nghị** | Web HMI chạy sẵn trên mini PC; kỹ thuật viên có thể dùng laptop hoặc máy tính bảng. Màn cố định trên cửa tủ giúp thao tác nhanh và an toàn hơn. |

## 2. Bố trí vật lý: tủ hiện trạng CP-01 và tủ mới CP-02

```mermaid
flowchart LR
  classDef ht fill:#f2e6d9,stroke:#a0703c,color:#222
  classDef gp fill:#e9e3fd,stroke:#7a5af5,color:#222
  classDef kn fill:#ddf3f5,stroke:#0f9fb0,color:#222
  subgraph CP01["CP-01 · tủ động lực HIỆN TRẠNG (cải tạo)"]
    MCCB["MCCB, contactor, rơ-le nhiệt"]:::ht
    VFD1["VFD-01"]:::ht
    VFD2["VFD-02"]:::ht
    SA["SA-01/02 Tay/0/Tự động + dừng khẩn"]:::gp
    WDR["WDR-01 watchdog + K-SS chốt dừng an toàn"]:::gp
    EM["EM-101 đồng hồ điện"]:::gp
    IL["Liên động cứng: LSLL-101, PSHH-101*, MV-02 đóng"]:::ht
  end
  subgraph CP02["CP-02 · tủ điều khiển & truyền thông GIẢI PHÁP"]
    MPC["MPC-01 mini PC · GW-01"]:::gp
    IO["IO-01 I/O Modbus TCP"]:::gp
    SW["SW-01 switch OT"]:::gp
    RT["RT-01 router 4G 2 SIM + SMS"]:::gp
    UPS["UPS-01 24 VDC ≥ 4 h"]:::gp
    ISO["ISO-101 chia tín hiệu 4–20 mA"]:::gp
    HMI["HMI-01 màn cảm ứng"]:::kn
  end
  PT1["PT-101"]:::gp --> ISO
  ISO --> IO
  ISO -- "AI2 PID dự phòng" --> VFD1
  ISO --> VFD2
  PT2["PT-102"]:::gp --> IO
  FT1["FT-101"]:::gp --> IO
  LT["LT-101"]:::gp --> IO
  AIT["AIT-201/202 (+AIT-203*)"]:::gp --> IO
  FT0["FT-100 + đầu xung"]:::ht --> IO
  MPC -- "Modbus RTU COM1" --> VFD1
  MPC -- "Modbus RTU COM1" --> VFD2
  MPC -- "Modbus RTU COM2" --> EM
  MPC --- SW
  SW --- IO
  SW --- HMI
  MPC --- RT
  IO -- "DO xung sống 1 Hz" --> WDR
  WDR -- "nhả: chọn PID nội" --> VFD1
  SA --> VFD1
  SA --> VFD2
  IL --> VFD1
  IL --> VFD2
  RT -- "MQTT/TLS · SMS" --> SRV["SRV-01 máy chủ + SCADA trung tâm"]:::gp
  PL["PL-301 logger điểm bất lợi"]:::kn -- "NB-IoT" --> SRV
```

\* thiết bị khuyến nghị.

Nguyên tắc bố trí:

1. **Thiết bị điện tử và truyền thông mới đặt ở tủ riêng CP-02**, tách khỏi nhiễu và nhiệt của biến tần. Tủ treo tường cạnh CP-01, IP54, có quạt lọc và sưởi chống ngưng tụ.
2. **Những gì phải nằm sát biến tần đặt trong CP-01**: công tắc Tay/0/Tự động, rơ-le watchdog, rơ-le liên động, đồng hồ điện. Hai tủ nối với nhau qua hàng kẹp X-IF.
3. **Mạch an toàn cứng không đi qua mini PC.** Phao LSLL-101, dừng khẩn, công tắc áp cao cơ khí PSHH-101 (nếu có) và "van MV-02 đóng hẳn" nằm trong chuỗi liên động của CP-01, đấu kiểu thường đóng. Đứt dây thì dừng.

Trong cảnh 3D, CP-01 đứng sát tường sau (bên trong là MCCB, VFD-01/02, WDR-01, EM-101 và công tắc SA trên cửa). CP-02 treo ở tường bên (bên trong là MPC-01, IO-01, RT-01, UPS-01; màn HMI-01 trên cửa). Nút "Tủ điều khiển" đưa camera tới vị trí này.

## 3. Thiết bị hiện trạng: giữ gì, cấu hình lại gì

| Thiết bị | Việc cần làm | Vì sao |
|---|---|---|
| VFD-01/02 | Sao lưu tham số gốc. Khóa f_max 50 Hz, đặt f_min 25 Hz, tăng/giảm tần 20 s. Bật Modbus RTU (địa chỉ 1/2, 19 200 bps, timeout 3–5 s, khi mất liên lạc thì giữ tần số cuối). Bật PID nội 3,0 bar theo PT-101 (Kp 6 Hz/bar, Ti 15 s), cho chọn nguồn tần số bằng tiếp điểm WDR-01; mất phản hồi PID thì chạy 40 Hz. Bật bảo vệ non tải (chạy khô). Đặt tự khởi động lại sau mất điện lệch nhau (≈10 s / ≈40 s). | Hiện trạng biến tần chỉ dùng như khởi động mềm (chạy 50 Hz). Giải pháp khai thác điều khiển tốc độ và dùng PID nội làm lớp dự phòng khi mini PC hỏng. Nếu biến tần không có RS-485 thì dùng card truyền thông hoặc phương án đầu cực (AO 4–20 mA). |
| HV-01..04 | Mở hết van đẩy đang tiết lưu và niêm phong. Ghi lại vị trí cũ. | Tiết lưu bằng van làm mất năng lượng; biến tần thay vai trò này (xem so sánh với phương án lịch cố định). |
| LSLL-101 | Đấu lại kiểu thường đóng, thêm rơ-le KA-LS lấy tiếp điểm giám sát, đặt phao trong ống lặng, thử ngưỡng 0,35 / 0,6 m. | Lớp bảo vệ cứng chống chạy khô phải an toàn khi hỏng (fail-safe). |
| FT-100 | Gắn đầu phát xung 10 L/xung vào đồng hồ Woltmann thương mại hiện có. Phối hợp công ty cấp nước để niêm chì lại. | Đo nước mua vào, cân bằng nước. Mức ưu tiên chỉ là **nên có**: mô phỏng cho thấy cân bằng khối lượng (LT-101 + FT-101) đủ để phát hiện mất nguồn (mục 9). |
| CP-01 | Lắp SA-01/02, đèn Chạy / Lỗi / Tự động / Dự phòng PID, nút dừng khẩn trên cửa. Lắp WDR-01, rơ-le liên động, EM-101, SPD-01 ở đầu vào 3 pha. Thêm hàng kẹp X-IF, lấy nguồn 230 VAC cho CP-02 qua MCB riêng. | Tủ hiện trạng tiếp tục cấp điện và bảo vệ động lực; phần điều khiển mới nằm ở CP-02. |
| HT-01, PSV-01 | Giữ nguyên. Kiểm tra áp nạp trước của bình (1,7–1,8 bar) mỗi 6 tháng, thử van an toàn hằng năm. Nếu trạm chưa có PSV-01 thì **phải** bổ sung trước khi giao quyền tự động. | Van an toàn là lớp bảo vệ cơ khí cuối cùng; bình tích áp cho phép bơm ngủ đông khi lưu lượng rất nhỏ. |

## 4. Mini PC MPC-01: tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ

**Vai trò.** MPC-01 là phần cứng chạy edge gateway GW-01, tức chính lõi `trambom/gateway.py`, `control.py`, `safety.py`, `comms.py` đã kiểm chứng trong mô phỏng (bản JavaScript chạy trong trình duyệt là bản tương đương). Mọi quyết định được ra **tại chỗ**, chu kỳ 1 s:

- xử lý tín hiệu;
- lớp an toàn;
- kịch bản ngưỡng hoặc dự báo;
- quản lý bơm;
- bộ đệm lưu-và-chuyển.

Máy chủ trung tâm chỉ giúp trạm chạy tốt hơn (phát hành kịch bản, lệnh từ xa, tổng hợp). Máy chủ không phải điều kiện để trạm an toàn. Mini PC cũng **không phải lớp bảo vệ cuối cùng**: mạch cứng và PID nội biến tần vẫn hoạt động khi nó hỏng.

**Cấu hình đề xuất**

- **Phần cứng:** máy tính công nghiệp không quạt, gắn DIN; x86 hoặc ARM công nghiệp 4 nhân; RAM 4–8 GB.
- **Lưu trữ:** SSD hoặc eMMC công nghiệp pSLC 64–128 GB, có bảo vệ mất nguồn.
- **Cổng giao tiếp:** 2 LAN (WAN và mạng OT tách nhau); 2 RS-485 cách ly.
- **Bảo mật:** watchdog phần cứng, TPM 2.0, Secure Boot, RTC có pin.
- **Nguồn và môi trường:** nguồn 9–36 VDC từ UPS-01; −20…60 °C; công suất 10–15 W.
- **Lưu ý:** không dùng PC văn phòng hay thẻ SD.

**Phần mềm** (Linux LTS, phân vùng gốc chỉ đọc, cập nhật kiểu A/B có tự quay lui):

| Dịch vụ | Việc | Chu kỳ |
|---|---|---|
| `io` | Modbus TCP tới IO-01: AI 4–20 mA (kiểm tra NAMUR NE43), DI, đếm xung FT-100, DO, xung sống watchdog | 100–250 ms |
| `drive` | Modbus RTU COM1 – **chỉ** VFD-01/02 (tách bus để thiết bị đo chậm không làm trễ lệnh bơm) | 0,5–1 s |
| `meter` | Modbus RTU COM2: EM-101, bộ phân tích AIT, FT-101 (tổng m³), nhiệt ẩm tủ | 2–10 s |
| `control` | Lõi GW-01: lọc, đối chiếu PT-101/102 + mô hình bơm, lớp an toàn, kịch bản, quản lý bơm, chế độ TAY | 1 s |
| `comms` | MQTT/TLS 8883 (QoS 1, phiên bền, LWT), bộ đệm SQLite trên SSD, đồng bộ khi có mạng lại | 10 s |
| `hmi` | Web HMI cục bộ (chế độ "Màn hình HMI" của mô phỏng), phân quyền, nhật ký thao tác | – |
| `sms` | Gửi SMS báo động khẩn qua API của RT-01 khi mất IP | theo sự kiện |

**Vì sao mini PC, không phải PLC?** Các chức năng dự báo 168 giờ, bộ đệm hàng nghìn bản ghi, hợp nhất ba chiều, MQTT/TLS và web HMI chạy tự nhiên trên Linux; PLC nhỏ làm được nhưng khó. Đổi lại, mini PC kém tin cậy hơn PLC. Vì vậy giải pháp bù bằng ba lớp:

1. watchdog ba tầng (dịch vụ, phần cứng, rơ-le ngoài WDR-01);
2. PID nội biến tần làm dự phòng;
3. mạch liên động cứng.

Một phương án thay thế hợp lệ là **PLC nhỏ** giữ vòng điều khiển và an toàn, còn **mini PC** chỉ làm gateway (dự báo, truyền thông, HMI). Phương án này đắt hơn, tin cậy hơn và phù hợp trạm lớn. Bài tập so sánh hai kiến trúc ở mục 11.

## 5. Danh sách tín hiệu (I/O list)

| Tag | Tín hiệu | Loại | Kênh / bus | Ghi chú |
|---|---|---|---|---|
| PT-101 | Áp đầu ra – điều khiển | AI 4–20 mA | IO-01 AI1 qua ISO-101 (ra thêm AI2 của VFD-01/02) | < 3,6 mA hoặc > 21 mA là lỗi (NE43) |
| PT-102 | Áp đầu ra – bảo vệ | AI 4–20 mA | IO-01 AI2 | Điểm trích riêng; lớp an toàn dùng max(PT-101, PT-102) |
| FT-101 | Lưu lượng ra mạng | AI 4–20 mA + Modbus | IO-01 AI3; tổng m³ qua COM2 | Cắt lưu lượng nhỏ 0,3 m³/h |
| LT-101 | Mức bể | AI 4–20 mA | IO-01 AI4 | Có chống sét tín hiệu (cáp từ nắp bể) |
| AIT-201 | Clo dư | AI 4–20 mA / Modbus | IO-01 AI5 | Chỉ hợp lệ khi FS-201 báo có dòng mẫu |
| AIT-202 | Độ đục | AI 4–20 mA | IO-01 AI6 | |
| AIT-203 | pH (khuyến nghị) | AI 4–20 mA | IO-01 AI7 | Bù pH cho đo clo |
| PT-100, LT-102 | Áp ống cấp, mức dự phòng (tùy chọn) | AI 4–20 mA | IO-01 AI8 | Giữ ≥ 20 % kênh dự phòng |
| FT-100 | Lưu lượng vào | Xung 10 L/xung | IO-01 DI bộ đếm | Tính lưu lượng trượt 60 s |
| LSLL-101 | Phao chống cạn | DI (NC) | IO-01 DI1 qua KA-LS | Chỉ giám sát – mạch cắt bơm là mạch cứng |
| VFD-01/02 | Chạy / lỗi | DI | IO-01 DI2–DI5 | Đối chiếu với trạng thái đọc qua Modbus |
| SA-01/02 | Vị trí Tay / Tự động | DI | IO-01 DI6–DI9 | Mini PC chỉ ra lệnh khi công tắc ở TỰ ĐỘNG |
| MV-02 | Vị trí mở / đóng | DI | IO-01 DI10–DI11 | Đóng hẳn → liên động cấm chạy bơm |
| UPS-01 | Mất điện lưới / ắc quy yếu | DI | IO-01 DI12–DI13 | |
| FS-201, ZS-01, LSH-01 | Dòng mẫu, cửa, ngập | DI | IO-01 DI14–DI16 | |
| VFD-01/02 | Lệnh chạy | DO | IO-01 DO1–DO2 → SA → WDR-01 → FWD | Mất truyền thông IO → về 0 (WDR-01 đã chuyển PID) |
| WDR-01 | Xung sống | DO bán dẫn 1 Hz | IO-01 DO3 | Chỉ đảo khi một chu kỳ điều khiển thành công |
| MV-02 | Mở / đóng | DO | IO-01 DO4–DO5 | |
| VX-01A | Xả đáy (tùy chọn) | DO | IO-01 DO6 | Chỉ được mở khi trạm đang dừng an toàn |
| VFD-01/02 | Tần số đặt, f, I, kW, kWh, mã lỗi | Modbus RTU | COM1, địa chỉ 1 / 2 | |
| EM-101 | kW, kWh, cos φ | Modbus RTU | COM2, địa chỉ 10 | |

## 6. Phân cấp dự phòng – điều gì còn lại khi từng thứ hỏng

| Lớp | Cơ chế | Còn hoạt động khi … |
|---|---|---|
| 0 – Cơ khí | Van phao FV-01, van một chiều, f_max khóa 50 Hz, van an toàn PSV-01 6 bar, bồn mái hộ dân (đệm ≈1,5 h) | mất điện, mất mọi điện tử |
| 1 – Liên động cứng | LSLL-101 (0,35 m), dừng khẩn, PSHH-101*, MV-02 đóng hẳn → cấm chạy; rơ-le chốt dừng an toàn K-SS | mini PC và IO-01 hỏng |
| 2 – Bảo vệ nội biến tần | Quá dòng, quá nhiệt, mất pha, non tải, tự khởi động lại có trễ | mọi chế độ |
| 3 – GW-01 bình thường | Lớp an toàn phần mềm (cắt > 4,5 bar theo max(PT-101, PT-102), chạy khô 0,5 m, dừng an toàn chất lượng QCVN, tối đa 6 lần khởi động/giờ) + kịch bản ngưỡng / dự báo | chế độ (a), (c), (d) |
| 4 – Lỗi cảm biến | Biểu quyết PT-101/PT-102/mô hình bơm; mất cả hai → 40 Hz; mất FT-100 → cân bằng khối lượng; mất AIT → cảnh báo, không dừng giả | mini PC còn chạy |
| 5 – Mất mạng | Chế độ (b): kịch bản đã lưu + biên áp; lệnh ghi đè hết hạn; bộ đệm trên SSD; SIM thứ hai; SMS; **quyền TAY từ xa tự hủy** | mất 4G |
| 6 – Mất Modbus tới biến tần | Biến tần giữ tần số cuối; > 10 s → mini PC chủ động ngừng xung sống để chuyển PID nội | mini PC còn chạy |
| 7 – Mini PC / IO-01 treo | WDR-01 nhả sau 5 s → biến tần bơm chính chạy PID nội 3,0 bar theo PT-101; bơm kia dừng; nếu đang dừng an toàn thì giữ dừng (K-SS); trung tâm phát hiện qua LWT sau ≈1 phút | **S11** |
| 8 – Mất phản hồi áp khi PID nội | Biến tần chạy tần số đặt sẵn 40–45 Hz (chốt khi chạy thử sao cho áp đêm ≤ 4,0 bar) | |
| 9 – Mất điện lưới | Bơm dừng; UPS-01 giữ mini PC, IO-01, router, cảm biến ≥ 4 h để đo, lưu, cảnh báo; có điện lại thì khởi động lệch nhau | |

\* khuyến nghị.

**Mất gì ở lớp 7?** Khi chỉ còn PID nội biến tần, các chức năng sau không còn:

- dừng an toàn theo chất lượng nước;
- ghép, tách và luân phiên bơm;
- áp đặt theo lưu lượng (áp cố định 3,0 bar tốn điện và tăng rò rỉ hơn);
- đo xa, SMS;
- màn HMI tại chỗ (HMI chỉ là trang web do mini PC phục vụ).

Vì vậy mini PC treo phải được khắc phục trong vài giờ (vật tư dự phòng DP-01: một mini PC đã nạp sẵn ảnh hệ thống).

## 7. Điều khiển bơm từ xa và tại chỗ (HMI)

Ngoài chế độ tự động theo kịch bản, người vận hành có thể chuyển trạm sang chế độ **TAY bằng phần mềm** để chạy hoặc dừng từng bơm, đặt tần số, đóng hoặc mở van MV-02. Có hai vị trí ra lệnh. Kịch bản S12 trình diễn cả hai.

| | Tại trạm – HMI-01 (hoặc laptop nối mạng OT của CP-02) | Trung tâm – SCADA (SRV-01) |
|---|---|---|
| Dữ liệu nhìn thấy | Trực tiếp từ gateway, thời gian thực; có chi tiết liên động | Chỉ những gì máy chủ nhận qua MQTT (chu kỳ 10 s); mất mạng thì đứng yên và gắn nhãn "dữ liệu cũ" |
| Đường lệnh | Đi thẳng vào GW-01, không hết hạn | Qua máy chủ → MQTT; lệnh tay có hạn **60 s**; mất mạng thì lệnh xếp hàng rồi hết hạn |
| Quyền | **Ưu tiên cao nhất**: thao tác tại chỗ giành quyền; lệnh từ xa bị từ chối khi tại chỗ đang giữ quyền | Có thời hạn (lease) 30 phút, mỗi lệnh gia hạn; hết hạn hoặc **mất kết nối thì trạm tự trở về TỰ ĐỘNG** |

Luôn đúng ở mọi vị trí:

- Lệnh tay vẫn đi qua **lớp an toàn** và **bộ quản lý bơm**: giới hạn áp cao (tần số tay bị hạ khi áp tới 4,0 bar), cắt áp rất cao, chống chạy khô, dừng an toàn chất lượng, tối đa 6 lần khởi động/giờ, nghỉ tối thiểu 60 s.
- Van MV-02 không mở hết thì **cấm chạy bơm** (điều kiện cho phép). Van mở lại thì bơm chạy tiếp theo lệnh tay.
- Cắt an toàn khi đang chạy tay (áp rất cao, mức rất thấp, dừng an toàn) thì bơm **không tự chạy lại**. Người vận hành phải ra lệnh mới.
- Báo động `MANUAL_MODE` luôn hiển thị ở cả hai phía để không ai quên trạm đang chạy tay.

Phân biệt với **công tắc cứng SA-01/02** trên cửa CP-01. Vị trí TAY của công tắc chạy bơm bằng bàn phím biến tần, hoàn toàn không qua mini PC; chỉ còn liên động cứng bảo vệ. Vị trí này dùng khi bảo trì hoặc khi mini PC và I/O cùng hỏng.

Giao thức của các lệnh `set_mode`, `pump_start`, `pump_stop`, `pump_speed`, `valve` ở [03-giao-thuc-truyen-thong.md](03-giao-thuc-truyen-thong.md).

## 8. Danh mục thiết bị (sinh tự động từ `config/components.json`)

<!-- BOM-START -->
### Hiện trạng nhà máy (đã có) – 16 hạng mục

| Mã | Thiết bị | Thay đổi | Ưu tiên | Vai trò | Giao tiếp với mini PC |
|---|---|---|---|---|---|
| `T-01` | Bể chứa nước sạch (bể ngầm/bán ngầm) | giữ nguyên | bắt buộc | Nguồn hút và bộ đệm thể tích/chất lượng của trạm. | Không nối trực tiếp; được đo bằng LT-101 (giải pháp) và phao LSLL-101 (hiện trạng). |
| `FV-01` | Van phao cấp nước vào bể | giữ nguyên | bắt buộc | Tự cấp nước vào bể theo mức, không cần điện. | Không nối mini PC. Trạng thái suy ra từ lưu lượng vào (FT-100 hoặc cân bằng khối lượng). |
| `VX-01` | Van xả đáy bể | giữ nguyên | bắt buộc | Xả cặn/súc rửa bể sau sự cố chất lượng. | Hiện trạng là van tay: kỹ thuật viên mở theo lệnh xả của trung tâm. Nếu lắp bộ truyền động VX-01A (khuyến nghị) thì điều khiển bằng DO của IO-01. |
| `P-01` | Bơm ly tâm trục ngang số 1 (5,5 kW) | giữ nguyên | bắt buộc | Bơm chính/dự phòng luân phiên; công suất thủy lực của trạm. | Gián tiếp qua biến tần VFD-01 (hiện trạng, cấu hình lại). |
| `P-02` | Bơm ly tâm trục ngang số 2 (5,5 kW) | giữ nguyên | bắt buộc | Bơm thứ hai: dự phòng nóng và ghép song song khi nhu cầu cao. | Gián tiếp qua biến tần VFD-02. |
| `VFD-01` | Biến tần bơm P-01 (hiện có) | cấu hình lại | bắt buộc | Điều khiển tốc độ bơm P-01 theo lệnh mini PC; PID nội làm dự phòng khi mini PC hỏng. | Modbus RTU (RS-485 COM1 của MPC-01, địa chỉ 1, 19 200 bps): ghi tần số đặt, đọc f, I, kW, kWh, mã lỗi. Lệnh chạy: DO IO-01 → SA-01 (TỰ ĐỘNG) → WDR-01 → đầu cực FWD. AI2 nhận PT-101 qua ISO-101 cho PID dự phòng. |
| `VFD-02` | Biến tần bơm P-02 (hiện có) | cấu hình lại | bắt buộc | Điều khiển tốc độ bơm P-02; nhận quyền PID nội nếu VFD-01 lỗi. | Modbus RTU COM1 địa chỉ 2; lệnh chạy qua SA-02 → WDR-01; AI2 nhận PT-101 qua ISO-101. |
| `CV-01/02` | Van một chiều sau bơm | giữ nguyên | bắt buộc | Ngăn dòng ngược qua bơm đang dừng. | Không nối mini PC. |
| `HV-01..04` | Van tay chặn hút và van đẩy từng bơm | giữ nguyên | bắt buộc | Van tay chặn hút/đẩy từng bơm để bảo trì. | Không nối mini PC. |
| `HT-01` | Bình tích áp màng (thủy khí) | giữ nguyên | nên có | Làm mềm dao động áp, cho phép bơm ngủ đông khi lưu lượng rất nhỏ. | Không nối mini PC (áp lực đo bằng PT-101/102). |
| `PSV-01` | Van an toàn cơ khí (xả về bể) | giữ nguyên | bắt buộc | Lớp bảo vệ cơ khí cuối cùng khi áp quá cao. | Không nối mini PC; trạng thái xả thấy được qua lưu lượng. |
| `PI-101/102` | Đồng hồ áp lực cơ trên ống đẩy từng bơm | giữ nguyên | nên có | Chỉ thị tại chỗ để đối chiếu với PT-101/102. | Không nối mini PC. |
| `FT-100` | Đồng hồ nước vào bể (Woltmann hiện có + đầu phát xung) | nâng cấp | nên có | Đo nước mua vào: cân bằng nước, dự báo thời gian cạn bể, phát hiện mất nguồn. | Xung → DI đếm xung của IO-01 (≥ 100 Hz), tính lưu lượng trượt 60 s. |
| `LSLL-101` | Phao chống cạn cơ khí (mạch cứng) | nâng cấp | bắt buộc | Chống chạy khô bằng mạch cứng, độc lập phần mềm. | Mạch cứng IL-01 trong CP-01 (tác động ở mọi chế độ Tay/Tự động/PID nội). Tiếp điểm phụ → DI IO-01 (chỉ để giám sát). |
| `CP-01` | Tủ động lực MCC hiện có (CP-01) | nâng cấp | bắt buộc | Tủ động lực hiện có: cấp điện và bảo vệ cho 2 bơm/biến tần. | Hàng kẹp X-IF sang CP-02: lệnh chạy, trạng thái, RS-485, 4–20 mA, nguồn 230 VAC cho CP-02. |
| `MANG-LUOI` | Mạng lưới phân phối khu dân cư A (DMA-A) | giữ nguyên | bắt buộc | Đối tượng phục vụ; áp tại điểm bất lợi là chỉ tiêu dịch vụ. | Không nối trực tiếp; logger PL-301 (khuyến nghị) gửi áp điểm bất lợi về trung tâm. |

### Giải pháp đưa vào (tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ) – 22 hạng mục

| Mã | Thiết bị | Thay đổi | Ưu tiên | Vai trò | Giao tiếp với mini PC |
|---|---|---|---|---|---|
| `MPC-01` | Mini PC công nghiệp không quạt (phần cứng edge gateway) | bổ sung mới | bắt buộc | Phần cứng edge gateway: tiếp nhận, xử lý, điều khiển tín hiệu tại chỗ; chạy GW-01 và web HMI. | LAN1 ↔ RT-01 (WAN). LAN2 ↔ SW-01 (mạng OT: IO-01, HMI-01). COM1 RS-485 cách ly ↔ VFD-01/02. COM2 RS-485 cách ly ↔ EM-101, AIT, FT-101. Nguồn 24 VDC từ UPS-01. |
| `GW-01` | Phần mềm edge gateway GW-01 (chạy trên MPC-01) | bổ sung mới | bắt buộc | Phần mềm edge gateway chạy trên MPC-01 (lõi đã mô phỏng trong dự án này). | Đọc/ghi I/O qua dịch vụ io/drive/meter; MQTT/TLS 8883 tới SRV-01; web HMI cho HMI-01. |
| `IO-01` | Mô-đun I/O từ xa Modbus TCP | bổ sung mới | bắt buộc | Mô-đun vào/ra từ xa: số hóa tín hiệu 4–20 mA, tiếp điểm, xung; xuất lệnh. | Modbus TCP qua SW-01 (chu kỳ 100–200 ms). Cấp nguồn vòng cho cảm biến 2 dây. |
| `CP-02` | Tủ điều khiển & truyền thông mới (CP-02) | bổ sung mới | bắt buộc | Tủ mới của giải pháp: tách thiết bị điện tử, truyền thông khỏi tủ động lực. | Cáp tín hiệu, RS-485 và nguồn 230 VAC từ CP-01 qua hàng kẹp X-IF. |
| `SW-01` | Switch Ethernet công nghiệp (mạng OT) | bổ sung mới | bắt buộc | Switch công nghiệp cho mạng OT trong tủ CP-02. | Nối MPC-01 (LAN2), IO-01, HMI-01, cổng bảo trì. |
| `RT-01` | Router 4G/LTE công nghiệp 2 SIM có SMS | bổ sung mới | bắt buộc | Kết nối 4G tới trung tâm; gửi SMS dự phòng khi mất IP. | Ethernet ↔ MPC-01 LAN1; API SMS của router. |
| `UPS-01` | Nguồn 24 VDC + DC-UPS + ắc quy | bổ sung mới | bắt buộc | Giữ mini PC, I/O, router, cảm biến ≥ 4 h khi mất điện lưới. | Tiếp điểm mất điện lưới / ắc quy yếu → DI IO-01. |
| `WDR-01` | Rơ-le watchdog (giám sát xung sống) lắp trong CP-01 | bổ sung mới | bắt buộc | Cắt quyền điều khiển của mini PC khi nó ngừng phát xung sống, chuyển biến tần sang PID nội. | Đầu vào: DO bán dẫn của IO-01 (xung 1 Hz). Đầu ra: DI chọn nguồn tần số của VFD-01/02, chuyển lệnh chạy sang mạch chọn bơm dự phòng. |
| `ISO-101` | Bộ cách ly và chia tín hiệu 4–20 mA | bổ sung mới | bắt buộc | Chia tín hiệu PT-101 cho cả IO-01 và PID nội của 2 biến tần; cách ly chống nhiễu. | PT-101 → ISO-101 (1 vào 3 ra) → IO-01 AI1, VFD-01 AI2, VFD-02 AI2. Các kênh khác dùng loại 1 vào 1 ra. |
| `SA-01/02` | Công tắc chọn chế độ, đèn báo, dừng khẩn | bổ sung mới | bắt buộc | Công tắc Tay/0/Tự động từng bơm, đèn báo và nút dừng khẩn trên cửa CP-01. | 2 DI/bơm (Tay, Tự động) → IO-01; đèn Chạy/Lỗi/Tự động/Dự phòng PID. |
| `PT-101` | Cảm biến áp lực đầu ra (điều khiển) | bổ sung mới | bắt buộc | Áp đầu ra cho vòng điều khiển PI và PID dự phòng của biến tần. | AI 4–20 mA 2 dây → ISO-101 → IO-01 AI1 (+ VFD-01/02 AI2). |
| `PT-102` | Cảm biến áp lực đầu ra (bảo vệ, dự phòng) | bổ sung mới | bắt buộc | Áp đầu ra cho lớp an toàn (cắt áp rất cao) và đối chiếu chéo với PT-101. | AI 4–20 mA → IO-01 AI2; điểm trích áp riêng. |
| `FT-101` | Đồng hồ lưu lượng điện từ đầu ra | bổ sung mới | bắt buộc | Lưu lượng ra mạng: đường đặt áp P_set(Q), dự báo, phát hiện rò rỉ đêm. | AI 4–20 mA → IO-01 AI3; tổng m³ qua Modbus RTU COM2. |
| `LT-101` | Cảm biến mức siêu âm | bổ sung mới | bắt buộc | Mức bể: dừng chống chạy khô theo kịch bản, tiết kiệm nước, dự báo thời gian cạn bể. | AI 4–20 mA → IO-01 AI4 qua chống sét tín hiệu. |
| `AIT-201` | Máy đo clo dư tự do (amperometric) | bổ sung mới | bắt buộc | Clo dư online: dừng an toàn khi < 0,2 mg/L (QCVN 01-1:2018/BYT). | AI 4–20 mA → IO-01 AI5 (hoặc Modbus RTU COM2); chỉ hợp lệ khi công tắc dòng mẫu FS-201 báo có nước. |
| `AIT-202` | Máy đo độ đục (nephelometric) | bổ sung mới | bắt buộc | Độ đục online: dừng an toàn khi > 2 NTU kéo dài 60 s. | AI 4–20 mA → IO-01 AI6. |
| `SP-201` | Panel lấy mẫu + công tắc dòng mẫu FS-201 | bổ sung mới | bắt buộc | Panel lấy mẫu liên tục cho máy phân tích, kèm công tắc dòng mẫu FS-201. | FS-201 → DI IO-01. |
| `EM-101` | Đồng hồ điện đa năng 3 pha có Modbus | bổ sung mới | bắt buộc | Đo điện năng toàn trạm: chỉ tiêu kWh/m³ và đường cơ sở trước cải tạo. | Modbus RTU COM2, địa chỉ 10–11; 3 biến dòng ở đầu tổng. |
| `KIT-01` | Bộ đo chất lượng nước cầm tay | bổ sung mới | bắt buộc | Bộ đo cầm tay clo dư (DPD), độ đục, pH để hiệu chuẩn máy online và nội kiểm. | Không nối mini PC; kết quả nhập vào HMI/nhật ký. |
| `SPD-01` | Chống sét lan truyền (nguồn, tín hiệu, ăng-ten) | bổ sung mới | bắt buộc | Chống sét lan truyền đường nguồn, tín hiệu và ăng-ten; nối đất đẳng thế. | Đầu vào 3 pha CP-01, đường 230 VAC sang CP-02, cáp tín hiệu LT-101/PT ngoài trời, ăng-ten RT-01. |
| `SRV-01` | Máy chủ điều hành & SCADA trung tâm (dùng chung ST-01…ST-04) | bổ sung mới | bắt buộc | Máy chủ điều hành trung tâm + SCADA: nhận dữ liệu, phát hành kịch bản, lệnh từ xa, cảnh báo tập trung. | MQTT broker + REST API; dashboard; giữ kịch bản retained, hàng đợi lệnh có thời hạn. |
| `SEC-01` | Hạ tầng an ninh mạng & quản lý thiết bị | bổ sung mới | bắt buộc | An ninh mạng và quản lý thiết bị: chứng chỉ X.509 từng trạm, VPN/APN riêng, cập nhật OTA ký số, sao lưu cấu hình. | Chạy trên MPC-01, RT-01 và SRV-01. |

### Khuyến nghị bổ sung (để vận hành trơn tru nhất) – 18 hạng mục

| Mã | Thiết bị | Thay đổi | Ưu tiên | Vai trò | Giao tiếp với mini PC |
|---|---|---|---|---|---|
| `AIT-203` | Máy đo pH (điện cực thủy tinh) | bổ sung mới | nên có | pH online: dừng an toàn khi ngoài 6,0–8,5; bù pH cho phép đo clo. | AI 4–20 mA → IO-01 AI7. |
| `MV-02` | Van điện đầu ra mạng lưới | bổ sung mới | nên có | Cách ly trạm khỏi mạng khi dừng an toàn; trình tự mở van trước – chạy bơm sau. | DO mở/đóng → bộ truyền động; DI vị trí mở/đóng → IO-01. Đóng hẳn → liên động cấm chạy bơm. |
| `HMI-01` | Màn hình cảm ứng HMI tại chỗ | bổ sung mới | nên có | Màn cảm ứng tại chỗ trên cửa CP-02 để kỹ thuật viên vận hành, xem báo động, điều khiển tay. | Ethernet qua SW-01, trình duyệt kiosk mở web HMI của MPC-01. |
| `PL-301` | Logger áp lực điểm bất lợi (NB-IoT/LTE-M) | bổ sung mới | nên có | Đo áp tại điểm bất lợi để hiệu chỉnh đường đặt áp và chứng minh chất lượng dịch vụ. | Không nối mini PC; gửi thẳng về SRV-01 mỗi 15 phút (gửi ngay khi < 1,2 bar). Trung tâm chỉnh p_crit_target, r_est. |
| `PSHH-101` | Công tắc áp cao cơ khí (mạch cứng) | bổ sung mới | nên có | Công tắc áp cao cơ khí cắt bơm bằng mạch cứng (≈ 4,8 bar). | Tiếp điểm NC trong chuỗi liên động IL-01 của CP-01; tiếp điểm phụ → DI IO-01. |
| `GSM-01` | Bộ báo động SMS độc lập | bổ sung mới | tùy chọn | Bộ báo động SMS độc lập có pin: báo "mất bộ điều khiển", mất điện, ngập. | DI từ WDR-01, UPS-01, LSH-01; SIM riêng. |
| `LSH-01` | Phao báo ngập phòng bơm | bổ sung mới | nên có | Phao báo ngập phòng bơm (vỡ ống trong trạm). | DI → IO-01 (và GSM-01). |
| `LSHH-101` | Phao báo tràn bể | bổ sung mới | tùy chọn | Phao báo tràn bể khi van phao FV-01 kẹt mở. | DI → IO-01. |
| `TH-01` | Giám sát nhiệt ẩm tủ + quạt/sưởi | bổ sung mới | nên có | Giám sát nhiệt độ/độ ẩm tủ, điều khiển quạt và sưởi chống ngưng tụ. | Modbus RTU COM2 hoặc DI cảnh báo. |
| `ZS-01` | Công tắc cửa trạm / nắp bể | bổ sung mới | nên có | Công tắc cửa trạm, cửa tủ, nắp bể – an ninh nguồn nước. | DI → IO-01; báo động khi mở ngoài lịch bảo trì. |
| `VX-01A` | Bộ truyền động điện van xả đáy | bổ sung mới | tùy chọn | Bộ truyền động điện cho van xả đáy để xả bể từ xa theo lệnh trung tâm. | DO mở/đóng + DI vị trí → IO-01. |
| `PT-100` | Cảm biến áp ống cấp đầu vào | bổ sung mới | tùy chọn | Áp ống cấp thành phố: phân biệt mất nguồn với van phao kẹt. | AI → IO-01 AI8. |
| `LT-102` | Cảm biến mức dự phòng (thủy tĩnh) | bổ sung mới | tùy chọn | Cảm biến mức thủy tĩnh dự phòng, đối chiếu chéo với LT-101. | AI → IO-01 kênh dự phòng. |
| `VT-01/02` | Cảm biến rung, nhiệt ổ bi bơm | bổ sung mới | tùy chọn | Rung và nhiệt độ ổ bi bơm – bảo trì theo tình trạng. | Modbus RTU hoặc AI. |
| `CAM-01` | Camera IP | bổ sung mới | tùy chọn | Camera IP quan sát trạm, xác nhận sự cố từ xa. | Ethernet, tách VLAN khỏi mạng OT. |
| `DOS-01` | Châm clo bổ sung tại trạm | bổ sung mới | tùy chọn | Bơm định lượng châm clo bổ sung (NaOCl) khi clo nguồn thấp kéo dài. | AO/xung từ IO-01 theo AIT-201. |
| `DP-01` | Vật tư dự phòng + mini PC dự phòng nguội | bổ sung mới | nên có | Bộ vật tư dự phòng: mini PC đã nạp sẵn ảnh hệ thống, cảm biến áp, cầu chì, rơ-le. | — |
| `GEN-01` | Điểm đấu máy phát và cầu dao đảo nguồn | bổ sung mới | tùy chọn | Điểm đấu máy phát di động + cầu dao đảo nguồn cho mất điện dài. | DI trạng thái nguồn → IO-01. |
<!-- BOM-END -->

## 9. Giá trị của từng thiết bị: mô phỏng "có lắp / không lắp"

Lệnh `python -m trambom options` chạy mỗi cặp hai lần. Hai lần dùng cùng kịch bản, cùng chuỗi nhiễu và chỉ khác `cfg["hardware"]`. Trong trình duyệt, tab **Thiết bị** có nút "So sánh trên Sx" làm việc tương tự bằng lõi JavaScript. Học viên tự thử bằng lệnh `python -m trambom run S5 --off PT-102`.

<!-- WHATIF-START -->
| Hạng mục (tắt đi để thử) | Kịch bản · mức | Chỉ số | Có lắp | Không lắp |
|---|---|---|---:|---:|
| **Rơ-le watchdog + PID nội biến tần** `VFD_PID_fallback` | S11 · cơ bản | Áp ngoài dải dịch vụ (phút) | 1 | 213 |
|  |  | Áp nhỏ nhất tại điểm bất lợi (bar) | 1,33 | 0,53 |
|  |  | Điện năng (kWh) | 52,4 | 48,5 |
| **Cảm biến áp lực thứ hai PT-102** `PT-102` | S5 · cơ bản | Áp đầu ra > 4,0 bar (phút) | 0 | 119 |
|  |  | Áp đầu ra lớn nhất (bar) | 4,16 | 4,56 |
|  |  | Thời gian phát hiện sự cố (phút) | 0,1 (PT_DEVIATION) | không phát hiện |
| **Cảm biến áp lực thứ hai PT-102** `PT-102` | S5 · nâng cao | Áp đầu ra > 4,0 bar (phút) | 0 | 0 |
|  |  | Áp ngoài dải dịch vụ (phút) | 0 | 1 |
|  |  | Thời gian phát hiện sự cố (phút) | 0,2 (PT_DEVIATION) | 0,5 (PT_STUCK_PT-101) |
| **Máy đo độ đục online AIT-202** `AIT-202` | S4 · cơ bản | Nước không đạt QCVN đã cấp (m³) | 0,4 | 28,3 |
|  |  | Thời gian phát hiện sự cố (phút) | 42,3 (NTU_WARN) | không phát hiện |
| **Máy đo clo dư online AIT-201** `AIT-201` | S9 · cơ bản | Nước không đạt QCVN đã cấp (m³) | 1,4 | 26,4 |
|  |  | Thời gian phát hiện sự cố (phút) | 415,8 (CL_WARN) | không phát hiện |
| **Modem 4G có SMS dự phòng** `SMS` | S9 · cơ bản | Báo động nghiêm trọng tới người trực chậm nhất (phút) | 0,0 | 294,8 |
| **Đầu ra xung của đồng hồ nước vào FT-100** `FT-100_pulse` | S6 · nâng cao | Thời gian phát hiện sự cố (phút) | 27,0 (TTE_LOW) | 26,0 (SUPPLY_LOST) |
|  |  | Áp ngoài dải dịch vụ (phút) | 487 | 487 |
<!-- WHATIF-END -->

Đọc kết quả:

- **Rơ-le watchdog + PID nội biến tần** biến 6 giờ mini PC treo từ 213 phút áp thấp tại điểm bất lợi thành gần như không ảnh hưởng. Đây là khoản đầu tư rẻ mà hiệu quả lớn nhất cho độ tin cậy.
  - Điện năng cao hơn phương án "I/O giữ lệnh cuối" 3,9 kWh, vì PID nội giữ đủ 3,0 bar trong giờ cao điểm thay vì để áp tụt.
  - So với lúc mini PC chạy bình thường, áp cố định tốn điện và tăng rò rỉ hơn áp theo lưu lượng.
- **PT-102** quan trọng nhất ở mức cơ bản. Mức nâng cao còn phát hiện được cảm biến kẹt nhờ kiểm tra giá trị đứng yên và mô hình bơm, nhưng không còn cảm biến nào để điều khiển nên phải chạy 40 Hz an toàn.
- **AIT-201/202** quyết định toàn bộ khả năng "dừng an toàn theo chất lượng". Thiếu máy đo, trạm thông minh cũng mù như phương án lịch cố định.
- **SMS** không làm thay đổi vận hành. Nó rút thời gian người trực biết sự cố khẩn từ ≈5 giờ (chờ có mạng lại) xuống vài giây.
- **Đầu xung FT-100** gần như không đổi kết quả, vì gateway ước lượng lưu lượng vào bằng cân bằng khối lượng từ LT-101 và FT-101 (**dư thừa phân tích**). Vì thế FT-100 chỉ xếp "nên có". Giá trị thật của nó là đối soát lượng nước mua vào và phát hiện rò rỉ bể; mô phỏng không mô hình hai việc này.

## 10. Để hệ thống vận hành trơn tru: lộ trình triển khai

1. **Khảo sát.**
   - Ghi model và firmware biến tần: có Modbus, có PID nội, có chọn nguồn tần số bằng tiếp điểm hay không.
   - Đo cường độ sóng 4G của hai nhà mạng.
   - Kiểm tra phao, van an toàn và đồng hồ FT-100.
2. **Đo đường cơ sở 2–4 tuần.** Lắp EM-101, FT-101, các PT trước và cho mini PC chạy chế độ chỉ đọc.
   - Dữ liệu dùng để so sánh với cách vận hành hiện tại.
   - Đồng thời hiệu chỉnh mô hình mô phỏng: H0, K, r_est, hồ sơ nhu cầu 168 h.
3. **Thử nghiệm xuất xưởng (FAT) kiểu HIL.** Mini PC và IO-01 thật nối với "trạm ảo" là bộ mô phỏng này qua Modbus. Chạy S1–S12 và các bài tiêm lỗi; ngắt mạng thật bằng tường lửa.
4. **Thử nghiệm hiện trường (SAT)** theo danh sách kiểm tra:
   - bơm dòng 4/12/20 mA vào từng kênh;
   - thử từng liên động (nhấc phao, nhấn dừng khẩn);
   - dừng dịch vụ điều khiển để kiểm tra WDR-01 chuyển sang PID nội trong ≤ 10 s;
   - cắt điện lưới để thử UPS và khởi động lệch;
   - rút SIM để thử mất mạng;
   - thử gửi SMS;
   - thử điều khiển tay tại chỗ và từ xa (S12).
5. **Chạy song song 2–4 tuần, chuyển quyền từng bước.**
   - Mini PC tính lệnh nhưng biến tần vẫn chạy theo lịch cũ.
   - Sau đó chuyển quyền ban đêm trước, cao điểm sau.
   - Chạy kịch bản ngưỡng trước; sau ≥ 2 tuần dữ liệu ổn định mới bật ngủ đông và kịch bản dự báo.
   - Giữ lượt kiểm tra 07:30 và 16:30 trong 3 tháng đầu.
6. **Hiệu chuẩn và bảo trì.**
   - Clo: so với bộ thử DPD hằng tuần (hằng ngày trong tháng đầu); chỉnh khi lệch > 0,05 mg/L.
   - Độ đục: vệ sinh buồng đo 2–4 tuần/lần.
   - pH: hiệu chuẩn 2 điểm mỗi 1–2 tháng.
   - PT-101/102: so với đồng hồ chuẩn hằng năm, và ngay khi lệch chéo > 0,3 bar.
   - LT-101: so với thước đo tay.
   - Phao LSLL: thử hằng tháng.
   - WDR-01: thử hằng quý.
   - UPS: thử xả hằng năm; thay ắc quy AGM sau 3–5 năm.
   - SPD: kiểm tra trước mùa mưa bão.
   - Máy đo online **không thay thế** xét nghiệm định kỳ theo QCVN 01-1:2018/BYT.
7. **An ninh mạng (SEC-01).**
   - Trạm chỉ kết nối ra ngoài, dùng APN riêng hoặc VPN.
   - Mỗi trạm có chứng chỉ X.509 riêng, khóa lưu trong TPM; ACL theo chủ đề MQTT.
   - Kịch bản điều khiển có chữ ký số.
   - Đổi mọi mật khẩu mặc định; tách WAN khỏi mạng OT.
   - Áp dụng nguyên tắc IEC 62443 và phân loại cấp độ an toàn hệ thống thông tin theo quy định hiện hành.
8. **Vận hành.**
   - Chỉ báo động khẩn mới gửi SMS (ISA-18.2).
   - Định kỳ rà soát các thay đổi tại HMI và các xung đột khi hợp nhất kịch bản.
   - Lập hồ sơ hoàn công, quy trình vận hành chuẩn và danh mục vật tư dự phòng DP-01.

## 11. Bài tập gợi ý (Bloom: Áp dụng, Phân tích · DOK 3)

1. **Ngân sách giới hạn.** Chỉ được chọn 3 trong số các hạng mục khuyến nghị cho ST-01.
   - Dựa vào mục 9 và cột "Nếu không có", chọn và bảo vệ lựa chọn bằng số liệu mô phỏng.
   - Chạy thêm `python -m trambom run S5 --off PT-102 --level advanced` để kiểm tra lập luận.
2. **Chọn điểm đặt PID dự phòng.** Sửa `fallback.p_set_bar` trong `config/station.json` thành 2,6 và 3,4 bar, chạy S11.
   - Giải thích vì sao điểm đặt phải đủ cho giờ cao điểm với **một bơm**, nhưng không được quá cao vào ban đêm.
3. **Mini PC hay PLC?** Lập bảng so sánh hai kiến trúc ở mục 4 (mini PC đơn; PLC + mini PC) theo 5 tiêu chí: độ tin cậy, chi phí, khả năng dự báo/học, an ninh mạng, kỹ năng bảo trì của đơn vị cấp nước.
4. **Quyền điều khiển.** Trong S12, mất 4G lúc 13:30 khi trung tâm đang điều khiển tay.
   - Mô tả điều gì sẽ xảy ra nếu gateway **giữ** lệnh tay cuối cùng thay vì trở về tự động.
   - Đề xuất quy tắc khác và phân tích rủi ro.
