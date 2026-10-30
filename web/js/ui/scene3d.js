// Cảnh 3D trạm bơm tăng áp (Three.js). Đơn vị: mét. Trục y hướng lên.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/CSS2DRenderer.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const css = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const PRIMARY = new Set(['T-01', 'P-01', 'P-02', 'FT-101', 'PT-101', 'MV-02', 'AIT-202', 'CP-01', 'CP-02', 'MPC-01', 'MANG-LUOI', 'LT-101']);
const CTRL = new Set(['P-01', 'P-02', 'MV-02']); // thiết bị điều khiển TAY được – nhãn ưu tiên khi chồng nhau
const B3 = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
const ovl = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
// Màu phân loại phạm vi thiết bị: hiện trạng / giải pháp đưa vào / khuyến nghị bổ sung
const CONTAINERS = new Set(['CP-01', 'CP-02']);
export const SCOPE_COLOR = { hien_trang: 0xa0703c, giai_phap: 0x7a5af5, khuyen_nghi: 0x0f9fb0 };
const fmt = (v, nd = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(nd).replace('.', ','));
// Tô sáng thiết bị: rê chuột (hov) và thiết bị đang mở bảng điều khiển (sel, nhấp nháy nhẹ)
const HL = { hov: [0x4f9fff, 0.3], sel: [0x2f8fff, 0.4] };
// Màu vòng trạng thái dưới bơm: chạy / dừng / lỗi / chế độ TAY
const RING = { run: 0x19b85a, stop: 0x8a948f, fault: 0xe0443c, man: 0xf0a20a };
// Hướng nhìn ưu tiên khi bay camera tới thiết bị gắn tường (góc phương vị quanh trục y; 0 = nhìn từ phía +z)
const FACING = {};
for (const t of ['CP-01', 'VFD-01', 'VFD-02', 'WDR-01', 'EM-101', 'SA-01/02', 'AIT-201', 'AIT-202', 'AIT-203']) FACING[t] = 0;
for (const t of ['CP-02', 'MPC-01', 'IO-01', 'RT-01', 'UPS-01', 'HMI-01']) FACING[t] = -Math.PI / 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Hạt nước chạy dọc một đường gấp khúc – tốc độ hiển thị tỉ lệ vận tốc nước thật. */
class FlowPath {
  constructor(scene, points, { spacing = 0.32, radius = 0.05, color = 0x4aa3ff } = {}) {
    this.pts = points; this.spacing = spacing;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.len = this.cum[this.cum.length - 1];
    this.n = Math.max(2, Math.floor(this.len / spacing));
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }), this.n);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.offset = 0; this.tmp = new THREE.Object3D(); this.p = new THREE.Vector3();
    this.update(0, 0);
  }
  at(d) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1];
    return this.p.copy(a).lerp(b, seg > 0 ? (d - this.cum[i - 1]) / seg : 0);
  }
  update(dt, speed) {
    this.mesh.visible = speed > 0.01;
    if (!this.mesh.visible) return;
    this.offset = (this.offset + speed * dt) % this.spacing;
    for (let k = 0; k < this.n; k++) {
      const d = (k * this.spacing + this.offset) % this.len;
      this.tmp.position.copy(this.at(d));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(k, this.tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  setColor(c) { this.mesh.material.color.set(c); }
}

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext('2d'), tex };
}

export class StationScene {
  constructor(container, components, onPick) {
    this.el = container; this.onPick = onPick; this.components = components;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    // isolation: z-index từng nhãn (CSS2DRenderer sắp theo độ sâu) không vượt lên các lớp phủ của khung 3D
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', isolation: 'isolate' });
    container.appendChild(this.labelRenderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.camera.position.set(0.5, 11.5, 17.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-1.5, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3; this.controls.maxDistance = 90;
    this.pickables = []; this.labels = {}; this.labelMode = 1; this.flows = {}; this.anim = { rot: [0, 0], t: 0 };
    this.mat = {}; this.focusBox = {};
    this.compName = new Map((components || []).map((c) => [c.tag, c.name]));
    this._materials();
    this._lights();
    this._build();
    // chỉ mục thiết bị -> các mesh; lưu vật liệu gốc một lần (lọc phạm vi và tô sáng đều dựa vào mat0)
    this.byTag = new Map();
    for (const o of this.pickables) {
      if (!o.userData.mat0) o.userData.mat0 = o.material;
      const t = o.userData.tag;
      if (!this.byTag.has(t)) this.byTag.set(t, []);
      this.byTag.get(t).push(o);
    }
    this._hlOn = []; this._hlCache = new Map(); this._hover = null; this._sel = null; this._anchor = new Map();
    this._pv = new THREE.Vector3(); this._pc = new THREE.Vector3(); this._box3 = new THREE.Box3();
    this._selRing();
    this.applyTheme();
    this.raycaster = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; this._setHover(null); });
    cv.addEventListener('pointerup', (e) => {
      if (!this._down) return;
      // kéo = người dùng tự xoay/dời camera: từ đó không tự đặt lại góc nhìn khi khung đổi
      if (Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 5) { this._moved = true; this._mv = (this._mv || 0) + 1; return; }
      this._pick(e);
    });
    cv.addEventListener('wheel', () => { this._moved = true; this._mv = (this._mv || 0) + 1; }, { passive: true });
    this.view0 = 'overview'; this._moved = false; // góc nhìn đặt sẵn đang dùng (null sau khi bay tới thiết bị)
    this._initHover();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.tween = null;
  }

  _materials() {
    const M = (o) => new THREE.MeshStandardMaterial(o);
    this.mat.concrete = M({ color: 0xb9bdb8, roughness: 0.95 });
    this.mat.concreteGlass = M({ color: 0xb9bdb8, roughness: 0.95, transparent: true, opacity: 0.18, depthWrite: false });
    this.mat.floor = M({ color: 0xc9ccc7, roughness: 1 });
    this.mat.ground = M({ color: 0x9fae95, roughness: 1 });
    this.mat.pipe = M({ color: 0x3f7fb5, roughness: 0.45, metalness: 0.35 });
    this.mat.pipeDark = M({ color: 0x5c6460, roughness: 0.6, metalness: 0.3 });
    this.mat.pump = M({ color: 0x2f5d8a, roughness: 0.4, metalness: 0.5 });
    this.mat.motor = M({ color: 0x7c8a93, roughness: 0.45, metalness: 0.6 });
    this.mat.steel = M({ color: 0xa8b0b5, roughness: 0.35, metalness: 0.8 });
    this.mat.base = M({ color: 0x3b4246, roughness: 0.7, metalness: 0.4 });
    this.mat.cabinet = M({ color: 0xd9dcd6, roughness: 0.55, metalness: 0.2 });
    this.mat.glass = M({ color: 0x9fb8c8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    this.mat.black = M({ color: 0x1d2224, roughness: 0.6 });
    this.mat.yellow = M({ color: 0xe9b200, roughness: 0.5 });
    this.mat.red = M({ color: 0xc23a33, roughness: 0.5 });
    this.mat.house = M({ color: 0xe8dfcf, roughness: 0.9 });
    this.mat.roof = M({ color: 0x9a5a40, roughness: 0.8 });
    this.mat.water = new THREE.MeshPhysicalMaterial({ color: 0x3d8fd1, roughness: 0.15, transparent: true, opacity: 0.62, depthWrite: false });
    this.mat.ht = M({ color: 0xd2d6da, roughness: 0.35, metalness: 0.5 });
  }
  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f86, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(10, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -26, right: 30, top: 18, bottom: -18, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }
  _box(w, h, d, mat, x, y, z, { cast = true, tag = null, parent = null } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true;
    if (tag) this._tag(m, tag);
    (parent || this.scene).add(m);
    return m;
  }
  _cyl(r, len, mat, pos, axis = 'y', { tag = null, seg = 24, parent = null, r2 = null } = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, len, seg), mat);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    m.position.copy(pos); m.castShadow = true; m.receiveShadow = true;
    if (tag) this._tag(m, tag);
    (parent || this.scene).add(m);
    return m;
  }
  _tag(obj, tag) { obj.userData.tag = tag; this.pickables.push(obj); }
  /** Ống thẳng theo đường gấp khúc + cút nối. */
  _pipe(points, r = 0.08, mat = this.mat.pipe, tag = null) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 18), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      m.castShadow = true; m.receiveShadow = true;
      if (tag) this._tag(m, tag);
      this.scene.add(m);
      if (i < points.length - 1) {
        const j = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 14, 10), mat);
        j.position.copy(b); j.castShadow = true;
        this.scene.add(j);
      }
    }
  }
  _flange(pos, axis, r = 0.14) { return this._cyl(r, 0.05, this.mat.steel, pos, axis); }
  _label(tag, pos, text = tag) {
    const div = document.createElement('div');
    div.className = 'tag3d';
    div.innerHTML = `<b>${tag}</b><span></span>`;
    div.addEventListener('click', () => this.onPick && this.onPick(tag));
    div.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this._setHover(tag, 'label', div); });
    div.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this._hover === tag) this._setHover(null); });
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    this.scene.add(obj);
    this.labels[tag] = { obj, div, span: div.querySelector('span') };
    if (text !== tag) this.labels[tag].span.textContent = text;
    return obj;
  }
  /**
   * Chọn nhãn hiển thị rồi gỡ chồng chéo trên màn hình (gọi vài khung hình một lần, kể cả khi camera đang bay):
   * xếp theo ưu tiên đang chọn/rê chuột > báo động > điều khiển được > chính > còn lại; nhãn đè lên nhãn đã đặt
   * hoặc nằm dưới HUD/dock/thanh trên/bảng nổi (this.occluders) thì dời lên/xuống (nhãn chính tới hai bậc), không được thì ẩn
   * (visibility: hidden – không nhận cú nhấp, vẫn đo được kích thước).
   */
  _labelVisibility() {
    const cam = this.camera, W = this._w || 1, H = this._h || 1, v = this._pc, cands = [];
    const remeasure = (this._lv || 0) % 120 === 0; // phông chữ tải xong có thể đổi bề rộng
    for (const [tag, l] of Object.entries(this.labels)) {
      const cl = l.div.classList, alarm = cl.contains('alarm');
      const near = cam.position.distanceTo(l.obj.position) < 9.5;
      const show = this.labelMode === 2 || (this.labelMode === 1 && (PRIMARY.has(tag) || near)) || alarm;
      if (cl.contains('hide') === show) cl.toggle('hide', !show);
      if (!show || cl.contains('ctl-hide') || cl.contains('scope-off')) { this._dcSet(l, false, 0); continue; }
      v.setFromMatrixPosition(l.obj.matrixWorld).project(cam);
      if (v.z < -1 || v.z > 1) continue;
      const pr = tag === this._sel || tag === this._hover ? 0 : alarm ? 1 : CTRL.has(tag) ? 2 : PRIMARY.has(tag) ? 3 : 4;
      cands.push({ l, pr, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, dist: cam.position.distanceToSquared(l.obj.position) });
    }
    // đọc kích thước (một lần dàn trang) chỉ cho nhãn vừa đổi chữ
    for (const c of cands) {
      const l = c.l;
      if (l.w === undefined || l.dirty || remeasure) { const w = l.div.offsetWidth; if (w) { l.w = w; l.h = l.div.offsetHeight; l.dirty = false; } }
      c.w = l.w ?? 8 * (l.div.textContent.length + 2); c.h = l.h ?? 20;
    }
    const occ = this.occluders ? this.occluders() : this._insetRects(W, H);
    cands.sort((a, b) => a.pr - b.pr || a.dist - b.dist);
    const placed = [], vp = { l: 0, t: 0, r: W, b: H };
    for (const c of cands) {
      const step = c.h + 3, a = c.w * c.h;
      let dy = null, r0 = null;
      for (const d of c.pr <= 3 ? [0, -step, step, -2 * step, 2 * step] : [0, -step, step]) {
        const r = { l: c.x - c.w / 2 - 2, r: c.x + c.w / 2 + 2, t: c.y - c.h / 2 + d - 1, b: c.y + c.h / 2 + d + 1 };
        // phần ra ngoài khung hoặc nằm dưới lớp giao diện
        let hid = (r.r - r.l) * (r.b - r.t) - ovl(r, vp);
        if (occ) for (const o of occ) hid += ovl(r, o);
        if (hid > 0.1 * a) continue;
        if (!r0) r0 = { r, d };
        if (placed.some((p) => ovl(r, p) > 4)) continue;
        dy = d; placed.push(r); break;
      }
      // nhãn báo động / đang chọn: không ẩn vì chồng nhãn khác, chỉ ẩn khi bị lớp giao diện che
      if (dy === null && c.pr <= 1 && r0) { dy = r0.d; placed.push(r0.r); }
      this._dcSet(c.l, dy === null, dy ?? 0);
    }
  }
  _dcSet(l, hid, dy) {
    if (l.dc !== hid) { l.dc = hid; l.div.classList.toggle('dc', hid); }
    if (l.dy !== dy) { l.dy = dy; l.div.style.translate = dy ? `0 ${dy}px` : ''; }
  }
  /** Vùng bị che theo app.insets khi không có hàm occluders (HUD trái, dock phải, thanh trên, dock dưới). */
  _insetRects(W, H) {
    const I = this.insX;
    if (!I) return null;
    const r = Math.max(I.r, I.sr || 0), b = Math.max(I.b, I.sb || 0);
    return [{ l: 0, t: 0, r: W, b: I.t }, { l: 0, t: 0, r: I.l, b: H }, { l: W - r, t: 0, r: W, b: H }, { l: 0, t: H - b, r: W, b: H }].filter((o) => o.r > o.l && o.b > o.t);
  }
  setLabel(tag, text, alarm = false) {
    const l = this.labels[tag];
    if (!l) return;
    if (l.last !== text) { l.span.textContent = text; l.last = text; l.dirty = true; if (tag === this._hover) this._tipText(); }
    if (l.div.classList.contains('alarm') !== alarm) { l.div.classList.toggle('alarm', alarm); l.dirty = true; }
  }
  /** Ẩn/hiện nhãn 3D của một thiết bị (khi dấu điều khiển TAY thay chỗ nhãn). */
  setLabelHidden(tag, on) { const l = this.labels[tag]; if (l) l.div.classList.toggle('ctl-hide', Boolean(on)); }
  /** Tô màu theo phạm vi: 'all' | 'hien_trang' | 'giai_phap' | 'khuyen_nghi'. Thiết bị khác phạm vi được làm mờ. */
  setScopeFilter(scope, scopeOf) {
    this.scope = scope;
    this._clearHL(); // trả vật liệu tô sáng về trước khi đổi vật liệu theo phạm vi, tô lại sau
    this._tint = this._tint || new Map(); this._ghost = this._ghost || new Map();
    for (const o of this.pickables) {
      if (!o.userData.mat0) o.userData.mat0 = o.material;
      const m0 = o.userData.mat0, sc = scopeOf(o.userData.tag);
      if (scope === 'all') { o.material = m0; continue; }
      if (sc === scope) {
        const k = m0.uuid + scope;
        if (!this._tint.has(k)) {
          const m = m0.clone();
          if (m.emissive) { m.emissive = new THREE.Color(SCOPE_COLOR[scope]); m.emissiveIntensity = 0.55; } else m.color = new THREE.Color(SCOPE_COLOR[scope]);
          if (m0.transparent) m.opacity = Math.max(0.35, m0.opacity);
          m.userData.src = m0;
          this._tint.set(k, m);
        }
        o.material = this._tint.get(k);
      } else {
        if (!this._ghost.has(m0.uuid)) { const m = m0.clone(); m.transparent = true; m.opacity = 0.14; m.depthWrite = false; m.userData.src = m0; this._ghost.set(m0.uuid, m); }
        o.material = this._ghost.get(m0.uuid);
      }
    }
    for (const [tag, l] of Object.entries(this.labels)) {
      const sc = scopeOf(tag);
      l.div.dataset.scope = sc || '';
      l.div.classList.toggle('scope-off', scope !== 'all' && sc !== scope);
    }
    this._applyHL();
  }
  /** Bản sao vật liệu khi lọc phạm vi phải theo kịp thay đổi màu của bản gốc (độ đục nước, giao diện sáng/tối). */
  _syncScopeMats() {
    for (const m of this._tint.values()) { const s = m.userData.src; m.color.copy(s.color); if (m.map !== s.map) m.map = s.map; }
    for (const m of this._ghost.values()) { const s = m.userData.src; m.color.copy(s.color); if (s.emissive && m.emissive) m.emissive.copy(s.emissive); }
  }
  /** 0 = ẩn, 1 = nhãn chính + nhãn gần camera, 2 = tất cả */
  setLabelMode(m) { this.labelMode = m; this._labelVisibility(); }

  _build() {
    const S = this.scene;
    // nền & sàn
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 320), this.mat.ground);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; S.add(ground);
    this.ground = ground;
    this._environment();
    this._box(13.4, 0.2, 9.4, this.mat.floor, 3.0, -0.1, 0, { cast: false });
    this._box(13.4, 3.2, 0.25, this.mat.concrete, 3.0, 1.6, -4.7);
    this._box(0.25, 3.2, 9.4, this.mat.concrete, 9.7, 1.6, 0);
    // ---- bể chứa T-01 ----
    const tx0 = -12, tx1 = -4, tz0 = -3, tz1 = 3, th = 4.2, w = 0.3;
    this._box(tx1 - tx0 + 2 * w, 0.3, tz1 - tz0 + 2 * w, this.mat.concrete, (tx0 + tx1) / 2, -0.15, 0, { tag: 'T-01' });
    this._box(tx1 - tx0 + 2 * w, th, w, this.mat.concrete, (tx0 + tx1) / 2, th / 2, tz0 - w / 2, { tag: 'T-01' });
    this._box(w, th, tz1 - tz0, this.mat.concrete, tx0 - w / 2, th / 2, 0, { tag: 'T-01' });
    this._box(w, th, tz1 - tz0, this.mat.concrete, tx1 + w / 2, th / 2, 0, { tag: 'T-01' });
    this._box(tx1 - tx0 + 2 * w, th, w, this.mat.concreteGlass, (tx0 + tx1) / 2, th / 2, tz1 + w / 2, { cast: false });
    // sàn thao tác trên bể
    this._box(2.0, 0.08, tz1 - tz0 + 2 * w, this.mat.steel, -6.2, th + 0.04, 0);
    const water = new THREE.Mesh(new THREE.BoxGeometry(tx1 - tx0 - 0.04, 1, tz1 - tz0 - 0.04), this.mat.water);
    water.position.set((tx0 + tx1) / 2, 0.5, 0);
    water.renderOrder = 2;
    this._tag(water, 'T-01');
    S.add(water);
    this.water = water;
    this.tankH = th;
    // vạch mức trên thành bể (0,6 / 1,2 / 3,8 m)
    for (const [lv, col] of [[0.6, 0xd03b3b], [1.2, 0xfab219], [3.8, 0x4a5753]]) {
      this._box(0.04, 0.04, tz1 - tz0, new THREE.MeshBasicMaterial({ color: col }), tx1 - 0.02, lv, 0, { cast: false });
    }
    // cảm biến mức LT-101
    this._cyl(0.08, 0.25, this.mat.yellow, V(-6.2, th + 0.25, 0.4), 'y', { tag: 'LT-101' });
    this._cyl(0.12, 0.12, this.mat.yellow, V(-6.2, th + 0.06, 0.4), 'y', { tag: 'LT-101', r2: 0.06 });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 6), new THREE.MeshBasicMaterial({ color: 0xe9b200, transparent: true, opacity: 0.6 }));
    beam.position.set(-6.2, 2, 0.4); S.add(beam); this.beam = beam;
    this._label('LT-101', V(-6.2, th + 0.7, 0.4));
    this._label('T-01', V(-8, th + 0.5, 2.4));
    // ống cấp vào + van phao FV-01 + đồng hồ FT-100
    const inPts = [V(-16, 3.9, -5.2), V(-10, 3.9, -5.2), V(-10, 3.9, -2.2), V(-10, 3.0, -2.2)];
    this._pipe(inPts, 0.07, this.mat.pipe, 'FV-01');
    this._cyl(0.13, 0.32, this.mat.steel, V(-13, 3.9, -5.2), 'x', { tag: 'FT-100' });
    this._box(0.22, 0.18, 0.12, this.mat.black, -13, 4.15, -5.2, { tag: 'FT-100' });
    this._label('FT-100', V(-13, 4.6, -5.2));
    this._box(0.3, 0.26, 0.3, this.mat.red, -10, 3.0, -2.2, { tag: 'FV-01' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }));
    ball.position.set(-9.2, 3, -2.2); S.add(ball); this.floatBall = ball; this._tag(ball, 'FV-01');
    this.floatArm = this._cyl(0.02, 0.8, this.mat.steel, V(-9.6, 3, -2.2), 'x');
    this._label('FV-01', V(-10, 3.55, -1.6));
    this.flows.inlet = new FlowPath(S, inPts.concat([V(-10, 2.2, -2.2)]), { radius: 0.045 });
    // van xả đáy VX-01
    const drPts = [V(-4, 0.25, 2.2), V(-2.4, 0.25, 2.2), V(-2.4, -0.05, 3.4)];
    this._pipe(drPts, 0.07, this.mat.pipeDark, 'VX-01');
    this._box(0.24, 0.24, 0.24, this.mat.red, -3.2, 0.25, 2.2, { tag: 'VX-01' });
    this.drainWheel = this._cyl(0.14, 0.03, this.mat.yellow, V(-3.2, 0.48, 2.2), 'y', { tag: 'VX-01' });
    this._label('VX-01', V(-3.2, 0.9, 2.4));
    this.flows.drain = new FlowPath(S, drPts, { radius: 0.04, color: 0x7a8a8a });

    // ---- ống hút & cụm bơm ----
    const zs = [-1.6, 1.6];
    this._pipe([V(-4, 0.55, 0), V(-0.6, 0.55, 0)], 0.11);
    this._pipe([V(-0.6, 0.55, -1.6), V(-0.6, 0.55, 1.6)], 0.11);
    this.pumpObj = [];
    const padTex = this._padTexture();
    zs.forEach((z, i) => {
      const tag = i === 0 ? 'P-01' : 'P-02';
      this._pipe([V(-0.6, 0.55, z), V(0.75, 0.55, z)], 0.09, this.mat.pipe, tag);
      this._flange(V(0.72, 0.55, z), 'x', 0.15);
      // van chặn hút (tay quay)
      this._cyl(0.13, 0.03, this.mat.yellow, V(0.1, 0.8, z), 'y');
      this._box(1.9, 0.14, 0.8, this.mat.base, 1.75, 0.07, z, { tag });
      // vòng trạng thái phát sáng trên sàn quanh bệ bơm
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.6), new THREE.MeshBasicMaterial({ map: padTex, color: RING.stop, transparent: true, depthWrite: false, opacity: 0.8 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(1.7, 0.012, z); pad.renderOrder = 1; this.scene.add(pad);
      const motorMat = this.mat.motor.clone(); // riêng từng bơm để phát sáng nhẹ khi chạy
      const vol = this._cyl(0.36, 0.3, this.mat.pump, V(1.0, 0.55, z), 'x', { tag, seg: 32 });
      this._cyl(0.24, 0.22, this.mat.pump, V(1.28, 0.55, z), 'x', { tag });
      this._cyl(0.06, 0.3, this.mat.steel, V(1.52, 0.55, z), 'x');
      const motor = this._cyl(0.27, 0.8, motorMat, V(2.05, 0.55, z), 'x', { tag, seg: 28 });
      for (let k = 0; k < 8; k++) this._box(0.75, 0.04, 0.04, motorMat, 2.05, 0.55 + 0.27 * Math.cos(k * Math.PI / 4), z + 0.27 * Math.sin(k * Math.PI / 4), { tag });
      this._box(0.36, 0.26, 0.3, motorMat, 2.05, 0.9, z, { tag });
      this.focusBox[tag] = new THREE.Box3(V(0.55, 0, z - 0.5), V(2.7, 1.3, z + 0.5));
      // quạt làm mát (quay theo tần số)
      const fan = new THREE.Group();
      fan.position.set(2.52, 0.55, z);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.12, 24, 1, true), this.mat.motor);
      cover.rotation.z = Math.PI / 2; fan.add(cover); this._tag(cover, tag);
      const blades = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.38, 0.07), this.mat.black);
        b.rotation.x = k * 2 * Math.PI / 5; blades.add(b);
      }
      fan.add(blades);
      this.scene.add(fan);
      const coupling = this._cyl(0.08, 0.1, this.mat.yellow, V(1.6, 0.55, z), 'x');
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000 }));
      lamp.position.set(2.05, 1.1, z); this.scene.add(lamp);
      // ống đẩy đứng + van một chiều + đồng hồ + van chặn
      this._pipe([V(1.0, 0.92, z), V(1.0, 2.2, z)], 0.08, this.mat.pipe, tag);
      this._box(0.22, 0.26, 0.22, this.mat.base, 1.0, 1.3, z, { tag: 'CV-01/02' });
      this._cyl(0.13, 0.03, this.mat.yellow, V(1.0, 1.85, z + 0.18), 'z');
      // đồng hồ kim PI
      const gauge = new THREE.Group();
      gauge.position.set(1.0, 1.62, z + (i === 0 ? 0.2 : -0.2));
      const dialTex = this._dialTexture();
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), new THREE.MeshBasicMaterial({ map: dialTex }));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 32), this.mat.steel);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.1, 0.004), this.mat.red);
      needle.geometry.translate(0, 0.045, 0.004);
      gauge.add(face, rim, needle);
      if (i === 1) gauge.rotation.y = Math.PI;
      this._tag(face, 'PI-101/102');
      this.scene.add(gauge);
      this.pumpObj.push({ blades, coupling, lamp, needle, vol, motor, pad, motorMat });
      this._label(tag, V(1.8, 1.45, z + (i === 0 ? -0.6 : 0.6)));
    });
    this._label('PI-101/102', V(1.0, 1.95, 0));
    // góp đẩy & đường đẩy chính
    this._pipe([V(1.0, 2.2, -1.6), V(1.0, 2.2, 1.6)], 0.1);
    const hdr = [V(1.0, 2.2, 0), V(9.9, 2.2, 0), V(10.6, 2.2, 0), V(10.6, 0.3, 0), V(30, 0.3, 0)];
    this._pipe(hdr, 0.1, this.mat.pipe, 'MANG-LUOI');
    // bình tích áp HT-01
    this._pipe([V(3.2, 2.2, 0), V(3.2, 2.2, -2.3), V(3.2, 1.62, -2.3)], 0.05);
    const ht = this._cyl(0.42, 1.1, this.mat.ht, V(3.2, 0.95, -2.3), 'y', { tag: 'HT-01', seg: 32 });
    const cap1 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat.ht);
    cap1.position.set(3.2, 1.5, -2.3); this._tag(cap1, 'HT-01'); S.add(cap1);
    const cap2 = cap1.clone(); cap2.rotation.x = Math.PI; cap2.position.y = 0.4; S.add(cap2);
    this._box(0.6, 0.06, 0.6, this.mat.base, 3.2, 0.2, -2.3);
    const htw = new THREE.Mesh(new THREE.CylinderGeometry(0.405, 0.405, 1, 24), new THREE.MeshBasicMaterial({ color: 0x3d8fd1, transparent: true, opacity: 0.5 }));
    htw.position.set(3.2, 0.5, -2.3); S.add(htw); this.htWater = htw;
    this._label('HT-01', V(3.2, 2.0, -2.9));
    // van an toàn PSV-01
    this._pipe([V(4.2, 2.3, 0), V(4.2, 2.75, 0), V(4.2, 2.75, 0.7), V(4.2, 0.1, 0.7)], 0.04, this.mat.pipeDark, 'PSV-01');
    this._cyl(0.09, 0.28, this.mat.red, V(4.2, 2.55, 0), 'y', { tag: 'PSV-01' });
    this._label('PSV-01', V(4.2, 3.1, 0.2));
    this.flows.relief = new FlowPath(S, [V(4.2, 2.75, 0.7), V(4.2, 0.1, 0.7)], { radius: 0.035, color: 0x7a8a8a });
    // cảm biến áp lực PT-101, PT-102
    for (const [x, tag] of [[5.0, 'PT-101'], [5.5, 'PT-102']]) {
      this._cyl(0.02, 0.2, this.mat.steel, V(x, 2.4, 0), 'y');
      this._cyl(0.07, 0.18, this.mat.yellow, V(x, 2.58, 0), 'y', { tag });
      this._box(0.12, 0.1, 0.1, this.mat.black, x, 2.72, 0, { tag });
      this._label(tag, V(x, 3.05 + (tag === 'PT-102' ? 0.3 : 0), 0));
    }
    // đồng hồ lưu lượng điện từ FT-101
    this._cyl(0.17, 0.5, this.mat.steel, V(6.4, 2.2, 0), 'x', { tag: 'FT-101' });
    this._flange(V(6.13, 2.2, 0), 'x', 0.2); this._flange(V(6.67, 2.2, 0), 'x', 0.2);
    this._box(0.28, 0.22, 0.14, this.mat.black, 6.4, 2.55, 0, { tag: 'FT-101' });
    this._label('FT-101', V(6.4, 2.95, 0));
    // van điện đầu ra MV-02
    this._flange(V(7.8, 2.2, 0), 'x', 0.18);
    this._box(0.3, 0.32, 0.3, this.mat.base, 7.8, 2.62, 0, { tag: 'MV-02' });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.015, 20), this.mat.steel);
    disc.position.set(7.8, 2.2, 0.0); disc.rotation.z = Math.PI / 2; S.add(disc); this.mvDisc = disc;
    this.mvLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0ca30c, emissive: 0x0ca30c, emissiveIntensity: 0.6 }));
    this.mvLamp.position.set(7.8, 2.82, 0.16); S.add(this.mvLamp);
    // chỉ thị vị trí trên nóc bộ truyền động: mũi tên song song ống = mở, vuông góc = đóng; vành màu theo trạng thái
    this._cyl(0.12, 0.025, this.mat.black, V(7.8, 2.79, 0), 'y', { tag: 'MV-02' });
    const arrow = new THREE.Group(); arrow.position.set(7.8, 2.81, 0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.018, 0.035), this.mat.yellow);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 12), this.mat.yellow);
    tip.rotation.z = -Math.PI / 2; tip.position.x = 0.115;
    arrow.add(shaft, tip); S.add(arrow); this.mvArrow = arrow;
    this.mvRing = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 8, 40), new THREE.MeshBasicMaterial({ color: 0x0ca30c }));
    this.mvRing.rotation.x = Math.PI / 2; this.mvRing.position.set(7.8, 2.8, 0); S.add(this.mvRing);
    this.focusBox['MV-02'] = new THREE.Box3(V(7.45, 1.95, -0.3), V(8.15, 2.95, 0.3));
    this._label('MV-02', V(7.8, 3.15, 0));
    // dòng chảy
    this.flows.suction = [0, 1].map((i) => new FlowPath(S, [V(-4.1, 0.55, 0), V(-0.6, 0.55, 0), V(-0.6, 0.55, zs[i]), V(0.7, 0.55, zs[i])], { radius: 0.05 }));
    this.flows.riser = [0, 1].map((i) => new FlowPath(S, [V(1.0, 0.95, zs[i]), V(1.0, 2.2, zs[i]), V(1.0, 2.2, 0)], { radius: 0.05 }));
    this.flows.outlet = new FlowPath(S, hdr, { radius: 0.055 });
    // ---- bảng phân tích chất lượng nước ----
    this._box(3.2, 1.6, 0.06, this.mat.cabinet, 5.8, 1.75, -4.52);
    // ống lấy mẫu đi sát sàn rồi lên đáy máy phân tích (không vắt ngang trước màn hình khi nhìn bảng phân tích)
    this._pipe([V(5.8, 2.2, 0), V(5.8, 0.06, -0.05), V(5.8, 0.06, -4.42), V(5.8, 1.38, -4.42)], 0.015, this.mat.steel);
    this.aitScreens = {};
    [['AIT-201', 4.7], ['AIT-202', 5.8], ['AIT-203', 6.9]].forEach(([tag, x]) => {
      this._box(0.8, 0.95, 0.22, this.mat.cabinet, x, 1.85, -4.38, { tag });
      const sc = canvasTex(256, 160);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshBasicMaterial({ map: sc.tex }));
      scr.position.set(x, 1.98, -4.265); this._tag(scr, tag); S.add(scr);
      this.aitScreens[tag] = sc;
      this._label(tag, V(x, 2.65, -4.2));
    });
    // ---- tủ động lực CP-01 (HIỆN TRẠNG: MCCB, 2 biến tần; cải tạo thêm công tắc Tay/0/Tự động, rơ-le watchdog, đồng hồ điện) ----
    const cx = 8.55, cz = -4.2;
    this._box(1.8, 2.1, 0.6, this.mat.cabinet, cx, 1.05, cz, { tag: 'CP-01' });
    const door = this._box(1.7, 1.95, 0.02, this.mat.glass, cx, 1.07, cz + 0.31, { cast: false });
    door.userData.tag = 'CP-01';
    for (let k = 0; k < 4; k++) this._box(0.12, 0.22, 0.12, this.mat.black, cx - 0.72 + k * 0.16, 1.75, cz + 0.12, { tag: 'CP-01' }); // MCCB
    this.vfdScreens = [];
    [0, 1].forEach((k) => {
      this._box(0.36, 0.62, 0.2, this.mat.base, cx + 0.1 + k * 0.45, 1.25, cz + 0.1, { tag: k === 0 ? 'VFD-01' : 'VFD-02' });
      const sc = canvasTex(128, 96);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), new THREE.MeshBasicMaterial({ map: sc.tex }));
      scr.position.set(cx + 0.1 + k * 0.45, 1.42, cz + 0.205); this._tag(scr, k === 0 ? 'VFD-01' : 'VFD-02'); S.add(scr);
      this.vfdScreens.push(sc);
    });
    this._box(0.5, 0.32, 0.3, this.mat.black, cx - 0.5, 0.35, cz + 0.05, { tag: 'CP-01' });
    // phần cải tạo bên trong CP-01 (thuộc giải pháp)
    this._box(0.34, 0.16, 0.12, this.mat.yellow, cx - 0.5, 1.2, cz + 0.12, { tag: 'WDR-01' });
    this._box(0.3, 0.2, 0.04, this.mat.black, cx - 0.5, 0.85, cz + 0.33, { tag: 'EM-101' });
    [0, 1].forEach((k) => this._cyl(0.035, 0.05, this.mat.red, V(cx + 0.1 + k * 0.45, 0.72, cz + 0.34), 'z', { tag: 'SA-01/02' }));
    this._label('CP-01', V(cx, 2.45, cz + 0.4));
    this._label('VFD-01', V(cx + 0.1, 1.72, cz + 0.45));
    this._label('VFD-02', V(cx + 0.55, 1.6, cz + 0.55));
    this._label('WDR-01', V(cx - 0.75, 1.32, cz + 0.5));
    this._label('EM-101', V(cx - 0.6, 0.75, cz + 0.55));
    this._label('SA-01/02', V(cx + 0.35, 0.55, cz + 0.6));
    // ---- tủ điều khiển & truyền thông CP-02 (GIẢI PHÁP: mini PC, I/O từ xa, router 4G, UPS, HMI) – treo tường bên, cửa hướng vào gian bơm ----
    const kx = 9.42, kz = -2.55, ky = 1.55;
    this._box(0.3, 1.1, 0.85, this.mat.cabinet, kx, ky, kz, { tag: 'CP-02' });
    const door2 = this._box(0.02, 1.02, 0.78, this.mat.glass, kx - 0.16, ky, kz, { cast: false });
    door2.userData.tag = 'CP-02';
    this._box(0.12, 0.2, 0.3, this.mat.black, kx - 0.04, ky + 0.3, kz - 0.18, { tag: 'MPC-01' });
    this.gwLeds = [];
    for (let k = 0; k < 4; k++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0ca30c, emissive: 0x0ca30c, emissiveIntensity: 0.8 }));
      led.position.set(kx - 0.105, ky + 0.36, kz - 0.29 + k * 0.07); S.add(led); this.gwLeds.push(led);
    }
    for (let k = 0; k < 5; k++) this._box(0.1, 0.16, 0.05, this.mat.steel, kx - 0.02, ky + 0.02, kz - 0.25 + k * 0.065, { tag: 'IO-01' });
    this._box(0.08, 0.12, 0.22, this.mat.cabinet, kx - 0.03, ky + 0.32, kz + 0.2, { tag: 'RT-01' });
    this._box(0.14, 0.2, 0.32, this.mat.base, kx - 0.02, ky - 0.36, kz, { tag: 'UPS-01' });
    // màn cảm ứng HMI-01 trên cửa CP-02
    this.hmi = canvasTex(512, 320);
    const hmi = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.3), new THREE.MeshBasicMaterial({ map: this.hmi.tex }));
    hmi.rotation.y = -Math.PI / 2; hmi.position.set(kx - 0.175, ky - 0.05, kz + 0.12); this._tag(hmi, 'HMI-01'); S.add(hmi);
    // ăng-ten 4G + đèn báo trên nóc CP-02
    this._cyl(0.02, 0.9, this.mat.black, V(kx, ky + 1.0, kz + 0.3), 'y', { tag: 'RT-01' });
    this.rings = [0, 1, 2].map((k) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.011, 6, 32), new THREE.MeshBasicMaterial({ color: 0x0ca30c, transparent: true, opacity: 0.7 }));
      r.position.set(kx, ky + 1.35, kz + 0.3); r.rotation.x = Math.PI / 2; S.add(r); r.userData.k = k; return r;
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x772222, emissive: 0x000000 }));
    this.beacon.position.set(kx, ky + 0.63, kz - 0.25); S.add(this.beacon); this._tag(this.beacon, 'CP-02');
    this._label('CP-02', V(kx - 0.2, ky + 0.85, kz - 0.2));
    this._label('MPC-01', V(kx - 0.35, ky + 0.42, kz - 0.45));
    this._label('IO-01', V(kx - 0.35, ky + 0.05, kz - 0.5));
    this._label('RT-01', V(kx, ky + 1.6, kz + 0.3));
    this._label('UPS-01', V(kx - 0.3, ky - 0.42, kz + 0.25));
    this._label('HMI-01', V(kx - 0.3, ky - 0.25, kz + 0.45));
    this._brandSigns(kx, ky, kz);
    // ---- khu dân cư (mạng lưới DMA-A) ----
    this.houses = [];
    const hs = [[17, -4, 2], [17, 4, 2], [20.5, -4.5, 1], [20.5, 4, 2], [24, -4, 2], [24, 4.5, 1], [27.5, -3.5, 2], [29, 5, 3]];
    hs.forEach(([x, z, fl], i) => {
      const h = fl * 2.6;
      const hill = i === hs.length - 1 ? 1.2 : 0;
      if (hill) this._box(5, hill, 5, this.mat.ground, x, hill / 2 - 0.02, z, { cast: false });
      this._box(3.2, h, 3.4, this.mat.house, x, hill + h / 2, z, { tag: 'MANG-LUOI' });
      this._box(3.4, 0.2, 3.6, this.mat.roof, x, hill + h + 0.1, z);
      const tank = this._cyl(0.45, 0.9, this.mat.steel, V(x + 0.8, hill + h + 0.65, z), 'y');
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1, 16), new THREE.MeshBasicMaterial({ color: 0x3d8fd1 }));
      fill.position.set(x + 0.8, hill + h + 0.2, z); this.scene.add(fill);
      this._pipe([V(x, 0.3, 0), V(x, 0.3, z * 0.55)], 0.04);
      this.houses.push({ fill, base: hill + h + 0.2 });
    });
    this._label('MANG-LUOI', V(29, 1.2 + 7.8 + 1.6, 5));
    // Góc nhìn đặt sẵn. Ngoài trời (fit): vùng cần vừa khung + hướng nhìn [tỉ lệ vùng trống rộng/cao, phương vị, góc ngẩng]
    // (độ; nội suy theo tỉ lệ: dải rộng → nhìn thẳng, thấp; gần vuông → chéo, cao) và aeP khi vùng trống dọc (điện thoại
    // đứng: nhìn dọc trục dài của trạm từ phía bể). Khoảng cách và đích tính theo vùng trống giữa HUD/dock/thanh trên.
    // Trong nhà (pos/target, posP/targetP cho khung dọc): điểm đặt cố định, tia nhìn đi phía trên/sau ống góp đẩy (y 2,2, z 0)
    // để không bị ống che; không lùi theo tỉ lệ khung.
    this.camPresets = {
      overview: { fit: B3(-12.6, -0.2, -5.0, 10.2, 5.4, 4.9), ae: [[1.2, -31, 42], [2.6, -15, 29]], aeP: [-90, 52] },
      tank: { fit: B3(-14, -0.2, -5.6, -3.5, 5.2, 3.6), ae: [[1.2, -8, 36], [2.6, 0, 28]], aeP: [-20, 48] },
      pumps: { fit: B3(-0.8, -0.1, -2.8, 3.8, 2.4, 2.4), ae: [[1.2, 30, 30], [2.6, 27, 24]], aeP: [60, 42] },
      cabinet: { pos: V(5.7, 3.0, -0.42), target: V(9.0, 1.4, -3.5), posP: V(4.4, 6.6, -0.6), targetP: V(8.9, 1.3, -3.2) },
      quality: { pos: V(5.8, 3.3, -0.6), target: V(5.8, 1.95, -4.4), posP: V(5.8, 8.6, 2.4) },
      network: { fit: B3(12, -0.2, -7, 32, 12, 8), ae: [[1.2, -20, 30], [2.6, -18, 22]], aeP: [-35, 40] },
    };
  }

  /**
   * Thương hiệu SYSTEM trong cảnh: bảng hiệu trên tường sau (logo, tên công ty, trạm đang xem) và tấm logo nhỏ trên cửa tủ CP-02
   * (tủ mới thuộc giải pháp). Dùng vật liệu không phụ thuộc đèn để màu logo giữ nguyên ở cả giao diện sáng và tối.
   */
  _brandSigns(kx, ky, kz) {
    const S = this.scene;
    this.sign = canvasTex(1024, 288);
    this._signText = ['', ''];
    this._box(3.9, 1.22, 0.06, this.mat.steel, 0.4, 2.45, -4.58, { cast: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.74, 1.05), new THREE.MeshBasicMaterial({ map: this.sign.tex, toneMapped: false }));
    sign.position.set(0.4, 2.45, -4.545); S.add(sign);
    this.logoPlate = canvasTex(128, 128);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: this.logoPlate.tex, transparent: true, toneMapped: false }));
    plate.rotation.y = -Math.PI / 2; plate.position.set(kx - 0.178, ky + 0.43, kz + 0.29); S.add(plate);
    this._logo = new Image();
    this._logo.onload = () => { this._drawSign(); const { ctx, tex } = this.logoPlate; ctx.clearRect(0, 0, 128, 128); ctx.drawImage(this._logo, 4, 4, 120, 120); tex.needsUpdate = true; };
    this._logo.src = 'assets/system-logo.png';
    document.fonts?.ready.then(() => this._drawSign());
    this._drawSign();
  }
  /** Chữ trên bảng hiệu: dòng 1 = tên trạm đang xem (ST-xx · khu vực), dòng 2 = địa danh. */
  setSignText(l1, l2) { this._signText = [l1, l2]; this._drawSign(); }
  _drawSign() {
    const { c, ctx, tex } = this.sign, [l1, l2] = this._signText;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f6f8f7'; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(4, 4, c.width - 8, c.height - 8, 26) : ctx.rect(4, 4, c.width - 8, c.height - 8)); ctx.fill();
    ctx.strokeStyle = '#cdd5d1'; ctx.lineWidth = 4; ctx.stroke();
    if (this._logo?.complete && this._logo.naturalWidth) ctx.drawImage(this._logo, 36, 38, 212, 212);
    const g = ctx.createLinearGradient(290, 0, 760, 0); g.addColorStop(0, '#2f9e44'); g.addColorStop(1, '#2a78d6');
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = g; ctx.font = '700 118px "Barlow Condensed", "Arial Narrow", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '12px';
    ctx.fillText('SYSTEM', 280, 138);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = '#4a5753'; ctx.font = '500 34px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText('Giám sát & điều khiển trạm bơm thông minh', 282, 186);
    ctx.fillStyle = '#16201d'; ctx.font = '700 48px "Barlow Condensed", "Arial Narrow", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText(l1 || '', 282, 245);
    const w1 = ctx.measureText(l1 || '').width;
    ctx.fillStyle = '#7b8783'; ctx.font = '500 30px "Be Vietnam Pro", system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    if (l2) ctx.fillText(l2, 282 + w1 + 22, 245, Math.max(60, c.width - 40 - (282 + w1 + 22)));
    tex.needsUpdate = true;
  }
  /**
   * Khuôn viên quanh trạm: sân sỏi, đường, hàng rào có cổng, cây, cột đèn. Chỉ để cảnh có chiều sâu và có chỗ so sánh cỡ
   * (không chọn được, không tính vào khung nhìn). Màu theo giao diện ở applyTheme.
   */
  _environment() {
    const S = this.scene, M = this.mat, std = (o) => new THREE.MeshStandardMaterial(o);
    const flat = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    M.gravel = std({ color: 0xcfcbbd, roughness: 1, ...flat }); M.asphalt = std({ color: 0x5d6361, roughness: 0.95, ...flat });
    M.fence = std({ color: 0x8d9692, roughness: 0.6, metalness: 0.5 }); M.leaf = std({ color: 0x5f9a5a, roughness: 0.9, flatShading: true }); M.trunk = std({ color: 0x6b5238, roughness: 1 });
    M.lane = new THREE.MeshBasicMaterial({ color: 0xf4f1e6 });
    const add = (m) => { m.userData.nofit = true; S.add(m); return m; };
    const plane = (w, d, mat, x, z, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; return add(m); };
    // sân sỏi + đường phía trước (vạch kẻ làm bằng một mặt phẳng ghép)
    const x0 = -19.5, x1 = 13.5, z0 = -8.6, z1 = 9.4;
    plane(x1 - x0, z1 - z0, M.gravel, (x0 + x1) / 2, (z0 + z1) / 2, -0.012);
    plane(420, 7, M.asphalt, 0, 14.2, -0.011);
    // vạch kẻ đường và cây cối dùng InstancedMesh (mỗi loại một lần vẽ) để cảnh không tốn thêm nhiều lượt vẽ
    const mx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), qy = new THREE.Quaternion(), qf = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
    const inst = (geo, mat, n, shadow = false) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = shadow; m.frustumCulled = false; return add(m); }; // vài chục đối tượng nhỏ: khỏi tính hộp bao
    const dashes = []; for (let x = -60; x < 60; x += 4.5) dashes.push(x);
    const lanes = inst(new THREE.PlaneGeometry(2.2, 0.16), M.lane, dashes.length);
    dashes.forEach((x, i) => { mx.compose(V(x, -0.006, 14.2), qf, one); lanes.setMatrixAt(i, mx); });
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(420, 0.14, 0.2), M.fence); kerb.position.set(0, 0.04, 10.6); kerb.receiveShadow = true; add(kerb);
    // hàng rào: cột (InstancedMesh) + hai thanh ngang; chừa cổng ở giữa cạnh trước
    const posts = [], gate = [1.0, 5.4], H = 1.15;
    const run = (ax, az, bx, bz) => { const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2.6)); for (let i = 0; i <= n; i++) posts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); };
    run(x0, z0, x1, z0); run(x0, z0, x0, z1); run(x1, z0, x1, z1); run(x0, z1, gate[0], z1); run(gate[1], z1, x1, z1);
    const pm = inst(new THREE.BoxGeometry(0.09, H, 0.09), M.fence, posts.length, true);
    posts.forEach(([x, z], i) => { mx.makeTranslation(x, H / 2, z); pm.setMatrixAt(i, mx); });
    const rail = (ax, az, bx, bz) => { for (const y of [0.45, 0.95]) { const L = Math.hypot(bx - ax, bz - az), r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, 0.04), M.fence); r.position.set((ax + bx) / 2, y, (az + bz) / 2); r.rotation.y = -Math.atan2(bz - az, bx - ax); add(r); } };
    rail(x0, z0, x1, z0); rail(x0, z0, x0, z1); rail(x1, z0, x1, z1); rail(x0, z1, gate[0], z1); rail(gate[1], z1, x1, z1);
    for (const gx of gate) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.9, 0.3), M.concrete); g.position.set(gx, 0.95, z1); g.castShadow = true; add(g); }
    // cây (thân + hai khối tán) và bụi
    const trees = [[-23, -7, 1.1], [-22, 2, 1.3], [-21, 8.5, 1], [-14, -12, 1.2], [-6, -12.5, 1.4], [3, -12, 1.1], [10, -12, 1.3], [16, -10, 1.2], [-17.5, 12.5, 1], [-26, -1, 1.2]];
    const trunk = inst(new THREE.CylinderGeometry(0.1, 0.15, 1.5, 7), M.trunk, trees.length, true), crownA = inst(new THREE.IcosahedronGeometry(1.25, 0), M.leaf, trees.length, true), crownB = inst(new THREE.IcosahedronGeometry(0.9, 0), M.leaf, trees.length, true);
    trees.forEach(([x, z, k], i) => {
      qy.setFromEuler(new THREE.Euler(0, i * 1.3, 0));
      mx.compose(V(x, 0.75 * k, z), q0, new THREE.Vector3(k, k, k)); trunk.setMatrixAt(i, mx);
      mx.compose(V(x, 2.0 * k, z), qy, new THREE.Vector3(k, 0.85 * k, k)); crownA.setMatrixAt(i, mx);
      mx.compose(V(x, 2.9 * k, z), qy, new THREE.Vector3(k, 0.85 * k, k)); crownB.setMatrixAt(i, mx);
    });
    const bushes = [[-18.2, -7.4, 0.9], [-18.6, 7.8, 0.8], [12.6, 8.2, 0.7], [12.7, -7.5, 0.8]];
    const bush = inst(new THREE.IcosahedronGeometry(0.55, 0), M.leaf, bushes.length, true);
    bushes.forEach(([x, z, k], i) => { mx.compose(V(x, 0.38 * k, z), q0, new THREE.Vector3(k, 0.8 * k, k)); bush.setMatrixAt(i, mx); });
    // cột đèn cạnh cổng
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 5.4, 8), M.fence); pole.position.set(6.4, 2.7, z1 + 0.6); pole.castShadow = true; add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), M.fence); arm.position.set(5.9, 5.3, z1 + 0.6); add(arm);
    this.lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe9a8, emissiveIntensity: 0.3 })); this.lampHead.position.set(5.4, 5.25, z1 + 0.6); add(this.lampHead);
  }
  _dialTexture() {
    const { c, ctx, tex } = canvasTex(128, 128);
    ctx.fillStyle = '#f7f7f2'; ctx.beginPath(); ctx.arc(64, 64, 63, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.fillStyle = '#222'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    for (let v = 0; v <= 10; v++) {
      const a = (-135 + v * 27) * Math.PI / 180;
      const x1 = 64 + Math.sin(a) * 52, y1 = 64 - Math.cos(a) * 52, x2 = 64 + Math.sin(a) * 44, y2 = 64 - Math.cos(a) * 44;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (v % 2 === 0) ctx.fillText(String(v), 64 + Math.sin(a) * 34, 68 - Math.cos(a) * 34);
    }
    ctx.strokeStyle = '#d03b3b'; ctx.lineWidth = 5; ctx.beginPath();
    ctx.arc(64, 64, 56, (-90 - 135 + 4 * 27) * Math.PI / 180, (-90 - 135 + 10 * 27) * Math.PI / 180); ctx.stroke();
    ctx.font = '10px sans-serif'; ctx.fillText('bar', 64, 100);
    tex.needsUpdate = true;
    return tex;
  }

  /** Vành sáng trên sàn quanh bệ bơm (trắng, tô màu bằng material.color). */
  _padTexture() {
    const { c, ctx, tex } = canvasTex(270, 160);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
    ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff';
    ctx.shadowBlur = 16; ctx.lineWidth = 7; rr(18, 18, c.width - 36, c.height - 36, 26); ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.globalAlpha = 0.9; rr(18, 18, c.width - 36, c.height - 36, 26); ctx.stroke();
    ctx.globalAlpha = 0.1; ctx.fillStyle = '#fff'; rr(22, 22, c.width - 44, c.height - 44, 22); ctx.fill();
    tex.needsUpdate = true;
    return tex;
  }
  /** Vòng chọn thiết bị (nét đứt phát sáng, xoay chậm) đặt dưới thiết bị đang mở bảng điều khiển. */
  _selRing() {
    const { c, ctx, tex } = canvasTex(256, 256);
    ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.lineCap = 'round';
    ctx.shadowBlur = 10; ctx.lineWidth = 6; ctx.setLineDash([22, 12]);
    ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(128, 128, 98, 0, Math.PI * 2); ctx.stroke();
    tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: HL.sel[0], transparent: true, depthWrite: false, opacity: 0.95 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false;
    this.scene.add(m);
    this.selMesh = m;
  }

  applyTheme() {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    // nền trời chuyển màu nhẹ + sương mù xa để mặt đất hòa vào chân trời
    const base = new THREE.Color(css('--scene-bg', '#dfe5e2'));
    const top = base.clone().lerp(new THREE.Color(dark ? 0x07111c : 0x9dbdd3), dark ? 0.5 : 0.55);
    const { c, ctx, tex } = canvasTex(4, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + top.getHexString()); g.addColorStop(0.62, '#' + base.getHexString()); g.addColorStop(1, '#' + base.getHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); tex.needsUpdate = true;
    if (this.scene.background && this.scene.background.isTexture) this.scene.background.dispose();
    this.scene.background = tex;
    this.scene.fog = new THREE.Fog(base, 48, 125);
    this.mat.ground.color.set(dark ? 0x2b3a2e : 0x9fae95);
    this.mat.floor.color.set(dark ? 0x58605c : 0xc9ccc7);
    this.mat.concrete.color.set(dark ? 0x7e847f : 0xb9bdb8);
    this.mat.gravel?.color.set(dark ? 0x4a4d49 : 0xcfcbbd); this.mat.asphalt?.color.set(dark ? 0x262b2a : 0x5d6361); this.mat.leaf?.color.set(dark ? 0x2f5a3a : 0x5f9a5a); this.mat.fence?.color.set(dark ? 0x6c7571 : 0x8d9692);
    if (this.lampHead) this.lampHead.material.emissiveIntensity = dark ? 1.4 : 0.3;
    this.renderer.toneMappingExposure = dark ? 0.85 : 1.0;
    this.dark = dark;
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this._applyProj();
  }
  /**
   * Phần khung bị lớp giao diện che (pixel): { l, r, t, b } (+ sb, sr: tấm biểu đồ / khung bên phải – chỉ để gỡ chồng nhãn).
   * Tâm chiếu của camera dời vào giữa vùng còn trống (setViewOffset) để trạm không nằm dưới HUD/dock. Lần đầu nhận thì
   * đặt góc nhìn tổng quan vừa khung; về sau khung đổi nhiều (thu gọn HUD, đổi cỡ cửa sổ, máy tính ↔ điện thoại) thì
   * đặt lại góc nhìn đang chọn – chỉ khi người dùng chưa tự xoay/thu phóng kể từ lần đặt trước.
   */
  setInsets(ins) {
    this.insX = ins;
    const k = [ins.l, ins.r, ins.t, ins.b, this._w, this._h].map((v) => Math.round(v || 0)).join(',');
    if (k === this._insKey) return;
    const first = this._insKey === undefined, prev = this.ins, sz = this._fitSz;
    this._insKey = k; this.ins = { l: ins.l, r: ins.r, t: ins.t, b: ins.b };
    this._applyProj();
    if (first) { this._refit(true); return; }
    const resized = !sz || sz[0] !== this._w || sz[1] !== this._h;
    const big = prev && Math.max(Math.abs(prev.l - ins.l), Math.abs(prev.r - ins.r), Math.abs(prev.t - ins.t), Math.abs(prev.b - ins.b)) >= 40;
    if (resized || big) this._refit(resized);
  }
  /** Đặt lại góc nhìn đặt sẵn đang dùng cho vừa khung hiện tại (now: tức thì; không thì bay nhanh 0,6 s). */
  _refit(now) {
    if (!this.view0 || this._moved || !this._w) return;
    const v = this._presetView(this.view0);
    if (!v) return;
    this._fitSz = [this._w, this._h]; this._rev = null; // khung đổi: không trả camera về chỗ cũ khi đóng tấm trượt
    if (now) { this.tween = null; this.camera.position.copy(v[0]); this.controls.target.copy(v[1]); this.controls.update(); }
    else this.tween = { t: 0, dur: 0.6, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: v[0], t1: v[1] };
  }
  _applyProj() {
    const w = this._w, h = this._h, I = this.ins, cam = this.camera;
    if (!w || !h) return;
    const sx = I ? (I.l - I.r) / 2 : 0, sy = I ? (I.t - I.b) / 2 : 0;
    if (Math.abs(sx) < 1 && Math.abs(sy) < 1) { cam.clearViewOffset(); cam.aspect = w / h; }
    else {
      const fw = w + 2 * Math.abs(sx), fh = h + 2 * Math.abs(sy);
      cam.aspect = fw / fh;
      cam.setViewOffset(fw, fh, sx > 0 ? 0 : 2 * Math.abs(sx), sy > 0 ? 0 : 2 * Math.abs(sy), w, h);
    }
    cam.updateProjectionMatrix();
  }
  /** Tỉ lệ rộng/cao của vùng trống (khung trừ HUD, dock, thanh trên). */
  _freeAspect() {
    const I = this.ins || { l: 0, r: 0, t: 0, b: 0 };
    return Math.max(1, (this._w || 1) - I.l - I.r) / Math.max(1, (this._h || 1) - I.t - I.b);
  }
  /** [vị trí camera, đích] của một góc nhìn đặt sẵn theo khung hiện tại. */
  _presetView(name) {
    const P = this.camPresets[name];
    if (!P) return null;
    const A = this._freeAspect(), port = A < 0.95;
    if (P.pos) return [((port && P.posP) || P.pos).clone(), ((port && P.targetP) || P.target).clone()];
    let [az, el] = port && P.aeP ? P.aeP : P.ae[0].slice(1);
    if (!port) { const [a0, z0, e0] = P.ae[0], [a1, z1, e1] = P.ae[1], k = clamp((A - a0) / (a1 - a0), 0, 1); az = z0 + (z1 - z0) * k; el = e0 + (e1 - e0) * k; }
    const r = Math.PI / 180, dir = V(Math.sin(az * r) * Math.cos(el * r), Math.sin(el * r), Math.cos(az * r) * Math.cos(el * r));
    const pts = this._fitPoints(P.fit), c = P.fit.getCenter(new THREE.Vector3());
    if (pts.length) { c.set(0, 0, 0); for (const p of pts) c.add(p); c.multiplyScalar(1 / pts.length); }
    return this._solveFit(pts, dir, c) || [c.clone().addScaledVector(dir, 30), c];
  }
  /** Điểm (thế giới) phải nằm trong khung: góc hộp bao của từng mesh có tâm trong vùng (cắt theo vùng) + điểm neo nhãn. */
  _fitPoints(region) {
    this._fitCache = this._fitCache || new Map();
    let pts = this._fitCache.get(region);
    if (pts) return pts;
    pts = [];
    const seen = new Set(), b = new THREE.Box3(), c = new THREE.Vector3();
    const add = (x, y, z) => { const k = `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`; if (!seen.has(k)) { seen.add(k); pts.push(V(x, y, z)); } };
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o === this.ground || o === this.selMesh || o.userData.nofit) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (!region.containsPoint(b.getCenter(c))) return;
      b.intersect(region);
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) add(x, y, z);
    });
    for (const l of Object.values(this.labels)) { const p = l.obj.position; if (region.containsPoint(p)) add(p.x, p.y, p.z); }
    this._fitCache.set(region, pts);
    return pts;
  }
  /**
   * Camera nhìn theo hướng dir sao cho mọi điểm pts nằm trong vùng trống [ins.l+m, W−ins.r−m] × [ins.t+m, H−ins.b−m]
   * (lề m ≈ 7 %): dò khoảng cách nhỏ nhất bằng chia đôi với phép chiếu thật (gồm dời tâm chiếu), rồi dời đích trong
   * mặt phẳng ảnh để khối chiếu nằm giữa vùng trống; lặp vài lần. Trả về [vị trí, đích].
   */
  _solveFit(pts, dir, target) {
    const W = this._w, H = this._h;
    if (!W || !H || !pts.length) return null;
    const I = this.ins || { l: 0, r: 0, t: 0, b: 0 };
    const fw = Math.max(60, W - I.l - I.r), fh = Math.max(60, H - I.t - I.b);
    const mx = Math.max(14, fw * 0.085), my = Math.max(12, fh * 0.085);
    const FL = I.l + mx, FR = Math.max(FL + 20, W - I.r - mx), FT = I.t + my, FB = Math.max(FT + 20, H - I.b - my);
    const cam = this._fcam || (this._fcam = new THREE.PerspectiveCamera());
    cam.copy(this.camera, false);
    const n = dir.clone().normalize(), t = target.clone(), v = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3();
    const dmin = this.controls.minDistance, dmax = this.controls.maxDistance;
    const proj = (d) => {
      cam.position.copy(t).addScaledVector(n, d); cam.lookAt(t); cam.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        v.copy(p).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -cam.near) return null; // điểm ở sau camera: còn quá gần
        v.applyMatrix4(cam.projectionMatrix);
        const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return [x0, x1, y0, y1];
    };
    const fits = (d) => { const s = proj(d); return Boolean(s) && s[0] >= FL && s[1] <= FR && s[2] >= FT && s[3] <= FB; };
    let d = dmax;
    for (let it = 0; ; it++) {
      if (fits(dmax)) { let lo = dmin, hi = dmax; for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; } d = hi; } else d = dmax;
      const s = proj(d);
      if (!s || it === 3) break;
      const ex = (FL + FR - s[0] - s[1]) / 2, ey = (FT + FB - s[2] - s[3]) / 2;
      if (Math.abs(ex) < 2 && Math.abs(ey) < 2) break;
      // số mét trên một pixel ở độ sâu của đích (khung chiếu đầy đủ khi có dời tâm chiếu)
      const k = 2 * d * Math.tan(cam.fov * Math.PI / 360) / (cam.view && cam.view.enabled ? cam.view.fullHeight : H);
      ax.setFromMatrixColumn(cam.matrixWorld, 0); ay.setFromMatrixColumn(cam.matrixWorld, 1);
      t.addScaledVector(ax, -ex * k).addScaledVector(ay, ey * k);
    }
    return [t.clone().addScaledVector(n, d), t];
  }
  /** Thiết bị dưới điểm (x, y) theo pixel trong khung; null nếu không trúng. */
  _hitAt(x, y) {
    const w = this._w || this.el.clientWidth, hh = this._h || this.el.clientHeight;
    this.mouse.set((x / w) * 2 - 1, -(y / hh) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    let hit = hits[0];
    // thiết bị nằm bên trong vỏ tủ: tia chạm vỏ trước – ưu tiên thiết bị bên trong nếu nằm ngay sau vỏ
    if (hit && CONTAINERS.has(hit.object.userData.tag)) {
      const inner = hits.find((h) => !CONTAINERS.has(h.object.userData.tag) && h.distance - hit.distance < 0.7);
      if (inner) hit = inner;
    }
    return hit ? hit.object.userData.tag : null;
  }
  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const tag = this._hitAt(e.clientX - r.left, e.clientY - r.top);
    if (tag && this.onPick) this.onPick(tag);
  }
  /** Bay từ xa và cao xuống góc nhìn đang dùng (khi vào chi tiết trạm từ màn mạng lưới). */
  flyIn() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const v = this._presetView(this.view0 || 'overview');
    if (!v) return;
    const off = v[0].clone().sub(v[1]), p0 = v[1].clone().addScaledVector(off, 1.9).add(V(-6, 18, 10));
    this.camera.position.copy(p0); this.controls.target.copy(v[1]); this.controls.update();
    this._moved = false; this._rev = null;
    this.tween = { t: 0, dur: 1.7, p0: p0.clone(), t0: v[1].clone(), p1: v[0], t1: v[1] };
  }
  goto(name) {
    const v = this._presetView(name);
    if (!v) return;
    this.view0 = name; this._moved = false; this._fitSz = [this._w, this._h]; this._rev = null;
    this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: v[0], t1: v[1] };
  }

  // ---------- rê chuột: tô sáng + chú thích ----------
  _initHover() {
    const cv = this.renderer.domElement;
    this.tip = document.createElement('div');
    this.tip.className = 's3d-tip'; this.tip.hidden = true;
    this.tip.innerHTML = '<b></b><span></span><small></small>';
    [this.tipName, this.tipVal, this.tipHint] = this.tip.children;
    this.el.appendChild(this.tip);
    this._hv = { x: 0, y: 0, dirty: false, last: 0 };
    this._canHover = matchMedia('(hover: hover)').matches || matchMedia('(any-hover: hover)').matches;
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = cv.getBoundingClientRect();
      this._hv.x = e.clientX - r.left; this._hv.y = e.clientY - r.top;
      if (e.buttons) { this._dragging = true; if (this._hover) this._setHover(null); return; }
      this._dragging = false; this._hv.dirty = true;
      if (this._hover && this._hoverSrc === 'mesh') this._placeTip(this._hv.x, this._hv.y);
    });
    cv.addEventListener('pointerleave', () => { this._hv.dirty = false; if (this._hoverSrc === 'mesh') this._setHover(null); });
  }
  /** Gọi trong update(): tối đa một lần dò tia mỗi ~60 ms và chỉ khi chuột vừa di chuyển. */
  _hoverTick() {
    if (!this._hv.dirty || this._dragging || this.tween) return;
    const now = performance.now();
    if (now - this._hv.last < 60) return;
    this._hv.last = now; this._hv.dirty = false;
    const tag = this._hitAt(this._hv.x, this._hv.y);
    if (tag !== this._hover || this._hoverSrc !== 'mesh') this._setHover(tag, 'mesh');
  }
  _setHover(tag, src = 'mesh', labelDiv = null) {
    if (tag && !this._canHover && src === 'mesh') return;
    const prev = this._hover;
    if (tag === prev && (src === this._hoverSrc || !tag)) return;
    this._hover = tag; this._hoverSrc = tag ? src : null;
    this.renderer.domElement.style.cursor = tag ? 'pointer' : '';
    if (prev && prev !== tag && this.labels[prev]) this.labels[prev].div.classList.toggle('hl', prev === this._sel);
    if (tag && this.labels[tag]) this.labels[tag].div.classList.add('hl');
    if (prev !== tag) this._applyHL();
    if (!tag || tag === this._sel) { this.tip.hidden = true; return; } // thiết bị đang mở bảng nổi: chỉ tô sáng, không che bảng
    this._tipText();
    this.tip.hidden = false;
    if (src === 'label' && labelDiv) {
      const r = labelDiv.getBoundingClientRect(), r0 = this.el.getBoundingClientRect();
      this._placeTip(r.left - r0.left, r.bottom - r0.top - 6);
    } else this._placeTip(this._hv.x, this._hv.y);
  }
  _tipText() {
    const tag = this._hover;
    if (!tag) return;
    const l = this.labels[tag];
    const name = this.compName.get(tag) || '';
    this.tipName.textContent = tag + (name ? ' · ' + name : '');
    const val = l && l.last ? l.last : '';
    this.tipVal.textContent = val; this.tipVal.hidden = !val;
    const hint = this.hoverHint ? this.hoverHint(tag) : 'Nhấp để xem thông tin';
    this.tipHint.textContent = hint || ''; this.tipHint.hidden = !hint;
  }
  _placeTip(x, y) {
    const W = this._w || 800, H = this._h || 600, tw = this.tip.offsetWidth || 220, th = this.tip.offsetHeight || 54;
    const tx = clamp(x + 14, 6, W - tw - 6), ty = y + 18 + th > H - 6 ? y - th - 12 : y + 18;
    this.tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(Math.max(6, ty))}px)`;
  }

  // ---------- tô sáng thiết bị ----------
  _hlMat(m, kind) {
    const k = m.uuid + kind;
    let c = this._hlCache.get(k);
    if (!c) {
      c = m.clone();
      c.emissive = new THREE.Color(HL[kind][0]); c.emissiveIntensity = HL[kind][1];
      c.userData.src = m; c.userData.kind = kind;
      this._hlCache.set(k, c);
    }
    return c;
  }
  _clearHL() {
    for (const o of this._hlOn) { if (o.userData.matPre) o.material = o.userData.matPre; o.userData.matPre = null; }
    this._hlOn.length = 0;
  }
  _applyHL() {
    this._clearHL();
    for (const [tag, kind] of [[this._sel, 'sel'], [this._hover, 'hov']]) {
      if (!tag) continue;
      for (const o of this.byTag.get(tag) || []) {
        const base = o.material;
        if (o.userData.matPre || !base.emissive || (base.transparent && base.opacity <= 0.15)) continue;
        o.userData.matPre = base;
        o.material = this._hlMat(base, kind);
        this._hlOn.push(o);
      }
    }
  }
  /** Tô sáng bền vững cho thiết bị đang mở bảng điều khiển (null = bỏ chọn). */
  highlight(tag) {
    if (tag === this._sel) return;
    const prev = this._sel;
    this._sel = tag || null;
    if (prev && this.labels[prev]) this.labels[prev].div.classList.toggle('hl', prev === this._hover);
    if (tag && this.labels[tag]) this.labels[tag].div.classList.add('hl');
    if (tag && tag === this._hover) this.tip.hidden = true;
    for (const [t, l] of Object.entries(this.labels)) l.div.classList.toggle('sel', t === this._sel);
    this._applyHL();
    const ring = this.selMesh;
    ring.visible = false;
    if (!tag) return;
    const b = this._boxOf(tag);
    if (b.isEmpty()) return;
    const c = b.getCenter(this._pc), sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
    const r = clamp(Math.hypot(sx, sz) / 2 + 0.22, 0.45, 2.4);
    ring.scale.set(2 * r, 2 * r, 1);
    ring.position.set(c.x, b.min.y < 0.6 ? 0.02 : b.min.y - 0.04, c.z);
    ring.visible = true;
  }
  /** Hộp bao thế giới của thiết bị (ưu tiên hộp khai báo riêng cho bơm/van). */
  _boxOf(tag) {
    const b = this._box3.makeEmpty();
    if (this.focusBox[tag]) return b.copy(this.focusBox[tag]);
    for (const o of this.byTag.get(tag) || []) b.expandByObject(o);
    return b;
  }
  /** Bay camera tới khung nhìn vừa thiết bị (giữ hướng nhìn hiện tại, thiết bị gắn tường thì nhìn từ phía mặt tủ). */
  focus(tag) {
    const b = this._boxOf(tag);
    if (b.isEmpty()) return false;
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(this._pv).length();
    const fov = this.camera.fov * Math.PI / 180;
    const dist = clamp((size / 2) / Math.tan(fov / 2) * 1.35, 2.4, 16);
    const dir = this.camera.position.clone().sub(this.controls.target);
    let az = Math.atan2(dir.x, dir.z);
    if (tag in FACING) { const f = FACING[tag], dd = Math.atan2(Math.sin(az - f), Math.cos(az - f)); az = f + clamp(dd, -0.9, 0.9); }
    const el = clamp(Math.asin(clamp(dir.y / Math.max(1e-6, dir.length()), -1, 1)), 0.32, tag in FACING ? 0.5 : 0.85);
    const p1 = V(c.x + Math.sin(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.cos(az) * Math.cos(el) * dist);
    p1.y = Math.max(0.6, p1.y);
    this.view0 = null; this._rev = null; // không tự đặt lại góc nhìn đặt sẵn khi khung đổi
    this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1, t1: c };
    return true;
  }
  /**
   * Dời camera song song mặt phẳng ảnh (giữ hướng và khoảng cách) để thân thiết bị hiện tại điểm (x, y) trên màn hình –
   * dùng khi tấm trượt điều khiển trên điện thoại che thiết bị. unreveal() trả camera về nếu người dùng chưa tự xoay/thu phóng.
   */
  reveal(tag, x, y) {
    const p = this.bodyPos(tag, {}), c = this._anchor.get('body:' + tag) || this._anchorOf(tag);
    if (!c || p.behind) return false;
    const W = this._w || 1, H = this._h || 1, cam = this.camera;
    const depth = -this._pv.copy(c).applyMatrix4(cam.matrixWorldInverse).z;
    const k = 2 * depth * Math.tan(cam.fov * Math.PI / 360) / (cam.view && cam.view.enabled ? cam.view.fullHeight : H);
    const ax = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), ay = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const d = ax.multiplyScalar((p.x - clamp(x, 0, W)) * k).add(ay.multiplyScalar((y - p.y) * k));
    this._rev = { p: cam.position.clone(), t: this.controls.target.clone(), mv: this._mv || 0 };
    this.tween = { t: 0, dur: 0.5, p0: cam.position.clone(), t0: this.controls.target.clone(), p1: cam.position.clone().add(d), t1: this.controls.target.clone().add(d) };
    return true;
  }
  unreveal() {
    const r = this._rev;
    this._rev = null;
    if (!r || (this._mv || 0) !== r.mv) return;
    this.tween = { t: 0, dur: 0.5, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: r.p, t1: r.t };
  }
  /** Điểm neo của thiết bị: vị trí nhãn 3D nếu có, nếu không là tâm hộp bao các mesh. */
  _anchorOf(tag) {
    let p = this._anchor.get(tag);
    if (p === undefined) {
      if (this.labels[tag]) p = this.labels[tag].obj.position;
      else { const b = this._boxOf(tag); p = b.isEmpty() ? null : b.getCenter(new THREE.Vector3()); }
      this._anchor.set(tag, p);
    }
    return p;
  }
  /**
   * Vị trí trên màn hình (pixel CSS trong khung) của thiết bị: { x, y, visible, behind, dx, dy }.
   * visible = false khi sau camera hoặc ngoài khung nhìn; (dx, dy) là hướng tới thiết bị (để vẽ gợi ý ngoài khung).
   * Truyền out để tái sử dụng đối tượng (không cấp phát mỗi khung hình).
   */
  screenPos(tag, out = {}) {
    const p = this._anchorOf(tag);
    if (!p) { out.x = out.y = out.dx = out.dy = 0; out.visible = false; out.behind = false; return out; }
    return this.project(p, out);
  }
  /** Như screenPos nhưng neo vào tâm thân thiết bị (dùng cho đường dẫn của bảng nổi). */
  bodyPos(tag, out = {}) {
    let p = this._anchor.get('body:' + tag);
    if (p === undefined) { const b = this._boxOf(tag); p = b.isEmpty() ? null : b.getCenter(new THREE.Vector3()); this._anchor.set('body:' + tag, p); }
    if (!p) return this.screenPos(tag, out);
    return this.project(p, out);
  }
  /** Hộp bao của thiết bị trên màn hình (pixel trong khung): { l, t, r, b }; null nếu có góc ở sau camera. */
  screenRect(tag, out = {}) {
    const b = this._boxOf(tag), cam = this.camera, v = this._pv;
    if (b.isEmpty()) return null;
    const W = this._w || this.el.clientWidth, H = this._h || this.el.clientHeight, mn = b.min.clone(), mx = b.max.clone();
    let l = Infinity, r = -Infinity, t = Infinity, bt = -Infinity;
    for (let k = 0; k < 8; k++) {
      v.set(k & 1 ? mx.x : mn.x, k & 2 ? mx.y : mn.y, k & 4 ? mx.z : mn.z).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -cam.near) return null;
      v.applyMatrix4(cam.projectionMatrix);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); bt = Math.max(bt, y);
    }
    out.l = l; out.r = r; out.t = t; out.b = bt;
    return out;
  }
  project(p, out = {}) {
    const W = this._w || this.el.clientWidth, H = this._h || this.el.clientHeight;
    const v = this._pv.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > -this.camera.near;
    const len = Math.hypot(v.x, v.y) || 1;
    out.dx = v.x / len; out.dy = -v.y / len;
    v.copy(p).project(this.camera);
    out.x = (v.x + 1) / 2 * W; out.y = (1 - v.y) / 2 * H;
    out.behind = behind;
    out.visible = !behind && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
    return out;
  }

  /** Cập nhật cảnh theo trạng thái mô phỏng. view = dữ liệu đã chuẩn bị bởi main.js */
  update(dt, view) {
    this.anim.t += dt;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / (tw.dur || 0.9));
      const k = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (view) this._applyView(dt, view);
    if (this.scope && this.scope !== 'all') this._syncScopeMats();
    this._hoverTick();
    if (this._hlOn.length) {
      // bản sao tô sáng theo kịp màu bản gốc (nước đổi màu theo độ đục, đổi giao diện); thiết bị được chọn nhấp nháy nhẹ
      const k = 0.5 + 0.5 * Math.sin(this.anim.t * 4);
      for (const o of this._hlOn) {
        const m = o.material, src = o.userData.matPre;
        if (src && m.color && src.color) m.color.copy(src.color);
        if (m.userData.kind === 'sel') m.emissiveIntensity = 0.22 + 0.3 * k;
      }
    }
    if (this.selMesh.visible) {
      this.selMesh.rotation.z = this.anim.t * 0.35;
      this.selMesh.material.opacity = 0.65 + 0.3 * Math.sin(this.anim.t * 4);
    }
    this._lv = (this._lv || 0) + 1;
    if (this._lv % 5 === 0) this._labelVisibility();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
  _applyView(dt, v) {
    const pl = v.plant;
    // nước trong bể: chiều cao theo mức, màu theo độ đục
    const lv = Math.max(0.02, pl.level);
    this.water.scale.y = lv; this.water.position.y = lv / 2;
    const turb = Math.min(1, Math.max(0, (pl.ntu - 0.3) / 4));
    this.mat.water.color.setRGB(0.24 + 0.33 * turb, 0.56 - 0.13 * turb, 0.82 - 0.55 * turb);
    this.beam.scale.y = Math.max(0.05, this.tankH + 0.05 - lv); this.beam.position.y = (this.tankH + 0.05 + lv) / 2;
    this.floatBall.position.y = Math.min(3.7, Math.max(lv, 2.4));
    this.floatArm.position.y = (this.floatBall.position.y + 3) / 2;
    // bơm
    const manual = v.mode !== 'x' && v.ctl && v.ctl !== 'auto';
    pl.pumps.forEach((pu, i) => {
      const o = this.pumpObj[i];
      this.anim.rot[i] += (pu.f / 50) * 14 * dt;
      o.blades.rotation.x = this.anim.rot[i]; o.coupling.rotation.x = this.anim.rot[i];
      const blink = Math.sin(this.anim.t * 8) > 0;
      const col = pu.fault ? (blink ? 0xd03b3b : 0x401010) : pu.running ? 0x0ca30c : 0x6d7570;
      o.lamp.material.color.set(col); o.lamp.material.emissive.set(pu.fault || pu.running ? col : 0x000000);
      o.lamp.material.emissiveIntensity = 0.7;
      const ang = (-135 + Math.min(10, Math.max(0, pu.gauge)) * 27) * Math.PI / 180;
      o.needle.rotation.z = -ang;
      // vòng trạng thái trên sàn: xanh chạy, xám dừng, đỏ nhấp nháy khi lỗi, hổ phách khi ở chế độ TAY
      const pm = o.pad.material;
      if (pu.fault) { pm.color.setHex(RING.fault); pm.opacity = Math.sin(this.anim.t * 7) > 0 ? 1 : 0.25; }
      else if (manual) { pm.color.setHex(RING.man); pm.opacity = pu.running ? 0.95 : 0.55; }
      else { pm.color.setHex(pu.running ? RING.run : RING.stop); pm.opacity = pu.running ? 0.9 : (this.dark ? 0.45 : 0.6); }
      // động cơ phát sáng nhẹ theo tần số khi chạy
      o.motorMat.emissive.setHex(pu.running ? 0x0ca30c : 0x000000);
      o.motorMat.emissiveIntensity = pu.running ? 0.05 + 0.13 * Math.min(1, pu.f / 50) * (0.85 + 0.15 * Math.sin(this.anim.t * 3 + i)) : 0;
    });
    // dòng chảy (vận tốc thật ×1,5 cho dễ nhìn)
    const vel = (q, d) => (q / 3600) / (Math.PI * d * d / 4) * 1.5;
    const waterCol = turb > 0.15 ? 0xa0844a : 0x4aa3ff;
    this.flows.inlet.update(dt, vel(pl.q_in, 0.1));
    pl.pumps.forEach((pu, i) => { this.flows.suction[i].update(dt, vel(pu.q, 0.125)); this.flows.riser[i].update(dt, vel(pu.q, 0.08)); this.flows.riser[i].setColor(waterCol); this.flows.suction[i].setColor(waterCol); });
    this.flows.outlet.update(dt, vel(pl.q_out, 0.1)); this.flows.outlet.setColor(waterCol);
    this.flows.drain.update(dt, vel(pl.q_drain, 0.15));
    this.flows.relief.update(dt, vel(pl.q_relief, 0.05));
    // bình tích áp
    const frac = pl.htWaterL() / (1000 * 0.3);
    this.htWater.scale.y = Math.max(0.01, frac * 1.0); this.htWater.position.y = 0.42 + this.htWater.scale.y / 2;
    // van MV-02 & VX-01
    this.mvDisc.rotation.y = (1 - pl.outlet_frac) * Math.PI / 2;
    const mvc = pl.outlet_frac > 0.99 ? 0x0ca30c : pl.outlet_frac < 0.01 ? 0xd03b3b : 0xfab219;
    this.mvLamp.material.color.set(mvc); this.mvLamp.material.emissive.set(mvc);
    this.mvArrow.rotation.y = (1 - pl.outlet_frac) * Math.PI / 2;
    this.mvRing.material.color.setHex(mvc);
    if (pl.drain_open) this.drainWheel.rotation.y += dt * 2;
    // tủ điều khiển: LED gateway theo trạng thái kết nối
    const cs = v.comms, dead = v.mode === 'x';
    const ledCol = dead ? 0xd03b3b : cs === 'online' ? 0x0ca30c : cs === 'resync' ? 0x3987e5 : 0xfab219;
    this.gwLeds.forEach((l, k) => {
      const on = dead ? k === 0 : cs === 'offline' ? Math.sin(this.anim.t * 6 + k) > 0 : (k === 0 || Math.sin(this.anim.t * 10 + k * 1.7) > 0.2);
      l.material.color.set(on ? ledCol : 0x222222); l.material.emissive.set(on ? ledCol : 0x000000);
    });
    this.rings.forEach((r) => {
      const ph = (this.anim.t * 0.8 + r.userData.k / 3) % 1;
      const s = cs === 'offline' ? 1 : 0.4 + ph * 1.6;
      r.scale.set(s, s, s);
      r.material.opacity = cs === 'offline' ? 0.9 * (Math.sin(this.anim.t * 6) > 0 ? 1 : 0.2) : 0.8 * (1 - ph);
      r.material.color.set(cs === 'offline' ? 0xd03b3b : cs === 'resync' ? 0x3987e5 : 0x0ca30c);
    });
    const alarm = v.mode === 'd' || v.mode === 'x';
    const on = alarm && Math.sin(this.anim.t * 9) > 0;
    this.beacon.material.emissive.set(on ? 0xff2a2a : 0x000000);
    this.beacon.material.color.set(alarm ? 0xd03b3b : 0x772222);
    // bồn mái các hộ: mức nước theo lượng thiếu hụt bồn mái
    const roof = 1 - Math.min(1, pl.backlog / pl.net.rooftop_capacity_m3);
    this.houses.forEach((h, i) => {
      const f = Math.max(0.03, Math.min(1, roof * (0.85 + 0.15 * ((i * 37) % 7) / 7)));
      h.fill.scale.y = 0.85 * f; h.fill.position.y = h.base + h.fill.scale.y / 2;
      h.fill.material.color.set(f < 0.25 ? 0xd03b3b : 0x3d8fd1);
    });
    this._screens(v);
  }
  _screens(v) {
    this._scr = (this._scr || 0) + 1;
    if (this._scr % 8 !== 0) return;
    const pl = v.plant; const sig = v.sig || {};
    const draw = (sc, lines, bg = '#0f1a1c', fg = '#8ef0b0') => {
      const { c, ctx, tex } = sc;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
      let y = 0;
      for (const [txt, size, col] of lines) {
        y += size * 1.25;
        ctx.fillStyle = col || fg; ctx.font = `600 ${size}px "JetBrains Mono", monospace`; ctx.fillText(txt, 10, y);
      }
      tex.needsUpdate = true;
    };
    const ql = [['AIT-201', 'CLO DƯ', sig.cl, 'mg/L', 2, (x) => x < 0.2 || x > 1.0, (x) => x < 0.3 || x > 0.8],
      ['AIT-202', 'ĐỘ ĐỤC', sig.ntu, 'NTU', 2, (x) => x > 2, (x) => x > 1], ['AIT-203', 'pH', sig.ph, '', 2, (x) => x < 6 || x > 8.5, (x) => x < 6.5 || x > 8]];
    for (const [tag, name, val, unit, nd, bad, warn] of ql) {
      if (v.installed && !v.installed.has(tag)) { draw(this.aitScreens[tag], [[tag + ' · ' + name, 20, '#6d7570'], ['KHÔNG LẮP', 40, '#6d7570']], '#1a1f20'); continue; }
      const col = val === null || val === undefined ? '#d03b3b' : bad(val) ? '#ff6b6b' : warn(val) ? '#fab219' : '#8ef0b0';
      draw(this.aitScreens[tag], [[tag + ' · ' + name, 20, '#9fb3b8'], [val === null || val === undefined ? 'LỖI' : fmt(val, nd), 64, col], [unit, 20, '#9fb3b8']]);
    }
    pl.pumps.forEach((pu, k) => draw(this.vfdScreens[k], [[pu.fault ? 'FAULT' : pu.running ? 'RUN' : 'STOP', 22, pu.fault ? '#ff6b6b' : '#9fb3b8'], [fmt(pu.f, 1) + ' Hz', 30], [fmt(pu.amps, 1) + ' A', 20, '#9fb3b8']]));
    if (v.mode === 'x') {
      draw(this.hmi, [['HMI-01 · ' + (v.sid ?? 'ST-01'), 24, '#9fb3b8'], ['MẤT KẾT NỐI', 40, '#ff6b6b'], ['BỘ ĐIỀU KHIỂN MPC-01', 28, '#ff6b6b'], ['Biến tần đang chạy PID nội', 24, '#fab219']], '#120808');
      return;
    }
    const modeName = { a: '(a) BÌNH THƯỜNG', b: '(b) TỰ VẬN HÀNH', c: '(c) ĐỒNG BỘ', d: '(d) CẢNH BÁO/AN TOÀN' }[v.mode];
    const mcol = { a: '#8ef0b0', b: '#fab219', c: '#8fc2ff', d: '#ff6b6b' }[v.mode];
    const ctl = { auto: 'TỰ ĐỘNG', remote: 'TAY · TỪ XA', local: 'TAY · TẠI CHỖ' }[v.ctl ?? 'auto'];
    draw(this.hmi, [
      ['HMI-01 · ' + (v.sid ?? 'ST-01') + ' · ' + ctl, 24, v.ctl && v.ctl !== 'auto' ? '#fab219' : '#9fb3b8'], [modeName, 30, mcol],
      [`P  ${fmt(sig.p_ctrl, 2)} bar  đặt ${fmt(v.p_set, 2)}`, 26], [`Q  ${fmt(sig.q_f, 1)} m³/h`, 26],
      [`Mức ${fmt(sig.level, 2)} m  kW ${fmt(pl.kw, 2)}`, 26],
      [`Kịch bản v${v.version} · ${v.strategy}`, 22, '#9fb3b8'], [`Đệm ${v.buffer} bản ghi`, 22, '#9fb3b8'],
    ]);
  }
}
