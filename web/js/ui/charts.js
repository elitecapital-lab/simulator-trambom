// Biểu đồ chuỗi thời gian trên canvas: một trục y, lưới mảnh, vùng nền trạng thái, con trỏ + chú giải.
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const pad2 = (n) => String(n).padStart(2, '0');
export function tLabel(t, withDay) {
  const d = Math.floor(t / 86400), s = Math.floor(t % 86400);
  const hm = `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
  return withDay ? `N${d + 1} ${hm}` : hm;
}

export class TimeChart {
  constructor(host, opt) {
    this.opt = opt;
    this.card = document.createElement('div');
    this.card.className = 'card';
    const head = document.createElement('div');
    head.className = 'chart-head';
    const h = document.createElement('h3'); h.textContent = opt.title;
    const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = opt.subtitle || '';
    head.append(h, sub);
    this.legend = document.createElement('div'); this.legend.className = 'legend';
    for (const s of opt.series) {
      const it = document.createElement('span');
      const sw = document.createElement('i');
      sw.style.background = cssv(s.color); sw.style.color = cssv(s.color);
      if (s.dash) sw.className = 'dash';
      it.append(sw, document.createTextNode(s.label));
      this.legend.append(it);
      s._sw = sw;
    }
    this.wrap = document.createElement('div'); this.wrap.className = 'chart';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', opt.title);
    this.tip = document.createElement('div'); this.tip.className = 'tip'; this.tip.hidden = true;
    this.wrap.append(this.canvas, this.tip);
    this.card.append(head, this.legend, this.wrap);
    host.append(this.card);
    this.hoverX = null;
    this.canvas.addEventListener('pointermove', (e) => { const r = this.canvas.getBoundingClientRect(); this.hoverX = e.clientX - r.left; this.draw(); });
    this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.tip.hidden = true; this.draw(); });
    this.data = null;
  }
  refreshColors() { for (const s of this.opt.series) { s._sw.style.background = cssv(s.color); s._sw.style.color = cssv(s.color); } }
  setData(d) { this.data = d; this.draw(); }
  draw() {
    const d = this.data;
    const cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!d || !d.t.length) return;
    const ink2 = cssv('--ink-2'), muted = cssv('--muted'), grid = cssv('--line-2'), axis = cssv('--line');
    const L = 40, R = 12, T = 8, B = 20;
    const pw = W - L - R, ph = H - T - B;
    const [t0, t1] = d.window;
    const tspan = Math.max(1, t1 - t0);
    // phạm vi y
    let lo = this.opt.yMin, hi = this.opt.yMax;
    if (lo === undefined || hi === undefined) {
      let mn = Infinity, mx = -Infinity;
      for (const s of this.opt.series) {
        const arr = d.series[s.key];
        if (!arr) continue;
        for (let i = d.i0; i < arr.length; i++) { const v = arr[i]; if (v === v && v !== null) { if (v < mn) mn = v; if (v > mx) mx = v; } }
      }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      if (this.opt.zero) mn = Math.min(0, mn);
      const padv = (mx - mn) * 0.08 || 0.5;
      lo = lo ?? mn - (this.opt.zero ? 0 : padv); hi = hi ?? mx + padv;
    }
    const X = (t) => L + ((t - t0) / tspan) * pw;
    const Y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;
    // vùng nền
    for (const sp of d.spans || []) {
      const a = Math.max(t0, sp.t0), b = Math.min(t1, sp.t1);
      if (b <= a) continue;
      ctx.fillStyle = cssv(sp.kind === 'off' ? '--span-off' : '--span-d');
      ctx.fillRect(X(a), T, X(b) - X(a), ph);
    }
    if (this.opt.band) {
      const [bl, bh] = this.opt.band;
      ctx.fillStyle = cssv('--band');
      ctx.fillRect(L, Y(Math.min(bh, hi)), pw, Y(Math.max(bl, lo)) - Y(Math.min(bh, hi)));
    }
    // lưới
    ctx.font = '11px ' + cssv('--f-mono'); ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const v of niceTicks(lo, hi)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(String(v).replace('.', ','), L - 6, y);
    }
    const withDay = tspan > 86400 * 0.9 || t0 >= 86400;
    const stepH = [1, 2, 3, 6, 12, 24, 48].find((h) => tspan / (h * 3600) <= Math.max(2, pw / 70)) || 48;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let tt = Math.ceil(t0 / (stepH * 3600)) * stepH * 3600; tt <= t1; tt += stepH * 3600) {
      const x = Math.round(X(tt)) + 0.5;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      const lab = tLabel(tt, withDay), tw = ctx.measureText(lab).width;
      ctx.fillStyle = muted; ctx.fillText(lab, Math.min(W - tw / 2 - 2, Math.max(L + tw / 2, x)), T + ph + 5);
    }
    ctx.strokeStyle = axis; ctx.beginPath(); ctx.moveTo(L, T + ph + 0.5); ctx.lineTo(L + pw, T + ph + 0.5); ctx.stroke();
    for (const r of this.opt.refLines || []) {
      if (r.y < lo || r.y > hi) continue;
      const y = Math.round(Y(r.y)) + 0.5;
      ctx.strokeStyle = muted; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(r.label, L + 4, y - 2);
    }
    // đường dữ liệu (gộp min/max theo cột điểm ảnh)
    ctx.save(); ctx.beginPath(); ctx.rect(L, T - 1, pw, ph + 2); ctx.clip();
    const tArr = d.t;
    for (const s of this.opt.series) {
      const arr = d.series[s.key];
      if (!arr) continue;
      ctx.strokeStyle = cssv(s.color); ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.beginPath();
      let pen = false, col = -1, cmin = 0, cmax = 0, last = 0;
      const flush = () => { if (col < 0) return; const x = L + col + 0.5; if (!pen) { ctx.moveTo(x, Y(cmin)); pen = true; } else ctx.lineTo(x, Y(cmin)); if (cmax !== cmin) ctx.lineTo(x, Y(cmax)); ctx.lineTo(x, Y(last)); };
      for (let i = d.i0; i < arr.length; i++) {
        const v = arr[i];
        if (v === null || v !== v) { flush(); col = -1; pen = false; continue; }
        const c = Math.floor(X(tArr[i]) - L);
        if (c !== col) { flush(); col = c; cmin = cmax = v; } else { if (v < cmin) cmin = v; if (v > cmax) cmax = v; }
        last = v;
      }
      flush();
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
    // giá trị cuối của chuỗi chính
    const main = this.opt.series[0];
    const ma = d.series[main.key];
    if (ma && ma.length) {
      const v = ma[ma.length - 1];
      if (v === v && v !== null) {
        const x = X(tArr[tArr.length - 1]), y = Y(v);
        ctx.fillStyle = cssv('--surface'); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = cssv(main.color); ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // con trỏ dọc + chú giải
    if (this.hoverX !== null && this.hoverX >= L && this.hoverX <= L + pw) {
      const tt = t0 + ((this.hoverX - L) / pw) * tspan;
      let i = Math.min(tArr.length - 1, Math.max(d.i0, this._bsearch(tArr, tt)));
      const x = Math.round(X(tArr[i])) + 0.5;
      ctx.strokeStyle = ink2; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      this.tip.replaceChildren();
      const tl = document.createElement('div'); tl.className = 'tt'; tl.textContent = tLabel(tArr[i], true); this.tip.append(tl);
      for (const s of this.opt.series) {
        const arr = d.series[s.key];
        if (!arr) continue;
        const v = arr[i];
        const r = document.createElement('div'); r.className = 'r';
        const sw = document.createElement('i'); sw.style.background = cssv(s.color);
        const b = document.createElement('b'); b.textContent = v === null || v !== v ? '–' : v.toFixed(this.opt.nd ?? 2).replace('.', ',') + ' ' + (this.opt.unit || '');
        r.append(sw, document.createTextNode(s.label), b);
        this.tip.append(r);
      }
      this.tip.hidden = false;
      const tw = this.tip.offsetWidth;
      this.tip.style.left = Math.min(W - tw - 4, Math.max(4, x + 10 > W - tw ? x - tw - 10 : x + 10)) + 'px';
      this.tip.style.top = '6px';
    }
  }
  _bsearch(arr, t) {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(arr[lo - 1] - t) < Math.abs(arr[lo] - t)) return lo - 1;
    return lo;
  }
}
