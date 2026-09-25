import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, RotateCcw, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, money, qty } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import type { Exchange, Invoice, InvoiceRow, Paged, Preview, Sellable } from '@/lib/types';
import { useLookups, useToast } from '@/app/providers';
import { Card, DocNo, EmptyState, KV, Money, Notice, PageHeader, Segmented, Status } from '@/components/ui/display';
import { NumberInput, SearchInput, TextArea } from '@/components/ui/form';
import { ProductPicker } from '@/components/pickers';

const REASONS = [
  ['CUSTOMER_REQUEST', 'Customer changed mind'], ['DAMAGED', 'Damaged'], ['MANUFACTURING_DEFECT', 'Manufacturing defect'],
  ['WRONG_PRODUCT', 'Wrong product delivered'], ['EXCHANGE', 'Exchange'], ['OTHER', 'Other'],
];
const CONDITIONS = [['GOOD', 'Good — resell'], ['DAMAGED', 'Damaged'], ['DEFECTIVE', 'Defective']];
const RESTOCK: Record<string, string> = { GOOD: 'RESTOCK', DAMAGED: 'DAMAGED_STOCK', DEFECTIVE: 'DAMAGED_STOCK' };

interface RLine { invoiceItemId: number; quantity: number; condition: string; restockAction: string }
interface NLine { key: string; variantId: number; description: string; sku: string; quantity: number; unitPrice: number; priceIncludesGst: boolean; gstRate: number; discountPercent: number; discountAmount: number }

/** Sales return, or an exchange (return + new items, pay only the difference), against one invoice. */
export default function NewReturn() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const invoiceId = params.get('invoice');
  const [mode, setMode] = useState<'return' | 'exchange'>(params.get('exchange') ? 'exchange' : 'return');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const found = useQuery({ queryKey: ['invoice-find', q], queryFn: () => api.get<Paged<InvoiceRow>>('/api/invoices', { search: q, status: 'FINAL', pageSize: 8 }), enabled: !invoiceId && q.length > 1 });
  const inv = useQuery({ queryKey: ['invoice', Number(invoiceId)], queryFn: () => api.get<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`), enabled: !!invoiceId });
  const invoice = inv.data?.invoice;

  const [lines, setLines] = useState<Record<number, RLine>>({});
  const [reason, setReason] = useState('CUSTOMER_REQUEST');
  const [notes, setNotes] = useState('');
  const [refund, setRefund] = useState<number | null>(0);
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [newLines, setNewLines] = useState<NLine[]>([]);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState('CASH');
  useEffect(() => { if (mode === 'exchange') setReason('EXCHANGE'); }, [mode]);

  const returnLines = Object.values(lines).filter(l => l.quantity > 0);
  const creditEstimate = invoice ? returnLines.reduce((s, l) => { const it = invoice.lines.find(x => x.id === l.invoiceItemId)!; return s + (it.lineTotal * l.quantity) / it.quantity; }, 0) : 0;
  const overpaidAfter = invoice ? Math.max(0, invoice.paid - (invoice.netTotal - creditEstimate)) : 0;

  // Exchange: price the new items with the server calculator, then ask the server what the customer pays.
  const newDoc = useMemo(() => invoice && newLines.length ? { customerId: invoice.customerId, lines: newLines.map(({ key: _k, ...l }) => l), deliveryCharge: 0, installationCharge: 0 } : null, [invoice, newLines]);
  const dNewDoc = useDebounced(newDoc, 200);
  const newPreview = useQuery({ queryKey: ['exch-preview', dNewDoc], queryFn: () => api.post<Preview>('/api/sales/preview', dNewDoc), enabled: !!dNewDoc, placeholderData: p => p });
  const newTotal = newLines.length ? newPreview.data?.totals.grandTotal ?? 0 : 0;
  const exch = useQuery({
    queryKey: ['exch', invoice?.id, returnLines, newTotal],
    queryFn: () => api.post<{ oldValue: number; newValue: number; creditAvailable: number; difference: number; oldInvoiceOutstanding: number }>('/api/exchanges/preview', { input: { originalInvoiceId: invoice!.id, returnLines }, newInvoiceTotal: newTotal }),
    enabled: mode === 'exchange' && !!invoice && returnLines.length > 0,
  });
  useEffect(() => { if (exch.data) setPayAmount(exch.data.difference); }, [exch.data?.difference]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('Choose the invoice.');
      if (!returnLines.length) throw new Error('Enter the quantity being returned.');
      if (mode === 'return') return api.post<{ id: number; number: string; credit: number }>('/api/returns', { invoiceId: invoice.id, reason, notes: notes || undefined, lines: returnLines, refundAmount: refund ?? 0, refundMethod });
      if (!newDoc) throw new Error('Add the new items the customer is taking.');
      return api.post<Exchange>('/api/exchanges', {
        originalInvoiceId: invoice.id, returnLines, newInvoice: newDoc, notes: notes || undefined,
        payments: payAmount && payAmount > 0 ? [{ methodCode: payMethod, amount: payAmount }] : [],
      });
    },
    onSuccess: r => {
      ['invoice', 'invoices', 'returns', 'exchanges', 'dashboard', 'inventory', 'customer'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      if (mode === 'return') { const x = r as { number: string; credit: number }; toast.success(`Return ${x.number} recorded`, `Credit ${money(x.credit)}. Stock updated.`); nav('/sales/returns'); }
      else { const x = r as Exchange; toast.success(`Exchange ${x.number} done`, `New invoice ${x.newInvoiceNumber}`); nav(`/sales/invoices/${x.newInvoiceId}`); }
    },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Sales returns', to: '/sales/returns' }, { label: 'New' }]} title={mode === 'return' ? 'Sales return' : 'Exchange'}
        desc={mode === 'return' ? 'Take back items from an invoice. Good pieces go back to stock; damaged ones to damaged stock. The value becomes a GST credit note.'
          : 'Return items and bill new ones in one step. Money already paid for the returned pieces is applied — the customer pays only the difference.'}
        actions={<Segmented value={mode} onChange={setMode} label="Type" options={[{ value: 'return', label: 'Return', icon: <RotateCcw /> }, { value: 'exchange', label: 'Exchange', icon: <ArrowLeftRight /> }]} />} />

      {!invoiceId ? (
        <Card title="Find the invoice">
          <SearchInput value={search} onChange={setSearch} placeholder="Invoice number, customer name or mobile" autoFocus />
          <div className="stack" style={{ marginTop: 12 }}>
            {(found.data?.items ?? []).map(i => (
              <button key={i.id} className="list-row" style={{ padding: '10px 4px' }} onClick={() => setParams({ invoice: String(i.id), ...(mode === 'exchange' ? { exchange: '1' } : {}) })}>
                <DocNo>{i.number}</DocNo><span className="grow">{i.customerName} <span className="muted">· {date(i.invoiceDate)}</span></span><Status value={i.paymentState} /><Money value={i.grandTotal} />
              </button>
            ))}
            {q.length > 1 && found.data?.items.length === 0 && <p className="muted text-sm">No final invoices match.</p>}
          </div>
        </Card>
      ) : !invoice ? <p className="muted">Loading invoice…</p> : (
        <div className="doc-layout">
          <div className="stack gap-4">
            <Card title={<>Items on <span className="doc-no">{invoice.number}</span></>} sub={`${invoice.customerName} · ${date(invoice.date)}`} bodyClass=""
              actions={<button className="btn btn-sm btn-ghost" onClick={() => setParams({})}>Change invoice</button>}>
              <div className="table-scroll">
                <table className="data line-editor">
                  <thead><tr><th>Item</th><th className="num">Sold</th><th className="num">Returnable</th><th style={{ width: 100 }} className="num">Return qty</th><th style={{ width: 170 }}>Condition</th><th className="num">Credit</th></tr></thead>
                  <tbody>
                    {invoice.lines.map(l => {
                      const r = lines[l.id];
                      const left = l.quantity - l.returnedQty;
                      return (
                        <tr key={l.id} className={left <= 0 ? 'muted-row' : undefined}>
                          <td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td>
                          <td className="num">{qty(l.quantity)}</td>
                          <td className="num">{qty(left)}</td>
                          <td>{left > 0 && <NumberInput value={r?.quantity ?? 0} min={0} max={left} aria-label="Return quantity"
                            onChange={v => setLines(x => ({ ...x, [l.id]: { invoiceItemId: l.id, quantity: v ?? 0, condition: r?.condition ?? 'GOOD', restockAction: r?.restockAction ?? 'RESTOCK' } }))} />}</td>
                          <td>{r?.quantity ? (
                            <select className="select input-sm" style={{ height: 32 }} value={r.condition} aria-label="Condition"
                              onChange={e => setLines(x => ({ ...x, [l.id]: { ...r, condition: e.target.value, restockAction: RESTOCK[e.target.value] } }))}>
                              {CONDITIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                            </select>) : null}</td>
                          <td className="num">{r?.quantity ? <Money value={(l.lineTotal * r.quantity) / l.quantity} /> : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {mode === 'exchange' && (
              <Card title="New items the customer is taking" bodyClass="">
                <div className="card-body" style={{ paddingBottom: 12 }}>
                  <ProductPicker onPick={(s: Sellable) => setNewLines(ls => [...ls, { key: Math.random().toString(36), variantId: s.variantId, description: s.displayName, sku: s.sku, quantity: 1, unitPrice: s.sellingPrice, priceIncludesGst: s.priceIncludesGst, gstRate: s.gstRate, discountPercent: 0, discountAmount: 0 }])} />
                </div>
                {newLines.length === 0 ? <EmptyState compact title="No new items yet" /> : (
                  <table className="data line-editor">
                    <tbody>{newLines.map((l, i) => (
                      <tr key={l.key}>
                        <td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td>
                        <td style={{ width: 90 }}><NumberInput value={l.quantity} min={1} aria-label="Quantity" onChange={v => setNewLines(ls => ls.map(x => (x.key === l.key ? { ...x, quantity: v ?? 1 } : x)))} /></td>
                        <td className="num" style={{ width: 140 }}><Money value={newPreview.data?.lines[i]?.lineTotal ?? l.unitPrice * l.quantity} strong /></td>
                        <td style={{ width: 40 }}><button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => setNewLines(ls => ls.filter(x => x.key !== l.key))}><Trash2 /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </Card>
            )}
          </div>

          <aside className="doc-side">
            <Card title={mode === 'return' ? 'Return summary' : 'Exchange summary'}>
              <div className="stack gap-4">
                <div className="field"><label className="field-label" htmlFor="rr">Reason</label>
                  <select id="rr" className="select" value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
                {mode === 'return' ? (
                  <>
                    <div className="pay-position">
                      <div className="row-line"><span>Credit for returned items</span><span>{money(creditEstimate)}</span></div>
                      <div className="row-line"><span>Paid on invoice</span><span>{money(invoice.paid)}</span></div>
                      <div className="row-line remaining"><span>Can be refunded</span><span>{money(overpaidAfter)}</span></div>
                    </div>
                    {overpaidAfter > 0 && (
                      <div className="grid grid-2">
                        <NumberInput label="Refund now" money value={refund} max={overpaidAfter} onChange={setRefund} hint="Rest stays as advance" />
                        <div className="field"><label className="field-label" htmlFor="rm">Refund by</label>
                          <select id="rm" className="select" value={refundMethod} onChange={e => setRefundMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
                      </div>
                    )}
                    {creditEstimate > 0 && overpaidAfter === 0 && <Notice tone="info">The credit reduces what the customer still owes on this invoice.</Notice>}
                  </>
                ) : (
                  <>
                    <div className="pay-position">
                      <div className="row-line"><span>Returned value</span><span>{money(exch.data?.oldValue ?? creditEstimate)}</span></div>
                      <div className="row-line"><span>New items</span><span>{money(newTotal)}</span></div>
                      <div className="row-line"><span>Already paid, carried over</span><span>−{money(Math.min(exch.data?.creditAvailable ?? 0, newTotal))}</span></div>
                      <div className="row-line remaining"><span>Customer pays</span><span className="t-warn">{money(exch.data?.difference ?? 0)}</span></div>
                    </div>
                    {(exch.data?.difference ?? 0) > 0 && (
                      <div className="grid grid-2">
                        <NumberInput label="Collect now" money value={payAmount} onChange={setPayAmount} />
                        <div className="field"><label className="field-label" htmlFor="pm">Method</label>
                          <select id="pm" className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
                      </div>
                    )}
                  </>
                )}
                <TextArea label="Note" optional rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                <KV items={[['Customer', invoice.customerName], ['Invoice balance', money(invoice.balance)]]} />
                <button className="btn btn-primary btn-lg btn-block" disabled={!returnLines.length || submit.isPending || (mode === 'exchange' && !newLines.length)} aria-busy={submit.isPending} onClick={() => submit.mutate()}>
                  {mode === 'return' ? 'Record return' : 'Complete exchange'}
                </button>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
