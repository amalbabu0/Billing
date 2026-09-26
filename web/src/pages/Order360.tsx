import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle, CircleDashed, Minus, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime, label, money } from '@/lib/format';
import { Badge, Card, DocNo, EmptyState, ErrorPanel, PageHeader, SkeletonRows, StatStrip, Status, Timeline } from '@/components/ui/display';

interface Doc { kind: string; id: number; number?: string; date?: string; status?: string; amount?: number | null; detail?: string }
interface Stage { key: string; label: string; state: 'done' | 'active' | 'pending' | 'skipped'; detail?: string; kind?: string; id?: number }
interface Event { at: string; kind: string; id: number; number?: string; title: string; detail?: string; status?: string }
interface Lifecycle { customerId: number; customerName: string; customerMobile?: string; title: string; total: number; paid: number; balance: number; stages: Stage[]; events: Event[]; documents: Record<string, Doc[]> }

/** Where each record type opens. */
export const routeOf = (kind: string, id: number): string | undefined => ({
  QUOTATION: `/sales/quotations/${id}`, SALES_ORDER: `/sales/orders/${id}`, INVOICE: `/sales/invoices/${id}`, CUSTOM_ORDER: `/custom-orders/${id}`,
  PRODUCTION_ORDER: `/production?open=${id}`, PAYMENT: `/sales/payments?open=${id}`, DELIVERY: `/delivery/all?open=${id}`, INSTALLATION: '/installation',
  WARRANTY: `/service/warranties?open=${id}`, SERVICE: `/service/tickets?open=${id}`, LEAD: `/crm/leads?open=${id}`, RETURN: '/sales/returns',
} as Record<string, string>)[kind];

const SECTIONS: [string, string][] = [
  ['leads', 'Lead'], ['quotation', 'Quotation'], ['salesOrder', 'Sales order'], ['customOrder', 'Custom order'], ['production', 'Production'], ['payments', 'Payments'],
  ['invoice', 'Invoice'], ['deliveries', 'Delivery'], ['installations', 'Installation'], ['warranties', 'Warranty'], ['service', 'Service'], ['returns', 'Returns'],
];
const STAGE_ICON = { done: Check, active: Circle, pending: CircleDashed, skipped: Minus };

/** Order 360°: one page that follows a sale from enquiry to after-sales service. */
export default function Order360() {
  const { kind = 'INVOICE', id } = useParams();
  const { data: d, error, refetch, isLoading } = useQuery({ queryKey: ['lifecycle', kind, Number(id)], queryFn: () => api.get<Lifecycle>(`/api/lifecycle/${kind}/${id}`) });
  if (error) return <div className="page"><ErrorPanel error={error} retry={() => void refetch()} /></div>;
  if (isLoading || !d) return <div className="page"><SkeletonRows rows={8} /></div>;
  const docs = SECTIONS.filter(([k]) => d.documents[k]?.length);
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: d.customerName, to: `/customers/${d.customerId}` }, { label: '360° view' }]} title={d.title}
        desc={<span className="row gap-3 wrap"><Link to={`/customers/${d.customerId}`}>{d.customerName}</Link>{d.customerMobile && <a href={`tel:${d.customerMobile}`} className="row gap-1"><Phone aria-hidden style={{ width: 13 }} />{d.customerMobile}</a>}</span>} />
      <StatStrip items={[{ label: 'Order value', value: money(d.total) }, { label: 'Paid', value: money(d.paid), tone: 'ok' }, { label: 'Balance', value: money(d.balance), tone: d.balance > 0.5 ? 'warn' : undefined }]} />
      <Card>
        <ol className="lifecycle" aria-label="Order lifecycle">
          {d.stages.map(s => {
            const Icon = STAGE_ICON[s.state];
            const to = s.kind && s.id ? routeOf(s.kind, s.id) : undefined;
            const body = <><span className={`lc-dot ${s.state}`}><Icon aria-hidden /></span><span className="lc-label">{s.label}</span>{s.detail && <span className="lc-detail">{s.detail}</span>}</>;
            return <li key={s.key} className={`lc-step ${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>{to ? <Link to={to}>{body}</Link> : <div>{body}</div>}</li>;
          })}
        </ol>
      </Card>
      <div className="split narrow-left">
        <div className="stack gap-4">
          {docs.length === 0 ? <EmptyState compact title="No linked records" /> : docs.map(([key, title]) => (
            <Card key={key} title={title} bodyClass="">
              <ul className="list-plain">{d.documents[key].map(x => {
                const to = routeOf(x.kind, x.id);
                return (
                  <li key={`${x.kind}-${x.id}`} className="lc-doc">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row gap-2"><DocNo to={to}>{x.number ?? `#${x.id}`}</DocNo>{x.date && <span className="text-xs muted">{date(x.date)}</span>}</div>
                      {x.detail && <div className="text-sm soft truncate">{x.detail}</div>}
                    </div>
                    {x.amount != null && <span className={`num medium ${x.amount < 0 ? 't-bad' : ''}`}>{money(x.amount)}</span>}
                    {x.status && (x.kind === 'RETURN' ? <Badge>{label(x.status)}</Badge> : <Status value={x.status} />)}
                  </li>
                );
              })}</ul>
            </Card>
          ))}
        </div>
        <Card title="Timeline" sub="Newest first">
          {d.events.length === 0 ? <EmptyState compact title="No activity yet" /> : (
            <Timeline items={d.events.map((e, i) => ({
              key: i, title: <span className="row gap-2">{e.title}{e.number && <DocNo to={routeOf(e.kind, e.id)}>{e.number}</DocNo>}</span>, detail: e.detail, time: dateTime(e.at),
              tone: e.status && ['CANCELLED', 'VOIDED', 'LOST', 'FAILED'].includes(e.status) ? 'bad' as const : e.kind === 'PAYMENT' ? 'ok' as const : 'info' as const,
            }))} />
          )}
        </Card>
      </div>
    </div>
  );
}
