// Điều khiển thiết bị ngay trong cảnh 3D: bảng điều khiển nổi (faceplate) gắn vào bơm/biến tần/van/tủ và dấu điều khiển TAY trong cảnh.
// Người dùng trong cảnh 3D coi như đang đứng trong trạm: lệnh mặc định đi thẳng vào gateway ('local', như HMI-01);
// có thể giả lập lệnh từ trung tâm ('remote': qua máy chủ và MQTT, hết hạn sau 60 s).
// Mọi quy tắc (quyền tại chỗ ưu tiên, liên động, giới hạn tần số, số lần khởi động) do gateway thực thi – ở đây chỉ hiển thị và giải thích.
import { h, fmt, tShort } from './dom.js';
import { CMD_STATUS, CTL_NAME, MODE_CHIP, MODE_NAME, canCommand, commandLog, permissives, sendCommand, stationData } from './ops.js';

const PUMP_OF = { 'P-01': 0, 'P-02': 1, 'VFD-01': 0, 'VFD-02': 1 };
const PUMP_TAG = ['P-01', 'P-02'];
const PUMP_DESC = ['Bơm tăng áp số 1', 'Bơm tăng áp số 2'];
const MARK_TAGS = ['P-01', 'P-02', 'MV-02'];
const NS = 'http://www.w3.org/2000/svg';
const kindOf = (tag) => (tag in PUMP_OF ? 'pump' : tag === 'MV-02' ? 'valve' : tag === 'SA-01/02' ? 'station' : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
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
    this.where = 'local'; // vị trí ra lệnh: 'local' tại trạm | 'remote' giả lập trung tâm
    this.cur = null; this.permOpen = false;
    this.W = host.clientWidth || 800; this.H = host.clientHeight || 500;
    this.cw = 316; this.ch = 420; this.side = 1; this.sheet = false; this.mkOn = false;
    this._p = {}; this._n = 0; this._lead = {};
    this._build();
    this._ro = new ResizeObserver((es) => {
      for (const e of es) {
        if (e.target === host) { this.W = host.clientWidth; this.H = host.clientHeight; this._layoutMode(); }
        else if (this.cur && e.target === this.cur.el) { this.cw = this.cur.el.offsetWidth; this.ch = this.cur.el.offsetHeight; }
      }
    });
    this._ro.observe(host);
    this._layoutMode();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.cur && !e.defaultPrevented && this.app.viewMode !== 'hmi') this.close(); });
    if (app.scene3d) app.scene3d.hoverHint = (tag) => (tag === 'HMI-01' ? 'Nhấp để mở màn hình HMI' : this.handles(tag) ? 'Nhấp để mở bảng điều khiển' : 'Nhấp để xem thông tin');
  }

  /** Thiết bị điều khiển được không (bơm, biến tần, van MV-02, công tắc trạm SA-01/02, màn HMI-01). */
  handles(tag) { return Boolean(kindOf(tag)) || tag === 'HMI-01'; }
  /** Mở bảng điều khiển nổi cho thiết bị; trả về false nếu không điều khiển được (main.js mở thẻ thông tin). */
  open(tag) {
    if (tag === 'HMI-01') { this.close(); this.app.setView('hmi'); return true; }
    const kind = kindOf(tag);
    if (!kind) return false;
    if (this.cur && this.cur.tag === tag) { this.update(true); return true; }
    this.close();
    const C = this._card(kind, tag);
    this.cur = C; this.side = 1;
    this.layer.append(C.el);
    this._ro.observe(C.el);
    cls(C.el, 'c3d-card' + (this.sheet ? ' sheet' : ''));
    txt(this.offTxt, `${tag} ngoài khung nhìn · Xem`);
    const sc = this.app.scene3d;
    sc.highlight(tag);
    this._syncLabels();
    if (this.app.st) this.update(true);
    this.cw = C.el.offsetWidth || this.cw; this.ch = C.el.offsetHeight || this.ch;
    if (!sc.bodyPos(tag, this._p).visible) sc.focus(tag);
    this.frame();
    return true;
  }
  close() {
    if (!this.cur) return;
    this._ro.unobserve(this.cur.el);
    this.cur.el.remove();
    this.cur = null;
    this.lead.style.display = 'none'; this.offHint.hidden = true;
    this.app.scene3d?.highlight(null);
    this._syncLabels();
    if (this.app.st) this.update(true);
  }
  /** Chế độ TAY đang bật (theo quyền điều khiển thực của gateway, mọi nguồn). */
  get manualMode() { return Boolean(this.app.st && !this.app.st.gw_dead && this.app.st.gw.controlSrc() !== 'auto'); }
  /** Bật/tắt chế độ TAY tại chỗ từ cảnh 3D. */
  setManualMode(on) { return sendCommand(this.app, 'local', 'set_mode', { mode: on ? 'manual' : 'auto' }); }
  /** Đổi vị trí ra lệnh của bảng nổi: 'local' (tại trạm) | 'remote' (từ trung tâm). */
  setWhere(w) { this.where = w === 'remote' ? 'remote' : 'local'; this.update(true); }

  // ---------------- dựng lớp phủ ----------------
  _build() {
    // khung viền hổ phách + nhãn khi trạm ở chế độ TAY
    this.vgTitle = h('b'); this.vgSub = h('small');
    this.vgBtn = h('button', { class: 'c3d-vg-btn', onclick: () => this._send('set_mode', { mode: 'auto' }) }, 'Trả về TỰ ĐỘNG');
    this.vig = h('div', { class: 'c3d-vig', hidden: true },
      h('div', { class: 'c3d-vg-tab', role: 'status' }, h('i', { class: 'c3d-vg-dot', 'aria-hidden': 'true' }), h('span', { class: 'c3d-vg-txt' }, this.vgTitle, this.vgSub), this.vgBtn));
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
    const narrow = this.W > 0 && this.W < 600;
    this.sheet = narrow;
    this.vig.classList.toggle('narrow', narrow);
    this.layer.classList.toggle('narrow', narrow);
    if (this.cur) { cls(this.cur.el, 'c3d-card' + (narrow ? ' sheet' : '')); this.cur.el.style.transform = ''; this.cur.tx = this.cur.ty = null; }
    this._tabOffset();
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
    const m = { tag, i: PUMP_OF[tag] ?? null, p: {}, hide: true };
    m.ico = h('i', { class: 'c3d-ico play' });
    m.btn = h('button', { class: 'c3d-mk-btn', onclick: () => this._markerCmd(m) }, m.ico, m.btnTxt = h('span'));
    m.val = h('span');
    m.open = h('button', { class: 'c3d-mk-open', title: 'Mở bảng điều khiển ' + tag, onclick: () => this.open(tag) }, h('i', { class: 'c3d-mk-dot', 'aria-hidden': 'true' }), h('b', {}, tag), m.val);
    m.el = h('div', { class: 'c3d-mk stop', hidden: true, 'data-tag': tag }, m.btn, m.open);
    return m;
  }
  _markerCmd(m) {
    const d = stationData(this.app, 'local');
    if (m.i !== null) {
      const p = d.pumps[m.i];
      if (p.running || p.want) this._send('pump_stop', { pump: m.i });
      else this._send('pump_start', { pump: m.i });
    } else this._send('valve', { open: !this._valveWant(d) });
  }
  _valveWant(d) { const g = this.app.st.gw; return g.manual ? g.manual.valve : (d.valve ?? 1) > 0.5; }

  // ---------------- bảng điều khiển nổi ----------------
  _card(kind, tag) {
    const C = { kind, tag, i: PUMP_OF[tag] ?? null, tx: null, ty: null, editing: false };
    const i = C.i;
    C.pill = h('span', { class: 'c3d-pill' });
    const title = kind === 'pump' ? [h('b', {}, PUMP_TAG[i]), ' · ' + PUMP_DESC[i]] : kind === 'valve' ? [h('b', {}, 'MV-02'), ' · Van điện đầu ra'] : [h('b', {}, 'ST-01'), ' · Chế độ trạm'];
    const nw = (x) => h('span', { class: 'c3d-nw' }, x);
    const sub = kind === 'pump' ? (tag.startsWith('VFD') ? ['Mở từ biến tần ', nw(tag), ' · tủ CP-01'] : ['Bơm ly tâm 5,5 kW · biến tần ', nw(`VFD-0${i + 1}`)])
      : kind === 'valve' ? 'Van bướm điện, hành trình 20 s · ra mạng DMA-A' : ['Công tắc chế độ ', nw('SA-01/02'), ', đèn báo, dừng khẩn'];
    C.where = h('div', { class: 'c3d-seg', role: 'group', 'aria-label': 'Ra lệnh từ đâu' },
      ...[['local', 'Tại trạm'], ['remote', 'Từ trung tâm']].map(([w, l]) => h('button', { 'data-w': w, onclick: () => this.setWhere(w) }, l)));
    C.wnote = h('p', { class: 'c3d-note', hidden: true });
    C.deadNote = h('small');
    C.dead = h('div', { class: 'c3d-dead', hidden: true, role: 'alert' }, h('b', {}, 'Mini PC ngừng – không điều khiển được'), C.deadNote);
    // quyền điều khiển + chuyển chế độ
    C.srcChip = h('span', { class: 'chip' }); C.srcNote = h('small', { class: 'c3d-sub' });
    C.btnMan = h('button', { class: 'btn small', onclick: () => this._send('set_mode', { mode: 'manual' }) });
    C.btnAuto = h('button', { class: 'btn small', onclick: () => this._send('set_mode', { mode: 'auto' }) }, 'Trả về TỰ ĐỘNG');
    C.hint = h('p', { class: 'c3d-hint', hidden: true }, 'Chuyển sang TAY để điều khiển');
    C.auth = h('p', { class: 'c3d-warn', hidden: true });
    const src = h('section', { class: 'c3d-sec c3d-mode' }, h('div', { class: 'c3d-row between' }, h('span', { class: 'c3d-k' }, 'Quyền điều khiển'), C.srcChip),
      h('div', { class: 'c3d-row' }, C.btnMan, C.btnAuto), C.srcNote, C.auth);
    // lệnh cuối (ở chân thẻ)
    C.last = h('div', { class: 'c3d-last', 'aria-live': 'polite' });
    const body = kind === 'pump' ? this._pumpBody(C) : kind === 'valve' ? this._valveBody(C) : this._stationBody(C);
    C.el = h('div', { class: 'c3d-card', role: 'dialog', 'aria-label': `Bảng điều khiển ${tag}`, 'data-kind': kind },
      h('header', { class: 'c3d-head' },
        h('div', { class: 'c3d-name' }, ...title),
        h('div', { class: 'c3d-hbtns' },
          h('button', { class: 'c3d-x c3d-info', title: 'Chi tiết thiết bị', onclick: () => this.app.openDrawer(tag) }, h('span', { 'aria-hidden': 'true' }, 'i'), h('span', { class: 'c3d-sr' }, 'Chi tiết thiết bị')),
          h('button', { class: 'c3d-x', title: 'Đóng (Esc)', 'aria-label': 'Đóng bảng điều khiển', onclick: () => this.close() }, '×')),
        h('small', { class: 'c3d-hsub' }, ...[sub].flat()), C.pill),
      h('div', { class: 'c3d-where' }, h('span', { class: 'c3d-k' }, 'Ra lệnh'), C.where), C.wnote, C.dead,
      body.live, src, body.ctl,
      h('footer', { class: 'c3d-foot' }, C.last));
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
    const ctl = h('section', { class: 'c3d-sec' }, C.hint,
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
    const ctl = h('section', { class: 'c3d-sec' }, C.hint, h('div', { class: 'c3d-cmds' }, C.btnOpen, C.btnClose), C.block, C.lock);
    return { live, ctl };
  }
  _stationBody(C) {
    C.rows = h('tbody');
    C.spark = h('canvas', { class: 'c3d-spark', 'aria-hidden': 'true' });
    C.btnReset = h('button', { class: 'btn small', onclick: () => this._send('reset_safe_stop', {}) }, 'Đặt lại dừng an toàn');
    C.btnRotate = h('button', { class: 'btn small', onclick: () => this._send('rotate_pumps', {}) }, 'Luân phiên bơm');
    C.lock = h('p', { class: 'c3d-note' });
    const live = h('section', { class: 'c3d-sec' }, h('div', { class: 'c3d-row between' }, h('span', { class: 'c3d-k' }, 'Thực tế tại trạm'), h('small', { class: 'c3d-sub' }, 'áp ra (liền) / áp đặt (đứt), 60 phút')),
      h('table', { class: 'kv fixed c3d-kv' }, C.rows), C.spark);
    const ctl = h('section', { class: 'c3d-sec' }, h('span', { class: 'c3d-k' }, 'Chức năng trạm'), h('div', { class: 'c3d-row' }, C.btnReset, C.btnRotate), C.lock);
    return { live, ctl };
  }

  // ---------------- lệnh ----------------
  _send(type, args) { return sendCommand(this.app, this.where, type, args); }
  _run() {
    const C = this.cur, p = this.app.st.plant.pumps[C.i], args = { pump: C.i };
    // bơm đang dừng (hoặc vừa kéo thanh trượt): chạy ở tần số trên thanh trượt; đang chạy: giữ tần số đặt
    if (!p.running || C.editing) args.f_hz = +C.range.value;
    C.editing = false;
    this._send('pump_start', args);
  }

  // ---------------- cập nhật (mỗi 250 ms) ----------------
  /** Gọi mỗi 250 ms: cập nhật số liệu, trạng thái nút. */
  update(force = false) {
    const a = this.app;
    if (!a.st) return;
    const man = this.manualMode;
    if (!this.cur && !man && !this.mkOn && this.vig.hidden) return;
    const d = stationData(a, 'local');
    this._d = d;
    this._updVignette(d, man);
    this._updMarkers(d, man);
    if (this.cur) this._updCard(d, force);
  }
  _updVignette(d, man) {
    if (man && this.vig.hidden) { this.vig.hidden = false; this._tabOffset(); }
    show(this.vig, man);
    if (!man) return;
    this.vig.classList.toggle('sheet-open', Boolean(this.cur && this.sheet)); // tấm trượt đã có nút trả về TỰ ĐỘNG
    const remote = d.ctl === 'remote';
    this.vig.classList.toggle('remote', remote);
    txt(this.vgTitle, remote ? 'TAY · TỪ XA – trung tâm đang điều khiển' : 'CHẾ ĐỘ TAY · TẠI CHỖ');
    txt(this.vgSub, remote ? `quyền còn ${Math.ceil((d.lease_s ?? 0) / 60)} phút · mất kết nối → tự về TỰ ĐỘNG` : 'kịch bản tự động tạm ngưng · lớp an toàn vẫn hoạt động');
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
    const noValve = a.cfg.hardware['MV-02'] === false;
    let changed = man !== this.mkOn;
    this.mkOn = man;
    for (const m of this.markers) {
      const hide = !man || Boolean(this.cur && this._markerTag(this.cur.tag) === m.tag) || (m.tag === 'MV-02' && noValve);
      if (hide !== m.hide) { m.hide = hide; m.el.hidden = hide; m.vis = undefined; m.x = undefined; changed = true; }
      if (hide) continue;
      if (m.i !== null) {
        const p = d.pumps[m.i], on = p.running || p.want;
        cls(m.el, 'c3d-mk ' + (p.fault ? 'fault' : p.running ? 'run' : p.want ? 'wait' : 'stop'));
        cls(m.ico, 'c3d-ico ' + (on ? 'stop' : 'play'));
        const act = (on ? 'Dừng ' : 'Chạy ') + m.tag;
        attr(m.btn, 'title', act); attr(m.btn, 'aria-label', act);
        txt(m.val, p.fault ? 'LỖI' : p.running ? fmt(p.f, 1, 'Hz') : p.want ? 'chờ chạy' : 'dừng');
      } else {
        const v = d.valve ?? 0, want = this._valveWant(d);
        cls(m.el, 'c3d-mk valve ' + (v >= 0.99 ? 'run' : v <= 0.01 ? 'closed' : 'wait'));
        cls(m.ico, 'c3d-ico none');
        txt(m.btnTxt, want ? 'Đóng' : 'Mở');
        attr(m.btn, 'title', (want ? 'Đóng' : 'Mở') + ' van MV-02');
        txt(m.val, v >= 0.99 ? 'MỞ' : v <= 0.01 ? 'ĐÓNG' : fmt(v * 100, 0, '%'));
      }
      dis(m.btn, d.dead || (g.manual === null));
    }
    if (changed) this._syncLabels();
  }
  _updCard(d, force) {
    const a = this.app, C = this.cur, g = a.st.gw, dead = d.dead, remote = this.where === 'remote';
    const dw = remote ? stationData(a, 'remote') : d; // điều vị trí ra lệnh nhìn thấy
    const ctl = d.ctl, can = !dead && canCommand(dw);
    for (const b of C.where.children) b.classList.toggle('on', b.dataset.w === this.where);
    show(C.wnote, remote);
    if (remote) txt(C.wnote, (dw.stale ? 'Trung tâm MẤT KẾT NỐI với trạm: lệnh xếp hàng ở máy chủ' : 'Giả lập trung tâm: lệnh đi qua máy chủ → MQTT → trạm')
      + `, hết hạn sau ${Math.round(a.cfg.gateway.manual_cmd_ttl_s)} s. Số liệu trên thẻ: thực tế tại trạm.`);
    show(C.dead, dead);
    if (dead) txt(C.deadNote, `${a.st.gw_dead.note().replace(/(\d)\.(\d)/g, '$1,$2')} · lệnh từ HMI-01 và từ trung tâm đều không tới được biến tần cho tới khi mini PC tiếp quản lại.`);
    // quyền điều khiển
    const mySrc = remote ? 'remote' : 'local';
    cls(C.srcChip, 'chip ' + (dead ? 'critical' : ctl === 'auto' ? 'good' : 'warning'));
    txt(C.srcChip, dead ? 'KHÔNG ĐIỀU KHIỂN ĐƯỢC' : CTL_NAME[ctl]);
    txt(C.srcNote, dead ? 'Mini PC treo – watchdog đã nhả quyền cho biến tần.'
      : ctl === 'auto' ? `Kịch bản v${g.script.version} điều khiển; lớp an toàn luôn ưu tiên.`
        : ctl === 'local' ? 'Tại trạm giữ quyền; lệnh tay từ trung tâm bị từ chối.'
          : `Trung tâm giữ quyền còn ${Math.ceil((d.lease_s ?? 0) / 60)} phút; mất kết nối → tự về TỰ ĐỘNG.`);
    show(C.btnMan, !dead && ctl !== mySrc);
    txt(C.btnMan, remote ? 'Chuyển TAY từ xa' : ctl === 'remote' ? 'Giành quyền TAY tại chỗ' : 'Chuyển TAY tại chỗ');
    const urgent = C.kind === 'station' && (g.safety.safe_stop || g.safety.lockout); // thẻ trạm: ưu tiên nút đặt lại
    cls(C.btnMan, 'btn small' + (ctl === 'auto' && !urgent ? ' c3d-amber' : ''));
    show(C.btnAuto, !dead && ctl !== 'auto');
    let auth = '';
    if (!dead && remote && ctl === 'local') auth = 'Quyền đang ở TẠI CHỖ – lệnh tay từ trung tâm sẽ bị trạm từ chối.';
    else if (!dead && !remote && ctl === 'remote') auth = 'Trung tâm đang điều khiển tay – thao tác tại trạm sẽ giành quyền (tại chỗ được ưu tiên).';
    else if (!dead && remote && ctl !== 'auto' && dw.ctl === 'auto') auth = 'Trung tâm chưa nhận bản tin trạm ở chế độ TAY (chu kỳ 10 s) – chờ rồi ra lệnh.';
    show(C.auth, auth); if (auth) txt(C.auth, auth);
    show(C.srcNote, !auth);
    show(C.hint, C.kind !== 'station' && !dead && !can && dw.ctl === 'auto');
    if (C.kind === 'pump') this._updPump(C, d, dw, can, force);
    else if (C.kind === 'valve') this._updValve(C, d, can);
    else this._updStation(C, d);
    // lệnh cuối từ vị trí đang chọn
    const last = commandLog(a, this.where, 1)[0];
    const lk = last ? last.id + last.status + this.where : this.where;
    if (force || lk !== C.lastKey) {
      C.lastKey = lk;
      const st = last && (CMD_STATUS[last.status] || ['off', last.status]);
      const from = last ? (last.id && last.id.startsWith('L') ? 'tại trạm' : 'từ trung tâm') : '';
      C.last.title = last ? `${last.id} ${last.type} (${from})${last.reason ? ' – ' + last.reason : ''}` : '';
      C.last.replaceChildren(...(last ? [h('span', { class: 'c3d-k' }, 'Lệnh cuối'), h('span', { class: 'chip ' + st[0] }, st[1]),
        h('span', { class: 'c3d-lastt' }, h('b', { class: 'mono' }, last.type)),
        h('small', { class: 'c3d-why' }, `${tShort(last.t).slice(3)} · ${from}` + (last.reason && last.status !== 'ok' ? ' – ' + last.reason : ''))]
        : [h('span', { class: 'c3d-k' }, 'Lệnh cuối'), h('span', { class: 'c3d-sub' }, remote ? 'trung tâm chưa gửi lệnh' : 'chưa có lệnh tại trạm')]));
    }
    if (force || ++this._n % 4 === 0) this._spark(C);
  }
  _updPump(C, d, dw, can, force) {
    const a = this.app, g = a.st.gw, i = C.i, p = d.pumps[i], pu = a.st.plant.pumps[i], t = a.net.t, sf = g.safety;
    const [pt, pc] = p.fault ? ['LỖI', 'fault'] : p.running ? ['CHẠY', 'run'] : ['DỪNG', 'stop'];
    txt(C.pill, pt); cls(C.pill, 'c3d-pill ' + pc);
    txt(C.v_f, fmt(p.f, 1)); txt(C.v_kw, fmt(p.kw, 2)); txt(C.v_a, fmt(p.amps, 1)); txt(C.v_p, fmt(pu.gauge, 2));
    C.fbar.style.width = clamp((p.f ?? 0) / 50 * 100, 0, 100).toFixed(1) + '%';
    show(C.seen, this.where === 'remote');
    if (this.where === 'remote') {
      const r = dw.pumps[i];
      txt(C.seen, `Trung tâm thấy: ${r.running ? 'chạy ' + fmt(r.f, 1, 'Hz') : 'dừng'} · ${dw.stale ? 'DỮ LIỆU CŨ (mất kết nối)' : dw.age !== null ? `bản tin ${Math.round(dw.age)} s trước` : 'chưa có bản tin'}`);
    }
    // nút lệnh
    for (const b of [C.btnRun, C.btnStop, C.btnSpeed, C.range]) dis(b, !can);
    C.btnRun.classList.toggle('on', p.want === true);
    C.btnStop.classList.toggle('on', p.want === false);
    if (!C.editing || !can) C.range.value = p.f_set ?? (p.running ? clamp(p.f, 25, 50) : 40);
    txt(C.rangeVal, fmt(+C.range.value, 1, 'Hz'));
    // vì sao bơm chưa chạy dù đã ra lệnh
    let why = '';
    if (!d.dead && g.manual && p.want && !p.running && !p.fault) {
      const sinceStop = t - g.pm.stop_t[i];
      if (sf.last_block) why = 'Liên động đang chặn: ' + sf.last_block;
      else if (p.starts_h >= a.cfg.safety.max_starts_per_h) why = `Đã khởi động ${p.starts_h} lần trong 1 giờ – tạm cấm khởi động (bảo vệ động cơ)`;
      else if (sinceStop < a.cfg.safety.min_off_s) why = `Chờ thời gian nghỉ tối thiểu, còn ${Math.ceil(a.cfg.safety.min_off_s - sinceStop)} s`;
      else why = 'Đã nhận lệnh chạy – biến tần đang khởi động';
    } else if (!d.dead && g.manual && p.running && sf.limiting) why = `Lớp an toàn giới hạn tần số ≤ ${fmt(sf.f_cap, 1)} Hz do áp cao`;
    show(C.block, why); if (why) txt(C.block, why);
    // điều kiện cho phép
    const perm = permissives(a, i), bad = perm.find((x) => !x[0]);
    show(C.permHead, perm.length);
    if (perm.length) {
      cls(C.permHead, 'c3d-permhead ' + (bad ? 'bad' : 'ok') + (this.permOpen ? ' open' : ''));
      txt(C.permHead, bad ? 'Chưa đạt: ' + bad[1] : `Đủ điều kiện cho phép chạy (${perm.length}/${perm.length})`);
      attr(C.permHead, 'aria-expanded', this.permOpen);
    }
    show(C.permList, this.permOpen && perm.length);
    const pk = perm.map((x) => +x[0]).join('') + this.permOpen;
    if (this.permOpen && (force || pk !== C.permKey)) {
      C.permKey = pk;
      C.permList.replaceChildren(...perm.map(([ok, s]) => h('li', { class: ok ? 'ok' : 'no' }, s)));
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
    const a = this.app, g = a.st.gw, sf = g.safety, dead = d.dead;
    const trip = !dead && (sf.safe_stop || sf.lockout || sf.trip_active);
    txt(C.pill, dead ? 'MINI PC LỖI' : sf.safe_stop ? 'DỪNG AN TOÀN' : sf.lockout || sf.trip_active ? 'CẮT ÁP CAO' : ({ a: 'BÌNH THƯỜNG', b: 'TỰ VẬN HÀNH', c: 'ĐỒNG BỘ', d: 'CẢNH BÁO' }[d.mode] || d.mode));
    cls(C.pill, 'c3d-pill ' + (dead || trip ? 'fault' : { good: 'run', warning: 'wait', info: 'info', critical: 'fault' }[MODE_CHIP[d.mode]] || 'stop'));
    const safety = dead ? 'chỉ còn liên động cứng (LSLL, PSV-01, bảo vệ biến tần)' : sf.safe_stop ? `DỪNG AN TOÀN – ${sf.safe_reason}` : sf.lockout ? 'KHÓA sau nhiều lần cắt áp cao'
      : sf.trip_active ? 'cắt bơm do áp rất cao' : (sf.level_trip || a.st.sensors.lsll) ? 'mức bể rất thấp – chống chạy khô' : sf.limiting ? `giới hạn tần số ≤ ${fmt(sf.f_cap, 1)} Hz` : 'bình thường';
    const pumps = d.pumps.map((p) => `${p.tag} ${p.fault ? 'LỖI' : p.running ? fmt(p.f, 1, 'Hz') : 'dừng'}`).join(' · ');
    const rows = [['Chế độ gateway', dead ? MODE_NAME.x : MODE_NAME[d.mode]], ['Lớp an toàn', safety], ['Bơm', pumps], ['Áp ra / đặt', `${fmt(d.p1, 2)} / ${fmt(d.p_set, 2)} bar`], ['Kết nối', COMMS[d.comms] || d.comms]];
    const key = rows.map((r) => r[1]).join('|');
    if (key !== C.rowKey) {
      C.rowKey = key;
      C.rows.replaceChildren(...rows.map(([k, v], j) => h('tr', { class: j === 1 && (sf.safe_stop || sf.lockout || dead) ? 'bad' : '' }, h('td', {}, k), h('td', { class: 'wrap' }, v))));
    }
    dis(C.btnReset, dead);
    cls(C.btnReset, 'btn small' + (!dead && (sf.safe_stop || sf.lockout) ? ' c3d-amber' : ''));
    dis(C.btnRotate, dead || d.ctl !== 'auto');
    txt(C.lock, dead ? '' : d.ctl !== 'auto' ? 'Luân phiên bơm chỉ có tác dụng ở TỰ ĐỘNG; đặt lại cần chất lượng nước đã ổn định.'
      : 'Đặt lại chỉ được chấp nhận khi chất lượng nước đã ổn định đủ lâu; luân phiên đổi bơm chính ở lần chạy tới.');
    show(C.lock, !dead);
  }
  /** Xu hướng nhỏ 60 phút (tần số bơm, hoặc áp đầu ra/áp đặt cho thẻ trạm) – vẽ khoảng 1 lần/giây. */
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
    const H = this.app.st.hist.data, t1 = this.app.net.t, t0 = t1 - 3600;
    let i0 = H.t.length; while (i0 > 0 && H.t[i0 - 1] >= t0) i0--;
    const X = (tt) => ((tt - t0) / 3600) * (w - 2) + 1;
    const lines = C.kind === 'pump' ? [[H['f' + (C.i + 1)], col('--accent', '#1d6cae'), 0, 52, false]] : [[H.p_set, col('--muted', '#7b8783'), 0, 5, true], [H.p_out, col('--accent', '#1d6cae'), 0, 5, false]];
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
  /** Gọi mỗi khung hình 3D: đặt lại vị trí các bảng nổi theo camera (chỉ đổi transform/thuộc tính, không tạo DOM). */
  frame() {
    if (!this.app.st || !this.app.scene3d) return;
    const sc = this.app.scene3d;
    if (this.mkOn) {
      for (const m of this.markers) {
        if (m.hide) continue;
        const p = sc.screenPos(m.tag, m.p);
        if (p.visible !== m.vis) { m.vis = p.visible; m.el.style.visibility = p.visible ? '' : 'hidden'; }
        if (!p.visible) continue;
        const x = Math.round(p.x), y = Math.round(p.y);
        if (x !== m.x || y !== m.y) { m.x = x; m.y = y; m.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; }
      }
    }
    if (this.cur) this._placeCard();
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
  _placeCard() {
    const C = this.cur, sc = this.app.scene3d;
    const p = sc.bodyPos(C.tag, this._p), W = this.W, H = this.H, m = 10, gap = 48;
    if (this.sheet) {
      // tấm trượt đáy: không neo; thiết bị ngoài khung thì gợi ý ở giữa mép trên
      this._leadOn(false); show(this.offHint, !p.visible);
      if (!p.visible) { this.offHint.style.transform = `translate(${Math.round(W / 2)}px, 30px) translate(-50%, -50%)`; this.offArrow.style.transform = `rotate(${Math.atan2(p.dy, p.dx).toFixed(3)}rad)`; }
      return;
    }
    const cw = Math.min(this.cw, W - 2 * m), ch = Math.min(this.ch, H - 2 * m);
    if (p.visible) {
      const fitR = p.x + gap + cw <= W - m, fitL = p.x - gap - cw >= m;
      let side = this.side;
      if (side > 0 && !fitR && fitL) side = -1;
      else if (side < 0 && !fitL && fitR) side = 1;
      else if (!fitR && !fitL) side = p.x < W / 2 ? 1 : -1;
      this.side = side;
      const x = clamp(side > 0 ? p.x + gap : p.x - gap - cw, m, W - cw - m);
      const y = clamp(p.y - ch * 0.3, m, Math.max(m, H - ch - m));
      this._moveCard(x, y);
      const inside = p.x > x - 6 && p.x < x + cw + 6 && p.y > y - 6 && p.y < y + ch + 6;
      this._leadOn(!inside);
      if (!inside) this._setLead(p.x, p.y, p.x < x ? x : p.x > x + cw ? x + cw : clamp(p.x, x + 16, x + cw - 16), clamp(p.y, y + 22, y + ch - 22));
      show(this.offHint, false);
    } else {
      this._leadOn(false);
      if (C.tx === null) this._moveCard(W - cw - m, clamp(H * 0.12, m, Math.max(m, H - ch - m)));
      // gợi ý ở mép khung theo hướng tới thiết bị (kể cả khi thiết bị ở sau camera)
      const dx = p.dx, dy = p.dy, kx = (W / 2 - 110) / Math.max(1e-3, Math.abs(dx)), ky = (H / 2 - 48) / Math.max(1e-3, Math.abs(dy));
      const k = Math.max(0, Math.min(kx, ky));
      const hx = Math.round(W / 2 + dx * k), hy = Math.round(H / 2 + dy * k);
      show(this.offHint, true);
      this.offHint.style.transform = `translate(${hx}px, ${hy}px) translate(-50%, -50%)`;
      this.offArrow.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
    }
  }
}
