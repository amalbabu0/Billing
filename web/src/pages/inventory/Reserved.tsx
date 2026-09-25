import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { date, daysFromToday, qty } from '@/lib/format';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, PageHeader, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';

interface Row { salesOrderId: number; salesOrderNumber: string; customerName: string; status: string; orderDate: string; expectedDeliveryDate?: string; variantId: number; sku: string; productName: string; reservedQty: number }

export default function Reserved() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['inventory', 'reserved'], queryFn: () => api.get<Row[]>('/api/inventory/reserved') });
  const rows = useMemo(() => (data ?? []).filter(r => !search || `${r.productName} ${r.sku} ${r.customerName} ${r.salesOrderNumber}`.toLowerCase().includes(search.toLowerCase())), [data, search]);
  const late = rows.filter(r => (daysFromToday(r.expectedDeliveryDate) ?? 0) < 0);
  const cols: Column<Row>[] = [
    { key: 'p', header: 'Product', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.productName}</span><span className="cell-sub mono">{r.sku}</span></div>, exportValue: r => r.productName },
    { key: 'q', header: 'Reserved', num: true, mobile: 'right', render: r => <b className="num">{qty(r.reservedQty)}</b>, exportValue: r => r.reservedQty },
    { key: 'o', header: 'For order', render: r => <DocNo to={`/sales/orders/${r.salesOrderId}`}>{r.salesOrderNumber}</DocNo>, exportValue: r => r.salesOrderNumber },
    { key: 'c', header: 'Customer', mobile: 'sub', render: r => r.customerName, exportValue: r => r.customerName },
    { key: 'd', header: 'Delivery by', mobile: 'meta', render: r => { const d = daysFromToday(r.expectedDeliveryDate); return <span className={d !== null && d < 0 ? 't-bad' : ''}>{date(r.expectedDeliveryDate)}{d !== null && d < 0 ? ` · ${-d}d late` : ''}</span>; }, exportValue: r => date(r.expectedDeliveryDate) },
    { key: 's', header: 'Order status', render: r => <Status value={r.status} />, exportValue: r => r.status },
  ];
  return (
    <div className="page">
      <PageHeader title="Reserved stock" desc="Pieces held for confirmed sales orders. Reserved stock is not available to sell to anyone else until the order is invoiced or cancelled." />
      <StatStrip loading={isLoading} items={[
        { label: 'Units reserved', value: qty(rows.reduce((s, r) => s + r.reservedQty, 0)) },
        { label: 'Orders holding stock', value: new Set(rows.map(r => r.salesOrderId)).size },
        { label: 'Past delivery date', value: late.length, tone: late.length ? 'bad' : undefined },
      ]} />
      <DataTable id="reserved" label="Reserved stock" columns={cols} rows={rows} loading={isLoading} error={error} onRetry={() => void refetch()}
        rowKey={r => `${r.salesOrderId}-${r.variantId}`} onRowClick={r => nav(`/sales/orders/${r.salesOrderId}`)}
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Product, SKU, customer or order" />}
        empty={<EmptyState icon={<Lock />} title="Nothing is reserved" desc="Confirming a sales order reserves its items here." />}
        exportAs={{ title: 'Reserved stock', fetchAll: async () => rows }} />
    </div>
  );
}
