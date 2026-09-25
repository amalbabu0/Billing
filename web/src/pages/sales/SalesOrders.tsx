import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, ExternalLink, Plus, Printer } from 'lucide-react';
import { openPdf } from '@/lib/api';
import { date, daysFromToday } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { SalesOrder } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

export default function SalesOrders() {
  const can = useCan();
  const nav = useNavigate();
  const list = usePagedList<SalesOrder>('sales-orders', '/api/sales-orders', { filterKeys: ['status', 'open'] });
  const { state, update } = list;
  const columns: Column<SalesOrder>[] = [
    { key: 'number', header: 'Order', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.date), exportValue: r => date(r.date) },
    { key: 'customer', header: 'Customer', mobile: 'sub', render: r => <span className="cell-title">{r.customerName}</span>, exportValue: r => r.customerName },
    {
      key: 'delivery', header: 'Delivery by', mobile: 'meta', render: r => {
        const d = daysFromToday(r.expectedDeliveryDate);
        const late = d !== null && d < 0 && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(r.status);
        return r.expectedDeliveryDate ? <span className={late ? 't-bad' : ''}>{date(r.expectedDeliveryDate)}{late ? ` · ${-d!}d late` : ''}</span> : <span className="muted">—</span>;
      }, exportValue: r => date(r.expectedDeliveryDate),
    },
    { key: 'total', header: 'Value', num: true, money: true, mobile: 'right', render: r => <Money value={r.grandTotal} />, exportValue: r => r.grandTotal },
    { key: 'advance', header: 'Advance', num: true, money: true, render: r => r.advancePaid > 0 ? <Money value={r.advancePaid} className="t-ok" /> : <span className="muted">—</span>, exportValue: r => r.advancePaid },
    { key: 'balance', header: 'Balance', num: true, money: true, render: r => <Money value={r.grandTotal - r.advancePaid} strong />, exportValue: r => r.grandTotal - r.advancePaid },
    { key: 'status', header: 'Status', mobile: 'meta', render: r => <Status value={r.status} />, exportValue: r => r.status },
    { key: 'invoice', header: 'Invoice', optional: true, render: r => r.invoiceNumber ? <DocNo to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNumber}</DocNo> : '—', exportValue: r => r.invoiceNumber },
  ];
  const view = state.filters.open === 'true' ? 'open' : state.filters.status ?? '';
  return (
    <div className="page">
      <PageHeader title="Sales orders" desc="Confirmed orders with advances, reserved stock and delivery dates. Generate the invoice when the balance is settled or goods leave."
        actions={can(P.SalesOrderManage) && <Link className="btn btn-primary" to="/sales/orders/new"><Plus aria-hidden />New sales order</Link>} />
      <DataTable id="sales-orders" label="Sales orders" columns={columns} rowKey={r => r.id} {...list.tableProps}
        onRowClick={r => nav(`/sales/orders/${r.id}`)}
        rowActions={r => [
          { label: 'Open', icon: <ExternalLink />, onClick: () => nav(`/sales/orders/${r.id}`) },
          { label: 'Print order', icon: <Printer />, onClick: () => void openPdf(`/api/sales-orders/${r.id}/pdf`) },
        ]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Order no. or customer" />
          <Segmented value={view} label="Status" onChange={v => update({ filters: v === 'open' ? { open: 'true', status: undefined } : { open: undefined, status: v || undefined } })} options={[
            { value: '', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'DRAFT', label: 'Draft' }, { value: 'READY', label: 'Ready' },
            { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' },
          ]} />
        </>}
        empty={<EmptyState icon={<ClipboardList />} title="No sales orders" desc="Book an order with an advance when a customer commits." action={can(P.SalesOrderManage) && <Link className="btn btn-primary" to="/sales/orders/new">Create a sales order</Link>} />}
        exportAs={{ title: 'Sales orders', fetchAll: list.fetchAll }} />
    </div>
  );
}
