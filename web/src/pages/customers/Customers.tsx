import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, IndianRupee, MessageCircle, Pencil, Phone, Receipt, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { date, daysFromToday, money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Customer, CustomerSummary } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Avatar, Badge, EmptyState, KV, Money, PageHeader, Segmented, StatStrip } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { Drawer } from '@/components/ui/overlay';
import { CustomerDrawer } from '@/components/CustomerForm';
import { PaymentDialog } from '@/components/PaymentDialog';
import { WhatsAppDialog } from '@/components/DocActions';

/** Derived CRM status: never stored, always consistent with the ledger. */
export function customerStatus(c: Pick<Customer, 'isWalkIn' | 'outstanding' | 'lastPurchaseDate' | 'totalPurchases'>): { text: string; tone: 'ok' | 'warn' | 'muted' | 'info' | 'brand' } {
  if (c.isWalkIn) return { text: 'Counter sales', tone: 'muted' };
  if (c.outstanding > 0) return { text: 'Balance due', tone: 'warn' };
  if (!c.totalPurchases) return { text: 'New', tone: 'info' };
  const d = daysFromToday(c.lastPurchaseDate);
  if (d !== null && d >= -180) return { text: 'Active', tone: 'ok' };
  return { text: 'Inactive', tone: 'muted' };
}

export default function Customers() {
  const can = useCan();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = usePagedList<Customer>('customers', '/api/customers', { filterKeys: ['outstanding'], defaults: { sortBy: 'recent', sortDescending: true } });
  const { state, update } = list;
  const [edit, setEdit] = useState<{ open: boolean; customer?: Customer | null }>({ open: false });
  const [peek, setPeek] = useState<Customer | null>(null);
  useEffect(() => { if (params.get('new')) { setEdit({ open: true, customer: null }); params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);
  const outstanding = useQuery({ queryKey: ['customers', 'outstanding-total'], queryFn: () => api.get<{ balance: number; overdue: number; count: number }>('/api/invoices/summary') });

  const columns: Column<Customer>[] = [
    {
      key: 'name', header: 'Customer', sort: 'name', fixed: true, mobile: 'title',
      render: r => <div className="row gap-3"><Avatar name={r.name} size="sm" /><div className="cell-stack"><span className="cell-title">{r.name}</span><span className="cell-sub mono">{r.code}</span></div></div>,
      exportValue: r => r.name,
    },
    { key: 'mobile', header: 'Mobile', mobile: 'sub', render: r => r.mobile ?? <span className="muted">—</span>, exportValue: r => r.mobile },
    { key: 'city', header: 'City', mobile: 'meta', render: r => r.city ?? '—', exportValue: r => r.city },
    { key: 'gstin', header: 'GSTIN', optional: true, render: r => (r.gstin ? <span className="mono text-sm">{r.gstin}</span> : '—'), exportValue: r => r.gstin },
    { key: 'purchases', header: 'Purchases', sort: 'purchases', num: true, money: true, render: r => <Money value={r.totalPurchases} decimals={false} />, exportValue: r => r.totalPurchases },
    { key: 'outstanding', header: 'Outstanding', sort: 'outstanding', num: true, money: true, mobile: 'right', render: r => (r.outstanding > 0 ? <Money value={r.outstanding} strong className="t-warn" /> : <span className="muted">—</span>), exportValue: r => r.outstanding },
    { key: 'last', header: 'Last purchase', sort: 'recent', mobile: 'meta', render: r => (r.lastPurchaseDate ? date(r.lastPurchaseDate) : <span className="muted">Never</span>), exportValue: r => date(r.lastPurchaseDate) },
    { key: 'status', header: 'Status', render: r => { const s = customerStatus(r); return <Badge tone={s.tone}>{s.text}</Badge>; }, exportValue: r => customerStatus(r).text },
  ];

  return (
    <div className="page">
      <PageHeader title="Customers" desc="Everyone who has bought, ordered or asked for a quote — with what they owe at a glance."
        actions={can(P.CustomerManage) && <button className="btn btn-primary" onClick={() => setEdit({ open: true, customer: null })}><UserPlus aria-hidden />Add customer</button>} />
      <StatStrip loading={list.query.isLoading || outstanding.isLoading} items={[
        { label: 'Customers', value: list.query.data?.totalCount ?? '—' },
        { label: 'Total outstanding', value: money(outstanding.data?.balance, { decimals: false }), tone: outstanding.data?.balance ? 'warn' : undefined },
        { label: 'Overdue', value: money(outstanding.data?.overdue, { decimals: false }), tone: outstanding.data?.overdue ? 'bad' : undefined },
      ]} />
      <DataTable id="customers" label="Customers" columns={columns} rowKey={r => r.id} {...list.tableProps}
        onRowClick={r => setPeek(r)}
        rowActions={r => [
          { label: 'Open profile', icon: <ExternalLink />, onClick: () => nav(`/customers/${r.id}`) },
          { label: 'New invoice', icon: <Receipt />, onClick: () => nav('/pos'), hidden: !can(P.InvoiceCreate) },
          { label: 'New quotation', icon: <FilePlus2 />, onClick: () => nav(`/sales/quotations/new?customerId=${r.id}`), hidden: !can(P.QuotationManage) },
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit({ open: true, customer: r }), hidden: !can(P.CustomerManage) || r.isWalkIn },
        ]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Name, mobile, GSTIN, city or code" />
          <Segmented value={state.filters.outstanding ? 'due' : 'all'} onChange={v => update({ filters: { outstanding: v === 'due' ? 'true' : undefined } })} label="Filter"
            options={[{ value: 'all', label: 'All' }, { value: 'due', label: 'With balance due' }]} />
        </>}
        empty={state.search ? <EmptyState icon={<Users />} title="No customers match" desc="Check the spelling, or search by mobile number." />
          : <EmptyState icon={<Users />} title="No customers yet" desc="Add customers here or while billing." action={can(P.CustomerManage) && <button className="btn btn-primary" onClick={() => setEdit({ open: true, customer: null })}>Add your first customer</button>} />}
        exportAs={{ title: 'Customers', fetchAll: list.fetchAll }} />
      <CustomerDrawer open={edit.open} customer={edit.customer} onClose={() => setEdit({ open: false })} onSaved={c => !edit.customer && nav(`/customers/${c.id}`)} />
      <CustomerPeek customer={peek} onClose={() => setPeek(null)} />
    </div>
  );
}

function CustomerPeek({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const can = useCan();
  const nav = useNavigate();
  const [pay, setPay] = useState(false);
  const [wa, setWa] = useState(false);
  const { data: s } = useQuery({ queryKey: ['customer-summary', customer?.id], queryFn: () => api.get<CustomerSummary>(`/api/customers/${customer!.id}/summary`), enabled: !!customer && !customer.isWalkIn });
  const c = customer;
  const st = c ? customerStatus(c) : null;
  return (
    <Drawer open={!!c} onClose={onClose} title={c?.name ?? ''} sub={c && [c.code, c.city].filter(Boolean).join(' · ')} headerExtra={st && <Badge tone={st.tone}>{st.text}</Badge>}
      footer={c && <>
        <button className="btn btn-primary" onClick={() => nav(`/customers/${c.id}`)}>Open profile</button>
        {can(P.PaymentReceive) && (s?.outstanding ?? 0) > 0 && <button className="btn" onClick={() => setPay(true)}><IndianRupee aria-hidden />Receive</button>}
        {(s?.outstanding ?? 0) > 0 && <button className="btn" onClick={() => setWa(true)}><MessageCircle aria-hidden />Reminder</button>}
      </>}>
      {c && (
        <div className="stack gap-5">
          <div className="grid grid-2">
            <div className="kpi"><span className="kpi-label">Purchases</span><span className="kpi-value sm">{money(s?.totalPurchases ?? c.totalPurchases, { decimals: false })}</span></div>
            <div className={`kpi${(s?.outstanding ?? 0) > 0 ? ' tone-warn' : ''}`}><span className="kpi-label">Outstanding</span><span className="kpi-value sm">{money(s?.outstanding ?? c.outstanding, { decimals: false })}</span></div>
          </div>
          <KV items={[
            ['Mobile', c.mobile ? <a href={`tel:${c.mobile}`} className="row gap-1" style={{ display: 'inline-flex' }}><Phone aria-hidden style={{ width: 13 }} />{c.mobile}</a> : null],
            c.gstin ? ['GSTIN', <span className="mono">{c.gstin}</span>] : null,
            ['Address', [c.billingAddress, c.city, c.state, c.pincode].filter(Boolean).join(', ') || null],
            ['Advance held', money(s?.advanceAmount ?? 0)],
            ['Invoices', s?.invoiceCount ?? '—'],
            ['Open orders', s ? s.openOrderCount + s.customOrderCount : '—'],
            ['Last purchase', c.lastPurchaseDate ? date(c.lastPurchaseDate) : 'Never'],
          ]} />
          <Link to={`/customers/${c.id}?tab=ledger`} className="btn btn-link">View full ledger →</Link>
        </div>
      )}
      {c && pay && <PaymentDialog open onClose={() => setPay(false)} customerId={c.id} customerName={c.name} />}
      {c && <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/customers/${c.id}/reminder`} />}
    </Drawer>
  );
}
