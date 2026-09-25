import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, History, PackagePlus, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { InventoryRow } from '@/lib/types';
import { useCan, useLookups, useMe } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState, Money, PageHeader, Segmented, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { AdjustStockModal, StockDrawer } from '@/components/Stock';

interface Summary { availableUnits: number; reservedUnits: number; damagedUnits: number; lowStock: number; outOfStock: number; items: number; stockValue?: number | null }

const TITLES = {
  all: { title: 'Current stock', desc: 'Available = on hand minus what is reserved for confirmed orders. Click a row for its full history.' },
  low: { title: 'Low stock', desc: 'Items at or below their minimum level, and items that have run out. Reorder from here.' },
  damaged: { title: 'Damaged stock', desc: 'Pieces set aside as damaged — repair them back into stock, return them to the supplier, or write them off.' },
};

export default function Stock({ mode }: { mode: 'all' | 'low' | 'damaged' }) {
  const can = useCan();
  const me = useMe();
  const { data: lookups } = useLookups();
  const [params, setParams] = useSearchParams();
  const fixedState = mode === 'low' ? 'LOW_OR_OUT' : mode === 'damaged' ? 'DAMAGED' : undefined;
  const list = usePagedList<InventoryRow>(`inventory-${mode}`, '/api/inventory', {
    filterKeys: ['state', 'categoryId'], defaults: { sortBy: mode === 'low' ? 'available' : undefined },
    map: s => ({ state: fixedState === 'LOW_OR_OUT' ? (s.filters.state ?? 'LOW') : fixedState ?? s.filters.state }),
  });
  const { state, update } = list;
  const summary = useQuery({ queryKey: ['inventory', 'summary'], queryFn: () => api.get<Summary>('/api/inventory/summary') });
  const [open, setOpen] = useState<number | null>(null);
  const [adjust, setAdjust] = useState<InventoryRow | null>(null);
  useEffect(() => { const o = params.get('open'); if (o) { setOpen(Number(o)); params.delete('open'); setParams(params, { replace: true }); } }, [params, setParams]);
  const s = summary.data;

  const cols: Column<InventoryRow>[] = [
    { key: 'name', header: 'Product', sort: 'name', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span>{r.variantName !== 'Standard' && <span className="cell-sub">{r.variantName}</span>}</div>, exportValue: r => r.displayName },
    { key: 'sku', header: 'SKU', sort: 'sku', mobile: 'meta', render: r => <span className="mono text-sm">{r.sku}</span>, exportValue: r => r.sku },
    { key: 'cat', header: 'Category', sort: 'category', optional: mode !== 'all', render: r => r.categoryName, exportValue: r => r.categoryName },
    { key: 'available', header: 'Available', sort: 'available', num: true, mobile: 'right', render: r => <b className={`num ${r.available <= 0 ? 't-bad' : r.available <= r.minStock ? 't-warn' : ''}`}>{qty(r.available)}</b>, exportValue: r => r.available },
    { key: 'reserved', header: 'Reserved', sort: 'reserved', num: true, render: r => (r.reserved ? qty(r.reserved) : <span className="muted">—</span>), exportValue: r => r.reserved },
    { key: 'damaged', header: 'Damaged', num: true, render: r => (r.damaged ? <span className="t-warn">{qty(r.damaged)}</span> : <span className="muted">—</span>), exportValue: r => r.damaged },
    { key: 'total', header: 'Total', sort: 'on_hand', num: true, render: r => qty(r.onHand + r.damaged), exportValue: r => r.onHand + r.damaged },
    { key: 'min', header: 'Min', num: true, optional: mode !== 'low', render: r => qty(r.minStock), exportValue: r => r.minStock },
    ...(me.canSeeCost ? [{ key: 'value', header: 'Stock value', sort: 'value', num: true, money: true, render: (r: InventoryRow) => <Money value={r.stockValue} decimals={false} />, exportValue: (r: InventoryRow) => r.stockValue } as Column<InventoryRow>] : []),
    { key: 'status', header: 'Status', mobile: 'meta', render: r => <Status value={r.stockState} />, exportValue: r => r.stockState },
  ];

  const t = TITLES[mode];
  return (
    <div className="page">
      <PageHeader title={t.title} desc={t.desc} actions={<>
        {mode === 'low' && can(P.PurchaseManage) && <Link className="btn btn-primary" to="/purchases/new"><ShoppingBag aria-hidden />New purchase</Link>}
        {mode === 'all' && can(P.PurchaseManage) && <Link className="btn btn-primary" to="/purchases/new"><PackagePlus aria-hidden />Stock in (purchase)</Link>}
      </>} />
      <StatStrip loading={!s} items={[
        { label: 'Available units', value: qty(s?.availableUnits) },
        { label: 'Reserved', value: qty(s?.reservedUnits) },
        { label: 'Damaged', value: qty(s?.damagedUnits), tone: s?.damagedUnits ? 'warn' : undefined },
        { label: 'Low stock items', value: s?.lowStock ?? '—', tone: s?.lowStock ? 'warn' : undefined },
        { label: 'Out of stock', value: s?.outOfStock ?? '—', tone: s?.outOfStock ? 'bad' : undefined },
        ...(me.canSeeCost ? [{ label: 'Stock value (cost)', value: money(s?.stockValue, { decimals: false }) }] : []),
      ]} />
      <DataTable id={`stock-${mode}`} label={t.title} columns={cols} rowKey={r => r.variantId} {...list.tableProps}
        onRowClick={r => setOpen(r.variantId)}
        rowActions={r => [
          { label: 'Stock history', icon: <History />, onClick: () => setOpen(r.variantId) },
          { label: 'Adjust stock', icon: <SlidersHorizontal />, onClick: () => setAdjust(r), hidden: !can(P.InventoryAdjust) },
        ]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Product, variant, SKU or barcode" />
          {mode === 'all' && <Segmented value={state.filters.state ?? ''} onChange={v => update({ filters: { state: v || undefined } })} label="Stock state" options={[
            { value: '', label: 'All' }, { value: 'IN_STOCK', label: 'In stock' }, { value: 'LOW', label: 'Low' }, { value: 'OUT', label: 'Out' }, { value: 'RESERVED', label: 'Reserved' }, { value: 'DAMAGED', label: 'Damaged' },
          ]} />}
          {mode === 'low' && <Segmented value={state.filters.state ?? 'LOW'} onChange={v => update({ filters: { state: v } })} label="Level" options={[{ value: 'LOW', label: 'Running low' }, { value: 'OUT', label: 'Out of stock' }]} />}
          <select className="select input-sm" style={{ width: 160 }} aria-label="Category" value={state.filters.categoryId ?? ''} onChange={e => update({ filters: { categoryId: e.target.value || undefined } })}>
            <option value="">All categories</option>{lookups?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>}
        empty={<EmptyState icon={<Boxes />} title={mode === 'low' ? 'Nothing is running low' : mode === 'damaged' ? 'No damaged stock' : 'No stock items found'}
          desc={mode === 'low' ? 'Every item is above its minimum level.' : undefined} />}
        exportAs={{ title: t.title, fetchAll: list.fetchAll }} />
      <StockDrawer variantId={open} onClose={() => setOpen(null)} />
      {adjust && <AdjustStockModal open onClose={() => setAdjust(null)} item={adjust} />}
    </div>
  );
}
