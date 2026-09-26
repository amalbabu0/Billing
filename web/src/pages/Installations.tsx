import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Camera, CalendarClock, CheckCircle2, Image, Plus, Wrench } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, iso, isoInput, label } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Customer, Installation } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, Status } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, TextArea, TextInput } from '@/components/ui/form';
import { Modal, useConfirm } from '@/components/ui/overlay';
import { CustomerPicker } from '@/components/pickers';

const FLOW = [
  { value: '', label: 'Open' }, { value: 'PENDING', label: 'To schedule' }, { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' },
];

/** Installation jobs: created with deliveries that need fitting (wardrobes, kitchens, beds) or by hand. */
export default function Installations() {
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const list = usePagedList<Installation>('installations', '/api/installations', { filterKeys: ['status'] });
  const { state, update } = list;
  const [schedule, setSchedule] = useState<Installation | null>(null);
  const [complete, setComplete] = useState<Installation | null>(null);
  const [create, setCreate] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['installations'] }); qc.invalidateQueries({ queryKey: ['custom-order'] }); };
  const manage = can(P.InstallationManage);
  const cancel = async (i: Installation) => {
    const reason = await confirm({ title: `Cancel ${i.number}?`, message: 'The job is closed without installation.', confirmText: 'Cancel job', reason: { label: 'Reason' } });
    if (reason === null) return;
    try { await api.post(`/api/installations/${i.id}/cancel`, { reason }); toast.success('Installation cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };
  const open = (s: string) => s !== 'COMPLETED' && s !== 'CANCELLED';
  const cols: Column<Installation>[] = [
    { key: 'n', header: 'Job', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'c', header: 'Customer', mobile: 'sub', render: r => <div className="cell-stack"><Link to={`/customers/${r.customerId}`} className="cell-title" onClick={e => e.stopPropagation()}>{r.customerName}</Link><span className="cell-sub truncate" style={{ maxWidth: 280 }}>{r.address}</span></div>, exportValue: r => r.customerName },
    { key: 'src', header: 'Against', render: r => r.customOrderId ? <DocNo to={`/custom-orders/${r.customOrderId}`}>{r.customOrderNumber}</DocNo> : r.invoiceId ? <DocNo to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNumber}</DocNo> : r.deliveryNumber ?? '—', exportValue: r => r.customOrderNumber ?? r.invoiceNumber ?? r.deliveryNumber },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => r.completedAt ? dateTime(r.completedAt) : r.scheduledDate ? date(r.scheduledDate) : <span className="muted">Not scheduled</span>, exportValue: r => date(r.completedAt ?? r.scheduledDate) },
    { key: 't', header: 'Technician', mobile: 'meta', render: r => r.technicianName ?? '—', exportValue: r => r.technicianName },
    ...(me.canSeeCost ? [{ key: 'cost', header: 'Cost', num: true, optional: true, render: (r: Installation) => <Money value={r.installationCost} />, exportValue: (r: Installation) => r.installationCost } as Column<Installation>] : []),
    { key: 'notes', header: 'Notes', render: r => <div className="cell-stack"><span className="text-sm soft">{r.completionNotes ?? r.notes}</span>
      {(r.customerConfirmedBy || r.completionPhotoId) && <span className="cell-sub row gap-2">{r.customerConfirmedBy && <>Accepted by {r.customerConfirmedBy}</>}
        {r.completionPhotoId && <a href={`/api/attachments/${r.completionPhotoId}`} target="_blank" rel="noreferrer" className="row gap-1" onClick={e => e.stopPropagation()}><Image aria-hidden style={{ width: 13 }} />Photo</a>}</span>}</div>,
      exportValue: r => [r.completionNotes ?? r.notes, r.customerConfirmedBy && `Accepted by ${r.customerConfirmedBy}`].filter(Boolean).join(' · ') },
    { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} />, exportValue: r => label(r.status) },
  ];
  return (
    <div className="page">
      <PageHeader title="Installation" desc="Fitting jobs after delivery: schedule a technician, then close the job with notes. Custom orders complete automatically when their installation does."
        actions={manage && <button className="btn btn-primary" onClick={() => setCreate(true)}><Plus aria-hidden />New job</button>} />
      <DataTable id="installations" label="Installations" columns={cols} rowKey={r => r.id} {...list.tableProps}
        onRowClick={manage ? r => { if (r.status === 'PENDING') setSchedule(r); else if (open(r.status)) setComplete(r); } : undefined}
        rowActions={manage ? r => [
          { label: r.status === 'PENDING' ? 'Schedule' : 'Reschedule / reassign', icon: <CalendarClock />, onClick: () => setSchedule(r), hidden: !open(r.status) },
          { label: 'Mark completed', icon: <CheckCircle2 />, onClick: () => setComplete(r), hidden: !(r.status === 'SCHEDULED' || r.status === 'ASSIGNED') },
          { label: 'Cancel job', icon: <Ban />, danger: true, onClick: () => cancel(r), hidden: !open(r.status) },
        ] : undefined}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Job no., customer or technician" />
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Status" options={FLOW} />
        </>}
        empty={<EmptyState icon={<Wrench />} title="No installation jobs" desc="Jobs appear when a delivery or custom order needs installation." />}
        exportAs={{ title: 'Installations', fetchAll: list.fetchAll }} />
      {schedule && <ScheduleModal job={schedule} onClose={() => setSchedule(null)} onDone={refresh} />}
      {complete && <CompleteModal job={complete} onClose={() => setComplete(null)} onDone={refresh} />}
      {create && <CreateModal onClose={() => setCreate(false)} onDone={refresh} />}
    </div>
  );
}

function ScheduleModal({ job, onClose, onDone }: { job: Installation; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const me = useMe();
  const { data: lookups } = useLookups();
  const staff = lookups?.staff ?? [];
  const [f, setF] = useState({ date: isoInput(job.scheduledDate) || iso(), tech: job.technicianUserId ? String(job.technicianUserId) : '', techName: job.technicianUserId ? '' : job.technicianName ?? '', cost: job.installationCost ?? null as number | null });
  const go = useMutation({
    mutationFn: () => {
      const s = staff.find(x => String(x.id) === f.tech);
      return api.post(`/api/installations/${job.id}/schedule`, { date: f.date, technicianUserId: s?.id ?? null, technicianName: s?.fullName ?? (f.techName || null), cost: f.cost });
    },
    onSuccess: () => { toast.success('Installation scheduled'); onDone(); onClose(); },
    onError: e => toast.error('Not scheduled', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Schedule ${job.number}`} width={500}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <p className="text-sm soft">{job.customerName} · {job.address}</p>
        <div className="grid grid-2">
          <TextInput label="Date" type="date" required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
          <Select label="Technician" value={f.tech} onChange={e => setF({ ...f, tech: e.target.value })} options={[{ value: '', label: 'Outside technician' }, ...staff.map(s => ({ value: String(s.id), label: s.fullName }))]} />
        </div>
        <div className="grid grid-2">
          {!f.tech ? <TextInput label="Technician name" optional value={f.techName} onChange={e => setF({ ...f, techName: e.target.value })} hint="Leave empty to only fix the date" /> : <span />}
          {me.canSeeCost && <NumberInput label="Job cost" optional money value={f.cost} onChange={v => setF({ ...f, cost: v })} hint="Internal — not billed" />}
        </div>
      </div>
    </Modal>
  );
}

function CompleteModal({ job, onClose, onDone }: { job: Installation; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [confirmedBy, setConfirmedBy] = useState(job.customerName ?? '');
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const go = useMutation({
    mutationFn: () => api.post(`/api/installations/${job.id}/complete`, { notes: notes || null, confirmedBy: confirmedBy.trim() || null, photoDataUrl: photo?.url ?? null, photoFileName: photo?.name ?? null }),
    onSuccess: () => { toast.success('Installation completed'); onDone(); onClose(); },
    onError: e => toast.error('Not completed', errorMessage(e)),
  });
  const pickPhoto = (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error('Photo too large', 'Use a photo under 8 MB.'); return; }
    const r = new FileReader();
    r.onload = () => setPhoto({ url: String(r.result), name: file.name });
    r.readAsDataURL(file);
  };
  return (
    <Modal open onClose={onClose} title={`Complete ${job.number}`} width={500}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Mark completed</button></>}>
      <div className="stack gap-4">
        <p className="text-sm soft">{job.customerName} · {job.technicianName ?? 'No technician'} · {date(job.scheduledDate)}</p>
        <TextArea label="Completion notes" optional rows={3} autoFocus value={notes} onChange={e => setNotes(e.target.value)} placeholder="Fitted and levelled; customer checked all doors" />
        <TextInput label="Checked and accepted by" optional value={confirmedBy} onChange={e => setConfirmedBy(e.target.value)} hint="Name of the person at site who confirmed the work" />
        <div className="field">
          <span className="field-label">Photo of the finished work<span className="opt">optional</span></span>
          {photo ? <div className="row gap-3"><img src={photo.url} alt="Finished installation" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6 }} /><button className="btn btn-sm" onClick={() => setPhoto(null)}>Remove</button></div>
            : <label className="dropzone row gap-2" style={{ justifyContent: 'center' }}><Camera aria-hidden /><span className="text-sm">Take or choose a photo</span><input type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && pickPhoto(e.target.files[0])} /></label>}
        </div>
      </div>
    </Modal>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const go = useMutation({
    mutationFn: () => api.post('/api/installations', { customerId: customer?.id ?? 0, address, notes: notes || null }),
    onSuccess: () => { toast.success('Installation job created'); onDone(); onClose(); },
    onError: e => toast.error('Not created', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="New installation job" width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!customer || !address.trim()} onClick={() => go.mutate()} aria-busy={go.isPending}>Create job</button></>}>
      <div className="stack gap-4">
        <CustomerPicker value={customer} onChange={c => { setCustomer(c); if (c && !address) setAddress([c.billingAddress, c.city].filter(Boolean).join(', ')); }} autoFocus />
        <TextArea label="Address" required rows={2} value={address} onChange={e => setAddress(e.target.value)} />
        <TextArea label="What needs installing" optional rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Wall-mounted TV unit, drill 6 holes" />
      </div>
    </Modal>
  );
}
