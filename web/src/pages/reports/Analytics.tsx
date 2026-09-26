import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { compactMoney, date, money, num, pct } from '@/lib/format';
import { rangeFor } from '@/lib/hooks';
import { Card, Delta, EmptyState, ErrorPanel, Kpi, PageHeader, SkeletonRows } from '@/components/ui/display';
import { TrendChart, VIZ } from '@/components/Charts';
import { DateRange } from '@/components/pickers';

interface Figures {
  from: string; to: string; sales: number; taxable: number; invoices: number; averageInvoice: number; collected: number; returns: number; grossMargin?: number | null;
  marginPercent?: number | null; newCustomers: number; quotations: number; quotationsConverted: number; conversionPercent?: number | null; customOrderValue: number;
  daily: { date: string; sales: number }[];
}
interface Ranked { name: string; current: number; previous: number; changePercent?: number | null }
interface Result { current: Figures; previous: Figures; categories: Ranked[]; products: Ranked[]; salespeople: Ranked[]; paymentMethods: Ranked[] }

const change = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);

/** Two periods side by side: this month vs last month, this quarter vs the previous one, or any custom pair. */
export default function Analytics() {
  const [range, setRange] = useState(() => ({ preset: 'month', ...rangeFor('month') }));
  const [compare, setCompare] = useState<'previous' | 'lastYear'>('previous');
  const shift = (d: string, years: number) => { const x = new Date(d); x.setFullYear(x.getFullYear() - years); return x.toISOString().slice(0, 10); };
  const q = compare === 'lastYear' ? { compareFrom: shift(range.from, 1), compareTo: shift(range.to, 1) } : {};
  const { data: r, error, refetch, isLoading } = useQuery({ queryKey: ['analytics', range.from, range.to, compare], queryFn: () => api.get<Result>('/api/analytics', { from: range.from, to: range.to, ...q }) });
  const c = r?.current, p = r?.previous;
  const label = p ? `vs ${date(p.from)} – ${date(p.to)}` : '';
  return (
    <div className="page">
      <PageHeader title="Analytics" desc="Compare two periods using saved invoices, payments, returns and quotations." />
      <div className="row wrap gap-3 between">
        <DateRange value={range} onChange={setRange} presets={['7d', '30d', 'month', 'lastMonth', 'quarter', 'fy', 'custom']} />
        <div className="segmented" role="group" aria-label="Compare with" style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <button type="button" aria-pressed={compare === 'previous'} onClick={() => setCompare('previous')}>Previous period</button>
          <button type="button" aria-pressed={compare === 'lastYear'} onClick={() => setCompare('lastYear')}>Same period last year</button>
        </div>
      </div>
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : isLoading || !c || !p ? <SkeletonRows rows={8} /> : <>
        <section className="kpi-row">
          <Kpi label="Sales" value={money(c.sales, { decimals: false })} foot={<Delta value={change(c.sales, p.sales)} suffix={label} />} />
          <Kpi label="Invoices" value={num(c.invoices)} foot={<><span>avg {money(c.averageInvoice, { decimals: false })}</span>·<Delta value={change(c.averageInvoice, p.averageInvoice)} suffix="avg" /></>} />
          <Kpi label="Collected" value={money(c.collected, { decimals: false })} foot={<Delta value={change(c.collected, p.collected)} suffix={label} />} />
          {c.grossMargin != null && <Kpi label="Gross margin" value={money(c.grossMargin, { decimals: false })} foot={<span>{c.marginPercent != null ? pct(c.marginPercent) : '—'} of taxable · was {p.marginPercent != null ? pct(p.marginPercent) : '—'}</span>} />}
          <Kpi label="Quotation conversion" value={c.conversionPercent != null ? pct(c.conversionPercent) : '—'} foot={<span>{c.quotationsConverted} of {c.quotations} · was {p.conversionPercent != null ? pct(p.conversionPercent) : '—'}</span>} />
        </section>
        <section className="kpi-row">
          <Kpi small label="Returns" value={money(c.returns, { decimals: false })} tone={c.returns > p.returns && c.returns > 0 ? 'warn' : undefined} foot={<span>was {money(p.returns, { decimals: false })}</span>} />
          <Kpi small label="New customers" value={num(c.newCustomers)} foot={<Delta value={change(c.newCustomers, p.newCustomers)} suffix="" />} />
          <Kpi small label="Custom orders booked" value={money(c.customOrderValue, { decimals: false })} foot={<span>was {money(p.customOrderValue, { decimals: false })}</span>} />
        </section>
        <Card title="Daily sales" sub={`${date(c.from)} – ${date(c.to)} against ${date(p.from)} – ${date(p.to)}, day by day`}>
          {c.daily.length > 1 ? <>
            <TrendChart label="Daily sales, current and comparison period" labels={c.daily.map((_, i) => `Day ${i + 1}`)} height={240}
              series={[{ name: 'This period', values: c.daily.map(x => x.sales), color: VIZ[0] }, { name: 'Comparison', values: c.daily.map((_, i) => p.daily[i]?.sales ?? 0), color: VIZ[1] }]} />
          </> : <p className="text-sm muted">Choose a range of two days or more to see the trend.</p>}
        </Card>
        <div className="split">
          <RankCard title="Categories" rows={r!.categories} />
          <RankCard title="Top products" rows={r!.products} />
        </div>
        <div className="split">
          <RankCard title="Salespeople" rows={r!.salespeople} sub="Taxable value of invoices credited to each person" />
          <RankCard title="Payment methods" rows={r!.paymentMethods} sub="Money received" />
        </div>
      </>}
    </div>
  );
}

function RankCard({ title, rows, sub }: { title: string; rows: Ranked[]; sub?: string }) {
  const max = Math.max(1, ...rows.map(r => Math.max(r.current, r.previous)));
  return (
    <Card title={title} sub={sub} bodyClass="">
      {rows.length === 0 ? <EmptyState compact title="No data in this period" /> : (
        <div className="table-scroll"><table className="data compact">
          <thead><tr><th>{title.replace('Top ', '')}</th><th className="num">This period</th><th className="num">Before</th><th className="num">Change</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.name}>
              <td><div className="cell-title truncate" style={{ maxWidth: 'min(240px, 40vw)' }}>{r.name}</div><div className="rank-bar" aria-hidden><span style={{ width: `${(r.current / max) * 100}%` }} /><span className="prev" style={{ width: `${(r.previous / max) * 100}%` }} /></div></td>
              <td className="num medium">{compactMoney(r.current)}</td><td className="num muted">{compactMoney(r.previous)}</td>
              <td className={`num ${r.changePercent == null ? 'muted' : r.changePercent < 0 ? 't-bad' : 't-ok'}`}>{r.changePercent == null ? (r.current > 0 ? 'new' : '—') : `${r.changePercent > 0 ? '+' : ''}${r.changePercent}%`}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
