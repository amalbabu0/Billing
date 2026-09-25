import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightCircle, Ban, CheckCircle2, Copy, Pencil, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { addDays, date, dateTime, iso, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { AuditLog, Quotation } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { Card, DocNo, ErrorPanel, KV, Notice, PageHeader, SkeletonRows, Status, Timeline } from '@/components/ui/display';
import { Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { Checkbox, TextInput } from '@/components/ui/form';
import { DocActionsButtons } from '@/components/DocActions';
import { DocLinesTable, TaxSummary } from '@/components/DocLines';

export default function QuotationDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['quotation', Number(id)], queryFn: () => api.get<{ quotation: Quotation; history: AuditLog[] }>(`/api/quotations/${id}`) });
  const [convert, setConvert] = useState(false);
  useEffect(() => { if (params.get('convert')) { setConvert(true); setParams({}, { replace: true }); } }, [params, setParams]);

  const setStatus = useMutation({
    mutationFn: (status: string) => api.post(`/api/quotations/${id}/status`, { status }),
    onSuccess: (_, s) => { toast.success(`Quotation marked ${s === 'CONFIRMED' ? 'accepted' : s.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['quotation', Number(id)] }); qc.invalidateQueries({ queryKey: ['quotations'] }); },
    onError: e => toast.error('Not updated', errorMessage(e)),
  });

  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (isLoading || !data) return <div className="page"><SkeletonRows rows={10} /></div>;
  const q = data.quotation;
  const open = ['DRAFT', 'SENT', 'CONFIRMED'].includes(q.status);
  const expired = open && q.validUntil && new Date(q.validUntil) < new Date(new Date().toDateString());

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Quotations', to: '/sales/quotations' }, { label: q.number ?? '' }]}
        title={<span className="doc-no" style={{ fontSize: 'inherit' }}>{q.number}</span>} badge={<Status value={q.status} />}
        desc={<>{date(q.date)} · {q.customerName} · valid until {date(q.validUntil)}</>}
        actions={<>
          {open && can(P.SalesOrderManage) && <button className="btn btn-primary" onClick={() => setConvert(true)}><ArrowRightCircle aria-hidden />Convert to order</button>}
          {q.status === 'DRAFT' && can(P.QuotationManage) && <Link className="btn" to={`/sales/quotations/${q.id}/edit`}><Pencil aria-hidden />Edit</Link>}
          <DocActionsButtons base={`/api/quotations/${q.id}`} name={`${q.number} ${q.customerName}`} />
          {can(P.QuotationManage) && open && (
            <Menu label="Status" items={[
              { label: 'Mark as sent', icon: <CheckCircle2 />, onClick: () => setStatus.mutate('SENT'), hidden: q.status !== 'DRAFT' },
              { label: 'Customer accepted', icon: <CheckCircle2 />, onClick: () => setStatus.mutate('CONFIRMED'), hidden: q.status === 'CONFIRMED' },
              { label: 'Customer declined', icon: <XCircle />, onClick: () => setStatus.mutate('REJECTED') },
              { label: 'Duplicate as new', icon: <Copy />, onClick: () => nav(`/sales/quotations/new?customerId=${q.customerId}`) },
              { separator: true, label: '' },
              { label: 'Cancel quotation', icon: <Ban />, danger: true, onClick: async () => { if ((await confirm({ title: 'Cancel quotation?', message: 'It stays on record as cancelled and can’t be converted.', confirmText: 'Cancel quotation' })) !== null) setStatus.mutate('CANCELLED'); } },
            ]} />
          )}
        </>} />

      {expired && <Notice tone="warn">This quotation expired on {date(q.validUntil)}. Prices may have changed — confirm with the customer before converting.</Notice>}
      {q.salesOrderNumber && <Notice tone="ok">Converted to sales order <DocNo to={`/sales/orders/${q.salesOrderId}`}>{q.salesOrderNumber}</DocNo>.</Notice>}

      <div className="doc-layout">
        <div className="stack gap-4">
          <Card>
            <div className="doc-parties">
              <div className="doc-party"><h3>Customer</h3><p className="medium"><Link to={`/customers/${q.customerId}`}>{q.customerName}</Link></p><p className="text-sm soft">{q.customerMobile}</p>{q.customerGstin && <p className="text-sm mono">{q.customerGstin}</p>}</div>
              <div className="doc-party"><h3>Supply</h3><p>{q.isInterState ? 'IGST (inter-state)' : 'CGST + SGST'}</p>{q.deliveryAddress && <p className="text-sm soft">{q.deliveryAddress}</p>}</div>
              <div className="doc-party"><h3>Prepared by</h3><p>{q.createdByName ?? '—'}</p><p className="text-sm soft">{dateTime(q.createdAt)}</p></div>
            </div>
          </Card>
          <Card title="Items" bodyClass="">
            <DocLinesTable lines={q.lines} interState={q.isInterState} />
            <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
              <TaxSummary lines={q.lines} interState={q.isInterState} chargesTax={q.chargesTax} charges={q.deliveryCharge + q.installationCharge} />
              {q.notes && <p className="text-sm soft" style={{ marginTop: 12 }}><b>Note:</b> {q.notes}</p>}
            </div>
          </Card>
        </div>
        <aside className="doc-side">
          <Card title="Total">
            <dl className="totals">
              <dt>Subtotal</dt><dd>{money(q.subtotal)}</dd>
              {q.discountTotal > 0 && <><dt>Discount</dt><dd className="t-ok">−{money(q.discountTotal)}</dd></>}
              {q.deliveryCharge > 0 && <><dt>Delivery</dt><dd>{money(q.deliveryCharge)}</dd></>}
              {q.installationCharge > 0 && <><dt>Installation</dt><dd>{money(q.installationCharge)}</dd></>}
              <dt>GST</dt><dd>{money(q.taxTotal)}</dd>
              <dt className="grand">Grand total</dt><dd className="grand">{money(q.grandTotal)}</dd>
            </dl>
          </Card>
          {data.history.length > 0 && <Card title="History"><Timeline items={data.history.map(h => ({ key: h.id, title: h.summary, time: dateTime(h.occurredAt) }))} /></Card>}
        </aside>
      </div>
      <ConvertModal open={convert} onClose={() => setConvert(false)} quotation={q} onDone={soId => nav(`/sales/orders/${soId}`)} />
    </div>
  );
}

function ConvertModal({ open, onClose, quotation, onDone }: { open: boolean; onClose: () => void; quotation: Quotation; onDone: (id: number) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [expected, setExpected] = useState(iso(addDays(new Date(), 7)));
  const [confirmOrder, setConfirmOrder] = useState(true);
  const go = useMutation({
    mutationFn: () => api.post<{ salesOrderId: number }>(`/api/quotations/${quotation.id}/convert`, { expectedDelivery: expected, confirm: confirmOrder }),
    onSuccess: r => { toast.success('Sales order created', confirmOrder ? 'Stock has been reserved for this customer.' : 'Saved as a draft order.'); qc.invalidateQueries({ queryKey: ['quotations'] }); onDone(r.salesOrderId); },
    onError: e => toast.error('Could not convert', errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={`Convert ${quotation.number} to a sales order`} width={480}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} disabled={go.isPending} aria-busy={go.isPending}>Create sales order</button></>}>
      <div className="stack gap-4">
        <KV items={[['Customer', quotation.customerName], ['Value', money(quotation.grandTotal)], ['Items', `${quotation.lines.length} line(s), prices kept as quoted`]]} />
        <TextInput label="Expected delivery" type="date" value={expected} min={iso()} onChange={e => setExpected(e.target.value)} />
        <Checkbox checked={confirmOrder} onChange={setConfirmOrder} label="Confirm now and reserve stock" hint="Reserved pieces can’t be sold to other customers." />
      </div>
    </Modal>
  );
}
