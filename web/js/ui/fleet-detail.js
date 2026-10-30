// Cột chi tiết của màn "Danh sách trạm": thẻ trạm đang chọn (số đo, đường áp 6 giờ, mở 3D / HMI, giả lập sự cố)
// và danh sách các trạm cần chú ý kèm lý do. Số liệu là bản đo xa MÁY CHỦ nhận được (đứng yên khi trạm mất kết nối).
import { FLEET_STATUS } from '../sim/fleet.js';
import { h, fmt } from './dom.js';
import { MODE_NAME, viNum } from './ops.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'text') el.textContent = v; else el.setAttribute(k, v); }
  for (const c of kids.flat()) if (c) el.append(c);
  return el;
};
export const CHIP = { ok: 'good', sync: 'info', offline: 'off', warn: 'warning', crit: 'critical' };
export const statusChip = (r) => h('span', { class: 'chip ' + CHIP[r.status] }, FLEET_STATUS[r.status].label);
const SEV_RANK = { critical: 0, alarm: 1, serious: 1, warning: 2, info: 3 };

/** Lý do ngắn gọn một trạm cần chú ý (từ báo động trung tâm đã nhận). */
export function reason(app, r) {
  const al = [...app.server.alarms.values()].filter((a) => a.station === r.sid && a.code !== 'STATION_OFFLINE').sort((x, y) => SEV_RANK[x.sev] - SEV_RANK[y.sev] || y.t - x.t);
  if (r.dead) return 'Mini PC ngừng – biến tần giữ áp bằng PID nội';
  if (!r.online) return `Mất kết nối ${Math.max(0, Math.round((app.net.t - (app.server.stations[r.sid].last_seen ?? 0)) / 60))} phút – trạm tự vận hành, dữ liệu được đệm`;
  if (al[0]) return viNum(al[0].msg);
  if (r.status === 'sync') return `Đang đồng bộ ${r.buffer} bản ghi đệm`;
  return 'Đang hoạt động bình thường';
}

/** Đường áp ra gần nhất (6 giờ) của một trạm, rút gọn còn n điểm; trả về các giá trị hợp lệ. */
export function pressureTrail(app, r, n) {
  const hs = app.net.smart[r.i].hist.data, t1 = hs.t.length, t0 = Math.max(0, t1 - 2160), step = Math.max(1, Math.floor((t1 - t0) / n)), out = [];
  for (let i = t0; i < t1; i += step) { const v = hs.p_out[i]; out.push(Number.isFinite(v) ? v : null); }
  return out;
}

export class StationPanel {
  /** pick(sid): gọi khi chọn một trạm trong danh sách cần chú ý (để màn danh sách cuộn tới thẻ trạm đó). */
  constructor(fleet, pick) {
    this.fleet = fleet; this.app = fleet.app; this.pick = pick;
    this.el = h('div', { class: 'fd-side' });
    this.card = h('section', { class: 'fd-card', hidden: true, 'aria-live': 'polite' });
    this.attn = h('section', { class: 'fd-attn' }, h('h3', {}, h('span', { class: 'lbl' }, 'Cần chú ý'), this.attnN = h('span', { class: 'fd-n' })), this.attnList = h('div', { class: 'fd-list' }));
    this.el.append(this.card, this.attn);
  }
  update(f) {
    const rows = f.rows;
    // chỉ liệt kê trạm không bình thường (trạm bình thường đã có thẻ riêng); nặng nhất lên đầu
    const bad = rows.filter((r) => r.status !== 'ok').sort((x, y) => FLEET_STATUS[y.status].rank - FLEET_STATUS[x.status].rank || x.sid.localeCompare(y.sid));
    const key = bad.map((r) => r.sid + r.status + reason(this.app, r)).join('|') + '|' + f.sel + '|' + rows.length;
    if (key !== this._ak) {
      this._ak = key;
      this.attnN.textContent = bad.length ? `${bad.length} cần chú ý · ${rows.length - bad.length} bình thường` : `${rows.length} bình thường`;
      this.attnList.replaceChildren(...(bad.length ? [] : [h('p', { class: 'note ok' }, `Cả ${rows.length} trạm đang hoạt động bình thường – hệ thống tự giám sát, không cần can thiệp.`)]),
        ...bad.map((r) => h('button', { class: 'fd-row' + (f.sel === r.sid ? ' cur' : ''), type: 'button', onclick: () => { f.select(r.sid); this.pick(r.sid); } },
          h('i', { class: 'dot', 'data-st': r.status }), h('span', { class: 'fd-rt' }, h('b', {}, `${r.sid} · ${r.site.area}`), h('small', {}, reason(this.app, r))),
          h('span', { class: 'chip ' + CHIP[r.status] }, FLEET_STATUS[r.status].label))));
    }
    this._updCard(f, f.byId);
  }
  _updCard(f, byId) {
    const r = f.sel ? byId[f.sel] : null, c = this.card;
    c.hidden = !r;
    if (!r) { this._ck = null; return; }
    const s = r.site, a = this.app, S0 = a.server.stations[r.sid];
    if (this._ck !== r.sid) {
      this._ck = r.sid;
      this.cardV = {};
      const V = (k, label, unit = '') => { const b = h('b', {}, '–'); this.cardV[k] = b; return h('div', { class: 'fd-m' }, h('span', {}, label), b, unit ? h('small', {}, unit) : ''); };
      const inj = (label, ev) => h('button', { class: 'btn small', type: 'button', onclick: () => { a.event({ ...ev, station: r.sid }); } }, label);
      const hrs = (x) => a.net.t / 3600 + x;
      this.cardSpark = S('svg', { class: 'fd-spark', viewBox: '0 0 240 44', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, S('line', { x1: 0, x2: 240, class: 'lo' }), S('line', { x1: 0, x2: 240, class: 'hi' }), S('polyline', { class: 'ln' }));
      this.cardHead = h('div', { class: 'fd-ch' }, h('div', {}, h('b', {}, `${r.sid} · ${s.area}`), h('small', {}, `${s.district} · ${s.kind} · ${s.households} hộ · ${s.zone}`)), this.cardChip = h('span', { class: 'chip' }),
        h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Bỏ chọn', onclick: () => f.select(null) }, '×'));
      this.cardWhy = h('p', { class: 'fd-why' });
      c.replaceChildren(this.cardHead, this.cardWhy,
        h('div', { class: 'fd-mg' }, V('p', 'Áp ra', 'bar'), V('pc', 'Áp bất lợi', 'bar'), V('q', 'Lưu lượng', 'm³/h'), V('lv', 'Mức bể', 'm'), V('kw', 'Công suất', 'kW'), V('wq', 'Clo · đục · pH')),
        h('div', { class: 'fd-sp' }, h('small', {}, 'Áp ra 6 giờ gần nhất'), this.cardSpark),
        h('div', { class: 'fd-info' }, this.cardMeta = h('small', {})),
        h('div', { class: 'fd-act' }, h('button', { class: 'btn primary', type: 'button', onclick: () => a.openStation(r.sid, '3d') }, 'Mở 3D'), h('button', { class: 'btn', type: 'button', onclick: () => a.openStation(r.sid, 'hmi') }, 'Mở HMI')),
        h('details', { class: 'fd-try' }, h('summary', {}, 'Giả lập sự cố tại trạm này'), h('div', { class: 'fd-grid2' },
          inj('Ngắt 4G', { type: 'link_down' }), inj('Khôi phục 4G', { type: 'link_up' }), inj('Vỡ ống 10 m³/h', { type: 'burst', q_m3h: 10, until_h: hrs(4) }), inj('Nước nguồn đục', { type: 'inflow_quality', param: 'ntu', value: 12, until_h: hrs(3) }),
          inj('Hỏng bơm P-01', { type: 'pump_fault', pump: 0 }), inj('Sửa bơm P-01', { type: 'pump_repair', pump: 0 }), inj('Mini PC treo', { type: 'gateway_fail' }), inj('Khởi động lại mini PC', { type: 'gateway_restore' }))));
    }
    const V = this.cardV, set = (k, t) => { if (V[k]._t !== t) { V[k]._t = t; V[k].textContent = t; } };
    set('p', fmt(r.p, 2)); set('pc', fmt(Math.max(0, r.p_crit), 2)); set('q', fmt(r.q, 1)); set('lv', fmt(r.level, 2)); set('kw', fmt(r.kw, 2)); set('wq', `${fmt(r.cl, 2)} · ${fmt(r.ntu, 2)} · ${fmt(r.ph, 1)}`);
    this.cardChip.className = 'chip ' + CHIP[r.status]; this.cardChip.textContent = FLEET_STATUS[r.status].label;
    this.cardWhy.textContent = reason(a, r);
    const strat = S0.repo?.[S0.reported ?? S0.target]?.strategy;
    this.cardMeta.textContent = `Chế độ ${MODE_NAME[r.mode]} · kịch bản v${r.version}${strat ? ' (' + (strat === 'predictive' ? 'dự báo' : 'ngưỡng') + ')' : ''} · ${r.online ? 'dữ liệu cách ' + Math.round(r.age ?? 0) + ' s' : 'đang mất kết nối'}`;
    // đường áp 6 giờ gần nhất (đã giản lược) cùng hai vạch ngưỡng 1,4 và 4,0 bar
    const trail = pressureTrail(a, r, 60), vals = trail.filter((v) => v !== null);
    const lo = Math.min(1.5, ...vals), hi = Math.max(4.2, ...vals), y = (v) => (44 - (v - lo) / (hi - lo) * 40 - 2).toFixed(1);
    const pts = []; trail.forEach((v, j) => { if (v !== null) pts.push(`${(j * 240 / 60).toFixed(1)},${y(v)}`); });
    this.cardSpark.querySelector('.ln').setAttribute('points', pts.join(' '));
    const l1 = this.cardSpark.querySelector('.lo'), l2 = this.cardSpark.querySelector('.hi'); l1.setAttribute('y1', y(1.4)); l1.setAttribute('y2', y(1.4)); l2.setAttribute('y1', y(4.0)); l2.setAttribute('y2', y(4.0));
  }
}
