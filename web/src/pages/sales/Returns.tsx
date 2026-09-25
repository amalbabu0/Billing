import { Link } from 'react-router-dom';
import { Plus, RotateCcw } from 'lucide-react';
import { date, label } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { SalesReturn } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

export default function Returns() {
  const can = useCan();
  const list = usePagedList<SalesReturn>('returns', '/api/returns', { filterKeys: ['from', 'to'] });
  const { state, update } = list;
  const columns: Column<SalesReturn>[] = [
    { key: 'number', header: 'Return', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.returnDate), exportValue: r => date(r.returnDate) },
    { key: 'invoice', header: 'Invoice', render: r => <DocNo to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNumber}</DocNo>, exportValue: r => r.invoiceNumber },
    { key: 'customer', header: 'Customer', mobile: 'sub', render: r => <Link to={`/customers/${r.customerId}`}>{r.customerName}</Link>, exportValue: r => r.customerName },
    { key: 'reason', header: 'Reason', mobile: 'meta', render: r => label(r.reason), exportValue: r => label(r.reason) },
    { key: 'credit', header: 'Credit note', num: true, money: true, mobile: 'right', render: r => <Money value={r.creditAmount} />, exportValue: r => r.creditAmount },
    { key: 'refund', header: 'Refunded', num: true, money: true, render: r => (r.refundAmount > 0 ? <Money value={r.refundAmount} /> : <span className="muted">—</span>), exportValue: r => r.refundAmount },
    { key: 'type', header: 'Type', render: r => (r.exchangeId ? <span className="badge tone-info">Exchange</span> : <span className="badge">Return</span>), exportValue: r => (r.exchangeId ? 'Exchange' : 'Return') },
  ];
  return (
    <div className="page">
      <PageHeader title="Sales returns" desc="Items taken back, with the stock movement and GST credit note each one created."
        actions={can(P.ReturnManage) && <Link className="btn btn-primary" to="/sales/returns/new"><Plus aria-hidden />New return</Link>} />
      <DataTable id="returns" label="Sales returns" columns={columns} rowKey={r => r.id} {...list.tableProps}
        toolbar={<SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Return no., invoice or customer" />}
        empty={<EmptyState icon={<RotateCcw />} title="No returns" desc="Returns and exchanges recorded against invoices appear here." />}
        exportAs={{ title: 'Sales returns', fetchAll: list.fetchAll }} />
    </div>
  );
}
