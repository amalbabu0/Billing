import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, Download, ImagePlus, Plus, Save } from 'lucide-react';
import { api, ApiError, download, errorMessage } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { P } from '@/lib/perms';
import type { ExpenseCategory, GstRate, HsnCode, PaymentMethod } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { Badge, Card, ErrorPanel, Notice, PageHeader, SkeletonRows } from '@/components/ui/display';
import { NumberInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';

type Obj = Record<string, unknown>;
interface Sequence { docType: string; prefix: string; includeYear: boolean; padding: number; nextNumber: number; currentYear?: number }
interface SettingsResponse {
  settings: { shop: Obj; invoice: Obj; tax: Obj; delivery: Obj; inventory: Obj; printer: Obj; whatsApp: Obj; security: Obj; backup: Obj };
  sequences: Sequence[]; gstRates: GstRate[]; hsnCodes: HsnCode[]; paymentMethods: PaymentMethod[]; expenseCategories: ExpenseCategory[];
}

const SECTIONS = [
  { key: 'shop', label: 'Shop', perm: P.SettingsManage }, { key: 'gst', label: 'GST registration', perm: P.SettingsManage },
  { key: 'invoice', label: 'Invoice & documents', perm: P.SettingsManage }, { key: 'tax', label: 'Tax rates & HSN', perm: P.SettingsManage },
  { key: 'payments', label: 'Payments & expenses', perm: P.SettingsManage }, { key: 'printer', label: 'Printing', perm: P.SettingsManage },
  { key: 'whatsapp', label: 'WhatsApp', perm: P.SettingsManage }, { key: 'backup', label: 'Backup', perm: P.BackupManage },
  { key: 'security', label: 'Security', perm: P.SettingsManage },
];

export default function Settings() {
  const { section = 'shop' } = useParams();
  const can = useCan();
  const visible = SECTIONS.filter(s => can(s.perm));
  const { data, error, refetch } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/api/settings') });
  if (!visible.some(s => s.key === section)) return <Navigate to={`/settings/${visible[0]?.key ?? 'backup'}`} replace />;
  const cur = SECTIONS.find(s => s.key === section)!;
  return (
    <div className="page">
      <PageHeader title="Settings" desc="How the shop, documents, tax, messages and security behave. Every change is recorded in the activity log." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">{visible.map(s => <NavLink key={s.key} to={`/settings/${s.key}`} className={({ isActive }) => (isActive ? 'active' : '')}>{s.label}</NavLink>)}</nav>
        <div className="stack gap-5" style={{ minWidth: 0 }}>
          <h2 className="sr-only">{cur.label}</h2>
          {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : !data ? <SkeletonRows rows={8} /> : <Section section={section} data={data} />}
        </div>
      </div>
    </div>
  );
}

function Section({ section, data }: { section: string; data: SettingsResponse }) {
  switch (section) {
    case 'shop': return <ShopSection data={data} />;
    case 'gst': return <GstSection data={data} />;
    case 'invoice': return <InvoiceSection data={data} />;
    case 'tax': return <TaxSection data={data} />;
    case 'payments': return <PaymentsSection data={data} />;
    case 'printer': return <PrinterSection data={data} />;
    case 'whatsapp': return <WhatsAppSection data={data} />;
    case 'backup': return <BackupSection data={data} />;
    case 'security': return <SecuritySection data={data} />;
    default: return null;
  }
}

/** Local draft of one settings object + a save that PUTs the whole section. */
function useSection(section: string, initial: Obj) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<Obj>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setV(initial), [initial]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: (body?: Obj) => api.put(`/api/settings/${section}`, body ?? v),
    onSuccess: () => { setErrors({}); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); toast.success('Settings saved'); },
    onError: e => { if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, x]) => [k.charAt(0).toLowerCase() + k.slice(1), x]))); toast.error('Not saved', errorMessage(e)); },
  });
  const f = <T,>(k: string) => v[k] as T;
  const set = (k: string, x: unknown) => setV(s => ({ ...s, [k]: x }));
  return { v, setV, f, set, errors, dirty, save };
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset?: () => void }) {
  return (
    <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
      {dirty && <span className="text-xs muted grow">Unsaved changes</span>}
      {dirty && onReset && <button className="btn" onClick={onReset}>Discard</button>}
      <button className="btn btn-primary" disabled={!dirty || busy} aria-busy={busy} onClick={onSave}><Save aria-hidden />Save changes</button>
    </div>
  );
}

function Group({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return <section className="form-section"><div className="form-section-head"><h3>{title}</h3>{desc && <p>{desc}</p>}</div><div className="stack gap-4">{children}</div></section>;
}

// ------------------------------------------------------------ shop
function ShopSection({ data }: { data: SettingsResponse }) {
  const s = useSection('shop', data.settings.shop);
  const { data: lookups } = useLookups();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const upload = async (fl: File) => {
    try { const fd = new FormData(); fd.append('file', fl); const r = await api.upload<{ id: number }>('/api/attachments?ownerType=settings&purpose=logo', fd); s.set('logoAttachmentId', r.id); }
    catch (e) { toast.error('Upload failed', errorMessage(e)); }
  };
  const t = (k: string, label: string, extra: Obj = {}) => <TextInput label={label} value={s.f<string>(k) ?? ''} onChange={e => s.set(k, e.target.value)} error={s.errors[k]} {...extra} />;
  return (
    <Card footer={<SaveBar dirty={s.dirty} busy={s.save.isPending} onSave={() => s.save.mutate(undefined)} onReset={() => s.setV(data.settings.shop)} />}>
      <Group title="Identity" desc="Printed at the top of every invoice, quotation and receipt.">
        <div className="row top gap-4 wrap">
          <div className="grow stack gap-4" style={{ minWidth: 260 }}>
            {t('shopName', 'Shop name', { required: true })}
            {t('tagline', 'Tagline', { optional: true })}
          </div>
          <div className="field" style={{ width: 160 }}>
            <span className="field-label">Logo</span>
            <button type="button" className="dropzone" style={{ height: 96, padding: 8, display: 'grid', placeItems: 'center' }} onClick={() => file.current?.click()}>
              {s.f<number>('logoAttachmentId') ? <img src={`/api/attachments/${s.f<number>('logoAttachmentId')}`} alt="Shop logo" style={{ maxHeight: 78, maxWidth: '100%' }} /> : <span className="stack gap-1" style={{ alignItems: 'center' }}><ImagePlus aria-hidden /><span className="text-xs">PNG or JPG</span></span>}
            </button>
            <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
            {s.f<number>('logoAttachmentId') ? <button className="btn btn-sm btn-ghost" onClick={() => s.set('logoAttachmentId', null)}>Remove logo</button> : null}
          </div>
        </div>
      </Group>
      <Group title="Address & contact">
        <TextArea label="Address" rows={2} value={s.f<string>('address') ?? ''} onChange={e => s.set('address', e.target.value)} />
        <div className="grid grid-3">
          {t('city', 'City', { optional: true })}
          <Select label="State" value={s.f<string>('stateCode')} onChange={e => s.set('stateCode', e.target.value)} error={s.errors.stateCode} options={(lookups?.states ?? []).map(x => ({ value: x.code, label: `${x.code} · ${x.name}` }))} />
          {t('pincode', 'PIN code', { optional: true, inputMode: 'numeric', maxLength: 6 })}
        </div>
        <div className="grid grid-3">{t('phone', 'Phone', { optional: true })}{t('email', 'Email', { optional: true, type: 'email' })}{t('website', 'Website', { optional: true })}</div>
      </Group>
      <Group title="Bank & UPI" desc="Shown on invoices when “Show bank details” is on, so customers can pay by transfer.">
        <div className="grid grid-3">{t('bankName', 'Bank', { optional: true })}{t('bankAccount', 'Account no.', { optional: true })}{t('bankIfsc', 'IFSC', { optional: true })}</div>
        <div className="grid grid-3">{t('upiId', 'UPI ID', { optional: true, placeholder: 'shop@okbank' })}</div>
      </Group>
    </Card>
  );
}

// ------------------------------------------------------------ GST registration
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinProblem(g: string, stateCode?: string): string | null {
  if (!g) return null;
  if (!GSTIN_RE.test(g)) return 'Format: 2-digit state code, 10-character PAN, entity number, Z, check digit.';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  if (CHARS[(36 - (sum % 36)) % 36] !== g[14]) return 'Check digit does not match — look for a typing mistake.';
  if (stateCode && g.slice(0, 2) !== stateCode) return `Starts with ${g.slice(0, 2)} but the shop’s state is ${stateCode}.`;
  return null;
}

function GstSection({ data }: { data: SettingsResponse }) {
  const shop = useSection('shop', data.settings.shop);
  const tax = useSection('tax', data.settings.tax);
  const { data: lookups } = useLookups();
  const toast = useToast();
  const gstin = (shop.f<string>('gstin') ?? '').toUpperCase();
  const problem = gstinProblem(gstin, shop.f<string>('stateCode'));
  const registered = tax.f<boolean>('gstRegistered');
  const state = lookups?.states.find(x => x.code === shop.f<string>('stateCode'));
  const busy = shop.save.isPending || tax.save.isPending;
  const saveBoth = async () => {
    try {
      if (shop.dirty) await shop.save.mutateAsync({ ...shop.v, gstin: gstin || null, pan: (shop.f<string>('pan') ?? '').toUpperCase() || null });
      if (tax.dirty) await tax.save.mutateAsync(undefined);
    } catch { /* toasts shown by each save */ }
  };
  return (
    <Card footer={<SaveBar dirty={shop.dirty || tax.dirty} busy={busy} onSave={() => { if (registered && !gstin) { toast.error('Enter the GSTIN', 'A registered shop must print its GSTIN on tax invoices.'); return; } void saveBoth(); }} />}>
      <Group title="Registration" desc="Switch off for a shop below the GST threshold: invoices then print as “Bill of supply” with no tax.">
        <Switch label="GST registered" checked={registered} onChange={v => tax.set('gstRegistered', v)} hint={registered ? 'Tax invoices with CGST/SGST or IGST.' : 'No GST is charged on new invoices.'} />
        {registered && <>
          <div className="grid grid-2">
            <TextInput label="GSTIN" required className="mono" maxLength={15} value={gstin} onChange={e => shop.set('gstin', e.target.value.toUpperCase().replace(/\s/g, ''))}
              error={shop.errors.gstin ?? (gstin.length === 15 ? problem ?? undefined : undefined)}
              hint={gstin.length === 15 && !problem ? <span className="t-ok row gap-1"><CheckCircle2 aria-hidden style={{ width: 14 }} />Valid for {state?.name}</span> : '15 characters, e.g. 29ABCDE1234F1Z5'} />
            <TextInput label="Legal name" optional value={shop.f<string>('legalName') ?? ''} onChange={e => shop.set('legalName', e.target.value)} hint="As on the GST certificate, if different from the shop name" />
          </div>
          <div className="grid grid-2">
            <TextInput label="PAN" optional className="mono" maxLength={10} value={shop.f<string>('pan') ?? ''} onChange={e => shop.set('pan', e.target.value.toUpperCase())}
              hint={gstin.length === 15 ? `From GSTIN: ${gstin.slice(2, 12)}` : undefined} />
            <Select label="State (place of business)" value={shop.f<string>('stateCode')} onChange={e => shop.set('stateCode', e.target.value)} options={(lookups?.states ?? []).map(x => ({ value: x.code, label: `${x.code} · ${x.name}` }))} />
          </div>
        </>}
      </Group>
      <Group title="Place of supply" desc="Decided per invoice from the customer’s state.">
        <Notice tone="info">Customer in {state?.name ?? 'your state'} → <b>CGST + SGST</b> (half each). Customer in another state → <b>IGST</b> (full rate). A B2B customer’s state is read from the first two digits of their GSTIN.</Notice>
      </Group>
    </Card>
  );
}

// ------------------------------------------------------------ invoice & documents
function InvoiceSection({ data }: { data: SettingsResponse }) {
  const inv = useSection('invoice', data.settings.invoice);
  const del = useSection('delivery', data.settings.delivery);
  const stock = useSection('inventory', data.settings.inventory);
  const busy = inv.save.isPending || del.save.isPending || stock.save.isPending;
  const save = async () => { try { if (inv.dirty) await inv.save.mutateAsync(undefined); if (del.dirty) await del.save.mutateAsync(undefined); if (stock.dirty) await stock.save.mutateAsync(undefined); } catch { /* toasts shown */ } };
  return <>
    <Card footer={<SaveBar dirty={inv.dirty || del.dirty || stock.dirty} busy={busy} onSave={() => void save()} />}>
      <Group title="Printed documents">
        <div className="grid grid-3">
          <TextInput label="Invoice title" value={inv.f<string>('title') ?? ''} onChange={e => inv.set('title', e.target.value)} />
          <Select label="Default print format" value={inv.f<string>('defaultPrintFormat')} onChange={e => inv.set('defaultPrintFormat', e.target.value)} options={[{ value: 'A4', label: 'A4' }, { value: 'THERMAL', label: 'Thermal receipt' }]} />
        </div>
        <TextArea label="Terms & conditions" rows={5} value={inv.f<string>('terms') ?? ''} onChange={e => inv.set('terms', e.target.value)} />
        <TextInput label="Footer line" value={inv.f<string>('footer') ?? ''} onChange={e => inv.set('footer', e.target.value)} />
        <div className="grid grid-2" style={{ gap: 10 }}>
          <Switch label="Round off totals to the rupee" checked={inv.f<boolean>('roundOff')} onChange={v => inv.set('roundOff', v)} />
          <Switch label="Amount in words" checked={inv.f<boolean>('showAmountInWords')} onChange={v => inv.set('showAmountInWords', v)} />
          <Switch label="Bank details" checked={inv.f<boolean>('showBankDetails')} onChange={v => inv.set('showBankDetails', v)} />
          <Switch label="Signature box" checked={inv.f<boolean>('showSignatureBox')} onChange={v => inv.set('showSignatureBox', v)} />
        </div>
      </Group>
      <Group title="Credit & validity">
        <div className="grid grid-3">
          <NumberInput label="Payment due (days)" value={inv.f<number>('defaultDueDays')} min={0} max={365} onChange={v => inv.set('defaultDueDays', v ?? 0)} error={inv.errors.defaultDueDays} />
          <NumberInput label="Quotation valid (days)" value={inv.f<number>('quotationValidityDays')} min={1} max={365} onChange={v => inv.set('quotationValidityDays', v ?? 15)} error={inv.errors.quotationValidityDays} />
        </div>
      </Group>
      <Group title="Delivery & installation">
        <div className="grid grid-3">
          <NumberInput label="Default delivery charge" money value={del.f<number>('defaultDeliveryCharge')} onChange={v => del.set('defaultDeliveryCharge', v ?? 0)} error={del.errors.defaultDeliveryCharge} />
          <NumberInput label="Default installation charge" money value={del.f<number>('defaultInstallationCharge')} onChange={v => del.set('defaultInstallationCharge', v ?? 0)} />
        </div>
        <Switch label="Require the customer OTP to complete a delivery" checked={del.f<boolean>('requireOtp')} onChange={v => del.set('requireOtp', v)} hint="The OTP is generated when a delivery is scheduled." />
        <Switch label="Create a delivery automatically for invoices with a delivery charge" checked={del.f<boolean>('autoCreateDelivery')} onChange={v => del.set('autoCreateDelivery', v)} />
      </Group>
      <Group title="Stock">
        <Switch label="Reserve stock when a sales order is confirmed" checked={stock.f<boolean>('reserveOnSalesOrderConfirm')} onChange={v => stock.set('reserveOnSalesOrderConfirm', v)} />
        <Switch label="Update product cost from the latest purchase" checked={stock.f<boolean>('updateCostOnPurchase')} onChange={v => stock.set('updateCostOnPurchase', v)} />
        <Switch label="Allow billing more than available stock" checked={stock.f<boolean>('allowNegativeStock')} onChange={v => stock.set('allowNegativeStock', v)} hint="Admins only. Leave off unless you bill before goods arrive." />
      </Group>
    </Card>
    <SequencesCard sequences={data.sequences} />
  </>;
}

function SequencesCard({ sequences }: { sequences: Sequence[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Sequence | null>(null);
  const preview = (s: Sequence) => `${s.prefix}${s.includeYear ? `-${s.currentYear ?? new Date().getFullYear()}` : ''}-${String(s.nextNumber).padStart(s.padding, '0')}`;
  const save = useMutation({
    mutationFn: () => api.post('/api/settings/sequences', edit),
    onSuccess: () => { toast.success('Numbering saved'); qc.invalidateQueries({ queryKey: ['settings'] }); setEdit(null); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  return (
    <Card title="Document numbering" sub="Numbers are issued without gaps, inside the same transaction as the document." bodyClass="">
      <div className="table-scroll"><table className="data">
        <thead><tr><th>Document</th><th>Prefix</th><th>Year</th><th className="num">Digits</th><th>Next number</th><th /></tr></thead>
        <tbody>{sequences.map(s => <tr key={s.docType}><td className="medium">{s.docType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</td><td className="mono">{s.prefix}</td>
          <td>{s.includeYear ? 'Yes' : 'No'}</td><td className="num">{s.padding}</td><td className="mono">{preview(s)}</td>
          <td className="num"><button className="btn btn-sm btn-ghost" onClick={() => setEdit({ ...s })}>Edit</button></td></tr>)}</tbody>
      </table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit numbering" width={440}
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button></>}>
        {edit && <div className="stack gap-4">
          <div className="grid grid-2">
            <TextInput label="Prefix" value={edit.prefix} maxLength={8} onChange={e => setEdit({ ...edit, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, '') })} className="mono" />
            <NumberInput label="Digits" value={edit.padding} min={1} max={8} onChange={v => setEdit({ ...edit, padding: v ?? 4 })} />
          </div>
          <Switch label="Include the year" checked={edit.includeYear} onChange={v => setEdit({ ...edit, includeYear: v })} />
          <NumberInput label="Next number" value={edit.nextNumber} min={1} onChange={v => setEdit({ ...edit, nextNumber: v ?? 1 })} hint="Can only move forward — used numbers are never reissued." />
          <p className="text-sm">Next document: <span className="mono medium">{preview(edit)}</span></p>
        </div>}
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------ tax rates & HSN
function TaxSection({ data }: { data: SettingsResponse }) {
  const tax = useSection('tax', data.settings.tax);
  const toast = useToast();
  const qc = useQueryClient();
  const [rate, setRate] = useState<Partial<GstRate> | null>(null);
  const [hsn, setHsn] = useState<Partial<HsnCode> & { isNew?: boolean } | null>(null);
  const post = async (url: string, body: unknown, done: () => void) => {
    try { await api.post(url, body); toast.success('Saved'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); done(); } catch (e) { toast.error('Not saved', errorMessage(e)); }
  };
  const rates = data.gstRates.map(r => ({ value: r.rate, label: `${r.rate}%` }));
  return <>
    <Card footer={<SaveBar dirty={tax.dirty} busy={tax.save.isPending} onSave={() => tax.save.mutate(undefined)} />}>
      <Group title="Defaults for new products and bills">
        <div className="grid grid-3">
          <Select label="Default GST rate" value={tax.f<number>('defaultGstRate')} onChange={e => tax.set('defaultGstRate', Number(e.target.value))} options={rates} />
          <Select label="GST on delivery / installation" value={tax.f<number>('chargesGstRate')} onChange={e => tax.set('chargesGstRate', Number(e.target.value))} options={rates} />
          <TextInput label="Default HSN" className="mono" value={tax.f<string>('defaultHsn') ?? ''} onChange={e => tax.set('defaultHsn', e.target.value)} />
        </div>
        <Switch label="Selling prices include GST" checked={tax.f<boolean>('defaultPriceIncludesGst')} onChange={v => tax.set('defaultPriceIncludesGst', v)} hint="Showrooms usually quote tax-inclusive MRP; the invoice back-calculates the taxable value." />
      </Group>
    </Card>
    <div className="split narrow-left">
      <Card title="GST rates" bodyClass="" actions={<button className="btn btn-sm" onClick={() => setRate({ isActive: true })}><Plus aria-hidden />Add</button>}>
        <div className="table-scroll"><table className="data compact"><thead><tr><th>Rate</th><th>Name</th><th>Status</th><th /></tr></thead>
          <tbody>{data.gstRates.map(r => <tr key={r.id}><td className="medium">{r.rate}%</td><td>{r.name}{r.isDefault && <Badge tone="info"> default</Badge>}</td><td>{r.isActive ? 'Active' : <span className="muted">Hidden</span>}</td>
            <td className="num"><button className="btn btn-sm btn-ghost" onClick={() => setRate(r)}>Edit</button></td></tr>)}</tbody></table></div>
      </Card>
      <Card title="HSN codes" bodyClass="" actions={<button className="btn btn-sm" onClick={() => setHsn({ isActive: true, isNew: true, defaultGstRate: 18 })}><Plus aria-hidden />Add</button>}>
        <div className="table-scroll" style={{ maxHeight: 420 }}><table className="data compact"><thead><tr><th>HSN</th><th>Description</th><th className="num">GST</th><th /></tr></thead>
          <tbody>{data.hsnCodes.map(h => <tr key={h.code} className={h.isActive ? '' : 'muted-row'}><td className="mono medium">{h.code}</td><td className="text-sm">{h.description}</td><td className="num">{h.defaultGstRate}%</td>
            <td className="num"><button className="btn btn-sm btn-ghost" onClick={() => setHsn(h)}>Edit</button></td></tr>)}</tbody></table></div>
      </Card>
    </div>
    <Modal open={!!rate} onClose={() => setRate(null)} title={rate?.id ? 'Edit GST rate' : 'Add GST rate'} width={420}
      footer={<><button className="btn" onClick={() => setRate(null)}>Cancel</button><button className="btn btn-primary" onClick={() => post('/api/settings/gst-rates', { ...rate, name: rate?.name || `GST ${rate?.rate}%` }, () => setRate(null))}>Save</button></>}>
      {rate && <div className="stack gap-4"><div className="grid grid-2">
        <NumberInput label="Rate %" value={rate.rate ?? null} min={0} max={100} onChange={v => setRate({ ...rate, rate: v ?? 0 })} disabled={!!rate.id} />
        <TextInput label="Name" value={rate.name ?? ''} onChange={e => setRate({ ...rate, name: e.target.value })} placeholder={`GST ${rate.rate ?? ''}%`} /></div>
        <Switch label="Available for selection" checked={rate.isActive ?? true} onChange={v => setRate({ ...rate, isActive: v })} /></div>}
    </Modal>
    <Modal open={!!hsn} onClose={() => setHsn(null)} title={hsn?.isNew ? 'Add HSN code' : `HSN ${hsn?.code}`} width={460}
      footer={<><button className="btn" onClick={() => setHsn(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { const { isNew: _n, ...h } = hsn!; void post('/api/settings/hsn', h, () => setHsn(null)); }}>Save</button></>}>
      {hsn && <div className="stack gap-4"><div className="grid grid-2">
        <TextInput label="HSN code" className="mono" value={hsn.code ?? ''} disabled={!hsn.isNew} inputMode="numeric" maxLength={8} onChange={e => setHsn({ ...hsn, code: e.target.value.replace(/\D/g, '') })} />
        <Select label="Default GST" value={hsn.defaultGstRate ?? 18} onChange={e => setHsn({ ...hsn, defaultGstRate: Number(e.target.value) })} options={rates} /></div>
        <TextInput label="Description" value={hsn.description ?? ''} onChange={e => setHsn({ ...hsn, description: e.target.value })} placeholder="Wooden furniture of a kind used in the bedroom" />
        <Switch label="Active" checked={hsn.isActive ?? true} onChange={v => setHsn({ ...hsn, isActive: v })} /></div>}
    </Modal>
  </>;
}

// ------------------------------------------------------------ payments & expense heads
function PaymentsSection({ data }: { data: SettingsResponse }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pm, setPm] = useState<Partial<PaymentMethod> & { isNew?: boolean } | null>(null);
  const [cat, setCat] = useState<Partial<ExpenseCategory> | null>(null);
  const post = async (url: string, body: unknown, done: () => void) => {
    try { await api.post(url, body); toast.success('Saved'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); done(); } catch (e) { toast.error('Not saved', errorMessage(e)); }
  };
  return <>
    <Card title="Payment methods" sub="Shown at billing in this order. Built-in methods can be hidden but not removed." bodyClass="" actions={<button className="btn btn-sm" onClick={() => setPm({ isNew: true, isActive: true, isMoney: true, sortOrder: (data.paymentMethods.length + 1) * 10 })}><Plus aria-hidden />Add method</button>}>
      <div className="table-scroll"><table className="data compact"><thead><tr><th>Method</th><th>Code</th><th>Type</th><th>Status</th><th /></tr></thead>
        <tbody>{data.paymentMethods.map(m => <tr key={m.code} className={m.isActive ? '' : 'muted-row'}><td className="medium">{m.name}{m.isSystem && <span className="muted text-xs"> · built-in</span>}</td><td className="mono text-sm">{m.code}</td>
          <td className="text-sm">{m.isMoney ? 'Money received' : 'Adjustment'}</td><td>{m.isActive ? 'Active' : 'Hidden'}</td><td className="num"><button className="btn btn-sm btn-ghost" onClick={() => setPm(m)}>Edit</button></td></tr>)}</tbody></table></div>
    </Card>
    <Card title="Expense categories" bodyClass="" actions={<button className="btn btn-sm" onClick={() => setCat({ isActive: true })}><Plus aria-hidden />Add category</button>}>
      <div className="table-scroll"><table className="data compact"><thead><tr><th>Category</th><th>Status</th><th /></tr></thead>
        <tbody>{data.expenseCategories.map(c => <tr key={c.id} className={c.isActive ? '' : 'muted-row'}><td className="medium">{c.name}</td><td>{c.isActive ? 'Active' : 'Hidden'}</td><td className="num"><button className="btn btn-sm btn-ghost" onClick={() => setCat(c)}>Edit</button></td></tr>)}</tbody></table></div>
    </Card>
    <Modal open={!!pm} onClose={() => setPm(null)} title={pm?.isNew ? 'Add payment method' : pm?.name ?? ''} width={440}
      footer={<><button className="btn" onClick={() => setPm(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { const { isNew: _n, ...m } = pm!; void post('/api/settings/payment-methods', m, () => setPm(null)); }}>Save</button></>}>
      {pm && <div className="stack gap-4"><div className="grid grid-2">
        <TextInput label="Name" value={pm.name ?? ''} onChange={e => setPm({ ...pm, name: e.target.value, code: pm.isNew ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20) : pm.code })} />
        <NumberInput label="Order" value={pm.sortOrder ?? 0} onChange={v => setPm({ ...pm, sortOrder: v ?? 0 })} /></div>
        {pm.isNew && <p className="text-xs muted">Code: <span className="mono">{pm.code || '—'}</span></p>}
        <Switch label="Active" checked={pm.isActive ?? true} onChange={v => setPm({ ...pm, isActive: v })} /></div>}
    </Modal>
    <Modal open={!!cat} onClose={() => setCat(null)} title={cat?.id ? 'Edit category' : 'Add category'} width={400}
      footer={<><button className="btn" onClick={() => setCat(null)}>Cancel</button><button className="btn btn-primary" disabled={!cat?.name?.trim()} onClick={() => post('/api/settings/expense-categories', cat, () => setCat(null))}>Save</button></>}>
      {cat && <div className="stack gap-4"><TextInput label="Name" autoFocus value={cat.name ?? ''} onChange={e => setCat({ ...cat, name: e.target.value })} /><Switch label="Active" checked={cat.isActive ?? true} onChange={v => setCat({ ...cat, isActive: v })} /></div>}
    </Modal>
  </>;
}

// ------------------------------------------------------------ printing
function PrinterSection({ data }: { data: SettingsResponse }) {
  const p = useSection('printer', data.settings.printer);
  return (
    <Card footer={<SaveBar dirty={p.dirty} busy={p.save.isPending} onSave={() => p.save.mutate(undefined)} />}>
      <Group title="Browser printing" desc="Invoices, receipts and labels open as PDFs; print them from the browser’s print dialog.">
        <div className="grid grid-3">
          <Select label="Thermal paper width" value={p.f<number>('thermalWidthMm')} onChange={e => p.set('thermalWidthMm', Number(e.target.value))} options={[{ value: 80, label: '80 mm' }, { value: 58, label: '58 mm' }]} />
          <NumberInput label="Copies" value={p.f<number>('copies')} min={1} max={5} onChange={v => p.set('copies', v ?? 1)} />
        </div>
      </Group>
      <Group title="Desktop app printers" desc="Used only by the Windows desktop app for direct printing. The browser ignores these.">
        <div className="grid grid-3">
          <TextInput label="A4 printer" optional value={p.f<string>('a4PrinterName') ?? ''} onChange={e => p.set('a4PrinterName', e.target.value)} />
          <TextInput label="Thermal printer" optional value={p.f<string>('thermalPrinterName') ?? ''} onChange={e => p.set('thermalPrinterName', e.target.value)} />
          <TextInput label="Label printer" optional value={p.f<string>('labelPrinterName') ?? ''} onChange={e => p.set('labelPrinterName', e.target.value)} />
        </div>
      </Group>
    </Card>
  );
}

// ------------------------------------------------------------ WhatsApp
const TEMPLATES = [
  { key: 'quotationTemplate', label: 'Quotation' }, { key: 'invoiceTemplate', label: 'Invoice' }, { key: 'receiptTemplate', label: 'Payment receipt' },
  { key: 'reminderTemplate', label: 'Payment reminder' }, { key: 'orderConfirmationTemplate', label: 'Order confirmation' }, { key: 'productionReadyTemplate', label: 'Production ready' },
  { key: 'deliveryTemplate', label: 'Delivery scheduled' }, { key: 'deliveryCompletedTemplate', label: 'Delivery completed' }, { key: 'warrantyReminderTemplate', label: 'Warranty reminder' },
  { key: 'serviceUpdateTemplate', label: 'Service update' },
];
const PLACEHOLDERS = ['customer', 'shop', 'shop_phone', 'number', 'total', 'paid', 'balance', 'amount', 'method', 'date', 'due_date', 'valid_until', 'slot', 'driver', 'vehicle', 'otp', 'product', 'status', 'technician', 'receiver', 'end_date'];

function WhatsAppSection({ data }: { data: SettingsResponse }) {
  const w = useSection('whatsapp', data.settings.whatsApp);
  const [tpl, setTpl] = useState(TEMPLATES[0].key);
  const text = w.f<string>(tpl) ?? '';
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useQuery({ queryKey: ['wa-preview', text], queryFn: () => api.post<{ text: string }>('/api/settings/whatsapp/preview', { template: text }), placeholderData: p => p });
  const unknown = [...text.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => !PLACEHOLDERS.includes(k));
  const insert = (ph: string) => {
    const el = area.current; const token = `{${ph}}`;
    if (!el) { w.set(tpl, text + token); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    w.set(tpl, text.slice(0, s) + token + text.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  return <>
    <Notice tone="info">Messages open in WhatsApp (web or the phone app) with the text filled in — staff press send. No WhatsApp Business API is connected, so nothing is sent automatically and there is no delivery status.</Notice>
    <Card footer={<SaveBar dirty={w.dirty} busy={w.save.isPending} onSave={() => w.save.mutate(undefined)} onReset={() => w.setV(data.settings.whatsApp)} />}>
      <Group title="Sending">
        <div className="grid grid-3"><TextInput label="Country code" value={w.f<string>('countryCode') ?? '91'} prefix="+" maxLength={3} inputMode="numeric" onChange={e => w.set('countryCode', e.target.value.replace(/\D/g, ''))} /></div>
        <Switch label="Open the WhatsApp desktop app instead of WhatsApp Web" checked={w.f<boolean>('useDesktopApp')} onChange={v => w.set('useDesktopApp', v)} />
      </Group>
      <Group title="Message templates" desc="Placeholders in braces are replaced with the document’s details.">
        <div className="report-tabs">{TEMPLATES.map(t => <button key={t.key} className={tpl === t.key ? 'active' : ''} onClick={() => setTpl(t.key)}>{t.label}</button>)}</div>
        <div className="split">
          <div className="stack gap-2">
            <TextArea ref={area} label={`${TEMPLATES.find(t => t.key === tpl)?.label} message`} rows={8} value={text} onChange={e => w.set(tpl, e.target.value)} />
            {unknown.length > 0 && <p className="text-xs t-warn row gap-1"><AlertTriangle aria-hidden style={{ width: 13 }} />Unknown placeholder{unknown.length > 1 ? 's' : ''}: {unknown.map(u => `{${u}}`).join(', ')} — printed as typed.</p>}
            <div className="row wrap gap-1">{PLACEHOLDERS.map(p => <button key={p} type="button" className="chip mono" onClick={() => insert(p)}>{`{${p}}`}</button>)}</div>
          </div>
          <div className="stack gap-2"><span className="field-label">Preview with sample data</span><div className="wa-preview"><div className="wa-bubble">{preview.data?.text ?? text}</div></div></div>
        </div>
      </Group>
    </Card>
  </>;
}

// ------------------------------------------------------------ backup
function BackupSection({ data }: { data: SettingsResponse }) {
  const b = useSection('backup', data.settings.backup);
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const last = data.settings.backup.lastBackupAt as string | undefined;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  const overdue = days === null || days >= (b.f<number>('reminderDays') || 7);
  const run = async (kind: 'export' | 'dump') => {
    setBusy(kind);
    try { await download('POST', `/api/backup/${kind}`, kind === 'export' ? 'furnishop-data.zip' : 'furnishop.backup'); toast.success(kind === 'export' ? 'Data exported' : 'Backup downloaded', 'Keep the file somewhere safe, away from this computer.'); qc.invalidateQueries({ queryKey: ['settings'] }); }
    catch (e) { toast.error(kind === 'export' ? 'Export failed' : 'Backup failed', errorMessage(e)); } finally { setBusy(null); }
  };
  return <>
    <Card>
      <div className="row gap-4 wrap">
        <span className={`modal-icon tone-${overdue ? 'warn' : 'ok'}`}>{overdue ? <AlertTriangle /> : <CheckCircle2 />}</span>
        <div className="grow">
          <div className="medium" style={{ fontSize: 16 }}>{last ? `Last backup ${relative(last)}` : 'No backup taken yet'}</div>
          <div className="text-sm soft">{last ? dateTime(last) : 'Take one now and keep it off this machine.'}{overdue && last ? ` · older than ${b.f<number>('reminderDays')} days` : ''}</div>
        </div>
      </div>
    </Card>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <Card title="Full database backup" sub="PostgreSQL custom-format dump (pg_dump). Restore with pg_restore or the FurniShop CLI.">
        <button className="btn btn-primary" onClick={() => run('dump')} disabled={!!busy || !can(P.BackupManage)} aria-busy={busy === 'dump'}><Database aria-hidden />Download backup</button>
        <p className="text-xs muted" style={{ marginTop: 8 }}>Needs pg_dump on the server. On Neon, point-in-time restore is also available from the Neon console.</p>
      </Card>
      <Card title="Data export" sub="Every table as CSV in one ZIP — readable in Excel, useful for your accountant or for moving systems.">
        <button className="btn" onClick={() => run('export')} disabled={!!busy || !can(P.BackupManage)} aria-busy={busy === 'export'}><Download aria-hidden />Export all data</button>
      </Card>
    </div>
    <Card footer={<SaveBar dirty={b.dirty} busy={b.save.isPending} onSave={() => b.save.mutate(undefined)} />}>
      <Group title="Reminder">
        <div className="grid grid-3"><NumberInput label="Remind after (days)" value={b.f<number>('reminderDays')} min={1} max={90} onChange={v => b.set('reminderDays', v ?? 7)} /></div>
      </Group>
      <Group title="Server tools" desc="Only needed when pg_dump is not on the server’s PATH.">
        <div className="grid grid-2">
          <TextInput label="pg_dump path" optional className="mono" value={b.f<string>('pgDumpPath') ?? ''} onChange={e => b.set('pgDumpPath', e.target.value)} />
          <TextInput label="pg_restore path" optional className="mono" value={b.f<string>('pgRestorePath') ?? ''} onChange={e => b.set('pgRestorePath', e.target.value)} />
        </div>
      </Group>
    </Card>
  </>;
}

// ------------------------------------------------------------ security
function SecuritySection({ data }: { data: SettingsResponse }) {
  const s = useSection('security', data.settings.security);
  const n = (k: string, label: string, min: number, max: number, hint?: string) =>
    <NumberInput label={label} value={s.f<number>(k)} min={min} max={max} onChange={v => s.set(k, v ?? min)} error={s.errors[k]} hint={hint} />;
  return (
    <Card footer={<SaveBar dirty={s.dirty} busy={s.save.isPending} onSave={() => s.save.mutate(undefined)} />}>
      <Group title="Sign-in" desc="Accounts lock after repeated wrong passwords; an admin can unlock them from Users.">
        <div className="grid grid-3">{n('maxFailedLogins', 'Wrong attempts before lock', 3, 20)}{n('lockoutMinutes', 'Lock for (minutes)', 1, 1440)}{n('idleTimeoutMinutes', 'Sign out when idle (minutes)', 0, 480, '0 = never')}</div>
      </Group>
      <Group title="Passwords">
        <div className="grid grid-3">{n('minPasswordLength', 'Minimum length', 6, 64)}{n('passwordExpiryDays', 'Expire after (days)', 0, 365, '0 = never')}</div>
      </Group>
      <Group title="Always on" desc="Not configurable.">
        <ul className="list-plain stack gap-2 text-sm soft">
          <li>Passwords hashed with PBKDF2; never stored or shown.</li>
          <li>Session cookie is HttpOnly and SameSite=Strict; every change request carries an anti-forgery token.</li>
          <li>Sign-in is rate limited per address; permissions are checked on the server for every request.</li>
          <li>Invoices, payments and stock movements cannot be deleted — only cancelled or voided with a reason.</li>
        </ul>
      </Group>
    </Card>
  );
}
