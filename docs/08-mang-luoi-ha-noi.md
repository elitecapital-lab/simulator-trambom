# 08 – Mạng lưới trạm bơm SYSTEM tại Hà Nội (màn "Mạng lưới")

Bản web mở đầu bằng **màn Mạng lưới**: trung tâm giám sát của SYSTEM nhìn toàn bộ 16 trạm bơm tăng áp giả lập ở Hà Nội. Mỗi trạm
là một mô phỏng đầy đủ (vật lý, cảm biến, edge gateway, lớp an toàn, đường truyền 4G) và cùng báo về **một máy chủ** – nên các số đo
trên màn này là bản đo xa mà trung tâm *thực sự* nhận được (đứng yên khi trạm mất mạng), không phải số tô vẽ. Nhấp vào một trạm để xuống màn chi tiết 3D hoặc
HMI y như bản một trạm.

> Toàn bộ vị trí, số hộ, sự cố là **dữ liệu giả lập để trình diễn** (khu vực chỉ mang tính minh họa, không phải điểm triển khai
> thật). Tuyến ống là sơ đồ minh họa, không phải bản vẽ hạ tầng cấp nước thật. Nền cách điệu (khi không có OpenStreetMap) không theo tỉ lệ.

![Màn Mạng lưới – bản đồ Hà Nội, trạm ST-09 đang dừng an toàn do nước nguồn đục](ket-qua/img/mang-luoi-ban-do.png)

## Mở và điều hướng

| Muốn | Thao tác |
|---|---|
| Vào màn Mạng lưới | Mở `…/web/` (mặc định), nút **Mạng lưới** trên thanh trên, hoặc bấm logo SYSTEM |
| Mở thẳng một trạm | `…/web/#ST-05` (3D), `…/web/#ST-05-hmi` (HMI); mở toàn mạng: `#H1` hoặc `#fleet` |
| Mở bài học một trạm như trước | `…/web/#S4-advanced` (các bài S0…S13 vẫn chạy trên ST-01) |
| Xem chi tiết trạm | Bản đồ: nhấp marker rồi **Mở mô phỏng 3D** / **Mở HMI** (hoặc nhấp đúp marker); danh sách: nhấp đúp dòng |
| Đổi trạm khi đang xem chi tiết | Ô chọn trạm và hai nút ‹ › trên thanh trên |
| Gây sự cố để xem hệ thống phản ứng | Thẻ trạm trên bản đồ → **Giả lập sự cố tại trạm này**, hoặc mục **Sự cố** ở màn chi tiết |

Tốc độ mặc định ×300 (1 giờ mô phỏng ≈ 12 giây) để thấy hết kịch bản sự cố trong vài phút; chỉnh bằng dải ×1…×3600 trên thanh trên.

## Năm màn

1. **Bản đồ** – mỗi trạm một marker: xanh bình thường, vàng cảnh báo, đỏ báo động (có vòng nhấp nháy), xanh dương đang đồng bộ,
   xám mất kết nối (dấu ✕). Tô màu theo *Trạng thái / Áp lực / Lưu lượng / Công suất / Mức bể*. Kéo để dời, lăn chuột hoặc nút +/− để
   phóng. Cột phải liệt kê trạm (trạm cần chú ý lên đầu, kèm lý do) và thẻ trạm đang chọn (số đo, đường áp 6 giờ, chế độ, kịch bản,
   nút mở chi tiết). Ba lớp bật/tắt ở góc trên trái:
   - **Đường ống** – mạng ống truyền tải minh họa (ống chính đông–tây, ba trục bắc–nam, nhánh vuông góc vào từng trạm) vẽ như sơ đồ
     đường ống: vỏ và lõi ống, mối nối, van trên mỗi nhánh, dòng chảy chạy theo hướng nước. Tốc độ dòng theo lưu lượng nước vào bể của
     trạm; nguồn ngừng cấp (ví dụ ST-12 mất nước nguồn) thì nhánh chuyển xám, "cạn".
   - **Liên kết dữ liệu** – đường đo xa 4G từ trạm về trung tâm; mặc định chỉ hiện của trạm đang chọn (mất mạng: đỏ đứt).
   - **Nền OpenStreetMap** – ô bản đồ mã nguồn mở © OpenStreetMap contributors (Web Mercator nên marker trùng khít nền). Cần Internet;
     không tải được (không mạng, trang nhúng chặn ảnh ngoài) thì tự dùng sơ đồ cách điệu (sông Hồng, sông Đuống, hồ Tây…) và báo một dòng.
2. **Danh sách trạm** – bảng 16 trạm: trạng thái, chế độ gateway (a/b/c/d), áp, lưu lượng, mức bể, công suất, clo/đục/pH, tiết kiệm
   điện so với lịch cố định, báo động, đường áp 6 giờ. Lọc theo trạng thái, tìm kiếm, sắp theo cột.
3. **Báo động & tự xử lý** – báo động tập trung (xác nhận, "Đặt lại" dừng an toàn) và dòng sự kiện "hệ thống đã tự xử lý": tự chuyển
   bơm dự phòng, dừng an toàn, tự vận hành khi mất mạng, PID nội biến tần khi mini PC treo, đồng bộ lại, lệnh từ trung tâm. Các thẻ
   tổng hợp cho biết bao nhiêu báo động tự hết, bao nhiêu cần điều độ viên, các trạm đã tự vận hành bao nhiêu phút và số bản ghi đệm
   được phát lại đủ.
4. **Hiệu quả** – điện năng tiết kiệm (kWh, %, tiền theo giá giả định), suất điện năng, rò rỉ, thời gian đạt dải áp, thời gian phát hiện
   sự cố so với lịch cố định; biểu đồ công suất, lưu lượng, số trạm đạt dải áp toàn mạng; xếp hạng tiết kiệm theo trạm.
5. **Kịch bản & triển khai** – phát hành kịch bản từ trung tâm tới tất cả / các trạm đã chọn / các trạm bình thường: đổi sang điều khiển dự
   báo, hạ áp đặt tối đa, tăng biên áp khi mất mạng, hoặc **thử giá trị sai** để thấy gateway từ chối. Bảng cho biết từng trạm đã áp
   dụng phiên bản nào; trạm đang mất mạng nhận khi đồng bộ lại (bản tin retained).

![Báo động tập trung và dòng sự kiện "hệ thống đã tự xử lý"](ket-qua/img/mang-luoi-bao-dong.png)

Nhấp một trạm để xuống màn chi tiết – cảnh 3D (có bảng hiệu SYSTEM trên tường trạm), HMI SCADA và mọi bảng như bản một trạm:

![Chi tiết 3D của ST-09: dừng an toàn do độ đục](ket-qua/img/mang-luoi-chi-tiet-3d.png)

## Kịch bản H1 – sự cố rải trên nhiều trạm

Mỗi trạm tự xử lý tại chỗ; trung tâm chỉ theo dõi và can thiệp khi cần. Mốc giờ tính từ lúc bắt đầu (Thứ Hai 00:00).

| Giờ | Trạm | Sự cố |
|---:|---|---|
| 0,6 h | ST-06 · Xuân Đỉnh | Mất kết nối 4G → chế độ (b), đệm dữ liệu; 2,8 h có lại → đồng bộ (c) |
| 1,2 h | ST-14 · Ngọc Thụy | Vỡ ống nhánh 9 m³/h (đến 5,5 h) |
| 2,5 h | ST-11 · Cổ Loa | Cảm biến áp PT-101 kẹt (sửa 4,5 h) |
| 3,2 h | ST-13 · Tây Mỗ | Hỏng bơm P-01 → chuyển P-02 (sửa 8 h) |
| 4 h | ST-04 · Văn Quán | Mini PC treo → watchdog, PID nội biến tần; 6,5 h khởi động lại |
| 5 h | ST-09 · Vĩnh Tuy | Nước nguồn đục 15 NTU (đến 8 h) → dừng an toàn; 8,5 h trung tâm xả bể, 10,5 h đặt lại |
| 5 h | ST-16 · Láng Hạ | Mất kết nối 4G (đến 9 h) |
| 6 h | ST-02 · Dịch Vọng | pH nguồn 4,8 (đến 13 h) |
| 7 h | ST-08 · Khương Đình | Nhu cầu tăng ×1,6 (đến 9 h) |
| 8 h | ST-12 · Thanh Liệt | Mất nước nguồn (đến 12 h) |
| 8 h | ST-03 · Việt Hưng | pH nguồn 9,8 (đến 16 h) |
| 10 h | ST-05 · Mỹ Đình | Hỏng bơm P-02 (sửa 13 h) |
| 11 h | ST-10 · Trâu Quỳ | Mất kết nối 4G (đến 14 h) |

Các bài học S0…S13 không có sự cố nền này: chúng chạy riêng trên ST-01 như cũ, các trạm khác vẫn được mô phỏng nhưng không có sự cố.

## Dữ liệu: `config/hanoi.json`

- `sites[]` – mỗi trạm: `id`, `area` (khu vực), `district`, `kind`, `zone` (DMA), `lat`/`lon`, `demand_scale`, `dz_crit_m`, `seed_offset`,
  `households`. **ST-01…ST-04 giữ đúng tham số vật lý trong `station.json`** (kiểm thử `tests/test_fleet_js.py`), nên kết quả bài học
  và tài liệu cũ không đổi.
- `scenario` – kịch bản H1 (mỗi sự kiện có thêm trường `station`).
- `map` – hộp kinh/vĩ độ của bản đồ; `tariff_vnd_per_kwh` – giá điện bình quân **giả định** để quy đổi tiền.

Bản web ghép `hanoi.json` vào cấu hình bằng `web/js/sim/fleet.js` (`applyFleet`). Lõi Python và `station.json` giữ nguyên (4 trạm), nên
`python -m trambom …` không đổi. Thêm một trạm: thêm một mục vào `sites[]` với `id` mới, `seed_offset` riêng, toạ độ trong `map`.

## Giả định và giới hạn

- Nền OpenStreetMap chỉ hiện khi trình duyệt tải được ô bản đồ từ `tile.openstreetmap.org` (chạy cục bộ có Internet). Bản nhúng vào trang
  chặn ảnh ngoài (ví dụ artifact của claude.ai) luôn dùng nền cách điệu. Ô bản đồ tải khi xem, không lưu trong kho mã; tuân thủ
  [chính sách ô bản đồ OSM](https://operations.osmfoundation.org/policies/tiles/) (dùng nhẹ, có ghi công).
- Các trạm cùng một kiểu (2 bơm 5,5 kW, bể ≈ 190 m³); khác nhau ở nhu cầu, độ cao điểm bất lợi và hạt giống ngẫu nhiên.
- Số đo lấy từ bản đo xa MQTT (chu kỳ 10 s). Hai thông tin đi đường khác: áp điểm bất lợi do logger NB-IoT PL-301 đo (độc lập với 4G
  của gateway) và việc "mini PC ngừng" (router 4G còn sống nhưng không còn nhịp tim MQTT).
- "Tiết kiệm điện" so với lịch cố định chạy song song, chỉ hiện sau 6 giờ mô phỏng (lịch cố định tắt bơm ban đêm nên vài giờ đầu cho tỉ lệ vô nghĩa); có thể âm ở trạm mà lịch cố định ngừng cấp nước do sự cố (tốn ít điện hơn nhưng mất dịch vụ).
- Tiền điện chỉ để minh họa; mô hình chưa có giá điện theo giờ.
