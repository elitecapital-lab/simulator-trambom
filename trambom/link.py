"""Kênh truyền thông gateway <-> máy chủ (trừu tượng hóa MQTT trên 4G).

Mỗi thông điệp có độ trễ cố định; khi kênh mất, các thông điệp đang bay bị mất (QoS 1 sẽ gửi lại
nhờ bộ đệm lưu-và-chuyển của gateway và hàng đợi lệnh của máy chủ).
"""
from .rng import stream


class Link:
    def __init__(self, cfg, seed_offset=0):
        lk = cfg["link"]
        self.latency = lk["latency_s"]
        self.loss = lk["loss_prob"]
        self.rng = stream(cfg["sim"]["seed"] + seed_offset, 3)
        self.up = True
        self.to_server = []
        self.to_gateway = []
        self.bytes_up = 0
        self.bytes_down = 0
        self.msgs_up = 0
        self.msgs_down = 0
        self.down_events = []

    def set_up(self, up, t):
        if self.up and not up:
            self.to_server = []
            self.to_gateway = []
            self.down_events.append([t, None])
        elif not self.up and up and self.down_events:
            self.down_events[-1][1] = t
        self.up = up

    def _lost(self):
        return self.loss > 0.0 and self.rng.random() < self.loss

    def send_up(self, t, msg, nbytes):
        if not self.up or self._lost():
            return False
        self.to_server.append((t + self.latency, msg))
        self.bytes_up += nbytes
        self.msgs_up += 1
        return True

    def send_down(self, t, msg, nbytes):
        if not self.up or self._lost():
            return False
        self.to_gateway.append((t + self.latency, msg))
        self.bytes_down += nbytes
        self.msgs_down += 1
        return True

    @staticmethod
    def _due(queue, t):
        if not queue:
            return [], queue
        due = [m for (td, m) in queue if td <= t + 1e-9]
        if not due:
            return [], queue
        rest = [(td, m) for (td, m) in queue if td > t + 1e-9]
        return due, rest

    def recv_server(self, t):
        due, self.to_server = self._due(self.to_server, t)
        return due

    def recv_gateway(self, t):
        due, self.to_gateway = self._due(self.to_gateway, t)
        return due
