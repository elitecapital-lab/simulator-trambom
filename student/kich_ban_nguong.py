"""BÀI TẬP CƠ BẢN – Hoàn thiện kịch bản điều khiển theo ngưỡng cho edge gateway.

Chạy thử:     python -m trambom run S1 --script student/kich_ban_nguong.py
Tự chấm:      python -m trambom check-student student/kich_ban_nguong.py

Gateway gọi hàm dieu_khien() mỗi chu kỳ quét (1 s). Lớp an toàn vẫn luôn hoạt động phía sau:
dù kịch bản của bạn sai, gateway vẫn cắt bơm khi áp rất cao, mực nước rất thấp (0,5 m) hoặc chất lượng
nước vượt QCVN. Nếu hàm ném ngoại lệ, gateway chuyển về kịch bản dựng sẵn (xem nhật ký).

inp   – số đo đã kiểm tra hợp lệ:
        t (s), hour (0–24), dow (0 = Thứ Hai), dt (s)
        p      áp lực đầu ra đã lọc (bar) – có thể là None nếu mất tín hiệu
        q      lưu lượng ra mạng đã lọc (m³/h)
        level  mực nước bể (m),  q_in lưu lượng vào bể (m³/h)
        cl, ntu, ph – chất lượng nước (None nếu cảm biến lỗi)
        online – True nếu còn kết nối máy chủ
        pumps  – danh sách 2 bơm: {"running", "f", "fault", "run_s", "starts", "kw"}
        duty   – bơm chính do gateway đề xuất (0 hoặc 1)
mem   – dict lưu trạng thái của bạn giữa các chu kỳ (ban đầu rỗng)
params – tham số kịch bản (config/station.json → script.params), ví dụ params["pressure"]["kp_hz_per_bar"]

Trả về dict:
        n_pumps  – số bơm cần chạy (0, 1, 2)
        f_ref    – tần số đặt chung cho các bơm đang chạy (25–50 Hz)
        p_set    – áp lực đặt (bar) để hiển thị/ghi nhận
        order    – thứ tự ưu tiên bơm, ví dụ [0, 1] nghĩa là P-01 là bơm chính
"""

F_MIN, F_MAX = 25.0, 50.0


def dieu_khien(inp, mem, params):
    pr = params["pressure"]
    q = inp["q"] or 0.0

    # TODO 1 – Áp lực đặt theo lưu lượng: P_set = p_crit_target + dz + r_est·Q²,
    #          kẹp trong [p_set_min_bar, p_set_max_bar]. Khi mất mạng (inp["online"] False) cộng thêm
    #          params["offline"]["margin_bar"]. Khi mức bể < params["level"]["conserve_m"] giảm áp theo
    #          conserve_delta_bar nhưng không thấp hơn p_set_conserve_min_bar.
    p_set = 3.0

    # TODO 2 – Dừng bơm khi mức < params["level"]["stop_m"], chỉ chạy lại khi mức > restart_m (có trễ).
    #          Gợi ý: lưu cờ mem["dung_muc"].

    # TODO 3 – Bộ điều khiển PI: e = p_set − p; f = kp·e + I; I += kp·dt/ti·e
    #          Chống bão hòa tích phân: không tích phân khi f đã chạm F_MAX mà e > 0 (hoặc F_MIN mà e < 0).
    #          Nếu inp["p"] là None (mất tín hiệu áp), chạy tần số an toàn 40 Hz.
    f_ref = 40.0

    # TODO 4 – Ghép bơm thứ hai khi f_ref ≥ params["staging"]["f_on_hz"] và áp thiếu > err_on_bar
    #          liên tục t_on_s giây; tách bơm khi f_ref ≤ f_off_hz liên tục t_off_s giây.
    n_pumps = 1

    # TODO 5 – Luân phiên bơm: đổi bơm chính sau mỗi params["alternation"]["runtime_h"] giờ chạy.
    #          Bỏ qua bơm có inp["pumps"][i]["fault"] = True.
    order = [0, 1]

    return {"n_pumps": n_pumps, "f_ref": f_ref, "p_set": p_set, "order": order}
