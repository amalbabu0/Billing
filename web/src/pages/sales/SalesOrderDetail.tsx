import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, IndianRupee, Lock, Pencil, Receipt, Truck, Workflow } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { addDays, date, dateTime, iso, label, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { CheckoutResult, Delivery, Payment, SalesOrder, StatusHistory } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { Card, DocNo, ErrorPanel, Money, Notice, PageHeader, SkeletonRows, Status, Timeline, Tracker } from '@/components/ui/display';
import { Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { NumberInput, TextInput } from '@/components/ui/form';
import { DocActionsButtons } from '@/components/DocActions';
import { DocLinesTable } from '@/components/DocLines';
import { PaymentDialog } from '@/components/PaymentDialog';

const STEPS = [
  { key: 'CONFIRMED', label: 'Confirmed' }, { key: 'PROCESSING', label: 'Processing' }, { key: 'READY', label: 'Ready' },
  { key: 'DISPATCHED', label: 'Dispatched' }, { key: 'DELIVERED', label: 'Delivered' }, { key: 'COMPLETED', label: 'Completed' },
];
const NEXT: Record<string, string | undefined> = { CONFIRMED: 'PROCESSING', PROCESSING: 'READY', MANUFACTURING: 'READY', READY: 'DISPATCHED' };

interface Detail { order: SalesOrder; history: StatusHistory[]; payments: Payment[]; deliveries: Delivery[] }

export default function SalesOrderDetail() {
  const { id } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['sales-order', Number(id)], queryFn: () => api.get<Detail>(`/api/sales-orders/${id}`) });
  const [pay, setPay] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['sales-order', Number(id)] }); qc.invalidateQueries({ queryKey: ['sales-orders'] }); };
  const act = useMutation({
    mutationFn: async (a: { kind: 'confirm' | 'reserve' | 'status' | 'delivery'; status?: string; note?: string }) => {
      if (a.kind === 'confirm') return api.post<{ shortages: string[] }>(`/api/sales-orders/${id}/confirm`);
      if (a.kind === 'reserve') return api.post<{ shortages: string[] }>(`/api/sales-orders/${id}/reserve`);
      if (a.kind === 'delivery') return api.post(`/api/sales-orders/${id}/delivery`);
      return api.post(`/api/sales-orders/${id}/status`, { status: a.status, note: a.note });
    },
    onSuccess: (r, a) => {
      const shortages = (r as { shortages?: string[] } | undefined)?.shortages ?? [];
      if (shortages.length) toast.info('Partly reserved', `Short: ${shortages.join(', ')}`);
      else toast.success(a.kind === 'confirm' ? 'Order confirmed and stock reserved' : a.kind === 'reserve' ? 'Stock reserved' : a.kind === 'delivery' ? 'Delivery created — schedule it on the Delivery board' : `Order moved to ${label(a.status)}`);
      refresh();
    },
    onError: e => toast.error('Not updated', errorMessage(e)),
  });

  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (isLoading || !data) return <div className="page"><SkeletonRows rows={10} /></div>;
  const o = data.order;
  const open = !['COMPLETED', 'CANCELLED'].includes(o.status);
  const balance = o.grandTotal - o.advancePaid;
  const next = NEXT[o.status];
  const reservedAll = o.lines.every(l => !l.variantId || l.reservedQty >= l.quantity);
  const stepKey = o.status === 'MANUFACTURING' ? 'PROCESSING' : o.status;

  const cancel = async () => {
    const reason = await confirm({
      title: `Cancel order ${o.number}?`, confirmText: 'Cancel order',
      message: <>Reserved stock is released for other customers. {o.advancePaid > 0 && <>The advance of <b>{money(o.advancePaid)}</b> stays on the customer’s account (refund it from the customer page if needed).</>}</>,
      reason: { label: 'Reason' },
    });
    if (reason !== null) act.mutate({ kind: 'status', status: 'CANCELLED', note: reason });
  };

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Sales orders', to: '/sales/orders' }, { label: o.number ?? '' }]}
        title={<span className="doc-no" style={{ fontSize: 'inherit' }}>{o.number}</span>} badge={<Status value={o.status} />}
        desc={<>{o.customerName} · ordered {date(o.date)}{o.expectedDeliveryDate ? ` · delivery by ${date(o.expectedDeliveryDate)}` : ''}</>}
        actions={<>
          <Link className="btn btn-ghost" to={`/360/SALES_ORDER/${id}`} title="Everything linked to this document"><Workflow aria-hidden />360°</Link>
          {o.status === 'DRAFT' && can(P.SalesOrderManage) && <button className="btn btn-primary" onClick={() => act.mutate({ kind: 'confirm' })} aria-busy={act.isPending}><CheckCircle2 aria-hidden />Confirm & reserve stock</button>}
          {open && o.status !== 'DRAFT' && !o.invoiceId && can(P.InvoiceCreate) && <button className="btn btn-primary" onClick={() => setInvoice(true)}><Receipt aria-hidden />Generate invoice</button>}
          {open && can(P.PaymentReceive) && balance > 0 && !o.invoiceId && <button className="btn" onClick={() => setPay(true)}><IndianRupee aria-hidden />Receive advance</button>}
          <DocActionsButtons base={`/api/sales-orders/${o.id}`} name={`${o.number} ${o.customerName}`} />
          {open && can(P.SalesOrderManage) && (
            <Menu items={[
              { label: 'Edit draft', icon: <Pencil />, onClick: () => nav(`/sales/orders/${o.id}/edit`), hidden: o.status !== 'DRAFT' },
              { label: next ? `Move to ${label(next)}` : '', icon: <CheckCircle2 />, onClick: () => act.mutate({ kind: 'status', status: next }), hidden: !next },
              { label: 'Reserve stock again', icon: <Lock />, onClick: () => act.mutate({ kind: 'reserve' }), hidden: o.status === 'DRAFT' || reservedAll },
              { label: 'Create delivery', icon: <Truck />, onClick: () => act.mutate({ kind: 'delivery' }), hidden: !o.requiresDelivery || data.deliveries.length > 0 || !can(P.DeliveryManage) },
              { separator: true, label: '' },
              { label: 'Cancel order', icon: <Ban />, danger: true, onClick: cancel, hidden: !!o.invoiceId },
            ]} />
          )}
        </>} />

      {o.status === 'CANCELLED' ? <Notice tone="bad">Cancelled — {o.cancelReason}</Notice> : o.status !== 'DRAFT' && (
        <Card><Tracker steps={STEPS} current={stepKey} skipped={o.requiresDelivery ? [] : ['DISPATCHED']} /></Card>
      )}
      {o.status !== 'DRAFT' && open && !reservedAll && <Notice tone="warn">Some items are not fully reserved — stock was short when the order was confirmed. Reserve again once stock arrives.</Notice>}

      <div className="doc-layout">
        <div className="stack gap-4">
          <Card title="Items" sub={o.quotationNumber ? <>From quotation <DocNo to={`/sales/quotations/${o.quotationId}`}>{o.quotationNumber}</DocNo></> : undefined} bodyClass="">
            <DocLinesTable lines={o.lines} interState={o.isInterState} showReserved />
          </Card>
          {data.history.length > 0 && (
            <Card title="Timeline">
              <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: `${label(h.toStatus)}`, detail: h.note, time: `${dateTime(h.changedAt)} · ${h.changedByName ?? ''}`, tone: h.toStatus === 'CANCELLED' ? 'bad' as const : 'ok' as const }))} />
            </Card>
          )}
        </div>
        <aside className="doc-side">
          <Card title="Payment">
            <div className="pay-position">
              <div className="row-line"><span>Order value</span><span>{money(o.grandTotal)}</span></div>
              <div className="row-line"><span>Advance received</span><span className="t-ok">{money(o.advancePaid)}</span></div>
              <div className="row-line remaining"><span>Balance</span><span className={balance > 0 ? 't-warn' : 't-ok'}>{money(balance)}</span></div>
            </div>
            {o.invoiceId && <Notice tone="ok">Invoiced as <DocNo to={`/sales/invoices/${o.invoiceId}`}>{o.invoiceNumber}</DocNo> — the advance was applied to it.</Notice>}
            {data.payments.length > 0 && (
              <ul className="list-plain stack gap-2" style={{ marginTop: 12 }}>
                {data.payments.map(p => <li key={p.id} className="row between text-sm"><span><DocNo>{p.number}</DocNo> <span className="muted">{date(p.paymentDate)} · {p.methods}</span></span><Money value={p.direction === 'OUT' ? -p.amount : p.amount} /></li>)}
              </ul>
            )}
          </Card>
          <Card title="Customer">
            <p className="medium"><Link to={`/customers/${o.customerId}`}>{o.customerName}</Link></p>
            <p className="text-sm soft">{o.customerMobile}</p>
            <p className="text-sm soft" style={{ marginTop: 6 }}>{o.deliveryAddress ?? o.billingAddress}</p>
            <p className="text-xs muted" style={{ marginTop: 8 }}>{o.requiresDelivery ? 'Home delivery' : 'Customer pickup'}{o.requiresInstallation ? ' · installation included' : ''}</p>
          </Card>
          {data.deliveries.map(d => (
            <Card key={d.id} title="Delivery">
              <div className="row between"><DocNo to={`/delivery/all?open=${d.id}`}>{d.number}</DocNo><Status value={d.status} /></div>
              <p className="text-sm soft" style={{ marginTop: 6 }}>{d.scheduledDate ? `${date(d.scheduledDate)} ${d.timeSlot ?? ''}` : 'Not scheduled yet'}{d.driverName ? ` · ${d.driverName}` : ''}</p>
            </Card>
          ))}
        </aside>
      </div>
      {pay && <PaymentDialog open onClose={() => setPay(false)} customerId={o.customerId} customerName={o.customerName} docType="SALES_ORDER" docId={o.id} docNumber={o.number} onDone={refresh} />}
      <GenerateInvoiceModal open={invoice} onClose={() => setInvoice(false)} order={o} onDone={r => nav(`/sales/invoices/${r.invoiceId}`)} />
    </div>
  );
}

/** Converts the order into a tax invoice. The advance is applied automatically; collect any part of the balance now. */
function GenerateInvoiceModal({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: SalesOrder; onDone: (r: CheckoutResult) => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const balance = order.grandTotal - order.advancePaid;
  const [amount, setAmount] = useState<number | null>(balance);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [due, setDue] = useState(iso(addDays(new Date(), lookups?.defaults.defaultDueDays ?? 15)));
  const go = useMutation({
    mutationFn: () => api.post<CheckoutResult>(`/api/sales-orders/${order.id}/invoice`, {
      payments: amount && amount > 0 ? [{ methodCode: method, amount, reference: reference || undefined }] : [], dueDate: (amount ?? 0) < balance ? due : undefined,
    }),
    onSuccess: r => { toast.success(`Invoice ${r.invoiceNumber} generated`); onDone(r); },
    onError: e => toast.error('Invoice not generated', errorMessage(e)),
  });
  const remaining = Math.max(0, balance - (amount ?? 0));
  return (
    <Modal open={open} onClose={onClose} title={`Invoice for ${order.number}`} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} disabled={go.isPending} aria-busy={go.isPending}>Generate invoice</button></>}>
      <div className="stack gap-4">
        <div className="card card-pad" style={{ background: 'var(--surface-sunken)', border: 0 }}>
          <div className="pay-position">
            <div className="row-line"><span>Order value</span><span>{money(order.grandTotal)}</span></div>
            <div className="row-line"><span>Advance (applied automatically)</span><span>−{money(order.advancePaid)}</span></div>
            <div className="row-line"><span>Collect now</span><span>−{money(amount ?? 0)}</span></div>
            <div className="row-line remaining"><span>Remaining on credit</span><span className={remaining > 0 ? 't-warn' : 't-ok'}>{money(remaining)}</span></div>
          </div>
        </div>
        <div className="grid grid-2">
          <NumberInput label="Amount received now" money value={amount} onChange={setAmount} max={balance} />
          <div className="field"><label className="field-label" htmlFor="gi-m">Method</label>
            <select id="gi-m" className="select" value={method} onChange={e => setMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
        </div>
        {method !== 'CASH' && <TextInput label="Reference" value={reference} onChange={e => setReference(e.target.value)} />}
        {remaining > 0 && <TextInput label="Balance due by" type="date" value={due} min={iso()} onChange={e => setDue(e.target.value)} />}
      </div>
    </Modal>
  );
}
