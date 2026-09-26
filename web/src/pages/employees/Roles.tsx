import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { PermissionInfo, Role } from '@/lib/types';
import { useToast } from '@/app/providers';
import { Badge, Card, EmptyState, ErrorPanel, Notice, PageHeader, SkeletonRows } from '@/components/ui/display';
import { Checkbox, TextInput } from '@/components/ui/form';
import { Drawer, Menu, useConfirm } from '@/components/ui/overlay';

interface RolesResponse { roles: { role: Role; permissions: string[] }[]; permissions: PermissionInfo[] }
const SENSITIVE = new Set(['cost.view', 'report.profit', 'user.manage', 'role.manage', 'settings.manage', 'backup.manage', 'invoice.cancel', 'payment.void', 'inventory.adjust']);

export default function Roles({ view }: { view: 'roles' | 'matrix' }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, error, refetch, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesResponse>('/api/roles') });
  const [edit, setEdit] = useState<{ role: Partial<Role>; permissions: string[] } | null>(null);
  const modules = useMemo(() => groupBy(data?.permissions ?? []), [data]);
  const remove = async (r: Role) => {
    if ((await confirm({ title: `Delete role “${r.name}”?`, message: 'Only possible when no user has this role.', confirmText: 'Delete role' })) === null) return;
    try { await api.del(`/api/roles/${r.id}`); toast.success('Role deleted'); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  return (
    <div className="page">
      <PageHeader title={view === 'roles' ? 'Roles' : 'Permission matrix'}
        desc={view === 'roles' ? 'A role is a set of permissions. Every screen and action checks them on the server — hiding a button is only a convenience.' : 'All roles side by side. Tick to grant, then save. Changes apply on the users’ next request.'}
        actions={<>
          <Link className="btn" to={view === 'roles' ? '/employees/permissions' : '/employees/roles'}>{view === 'roles' ? 'Open matrix' : 'Role list'}</Link>
          <button className="btn btn-primary" onClick={() => setEdit({ role: {}, permissions: [] })}><Plus aria-hidden />New role</button>
        </>} />
      {error ? <ErrorPanel error={error} retry={() => void refetch()} /> : isLoading || !data ? <SkeletonRows rows={6} /> : view === 'roles' ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {data.roles.map(({ role, permissions }) => (
            <Card key={role.id} title={<span className="row gap-2">{role.name}{role.isSystem && <Badge tone="muted">Built-in</Badge>}</span>} sub={role.description}
              actions={<Menu items={[
                { label: 'Edit permissions', icon: <Pencil />, onClick: () => setEdit({ role, permissions }) },
                { label: 'Delete role', icon: <Trash2 />, danger: true, onClick: () => remove(role), hidden: role.isSystem },
              ]} />}>
              <div className="stack gap-3">
                <p className="text-sm soft">{role.userCount} user{role.userCount === 1 ? '' : 's'} · {permissions.length} of {data.permissions.length} permissions</p>
                <div className="row wrap gap-1">{Object.entries(modules).map(([m, ps]) => {
                  const n = ps.filter(p => permissions.includes(p.code)).length;
                  return n ? <Badge key={m} tone={n === ps.length ? 'ok' : 'muted'}>{m} {n < ps.length ? `${n}/${ps.length}` : ''}</Badge> : null;
                })}</div>
                {permissions.includes('cost.view') ? <p className="text-xs t-warn">Can see purchase cost and profit.</p> : <p className="text-xs muted">Cost price and profit are hidden.</p>}
                <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({ role, permissions })}>Edit permissions</button>
              </div>
            </Card>
          ))}
        </div>
      ) : <Matrix data={data} modules={modules} />}
      <RoleDrawer value={edit} modules={modules} onClose={() => setEdit(null)} />
    </div>
  );
}

function groupBy(ps: PermissionInfo[]) {
  const m: Record<string, PermissionInfo[]> = {};
  for (const p of ps) (m[p.module] ??= []).push(p);
  return m;
}

function Matrix({ data, modules }: { data: RolesResponse; modules: Record<string, PermissionInfo[]> }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [grid, setGrid] = useState<Record<number, Set<string>>>({});
  useEffect(() => setGrid(Object.fromEntries(data.roles.map(r => [r.role.id, new Set(r.permissions)]))), [data]);
  const dirty = data.roles.filter(r => { const g = grid[r.role.id]; return g && (g.size !== r.permissions.length || r.permissions.some(p => !g.has(p))); });
  const toggle = (roleId: number, code: string) => setGrid(g => { const s = new Set(g[roleId]); if (s.has(code)) s.delete(code); else s.add(code); return { ...g, [roleId]: s }; });
  const save = useMutation({
    mutationFn: async () => { for (const r of dirty) await api.put(`/api/roles/${r.role.id}`, { role: r.role, permissions: [...grid[r.role.id]] }); },
    onSuccess: () => { toast.success('Permissions saved', `${dirty.length} role${dirty.length > 1 ? 's' : ''} updated.`); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  return <>
    {dirty.length > 0 && <Notice tone="warn" action={<div className="row gap-2"><button className="btn btn-sm" onClick={() => setGrid(Object.fromEntries(data.roles.map(r => [r.role.id, new Set(r.permissions)])))}>Discard</button><button className="btn btn-sm btn-primary" onClick={() => save.mutate()} aria-busy={save.isPending}>Save changes</button></div>}>
      Unsaved changes for {dirty.map(r => r.role.name).join(', ')}.</Notice>}
    <Card bodyClass="">
      <div className="table-scroll" style={{ maxHeight: '75vh' }}><table className="data compact matrix">
        <thead><tr><th>Permission</th>{data.roles.map(r => <th key={r.role.id} style={{ minWidth: 96 }}>{r.role.name}</th>)}</tr></thead>
        <tbody>{Object.entries(modules).map(([m, ps]) => <Fragment key={m}>
          <tr><td className="group" colSpan={data.roles.length + 1}>{m}</td></tr>
          {ps.map(p => <tr key={p.code}>
            <td><div className="text-sm">{p.description}{SENSITIVE.has(p.code) && <span className="t-warn" title="Sensitive"> •</span>}</div><div className="text-xs muted mono">{p.code}</div></td>
            {data.roles.map(r => {
              const locked = r.role.code === 'ADMIN' && p.code === 'role.manage';
              return <td key={r.role.id}><input type="checkbox" className="checkbox" aria-label={`${r.role.name}: ${p.description}`} disabled={locked}
                checked={grid[r.role.id]?.has(p.code) ?? false} onChange={() => toggle(r.role.id, p.code)} /></td>;
            })}
          </tr>)}
        </Fragment>)}</tbody>
      </table></div>
    </Card>
  </>;
}

function RoleDrawer({ value, modules, onClose }: { value: { role: Partial<Role>; permissions: string[] } | null; modules: Record<string, PermissionInfo[]>; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [role, setRole] = useState<Partial<Role>>({});
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setRole(value?.role ?? {}); setPerms(new Set(value?.permissions ?? [])); }
  const save = useMutation({
    mutationFn: () => (role.id ? api.put(`/api/roles/${role.id}`, { role, permissions: [...perms] }) : api.post('/api/roles', { role, permissions: [...perms] })),
    onSuccess: () => { toast.success(role.id ? 'Role saved' : 'Role created'); qc.invalidateQueries({ queryKey: ['roles'] }); onClose(); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const setMany = (codes: string[], on: boolean) => setPerms(s => { const n = new Set(s); codes.forEach(c => (on ? n.add(c) : n.delete(c))); return n; });
  return (
    <Drawer open={!!value} onClose={onClose} wide title={role.id ? `Role: ${role.name}` : 'New role'} sub={`${perms.size} permissions`}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" disabled={!role.name?.trim()} onClick={() => save.mutate()} aria-busy={save.isPending}><Check aria-hidden />Save role</button></>}>
      <div className="stack gap-5">
        <div className="grid grid-2">
          <TextInput label="Name" required value={role.name ?? ''} onChange={e => setRole({ ...role, name: e.target.value })} autoFocus={!role.id} />
          <TextInput label="Description" optional value={role.description ?? ''} onChange={e => setRole({ ...role, description: e.target.value })} />
        </div>
        {Object.keys(modules).length === 0 ? <EmptyState compact icon={<ShieldCheck />} title="No permissions defined" /> : Object.entries(modules).map(([m, ps]) => {
          const all = ps.every(p => perms.has(p.code)), some = ps.some(p => perms.has(p.code));
          return (
            <section key={m} className="stack gap-2">
              <div className="row between"><Checkbox label={<span className="medium">{m}</span>} checked={all} indeterminate={!all && some} onChange={v => setMany(ps.map(p => p.code), v)} /></div>
              <div className="grid grid-2" style={{ paddingLeft: 26, gap: 6 }}>
                {ps.map(p => <Checkbox key={p.code} checked={perms.has(p.code)} disabled={role.code === 'ADMIN' && p.code === 'role.manage'} onChange={v => setMany([p.code], v)}
                  label={<span className="text-sm">{p.description}{SENSITIVE.has(p.code) && <span className="t-warn"> · sensitive</span>}</span>} />)}
              </div>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
