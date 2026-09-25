import { Link } from 'react-router-dom';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { date } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Exchange } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

export default function Exchanges() {
  const can = useCan();
  const list = usePagedList<Exchange>('exchanges', '/api/exchanges');
  const { state, update } = list;
  const columns: Column<Exchange>[] = [
    { key: 'number', header: 'Exchange', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.createdAt), exportValue: r => date(r.createdAt) },
    { key: 'customer', header: 'Customer', mobile: 'sub', render: r => <Link to={`/customers/${r.customerId}`}>{r.customerName}</Link>, exportValue: r => r.customerName },
    { key: 'from', header: 'Returned from', render: r => <DocNo to={`/sales/invoices/${r.originalInvoiceId}`}>{r.originalInvoiceNumber}</DocNo>, exportValue: r => r.originalInvoiceNumber },
    { key: 'to', header: 'New invoice', render: r => <DocNo to={`/sales/invoices/${r.newInvoiceId}`}>{r.newInvoiceNumber}</DocNo>, exportValue: r => r.newInvoiceNumber },
    { key: 'old', header: 'Returned value', num: true, money: true, render: r => <Money value={r.oldValue} />, exportValue: r => r.oldValue },
    { key: 'new', header: 'New value', num: true, money: true, render: r => <Money value={r.newValue} />, exportValue: r => r.newValue },
    { key: 'diff', header: 'Customer paid', num: true, money: true, mobile: 'right', render: r => <Money value={r.difference} strong />, exportValue: r => r.difference },
  ];
  return (
    <div className="page">
      <PageHeader title="Exchanges" desc="Old pieces returned and new ones billed in one step — the customer pays only the difference."
        actions={can(P.ReturnManage) && <Link className="btn btn-primary" to="/sales/returns/new?exchange=1"><Plus aria-hidden />New exchange</Link>} />
      <DataTable id="exchanges" label="Exchanges" columns={columns} rowKey={r => r.id} {...list.tableProps}
        toolbar={<SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Exchange no., invoice or customer" />}
        empty={<EmptyState icon={<ArrowLeftRight />} title="No exchanges yet" desc="Swap a piece for another from the original invoice." action={can(P.ReturnManage) && <Link className="btn btn-primary" to="/sales/returns/new?exchange=1">Start an exchange</Link>} />}
        exportAs={{ title: 'Exchanges', fetchAll: list.fetchAll }} />
    </div>
  );
}
