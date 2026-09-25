import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, History, LayoutGrid, List, Package, PackagePlus, Pencil, Receipt, Rows3, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useStored } from '@/lib/hooks';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Brand, Category, ProductRow } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState, Money, PageHeader, Segmented, Status, StockLevel } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { useConfirm, type MenuAction, Menu } from '@/components/ui/overlay';
import { AdjustStockModal, StockDrawer } from '@/components/Stock';

interface Facets { categories: Category[]; brands: Brand[]; materials: string[]; gstRates: number[] }
const FILTERS = ['categoryId', 'brandId', 'material', 'stock', 'gstRate', 'status', 'minPrice', 'maxPrice'];

export default function Products() {
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [view, setView] = useStored<'table' | 'compact' | 'grid'>('products-view', 'table');
  const list = usePagedList<ProductRow>('products', '/api/products', { filterKeys: FILTERS, defaults: { pageSize: 25 } });
  const { state, update } = list;
  const facets = useQuery({ queryKey: ['product-facets'], queryFn: () => api.get<Facets>('/api/products/facets'), staleTime: 300_000 });
  const [history, setHistory] = useState<number | null>(null);
  const [adjust, setAdjust] = useState<ProductRow | null>(null);
  const f = state.filters;
  const activeFilters = FILTERS.filter(k => f[k]);
  const extraCount = ['brandId', 'material', 'gstRate', 'status', 'minPrice', 'maxPrice'].filter(k => f[k]).length;
  const [more, setMore] = useState(extraCount > 0);

  const duplicate = useMutation({
    mutationFn: (id: number) => api.post<{ id: number }>(`/api/products/${id}/duplicate`),
    onSuccess: r => { toast.success('Product duplicated', 'Saved as inactive — review and activate it.'); qc.invalidateQueries({ queryKey: ['products'] }); nav(`/products/${r.id}/edit`); },
    onError: e => toast.error('Could not duplicate', errorMessage(e)),
  });
  const remove = async (p: ProductRow) => {
    if ((await confirm({ title: `Delete ${p.name}?`, message: 'The product is hidden from billing and lists. Past invoices keep their details. Products with stock or open orders cannot be deleted.', confirmText: 'Delete product' })) === null) return;
    try { await api.del(`/api/products/${p.id}`); toast.success('Product deleted'); qc.invalidateQueries({ queryKey: ['products'] }); } catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  const actions = (r: ProductRow): MenuAction[] => [
    { label: 'Edit', icon: <Pencil />, onClick: () => nav(`/products/${r.id}/edit`), hidden: !can(P.ProductManage) },
    { label: 'Duplicate', icon: <Copy />, onClick: () => duplicate.mutate(r.id), hidden: !can(P.ProductManage) },
    { label: 'Adjust stock', icon: <SlidersHorizontal />, onClick: () => setAdjust(r), hidden: !can(P.InventoryAdjust) || !r.isStockItem || !r.defaultVariantId },
    { label: 'View stock history', icon: <History />, onClick: () => r.defaultVariantId && setHistory(r.defaultVariantId), hidden: !r.defaultVariantId || !can(P.InventoryView) },
    { label: 'Create invoice', icon: <Receipt />, onClick: () => nav('/pos'), hidden: !can(P.InvoiceCreate) },
    { separator: true, label: '', hidden: !can(P.ProductDelete) },
    { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => remove(r), hidden: !can(P.ProductDelete) },
  ];

  const columns: Column<ProductRow>[] = [
    {
      key: 'name', header: 'Product', sort: 'name', fixed: true, mobile: 'title',
      render: r => (
        <div className="row gap-3">
          {view !== 'compact' && <span className="cell-thumb">{r.imageAttachmentId ? <img src={`/api/attachments/${r.imageAttachmentId}`} alt="" loading="lazy" width={36} height={36} /> : <Package aria-hidden />}</span>}
          <div className="cell-stack"><span className="cell-title">{r.name}</span>
            <span className="cell-sub">{[r.material, r.finish, r.dimensions].filter(Boolean).join(' · ') || r.code}</span></div>
        </div>
      ),
      exportValue: r => r.name,
    },
    { key: 'sku', header: 'SKU', sort: 'sku', mobile: 'meta', render: r => <span className="mono text-sm">{r.sku}</span>, exportValue: r => r.sku },
    { key: 'category', header: 'Category', sort: 'category', mobile: 'meta', render: r => r.categoryName, exportValue: r => r.categoryName },
    { key: 'brand', header: 'Brand', optional: true, render: r => r.brandName ?? '—', exportValue: r => r.brandName },
    { key: 'variants', header: 'Variants', render: r => (r.variantCount > 1 ? <span className="text-sm soft truncate" style={{ display: 'block', maxWidth: 200 }} title={r.variantNames}>{r.variantCount} · {r.variantNames}</span> : <span className="muted">—</span>), exportValue: r => r.variantNames },
    { key: 'price', header: 'Price', sort: 'price', num: true, money: true, mobile: 'right', render: r => <span className="money">{money(r.sellingPrice, { decimals: false })}{r.maxPrice && r.maxPrice > r.sellingPrice ? `–${money(r.maxPrice, { decimals: false }).slice(1)}` : ''}</span>, exportValue: r => r.sellingPrice },
    { key: 'cost', header: 'Cost', num: true, money: true, optional: true, render: r => (r.costPrice !== null && r.costPrice !== undefined ? <Money value={r.costPrice} decimals={false} className="soft" /> : '—'), exportValue: r => r.costPrice },
    { key: 'gst', header: 'GST', optional: true, render: r => `${r.gstRate}%`, exportValue: r => r.gstRate },
    { key: 'stock', header: 'Stock', sort: 'stock', num: true, mobile: 'meta', render: r => <StockLevel available={r.available} reserved={r.reserved} min={r.minStock} isStockItem={r.isStockItem} bare={view !== 'grid'} />, exportValue: r => r.available },
    { key: 'status', header: 'Status', render: r => <span className="row gap-1">{r.status !== 'ACTIVE' ? <Status value={r.status} /> : r.isStockItem ? <Status value={r.stockState} /> : <Status value="MADE_TO_ORDER" />}</span>, exportValue: r => r.status },
  ];

  const toolbar = (
    <>
      <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Name, code, SKU or barcode" />
      <select className="select input-sm" style={{ width: 150 }} aria-label="Category" value={f.categoryId ?? ''} onChange={e => update({ filters: { categoryId: e.target.value || undefined } })}>
        <option value="">All categories</option>{facets.data?.categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.productCount})</option>)}
      </select>
      <select className="select input-sm" style={{ width: 140 }} aria-label="Stock" value={f.stock ?? ''} onChange={e => update({ filters: { stock: e.target.value || undefined } })}>
        <option value="">Any stock</option><option value="IN_STOCK">In stock</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option><option value="MADE_TO_ORDER">Made to order</option>
      </select>
      <button className="btn btn-sm" aria-expanded={more} onClick={() => setMore(m => !m)}>
        <SlidersHorizontal aria-hidden />More filters{extraCount ? ` · ${extraCount}` : ''}
      </button>
      {activeFilters.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => update({ filters: Object.fromEntries(FILTERS.map(k => [k, undefined])) })}><X aria-hidden />Clear</button>}
      <Segmented value={view} onChange={setView} label="View" options={[
        { value: 'table', label: '', icon: <List />, title: 'Table view' }, { value: 'compact', label: '', icon: <Rows3 />, title: 'Compact view' }, { value: 'grid', label: '', icon: <LayoutGrid />, title: 'Grid view' },
      ]} />
      {more && <div className="row wrap gap-2" style={{ flexBasis: '100%' }}><MoreFilters facets={facets.data} f={f} update={v => update({ filters: v })} /></div>}
    </>
  );

  return (
    <div className="page">
      <PageHeader title="Products" desc="Your catalogue with live stock. Prices shown are selling prices; variants (size, colour, finish) keep their own SKU and stock."
        actions={can(P.ProductManage) && <Link className="btn btn-primary" to="/products/new"><PackagePlus aria-hidden />Add product</Link>} />
      {view === 'grid' ? (
        <div className="table-card">
          <div className="table-toolbar">{toolbar}</div>
          {list.query.isLoading ? <div style={{ padding: 20 }} className="muted">Loading…</div> : (list.query.data?.items ?? []).length === 0 ? <EmptyState icon={<Package />} title="No products found" /> : (
            <div className="product-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', padding: 16 }}>
              {list.query.data!.items.map(r => (
                <div key={r.id} className="pcard" style={{ cursor: 'default' }}>
                  <Link to={`/products/${r.id}`} className="pcard-img" aria-label={r.name}>{r.imageAttachmentId ? <img src={`/api/attachments/${r.imageAttachmentId}`} alt="" loading="lazy" /> : <Package aria-hidden />}</Link>
                  <div className="row between top"><Link to={`/products/${r.id}`} className="pcard-name" style={{ color: 'var(--ink)' }}>{r.name}</Link><Menu items={actions(r)} /></div>
                  <div className="text-xs muted"><span className="mono">{r.sku}</span> · {r.categoryName}</div>
                  <div className="pcard-foot"><span className="pcard-price">{money(r.sellingPrice, { decimals: false })}</span><StockLevel available={r.available} min={r.minStock} isStockItem={r.isStockItem} /></div>
                </div>
              ))}
            </div>
          )}
          <GridPager list={list} />
        </div>
      ) : (
        <DataTable id="products" label="Products" columns={columns} rowKey={r => r.id} {...list.tableProps} compact={view === 'compact'}
          onRowClick={r => nav(`/products/${r.id}`)} rowActions={actions}
          rowClass={r => (r.status !== 'ACTIVE' ? 'muted-row' : undefined)}
          toolbar={toolbar}
          empty={state.search || activeFilters.length
            ? <EmptyState icon={<Package />} title="No products match" desc="Try fewer filters." action={<button className="btn" onClick={() => update({ search: '', filters: Object.fromEntries(FILTERS.map(k => [k, undefined])) })}>Clear filters</button>} />
            : <EmptyState icon={<Package />} title="No products yet" desc="Add your furniture with sizes, finishes and prices." action={can(P.ProductManage) && <Link className="btn btn-primary" to="/products/new">Add your first product</Link>} />}
          exportAs={{ title: 'Products', fetchAll: list.fetchAll }} />
      )}
      <StockDrawer variantId={history} onClose={() => setHistory(null)} />
      {adjust && adjust.defaultVariantId && <AdjustStockModal open onClose={() => setAdjust(null)} item={{ variantId: adjust.defaultVariantId, displayName: adjust.name, available: adjust.available, reserved: adjust.reserved, onHand: adjust.onHand, damaged: 0 }} />}
    </div>
  );
}

/** Extra filters, kept out of the main row so the toolbar stays calm. */
function MoreFilters({ facets, f, update }: { facets?: Facets; f: Record<string, string>; update: (v: Record<string, string | undefined>) => void }) {
  return (
    <>
      <select className="select input-sm" style={{ width: 130 }} aria-label="Brand" value={f.brandId ?? ''} onChange={e => update({ brandId: e.target.value || undefined })}>
        <option value="">Any brand</option>{facets?.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select className="select input-sm" style={{ width: 140 }} aria-label="Material" value={f.material ?? ''} onChange={e => update({ material: e.target.value || undefined })}>
        <option value="">Any material</option>{facets?.materials.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="select input-sm" style={{ width: 110 }} aria-label="GST rate" value={f.gstRate ?? ''} onChange={e => update({ gstRate: e.target.value || undefined })}>
        <option value="">Any GST</option>{facets?.gstRates.map(r => <option key={r} value={r}>{r}%</option>)}
      </select>
      <select className="select input-sm" style={{ width: 120 }} aria-label="Status" value={f.status ?? ''} onChange={e => update({ status: e.target.value || undefined })}>
        <option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="DISCONTINUED">Discontinued</option>
      </select>
      <input className="input input-sm" style={{ width: 96 }} inputMode="numeric" placeholder="₹ min" aria-label="Minimum price" value={f.minPrice ?? ''} onChange={e => update({ minPrice: e.target.value.replace(/\D/g, '') || undefined })} />
      <input className="input input-sm" style={{ width: 96 }} inputMode="numeric" placeholder="₹ max" aria-label="Maximum price" value={f.maxPrice ?? ''} onChange={e => update({ maxPrice: e.target.value.replace(/\D/g, '') || undefined })} />
    </>
  );
}

function GridPager({ list }: { list: ReturnType<typeof usePagedList<ProductRow>> }) {
  const t = list.tableProps;
  const pages = Math.max(1, Math.ceil((t.total ?? 0) / t.pageSize));
  if (!t.total) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{t.total} products</span>
      <div className="pages">
        <button className="btn btn-sm" disabled={t.page <= 1} onClick={() => t.onPage(t.page - 1)}>Previous</button>
        <span className="num">Page {t.page} / {pages}</span>
        <button className="btn btn-sm" disabled={t.page >= pages} onClick={() => t.onPage(t.page + 1)}>Next</button>
      </div>
    </nav>
  );
}
