"""Bộ sinh số giả ngẫu nhiên mulberry32 – cho kết quả giống hệt bản JavaScript."""
import math

_M = 0xFFFFFFFF


class Rng:
    def __init__(self, seed):
        self.s = int(seed) & _M

    def random(self):
        a = (self.s + 0x6D2B79F5) & _M
        self.s = a
        t = ((a ^ (a >> 15)) * (1 | a)) & _M
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & _M)) & _M) ^ t) & _M
        return ((t ^ (t >> 14)) & _M) / 4294967296.0

    def gauss(self):
        u1 = 1.0 - self.random()
        u2 = self.random()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def stream(seed, offset):
    """Tạo luồng ngẫu nhiên độc lập cho từng phân hệ (nhu cầu, cảm biến...)."""
    mixed = ((int(seed) & _M) * 2654435761) & _M
    return Rng((mixed + int(offset) * 40503 + 12345) & _M)
