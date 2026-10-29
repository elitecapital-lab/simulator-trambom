"""Định dạng lại file JSON cấu hình: thụt lề 2, mảng số/chuỗi ngắn và đối tượng phẳng nhỏ in trên một dòng."""
import json
import sys


def fmt(obj, ind=0):
    pad = "  " * ind
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        flat = all(not isinstance(v, (dict, list)) for v in obj.values())
        one = "{" + ", ".join("%s: %s" % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)) for k, v in obj.items()) + "}"
        if flat and len(one) + len(pad) <= 160:
            return one
        items = ["%s  %s: %s" % (pad, json.dumps(k, ensure_ascii=False), fmt(v, ind + 1)) for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(obj, list):
        if all(not isinstance(v, (dict, list)) for v in obj):
            one = "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in obj) + "]"
            if len(one) + len(pad) <= 200 or all(isinstance(v, (int, float)) for v in obj):
                return one
        items = ["%s  %s" % (pad, fmt(v, ind + 1)) for v in obj]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    return json.dumps(obj, ensure_ascii=False)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        with open(path, "w", encoding="utf-8") as f:
            f.write(fmt(data) + "\n")
