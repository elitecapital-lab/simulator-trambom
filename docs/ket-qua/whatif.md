# Giá trị của từng thiết bị: có lắp / không lắp

Sinh tự động bởi `python -m trambom options`.

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
