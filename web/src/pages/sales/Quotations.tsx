import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightCircle, ExternalLink, FilePlus2, FileText, Pencil, Printer } from 'lucide-react';
import { date, daysFromToday } from '@/lib/format';
import { openPdf } from '@/lib/api';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Quotation } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

export default function Quotations() {
  const can = useCan();
  const nav = useNavigate();
  const list = usePagedList<Quotation>('quotations', '/api/quotations', { filterKeys: ['status'] });
  const { state, update } = list;
  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Quotation', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', mobile: 'meta', render: r => date(r.date), exportValue: r => date(r.date) },
    { key: 'customer', header: 'Customer', mobile: 'sub', render: r => <span className="cell-title">{r.customerName}</span>, exportValue: r => r.customerName },
    { key: 'total', header: 'Value', num: true, money: true, mobile: 'right', render: r => <Money value={r.grandTotal} />, exportValue: r => r.grandTotal },
    {
      key: 'valid', header: 'Valid until', mobile: 'meta', render: r => {
        const d = daysFromToday(r.validUntil);
        const open = ['DRAFT', 'SENT', 'CONFIRMED'].includes(r.status);
        return <span className={open && d !== null && d < 0 ? 't-bad' : open && d !== null && d <= 3 ? 't-warn' : ''}>{date(r.validUntil)}{open && d !== null && d < 0 ? ' · expired' : ''}</span>;
      }, exportValue: r => date(r.validUntil),
    },
    { key: 'status', header: 'Status', mobile: 'meta', render: r => <Status value={r.status} />, exportValue: r => r.status },
    { key: 'order', header: 'Order', render: r => r.salesOrderNumber ? <DocNo to={`/sales/orders/${r.salesOrderId}`}>{r.salesOrderNumber}</DocNo> : <span className="muted">—</span>, exportValue: r => r.salesOrderNumber },
  ];
  return (
    <div className="page">
      <PageHeader title="Quotations" desc="Price offers sent to customers. Convert an accepted quotation into a sales order in one step — references carry through to the invoice."
        actions={can(P.QuotationManage) && <Link className="btn btn-primary" to="/sales/quotations/new"><FilePlus2 aria-hidden />New quotation</Link>} />
      <DataTable id="quotations" label="Quotations" columns={columns} rowKey={r => r.id} {...list.tableProps}
        onRowClick={r => nav(`/sales/quotations/${r.id}`)}
        rowActions={r => [
          { label: 'Open', icon: <ExternalLink />, onClick: () => nav(`/sales/quotations/${r.id}`) },
          { label: 'Edit', icon: <Pencil />, onClick: () => nav(`/sales/quotations/${r.id}/edit`), hidden: r.status !== 'DRAFT' || !can(P.QuotationManage) },
          { label: 'Print', icon: <Printer />, onClick: () => void openPdf(`/api/quotations/${r.id}/pdf`) },
          { label: 'Convert to order', icon: <ArrowRightCircle />, onClick: () => nav(`/sales/quotations/${r.id}?convert=1`), hidden: !['DRAFT', 'SENT', 'CONFIRMED'].includes(r.status) || !can(P.SalesOrderManage) },
        ]}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Quotation no. or customer" />
          <Segmented value={state.filters.status ?? ''} onChange={v => update({ filters: { status: v || undefined } })} label="Status" options={[
            { value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SENT', label: 'Sent' }, { value: 'CONFIRMED', label: 'Accepted' },
            { value: 'CONVERTED', label: 'Converted' }, { value: 'REJECTED', label: 'Rejected' },
          ]} />
        </>}
        empty={<EmptyState icon={<FileText />} title="No quotations yet" desc="Send a price offer and follow it up to an order." action={can(P.QuotationManage) && <Link className="btn btn-primary" to="/sales/quotations/new">Create a quotation</Link>} />}
        exportAs={{ title: 'Quotations', fetchAll: list.fetchAll }} />
    </div>
  );
}
