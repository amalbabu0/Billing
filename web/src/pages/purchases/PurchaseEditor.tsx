import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Save, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { iso, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { Purchase, Sellable, Supplier } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { Card, EmptyState, Notice, PageHeader } from '@/components/ui/display';
import { NumberInput, Switch, TextArea, TextInput } from '@/components/ui/form';
import { ProductPicker, SupplierPicker } from '@/components/pickers';

interface Line { key: string; variantId: number; description: string; sku: string; hsnCode?: string; quantity: number; unitCost: number; discountPercent: number; gstRate: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Purchase entry. Completing it adds the stock, updates cost and makes the amount payable to the supplier. */
export default function PurchaseEditor() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [billNo, setBillNo] = useState('');
  const [date, setDate] = useState(iso());
  const [due, setDue] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [other, setOther] = useState(0);
  const [notes, setNotes] = useState('');
  const [complete, setComplete] = useState(true);
  const [paidNow, setPaidNow] = useState<number | null>(0);
  const [method, setMethod] = useState('BANK');
  const [reference, setReference] = useState('');

  const existing = useQuery({ queryKey: ['purchase', Number(id)], queryFn: () => api.get<{ purchase: Purchase }>(`/api/purchases/${id}`), enabled: editing });
  useEffect(() => {
    const p = existing.data?.purchase;
    if (!p) return;
    api.get<Supplier>(`/api/suppliers/${p.supplierId}`).then(setSupplier).catch(() => {});
    setBillNo(p.supplierInvoiceNo ?? ''); setDate(p.purchaseDate.slice(0, 10)); setDue(p.dueDate?.slice(0, 10) ?? ''); setOther(p.otherCharges); setNotes(p.notes ?? '');
    setLines(p.lines.map(l => ({ key: String(l.id), variantId: l.variantId, description: l.description, sku: l.sku ?? '', hsnCode: l.hsnCode, quantity: l.quantity, unitCost: l.unitCost, discountPercent: l.discountPercent, gstRate: l.gstRate })));
  }, [existing.data]);

  const inter = !!supplier?.stateCode && supplier.stateCode !== me.shop.stateCode;
  // On-screen estimate only; the server recomputes with the shared GST calculator when saving.
  const t = useMemo(() => {
    let taxable = 0, tax = 0;
    for (const l of lines) { const tx = r2(l.quantity * l.unitCost * (1 - l.discountPercent / 100)); taxable += tx; tax += r2((tx * l.gstRate) / 100); }
    return { taxable: r2(taxable), tax: r2(tax), total: r2(taxable + tax + other) };
  }, [lines, other]);

  const add = async (s: Sellable) => {
    if (!s.isStockItem) { toast.info(`${s.displayName} is made to order`, 'Only stock items can be purchased.'); return; }
    setLines(ls => ls.some(l => l.variantId === s.variantId) ? ls.map(l => (l.variantId === s.variantId ? { ...l, quantity: l.quantity + 1 } : l))
      : [...ls, { key: Math.random().toString(36), variantId: s.variantId, description: s.displayName, sku: s.sku, hsnCode: s.hsnCode, quantity: 1, unitCost: s.costPrice ?? 0, discountPercent: 0, gstRate: s.gstRate }]);
  };
  const upd = (key: string, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: () => {
      if (!supplier) throw new Error('Choose the supplier.');
      if (!lines.length) throw new Error('Add at least one item.');
      const body = {
        supplierId: supplier.id, supplierInvoiceNo: billNo || undefined, date, dueDate: due || undefined, otherCharges: other, notes: notes || undefined,
        lines: lines.map(({ key: _k, sku: _s, ...l }) => l), complete, paidNow: complete ? paidNow ?? 0 : 0, paidMethod: method, paidReference: reference || undefined,
      };
      return editing ? api.put<{ id: number }>(`/api/purchases/${id}`, body) : api.post<{ id: number }>('/api/purchases', body);
    },
    onSuccess: r => {
      ['purchases', 'purchase', 'inventory', 'suppliers', 'dashboard', 'products'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(complete ? 'Purchase saved — stock received' : 'Purchase saved as draft');
      nav(`/purchases/${r.id}`);
    },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Purchases', to: '/purchases' }, { label: editing ? 'Edit draft' : 'New' }]} title={editing ? 'Edit purchase' : 'New purchase'}
        desc="Enter the supplier’s bill. Costs are ex-GST; input GST is tracked separately for your GST return." />
      <div className="doc-layout">
        <div className="stack gap-4">
          <Card title="Supplier & bill">
            <div className="stack gap-4">
              <div style={{ maxWidth: 520 }}><SupplierPicker value={supplier} onChange={setSupplier} /></div>
              <div className="grid grid-3">
                <TextInput label="Supplier bill no." value={billNo} onChange={e => setBillNo(e.target.value)} hint="Prevents entering the same bill twice" />
                <TextInput label="Bill date" type="date" value={date} max={iso()} onChange={e => setDate(e.target.value)} />
                <TextInput label="Payment due" optional type="date" value={due} onChange={e => setDue(e.target.value)} />
              </div>
              {supplier && <p className="text-xs muted">{inter ? 'Inter-state supplier → IGST' : 'Same state → CGST + SGST'}{supplier.gstin ? ` · GSTIN ${supplier.gstin}` : ' · supplier not GST registered'}</p>}
            </div>
          </Card>
          <Card title="Items received" bodyClass="">
            <div className="card-body" style={{ paddingBottom: 12 }}><ProductPicker onPick={add} label="Add item" showStock={false} /></div>
            {lines.length === 0 ? <EmptyState compact title="No items yet" desc="Search products or scan barcodes." /> : (
              <div className="table-scroll"><table className="data line-editor">
                <thead><tr><th>Item</th><th style={{ width: 90 }} className="num">Qty</th><th style={{ width: 140 }} className="num">Unit cost (ex-GST)</th><th style={{ width: 90 }} className="num">Disc %</th><th style={{ width: 90 }}>GST</th><th className="num" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>{lines.map(l => {
                  const tx = r2(l.quantity * l.unitCost * (1 - l.discountPercent / 100));
                  return (
                    <tr key={l.key}>
                      <td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td>
                      <td><NumberInput value={l.quantity} min={0} aria-label="Quantity" onChange={v => upd(l.key, { quantity: v ?? 0 })} /></td>
                      <td><NumberInput money value={l.unitCost} aria-label="Unit cost" onChange={v => upd(l.key, { unitCost: v ?? 0 })} /></td>
                      <td><NumberInput value={l.discountPercent} min={0} max={100} aria-label="Discount" onChange={v => upd(l.key, { discountPercent: v ?? 0 })} /></td>
                      <td><select className="select input-sm" style={{ height: 32 }} value={l.gstRate} aria-label="GST" onChange={e => upd(l.key, { gstRate: Number(e.target.value) })}>{(lookups?.gstRates ?? []).map(r => <option key={r.id} value={r.rate}>{r.rate}%</option>)}</select></td>
                      <td className="num"><b className="money">{money(tx * (1 + l.gstRate / 100))}</b><div className="text-xs muted">GST {money((tx * l.gstRate) / 100)}</div></td>
                      <td><button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><Trash2 /></button></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
          </Card>
          <Card title="Notes"><TextArea label="Internal note" optional rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Card>
        </div>
        <aside className="doc-side">
          <Card title="Bill total">
            <dl className="totals">
              <dt>Taxable</dt><dd>{money(t.taxable)}</dd>
              {inter ? <><dt>IGST</dt><dd>{money(t.tax)}</dd></> : <><dt>CGST</dt><dd>{money(t.tax / 2)}</dd><dt>SGST</dt><dd>{money(t.tax / 2)}</dd></>}
              <dt>Other charges</dt><dd style={{ width: 120 }}><NumberInput money value={other} onChange={v => setOther(v ?? 0)} aria-label="Other charges" /></dd>
              <dt className="grand">Total</dt><dd className="grand">{money(t.total)}</dd>
            </dl>
            <p className="text-xs muted" style={{ marginTop: 6 }}>Final figures (with round-off) are calculated when saved.</p>
            <div className="stack gap-3" style={{ marginTop: 16 }}>
              <Switch label="Goods received — add to stock now" checked={complete} onChange={setComplete} hint={complete ? 'Stock and supplier balance update on save.' : 'Saved as a draft; complete it later.'} />
              {complete && can(P.SupplierPay) && (
                <div className="grid grid-2">
                  <NumberInput label="Paid now" money value={paidNow} max={t.total} onChange={setPaidNow} />
                  <div className="field"><label className="field-label" htmlFor="pm">Method</label>
                    <select id="pm" className="select" value={method} onChange={e => setMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
                </div>
              )}
              {complete && (paidNow ?? 0) > 0 && method !== 'CASH' && <TextInput label="Payment reference" value={reference} onChange={e => setReference(e.target.value)} />}
              {!supplier && <Notice tone="info">Choose the supplier to start.</Notice>}
              <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending || !supplier || !lines.length} aria-busy={save.isPending} onClick={() => save.mutate()}>
                {complete ? <><PackageCheck aria-hidden />Save & receive stock</> : <><Save aria-hidden />Save draft</>}
              </button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
