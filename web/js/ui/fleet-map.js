// Bản đồ Hà Nội cách điệu (SVG, không cần tải ô bản đồ) + các trạm. Hình học là SƠ ĐỒ MINH HỌA: sông, hồ vẽ gần đúng để
// định hướng, không theo tỉ lệ. Kéo để dời, lăn chuột / nút +− để thu phóng; marker giữ cỡ cố định khi thu phóng.
import { FLEET_STATUS, mapAspect, mapXY } from '../sim/fleet.js';
import { h, fmt } from './dom.js';
import { MODE_NAME, viNum } from './ops.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'text') el.textContent = v; else el.setAttribute(k, v); }
  for (const c of kids.flat()) if (c) el.append(c);
  return el;
};
const W = 1000;
// gói tin chạy dọc đường truyền bằng offset-path; trình duyệt cũ không có thì bỏ hiệu ứng (không để chấm đứng ở góc bản đồ)
const MOTION = typeof CSS !== 'undefined' && CSS.supports('offset-path', "path('M0 0L1 1')");

// [kinh độ, vĩ độ] – gần đúng, đủ để định hướng
const GEO = {
  rivers: [
    { id: 'hong', name: 'Sông Hồng', w: 15, pts: [[105.640, 21.130], [105.700, 21.135], [105.750, 21.115], [105.785, 21.092], [105.812, 21.100], [105.833, 21.098], [105.846, 21.078], [105.856, 21.056], [105.861, 21.040], [105.869, 21.024], [105.874, 21.004], [105.878, 20.984], [105.886, 20.964], [105.900, 20.940], [105.914, 20.916], [105.926, 20.890]] },
    { id: 'duong', name: 'Sông Đuống', w: 9, pts: [[105.852, 21.088], [105.875, 21.097], [105.905, 21.094], [105.935, 21.087], [105.965, 21.084], [106.000, 21.077], [106.020, 21.072]] },
    { id: 'nhue', name: 'Sông Nhuệ', w: 5, pts: [[105.738, 21.082], [105.746, 21.060], [105.750, 21.040], [105.752, 21.020], [105.757, 20.998], [105.761, 20.975], [105.768, 20.955], [105.780, 20.930], [105.790, 20.905]] },
    { id: 'tolich', name: 'Sông Tô Lịch', w: 3, pts: [[105.812, 21.048], [105.804, 21.034], [105.801, 21.018], [105.804, 21.002], [105.806, 20.985], [105.803, 20.968], [105.792, 20.952]] },
  ],
  lakes: [
    { id: 'tay', name: 'Hồ Tây', pts: [[105.8125, 21.0690], [105.8230, 21.0705], [105.8330, 21.0645], [105.8365, 21.0565], [105.8305, 21.0475], [105.8200, 21.0450], [105.8100, 21.0495], [105.8065, 21.0590]] },
    { id: 'guom', name: 'Hồ Gươm', pts: [[105.8505, 21.0315], [105.8545, 21.0310], [105.8555, 21.0270], [105.8515, 21.0255], [105.8490, 21.0285]] },
    { id: 'lindam', name: 'Hồ Linh Đàm', pts: [[105.8215, 20.9625], [105.8290, 20.9630], [105.8330, 20.9575], [105.8280, 20.9530], [105.8210, 20.9560]] },
    { id: 'yenso', name: 'Hồ Yên Sở', pts: [[105.8610, 20.9560], [105.8760, 20.9570], [105.8800, 20.9500], [105.8700, 20.9440], [105.8600, 20.9490]] },
    { id: 'baymau', name: '', pts: [[105.8395, 21.0140], [105.8460, 21.0140], [105.8470, 21.0090], [105.8410, 21.0075]] },
  ],
  // nhãn khu vực: [kinh độ, vĩ độ, chữ, mức thu phóng tối thiểu]
  areas: [
    [105.880, 21.130, 'ĐÔNG ANH', 1], [105.958, 21.052, 'LONG BIÊN', 1], [105.975, 21.015, 'GIA LÂM', 1], [105.835, 20.925, 'THANH TRÌ', 1],
    [105.745, 20.955, 'HÀ ĐÔNG', 1], [105.730, 21.040, 'NAM TỪ LIÊM', 1], [105.715, 21.090, 'BẮC TỪ LIÊM', 1], [105.828, 21.082, 'TÂY HỒ', 1.8],
    [105.793, 21.027, 'CẦU GIẤY', 1.8], [105.842, 21.038, 'BA ĐÌNH', 2.4], [105.866, 21.030, 'HOÀN KIẾM', 2.4], [105.828, 21.016, 'ĐỐNG ĐA', 2.4],
    [105.862, 21.010, 'HAI BÀ TRƯNG', 2.4], [105.808, 20.995, 'THANH XUÂN', 2.4], [105.855, 20.978, 'HOÀNG MAI', 1.8],
  ],
  center: { lon: 105.840, lat: 21.0345 },
};

// Mạng ống truyền tải MINH HỌA: một ống chính đông–tây và ba trục bắc–nam; mỗi trạm nối vào trục gần nhất bằng nhánh vuông góc.
// (Sơ đồ tuyến ống, không phải bản vẽ hạ tầng thật.)
const PIPES = {
  trunk: { lon0: 105.660, lon1: 106.020, lat: 21.025 },
  ribs: [{ lon: 105.800, lat0: 21.105, lat1: 20.925 }, { lon: 105.850, lat0: 21.130, lat1: 20.900 }, { lon: 105.920, lat0: 21.078, lat1: 20.972 }],
};
const OSM_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const LAYERS_KEY = 'trambom-map-layers';

function smooth(pts) {
  if (pts.length < 3) return 'M' + pts.map((p) => p.join(' ')).join('L');
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1)} ${((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1)}`;
  const l = pts[pts.length - 1];
  return d + `L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}
function closed(pts) {
  const n = pts.length, mid = (i) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
  let m = mid(n - 1), d = `M${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) { const e = mid(i); d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${e[0].toFixed(1)} ${e[1].toFixed(1)}`; }
  return d + 'Z';
}

/** Màu theo thang giá trị 0…1 (sáng → đậm), dùng cho các chế độ màu Áp lực / Lưu lượng / Công suất / Mức bể. */
const RAMP = {
  p: ['#9fd0ff', '#4b9be0', '#1d5fa8', '#123f78'], q: ['#bfe9d6', '#5cc59a', '#1e9a6c', '#0f6a49'],
  kw: ['#ffe9a8', '#f7c04a', '#e68a1c', '#b2530a'], lv: ['#cfe3f7', '#79b2e6', '#2f7fc8', '#124f8f'],
};
function ramp(kind, x) {
  const c = RAMP[kind], v = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(v));
  return `color-mix(in srgb, ${c[i + 1]} ${Math.round((v - i) * 100)}%, ${c[i]})`;
}
export const COLOR_MODES = [
  ['status', 'Trạng thái'], ['p', 'Áp lực'], ['q', 'Lưu lượng'], ['kw', 'Công suất'], ['lv', 'Mức bể'],
];
const MODE_VAL = {
  p: (r) => [r.p, fmt(r.p, 2, 'bar'), (r.p - 1.5) / 2.5], q: (r) => [r.q, fmt(r.q, 1, 'm³/h'), r.q / 30],
  kw: (r) => [r.kw, fmt(r.kw, 1, 'kW'), r.kw / 5], lv: (r) => [r.level, fmt(r.level, 1, 'm'), (r.level - 0.5) / 3.5],
};
export const STATUS_VAR = { ok: 'var(--good)', sync: 'var(--accent)', offline: 'var(--muted)', warn: 'var(--warning)', crit: 'var(--critical)' };

export class MapScreen {
  constructor(fleet) {
    this.fleet = fleet; this.app = fleet.app; this.mode = 'status'; this.k = 1; this.vx = 0; this.vy = 0;
    this.layers = { pipes: true, links: false, osm: true };
    try { Object.assign(this.layers, JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}')); } catch (e) { /* bỏ qua */ }
    this.tileEls = new Map(); this.tok = 0; this.terr = 0; this.tz = null;
    const a = this.app, map = a.cfg.fleet.map;
    this.map = map; this.H = Math.round(W * mapAspect(map));
    this.P = (lon, lat) => { const m = mapXY(map, lon, lat); return [m.x * W, m.y * this.H]; };
    this.el = h('div', { class: 'fl-map' });
    this.stage = h('div', { class: 'fm-stage' });
    this.svg = S('svg', { class: 'fm-svg', viewBox: `0 0 ${W} ${this.H}`, role: 'img', 'aria-label': 'Sơ đồ minh họa Hà Nội và các trạm bơm' });
    this.tip = h('div', { class: 'fm-tip', hidden: true });
    this.stage.append(this.svg, this.tip, this._tools(), this._layerBox(), this._legend());
    this.side = h('div', { class: 'fm-side' });
    this.el.append(this.stage, this.side);
    this._draw();
    this._interact();
    this._buildSide();
    new ResizeObserver(() => this._fit()).observe(this.stage);
  }
  // ---------- vẽ nền + marker ----------
  _draw() {
    const P = this.P, svg = this.svg, H = this.H;
    const defs = S('defs', {},
      S('pattern', { id: 'fm-grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' }, S('path', { d: 'M50 0H0V50', class: 'fm-gridl' })),
      S('filter', { id: 'fm-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, S('feGaussianBlur', { stdDeviation: 3 })));
    this.world = S('g', { class: 'fm-world' });
    this.tiles = S('g', { class: 'fm-tiles' });
    const bg = S('rect', { x: -400, y: -400, width: W + 800, height: H + 800, class: 'fm-land' });
    const grid = S('rect', { x: -400, y: -400, width: W + 800, height: H + 800, fill: 'url(#fm-grid)', class: 'fm-gridrect' });
    const lakes = GEO.lakes.map((l) => S('path', { d: closed(l.pts.map((p) => P(...p))), class: 'fm-water', id: 'lake-' + l.id }));
    const rivers = GEO.rivers.map((r) => S('path', { d: smooth(r.pts.map((p) => P(...p))), class: 'fm-river', 'stroke-width': r.w }));
    const areas = GEO.areas.map(([lo, la, t, z]) => { const [x, y] = P(lo, la); return S('text', { x, y, class: 'fm-area', 'data-z': z, text: t }); });
    const rl = [['Sông Hồng', 105.8795, 20.9700, -78], ['Sông Đuống', 105.935, 21.0805, -4], ['Hồ Tây', 105.8215, 21.0575, 0]].map(([t, lo, la, rot]) => { const [x, y] = P(lo, la); return S('text', { x, y, class: 'fm-wl', transform: `rotate(${rot} ${x} ${y})`, text: t }); });
    this.links = S('g', { class: 'fm-links' }); this.pkts = S('g', { class: 'fm-pkts' }); this.marks = S('g', { class: 'fm-marks' });
    this.geo = S('g', { class: 'fm-geo' }, ...lakes, ...rivers, ...areas, ...rl); // nền cách điệu: ẩn khi có bản đồ OpenStreetMap
    this.pipes = S('g', { class: 'fm-pipes' }); this.valves = [];
    this.world.append(bg, grid, this.tiles, this.geo, this.pipes, this.links, this.pkts, this.marks);
    svg.append(defs, this.world);
    // trung tâm SYSTEM
    const [cx, cy] = P(GEO.center.lon, GEO.center.lat); this.c = [cx, cy];
    this._drawPipes(P);
    this.center = S('g', { class: 'fm-hq', 'data-fixed': 1 }, S('circle', { r: 22, class: 'fm-hq-r' }), S('circle', { r: 16, class: 'fm-hq-c' }),
      S('image', { href: 'assets/system-logo.png', x: -12, y: -12, width: 24, height: 24 }), S('text', { y: 33, class: 'fm-hq-t', text: 'TRUNG TÂM SYSTEM' }));
    this.marks.append(this.center);
    this.nodes = {};
    for (const s of this.app.cfg.stations) {
      const [x, y] = P(s.site.lon, s.site.lat);
      // đường truyền dữ liệu cong nhẹ về trung tâm
      const mx = (x + cx) / 2, my = (y + cy) / 2, dx = cx - x, dy = cy - y, len = Math.hypot(dx, dy) || 1, bend = 0.12 * len, qx = mx - dy / len * bend, qy = my + dx / len * bend;
      const d = `M${x.toFixed(1)} ${y.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
      const link = S('path', { d, class: 'fm-link' });
      const pkt = S('circle', { r: 2.6, class: 'fm-pkt' }); pkt.style.offsetPath = `path('${d}')`; pkt.style.animationDelay = `-${(Math.random() * 3).toFixed(2)}s`;
      if (!MOTION) pkt.style.display = 'none';
      this.links.append(link); this.pkts.append(pkt);
      const ring = S('circle', { r: 17, class: 'fm-ring' });
      const sel = S('circle', { r: 20, class: 'fm-sel' });
      const dot = S('circle', { r: 11, class: 'fm-dot' });
      const num = S('text', { class: 'fm-num', text: s.id.slice(3) });
      const x1 = S('path', { d: 'M-4.5-4.5L4.5 4.5M4.5-4.5L-4.5 4.5', class: 'fm-x' });
      const lab = S('text', { class: 'fm-lab', y: 26, text: s.site.area });
      const val = S('text', { class: 'fm-val', y: 38 });
      const g = S('g', { class: 'fm-st', tabindex: 0, role: 'button', 'aria-label': `${s.id} ${s.site.area}`, 'data-sid': s.id }, ring, sel, dot, num, x1, lab, val);
      g.addEventListener('click', (e) => { e.stopPropagation(); this.fleet.select(s.id); });
      g.addEventListener('dblclick', (e) => { e.stopPropagation(); this.app.openStation(s.id); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.fleet.select(s.id); } });
      g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this._tipFor(s.id, e); });
      g.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._tipMove(e); });
      g.addEventListener('pointerleave', () => { this.tip.hidden = true; });
      this.marks.append(g);
      this.nodes[s.id] = { g, x, y, dot, ring, sel, val, x1, link, pkt, lab, pipe: this.branches[s.id] };
    }
    this._applyLayers();
    this._place();
  }
  /** Ống chính, các trục và nhánh vào từng trạm: vỏ + lõi + dòng chảy; van trên mỗi nhánh; mối nối tại các điểm giao. */
  _drawPipes(P) {
    const T = PIPES.trunk, [tx0, ty] = P(T.lon0, T.lat), [tx1] = P(T.lon1, T.lat);
    const spines = [{ id: 'trunk', a: [tx0, ty], b: [tx1, ty], w: 1 }];
    PIPES.ribs.forEach((r, i) => { const [x, y0] = P(r.lon, r.lat0), [, y1] = P(r.lon, r.lat1); spines.push({ id: 'rib' + i, a: [x, y0], b: [x, y1], w: 1 }); });
    const pipe = (d, cls, w) => {
      const g = S('g', { class: 'fm-pipe ' + cls }, S('path', { d, class: 'fm-pedge', 'stroke-width': w + 3 }), S('path', { d, class: 'fm-pcore', 'stroke-width': w }), S('path', { d, class: 'fm-pflow' }));
      this.pipes.append(g); return g;
    };
    const f1 = (n) => n.toFixed(1), junc = [];
    for (const sp of spines) pipe(`M${f1(sp.a[0])} ${f1(sp.a[1])}L${f1(sp.b[0])} ${f1(sp.b[1])}`, 'main', 5);
    // giao điểm trục bắc–nam với ống chính
    for (const sp of spines.slice(1)) junc.push([sp.a[0], ty]);
    // nhánh: từ điểm nối trên trục tới trạm (nước chảy từ trục vào trạm)
    this.branches = {};
    for (const s of this.app.cfg.stations) {
      const [sx, sy] = P(s.site.lon, s.site.lat), cand = [];
      if (sx >= tx0 && sx <= tx1) cand.push({ len: Math.abs(sy - ty), j: [sx, ty] });
      for (const sp of spines.slice(1)) { const top = Math.min(sp.a[1], sp.b[1]), bot = Math.max(sp.a[1], sp.b[1]); if (sy >= top && sy <= bot) cand.push({ len: Math.abs(sx - sp.a[0]), j: [sp.a[0], sy] }); }
      cand.sort((p, q) => p.len - q.len);
      const c = cand[0] ?? { len: 0, j: [sx, sy] };
      const g = pipe(`M${f1(c.j[0])} ${f1(c.j[1])}L${f1(sx)} ${f1(sy)}`, 'branch', 3);
      this.branches[s.id] = g;
      junc.push(c.j);
      // van chặn trên nhánh (giữa nhánh), quay theo hướng ống
      const v = S('g', { class: 'fm-valve' }, S('path', { d: 'M-5-4L5 4V-4L-5 4Z' }));
      this.valves.push({ el: v, x: (c.j[0] + sx) / 2, y: (c.j[1] + sy) / 2, a: (Math.atan2(sy - c.j[1], sx - c.j[0]) * 180) / Math.PI, len: c.len });
      this.pipes.append(v);
    }
    this.joints = junc.map(([x, y]) => { const c = S('circle', { class: 'fm-joint', r: 3.2 }); this.pipes.append(c); return { el: c, x, y }; });
    // đầu nguồn hai phía
    this.sources = [[tx0, 'Ống truyền tải từ phía Tây', 'start'], [tx1, 'Ống truyền tải từ phía Đông', 'end']].map(([x, t, anchor]) => {
      const g = S('g', { class: 'fm-src' }, S('circle', { r: 7 }), S('text', { y: -12, 'text-anchor': anchor, text: t }));
      this.pipes.append(g); return { el: g, x, y: ty };
    });
  }
  /** Bật/tắt các lớp: ống, đường truyền dữ liệu, nền OpenStreetMap. */
  _applyLayers() {
    this.pipes.style.display = this.layers.pipes ? '' : 'none';
    this.tiles.style.display = this.layers.osm ? '' : 'none';
    this._osmState();
    if (this.layers.osm) this._tilesSoon();
    this.updateLinks();
  }
  /** Đường truyền dữ liệu: chỉ hiện khi bật lớp, hoặc của trạm đang chọn. */
  updateLinks() {
    const sel = this.fleet.sel, on = this.layers.links;
    for (const [sid, n] of Object.entries(this.nodes)) {
      const show = on || sel === sid;
      n.link.style.display = show ? '' : 'none';
      n.link.classList.toggle('sel', sel === sid);
      n.pkt.style.display = show && MOTION && n.up ? '' : 'none';
    }
  }
  _layerBox() {
    const L = [['pipes', 'Đường ống', 'Tuyến ống truyền tải minh họa, nhánh vào từng trạm (dòng chảy theo lưu lượng vào)'], ['links', 'Liên kết dữ liệu', 'Đường truyền đo xa 4G từ mỗi trạm về trung tâm'], ['osm', 'Nền OpenStreetMap', 'Bản đồ mã nguồn mở OpenStreetMap (cần Internet); không có thì dùng sơ đồ cách điệu']];
    this.osmNote = h('span', { class: 'fm-onote', hidden: true });
    return h('div', { class: 'fm-layers', role: 'group', 'aria-label': 'Lớp bản đồ' }, ...L.map(([k, label, tip]) => h('label', { title: tip },
      h('input', { type: 'checkbox', checked: this.layers[k], onchange: (e) => { this.layers[k] = e.target.checked; if (k === 'osm' && e.target.checked) { this.osmProbe = undefined; this.terr = 0; this.tilesBlocked = false; } try { localStorage.setItem(LAYERS_KEY, JSON.stringify(this.layers)); } catch (er) { /* bỏ qua */ } this._applyLayers(); } }), label)), this.osmNote);
  }
  // ---------- nền OpenStreetMap (ô Web Mercator) ----------
  _tilesSoon() { if (!this._tq) this._tq = requestAnimationFrame(() => { this._tq = 0; this._tilesUpdate(); }); }
  _tilesUpdate() {
    if (!this.layers.osm || this.tilesBlocked || !this.sw) return;
    // thử MỘT ô trước: không có Internet / bị chặn thì dừng ngay (tránh hàng chục yêu cầu lỗi), có thì tải đủ ô trong khung
    if (this.osmProbe === undefined) {
      this.osmProbe = 'testing';
      const img = new Image();
      img.onload = () => { this.osmProbe = 'ok'; this._tilesSoon(); };
      img.onerror = () => { this.osmProbe = 'fail'; this.tilesBlocked = true; this._osmState(); };
      img.src = OSM_URL(11, 1626, 901); // ô z11 phủ Hà Nội
      return;
    }
    if (this.osmProbe !== 'ok') return;
    const m = this.map, lonR = m.lon1 - m.lon0, vb = this.svg.viewBox.baseVal, base = this.sw / vb.width; // pixel màn hình / đơn vị bản đồ
    const z = Math.max(10, Math.min(18, Math.round(Math.log2(base * W * 360 / lonR / 256))));
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), my0 = mercY(m.lat0), my1 = mercY(m.lat1), n = 2 ** z;
    // khung nhìn (đơn vị bản đồ) → chỉ số ô cần vẽ
    const tx = (wx) => ((m.lon0 + wx / W * lonR) + 180) / 360 * n, ty = (wy) => (1 - (my1 - wy / this.H * (my1 - my0)) / Math.PI) / 2 * n;
    const x0 = Math.floor(tx(vb.x)), x1 = Math.floor(tx(vb.x + vb.width)), y0 = Math.max(0, Math.floor(ty(vb.y))), y1 = Math.min(n - 1, Math.floor(ty(vb.y + vb.height)));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 90) return; // vô lý (khung chưa đo xong): bỏ qua lượt này
    if (z !== this.tz) { for (const e of this.tileEls.values()) e.remove(); this.tileEls.clear(); this.tz = z; }
    const want = new Set(), wx = (xi) => ((xi / n * 360 - 180) - m.lon0) / lonR * W, wy = (yi) => (my1 - Math.PI * (1 - 2 * yi / n)) / (my1 - my0) * this.H, size = 360 / n / lonR * W;
    for (let yi = y0; yi <= y1; yi++) for (let xi = x0; xi <= x1; xi++) {
      const key = `${z}/${((xi % n) + n) % n}/${yi}`; want.add(key);
      if (this.tileEls.has(key)) continue;
      const img = S('image', { x: wx(xi).toFixed(2), y: wy(yi).toFixed(2), width: (size + 0.35).toFixed(2), height: (size + 0.35).toFixed(2), preserveAspectRatio: 'none', 'data-t': key });
      img.setAttribute('href', OSM_URL(z, ((xi % n) + n) % n, yi));
      img.addEventListener('load', () => { this.tok++; this._osmState(); });
      img.addEventListener('error', () => { this.terr++; img.remove(); this.tileEls.delete(key); this._osmState(); });
      this.tiles.append(img); this.tileEls.set(key, img);
    }
    for (const [key, el] of this.tileEls) if (!want.has(key)) { el.remove(); this.tileEls.delete(key); }
  }
  /** Có ô tải được → ẩn nền cách điệu; mọi ô đều lỗi (không Internet / bị chặn) → giữ nền cách điệu và báo một dòng. */
  _osmState() {
    const on = this.layers.osm, fail = on && (this.osmProbe === 'fail' || (this.tok === 0 && this.terr >= 3));
    if (fail) this.tilesBlocked = true;
    const shown = on && this.tok > 0;
    this.svg.classList.toggle('osm-on', shown);
    this.osmNote.hidden = !fail; this.osmNote.textContent = fail ? 'Không tải được OpenStreetMap (cần Internet) – dùng sơ đồ cách điệu.' : '';
    if (this.attr) this.attr.hidden = !shown;
    if (!on) this.tilesBlocked = false;
  }
  /** Marker, nhãn giữ cỡ màn hình cố định: đặt lại phép biến đổi mỗi khi thu phóng. */
  _place() {
    const inv = 1 / this.k;
    for (const n of Object.values(this.nodes)) n.g.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)}) scale(${inv.toFixed(3)})`);
    this.center.setAttribute('transform', `translate(${this.c[0].toFixed(1)} ${this.c[1].toFixed(1)}) scale(${inv.toFixed(3)})`);
    this.svg.style.setProperty('--fm-k', this.k.toFixed(3));
    for (const t of this.svg.querySelectorAll('.fm-area')) t.classList.toggle('on', this.k >= +t.dataset.z);
    for (const n of Object.values(this.nodes)) n.pkt.setAttribute('r', (2.6 / this.k).toFixed(2)); // gói tin giữ cỡ màn hình khi thu phóng
    for (const v of this.valves) { v.el.setAttribute('transform', `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)}) rotate(${v.a.toFixed(1)}) scale(${inv.toFixed(3)})`); v.el.style.display = v.len * this.k > 26 ? '' : 'none'; }
    for (const j of this.joints) j.el.setAttribute('r', (3.2 / this.k).toFixed(2));
    for (const so of this.sources) so.el.setAttribute('transform', `translate(${so.x.toFixed(1)} ${so.y.toFixed(1)}) scale(${inv.toFixed(3)})`);
    // lưới và độ dày sông thu phóng theo bản đồ; chữ nền giữ cỡ tương đối
  }
  // ---------- thu phóng / kéo ----------
  _fit() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.sw = r.width; this.sh = r.height;
    // preserveAspectRatio "xMidYMid slice" tự phủ khung; tính viewBox hiện tại theo (k, tâm)
    this._apply();
  }
  _apply() {
    if (!this.sw) return;
    // khung nhìn ở đơn vị bản đồ: k = 1 thì thấy trọn bản đồ; trục nào còn dư chỗ thì căn giữa, nếu không thì giới hạn kéo
    const base = Math.min(this.sw / W, this.sh / this.H), vw = this.sw / (base * this.k), vh = this.sh / (base * this.k);
    const ax = (v, size, total) => (size >= total ? (total - size) / 2 : Math.max(-60, Math.min(total + 60 - size, v)));
    this.vx = ax(this.vx, vw, W); this.vy = ax(this.vy, vh, this.H);
    this.svg.setAttribute('viewBox', `${this.vx.toFixed(1)} ${this.vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
    this._unit = vw / this.sw; // đơn vị bản đồ / pixel
    this._place();
    if (this.layers.osm) this._tilesSoon();
  }
  zoom(f, cx = 0.5, cy = 0.5) {
    const base = Math.min(this.sw / W, this.sh / this.H), vw0 = this.sw / (base * this.k), vh0 = this.sh / (base * this.k);
    const k = Math.max(1, Math.min(6, this.k * f)); if (k === this.k) return;
    const vw1 = this.sw / (base * k), vh1 = this.sh / (base * k);
    this.vx += (vw0 - vw1) * cx; this.vy += (vh0 - vh1) * cy; this.k = k; this._apply();
  }
  /** Đưa trạm sid vào giữa khung (có thu phóng nhẹ). */
  flyTo(sid, k = 2.2) {
    const n = this.nodes[sid]; if (!n || !this.sw) return;
    this.k = Math.max(this.k, k); const base = Math.min(this.sw / W, this.sh / this.H);
    this.vx = n.x - this.sw / (base * this.k) / 2; this.vy = n.y - this.sh / (base * this.k) / 2; this._apply();
  }
  _interact() {
    const st = this.stage; let drag = null;
    st.addEventListener('wheel', (e) => { e.preventDefault(); const r = st.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
    this.svg.addEventListener('pointerdown', (e) => { if (e.target.closest('.fm-st')) return; drag = { x: e.clientX, y: e.clientY, vx: this.vx, vy: this.vy, moved: false }; this.svg.setPointerCapture(e.pointerId); });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.vx = drag.vx - dx * this._unit; this.vy = drag.vy - dy * this._unit; this._apply();
    });
    const end = () => { if (drag && !drag.moved) this.fleet.select(null); drag = null; };
    this.svg.addEventListener('pointerup', end); this.svg.addEventListener('pointercancel', () => { drag = null; });
  }
  _tools() {
    const b = (t, label, fn) => h('button', { class: 'btn icon', type: 'button', 'aria-label': label, title: label, onclick: fn }, t);
    return h('div', { class: 'fm-tools' }, b('+', 'Phóng to', () => this.zoom(1.4)), b('−', 'Thu nhỏ', () => this.zoom(1 / 1.4)), b('⌂', 'Toàn thành phố', () => { this.k = 1; this.vx = this.vy = 0; this._apply(); }));
  }
  _legend() {
    this.legend = h('div', { class: 'fm-legend' });
    return h('div', { class: 'fm-bar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tô màu theo' }, ...COLOR_MODES.map(([k, l]) => h('button', { 'data-m': k, class: k === this.mode ? 'on' : '', onclick: () => this.setMode(k) }, l))),
      this.legend, h('span', { class: 'fm-note' }, this.attr = h('a', { class: 'fm-attr', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', hidden: true }, '© OpenStreetMap contributors'), h('span', { class: 'sch' }, 'Sơ đồ minh họa · vị trí trạm là giả lập')));
  }
  setMode(m) {
    this.mode = m;
    this.stage.querySelectorAll('.fm-bar .seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    const items = m === 'status' ? Object.entries(FLEET_STATUS).map(([k, v]) => [STATUS_VAR[k], v.label])
      : [[ramp(m, 0), { p: '1,5 bar', q: '0 m³/h', kw: '0 kW', lv: '0,5 m' }[m]], [ramp(m, 1), { p: '≥ 4,0 bar', q: '≥ 30 m³/h', kw: '≥ 5 kW', lv: '≥ 4 m' }[m]], [STATUS_VAR.crit, 'viền đỏ: báo động']];
    this.legend.replaceChildren(...items.map(([c, t]) => h('span', {}, h('i', { style: `background:${c}` }), t)));
    if (this.fleet.rows.length) this.update(this.fleet);
  }
  // ---------- chú thích khi rê chuột ----------
  _tipFor(sid, e) {
    const r = this.fleet.byId?.[sid]; if (!r) return;
    const s = r.site;
    this.tip.replaceChildren(h('b', {}, `${r.sid} · ${s.area}`), h('small', {}, `${s.district} · ${s.kind} · ${s.households} hộ`),
      h('div', { class: 'ft-st' }, h('i', { style: `background:${STATUS_VAR[r.status]}` }), FLEET_STATUS[r.status].label + (r.online ? ' · ' + MODE_NAME[r.mode] : ' · mất kết nối')),
      h('div', { class: 'ft-kv' }, h('span', {}, 'Áp ra'), h('b', {}, fmt(r.p, 2, 'bar')), h('span', {}, 'Lưu lượng'), h('b', {}, fmt(r.q, 1, 'm³/h')), h('span', {}, 'Công suất'), h('b', {}, fmt(r.kw, 2, 'kW'))),
      h('small', { class: 'ft-h' }, 'Nhấp để chọn · nhấp đúp để mở chi tiết'));
    this.tip.hidden = false; this._tipMove(e);
  }
  _tipMove(e) {
    const r = this.stage.getBoundingClientRect(), t = this.tip;
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 12;
    if (x + t.offsetWidth > r.width - 8) x = e.clientX - r.left - t.offsetWidth - 16;
    if (y + t.offsetHeight > r.height - 8) y = r.height - t.offsetHeight - 8;
    t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
  // ---------- cột bên phải: cần chú ý + thẻ trạm chọn ----------
  _buildSide() {
    this.card = h('section', { class: 'fm-card', hidden: true, 'aria-live': 'polite' });
    this.attn = h('section', { class: 'fm-attn' }, h('h3', {}, h('span', { class: 'lbl' }, 'Các trạm'), this.attnN = h('span', { class: 'fm-n' })), this.attnList = h('div', { class: 'fm-list' }));
    this.side.append(this.card, this.attn);
  }
  /** Lý do ngắn gọn một trạm cần chú ý (từ báo động trung tâm đã nhận). */
  reason(r) {
    const al = [...this.app.server.alarms.values()].filter((a) => a.station === r.sid && a.code !== 'STATION_OFFLINE').sort((x, y) => ({ critical: 0, alarm: 1, serious: 1, warning: 2, info: 3 }[x.sev] - { critical: 0, alarm: 1, serious: 1, warning: 2, info: 3 }[y.sev]) || y.t - x.t);
    if (r.dead) return 'Mini PC ngừng – biến tần giữ áp bằng PID nội';
    if (!r.online) return `Mất kết nối ${Math.max(0, Math.round((this.app.net.t - (this.app.server.stations[r.sid].last_seen ?? 0)) / 60))} phút – trạm tự vận hành, dữ liệu được đệm`;
    if (al[0]) return viNum(al[0].msg);
    if (r.status === 'sync') return `Đang đồng bộ ${r.buffer} bản ghi đệm`;
    return 'Đang hoạt động bình thường';
  }
  update(f) {
    const rows = f.rows, byId = f.byId;
    for (const r of rows) {
      const n = this.nodes[r.sid]; if (!n) continue;
      const col = STATUS_VAR[r.status];
      let fill = col, sub = '';
      if (this.mode !== 'status') { const [v, txt, x] = MODE_VAL[this.mode](r); fill = Number.isFinite(v) ? ramp(this.mode, x) : 'var(--muted)'; sub = r.online ? txt : 'mất KN'; }
      else sub = r.alarms ? `${r.alarms} báo động` : '';
      n.dot.style.fill = fill;
      n.g.dataset.status = r.status; n.g.classList.toggle('on', f.sel === r.sid);
      n.ring.style.stroke = r.status === 'crit' ? 'var(--critical)' : r.status === 'warn' ? 'var(--warning)' : 'transparent';
      n.ring.classList.toggle('pulse', r.status === 'crit' || r.status === 'warn');
      n.x1.style.display = r.online ? 'none' : '';
      if (n.val._t !== sub) { n.val._t = sub; n.val.textContent = sub; }
      n.link.dataset.state = r.online ? 'up' : 'down'; n.up = r.online && !r.dead;
      // ống vào trạm: dòng chảy theo lưu lượng nước vào bể (FT-100); nguồn ngừng cấp thì ống "cạn"
      const qin = f.app.net.smart[r.i].plant.q_in, fl = qin < 0.5 ? 'dry' : qin < 8 ? 'slow' : qin < 18 ? 'mid' : 'fast';
      if (n.pipe && n.pipe._fl !== fl) { n.pipe._fl = fl; n.pipe.setAttribute('class', 'fm-pipe branch ' + fl); }
    }
    this.center.classList.toggle('alert', rows.some((r) => r.status === 'crit'));
    // danh sách trạm: trạm cần chú ý lên đầu (kèm lý do), trạm bình thường hiện số đo chính
    const list = [...rows].sort((x, y) => FLEET_STATUS[y.status].rank - FLEET_STATUS[x.status].rank || x.sid.localeCompare(y.sid)), nBad = list.filter((r) => r.status !== 'ok').length;
    const sub = (r) => (r.status === 'ok' ? `${fmt(r.p, 2)} bar · ${fmt(r.q, 1)} m³/h · ${fmt(r.kw, 1)} kW` : this.reason(r));
    const key = list.map((r) => r.sid + r.status + sub(r)).join('|') + '|' + f.sel;
    if (key !== this._ak) {
      this._ak = key;
      this.attnN.textContent = nBad ? `${nBad} cần chú ý · ${rows.length - nBad} bình thường` : `${rows.length} bình thường`;
      this.attnList.replaceChildren(...(nBad ? [] : [h('p', { class: 'note ok' }, `Cả ${rows.length} trạm đang hoạt động bình thường – hệ thống tự giám sát, không cần can thiệp.`)]),
        ...list.map((r) => h('button', { class: 'fm-row' + (f.sel === r.sid ? ' cur' : ''), type: 'button', onclick: () => f.select(r.sid, true) },
          h('i', { class: 'dot', style: `background:${STATUS_VAR[r.status]}` }), h('span', { class: 'fm-rt' }, h('b', {}, `${r.sid} · ${r.site.area}`), h('small', {}, sub(r))),
          r.status === 'ok' ? h('span') : h('span', { class: `chip ${r.status === 'crit' ? 'critical' : r.status === 'warn' ? 'warning' : r.status === 'sync' ? 'info' : 'off'}` }, FLEET_STATUS[r.status].label))));
    }
    this.updateLinks();
    this._updCard(f, byId);
  }
  _updCard(f, byId) {
    const r = f.sel ? byId[f.sel] : null, c = this.card;
    c.hidden = !r;
    if (!r) { this._ck = null; return; }
    const s = r.site, a = this.app, S0 = a.server.stations[r.sid];
    if (this._ck !== r.sid) {
      this._ck = r.sid;
      this.cardV = {};
      const V = (k, label, unit = '') => { const b = h('b', {}, '–'); this.cardV[k] = b; return h('div', { class: 'fm-m' }, h('span', {}, label), b, unit ? h('small', {}, unit) : ''); };
      const inj = (label, ev) => h('button', { class: 'btn small', type: 'button', onclick: () => { a.event({ ...ev, station: r.sid }); } }, label);
      const hrs = (x) => a.net.t / 3600 + x;
      this.cardSpark = S('svg', { class: 'fm-spark', viewBox: '0 0 240 44', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, S('line', { x1: 0, x2: 240, class: 'lo' }), S('line', { x1: 0, x2: 240, class: 'hi' }), S('polyline', { class: 'ln' }));
      this.cardHead = h('div', { class: 'fm-ch' }, h('div', {}, h('b', {}, `${r.sid} · ${s.area}`), h('small', {}, `${s.district} · ${s.kind} · ${s.households} hộ · ${s.zone}`)), this.cardChip = h('span', { class: 'chip' }),
        h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Bỏ chọn', onclick: () => f.select(null) }, '×'));
      this.cardWhy = h('p', { class: 'fm-why' });
      c.replaceChildren(this.cardHead, this.cardWhy,
        h('div', { class: 'fm-mg' }, V('p', 'Áp ra', 'bar'), V('pc', 'Áp bất lợi', 'bar'), V('q', 'Lưu lượng', 'm³/h'), V('lv', 'Mức bể', 'm'), V('kw', 'Công suất', 'kW'), V('wq', 'Clo · đục · pH')),
        h('div', { class: 'fm-sp' }, h('small', {}, 'Áp ra 6 giờ gần nhất'), this.cardSpark),
        h('div', { class: 'fm-info' }, this.cardMeta = h('small', {})),
        h('div', { class: 'fm-act' }, h('button', { class: 'btn primary', type: 'button', onclick: () => a.openStation(r.sid, '3d') }, 'Mở mô phỏng 3D'), h('button', { class: 'btn', type: 'button', onclick: () => a.openStation(r.sid, 'hmi') }, 'Mở HMI')),
        h('details', { class: 'fm-try' }, h('summary', {}, 'Giả lập sự cố tại trạm này'), h('div', { class: 'fm-grid2' },
          inj('Ngắt 4G', { type: 'link_down' }), inj('Khôi phục 4G', { type: 'link_up' }), inj('Vỡ ống 10 m³/h', { type: 'burst', q_m3h: 10, until_h: hrs(4) }), inj('Nước nguồn đục', { type: 'inflow_quality', param: 'ntu', value: 12, until_h: hrs(3) }),
          inj('Hỏng bơm P-01', { type: 'pump_fault', pump: 0 }), inj('Sửa bơm P-01', { type: 'pump_repair', pump: 0 }), inj('Mini PC treo', { type: 'gateway_fail' }), inj('Khởi động lại mini PC', { type: 'gateway_restore' }))));
    }
    const V = this.cardV, set = (k, t) => { if (V[k]._t !== t) { V[k]._t = t; V[k].textContent = t; } };
    set('p', fmt(r.p, 2)); set('pc', fmt(Math.max(0, r.p_crit), 2)); set('q', fmt(r.q, 1)); set('lv', fmt(r.level, 2)); set('kw', fmt(r.kw, 2)); set('wq', `${fmt(r.cl, 2)} · ${fmt(r.ntu, 2)} · ${fmt(r.ph, 1)}`);
    this.cardChip.className = 'chip ' + (r.status === 'crit' ? 'critical' : r.status === 'warn' ? 'warning' : r.status === 'sync' ? 'info' : r.status === 'ok' ? 'good' : 'off'); this.cardChip.textContent = FLEET_STATUS[r.status].label;
    this.cardWhy.textContent = this.reason(r);
    const strat = S0.repo?.[S0.reported ?? S0.target]?.strategy;
    this.cardMeta.textContent = `Chế độ ${MODE_NAME[r.mode]} · kịch bản v${r.version}${strat ? ' (' + (strat === 'predictive' ? 'dự báo' : 'ngưỡng') + ')' : ''} · ${r.online ? 'dữ liệu cách ' + Math.round(r.age ?? 0) + ' s' : 'đang mất kết nối'}`;
    // đường áp 6 giờ gần nhất (đã giản lược)
    const hs = a.net.smart[r.i].hist.data, t1 = hs.t.length, t0 = Math.max(0, t1 - 2160), step = Math.max(1, Math.floor((t1 - t0) / 60)), pts = [];
    let lo = 1.5, hi = 4.2; for (let i = t0; i < t1; i += step) { const v = hs.p_out[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    for (let i = t0, j = 0; i < t1; i += step, j++) { const v = hs.p_out[i]; if (Number.isFinite(v)) pts.push(`${(j * 240 / 60).toFixed(1)},${(44 - (v - lo) / (hi - lo) * 40 - 2).toFixed(1)}`); }
    this.cardSpark.querySelector('.ln').setAttribute('points', pts.join(' '));
    const y = (v) => (44 - (v - lo) / (hi - lo) * 40 - 2).toFixed(1);
    const l1 = this.cardSpark.querySelector('.lo'), l2 = this.cardSpark.querySelector('.hi'); l1.setAttribute('y1', y(1.4)); l1.setAttribute('y2', y(1.4)); l2.setAttribute('y1', y(4.0)); l2.setAttribute('y2', y(4.0));
  }
}
