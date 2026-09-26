import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Factory, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, money, pct } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { P } from '@/lib/perms';
import type { Bom, BomLine, BomSummary } from '@/lib/types';
import { useCan, useMe, useToast } from '@/app/providers';
import { Card, EmptyState, ErrorPanel, Money, Notice, PageHeader, SkeletonRows, StatStrip } from '@/components/ui/display';
import { NumberInput, SearchInput, TextArea } from '@/components/ui/form';
import { ProductPicker, RawMaterialPicker } from '@/components/pickers';

/** Bills of material: what goes into one unit of a product, and what it costs to make. */
export default function Boms() {
  const can = useCan();
  const me = useMe();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['boms', q], queryFn: () => api.get<BomSummary[]>('/api/boms', { search: q }) });
  return (
    <div className="page">
      <PageHeader title="Bills of material" desc="Materials (with wastage) + labour + other costs = production cost of one unit. Production orders for a product start from its BOM." />
      {can(P.RawMaterialManage) && <div className="card card-pad" style={{ maxWidth: 560 }}><ProductPicker label="Create or open the BOM for a product" showStock={false} onPick={s => nav(`/production/boms/${s.variantId}`)} /></div>}
      <Card bodyClass="">
        <div className="table-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Product or SKU" /></div>
        {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : isLoading ? <SkeletonRows rows={5} /> : !(data ?? []).length ? (
          <EmptyState icon={<ClipboardList />} title="No bills of material yet" desc="Pick a product above to list the materials it needs." />
        ) : (
          <div className="table-scroll"><table className="data">
            <thead><tr><th>Product</th><th className="num">Materials</th>{me.canSeeCost && <><th className="num">Cost to make</th><th className="num">Selling price</th><th className="num">Margin</th></>}<th>Updated</th></tr></thead>
            <tbody>{data!.map(b => {
              const margin = b.totalCost != null && b.netPrice ? (b.netPrice - b.totalCost) / b.netPrice * 100 : null;
              return (
                <tr key={b.variantId} className="clickable" onClick={() => nav(`/production/boms/${b.variantId}`)}>
                  <td><div className="cell-title">{b.productName}</div><div className="cell-sub mono">{b.sku}</div></td><td className="num">{b.materials}</td>
                  {me.canSeeCost && <><td className="num medium"><Money value={b.totalCost} /></td><td className="num"><Money value={b.sellingPrice} /></td>
                    <td className={`num ${margin != null && margin < 15 ? 't-bad' : ''}`}>{margin == null ? '—' : pct(margin)}</td></>}
                  <td className="text-sm muted">{date(b.updatedAt)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
      {me.canSeeCost && <p className="text-xs muted">Margin is on the selling price excluding GST.</p>}
    </div>
  );
}

export function BomEditor() {
  const { variantId } = useParams();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['bom', Number(variantId)], queryFn: () => api.get<Bom>(`/api/boms/${variantId}`) });
  const [bom, setBom] = useState<Bom | null>(null);
  useEffect(() => { if (data) setBom(data); }, [data]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/boms/${variantId}`, { labourCost: bom!.labourCost, otherCost: bom!.otherCost, notes: bom!.notes, lines: bom!.lines.map(l => ({ rawMaterialId: l.rawMaterialId, quantity: l.quantity, wastagePercent: l.wastagePercent })) }),
    onSuccess: () => { toast.success('Bill of materials saved'); qc.invalidateQueries({ queryKey: ['boms'] }); qc.invalidateQueries({ queryKey: ['bom'] }); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (!bom) return <div className="page"><SkeletonRows rows={6} /></div>;
  const gross = (l: BomLine) => Math.round(l.quantity * (1 + l.wastagePercent / 100) * 1000) / 1000;
  const lineCost = (l: BomLine) => (l.unitCost == null ? null : Math.round(gross(l) * l.unitCost * 100) / 100);
  const material = bom.lines.reduce((s, l) => s + (lineCost(l) ?? 0), 0);
  const total = material + bom.labourCost + bom.otherCost;
  const net = bom.netPrice ?? 0;
  const setLine = (i: number, patch: Partial<BomLine>) => setBom({ ...bom, lines: bom.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const editable = can(P.RawMaterialManage);
  const dirty = JSON.stringify(bom) !== JSON.stringify(data);
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Bills of material', to: '/production/boms' }, { label: bom.sku ?? '' }]} title={bom.productName ?? 'BOM'} desc={<>Materials and costs to make <b>one unit</b> of <span className="mono">{bom.sku}</span>.</>}
        actions={<>
          {can(P.ProductionManage) && bom.lines.length > 0 && <Link className="btn" to={`/production?new=${variantId}`}><Factory aria-hidden />Start production</Link>}
          {editable && <button className="btn btn-primary" disabled={!dirty || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate()}>Save BOM</button>}
        </>} />
      {me.canSeeCost && <StatStrip items={[
        { label: 'Materials', value: money(material) }, { label: 'Labour + other', value: money(bom.labourCost + bom.otherCost) },
        { label: 'Production cost', value: money(total) },
        { label: 'Margin on price (ex-GST)', value: net ? `${money(net - total, { decimals: false })} · ${pct((net - total) / net * 100)}` : '—', tone: net && (net - total) / net < 0.15 ? 'bad' : undefined },
      ]} />}
      <Card title="Materials per unit" bodyClass="" actions={editable && <div style={{ width: 320 }}><RawMaterialPicker label="Add material" onPick={m => setBom({ ...bom, lines: bom.lines.some(l => l.rawMaterialId === m.id) ? bom.lines : [...bom.lines, { rawMaterialId: m.id, code: m.code, name: m.name, unit: m.unit, quantity: 1, wastagePercent: 5, unitCost: m.costPrice, stock: m.stock, grossQuantity: 1.05 }] })} /></div>}>
        {bom.lines.length === 0 ? <EmptyState compact title="No materials yet" desc="Add plywood, hardware, foam… with the quantity for one unit." /> : (
          <div className="table-scroll"><table className="data">
            <thead><tr><th>Material</th><th style={{ width: 130 }}>Qty / unit</th><th style={{ width: 110 }}>Wastage %</th><th className="num">With wastage</th>{me.canSeeCost && <><th className="num">Unit cost</th><th className="num">Cost</th></>}<th className="num">In stock</th>{editable && <th style={{ width: 44 }} />}</tr></thead>
            <tbody>{bom.lines.map((l, i) => (
              <tr key={l.rawMaterialId}>
                <td><div className="cell-title">{l.name}</div><div className="cell-sub mono">{l.code}</div></td>
                <td><div className="row gap-2">{editable ? <NumberInput value={l.quantity} min={0} step={0.001} aria-label="Quantity" onChange={v => setLine(i, { quantity: v ?? 0 })} /> : l.quantity}<span className="text-xs muted nowrap">{l.unit}</span></div></td>
                <td>{editable ? <NumberInput value={l.wastagePercent} min={0} max={100} aria-label="Wastage percent" onChange={v => setLine(i, { wastagePercent: v ?? 0 })} /> : `${l.wastagePercent}%`}</td>
                <td className="num">{gross(l)} {l.unit}</td>
                {me.canSeeCost && <><td className="num"><Money value={l.unitCost} /></td><td className="num medium"><Money value={lineCost(l)} /></td></>}
                <td className={`num ${(l.stock ?? 0) < gross(l) ? 't-bad' : 'muted'}`}>{l.stock ?? '—'}</td>
                {editable && <td><button className="btn btn-icon btn-ghost btn-sm" aria-label={`Remove ${l.name}`} onClick={() => setBom({ ...bom, lines: bom.lines.filter((_, j) => j !== i) })}><Trash2 /></button></td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Labour & other costs (per unit)">
        <div className="grid grid-3">
          {me.canSeeCost ? <>
            <NumberInput label="Labour" money value={bom.labourCost} disabled={!editable} onChange={v => setBom({ ...bom, labourCost: v ?? 0 })} hint="Carpenter, polish, upholstery" />
            <NumberInput label="Other" money value={bom.otherCost} disabled={!editable} onChange={v => setBom({ ...bom, otherCost: v ?? 0 })} hint="Power, transport, packing" />
          </> : <Notice tone="info">Costs are visible to roles with “See cost price”.</Notice>}
        </div>
        <div style={{ marginTop: 16 }}><TextArea label="Notes" optional rows={2} disabled={!editable} value={bom.notes ?? ''} onChange={e => setBom({ ...bom, notes: e.target.value })} placeholder="Cutting list, finish instructions" /></div>
      </Card>
      {editable && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={!dirty} onClick={() => save.mutate()}>Save BOM</button></div>}
    </div>
  );
}
