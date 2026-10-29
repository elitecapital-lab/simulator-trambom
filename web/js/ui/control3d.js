// Điều khiển thiết bị ngay trong cảnh 3D: bảng điều khiển nổi (faceplate) gắn vào bơm/biến tần/van/tủ và dấu điều khiển TAY trong cảnh.
// Người dùng trong cảnh 3D coi như đang đứng trong trạm: lệnh mặc định đi thẳng vào gateway ('local', như HMI-01);
// trên bảng nổi có thể giả lập lệnh từ trung tâm ('remote': qua máy chủ và MQTT, hết hạn sau 60 s) – chỉ cho bảng đang mở;
// dấu điều khiển trong cảnh và nút "Trả về TỰ ĐỘNG" trên khung hổ phách luôn là thao tác tại trạm.
// Mọi quy tắc (quyền tại chỗ ưu tiên, liên động, giới hạn tần số, số lần khởi động) do gateway thực thi – ở đây chỉ hiển thị và giải thích.
import { h, fmt, tShort } from './dom.js';
import { CMD_STATUS, CTL_NAME, MODE_CHIP, MODE_NAME, canCommand, cmdName, commandLog, firstBlock, fmtLease, needsReset, permissives, sendCommand, stationData, viNum } from './ops.js';

const PUMP_OF = { 'P-01': 0, 'P-02': 1, 'VFD-01': 0, 'VFD-02': 1 };
const PUMP_TAG = ['P-01', 'P-02'];
const PUMP_DESC = ['Bơm tăng áp số 1', 'Bơm tăng áp số 2'];
const MARK_TAGS = ['P-01', 'P-02', 'MV-02'];
const PUMP_CMDS = ['pump_start', 'pump_stop', 'pump_speed'];
const NS = 'http://www.w3.org/2000/svg';
// SA-01/02 là công tắc cứng Tay/0/Tự động trên tủ CP-01 (khác chế độ TAY phần mềm) → chỉ có thẻ thông tin;
// bảng chế độ trạm mở từ tủ điều khiển CP-02 (mini PC, HMI-01)
const kindOf = (tag) => (tag in PUMP_OF ? 'pump' : tag === 'MV-02' ? 'valve' : tag === 'CP-02' ? 'station' : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ovl = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
// chỉ chạm DOM khi giá trị thực sự đổi
const txt = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const cls = (el, c) => { if (el._c !== c) { el._c = c; el.className = c; } };
const show = (el, on) => { if (el.hidden === Boolean(on)) el.hidden = !on; };
const dis = (el, off) => { if (el.disabled !== Boolean(off)) el.disabled = Boolean(off); };
const attr = (el, k, v) => { const s = String(v); if (el.getAttribute(k) !== s) el.setAttribute(k, s); };
const COMMS = { online: '4G trực tuyến', resync: 'đang đồng bộ', offline: 'MẤT KẾT NỐI' };

export class Control3D {
  constructor(app, host) {
    this.app = app; this.host = host;
    this.where = 'local'; // vị trí ra lệnh của bảng nổi: 'local' tại trạm | 'remote' giả lập trung tâm
    this.cur = null; this.permOpen = false;
    this.W = host.clientWidth || 800; this.H = host.clientHeight || 500;
    this.cw = 316; this.ch = 420; this.side = 0; this.sheet = false; this.land = false; this.mkOn = false;
    this._p = {}; this._dr = {}; this._n = 0; this._lead = {}; this._occ = []; this._sent = new Map(); this._armed = null;
    this._build();
    this._ro = new ResizeObserver((es) => {
      for (const e of es) {
        const el = e.target;
        if (el === host) { this.W = host.clientWidth; this.H = host.clientHeight; this._layoutMode(); }
        else if (el._mk) { el._mk.w = el.offsetWidth; el._mk.h = el.offsetHeight; }
        else if (this.cur && el === this.cur.el) { this.cw = el.offsetWidth; this.ch = el.offsetHeight; }
      }
    });
    this._ro.observe(host);
    for (const m of this.markers) this._ro.observe(m.el);
    // tấm trượt theo đúng mốc "điện thoại" của shell (rộng ≤ 720 hoặc thấp ≤ 500 px, gồm cả điện thoại nằm ngang)
    this._mq = app.shell?.mqMobile || null;
    this._mq?.addEventListener?.('change', () => this._layoutMode());
    this._layoutMode();
    // Esc: Shell xử lý chung (đóng bảng nổi khi isOpen()); khi focus nằm trong bảng thì bảng tự bắt Esc (xem _card)
    const sc = app.scene3d;
    if (sc) {
      sc.hoverHint = (tag) => (tag === 'HMI-01' ? 'Nhấp để mở màn hình HMI' : this.handles(tag) ? 'Nhấp để mở bảng điều khiển' : 'Nhấp để xem thông tin');
      sc.occluders = () => this._occluders();
    }
  }

  /** Thiết bị điều khiển được không (bơm, biến tần, van MV-02, tủ CP-02 – chế độ trạm, màn HMI-01). */
  handles(tag) { return Boolean(kindOf(tag)) || tag === 'HMI-01'; }
  /** Bảng điều khiển nổi đang mở không (Shell dùng cho phím Esc). */
  isOpen() { return Boolean(this.cur); }
  /** Mở bảng điều khiển nổi cho thiết bị; trả về false nếu không điều khiển được (main.js mở thẻ thông tin). */
  open(tag) {
    if (tag === 'HMI-01') { this.close(); this.app.setView('hmi'); return true; }
    const kind = kindOf(tag);
    if (!kind) return false;
    if (this.cur && this.cur.tag === tag) { this.update(true); return true; }
    const ae = document.activeElement, ret = this.cur && this.cur.el.contains(ae) ? this._ret : ae;
    this.close(false);
    const C = this._card(kind, tag);
    this.cur = C; this.side = 0; this._ret = ret && ret !== document.body ? ret : null;
    C.reveal = this.sheet; // tấm trượt: sau khi đặt xong, dời camera nếu tấm che thiết bị
    this.layer.append(C.el);
    this._ro.observe(C.el);
    cls(C.el, this._cardCls(C)); this._arrange(C);
    txt(this.offTxt, `${tag} ngoài khung nhìn · Xem`);
    const sc = this.app.scene3d;
    sc.highlight(tag);
    this._syncLabels();
    if (this.app.st) this.update(true);
    this.cw = C.el.offsetWidth || this.cw; this.ch = C.el.offsetHeight || this.ch;
    if (!sc.bodyPos(tag, this._p).visible) sc.focus(tag);
    this.frame();
    C.el.focus({ preventScroll: true }); // bàn phím: Tab đi tiếp trong bảng, Esc đóng
    return true;
  }
  /** Đóng bảng nổi; vị trí ra lệnh trở về "Tại trạm". restore: trả focus về chỗ cũ nếu focus đang trong bảng. */
  close(restore = true) {
    this.where = 'local';
    if (!this.cur) return;
    const C = this.cur, had = C.el.contains(document.activeElement);
    if (C.revealed) this.app.scene3d?.unreveal();
    this.vig.classList.remove('lft');
    this._ro.unobserve(C.el);
    C.el.remove();
    this.cur = null;
    this.lead.style.display = 'none'; this.offHint.hidden = true;
    this.app.scene3d?.highlight(null);
    this._syncLabels();
    if (this.app.st) this.update(true);
    const r = this._ret;
    this._ret = null;
    if (restore && had && r && r.isConnected && r.getClientRects().length && r.focus) r.focus({ preventScroll: true });
  }
  /** Chế độ TAY đang bật (theo quyền điều khiển thực của gateway, mọi nguồn). */
  get manualMode() { return Boolean(this.app.st && !this.app.st.gw_dead && this.app.st.gw.controlSrc() !== 'auto'); }
  /** Bật/tắt chế độ TAY tại chỗ từ cảnh 3D. */
  setManualMode(on) { return this._sendAs('local', 'set_mode', { mode: on ? 'manual' : 'auto' }, '*'); }
  /** Đổi vị trí ra lệnh của bảng nổi: 'local' (tại trạm) | 'remote' (từ trung tâm). Đóng bảng thì trở về 'local'. */
  setWhere(w) { this.where = w === 'remote' ? 'remote' : 'local'; if (this.cur) cls(this.cur.el, this._cardCls(this.cur)); this.update(true); }

  // ---------------- dựng lớp phủ ----------------
  _build() {
    // khung viền hổ phách + nhãn khi trạm ở chế độ TAY; nút trả về TỰ ĐỘNG là thao tác tại trạm
    this.vgTitle = h('b'); this.vgSub = h('small');
    this.vgBtn = h('button', { class: 'c3d-vg-btn', onclick: () => this._sendAs('local', 'set_mode', { mode: 'auto' }, '*') }, 'Trả về TỰ ĐỘNG');
    this.vgTab = h('div', { class: 'c3d-vg-tab', role: 'status' }, h('i', { class: 'c3d-vg-dot', 'aria-hidden': 'true' }), h('span', { class: 'c3d-vg-txt' }, this.vgTitle, this.vgSub), this.vgBtn);
    this.vig = h('div', { class: 'c3d-vig', hidden: true }, this.vgTab);
    this.layer = h('div', { class: 'c3d-layer' });
    this.lead = document.createElementNS(NS, 'svg');
    this.lead.setAttribute('class', 'c3d-lead'); this.lead.setAttribute('aria-hidden', 'true');
    this.leadLine = document.createElementNS(NS, 'line');
    this.leadDot = document.createElementNS(NS, 'circle'); this.leadDot.setAttribute('r', '5');
    this.leadHalo = document.createElementNS(NS, 'circle'); this.leadHalo.setAttribute('r', '11'); this.leadHalo.setAttribute('class', 'halo');
    this.lead.append(this.leadLine, this.leadHalo, this.leadDot);
    this.lead.style.display = 'none';
    this.offArrow = h('i', { 'aria-hidden': 'true' }); this.offTxt = h('span');
    this.offHint = h('button', { class: 'c3d-off', hidden: true, title: 'Đưa camera tới thiết bị', onclick: () => this.cur && this.app.scene3d.focus(this.cur.tag) }, this.offArrow, this.offTxt);
    this.markers = MARK_TAGS.map((tag) => this._marker(tag));
    this.layer.append(this.lead, ...this.markers.map((m) => m.el), this.offHint);
    this.host.append(this.vig, this.layer);
  }
  _layoutMode() {
    const narrow = Boolean(this._mq && this._mq.matches) || (this.W > 0 && (this.W < 600 || this.H < 500));
    this.sheet = narrow; this.land = narrow && this.W >= 600 && this.W > this.H * 1.3; // điện thoại nằm ngang: tấm trượt neo bên phải
    this.vig.classList.toggle('narrow', narrow); this.vig.classList.toggle('land', this.land);
    this.layer.classList.toggle('narrow', narrow);
    if (this.cur) {
      const C = this.cur;
      cls(C.el, this._cardCls(C)); this._arrange(C);
      for (const k of ['transform', 'maxHeight', 'maxWidth', 'bottom']) C.el.style[k] = '';
      C.tx = C.ty = C.availH = C.availW = C.bt = null;
    }
    this._tabOffset();
  }
  _cardCls(C) { return 'c3d-card' + (this.sheet ? ' c3d-sheet' : '') + (this.land ? ' land' + (C.lft ? ' lft' : '') : '') + (this.where === 'remote' ? ' remote' : ''); }
  /** Tấm trượt: khối lệnh (Chạy/Dừng/tần số…) ngay dưới đầu thẻ để thấy mà không phải cuộn; bảng nổi: thứ tự thường. */
  _arrange(C) {
    if (this.sheet) C.head.after(C.dead, C.ctlSec);
    else { C.wnote.after(C.dead); C.srcSec.after(C.ctlSec); }
  }
  /** Nhãn chế độ TAY nằm giữa mép trên; nếu khung 3D có thanh công cụ ở trên (.vp-tools) thì đặt ngay dưới thanh đó. */
  _tabOffset() {
    if (this.vig.hidden) return;
    const tools = this.host.querySelector(':scope > .vp-tools');
    const top = !this.sheet && tools && tools.offsetParent === this.host && tools.offsetHeight ? tools.offsetTop + tools.offsetHeight + 8 : 0;
    this.vig.style.setProperty('--c3d-tab-top', top + 'px');
    this.vig.classList.toggle('float', top > 0);
  }
  _marker(tag) {
    const m = { tag, i: PUMP_OF[tag] ?? null, p: {}, hide: true, w: 0, h: 0 };
    m.ico = h('i', { class: 'c3d-ico play' });
    m.btn = h('button', { class: 'c3d-mk-btn', onclick: () => this._markerCmd(m) }, m.ico, m.btnTxt = h('span'));
    m.val = h('span');
    m.open = h('button', { class: 'c3d-mk-open', title: 'Mở bảng điều khiển ' + tag, onclick: () => this.open(tag) }, h('i', { class: 'c3d-mk-dot', 'aria-hidden': 'true' }), h('b', {}, tag), m.val);
    m.el = h('div', { class: 'c3d-mk stop', hidden: true, 'data-tag': tag }, m.btn, m.open, h('i', { class: 'c3d-mk-edge', 'aria-hidden': 'true' }));
    m.el._mk = m;
    return m;
  }
  /**
   * Dấu điều khiển = người đứng trong trạm: lệnh luôn gửi "tại trạm", không theo lựa chọn của bảng nổi.
   * Trung tâm đang giữ quyền TAY: lần nhấp đầu mở bảng điều khiển (có cảnh báo giành quyền) thay vì lặng lẽ giành quyền.
   */
  _markerCmd(m) {
    const d = stationData(this.app, 'local');
    if (d.ctl === 'remote' && this._armed !== m.tag) { this._armed = m.tag; this.open(m.tag); return; }
    this._armed = null;
    if (m.i !== null) {
      const p = d.pumps[m.i];
      this._sendAs('local', p.running || p.want ? 'pump_stop' : 'pump_start', { pump: m.i }, m.tag);
    } else this._sendAs('local', 'valve', { open: !this._valveWant(d) }, 'MV-02');
  }
  _valveWant(d) { const g = this.app.st.gw; return g.manual ? g.manual.valve : (d.valve ?? 1) > 0.5; }

  // ---------------- bảng điều khiển nổi ----------------
  _card(kind, tag) {
    const C = { kind, tag, i: PUMP_OF[tag] ?? null, tx: null, ty: null, editing: false };
    const i = C.i;
    C.dev = kind === 'pump' ? PUMP_TAG[i] : kind === 'valve' ? 'MV-02' : 'ST-01';
    C.pill = h('span', { class: 'c3d-pill' });
    const title = kind === 'pump' ? [h('b', {}, PUMP_TAG[i]), ' · ' + PUMP_DESC[i]] : kind === 'valve' ? [h('b', {}, 'MV-02'), ' · Van điện đầu ra'] : [h('b', {}, 'ST-01'), ' · Chế độ trạm'];
    const nw = (x) => h('span', { class: 'c3d-nw' }, x);
    const sub = kind === 'pump' ? (tag.startsWith('VFD') ? ['Mở từ biến tần ', nw(tag), ' · tủ CP-01'] : ['Bơm ly tâm 5,5 kW · biến tần ', nw(`VFD-0${i + 1}`)])
      : kind === 'valve' ? 'Van bướm điện, hành trình 20 s · ra mạng DMA-A' : ['Tủ ', nw('CP-02'), ': mini PC ', nw('MPC-01'), ', màn ', nw('HMI-01')];
    // vị trí ra lệnh: nằm trong đầu thẻ (luôn thấy), đổi màu khi giả lập trung tâm
    C.where = h('div', { class: 'c3d-seg', role: 'group', 'aria-label': 'Ra lệnh từ đâu' },
      ...[['local', 'Tại trạm'], ['remote', 'Từ trung tâm']].map(([w, l]) => h('button', { 'data-w': w, onclick: () => this.setWhere(w) }, l)));
    C.org = h('small', { class: 'c3d-org' });
    C.wnote = h('p', { class: 'c3d-note', hidden: true });
    C.deadNote = h('small');
    C.dead = h('div', { class: 'c3d-dead', hidden: true, role: 'alert' }, h('b', {}, 'Mini PC ngừng – không điều khiển được'), C.deadNote);
    // quyền điều khiển + chuyển chế độ
    C.srcChip = h('span', { class: 'chip' }); C.srcNote = h('small', { class: 'c3d-sub' });
    C.btnMan = h('button', { class: 'btn small', onclick: () => this._send('set_mode', { mode: 'manual' }) });
    C.btnAuto = h('button', { class: 'btn small', onclick: () => this._send('set_mode', { mode: 'auto' }) }, 'Trả về TỰ ĐỘNG');
    C.hintBtn = h('button', { class: 'btn small c3d-amber', onclick: () => this._send('set_mode', { mode: 'manual' }) });
    C.hint = h('p', { class: 'c3d-hint', hidden: true }, h('span', {}, 'Trạm đang TỰ ĐỘNG – chuyển sang TAY để điều khiển'), C.hintBtn);
    C.auth = h('p', { class: 'c3d-warn', hidden: true });
    C.srcSec = h('section', { class: 'c3d-sec c3d-mode' }, h('div', { class: 'c3d-row between' }, h('span', { class: 'c3d-k' }, 'Quyền điều khiển'), C.srcChip),
      h('div', { class: 'c3d-row' }, C.btnMan, C.btnAuto), C.srcNote, C.auth);
    // lệnh cuối (ở chân thẻ)
    C.last = h('div', { class: 'c3d-last', 'aria-live': 'polite' });
    const body = kind === 'pump' ? this._pumpBody(C) : kind === 'valve' ? this._valveBody(C) : this._stationBody(C);
    C.ctlSec = body.ctl;
    C.head = h('header', { class: 'c3d-head' },
      h('div', { class: 'c3d-name' }, ...title),
      h('div', { class: 'c3d-hbtns' },
        h('button', { class: 'c3d-x c3d-info', title: 'Chi tiết thiết bị', onclick: () => this.app.openDrawer(tag) }, h('span', { 'aria-hidden': 'true' }, 'i'), h('span', { class: 'c3d-sr' }, 'Chi tiết thiết bị')),
        h('button', { class: 'c3d-x', title: 'Đóng (Esc)', 'aria-label': 'Đóng bảng điều khiển', onclick: () => this.close() }, '×')),
      h('small', { class: 'c3d-hsub' }, ...[sub].flat()), C.pill,
      h('div', { class: 'c3d-where' }, h('span', { class: 'c3d-wl' }, h('span', { class: 'c3d-k' }, 'Ra lệnh'), C.org), C.where));
    C.foot = h('footer', { class: 'c3d-foot' }, C.last);
    C.el = h('div', { class: 'c3d-card', role: 'dialog', tabindex: '-1', 'aria-label': `Bảng điều khiển ${tag}`, 'data-kind': kind },
      C.head, C.wnote, C.dead, body.live, C.srcSec, body.ctl, C.foot);
    // focus trong bảng: Esc đóng bảng, không để Shell đóng thêm khung khác
    C.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    return C;
  }
  _tile(C, k, label, unit, title = null) {
    C['v_' + k] = h('b');
    C['u_' + k] = h('small', {}, unit);
    return h('div', { class: 'c3d-tile', title }, h('span', {}, label), h('div', {}, C['v_' + k], C['u_' + k]));
  }
  _pumpBody(C) {
    const i = C.i;
    C.fbar = h('i'); C.seen = h('p', { class: 'c3d-note', hidden: true });
    C.spark = h('canvas', { class: 'c3d-spark', 'aria-hidden': 'true' });
    C.btnRun = h('button', { class: 'btn c3d-cmd', onclick: () => this._run() }, h('i', { class: 'c3d-ico play' }), 'Chạy');
    C.btnStop = h('button', { class: 'btn c3d-cmd', onclick: () => this._send('pump_stop', { pump: i }) }, h('i', { class: 'c3d-ico stop' }), 'Dừng');
    C.rangeVal = h('b', { class: 'mono' });
    C.range = h('input', { type: 'range', min: 25, max: 50, step: 0.5, value: 40, 'aria-label': `Tần số đặt ${PUMP_TAG[i]} (Hz)`,
      oninput: () => { C.editing = true; txt(C.rangeVal, fmt(+C.range.value, 1, 'Hz')); } });
    C.btnSpeed = h('button', { class: 'btn small', onclick: () => { C.editing = false; this._send('pump_speed', { pump: i, f_hz: +C.range.value }); } }, 'Đặt tần số');
    C.block = h('p', { class: 'c3d-warn', hidden: true });
    C.permHead = h('button', { class: 'c3d-permhead', 'aria-expanded': 'false', onclick: () => { this.permOpen = !this.permOpen; this.update(true); } });
    C.permList = h('ul', { class: 'c3d-perm', hidden: true });
    const live = h('section', { class: 'c3d-sec' },
      h('div', { class: 'c3d-row between' }, h('span', { class: 'c3d-k' }, 'Thực tế tại trạm'), h('small', { class: 'c3d-sub' }, 'xu hướng tần số 60 phút')),
      h('div', { class: 'c3d-tiles' }, this._tile(C, 'f', 'Tần số', 'Hz'), this._tile(C, 'kw', 'Công suất', 'kW'), this._tile(C, 'a', 'Dòng điện', 'A'), this._tile(C, 'p', 'Áp đẩy', 'bar', `Đồng hồ áp PI-10${i + 1} trên ống đẩy`)),
      h('div', { class: 'c3d-meter', title: 'Tần số so với 50 Hz' }, C.fbar), C.spark, C.seen);
    const ctl = h('section', { class: 'c3d-sec c3d-ctl' }, C.hint,
      h('div', { class: 'c3d-cmds' }, C.btnRun, C.btnStop),
      h('div', { class: 'c3d-freq' }, C.range, C.rangeVal, C.btnSpeed), C.block, C.permHead, C.permList);
    return { live, ctl };
  }
  _valveBody(C) {
    C.fbar = h('i');
    C.btnOpen = h('button', { class: 'btn c3d-cmd', onclick: () => this._send('valve', { open: true }) }, 'Mở van');
    C.btnClose = h('button', { class: 'btn c3d-cmd', onclick: () => this._send('valve', { open: false }) }, 'Đóng van');
    C.lock = h('p', { class: 'c3d-note' });
    C.block = h('p', { class: 'c3d-warn', hidden: true });
    const live = h('section', { class: 'c3d-sec' }, h('span', { class: 'c3d-k' }, 'Thực tế tại trạm'),
      h('div', { class: 'c3d-tiles t3' }, this._tile(C, 'pos', 'Độ mở', '%'), this._tile(C, 'cmd', 'Lệnh TAY', ''), this._tile(C, 'mv', 'Hành trình', '')),
      h('div', { class: 'c3d-meter', title: 'Độ mở van' }, C.fbar));
    const ctl = h('section', { class: 'c3d-sec c3d-ctl' }, C.hint, h('div', { class: 'c3d-cmds' }, C.btnOpen, C.btnClose), C.block, C.lock);
    return { live, ctl };
  }
  _stationBody(C) {
    // bảng dựng một lần, mỗi nhịp chỉ đổi chữ trong ô giá trị
    C.vals = [];
    C.rows = h('tbody', {}, ...['Chế độ gateway', 'Lớp an toàn', 'Bơm', 'Áp ra PT-101 / đặt', 'Kết nối'].map((k) => { const td = h('td', { class: 'wrap' }); C.vals.push(td); return h('tr', {}, h('td', {}, k), td); }));
    C.safeRow = C.rows.children[1];
    C.spark = h('canvas', { class: 'c3d-spark', 'aria-hidden': 'true' });
    C.btnReset = h('button', { class: 'btn small', onclick: () => this._send('reset_safe_stop', {}) }, 'Đặt lại dừng an toàn');
    C.btnRotate = h('button', { class: 'btn small', onclick: () => this._send('rotate_pumps', {}) }, 'Luân phiên bơm');
    C.lock = h('p', { class: 'c3d-note' });
    const live = h('section', { class: 'c3d-sec' }, h('div', { class: 'c3d-row between' }, h('span', { class: 'c3d-k' }, 'Thực tế tại trạm'), h('small', { class: 'c3d-sub' }, 'áp ra PT-101 (liền) / áp đặt (đứt), 60 phút')),
      h('table', { class: 'kv fixed c3d-kv' }, C.rows), C.spark);
    const ctl = h('section', { class: 'c3d-sec c3d-ctl' }, h('span', { class: 'c3d-k' }, 'Chức năng trạm'), h('div', { class: 'c3d-row' }, C.btnReset, C.btnRotate), C.lock);
    return { live, ctl };
  }

  // ---------------- lệnh ----------------
  /** Gửi lệnh từ một vị trí; nhớ lệnh thuộc thiết bị nào (dev) để thẻ lọc "Lệnh cuối" theo thiết bị. */
  _sendAs(where, type, args, dev) {
    const g = this.app.st.gw, n0 = g.cmd_results.length;
    const res = sendCommand(this.app, where, type, args);
    const id = res.id || (g.cmd_results.length > n0 ? g.cmd_results[g.cmd_results.length - 1].id : null);
    if (id) {
      this._sent.set(id, dev);
      if (this._sent.size > 300) this._sent.delete(this._sent.keys().next().value);
      if (this.cur) { this.cur.lastKey = null; this.update(true); }
    }
    return res;
  }
  _send(type, args) { return this._sendAs(this.where, type, args, type === 'set_mode' ? '*' : this.cur ? this.cur.dev : '*'); }
  _run() {
    const C = this.cur, p = this.app.st.plant.pumps[C.i], args = { pump: C.i };
    // bơm đang dừng (hoặc vừa kéo thanh trượt): chạy ở tần số trên thanh trượt; đang chạy: giữ tần số đặt
    if (!p.running || C.editing) args.f_hz = +C.range.value;
    C.editing = false;
    this._send('pump_start', args);
  }
  /** Lệnh cuối liên quan tới thiết bị của thẻ (từ vị trí đang chọn); đổi chế độ áp dụng cho mọi thẻ. */
  _lastFor(C) {
    for (const c of commandLog(this.app, this.where, 40)) {
      const dev = this._sent.get(c.id);
      if (dev !== undefined) { if (dev === '*' || dev === C.dev) return c; continue; }
      if (c.type === 'set_mode') return c;
      if (C.kind === 'station') { if (c.type === 'reset_safe_stop' || c.type === 'rotate_pumps') return c; }
      else if (C.kind === 'valve') { if (c.type === 'valve') return c; }
      else if (PUMP_CMDS.includes(c.type) && (c.reason || '').includes(C.dev)) return c;
    }
    return null;
  }
  /** Lệnh chạy TAY bị lớp an toàn hủy sau khi gateway đã nhận (cờ chạy bị xóa, cần lệnh mới): { t, why } hoặc null. */
  _cancelled(C) {
    const g = this.app.st.gw, tag = C.dev, R = g.cmd_results, L = g.logs;
    let tc = null;
    for (let k = R.length - 1, n = 0; k >= 0 && n < 40; k--, n++) {
      const c = R[k];
      if (c.status === 'ok' && (c.type === 'pump_start' || c.type === 'pump_stop') && (c.reason || '').includes(tag)) { if (c.type === 'pump_start') tc = c.t; break; }
    }
    if (tc === null) return null;
    for (let k = L.length - 1, n = 0; k >= 0 && n < 300; k--, n++) {
      const e = L[k];
      if (e.t < tc) break;
      if (e.level === 'safety' && (e.text.startsWith('Liên động an toàn dừng ' + tag) || e.text.startsWith(tag + ' báo lỗi khi đang chạy TAY'))) {
        const m = e.text.match(/\(([^)]*)\)/);
        return { t: e.t, why: m ? viNum(m[1]) : 'bơm/biến tần báo lỗi' };
      }
    }
    return null;
  }

  // ---------------- cập nhật (mỗi 250 ms) ----------------
  /** Gọi mỗi 250 ms: cập nhật số liệu, trạng thái nút, vùng che của lớp giao diện. */
  update(force = false) {
    const a = this.app;
    if (!a.st) return;
    if (a.st !== this._st) { this._st = a.st; this._sent.clear(); this._armed = null; } // chạy lại kịch bản: mã lệnh đếm lại từ đầu
    if (a.viewMode !== 'hmi') this._occ = this._readOcc();
    const man = this.manualMode;
    if (!this.cur && !man && !this.mkOn && this.vig.hidden) return;
    const d = stationData(a, 'local');
    this._d = d;
    this._updVignette(d, man);
    this._updMarkers(d, man);
    if (this.cur) this._updCard(d, force);
  }
  /** Vùng màn hình bị lớp giao diện cố định che (thanh trên, HUD, dock, dải chế độ, khung bên phải, tấm biểu đồ, thẻ thông tin, nhãn TAY). */
  _readOcc() {
    const r0 = this.host.getBoundingClientRect(), B = document.body.classList, out = [];
    const add = (el) => {
      if (!el || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ l: r.left - r0.left, t: r.top - r0.top, r: r.right - r0.left, b: r.bottom - r0.top });
    };
    for (const id of ['topbar', 'hud', 'dock', 'banner', 'drawer']) add(document.getElementById(id));
    if (B.contains('side-open')) add(document.getElementById('side'));
    if (B.contains('sheet-open')) add(document.getElementById('sheet'));
    if (!this.vig.hidden && getComputedStyle(this.vgTab).display !== 'none') add(this.vgTab);
    const bn = document.getElementById('banner');
    this._banB = bn && !bn.hidden ? bn.getBoundingClientRect().bottom - r0.top : 0; // dải chế độ (b/c/d) dưới thanh trên
    this._sheetRect = null;
    if (this.cur && this.sheet) { const r = this.cur.el.getBoundingClientRect(); this._sheetRect = { l: r.left - r0.left, t: r.top - r0.top, r: r.right - r0.left, b: r.bottom - r0.top }; }
    return out;
  }
  /** Chữ nhật của bảng nổi đang mở (pixel trong khung) hoặc null. */
  _cardRect() {
    const C = this.cur;
    if (!C) return null;
    if (this.sheet) return this._sheetRect || null;
    if (C.tx === null) return null;
    return { l: C.tx, t: C.ty, r: C.tx + Math.min(this.cw, C.availW || this.cw), b: C.ty + Math.min(this.ch, C.availH || this.ch) };
  }
  /** Vùng che nhãn 3D (scene3d gỡ chồng nhãn): lớp giao diện + bảng nổi + dấu điều khiển đang hiện. */
  _occluders() {
    const out = this._occ.slice(), c = this._cardRect();
    if (c) out.push(c);
    if (this.mkOn) for (const m of this.markers) if (!m.hide && m.vis && m.x !== undefined && m.w) out.push({ l: m.x - m.w / 2, r: m.x + m.w / 2, t: m.y - m.h / 2, b: m.y + m.h / 2 });
    return out;
  }
  _updVignette(d, man) {
    if (man && this.vig.hidden) { this.vig.hidden = false; this._tabOffset(); }
    show(this.vig, man);
    if (!man) return;
    this.vig.classList.toggle('sheet-open', Boolean(this.cur && this.sheet)); // điện thoại đứng: tấm trượt đã có nút trả về TỰ ĐỘNG
    const remote = d.ctl === 'remote';
    this.vig.classList.toggle('remote', remote);
    txt(this.vgTitle, remote ? 'TAY · TỪ XA – trung tâm đang điều khiển' : 'CHẾ ĐỘ TAY · TẠI CHỖ');
    txt(this.vgSub, remote ? `quyền còn ${fmtLease(d.lease_s)} · mất kết nối → tự về TỰ ĐỘNG` : 'kịch bản tự động tạm ngưng · lớp an toàn vẫn hoạt động');
    attr(this.vgBtn, 'title', remote ? 'Thao tác tại trạm (được ưu tiên): kết thúc TAY từ xa của trung tâm, trả trạm về TỰ ĐỘNG' : 'Thao tác tại trạm: trả trạm về TỰ ĐỘNG theo kịch bản');
  }
  _markerTag(tag) { return tag in PUMP_OF ? PUMP_TAG[PUMP_OF[tag]] : tag; }
  /** Nhãn 3D bị ẩn khi dấu điều khiển TAY thay chỗ hoặc khi bảng nổi của thiết bị đang mở (chấm dẫn đánh dấu vị trí). */
  _syncLabels() {
    const sc = this.app.scene3d;
    if (!sc) return;
    for (const m of this.markers) sc.setLabelHidden(m.tag, !m.hide || (this.cur && this.cur.tag === m.tag));
    if (this._hidLabel && (!this.cur || this._hidLabel !== this.cur.tag) && !MARK_TAGS.includes(this._hidLabel)) sc.setLabelHidden(this._hidLabel, false);
    this._hidLabel = this.cur ? this.cur.tag : null;
    if (this.cur && !MARK_TAGS.includes(this.cur.tag)) sc.setLabelHidden(this.cur.tag, true);
  }
  _updMarkers(d, man) {
    const a = this.app, g = a.st.gw;
    const noValve = a.cfg.hardware['MV-02'] === false, tk = d.ctl === 'remote'; // tk: bấm dấu sẽ giành quyền từ trung tâm
    if (!tk) this._armed = null;
    let changed = man !== this.mkOn;
    this.mkOn = man;
    for (const m of this.markers) {
      const hide = !man || Boolean(this.cur && this._markerTag(this.cur.tag) === m.tag) || (m.tag === 'MV-02' && noValve);
      if (hide !== m.hide) { m.hide = hide; m.el.hidden = hide; m.vis = undefined; m.x = undefined; changed = true; }
      if (hide) continue;
      const first = tk && this._armed !== m.tag ? ' – nhấp để mở bảng điều khiển, xác nhận trước khi giành quyền' : '';
      let off = d.dead || g.manual === null, tip;
      if (m.i !== null) {
        const p = d.pumps[m.i], on = p.running || p.want;
        cls(m.el, 'c3d-mk ' + (p.fault ? 'fault' : p.running ? 'run' : p.want ? 'wait' : 'stop') + (tk ? ' remote' : ''));
        cls(m.ico, 'c3d-ico ' + (on ? 'stop' : 'play'));
        // tại trạm: điều kiện chạy cứng chưa đạt (theo thứ tự ưu tiên của lớp an toàn) thì khóa nút chạy
        const blk = !on && !tk && !d.dead ? firstBlock(a, m.i) : null;
        if (blk) off = true;
        tip = tk ? `Giành quyền tại chỗ và ${on ? 'dừng' : 'chạy'} ${m.tag}${first}` : blk ? `Không chạy được ${m.tag}: ${blk}` : (on ? 'Dừng ' : 'Chạy ') + m.tag;
        txt(m.val, p.fault ? 'LỖI' : p.running ? fmt(p.f, 1, 'Hz') : p.want ? 'chờ chạy' : 'dừng');
      } else {
        const v = d.valve ?? 0, want = this._valveWant(d);
        cls(m.el, 'c3d-mk valve ' + (v >= 0.99 ? 'run' : v <= 0.01 ? 'closed' : 'wait') + (tk ? ' remote' : ''));
        cls(m.ico, 'c3d-ico none');
        txt(m.btnTxt, want ? 'Đóng' : 'Mở');
        tip = tk ? `Giành quyền tại chỗ và ${want ? 'đóng' : 'mở'} van MV-02${first}` : (want ? 'Đóng' : 'Mở') + ' van MV-02';
        txt(m.val, v >= 0.99 ? 'MỞ' : v <= 0.01 ? 'ĐÓNG' : fmt(v * 100, 0, '%'));
      }
      attr(m.btn, 'title', tip); attr(m.btn, 'aria-label', tip);
      dis(m.btn, off);
    }
    if (changed) this._syncLabels();
  }
  _updCard(d, force) {
    const a = this.app, C = this.cur, g = a.st.gw, dead = d.dead, remote = this.where === 'remote';
    const dw = remote ? stationData(a, 'remote') : d; // điều vị trí ra lệnh nhìn thấy
    const ctl = d.ctl, can = !dead && canCommand(dw);
    cls(C.el, this._cardCls(C));
    for (const b of C.where.children) { const on = b.dataset.w === this.where; b.classList.toggle('on', on); attr(b, 'aria-pressed', on); }
    txt(C.org, remote ? 'trung tâm · qua máy chủ → MQTT' : 'tại tủ · thẳng vào gateway');
    show(C.wnote, remote);
    if (remote) txt(C.wnote, (dw.stale ? 'Trung tâm MẤT KẾT NỐI với trạm: lệnh xếp hàng ở máy chủ' : 'Giả lập trung tâm: lệnh đi qua máy chủ → MQTT → trạm')
      + `, hết hạn sau ${Math.round(a.cfg.gateway.manual_cmd_ttl_s)} s. Số liệu trên thẻ: thực tế tại trạm. Đóng thẻ thì trở về "Tại trạm".`);
    show(C.dead, dead);
    if (dead) txt(C.deadNote, `${viNum(a.st.gw_dead.note())} · lệnh từ HMI-01 và từ trung tâm đều không tới được biến tần cho tới khi mini PC tiếp quản lại.`);
    // quyền điều khiển
    const mySrc = remote ? 'remote' : 'local';
    cls(C.srcChip, 'chip ' + (dead ? 'critical' : ctl === 'auto' ? 'good' : 'warning'));
    txt(C.srcChip, dead ? 'KHÔNG ĐIỀU KHIỂN ĐƯỢC' : CTL_NAME[ctl]);
    txt(C.srcNote, dead ? 'Mini PC treo – watchdog đã nhả quyền cho biến tần.'
      : ctl === 'auto' ? `Kịch bản v${g.script.version} điều khiển; lớp an toàn luôn ưu tiên.`
        : ctl === 'local' ? 'Tại trạm giữ quyền; lệnh tay từ trung tâm bị từ chối.'
          : `Trung tâm giữ quyền còn ${fmtLease(d.lease_s)}; mất kết nối → tự về TỰ ĐỘNG.`);
    show(C.btnMan, !dead && ctl !== mySrc);
    const manTxt = remote ? 'Chuyển TAY từ xa' : ctl === 'remote' ? 'Giành quyền TAY tại chỗ' : 'Chuyển TAY tại chỗ';
    txt(C.btnMan, manTxt); txt(C.hintBtn, manTxt);
    const urgent = C.kind === 'station' && needsReset(a); // thẻ trạm: ưu tiên nút đặt lại
    cls(C.btnMan, 'btn small' + (ctl === 'auto' && !urgent ? ' c3d-amber' : ''));
    show(C.btnAuto, !dead && ctl !== 'auto');
    let auth = '';
    if (!dead && remote && ctl === 'local') auth = 'Quyền đang ở TẠI CHỖ – lệnh tay từ trung tâm sẽ bị trạm từ chối.';
    else if (!dead && !remote && ctl === 'remote') auth = 'Trung tâm đang điều khiển tay – thao tác tại trạm sẽ giành quyền (tại chỗ được ưu tiên).';
    else if (!dead && remote && ctl !== 'auto' && dw.ctl === 'auto') auth = 'Trung tâm chưa nhận bản tin trạm ở chế độ TAY (chu kỳ 10 s) – chờ rồi ra lệnh.';
    show(C.auth, auth); if (auth) txt(C.auth, auth);
    show(C.srcNote, !auth);
    show(C.hint, C.kind !== 'station' && !dead && !can && dw.ctl === 'auto' && ctl === 'auto');
    if (C.kind === 'pump') this._updPump(C, d, dw, can, force);
    else if (C.kind === 'valve') this._updValve(C, d, can);
    else this._updStation(C, d);
    // lệnh cuối của thiết bị này, từ vị trí đang chọn
    const last = this._lastFor(C);
    const lk = last ? last.id + last.status + this.where : this.where;
    if (force || lk !== C.lastKey) {
      C.lastKey = lk;
      const why = last && last.reason ? viNum(last.reason) : '';
      const noop = last && last.status === 'ok' && /không ở trạng thái|đã ở chế độ/i.test(why);
      const st = last && (noop ? ['off', 'không thay đổi'] : CMD_STATUS[last.status] || ['off', last.status]);
      const from = last ? (last.id && last.id.startsWith('L') ? 'tại trạm' : 'từ trung tâm') : '';
      const name = last ? cmdName(last.type) : '';
      C.last.title = last ? `${last.id} ${name} (${from})${why ? ' – ' + why : ''}` : '';
      C.last.replaceChildren(...(last ? [h('span', { class: 'c3d-k' }, 'Lệnh cuối'), h('span', { class: 'chip ' + st[0] }, st[1]),
        h('span', { class: 'c3d-lastt' }, h('b', {}, name)),
        h('small', { class: 'c3d-why' }, `${tShort(last.t).slice(3)} · ${from}` + (why ? ' – ' + why : ''))]
        : [h('span', { class: 'c3d-k' }, 'Lệnh cuối'), h('span', { class: 'c3d-sub' }, remote ? 'trung tâm chưa gửi lệnh cho thiết bị này' : 'chưa có lệnh tại trạm cho thiết bị này')]));
    }
    if (force || ++this._n % 4 === 0) this._spark(C);
  }
  _updPump(C, d, dw, can, force) {
    const a = this.app, g = a.st.gw, i = C.i, p = d.pumps[i], pu = a.st.plant.pumps[i], t = a.net.t, sf = g.safety, remote = this.where === 'remote';
    const [pt, pc] = p.fault ? ['LỖI', 'fault'] : p.running ? ['CHẠY', 'run'] : ['DỪNG', 'stop'];
    txt(C.pill, pt); cls(C.pill, 'c3d-pill ' + pc);
    txt(C.v_f, fmt(p.f, 1)); txt(C.v_kw, fmt(p.kw, 2)); txt(C.v_a, fmt(p.amps, 1)); txt(C.v_p, fmt(pu.gauge, 2));
    C.fbar.style.width = clamp((p.f ?? 0) / 50 * 100, 0, 100).toFixed(1) + '%';
    show(C.seen, remote);
    if (remote) {
      const r = dw.pumps[i];
      txt(C.seen, `Trung tâm thấy: ${r.running ? 'chạy ' + fmt(r.f, 1, 'Hz') : 'dừng'} · ${dw.stale ? 'DỮ LIỆU CŨ (mất kết nối)' : dw.age !== null ? `bản tin ${Math.round(dw.age)} s trước` : 'chưa có bản tin'}`);
    }
    // điều kiện chạy theo thứ tự ưu tiên của lớp an toàn; tại trạm, điều kiện cứng chưa đạt → khóa nút Chạy kèm lý do
    // (trung tâm không thấy liên động chi tiết nên không khóa – trạm sẽ tự từ chối/hủy)
    const perm = permissives(a, i), hard = perm.filter((x) => x[2] === 'hard'), bad = hard.find((x) => !x[0]);
    const blk = !remote && !d.dead && bad ? bad[1] : null;
    for (const b of [C.btnStop, C.btnSpeed, C.range]) dis(b, !can);
    dis(C.btnRun, !can || Boolean(blk));
    attr(C.btnRun, 'title', blk ? 'Không chạy được: ' + blk : remote ? 'Chạy (lệnh qua máy chủ; trạm kiểm tra liên động)' : 'Chạy bơm ở tần số trên thanh trượt');
    C.btnRun.classList.toggle('on', p.want === true);
    C.btnStop.classList.toggle('on', p.want === false);
    if (!C.editing || !can) C.range.value = p.f_set ?? (p.running ? clamp(p.f, 25, 50) : 40);
    txt(C.rangeVal, fmt(+C.range.value, 1, 'Hz'));
    // vì sao bơm chưa chạy dù đã ra lệnh / vừa bị lớp an toàn hủy lệnh chạy
    let why = '', info = false;
    const cancel = !d.dead && g.manual && !p.want && !p.running ? this._cancelled(C) : null;
    if (cancel) why = `Lớp an toàn đã hủy lệnh chạy lúc ${tShort(cancel.t).slice(3)} (${cancel.why}) – bơm không tự chạy lại, cần lệnh Chạy mới` + (sf.last_block ? `. Còn đang chặn: ${viNum(sf.last_block)}` : '.');
    else if (!d.dead && g.manual && p.want && !p.running && !p.fault) {
      const sinceStop = t - g.pm.stop_t[i];
      if (sf.last_block) why = 'Liên động đang chặn: ' + viNum(sf.last_block);
      else if (p.starts_h >= a.cfg.safety.max_starts_per_h) why = `Đã khởi động ${p.starts_h} lần trong 1 giờ – tạm cấm khởi động (bảo vệ động cơ)`;
      else if (sinceStop < a.cfg.safety.min_off_s) why = `Chờ thời gian nghỉ tối thiểu, còn ${Math.ceil(a.cfg.safety.min_off_s - sinceStop)} s`;
      else why = 'Đã nhận lệnh chạy – biến tần đang khởi động';
    } else if (!d.dead && g.manual && p.running && sf.limiting) { why = `Lớp an toàn giới hạn tần số ≤ ${fmt(sf.f_cap, 1)} Hz do áp cao – bơm vẫn chạy`; info = true; }
    show(C.block, why);
    if (why) { txt(C.block, why); cls(C.block, 'c3d-warn' + (info ? ' info' : '')); }
    // tiêu đề điều kiện: điều kiện cứng đầu tiên chưa đạt; giới hạn tần số chỉ là thông tin
    show(C.permHead, perm.length);
    if (perm.length) {
      cls(C.permHead, 'c3d-permhead ' + (bad ? 'bad' : 'ok') + (this.permOpen ? ' open' : ''));
      txt(C.permHead, bad ? 'Chưa đạt: ' + bad[1] : `Đủ điều kiện cho phép chạy (${hard.length}/${hard.length})` + (sf.limiting ? ' · đang giới hạn tần số' : ''));
      attr(C.permHead, 'aria-expanded', this.permOpen);
      attr(C.permHead, 'title', sf.last_block ? 'Lớp an toàn đang chặn: ' + viNum(sf.last_block) : 'Điều kiện cho phép chạy theo thứ tự ưu tiên của lớp an toàn');
    }
    show(C.permList, this.permOpen && perm.length);
    const pk = perm.map((x) => +x[0] + x[1]).join('|') + this.permOpen;
    if (this.permOpen && (force || pk !== C.permKey)) {
      C.permKey = pk;
      C.permList.replaceChildren(...perm.map(([ok, s, k]) => h('li', { class: k === 'info' ? 'info' : ok ? 'ok' : 'no' }, s)));
    }
  }
  _updValve(C, d, can) {
    const a = this.app, g = a.st.gw, hw = a.cfg.hardware['MV-02'] !== false, v = d.valve ?? 0, sf = g.safety;
    const dir = C.lastV === undefined ? 0 : v - C.lastV;
    C.lastV = v;
    if (Math.abs(dir) > 1e-5) C.dir = dir > 0 ? 'đang mở' : 'đang đóng';
    const moving = v > 0.01 && v < 0.99;
    const [pt, pc] = !hw ? ['KHÔNG LẮP', 'stop'] : v >= 0.99 ? ['MỞ', 'run'] : v <= 0.01 ? ['ĐÓNG', 'closed'] : ['ĐANG CHẠY', 'wait'];
    txt(C.pill, pt); cls(C.pill, 'c3d-pill ' + pc);
    txt(C.v_pos, hw ? fmt(v * 100, 0) : '–');
    txt(C.v_cmd, g.manual && !d.dead ? (g.manual.valve ? 'MỞ' : 'ĐÓNG') : 'tự động');
    txt(C.v_mv, moving ? C.dir || 'đang chạy' : 'đứng yên');
    C.fbar.style.width = (clamp(v, 0, 1) * 100).toFixed(1) + '%';
    const want = this._valveWant(d);
    for (const b of [C.btnOpen, C.btnClose]) dis(b, !can || !hw);
    C.btnOpen.classList.toggle('on', Boolean(g.manual) && want);
    C.btnClose.classList.toggle('on', Boolean(g.manual) && !want);
    const waiting = d.pumps.filter((p) => p.want && !p.running).map((p) => p.tag);
    let why = '';
    if (!hw) why = 'Trạm không lắp van điện MV-02 – không điều khiển được.';
    else if (!d.dead && sf.safe_stop) why = `DỪNG AN TOÀN (${sf.safe_reason}): lớp an toàn giữ van ĐÓNG cho tới khi đặt lại.`;
    else if (!d.dead && v < 0.95 && waiting.length) why = `Liên động đang chặn ${waiting.join(', ')}: chờ van mở hết.`;
    show(C.block, why); if (why) txt(C.block, why);
    txt(C.lock, 'Liên động: bơm chỉ chạy khi MV-02 mở hết (mở van trước, chạy bơm sau). Đóng van khi bơm đang chạy → lớp an toàn chặn bơm cho tới khi van mở lại.');
  }
  _updStation(C, d) {
    const a = this.app, g = a.st.gw, sf = g.safety, dead = d.dead, remote = this.where === 'remote';
    const trip = !dead && (sf.safe_stop || sf.lockout || sf.trip_active);
    txt(C.pill, dead ? 'MINI PC LỖI' : sf.safe_stop ? 'DỪNG AN TOÀN' : sf.lockout || sf.trip_active ? 'CẮT ÁP CAO' : ({ a: 'BÌNH THƯỜNG', b: 'TỰ VẬN HÀNH', c: 'ĐỒNG BỘ', d: 'CẢNH BÁO' }[d.mode] || d.mode));
    cls(C.pill, 'c3d-pill ' + (dead || trip ? 'fault' : { good: 'run', warning: 'wait', info: 'info', critical: 'fault' }[MODE_CHIP[d.mode]] || 'stop'));
    const safety = dead ? 'chỉ còn liên động cứng (LSLL, PSV-01, bảo vệ biến tần)' : sf.safe_stop ? `DỪNG AN TOÀN – ${sf.safe_reason}` : sf.lockout ? 'KHÓA sau nhiều lần cắt áp cao'
      : sf.trip_active ? 'cắt bơm do áp rất cao' : (sf.level_trip || a.st.sensors.lsll) ? 'mức bể rất thấp – chống chạy khô' : sf.limiting ? `giới hạn tần số ≤ ${fmt(sf.f_cap, 1)} Hz` : 'bình thường';
    const pumps = d.pumps.map((p) => `${p.tag} ${p.fault ? 'LỖI' : p.running ? fmt(p.f, 1, 'Hz') : 'dừng'}`).join(' · ');
    const vals = [dead ? MODE_NAME.x : MODE_NAME[d.mode], safety, pumps, `${fmt(d.p1, 2)} / ${fmt(d.p_set, 2)} bar`, COMMS[d.comms] || d.comms];
    vals.forEach((v, j) => txt(C.vals[j], v));
    cls(C.safeRow, sf.safe_stop || sf.lockout || dead ? 'bad' : '');
    // đặt lại: tại trạm chỉ khi đang chốt dừng an toàn / khóa; trung tâm không biết chắc nên vẫn cho gửi
    const need = needsReset(a);
    dis(C.btnReset, dead || (!remote && !need));
    attr(C.btnReset, 'title', dead ? 'Mini PC đang ngừng' : need ? 'Đặt lại sau khi chất lượng nước đã ổn định đủ lâu' : remote ? 'Gửi lệnh đặt lại qua máy chủ (trạm tự kiểm tra điều kiện)' : 'Trạm không ở trạng thái dừng an toàn');
    cls(C.btnReset, 'btn small' + (need ? ' c3d-amber' : ''));
    dis(C.btnRotate, dead || d.ctl !== 'auto');
    txt(C.lock, dead ? '' : d.ctl !== 'auto' ? 'Luân phiên bơm chỉ có tác dụng ở TỰ ĐỘNG; đặt lại cần chất lượng nước đã ổn định.'
      : need ? 'Đặt lại chỉ được chấp nhận khi chất lượng nước đã ổn định đủ lâu; luân phiên đổi bơm chính ở lần chạy tới.'
        : 'Không có dừng an toàn cần đặt lại; luân phiên đổi bơm chính ở lần chạy tới.');
    show(C.lock, !dead);
  }
  /** Xu hướng nhỏ 60 phút (tần số bơm, hoặc áp PT-101/áp đặt cho thẻ trạm) – vẽ khoảng 1 lần/giây. */
  _spark(C) {
    const cv = C.spark;
    if (!cv || !cv.isConnected) return;
    const w = cv.clientWidth, hh = 28;
    if (!w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
    const cs = getComputedStyle(document.documentElement), col = (n, f) => cs.getPropertyValue(n).trim() || f;
    const H = this.app.st.hist.data, U = this.app.uiHist || {}, t1 = this.app.net.t, t0 = t1 - 3600;
    let i0 = H.t.length; while (i0 > 0 && H.t[i0 - 1] >= t0) i0--;
    const X = (tt) => ((tt - t0) / 3600) * (w - 2) + 1;
    // app.uiHist.p1 (PT-101) cùng chỉ số với hist.data.t; hist.p_out là áp mạng sau MV-02
    const lines = C.kind === 'pump' ? [[H['f' + (C.i + 1)], col('--accent', '#1d6cae'), 0, 52, false]] : [[H.p_set, col('--muted', '#7b8783'), 0, 5, true], [U.p1 || H.p_out, col('--accent', '#1d6cae'), 0, 5, false]];
    ctx.strokeStyle = col('--line', '#cdd5d1'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, hh - 0.5); ctx.lineTo(w, hh - 0.5); ctx.stroke();
    for (const [arr, c, lo, hi, dash] of lines) {
      if (!arr) continue;
      const Y = (v) => hh - 2 - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (hh - 5);
      ctx.beginPath();
      let n = 0;
      for (let k = i0; k < H.t.length; k++) { const v = arr[k]; if (v === null || v === undefined || Number.isNaN(v)) continue; if (n++) ctx.lineTo(X(H.t[k]), Y(v)); else ctx.moveTo(X(H.t[k]), Y(v)); }
      if (n < 2) continue;
      ctx.setLineDash(dash ? [4, 3] : []); ctx.strokeStyle = c; ctx.lineWidth = dash ? 1.2 : 1.6; ctx.stroke();
      if (!dash) { ctx.lineTo(X(H.t[H.t.length - 1]), hh); ctx.lineTo(X(H.t[i0]), hh); ctx.closePath(); ctx.globalAlpha = 0.12; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1; }
    }
    ctx.setLineDash([]);
  }

  // ---------------- mỗi khung hình 3D ----------------
  /** Gọi mỗi khung hình 3D: đặt lại vị trí bảng nổi và dấu điều khiển theo camera (chỉ đổi transform/thuộc tính, không tạo DOM). */
  frame() {
    if (!this.app.st || !this.app.scene3d) return;
    if (this.cur) this._placeCard();
    if (this.mkOn) this._placeMarkers(this.app.scene3d);
  }
  /**
   * Dấu điều khiển neo trên thiết bị; nếu dấu lấn vào HUD/dock/thanh trên/khung bên phải thì dời vào vùng trống
   * (thiết bị nằm hẳn dưới lớp phủ: có mũi tên ở mép chỉ về phía thiết bị); bảng nổi đang che dấu thì ẩn dấu.
   */
  _placeMarkers(sc) {
    const I = this.app.insets || { l: 0, r: 0, t: 0, b: 0 }, W = this.W, H = this.H;
    const FL = I.l + 6, FR = W - Math.max(I.r, I.sr || 0) - 6, FT = I.t + 6, FB = H - Math.max(I.b, I.sb || 0) - 6;
    const card = this._cardRect();
    for (const m of this.markers) {
      if (m.hide) continue;
      const p = sc.screenPos(m.tag, m.p), w = m.w || 130, hh = m.h || 30;
      let x = p.x, y = p.y, edge = '', vis = p.visible;
      if (vis) {
        const r = { l: x - w / 2, r: x + w / 2, t: y - hh / 2, b: y + hh / 2 };
        let cov = 0;
        for (const o of this._occ) cov += ovl(r, o);
        if (cov > 0.1 * w * hh || r.l < 0 || r.r > W || r.t < 0 || r.b > H) {
          if (p.x < FL) edge = 'l'; else if (p.x > FR) edge = 'r'; else if (p.y < FT) edge = 't'; else if (p.y > FB) edge = 'b';
          x = clamp(x, FL + w / 2, Math.max(FL + w / 2, FR - w / 2)); y = clamp(y, FT + hh / 2, Math.max(FT + hh / 2, FB - hh / 2));
        }
        if (card && ovl({ l: x - w / 2, r: x + w / 2, t: y - hh / 2, b: y + hh / 2 }, card) > 0.15 * w * hh) vis = false;
      }
      if (vis !== m.vis) { m.vis = vis; m.el.style.visibility = vis ? '' : 'hidden'; }
      if (edge !== m.edge) { m.edge = edge; if (edge) m.el.dataset.edge = edge; else delete m.el.dataset.edge; }
      if (!vis) continue;
      const xr = Math.round(x), yr = Math.round(y);
      if (xr !== m.x || yr !== m.y) { m.x = xr; m.y = yr; m.el.style.transform = `translate(${xr}px, ${yr}px) translate(-50%, -50%)`; }
    }
  }
  _moveCard(x, y) {
    const C = this.cur;
    x = Math.round(x); y = Math.round(y);
    if (x === C.tx && y === C.ty) return;
    C.tx = x; C.ty = y;
    C.el.style.transform = `translate(${x}px, ${y}px)`;
  }
  _leadOn(on) { const v = on ? '' : 'none'; if (this.lead.style.display !== v) this.lead.style.display = v; }
  _setLead(x1, y1, x2, y2) {
    const L = this._lead;
    x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
    if (L.x1 === x1 && L.y1 === y1 && L.x2 === x2 && L.y2 === y2) return;
    Object.assign(L, { x1, y1, x2, y2 });
    this.leadLine.setAttribute('x1', x1); this.leadLine.setAttribute('y1', y1); this.leadLine.setAttribute('x2', x2); this.leadLine.setAttribute('y2', y2);
    for (const c of [this.leadDot, this.leadHalo]) { c.setAttribute('cx', x1); c.setAttribute('cy', y1); }
  }
  _offHintAt(x, y, dx, dy) {
    show(this.offHint, true);
    this.offHint.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    this.offArrow.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
  }
  _placeCard() {
    const C = this.cur, sc = this.app.scene3d;
    const p = sc.bodyPos(C.tag, this._p), W = this.W, H = this.H, m = 10, gap = 48;
    // vùng trống giữa thanh trên, HUD, dock, tấm biểu đồ và khung bên phải đang mở (main.js cập nhật app.insets mỗi 250 ms)
    const I = this.app.insets || { l: 0, r: 0, t: 0, b: 0, sb: 0, sr: 0 };
    const bb = Math.max(I.b, I.sb || 0), L = m + I.l, R = W - m - Math.max(I.r, I.sr || 0), B = H - m - bb;
    const T = m + Math.max(I.t, this._banB || 0); // dưới thanh trên / dải HUD và dải chế độ (b/c/d)
    if (this.sheet) {
      // tấm trượt đáy (điện thoại): giữa dải HUD/dải chế độ và dock/tấm biểu đồ; nằm ngang thì neo về phía không có thiết bị
      const mh = Math.max(150, Math.round(H - T - bb - 6)), bt = Math.round(bb + 8);
      if (C.availH !== mh || C.bt !== bt) { C.availH = mh; C.bt = bt; C.el.style.maxHeight = mh + 'px'; C.el.style.bottom = bt + 'px'; }
      if (this.land) {
        const lft = p.visible ? (C.lft ? p.x > W / 2 - 60 : p.x > W / 2 + 60) : Boolean(C.lft);
        if (lft !== Boolean(C.lft)) { C.lft = lft; cls(C.el, this._cardCls(C)); this.vig.classList.toggle('lft', lft); this._sheetRect = null; }
      }
      const sr = this._sheetRect;
      // tấm che thiết bị: dời camera để thiết bị hiện ở phần khung còn trống (đóng tấm thì trả lại)
      if (C.reveal && sr && !sc.tween) {
        C.reveal = false;
        const fr = this.land ? (C.lft ? { l: sr.r + 8, r: W - 8 } : { l: 8, r: sr.l - 8 }) : { l: 8, r: W - 8 };
        fr.t = T; fr.b = this.land ? sr.b : sr.t - 8;
        const inside = p.visible && p.x > fr.l + 20 && p.x < fr.r - 20 && p.y > fr.t + 16 && p.y < fr.b - 16;
        if (!inside && fr.r - fr.l > 60 && fr.b - fr.t > 40) C.revealed = sc.reveal(C.tag, this.land ? (fr.l + fr.r) / 2 : clamp(p.x, fr.l + 40, fr.r - 40), (fr.t + fr.b) / 2);
      }
      // đường dẫn từ thiết bị tới mép tấm
      const out = p.visible && sr && !(p.x > sr.l && p.x < sr.r && p.y > sr.t && p.y < sr.b);
      this._leadOn(out);
      if (out) this._setLead(p.x, p.y, this.land ? (C.lft ? sr.r : sr.l) : clamp(p.x, sr.l + 16, sr.r - 16), this.land ? clamp(p.y, sr.t + 22, sr.b - 22) : sr.t);
      if (p.visible) show(this.offHint, false); else this._offHintAt(this.land ? (C.lft ? (W + Math.min(440, W - 16) + 8) / 2 : (W - Math.min(440, W - 16) - 8) / 2) : W / 2, I.t + 24, p.dx, p.dy);
      return;
    }
    const availW = Math.max(220, Math.round(R - L)), avail = Math.max(160, Math.round(B - T));
    if (C.availW !== availW) { C.availW = availW; C.el.style.maxWidth = availW + 'px'; }
    if (C.availH !== avail) { C.availH = avail; C.el.style.maxHeight = avail + 'px'; }
    const cw = Math.min(this.cw, availW), ch = Math.min(this.ch, avail);
    if (p.visible) {
      // chọn chỗ đặt (phải/trái thiết bị, lùi xa thêm 0–3 bậc, cao/thấp) ít che thân thiết bị và các dấu điều khiển nhất;
      // phạt khi đặt xa thiết bị; giữ chỗ cũ nếu không tốt hơn rõ rệt (tránh nhảy qua lại khi camera chuyển động)
      const dev = sc.screenRect(C.tag, this._dr) || { l: p.x - 20, r: p.x + 20, t: p.y - 20, b: p.y + 20 };
      const mk = this.markers.filter((k) => !k.hide && k.vis !== false && k.x !== undefined && k.w).map((k) => ({ l: k.x - k.w / 2, r: k.x + k.w / 2, t: k.y - k.h / 2, b: k.y + k.h / 2 }));
      const wide = R - p.x >= p.x - L ? 1 : -1, area = cw * ch;
      let best = null;
      for (const side of [1, -1]) for (let k = 0; k < 4; k++) for (const f of [0.3, 0.05, 0.6]) {
        const x = clamp(side > 0 ? p.x + gap + k * 60 : p.x - gap - cw - k * 60, L, Math.max(L, R - cw));
        const y = clamp(p.y - ch * f, T, Math.max(T, B - ch));
        const r = { l: x, t: y, r: x + cw, b: y + ch };
        const dv = ovl(r, dev);
        let cost = (dv > 0 ? 1500 + 6 * dv : 0) + k * 1500 + Math.abs(f - 0.3) * ch * 8 + (side === wide ? 0 : 300);
        for (const o of mk) { const v = ovl(r, o); if (v > 0) cost += 2500 + 2 * v; } // dấu bị che dù chỉ một phần cũng khó bấm
        for (const o of this._occ) { const v = ovl(r, o); if (v > 0) cost += 4000 + 4 * v; } // nhãn TAY, thẻ thông tin…
        const key = side * 100 + k * 10 + f * 10;
        if (key === C.pk) cost -= 0.05 * area;
        if (!best || cost < best.cost) best = { x, y, cost, key, side };
      }
      C.pk = best.key; this.side = best.side;
      const { x, y } = best;
      this._moveCard(x, y);
      const inside = p.x > x - 6 && p.x < x + cw + 6 && p.y > y - 6 && p.y < y + ch + 6;
      this._leadOn(!inside);
      if (!inside) this._setLead(p.x, p.y, p.x < x ? x : p.x > x + cw ? x + cw : clamp(p.x, x + 16, x + cw - 16), clamp(p.y, y + 22, y + ch - 22));
      show(this.offHint, false);
    } else {
      this._leadOn(false);
      if (C.tx === null) this._moveCard(Math.max(L, R - cw), clamp(H * 0.12, T, Math.max(T, B - ch)));
      // gợi ý ở mép vùng trống theo hướng tới thiết bị (kể cả khi thiết bị ở sau camera)
      const cx = (L + R) / 2, cy = (T + B) / 2, dx = p.dx, dy = p.dy;
      const kx = ((R - L) / 2 - 110) / Math.max(1e-3, Math.abs(dx)), ky = ((B - T) / 2 - 30) / Math.max(1e-3, Math.abs(dy));
      const k = Math.max(0, Math.min(kx, ky));
      this._offHintAt(cx + dx * k, cy + dy * k, dx, dy);
    }
  }
}
