import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, Ban, PackageCheck, Plus, Trash2, Truck } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { date, dateTime, qty } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import { TRANSFER_LABELS } from '@/lib/status';
import type { StatusHistory, StockTransfer } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, ErrorPanel, KV, Notice, PageHeader, Segmented, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, TextInput } from '@/components/ui/form';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { ProductPicker } from '@/components/pickers';
import { useWarehouses } from '@/components/Locations';

export default function Transfers() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const list = usePagedList<StockTransfer>('transfers', '/api/transfers', { filterKeys: ['status'] });
  const { state, update } = list;
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<StockTransfer | 'new' | null>(null);
  useEffect(() => { if (params.get('new')) { setEdit('new'); params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);
  const cols: Column<StockTransfer>[] = [
    { key: 'n', header: 'Transfer', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.transferDate), exportValue: r => date(r.transferDate) },
    { key: 'route', header: 'From → to', mobile: 'sub', render: r => <span className="row gap-2">{r.fromName}<ArrowRight aria-hidden style={{ width: 14 }} />{r.toName}</span>, exportValue: r => `${r.fromName} → ${r.toName}` },
    { key: 'q', header: 'Items', num: true, render: r => `${r.lineCount} · ${qty(r.totalQty)} units`, exportValue: r => r.totalQty },
    { key: 'v', header: 'Vehicle', optional: true, render: r => r.vehicleNo ?? '—', exportValue: r => r.vehicleNo },
    { key: 'by', header: 'Created by', optional: true, render: r => r.createdByName, exportValue: r => r.createdByName },
    { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} text={TRANSFER_LABELS[r.status]} />, exportValue: r => TRANSFER_LABELS[r.status] },
  ];
  return (
    <div className="page">
      <PageHeader title="Stock transfers" desc="Move goods between showrooms, godowns and the workshop. Dispatched goods are in transit — not sellable anywhere — until received."
        actions={can(P.WarehouseManage) && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus aria-hidden />New transfer</button>} />
      <DataTable id="transfers" label="Transfers" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => setOpen(r.id)}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Transfer no. or location" />
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Status"
            options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'DRAFT', label: 'Draft' }, { value: 'IN_TRANSIT', label: 'In transit' }, { value: 'RECEIVED', label: 'Received' }]} />
        </>}
        empty={<EmptyState icon={<ArrowLeftRight />} title="No transfers yet" desc="Add a second location first, then move stock to it." />}
        exportAs={{ title: 'Stock transfers', fetchAll: list.fetchAll }} />
      <TransferDrawer id={open} onClose={() => setOpen(null)} onEdit={t => { setOpen(null); setEdit(t); }} />
      <TransferEditor value={edit} onClose={() => setEdit(null)} onSaved={id => { setEdit(null); setOpen(id); }} />
    </div>
  );
}

function TransferDrawer({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (t: StockTransfer) => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['transfer', id], queryFn: () => api.get<{ transfer: StockTransfer; history: StatusHistory[] }>(`/api/transfers/${id}`), enabled: !!id });
  const refresh = () => ['transfer', 'transfers', 'warehouses', 'location-stock', 'inventory'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({
    mutationFn: (a: 'dispatch' | 'in-transit' | 'receive') => api.post(`/api/transfers/${id}/${a}`),
    onSuccess: (_, a) => { toast.success(a === 'dispatch' ? 'Dispatched — stock is in transit' : a === 'receive' ? 'Received into stock' : 'Marked in transit'); refresh(); },
    onError: e => toast.error('Not updated', errorMessage(e)),
  });
  const t = data?.transfer;
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${t!.number}?`, message: t!.status === 'DRAFT' ? 'The draft is closed.' : 'The goods go back into stock at the source location.', confirmText: 'Cancel transfer', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/transfers/${t!.id}/cancel`, { reason }); toast.success('Transfer cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };
  const manage = can(P.WarehouseManage);
  const open = t && !['RECEIVED', 'CANCELLED'].includes(t.status);
  const short = t?.status === 'DRAFT' && t.lines.some(l => (l.fromStock ?? 0) < l.quantity);
  return (
    <Drawer open={!!id} onClose={onClose} title={t?.number ?? 'Transfer'} sub={t && <Status value={t.status} text={TRANSFER_LABELS[t.status]} />}
      footer={t && open && manage && <>
        <button className="btn btn-ghost" onClick={cancel}><Ban aria-hidden />Cancel</button>
        <span className="grow" />
        {t.status === 'DRAFT' && <><button className="btn" onClick={() => onEdit(t)}>Edit</button><button className="btn btn-primary" disabled={short} onClick={() => act.mutate('dispatch')} aria-busy={act.isPending}><Truck aria-hidden />Dispatch</button></>}
        {t.status === 'DISPATCHED' && <button className="btn" onClick={() => act.mutate('in-transit')}>Mark in transit</button>}
        {(t.status === 'DISPATCHED' || t.status === 'IN_TRANSIT') && <button className="btn btn-primary" onClick={() => act.mutate('receive')} aria-busy={act.isPending}><PackageCheck aria-hidden />Receive</button>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !t ? <SkeletonRows rows={5} cols={2} /> : (
        <div className="stack gap-5">
          <div className="row gap-3 medium" style={{ fontSize: 16 }}>{t.fromName}<ArrowRight aria-hidden style={{ width: 16 }} />{t.toName}</div>
          {short && <Notice tone="warn">Some items are short at {t.fromName}. Edit the quantities or receive stock there first.</Notice>}
          {t.status === 'CANCELLED' && <Notice tone="bad">Cancelled — {t.cancelReason}</Notice>}
          <KV items={[['Date', date(t.transferDate)], ['Vehicle', t.vehicleNo ?? '—'], !!t.dispatchedAt && ['Dispatched', dateTime(t.dispatchedAt)], !!t.receivedAt && ['Received', dateTime(t.receivedAt)], ['Created by', t.createdByName ?? '—'], !!t.notes && ['Notes', t.notes]]} />
          <table className="data compact"><thead><tr><th>Item</th><th className="num">Qty</th>{t.status === 'DRAFT' && <th className="num">At source</th>}</tr></thead>
            <tbody>{t.lines.map(l => <tr key={l.id}><td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td><td className="num medium">{qty(l.quantity)}</td>
              {t.status === 'DRAFT' && <td className={`num ${(l.fromStock ?? 0) < l.quantity ? 't-bad' : ''}`}>{qty(l.fromStock ?? 0)}</td>}</tr>)}</tbody></table>
          {data.history.length > 0 && <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: TRANSFER_LABELS[h.toStatus] ?? h.toStatus, detail: h.note, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}` }))} />}
        </div>
      )}
    </Drawer>
  );
}

interface Line { variantId: number; description: string; sku: string; quantity: number }

function TransferEditor({ value, onClose, onSaved }: { value: StockTransfer | 'new' | null; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: warehouses = [] } = useWarehouses();
  const [from, setFrom] = useState<number | ''>('');
  const [to, setTo] = useState<number | ''>('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) {
    setKey(value);
    const t = value && value !== 'new' ? value : null;
    setFrom(t?.fromWarehouseId ?? warehouses.find(w => w.isDefault)?.id ?? '');
    setTo(t?.toWarehouseId ?? warehouses.find(w => !w.isDefault)?.id ?? '');
    setVehicle(t?.vehicleNo ?? ''); setNotes(t?.notes ?? '');
    setLines(t?.lines.map(l => ({ variantId: l.variantId, description: l.description ?? '', sku: l.sku ?? '', quantity: l.quantity })) ?? []);
  }
  const editing = value && value !== 'new' ? value : null;
  const save = useMutation({
    mutationFn: () => {
      const body = { fromWarehouseId: from, toWarehouseId: to, vehicleNo: vehicle || null, notes: notes || null, lines: lines.map(l => ({ variantId: l.variantId, quantity: l.quantity })) };
      return editing ? api.put<{ id: number }>(`/api/transfers/${editing.id}`, body) : api.post<{ id: number }>('/api/transfers', body);
    },
    onSuccess: r => { toast.success('Transfer saved', 'Dispatch it when the goods leave.'); qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['transfer'] }); onSaved(r.id); },
    onError: e => toast.error('Not saved', e instanceof ApiError ? errorMessage(e) : String(e)),
  });
  const valid = from && to && from !== to && lines.length > 0 && lines.every(l => l.quantity > 0);
  return (
    <Drawer open={!!value} onClose={onClose} wide title={editing ? `Edit ${editing.number}` : 'New stock transfer'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" disabled={!valid} onClick={() => save.mutate()} aria-busy={save.isPending}>Save draft</button></>}>
      {warehouses.length < 2 ? <Notice tone="info">Add a second location under Inventory → Locations to transfer stock.</Notice> : (
        <div className="stack gap-4">
          <div className="grid grid-2">
            <Select label="From" value={from} onChange={e => setFrom(Number(e.target.value))} options={warehouses.map(w => ({ value: w.id, label: w.name }))} />
            <Select label="To" value={to} onChange={e => setTo(Number(e.target.value))} error={from && from === to ? 'Choose a different location.' : undefined} options={warehouses.map(w => ({ value: w.id, label: w.name }))} />
          </div>
          <div className="grid grid-2">
            <TextInput label="Vehicle no." optional value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} />
            <TextInput label="Notes" optional value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <ProductPicker label="Add product" onPick={s => setLines(ls => ls.some(l => l.variantId === s.variantId) ? ls : [...ls, { variantId: s.variantId, description: s.displayName, sku: s.sku, quantity: 1 }])} />
          {lines.length === 0 ? <EmptyState compact title="No items yet" desc="Search above to add products." /> : (
            <table className="data compact"><thead><tr><th>Item</th><th style={{ width: 120 }}>Qty</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>{lines.map((l, i) => <tr key={l.variantId}><td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td>
                <td><NumberInput value={l.quantity} min={0} aria-label="Quantity" onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, quantity: v ?? 0 } : x))} /></td>
                <td><button className="btn btn-icon btn-ghost btn-sm" aria-label="Remove" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Trash2 /></button></td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </Drawer>
  );
}
