// Các màn của khu Mạng lưới (ngoài bản đồ): danh sách trạm, báo động & tự xử lý, hiệu quả, kịch bản & triển khai.
// Mọi số liệu lấy từ mô phỏng của từng trạm và từ MÁY CHỦ (đúng những gì trung tâm thực sự nhìn thấy).
import { FLEET_STATUS } from '../sim/fleet.js';
import { TimeChart } from './charts.js';
import { h, fmt, SEV_LABEL, tShort } from './dom.js';
import { MODE_NAME, STRAT_NAME, viNum, viText } from './ops.js';
import { modeChipTxt } from './panels.js';

export const CHIP = { ok: 'good', sync: 'info', offline: 'off', warn: 'warning', crit: 'critical' };
const statusChip = (r) => h('span', { class: 'chip ' + CHIP[r.status] }, FLEET_STATUS[r.status].label);
const T = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const stBtn = (f, sid, label) => h('button', { class: 'linkbtn mono', type: 'button', title: 'Mở chi tiết ' + sid, onclick: (e) => { e.stopPropagation(); f.app.openStation(sid); } }, label ?? sid);

// ============================== Danh sách trạm ==============================
const COLS = [
  ['status', 'Trạng thái', (r) => FLEET_STATUS[r.status].rank, 'l'], ['sid', 'Trạm', (r) => r.sid, 'l'], ['area', 'Khu vực', (r) => r.site.area, 'l'], ['mode', 'Chế độ', (r) => r.mode, 'l'],
  ['p', 'Áp ra (bar)', (r) => r.p, 'n'], ['pc', 'Áp bất lợi (bar) · logger', (r) => r.p_crit, 'n'], ['q', 'Lưu lượng (m³/h)', (r) => r.q, 'n'], ['lv', 'Mức bể (m)', (r) => r.level, 'n'],
  ['kw', 'Công suất (kW)', (r) => r.kw, 'n'], ['wq', 'Clo / đục / pH', (r) => r.cl, 'n'], ['sv', 'Tiết kiệm điện *', (r) => (r.fixed_kwh > 0 ? 1 - r.energy_kwh / r.fixed_kwh : -1), 'n'], ['al', 'Báo động', (r) => r.alarms, 'n'], ['sp', 'Áp ra 6 giờ', null, 'l'],
];
export class ListScreen {
  constructor(fleet) {
    this.f = fleet; this.sort = { key: 'status', dir: -1 }; this.filter = 'all'; this.q = ''; this.rowEls = new Map();
    this.chips = h('div', { class: 'seg fl-fseg', role: 'group', 'aria-label': 'Lọc theo trạng thái' });
    this.search = h('input', { type: 'search', class: 'fl-search', placeholder: 'Tìm trạm, khu vực…', 'aria-label': 'Tìm trạm', oninput: (e) => { this.q = e.target.value.trim().toLowerCase(); this._k = null; this.update(this.f); } });
    this.head = h('tr', {}, ...COLS.map(([k, label, fn, al]) => h('th', { class: al === 'n' ? 'n' : '', 'aria-sort': 'none', scope: 'col' },
      fn ? h('button', { type: 'button', class: 'fl-th', onclick: () => { this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : (k === 'status' || k === 'al' ? -1 : 1) }; this._k = null; this.update(this.f); } }, label, h('i', { class: 'arr' })) : label)));
    this.body = h('tbody');
    this.count = h('span', { class: 'fl-count' });
    this.el = h('div', { class: 'fl-list' },
      h('div', { class: 'fl-tools' }, this.chips, this.search, this.count),
      h('div', { class: 'fl-tw' }, h('table', { class: 'fl-table' }, h('thead', {}, this.head), this.body)),
      h('p', { class: 'note' }, '* So với lịch cố định chạy song song cùng nhu cầu và cùng sự cố. Âm khi lịch cố định ngừng cấp nước do sự cố nên tốn ít điện hơn nhưng mất dịch vụ. Áp bất lợi do logger NB-IoT PL-301 đo, độc lập với 4G của gateway.'));
  }
  _row(r) {
    const c = {};
    const td = (k, cls = '') => (c[k] = h('td', { class: cls }));
    const tr = h('tr', { class: 'rowgo', tabindex: 0, title: 'Nhấp để chọn · nhấp đúp hoặc Enter để mở chi tiết' }, td('status'), td('sid', 'mono'), td('area'), td('mode'), td('p', 'n'), td('pc', 'n'), td('q', 'n'), td('lv', 'n'), td('kw', 'n'), td('wq', 'n'), td('sv', 'n'), td('al', 'n'), td('sp', 'sp'));
    c.sid.append(stBtn(this.f, r.sid)); c.area.textContent = `${r.site.area} · ${r.site.district}`;
    c.spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); c.spark.setAttribute('viewBox', '0 0 90 22'); c.spark.setAttribute('class', 'fl-spark'); c.spark.setAttribute('preserveAspectRatio', 'none');
    c.line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); c.spark.append(c.line); c.sp.append(c.spark);
    tr.addEventListener('click', () => this.f.select(r.sid));
    tr.addEventListener('dblclick', () => this.f.app.openStation(r.sid));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) this.f.app.openStation(r.sid); });
    c.tr = tr; return c;
  }
  update(f) {
    const rows = f.rows, by = { all: rows.length, ok: 0, sync: 0, offline: 0, warn: 0, crit: 0 };
    for (const r of rows) by[r.status]++;
    const fk = `${this.filter}|${by.all}${by.ok}${by.sync}${by.offline}${by.warn}${by.crit}`;
    if (fk !== this._fk) {
      this._fk = fk;
      this.chips.replaceChildren(...[['all', 'Tất cả'], ['crit', 'Báo động'], ['warn', 'Cảnh báo'], ['offline', 'Mất kết nối'], ['sync', 'Đồng bộ'], ['ok', 'Bình thường']].map(([k, l]) =>
        h('button', { class: k === this.filter ? 'on' : '', 'aria-pressed': String(k === this.filter), onclick: () => { this.filter = k; this._fk = null; this._k = null; this.update(this.f); } }, `${l} `, h('b', {}, String(by[k])))));
    }
    const { key, dir } = this.sort, col = COLS.find((c) => c[0] === key), get = col[2] ?? (() => 0);
    let list = rows.filter((r) => (this.filter === 'all' || r.status === this.filter) && (!this.q || `${r.sid} ${r.site.area} ${r.site.district} ${r.site.kind}`.toLowerCase().includes(this.q)));
    list = [...list].sort((x, y) => { const a = get(x), b = get(y); const c = typeof a === 'string' ? a.localeCompare(b) : (Number.isFinite(a) ? a : -1e9) - (Number.isFinite(b) ? b : -1e9); return (c || x.sid.localeCompare(y.sid)) * dir; });
    const ok = list.map((r) => r.sid).join(',');
    this.head.querySelectorAll('th').forEach((th, i) => th.setAttribute('aria-sort', COLS[i][0] === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
    T(this.count, `${list.length}/${rows.length} trạm`);
    for (const r of list) {
      let c = this.rowEls.get(r.sid); if (!c) { c = this._row(r); this.rowEls.set(r.sid, c); }
      c.tr.classList.toggle('cur', f.sel === r.sid);
      const mode = r.online ? r.mode : (r.dead ? 'x' : 'b');
      if (c.status._k !== r.status) { c.status._k = r.status; c.status.replaceChildren(statusChip(r)); }
      if (c.mode._k !== mode + r.online) { c.mode._k = mode + r.online; c.mode.replaceChildren(h('span', { class: 'chip ' + ({ a: 'good', b: 'warning', c: 'info', d: 'critical', x: 'critical' }[mode]) }, ...modeChipTxt(MODE_NAME[mode].split(' – ')[0].replace('Mini PC lỗi · PID biến tần', 'Mini PC lỗi')))); }
      const stale = !r.online; // trung tâm chỉ có số liệu cũ khi trạm mất kết nối
      for (const [k, v] of [['p', fmt(r.p, 2)], ['pc', fmt(Math.max(0, r.p_crit), 2)], ['q', fmt(r.q, 1)], ['lv', fmt(r.level, 2)], ['kw', fmt(r.kw, 2)], ['wq', `${fmt(r.cl, 2)} / ${fmt(r.ntu, 2)} / ${fmt(r.ph, 1)}`],
        ['sv', r.fixed_kwh > 0.5 ? fmt(100 * (1 - r.energy_kwh / r.fixed_kwh), 0) + ' %' : '–'], ['al', r.alarms ? String(r.alarms) : '–']]) T(c[k], v);
      c.tr.classList.toggle('stale', stale);
      c.p.classList.toggle('bad', Number.isFinite(r.p) && r.online && (r.p > 4.0)); c.pc.classList.toggle('bad', Number.isFinite(r.p_crit) && r.p_crit < 1.4 && r.online);
      c.al.classList.toggle('bad', r.crit > 0);
      // đường áp ra 6 giờ gần nhất
      const hs = f.app.net.smart[r.i].hist.data, t1 = hs.t.length, t0 = Math.max(0, t1 - 2160), step = Math.max(1, Math.floor((t1 - t0) / 40)), pts = [];
      for (let i = t0, j = 0; i < t1; i += step, j++) { const v = hs.p_out[i]; if (Number.isFinite(v)) pts.push(`${(j * 90 / 40).toFixed(1)},${(21 - Math.max(0, Math.min(1, (v - 1) / 3.6)) * 20).toFixed(1)}`); }
      c.line.setAttribute('points', pts.join(' '));
    }
    if (ok !== this._k) { this._k = ok; this.body.replaceChildren(...list.map((r) => this.rowEls.get(r.sid).tr)); if (!list.length) this.body.append(h('tr', {}, h('td', { colspan: COLS.length, class: 'note' }, 'Không có trạm nào khớp bộ lọc.'))); }
  }
}

// ============================== Báo động & tự xử lý ==============================
function classify(e) {
  const x = e.text || '';
  if (e.src === 'sv') {
    if (/^Lệnh C\d+|^Trạm xác nhận lệnh|^Phát hành kịch bản/.test(x)) return 'cmd';
    if (/mất kết nối \(LWT\)|kết nối lại|^Đồng bộ trạm/.test(x)) return 'link';
    return null; // các dòng khác đã có ở nhật ký gateway
  }
  if (/^BÁO ĐỘNG \[/.test(x)) return 'alarm';
  if (/^Hết báo động/.test(x)) return 'clear';
  if (/^Lệnh từ xa/.test(x)) return 'cmd';
  if (e.level === 'safety' || /chuyển chế độ|chuyển bơm|tự vận hành|PID nội|tiếp quản|Đồng bộ hoàn tất|Khôi phục kết nối|Ghép bơm|Kết thúc dừng an toàn|SMS|quay lui|Mini PC/.test(x)) return 'auto';
  return null;
}
const KIND = { alarm: ['Báo động', 'critical'], clear: ['Hết', 'good'], auto: ['Tự xử lý', 'info'], cmd: ['Lệnh', 'warning'], link: ['Kết nối', 'off'] };

export class AlarmScreen {
  constructor(fleet) {
    this.f = fleet; this.fAl = 'all'; this.fFeed = 'all'; this._lastN = 0;
    this.stats = h('div', { class: 'fl-stats' });
    this.alSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Lọc báo động' }, ...[['all', 'Tất cả'], ['open', 'Chưa xác nhận'], ['crit', 'Khẩn / báo động']].map(([k, l]) => h('button', { 'data-k': k, class: k === 'all' ? 'on' : '', onclick: () => { this.fAl = k; this._ak = null; this.alSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); this.update(this.f); } }, l)));
    this.ackAll = h('button', { class: 'btn small', type: 'button', onclick: () => { const a = this.f.app; for (const x of a.server.alarms.values()) if (!x.acked && x.code !== 'STATION_OFFLINE') a.server.ackAlarm(x.station, x.code, a.net.t); this._ak = null; this.update(this.f); } }, 'Xác nhận tất cả');
    this.alBox = h('div', { class: 'fl-albox' });
    this.feedSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Lọc dòng sự kiện' }, ...[['all', 'Tất cả'], ['auto', 'Tự xử lý'], ['alarm', 'Báo động'], ['cmd', 'Lệnh trung tâm'], ['link', 'Kết nối']].map(([k, l]) => h('button', { 'data-k': k, class: k === 'all' ? 'on' : '', onclick: () => { this.fFeed = k; this._fk = null; this.feedSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); this.update(this.f); } }, l)));
    this.feedBox = h('div', { class: 'fl-feed', role: 'log', 'aria-live': 'off' });
    this.el = h('div', { class: 'fl-alarm' }, this.stats,
      h('div', { class: 'fl-cols' },
        h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Báo động tập trung'), this.alSeg, this.ackAll), this.alBox),
        h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Hệ thống đã tự xử lý'), this.feedSeg), this.feedBox)));
    this.counts = { auto: 0, cmd: 0 }; this.items = [];
  }
  reset() { this._lastN = 0; this.items = []; this.counts = { auto: 0, cmd: 0 }; this._ak = this._fk = null; }
  _ingest(feed) {
    // chỉ duyệt các dòng mới (theo số thứ tự n; dòng sự kiện chung có thể bị cắt bớt phía đầu)
    let i = feed.length;
    while (i > 0 && feed[i - 1].n > this._lastN) i--;
    for (; i < feed.length; i++) {
      const e = feed[i]; this._lastN = e.n;
      const k = classify(e); if (!k) continue;
      this.items.push({ ...e, kind: k }); if (k === 'auto' || k === 'cmd') this.counts[k]++;
    }
    if (this.items.length > 800) this.items.splice(0, 200);
  }
  update(f) {
    const a = f.app, srv = a.server;
    this._ingest(a.feed);
    const all = [...srv.alarms.values()], open = all.filter((x) => !x.acked && x.code !== 'STATION_OFFLINE'), hist = srv.alarm_history;
    const raised = hist.filter((x) => x.action === 'raise').length, cleared = hist.filter((x) => x.action === 'clear').length;
    const offMin = Object.values(srv.stations).reduce((s, st) => s + st.offline_periods.reduce((m, [a0, a1]) => m + ((a1 ?? a.net.t) - a0), 0), 0) / 60;
    const late = Object.values(srv.stations).reduce((s, st) => s + st.late, 0);
    const need = all.filter((x) => x.code !== 'STATION_OFFLINE' && (x.sev === 'critical' || x.sev === 'alarm') && !x.acked).length;
    const sk = [raised, cleared, all.length, need, this.counts.auto, this.counts.cmd, Math.round(offMin), late].join(',');
    if (sk !== this._sk) {
      this._sk = sk;
      const tile = (v, l, s, cls = '') => h('div', { class: 'fl-stat ' + cls }, h('b', {}, v), h('span', {}, l), h('small', {}, s));
      this.stats.replaceChildren(
        tile(String(raised), 'báo động phát sinh', `${cleared} đã tự hết · ${all.length} đang mở`),
        tile(String(need), 'cần điều độ viên', 'báo động / khẩn chưa xác nhận', need ? 'crit' : 'ok'),
        tile(String(this.counts.auto), 'lần hệ thống tự xử lý', 'chuyển bơm dự phòng, dừng an toàn, tự vận hành, đồng bộ…'),
        tile(String(this.counts.cmd), 'lệnh từ trung tâm', 'xả bể, đặt lại, phát hành kịch bản…'),
        tile(fmt(offMin, 0, 'phút'), 'các trạm tự vận hành khi mất mạng', `${late} bản ghi đệm đã phát lại đủ sau đồng bộ`));
    }
    // bảng báo động
    let list = sortedCentral(all);
    if (this.fAl === 'open') list = list.filter((x) => !x.acked);
    if (this.fAl === 'crit') list = list.filter((x) => x.sev === 'critical' || x.sev === 'alarm');
    const key = list.map((x) => x.station + x.code + x.acked + x.sev).join(',') + this.fAl;
    this.ackAll.disabled = !open.length;
    if (key !== this._ak) {
      this._ak = key;
      this.alBox.replaceChildren(...(list.length ? list.map((x) => {
        const sid = x.station, act = [];
        if (x.code === 'SAFE_STOP') act.push(h('button', { class: 'btn small', type: 'button', title: 'Gửi lệnh đặt lại dừng an toàn (trạm chỉ thực hiện khi chất lượng nước đã đạt)', onclick: () => { srv.sendCommand(sid, 'reset_safe_stop', {}, a.net.t, 3600); a.toast('Đã gửi lệnh đặt lại tới ' + sid); } }, 'Đặt lại'));
        if (!x.acked && x.code !== 'STATION_OFFLINE') act.push(h('button', { class: 'btn small', type: 'button', onclick: () => { srv.ackAlarm(sid, x.code, a.net.t); this._ak = null; this.update(f); } }, 'Xác nhận'));
        return h('div', { class: 'alarm-row fl-ar' }, h('span', { class: 'chip ' + x.sev }, SEV_LABEL[x.sev] ?? x.sev),
          h('div', { class: 'msg' }, stBtn(f, sid, `${sid} · ${f.byId[sid]?.site.area ?? ''}`), ' ', h('code', {}, x.code), h('div', {}, viNum(x.msg)), h('div', { class: 'when' }, tShort(x.t) + (x.acked ? ' · đã xác nhận' : ''))), h('div', { class: 'fl-acts' }, ...act));
      }) : [h('p', { class: 'note ok' }, this.fAl === 'all' ? 'Không có báo động nào đang mở. Hệ thống đang giám sát tự động toàn mạng.' : 'Không có báo động khớp bộ lọc.')]));
    }
    // dòng sự kiện
    const fl = this.items.filter((e) => this.fFeed === 'all' || e.kind === this.fFeed || (this.fFeed === 'alarm' && e.kind === 'clear')).slice(-150).reverse();
    const fkey = fl.length + ':' + (fl[0]?.t ?? 0) + (fl[0]?.sid ?? '') + this.fFeed;
    if (fkey !== this._fk) {
      this._fk = fkey;
      this.feedBox.replaceChildren(...(fl.length ? fl.map((e) => { const [lbl, cls] = KIND[e.kind]; return h('div', { class: 'fl-ev ' + e.kind }, h('span', { class: 't' }, tShort(e.t)), stBtn(f, e.sid), h('span', { class: 'chip ' + cls }, lbl), h('span', { class: 'x' }, viText(e.text))); })
        : [h('p', { class: 'note' }, 'Chưa có sự kiện. Chạy mô phỏng hoặc giả lập sự cố ở một trạm để xem hệ thống tự xử lý.')]));
    }
  }
}
const SEV_RANK = { critical: 0, alarm: 1, serious: 1, warning: 2, info: 3 };
const sortedCentral = (list) => [...list].sort((x, y) => (SEV_RANK[x.sev] - SEV_RANK[y.sev]) || (y.t - x.t));

// ============================== Hiệu quả toàn mạng ==============================
export class PerfScreen {
  constructor(fleet) {
    this.f = fleet;
    this.tiles = h('div', { class: 'fl-tiles' });
    this.cwrap = h('div', { class: 'fl-charts' });
    this.cKw = new TimeChart(this.cwrap, { title: 'Công suất điện toàn mạng', subtitle: 'kW · thông minh so với lịch cố định', unit: 'kW', zero: true, series: [{ key: 'kw', label: 'Thông minh', color: '--s-smart' }, { key: 'f_kw', label: 'Lịch cố định', color: '--s-fixed' }] });
    this.cQ = new TimeChart(this.cwrap, { title: 'Lưu lượng cấp ra mạng', subtitle: 'm³/h · toàn mạng', unit: 'm³/h', nd: 0, zero: true, series: [{ key: 'q', label: 'Thông minh', color: '--s-smart' }, { key: 'f_q', label: 'Lịch cố định', color: '--s-fixed' }] });
    this.cOk = new TimeChart(this.cwrap, { title: 'Số trạm đạt dải áp dịch vụ', subtitle: 'điểm bất lợi ≥ 1,4 bar và áp ra ≤ 4,0 bar', unit: 'trạm', nd: 0, zero: true, series: [{ key: 'ok', label: 'Thông minh', color: '--s-smart' }, { key: 'f_ok', label: 'Lịch cố định', color: '--s-fixed' }] });
    this.bars = h('div', { class: 'fl-bars' });
    this.el = h('div', { class: 'fl-perf' }, this.tiles, h('div', { class: 'fl-cols pf' }, h('div', { class: 'fl-pcharts' }, this.cwrap), h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Tiết kiệm điện theo trạm'), h('small', {}, 'so với vận hành lịch cố định cùng nhu cầu')), this.bars)),
      h('p', { class: 'note' }, 'Phương án lịch cố định chạy song song với cùng nhu cầu và cùng sự cố (xem README). Tiền điện quy đổi theo giá bình quân giả định; chưa tính giá điện theo giờ.'));
    new ResizeObserver(() => this._draw()).observe(this.cwrap);
  }
  _draw() { const f = this.f, H = f.hist; if (!f.visible || f.tab !== 'perf' || !H.t.length) return; const n = H.t.length, win = [Math.max(0, H.t[n - 1] - 86400), Math.max(H.t[n - 1], 3600)]; let i0 = 0; while (i0 < n && H.t[i0] < win[0]) i0++; const base = { t: H.t, i0, window: win, spans: [] }; this.cKw.setData({ ...base, series: { kw: H.kw, f_kw: H.f_kw } }); this.cQ.setData({ ...base, series: { q: H.q, f_q: H.f_q } }); this.cOk.setData({ ...base, series: { ok: H.ok, f_ok: H.f_ok } }); }
  update(f) {
    const net = f.app.net, tariff = f.app.cfg.fleet.tariff_vnd_per_kwh, t = f.tot;
    const sum = net.smart.map((s) => s.kpi.summary(s.plant)), fs = net.fixed.map((s) => s.kpi.summary(s.plant));
    const S = (xs, k) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);
    const ready = net.t >= 900; // dưới 15 phút mô phỏng các tỉ lệ chưa có nghĩa
    const eS = S(sum, 'energy_kwh'), eF = S(fs, 'energy_kwh'), dS = S(sum, 'delivered_m3'), dF = S(fs, 'delivered_m3');
    const band = (xs) => xs.reduce((a, x) => a + x.pct_in_band, 0) / xs.length;
    const inc = (xs) => { const all = xs.flatMap((x) => x.incidents), det = all.filter((i) => i.detected !== null); return { n: all.length, det: det.length, avg: det.length ? det.reduce((a, i) => a + (i.detected - i.t), 0) / det.length / 60 : null }; };
    const iS = inc(sum), iF = inc(fs);
    const saved = eF - eS;
    const k = [fmt(saved, 0), fmt(eS, 0), fmt(dS, 0), fmt(band(sum), 1), fmt(band(fs), 1), S(sum, 'quality_episodes'), S(sum, 'starts_total'), S(fs, 'starts_total'), iS.det, iS.n, iF.det, fmt(iS.avg, 1)].join(',');
    if (k !== this._k) {
      this._k = k;
      const card = (label, big, sub, cls = '') => h('div', { class: 'fl-tile ' + cls }, h('span', { class: 'lbl' }, label), h('b', {}, big), h('small', {}, sub));
      this.tiles.replaceChildren(
        card('Điện năng tiết kiệm', ready ? fmt(saved, 0) + ' kWh' : '–', ready ? `${fmt(t.saved_pct, 1)} % · ≈ ${fmt(saved * tariff / 1000, 0)} nghìn đ (giá giả định)` : 'cần ≥ 15 phút mô phỏng', 'good'),
        card('Suất điện năng', ready ? fmt(dS > 0 ? eS / dS : null, 3) + ' kWh/m³' : '–', ready ? `lịch cố định ${fmt(dF > 0 ? eF / dF : null, 3)} kWh/m³` : ''),
        card('Rò rỉ trên mạng lưới', ready ? fmt(t.smart_nrw_pct, 1) + ' %' : '–', ready ? `lịch cố định ${fmt(t.fixed_nrw_pct, 1)} % · rò rỉ / nước cấp ra` : ''),
        card('Thời gian đạt dải áp', ready ? fmt(band(sum), 1) + ' %' : '–', ready ? `lịch cố định ${fmt(band(fs), 1)} % · trung bình ${sum.length} trạm` : ''),
        card('Phát hiện sự cố', iS.n ? `${iS.det}/${iS.n}` : '–', iS.n ? `TB ${fmt(iS.avg, 1)} phút · lịch cố định: ${iF.det}/${iF.n} sự cố được phát hiện` : 'chưa có sự cố nào'),
        card('Số lần khởi động bơm', String(S(sum, 'starts_total')), `lịch cố định ${S(fs, 'starts_total')} · vi phạm chất lượng nước ${S(sum, 'quality_episodes')} lần`));
    }
    // thanh tiết kiệm theo trạm
    const rows = f.rows.map((r) => ({ r, v: r.fixed_kwh > 0.5 ? 100 * (1 - r.energy_kwh / r.fixed_kwh) : null })).sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
    const bk = rows.map((x) => x.r.sid + Math.round(x.v ?? -1)).join(',');
    if (bk !== this._bk) {
      this._bk = bk; const mx = Math.max(50, ...rows.map((x) => x.v ?? 0));
      this.bars.replaceChildren(...rows.map(({ r, v }) => h('button', { class: 'fl-bar', type: 'button', title: `${r.sid} · ${r.site.area}`, onclick: () => f.select(r.sid) },
        h('span', { class: 'mono' }, r.sid), h('span', { class: 'nm' }, r.site.area), h('span', { class: 'tr' }, h('i', { style: `width:${v === null ? 0 : Math.max(0, v / mx * 100)}%` })), h('b', {}, v === null ? '–' : fmt(v, 0) + ' %'))));
    }
    this._draw();
  }
}

// ============================== Kịch bản & triển khai ==============================
const PRESETS = [
  { id: 'adv', name: 'Chuyển sang điều khiển dự báo (nâng cao)', note: 'Mẫu 168 giờ, biên áp theo độ bất định, phát hiện rò rỉ ban đêm, biểu quyết cảm biến áp.', strategy: 'predictive', patch: { 'features.pressure_voting': true, 'features.anomaly_detection': true, 'features.tte_conservation': true } },
  { id: 'thr', name: 'Về điều khiển theo ngưỡng (cơ bản)', note: 'Áp đặt theo lưu lượng + PI, ghép bơm theo ngưỡng tần số.', strategy: 'threshold', patch: { 'features.pressure_voting': false, 'features.anomaly_detection': false, 'features.tte_conservation': false } },
  { id: 'cap', name: 'Hạ áp đặt tối đa xuống 3,3 bar (giảm rò rỉ)', note: 'pressure.p_set_max_bar = 3,3 – giảm áp ban đêm và giờ thấp điểm.', patch: { 'pressure.p_set_max_bar': 3.3 } },
  { id: 'mar', name: 'Tăng biên áp khi mất mạng thêm 0,1 bar', note: 'offline.margin_bar = 0,2 – an toàn hơn khi trạm tự vận hành lâu.', patch: { 'offline.margin_bar': 0.2 } },
  { id: 'bad', name: 'Thử giá trị sai (p_set_max = 9 bar) – sẽ bị trạm từ chối', note: 'Kiểm chứng lớp kiểm tra giới hạn của gateway: kịch bản vượt khoảng cho phép bị từ chối, trạm giữ bản cũ.', patch: { 'pressure.p_set_max_bar': 9 } },
];
export class RolloutScreen {
  constructor(fleet) {
    this.f = fleet; this.sel = new Set();
    this.preset = h('select', { 'aria-label': 'Nội dung phát hành', onchange: () => this._desc() }, ...PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    this.desc = h('p', { class: 'note' });
    this.target = h('select', { 'aria-label': 'Phạm vi' }, h('option', { value: 'all' }, 'Tất cả trạm'), h('option', { value: 'sel' }, 'Chỉ các trạm đã tích chọn'), h('option', { value: 'ok' }, 'Chỉ trạm đang bình thường'));
    this.go = h('button', { class: 'btn primary', type: 'button', onclick: () => this._publish() }, 'Phát hành');
    this.chkAll = h('input', { type: 'checkbox', 'aria-label': 'Chọn tất cả', onchange: (e) => { this.sel = e.target.checked ? new Set(this.f.rows.map((r) => r.sid)) : new Set(); this._k = null; this.update(this.f); } });
    this.body = h('tbody'); this.log = h('div', { class: 'log fl-rlog' });
    this.el = h('div', { class: 'fl-roll' },
      h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Phát hành kịch bản từ trung tâm')), h('div', { class: 'fl-rform' }, this.preset, this.target, this.go), this.desc,
        h('p', { class: 'note' }, 'Máy chủ giữ kho kịch bản có phiên bản. Trạm đang online nhận ngay; trạm mất kết nối nhận khi đồng bộ lại (bản tin retained). Gateway kiểm tra giới hạn, áp dụng, giám sát 10 phút và tự quay lui nếu áp lực lệch.')),
      h('div', { class: 'fl-cols' },
        h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Phiên bản kịch bản từng trạm')), h('div', { class: 'fl-tw' }, h('table', { class: 'fl-table' }, h('thead', {}, h('tr', {}, h('th', {}, this.chkAll), h('th', {}, 'Trạm'), h('th', {}, 'Chiến lược'), h('th', { class: 'n' }, 'Mục tiêu'), h('th', { class: 'n' }, 'Đã áp dụng'), h('th', {}, 'Tình trạng'))), this.body))),
        h('section', { class: 'fl-panel' }, h('header', {}, h('h3', {}, 'Nhật ký phát hành')), this.log)));
    this._desc();
  }
  _desc() { this.desc.textContent = PRESETS.find((p) => p.id === this.preset.value).note; }
  _publish() {
    const a = this.f.app, p = PRESETS.find((x) => x.id === this.preset.value), by = 'SYSTEM · Điều độ viên';
    const rows = this.f.rows.filter((r) => this.target.value === 'all' || (this.target.value === 'sel' && this.sel.has(r.sid)) || (this.target.value === 'ok' && r.status === 'ok'));
    if (!rows.length) { a.toast('Chưa có trạm nào trong phạm vi đã chọn'); return; }
    for (const r of rows) a.server.publishScript(r.sid, p.patch, a.net.t, by, p.name, p.strategy ?? null);
    a.toast(`Đã phát hành tới ${rows.length} trạm: ${p.name}`); this._k = null; this.update(this.f);
  }
  update(f) {
    const a = f.app, srv = a.server, rows = f.rows;
    const key = rows.map((r) => { const S0 = srv.stations[r.sid]; return [r.sid, S0.target, S0.reported, S0.online, this.sel.has(r.sid), S0.status_log.length, S0.repo[S0.reported ?? S0.target]?.strategy].join(':'); }).join('|');
    if (key !== this._k) {
      this._k = key;
      this.body.replaceChildren(...rows.map((r) => {
        const S0 = srv.stations[r.sid], tgt = S0.target, rep = S0.reported, last = S0.status_log[S0.status_log.length - 1];
        let st, cls;
        if (rep === tgt) { st = last && last.status === 'rejected' ? 'Trạm từ chối bản mới – giữ v' + rep : last && last.status === 'rollback' ? 'Đã quay lui về v' + rep : 'Đã áp dụng'; cls = last && (last.status === 'rejected' || last.status === 'rollback') ? 'warning' : 'good'; }
        else if (!S0.online) { st = 'Chờ đồng bộ (trạm mất kết nối)'; cls = 'off'; } else { st = 'Đang phát xuống trạm…'; cls = 'info'; }
        const sk = S0.repo[rep ?? tgt]?.strategy;
        return h('tr', {}, h('td', {}, h('input', { type: 'checkbox', checked: this.sel.has(r.sid), 'aria-label': 'Chọn ' + r.sid, onchange: (e) => { if (e.target.checked) this.sel.add(r.sid); else this.sel.delete(r.sid); this.chkAll.checked = this.sel.size === rows.length; } })),
          h('td', {}, stBtn(f, r.sid, `${r.sid} · ${r.site.area}`)), h('td', {}, STRAT_NAME[sk] ?? sk ?? '–'), h('td', { class: 'n mono' }, 'v' + tgt), h('td', { class: 'n mono' }, rep !== undefined ? 'v' + rep : '–'), h('td', {}, h('span', { class: 'chip ' + cls }, st)));
      }));
    }
    const logs = srv.logs.filter((l) => /Phát hành kịch bản|Trạm từ chối|quay lui|chờ đồng bộ/.test(l.text)).slice(-40).reverse();
    const lk = logs.length + ':' + (logs[0]?.t ?? 0) + (logs[0]?.station ?? '');
    if (lk !== this._lk) { this._lk = lk; this.log.replaceChildren(...(logs.length ? logs.map((l) => h('div', { class: l.level }, h('span', { class: 't' }, `${tShort(l.t)} ${l.station}`), viNum(l.text))) : [h('p', { class: 'note' }, 'Chưa có lần phát hành nào trong lần chạy này.')])); }
  }
}
