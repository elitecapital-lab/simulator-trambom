// Dữ liệu trạm và lệnh điều khiển dùng chung cho màn HMI và điều khiển trong cảnh 3D.
// Hai vị trí vận hành:
//   'local'  – tại trạm (HMI-01 trên cửa tủ CP-02, hoặc người đứng trong trạm ở cảnh 3D): đọc trực tiếp từ gateway,
//              lệnh đi thẳng vào gateway, không qua mạng, không hết hạn; mini PC treo thì không ra lệnh được.
//   'remote' – trung tâm (SCADA): chỉ thấy dữ liệu MÁY CHỦ đã nhận qua MQTT (chu kỳ 10 s, đứng yên khi mất mạng);
//              lệnh đi qua máy chủ, có thời hạn ngắn, có thể bị từ chối (quyền tại chỗ) hoặc hết hạn (mất mạng).

export const MANUAL_CMDS = ['set_mode', 'pump_start', 'pump_stop', 'pump_speed', 'valve'];
export const CTL_NAME = { auto: 'TỰ ĐỘNG', remote: 'TAY · TỪ XA', local: 'TAY · TẠI CHỖ' };
export const MODE_NAME = { a: '(a) Bình thường', b: '(b) Tự vận hành', c: '(c) Đồng bộ', d: '(d) Cảnh báo / an toàn', x: 'Mini PC lỗi · PID biến tần' };
export const MODE_CHIP = { a: 'good', b: 'warning', c: 'info', d: 'critical', x: 'critical' };
export const SEV_ORDER = { critical: 0, alarm: 1, warning: 2, info: 3 };
export const CMD_STATUS = {
  ok: ['good', 'đã thực hiện'], queued: ['info', 'đã gửi'], rejected: ['critical', 'từ chối'], expired: ['warning', 'hết hạn'],
  expired_server: ['warning', 'hết hạn ở máy chủ'], duplicate: ['off', 'trùng'],
};
export const PUMP_NAME = ['P-01', 'P-02'];

/**
 * Ảnh chụp dữ liệu trạm theo vị trí vận hành. Trường nào vị trí đó không thấy thì là undefined
 * (ví dụ trung tâm không nhận PT-102, dòng điện, độ mở van).
 */
export function stationData(app, where) {
  const st = app.st, g = st.gw, pl = st.plant, t = app.net.t;
  if (where === 'local') {
    const sig = g.sig || {}, dead = Boolean(st.gw_dead);
    const alarms = [...g.alarms.active.values()].map((x) => ({ ...x, station: st.sid }));
    return {
      where, t, dead, stale: dead, age: null, p1: sig.p1, p2: sig.p2, q: sig.q_f, q_in: sig.q_in_f, level: sig.level, cl: sig.cl, ntu: sig.ntu, ph: sig.ph,
      kw: pl.kw, kwh: st.kpi.energy_kwh, p_set: dead ? st.gw_dead.p_set : g.ctrl.p_set, p_crit: pl.p_crit, valve: pl.outlet_frac, psv: pl.q_relief,
      pumps: pl.pumps.map((pu, i) => ({
        tag: pu.tag, running: pu.running, f: pu.f, kw: pu.kw, amps: pu.amps, fault: pu.fault, run_h: pu.run_s / 3600, starts: pu.starts,
        starts_h: g.pm.startsLastHour(i, t), f_set: g.manual ? g.manual.f[i] : null, want: g.manual ? g.manual.run[i] : null,
      })),
      mode: dead ? 'x' : g.mode(), ctl: dead ? 'auto' : g.controlSrc(), comms: dead ? 'offline' : g.comms.state, alarms,
      installed: g.sig_proc.installed, lease_s: g.manual && g.manual.until !== null ? Math.max(0, g.manual.until - t) : null,
    };
  }
  const S0 = app.server.stations[st.sid], r = S0.last || {};
  const alarms = [...app.server.alarms.values()].filter((x) => x.station === st.sid);
  const fault = (tag) => alarms.some((x) => x.code === 'PUMP_FAULT_' + tag);
  return {
    where, t, dead: false, stale: !S0.online, age: r.t1 !== undefined ? t - r.t1 : null, p1: r.p, p2: undefined, q: r.q, q_in: r.q_in, level: r.level,
    cl: r.cl, ntu: r.ntu, ph: r.ph, kw: r.kw, kwh: r.kwh, p_set: r.p_set, p_crit: undefined, valve: undefined, psv: undefined,
    pumps: [r.f1, r.f2].map((f, i) => ({
      tag: PUMP_NAME[i], running: (f ?? 0) > 0.5, f, kw: undefined, amps: undefined, fault: fault(PUMP_NAME[i]),
      run_h: undefined, starts: undefined, starts_h: undefined, f_set: null, want: null,
    })),
    mode: S0.online ? (r.mode || 'a') : 'b', ctl: r.ctl || 'auto', comms: S0.online ? 'online' : 'offline', alarms, installed: null, lease_s: null,
  };
}

/**
 * Gửi lệnh từ một vị trí vận hành. Trả về { ok, msg }; ok = null nghĩa là đã gửi qua MQTT, chờ trạm xác nhận.
 * Mặc định hiện thông báo ngắn (toast) và làm mới các bảng.
 */
export function sendCommand(app, where, type, args = {}, { toast = true } = {}) {
  const t = app.net.t;
  let res;
  if (where === 'local') {
    if (app.st.gw_dead) res = { ok: false, msg: 'Mini PC đang ngừng – HMI-01 mất kết nối với bộ điều khiển, lệnh không tới được biến tần' };
    else {
      const [ok, why] = app.st.gw.localCommand(type, args, t);
      res = { ok, msg: why };
    }
  } else {
    const ttl = MANUAL_CMDS.includes(type) ? app.cfg.gateway.manual_cmd_ttl_s : 900;
    const id = app.server.sendCommand(app.st.sid, type, args, t, ttl);
    res = { ok: null, id, msg: `Đã gửi ${id} ${type} qua MQTT (hạn ${Math.round(ttl / 60)} phút) – chờ trạm xác nhận` };
  }
  if (toast) app.toast(res.ok === null ? res.msg : (res.ok ? '✓ ' : '✗ TỪ CHỐI: ') + res.msg);
  app._updatePanels(true);
  return res;
}

/** Xác nhận báo động. Tại chỗ: xác nhận ngay trên gateway; trung tâm: gửi lệnh ack_alarm qua máy chủ. */
export function ackAlarm(app, where, code) {
  const t = app.net.t;
  if (where === 'local' && app.st.gw_dead) { app.toast('Mini PC đang ngừng – HMI-01 không xác nhận được báo động'); return false; }
  if (where === 'local') app.st.gw.alarms.ack(code, t);
  else app.server.ackAlarm(app.st.sid, code, t);
  app._updatePanels(true);
  return true;
}

/** Danh sách báo động đã sắp theo mức nghiêm trọng rồi thời gian (mới trước). */
export function sortedAlarms(list) {
  return [...list].sort((x, y) => (SEV_ORDER[x.sev] - SEV_ORDER[y.sev]) || (y.t - x.t));
}

/**
 * Điều kiện cho phép chạy bơm idx (0/1) – chỉ tính được tại chỗ (trung tâm không thấy chi tiết liên động).
 * Trả về [[đạt, mô tả], ...] hoặc [] khi mini PC ngừng.
 */
export function permissives(app, idx) {
  const st = app.st, g = st.gw, pl = st.plant, t = app.net.t, cfg = app.cfg;
  if (st.gw_dead) return [];
  const sf = g.safety, pu = pl.pumps[idx], fmt1 = (v) => v.toFixed(1).replace('.', ',');
  return [
    [pl.outlet_frac >= 0.95, 'Van MV-02 mở hết (mở van trước, chạy bơm sau)'],
    [!sf.level_trip && !st.sensors.lsll, `Mức bể an toàn (> ${fmt1(cfg.safety.level_ll_m)} m, phao LSLL không báo cạn)`],
    [!sf.safe_stop, 'Không dừng an toàn do chất lượng nước' + (sf.safe_stop ? ` (${sf.safe_reason})` : '')],
    [!sf.trip_active && !sf.lockout, 'Không cắt/khóa do áp lực rất cao'],
    [!pu.fault, `Biến tần ${pu.tag} không báo lỗi`],
    [g.pm.startsLastHour(idx, t) < cfg.safety.max_starts_per_h, `Số lần khởi động ${pu.tag} < ${cfg.safety.max_starts_per_h}/giờ`],
    [!sf.limiting, sf.limiting ? `Đang giới hạn tần số ≤ ${fmt1(sf.f_cap)} Hz do áp cao` : 'Không bị giới hạn tần số do áp cao'],
  ];
}

/** Nhật ký lệnh theo vị trí vận hành, mới nhất trước: [{ t, id, type, status, reason }]. */
export function commandLog(app, where, n = 8) {
  if (where === 'local') return app.st.gw.cmd_results.slice(-n).reverse().map((c) => ({ t: c.t, id: c.id, type: c.type, status: c.status, reason: c.reason }));
  const log = app.server.stations[app.st.sid].cmd_log, types = {};
  for (const c of log) if (c.type) types[c.id] = c.type;
  return log.slice(-n).reverse().map((c) => ({ t: c.t, id: c.id, type: c.type || types[c.id] || '', status: c.status, reason: c.reason }));
}

/** Vị trí có quyền ra lệnh tay lúc này không (để bật/tắt nút). */
export function canCommand(d) { return !d.dead && d.ctl !== 'auto'; }
