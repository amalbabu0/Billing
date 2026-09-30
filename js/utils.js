// Formatting, dates, maths and DOM helpers shared by every module.

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sum = (arr, f = x => x) => round2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));

let inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Amount decimals from Invoice Settings (0 or 2). */
export function setDecimals(d) { const n = d === 0 ? 0 : 2; inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: n, maximumFractionDigits: n }); }
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const money = n => (n < 0 ? '-' : '') + '₹' + inr.format(Math.abs(Number(n) || 0));
export const amt = n => inr.format(Number(n) || 0);
export const money0 = n => (n < 0 ? '-' : '') + '₹' + inr0.format(Math.abs(Number(n) || 0));
export const qty = n => qtyFmt.format(Number(n) || 0);
export const pct = n => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) + '%' : '—');

// Dates are stored as ISO yyyy-mm-dd strings (local calendar day).
export const iso = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const today = () => iso();
export const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fdate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
export const fdateShort = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${d} ${MONTHS[+m - 1]}`; };
export const monthStart = (d = today()) => d.slice(0, 8) + '01';
export const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tiny hyperscript: h('div', {class:'x', onclick}, child, 'text', [more]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Case-insensitive match of a query against any of the given values; all words must match. */
export function matches(query, ...values) {
  if (!query) return true;
  const hay = values.map(v => String(v ?? '')).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

/** Amount in Indian words (for invoices). */
export function inWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const words = x => {
    if (x === 0) return 'Zero';
    const parts = [];
    const cr = Math.floor(x / 1e7); x %= 1e7;
    const lk = Math.floor(x / 1e5); x %= 1e5;
    const th = Math.floor(x / 1e3); x %= 1e3;
    if (cr) parts.push(words(cr) + ' Crore');
    if (lk) parts.push(two(lk) + ' Lakh');
    if (th) parts.push(two(th) + ' Thousand');
    if (x) parts.push(three(x));
    return parts.join(' ');
  };
  const r = Math.floor(Math.abs(n)), p = Math.round((Math.abs(n) - r) * 100);
  return 'Rupees ' + words(r) + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}

/** Deterministic PRNG for seed data. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), pick: arr => arr[Math.floor(next() * arr.length)] };
}

/** Replace an element's children, flattening arrays and skipping null/false (unlike replaceChildren). */
export function fill(el, ...children) { el.replaceChildren(); appendAll(el, children); return el; }
