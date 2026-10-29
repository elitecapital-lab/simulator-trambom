"""Sinh docs/02-thanh-phan-va-tham-so.md từ config/components.json và config/station.json
để tài liệu luôn khớp với tham số mô phỏng.   python tools/gen_docs.py"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from trambom.__main__ import threshold_rows  # noqa: E402
from trambom.util import load_json  # noqa: E402

HEAD = """# Thành phần trạm bơm, tham số vật lý và dải làm việc

> Tệp này được sinh tự động bởi `python tools/gen_docs.py` từ `config/components.json` và `config/station.json`.
> Sửa tham số ở file cấu hình rồi chạy lại lệnh để cập nhật tài liệu.

Trạm ST-01 phục vụ khu dân cư A (≈2.400 người, 160 L/người/ngày, nhu cầu trung bình 16 m³/h, giờ cao điểm
≈28–34 m³/h). Trạm không có người trực; công nhân đi kiểm tra theo lượt (07:30 và 16:30 trong phương án lịch cố định).

"""

MODEL = r"""
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
"""


def main():
    comps = load_json("components.json")["components"]
    cfg = load_json("station.json")
    out = [HEAD, "## Danh mục thành phần", ""]
    groups = []
    for c in comps:
        if c["group"] not in groups:
            groups.append(c["group"])
    for g in groups:
        out += ["### " + g, ""]
        for c in [c for c in comps if c["group"] == g]:
            out += ["#### %s · %s" % (c["tag"], c["name"]), "", c["desc"], "",
                    "| Tham số | Giá trị | Đơn vị |", "|---|---:|---|"]
            for k, v, u in c["params"]:
                out.append("| %s | %s | %s |" % (k, v, u))
            out += ["", "**Dải làm việc:** " + c["range"], ""]
    out += ["## Bảng ngưỡng tham số", "", "| Tham số | Ngưỡng | Ghi chú |", "|---|---|---|"]
    vn = lambda x: re.sub(r"(\d)\.(\d)", r"\1,\2", x)
    for name, val, note in threshold_rows(cfg):
        out.append("| %s | %s | %s |" % (name, vn(val), vn(note)))
    out += ["", "Giới hạn chất lượng nước theo QCVN 01-1:2018/BYT (ban hành kèm Thông tư 41/2018/TT-BYT): clo dư tự do "
            "0,2–1,0 mg/L, độ đục ≤ 2 NTU, pH 6,0–8,5. Ngưỡng áp lực dịch vụ (1,4 bar tại điểm bất lợi, tối đa 4,0 bar) là giả định "
            "học tập, tham khảo cách xác định áp lực tự do theo số tầng nhà trong TCXDVN 33:2006 và TCVN 13606:2023. "
            "Khi áp dụng thực tế cần đối chiếu văn bản gốc và quy chuẩn địa phương đang có hiệu lực.", "", MODEL]
    path = os.path.join(ROOT, "docs", "02-thanh-phan-va-tham-so.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("Đã ghi", path)


if __name__ == "__main__":
    main()
