import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { api, download, errorMessage } from '@/lib/api';
import { date, money, num } from '@/lib/format';
import { rangeFor } from '@/lib/hooks';
import type { Customer, Supplier } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { P } from '@/lib/perms';
import { Card, EmptyState, ErrorPanel, PageHeader, Segmented, SkeletonRows, StatStrip } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { BarChart, HBarChart, VIZ } from '@/components/Charts';
import { CustomerPicker, DateRange, SupplierPicker } from '@/components/pickers';

interface Def { key: string; group: string; title: string; permission: string; description: string; usesDates: boolean; usesCategory: boolean; usesProduct: boolean; usesCustomer: boolean; usesSupplier: boolean; usesGrouping: boolean; needsCost: boolean }
interface Result { definition: Def; subtitle: string; columns: { name: string; kind: 'money' | 'date' | 'number' | 'text' }[]; rows: (string | number | null)[][]; totals: { label: string; value: string }[] }

/** Route group → server report group + the report to open first. */
const GROUPS: Record<string, { group: string; title: string; first?: string; only?: string[] }> = {
  sales: { group: 'Sales', title: 'Sales reports' },
  customers: { group: 'Sales', title: 'Customer reports', first: 'sales.customer', only: ['sales.customer', 'pay.outstanding'] },
  purchases: { group: 'Purchases', title: 'Purchase reports', first: 'pur.register' },
  suppliers: { group: 'Purchases', title: 'Supplier reports', first: 'pur.supplier', only: ['pur.supplier'] },
  profit: { group: 'Profit', title: 'Profit reports' },
  inventory: { group: 'Inventory', title: 'Inventory reports' },
  payments: { group: 'Payments', title: 'Payment reports' },
  outstanding: { group: 'Payments', title: 'Outstanding', first: 'pay.outstanding', only: ['pay.outstanding'] },
  expenses: { group: 'Profit', title: 'Expense reports', first: 'expense.category', only: ['expense.category'] },
  gst: { group: 'GST', title: 'GST reports' },
};

export default function Reports() {
  const { group = 'sales' } = useParams();
  const g = GROUPS[group] ?? GROUPS.sales;
  const can = useCan();
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [params, setParams] = useSearchParams();
  const defs = useQuery({ queryKey: ['report-defs'], queryFn: () => api.get<Def[]>('/api/reports'), staleTime: 300_000 });
  const available = (defs.data ?? []).filter(d => (g.only ? g.only.includes(d.key) : d.group === g.group));
  const key = params.get('report') && available.some(d => d.key === params.get('report')) ? params.get('report')! : g.first && available.some(d => d.key === g.first) ? g.first : available[0]?.key;
  const def = available.find(d => d.key === key);
  const month = rangeFor('month');
  const range = { preset: params.get('preset') ?? 'month', from: params.get('from') ?? month.from, to: params.get('to') ?? month.to };
  const set = (patch: Record<string, string | undefined>) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k)); setParams(n, { replace: true }); };
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const filter = {
    from: range.from, to: range.to, groupBy: params.get('groupBy') ?? 'day',
    categoryId: def?.usesCategory && params.get('categoryId') ? Number(params.get('categoryId')) : null,
    customerId: def?.usesCustomer ? customer?.id ?? null : null, supplierId: def?.usesSupplier ? supplier?.id ?? null : null,
  };
  const run = useQuery({ queryKey: ['report', key, filter], queryFn: () => api.post<Result>(`/api/reports/${key}`, filter), enabled: !!key });
  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try { await download('POST', `/api/reports/${key}/export?format=${format}`, `${def?.title}.${format}`, filter); toast.success('Export ready'); }
    catch (e) { toast.error('Export failed', errorMessage(e)); }
  };

  return (
    <div className="page">
      <PageHeader title={g.title} desc={def ? def.description : 'Choose a report.'}
        actions={def && can(P.ExportData) && <>
          <button className="btn" onClick={() => exportAs('pdf')} disabled={!run.data}><FileText aria-hidden />PDF</button>
          <button className="btn" onClick={() => exportAs('xlsx')} disabled={!run.data}><FileSpreadsheet aria-hidden />Excel</button>
          <button className="btn btn-ghost" onClick={() => exportAs('csv')} disabled={!run.data}><Download aria-hidden />CSV</button>
        </>} />
      {defs.error ? <ErrorPanel error={defs.error} retry={() => void defs.refetch()} /> : defs.isLoading ? <SkeletonRows rows={6} /> : available.length === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No reports available" desc="Your role does not include these reports. Ask an administrator for access." />
      ) : <>
        {available.length > 1 && <div className="report-tabs" role="tablist" aria-label="Reports">
          {available.map(d => <button key={d.key} role="tab" aria-selected={d.key === key} className={d.key === key ? 'active' : ''} onClick={() => set({ report: d.key })}>{d.title}</button>)}
        </div>}
        {def && <div className="row wrap gap-3">
          {def.usesDates && <DateRange value={range} presets={['today', '7d', 'month', 'lastMonth', 'quarter', 'fy', 'custom']} onChange={v => set({ from: v.from, to: v.to, preset: v.preset })} />}
          {def.usesGrouping && <Segmented value={filter.groupBy} onChange={v => set({ groupBy: v })} label="Group by" options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />}
          {def.usesCategory && <select className="select input-sm" style={{ width: 180 }} aria-label="Category" value={params.get('categoryId') ?? ''} onChange={e => set({ categoryId: e.target.value || undefined })}>
            <option value="">All categories</option>{(lookups?.categories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {def.usesCustomer && <div style={{ width: 280 }}><CustomerPicker value={customer} onChange={setCustomer} label="" /></div>}
          {def.usesSupplier && <div style={{ width: 280 }}><SupplierPicker value={supplier} onChange={setSupplier} /></div>}
        </div>}
        {run.error ? <ErrorPanel error={run.error} retry={() => void run.refetch()} /> : <ReportBody result={run.data} loading={run.isFetching && !run.data} />}
      </>}
    </div>
  );
}

function ReportBody({ result, loading }: { result?: Result; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const rows = useMemo(() => {
    if (!result) return [];
    let r = result.rows;
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter(x => x.some(v => v !== null && String(v).toLowerCase().includes(q))); }
    if (sort) r = [...r].sort((a, b) => { const x = a[sort.col], y = b[sort.col]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return sort.desc ? -c : c; });
    return r;
  }, [result, search, sort]);
  if (loading || !result) return <SkeletonRows rows={8} />;
  const cols = result.columns;
  const labelCol = cols.findIndex(c => c.kind === 'text' || c.kind === 'date');
  const valueCol = cols.findIndex(c => c.kind === 'money');
  const isTime = labelCol >= 0 && (cols[labelCol].kind === 'date' || /period|date|month|week|day/i.test(cols[labelCol].name));
  const chartable = labelCol >= 0 && valueCol >= 0 && result.rows.length > 1;
  const fmt = (v: string | number | null, k: string) => v === null ? '—' : k === 'money' ? money(Number(v)) : k === 'date' ? date(String(v)) : k === 'number' ? num(Number(v)) : String(v);
  return <>
    {result.totals.length > 0 && <StatStrip items={result.totals.slice(0, 5).map(t => ({ label: t.label, value: t.value }))} />}
    {chartable && <Card title={`${cols[valueCol].name}${isTime ? ' over time' : ` by ${cols[labelCol].name.toLowerCase()}`}`} sub={result.subtitle}>
      {isTime
        ? <BarChart label={result.definition.title} labels={result.rows.slice(-31).map(r => fmt(r[labelCol], cols[labelCol].kind))} series={[{ name: cols[valueCol].name, values: result.rows.slice(-31).map(r => Number(r[valueCol] ?? 0)), color: VIZ[0] }]} />
        : <HBarChart label={result.definition.title} items={[...result.rows].sort((a, b) => Number(b[valueCol] ?? 0) - Number(a[valueCol] ?? 0)).slice(0, 10).map(r => ({ label: String(r[labelCol] ?? '—'), value: Number(r[valueCol] ?? 0) }))} />}
    </Card>}
    <Card bodyClass="">
      <div className="table-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Filter rows" /><span className="grow" /><span className="text-xs muted">{num(rows.length)} rows · {result.subtitle}</span></div>
      {rows.length === 0 ? <EmptyState compact title="No data for these filters" /> : (
        <div className="table-scroll" style={{ maxHeight: '70vh' }}><table className="data sticky-head">
          <thead><tr>{cols.map((c, i) => (
            <th key={c.name} className={c.kind === 'money' || c.kind === 'number' ? 'num' : ''} aria-sort={sort?.col === i ? (sort.desc ? 'descending' : 'ascending') : undefined}>
              <button className="th-sort" onClick={() => setSort(s => s?.col === i ? { col: i, desc: !s.desc } : { col: i, desc: c.kind === 'money' || c.kind === 'number' })}>
                {c.name}{sort?.col === i && (sort.desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />)}</button></th>
          ))}</tr></thead>
          <tbody>{rows.slice(0, 1000).map((r, ri) => <tr key={ri}>{r.map((v, i) => <td key={i} className={cols[i].kind === 'money' || cols[i].kind === 'number' ? 'num' : ''}>{fmt(v, cols[i].kind)}</td>)}</tr>)}</tbody>
        </table></div>
      )}
      {rows.length > 1000 && <p className="text-xs muted" style={{ padding: 12 }}>Showing the first 1,000 rows. Export for the full report.</p>}
    </Card>
  </>;
}
