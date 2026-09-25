import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useLookups, useToast } from '@/app/providers';
import { Modal } from './ui/overlay';
import { NumberInput, Select, TextInput } from './ui/form';
import { Notice } from './ui/display';

/** Pays money back to a customer (overpayment or advance). Recorded as an outgoing payment; never edits past receipts. */
export function RefundDialog({ open, onClose, customerId, docType, docId, max }: { open: boolean; onClose: () => void; customerId: number; docType?: string; docId?: number; max: number }) {
  const { data: lookups } = useLookups();
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | null>(max);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setAmount(max); setError(undefined); } }, [open, max]);
  const save = useMutation({
    mutationFn: () => api.post<{ number: string }>('/api/payments/refund', { customerId, amount, method: { methodCode: method, amount, reference: reference || undefined }, notes: notes || undefined, docType, docId }),
    onSuccess: r => { toast.success('Refund recorded', `${r.number} · ${money(amount)}`); ['invoice', 'customer', 'customer-summary', 'payments', 'sales-order', 'custom-order'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
    onError: e => setError(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Refund to customer" width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!amount || amount > max || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate()}>Record refund</button></>}>
      <div className="stack gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <p>Up to <b>{money(max)}</b> can be refunded.</p>
        <div className="grid grid-2">
          <NumberInput label="Amount" money value={amount} onChange={setAmount} max={max} error={amount && amount > max ? `Maximum ${money(max)}` : undefined} />
          <Select label="Paid by" value={method} onChange={e => setMethod(e.target.value)} options={(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => ({ value: m.code, label: m.name }))} />
        </div>
        <TextInput label="Reference" optional value={reference} onChange={e => setReference(e.target.value)} />
        <TextInput label="Note" optional value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
