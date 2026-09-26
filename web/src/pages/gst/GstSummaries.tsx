import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, errorMessage, exportTable } from '@/lib/api';
import { date, money, qty } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useToast } from '@/app/providers';
import { Card, EmptyState, ErrorPanel, PageHeader, Segmented, SkeletonRows } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { GstRangeBar, rateLabel, UnregisteredNotice, useGstRange, type GstRateRow } from './common';

interface HsnRow { hsn: string; description?: string; products?: string; rate: number; quantity: number; taxable: number; cgst: number; sgst: number; igst: number; totalTax: number; totalValue: number }

export default function GstSummaries({ view }: { view: 'hsn' | 'rates' }) {
  const toast = useToast();
  const range = useGstRange();
  const [side, setSide] = useState<'sales' | 'purchases'>('sales');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const hsn = useQuery({ queryKey: ['gst-hsn', side, range.from, range.to, q], queryFn: () => api.get<HsnRow[]>('/api/gst/hsn', { from: range.from, to: range.to, side, search: q }), enabled: view === 'hsn' });
  const rates = useQuery({ queryKey: ['gst-rates', side, range.from, range.to], queryFn: () => api.get<GstRateRow[]>('/api/gst/rates', { from: range.from, to: range.to, side }), enabled: view === 'rates' });
  const cur = view === 'hsn' ? hsn : rates;
  const rows = (cur.data ?? []) as (HsnRow | GstRateRow)[];
  const sum = (k: string) => rows.reduce((s, r) => s + ((r as unknown as Record<string, number>)[k] ?? 0), 0);
  const title = view === 'hsn' ? 'HSN summary' : 'Tax rate summary';
  const exportIt = async () => {
    const columns = view === 'hsn'
      ? [{ key: 'hsn', label: 'HSN' }, { key: 'description', label: 'Description' }, { key: 'rate', label: 'Rate %' }, { key: 'quantity', label: 'Qty' }, { key: 'taxable', label: 'Taxable', money: true }, { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'totalValue', label: 'Total value', money: true }]
      : [{ key: 'supply', label: 'Supply' }, { key: 'rateText', label: 'Rate' }, { key: 'invoices', label: 'Documents' }, { key: 'taxable', label: 'Taxable', money: true }, { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'totalTax', label: 'Total tax', money: true }];
    try {
      await exportTable({ title: `${title} (${side})`, subtitle: `${date(range.from)} – ${date(range.to)}`, format: 'xlsx', columns,
        rows: rows.map(r => ({ ...r, rateText: rateLabel((r as GstRateRow).rate) })) as Record<string, unknown>[] });
    } catch (e) { toast.error('Export failed', errorMessage(e)); }
  };
  return (
    <div className="page">
      <PageHeader title={title} desc={view === 'hsn' ? 'Quantity, taxable value and tax per HSN code and rate — Table 12 of GSTR-1.' : 'Taxable value and tax grouped by GST rate, goods and services (delivery, installation) shown separately.'}
        actions={<button className="btn" onClick={exportIt} disabled={!rows.length}><Download aria-hidden />Export</button>} />
      <GstRangeBar range={range}>
        <Segmented value={side} onChange={setSide} label="Side" options={[{ value: 'sales', label: 'Sales (outward)' }, { value: 'purchases', label: 'Purchases (inward)' }]} />
      </GstRangeBar>
      <UnregisteredNotice />
      {cur.error ? <ErrorPanel error={cur.error} retry={() => void cur.refetch()} /> : (
        <Card bodyClass="">
          {view === 'hsn' && <div className="table-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="HSN code or description" /></div>}
          {cur.isLoading ? <SkeletonRows rows={6} /> : rows.length === 0 ? <EmptyState compact title="Nothing in this period" /> : (
            <div className="table-scroll"><table className="data">
              <thead>{view === 'hsn'
                ? <tr><th>HSN</th><th>Description</th><th className="num">Rate</th><th className="num">Qty</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total value</th></tr>
                : <tr><th>Supply</th><th className="num">Rate</th><th className="num">Documents</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total tax</th></tr>}</thead>
              <tbody>{view === 'hsn'
                ? (rows as HsnRow[]).map(r => <tr key={`${r.hsn}-${r.rate}`}><td className="mono medium">{r.hsn}</td><td><div className="cell-title">{r.description ?? '—'}</div>{r.products && <div className="cell-sub truncate" style={{ maxWidth: 320 }}>{r.products}</div>}</td>
                    <td className="num">{r.rate}%</td><td className="num">{qty(r.quantity)}</td><td className="num">{money(r.taxable)}</td><td className="num">{money(r.cgst)}</td><td className="num">{money(r.sgst)}</td><td className="num">{money(r.igst)}</td><td className="num medium">{money(r.totalValue)}</td></tr>)
                : (rows as GstRateRow[]).map(r => <tr key={`${r.supply}-${r.rate}`}><td className="medium">{r.supply}</td><td className="num">{rateLabel(r.rate)}</td><td className="num">{r.invoices}</td>
                    <td className="num">{money(r.taxable)}</td><td className="num">{money(r.cgst)}</td><td className="num">{money(r.sgst)}</td><td className="num">{money(r.igst)}</td><td className="num medium">{money(r.totalTax)}</td></tr>)}</tbody>
              <tfoot>{view === 'hsn'
                ? <tr><td colSpan={3}>Total</td><td className="num">{qty(sum('quantity'))}</td><td className="num">{money(sum('taxable'))}</td><td className="num">{money(sum('cgst'))}</td><td className="num">{money(sum('sgst'))}</td><td className="num">{money(sum('igst'))}</td><td className="num">{money(sum('totalValue'))}</td></tr>
                : <tr><td colSpan={3}>Total</td><td className="num">{money(sum('taxable'))}</td><td className="num">{money(sum('cgst'))}</td><td className="num">{money(sum('sgst'))}</td><td className="num">{money(sum('igst'))}</td><td className="num">{money(sum('totalTax'))}</td></tr>}</tfoot>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}
