import { useEffect, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BellRing, CalendarClock, Check, FileText, KanbanSquare, List, MessageSquare, Pencil, Phone, Plus, Target, UserCheck, XCircle } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { compactMoney, date, dateTime, daysFromToday, iso, label, money, relative } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import { LEAD_FLOW, LEAD_LABELS } from '@/lib/status';
import type { FollowUp, Lead, StatusHistory } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, EmptyState, ErrorPanel, KV, Notice, PageHeader, Segmented, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, Menu, Modal, useConfirm } from '@/components/ui/overlay';

const SOURCES = ['Walk-in', 'Phone call', 'WhatsApp', 'Instagram', 'Facebook', 'Google', 'Referral', 'Exhibition', 'Interior designer', 'Repeat customer'];
const REF_ROUTE: Record<string, (id: number) => string> = {
  LEAD: id => `/crm/leads?open=${id}`, QUOTATION: id => `/sales/quotations/${id}`, INVOICE: id => `/sales/invoices/${id}`, SALES_ORDER: id => `/sales/orders/${id}`,
  CUSTOM_ORDER: id => `/custom-orders/${id}`, SERVICE: id => `/service/tickets?open=${id}`, CUSTOMER: id => `/customers/${id}`,
};

// ============================================================ leads
export function Leads() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const open = params.get('open') ? Number(params.get('open')) : null;
  const setOpen = (id: number | null) => { const n = new URLSearchParams(params); if (id) n.set('open', String(id)); else n.delete('open'); setParams(n, { replace: !id }); };
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [edit, setEdit] = useState<Partial<Lead> | null>(null);
  return (
    <div className="page">
      <PageHeader title="Leads" desc="Enquiries before they buy. Move each lead along the pipeline, log follow-ups, and convert it to a customer when a quotation or order is made."
        actions={<>
          <Segmented value={mode} onChange={setMode} label="Layout" options={[{ value: 'board', label: 'Pipeline', icon: <KanbanSquare /> }, { value: 'list', label: 'List', icon: <List /> }]} />
          {can(P.LeadManage) && <button className="btn btn-primary" onClick={() => setEdit({ source: 'Walk-in', expectedValue: 0, nextFollowUp: iso(new Date(Date.now() + 86400000)) })}><Plus aria-hidden />New lead</button>}
        </>} />
      {mode === 'board' ? <Pipeline onOpen={setOpen} /> : <LeadList onOpen={setOpen} />}
      <LeadDrawer id={open} onClose={() => setOpen(null)} onEdit={l => setEdit(l)} />
      <LeadEditor value={edit} onClose={() => setEdit(null)} onSaved={id => { setEdit(null); setOpen(id); }} />
    </div>
  );
}

function Pipeline({ onOpen }: { onOpen: (id: number) => void }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['leads', 'board'], queryFn: () => api.get<{ items: Lead[] }>('/api/leads', { status: 'OPEN', pageSize: 300 }) });
  const [over, setOver] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/api/leads/${id}/move`, { status }),
    onSuccess: (_, v) => toast.success(`Moved to ${LEAD_LABELS[v.status]}`),
    onError: e => toast.error('Not moved', errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
  if (error) return <ErrorPanel error={error} retry={() => void refetch()} />;
  if (isLoading) return <SkeletonRows rows={6} />;
  const manage = can(P.LeadManage);
  const rows = data?.items ?? [];
  const drop = (e: DragEvent, status: string) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData('text/plain')); if (rows.find(r => r.id === id)?.status !== status) move.mutate({ id, status }); };
  return (
    <div className="board board-5" aria-label="Lead pipeline">
      {LEAD_FLOW.map(col => {
        const items = rows.filter(r => r.status === col);
        const value = items.reduce((s, r) => s + r.expectedValue, 0);
        return (
          <section key={col} className={`board-col ${over === col ? 'drop-over' : ''}`} aria-label={LEAD_LABELS[col]}
            onDragOver={manage ? e => { e.preventDefault(); setOver(col); } : undefined} onDragLeave={() => setOver(o => (o === col ? null : o))} onDrop={manage ? e => drop(e, col) : undefined}>
            <div className="board-col-head"><Status value={col} text={LEAD_LABELS[col]} /><span className="text-xs muted">{value ? compactMoney(value) : ''}</span><span className="count">{items.length}</span></div>
            <div className="board-col-body">
              {items.length === 0 && <p className="text-xs muted" style={{ padding: '8px 10px' }}>{manage ? 'Drop here' : 'None'}</p>}
              {items.map(l => {
                const d = daysFromToday(l.nextFollowUp);
                return (
                  <div key={l.id} className="dcard" role="button" tabIndex={0} draggable={manage} onDragStart={e => e.dataTransfer.setData('text/plain', String(l.id))}
                    onClick={() => onOpen(l.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(l.id); }}>
                    <div className="row between"><span className="medium">{l.name}</span>
                      {manage && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><Menu label="Move" items={LEAD_FLOW.filter(s => s !== l.status).map(s => ({ label: LEAD_LABELS[s], onClick: () => move.mutate({ id: l.id, status: s }) }))} /></span>}</div>
                    {l.interestedProducts && <div className="addr">{l.interestedProducts}</div>}
                    <div className="meta">
                      {l.expectedValue > 0 && <span className="medium" style={{ color: 'var(--ink-2)' }}>{compactMoney(l.expectedValue)}</span>}
                      {l.nextFollowUp && <span className={`row gap-1 ${d !== null && d < 0 ? 't-bad' : d === 0 ? 't-warn' : ''}`}><CalendarClock aria-hidden />{d === 0 ? 'Today' : date(l.nextFollowUp)}</span>}
                      {l.salespersonName && <span>{l.salespersonName}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadList({ onOpen }: { onOpen: (id: number) => void }) {
  const list = usePagedList<Lead>('leads', '/api/leads', { filterKeys: ['status'] });
  const { state, update } = list;
  const cols: Column<Lead>[] = [
    { key: 'n', header: 'Lead', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.name}</span><span className="cell-sub">{r.mobile ?? r.number}</span></div>, exportValue: r => r.name },
    { key: 'i', header: 'Interested in', mobile: 'sub', render: r => <span className="text-sm soft">{r.interestedProducts ?? '—'}</span>, exportValue: r => r.interestedProducts },
    { key: 'v', header: 'Expected', num: true, money: true, render: r => money(r.expectedValue, { decimals: false }), exportValue: r => r.expectedValue },
    { key: 'src', header: 'Source', optional: true, render: r => r.source ?? '—', exportValue: r => r.source },
    { key: 'sp', header: 'Salesperson', mobile: 'meta', render: r => r.salespersonName ?? '—', exportValue: r => r.salespersonName },
    { key: 'f', header: 'Next follow-up', mobile: 'meta', render: r => r.nextFollowUp ? date(r.nextFollowUp) : '—', exportValue: r => date(r.nextFollowUp) },
    { key: 's', header: 'Stage', mobile: 'right', render: r => <Status value={r.status} text={LEAD_LABELS[r.status]} />, exportValue: r => LEAD_LABELS[r.status] },
  ];
  return (
    <DataTable id="leads" label="Leads" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => onOpen(r.id)}
      toolbar={<>
        <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Name, mobile, city or product" />
        <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Stage"
          options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'CONVERTED', label: 'Converted' }, { value: 'LOST', label: 'Lost' }]} />
      </>}
      empty={<EmptyState icon={<Target />} title="No leads" desc="Record every enquiry — walk-in, phone or WhatsApp — so none is forgotten." />}
      exportAs={{ title: 'Leads', fetchAll: list.fetchAll }} />
  );
}

interface LeadDetail { lead: Lead; history: StatusHistory[]; followUps: FollowUp[] }

function LeadDrawer({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (l: Lead) => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<LeadDetail>(`/api/leads/${id}`), enabled: !!id });
  const [follow, setFollow] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lead'] }); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['follow-ups'] }); };
  const move = useMutation({ mutationFn: (status: string) => api.post(`/api/leads/${id}/move`, { status }), onSuccess: (_, s) => { toast.success(`Moved to ${LEAD_LABELS[s]}`); refresh(); }, onError: e => toast.error('Not moved', errorMessage(e)) });
  const convert = useMutation({
    mutationFn: (keepOpen: boolean) => api.post<{ customerId: number }>(`/api/leads/${id}/convert?keepOpen=${keepOpen}`),
    onSuccess: (r, keepOpen) => { refresh(); if (keepOpen) { onClose(); nav(`/sales/quotations/new?customerId=${r.customerId}`); } else toast.success('Converted to customer', undefined, { label: 'Open customer', run: () => nav(`/customers/${r.customerId}`) }); },
    onError: e => toast.error('Not converted', errorMessage(e)),
  });
  const l = data?.lead;
  const closed = l && ['CONVERTED', 'LOST'].includes(l.status);
  const lose = async () => {
    const reason = await confirm({ title: 'Mark as lost?', message: 'Open follow-ups are closed.', confirmText: 'Mark lost', tone: 'warn', reason: { label: 'Why?', placeholder: 'Budget, bought elsewhere, no response…' } });
    if (reason === null) return;
    try { await api.post(`/api/leads/${id}/move`, { status: 'LOST', lostReason: reason }); toast.success('Lead marked lost'); refresh(); } catch (e) { toast.error('Not updated', errorMessage(e)); }
  };
  const idx = l ? LEAD_FLOW.indexOf(l.status as typeof LEAD_FLOW[number]) : -1;
  const next = idx >= 0 && idx < LEAD_FLOW.length - 1 ? LEAD_FLOW[idx + 1] : null;
  const manage = can(P.LeadManage);
  return (
    <Drawer open={!!id} onClose={onClose} wide title={l?.name ?? 'Lead'} sub={l && <><Status value={l.status} text={LEAD_LABELS[l.status]} /> <span className="mono text-xs muted">{l.number}</span></>}
      footer={l && !closed && manage && <>
        <button className="btn btn-ghost" onClick={lose}><XCircle aria-hidden />Lost</button>
        <button className="btn btn-ghost" onClick={() => onEdit(l)}><Pencil aria-hidden />Edit</button>
        <span className="grow" />
        {next && <button className="btn" onClick={() => move.mutate(next)}><ArrowRight aria-hidden />{LEAD_LABELS[next]}</button>}
        {can(P.QuotationManage) && can(P.CustomerManage) && <button className="btn" onClick={() => convert.mutate(true)}><FileText aria-hidden />Quotation</button>}
        {can(P.CustomerManage) && <button className="btn btn-primary" onClick={() => convert.mutate(false)} aria-busy={convert.isPending}><UserCheck aria-hidden />Convert</button>}
      </>}>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !l ? <SkeletonRows rows={6} cols={2} /> : (
        <div className="stack gap-5">
          {l.status === 'LOST' && <Notice tone="bad">Lost — {l.lostReason}</Notice>}
          {l.customerId && <Notice tone="ok">Customer record: <Link to={`/customers/${l.customerId}`} onClick={onClose}>{l.customerName}</Link></Notice>}
          <div className="row wrap gap-3">
            {l.mobile && <a className="btn btn-sm" href={`tel:${l.mobile}`}><Phone aria-hidden />{l.mobile}</a>}
            {l.mobile && <a className="btn btn-sm" href={`https://wa.me/91${l.mobile}`} target="_blank" rel="noreferrer"><MessageSquare aria-hidden />WhatsApp</a>}
          </div>
          <KV items={[['Interested in', l.interestedProducts ?? '—'], ['Expected value', money(l.expectedValue, { decimals: false })], ['Source', l.source ?? '—'],
            ['Salesperson', l.salespersonName ?? '—'], !!l.city && ['City', l.city], !!l.email && ['Email', l.email], ['Created', dateTime(l.createdAt)], !!l.notes && ['Notes', l.notes]]} />
          <div>
            <div className="row between" style={{ marginBottom: 8 }}><div className="caps">Follow-ups</div>{manage && !closed && <button className="btn btn-sm" onClick={() => setFollow(true)}><Plus aria-hidden />Add</button>}</div>
            <FollowUpList items={data.followUps} compact onChanged={refresh} />
          </div>
          {data.history.length > 0 && <div><div className="caps" style={{ marginBottom: 8 }}>Activity</div>
            <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: h.toStatus === 'NOTE' ? 'Note' : LEAD_LABELS[h.toStatus] ?? label(h.toStatus), detail: h.note, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}`, tone: h.toStatus === 'LOST' ? 'bad' as const : h.toStatus === 'NOTE' ? 'info' as const : 'ok' as const }))} /></div>}
        </div>
      )}
      {l && follow && <AddFollowUpModal refType="LEAD" refId={l.id} defaultTitle={`Call ${l.name}`} onClose={() => setFollow(false)} onDone={refresh} />}
    </Drawer>
  );
}

function LeadEditor({ value, onClose, onSaved }: { value: Partial<Lead> | null; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const me = useMe();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [l, setL] = useState<Partial<Lead>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setL(value ?? {}); setErrors({}); }
  const save = useMutation({
    mutationFn: () => (l.id ? api.put<{ id: number }>(`/api/leads/${l.id}`, l) : api.post<{ id: number }>('/api/leads', { ...l, salespersonId: l.salespersonId ?? me.user.id })),
    onSuccess: r => { toast.success(l.id ? 'Lead saved' : 'Lead added'); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['lead'] }); qc.invalidateQueries({ queryKey: ['follow-ups'] }); onSaved(r.id); },
    onError: e => { if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v]))); toast.error('Not saved', errorMessage(e)); },
  });
  return (
    <Drawer open={!!value} onClose={onClose} title={l.id ? `Edit ${l.name}` : 'New lead'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" disabled={!l.name?.trim()} onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button></>}>
      <div className="stack gap-4">
        <div className="grid grid-2">
          <TextInput label="Name" required autoFocus value={l.name ?? ''} onChange={e => setL({ ...l, name: e.target.value })} error={errors.name} />
          <TextInput label="Mobile" optional inputMode="tel" value={l.mobile ?? ''} onChange={e => setL({ ...l, mobile: e.target.value })} error={errors.mobile} />
        </div>
        <TextInput label="Interested in" optional value={l.interestedProducts ?? ''} onChange={e => setL({ ...l, interestedProducts: e.target.value })} placeholder="3-seater sofa, king bed with storage" />
        <div className="grid grid-2">
          <NumberInput label="Expected value" money value={l.expectedValue ?? 0} onChange={v => setL({ ...l, expectedValue: v ?? 0 })} error={errors.expectedValue} />
          <TextInput label="Source" list="lead-sources" value={l.source ?? ''} onChange={e => setL({ ...l, source: e.target.value })} />
        </div>
        <div className="grid grid-2">
          <Select label="Salesperson" value={l.salespersonId ?? me.user.id} onChange={e => setL({ ...l, salespersonId: Number(e.target.value) })} options={(lookups?.staff ?? []).map(s => ({ value: s.id, label: s.fullName }))} />
          {!l.id && <TextInput label="First follow-up" optional type="date" value={l.nextFollowUp?.slice(0, 10) ?? ''} onChange={e => setL({ ...l, nextFollowUp: e.target.value || undefined })} />}
        </div>
        <div className="grid grid-2">
          <TextInput label="City / area" optional value={l.city ?? ''} onChange={e => setL({ ...l, city: e.target.value })} />
          <TextInput label="Email" optional type="email" value={l.email ?? ''} onChange={e => setL({ ...l, email: e.target.value })} error={errors.email} />
        </div>
        <TextArea label="Notes" optional rows={3} value={l.notes ?? ''} onChange={e => setL({ ...l, notes: e.target.value })} placeholder="Room size, budget, preferred finish…" />
      </div>
      <datalist id="lead-sources">{SOURCES.map(s => <option key={s} value={s} />)}</datalist>
    </Drawer>
  );
}

// ============================================================ follow-ups
export function FollowUps() {
  const [scope, setScope] = useState<'today' | 'upcoming' | 'done'>('today');
  const [mine, setMine] = useState(true);
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['follow-ups', scope, mine], queryFn: () => api.get<FollowUp[]>('/api/follow-ups', { scope, mine }) });
  const qc = useQueryClient();
  const overdue = (data ?? []).filter(f => f.isOverdue).length;
  return (
    <div className="page">
      <PageHeader title="Follow-ups" desc="Calls and visits promised to customers and leads. Due and overdue items also appear on the dashboard." />
      <div className="row wrap gap-3 between">
        <Segmented value={scope} onChange={setScope} label="Show" options={[{ value: 'today', label: 'Due & overdue' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'done', label: 'Done' }]} />
        <Switch label="Only mine" checked={mine} onChange={setMine} />
      </div>
      {scope === 'today' && overdue > 0 && <Notice tone="warn">{overdue} follow-up{overdue > 1 ? 's are' : ' is'} overdue.</Notice>}
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : isLoading ? <SkeletonRows rows={6} /> : (
        <div className="card card-pad"><FollowUpList items={data ?? []} onChanged={() => qc.invalidateQueries({ queryKey: ['follow-ups'] })} /></div>
      )}
    </div>
  );
}

export function FollowUpList({ items, compact, onChanged }: { items: FollowUp[]; compact?: boolean; onChanged: () => void }) {
  const can = useCan();
  const [done, setDone] = useState<FollowUp | null>(null);
  if (items.length === 0) return <EmptyState compact icon={<BellRing />} title="Nothing here" desc={compact ? 'Add a follow-up so the next call isn’t forgotten.' : 'All caught up.'} />;
  return <>
    <ul className="list-plain stack gap-2">{items.map(f => (
      <li key={f.id} className={`follow ${f.doneAt ? 'done' : f.isOverdue ? 'overdue' : ''}`}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="medium">{f.title}</div>
          <div className="text-xs soft row wrap gap-2">
            {!compact && <Link to={REF_ROUTE[f.refType]?.(f.refId) ?? '#'}>{f.customerName ?? f.refLabel}</Link>}
            {!compact && f.refLabel && f.refType !== 'CUSTOMER' && <span className="mono">{f.refLabel}</span>}
            {f.mobile && !compact && <a href={`tel:${f.mobile}`}>{f.mobile}</a>}
            {f.assignedName && <span>· {f.assignedName}</span>}
            {f.note && <span>· {f.note}</span>}
          </div>
          {f.doneAt && <div className="text-xs t-ok">Done {relative(f.doneAt)}{f.outcome ? ` — ${f.outcome}` : ''}</div>}
        </div>
        <span className={`text-sm nowrap ${f.isOverdue ? 't-bad medium' : ''}`}>{f.isOverdue ? `${-(daysFromToday(f.dueDate) ?? 0)}d overdue` : daysFromToday(f.dueDate) === 0 ? 'Today' : date(f.dueDate)}</span>
        {!f.doneAt && (can(P.LeadManage) || can(P.CustomerManage)) && <button className="btn btn-sm" onClick={() => setDone(f)}><Check aria-hidden />Done</button>}
      </li>
    ))}</ul>
    {done && <DoneModal f={done} onClose={() => setDone(null)} onDone={onChanged} />}
  </>;
}

function DoneModal({ f, onClose, onDone }: { f: FollowUp; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('');
  const [again, setAgain] = useState(false);
  const [next, setNext] = useState(iso(new Date(Date.now() + 3 * 86400000)));
  const go = useMutation({
    mutationFn: () => api.post(`/api/follow-ups/${f.id}/done`, { outcome, nextDate: again ? next : null }),
    onSuccess: () => { toast.success('Follow-up done'); onDone(); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={f.title} width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Mark done</button></>}>
      <div className="stack gap-4">
        <TextArea label="Outcome" optional rows={2} autoFocus value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Wants to visit on Sunday with spouse" />
        <Switch label="Schedule the next follow-up" checked={again} onChange={setAgain} />
        {again && <TextInput label="Next on" type="date" min={iso()} value={next} onChange={e => setNext(e.target.value)} />}
      </div>
    </Modal>
  );
}

export function AddFollowUpModal({ refType, refId, defaultTitle, onClose, onDone }: { refType: string; refId: number; defaultTitle: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const me = useMe();
  const { data: lookups } = useLookups();
  const [f, setF] = useState({ title: defaultTitle, dueDate: iso(new Date(Date.now() + 86400000)), assignedTo: me.user.id, note: '' });
  useEffect(() => setF(x => ({ ...x, title: defaultTitle })), [defaultTitle]);
  const go = useMutation({
    mutationFn: () => api.post('/api/follow-ups', { refType, refId, ...f, note: f.note || null }),
    onSuccess: () => { toast.success('Follow-up added'); onDone(); onClose(); },
    onError: e => toast.error('Not added', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Add follow-up" width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.title.trim()} onClick={() => go.mutate()} aria-busy={go.isPending}>Add</button></>}>
      <div className="stack gap-4">
        <TextInput label="What" required autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-2">
          <TextInput label="When" type="date" min={iso()} value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} />
          <Select label="Who" value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: Number(e.target.value) })} options={(lookups?.staff ?? []).map(s => ({ value: s.id, label: s.fullName }))} />
        </div>
        <TextInput label="Note" optional value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
      </div>
    </Modal>
  );
}

export function FollowUpBadge({ count }: { count: number }) {
  return count > 0 ? <Badge tone="warn" icon={<BellRing />}>{count}</Badge> : null;
}
