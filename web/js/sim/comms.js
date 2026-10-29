// Tầng truyền thông phía gateway – tương đương trambom/comms.py
export const MAX_AGG = 64;
const NUM_FIELDS = ['p', 'p_set', 'q', 'q_in', 'level', 'cl', 'ntu', 'ph', 'kw', 'f1', 'f2'];

export function mergeRecords(a, b) {
  const na = a.n, nb = b.n;
  const out = { seq_lo: a.seq_lo, seq_hi: b.seq_hi, t0: a.t0, t1: b.t1, ts0: a.ts0, ts1: b.ts1, n: na + nb, sent: null, acked: false, mode: b.mode, kwh: b.kwh };
  for (const k of NUM_FIELDS) {
    const va = a[k], vb = b[k];
    out[k] = va === null || vb === null ? (vb === null ? va : vb) : (va * na + vb * nb) / (na + nb);
  }
  out.p_min = Math.min(a.p_min, b.p_min); out.p_max = Math.max(a.p_max, b.p_max);
  out.q_min = Math.min(a.q_min, b.q_min); out.q_max = Math.max(a.q_max, b.q_max);
  return out;
}

export class CommsClient {
  constructor(cfg, link, gw) {
    const g = cfg.gateway;
    this.g = g; this.link = link; this.gw = gw; this.bytes = g.msg_bytes;
    this.state = 'online'; this.last_ack = 0; this.next_hb = 0; this.next_tel = g.telemetry_s;
    this.buf = []; this.events = []; this.seq = 0; this.eseq = 0; this.budget = 0;
    this.sync_phase = null; this.hello_t = null; this.sync_started = null; this.any_acked = false;
    this.stats = { generated: 0, dropped: 0, compactions: 0, max_fill: 0, events_dropped: 0, syncs: 0, offline_s: 0, outages: 0, sms: 0 };
  }
  receive(t) {
    for (const msg of this.link.recvGateway(t)) {
      const typ = msg.type;
      if (typ === 'hb_ack') { this.last_ack = t; if (this.state === 'offline') this._onReconnect(t); }
      else if (typ === 'tel_ack') {
        for (const r of this.buf) if (r.seq_lo >= msg.seq_lo && r.seq_hi <= msg.seq_hi) { r.acked = true; this.any_acked = true; }
      } else if (typ === 'evt_ack') { const ids = new Set(msg.eseqs); this.events = this.events.filter((e) => !ids.has(e.eseq)); }
      else if (typ === 'cmd') this.gw.handleCommand(msg.cmd, t, 'trực tuyến');
      else if (typ === 'script') this.gw.handleScript(msg.doc, t, 'phát hành trực tuyến', msg.conflicts);
      else if (typ === 'version_assigned') this.gw.onVersionAssigned(msg, t);
      else if (typ === 'sync_plan') { this.gw.handleSyncPlan(msg, t); this.sync_phase = 'replay'; }
    }
  }
  _onReconnect(t) {
    this.state = 'resync'; this.sync_phase = 'hello'; this.sync_started = t; this.stats.syncs += 1;
    this.gw.onOnline(t);
    this._sendHello(t);
  }
  _sendHello(t) {
    const gw = this.gw;
    this.hello_t = t;
    const msg = {
      type: 'sync_hello', station: gw.id, base_version: gw.script.version, params: gw.script.params, strategy: gw.script.strategy,
      local_changes: [...gw.local_changes], buffer_records: this.buf.length, pending_events: this.events.length,
      gw_clock: t + gw.clock_offset, offline_since: gw.last_offline_since, applied_cmds: gw.applied_cmds.slice(-50),
    };
    this.link.sendUp(t, msg, this.bytes.sync);
  }
  tick(t, dt) {
    const g = this.g;
    if (this.state !== 'offline' && t - this.last_ack > g.offline_after_s) {
      this.state = 'offline'; this.sync_phase = null; this.stats.outages += 1;
      this.gw.onOffline(t, this.last_ack);
    }
    if (this.state === 'offline') this.stats.offline_s += dt;
    if (t >= this.next_hb) { this.link.sendUp(t, { type: 'hb', station: this.gw.id, t }, this.bytes.hb); this.next_hb += g.heartbeat_s; }
    if (t >= this.next_tel) { this.pushRecord(this.gw.makeRecord(t)); this.next_tel += g.telemetry_s; }
    if (this.state === 'resync' && this.sync_phase === 'hello' && t - this.hello_t > 30.0) this._sendHello(t);
    const canSend = this.state === 'online' || (this.state === 'resync' && this.sync_phase === 'replay');
    if (canSend) this._send(t, dt);
    if (this.any_acked) { this.buf = this.buf.filter((r) => !r.acked); this.any_acked = false; }
    const fill = this.buf.length / g.buffer_capacity;
    if (fill > this.stats.max_fill) this.stats.max_fill = fill;
    if (this.state === 'resync' && this.sync_phase === 'replay' && this.buf.length <= 2 && this.events.length === 0) {
      this.state = 'online'; this.sync_phase = null;
      this.gw.logEvent(t, 'info', `Đồng bộ hoàn tất sau ${(t - this.sync_started).toFixed(0)} s – trở lại chế độ (a) bình thường`);
    }
  }
  _send(t, dt) {
    const g = this.g;
    const rate = g.replay_rate_per_s;
    this.budget = Math.min(this.budget + rate * dt, 2.0 * rate);
    const rt = g.retransmit_s;
    if (this.buf.length) {
      const live = this.buf[this.buf.length - 1];
      if (live.sent === null || t - live.sent > rt) this._sendRec(t, live);
    }
    for (const r of this.buf) {
      if (this.budget < 1.0) break;
      if (r.sent === null || (t - r.sent > rt && !r.acked)) { this._sendRec(t, r); this.budget -= 1.0; }
    }
    for (const e of this.events) {
      if (e.sent === null || t - e.sent > rt) { e.sent = t; this.link.sendUp(t, { type: 'evt', station: this.gw.id, evt: e }, this.bytes.event); }
    }
  }
  _sendRec(t, r) { r.sent = t; this.link.sendUp(t, { type: 'tel', station: this.gw.id, rec: { ...r } }, this.bytes.tel); }
  pushRecord(rec) {
    this.seq += 1;
    Object.assign(rec, { seq_lo: this.seq, seq_hi: this.seq, n: 1, sent: null, acked: false });
    this.buf.push(rec);
    this.stats.generated += 1;
    const cap = this.g.buffer_capacity;
    if (this.buf.length >= this.g.buffer_compact_at * cap) this.compact();
    while (this.buf.length > cap) { const r = this.buf.shift(); this.stats.dropped += r.n; }
  }
  compact() {
    const fill = 100.0 * this.buf.length / this.g.buffer_capacity;
    const half = Math.floor(this.buf.length / 2);
    const out = [];
    let i = 0, merged = false;
    while (i < half) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (i + 1 < half && a.n + b.n <= MAX_AGG && a.sent === null && b.sent === null) { out.push(mergeRecords(a, b)); i += 2; merged = true; }
      else { out.push(a); i += 1; }
    }
    if (merged) {
      this.buf = out.concat(this.buf.slice(half));
      this.stats.compactions += 1;
      this.gw.logEvent(this.gw.t, 'info', `Bộ đệm đạt ${fill.toFixed(0)}% – nén nửa dữ liệu cũ (gộp cặp bản ghi), còn ${this.buf.length} bản ghi`);
    }
  }
  pushEvent(ev) {
    this.eseq += 1;
    ev.eseq = this.eseq; ev.sent = null;
    this.events.push(ev);
    const cap = this.g.event_capacity;
    while (this.events.length > cap) {
      let idx = this.events.findIndex((e) => e.sev === 'info');
      if (idx < 0) idx = 0;
      this.events.splice(idx, 1);
      this.stats.events_dropped += 1;
    }
    if (this.state === 'online') { ev.sent = this.gw.t; this.link.sendUp(this.gw.t, { type: 'evt', station: this.gw.id, evt: ev }, this.bytes.event); }
  }
  sendDirect(t, msg, kind) { this.link.sendUp(t, msg, this.bytes[kind] ?? 100); }
}
