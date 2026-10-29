// Các bảng bên phải + bảng so sánh KPI. Cập nhật ~4 lần/giây từ main.js.
import { h, fmt, SEV_LABEL, tShort } from './dom.js';
import { TEMPLATE_SOLUTION, TEMPLATE_TODO } from './student-template.js';

const MODE_TXT = { a: '(a) Bình thường – có kết nối', b: '(b) Mất mạng – gateway tự vận hành', c: '(c) Đồng bộ sau khôi phục kết nối', d: '(d) Cảnh báo / dừng an toàn' };
const COMMS_TXT = { online: 'Trực tuyến', offline: 'Mất kết nối', resync: 'Đang đồng bộ' };
const STRAT_TXT = { threshold: 'theo ngưỡng', predictive: 'dự báo', fallback: 'dự phòng (dự báo kém → ngưỡng)', custom: 'kịch bản học viên' };

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
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Báo động đang hoạt động (gateway)'), c.alarms),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Edge gateway GW-01'),
        h('table', { class: 'kv fixed' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Chế độ'), h('td', {}, c.gwmode)),
          h('tr', {}, h('td', {}, 'Kết nối máy chủ'), h('td', {}, c.comms)),
          h('tr', {}, h('td', {}, 'Kịch bản đang chạy'), h('td', {}, c.script)),
          h('tr', {}, h('td', {}, 'Chiến lược thực dùng'), h('td', {}, c.strategy)),
          h('tr', {}, h('td', {}, 'Lệnh ghi đè từ xa'), h('td', {}, c.override)),
          h('tr', {}, h('td', {}, 'Bộ đệm lưu-và-chuyển'), h('td', {}, c.bufMeter, c.bufTxt))))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Số đo & điều khiển (đã kiểm tra hợp lệ)'),
        h('table', { class: 'kv fixed' }, h('tbody', {},
          row('p1', 'PT-101 áp đầu ra', 'bar'), row('p2', 'PT-102 áp bảo vệ', 'bar'), row('pset', 'Áp đặt P_set(Q)', 'bar'), row('pmodel', 'Áp theo mô hình bơm', 'bar'),
          row('pcrit', 'Áp điểm bất lợi (logger)', 'bar'), row('q', 'FT-101 lưu lượng ra', 'm³/h'), row('qfc', 'Dự báo lưu lượng', 'm³/h'), row('qin', 'FT-100 lưu lượng vào', 'm³/h'),
          row('lv', 'LT-101 mức bể', 'm'), row('tte', 'Dự báo cạn bể', 'h'), row('cl', 'AIT-201 clo dư', 'mg/L'), row('ntu', 'AIT-202 độ đục', 'NTU'), row('ph', 'AIT-203 pH', ''),
          row('kw', 'Công suất tổng', 'kW'), row('kwh', 'Điện năng lũy kế', 'kWh'), row('pu0', 'P-01', '', true), row('pu1', 'P-02', '', true),
          row('mv', 'MV-02 độ mở', '%'), row('ht', 'HT-01 nước trong bình', 'L'), row('back', 'Thiếu hụt bồn mái hộ dân', 'm³')))),
    );
  }
  updateMonitor() {
    const a = this.app, gw = a.st.gw, pl = a.st.plant, sig = gw.sig || {}, c = this.cells;
    const mode = gw.mode();
    c.gwmode.replaceChildren(h('span', { class: 'chip ' + { a: 'good', b: 'warning', c: 'info', d: 'critical' }[mode] }, MODE_TXT[mode]));
    const cs = gw.comms.state;
    c.comms.textContent = COMMS_TXT[cs] + (gw.offline_since !== null ? ` · ${fmt((a.st.t - gw.offline_since) / 60, 0)} phút` : '');
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
    set('q', fmt(sig.q_f, 1)); set('qfc', fmt(gw.forecaster.meanAt(a.st.t), 1)); set('qin', fmt(sig.q_in_f, 1));
    set('lv', fmt(sig.level, 2)); set('tte', gw.ctrl.tte_h === null ? '∞' : fmt(gw.ctrl.tte_h, 1));
    set('cl', fmt(sig.cl, 2)); set('ntu', fmt(sig.ntu, 2)); set('ph', fmt(sig.ph, 2));
    set('kw', fmt(pl.kw, 2)); set('kwh', fmt(a.st.kpi.energy_kwh, 1));
    pl.pumps.forEach((pu, i) => { c['pu' + i].textContent = (pu.fault ? 'LỖI' : pu.running ? 'chạy' : 'dừng') + ` · ${fmt(pu.f, 1)} Hz · ${fmt(pu.amps, 1)} A · ${pu.starts} lần · ${fmt(pu.run_s / 3600, 1)} h`; });
    set('mv', fmt(pl.outlet_frac * 100, 0)); set('ht', fmt(pl.htWaterL(), 0)); set('back', fmt(pl.backlog, 1));
    const list = [...gw.alarms.active.values()].sort((x, y) => ({ critical: 0, alarm: 1, warning: 2, info: 3 }[x.sev] - { critical: 0, alarm: 1, warning: 2, info: 3 }[y.sev]));
    const key = list.map((x) => x.code + x.acked).join(',');
    if (key !== this._alarmKey) {
      this._alarmKey = key;
      c.alarms.replaceChildren(...(list.length ? list.map((al) => h('div', { class: 'alarm-row' },
        h('span', { class: 'chip ' + al.sev }, SEV_LABEL[al.sev]),
        h('div', { class: 'msg' }, h('b', {}, al.code + ' '), al.msg, h('div', { class: 'when' }, tShort(al.t) + (al.acked ? ' · đã xác nhận' : ''))),
        al.acked ? h('span') : h('button', { class: 'btn small', onclick: () => gw.alarms.ack(al.code, a.st.t) }, 'Xác nhận'))) : [h('p', { class: 'note' }, 'Không có báo động.')]));
    }
    this.app.setBadge('mon', list.filter((x) => !x.acked && x.sev !== 'info').length);
  }

  // ---------------- Sự cố ----------------
  buildFaults(pane) {
    const a = this.app;
    const sel = h('select', { id: 'fault-station' }, ...a.cfg.stations.map((s) => h('option', { value: s.id }, s.name)));
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
    const sid = document.getElementById('fault-station')?.value ?? 'ST-01';
    const s = this.app.net.smart[this.app.net.by_id[sid]];
    this.linkBtn.textContent = s.link.up ? 'Ngắt kết nối 4G' : 'Khôi phục kết nối 4G';
    this.linkBtn.className = 'btn ' + (s.link.up ? 'danger' : 'primary');
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
    const cmd = (type, args = {}, ttl = 1800) => a.server.sendCommand('ST-01', type, args, a.st.t, ttl);
    this.code = h('textarea', { class: 'code', id: 'student-code', spellcheck: 'false' });
    this.code.value = TEMPLATE_TODO;
    this.codeStatus = h('p', { class: 'note' });
    this.syncBox = h('div');
    pane.append(
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Kịch bản hiện tại'), this.scriptInfo,
        h('div', { class: 'row', style: 'margin-bottom:6px' }, h('label', { for: 'p-strategy' }, 'Chiến lược '), this.stratSel), grid,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => { const p = patch(); if (!Object.keys(p).length) return a.toast('Chưa thay đổi tham số nào'); a.st.gw.localEdit(p, a.st.t, 'Học viên tại HMI', 'thử nghiệm'); a.toast('Đã sửa tại HMI trạm'); } }, 'Sửa tại HMI trạm'),
          h('button', { class: 'btn primary', onclick: () => { const p = patch(); const strat = this.stratSel.value !== a.st.gw.script.strategy ? this.stratSel.value : null; if (!Object.keys(p).length && !strat) return a.toast('Chưa thay đổi tham số nào'); a.server.publishScript('ST-01', p, a.st.t, 'Học viên (trung tâm)', 'thử nghiệm', strat); a.toast('Đã phát hành từ trung tâm'); } }, 'Phát hành từ trung tâm'),
          h('button', { class: 'btn', onclick: load }, 'Đọc lại')),
        h('p', { class: 'note' }, 'Thử: ngắt mạng ở tab Sự cố, sửa cùng một tham số tại HMI và từ trung tâm với hai giá trị khác nhau, rồi khôi phục mạng để xem luật hợp nhất 3 chiều.')),
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
      this.codeStatus.textContent = 'Đã nạp kịch bản học viên. So sánh KPI bên dưới với lịch cố định.';
    } catch (e) {
      this.codeStatus.textContent = e instanceof EvalError || /unsafe-eval|Content Security/i.test(e.message)
        ? 'Trang đang chạy trong khung nhúng chặn biên dịch mã (CSP). Hãy chạy bản cục bộ: python -m trambom web'
        : 'Lỗi biên dịch: ' + e.message;
    }
  }
  updateScript() {
    const a = this.app, gw = a.st.gw;
    this.scriptInfo.textContent = `v${gw.script.version} · ${gw.script.strategy} · tác giả: ${gw.script.author ?? 'máy chủ'} · hash ${gw.script.hash}${gw.script.local_modified ? ' · có chỉnh sửa tại chỗ chưa đồng bộ (' + gw.local_changes.length + ')' : ''}`;
    if (a.studentLoaded && !gw.custom_fn) this.codeStatus.textContent = 'Kịch bản học viên bị lỗi khi chạy – gateway đã chuyển về kịch bản dựng sẵn (xem Nhật ký).';
    const log = a.server.stations['ST-01'].sync_log;
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
    const tot = net.totals();
    this.totals.replaceChildren(
      h('div', {}, h('b', {}, fmt(tot.smart_kwh, 0)), h('span', {}, `kWh thông minh · lịch cố định ${fmt(tot.fixed_kwh, 0)}`)),
      h('div', {}, h('b', {}, tot.fixed_kwh > 0 ? fmt(100 * (1 - tot.smart_kwh / tot.fixed_kwh), 0) + ' %' : '–'), h('span', {}, 'tiết kiệm điện toàn mạng')),
      h('div', {}, h('b', {}, fmt(tot.smart_nrw_pct, 1) + ' %'), h('span', {}, `rò rỉ / nước cấp · cố định ${fmt(tot.fixed_nrw_pct, 1)} %`)));
    this.stTable.replaceChildren(...net.smart.map((s) => {
      const st = srv.stations[s.sid], l = st.last || {};
      return h('tr', {}, h('td', {}, s.sid), h('td', {}, h('span', { class: 'chip ' + (st.online ? ({ a: 'good', b: 'warning', c: 'info', d: 'critical' }[l.mode] || 'good') : 'off') }, st.online ? '(' + (l.mode || 'a') + ')' : 'mất')),
        h('td', { class: 'num' }, fmt(l.p, 2)), h('td', { class: 'num' }, fmt(l.q, 1)), h('td', { class: 'num' }, fmt(l.kw, 2)), h('td', { class: 'num' }, fmt(l.kwh, 1)));
    }));
    const al = [...srv.alarms.values()].sort((x, y) => y.t - x.t);
    const key = al.map((x) => x.station + x.code + x.acked).join(',');
    if (key !== this._calKey) {
      this._calKey = key;
      this.centralAlarms.replaceChildren(...(al.length ? al.slice(0, 30).map((x) => h('div', { class: 'alarm-row' }, h('span', { class: 'chip ' + x.sev }, SEV_LABEL[x.sev] ?? x.sev),
        h('div', { class: 'msg' }, h('b', {}, `${x.station} · ${x.code} `), x.msg, h('div', { class: 'when' }, tShort(x.t) + (x.acked ? ' · đã xác nhận' : ''))),
        x.acked || x.code === 'STATION_OFFLINE' ? h('span') : h('button', { class: 'btn small', onclick: () => srv.ackAlarm(x.station, x.code, a.st.t) }, 'Xác nhận'))) : [h('p', { class: 'note' }, 'Không có cảnh báo tập trung.')]));
    }
    const up = net.smart.reduce((s, x) => s + x.link.bytes_up, 0), dn = net.smart.reduce((s, x) => s + x.link.bytes_down, 0);
    this.traffic.textContent = `Lên ${fmt(up / 1e6, 2)} MB · xuống ${fmt(dn / 1e6, 2)} MB (4 trạm). ST-01: ${a.st.gw.comms.stats.generated} bản ghi đo xa, máy chủ nhận ${srv.stations['ST-01'].records}, trong đó ${srv.stations['ST-01'].late} bản ghi đến muộn sau đồng bộ.`;
    this.app.setBadge('center', al.filter((x) => !x.acked && x.sev !== 'info').length);
  }

  // ---------------- Nhật ký ----------------
  buildLog(pane) {
    this.logSel = h('select', { id: 'log-filter', onchange: () => { this.logSeen = -1; } }, h('option', { value: 'all' }, 'Gateway + máy chủ'), h('option', { value: 'gw' }, 'Chỉ gateway ST-01'), h('option', { value: 'srv' }, 'Chỉ máy chủ'), h('option', { value: 'alarm' }, 'Chỉ báo động & an toàn'));
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
    this.logBox.replaceChildren(...items.slice(0, 250).map((l) => h('div', { class: l.level }, h('span', { class: 't' }, `${tShort(l.t)} ${l.src}`), l.text)));
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
        h('p', {}, h('b', {}, 'Cơ bản: '), 'hoàn thiện kịch bản theo ngưỡng (tab Kịch bản → Mẫu bài tập, hoặc student/kich_ban_nguong.py rồi chạy python -m trambom check-student). Đạt khi áp đúng dải ≥ 98 %, tiết kiệm ≥ 20 % điện và không chạy khô.'),
        h('p', {}, h('b', {}, 'Nâng cao: '), 'triển khai điều khiển dự báo (student/kich_ban_du_bao.py), so sánh với kịch bản dựng sẵn ở S10; sau đó viết bộ điều phối trung tâm cho 4 trạm (student/mang_luoi_nang_cao.py) dùng logger áp điểm bất lợi.')),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Gợi ý quan sát'),
        h('ul', {}, h('li', {}, 'Nền xám trên biểu đồ: thời gian mất mạng; nền hồng: chế độ (d).'), h('li', {}, 'Biểu đồ "Dữ liệu tại máy chủ" cho thấy khoảng trống khi mất mạng và phần được lấp lại sau đồng bộ (màu khác).'),
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
  componentInfo(tag) {
    const comp = this.app.components.find((c) => c.tag === tag);
    if (!comp) return null;
    const live = this.app.liveValues(tag);
    return h('div', {},
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', {}, `${comp.tag} · ${comp.name}`), h('button', { class: 'btn small', onclick: () => this.app.closeDrawer() }, 'Đóng')),
      h('p', { class: 'note' }, comp.group + ' — ' + comp.desc),
      h('table', { class: 'kv' }, h('tbody', {}, ...comp.params.map(([k, v, u]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v + (u && u !== '–' ? ' ' + u : '')))))),
      h('p', {}, h('b', {}, 'Dải làm việc: '), comp.range),
      live.length ? h('table', { class: 'kv' }, h('thead', {}, h('tr', {}, h('th', {}, 'Giá trị hiện tại'), h('th', {}, ''))), h('tbody', {}, ...live.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v))))) : '');
  }
}
