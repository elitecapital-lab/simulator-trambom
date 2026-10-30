// Các bảng của khung nổi bên phải (mở từ thanh chức năng) + bảng so sánh KPI. Cập nhật ~4 lần/giây từ main.js.
import { h, fmt, SEV_LABEL, tShort } from './dom.js';
import { ackAlarm, sortedAlarms, viNum } from './ops.js';
import { TEMPLATE_SOLUTION, TEMPLATE_TODO } from './student-template.js';
import { TwinSim } from '../sim/engine.js';

const MODE_TXT = { a: '(a) Bình thường – có kết nối', b: '(b) Mất mạng – gateway tự vận hành', c: '(c) Đồng bộ sau khôi phục kết nối', d: '(d) Cảnh báo / dừng an toàn' };
const COMMS_TXT = { online: 'Trực tuyến', offline: 'Mất kết nối', resync: 'Đang đồng bộ' };
export const SCOPE_TXT = { hien_trang: 'Hiện trạng', giai_phap: 'Giải pháp', khuyen_nghi: 'Khuyến nghị' };
export const SCOPE_DESC = {
  hien_trang: 'Thiết bị nhà máy ĐÃ CÓ trước khi cải tạo (bơm, biến tần, bể, van, phao, tủ động lực). Giữ nguyên hoặc chỉ cấu hình lại/nâng cấp nhỏ.',
  giai_phap: 'Thiết bị giải pháp ĐƯA VÀO để tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ: mini PC chạy edge gateway, I/O từ xa, cảm biến, router 4G, nguồn lưu điện, watchdog.',
  khuyen_nghi: 'Nên có để hệ thống vận hành trơn tru nhất: tăng dự phòng, an toàn, chẩn đoán và khả năng vận hành tại chỗ. Thiếu vẫn chạy được nhưng rủi ro/thiệt hại lớn hơn.',
};
const CHANGE_TXT = { giu_nguyen: 'giữ nguyên', cau_hinh_lai: 'cấu hình lại', nang_cap: 'nâng cấp', bo_sung: 'bổ sung mới', thay_the: 'thay thế' };
const PRIO_TXT = { bat_buoc: 'bắt buộc', nen_co: 'nên có', tuy_chon: 'tùy chọn' };
// Tùy chọn phần cứng mô phỏng được (cfg.hardware) và kịch bản thử tương ứng
export const HW_OPTS = [
  ['VFD_PID_fallback', 'Rơ-le watchdog WDR-01 + PID nội biến tần', 'Mini PC treo → sau 5 s biến tần tự giữ áp 3,0 bar. Không có: sau 10 s mô-đun I/O đưa lệnh chạy về 0, bơm dừng.', 'S11', 'basic'],
  ['PT-102', 'Cảm biến áp lực thứ hai PT-102', 'Đối chiếu chéo, biểu quyết 2/3 khi PT-101 kẹt/trôi.', 'S5', 'basic'],
  ['AIT-201', 'Máy đo clo dư online AIT-201', 'Dừng an toàn khi clo < 0,2 mg/L.', 'S9', 'basic'],
  ['AIT-202', 'Máy đo độ đục online AIT-202', 'Dừng an toàn khi độ đục > 2 NTU.', 'S4', 'basic'],
  ['AIT-203', 'Máy đo pH online AIT-203 (khuyến nghị)', 'Dừng an toàn khi pH ngoài 6,0–8,5.', 'S13', 'basic'],
  ['MV-02', 'Van điện đầu ra MV-02 (khuyến nghị)', 'Cách ly trạm khi dừng an toàn; trình tự mở van trước – chạy bơm sau.', 'S4', 'basic'],
  ['SMS', 'SMS dự phòng qua modem 4G', 'Báo động nghiêm trọng tới tổ trực khi mất mạng IP.', 'S9', 'basic'],
  ['FT-100_pulse', 'Đầu phát xung cho đồng hồ nước vào FT-100', 'Không có: ước lượng lưu lượng vào bằng cân bằng khối lượng (LT-101 + FT-101).', 'S6', 'advanced'],
];
const STRAT_TXT = { threshold: 'theo ngưỡng', predictive: 'dự báo', fallback: 'dự phòng (dự báo kém → ngưỡng)', custom: 'kịch bản học viên' };
// đặt chữ chỉ khi đổi (thẻ thông tin cập nhật mỗi nhịp mà không dựng lại)
const T = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
/** Nội dung chip chế độ: giữ chữ "(d)" viết thường dù chip in hoa. */
export const modeChipTxt = (s) => { const m = /^(\([a-z]\))(.*)$/.exec(s); return m ? [h('span', { class: 'ml' }, m[1]), m[2]] : [s]; };

export class Panels {
  constructor(app) { this.app = app; this.cells = {}; this.logFilter = 'all'; this.logSeen = 0; }

  // ---------------- Giám sát ----------------
  buildMonitor(pane) {
    const c = this.cells;
    this.units = {};
    const row = (k, label, unit = '', wrap = false) => { const td = h('td', { class: 'num' + (wrap ? ' wrap' : '') }); c[k] = td; this.units[k] = unit; return h('tr', {}, h('td', {}, label), td); };
    c.alarms = h('div');
    c.gwmode = h('span'); c.comms = h('span'); c.script = h('span'); c.strategy = h('span'); c.override = h('span'); c.bufTxt = h('span');
    c.bufBar = h('i'); c.bufMeter = h('div', { class: 'meter' }, c.bufBar);
    pane.append(
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('span', { class: 'lbl' }, 'Báo động đang hoạt động (gateway)'),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => this.app.tab('alarm'), title: 'Danh sách đầy đủ, lịch sử và xác nhận tất cả' }, 'Mở Báo động ›')), c.alarms),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Edge gateway GW-01'),
        h('table', { class: 'kv fixed' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Chế độ'), h('td', {}, c.gwmode)),
          h('tr', {}, h('td', {}, 'Kết nối máy chủ'), h('td', {}, c.comms)),
          h('tr', {}, h('td', {}, 'Kịch bản đang chạy'), h('td', {}, c.script)),
          h('tr', {}, h('td', {}, 'Chiến lược thực dùng'), h('td', {}, c.strategy)),
          h('tr', {}, h('td', {}, 'Lệnh ghi đè từ xa'), h('td', {}, c.override)),
          h('tr', {}, h('td', {}, 'Bộ đệm lưu-và-chuyển'), h('td', {}, c.bufMeter, c.bufTxt))))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Số đo & điều khiển (đã kiểm tra hợp lệ)'), c.sigNote = h('p', { class: 'note', hidden: '' }, 'Mini PC ngừng: các giá trị dưới đây là giá trị cuối cùng gateway xử lý trước khi treo.'),
        h('table', { class: 'kv fixed' }, h('tbody', {},
          row('p1', 'PT-101 áp đầu ra', 'bar'), row('p2', 'PT-102 áp bảo vệ', 'bar'), row('pset', 'Áp đặt P_set(Q)', 'bar'), row('pmodel', 'Áp theo mô hình bơm', 'bar'),
          row('pcrit', 'Áp điểm bất lợi (logger PL-301)', 'bar'), row('q', 'FT-101 lưu lượng ra', 'm³/h'), row('qfc', 'Dự báo lưu lượng', 'm³/h'), row('qin', 'FT-100 lưu lượng vào', 'm³/h'),
          row('lv', 'LT-101 mức bể', 'm'), row('tte', 'Dự báo cạn bể', 'h'), row('cl', 'AIT-201 clo dư', 'mg/L'), row('ntu', 'AIT-202 độ đục', 'NTU'), row('ph', 'AIT-203 pH', ''),
          row('kw', 'Công suất tổng', 'kW'), row('kwh', 'Điện năng lũy kế', 'kWh'), row('pu0', 'P-01', '', true), row('pu1', 'P-02', '', true),
          row('mv', 'MV-02 độ mở', '%'), row('ht', 'HT-01 nước trong bình', 'L'), row('back', 'Thiếu hụt bồn mái hộ dân', 'm³')))),
    );
  }
  updateMonitor() {
    const a = this.app, gw = a.st.gw, pl = a.st.plant, sig = gw.sig || {}, c = this.cells;
    const mode = gw.mode(), dead = a.st.gw_dead, ctl = gw.controlSrc();
    c.gwmode.replaceChildren(dead ? h('span', { class: 'chip critical' }, 'Mini PC ngừng – ' + viNum(dead.note()))
      : h('span', { class: 'chip ' + { a: 'good', b: 'warning', c: 'info', d: a.modeSev() === 'warn' ? 'warning' : 'critical' }[mode] }, ...modeChipTxt(MODE_TXT[mode])),
      !dead && ctl !== 'auto' ? h('span', { class: 'chip warning', style: 'margin-left:4px' }, ctl === 'remote' ? 'TAY từ xa' : 'TAY tại chỗ') : '');
    const cs = gw.comms.state;
    c.comms.textContent = dead ? 'Ngừng gửi – máy chủ phát hiện qua LWT' : COMMS_TXT[cs] + (gw.offline_since !== null ? ` · ${fmt((a.st.t - gw.offline_since) / 60, 0)} phút` : '');
    c.sigNote.hidden = !dead;
    c.script.textContent = `v${gw.script.version}${gw.script.local_modified ? ' + sửa tại chỗ' : ''} · ${gw.script.hash}${gw.watch ? ' · đang giám sát' : ''}`;
    c.strategy.textContent = STRAT_TXT[gw.ctrl.strategy_used] || gw.ctrl.strategy_used;
    c.override.textContent = gw.override ? `${fmt(gw.override.p_set, 2)} bar, còn ${fmt((gw.override.until - a.st.t) / 60, 0)} phút` : 'không';
    const cap = a.cfg.gateway.buffer_capacity, n = gw.comms.buf.length, f = n / cap;
    c.bufBar.style.width = Math.min(100, 100 * f) + '%';
    c.bufMeter.className = 'meter' + (f > 0.8 ? ' crit' : f > 0.5 ? ' warn' : '');
    c.bufTxt.textContent = ` ${n} / ${cap} bản ghi · nén ${gw.comms.stats.compactions} lần · mất ${gw.comms.stats.dropped}`;
    const U = this.units;
    const set = (k, txt) => { c[k].textContent = txt + (U[k] && txt !== '–' && txt !== '∞' ? ' ' + U[k] : ''); };
    c.p1.textContent = fmt(sig.p1, 2) + ' bar' + (gw.sig_proc.pt_used === 'PT-101' ? ' ◆' : '');
    c.p2.textContent = fmt(sig.p2, 2) + ' bar' + (gw.sig_proc.pt_used === 'PT-102' ? ' ◆' : '');
    set('pset', fmt(gw.ctrl.p_set, 2)); set('pmodel', fmt(sig.p_model, 2)); set('pcrit', fmt(pl.p_crit, 2));
    set('q', fmt(sig.q_f, 1)); set('qfc', fmt(gw.forecaster.meanAt(a.st.t), 1));
    c.qin.textContent = gw.sig_proc.installed.has('FT-100') ? fmt(sig.q_in_f, 1) + (sig.q_in_f !== null && sig.q_in_f !== undefined ? ' m³/h' : '') : `≈${fmt(sig.q_in_f, 1)} m³/h (cân bằng khối lượng)`;
    set('lv', fmt(sig.level, 2)); set('tte', gw.ctrl.tte_h === null ? '∞' : fmt(gw.ctrl.tte_h, 1));
    const inst = gw.sig_proc.installed;
    for (const [k, tag, v] of [['cl', 'AIT-201', sig.cl], ['ntu', 'AIT-202', sig.ntu], ['ph', 'AIT-203', sig.ph]]) { if (inst.has(tag)) set(k, fmt(v, 2)); else c[k].textContent = 'không lắp'; }
    if (!inst.has('PT-102')) c.p2.textContent = 'không lắp';
    set('kw', fmt(pl.kw, 2)); set('kwh', fmt(a.st.kpi.energy_kwh, 1));
    pl.pumps.forEach((pu, i) => { c['pu' + i].textContent = (pu.fault ? 'LỖI' : pu.running ? 'chạy' : 'dừng') + ` · ${fmt(pu.f, 1)} Hz · ${fmt(pu.amps, 1)} A · ${pu.starts} lần · ${fmt(pu.run_s / 3600, 1)} h`; });
    set('mv', fmt(pl.outlet_frac * 100, 0)); set('ht', fmt(pl.htWaterL(), 0)); set('back', fmt(pl.backlog, 1));
    // xác nhận qua ackAlarm như bảng Báo động: mini PC ngừng thì HMI-01 không xác nhận được
    const list = sortedAlarms([...gw.alarms.active.values()]), deadB = Boolean(dead);
    const key = list.map((x) => x.code + x.acked).join(',') + '|' + deadB;
    if (key !== this._alarmKey) {
      this._alarmKey = key;
      c.alarms.replaceChildren(...(list.length ? list.map((al) => h('div', { class: 'alarm-row' },
        h('span', { class: 'chip ' + al.sev }, SEV_LABEL[al.sev]),
        h('div', { class: 'msg' }, h('b', {}, al.code + ' '), viNum(al.msg), h('div', { class: 'when' }, tShort(al.t) + (al.acked ? ' · đã xác nhận' : ''))),
        al.acked ? h('span') : h('button', { class: 'btn small', disabled: deadB, title: deadB ? 'Mini PC đang ngừng – HMI-01 không xác nhận được báo động' : 'Xác nhận tại trạm (HMI-01)', onclick: () => ackAlarm(a, 'local', al.code) }, 'Xác nhận')))
        : [h('p', { class: 'note' }, 'Không có báo động.')]));
    }
    this.updateAlarmBadge();
  }
  /** Số báo động chưa xác nhận (trừ mức thông tin) trên nút Báo động của dock – tính mỗi nhịp, không dựng DOM. */
  updateAlarmBadge() {
    let n = 0;
    for (const x of this.app.st.gw.alarms.active.values()) if (!x.acked && x.sev !== 'info') n++;
    this.app.setBadge('mon', n);
  }

  // ---------------- Sự cố ----------------
  buildFaults(pane) {
    const a = this.app;
    const sel = h('select', { id: 'fault-station' }, ...a.cfg.stations.map((s) => h('option', { value: s.id }, s.name)));
    sel.value = a.focusId; // mặc định là trạm đang xem
    const ev = (e) => a.event({ ...e, station: sel.value });
    const hrs = (x) => a.st.t / 3600 + x;
    const B = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    this.linkBtn = B('Ngắt kết nối 4G', () => {
      const s = a.net.smart[a.net.by_id[sel.value]];
      ev({ type: s.link.up ? 'link_down' : 'link_up' });
    }, 'danger');
    pane.append(
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Trạm áp dụng'), sel, h('p', { class: 'note' }, 'Sự cố vật lý áp dụng cho cả trạm thông minh và trạm lịch cố định song sinh để so sánh công bằng.')),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Truyền thông – chế độ (b) và (c)'), h('div', { class: 'row' }, this.linkBtn)),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Mini PC (edge gateway) – thiết bị của giải pháp'), h('div', { class: 'row' }, this.gwBtn = B('Mini PC treo (watchdog)', () => {
        const s = a.net.smart[a.net.by_id[sel.value]];
        ev({ type: s.gw_dead ? 'gateway_restore' : 'gateway_fail' });
      }, 'danger')), h('p', { class: 'note' }, 'Khi mini PC ngừng, rơ-le watchdog chuyển biến tần sang PID nội (nếu có lắp – xem mục Thiết bị). Mất: dừng an toàn theo chất lượng, ghép bơm, đo xa.')),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Chất lượng nước nguồn – chế độ (d)'), h('div', { class: 'grid2' },
        B('Nước nguồn đục 12 NTU (3 h)', () => ev({ type: 'inflow_quality', param: 'ntu', value: 12, until_h: hrs(3) })),
        B('Clo nguồn giảm 0,05 mg/L (12 h)', () => ev({ type: 'inflow_quality', param: 'cl', value: 0.05, until_h: hrs(12) })),
        B('pH nguồn 9,2 (6 h)', () => ev({ type: 'inflow_quality', param: 'ph', value: 9.2, until_h: hrs(6) })),
        B('Nước nguồn trở lại bình thường', () => { for (const p of ['ntu', 'cl', 'ph']) a.net.smart[a.net.by_id[sel.value]].dist.clearOverride('q_' + p), a.net.fixed[a.net.by_id[sel.value]]?.dist.clearOverride('q_' + p); a.toast('Nước nguồn trở lại bình thường'); }))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Thủy lực & thiết bị'), h('div', { class: 'grid2' },
        B('Mất nước nguồn 6 h', () => ev({ type: 'supply', factor: 0, until_h: hrs(6) })),
        B('Vỡ ống nhánh 10 m³/h (6 h)', () => ev({ type: 'burst', q_m3h: 10, until_h: hrs(6) })),
        B('Nhu cầu tăng ×1,3 (lễ hội, 4 h)', () => ev({ type: 'demand_scale', factor: 1.3, until_h: hrs(4) })),
        B('Bơm P-01 lỗi biến tần', () => ev({ type: 'pump_fault', pump: 0 })),
        B('Sửa bơm P-01', () => ev({ type: 'pump_repair', pump: 0 })),
        B('Bơm P-02 lỗi biến tần', () => ev({ type: 'pump_fault', pump: 1 })),
        B('Sửa bơm P-02', () => ev({ type: 'pump_repair', pump: 1 })))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Cảm biến'), h('div', { class: 'grid2' },
        B('PT-101 kẹt ở 2,1 bar', () => ev({ type: 'sensor_fault', tag: 'PT-101', mode: 'stuck', value: 2.1 })),
        B('PT-101 trôi −0,6 bar/h', () => ev({ type: 'sensor_fault', tag: 'PT-101', mode: 'drift', value: -0.6 })),
        B('PT-101 mất tín hiệu', () => ev({ type: 'sensor_fault', tag: 'PT-101', mode: 'dead' })),
        B('Sửa PT-101', () => ev({ type: 'sensor_repair', tag: 'PT-101' })),
        B('AIT-202 (độ đục) mất tín hiệu', () => ev({ type: 'sensor_fault', tag: 'AIT-202', mode: 'dead' })),
        B('Sửa AIT-202', () => ev({ type: 'sensor_repair', tag: 'AIT-202' })),
        B('LT-101 lệch +0,5 m', () => ev({ type: 'sensor_fault', tag: 'LT-101', mode: 'bias', value: 0.5 })),
        B('Sửa LT-101', () => ev({ type: 'sensor_repair', tag: 'LT-101' })))),
    );
  }
  updateFaults() {
    if (!this.linkBtn) return;
    const sid = document.getElementById('fault-station')?.value ?? this.app.focusId;
    const s = this.app.net.smart[this.app.net.by_id[sid]];
    this.linkBtn.textContent = s.link.up ? 'Ngắt kết nối 4G' : 'Khôi phục kết nối 4G';
    this.linkBtn.className = 'btn ' + (s.link.up ? 'danger' : 'primary');
    this.gwBtn.textContent = s.gw_dead ? 'Khởi động lại mini PC' : 'Mini PC treo (watchdog)';
    this.gwBtn.className = 'btn ' + (s.gw_dead ? 'primary' : 'danger');
  }

  // ---------------- Kịch bản & lệnh ----------------
  buildScript(pane) {
    const a = this.app;
    const P = [['pressure.p_crit_target_bar', 'Áp mục tiêu điểm bất lợi (bar)'], ['pressure.r_est', 'Hệ số tổn thất r_est'], ['pressure.p_set_min_bar', 'P_set nhỏ nhất (bar)'],
      ['pressure.p_set_max_bar', 'P_set lớn nhất (bar)'], ['pressure.kp_hz_per_bar', 'Kp (Hz/bar)'], ['pressure.ti_s', 'Ti (s)'], ['staging.f_on_hz', 'Ghép bơm khi f ≥ (Hz)'],
      ['staging.f_off_hz', 'Tách bơm khi f ≤ (Hz)'], ['level.stop_m', 'Mức dừng bơm (m)'], ['level.restart_m', 'Mức chạy lại (m)'], ['level.conserve_m', 'Mức giảm áp tiết kiệm (m)'],
      ['offline.margin_bar', 'Biên áp khi mất mạng (bar)'], ['alternation.runtime_h', 'Luân phiên sau (h chạy)'], ['predictive.k_sigma', 'k·σ biên dự báo']];
    this.inputs = {};
    const grid = h('div', { class: 'param-grid' });
    for (const [path, label] of P) {
      const inp = h('input', { type: 'number', step: 'any', id: 'p-' + path.replace('.', '-') });
      this.inputs[path] = inp;
      grid.append(h('label', { for: inp.id }, label), inp);
    }
    this.stratSel = h('select', { id: 'p-strategy' }, h('option', { value: 'threshold' }, 'theo ngưỡng'), h('option', { value: 'predictive' }, 'dự báo'));
    this.scriptInfo = h('p', { class: 'note' });
    const patch = () => {
      const gw = a.st.gw, out = {};
      for (const [path, inp] of Object.entries(this.inputs)) {
        const v = Number(inp.value);
        const cur = path.split('.').reduce((o, k) => o[k], gw.script.params);
        if (inp.value !== '' && Math.abs(v - cur) > 1e-12) out[path] = v;
      }
      return out;
    };
    const load = () => { const gw = a.st.gw; for (const [path, inp] of Object.entries(this.inputs)) inp.value = path.split('.').reduce((o, k) => o[k], gw.script.params); this.stratSel.value = gw.script.strategy; };
    this.loadParams = load;
    const ov = h('input', { type: 'number', step: '0.05', value: '2.8', id: 'cmd-ov', style: 'width:80px' });
    const ovTtl = h('input', { type: 'number', step: '5', value: '15', id: 'cmd-ttl', style: 'width:70px' });
    const cmd = (type, args = {}, ttl = 1800) => a.server.sendCommand(a.st.sid, type, args, a.st.t, ttl);
    this.code = h('textarea', { class: 'code', id: 'student-code', spellcheck: 'false' });
    this.code.value = TEMPLATE_TODO;
    this.codeStatus = h('p', { class: 'note' });
    this.syncBox = h('div');
    pane.append(
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Kịch bản hiện tại'), this.scriptInfo,
        h('div', { class: 'row', style: 'margin-bottom:6px' }, h('label', { for: 'p-strategy' }, 'Chiến lược '), this.stratSel), grid,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => { const p = patch(); if (!Object.keys(p).length) return a.toast('Chưa thay đổi tham số nào'); a.st.gw.localEdit(p, a.st.t, 'Học viên tại HMI', 'thử nghiệm'); a.toast('Đã sửa tại HMI trạm'); } }, 'Sửa tại HMI trạm'),
          h('button', { class: 'btn primary', onclick: () => { const p = patch(); const strat = this.stratSel.value !== a.st.gw.script.strategy ? this.stratSel.value : null; if (!Object.keys(p).length && !strat) return a.toast('Chưa thay đổi tham số nào'); a.server.publishScript(a.st.sid, p, a.st.t, 'Học viên (trung tâm)', 'thử nghiệm', strat); a.toast('Đã phát hành từ trung tâm'); } }, 'Phát hành từ trung tâm'),
          h('button', { class: 'btn', onclick: load }, 'Đọc lại')),
        h('p', { class: 'note' }, 'Thử: ngắt mạng ở mục Sự cố, sửa cùng một tham số tại HMI và từ trung tâm với hai giá trị khác nhau, rồi khôi phục mạng để xem luật hợp nhất 3 chiều.')),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Lệnh từ trung tâm (có thời hạn)'),
        h('div', { class: 'row' }, 'Ghi đè P_set', ov, 'bar trong', ovTtl, 'phút',
          h('button', { class: 'btn small', onclick: () => cmd('set_override', { p_set_bar: Number(ov.value), ttl_s: Number(ovTtl.value) * 60 }, 3600) }, 'Gửi')),
        h('div', { class: 'grid2', style: 'margin-top:6px' },
          h('button', { class: 'btn', onclick: () => cmd('rotate_pumps', {}, 43200) }, 'Luân phiên bơm ngay'),
          h('button', { class: 'btn', onclick: () => cmd('reset_safe_stop', {}, 3600) }, 'Đặt lại dừng an toàn'),
          h('button', { class: 'btn', onclick: () => cmd('flush_tank', { target_m: 1.4 }, 7200) }, 'Xả bể xuống 1,4 m'),
          h('button', { class: 'btn', onclick: () => cmd('select_pt', { tag: 'PT-102' }, 3600) }, 'Điều khiển bằng PT-102'),
          h('button', { class: 'btn', onclick: () => cmd('select_pt', { tag: 'PT-101' }, 3600) }, 'Điều khiển bằng PT-101'),
          h('button', { class: 'btn', onclick: () => cmd('clear_override', {}, 3600) }, 'Hủy ghi đè'))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Kịch bản của học viên (JavaScript)'),
        h('p', { class: 'note' }, 'Viết hàm dieuKhien(inp, mem, params). Lớp an toàn vẫn chạy phía sau; nếu hàm lỗi, gateway tự chuyển về kịch bản dựng sẵn.'),
        this.code, h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { class: 'btn primary', onclick: () => this.loadStudent() }, 'Nạp vào gateway'),
          h('button', { class: 'btn', onclick: () => { a.st.gw.custom_fn = null; a.studentLoaded = false; this.codeStatus.textContent = 'Đã gỡ – dùng kịch bản dựng sẵn.'; } }, 'Gỡ'),
          h('button', { class: 'btn', onclick: () => { this.code.value = TEMPLATE_TODO; } }, 'Mẫu bài tập'),
          h('button', { class: 'btn', onclick: () => { this.code.value = TEMPLATE_SOLUTION; } }, 'Lời giải mẫu')), this.codeStatus),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Phiên đồng bộ gần nhất'), this.syncBox),
    );
    load();
  }
  loadStudent() {
    const a = this.app;
    try {
      const fn = new Function(this.code.value + '\n;return typeof dieuKhien === "function" ? dieuKhien : null;')();
      if (!fn) throw new Error('không tìm thấy hàm dieuKhien');
      a.st.gw.custom_fn = fn; a.st.gw.ctrl.custom_mem = {}; a.studentLoaded = true;
      a.st.gw.alarms.clear(a.st.t, 'SCRIPT_ERROR');
      this.codeStatus.textContent = 'Đã nạp kịch bản học viên. Mở mục So sánh trên thanh chức năng để đối chiếu KPI với lịch cố định.';
    } catch (e) {
      this.codeStatus.textContent = e instanceof EvalError || /unsafe-eval|Content Security/i.test(e.message)
        ? 'Trang đang chạy trong khung nhúng chặn biên dịch mã (CSP). Hãy chạy bản cục bộ: python -m trambom web'
        : 'Lỗi biên dịch: ' + e.message;
    }
  }
  updateScript() {
    const a = this.app, gw = a.st.gw;
    this.scriptInfo.textContent = `v${gw.script.version} · ${STRAT_TXT[gw.script.strategy] || gw.script.strategy} · tác giả: ${gw.script.author ?? 'máy chủ'} · hash ${gw.script.hash}${gw.script.local_modified ? ' · có chỉnh sửa tại chỗ chưa đồng bộ (' + gw.local_changes.length + ')' : ''}`;
    if (a.studentLoaded && !gw.custom_fn) this.codeStatus.textContent = 'Kịch bản học viên bị lỗi khi chạy – gateway đã chuyển về kịch bản dựng sẵn (xem Nhật ký).';
    const log = a.server.stations[a.st.sid].sync_log;
    const key = log.length;
    if (key === this._syncKey) return;
    this._syncKey = key;
    if (!log.length) { this.syncBox.replaceChildren(h('p', { class: 'note' }, 'Chưa có phiên đồng bộ (chưa từng mất mạng).')); return; }
    const r = log[log.length - 1];
    const rows = [...r.conflicts.map((c) => h('tr', {}, h('td', {}, c.path), h('td', { class: 'num' }, String(c.server)), h('td', { class: 'num' }, String(c.local)), h('td', { class: 'num' }, h('b', {}, String(c.result))), h('td', {}, c.rule))),
      ...r.decisions.map((d) => h('tr', {}, h('td', {}, d.path), h('td', { colspan: 2, class: 'sub' }, 'chỉ ' + d.from + ' đổi'), h('td', { class: 'num' }, String(d.value)), h('td', {}, '')))];
    this.syncBox.replaceChildren(
      h('p', { class: 'note' }, `${tShort(r.t)} · ${r.buffer_records} bản ghi đệm · ${r.local_changes} chỉnh sửa tại chỗ · lệch đồng hồ ${fmt(r.clock_offset, 2)} s · lệnh còn hạn: ${r.commands.join(', ') || 'không'}`),
      rows.length ? h('table', { class: 'kv' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tham số'), h('th', {}, 'Máy chủ'), h('th', {}, 'Tại chỗ'), h('th', {}, 'Kết quả'), h('th', {}, 'Quy tắc'))), h('tbody', {}, rows)) : h('p', { class: 'note' }, 'Không có thay đổi tham số cần hợp nhất.'));
  }

  // ---------------- Trung tâm điều hành ----------------
  buildCenter(pane) {
    this.map = h('div', { class: 'netmap' });
    if (this.app.fleet) this.map = h('div', { class: 'netmap-go' }, h('button', { class: 'btn primary', onclick: () => this.app.setView('fleet') }, 'Mở màn Mạng lưới (bản đồ Hà Nội)'),
      h('p', { class: 'note' }, 'Bản đồ, danh sách, báo động tập trung và hiệu quả của toàn mạng. Nhấp một dòng trong bảng dưới đây để xem chi tiết trạm đó.'));
    this.stTable = h('tbody');
    this.totals = h('div', { class: 'hero' });
    this.centralAlarms = h('div');
    this.traffic = h('p', { class: 'note' });
    pane.append(
      h('p', { class: 'note' }, 'Số liệu dưới đây là những gì MÁY CHỦ nhận được qua MQTT – khi một trạm mất mạng, dữ liệu của trạm đó đứng yên cho tới khi đồng bộ lại.'),
      h('div', { class: 'sec' }, this.map),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Tổng hợp toàn mạng (từ đầu mô phỏng)'), this.totals),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Các trạm'), h('div', { class: 'kpi-wrap' }, h('table', { class: 'kv' }, h('thead', {}, h('tr', {}, h('th', {}, 'Trạm'), h('th', {}, 'Kết nối'), h('th', {}, 'P bar'), h('th', {}, 'Q m³/h'), h('th', {}, 'kW'), h('th', {}, 'kWh'))), this.stTable))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Cảnh báo tập trung'), this.centralAlarms),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Lưu lượng truyền thông'), this.traffic),
    );
  }
  updateCenter() {
    const a = this.app, srv = a.server, net = a.net;
    const W = 360, H = 220;
    if (a.fleet) { this._centerRows(); return; }
    const parts = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ mạng lưới các trạm"><rect x="0" y="0" width="${W}" height="${H}" rx="8" style="fill:var(--surface-2)"/>`,
      `<text x="14" y="22" style="font:600 12px var(--f-label);fill:var(--muted);letter-spacing:.05em">ỐNG TRUYỀN TẢI THÀNH PHỐ</text>`,
      `<path d="M10 ${H / 2} C 120 ${H / 2 - 40}, 220 ${H / 2 + 40}, ${W - 10} ${H / 2}" style="fill:none;stroke:var(--water);stroke-width:4;opacity:.6"/>`];
    for (const s of net.smart) {
      const st = srv.stations[s.sid], cfgSt = s.station, x = 20 + cfgSt.x * (W - 40), y = 20 + cfgSt.y * (H - 40);
      const last = st.last || {};
      const mode = st.online ? (last.mode || 'a') : 'off';
      const col = { a: 'var(--good)', b: 'var(--warning)', c: '#7fb0ee', d: 'var(--critical)', off: 'var(--muted)' }[mode];
      parts.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${H / 2}" style="stroke:var(--water);stroke-width:2;opacity:.5"/>`);
      parts.push(`<circle cx="${x}" cy="${y}" r="13" style="fill:${col};stroke:var(--surface);stroke-width:2"/>`);
      if (!st.online) parts.push(`<path d="M${x - 6} ${y - 6} L${x + 6} ${y + 6} M${x + 6} ${y - 6} L${x - 6} ${y + 6}" style="stroke:#fff;stroke-width:2.5"/>`);
      parts.push(`<text x="${x + 17}" y="${y - 2}" style="font:700 12px var(--f-label);fill:var(--ink)">${s.sid}</text><text x="${x + 17}" y="${y + 12}" style="font:11px var(--f-mono);fill:var(--ink-2)">${fmt(last.p, 2)} bar · ${fmt(last.q, 1)} m³/h</text>`);
    }
    parts.push('</svg>');
    this.map.innerHTML = parts.join('');
    this._centerRows();
  }
  _centerRows() {
    const a = this.app, srv = a.server, net = a.net;
    const tot = net.totals();
    this.totals.replaceChildren(
      h('div', {}, h('b', {}, fmt(tot.smart_kwh, 0)), h('span', {}, `kWh thông minh · lịch cố định ${fmt(tot.fixed_kwh, 0)}`)),
      h('div', {}, h('b', {}, tot.fixed_kwh > 0 && net.t >= 6 * 3600 ? fmt(100 * (1 - tot.smart_kwh / tot.fixed_kwh), 0) + ' %' : '–'), h('span', {}, 'tiết kiệm điện toàn mạng')),
      h('div', {}, h('b', {}, fmt(tot.smart_nrw_pct, 1) + ' %'), h('span', {}, `rò rỉ / nước cấp · cố định ${fmt(tot.fixed_nrw_pct, 1)} %`)));
    this.stTable.replaceChildren(...net.smart.map((s) => {
      const st = srv.stations[s.sid], l = st.last || {};
      return h('tr', { class: 'rowgo' + (s.sid === a.focusId ? ' cur' : ''), title: 'Xem chi tiết ' + s.sid, onclick: () => a.focusStation(s.sid) }, h('td', {}, s.sid), h('td', {}, h('span', { class: 'chip ' + (st.online ? ({ a: 'good', b: 'warning', c: 'info', d: 'critical' }[l.mode] || 'good') : 'off') }, ...(st.online ? modeChipTxt('(' + (l.mode || 'a') + ')') : ['mất']))),
        h('td', { class: 'num' }, fmt(l.p, 2)), h('td', { class: 'num' }, fmt(l.q, 1)), h('td', { class: 'num' }, fmt(l.kw, 2)), h('td', { class: 'num' }, fmt(l.kwh, 1)));
    }));
    const al = [...srv.alarms.values()].sort((x, y) => y.t - x.t);
    const key = al.map((x) => x.station + x.code + x.acked).join(',');
    if (key !== this._calKey) {
      this._calKey = key;
      this.centralAlarms.replaceChildren(...(al.length ? al.slice(0, 30).map((x) => h('div', { class: 'alarm-row' }, h('span', { class: 'chip ' + x.sev }, SEV_LABEL[x.sev] ?? x.sev),
        h('div', { class: 'msg' }, h('b', {}, `${x.station} · ${x.code} `), viNum(x.msg), h('div', { class: 'when' }, tShort(x.t) + (x.acked ? ' · đã xác nhận' : ''))),
        x.acked || x.code === 'STATION_OFFLINE' ? h('span') : h('button', { class: 'btn small', onclick: () => srv.ackAlarm(x.station, x.code, a.st.t) }, 'Xác nhận'))) : [h('p', { class: 'note' }, 'Không có cảnh báo tập trung.')]));
    }
    const up = net.smart.reduce((s, x) => s + x.link.bytes_up, 0), dn = net.smart.reduce((s, x) => s + x.link.bytes_down, 0);
    this.traffic.textContent = `Lên ${fmt(up / 1e6, 2)} MB · xuống ${fmt(dn / 1e6, 2)} MB (${net.smart.length} trạm). ${a.st.sid}: ${a.st.gw.comms.stats.generated} bản ghi đo xa, máy chủ nhận ${srv.stations[a.st.sid].records}, trong đó ${srv.stations[a.st.sid].late} bản ghi đến muộn sau đồng bộ.`;
    this.app.setBadge('center', al.filter((x) => !x.acked && x.sev !== 'info').length);
  }

  // ---------------- Nhật ký ----------------
  buildLog(pane) {
    this.logSel = h('select', { id: 'log-filter', onchange: () => { this.logSeen = -1; } }, h('option', { value: 'all' }, 'Gateway + máy chủ'), h('option', { value: 'gw' }, 'Chỉ gateway trạm đang xem'), h('option', { value: 'srv' }, 'Chỉ máy chủ'), h('option', { value: 'alarm' }, 'Chỉ báo động & an toàn'));
    this.logBox = h('div', { class: 'log' });
    pane.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, this.logSel), this.logBox);
  }
  updateLog() {
    const a = this.app, f = this.logSel.value;
    const gl = a.st.gw.logs, sl = a.server.logs;
    const key = gl.length + ':' + sl.length + ':' + f;
    if (key === this._logKey) return;
    this._logKey = key;
    let items = [];
    if (f !== 'srv') items = items.concat(gl.slice(-300).map((l) => ({ ...l, src: 'GW' })));
    if (f === 'all' || f === 'srv') items = items.concat(sl.slice(-200).map((l) => ({ ...l, src: 'SV' })));
    if (f === 'alarm') items = items.filter((l) => ['alarm', 'critical', 'safety', 'warning'].includes(l.level));
    items.sort((x, y) => y.t - x.t);
    this.logBox.replaceChildren(...items.slice(0, 250).map((l) => h('div', { class: l.level }, h('span', { class: 't' }, `${tShort(l.t)} ${l.src}`), viNum(l.text))));
  }

  // ---------------- Bài học ----------------
  buildLesson(pane) {
    this.lessonPane = pane;
  }
  updateLesson() {
    const a = this.app, sc = a.scenario;
    this.lessonPane.replaceChildren(
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Kịch bản đang chạy'), h('h3', { style: 'margin:4px 0' }, sc.name), h('p', {}, sc.summary),
        h('p', { class: 'note' }, 'Các sự kiện định sẵn: ' + (sc.events.length ? sc.events.map((e) => `${tShort(e.t_h * 3600)} ${e.type}`).join(' · ') : 'không có'))),
      sc.questions.length ? h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Câu hỏi phân tích (Bloom: Áp dụng – Phân tích · DOK 3)'), h('ol', {}, ...sc.questions.map((q) => h('li', {}, q)))) : '',
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Nhiệm vụ theo mức độ'),
        h('p', {}, h('b', {}, 'Cơ bản: '), 'hoàn thiện kịch bản theo ngưỡng (mục Kịch bản → Mẫu bài tập, hoặc student/kich_ban_nguong.py rồi chạy python -m trambom check-student). Đạt khi áp đúng dải ≥ 98 %, tiết kiệm ≥ 20 % điện và không chạy khô.'),
        h('p', {}, h('b', {}, 'Nâng cao: '), 'triển khai điều khiển dự báo (student/kich_ban_du_bao.py), so sánh với kịch bản dựng sẵn ở S10; sau đó viết bộ điều phối trung tâm cho 4 trạm (student/mang_luoi_nang_cao.py) dùng logger áp điểm bất lợi.')),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Gợi ý quan sát'),
        h('ul', {}, h('li', {}, 'Nền xám trên biểu đồ: thời gian mất mạng; nền hồng: chế độ (d).'), h('li', {}, 'Biểu đồ "Dữ liệu tại máy chủ" (bật nút "Máy chủ" trong mục Biểu đồ) cho thấy khoảng trống khi mất mạng và phần được lấp lại sau đồng bộ (màu khác).'),
          h('li', {}, 'Nhấp vào thiết bị trong cảnh 3D để xem tham số vật lý và dải làm việc.'))),
    );
  }

  // ---------------- Bảng KPI so sánh ----------------
  buildKpi(host) {
    this.kpiHero = h('div', { class: 'hero' });
    this.kpiBody = h('tbody');
    host.append(h('div', { class: 'chart-head' }, h('h3', {}, 'So sánh trực tiếp với lịch cố định'), h('span', { class: 'sub', id: 'kpi-sub' }, '')), this.kpiHero,
      h('div', { class: 'kpi-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Chỉ số (từ đầu mô phỏng)'), h('th', {}, 'Lịch cố định'), h('th', {}, 'Thông minh'))), this.kpiBody)),
      h('p', { class: 'note' }, 'Hai trạm chạy song song với cùng nhu cầu, cùng nguồn nước, cùng sự cố. Ô xanh: tốt hơn; ô đỏ: kém hơn.'));
  }
  updateKpi() {
    const a = this.app, s = a.st.summary(), f = a.fx.summary();
    document.getElementById('kpi-sub').textContent = `${fmt(s.hours, 1)} giờ mô phỏng · mức ${a.level === 'basic' ? 'cơ bản' : 'nâng cao'}${a.studentLoaded && a.st.gw.custom_fn ? ' · kịch bản học viên' : ''}`;
    const ok = s.hours >= 12 && f.energy_kwh > 1;
    const sav = ok ? 100 * (1 - s.energy_kwh / f.energy_kwh) : NaN;
    this.kpiHero.replaceChildren(
      h('div', {}, h('b', {}, ok ? fmt(sav, 0) + ' %' : '–'), h('span', {}, ok ? 'tiết kiệm điện' : 'tiết kiệm điện (đủ 12 h mới so sánh)')),
      h('div', {}, h('b', {}, fmt(s.pct_in_band, 1) + ' %'), h('span', {}, `áp đạt dải · cố định ${fmt(f.pct_in_band, 1)} %`)),
      h('div', {}, h('b', {}, fmt(s.quality_viol_m3, 1) + ' m³'), h('span', {}, `nước không đạt QCVN đã cấp · cố định ${fmt(f.quality_viol_m3, 1)} m³`)));
    const det = (inc) => (inc.length ? inc.map((i) => (i.detected === null ? 'không phát hiện' : fmt((i.detected - i.t) / 60, 0) + ' phút')).join('; ') : '–');
    const rows = [
      ['Điện năng (kWh)', f.energy_kwh, s.energy_kwh, 1, -1],
      ['Suất điện năng (kWh/m³)', f.specific_kwh_m3, s.specific_kwh_m3, 3, -1],
      ['Nước cấp vào mạng (m³)', f.delivered_m3, s.delivered_m3, 0, 0],
      ['Rò rỉ (m³)', f.leak_m3, s.leak_m3, 1, -1],
      ['Thiếu nước thực sự (m³)', f.unserved_m3, s.unserved_m3, 1, -1],
      ['Áp ngoài dải – tổng (phút)', f.t_out_min, s.t_out_min, 0, -1],
      ['  · điểm bất lợi < 1,4 bar (phút)', f.t_low_min, s.t_low_min, 0, -1],
      ['  · đầu ra > 4,0 bar (phút)', f.t_high_min, s.t_high_min, 0, -1],
      ['Áp đầu ra lớn nhất (bar)', f.p_out_max, s.p_out_max, 2, -1],
      ['Số đợt cấp nước không đạt QCVN', f.quality_episodes, s.quality_episodes, 0, -1],
      ['Nước không đạt QCVN đã cấp (m³)', f.quality_viol_m3, s.quality_viol_m3, 1, -1],
      ['Số lần khởi động bơm', f.starts_total, s.starts_total, 0, -1],
      ['Giờ chạy P-01 / P-02', `${fmt(f.run_h[0], 1)} / ${fmt(f.run_h[1], 1)}`, `${fmt(s.run_h[0], 1)} / ${fmt(s.run_h[1], 1)}`, null, 0],
      ['Bơm chạy khô (phút)', f.dry_run_min, s.dry_run_min, 1, -1],
      ['Thời gian phát hiện sự cố', det(f.incidents), det(s.incidents), null, 0],
    ];
    this.kpiBody.replaceChildren(...rows.map(([name, fv, sv, nd, dir]) => {
      let cls = '';
      if (nd !== null && dir !== 0 && typeof fv === 'number' && typeof sv === 'number') {
        const d = (sv - fv) * dir;
        if (d > 1e-6 + Math.abs(fv) * 0.005) cls = 'better'; else if (d < -(1e-6 + Math.abs(fv) * 0.005)) cls = 'worse';
      }
      return h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, nd === null ? fv : fmt(fv, nd)), h('td', { class: 'num ' + cls }, nd === null ? sv : fmt(sv, nd)));
    }));
  }

  // ---------------- Ngăn thông tin thiết bị ----------------
  // ---------------- Thiết bị: hiện trạng / giải pháp / khuyến nghị ----------------
  buildEquipment(pane) {
    const a = this.app;
    this.eqCounts = h('div', { class: 'row' });
    this.eqList = h('div');
    this.hwBox = h('div');
    pane.append(
      h('p', { class: 'note' }, 'Phân biệt rõ thiết bị nhà máy ĐÃ CÓ, thiết bị GIẢI PHÁP đưa vào (mini PC tiếp nhận – xử lý – điều khiển tín hiệu tại chỗ) và thiết bị KHUYẾN NGHỊ để hệ thống vận hành trơn tru. Nút Hiển thị trên thanh chức năng lọc và tô màu đúng nhóm trong cảnh 3D.'),
      h('div', { class: 'sec' }, this.eqCounts),
      this.hwDetails = h('details', { class: 'sec hw-details' }, h('summary', { class: 'lbl' }, 'Thử bỏ bớt thiết bị – mô phỏng “nếu không lắp”'),
        h('p', { class: 'note' }, 'Bỏ chọn rồi bấm "Áp dụng" để chạy lại kịch bản hiện tại; hoặc bấm "So sánh" để chạy nhanh hai phương án có/không lắp trên kịch bản gợi ý (kết quả hiện ngay dưới tùy chọn).'), this.hwBox),
      h('div', { class: 'sec' }, h('p', { class: 'note' }, 'Nhấp một thiết bị để xem thông số và chỉ vị trí của nó trong cảnh 3D.'), this.eqList));
    this._buildHw();
    this.updateEquipment(true);
  }
  _buildHw() {
    const a = this.app, hw = a.cfg.hardware;
    this.hwChecks = {}; this.wi = {};
    const rows = HW_OPTS.flatMap(([k, label, desc, sc, lvl]) => {
      const cb = h('input', { type: 'checkbox', checked: hw[k] !== false, 'aria-label': label });
      this.hwChecks[k] = cb;
      // nút trong <label>: dùng aria-disabled thay cho disabled để cú nhấp khi đang chạy không bật/tắt ô chọn
      const btn = h('button', { class: 'btn small wi-btn', type: 'button', onclick: (e) => { e.preventDefault(); this.whatIf(k, sc, lvl); } }, `So sánh trên ${sc}`);
      const out = h('div', { class: 'wi-out', hidden: true });
      this.wi[k] = { btn, out, txt: btn.textContent };
      return [h('label', { class: 'hw-opt' }, cb, h('span', {}, h('b', {}, label), h('small', {}, desc), btn)), out];
    });
    this.hwBox.replaceChildren(...rows, h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'btn primary', onclick: () => { const o = {}; for (const [k, cb] of Object.entries(this.hwChecks)) o[k] = cb.checked; a.applyHardware(o); } }, 'Áp dụng & chạy lại'),
      h('button', { class: 'btn', onclick: () => { for (const cb of Object.values(this.hwChecks)) cb.checked = true; a.applyHardware(Object.fromEntries(HW_OPTS.map((x) => [x[0], true]))); } }, 'Lắp đủ')));
  }
  /** Cuộn khung bảng vừa đủ để thấy el (không dùng scrollIntoView – tránh cuộn các khung cha overflow:hidden). */
  _reveal(el) {
    const pane = el.closest('.pane');
    if (!pane || el.hidden) return;
    const r = el.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    let dy = 0;
    if (r.bottom > pr.bottom - 8) dy = Math.min(r.bottom - pr.bottom + 8, r.top - pr.top - 40);
    else if (r.top < pr.top + 8) dy = r.top - pr.top - 8;
    if (Math.abs(dy) > 1) pane.scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  /**
   * Chạy nhanh 2 phương án (có / không lắp) bằng lõi JS, chia nhỏ để không treo trình duyệt. Tiến độ và kết quả hiện ngay dưới
   * tùy chọn được bấm; nút báo "Đang chạy… n %" và bỏ qua cú bấm lặp; bấm "So sánh" của tùy chọn khác thì hủy lần chạy cũ.
   */
  whatIf(opt, scId, level) {
    const a = this.app, W = this.wi[opt];
    if (!W || this._wiRun?.opt === opt) return;
    const sc = a.scenarios.find((s) => s.id === scId);
    const show = (...kids) => { W.out.replaceChildren(...kids); W.out.hidden = false; requestAnimationFrame(() => this._reveal(W.out)); };
    if (!sc || scId === 'S0') { show(h('p', { class: 'note' }, 'Chưa có kịch bản riêng cho tùy chọn này – hãy bỏ chọn rồi tiêm lỗi pH ở mục Sự cố.')); return; }
    if (this._wiRun) this._wiEnd(this._wiRun, true);
    const run = this._wiRun = { opt };
    const mk = (inst) => { const cfg = structuredClone(a.cfg); cfg.hardware[opt] = inst; return new TwinSim(cfg, sc, level, { withFixed: false }); };
    const sims = [mk(true), mk(false)];
    const n = Math.round((sc.duration_h ?? 24) * 3600 / sims[0].dt);
    let i = 0;
    const label = HW_OPTS.find((x) => x[0] === opt)[1];
    const bar = h('i', { style: 'width:0%' }), prog = h('span');
    W.btn.setAttribute('aria-disabled', 'true'); W.btn.setAttribute('aria-busy', 'true'); W.btn.classList.add('busy');
    T(W.btn, 'Đang chạy… 0 %');
    show(h('div', { class: 'wi-prog' }, h('p', { class: 'note' }, prog), h('div', { class: 'meter' }, bar)));
    const tick = () => {
      if (this._wiRun !== run) return;
      const t0 = performance.now();
      while (i < n && performance.now() - t0 < 60) { sims[0].step(); sims[1].step(); i++; }
      const pct = Math.round(100 * i / n);
      T(prog, `Đang chạy ${scId} (${level === 'basic' ? 'cơ bản' : 'nâng cao'}) có/không “${label}”: ${pct} %`);
      T(W.btn, `Đang chạy… ${pct} %`); bar.style.width = pct + '%';
      if (i < n) { setTimeout(tick, 0); return; }
      this._wiEnd(run);
      const [A, B] = sims.map((s) => s.result().smart);
      const det = (s) => { const x = s.incidents[0]; return x ? (x.detected === null ? 'không phát hiện' : fmt((x.detected - x.t) / 60, 1, 'phút') + ' (' + x.how + ')') : '–'; };
      const rows = [['Áp ngoài dải dịch vụ', fmt(A.t_out_min, 0, 'phút'), fmt(B.t_out_min, 0, 'phút')], ['Áp đầu ra > 4,0 bar', fmt(A.t_high_min, 0, 'phút'), fmt(B.t_high_min, 0, 'phút')],
        ['Áp đầu ra lớn nhất', fmt(A.p_out_max, 2, 'bar'), fmt(B.p_out_max, 2, 'bar')], ['Áp điểm bất lợi nhỏ nhất', fmt(A.p_crit_min, 2, 'bar'), fmt(B.p_crit_min, 2, 'bar')],
        ['Nước không đạt QCVN đã cấp', fmt(A.quality_viol_m3, 1, 'm³'), fmt(B.quality_viol_m3, 1, 'm³')], ['Báo động khẩn tới tổ trực chậm nhất', fmt(A.notify.max_delay_min, 0, 'phút'), fmt(B.notify.max_delay_min, 0, 'phút')],
        ['Phát hiện sự cố sau', det(A), det(B)], ['Điện năng', fmt(A.energy_kwh, 1, 'kWh'), fmt(B.energy_kwh, 1, 'kWh')]];
      show(h('p', { class: 'note' }, h('b', {}, `${sc.name}`), ` – “${label}”`),
        h('div', { class: 'kpi-wrap' }, h('table', { class: 'kv' }, h('thead', {}, h('tr', {}, h('th', {}, 'Chỉ số'), h('th', {}, 'Có lắp'), h('th', {}, 'Không lắp'))),
          h('tbody', {}, ...rows.map(([k, x, y]) => h('tr', { class: x !== y ? 'diff' : '' }, h('td', {}, k), h('td', { class: 'num' }, x), h('td', { class: 'num' }, y)))))));
    };
    setTimeout(tick, 0);
  }
  _wiEnd(run, cancelled = false) {
    const W = this.wi[run.opt];
    if (this._wiRun === run) this._wiRun = null;
    W.btn.removeAttribute('aria-disabled'); W.btn.removeAttribute('aria-busy'); W.btn.classList.remove('busy');
    T(W.btn, W.txt);
    if (cancelled) W.out.replaceChildren(h('p', { class: 'note' }, 'Đã dừng – đang chạy so sánh cho tùy chọn khác.'));
  }
  updateEquipment(force = false) {
    if (!this.eqList) return;
    const a = this.app, comps = a.components.filter((c) => c.scope), scope = a.scope ?? 'all';
    const key = scope + comps.length;
    if (!force && key === this._eqKey) return;
    this._eqKey = key;
    const cnt = (s) => comps.filter((c) => c.scope === s).length;
    this.eqCounts.replaceChildren(...['hien_trang', 'giai_phap', 'khuyen_nghi'].map((s) => h('button', { class: 'btn small' + (scope === s ? ' on' : ''), onclick: () => a.setScope(scope === s ? 'all' : s) },
      h('i', { class: 'sdot s-' + s }), `${SCOPE_TXT[s]} · ${cnt(s)}`)));
    const groups = ['hien_trang', 'giai_phap', 'khuyen_nghi'].filter((s) => scope === 'all' || s === scope);
    const pick = (tag) => { a.openDrawer(tag); a.showInScene(tag); };
    this.eqList.replaceChildren(...groups.map((s) => h('div', { class: 'eq-group s-' + s },
      h('div', { class: 'row' }, h('span', { class: 'schip s-' + s }, SCOPE_TXT[s]), h('span', { class: 'note' }, SCOPE_DESC[s])),
      ...comps.filter((c) => c.scope === s).map((c) => h('div', { class: 'eq-row', role: 'button', tabindex: 0, title: 'Xem thông số và chỉ vị trí trong cảnh 3D', onclick: () => pick(c.tag), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(c.tag); } } },
        h('b', {}, c.tag), h('span', {}, c.name, h('small', {}, c.role ?? '')), h('span', { class: 'note' }, [CHANGE_TXT[c.change], PRIO_TXT[c.priority]].filter(Boolean).join(' · ')))))));
  }

  /**
   * Thẻ thông tin thiết bị (dựng một lần cho mỗi thiết bị). Trả về { tag, el, update, focusEl }: update() chỉ ghi lại các ô
   * "Giá trị hiện tại" khi chữ đổi, không dựng lại thẻ – giữ tiêu điểm bàn phím và vùng chữ đang chọn.
   */
  componentInfo(tag) {
    const a = this.app, comp = a.components.find((c) => c.tag === tag);
    if (!comp) return null;
    const live = a.liveValues(tag), cells = live.map(() => h('td', { class: 'num' }));
    const sc = comp.scope;
    const scopeRows = [['Vai trò', comp.role], ['Giao tiếp với mini PC', comp.interface], ['Thông số điển hình', comp.spec], ['Nếu không có', comp.if_missing], ['Khi hỏng / dự phòng', comp.fallback], ['Thử trong mô phỏng', comp.sim]].filter((x) => x[1]);
    const title = h('h3', { id: 'drawer-title', tabindex: '-1' }, `${comp.tag} · ${comp.name}`);
    const in3d = a.scene3d?.byTag?.has(tag) ? h('button', { class: 'btn small', type: 'button', title: 'Tô sáng và đưa camera tới thiết bị trong cảnh 3D', onclick: () => a.showInScene(tag, true) }, 'Xem trong 3D') : '';
    const update = () => { const L = a.liveValues(tag); cells.forEach((td, i) => T(td, viNum(L[i]?.[1] ?? '–'))); };
    const el = h('div', {},
      h('div', { class: 'dr-head' }, title, h('span', { class: 'dr-act' }, in3d, h('button', { class: 'btn small', type: 'button', title: 'Đóng (Esc)', onclick: () => a.closeDrawer() }, 'Đóng'))),
      sc ? h('div', { class: 'row', style: 'margin:4px 0' }, h('span', { class: 'schip s-' + sc }, SCOPE_TXT[sc]), comp.change ? h('span', { class: 'schip light' }, CHANGE_TXT[comp.change]) : '', comp.priority ? h('span', { class: 'schip light' }, PRIO_TXT[comp.priority]) : '') : '',
      h('p', { class: 'note' }, comp.group + ' — ' + comp.desc),
      scopeRows.length ? h('table', { class: 'kv fixed' }, h('tbody', {}, ...scopeRows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'wrap' }, v))))) : '',
      (comp.params ?? []).length ? h('table', { class: 'kv' }, h('tbody', {}, ...comp.params.map(([k, v, u]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v + (u && u !== '–' ? ' ' + u : '')))))) : '',
      comp.range ? h('p', {}, h('b', {}, 'Dải làm việc: '), comp.range) : '',
      live.length ? h('table', { class: 'kv' }, h('thead', {}, h('tr', {}, h('th', {}, 'Giá trị hiện tại'), h('th', {}, ''))), h('tbody', {}, ...live.map(([k], i) => h('tr', {}, h('td', {}, k), cells[i])))) : '');
    update();
    return { tag, el, update, focusEl: title };
  }
}
