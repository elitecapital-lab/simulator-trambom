// Màn hình HMI 2D theo phong cách ISA-101 (hiệu năng cao): nền xám trung tính, màu chỉ dành cho bất thường.
// Hai vị trí vận hành:
//   - Tại trạm (màn cảm ứng HMI-01 trên cửa tủ CP-02): đọc trực tiếp từ gateway, lệnh đi thẳng, không qua mạng.
//   - Trung tâm (SCADA): chỉ thấy dữ liệu MÁY CHỦ đã nhận qua MQTT (chu kỳ 10 s, đứng yên khi mất mạng);
//     lệnh đi qua máy chủ, có thời hạn ngắn, có thể bị từ chối (quyền tại chỗ) hoặc hết hạn (mất mạng).
import { fmtClock } from '../sim/util.js';
import { h, fmt, SEV_LABEL, tShort } from './dom.js';

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
const SEV_ORDER = { critical: 0, alarm: 1, warning: 2, info: 3 };
const CTL_NAME = { auto: 'TỰ ĐỘNG', remote: 'TAY · TỪ XA', local: 'TAY · TẠI CHỖ' };
const MODE_NAME = { a: '(a) Bình thường', b: '(b) Tự vận hành', c: '(c) Đồng bộ', d: '(d) Cảnh báo / an toàn', x: 'Mini PC lỗi · PID biến tần' };
const MODE_CHIP = { a: 'good', b: 'warning', c: 'info', d: 'critical', x: 'critical' };
const TANK = { x: 100, y0: 130, y1: 470, w: 200, hMax: 4.2 };
const lvY = (L) => TANK.y1 - (Math.max(0, Math.min(TANK.hMax, L)) / TANK.hMax) * (TANK.y1 - TANK.y0);

export class HmiView {
  constructor(host, app) {
    this.app = app;
    this.where = 'local';
    this.sel = 0; // 0 = P-01, 1 = P-02, 2 = MV-02
    this.R = {};
    this.F = {};
    this.root = h('div', { class: 'hmi', hidden: true, 'aria-label': 'Màn hình HMI trạm bơm' });
    host.append(this.root);
    this._build();
  }
  show(on) { this.visible = on; this.root.hidden = !on; if (on) this.update(true); }
  setWhere(w) { this.where = w; this._editing = false; this.update(true); }

  // ---------------- dựng giao diện ----------------
  _build() {
    this.title = h('b', { class: 'hmi-title' });
    this.whereSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Vị trí người vận hành' },
      h('button', { 'data-w': 'local', onclick: () => this.setWhere('local') }, 'Tại trạm · HMI-01'),
      h('button', { 'data-w': 'remote', onclick: () => this.setWhere('remote') }, 'Trung tâm · SCADA'));
    this.chips = h('div', { class: 'hmi-chips' });
    this.clock = h('span', { class: 'mono hmi-clock' });
    const top = h('div', { class: 'hmi-top' }, this.title, this.whereSeg, this.chips, h('span', { class: 'spacer' }), this.clock);
    this.alarmBox = h('div', { class: 'hmi-alarms', 'aria-live': 'polite' });
    this.stale = h('div', { class: 'hmi-stale', hidden: true });
    this.svg = this._pid();
    this.side = this._faceplates();
    const body = h('div', { class: 'hmi-body' }, h('div', { class: 'hmi-pidwrap' }, this.svg, this.stale), this.side);
    this.root.append(top, this.alarmBox, body);
  }

  _bubble(tag, x, y, lineTo = null) {
    const [a, b] = tag.split('-');
    const g = S('g', { class: 'hmi-inst', onclick: () => this.app.openDrawer(tag) },
      lineTo ? S('line', { x1: x, y1: y + 16, x2: lineTo[0], y2: lineTo[1], class: 'hmi-lead' }) : null,
      S('circle', { cx: x, cy: y, r: 16 }),
      S('line', { x1: x - 16, y1: y, x2: x + 16, y2: y, class: 'hmi-bar' }),
      S('text', { x, y: y - 4, class: 'hmi-it', text: a }),
      S('text', { x, y: y + 11, class: 'hmi-it', text: b }));
    g.append(S('title', { text: tag }));
    return g;
  }
  _value(key, x, y, w = 92) {
    const r = S('rect', { x, y, width: w, height: 20, rx: 3, class: 'hmi-vbox' });
    const t = S('text', { x: x + w - 6, y: y + 14.5, class: 'hmi-val', 'text-anchor': 'end' });
    this.R['v:' + key] = { r, t };
    return S('g', {}, r, t);
  }
  _setVal(key, text, state = '') {
    const v = this.R['v:' + key];
    if (!v) return;
    if (v.t.textContent !== text) v.t.textContent = text;
    v.r.setAttribute('class', 'hmi-vbox' + (state ? ' ' + state : ''));
  }
  _pid() {
    const svg = S('svg', { viewBox: '0 0 1000 580', class: 'hmi-pid', role: 'img', 'aria-label': 'Sơ đồ công nghệ trạm bơm ST-01' });
    const R = this.R;
    const line = (d, cls = 'hmi-pipe') => S('path', { d, class: cls });
    // ---- cấp nước vào: ống thành phố -> FT-100 -> FV-01 -> bể ----
    svg.append(S('text', { x: 12, y: 92, class: 'hmi-lbl', text: 'ỐNG CẤP THÀNH PHỐ' }),
      line('M10 70 H150 V128'), S('rect', { x: 58, y: 63, width: 26, height: 14, class: 'hmi-eq' }),
      this._bubble('FT-100', 71, 30, [71, 63]), this._value('qin', 92, 20, 84),
      S('path', { d: 'M142 92 L158 108 L158 92 L142 108 Z', class: 'hmi-eq', onclick: () => this.app.openDrawer('FV-01') }),
      S('text', { x: 164, y: 104, class: 'hmi-tag', text: 'FV-01' }));
    // ---- bể chứa T-01 ----
    R.water = S('rect', { x: TANK.x + 2, y: TANK.y1, width: TANK.w - 4, height: 0, class: 'hmi-water' });
    svg.append(S('rect', { x: TANK.x, y: TANK.y0, width: TANK.w, height: TANK.y1 - TANK.y0, class: 'hmi-tank', onclick: () => this.app.openDrawer('T-01') }), R.water);
    for (const [L, txt] of [[3.8, '3,8 phao đóng'], [1.2, '1,2 tiết kiệm'], [0.6, '0,6 dừng bơm'], [0.35, '0,35 LSLL']]) {
      svg.append(S('line', { x1: TANK.x, y1: lvY(L), x2: TANK.x + TANK.w, y2: lvY(L), class: 'hmi-mark' }),
        S('text', { x: TANK.x + TANK.w - 4, y: lvY(L) - 3, class: 'hmi-small', 'text-anchor': 'end', text: txt }));
    }
    svg.append(S('text', { x: TANK.x + 8, y: TANK.y0 + 18, class: 'hmi-tag', text: 'T-01 · BỂ 192 m³ (hữu ích 154 m³)' }),
      this._bubble('LT-101', 262, 96, [262, 130]), this._value('level', 162, 86, 80),
      this._bubble('LSLL-101', 66, lvY(0.35) - 26), S('line', { x1: 82, y1: lvY(0.35) - 26, x2: 100, y2: lvY(0.35), class: 'hmi-lead' }),
      S('path', { d: `M100 455 H76 M68 447 L84 463 M68 463 L84 447`, class: 'hmi-eq', onclick: () => this.app.openDrawer('VX-01') }),
      S('text', { x: 40, y: 480, class: 'hmi-tag', text: 'VX-01' }));
    R.lsll = S('circle', { cx: 66, cy: lvY(0.35) - 26, r: 16, class: 'hmi-lsll' });
    svg.append(R.lsll);
    // ---- ống hút + cụm bơm ----
    svg.append(line('M300 440 H380 M380 250 V410 M380 250 H420 M380 410 H420'),
      line('M480 250 H530 M480 410 H530 M530 410 V180'));
    R.pumps = [];
    [250, 410].forEach((y, i) => {
      const tag = i === 0 ? 'P-01' : 'P-02';
      const body = S('circle', { cx: 450, cy: y, r: 30, class: 'hmi-pump' });
      const tri = S('path', { d: `M432 ${y - 16} L472 ${y} L432 ${y + 16} Z`, class: 'hmi-pumptri' });
      const sel = S('rect', { x: 412, y: y - 38, width: 76, height: 76, rx: 6, class: 'hmi-sel' });
      const g = S('g', { class: 'hmi-click', onclick: () => { this.sel = i; this._editing = false; this.update(true); } }, sel, body, tri,
        S('text', { x: 450, y: y + 50, class: 'hmi-tag', 'text-anchor': 'middle', text: tag }), S('title', { text: tag + ' – nhấp để mở bảng điều khiển' }));
      // van một chiều + đồng hồ áp kim
      svg.append(g, S('path', { d: `M500 ${y - 8} L516 ${y} L500 ${y + 8} Z M517 ${y - 9} V${y + 9}`, class: 'hmi-eq' }),
        S('circle', { cx: 500, cy: y - 24, r: 7, class: 'hmi-eq' }), S('line', { x1: 500, y1: y - 17, x2: 500, y2: y, class: 'hmi-lead' }));
      // hộp biến tần VFD (hiện trạng)
      const vy = y + 62;
      const box = S('rect', { x: 384, y: vy, width: 142, height: 50, rx: 4, class: 'hmi-vfd' });
      const t1 = S('text', { x: 390, y: vy + 14, class: 'hmi-small' }), t2 = S('text', { x: 390, y: vy + 30, class: 'hmi-val' }), t3 = S('text', { x: 390, y: vy + 44, class: 'hmi-small' });
      const fbar = S('rect', { x: 384, y: vy + 50, width: 0, height: 4, class: 'hmi-fbar' });
      svg.append(S('g', { class: 'hmi-click', onclick: () => { this.sel = i; this._editing = false; this.update(true); } }, box, t1, t2, t3,
        S('rect', { x: 384, y: vy + 50, width: 142, height: 4, class: 'hmi-ftrack' }), fbar));
      R.pumps.push({ body, tri, sel, t1, t2, t3, fbar, box });
    });
    // ---- ống đẩy: PT-101/102, HT-01, PSV-01, FT-101, MV-02 -> mạng lưới ----
    svg.append(line('M530 180 H958'), S('path', { d: 'M958 172 L974 180 L958 188 Z', class: 'hmi-pipehead' }),
      this._bubble('PT-101', 580, 132, [580, 180]), this._value('p1', 534, 92, 92),
      this._bubble('PT-102', 680, 132, [680, 180]), this._value('p2', 634, 92, 92));
    svg.append(line('M730 180 V202'), S('rect', { x: 714, y: 202, width: 32, height: 60, rx: 16, class: 'hmi-eq', onclick: () => this.app.openDrawer('HT-01') }),
      S('text', { x: 730, y: 280, class: 'hmi-tag', 'text-anchor': 'middle', text: 'HT-01' }));
    R.psv = S('path', { d: 'M790 186 L782 204 L798 204 Z M782 212 L798 212 L790 204 Z', class: 'hmi-eq' });
    svg.append(line('M790 180 V186'), R.psv, S('text', { x: 802, y: 210, class: 'hmi-tag', text: 'PSV-01' }), this._value('psv', 776, 222, 70));
    svg.append(S('rect', { x: 806, y: 172, width: 28, height: 16, class: 'hmi-eq' }), this._bubble('FT-101', 820, 132, [820, 172]), this._value('q', 774, 92, 92));
    R.valve = S('path', { d: 'M866 168 L894 192 L894 168 L866 192 Z', class: 'hmi-valve' });
    R.valveSel = S('rect', { x: 858, y: 136, width: 44, height: 64, rx: 6, class: 'hmi-sel' });
    svg.append(S('g', { class: 'hmi-click', onclick: () => { this.sel = 2; this.update(true); } }, R.valveSel, R.valve,
      S('rect', { x: 872, y: 144, width: 16, height: 14, class: 'hmi-eq' }), S('text', { x: 880, y: 155, class: 'hmi-it', text: 'M' }),
      S('line', { x1: 880, y1: 158, x2: 880, y2: 180, class: 'hmi-lead' }), S('title', { text: 'MV-02 – nhấp để mở bảng điều khiển' })),
    S('text', { x: 880, y: 212, class: 'hmi-tag', 'text-anchor': 'middle', text: 'MV-02' }), this._value('valve', 852, 218, 66),
    S('text', { x: 992, y: 150, class: 'hmi-lbl', 'text-anchor': 'end', text: 'MẠNG DMA-A' }));
    // ---- chỉ thị tương tự (moving analog) ----
    svg.append(S('text', { x: 600, y: 286, class: 'hmi-lbl', text: 'CHỈ THỊ CHÍNH' }));
    R.bars = {};
    [['p', 'Áp đầu ra', 'bar', 0, 6, 306], ['pc', 'Áp điểm bất lợi', 'bar', 0, 4, 336], ['qb', 'Lưu lượng ra', 'm³/h', 0, 40, 366], ['kw', 'Công suất điện', 'kW', 0, 12, 396]].forEach(([k, name, unit, lo, hi, y]) => {
      const x0 = 712, w = 170;
      const band = S('rect', { x: x0, y: y - 6, width: 0, height: 12, class: 'hmi-band' });
      const sp = S('path', { d: '', class: 'hmi-sp' });
      const ptr = S('path', { d: '', class: 'hmi-ptr' });
      const val = S('text', { x: 970, y: y + 4, class: 'hmi-val', 'text-anchor': 'end' });
      svg.append(S('text', { x: 600, y: y + 4, class: 'hmi-small', text: name }), S('rect', { x: x0, y: y - 3, width: w, height: 6, class: 'hmi-track' }), band, sp, ptr, val,
        S('text', { x: x0, y: y + 17, class: 'hmi-tiny', text: String(lo) }), S('text', { x: x0 + w, y: y + 17, class: 'hmi-tiny', 'text-anchor': 'end', text: hi + ' ' + unit }));
      R.bars[k] = { x0, w, lo, hi, y, band, sp, ptr, val };
    });
    // ---- chất lượng nước ----
    svg.append(S('text', { x: 20, y: 502, class: 'hmi-lbl', text: 'CHẤT LƯỢNG NƯỚC (QCVN 01-1:2018/BYT)' }));
    R.qual = {};
    [['cl', 'AIT-201', 'Clo dư', 'mg/L', '0,2–1,0'], ['ntu', 'AIT-202', 'Độ đục', 'NTU', '≤ 2'], ['ph', 'AIT-203', 'pH', '', '6,0–8,5']].forEach(([k, tag, name, unit, lim], i) => {
      const x = 20 + i * 104;
      const r = S('rect', { x, y: 510, width: 100, height: 60, rx: 4, class: 'hmi-qbox' });
      const v = S('text', { x: x + 94, y: 546, class: 'hmi-val big', 'text-anchor': 'end' });
      svg.append(S('g', { class: 'hmi-click', onclick: () => this.app.openDrawer(tag) }, r, S('text', { x: x + 6, y: 524, class: 'hmi-small', text: name }), v,
        S('text', { x: x + 6, y: 563, class: 'hmi-tiny', text: `${tag} · ${lim}${unit ? ' ' + unit : ''}` }), S('title', { text: `${tag} ${name} – giới hạn ${lim}` })));
      R.qual[k] = { r, v };
    });
    // ---- xu hướng 2 giờ ----
    const tx = 560, ty = 430, tw = 410, th = 130;
    R.trend = { x: tx, y: ty, w: tw, h: th };
    svg.append(S('text', { x: tx, y: ty - 8, class: 'hmi-lbl', text: 'XU HƯỚNG ÁP LỰC 2 GIỜ (bar)' }),
      S('rect', { x: tx, y: ty, width: tw, height: th, class: 'hmi-trendbg' }));
    for (const v of [1.4, 4.0]) {
      const y = ty + th - (v / 5) * th;
      svg.append(S('line', { x1: tx, y1: y, x2: tx + tw, y2: y, class: 'hmi-mark' }), S('text', { x: tx + 4, y: y - 3, class: 'hmi-tiny', text: fmt(v, 1) }));
    }
    R.trP = S('polyline', { points: '', class: 'hmi-tr-p' });
    R.trS = S('polyline', { points: '', class: 'hmi-tr-s' });
    R.trC = S('polyline', { points: '', class: 'hmi-tr-c' });
    R.trLegend = S('text', { x: tx + tw - 4, y: ty + 12, class: 'hmi-tiny', 'text-anchor': 'end' });
    svg.append(R.trC, R.trS, R.trP, R.trLegend);
    return svg;
  }

  _faceplates() {
    const F = this.F;
    F.ctlName = h('div', { class: 'hmi-ctlname' });
    F.ctlDetail = h('p', { class: 'note' });
    F.btnManual = h('button', { class: 'btn', onclick: () => this.send('set_mode', { mode: 'manual' }) }, 'Chuyển sang TAY');
    F.btnAuto = h('button', { class: 'btn', onclick: () => this.send('set_mode', { mode: 'auto' }) }, 'Trả về TỰ ĐỘNG');
    F.auth = h('p', { class: 'note hmi-warn', hidden: true });
    F.eqSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Chọn thiết bị' },
      ...['P-01', 'P-02', 'MV-02'].map((tag, i) => h('button', { onclick: () => { this.sel = i; this._editing = false; this.update(true); } }, tag)));
    F.eqChip = h('span', { class: 'chip' });
    F.eqRows = h('tbody');
    F.btnStart = h('button', { class: 'btn', onclick: () => this.send('pump_start', { pump: this.sel, f_hz: +F.range.value }) }, 'CHẠY');
    F.btnStop = h('button', { class: 'btn', onclick: () => this.send('pump_stop', { pump: this.sel }) }, 'DỪNG');
    F.range = h('input', { type: 'range', min: 25, max: 50, step: 0.5, value: 40, 'aria-label': 'Tần số đặt (Hz)', oninput: () => { this._editing = true; F.rangeVal.textContent = fmt(+F.range.value, 1, 'Hz'); } });
    F.rangeVal = h('span', { class: 'mono' });
    F.btnSpeed = h('button', { class: 'btn', onclick: () => { this._editing = false; this.send('pump_speed', { pump: this.sel, f_hz: +F.range.value }); } }, 'Đặt tần số');
    F.pumpCtl = h('div', { class: 'hmi-ctlbox' }, h('div', { class: 'row' }, F.btnStart, F.btnStop),
      h('div', { class: 'row' }, F.range, F.rangeVal), h('div', { class: 'row' }, F.btnSpeed));
    F.btnOpen = h('button', { class: 'btn', onclick: () => this.send('valve', { open: true }) }, 'MỞ VAN');
    F.btnClose = h('button', { class: 'btn', onclick: () => this.send('valve', { open: false }) }, 'ĐÓNG VAN');
    F.valveCtl = h('div', { class: 'hmi-ctlbox row' }, F.btnOpen, F.btnClose);
    F.lockNote = h('p', { class: 'note' });
    F.perm = h('ul', { class: 'hmi-perm' });
    F.btnReset = h('button', { class: 'btn small', onclick: () => this.send('reset_safe_stop', {}) }, 'Đặt lại dừng an toàn');
    F.btnRotate = h('button', { class: 'btn small', onclick: () => this.send('rotate_pumps', {}) }, 'Luân phiên bơm');
    F.cmdLog = h('div', { class: 'hmi-cmdlog' });
    return h('div', { class: 'hmi-side' },
      h('section', {}, h('span', { class: 'lbl' }, 'Chế độ điều khiển trạm'), F.ctlName, F.ctlDetail, h('div', { class: 'row' }, F.btnManual, F.btnAuto), F.auth),
      h('section', {}, h('div', { class: 'row' }, F.eqSeg, F.eqChip), h('table', { class: 'kv fixed' }, F.eqRows), F.pumpCtl, F.valveCtl, F.lockNote),
      h('section', {}, h('span', { class: 'lbl' }, 'Điều kiện cho phép & liên động'), F.perm),
      h('section', {}, h('div', { class: 'row' }, F.btnReset, F.btnRotate)),
      h('section', {}, h('span', { class: 'lbl' }, 'Nhật ký lệnh'), F.cmdLog));
  }

  // ---------------- lệnh ----------------
  send(type, args) {
    const a = this.app, t = a.net.t;
    if (this.where === 'local') {
      if (a.st.gw_dead) { a.toast('Mini PC đang ngừng – màn HMI-01 mất kết nối với bộ điều khiển'); return; }
      const [ok, why] = a.st.gw.localCommand(type, args, t);
      a.toast((ok ? '✓ ' : '✗ TỪ CHỐI: ') + why);
    } else {
      const ttl = ['set_mode', 'pump_start', 'pump_stop', 'pump_speed', 'valve'].includes(type) ? a.cfg.gateway.manual_cmd_ttl_s : 900;
      const id = a.server.sendCommand(a.st.sid, type, args, t, ttl);
      a.toast(`Đã gửi ${id} ${type} qua MQTT (hạn ${(ttl / 60).toFixed(0)} phút) – chờ trạm xác nhận`);
    }
    a._updatePanels(true);
  }
  ackAlarm(code) {
    const a = this.app, t = a.net.t;
    if (this.where === 'local' && a.st.gw_dead) { a.toast('Mini PC đang ngừng – HMI-01 không xác nhận được báo động'); return; }
    if (this.where === 'local') a.st.gw.alarms.ack(code, t);
    else a.server.ackAlarm(a.st.sid, code, t);
    this.update(true);
  }

  // ---------------- dữ liệu theo vị trí vận hành ----------------
  _data() {
    const a = this.app, st = a.st, g = st.gw, pl = st.plant, t = a.net.t;
    if (this.where === 'local') {
      const sig = g.sig || {}, dead = Boolean(st.gw_dead);
      const alarms = [...g.alarms.active.values()].map((x) => ({ ...x, station: st.sid }));
      return { t, dead, stale: dead, p1: sig.p1, p2: sig.p2, q: sig.q_f, q_in: sig.q_in_f, level: sig.level, cl: sig.cl, ntu: sig.ntu, ph: sig.ph,
        kw: pl.kw, p_set: dead ? st.gw_dead.p_set : g.ctrl.p_set, p_crit: pl.p_crit, valve: pl.outlet_frac, psv: pl.q_relief,
        pumps: pl.pumps.map((pu, i) => ({ tag: pu.tag, running: pu.running, f: pu.f, kw: pu.kw, amps: pu.amps, fault: pu.fault, run_h: pu.run_s / 3600,
          starts_h: g.pm.startsLastHour(i, t), f_set: g.manual ? g.manual.f[i] : null, want: g.manual ? g.manual.run[i] : null })),
        mode: dead ? 'x' : g.mode(), ctl: dead ? 'auto' : g.controlSrc(), comms: dead ? 'offline' : g.comms.state, alarms, installed: g.sig_proc.installed };
    }
    const S0 = a.server.stations[st.sid], r = S0.last || {};
    const alarms = [...a.server.alarms.values()].filter((x) => x.station === st.sid);
    const fault = (tag) => alarms.some((x) => x.code === 'PUMP_FAULT_' + tag);
    return { t, dead: false, stale: !S0.online, age: r.t1 !== undefined ? t - r.t1 : null, p1: r.p, p2: undefined, q: r.q, q_in: r.q_in, level: r.level,
      cl: r.cl, ntu: r.ntu, ph: r.ph, kw: r.kw, p_set: r.p_set, p_crit: undefined, valve: undefined, psv: undefined,
      pumps: [r.f1, r.f2].map((f, i) => ({ tag: i ? 'P-02' : 'P-01', running: (f ?? 0) > 0.5, f, kw: undefined, amps: undefined, fault: fault(i ? 'P-02' : 'P-01'),
        run_h: undefined, starts_h: undefined, f_set: null, want: null })),
      mode: S0.online ? (r.mode || 'a') : 'b', ctl: r.ctl || 'auto', comms: S0.online ? 'online' : 'offline', alarms, installed: null };
  }

  // ---------------- cập nhật ----------------
  update(force = false) {
    if (!this.visible || !this.app.st) return;
    const a = this.app, d = this._data(), R = this.R, F = this.F, local = this.where === 'local';
    const g = a.st.gw;
    this.root.classList.toggle('remote', !local);
    this.title.textContent = local ? 'ST-01 · HMI-01 TẠI TRẠM' : 'TRUNG TÂM ĐIỀU HÀNH · SCADA · ST-01';
    this.whereSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === this.where));
    this.clock.textContent = fmtClock(d.t, a.cfg.sim.start_dow);
    const chip = (cls, txt) => h('span', { class: 'chip ' + cls }, txt);
    this.svg.classList.toggle('stale', Boolean(d.dead || d.stale));
    const fbOn = d.dead && a.st.gw_dead.enabled && !a.st.gw_dead.inhibit;
    this.chips.replaceChildren(d.dead ? chip('critical', fbOn ? 'PID BIẾN TẦN' : 'KHÔNG CÓ ĐIỀU KHIỂN') : chip(d.ctl === 'auto' ? 'good' : 'warning', CTL_NAME[d.ctl]),
      chip(MODE_CHIP[d.mode] || 'off', d.mode === 'x' ? (fbOn ? MODE_NAME.x : 'Mini PC lỗi') : (MODE_NAME[d.mode] || d.mode)),
      chip(d.comms === 'online' ? 'good' : d.comms === 'resync' ? 'info' : 'off', { online: '4G trực tuyến', resync: 'đang đồng bộ', offline: 'mất kết nối' }[d.comms]));
    // dữ liệu cũ (trung tâm khi mất mạng) / mini PC lỗi
    if (d.dead) { this.stale.hidden = false; this.stale.textContent = 'MINI PC NGỪNG – HMI-01 MẤT DỮ LIỆU · ' + a.st.gw_dead.note(); }
    else if (d.stale) { this.stale.hidden = false; this.stale.textContent = `DỮ LIỆU CŨ – mất kết nối với trạm, bản tin cuối ${d.age !== null ? (d.age / 60).toFixed(0) + ' phút trước' : '–'}`; }
    else this.stale.hidden = true;
    // báo động
    const al = d.alarms.sort((x, y) => (SEV_ORDER[x.sev] - SEV_ORDER[y.sev]) || (y.t - x.t));
    const key = al.map((x) => x.code + x.acked).join(',') + this.where;
    if (force || key !== this._alKey) {
      this._alKey = key;
      this.alarmBox.replaceChildren(...(al.length ? al.slice(0, 4).map((x) => h('div', { class: 'hmi-al ' + x.sev + (x.acked ? ' acked' : '') },
        h('span', { class: 'chip ' + x.sev }, SEV_LABEL[x.sev] ?? x.sev), h('span', { class: 'mono' }, tShort(x.t)), h('b', {}, x.code), h('span', { class: 'msg' }, x.msg || ''),
        x.acked || x.code === 'STATION_OFFLINE' ? h('span', { class: 'note' }, x.acked ? 'đã xác nhận' : '') : h('button', { class: 'btn small', onclick: () => this.ackAlarm(x.code) }, 'Xác nhận')))
        : [h('div', { class: 'hmi-al none' }, 'Không có báo động đang hoạt động')]),
      al.length > 4 ? h('div', { class: 'note' }, `… và ${al.length - 4} báo động khác (xem tab Nhật ký)`) : '');
    }
    // giá trị trên sơ đồ
    const hw = d.installed;
    const absent = (tag) => hw && !hw.has(tag);
    const s = a.cfg.service;
    this._setVal('qin', absent('FT-100') ? (d.q_in !== null && d.q_in !== undefined ? '≈' + fmt(d.q_in, 1, 'm³/h') : 'không lắp') : fmt(d.q_in, 1, 'm³/h'));
    this._setVal('level', fmt(d.level, 2, 'm'), d.level !== undefined && d.level !== null && d.level < 1.2 ? 'warn' : '');
    this._setVal('p1', fmt(d.p1, 2, 'bar'), d.p1 > s.p_out_max_bar ? 'alarm' : '');
    this._setVal('p2', absent('PT-102') ? 'không lắp' : local ? fmt(d.p2, 2, 'bar') : 'không gửi', d.p2 > s.p_out_max_bar ? 'alarm' : '');
    this._setVal('q', fmt(d.q, 1, 'm³/h'));
    this._setVal('psv', d.psv === undefined ? '–' : d.psv > 0 ? 'XẢ ' + fmt(d.psv, 1) : 'đóng', d.psv > 0 ? 'alarm' : '');
    this._setVal('valve', d.valve === undefined ? '–' : d.valve > 0.99 ? 'MỞ' : d.valve < 0.01 ? 'ĐÓNG' : fmt(d.valve * 100, 0, '%'), d.valve !== undefined && d.valve < 0.99 ? 'warn' : '');
    const lv = d.level ?? 0;
    R.water.setAttribute('y', lvY(lv)); R.water.setAttribute('height', Math.max(0, TANK.y1 - lvY(lv)));
    R.lsll.setAttribute('class', 'hmi-lsll' + (local && a.st.sensors.lsll ? ' on' : ''));
    R.valve.setAttribute('class', 'hmi-valve' + (d.valve === undefined ? ' unk' : d.valve > 0.99 ? ' open' : d.valve < 0.01 ? ' closed' : ' moving'));
    R.valveSel.classList.toggle('on', this.sel === 2);
    R.psv.setAttribute('class', 'hmi-eq' + (d.psv > 0 ? ' alarmfill' : ''));
    d.pumps.forEach((p, i) => {
      const P = R.pumps[i];
      P.body.setAttribute('class', 'hmi-pump' + (p.fault ? ' fault' : p.running ? ' run' : ''));
      P.tri.setAttribute('class', 'hmi-pumptri' + (p.running ? ' run' : ''));
      P.sel.classList.toggle('on', this.sel === i);
      P.t1.textContent = `VFD-0${i + 1} ${p.fault ? 'LỖI' : p.running ? 'CHẠY' : 'DỪNG'} · ${d.ctl !== 'auto' ? 'TAY' : 'TỰ ĐỘNG'}`;
      P.t2.textContent = `${fmt(p.f, 1, 'Hz')}${p.kw !== undefined ? ' · ' + fmt(p.kw, 2, 'kW') : ''}`;
      P.t3.textContent = p.f_set !== null && p.f_set !== undefined ? (p.want ? `đặt TAY ${fmt(p.f_set, 1)} Hz` : `dừng (đặt ${fmt(p.f_set, 1)} Hz)`) : p.amps !== undefined ? `${fmt(p.amps, 1, 'A')} · ${fmt(p.run_h, 1, 'h')} chạy` : 'bản tin 10 s';
      P.box.setAttribute('class', 'hmi-vfd' + (p.fault ? ' fault' : ''));
      P.fbar.setAttribute('width', Math.max(0, Math.min(142, ((p.f ?? 0) / 50) * 142)));
    });
    // chỉ thị tương tự
    const bar = (k, v, band, sp, bad) => {
      const B = R.bars[k], X = (x) => B.x0 + Math.max(0, Math.min(1, (x - B.lo) / (B.hi - B.lo))) * B.w;
      if (band) { B.band.setAttribute('x', X(band[0])); B.band.setAttribute('width', X(band[1]) - X(band[0])); } else B.band.setAttribute('width', 0);
      B.sp.setAttribute('d', sp !== null && sp !== undefined && !Number.isNaN(sp) ? `M${X(sp)} ${B.y + 4} l-5 8 h10 z` : '');
      B.ptr.setAttribute('d', v !== null && v !== undefined && !Number.isNaN(v) ? `M${X(v)} ${B.y - 4} l-6 -9 h12 z` : '');
      B.val.textContent = v === undefined ? 'không đo' : fmt(v, 2);
      B.val.setAttribute('class', 'hmi-val' + (bad ? ' alarmtxt' : ''));
    };
    bar('p', d.p1, [a.cfg.script.params.pressure.p_set_min_bar, s.p_out_max_bar], d.p_set, d.p1 > s.p_out_max_bar);
    bar('pc', d.p_crit, [s.p_crit_min_bar, 4], null, d.p_crit !== undefined && d.p_crit < s.p_crit_min_bar);
    bar('qb', d.q, null, null, false);
    bar('kw', d.kw, null, null, false);
    // chất lượng
    const ql = a.cfg.quality_limits;
    for (const [k, v, bad, tag] of [['cl', d.cl, (x) => x < ql.cl_min || x > ql.cl_max, 'AIT-201'], ['ntu', d.ntu, (x) => x > ql.ntu_max, 'AIT-202'], ['ph', d.ph, (x) => x < ql.ph_min || x > ql.ph_max, 'AIT-203']]) {
      const Q = R.qual[k];
      const none = absent(tag);
      Q.v.textContent = none ? 'không lắp' : fmt(v, 2);
      Q.v.setAttribute('class', 'hmi-val big' + (none ? ' dim' : ''));
      Q.r.setAttribute('class', 'hmi-qbox' + (!none && v !== null && v !== undefined && bad(v) ? ' alarm' : ''));
    }
    this._trend(d);
    this._updateSide(d, g, force);
  }

  _trend(d) {
    const a = this.app, T = this.R.trend, t1 = d.t, t0 = t1 - 7200;
    const X = (t) => T.x + ((t - t0) / 7200) * T.w, Y = (v) => T.y + T.h - (Math.max(0, Math.min(5, v)) / 5) * T.h;
    const pts = (ts, vs) => { const o = []; for (let i = 0; i < ts.length; i++) if (ts[i] >= t0 && vs[i] !== null && vs[i] !== undefined && !Number.isNaN(vs[i])) o.push(X(ts[i]).toFixed(1) + ',' + Y(vs[i]).toFixed(1)); return o.join(' '); };
    if (this.where === 'local') {
      const H = a.st.hist.data;
      let i0 = H.t.length; while (i0 > 0 && H.t[i0 - 1] >= t0) i0--;
      const sl = (k) => H[k].slice(i0);
      const ts = H.t.slice(i0);
      this.R.trP.setAttribute('points', pts(ts, sl('p_out'))); this.R.trS.setAttribute('points', pts(ts, sl('p_set'))); this.R.trC.setAttribute('points', pts(ts, sl('p_crit')));
      this.R.trLegend.textContent = '— đầu ra  - - áp đặt  — điểm bất lợi';
    } else {
      const st = a.server.stations[a.st.sid], ts = [], vs = [];
      for (let m = Math.floor(t0 / 60); m <= Math.floor(t1 / 60); m++) { const r = st.series.get(m); if (r) { ts.push(m * 60 + 30); vs.push(r.p); } }
      this.R.trP.setAttribute('points', pts(ts, vs)); this.R.trS.setAttribute('points', ''); this.R.trC.setAttribute('points', '');
      this.R.trLegend.textContent = '— áp đầu ra máy chủ đã nhận (theo phút)';
    }
  }

  _updateSide(d, g, force) {
    const a = this.app, F = this.F, local = this.where === 'local', t = d.t;
    const fbx = a.st.gw_dead;
    F.ctlName.textContent = d.dead ? (fbx.enabled && !fbx.inhibit ? 'PID BIẾN TẦN (dự phòng)' : 'KHÔNG CÓ ĐIỀU KHIỂN') : CTL_NAME[d.ctl];
    F.ctlName.className = 'hmi-ctlname ' + (d.ctl === 'auto' ? 'auto' : 'man');
    if (d.dead) F.ctlDetail.textContent = `Mini PC ngừng: ${fbx.note()}${fbx.restarted ? ' (mini PC đã khởi động lại, đang theo dõi trước khi tiếp quản)' : ''}; không thể ra lệnh qua HMI cho tới khi mini PC tiếp quản.`;
    else if (d.ctl === 'auto') F.ctlDetail.textContent = `Kịch bản v${g.script.version} (${g.ctrl.strategy_used === 'custom' ? 'của học viên' : g.script.strategy}) điều khiển bơm; lớp an toàn luôn ưu tiên.`;
    else if (d.ctl === 'remote' && local === false && g.manual) F.ctlDetail.textContent = `Quyền điều khiển từ xa còn ${Math.max(0, (g.manual.until - t) / 60).toFixed(0)} phút (mỗi lệnh gia hạn); mất kết nối → trạm tự trở về TỰ ĐỘNG.`;
    else if (d.ctl === 'remote') F.ctlDetail.textContent = 'Trung tâm đang điều khiển tay; quyền có thời hạn và tự hủy khi mất kết nối.';
    else F.ctlDetail.textContent = 'Kỹ thuật viên tại trạm giữ quyền; lệnh từ trung tâm bị từ chối cho tới khi trả về TỰ ĐỘNG.';
    let auth = '';
    if (!local && d.ctl === 'local') auth = 'Quyền đang ở TẠI CHỖ – mọi lệnh điều khiển từ trung tâm sẽ bị trạm từ chối.';
    else if (local && d.ctl === 'remote') auth = 'Trung tâm đang điều khiển tay – thao tác trên HMI sẽ giành quyền (tại chỗ được ưu tiên).';
    else if (!local && d.stale) auth = 'Mất kết nối: lệnh sẽ xếp hàng ở máy chủ và hết hạn sau 1 phút nếu trạm chưa nhận.';
    F.auth.hidden = !auth; F.auth.textContent = auth;
    F.btnManual.disabled = d.dead || (d.ctl !== 'auto' && d.ctl === (local ? 'local' : 'remote'));
    F.btnAuto.disabled = d.dead || d.ctl === 'auto';
    F.eqSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === this.sel));
    const manualHere = d.ctl !== 'auto';
    const isPump = this.sel < 2;
    F.pumpCtl.hidden = !isPump; F.valveCtl.hidden = isPump;
    const rows = [];
    if (isPump) {
      const p = d.pumps[this.sel];
      F.eqChip.className = 'chip ' + (p.fault ? 'critical' : p.running ? 'good' : 'off'); F.eqChip.textContent = p.fault ? 'lỗi' : p.running ? 'đang chạy' : 'dừng';
      rows.push(['Tần số thực', fmt(p.f, 1, 'Hz')], ['Tần số đặt (TAY)', p.f_set !== null && p.f_set !== undefined ? fmt(p.f_set, 1, 'Hz') : '–'],
        ['Công suất / dòng', p.kw !== undefined ? `${fmt(p.kw, 2, 'kW')} · ${fmt(p.amps, 1, 'A')}` : 'không gửi'],
        ['Khởi động trong 1 giờ', p.starts_h !== undefined ? `${p.starts_h} / ${a.cfg.safety.max_starts_per_h}` : '–'], ['Giờ chạy', p.run_h !== undefined ? fmt(p.run_h, 1, 'h') : '–']);
      if (!this._editing && p.f_set !== null && p.f_set !== undefined) F.range.value = p.f_set;
      F.rangeVal.textContent = fmt(+F.range.value, 1, 'Hz');
      for (const b of [F.btnStart, F.btnStop, F.btnSpeed, F.range]) b.disabled = !manualHere || d.dead;
    } else {
      F.eqChip.className = 'chip ' + (d.valve === undefined ? 'off' : d.valve > 0.99 ? 'good' : 'warning');
      F.eqChip.textContent = d.valve === undefined ? 'không rõ' : d.valve > 0.99 ? 'mở' : d.valve < 0.01 ? 'đóng' : 'đang chạy';
      rows.push(['Độ mở', d.valve === undefined ? 'không gửi' : fmt(d.valve * 100, 0, '%')], ['Lệnh TAY', g.manual ? (g.manual.valve ? 'mở' : 'đóng') : 'theo lớp an toàn'],
        ['Thời gian hành trình', '20 s']);
      for (const b of [F.btnOpen, F.btnClose]) b.disabled = !manualHere || d.dead;
    }
    F.eqRows.replaceChildren(...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num wrap' }, v))));
    F.lockNote.textContent = d.dead ? '' : manualHere ? 'Lệnh tay vẫn đi qua lớp an toàn: liên động, giới hạn áp cao, số lần khởi động.' : 'Ở chế độ TỰ ĐỘNG – chuyển sang TAY để chạy/dừng bơm, đặt tần số, đóng/mở van.';
    // điều kiện cho phép
    const perm = [];
    if (local && !d.dead) {
      const sf = g.safety, pl = a.st.plant, sel = Math.min(this.sel, 1);
      perm.push([pl.outlet_frac >= 0.95, 'Van MV-02 mở hết (mở van trước, chạy bơm sau)'],
        [!sf.level_trip && !a.st.sensors.lsll, `Mức bể an toàn (> ${fmt(a.cfg.safety.level_ll_m, 1)} m, phao LSLL không báo cạn)`],
        [!sf.safe_stop, 'Không dừng an toàn do chất lượng nước' + (sf.safe_stop ? ` (${sf.safe_reason})` : '')],
        [!sf.trip_active && !sf.lockout, 'Không cắt/khóa do áp lực rất cao'],
        [!pl.pumps[sel].fault, `Biến tần ${pl.pumps[sel].tag} không báo lỗi`],
        [g.pm.startsLastHour(sel, t) < a.cfg.safety.max_starts_per_h, `Số lần khởi động ${pl.pumps[sel].tag} < ${a.cfg.safety.max_starts_per_h}/giờ`],
        [!sf.limiting, sf.limiting ? `Đang giới hạn tần số ≤ ${fmt(sf.f_cap, 1)} Hz do áp cao` : 'Không bị giới hạn tần số do áp cao']);
    }
    const pk = perm.map((x) => +x[0]).join('') + this.where + d.dead;
    if (force || pk !== this._permKey) {
      this._permKey = pk;
      F.perm.replaceChildren(...(perm.length ? perm.map(([ok, txt]) => h('li', { class: ok ? 'ok' : 'no' }, h('span', { 'aria-hidden': 'true' }, ok ? '✓' : '✗'), ' ', txt))
        : [h('li', { class: 'na' }, d.dead ? 'Mini PC ngừng – chỉ còn liên động cứng (phao LSLL, van an toàn PSV-01, bảo vệ biến tần).' : 'Trung tâm chỉ thấy báo động gửi lên; chi tiết liên động xem tại HMI trạm.')]));
    }
    F.btnReset.disabled = d.dead; F.btnRotate.disabled = d.dead || d.ctl !== 'auto';
    // nhật ký lệnh
    let items;
    if (local) items = g.cmd_results.slice(-6).reverse().map((c) => [c.t, c.id, c.type, c.status, c.reason]);
    else {
      const log = a.server.stations[a.st.sid].cmd_log, types = {};
      for (const c of log) if (c.type) types[c.id] = c.type;
      items = log.slice(-7).reverse().map((c) => [c.t, c.id, c.type || types[c.id] || '', c.status, c.reason]);
    }
    const ck = items.map((x) => x[1] + x[3]).join(',');
    if (force || ck !== this._cmdKey) {
      this._cmdKey = ck;
      const cls = { ok: 'good', queued: 'info', rejected: 'critical', expired: 'warning', expired_server: 'warning', duplicate: 'off' };
      const name = { ok: 'đã thực hiện', queued: 'đã gửi', rejected: 'từ chối', expired: 'hết hạn', expired_server: 'hết hạn ở máy chủ', duplicate: 'trùng' };
      F.cmdLog.replaceChildren(...(items.length ? items.map(([tt, id, type, st, why]) => h('div', { class: 'hmi-cmd' },
        h('span', { class: 'mono' }, tShort(tt)), h('span', { class: 'chip ' + (cls[st] || 'off') }, name[st] || st),
        h('div', {}, h('b', {}, `${id} ${type}`), why ? h('div', { class: 'note' }, why) : ''))) : [h('p', { class: 'note' }, 'Chưa có lệnh.')]));
    }
  }
}
