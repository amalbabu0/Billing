import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import type { Customer, LedgerEntry } from '@/lib/types';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, PageHeader, StatStrip } from '@/components/ui/display';
import { CustomerPicker } from '@/components/pickers';

const ROUTE: Record<string, string> = { INVOICE: '/sales/invoices/', SALES_ORDER: '/sales/orders/', CUSTOM_ORDER: '/custom-orders/' };

export function LedgerTable({ entries, loading, exportTitle, party = 'customer' }: { entries?: LedgerEntry[]; loading?: boolean; exportTitle?: string; party?: 'customer' | 'supplier' }) {
  const cols: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.date), exportValue: r => date(r.date) },
    { key: 'doc', header: 'Document', fixed: true, mobile: 'title', render: r => <span className="row gap-2"><span className="badge plain">{label(r.docType)}</span>{ROUTE[r.docType] ? <DocNo to={ROUTE[r.docType] + r.docId}>{r.docNumber}</DocNo> : <DocNo>{r.docNumber}</DocNo>}</span>, exportValue: r => `${label(r.docType)} ${r.docNumber}` },
    { key: 'part', header: 'Particulars', mobile: 'sub', render: r => <span className="text-sm soft">{r.particulars}</span>, exportValue: r => r.particulars },
    { key: 'dr', header: party === 'customer' ? 'Debit (billed)' : 'Debit (paid / returned)', num: true, money: true, render: r => (r.debit ? <span className="money">{money(r.debit)}</span> : ''), exportValue: r => r.debit || null },
    { key: 'cr', header: party === 'customer' ? 'Credit (received)' : 'Credit (purchased)', num: true, money: true, render: r => (r.credit ? <span className="money t-ok">{money(r.credit)}</span> : ''), exportValue: r => r.credit || null },
    { key: 'bal', header: 'Balance', num: true, money: true, mobile: 'right', render: r => <b className={`money ${r.balance > 0 ? 't-warn' : r.balance < 0 ? 't-info' : ''}`}>{money(r.balance)}</b>, exportValue: r => r.balance },
  ];
  return (
    <DataTable id={`ledger-${party}`} label="Ledger" columns={cols} rows={entries} loading={loading} rowKey={r => `${r.docType}-${r.docId}-${r.createdAt}`} compact
      empty={<EmptyState compact icon={<BookOpen />} title="No entries in this period" />}
      exportAs={exportTitle ? { title: exportTitle, fetchAll: async () => entries ?? [] } : undefined} />
  );
}

export default function CustomerLedger() {
  const [params, setParams] = useSearchParams();
  const id = params.get('customer');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const customer = useQuery({ queryKey: ['customer', Number(id)], queryFn: () => api.get<Customer>(`/api/customers/${id}`), enabled: !!id });
  const ledger = useQuery({ queryKey: ['ledger', Number(id), from, to], queryFn: () => api.get<LedgerEntry[]>(`/api/customers/${id}/ledger`, { from, to }), enabled: !!id });
  const rows = ledger.data ?? [];
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  return (
    <div className="page">
      <PageHeader title="Customer ledger" desc="Every invoice, payment, return and advance with a running balance. Positive balance = customer owes the shop." />
      <div className="card card-pad">
        <div className="row wrap gap-4" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
            <CustomerPicker value={customer.data ?? null} onChange={c => setParams(c ? { customer: String(c.id) } : {})} />
          </div>
          <label className="field"><span className="field-label">From</span><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field"><span className="field-label">To</span><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></label>
          {customer.data && <Link className="btn" to={`/customers/${customer.data.id}`}>Open profile</Link>}
        </div>
      </div>
      {!id ? <EmptyState icon={<BookOpen />} title="Choose a customer" desc="Search by name, mobile or GSTIN to see their statement." /> : (
        <>
          <StatStrip loading={ledger.isLoading} items={[
            { label: 'Billed', value: money(debit) }, { label: 'Received & credited', value: money(credit), tone: 'ok' },
            { label: closing >= 0 ? 'Closing balance (due)' : 'Closing balance (advance)', value: money(Math.abs(closing)), tone: closing > 0 ? 'warn' : undefined },
          ]} />
          <LedgerTable entries={ledger.data} loading={ledger.isFetching} exportTitle={`Ledger ${customer.data?.name ?? ''}`} />
        </>
      )}
    </div>
  );
}
