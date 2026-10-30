// Màn hình HMI/SCADA 2D theo kiểu runtime đang dùng ở các nhà máy nước (WinCC, InTouch, iFIX, Ignition):
// thanh tiêu đề, dòng báo động, nhiều màn hình chọn bằng thanh nút phía dưới, bảng điều khiển nổi (faceplate)
// cho bơm, van, thiết bị đo và chế độ trạm. Hai giao diện màu: Tối (SCADA xanh thép) và Sáng (WinCC xám).
// Hai vị trí vận hành (xem ops.js):
//   - Tại trạm (màn cảm ứng HMI-01 trên cửa tủ CP-02): đọc trực tiếp từ gateway, lệnh đi thẳng, không qua mạng.
//   - Trung tâm (SCADA): chỉ thấy dữ liệu MÁY CHỦ đã nhận qua MQTT (chu kỳ 10 s, đứng yên khi mất mạng);
//     lệnh đi qua máy chủ, có thời hạn ngắn, có thể bị từ chối (quyền tại chỗ) hoặc hết hạn (mất mạng).
import { fmtClock, fmtHM } from '../sim/util.js';
import { h, SEV_LABEL, tShort } from './dom.js';
import { ackAlarm, CMD_STATUS, cmdName, commandLog, CTL_NAME, firstBlock, fmtLease, MODE_NAME, modeSev, needsReset, permissives, sendCommand, SEV_ORDER, stationData, STRAT_NAME, viNum, viText } from './ops.js';

const NS = 'http://www.w3.org/2000/svg';
function S(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (v, nd) => { const s = v.toFixed(nd); return (/^-0(\.0+)?$/.test(s) ? s.slice(1) : s).replace('.', ','); }; // không hiện "-0,00"
const viTxt = viText, STRAT = STRAT_NAME;
const NOOP = /không ở trạng thái dừng an toàn|đã ở chế độ tự động/; // lệnh hợp lệ nhưng không làm thay đổi gì
const VB = { y: 14, w: 1280, h: 638 }; // khung nhìn sơ đồ P&ID (cắt bớt lề trên/dưới trống)
// chỉ ghi DOM khi giá trị thay đổi (update() chạy mỗi 250 ms)
const setT = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const setC = (el, c) => { if (el._c !== c) { el._c = c; el.setAttribute('class', c); } };
const setA = (el, k, v) => { const m = el._a || (el._a = {}); if (m[k] !== v) { m[k] = v; el.setAttribute(k, v); } };
const setD = (el, on) => { if (el.disabled !== on) el.disabled = on; };
const setH = (el, on) => { if (el.hidden !== on) el.hidden = on; };
const icon = (d, cls = 'h-ico') => S('svg', { viewBox: '0 0 20 20', class: cls, 'aria-hidden': 'true' }, S('path', { d }));
const ICON = {
  ov: 'M2 3h6v5H2zM12 12h6v5h-6zM5 8v6.5h7M8 5.5h7v6.5', pump: 'M10 3a7 7 0 1 0 .01 0zM7.5 6.5l6.5 3.5-6.5 3.5z',
  qual: 'M10 2.5c3 4 5.5 6.6 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2.9 2.5-5.5 5.5-9.5zM7.5 12.3l2 2 3.5-4', trend: 'M2 17h16M2 3v14M4 13l4-5 3 3 4-6 3 3',
  alarm: 'M10 2.8a5 5 0 0 1 5 5v4l1.6 2.6H3.4L5 11.8v-4a5 5 0 0 1 5-5zM8 16.6a2 2 0 0 0 4 0', log: 'M7 5h10M7 10h10M7 15h10M3 5h1.5M3 10h1.5M3 15h1.5',
  par: 'M4 3v14M10 3v14M16 3v14M2 7h4M8 12.5h4M14 6h4', user: 'M10 10a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM3 18c.6-3.8 3.4-6 7-6s6.4 2.2 7 6',
  bell: 'M10 2.8a5 5 0 0 1 5 5v4l1.6 2.6H3.4L5 11.8v-4a5 5 0 0 1 5-5zM8 16.6a2 2 0 0 0 4 0',
};
const SCREENS = [
  ['ov', 'TỔNG QUAN', 'TỔNG QUAN TRẠM BƠM'], ['pump', 'BƠM – BIẾN TẦN', 'BƠM TĂNG ÁP VÀ BIẾN TẦN'], ['qual', 'CHẤT LƯỢNG NƯỚC', 'CHẤT LƯỢNG NƯỚC SAU BỂ CHỨA'],
  ['trend', 'XU HƯỚNG', 'XU HƯỚNG VẬN HÀNH'], ['alarm', 'BÁO ĐỘNG', 'DANH SÁCH BÁO ĐỘNG'], ['log', 'NHẬT KÝ', 'NHẬT KÝ LỆNH VÀ SỰ KIỆN'], ['par', 'THÔNG SỐ', 'THÔNG SỐ CÀI ĐẶT VÀ GIỚI HẠN'],
];
const POS = {
  local: { name: 'TẠI TRẠM · HMI-01', role: 'Kỹ thuật viên vận hành', desc: 'Màn cảm ứng trên tủ CP-02 – đọc trực tiếp gateway, lệnh không qua mạng' },
  remote: { name: 'TRUNG TÂM · SCADA', role: 'Điều độ viên trung tâm', desc: 'Máy chủ điều hành – dữ liệu qua MQTT 10 s, lệnh có hạn 60 s' },
};
// thiết bị đo: trường trong stationData, đơn vị, số lẻ, cột lịch sử tại trạm, cột chuỗi phút ở máy chủ.
// PT-101/PT-102 (áp ống góp, trước MV-02) lấy từ app.uiHist; hist.p_out của lõi là áp ra mạng SAU MV-02.
const UI_HIST = new Set(['p1', 'p2']);
const INST = {
  'PT-101': { k: 'p1', u: 'bar', nd: 2, hk: 'p1', sk: 'p', lbl: 'Áp lực đầu ra (điều khiển)' }, 'PT-102': { k: 'p2', u: 'bar', nd: 2, hk: 'p2', lbl: 'Áp lực đầu ra (bảo vệ)' },
  'FT-100': { k: 'q_in', u: 'm³/h', nd: 1, hk: 'q_in', lbl: 'Lưu lượng nước vào bể' }, 'FT-101': { k: 'q', u: 'm³/h', nd: 1, hk: 'q_out', sk: 'q', lbl: 'Lưu lượng ra mạng lưới' },
  'LT-101': { k: 'level', u: 'm', nd: 2, hk: 'level', sk: 'level', lbl: 'Mức nước bể T-01' }, 'AIT-201': { k: 'cl', u: 'mg/L', nd: 2, hk: 'cl', lbl: 'Clo dư tự do' },
  'AIT-202': { k: 'ntu', u: 'NTU', nd: 2, hk: 'ntu', lbl: 'Độ đục' }, 'AIT-203': { k: 'ph', u: '', nd: 2, hk: 'ph', lbl: 'pH' },
  'PL-301': { k: 'p_crit', u: 'bar', nd: 2, hk: 'p_crit', lbl: 'Áp lực điểm bất lợi DMA-A' },
};
const PUMP_TAG = ['P-01', 'P-02'];
const PEN_COL = {
  dark: ['#3987e5', '#9cc8ff', '#e2e8ee', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
  light: ['#2a78d6', '#6f9fe0', '#3a4652', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'],
};
// ui: cột lấy từ app.uiHist (cùng chỉ số với hist.data.t); sk: cột chuỗi phút ở máy chủ (trung tâm)
const PENS = [
  { k: 'p1', ui: true, sk: 'p', name: 'Áp đầu ra PT-101', u: 'bar', lo: 0, hi: 6, nd: 2 }, { k: 'p2', ui: true, name: 'Áp đầu ra PT-102', u: 'bar', lo: 0, hi: 6, nd: 2, dash: [4, 3] },
  { k: 'p_out', name: 'Áp ra mạng (sau MV-02)', u: 'bar', lo: 0, hi: 6, nd: 2 }, { k: 'p_set', name: 'Áp đặt P_set', u: 'bar', lo: 0, hi: 6, nd: 2, dash: [7, 5] },
  { k: 'p_crit', name: 'Áp điểm bất lợi PL-301', u: 'bar', lo: 0, hi: 6, nd: 2, dash: [2, 4] }, { k: 'q_out', sk: 'q', name: 'Lưu lượng ra FT-101', u: 'm³/h', lo: 0, hi: 40, nd: 1 },
  { k: 'level', sk: 'level', name: 'Mức bể LT-101', u: 'm', lo: 0, hi: 5, nd: 2 }, { k: 'kw', sk: 'kw', name: 'Công suất điện', u: 'kW', lo: 0, hi: 15, nd: 2 },
];
const SEV_TXT = { critical: 'KHẨN', alarm: 'BÁO ĐỘNG', warning: 'CẢNH BÁO', info: 'THÔNG TIN' };
const TK = { x: 210, y0: 150, y1: 530, w: 180, hMax: 4.2 };
const lvY = (L) => TK.y1 - (clamp(L, 0, TK.hMax) / TK.hMax) * (TK.y1 - TK.y0);

export class HmiView {
  constructor(host, app) {
    this.app = app;
    this.where = 'local';
    this.visible = false;
    this.scr = 'ov';
    this.D = {}; this.PF = {}; this.O = {}; this.fps = []; this._keys = {}; this._z = 20;
    this.TR = { range: 3600, sel: 0, hide: new Set([1]), hx: null, last: 0 }; // PT-102 thường trùng PT-101 – ẩn nét, vẫn hiện giá trị
    this.skin = 'dark';
    try { if (localStorage.getItem('trambom-hmi-skin') === 'light') this.skin = 'light'; } catch (e) { /* bỏ qua */ }
    this.root = h('div', { class: 'hmi', hidden: true, 'aria-label': 'Màn hình HMI/SCADA trạm bơm' });
    host.append(this.root);
    this._build();
    new ResizeObserver(() => this._resize()).observe(this.root);
    // dải trạng thái hiện/ẩn làm vùng màn hình co giãn – giữ faceplate dưới các dải, tính lại cỡ chữ sơ đồ
    new ResizeObserver(() => { for (const fp of this.fps) this._fpClamp(fp); this._pidScale(); }).observe(this.area);
  }
  show(on) { this.visible = on; this.root.hidden = !on; if (on) { this._resize(); this.update(true); } }
  setWhere(w) {
    this.where = w === 'remote' ? 'remote' : 'local';
    for (const fp of this.fps) this._cancel(fp);
    this._cancel(this.QS); this._pend = null;
    this._keys = {}; this.TR.last = 0;
    this.update(true);
  }
  /** Bắt đầu kịch bản mới: đóng mọi faceplate, hủy xác nhận đang chờ, xóa trạng thái tạm của lần chạy trước. */
  reset() {
    this._d = null;
    while (this.fps.length) this._fpClose(this.fps[0]);
    this._cancel(this.QS); this.QS.last = null;
    this.H.menu.hidden = true;
    this._deadHide = null; this._pend = null; this._wait = null; this._top = null; this._qT = 0; this._keys = {};
    this.TR.last = 0; this.TR.hx = null;
    this.deadMsg._k = null; this.stateBar._k = null;
    if (this.visible) this.update(true);
  }
  go(k) {
    this.scr = k;
    for (const [n, el] of Object.entries(this.screens)) el.hidden = n !== k;
    for (const [n, b] of Object.entries(this.navBtns)) { b.classList.toggle('on', n === k); b.setAttribute('aria-pressed', n === k); }
    const i = SCREENS.findIndex((s) => s[0] === k);
    this.H.title.replaceChildren(h('small', {}, String(i + 1).padStart(2, '0')), SCREENS[i][2]);
    this._keys = {}; this.TR.last = 0;
    if (k === 'ov') this._pidScale();
    this.update(true);
  }
  toggleSkin() {
    this.skin = this.skin === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('trambom-hmi-skin', this.skin); } catch (e) { /* bỏ qua */ }
    this._applySkin(); this.TR.last = 0; this.update(true);
  }
  _applySkin() { this.root.classList.toggle('h-light', this.skin === 'light'); setT(this.H.skinTxt, this.skin === 'light' ? 'SÁNG' : 'TỐI'); }
  _resize() {
    const w = this.root.clientWidth;
    if (!w) return;
    const narrow = w < 700;
    if (narrow !== this.narrow) { this.narrow = narrow; this.root.classList.toggle('h-narrow', narrow); while (narrow && this.fps.length > 1) this._fpClose(this.fps[0]); }
    for (const fp of this.fps) this._fpClamp(fp);
    this.TR.last = 0;
    this._pidScale();
    if (this.visible && this.ctx && this._d && this.scr === 'trend') this._updTrend(this._d, true);
    if (this.visible && this.ctx && this._d && this.scr === 'qual') this._updQuality(this._d, true);
  }
  /**
   * Bù cỡ chữ nhỏ của sơ đồ: khi sơ đồ bị thu nhỏ (màn 1366×768, 1280×720) chữ chú thích vẫn ≥ ~11 px trên màn hình.
   * --pz: chữ nhỏ, --pm: nhãn thiết bị/tiêu đề khối, --pv: ô số.
   */
  _pidScale() {
    const svg = this.pid, w = svg?.clientWidth, hh = svg?.clientHeight;
    if (!w || !hh) return;
    const s = Math.min(w / VB.w, hh / VB.h), r2 = (x) => Math.round(x * 100) / 100;
    const k = [clamp(1 / s, 1, 1.3), clamp(1 / s, 1, 1.22), clamp(0.88 / s, 1, 1.12)].map(r2);
    if (this._pz === k.join()) return;
    this._pz = k.join();
    ['--pz', '--pm', '--pv'].forEach((n, i) => svg.style.setProperty(n, k[i]));
    for (const [el, max] of this._fits || []) this._fit(el, max, true);
  }
  /** Nén chữ SVG cho vừa bề rộng (chỉ khi dài hơn chỗ trống). */
  _fit(el, max, force = false) {
    if (!force && el._ft === el.textContent) return;
    el._ft = el.textContent;
    el.removeAttribute('textLength'); el.removeAttribute('lengthAdjust');
    const w = el.getComputedTextLength ? el.getComputedTextLength() : 0;
    if (w > max) { el.setAttribute('textLength', max); el.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
  }

  // ================= khung runtime =================
  _build() {
    this.root.append(this._header(), this._alarmBar());
    this.stateBar = h('div', { class: 'h-statebar', hidden: true, role: 'status' });
    this.area = h('div', { class: 'h-area' });
    this.screens = {};
    for (const [k] of SCREENS) { this.screens[k] = h('div', { class: 'h-scr h-scr-' + k, hidden: k !== this.scr }); this.area.append(this.screens[k]); }
    this._buildOverview(this.screens.ov); this._buildPumps(this.screens.pump); this._buildQuality(this.screens.qual); this._buildTrend(this.screens.trend);
    this._buildAlarms(this.screens.alarm); this._buildLog(this.screens.log); this._buildParams(this.screens.par);
    this.deadMsg = h('div', { class: 'h-dead-m' });
    this.deadBox = h('div', { class: 'h-dead', hidden: true },
      h('div', { class: 'h-dead-box', role: 'alertdialog', 'aria-label': 'Mất kết nối với bộ điều khiển' },
        h('div', { class: 'h-dead-t' }, h('span', { class: 'h-dead-ic' }, '!'), 'MẤT KẾT NỐI VỚI BỘ ĐIỀU KHIỂN MPC-01'), this.deadMsg,
        h('div', { class: 'h-brow' }, h('button', { class: 'h-btn', onclick: () => { this._deadHide = this.app.st.gw_dead; this.update(true); } }, 'ẨN THÔNG BÁO'))));
    this.area.append(this.deadBox);
    this.root.append(this.stateBar, this.area, this._nav(), this._status());
    this.root.addEventListener('pointerdown', (e) => {
      this._ax = e.clientX; // vị trí nhấp – để đặt faceplate không che thiết bị
      if (!this.H.menu.hidden && !this.H.menu.contains(e.target) && !this.H.user.contains(e.target)) this.H.menu.hidden = true;
    });
    // Esc: đóng menu, hoặc hủy xác nhận đang chờ, hoặc đóng faceplate trên cùng – chỉ một việc mỗi lần bấm, không để lớp ngoài (shell) xử lý tiếp
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const fp = this.fps.find((f) => f.el.contains(e.target)) || [...this.fps].sort((x, y) => (+y.el.style.zIndex) - (+x.el.style.zIndex))[0];
      if (!this.H.menu.hidden) this.H.menu.hidden = true;
      else if (fp && !fp.cf.hidden) { this._cancel(fp); fp.el.focus({ preventScroll: true }); }
      else if (fp) this._fpClose(fp);
      else if (!this.QS.cf.hidden) this._cancel(this.QS);
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    this._applySkin();
    this.go(this.scr);
  }

  _header() {
    const H = this.H = {};
    const logo = h('img', { class: 'h-logo', src: 'assets/system-logo.png', alt: 'SYSTEM', width: 30, height: 30 });
    H.title = h('div', { class: 'h-ttl', 'aria-live': 'polite' });
    H.man = h('span', { class: 'h-manbadge', hidden: true, title: 'Trạm đang ở chế độ điều khiển TAY – kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động' }, 'TAY');
    H.intlk = h('button', { class: 'h-intlk', hidden: true, onclick: () => this._fpOpen('station', 'ST') }, '');
    H.leds = {};
    const led = (k, label) => { const i = h('i'); const s = h('span', { class: 'h-led' }, i, h('span', {}, label)); H.leds[k] = { i, s }; return s; };
    H.almN = h('b', {}, '0');
    H.alm = h('button', { class: 'h-almcnt', onclick: () => this.go('alarm'), title: 'Báo động đang hoạt động – mở danh sách báo động' }, icon(ICON.bell), H.almN);
    H.date = h('small', {}); H.time = h('b', {});
    H.uPos = h('b'); H.uRole = h('small');
    H.user = h('button', { class: 'h-user', 'aria-haspopup': 'menu', title: 'Đổi vị trí vận hành', onclick: () => { H.menu.hidden = !H.menu.hidden; this._syncMenu(); } }, icon(ICON.user), h('span', {}, H.uPos, H.uRole));
    H.skinTxt = h('span');
    // biểu tượng giao diện: vòng tròn nửa tô đặc (không nhầm với nút nguồn)
    const skinIco = S('svg', { viewBox: '0 0 20 20', class: 'h-ico', 'aria-hidden': 'true' }, S('circle', { cx: 10, cy: 10, r: 7.2 }), S('path', { d: 'M10 2.8a7.2 7.2 0 0 0 0 14.4z', class: 'h-ico-f' }));
    H.skin = h('button', { class: 'h-skinbtn', onclick: () => this.toggleSkin(), title: 'Đổi giao diện màn hình HMI: Tối / Sáng' }, skinIco, H.skinTxt);
    H.menu = h('div', { class: 'h-menu', hidden: true, role: 'menu', 'aria-label': 'Vị trí vận hành' }, h('div', { class: 'h-menu-t' }, 'ĐĂNG NHẬP VỊ TRÍ VẬN HÀNH'),
      ...['local', 'remote'].map((w) => h('button', { role: 'menuitemradio', 'data-w': w, onclick: () => { H.menu.hidden = true; this.setWhere(w); } },
        icon(ICON.user), h('span', {}, h('b', {}, POS[w].name), h('small', {}, POS[w].role + ' – ' + POS[w].desc)))));
    return h('header', { class: 'h-hdr' },
      h('div', { class: 'h-brand' }, logo, h('div', { class: 'h-bfull' }, h('small', {}, 'SYSTEM · HỆ THỐNG SCADA CẤP NƯỚC'), H.bname = h('b', {}, 'TRẠM BƠM TĂNG ÁP ST-01 · DMA-A')), H.bshort = h('b', { class: 'h-bshort' }, 'ST-01')),
      H.title,
      h('div', { class: 'h-hright' }, H.intlk, H.man, h('div', { class: 'h-leds', role: 'group', 'aria-label': 'Trạng thái truyền thông' }, led('gw', 'GW'), led('lte', '4G'), led('srv', 'MÁY CHỦ')),
        H.alm, h('div', { class: 'h-clock' }, H.date, H.time), H.user, H.skin),
      H.menu);
  }
  _syncMenu() { this.H.menu.querySelectorAll('button[data-w]').forEach((b) => { b.classList.toggle('on', b.dataset.w === this.where); b.setAttribute('aria-checked', b.dataset.w === this.where); }); }

  _alarmBar() {
    const A = this.AB = {};
    A.sev = h('span', { class: 'h-ab-sev' }); A.time = h('span', { class: 'h-ab-t' }); A.code = h('b', { class: 'h-ab-c' }); A.msg = h('span', { class: 'h-ab-m' }); A.more = h('span', { class: 'h-ab-more' });
    A.ack = h('button', { class: 'h-btn sm', onclick: () => { if (this._top) this._ack(this._top.code); } }, 'XÁC NHẬN');
    A.list = h('button', { class: 'h-btn sm ghost', onclick: () => this.go('alarm') }, 'DANH SÁCH');
    A.el = h('div', { class: 'h-ab', 'aria-live': 'polite' }, A.sev, A.time, A.code, A.msg, A.more, A.ack, A.list);
    return A.el;
  }
  _nav() {
    this.navBtns = {};
    this.navBadge = h('em', { hidden: true });
    return h('nav', { class: 'h-nav', 'aria-label': 'Chọn màn hình' }, ...SCREENS.map(([k, label], i) => {
      const b = h('button', { class: 'h-nb', onclick: () => this.go(k) }, h('small', {}, String(i + 1).padStart(2, '0')), icon(ICON[k]), h('span', {}, label), k === 'alarm' ? this.navBadge : null);
      this.navBtns[k] = b;
      return b;
    }));
  }
  _status() {
    const B = this.SB = {};
    const item = (k, label) => h('span', { class: 'h-sbi' }, h('small', {}, label), (B[k] = h('b')));
    B.src = h('span', { class: 'h-sbsrc' });
    return h('footer', { class: 'h-sb' }, item('ctl', 'ĐIỀU KHIỂN'), item('mode', 'GATEWAY'), item('scr', 'KỊCH BẢN'), item('pset', 'P ĐẶT'), item('kwh', 'ĐIỆN NĂNG'), h('span', { class: 'h-sbsp' }), B.src);
  }

  // ================= hiển thị số =================
  /** [chữ, trạng thái] cho một giá trị: '####' = không hợp lệ/không biết, 'N/A' = không lắp hoặc vị trí này không nhận. */
  _fv(v, nd, o = {}) {
    const c = this.ctx;
    if (c.dead && !o.live) return ['####', 'bad'];
    if (o.absent) return ['N/A', 'na'];
    if (v === undefined && c.remote) return ['N/A', 'na'];
    if (typeof v === 'string') return [v, o.st || 'ok'];
    if (!isNum(v)) return ['####', 'bad'];
    return [num(v, nd), o.lim ? o.lim(v) : 'ok'];
  }
  _disp(key, x, y, w, unit = '') {
    const t = S('text', { x: x + w - 5, y: y + 16.5, class: 'h-dv', 'text-anchor': 'end' });
    const g = S('g', { class: 'h-d ok' }, S('rect', { x, y, width: w, height: 23, rx: 2, class: 'h-db' }), S('rect', { x: x + 1, y: y + 1, width: w - 2, height: 2, class: 'h-dbs' }), t,
      S('text', { x: x + 4, y: y + 16, class: 'h-dq', text: '?' }), unit ? S('text', { x: x + w + 4, y: y + 16.5, class: 'h-du', text: unit }) : null);
    this.D[key] = { g, t };
    return g;
  }
  _sv(key, v, nd, o) {
    const D = this.D[key];
    const [txt, st] = this._fv(v, nd, o);
    setT(D.t, txt); setC(D.g, 'h-d ' + st + (this.ctx.stale && !o?.live ? ' stale' : ''));
    return st;
  }
  /** Ô số HTML (faceplate, bảng). */
  _hd(unit = '', big = false, txt = false) {
    const b = h('b'), el = h('span', { class: 'h-hdw' + (big ? ' big' : '') + (txt ? ' t' : '') }, h('span', { class: 'h-hd ok' }, h('i', {}, '?'), b), unit ? h('small', { class: 'h-hu' }, unit) : null);
    return { el, box: el.firstChild, b };
  }
  _hv(D, v, nd, o) {
    const [txt, st] = this._fv(v, nd, o);
    setT(D.b, txt); setC(D.box, 'h-hd ' + st + (this.ctx.stale && !o?.live ? ' stale' : ''));
    return st;
  }
  _lamp(txt) { const t = h('span', {}, txt); const el = h('span', { class: 'h-lamp' }, h('i'), t); return { el, t }; }
  /** Đèn trạng thái; dữ liệu cũ (trung tâm mất kết nối) → chất lượng không chắc chắn 'q' (mờ, dấu ?), trừ đèn live. */
  _setLamp(L, cls, txt, live = false) {
    setC(L.el, 'h-lamp' + (cls ? ' ' + cls : '') + (this.ctx.stale && !live ? ' q' : ''));
    if (txt !== undefined) setT(L.t, txt);
  }
  _changed(k, key, force) { if (!force && this._keys[k] === key) return false; this._keys[k] = key; return true; }
  _hit(g, fn, label) {
    g.setAttribute('class', (g.getAttribute('class') || '') + ' h-hit');
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', label);
    g.addEventListener('click', (e) => { this._ax = e.clientX; fn(); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._ax = g.getBoundingClientRect().left; fn(); } });
    g.append(S('title', { text: label }));
    return g;
  }

  // ================= giới hạn / trạng thái =================
  _lv() { return (this.app.st?.gw?.script?.params ?? this.app.cfg.script.params).level; }
  _lim(tag) {
    const c = this.app.cfg, s = c.safety, q = c.quality_limits, sv = c.service, lv = this._lv(), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);
    // st: trạng thái màu của giá trị; txt: mô tả ngưỡng; qc/wt: giới hạn QCVN / cảnh báo; lines: vạch trên xu hướng; scale: thang thanh chỉ thị
    switch (tag) {
      case 'PT-101': case 'PT-102': return {
        st: (v) => (v > sv.p_out_max_bar ? 'alarm' : v < s.p_low_bar ? 'warn' : 'ok'),
        txt: `Cao ${f1(sv.p_out_max_bar)} · rất cao ${f1(s.p_highhigh_bar)} (cắt) · thấp ${f1(s.p_low_bar)} bar`, lines: [[sv.p_out_max_bar, 'alarm'], [s.p_highhigh_bar, 'alarm'], [s.p_low_bar, 'warn']] };
      case 'PL-301': return { st: (v) => (v < sv.p_crit_min_bar ? 'alarm' : 'ok'), txt: `Tối thiểu ${f1(sv.p_crit_min_bar)} bar tại điểm bất lợi`, lines: [[sv.p_crit_min_bar, 'alarm']] };
      case 'LT-101': return {
        st: (v) => (v < lv.stop_m ? 'alarm' : v < lv.conserve_m || v > s.level_high_m ? 'warn' : 'ok'),
        txt: `Cao ${f1(s.level_high_m)} · tiết kiệm ${f1(lv.conserve_m)} · dừng bơm ${f1(lv.stop_m)} · LSLL ${f2(s.float_lsll_m)} m`, lines: [[s.level_high_m, 'warn'], [lv.conserve_m, 'warn'], [lv.stop_m, 'alarm']] };
      case 'AIT-201': return {
        st: (v) => (v < q.cl_min || v > q.cl_max ? 'alarm' : v < s.cl_warn_low || v > s.cl_warn_high ? 'warn' : 'ok'),
        txt: `QCVN ${f1(q.cl_min)}–${f1(q.cl_max)} mg/L · cảnh báo ngoài ${f1(s.cl_warn_low)}–${f1(s.cl_warn_high)}`, qc: `${f1(q.cl_min)} – ${f1(q.cl_max)} mg/L`,
        wt: `Ngưỡng cảnh báo: ${f1(s.cl_warn_low)} – ${f1(s.cl_warn_high)} mg/L`, lines: [[q.cl_min, 'alarm'], [q.cl_max, 'alarm']], scale: [0, 1.5] };
      case 'AIT-202': return {
        st: (v) => (v > q.ntu_max ? 'alarm' : v > s.ntu_warn ? 'warn' : 'ok'), txt: `QCVN ≤ ${f1(q.ntu_max)} NTU · cảnh báo > ${f1(s.ntu_warn)}`, qc: `≤ ${f1(q.ntu_max)} NTU`,
        wt: `Ngưỡng cảnh báo: > ${f1(s.ntu_warn)} NTU`, lines: [[q.ntu_max, 'alarm'], [s.ntu_warn, 'warn']], scale: [0, 5] };
      case 'AIT-203': return {
        st: (v) => (v < q.ph_min || v > q.ph_max ? 'alarm' : v < s.ph_warn_low || v > s.ph_warn_high ? 'warn' : 'ok'),
        txt: `QCVN ${f1(q.ph_min)}–${f1(q.ph_max)} · cảnh báo ngoài ${f1(s.ph_warn_low)}–${f1(s.ph_warn_high)}`, qc: `${f1(q.ph_min)} – ${f1(q.ph_max)}`,
        wt: `Ngưỡng cảnh báo: ngoài ${f1(s.ph_warn_low)} – ${f1(s.ph_warn_high)}`, lines: [[q.ph_min, 'alarm'], [q.ph_max, 'alarm']], scale: [5, 10] };
      case 'FT-101': return { st: (v) => (v > s.burst_q_m3h ? 'warn' : 'ok'), txt: `Nghi vỡ ống khi > ${num(s.burst_q_m3h, 0)} m³/h kéo dài`, lines: [[s.burst_q_m3h, 'warn']] };
      default: return { st: () => 'ok', txt: '–', lines: [] };
    }
  }
  _absent(tag) { const d = this._d; return Boolean(d && d.installed && INST[tag] && tag !== 'PL-301' && !d.installed.has(tag)); }
  _ival(tag) { const d = this._d; return d[INST[tag].k]; }
  /**
   * Liên động/cắt đang chặn bơm: { k, sev, short, badge, text, reset } hoặc null.
   * Tại trạm đọc lớp an toàn của gateway; trung tâm suy ra từ báo động máy chủ đã nhận.
   */
  _intlk(d) {
    if (this._ilk && this._ilk[0] === d) return this._ilk[1]; // tính một lần cho mỗi ảnh chụp dữ liệu
    const r = this._intlk0(d);
    this._ilk = [d, r];
    return r;
  }
  _intlk0(d) {
    if (d.dead) return null;
    const a = this.app, s = a.cfg.safety, lv = this._lv(), f1 = (v) => num(v, 1);
    let k = null, why = '', left = null;
    if (!this.ctx.remote) {
      const g = a.st.gw, sf = g.safety;
      if (sf.lockout) k = 'lockout';
      else if (sf.trip_active) { k = 'trip'; left = Math.max(0, s.p_trip_restart_s - (d.t - sf.trip_t)); }
      else if (sf.safe_stop) { k = 'safe'; why = sf.safe_reason; }
      else if (sf.level_trip || a.st.sensors.lsll) k = 'level';
      else if (g.ctrl.level_stop && d.ctl === 'auto') k = 'lstop';
    } else {
      const has = (c) => d.alarms.find((x) => x.code === c), ss = has('SAFE_STOP');
      if (has('LOCKOUT')) k = 'lockout';
      else if (has('P_HH_TRIP')) k = 'trip';
      else if (ss) { k = 'safe'; why = ss.msg?.match(/:\s*(.+?) không đạt/)?.[1] ?? ''; }
      else if (has('LEVEL_LL') || has('DRY_RUN_FLOAT')) k = 'level';
      else if (has('LEVEL_STOP') && d.ctl === 'auto') k = 'lstop';
    }
    if (!k) return null;
    const W = why ? why.toUpperCase() : 'CHẤT LƯỢNG NƯỚC';
    const T = {
      lockout: { sev: 'bad', short: 'KHÓA ÁP CAO', badge: 'KHÓA ÁP CAO', reset: true, text: 'TRẠM KHÓA SAU NHIỀU LẦN CẮT ÁP CAO – bơm bị cấm chạy · cần lệnh ĐẶT LẠI' },
      trip: { sev: 'bad', short: 'CẮT ÁP CAO', badge: 'CẮT ÁP CAO', reset: false,
        text: `CẮT BƠM DO ÁP LỰC RẤT CAO (> ${f1(s.p_highhigh_bar)} bar) – ` + (left !== null ? `tự chạy lại sau ${num(left, 0)} s nếu áp đã giảm` : 'tự chạy lại khi áp giảm') },
      safe: { sev: 'bad', short: 'DỪNG AN TOÀN', badge: 'DỪNG AN TOÀN', reset: true, text: `TRẠM DỪNG AN TOÀN – ${W} KHÔNG ĐẠT QCVN · bơm dừng, van MV-02 đóng · chờ lệnh ĐẶT LẠI` },
      level: { sev: 'bad', short: 'KHÓA CẠN', badge: 'KHÓA CHẠY KHÔ', reset: false,
        text: `KHÓA CHỐNG CHẠY KHÔ – mức bể rất thấp (< ${f1(s.level_ll_m)} m hoặc phao LSLL-101 báo cạn) · tự mở khóa khi mức > ${f1(s.level_ll_restart_m)} m` },
      lstop: { sev: 'warn', short: 'CHỐNG CẠN', badge: 'DỪNG CHỐNG CẠN', reset: false,
        text: `KỊCH BẢN DỪNG BƠM CHỐNG CHẠY KHÔ – mức bể < ${f1(lv.stop_m)} m · tự chạy lại khi mức > ${f1(lv.restart_m)} m` },
    };
    return { k, ...T[k] };
  }
  /** Giờ của bản tin cuối trung tâm nhận được (hh:mm) hoặc '–'. */
  _lastHM(d) { return isNum(d.age) ? fmtHM(d.t - d.age) : '–'; }
  /** Chế độ điều khiển cho các ô chữ: { t, cls }; gộp liên động đang chặn, đánh dấu '?' khi dữ liệu cũ. */
  _ctlState(d) {
    if (d.dead) { const fb = this.app.st.gw_dead; return { t: fb.enabled && !fb.inhibit ? 'PID BIẾN TẦN' : 'KHÔNG ĐIỀU KHIỂN', cls: 'alarm', q: false }; }
    const I = this._intlk(d), base = CTL_NAME[d.ctl] || d.ctl;
    return { t: I ? `${base} · ${I.short}` : base, cls: I ? (I.sev === 'bad' ? 'alarm' : 'warn') : d.ctl === 'auto' ? 'ok' : 'warn', q: this.ctx.stale };
  }
  /** Lớp màu của chế độ gateway; (d) theo mức nghiêm trọng cao nhất đang có: chỉ cảnh báo → vàng, báo động/khẩn/dừng an toàn → đỏ. */
  _modeCls(d) {
    if (d.mode !== 'd') return { a: 'ok', b: 'warn', c: 'info', x: 'alarm' }[d.mode] || '';
    return modeSev(this.app, d) === 'crit' ? 'alarm' : 'warn';
  }
  /** Tên chế độ gateway; trung tâm mất bản tin thì (b) chỉ là suy luận. */
  _modeText(d) { return this.ctx.remote && this.ctx.stale ? '(b)? Tự vận hành – suy luận' : MODE_NAME[d.mode] || d.mode; }
  _script() {
    const a = this.app;
    if (this.where === 'local') { const g = a.st.gw, k = g.ctrl.strategy_used === 'custom' ? 'custom' : g.script.strategy; return { v: g.script.version, s: STRAT[k] || k }; }
    const S0 = a.server.stations[a.st.sid], v = S0.reported ?? S0.target, k = S0.repo?.[v]?.strategy ?? '';
    return { v, s: STRAT[k] || k };
  }
  _fset(d, i) {
    const p = d.pumps[i];
    if (isNum(p.f_set)) return p.f_set;
    if (this.where === 'local' && !d.dead) { const o = this.app.st.gw.out; return o ? o.f_ref[i] : null; }
    return undefined;
  }

  // ================= màn 01: tổng quan P&ID =================
  _defs() {
    const lg = (id, x2, y2, stops) => S('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, ...stops.map(([o, cls, op]) => S('stop', { offset: o, class: cls, 'stop-opacity': op ?? 1 })));
    return S('defs', {},
      lg('hmiG-steel', 1, 0, [[0, 'h-s1'], [0.3, 'h-s2'], [0.62, 'h-s3'], [1, 'h-s1']]), lg('hmiG-water', 0, 1, [[0, 'h-w1'], [1, 'h-w2']]),
      lg('hmiG-glass', 1, 0, [[0, 'h-gl', 0], [0.2, 'h-gl', 0.22], [0.42, 'h-gl', 0.05], [1, 'h-gl', 0]]), lg('hmiG-motor', 0, 1, [[0, 'h-m1'], [0.45, 'h-m2'], [1, 'h-m1']]),
      lg('hmiG-blk', 0, 1, [[0, 'h-k1'], [1, 'h-k2']]), lg('hmiG-btn', 0, 1, [[0, 'h-b1'], [1, 'h-b2']]),
      S('radialGradient', { id: 'hmiG-shine', cx: 0.36, cy: 0.3, r: 0.75 }, S('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.6 }), S('stop', { offset: 0.65, 'stop-color': '#fff', 'stop-opacity': 0 })),
      S('radialGradient', { id: 'hmiG-vign', cx: 0.5, cy: 0.42, r: 0.75 }, S('stop', { offset: 0, class: 'h-vg', 'stop-opacity': 0.07 }), S('stop', { offset: 1, class: 'h-vg', 'stop-opacity': 0 })),
      S('pattern', { id: 'hmiG-hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, S('rect', { width: 10, height: 10, class: 'h-hatchbg' }), S('rect', { width: 3, height: 10, class: 'h-hatch' })));
  }
  _buildOverview(host) {
    const svg = S('svg', { viewBox: `0 ${VB.y} ${VB.w} ${VB.h}`, class: 'h-pid', preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': 'Sơ đồ công nghệ trạm bơm tăng áp' });
    const O = this.O, cfg = this.app.cfg, add = (...els) => svg.append(...els);
    const txt = (x, y, s, cls = 'h-tag', anchor = null) => S('text', { x, y, class: cls, 'text-anchor': anchor, text: s });
    // chữ trạng thái có tiền tố '?' (chất lượng không chắc chắn khi dữ liệu cũ)
    const qtxt = (x, y, cls, max) => { const q = S('tspan', { class: 'h-qm' }), t = S('tspan'), el = S('text', { x, y, class: cls, 'text-anchor': 'end' }, q, t); (this._fits ||= []).push([el, max]); return { el, q, t, max }; };
    const pipe = (d, id = null) => {
      const g = S('g', { class: 'h-pipe' }, S('path', { d, class: 'h-pe' }), S('path', { d, class: 'h-pb' }), S('path', { d, class: 'h-ph' }));
      if (id) { const f = S('path', { d, class: 'h-pf' }); g.append(f); (this.PF[id] ||= []).push(f); }
      add(g);
    };
    const bowtie = (x, y, cls, vert = false) => S('path', { class: cls, d: vert
      ? `M${x - 9} ${y - 12} L${x} ${y} L${x + 9} ${y - 12} Z M${x - 9} ${y + 12} L${x} ${y} L${x + 9} ${y + 12} Z`
      : `M${x - 12} ${y - 9} L${x} ${y} L${x - 12} ${y + 9} Z M${x + 12} ${y - 9} L${x} ${y} L${x + 12} ${y + 9} Z` });
    const bubble = (tag, x, y, lineTo) => {
      const [a, b] = tag.split('-');
      const g = S('g', { class: 'h-inst' }, S('line', { x1: x, y1: y + 17, x2: x, y2: lineTo, class: 'h-lead' }), S('circle', { cx: x, cy: y, r: 17 }), S('line', { x1: x - 17, y1: y, x2: x + 17, y2: y, class: 'h-ibar' }),
        txt(x, y - 4, a, 'h-it', 'middle'), txt(x, y + 12, b, 'h-it', 'middle'));
      return g;
    };
    const instHit = (tag, ...els) => { const g = S('g', {}, S('rect', { class: 'h-selr', ...els.shift() }), ...els); this._hit(g, () => this._fpOpen('inst', tag), `${tag} – mở bảng thiết bị đo`); return g; };
    const drawer = (tag, g) => this._hit(g, () => this.app.openDrawer(tag), `${tag} – xem thông số thiết bị`);
    svg.append(this._defs());
    add(S('rect', { x: 0, y: 0, width: 1280, height: 660, class: 'h-pidbg' }), S('rect', { x: 0, y: 0, width: 1280, height: 660, fill: 'url(#hmiG-vign)', 'pointer-events': 'none' }));
    // ---- chú giải màu ----
    const lg = S('g', { class: 'h-legend' });
    [['run', 'CHẠY / MỞ', 0], ['stop', 'DỪNG', 118], ['fault', 'LỖI / ĐÓNG', 198], ['move', 'HÀNH TRÌNH', 326], ['unk', 'KHÔNG RÕ', 460]].forEach(([k, s, dx]) => {
      lg.append(S('rect', { x: 430 + dx, y: 22, width: 14, height: 14, rx: 2, class: 'h-lgsw ' + k }), txt(450 + dx, 34, s, 'h-lgt'));
    });
    lg.append(S('path', { d: 'M430 52 H470', class: 'h-lgflow' }), txt(478, 56, 'DÒNG CHẢY (TỐC ĐỘ THEO LƯU LƯỢNG)', 'h-lgt'));
    add(lg);
    // ---- đường ống (vẽ trước, thiết bị đè lên) ----
    pipe('M0 100 H262 V150', 'sup');
    pipe('M390 485 H452', 'suc'); pipe('M450 485 V260 H537', 'suc1'); pipe('M450 485 H537', 'suc2');
    pipe('M605 240 H760', 'dis1'); pipe('M605 465 H760 V240', 'dis2'); pipe('M760 240 V160 H1150', 'main');
    pipe('M855 160 V188'); pipe('M950 160 V190'); pipe('M962 205 H990 V256', 'psv'); pipe('M372 530 V600 H452', 'drain');
    add(S('path', { d: 'M1148 146 L1172 160 L1148 174 Z', class: 'h-arrow' }), S('path', { d: 'M452 590 L470 600 L452 610 Z', class: 'h-arrow' }), S('path', { d: 'M980 254 L990 270 L1000 254 Z', class: 'h-arrow' }));
    // ---- cấp nước vào: ống thành phố -> FT-100 -> FV-01 -> bể ----
    add(txt(8, 130, 'ỐNG CẤP THÀNH PHỐ', 'h-lbl'), txt(8, 146, 'DN100', 'h-sm'));
    add(instHit('FT-100', { x: 58, y: 26, width: 160, height: 90 }, S('rect', { x: 66, y: 90, width: 28, height: 20, rx: 3, class: 'h-meter' }), bubble('FT-100', 80, 48, 90), this._disp('qin', 102, 37, 66, 'm³/h')));
    O.fv = bowtie(200, 100, 'h-fv');
    add(drawer('FV-01', S('g', {}, S('rect', { class: 'h-selr', x: 180, y: 66, width: 40, height: 48 }), O.fv, txt(200, 84, 'FV-01', 'h-tag', 'middle'))));
    // ---- bể chứa T-01 ----
    const tank = S('g', { class: 'h-tankg' }, S('rect', { class: 'h-selr', x: TK.x - 6, y: TK.y0 - 6, width: TK.w + 12, height: TK.y1 - TK.y0 + 12 }),
      S('rect', { x: TK.x, y: TK.y0, width: TK.w, height: TK.y1 - TK.y0, rx: 8, class: 'h-tank' }),
      S('rect', { x: TK.x + 7, y: TK.y0 + 7, width: TK.w - 14, height: TK.y1 - TK.y0 - 14, rx: 3, class: 'h-tankin' }));
    O.water = S('rect', { x: TK.x + 7, y: TK.y1 - 7, width: TK.w - 14, height: 0, class: 'h-water' });
    O.wtop = S('line', { x1: TK.x + 7, x2: TK.x + TK.w - 7, y1: TK.y1, y2: TK.y1, class: 'h-wtop' });
    tank.append(O.water, O.wtop, S('rect', { x: TK.x + 7, y: TK.y0 + 7, width: TK.w - 14, height: TK.y1 - TK.y0 - 14, class: 'h-glass' }));
    const lv = this._lv(), sf = cfg.safety;
    const marks = [[sf.level_high_m, 'H ' + num(sf.level_high_m, 1), 'warn'], [lv.conserve_m, 'tiết kiệm ' + num(lv.conserve_m, 1), 'warn'], [lv.stop_m, 'dừng ' + num(lv.stop_m, 1), 'alarm'], [sf.float_lsll_m, 'LSLL ' + num(sf.float_lsll_m, 2), 'alarm']];
    for (const [L] of marks) tank.append(S('line', { x1: TK.x + 8, x2: TK.x + TK.w - 8, y1: lvY(L), y2: lvY(L), class: 'h-mk' }));
    tank.append(txt(300, 290, 'MỨC BỂ', 'h-tcap', 'middle'), this._disp('lvp', 252, 298, 82, '%'), txt(300, 346, 'THỂ TÍCH', 'h-tcap', 'middle'), this._disp('vol', 252, 354, 82, 'm³'));
    add(this._hit(tank, () => this._fpOpen('inst', 'LT-101'), 'Bể chứa T-01 – mở bảng mức nước LT-101'));
    add(txt(362, 553, 'T-01 · BỂ CHỨA ' + num(cfg.tank.area_m2 * cfg.tank.overflow_m, 0) + ' m³', 'h-tag2', 'end'));
    // thanh mức bên cạnh bể
    O.bgf = S('rect', { x: 177, y: TK.y1, width: 14, height: 0, class: 'h-bgf ok' });
    add(S('rect', { x: 175, y: TK.y0, width: 18, height: TK.y1 - TK.y0, rx: 2, class: 'h-bgt' }), O.bgf);
    for (const [L, s, k] of marks) add(S('line', { x1: 166, x2: 196, y1: lvY(L), y2: lvY(L), class: 'h-bgm ' + k }), txt(162, lvY(L) + 4, s, 'h-sm', 'end'));
    add(txt(162, TK.y0 + 10, num(TK.hMax, 1) + ' m', 'h-sm', 'end'), txt(162, TK.y1, '0', 'h-sm', 'end'));
    add(instHit('LT-101', { x: 330, y: 84, width: 146, height: 48 }, bubble('LT-101', 352, 108, 150), this._disp('lt', 374, 97, 72, 'm')));
    O.lsll = S('circle', { cx: 184, cy: 578, r: 7, class: 'h-lampc' });
    add(drawer('LSLL-101', S('g', {}, S('rect', { class: 'h-selr', x: 172, y: 566, width: 186, height: 24 }), O.lsll, txt(197, 582, 'LSLL-101 · PHAO CẠN', 'h-sm'))));
    O.vx = bowtie(372, 568, 'h-vx', true);
    add(drawer('VX-01', S('g', {}, S('rect', { class: 'h-selr', x: 358, y: 552, width: 64, height: 32 }), O.vx, txt(386, 572, 'VX-01', 'h-tag'))), txt(474, 604, 'XẢ ĐÁY', 'h-sm'));
    // ---- ống hút, van tay, cụm bơm + biến tần ----
    add(txt(396, 512, 'ỐNG HÚT', 'h-sm'));
    for (const [y, tag] of [[260, 'HV-01'], [485, 'HV-02']]) add(drawer('HV-01..04', S('g', {}, S('rect', { class: 'h-selr', x: 476, y: y - 30, width: 28, height: 44 }), bowtie(490, y, 'h-hv'), txt(490, y - 16, tag, 'h-sm', 'middle'))));
    O.pumps = [this._pumpSym(0, 565, 260), this._pumpSym(1, 565, 485)].map((P) => { add(P.g, P.vfd); return P; });
    for (const [y, a, b] of [[240, 'CV-01', 'HV-03'], [465, 'CV-02', 'HV-04']]) {
      add(drawer('CV-01/02', S('g', {}, S('rect', { class: 'h-selr', x: 636, y: y - 32, width: 28, height: 46 }), bowtie(650, y, 'h-hv'), S('path', { d: `M650 ${y} L662 ${y - 9} L662 ${y + 9} Z`, class: 'h-cvf' }), txt(650, y - 16, a, 'h-sm', 'middle'))),
        drawer('HV-01..04', S('g', {}, S('rect', { class: 'h-selr', x: 691, y: y - 32, width: 28, height: 46 }), bowtie(705, y, 'h-hv'), txt(705, y - 16, b, 'h-sm', 'middle'))));
    }
    // ---- ống đẩy: PT-101, HT-01, PT-102, PSV-01, FT-101, MV-02 ----
    add(instHit('PT-101', { x: 756, y: 52, width: 108, height: 84 }, bubble('PT-101', 800, 104, 153), this._disp('p1', 760, 58, 70, 'bar')));
    add(instHit('PT-102', { x: 866, y: 52, width: 108, height: 84 }, bubble('PT-102', 910, 104, 153), this._disp('p2', 870, 58, 70, 'bar')));
    add(drawer('HT-01', S('g', {}, S('rect', { class: 'h-selr', x: 830, y: 182, width: 50, height: 124 }), S('rect', { x: 839, y: 186, width: 32, height: 96, rx: 16, class: 'h-vessel' }),
      S('line', { x1: 839, x2: 871, y1: 238, y2: 238, class: 'h-mk' }), txt(855, 300, 'HT-01', 'h-tag', 'middle'))));
    O.psv = S('path', { d: 'M938 190 L962 190 L950 205 Z M950 205 L962 193 L962 217 Z', class: 'h-psv' });
    add(drawer('PSV-01', S('g', {}, S('rect', { class: 'h-selr', x: 880, y: 184, width: 88, height: 70 }), O.psv, S('path', { d: 'M950 205 V219 l-5 3 l10 4 l-10 4 l10 4 l-5 3 M944 238 H956', class: 'h-spring' }),
      txt(934, 212, 'PSV-01', 'h-tag', 'end'), this._disp('psv', 884, 224, 56))));
    add(instHit('FT-101', { x: 991, y: 52, width: 120, height: 84 }, S('rect', { x: 1019, y: 149, width: 32, height: 22, rx: 3, class: 'h-meter' }), S('circle', { cx: 1035, cy: 160, r: 6, class: 'h-coil' }),
      bubble('FT-101', 1035, 104, 149), this._disp('q', 995, 58, 70, 'm³/h')));
    O.mv = bowtie(1105, 160, 'h-mv');
    O.mvAct = S('rect', { x: 1093, y: 116, width: 24, height: 22, rx: 3, class: 'h-act' });
    O.mvSel = S('rect', { class: 'h-selr', x: 1070, y: 96, width: 70, height: 114 });
    add(this._hit(S('g', {}, O.mvSel, S('line', { x1: 1105, y1: 138, x2: 1105, y2: 152, class: 'h-stem' }), O.mvAct, txt(1105, 132, 'M', 'h-mtxt', 'middle'), O.mv,
      txt(1105, 108, 'MV-02', 'h-tag', 'middle'), this._disp('mv', 1075, 182, 60)), () => this._fpOpen('valve', 'MV-02'), 'Van điện MV-02 – mở bảng điều khiển van'));
    // ---- mạng lưới DMA-A + logger điểm bất lợi ----
    const dma = S('g', {}, S('rect', { class: 'h-selr', x: 1166, y: 86, width: 112, height: 176 }), S('rect', { x: 1172, y: 92, width: 102, height: 164, rx: 4, class: 'h-blk' }),
      txt(1223, 110, 'MẠNG LƯỚI', 'h-btitle d', 'middle'), txt(1223, 129, 'DMA-A', 'h-btitle d', 'middle'),
      S('path', { d: 'M1190 152 l12 -10 l12 10 v12 h-24z M1214 152 l12 -10 l12 10 v12 h-24z M1238 152 l12 -10 l12 10 v12 h-24z', class: 'h-house' }),
      txt(1223, 181, 'PL-301', 'h-tag', 'middle'), txt(1223, 197, 'ĐIỂM BẤT LỢI', 'h-xs', 'middle'), this._disp('pc', 1182, 204, 58, 'bar'), txt(1223, 247, '≥ ' + num(cfg.service.p_crit_min_bar, 1) + ' bar', 'h-sm', 'middle'));
    add(this._hit(dma, () => this._fpOpen('inst', 'PL-301'), 'Mạng lưới DMA-A – áp lực điểm bất lợi PL-301'));
    // ---- khối chất lượng nước ----
    const qb = S('g', {}, S('rect', { x: 790, y: 318, width: 240, height: 327, rx: 4, class: 'h-blk' }), S('rect', { x: 790, y: 318, width: 240, height: 26, rx: 4, class: 'h-blkt' }),
      txt(800, 336, 'CHẤT LƯỢNG NƯỚC SAU BỂ', 'h-btitle'));
    O.q = {};
    [['cl', 'AIT-201', 'Clo dư'], ['ntu', 'AIT-202', 'Độ đục'], ['ph', 'AIT-203', 'pH']].forEach(([k, tag, name], i) => {
      const y = 352 + i * 97, L = this._lim(tag);
      const lamp = S('rect', { x: 944, y: y + 30, width: 78, height: 22, rx: 3, class: 'h-qlamp' }), lt = txt(983, y + 45, 'ĐẠT', 'h-qlt', 'middle');
      const row = S('g', {}, S('rect', { class: 'h-selr', x: 794, y: y - 2, width: 232, height: 92 }), txt(800, y + 16, `${name} · ${tag}`, 'h-tag2'),
        this._disp('q_' + k, 800, y + 30, 82, INST[tag].u), lamp, lt, txt(800, y + 76, 'QCVN 01-1: ' + L.qc, 'h-sm'));
      if (i < 2) row.append(S('line', { x1: 798, x2: 1022, y1: y + 92, y2: y + 92, class: 'h-sep' }));
      qb.append(this._hit(row, () => this._fpOpen('inst', tag), `${tag} ${name} – mở bảng thiết bị đo`));
      O.q[k] = { lamp, lt };
    });
    add(qb);
    // ---- khối điều khiển trạm ----
    const cb = S('g', {}, S('rect', { x: 1045, y: 268, width: 231, height: 377, rx: 4, class: 'h-blk' }), S('rect', { x: 1045, y: 268, width: 231, height: 26, rx: 4, class: 'h-blkt' }),
      txt(1055, 286, 'ĐIỀU KHIỂN TRẠM', 'h-btitle'));
    const row = (y, label) => cb.append(txt(1055, y, label, 'h-sm'));
    O.ctlL = txt(1055, 318, 'Chế độ điều khiển', 'h-sm'); cb.append(O.ctlL); O.ctl = qtxt(1266, 337, 'h-cval', 211);
    O.ctlN = txt(1266, 318, '', 'h-xs h-qn', 'end');
    row(360, 'Chế độ gateway'); O.mode = qtxt(1266, 379, 'h-cval', 211);
    row(402, 'Kịch bản'); O.scr = qtxt(1266, 402, 'h-cval2', 150);
    cb.append(O.ctl.el, O.ctlN, O.mode.el, O.scr.el, S('line', { x1: 1053, x2: 1268, y1: 414, y2: 414, class: 'h-sep' }));
    row(436, 'P đặt'); cb.append(this._disp('pset', 1160, 422, 72, 'bar'));
    row(466, 'P thực PT-101'); cb.append(this._disp('preal', 1160, 452, 72, 'bar'));
    O.pbarSet = S('path', { d: '', class: 'h-pbset' }); O.pbarVal = S('rect', { x: 1055, y: 486, width: 0, height: 8, class: 'h-pbval' });
    cb.append(S('rect', { x: 1055, y: 486, width: 210, height: 8, rx: 2, class: 'h-pbtrk' }), S('rect', { x: 1055 + 210 * (cfg.service.p_out_max_bar / 6), y: 486, width: 210 * (1 - cfg.service.p_out_max_bar / 6), height: 8, class: 'h-pbhi' }),
      O.pbarVal, O.pbarSet, txt(1055, 508, '0', 'h-xs'), txt(1265, 508, '6 bar', 'h-xs', 'end'));
    row(534, 'Công suất'); cb.append(this._disp('kw', 1160, 520, 72, 'kW'));
    row(564, 'Điện năng'); cb.append(this._disp('kwh', 1160, 550, 72, 'kWh'));
    const btn = S('g', { class: 'h-svgbtn' }, S('rect', { x: 1057, y: 590, width: 207, height: 42, rx: 4 }), txt(1160, 616, 'CHẾ ĐỘ TRẠM ▸', 'h-svgbtnt', 'middle'));
    cb.append(this._hit(btn, () => this._fpOpen('station', 'ST'), 'Mở bảng chế độ trạm: tự động / tay, đặt lại dừng an toàn, luân phiên bơm'));
    add(cb);
    this.pid = svg;
    this.pidWrap = h('div', { class: 'h-pidwrap' }, svg);
    host.append(this.pidWrap);
  }
  _pumpSym(i, cx, cy) {
    const tag = PUMP_TAG[i];
    const P = { cx, cy };
    P.vol = S('circle', { cx, cy, r: 28, class: 'h-vol stop' });
    P.noz = S('rect', { x: cx + 12, y: cy - 28, width: 30, height: 16, rx: 1, class: 'h-vol stop' });
    P.imp = S('g', { class: 'h-imp', style: `transform-origin:${cx}px ${cy}px` },
      ...[0, 120, 240].map((r) => S('path', { d: `M${cx} ${cy} q 9 -5 17 -2 q -7 6 -17 2 z`, transform: `rotate(${r} ${cx} ${cy})` })), S('circle', { cx, cy, r: 4.5, class: 'h-hub' }));
    P.q = S('text', { x: cx, y: cy + 6, class: 'h-pq', 'text-anchor': 'middle', text: '?' });
    P.bA = S('rect', { x: cx - 74, y: cy - 88, width: 44, height: 16, rx: 3, class: 'h-badge' }); P.bAt = S('text', { x: cx - 52, y: cy - 76, class: 'h-badget', 'text-anchor': 'middle' });
    P.bL = S('rect', { x: cx - 74, y: cy - 68, width: 44, height: 16, rx: 3, class: 'h-badge' }); P.bLt = S('text', { x: cx - 52, y: cy - 56, class: 'h-badget', 'text-anchor': 'middle' });
    // thẻ liên động: lớp an toàn đang chặn bơm (dừng an toàn, cắt/khóa áp cao, khóa chạy khô)
    P.bI = S('rect', { x: cx - 76, y: cy - 48, width: 48, height: 16, rx: 3, class: 'h-badge off' }); P.bIt = S('text', { x: cx - 52, y: cy - 36, class: 'h-badget', 'text-anchor': 'middle', text: 'INTLK' });
    const motor = S('g', {}, S('rect', { x: cx - 8, y: cy - 94, width: 16, height: 8, rx: 1, class: 'h-motor' }), S('rect', { x: cx - 22, y: cy - 87, width: 44, height: 41, rx: 5, class: 'h-motor' }),
      ...[0, 1, 2, 3, 4].map((k) => S('line', { x1: cx - 15 + k * 7.5, x2: cx - 15 + k * 7.5, y1: cy - 82, y2: cy - 51, class: 'h-fin' })),
      S('path', { d: `M${cx - 12} ${cy - 46} L${cx + 12} ${cy - 46} L${cx + 7} ${cy - 27} L${cx - 7} ${cy - 27} Z`, class: 'h-lant' }));
    P.sel = S('rect', { class: 'h-selr', x: cx - 80, y: cy - 100, width: 128, height: 168 });
    P.g = S('g', {}, P.sel, motor, P.noz, P.vol, S('circle', { cx, cy, r: 28, class: 'h-shine' }), P.imp, P.q,
      S('path', { d: `M${cx - 30} ${cy + 39} L${cx + 30} ${cy + 39} L${cx + 22} ${cy + 27} L${cx - 22} ${cy + 27} Z`, class: 'h-base' }),
      S('text', { x: cx, y: cy + 58, class: 'h-ptag', 'text-anchor': 'middle', text: tag }), P.bA, P.bAt, P.bL, P.bLt, P.bI, P.bIt);
    this._hit(P.g, () => this._fpOpen('pump', i), `${tag} – mở bảng điều khiển bơm`);
    // khối dữ liệu biến tần
    const x0 = cx + 34, y0 = cy - 2;
    P.vst = S('text', { x: x0 + 144, y: y0 + 15, class: 'h-vst', 'text-anchor': 'end' });
    P.fbar = S('rect', { x: x0 + 8, y: y0 + 95, width: 0, height: 5, class: 'h-fbar' });
    P.vbox = S('rect', { x: x0, y: y0, width: 152, height: 106, rx: 4, class: 'h-vfd' });
    P.vsel = S('rect', { class: 'h-selr', x: x0 - 3, y: y0 - 4, width: 158, height: 114 });
    P.vfd = S('g', {}, P.vsel, P.vbox, S('rect', { x: x0, y: y0, width: 152, height: 20, rx: 4, class: 'h-vfdt' }),
      S('text', { x: x0 + 8, y: y0 + 15, class: 'h-btitle', text: 'VFD-0' + (i + 1) }), P.vst,
      ...[['Hz', 'f', 24], ['A', 'a', 47], ['kW', 'kw', 70]].map(([u, k, dy]) => S('g', {}, S('text', { x: x0 + 7, y: y0 + dy + 16, class: 'h-vl', text: { f: 'Tần số', a: 'Dòng', kw: 'Công suất' }[k] }),
        this._disp(`v${i}_${k}`, x0 + 72, y0 + dy, 48), S('text', { x: x0 + 124, y: y0 + dy + 16, class: 'h-du', text: u }))),
      S('rect', { x: x0 + 8, y: y0 + 95, width: 136, height: 5, rx: 1, class: 'h-ftrk' }), P.fbar);
    this._hit(P.vfd, () => this._fpOpen('pump', i), `VFD-0${i + 1} – mở bảng điều khiển ${tag}`);
    return P;
  }
  _flow(id, on, q = 10) {
    for (const f of this.PF[id] || []) {
      setC(f, 'h-pf' + (on ? ' on' : ''));
      if (on) { const v = 18 + Math.round(clamp(q, 0, 40) / 4) * 8; setA(f, 'style', `animation-duration:${(24 / v).toFixed(2)}s`); }
    }
  }
  _updOverview(d) {
    const a = this.app, c = this.ctx, O = this.O, cfg = a.cfg, local = !c.remote, hw = d.installed;
    const absent = (tag) => Boolean(hw && !hw.has(tag));
    const known = !c.dead;
    // giá trị đo
    this._sv('qin', d.q_in, 1, { absent: absent('FT-100') });
    const lvl = d.level, L = this._lim('LT-101');
    const lst = this._sv('lt', lvl, 2, { lim: L.st });
    this._sv('lvp', isNum(lvl) ? (lvl / cfg.tank.overflow_m) * 100 : lvl, 1, { lim: () => lst });
    this._sv('vol', isNum(lvl) ? lvl * cfg.tank.area_m2 : lvl, 0);
    const pl = this._lim('PT-101');
    this._sv('p1', d.p1, 2, { lim: pl.st }); this._sv('p2', d.p2, 2, { absent: absent('PT-102'), lim: pl.st });
    this._sv('q', d.q, 1, { lim: this._lim('FT-101').st }); this._sv('pc', d.p_crit, 2, { lim: this._lim('PL-301').st });
    // chữ trạng thái thiết bị theo chú giải (mở xanh, đóng đỏ, hành trình vàng); bất thường thêm khung báo động nhấp nháy
    const relief = isNum(d.psv) && d.psv > 0.05;
    this._sv('psv', d.psv === undefined ? undefined : isNum(d.psv) ? (relief ? 'XẢ ' + num(d.psv, 1) : 'ĐÓNG') : d.psv, 1, { st: relief ? 'ok frame' : 'closed' });
    const mvAbsent = cfg.hardware['MV-02'] === false, vv = d.valve, I = this._intlk(d);
    this._sv('mv', isNum(vv) ? (vv > 0.99 ? 'MỞ' : vv < 0.01 ? 'ĐÓNG' : num(vv * 100, 0) + ' %') : vv, 0,
      { absent: mvAbsent, st: !isNum(vv) || vv > 0.99 ? 'ok' : vv < 0.01 ? 'closed' + (I?.k === 'safe' ? ' frame' : '') : 'warn' });
    // bể
    const showL = known && isNum(lvl) ? lvl : 0;
    const wy = known ? lvY(showL) : TK.y0 + 7;
    setA(O.water, 'y', wy.toFixed(1)); setA(O.water, 'height', Math.max(0, TK.y1 - 7 - wy).toFixed(1));
    setA(O.wtop, 'y1', lvY(showL).toFixed(1)); setA(O.wtop, 'y2', lvY(showL).toFixed(1));
    setA(O.bgf, 'y', lvY(showL).toFixed(1)); setA(O.bgf, 'height', (TK.y1 - lvY(showL)).toFixed(1));
    setC(O.bgf, 'h-bgf ' + (known && isNum(lvl) ? lst : 'unk'));
    setC(O.water, 'h-water' + (known ? '' : ' unk'));
    setC(O.lsll, 'h-lampc' + (local && known && a.st.sensors.lsll ? ' alarm' : local && known ? ' ok' : ''));
    const drain = local && known && a.st.plant.drain_open;
    setC(O.vx, 'h-vx' + (drain ? ' open' : ''));
    // van phao FV-01 không có phản hồi vị trí: suy ra từ lưu lượng vào FT-100 (có dòng = mở, bể đầy không dòng = đóng, còn lại = không có nước cấp)
    const qin = d.q_in, fv = !known || absent('FT-100') || !isNum(qin) ? 'unk' : qin > 0.3 ? 'open' : isNum(lvl) && lvl >= cfg.inlet.float_close_m - 0.05 ? 'closed' : 'stop';
    setC(O.fv, 'h-fv ' + fv);
    // bơm
    const any = d.pumps.some((p) => p.running), q = c.stale ? ' q' : '';
    d.pumps.forEach((p, i) => {
      const P = O.pumps[i];
      const st = !known ? 'unk' : p.fault ? 'fault' : p.running ? 'run' : 'stop';
      setC(P.vol, 'h-vol ' + st); setC(P.noz, 'h-vol ' + st);
      const spin = known && p.running && isNum(p.f) && p.f > 1;
      setC(P.imp, 'h-imp' + (spin ? ' spin' : ''));
      if (spin) setA(P.imp, 'style', `transform-origin:${P.cx}px ${P.cy}px;animation-duration:${(30 / Math.max(10, Math.round(p.f))).toFixed(2)}s`);
      setC(P.q, 'h-pq' + (known && !c.stale ? '' : ' on'));
      const man = d.ctl !== 'auto';
      setC(P.bA, 'h-badge ' + (!known ? 'off' : man ? 'man' : 'auto') + q); setT(P.bAt, !known ? '–' : man ? 'MAN' : 'AUTO');
      setC(P.bL, 'h-badge ' + (!known || !man ? 'off' : d.ctl === 'local' ? 'loc' : 'rem') + q); setT(P.bLt, !known || !man ? '–' : d.ctl === 'local' ? 'LOC' : 'REM');
      setC(P.bI, 'h-badge ' + (I && I.sev === 'bad' ? 'intlk' : 'off') + q);
      setT(P.vst, !known ? '####' : p.fault ? 'LỖI' : p.running ? 'CHẠY' : 'DỪNG');
      setC(P.vst, 'h-vst ' + st);
      setC(P.vbox, 'h-vfd' + (p.fault && known ? ' fault' : ''));
      this._sv(`v${i}_f`, p.f, 1); this._sv(`v${i}_a`, p.amps, 1); this._sv(`v${i}_kw`, p.kw, 2);
      setA(P.fbar, 'width', (known && isNum(p.f) ? clamp(p.f / 50, 0, 1) * 136 : 0).toFixed(1));
      const open = this.fps.some((f) => f.id === 'pump:' + i);
      setC(P.sel, 'h-selr' + (open ? ' on' : '')); setC(P.vsel, 'h-selr' + (open ? ' on' : ''));
      this._flow('suc' + (i + 1), known && p.running, d.q); this._flow('dis' + (i + 1), known && p.running, d.q);
    });
    this._flow('suc', known && any, d.q);
    this._flow('sup', known && isNum(d.q_in) && d.q_in > 0.3, d.q_in);
    this._flow('main', known && isNum(d.q) && d.q > 0.3, d.q);
    this._flow('psv', known && isNum(d.psv) && d.psv > 0.05, d.psv * 4);
    this._flow('drain', drain, 30);
    // van
    setC(O.psv, 'h-psv' + (!known || !isNum(d.psv) ? ' unk' : relief ? ' relief' : ' closed'));
    const mst = !known || mvAbsent || !isNum(vv) ? 'unk' : vv > 0.99 ? 'open' : vv < 0.01 ? 'closed' : 'moving';
    setC(O.mv, 'h-mv ' + mst); setC(O.mvAct, 'h-act ' + mst);
    setC(O.mvSel, 'h-selr' + (this.fps.some((f) => f.id === 'valve:MV-02') ? ' on' : ''));
    // chất lượng
    for (const [k, tag] of [['cl', 'AIT-201'], ['ntu', 'AIT-202'], ['ph', 'AIT-203']]) {
      const st = this._sv('q_' + k, d[k], 2, { absent: absent(tag), lim: this._lim(tag).st });
      const Q = O.q[k], ok = st === 'ok' || st === 'warn', bad = st === 'alarm';
      setC(Q.lamp, 'h-qlamp ' + (bad ? 'bad' : ok ? 'ok' : 'unk')); setT(Q.lt, bad ? 'KHÔNG ĐẠT' : ok ? 'ĐẠT' : st === 'na' ? 'N/A' : '####');
      setC(Q.lt, 'h-qlt' + (bad ? ' bad' : ok ? ' ok' : ''));
    }
    // điều khiển trạm (dữ liệu cũ: tiền tố '?' và ghi chú giờ bản tin cuối)
    const cs = this._ctlState(d), qm = c.stale ? '? ' : '';
    const stxt = (T, s, cls, mq = qm) => { setT(T.q, mq); setT(T.t, s); setC(T.el, cls + q); this._fit(T.el, T.max); };
    stxt(O.ctl, cs.t, 'h-cval ' + cs.cls);
    setT(O.ctlN, c.stale ? `bản tin cuối ${this._lastHM(d)}` : ''); setT(O.ctlL, c.stale ? 'Điều khiển' : 'Chế độ điều khiển');
    stxt(O.mode, this._modeText(d), 'h-cval ' + this._modeCls(d), '');
    const sc = this._script();
    stxt(O.scr, c.dead ? '####' : `v${sc.v} · ${sc.s}`, 'h-cval2');
    this._sv('pset', d.p_set, 2); this._sv('preal', d.p1, 2, { lim: pl.st });
    this._sv('kw', d.kw, 2); this._sv('kwh', d.kwh, 1);
    const X = (v) => 1055 + clamp(v / 6, 0, 1) * 210;
    setA(O.pbarVal, 'width', (known && isNum(d.p1) ? X(d.p1) - 1055 : 0).toFixed(1));
    setC(O.pbarVal, 'h-pbval ' + (known && isNum(d.p1) ? pl.st(d.p1) : ''));
    setA(O.pbarSet, 'd', known && isNum(d.p_set) ? `M${X(d.p_set).toFixed(1)} 484 l-6 -9 h12 z M${X(d.p_set).toFixed(1)} 484 v12` : '');
    this.pid.classList.toggle('stale', c.stale);
  }

  // ================= màn 02: bơm – biến tần =================
  _gauge(min, max, step, minor, unit, bands = []) {
    const cx = 110, cy = 108, r = 84, a0 = 135, a1 = 405;
    const ang = (v) => a0 + (a1 - a0) * clamp((v - min) / (max - min), 0, 1);
    const pt = (a, rr) => [cx + rr * Math.cos((a * Math.PI) / 180), cy + rr * Math.sin((a * Math.PI) / 180)];
    const arc = (v0, v1, rr) => { const [x0, y0] = pt(ang(v0), rr), [x1, y1] = pt(ang(v1), rr); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rr} ${rr} 0 ${ang(v1) - ang(v0) > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    const svg = S('svg', { viewBox: '0 0 220 214', class: 'h-gauge', 'aria-hidden': 'true' }, S('circle', { cx, cy, r: r + 16, class: 'h-g-face' }), S('path', { d: arc(min, max, r), class: 'h-g-trk' }));
    for (const [v0, v1, cls] of bands) svg.append(S('path', { d: arc(v0, v1, r + 9), class: 'h-g-band ' + cls }));
    for (let v = min; v <= max + 1e-9; v += minor) {
      const major = Math.abs((v - min) / step - Math.round((v - min) / step)) < 1e-6, [x0, y0] = pt(ang(v), r - 8), [x1, y1] = pt(ang(v), r - (major ? 19 : 13));
      svg.append(S('line', { x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1), class: major ? 'h-g-tk' : 'h-g-tk2' }));
      if (major) { const [lx, ly] = pt(ang(v), r - 31); svg.append(S('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), class: 'h-g-lbl', 'text-anchor': 'middle', text: String(Math.round(v * 10) / 10).replace('.', ',') })); }
    }
    const val = S('path', { d: '', class: 'h-g-val' }), sp = S('path', { d: '', class: 'h-g-sp' });
    const t = S('text', { x: cx, y: cy + 12, class: 'h-g-txt', 'text-anchor': 'middle' });
    svg.append(val, sp, t, S('text', { x: cx, y: cy + 34, class: 'h-g-unit', 'text-anchor': 'middle', text: unit }));
    return {
      svg,
      set: (v, nd, spv, o) => {
        const [txt, st] = this._fv(v, nd, o);
        setT(t, txt); setC(t, 'h-g-txt ' + st + (this.ctx.stale ? ' stale' : ''));
        const ok = isNum(v) && !this.ctx.dead && st !== 'na';
        setA(val, 'd', ok && v > min ? arc(min, Math.min(max, v), r) : ''); setC(val, 'h-g-val ' + st);
        if (isNum(spv) && !this.ctx.dead) {
          const P = [pt(ang(spv), r + 4), pt(ang(spv) - 4, r + 17), pt(ang(spv) + 4, r + 17)].map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1));
          setA(sp, 'd', `M${P[0]} L${P[1]} L${P[2]} Z`);
        } else setA(sp, 'd', '');
      },
    };
  }
  _pnl(title, ...kids) { const t = h('span', {}, title); const el = h('section', { class: 'h-pnl' }, h('div', { class: 'h-pnl-t' }, t), h('div', { class: 'h-pnl-b' }, ...kids)); el._title = t; return el; }
  _ro(label, D) { return h('div', { class: 'h-ro' }, h('small', {}, label), D.el); }
  _buildPumps(host) {
    this.PP = [0, 1].map((i) => {
      const P = { g: this._gauge(0, 50, 10, 2.5, 'Hz', [[25, 50, 'ok']]) };
      P.lamps = { run: this._lamp('CHẠY'), stop: this._lamp('DỪNG'), flt: this._lamp('LỖI'), mode: this._lamp('TỰ ĐỘNG'), src: this._lamp('TẠI CHỖ/TỪ XA'), ilk: this._lamp('LIÊN ĐỘNG') };
      P.R = { fs: this._hd('Hz'), a: this._hd('A'), kw: this._hd('kW'), rh: this._hd('h'), sh: this._hd(''), st: this._hd('') };
      P.chip = h('span', { class: 'h-chip' });
      const pnl = this._pnl(`${PUMP_TAG[i]} · BƠM SỐ ${i + 1} · VFD-0${i + 1}`,
        h('div', { class: 'h-pp-top' }, h('div', { class: 'h-pp-g' }, P.g.svg, h('small', { class: 'h-cap c' }, 'TẦN SỐ · ▲ = ĐẶT')), h('div', { class: 'h-lampcol' }, ...Object.values(P.lamps).map((L) => L.el))),
        h('div', { class: 'h-rogrid' }, this._ro('Tần số đặt', P.R.fs), this._ro('Dòng điện', P.R.a), this._ro('Công suất', P.R.kw), this._ro('Giờ chạy', P.R.rh),
          this._ro('Khởi động / 1 giờ', P.R.sh), this._ro('Tổng số lần khởi động', P.R.st)),
        h('button', { class: 'h-btn wide', onclick: () => this._fpOpen('pump', i) }, `BẢNG ĐIỀU KHIỂN ${PUMP_TAG[i]} ▸`));
      pnl.querySelector('.h-pnl-t').append(P.chip);
      P.el = pnl;
      return P;
    });
    const Q = this.PQ = { g: this._gauge(0, 6, 1, 0.25, 'bar', [[0, 1.4, 'warn'], [4, 6, 'alarm']]) };
    Q.R = { pset: this._hd('bar'), err: this._hd('bar'), pc: this._hd('bar'), q: this._hd('m³/h'), kw: this._hd('kW'), kwh: this._hd('kWh') };
    Q.ctl = h('b', { class: 'h-bigtxt' });
    const qp = this._pnl('ÁP LỰC ĐẦU RA · PT-101',
      h('div', { class: 'h-pp-top' }, h('div', { class: 'h-pp-g' }, Q.g.svg, h('small', { class: 'h-cap c' }, 'ÁP THỰC · ▲ = P_set')), h('div', { class: 'h-lampcol' }, h('small', { class: 'h-cap' }, 'Điều khiển'), Q.ctl)),
      h('div', { class: 'h-rogrid' }, this._ro('Áp đặt P_set', Q.R.pset), this._ro('Sai lệch P – P_set', Q.R.err), this._ro('Áp điểm bất lợi', Q.R.pc),
        this._ro('Lưu lượng ra', Q.R.q), this._ro('Công suất trạm', Q.R.kw), this._ro('Điện năng', Q.R.kwh)),
      h('button', { class: 'h-btn wide', onclick: () => this._fpOpen('station', 'ST') }, 'CHẾ ĐỘ TRẠM ▸'));
    host.append(h('div', { class: 'h-grid3' }, this.PP[0].el, this.PP[1].el, qp));
  }
  _pumpLamps(Ls, d, i) {
    const p = d.pumps[i], c = this.ctx, k = !c.dead, man = d.ctl !== 'auto', I = this._intlk(d);
    this._setLamp(Ls.run, k && p.running ? 'g' : ''); this._setLamp(Ls.stop, k && !p.running ? 'w' : ''); this._setLamp(Ls.flt, k && p.fault ? 'r blink' : '');
    this._setLamp(Ls.mode, !k ? '' : man ? 'a' : 'g', !k ? 'TỰ ĐỘNG/TAY' : man ? 'TAY' : 'TỰ ĐỘNG');
    this._setLamp(Ls.src, !k || !man ? '' : d.ctl === 'local' ? 'a' : 'c', !k || !man ? 'TẠI CHỖ/TỪ XA' : d.ctl === 'local' ? 'TẠI CHỖ' : 'TỪ XA');
    if (Ls.ilk) { this._setLamp(Ls.ilk, I && I.sev === 'bad' ? 'r' : ''); setA(Ls.ilk.el, 'title', I && I.sev === 'bad' ? 'Liên động đang chặn bơm: ' + I.text : 'Không có liên động chặn bơm'); }
  }
  _updPumps(d) {
    const max = this.app.cfg.safety.max_starts_per_h;
    d.pumps.forEach((p, i) => {
      const P = this.PP[i], k = !this.ctx.dead, fs = this._fset(d, i);
      P.g.set(p.f, 1, fs);
      this._pumpLamps(P.lamps, d, i);
      setT(P.chip, !k ? '####' : p.fault ? 'LỖI' : p.running ? 'ĐANG CHẠY' : 'DỪNG'); setC(P.chip, 'h-chip ' + (!k ? 'unk' : p.fault ? 'r' : p.running ? 'g' : 'w') + (this.ctx.stale ? ' q' : ''));
      this._hv(P.R.fs, fs, 1); this._hv(P.R.a, p.amps, 1); this._hv(P.R.kw, p.kw, 2); this._hv(P.R.rh, p.run_h, 1);
      this._hv(P.R.sh, isNum(p.starts_h) ? `${p.starts_h} / ${max}` : p.starts_h, 0, { st: p.starts_h >= max ? 'alarm' : p.starts_h >= max - 1 ? 'warn' : 'ok' });
      this._hv(P.R.st, isNum(p.starts) ? String(p.starts) : p.starts, 0);
    });
    const Q = this.PQ, pl = this._lim('PT-101');
    Q.g.set(d.p1, 2, d.p_set, { lim: pl.st });
    this._hv(Q.R.pset, d.p_set, 2); this._hv(Q.R.err, isNum(d.p1) && isNum(d.p_set) ? d.p1 - d.p_set : undefined, 2);
    this._hv(Q.R.pc, d.p_crit, 2, { lim: this._lim('PL-301').st }); this._hv(Q.R.q, d.q, 1); this._hv(Q.R.kw, d.kw, 2); this._hv(Q.R.kwh, d.kwh, 1);
    const cs = this._ctlState(d);
    setT(Q.ctl, (cs.q ? '? ' : '') + cs.t); setC(Q.ctl, 'h-bigtxt ' + cs.cls + (cs.q ? ' q' : ''));
  }

  // ================= màn 03: chất lượng nước =================
  _buildQuality(host) {
    this.QA = [['cl', 'AIT-201', 'CLO DƯ TỰ DO'], ['ntu', 'AIT-202', 'ĐỘ ĐỤC'], ['ph', 'AIT-203', 'pH']].map(([k, tag, name]) => {
      const A = { k, tag, v: this._hd(INST[tag].u, true), lamp: this._lamp('ĐẠT'), lim: h('p', { class: 'h-qlim' }), warn: h('p', { class: 'h-qlim m' }) };
      A.bar = h('div', { class: 'h-qbar' }, A.zone = h('i', { class: 'h-qz' }), A.ptr = h('b', { class: 'h-qptr' }));
      A.svg = S('svg', { viewBox: '0 0 300 96', class: 'h-spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      A.trendNote = h('small', { class: 'h-cap' }, 'XU HƯỚNG 6 GIỜ');
      A.el = this._pnl(`${tag} · ${name}`, h('div', { class: 'h-qa-top' }, A.v.el, A.lamp.el), A.lim, A.warn, A.bar, A.trendNote, h('div', { class: 'h-sparkw' }, A.svg, h('div', { class: 'h-spk-ax' }), A.sl = h('span', { class: 'h-spl' })),
        h('button', { class: 'h-btn wide', onclick: () => this._fpOpen('inst', tag) }, 'CHI TIẾT THIẾT BỊ ĐO ▸'));
      return A;
    });
    const Z = this.QS = { lamp: this._lamp('DỪNG AN TOÀN'), vlamp: this._lamp('VAN MV-02'), txt: h('p', { class: 'h-qs-t' }), note: h('p', { class: 'h-qlim m' }) };
    Z.reset = h('button', { class: 'h-btn',
      onclick: () => this._askScreen('Xác nhận ĐẶT LẠI DỪNG AN TOÀN? Trạm chỉ chạy lại khi chất lượng nước đã đạt liên tục.', () => this._sendScr('reset_safe_stop', {})) }, 'ĐẶT LẠI DỪNG AN TOÀN');
    Z.cf = h('div', { class: 'h-cf', hidden: true });
    Z.res = h('p', { class: 'h-res' });
    const sp = this._pnl('DỪNG AN TOÀN THEO CHẤT LƯỢNG NƯỚC', h('div', { class: 'h-lamprow' }, Z.lamp.el, Z.vlamp.el), Z.txt, Z.note, h('div', { class: 'h-brow h-narrowrow' }, Z.reset), Z.cf, Z.res);
    host.append(h('div', { class: 'h-grid3' }, ...this.QA.map((A) => A.el)), h('div', { class: 'h-qsafe' }, sp));
  }
  _series(key, t0, t1, n = 160) {
    // trả về [[t...],[v...]] trong cửa sổ, lấy thưa còn khoảng n điểm
    const a = this.app, ts = [], vs = [];
    if (this.where === 'local') {
      const H = a.st.hist.data, T = H.t, V = UI_HIST.has(key) ? a.uiHist?.[key] : H[key];
      if (!V) return null;
      let lo = 0, hi = T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t0) lo = m + 1; else hi = m; }
      const step = Math.max(1, Math.floor((T.length - lo) / n));
      for (let i = lo; i < T.length; i += step) { ts.push(T[i]); vs.push(V[i]); }
      return [ts, vs];
    }
    const pen = PENS.find((p) => p.k === key) || {}, sk = pen.sk || Object.values(INST).find((x) => x.hk === key && x.sk)?.sk;
    if (!sk) return null;
    const S0 = a.server.stations[a.st.sid], m0 = Math.floor(t0 / 60), m1 = Math.floor(t1 / 60), step = Math.max(1, Math.floor((m1 - m0) / n));
    for (let m = m0; m <= m1; m += step) { const r = S0.series.get(m); ts.push(m * 60 + 30); vs.push(r ? r[sk] : NaN); }
    return [ts, vs];
  }
  _spark(svg, key, t0, t1, lo, hi, lines) {
    const W = 300, H = 96, ser = this._series(key, t0, t1);
    const X = (t) => ((t - t0) / (t1 - t0)) * W, Y = (v) => H - 4 - (clamp((v - lo) / (hi - lo), -0.02, 1.02)) * (H - 8);
    const kids = [];
    for (const [v, cls] of lines) kids.push(S('line', { x1: 0, x2: W, y1: Y(v).toFixed(1), y2: Y(v).toFixed(1), class: 'h-spk-l ' + cls }));
    if (ser) {
      let d = '', pen = false;
      for (let i = 0; i < ser[0].length; i++) { const v = ser[1][i]; if (!isNum(v)) { pen = false; continue; } d += (pen ? 'L' : 'M') + X(ser[0][i]).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }
      kids.push(S('path', { d, class: 'h-spk' }));
    }
    svg.replaceChildren(S('rect', { x: 0, y: 0, width: W, height: H, class: 'h-spk-bg' }), ...kids);
    const ax = svg.parentNode?.querySelector('.h-spk-ax'), hrs = Math.round((t1 - t0) / 3600);
    // nhãn giới hạn: đặt trên vạch; vạch sát nhau (< 12 px) thì nhãn sau xuống dưới vạch, vẫn chồng thì gộp
    const px = svg.clientHeight || H, lab = [];
    let bottom = 0;
    for (const [v, cls] of [...lines].sort((p, q) => Y(p[0]) - Y(q[0]))) {
      const y = (Y(v) / H) * px, s = num(v, v < 10 ? 1 : 0);
      if (y - 12 >= bottom) { lab.push({ v, cls, s, dn: false }); bottom = y; } else if (y >= bottom - 0.5) { lab.push({ v, cls, s, dn: true }); bottom = y + 12; } else if (lab.length) lab[lab.length - 1].s += ' / ' + s;
    }
    if (ax) ax.replaceChildren(...lab.map((L) => h('span', { class: 'lv ' + L.cls + (L.dn ? ' dn' : ''), style: `top:${((Y(L.v) / H) * 100).toFixed(1)}%` }, L.s)),
      h('span', { class: 'tl' }, `−${hrs} giờ`), h('span', { class: 'tr' }, 'hiện tại'));
    return Boolean(ser);
  }
  _updQuality(d, force) {
    const now = performance.now(), redraw = force || now - (this._qT || 0) > 1500;
    if (redraw) this._qT = now;
    for (const A of this.QA) {
      const L = this._lim(A.tag), absent = this._absent(A.tag), v = d[A.k];
      const st = this._hv(A.v, v, 2, { absent, lim: L.st });
      const bad = st === 'alarm', ok = st === 'ok' || st === 'warn';
      this._setLamp(A.lamp, bad ? 'r blink' : ok ? 'g' : '', bad ? 'KHÔNG ĐẠT' : ok ? 'ĐẠT QCVN' : st === 'na' ? 'N/A' : '####');
      setT(A.lim, 'QCVN 01-1:2018/BYT: ' + L.qc); setT(A.warn, L.wt);
      const [lo, hi] = L.scale, pos = (x) => (clamp((x - lo) / (hi - lo), 0, 1) * 100).toFixed(1) + '%';
      const z = L.lines.filter((x) => x[1] === 'alarm').map((x) => x[0]);
      const zl = A.k === 'ntu' ? lo : z[0], zh = A.k === 'ntu' ? z[0] : z[1];
      setA(A.zone, 'style', `left:${pos(zl)};width:calc(${pos(zh)} - ${pos(zl)})`);
      setA(A.ptr, 'style', `left:${isNum(v) && !absent && !this.ctx.dead ? pos(v) : '-20px'}`); setC(A.ptr, 'h-qptr ' + st);
      if (redraw) {
        const has = !absent && !this.ctx.dead && this._spark(A.svg, INST[A.tag].hk, d.t - 6 * 3600, Math.max(d.t, 600), lo, hi, L.lines.map(([x, c]) => [x, c]));
        if (!has) { A.svg.replaceChildren(S('rect', { x: 0, y: 0, width: 300, height: 96, class: 'h-spk-bg' })); A.svg.parentNode.querySelector('.h-spk-ax').replaceChildren(); }
        setT(A.sl, absent ? 'Không lắp thiết bị' : this.ctx.dead ? '####' : has ? `${String(lo).replace('.', ',')} – ${String(hi).replace('.', ',')} ${INST[A.tag].u}` : 'Trung tâm không nhận xu hướng chất lượng – chỉ giá trị tức thời');
      }
    }
    const Z = this.QS, a = this.app, local = this.where === 'local', c = this.ctx;
    let ss = false, reason = '', known = !c.dead;
    if (local && known) { const sf = a.st.gw.safety; ss = sf.safe_stop; reason = sf.safe_reason; }
    else if (!local) { const al = d.alarms.find((x) => x.code === 'SAFE_STOP'); ss = Boolean(al); reason = al ? (al.msg.match(/:\s*(.+?) không đạt/)?.[1] ?? '') : ''; }
    this._setLamp(Z.lamp, !known ? '' : ss ? 'r blink' : 'g', !known ? 'DỪNG AN TOÀN: ####' : ss ? 'ĐANG DỪNG AN TOÀN' : 'KHÔNG DỪNG AN TOÀN');
    const vv = d.valve;
    this._setLamp(Z.vlamp, !known || !isNum(vv) ? '' : vv > 0.99 ? 'g' : vv < 0.01 ? 'r' : 'a', !known ? 'MV-02: ####' : !isNum(vv) ? 'MV-02: N/A' : vv > 0.99 ? 'MV-02 MỞ' : vv < 0.01 ? 'MV-02 ĐÓNG' : 'MV-02 ĐANG CHẠY');
    const why = reason ? (reason === 'pH' ? reason : reason[0].toLowerCase() + reason.slice(1)) : 'chất lượng nước';
    setT(Z.txt, !known ? 'HMI-01 mất kết nối với mini PC – không biết trạng thái dừng an toàn.'
      : ss ? `Trạm dừng an toàn do ${why} không đạt QCVN: bơm dừng, van MV-02 đóng để không cấp nước không đạt ra mạng.`
      : 'Chất lượng nước trong giới hạn – trạm cấp nước bình thường.');
    const s = a.cfg.safety;
    const mn = (x) => num(x / 60, 0);
    setT(Z.note, `Khi vượt ngưỡng QCVN liên tục (clo ${mn(s.cl_delay_s)} phút, độ đục ${mn(s.ntu_delay_s)} phút, pH ${mn(s.ph_delay_s)} phút) trạm tự dừng an toàn. `
      + `Chạy lại cần lệnh ĐẶT LẠI sau khi chất lượng đạt liên tục ${mn(s.quality_reset_hold_s)} phút (độ đục < ${num(s.ntu_reset_max, 1)} NTU).`);
    this._syncReset(Z.reset, d);
    this._resLine(Z.res, ['reset_safe_stop']);
  }

  // ================= màn 04: xu hướng =================
  _buildTrend(host) {
    const T = this.TR;
    T.rbtn = [[3600, '1 giờ'], [8 * 3600, '8 giờ'], [86400, '24 giờ']].map(([v, s]) => h('button', { class: 'h-btn sm', onclick: () => { T.range = v; T.last = 0; this.update(true); } }, s));
    T.note = h('span', { class: 'h-tnote' });
    T.cv = h('canvas', { class: 'h-tcv', 'aria-label': 'Biểu đồ xu hướng vận hành' });
    T.cv.addEventListener('pointermove', (e) => { const r = T.cv.getBoundingClientRect(); T.hx = e.clientX - r.left; this._drawTrend(); });
    T.cv.addEventListener('pointerleave', () => { T.hx = null; this._drawTrend(); });
    T.rows = PENS.map((p, i) => {
      const cb = h('input', { type: 'checkbox', checked: !T.hide.has(i), 'aria-label': 'Hiện ' + p.name, onchange: () => { if (cb.checked) T.hide.delete(i); else T.hide.add(i); this._drawTrend(); } });
      const sw = h('i', { class: 'h-tsw' }), v = h('b'), tr = h('tr', { onclick: (e) => { if (e.target !== cb) { T.sel = i; this._drawTrend(); } } },
        h('td', {}, cb), h('td', {}, sw), h('td', { class: 'n' }, p.name), h('td', { class: 'v' }, v), h('td', {}, p.u), h('td', { class: 'r' }, `${p.lo} – ${p.hi}`));
      return { tr, sw, v, cb };
    });
    T.leg = h('table', { class: 'h-tleg' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Bút'), h('th', {}, 'Tên tín hiệu'), h('th', {}, 'Giá trị'), h('th', {}, 'Đơn vị'), h('th', {}, 'Dải'))), h('tbody', {}, ...T.rows.map((r) => r.tr)));
    T.wrap = h('div', { class: 'h-tplot' }, T.cv);
    host.append(h('div', { class: 'h-tbar' }, h('small', { class: 'h-cap' }, 'KHOẢNG THỜI GIAN'), h('div', { class: 'h-seg' }, ...T.rbtn), T.note),
      h('div', { class: 'h-tbody' }, T.wrap, h('div', { class: 'h-tlegw' }, T.leg, h('p', { class: 'h-qlim m' }, 'Nhấp một dòng để chọn thang trục tung; rê chuột trên biểu đồ để đọc giá trị theo thời gian.'))));
  }
  _trendData() {
    const a = this.app, T = this.TR, t1 = Math.max(a.net.t, 600), t0 = t1 - T.range;
    if (this.where === 'local') {
      const H = a.st.hist.data;
      let lo = 0, hi = H.t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H.t[m] < t0) lo = m + 1; else hi = m; }
      return { t0, t1, i0: lo, ts: H.t, cols: PENS.map((p) => (p.ui ? a.uiHist?.[p.k] : H[p.k])), late: null };
    }
    const S0 = a.server.stations[a.st.sid], ts = [], cols = PENS.map(() => []), late = [];
    for (let m = Math.floor(t0 / 60); m <= Math.floor(a.net.t / 60); m++) {
      const r = S0.series.get(m); ts.push(m * 60 + 30); late.push(Boolean(r && r.late));
      PENS.forEach((p, i) => cols[i].push(r && p.sk ? r[p.sk] : NaN));
    }
    return { t0, t1, i0: 0, ts, cols, late };
  }
  _drawTrend() {
    const T = this.TR, cv = T.cv, W = T.wrap.clientWidth, H = T.wrap.clientHeight;
    if (!W || !H || !this.visible || this.scr !== 'trend') return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const ctx = cv.getContext('2d'), cs = getComputedStyle(this.root), css = (k) => cs.getPropertyValue(k).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const D = this._trendData(), cols = PEN_COL[this.skin], remote = this.where === 'remote';
    const pl = 52, pr = 14, pt = 12, pb = 26, w = W - pl - pr, hgt = H - pt - pb;
    ctx.fillStyle = css('--h-tbg'); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css('--h-tplot'); ctx.fillRect(pl, pt, w, hgt);
    const X = (t) => pl + ((t - D.t0) / (D.t1 - D.t0)) * w;
    // lưới ngang theo vạch chia "đẹp" (1, 2, 5 × 10^n) của bút đang chọn
    const sp = PENS[T.sel], span = sp.hi - sp.lo, raw = span / 6, p10 = 10 ** Math.floor(Math.log10(raw)), m = raw / p10;
    const tick = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p10, tnd = tick < 1 ? 1 : 0, Ys = (v) => pt + hgt - ((v - sp.lo) / span) * hgt;
    const ticks = []; for (let v = Math.ceil(sp.lo / tick - 1e-9) * tick; v <= sp.hi + 1e-9; v += tick) ticks.push(v);
    ctx.strokeStyle = css('--h-tgrid'); ctx.lineWidth = 1; ctx.font = `11px ${css('--h-f')}`; ctx.fillStyle = css('--h-ink2');
    for (const v of ticks) { const y = Math.round(Ys(v)) + 0.5; ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + w, y); ctx.stroke(); }
    const step = T.range <= 3600 ? 600 : T.range <= 8 * 3600 ? 3600 : 3 * 3600;
    ctx.textAlign = 'center';
    for (let t = Math.ceil(D.t0 / step) * step; t <= D.t1; t += step) {
      const x = Math.round(X(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, pt); ctx.lineTo(x, pt + hgt); ctx.stroke();
      if (t >= 0) ctx.fillText(t % 86400 === 0 ? `N${Math.floor(t / 86400) + 1} 00:00` : fmtHM(t), x, pt + hgt + 16);
    }
    // trục tung theo bút đang chọn
    ctx.textAlign = 'right';
    for (const v of ticks) ctx.fillText(num(v, tnd), pl - 8, Ys(v) + 4);
    ctx.fillStyle = cols[T.sel]; ctx.fillRect(4, pt, 4, hgt);
    // vạch giới hạn áp lực
    const s = this.app.cfg.service, Yp = (v, p) => pt + hgt - clamp((v - p.lo) / (p.hi - p.lo), 0, 1) * hgt;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = css('--h-alarm');
    for (const v of [s.p_crit_min_bar, s.p_out_max_bar]) { const y = Math.round(Yp(v, PENS[0])) + 0.5; ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + w, y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = css('--h-ink2'); ctx.textAlign = 'left';
    ctx.fillText(`${num(s.p_out_max_bar, 1)} bar`, pl + 4, Yp(s.p_out_max_bar, PENS[0]) - 4); ctx.fillText(`${num(s.p_crit_min_bar, 1)} bar`, pl + 4, Yp(s.p_crit_min_bar, PENS[0]) - 4);
    // các bút: gom theo cột điểm ảnh (min/max) để không mất đỉnh
    ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, w, hgt); ctx.clip();
    const n = D.ts.length;
    // bút đang chọn vẽ sau cùng (nằm trên) – áp ra mạng thường trùng PT-101 khi MV-02 mở
    [...PENS.keys()].filter((k) => k !== T.sel).concat(T.sel).forEach((k) => {
      const p = PENS[k];
      if (T.hide.has(k)) return;
      const V = D.cols[k]; if (!V) return;
      ctx.strokeStyle = cols[k]; ctx.lineWidth = k === T.sel ? 2.2 : 1.6; ctx.setLineDash(p.dash || []);
      ctx.beginPath();
      let pen = false, cx = -1, mn = 0, mx = 0;
      const flush = () => { if (cx < 0) return; const y1 = Yp(mn, p), y2 = Yp(mx, p); if (!pen) { ctx.moveTo(cx, y1); pen = true; } else ctx.lineTo(cx, y1); if (y2 !== y1) ctx.lineTo(cx, y2); };
      for (let i = D.i0; i < n; i++) {
        const v = V[i];
        if (!isNum(v)) { flush(); cx = -1; pen = false; continue; }
        const x = Math.round(X(D.ts[i]));
        if (x !== cx) { flush(); cx = x; mn = mx = v; } else { if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      flush(); ctx.stroke();
    });
    ctx.setLineDash([]);
    if (D.late && D.late.some(Boolean)) {
      ctx.fillStyle = css('--h-latebg');
      for (let i = 0; i < n; i++) if (D.late[i]) ctx.fillRect(X(D.ts[i]) - 1, pt, Math.max(2, w / Math.max(1, n)), hgt);
    }
    ctx.restore();
    // thước đọc
    let iAt = -1;
    if (T.hx !== null && T.hx >= pl && T.hx <= pl + w) {
      ctx.strokeStyle = css('--h-ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(T.hx) + 0.5, pt); ctx.lineTo(Math.round(T.hx) + 0.5, pt + hgt); ctx.stroke();
      const tAt = D.t0 + ((T.hx - pl) / w) * (D.t1 - D.t0);
      let lo = D.i0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D.ts[m] < tAt) lo = m + 1; else hi = m; }
      iAt = lo < n ? lo : -1;
      if (iAt >= 0) { ctx.fillStyle = css('--h-ink'); ctx.textAlign = T.hx > pl + w - 80 ? 'right' : 'left'; ctx.fillText(fmtHM(D.ts[iAt]), T.hx + (T.hx > pl + w - 80 ? -6 : 6), pt + 14); }
    }
    ctx.strokeStyle = css('--h-tframe'); ctx.lineWidth = 1; ctx.strokeRect(pl + 0.5, pt + 0.5, w - 1, hgt - 1);
    // chú giải
    T.rows.forEach((r, k) => {
      r.sw.style.background = cols[k]; r.sw.className = 'h-tsw' + (PENS[k].dash ? ' dash' : '');
      r.tr.className = (k === T.sel ? 'sel' : '') + (T.hide.has(k) ? ' off' : '');
      const V = D.cols[k];
      let i = iAt >= 0 ? iAt : n - 1;
      if (iAt < 0 && V) { const stop = Math.max(D.i0, n - 200); while (i > stop && !isNum(V[i])) i--; }
      const v = V && i >= 0 ? V[i] : undefined;
      const na = remote && !PENS[k].sk;
      setT(r.v, na ? 'N/A' : this.ctx.dead && iAt < 0 ? '####' : isNum(v) ? num(v, PENS[k].nd) : '–');
    });
  }
  _updTrend(d, force) {
    const T = this.TR, now = performance.now();
    if (!force && now - T.last < 700) return;
    T.last = now;
    T.rbtn.forEach((b, i) => b.classList.toggle('on', [3600, 8 * 3600, 86400][i] === T.range));
    setT(T.note, this.where === 'remote'
      ? 'TRUNG TÂM: chuỗi theo phút máy chủ đã nhận qua MQTT (áp đầu ra, lưu lượng, mức, công suất). PT-102, áp ra mạng, áp đặt và áp điểm bất lợi không gửi về trung tâm; dải tô nền = dữ liệu phát lại sau đồng bộ.'
      : 'TẠI TRẠM: lịch sử gateway, mẫu 10 s. PT-101/PT-102 đo áp ống góp trước van MV-02; “áp ra mạng” là áp sau MV-02 (về 0 khi van đóng).');
    this._drawTrend();
  }

  // ================= màn 05: báo động =================
  _buildAlarms(host) {
    this.AL = { sum: h('span', { class: 'h-alsum' }), all: h('button', { class: 'h-btn warn', onclick: () => this._ackAll() }, 'XÁC NHẬN TẤT CẢ'),
      body: h('tbody'), hist: h('tbody'), note: h('p', { class: 'h-qlim m' }) };
    const head = (...c) => h('thead', {}, h('tr', {}, ...c.map((x) => h('th', {}, x))));
    host.append(h('div', { class: 'h-scroll' },
      this._pnl('BÁO ĐỘNG ĐANG HOẠT ĐỘNG', h('div', { class: 'h-tbar' }, this.AL.sum, h('span', { class: 'h-sbsp' }), this.AL.all),
        h('div', { class: 'h-tblw' }, h('table', { class: 'h-tbl h-altbl' }, head('Thời gian', 'Mã', 'Mô tả', 'Mức', 'Trạng thái', ''), this.AL.body)), this.AL.note),
      this._pnl('LỊCH SỬ BÁO ĐỘNG · 50 SỰ KIỆN GẦN NHẤT', h('div', { class: 'h-tblw' }, h('table', { class: 'h-tbl' }, head('Thời gian', 'Sự kiện', 'Mã', 'Mô tả', 'Mức'), this.AL.hist)))));
  }
  _sorted(list) { return [...list].sort((x, y) => (SEV_ORDER[x.sev] - SEV_ORDER[y.sev]) || (Number(x.acked) - Number(y.acked)) || (y.t - x.t)); }
  _ackable(x) { return !x.acked && !x.sys && x.code !== 'STATION_OFFLINE'; }
  /** Báo động hiển thị: khi mini PC ngừng, HMI-01 chỉ còn báo động hệ thống "mất kết nối" (báo động của gateway không đọc được). */
  _alarms(d) {
    if (!d.dead) return d.alarms;
    const gd = this.app.st.gw_dead;
    return [{ code: 'COMM_MPC-01', sev: 'critical', t: gd.t0, acked: false, sys: true, msg: 'HMI-01 mất kết nối với mini PC MPC-01 (edge gateway GW-01) – không đọc được dữ liệu và báo động của trạm' }];
  }
  _ack(code) { if (ackAlarm(this.app, this.where, code)) this.update(true); }
  _ackAll() {
    const list = this._alarms(this._d).filter((x) => this._ackable(x));
    for (const x of list) if (!ackAlarm(this.app, this.where, x.code)) break;
    this.update(true);
  }
  _updAlarms(d, force) {
    const a = this.app, al = this._sorted(this._alarms(d)), un = al.filter((x) => this._ackable(x)).length;
    setT(this.AL.sum, `Đang hoạt động: ${al.length} · Chưa xác nhận: ${un}`);
    setD(this.AL.all, !un || d.dead);
    const hist = this.where === 'local' ? a.st.gw.alarms.history : a.server.alarm_history.filter((x) => x.station === a.st.sid);
    if (this._changed('al', al.map((x) => x.code + x.acked + x.t).join(',') + this.where + d.dead, force)) {
      this.AL.body.replaceChildren(...(al.length ? al.map((x) => h('tr', { class: 'sev-' + x.sev + (x.acked ? ' acked' : ' unack') },
        h('td', { class: 'mono' }, tShort(x.t)), h('td', { class: 'mono b' }, x.code), h('td', { class: 'msg' }, viTxt(x.msg) || '–'), h('td', {}, h('span', { class: 'h-sev ' + x.sev }, SEV_TXT[x.sev] || x.sev)),
        h('td', {}, x.sys || x.code === 'STATION_OFFLINE' ? 'tự xóa khi có kết nối' : x.acked ? 'ĐÃ XÁC NHẬN' : 'CHƯA XÁC NHẬN'),
        h('td', {}, this._ackable(x) ? h('button', { class: 'h-btn sm', disabled: d.dead, onclick: () => this._ack(x.code) }, 'XÁC NHẬN') : ''))) : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Không có báo động đang hoạt động.'))]));
      setT(this.AL.note, this.where === 'local' ? 'Tại trạm: xác nhận ghi ngay vào gateway. Báo động sự kiện (ví dụ lệnh bị từ chối) tự xóa khi xác nhận.'
        : 'Trung tâm: nút XÁC NHẬN gửi lệnh “xác nhận báo động” qua máy chủ; mất kết nối thì lệnh xếp hàng.');
    }
    if (this._changed('alh', hist.length + this.where, force)) {
      const rows = hist.slice(-50).reverse();
      this.AL.hist.replaceChildren(...(rows.length ? rows.map((x) => h('tr', { class: x.action === 'raise' ? 'sev-' + x.sev : 'clr' },
        h('td', { class: 'mono' }, tShort(x.t)), h('td', {}, x.action === 'raise' ? 'XUẤT HIỆN' : 'HẾT'), h('td', { class: 'mono b' }, x.code), h('td', { class: 'msg' }, viTxt(x.msg) || '–'),
        h('td', {}, h('span', { class: 'h-sev ' + x.sev }, SEV_TXT[x.sev] || x.sev)))) : [h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'Chưa có sự kiện báo động.'))]));
    }
  }

  // ================= màn 06: nhật ký =================
  _buildLog(host) {
    this.LG = { cmd: h('tbody'), ev: h('tbody'), note: h('p', { class: 'h-qlim m' }) };
    const head = (...c) => h('thead', {}, h('tr', {}, ...c.map((x) => h('th', {}, x))));
    host.append(h('div', { class: 'h-scroll' },
      this._pnl('NHẬT KÝ LỆNH ĐIỀU KHIỂN', this.LG.note, h('div', { class: 'h-tblw' }, h('table', { class: 'h-tbl' }, head('Thời gian', 'Mã lệnh', 'Loại lệnh', 'Kết quả', 'Ghi chú'), this.LG.cmd))),
      this._pnl('NHẬT KÝ SỰ KIỆN · 40 DÒNG GẦN NHẤT', h('div', { class: 'h-tblw' }, h('table', { class: 'h-tbl' }, head('Thời gian', 'Mức', 'Nội dung'), this.LG.ev)))));
  }
  _updLog(d, force) {
    const a = this.app, local = this.where === 'local';
    const cmds = commandLog(a, this.where, 30);
    if (this._changed('lc', cmds.map((c) => c.id + c.status).join(',') + this.where, force)) {
      this.LG.cmd.replaceChildren(...(cmds.length ? cmds.map((c) => { const [cls, txt] = this._cmdSt(c); return h('tr', {},
        h('td', { class: 'mono' }, tShort(c.t)), h('td', { class: 'mono b' }, c.id), h('td', { title: c.type || '' }, c.type ? cmdName(c.type) : '–'), h('td', {}, h('span', { class: 'h-st ' + cls }, txt.toUpperCase())), h('td', { class: 'msg' }, viTxt(c.reason))); })
        : [h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'Chưa có lệnh.'))]));
      setT(this.LG.note, local ? 'Lệnh từ HMI-01 (mã L…) đi thẳng vào gateway, không hết hạn. Lệnh từ trung tâm (mã C…) cũng được ghi lại khi trạm thực hiện.'
        : 'Lệnh từ trung tâm (mã C…) đi qua máy chủ: “đã gửi” → trạm xác nhận “đã thực hiện / từ chối / hết hạn”. Mất kết nối: lệnh xếp hàng và hết hạn sau 60 s.');
    }
    const logs = local ? a.st.gw.logs : a.server.logs.filter((x) => x.station === a.st.sid);
    if (this._changed('le', logs.length + this.where, force)) {
      const rows = logs.slice(-40).reverse(), LV = { info: 'THÔNG TIN', warning: 'CẢNH BÁO', alarm: 'BÁO ĐỘNG', safety: 'AN TOÀN', critical: 'KHẨN' };
      this.LG.ev.replaceChildren(...(rows.length ? rows.map((x) => h('tr', { class: 'lv-' + x.level }, h('td', { class: 'mono' }, tShort(x.t)),
        h('td', {}, h('span', { class: 'h-sev ' + ({ safety: 'alarm' }[x.level] || x.level) }, LV[x.level] || x.level)), h('td', { class: 'msg' }, viTxt(x.text))))
        : [h('tr', {}, h('td', { colspan: 3, class: 'empty' }, 'Chưa có sự kiện.'))]));
    }
  }

  // ================= màn 07: thông số =================
  _buildParams(host) { this.PRM = h('div', { class: 'h-grid3 h-prm' }); host.append(h('div', { class: 'h-scroll' }, this.PRM)); }
  _updParams(d, force) {
    const a = this.app, c = a.cfg, s = c.safety, q = c.quality_limits, sv = c.service, local = this.where === 'local';
    const P = (local ? a.st.gw.script.params : c.script.params), sc = this._script(), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);
    const key = [sc.v, isNum(d.p_set) ? d.p_set.toFixed(2) : '-', this.where, d.dead].join('|');
    if (!this._changed('prm', key, force)) return;
    const tbl = (title, rows) => this._pnl(title, h('table', { class: 'h-tbl h-kv' }, h('tbody', {}, ...rows.map(([k, v, u]) => h('tr', {}, h('td', {}, k), h('td', { class: /[a-zà-ỹ]{2}/i.test(v) ? 'num t' : 'num' }, v), h('td', { class: 'u' }, u || ''))))));
    this.PRM.replaceChildren(
      tbl('ÁP LỰC', [['Áp đặt hiện tại P_set', d.dead ? '####' : isNum(d.p_set) ? f2(d.p_set) : 'N/A', 'bar'], ['Dải áp đặt của kịch bản', `${f1(P.pressure.p_set_min_bar)} – ${f1(P.pressure.p_set_max_bar)}`, 'bar'],
        ['Mục tiêu áp điểm bất lợi', f1(P.pressure.p_crit_target_bar), 'bar'], ['Áp điểm bất lợi tối thiểu (dịch vụ)', f1(sv.p_crit_min_bar), 'bar'], ['Áp đầu ra tối đa (dịch vụ)', f1(sv.p_out_max_bar), 'bar'],
        ['Cắt bơm do áp rất cao PSHH', `${f1(s.p_highhigh_bar)} (trễ ${num(s.p_hh_delay_s, 0)} s)`, 'bar'], ['Cảnh báo áp thấp / rất thấp', `${f1(s.p_low_bar)} / ${f1(s.p_lowlow_bar)}`, 'bar']]),
      tbl('MỨC BỂ T-01', [['Mức cao (cảnh báo)', f1(s.level_high_m), 'm'], ['Bắt đầu tiết kiệm nước', f1(P.level.conserve_m), 'm'], ['Dừng bơm / chạy lại', `${f1(P.level.stop_m)} / ${f1(P.level.restart_m)}`, 'm'],
        ['Mức rất thấp (lớp an toàn)', f1(s.level_ll_m), 'm'], ['Phao cạn LSLL-101 (mạch cứng)', f2(s.float_lsll_m), 'm'], ['Diện tích / chiều cao bể', `${num(c.tank.area_m2, 0)} m² · ${f1(c.tank.height_m)}`, 'm']]),
      tbl('CHẤT LƯỢNG NƯỚC (QCVN 01-1:2018/BYT)', [['Clo dư', `${f1(q.cl_min)} – ${f1(q.cl_max)}`, 'mg/L'], ['Clo dư – ngưỡng cảnh báo', `${f1(s.cl_warn_low)} – ${f1(s.cl_warn_high)}`, 'mg/L'],
        ['Độ đục tối đa / cảnh báo', `${f1(q.ntu_max)} / ${f1(s.ntu_warn)}`, 'NTU'],
        ['pH', `${f1(q.ph_min)} – ${f1(q.ph_max)}`, ''], ['pH – ngưỡng cảnh báo', `${f1(s.ph_warn_low)} – ${f1(s.ph_warn_high)}`, ''], ['Đặt lại dừng an toàn sau', num(s.quality_reset_hold_s / 60, 0), 'phút']]),
      tbl('BƠM VÀ BIẾN TẦN', [['Dải tần số', `${num(c.pump_model.f_min_hz, 0)} – ${num(c.pump_model.f_max_hz, 0)}`, 'Hz'], ['Số lần khởi động tối đa', String(s.max_starts_per_h), 'lần/giờ'],
        ['Thời gian dừng tối thiểu', num(s.min_off_s, 0), 's'],
        ['Ghép bơm 2 khi f ≥', f1(P.staging.f_on_hz), 'Hz'], ['Tách bơm 2 khi f ≤', f1(P.staging.f_off_hz), 'Hz'], ['Luân phiên bơm chính sau', num(P.alternation.runtime_h, 0), 'giờ chạy']]),
      tbl('ĐIỀU KHIỂN TAY', [['Quyền TAY từ xa (tự gia hạn mỗi lệnh)', num(c.gateway.manual_lease_s / 60, 0), 'phút'], ['Hạn của một lệnh từ xa', num(c.gateway.manual_cmd_ttl_s, 0), 's'],
        ['Ưu tiên quyền', 'tại chỗ > từ xa', ''], ['Mất kết nối khi đang TAY từ xa', 'về TỰ ĐỘNG', ''], ['Lớp an toàn', 'luôn ưu tiên', '']]),
      tbl('KỊCH BẢN VÀ DỰ PHÒNG', [['Kịch bản đang chạy', d.dead ? '####' : `v${sc.v}`, ''], ['Chiến lược', d.dead ? '####' : sc.s, ''], ['Biên áp khi mất kết nối', '+' + f1(P.offline.margin_bar), 'bar'],
        ['PID nội biến tần khi mini PC treo', c.hardware.VFD_PID_fallback ? f1(c.fallback.p_set_bar) : 'không lắp', c.hardware.VFD_PID_fallback ? 'bar' : ''], ['Rơ-le watchdog nhả sau', num(c.fallback.watchdog_s, 0), 's'],
        ['Nguồn thông số', local ? 'gateway GW-01' : 'cấu hình máy chủ', '']]));
  }

  // ================= faceplate =================
  _fpOpen(kind, arg) {
    const id = kind + ':' + arg;
    let fp = this.fps.find((f) => f.id === id);
    if (fp) { this._fpFront(fp); return fp; }
    fp = this['_fp_' + kind](arg);
    fp.id = id;
    const x = h('button', { class: 'h-fp-x', 'aria-label': 'Đóng bảng ' + fp.title, title: 'Đóng', onclick: () => this._fpClose(fp) }, '×');
    fp.bar = h('div', { class: 'h-fp-t' }, h('i', { class: 'h-fp-ic' }), h('b', {}, fp.title), x);
    fp.cf = h('div', { class: 'h-cf', hidden: true });
    fp.el = h('section', { class: 'h-fp', role: 'dialog', tabindex: '-1', 'aria-label': fp.title, style: `width:${fp.w}px` }, fp.bar, h('div', { class: 'h-fp-b' }, fp.body, fp.cf));
    fp.el.addEventListener('pointerdown', () => this._fpFront(fp));
    this.root.append(fp.el);
    this.fps.push(fp);
    while (this.fps.length > (this.narrow ? 1 : 2)) this._fpClose(this.fps[0]);
    this._fpPlace(fp); this._drag(fp); this._fpFront(fp);
    fp.update(this._d || stationData(this.app, this.where), true);
    this._fpClamp(fp);
    fp.el.focus({ preventScroll: true });
    if (this.scr === 'ov') this._updOverview(this._d);
    return fp;
  }
  _fpClose(fp) {
    const had = fp.el.contains(document.activeElement);
    this._cancel(fp); fp.el.remove(); this.fps = this.fps.filter((f) => f !== fp);
    if (had && this.fps.length) this.fps[this.fps.length - 1].el.focus({ preventScroll: true });
    if (this.visible && this.scr === 'ov' && this._d) this._updOverview(this._d);
  }
  _fpFront(fp) { fp.el.style.zIndex = String(++this._z); }
  // bảng đầu tiên đặt sát mép trái nếu thiết bị vừa nhấp nằm ngoài vùng đó (không che thiết bị), ngược lại sát mép phải;
  // bảng thứ hai đặt ở mép đối diện, khung hẹp thì xếp chồng lệch
  _fpPlace(fp) {
    const R = this.root.getBoundingClientRect(), A = this.area.getBoundingClientRect(), w = Math.min(fp.w, R.width - 16);
    const others = this.fps.filter((f) => f !== fp), ax = (this._ax ?? R.right) - R.left;
    this._ax = null;
    let left = ax > w + 24 ? 12 : R.width - w - 12, top = A.top - R.top + 8;
    if (others.length) {
      const o = others[0].el, ol = o.offsetLeft, onLeft = ol + o.offsetWidth / 2 < R.width / 2;
      left = onLeft ? R.width - w - 12 : 12;
      if (left < ol + o.offsetWidth + 6 && left + w > ol - 6) { left = ol + 28; top = o.offsetTop + 28; } else top = o.offsetTop;
    }
    fp.el.style.left = clamp(left, 8, Math.max(8, R.width - w - 8)) + 'px'; fp.el.style.top = Math.max(0, top) + 'px';
  }
  _fpClamp(fp) {
    if (this.narrow) return;
    // giữ faceplate dưới dòng báo động / dải trạng thái, trong khung gốc
    const W = this.root.clientWidth, H = this.root.clientHeight, el = fp.el, top0 = this.area.offsetTop + 4;
    el.style.maxHeight = Math.max(200, H - top0 - 4) + 'px';
    el.style.left = clamp(el.offsetLeft, 4, Math.max(4, W - el.offsetWidth - 4)) + 'px';
    el.style.top = clamp(el.offsetTop, top0, Math.max(top0, H - el.offsetHeight - 4)) + 'px';
  }
  _drag(fp) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    fp.bar.addEventListener('pointerdown', (e) => {
      if (this.narrow || e.target.closest('button')) return;
      on = true; sx = e.clientX; sy = e.clientY; ox = fp.el.offsetLeft; oy = fp.el.offsetTop; fp.bar.setPointerCapture(e.pointerId); e.preventDefault();
    });
    fp.bar.addEventListener('pointermove', (e) => {
      if (!on) return;
      const W = this.root.clientWidth, H = this.root.clientHeight, top0 = this.area.offsetTop;
      fp.el.style.left = clamp(ox + e.clientX - sx, 0, W - fp.el.offsetWidth) + 'px'; fp.el.style.top = clamp(oy + e.clientY - sy, top0, Math.max(top0, H - 36)) + 'px';
    });
    const end = (e) => { if (on) { on = false; try { fp.bar.releasePointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ } } };
    fp.bar.addEventListener('pointerup', end); fp.bar.addEventListener('pointercancel', end);
  }
  /** Xác nhận hai bước như HMI thật: hiện câu hỏi, chỉ thực hiện khi bấm THỰC HIỆN. */
  _ask(fp, text, fn) {
    this._cancel(fp);
    const ok = h('button', { class: 'h-btn go', onclick: () => { this._cancel(fp); fn(); fp.el?.focus({ preventScroll: true }); } }, 'THỰC HIỆN');
    fp.cf.replaceChildren(h('p', {}, h('b', { class: 'h-cf-ic' }, '?'), text), h('div', { class: 'h-brow' }, ok, h('button', { class: 'h-btn', onclick: () => this._cancel(fp) }, 'HỦY')));
    fp.cf.hidden = false; fp.cfT = setTimeout(() => this._cancel(fp), 15000);
    ok.focus({ preventScroll: true });
    // chỉ cuộn bên trong faceplate (hoặc màn hình chứa nó) – không bao giờ cuộn gốc HMI
    if (fp.el) { this._fpClamp(fp); const b = fp.el.querySelector('.h-fp-b'); b.scrollTop = b.scrollHeight; } else {
      const sc = fp.cf.closest('.h-scr');
      if (sc) { const r = fp.cf.getBoundingClientRect(), R = sc.getBoundingClientRect(); if (r.bottom > R.bottom - 6) sc.scrollTop += r.bottom - R.bottom + 10; }
    }
  }
  _cancel(fp) {
    clearTimeout(fp.cfT);
    if (!fp.cf) return;
    const was = !fp.cf.hidden;
    fp.cf.hidden = true; fp.cf.replaceChildren();
    if (was && fp.el?.isConnected) this._fpClamp(fp);
  }
  _askScreen(text, fn) { this._ask(this.QS, text, fn); }
  _send(fp, type, args) {
    fp.last = sendCommand(this.app, this.where, type, args);
    if (this.where === 'remote' && type === 'set_mode') this._pend = args.mode === 'auto' ? null : { id: fp.last.id };
  }
  _sendScr(type, args) { this.QS.last = sendCommand(this.app, this.where, type, args); }
  /** [lớp màu, chữ] kết quả lệnh; lệnh hợp lệ nhưng không làm gì (ví dụ đặt lại khi không dừng an toàn) → trung tính. */
  _cmdSt(c) { return c.status === 'ok' && NOOP.test(c.reason || '') ? ['off', 'không thay đổi'] : CMD_STATUS[c.status] || ['off', c.status]; }
  /** Dòng kết quả lệnh cuối (lọc theo loại lệnh và điều kiện thêm); trả về lệnh đó. */
  _resLine(el, types, pred = null) {
    const c = commandLog(this.app, this.where, 20).find((x) => (!types || types.includes(x.type)) && (!pred || pred(x)));
    if (!c) { setT(el, 'Lệnh cuối: chưa có'); setC(el, 'h-res'); return null; }
    const [cls, txt] = this._cmdSt(c);
    setT(el, `Lệnh cuối ${tShort(c.t)} · ${c.id} ${cmdName(c.type)}: ${txt}${c.reason ? ' – ' + viTxt(c.reason) : ''}`); setC(el, 'h-res ' + cls);
    return c;
  }
  /**
   * Trung tâm: lệnh chuyển TAY đã gửi (hoặc trạm vừa xác nhận) nhưng bản tin trạm (10 s) vẫn báo TỰ ĐỘNG → câu báo chờ; ngược lại null.
   * Trong lúc chờ không cho bấm TAY lần nữa.
   */
  _pendManual(d) {
    if (!this.ctx.remote || d.dead || d.stale || d.ctl !== 'auto') return null;
    const S0 = this.app.server.stations[this.app.st.sid];
    const q = Object.values(S0.pending).find((p) => p.cmd.type === 'set_mode' && (p.cmd.args.mode ?? 'manual') !== 'auto');
    const id = q?.cmd.id ?? this._pend?.id;
    const c = id ? commandLog(this.app, 'remote', 30).find((x) => x.id === id) : null;
    if (c?.status === 'queued') return `Đã gửi lệnh TAY ${id} qua MQTT – chờ trạm xác nhận và bản tin trạm (10 s).`;
    if (c?.status === 'ok' && d.t - c.t <= 25) return `Trạm đã xác nhận lệnh TAY ${id} – chờ bản tin trạm (10 s) để cập nhật trạng thái trên SCADA.`;
    this._pend = null;
    return null;
  }
  /** Lý do không ra lệnh được / cảnh báo quyền – chung cho các faceplate (station: câu riêng của bảng chế độ trạm). */
  _authNote(d, station = false) {
    const local = this.where === 'local', g = this.app.cfg.gateway, ttl = num(g.manual_cmd_ttl_s, 0);
    if (d.dead) return ['bad', 'HMI-01 mất kết nối với mini PC MPC-01 – không gửi được lệnh. ' + viNum(this.app.st.gw_dead.note()) + '.'];
    if (!local && d.stale) {
      return ['warn', `Mất kết nối với trạm – trạng thái đang hiện là bản tin cuối lúc ${this._lastHM(d)}. Trạm đang TAY từ xa sẽ tự về TỰ ĐỘNG khi mất kết nối; `
        + `lệnh từ trung tâm chỉ xếp hàng ở máy chủ và hết hạn sau ${ttl} s nếu trạm chưa nhận.`];
    }
    if (this._wait) return ['info', this._wait];
    if (d.ctl === 'auto') {
      return ['info', station ? 'Trạm TỰ ĐỘNG: kịch bản điều khiển bơm; lớp an toàn luôn ưu tiên. Luân phiên bơm chỉ dùng ở TỰ ĐỘNG.'
        : 'Trạm đang TỰ ĐỘNG theo kịch bản – nhấn TAY để điều khiển bơm và van bằng tay.'];
    }
    if (!local && d.ctl === 'local') return ['warn', 'Quyền đang ở TẠI CHỖ – mọi lệnh từ trung tâm sẽ bị trạm từ chối (tại chỗ ưu tiên).'];
    if (local && d.ctl === 'remote') return ['warn', 'Trung tâm đang điều khiển tay – thao tác tại HMI-01 sẽ giành quyền (tại chỗ ưu tiên).'];
    if (!local) {
      const ls = isNum(d.lease_s) ? ` Quyền TAY còn ${d.lease_est ? '≈ ' : ''}${fmtLease(d.lease_s)}, mỗi lệnh gia hạn.` : '';
      return ['info', `Điều khiển TAY từ xa: mỗi lệnh có hạn ${ttl} s, quyền tự hủy khi mất kết nối.${ls} Lớp an toàn vẫn ưu tiên.`];
    }
    return ['info', 'Điều khiển TAY tại chỗ – lệnh vẫn qua lớp an toàn: liên động, giới hạn áp cao, số lần khởi động.'];
  }
  _modeBtns(fp) {
    const bA = h('button', { class: 'h-btn', onclick: () => this._ask(fp, 'Xác nhận chuyển trạm về TỰ ĐỘNG theo kịch bản?', () => this._send(fp, 'set_mode', { mode: 'auto' })) }, 'TỰ ĐỘNG');
    const bM = h('button', { class: 'h-btn', onclick: () => this._ask(fp, `Xác nhận chuyển trạm sang TAY (${this.where === 'local' ? 'tại chỗ' : 'từ xa, quyền có hạn'})?`, () => this._send(fp, 'set_mode', { mode: 'manual' })) }, 'TAY');
    return { bA, bM, el: h('div', { class: 'h-brow' }, bA, bM) };
  }
  _syncModeBtns(M, d) {
    const man = d.ctl !== 'auto', q = this.ctx.stale ? ' q' : '';
    setD(M.bA, d.dead || !man); setD(M.bM, d.dead || (man && d.ctl === this.where) || Boolean(this._wait));
    setC(M.bA, 'h-btn' + (!d.dead && !man ? ' sel' + q : '')); setC(M.bM, 'h-btn' + (!d.dead && man ? ' sel man' + q : ''));
    setA(M.bM, 'title', this._wait ? 'Đang chờ bản tin trạm xác nhận chế độ TAY' : 'Chuyển trạm sang điều khiển TAY');
  }
  /** Nút ĐẶT LẠI DỪNG AN TOÀN: tại trạm chỉ bật khi dừng an toàn/khóa đã chốt; trung tâm bật khi đã nhận báo động SAFE_STOP/LOCKOUT. */
  _syncReset(btn, d) {
    const remote = this.ctx.remote, need = !d.dead && (remote ? d.alarms.some((x) => x.code === 'SAFE_STOP' || x.code === 'LOCKOUT') : needsReset(this.app));
    setD(btn, !need); setC(btn, 'h-btn' + (need ? ' warn' : ''));
    setA(btn, 'title', d.dead ? 'Mini PC ngừng – không gửi được lệnh' : need ? (remote ? 'Gửi lệnh đặt lại dừng an toàn / mở khóa qua máy chủ' : 'Đặt lại dừng an toàn / mở khóa bảo vệ áp lực')
      : remote ? 'Trung tâm chưa nhận báo động dừng an toàn hay khóa trạm – không cần đặt lại' : 'Trạm không ở trạng thái dừng an toàn hay khóa – không cần đặt lại');
  }
  _fp_pump(i) {
    const tag = PUMP_TAG[i], fp = { title: `${tag} · BƠM TĂNG ÁP SỐ ${i + 1}`, w: 384 };
    const Ls = { run: this._lamp('CHẠY'), stop: this._lamp('DỪNG'), flt: this._lamp('LỖI'), mode: this._lamp('TỰ ĐỘNG'), src: this._lamp('TẠI CHỖ/TỪ XA'), ilk: this._lamp('LIÊN ĐỘNG') };
    const R = { f: this._hd('Hz', true), fs: this._hd('Hz', true), a: this._hd('A'), kw: this._hd('kW'), rh: this._hd('h'), sh: this._hd('') };
    const M = this._modeBtns(fp);
    // tần số nhập kiểu Việt Nam (42,5) hoặc 42.5; sai hoặc ngoài 25–50 Hz thì báo ngay dưới ô, không tự kẹp giá trị
    const parseF = () => { const s = String(inp.value).trim().replace(',', '.'); return /^\d{1,3}(\.\d*)?$/.test(s) ? Number(s) : NaN; };
    const okF = (v) => isNum(v) && v >= 25 && v <= 50;
    const errF = (msg) => { setT(ferr, msg || ''); setH(ferr, !msg); inp.classList.toggle('bad', Boolean(msg)); inp.setAttribute('aria-invalid', String(Boolean(msg))); };
    const chkF = () => {
      const v = parseF();
      if (okF(v)) { errF(null); return Math.round(v * 10) / 10; }
      errF(isNum(v) ? `${num(v, 1)} Hz ngoài dải cho phép 25–50 Hz` : 'Giá trị không hợp lệ – nhập số từ 25 đến 50, ví dụ 42,5');
      return null;
    };
    const run = () => {
      const p = (this._d || stationData(this.app, this.where)).pumps[i];
      if (!fp.edit && p.running) { this._ask(fp, `Xác nhận CHẠY ${tag} (giữ tần số đang chạy${isNum(p.f) ? ' ' + num(p.f, 1) + ' Hz' : ''})?`, () => this._send(fp, 'pump_start', { pump: i })); return; }
      const v = chkF();
      if (v === null) { inp.focus(); return; }
      this._ask(fp, `Xác nhận CHẠY ${tag} ở ${num(v, 1)} Hz?`, () => { fp.edit = false; this._send(fp, 'pump_start', { pump: i, f_hz: v }); });
    };
    const write = () => {
      const v = chkF();
      if (v === null) { inp.focus(); return; }
      this._ask(fp, `Xác nhận GHI tần số đặt ${tag} = ${num(v, 1)} Hz?`, () => { fp.edit = false; this._send(fp, 'pump_speed', { pump: i, f_hz: v }); });
    };
    const bRun = h('button', { class: 'h-btn go', onclick: run }, '▶ CHẠY');
    const bStop = h('button', { class: 'h-btn stop', onclick: () => this._ask(fp, `Xác nhận DỪNG ${tag}?`, () => this._send(fp, 'pump_stop', { pump: i })) }, '■ DỪNG');
    const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: '40,0', class: 'h-inp', 'aria-label': `Tần số đặt ${tag} (Hz, 25–50)`,
      oninput: () => { fp.edit = true; const v = parseF(); if (okF(v)) { rng.value = String(v); errF(null); } },
      onblur: () => { if (fp.edit) chkF(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); write(); } } });
    const rng = h('input', { type: 'range', min: 25, max: 50, step: 0.5, value: 40, class: 'h-rng', 'aria-label': `Thanh trượt tần số ${tag}`, oninput: () => { fp.edit = true; inp.value = num(Number(rng.value), 1); errF(null); } });
    const bW = h('button', { class: 'h-btn', onclick: write }, 'GHI');
    const why = h('p', { class: 'h-why' }), perm = h('ul', { class: 'h-perm' }), res = h('p', { class: 'h-res' }), ferr = h('p', { class: 'h-ferr', hidden: true, role: 'alert' });
    fp.body = h('div', {}, h('div', { class: 'h-lamprow' }, ...Object.values(Ls).map((L) => L.el)),
      h('div', { class: 'h-rogrid c3' }, this._ro('Tần số thực', R.f), this._ro('Tần số đặt', R.fs), this._ro('Dòng điện', R.a), this._ro('Công suất', R.kw), this._ro('Giờ chạy', R.rh), this._ro('Khởi động / 1 giờ', R.sh)),
      h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Chế độ trạm'), M.el),
      h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Lệnh bơm'), h('div', { class: 'h-brow' }, bRun, bStop)),
      h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Tần số đặt (25–50 Hz)'), h('div', { class: 'h-srow' }, inp, h('span', { class: 'h-hu' }, 'Hz'), rng, bW), ferr),
      why, h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Điều kiện cho phép chạy & liên động'), perm), res);
    fp.update = (d, force) => {
      const a = this.app, p = d.pumps[i], man = d.ctl !== 'auto', max = a.cfg.safety.max_starts_per_h, local = this.where === 'local';
      this._pumpLamps(Ls, d, i);
      const fs = this._fset(d, i);
      this._hv(R.f, p.f, 1); this._hv(R.fs, fs, 1); this._hv(R.a, p.amps, 1); this._hv(R.kw, p.kw, 2); this._hv(R.rh, p.run_h, 1);
      this._hv(R.sh, isNum(p.starts_h) ? `${p.starts_h} / ${max}` : p.starts_h, 0, { st: p.starts_h >= max ? 'alarm' : p.starts_h >= max - 1 ? 'warn' : 'ok' });
      this._syncModeBtns(M, d);
      // tại trạm biết điều kiện chạy: điều kiện cứng đầu tiên chưa đạt (theo ưu tiên của lớp an toàn) thì khóa nút CHẠY
      const off = d.dead || !man, blk = local && !off ? firstBlock(a, i) : null;
      setD(bRun, off || (p.fault && !d.dead) || Boolean(blk)); setD(bStop, off); setD(bW, off); setD(inp, off); setD(rng, off);
      setA(bRun, 'title', blk ? 'Chưa đạt điều kiện chạy: ' + blk : p.running && !fp.edit ? `Chạy ${tag} (giữ tần số đang chạy)` : `Chạy ${tag} ở tần số đặt`);
      setC(bRun, 'h-btn go' + (!d.dead && p.running ? ' act' : '')); setC(bStop, 'h-btn stop' + (!d.dead && !p.running ? ' act' : ''));
      if (!fp.edit && document.activeElement !== inp && document.activeElement !== rng) {
        // mặc định: tần số đặt đã biết; trung tâm không biết thì lấy tần số đang chạy (làm tròn 0,5) thay vì 40 Hz
        const v = isNum(p.f_set) ? p.f_set : isNum(fs) && fs >= 25 ? fs : p.running && isNum(p.f) && p.f >= 25 ? p.f : 40;
        const r = clamp(Math.round(v * 2) / 2, 25, 50), s = num(r, 1);
        if (inp.value !== s) { inp.value = s; rng.value = String(r); errF(null); }
      }
      const sf = local && !d.dead ? a.st.gw.safety : null;
      let [cls, txt] = this._authNote(d);
      if (!d.dead && man && p.fault) [cls, txt] = ['bad', `Biến tần ${tag} báo lỗi – không chạy được cho tới khi sửa xong.`];
      else if (blk && !p.running) [cls, txt] = ['bad', `Chưa đạt điều kiện chạy: ${blk}.`];
      else if (sf && man && p.want && !p.running && sf.last_block) [cls, txt] = ['warn', `Lệnh chạy đang bị lớp an toàn giữ: ${viTxt(sf.last_block)}.`];
      setT(why, txt); setC(why, 'h-why ' + cls);
      // điều kiện chạy theo thứ tự ưu tiên của lớp an toàn; giới hạn tần số chỉ để biết (không chặn khởi động)
      const list = local && !d.dead ? permissives(a, i) : [];
      if (this._changed('perm' + i, list.map((x) => (+x[0]) + x[1]).join('|') + this.where + d.dead, force)) {
        perm.replaceChildren(...(list.length ? list.map(([ok, t, kind]) => (kind === 'info' ? h('li', { class: 'info' + (sf?.limiting ? ' on' : '') }, h('i', {}, 'i'), t)
          : h('li', { class: ok ? 'ok' : 'no' }, h('i', {}, ok ? '✓' : '✗'), t)))
          : [h('li', { class: 'na' }, d.dead ? 'Mini PC ngừng – chỉ còn liên động cứng: phao LSLL-101, van an toàn PSV-01, bảo vệ của biến tần.'
            : 'Trung tâm chỉ thấy báo động gửi lên – chi tiết liên động chỉ xem được tại HMI-01 ở trạm.')]));
      }
      // lệnh cuối của chính bơm này; lệnh chạy đã nhận nhưng bị lớp an toàn hủy thì nói rõ, không để "đã thực hiện"
      const c = this._resLine(res, ['pump_start', 'pump_stop', 'pump_speed', 'set_mode'], (x) => !/P-0\d/.test(x.reason || '') || x.reason.includes(tag));
      if (sf && c && c.type === 'pump_start' && c.status === 'ok' && !p.running && p.want === false) {
        const L = a.st.gw.logs;
        let lg = null;
        for (let k = L.length - 1; k >= 0 && L[k].t >= c.t; k--) if (L[k].level === 'safety' && L[k].text.includes(tag)) { lg = L[k]; break; }
        const inner = lg?.text.match(/\(([^)]+)\)/)?.[1];
        setT(res, `Lệnh cuối ${tShort(c.t)} · ${c.id} ${cmdName(c.type)}: lớp an toàn đã hủy – ${inner ? viTxt(inner) + ', cần lệnh chạy lại' : lg ? viTxt(lg.text) : 'cần lệnh chạy lại'}`);
        setC(res, 'h-res critical');
      }
    };
    return fp;
  }
  _fp_valve() {
    const fp = { title: 'MV-02 · VAN ĐIỆN ĐẦU RA', w: 340 };
    const Ls = { open: this._lamp('MỞ'), closed: this._lamp('ĐÓNG'), mov: this._lamp('ĐANG CHẠY') };
    const R = { pos: this._hd('%', true), cmd: this._hd('', false, true), trv: this._hd('s') };
    const M = this._modeBtns(fp);
    const bO = h('button', { class: 'h-btn go', onclick: () => this._ask(fp, 'Xác nhận MỞ van MV-02?', () => this._send(fp, 'valve', { open: true })) }, 'MỞ VAN');
    const bC = h('button', { class: 'h-btn stop', onclick: () => this._ask(fp, 'Xác nhận ĐÓNG van MV-02? Bơm sẽ bị cấm chạy khi van không mở hết.', () => this._send(fp, 'valve', { open: false })) }, 'ĐÓNG VAN');
    const why = h('p', { class: 'h-why' }), res = h('p', { class: 'h-res' }), absent = h('p', { class: 'h-why bad', hidden: true }, 'Trạm không lắp van điện MV-02 (cấu hình thiết bị).');
    fp.body = h('div', {}, absent, h('div', { class: 'h-lamprow' }, ...Object.values(Ls).map((L) => L.el)),
      h('div', { class: 'h-rogrid c3' }, this._ro('Độ mở', R.pos), this._ro('Lệnh tay', R.cmd), this._ro('Hành trình', R.trv)),
      h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Chế độ trạm'), M.el), h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Lệnh van'), h('div', { class: 'h-brow' }, bO, bC)), why,
      h('p', { class: 'h-why info' }, 'Liên động: van MV-02 không mở hết → cấm chạy bơm (mở van trước, chạy bơm sau). Dừng an toàn do chất lượng nước tự đóng van.'),
      h('div', { class: 'h-fsec' }, h('button', { class: 'h-btn ghost wide', onclick: () => this.app.openDrawer('MV-02') }, 'THÔNG SỐ THIẾT BỊ ▸')), res);
    fp.update = (d) => {
      const a = this.app, k = !d.dead, v = d.valve, no = a.cfg.hardware['MV-02'] === false, man = d.ctl !== 'auto';
      setH(absent, !no);
      this._setLamp(Ls.open, k && isNum(v) && v > 0.99 ? 'g' : ''); this._setLamp(Ls.closed, k && isNum(v) && v < 0.01 ? 'r' : ''); this._setLamp(Ls.mov, k && isNum(v) && v >= 0.01 && v <= 0.99 ? 'a blink' : '');
      this._hv(R.pos, isNum(v) ? v * 100 : v, 0, { absent: no });
      const g = a.st.gw;
      this._hv(R.cmd, this.where === 'local' && k ? (g.manual ? (g.manual.valve ? 'MỞ' : 'ĐÓNG') : 'TỰ ĐỘNG') : undefined, 0);
      this._hv(R.trv, a.cfg.outlet_valve.travel_s, 0, { live: true });
      this._syncModeBtns(M, d);
      setD(bO, d.dead || !man || no); setD(bC, d.dead || !man || no);
      const [cls, txt] = this._authNote(d); setT(why, txt); setC(why, 'h-why ' + cls);
      this._resLine(res, ['valve', 'set_mode']);
    };
    return fp;
  }
  _fp_inst(tag) {
    const I = INST[tag], comp = this.app.components.find((c) => c.tag === tag), sp = this.app.cfg.sensors[tag];
    const fp = { title: `${tag} · ${(I.lbl || comp?.name || '').toUpperCase()}`, w: 360 };
    const V = this._hd(I.u, true), Q = this._lamp('TỐT'), lim = h('td'), src = h('td'), sl = h('span', { class: 'h-spl' });
    const svg = S('svg', { viewBox: '0 0 300 96', class: 'h-spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    fp.body = h('div', {}, h('div', { class: 'h-qa-top' }, V.el, Q.el),
      h('table', { class: 'h-tbl h-kv' }, h('tbody', {}, h('tr', {}, h('td', {}, 'Thiết bị'), h('td', {}, comp?.name || tag)),
        h('tr', {}, h('td', {}, 'Dải đo'), h('td', {}, sp ? `${num(sp.lo, sp.hi <= 14 ? 1 : 0)} – ${num(sp.hi, sp.hi <= 14 ? 1 : 0)} ${I.u}` : comp?.range || '–')),
        h('tr', {}, h('td', {}, 'Ngưỡng'), lim), h('tr', {}, h('td', {}, 'Nguồn dữ liệu'), src))),
      h('small', { class: 'h-cap' }, 'XU HƯỚNG 2 GIỜ'), h('div', { class: 'h-sparkw' }, svg, h('div', { class: 'h-spk-ax' }), sl),
      h('div', { class: 'h-fsec' }, h('button', { class: 'h-btn ghost wide', onclick: () => this.app.openDrawer(tag) }, 'THÔNG SỐ THIẾT BỊ ▸')));
    fp.update = (d, force) => {
      const a = this.app, absent = this._absent(tag), v = d[I.k], L = this._lim(tag), local = this.where === 'local';
      const st = this._hv(V, v, I.nd, { absent, lim: L.st });
      const faults = local && !d.dead ? [...a.st.gw.alarms.active.keys()].filter((c) => c.endsWith(tag) && /SENSOR|STUCK|RANGE/.test(c)) : [];
      const q = d.dead ? ['r', 'MẤT KẾT NỐI'] : absent ? ['', 'KHÔNG LẮP'] : st === 'na' ? ['', 'KHÔNG GỬI VỀ'] : faults.length || st === 'bad' ? ['r blink', 'LỖI TÍN HIỆU'] : this.ctx.stale ? ['a', 'DỮ LIỆU CŨ'] : ['g', 'TỐT'];
      this._setLamp(Q, q[0], 'CHẤT LƯỢNG: ' + q[1], true);
      setT(lim, L.txt);
      setT(src, local ? (tag === 'PL-301' ? 'logger NB-IoT tại điểm bất lợi (mô phỏng)' : 'gateway GW-01 – đọc trực tiếp') : 'máy chủ – bản tin MQTT 10 s');
      const now = performance.now();
      if (force || now - (fp.spT || 0) > 1500) {
        fp.spT = now;
        const lo = L.scale ? L.scale[0] : 0, hi = L.scale ? L.scale[1] : sp ? Math.min(sp.hi, { bar: 6, 'm³/h': 50, m: 5 }[I.u] ?? sp.hi) : 6;
        const has = !absent && !d.dead && this._spark(svg, I.hk, d.t - 7200, Math.max(d.t, 600), lo, hi, L.lines);
        if (!has) { svg.replaceChildren(S('rect', { x: 0, y: 0, width: 300, height: 96, class: 'h-spk-bg' })); svg.parentNode.querySelector('.h-spk-ax').replaceChildren(); }
        setT(sl, absent ? 'Không lắp' : d.dead ? '####' : has ? `${num(lo, 1)} – ${num(hi, 1)} ${I.u}` : 'Trung tâm không nhận xu hướng tín hiệu này');
      }
    };
    return fp;
  }
  _fp_station() {
    const fp = { title: this.app.st.sid + ' · CHẾ ĐỘ TRẠM', w: 380 };
    const Ls = { auto: this._lamp('TỰ ĐỘNG'), loc: this._lamp('TAY · TẠI CHỖ'), rem: this._lamp('TAY · TỪ XA'), ss: this._lamp('DỪNG AN TOÀN') };
    const R = { mode: this._hd('', false, true), scr: this._hd('', false, true), lease: this._hd(''), pset: this._hd('bar') };
    const M = this._modeBtns(fp), s = this.app.cfg.safety;
    const bReset = h('button', { class: 'h-btn', onclick: () => this._ask(fp, this._intlk(this._d || stationData(this.app, this.where))?.k === 'lockout'
      ? 'Xác nhận MỞ KHÓA BẢO VỆ ÁP CAO? Chỉ đặt lại khi đã tìm và xử lý nguyên nhân áp lực cao.'
      : `Xác nhận ĐẶT LẠI DỪNG AN TOÀN? Trạm chỉ chạy lại khi chất lượng nước đã đạt liên tục ${num(s.quality_reset_hold_s / 60, 0)} phút.`, () => this._send(fp, 'reset_safe_stop', {})) }, 'ĐẶT LẠI DỪNG AN TOÀN');
    const bRot = h('button', { class: 'h-btn', onclick: () => this._ask(fp, 'Xác nhận LUÂN PHIÊN BƠM chính (đổi P-01 ↔ P-02)?', () => this._send(fp, 'rotate_pumps', {})) }, 'LUÂN PHIÊN BƠM');
    const why = h('p', { class: 'h-why' }), res = h('p', { class: 'h-res' });
    fp.body = h('div', {}, h('div', { class: 'h-lamprow' }, ...Object.values(Ls).map((L) => L.el)),
      h('div', { class: 'h-rogrid' }, this._ro('Chế độ gateway', R.mode), this._ro('Kịch bản', R.scr), this._ro('Quyền TAY từ xa còn', R.lease), this._ro('Áp đặt P_set', R.pset)),
      h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Chế độ điều khiển'), M.el), h('div', { class: 'h-fsec' }, h('small', { class: 'h-cap' }, 'Lệnh trạm'), h('div', { class: 'h-brow' }, bReset, bRot)), why,
      h('ul', { class: 'h-rules' }, h('li', {}, 'Tại chỗ (HMI-01) ưu tiên hơn từ xa: khi trạm đang TAY tại chỗ, lệnh từ trung tâm bị từ chối.'),
        h('li', {}, `Lệnh từ xa hết hạn sau ${num(this.app.cfg.gateway.manual_cmd_ttl_s, 0)} s; quyền TAY từ xa ${num(this.app.cfg.gateway.manual_lease_s / 60, 0)} phút, mỗi lệnh gia hạn, tự về TỰ ĐỘNG khi mất kết nối.`),
        h('li', {}, 'Ở chế độ TAY bơm chỉ chạy khi có lệnh. Lớp an toàn (van MV-02 mở hết, mức bể, dừng an toàn chất lượng, cắt áp rất cao, 6 lần khởi động/giờ, giới hạn tần số gần 4,0 bar) luôn ưu tiên.'),
        h('li', {}, 'Mini PC ngừng: HMI-01 mất kết nối, không ra lệnh tại chỗ được; biến tần tự chạy PID nội (nếu có lắp).')), res);
    fp.update = (d) => {
      const a = this.app, k = !d.dead, local = this.where === 'local';
      this._setLamp(Ls.auto, k && d.ctl === 'auto' ? 'g' : ''); this._setLamp(Ls.loc, k && d.ctl === 'local' ? 'a' : ''); this._setLamp(Ls.rem, k && d.ctl === 'remote' ? 'c' : '');
      const ss = local ? k && (a.st.gw.safety.safe_stop || a.st.gw.safety.lockout) : d.alarms.some((x) => x.code === 'SAFE_STOP' || x.code === 'LOCKOUT');
      this._setLamp(Ls.ss, ss ? 'r blink' : '');
      this._hv(R.mode, this._modeText(d), 0, { live: true, st: { ok: 'ok', info: 'ok', warn: 'warn', alarm: 'alarm' }[this._modeCls(d)] || 'ok' });
      const sc = this._script(); this._hv(R.scr, `v${sc.v} · ${sc.s}`, 0);
      // quyền TAY từ xa còn lại: tại trạm đọc gateway; trung tâm ước tính từ lệnh tay cuối đã được xác nhận (≈)
      const ls = d.lease_s;
      this._hv(R.lease, isNum(ls) ? (d.lease_est ? '≈ ' : '') + fmtLease(ls) : d.ctl === 'remote' ? undefined : '–', 0, { st: isNum(ls) && ls < 300 ? 'warn' : 'ok' });
      this._hv(R.pset, d.p_set, 2);
      this._syncModeBtns(M, d);
      this._syncReset(bReset, d); setD(bRot, d.dead || d.ctl !== 'auto');
      let [cls, txt] = this._authNote(d, true);
      const I = this._intlk(d);
      if (I && !this.ctx.stale && !this._wait) [cls, txt] = [I.sev, I.text + '.'];
      setT(why, txt); setC(why, 'h-why ' + cls);
      this._resLine(res, ['set_mode', 'reset_safe_stop', 'rotate_pumps']);
    };
    return fp;
  }

  // ================= cập nhật =================
  update(force = false) {
    if (!this.visible || !this.app.st) return;
    const d = stationData(this.app, this.where);
    this._d = d;
    this.ctx = { d, remote: this.where === 'remote', dead: Boolean(d.dead), stale: Boolean(d.stale) && !d.dead };
    this._wait = this._pendManual(d);
    const R = this.root;
    R.classList.toggle('h-remote', this.ctx.remote); R.classList.toggle('h-dead-on', this.ctx.dead); R.classList.toggle('h-stale', this.ctx.stale);
    this._updHeader(d); this._updAlarmBar(d); this._updState(d);
    ({ ov: this._updOverview, pump: this._updPumps, qual: this._updQuality, trend: this._updTrend, alarm: this._updAlarms, log: this._updLog, par: this._updParams })[this.scr].call(this, d, force);
    this._updStatus(d);
    for (const fp of this.fps) fp.update(d, force);
  }
  _updHeader(d) {
    const a = this.app, H = this.H, local = this.where === 'local', c = this.ctx;
    setT(H.bname, `TRẠM BƠM TĂNG ÁP ${a.st.sid} · ${a.st.station.zone ?? ''}${a.st.station.site ? ' · ' + a.st.station.site.area.toUpperCase() : ''}`); setT(H.bshort, a.st.sid);
    const clk = fmtClock(d.t, a.cfg.sim.start_dow), m = clk.match(/^(.*) (\d\d:\d\d:\d\d)$/);
    setT(H.date, m ? m[1] : ''); setT(H.time, m ? m[2] : clk);
    setT(H.uPos, POS[this.where].name); setT(H.uRole, POS[this.where].role);
    // huy hiệu TAY và liên động; dữ liệu cũ (trung tâm mất bản tin) → '?' và kiểu không chắc chắn
    const man = !c.dead && d.ctl !== 'auto', qm = c.stale ? '? ' : '', q = c.stale ? ' q' : '';
    setH(H.man, !man); setT(H.man, qm + (d.ctl === 'local' ? 'TAY · TẠI CHỖ' : 'TAY · TỪ XA')); setC(H.man, 'h-manbadge' + q);
    setA(H.man, 'title', c.stale ? `Bản tin cuối lúc ${this._lastHM(d)} báo ${CTL_NAME[d.ctl]}` + (d.ctl === 'remote' ? ' – trạm tự về TỰ ĐỘNG khi mất kết nối' : '') + ', trạng thái thật có thể đã khác'
      : 'Trạm đang ở chế độ điều khiển TAY – kịch bản tự động tạm ngưng, lớp an toàn vẫn hoạt động' + (isNum(d.lease_s) && d.ctl === 'remote' ? ` · quyền từ xa còn ${d.lease_est ? '≈ ' : ''}${fmtLease(d.lease_s)}` : ''));
    const I = this._intlk(d);
    setH(H.intlk, !I);
    if (I) { setT(H.intlk, qm + I.badge); setC(H.intlk, 'h-intlk ' + I.sev + q); setA(H.intlk, 'title', I.text + (I.reset ? ' – bấm để mở bảng chế độ trạm' : '')); }
    const led = (k, st, tip) => { setC(H.leds[k].i, 'h-ledi ' + st); setA(H.leds[k].s, 'title', tip); };
    const S0 = a.server.stations[a.st.sid];
    if (local) {
      const g = a.st.gw;
      led('gw', c.dead ? 'r' : g.observe_until !== null ? 'y' : 'g', c.dead ? 'GW-01 (mini PC MPC-01): NGỪNG – mất kết nối' : 'GW-01 (mini PC MPC-01): đang chạy');
      led('lte', c.dead ? 'x' : a.st.link.up ? 'g' : 'r', c.dead ? '4G (RT-01): không biết – mini PC ngừng' : a.st.link.up ? '4G (RT-01): có sóng' : '4G (RT-01): MẤT KẾT NỐI');
      led('srv', c.dead ? 'x' : { online: 'g', resync: 'y', offline: 'r' }[d.comms] || 'x', c.dead ? 'Máy chủ: không biết' : 'Máy chủ: ' + ({ online: 'trực tuyến', resync: 'đang đồng bộ', offline: 'mất kết nối' }[d.comms] || d.comms));
    } else {
      led('gw', S0.online ? 'g' : 'x', S0.online ? 'GW-01: gửi bản tin đều' : 'GW-01: không biết – mất bản tin');
      led('lte', S0.online ? 'g' : 'r', S0.online ? `4G trạm ${a.st.sid}: trực tuyến` : `4G trạm ${a.st.sid}: MẤT KẾT NỐI (LWT)`);
      led('srv', 'g', 'Máy chủ SRV-01: đang chạy');
    }
    const al = this._alarms(d), un = al.filter((x) => this._ackable(x) || x.sys).length;
    setT(H.almN, String(al.length));
    setC(H.alm, 'h-almcnt' + (un ? ' un' : al.length ? ' ack' : ''));
    setA(H.alm, 'title', `${al.length} báo động đang hoạt động, ${un} chưa xác nhận – mở danh sách báo động`);
    setH(this.navBadge, !al.length); setT(this.navBadge, String(al.length)); setC(this.navBadge, un ? 'un' : '');
    if (!H.menu.hidden) this._syncMenu();
  }
  _updAlarmBar(d) {
    const A = this.AB, al = this._sorted(this._alarms(d)), top = al[0] || null;
    this._top = top;
    if (!top) {
      setC(A.el, 'h-ab none'); setT(A.sev, 'OK'); setT(A.time, ''); setT(A.code, ''); setT(A.msg, 'Không có báo động'); setT(A.more, ''); setH(A.ack, true);
      return;
    }
    const un = this._ackable(top), hot = top.sev === 'critical' || top.sev === 'alarm';
    setC(A.el, 'h-ab ' + (hot ? 'hot' : top.sev === 'warning' ? 'warn' : 'info') + (un || top.sys ? ' un' : ' acked'));
    setT(A.sev, SEV_TXT[top.sev] || SEV_LABEL[top.sev] || top.sev); setT(A.time, tShort(top.t)); setT(A.code, top.code); setT(A.msg, viTxt(top.msg));
    setT(A.more, al.length > 1 ? `+${al.length - 1}` : ''); setH(A.ack, !un); setD(A.ack, d.dead);
  }
  _updState(d) {
    const c = this.ctx, a = this.app, gd = a.st.gw_dead;
    const showDead = c.dead && this._deadHide !== gd;
    setH(this.deadBox, !showDead);
    if (c.dead) {
      const min = Math.max(0, (d.t - gd.t0) / 60);
      const msg = `Mini PC (edge gateway GW-01) ngừng từ ${tShort(gd.t0)} (${num(min, 0)} phút). HMI-01 không còn dữ liệu – mọi giá trị hiển thị ####, lệnh từ màn hình không thực hiện được.`;
      const fb = `Dự phòng tại trạm: ${viNum(gd.note())}.` + (gd.restarted ? ' Mini PC đã khởi động lại – đang theo dõi trước khi tiếp quản.' : '');
      if (showDead && this.deadMsg._k !== msg + fb) {
        this.deadMsg._k = msg + fb;
        this.deadMsg.replaceChildren(h('p', {}, msg), h('p', { class: 'fb' }, fb), h('p', {}, 'Liên động cứng vẫn hoạt động: phao LSLL-101, van an toàn PSV-01, bảo vệ của biến tần.'));
      }
      this._stateBar('bad', `MẤT KẾT NỐI MPC-01 – DỮ LIỆU KHÔNG HỢP LỆ (####) · ${viNum(gd.note())}`, showDead ? null : ['CHI TIẾT', () => { this._deadHide = null; this.update(true); }]);
      return;
    }
    const I = this._intlk(d), ttl = num(a.cfg.gateway.manual_cmd_ttl_s, 0);
    if (c.stale) {
      const ago = isNum(d.age) ? `, ${num(d.age / 60, 0)} phút trước` : '';
      this._stateBar('warn', `MẤT KẾT NỐI – DỮ LIỆU CŨ (bản tin cuối ${this._lastHM(d)}${ago})` + (d.ctl === 'remote' ? ' · trạm đang TAY từ xa tự về TỰ ĐỘNG khi mất kết nối' : '')
        + ` · lệnh từ trung tâm xếp hàng ở máy chủ, hết hạn sau ${ttl} s` + (I ? ` · báo động cuối nhận được: ${I.badge}` : ''));
    } else if (I) {
      // liên động/cắt đã chốt: hiện ngay trên mọi màn hình, kèm nút mở bảng chế độ trạm để đặt lại
      this._stateBar(I.sev, I.text, I.reset ? ['ĐẶT LẠI ▸', () => this._fpOpen('station', 'ST')] : null);
    } else this._stateBar(null);
  }
  _stateBar(cls, text, btn = null) {
    const el = this.stateBar;
    if (!cls) { setH(el, true); return; }
    setH(el, false); setC(el, 'h-statebar ' + cls);
    const k = text + (btn ? btn[0] : '');
    if (el._k !== k) { el._k = k; el.replaceChildren(h('span', { class: 'h-sbar-ic' }, '!'), h('span', { class: 'h-sbar-t' }, text), btn ? h('button', { class: 'h-btn sm', onclick: btn[1] }, btn[0]) : ''); }
  }
  _updStatus(d) {
    const B = this.SB, c = this.ctx, a = this.app;
    const cs = this._ctlState(d), qm = c.stale ? '? ' : '', q = c.stale ? ' q' : '';
    setT(B.ctl, qm + cs.t + (c.stale ? ` (bản tin cuối ${this._lastHM(d)})` : '')); setC(B.ctl, cs.cls + q);
    setT(B.mode, this._modeText(d)); setC(B.mode, this._modeCls(d) + q);
    const sc = this._script(); setT(B.scr, c.dead ? '####' : `${qm}v${sc.v} · ${sc.s}`); setC(B.scr, q.trim());
    setT(B.pset, c.dead ? '####' : isNum(d.p_set) ? num(d.p_set, 2) + ' bar' : 'N/A');
    setT(B.kwh, c.dead ? '####' : isNum(d.kwh) ? num(d.kwh, 1) + ' kWh' : 'N/A');
    setT(B.src, this.where === 'local' ? (c.dead ? 'HMI-01 · mất kết nối GW-01' : 'HMI-01 · dữ liệu trực tiếp GW-01 (Modbus TCP)') : `SCADA · máy chủ SRV-01 (MQTT 10 s)${a.server.stations[a.st.sid].online ? '' : ' · trạm mất kết nối'}`);
  }
}
