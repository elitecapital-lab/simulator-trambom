"""trambom – Mô phỏng hệ thống điều khiển tự động thông minh cho trạm bơm tăng áp.

Các mô-đun chính:
    physics   – mô hình vật lý: bơm + biến tần, bể chứa, bình tích áp, mạng lưới, chất lượng nước
    sensors   – mô hình cảm biến (nhiễu, trễ, lỗi)
    gateway   – edge gateway: thu thập, kiểm tra tín hiệu, lớp an toàn, kịch bản điều khiển, đồng bộ
    server    – máy chủ điều hành: kho kịch bản, hàng đợi lệnh, hợp nhất xung đột, cảnh báo tập trung
    baseline  – phương án so sánh: lịch cố định vận hành thủ công
    engine    – ghép các thành phần, chạy song song hai phương án (twin)
    network   – tích hợp nhiều trạm trong mạng lưới cấp nước
"""
__version__ = "1.0.0"
