// Máy chủ điều hành – tương đương trambom/server.py
import { deepCopy, flatten, setPath, valuesEqual } from './util.js';

const bmax = (a, b) => (typeof a === 'boolean' ? a || b : Math.max(a, b));
const bmin = (a, b) => (typeof a === 'boolean' ? a && b : Math.min(a, b));

export function threeWayMerge(base, server, local, policy) {
  const fb = flatten(base), fs = flatten(server), fl = flatten(local);
  const keys = [...new Set([...Object.keys(fb), ...Object.keys(fs), ...Object.keys(fl)])].sort();
  const merged = deepCopy(server);
  const conflicts = [], decisions = [];
  const smax = new Set(policy.service_max ?? []), smin = new Set(policy.service_min ?? []);
  for (const k of keys) {
    const b = fb[k], s = fs[k], l = fl[k];
    let r;
    if (valuesEqual(s, l)) r = s;
    else if (valuesEqual(s, b)) { r = l; decisions.push({ path: k, from: 'tại chỗ', value: l }); }
    else if (valuesEqual(l, b)) { r = s; decisions.push({ path: k, from: 'máy chủ', value: s }); }
    else {
      let rule;
      if (smax.has(k)) { r = bmax(s, l); rule = 'tham số dịch vụ/an toàn → chọn giá trị bảo thủ (lớn hơn)'; }
      else if (smin.has(k)) { r = bmin(s, l); rule = 'tham số bảo vệ thiết bị → chọn giá trị bảo thủ (nhỏ hơn)'; }
      else { r = s; rule = 'tham số vận hành → máy chủ thắng, chuyển điều độ viên rà soát'; }
      conflicts.push({ path: k, base: b, server: s, local: l, result: r, rule });
    }
    setPath(merged, k, r);
  }
  return [merged, conflicts, decisions];
}

export class OperationsServer {
  constructor(cfg) { this.cfg = cfg; this.t = 0; this.stations = {}; this.alarms = new Map(); this.alarm_history = []; this.logs = []; this.cmd_seq = 0; this.onLog = null; }
  log(t, station, level, text) {
    const e = { t, station, level, text };
    this.logs.push(e);
    if (this.logs.length > 5000) this.logs = this.logs.slice(-4000);
    if (this.onLog) this.onLog(e);
  }
  register(sid, link, scriptDoc, name = '') {
    const doc = deepCopy(scriptDoc);
    doc.author = doc.author ?? 'server'; doc.reason = doc.reason ?? 'kịch bản ban đầu'; doc.t = doc.t ?? 0;
    this.stations[sid] = {
      id: sid, name, link, online: true, last_seen: 0, repo: { [doc.version]: doc }, target: doc.version, reported: doc.version,
      pending: {}, cmd_log: [], seen: new Set(), records: 0, records_agg: 0, late: 0, series: new Map(), last: {}, sync_log: [],
      conflicts: [], offline_periods: [], events: 0, status_log: [],
    };
  }
  _maxVersion(st) { return Math.max(...Object.keys(st.repo).map(Number)); }
  publishScript(sid, patch, t, by = 'Điều độ viên', reason = '', strategy = null) {
    const st = this.stations[sid];
    const cur = st.repo[st.target];
    const params = deepCopy(cur.params);
    for (const [path, v] of Object.entries(patch)) setPath(params, path, v);
    const vNew = this._maxVersion(st) + 1;
    const doc = { version: vNew, strategy: strategy || cur.strategy, params, author: by, reason, t, parent: cur.version };
    st.repo[vNew] = doc; st.target = vNew;
    this.log(t, sid, 'info', `Phát hành kịch bản v${vNew} (${by}): ` + Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', '));
    if (st.online) st.link.sendDown(t, { type: 'script', doc: deepCopy(doc) }, this.cfg.gateway.msg_bytes.sync);
    else this.log(t, sid, 'info', `Trạm ${sid} đang mất kết nối – kịch bản v${vNew} chờ đồng bộ (retained)`);
    return vNew;
  }
  sendCommand(sid, ctype, args, t, ttl = 900.0, by = 'Điều độ viên') {
    const st = this.stations[sid];
    this.cmd_seq += 1;
    const cmd = { id: 'C' + String(this.cmd_seq).padStart(4, '0'), type: ctype, args: { ...args }, issued_at: t, expires_at: t + ttl, by };
    st.pending[cmd.id] = { cmd, sent: null };
    st.cmd_log.push({ t, id: cmd.id, type: ctype, status: 'queued', reason: '' });
    this.log(t, sid, 'info', `Lệnh ${cmd.id} ${ctype} (hạn ${(ttl / 60).toFixed(0)} phút)` + (st.online ? '' : ' – trạm mất kết nối, xếp hàng'));
    if (st.online) this._sendCmd(t, st, cmd.id);
    return cmd.id;
  }
  ackAlarm(sid, code, t) {
    const a = this.alarms.get(sid + '|' + code);
    if (a) a.acked = true;
    return this.sendCommand(sid, 'ack_alarm', { code }, t, 3600);
  }
  _sendCmd(t, st, cid) {
    const p = st.pending[cid];
    p.sent = t;
    st.link.sendDown(t, { type: 'cmd', cmd: deepCopy(p.cmd) }, this.cfg.gateway.msg_bytes.cmd);
  }
  step(t) {
    this.t = t;
    for (const [sid, st] of Object.entries(this.stations)) {
      for (const msg of st.link.recvServer(t)) this._handle(t, st, msg);
      if (st.online && t - st.last_seen > this.cfg.server.offline_after_s) {
        st.online = false;
        st.offline_periods.push([st.last_seen, null]);
        this.log(t, sid, 'alarm', `Trạm ${sid} mất kết nối (LWT) – lần cuối nhận dữ liệu ${(t - st.last_seen).toFixed(0)} s trước`);
        this._centralAlarm(t, sid, 'STATION_OFFLINE', 'warning', 'Mất kết nối với trạm', 'raise');
      }
      for (const cid of Object.keys(st.pending)) {
        const p = st.pending[cid];
        if (t > p.cmd.expires_at) {
          delete st.pending[cid];
          st.cmd_log.push({ t, id: cid, type: p.cmd.type, status: 'expired_server', reason: 'hết hạn trước khi trạm xác nhận' });
          this.log(t, sid, 'info', `Lệnh ${cid} ${p.cmd.type} hết hạn trước khi trạm nhận – hủy`);
        } else if (st.online && p.sent !== null && t - p.sent > this.cfg.server.cmd_resend_s) this._sendCmd(t, st, cid);
      }
    }
  }
  _handle(t, st, msg) {
    const typ = msg.type; const sid = st.id; const link = st.link; const nb = this.cfg.gateway.msg_bytes;
    if (!st.online && ['hb', 'tel', 'evt', 'sync_hello'].includes(typ)) {
      st.online = true;
      const op = st.offline_periods[st.offline_periods.length - 1];
      if (op && op[1] === null) op[1] = t;
      this.log(t, sid, 'info', `Trạm ${sid} kết nối lại`);
      this._centralAlarm(t, sid, 'STATION_OFFLINE', 'warning', '', 'clear');
    }
    st.last_seen = t;
    if (typ === 'hb') link.sendDown(t, { type: 'hb_ack', server_t: t }, nb.ack);
    else if (typ === 'tel') {
      const r = msg.rec;
      const lo = r.seq_lo, hi = r.seq_hi;
      let nNew = 0;
      for (let s = lo; s <= hi; s++) if (!st.seen.has(s)) { st.seen.add(s); nNew++; }
      if (nNew) {
        st.records += nNew;
        if (r.n > 1) st.records_agg += nNew;
        const late = t - r.t1 > 60.0;
        if (late) st.late += nNew;
        const m0 = Math.floor(r.t0 / 60), m1 = Math.floor(r.t1 / 60);
        for (let m = m0; m <= m1; m++) if (!st.series.has(m)) st.series.set(m, { p: r.p, q: r.q, level: r.level, kw: r.kw, agg: r.n > 1, late });
        st.last = r;
      }
      link.sendDown(t, { type: 'tel_ack', seq_lo: lo, seq_hi: hi }, nb.ack);
    } else if (typ === 'evt') {
      const e = msg.evt;
      st.events += 1;
      if (e.kind === 'alarm') this._centralAlarm(e.t, sid, e.code, e.sev, e.msg, e.action);
      else if (e.kind === 'cmd_ack') {
        delete st.pending[e.id];
        st.cmd_log.push({ t, id: e.id, type: '', status: e.status, reason: e.reason });
        this.log(t, sid, 'info', `Trạm xác nhận lệnh ${e.id}: ${e.status} (${e.reason})`);
      } else if (e.kind === 'log') this.log(e.t, sid, 'warning', e.text);
      link.sendDown(t, { type: 'evt_ack', eseqs: [e.eseq] }, nb.ack);
    } else if (typ === 'sync_hello') this._sync(t, st, msg);
    else if (typ === 'script_status') {
      st.status_log.push({ t, version: msg.version, status: msg.status });
      if (msg.status === 'applied' || msg.status === 'committed') st.reported = msg.version;
      if (msg.status === 'rollback') {
        st.target = msg.restored; st.reported = msg.restored;
        this.log(t, sid, 'alarm', `Trạm quay lui kịch bản v${msg.version} → v${msg.restored}; đánh dấu v${msg.version} lỗi`);
        if (st.repo[msg.version]) st.repo[msg.version].failed = true;
      }
      if (msg.status === 'rejected') { st.target = st.reported; this.log(t, sid, 'alarm', `Trạm từ chối kịch bản v${msg.version}: ` + (msg.reason ?? []).join('; ')); }
    } else if (typ === 'local_change') this._localChange(t, st, msg);
  }
  _localChange(t, st, msg) {
    const baseV = msg.base_version; const base = st.repo[baseV];
    const local = deepCopy(base.params);
    for (const c of msg.changes) setPath(local, c.path, c.new);
    const nb = this.cfg.gateway.msg_bytes;
    const vNew = this._maxVersion(st) + 1;
    if (st.target === baseV) {
      st.repo[vNew] = { version: vNew, strategy: base.strategy, params: local, author: 'HMI tại trạm', reason: msg.changes.map((c) => c.reason ?? '').join(', '), t, parent: baseV };
      st.target = vNew; st.reported = vNew;
      st.link.sendDown(t, { type: 'version_assigned', version: vNew }, nb.ack);
      this.log(t, st.id, 'info', `Ghi nhận chỉnh sửa tại chỗ thành v${vNew}`);
    } else {
      const [merged, conflicts] = threeWayMerge(base.params, st.repo[st.target].params, local, this.cfg.merge_policy);
      const doc = { version: vNew, strategy: st.repo[st.target].strategy, params: merged, author: 'hợp nhất', reason: `chỉnh sửa tại chỗ + v${st.target}`, t, parent: st.target };
      st.repo[vNew] = doc; st.target = vNew; st.conflicts.push(...conflicts);
      st.link.sendDown(t, { type: 'script', doc: deepCopy(doc), conflicts }, nb.sync);
    }
  }
  _sync(t, st, msg) {
    const sid = st.id; const baseV = msg.base_version;
    const base = st.repo[baseV] ?? st.repo[st.reported];
    const target = st.repo[st.target];
    const changes = msg.local_changes;
    const plan = { type: 'sync_plan', script: null, accepted_version: null, conflicts: [], decisions: [], commands: [], clock_offset: msg.gw_clock - t, server_t: t };
    const vNew = this._maxVersion(st) + 1;
    if (st.target === baseV) {
      if (changes.length) {
        st.repo[vNew] = { version: vNew, strategy: msg.strategy, params: deepCopy(msg.params), author: 'HMI tại trạm (khi mất mạng)', reason: 'chấp nhận chỉnh sửa tại chỗ', t, parent: baseV };
        st.target = vNew; plan.accepted_version = vNew;
      }
    } else if (!changes.length) plan.script = deepCopy(target);
    else {
      const [merged, conflicts, decisions] = threeWayMerge(base.params, target.params, msg.params, this.cfg.merge_policy);
      const doc = { version: vNew, strategy: target.strategy, params: merged, author: 'hợp nhất tự động', reason: `v${target.version} (máy chủ) + chỉnh sửa tại chỗ trên v${baseV}`, t, parent: target.version };
      st.repo[vNew] = doc; st.target = vNew; plan.script = deepCopy(doc); plan.conflicts = conflicts; plan.decisions = decisions; st.conflicts.push(...conflicts);
    }
    for (const cid of Object.keys(st.pending).sort()) {
      const p = st.pending[cid];
      if (t <= p.cmd.expires_at) { plan.commands.push(deepCopy(p.cmd)); p.sent = t; }
    }
    st.link.sendDown(t, plan, this.cfg.gateway.msg_bytes.sync);
    st.sync_log.push({
      t, offline_since: msg.offline_since, buffer_records: msg.buffer_records, pending_events: msg.pending_events, local_changes: changes.length,
      conflicts: plan.conflicts, decisions: plan.decisions, script_version: plan.script ? plan.script.version : plan.accepted_version,
      commands: plan.commands.map((c) => c.id + ' ' + c.type), clock_offset: plan.clock_offset,
    });
    this.log(t, sid, 'info', `Đồng bộ trạm ${sid}: ${msg.buffer_records} bản ghi đệm, ${changes.length} chỉnh sửa tại chỗ, ${plan.conflicts.length} xung đột, ${plan.commands.length} lệnh còn hạn`);
  }
  _centralAlarm(t, sid, code, sev, msg, action) {
    const key = sid + '|' + code;
    if (action === 'raise') {
      this.alarms.set(key, { station: sid, code, sev, msg, t, acked: false, active: true });
      this.alarm_history.push({ t, station: sid, code, sev, msg, action: 'raise' });
    } else {
      if (this.alarms.has(key)) this.alarms.delete(key);
      this.alarm_history.push({ t, station: sid, code, sev, msg, action: 'clear' });
    }
  }
}
