import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, LockOpen, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { date, dateTime, iso, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { CashDay, CashSession } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { Card, EmptyState, ErrorPanel, Notice, PageHeader, SkeletonRows, Status } from '@/components/ui/display';
import { NumberInput, TextInput } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';

const STATUS_TEXT: Record<string, string> = { OPEN: 'Open', CLOSED: 'Closed — difference to approve', APPROVED: 'Closed' };

/** Daily cash drawer: float in the morning, count at closing, approve differences. */
export default function CashRegister() {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [day, setDay] = useState(iso());
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['cash', day], queryFn: () => api.get<CashDay>('/api/cash', { date: day }) });
  const history = useQuery({ queryKey: ['cash', 'history'], queryFn: () => api.get<CashSession[]>('/api/cash/history') });
  const [opening, setOpening] = useState<number | null>(null);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash'] });
  const open = useMutation({ mutationFn: () => api.post('/api/cash/open', { openingCash: opening ?? data?.suggestedOpening ?? 0, date: day }), onSuccess: () => { toast.success('Register opened'); refresh(); }, onError: e => toast.error('Not opened', errorMessage(e)) });
  const close = useMutation({
    mutationFn: () => api.post<CashSession>('/api/cash/close', { date: day, countedCash: counted, note: note || null }),
    onSuccess: s => { toast.success(s.status === 'APPROVED' ? 'Day closed — cash matches' : 'Day closed — difference sent for approval'); setCounted(null); setNote(''); refresh(); },
    onError: e => toast.error('Not closed', errorMessage(e)),
  });
  const approve = async () => {
    const r = await confirm({ title: 'Approve the difference?', message: `${money(data?.session?.difference)} on ${date(day)}. ${data?.session?.closeNote ?? ''}`, confirmText: 'Approve', tone: 'warn', reason: { label: 'Note', required: false } });
    if (r === null) return;
    try { await api.post('/api/cash/approve', { date: day, note: r || null }); toast.success('Difference approved'); refresh(); } catch (e) { toast.error('Not approved', errorMessage(e)); }
  };
  const reopen = async () => {
    const r = await confirm({ title: 'Re-open this day?', message: 'The count is cleared so the day can be closed again.', confirmText: 'Re-open', tone: 'warn', reason: { label: 'Reason' } });
    if (r === null) return;
    try { await api.post('/api/cash/reopen', { date: day, reason: r }); toast.success('Day re-opened'); refresh(); } catch (e) { toast.error('Not re-opened', errorMessage(e)); }
  };
  const s = data?.session;
  const f = data?.figures;
  const expectedNow = s ? s.openingCash + (f?.net ?? 0) : null;
  const diff = counted !== null && expectedNow !== null ? Math.round((counted - expectedNow) * 100) / 100 : null;
  return (
    <div className="page">
      <PageHeader title="Cash register" desc="Open the drawer with the float, then count the cash at closing. The expected amount is worked out from cash receipts, refunds, expenses and supplier payments."
        actions={<TextInput label="Business date" type="date" value={day} max={iso()} onChange={e => e.target.value && setDay(e.target.value)} wrapClass="compact-field" />} />
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : isLoading || !data ? <SkeletonRows rows={6} /> : (
        <div className="split wide-left">
          <div className="stack gap-4">
            <Card title={date(day)} actions={s && <Status value={s.status} text={STATUS_TEXT[s.status]} />}>
              {!s ? (
                <div className="stack gap-4">
                  <Notice tone="info" icon={<LockOpen />}>The register is not open for this day yet.</Notice>
                  {can(P.CashManage) && <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
                    <div style={{ width: 220 }}><NumberInput label="Opening cash (float)" money value={opening ?? data.suggestedOpening ?? 0} onChange={setOpening} hint={data.suggestedOpening != null ? `Yesterday closed with ${money(data.suggestedOpening)}` : undefined} autoFocus /></div>
                    <button className="btn btn-primary" onClick={() => open.mutate()} aria-busy={open.isPending}><LockOpen aria-hidden />Open register</button>
                  </div>}
                </div>
              ) : (
                <div className="pay-position">
                  <div className="row-line"><span>Opening cash</span><span>{money(s.openingCash)}</span></div>
                  <div className="row-line"><span>+ Cash received ({f!.receipts} receipts)</span><span className="t-ok">{money(s.cashSales ?? f!.cashSales)}</span></div>
                  <div className="row-line"><span>− Cash refunds</span><span>{money(s.cashRefunds ?? f!.cashRefunds)}</span></div>
                  <div className="row-line"><span>− Cash expenses</span><span>{money(s.cashExpenses ?? f!.cashExpenses)}</span></div>
                  <div className="row-line"><span>− Cash paid to suppliers</span><span>{money(s.cashSupplier ?? f!.cashSupplier)}</span></div>
                  <div className="row-line remaining"><span>Expected in drawer</span><span>{money(s.expectedCash ?? expectedNow)}</span></div>
                  {s.countedCash != null && <>
                    <div className="row-line"><span>Counted</span><span className="medium">{money(s.countedCash)}</span></div>
                    <div className="row-line"><span>Difference</span><span className={s.difference ? 't-bad medium' : 't-ok medium'}>{s.difference ? `${s.difference > 0 ? 'excess ' : 'short '}${money(Math.abs(s.difference))}` : 'None'}</span></div>
                  </>}
                  <div className="row-line text-sm muted"><span>Card / UPI / bank received (not in drawer)</span><span>{money(f!.nonCash)}</span></div>
                </div>
              )}
            </Card>
            {s?.status === 'OPEN' && can(P.CashManage) && (
              <Card title="Close the day" sub="Count the notes and coins in the drawer.">
                <div className="stack gap-4">
                  <div className="grid grid-2">
                    <NumberInput label="Counted cash" money value={counted} onChange={setCounted} />
                    {diff !== null && <div className="field" style={{ justifyContent: 'flex-end' }}><span className={diff === 0 ? 't-ok medium' : 't-bad medium'}>{diff === 0 ? 'Matches expected cash' : `${diff > 0 ? 'Excess' : 'Short'} by ${money(Math.abs(diff))}`}</span></div>}
                  </div>
                  {diff !== null && diff !== 0 && <TextInput label="Explain the difference" required value={note} onChange={e => setNote(e.target.value)} placeholder="Change given, receipt not entered…" />}
                  <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={counted === null || (diff !== 0 && !note.trim())} onClick={() => close.mutate()} aria-busy={close.isPending}><Lock aria-hidden />Close day</button>
                </div>
              </Card>
            )}
            {s?.status === 'CLOSED' && <Notice tone="warn" action={can(P.CashApprove) && <div className="row gap-2"><button className="btn btn-sm" onClick={reopen}><RotateCcw aria-hidden />Re-open</button><button className="btn btn-sm btn-primary" onClick={approve}><ShieldCheck aria-hidden />Approve</button></div>}>
              Closed by {s.closedByName} with a difference of {money(s.difference)} — “{s.closeNote}”. {can(P.CashApprove) ? '' : 'A manager needs to approve it.'}</Notice>}
            {s?.status === 'APPROVED' && s.countedCash != null && <Notice tone="ok" icon={<CheckCircle2 />} action={can(P.CashApprove) && <button className="btn btn-sm" onClick={reopen}><RotateCcw aria-hidden />Re-open</button>}>
              Closed by {s.closedByName} {s.closedAt ? dateTime(s.closedAt) : ''}{s.approvedByName && s.difference ? ` · approved by ${s.approvedByName}` : ''}.</Notice>}
            <Card title="Cash movements" bodyClass="">
              {data.movements.length === 0 ? <EmptyState compact icon={<Wallet />} title="No cash movements" /> : (
                <div className="table-scroll"><table className="data compact">
                  <thead><tr><th>Time</th><th>Entry</th><th>Party</th><th className="num">Amount</th><th>By</th></tr></thead>
                  <tbody>{data.movements.map((m, i) => <tr key={i}><td className="nowrap">{new Date(m.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{m.kind} <span className="mono text-xs muted">{m.number}</span></td><td>{m.party}</td><td className={`num medium ${m.amount < 0 ? '' : 't-ok'}`}>{money(m.amount)}</td><td className="text-sm muted">{m.byName}</td></tr>)}</tbody>
                </table></div>
              )}
            </Card>
          </div>
          <Card title="Recent days" bodyClass="">
            {!(history.data ?? []).length ? <EmptyState compact title="No closings yet" /> : (
              <table className="data compact"><thead><tr><th>Date</th><th className="num">Expected</th><th className="num">Counted</th><th>Status</th></tr></thead>
                <tbody>{history.data!.map(h => <tr key={h.id} className="clickable" onClick={() => setDay(h.businessDate.slice(0, 10))}>
                  <td>{date(h.businessDate)}</td><td className="num">{h.expectedCash != null ? money(h.expectedCash, { decimals: false }) : '—'}</td>
                  <td className={`num ${h.difference ? 't-bad' : ''}`}>{h.countedCash != null ? money(h.countedCash, { decimals: false }) : '—'}</td>
                  <td><Status value={h.status} text={h.status === 'CLOSED' ? 'To approve' : h.status === 'OPEN' ? 'Open' : 'Closed'} /></td></tr>)}</tbody></table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
