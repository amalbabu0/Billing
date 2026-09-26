import { Link, useNavigate } from 'react-router-dom';
import { Hammer, Plus } from 'lucide-react';
import { date, daysFromToday } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import { CUSTOM_ORDER_LABELS } from '@/lib/status';
import type { CustomOrder } from '@/lib/types';
import { useCan } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, PageHeader, Segmented, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

const VIEWS = {
  production: { stage: 'ACTIVE', title: 'Production', desc: 'Custom furniture being designed and made. Move each order along its stages from the order page.', statuses: ['RECEIVED', 'DESIGN', 'PRODUCTION', 'QUALITY_CHECK'] },
  ready: { stage: 'READY', title: 'Ready for delivery', desc: 'Finished pieces waiting to be invoiced, delivered or installed.', statuses: ['READY', 'DELIVERY', 'INSTALLATION'] },
  completed: { stage: 'COMPLETED', title: 'Completed orders', desc: 'Delivered, installed and closed custom orders.', statuses: ['COMPLETED', 'CANCELLED'] },
};

export default function CustomOrders({ view }: { view: keyof typeof VIEWS }) {
  const can = useCan();
  const nav = useNavigate();
  const v = VIEWS[view];
  const list = usePagedList<CustomOrder>(`custom-orders-${view}`, '/api/custom-orders', { filterKeys: ['status'], extra: { stage: v.stage } });
  const { state, update } = list;
  const cols: Column<CustomOrder>[] = [
    { key: 'n', header: 'Order', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'p', header: 'Furniture', mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{r.productType}</span><span className="cell-sub">{[r.dimensionsText, r.material, r.finish].filter(Boolean).join(' · ')}</span></div>, exportValue: r => r.productType },
    { key: 'c', header: 'Customer', mobile: 'meta', render: r => r.customerName, exportValue: r => r.customerName },
    {
      key: 'e', header: 'Expected', mobile: 'meta', render: r => {
        const d = daysFromToday(r.expectedCompletionDate);
        const done = ['COMPLETED', 'CANCELLED'].includes(r.status);
        return <span className={!done && d !== null && d < 0 ? 't-bad' : !done && d !== null && d <= 3 ? 't-warn' : ''}>{date(r.expectedCompletionDate)}{!done && d !== null && d < 0 ? ` · ${-d}d late` : ''}</span>;
      }, exportValue: r => date(r.expectedCompletionDate),
    },
    { key: 'v', header: 'Price', num: true, money: true, render: r => <Money value={r.finalPrice || r.estimatedCost} />, exportValue: r => r.finalPrice || r.estimatedCost },
    { key: 'a', header: 'Advance', num: true, money: true, render: r => <Money value={r.advancePaid} className="t-ok" />, exportValue: r => r.advancePaid },
    { key: 'b', header: 'Balance', num: true, money: true, mobile: 'right', render: r => <Money value={r.balance} strong />, exportValue: r => r.balance },
    { key: 's', header: 'Stage', render: r => <Status value={r.status} text={CUSTOM_ORDER_LABELS[r.status]} />, exportValue: r => r.status },
  ];
  return (
    <div className="page">
      <PageHeader title={v.title} desc={v.desc} actions={can(P.CustomOrderManage) && <Link className="btn btn-primary" to="/custom-orders/new"><Plus aria-hidden />New custom order</Link>} />
      <DataTable id={`custom-${view}`} label={v.title} columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => nav(`/custom-orders/${r.id}`)}
        rowClass={r => (r.isOverdue ? undefined : undefined)}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Order no., customer, mobile or furniture" />
          <Segmented value={state.filters.status ?? ''} onChange={x => update({ filters: { status: x || undefined } })} label="Stage"
            options={[{ value: '', label: 'All' }, ...v.statuses.map(s => ({ value: s, label: CUSTOM_ORDER_LABELS[s] }))]} />
        </>}
        empty={<EmptyState icon={<Hammer />} title={view === 'production' ? 'Nothing in production' : view === 'ready' ? 'Nothing waiting for delivery' : 'No completed orders yet'}
          desc="Custom orders capture design, dimensions, material and finish, with an advance." action={view === 'production' && can(P.CustomOrderManage) && <Link className="btn btn-primary" to="/custom-orders/new">Take a custom order</Link>} />}
        exportAs={{ title: v.title, fetchAll: list.fetchAll }} />
    </div>
  );
}
