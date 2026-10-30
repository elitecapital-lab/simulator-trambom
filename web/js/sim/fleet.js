// Mạng lưới nhiều trạm (Hà Nội): ghép config/hanoi.json vào cấu hình dùng chung – chỉ phía web, lõi Python giữ 4 trạm.
// Không phụ thuộc DOM nên chạy được bằng Node (tests/test_fleet_js.py).

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); // Web Mercator (EPSG:3857), đơn vị radian

/**
 * Chiếu kinh/vĩ độ lên hộp bản đồ (0…1): x sang phải, y xuống dưới. Dùng Web Mercator – cùng hệ với ô bản đồ OpenStreetMap
 * nên marker trạm trùng khít với nền bản đồ thật khi bật lớp OpenStreetMap.
 */
export function mapXY(map, lon, lat) {
  return { x: (lon - map.lon0) / (map.lon1 - map.lon0), y: (mercY(map.lat1) - mercY(lat)) / (mercY(map.lat1) - mercY(map.lat0)) };
}
/** Tỉ lệ cao/rộng của hộp bản đồ trong Web Mercator. */
export function mapAspect(map) { return (mercY(map.lat1) - mercY(map.lat0)) / (((map.lon1 - map.lon0) * Math.PI) / 180); }

/** Bản sao cfg với danh sách trạm lấy từ hanoi.sites. Trạm ST-01…ST-04 kế thừa mục tương ứng trong station.json. */
export function applyFleet(cfg, hanoi) {
  const c = structuredClone(cfg);
  c.stations = hanoi.sites.map((s, i) => {
    const { x, y } = mapXY(hanoi.map, s.lon, s.lat);
    return { ...(cfg.stations[i] ?? {}), id: s.id, name: `Trạm ${s.id} · ${s.area} (${s.district})`, zone: s.zone, demand_scale: s.demand_scale,
      dz_crit_m: s.dz_crit_m, seed_offset: s.seed_offset, x, y, site: s };
  });
  c.fleet = { tariff_vnd_per_kwh: hanoi.tariff_vnd_per_kwh, operator: hanoi.operator, map: hanoi.map };
  return c;
}

/** Trạng thái hiển thị của một trạm theo MÁY CHỦ (dữ liệu trung tâm thật sự nhìn thấy). */
export const FLEET_STATUS = {
  ok: { label: 'Bình thường', rank: 0 },
  sync: { label: 'Đang đồng bộ', rank: 1 },
  offline: { label: 'Mất kết nối', rank: 2 },
  warn: { label: 'Cảnh báo', rank: 3 },
  crit: { label: 'Báo động', rank: 4 },
};

const NEAR_CRIT = new Set(['safe_stop', 'trip', 'level_stop']);
/** So điện năng với lịch cố định chỉ có nghĩa khi đủ dài: lịch cố định tắt bơm ban đêm (22:00–05:00) nên vài giờ đầu ngày cho tỉ lệ "âm" rất lớn. */
export const SAVINGS_MIN_S = 6 * 3600;

/**
 * Tóm tắt một trạm cho màn Mạng lưới. Số đo (áp, lưu lượng, mức, chất lượng, điện năng) là bản đo xa cuối cùng máy chủ nhận
 * (last) nên đứng yên khi trạm mất kết nối. Trạng thái tổng hợp còn dùng thêm: báo động tập trung, áp điểm bất lợi của logger
 * NB-IoT PL-301 (độc lập với 4G) và việc "mini PC ngừng" (router 4G còn sống nhưng không còn nhịp tim MQTT).
 */
export function stationSummary(net, i) {
  const s = net.smart[i], f = net.fixed[i], srv = net.server, S0 = srv.stations[s.sid], last = S0.last || {};
  const alarms = [...srv.alarms.values()].filter((a) => a.station === s.sid);
  const sevN = (v) => alarms.filter((a) => a.sev === v).length;
  const g = s.gw, safety = g.safety;
  const dead = Boolean(s.gw_dead && !s.gw_dead.restarted);
  const mode = S0.online ? (last.mode || 'a') : (dead ? 'x' : 'b');
  let status = 'ok';
  if (!S0.online) status = 'offline';
  else if (last.mode === 'c' || g.comms.state === 'resync') status = 'sync';
  const critCodes = alarms.filter((a) => a.sev === 'critical' || a.sev === 'alarm' || a.sev === 'serious');
  // báo động quan trọng chỉ tính khi trạm đang nối mạng (khi mất mạng trung tâm không thấy gì thêm ngoài STATION_OFFLINE)
  const hasActive = [...g.alarms.active.values()];
  const localWarn = hasActive.length > 0;
  if (S0.online && (NEAR_CRIT.has(safety.state) || critCodes.some((a) => a.code !== 'STATION_OFFLINE'))) status = 'crit';
  else if (S0.online && (localWarn || alarms.some((a) => a.code !== 'STATION_OFFLINE')) && status === 'ok') status = 'warn';
  if (dead) status = S0.online ? 'crit' : 'offline';
  const unacked = alarms.filter((a) => !a.acked && a.code !== 'STATION_OFFLINE').length;
  const k = s.kpi, fk = f ? f.kpi : null;
  return {
    sid: s.sid, i, site: s.station.site, status, mode, online: S0.online, dead,
    p: last.p, q: last.q, level: last.level, kw: last.kw, kwh: last.kwh, cl: last.cl, ntu: last.ntu, ph: last.ph, t1: last.t1,
    p_crit: s.plant.p_crit, p_set: last.p_set, ctl: last.ctl || 'auto',
    alarms: alarms.length, unacked, crit: sevN('critical') + sevN('alarm'), buffer: g.comms.buf.length,
    saving_pct: net.t >= SAVINGS_MIN_S && fk && fk.energy_kwh > 0.5 ? 100 * (1 - k.energy_kwh / fk.energy_kwh) : null,
    energy_kwh: k.energy_kwh, fixed_kwh: fk ? fk.energy_kwh : null, delivered_m3: k.delivered_m3, leak_m3: k.leak_m3,
    version: S0.reported ?? S0.target, target: S0.target, records: S0.records, late: S0.late,
    age: last.t1 !== undefined ? net.t - last.t1 : null,
  };
}

/** Tổng hợp toàn mạng từ danh sách tóm tắt trạm. */
export function fleetTotals(net, rows) {
  const t = net.totals();
  const by = { ok: 0, sync: 0, offline: 0, warn: 0, crit: 0 };
  let flow = 0, kw = 0, hh = 0;
  for (const r of rows) { by[r.status]++; if (r.q !== undefined) flow += r.q; if (r.kw !== undefined) kw += r.kw; hh += r.site?.households ?? 0; }
  return { ...t, by, flow, kw, households: hh, n: rows.length, saved_ready: net.t >= SAVINGS_MIN_S && t.fixed_kwh > 1, saved_kwh: Math.max(0, t.fixed_kwh - t.smart_kwh), saved_pct: t.fixed_kwh > 0 ? 100 * (1 - t.smart_kwh / t.fixed_kwh) : 0 };
}
