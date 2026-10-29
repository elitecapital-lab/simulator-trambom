"""Edge gateway GW-01: thu thập dữ liệu, kiểm tra tín hiệu, kịch bản điều khiển, lớp an toàn,
quản lý kịch bản có phiên bản, thực thi lệnh từ xa và đồng bộ khi khôi phục kết nối."""
import math

from .comms import CommsClient
from .control import Controller, Forecaster
from .safety import PumpManager, SafetyLayer
from .sensors import installed_tags
from .util import clamp, deep_copy, fnv1a, canonical, flatten, get_path, set_path

SEV_RANK = {"info": 0, "warning": 1, "alarm": 2, "critical": 3}
# Báo động thuộc nhóm "áp lực / chất lượng nước / an toàn thiết bị" -> hiển thị chế độ (d)
D_PREFIXES = ("P_HIGH", "P_HH_TRIP", "LOCKOUT", "P_LOW", "BURST_SUSPECT", "LEVEL_LL", "LEVEL_STOP", "DRY_RUN_FLOAT",
              "CL_", "NTU_", "PH_", "SAFE_STOP", "PT_DEVIATION", "PT_STUCK", "NO_PRESSURE", "SENSOR_FAULT",
              "PUMP_FAULT", "FLOW_ANOMALY")
# Báo động dạng sự kiện (không có điều kiện tự xóa): xóa khi được xác nhận hoặc sau 30 phút
EVENT_ALARMS = ("SCRIPT_ROLLBACK", "SCRIPT_REJECTED", "SCRIPT_ERROR", "GW_WATCHDOG")
# Lệnh vận hành bằng tay (từ xa qua MQTT hoặc tại chỗ qua HMI)
MANUAL_CMDS = ("set_mode", "pump_start", "pump_stop", "pump_speed", "valve")
SRC_NAME = {"local": "tại chỗ (HMI)", "remote": "từ xa (trung tâm)"}


def validate_params(params, schema):
    """Kiểm tra kịch bản trước khi áp dụng (giới hạn từng tham số + ràng buộc chéo)."""
    errs = []
    flat = flatten(params)
    for path, (lo, hi) in schema.items():
        if path not in flat:
            errs.append("thiếu %s" % path)
            continue
        v = flat[path]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
            errs.append("%s không phải số" % path)
        elif v < lo or v > hi:
            errs.append("%s=%s ngoài [%s, %s]" % (path, v, lo, hi))
    try:
        if params["pressure"]["p_set_min_bar"] >= params["pressure"]["p_set_max_bar"]:
            errs.append("p_set_min_bar phải < p_set_max_bar")
        if params["level"]["restart_m"] <= params["level"]["stop_m"]:
            errs.append("restart_m phải > stop_m")
        if params["staging"]["f_off_hz"] >= params["staging"]["f_on_hz"]:
            errs.append("f_off_hz phải < f_on_hz")
    except (KeyError, TypeError):
        errs.append("cấu trúc kịch bản không hợp lệ")
    return errs


def script_hash(doc):
    return fnv1a(canonical({"strategy": doc["strategy"], "params": doc["params"]}))


class AlarmManager:
    def __init__(self, gw):
        self.gw = gw
        self.active = {}
        self.timers = {}
        self.history = []
        self.raised_count = {"info": 0, "warning": 0, "alarm": 0, "critical": 0}

    def raise_(self, t, code, sev, msg):
        if code in self.active:
            return False
        a = {"code": code, "sev": sev, "msg": msg, "t": t, "acked": False}
        self.active[code] = a
        self.raised_count[sev] += 1
        self.history.append({"t": t, "action": "raise", "code": code, "sev": sev, "msg": msg})
        self.gw.on_alarm(t, a, "raise")
        return True

    def clear(self, t, code):
        a = self.active.pop(code, None)
        if a is None:
            return
        self.history.append({"t": t, "action": "clear", "code": code, "sev": a["sev"], "msg": a["msg"]})
        self.gw.on_alarm(t, a, "clear")

    def set(self, t, code, cond, sev, msg):
        if cond:
            self.raise_(t, code, sev, msg)
        elif code in self.active:
            self.clear(t, code)

    def set_hyst(self, t, dt, code, raise_cond, clear_cond, sev, msg, on_delay=0.0, off_delay=0.0):
        """Báo động có dải chết và trễ bật/tắt (ISA-18.2): bật khi raise_cond kéo dài on_delay,
        chỉ tắt khi clear_cond kéo dài off_delay – tránh báo động nhấp nháy do nhiễu đo."""
        tm = self.timers.get(code, 0.0)
        if code in self.active:
            tm = tm + dt if clear_cond else 0.0
            if tm >= off_delay:
                self.clear(t, code)
                tm = 0.0
        else:
            tm = tm + dt if raise_cond else 0.0
            if raise_cond and tm >= on_delay:
                self.raise_(t, code, sev, msg)
                tm = 0.0
        self.timers[code] = tm

    def ack(self, code, t=None):
        if code in self.active:
            self.active[code]["acked"] = True
            if code in EVENT_ALARMS and t is not None:
                self.clear(t, code)
            return True
        return False

    def expire_events(self, t):
        for code in EVENT_ALARMS:
            a = self.active.get(code)
            if a is not None and t - a["t"] > 1800.0:
                self.clear(t, code)

    def d_active(self):
        for code in self.active:
            if code.startswith(D_PREFIXES):
                return True
        return False

    def max_sev(self):
        m = -1
        for a in self.active.values():
            r = SEV_RANK[a["sev"]]
            if r > m:
                m = r
        return m


class SignalProcessor:
    """Tầng thu thập: lọc, kiểm tra phạm vi, phát hiện kẹt, đối chiếu chéo PT-101/PT-102."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.sensors = cfg["sensors"]
        self.pm = cfg["pump_model"]
        self.m_per_bar = 1.0e5 / (cfg["constants"]["rho"] * cfg["constants"]["g"])
        self.z_s = cfg["tank"]["z_suction_m"]
        self.p_f = None
        self.q_f = None
        self.qin_f = None
        self.level = cfg["tank"]["level_init_m"]
        self.forced_pt = None
        self.faulty = {"PT-101": False, "PT-102": False}
        self.dev_timer = 0.0
        self.agree_timer = 0.0
        self.stuck = {"PT-101": [None, 0.0], "PT-102": [None, 0.0]}
        self.pt_used = "PT-101"
        self.p_model = None
        self.qf = {"cl": None, "ntu": None, "ph": None}
        self.installed = installed_tags(cfg)
        self.area = cfg["tank"]["area_m2"]
        self.drain_q = cfg["tank"]["drain_q_m3h"]
        self.mb_lv = None
        self.mb_vout = 0.0
        self.mb_hist = []

    def restart(self):
        """Mini PC khởi động lại: bộ lọc và cửa sổ cân bằng khối lượng bắt đầu lại từ đầu."""
        self.p_f = None
        self.q_f = None
        self.qin_f = None
        self.mb_lv = None
        self.mb_vout = 0.0
        self.mb_hist = []
        self.qf = {"cl": None, "ntu": None, "ph": None}
        self.dev_timer = 0.0
        self.agree_timer = 0.0
        for st in self.stuck.values():
            st[0] = None
            st[1] = 0.0

    def _inflow_mass_balance(self, t, dt, lv, q_out, drain):
        """Không có FT-100: lưu lượng vào ≈ lưu lượng ra (FT-101 + xả đáy) + A·dH/dt, cửa sổ trượt 15 phút."""
        a = 1.0 - math.exp(-dt / 30.0)
        self.mb_lv = lv if self.mb_lv is None else self.mb_lv + (lv - self.mb_lv) * a
        self.mb_vout += ((q_out or 0.0) + (self.drain_q if drain else 0.0)) * dt / 3600.0
        if not self.mb_hist or t - self.mb_hist[-1][0] >= 60.0 - 1e-9:
            self.mb_hist.append((t, self.mb_lv, self.mb_vout))
            if len(self.mb_hist) > 16:
                self.mb_hist.pop(0)
        if len(self.mb_hist) < 16:
            return None
        t0, l0, v0 = self.mb_hist[0]
        t1, l1, v1 = self.mb_hist[-1]
        return max(0.0, (self.area * (l1 - l0) + (v1 - v0)) * 3600.0 / (t1 - t0))

    def _valid(self, tag, v):
        if v is None:
            return False
        sp = self.sensors[tag]
        span = sp["hi"] - sp["lo"]
        return (sp["lo"] - 0.0124 * span) < v < (sp["hi"] + 0.0309 * span)

    def process(self, t, dt, meas, gw):
        A = gw.alarms
        P = gw.script["params"]
        feat = P["features"]
        voting = feat["pressure_voting"]
        s = gw.cfg["safety"]
        valid = {}
        for tag in ("PT-101", "PT-102", "FT-101", "FT-100", "LT-101", "AIT-201", "AIT-202", "AIT-203"):
            ok = self._valid(tag, meas[tag])
            valid[tag] = ok
            if tag not in self.installed:
                continue  # không lắp: không phải lỗi tín hiệu
            A.set(t, "SENSOR_FAULT_" + tag, not ok, "alarm", "Lỗi tín hiệu %s (ngoài 4–20 mA / mất tín hiệu)" % tag)
        # phát hiện kẹt (chỉ ở mức nâng cao: tính năng pressure_voting)
        running = any(p["running"] for p in meas["pumps"])
        for tag in ("PT-101", "PT-102"):
            v = meas[tag]
            st = self.stuck[tag]
            if v is not None and st[0] is not None and abs(v - st[0]) < 1e-7 and running:
                st[1] += dt
            else:
                st[1] = 0.0
            st[0] = v
            if voting and st[1] >= 30.0 and not self.faulty[tag]:
                self.faulty[tag] = True
                A.raise_(t, "PT_STUCK_" + tag, "alarm", "%s không đổi giá trị 30 s khi bơm chạy – nghi kẹt, loại khỏi điều khiển" % tag)
        p1 = meas["PT-101"] if valid["PT-101"] else None
        p2 = meas["PT-102"] if valid["PT-102"] else None
        # mô hình bơm làm "cảm biến thứ ba"
        q_raw = meas["FT-101"] if valid["FT-101"] else None
        lv = meas["LT-101"] if valid["LT-101"] else self.level
        self.level = lv
        run = [p for p in meas["pumps"] if p["running"] and p["f"] >= self.pm["f_min_hz"] - 0.5]
        self.p_model = None
        if run and q_raw is not None:
            s_mean = sum(p["f"] for p in run) / len(run) / self.pm["f_rated_hz"]
            qn = q_raw / len(run)
            h = self.pm["h0_m"] * s_mean * s_mean - self.pm["k_m_per_m3h2"] * qn * qn
            self.p_model = (h + lv + self.z_s) / self.m_per_bar
        if p1 is not None and p2 is not None:
            d = abs(p1 - p2)
            if d > s["pt_deviation_bar"]:
                self.dev_timer += dt
                self.agree_timer = 0.0
            else:
                self.dev_timer = 0.0
                if d < 0.1:
                    self.agree_timer += dt
            if self.dev_timer >= s["pt_deviation_delay_s"]:
                if A.raise_(t, "PT_DEVIATION", "alarm", "PT-101 (%.2f) và PT-102 (%.2f) lệch %.2f bar" % (p1, p2, d)):
                    if voting and self.p_model is not None:
                        bad = "PT-101" if abs(p1 - self.p_model) > abs(p2 - self.p_model) else "PT-102"
                        self.faulty[bad] = True
                        gw.log_event(t, "safety", "Biểu quyết 2/3 với mô hình bơm (%.2f bar): loại %s khỏi điều khiển" % (self.p_model, bad))
            if d < 0.5 * s["pt_deviation_bar"]:
                A.clear(t, "PT_DEVIATION")
            if self.agree_timer >= 60.0:
                for tag in ("PT-101", "PT-102"):
                    if self.faulty[tag] and self.stuck[tag][1] == 0.0:
                        self.faulty[tag] = False
                        A.clear(t, "PT_STUCK_" + tag)
                        gw.log_event(t, "info", "%s khớp trở lại – đưa vào sử dụng" % tag)
        # chọn cảm biến cho điều khiển
        cand = []
        if self.forced_pt is not None:
            cand.append(self.forced_pt)
        cand += ["PT-101", "PT-102"]
        p_ctrl_raw = None
        used = None
        for tag in cand:
            v = p1 if tag == "PT-101" else p2
            if v is not None and not self.faulty[tag]:
                p_ctrl_raw = v
                used = tag
                break
        if used != self.pt_used and used is not None:
            gw.log_event(t, "info", "Cảm biến áp lực cho điều khiển: %s" % used)
        self.pt_used = used
        tau = P["pressure"]["filter_tau_s"]
        if p_ctrl_raw is None:
            self.p_f = None
        elif self.p_f is None or tau <= 0.0:
            self.p_f = p_ctrl_raw
        else:
            self.p_f += (p_ctrl_raw - self.p_f) * (1.0 - math.exp(-dt / tau))
        prot = [v for tag, v in (("PT-101", p1), ("PT-102", p2)) if v is not None and not self.faulty[tag]]
        if not prot:
            prot = [v for v in (p1, p2) if v is not None]
        p_prot = max(prot) if prot else None
        if q_raw is not None:
            self.q_f = q_raw if self.q_f is None else self.q_f + (q_raw - self.q_f) * (1.0 - math.exp(-dt / 10.0))
        if "FT-100" in self.installed:
            qin = meas["FT-100"] if valid["FT-100"] else None
            if qin is not None:
                self.qin_f = qin if self.qin_f is None else self.qin_f + (qin - self.qin_f) * (1.0 - math.exp(-dt / 300.0))
        else:
            self.qin_f = self._inflow_mass_balance(t, dt, lv, q_raw, meas["drain_open"])
        # lọc trung bình trượt mũ (tau 20 s) cho tín hiệu chất lượng nước dùng ra quyết định an toàn
        aq = 1.0 - math.exp(-dt / 20.0)
        for key, tag in (("cl", "AIT-201"), ("ntu", "AIT-202"), ("ph", "AIT-203")):
            v = meas[tag] if valid[tag] else None
            if v is None:
                self.qf[key] = None
            elif self.qf[key] is None:
                self.qf[key] = v
            else:
                self.qf[key] += (v - self.qf[key]) * aq
        return {
            "p_ctrl": self.p_f, "p_ctrl_raw": p_ctrl_raw, "p_prot": p_prot, "pt_used": used,
            "p1": p1, "p2": p2, "p_model": self.p_model,
            "q": q_raw, "q_f": self.q_f, "q_in_f": self.qin_f,
            "level": lv, "level_valid": valid["LT-101"],
            "cl": self.qf["cl"], "ntu": self.qf["ntu"], "ph": self.qf["ph"],
            "pumps": meas["pumps"],
        }


class Gateway:
    def __init__(self, cfg, station, link, script_doc, profile, level_name="basic"):
        self.cfg = cfg
        self.id = station.get("id", "ST-01")
        self.pump_tags = list(cfg["pumps"])
        self.start_dow = cfg["sim"]["start_dow"]
        self.t = 0.0
        self.script = deep_copy(script_doc)
        self.script.setdefault("local_modified", False)
        self.script["hash"] = script_hash(self.script)
        self.script_prev = None
        self.watch = None
        self.local_changes = []
        self.logs = []
        self.alarms = AlarmManager(self)
        self.sig_proc = SignalProcessor(cfg)
        self.safety = SafetyLayer(cfg)
        self.ctrl = Controller(cfg, len(self.pump_tags))
        self.forecaster = Forecaster(profile, self.start_dow)
        self.pm = PumpManager(cfg, self.pump_tags)
        self.comms = CommsClient(cfg, link, self)
        self.override = None
        self.offline_since = None
        self.last_offline_since = None
        self.flush = None
        self.applied_cmds = []
        self.custom_fn = None
        self.clock_offset = 0.0
        self.sig = None
        self.out = None
        self.level_name = level_name
        self.sms_log = []
        self.notify = []
        self.last = {}
        self.cmd_results = []
        self.conflicts = []
        self.stopped_s = 0.0
        self.recover_until = 0.0
        self.manual = None
        self.manual_s = 0.0
        self.local_seq = 0

    # ---------- nhật ký & cảnh báo ----------
    def log_event(self, t, level, text):
        self.logs.append({"t": t, "level": level, "text": text})
        if len(self.logs) > 5000:
            self.logs = self.logs[-4000:]
        if level in ("alarm", "safety", "critical"):
            self.comms.push_event({"kind": "log", "t": t, "sev": "warning", "text": text})

    def on_alarm(self, t, a, action):
        verb = "BÁO ĐỘNG" if action == "raise" else "Hết báo động"
        lvl = a["sev"] if action == "raise" else "info"
        self.logs.append({"t": t, "level": lvl, "text": "%s [%s] %s" % (verb, a["code"], a["msg"]) if action == "raise"
                          else "%s [%s]" % (verb, a["code"])})
        self.comms.push_event({"kind": "alarm", "action": action, "code": a["code"], "sev": a["sev"],
                               "msg": a["msg"], "t": t})
        if action == "raise" and a["sev"] == "critical":
            sms = self.cfg["gateway"]["sms_fallback"] and self.cfg.get("hardware", {}).get("SMS", True)
            if self.offline_since is None:
                self.notify.append({"t": t, "code": a["code"], "via": "IP", "t_notified": t})
            elif sms:
                self.sms_log.append({"t": t, "text": "[%s] %s" % (self.id, a["msg"])})
                self.comms.stats["sms"] += 1
                self.logs.append({"t": t, "level": "info", "text": "Mất mạng IP – gửi SMS dự phòng tới tổ trực: %s" % a["msg"]})
                self.notify.append({"t": t, "code": a["code"], "via": "SMS", "t_notified": t})
            else:
                self.logs.append({"t": t, "level": "info", "text": "Mất mạng IP, trạm không có modem SMS – báo động chờ gửi khi có mạng: %s" % a["msg"]})
                self.notify.append({"t": t, "code": a["code"], "via": "chờ mạng", "t_notified": None})

    # ---------- kết nối ----------
    def on_offline(self, t, last_ack):
        self.offline_since = t
        self.last_offline_since = last_ack
        self.log_event(t, "alarm", "Mất kết nối máy chủ > %.0f s – chuyển chế độ (b) tự vận hành bằng kịch bản v%s đã lưu"
                       % (self.cfg["gateway"]["offline_after_s"], self.script["version"]))
        self.alarms.raise_(t, "COMMS_OFFLINE", "warning", "Mất kết nối máy chủ điều hành")

    def on_online(self, t):
        dur = (t - self.offline_since) if self.offline_since is not None else 0.0
        self.offline_since = None
        for n in self.notify:
            if n["t_notified"] is None:
                n["t_notified"] = t
        self.alarms.clear(t, "COMMS_OFFLINE")
        self.log_event(t, "info", "Khôi phục kết nối sau %.1f phút – chế độ (c) đồng bộ: gửi bản tin chào, %d bản ghi đệm"
                       % (dur / 60.0, len(self.comms.buf)))

    def restart(self, t, t_fail, pumps, note):
        """Mini PC khởi động lại sau khi treo: nạp kịch bản, mô hình dự báo và bộ đệm từ ổ SSD,
        tiếp quản điều khiển từ mạch dự phòng theo kiểu không xung (khởi tạo lại bộ PI từ tần số đang chạy)."""
        down = t - t_fail
        self.sig_proc.restart()
        c = self.ctrl
        c.n = 0
        c.sleep_state = "awake"
        c.stage_timer = 0.0
        c.destage_timer = 0.0
        c.swap_until = None
        c.next_tte = t
        running = [i for i, p in enumerate(pumps) if p["running"]]
        if len(running) == 1:
            c.duty = running[0]
        for i, p in enumerate(pumps):
            self.pm.cmd[i] = p["running"]
        self.comms.restart(t)
        self.offline_since = t
        self.last_offline_since = t_fail
        self.alarms.raise_(t, "GW_WATCHDOG", "alarm", "Mini PC ngừng %.0f phút (watchdog phát hiện) – %s; đã khởi động lại và tiếp quản"
                           % (down / 60.0, note))
        self.log_event(t, "info", "Mini PC khởi động lại: nạp kịch bản v%s, mô hình dự báo và %d bản ghi đệm từ ổ SSD – tiếp quản không xung, chờ đồng bộ"
                       % (self.script["version"], len(self.comms.buf)))

    # ---------- kịch bản ----------
    def apply_script(self, doc, t, source):
        errs = validate_params(doc["params"], self.cfg["script_schema"])
        if errs:
            self.alarms.raise_(t, "SCRIPT_REJECTED", "warning", "Từ chối kịch bản v%s: %s" % (doc.get("version"), "; ".join(errs[:3])))
            self.comms.send_direct(t, {"type": "script_status", "station": self.id, "version": doc.get("version"),
                                       "status": "rejected", "reason": errs}, "ack")
            return False
        self.script_prev = self.script
        new = deep_copy(doc)
        new["local_modified"] = False
        new["hash"] = script_hash(new)
        self.script = new
        self.watch = {"t0": t, "until": t + self.cfg["gateway"]["script_watch_s"], "err_s": 0.0, "n_s": 0.0,
                      "trips0": self.safety.trip_count}
        self.log_event(t, "info", "Áp dụng kịch bản v%s (%s, %s) – giám sát %.0f phút trước khi xác nhận"
                       % (new["version"], source, new["strategy"], self.cfg["gateway"]["script_watch_s"] / 60))
        self.comms.send_direct(t, {"type": "script_status", "station": self.id, "version": new["version"],
                                   "status": "applied"}, "ack")
        return True

    def _watch_step(self, t, dt):
        w = self.watch
        if w is None:
            return
        g = self.cfg["gateway"]
        sig = self.sig
        if any(p["running"] for p in sig["pumps"]) and sig["p_ctrl"] is not None:
            w["n_s"] += dt
            if abs(sig["p_ctrl"] - self.ctrl.p_set) > g["script_rollback_err_bar"]:
                w["err_s"] += dt
        elapsed = t - w["t0"]
        frac = w["err_s"] / w["n_s"] if w["n_s"] > 0 else 0.0
        bad = (elapsed >= 120.0 and w["n_s"] >= 60.0 and frac > g["script_rollback_err_frac"]) or \
            self.safety.trip_count > w["trips0"]
        if bad and self.script_prev is not None:
            badv = self.script["version"]
            self.script = self.script_prev
            self.script_prev = None
            self.watch = None
            self.alarms.raise_(t, "SCRIPT_ROLLBACK", "alarm", "Kịch bản v%s gây sai lệch áp %.0f%% thời gian – quay lui v%s"
                               % (badv, 100 * frac, self.script["version"]))
            self.comms.send_direct(t, {"type": "script_status", "station": self.id, "version": badv, "status": "rollback",
                                       "restored": self.script["version"]}, "ack")
        elif t >= w["until"]:
            self.log_event(t, "info", "Kịch bản v%s vận hành ổn định %.0f phút – xác nhận (commit)" % (self.script["version"], elapsed / 60))
            self.comms.send_direct(t, {"type": "script_status", "station": self.id, "version": self.script["version"],
                                       "status": "committed"}, "ack")
            self.watch = None
            self.script_prev = None

    def handle_script(self, doc, t, source, conflicts=None):
        if self.script.get("local_modified"):
            self.log_event(t, "info", "Nhận kịch bản v%s trong khi có chỉnh sửa tại chỗ – chờ máy chủ hợp nhất" % doc["version"])
        self.apply_script(doc, t, source)

    def local_edit(self, patch, t, by="HMI", reason=""):
        """Kỹ thuật viên sửa tham số tại màn hình HMI của trạm."""
        params = deep_copy(self.script["params"])
        for path, v in patch.items():
            set_path(params, path, v)
        errs = validate_params(params, self.cfg["script_schema"])
        if errs:
            self.log_event(t, "alarm", "HMI: từ chối chỉnh sửa (%s)" % "; ".join(errs))
            return False
        changes = []
        for path, v in patch.items():
            changes.append({"path": path, "old": get_path(self.script["params"], path), "new": v, "t": t, "by": by, "reason": reason})
        self.script["params"] = params
        self.script["local_modified"] = True
        self.script["hash"] = script_hash(self.script)
        self.local_changes.extend(changes)
        self.log_event(t, "info", "HMI tại trạm (%s): %s" % (by, ", ".join("%s=%s" % (c["path"], c["new"]) for c in changes)))
        if self.offline_since is None and self.comms.state == "online":
            self.comms.send_direct(t, {"type": "local_change", "station": self.id, "base_version": self.script["version"],
                                       "changes": changes}, "sync")
        return True

    def on_version_assigned(self, msg, t):
        self.script["version"] = msg["version"]
        self.script["local_modified"] = False
        self.local_changes = []
        self.log_event(t, "info", "Máy chủ ghi nhận chỉnh sửa tại chỗ thành kịch bản v%s" % msg["version"])

    def handle_sync_plan(self, msg, t):
        off = msg.get("clock_offset", 0.0)
        if abs(off) > 0.0:
            self.log_event(t, "info", "Hiệu chỉnh đồng hồ gateway: lệch %.2f s sau thời gian mất mạng" % off)
        self.clock_offset = 0.0
        self.conflicts = msg.get("conflicts", [])
        for c in self.conflicts:
            self.log_event(t, "info", "Xung đột %s: server=%s, tại chỗ=%s → %s (%s)" % (c["path"], c["server"], c["local"], c["result"], c["rule"]))
        if msg.get("script") is not None:
            self.apply_script(msg["script"], t, "đồng bộ sau mất mạng")
            self.local_changes = []
        elif msg.get("accepted_version") is not None:
            self.script["version"] = msg["accepted_version"]
            self.script["local_modified"] = False
            self.local_changes = []
            self.log_event(t, "info", "Máy chủ chấp nhận chỉnh sửa tại chỗ thành v%s" % msg["accepted_version"])
        for cmd in msg.get("commands", []):
            self.handle_command(cmd, t, "đồng bộ")

    # ---------- lệnh từ xa ----------
    def handle_command(self, cmd, t, via, src="remote"):
        cid = cmd["id"]
        if cid in self.applied_cmds:
            self._ack_cmd(t, cmd, "duplicate", "đã thực thi trước đó")
            return
        now = t + self.clock_offset
        if now > cmd["expires_at"]:
            self._ack_cmd(t, cmd, "expired", "hết hạn lúc %.0f s (nhận lúc %.0f s)" % (cmd["expires_at"], now))
            self.log_event(t, "info", "Từ chối lệnh %s (%s): đã hết hạn – tránh thực thi lệnh dựa trên trạng thái cũ" % (cmd["type"], via))
            self.applied_cmds.append(cid)
            return
        typ = cmd["type"]
        a = cmd.get("args", {})
        ok, why = True, "ok"
        if typ == "set_override":
            ttl = min(a.get("ttl_s", self.script["params"]["offline"]["override_ttl_s"]), cmd["expires_at"] - now)
            self.override = {"p_set": a["p_set_bar"], "until": t + ttl, "id": cid}
            why = "ghi đè áp đặt %.2f bar trong %.0f phút" % (a["p_set_bar"], ttl / 60)
        elif typ == "clear_override":
            self.override = None
        elif typ == "rotate_pumps":
            self.ctrl.force_rotate = True
            why = "sẽ luân phiên bơm"
        elif typ == "reset_safe_stop":
            ok, why = self.safety.request_reset(t, self)
        elif typ == "ack_alarm":
            ok = self.alarms.ack(a.get("code", ""), t)
            why = "đã xác nhận" if ok else "không có báo động"
        elif typ == "flush_tank":
            if self.safety.safe_stop:
                self.flush = {"target": a.get("target_m", 1.4)}
                why = "mở van xả VX-01 tới mức %.1f m" % self.flush["target"]
            else:
                ok, why = False, "chỉ xả bể khi trạm đang dừng an toàn"
        elif typ in MANUAL_CMDS:
            ok, why = self._manual_cmd(typ, a, t, src)
        elif typ == "select_pt":
            if a.get("tag") in self.sig_proc.installed:
                self.sig_proc.forced_pt = a.get("tag")
                why = "dùng %s cho điều khiển" % a.get("tag")
            else:
                ok, why = False, "%s không được lắp đặt tại trạm" % a.get("tag")
        else:
            ok, why = False, "lệnh không hỗ trợ"
        self.applied_cmds.append(cid)
        if src == "local":
            text = "HMI tại trạm – %s: %s" % (typ, why if ok else "TỪ CHỐI – " + why)
            self.cmd_results.append({"t": t, "id": cid, "type": typ, "status": "ok" if ok else "rejected", "reason": why})
            self.logs.append({"t": t, "level": "info" if ok else "alarm", "text": text})
            self.comms.push_event({"kind": "log", "t": t, "sev": "info", "text": text})
            return ok
        self._ack_cmd(t, cmd, "ok" if ok else "rejected", why)
        self.log_event(t, "info" if ok else "alarm", "Lệnh từ xa %s (%s): %s" % (typ, via, why if ok else "TỪ CHỐI – " + why))
        return ok

    def local_command(self, typ, args, t):
        """Lệnh của kỹ thuật viên trên màn hình HMI tại tủ điều khiển (không qua mạng, không hết hạn)."""
        self.local_seq += 1
        cmd = {"id": "L%04d" % self.local_seq, "type": typ, "args": dict(args or {}), "expires_at": t + 1e9}
        return self.handle_command(cmd, t, "HMI tại trạm", "local")

    def control_src(self):
        return "auto" if self.manual is None else self.manual["src"]

    def _manual_cmd(self, typ, a, t, src):
        """Vận hành bằng tay: quyền tại chỗ ưu tiên hơn từ xa; lệnh từ xa có thời hạn (lease);
        mọi lệnh tay vẫn đi qua lớp an toàn và bộ quản lý bơm (liên động, số lần khởi động)."""
        m = self.manual
        n = len(self.pump_tags)
        pm = self.cfg["pump_model"]
        lease = self.cfg["gateway"]["manual_lease_s"]
        if src == "remote" and m is not None and m["src"] == "local":
            return False, "trạm đang điều khiển TẠI CHỖ – quyền HMI tại trạm ưu tiên, từ chối lệnh từ xa"
        if typ == "set_mode":
            if a.get("mode", "manual") == "auto":
                if m is None:
                    return True, "trạm đã ở chế độ tự động"
                self._end_manual(t, "lệnh " + SRC_NAME[src])
                return True, "trở về TỰ ĐỘNG theo kịch bản v%s" % self.script["version"]
            pumps = self.sig["pumps"] if self.sig else [{"running": False, "f": 0.0}] * n
            if m is None:
                self.manual = {"src": src, "t0": t, "until": t + lease if src == "remote" else None,
                               "run": [bool(self.pm.cmd[i]) for i in range(n)],
                               "f": [round(pumps[i]["f"], 1) if pumps[i]["running"] else 40.0 for i in range(n)],
                               "valve": True}
                self.alarms.raise_(t, "MANUAL_MODE", "warning", "Trạm ở chế độ TAY – điều khiển %s; kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động" % SRC_NAME[src])
            else:
                self._take_over(t, src, lease)
            return True, "chuyển sang chế độ TAY %s%s" % (SRC_NAME[src], (", quyền có hạn %.0f phút, tự trở về tự động khi mất kết nối" % (lease / 60)) if src == "remote" else "")
        if m is None:
            return False, "trạm đang ở chế độ TỰ ĐỘNG – cần chuyển sang TAY trước"
        self._take_over(t, src, lease)
        if typ == "valve":
            m["valve"] = bool(a.get("open", True))
            return True, "%s van MV-02" % ("mở" if m["valve"] else "đóng")
        i = int(a.get("pump", 0))
        if i < 0 or i >= n:
            return False, "không có bơm %s" % i
        tag = self.pump_tags[i]
        if "f_hz" in a:
            m["f"][i] = clamp(float(a["f_hz"]), pm["f_min_hz"], pm["f_max_hz"])
        if typ == "pump_start":
            if self.sig and self.sig["pumps"][i]["fault"]:
                return False, "%s đang báo lỗi biến tần/bơm" % tag
            m["run"][i] = True
            return True, "chạy %s ở %.1f Hz" % (tag, m["f"][i])
        if typ == "pump_stop":
            m["run"][i] = False
            return True, "dừng %s" % tag
        return True, "đặt tần số %s = %.1f Hz" % (tag, m["f"][i])

    def _take_over(self, t, src, lease):
        m = self.manual
        if m["src"] != src:
            self.log_event(t, "info", "Quyền điều khiển TAY chuyển sang %s" % SRC_NAME[src])
            m["src"] = src
            self.alarms.active.get("MANUAL_MODE", {})["msg"] = "Trạm ở chế độ TAY – điều khiển %s; kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động" % SRC_NAME[src]
        m["until"] = t + lease if src == "remote" else None

    def _end_manual(self, t, why):
        m = self.manual
        self.manual = None
        running = [i for i, c in enumerate(self.pm.cmd) if c]
        if running:
            self.ctrl.duty = running[0]  # bơm đang chạy tay trở thành bơm chính – tránh đảo bơm khi tiếp quản
        self.alarms.clear(t, "MANUAL_MODE")
        self.log_event(t, "info", "Kết thúc chế độ TAY %s sau %.0f phút (%s) – kịch bản v%s tiếp quản"
                       % (SRC_NAME[m["src"]], (t - m["t0"]) / 60.0, why, self.script["version"]))

    def _manual_output(self, t, dt):
        m = self.manual
        if m["src"] == "remote":
            if self.offline_since is not None:
                self.log_event(t, "safety", "Mất kết nối khi đang điều khiển TAY từ xa – tự trở về TỰ ĐỘNG (không để trạm chạy theo lệnh cũ)")
                self._end_manual(t, "mất kết nối")
                return None
            if t >= m["until"]:
                self._end_manual(t, "hết thời hạn quyền điều khiển từ xa")
                return None
        self.manual_s += dt
        n = len(m["run"])
        order = [i for i in range(n) if m["run"][i]] + [i for i in range(n) if not m["run"][i]]
        return {"n": sum(1 for r in m["run"] if r), "f_ref": max([m["f"][i] for i in range(n) if m["run"][i]] or [0.0]),
                "order": order, "p_set": self.ctrl.p_set}

    def _ack_cmd(self, t, cmd, status, reason):
        self.cmd_results.append({"t": t, "id": cmd["id"], "type": cmd["type"], "status": status, "reason": reason})
        self.comms.push_event({"kind": "cmd_ack", "id": cmd["id"], "status": status, "reason": reason, "t": t, "sev": "info"})

    # ---------- bản ghi đo xa ----------
    def make_record(self, t):
        L = self.last
        p = L.get("p")
        q = L.get("q")
        return {"t0": t, "t1": t, "ts0": t + self.clock_offset, "ts1": t + self.clock_offset,
                "p": p, "p_min": p if p is not None else 0.0, "p_max": p if p is not None else 0.0,
                "p_set": L.get("p_set"), "q": q, "q_min": q if q is not None else 0.0, "q_max": q if q is not None else 0.0,
                "q_in": L.get("q_in"), "level": L.get("level"), "cl": L.get("cl"), "ntu": L.get("ntu"), "ph": L.get("ph"),
                "kw": L.get("kw"), "kwh": L.get("kwh"), "f1": L.get("f1"), "f2": L.get("f2"), "mode": self.mode(),
                "ctl": self.control_src()}

    def mode(self):
        st = self.safety.state
        if st != "normal" or self.alarms.d_active():
            return "d"
        if self.comms.state == "resync":
            return "c"
        if self.comms.state == "offline":
            return "b"
        return "a"

    # ---------- chu kỳ quét ----------
    def step(self, t, dt, meas):
        self.t = t
        if self.offline_since is not None:
            self.clock_offset += self.cfg["gateway"]["clock_drift_ppm"] * 1e-6 * dt
        self.comms.receive(t)
        sig = self.sig_proc.process(t, dt, meas, self)
        self.sig = sig
        for i, p in enumerate(meas["pumps"]):
            self.alarms.set(t, "PUMP_FAULT_" + self.pump_tags[i], p["fault"], "alarm", "Biến tần/bơm %s báo lỗi" % self.pump_tags[i])
        running = any(p["running"] for p in meas["pumps"])
        delivering = running and meas["outlet_frac"] > 0.99 and not self.safety.safe_stop
        if delivering:
            if self.stopped_s > 600.0:
                # sau một lần ngừng cấp > 10 phút, nhu cầu tăng vọt do bồn mái nạp bù: không học, không xét bất thường
                win = max(3.0 * 3600.0, 1.5 * self.stopped_s)
                self.recover_until = t + win
                self.log_event(t, "info", "Cấp nước trở lại sau %.0f phút ngừng – bồn mái nạp bù, tạm dừng học dự báo và phát hiện bất thường %.1f h"
                               % (self.stopped_s / 60, win / 3600))
            self.stopped_s = 0.0
        elif self.ctrl.sleep_state != "sleep":
            self.stopped_s += dt
        learn = (delivering and self.ctrl.conserve == 0 and not self.ctrl.level_stop and t >= self.recover_until)
        pd = self.script["params"]["predictive"]
        self.forecaster.update(t, sig["q_f"], learn, pd)
        if self.script["params"]["features"]["anomaly_detection"] and t >= self.recover_until:
            self.alarms.set(t, "FLOW_ANOMALY", self.forecaster.anomaly, "alarm",
                            "Lưu lượng cao hơn dự báo %.1f m³/h kéo dài – nghi rò rỉ/vỡ ống" % self.forecaster.resid)
        else:
            self.alarms.clear(t, "FLOW_ANOMALY")
        mo = self._manual_output(t, dt) if self.manual is not None else None
        co = self.ctrl.step(t, dt, sig, self)
        if mo is not None:
            co = mo
        fo = self.safety.evaluate(t, dt, sig, co, self, meas)
        run = self.pm.apply(t, fo["n"], fo["order"], meas["pumps"], self)
        m = self.manual
        if mo is not None and fo["block"] and not fo["block"].startswith("chờ van"):
            # liên động/cắt an toàn ở chế độ tay: bơm không tự chạy lại, người vận hành phải ra lệnh mới
            for i, r in enumerate(m["run"]):
                if r:
                    m["run"][i] = False
                    self.log_event(t, "safety", "Liên động an toàn dừng %s khi đang chạy TAY (%s) – cần lệnh chạy lại" % (self.pump_tags[i], fo["block"]))
        drain = False
        if self.flush is not None:
            if not self.safety.safe_stop or sig["level"] <= self.flush["target"]:
                self.log_event(t, "info", "Xả bể kết thúc ở mức %.2f m" % sig["level"])
                self.flush = None
            else:
                drain = True
        self._watch_step(t, dt)
        if int(t) % 60 == 0:
            self.alarms.expire_events(t)
        f_ref = fo["f_ref"]
        if mo is not None:
            f_each = [min(m["f"][i], self.safety.f_cap) if run[i] else 0.0 for i in range(len(run))]
        else:
            f_each = [f_ref if r else 0.0 for r in run]
        self.last = {"p": sig["p_ctrl"], "p_set": self.ctrl.p_set, "q": sig["q_f"], "q_in": sig["q_in_f"], "level": sig["level"],
                     "cl": sig["cl"], "ntu": sig["ntu"], "ph": sig["ph"], "kw": meas["kw"], "kwh": meas["kwh"],
                     "f1": meas["pumps"][0]["f"], "f2": meas["pumps"][1]["f"]}
        self.comms.tick(t, dt)
        self.out = {"run": run, "f_ref": f_each, "outlet_open": fo["outlet_open"] and (mo is None or m["valve"]),
                    "drain_open": drain}
        return self.out
