import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, IndianRupee, PackageCheck, Pencil, Undo2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, money, qty } from '@/lib/format';
import { P } from '@/lib/perms';
import type { Purchase, PurchaseReturn, SupplierPayment } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { Card, DocNo, ErrorPanel, Money, Notice, PageHeader, SkeletonRows, Status } from '@/components/ui/display';
import { Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { Checkbox, NumberInput, TextInput } from '@/components/ui/form';
import { SupplierPayModal } from './SupplierPayments';

interface Detail { purchase: Purchase; returns: PurchaseReturn[]; payments: (SupplierPayment & { amountApplied?: number })[] }

export default function PurchaseDetail() {
  const { id } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['purchase', Number(id)], queryFn: () => api.get<Detail>(`/api/purchases/${id}`) });
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const refresh = () => ['purchase', 'purchases', 'inventory', 'suppliers'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const complete = useMutation({ mutationFn: () => api.post(`/api/purchases/${id}/complete`), onSuccess: () => { toast.success('Stock received', 'Inventory and supplier balance updated.'); refresh(); }, onError: e => toast.error('Not completed', errorMessage(e)) });
  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (!data) return <div className="page"><SkeletonRows rows={8} /></div>;
  const p = data.purchase;
  const done = p.status === 'COMPLETED';
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${p.number}?`, confirmText: 'Cancel purchase', reason: { label: 'Reason' },
      message: done ? 'The received stock is removed again and the supplier balance is reversed. Not possible if payments or returns exist.' : 'The draft is kept on record as cancelled.' });
    if (reason === null) return;
    try { await api.post(`/api/purchases/${p.id}/cancel`, { reason }); toast.success('Purchase cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Purchases', to: '/purchases' }, { label: p.number }]} title={<span className="doc-no" style={{ fontSize: 'inherit' }}>{p.number}</span>}
        badge={<Status value={p.paymentState} />} desc={<><Link to={`/purchases/suppliers/${p.supplierId}`}>{p.supplierName}</Link> · bill {p.supplierInvoiceNo ?? '—'} · {date(p.purchaseDate)}</>}
        actions={<>
          {p.status === 'DRAFT' && can(P.PurchaseManage) && <button className="btn btn-primary" onClick={() => complete.mutate()} aria-busy={complete.isPending}><PackageCheck aria-hidden />Receive stock</button>}
          {done && p.balance > 0 && can(P.SupplierPay) && <button className="btn btn-primary" onClick={() => setPay(true)}><IndianRupee aria-hidden />Pay supplier</button>}
          {done && can(P.PurchaseManage) && p.lines.some(l => l.returnableQty > 0) && <button className="btn" onClick={() => setRet(true)}><Undo2 aria-hidden />Return goods</button>}
          {can(P.PurchaseManage) && p.status !== 'CANCELLED' && <Menu items={[
            { label: 'Edit draft', icon: <Pencil />, onClick: () => nav(`/purchases/${p.id}/edit`), hidden: p.status !== 'DRAFT' },
            { label: 'Cancel purchase', icon: <Ban />, danger: true, onClick: cancel },
          ]} />}
        </>} />
      {p.status === 'CANCELLED' && <Notice tone="bad">Cancelled — {p.cancelReason}</Notice>}
      <div className="doc-layout">
        <div className="stack gap-4">
          <Card title="Items" bodyClass="">
            <div className="table-scroll"><table className="data">
              <thead><tr><th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Amount</th><th className="num">Returned</th></tr></thead>
              <tbody>{p.lines.map(l => (
                <tr key={l.id}><td><div className="cell-title">{l.description}</div><div className="cell-sub mono">{l.sku}</div></td><td className="mono text-sm">{l.hsnCode ?? '—'}</td>
                  <td className="num">{qty(l.quantity)}</td><td className="num"><Money value={l.unitCost} /></td><td className="num"><Money value={l.taxableAmount} /></td>
                  <td className="num">{l.gstRate}% · <Money value={l.cgst + l.sgst + l.igst} /></td><td className="num"><Money value={l.lineTotal} strong /></td>
                  <td className="num">{l.returnedQty ? <span className="t-warn">{qty(l.returnedQty)}</span> : '—'}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
          {data.returns.length > 0 && (
            <Card title="Debit notes (goods returned)" bodyClass="">
              <table className="data"><thead><tr><th>Debit note</th><th>Date</th><th>Reason</th><th className="num">GST</th><th className="num">Value</th></tr></thead>
                <tbody>{data.returns.map(r => <tr key={r.id}><td><DocNo>{r.number}</DocNo></td><td>{date(r.returnDate)}</td><td>{r.reason}</td><td className="num"><Money value={r.cgstTotal + r.sgstTotal + r.igstTotal} /></td><td className="num"><Money value={r.grandTotal} strong /></td></tr>)}</tbody></table>
            </Card>
          )}
        </div>
        <aside className="doc-side">
          <Card title="Amount payable">
            <div className="pay-position">
              <div className="row-line"><span>Taxable</span><span>{money(p.taxableTotal)}</span></div>
              <div className="row-line"><span>{p.isInterState ? 'IGST' : 'CGST + SGST'}</span><span>{money(p.cgstTotal + p.sgstTotal + p.igstTotal)}</span></div>
              {p.otherCharges > 0 && <div className="row-line"><span>Other charges</span><span>{money(p.otherCharges)}</span></div>}
              <div className="row-line"><span className="medium">Bill total</span><span className="medium">{money(p.grandTotal)}</span></div>
              {p.returnedTotal > 0 && <div className="row-line"><span>Returned (debit notes)</span><span>−{money(p.returnedTotal)}</span></div>}
              <div className="row-line"><span>Paid</span><span className="t-ok">−{money(p.paid)}</span></div>
              <div className="row-line remaining"><span>Balance</span><span className={p.balance > 0 ? 't-warn' : 't-ok'}>{money(p.balance)}</span></div>
            </div>
            {data.payments.length > 0 && <ul className="list-plain stack gap-2" style={{ marginTop: 12 }}>
              {data.payments.map(sp => <li key={sp.id} className="row between text-sm" style={{ opacity: sp.isVoided ? 0.5 : 1 }}><span><DocNo>{sp.number}</DocNo> <span className="muted">{date(sp.paymentDate)} · {sp.methodCode}</span></span><Money value={sp.amountApplied ?? sp.amount} /></li>)}
            </ul>}
          </Card>
          <Card title="Record"><p className="text-sm soft">Entered by {p.createdByName ?? '—'} · {dateTime(p.createdAt)}</p>{p.completedAt && <p className="text-sm soft">Stock received {dateTime(p.completedAt)}{p.warehouseName ? ` into ${p.warehouseName}` : ""}</p>}{p.notes && <p className="text-sm" style={{ marginTop: 8 }}>{p.notes}</p>}</Card>
        </aside>
      </div>
      {pay && <SupplierPayModal open onClose={() => setPay(false)} supplierId={p.supplierId} supplierName={p.supplierName} purchaseId={p.id} amount={p.balance} />}
      <ReturnGoodsModal open={ret} onClose={() => setRet(false)} purchase={p} onDone={refresh} />
    </div>
  );
}

function ReturnGoodsModal({ open, onClose, purchase, onDone }: { open: boolean; onClose: () => void; purchase: Purchase; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState<Record<number, { qty: number; damaged: boolean }>>({});
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: () => api.post<{ number: string }>('/api/purchase-returns', { purchaseId: purchase.id, reason, lines: Object.entries(q).filter(([, v]) => v.qty > 0).map(([k, v]) => ({ purchaseItemId: Number(k), quantity: v.qty, fromDamaged: v.damaged })) }),
    onSuccess: r => { toast.success(`Debit note ${r.number} issued`, 'Stock reduced and supplier balance adjusted.'); onDone(); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const valid = reason.trim().length > 2 && Object.values(q).some(v => v.qty > 0);
  return (
    <Modal open={open} onClose={onClose} title="Return goods to supplier" width={640}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || go.isPending} aria-busy={go.isPending} onClick={() => go.mutate()}>Issue debit note</button></>}>
      <div className="stack gap-4">
        <p>A GST debit note is issued; the input GST on these goods is reversed.</p>
        <table className="data compact"><thead><tr><th>Item</th><th className="num">Returnable</th><th style={{ width: 100 }}>Qty</th><th>From damaged</th></tr></thead>
          <tbody>{purchase.lines.filter(l => l.returnableQty > 0).map(l => (
            <tr key={l.id}><td>{l.description}</td><td className="num">{qty(l.returnableQty)}</td>
              <td><NumberInput value={q[l.id]?.qty ?? 0} min={0} max={l.returnableQty} aria-label="Quantity" onChange={v => setQ(x => ({ ...x, [l.id]: { qty: v ?? 0, damaged: x[l.id]?.damaged ?? false } }))} /></td>
              <td><Checkbox checked={q[l.id]?.damaged ?? false} onChange={v => setQ(x => ({ ...x, [l.id]: { qty: x[l.id]?.qty ?? 0, damaged: v } }))} label={<span className="text-sm">Yes</span>} /></td></tr>
          ))}</tbody></table>
        <TextInput label="Reason" required value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged in transit" />
      </div>
    </Modal>
  );
}
