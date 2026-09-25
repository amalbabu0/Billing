import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, History, Package, Pencil, Receipt, SlidersHorizontal } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { dateTime, money, pct } from '@/lib/format';
import { P } from '@/lib/perms';
import type { Product, Variant } from '@/lib/types';
import { useCan, useMe, useToast } from '@/app/providers';
import { Card, ErrorPanel, Kpi, KV, PageHeader, SkeletonRows, Status, StockLevel } from '@/components/ui/display';
import { Menu } from '@/components/ui/overlay';
import { AdjustStockModal, StockDrawer } from '@/components/Stock';

export default function ProductDetail() {
  const { id } = useParams();
  const can = useCan();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { data: p, error, refetch } = useQuery({ queryKey: ['product', Number(id)], queryFn: () => api.get<Product>(`/api/products/${id}`) });
  const [history, setHistory] = useState<number | null>(null);
  const [adjust, setAdjust] = useState<Variant | null>(null);
  const dup = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/api/products/${id}/duplicate`),
    onSuccess: r => { toast.success('Product duplicated'); nav(`/products/${r.id}/edit`); },
    onError: e => toast.error('Could not duplicate', errorMessage(e)),
  });
  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (!p) return <div className="page"><SkeletonRows rows={8} /></div>;
  const margin = p.costPrice !== null && p.costPrice !== undefined && p.sellingPrice ? p.sellingPrice - p.costPrice : null;
  const damaged = p.variants.reduce((s, v) => s + v.damaged, 0);

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Products', to: '/products' }, { label: p.name }]}
        title={<span className="row gap-4"><span className="cell-thumb" style={{ width: 56, height: 56, borderRadius: 10 }}>{p.imageAttachmentId ? <img src={`/api/attachments/${p.imageAttachmentId}`} alt="" width={56} height={56} /> : <Package aria-hidden />}</span>{p.name}</span>}
        badge={p.status !== 'ACTIVE' ? <Status value={p.status} /> : p.isStockItem ? undefined : <Status value="MADE_TO_ORDER" />}
        desc={<><span className="mono">{p.code}</span> · {p.categoryName}{p.brandName ? ` · ${p.brandName}` : ''} · updated {dateTime(p.updatedAt)}</>}
        actions={<>
          {can(P.ProductManage) && <Link className="btn btn-primary" to={`/products/${p.id}/edit`}><Pencil aria-hidden />Edit</Link>}
          {can(P.InvoiceCreate) && <Link className="btn" to="/pos"><Receipt aria-hidden />Create invoice</Link>}
          <Menu items={[
            { label: 'Duplicate', icon: <Copy />, onClick: () => dup.mutate(), hidden: !can(P.ProductManage) },
            { label: 'Adjust stock', icon: <SlidersHorizontal />, onClick: () => setAdjust(p.variants[0]), hidden: !can(P.InventoryAdjust) || !p.isStockItem || p.variants.length !== 1 },
          ]} />
        </>} />

      <section className="kpi-row">
        <Kpi label="Selling price" value={money(p.sellingPrice, { decimals: false })} foot={<span>{p.priceIncludesGst ? 'incl.' : '+'} GST {p.gstRate}% · HSN {p.hsnCode ?? '—'}</span>} />
        {me.canSeeCost && <Kpi label="Cost price" value={money(p.costPrice, { decimals: false })} foot={margin !== null ? <span>Margin {money(margin, { decimals: false })} · {pct(Math.round((margin / p.sellingPrice) * 1000) / 10)}</span> : undefined} />}
        {p.isStockItem && <Kpi label="Available" value={p.available} tone={p.available <= 0 ? 'bad' : p.available <= p.minStock ? 'warn' : undefined} foot={<span>min {p.minStock}</span>} />}
        {p.isStockItem && <Kpi label="Reserved" value={p.reserved} foot={<span>for confirmed orders</span>} />}
        {p.isStockItem && damaged > 0 && <Kpi label="Damaged" value={damaged} tone="warn" />}
      </section>

      <div className="dash-grid">
        <Card title="Variants" sub={`${p.variants.length} sellable ${p.variants.length === 1 ? 'item' : 'items'}`} bodyClass="">
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Variant</th><th>SKU / barcode</th><th className="num">Price</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Damaged</th><th className="actions" /></tr></thead>
              <tbody>{p.variants.map(v => (
                <tr key={v.id} className={v.isActive ? undefined : 'muted-row'}>
                  <td><div className="cell-stack"><span className="cell-title">{v.variantName}{v.isDefault && <span className="badge plain" style={{ marginLeft: 6 }}>Default</span>}</span><span className="cell-sub">{[v.size, v.color, v.finish, v.material].filter(Boolean).join(' · ')}</span></div></td>
                  <td><div className="cell-stack"><span className="mono text-sm">{v.sku}</span><span className="cell-sub mono">{v.barcode ?? 'no barcode'}</span></div></td>
                  <td className="num"><span className="money">{money(v.sellingPrice ?? p.sellingPrice, { decimals: false })}</span></td>
                  <td className="num">{p.isStockItem ? <StockLevel bare available={v.onHand - v.reserved} min={v.minStock ?? p.minStock} /> : '—'}</td>
                  <td className="num">{v.reserved || '—'}</td>
                  <td className="num">{v.damaged || '—'}</td>
                  <td className="actions"><Menu items={[
                    { label: 'Stock history', icon: <History />, onClick: () => setHistory(v.id), hidden: !can(P.InventoryView) },
                    { label: 'Adjust stock', icon: <SlidersHorizontal />, onClick: () => setAdjust(v), hidden: !can(P.InventoryAdjust) || !p.isStockItem },
                  ]} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Details">
          <KV items={[
            ['Material', p.material], ['Finish', p.finish], ['Fabric', p.fabric], ['Colour', p.color], ['Size', p.size], ['Dimensions', p.dimensions],
            ['Warranty', p.warrantyMonths ? `${p.warrantyMonths} months` : 'None'], ['Max discount', `${p.discountPercent}%`],
          ]} />
          {p.description && <p className="text-sm soft" style={{ marginTop: 16 }}>{p.description}</p>}
        </Card>
      </div>
      <StockDrawer variantId={history} onClose={() => setHistory(null)} />
      {adjust && <AdjustStockModal open onClose={() => { setAdjust(null); void refetch(); }} item={{ variantId: adjust.id, displayName: `${p.name}${adjust.variantName !== 'Standard' ? ` — ${adjust.variantName}` : ''}`, available: adjust.onHand - adjust.reserved, reserved: adjust.reserved, damaged: adjust.damaged, onHand: adjust.onHand }} />}
    </div>
  );
}
