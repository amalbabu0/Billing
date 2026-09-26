import { useEffect, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Ban, CalendarClock, CheckCircle2, Factory, KanbanSquare, List, PackageMinus, PackagePlus, Pencil, Plus, Trash2, User } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, daysFromToday, iso, isoInput, money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import { PRIORITY_TONE, PRODUCTION_FLOW, PRODUCTION_LABELS } from '@/lib/status';
import type { Bom, CustomOrder, Paged, ProductionOrder, Sellable, StatusHistory } from '@/lib/types';
import { useCan, useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, DocNo, EmptyState, ErrorPanel, KV, Money, Notice, PageHeader, Segmented, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { ProductPicker, RawMaterialPicker } from '@/components/pickers';
import { WarehouseSelect } from '@/components/Locations';

const q3 = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const refreshKeys = ['production-board', 'production', 'production-order', 'raw-materials', 'custom-order', 'custom-orders-production', 'inventory'];

/** Kanban for the workshop. Drag a card to another column, or use its menu to move it. */
export default function ProductionBoard({ mode = 'board' }: { mode?: 'board' | 'list' }) {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const open = params.get('open') ? Number(params.get('open')) : null;
  const setOpen = (id: number | null) => { const n = new URLSearchParams(params); if (id) n.set('open', String(id)); else n.delete('open'); setParams(n, { replace: !id }); };
  const [create, setCreate] = useState<{ variantId?: number; customOrderId?: number } | null>(null);
  useEffect(() => {
    const v = params.get('new'), co = params.get('customOrder');
    if (v || co) { setCreate({ variantId: v && v !== '1' ? Number(v) : undefined, customOrderId: co ? Number(co) : undefined }); const n = new URLSearchParams(params); n.delete('new'); n.delete('customOrder'); setParams(n, { replace: true }); }
  }, [params, setParams]);
  return (
    <div className="page">
      <PageHeader title={mode === 'board' ? 'Production board' : 'Production orders'}
        desc="Custom furniture and stock products being made in the workshop. Issue materials, move each order through the stages, and complete it after quality check."
        actions={<>
          <Link className="btn" to={mode === 'board' ? '/production/orders' : '/production'}>{mode === 'board' ? <><List aria-hidden />List</> : <><KanbanSquare aria-hidden />Board</>}</Link>
          {can(P.ProductionManage) && <button className="btn btn-primary" onClick={() => setCreate({})}><Plus aria-hidden />New production order</button>}
        </>} />
      {mode === 'board' ? <Board onOpen={setOpen} /> : <OrderList onOpen={setOpen} />}
      <ProductionDrawer id={open} onClose={() => setOpen(null)} />
      {create && <NewProductionModal initial={create} onClose={() => setCreate(null)} onCreated={id => { setCreate(null); setOpen(id); }} />}
    </div>
  );
}

function Board({ onOpen }: { onOpen: (id: number) => void }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['production-board'], queryFn: () => api.get<ProductionOrder[]>('/api/production/board'), refetchInterval: 60_000 });
  const [over, setOver] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/api/production/${id}/move`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['production-board'] });
      const prev = qc.getQueryData<ProductionOrder[]>(['production-board']);
      qc.setQueryData<ProductionOrder[]>(['production-board'], rows => rows?.map(r => (r.id === id ? { ...r, status } : r)));
      return { prev };
    },
    onError: (e, _, ctx) => { if (ctx?.prev) qc.setQueryData(['production-board'], ctx.prev); toast.error('Not moved', errorMessage(e)); },
    onSuccess: (_, v) => toast.success(`Moved to ${PRODUCTION_LABELS[v.status]}`),
    onSettled: () => refreshKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] })),
  });
  if (error) return <ErrorPanel error={error} retry={() => void refetch()} />;
  if (isLoading) return <SkeletonRows rows={6} />;
  const manage = can(P.ProductionManage);
  const drop = (e: DragEvent, status: string) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const card = data?.find(r => r.id === id);
    if (card && card.status !== status) move.mutate({ id, status });
  };
  const done = (data ?? []).filter(r => r.status === 'COMPLETED');
  return <>
    <div className="board board-wide" aria-label="Production board">
      {PRODUCTION_FLOW.map(col => {
        const items = (data ?? []).filter(r => r.status === col);
        return (
          <section key={col} className={`board-col ${over === col ? 'drop-over' : ''}`} aria-label={PRODUCTION_LABELS[col]}
            onDragOver={manage ? e => { e.preventDefault(); setOver(col); } : undefined} onDragLeave={() => setOver(o => (o === col ? null : o))} onDrop={manage ? e => drop(e, col) : undefined}>
            <div className="board-col-head"><Status value={col} text={PRODUCTION_LABELS[col]} /><span className="count">{items.length}</span></div>
            <div className="board-col-body">
              {items.length === 0 && <p className="text-xs muted" style={{ padding: '8px 10px' }}>{manage ? 'Drop here' : 'Nothing here.'}</p>}
              {items.map(o => <ProductionCard key={o.id} o={o} draggable={manage} onOpen={() => onOpen(o.id)} onMove={status => move.mutate({ id: o.id, status })} />)}
            </div>
          </section>
        );
      })}
    </div>
    {done.length > 0 && <p className="text-sm muted">Completed in the last 3 days: {done.map(d => <button key={d.id} className="btn btn-sm btn-ghost" onClick={() => onOpen(d.id)}>{d.number}</button>)}</p>}
  </>;
}

function ProductionCard({ o, draggable, onOpen, onMove }: { o: ProductionOrder; draggable: boolean; onOpen: () => void; onMove: (s: string) => void }) {
  const d = daysFromToday(o.dueDate);
  const idx = PRODUCTION_FLOW.indexOf(o.status as typeof PRODUCTION_FLOW[number]);
  return (
    <div className="dcard" role="button" tabIndex={0} draggable={draggable} onDragStart={e => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }} aria-label={`${o.number} ${o.description}`}>
      <div className="row between"><span className="doc-no text-sm">{o.number}</span>
        <span className="row gap-1">{o.priority !== 'NORMAL' && <Badge tone={PRIORITY_TONE[o.priority]}>{o.priority.toLowerCase()}</Badge>}
          {draggable && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><Menu label="Move" items={[
            ...(idx < PRODUCTION_FLOW.length - 1 ? [{ label: `Move to ${PRODUCTION_LABELS[PRODUCTION_FLOW[idx + 1]]}`, icon: <ArrowRight />, onClick: () => onMove(PRODUCTION_FLOW[idx + 1]) }] : []),
            ...PRODUCTION_FLOW.filter((s, i) => s !== o.status && i !== idx + 1).map(s => ({ label: PRODUCTION_LABELS[s], onClick: () => onMove(s) })),
          ]} /></span>}</span></div>
      <div className="medium">{o.description}{o.quantity !== 1 && <span className="muted"> × {o.quantity}</span>}</div>
      {(o.customOrderNumber || o.customerName) && <div className="text-xs soft">{o.customOrderNumber} · {o.customerName}</div>}
      <div className="meta">
        {o.dueDate && <span className={`row gap-1 ${d !== null && d < 0 ? 't-bad' : d !== null && d <= 2 ? 't-warn' : ''}`}><CalendarClock aria-hidden />{date(o.dueDate)}</span>}
        {o.assignedTo && <span className="row gap-1"><User aria-hidden />{o.assignedTo}</span>}
        {o.materialsShort > 0 && <span className="row gap-1 t-warn"><AlertTriangle aria-hidden />{o.materialsShort} material{o.materialsShort > 1 ? 's' : ''} to issue</span>}
      </div>
    </div>
  );
}

function OrderList({ onOpen }: { onOpen: (id: number) => void }) {
  const list = usePagedList<ProductionOrder>('production', '/api/production', { filterKeys: ['status'] });
  const { state, update } = list;
  const me = useMe();
  const cols: Column<ProductionOrder>[] = [
    { key: 'n', header: 'Order', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'd', header: 'What', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.description}{r.quantity !== 1 ? ` × ${r.quantity}` : ''}</span><span className="cell-sub">{r.customOrderNumber ? `${r.customOrderNumber} · ${r.customerName}` : r.sku ?? ''}</span></div>, exportValue: r => r.description },
    { key: 'due', header: 'Due', mobile: 'meta', render: r => date(r.dueDate), exportValue: r => date(r.dueDate) },
    { key: 'p', header: 'Priority', render: r => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.toLowerCase()}</Badge>, exportValue: r => r.priority },
    { key: 'a', header: 'Assigned', optional: true, render: r => r.assignedTo ?? '—', exportValue: r => r.assignedTo },
    ...(me.canSeeCost ? [{ key: 'c', header: 'Cost so far', num: true, money: true, render: (r: ProductionOrder) => <Money value={r.totalCost} />, exportValue: (r: ProductionOrder) => r.totalCost } as Column<ProductionOrder>] : []),
    { key: 's', header: 'Stage', mobile: 'right', render: r => <Status value={r.status} text={PRODUCTION_LABELS[r.status]} />, exportValue: r => PRODUCTION_LABELS[r.status] },
  ];
  return (
    <DataTable id="production" label="Production orders" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => onOpen(r.id)}
      toolbar={<>
        <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Order, description, customer or worker" />
        <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Status"
          options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      </>}
      empty={<EmptyState icon={<Factory />} title="No production orders" />}
      exportAs={{ title: 'Production orders', fetchAll: list.fetchAll }} />
  );
}

export function ProductionDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['production-order', id], queryFn: () => api.get<{ order: ProductionOrder; history: StatusHistory[] }>(`/api/production/${id}`), enabled: !!id });
  const [issue, setIssue] = useState<'issue' | 'return' | null>(null);
  const [edit, setEdit] = useState(false);
  const refresh = () => refreshKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const move = useMutation({ mutationFn: (status: string) => api.post(`/api/production/${id}/move`, { status }), onSuccess: (_, s) => { toast.success(`Moved to ${PRODUCTION_LABELS[s]}`); refresh(); }, onError: e => toast.error('Not moved', errorMessage(e)) });
  const complete = useMutation({
    mutationFn: () => api.post(`/api/production/${id}/complete`, {}),
    onSuccess: () => { toast.success('Production completed', o?.customOrderId ? 'The custom order moved to quality check with its production cost.' : 'Finished goods added to stock.'); refresh(); },
    onError: e => toast.error('Not completed', errorMessage(e)),
  });
  const o = data?.order;
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${o!.number}?`, message: 'Issued materials go back to raw material stock.', confirmText: 'Cancel order', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/production/${o!.id}/cancel`, { reason }); toast.success('Production order cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };
  const closed = o && ['COMPLETED', 'CANCELLED'].includes(o.status);
  const idx = o ? PRODUCTION_FLOW.indexOf(o.status as typeof PRODUCTION_FLOW[number]) : -1;
  const next = idx >= 0 && idx < PRODUCTION_FLOW.length - 1 ? PRODUCTION_FLOW[idx + 1] : null;
  const manage = can(P.ProductionManage);
  const canComplete = o && (o.status === 'QC' || o.status === 'READY');
  return (
    <Drawer open={!!id} onClose={onClose} wide title={o ? o.number : 'Production order'} sub={o && <Status value={o.status} text={PRODUCTION_LABELS[o.status]} />}
      footer={o && !closed && manage && <>
        <button className="btn btn-ghost" onClick={cancel}><Ban aria-hidden />Cancel</button>
        <button className="btn btn-ghost" onClick={() => setEdit(true)}><Pencil aria-hidden />Edit</button>
        <span className="grow" />
        {canComplete ? <button className="btn btn-primary" onClick={() => complete.mutate()} aria-busy={complete.isPending}><CheckCircle2 aria-hidden />Complete</button>
          : next && <button className="btn btn-primary" onClick={() => move.mutate(next)} aria-busy={move.isPending}><ArrowRight aria-hidden />{PRODUCTION_LABELS[next]}</button>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !o ? <SkeletonRows rows={6} cols={2} /> : (
        <div className="stack gap-5">
          <div>
            <div className="medium" style={{ fontSize: 17 }}>{o.description}{o.quantity !== 1 && <span className="muted"> × {o.quantity}</span>}</div>
            {o.customOrderId && <p className="text-sm soft" style={{ marginTop: 4 }}>For <Link to={`/custom-orders/${o.customOrderId}`} onClick={onClose}>{o.customOrderNumber}</Link> · {o.customerName}</p>}
          </div>
          {o.status === 'CANCELLED' && <Notice tone="bad">Cancelled — {o.cancelReason}</Notice>}
          {o.materialsShort > 0 && !closed && <Notice tone="warn">{o.materialsShort} material{o.materialsShort > 1 ? 's are' : ' is'} not fully issued. Work stages from Cutting onward need every material issued.</Notice>}
          <KV items={[
            ['Priority', <Badge tone={PRIORITY_TONE[o.priority]}>{o.priority.toLowerCase()}</Badge>], ['Due', date(o.dueDate)], ['Assigned to', o.assignedTo ?? '—'],
            !!o.variantId && ['Finished goods to', o.warehouseName ?? 'Default location'], !!o.startedAt && ['Work started', dateTime(o.startedAt)], !!o.completedAt && ['Completed', dateTime(o.completedAt)],
            !!o.notes && ['Notes', o.notes],
          ]} />
          <div>
            <div className="row between" style={{ marginBottom: 8 }}><div className="caps">Materials</div>
              {manage && !closed && <div className="row gap-2">
                <button className="btn btn-sm" onClick={() => setIssue('issue')}><PackageMinus aria-hidden />Issue</button>
                {o.materials.some(m => m.quantityIssued > 0) && <button className="btn btn-sm btn-ghost" onClick={() => setIssue('return')}><PackagePlus aria-hidden />Return</button>}
              </div>}</div>
            {o.materials.length === 0 ? <p className="text-sm muted">No materials planned.</p> : (
              <table className="data compact"><thead><tr><th>Material</th><th className="num">Required</th><th className="num">Issued</th><th className="num">In stock</th></tr></thead>
                <tbody>{o.materials.map(m => <tr key={m.id}><td><div className="cell-title">{m.name}</div><div className="cell-sub mono">{m.code}</div></td>
                  <td className="num">{q3(m.quantityRequired)} {m.unit}</td>
                  <td className={`num ${m.quantityIssued >= m.quantityRequired ? 't-ok' : 't-warn'}`}>{q3(m.quantityIssued)}</td>
                  <td className={`num ${(m.stock ?? 0) < m.pending ? 't-bad' : 'muted'}`}>{q3(m.stock ?? 0)}</td></tr>)}</tbody></table>
            )}
          </div>
          {me.canSeeCost && <div className="pay-position">
            <div className="row-line"><span>Materials issued</span><span>{money(o.materialCost)}</span></div>
            <div className="row-line"><span>Labour</span><span>{money(o.labourCost)}</span></div>
            <div className="row-line"><span>Other</span><span>{money(o.otherCost)}</span></div>
            <div className="row-line remaining"><span>Production cost</span><span>{money(o.totalCost)}</span></div>
            {o.quantity > 1 && <div className="row-line text-sm muted"><span>Per unit</span><span>{money((o.totalCost ?? 0) / o.quantity)}</span></div>}
          </div>}
          {data.history.length > 0 && <div><div className="caps" style={{ marginBottom: 8 }}>History</div>
            <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: PRODUCTION_LABELS[h.toStatus] ?? h.toStatus, detail: h.note, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}`, tone: h.toStatus === 'CANCELLED' ? 'bad' as const : 'ok' as const }))} /></div>}
        </div>
      )}
      {o && issue && <IssueModal order={o} mode={issue} onClose={() => setIssue(null)} onDone={refresh} />}
      {o && edit && <EditProductionModal order={o} onClose={() => setEdit(false)} onDone={refresh} />}
    </Drawer>
  );
}

function IssueModal({ order, mode, onClose, onDone }: { order: ProductionOrder; mode: 'issue' | 'return'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState<Record<number, number>>(() => Object.fromEntries(order.materials.map(m => [m.rawMaterialId, mode === 'issue' ? Math.min(m.pending, m.stock ?? 0) : 0])));
  const [extra, setExtra] = useState<{ id: number; name: string; unit: string; qty: number }[]>([]);
  const go = useMutation({
    mutationFn: () => api.post(`/api/production/${order.id}/issue`, { return: mode === 'return', lines: [...Object.entries(q).map(([k, v]) => ({ rawMaterialId: Number(k), quantity: v })), ...extra.map(e => ({ rawMaterialId: e.id, quantity: e.qty }))].filter(l => l.quantity > 0) }),
    onSuccess: () => { toast.success(mode === 'issue' ? 'Materials issued' : 'Materials returned'); onDone(); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const rows = order.materials.filter(m => mode === 'issue' || m.quantityIssued > 0);
  return (
    <Modal open onClose={onClose} title={mode === 'issue' ? `Issue materials — ${order.number}` : `Return materials — ${order.number}`} width={640}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>{mode === 'issue' ? 'Issue' : 'Return'}</button></>}>
      <div className="stack gap-4">
        <table className="data compact"><thead><tr><th>Material</th><th className="num">{mode === 'issue' ? 'Pending' : 'Issued'}</th><th className="num">In stock</th><th style={{ width: 130 }}>Qty</th></tr></thead>
          <tbody>{rows.map(m => <tr key={m.rawMaterialId}><td>{m.name}</td><td className="num">{q3(mode === 'issue' ? m.pending : m.quantityIssued)} {m.unit}</td><td className="num">{q3(m.stock ?? 0)}</td>
            <td><NumberInput value={q[m.rawMaterialId] ?? 0} min={0} max={mode === 'issue' ? m.stock : m.quantityIssued} step={0.001} aria-label={`Quantity of ${m.name}`} onChange={v => setQ(x => ({ ...x, [m.rawMaterialId]: v ?? 0 }))} /></td></tr>)}
            {extra.map((e, i) => <tr key={`x${e.id}`}><td>{e.name} <Badge>extra</Badge></td><td /><td /><td className="row gap-1"><NumberInput value={e.qty} min={0} step={0.001} aria-label={`Quantity of ${e.name}`} onChange={v => setExtra(xs => xs.map((x, j) => j === i ? { ...x, qty: v ?? 0 } : x))} />
              <button className="btn btn-icon btn-ghost btn-sm" aria-label="Remove" onClick={() => setExtra(xs => xs.filter((_, j) => j !== i))}><Trash2 /></button></td></tr>)}
          </tbody></table>
        {mode === 'issue' && <RawMaterialPicker label="Issue an extra material" onPick={m => { if (!order.materials.some(x => x.rawMaterialId === m.id) && !extra.some(x => x.id === m.id)) setExtra(xs => [...xs, { id: m.id, name: m.name, unit: m.unit, qty: 1 }]); }} />}
      </div>
    </Modal>
  );
}

function EditProductionModal({ order, onClose, onDone }: { order: ProductionOrder; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const me = useMe();
  const [f, setF] = useState({ description: order.description, quantity: order.quantity, priority: order.priority, dueDate: isoInput(order.dueDate), assignedTo: order.assignedTo ?? '', warehouseId: order.warehouseId ?? null as number | null, labourCost: order.labourCost ?? null, otherCost: order.otherCost ?? null, notes: order.notes ?? '' });
  const [mats, setMats] = useState<PlanLine[]>(order.materials.map(m => ({ rawMaterialId: m.rawMaterialId, name: m.name ?? "", unit: m.unit ?? "", quantityRequired: m.quantityRequired, issued: m.quantityIssued })));
  const go = useMutation({
    mutationFn: () => api.put(`/api/production/${order.id}`, { ...f, dueDate: f.dueDate || null, customOrderId: order.customOrderId, variantId: order.variantId, materials: mats.map(m => ({ rawMaterialId: m.rawMaterialId, quantityRequired: m.quantityRequired })) }),
    onSuccess: () => { toast.success('Production order saved'); onDone(); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${order.number}`} width={680}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <TextInput label="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <div className="grid grid-4">
          <NumberInput label="Quantity" value={f.quantity} min={0} onChange={v => setF({ ...f, quantity: v ?? 1 })} />
          <Select label="Priority" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as ProductionOrder['priority'] })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          <TextInput label="Due" type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} />
          <TextInput label="Assigned to" optional value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: e.target.value })} />
        </div>
        {me.canSeeCost && <div className="grid grid-3"><NumberInput label="Labour" money value={f.labourCost} onChange={v => setF({ ...f, labourCost: v })} /><NumberInput label="Other" money value={f.otherCost} onChange={v => setF({ ...f, otherCost: v })} /></div>}
        {order.variantId && <WarehouseSelect label="Finished goods to" value={f.warehouseId} onChange={id => setF({ ...f, warehouseId: id })} />}
        <MaterialPlan mats={mats} setMats={setMats} />
        <TextArea label="Notes" optional rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

type PlanLine = { rawMaterialId: number; name: string; unit: string; quantityRequired: number; issued?: number };
function MaterialPlan({ mats, setMats }: { mats: PlanLine[]; setMats: (f: (m: PlanLine[]) => PlanLine[]) => void }) {
  return (
    <div className="stack gap-2">
      <span className="field-label">Material plan</span>
      {mats.length > 0 && <table className="data compact"><thead><tr><th>Material</th><th style={{ width: 150 }}>Required</th><th style={{ width: 44 }} /></tr></thead>
        <tbody>{mats.map((m, i) => <tr key={m.rawMaterialId}><td>{m.name}{m.issued ? <span className="text-xs muted"> · {q3(m.issued)} issued</span> : null}</td>
          <td className="row gap-1"><NumberInput value={m.quantityRequired} min={m.issued ?? 0} step={0.001} aria-label={`Required ${m.name}`} onChange={v => setMats(xs => xs.map((x, j) => j === i ? { ...x, quantityRequired: v ?? 0 } : x))} /><span className="text-xs muted">{m.unit}</span></td>
          <td>{!m.issued && <button className="btn btn-icon btn-ghost btn-sm" aria-label={`Remove ${m.name}`} onClick={() => setMats(xs => xs.filter((_, j) => j !== i))}><Trash2 /></button>}</td></tr>)}</tbody></table>}
      <RawMaterialPicker label="Add material to plan" onPick={m => setMats(xs => xs.some(x => x.rawMaterialId === m.id) ? xs : [...xs, { rawMaterialId: m.id, name: m.name, unit: m.unit, quantityRequired: 1 }])} />
    </div>
  );
}

function NewProductionModal({ initial, onClose, onCreated }: { initial: { variantId?: number; customOrderId?: number }; onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const me = useMe();
  const qc = useQueryClient();
  const [source, setSource] = useState<'product' | 'custom'>(initial.customOrderId ? 'custom' : 'product');
  const [product, setProduct] = useState<{ variantId: number; name: string } | null>(null);
  const [customOrderId, setCustomOrderId] = useState<number | ''>(initial.customOrderId ?? '');
  const [f, setF] = useState({ quantity: 1, priority: 'NORMAL', dueDate: iso(new Date(Date.now() + 10 * 86400000)), assignedTo: '', warehouseId: null as number | null, labourCost: null as number | null, otherCost: null as number | null, notes: '', description: '' });
  const [mats, setMats] = useState<PlanLine[]>([]);
  const cos = useQuery({ queryKey: ['custom-orders-active-pick'], queryFn: () => api.get<Paged<CustomOrder>>('/api/custom-orders', { stage: 'ACTIVE', pageSize: 100 }), enabled: source === 'custom' });
  const initialProduct = useQuery({ queryKey: ['sellable', 'one', initial.variantId], queryFn: () => api.get<Sellable>(`/api/sellable/${initial.variantId}`), enabled: !!initial.variantId });
  useEffect(() => { if (initialProduct.data) setProduct({ variantId: initialProduct.data.variantId, name: initialProduct.data.displayName }); }, [initialProduct.data]);
  const bom = useQuery({ queryKey: ['bom', product?.variantId], queryFn: () => api.get<Bom>(`/api/boms/${product!.variantId}`), enabled: !!product });
  const go = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/production', {
      ...f, dueDate: f.dueDate || null, description: f.description || null, variantId: source === 'product' ? product?.variantId : null, customOrderId: source === 'custom' ? customOrderId || null : null,
      materials: source === 'custom' || !bom.data?.lines.length ? mats.map(m => ({ rawMaterialId: m.rawMaterialId, quantityRequired: m.quantityRequired })) : [],
    }),
    onSuccess: r => { toast.success('Production order created'); refreshKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] })); onCreated(r.id); },
    onError: e => toast.error('Not created', errorMessage(e)),
  });
  const valid = source === 'product' ? !!product : !!customOrderId;
  const bomLines = bom.data?.lines ?? [];
  return (
    <Modal open onClose={onClose} title="New production order" width={720}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid} onClick={() => go.mutate()} aria-busy={go.isPending}>Create order</button></>}>
      <div className="stack gap-4">
        <Segmented value={source} onChange={setSource} label="Making" options={[{ value: 'product', label: 'Stock product' }, { value: 'custom', label: 'Custom order' }]} />
        {source === 'product' ? (
          product ? <div className="row between card card-pad" style={{ padding: 12 }}><span className="medium">{product.name}</span><button className="btn btn-sm btn-ghost" onClick={() => setProduct(null)}>Change</button></div>
            : <ProductPicker label="Product to make" showStock onPick={s => setProduct({ variantId: s.variantId, name: s.displayName })} autoFocus />
        ) : (
          <Select label="Custom order" value={customOrderId} onChange={e => setCustomOrderId(Number(e.target.value) || '')}
            options={[{ value: '', label: cos.isLoading ? 'Loading…' : 'Choose…' }, ...(cos.data?.items ?? []).map(c => ({ value: c.id, label: `${c.number} · ${c.productType} · ${c.customerName}` }))]} />
        )}
        <div className="grid grid-4">
          <NumberInput label="Quantity" value={f.quantity} min={0} onChange={v => setF({ ...f, quantity: v ?? 1 })} />
          <Select label="Priority" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          <TextInput label="Due" type="date" value={f.dueDate} min={iso()} onChange={e => setF({ ...f, dueDate: e.target.value })} />
          <TextInput label="Assigned to" optional value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: e.target.value })} placeholder="Carpenter" />
        </div>
        {source === 'product' && product && (bomLines.length > 0
          ? <Notice tone="info">Materials, labour and other costs come from the <Link to={`/production/boms/${product.variantId}`}>bill of materials</Link> × {f.quantity}: {bomLines.map(l => `${l.name} ${q3(l.grossQuantity * f.quantity)} ${l.unit}`).join(', ')}.</Notice>
          : <Notice tone="warn">This product has no bill of materials. Add the materials below, or <Link to={`/production/boms/${product.variantId}`}>create its BOM</Link> first.</Notice>)}
        {(source === 'custom' || (product && bomLines.length === 0)) && <MaterialPlan mats={mats} setMats={setMats} />}
        {me.canSeeCost && (source === 'custom' || bomLines.length === 0) && <div className="grid grid-3"><NumberInput label="Labour" optional money value={f.labourCost} onChange={v => setF({ ...f, labourCost: v })} /><NumberInput label="Other" optional money value={f.otherCost} onChange={v => setF({ ...f, otherCost: v })} /></div>}
        {source === 'product' && <WarehouseSelect label="Finished goods to" value={f.warehouseId} onChange={id => setF({ ...f, warehouseId: id })} />}
        <TextArea label="Notes" optional rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}
