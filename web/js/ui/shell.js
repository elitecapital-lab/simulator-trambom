// Vỏ giao diện toàn màn hình kiểu "bản sao số": cảnh 3D (#vp) phủ kín cửa sổ, mọi bảng nổi bên trên dạng kính mờ.
//   thanh trên (thu gọn dần vào menu khi hẹp) · HUD chỉ số chính · thanh chức năng (dock) · bảng nổi bên phải
//   · bảng biểu đồ trượt từ dưới lên · cửa sổ bật Camera / Hiển thị. Cập nhật theo nhịp 250 ms của main.js.
import { h, fmt, SEV_LABEL, tShort } from './dom.js';
import { ackAlarm, CTL_NAME, fmtLease, MODE_CHIP, MODE_NAME, sendCommand, sortedAlarms, stationData, viNum } from './ops.js';

const ICONS = {
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 6-7"/>',
  compare: '<path d="M5 20V11M10 20V5M15 20v-6M20 20V8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  equip: '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  camera: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path class="fill" d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path class="fill" d="M6.5 4.5H10v15H6.5zM14 4.5h3.5v15H14z"/>',
  ff: '<path d="m4 6 7 6-7 6zM13 6l7 6-7 6z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.6-2.8 4"/><path d="M12 17.6h.01"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path class="fill" d="M12 3a9 9 0 0 1 0 18z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 9.5V21h14V9.5"/>',
  tank: '<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3z"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  pump: '<circle cx="9" cy="13" r="6"/><path d="M9 13 5.5 9.5M15 13h6M9 7V3h6"/>',
  drop: '<path d="M12 2.5c3.6 4.4 6.5 7.9 6.5 11.6a6.5 6.5 0 0 1-13 0C5.5 10.4 8.4 6.9 12 2.5z"/>',
  cabinet: '<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><path d="M12 2.5v19M9.5 11v2M14.5 11v2"/>',
  city: '<path d="M3 21h18M5 21V8l5-3v16M10 21V10h5v11M15 21v-7h4v7"/>',
};
/** Biểu tượng SVG nét mảnh (viewBox 24). */
export function ico(k, cls = 'ico') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[k] || ''}</svg>`;
  return t.content.firstChild;
}

// [nhãn dock, biểu tượng, tiêu đề bảng, mô tả]
export const PANES = {
  alarm: ['Báo động', 'bell', 'Báo động tại trạm', 'Báo động đang hoạt động của gateway, xác nhận tại chỗ'],
  mon: ['Giám sát', 'gauge', 'Giám sát gateway & số đo', 'Chế độ gateway, kết nối, kịch bản và toàn bộ số đo đã kiểm tra'],
  equip: ['Thiết bị', 'equip', 'Thiết bị: hiện trạng / giải pháp / khuyến nghị', 'Danh mục thiết bị, thử bỏ bớt thiết bị “nếu không lắp”'],
  fault: ['Sự cố', 'zap', 'Tạo sự cố để thử nghiệm', 'Ngắt 4G, mini PC treo, nước nguồn bẩn, lỗi bơm, lỗi cảm biến…'],
  script: ['Kịch bản', 'code', 'Kịch bản điều khiển & lệnh', 'Tham số kịch bản, lệnh từ trung tâm, kịch bản của học viên'],
  center: ['Trung tâm', 'server', 'Trung tâm điều hành', 'Dữ liệu máy chủ nhận được từ các trạm, cảnh báo tập trung'],
  log: ['Nhật ký', 'list', 'Nhật ký sự kiện', 'Nhật ký gateway và máy chủ'],
  lesson: ['Bài học', 'book', 'Bài học & câu hỏi', 'Mục tiêu kịch bản, câu hỏi phân tích, gợi ý quan sát'],
};
const CAMS = [['overview', 'Tổng quan', 'Toàn trạm', 'home'], ['tank', 'Bể chứa', 'T-01 · van phao · LT-101', 'tank'], ['pumps', 'Cụm bơm', 'P-01/P-02 · HT-01', 'pump'],
  ['quality', 'Chất lượng nước', 'AIT-201/202/203', 'drop'], ['cabinet', 'Tủ điều khiển', 'CP-01 · CP-02 · mini PC', 'cabinet'], ['network', 'Khu dân cư', 'Mạng lưới · điểm bất lợi', 'city']];
export const CHART_CHIPS = [['p', 'Áp lực'], ['q', 'Lưu lượng'], ['kw', 'Công suất'], ['lv', 'Mực nước'], ['kwh', 'Điện năng'], ['ntu', 'Độ đục'], ['cl', 'Clo dư'], ['srv', 'Máy chủ']];
const SCOPES = [['all', 'Tất cả'], ['hien_trang', 'Hiện trạng'], ['giai_phap', 'Giải pháp'], ['khuyen_nghi', 'Khuyến nghị']];
const LEGEND = [['#0ca30c', 'Bơm chạy / kết nối tốt'], ['#6d7570', 'Bơm dừng'], ['#d03b3b', 'Lỗi / báo động (nhấp nháy)'], ['#4aa3ff', 'Dòng nước đang chảy']];
const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const UI_KEY = 'trambom-ui';
// đặt chữ / thuộc tính chỉ khi đổi (tránh ghi DOM thừa mỗi nhịp)
const T = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const C = (el, s) => { if (el._c !== s) { el._c = s; el.className = s; } };
const P = (el, k, v) => { const key = '_s' + k; if (el[key] !== v) { el[key] = v; el.style.setProperty(k, v); } };

export class Shell {
  constructor(app) {
    this.app = app;
    const $ = (id) => document.getElementById(id);
    this.top = $('topbar'); this.menu = $('menu'); this.hudEl = $('hud'); this.dockEl = $('dock'); this.side = $('side'); this.sheet = $('sheet');
    this.sheetBody = $('sheet-body'); this.drawer = $('drawer'); this.root = document.documentElement;
    this.mqMobile = matchMedia('(max-width: 720px), (max-height: 500px)');
    this.mqLand = matchMedia('(max-height: 500px)'); // điện thoại nằm ngang: bảng biểu đồ mặc định cỡ L, đầu bảng một hàng
    this.paneKey = null; this.sideOpen = false; this.sheetOpen = false; this.sheetTab = 'charts'; this.pop = null; this.labelMode = 1;
    this.ui = { hudMin: false, charts: ['p', 'q', 'kw', 'lv'], size: 'm' };
    try { Object.assign(this.ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* bỏ qua */ }
    this.chartSel = new Set(this.ui.charts.filter((k) => CHART_CHIPS.some((c) => c[0] === k)));
    if (!this.chartSel.size) this.chartSel.add('p');
    this.chartTmp = new Set(); // biểu đồ tạm hiện khi nhấp thẻ HUD – không lưu, bỏ khi đóng bảng
    this._topbar();
    this._dock();
    this._sidePanel();
    this._sheet();
    this._hud();
    this._pops();
    document.addEventListener('keydown', (e) => this._onKey(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.el.contains(e.target) && !this.pop.btn.contains(e.target)) this.closePop();
    }, true);
    this.mqMobile.addEventListener('change', () => { this.closePop(); if (this.mqMobile.matches && this.sideOpen && this.sheetOpen) this.closeSheet(); this._layoutCharts(); this._fitHud(); this._dockOvf?.(); });
    this.mqLand.addEventListener('change', () => this.setSize(this._sizeNow(), false));
  }
  _save() {
    this.ui.charts = [...this.chartSel];
    try { localStorage.setItem(UI_KEY, JSON.stringify(this.ui)); } catch (e) { /* bỏ qua */ }
  }

  // ---------------- thanh trên ----------------
  _topbar() {
    const $ = (id) => document.getElementById(id);
    $('btn-skip').append(ico('ff'), h('span', {}, '+1 giờ'));
    $('btn-reset').append(ico('reset'), h('span', { class: 'bt' }, 'Chạy lại'));
    $('btn-reset').setAttribute('aria-label', 'Chạy lại');
    $('btn-guide').append(ico('help'), h('span', { class: 'bt' }, 'Hướng dẫn'));
    $('btn-guide').setAttribute('aria-label', 'Hướng dẫn');
    this.menuBtn = $('btn-menu');
    this.menuBtn.append(ico('menu'));
    this.menuBtn.setAttribute('aria-label', 'Thêm điều khiển');
    this.menuBtn.addEventListener('click', (e) => this.togglePop(this.menu, this.menuBtn, e));
    this.menuBody = h('div', { class: 'menu-body' });
    this.menu.append(this.menuBody);
    this._fitTopbar();
    const sync = () => {
      const r = this.top.getBoundingClientRect();
      P(this.root, '--topbar-h', Math.round(r.bottom) + 'px');
      if (this.mqMobile.matches) { P(this.root, '--dock-h', Math.round(this.dockEl.offsetHeight) + 'px'); P(this.root, '--hud-h', Math.round(this.hudEl.offsetHeight) + 'px'); }
      if (this.pop) this._placePop();
    };
    this._syncBars = sync;
    new ResizeObserver(sync).observe(this.top);
    addEventListener('resize', sync);
    sync();
  }
  /**
   * Thanh trên luôn một hàng: các bước thu gọn theo thứ tự ưu tiên (ít quan trọng trước). Bước có max được bật cố định khi
   * cửa sổ ≤ max px (≤ 900: gom bớt vào menu; ≤ 720: chỉ còn tên ngắn, chạy/dừng, đồng hồ, 3D|HMI, menu); ngoài ra đo thực tế,
   * nếu còn xuống dòng (phông dự phòng rộng hơn…) thì bật tiếp bước kế.
   */
  _fitTopbar() {
    const $ = (id) => document.getElementById(id);
    const grp = (id, max) => { const el = $(id), ph = document.createComment(id); el.before(ph); return { el, ph, max, menu: true }; };
    const cls = (el, c, max) => ({ el, c, max });
    // thứ tự thu gọn: nút +1 giờ / chạy lại và nút phụ vào menu trước; kịch bản, mức độ, tốc độ mô phỏng, ô chọn trạm giữ lại lâu nhất
    this.steps = [cls($('modes'), 'compact', 1600), cls(this.top.querySelector('.brand-long'), 'tb-hide', 720), grp('tg-run', 900), grp('tg-misc', 900),
      grp('tg-sc', 720), grp('tg-lvl', 900), grp('tg-speed', 900), grp('tg-st', 720), grp('tg-modes', 720)];
    const order = ['tg-st', 'tg-sc', 'tg-lvl', 'tg-run', 'tg-speed', 'tg-modes', 'tg-misc'];
    const apply = () => {
      for (const s of this.steps) {
        if (!s.menu) { s.el.classList.toggle(s.c, s.on); continue; }
        if (!s.on && s.el.parentNode === this.menuBody) s.ph.after(s.el);
      }
      for (const id of order) { const s = this.steps.find((x) => x.el.id === id); if (s.on) this.menuBody.append(s.el); }
      const any = this.steps.some((s) => s.menu && s.on);
      this.menuBtn.hidden = !any;
      if (!any && this.pop?.el === this.menu) this.closePop();
    };
    const wrapped = () => {
      let lo = Infinity, hi = -Infinity;
      for (const el of this.top.children) { if (!el.offsetWidth) continue; const t = el.offsetTop + el.offsetHeight / 2; lo = Math.min(lo, t); hi = Math.max(hi, t); }
      return hi - lo > 12;
    };
    // đo với tên chế độ dài nhất (.fitw) để khi chế độ đổi giữa chừng thanh không phải xếp lại (chip thu gọn có độ rộng cố định)
    const modes = $('modes');
    const fit = () => {
      const w = innerWidth;
      modes.classList.add('fitw');
      for (const s of this.steps) s.on = w <= s.max;
      apply();
      for (const s of this.steps) { if (!wrapped()) break; if (!s.on) { s.on = true; apply(); } }
      modes.classList.remove('fitw');
    };
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
    document.fonts?.addEventListener?.('loadingdone', fit);
    document.fonts?.ready.then(fit);
    this.refit = fit;
    fit();
  }
  /** Nhãn "thực ×N" (máy không theo kịp tốc độ đặt) gắn vào nút tốc độ đang chọn. */
  setRealSpeed(s) {
    const el = this.speedReal ??= document.getElementById('speed-real');
    T(el, s);
    if (!s) return;
    const on = document.querySelector('#speed-seg button.on');
    if (on && on.offsetParent === el.offsetParent) P(el, 'left', (on.offsetLeft + on.offsetWidth) + 'px');
  }
  /** Nút chạy/tạm dừng: biểu tượng + chữ, chỉ dựng lại khi đổi trạng thái. */
  setPlay(btn, running) {
    if (btn._run === running) return;
    btn._run = running;
    btn.replaceChildren(ico(running ? 'pause' : 'play'), h('span', { class: 'bt-play' }, running ? 'Tạm dừng' : 'Chạy'));
    btn.setAttribute('aria-label', running ? 'Tạm dừng mô phỏng' : 'Chạy mô phỏng');
    btn.classList.toggle('running', running);
  }
  setTheme(btn, kind, label) {
    btn.replaceChildren(ico({ '': 'auto', light: 'sun', dark: 'moon' }[kind]), h('span', { class: 'bt' }, label));
    btn.title = label + ' (bấm để đổi)'; btn.setAttribute('aria-label', label);
  }

  // ---------------- thanh chức năng ----------------
  _dock() {
    const D = this.dockEl;
    this.dk = {};
    this.tipEl = h('div', { class: 'dtip', role: 'tooltip', hidden: true });
    document.body.append(this.tipEl);
    const btn = (k, label, icon, tip, onclick, cls = '') => {
      const b = h('button', { class: 'dk ' + cls, type: 'button', 'data-k': k, 'aria-label': label, onclick }, ico(icon), h('span', { class: 'dk-l' }, label), h('span', { class: 'badge', hidden: true }));
      b.dataset.tip = tip;
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this._tip(b); });
      b.addEventListener('pointerleave', () => this._tip(null));
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) this._tip(b); });
      b.addEventListener('blur', () => this._tip(null));
      this.dk[k] = b; D.append(b);
      return b;
    };
    btn('charts', 'Biểu đồ', 'chart', 'Biểu đồ theo thời gian: áp lực, lưu lượng, công suất, mực nước…', () => this.toggleSheet('charts'));
    btn('kpi', 'So sánh', 'compare', 'So sánh KPI với phương án lịch cố định chạy song song', () => this.toggleSheet('kpi'));
    for (const [k, [label, icon, , tip]] of Object.entries(PANES)) btn(k, label, icon, tip, () => this.togglePane(k));
    D.append(h('span', { class: 'dk-sep', role: 'separator' }));
    btn('manual', 'Điều khiển TAY', 'hand', '', () => this.toggleManual(), 'man');
    btn('cam', 'Camera', 'camera', 'Góc nhìn đặt sẵn trong cảnh 3D', (e) => this.togglePop(this.popCam, this.dk.cam, e), 'has-pop');
    btn('view', 'Hiển thị', 'eye', 'Nhãn thiết bị, lọc phạm vi, chú giải màu 3D', (e) => this.togglePop(this.popView, this.dk.view, e), 'has-pop');
    for (const k of ['charts', 'kpi', ...Object.keys(PANES), 'manual']) this.dk[k].setAttribute('aria-pressed', 'false');
    for (const k of ['cam', 'view']) { this.dk[k].setAttribute('aria-haspopup', 'dialog'); this.dk[k].setAttribute('aria-expanded', 'false'); }
    // cửa sổ thấp: dock cuộn được – hiện mũi tên mờ ở mép dưới khi còn nút bị khuất
    const more = this.dkMore = h('button', { class: 'dk-more', type: 'button', tabindex: '-1', 'aria-hidden': 'true', title: 'Còn chức năng phía dưới', hidden: true,
      onclick: () => D.scrollBy({ top: D.clientHeight * 0.7, behavior: reduced() ? 'auto' : 'smooth' }) }, ico('chev'));
    D.append(more);
    this._dockOvf = () => {
      const ovf = !this.mqMobile.matches && D.scrollHeight > D.clientHeight + 2, down = ovf && D.scrollTop + D.clientHeight < D.scrollHeight - 2;
      if (more.hidden === down) more.hidden = !down;
      D.classList.toggle('more-t', ovf && D.scrollTop > 2);
    };
    D.addEventListener('scroll', this._dockOvf, { passive: true });
    new ResizeObserver(() => { this._syncBars?.(); this._dockOvf(); }).observe(D);
  }
  _tip(b) {
    const t = this.tipEl;
    if (!b || !b.dataset.tip) { t.hidden = true; this._tipFor = null; return; }
    this._tipFor = b;
    t.replaceChildren(h('b', {}, b.getAttribute('aria-label')), h('span', {}, b.dataset.tip));
    t.hidden = false;
    const r = b.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
    if (this.mqMobile.matches) { t.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px'; t.style.top = (r.top - th - 8) + 'px'; }
    else { t.style.left = (r.left - tw - 10) + 'px'; t.style.top = Math.max(8, Math.min(innerHeight - th - 8, r.top + r.height / 2 - th / 2)) + 'px'; }
  }
  setBadge(k, n) {
    const b = this.dk[k === 'mon' ? 'alarm' : k]?.querySelector('.badge');
    if (!b) return;
    b.hidden = !n; T(b, n > 99 ? '99+' : String(n));
    if (k === 'mon') this._alarmCount = n;
  }
  /**
   * Nút "Điều khiển TAY" luôn ra lệnh TẠI TRẠM: đang TỰ ĐỘNG → chuyển TAY tại chỗ; trung tâm đang giữ TAY từ xa → giành quyền
   * TAY tại chỗ (quyền tại trạm ưu tiên); đang TAY tại chỗ → trả về TỰ ĐỘNG. Chú thích của nút nói đúng việc sẽ làm.
   */
  toggleManual() {
    const a = this.app;
    if (!a.st) return;
    if (a.st.gw_dead) { a.toast('Mini PC đang ngừng – không thể điều khiển TAY tại chỗ (biến tần đang tự chạy PID nội)'); return; }
    if (a.viewMode === 'hmi') a.setView('3d');
    sendCommand(a, 'local', 'set_mode', { mode: a.st.gw.controlSrc() === 'local' ? 'auto' : 'manual' });
    this.update(true);
  }

  // ---------------- bảng nổi bên phải ----------------
  _sidePanel() {
    this.sideTitle = document.getElementById('side-title'); this.sideIco = document.getElementById('side-ico');
    const x = document.getElementById('side-x');
    x.append(ico('x')); x.addEventListener('click', () => this.closePane());
  }
  /** Gắn thêm bảng do vỏ giao diện tự dựng (Báo động) vào danh sách bảng của App. */
  buildAlarmPane(pane) {
    this.al = { sum: h('div', { class: 'al-sum' }), list: h('div', { class: 'al-list' }), hist: h('div', { class: 'al-hist' }), dead: h('p', { class: 'note al-dead', hidden: true }) };
    this.al.ackAll = h('button', { class: 'btn small', onclick: () => this._ackAll() }, 'Xác nhận tất cả');
    pane.append(
      h('div', { class: 'sec al-head' }, this.al.sum, h('span', { class: 'spacer' }), this.al.ackAll),
      this.al.dead,
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Đang hoạt động · gateway GW-01'), this.al.list),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Lịch sử gần nhất (phát sinh / hết)'), this.al.hist),
      h('p', { class: 'note' }, 'Xác nhận ở đây là xác nhận TẠI TRẠM (màn HMI-01). Cảnh báo tập trung của máy chủ: mục Trung tâm. Toàn bộ nhật ký: mục Nhật ký.'));
  }
  _ackAll() {
    const a = this.app, list = [...a.st.gw.alarms.active.values()].filter((x) => !x.acked);
    if (!list.length) { a.toast('Không còn báo động chưa xác nhận'); return; }
    for (const x of list) if (!ackAlarm(a, 'local', x.code)) return;
    a.toast(`Đã xác nhận ${list.length} báo động tại trạm`);
  }
  updateAlarms(force = false) {
    const a = this.app, g = a.st.gw, dead = Boolean(a.st.gw_dead), al = this.al;
    const list = sortedAlarms([...g.alarms.active.values()]);
    const key = list.map((x) => x.code + x.acked).join(',') + '|' + g.alarms.history.length + '|' + dead;
    if (!force && key === this._alKey) return;
    this._alKey = key;
    const cnt = { critical: 0, alarm: 0, warning: 0, info: 0 };
    for (const x of list) cnt[x.sev]++;
    al.sum.replaceChildren(...(list.length ? Object.entries(cnt).filter(([, n]) => n).map(([s, n]) => h('span', { class: 'chip ' + s }, `${n} ${SEV_LABEL[s]}`)) : [h('span', { class: 'chip good' }, 'Không có báo động')]));
    al.ackAll.disabled = dead || !list.some((x) => !x.acked);
    al.dead.hidden = !dead;
    al.dead.textContent = 'Mini PC đang ngừng: danh sách dưới đây là trạng thái cuối cùng gateway ghi nhận; HMI-01 mất kết nối nên không xác nhận được.';
    al.list.replaceChildren(...(list.length ? list.map((x) => h('div', { class: 'al-row sev-' + x.sev + (x.acked ? ' acked' : '') },
      h('span', { class: 'chip ' + x.sev }, SEV_LABEL[x.sev]),
      h('div', { class: 'msg' }, h('b', { class: 'mono' }, x.code), h('span', {}, viNum(x.msg)), h('span', { class: 'when' }, tShort(x.t) + (x.acked ? ' · đã xác nhận' : ' · chưa xác nhận'))),
      x.acked ? h('span', { class: 'al-ok', title: 'Đã xác nhận' }, '✓') : h('button', { class: 'btn small', disabled: dead, onclick: () => ackAlarm(a, 'local', x.code) }, 'Xác nhận')))
      : [h('p', { class: 'note' }, 'Trạm đang vận hành bình thường – không có báo động.')]));
    const hist = g.alarms.history.slice(-40).reverse();
    al.hist.replaceChildren(...(hist.length ? hist.map((x) => h('div', { class: 'al-h ' + x.action + ' sev-' + x.sev },
      h('span', { class: 'mono t' }, tShort(x.t)), h('span', { class: 'act' }, x.action === 'raise' ? 'phát sinh' : 'hết'), h('span', { class: 'mono c' }, x.code), h('span', { class: 'm', title: viNum(x.msg) }, viNum(x.msg))))
      : [h('p', { class: 'note' }, 'Chưa có báo động nào kể từ đầu mô phỏng.')]));
  }
  togglePane(k) { if (this.sideOpen && this.paneKey === k) this.closePane(); else this.app.tab(k); }
  /** Mở bảng k trong khung nổi bên phải (gọi qua app.tab). */
  openPane(k) {
    const a = this.app;
    if (!a.panes[k]) return;
    this.paneKey = k; a.curTab = k;
    for (const [n, p] of Object.entries(a.panes)) p.hidden = n !== k;
    const [, icon, title] = PANES[k] || [k, 'list', k];
    T(this.sideTitle, title); this.sideIco.replaceChildren(ico(icon));
    if (this.mqMobile.matches && this.sheetOpen) this.closeSheet();
    if (!this.sideOpen) { this.sideOpen = true; this.side.classList.add('open'); this.side.inert = false; document.body.classList.add('side-open'); }
    a.panes[k].scrollTop = 0;
    this.closePop();
    this._syncDock();
    if (k === 'alarm') this.updateAlarms(true);
  }
  closePane() {
    if (!this.sideOpen) return;
    const back = this.side.contains(document.activeElement) ? this.dk[this.paneKey] : null;
    this.sideOpen = false; this.app.curTab = null;
    this.side.classList.remove('open'); this.side.inert = true; document.body.classList.remove('side-open');
    this._syncDock();
    back?.focus({ preventScroll: true });
  }

  // ---------------- bảng biểu đồ (trượt từ dưới lên) ----------------
  _sheet() {
    const S = this.sheet;
    this.sheetTabs = document.getElementById('sheet-tabs');
    this.sheetTabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.openSheet(b.dataset.t)));
    this.sizeSeg = document.getElementById('size-seg');
    this.sizeSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.setSize(b.dataset.s)));
    const x = document.getElementById('sheet-x');
    x.append(ico('x')); x.addEventListener('click', () => this.closeSheet());
    this.chipsEl = document.getElementById('chart-chips');
    this.kpiEl = document.getElementById('kpi');
    this.chartsEl = document.getElementById('charts');
    this.setSize(this._sizeNow(), false);
    // kéo tay nắm để đổi cỡ; nhấp (không kéo) để đổi S → M → L
    const grip = document.getElementById('sheet-grip');
    let drag = null;
    grip.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, h: S.offsetHeight, moved: false }; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const maxH = innerHeight - this.top.getBoundingClientRect().bottom - 24;
      S.style.height = Math.max(180, Math.min(maxH, drag.h + dy)) + 'px';
      S.classList.add('dragging');
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null; S.classList.remove('dragging');
      if (!d.moved) { this.setSize({ s: 'm', m: 'l', l: 's' }[S.dataset.size]); return; }
      const f = S.offsetHeight / innerHeight;
      S.style.height = '';
      this.setSize(f < 0.38 ? 's' : f < 0.58 ? 'm' : 'l');
    };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', (e) => {
      const order = ['s', 'm', 'l'], i = order.indexOf(S.dataset.size);
      if (e.key === 'ArrowUp') { e.preventDefault(); this.setSize(order[Math.min(2, i + 1)]); } else if (e.key === 'ArrowDown') { e.preventDefault(); this.setSize(order[Math.max(0, i - 1)]); }
    });
    new ResizeObserver(() => { P(this.root, '--sheet-h', Math.round(S.offsetHeight) + 'px'); this._layoutCharts(); this._fitHud(); }).observe(S);
  }
  /** Dựng các nút chọn biểu đồ sau khi main.js tạo xong app.charts. */
  buildChartChips() {
    this.chipBtn = {};
    // thẻ biểu đồ theo đúng thứ tự các nút chọn
    for (const [k] of CHART_CHIPS) if (this.app.charts[k]) this.chartsEl.append(this.app.charts[k].card);
    this.chipsEl.replaceChildren(...CHART_CHIPS.filter(([k]) => this.app.charts[k]).map(([k, label]) => {
      const b = h('button', { class: 'fchip', type: 'button', 'aria-pressed': 'false', onclick: () => this.toggleChart(k) }, h('i', { class: 'fchip-dot', 'aria-hidden': 'true' }), label);
      this.chipBtn[k] = b;
      return b;
    }));
    this._applyChartSel();
  }
  _shown(k) { return this.chartSel.has(k) || this.chartTmp.has(k); }
  toggleChart(k) {
    if (this.chartTmp.has(k)) { if (this.chartSel.size + this.chartTmp.size === 1) return; this.chartTmp.delete(k); this._applyChartSel(); this.app.updateCharts(); return; }
    if (this.chartSel.has(k)) { if (this.chartSel.size === 1) return; this.chartSel.delete(k); } else this.chartSel.add(k);
    this._applyChartSel(); this._save();
    this.app.updateCharts();
  }
  _applyChartSel() {
    for (const [k, c] of Object.entries(this.app.charts || {})) c.card.hidden = !this._shown(k);
    for (const [k, b] of Object.entries(this.chipBtn || {})) {
      const tmp = this.chartTmp.has(k);
      b.classList.toggle('on', this._shown(k)); b.classList.toggle('tmp', tmp); b.setAttribute('aria-pressed', String(this._shown(k)));
      b.title = tmp ? 'Đang tạm hiện (mở từ thẻ chỉ số, tự bỏ khi đóng bảng) – bấm để ẩn' : '';
    }
    this._layoutCharts();
  }
  /** Số cột / số hàng thấy được của lưới biểu đồ theo bề rộng và cỡ bảng; chiều cao canvas theo hàng. */
  _layoutCharts() {
    const body = this.sheetBody, host = this.chartsEl;
    if (!body || !host) return;
    const n = Math.max(1, new Set([...this.chartSel, ...this.chartTmp]).size), w = body.clientWidth - 24, bh = body.clientHeight - 20;
    if (w <= 0 || bh <= 0) return;
    const maxCols = Math.max(1, Math.min(4, Math.floor((w + 10) / (this.mqMobile.matches ? 260 : 280))));
    const rowsFit = Math.max(1, Math.floor((bh + 10) / 190));
    let cols = Math.min(maxCols, n), rows = Math.ceil(n / cols);
    if (rows > rowsFit) rows = rowsFit;
    else if (this.sheet.dataset.size === 'l' && rows === 1 && n > 1 && rowsFit >= 2) { cols = Math.ceil(n / 2); rows = 2; }
    P(host, '--cols', String(cols));
    P(host, '--row-h', Math.max(170, Math.floor((bh - (rows - 1) * 10) / rows)) + 'px');
  }
  /** Cỡ bảng biểu đồ: điện thoại nằm ngang mặc định L (không ghi đè lựa chọn đã lưu cho màn hình lớn). */
  _sizeNow() { return this.mqLand.matches ? (this._landSize || 'l') : this.ui.size; }
  setSize(s, save = true) {
    if (!['s', 'm', 'l'].includes(s)) s = 'm';
    this.sheet.dataset.size = s;
    if (this.mqLand.matches) this._landSize = s; else { this.ui.size = s; if (save) this._save(); }
    this.sizeSeg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.s === s); b.setAttribute('aria-pressed', String(b.dataset.s === s)); });
  }
  toggleSheet(tab) { if (this.sheetOpen && this.sheetTab === tab) this.closeSheet(); else this.openSheet(tab); }
  openSheet(tab = this.sheetTab) {
    this.sheetTab = tab === 'kpi' ? 'kpi' : 'charts';
    const kpi = this.sheetTab === 'kpi';
    this.chartsEl.hidden = kpi; this.kpiEl.hidden = !kpi;
    this.sheet.classList.toggle('tab-kpi', kpi);
    this.sheetTabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.t === this.sheetTab); b.setAttribute('aria-selected', String(b.dataset.t === this.sheetTab)); });
    if (this.mqMobile.matches && this.sideOpen) this.closePane();
    if (!this.sheetOpen) { this.sheetOpen = true; this.sheet.classList.add('open'); this.sheet.inert = false; document.body.classList.add('sheet-open'); }
    this.closePop();
    this._syncDock();
    this._layoutCharts();
    this._fitHud();
    requestAnimationFrame(() => { this._layoutCharts(); if (kpi) this.app.panels.updateKpi(); else this.app.updateCharts(); });
  }
  closeSheet() {
    if (!this.sheetOpen) return;
    const back = this.sheet.contains(document.activeElement) ? this.dk[this.sheetTab] : null;
    this.sheetOpen = false;
    this.sheet.classList.remove('open'); this.sheet.inert = true; document.body.classList.remove('sheet-open');
    if (this.chartTmp.size) { this.chartTmp.clear(); this._applyChartSel(); }
    this._syncDock();
    this._fitHud();
    back?.focus({ preventScroll: true });
  }
  chartsVisible() { return this.sheetOpen && this.sheetTab === 'charts' && this.app.viewMode !== 'hmi'; }
  kpiVisible() { return this.sheetOpen && this.sheetTab === 'kpi' && this.app.viewMode !== 'hmi'; }
  /** Mở bảng biểu đồ, bật và cuộn tới biểu đồ liên quan (nhấp vào thẻ HUD). */
  focusCharts(keys) {
    // biểu đồ chưa chọn chỉ hiện tạm (không lưu vào lựa chọn của người dùng)
    this.chartTmp = new Set(keys.filter((k) => !this.chartSel.has(k) && this.app.charts[k]));
    this._applyChartSel();
    this.openSheet('charts');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = this.app.charts[keys[0]]?.card;
      if (!card) return;
      const b = this.sheetBody, top = card.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 10;
      b.scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' });
      for (const k of keys) { const c = this.app.charts[k]?.card; if (!c) continue; c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
    }));
  }

  // ---------------- HUD chỉ số chính ----------------
  _hud() {
    const a = this.app, cfg = a.cfg, H = this.hudEl;
    this.hc = {};
    const pct = (v, lo, hi) => (100 * (v - lo)) / (hi - lo);
    const lin = (lo, hi, zones, marker) => {
      const fill = h('i', { class: 'lg-fill' }), mk = marker ? h('i', { class: 'lg-mk' }) : null;
      const el = h('span', { class: 'lg', 'aria-hidden': 'true' }, ...zones.map(([z0, z1, cls]) => h('i', { class: 'lg-zone ' + cls, style: `left:${pct(z0, lo, hi)}%;width:${pct(z1, lo, hi) - pct(z0, lo, hi)}%` })), fill, mk);
      return { below: el, set: (v, m) => { P(fill, 'width', (v === undefined || v === null ? 0 : clamp01((v - lo) / (hi - lo)) * 100).toFixed(1) + '%'); if (mk) { mk.hidden = m === undefined || m === null; if (!mk.hidden) P(mk, 'left', (clamp01((m - lo) / (hi - lo)) * 100).toFixed(1) + '%'); } } };
    };
    const arc = (max) => {
      const t = document.createElement('template');
      t.innerHTML = '<svg class="ag" viewBox="0 0 56 32" aria-hidden="true"><path class="ag-bg" d="M6 29a22 22 0 0 1 44 0" pathLength="100"/><path class="ag-v" d="M6 29a22 22 0 0 1 44 0" pathLength="100"/></svg>';
      const el = t.content.firstChild, v = el.lastChild;
      return { side: el, set: (x) => P(v, 'stroke-dashoffset', (100 - 100 * clamp01((x ?? 0) / max)).toFixed(1)) };
    };
    const vbar = (hmax, ticks) => {
      const fill = h('i', { class: 'vb-fill' });
      const el = h('span', { class: 'vb', 'aria-hidden': 'true' }, fill, ...ticks.map(([v, cls]) => h('i', { class: 'vb-tk ' + cls, style: `bottom:${(100 * v / hmax).toFixed(1)}%` })));
      return { side: el, set: (v) => P(fill, 'height', (clamp01((v ?? 0) / hmax) * 100).toFixed(1) + '%') };
    };
    const card = (k, label, tag, unit, g, onclick, title, extra = null) => {
      const val = h('b', { class: 'hc-val' }, '–'), sub = h('span', { class: 'hc-sub' });
      const el = h('button', { class: 'hud-card', type: 'button', 'data-k': k, title, onclick },
        h('span', { class: 'hc-top' }, h('span', { class: 'hc-lbl' }, label), tag ? h('span', { class: 'hc-tag' }, tag) : ''),
        extra ?? h('span', { class: 'hc-main' }, h('span', { class: 'hc-num' }, val, unit ? h('span', { class: 'hc-u' }, unit) : ''), g?.side ?? ''),
        g?.below ?? '', sub);
      this.hc[k] = { el, val, sub, g };
      return el;
    };
    const sv = cfg.service, sf = cfg.safety, lvp = cfg.script.params.level, tankH = cfg.tank.height_m;
    this.kwMax = Math.ceil((cfg.pumps.length * cfg.pump_model.p_motor_kw) / cfg.pump_model.eta_motor_vfd);
    const toCharts = (...k) => () => this.focusCharts(k);
    this.q = {};
    const qrow = (k, label) => { const r = { dot: h('i', { class: 'qd' }), v: h('b', { class: 'mono' }, '–') }; this.q[k] = r; return h('span', { class: 'q-row' }, r.dot, h('span', { class: 'q-l' }, label), r.v); };
    // chip chế độ: chữ "(d)" giữ viết thường dù chip in hoa
    const ctl = { name: h('b', { class: 'ctl-name' }, '–'), modeL: h('span', { class: 'ml' }), modeN: h('span', {}, '–'), pumps: h('span', { class: 'ctl-eq' }) };
    ctl.mode = h('span', { class: 'chip off' }, ctl.modeL, ctl.modeN);
    this.ctlEls = ctl;
    this.pumpEls = cfg.pumps.map((tag) => { const e = { dot: h('i', { class: 'pd' }), t: h('span', {}, '–') }; ctl.pumps.append(h('span', { class: 'pe' }, e.dot, h('b', {}, tag), e.t)); return e; });
    this.valveEl = { dot: h('i', { class: 'pd' }), t: h('span', {}, '–') };
    ctl.pumps.append(h('span', { class: 'pe' }, this.valveEl.dot, h('b', {}, 'MV-02'), this.valveEl.t));
    this.grid = h('div', { class: 'hud-grid', id: 'hud-grid' },
      card('pout', 'Áp đầu ra', 'PT-101', 'bar', lin(0, 5, [[sv.p_out_max_bar, 5, 'z-crit']], true), toCharts('p'), `Áp lực đầu ra trạm (PT-101). Đỏ khi > ${fmt(sv.p_out_max_bar, 1)} bar. Vạch ▼: áp đặt P_set. Nhấp để xem biểu đồ áp lực.`),
      card('pcrit', 'Áp điểm bất lợi', 'PL-301', 'bar', lin(0, 3, [[0, sv.p_crit_min_bar, 'z-crit']], false), toCharts('p'), `Áp lực tại điểm bất lợi nhất của mạng lưới. Đỏ khi < ${fmt(sv.p_crit_min_bar, 1)} bar. Nhấp để xem biểu đồ áp lực.`),
      card('q', 'Lưu lượng ra', 'FT-101', 'm³/h', arc(60), toCharts('q'), 'Lưu lượng ra mạng lưới (FT-101) và lưu lượng nước vào bể. Nhấp để xem biểu đồ lưu lượng.'),
      card('lv', 'Mức bể T-01', 'LT-101', 'm', vbar(tankH, [[lvp.stop_m, 'crit'], [lvp.conserve_m, 'warn'], [sf.level_high_m, 'warn']]), toCharts('lv'), `Mức nước bể chứa. Vạch: dừng bơm ${fmt(lvp.stop_m, 1)} m · giảm áp tiết kiệm ${fmt(lvp.conserve_m, 1)} m · mức cao ${fmt(sf.level_high_m, 1)} m. Nhấp để xem biểu đồ.`),
      card('kw', 'Công suất', 'EM-101', 'kW', arc(this.kwMax), toCharts('kw', 'kwh'), 'Công suất điện tổng của trạm và điện năng lũy kế. Nhấp để xem biểu đồ công suất.'),
      card('qual', 'Chất lượng', 'AIT-20x', '', null, toCharts('ntu', 'cl'), `Clo dư ${fmt(cfg.quality_limits.cl_min, 1)}–${fmt(cfg.quality_limits.cl_max, 1)} mg/L · độ đục ≤ ${fmt(cfg.quality_limits.ntu_max, 0)} NTU · pH ${fmt(cfg.quality_limits.ph_min, 1)}–${fmt(cfg.quality_limits.ph_max, 1)} (QCVN). Nhấp để xem biểu đồ.`,
        h('span', { class: 'q-rows' }, qrow('cl', 'Clo'), qrow('ntu', 'Đục'), qrow('ph', 'pH'))),
      card('ctl', 'Điều khiển', 'GW-01', '', null, () => this.togglePane('mon'), 'Quyền điều khiển và chế độ gateway. Nhấp để mở Giám sát.',
        h('span', { class: 'ctl-main' }, ctl.name, ctl.mode)));
    this.hc.ctl.el.classList.add('wide');
    this.hc.ctl.el.insertBefore(ctl.pumps, this.hc.ctl.sub);
    this.hudToggle = h('button', { class: 'hud-toggle', type: 'button', 'aria-controls': 'hud-grid', onclick: () => this.setHudMin(!this.ui.hudMin) },
      this.liveDot = h('i', { class: 'live' }), h('span', {}, 'Chỉ số vận hành'), ico('chev', 'ico chev'));
    H.append(this.hudToggle, this.grid);
    this.setHudMin(this.ui.hudMin, false);
    new ResizeObserver(() => this._syncBars?.()).observe(H);
  }
  setHudMin(on, save = true) {
    this.ui.hudMin = on;
    document.body.classList.toggle('hud-min', on);
    this.hudToggle.setAttribute('aria-expanded', String(!on));
    this.hudToggle.title = on ? 'Hiện các chỉ số chính' : 'Thu gọn các chỉ số chính';
    if (save) this._save();
    this._fitHud?.();
  }
  /**
   * Bảng biểu đồ mở (màn hình lớn): HUD không được nằm dưới nó. Thu gọn thẻ (bỏ dòng phụ, thước), còn thiếu chỗ thì ẩn bớt thẻ
   * ít quan trọng – thẻ Điều khiển (TỰ ĐỘNG/TAY) luôn giữ. Gọi khi mở/đóng/đổi cỡ bảng, thu gọn HUD, đổi bố cục.
   */
  _fitHud() {
    const H = this.hudEl, cards = this.hc;
    if (!H || !cards) return;
    H.classList.remove('tight');
    for (const c of Object.values(cards)) c.el.classList.remove('hud-cut');
    if (!this.sheetOpen || this.mqMobile.matches || this.ui.hudMin || this.app.viewMode === 'hmi') return;
    const cs = getComputedStyle(this.sheet), top = innerHeight - (parseFloat(cs.bottom) || 0) - this.sheet.offsetHeight - (parseFloat(getComputedStyle(this.root).getPropertyValue('--edge')) || 0);
    const fits = () => H.getBoundingClientRect().bottom <= top;
    if (fits()) return;
    H.classList.add('tight');
    for (const k of ['kw', 'pcrit', 'q', 'qual', 'lv', 'pout']) { if (fits()) break; cards[k].el.classList.add('hud-cut'); }
  }
  _hudUpdate() {
    const a = this.app, cfg = a.cfg, d = stationData(a, 'local'), pl = a.st.plant, sv = cfg.service, sf = cfg.safety, ql = cfg.quality_limits, lvp = cfg.script.params.level;
    const hc = this.hc, inst = d.installed, dead = d.dead;
    const set = (k, v, nd, cls, sub) => { const c = hc[k]; T(c.val, fmt(v, nd)); C(c.el, 'hud-card' + (c.el.classList.contains('wide') ? ' wide' : '') + (cls ? ' ' + cls : '')); if (sub !== undefined) T(c.sub, sub); };
    const st = dead ? ' stale' : '';
    // áp đầu ra
    const p1 = d.p1, pc = d.p_crit;
    set('pout', p1, 2, (p1 > sv.p_out_max_bar || p1 < sf.p_lowlow_bar ? 'crit' : p1 < sf.p_low_bar ? 'warn' : '') + st, `P_set ${fmt(d.p_set, 2)} bar`);
    hc.pout.g.set(p1, d.p_set);
    set('pcrit', pc, 2, pc < sv.p_crit_min_bar ? 'crit' : '', `yêu cầu ≥ ${fmt(sv.p_crit_min_bar, 1)} bar`);
    hc.pcrit.g.set(pc);
    // lưu lượng
    const qin = (inst.has('FT-100') ? 'vào ' : 'vào ≈') + fmt(d.q_in, 1) + ' m³/h';
    set('q', d.q, 1, st.trim(), qin);
    hc.q.g.set(d.q);
    // mức bể
    const lv = d.level;
    set('lv', lv, 2, (lv < lvp.stop_m || lv < sf.level_ll_m ? 'crit' : lv < lvp.conserve_m || lv > sf.level_high_m ? 'warn' : '') + st, `${fmt(pl.volume(), 0)} m³ trong bể`);
    hc.lv.g.set(lv);
    // công suất
    set('kw', d.kw, 2, '', `lũy kế ${fmt(d.kwh, 1)} kWh`);
    hc.kw.g.set(d.kw);
    // chất lượng nước
    let worst = 0;
    const qs = (k, tag, v, nd, bad, warn) => {
      const r = this.q[k];
      if (!inst.has(tag)) { T(r.v, 'không lắp'); C(r.dot, 'qd off'); return; }
      const s = v === null || v === undefined ? 0 : bad(v) ? 2 : warn(v) ? 1 : 0;
      worst = Math.max(worst, s);
      T(r.v, fmt(v, nd)); C(r.dot, 'qd ' + ['good', 'warn', 'crit'][s]);
    };
    qs('cl', 'AIT-201', d.cl, 2, (v) => v < ql.cl_min || v > ql.cl_max, (v) => v < sf.cl_warn_low || v > sf.cl_warn_high);
    qs('ntu', 'AIT-202', d.ntu, 2, (v) => v > ql.ntu_max, (v) => v > sf.ntu_warn);
    qs('ph', 'AIT-203', d.ph, 2, (v) => v < ql.ph_min || v > ql.ph_max, (v) => v < sf.ph_warn_low || v > sf.ph_warn_high);
    const g = a.st.gw;
    C(hc.qual.el, 'hud-card' + ['', ' warn', ' crit'][worst] + st);
    T(hc.qual.sub, g.safety.safe_stop ? 'DỪNG AN TOÀN – ' + g.safety.safe_reason : worst === 2 ? 'không đạt QCVN' : worst === 1 ? 'gần ngưỡng – cảnh báo' : 'đạt QCVN 01-1:2018');
    // quyền điều khiển + chế độ gateway
    const ce = this.ctlEls, man = d.ctl !== 'auto';
    T(ce.name, dead ? 'PID BIẾN TẦN' : CTL_NAME[d.ctl]);
    C(ce.name, 'ctl-name' + (dead ? ' crit' : man ? ' man' : ''));
    // (d): hổ phách khi chỉ có cảnh báo, đỏ khi dừng an toàn / cắt bơm / báo động (app.modeSev)
    const mm = /^(\([a-z]\))\s?(.*)$/.exec(MODE_NAME[d.mode]), dCrit = d.mode === 'd' && a.modeSev() === 'crit';
    T(ce.modeL, mm ? mm[1] : ''); T(ce.modeN, mm ? ' ' + mm[2] : MODE_NAME[d.mode]);
    C(ce.mode, 'chip ' + (d.mode === 'd' ? (dCrit ? 'critical' : 'warning') : MODE_CHIP[d.mode]));
    C(hc.ctl.el, 'hud-card wide' + (dead || dCrit ? ' crit' : man ? ' man' : d.mode === 'b' || d.mode === 'd' ? ' warn' : ''));
    d.pumps.forEach((p, i) => {
      const e = this.pumpEls[i];
      if (!e) return;
      C(e.dot, 'pd ' + (p.fault ? 'crit' : p.running ? 'run' : ''));
      T(e.t, p.fault ? 'LỖI' : p.running ? fmt(p.f, 1, 'Hz') : 'dừng');
    });
    const vf = d.valve, vInst = cfg.hardware['MV-02'] !== false;
    C(this.valveEl.dot, 'pd ' + (!vInst ? 'off' : vf > 0.99 ? 'run' : vf < 0.01 ? 'crit' : 'mid')); // đóng = đỏ (như chú giải HMI)
    T(this.valveEl.t, !vInst ? 'không lắp' : vf > 0.99 ? 'mở' : vf < 0.01 ? 'ĐÓNG' : fmt(vf * 100, 0, '%')); C(this.valveEl.t, vInst && vf < 0.01 ? 'crit' : '');
    T(hc.ctl.sub, dead ? 'Mini PC ngừng – biến tần tự giữ áp' : d.lease_s !== null && d.ctl === 'remote' ? `TAY từ xa còn ${fmtLease(d.lease_s)}` : man ? 'liên động an toàn vẫn có hiệu lực' : `kịch bản v${g.script.version} · ${g.comms.state === 'online' ? 'trực tuyến' : g.comms.state === 'offline' ? 'mất kết nối' : 'đồng bộ'}`);
    C(this.liveDot, 'live' + (a.running ? ' on' : ''));
    this.liveDot.title = a.running ? 'Mô phỏng đang chạy' : 'Mô phỏng đang tạm dừng';
  }

  // ---------------- cửa sổ bật: Camera, Hiển thị, menu ----------------
  _pops() {
    const a = this.app;
    const pop = (id, title, ...kids) => { const el = h('div', { class: 'pop glass', id, role: 'dialog', 'aria-label': title, hidden: true }, h('div', { class: 'pop-h' }, title), ...kids); document.body.append(el); return el; };
    this.popCam = pop('pop-cam', 'Góc nhìn camera',
      h('div', { class: 'cam-grid' }, ...CAMS.map(([k, label, desc, icon]) => h('button', { class: 'cam-btn', type: 'button', 'data-cam': k, onclick: () => { a.scene3d.goto(k); this.cam = k; this._syncCam(); } }, ico(icon), h('b', {}, label), h('small', {}, desc)))),
      h('p', { class: 'note' }, this.mqMobile.matches ? 'Một ngón: xoay · hai ngón: thu phóng / dời' : 'Chuột trái: xoay · chuột phải: dời · cuộn: thu phóng'));
    const lblSeg = h('div', { class: 'seg full', role: 'group', 'aria-label': 'Nhãn thiết bị' },
      ...[['Ẩn', 0], ['Chính', 1], ['Tất cả', 2]].map(([label, m]) => h('button', { 'data-m': m, onclick: () => { this.labelMode = m; a.scene3d.setLabelMode(m); this._syncView(); } }, label)));
    this.lblSeg = lblSeg;
    a.scopeSeg = h('div', { class: 'opt-grid', role: 'group', 'aria-label': 'Lọc theo phạm vi thiết bị' },
      ...SCOPES.map(([k, label]) => h('button', { class: 'opt', 'data-scope': k, onclick: () => a.setScope(k) }, k === 'all' ? h('i', { class: 'sdot all' }) : h('i', { class: 'sdot s-' + k }), label)));
    this.popView = pop('pop-view', 'Hiển thị cảnh 3D',
      h('div', { class: 'pop-sec' }, h('span', { class: 'lbl' }, 'Nhãn số liệu trên thiết bị'), lblSeg),
      h('div', { class: 'pop-sec' }, h('span', { class: 'lbl' }, 'Phạm vi thiết bị (tô màu, làm mờ nhóm khác)'), a.scopeSeg),
      h('div', { class: 'pop-sec' }, h('span', { class: 'lbl' }, 'Chú giải màu'),
        h('ul', { class: 'legend3d' }, ...LEGEND.map(([c, t]) => h('li', {}, h('i', { class: 'dot', style: 'background:' + c }), t)),
          h('li', {}, h('i', { class: 'sdot s-hien_trang' }), 'Hiện trạng (đã có)'), h('li', {}, h('i', { class: 'sdot s-giai_phap' }), 'Giải pháp (đưa vào)'), h('li', {}, h('i', { class: 'sdot s-khuyen_nghi' }), 'Khuyến nghị (nên có)'))),
      h('p', { class: 'note' }, 'Nhấp vào thiết bị trong cảnh để xem tham số; bơm và van mở bảng điều khiển nổi.'));
    this._syncView();
  }
  _syncView() { this.lblSeg?.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.m === this.labelMode); b.setAttribute('aria-pressed', String(+b.dataset.m === this.labelMode)); }); }
  _syncCam() { this.popCam.querySelectorAll('.cam-btn').forEach((b) => b.classList.toggle('on', b.dataset.cam === this.cam)); }
  /** Mở/đóng cửa sổ bật; mở bằng bàn phím (e.detail = 0) thì đưa tiêu điểm vào phần tử đầu tiên. */
  togglePop(el, btn, e) { if (this.pop?.el === el) this.closePop(); else this.openPop(el, btn, e?.detail === 0); }
  openPop(el, btn, focus = false) {
    this.closePop();
    this._tip(null);
    el.hidden = false;
    this.pop = { el, btn };
    btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on');
    this._placePop();
    if (el === this.popView) this._syncView();
    if (el === this.popCam) this._syncCam();
    if (focus) el.querySelector('button, select')?.focus({ preventScroll: true });
  }
  _placePop() {
    const { el, btn } = this.pop, s = el.style;
    s.left = s.right = s.top = s.bottom = '';
    if (el === this.menu) {
      s.top = (this.top.getBoundingClientRect().bottom + 6) + 'px';
      if (!this.mqMobile.matches) s.right = Math.max(8, innerWidth - btn.getBoundingClientRect().right) + 'px';
      return;
    }
    const r = btn.getBoundingClientRect(), d = this.dockEl.getBoundingClientRect();
    if (this.mqMobile.matches) { s.bottom = (innerHeight - d.top + 8) + 'px'; return; }
    s.right = (innerWidth - d.left + 10) + 'px';
    const topMin = this.top.getBoundingClientRect().bottom + 8;
    s.top = Math.max(topMin, Math.min(innerHeight - el.offsetHeight - 10, r.top - 8)) + 'px';
  }
  closePop(focusBack = false) {
    if (!this.pop) return;
    const { el, btn } = this.pop;
    el.hidden = true; this.pop = null;
    btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('on');
    if (focusBack) btn.focus({ preventScroll: true });
  }
  /**
   * Một ngăn xếp Esc cho cả trang, đóng lớp mở sau cùng trước: cửa sổ bật → thẻ thông tin → bảng điều khiển nổi 3D → bảng
   * bên phải → bảng biểu đồ. Phím đã được xử lý ở chỗ khác (mặt điều khiển HMI…) thì bỏ qua; màn HMI không có bảng bên/biểu đồ.
   */
  _onKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!document.getElementById('intro').hidden) return;
    const a = this.app, c = a.ctl3d, hmi = a.viewMode === 'hmi', done = () => e.preventDefault();
    if (this.pop) { this.closePop(true); done(); return; }
    if (!this.drawer.hidden) { a.closeDrawer(); done(); return; }
    if (!hmi && c && (c.isOpen ? c.isOpen() : c.cur)) { c.close(); done(); return; }
    if (hmi) return;
    if (this.sideOpen) { this.closePane(); done(); return; }
    if (this.sheetOpen) { this.closeSheet(); done(); }
  }

  // ---------------- cập nhật mỗi nhịp ----------------
  _syncDock() {
    const on = (k, v) => { const b = this.dk[k]; if (!b) return; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); };
    on('charts', this.sheetOpen && this.sheetTab === 'charts');
    on('kpi', this.sheetOpen && this.sheetTab === 'kpi');
    for (const k of Object.keys(PANES)) on(k, this.sideOpen && this.paneKey === k);
  }
  _syncManual() {
    const a = this.app, b = this.dk.manual, c = a.ctl3d;
    if (!b || !c || !a.st) return;
    const dead = Boolean(a.st.gw_dead), src = dead ? 'auto' : a.st.gw.controlSrc(), on = src === 'local', rem = src === 'remote';
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('rem', rem);
    b.classList.toggle('off', dead); b.setAttribute('aria-disabled', String(dead));
    const lease = rem ? stationData(a, 'local').lease_s : null;
    const tip = dead ? 'Không dùng được: mini PC đang ngừng, HMI-01 mất kết nối với bộ điều khiển – biến tần tự chạy PID nội.'
      : on ? 'Đang TAY tại chỗ: nhấp vào bơm hoặc van MV-02 trong cảnh 3D để ra lệnh. Bấm để trả về TỰ ĐỘNG theo kịch bản.'
        : rem ? `Trung tâm đang giữ quyền TAY từ xa${lease !== null ? ' (còn ' + fmtLease(lease) + ')' : ''}. Bấm để giành quyền TAY TẠI CHỖ – quyền tại trạm ưu tiên, lệnh từ trung tâm sẽ bị từ chối; trạm vẫn ở chế độ TAY.`
          : 'Bấm để chuyển trạm sang điều khiển TAY tại chỗ, rồi nhấp vào bơm / van trong cảnh 3D để ra lệnh. Lớp an toàn vẫn luôn ghi đè.';
    if (b.dataset.tip !== tip) { b.dataset.tip = tip; if (this._tipFor === b) this._tip(b); }
  }
  /** Gọi từ App._updatePanels (250 ms) – chỉ ghi DOM khi giá trị đổi. */
  update(force = false) {
    if (!this.app.st) return;
    if (this.app.viewMode !== 'hmi') this._hudUpdate();
    this._syncManual();
    if (this.sideOpen && this.paneKey === 'alarm') this.updateAlarms(force);
  }
}
