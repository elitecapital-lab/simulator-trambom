// Trợ giúp DOM nhỏ gọn: h('div', {class:'x'}, 'text', child)
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const fmt = (v, nd = 2, unit = '') => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(nd).replace('.', ',') + (unit ? ' ' + unit : ''));
export const SEV_LABEL = { info: 'thông tin', warning: 'cảnh báo', alarm: 'báo động', critical: 'khẩn' };
const p2 = (n) => String(n).padStart(2, '0');
export const tShort = (t) => { const d = Math.floor(t / 86400), s = Math.floor(t % 86400); return `N${d + 1} ${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}`; };
