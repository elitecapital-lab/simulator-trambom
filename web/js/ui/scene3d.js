// Cảnh 3D trạm bơm tăng áp ST-01 (Three.js). Đơn vị: mét. Trục y hướng lên.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/CSS2DRenderer.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const css = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const PRIMARY = new Set(['T-01', 'P-01', 'P-02', 'FT-101', 'PT-101', 'MV-02', 'AIT-202', 'GW-01', 'RT-01', 'MANG-LUOI', 'LT-101']);
const fmt = (v, nd = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(nd).replace('.', ','));

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
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labelRenderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.camera.position.set(0.5, 11.5, 17.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-1.5, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3; this.controls.maxDistance = 70;
    this.pickables = []; this.labels = {}; this.labelMode = 1; this.flows = {}; this.anim = { rot: [0, 0], t: 0 };
    this.mat = {};
    this._materials();
    this._lights();
    this._build();
    this.applyTheme();
    this.raycaster = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 5) return;
      this._pick(e);
    });
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
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    this.scene.add(obj);
    this.labels[tag] = { obj, div, span: div.querySelector('span') };
    if (text !== tag) this.labels[tag].span.textContent = text;
    return obj;
  }
  _labelVisibility() {
    const cam = this.camera.position;
    for (const [tag, l] of Object.entries(this.labels)) {
      const primary = PRIMARY.has(tag);
      const near = cam.distanceTo(l.obj.position) < 9.5;
      const show = this.labelMode === 2 || (this.labelMode === 1 && (primary || near) || l.div.classList.contains('alarm'));
      l.div.classList.toggle('hide', !show);
    }
  }
  setLabel(tag, text, alarm = false) {
    const l = this.labels[tag];
    if (!l) return;
    if (l.last !== text) { l.span.textContent = text; l.last = text; }
    l.div.classList.toggle('alarm', alarm);
  }
  /** 0 = ẩn, 1 = nhãn chính + nhãn gần camera, 2 = tất cả */
  setLabelMode(m) { this.labelMode = m; this._labelVisibility(); }

  _build() {
    const S = this.scene;
    // nền & sàn
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), this.mat.ground);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; S.add(ground);
    this.ground = ground;
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
    zs.forEach((z, i) => {
      const tag = i === 0 ? 'P-01' : 'P-02';
      this._pipe([V(-0.6, 0.55, z), V(0.75, 0.55, z)], 0.09, this.mat.pipe, tag);
      this._flange(V(0.72, 0.55, z), 'x', 0.15);
      // van chặn hút (tay quay)
      this._cyl(0.13, 0.03, this.mat.yellow, V(0.1, 0.8, z), 'y');
      this._box(1.9, 0.14, 0.8, this.mat.base, 1.75, 0.07, z, { tag });
      const vol = this._cyl(0.36, 0.3, this.mat.pump, V(1.0, 0.55, z), 'x', { tag, seg: 32 });
      this._cyl(0.24, 0.22, this.mat.pump, V(1.28, 0.55, z), 'x', { tag });
      this._cyl(0.06, 0.3, this.mat.steel, V(1.52, 0.55, z), 'x');
      const motor = this._cyl(0.27, 0.8, this.mat.motor, V(2.05, 0.55, z), 'x', { tag, seg: 28 });
      for (let k = 0; k < 8; k++) this._box(0.75, 0.04, 0.04, this.mat.motor, 2.05, 0.55 + 0.27 * Math.cos(k * Math.PI / 4), z + 0.27 * Math.sin(k * Math.PI / 4));
      this._box(0.36, 0.26, 0.3, this.mat.motor, 2.05, 0.9, z, { tag });
      // quạt làm mát (quay theo tần số)
      const fan = new THREE.Group();
      fan.position.set(2.52, 0.55, z);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.12, 24, 1, true), this.mat.motor);
      cover.rotation.z = Math.PI / 2; fan.add(cover);
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
      this.pumpObj.push({ blades, coupling, lamp, needle, vol, motor });
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
    this._label('MV-02', V(7.8, 3.15, 0));
    // dòng chảy
    this.flows.suction = [0, 1].map((i) => new FlowPath(S, [V(-4.1, 0.55, 0), V(-0.6, 0.55, 0), V(-0.6, 0.55, zs[i]), V(0.7, 0.55, zs[i])], { radius: 0.05 }));
    this.flows.riser = [0, 1].map((i) => new FlowPath(S, [V(1.0, 0.95, zs[i]), V(1.0, 2.2, zs[i]), V(1.0, 2.2, 0)], { radius: 0.05 }));
    this.flows.outlet = new FlowPath(S, hdr, { radius: 0.055 });
    // ---- bảng phân tích chất lượng nước ----
    this._box(3.2, 1.6, 0.06, this.mat.cabinet, 5.8, 1.75, -4.52);
    this._pipe([V(5.8, 2.2, 0), V(5.8, 2.2, -4.3), V(5.8, 2.55, -4.3)], 0.015, this.mat.steel);
    this.aitScreens = {};
    [['AIT-201', 4.7], ['AIT-202', 5.8], ['AIT-203', 6.9]].forEach(([tag, x]) => {
      this._box(0.8, 0.95, 0.22, this.mat.cabinet, x, 1.85, -4.38, { tag });
      const sc = canvasTex(256, 160);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshBasicMaterial({ map: sc.tex }));
      scr.position.set(x, 1.98, -4.265); this._tag(scr, tag); S.add(scr);
      this.aitScreens[tag] = sc;
      this._label(tag, V(x, 2.65, -4.2));
    });
    // ---- tủ điều khiển CP-01 (sát tường sau, cửa kính hướng ra gian bơm) ----
    const cx = 8.55, cz = -4.2;
    this._box(1.8, 2.1, 0.6, this.mat.cabinet, cx, 1.05, cz, { tag: 'CP-01' });
    const door = this._box(1.7, 1.95, 0.02, this.mat.glass, cx, 1.07, cz + 0.31, { cast: false });
    door.userData.tag = 'CP-01';
    this._box(0.5, 0.36, 0.1, this.mat.black, cx - 0.5, 1.6, cz + 0.15, { tag: 'GW-01' });
    this.gwLeds = [];
    for (let k = 0; k < 4; k++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0ca30c, emissive: 0x0ca30c, emissiveIntensity: 0.8 }));
      led.position.set(cx - 0.68 + k * 0.1, 1.72, cz + 0.21); S.add(led); this.gwLeds.push(led);
    }
    this.vfdScreens = [];
    [0, 1].forEach((k) => {
      this._box(0.36, 0.62, 0.2, this.mat.base, cx + 0.1 + k * 0.45, 1.25, cz + 0.1, { tag: k === 0 ? 'P-01' : 'P-02' });
      const sc = canvasTex(128, 96);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), new THREE.MeshBasicMaterial({ map: sc.tex }));
      scr.position.set(cx + 0.1 + k * 0.45, 1.42, cz + 0.205); S.add(scr);
      this.vfdScreens.push(sc);
    });
    this._box(0.5, 0.32, 0.3, this.mat.black, cx - 0.5, 0.35, cz + 0.05, { tag: 'CP-01' });
    this._box(0.3, 0.12, 0.18, this.mat.cabinet, cx - 0.5, 1.95, cz + 0.1, { tag: 'RT-01' });
    // màn HMI trên cửa tủ
    this.hmi = canvasTex(512, 320);
    const hmi = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), new THREE.MeshBasicMaterial({ map: this.hmi.tex }));
    hmi.position.set(cx - 0.35, 1.0, cz + 0.325); this._tag(hmi, 'GW-01'); S.add(hmi);
    // ăng-ten + đèn báo
    this._cyl(0.025, 1.1, this.mat.black, V(cx + 0.6, 2.65, cz), 'y', { tag: 'RT-01' });
    this.rings = [0, 1, 2].map((k) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 32), new THREE.MeshBasicMaterial({ color: 0x0ca30c, transparent: true, opacity: 0.7 }));
      r.position.set(cx + 0.6, 3.2, cz); r.rotation.x = Math.PI / 2; S.add(r); r.userData.k = k; return r;
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0x772222, emissive: 0x000000 }));
    this.beacon.position.set(cx - 0.6, 2.2, cz); S.add(this.beacon);
    this._label('CP-01', V(cx, 2.45, cz + 0.4));
    this._label('GW-01', V(cx - 0.9, 1.75, cz + 0.6));
    this._label('RT-01', V(cx + 0.6, 3.55, cz));
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
    this.camPresets = {
      overview: [V(0.5, 11.5, 17.5), V(-1.5, 1.0, 0)],
      tank: [V(-8, 8.5, 12), V(-8, 2, 0)],
      pumps: [V(4.5, 3.6, 6), V(1.4, 0.9, 0)],
      cabinet: [V(8.0, 1.9, -0.9), V(8.4, 1.3, -4.2)],
      quality: [V(5.8, 2.2, 0.2), V(5.8, 1.9, -4.4)],
      network: [V(14, 12, 24), V(22, 2.5, 0)],
    };
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

  applyTheme() {
    this.scene.background = new THREE.Color(css('--scene-bg', '#dfe5e2'));
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    this.mat.ground.color.set(dark ? 0x2b3a2e : 0x9fae95);
    this.mat.floor.color.set(dark ? 0x58605c : 0xc9ccc7);
    this.mat.concrete.color.set(dark ? 0x7e847f : 0xb9bdb8);
    this.renderer.toneMappingExposure = dark ? 0.85 : 1.0;
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (hit && this.onPick) this.onPick(hit.object.userData.tag);
  }
  goto(name) {
    const p = this.camPresets[name];
    if (!p) return;
    this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: p[0], t1: p[1] };
  }

  /** Cập nhật cảnh theo trạng thái mô phỏng. view = dữ liệu đã chuẩn bị bởi main.js */
  update(dt, view) {
    this.anim.t += dt;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const k = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (view) this._applyView(dt, view);
    this._lv = (this._lv || 0) + 1;
    if (this._lv % 10 === 0) this._labelVisibility();
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
    if (pl.drain_open) this.drainWheel.rotation.y += dt * 2;
    // tủ điều khiển: LED gateway theo trạng thái kết nối
    const cs = v.comms;
    const ledCol = cs === 'online' ? 0x0ca30c : cs === 'resync' ? 0x3987e5 : 0xfab219;
    this.gwLeds.forEach((l, k) => {
      const on = cs === 'offline' ? Math.sin(this.anim.t * 6 + k) > 0 : (k === 0 || Math.sin(this.anim.t * 10 + k * 1.7) > 0.2);
      l.material.color.set(on ? ledCol : 0x222222); l.material.emissive.set(on ? ledCol : 0x000000);
    });
    this.rings.forEach((r) => {
      const ph = (this.anim.t * 0.8 + r.userData.k / 3) % 1;
      const s = cs === 'offline' ? 1 : 0.4 + ph * 1.6;
      r.scale.set(s, s, s);
      r.material.opacity = cs === 'offline' ? 0.9 * (Math.sin(this.anim.t * 6) > 0 ? 1 : 0.2) : 0.8 * (1 - ph);
      r.material.color.set(cs === 'offline' ? 0xd03b3b : cs === 'resync' ? 0x3987e5 : 0x0ca30c);
    });
    const alarm = v.mode === 'd';
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
      const col = val === null || val === undefined ? '#d03b3b' : bad(val) ? '#ff6b6b' : warn(val) ? '#fab219' : '#8ef0b0';
      draw(this.aitScreens[tag], [[tag + ' · ' + name, 20, '#9fb3b8'], [val === null || val === undefined ? 'LỖI' : fmt(val, nd), 64, col], [unit, 20, '#9fb3b8']]);
    }
    pl.pumps.forEach((pu, k) => draw(this.vfdScreens[k], [[pu.fault ? 'FAULT' : pu.running ? 'RUN' : 'STOP', 22, pu.fault ? '#ff6b6b' : '#9fb3b8'], [fmt(pu.f, 1) + ' Hz', 30], [fmt(pu.amps, 1) + ' A', 20, '#9fb3b8']]));
    const modeName = { a: '(a) BÌNH THƯỜNG', b: '(b) TỰ VẬN HÀNH', c: '(c) ĐỒNG BỘ', d: '(d) CẢNH BÁO/AN TOÀN' }[v.mode];
    const mcol = { a: '#8ef0b0', b: '#fab219', c: '#8fc2ff', d: '#ff6b6b' }[v.mode];
    draw(this.hmi, [
      ['ST-01 · HMI GW-01', 24, '#9fb3b8'], [modeName, 30, mcol],
      [`P  ${fmt(sig.p_ctrl, 2)} bar  đặt ${fmt(v.p_set, 2)}`, 26], [`Q  ${fmt(sig.q_f, 1)} m³/h`, 26],
      [`Mức ${fmt(sig.level, 2)} m  kW ${fmt(pl.kw, 2)}`, 26],
      [`Kịch bản v${v.version} · ${v.strategy}`, 22, '#9fb3b8'], [`Đệm ${v.buffer} bản ghi`, 22, '#9fb3b8'],
    ]);
  }
}
