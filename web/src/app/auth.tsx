import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Eye, EyeOff, FileCheck2, Lock, ShieldCheck, Sofa, Truck } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { Me, State } from '@/lib/types';
import { useSession, useToast } from './providers';
import { Checkbox, Select, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Notice } from '@/components/ui/display';

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <div className="row gap-3">
          <span className="brand-mark"><Sofa /></span>
          <span className="brand-name">FurniShop</span>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>Billing, stock and deliveries for your showroom — in one calm place.</h1>
          <p>GST-correct invoices in seconds, stock you can trust, and every rupee accounted for.</p>
          <div className="auth-points">
            <div><FileCheck2 aria-hidden />CGST, SGST or IGST applied automatically</div>
            <div><Truck aria-hidden />Orders, custom furniture, delivery and installation tracked end to end</div>
            <div><ShieldCheck aria-hidden />Role-based access and a complete activity log</div>
          </div>
        </div>
        <div className="text-xs" style={{ color: 'var(--nav-ink-2)', position: 'relative', zIndex: 1 }}>Your data stays in your own database.</div>
      </aside>
      <div className="auth-form-wrap"><main className="auth-form">{children}</main></div>
    </div>
  );
}

function PasswordInput({ label, value, onChange, error, autoFocus, autoComplete, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; autoFocus?: boolean; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <TextInput label={label} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} error={error} autoFocus={autoFocus}
        autoComplete={autoComplete} hint={hint} required style={{ paddingRight: 40 }} />
      <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ position: 'absolute', right: 4, top: 27 }}
        onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

export function LoginScreen() {
  const { setMe } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try { setMe(await api.post<Me>('/api/auth/login', { username: username.trim(), password })); }
    catch (err) { setError(errorMessage(err)); setPassword(''); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <form className="stack gap-4" onSubmit={submit} noValidate>
        <div>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 4 }}>Use the username given to you by the owner.</p>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <TextInput label="Username" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" required />
        <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password} aria-busy={busy}>Sign in</button>
        <p className="text-xs muted center"><Lock aria-hidden style={{ display: 'inline', width: 12, height: 12, verticalAlign: -1 }} /> Accounts lock for a few minutes after repeated wrong passwords.</p>
      </form>
    </AuthLayout>
  );
}

export function SetupScreen() {
  const { setMe } = useSession();
  const { data: states } = useQuery({ queryKey: ['states-public'], queryFn: async () => STATES });
  const [f, setF] = useState({ shopName: '', stateCode: '29', gstin: '', fullName: '', username: 'admin', password: '', confirm: '', loadDemo: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF(x => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.shopName.trim()) errs.shopName = 'Enter the shop name.';
    if (!f.fullName.trim()) errs.fullName = 'Enter your name.';
    if (f.password.length < 8) errs.password = 'Use at least 8 characters with letters and numbers.';
    if (f.password !== f.confirm) errs.confirm = 'Passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      setMe(await api.post<Me>('/api/auth/setup', { ...f, gstin: f.gstin || null }));
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: err.message });
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <form className="stack gap-4" onSubmit={submit} noValidate>
        <div>
          <h2>Set up your showroom</h2>
          <p className="muted" style={{ marginTop: 4 }}>This creates the owner account. You can add staff and change every setting later.</p>
        </div>
        {errors.form && <Notice tone="bad">{errors.form}</Notice>}
        <TextInput label="Shop name" value={f.shopName} onChange={e => set('shopName', e.target.value)} error={errors.shopName} autoFocus required />
        <div className="grid grid-2">
          <Select label="State" value={f.stateCode} onChange={e => set('stateCode', e.target.value)} options={(states ?? []).map(s => ({ value: s.code, label: s.name }))} hint="Decides CGST+SGST vs IGST" />
          <TextInput label="GSTIN" optional value={f.gstin} onChange={e => set('gstin', e.target.value.toUpperCase())} maxLength={15} error={errors.gstin} placeholder="29ABCDE1234F1Z5" />
        </div>
        <hr className="divider" />
        <TextInput label="Your name" value={f.fullName} onChange={e => set('fullName', e.target.value)} error={errors.fullName} required />
        <TextInput label="Username" value={f.username} onChange={e => set('username', e.target.value)} error={errors.username} autoComplete="username" required />
        <div className="grid grid-2">
          <PasswordInput label="Password" value={f.password} onChange={v => set('password', v)} error={errors.password} autoComplete="new-password" />
          <PasswordInput label="Confirm" value={f.confirm} onChange={v => set('confirm', v)} error={errors.confirm} autoComplete="new-password" />
        </div>
        <Checkbox checked={f.loadDemo} onChange={v => set('loadDemo', v)} label="Load sample data to explore" hint="Products, customers, invoices and deliveries for a demo showroom. Leave off for real use." />
        <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>Create showroom</button>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordModal({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const { setMe } = useSession();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCur(''); setNext(''); setConfirm(''); setErrors({}); } }, [open]);
  const rules = [
    { ok: next.length >= 8, text: 'At least 8 characters' },
    { ok: /[a-zA-Z]/.test(next) && /\d/.test(next), text: 'Letters and numbers' },
    { ok: next.length > 0 && next === confirm, text: 'Both entries match' },
  ];
  const submit = async () => {
    if (next !== confirm) { setErrors({ confirm: 'Passwords do not match.' }); return; }
    setBusy(true);
    try {
      setMe(await api.post<Me>('/api/auth/change-password', { current: cur, newPassword: next }));
      toast.success('Password changed');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: Object.keys(e.fieldErrors).length ? '' : e.message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={forced ? () => {} : onClose} title={forced ? 'Set a new password' : 'Change password'} width={440}
      footer={<>{!forced && <button className="btn" onClick={onClose}>Cancel</button>}<button className="btn btn-primary" onClick={submit} disabled={busy || !rules.every(r => r.ok) || !cur} aria-busy={busy}>Save password</button></>}>
      <div className="stack gap-4">
        {forced && <Notice tone="info">For your security, choose a new password before continuing.</Notice>}
        {errors.form && <Notice tone="bad">{errors.form}</Notice>}
        <PasswordInput label="Current password" value={cur} onChange={setCur} error={errors.current} autoFocus autoComplete="current-password" />
        <PasswordInput label="New password" value={next} onChange={setNext} error={errors.password} autoComplete="new-password" />
        <PasswordInput label="Confirm new password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" />
        <ul className="list-plain stack gap-1 text-sm">
          {rules.map(r => <li key={r.text} className="row gap-2" style={{ color: r.ok ? 'var(--ok)' : 'var(--ink-3)' }}><Check aria-hidden style={{ width: 14, height: 14, opacity: r.ok ? 1 : 0.35 }} />{r.text}</li>)}
        </ul>
      </div>
    </Modal>
  );
}

const STATES: State[] = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'],
  ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code, name }));
