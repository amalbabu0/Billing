import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Save, Send, Trash2, Truck, Wrench } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { addDays, iso, isoInput, money } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { P } from '@/lib/perms';
import type { Customer, LineInput, Preview, Product, Quotation, SalesOrder, Sellable } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { Card, EmptyState, Notice, PageHeader } from '@/components/ui/display';
import { NumberInput, Switch, TextArea, TextInput } from '@/components/ui/form';
import { CustomerPicker, ProductPicker } from '@/components/pickers';
import { QuickCustomerModal } from '@/components/CustomerForm';
import { WhatsAppDialog } from '@/components/DocActions';

interface EditLine extends LineInput { key: string; productId?: number; variantName?: string; productName: string }
const k = () => Math.random().toString(36).slice(2, 8);

/**
 * Quotation and sales-order editor. Follows the natural conversation with a customer:
 * customer → furniture → variant → quantity → discount → GST → delivery → installation → total.
 */
export default function DocEditor({ kind }: { kind: 'quotation' | 'order' }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = !!id;
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const d = lookups?.defaults;
  const isQ = kind === 'quotation';
  const base = isQ ? '/api/quotations' : '/api/sales-orders';

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [delivery, setDelivery] = useState(!isQ);
  const [installation, setInstallation] = useState(false);
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const [installationCharge, setInstallationCharge] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [dateField, setDateField] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState<string | undefined>();
  const [newCustomer, setNewCustomer] = useState<{ open: boolean; name?: string }>({ open: false });
  const [wa, setWa] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { if (d && !editing && !dateField) setDateField(iso(addDays(new Date(), isQ ? d.quotationValidityDays : 7))); }, [d, editing, isQ, dateField]);

  // Prefill customer from ?customerId= (e.g. "New quotation" from a customer profile).
  const pre = params.get('customerId');
  useEffect(() => { if (pre && !editing) api.get<Customer>(`/api/customers/${pre}`).then(setCustomer).catch(() => {}); }, [pre, editing]);

  const existing = useQuery({
    queryKey: [kind, Number(id)], enabled: editing,
    queryFn: async () => isQ ? (await api.get<{ quotation: Quotation }>(`${base}/${id}`)).quotation : (await api.get<{ order: SalesOrder }>(`${base}/${id}`)).order,
  });
  useEffect(() => {
    const doc = existing.data;
    if (!doc) return;
    api.get<Customer>(`/api/customers/${doc.customerId}`).then(setCustomer).catch(() => {});
    setLines(doc.lines.map(l => ({ key: k(), variantId: l.variantId, description: l.description, sku: l.sku, hsnCode: l.hsnCode, quantity: l.quantity, unitPrice: l.unitPrice, priceIncludesGst: l.priceIncludesGst, gstRate: l.gstRate, discountPercent: l.discountPercent, discountAmount: l.discountAmount, productName: l.description, sourceItemId: l.sourceItemId })));
    setDeliveryCharge(doc.deliveryCharge); setInstallationCharge(doc.installationCharge);
    setDelivery(doc.deliveryCharge > 0 || ('requiresDelivery' in doc && (doc as SalesOrder).requiresDelivery));
    setInstallation(doc.installationCharge > 0 || ('requiresInstallation' in doc && (doc as SalesOrder).requiresInstallation));
    setDeliveryAddress(doc.deliveryAddress ?? ''); setNotes(doc.notes ?? ''); setTerms(doc.terms);
    setDateField(isoInput(isQ ? (doc as Quotation).validUntil : (doc as SalesOrder).expectedDeliveryDate));
  }, [existing.data, isQ]);

  const input = useMemo(() => customer && lines.length ? {
    id: editing ? Number(id) : 0, customerId: customer.id,
    lines: lines.map(({ key: _k, productId: _p, variantName: _v, productName: _n, ...l }) => l),
    deliveryCharge: delivery ? deliveryCharge : 0, installationCharge: installation ? installationCharge : 0,
    deliveryAddress: delivery ? deliveryAddress || undefined : undefined, requiresDelivery: delivery, requiresInstallation: installation,
    notes: notes || undefined, terms,
    validUntil: isQ ? dateField || undefined : undefined, expectedDeliveryDate: !isQ ? dateField || undefined : undefined,
  } : null, [customer, lines, delivery, installation, deliveryCharge, installationCharge, deliveryAddress, notes, terms, dateField, isQ, editing, id]);
  const dInput = useDebounced(input, 200);
  const preview = useQuery({ queryKey: ['doc-preview', dInput], queryFn: () => api.post<Preview>('/api/sales/preview', dInput), enabled: !!dInput, placeholderData: p => p, retry: false });
  const t = lines.length ? preview.data?.totals : undefined;

  const add = (s: Sellable) => setLines(ls => {
    const ex = ls.find(l => l.variantId === s.variantId);
    if (ex) return ls.map(l => (l === ex ? { ...l, quantity: l.quantity + 1 } : l));
    return [...ls, { key: k(), variantId: s.variantId, productId: s.productId, productName: s.productName, variantName: s.variantName, description: '', sku: s.sku, hsnCode: s.hsnCode, quantity: 1, unitPrice: s.sellingPrice, priceIncludesGst: s.priceIncludesGst, gstRate: s.gstRate, discountPercent: s.discountPercent, discountAmount: 0 }];
  });
  const upd = (key: string, p: Partial<EditLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: async (then: 'draft' | 'send' | 'confirm') => {
      const e: Record<string, string> = {};
      if (!customer) e.customer = 'Choose the customer.';
      if (!lines.length) e.lines = 'Add at least one item.';
      setErrors(e);
      if (Object.keys(e).length) throw new Error(Object.values(e)[0]);
      const r = await api.post<{ id: number }>(base, input);
      if (then === 'send') await api.post(`/api/quotations/${r.id}/status`, { status: 'SENT' });
      if (then === 'confirm') await api.post(`/api/sales-orders/${r.id}/confirm`);
      return { id: r.id, then };
    },
    onSuccess: ({ id: newId, then }) => {
      qc.invalidateQueries({ queryKey: [isQ ? 'quotations' : 'sales-orders'] });
      qc.invalidateQueries({ queryKey: [kind, newId] });
      toast.success(isQ ? (then === 'send' ? 'Quotation saved and marked sent' : 'Quotation saved') : then === 'confirm' ? 'Order confirmed — stock reserved' : 'Sales order saved');
      if (then === 'send') setWa(newId);
      else nav(isQ ? `/sales/quotations/${newId}` : `/sales/orders/${newId}`);
    },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });

  const rates = (lookups?.gstRates ?? []).map(r => r.rate);
  const title = `${editing ? 'Edit' : 'New'} ${isQ ? 'quotation' : 'sales order'}`;

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: isQ ? 'Quotations' : 'Sales orders', to: isQ ? '/sales/quotations' : '/sales/orders' }, { label: editing ? `Edit` : 'New' }]}
        title={title}
        desc={isQ ? 'Prices and GST are worked out exactly as on the final invoice. Nothing is reserved until the quotation becomes an order.'
          : 'Confirming the order reserves stock so it isn’t sold to anyone else. Take an advance from the order page.'} />

      <div className="doc-layout">
        <div className="stack gap-4">
          <Card title="1 · Customer">
            <div style={{ maxWidth: 520 }}>
              <CustomerPicker value={customer} onChange={setCustomer} error={errors.customer} autoFocus={!editing}
                onCreate={can(P.CustomerManage) ? name => setNewCustomer({ open: true, name }) : undefined} />
            </div>
          </Card>

          <Card title="2 · Furniture" sub="Search by name or SKU, then set variant, quantity, discount and GST" bodyClass="">
            <div className="card-body" style={{ paddingBottom: 12 }}><ProductPicker onPick={add} label="Add furniture" /></div>
            {errors.lines && <div style={{ padding: '0 20px 12px' }}><Notice tone="bad">{errors.lines}</Notice></div>}
            {lines.length === 0 ? <EmptyState compact icon={<FileText />} title="No items yet" desc="Add the pieces the customer is interested in." /> : (
              <div className="table-scroll">
                <table className="data line-editor">
                  <thead><tr><th>Item</th><th style={{ width: 90 }} className="num">Qty</th><th style={{ width: 140 }} className="num">Rate</th><th style={{ width: 90 }} className="num">Disc %</th><th style={{ width: 90 }}>GST</th><th className="num" style={{ width: 130 }}>Amount</th><th style={{ width: 40 }} /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.key}>
                        <td>
                          <div className="cell-title">{l.productName}</div>
                          <div className="row gap-2 text-xs muted" style={{ marginTop: 2 }}><span className="mono">{l.sku}</span>{l.productId && <VariantPicker line={l} onChange={p => upd(l.key, p)} />}</div>
                        </td>
                        <td><NumberInput value={l.quantity} min={0} aria-label="Quantity" onChange={v => upd(l.key, { quantity: v ?? 0 })} /></td>
                        <td><NumberInput money value={l.unitPrice} aria-label="Rate" disabled={!can(P.InvoiceDiscount)} onChange={v => upd(l.key, { unitPrice: v ?? 0 })} />
                          <div className="text-xs muted right" style={{ marginTop: 2 }}>{l.priceIncludesGst ? 'incl. GST' : 'excl. GST'}</div></td>
                        <td><NumberInput value={l.discountPercent} min={0} max={100} aria-label="Discount percent" onChange={v => upd(l.key, { discountPercent: v ?? 0, discountAmount: 0 })} /></td>
                        <td><select className="select input-sm" style={{ height: 32 }} value={l.gstRate} aria-label="GST rate" onChange={e => upd(l.key, { gstRate: Number(e.target.value) })}>{rates.map(r => <option key={r} value={r}>{r}%</option>)}</select></td>
                        <td className="num"><b className="money">{money(preview.data?.lines[i]?.lineTotal ?? l.unitPrice * l.quantity)}</b><div className="text-xs muted">GST {money(preview.data?.lines[i]?.tax ?? 0)}</div></td>
                        <td><button className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${l.productName}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><Trash2 /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.data?.discountWarning && <div style={{ padding: '0 20px 16px' }}><Notice tone="warn">{preview.data.discountWarning}</Notice></div>}
          </Card>

          <Card title="3 · Delivery & installation">
            <div className="stack gap-4">
              <div className="row wrap gap-6">
                <Switch label={<span className="row gap-2"><Truck aria-hidden style={{ width: 16 }} />Home delivery</span>} checked={delivery} onChange={v => { setDelivery(v); if (v && !deliveryCharge) setDeliveryCharge(d?.defaultDeliveryCharge ?? 0); }} />
                <Switch label={<span className="row gap-2"><Wrench aria-hidden style={{ width: 16 }} />Installation</span>} checked={installation} onChange={v => { setInstallation(v); if (v && !installationCharge) setInstallationCharge(d?.defaultInstallationCharge ?? 0); }} />
              </div>
              <div className="grid grid-3">
                {delivery && <NumberInput label="Delivery charge" money value={deliveryCharge} onChange={v => setDeliveryCharge(v ?? 0)} hint={`GST ${d?.chargesGstRate ?? 18}% added`} />}
                {installation && <NumberInput label="Installation charge" money value={installationCharge} onChange={v => setInstallationCharge(v ?? 0)} hint={`GST ${d?.chargesGstRate ?? 18}% added`} />}
                <TextInput label={isQ ? 'Valid until' : 'Expected delivery'} type="date" value={dateField} min={iso()} onChange={e => setDateField(e.target.value)} />
              </div>
              {delivery && <TextInput label="Delivery address" optional value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder={customer?.billingAddress ?? 'Same as billing address'} />}
            </div>
          </Card>

          <Card title="4 · Notes">
            <div className="grid grid-2">
              <TextArea label="Note to customer" optional rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Fabric sample to be approved before production" />
              <TextArea label="Terms" optional rows={3} value={terms ?? ''} onChange={e => setTerms(e.target.value || undefined)} placeholder="Leave empty to use the terms from Settings → Invoice" />
            </div>
          </Card>
        </div>

        <aside className="doc-side">
          <Card title="Total">
            <dl className="totals" style={{ opacity: preview.isFetching ? 0.6 : 1 }}>
              <dt>Subtotal</dt><dd>{money(t?.subtotal ?? 0)}</dd>
              {(t?.discountTotal ?? 0) > 0 && <><dt>Discount</dt><dd className="t-ok">−{money(t!.discountTotal)}</dd></>}
              {delivery && <><dt>Delivery</dt><dd>{money(t?.deliveryCharge ?? 0)}</dd></>}
              {installation && <><dt>Installation</dt><dd>{money(t?.installationCharge ?? 0)}</dd></>}
              <dt>Taxable</dt><dd>{money(t?.taxableTotal ?? 0)}</dd>
              {preview.data?.isInterState ? <><dt>IGST</dt><dd>{money(t?.igstTotal ?? 0)}</dd></> : <><dt>CGST</dt><dd>{money(t?.cgstTotal ?? 0)}</dd><dt>SGST</dt><dd>{money(t?.sgstTotal ?? 0)}</dd></>}
              {(t?.roundOff ?? 0) !== 0 && <><dt>Round off</dt><dd>{money(t!.roundOff)}</dd></>}
              <dt className="grand">Grand total</dt><dd className="grand">{money(t?.grandTotal ?? 0)}</dd>
            </dl>
            {preview.data?.placeOfSupplyName && <p className="text-xs muted" style={{ marginTop: 8 }}>Place of supply {preview.data.placeOfSupplyName} · {preview.data.isInterState ? 'IGST' : 'CGST + SGST'}</p>}
            {preview.isError && <div style={{ marginTop: 12 }}><Notice tone="bad">{errorMessage(preview.error)}</Notice></div>}
            <div className="stack gap-2" style={{ marginTop: 16 }}>
              {isQ ? (
                <>
                  <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending} aria-busy={save.isPending && save.variables === 'send'} onClick={() => save.mutate('send')}><Send aria-hidden />Save & send on WhatsApp</button>
                  <button className="btn btn-block" disabled={save.isPending} aria-busy={save.isPending && save.variables === 'draft'} onClick={() => save.mutate('draft')}><Save aria-hidden />Save draft</button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending} aria-busy={save.isPending && save.variables === 'confirm'} onClick={() => save.mutate('confirm')}><CheckCircle2 aria-hidden />Save & confirm order</button>
                  <button className="btn btn-block" disabled={save.isPending} aria-busy={save.isPending && save.variables === 'draft'} onClick={() => save.mutate('draft')}><Save aria-hidden />Save as draft</button>
                </>
              )}
            </div>
          </Card>
        </aside>
      </div>
      <QuickCustomerModal open={newCustomer.open} initialName={newCustomer.name} onClose={() => setNewCustomer({ open: false })} onSaved={setCustomer} />
      <WhatsAppDialog open={wa !== null} onClose={() => { const x = wa; setWa(null); if (x) nav(`/sales/quotations/${x}`); }} url={`/api/quotations/${wa}/whatsapp`} pdfUrl={`/api/quotations/${wa}/pdf?download=true`} pdfName="quotation.pdf" />
    </div>
  );
}

function VariantPicker({ line, onChange }: { line: EditLine; onChange: (p: Partial<EditLine>) => void }) {
  const { data } = useQuery({ queryKey: ['product', line.productId], queryFn: () => api.get<Product>(`/api/products/${line.productId}`), staleTime: 60_000 });
  const vs = data?.variants.filter(v => v.isActive) ?? [];
  if (vs.length <= 1) return line.variantName && line.variantName !== 'Standard' ? <span>{line.variantName}</span> : null;
  return (
    <select className="select input-sm" style={{ height: 24, fontSize: 12, width: 'auto', paddingRight: 24 }} value={line.variantId ?? ''} aria-label="Variant"
      onChange={e => { const v = vs.find(x => x.id === Number(e.target.value)); if (v) onChange({ variantId: v.id, variantName: v.variantName, sku: v.sku, unitPrice: v.sellingPrice ?? data!.sellingPrice }); }}>
      {vs.map(v => <option key={v.id} value={v.id}>{v.variantName} · {money(v.sellingPrice ?? data!.sellingPrice, { decimals: false })}</option>)}
    </select>
  );
}
