import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Customer } from '@/lib/types';
import { useLookups, useToast } from '@/app/providers';
import { NumberInput, Select, TextArea, TextInput } from './ui/form';
import { Drawer, Modal } from './ui/overlay';
import { Notice } from './ui/display';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const empty = (): Partial<Customer> => ({ name: '', mobile: '', whatsapp: '', email: '', billingAddress: '', city: '', stateCode: '', pincode: '', gstin: '', notes: '', creditLimit: 0 });

/** Client-side checks mirror the server's (which remain the authority). */
function validate(c: Partial<Customer>) {
  const e: Record<string, string> = {};
  if (!c.name?.trim()) e.name = 'Enter the customer’s name.';
  const m = c.mobile?.replace(/\D/g, '') ?? '';
  if (m && !/^(91)?[6-9]\d{9}$/.test(m)) e.mobile = 'Enter a valid 10-digit mobile number.';
  if (c.gstin && !GSTIN_RE.test(c.gstin.trim().toUpperCase())) e.gstin = 'GSTIN should look like 29ABCDE1234F1Z5.';
  if (c.pincode && !/^[1-9]\d{5}$/.test(c.pincode)) e.pincode = 'PIN code is 6 digits.';
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) e.email = 'Enter a valid email.';
  return e;
}

function useCustomerSave(onSaved: (c: Customer) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async (c: Partial<Customer>) => {
    const e = validate(c);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { ...c, gstin: c.gstin?.trim().toUpperCase() || null, stateCode: c.stateCode || null };
      const saved = c.id ? await api.put<Customer>(`/api/customers/${c.id}`, body) : await api.post<Customer>('/api/customers', body);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', saved.id] });
      toast.success(c.id ? 'Customer updated' : 'Customer added', saved.name);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? '' : err.message });
    } finally { setBusy(false); }
  };
  return { errors, busy, save, setErrors };
}

function Fields({ c, set, errors, full }: { c: Partial<Customer>; set: (k: keyof Customer, v: unknown) => void; errors: Record<string, string>; full?: boolean }) {
  const { data: lookups } = useLookups();
  const gstinState = c.gstin && c.gstin.length >= 2 ? c.gstin.slice(0, 2) : '';
  return (
    <div className="stack gap-4">
      {errors.form && <Notice tone="bad">{errors.form}</Notice>}
      <TextInput label="Name" required value={c.name ?? ''} onChange={e => set('name', e.target.value)} error={errors.name} autoFocus />
      <div className="grid grid-2">
        <TextInput label="Mobile" value={c.mobile ?? ''} onChange={e => set('mobile', e.target.value)} error={errors.mobile} inputMode="tel" placeholder="98450 12345" />
        <TextInput label="WhatsApp" optional value={c.whatsapp ?? ''} onChange={e => set('whatsapp', e.target.value)} inputMode="tel" hint="If different from mobile" />
      </div>
      <TextArea label="Address" optional rows={2} value={c.billingAddress ?? ''} onChange={e => set('billingAddress', e.target.value)} />
      <div className="grid grid-3">
        <TextInput label="City" optional value={c.city ?? ''} onChange={e => set('city', e.target.value)} />
        <Select label="State" value={c.stateCode ?? ''} onChange={e => set('stateCode', e.target.value)} placeholder="Same as shop"
          options={(lookups?.states ?? []).map(s => ({ value: s.code, label: s.name }))} hint="Decides CGST+SGST or IGST" />
        <TextInput label="PIN code" optional value={c.pincode ?? ''} onChange={e => set('pincode', e.target.value)} error={errors.pincode} inputMode="numeric" maxLength={6} />
      </div>
      <TextInput label="GSTIN" optional value={c.gstin ?? ''} maxLength={15} onChange={e => set('gstin', e.target.value.toUpperCase())} error={errors.gstin}
        hint={gstinState && c.stateCode && gstinState !== c.stateCode ? 'The GSTIN’s state code differs from the selected state — check both.' : 'For business customers (B2B invoices).'} />
      {full && (
        <>
          <div className="grid grid-2">
            <TextInput label="Email" optional type="email" value={c.email ?? ''} onChange={e => set('email', e.target.value)} error={errors.email} />
            <NumberInput label="Credit limit" optional money value={c.creditLimit ?? 0} onChange={v => set('creditLimit', v ?? 0)} hint="0 = no limit" />
          </div>
          <Select label="Customer group" value={c.customerGroup ?? 'RETAIL'} onChange={e => set('customerGroup', e.target.value)}
            options={(lookups?.customerGroups ?? [{ code: 'RETAIL', name: 'Retail', discountPercent: 0 }]).map(g => ({ value: g.code, label: g.discountPercent ? `${g.name} — up to ${g.discountPercent}% off` : g.name }))}
            hint="Dealers, designers and contractors get their group discount at billing" />
          <TextArea label="Notes" optional rows={2} value={c.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </>
      )}
    </div>
  );
}

/** Quick add from POS / quotations: just what's needed to bill. */
export function QuickCustomerModal({ open, initialName, onClose, onSaved }: { open: boolean; initialName?: string; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [c, setC] = useState<Partial<Customer>>(empty());
  const { errors, busy, save, setErrors } = useCustomerSave(saved => { onSaved(saved); onClose(); });
  useEffect(() => {
    if (!open) return;
    const digits = (initialName ?? '').replace(/\s/g, '');
    setC({ ...empty(), ...(/^\d{10}$/.test(digits) ? { mobile: digits } : { name: initialName ?? '' }) });
    setErrors({});
  }, [open, initialName, setErrors]);
  return (
    <Modal open={open} onClose={onClose} title="New customer" width={560}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save(c)} disabled={busy} aria-busy={busy}>Save customer</button></>}>
      <Fields c={c} set={(k, v) => setC(x => ({ ...x, [k]: v }))} errors={errors} />
    </Modal>
  );
}

export function CustomerDrawer({ open, customer, onClose, onSaved }: { open: boolean; customer?: Customer | null; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const [c, setC] = useState<Partial<Customer>>(empty());
  const { errors, busy, save, setErrors } = useCustomerSave(saved => { onSaved?.(saved); onClose(); });
  useEffect(() => { if (open) { setC(customer ? { ...customer } : empty()); setErrors({}); } }, [open, customer, setErrors]);
  return (
    <Drawer open={open} onClose={onClose} title={customer ? 'Edit customer' : 'New customer'} sub={customer?.code}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save(c)} disabled={busy} aria-busy={busy}>{customer ? 'Save changes' : 'Add customer'}</button></>}>
      <Fields c={c} set={(k, v) => setC(x => ({ ...x, [k]: v }))} errors={errors} full />
    </Drawer>
  );
}
