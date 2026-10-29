// Ghép mô hình, trạm song sinh – tương đương trambom/engine.py
import { FixedSchedule } from './baseline.js';
import { Disturbances } from './demand.js';
import { GatewayFallback } from './fallback.js';
import { Gateway, MANUAL_CMDS, hwOn } from './gateway.js';
import { KpiTracker } from './kpi.js';
import { Link } from './link.js';
import { Plant } from './physics.js';
import { SensorSet } from './sensors.js';
import { OperationsServer } from './server.js';
import { deepCopy, round3 } from './util.js';

export const HIST_FIELDS = ['t', 'p_out', 'p_set', 'p_crit', 'q_out', 'q_req', 'q_in', 'q_fc', 'level', 'cl', 'ntu', 'ph', 'kw', 'kwh', 'f1', 'f2', 'mode', 'buf', 'online', 'tte', 'q_leak', 'backlog', 'manual'];
export const MODE_CODE = { a: 0, b: 1, c: 2, d: 3, x: 4 }; // x: mini PC ngừng, mạch dự phòng điều khiển
export const CTL_CODE = { auto: 0, remote: 1, local: 2 };

export function buildScript(cfg, level, station) {
  const doc = deepCopy(cfg.script);
  const lv = cfg.levels[level];
  doc.strategy = lv.strategy;
  Object.assign(doc.params.features, lv.features);
  const mpb = 1.0e5 / (cfg.constants.rho * cfg.constants.g);
  const dz = station.dz_crit_m ?? cfg.network.dz_crit_m;
  doc.params.pressure.dz_bar = round3(dz / mpb);
  return doc;
}

export class History {
  constructor(period) { this.period = period; this.next_t = period; this.data = {}; for (const k of HIST_FIELDS) this.data[k] = []; }
  due(t) { if (t + 1e-9 >= this.next_t) { this.next_t += this.period; return true; } return false; }
  add(row) { for (const k of HIST_FIELDS) this.data[k].push(row[k] ?? NaN); }
  get length() { return this.data.t.length; }
}

export class StationSim {
  constructor(cfg, kind, station = null, level = 'basic', server = null, customFn = null, seed = null, dt = null) {
    this.cfg = cfg; this.kind = kind; this.station = station ?? cfg.stations[0]; this.sid = this.station.id;
    this.dt = dt ?? cfg.sim.dt_s; this.t = 0;
    this.plant = new Plant(cfg, this.station); this.dist = new Disturbances(cfg, this.station, seed);
    this.kpi = new KpiTracker(cfg); this.hist = new History(cfg.sim.history_period_s); this.level_min = 1e9;
    this.gw = null; this.base = null; this.server = server; this._alarm_seen = 0; this.level = level;
    this.gw_dead = null; this.gw_down_s = 0;
    this.has_mv02 = kind !== 'smart' || hwOn(cfg, 'MV-02');
    if (kind === 'smart') {
      this.sensors = new SensorSet(cfg, this.station, seed);
      this.link = new Link(cfg, this.station.seed_offset ?? 0);
      const script = buildScript(cfg, level, this.station);
      const profile = this.dist.expectedProfile(1.8);
      this.gw = new Gateway(cfg, this.station, this.link, script, profile, level);
      this.gw.custom_fn = customFn;
      this._warmStart();
      if (server) server.register(this.sid, this.link, script, this.station.name ?? '');
    } else {
      this.base = new FixedSchedule(cfg);
      for (const pu of this.plant.pumps) pu.throttle_k = cfg.baseline.throttle_k;
      this.lsll = false;
    }
  }
  _warmStart() {
    const pu = this.plant.pumps[0];
    pu.running = true; pu.cmd_run = true; pu.f = pu.f_ref = 32.0;
    this.gw.pm.cmd[0] = true; this.gw.pm.start_times[0] = [];
    this.gw.ctrl.n = 1; this.gw.ctrl.I = 32.0; this.gw.ctrl.last_f_ref = 32.0;
  }
  step() {
    const t = this.t, dt = this.dt, pl = this.plant;
    const d = this.dist.step(t, dt);
    let out, lsll;
    if (this.kind === 'smart') {
      const meas = this.sensors.read(pl, dt, t);
      this.meas = meas;
      if (this.gw_dead === null) out = this.gw.step(t, dt, meas);
      else if (this.gw_dead.restarted) {
        // mini PC đã khởi động lại: theo dõi trong khi PID nội biến tần vẫn điều khiển
        this.gw.step(t, dt, meas);
        out = this.gw_dead.step(t, dt, meas);
        if (this.gw.observe_until === null) this.gw_dead = null;
      } else { this.link.recvGateway(t); out = this.gw_dead.step(t, dt, meas); } // bản tin tới mini PC đang treo bị mất
      lsll = meas['LSLL-101'];
      const hist = this.gw.alarms.history;
      while (this._alarm_seen < hist.length) {
        const h = hist[this._alarm_seen++];
        if (h.action === 'raise') this.kpi.detectCodes(h.t, h.code);
      }
    } else {
      out = this.base.step(t, dt, pl);
      if (out.found.length) this.kpi.detectManual(t, new Set(out.found));
      const s = this.cfg.safety;
      if (this.cfg.baseline.float_protection) {
        if (!this.lsll && pl.level < s.float_lsll_m) this.lsll = true;
        else if (this.lsll && pl.level > s.float_lsll_reset_m) this.lsll = false;
      }
      lsll = this.lsll;
    }
    pl.pumps.forEach((pu, i) => { pu.cmd_run = Boolean(out.run[i]) && !lsll; pu.f_ref = out.f_ref[i]; });
    pl.outlet_cmd = this.has_mv02 ? out.outlet_open : true; pl.drain_open = out.drain_open;
    pl.step(dt, d);
    this.kpi.update(t, dt, pl);
    if (pl.level < this.level_min) this.level_min = pl.level;
    this.t = t + dt;
    if (this.hist.due(this.t)) this.hist.add(this.snapshot());
  }
  failGateway(t) {
    if (this.gw_dead !== null && !this.gw_dead.restarted) return;
    this.gw_dead = new GatewayFallback(this.cfg, this.gw, this.plant, t);
    const e = { t, level: 'critical', text: 'Mini PC (edge gateway) ngừng hoạt động – mất thu thập, điều khiển, an toàn mềm và truyền thông' };
    this.gw.logs.push(e); if (this.gw.onLog) this.gw.onLog(e);
    this.kpi.addIncident('gateway_fail', t, 'gateway_fail');
  }
  restoreGateway(t) {
    const fb = this.gw_dead;
    if (fb === null || fb.restarted) return;
    fb.restarted = true; this.gw_down_s += t - fb.t0; // mạch dự phòng điều khiển tới khi mini PC tiếp quản
    this.gw.restart(t, fb.t0, this.plant.pumps.map((pu) => ({ running: pu.running, f: pu.f })), fb.note());
  }
  snapshot() {
    const pl = this.plant;
    const row = { t: this.t, p_out: pl.p_net, p_crit: pl.p_crit, q_out: pl.q_out, q_req: pl.q_req, q_in: pl.q_in, level: pl.level, cl: pl.cl, ntu: pl.ntu, ph: pl.ph,
      kw: pl.kw, kwh: this.kpi.energy_kwh, f1: pl.pumps[0].f, f2: pl.pumps[1].f, q_leak: pl.q_leak, backlog: pl.backlog };
    if (this.gw && this.gw_dead) {
      const g = this.gw;
      row.p_set = this.gw_dead.p_set ?? NaN; row.q_fc = g.forecaster.meanAt(this.t); row.mode = MODE_CODE.x;
      row.buf = g.comms.buf.length / this.cfg.gateway.buffer_capacity; row.online = 0;
    } else if (this.gw) {
      const g = this.gw;
      row.p_set = g.ctrl.p_set; row.q_fc = g.forecaster.meanAt(this.t); row.mode = MODE_CODE[g.mode()];
      row.buf = g.comms.buf.length / this.cfg.gateway.buffer_capacity; row.online = g.comms.state !== 'offline' ? 1 : 0;
      row.tte = g.ctrl.tte_h ?? NaN; row.manual = CTL_CODE[g.controlSrc()];
    } else row.mode = -1;
    return row;
  }
  summary() {
    const s = this.kpi.summary(this.plant);
    s.level_min = this.level_min;
    if (this.gw) {
      const g = this.gw; const c = g.comms.stats;
      s.alarms_raised = { ...g.alarms.raised_count }; s.comms = { ...c }; s.forecast_mape = g.forecaster.mape(); s.sms = c.sms; s.script_version = g.script.version;
      s.manual_min = g.manual_s / 60.0;
      const dead = this.gw_dead !== null && !this.gw_dead.restarted;
      s.gw_down_min = (this.gw_down_s + (dead ? this.t - this.gw_dead.t0 : 0)) / 60.0;
      const delays = g.notify.map((n) => ((n.t_notified ?? this.t) - n.t) / 60.0);
      s.notify = { critical: delays.length, max_delay_min: delays.length ? Math.max(...delays) : 0.0,
        via: [...new Set(g.notify.map((n) => n.via ?? (n.t_notified !== null ? 'IP' : 'chưa gửi')))].sort() };
      if (this.server) {
        const st = this.server.stations[this.sid];
        s.server_records = st.records; s.completeness = c.generated ? st.records / c.generated : 1.0;
        s.server_records_agg = st.records_agg; s.server_late = st.late; s.conflicts = st.conflicts.length;
      }
      s.bytes_up = this.link.bytes_up; s.bytes_down = this.link.bytes_down;
    }
    return s;
  }
}

export function dispatchEvent(ev, t, smart, fixed, server) {
  const typ = ev.type; const sims = [smart, fixed].filter(Boolean); const sid = smart.sid;
  if (['inflow_quality', 'supply', 'burst', 'demand_scale'].includes(typ)) {
    for (const s of sims) s.dist.applyEvent(ev, t);
    const kind = typ === 'inflow_quality' ? 'inflow_quality:' + ev.param : typ;
    if (typ !== 'demand_scale') for (const s of sims) s.kpi.addIncident(kind, t, typ);
  } else if (typ === 'pump_fault' || typ === 'pump_repair') {
    for (const s of sims) { s.plant.pumps[ev.pump].fault = typ === 'pump_fault'; if (typ === 'pump_fault') s.kpi.addIncident('pump_fault', t, typ); }
  } else if (typ === 'sensor_fault') { smart.sensors.setFault(ev.tag, ev.mode, ev.value ?? 0, t); smart.kpi.addIncident('sensor_fault', t, typ); }
  else if (typ === 'sensor_repair') smart.sensors.clearFault(ev.tag);
  else if (typ === 'link_down') smart.link.setUp(false, t);
  else if (typ === 'link_up') smart.link.setUp(true, t);
  else if (typ === 'server_command') {
    const ttl = ev.ttl_s ?? (MANUAL_CMDS.includes(ev.cmd.type) ? smart.cfg.gateway.manual_cmd_ttl_s : 900.0); // null/thiếu → mặc định (như Python)
    server.sendCommand(sid, ev.cmd.type, ev.cmd.args ?? {}, t, ttl);
  }
  else if (typ === 'server_publish') server.publishScript(sid, ev.patch, t, ev.by ?? 'Điều độ viên', ev.reason ?? '', ev.strategy ?? null);
  else if (typ === 'local_edit') smart.gw.localEdit(ev.patch, t, ev.by ?? 'HMI', ev.reason ?? '');
  else if (typ === 'local_command') {
    if (smart.gw_dead && !smart.gw_dead.restarted) {
      // HMI-01 là trang web do mini PC phục vụ: mini PC treo thì thao tác HMI không tới được bộ điều khiển
      const e = { t, level: 'alarm', text: `HMI-01 mất kết nối bộ điều khiển (mini PC ngừng) – bỏ qua lệnh ${ev.cmd.type}` };
      smart.gw.logs.push(e); if (smart.gw.onLog) smart.gw.onLog(e);
    } else smart.gw.localCommand(ev.cmd.type, ev.cmd.args ?? {}, t);
  }
  else if (typ === 'gateway_fail') smart.failGateway(t);
  else if (typ === 'gateway_restore') smart.restoreGateway(t);
}

export class TwinSim {
  constructor(cfg, scenario, level = 'basic', { customFn = null, dt = null, seed = null, withFixed = true } = {}) {
    this.cfg = cfg; this.scenario = scenario; this.level = level;
    this.server = new OperationsServer(cfg);
    this.smart = new StationSim(cfg, 'smart', cfg.stations[0], level, this.server, customFn, seed, dt);
    this.fixed = withFixed ? new StationSim(cfg, 'fixed', cfg.stations[0], level, null, null, seed, dt) : null;
    this.events = [...(scenario.events ?? [])].sort((a, b) => a.t_h - b.t_h);
    this.ev_idx = 0; this.t = 0; this.dt = this.smart.dt; this.event_log = [];
  }
  applyEvent(ev, t) { dispatchEvent(ev, t, this.smart, this.fixed, this.server); this.event_log.push({ t, type: ev.type }); }
  step() {
    const t = this.t;
    while (this.ev_idx < this.events.length && this.events[this.ev_idx].t_h * 3600.0 <= t + 1e-9) this.applyEvent(this.events[this.ev_idx++], t);
    this.smart.step();
    if (this.fixed) this.fixed.step();
    this.server.step(t);
    if (this.smart.gw_dead && !this.smart.gw_dead.restarted && !this.server.stations[this.smart.sid].online) this.smart.kpi.detectKind(t, 'gateway_fail', 'máy chủ mất nhịp tim (LWT)');
    this.t = this.smart.t;
  }
  run(hours = null) {
    hours = hours ?? this.scenario.duration_h ?? 24;
    const n = Math.round(hours * 3600.0 / this.dt);
    for (let i = 0; i < n; i++) this.step();
    return this.result();
  }
  result() {
    const res = { scenario: this.scenario.id, level: this.level, dt: this.dt, smart: this.smart.summary(), gw_logs: this.smart.gw.logs, server_logs: this.server.logs,
      sync_log: this.server.stations[this.smart.sid].sync_log, cmd_results: this.smart.gw.cmd_results };
    if (this.fixed) res.fixed = this.fixed.summary();
    return res;
  }
}
