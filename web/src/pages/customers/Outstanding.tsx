import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, IndianRupee, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { InvoiceRow, Paged } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { PaymentDialog } from '@/components/PaymentDialog';
import { WhatsAppDialog } from '@/components/DocActions';
import { VIZ } from '@/components/Charts';

const BUCKETS = [
  { key: 'current', label: 'Not yet due', test: (d: number) => d <= 0 },
  { key: 'b30', label: '1–30 days', test: (d: number) => d > 0 && d <= 30 },
  { key: 'b60', label: '31–60 days', test: (d: number) => d > 30 && d <= 60 },
  { key: 'b90', label: '61–90 days', test: (d: number) => d > 60 && d <= 90 },
  { key: 'b90p', label: '90+ days', test: (d: number) => d > 90 },
];

interface CustomerDue { customerId: number; customerName: string; mobile?: string; invoices: number; balance: number; oldestDays: number; oldestDue?: string }

export default function Outstanding() {
  const can = useCan();
  const nav = useNavigate();
  const [view, setView] = useState<'invoice' | 'customer'>('customer');
  const [bucket, setBucket] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pay, setPay] = useState<{ customerId: number; name: string; invoice?: InvoiceRow } | null>(null);
  const [remind, setRemind] = useState<{ url: string } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['invoices', 'outstanding-all'],
    queryFn: () => api.get<Paged<InvoiceRow>>('/api/invoices', { paymentState: 'OUTSTANDING', pageSize: 500, sortBy: 'due', sortDescending: false }),
  });
  const rows = useMemo(() => (data?.items ?? []).filter(r => !search || r.customerName.toLowerCase().includes(search.toLowerCase()) || (r.number ?? '').toLowerCase().includes(search.toLowerCase()) || (r.customerMobile ?? '').includes(search)), [data, search]);
  const totals = BUCKETS.map(b => ({ ...b, amount: rows.filter(r => b.test(r.daysOverdue)).reduce((s, r) => s + r.balance, 0) }));
  const inBucket = bucket ? rows.filter(r => BUCKETS.find(b => b.key === bucket)!.test(r.daysOverdue)) : rows;
  const byCustomer = useMemo(() => {
    const m = new Map<number, CustomerDue>();
    for (const r of inBucket) {
      const c = m.get(r.customerId) ?? { customerId: r.customerId, customerName: r.customerName, mobile: r.customerMobile, invoices: 0, balance: 0, oldestDays: 0 };
      c.invoices++; c.balance += r.balance;
      if (r.daysOverdue >= c.oldestDays) { c.oldestDays = r.daysOverdue; c.oldestDue = r.dueDate; }
      m.set(r.customerId, c);
    }
    return [...m.values()].sort((a, b) => b.balance - a.balance);
  }, [inBucket]);
  const grand = rows.reduce((s, r) => s + r.balance, 0);

  const invCols: Column<InvoiceRow>[] = [
    { key: 'n', header: 'Invoice', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'c', header: 'Customer', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.customerName}</span><span className="cell-sub">{r.customerMobile}</span></div>, exportValue: r => r.customerName },
    { key: 'd', header: 'Invoice date', render: r => date(r.invoiceDate), exportValue: r => date(r.invoiceDate) },
    { key: 'due', header: 'Due', mobile: 'meta', render: r => <span className={r.daysOverdue > 0 ? 't-bad' : ''}>{date(r.dueDate)}{r.daysOverdue > 0 ? ` · ${r.daysOverdue}d late` : ''}</span>, exportValue: r => date(r.dueDate) },
    { key: 't', header: 'Total', num: true, money: true, render: r => <Money value={r.grandTotal} />, exportValue: r => r.grandTotal },
    { key: 'p', header: 'Paid', num: true, money: true, render: r => <Money value={r.paid} className="soft" />, exportValue: r => r.paid },
    { key: 'b', header: 'Balance', num: true, money: true, mobile: 'right', render: r => <Money value={r.balance} strong />, exportValue: r => r.balance },
    { key: 's', header: 'Status', render: r => <Status value={r.paymentState} />, exportValue: r => r.paymentState },
  ];
  const custCols: Column<CustomerDue>[] = [
    { key: 'c', header: 'Customer', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.customerName}</span><span className="cell-sub">{r.mobile}</span></div>, exportValue: r => r.customerName },
    { key: 'i', header: 'Open invoices', num: true, mobile: 'meta', render: r => r.invoices, exportValue: r => r.invoices },
    { key: 'o', header: 'Oldest due', mobile: 'meta', render: r => <span className={r.oldestDays > 0 ? 't-bad' : ''}>{date(r.oldestDue)}{r.oldestDays > 0 ? ` · ${r.oldestDays}d late` : ''}</span>, exportValue: r => date(r.oldestDue) },
    { key: 'b', header: 'Balance due', num: true, money: true, mobile: 'right', render: r => <Money value={r.balance} strong />, exportValue: r => r.balance },
  ];

  return (
    <div className="page">
      <PageHeader title="Outstanding payments" desc="Who owes what, and for how long. Follow up oldest first; send a WhatsApp reminder or take the payment right here." />
      <StatStrip loading={isLoading} items={[
        { label: 'Total due', value: money(grand, { decimals: false }), tone: grand ? 'warn' : undefined },
        ...totals.map((t, i) => ({ label: t.label, value: money(t.amount, { decimals: false }), dot: i === 0 ? VIZ[0] : undefined, tone: i >= 3 && t.amount > 0 ? 'bad' as const : undefined })),
      ]} />
      <DataTable<InvoiceRow | CustomerDue>
        id={view === 'invoice' ? 'outstanding-inv' : 'outstanding-cust'} label="Outstanding"
        columns={(view === 'invoice' ? invCols : custCols) as Column<InvoiceRow | CustomerDue>[]}
        rows={view === 'invoice' ? inBucket : byCustomer} loading={isLoading} error={error} onRetry={() => void refetch()}
        rowKey={r => ('id' in r ? r.id : r.customerId)}
        onRowClick={r => nav('id' in r ? `/sales/invoices/${r.id}` : `/customers/${r.customerId}?tab=ledger`)}
        rowActions={r => [
          { label: 'Receive payment', icon: <IndianRupee />, hidden: !can(P.PaymentReceive), onClick: () => setPay('id' in r ? { customerId: r.customerId, name: r.customerName, invoice: r } : { customerId: r.customerId, name: r.customerName }) },
          { label: 'Send WhatsApp reminder', icon: <MessageCircle />, onClick: () => setRemind({ url: 'id' in r ? `/api/invoices/${r.id}/whatsapp?reminder=true` : `/api/customers/${r.customerId}/reminder` }) },
          { label: 'Open', icon: <ExternalLink />, onClick: () => nav('id' in r ? `/sales/invoices/${r.id}` : `/customers/${r.customerId}`) },
        ]}
        toolbar={<>
          <SearchInput value={search} onChange={setSearch} placeholder="Customer, mobile or invoice" />
          <Segmented value={view} onChange={setView} label="Group" options={[{ value: 'customer', label: 'By customer' }, { value: 'invoice', label: 'By invoice' }]} />
          <select className="select input-sm" style={{ width: 170 }} value={bucket ?? ''} aria-label="Age" onChange={e => setBucket(e.target.value || null)}>
            <option value="">All ages</option>{BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </>}
        empty={<EmptyState icon={<CheckCircle2 />} title="Nothing outstanding" desc="Every final invoice is fully paid." />}
        exportAs={{ title: view === 'invoice' ? 'Outstanding invoices' : 'Outstanding by customer', fetchAll: async () => (view === 'invoice' ? inBucket : byCustomer) }}
      />
      {pay && <PaymentDialog open onClose={() => setPay(null)} customerId={pay.customerId} customerName={pay.name} docType={pay.invoice ? 'INVOICE' : undefined} docId={pay.invoice?.id} docNumber={pay.invoice?.number} />}
      <WhatsAppDialog open={!!remind} onClose={() => setRemind(null)} url={remind?.url ?? ''} />
    </div>
  );
}
