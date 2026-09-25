import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, Ban, Check, CheckCircle2, ChevronRight, CircleDashed, Clock, Info, Minus, PackageX, Truck, TriangleAlert, XCircle,
} from 'lucide-react';
import { label as statusLabel, money, initials } from '@/lib/format';
import { toneOf, type Tone } from '@/lib/status';

// ------------------------------------------------------------ status
const TONE_ICON: Record<Tone, typeof Check> = { ok: CheckCircle2, warn: Clock, bad: XCircle, info: CircleDashed, muted: Minus, brand: Info };
const SPECIAL_ICON: Record<string, typeof Check> = {
  OVERDUE: TriangleAlert, OUT_OF_STOCK: PackageX, OUT_FOR_DELIVERY: Truck, CANCELLED: Ban, VOIDED: Ban, LOW_STOCK: AlertCircle, DRAFT: CircleDashed,
};

export function Badge({ tone = 'muted', icon, children, className = '' }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={`badge tone-${tone} ${className}`}>{icon}{children}</span>;
}

/** Status pill: tone + icon + words (never colour alone). */
export function Status({ value, text, tone }: { value?: string | null; text?: string; tone?: Tone }) {
  if (!value && !text) return null;
  const t = tone ?? toneOf(value);
  const Icon = (value && SPECIAL_ICON[value]) || TONE_ICON[t];
  return (
    <span className={`badge tone-${t}`}>
      <Icon aria-hidden />
      {text ?? statusLabel(value)}
    </span>
  );
}

// ------------------------------------------------------------ numbers
export function Money({ value, decimals = true, className = '', signed = false, strong = false }: { value?: number | null; decimals?: boolean; className?: string; signed?: boolean; strong?: boolean }) {
  return <span className={`money ${value !== undefined && value !== null && value < 0 ? 'neg' : ''} ${strong ? 'strong' : ''} ${className}`}>{money(value, { decimals, sign: signed })}</span>;
}

export function DocNo({ children, to }: { children?: ReactNode; to?: string }) {
  if (!children) return <span className="muted">—</span>;
  return to ? <Link className="doc-no" to={to} onClick={e => e.stopPropagation()}>{children}</Link> : <span className="doc-no">{children}</span>;
}

export function Delta({ value, suffix = 'vs previous period' }: { value?: number | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className="muted">No comparison</span>;
  const dir = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return (
    <>
      <span className={`delta ${dir}`}><Icon aria-hidden />{Math.abs(value).toFixed(1)}%</span>
      <span>{suffix}</span>
    </>
  );
}

// ------------------------------------------------------------ KPI & stats
export function Kpi({ label, value, icon, foot, to, tone, small, loading }: {
  label: string; value: ReactNode; icon?: ReactNode; foot?: ReactNode; to?: string; tone?: 'bad' | 'warn'; small?: boolean; loading?: boolean;
}) {
  const body = (
    <>
      <div className="kpi-label">{icon}{label}</div>
      {loading ? <div className="skeleton" style={{ height: 30, width: '60%', margin: '4px 0' }} /> : <div className={`kpi-value${small ? ' sm' : ''}`}>{value}</div>}
      <div className="kpi-foot">{loading ? <span className="skeleton skeleton-line" style={{ width: '70%' }} /> : foot}</div>
    </>
  );
  return to
    ? <Link to={to} className={`kpi${tone ? ` tone-${tone}` : ''}`}>{body}</Link>
    : <div className={`kpi${tone ? ` tone-${tone}` : ''}`}>{body}</div>;
}

export function StatStrip({ items, loading }: { items: { label: ReactNode; value: ReactNode; tone?: 'ok' | 'bad' | 'warn'; dot?: string }[]; loading?: boolean }) {
  return (
    <div className="stat-strip" role="group">
      {items.map((s, i) => (
        <div className="stat" key={i}>
          <div className="stat-label">{s.dot && <span className="dot" style={{ background: s.dot }} />}{s.label}</div>
          {loading ? <div className="skeleton" style={{ height: 22, width: '55%', marginTop: 4 }} /> : <div className={`stat-value${s.tone ? ` t-${s.tone}` : ''}`}>{s.value}</div>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ page structure
export function PageHeader({ title, desc, crumbs, actions, badge }: {
  title: ReactNode; desc?: ReactNode; crumbs?: { label: string; to?: string }[]; actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="row gap-1">
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight aria-hidden />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}{badge}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, sub, actions, children, className = '', bodyClass = 'card-body', footer, id }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string; footer?: ReactNode; id?: string;
}) {
  return (
    <section className={`card ${className}`} aria-labelledby={id}>
      {(title || actions) && (
        <div className="card-header">
          <div className="grow">
            {title && <h2 className="card-title" id={id}>{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {bodyClass ? <div className={bodyClass}>{children}</div> : children}
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number; hidden?: boolean }[]; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode; title?: string }[]; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ states
export function EmptyState({ icon, title, desc, action, compact }: { icon?: ReactNode; title: string; desc?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

export function ErrorPanel({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="error-panel" role="alert">
      <AlertCircle aria-hidden />
      <div className="grow">
        <div className="medium">Couldn’t load this</div>
        <div className="text-sm">{msg}</div>
      </div>
      {retry && <button className="btn btn-sm btn-danger-soft" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Notice({ tone, icon, children, action }: { tone?: 'warn' | 'info' | 'ok' | 'bad'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'warn' ? TriangleAlert : tone === 'ok' ? CheckCircle2 : tone === 'bad' ? AlertCircle : Info;
  return (
    <div className={`notice${tone ? ` tone-${tone}` : ''}`} role={tone === 'bad' ? 'alert' : undefined}>
      {icon ?? <Icon aria-hidden />}
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 12, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="stack gap-4" style={{ padding: 20 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row gap-4">
          {Array.from({ length: cols }).map((__, j) => <Skeleton key={j} w={j === 0 ? '28%' : `${12 + ((i + j) % 3) * 4}%`} h={12} />)}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, size }: { name?: string | null; size?: 'sm' | 'lg' }) {
  return <span className={`avatar${size ? ` ${size}` : ''}`} aria-hidden>{initials(name)}</span>;
}

export function KV({ items }: { items: ([ReactNode, ReactNode] | false | null | undefined)[] }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map((it, i) => {
        const [k, v] = it as [ReactNode, ReactNode];
        return [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`}>{v ?? <span className="muted">—</span>}</dd>];
      })}
    </dl>
  );
}

// ------------------------------------------------------------ progress
export function Tracker({ steps, current, cancelled, skipped = [] }: { steps: { key: string; label: string }[]; current: string; cancelled?: boolean; skipped?: string[] }) {
  const idx = steps.findIndex(s => s.key === current);
  return (
    <ol className={`tracker${cancelled ? ' cancelled' : ''}`} aria-label="Progress">
      {steps.map((s, i) => {
        const state = skipped.includes(s.key) ? 'skipped' : i < idx || (i === idx && current === steps[steps.length - 1].key) ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={s.key} className={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step">{state === 'done' ? <Check aria-hidden /> : i + 1}</span>
            <span className="step-label">{s.label}{state === 'skipped' && <><br /><span className="muted">not needed</span></>}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Timeline({ items }: { items: { key: string | number; title: ReactNode; time?: ReactNode; detail?: ReactNode; tone?: Tone; icon?: ReactNode }[] }) {
  if (items.length === 0) return <p className="muted text-sm">No history yet.</p>;
  return (
    <ol className="timeline">
      {items.map(it => (
        <li key={it.key}>
          <span className={`tl-dot tone-${it.tone ?? 'muted'}`} aria-hidden>{it.icon}</span>
          <div className="tl-head"><span className="tl-title">{it.title}</span>{it.time && <span className="tl-time">{it.time}</span>}</div>
          {it.detail && <div className="tl-detail">{it.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

export function StockLevel({ available, reserved, min, isStockItem = true, bare }: { available: number; reserved?: number; min?: number; isStockItem?: boolean; bare?: boolean }) {
  if (!isStockItem) return bare ? <span className="muted">—</span> : <span className="text-xs" style={{ color: 'var(--walnut)' }}>Made to order</span>;
  const state = available <= 0 ? 'out' : min !== undefined && available <= min ? 'low' : 'ok';
  const cls = state === 'out' ? 't-bad' : state === 'low' ? 't-warn' : '';
  return (
    <span className="row gap-2" style={{ display: 'inline-flex' }}>
      <span className={`num ${bare ? 'strong' : 'text-xs medium'} ${cls}`}>{bare ? available : state === 'out' ? 'Out of stock' : `${available} in stock`}</span>
      {reserved ? <span className="text-xs muted">+{reserved} reserved</span> : null}
    </span>
  );
}
