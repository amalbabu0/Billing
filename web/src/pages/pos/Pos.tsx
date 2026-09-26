import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, Building2, CreditCard, FileClock, Heart, History, Landmark, Minus, NotebookPen, Package, Plus, Printer, QrCode, Receipt, ScanLine,
  Send, ShoppingCart, Star, Trash2, Truck, UserPlus, Wrench, X,
} from 'lucide-react';
import { api, ApiError, errorMessage, openPdf } from '@/lib/api';
import { money, qty as fmtQty, iso, addDays } from '@/lib/format';
import { useDebounced, useHotkey } from '@/lib/hooks';
import { P } from '@/lib/perms';
import type { CheckoutResult, Customer, Invoice, LineInput, PaymentLineInput, Preview, Product, Sellable } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { Badge, EmptyState, Notice, Segmented, StockLevel } from '@/components/ui/display';
import { NumberInput, SearchInput, TextArea, TextInput } from '@/components/ui/form';
import { Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { CustomerPicker } from '@/components/pickers';
import { QuickCustomerModal } from '@/components/CustomerForm';
import { WhatsAppDialog } from '@/components/DocActions';

interface BillLine extends LineInput { key: string; productId?: number; productName: string; variantName: string; available?: number; isStockItem?: boolean; listPrice: number }
interface Tender { key: string; methodCode: string; amount: number | null; reference: string; auto?: boolean }
interface Bill {
  customer: Customer | null; lines: BillLine[]; tenders: Tender[]; credit: boolean; useAdvance: boolean;
  delivery: boolean; installation: boolean; deliveryCharge: number; installationCharge: number; deliveryAddress: string; notes: string; dueDate: string; draftId?: number;
}
const STORE_KEY = 'fs:pos-bill';
const newKey = () => Math.random().toString(36).slice(2, 9);
const SHORT: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank', CHEQUE: 'Cheque', CREDIT: 'Credit' };
const METHOD_ICON: Record<string, typeof Banknote> = { CASH: Banknote, UPI: QrCode, CARD: CreditCard, BANK: Landmark, CHEQUE: NotebookPen, CREDIT: FileClock };

function blankBill(): Bill {
  return { customer: null, lines: [], tenders: [], credit: false, useAdvance: false, delivery: false, installation: false, deliveryCharge: 0, installationCharge: 0, deliveryAddress: '', notes: '', dueDate: '' };
}

export default function Pos() {
  const { draftId } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [bill, setBill] = useState<Bill>(() => {
    try { const raw = sessionStorage.getItem(STORE_KEY); if (raw && !draftId) return JSON.parse(raw) as Bill; } catch { /* ignore */ }
    return blankBill();
  });
  const [tab, setTab] = useState<'add' | 'items' | 'pay'>('add');
  const [flash, setFlash] = useState<string>();
  const [newCustomer, setNewCustomer] = useState<{ open: boolean; name?: string }>({ open: false });
  const [wa, setWa] = useState<number | null>(null);
  const [lastInvoice, setLastInvoice] = useState<CheckoutResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(bill)); } catch { /* storage full or blocked */ } }, [bill]);

  // Walk-in customer is the default for counter sales.
  const walkIn = useQuery({ queryKey: ['walk-in'], queryFn: () => api.get<Customer>('/api/customers/walk-in'), staleTime: Infinity });
  useEffect(() => { if (!bill.customer && walkIn.data && !draftId) setBill(b => ({ ...b, customer: walkIn.data })); }, [walkIn.data, bill.customer, draftId]);

  // Resume a draft invoice.
  const draft = useQuery({ queryKey: ['invoice', Number(draftId)], queryFn: () => api.get<{ invoice: Invoice }>(`/api/invoices/${draftId}`), enabled: !!draftId });
  useEffect(() => {
    const inv = draft.data?.invoice;
    if (!inv || inv.status !== 'DRAFT') return;
    api.get<Customer>(`/api/customers/${inv.customerId}`).then(c => setBill({
      ...blankBill(), draftId: inv.id, customer: c, deliveryCharge: inv.deliveryCharge, installationCharge: inv.installationCharge,
      delivery: inv.requiresDelivery || inv.deliveryCharge > 0, installation: inv.requiresInstallation || inv.installationCharge > 0,
      deliveryAddress: inv.deliveryAddress ?? '', notes: inv.notes ?? '',
      lines: inv.lines.map(l => ({
        key: newKey(), variantId: l.variantId, description: l.description, sku: l.sku, hsnCode: l.hsnCode, quantity: l.quantity, unitPrice: l.unitPrice,
        priceIncludesGst: l.priceIncludesGst, gstRate: l.gstRate, discountPercent: l.discountPercent, discountAmount: l.discountAmount,
        productName: l.description, variantName: '', listPrice: l.unitPrice,
      })),
    }));
  }, [draft.data]);

  const isWalkIn = !!bill.customer?.isWalkIn;
  const moneyMethods = (lookups?.paymentMethods ?? []).filter(m => m.isMoney && m.isActive);
  const defaults = lookups?.defaults;

  // ---------------------------------------------------------------- live totals from the server's GST calculator
  const docInput = useMemo(() => bill.customer && bill.lines.length > 0 ? {
    id: bill.draftId ?? 0,
    customerId: bill.customer.id,
    lines: bill.lines.map(({ variantId, description, sku, hsnCode, quantity, unitPrice, priceIncludesGst, gstRate, discountPercent, discountAmount }) =>
      ({ variantId, description, sku, hsnCode, quantity: quantity || 0, unitPrice: unitPrice || 0, priceIncludesGst, gstRate, discountPercent: discountPercent || 0, discountAmount: discountAmount || 0 })),
    deliveryCharge: bill.delivery ? bill.deliveryCharge || 0 : 0,
    installationCharge: bill.installation ? bill.installationCharge || 0 : 0,
    deliveryAddress: bill.delivery ? bill.deliveryAddress || undefined : undefined,
    requiresDelivery: bill.delivery, requiresInstallation: bill.installation,
    notes: bill.notes || undefined,
    dueDate: bill.dueDate || undefined,
  } : null, [bill]);
  const debouncedInput = useDebounced(docInput, 180);
  const preview = useQuery({
    queryKey: ['pos-preview', debouncedInput],
    queryFn: () => api.post<Preview>('/api/sales/preview', debouncedInput),
    enabled: !!debouncedInput && debouncedInput.lines.every(l => l.quantity > 0),
    placeholderData: prev => prev,
    retry: false,
  });
  const totals = bill.lines.length ? preview.data?.totals : undefined;
  const grand = totals?.grandTotal ?? 0;
  const stale = preview.isFetching || debouncedInput !== docInput;

  const advance = useQuery({
    queryKey: ['advance', bill.customer?.id], queryFn: () => api.get<{ amount: number }>(`/api/payments/on-account/${bill.customer!.id}`),
    enabled: !!bill.customer && !isWalkIn,
  });
  const advanceAvail = advance.data?.amount ?? 0;
  const advanceUsed = bill.useAdvance ? Math.min(advanceAvail, grand) : 0;
  const tendered = bill.credit ? 0 : bill.tenders.reduce((s, t) => s + (t.amount ?? 0), 0);
  const cashTendered = bill.tenders.filter(t => t.methodCode === 'CASH').reduce((s, t) => s + (t.amount ?? 0), 0);
  const due = Math.round((grand - advanceUsed - tendered) * 100) / 100;
  const change = due < 0 && cashTendered > 0 ? Math.min(-due, cashTendered) : 0;
  const balance = Math.max(0, due);

  // Default the first tender to the full amount so a cash sale is one click.
  useEffect(() => {
    if (bill.credit || bill.tenders.length !== 1) return;
    const t = bill.tenders[0];
    const target = Math.max(0, Math.round((grand - advanceUsed) * 100) / 100);
    // The single tender follows the total until the cashier types an amount (e.g. cash handed over).
    if ((t.amount === null || t.auto) && t.amount !== target) setBill(b => ({ ...b, tenders: [{ ...t, amount: target, auto: true }] }));
  }, [grand, advanceUsed, bill.credit, bill.tenders]);

  // ---------------------------------------------------------------- line editing
  const addItem = useCallback((s: Sellable) => {
    setBill(b => {
      const existing = b.lines.find(l => l.variantId === s.variantId);
      if (existing) {
        setFlash(existing.key);
        return { ...b, lines: b.lines.map(l => (l.key === existing.key ? { ...l, quantity: (l.quantity || 0) + 1 } : l)) };
      }
      const key = newKey();
      setFlash(key);
      return {
        ...b,
        lines: [...b.lines, {
          key, variantId: s.variantId, productId: s.productId, productName: s.productName, variantName: s.variantName, description: '', sku: s.sku,
          hsnCode: s.hsnCode, quantity: 1, unitPrice: s.sellingPrice, listPrice: s.sellingPrice, priceIncludesGst: s.priceIncludesGst, gstRate: s.gstRate,
          discountPercent: s.discountPercent ?? 0, discountAmount: 0, available: s.available, isStockItem: s.isStockItem,
        }],
      };
    });
    if (s.isStockItem && s.available <= 0 && !defaults?.allowNegativeStock) toast.info(`${s.displayName} is out of stock`, 'It will be refused when saving unless stock arrives.');
  }, [defaults?.allowNegativeStock, toast]);
  const updateLine = (key: string, patch: Partial<BillLine>) => setBill(b => ({ ...b, lines: b.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setBill(b => ({ ...b, lines: b.lines.filter(l => l.key !== key) }));
  useEffect(() => { if (flash) { const t = setTimeout(() => setFlash(undefined), 800); return () => clearTimeout(t); } }, [flash]);

  const scan = async (code: string) => {
    try { addItem(await api.get<Sellable>(`/api/sellable/code/${encodeURIComponent(code.trim())}`)); return true; }
    catch (e) { if (e instanceof ApiError && e.status === 404) return false; toast.error('Lookup failed', errorMessage(e)); return true; }
  };

  // ---------------------------------------------------------------- payment
  const selectMethod = (code: string) => {
    if (code === 'CREDIT') { setBill(b => ({ ...b, credit: !b.credit, tenders: [] })); return; }
    setBill(b => {
      if (b.tenders.some(t => t.methodCode === code)) return { ...b, credit: false };
      const remaining = Math.max(0, grand - advanceUsed - b.tenders.reduce((s, t) => s + (t.amount ?? 0), 0));
      return { ...b, credit: false, tenders: [...b.tenders, { key: newKey(), methodCode: code, amount: b.tenders.length === 0 ? null : remaining, reference: '' }] };
    });
  };

  // ---------------------------------------------------------------- save
  const reset = () => { setBill({ ...blankBill(), customer: walkIn.data ?? null }); setTab('add'); if (draftId) nav('/pos', { replace: true }); searchRef.current?.focus(); };
  // Reason given by an authorised user to bill past the customer's credit limit (asked only when the server refuses).
  const creditOverride = useRef<string | null>(null);
  const checkout = useMutation({
    mutationFn: async (mode: 'print' | 'save' | 'whatsapp') => {
      if (!docInput) throw new Error('Add at least one item.');
      if (balance > 0.009 && isWalkIn) throw new ApiError(409, 'A credit or part-paid sale needs a named customer. Pick or add the customer first.');
      const payments: PaymentLineInput[] = bill.credit ? [] : bill.tenders.filter(t => (t.amount ?? 0) > 0).map(t => ({ methodCode: t.methodCode, amount: t.amount!, reference: t.reference || undefined }));
      // Cash handed back as change is not income: reduce the cash tender.
      if (change > 0) {
        const cash = payments.find(p => p.methodCode === 'CASH');
        if (cash) cash.amount = Math.round((cash.amount - change) * 100) / 100;
      }
      const res = await api.post<CheckoutResult>('/api/invoices/checkout', {
        document: { ...docInput, dueDate: balance > 0 ? bill.dueDate || iso(addDays(new Date(), defaults?.defaultDueDays ?? 15)) : undefined },
        payments: payments.filter(p => p.amount > 0), useAdvance: advanceUsed, creditOverride: creditOverride.current,
      });
      creditOverride.current = null;
      return { res, mode };
    },
    onSuccess: ({ res, mode }) => {
      setLastInvoice(res);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`Invoice ${res.invoiceNumber} saved`, change > 0 ? `Return change ${money(change)}` : balance > 0 ? `Balance ${money(balance)} on credit` : 'Fully paid', {
        label: 'Open', run: () => nav(`/sales/invoices/${res.invoiceId}`),
      });
      if (mode === 'print') openPdf(`/api/invoices/${res.invoiceId}/pdf${defaults?.defaultPrintFormat === 'THERMAL' ? '?format=thermal' : ''}`).catch(e => toast.error('Could not open print view', errorMessage(e)));
      if (mode === 'whatsapp') setWa(res.invoiceId);
      reset();
    },
    onError: async (e, mode) => {
      creditOverride.current = null;
      if (e instanceof ApiError && e.code === 'credit_limit_overridable') {
        const reason = await confirm({ title: 'Credit limit exceeded', message: e.message, confirmText: 'Approve extra credit', tone: 'warn', reason: { label: 'Reason for approving', placeholder: 'Regular customer, cheque promised on…', required: true } });
        if (reason) { creditOverride.current = reason; checkout.mutate(mode); }
        return;
      }
      toast.error(e instanceof ApiError && e.code === 'credit_limit' ? 'Credit limit exceeded' : 'Invoice not saved', errorMessage(e));
    },
  });
  const saveDraft = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/invoices/draft', docInput),
    onSuccess: r => { toast.success('Draft saved', 'Find it under Invoices → Drafts.', { label: 'Open', run: () => nav(`/sales/invoices/${r.id}`) }); reset(); },
    onError: e => toast.error('Draft not saved', errorMessage(e)),
  });

  const canSave = !!docInput && !stale && !preview.isError && !checkout.isPending;
  useHotkey('f4', () => { setTab('add'); searchRef.current?.focus(); }, { inFields: true });
  useHotkey('f6', () => { setTab('pay'); document.querySelector<HTMLInputElement>('#pos-customer input')?.focus(); }, { inFields: true });
  useHotkey('f8', () => canSave && checkout.mutate('save'), { inFields: true });
  useHotkey('f9', () => canSave && checkout.mutate('print'), { inFields: true });
  useHotkey('f10', () => canSave && checkout.mutate('whatsapp'), { inFields: true });
  useHotkey('mod+enter', () => canSave && checkout.mutate('print'), { inFields: true });

  const clearBill = async () => {
    if (bill.lines.length && (await confirm({ title: 'Clear this bill?', message: 'All items and payments on this bill will be removed.', confirmText: 'Clear bill' })) === null) return;
    reset();
  };

  const interState = preview.data?.isInterState;
  const itemCount = bill.lines.reduce((s, l) => s + (l.quantity || 0), 0);

  return (
    <>
      <div className="pos-mobile-tabs">
        <Segmented value={tab} onChange={setTab} label="Billing steps" options={[
          { value: 'add', label: 'Add items', icon: <Plus /> }, { value: 'items', label: `Bill (${fmtQty(itemCount)})`, icon: <ShoppingCart /> }, { value: 'pay', label: 'Pay', icon: <Receipt /> },
        ]} />
      </div>
      <div className="pos" data-tab={tab}>
        {/* ============================== LEFT: product discovery */}
        <Discovery onAdd={addItem} searchRef={searchRef} onScan={scan} />

        {/* ============================== CENTER: current invoice */}
        <section className="pos-zone pos-bill" aria-label="Current bill">
          <div className="pos-zone-head" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <div className="grow">
              <div className="row gap-2"><h1 style={{ fontSize: 16 }}>{bill.draftId ? `Draft invoice #${bill.draftId}` : 'New invoice'}</h1>{bill.lines.length > 0 && <Badge>{bill.lines.length} line{bill.lines.length === 1 ? '' : 's'} · {fmtQty(itemCount)} pcs</Badge>}</div>
              {lastInvoice && <div className="text-xs muted">Last saved: <Link to={`/sales/invoices/${lastInvoice.invoiceId}`} className="doc-no">{lastInvoice.invoiceNumber}</Link></div>}
            </div>
            {interState !== undefined && <Badge tone="info">{interState ? 'IGST · inter-state' : 'CGST + SGST'}</Badge>}
            <Menu items={[
              { label: 'Save as draft', icon: <FileClock />, onClick: () => saveDraft.mutate(), disabled: !docInput },
              { label: 'Clear bill', icon: <Trash2 />, onClick: clearBill, danger: true, disabled: !bill.lines.length },
            ]} />
          </div>
          <div className="pos-zone-body">
            {bill.lines.length === 0 ? (
              <EmptyState icon={<ScanLine />} title="Scan a barcode or pick a product"
                desc={<>Press <span className="kbd">F4</span> to search. Items appear here with GST worked out automatically.</>} />
            ) : (
              <ul className="bill-lines">
                {bill.lines.map((l, i) => (
                  <BillLineRow key={l.key} line={l} previewLine={preview.data?.lines[i]} flash={flash === l.key} canDiscount={can(P.InvoiceDiscount)}
                    onChange={p => updateLine(l.key, p)} onRemove={() => removeLine(l.key)} />
                ))}
              </ul>
            )}
          </div>
          {preview.data?.discountWarning && <div style={{ padding: '0 16px 12px' }}><Notice tone="warn">{preview.data.discountWarning}</Notice></div>}
          {preview.isError && <div style={{ padding: '0 16px 12px' }}><Notice tone="bad">{errorMessage(preview.error)}</Notice></div>}
          <div className="pos-zone-foot">
            <div className="row wrap gap-2">
              <button className={`chip`} aria-pressed={bill.delivery} onClick={() => setBill(b => ({ ...b, delivery: !b.delivery, deliveryCharge: !b.delivery && !b.deliveryCharge ? defaults?.defaultDeliveryCharge ?? 0 : b.deliveryCharge }))}>
                <Truck aria-hidden />Home delivery
              </button>
              <button className="chip" aria-pressed={bill.installation} onClick={() => setBill(b => ({ ...b, installation: !b.installation, installationCharge: !b.installation && !b.installationCharge ? defaults?.defaultInstallationCharge ?? 0 : b.installationCharge }))}>
                <Wrench aria-hidden />Installation
              </button>
              <NotesButton value={bill.notes} onChange={notes => setBill(b => ({ ...b, notes }))} />
            </div>
            {(bill.delivery || bill.installation) && (
              <div className="grid grid-3" style={{ marginTop: 12, alignItems: 'end' }}>
                {bill.delivery && <NumberInput label="Delivery charge" money value={bill.deliveryCharge} onChange={v => setBill(b => ({ ...b, deliveryCharge: v ?? 0 }))} />}
                {bill.installation && <NumberInput label="Installation charge" money value={bill.installationCharge} onChange={v => setBill(b => ({ ...b, installationCharge: v ?? 0 }))} />}
                {bill.delivery && <TextInput label="Delivery address" placeholder={bill.customer?.billingAddress || 'Customer address'} value={bill.deliveryAddress} onChange={e => setBill(b => ({ ...b, deliveryAddress: e.target.value }))} />}
              </div>
            )}
          </div>
          <div className="shortcut-bar desktop-only" aria-hidden>
            <span><span className="kbd">F4</span> search</span><span><span className="kbd">F6</span> customer</span><span><span className="kbd">F8</span> save</span>
            <span><span className="kbd">F9</span> save & print</span><span><span className="kbd">F10</span> WhatsApp</span>
          </div>
        </section>

        {/* ============================== RIGHT: customer + payment */}
        <section className="pos-zone pos-summary" aria-label="Customer and payment">
          <div className="pos-zone-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div id="pos-customer" className="stack gap-2">
              <div className="row between"><span className="section-title">Customer</span>
                {can(P.CustomerManage) && <button className="btn btn-link text-sm" onClick={() => setNewCustomer({ open: true })}><UserPlus aria-hidden style={{ width: 14 }} />New</button>}
              </div>
              <CustomerPicker value={bill.customer} allowWalkIn onChange={c => setBill(b => ({ ...b, customer: c ?? null, useAdvance: false }))}
                onCreate={can(P.CustomerManage) ? name => setNewCustomer({ open: true, name }) : undefined} />
              {bill.customer && !isWalkIn && bill.customer.outstanding > 0 && (
                <div className="text-xs t-bad">Previous balance due: {money(bill.customer.outstanding)}</div>
              )}
              {bill.customer && !isWalkIn && bill.customer.creditLimit > 0 && (() => {
                const available = bill.customer.creditLimit - Math.max(0, bill.customer.outstanding);
                const after = available - Math.max(0, balance);
                return <div className={`text-xs ${after < 0 ? 't-bad medium' : 'muted'}`}>Credit limit {money(bill.customer.creditLimit, { decimals: false })} · available {money(Math.max(0, available), { decimals: false })}{after < 0 && balance > 0 ? ' — this bill goes over the limit' : ''}</div>;
              })()}
              {preview.data?.placeOfSupplyName && <div className="text-xs muted">Place of supply: {preview.data.placeOfSupplyName}</div>}
            </div>

            <dl className="totals" aria-live="polite" style={{ opacity: stale && totals ? 0.6 : 1, transition: 'opacity 120ms' }}>
              <dt>Subtotal <span className="sub">ex-GST</span></dt><dd>{money(totals?.subtotal ?? 0)}</dd>
              {(totals?.discountTotal ?? 0) > 0 && <><dt>Discount</dt><dd className="t-ok">−{money(totals!.discountTotal)}</dd></>}
              <dt>Taxable value</dt><dd>{money(totals?.taxableTotal ?? 0)}</dd>
              {interState ? <><dt>IGST</dt><dd>{money(totals?.igstTotal ?? 0)}</dd></> : <><dt>CGST</dt><dd>{money(totals?.cgstTotal ?? 0)}</dd><dt>SGST</dt><dd>{money(totals?.sgstTotal ?? 0)}</dd></>}
              {bill.delivery && <><dt>Delivery <span className="sub">(ex-GST)</span></dt><dd>{money(totals?.deliveryCharge ?? 0)}</dd></>}
              {bill.installation && <><dt>Installation <span className="sub">(ex-GST)</span></dt><dd>{money(totals?.installationCharge ?? 0)}</dd></>}
              {(totals?.roundOff ?? 0) !== 0 && <><dt>Round off</dt><dd>{money(totals!.roundOff)}</dd></>}
            </dl>
            <div className="pos-grand"><span className="label">Grand total</span><span className="value">{money(grand)}</span></div>

            <div className="stack gap-2">
              <span className="section-title">Payment</span>
              <div className="pay-methods" role="group" aria-label="Payment method">
                {[...moneyMethods.map(m => m.code), 'CREDIT'].map(code => {
                  const Icon = METHOD_ICON[code] ?? Building2;
                  const active = code === 'CREDIT' ? bill.credit : bill.tenders.some(t => t.methodCode === code);
                  return <button key={code} type="button" className="pay-method" aria-pressed={active} onClick={() => selectMethod(code)}><Icon aria-hidden />{SHORT[code] ?? moneyMethods.find(m => m.code === code)?.name ?? code}</button>;
                })}
              </div>
              {bill.tenders.map(t => (
                <div key={t.key} className={`tender${t.methodCode === 'CASH' ? ' cash' : ''}`}>
                  <span className="text-sm medium">{moneyMethods.find(m => m.code === t.methodCode)?.name ?? t.methodCode}</span>
                  <NumberInput money value={t.amount} aria-label={`${t.methodCode} amount`} onChange={v => setBill(b => ({ ...b, tenders: b.tenders.map(x => (x.key === t.key ? { ...x, amount: v, auto: false } : x)) }))} />
                  {t.methodCode === 'CASH' ? null
                    : <input className="input" placeholder={t.methodCode === 'CHEQUE' ? 'Cheque no.' : t.methodCode === 'UPI' ? 'UPI ref' : 'Ref / last 4'} value={t.reference} aria-label="Reference"
                      onChange={e => setBill(b => ({ ...b, tenders: b.tenders.map(x => (x.key === t.key ? { ...x, reference: e.target.value } : x)) }))} />}
                  <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove payment" onClick={() => setBill(b => ({ ...b, tenders: b.tenders.filter(x => x.key !== t.key) }))}><X /></button>
                </div>
              ))}
              {advanceAvail > 0 && (
                <label className="check text-sm"><input type="checkbox" checked={bill.useAdvance} onChange={e => setBill(b => ({ ...b, useAdvance: e.target.checked }))} />
                  Use customer advance <b className="num">{money(advanceAvail)}</b></label>
              )}
              {bill.credit && <Notice tone="warn">Credit sale — the full amount will be outstanding{isWalkIn ? '. Pick a named customer first.' : '.'}</Notice>}
            </div>

            {bill.lines.length > 0 && (
              change > 0 ? <div className="balance-box change"><span>Return change</span><span className="value">{money(change)}</span></div>
                : balance > 0 ? (
                  <div className="stack gap-2">
                    <div className="balance-box due"><span>Balance due</span><span className="value">{money(balance)}</span></div>
                    <label className="row gap-2 text-sm"><span className="muted">Due by</span>
                      <input type="date" className="input input-sm" style={{ width: 160 }} value={bill.dueDate || iso(addDays(new Date(), defaults?.defaultDueDays ?? 15))} min={iso()}
                        onChange={e => setBill(b => ({ ...b, dueDate: e.target.value }))} />
                    </label>
                  </div>
                ) : <div className="balance-box paid"><span>Fully paid</span><span className="value">{money(tendered + advanceUsed)}</span></div>
            )}
          </div>
          <div className="pos-zone-foot">
            <div className="pos-actions">
              <button className="btn btn-primary btn-xl main-action" disabled={!canSave} aria-busy={checkout.isPending && checkout.variables === 'print'} onClick={() => checkout.mutate('print')}>
                <Printer aria-hidden />Save & print <span className="kbd">F9</span>
              </button>
              <button className="btn btn-lg" disabled={!canSave} aria-busy={checkout.isPending && checkout.variables === 'save'} onClick={() => checkout.mutate('save')}>Save invoice</button>
              <button className="btn btn-lg" disabled={!canSave} aria-busy={checkout.isPending && checkout.variables === 'whatsapp'} onClick={() => checkout.mutate('whatsapp')}><Send aria-hidden />WhatsApp</button>
            </div>
          </div>
        </section>
      </div>

      <div className="pos-mobile-bar">
        <div className="grow"><div className="text-xs muted">{fmtQty(itemCount)} pcs · {bill.customer?.name}</div><div className="strong num" style={{ fontSize: 20 }}>{money(grand)}</div></div>
        {tab !== 'pay' ? <button className="btn btn-primary btn-lg" onClick={() => setTab('pay')} disabled={!bill.lines.length}>Pay</button>
          : <button className="btn btn-primary btn-lg" disabled={!canSave} onClick={() => checkout.mutate('print')}><Printer aria-hidden />Save & print</button>}
      </div>

      <QuickCustomerModal open={newCustomer.open} initialName={newCustomer.name} onClose={() => setNewCustomer({ open: false })}
        onSaved={c => setBill(b => ({ ...b, customer: c }))} />
      <WhatsAppDialog open={wa !== null} onClose={() => setWa(null)} url={`/api/invoices/${wa}/whatsapp`} pdfUrl={`/api/invoices/${wa}/pdf?download=true`} pdfName="invoice.pdf" />
    </>
  );
}

// ================================================================ bill line
function BillLineRow({ line, previewLine, flash, canDiscount, onChange, onRemove }: {
  line: BillLine; previewLine?: Preview['lines'][number]; flash: boolean; canDiscount: boolean; onChange: (p: Partial<BillLine>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const overStock = line.isStockItem && line.available !== undefined && (line.quantity || 0) > line.available;
  return (
    <li className={`bill-line${flash ? ' flash' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className="name">{line.productName}{line.variantName && line.variantName !== 'Standard' && <span className="soft"> — {line.variantName}</span>}</div>
        <div className="meta">
          {line.sku && <span className="mono">{line.sku}</span>}
          <span>GST {line.gstRate}%{previewLine ? ` · ${money(previewLine.tax)}` : ''}</span>
          {line.discountPercent > 0 && <span className="t-ok">{line.discountPercent}% off</span>}
          {overStock && <span className="t-bad">Only {line.available} in stock</span>}
        </div>
        <button className="btn btn-link text-xs" style={{ marginTop: 4 }} onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Done' : line.productId ? 'Variant, price & discount' : 'Price & discount'}
        </button>
      </div>
      <div className="stack gap-1" style={{ alignItems: 'center' }}>
        <div className="qty-stepper" role="group" aria-label={`Quantity of ${line.productName}`}>
          <button type="button" onClick={() => onChange({ quantity: Math.max(1, (line.quantity || 1) - 1) })} aria-label="Decrease"><Minus /></button>
          <input value={line.quantity || ''} inputMode="decimal" aria-label="Quantity" onFocus={e => e.currentTarget.select()}
            onChange={e => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange({ quantity: n }); }}
            onBlur={() => { if (!line.quantity || line.quantity <= 0) onChange({ quantity: 1 }); }} />
          <button type="button" onClick={() => onChange({ quantity: (line.quantity || 0) + 1 })} aria-label="Increase"><Plus /></button>
        </div>
        <span className="text-xs muted num">@ {money(line.unitPrice, { decimals: false })}</span>
      </div>
      <div className="total">
        <b>{money(previewLine?.lineTotal ?? line.unitPrice * (line.quantity || 0))}</b>
        <span>{line.priceIncludesGst ? 'incl. GST' : '+ GST'}</span>
      </div>
      <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove} aria-label={`Remove ${line.productName}`}><Trash2 /></button>
      {open && (
        <div className="bill-line-extra">
          {line.productId && <VariantSwitch line={line} onChange={onChange} />}
          <div style={{ width: 150 }}><NumberInput label="Unit price" money value={line.unitPrice} onChange={v => onChange({ unitPrice: v ?? 0 })} disabled={!canDiscount}
            hint={!canDiscount ? 'Manager can change price' : line.unitPrice !== line.listPrice ? `List ${money(line.listPrice, { decimals: false })}` : undefined} /></div>
          <div style={{ width: 110 }}><NumberInput label="Discount %" value={line.discountPercent} min={0} max={100} onChange={v => onChange({ discountPercent: v ?? 0, discountAmount: 0 })} /></div>
          <div style={{ width: 130 }}><NumberInput label="or ₹ off" money value={line.discountAmount} min={0} onChange={v => onChange({ discountAmount: v ?? 0, discountPercent: 0 })} /></div>
          {previewLine && <div className="text-xs muted" style={{ paddingBottom: 8 }}>Taxable {money(previewLine.taxableAmount)} · HSN {previewLine.hsnCode ?? '—'}</div>}
        </div>
      )}
    </li>
  );
}

function VariantSwitch({ line, onChange }: { line: BillLine; onChange: (p: Partial<BillLine>) => void }) {
  const { data } = useQuery({ queryKey: ['product', line.productId], queryFn: () => api.get<Product>(`/api/products/${line.productId}`), staleTime: 60_000 });
  const variants = data?.variants.filter(v => v.isActive) ?? [];
  if (!data || variants.length <= 1) return null;
  return (
    <div className="field" style={{ minWidth: 220, flex: '1 1 220px' }}>
      <label className="field-label" htmlFor={`v-${line.key}`}>Variant</label>
      <select id={`v-${line.key}`} className="select input-sm" style={{ height: 32 }} value={line.variantId ?? ''}
        onChange={e => {
          const v = variants.find(x => x.id === Number(e.target.value));
          if (!v) return;
          const price = v.sellingPrice ?? data.sellingPrice;
          onChange({ variantId: v.id, variantName: v.variantName, sku: v.sku, unitPrice: price, listPrice: price, available: v.onHand - v.reserved });
        }}>
        {variants.map(v => <option key={v.id} value={v.id}>{v.variantName} · {money(v.sellingPrice ?? data.sellingPrice, { decimals: false })} · {v.onHand - v.reserved} in stock</option>)}
      </select>
    </div>
  );
}

function NotesButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  return (
    <>
      <button className="chip" aria-pressed={!!value} onClick={() => { setText(value); setOpen(true); }}><NotebookPen aria-hidden />{value ? 'Note added' : 'Add note'}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invoice note" width={480}
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => { onChange(text.trim()); setOpen(false); }}>Save note</button></>}>
        <TextArea label="Printed on the invoice" rows={4} value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="e.g. Customer to confirm floor access before delivery" />
      </Modal>
    </>
  );
}

// ================================================================ discovery
function Discovery({ onAdd, searchRef, onScan }: { onAdd: (s: Sellable) => void; searchRef: React.RefObject<HTMLInputElement | null>; onScan: (code: string) => Promise<boolean> }) {
  const { data: lookups } = useLookups();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [view, setView] = useState<'all' | 'favorites' | 'recent'>('all');
  const q = useDebounced(text, 160);
  const all = useQuery({ queryKey: ['pos-items', q, category], queryFn: () => api.get<Sellable[]>('/api/sellable', { search: q, categoryId: category, limit: 60 }), enabled: view === 'all', staleTime: 30_000 });
  const favs = useQuery({ queryKey: ['pos-favorites'], queryFn: () => api.get<Sellable[]>('/api/pos/favorites'), staleTime: 60_000 });
  const recent = useQuery({ queryKey: ['pos-recent'], queryFn: () => api.get<Sellable[]>('/api/pos/recent'), enabled: view === 'recent', staleTime: 60_000 });
  const favIds = new Set((favs.data ?? []).map(f => f.variantId));
  const toggleFav = useMutation({
    mutationFn: (id: number) => api.post<{ favorite: boolean }>(`/api/pos/favorites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-favorites'] }),
    onError: e => toast.error('Could not update favourites', errorMessage(e)),
  });
  const items = view === 'favorites' ? favs.data : view === 'recent' ? recent.data : all.data;
  const loading = view === 'favorites' ? favs.isLoading : view === 'recent' ? recent.isLoading : all.isLoading;

  return (
    <section className="pos-zone pos-discovery" aria-label="Products">
      <div className="pos-zone-head">
        <SearchInput inputRef={searchRef} value={text} onChange={v => { setText(v); if (v) setView('all'); }} placeholder="Search or scan barcode  (F4)" autoFocus label="Search products or scan barcode"
          onKeyDown={async e => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              // Barcode scanners type the code and press Enter: exact match adds straight to the bill.
              if (await onScan(text)) { setText(''); return; }
              if (all.data?.length === 1) { onAdd(all.data[0]); setText(''); }
            } else if (e.key === 'Escape') setText('');
          }} />
        <div className="row between gap-2">
          <Segmented value={view} onChange={setView} label="Product list" options={[
            { value: 'all', label: 'All' }, { value: 'favorites', label: 'Favourites', icon: <Star /> }, { value: 'recent', label: 'Recent', icon: <History /> },
          ]} />
        </div>
        {view === 'all' && (
          <div className="cat-chips" role="group" aria-label="Categories">
            <button className="chip" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
            {(lookups?.categories ?? []).map(c => <button key={c.id} className="chip" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.name}</button>)}
          </div>
        )}
      </div>
      <div className="pos-zone-body">
        {loading ? (
          <div className="product-grid">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="pcard"><div className="pcard-img skeleton" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line" style={{ width: '50%' }} /></div>)}</div>
        ) : !items?.length ? (
          <EmptyState compact icon={view === 'favorites' ? <Heart /> : <Package />}
            title={view === 'favorites' ? 'No favourites yet' : view === 'recent' ? 'Nothing sold recently' : 'No products found'}
            desc={view === 'favorites' ? 'Tap the heart on a product card to keep it here.' : text ? `Nothing matches “${text}”.` : undefined} />
        ) : (
          <div className="product-grid">
            {items.map(s => {
              const out = s.isStockItem && s.available <= 0;
              return (
                <div key={s.variantId} style={{ position: 'relative' }}>
                  <button className={`pcard${out ? ' out' : ''}`} onClick={() => onAdd(s)} aria-label={`Add ${s.displayName}, ${money(s.sellingPrice)}`} style={{ width: '100%' }}>
                    <div className="pcard-img">{s.imageAttachmentId ? <img src={`/api/attachments/${s.imageAttachmentId}`} alt="" loading="lazy" /> : <Package aria-hidden />}</div>
                    <div className="pcard-name">{s.displayName}</div>
                    <div className="pcard-foot">
                      <span className="pcard-price num">{money(s.sellingPrice, { decimals: false })}</span>
                      <StockLevel available={s.available} isStockItem={s.isStockItem} />
                    </div>
                  </button>
                  <button className="pcard-fav" aria-pressed={favIds.has(s.variantId)} aria-label={favIds.has(s.variantId) ? 'Remove from favourites' : 'Add to favourites'}
                    onClick={() => toggleFav.mutate(s.variantId)}><Heart /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
