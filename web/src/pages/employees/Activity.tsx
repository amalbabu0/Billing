import { useState } from 'react';
import { History } from 'lucide-react';
import { dateTime } from '@/lib/format';
import { usePagedList } from '@/lib/useList';
import type { AuditLog } from '@/lib/types';
import { useLookups } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, EmptyState, KV, PageHeader } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/form';
import { Drawer } from '@/components/ui/overlay';

const MODULES = ['Sales', 'Payments', 'Customers', 'Products', 'Inventory', 'Purchases', 'Custom Orders', 'Delivery', 'Installation', 'Expenses', 'GST', 'Reports', 'Employees', 'Settings', 'Security', 'Backup'];
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = { CREATE: 'ok', UPDATE: 'info', DELETE: 'bad', CANCEL: 'bad', VOID: 'bad', LOGIN: 'muted', LOGOUT: 'muted', LOGIN_FAILED: 'warn', EXPORT: 'warn', ADJUST: 'warn', REFUND: 'warn' };

/** Append-only audit trail: who did what, when, from where — with before/after values for edits. */
export default function Activity() {
  const { data: lookups } = useLookups();
  const list = usePagedList<AuditLog>('audit', '/api/audit', { filterKeys: ['module', 'userId', 'from', 'to'], defaults: { pageSize: 50 } });
  const { state, update } = list;
  const [open, setOpen] = useState<AuditLog | null>(null);
  const cols: Column<AuditLog>[] = [
    { key: 'when', header: 'When', fixed: true, mobile: 'meta', render: r => <span className="nowrap">{dateTime(r.occurredAt)}</span>, exportValue: r => dateTime(r.occurredAt) },
    { key: 'user', header: 'User', mobile: 'title', render: r => <span className="medium">{r.username ?? 'system'}</span>, exportValue: r => r.username },
    { key: 'action', header: 'Action', render: r => <Badge tone={TONE[r.action] ?? 'muted'}>{r.action.replace(/_/g, ' ').toLowerCase()}</Badge>, exportValue: r => r.action },
    { key: 'module', header: 'Module', mobile: 'meta', render: r => r.module, exportValue: r => r.module },
    { key: 'summary', header: 'What happened', mobile: 'sub', render: r => <span>{r.summary}{r.oldValue || r.newValue ? <span className="text-xs muted"> · changes</span> : null}</span>, exportValue: r => r.summary },
    { key: 'ref', header: 'Record', optional: true, render: r => <span className="doc-no text-sm">{r.recordRef ?? '—'}</span>, exportValue: r => r.recordRef },
    { key: 'ip', header: 'IP / device', optional: true, render: r => <span className="text-xs muted">{[r.ipAddress, r.machine].filter(Boolean).join(' · ') || '—'}</span>, exportValue: r => r.ipAddress },
  ];
  return (
    <div className="page">
      <PageHeader title="Activity log" desc="Every sign-in, change, cancellation, export and setting update. Entries cannot be edited or deleted." />
      <DataTable id="audit" label="Activity" columns={cols} rowKey={r => r.id} {...list.tableProps} onRowClick={setOpen} compact
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Summary or document number" />
          <select className="select input-sm" style={{ width: 160 }} aria-label="Module" value={state.filters.module ?? ''} onChange={e => update({ filters: { module: e.target.value || undefined } })}>
            <option value="">All modules</option>{MODULES.map(m => <option key={m}>{m}</option>)}
          </select>
          <select className="select input-sm" style={{ width: 160 }} aria-label="User" value={state.filters.userId ?? ''} onChange={e => update({ filters: { userId: e.target.value || undefined } })}>
            <option value="">All users</option>{(lookups?.staff ?? []).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="From" value={state.filters.from ?? ''} onChange={e => update({ filters: { from: e.target.value || undefined } })} />
          <input type="date" className="input input-sm" style={{ width: 142 }} aria-label="To" value={state.filters.to ?? ''} onChange={e => update({ filters: { to: e.target.value || undefined } })} />
        </>}
        empty={<EmptyState icon={<History />} title="No activity matches" />}
        exportAs={{ title: 'Activity log', fetchAll: list.fetchAll }} />
      <Drawer open={!!open} onClose={() => setOpen(null)} title="Activity detail" sub={open && dateTime(open.occurredAt)} wide>
        {open && <div className="stack gap-5">
          <p style={{ fontSize: 15 }}>{open.summary}</p>
          <KV items={[['User', open.username ?? 'system'], ['Action', open.action], ['Module', open.module], !!open.recordRef && ['Record', <span className="doc-no">{open.recordRef}</span>],
            !!open.ipAddress && ['IP address', <span className="mono">{open.ipAddress}</span>], !!open.machine && ['Device', open.machine]]} />
          {(open.oldValue || open.newValue) && <Changes oldValue={open.oldValue} newValue={open.newValue} />}
        </div>}
      </Drawer>
    </div>
  );
}

function parse(v?: string): Record<string, unknown> | null {
  if (!v) return null;
  try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Changes({ oldValue, newValue }: { oldValue?: string; newValue?: string }) {
  const a = parse(oldValue), b = parse(newValue);
  if (!a && !b) return <div className="grid grid-2">
    <div><div className="caps">Before</div><pre className="code-block">{oldValue ?? '—'}</pre></div>
    <div><div className="caps">After</div><pre className="code-block">{newValue ?? '—'}</pre></div></div>;
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(k => !/hash|password|otp/i.test(k));
  const changed = keys.filter(k => show(a?.[k]) !== show(b?.[k]));
  const rows = a && b ? changed : keys;
  return (
    <div>
      <div className="caps" style={{ marginBottom: 8 }}>{a && b ? `${changed.length} field${changed.length === 1 ? '' : 's'} changed` : a ? 'Values removed' : 'Values recorded'}</div>
      <table className="data compact"><thead><tr><th>Field</th>{a && <th>Before</th>}{b && <th>After</th>}</tr></thead>
        <tbody>{rows.map(k => <tr key={k}><td className="medium">{k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase()}</td>
          {a && <td className={b ? 't-bad' : ''} style={{ textDecoration: b ? 'line-through' : undefined, wordBreak: 'break-word' }}>{show(a[k])}</td>}
          {b && <td className={a ? 't-ok' : ''} style={{ wordBreak: 'break-word' }}>{show(b[k])}</td>}</tr>)}</tbody></table>
    </div>
  );
}
