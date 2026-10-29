// Tiện ích dùng chung – tương đương trambom/util.py
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const deepCopy = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const pmod = (a, n) => ((a % n) + n) % n;
export const round3 = (x) => Math.round(x * 1000) / 1000;

export function getPath(d, path) {
  let cur = d;
  for (const k of path.split('.')) cur = cur[k];
  return cur;
}
export function setPath(d, path, value) {
  const keys = path.split('.');
  let cur = d;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}
export function flatten(d, prefix = '') {
  const out = {};
  for (const k of Object.keys(d).sort()) {
    const v = d[k];
    const p = prefix ? prefix + '.' + k : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, p));
    else out[p] = v;
  }
  return out;
}
export function valuesEqual(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}
export function fnv1a(text) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (const ch of bytes) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
export function canonical(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (typeof obj === 'object') return '{' + Object.keys(obj).sort().map((k) => `"${k}":${canonical(obj[k])}`).join(',') + '}';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') return Number(obj.toPrecision(6)).toString();
  return JSON.stringify(obj);
}
export const DOW_VI = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const p2 = (n) => String(n).padStart(2, '0');
export function fmtClock(t, startDow = 0) {
  const day = Math.floor(t / 86400);
  const s = Math.floor(t % 86400);
  return `Ngày ${day + 1} · ${DOW_VI[(startDow + day) % 7]} ${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}
export function fmtHM(t) {
  const s = Math.round(t) % 86400;
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}`;
}
export function fmtNum(v, nd = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return v.toFixed(nd).replace('.', ',');
}
