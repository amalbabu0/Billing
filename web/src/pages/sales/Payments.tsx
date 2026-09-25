import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, MessageCircle, Plus, Printer, Wallet } from 'lucide-react';
import { api, errorMessage, openPdf } from '@/lib/api';
import { date, dateTime, label, money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Customer, Payment } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, KV, Money, Notice, PageHeader, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { Drawer, Modal, useConfirm } from '@/components/ui/overlay';
import { CustomerPicker } from '@/components/pickers';
import { PaymentDialog } from '@/components/PaymentDialog';
import { WhatsAppDialog } from '@/components/DocActions';

export default function Payments() {
  const can = useCan();
  const { data: lookups } = useLookups();
  const [params, setParams] = useSearchParams();
  const list = usePagedList<Payment>('payments', '/api/payments', { filterKeys: ['method', 'from', 'to'] });
  const { state, update } = list;
  const [open, setOpen] = useState<number | null>(null);
  const [pick, setPick] = useState(false);
  const [receive, setReceive] = useState<Customer | null>(null);
  useEffect(() => { if (params.get('receive')) { setPick(true); params.delete('receive'); setParams(params, { replace: true }); } }, [params, setParams]);

  const columns: Column<Payment>[] = [
    { key: 'number', header: 'Receipt', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.paymentDate), exportValue: r => date(r.paymentDate) },
    { key: 'customer', header: 'Customer', mobile: 'sub', render: r => <span className="cell-title">{r.customerName}</span>, exportValue: r => r.customerName },
    { key: 'methods', header: 'Method', mobile: 'meta', render: r => r.methods ?? '—', exportValue: r => r.methods },
    { key: 'applied', header: 'Applied to', render: r => <span className="text-sm soft truncate" style={{ display: 'block', maxWidth: 260 }}>{r.appliedTo ?? '—'}</span>, exportValue: r => r.appliedTo },
    { key: 'state', header: 'Type', render: r => (r.isVoided ? <Status value="VOIDED" /> : r.direction === 'OUT' ? <Status value="REFUND" /> : <Status value="PAID" text="Received" />), exportValue: r => r.state },
    { key: 'amount', header: 'Amount', num: true, money: true, mobile: 'right', render: r => <span style={{ textDecoration: r.isVoided ? 'line-through' : undefined }}><Money value={r.direction === 'OUT' ? -r.amount : r.amount} strong /></span>, exportValue: r => (r.direction === 'OUT' ? -r.amount : r.amount) },
    { key: 'by', header: 'Received by', optional: true, render: r => r.createdByName, exportValue: r => r.createdByName },
  ];
  return (
    <div className="page">
      <PageHeader title="Payments" desc="Receipts and refunds. Payments are never edited — a wrong entry is voided with a reason and entered again, so the trail stays complete."
        actions={can(P.PaymentReceive) && <button className="btn btn-primary" onClick={() => setPick(true)}><Plus aria-hidden />Receive payment</button>} />
      <DataTable id="payments" label="Payments" columns={columns} rowKey={r => r.id} {...list.tableProps} onRowClick={r => setOpen(r.id)}
        rowClass={r => (r.isVoided ? 'muted-row' : undefined)}
        rowActions={r => [
          { label: 'Print receipt', icon: <Printer />, onClick: () => void openPdf(`/api/payments/${r.id}/pdf`) },
          { label: 'Details', icon: <Wallet />, onClick: () => setOpen(r.id) },
        ]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Receipt no., customer or reference" />
          <select className="select input-sm" style={{ width: 160 }} value={state.filters.method ?? ''} aria-label="Method" onChange={e => update({ filters: { method: e.target.value || undefined } })}>
            <option value="">All methods</option>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="From" value={state.filters.from ?? ''} onChange={e => update({ filters: { from: e.target.value || undefined } })} />
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="To" value={state.filters.to ?? ''} onChange={e => update({ filters: { to: e.target.value || undefined } })} />
        </>}
        empty={<EmptyState icon={<Wallet />} title="No payments found" desc="Payments taken at billing or later appear here." />}
        exportAs={{ title: 'Payments', fetchAll: list.fetchAll }} />
      <PaymentDrawer id={open} onClose={() => setOpen(null)} />
      <Modal open={pick} onClose={() => setPick(false)} title="Receive payment from" width={480}>
        <CustomerPicker value={null} autoFocus onChange={c => { if (c) { setPick(false); setReceive(c); } }} />
        <p className="text-sm muted" style={{ marginTop: 12 }}>To take a payment against a specific invoice or order, open it and choose <b>Receive payment</b>.</p>
      </Modal>
      {receive && <PaymentDialog open onClose={() => setReceive(null)} customerId={receive.id} customerName={receive.name} />}
    </div>
  );
}

export function PaymentDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [wa, setWa] = useState(false);
  const { data: p } = useQuery({ queryKey: ['payment', id], queryFn: () => api.get<Payment>(`/api/payments/${id}`), enabled: id !== null });
  const voidIt = useMutation({
    mutationFn: (reason: string) => api.post(`/api/payments/${id}/void`, { reason }),
    onSuccess: () => { toast.success('Payment voided', 'Balances have been updated.'); ['payments', 'payment', 'invoice', 'invoices', 'customer', 'dashboard'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); },
    onError: e => toast.error('Could not void', errorMessage(e)),
  });
  return (
    <Drawer open={id !== null} onClose={onClose} title={p ? `${p.direction === 'OUT' ? 'Refund' : 'Receipt'} ${p.number}` : 'Payment'} sub={p && `${date(p.paymentDate)} · ${p.customerName}`}
      headerExtra={p?.isVoided ? <Status value="VOIDED" /> : undefined}
      footer={p && <>
        <button className="btn btn-primary" onClick={() => void openPdf(`/api/payments/${p.id}/pdf`)}><Printer aria-hidden />Print receipt</button>
        <button className="btn" onClick={() => setWa(true)}><MessageCircle aria-hidden />WhatsApp</button>
        <span className="spacer" />
        {!p.isVoided && can(P.PaymentVoid) && <button className="btn btn-danger-soft" onClick={async () => {
          const reason = await confirm({ title: `Void ${p.number}?`, confirmText: 'Void payment', reason: { label: 'Reason for voiding' },
            message: <>{money(p.amount)} will be removed from the customer’s paid total and every invoice it was applied to will show the balance again. The receipt stays on record, marked void.</> });
          if (reason !== null) voidIt.mutate(reason);
        }}><Ban aria-hidden />Void</button>}
      </>}>
      {!p ? <p className="muted">Loading…</p> : (
        <div className="stack gap-5">
          <div className="money-hero"><span className="value" style={{ textDecoration: p.isVoided ? 'line-through' : undefined }}>{money(p.amount)}</span><span className="muted">{p.direction === 'OUT' ? 'paid back' : 'received'}</span></div>
          {p.isVoided && <Notice tone="bad">Voided {dateTime(p.voidedAt)} — {p.voidReason}</Notice>}
          <KV items={[['Customer', <Link to={`/customers/${p.customerId}`}>{p.customerName}</Link>], ['Recorded', `${dateTime(p.createdAt)} by ${p.createdByName ?? '—'}`], p.notes ? ['Note', p.notes] : null]} />
          <div className="stack gap-2">
            <span className="section-title">Received by</span>
            {p.lines.map(l => <div key={l.id} className="row between"><span>{label(l.methodCode)}{l.reference && <span className="muted mono"> · {l.reference}</span>}</span><Money value={l.amount} /></div>)}
          </div>
          <div className="stack gap-2">
            <span className="section-title">Applied to</span>
            {p.allocations.map(a => <div key={a.id} className="row between text-sm"><span>{label(a.docType)} <DocNo>{a.docNumber}</DocNo>{a.note && <span className="muted"> · {a.note}</span>}</span><Money value={a.amount} /></div>)}
          </div>
        </div>
      )}
      {p && <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/payments/${p.id}/whatsapp`} pdfUrl={`/api/payments/${p.id}/pdf?download=true`} pdfName={`${p.number}.pdf`} />}
    </Drawer>
  );
}
