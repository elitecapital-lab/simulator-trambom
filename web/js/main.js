// Điểm vào của bản mô phỏng 3D trên trình duyệt.
import { NetworkSim } from './sim/network.js';
import { fmtClock } from './sim/util.js';
import { TimeChart } from './ui/charts.js';
import { h, fmt } from './ui/dom.js';
import { Intro } from './ui/intro.js';
import { Panels } from './ui/panels.js';
import { StationScene } from './ui/scene3d.js';

async function loadData() {
  if (window.__TRAMBOM_DATA__) return window.__TRAMBOM_DATA__;
  const base = new URL('../../config/', import.meta.url);
  const get = async (n) => { const r = await fetch(new URL(n, base)); if (!r.ok) throw new Error(n + ': ' + r.status); return r.json(); };
  const [station, scen, comps] = await Promise.all([get('station.json'), get('scenarios.json'), get('components.json')]);
  return { station, scenarios: scen.scenarios, components: comps.components };
}

const SPEEDS = [1, 10, 60, 300, 1200, 3600];
const WINDOWS = [['6 h', 6 * 3600], ['24 h', 86400], ['Tất cả', Infinity]];
const MODE_BANNER = {
  b: (a) => `(b) MẤT KẾT NỐI – gateway tự vận hành bằng kịch bản v${a.st.gw.script.version} đã lưu · đệm ${a.st.gw.comms.buf.length} bản ghi · cộng biên áp +${fmt(a.st.gw.script.params.offline.margin_bar, 1)} bar`,
  c: (a) => `(c) ĐANG ĐỒNG BỘ – phát lại ${a.st.gw.comms.buf.length} bản ghi đệm, hợp nhất kịch bản, nhận lệnh còn hạn`,
  d: (a) => {
    const g = a.st.gw, s = g.safety;
    if (s.safe_stop) return `(d) DỪNG AN TOÀN – ${s.safe_reason} không đạt QCVN · van MV-02 đóng · cần lệnh đặt lại`;
    if (s.state === 'trip') return '(d) CẮT BƠM DO ÁP LỰC RẤT CAO – chờ tự khởi động lại';
    if (s.state === 'level_stop') return '(d) MỨC BỂ RẤT THẤP – khóa chống chạy khô';
    const top = [...g.alarms.active.values()].sort((x, y) => ({ critical: 0, alarm: 1, warning: 2, info: 3 }[x.sev] - { critical: 0, alarm: 1, warning: 2, info: 3 }[y.sev]))[0];
    return '(d) CẢNH BÁO – ' + (top ? top.msg : s.state === 'limiting' ? 'giới hạn tần số do áp cao' : '');
  },
};

class App {
  constructor(data) {
    this.cfg = data.station; this.scenarios = data.scenarios; this.components = data.components;
    document.getElementById('boot')?.remove();
    this.speed = 60; this.running = false; this.acc = 0; this.win = 86400; this.studentLoaded = false;
    this.panels = new Panels(this);
    this._initHeader();
    this._initTabs();
    this.scene3d = new StationScene(document.getElementById('vp'), this.components, (tag) => this.openDrawer(tag));
    this._initViewportTools();
    this._initCharts();
    this.panels.buildKpi(document.getElementById('kpi'));
    this.intro = new Intro(document.getElementById('intro'), this.cfg, this.scenarios, (sc, lvl) => this.start(sc, lvl));
    const m = location.hash.match(/^#(S\d+B?|S0)(?:-(basic|advanced))?$/i);
    if (m) { this.intro.hide(); this.start(m[1].toUpperCase(), m[2] || 'basic'); } else { this.start('S1', 'basic', false); this.intro.show(0); }
    this._last = performance.now(); this._lastUi = 0; this._lastChart = 0;
    requestAnimationFrame((t) => this.loop(t));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.onTheme());
  }
  // ---------- giao diện ----------
  _initHeader() {
    const sel = document.getElementById('sc-select');
    for (const s of this.scenarios) sel.append(h('option', { value: s.id }, s.name));
    sel.addEventListener('change', () => this.start(sel.value, this.level));
    document.querySelectorAll('#lvl-seg button').forEach((b) => b.addEventListener('click', () => this.start(this.scenario.id, b.dataset.lvl)));
    const sp = document.getElementById('speed-seg');
    for (const v of SPEEDS) sp.append(h('button', { 'data-v': v, onclick: () => { this.speed = v; this._syncHeader(); } }, '×' + v));
    document.getElementById('btn-play').addEventListener('click', () => { this.running = !this.running; this._syncHeader(); });
    document.getElementById('btn-skip').addEventListener('click', () => this.skip(3600));
    document.getElementById('btn-reset').addEventListener('click', () => this.start(this.scenario.id, this.level));
    document.getElementById('btn-guide').addEventListener('click', () => this.intro.show(0, this.scenario.id, this.level));
    const themes = [['', 'Giao diện: tự động'], ['light', 'Giao diện: sáng'], ['dark', 'Giao diện: tối']];
    const tb = document.getElementById('btn-theme');
    let ti = 0;
    try { const saved = localStorage.getItem('trambom-theme'); if (saved) { ti = Math.max(0, themes.findIndex((x) => x[0] === saved)); } } catch (e) { /* bỏ qua */ }
    const applyTheme = () => {
      if (themes[ti][0]) document.documentElement.setAttribute('data-theme', themes[ti][0]); else document.documentElement.removeAttribute('data-theme');
      tb.textContent = themes[ti][1];
      try { localStorage.setItem('trambom-theme', themes[ti][0]); } catch (e) { /* bỏ qua */ }
      this.onTheme();
    };
    tb.addEventListener('click', () => { ti = (ti + 1) % themes.length; applyTheme(); });
    this._applyThemeInit = applyTheme;
  }
  _initTabs() {
    const tabs = [['mon', 'Giám sát'], ['fault', 'Sự cố'], ['script', 'Kịch bản'], ['center', 'Trung tâm'], ['log', 'Nhật ký'], ['lesson', 'Bài học']];
    const bar = document.getElementById('tabs'), panes = document.getElementById('panes');
    this.tabBtns = {}; this.panes = {};
    for (const [k, label] of tabs) {
      const b = h('button', { role: 'tab', onclick: () => this.tab(k) }, label, h('span', { class: 'badge', hidden: true }));
      bar.append(b); this.tabBtns[k] = b;
      const p = h('div', { class: 'pane', role: 'tabpanel', hidden: true });
      panes.append(p); this.panes[k] = p;
    }
    this.panels.buildMonitor(this.panes.mon);
    this.panels.buildLog(this.panes.log);
    this.panels.buildLesson(this.panes.lesson);
    this.tab('mon');
  }
  tab(k) {
    this.curTab = k;
    for (const [n, b] of Object.entries(this.tabBtns)) { b.classList.toggle('on', n === k); b.setAttribute('aria-selected', n === k); this.panes[n].hidden = n !== k; }
    this._updatePanels(true);
  }
  setBadge(k, n) { const b = this.tabBtns[k]?.querySelector('.badge'); if (!b) return; b.hidden = !n; b.textContent = n; }
  _initViewportTools() {
    const tools = document.getElementById('vp-tools');
    for (const [k, label] of [['overview', 'Tổng quan'], ['tank', 'Bể chứa'], ['pumps', 'Cụm bơm'], ['quality', 'Chất lượng nước'], ['cabinet', 'Tủ điều khiển'], ['network', 'Khu dân cư']]) {
      tools.append(h('button', { class: 'btn small', onclick: () => this.scene3d.goto(k) }, label));
    }
    const modes = ['Nhãn: ẩn', 'Nhãn: chính', 'Nhãn: tất cả'];
    let lm = 1;
    tools.append(h('button', { class: 'btn small', onclick: (e) => { lm = (lm + 1) % 3; this.scene3d.setLabelMode(lm); e.target.textContent = modes[lm]; } }, modes[1]));
  }
  _initCharts() {
    const host = document.getElementById('charts');
    const C = (o) => new TimeChart(host, o);
    this.charts = {
      p: C({ title: 'Áp lực', subtitle: 'bar · điểm bất lợi ≥ 1,4 · đầu ra ≤ 4,0', unit: 'bar', yMin: -0.2, yMax: 5, refLines: [{ y: 1.4, label: '1,4' }, { y: 4.0, label: '4,0' }],
        series: [{ key: 'p_out', label: 'Đầu ra – thông minh', color: '--s-smart' }, { key: 'f_p_out', label: 'Đầu ra – lịch cố định', color: '--s-fixed' }, { key: 'p_crit', label: 'Điểm bất lợi – thông minh', color: '--s-crit' }, { key: 'p_set', label: 'Áp đặt P_set', color: '--s-ref', dash: true, width: 1.5 }] }),
      q: C({ title: 'Lưu lượng', subtitle: 'm³/h', unit: 'm³/h', nd: 1, zero: true,
        series: [{ key: 'q_out', label: 'Ra mạng – thông minh', color: '--s-smart' }, { key: 'f_q_out', label: 'Ra mạng – lịch cố định', color: '--s-fixed' }, { key: 'q_in', label: 'Vào bể', color: '--s-inflow', width: 1.5 }, { key: 'q_fc', label: 'Dự báo', color: '--s-fc', dash: true, width: 1.5 }] }),
      kw: C({ title: 'Công suất điện', subtitle: 'kW', unit: 'kW', zero: true, series: [{ key: 'kw', label: 'Thông minh', color: '--s-smart' }, { key: 'f_kw', label: 'Lịch cố định', color: '--s-fixed' }] }),
      kwh: C({ title: 'Điện năng lũy kế', subtitle: 'kWh', unit: 'kWh', nd: 1, zero: true, series: [{ key: 'kwh', label: 'Thông minh', color: '--s-smart' }, { key: 'f_kwh', label: 'Lịch cố định', color: '--s-fixed' }] }),
      lv: C({ title: 'Mực nước bể T-01', subtitle: 'm · dừng 0,6 · tiết kiệm 1,2', unit: 'm', yMin: 0, yMax: 4.2, refLines: [{ y: 0.6, label: 'dừng 0,6' }, { y: 1.2, label: '1,2' }], series: [{ key: 'level', label: 'Thông minh', color: '--s-smart' }, { key: 'f_level', label: 'Lịch cố định', color: '--s-fixed' }] }),
      srv: C({ title: 'Dữ liệu tại máy chủ', subtitle: 'áp đầu ra ST-01 theo phút, bar', unit: 'bar', yMin: 0, yMax: 4.5, series: [{ key: 'srv_live', label: 'Nhận trực tiếp', color: '--s-smart' }, { key: 'srv_late', label: 'Nhận sau đồng bộ (phát lại)', color: '--s-crit' }] }),
      ntu: C({ title: 'Độ đục trong bể', subtitle: 'NTU · QCVN ≤ 2', unit: 'NTU', zero: true, refLines: [{ y: 2.0, label: '2,0' }, { y: 1.0, label: '1,0' }], series: [{ key: 'ntu', label: 'Thông minh', color: '--s-smart' }, { key: 'f_ntu', label: 'Lịch cố định', color: '--s-fixed' }] }),
      cl: C({ title: 'Clo dư trong bể', subtitle: 'mg/L · QCVN 0,2–1,0', unit: 'mg/L', zero: true, refLines: [{ y: 0.2, label: '0,2' }, { y: 0.3, label: '0,3' }], series: [{ key: 'cl', label: 'Thông minh', color: '--s-smart' }, { key: 'f_cl', label: 'Lịch cố định', color: '--s-fixed' }] }),
    };
    const ws = document.getElementById('win-seg');
    for (const [label, v] of WINDOWS) ws.append(h('button', { onclick: (e) => { this.win = v; ws.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); this.updateCharts(); } , class: v === this.win ? 'on' : '' }, label));
    new ResizeObserver(() => this.updateCharts()).observe(host);
  }
  onTheme() { this.scene3d?.applyTheme(); for (const c of Object.values(this.charts || {})) c.refreshColors(); this.updateCharts(); }

  // ---------- mô phỏng ----------
  start(scId, level, run = true) {
    this.scenario = this.scenarios.find((s) => s.id === scId) || this.scenarios[0];
    this.level = level;
    this.net = new NetworkSim(this.cfg, level, { withFixed: 'all', events: this.scenario.events.map((e) => ({ ...e, station: 'ST-01' })) });
    this.server = this.net.server; this.st = this.net.smart[0]; this.fx = this.net.fixed[0];
    this.studentLoaded = false;
    this.spans = []; this._spanIdx = 0;
    document.getElementById('sc-select').value = this.scenario.id;
    this.panes.fault.replaceChildren(); this.panels.buildFaults(this.panes.fault);
    this.panes.script.replaceChildren(); this.panels.buildScript(this.panes.script);
    this.panes.center.replaceChildren(); this.panels.buildCenter(this.panes.center);
    this.panels.updateLesson();
    this.panels._alarmKey = this.panels._calKey = this.panels._logKey = this.panels._syncKey = null;
    this.running = run;
    this._syncHeader();
    this.closeDrawer();
    this.updateCharts();
    this._updatePanels(true);
    if (this._applyThemeInit) { this._applyThemeInit(); this._applyThemeInit = null; }
  }
  event(ev) {
    this.net.applyEvent(ev, this.net.t);
    const names = { link_down: 'Ngắt kết nối 4G', link_up: 'Khôi phục kết nối 4G', inflow_quality: 'Thay đổi chất lượng nước nguồn', supply: 'Mất nước nguồn', burst: 'Vỡ ống', demand_scale: 'Nhu cầu tăng', pump_fault: 'Lỗi bơm', pump_repair: 'Sửa bơm', sensor_fault: 'Lỗi cảm biến ' + (ev.tag ?? ''), sensor_repair: 'Sửa cảm biến ' + (ev.tag ?? '') };
    this.toast((names[ev.type] || ev.type) + ' · ' + (ev.station ?? 'ST-01'));
    this._updatePanels(true);
  }
  skip(sec) {
    const n = Math.round(sec / this.net.dt);
    for (let i = 0; i < n; i++) this.net.step();
    this.updateCharts(); this._updatePanels(true);
  }
  loop(ts) {
    const realDt = Math.min(0.1, (ts - this._last) / 1000);
    this._last = ts;
    if (this.running && !document.hidden) {
      this.acc += this.speed * realDt;
      const t0 = performance.now();
      let steps = 0;
      const budget = this.speed >= 1200 ? 26 : this.speed >= 300 ? 18 : 12;
      while (this.acc >= this.net.dt && performance.now() - t0 < budget) { this.net.step(); this.acc -= this.net.dt; steps++; }
      if (this.acc > this.speed * 0.5) this.acc = 0;
      this._stepsRate = (this._stepsRate ?? 0) * 0.9 + 0.1 * (steps / Math.max(realDt, 1e-3));
    }
    this.scene3d.update(realDt, this.view());
    if (ts - this._lastUi > 250) { this._lastUi = ts; this._updatePanels(false); this._syncHeader(); }
    if (ts - this._lastChart > 600) { this._lastChart = ts; this.updateCharts(); }
    requestAnimationFrame((t) => this.loop(t));
  }
  view() {
    const g = this.st.gw;
    return { plant: this.st.plant, sig: g.sig, mode: g.mode(), comms: g.comms.state, p_set: g.ctrl.p_set, version: g.script.version, strategy: g.ctrl.strategy_used, buffer: g.comms.buf.length };
  }
  _syncHeader() {
    document.getElementById('btn-play').textContent = this.running ? 'Tạm dừng' : 'Chạy';
    document.querySelectorAll('#speed-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === this.speed));
    document.querySelectorAll('#lvl-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lvl === this.level));
    if (!this.st) return;
    document.getElementById('clock').textContent = fmtClock(this.st.t, this.cfg.sim.start_dow);
    const real = this.running ? Math.round(this._stepsRate ?? 0) : 0;
    document.getElementById('speed-real').textContent = this.running && real < this.speed * 0.8 ? `thực ×${real}` : '';
    const mode = this.st.gw.mode();
    document.querySelectorAll('#modes .mode').forEach((m) => m.classList.toggle('on', m.dataset.m === mode));
    const bn = document.getElementById('banner');
    if (mode === 'a') bn.hidden = true;
    else { bn.hidden = false; bn.className = 'banner ' + mode; bn.textContent = MODE_BANNER[mode](this); }
  }
  _updatePanels(force) {
    if (!this.st) return;
    const P = this.panels;
    P.updateMonitor();
    if (force || this.curTab === 'fault') P.updateFaults();
    if (this.curTab === 'script') P.updateScript();
    if (this.curTab === 'center' || force) P.updateCenter();
    if (this.curTab === 'log') P.updateLog();
    P.updateKpi();
    if (this.drawerTag) this.openDrawer(this.drawerTag, true);
    this._labels();
  }
  _labels() {
    const g = this.st.gw, pl = this.st.plant, sig = g.sig || {}, sc = this.scene3d, A = g.alarms.active;
    const has = (p) => [...A.keys()].some((k) => k.startsWith(p));
    sc.setLabel('PT-101', fmt(sig.p1, 2, 'bar'), has('SENSOR_FAULT_PT-101') || g.sig_proc.faulty['PT-101']);
    sc.setLabel('PT-102', fmt(sig.p2, 2, 'bar'), has('SENSOR_FAULT_PT-102') || has('P_HIGH'));
    sc.setLabel('FT-101', fmt(sig.q_f, 1, 'm³/h'));
    sc.setLabel('FT-100', fmt(sig.q_in_f, 1, 'm³/h'), has('SUPPLY_LOST'));
    sc.setLabel('LT-101', fmt(sig.level, 2, 'm'), has('LEVEL'));
    sc.setLabel('T-01', `${fmt(pl.volume(), 0)} m³`, has('LEVEL'));
    sc.setLabel('AIT-201', fmt(sig.cl, 2, 'mg/L'), has('CL_'));
    sc.setLabel('AIT-202', fmt(sig.ntu, 2, 'NTU'), has('NTU_'));
    sc.setLabel('AIT-203', fmt(sig.ph, 2), has('PH_'));
    pl.pumps.forEach((pu, i) => sc.setLabel(pu.tag, pu.fault ? 'LỖI' : pu.running ? `${fmt(pu.f, 1)} Hz · ${fmt(pu.kw, 2)} kW` : 'dừng', pu.fault));
    sc.setLabel('PI-101/102', `${fmt(pl.pumps[0].gauge, 1)} / ${fmt(pl.pumps[1].gauge, 1)} bar`);
    sc.setLabel('HT-01', fmt(pl.htWaterL(), 0, 'L'));
    sc.setLabel('MV-02', pl.outlet_frac > 0.99 ? 'mở' : pl.outlet_frac < 0.01 ? 'ĐÓNG' : `${fmt(pl.outlet_frac * 100, 0)} %`, pl.outlet_frac < 0.99);
    sc.setLabel('VX-01', pl.drain_open ? 'ĐANG XẢ' : 'đóng', pl.drain_open);
    sc.setLabel('PSV-01', pl.q_relief > 0 ? `xả ${fmt(pl.q_relief, 1)} m³/h` : 'đóng', pl.q_relief > 0);
    sc.setLabel('FV-01', pl.q_in > 0.1 ? 'mở' : 'đóng');
    sc.setLabel('CP-01', `${fmt(pl.kw, 2)} kW`);
    sc.setLabel('GW-01', { a: '(a)', b: '(b) tự vận hành', c: '(c) đồng bộ', d: '(d) cảnh báo' }[g.mode()], g.mode() === 'd');
    sc.setLabel('RT-01', { online: '4G trực tuyến', offline: 'MẤT KẾT NỐI', resync: 'đồng bộ…' }[g.comms.state], g.comms.state === 'offline');
    sc.setLabel('MANG-LUOI', `điểm bất lợi ${fmt(pl.p_crit, 2)} bar`, pl.p_crit < 1.4);
  }
  liveValues(tag) {
    const g = this.st.gw, pl = this.st.plant, sig = g.sig || {};
    const L = {
      'T-01': [['Mức nước', fmt(pl.level, 2, 'm')], ['Thể tích', fmt(pl.volume(), 0, 'm³')], ['Clo / đục / pH', `${fmt(pl.cl, 2)} / ${fmt(pl.ntu, 2)} / ${fmt(pl.ph, 2)}`]],
      'FV-01': [['Lưu lượng vào', fmt(pl.q_in, 1, 'm³/h')]], 'VX-01': [['Trạng thái', pl.drain_open ? 'đang xả' : 'đóng'], ['Lưu lượng xả', fmt(pl.q_drain, 0, 'm³/h')]],
      'HT-01': [['Áp lực', fmt(pl.p, 2, 'bar')], ['Nước trong bình', fmt(pl.htWaterL(), 0, 'L')]], 'PSV-01': [['Lưu lượng xả', fmt(pl.q_relief, 2, 'm³/h')]],
      'MV-02': [['Độ mở', fmt(pl.outlet_frac * 100, 0, '%')]], 'PT-101': [['Giá trị', fmt(sig.p1, 3, 'bar')], ['Lỗi giả lập', this.st.sensors.sensors['PT-101'].fault ?? 'không']],
      'PT-102': [['Giá trị', fmt(sig.p2, 3, 'bar')]], 'PI-101/102': [['P-01 / P-02', `${fmt(pl.pumps[0].gauge, 2)} / ${fmt(pl.pumps[1].gauge, 2)} bar`]],
      'FT-101': [['Lưu lượng ra', fmt(sig.q_f, 2, 'm³/h')]], 'FT-100': [['Lưu lượng vào', fmt(sig.q_in_f, 2, 'm³/h')]], 'LT-101': [['Mức', fmt(sig.level, 3, 'm')]],
      'AIT-201': [['Clo dư', fmt(sig.cl, 3, 'mg/L')]], 'AIT-202': [['Độ đục', fmt(sig.ntu, 3, 'NTU')]], 'AIT-203': [['pH', fmt(sig.ph, 3)]],
      'MANG-LUOI': [['Nhu cầu tiêu thụ', fmt(pl.q_cons, 1, 'm³/h')], ['Cấp được', fmt(pl.q_served, 1, 'm³/h')], ['Rò rỉ', fmt(pl.q_leak, 2, 'm³/h')], ['Áp điểm bất lợi', fmt(pl.p_crit, 2, 'bar')], ['Thiếu hụt bồn mái', fmt(pl.backlog, 1, 'm³')]],
      'CP-01': [['Công suất', fmt(pl.kw, 2, 'kW')], ['Điện năng', fmt(this.st.kpi.energy_kwh, 1, 'kWh')]],
      'GW-01': [['Chế độ', g.mode()], ['Kịch bản', 'v' + g.script.version + ' ' + g.script.strategy], ['Bộ đệm', g.comms.buf.length + ' bản ghi']], 'RT-01': [['Kết nối', g.comms.state], ['Dữ liệu lên', fmt(this.st.link.bytes_up / 1e6, 2, 'MB')]],
    };
    pl.pumps.forEach((pu, i) => { L[pu.tag] = [['Trạng thái', pu.fault ? 'lỗi' : pu.running ? 'chạy' : 'dừng'], ['Tần số', fmt(pu.f, 1, 'Hz')], ['Lưu lượng', fmt(pu.q, 1, 'm³/h')], ['Cột áp', fmt(pu.h, 1, 'm')], ['Công suất', fmt(pu.kw, 2, 'kW')], ['Dòng điện', fmt(pu.amps, 1, 'A')], ['Số lần khởi động', String(pu.starts)], ['Giờ chạy', fmt(pu.run_s / 3600, 1, 'h')]]; });
    return L[tag] || [];
  }
  openDrawer(tag, refresh = false) {
    const d = document.getElementById('drawer');
    const el = this.panels.componentInfo(tag);
    if (!el) return;
    this.drawerTag = tag;
    d.replaceChildren(el); d.hidden = false;
    if (!refresh) d.scrollTop = 0;
  }
  closeDrawer() { this.drawerTag = null; const d = document.getElementById('drawer'); if (d) d.hidden = true; }
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  // ---------- biểu đồ ----------
  updateCharts() {
    if (!this.st || !this.charts) return;
    const H = this.st.hist.data, F = this.fx.hist.data;
    const n = H.t.length;
    // vùng nền: mất mạng / chế độ (d)
    for (; this._spanIdx < n; this._spanIdx++) {
      const i = this._spanIdx, t = H.t[i];
      for (const [kind, on] of [['off', H.online[i] < 0.5], ['d', H.mode[i] === 3]]) {
        const last = this.spans.filter((s) => s.kind === kind).pop();
        if (on) { if (last && last.open) last.t1 = t; else this.spans.push({ kind, t0: t - this.cfg.sim.history_period_s, t1: t, open: true }); }
        else if (last && last.open) last.open = false;
      }
    }
    const tEnd = Math.max(this.st.t, 3600);
    const t0 = this.win === Infinity ? 0 : Math.max(0, tEnd - this.win);
    let i0 = 0;
    { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (H.t[m] < t0) lo = m + 1; else hi = m; } i0 = lo; }
    const series = { p_out: H.p_out, f_p_out: F.p_out, p_crit: H.p_crit, p_set: H.p_set, q_out: H.q_out, f_q_out: F.q_out, q_in: H.q_in, q_fc: this.level === 'advanced' ? H.q_fc : null,
      kw: H.kw, f_kw: F.kw, kwh: H.kwh, f_kwh: F.kwh, level: H.level, f_level: F.level, ntu: H.ntu, f_ntu: F.ntu, cl: H.cl, f_cl: F.cl };
    const base = { t: H.t, i0, window: [t0, Math.max(t0 + 600, tEnd)], spans: this.spans, series };
    for (const [k, c] of Object.entries(this.charts)) if (k !== 'srv') c.setData(base);
    // dữ liệu máy chủ theo phút
    const st = this.server.stations['ST-01'];
    const m0 = Math.floor(t0 / 60), m1 = Math.floor(this.st.t / 60);
    const ts = [], live = [], late = [];
    for (let m = m0; m <= m1; m++) {
      const r = st.series.get(m);
      ts.push(m * 60 + 30);
      live.push(r && !r.late ? r.p : NaN); late.push(r && r.late ? r.p : NaN);
    }
    this.charts.srv.setData({ t: ts, i0: 0, window: base.window, spans: this.spans, series: { srv_live: live, srv_late: late } });
  }
}

loadData().then((d) => { window.app = new App(d); }).catch((e) => {
  document.getElementById('boot').textContent = 'Không tải được cấu hình (' + e.message + '). Hãy chạy máy chủ web tĩnh từ thư mục gốc: python -m trambom web';
});
