"""Phương án so sánh: vận hành thủ công theo lịch cố định.

- Bơm chạy tần số 50 Hz (biến tần chỉ dùng như khởi động mềm), van đẩy mở một phần theo kinh nghiệm.
- Số bơm theo khung giờ cố định, không phụ thuộc nhu cầu thực tế.
- Bơm chính đổi theo ngày chẵn/lẻ.
- Không có giám sát chất lượng nước tự động; sự cố chỉ được phát hiện khi công nhân đi kiểm tra.
- Có phao chống cạn cơ khí (mạch cứng) nếu float_protection = true.
"""


class FixedSchedule:
    def __init__(self, cfg):
        self.b = cfg["baseline"]
        self.n_pumps = len(cfg["pumps"])
        self.known_fault = [False] * self.n_pumps
        self.rounds_done = set()
        self.observations = []

    def n_required(self, t):
        hour = (t % 86400) / 3600.0
        n = 0
        for w in self.b["windows"]:
            if w["start_h"] <= hour < w["end_h"]:
                n = max(n, w["pumps"])
        return n

    def operator_round(self, t, plant):
        """Lượt kiểm tra của công nhân vận hành: chỉ nhận ra lỗi bơm và mức bể bất thường."""
        day = int(t // 86400)
        hour = (t % 86400) / 3600.0
        for i, rh in enumerate(self.b["operator_rounds_h"]):
            key = (day, i)
            if hour >= rh and key not in self.rounds_done:
                self.rounds_done.add(key)
                found = []
                for k, pu in enumerate(plant.pumps):
                    if pu.fault and not self.known_fault[k]:
                        self.known_fault[k] = True
                        found.append("pump_fault")
                    if not pu.fault and self.known_fault[k]:
                        self.known_fault[k] = False
                if plant.level < 1.2:
                    found.append("supply")
                self.observations.append({"t": t, "found": found})
                return found
        return []

    def step(self, t, dt, plant):
        found = self.operator_round(t, plant)
        n = self.n_required(t)
        day = int(t // 86400)
        duty = day % 2 if self.b["alternate_daily"] else 0
        order = [duty] + [i for i in range(self.n_pumps) if i != duty]
        order = [i for i in order if not self.known_fault[i]] + [i for i in order if self.known_fault[i]]
        run = [False] * self.n_pumps
        for i in order[:n]:
            run[i] = True
        return {"run": run, "f_ref": [self.b["freq_hz"] if r else 0.0 for r in run], "outlet_open": True,
                "drain_open": False, "found": found}
