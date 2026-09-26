import { useQuery } from '@tanstack/react-query';
import { date, money } from '@/lib/format';
import { Card, ErrorPanel, PageHeader, SkeletonRows, StatStrip } from '@/components/ui/display';
import { BarChart, VIZ } from '@/components/Charts';
import { api, errorMessage, exportTable } from '@/lib/api';
import { useToast } from '@/app/providers';
import { Download } from 'lucide-react';
import { GstRangeBar, monthLabel, UnregisteredNotice, useGstRange } from './common';

type View = 'output' | 'input' | 'CGST' | 'SGST' | 'IGST';
interface Row { period: string; output: number; creditNotes: number; input: number; debitNotes: number; netOutput: number; netInput: number; net: number }
const META: Record<View, { title: string; desc: string }> = {
  output: { title: 'Output tax', desc: 'GST charged on sales, less credit notes, month by month.' },
  input: { title: 'Input tax credit', desc: 'GST paid on purchases, less debit notes, month by month.' },
  CGST: { title: 'CGST ledger', desc: 'Central tax on intra-state supplies: output, input and the net for each month.' },
  SGST: { title: 'SGST ledger', desc: 'State tax on intra-state supplies: output, input and the net for each month.' },
  IGST: { title: 'IGST ledger', desc: 'Integrated tax on inter-state supplies: output, input and the net for each month.' },
};

export default function GstLedger({ view }: { view: View }) {
  const m = META[view];
  const toast = useToast();
  const range = useGstRange('fy');
  const component = view === 'output' || view === 'input' ? undefined : view;
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['gst-ledger', component, range.from, range.to], queryFn: () => api.get<Row[]>('/api/gst/ledger', { from: range.from, to: range.to, component }) });
  const rows = data ?? [];
  const sum = (k: keyof Row) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const showOut = view !== 'input', showIn = view !== 'output';
  const exportXlsx = async () => {
    const columns = [{ key: 'm', label: 'Month' },
      ...(showOut ? [{ key: 'o', label: 'Output', money: true }, { key: 'c', label: 'Credit notes', money: true }, { key: 'no', label: 'Net output', money: true }] : []),
      ...(showIn ? [{ key: 'i', label: 'Input', money: true }, { key: 'd', label: 'Debit notes', money: true }, { key: 'ni', label: 'Net input', money: true }] : []),
      ...(showOut && showIn ? [{ key: 'n', label: 'Net payable', money: true }] : [])];
    const body = rows.map(r => ({ m: monthLabel(r.period), o: r.output, c: r.creditNotes, no: r.netOutput, i: r.input, d: r.debitNotes, ni: r.netInput, n: r.net }));
    try { await exportTable({ title: m.title, subtitle: `${date(range.from)} – ${date(range.to)}`, format: 'xlsx', columns, rows: body }); }
    catch (e) { toast.error('Export failed', errorMessage(e)); }
  };
  return (
    <div className="page">
      <PageHeader title={m.title} desc={m.desc} actions={<button className="btn" onClick={exportXlsx} disabled={!rows.length}><Download aria-hidden />Export</button>} />
      <GstRangeBar range={range} />
      <UnregisteredNotice />
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : <>
        <StatStrip loading={isLoading} items={[
          ...(showOut ? [{ label: 'Net output tax', value: money(sum('netOutput'), { decimals: false }) }] : []),
          ...(showIn ? [{ label: 'Net input credit', value: money(sum('netInput'), { decimals: false }), tone: 'ok' as const }] : []),
          ...(showOut && showIn ? [{ label: sum('net') >= 0 ? 'Net payable' : 'Credit carried forward', value: money(Math.abs(sum('net')), { decimals: false }), tone: sum('net') > 0 ? 'warn' as const : undefined }] : []),
        ]} />
        <Card title="By month">
          {isLoading ? <SkeletonRows rows={4} /> : <>
            <BarChart label={`${m.title} by month`} labels={rows.map(r => monthLabel(r.period))} series={[
              ...(showOut ? [{ name: 'Net output', values: rows.map(r => r.netOutput), color: VIZ[0] }] : []),
              ...(showIn ? [{ name: 'Net input', values: rows.map(r => r.netInput), color: VIZ[2] }] : []),
            ]} />
          </>}
        </Card>
        <Card bodyClass="">
          <div className="table-scroll"><table className="data">
            <thead><tr><th>Month</th>
              {showOut && <><th className="num">Output</th><th className="num">Credit notes</th><th className="num">Net output</th></>}
              {showIn && <><th className="num">Input</th><th className="num">Debit notes</th><th className="num">Net input</th></>}
              {showOut && showIn && <th className="num">Net payable</th>}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.period}><td className="medium">{monthLabel(r.period)}</td>
                {showOut && <><td className="num">{money(r.output)}</td><td className="num">{r.creditNotes ? `−${money(r.creditNotes)}` : '—'}</td><td className="num medium">{money(r.netOutput)}</td></>}
                {showIn && <><td className="num">{money(r.input)}</td><td className="num">{r.debitNotes ? `−${money(r.debitNotes)}` : '—'}</td><td className="num medium">{money(r.netInput)}</td></>}
                {showOut && showIn && <td className={`num medium ${r.net > 0 ? 't-warn' : 't-ok'}`}>{money(r.net)}</td>}</tr>
            ))}</tbody>
            {rows.length > 1 && <tfoot><tr><td>Total</td>
              {showOut && <><td className="num">{money(sum('output'))}</td><td className="num">{money(sum('creditNotes'))}</td><td className="num">{money(sum('netOutput'))}</td></>}
              {showIn && <><td className="num">{money(sum('input'))}</td><td className="num">{money(sum('debitNotes'))}</td><td className="num">{money(sum('netInput'))}</td></>}
              {showOut && showIn && <td className="num">{money(sum('net'))}</td>}</tr></tfoot>}
          </table></div>
        </Card>
      </>}
    </div>
  );
}
