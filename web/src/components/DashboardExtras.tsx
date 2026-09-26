import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BellRing, Factory, LifeBuoy, ShieldAlert, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { P } from '@/lib/perms';
import type { CashDay, FollowUp, Paged } from '@/lib/types';
import { useCan } from '@/app/providers';
import { Card } from './ui/display';
import { FollowUpList } from '@/pages/crm/Crm';

const count = (url: string, q: Record<string, string | number>) => api.get<Paged<unknown>>(url, { ...q, pageSize: 1 }).then(r => r.totalCount);

/** One line of "things that need someone today", each linking to where it is handled. Hidden when nothing needs attention. */
export function AttentionRow() {
  const can = useCan();
  const follow = useQuery({ queryKey: ['follow-ups', 'today', true], queryFn: () => api.get<FollowUp[]>('/api/follow-ups', { scope: 'today', mine: true }), enabled: can(P.LeadView, P.CustomerView), refetchInterval: 120_000 });
  const service = useQuery({ queryKey: ['service', 'count-open'], queryFn: () => count('/api/service', { status: 'OPEN' }), enabled: can(P.ServiceView) });
  const production = useQuery({ queryKey: ['production', 'count-open'], queryFn: () => count('/api/production', { status: 'OPEN' }), enabled: can(P.ProductionView) });
  const expiring = useQuery({ queryKey: ['warranties', 'count-expiring'], queryFn: () => count('/api/warranties', { status: 'EXPIRING' }), enabled: can(P.WarrantyView, P.ServiceView) });
  const cash = useQuery({ queryKey: ['cash', 'today'], queryFn: () => api.get<CashDay>('/api/cash'), enabled: can(P.CashManage, P.CashApprove) });
  const items: { to: string; icon: ReactNode; text: string; tone?: string }[] = [];
  const due = follow.data?.length ?? 0, overdue = follow.data?.filter(f => f.isOverdue).length ?? 0;
  if (due) items.push({ to: '/crm/follow-ups', icon: <BellRing />, text: `${due} follow-up${due > 1 ? 's' : ''} due${overdue ? ` (${overdue} overdue)` : ''}`, tone: overdue ? 'bad' : 'warn' });
  if (cash.data && !cash.data.session) items.push({ to: '/cash', icon: <Wallet />, text: 'Cash register not opened today', tone: 'warn' });
  if (cash.data?.session?.status === 'CLOSED') items.push({ to: '/cash', icon: <Wallet />, text: 'Cash difference waiting for approval', tone: 'bad' });
  if (service.data) items.push({ to: '/service/tickets', icon: <LifeBuoy />, text: `${service.data} open service ticket${service.data > 1 ? 's' : ''}` });
  if (production.data) items.push({ to: '/production', icon: <Factory />, text: `${production.data} in production` });
  if (expiring.data) items.push({ to: '/service/warranties?status=EXPIRING', icon: <ShieldAlert />, text: `${expiring.data} warrant${expiring.data > 1 ? 'ies' : 'y'} ending in 30 days` });
  if (!items.length) return null;
  return (
    <nav className="attention" aria-label="Needs attention">
      {items.map(i => <Link key={i.to + i.text} to={i.to} className={`attention-item ${i.tone ? `tone-${i.tone}` : ''}`}>{i.icon}<span>{i.text}</span><ArrowRight aria-hidden /></Link>)}
    </nav>
  );
}

export function FollowUpsCard() {
  const can = useCan();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['follow-ups', 'today', true], queryFn: () => api.get<FollowUp[]>('/api/follow-ups', { scope: 'today', mine: true }), enabled: can(P.LeadView, P.CustomerView) });
  if (!can(P.LeadView, P.CustomerView)) return null;
  return (
    <Card title="My follow-ups" sub={data.length ? `${data.length} due today or overdue` : 'Nothing due'} actions={<Link className="btn btn-sm btn-ghost" to="/crm/follow-ups">All<ArrowRight aria-hidden /></Link>}>
      <FollowUpList items={data.slice(0, 5)} onChanged={() => qc.invalidateQueries({ queryKey: ['follow-ups'] })} />
    </Card>
  );
}
