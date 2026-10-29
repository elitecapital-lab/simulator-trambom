"""Sinh docs/02-thanh-phan-va-tham-so.md từ config/components.json và config/station.json, và cập nhật
các bảng tự động (danh mục thiết bị, kết quả "có lắp / không lắp") trong docs/07-hien-trang-va-giai-phap.md
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


SCOPE = [("hien_trang", "Hiện trạng nhà máy (đã có)"), ("giai_phap", "Giải pháp đưa vào (tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ)"),
         ("khuyen_nghi", "Khuyến nghị bổ sung (để vận hành trơn tru nhất)")]
CHANGE = {"giu_nguyen": "giữ nguyên", "cau_hinh_lai": "cấu hình lại", "nang_cap": "nâng cấp", "bo_sung": "bổ sung mới", "thay_the": "thay thế"}
PRIO = {"bat_buoc": "bắt buộc", "nen_co": "nên có", "tuy_chon": "tùy chọn"}
FIELDS = [("role", "Vai trò"), ("interface", "Giao tiếp với mini PC"), ("spec", "Thông số điển hình"), ("if_missing", "Nếu không có"),
          ("fallback", "Khi hỏng / dự phòng"), ("sim", "Thử trong mô phỏng")]
vn = lambda x: re.sub(r"(\d)\.(\d)", r"\1,\2", x)
cell = lambda x: (x or "").replace("|", "/").replace("\n", " ")


def bom_md(comps):
    out = []
    for key, title in SCOPE:
        items = [c for c in comps if c.get("scope") == key]
        out += ["### %s – %d hạng mục" % (title, len(items)), "", "| Mã | Thiết bị | Thay đổi | Ưu tiên | Vai trò | Giao tiếp với mini PC |", "|---|---|---|---|---|---|"]
        for c in items:
            out.append("| `%s` | %s | %s | %s | %s | %s |" % (c["tag"], cell(c["name"]), CHANGE.get(c.get("change"), ""), PRIO.get(c.get("priority"), ""),
                                                        cell(c.get("role")), cell(c.get("interface"))))
        out.append("")
    return out


def whatif_md():
    path = os.path.join(ROOT, "docs", "ket-qua", "whatif.json")
    if not os.path.exists(path):
        return ["_Chưa có kết quả – chạy `python -m trambom options`._"]
    from trambom.whatif import table_md
    with open(path, encoding="utf-8") as f:
        return [table_md(json.load(f))]


def inject(path, marker, lines):
    with open(path, encoding="utf-8") as f:
        txt = f.read()
    a, b = "<!-- %s-START -->" % marker, "<!-- %s-END -->" % marker
    i, j = txt.index(a) + len(a), txt.index(b)
    txt = txt[:i] + "\n" + "\n".join(lines).rstrip() + "\n" + txt[j:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(txt)


def main():
    comps = load_json("components.json")["components"]
    cfg = load_json("station.json")
    out = [HEAD, "Mỗi thiết bị được gắn nhãn phạm vi: **hiện trạng** (nhà máy đã có), **giải pháp** (đưa vào để tiếp nhận – xử lý – điều khiển "
           "tín hiệu tại chỗ bằng mini PC) hoặc **khuyến nghị** (nên có để vận hành trơn tru). Bảng tổng hợp, sơ đồ đấu nối và phân tích "
           "\"nếu không lắp\" ở [07-hien-trang-va-giai-phap.md](07-hien-trang-va-giai-phap.md).", "", "## Danh mục thành phần", ""]
    for key, title in SCOPE:
        items = [c for c in comps if c.get("scope") == key]
        out += ["### " + title, ""]
        for c in items:
            out += ["#### %s · %s" % (c["tag"], c["name"]), "",
                    "*%s · %s · %s · nhóm %s*" % (dict(SCOPE)[key].split(" (")[0], CHANGE.get(c.get("change"), ""), PRIO.get(c.get("priority"), ""), c["group"].lower()), "",
                    c["desc"], ""]
            rows = [(lbl, c[k]) for k, lbl in FIELDS if c.get(k)]
            if rows:
                out += ["| Mục | Nội dung |", "|---|---|"] + ["| %s | %s |" % (lbl, cell(v)) for lbl, v in rows] + [""]
            if c["params"]:
                out += ["| Tham số | Giá trị | Đơn vị |", "|---|---:|---|"]
                for k, v, u in c["params"]:
                    out.append("| %s | %s | %s |" % (k, v, u))
                out.append("")
            if c.get("range"):
                out += ["**Dải làm việc:** " + c["range"], ""]
    out += ["## Bảng ngưỡng tham số", "", "| Tham số | Ngưỡng | Ghi chú |", "|---|---|---|"]
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
    d7 = os.path.join(ROOT, "docs", "07-hien-trang-va-giai-phap.md")
    if os.path.exists(d7):
        inject(d7, "BOM", bom_md(comps))
        inject(d7, "WHATIF", whatif_md())
        print("Đã cập nhật bảng tự động trong", d7)


if __name__ == "__main__":
    main()
