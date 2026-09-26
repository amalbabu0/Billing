import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, CalendarClock, CheckCircle2, LifeBuoy, MessageCircle, Pencil, Plus, ShieldCheck, Wrench } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, iso, label, money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import { PRIORITY_TONE, SERVICE_FLOW, SERVICE_LABELS, WARRANTY_LABELS, WARRANTY_TONE } from '@/lib/status';
import type { Customer, Paged, ServiceTicket, StatusHistory, WarrantyRecord } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, DocNo, EmptyState, ErrorPanel, KV, Notice, PageHeader, Segmented, SkeletonRows, Status, Timeline, Tracker } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, Modal, useConfirm } from '@/components/ui/overlay';
import { CustomerPicker } from '@/components/pickers';
import { WhatsAppDialog } from '@/components/DocActions';

const useOpenParam = () => {
  const [params, setParams] = useSearchParams();
  const open = params.get('open') ? Number(params.get('open')) : null;
  const setOpen = (id: number | null) => { const n = new URLSearchParams(params); if (id) n.set('open', String(id)); else n.delete('open'); setParams(n, { replace: !id }); };
  return [open, setOpen, params, setParams] as const;
};

// ============================================================ service tickets
export function ServiceTickets() {
  const can = useCan();
  const [open, setOpen, params, setParams] = useOpenParam();
  const list = usePagedList<ServiceTicket>('service', '/api/service', { filterKeys: ['status'], defaults: { filters: { status: 'OPEN' } } });
  const { state, update } = list;
  const [create, setCreate] = useState<{ customerId?: number; warrantyId?: number } | null>(null);
  useEffect(() => {
    const w = params.get('warranty'), c = params.get('customer');
    if (w || c || params.get('new')) { setCreate({ warrantyId: w ? Number(w) : undefined, customerId: c ? Number(c) : undefined }); ['warranty', 'customer', 'new'].forEach(k => params.delete(k)); setParams(params, { replace: true }); }
  }, [params, setParams]);
  const cols: Column<ServiceTicket>[] = [
    { key: 'n', header: 'Ticket', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'c', header: 'Customer', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.customerName}</span><span className="cell-sub">{r.productName}{r.serialNo ? ` · ${r.serialNo}` : ''}</span></div>, exportValue: r => r.customerName },
    { key: 'i', header: 'Issue', render: r => <span className="text-sm soft truncate" style={{ display: 'block', maxWidth: 280 }}>{r.issue}</span>, exportValue: r => r.issue },
    { key: 'w', header: 'Cover', render: r => r.underWarranty ? <Badge tone="ok" icon={<ShieldCheck />}>Warranty</Badge> : <Badge>Chargeable</Badge>, exportValue: r => (r.underWarranty ? 'Warranty' : 'Chargeable') },
    { key: 't', header: 'Technician', mobile: 'meta', render: r => r.technicianName ? `${r.technicianName}${r.visitDate ? ` · ${date(r.visitDate)}` : ''}` : <span className="muted">Not assigned</span>, exportValue: r => r.technicianName },
    { key: 'p', header: 'Priority', optional: true, render: r => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.toLowerCase()}</Badge>, exportValue: r => r.priority },
    { key: 'd', header: 'Opened', optional: true, render: r => date(r.createdAt), exportValue: r => date(r.createdAt) },
    { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} text={SERVICE_LABELS[r.status]} />, exportValue: r => SERVICE_LABELS[r.status] },
  ];
  return (
    <div className="page">
      <PageHeader title="Service tickets" desc="Repairs and complaints after the sale. Warranty jobs are free; chargeable repairs are billed on a GST service invoice when completed."
        actions={can(P.ServiceManage) && <button className="btn btn-primary" onClick={() => setCreate({})}><Plus aria-hidden />New ticket</button>} />
      <DataTable id="service" label="Service tickets" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => setOpen(r.id)}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Ticket, customer, mobile, product or serial" />
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Status"
            options={[{ value: 'OPEN', label: 'Open' }, { value: 'NEW', label: 'New' }, { value: 'ASSIGNED', label: 'Assigned' }, { value: 'REPAIR', label: 'In repair' }, { value: 'COMPLETED', label: 'Completed' }, { value: '', label: 'All' }]} />
        </>}
        empty={<EmptyState icon={<LifeBuoy />} title="No service tickets" desc="Log a complaint from here or from a customer’s warranty." />}
        exportAs={{ title: 'Service tickets', fetchAll: list.fetchAll }} />
      <TicketDrawer id={open} onClose={() => setOpen(null)} />
      {create && <TicketModal initial={create} onClose={() => setCreate(null)} onSaved={id => { setCreate(null); setOpen(id); }} />}
    </div>
  );
}

function TicketDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['service-ticket', id], queryFn: () => api.get<{ ticket: ServiceTicket; history: StatusHistory[] }>(`/api/service/${id}`), enabled: !!id });
  const [assign, setAssign] = useState(false);
  const [complete, setComplete] = useState(false);
  const [edit, setEdit] = useState(false);
  const [wa, setWa] = useState(false);
  const refresh = () => ['service', 'service-ticket', 'warranties', 'invoices'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const move = useMutation({ mutationFn: (status: string) => api.post(`/api/service/${id}/move`, { status }), onSuccess: (_, s) => { toast.success(SERVICE_LABELS[s]); refresh(); }, onError: e => toast.error('Not updated', errorMessage(e)) });
  const t = data?.ticket;
  const closed = t && ['COMPLETED', 'CANCELLED'].includes(t.status);
  const manage = can(P.ServiceManage);
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${t!.number}?`, message: 'The ticket is closed without a repair.', confirmText: 'Cancel ticket', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/service/${t!.id}/cancel`, { reason }); toast.success('Ticket cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };
  const next = t?.status === 'ASSIGNED' ? 'VISIT' : t?.status === 'VISIT' ? 'REPAIR' : t?.status === 'REPAIR' ? 'QC' : null;
  return (
    <Drawer open={!!id} onClose={onClose} wide title={t?.number ?? 'Service ticket'} sub={t && <Status value={t.status} text={SERVICE_LABELS[t.status]} />}
      footer={t && !closed && manage && <>
        <button className="btn btn-ghost" onClick={cancel}><Ban aria-hidden />Cancel</button>
        <button className="btn btn-ghost" onClick={() => setEdit(true)}><Pencil aria-hidden />Edit</button>
        <span className="grow" />
        <button className="btn" onClick={() => setAssign(true)}><CalendarClock aria-hidden />{t.technicianName ? 'Reassign' : 'Assign technician'}</button>
        {next && <button className="btn" onClick={() => move.mutate(next)} aria-busy={move.isPending}><ArrowRight aria-hidden />{SERVICE_LABELS[next]}</button>}
        {t.technicianName && <button className="btn btn-primary" onClick={() => setComplete(true)}><CheckCircle2 aria-hidden />Complete</button>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !t ? <SkeletonRows rows={6} cols={2} /> : (
        <div className="stack gap-5">
          {t.status !== 'CANCELLED' && <Tracker steps={SERVICE_FLOW.map(k => ({ key: k, label: SERVICE_LABELS[k] }))} current={t.status} />}
          {t.status === 'CANCELLED' && <Notice tone="bad">Cancelled — {t.cancelReason}</Notice>}
          <div className="row between wrap gap-3">
            <div><Link to={`/customers/${t.customerId}`} className="medium" onClick={onClose}>{t.customerName}</Link><div className="text-sm soft">{t.customerMobile}{t.address ? ` · ${t.address}` : ''}</div></div>
            <button className="btn btn-sm btn-ghost" onClick={() => setWa(true)}><MessageCircle aria-hidden />Send update</button>
          </div>
          {t.underWarranty ? <Notice tone="ok" icon={<ShieldCheck />}>Covered by warranty {t.warrantyNumber}{t.warrantyEnd ? ` (until ${date(t.warrantyEnd)})` : ''} — no charge.</Notice>
            : <Notice tone="info">Not under warranty — any charge is billed on completion.</Notice>}
          <KV items={[['Product', t.productName], !!t.serialNo && ['Serial no.', <span className="mono">{t.serialNo}</span>], ['Issue', t.issue], ['Priority', <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority.toLowerCase()}</Badge>],
            ['Technician', t.technicianName ?? '—'], !!t.visitDate && ['Visit', date(t.visitDate)], !!t.invoiceNumber && ['Original invoice', <DocNo to={`/sales/invoices/${t.invoiceId}`}>{t.invoiceNumber}</DocNo>],
            !!t.resolution && ['Resolution', t.resolution], !!t.partsUsed && ['Parts used', t.partsUsed],
            t.serviceCharge > 0 && ['Charge', <>{money(t.serviceCharge)}{t.serviceInvoiceNumber && <> · <DocNo to={`/sales/invoices/${t.serviceInvoiceId}`}>{t.serviceInvoiceNumber}</DocNo></>}</>]]} />
          {data.history.length > 0 && <div><div className="caps" style={{ marginBottom: 8 }}>History</div>
            <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: SERVICE_LABELS[h.toStatus] ?? label(h.toStatus), detail: h.note, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}`, tone: h.toStatus === 'CANCELLED' ? 'bad' as const : 'ok' as const }))} /></div>}
        </div>
      )}
      {t && assign && <AssignModal ticket={t} onClose={() => setAssign(false)} onDone={refresh} />}
      {t && complete && <CompleteModal ticket={t} onClose={() => setComplete(false)} onDone={refresh} />}
      {t && edit && <TicketModal initial={{ ticket: t }} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); }} />}
      {t && <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/service/${t.id}/whatsapp`} />}
    </Drawer>
  );
}

function AssignModal({ ticket, onClose, onDone }: { ticket: ServiceTicket; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [f, setF] = useState({ visitDate: ticket.visitDate?.slice(0, 10) ?? iso(), tech: ticket.technicianUserId ? String(ticket.technicianUserId) : '', name: ticket.technicianUserId ? '' : ticket.technicianName ?? '' });
  const go = useMutation({
    mutationFn: () => api.post(`/api/service/${ticket.id}/assign`, { visitDate: f.visitDate, technicianUserId: f.tech ? Number(f.tech) : null, technicianName: f.tech ? null : f.name }),
    onSuccess: () => { toast.success('Technician assigned'); onDone(); onClose(); },
    onError: e => toast.error('Not assigned', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Assign ${ticket.number}`} width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.tech && !f.name.trim()} onClick={() => go.mutate()} aria-busy={go.isPending}>Assign</button></>}>
      <div className="stack gap-4">
        <Select label="Technician" value={f.tech} onChange={e => setF({ ...f, tech: e.target.value })} options={[{ value: '', label: 'Outside technician' }, ...(lookups?.staff ?? []).map(s => ({ value: String(s.id), label: s.fullName }))]} />
        {!f.tech && <TextInput label="Technician name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}
        <TextInput label="Visit date" type="date" value={f.visitDate} onChange={e => setF({ ...f, visitDate: e.target.value })} />
      </div>
    </Modal>
  );
}

function CompleteModal({ ticket, onClose, onDone }: { ticket: ServiceTicket; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [resolution, setResolution] = useState('');
  const [parts, setParts] = useState('');
  const [charge, setCharge] = useState<number | null>(0);
  const [paid, setPaid] = useState<number | null>(0);
  const [method, setMethod] = useState('CASH');
  const go = useMutation({
    mutationFn: () => api.post<{ bill?: { invoiceNumber?: string } | null }>(`/api/service/${ticket.id}/complete`, { resolution, partsUsed: parts || null, serviceCharge: ticket.underWarranty ? 0 : charge ?? 0, payments: paid ? [{ methodCode: method, amount: paid }] : [] }),
    onSuccess: r => { toast.success('Service completed', r.bill?.invoiceNumber ? `Billed on ${r.bill.invoiceNumber}.` : undefined); onDone(); onClose(); },
    onError: e => toast.error('Not completed', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Complete ${ticket.number}`} width={540}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!resolution.trim()} onClick={() => go.mutate()} aria-busy={go.isPending}>Complete</button></>}>
      <div className="stack gap-4">
        <TextArea label="What was done" required rows={3} autoFocus value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Replaced hydraulic gas lift, tightened frame" />
        <TextInput label="Parts used" optional value={parts} onChange={e => setParts(e.target.value)} placeholder="2 × gas lift 1000N" />
        {ticket.underWarranty ? <Notice tone="ok">Under warranty — no charge.</Notice> : <>
          <div className="grid grid-3">
            <NumberInput label="Service charge" money value={charge} onChange={setCharge} hint="Including GST" />
            {(charge ?? 0) > 0 && <NumberInput label="Collected now" money value={paid} max={charge ?? 0} onChange={setPaid} />}
            {(paid ?? 0) > 0 && <Select label="Method" value={method} onChange={e => setMethod(e.target.value)} options={(lookups?.paymentMethods ?? []).filter(m => m.isMoney && m.isActive).map(m => ({ value: m.code, label: m.name }))} />}
          </div>
          {(charge ?? 0) > 0 && <p className="text-xs muted">A GST service invoice (SAC 998719) is created for {money(charge)}{(paid ?? 0) < (charge ?? 0) ? `; ${money((charge ?? 0) - (paid ?? 0))} stays due on the customer’s account` : ''}.</p>}
        </>}
      </div>
    </Modal>
  );
}

function TicketModal({ initial, onClose, onSaved }: { initial: { customerId?: number; warrantyId?: number; ticket?: ServiceTicket }; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const t = initial.ticket;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [warrantyId, setWarrantyId] = useState<number | ''>(t?.warrantyId ?? initial.warrantyId ?? '');
  const [f, setF] = useState({ productName: t?.productName ?? '', serialNo: t?.serialNo ?? '', issue: t?.issue ?? '', address: t?.address ?? '', priority: t?.priority ?? 'NORMAL' });
  const customerId = customer?.id ?? t?.customerId ?? initial.customerId;
  useEffect(() => { if (initial.customerId && !customer) api.get<Customer>(`/api/customers/${initial.customerId}`).then(setCustomer).catch(() => {}); }, [initial.customerId, customer]);
  const pre = useQuery({ queryKey: ['warranty', initial.warrantyId], queryFn: () => api.get<WarrantyRecord>(`/api/warranties/${initial.warrantyId}`), enabled: !!initial.warrantyId && !t });
  useEffect(() => { const w = pre.data; if (w) { api.get<Customer>(`/api/customers/${w.customerId}`).then(setCustomer).catch(() => {}); setF(x => ({ ...x, productName: w.productName, serialNo: w.serialNo ?? '' })); } }, [pre.data]);
  const warranties = useQuery({ queryKey: ['warranties', 'customer', customerId], queryFn: () => api.get<Paged<WarrantyRecord>>('/api/warranties', { customerId, pageSize: 50 }), enabled: !!customerId });
  const go = useMutation({
    mutationFn: () => {
      const body = { customerId, warrantyId: warrantyId || null, ...f, serialNo: f.serialNo || null, address: f.address || null };
      return t ? api.put<{ id: number }>(`/api/service/${t.id}`, body) : api.post<{ id: number }>('/api/service', body);
    },
    onSuccess: r => { toast.success(t ? 'Ticket saved' : 'Service ticket created'); onSaved(r.id); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const pickWarranty = (id: number | '') => {
    setWarrantyId(id);
    const w = warranties.data?.items.find(x => x.id === id);
    if (w) setF(x => ({ ...x, productName: w.productName, serialNo: w.serialNo ?? x.serialNo }));
  };
  const chosen = warranties.data?.items.find(x => x.id === warrantyId);
  return (
    <Modal open onClose={onClose} title={t ? `Edit ${t.number}` : 'New service ticket'} width={620}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!customerId || !f.productName.trim() || !f.issue.trim()} onClick={() => go.mutate()} aria-busy={go.isPending}>Save ticket</button></>}>
      <div className="stack gap-4">
        {!t && <CustomerPicker value={customer} onChange={c => { setCustomer(c); setWarrantyId(''); }} autoFocus={!initial.customerId && !initial.warrantyId} />}
        {customerId && <Select label="Warranty" optional value={warrantyId} onChange={e => pickWarranty(e.target.value ? Number(e.target.value) : '')}
          options={[{ value: '', label: warranties.data?.items.length ? 'No warranty / not listed' : 'No warranties on record' }, ...(warranties.data?.items ?? []).filter(w => !w.isVoid).map(w => ({ value: w.id, label: `${w.number} · ${w.productName} · ${WARRANTY_LABELS[w.state]} until ${date(w.endDate)}` }))]} />}
        {chosen && <Notice tone={chosen.state === 'ACTIVE' || chosen.state === 'EXPIRING' ? 'ok' : 'warn'}>{chosen.state === 'EXPIRED' ? `Warranty expired on ${date(chosen.endDate)} — the repair will be chargeable.` : `Under warranty until ${date(chosen.endDate)}.`}</Notice>}
        <div className="grid grid-2">
          <TextInput label="Product" required value={f.productName} onChange={e => setF({ ...f, productName: e.target.value })} />
          <TextInput label="Serial no." optional className="mono" value={f.serialNo} onChange={e => setF({ ...f, serialNo: e.target.value })} />
        </div>
        <TextArea label="Problem" required rows={3} value={f.issue} onChange={e => setF({ ...f, issue: e.target.value })} placeholder="Door hinge broken, drawer channel jammed…" />
        <div className="grid grid-2">
          <Select label="Priority" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as ServiceTicket['priority'] })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          <TextInput label="Visit address" optional value={f.address} onChange={e => setF({ ...f, address: e.target.value })} placeholder={customer?.billingAddress ?? 'Customer address'} />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ warranties
export function Warranties() {
  const can = useCan();
  const [open, setOpen] = useOpenParam();
  const list = usePagedList<WarrantyRecord>('warranties', '/api/warranties', { filterKeys: ['status'] });
  const { state, update } = list;
  const [register, setRegister] = useState(false);
  const cols: Column<WarrantyRecord>[] = [
    { key: 'n', header: 'Warranty', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'p', header: 'Product', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span>{r.serialNo && <span className="cell-sub mono">{r.serialNo}</span>}</div>, exportValue: r => r.productName },
    { key: 'c', header: 'Customer', mobile: 'meta', render: r => r.customerName, exportValue: r => r.customerName },
    { key: 'inv', header: 'Invoice', optional: true, render: r => r.invoiceNumber ?? r.customOrderNumber ?? '—', exportValue: r => r.invoiceNumber },
    { key: 'from', header: 'From', optional: true, render: r => date(r.startDate), exportValue: r => date(r.startDate) },
    { key: 'to', header: 'Valid until', mobile: 'meta', render: r => <span className={r.state === 'EXPIRING' ? 't-warn' : ''}>{date(r.endDate)}{r.state === 'EXPIRING' ? ` · ${r.daysLeft} days` : ''}</span>, exportValue: r => date(r.endDate) },
    { key: 'st', header: 'Tickets', num: true, optional: true, render: r => r.serviceTickets || '—', exportValue: r => r.serviceTickets },
    { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.state} tone={WARRANTY_TONE[r.state]} text={WARRANTY_LABELS[r.state]} />, exportValue: r => WARRANTY_LABELS[r.state] },
  ];
  return (
    <div className="page">
      <PageHeader title="Warranties" desc="Registered automatically for every product sold with a warranty period. Add serial numbers here, remind customers before expiry, and raise service tickets."
        actions={can(P.ServiceManage) && <button className="btn btn-primary" onClick={() => setRegister(true)}><Plus aria-hidden />Register warranty</button>} />
      <DataTable id="warranties" label="Warranties" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => setOpen(r.id)}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Warranty, product, serial, customer or invoice" />
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Status"
            options={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'EXPIRING', label: 'Expiring in 30 days' }, { value: 'EXPIRED', label: 'Expired' }]} />
        </>}
        empty={<EmptyState icon={<ShieldCheck />} title="No warranties" desc="Give products a warranty period (months) and every sale registers one." />}
        exportAs={{ title: 'Warranties', fetchAll: list.fetchAll }} />
      <WarrantyDrawer id={open} onClose={() => setOpen(null)} />
      {register && <RegisterModal onClose={() => setRegister(false)} onDone={id => { setRegister(false); setOpen(id); }} />}
    </div>
  );
}

function WarrantyDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: w, error, refetch } = useQuery({ queryKey: ['warranty', id], queryFn: () => api.get<WarrantyRecord>(`/api/warranties/${id}`), enabled: !!id });
  const [serial, setSerial] = useState('');
  const [terms, setTerms] = useState('');
  const [wa, setWa] = useState(false);
  useEffect(() => { if (w) { setSerial(w.serialNo ?? ''); setTerms(w.terms ?? ''); } }, [w]);
  const save = useMutation({ mutationFn: () => api.put(`/api/warranties/${id}`, { serialNo: serial, terms }), onSuccess: () => { toast.success('Warranty updated'); qc.invalidateQueries({ queryKey: ['warranties'] }); qc.invalidateQueries({ queryKey: ['warranty'] }); }, onError: e => toast.error('Not saved', errorMessage(e)) });
  const voidIt = async () => {
    const reason = await confirm({ title: `Void ${w!.number}?`, message: 'The customer will no longer be covered.', confirmText: 'Void warranty', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/warranties/${w!.id}/void`, { reason }); toast.success('Warranty voided'); qc.invalidateQueries({ queryKey: ['warranties'] }); qc.invalidateQueries({ queryKey: ['warranty'] }); } catch (e) { toast.error('Not voided', errorMessage(e)); }
  };
  const manage = can(P.ServiceManage);
  return (
    <Drawer open={!!id} onClose={onClose} title={w?.number ?? 'Warranty'} sub={w && <Status value={w.state} tone={WARRANTY_TONE[w.state]} text={WARRANTY_LABELS[w.state]} />}
      footer={w && !w.isVoid && <>
        {manage && <button className="btn btn-ghost" onClick={voidIt}><Ban aria-hidden />Void</button>}
        <span className="grow" />
        <button className="btn" onClick={() => setWa(true)}><MessageCircle aria-hidden />Reminder</button>
        {can(P.ServiceManage) && <Link className="btn btn-primary" to={`/service/tickets?warranty=${w.id}`} onClick={onClose}><Wrench aria-hidden />Service ticket</Link>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !w ? <SkeletonRows rows={5} cols={2} /> : (
        <div className="stack gap-5">
          <div className="medium" style={{ fontSize: 17 }}>{w.productName}</div>
          {w.isVoid && <Notice tone="bad">Void — {w.voidReason}</Notice>}
          <KV items={[['Customer', <Link to={`/customers/${w.customerId}`} onClick={onClose}>{w.customerName}</Link>], ['Mobile', w.customerMobile ?? '—'],
            ['Covered', `${date(w.startDate)} – ${date(w.endDate)}`], !w.isVoid && ['Days left', w.daysLeft >= 0 ? w.daysLeft : 'Expired'],
            !!w.invoiceNumber && ['Invoice', <DocNo to={`/sales/invoices/${w.invoiceId}`}>{w.invoiceNumber}</DocNo>], !!w.customOrderNumber && ['Custom order', <DocNo to={`/custom-orders/${w.customOrderId}`}>{w.customOrderNumber}</DocNo>],
            ['Service tickets', w.serviceTickets ? <Link to={`/service/tickets?q=${w.number}`}>{w.serviceTickets}</Link> : 'None']]} />
          <div className="stack gap-3">
            <TextInput label="Serial no." optional className="mono" value={serial} disabled={!manage || w.isVoid} onChange={e => setSerial(e.target.value)} hint="From the product label — helps identify the piece at service time" />
            <TextArea label="Terms" optional rows={3} value={terms} disabled={!manage || w.isVoid} onChange={e => setTerms(e.target.value)} />
            {manage && !w.isVoid && <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={serial === (w.serialNo ?? '') && terms === (w.terms ?? '')} onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button>}
          </div>
        </div>
      )}
      {w && <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/warranties/${w.id}/whatsapp`} />}
    </Drawer>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [f, setF] = useState({ productName: '', serialNo: '', startDate: iso(), months: 12 as number | null, terms: '' });
  const go = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/warranties', { customerId: customer?.id, ...f, serialNo: f.serialNo || null, terms: f.terms || null }),
    onSuccess: r => { toast.success('Warranty registered'); onDone(r.id); },
    onError: e => toast.error('Not registered', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Register warranty" width={560}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!customer || !f.productName.trim() || !f.months} onClick={() => go.mutate()} aria-busy={go.isPending}>Register</button></>}>
      <div className="stack gap-4">
        <p className="text-sm soft">For custom furniture or items sold before warranties were tracked. Sales of products with a warranty period register automatically.</p>
        <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
        <div className="grid grid-2">
          <TextInput label="Product" required value={f.productName} onChange={e => setF({ ...f, productName: e.target.value })} placeholder="Custom wardrobe CO-2026-0002" />
          <TextInput label="Serial no." optional className="mono" value={f.serialNo} onChange={e => setF({ ...f, serialNo: e.target.value })} />
        </div>
        <div className="grid grid-2">
          <TextInput label="Starts" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
          <NumberInput label="Months" value={f.months} min={1} max={360} onChange={v => setF({ ...f, months: v })} />
        </div>
        <TextArea label="Terms" optional rows={2} value={f.terms} onChange={e => setF({ ...f, terms: e.target.value })} placeholder="Covers manufacturing defects; excludes water damage and misuse" />
      </div>
    </Modal>
  );
}
