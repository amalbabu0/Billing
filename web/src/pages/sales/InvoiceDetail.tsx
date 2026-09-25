import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Ban, Download, IndianRupee, Receipt, RotateCcw, Truck, Undo2 } from 'lucide-react';
import { api, errorMessage, openPdf } from '@/lib/api';
import { date, dateTime, label, money, pct, relative } from '@/lib/format';
import { P } from '@/lib/perms';
import type { AuditLog, Delivery, Invoice, Payment, SalesReturn } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { Card, DocNo, ErrorPanel, KV, Money, Notice, PageHeader, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { Menu, useConfirm } from '@/components/ui/overlay';
import { useDocActions } from '@/components/DocActions';
import { PaymentDialog } from '@/components/PaymentDialog';
import { RefundDialog } from '@/components/RefundDialog';
import { DocLinesTable, TaxSummary } from '@/components/DocLines';

interface Detail { invoice: Invoice; payments: Payment[]; returns: SalesReturn[]; deliveries: Delivery[]; history: AuditLog[] }

/** Cancel with a mandatory reason; explains exactly what will happen first. */
export function useCancelInvoice() {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  return async (id: number, number: string) => {
    const reason = await confirm({
      title: `Cancel invoice ${number}?`,
      message: <>The invoice stays on record marked <b>Cancelled</b>; its number is not reused. Items go back into stock, and any money received is kept on the customer’s account as advance (refund it separately if needed). This cannot be undone.</>,
      confirmText: 'Cancel invoice',
      reason: { label: 'Reason for cancelling', placeholder: 'e.g. Customer changed their mind before delivery' },
    });
    if (reason === null) return false;
    try {
      await api.post(`/api/invoices/${id}/cancel`, { reason });
      toast.success(`Invoice ${number} cancelled`, 'Stock restored; payments moved to customer advance.');
      ['invoice', 'invoices', 'dashboard', 'customer'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      return true;
    } catch (e) { toast.error('Could not cancel', errorMessage(e)); return false; }
  };
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['invoice', Number(id)], queryFn: () => api.get<Detail>(`/api/invoices/${id}`) });
  const [pay, setPay] = useState(false);
  const [refund, setRefund] = useState(false);
  const doc = useDocActions(`/api/invoices/${id}`, data?.invoice.number ?? 'invoice', { thermal: true });
  const cancel = useCancelInvoice();

  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (isLoading || !data) return <div className="page"><SkeletonRows rows={10} /></div>;
  const inv = data.invoice;
  const final = inv.status === 'FINAL';
  const overpaid = final && inv.balance < 0;

  const createDelivery = async () => {
    try {
      await api.post(`/api/deliveries/from-invoice/${inv.id}`);
      toast.success('Delivery created', 'Schedule it from the Delivery board.', { label: 'Open board', run: () => nav('/delivery/pending') });
      qc.invalidateQueries({ queryKey: ['invoice', inv.id] });
    } catch (e) { toast.error('Could not create delivery', errorMessage(e)); }
  };

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: 'Invoices', to: '/sales/invoices' }, { label: inv.number ?? 'Draft' }]}
        title={<span className="doc-no" style={{ fontSize: 'inherit' }}>{inv.number ?? `Draft #${inv.id}`}</span>}
        badge={<Status value={inv.paymentState} />}
        desc={<>{date(inv.date)} · billed by {inv.createdByName ?? '—'}{inv.finalizedAt ? ` · finalised ${relative(inv.finalizedAt)}` : ''}</>}
        actions={<>
          {inv.status === 'DRAFT' && can(P.InvoiceCreate) && <Link className="btn btn-primary" to={`/pos/${inv.id}`}><Receipt aria-hidden />Continue billing</Link>}
          {final && inv.balance > 0 && can(P.PaymentReceive) && <button className="btn btn-primary" onClick={() => setPay(true)}><IndianRupee aria-hidden />Receive payment</button>}
          {final && <button className="btn" onClick={doc.print}>Print</button>}
          {final && <button className="btn" onClick={doc.whatsapp}>WhatsApp</button>}
          <Menu items={[
            ...doc.actions.filter(a => a.label !== 'Print A4' && a.label !== 'Send on WhatsApp').map(a => ({ ...a, hidden: !final })),
            { separator: true, label: '', hidden: !final },
            { label: 'Sales return', icon: <RotateCcw />, onClick: () => nav(`/sales/returns/new?invoice=${inv.id}`), hidden: !final || !can(P.ReturnManage) },
            { label: 'Exchange items', icon: <ArrowLeftRight />, onClick: () => nav(`/sales/returns/new?invoice=${inv.id}&exchange=1`), hidden: !final || !can(P.ReturnManage) },
            { label: 'Create delivery', icon: <Truck />, onClick: createDelivery, hidden: !final || data.deliveries.length > 0 || !can(P.DeliveryManage) },
            { label: 'Refund excess', icon: <Undo2 />, onClick: () => setRefund(true), hidden: !overpaid || !can(P.PaymentRefund) },
            { separator: true, label: '', hidden: !final || !can(P.InvoiceCancel) },
            { label: 'Cancel invoice', icon: <Ban />, danger: true, onClick: () => cancel(inv.id, inv.number!), hidden: !final || !can(P.InvoiceCancel) },
          ]} />
        </>}
      />

      {inv.status === 'CANCELLED' && <Notice tone="bad">Cancelled {dateTime(inv.cancelledAt)} by {inv.cancelledByName ?? '—'} — {inv.cancelReason}</Notice>}
      {inv.status === 'DRAFT' && <Notice tone="info">This is a draft: it has no invoice number yet and has not affected stock or the customer’s balance.</Notice>}

      <div className="doc-layout">
        <div className="stack gap-4">
          <Card>
            <div className="doc-parties">
              <div className="doc-party">
                <h3>Bill to</h3>
                <p className="medium"><Link to={`/customers/${inv.customerId}`}>{inv.customerName}</Link></p>
                <p className="text-sm soft">{inv.billingAddress ?? '—'}</p>
                <p className="text-sm soft">{inv.customerMobile}</p>
                {inv.customerGstin && <p className="text-sm">GSTIN <span className="mono">{inv.customerGstin}</span></p>}
              </div>
              <div className="doc-party">
                <h3>Supply</h3>
                <p>{inv.isInterState ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'}</p>
                <p className="text-sm soft">Place of supply: {inv.placeOfSupply ?? '—'}</p>
                {inv.deliveryAddress && <p className="text-sm soft">Deliver to: {inv.deliveryAddress}</p>}
              </div>
              <div className="doc-party">
                <h3>References</h3>
                <KV items={[
                  inv.quotationNumber ? ['Quotation', <DocNo to={`/sales/quotations/${inv.quotationId}`}>{inv.quotationNumber}</DocNo>] : null,
                  inv.salesOrderNumber ? ['Sales order', <DocNo to={`/sales/orders/${inv.salesOrderId}`}>{inv.salesOrderNumber}</DocNo>] : null,
                  inv.customOrderNumber ? ['Custom order', <DocNo to={`/custom-orders/${inv.customOrderId}`}>{inv.customOrderNumber}</DocNo>] : null,
                  ['Due date', inv.dueDate ? date(inv.dueDate) : '—'],
                ]} />
              </div>
            </div>
          </Card>

          <Card title="Items" bodyClass="">
            <DocLinesTable lines={inv.lines} interState={inv.isInterState} showReturned={data.returns.length > 0} showCost={inv.costTotal !== null && inv.costTotal !== undefined} />
            <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="grid grid-2" style={{ alignItems: 'start' }}>
                <TaxSummary lines={inv.lines} interState={inv.isInterState} chargesTax={inv.chargesTax} charges={inv.deliveryCharge + inv.installationCharge} />
                <dl className="totals">
                  <dt>Subtotal</dt><dd>{money(inv.subtotal)}</dd>
                  {inv.discountTotal > 0 && <><dt>Discount</dt><dd className="t-ok">−{money(inv.discountTotal)}</dd></>}
                  {inv.deliveryCharge > 0 && <><dt>Delivery</dt><dd>{money(inv.deliveryCharge)}</dd></>}
                  {inv.installationCharge > 0 && <><dt>Installation</dt><dd>{money(inv.installationCharge)}</dd></>}
                  <dt>Taxable value</dt><dd>{money(inv.taxableTotal)}</dd>
                  {inv.isInterState ? <><dt>IGST</dt><dd>{money(inv.igstTotal)}</dd></> : <><dt>CGST</dt><dd>{money(inv.cgstTotal)}</dd><dt>SGST</dt><dd>{money(inv.sgstTotal)}</dd></>}
                  {inv.roundOff !== 0 && <><dt>Round off</dt><dd>{money(inv.roundOff)}</dd></>}
                  <dt className="grand">Grand total</dt><dd className="grand">{money(inv.grandTotal)}</dd>
                  {inv.margin !== null && inv.margin !== undefined && <><dt className="sub">Margin (on taxable)</dt><dd className="sub">{money(inv.margin)} · {pct(inv.taxableTotal ? Math.round((inv.margin / inv.taxableTotal) * 1000) / 10 : 0)}</dd></>}
                </dl>
              </div>
              {inv.notes && <p className="text-sm soft" style={{ marginTop: 16 }}><b>Note:</b> {inv.notes}</p>}
            </div>
          </Card>

          {data.returns.length > 0 && (
            <Card title="Returns" bodyClass="">
              <table className="data">
                <thead><tr><th>Return</th><th>Date</th><th>Reason</th><th className="num">Credit</th><th className="num">Refunded</th></tr></thead>
                <tbody>{data.returns.map(r => <tr key={r.id}><td><DocNo>{r.number}</DocNo></td><td>{date(r.returnDate)}</td><td>{label(r.reason)}</td><td className="num"><Money value={r.creditAmount} /></td><td className="num"><Money value={r.refundAmount} /></td></tr>)}</tbody>
              </table>
            </Card>
          )}

          {data.history.length > 0 && (
            <Card title="Activity">
              <Timeline items={data.history.map(h => ({ key: h.id, title: h.summary, time: dateTime(h.occurredAt), tone: h.action === 'CANCEL' ? 'bad' as const : h.action === 'FINALIZE' ? 'ok' as const : 'muted' as const }))} />
            </Card>
          )}
        </div>

        <aside className="doc-side">
          <Card title="Payment">
            <div className="pay-position">
              <div className="row-line"><span>Invoice total</span><span>{money(inv.grandTotal)}</span></div>
              {inv.returnedAmount > 0 && <div className="row-line"><span>Returned</span><span>−{money(inv.returnedAmount)}</span></div>}
              <div className="row-line"><span>Paid</span><span className="t-ok">{money(inv.paid)}</span></div>
              <div className="row-line remaining"><span>{overpaid ? 'Overpaid' : 'Balance'}</span><span className={inv.balance > 0 ? 't-warn' : overpaid ? 't-info' : 't-ok'}>{money(Math.abs(inv.balance))}</span></div>
            </div>
            {final && inv.balance > 0 && can(P.PaymentReceive) && <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => setPay(true)}>Receive payment</button>}
            {data.payments.length > 0 && (
              <ul className="list-plain stack gap-3" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                {data.payments.map(p => (
                  <li key={p.id} className="row gap-2 text-sm" style={{ opacity: p.isVoided ? 0.55 : 1 }}>
                    <div className="grow"><DocNo>{p.number}</DocNo><div className="text-xs muted">{date(p.paymentDate)} · {p.methods}</div></div>
                    {p.isVoided && <Status value="VOIDED" />}
                    <Money value={p.direction === 'OUT' ? -p.amount : p.amount} />
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label="Download receipt" onClick={() => void openPdf(`/api/payments/${p.id}/pdf`)}><Download /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.deliveries.length > 0 && (
            <Card title="Delivery">
              {data.deliveries.map(d => (
                <div key={d.id} className="stack gap-1">
                  <div className="row between"><DocNo to={`/delivery/all?open=${d.id}`}>{d.number}</DocNo><Status value={d.status} /></div>
                  <div className="text-sm soft">{d.scheduledDate ? `${date(d.scheduledDate)} ${d.timeSlot ?? ''}` : 'Not scheduled yet'}{d.driverName ? ` · ${d.driverName}` : ''}</div>
                </div>
              ))}
            </Card>
          )}
        </aside>
      </div>
      {pay && <PaymentDialog open onClose={() => setPay(false)} customerId={inv.customerId} customerName={inv.customerName} docType="INVOICE" docId={inv.id} docNumber={inv.number} />}
      {refund && <RefundDialog open onClose={() => setRefund(false)} customerId={inv.customerId} docType="INVOICE" docId={inv.id} max={-inv.balance} />}
      {doc.dialog}
    </div>
  );
}
