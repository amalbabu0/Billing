import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ban, ExternalLink, FileText, IndianRupee, MessageCircle, Plus, Printer, Receipt, RotateCcw, Wallet } from 'lucide-react';
import { api, openPdf } from '@/lib/api';
import { date, money, num } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Invoice, InvoiceRow, Payment } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, KV, Money, PageHeader, Segmented, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { Drawer } from '@/components/ui/overlay';
import { useDocActions } from '@/components/DocActions';
import { PaymentDialog } from '@/components/PaymentDialog';
import { useCancelInvoice } from './InvoiceDetail';

const STATES = [
  { value: '', label: 'All' }, { value: 'OUTSTANDING', label: 'Unpaid & part paid' }, { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'CANCELLED', label: 'Cancelled' },
];

interface Summary { count: number; total: number; paid: number; balance: number; overdue: number; drafts: number; cancelled: number }

export default function Invoices() {
  const can = useCan();
  const nav = useNavigate();
  const list = usePagedList<InvoiceRow>('invoices', '/api/invoices', {
    filterKeys: ['state', 'from', 'to', 'customerId'],
    defaults: { sortBy: 'date', sortDescending: true },
    map: s => ({
      paymentState: ['OUTSTANDING', 'OVERDUE', 'PAID'].includes(s.filters.state ?? '') ? s.filters.state : undefined,
      status: ['DRAFT', 'CANCELLED'].includes(s.filters.state ?? '') ? s.filters.state : undefined,
      state: undefined,
    }),
  });
  const { state, update } = list;
  const summary = useQuery({
    queryKey: ['invoices', 'summary', state.filters.from, state.filters.to],
    queryFn: () => api.get<Summary>('/api/invoices/summary', { from: state.filters.from, to: state.filters.to }),
  });
  const [preview, setPreview] = useState<number | null>(null);
  const [pay, setPay] = useState<InvoiceRow | null>(null);
  const cancel = useCancelInvoice();

  const columns: Column<InvoiceRow>[] = [
    { key: 'number', header: 'Invoice', sort: 'number', fixed: true, mobile: 'title', render: r => <DocNo>{r.displayNumber}</DocNo>, exportValue: r => r.displayNumber },
    { key: 'date', header: 'Date', sort: 'date', mobile: 'meta', render: r => date(r.invoiceDate), exportValue: r => date(r.invoiceDate) },
    {
      key: 'customer', header: 'Customer', sort: 'customer', mobile: 'sub',
      render: r => <div className="cell-stack"><span className="cell-title">{r.customerName}</span>{r.customerMobile && <span className="cell-sub">{r.customerMobile}</span>}</div>,
      exportValue: r => r.customerName,
    },
    { key: 'total', header: 'Total', sort: 'total', num: true, mobile: 'right', money: true, render: r => <Money value={r.grandTotal} />, exportValue: r => r.grandTotal },
    { key: 'paid', header: 'Paid', num: true, money: true, optional: false, render: r => <Money value={r.paid} className="soft" />, exportValue: r => r.paid },
    {
      key: 'balance', header: 'Balance', sort: 'balance', num: true, money: true,
      render: r => r.balance > 0 ? <span className="stack gap-1" style={{ alignItems: 'flex-end' }}><Money value={r.balance} strong />{r.daysOverdue > 0 && <span className="text-xs t-bad">{r.daysOverdue}d overdue</span>}</span> : <span className="muted">—</span>,
      exportValue: r => r.balance,
    },
    { key: 'status', header: 'Status', mobile: 'meta', render: r => <Status value={r.paymentState} />, exportValue: r => r.paymentState },
    { key: 'due', header: 'Due', sort: 'due', optional: true, render: r => (r.balance > 0 ? date(r.dueDate) : '—'), exportValue: r => date(r.dueDate) },
    { key: 'by', header: 'Billed by', optional: true, render: r => r.createdByName ?? '—', exportValue: r => r.createdByName },
  ];

  return (
    <div className="page">
      <PageHeader title="Invoices" desc="Every bill issued from the showroom. Click a row for a quick look; balances update as payments come in."
        actions={can(P.InvoiceCreate) && <Link className="btn btn-primary" to="/pos"><Plus aria-hidden />New invoice <span className="kbd">F2</span></Link>} />

      <StatStrip loading={summary.isLoading} items={[
        { label: 'Invoices', value: num(summary.data?.count) },
        { label: 'Billed', value: money(summary.data?.total, { decimals: false }) },
        { label: 'Collected', value: money(summary.data?.paid, { decimals: false }), tone: 'ok' },
        { label: 'Outstanding', value: money(summary.data?.balance, { decimals: false }), tone: summary.data?.balance ? 'warn' : undefined },
        { label: 'Overdue', value: money(summary.data?.overdue, { decimals: false }), tone: summary.data?.overdue ? 'bad' : undefined },
      ]} />

      <DataTable
        id="invoices" label="Invoices" columns={columns} rowKey={r => r.id} {...list.tableProps}
        onRowClick={r => setPreview(r.id)}
        rowClass={r => (r.status === 'CANCELLED' ? 'muted-row' : undefined)}
        rowActions={r => [
          { label: 'Open invoice', icon: <ExternalLink />, onClick: () => nav(r.status === 'DRAFT' ? `/pos/${r.id}` : `/sales/invoices/${r.id}`) },
          { label: 'Print', icon: <Printer />, onClick: () => void openPdf(`/api/invoices/${r.id}/pdf`), hidden: r.status === 'DRAFT' },
          { label: 'Receive payment', icon: <Wallet />, onClick: () => setPay(r), hidden: r.balance <= 0 || !can(P.PaymentReceive) },
          { label: 'Sales return', icon: <RotateCcw />, onClick: () => nav(`/sales/returns/new?invoice=${r.id}`), hidden: r.status !== 'FINAL' || !can(P.ReturnManage) },
          { separator: true, label: '', hidden: r.status !== 'FINAL' || !can(P.InvoiceCancel) },
          { label: 'Cancel invoice', icon: <Ban />, danger: true, onClick: () => cancel(r.id, r.displayNumber), hidden: r.status !== 'FINAL' || !can(P.InvoiceCancel) },
        ]}
        toolbar={
          <>
            <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Invoice no., customer or mobile" />
            <Segmented value={state.filters.state ?? ''} onChange={v => update({ filters: { state: v || undefined } })} label="Payment status" options={STATES} />
            <div className="row gap-2">
              <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="From date" value={state.filters.from ?? ''} onChange={e => update({ filters: { from: e.target.value || undefined } })} />
              <span className="muted text-sm">to</span>
              <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="To date" value={state.filters.to ?? ''} onChange={e => update({ filters: { to: e.target.value || undefined } })} />
            </div>
          </>
        }
        empty={state.search || state.filters.state || state.filters.from
          ? <EmptyState icon={<Receipt />} title="No invoices match" desc="Try another search or clear the filters." action={<button className="btn" onClick={() => update({ search: '', filters: { state: undefined, from: undefined, to: undefined } })}>Clear filters</button>} />
          : <EmptyState icon={<Receipt />} title="No invoices yet" desc="Your first bill will appear here." action={can(P.InvoiceCreate) && <Link className="btn btn-primary" to="/pos">Create your first invoice</Link>} />}
        exportAs={{ title: 'Invoices', fetchAll: list.fetchAll }}
      />

      <InvoiceDrawer id={preview} onClose={() => setPreview(null)} onPay={inv => setPay({ id: inv.id, customerId: inv.customerId, customerName: inv.customerName, displayNumber: inv.number ?? '' } as InvoiceRow)} />
      {pay && <PaymentDialog open onClose={() => setPay(null)} customerId={pay.customerId} customerName={pay.customerName} docType="INVOICE" docId={pay.id} docNumber={pay.displayNumber} />}
    </div>
  );
}

/** Quick inspection without leaving the list. */
export function InvoiceDrawer({ id, onClose, onPay }: { id: number | null; onClose: () => void; onPay?: (inv: Invoice) => void }) {
  const can = useCan();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id], queryFn: () => api.get<{ invoice: Invoice; payments: Payment[] }>(`/api/invoices/${id}`), enabled: id !== null,
  });
  const inv = data?.invoice;
  const doc = useDocActions(`/api/invoices/${id}`, inv?.number ?? 'invoice', { thermal: true });
  return (
    <Drawer open={id !== null} onClose={onClose} title={inv ? inv.number ?? `Draft #${inv.id}` : 'Invoice'} sub={inv && `${date(inv.date)} · ${inv.customerName}`}
      headerExtra={inv && <Status value={inv.paymentState} />}
      footer={inv && <>
        <button className="btn btn-primary" onClick={() => nav(inv.status === 'DRAFT' ? `/pos/${inv.id}` : `/sales/invoices/${inv.id}`)}><FileText aria-hidden />{inv.status === 'DRAFT' ? 'Continue billing' : 'Open invoice'}</button>
        {inv.status === 'FINAL' && <button className="btn" onClick={doc.print}><Printer aria-hidden />Print</button>}
        {inv.status === 'FINAL' && <button className="btn" onClick={doc.whatsapp}><MessageCircle aria-hidden />WhatsApp</button>}
        {inv.balance > 0 && can(P.PaymentReceive) && onPay && <button className="btn" onClick={() => { onPay(inv); onClose(); }}><IndianRupee aria-hidden />Receive</button>}
      </>}>
      {isLoading || !inv ? <p className="muted">Loading…</p> : (
        <div className="stack gap-5">
          <div className="money-hero"><span className="value">{money(inv.grandTotal)}</span>
            {inv.balance > 0 ? <span className="t-warn medium">{money(inv.balance)} due{inv.dueDate ? ` by ${date(inv.dueDate)}` : ''}</span> : inv.status === 'FINAL' ? <span className="t-ok medium">Fully paid</span> : null}
          </div>
          <KV items={[
            ['Customer', <><Link to={`/customers/${inv.customerId}`}>{inv.customerName}</Link>{inv.customerMobile && <span className="muted"> · {inv.customerMobile}</span>}</>],
            inv.customerGstin ? ['GSTIN', <span className="mono">{inv.customerGstin}</span>] : null,
            ['Tax', inv.isInterState ? `IGST ${money(inv.igstTotal)}` : `CGST ${money(inv.cgstTotal)} + SGST ${money(inv.sgstTotal)}`],
            ['Paid', money(inv.paid)],
            inv.salesOrderNumber ? ['From order', <DocNo to={`/sales/orders/${inv.salesOrderId}`}>{inv.salesOrderNumber}</DocNo>] : null,
            ['Billed by', inv.createdByName],
          ]} />
          <div className="table-card">
            <table className="data compact">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
              <tbody>{inv.lines.map(l => <tr key={l.id}><td><div className="cell-stack"><span className="cell-title">{l.description}</span><span className="cell-sub mono">{l.sku}</span></div></td><td className="num">{l.quantity}</td><td className="num"><Money value={l.lineTotal} /></td></tr>)}</tbody>
            </table>
          </div>
          {data.payments.length > 0 && (
            <div className="stack gap-2">
              <span className="section-title">Payments</span>
              {data.payments.map(p => <div key={p.id} className="row between text-sm"><span><DocNo>{p.number}</DocNo> <span className="muted">· {date(p.paymentDate)} · {p.methods}</span></span><Money value={p.direction === 'OUT' ? -p.amount : p.amount} /></div>)}
            </div>
          )}
        </div>
      )}
      {doc.dialog}
    </Drawer>
  );
}
