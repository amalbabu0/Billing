// Small SVG charts: a multi-series line chart with crosshair tooltip, and ranked horizontal bars.
// Colours come from CSS roles (--series-1, --series-2) so the palette is set in one place.
import { h, money0, fdateShort, fill } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const compact = v => (v >= 1e7 ? (v / 1e7).toFixed(1) + ' Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + ' L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v)));

/** series: [{ name, values:number[], color:'var(--series-1)' }], labels: ISO dates */
export function lineChart({ labels, series, height = 220, label }) {
  const W = 640, H = height, P = { l: 52, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const x = i => P.l + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * (W - P.l - P.r));
  const y = v => P.t + (1 - v / max) * (H - P.t - P.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }); t.textContent = compact(v); svg.append(t);
  }
  const step = Math.max(1, Math.ceil(labels.length / 7));
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) { const t = svgEl('text', { x: x(i), y: H - 8, class: 'axis', 'text-anchor': 'middle' }); t.textContent = fdateShort(l); svg.append(t); } });
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  // Crosshair + tooltip
  const cross = svgEl('line', { y1: P.t, y2: H - P.b, class: 'crosshair', visibility: 'hidden' });
  const dots = series.map(s => svgEl('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const hit = svgEl('rect', { x: P.l, y: P.t, width: W - P.l - P.r, height: H - P.t - P.b, fill: 'transparent' });
  svg.append(hit);
  const wrap = h('div', { class: 'chart-wrap' }, svg, tip);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (labels.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', x(i)); d.setAttribute('cy', y(series[k].values[i])); d.setAttribute('visibility', 'visible'); });
    tip.hidden = false;
    fill(tip, h('b', null, fdateShort(labels[i])), ...series.map(s => h('div', { class: 'tip-row' }, h('i', { style: { background: s.color } }), s.name, h('span', null, money0(s.values[i])))));
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.min(r.width - 170, Math.max(0, left + 12)) + 'px';
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); });
  const legend = series.length > 1 ? h('div', { class: 'legend' }, series.map(s => h('span', null, h('i', { style: { background: s.color } }), s.name))) : null;
  return h('div', null, legend, wrap);
}

/** rows: [{ label, value, sub }] — single hue, value labels on every bar (ranked list). */
export function barList({ rows, format = money0, empty = 'No data' }) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  const max = Math.max(...rows.map(r => r.value), 1);
  return h('div', { class: 'barlist' }, rows.map(r => h('div', { class: 'bar-row', title: `${r.label}: ${format(r.value)}` },
    h('div', { class: 'bar-label' }, h('span', { class: 'truncate' }, r.label), h('b', null, format(r.value))),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(1.5, (r.value / max) * 100)}%` } })),
    r.sub ? h('div', { class: 'bar-sub muted small' }, r.sub) : null)));
}
