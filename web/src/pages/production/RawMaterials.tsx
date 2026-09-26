import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, History, Layers, Pencil, Plus, SlidersHorizontal } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { dateTime, money, num } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { RawMaterial, RawMaterialMovement, Supplier } from '@/lib/types';
import { useCan, useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, EmptyState, Money, Notice, PageHeader, Segmented, StatStrip, Status } from '@/components/ui/display';
import { NumberInput, SearchInput, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, Modal } from '@/components/ui/overlay';
import { SupplierPicker } from '@/components/pickers';
import { WarehouseSelect } from '@/components/Locations';

export const RM_CATEGORIES = ['Teak wood', 'Sheesham wood', 'Plywood', 'MDF', 'Particle board', 'Laminate', 'Veneer', 'Hardware', 'Hinges', 'Handles', 'Channels', 'Screws & fasteners', 'Foam', 'Fabric', 'Leather / rexine', 'Glass', 'Mirror', 'Paint & polish', 'Adhesive', 'Packing'];
export const RM_UNITS = ['sheet', 'sq.ft', 'cu.ft', 'r.ft', 'metre', 'kg', 'litre', 'piece', 'pair', 'set', 'box', 'roll'];
const qty3 = (v: number) => num(v) === String(Math.round(v)) ? num(v) : v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const TYPE_LABEL: Record<string, string> = { OPENING: 'Opening', RECEIVE: 'Received', ISSUE: 'Issued to production', RETURN: 'Returned from production', ADJUST_IN: 'Adjusted up', ADJUST_OUT: 'Adjusted down', WASTAGE: 'Wastage' };

export default function RawMaterials({ view = 'materials' }: { view?: 'materials' | 'movements' }) {
  return view === 'movements' ? <Movements /> : <Materials />;
}

function Materials() {
  const can = useCan();
  const me = useMe();
  const list = usePagedList<RawMaterial>('raw-materials', '/api/raw-materials', { filterKeys: ['category', 'low'] });
  const { state, update } = list;
  const cats = useQuery({ queryKey: ['rm-categories'], queryFn: () => api.get<string[]>('/api/raw-materials/categories') });
  const [edit, setEdit] = useState<Partial<RawMaterial> | null>(null);
  const [stock, setStock] = useState<{ m: RawMaterial; type: string } | null>(null);
  const rows = list.query.data?.items ?? [];
  const cols: Column<RawMaterial>[] = [
    { key: 'name', header: 'Material', sort: 'name', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.name}</span><span className="cell-sub mono">{r.code}</span></div>, exportValue: r => r.name },
    { key: 'cat', header: 'Category', sort: 'category', mobile: 'meta', render: r => r.category, exportValue: r => r.category },
    { key: 'stock', header: 'In stock', sort: 'stock', num: true, mobile: 'right', render: r => <span className={r.isLow ? 't-bad medium' : 'medium'}>{qty3(r.stock)} <span className="muted text-xs">{r.unit}</span></span>, exportValue: r => r.stock },
    { key: 'min', header: 'Minimum', num: true, render: r => `${qty3(r.minStock)} ${r.unit}`, exportValue: r => r.minStock },
    { key: 'state', header: 'Status', render: r => r.stock <= 0 ? <Status value="OUT_OF_STOCK" text="Out" /> : r.isLow ? <Status value="LOW_STOCK" text={`Reorder ${qty3(r.reorderQty || r.minStock * 2)}`} /> : <Status value="IN_STOCK" text="OK" />, exportValue: r => (r.isLow ? 'Low' : 'OK') },
    ...(me.canSeeCost ? [
      { key: 'cost', header: 'Cost / unit', num: true, money: true, render: (r: RawMaterial) => <Money value={r.costPrice} />, exportValue: (r: RawMaterial) => r.costPrice } as Column<RawMaterial>,
      { key: 'value', header: 'Value', sort: 'value', num: true, money: true, render: (r: RawMaterial) => <Money value={r.stockValue} />, exportValue: (r: RawMaterial) => r.stockValue } as Column<RawMaterial>,
    ] : []),
    { key: 'sup', header: 'Supplier', optional: true, render: r => r.supplierName ?? '—', exportValue: r => r.supplierName },
    { key: 'wh', header: 'Stored at', optional: true, render: r => r.warehouseName ?? '—', exportValue: r => r.warehouseName },
  ];
  const lowCount = rows.filter(r => r.isLow).length;
  return (
    <div className="page">
      <PageHeader title="Raw materials" desc="Wood, boards, hardware, foam and fabric used in the workshop. Receipts update the average cost; production issues come off this stock."
        actions={can(P.RawMaterialManage) && <button className="btn btn-primary" onClick={() => setEdit({ unit: 'sheet', category: 'Plywood', isActive: true })}><Plus aria-hidden />Add material</button>} />
      {me.canSeeCost && <StatStrip loading={list.query.isLoading} items={[
        { label: 'Materials', value: list.query.data?.totalCount ?? 0 },
        { label: 'Low or out (this page)', value: lowCount, tone: lowCount ? 'bad' : undefined },
        { label: 'Stock value (this page)', value: money(rows.reduce((s, r) => s + (r.stockValue ?? 0), 0), { decimals: false }) },
      ]} />}
      <DataTable id="raw-materials" label="Raw materials" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={can(P.RawMaterialManage) ? r => setStock({ m: r, type: 'RECEIVE' }) : undefined}
        rowActions={can(P.RawMaterialManage) ? r => [
          { label: 'Receive stock', icon: <ArrowDownToLine />, onClick: () => setStock({ m: r, type: 'RECEIVE' }) },
          { label: 'Adjust / wastage', icon: <SlidersHorizontal />, onClick: () => setStock({ m: r, type: 'ADJUST_OUT' }) },
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit(r) },
          { label: 'Movements', icon: <History />, href: `/production/materials/movements?materialId=${r.id}` },
        ] : undefined}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Name, code or category" />
          <select className="select input-sm" style={{ width: 170 }} aria-label="Category" value={state.filters.category ?? ''} onChange={e => update({ filters: { category: e.target.value || undefined } })}>
            <option value="">All categories</option>{(cats.data ?? []).map(c => <option key={c}>{c}</option>)}
          </select>
          <Segmented value={state.filters.low ?? ''} onChange={x => update({ filters: { low: x || undefined } })} label="Stock" options={[{ value: '', label: 'All' }, { value: 'true', label: 'Low / out' }]} />
        </>}
        empty={<EmptyState icon={<Layers />} title="No raw materials yet" desc="Add the boards, hardware and fabric you buy, with a minimum level for reorder alerts."
          action={can(P.RawMaterialManage) && <button className="btn btn-primary" onClick={() => setEdit({ unit: 'sheet', category: 'Plywood', isActive: true })}>Add material</button>} />}
        exportAs={{ title: 'Raw materials', fetchAll: list.fetchAll }} />
      <MaterialDrawer value={edit} onClose={() => setEdit(null)} />
      {stock && <StockModal material={stock.m} initialType={stock.type} onClose={() => setStock(null)} />}
    </div>
  );
}

function MaterialDrawer({ value, onClose }: { value: Partial<RawMaterial> | null; onClose: () => void }) {
  const toast = useToast();
  const me = useMe();
  const qc = useQueryClient();
  const [m, setM] = useState<Partial<RawMaterial>>({});
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setM(value ?? {}); setErrors({}); setSupplier(value?.supplierId ? { id: value.supplierId, name: value.supplierName ?? '' } as Supplier : null); }
  const save = useMutation({
    mutationFn: () => {
      const body = { ...m, supplierId: supplier?.id ?? null };
      return m.id ? api.put(`/api/raw-materials/${m.id}`, body) : api.post('/api/raw-materials', body);
    },
    onSuccess: () => { toast.success('Material saved'); qc.invalidateQueries({ queryKey: ['raw-materials'] }); qc.invalidateQueries({ queryKey: ['rm-categories'] }); onClose(); },
    onError: e => { if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v]))); toast.error('Not saved', errorMessage(e)); },
  });
  return (
    <Drawer open={!!value} onClose={onClose} title={m.id ? `Edit ${m.name}` : 'Add raw material'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <div className="grid grid-2">
          <TextInput label="Name" required autoFocus value={m.name ?? ''} onChange={e => setM({ ...m, name: e.target.value })} error={errors.name} placeholder="BWP plywood 18 mm" />
          <TextInput label="Code" optional className="mono" value={m.code ?? ''} onChange={e => setM({ ...m, code: e.target.value.toUpperCase() })} error={errors.code} hint="Blank = automatic" />
        </div>
        <div className="grid grid-2">
          <TextInput label="Category" required list="rm-cats" value={m.category ?? ''} onChange={e => setM({ ...m, category: e.target.value })} error={errors.category} />
          <TextInput label="Unit" required list="rm-units" value={m.unit ?? ''} onChange={e => setM({ ...m, unit: e.target.value })} error={errors.unit} />
        </div>
        <div className="grid grid-3">
          {me.canSeeCost && <NumberInput label="Cost per unit" money value={m.costPrice ?? null} onChange={v => setM({ ...m, costPrice: v })} error={errors.costPrice} />}
          <NumberInput label="Minimum stock" value={m.minStock ?? 0} min={0} step={0.001} onChange={v => setM({ ...m, minStock: v ?? 0 })} />
          <NumberInput label="Reorder quantity" optional value={m.reorderQty ?? 0} min={0} step={0.001} onChange={v => setM({ ...m, reorderQty: v ?? 0 })} />
        </div>
        {!m.id && <NumberInput label="Opening stock" optional value={m.openingStock ?? 0} min={0} step={0.001} onChange={v => setM({ ...m, openingStock: v ?? 0 })} hint="Quantity already in the workshop" />}
        <SupplierPicker value={supplier} onChange={setSupplier} />
        <WarehouseSelect label="Stored at" optional value={m.warehouseId} onChange={id => setM({ ...m, warehouseId: id ?? undefined })} />
        <TextArea label="Notes" optional rows={2} value={m.notes ?? ''} onChange={e => setM({ ...m, notes: e.target.value })} />
      </div>
      <datalist id="rm-cats">{RM_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="rm-units">{RM_UNITS.map(u => <option key={u} value={u} />)}</datalist>
    </Drawer>
  );
}

function StockModal({ material, initialType, onClose }: { material: RawMaterial; initialType: string; onClose: () => void }) {
  const toast = useToast();
  const me = useMe();
  const qc = useQueryClient();
  const [type, setType] = useState(initialType);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [unitCost, setUnitCost] = useState<number | null>(material.costPrice ?? null);
  const [supplier, setSupplier] = useState<Supplier | null>(material.supplierId ? { id: material.supplierId, name: material.supplierName ?? '' } as Supplier : null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const go = useMutation({
    mutationFn: () => api.post('/api/raw-materials/stock', { rawMaterialId: material.id, type, quantity, unitCost: type === 'RECEIVE' ? unitCost : null, supplierId: type === 'RECEIVE' ? supplier?.id : null, reference, note }),
    onSuccess: () => { toast.success('Stock updated'); qc.invalidateQueries({ queryKey: ['raw-materials'] }); qc.invalidateQueries({ queryKey: ['rm-movements'] }); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const after = material.stock + (type === 'RECEIVE' || type === 'ADJUST_IN' ? 1 : -1) * (quantity ?? 0);
  return (
    <Modal open onClose={onClose} title={material.name} width={500}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!quantity || after < 0 || (type !== 'RECEIVE' && !note.trim())} onClick={() => go.mutate()} aria-busy={go.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <Segmented value={type} onChange={setType} label="Entry" options={[{ value: 'RECEIVE', label: 'Receive' }, { value: 'ADJUST_IN', label: 'Adjust +' }, { value: 'ADJUST_OUT', label: 'Adjust −' }, { value: 'WASTAGE', label: 'Wastage' }]} />
        <div className="grid grid-2">
          <NumberInput label={`Quantity (${material.unit})`} required autoFocus value={quantity} min={0} step={0.001} onChange={setQuantity} />
          {type === 'RECEIVE' && me.canSeeCost && <NumberInput label="Cost per unit" money value={unitCost} onChange={setUnitCost} hint="Updates the weighted average cost" />}
        </div>
        {type === 'RECEIVE' && <><SupplierPicker value={supplier} onChange={setSupplier} /><TextInput label="Bill / challan no." optional value={reference} onChange={e => setReference(e.target.value)} /></>}
        <TextInput label={type === 'RECEIVE' ? 'Note' : 'Reason'} required={type !== 'RECEIVE'} optional={type === 'RECEIVE'} value={note} onChange={e => setNote(e.target.value)} placeholder={type === 'WASTAGE' ? 'Offcuts, damaged sheet' : ''} />
        <p className="text-sm">In stock: {qty3(material.stock)} → <b className={after < 0 ? 't-bad' : ''}>{qty3(after)} {material.unit}</b></p>
        {type === 'RECEIVE' && <Notice tone="info">For GST input credit, also enter the supplier’s tax invoice under Purchases.</Notice>}
      </div>
    </Modal>
  );
}

function Movements() {
  const list = usePagedList<RawMaterialMovement>('rm-movements', '/api/raw-materials/movements', { filterKeys: ['materialId', 'status'], defaults: { pageSize: 50 } });
  const { state, update } = list;
  const me = useMe();
  const cols: Column<RawMaterialMovement>[] = [
    { key: 'when', header: 'When', mobile: 'meta', render: r => dateTime(r.createdAt), exportValue: r => dateTime(r.createdAt) },
    { key: 'm', header: 'Material', fixed: true, mobile: 'title', render: r => r.materialName, exportValue: r => r.materialName },
    { key: 't', header: 'Entry', mobile: 'sub', render: r => <Badge tone={r.quantityDelta > 0 ? 'ok' : r.movementType === 'WASTAGE' ? 'bad' : 'muted'}>{TYPE_LABEL[r.movementType] ?? r.movementType}</Badge>, exportValue: r => TYPE_LABEL[r.movementType] },
    { key: 'q', header: 'Qty', num: true, mobile: 'right', render: r => <span className={r.quantityDelta > 0 ? 't-ok medium' : 'medium'}>{r.quantityDelta > 0 ? '+' : ''}{qty3(r.quantityDelta)} <span className="muted text-xs">{r.unit}</span></span>, exportValue: r => r.quantityDelta },
    { key: 'a', header: 'Balance', num: true, render: r => qty3(r.stockAfter), exportValue: r => r.stockAfter },
    ...(me.canSeeCost ? [{ key: 'c', header: 'Unit cost', num: true, money: true, optional: true, render: (r: RawMaterialMovement) => <Money value={r.unitCost} />, exportValue: (r: RawMaterialMovement) => r.unitCost } as Column<RawMaterialMovement>] : []),
    { key: 'ref', header: 'Reference', render: r => r.refType === 'PRODUCTION_ORDER' ? <a href={`/production/orders?open=${r.refId}`} className="doc-no text-sm" onClick={e => e.stopPropagation()}>{r.refNumber}</a> : <span className="text-sm">{[r.refNumber, r.supplierName].filter(Boolean).join(' · ') || '—'}</span>, exportValue: r => r.refNumber },
    { key: 'n', header: 'Note', optional: true, render: r => <span className="text-sm soft">{r.note}</span>, exportValue: r => r.note },
    { key: 'by', header: 'By', optional: true, render: r => r.createdByName, exportValue: r => r.createdByName },
  ];
  return (
    <div className="page">
      <PageHeader title="Material movements" desc="Every receipt, issue to production, return and adjustment of raw material. Entries cannot be edited." />
      <DataTable id="rm-movements" label="Material movements" columns={cols} rowKey={r => r.id} {...list.tableProps} compact
        toolbar={<>
          {state.filters.materialId && <button className="chip" aria-pressed="true" onClick={() => update({ filters: { materialId: undefined } })}>One material ×</button>}
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Entry"
            options={[{ value: '', label: 'All' }, { value: 'RECEIVE', label: 'Received' }, { value: 'ISSUE', label: 'Issued' }, { value: 'WASTAGE', label: 'Wastage' }]} />
        </>}
        empty={<EmptyState icon={<History />} title="No movements" />}
        exportAs={{ title: 'Material movements', fetchAll: list.fetchAll }} />
    </div>
  );
}
