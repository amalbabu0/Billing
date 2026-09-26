import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Pencil, Plus, Trash2, Unlock, UserCog } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import type { Role, User } from '@/lib/types';
import { useMe, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Avatar, Badge, EmptyState, PageHeader, Segmented, Status } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, Switch, TextInput } from '@/components/ui/form';
import { Drawer, useConfirm } from '@/components/ui/overlay';

export default function Users() {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/api/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: { role: Role }[] }>('/api/roles') });
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const rows = useMemo(() => (users.data ?? []).filter(u => (show === 'all' || u.isActive) && (!search || `${u.fullName} ${u.username} ${u.mobile ?? ''} ${u.roleName ?? ''}`.toLowerCase().includes(search.toLowerCase()))), [users.data, show, search]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const locked = (u: User) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const unlock = async (u: User) => { try { await api.post(`/api/users/${u.id}/unlock`); toast.success(`${u.fullName} unlocked`); refresh(); } catch (e) { toast.error('Not unlocked', errorMessage(e)); } };
  const remove = async (u: User) => {
    if ((await confirm({ title: `Delete ${u.fullName}?`, message: 'They can no longer sign in. Their name stays on the documents and activity they created.', confirmText: 'Delete user' })) === null) return;
    try { await api.del(`/api/users/${u.id}`); toast.success('User deleted'); refresh(); } catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  const cols: Column<User>[] = [
    { key: 'name', header: 'Name', fixed: true, mobile: 'title', render: u => <div className="row gap-3"><Avatar name={u.fullName} size="sm" /><div className="cell-stack"><span className="cell-title">{u.fullName}{u.id === me.user.id && <span className="muted"> (you)</span>}</span><span className="cell-sub mono">{u.username}</span></div></div>, exportValue: u => u.fullName },
    { key: 'role', header: 'Role', mobile: 'sub', render: u => <Badge tone={u.roleCode === 'ADMIN' ? 'brand' : 'muted'}>{u.roleName}</Badge>, exportValue: u => u.roleName },
    { key: 'mobile', header: 'Mobile', mobile: 'meta', render: u => u.mobile ?? '—', exportValue: u => u.mobile },
    { key: 'email', header: 'Email', optional: true, render: u => u.email ?? '—', exportValue: u => u.email },
    { key: 'last', header: 'Last sign-in', mobile: 'meta', render: u => u.lastLoginAt ? <span title={dateTime(u.lastLoginAt)}>{relative(u.lastLoginAt)}</span> : <span className="muted">Never</span>, exportValue: u => dateTime(u.lastLoginAt) },
    { key: 'status', header: 'Status', mobile: 'right', render: u => !u.isActive ? <Status value="INACTIVE" text="Disabled" /> : locked(u) ? <Status value="LOCKED" text="Locked" /> : u.mustChangePassword ? <Status value="PENDING" text="Must change password" /> : <Status value="ACTIVE" />, exportValue: u => (u.isActive ? 'Active' : 'Disabled') },
  ];
  return (
    <div className="page">
      <PageHeader title="Users" desc="Who can sign in and what role they have. Passwords are never shown; set a temporary one and the user changes it at first sign-in."
        actions={<button className="btn btn-primary" onClick={() => setEdit({ isActive: true, mustChangePassword: true })}><Plus aria-hidden />Add user</button>} />
      <DataTable id="users" label="Users" columns={cols} rows={rows} rowKey={u => u.id} loading={users.isLoading} error={users.error} onRetry={() => void users.refetch()}
        onRowClick={u => setEdit(u)} rowClass={u => (u.isActive ? undefined : 'muted-row')}
        rowActions={u => [
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit(u) },
          { label: 'Reset password', icon: <KeyRound />, onClick: () => setEdit({ ...u, _reset: true } as Partial<User>) },
          { label: 'Unlock', icon: <Unlock />, onClick: () => unlock(u), hidden: !locked(u) && u.failedLoginCount === 0 },
          { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => remove(u), hidden: u.id === me.user.id },
        ]}
        toolbar={<><SearchInput value={search} onChange={setSearch} placeholder="Name, username, mobile or role" />
          <Segmented value={show} onChange={setShow} label="Show" options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} /></>}
        empty={<EmptyState icon={<UserCog />} title="No users match" />}
        exportAs={{ title: 'Users', fetchAll: async () => rows }} />
      <UserDrawer value={edit} roles={(roles.data?.roles ?? []).map(r => r.role)} onClose={() => setEdit(null)} onSaved={refresh} />
    </div>
  );
}

function UserDrawer({ value, roles, onClose, onSaved }: { value: Partial<User> | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [u, setU] = useState<Partial<User>>({});
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setU(value ?? {}); setPassword(''); setErrors({}); }
  const creating = !u.id;
  const reset = (value as { _reset?: boolean } | null)?._reset;
  const save = useMutation({
    mutationFn: () => {
      const e: Record<string, string> = {};
      if (!u.fullName?.trim()) e.fullName = 'Enter the full name.';
      if (!u.username?.trim()) e.username = 'Choose a username.';
      if (!u.roleId) e.roleId = 'Choose a role.';
      if (creating && password.length < me.security.minPasswordLength) e.password = `At least ${me.security.minPasswordLength} characters.`;
      setErrors(e);
      if (Object.keys(e).length) throw new ApiError(400, 'Please correct the highlighted fields.');
      const body = { user: { ...u, mustChangePassword: password ? true : u.mustChangePassword }, password: password || null };
      return creating ? api.post('/api/users', body) : api.put(`/api/users/${u.id}`, body);
    },
    onSuccess: () => { toast.success(creating ? 'User added' : password ? 'Password reset' : 'User saved', password ? 'Share the temporary password privately — they must change it at sign-in.' : undefined); onSaved(); onClose(); },
    onError: x => { if (x instanceof ApiError) setErrors(s => ({ ...s, ...Object.fromEntries(Object.entries(x.fieldErrors).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v])) })); toast.error('Not saved', errorMessage(x)); },
  });
  const self = u.id === me.user.id;
  return (
    <Drawer open={!!value} onClose={onClose} title={creating ? 'Add user' : u.fullName ?? 'User'} sub={!creating && <span className="mono text-sm">{u.username}</span>}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" onClick={() => save.mutate()} aria-busy={save.isPending}>{creating ? 'Add user' : 'Save'}</button></>}>
      <form className="stack gap-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <TextInput label="Full name" required value={u.fullName ?? ''} onChange={e => setU({ ...u, fullName: e.target.value })} error={errors.fullName} autoFocus={creating} />
        <div className="grid grid-2">
          <TextInput label="Username" required value={u.username ?? ''} onChange={e => setU({ ...u, username: e.target.value.toLowerCase().replace(/\s/g, '') })} error={errors.username} autoComplete="off" />
          <Select label="Role" required value={u.roleId ?? ''} error={errors.roleId} disabled={self} onChange={e => setU({ ...u, roleId: Number(e.target.value) || undefined })}
            options={[{ value: '', label: 'Choose…' }, ...roles.map(r => ({ value: r.id, label: r.name }))]} hint={self ? 'You cannot change your own role.' : undefined} />
        </div>
        <div className="grid grid-2">
          <TextInput label="Mobile" optional inputMode="tel" value={u.mobile ?? ''} onChange={e => setU({ ...u, mobile: e.target.value })} error={errors.mobile} />
          <TextInput label="Email" optional type="email" value={u.email ?? ''} onChange={e => setU({ ...u, email: e.target.value })} error={errors.email} />
        </div>
        <div className="grid grid-2"><NumberInput label="Sales commission %" optional value={u.commissionPercent ?? 0} min={0} max={100} onChange={v => setU({ ...u, commissionPercent: v ?? 0 })} error={errors.commissionPercent} hint="On net taxable sales credited to this person" /></div>
        <div className="card card-pad stack gap-3" style={{ background: 'var(--surface-sunken)' }}>
          <div className="row gap-2 medium"><Lock aria-hidden style={{ width: 16 }} />{creating ? 'Temporary password' : 'Reset password'}</div>
          <TextInput label={creating ? 'Password' : 'New password'} required={creating} optional={!creating} type="text" autoComplete="new-password" value={password} autoFocus={!!reset}
            onChange={e => setPassword(e.target.value)} error={errors.password} hint={`At least ${me.security.minPasswordLength} characters. ${creating ? '' : 'Leave empty to keep the current one.'}`} />
        </div>
        {!creating && <>
          <Switch label="Must change password at next sign-in" checked={!!u.mustChangePassword || !!password} disabled={!!password} onChange={v => setU({ ...u, mustChangePassword: v })} />
          <Switch label="Active — can sign in" checked={u.isActive ?? true} disabled={self} onChange={v => setU({ ...u, isActive: v })} hint={self ? 'You cannot disable your own account.' : 'Disabled users keep their history.'} />
          {u.failedLoginCount ? <p className="text-sm t-warn">{u.failedLoginCount} failed sign-in attempt{u.failedLoginCount > 1 ? 's' : ''}{u.lockedUntil ? ` · locked until ${dateTime(u.lockedUntil)}` : ''}</p> : null}
        </>}
      </form>
    </Drawer>
  );
}
