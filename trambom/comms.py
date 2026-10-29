"""Tầng truyền thông phía gateway: nhịp tim, phát hiện mất mạng, bộ đệm lưu-và-chuyển, đồng bộ.

Ánh xạ sang MQTT (xem docs/03-giao-thuc-truyen-thong.md):
    hb          -> trambom/<site>/<station>/state      (QoS 0, kèm LWT "offline")
    tel         -> trambom/<site>/<station>/telemetry  (QoS 1, có seq để chống trùng)
    evt         -> trambom/<site>/<station>/event      (QoS 1, không bao giờ bị nén/xóa)
    sync_hello  -> trambom/<site>/<station>/sync/hello (QoS 1)
    cmd, script, sync_plan, *_ack từ máy chủ           -> trambom/<site>/<station>/cmd/...
"""
MAX_AGG = 64
NUM_FIELDS = ["p", "p_set", "q", "q_in", "level", "cl", "ntu", "ph", "kw", "f1", "f2"]


def merge_records(a, b):
    na, nb = a["n"], b["n"]
    out = {"seq_lo": a["seq_lo"], "seq_hi": b["seq_hi"], "t0": a["t0"], "t1": b["t1"], "ts0": a["ts0"], "ts1": b["ts1"],
           "n": na + nb, "sent": None, "acked": False, "mode": b["mode"], "kwh": b["kwh"],
           "ctl": b.get("ctl", "auto")}
    for k in NUM_FIELDS:
        va, vb = a[k], b[k]
        if va is None or vb is None:
            out[k] = va if vb is None else vb
        else:
            out[k] = (va * na + vb * nb) / (na + nb)
    out["p_min"] = min(a["p_min"], b["p_min"])
    out["p_max"] = max(a["p_max"], b["p_max"])
    out["q_min"] = min(a["q_min"], b["q_min"])
    out["q_max"] = max(a["q_max"], b["q_max"])
    return out


class CommsClient:
    def __init__(self, cfg, link, gw):
        g = cfg["gateway"]
        self.g = g
        self.link = link
        self.gw = gw
        self.bytes = g["msg_bytes"]
        self.state = "online"
        self.last_ack = 0.0
        self.next_hb = 0.0
        self.next_tel = g["telemetry_s"]
        self.buf = []
        self.events = []
        self.seq = 0
        self.eseq = 0
        self.budget = 0.0
        self.sync_phase = None
        self.hello_t = None
        self.sync_started = None
        self.any_acked = False
        self.stats = {"generated": 0, "dropped": 0, "compactions": 0, "max_fill": 0.0,
                      "events_dropped": 0, "syncs": 0, "offline_s": 0.0, "outages": 0, "sms": 0}

    def restart(self, t):
        """Mini PC khởi động lại: bộ đệm trên ổ SSD còn nguyên, phiên MQTT phải thiết lập lại (đi qua chế độ c)."""
        self.state = "offline"
        self.sync_phase = None
        self.last_ack = t
        self.next_hb = t
        self.next_tel = t + self.g["telemetry_s"]
        self.budget = 0.0
        self.stats["outages"] += 1

    # ---------- nhận ----------
    def receive(self, t):
        for msg in self.link.recv_gateway(t):
            typ = msg["type"]
            if typ == "hb_ack":
                self.last_ack = t
                if self.state == "offline":
                    self._on_reconnect(t)
            elif typ == "tel_ack":
                lo, hi = msg["seq_lo"], msg["seq_hi"]
                for r in self.buf:
                    if r["seq_lo"] >= lo and r["seq_hi"] <= hi:
                        r["acked"] = True
                        self.any_acked = True
            elif typ == "evt_ack":
                ids = set(msg["eseqs"])
                self.events = [e for e in self.events if e["eseq"] not in ids]
            elif typ == "cmd":
                self.gw.handle_command(msg["cmd"], t, "trực tuyến")
            elif typ == "script":
                self.gw.handle_script(msg["doc"], t, "phát hành trực tuyến", msg.get("conflicts"))
            elif typ == "version_assigned":
                self.gw.on_version_assigned(msg, t)
            elif typ == "sync_plan":
                self.gw.handle_sync_plan(msg, t)
                self.sync_phase = "replay"

    # ---------- trạng thái kết nối ----------
    def _on_reconnect(self, t):
        self.state = "resync"
        self.sync_phase = "hello"
        self.sync_started = t
        self.stats["syncs"] += 1
        self.gw.on_online(t)
        self._send_hello(t)

    def _send_hello(self, t):
        gw = self.gw
        self.hello_t = t
        msg = {"type": "sync_hello", "station": gw.id, "base_version": gw.script["version"],
               "params": gw.script["params"], "strategy": gw.script["strategy"],
               "local_changes": list(gw.local_changes), "buffer_records": len(self.buf),
               "pending_events": len(self.events), "gw_clock": t + gw.clock_offset,
               "offline_since": gw.last_offline_since, "applied_cmds": list(gw.applied_cmds[-50:])}
        self.link.send_up(t, msg, self.bytes["sync"])

    def tick(self, t, dt):
        g = self.g
        if self.state != "offline" and t - self.last_ack > g["offline_after_s"]:
            self.state = "offline"
            self.sync_phase = None
            self.stats["outages"] += 1
            self.gw.on_offline(t, self.last_ack)
        if self.state == "offline":
            self.stats["offline_s"] += dt
        if t >= self.next_hb:
            self.link.send_up(t, {"type": "hb", "station": self.gw.id, "t": t}, self.bytes["hb"])
            self.next_hb += g["heartbeat_s"]
        if t >= self.next_tel:
            self.push_record(self.gw.make_record(t))
            self.next_tel += g["telemetry_s"]
        if self.state == "resync" and self.sync_phase == "hello" and t - self.hello_t > 30.0:
            self._send_hello(t)
        can_send = self.state == "online" or (self.state == "resync" and self.sync_phase == "replay")
        if can_send:
            self._send(t, dt)
        if self.any_acked:
            self.buf = [r for r in self.buf if not r["acked"]]
            self.any_acked = False
        fill = len(self.buf) / float(g["buffer_capacity"])
        if fill > self.stats["max_fill"]:
            self.stats["max_fill"] = fill
        if self.state == "resync" and self.sync_phase == "replay" and len(self.buf) <= 2 and not self.events:
            self.state = "online"
            self.sync_phase = None
            self.gw.log_event(t, "info", "Đồng bộ hoàn tất sau %.0f s – trở lại chế độ (a) bình thường" % (t - self.sync_started))

    def _send(self, t, dt):
        g = self.g
        rate = g["replay_rate_per_s"]
        self.budget = min(self.budget + rate * dt, 2.0 * rate)
        rt = g["retransmit_s"]
        if self.buf:
            live = self.buf[-1]
            if live["sent"] is None or t - live["sent"] > rt:
                self._send_rec(t, live)
        for r in self.buf:
            if self.budget < 1.0:
                break
            if r["sent"] is None or (t - r["sent"] > rt and not r["acked"]):
                self._send_rec(t, r)
                self.budget -= 1.0
        for e in self.events:
            if e["sent"] is None or t - e["sent"] > rt:
                e["sent"] = t
                self.link.send_up(t, {"type": "evt", "station": self.gw.id, "evt": e}, self.bytes["event"])

    def _send_rec(self, t, r):
        r["sent"] = t
        rec = dict(r)
        self.link.send_up(t, {"type": "tel", "station": self.gw.id, "rec": rec}, self.bytes["tel"])

    # ---------- bộ đệm ----------
    def push_record(self, rec):
        self.seq += 1
        rec["seq_lo"] = self.seq
        rec["seq_hi"] = self.seq
        rec["n"] = 1
        rec["sent"] = None
        rec["acked"] = False
        self.buf.append(rec)
        self.stats["generated"] += 1
        cap = self.g["buffer_capacity"]
        if len(self.buf) >= self.g["buffer_compact_at"] * cap:
            self.compact()
        while len(self.buf) > cap:
            r = self.buf.pop(0)
            self.stats["dropped"] += r["n"]

    def compact(self):
        """Nén nửa cũ của bộ đệm: gộp từng cặp bản ghi (giữ trung bình, min, max)."""
        fill = 100.0 * len(self.buf) / self.g["buffer_capacity"]
        half = len(self.buf) // 2
        new = []
        i = 0
        merged = False
        while i < half:
            a = self.buf[i]
            if i + 1 < half and a["n"] + self.buf[i + 1]["n"] <= MAX_AGG and a["sent"] is None and self.buf[i + 1]["sent"] is None:
                new.append(merge_records(a, self.buf[i + 1]))
                i += 2
                merged = True
            else:
                new.append(a)
                i += 1
        if merged:
            self.buf = new + self.buf[half:]
            self.stats["compactions"] += 1
            self.gw.log_event(self.gw.t, "info", "Bộ đệm đạt %.0f%% – nén nửa dữ liệu cũ (gộp cặp bản ghi), còn %d bản ghi" % (fill, len(self.buf)))

    def push_event(self, ev):
        self.eseq += 1
        ev["eseq"] = self.eseq
        ev["sent"] = None
        self.events.append(ev)
        cap = self.g["event_capacity"]
        while len(self.events) > cap:
            idx = next((i for i, e in enumerate(self.events) if e.get("sev") == "info"), 0)
            self.events.pop(idx)
            self.stats["events_dropped"] += 1
        if self.state == "online":
            ev["sent"] = self.gw.t
            self.link.send_up(self.gw.t, {"type": "evt", "station": self.gw.id, "evt": ev}, self.bytes["event"])

    def send_direct(self, t, msg, kind):
        self.link.send_up(t, msg, self.bytes.get(kind, 100))
