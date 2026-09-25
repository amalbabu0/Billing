import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, History, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { dateTime, label, qty } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { InventoryRow, Movement, Sellable } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { ProductPicker } from '@/components/pickers';
import { AdjustStockModal, StockDrawer } from '@/components/Stock';

const TYPES = ['OPENING', 'PURCHASE_IN', 'SALE_OUT', 'RESERVED_SALE_OUT', 'RESERVE', 'UNRESERVE', 'RETURN_IN', 'RETURN_DAMAGED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'DAMAGE_REPAIRED', 'DAMAGE_WRITE_OFF', 'SALE_CANCEL_IN', 'PURCHASE_CANCEL_OUT', 'PURCHASE_RETURN_OUT', 'DISPLAY'];
const ROUTES: Record<string, string> = { PURCHASE: '/purchases/', INVOICE: '/sales/invoices/', SALES_ORDER: '/sales/orders/', DEBIT_NOTE: '/purchases/' };
const META = {
  all: { title: 'Stock movement', desc: 'Every change to stock, newest first. Movements are permanent — mistakes are corrected with a new adjustment.' },
  in: { title: 'Stock in', desc: 'Stock received: purchases, opening stock, returns and upward corrections.' },
  adjustments: { title: 'Stock adjustment', desc: 'Manual corrections, damage, repairs and write-offs — each with a reason and the person who made it.' },
};

export default function Movements({ mode }: { mode: 'all' | 'in' | 'adjustments' }) {
  const can = useCan();
  const list = usePagedList<Movement>(`movements-${mode}`, '/api/inventory/movements', {
    filterKeys: ['type', 'from', 'to'], extra: mode === 'all' ? undefined : { group: mode },
  });
  const { state, update } = list;
  const [open, setOpen] = useState<number | null>(null);
  const [pick, setPick] = useState(false);
  const [adjust, setAdjust] = useState<Sellable | null>(null);

  const cols: Column<Movement>[] = [
    { key: 'when', header: 'When', mobile: 'meta', render: r => dateTime(r.createdAt), exportValue: r => dateTime(r.createdAt) },
    { key: 'product', header: 'Product', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span><span className="cell-sub mono">{r.sku}</span></div>, exportValue: r => r.productName },
    {
      key: 'type', header: 'Movement', mobile: 'sub', render: r => {
        const inbound = r.onHandDelta > 0 || r.damagedDelta > 0;
        return <span className="row gap-2">{inbound ? <ArrowDownLeft aria-hidden className="t-ok" style={{ width: 14 }} /> : <ArrowUpRight aria-hidden className="t-bad" style={{ width: 14 }} />}{label(r.movementType)}</span>;
      }, exportValue: r => label(r.movementType),
    },
    { key: 'ref', header: 'Reference', render: r => (r.refNumber ? <DocNo to={r.refType && ROUTES[r.refType] && r.refId ? ROUTES[r.refType] + r.refId : undefined}>{r.refNumber}</DocNo> : '—'), exportValue: r => r.refNumber },
    {
      key: 'change', header: 'Change', num: true, mobile: 'right', render: r => {
        const c = r.onHandDelta || r.damagedDelta || r.reservedDelta;
        const what = r.onHandDelta ? '' : r.damagedDelta ? ' dmg' : ' rsv';
        return <b className={`num ${c > 0 ? 't-ok' : 't-bad'}`}>{c > 0 ? '+' : ''}{qty(c)}<span className="text-xs muted">{what}</span></b>;
      }, exportValue: r => r.onHandDelta || r.damagedDelta || r.reservedDelta,
    },
    { key: 'after', header: 'On hand after', num: true, render: r => qty(r.onHandAfter), exportValue: r => r.onHandAfter },
    { key: 'cost', header: 'Unit cost', num: true, money: true, optional: true, render: r => (r.unitCost !== null && r.unitCost !== undefined ? <Money value={r.unitCost} /> : '—'), exportValue: r => r.unitCost },
    { key: 'note', header: 'Note', render: r => <span className="text-sm soft truncate" style={{ display: 'block', maxWidth: 260 }} title={r.note}>{r.note ?? '—'}</span>, exportValue: r => r.note },
    { key: 'by', header: 'By', mobile: 'meta', render: r => r.createdByName ?? 'System', exportValue: r => r.createdByName },
  ];

  const m = META[mode];
  return (
    <div className="page">
      <PageHeader title={m.title} desc={m.desc} actions={<>
        {mode !== 'in' && can(P.InventoryAdjust) && <button className="btn btn-primary" onClick={() => setPick(true)}><SlidersHorizontal aria-hidden />New adjustment</button>}
        {mode === 'in' && can(P.PurchaseManage) && <Link className="btn btn-primary" to="/purchases/new"><PackagePlus aria-hidden />Receive purchase</Link>}
        {mode === 'in' && can(P.InventoryAdjust) && <button className="btn" onClick={() => setPick(true)}>Quick stock in</button>}
      </>} />
      <DataTable id={`movements-${mode}`} label={m.title} columns={cols} rowKey={r => r.id} {...list.tableProps} compact
        onRowClick={r => setOpen(r.variantId)}
        rowActions={r => [{ label: 'Stock history', icon: <History />, onClick: () => setOpen(r.variantId) }]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Product, SKU or document no." />
          {mode === 'all' && (
            <select className="select input-sm" style={{ width: 190 }} aria-label="Movement type" value={state.filters.type ?? ''} onChange={e => update({ filters: { type: e.target.value || undefined } })}>
              <option value="">All movements</option>{TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          )}
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="From" value={state.filters.from ?? ''} onChange={e => update({ filters: { from: e.target.value || undefined } })} />
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="To" value={state.filters.to ?? ''} onChange={e => update({ filters: { to: e.target.value || undefined } })} />
        </>}
        empty={<EmptyState icon={<History />} title="No movements in this period" />}
        exportAs={{ title: m.title, fetchAll: list.fetchAll }} />
      <StockDrawer variantId={open} onClose={() => setOpen(null)} />
      <Modal open={pick} onClose={() => setPick(false)} title="Which item?" width={520}>
        <ProductPicker autoFocus onPick={s => { setPick(false); setAdjust(s); }} label="Choose item to adjust" />
      </Modal>
      {adjust && <AdjustStockModal open onClose={() => setAdjust(null)} item={{ variantId: adjust.variantId, displayName: adjust.displayName, available: adjust.available, reserved: adjust.reserved, onHand: adjust.onHand, damaged: 0 } as Pick<InventoryRow, 'variantId' | 'displayName' | 'available' | 'damaged' | 'onHand' | 'reserved'>} />}
    </div>
  );
}
