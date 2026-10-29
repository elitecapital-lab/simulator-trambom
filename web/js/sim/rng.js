// mulberry32 – trùng khớp từng bit với trambom/rng.py
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  random() {
    const a = (this.s + 0x6d2b79f5) >>> 0;
    this.s = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a) >>> 0;
    t = (((t + (Math.imul(t ^ (t >>> 7), 61 | t) >>> 0)) >>> 0) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  gauss() {
    const u1 = 1.0 - this.random();
    const u2 = this.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
}
export function stream(seed, offset) {
  const mixed = Math.imul(seed >>> 0, 2654435761 | 0) >>> 0;
  return new Rng((mixed + offset * 40503 + 12345) >>> 0);
}
