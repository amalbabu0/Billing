import { useNavigate } from 'react-router-dom';
import { FileMinus, FileText } from 'lucide-react';
import { money, date, label } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { useLookups } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, DocNo, EmptyState, Money, PageHeader, Segmented, StatStrip, Status } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { GstRangeBar, UnregisteredNotice, useGstRange, type GstPage } from './common';

type Kind = 'sales' | 'purchases' | 'credit' | 'debit';
interface Row {
  id: number; number: string; date: string; placeOfSupply?: string; placeOfSupplyName?: string; taxable: number; cgst: number; sgst: number; igst: number; totalGst: number;
  // sales
  customerId?: number; customerName?: string; customerGstin?: string; isInterState?: boolean; invoiceTotal?: number; status?: string; paymentState?: string; type?: string;
  // purchases
  supplierId?: number; supplierName?: string; supplierGstin?: string; supplierInvoiceNo?: string; purchaseTotal?: number;
  // notes
  partyId?: number; partyName?: string; partyGstin?: string; originalId?: number; originalNumber?: string; reason?: string; noteTotal?: number;
}

const META: Record<Kind, { title: string; desc: string; url: string; party: string }> = {
  sales: { title: 'GST sales listing', desc: 'Every tax invoice with its taxable value and CGST / SGST / IGST split, as filed in GSTR-1.', url: '/api/gst/sales', party: 'Customer' },
  purchases: { title: 'GST purchase listing', desc: 'Completed purchase bills and the input tax credit they carry.', url: '/api/gst/purchases', party: 'Supplier' },
  credit: { title: 'Credit notes', desc: 'Sales returns that reduce output tax. Each note refers to its original invoice.', url: '/api/gst/credit-notes', party: 'Customer' },
  debit: { title: 'Debit notes', desc: 'Goods returned to suppliers; the input tax credit on them is reversed.', url: '/api/gst/debit-notes', party: 'Supplier' },
};

export default function GstListing({ kind }: { kind: Kind }) {
  const m = META[kind];
  const nav = useNavigate();
  const range = useGstRange();
  const { data: lookups } = useLookups();
  const list = usePagedList<Row>(`gst-${kind}`, m.url, { filterKeys: ['type', 'status', 'paymentState', 'stateCode', 'rate'], extra: { from: range.from, to: range.to }, defaults: { pageSize: 50 } });
  const { state, update } = list;
  const t = (list.query.data as unknown as GstPage<Row> | undefined)?.totals;
  const party = (r: Row) => r.customerName ?? r.supplierName ?? r.partyName ?? '';
  const gstin = (r: Row) => r.customerGstin ?? r.supplierGstin ?? r.partyGstin;
  const total = (r: Row) => r.invoiceTotal ?? r.purchaseTotal ?? r.noteTotal ?? 0;
  const cols: Column<Row>[] = [
    { key: 'number', header: kind === 'sales' ? 'Invoice' : kind === 'purchases' ? 'Purchase' : 'Note', sort: 'number', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'date', header: 'Date', sort: 'date', mobile: 'meta', render: r => date(r.date), exportValue: r => date(r.date) },
    { key: 'party', header: m.party, sort: kind === 'sales' ? 'customer' : kind === 'purchases' ? 'supplier' : undefined, mobile: 'sub', render: r => <div className="cell-stack"><span className="cell-title">{party(r)}</span>{gstin(r) ? <span className="cell-sub mono">{gstin(r)}</span> : <span className="cell-sub">Unregistered</span>}</div>, exportValue: party },
    { key: 'gstin', header: 'GSTIN', optional: true, render: r => <span className="mono text-sm">{gstin(r) ?? '—'}</span>, exportValue: r => gstin(r) ?? '' },
    ...(kind === 'purchases' ? [{ key: 'bill', header: 'Supplier bill', render: (r: Row) => r.supplierInvoiceNo ?? '—', exportValue: (r: Row) => r.supplierInvoiceNo } as Column<Row>] : []),
    ...(kind === 'credit' || kind === 'debit' ? [
      { key: 'orig', header: kind === 'credit' ? 'Against invoice' : 'Against purchase', render: (r: Row) => <span className="doc-no text-sm">{r.originalNumber}</span>, exportValue: (r: Row) => r.originalNumber } as Column<Row>,
      { key: 'reason', header: 'Reason', optional: true, render: (r: Row) => <span className="text-sm soft">{r.reason}</span>, exportValue: (r: Row) => r.reason } as Column<Row>,
    ] : []),
    ...(kind === 'sales' ? [{ key: 'type', header: 'Type', render: (r: Row) => <Badge tone={r.type === 'B2B' ? 'info' : 'muted'}>{r.type}</Badge>, exportValue: (r: Row) => r.type } as Column<Row>] : []),
    { key: 'pos', header: 'Place of supply', sort: kind === 'sales' ? 'pos' : undefined, optional: kind !== 'sales', render: r => r.placeOfSupply ? <span className="text-sm">{r.placeOfSupply} · {r.placeOfSupplyName}</span> : '—', exportValue: r => r.placeOfSupplyName },
    { key: 'taxable', header: 'Taxable', sort: kind === 'sales' || kind === 'purchases' ? 'taxable' : undefined, num: true, money: true, render: r => <Money value={r.taxable} />, exportValue: r => r.taxable, footer: t && money(t.taxable) },
    { key: 'cgst', header: 'CGST', num: true, money: true, render: r => <Money value={r.cgst} />, exportValue: r => r.cgst, footer: t && money(t.cgst) },
    { key: 'sgst', header: 'SGST', num: true, money: true, render: r => <Money value={r.sgst} />, exportValue: r => r.sgst, footer: t && money(t.sgst) },
    { key: 'igst', header: 'IGST', num: true, money: true, render: r => <Money value={r.igst} />, exportValue: r => r.igst, footer: t && money(t.igst) },
    { key: 'total', header: 'Total', sort: kind === 'sales' || kind === 'purchases' ? 'total' : undefined, num: true, money: true, mobile: 'right', render: r => <Money value={total(r)} strong />, exportValue: total, footer: t && money(t.total) },
    ...(kind === 'sales' ? [{ key: 'status', header: 'Status', optional: true, render: (r: Row) => r.status === 'CANCELLED' ? <Status value="CANCELLED" /> : <Status value={r.paymentState} />, exportValue: (r: Row) => label(r.status === 'CANCELLED' ? r.status : r.paymentState) } as Column<Row>] : []),
  ];
  const open = (r: Row) => {
    if (kind === 'sales') nav(`/sales/invoices/${r.id}`);
    else if (kind === 'purchases') nav(`/purchases/${r.id}`);
    else if (kind === 'credit' && r.originalId) nav(`/sales/invoices/${r.originalId}`);
    else if (kind === 'debit' && r.originalId) nav(`/purchases/${r.originalId}`);
  };
  return (
    <div className="page">
      <PageHeader title={m.title} desc={m.desc} />
      <GstRangeBar range={range} />
      <UnregisteredNotice />
      <StatStrip loading={!t} items={[
        { label: 'Documents', value: t?.count ?? 0 }, { label: 'Taxable value', value: money(t?.taxable, { decimals: false }) },
        { label: kind === 'sales' || kind === 'debit' ? 'Output tax' : 'Input tax', value: money(t?.tax, { decimals: false }) },
        { label: 'Total value', value: money(t?.total, { decimals: false }) },
      ]} />
      <DataTable id={`gst-${kind}`} label={m.title} columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={open}
        rowClass={r => (r.status === 'CANCELLED' ? 'muted-row' : undefined)}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder={`Number, ${m.party.toLowerCase()} or GSTIN`} />
          {kind === 'sales' && <Segmented value={state.filters.type ?? ''} onChange={x => update({ filters: { type: x || undefined } })} label="Type" options={[{ value: '', label: 'All' }, { value: 'B2B', label: 'B2B' }, { value: 'B2C', label: 'B2C' }]} />}
          <select className="select input-sm" style={{ width: 120 }} aria-label="GST rate" value={state.filters.rate ?? ''} onChange={e => update({ filters: { rate: e.target.value || undefined } })}>
            <option value="">All rates</option>{(lookups?.gstRates ?? []).map(r => <option key={r.id} value={r.rate}>{r.rate}%</option>)}
          </select>
          <select className="select input-sm" style={{ width: 170 }} aria-label="Place of supply" value={state.filters.stateCode ?? ''} onChange={e => update({ filters: { stateCode: e.target.value || undefined } })}>
            <option value="">All states</option>{(lookups?.states ?? []).map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
          {kind === 'sales' && <select className="select input-sm" style={{ width: 150 }} aria-label="Status" value={state.filters.status ?? ''} onChange={e => update({ filters: { status: e.target.value || undefined } })}>
            <option value="">Final + cancelled</option><option value="FINAL">Final only</option><option value="CANCELLED">Cancelled only</option>
          </select>}
          {(kind === 'sales' || kind === 'purchases') && <select className="select input-sm" style={{ width: 140 }} aria-label="Payment" value={state.filters.paymentState ?? ''} onChange={e => update({ filters: { paymentState: e.target.value || undefined } })}>
            <option value="">Any payment</option><option value="PAID">Paid</option><option value="PARTIAL">Partly paid</option><option value="UNPAID">Unpaid</option>{kind === 'sales' && <option value="OVERDUE">Overdue</option>}
          </select>}
        </>}
        empty={<EmptyState icon={kind === 'credit' || kind === 'debit' ? <FileMinus /> : <FileText />} title="Nothing in this period" desc="Change the period or clear the filters." />}
        exportAs={{ title: m.title, subtitle: `${date(range.from)} – ${date(range.to)}`, fetchAll: list.fetchAll, totals: t ? [{ label: 'Taxable', value: money(t.taxable) }, { label: 'Tax', value: money(t.tax) }, { label: 'Total', value: money(t.total) }] : undefined }} />
    </div>
  );
}
