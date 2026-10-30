// Màn "Mạng lưới": trung tâm giám sát SYSTEM nhìn toàn bộ các trạm bơm ở Hà Nội. Năm màn trong một khung:
// bản đồ · danh sách trạm · báo động & tự xử lý · hiệu quả · kịch bản & triển khai. Nhấp một trạm → chi tiết 3D / HMI như trước.
import { fleetTotals, stationSummary } from '../sim/fleet.js';
import { h, fmt } from './dom.js';
import { MapScreen } from './fleet-map.js';
import { AlarmScreen, ListScreen, PerfScreen, RolloutScreen } from './fleet-screens.js';
import { ico } from './shell.js';

const TABS = [['map', 'Bản đồ', 'city'], ['list', 'Danh sách trạm', 'list'], ['alarm', 'Báo động & tự xử lý', 'bell'], ['perf', 'Hiệu quả', 'compare'], ['roll', 'Kịch bản & triển khai', 'code']];
const SAMPLE_S = 300; // lấy mẫu chuỗi thời gian toàn mạng mỗi 5 phút mô phỏng

export class FleetView {
  constructor(host, app) {
    this.app = app; this.visible = false; this.tab = 'map'; this.sel = null; this.rows = []; this.byId = {}; this.tot = null;
    this._resetHist();
    this.root = h('div', { class: 'fleet', hidden: true, 'aria-label': 'Mạng lưới trạm bơm tăng áp Hà Nội' });
    host.append(this.root);
    this.screens = { map: new MapScreen(this), list: new ListScreen(this), alarm: new AlarmScreen(this), perf: new PerfScreen(this), roll: new RolloutScreen(this) };
    this.tabBtns = {};
    const bar = h('nav', { class: 'fl-tabs', role: 'tablist', 'aria-label': 'Các màn của mạng lưới' }, ...TABS.map(([k, label, icon]) => {
      const b = h('button', { class: 'fl-tab', role: 'tab', type: 'button', 'data-k': k, onclick: () => this.setTab(k) }, ico(icon), h('span', {}, label), h('i', { class: 'fl-badge', hidden: true }));
      this.tabBtns[k] = b; return b;
    }), h('span', { class: 'spacer' }), this.sub = h('span', { class: 'fl-sub' }));
    this.kpis = h('div', { class: 'fl-kpis' });
    this.body = h('div', { class: 'fl-body' }, ...Object.entries(this.screens).map(([k, s]) => { s.el.classList.add('fl-screen'); s.el.dataset.k = k; s.el.hidden = k !== this.tab; return s.el; }));
    this.root.append(bar, this.kpis, this.body);
    this._buildKpis();
    this.setTab('map');
  }
  _resetHist() { this.hist = { t: [], kw: [], f_kw: [], q: [], f_q: [], ok: [], f_ok: [] }; this._next = 0; }
  reset() { this.sel = null; this._resetHist(); this.screens?.alarm.reset(); this._ak = null; for (const s of Object.values(this.screens ?? {})) { s._k = s._ak = s._fk = s._bk = s._sk = s._lk = null; } this.rows = []; this.byId = {}; if (this.visible) this.update(true); }
  /** Lấy mẫu chuỗi thời gian toàn mạng (gọi mỗi bước mô phỏng; chỉ ghi khi tới kỳ). */
  sample(t) {
    if (t < this._next) return;
    this._next = t + SAMPLE_S;
    const net = this.app.net, sv = this.app.cfg.service, H = this.hist;
    let kw = 0, fkw = 0, q = 0, fq = 0, ok = 0, fok = 0;
    net.smart.forEach((s, i) => {
      const p = s.plant, f = net.fixed[i];
      kw += p.kw; q += p.q_out; if (p.p_crit >= sv.p_crit_min_bar && p.p_net <= sv.p_out_max_bar) ok++;
      if (f) { fkw += f.plant.kw; fq += f.plant.q_out; if (f.plant.p_crit >= sv.p_crit_min_bar && f.plant.p_net <= sv.p_out_max_bar) fok++; }
    });
    H.t.push(t); H.kw.push(kw); H.f_kw.push(fkw); H.q.push(q); H.f_q.push(fq); H.ok.push(ok); H.f_ok.push(fok);
  }
  show(on) {
    this.visible = on; this.root.hidden = !on;
    if (on) { this.update(true); requestAnimationFrame(() => { this.screens.map._fit(); this.screens.perf._draw(); }); }
  }
  setTab(k) {
    this.tab = k;
    for (const [n, s] of Object.entries(this.screens)) s.el.hidden = n !== k;
    for (const [n, b] of Object.entries(this.tabBtns)) { b.classList.toggle('on', n === k); b.setAttribute('aria-selected', String(n === k)); b.tabIndex = n === k ? 0 : -1; }
    if (this.visible) { this.update(true); requestAnimationFrame(() => { if (k === 'map') this.screens.map._fit(); if (k === 'perf') this.screens.perf._draw(); }); }
  }
  /** Chọn một trạm (không mở chi tiết); fly: đưa bản đồ tới trạm. */
  select(sid, fly = false) {
    this.sel = sid;
    if (sid && fly) { this.setTab('map'); this.screens.map.flyTo(sid); }
    this.update(true);
  }
  _buildKpis() {
    const tile = (k, label) => { const b = h('b', {}, '–'), s = h('small', {}), t = h('div', { class: 'fl-k', 'data-k': k }, h('span', { class: 'lbl' }, label), b, s); this.kpis.append(t); return { t, b, s }; };
    this.K = { on: tile('on', 'Trạm trực tuyến'), al: tile('al', 'Báo động đang mở'), q: tile('q', 'Lưu lượng toàn mạng'), kw: tile('kw', 'Công suất điện'), sv: tile('sv', 'Tiết kiệm điện'), hh: tile('hh', 'Khu vực phục vụ') };
  }
  _upd() {
    const net = this.app.net, K = this.K, t = this.tot, by = t.by, set = (e, s) => { if (e._t !== s) { e._t = s; e.textContent = s; } };
    const online = t.n - by.offline, bad = by.crit + by.warn;
    set(K.on.b, `${online}/${t.n}`); set(K.on.s, by.offline ? `${by.offline} mất kết nối – đang tự vận hành` : by.sync ? `${by.sync} đang đồng bộ` : 'tất cả đang truyền dữ liệu');
    K.on.t.classList.toggle('warn', by.offline > 0);
    const open = [...this.app.server.alarms.values()].filter((a) => a.code !== 'STATION_OFFLINE'), need = open.filter((a) => (a.sev === 'critical' || a.sev === 'alarm') && !a.acked).length;
    set(K.al.b, String(open.length)); set(K.al.s, open.length ? `${need} khẩn / báo động chưa xác nhận · ${bad} trạm bị ảnh hưởng` : 'không có báo động');
    K.al.t.classList.toggle('crit', need > 0); K.al.t.classList.toggle('warn', open.length > 0 && !need);
    set(K.q.b, fmt(t.flow, 0)); set(K.q.s, 'm³/h cấp ra mạng lưới');
    set(K.kw.b, fmt(t.kw, 1)); set(K.kw.s, 'kW · ' + fmt(t.smart_kwh, 0) + ' kWh từ đầu');
    set(K.sv.b, t.fixed_kwh > 1 ? fmt(t.saved_pct, 0) + ' %' : '–'); set(K.sv.s, t.fixed_kwh > 1 ? `${fmt(t.saved_kwh, 0)} kWh so với lịch cố định` : 'so với lịch cố định');
    set(K.hh.b, t.households.toLocaleString('vi-VN')); set(K.hh.s, 'hộ · ' + t.n + ' trạm, DMA riêng');
    for (const [k, b] of Object.entries(this.tabBtns)) { const el = b.querySelector('.fl-badge'); const n = k === 'alarm' ? need : k === 'list' ? bad : 0; set(el, n ? String(n) : ''); el.hidden = !n; }
    const clk = document.getElementById('clock-t')?.textContent, day = document.getElementById('clock-d')?.textContent;
    set(this.sub, `${this.app.hanoi.operator.center}${clk ? ' · ' + (day ? day + ' ' : '') + clk : ''}`);
  }
  update(force = false) {
    if (!this.visible || !this.app.net) return;
    const net = this.app.net;
    this.rows = net.smart.map((_, i) => stationSummary(net, i));
    this.byId = Object.fromEntries(this.rows.map((r) => [r.sid, r]));
    this.tot = fleetTotals(net, this.rows);
    this._upd();
    const s = this.screens[this.tab];
    s.update(this, force);
  }
}
