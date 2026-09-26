import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { download, errorMessage } from '@/lib/api';
import { date } from '@/lib/format';
import { useToast } from '@/app/providers';
import { Card, Notice, PageHeader } from '@/components/ui/display';
import { GstRangeBar, useGstRange } from './common';

const SHEETS = [
  ['Summary', 'Output, input and net tax for the period'], ['B2B', 'Invoices to GSTIN holders (GSTR-1 table 4)'],
  ['B2CL', `Inter-state B2C invoices above ₹1,00,000 (table 5)`], ['B2CS', 'Other B2C supplies by state and rate (table 7)'],
  ['CDNR / CDNUR', 'Credit notes to registered and unregistered buyers (table 9B)'], ['HSN', 'HSN-wise summary (table 12)'],
  ['Docs', 'Documents issued and cancelled (table 13)'], ['Purchases / Debit notes', 'Input tax detail for GSTR-3B and reconciliation with GSTR-2B'],
];

export default function GstExport() {
  const toast = useToast();
  const range = useGstRange('lastMonth');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await download('GET', `/api/gst/export?from=${range.from}&to=${range.to}`, `GST ${range.from} to ${range.to}.xlsx`); toast.success('GST workbook downloaded'); }
    catch (e) { toast.error('Export failed', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHeader title="Export GST data" desc="One Excel workbook laid out like GSTR-1, for your accountant or for entering on the GST portal." />
      <GstRangeBar range={range} />
      <Card title={`Workbook for ${date(range.from)} – ${date(range.to)}`} footer={<div className="row between wrap gap-3"><span className="text-sm muted">The export is recorded in the activity log.</span>
        <button className="btn btn-primary" onClick={go} aria-busy={busy} disabled={busy}><FileSpreadsheet aria-hidden />Download Excel</button></div>}>
        <ul className="list-plain stack gap-3">{SHEETS.map(([n, d]) => <li key={n} className="row top gap-3"><span className="mono medium" style={{ minWidth: 190 }}>{n}</span><span className="soft">{d}</span></li>)}</ul>
      </Card>
      <Notice tone="info">Figures are read from the saved invoices, returns and purchase bills, so they always match the printed documents. Check the <b>Docs</b> sheet for cancelled numbers before filing.</Notice>
    </div>
  );
}
