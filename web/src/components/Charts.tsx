import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compactMoney, money, num } from '@/lib/format';

/*
 * Small SVG chart kit following the product's data-viz rules:
 * one axis, thin marks, 2px lines, 4px rounded data ends, recessive grid, hover tooltips,
 * a legend whenever there are 2+ series, fixed categorical order (never cycled), and a
 * visually-hidden data table for screen readers.
 */
export const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(200, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

interface Series { name: string; values: number[]; color?: string }

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="row wrap gap-4 text-sm" style={{ color: 'var(--ink-2)' }}>
      {items.map(i => (
        <span key={i.name} className="row gap-2">
          <span className="color-swatch" style={{ background: i.color }} aria-hidden />
          {i.name}{i.value !== undefined && <span className="strong num" style={{ color: 'var(--ink)' }}>{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      role="presentation"
      style={{
        position: 'absolute', left, top: y, transform: 'translate(-50%, calc(-100% - 10px))', background: 'var(--espresso)', color: 'var(--ink-inverse)',
        padding: '8px 10px', borderRadius: 8, fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 2,
      }}
    >
      {children}
    </div>
  );
}

/** Area/line chart over time with a crosshair tooltip. Series share one y-axis (same unit). */
export function TrendChart({ labels, series, height = 240, isMoney = true, label }: { labels: string[]; series: Series[]; height?: number; isMoney?: boolean; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - (v / max) * h;
  const fmt = isMoney ? compactMoney : (v: number) => num(v);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));
  const colors = series.map((s, i) => s.color ?? VIZ[i]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / w) * (n - 1)))));
  };

  return (
    <div className="stack gap-3">
      {series.length > 1 && <Legend items={series.map((s, i) => ({ name: s.name, color: colors[i] }))} />}
      <div ref={ref} style={{ position: 'relative' }}>
        <svg width={width} height={height} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ overflow: 'visible' }}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-axis)">{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => i % every === 0 && (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--viz-axis)">{l}</text>
          ))}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
            return (
              <g key={s.name}>
                {si === 0 && series.length === 1 && (
                  <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={colors[si]} opacity={0.1} />
                )}
                <polyline points={pts} fill="none" stroke={colors[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--line-2)" strokeDasharray="3 3" />
              {series.map((s, si) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={colors[si]} stroke="#fff" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <Tooltip x={x(hover)} y={Math.min(...series.map(s => y(s.values[hover] ?? 0)))} width={width}>
            <div style={{ opacity: 0.75, marginBottom: 3 }}>{labels[hover]}</div>
            {series.map((s, si) => (
              <div key={s.name} className="row gap-2">
                <span className="color-swatch" style={{ background: colors[si] }} />
                {series.length > 1 && <span style={{ opacity: 0.8 }}>{s.name}</span>}
                <b className="num">{isMoney ? money(s.values[hover], { decimals: false }) : num(s.values[hover])}</b>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
      <DataTableSr labels={labels} series={series} isMoney={isMoney} caption={label} />
    </div>
  );
}

/** Vertical bars (one series) or grouped bars (2–3 series) with per-bar tooltips. */
export function BarChart({ labels, series, height = 220, isMoney = true, label }: { labels: string[]; series: Series[]; height?: number; isMoney?: boolean; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values.map(Math.abs))));
  const band = w / Math.max(1, labels.length);
  const gap = 2;
  const barW = Math.max(3, Math.min(34, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const y = (v: number) => pad.t + h - (Math.max(0, v) / max) * h;
  const fmt = isMoney ? compactMoney : (v: number) => num(v);
  const colors = series.map((s, i) => s.color ?? VIZ[i]);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 64))));
  return (
    <div className="stack gap-3">
      {series.length > 1 && <Legend items={series.map((s, i) => ({ name: s.name, color: colors[i] }))} />}
      <div ref={ref} style={{ position: 'relative' }}>
        <svg width={width} height={height} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t * max)} y2={y(t * max)} stroke="var(--viz-grid)" />
              <text x={pad.l - 8} y={y(t * max)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-axis)">{fmt(t * max)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const groupW = barW * series.length + gap * (series.length - 1);
            const x0 = pad.l + band * i + (band - groupW) / 2;
            return (
              <g key={i}>
                {series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const top = y(v), bh = Math.max(v > 0 ? 1 : 0, pad.t + h - top);
                  const bx = x0 + si * (barW + gap);
                  const r = Math.min(4, barW / 2, bh);
                  return (
                    <g key={si}>
                      <rect x={bx - 2} y={pad.t} width={barW + 4} height={h} fill="transparent" onMouseEnter={() => setHover({ i, s: si })} />
                      <path
                        d={`M${bx},${pad.t + h} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${pad.t + h} Z`}
                        fill={colors[si]} opacity={hover && (hover.i !== i || hover.s !== si) ? 0.55 : 1} style={{ transition: 'opacity 120ms' }} pointerEvents="none"
                      />
                    </g>
                  );
                })}
                {i % every === 0 && <text x={pad.l + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--viz-axis)">{l}</text>}
              </g>
            );
          })}
        </svg>
        {hover && (
          <Tooltip x={pad.l + band * hover.i + band / 2} y={y(series[hover.s].values[hover.i] ?? 0)} width={width}>
            <div style={{ opacity: 0.75, marginBottom: 3 }}>{labels[hover.i]}{series.length > 1 ? ` · ${series[hover.s].name}` : ''}</div>
            <b className="num">{isMoney ? money(series[hover.s].values[hover.i], { decimals: false }) : num(series[hover.s].values[hover.i])}</b>
          </Tooltip>
        )}
      </div>
      <DataTableSr labels={labels} series={series} isMoney={isMoney} caption={label} />
    </div>
  );
}

/** Ranked horizontal bars — best for category / product comparisons with long names. Single hue. */
export function HBarChart({ items, isMoney = true, label, color = 'var(--viz-1)' }: { items: { label: string; value: number; sub?: string }[]; isMoney?: boolean; label: string; color?: string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div className="stack gap-3" role="img" aria-label={label}>
      {items.map(i => (
        <div key={i.label} className="stack gap-1" title={`${i.label}: ${isMoney ? money(i.value) : num(i.value)}`}>
          <div className="row between text-sm">
            <span className="truncate">{i.label}{i.sub && <span className="muted"> · {i.sub}</span>}</span>
            <span className="num medium">{isMoney ? compactMoney(i.value) : num(i.value)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--surface-sunken)', borderRadius: 4 }}>
            <div style={{ width: `${(i.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 260ms var(--ease)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut for part-of-whole with ≤8 slices (extra slices fold into "Other"). Always shows a legend with values. */
export function Donut({ items, isMoney = true, label, size = 168, centerLabel }: { items: { label: string; value: number }[]; isMoney?: boolean; label: string; size?: number; centerLabel?: string }) {
  const data = useMemo(() => {
    const sorted = [...items].filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= 8) return sorted;
    const head = sorted.slice(0, 7);
    return [...head, { label: 'Other', value: sorted.slice(7).reduce((s, i) => s + i.value, 0) }];
  }, [items]);
  const total = data.reduce((s, i) => s + i.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  const r = size / 2, stroke = 22, rr = r - stroke / 2 - 2, c = 2 * Math.PI * rr;
  let acc = 0;
  if (total <= 0) return <p className="muted text-sm">No data for this period.</p>;
  return (
    <div className="row wrap gap-6" style={{ alignItems: 'center' }}>
      <svg width={size} height={size} role="img" aria-label={label} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${r} ${r})`}>
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const seg = (
              <circle key={d.label} cx={r} cy={r} r={rr} fill="none" stroke={VIZ[i]} strokeWidth={hover === i ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-acc}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: 'stroke-width 120ms' }} />
            );
            acc += len;
            return seg;
          })}
        </g>
        <text x={r} y={r - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)">{hover !== null ? data[hover].label : centerLabel ?? 'Total'}</text>
        <text x={r} y={r + 14} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--ink)">
          {isMoney ? compactMoney(hover !== null ? data[hover].value : total) : num(hover !== null ? data[hover].value : total)}
        </text>
      </svg>
      <div className="stack gap-2 grow" style={{ minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={d.label} className="row gap-2 text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="color-swatch" style={{ background: VIZ[i] }} aria-hidden />
            <span className="grow truncate soft">{d.label}</span>
            <span className="num medium">{isMoney ? compactMoney(d.value) : num(d.value)}</span>
            <span className="num muted" style={{ width: 40, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataTableSr({ labels, series, isMoney, caption }: { labels: string[]; series: Series[]; isMoney: boolean; caption: string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th>Period</th>{series.map(s => <th key={s.name}>{s.name}</th>)}</tr></thead>
      <tbody>{labels.map((l, i) => <tr key={i}><td>{l}</td>{series.map(s => <td key={s.name}>{isMoney ? money(s.values[i]) : num(s.values[i])}</td>)}</tr>)}</tbody>
    </table>
  );
}
