"""Máy chủ điều hành trung tâm: nhận dữ liệu, cảnh báo tập trung, kho kịch bản có phiên bản,
hàng đợi lệnh có thời hạn (TTL), hợp nhất xung đột khi trạm đồng bộ lại."""
from .util import deep_copy, flatten, get_path, set_path, values_equal


def three_way_merge(base, server, local, policy):
    """Hợp nhất 3 chiều tham số kịch bản.

    - Chỉ một phía thay đổi  -> lấy phía đó.
    - Cả hai cùng đổi (xung đột):
        * tham số dịch vụ/an toàn trong policy['service_max'] -> lấy giá trị LỚN hơn (bảo thủ)
        * tham số trong policy['service_min']                 -> lấy giá trị NHỎ hơn
        * tham số vận hành khác                               -> máy chủ thắng, ghi lại để rà soát
    """
    fb, fs, fl = flatten(base), flatten(server), flatten(local)
    keys = sorted(set(fb) | set(fs) | set(fl))
    merged = deep_copy(server)
    conflicts = []
    decisions = []
    smax = set(policy.get("service_max", []))
    smin = set(policy.get("service_min", []))
    for k in keys:
        b, s, l = fb.get(k), fs.get(k), fl.get(k)
        if values_equal(s, l):
            r = s
        elif values_equal(s, b):
            r = l
            decisions.append({"path": k, "from": "tại chỗ", "value": l})
        elif values_equal(l, b):
            r = s
            decisions.append({"path": k, "from": "máy chủ", "value": s})
        else:
            if k in smax:
                r = max(s, l)
                rule = "tham số dịch vụ/an toàn → chọn giá trị bảo thủ (lớn hơn)"
            elif k in smin:
                r = min(s, l)
                rule = "tham số bảo vệ thiết bị → chọn giá trị bảo thủ (nhỏ hơn)"
            else:
                r = s
                rule = "tham số vận hành → máy chủ thắng, chuyển điều độ viên rà soát"
            conflicts.append({"path": k, "base": b, "server": s, "local": l, "result": r, "rule": rule})
        set_path(merged, k, r)
    return merged, conflicts, decisions


class OperationsServer:
    def __init__(self, cfg):
        self.cfg = cfg
        self.t = 0.0
        self.stations = {}
        self.alarms = {}
        self.alarm_history = []
        self.logs = []
        self.cmd_seq = 0

    def log(self, t, station, level, text):
        self.logs.append({"t": t, "station": station, "level": level, "text": text})
        if len(self.logs) > 5000:
            self.logs = self.logs[-4000:]

    def register(self, sid, link, script_doc, name=""):
        doc = deep_copy(script_doc)
        doc.setdefault("author", "server")
        doc.setdefault("reason", "kịch bản ban đầu")
        doc.setdefault("t", 0.0)
        self.stations[sid] = {
            "id": sid, "name": name, "link": link, "online": True, "last_seen": 0.0,
            "repo": {doc["version"]: doc}, "target": doc["version"], "reported": doc["version"],
            "pending": {}, "cmd_log": [], "seen": set(), "records": 0, "records_agg": 0, "late": 0,
            "series": {}, "last": {}, "sync_log": [], "conflicts": [], "offline_periods": [],
            "events": 0, "status_log": [],
        }

    # ---------- thao tác của điều độ viên ----------
    def publish_script(self, sid, patch, t, by="Điều độ viên", reason="", strategy=None):
        st = self.stations[sid]
        cur = st["repo"][st["target"]]
        params = deep_copy(cur["params"])
        for path, v in patch.items():
            set_path(params, path, v)
        v_new = max(st["repo"]) + 1
        doc = {"version": v_new, "strategy": strategy or cur["strategy"], "params": params,
               "author": by, "reason": reason, "t": t, "parent": cur["version"]}
        st["repo"][v_new] = doc
        st["target"] = v_new
        self.log(t, sid, "info", "Phát hành kịch bản v%d (%s): %s" % (v_new, by, ", ".join("%s=%s" % kv for kv in patch.items())))
        if st["online"]:
            st["link"].send_down(t, {"type": "script", "doc": deep_copy(doc)}, self.cfg["gateway"]["msg_bytes"]["sync"])
        else:
            self.log(t, sid, "info", "Trạm %s đang mất kết nối – kịch bản v%d chờ đồng bộ (retained)" % (sid, v_new))
        return v_new

    def send_command(self, sid, ctype, args, t, ttl_s=900.0, by="Điều độ viên"):
        st = self.stations[sid]
        self.cmd_seq += 1
        cmd = {"id": "C%04d" % self.cmd_seq, "type": ctype, "args": dict(args), "issued_at": t,
               "expires_at": t + ttl_s, "by": by}
        st["pending"][cmd["id"]] = {"cmd": cmd, "sent": None}
        st["cmd_log"].append({"t": t, "id": cmd["id"], "type": ctype, "status": "queued", "reason": ""})
        self.log(t, sid, "info", "Lệnh %s %s (hạn %.0f phút)%s" % (cmd["id"], ctype, ttl_s / 60, "" if st["online"] else " – trạm mất kết nối, xếp hàng"))
        if st["online"]:
            self._send_cmd(t, st, cmd["id"])
        return cmd["id"]

    def ack_alarm(self, sid, code, t):
        a = self.alarms.get((sid, code))
        if a:
            a["acked"] = True
        return self.send_command(sid, "ack_alarm", {"code": code}, t, ttl_s=3600)

    def _send_cmd(self, t, st, cid):
        p = st["pending"][cid]
        p["sent"] = t
        st["link"].send_down(t, {"type": "cmd", "cmd": deep_copy(p["cmd"])}, self.cfg["gateway"]["msg_bytes"]["cmd"])

    # ---------- vòng xử lý ----------
    def step(self, t):
        self.t = t
        for sid, st in self.stations.items():
            link = st["link"]
            for msg in link.recv_server(t):
                self._handle(t, st, msg)
            if st["online"] and t - st["last_seen"] > self.cfg["server"]["offline_after_s"]:
                st["online"] = False
                st["offline_periods"].append([st["last_seen"], None])
                self.log(t, sid, "alarm", "Trạm %s mất kết nối (LWT) – lần cuối nhận dữ liệu %.0f s trước" % (sid, t - st["last_seen"]))
                self._central_alarm(t, sid, "STATION_OFFLINE", "warning", "Mất kết nối với trạm", "raise")
            # lệnh hết hạn phía máy chủ / gửi lại
            for cid in list(st["pending"].keys()):
                p = st["pending"][cid]
                if t > p["cmd"]["expires_at"]:
                    del st["pending"][cid]
                    st["cmd_log"].append({"t": t, "id": cid, "type": p["cmd"]["type"], "status": "expired_server",
                                          "reason": "hết hạn trước khi trạm xác nhận"})
                    self.log(t, sid, "info", "Lệnh %s %s hết hạn trước khi trạm nhận – hủy" % (cid, p["cmd"]["type"]))
                elif st["online"] and p["sent"] is not None and t - p["sent"] > self.cfg["server"]["cmd_resend_s"]:
                    self._send_cmd(t, st, cid)

    def _handle(self, t, st, msg):
        typ = msg["type"]
        sid = st["id"]
        link = st["link"]
        nb = self.cfg["gateway"]["msg_bytes"]
        if not st["online"] and typ in ("hb", "tel", "evt", "sync_hello"):
            st["online"] = True
            if st["offline_periods"] and st["offline_periods"][-1][1] is None:
                st["offline_periods"][-1][1] = t
            self.log(t, sid, "info", "Trạm %s kết nối lại" % sid)
            self._central_alarm(t, sid, "STATION_OFFLINE", "warning", "", "clear")
        st["last_seen"] = t
        if typ == "hb":
            link.send_down(t, {"type": "hb_ack", "server_t": t}, nb["ack"])
        elif typ == "tel":
            r = msg["rec"]
            lo, hi = r["seq_lo"], r["seq_hi"]
            new = [s for s in range(lo, hi + 1) if s not in st["seen"]]
            if new:
                st["seen"].update(new)
                st["records"] += len(new)
                if r["n"] > 1:
                    st["records_agg"] += len(new)
                late = t - r["t1"] > 60.0
                if late:
                    st["late"] += len(new)
                m0 = int(r["t0"] // 60)
                m1 = int(r["t1"] // 60)
                for m in range(m0, m1 + 1):
                    if m not in st["series"]:
                        st["series"][m] = {"p": r["p"], "q": r["q"], "level": r["level"], "kw": r["kw"],
                                           "agg": r["n"] > 1, "late": late}
                st["last"] = r
            link.send_down(t, {"type": "tel_ack", "seq_lo": lo, "seq_hi": hi}, nb["ack"])
        elif typ == "evt":
            e = msg["evt"]
            st["events"] += 1
            if e["kind"] == "alarm":
                self._central_alarm(e["t"], sid, e["code"], e["sev"], e["msg"], e["action"])
            elif e["kind"] == "cmd_ack":
                st["pending"].pop(e["id"], None)
                st["cmd_log"].append({"t": t, "id": e["id"], "type": "", "status": e["status"], "reason": e["reason"]})
                self.log(t, sid, "info", "Trạm xác nhận lệnh %s: %s (%s)" % (e["id"], e["status"], e["reason"]))
            elif e["kind"] == "log":
                self.log(e["t"], sid, "warning", e["text"])
            link.send_down(t, {"type": "evt_ack", "eseqs": [e["eseq"]]}, nb["ack"])
        elif typ == "sync_hello":
            self._sync(t, st, msg)
        elif typ == "script_status":
            st["status_log"].append({"t": t, "version": msg["version"], "status": msg["status"]})
            if msg["status"] in ("applied", "committed"):
                st["reported"] = msg["version"]
            if msg["status"] == "rollback":
                st["target"] = msg["restored"]
                st["reported"] = msg["restored"]
                self.log(t, sid, "alarm", "Trạm quay lui kịch bản v%s → v%s; đánh dấu v%s lỗi" % (msg["version"], msg["restored"], msg["version"]))
                bad = st["repo"].get(msg["version"])
                if bad is not None:
                    bad["failed"] = True
            if msg["status"] == "rejected":
                st["target"] = st["reported"]
                self.log(t, sid, "alarm", "Trạm từ chối kịch bản v%s: %s" % (msg["version"], "; ".join(msg.get("reason", []))))
        elif typ == "local_change":
            self._local_change(t, st, msg)

    def _local_change(self, t, st, msg):
        base_v = msg["base_version"]
        base = st["repo"][base_v]
        local = deep_copy(base["params"])
        for c in msg["changes"]:
            set_path(local, c["path"], c["new"])
        nb = self.cfg["gateway"]["msg_bytes"]
        v_new = max(st["repo"]) + 1
        if st["target"] == base_v:
            st["repo"][v_new] = {"version": v_new, "strategy": base["strategy"], "params": local, "author": "HMI tại trạm",
                                 "reason": ", ".join(c.get("reason", "") for c in msg["changes"]), "t": t, "parent": base_v}
            st["target"] = v_new
            st["reported"] = v_new
            st["link"].send_down(t, {"type": "version_assigned", "version": v_new}, nb["ack"])
            self.log(t, st["id"], "info", "Ghi nhận chỉnh sửa tại chỗ thành v%d" % v_new)
        else:
            merged, conflicts, _ = three_way_merge(base["params"], st["repo"][st["target"]]["params"], local, self.cfg["merge_policy"])
            doc = {"version": v_new, "strategy": st["repo"][st["target"]]["strategy"], "params": merged, "author": "hợp nhất",
                   "reason": "chỉnh sửa tại chỗ + v%d" % st["target"], "t": t, "parent": st["target"]}
            st["repo"][v_new] = doc
            st["target"] = v_new
            st["conflicts"].extend(conflicts)
            st["link"].send_down(t, {"type": "script", "doc": deep_copy(doc), "conflicts": conflicts}, nb["sync"])

    def _sync(self, t, st, msg):
        sid = st["id"]
        base_v = msg["base_version"]
        base = st["repo"].get(base_v, st["repo"][st["reported"]])
        target = st["repo"][st["target"]]
        changes = msg["local_changes"]
        plan = {"type": "sync_plan", "script": None, "accepted_version": None, "conflicts": [], "decisions": [],
                "commands": [], "clock_offset": msg["gw_clock"] - t, "server_t": t}
        v_new = max(st["repo"]) + 1
        if st["target"] == base_v:
            if changes:
                st["repo"][v_new] = {"version": v_new, "strategy": msg["strategy"], "params": deep_copy(msg["params"]),
                                     "author": "HMI tại trạm (khi mất mạng)", "reason": "chấp nhận chỉnh sửa tại chỗ", "t": t, "parent": base_v}
                st["target"] = v_new
                plan["accepted_version"] = v_new
        else:
            if not changes:
                plan["script"] = deep_copy(target)
            else:
                merged, conflicts, decisions = three_way_merge(base["params"], target["params"], msg["params"], self.cfg["merge_policy"])
                doc = {"version": v_new, "strategy": target["strategy"], "params": merged, "author": "hợp nhất tự động",
                       "reason": "v%d (máy chủ) + chỉnh sửa tại chỗ trên v%d" % (target["version"], base_v), "t": t,
                       "parent": target["version"]}
                st["repo"][v_new] = doc
                st["target"] = v_new
                plan["script"] = deep_copy(doc)
                plan["conflicts"] = conflicts
                plan["decisions"] = decisions
                st["conflicts"].extend(conflicts)
        for cid, p in sorted(st["pending"].items()):
            if t <= p["cmd"]["expires_at"]:
                plan["commands"].append(deep_copy(p["cmd"]))
                p["sent"] = t
        st["link"].send_down(t, plan, self.cfg["gateway"]["msg_bytes"]["sync"])
        rep = {"t": t, "offline_since": msg.get("offline_since"), "buffer_records": msg["buffer_records"],
               "pending_events": msg["pending_events"], "local_changes": len(changes), "conflicts": plan["conflicts"],
               "decisions": plan["decisions"], "script_version": plan["script"]["version"] if plan["script"] else plan["accepted_version"],
               "commands": [c["id"] + " " + c["type"] for c in plan["commands"]], "clock_offset": plan["clock_offset"]}
        st["sync_log"].append(rep)
        self.log(t, sid, "info", "Đồng bộ trạm %s: %d bản ghi đệm, %d chỉnh sửa tại chỗ, %d xung đột, %d lệnh còn hạn"
                 % (sid, msg["buffer_records"], len(changes), len(plan["conflicts"]), len(plan["commands"])))

    def _central_alarm(self, t, sid, code, sev, msg, action):
        key = (sid, code)
        if action == "raise":
            self.alarms[key] = {"station": sid, "code": code, "sev": sev, "msg": msg, "t": t, "acked": False, "active": True}
            self.alarm_history.append({"t": t, "station": sid, "code": code, "sev": sev, "msg": msg, "action": "raise"})
        else:
            a = self.alarms.get(key)
            if a:
                a["active"] = False
                a["t_clear"] = t
                del self.alarms[key]
            self.alarm_history.append({"t": t, "station": sid, "code": code, "sev": sev, "msg": msg, "action": "clear"})

    def completeness(self, sid, generated):
        st = self.stations[sid]
        return st["records"] / generated if generated else 1.0
