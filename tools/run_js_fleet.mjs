// Chạy mạng lưới Hà Nội (config/hanoi.json) bằng lõi JavaScript trong Node và in tóm tắt từng trạm – dùng cho tests/test_fleet_js.py.
//   node tools/run_js_fleet.mjs [giờ] [basic|advanced]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFleet, fleetTotals, stationSummary } from '../web/js/sim/fleet.js';
import { NetworkSim } from '../web/js/sim/network.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (n) => JSON.parse(readFileSync(join(root, 'config', n), 'utf8'));
const [hours = '8', level = 'advanced'] = process.argv.slice(2);
const hanoi = read('hanoi.json'), cfg = applyFleet(read('station.json'), hanoi);
const net = new NetworkSim(cfg, level, { withFixed: 'all', events: hanoi.scenario.events });
const n = Math.round(Number(hours) * 3600 / net.dt), seen = new Set();
for (let i = 0; i < n; i++) {
  net.step();
  if (i % 300 === 0) net.smart.forEach((_, k) => { const r = stationSummary(net, k); seen.add(r.sid + ':' + r.status); });
}
const rows = net.smart.map((_, i) => stationSummary(net, i));
const tot = fleetTotals(net, rows);
const alarmCodes = [...new Set(net.server.alarm_history.map((a) => a.station + ':' + a.code))];
console.log(JSON.stringify({
  n: rows.length, ids: rows.map((r) => r.sid), status_seen: [...seen], alarm_codes: alarmCodes,
  rows: rows.map((r) => ({ sid: r.sid, status: r.status, online: r.online, p: r.p, q: r.q, energy_kwh: r.energy_kwh, fixed_kwh: r.fixed_kwh, version: r.version })),
  totals: { saved_pct: tot.saved_pct, households: tot.households, by: tot.by },
}));
