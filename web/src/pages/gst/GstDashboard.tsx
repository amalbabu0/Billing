import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, FileSpreadsheet, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { compactMoney, money, num } from '@/lib/format';
import { Card, ErrorPanel, Kpi, Notice, PageHeader, SkeletonRows } from '@/components/ui/display';
import { BarChart, Donut, VIZ } from '@/components/Charts';
import { GstRangeBar, monthLabel, rateLabel, UnregisteredNotice, useGstRange, type GstRateRow, type TaxAmounts } from './common';

interface Dashboard {
  from: string; to: string; registered: boolean; gstin?: string; sales: TaxAmounts; b2b: TaxAmounts; b2c: TaxAmounts; creditNotes: TaxAmounts;
  purchases: TaxAmounts; debitNotes: TaxAmounts; cancelledInvoices: number; outputTax: number; inputTax: number; netPosition: number;
  trend: { period: string; outputTax: number; inputTax: number; net: number }[]; rates: GstRateRow[];
}

export default function GstDashboard() {
  const range = useGstRange();
  const { data: d, error, refetch, isLoading } = useQuery({ queryKey: ['gst-dashboard', range.from, range.to], queryFn: () => api.get<Dashboard>('/api/gst/dashboard', { from: range.from, to: range.to }) });
  return (
    <div className="page">
      <PageHeader title="GST dashboard" desc={<>Output tax on sales, input credit on purchases and the net position for the period{d?.gstin ? <> · GSTIN <span className="mono">{d.gstin}</span></> : null}.</>}
        actions={<Link className="btn" to={`/gst/export?from=${range.from}&to=${range.to}&preset=${range.value.preset}`}><Download aria-hidden />Export for filing</Link>} />
      <GstRangeBar range={range} />
      <UnregisteredNotice />
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : (
        <>
          <div className="kpi-row">
            <Kpi loading={isLoading} label="Output tax" value={money(d?.outputTax, { decimals: false })} foot={`${num(d?.sales.count)} invoices · less credit notes`} to={`/gst/output?from=${range.from}&to=${range.to}`} />
            <Kpi loading={isLoading} label="Input tax credit" value={money(d?.inputTax, { decimals: false })} foot={`${num(d?.purchases.count)} purchase bills · less debit notes`} to={`/gst/input?from=${range.from}&to=${range.to}`} />
            <Kpi loading={isLoading} label={(d?.netPosition ?? 0) >= 0 ? 'Net GST payable' : 'Credit carried forward'} value={money(Math.abs(d?.netPosition ?? 0), { decimals: false })}
              tone={(d?.netPosition ?? 0) > 0 ? "warn" : undefined} icon={<Scale />} foot="Output − input, before set-off rules" />
            <Kpi loading={isLoading} label="Taxable sales" value={money(d?.sales.taxable, { decimals: false })} foot={`B2B ${compactMoney(d?.b2b.taxable)} · B2C ${compactMoney(d?.b2c.taxable)}`} to={`/gst/sales?from=${range.from}&to=${range.to}`} />
          </div>
          {d && d.cancelledInvoices > 0 && <Notice tone="info">{d.cancelledInvoices} invoice{d.cancelledInvoices > 1 ? 's were' : ' was'} cancelled in this period — they stay in the <Link to={`/gst/register?from=${range.from}&to=${range.to}`}>invoice register</Link> as cancelled and carry no tax.</Notice>}
          <div className="split wide-left">
            <Card title="Output vs input tax by month" sub="Net is what goes into GSTR-3B">
              {isLoading ? <SkeletonRows rows={5} /> : <>
                <BarChart label="Output and input tax by month" labels={(d?.trend ?? []).map(t => monthLabel(t.period))}
                  series={[{ name: 'Output tax', values: (d?.trend ?? []).map(t => t.outputTax), color: VIZ[0] }, { name: 'Input credit', values: (d?.trend ?? []).map(t => t.inputTax), color: VIZ[2] }]} />
              </>}
            </Card>
            <Card title="Sales tax by rate" actions={<Link className="btn btn-sm btn-ghost" to={`/gst/rates?from=${range.from}&to=${range.to}`}>Details<ArrowRight aria-hidden /></Link>}>
              {isLoading ? <SkeletonRows rows={4} /> : (d?.rates ?? []).length === 0 ? <p className="text-sm muted">No taxed sales in this period.</p> :
                <Donut label="Output tax by GST rate" items={(d?.rates ?? []).map(r => ({ label: `${r.supply} ${rateLabel(r.rate)}`, value: r.totalTax }))} centerLabel="Output tax" />}
            </Card>
          </div>
          <Card title="Summary" bodyClass="">
            <div className="table-scroll"><table className="data">
              <thead><tr><th>Section</th><th className="num">Docs</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total tax</th><th /></tr></thead>
              <tbody>
                {d && ([
                  ['B2B sales (with GSTIN)', d.b2b, `/gst/sales?type=B2B`],
                  ['B2C sales', d.b2c, `/gst/sales?type=B2C`],
                  ['Credit notes (sales returns)', d.creditNotes, `/gst/credit-notes`, true],
                  ['Purchases', d.purchases, `/gst/purchases`],
                  ['Debit notes (purchase returns)', d.debitNotes, `/gst/debit-notes`, true],
                ] as [string, TaxAmounts, string, boolean?][]).map(([name, t, to, neg]) => (
                  <tr key={name}><td className="medium">{name}</td><td className="num">{num(t.count)}</td>
                    {[t.taxable, t.cgst, t.sgst, t.igst, t.tax].map((v, i) => <td key={i} className="num">{neg && v ? '−' : ''}{money(v)}</td>)}
                    <td className="num"><Link className="btn btn-sm btn-ghost" to={`${to}${to.includes('?') ? '&' : '?'}from=${range.from}&to=${range.to}`} aria-label={`Open ${name}`}><ArrowRight aria-hidden /></Link></td></tr>
                ))}
              </tbody>
            </table></div>
          </Card>
          <div className="row gap-2 wrap">
            {[['HSN summary', '/gst/hsn'], ['Invoice register', '/gst/register'], ['CGST ledger', '/gst/cgst'], ['SGST ledger', '/gst/sgst'], ['IGST ledger', '/gst/igst']].map(([l, to]) =>
              <Link key={to} className="btn btn-sm" to={`${to}?from=${range.from}&to=${range.to}`}><FileSpreadsheet aria-hidden />{l}</Link>)}
          </div>
        </>
      )}
    </div>
  );
}
