import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Building2, Factory, Pencil, Plus, Store, Warehouse as WarehouseIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { P } from '@/lib/perms';
import type { LocationStockRow, Warehouse } from '@/lib/types';
import { useCan, useMe, useToast } from '@/app/providers';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, SkeletonRows } from '@/components/ui/display';
import { SearchInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { KIND_LABEL, useWarehouses } from '@/components/Locations';

const KIND_ICON = { SHOWROOM: Store, WAREHOUSE: WarehouseIcon, FACTORY: Factory };

/** Showrooms, godowns and the workshop, with what each one holds. */
export default function Locations() {
  const can = useCan();
  const me = useMe();
  const all = useQuery({ queryKey: ['warehouses', 'all'], queryFn: () => api.get<Warehouse[]>('/api/warehouses', { all: true }) });
  const [edit, setEdit] = useState<Partial<Warehouse> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const stock = useQuery({ queryKey: ['location-stock', selected, q], queryFn: () => api.get<LocationStockRow[]>('/api/warehouses/stock', { warehouseId: selected, search: q }) });
  const rows = all.data ?? [];
  return (
    <div className="page">
      <PageHeader title="Locations" desc="Every place stock is kept. Sales take from the default showroom first, then from the other locations; move goods with a stock transfer."
        actions={<>
          {can(P.WarehouseManage) && <Link className="btn" to="/inventory/transfers?new=1"><ArrowLeftRight aria-hidden />New transfer</Link>}
          {can(P.WarehouseManage) && <button className="btn btn-primary" onClick={() => setEdit({ kind: 'WAREHOUSE', isActive: true })}><Plus aria-hidden />Add location</button>}
        </>} />
      {all.error ? <ErrorPanel error={all.error} retry={() => void all.refetch()} /> : all.isLoading ? <SkeletonRows rows={3} /> : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
          {rows.map(w => {
            const Icon = KIND_ICON[w.kind] ?? Building2;
            return (
              <button key={w.id} type="button" className={`loc-card ${selected === w.id ? 'selected' : ''} ${w.isActive ? '' : 'inactive'}`} onClick={() => setSelected(selected === w.id ? null : w.id)} aria-pressed={selected === w.id}>
                <div className="row between"><span className="row gap-2 medium"><Icon aria-hidden />{w.name}</span>{w.isDefault ? <Badge tone="info">Default</Badge> : !w.isActive ? <Badge>Inactive</Badge> : null}</div>
                <div className="text-xs muted">{KIND_LABEL[w.kind]} · <span className="mono">{w.code}</span></div>
                <div className="row gap-4" style={{ marginTop: 8 }}>
                  <div><div className="loc-num">{qty(w.units)}</div><div className="text-xs muted">units</div></div>
                  <div><div className="loc-num">{w.products}</div><div className="text-xs muted">products</div></div>
                  {me.canSeeCost && w.stockValue != null && <div><div className="loc-num">{money(w.stockValue, { decimals: false })}</div><div className="text-xs muted">at cost</div></div>}
                </div>
                {can(P.WarehouseManage) && <span className="loc-edit" role="button" tabIndex={0} aria-label={`Edit ${w.name}`} onClick={e => { e.stopPropagation(); setEdit(w); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setEdit(w); } }}><Pencil aria-hidden /></span>}
              </button>
            );
          })}
        </div>
      )}
      <Card title={selected ? `Stock at ${rows.find(w => w.id === selected)?.name}` : 'Stock by location'} sub={selected ? 'Click the card again to see all locations.' : 'Pick a location card to filter.'} bodyClass="">
        <div className="table-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Product or SKU" /></div>
        {stock.isLoading ? <SkeletonRows rows={6} /> : !(stock.data ?? []).length ? <EmptyState compact title="No stock here" /> : (
          <div className="table-scroll" style={{ maxHeight: 520 }}><table className="data">
            <thead><tr><th>Product</th>{!selected && <th>Location</th>}<th className="num">On hand</th><th className="num">Damaged</th><th className="num">Arriving</th></tr></thead>
            <tbody>{stock.data!.map(r => (
              <tr key={`${r.warehouseId}-${r.variantId}`}><td><div className="cell-title">{r.productName}{r.variantName ? ` — ${r.variantName}` : ''}</div><div className="cell-sub mono">{r.sku}</div></td>
                {!selected && <td>{r.warehouseName}</td>}
                <td className="num medium">{qty(r.onHand)}</td><td className="num">{r.damaged ? <span className="t-bad">{qty(r.damaged)}</span> : '—'}</td>
                <td className="num">{r.inTransit ? <span className="t-warn">{qty(r.inTransit)}</span> : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <LocationModal value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function LocationModal({ value, onClose }: { value: Partial<Warehouse> | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data = [] } = useWarehouses();
  const [w, setW] = useState<Partial<Warehouse>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setW(value ?? {}); setErrors({}); }
  const save = useMutation({
    mutationFn: () => (w.id ? api.put(`/api/warehouses/${w.id}`, w) : api.post('/api/warehouses', w)),
    onSuccess: () => { toast.success('Location saved'); qc.invalidateQueries({ queryKey: ['warehouses'] }); onClose(); },
    onError: e => { if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.toLowerCase(), v]))); toast.error('Not saved', errorMessage(e)); },
  });
  return (
    <Modal open={!!value} onClose={onClose} title={w.id ? `Edit ${w.name}` : 'Add location'} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!w.name?.trim() || !w.code?.trim()} onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <div className="grid grid-2">
          <TextInput label="Name" required autoFocus value={w.name ?? ''} onChange={e => setW({ ...w, name: e.target.value })} error={errors.name} placeholder="Peenya godown" />
          <TextInput label="Short code" required className="mono" maxLength={10} value={w.code ?? ''} onChange={e => setW({ ...w, code: e.target.value.toUpperCase().replace(/\s/g, '') })} error={errors.code} placeholder="GDN" />
        </div>
        <Select label="Type" value={w.kind ?? 'WAREHOUSE'} onChange={e => setW({ ...w, kind: e.target.value as Warehouse['kind'] })} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextArea label="Address" optional rows={2} value={w.address ?? ''} onChange={e => setW({ ...w, address: e.target.value })} />
        <Switch label="Default selling location" checked={!!w.isDefault} disabled={!!value?.isDefault} onChange={v => setW({ ...w, isDefault: v })} hint="Counter sales and returns use this location first." />
        {w.id && <Switch label="Active" checked={w.isActive ?? true} disabled={!!w.isDefault} onChange={v => setW({ ...w, isActive: v })} hint="Only empty locations can be deactivated." />}
        {!w.id && data.length === 1 && <p className="text-xs muted">Once you have two locations, purchases, adjustments and production let you choose where stock goes.</p>}
      </div>
    </Modal>
  );
}
