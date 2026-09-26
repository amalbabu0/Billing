import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, iso, money } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Supplier, SupplierPayment } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { DocNo, EmptyState, Money, Notice, PageHeader, Status } from '@/components/ui/display';
import { NumberInput, SearchInput, TextInput } from '@/components/ui/form';
import { Modal, useConfirm } from '@/components/ui/overlay';
import { SupplierPicker } from '@/components/pickers';

export default function SupplierPayments() {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const list = usePagedList<SupplierPayment>('supplier-payments', '/api/supplier-payments', { filterKeys: ['from', 'to'] });
  const { state, update } = list;
  const [pay, setPay] = useState(false);
  const voidIt = async (p: SupplierPayment) => {
    const reason = await confirm({ title: `Void ${p.number}?`, confirmText: 'Void payment', reason: { label: 'Reason' }, message: `${money(p.amount)} will be added back to what you owe ${p.supplierName}.` });
    if (reason === null) return;
    try { await api.post(`/api/supplier-payments/${p.id}/void`, { reason }); toast.success('Payment voided'); qc.invalidateQueries({ queryKey: ['supplier-payments'] }); } catch (e) { toast.error('Not voided', errorMessage(e)); }
  };
  const cols: Column<SupplierPayment>[] = [
    { key: 'n', header: 'Payment', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.paymentDate), exportValue: r => date(r.paymentDate) },
    { key: 's', header: 'Supplier', mobile: 'sub', render: r => <span className="cell-title">{r.supplierName}</span>, exportValue: r => r.supplierName },
    { key: 'm', header: 'Method', render: r => <>{r.methodCode}{r.reference && <span className="muted mono"> · {r.reference}</span>}</>, exportValue: r => r.methodCode },
    { key: 'a', header: 'Applied to', render: r => <span className="text-sm soft">{r.appliedTo}</span>, exportValue: r => r.appliedTo },
    { key: 'st', header: '', render: r => (r.isVoided ? <Status value="VOIDED" /> : null) },
    { key: 'v', header: 'Amount', num: true, money: true, mobile: 'right', render: r => <span style={{ textDecoration: r.isVoided ? 'line-through' : undefined }}><Money value={r.amount} strong /></span>, exportValue: r => r.amount },
  ];
  return (
    <div className="page">
      <PageHeader title="Supplier payments" desc="Money paid to suppliers, applied to their oldest unpaid bills first unless a bill is chosen."
        actions={can(P.SupplierPay) && <button className="btn btn-primary" onClick={() => setPay(true)}><Plus aria-hidden />Pay a supplier</button>} />
      <DataTable id="supplier-payments" label="Supplier payments" columns={cols} rowKey={r => r.id} {...list.tableProps} rowClass={r => (r.isVoided ? 'muted-row' : undefined)}
        rowActions={r => [{ label: 'Void payment', icon: <Ban />, danger: true, onClick: () => voidIt(r), hidden: r.isVoided || !can(P.PaymentVoid) }]}
        toolbar={<SearchInput value={state.search} onChange={v => update({ search: v })} placeholder="Payment no., supplier or reference" />}
        empty={<EmptyState icon={<Wallet />} title="No supplier payments yet" />}
        exportAs={{ title: 'Supplier payments', fetchAll: list.fetchAll }} />
      {pay && <SupplierPayModal open onClose={() => setPay(false)} />}
    </div>
  );
}

export function SupplierPayModal({ open, onClose, supplierId, supplierName, purchaseId, amount: initial }: { open: boolean; onClose: () => void; supplierId?: number; supplierName?: string; purchaseId?: number; amount?: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [amount, setAmount] = useState<number | null>(initial ?? null);
  const [method, setMethod] = useState('BANK');
  const [reference, setReference] = useState('');
  const [payDate, setPayDate] = useState(iso());
  const [error, setError] = useState<string>();
  useEffect(() => { if (supplierId && open) api.get<Supplier>(`/api/suppliers/${supplierId}`).then(setSupplier).catch(() => {}); }, [supplierId, open]);
  useEffect(() => { if (supplier && initial === undefined) setAmount(supplier.outstanding > 0 ? supplier.outstanding : null); }, [supplier, initial]);
  const go = useMutation({
    mutationFn: () => api.post<{ number: string }>('/api/supplier-payments', { supplierId: supplier!.id, amount, methodCode: method, reference: reference || undefined, date: payDate, purchaseId }),
    onSuccess: r => { toast.success('Payment recorded successfully', `${r.number} · ${money(amount)}`); ['supplier-payments', 'purchase', 'purchases', 'suppliers', 'supplier-ledger'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
    onError: e => setError(errorMessage(e)),
  });
  const remaining = supplier ? supplier.outstanding - (amount ?? 0) : 0;
  return (
    <Modal open={open} onClose={onClose} title={supplierName ? `Pay ${supplierName}` : 'Pay a supplier'} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!supplier || !amount || go.isPending || (method === 'CHEQUE' && !reference)} aria-busy={go.isPending} onClick={() => go.mutate()}>Record {money(amount ?? 0)}</button></>}>
      <div className="stack gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        {!supplierId && <SupplierPicker value={supplier} onChange={setSupplier} />}
        {supplier && (
          <div className="card card-pad" style={{ background: 'var(--surface-sunken)', border: 0 }}>
            <div className="pay-position">
              <div className="row-line"><span>Total payable</span><span>{money(supplier.outstanding)}</span></div>
              <div className="row-line"><span>This payment</span><span>−{money(amount ?? 0)}</span></div>
              <div className="row-line remaining"><span>{remaining < 0 ? 'Advance to supplier' : 'Remaining'}</span><span>{money(Math.abs(remaining))}</span></div>
            </div>
          </div>
        )}
        <div className="grid grid-2">
          <NumberInput label="Amount" money value={amount} onChange={setAmount} />
          <div className="field"><label className="field-label" htmlFor="spm">Method</label><select id="spm" className="select" value={method} onChange={e => setMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
        </div>
        <div className="grid grid-2">
          <TextInput label={method === 'CHEQUE' ? 'Cheque number' : 'Reference'} optional={method !== 'CHEQUE'} required={method === 'CHEQUE'} value={reference} onChange={e => setReference(e.target.value)} />
          <TextInput label="Date" type="date" value={payDate} max={iso()} onChange={e => setPayDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
