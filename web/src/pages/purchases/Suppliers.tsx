import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Factory, IndianRupee, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Supplier } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState, Money, Notice, PageHeader } from '@/components/ui/display';
import { SearchInput, Select, TextArea, TextInput } from '@/components/ui/form';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { SupplierPayModal } from './SupplierPayments';

export default function Suppliers() {
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const list = usePagedList<Supplier>('suppliers', '/api/suppliers');
  const { state, update } = list;
  const [edit, setEdit] = useState<Supplier | null | undefined>(undefined);
  const [pay, setPay] = useState<Supplier | null>(null);
  const remove = async (s: Supplier) => {
    if ((await confirm({ title: `Delete ${s.name}?`, message: 'Only suppliers without purchases can be deleted.', confirmText: 'Delete supplier' })) === null) return;
    try { await api.del(`/api/suppliers/${s.id}`); toast.success('Supplier deleted'); qc.invalidateQueries({ queryKey: ['suppliers'] }); } catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  const cols: Column<Supplier>[] = [
    { key: 'n', header: 'Supplier', fixed: true, mobile: 'title', render: r => <div className="cell-stack"><span className="cell-title">{r.name}</span><span className="cell-sub">{[r.contactPerson, r.mobile].filter(Boolean).join(' · ')}</span></div>, exportValue: r => r.name },
    { key: 'g', header: 'GSTIN', mobile: 'meta', render: r => <span className="mono text-sm">{r.gstin ?? '—'}</span>, exportValue: r => r.gstin },
    { key: 'st', header: 'State', render: r => r.state ?? '—', exportValue: r => r.state },
    { key: 'p', header: 'Purchases', num: true, money: true, render: r => <Money value={r.totalPurchases} decimals={false} />, exportValue: r => r.totalPurchases },
    { key: 'paid', header: 'Paid', num: true, money: true, optional: true, render: r => <Money value={r.totalPaid} decimals={false} />, exportValue: r => r.totalPaid },
    { key: 'o', header: 'Payable', num: true, money: true, mobile: 'right', render: r => (r.outstanding > 0 ? <Money value={r.outstanding} strong className="t-warn" /> : <span className="muted">—</span>), exportValue: r => r.outstanding },
  ];
  return (
    <div className="page">
      <PageHeader title="Suppliers" desc="Where your stock comes from, and what you owe each of them."
        actions={can(P.SupplierManage) && <button className="btn btn-primary" onClick={() => setEdit(null)}><Plus aria-hidden />Add supplier</button>} />
      <DataTable id="suppliers" label="Suppliers" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={r => nav(`/purchases/suppliers/${r.id}`)}
        rowActions={r => [
          { label: 'Ledger', icon: <BookOpen />, onClick: () => nav(`/purchases/suppliers/${r.id}`) },
          { label: 'Pay', icon: <IndianRupee />, onClick: () => setPay(r), hidden: !can(P.SupplierPay) },
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit(r), hidden: !can(P.SupplierManage) },
          { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => remove(r), hidden: !can(P.SupplierManage) || r.totalPurchases > 0 },
        ]}
        toolbar={<SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Name, mobile, GSTIN or code" />}
        empty={<EmptyState icon={<Factory />} title="No suppliers yet" action={can(P.SupplierManage) && <button className="btn btn-primary" onClick={() => setEdit(null)}>Add a supplier</button>} />}
        exportAs={{ title: 'Suppliers', fetchAll: list.fetchAll }} />
      <SupplierDrawer supplier={edit} onClose={() => setEdit(undefined)} />
      {pay && <SupplierPayModal open onClose={() => setPay(null)} supplierId={pay.id} supplierName={pay.name} />}
    </div>
  );
}

export function SupplierDrawer({ supplier, onClose }: { supplier: Supplier | null | undefined; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [s, setS] = useState<Partial<Supplier>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (supplier !== undefined) { setS(supplier ?? { name: '' }); setErrors({}); } }, [supplier]);
  const set = (k: keyof Supplier, v: string) => setS(x => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const e: Record<string, string> = {};
      if (!s.name?.trim()) e.name = 'Enter the supplier name.';
      if (s.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.gstin)) e.gstin = 'GSTIN should look like 29ABCDE1234F1Z5.';
      setErrors(e);
      if (Object.keys(e).length) throw new ApiError(400, 'Please correct the highlighted fields.');
      const body = { ...s, stateCode: s.stateCode || null, gstin: s.gstin || null };
      return s.id ? api.put(`/api/suppliers/${s.id}`, body) : api.post('/api/suppliers', body);
    },
    onSuccess: () => { toast.success('Supplier saved', s.name); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['supplier'] }); onClose(); },
    onError: e => { if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors); else toast.error('Not saved', errorMessage(e)); },
  });
  return (
    <Drawer open={supplier !== undefined} onClose={onClose} title={s.id ? 'Edit supplier' : 'Add supplier'} sub={s.code}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending} aria-busy={save.isPending}>Save supplier</button></>}>
      <div className="stack gap-4">
        {errors.form && <Notice tone="bad">{errors.form}</Notice>}
        <TextInput label="Supplier name" required autoFocus value={s.name ?? ''} onChange={e => set('name', e.target.value)} error={errors.name} />
        <div className="grid grid-2">
          <TextInput label="Contact person" optional value={s.contactPerson ?? ''} onChange={e => set('contactPerson', e.target.value)} />
          <TextInput label="Mobile" optional value={s.mobile ?? ''} onChange={e => set('mobile', e.target.value)} error={errors.mobile} inputMode="tel" />
        </div>
        <TextArea label="Address" optional rows={2} value={s.address ?? ''} onChange={e => set('address', e.target.value)} />
        <div className="grid grid-2">
          <Select label="State" value={s.stateCode ?? ''} onChange={e => set('stateCode', e.target.value)} placeholder="Choose…" options={(lookups?.states ?? []).map(x => ({ value: x.code, label: x.name }))} hint="Decides CGST+SGST vs IGST on purchases" />
          <TextInput label="GSTIN" optional value={s.gstin ?? ''} maxLength={15} onChange={e => set('gstin', e.target.value.toUpperCase())} error={errors.gstin} />
        </div>
        <h3 className="section-title" style={{ marginTop: 8 }}>Bank details for payments</h3>
        <div className="grid grid-2">
          <TextInput label="Bank" optional value={s.bankName ?? ''} onChange={e => set('bankName', e.target.value)} />
          <TextInput label="Account number" optional value={s.bankAccount ?? ''} onChange={e => set('bankAccount', e.target.value)} />
          <TextInput label="IFSC" optional value={s.bankIfsc ?? ''} onChange={e => set('bankIfsc', e.target.value.toUpperCase())} error={errors.bankIfsc} />
          <TextInput label="UPI ID" optional value={s.upiId ?? ''} onChange={e => set('upiId', e.target.value)} />
        </div>
        <TextArea label="Notes" optional rows={2} value={s.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </div>
    </Drawer>
  );
}
