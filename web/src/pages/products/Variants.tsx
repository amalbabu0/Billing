import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Layers, Package } from 'lucide-react';
import { money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import type { Sellable } from '@/lib/types';
import { useLookups } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState, Money, PageHeader, StockLevel } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { StockDrawer } from '@/components/Stock';

export default function Variants() {
  const nav = useNavigate();
  const { data: lookups } = useLookups();
  const list = usePagedList<Sellable>('variants', '/api/variants', { filterKeys: ['categoryId'] });
  const { state, update } = list;
  const [history, setHistory] = useState<number | null>(null);
  const cols: Column<Sellable>[] = [
    { key: 'name', header: 'Product', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span><span className="cell-sub">{r.variantName}</span></div>, exportValue: r => r.displayName },
    { key: 'sku', header: 'SKU', mobile: 'meta', render: r => <span className="mono text-sm">{r.sku}</span>, exportValue: r => r.sku },
    { key: 'barcode', header: 'Barcode', render: r => <span className="mono text-sm">{r.barcode ?? '—'}</span>, exportValue: r => r.barcode },
    { key: 'cat', header: 'Category', mobile: 'meta', render: r => r.categoryName, exportValue: r => r.categoryName },
    { key: 'attrs', header: 'Material · colour · size', optional: true, render: r => [r.material, r.color, r.dimensions].filter(Boolean).join(' · ') || '—' },
    { key: 'price', header: 'Price', num: true, money: true, mobile: 'right', render: r => <span className="money">{money(r.sellingPrice, { decimals: false })}</span>, exportValue: r => r.sellingPrice },
    { key: 'cost', header: 'Cost', num: true, money: true, optional: true, render: r => (r.costPrice !== null && r.costPrice !== undefined ? <Money value={r.costPrice} decimals={false} /> : '—'), exportValue: r => r.costPrice },
    { key: 'stock', header: 'Available', num: true, render: r => <StockLevel bare available={r.available} reserved={r.reserved} isStockItem={r.isStockItem} />, exportValue: r => r.available },
  ];
  return (
    <div className="page">
      <PageHeader title="Variants" desc="Every sellable size, colour and finish as its own row — with SKU, barcode, price and stock." />
      <DataTable id="variants" label="Variants" columns={cols} rowKey={r => r.variantId} {...list.tableProps}
        onRowClick={r => nav(`/products/${r.productId}`)}
        rowActions={r => [{ label: 'Stock history', icon: <History />, onClick: () => setHistory(r.variantId) }, { label: 'Open product', icon: <Package />, onClick: () => nav(`/products/${r.productId}`) }]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Name, variant, SKU or barcode" />
          <select className="select input-sm" style={{ width: 170 }} aria-label="Category" value={state.filters.categoryId ?? ''} onChange={e => update({ filters: { categoryId: e.target.value || undefined } })}>
            <option value="">All categories</option>{lookups?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>}
        empty={<EmptyState icon={<Layers />} title="No variants found" />}
        exportAs={{ title: 'Variants', fetchAll: list.fetchAll }} />
      <StockDrawer variantId={history} onClose={() => setHistory(null)} />
    </div>
  );
}
