// Điểm vào của bản mô phỏng 3D trên trình duyệt.
import { NetworkSim } from './sim/network.js';
import { fmtClock } from './sim/util.js';
import { TimeChart } from './ui/charts.js';
import { Control3D } from './ui/control3d.js';
import { h, fmt } from './ui/dom.js';
import { HmiView } from './ui/hmi.js';
import { Intro } from './ui/intro.js';
import { COMMS_NAME, CTL_NAME, MODE_NAME, modeSev, stationData, STRAT_NAME, viNum } from './ui/ops.js';
import { Panels } from './ui/panels.js';
import { StationScene } from './ui/scene3d.js';
import { ico, PANES, Shell } from './ui/shell.js';

async function loadData() {
  if (window.__TRAMBOM_DATA__) return window.__TRAMBOM_DATA__;
  const base = new URL('../../config/', import.meta.url);
  const get = async (n) => { const r = await fetch(new URL(n, base)); if (!r.ok) throw new Error(n + ': ' + r.status); return r.json(); };
  const [station, scen, comps] = await Promise.all([get('station.json'), get('scenarios.json'), get('components.json')]);
  return { station, scenarios: scen.scenarios, components: comps.components };
}

const SPEEDS = [1, 10, 60, 300, 1200, 3600];
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const WINDOWS = [['6 h', 6 * 3600], ['24 h', 86400], ['Tất cả', Infinity]];
const MODE_BANNER = {
  x: (a) => `MINI PC NGỪNG – ${a.st.gw_dead.note()} · mất dừng an toàn theo chất lượng, ghép bơm, đo xa`,
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
    this.baseCfg = data.station; this.cfg = structuredClone(data.station); this.scenarios = data.scenarios; this.components = data.components;
    document.getElementById('boot')?.remove();
    this.speed = 60; this.running = false; this.acc = 0; this.win = 86400; this.studentLoaded = false;
    this.viewMode = '3d'; this.curTab = null;
    this.panels = new Panels(this);
    this.shell = new Shell(this);
    this._initHeader();
    this._initTabs();
    const vp = document.getElementById('vp');
    this.scene3d = new StationScene(vp, this.components, (tag) => this.onPick(tag));
    this.ctl3d = new Control3D(this, vp);
    this.setScope('all');
    this.hmi = new HmiView(vp, this);
    document.querySelectorAll('#view-seg button').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    this._initCharts();
    this.panels.buildKpi(document.getElementById('kpi'));
    this._initDrawer();
    this.intro = new Intro(document.getElementById('intro'), this.cfg, this.scenarios, (sc, lvl) => this.start(sc, lvl));
    const m = location.hash.match(/^#(S\d+B?|S0)(?:-(basic|advanced))?(?:-(hmi|3d))?$/i);
    if (m) { this.intro.hide(); this.start(m[1].toUpperCase(), m[2] || 'basic'); if (m[3]) this.setView(m[3].toLowerCase()); } else { this.start('S1', 'basic', false); this.intro.show(0); }
    this._syncView();
    this.shell.refit();
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
    for (const v of SPEEDS) sp.append(h('button', { 'data-v': v, title: `1 giây thực = ${v} giây mô phỏng`, onclick: () => { this.speed = v; this._syncHeader(); } }, '×' + v));
    this.playBtn = document.getElementById('btn-play');
    this.playBtn.addEventListener('click', () => { this.running = !this.running; this._syncHeader(); });
    document.getElementById('btn-skip').addEventListener('click', () => this.skip(3600));
    document.getElementById('btn-reset').addEventListener('click', () => this.start(this.scenario.id, this.level));
    document.getElementById('btn-guide').addEventListener('click', () => this.intro.show(0, this.scenario.id, this.level));
    const themes = [['', 'Giao diện: tự động'], ['light', 'Giao diện: sáng'], ['dark', 'Giao diện: tối']];
    const tb = document.getElementById('btn-theme');
    let ti = 0;
    try { const saved = localStorage.getItem('trambom-theme'); if (saved) { ti = Math.max(0, themes.findIndex((x) => x[0] === saved)); } } catch (e) { /* bỏ qua */ }
    const applyTheme = () => {
      if (themes[ti][0]) document.documentElement.setAttribute('data-theme', themes[ti][0]); else document.documentElement.removeAttribute('data-theme');
      this.shell.setTheme(tb, themes[ti][0], themes[ti][1]);
      try { localStorage.setItem('trambom-theme', themes[ti][0]); } catch (e) { /* bỏ qua */ }
      this.onTheme();
    };
    tb.addEventListener('click', () => { ti = (ti + 1) % themes.length; applyTheme(); });
    this._applyThemeInit = applyTheme;
    this.banner = document.getElementById('banner');
    this.banner.addEventListener('click', () => this.tab(['d', 'x'].includes(this._bnMode) ? 'alarm' : 'mon'));
  }
  // Các bảng (Báo động, Giám sát, Thiết bị…) nằm trong khung nổi bên phải; thanh chức năng (dock) thay cho dải tab.
  _initTabs() {
    const panes = document.getElementById('panes');
    this.panes = {};
    for (const k of Object.keys(PANES)) { const p = h('div', { class: 'pane', 'data-pane': k, hidden: true }); panes.append(p); this.panes[k] = p; }
    this.shell.buildAlarmPane(this.panes.alarm);
    this.panels.buildMonitor(this.panes.mon);
    this.panels.buildEquipment(this.panes.equip);
    this.panels.buildLog(this.panes.log);
    this.panels.buildLesson(this.panes.lesson);
  }
  /** Mở bảng k trong khung nổi bên phải ('charts' / 'kpi' mở bảng biểu đồ). */
  tab(k) {
    if (this.viewMode === 'hmi') this.setView('3d');
    if (k === 'charts' || k === 'kpi') { this.shell.openSheet(k); return; }
    this.shell.openPane(k);
    this._updatePanels(true);
  }
  setView(v) {
    this.viewMode = v === 'hmi' ? 'hmi' : '3d';
    const hmi = this.viewMode === 'hmi';
    document.getElementById('vp').classList.toggle('hmi-on', hmi);
    document.body.classList.toggle('view-hmi', hmi);
    this.shell.closePop();
    this.hmi.show(hmi);
    if (!hmi) requestAnimationFrame(() => { this.scene3d.resize(); this.shell.update(true); this._labels(); this.updateCharts(); });
    this._syncView();
    // màn HMI tự có đồng hồ và chế độ: thanh trên ẩn các mục trùng (app.css) → xếp lại cho vừa
    this.shell.refit?.(); this.shell._fitHud?.();
  }
  /** Nhấp vào thiết bị trong cảnh 3D: thiết bị điều khiển được thì mở bảng điều khiển nổi, còn lại mở thẻ thông tin. */
  onPick(tag) { if (!this.ctl3d.open(tag)) this.openDrawer(tag); }
  _syncView() { document.querySelectorAll('#view-seg button').forEach((b) => { b.classList.toggle('on', b.dataset.view === this.viewMode); b.setAttribute('aria-pressed', String(b.dataset.view === this.viewMode)); }); }
  /** Đổi tùy chọn lắp đặt thiết bị (cfg.hardware) rồi chạy lại kịch bản hiện tại. */
  applyHardware(hw) {
    this.cfg = structuredClone(this.baseCfg);
    Object.assign(this.cfg.hardware, hw);
    const off = Object.entries(hw).filter(([, v]) => !v).map(([k]) => k);
    this.start(this.scenario.id, this.level, this.running);
    this.toast(off.length ? 'Chạy lại KHÔNG lắp: ' + off.join(', ') : 'Chạy lại với đủ thiết bị');
  }
  scopeOf(tag) { return this.components.find((c) => c.tag === tag)?.scope ?? null; }
  setScope(k) {
    this.scope = k;
    this.scene3d.setScopeFilter(k, (tag) => this.scopeOf(tag));
    this.scopeSeg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.scope === k); b.setAttribute('aria-pressed', String(b.dataset.scope === k)); });
    if (this.panels.updateEquipment) this.panels.updateEquipment(true);
  }
  /** Số báo động ('mon') / cảnh báo tập trung ('center') chưa xác nhận – hiện trên nút của thanh chức năng. */
  setBadge(k, n) { this.shell?.setBadge(k, n); }
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
    for (const [label, v] of WINDOWS) ws.append(h('button', { title: label === 'Tất cả' ? 'Từ đầu mô phỏng' : label + ' gần nhất', onclick: (e) => { this.win = v; ws.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); this.updateCharts(); }, class: v === this.win ? 'on' : '' }, label));
    new ResizeObserver(() => this.updateCharts()).observe(host);
    this.shell.buildChartChips();
  }
  onTheme() { this.scene3d?.applyTheme(); for (const c of Object.values(this.charts || {})) c.refreshColors(); this.updateCharts(); }

  // ---------- mô phỏng ----------
  start(scId, level, run = true) {
    this.scenario = this.scenarios.find((s) => s.id === scId) || this.scenarios[0];
    this.level = level;
    this.net = new NetworkSim(this.cfg, level, { withFixed: 'all', events: this.scenario.events.map((e) => ({ ...e, station: 'ST-01' })) });
    this.server = this.net.server; this.st = this.net.smart[0]; this.fx = this.net.fixed[0];
    this.uiHist = { t: [], p1: [], p2: [] };
    this.studentLoaded = false;
    this.spans = []; this._spanIdx = 0;
    { const sel = document.getElementById('sc-select'); sel.value = this.scenario.id; sel.title = this.scenario.name; }
    this.panes.fault.replaceChildren(); this.panels.buildFaults(this.panes.fault);
    this.panes.script.replaceChildren(); this.panels.buildScript(this.panes.script);
    this.panes.center.replaceChildren(); this.panels.buildCenter(this.panes.center);
    this.panels.updateLesson();
    this.panels._alarmKey = this.panels._calKey = this.panels._logKey = this.panels._syncKey = null;
    this.running = run;
    this._syncHeader();
    this.closeDrawer();
    this.ctl3d?.close(); this.ctl3d?.setWhere?.('local');
    this.hmi?.reset?.();
    this.updateCharts();
    this._updatePanels(true);
    if (this._applyThemeInit) { this._applyThemeInit(); this._applyThemeInit = null; }
  }
  event(ev) {
    this.net.applyEvent(ev, this.net.t);
    const names = { link_down: 'Ngắt kết nối 4G', link_up: 'Khôi phục kết nối 4G', inflow_quality: 'Thay đổi chất lượng nước nguồn', supply: 'Mất nước nguồn', burst: 'Vỡ ống', demand_scale: 'Nhu cầu tăng', pump_fault: 'Lỗi bơm', pump_repair: 'Sửa bơm', sensor_fault: 'Lỗi cảm biến ' + (ev.tag ?? ''), sensor_repair: 'Sửa cảm biến ' + (ev.tag ?? ''), gateway_fail: 'Mini PC (edge gateway) ngừng hoạt động', gateway_restore: 'Khởi động lại mini PC' };
    this.toast((names[ev.type] || ev.type) + ' · ' + (ev.station ?? 'ST-01'));
    this._updatePanels(true);
  }
  skip(sec) {
    const n = Math.round(sec / this.net.dt);
    for (let i = 0; i < n; i++) this._step();
    this.updateCharts(); this._updatePanels(true);
  }
  /**
   * Một bước mô phỏng. Lịch sử của lõi (hist) chỉ lưu áp ra mạng sau MV-02 (p_out); giao diện cần thêm số đo PT-101/PT-102
   * (áp ống góp, vẫn còn khi MV-02 đóng) nên ghi kèm vào app.uiHist, cùng chỉ số với hist.data.t.
   */
  _step() {
    this.net.step();
    const H = this.st.hist.data, U = this.uiHist;
    while (U.t.length < H.t.length) { const sig = this.st.gw.sig || {}; U.t.push(H.t[U.t.length]); U.p1.push(sig.p1 ?? NaN); U.p2.push(sig.p2 ?? NaN); }
  }
  loop(ts) {
    const realDt = Math.min(0.1, (ts - this._last) / 1000);
    this._last = ts;
    if (this.running && !document.hidden) {
      this.acc += this.speed * realDt;
      const t0 = performance.now();
      let steps = 0;
      const budget = this.speed >= 1200 ? 26 : this.speed >= 300 ? 18 : 12;
      while (this.acc >= this.net.dt && performance.now() - t0 < budget) { this._step(); this.acc -= this.net.dt; steps++; }
      if (this.acc > this.speed * 0.5) this.acc = 0;
      this._stepsRate = (this._stepsRate ?? 0) * 0.9 + 0.1 * (steps / Math.max(realDt, 1e-3));
    }
    if (this.viewMode !== 'hmi') { this.scene3d.update(realDt, this.view()); this.ctl3d.frame(); }
    if (ts - this._lastUi > 250) { this._lastUi = ts; this._updatePanels(false); this._syncHeader(); }
    if (ts - this._lastChart > 600) { this._lastChart = ts; this.updateCharts(); }
    requestAnimationFrame((t) => this.loop(t));
  }
  /** Màu của chế độ (d) theo mức nghiêm trọng cao nhất: 'crit' khi dừng an toàn / cắt bơm / khóa chạy khô hoặc có báo động mức báo động–khẩn; 'warn' khi chỉ có cảnh báo. */
  modeSev() { return modeSev(this, stationData(this, 'local')); }
  view() {
    const g = this.st.gw;
    return { plant: this.st.plant, sig: g.sig, installed: g.sig_proc.installed, mode: this.st.gw_dead ? 'x' : g.mode(), ctl: this.st.gw_dead ? 'auto' : g.controlSrc(), comms: g.comms.state, p_set: g.ctrl.p_set, version: g.script.version, strategy: g.ctrl.strategy_used, buffer: g.comms.buf.length };
  }
  _syncHeader() {
    this.shell.setPlay(this.playBtn, this.running);
    document.querySelectorAll('#speed-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === this.speed));
    document.querySelectorAll('#lvl-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lvl === this.level));
    if (!this.st) return;
    const clk = fmtClock(this.st.t, this.cfg.sim.start_dow), cm = clk.match(/^(.*\S)\s+(\d\d:\d\d:\d\d)$/);
    setText(document.getElementById('clock-t'), cm ? cm[2] : clk); setText(document.getElementById('clock-d'), cm ? cm[1] : '');
    const real = this.running ? Math.round(this._stepsRate ?? 0) : 0;
    this.shell.setRealSpeed(this.running && real < this.speed * 0.8 ? `thực ×${real}` : '');
    const mode = this.st.gw_dead ? 'x' : this.st.gw.mode(), warnD = mode === 'd' && this.modeSev() === 'warn';
    // độ rộng chip chế độ cố định (app.css) nên thanh trên không phải xếp lại khi chế độ đổi
    document.querySelectorAll('#modes .mode').forEach((m) => { m.classList.toggle('on', m.dataset.m === mode); if (m.dataset.m === 'd') m.classList.toggle('warn', warnD); });
    // dải thông báo chế độ (b/c/d/x) – chỉ dựng lại khi nội dung đổi
    const bn = this.banner;
    this._bnMode = mode;
    if (mode === 'a') { bn.hidden = true; document.documentElement.style.setProperty('--banner-h', '0px'); }
    else {
      const cls = 'banner ' + (mode === 'x' ? 'd' : warnD ? 'dw' : mode), txt = viNum(MODE_BANNER[mode](this));
      if (bn.className !== cls) bn.className = cls;
      if (bn._t !== txt) { bn._t = txt; bn.replaceChildren(ico('alert'), h('span', { class: 'bn-t' }, txt), h('span', { class: 'bn-more' }, 'Chi tiết')); bn.title = txt + ' – nhấp để xem chi tiết'; }
      bn.hidden = false;
      document.documentElement.style.setProperty('--banner-h', bn.offsetHeight + 6 + 'px');
    }
    this.insets = this._viewInsets();
    this.scene3d.setInsets(this.insets);
  }
  /** Phần khung 3D bị thanh trên, HUD, dock che – để camera căn giữa vùng còn trống. */
  _viewInsets() {
    const cs = getComputedStyle(document.documentElement), px = (n) => parseFloat(cs.getPropertyValue(n)) || 0, e = px('--edge');
    // sb, sr: tấm biểu đồ và khung bên phải đang mở – chỉ để bảng nổi 3D tránh, camera giữ nguyên
    const B = document.body.classList, sb = B.contains('sheet-open') ? px('--sheet-h') + e : 0;
    if (this.shell.mqMobile.matches) return { l: 0, r: 0, t: px('--topbar-h') + px('--hud-h') + px('--banner-h'), b: px('--dock-h'), sb, sr: 0 };
    const r = px('--dock-w') + 2 * e, sr = B.contains('side-open') ? r + px('--side-w') + e : 0;
    return { l: B.contains('hud-min') ? 0 : px('--hud-w') + 2 * e, r, t: px('--topbar-h'), b: 0, sb, sr };
  }
  _updatePanels(force) {
    if (!this.st) return;
    const P = this.panels, cur = this.viewMode === 'hmi' ? null : this.curTab;
    // bảng Giám sát chỉ dựng khi đang mở; số báo động trên nút dock tính riêng (rẻ) mỗi nhịp
    if (force || cur === 'mon') P.updateMonitor(); else P.updateAlarmBadge();
    if (force || cur === 'fault') P.updateFaults();
    if (cur === 'script') P.updateScript();
    if (cur === 'center' || force) P.updateCenter();
    if (cur === 'log') P.updateLog();
    if (force || this.shell.kpiVisible()) P.updateKpi();
    if (this.hmi?.visible) this.hmi.update(force);
    this.ctl3d?.update(force);
    this.shell.update(force);
    if (this.drawerTag) this.openDrawer(this.drawerTag, true);
    if (this.viewMode !== 'hmi') this._labels();
  }
  _labels() {
    const g = this.st.gw, pl = this.st.plant, sig = g.sig || {}, sc = this.scene3d, A = g.alarms.active;
    const has = (p) => [...A.keys()].some((k) => k.startsWith(p));
    sc.setLabel('PT-101', fmt(sig.p1, 2, 'bar'), has('SENSOR_FAULT_PT-101') || g.sig_proc.faulty['PT-101']);
    const inst = g.sig_proc.installed;
    sc.setLabel('PT-102', inst.has('PT-102') ? fmt(sig.p2, 2, 'bar') : 'không lắp', inst.has('PT-102') && (has('SENSOR_FAULT_PT-102') || has('P_HIGH')));
    sc.setLabel('FT-101', fmt(sig.q_f, 1, 'm³/h'));
    sc.setLabel('FT-100', (inst.has('FT-100') && !has('SENSOR_FAULT_FT-100') ? '' : '≈') + fmt(sig.q_in_f, 1, 'm³/h'), has('SUPPLY_LOST'));
    sc.setLabel('LT-101', fmt(sig.level, 2, 'm'), has('LEVEL'));
    sc.setLabel('T-01', `${fmt(pl.volume(), 0)} m³`, has('LEVEL'));
    sc.setLabel('AIT-201', inst.has('AIT-201') ? fmt(sig.cl, 2, 'mg/L') : 'không lắp', has('CL_'));
    sc.setLabel('AIT-202', inst.has('AIT-202') ? fmt(sig.ntu, 2, 'NTU') : 'không lắp', has('NTU_'));
    sc.setLabel('AIT-203', inst.has('AIT-203') ? fmt(sig.ph, 2) : 'không lắp', has('PH_'));
    pl.pumps.forEach((pu, i) => sc.setLabel(pu.tag, pu.fault ? 'LỖI' : pu.running ? `${fmt(pu.f, 1)} Hz · ${fmt(pu.kw, 2)} kW` : 'dừng', pu.fault));
    sc.setLabel('PI-101/102', `${fmt(pl.pumps[0].gauge, 1)} / ${fmt(pl.pumps[1].gauge, 1)} bar`);
    sc.setLabel('HT-01', fmt(pl.htWaterL(), 0, 'L'));
    sc.setLabel('MV-02', this.cfg.hardware['MV-02'] === false ? 'không lắp' : pl.outlet_frac > 0.99 ? 'mở' : pl.outlet_frac < 0.01 ? 'ĐÓNG' : `${fmt(pl.outlet_frac * 100, 0)} %`, pl.outlet_frac < 0.99);
    sc.setLabel('VX-01', pl.drain_open ? 'ĐANG XẢ' : 'đóng', pl.drain_open);
    sc.setLabel('PSV-01', pl.q_relief > 0 ? `xả ${fmt(pl.q_relief, 1)} m³/h` : 'đóng', pl.q_relief > 0);
    sc.setLabel('FV-01', pl.q_in > 0.1 ? 'mở' : 'đóng');
    const dead = Boolean(this.st.gw_dead), fb = this.st.gw_dead;
    const ctlName = { auto: 'tự động', remote: 'TAY từ xa', local: 'TAY tại chỗ' }[g.controlSrc()];
    sc.setLabel('CP-01', `${fmt(pl.kw, 2)} kW`);
    pl.pumps.forEach((pu, i) => sc.setLabel('VFD-0' + (i + 1), pu.fault ? 'LỖI' : pu.running ? `${fmt(pu.f, 1)} Hz · ${fmt(pu.amps, 1)} A` : 'dừng', pu.fault));
    sc.setLabel('WDR-01', dead ? (fb.enabled && fb.active ? 'NHẢ → PID biến tần' : 'NHẢ') : 'giữ (có xung sống)', dead);
    sc.setLabel('EM-101', `${fmt(pl.kw, 2)} kW · ${fmt(this.st.kpi.energy_kwh, 0)} kWh`);
    sc.setLabel('SA-01/02', 'TỰ ĐỘNG (công tắc cứng)'); // công tắc Hand/0/Auto trên cửa tủ – khác chế độ TAY phần mềm
    sc.setLabel('CP-02', dead ? 'BỘ ĐIỀU KHIỂN LỖI' : ctlName, dead || g.controlSrc() !== 'auto');
    sc.setLabel('MPC-01', dead ? 'TREO – watchdog' : { a: '(a) bình thường', b: '(b) tự vận hành', c: '(c) đồng bộ', d: '(d) cảnh báo' }[g.mode()], dead || g.mode() === 'd');
    sc.setLabel('IO-01', dead ? 'mất xung sống' : 'Modbus TCP');
    sc.setLabel('UPS-01', 'nguồn lưới · 100 %');
    sc.setLabel('HMI-01', dead ? 'mất kết nối' : ctlName, dead);
    sc.setLabel('RT-01', dead ? 'mini PC im lặng' : { online: '4G trực tuyến', offline: 'MẤT KẾT NỐI', resync: 'đồng bộ…' }[g.comms.state], dead || g.comms.state === 'offline');
    sc.setLabel('MANG-LUOI', `điểm bất lợi ${fmt(Math.max(0, pl.p_crit), 2)} bar`, pl.p_crit < 1.4);
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
      'GW-01': [['Chế độ', this.st.gw_dead ? 'mini PC ngừng' : MODE_NAME[g.mode()]], ['Quyền điều khiển', CTL_NAME[g.controlSrc()]], ['Kịch bản', 'v' + g.script.version + ' ' + (STRAT_NAME[g.script.strategy] || g.script.strategy)], ['Bộ đệm', g.comms.buf.length + ' bản ghi']],
      'MPC-01': [['Trạng thái', this.st.gw_dead ? 'treo (watchdog đã nhả)' : 'đang chạy GW-01'], ['Chế độ gateway', MODE_NAME[g.mode()]], ['Quyền điều khiển', CTL_NAME[g.controlSrc()]], ['Kịch bản', 'v' + g.script.version + ' ' + (STRAT_NAME[g.script.strategy] || g.script.strategy)], ['Bộ đệm lưu-và-chuyển', g.comms.buf.length + ' bản ghi'], ['Thời gian ngừng lũy kế', fmt((this.st.gw_down_s + (this.st.gw_dead ? this.st.t - this.st.gw_dead.t0 : 0)) / 60, 0, 'phút')]],
      'RT-01': [['Kết nối', COMMS_NAME[g.comms.state] || g.comms.state], ['Dữ liệu lên', fmt(this.st.link.bytes_up / 1e6, 2, 'MB')], ['SMS đã gửi', String(g.comms.stats.sms)]],
      'WDR-01': [['Rơ-le', this.st.gw_dead ? 'nhả' : 'giữ'], ['Dự phòng', this.st.gw_dead ? viNum(this.st.gw_dead.note()) : (this.cfg.hardware.VFD_PID_fallback ? 'sẵn sàng: PID nội ' + fmt(this.cfg.fallback.p_set_bar, 1, 'bar') : 'không lắp – I/O giữ lệnh cuối')]],
      'EM-101': [['Công suất', fmt(pl.kw, 2, 'kW')], ['Điện năng', fmt(this.st.kpi.energy_kwh, 1, 'kWh')]],
      'HMI-01': [['Quyền điều khiển', CTL_NAME[g.controlSrc()]], ['Mở màn HMI', 'nút "HMI" trên thanh trên cùng']],
    };
    pl.pumps.forEach((pu, i) => { L['VFD-0' + (i + 1)] = [['Trạng thái', pu.fault ? 'lỗi' : pu.running ? 'chạy' : 'dừng'], ['Tần số', fmt(pu.f, 1, 'Hz')], ['Dòng điện', fmt(pu.amps, 1, 'A')], ['Công suất', fmt(pu.kw, 2, 'kW')], ['Nguồn lệnh', this.st.gw_dead ? (this.st.gw_dead.enabled ? 'PID nội (watchdog)' : 'giữ lệnh cuối của I/O') : 'mini PC qua Modbus RTU']]; });
    pl.pumps.forEach((pu, i) => { L[pu.tag] = [['Trạng thái', pu.fault ? 'lỗi' : pu.running ? 'chạy' : 'dừng'], ['Tần số', fmt(pu.f, 1, 'Hz')], ['Lưu lượng', fmt(pu.q, 1, 'm³/h')], ['Cột áp', fmt(pu.h, 1, 'm')], ['Công suất', fmt(pu.kw, 2, 'kW')], ['Dòng điện', fmt(pu.amps, 1, 'A')], ['Số lần khởi động', String(pu.starts)], ['Giờ chạy', fmt(pu.run_s / 3600, 1, 'h')]]; });
    return L[tag] || [];
  }
  _initDrawer() {
    // đang nhấn chuột trong thẻ thông tin thì tạm không ghi số mới (giữ nguyên vùng chữ đang bôi chọn)
    const d = this.drawerEl = document.getElementById('drawer');
    d.addEventListener('pointerdown', () => { this._drawerHold = true; });
    for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { this._drawerHold = false; });
  }
  /**
   * Thẻ thông tin thiết bị: dựng một lần cho mỗi thiết bị, các nhịp sau (refresh) chỉ ghi lại ô "Giá trị hiện tại" khi đổi
   * nên tiêu điểm bàn phím và vùng chọn chữ không mất. Mở bằng bàn phím thì đưa tiêu điểm vào thẻ; đóng thì trả về nút đã mở.
   */
  openDrawer(tag, refresh = false) {
    const d = this.drawerEl, cur = this._drawer;
    if (refresh) { if (!this._drawerHold && cur && cur.tag === tag && !d.hidden) cur.update(); return; }
    if (cur && cur.tag === tag && !d.hidden) { cur.update(); return; }
    const info = this.panels.componentInfo(tag);
    if (!info) return;
    const ae = document.activeElement, kbd = Boolean(ae && ae !== document.body && ae.matches?.(':focus-visible'));
    if (!d.contains(ae)) this._drawerBack = ae && ae !== document.body ? ae : null;
    this.drawerTag = tag; this._drawer = info;
    d.replaceChildren(info.el); d.hidden = false; d.scrollTop = 0;
    if (this.viewMode !== 'hmi' && !this._ctlOpen()) this.scene3d.highlight(tag);
    if (kbd || d.contains(ae)) info.focusEl.focus({ preventScroll: true });
  }
  closeDrawer() {
    const d = this.drawerEl;
    if (!d) return;
    const had = !d.hidden, back = this._drawerBack, inside = d.contains(document.activeElement) || document.activeElement === document.body;
    this.drawerTag = null; this._drawer = null; this._drawerBack = null; d.hidden = true;
    if (had && !this._ctlOpen()) this.scene3d?.highlight(null);
    if (had && inside && back?.isConnected && back.getClientRects().length) back.focus({ preventScroll: true });
  }
  /** Bảng điều khiển nổi 3D đang mở (khi đó nó giữ phần tô sáng của cảnh). */
  _ctlOpen() { const c = this.ctl3d; return Boolean(c && (c.isOpen ? c.isOpen() : c.cur)); }
  /**
   * Chỉ thiết bị trong cảnh 3D (từ danh mục Thiết bị / nút "Xem trong 3D"): tô sáng, và đưa camera tới khi thiết bị nằm ngoài
   * vùng trống giữa HUD, dock, bảng bên phải, hoặc camera đang ở quá xa so với cỡ thiết bị. force: luôn đưa camera tới.
   */
  showInScene(tag, force = false) {
    const sc = this.scene3d;
    if (!sc?.byTag?.has(tag)) return false;
    if (this.viewMode === 'hmi') { if (!force) return false; this.setView('3d'); }
    if (!this._ctlOpen()) sc.highlight(tag);
    if (force || this._offView(tag)) sc.focus(tag);
    return true;
  }
  _offView(tag) {
    const sc = this.scene3d, I = this.insets || {}, p = sc.bodyPos(tag, {}), m = 24;
    if (!p.visible) return true;
    if (p.x < (I.l || 0) + m || p.x > innerWidth - Math.max(I.r || 0, I.sr || 0) - m || p.y < (I.t || 0) + m || p.y > innerHeight - Math.max(I.b || 0, I.sb || 0) - m) return true;
    const b = sc._boxOf?.(tag);
    if (!b || b.isEmpty()) return false;
    const c = b.min.clone().add(b.max).multiplyScalar(0.5), size = b.max.distanceTo(b.min);
    return sc.camera.position.distanceTo(c) > Math.max(9, size * 12);
  }
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = viNum(msg); t.hidden = false;
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }
  // ---------- biểu đồ ----------
  /** Vẽ lại biểu đồ – bỏ qua khi bảng biểu đồ đang đóng (vẽ lại ngay khi mở). */
  updateCharts() {
    if (!this.st || !this.charts || !this.shell.chartsVisible()) return;
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
  console.error(e);
  const boot = document.getElementById('boot') ?? document.getElementById('vp').appendChild(h('p', { id: 'boot', class: 'boot' }));
  boot.textContent = 'Không tải được cấu hình (' + e.message + '). Hãy chạy máy chủ web tĩnh từ thư mục gốc: python -m trambom web';
});
