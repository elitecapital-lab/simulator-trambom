"""Tiện ích dùng chung (giữ tương đương với web/js/sim/util.js)."""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT, "config")


def load_json(name_or_path):
    path = name_or_path
    if not os.path.isabs(path) and not os.path.exists(path):
        path = os.path.join(CONFIG_DIR, name_or_path)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def deep_copy(obj):
    return json.loads(json.dumps(obj))


def get_path(d, path):
    cur = d
    for k in path.split("."):
        cur = cur[k]
    return cur


def set_path(d, path, value):
    keys = path.split(".")
    cur = d
    for k in keys[:-1]:
        cur = cur.setdefault(k, {})
    cur[keys[-1]] = value


def flatten(d, prefix=""):
    out = {}
    for k in sorted(d.keys()):
        v = d[k]
        p = prefix + "." + k if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, p))
        else:
            out[p] = v
    return out


def deep_merge(base, over):
    """Gộp đệ quy over vào bản sao của base."""
    out = deep_copy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = deep_copy(v) if isinstance(v, (dict, list)) else v
    return out


def values_equal(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
    return a == b


def fnv1a(text):
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def canonical(obj):
    """Chuỗi JSON chuẩn hóa (khóa sắp xếp, số in theo %.6g) để băm kịch bản."""
    if isinstance(obj, dict):
        return "{" + ",".join('"%s":%s' % (k, canonical(obj[k])) for k in sorted(obj)) + "}"
    if isinstance(obj, list):
        return "[" + ",".join(canonical(v) for v in obj) + "]"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        return "%.6g" % obj
    if obj is None:
        return "null"
    return json.dumps(obj, ensure_ascii=False)


DOW_VI = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]


def fmt_clock(t, start_dow=0):
    day = int(t // 86400)
    s = int(t % 86400)
    return "Ngày %d (%s) %02d:%02d:%02d" % (day + 1, DOW_VI[(start_dow + day) % 7], s // 3600, (s % 3600) // 60, s % 60)


def fmt_hm(t):
    s = int(round(t)) % 86400
    return "%02d:%02d" % (s // 3600, (s % 3600) // 60)


def nan_to_none(x):
    if x is None:
        return None
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x
