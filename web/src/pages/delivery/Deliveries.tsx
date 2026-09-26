import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, Camera, CheckCircle2, KanbanSquare, List, MapPin, MessageCircle, Phone, Truck, User, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, iso, isoInput, label, money, qty } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Delivery, DocumentPosition, StatusHistory } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, DocNo, EmptyState, ErrorPanel, KV, Notice, PageHeader, Segmented, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { PRIORITY_TONE } from '@/lib/status';
import { NumberInput, SearchInput, Select, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, Modal, useConfirm } from '@/components/ui/overlay';
import { WhatsAppDialog } from '@/components/DocActions';

const VIEWS: Record<string, { title: string; status?: string; desc: string }> = {
  all: { title: 'Delivery board', desc: 'Every open delivery from billing to doorstep. Open a card to schedule, dispatch or record proof of delivery.' },
  pending: { title: 'Pending deliveries', status: 'PENDING', desc: 'Billed goods waiting for a date, driver and vehicle.' },
  scheduled: { title: 'Scheduled deliveries', status: 'SCHEDULED', desc: 'Booked with the customer. Dispatch when the vehicle leaves.' },
  out: { title: 'Out for delivery', status: 'OUT_FOR_DELIVERY', desc: 'On the road. Record the receiver, OTP, signature or photo on arrival.' },
  delivered: { title: 'Delivered', status: 'DELIVERED', desc: 'Completed deliveries with their proof of delivery.' },
};
const COLS = [
  { status: 'PENDING', title: 'To schedule' }, { status: 'SCHEDULED', title: 'Scheduled' },
  { status: 'OUT_FOR_DELIVERY', title: 'Out for delivery' }, { status: 'DELIVERED', title: 'Delivered today' },
];
export const SLOTS = ['9 AM – 12 PM', '12 PM – 3 PM', '3 PM – 6 PM', '6 PM – 9 PM'];

export default function Deliveries() {
  const { view = 'all' } = useParams();
  const v = VIEWS[view] ?? VIEWS.all;
  const [params, setParams] = useSearchParams();
  const open = params.get('open') ? Number(params.get('open')) : null;
  const setOpen = (id: number | null) => { const n = new URLSearchParams(params); if (id) n.set('open', String(id)); else n.delete('open'); setParams(n, { replace: !id }); };
  const [mode, setMode] = useState<'board' | 'list'>(view === 'all' ? 'board' : 'list');
  useEffect(() => setMode(view === 'all' ? 'board' : 'list'), [view]);
  return (
    <div className="page">
      <PageHeader title={v.title} desc={v.desc}
        actions={view === 'all' && <Segmented value={mode} onChange={setMode} label="Layout" options={[{ value: 'board', label: 'Board', icon: <KanbanSquare /> }, { value: 'list', label: 'List', icon: <List /> }]} />} />
      {mode === 'board' ? <Board onOpen={setOpen} /> : <DeliveryList view={view} status={v.status} onOpen={setOpen} />}
      <DeliveryDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Board({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['deliveries-board'], queryFn: () => api.get<Delivery[]>('/api/deliveries/board'), refetchInterval: 60_000 });
  if (error) return <ErrorPanel error={error} retry={() => void refetch()} />;
  if (isLoading) return <SkeletonRows rows={6} />;
  const today = iso();
  return (
    <div className="board" aria-label="Delivery board">
      {COLS.map(c => {
        const items = (data ?? []).filter(d => d.status === c.status || (c.status === 'PENDING' && d.status === 'FAILED'));
        return (
          <section key={c.status} className="board-col" aria-label={c.title}>
            <div className="board-col-head"><Status value={c.status} text={c.title} /><span className="count">{items.length}</span></div>
            <div className="board-col-body">
              {items.length === 0 && <p className="text-xs muted" style={{ padding: '8px 10px' }}>Nothing here.</p>}
              {items.map(d => {
                const late = d.scheduledDate && isoInput(d.scheduledDate) < today && d.status !== 'DELIVERED';
                return (
                  <button key={d.id} className="dcard" onClick={() => onOpen(d.id)}>
                    <div className="row between"><span className="doc-no text-sm">{d.number}</span><span className="row gap-1">
                      {d.priority && d.priority !== 'NORMAL' && d.priority !== 'LOW' && <Badge tone={PRIORITY_TONE[d.priority]}>{d.priority.toLowerCase()}</Badge>}
                      {d.status === 'FAILED' ? <Status value="FAILED" /> : late ? <Status value="OVERDUE" text="Late" /> : null}</span></div>
                    <div className="medium">{d.customerName}</div>
                    <div className="addr">{d.deliveryAddress}</div>
                    {d.itemsSummary && <div className="text-xs soft truncate">{d.itemsSummary}</div>}
                    <div className="meta">
                      {d.scheduledDate && <span className="row gap-1"><CalendarClock aria-hidden />{date(d.scheduledDate)}{d.timeSlot ? ` · ${d.timeSlot}` : ''}</span>}
                      {d.driverName && <span className="row gap-1"><User aria-hidden />{d.driverName}</span>}
                      {d.vehicleNo && <span className="row gap-1"><Truck aria-hidden />{d.vehicleNo}</span>}
                      {d.route && <span className="row gap-1"><MapPin aria-hidden />{d.route}{d.routeOrder ? ` · stop ${d.routeOrder}` : ''}</span>}
                      {d.status === 'DELIVERED' && d.deliveredAt && <span className="row gap-1"><CheckCircle2 aria-hidden />{dateTime(d.deliveredAt)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DeliveryList({ view, status, onOpen }: { view: string; status?: string; onOpen: (id: number) => void }) {
  const list = usePagedList<Delivery>(`deliveries-${view}`, '/api/deliveries', { filterKeys: ['from', 'to'], extra: { status } });
  const { state, update } = list;
  const cols: Column<Delivery>[] = [
    { key: 'n', header: 'Delivery', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'src', header: 'Against', render: r => <span className="doc-no text-sm">{r.sourceNumber}</span>, exportValue: r => r.sourceNumber },
    { key: 'c', header: 'Customer', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.customerName}</span><span className="cell-sub truncate" style={{ maxWidth: 280 }}>{r.deliveryAddress}</span></div>, exportValue: r => r.customerName },
    { key: 'd', header: status === 'DELIVERED' ? 'Delivered' : 'Scheduled', mobile: 'meta', render: r => status === 'DELIVERED' ? dateTime(r.deliveredAt) : r.scheduledDate ? `${date(r.scheduledDate)}${r.timeSlot ? ` · ${r.timeSlot}` : ''}` : <span className="muted">Not scheduled</span>, exportValue: r => date(r.deliveredAt ?? r.scheduledDate) },
    { key: 'rt', header: 'Route', optional: true, render: r => r.route ? `${r.route}${r.routeOrder ? ` · ${r.routeOrder}` : ''}` : '—', exportValue: r => r.route },
    { key: 'pr', header: 'Priority', optional: true, render: r => r.priority && r.priority !== 'NORMAL' ? <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.toLowerCase()}</Badge> : '—', exportValue: r => r.priority },
    { key: 'dr', header: 'Driver / vehicle', mobile: 'meta', render: r => [r.driverName, r.vehicleNo].filter(Boolean).join(' · ') || '—', exportValue: r => [r.driverName, r.vehicleNo].filter(Boolean).join(' · ') },
    { key: 'i', header: 'Items', optional: true, render: r => <span className="text-sm soft">{r.itemsSummary}</span>, exportValue: r => r.itemsSummary },
    { key: 'r', header: 'Received by', optional: status !== 'DELIVERED', render: r => r.receiverName ?? '—', exportValue: r => r.receiverName },
    { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} />, exportValue: r => label(r.status) },
  ];
  return (
    <DataTable id={`deliveries-${view}`} label="Deliveries" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => onOpen(r.id)}
      toolbar={<>
        <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Delivery no., customer, mobile or driver" />
        <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="Scheduled from" value={state.filters.from ?? ''} onChange={e => update({ filters: { from: e.target.value || undefined } })} />
        <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="Scheduled to" value={state.filters.to ?? ''} onChange={e => update({ filters: { to: e.target.value || undefined } })} />
      </>}
      empty={<EmptyState icon={<Truck />} title="No deliveries here" desc="Deliveries are created from invoices, sales orders and custom orders." />}
      exportAs={{ title: VIEWS[view]?.title ?? 'Deliveries', fetchAll: list.fetchAll }} />
  );
}

interface Detail { delivery: Delivery; history: StatusHistory[]; payment?: DocumentPosition | null }

export function DeliveryDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, error, refetch } = useQuery({ queryKey: ['delivery', id], queryFn: () => api.get<Detail>(`/api/deliveries/${id}`), enabled: !!id });
  const [schedule, setSchedule] = useState(false);
  const [complete, setComplete] = useState(false);
  const [wa, setWa] = useState<{ open: boolean; otp?: string }>({ open: false });
  const refresh = () => ['delivery', 'deliveries-board', 'deliveries-all', 'deliveries-pending', 'deliveries-scheduled', 'deliveries-out', 'deliveries-delivered', 'dashboard', 'invoice', 'sales-order', 'custom-order']
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const dispatch = useMutation({ mutationFn: () => api.post(`/api/deliveries/${id}/dispatch`), onSuccess: () => { toast.success('Marked out for delivery'); refresh(); }, onError: e => toast.error('Not dispatched', errorMessage(e)) });
  const d = data?.delivery;
  const reasonAction = async (kind: 'fail' | 'cancel') => {
    if (!d) return;
    const reason = await confirm(kind === 'fail'
      ? { title: 'Delivery failed?', message: 'The delivery goes back to “To schedule” so it can be rebooked.', confirmText: 'Mark failed', tone: 'danger', reason: { label: 'What happened', placeholder: 'Customer not available, address locked…' } }
      : { title: `Cancel ${d.number}?`, message: 'The goods stay billed; only this delivery trip is cancelled.', confirmText: 'Cancel delivery', tone: 'danger', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/deliveries/${d.id}/${kind}`, { reason }); toast.success(kind === 'fail' ? 'Marked as failed' : 'Delivery cancelled'); refresh(); } catch (e) { toast.error('Not saved', errorMessage(e)); }
  };
  const closed = d && ['DELIVERED', 'CANCELLED'].includes(d.status);
  const manage = can(P.DeliveryManage);
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? d.number : 'Delivery'} sub={d && <Status value={d.status} />} label="Delivery details"
      footer={d && !closed && manage && <>
        <button className="btn btn-ghost" onClick={() => reasonAction('cancel')}><Ban aria-hidden />Cancel</button>
        <span className="grow" />
        {(d.status === 'PENDING' || d.status === 'FAILED') && <button className="btn btn-primary" onClick={() => setSchedule(true)}><CalendarClock aria-hidden />Schedule</button>}
        {d.status === 'SCHEDULED' && <><button className="btn" onClick={() => setSchedule(true)}>Reschedule</button><button className="btn btn-primary" onClick={() => dispatch.mutate()} aria-busy={dispatch.isPending}><Truck aria-hidden />Dispatch</button></>}
        {d.status === 'OUT_FOR_DELIVERY' && <><button className="btn" onClick={() => reasonAction('fail')}><XCircle aria-hidden />Failed</button><button className="btn btn-primary" onClick={() => setComplete(true)}><CheckCircle2 aria-hidden />Mark delivered</button></>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !d ? <SkeletonRows rows={6} cols={2} /> : (
        <div className="stack gap-5">
          {data.payment && data.payment.balance > 0.5 && d.status !== 'DELIVERED' && <Notice tone="warn">Collect <b>{money(data.payment.balance)}</b> balance on delivery.</Notice>}
          {d.status === 'FAILED' && <Notice tone="bad">The last attempt failed. {d.remarks}</Notice>}
          <div>
            <div className="row between"><Link to={`/customers/${d.customerId}`} className="medium" onClick={onClose}>{d.customerName}</Link>
              <button className="btn btn-sm btn-ghost" onClick={() => setWa({ open: true })}><MessageCircle aria-hidden />WhatsApp</button></div>
            <p className="row gap-1 text-sm soft" style={{ marginTop: 4 }}><MapPin aria-hidden style={{ width: 14, flex: 'none' }} />{d.deliveryAddress}</p>
            {(d.contactMobile || d.customerMobile) && <p className="row gap-1 text-sm soft"><Phone aria-hidden style={{ width: 14 }} /><a href={`tel:${d.contactMobile || d.customerMobile}`}>{d.contactMobile || d.customerMobile}</a></p>}
          </div>
          <KV items={[
            ['Against', <DocNo to={d.invoiceId ? `/sales/invoices/${d.invoiceId}` : d.salesOrderId ? `/sales/orders/${d.salesOrderId}` : d.customOrderId ? `/custom-orders/${d.customOrderId}` : undefined}>{d.sourceNumber}</DocNo>],
            ['Scheduled', d.scheduledDate ? `${date(d.scheduledDate)}${d.timeSlot ? ` · ${d.timeSlot}` : ''}` : 'Not yet'],
            ['Driver', d.driverName ?? '—'], ['Vehicle', d.vehicleNo ?? '—'], !!d.route && ['Route', `${d.route}${d.routeOrder ? ` · stop ${d.routeOrder}` : ''}`],
            !!d.priority && d.priority !== 'NORMAL' && ['Priority', <Badge tone={PRIORITY_TONE[d.priority]}>{d.priority.toLowerCase()}</Badge>],
            ['Delivery charge', money(d.deliveryCharge)],
            d.deliveryCost != null && ['Trip cost', money(d.deliveryCost)],
            d.hasOtp && ['OTP', d.otpVerified ? 'Verified' : 'Sent to customer'],
          ]} />
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Items</div>
            <ul className="list-plain stack gap-1">{d.items.map(i => <li key={i.id} className="row between text-sm"><span>{i.description}</span><span className="num">× {qty(i.quantity)}</span></li>)}</ul>
          </div>
          {d.status === 'DELIVERED' && (
            <div className="stack gap-3">
              <div className="caps">Proof of delivery</div>
              <p className="text-sm">Received by <b>{d.receiverName}</b> · {dateTime(d.deliveredAt)}{d.otpVerified ? ' · OTP verified' : ''}</p>
              {d.remarks && <p className="text-sm soft">{d.remarks}</p>}
              <div className="row gap-3 wrap">
                {d.signatureAttachmentId && <a href={`/api/attachments/${d.signatureAttachmentId}`} target="_blank" rel="noreferrer" className="ref-image" style={{ width: 180, aspectRatio: '2/1', background: '#fff' }}><img src={`/api/attachments/${d.signatureAttachmentId}`} alt="Customer signature" style={{ objectFit: 'contain' }} /></a>}
                {d.photoAttachmentId && <a href={`/api/attachments/${d.photoAttachmentId}`} target="_blank" rel="noreferrer" className="ref-image" style={{ width: 180 }}><img src={`/api/attachments/${d.photoAttachmentId}`} alt="Delivery photo" /></a>}
              </div>
            </div>
          )}
          {data.history.length > 0 && <div><div className="caps" style={{ marginBottom: 8 }}>History</div>
            <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: label(h.toStatus), detail: h.note, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}`, tone: h.toStatus === 'FAILED' || h.toStatus === 'CANCELLED' ? 'bad' as const : 'ok' as const }))} /></div>}
          {d.customOrderId && <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); nav(`/custom-orders/${d.customOrderId}`); }}>Open custom order {d.customOrderNumber}</button>}
        </div>
      )}
      {d && <ScheduleModal open={schedule} onClose={() => setSchedule(false)} delivery={d} onDone={otp => { refresh(); if (otp) setWa({ open: true, otp }); }} />}
      {d && <CompleteModal open={complete} onClose={() => setComplete(false)} delivery={d} onDone={refresh} />}
      {d && <WhatsAppDialog open={wa.open} onClose={() => setWa({ open: false })} url={`/api/deliveries/${d.id}/whatsapp${wa.otp ? `?otp=${wa.otp}` : ''}`} />}
    </Drawer>
  );
}

function ScheduleModal({ open, onClose, delivery, onDone }: { open: boolean; onClose: () => void; delivery: Delivery; onDone: (otp?: string) => void }) {
  const toast = useToast();
  const me = useMe();
  const { data: lookups } = useLookups();
  const drivers = (lookups?.staff ?? []).filter(s => s.roleCode === 'DELIVERY' || s.roleCode === 'MANAGER' || s.roleCode === 'ADMIN');
  const [f, setF] = useState({ date: isoInput(delivery.scheduledDate) || iso(), timeSlot: delivery.timeSlot ?? SLOTS[0], driverUserId: delivery.driverUserId ? String(delivery.driverUserId) : '', driverName: delivery.driverName ?? '', vehicleNo: delivery.vehicleNo ?? '', deliveryCost: delivery.deliveryCost ?? null as number | null,
    priority: delivery.priority ?? 'NORMAL', route: delivery.route ?? '', routeOrder: delivery.routeOrder ?? null as number | null });
  const [otp, setOtp] = useState<string | null>(null);
  const go = useMutation({
    mutationFn: () => {
      const staff = drivers.find(s => String(s.id) === f.driverUserId);
      return api.post<{ otp?: string }>(`/api/deliveries/${delivery.id}/schedule`, { date: f.date, timeSlot: f.timeSlot, driverUserId: staff?.id ?? null, driverName: staff?.fullName ?? (f.driverName || null), vehicleNo: f.vehicleNo || null, deliveryCost: f.deliveryCost,
        priority: f.priority, route: f.route || null, routeOrder: f.routeOrder });
    },
    onSuccess: r => { toast.success('Delivery scheduled'); if (r.otp) setOtp(r.otp); else { onDone(); onClose(); } },
    onError: e => toast.error('Not scheduled', errorMessage(e)),
  });
  const finish = (send: boolean) => { onDone(send ? otp ?? undefined : undefined); setOtp(null); onClose(); };
  if (otp) return (
    <Modal open={open} onClose={() => finish(false)} title="Delivery OTP" width={420}
      footer={<><button className="btn" onClick={() => finish(false)}>Done</button><button className="btn btn-primary" onClick={() => finish(true)}><MessageCircle aria-hidden />Send to customer</button></>}>
      <div className="stack gap-3" style={{ textAlign: 'center' }}>
        <p>Share this code with the customer. The driver asks for it at handover.</p>
        <div className="mono" style={{ fontSize: 40, letterSpacing: 12, fontWeight: 600 }}>{otp}</div>
        <p className="text-xs muted">It is shown only once and stored encrypted.</p>
      </div>
    </Modal>
  );
  return (
    <Modal open={open} onClose={onClose} title={`Schedule ${delivery.number}`} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Schedule delivery</button></>}>
      <div className="stack gap-4">
        <div className="grid grid-2">
          <TextInput label="Date" type="date" required min={iso()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
          <Select label="Time slot" value={f.timeSlot} onChange={e => setF({ ...f, timeSlot: e.target.value })} options={SLOTS.map(s => ({ value: s, label: s }))} />
        </div>
        <div className="grid grid-2">
          <Select label="Driver" value={f.driverUserId} onChange={e => setF({ ...f, driverUserId: e.target.value })} options={[{ value: '', label: 'Other / outside driver' }, ...drivers.map(s => ({ value: String(s.id), label: s.fullName }))]} />
          {!f.driverUserId ? <TextInput label="Driver name" optional value={f.driverName} onChange={e => setF({ ...f, driverName: e.target.value })} /> : <span />}
        </div>
        <div className="grid grid-3">
          <Select label="Priority" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as NonNullable<Delivery['priority']> })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          <TextInput label="Route / area" optional list="delivery-routes" value={f.route} onChange={e => setF({ ...f, route: e.target.value })} placeholder="Whitefield" />
          <NumberInput label="Stop no." optional value={f.routeOrder} min={1} max={99} onChange={v => setF({ ...f, routeOrder: v })} />
        </div>
        <datalist id="delivery-routes">{['North Bengaluru', 'South Bengaluru', 'East — Whitefield / KR Puram', 'West — Rajajinagar / Vijayanagar', 'Central', 'Outstation'].map(r => <option key={r} value={r} />)}</datalist>
        <div className="grid grid-2">
          <TextInput label="Vehicle no." optional value={f.vehicleNo} onChange={e => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })} placeholder="KA 01 AB 1234" />
          {me.canSeeCost && <NumberInput label="Trip cost" optional money value={f.deliveryCost} onChange={v => setF({ ...f, deliveryCost: v })} hint="Internal — not billed" />}
        </div>
      </div>
    </Modal>
  );
}

function CompleteModal({ open, onClose, delivery, onDone }: { open: boolean; onClose: () => void; delivery: Delivery; onDone: () => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const requireOtp = lookups?.defaults.requireOtp ?? false;
  const [receiver, setReceiver] = useState('');
  const [otp, setOtp] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sig = useRef<SignaturePadHandle>(null);
  const go = useMutation({
    mutationFn: () => api.post(`/api/deliveries/${delivery.id}/complete`, {
      receiverName: receiver, otp: otp || null, signatureDataUrl: sig.current?.dataUrl() ?? null, photoDataUrl: photo?.url ?? null, photoFileName: photo?.name ?? null, remarks: remarks || null,
    }),
    onSuccess: () => { toast.success('Delivered', 'Proof of delivery saved.'); onDone(); onClose(); },
    onError: (e: unknown) => { const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors; if (fe) setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.toLowerCase(), v]))); toast.error('Not saved', errorMessage(e)); },
  });
  const pickPhoto = (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error('Photo too large', 'Use a photo under 8 MB.'); return; }
    const r = new FileReader();
    r.onload = () => setPhoto({ url: String(r.result), name: file.name });
    r.readAsDataURL(file);
  };
  return (
    <Modal open={open} onClose={onClose} title="Proof of delivery" width={560}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending} disabled={!receiver.trim()}>Confirm delivery</button></>}>
      <div className="stack gap-4">
        <div className="grid grid-2">
          <TextInput label="Received by" required autoFocus value={receiver} onChange={e => setReceiver(e.target.value)} error={errors.receivername} placeholder="Name of the person" />
          {delivery.hasOtp && <TextInput label="Customer OTP" required={requireOtp} optional={!requireOtp} inputMode="numeric" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} error={errors.otp} className="mono" />}
        </div>
        <div className="field">
          <span className="field-label">Signature <span className="muted">(optional)</span></span>
          <SignaturePad ref={sig} />
        </div>
        <div className="field">
          <span className="field-label">Photo <span className="muted">(optional)</span></span>
          {photo ? <div className="row gap-3"><img src={photo.url} alt="Delivery" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6 }} /><button className="btn btn-sm" onClick={() => setPhoto(null)}>Remove</button></div>
            : <label className="dropzone row gap-2" style={{ justifyContent: 'center' }}><Camera aria-hidden /><span className="text-sm">Take or choose a photo</span><input type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && pickPhoto(e.target.files[0])} /></label>}
        </div>
        <TextArea label="Remarks" optional rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Condition on arrival, installation notes" />
        {errors.proof && <Notice tone="bad">{errors.proof}</Notice>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ signature pad
export interface SignaturePadHandle { dataUrl: () => string | null; clear: () => void }

export const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const [has, setHas] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f1a14';
    let down = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const start = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); if (!drawn.current) { drawn.current = true; setHas(true); } };
    const end = () => { down = false; };
    c.addEventListener('pointerdown', start); c.addEventListener('pointermove', move); c.addEventListener('pointerup', end); c.addEventListener('pointerleave', end);
    return () => { c.removeEventListener('pointerdown', start); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', end); c.removeEventListener('pointerleave', end); };
  }, []);
  const clear = () => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); drawn.current = false; setHas(false); };
  useImperativeHandle(ref, () => ({ dataUrl: () => (drawn.current ? canvas.current!.toDataURL('image/png') : null), clear }));
  return (
    <div className="sigpad">
      <canvas ref={canvas} aria-label="Signature area — sign with finger or mouse" />
      {!has ? <span className="hint">Ask the customer to sign here</span> : <button type="button" className="btn btn-sm btn-ghost" style={{ position: 'absolute', top: 6, right: 6 }} onClick={clear}>Clear</button>}
    </div>
  );
});
