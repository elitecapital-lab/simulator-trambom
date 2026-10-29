// Chạy lõi mô phỏng JavaScript bằng Node để đối chiếu với bản Python.
//   node tools/run_js_sim.mjs S1 basic [giờ] [dt]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TwinSim } from '../web/js/sim/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'config', 'station.json'), 'utf8'));
const scen = JSON.parse(readFileSync(join(root, 'config', 'scenarios.json'), 'utf8')).scenarios;
const [sid = 'S1', level = 'basic', hours = null, dt = null] = process.argv.slice(2);
const sc = scen.find((s) => s.id === sid);
const t0 = Date.now();
const tw = new TwinSim(cfg, sc, level, { dt: dt ? Number(dt) : null });
const res = tw.run(hours ? Number(hours) : null);
const pick = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !['incidents'].includes(k)));
console.log(JSON.stringify({ wall_s: (Date.now() - t0) / 1000, smart: pick(res.smart), fixed: pick(res.fixed), logs: res.gw_logs.length }));
