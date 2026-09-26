import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, Factory, FileText, IndianRupee, MessageCircle, Pencil, Receipt, Truck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, daysFromToday, money } from '@/lib/format';
import { P } from '@/lib/perms';
import { CUSTOM_ORDER_FLOW, CUSTOM_ORDER_LABELS, PRODUCTION_LABELS } from '@/lib/status';
import type { CheckoutResult, CustomOrder, Delivery, Payment, ProductionOrder, StatusHistory } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { Card, DocNo, ErrorPanel, Money, Notice, PageHeader, SkeletonRows, Status, Timeline, Tracker } from '@/components/ui/display';
import { Menu, Modal, useConfirm } from '@/components/ui/overlay';
import { NumberInput, TextInput } from '@/components/ui/form';
import { PaymentDialog } from '@/components/PaymentDialog';
import { WhatsAppDialog } from '@/components/DocActions';

interface Detail { order: CustomOrder; history: StatusHistory[]; payments: Payment[]; deliveries: Delivery[] }
const MANUAL_NEXT: Record<string, string> = { RECEIVED: 'DESIGN', DESIGN: 'PRODUCTION', PRODUCTION: 'QUALITY_CHECK', QUALITY_CHECK: 'READY' };

export default function CustomOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['custom-order', Number(id)], queryFn: () => api.get<Detail>(`/api/custom-orders/${id}`) });
  const [pay, setPay] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [wa, setWa] = useState(false);
  const [note, setNote] = useState<{ open: boolean; text: string }>({ open: false, text: '' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['custom-order', Number(id)] }); ['custom-orders-production', 'custom-orders-ready', 'dashboard'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); };
  const advance = useMutation({
    mutationFn: (n: string) => api.post<{ status: string }>(`/api/custom-orders/${id}/advance`, { note: n || undefined }),
    onSuccess: r => { toast.success(`Moved to ${CUSTOM_ORDER_LABELS[r.status]}`); setNote({ open: false, text: '' }); refresh(); },
    onError: e => toast.error('Stage not changed', errorMessage(e)),
  });
  const delivery = useMutation({
    mutationFn: () => api.post(`/api/custom-orders/${id}/delivery`),
    onSuccess: () => { toast.success('Delivery created', 'Schedule it on the Delivery board.'); refresh(); },
    onError: e => toast.error('Could not create delivery', errorMessage(e)),
  });
  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (!data) return <div className="page"><SkeletonRows rows={8} /></div>;
  const o = data.order;
  const price = o.finalPrice || o.estimatedCost;
  const cancelled = o.status === 'CANCELLED';
  const next = MANUAL_NEXT[o.status];
  const days = daysFromToday(o.expectedCompletionDate);
  const steps = CUSTOM_ORDER_FLOW.map(k => ({ key: k, label: CUSTOM_ORDER_LABELS[k] }));

  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${o.number}?`, confirmText: 'Cancel order', reason: { label: 'Reason' },
      message: <>Production stops. {o.advancePaid > 0 && <>The advance of <b>{money(o.advancePaid)}</b> stays on the customer’s account.</>}</> });
    if (reason === null) return;
    try { await api.post(`/api/custom-orders/${o.id}/cancel`, { reason }); toast.success('Custom order cancelled'); refresh(); } catch (e) { toast.error('Not cancelled', errorMessage(e)); }
  };

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Custom orders', to: '/custom-orders' }, { label: o.number }]}
        title={<span>{o.productType} <span className="doc-no muted" style={{ fontSize: 16 }}>{o.number}</span></span>}
        badge={<Status value={o.status} text={CUSTOM_ORDER_LABELS[o.status]} />}
        desc={<><Link to={`/customers/${o.customerId}`}>{o.customerName}</Link> · ordered {date(o.orderDate)} · {o.expectedCompletionDate ? <span className={days !== null && days < 0 && !cancelled && o.status !== 'COMPLETED' ? 't-bad' : ''}>due {date(o.expectedCompletionDate)}{days !== null && days < 0 && !cancelled && o.status !== 'COMPLETED' ? ` (${-days} day${days === -1 ? "" : "s"} late)` : ''}</span> : 'no due date'}</>}
        actions={!cancelled && <>
          {next && can(P.CustomOrderManage) && <button className="btn btn-primary" onClick={() => setNote({ open: true, text: '' })}><ArrowRight aria-hidden />Move to {CUSTOM_ORDER_LABELS[next]}</button>}
          {o.status === 'READY' && !o.invoiceId && can(P.InvoiceCreate) && <button className="btn btn-primary" onClick={() => setInvoice(true)}><Receipt aria-hidden />Generate invoice</button>}
          {o.status === 'READY' && o.invoiceId && can(P.DeliveryManage) && data.deliveries.length === 0 && <button className="btn btn-primary" onClick={() => delivery.mutate()} aria-busy={delivery.isPending}><Truck aria-hidden />Create delivery</button>}
          {!o.invoiceId && can(P.PaymentReceive) && <button className="btn" onClick={() => setPay(true)}><IndianRupee aria-hidden />Receive advance</button>}
          <Menu items={[
            { label: 'Send confirmation on WhatsApp', icon: <MessageCircle />, onClick: () => setWa(true) },
            { label: 'Edit order', icon: <Pencil />, onClick: () => nav(`/custom-orders/${o.id}/edit`), hidden: !can(P.CustomOrderManage) || !!o.invoiceId },
            { separator: true, label: '', hidden: !!o.invoiceId || !can(P.CustomOrderManage) },
            { label: 'Cancel order', icon: <Ban />, danger: true, onClick: cancel, hidden: !!o.invoiceId || !can(P.CustomOrderManage) },
          ]} />
        </>} />

      {cancelled ? <Notice tone="bad">Cancelled — {o.cancelReason}</Notice> : (
        <Card><Tracker steps={steps} current={o.status} skipped={o.requiresInstallation ? [] : ['INSTALLATION']} /></Card>
      )}
      {o.status === 'QUALITY_CHECK' && !o.finalPrice && <Notice tone="warn">Enter the final price (Edit order) before marking the order ready.</Notice>}
      {(o.status === 'DELIVERY' || o.status === 'INSTALLATION') && <Notice tone="info">This stage finishes automatically when the {o.status === 'DELIVERY' ? 'delivery is completed with proof' : 'installation job is completed'}.</Notice>}

      <div className="doc-layout">
        <div className="stack gap-4">
          <Card title="Specification">
            <div className="row top gap-5 wrap">
              <div className="grow stack gap-4" style={{ minWidth: 260 }}>
                {o.design && <p style={{ fontSize: 15 }}>{o.design}</p>}
                <div className="spec-grid">
                  <Spec k="Dimensions (W × H × D)" v={o.dimensionsText || '—'} />
                  <Spec k="Material" v={o.material} /><Spec k="Finish" v={o.finish} /><Spec k="Colour" v={o.color} />
                  {o.fabric && <Spec k="Fabric" v={o.fabric} />}
                  {(o.doors || o.drawers) ? <Spec k="Doors / drawers" v={`${o.doors ?? 0} / ${o.drawers ?? 0}`} /> : null}
                  <Spec k="Installation" v={o.requiresInstallation ? 'Required' : 'Not needed'} />
                </div>
                {o.specialRequirements && <div><div className="caps">Special requirements</div><p className="soft" style={{ marginTop: 4 }}>{o.specialRequirements}</p></div>}
              </div>
              <div style={{ width: 260 }}>
                <div className="caps" style={{ marginBottom: 6 }}>Reference</div>
                {o.referenceAttachmentId ? <a className="ref-image" href={`/api/attachments/${o.referenceAttachmentId}`} target="_blank" rel="noreferrer"><img src={`/api/attachments/${o.referenceAttachmentId}`} alt="Reference design" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /><FileText aria-hidden /></a>
                  : <div className="ref-image"><span className="text-sm">No reference image</span></div>}
              </div>
            </div>
          </Card>
          <ProductionCard order={o} />
          <Card title="Progress">
            <Timeline items={[...data.history].reverse().map(h => ({ key: h.id, title: CUSTOM_ORDER_LABELS[h.toStatus] ?? h.toStatus, detail: h.note && h.note !== CUSTOM_ORDER_LABELS[h.toStatus] ? h.note : undefined, time: `${dateTime(h.changedAt)}${h.changedByName ? ` · ${h.changedByName}` : ''}`, tone: h.toStatus === 'CANCELLED' ? 'bad' as const : 'ok' as const }))} />
          </Card>
        </div>
        <aside className="doc-side">
          <Card title="Payment">
            <div className="pay-position">
              <div className="row-line"><span>{o.finalPrice ? 'Final price' : 'Estimated price'}</span><span>{money(price)}</span></div>
              <div className="row-line"><span>Advance received</span><span className="t-ok">{money(o.advancePaid)}</span></div>
              <div className="row-line remaining"><span>Balance</span><span className={o.balance > 0 ? 't-warn' : 't-ok'}>{money(o.balance)}</span></div>
              {me.canSeeCost && o.productionCost ? <div className="row-line text-sm muted"><span>Production cost</span><span>{money(o.productionCost)} · margin {money(price - o.productionCost)}</span></div> : null}
            </div>
            {o.invoiceId && <div style={{ marginTop: 12 }}><Notice tone="ok">Invoiced as <DocNo to={`/sales/invoices/${o.invoiceId}`}>{o.invoiceNumber}</DocNo></Notice></div>}
            {data.payments.length > 0 && <ul className="list-plain stack gap-2" style={{ marginTop: 12 }}>{data.payments.map(p => <li key={p.id} className="row between text-sm"><span><DocNo>{p.number}</DocNo> <span className="muted">{date(p.paymentDate)} · {p.methods}</span></span><Money value={p.direction === 'OUT' ? -p.amount : p.amount} /></li>)}</ul>}
          </Card>
          {data.deliveries.map(d => (
            <Card key={d.id} title="Delivery">
              <div className="row between"><DocNo to={`/delivery/all?open=${d.id}`}>{d.number}</DocNo><Status value={d.status} /></div>
              <p className="text-sm soft" style={{ marginTop: 6 }}>{d.scheduledDate ? `${date(d.scheduledDate)} ${d.timeSlot ?? ''}` : 'Not scheduled'}{d.driverName ? ` · ${d.driverName}` : ''}</p>
            </Card>
          ))}
          <Card title="Customer"><p className="medium"><Link to={`/customers/${o.customerId}`}>{o.customerName}</Link></p><p className="text-sm soft">{o.customerMobile}</p>{o.deliveryAddress && <p className="text-sm soft" style={{ marginTop: 6 }}>{o.deliveryAddress}</p>}</Card>
        </aside>
      </div>
      <Modal open={note.open} onClose={() => setNote({ open: false, text: '' })} title={next ? `Move to ${CUSTOM_ORDER_LABELS[next]}` : ''} width={460}
        footer={<><button className="btn" onClick={() => setNote({ open: false, text: '' })}>Cancel</button><button className="btn btn-primary" onClick={() => advance.mutate(note.text)} aria-busy={advance.isPending}>Confirm</button></>}>
        <TextInput label="Note for the timeline" optional value={note.text} onChange={e => setNote({ open: true, text: e.target.value })} autoFocus placeholder={next === 'PRODUCTION' ? 'e.g. Design approved on WhatsApp' : 'e.g. Carcass assembled'} />
      </Modal>
      {pay && <PaymentDialog open onClose={() => setPay(false)} customerId={o.customerId} customerName={o.customerName} docType="CUSTOM_ORDER" docId={o.id} docNumber={o.number} onDone={refresh} />}
      <InvoiceModal open={invoice} onClose={() => setInvoice(false)} order={o} onDone={refresh} />
      <WhatsAppDialog open={wa} onClose={() => setWa(false)} url={`/api/custom-orders/${o.id}/whatsapp`} />
    </div>
  );
}

function Spec({ k, v }: { k: string; v?: string | null }) {
  return <div className="spec"><div className="k">{k}</div><div className="v">{v || '—'}</div></div>;
}

function InvoiceModal({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: CustomOrder; onDone: () => void }) {
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [amount, setAmount] = useState<number | null>(order.balance);
  const [method, setMethod] = useState('CASH');
  const go = useMutation({
    mutationFn: () => api.post<CheckoutResult>(`/api/custom-orders/${order.id}/invoice`, { payments: amount ? [{ methodCode: method, amount }] : [] }),
    onSuccess: r => { toast.success(`Invoice ${r.invoiceNumber} generated`, 'The advance was applied.'); onDone(); onClose(); },
    onError: e => toast.error('Not generated', errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={`Invoice for ${order.number}`} width={480}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => go.mutate()} aria-busy={go.isPending}>Generate invoice</button></>}>
      <div className="stack gap-4">
        <div className="pay-position"><div className="row-line"><span>Final price</span><span>{money(order.finalPrice)}</span></div><div className="row-line"><span>Advance applied</span><span>−{money(order.advancePaid)}</span></div><div className="row-line remaining"><span>Balance</span><span>{money(order.balance)}</span></div></div>
        <div className="grid grid-2">
          <NumberInput label="Collect now" money value={amount} max={order.balance} onChange={setAmount} />
          <div className="field"><label className="field-label" htmlFor="cim">Method</label><select id="cim" className="select" value={method} onChange={e => setMethod(e.target.value)}>{(lookups?.paymentMethods ?? []).filter(m => m.isMoney).map(m => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
        </div>
      </div>
    </Modal>
  );
}

function ProductionCard({ order }: { order: CustomOrder }) {
  const can = useCan();
  const me = useMe();
  const { data = [] } = useQuery({ queryKey: ['custom-order', order.id, 'production'], queryFn: () => api.get<ProductionOrder[]>(`/api/custom-orders/${order.id}/production`), enabled: can(P.ProductionView) });
  if (!can(P.ProductionView)) return null;
  const open = !['CANCELLED', 'COMPLETED'].includes(order.status) && !order.invoiceId;
  return (
    <Card title="Workshop" sub={data.length ? undefined : 'Raise a production order to plan materials and track the build.'}
      actions={open && can(P.ProductionManage) && <Link className="btn btn-sm" to={`/production?customOrder=${order.id}`}><Factory aria-hidden />Start production</Link>}>
      {data.length === 0 ? <p className="text-sm muted">No production orders yet.</p> : (
        <ul className="list-plain stack gap-2">{data.map(p => (
          <li key={p.id} className="row between gap-3">
            <span><DocNo to={`/production?open=${p.id}`}>{p.number}</DocNo> <span className="text-sm soft">{p.description}</span></span>
            <span className="row gap-3">{me.canSeeCost && p.totalCost != null && <span className="text-sm muted">{money(p.totalCost)}</span>}<Status value={p.status} text={PRODUCTION_LABELS[p.status]} /></span>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}
