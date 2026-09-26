import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShoppingBag } from 'lucide-react';
import { date } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Purchase } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

export default function Purchases() {
  const can = useCan();
  const nav = useNavigate();
  const list = usePagedList<Purchase>('purchases', '/api/purchases', { filterKeys: ['status', 'outstanding', 'from', 'to'] });
  const { state, update } = list;
  const view = state.filters.outstanding ? 'due' : state.filters.status ?? '';
  const cols: Column<Purchase>[] = [
    { key: 'n', header: 'Purchase', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.purchaseDate), exportValue: r => date(r.purchaseDate) },
    { key: 's', header: 'Supplier', mobile: 'sub', render: r => <span className="cell-title">{r.supplierName}</span>, exportValue: r => r.supplierName },
    { key: 'b', header: 'Supplier bill', render: r => <span className="mono text-sm">{r.supplierInvoiceNo ?? '—'}</span>, exportValue: r => r.supplierInvoiceNo },
    { key: 't', header: 'Total', num: true, money: true, mobile: 'right', render: r => <Money value={r.grandTotal} />, exportValue: r => r.grandTotal },
    { key: 'bal', header: 'Balance', num: true, money: true, render: r => (r.balance > 0 ? <Money value={r.balance} strong /> : <span className="muted">—</span>), exportValue: r => r.balance },
    { key: 'st', header: 'Status', mobile: 'meta', render: r => <Status value={r.paymentState} />, exportValue: r => r.paymentState },
    { key: 'by', header: 'Entered by', optional: true, render: r => r.createdByName, exportValue: r => r.createdByName },
  ];
  return (
    <div className="page">
      <PageHeader title="Purchase history" desc="Supplier bills. Completed purchases added stock and made the amount payable."
        actions={can(P.PurchaseManage) && <Link className="btn btn-primary" to="/purchases/new"><Plus aria-hidden />New purchase</Link>} />
      <DataTable id="purchases" label="Purchases" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => nav(`/purchases/${r.id}`)}
        rowClass={r => (r.status === 'CANCELLED' ? 'muted-row' : undefined)}
        toolbar={<>
          <SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Purchase no., supplier or bill no." />
          <Segmented value={view} label="Status" onChange={v => update({ filters: v === 'due' ? { outstanding: 'true', status: undefined } : { outstanding: undefined, status: v || undefined } })}
            options={[{ value: '', label: 'All' }, { value: 'due', label: 'Unpaid' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        </>}
        empty={<EmptyState icon={<ShoppingBag />} title="No purchases yet" desc="Record supplier bills to bring stock in." action={can(P.PurchaseManage) && <Link className="btn btn-primary" to="/purchases/new">Record your first purchase</Link>} />}
        exportAs={{ title: 'Purchases', fetchAll: list.fetchAll }} />
    </div>
  );
}
