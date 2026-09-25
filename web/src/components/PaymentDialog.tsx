import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, X } from 'lucide-react';
import { api, ApiError, errorMessage, openPdf } from '@/lib/api';
import { date, iso, money } from '@/lib/format';
import type { CustomerSummary, DocumentPosition, Payment } from '@/lib/types';
import { useLookups, useToast } from '@/app/providers';
import { Modal } from './ui/overlay';
import { NumberInput, TextInput } from './ui/form';
import { DocNo, Notice, Status } from './ui/display';

interface Tender { key: string; methodCode: string; amount: number | null; reference: string }
const k = () => Math.random().toString(36).slice(2, 8);
export const DOC_LABEL: Record<string, string> = { INVOICE: 'Invoice', SALES_ORDER: 'Sales order', CUSTOM_ORDER: 'Custom order' };

/**
 * Receive money against a document (invoice / order advance) or on the customer's account.
 * The remaining balance is always calculated for the user — never typed.
 */
export function PaymentDialog({ open, onClose, customerId, customerName, docType, docId, docNumber, onDone }: {
  open: boolean; onClose: () => void; customerId: number; customerName?: string; docType?: 'INVOICE' | 'SALES_ORDER' | 'CUSTOM_ORDER'; docId?: number; docNumber?: string; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: lookups } = useLookups();
  const methods = (lookups?.paymentMethods ?? []).filter(m => m.isMoney && m.isActive);
  const pos = useQuery({
    queryKey: ['position', docType, docId], queryFn: () => api.get<{ position: DocumentPosition; history: Payment[] }>('/api/payments/position', { docType, docId }),
    enabled: open && !!docType && !!docId,
  });
  const summary = useQuery({ queryKey: ['customer-summary', customerId], queryFn: () => api.get<CustomerSummary>(`/api/customers/${customerId}/summary`), enabled: open && !docType });
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [payDate, setPayDate] = useState(iso());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();

  const outstanding = docType ? pos.data?.position.balance ?? 0 : summary.data?.outstanding ?? 0;
  useEffect(() => {
    if (!open) return;
    setTenders([{ key: k(), methodCode: 'CASH', amount: null, reference: '' }]);
    setPayDate(iso()); setNotes(''); setError(undefined);
  }, [open]);
  // Pre-fill the full remaining amount once it is known.
  useEffect(() => {
    if (open && tenders.length === 1 && tenders[0].amount === null && (docType ? pos.data : summary.data)) setTenders(t => [{ ...t[0], amount: outstanding > 0 ? outstanding : null }]);
  }, [open, pos.data, summary.data, outstanding, docType, tenders]);

  const current = tenders.reduce((s, t) => s + (t.amount ?? 0), 0);
  const remaining = Math.round((outstanding - current) * 100) / 100;
  const isAdvance = docType === 'SALES_ORDER' || docType === 'CUSTOM_ORDER';

  const save = useMutation({
    mutationFn: () => api.post<{ id: number; number: string }>('/api/payments', {
      customerId, date: payDate, notes: notes || undefined, docType, docId,
      lines: tenders.filter(t => (t.amount ?? 0) > 0).map(t => ({ methodCode: t.methodCode, amount: t.amount, reference: t.reference || undefined })),
    }),
    onSuccess: r => {
      toast.success('Payment recorded successfully', `${r.number} · ${money(current)}`, { label: 'Print receipt', run: () => void openPdf(`/api/payments/${r.id}/pdf`) });
      for (const key of ['position', 'invoice', 'invoices', 'payments', 'customer', 'customer-summary', 'customers', 'dashboard', 'sales-order', 'custom-order', 'ledger', 'timeline'])
        qc.invalidateQueries({ queryKey: [key] });
      onDone?.();
      onClose();
    },
    onError: e => setError(e instanceof ApiError ? e.message : errorMessage(e)),
  });
  const valid = current > 0 && tenders.every(t => t.methodCode !== 'CHEQUE' || !(t.amount ?? 0) || t.reference.trim());
  const history = useMemo(() => pos.data?.history ?? [], [pos.data]);

  return (
    <Modal open={open} onClose={onClose} width={600} title={docType ? `Receive payment · ${DOC_LABEL[docType]} ${docNumber ?? pos.data?.position.number ?? ''}` : `Receive payment · ${customerName ?? ''}`}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate()}>Record {money(current)}</button>
      </>}>
      <div className="stack gap-5">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="card card-pad" style={{ background: 'var(--surface-sunken)', border: 0 }}>
          <div className="pay-position">
            {docType ? (
              <>
                <div className="row-line"><span>{isAdvance ? 'Order value' : 'Invoice total'}</span><span>{money(pos.data?.position.total)}</span></div>
                {(pos.data?.position.returned ?? 0) > 0 && <div className="row-line"><span>Returned</span><span>−{money(pos.data!.position.returned)}</span></div>}
                <div className="row-line"><span>Previously paid</span><span>{money(pos.data?.position.paid)}</span></div>
              </>
            ) : (
              <div className="row-line"><span>Total outstanding</span><span>{money(summary.data?.outstanding)}</span></div>
            )}
            <div className="row-line"><span>Current payment</span><span className="t-ok">−{money(current)}</span></div>
            <div className="row-line remaining">
              <span>{remaining < 0 ? (isAdvance ? 'Excess (kept as advance)' : 'Extra (kept as advance)') : 'Remaining'}</span>
              <span className={remaining > 0 ? 't-warn' : remaining < 0 ? 't-info' : 't-ok'}>{money(Math.abs(remaining))}</span>
            </div>
          </div>
        </div>
        {!docType && <p className="text-sm muted">Applied to the oldest unpaid invoices first. Anything extra is held as advance for the next purchase.</p>}

        <div className="stack gap-2">
          <span className="section-title">Received by</span>
          {tenders.map(t => (
            <div key={t.key} className="row gap-2">
              <select className="select" style={{ width: 150 }} value={t.methodCode} aria-label="Method"
                onChange={e => setTenders(x => x.map(y => (y.key === t.key ? { ...y, methodCode: e.target.value } : y)))}>
                {methods.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
              <div style={{ width: 160 }}><NumberInput money value={t.amount} aria-label="Amount" onChange={v => setTenders(x => x.map(y => (y.key === t.key ? { ...y, amount: v } : y)))} /></div>
              {t.methodCode !== 'CASH' && (
                <input className="input grow" placeholder={t.methodCode === 'CHEQUE' ? 'Cheque number (required)' : 'Reference (UPI / txn / last 4)'} value={t.reference}
                  aria-label="Reference" onChange={e => setTenders(x => x.map(y => (y.key === t.key ? { ...y, reference: e.target.value } : y)))} />
              )}
              {tenders.length > 1 && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => setTenders(x => x.filter(y => y.key !== t.key))}><X /></button>}
            </div>
          ))}
          <button className="btn btn-link text-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTenders(x => [...x, { key: k(), methodCode: 'UPI', amount: Math.max(0, remaining), reference: '' }])}>
            <Plus aria-hidden style={{ width: 14 }} />Split across another method
          </button>
        </div>
        <div className="grid grid-2">
          <TextInput label="Payment date" type="date" value={payDate} max={iso()} onChange={e => setPayDate(e.target.value)} />
          <TextInput label="Note" optional value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid by son" />
        </div>

        {history.length > 0 && (
          <div className="stack gap-2">
            <span className="section-title">Payment history <span className="count">{history.length}</span></span>
            <div className="table-card">
              <table className="data compact">
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className={h.isVoided ? 'muted-row' : undefined}>
                      <td><DocNo>{h.number}</DocNo></td>
                      <td>{date(h.paymentDate)}</td>
                      <td className="text-sm soft">{h.methods}</td>
                      <td>{h.isVoided ? <Status value="VOIDED" /> : h.direction === 'OUT' ? <Status value="REFUND" /> : null}</td>
                      <td className="num"><span className="money">{money(h.direction === 'OUT' ? -h.amount : h.amount)}</span></td>
                      <td className="actions"><button className="btn btn-ghost btn-icon btn-sm" aria-label="Print receipt" onClick={() => void openPdf(`/api/payments/${h.id}/pdf`)}><Printer /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
