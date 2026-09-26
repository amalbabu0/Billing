import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, FilePlus2, Hammer, IndianRupee, PackagePlus, Receipt, Truck, UserPlus, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { compactMoney, date, greeting, label, money, relative, shortDate, daysFromToday } from '@/lib/format';
import { rangeFor, useStored } from '@/lib/hooks';
import { P } from '@/lib/perms';
import { CUSTOM_ORDER_LABELS } from '@/lib/status';
import type { CustomOrder, Delivery, InventoryRow, InvoiceRow, Payment, SalesOrder } from '@/lib/types';
import { useCan, useMe } from '@/app/providers';
import { Card, Delta, DocNo, ErrorPanel, Kpi, Money, Status, Tabs } from '@/components/ui/display';
import { DateRange } from '@/components/pickers';
import { TrendChart } from '@/components/Charts';
import { AttentionRow, FollowUpsCard } from '@/components/DashboardExtras';

interface KpiValue { value: number; previous?: number | null; count: number; changePercent?: number | null }
interface Overview {
  from: string; to: string; trendFrom: string; granularity: 'day' | 'month'; sales: KpiValue; collection: KpiValue; outstanding: KpiValue; overdueAmount: number;
  pendingDeliveries: number; deliveriesToday: number; pendingOrders: number; customOrdersInProgress: number; averageInvoice: number;
  trend: { date: string; sales: number; collected: number; invoices: number }[];
  upcomingDeliveries: Delivery[]; pendingPayments: InvoiceRow[]; customOrders: CustomOrder[]; lowStock: InventoryRow[];
  activity: { at: string; userName?: string; action: string; module: string; summary: string }[];
  recentInvoices: InvoiceRow[]; recentPayments: Payment[]; recentOrders: SalesOrder[];
}

const PERIOD_WORD: Record<string, string> = { today: 'Today’s', yesterday: 'Yesterday’s', '7d': '7-day', '30d': '30-day', month: 'This month’s', custom: 'Period' };

export default function Dashboard() {
  const me = useMe();
  const can = useCan();
  const nav = useNavigate();
  const [preset, setPreset] = useStored('dash-range', 'today');
  const [range, setRange] = useState(() => ({ preset, ...rangeFor(preset) }));
  const { data: d, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', range.from, range.to],
    queryFn: () => api.get<Overview>('/api/dashboard', { from: range.from, to: range.to }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const word = PERIOD_WORD[range.preset] ?? 'Period';
  const compare = range.preset === 'today' ? 'vs yesterday' : range.preset === 'yesterday' ? 'vs day before' : 'vs previous period';
  const [recentTab, setRecentTab] = useState<'invoices' | 'payments' | 'orders'>('invoices');

  return (
    <div className="page">
      <div className="dash-hero">
        <div className="grow">
          <h1>{greeting()}, {me.user.fullName.split(' ')[0]}</h1>
          <p className="page-desc">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · {me.shop.name}</p>
        </div>
        <div className="quick-actions">
          {can(P.InvoiceCreate) && <Link className="btn btn-primary" to="/pos"><Receipt aria-hidden />New invoice <span className="kbd">F2</span></Link>}
          {can(P.QuotationManage) && <Link className="btn" to="/sales/quotations/new"><FilePlus2 aria-hidden />New quotation</Link>}
          {can(P.CustomerManage) && <Link className="btn" to="/customers?new=1"><UserPlus aria-hidden />Add customer</Link>}
          {can(P.ProductManage) && <Link className="btn" to="/products/new"><PackagePlus aria-hidden />Add product</Link>}
        </div>
      </div>

      <div className="row wrap between gap-3">
        <DateRange value={range} onChange={v => { setRange(v); setPreset(v.preset); }} />
        {isFetching && !isLoading && <span className="text-xs muted" aria-live="polite">Updating…</span>}
      </div>

      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : (
        <>
          <section className="kpi-row" aria-label="Key figures">
            <Kpi loading={isLoading} label={`${word} sales`} icon={<IndianRupee aria-hidden />} value={money(d?.sales.value, { decimals: false })}
              foot={d && <><span>{d.sales.count} invoice{d.sales.count === 1 ? '' : 's'}</span>·<Delta value={d.sales.changePercent} suffix={compare} /></>}
              to={can(P.InvoiceView) ? `/sales/invoices?from=${range.from}&to=${range.to}` : undefined} />
            <Kpi loading={isLoading} label={`${word} collection`} icon={<Wallet aria-hidden />} value={money(d?.collection.value, { decimals: false })}
              foot={d && <Delta value={d.collection.changePercent} suffix={compare} />} to={can(P.PaymentView) ? `/sales/payments?from=${range.from}&to=${range.to}` : undefined} />
            <Kpi loading={isLoading} label="Outstanding" icon={<AlertTriangle aria-hidden />} value={money(d?.outstanding.value, { decimals: false })}
              tone={d && d.overdueAmount > 0 ? 'bad' : undefined}
              foot={d && (d.overdueAmount > 0 ? <span className="t-bad medium">{money(d.overdueAmount, { decimals: false })} overdue</span> : <span>{d.outstanding.count} open invoices</span>)}
              to={can(P.CustomerView) ? '/customers/outstanding' : undefined} />
            <Kpi loading={isLoading} label="Pending deliveries" icon={<Truck aria-hidden />} value={d?.pendingDeliveries ?? 0}
              foot={d && (d.deliveriesToday > 0 ? <span>{d.deliveriesToday} scheduled today</span> : <span>None scheduled today</span>)}
              to={can(P.DeliveryView) ? '/delivery/all' : undefined} />
            <Kpi loading={isLoading} label="Pending orders" icon={<ClipboardList aria-hidden />} value={d?.pendingOrders ?? 0}
              foot={d && <span>{d.customOrdersInProgress} custom in production</span>} to={can(P.SalesOrderView) ? '/sales/orders?open=true' : undefined} />
          </section>

          <AttentionRow />

          <div className="dash-grid">
            <Card title="Sales trend" sub={d ? `${date(d.trendFrom)} – ${date(d.to)}${d.trendFrom !== d.from ? ' (last 30 days for context)' : ''} · average invoice ${money(d.averageInvoice, { decimals: false })}` : ' '}>
              {d && d.trend.length > 1 ? (
                <TrendChart
                  label="Sales and collections over the selected period"
                  labels={d.trend.map(t => (d.granularity === 'month' ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' }).format(new Date(t.date)) : shortDate(t.date)))}
                  series={[{ name: 'Sales', values: d.trend.map(t => t.sales) }, { name: 'Collected', values: d.trend.map(t => t.collected) }]}
                  height={260}
                />
              ) : d ? (
                <div className="stack gap-2" style={{ padding: '24px 0' }}>
                  <div className="money-hero"><span className="value">{money(d.sales.value, { decimals: false })}</span><span className="muted">sold · {money(d.collection.value, { decimals: false })} collected</span></div>
                  <p className="muted text-sm">Choose 7 days or longer to see the trend.</p>
                </div>
              ) : <div style={{ height: 260 }} />}
            </Card>

            <Card title="Payments to follow up" sub="Overdue first, then largest balance" bodyClass=""
              actions={can(P.CustomerView) && <Link className="btn btn-sm btn-ghost" to="/customers/outstanding">All<ArrowRight aria-hidden /></Link>}>
              {(d?.pendingPayments ?? []).length === 0 ? <div className="card-list-empty">Nothing pending — every invoice is paid.</div> : d!.pendingPayments.map(i => {
                const days = daysFromToday(i.dueDate);
                return (
                  <Link key={i.id} to={`/sales/invoices/${i.id}`} className="mini-row">
                    <div className="main">
                      <div className="title">{i.customerName}</div>
                      <div className="meta"><span className="doc-no">{i.number}</span> · {days !== null && days < 0 ? <span className="t-bad">{-days} day{days === -1 ? '' : 's'} overdue</span> : `due ${shortDate(i.dueDate)}`}</div>
                    </div>
                    <Money value={i.balance} decimals={false} strong />
                  </Link>
                );
              })}
            </Card>
          </div>

          <div className="ops-grid">
            <FollowUpsCard />
            {can(P.DeliveryView) && (
              <Card title="Deliveries" sub={`${d?.pendingDeliveries ?? 0} open`} bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/delivery/all">Board<ArrowRight aria-hidden /></Link>}>
                {(d?.upcomingDeliveries ?? []).length === 0 ? <div className="card-list-empty">No deliveries waiting.</div> : d!.upcomingDeliveries.map(x => (
                  <Link key={x.id} to={`/delivery/all?open=${x.id}`} className="mini-row">
                    <span className="icon-circle"><Truck aria-hidden /></span>
                    <div className="main">
                      <div className="title">{x.customerName}</div>
                      <div className="meta">{x.scheduledDate ? `${shortDate(x.scheduledDate)}${x.timeSlot ? `, ${x.timeSlot}` : ''}` : 'Not scheduled'}{x.driverName ? ` · ${x.driverName}` : ''} · {x.itemsSummary}</div>
                    </div>
                    <Status value={x.status} />
                  </Link>
                ))}
              </Card>
            )}
            {can(P.CustomOrderView) && (
              <Card title="Custom orders" sub={`${d?.customOrdersInProgress ?? 0} in progress`} bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/custom-orders">Production<ArrowRight aria-hidden /></Link>}>
                {(d?.customOrders ?? []).length === 0 ? <div className="card-list-empty">No custom orders in progress.</div> : d!.customOrders.map(o => {
                  const days = daysFromToday(o.expectedCompletionDate);
                  return (
                    <Link key={o.id} to={`/custom-orders/${o.id}`} className="mini-row">
                      <span className="icon-circle tone-brand"><Hammer aria-hidden /></span>
                      <div className="main">
                        <div className="title">{o.productType} · {o.customerName}</div>
                        <div className="meta">{days === null ? 'No date' : days < 0 ? <span className="t-bad">{-days} day{days === -1 ? '' : 's'} late</span> : days === 0 ? 'Due today' : `Due in ${days} days`}</div>
                      </div>
                      <Status value={o.status} text={CUSTOM_ORDER_LABELS[o.status]} />
                    </Link>
                  );
                })}
              </Card>
            )}
            {can(P.InventoryView, P.ProductView) && (
              <Card title="Low stock" sub="At or below minimum" bodyClass="" actions={<Link className="btn btn-sm btn-ghost" to="/inventory/low">View<ArrowRight aria-hidden /></Link>}>
                {(d?.lowStock ?? []).length === 0 ? <div className="card-list-empty">Stock levels look healthy.</div> : d!.lowStock.map(s => (
                  <Link key={s.variantId} to={`/inventory?open=${s.variantId}`} className="mini-row">
                    <span className={`icon-circle tone-${s.available <= 0 ? 'bad' : 'warn'}`}><Boxes aria-hidden /></span>
                    <div className="main"><div className="title">{s.displayName}</div><div className="meta"><span className="mono">{s.sku}</span> · min {s.minStock}</div></div>
                    <span className={`num strong ${s.available <= 0 ? 't-bad' : 't-warn'}`}>{s.available}</span>
                  </Link>
                ))}
              </Card>
            )}
            <Card title="Recent activity" bodyClass="" actions={can(P.AuditView) && <Link className="btn btn-sm btn-ghost" to="/employees/activity">Log<ArrowRight aria-hidden /></Link>}>
              {(d?.activity ?? []).length === 0 ? <div className="card-list-empty">No activity yet.</div> : d!.activity.map((a, i) => (
                <div key={i} className="mini-row">
                  <div className="main"><div className="text-sm" style={{ lineHeight: 1.35 }}>{a.summary}</div><div className="meta">{relative(a.at)} · {a.module}</div></div>
                </div>
              ))}
            </Card>
          </div>

          <Card bodyClass="" title="Recent" actions={
            <Tabs value={recentTab} onChange={setRecentTab} label="Recent documents" tabs={[
              { value: 'invoices', label: 'Invoices', hidden: !can(P.InvoiceView) },
              { value: 'payments', label: 'Payments', hidden: !can(P.PaymentView) },
              { value: 'orders', label: 'Orders', hidden: !can(P.SalesOrderView) },
            ]} />
          }>
            {recentTab === 'invoices' && (d?.recentInvoices ?? []).map(i => (
              <button key={i.id} className="mini-row list-row" onClick={() => nav(`/sales/invoices/${i.id}`)}>
                <DocNo>{i.number ?? 'Draft'}</DocNo>
                <div className="main"><div className="title">{i.customerName}</div><div className="meta">{date(i.invoiceDate)}</div></div>
                <Status value={i.paymentState} />
                <Money value={i.grandTotal} decimals={false} strong />
              </button>
            ))}
            {recentTab === 'payments' && (d?.recentPayments ?? []).map(p => (
              <div key={p.id} className="mini-row">
                <DocNo>{p.number}</DocNo>
                <div className="main"><div className="title">{p.customerName}</div><div className="meta">{relative(p.createdAt)} · {p.methods}</div></div>
                {p.isVoided && <Status value="VOIDED" />}
                <Money value={p.direction === 'OUT' ? -p.amount : p.amount} decimals={false} strong />
              </div>
            ))}
            {recentTab === 'orders' && (d?.recentOrders ?? []).map(o => (
              <button key={o.id} className="mini-row list-row" onClick={() => nav(`/sales/orders/${o.id}`)}>
                <DocNo>{o.number}</DocNo>
                <div className="main"><div className="title">{o.customerName}</div><div className="meta">{o.expectedDeliveryDate ? `Delivery ${shortDate(o.expectedDeliveryDate)}` : label(o.status)} · advance {compactMoney(o.advancePaid)}</div></div>
                <Status value={o.status} />
                <Money value={o.grandTotal} decimals={false} strong />
              </button>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
