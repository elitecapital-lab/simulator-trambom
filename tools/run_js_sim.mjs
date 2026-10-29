// Chạy lõi mô phỏng JavaScript bằng Node để đối chiếu với bản Python.
//   node tools/run_js_sim.mjs S1 basic [giờ] [dt] [--off=PT-102,AIT]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TwinSim } from '../web/js/sim/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'config', 'station.json'), 'utf8'));
const scen = JSON.parse(readFileSync(join(root, 'config', 'scenarios.json'), 'utf8')).scenarios;
const argv = process.argv.slice(2);
const off = (argv.find((a) => a.startsWith('--off=')) ?? '--off=').slice(6).split(',').filter(Boolean);
for (const o of off) cfg.hardware[o] = false;
const [sid = 'S1', level = 'basic', hours = null, dt = null] = argv.filter((a) => !a.startsWith('--'));
const sc = scen.find((s) => s.id === sid);
const t0 = Date.now();
const tw = new TwinSim(cfg, sc, level, { dt: dt && dt !== 'null' ? Number(dt) : null });
const res = tw.run(hours && hours !== 'null' ? Number(hours) : null);
const pick = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !['incidents'].includes(k)));
const det = (s) => s.incidents.map((i) => [i.kind, i.detected === null ? null : i.detected - i.t, i.how]);
console.log(JSON.stringify({ wall_s: (Date.now() - t0) / 1000, smart: pick(res.smart), fixed: pick(res.fixed), logs: res.gw_logs.length, detect: det(res.smart) }));
