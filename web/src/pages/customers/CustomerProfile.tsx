import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, FilePlus2, Hammer, IndianRupee, LifeBuoy, Plus, ShieldCheck, Mail, MapPin, MessageCircle, Pencil, Phone, Receipt, RotateCcw, Truck, Undo2, Wallet, FileText, ClipboardList,
} from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime, label, money, relative } from '@/lib/format';
import { P } from '@/lib/perms';
import type { CustomOrder, Customer, CustomerSummary, Delivery, FollowUp, InvoiceRow, LedgerEntry, Paged, Payment, SalesOrder, SalesReturn, ServiceTicket, WarrantyRecord } from '@/lib/types';
import { SERVICE_LABELS, toneOf, WARRANTY_LABELS, WARRANTY_TONE } from '@/lib/status';
import { useCan } from '@/app/providers';
import { Avatar, Badge, Card, DocNo, EmptyState, ErrorPanel, Kpi, Money, PageHeader, SkeletonRows, Status, Tabs, Timeline } from '@/components/ui/display';
import { Menu } from '@/components/ui/overlay';
import { DataTable, type Column } from '@/components/DataTable';
import { CustomerDrawer } from '@/components/CustomerForm';
import { PaymentDialog } from '@/components/PaymentDialog';
import { RefundDialog } from '@/components/RefundDialog';
import { WhatsAppDialog } from '@/components/DocActions';
import { customerStatus } from './Customers';
import { LedgerTable } from './CustomerLedger';
import { AddFollowUpModal, FollowUpList } from '../crm/Crm';

type Tab = 'overview' | 'invoices' | 'payments' | 'orders' | 'deliveries' | 'returns' | 'service' | 'followups' | 'ledger';
const KIND_ICON: Record<string, typeof Receipt> = { INVOICE: Receipt, PAYMENT: Wallet, REFUND: Undo2, QUOTATION: FileText, SALES_ORDER: ClipboardList, CUSTOM_ORDER: Hammer, DELIVERY: Truck, RETURN: RotateCcw };
const KIND_ROUTE: Record<string, string> = { INVOICE: '/sales/invoices/', QUOTATION: '/sales/quotations/', SALES_ORDER: '/sales/orders/', CUSTOM_ORDER: '/custom-orders/', DELIVERY: '/delivery/all?open=' };

export default function CustomerProfile() {
  const { id } = useParams();
  const cid = Number(id);
  const can = useCan();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const customer = useQuery({ queryKey: ['customer', cid], queryFn: () => api.get<Customer>(`/api/customers/${cid}`) });
  const summary = useQuery({ queryKey: ['customer-summary', cid], queryFn: () => api.get<CustomerSummary>(`/api/customers/${cid}/summary`) });
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [refund, setRefund] = useState(false);
  const [wa, setWa] = useState(false);

  if (customer.error) return <div className="page"><ErrorPanel error={customer.error} retry={() => void customer.refetch()} /></div>;
  if (!customer.data) return <div className="page"><SkeletonRows rows={8} /></div>;
  const c = customer.data;
  const s = summary.data;
  const st = customerStatus({ ...c, outstanding: s?.outstanding ?? c.outstanding, totalPurchases: s?.totalPurchases ?? c.totalPurchases });

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Customers', to: '/customers' }, { label: c.name }]}
        title={<span className="profile-head"><Avatar name={c.name} size="lg" /><span><span style={{ display: 'block' }}>{c.name}</span>
          <span className="profile-contacts" style={{ fontSize: 13, fontWeight: 400 }}>
            <span className="mono">{c.code}</span>
            {c.mobile && <span><Phone aria-hidden /><a href={`tel:${c.mobile}`}>{c.mobile}</a></span>}
            {c.whatsapp && c.whatsapp !== c.mobile && <span><MessageCircle aria-hidden />{c.whatsapp}</span>}
            {c.email && <span><Mail aria-hidden />{c.email}</span>}
            {(c.city || c.state) && <span><MapPin aria-hidden />{[c.city, c.state].filter(Boolean).join(', ')}</span>}
            {c.gstin && <span>GSTIN <span className="mono">{c.gstin}</span></span>}
          </span></span></span>}
        badge={<Badge tone={st.tone}>{st.text}</Badge>}
        actions={<>
          {can(P.InvoiceCreate) && <button className="btn btn-primary" onClick={() => nav('/pos')}><Receipt aria-hidden />New invoice</button>}
          {can(P.PaymentReceive) && !c.isWalkIn && <button className="btn" onClick={() => setPay(true)}><IndianRupee aria-hidden />Receive payment</button>}
          {(s?.outstanding ?? 0) > 0 && <button className="btn" onClick={() => setWa(true)}><MessageCircle aria-hidden />Send reminder</button>}
          <Menu items={[
            { label: 'New quotation', icon: <FilePlus2 />, onClick: () => nav(`/sales/quotations/new?customerId=${c.id}`), hidden: !can(P.QuotationManage) },
            { label: 'New sales order', icon: <ClipboardList />, onClick: () => nav(`/sales/orders/new?customerId=${c.id}`), hidden: !can(P.SalesOrderManage) },
            { label: 'New custom order', icon: <Hammer />, onClick: () => nav(`/custom-orders/new?customerId=${c.id}`), hidden: !can(P.CustomOrderManage) },
            { label: 'Refund advance', icon: <Undo2 />, onClick: () => setRefund(true), hidden: !can(P.PaymentRefund) || !(s?.advanceAmount && s.advanceAmount > 0) },
            { label: 'New service ticket', icon: <LifeBuoy />, onClick: () => nav(`/service/tickets?customer=${c.id}`), hidden: !can(P.ServiceManage) || c.isWalkIn },
            { label: 'Edit details', icon: <Pencil />, onClick: () => setEdit(true), hidden: !can(P.CustomerManage) || c.isWalkIn },
          ]} />
        </>} />

      <section className="kpi-row" aria-label="Customer summary">
        <Kpi loading={!s} label="Total purchases" value={money(s?.totalPurchases, { decimals: false })} foot={s && <span>{s.invoiceCount} invoices{s.totalReturns > 0 ? ` · ${money(s.totalReturns, { decimals: false })} returned` : ''}</span>} />
        <Kpi loading={!s} label="Paid" value={money(s?.totalPaid, { decimals: false })} />
        <Kpi loading={!s} label="Outstanding" value={money(s?.outstanding, { decimals: false })} tone={s && s.outstanding > 0 ? 'warn' : undefined}
          foot={c.creditLimit > 0 ? <span>Credit limit {money(c.creditLimit, { decimals: false })}</span> : undefined} />
        <Kpi loading={!s} label="Advance held" value={money(s?.advanceAmount, { decimals: false })} foot={<span>Applied to the next invoice</span>} />
        <Kpi loading={!s} label="Open orders" value={s ? s.openOrderCount + s.customOrderCount : 0} foot={s && <span>{s.customOrderCount} custom</span>} />
      </section>

      <Tabs value={tab} onChange={setTab} label="Customer sections" tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'invoices', label: 'Invoices', hidden: !can(P.InvoiceView) },
        { value: 'payments', label: 'Payments', hidden: !can(P.PaymentView) }, { value: 'orders', label: 'Orders', hidden: !can(P.SalesOrderView, P.CustomOrderView) },
        { value: 'deliveries', label: 'Deliveries', hidden: !can(P.DeliveryView) }, { value: 'returns', label: 'Returns', hidden: !can(P.ReturnView) },
        { value: 'service', label: 'Warranty & service', hidden: !can(P.WarrantyView, P.ServiceView) }, { value: 'followups', label: 'Follow-ups', hidden: !can(P.LeadView, P.CustomerView) },
        { value: 'ledger', label: 'Ledger' },
      ]} />

      {tab === 'overview' && <Overview customer={c} />}
      {tab === 'invoices' && <InvoicesTab customerId={cid} />}
      {tab === 'payments' && <PaymentsTab customerId={cid} />}
      {tab === 'orders' && <OrdersTab customerId={cid} />}
      {tab === 'deliveries' && <DeliveriesTab customerId={cid} />}
      {tab === 'returns' && <ReturnsTab customerId={cid} />}
      {tab === 'service' && <ServiceTab customerId={cid} />}
      {tab === 'followups' && <FollowUpsTab customerId={cid} />}
      {tab === 'ledger' && <LedgerTab customerId={cid} />}

      <CustomerDrawer open={edit} customer={c} onClose={() => setEdit(false)} />
      {pay && <PaymentDialog open onClose={() => setPay(false)} customerId={c.id} customerName={c.name} />}
      {refund && s && <RefundDialog open onClose={() => setRefund(false)} customerId={c.id} max={s.advanceAmount} />}
      <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/customers/${c.id}/reminder`} />
    </div>
  );
}

function Overview({ customer: c }: { customer: Customer }) {
  const nav = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ['timeline', c.id], queryFn: () => api.get<{ at: string; kind: string; id: number; title: string; detail?: string; amount?: number; status?: string }[]>(`/api/customers/${c.id}/timeline`) });
  return (
    <div className="dash-grid">
      <Card title="Transaction timeline" sub="Everything with this customer, newest first">
        {isLoading ? <SkeletonRows rows={5} cols={3} /> : data.length === 0 ? <EmptyState compact title="No transactions yet" /> : (
          <Timeline items={data.map(t => {
            const Icon = KIND_ICON[t.kind] ?? Receipt;
            const route = KIND_ROUTE[t.kind];
            return {
              key: `${t.kind}-${t.id}`, tone: t.kind === 'PAYMENT' ? 'ok' : t.kind === 'REFUND' || t.kind === 'RETURN' ? 'warn' : toneOf(t.status) === 'bad' ? 'bad' : 'brand', icon: <Icon />,
              title: <span className="row gap-2">{route ? <button className="link-button" onClick={() => nav(route + t.id)}>{t.title}</button> : t.title}{t.status && <Status value={t.status} />}</span>,
              time: relative(t.at),
              detail: <span className="row between gap-3"><span className="truncate">{t.detail}</span>{t.amount !== undefined && t.amount !== null && <Money value={t.amount} strong />}</span>,
            };
          })} />
        )}
      </Card>
      <Card title="Details">
        <dl className="kv">
          <dt>Address</dt><dd>{[c.billingAddress, c.city, c.state, c.pincode].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Place of supply</dt><dd>{c.state ?? 'Same as shop'}</dd>
          <dt>Customer since</dt><dd>{date(c.createdAt)}</dd>
          <dt>Credit limit</dt><dd>{c.creditLimit > 0 ? money(c.creditLimit) : 'No limit'}</dd>
          {c.notes && <><dt>Notes</dt><dd>{c.notes}</dd></>}
        </dl>
      </Card>
    </div>
  );
}

function useCustomerList<T>(key: string, url: string, customerId: number, extra: Record<string, string | number | boolean> = {}) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: [key, 'customer', customerId, page, extra], queryFn: () => api.get<Paged<T>>(url, { customerId, page, pageSize: 25, ...extra }) });
  return { rows: q.data?.items, total: q.data?.totalCount, loading: q.isFetching, error: q.error, page, pageSize: 25, onPage: setPage };
}

function InvoicesTab({ customerId }: { customerId: number }) {
  const nav = useNavigate();
  const p = useCustomerList<InvoiceRow>('invoices', '/api/invoices', customerId);
  const cols: Column<InvoiceRow>[] = [
    { key: 'n', header: 'Invoice', fixed: true, mobile: 'title', render: r => <DocNo>{r.displayNumber}</DocNo> },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.invoiceDate) },
    { key: 't', header: 'Total', num: true, mobile: 'right', render: r => <Money value={r.grandTotal} /> },
    { key: 'b', header: 'Balance', num: true, render: r => (r.balance > 0 ? <Money value={r.balance} strong /> : '—') },
    { key: 's', header: 'Status', mobile: 'meta', render: r => <Status value={r.paymentState} /> },
  ];
  return <DataTable id="cust-inv" columns={cols} rowKey={r => r.id} {...p} onRowClick={r => nav(`/sales/invoices/${r.id}`)} empty={<EmptyState compact icon={<Receipt />} title="No invoices yet" />} />;
}

function PaymentsTab({ customerId }: { customerId: number }) {
  const p = useCustomerList<Payment>('payments', '/api/payments', customerId);
  const cols: Column<Payment>[] = [
    { key: 'n', header: 'Receipt', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.paymentDate) },
    { key: 'm', header: 'Method', mobile: 'meta', render: r => r.methods },
    { key: 'a', header: 'Applied to', render: r => <span className="text-sm soft">{r.appliedTo}</span> },
    { key: 's', header: '', render: r => (r.isVoided ? <Status value="VOIDED" /> : r.direction === 'OUT' ? <Status value="REFUND" /> : null) },
    { key: 'v', header: 'Amount', num: true, mobile: 'right', render: r => <Money value={r.direction === 'OUT' ? -r.amount : r.amount} strong /> },
  ];
  return <DataTable id="cust-pay" columns={cols} rowKey={r => r.id} {...p} empty={<EmptyState compact icon={<Wallet />} title="No payments yet" />} />;
}

function OrdersTab({ customerId }: { customerId: number }) {
  const nav = useNavigate();
  const can = useCan();
  const so = useQuery({ queryKey: ['sales-orders', 'customer', customerId], queryFn: () => api.get<Paged<SalesOrder>>('/api/sales-orders', { customerId, pageSize: 50 }), enabled: can(P.SalesOrderView) });
  const co = useQuery({ queryKey: ['custom-orders', 'customer', customerId], queryFn: () => api.get<Paged<CustomOrder>>('/api/custom-orders', { customerId, pageSize: 50 }), enabled: can(P.CustomOrderView) });
  return (
    <div className="stack gap-4">
      <DataTable id="cust-so" label="Sales orders" rows={so.data?.items} loading={so.isLoading} rowKey={r => r.id} onRowClick={r => nav(`/sales/orders/${r.id}`)}
        empty={<EmptyState compact title="No sales orders" />}
        columns={[
          { key: 'n', header: 'Sales order', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
          { key: 'd', header: 'Date', render: r => date(r.date) },
          { key: 'v', header: 'Value', num: true, mobile: 'right', render: r => <Money value={r.grandTotal} /> },
          { key: 'a', header: 'Advance', num: true, render: r => <Money value={r.advancePaid} /> },
          { key: 's', header: 'Status', mobile: 'meta', render: r => <Status value={r.status} /> },
        ]} />
      <DataTable id="cust-co" label="Custom orders" rows={co.data?.items} loading={co.isLoading} rowKey={r => r.id} onRowClick={r => nav(`/custom-orders/${r.id}`)}
        empty={<EmptyState compact title="No custom orders" />}
        columns={[
          { key: 'n', header: 'Custom order', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
          { key: 'p', header: 'Furniture', mobile: 'sub', render: r => r.productType },
          { key: 'e', header: 'Expected', render: r => date(r.expectedCompletionDate) },
          { key: 'v', header: 'Price', num: true, mobile: 'right', render: r => <Money value={r.finalPrice || r.estimatedCost} /> },
          { key: 's', header: 'Stage', mobile: 'meta', render: r => <Status value={r.status} /> },
        ]} />
    </div>
  );
}

function DeliveriesTab({ customerId }: { customerId: number }) {
  const nav = useNavigate();
  const p = useCustomerList<Delivery>('deliveries', '/api/deliveries', customerId);
  return <DataTable id="cust-del" rowKey={r => r.id} {...p} onRowClick={r => nav(`/delivery/all?open=${r.id}`)} empty={<EmptyState compact icon={<Truck />} title="No deliveries" />}
    columns={[
      { key: 'n', header: 'Delivery', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
      { key: 'f', header: 'For', render: r => <span className="doc-no">{r.sourceNumber}</span> },
      { key: 'd', header: 'Scheduled', mobile: 'meta', render: r => (r.scheduledDate ? `${date(r.scheduledDate)} ${r.timeSlot ?? ''}` : '—') },
      { key: 'i', header: 'Items', render: r => <span className="text-sm soft">{r.itemsSummary}</span> },
      { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} /> },
    ]} />;
}

function ReturnsTab({ customerId }: { customerId: number }) {
  const p = useCustomerList<SalesReturn>('returns', '/api/returns', customerId);
  return <DataTable id="cust-ret" rowKey={r => r.id} {...p} empty={<EmptyState compact icon={<ArrowLeftRight />} title="No returns" />}
    columns={[
      { key: 'n', header: 'Return', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
      { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.returnDate) },
      { key: 'i', header: 'Invoice', render: r => <DocNo to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNumber}</DocNo> },
      { key: 'r', header: 'Reason', render: r => label(r.reason) },
      { key: 'c', header: 'Credit', num: true, mobile: 'right', render: r => <Money value={r.creditAmount} /> },
    ]} />;
}

function LedgerTab({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['ledger', customerId], queryFn: () => api.get<LedgerEntry[]>(`/api/customers/${customerId}/ledger`) });
  return (
    <div className="stack gap-2">
      <div className="row end"><Link className="btn btn-sm" to={`/customers/ledger?customer=${customerId}`}>Open in ledger view (filter, print, export)</Link></div>
      <LedgerTable entries={data} loading={isLoading} />
      <p className="text-xs muted">Updated {dateTime(new Date())}</p>
    </div>
  );
}

function ServiceTab({ customerId }: { customerId: number }) {
  const nav = useNavigate();
  const w = useCustomerList<WarrantyRecord>('warranties', '/api/warranties', customerId);
  const t = useCustomerList<ServiceTicket>('service', '/api/service', customerId);
  return (
    <div className="stack gap-4">
      <DataTable id="cust-war" label="Warranties" rowKey={r => r.id} {...w} onRowClick={r => nav(`/service/warranties?open=${r.id}`)} empty={<EmptyState compact icon={<ShieldCheck />} title="No warranties" />}
        columns={[
          { key: 'n', header: 'Warranty', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
          { key: 'p', header: 'Product', mobile: 'sub', render: r => <>{r.productName}{r.serialNo && <span className="mono text-xs muted"> · {r.serialNo}</span>}</> },
          { key: 'e', header: 'Valid until', mobile: 'meta', render: r => date(r.endDate) },
          { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.state} tone={WARRANTY_TONE[r.state]} text={WARRANTY_LABELS[r.state]} /> },
        ]} />
      <DataTable id="cust-srv" label="Service tickets" rowKey={r => r.id} {...t} onRowClick={r => nav(`/service/tickets?open=${r.id}`)} empty={<EmptyState compact icon={<LifeBuoy />} title="No service tickets" />}
        columns={[
          { key: 'n', header: 'Ticket', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo> },
          { key: 'p', header: 'Product / issue', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span><span className="cell-sub">{r.issue}</span></div> },
          { key: 'd', header: 'Opened', mobile: 'meta', render: r => date(r.createdAt) },
          { key: 's', header: 'Status', mobile: 'right', render: r => <Status value={r.status} text={SERVICE_LABELS[r.status]} /> },
        ]} />
    </div>
  );
}

function FollowUpsTab({ customerId }: { customerId: number }) {
  const can = useCan();
  const qc = useQueryClient();
  const [add, setAdd] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ['follow-ups', 'customer', customerId], queryFn: () => api.get<FollowUp[]>('/api/follow-ups', { scope: 'all', customerId }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['follow-ups'] });
  return (
    <Card title="Follow-ups" actions={can(P.CustomerManage) && <button className="btn btn-sm" onClick={() => setAdd(true)}><Plus aria-hidden />Add</button>}>
      {isLoading ? <SkeletonRows rows={3} /> : <FollowUpList items={data} compact onChanged={refresh} />}
      {add && <AddFollowUpModal refType="CUSTOMER" refId={customerId} defaultTitle="Call about new requirement" onClose={() => setAdd(false)} onDone={refresh} />}
    </Card>
  );
}
