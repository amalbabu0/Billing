import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Boxes, SlidersHorizontal } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, label, money, qty } from '@/lib/format';
import { P } from '@/lib/perms';
import type { InventoryRow, LocationStockRow, Movement } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { DocNo, EmptyState, Money, Notice, Status, Tabs, Timeline } from './ui/display';
import { Drawer, Modal } from './ui/overlay';
import { NumberInput, TextInput } from './ui/form';
import { useWarehouses, WarehouseSelect } from './Locations';

interface HistoryRow { date: string; docType: string; docId: number; docNumber?: string; party?: string; quantity: number; rate?: number | null; note?: string }
interface ReservedRow { salesOrderId: number; salesOrderNumber: string; customerName: string; status: string; orderDate: string; expectedDeliveryDate?: string; reservedQty: number }
interface StockDetail { item: InventoryRow; stockValue?: number | null; purchases: HistoryRow[]; sales: HistoryRow[]; returns: HistoryRow[]; adjustments: HistoryRow[]; reservations: ReservedRow[]; timeline: Movement[] }

const ROUTES: Record<string, string> = { PURCHASE: '/purchases/', INVOICE: '/sales/invoices/', SALES_ORDER: '/sales/orders/', DEBIT_NOTE: '/purchases/' };

/** Everything about one variant's stock: levels, where it came from, where it went, and what is promised. */
export function StockDrawer({ variantId, onClose }: { variantId: number | null; onClose: () => void }) {
  const can = useCan();
  const [tab, setTab] = useState<'timeline' | 'purchases' | 'sales' | 'returns' | 'adjustments' | 'reserved'>('timeline');
  const [adjust, setAdjust] = useState(false);
  const { data: d, isLoading } = useQuery({ queryKey: ['stock-detail', variantId], queryFn: () => api.get<StockDetail>(`/api/inventory/${variantId}`), enabled: variantId !== null });
  useEffect(() => setTab('timeline'), [variantId]);
  const it = d?.item;
  return (
    <Drawer wide open={variantId !== null} onClose={onClose} title={it?.displayName ?? 'Stock'} sub={it && <><span className="mono">{it.sku}</span> · {it.categoryName}</>}
      headerExtra={it && <Status value={it.stockState} />}
      footer={it && <>
        {can(P.InventoryAdjust) && <button className="btn btn-primary" onClick={() => setAdjust(true)}><SlidersHorizontal aria-hidden />Adjust stock</button>}
        <Link className="btn" to={`/products/${it.productId}`}>Open product</Link>
      </>}>
      {isLoading || !d || !it ? <p className="muted">Loading…</p> : (
        <div className="stack gap-5">
          <div className="grid grid-4">
            <Level label="Available" value={it.available} tone={it.available <= 0 ? 'bad' : it.available <= it.minStock ? 'warn' : undefined} hint={`min ${qty(it.minStock)}`} />
            <Level label="Reserved" value={it.reserved} hint="for confirmed orders" />
            <Level label="Damaged" value={it.damaged} hint="not sellable" />
            <Level label="On hand" value={it.onHand} hint={d.stockValue !== null && d.stockValue !== undefined ? `value ${money(d.stockValue, { decimals: false })}` : 'physical, incl. reserved'} />
          </div>
          <ByLocation variantId={it.variantId} />
          <Tabs value={tab} onChange={setTab} label="Stock history" tabs={[
            { value: 'timeline', label: 'Movements', count: d.timeline.length }, { value: 'purchases', label: 'Purchases', count: d.purchases.length },
            { value: 'sales', label: 'Sales', count: d.sales.length }, { value: 'returns', label: 'Returns', count: d.returns.length },
            { value: 'adjustments', label: 'Adjustments', count: d.adjustments.length }, { value: 'reserved', label: 'Reservations', count: d.reservations.length },
          ]} />
          {tab === 'timeline' && (d.timeline.length === 0 ? <EmptyState compact title="No movements yet" /> : (
            <Timeline items={d.timeline.map(m => {
              const change = m.onHandDelta + m.damagedDelta;
              const inbound = m.onHandDelta > 0 || (m.onHandDelta === 0 && m.reservedDelta < 0);
              return {
                key: m.id, tone: m.movementType.includes('DAMAGE') || m.movementType === 'RETURN_DAMAGED' ? 'warn' as const : inbound ? 'ok' as const : m.movementType === 'RESERVE' ? 'info' as const : 'brand' as const,
                icon: inbound ? <ArrowDownLeft /> : <ArrowUpRight />,
                title: <span className="row gap-2">{label(m.movementType)} {m.refNumber && <DocNo to={m.refType && ROUTES[m.refType] && m.refId ? ROUTES[m.refType] + m.refId : undefined}>{m.refNumber}</DocNo>}</span>,
                time: dateTime(m.createdAt),
                detail: <span className="row wrap gap-3">
                  {change !== 0 && <b className={change > 0 ? 't-ok' : 't-bad'}>{change > 0 ? '+' : ''}{qty(change)}</b>}
                  {m.reservedDelta !== 0 && <span>reserved {m.reservedDelta > 0 ? '+' : ''}{qty(m.reservedDelta)}</span>}
                  <span className="muted">on hand {qty(m.onHandAfter)} · reserved {qty(m.reservedAfter)}{m.damagedAfter ? ` · damaged ${qty(m.damagedAfter)}` : ''}</span>
                  {m.note && <span className="muted">· {m.note}</span>}{m.createdByName && <span className="muted">· {m.createdByName}</span>}
                </span>,
              };
            })} />
          ))}
          {tab !== 'timeline' && tab !== 'reserved' && <HistoryTable rows={d[tab]} kind={tab} />}
          {tab === 'reserved' && (d.reservations.length === 0 ? <EmptyState compact title="Nothing reserved" desc="Confirmed sales orders reserve stock here." /> : (
            <div className="table-card"><table className="data compact"><thead><tr><th>Order</th><th>Customer</th><th>Delivery by</th><th className="num">Reserved</th></tr></thead>
              <tbody>{d.reservations.map(r => <tr key={r.salesOrderId}><td><DocNo to={`/sales/orders/${r.salesOrderId}`}>{r.salesOrderNumber}</DocNo></td><td>{r.customerName}</td><td>{date(r.expectedDeliveryDate)}</td><td className="num strong">{qty(r.reservedQty)}</td></tr>)}</tbody></table></div>
          ))}
        </div>
      )}
      {it && <AdjustStockModal open={adjust} onClose={() => setAdjust(false)} item={it} />}
    </Drawer>
  );
}

function ByLocation({ variantId }: { variantId: number }) {
  const { data: warehouses = [] } = useWarehouses();
  const { data = [] } = useQuery({ queryKey: ['location-stock', 'variant', variantId], queryFn: () => api.get<LocationStockRow[]>('/api/warehouses/stock', { variantId }), enabled: warehouses.length > 1 });
  if (warehouses.length <= 1) return null;
  return (
    <div className="row wrap gap-2" aria-label="Stock by location">
      {data.map(r => <span key={r.warehouseId} className="chip" style={{ cursor: 'default' }}>{r.warehouseName} <b>{qty(r.onHand)}</b>{r.damaged ? <span className="t-bad"> · {qty(r.damaged)} dmg</span> : null}{r.inTransit ? <span className="t-warn"> · {qty(r.inTransit)} arriving</span> : null}</span>)}
    </div>
  );
}

function Level({ label: l, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'bad' | 'warn' }) {
  return <div className={`kpi${tone ? ` tone-${tone}` : ''}`} style={{ padding: 12 }}><span className="kpi-label">{l}</span><span className="kpi-value sm">{qty(value)}</span>{hint && <span className="kpi-foot">{hint}</span>}</div>;
}

function HistoryTable({ rows, kind }: { rows: HistoryRow[]; kind: string }) {
  if (rows.length === 0) return <EmptyState compact title={`No ${kind} recorded`} />;
  return (
    <div className="table-card">
      <table className="data compact">
        <thead><tr><th>Date</th><th>Document</th><th>{kind === 'purchases' ? 'Supplier' : kind === 'adjustments' ? 'By' : 'Customer'}</th><th className="num">Qty</th>{kind !== 'adjustments' && kind !== 'returns' && <th className="num">Rate</th>}<th>Note</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td>{date(r.date)}</td>
            <td>{r.docNumber ? <DocNo to={ROUTES[r.docType] && r.docId ? ROUTES[r.docType] + r.docId : undefined}>{r.docNumber}</DocNo> : label(r.docType)}</td>
            <td>{r.party ?? '—'}</td>
            <td className={`num strong ${r.quantity < 0 ? 't-bad' : ''}`}>{qty(r.quantity)}</td>
            {kind !== 'adjustments' && kind !== 'returns' && <td className="num">{r.rate !== null && r.rate !== undefined ? <Money value={r.rate} /> : '—'}</td>}
            <td className="text-sm soft">{r.note ?? (kind === 'adjustments' ? label(r.docType) : '')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const TYPES = [
  { value: 'INCREASE', label: 'Add stock', hint: 'Found / opening correction' },
  { value: 'DECREASE', label: 'Remove stock', hint: 'Lost, stolen, used' },
  { value: 'MARK_DAMAGED', label: 'Mark damaged', hint: 'Moves sellable → damaged' },
  { value: 'DAMAGE_REPAIRED', label: 'Repaired', hint: 'Damaged → sellable' },
  { value: 'DAMAGE_WRITE_OFF', label: 'Write off damaged', hint: 'Scrapped' },
  { value: 'SET_DISPLAY', label: 'Set display qty', hint: 'Pieces on the showroom floor' },
];

export function AdjustStockModal({ open, onClose, item }: { open: boolean; onClose: () => void; item: Pick<InventoryRow, 'variantId' | 'displayName' | 'available' | 'damaged' | 'onHand' | 'reserved'> }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState('INCREASE');
  const [amount, setAmount] = useState<number | null>(1);
  const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setType('INCREASE'); setAmount(1); setReason(''); setError(undefined); } }, [open]);
  const after = (() => {
    const q = amount ?? 0;
    switch (type) {
      case 'INCREASE': return { available: item.available + q, damaged: item.damaged };
      case 'DECREASE': return { available: item.available - q, damaged: item.damaged };
      case 'MARK_DAMAGED': return { available: item.available - q, damaged: item.damaged + q };
      case 'DAMAGE_REPAIRED': return { available: item.available + q, damaged: item.damaged - q };
      case 'DAMAGE_WRITE_OFF': return { available: item.available, damaged: item.damaged - q };
      default: return { available: item.available, damaged: item.damaged };
    }
  })();
  const save = useMutation({
    mutationFn: () => api.post<{ number: string }>('/api/inventory/adjust', { variantId: item.variantId, adjustmentType: type, quantity: amount, reason, unitCost, warehouseId }),
    onSuccess: r => { toast.success('Stock updated successfully', `${r.number} · ${item.displayName}`); ['inventory', 'stock-detail', 'products', 'dashboard', 'movements'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
    onError: e => setError(errorMessage(e)),
  });
  const invalid = !amount || amount <= 0 || reason.trim().length < 3 || after.available < 0 || after.damaged < 0;
  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={invalid || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate()}>Save adjustment</button></>}>
      <div className="stack gap-4">
        <div><div className="medium">{item.displayName}</div><div className="text-sm muted">Available {qty(item.available)} · reserved {qty(item.reserved)} · damaged {qty(item.damaged)}</div></div>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="grid grid-2" style={{ gap: 8 }} role="radiogroup" aria-label="Adjustment type">
          {TYPES.map(t => (
            <label key={t.value} className="card" style={{ padding: '10px 12px', cursor: 'pointer', borderColor: type === t.value ? 'var(--espresso)' : undefined, boxShadow: type === t.value ? 'var(--ring)' : undefined }}>
              <span className="row gap-2"><input type="radio" name="adj" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} /><b className="text-sm">{t.label}</b></span>
              <span className="text-xs muted" style={{ display: 'block', marginLeft: 22 }}>{t.hint}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-2">
          <NumberInput label="Quantity" value={amount} min={0} onChange={setAmount} autoFocus />
          {type === 'INCREASE' && <NumberInput label="Unit cost" optional money value={unitCost} onChange={setUnitCost} hint="For stock valuation" />}
        </div>
        {type !== 'SET_DISPLAY' && <WarehouseSelect label="At location" value={warehouseId} onChange={setWarehouseId} hint={type === 'INCREASE' ? 'Where the stock is added' : 'Taken from here first'} />}
        <TextInput label="Reason" required value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Physical count on 25 Sep" hint="Kept in the activity log." />
        {type !== 'SET_DISPLAY' && (
          <Notice tone={after.available < 0 || after.damaged < 0 ? 'bad' : 'info'} icon={<Boxes aria-hidden />}>
            After this: <b>{qty(after.available)}</b> available · <b>{qty(after.damaged)}</b> damaged{after.available < 0 ? ' — not enough sellable stock' : ''}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
