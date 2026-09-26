import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Layers, Package, Plus, Search, User, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { rangeFor } from '@/lib/hooks';
import { money, date as fmtDate } from '@/lib/format';
import type { Customer, Paged, RawMaterial, Sellable, Supplier } from '@/lib/types';
import { StockLevel } from './ui/display';

/**
 * Accessible async combobox (WAI-ARIA 1.2 pattern): type to search, ↑/↓ to move, Enter to pick, Esc to close.
 */
export function Combobox<T>({
  value, onSearch, results, loading, onPick, renderItem, itemKey, placeholder, label, icon, footer, autoFocus, inputRef, onEnterRaw, error, clearOnPick,
}: {
  value?: ReactNode; onSearch: (text: string) => void; results: T[]; loading?: boolean; onPick: (item: T) => void; renderItem: (item: T) => ReactNode;
  itemKey: (item: T) => string | number; placeholder?: string; label: string; icon?: ReactNode; footer?: ReactNode; autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>; onEnterRaw?: (text: string) => boolean; error?: string; clearOnPick?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (item: T) => {
    onPick(item);
    if (clearOnPick !== false) { setText(''); onSearch(''); }
    setOpen(false);
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }} className="field">
      <div className="input-wrap has-left">
        <span className="adorn" aria-hidden>{icon ?? <Search />}</span>
        <input
          ref={ref} className="input" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={label}
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined} aria-invalid={error ? true : undefined}
          placeholder={placeholder} value={text} autoFocus={autoFocus} autoComplete="off" spellCheck={false}
          onChange={e => { setText(e.target.value); onSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (onEnterRaw && text && onEnterRaw(text)) { setText(''); onSearch(''); setOpen(false); return; }
              if (open && results[active]) pick(results[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {value}
      {error && <div className="field-error">{error}</div>}
      {open && (text || results.length > 0) && (
        <div className="popover" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxWidth: 'none', maxHeight: 360, overflowY: 'auto' }}>
          <ul id={listId} role="listbox" aria-label={label} className="list-plain">
            {results.map((r, i) => (
              <li
                key={itemKey(r)} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className="menu-item" data-active={i === active} style={{ height: 'auto', minHeight: 40, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'normal' }}
                onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(r); }}
              >
                {renderItem(r)}
              </li>
            ))}
          </ul>
          {!loading && results.length === 0 && text && <div className="muted text-sm" style={{ padding: '10px 12px' }}>No matches for “{text}”.</div>}
          {loading && results.length === 0 && <div className="muted text-sm" style={{ padding: '10px 12px' }}>Searching…</div>}
          {footer && <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4 }}>{footer}</div>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ customer
export function CustomerPicker({ value, onChange, onCreate, allowWalkIn, label = 'Customer', error, autoFocus }: {
  value: Customer | null; onChange: (c: Customer | null) => void; onCreate?: (name: string) => void; allowWalkIn?: boolean; label?: string; error?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 200);
  const { data = [], isFetching } = useQuery({
    queryKey: ['customer-search', q], queryFn: () => api.get<Customer[]>('/api/customers/search', { q }), staleTime: 30_000,
  });
  const results = data.filter(c => allowWalkIn || !c.isWalkIn);
  if (value) {
    return (
      <div className="field">
        <div className="row gap-3" style={{ padding: '8px 10px', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
          <span className="icon-circle tone-brand"><User aria-hidden /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="medium truncate">{value.name}</div>
            <div className="text-xs muted truncate">{[value.mobile, value.gstin && `GSTIN ${value.gstin}`, value.city].filter(Boolean).join(' · ') || (value.isWalkIn ? 'Counter sale' : '—')}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(null)} aria-label="Change customer"><X /></button>
        </div>
      </div>
    );
  }
  return (
    <Combobox
      label={label} placeholder="Search name, mobile or GSTIN" icon={<User />} results={results} loading={isFetching} onSearch={setText} onPick={onChange}
      itemKey={c => c.id} error={error} autoFocus={autoFocus}
      renderItem={c => (
        <div className="row gap-3" style={{ width: '100%' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="medium truncate">{c.name}{c.isWalkIn && <span className="muted"> · counter sale</span>}</div>
            <div className="text-xs muted truncate">{[c.mobile, c.city, c.gstin].filter(Boolean).join(' · ')}</div>
          </div>
          {c.outstanding > 0 && <span className="text-xs t-bad num">Due {money(c.outstanding, { decimals: false })}</span>}
        </div>
      )}
      footer={onCreate && (
        <button type="button" className="menu-item" onMouseDown={e => { e.preventDefault(); onCreate(text); }}>
          <Plus /> {text ? <>Add “{text}” as a new customer</> : 'Add a new customer'}
        </button>
      )}
    />
  );
}

// ------------------------------------------------------------ supplier
export function SupplierPicker({ value, onChange, error }: { value: Supplier | null; onChange: (s: Supplier | null) => void; error?: string }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 200);
  const { data, isFetching } = useQuery({
    queryKey: ['supplier-search', q], queryFn: () => api.get<{ items: Supplier[] }>('/api/suppliers', { search: q, pageSize: 12 }), staleTime: 30_000,
  });
  if (value) {
    return (
      <div className="row gap-3" style={{ padding: '8px 10px', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="medium truncate">{value.name}</div>
          <div className="text-xs muted truncate">{[value.gstin && `GSTIN ${value.gstin}`, value.state, value.mobile].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(null)} aria-label="Change supplier"><X /></button>
      </div>
    );
  }
  return (
    <Combobox
      label="Supplier" placeholder="Search supplier name or GSTIN" results={data?.items ?? []} loading={isFetching} onSearch={setText} onPick={onChange}
      itemKey={s => s.id} error={error}
      renderItem={s => (
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="medium truncate">{s.name}</div>
          <div className="text-xs muted truncate">{[s.gstin, s.state, s.outstanding > 0 && `Payable ${money(s.outstanding, { decimals: false })}`].filter(Boolean).join(' · ')}</div>
        </div>
      )}
    />
  );
}

// ------------------------------------------------------------ product
export function ProductPicker({ onPick, placeholder = 'Search product, SKU or scan barcode', autoFocus, inputRef, showStock = true, label = 'Add product' }: {
  onPick: (s: Sellable) => void; placeholder?: string; autoFocus?: boolean; inputRef?: React.RefObject<HTMLInputElement | null>; showStock?: boolean; label?: string;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 160);
  const { data = [], isFetching } = useQuery({
    queryKey: ['sellable', q], queryFn: () => api.get<Sellable[]>('/api/sellable', { search: q, limit: 20 }), enabled: q.trim().length > 0, staleTime: 20_000,
  });
  return (
    <Combobox
      label={label} placeholder={placeholder} icon={<Package />} results={q.trim() ? data : []} loading={isFetching} onSearch={setText} onPick={onPick}
      itemKey={s => s.variantId} autoFocus={autoFocus} inputRef={inputRef}
      renderItem={s => (
        <div className="row gap-3" style={{ width: '100%' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="medium truncate">{s.displayName}</div>
            <div className="text-xs muted truncate"><span className="mono">{s.sku}</span>{s.categoryName && ` · ${s.categoryName}`}{s.material && ` · ${s.material}`}</div>
          </div>
          {showStock && <span className="text-xs"><StockLevel available={s.available} isStockItem={s.isStockItem} /></span>}
          <span className="num medium">{money(s.sellingPrice, { decimals: false })}</span>
        </div>
      )}
    />
  );
}

// ------------------------------------------------------------ dates
export const PRESETS = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }, { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' }, { value: 'fy', label: 'This FY' },
] as const;

/**
 * Date range control: preset chips for the common cases, custom dates when needed.
 * `value` = { preset, from, to }. Presets are resolved to dates here so APIs always get explicit ranges.
 */
export function DateRange({ value, onChange, presets = ['today', 'yesterday', '7d', '30d', 'month', 'custom'] }: {
  value: { preset: string; from: string; to: string }; onChange: (v: { preset: string; from: string; to: string }) => void; presets?: string[];
}) {
  const opts = [...PRESETS.filter(p => presets.includes(p.value)), ...(presets.includes('custom') ? [{ value: 'custom', label: 'Custom' }] : [])];
  return (
    <div className="row wrap gap-2" role="group" aria-label="Date range">
      <div className="segmented">
        {opts.map(o => (
          <button key={o.value} type="button" aria-pressed={value.preset === o.value}
            onClick={() => onChange(o.value === 'custom' ? { ...value, preset: 'custom' } : { preset: o.value, ...rangeFor(o.value) })}>
            {o.value === 'custom' && <CalendarDays aria-hidden />}{o.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="row gap-2">
          <input type="date" className="input input-sm" style={{ width: 150 }} value={value.from} max={value.to} aria-label="From date"
            onChange={e => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="muted">to</span>
          <input type="date" className="input input-sm" style={{ width: 150 }} value={value.to} min={value.from} aria-label="To date"
            onChange={e => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
      {value.preset !== 'custom' && value.preset !== 'today' && value.preset !== 'yesterday' && (
        <span className="text-xs muted desktop-only">{fmtDate(value.from)} – {fmtDate(value.to)}</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------ raw material
export function RawMaterialPicker({ onPick, label = 'Add material', autoFocus }: { onPick: (m: RawMaterial) => void; label?: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 160);
  const { data, isFetching } = useQuery({ queryKey: ['rm-pick', q], queryFn: () => api.get<Paged<RawMaterial>>('/api/raw-materials', { search: q, pageSize: 20 }), staleTime: 20_000 });
  return (
    <Combobox label={label} placeholder="Search raw material" icon={<Layers />} results={data?.items ?? []} loading={isFetching} onSearch={setText} onPick={onPick} autoFocus={autoFocus}
      itemKey={m => m.id}
      renderItem={m => (
        <div className="row gap-3" style={{ width: '100%' }}>
          <div className="grow" style={{ minWidth: 0 }}><div className="medium truncate">{m.name}</div><div className="text-xs muted"><span className="mono">{m.code}</span> · {m.category}</div></div>
          <span className={`text-xs ${m.isLow ? 't-bad' : 'muted'}`}>{m.stock.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {m.unit}</span>
        </div>
      )} />
  );
}
