import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { api, errorMessage, exportTable } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useToast } from '@/app/providers';
import { Card, DocNo, EmptyState, ErrorPanel, Notice, PageHeader, SkeletonRows, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { GstRangeBar, useGstRange } from './common';

interface Row { id: number; number: string; date: string; customerName: string; customerGstin?: string; taxable: number; tax: number; invoiceTotal: number; status: string; cancelledAt?: string; cancelReason?: string }
interface Register { rows: Row[]; issued: number; cancelled: number; firstNumber?: string; lastNumber?: string; gaps: string[] }

/** Document register (GSTR-1 Table 13): every number issued, including cancelled ones, and a gap check. */
export default function GstRegister() {
  const nav = useNavigate();
  const toast = useToast();
  const range = useGstRange();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['gst-register', range.from, range.to, q], queryFn: () => api.get<Register>('/api/gst/register', { from: range.from, to: range.to, search: q }) });
  const exportIt = async () => {
    try {
      await exportTable({ title: 'Invoice register', subtitle: `${date(range.from)} – ${date(range.to)}`, format: 'xlsx',
        columns: [{ key: 'number', label: 'Invoice' }, { key: 'd', label: 'Date' }, { key: 'customerName', label: 'Customer' }, { key: 'customerGstin', label: 'GSTIN' }, { key: 'taxable', label: 'Taxable', money: true }, { key: 'tax', label: 'Tax', money: true }, { key: 'invoiceTotal', label: 'Total', money: true }, { key: 'status', label: 'Status' }, { key: 'cancelReason', label: 'Cancel reason' }],
        rows: (data?.rows ?? []).map(r => ({ ...r, d: date(r.date) })) });
    } catch (e) { toast.error('Export failed', errorMessage(e)); }
  };
  return (
    <div className="page">
      <PageHeader title="Invoice register" desc="Every invoice number issued in the period, cancelled ones included, with a check that the series has no gaps."
        actions={<button className="btn" onClick={exportIt} disabled={!data?.rows.length}><Download aria-hidden />Export</button>} />
      <GstRangeBar range={range} />
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : <>
        <StatStrip loading={isLoading} items={[
          { label: 'Issued', value: data?.issued ?? 0 }, { label: 'Cancelled', value: data?.cancelled ?? 0, tone: data?.cancelled ? 'bad' : undefined },
          { label: 'Series', value: data?.firstNumber ? `${data.firstNumber} → ${data.lastNumber}` : '—' },
        ]} />
        {data && (data.gaps.length ? <Notice tone="bad">Missing numbers in the series: <span className="mono">{data.gaps.join(', ')}</span>. Check with your administrator.</Notice>
          : data.issued > 0 && <Notice tone="ok" icon={<CheckCircle2 />}>No gaps — every number in the series is accounted for.</Notice>)}
        <Card bodyClass="">
          <div className="table-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Invoice no., customer or GSTIN" /></div>
          {isLoading ? <SkeletonRows rows={8} /> : !data?.rows.length ? <EmptyState compact title="No invoices in this period" /> : (
            <div className="table-scroll"><table className="data">
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Total</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map(r => (
                <tr key={r.id} className={`clickable ${r.status === 'CANCELLED' ? 'muted-row' : ''}`} onClick={() => nav(`/sales/invoices/${r.id}`)}>
                  <td><DocNo>{r.number}</DocNo></td><td>{date(r.date)}</td>
                  <td><div className="cell-title">{r.customerName}</div>{r.customerGstin && <div className="cell-sub mono">{r.customerGstin}</div>}</td>
                  <td className="num">{money(r.taxable)}</td><td className="num">{money(r.tax)}</td><td className="num medium">{money(r.invoiceTotal)}</td>
                  <td>{r.status === 'CANCELLED' ? <span title={r.cancelReason}><Status value="CANCELLED" /></span> : <Status value="FINAL" text="Issued" />}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
    </div>
  );
}
