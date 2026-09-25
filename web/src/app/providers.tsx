import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { api, setAuthHandlers } from '@/lib/api';
import type { Lookups, Me } from '@/lib/types';

// ============================================================ session
interface SessionCtx {
  me: Me | null;
  loading: boolean;
  can: (...perms: string[]) => boolean;
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Session = createContext<SessionCtx>(null!);
export const useSession = () => useContext(Session);
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error('useMe outside an authenticated area');
  return me;
}
/** True when the user has ANY of the given permissions. */
export const useCan = () => useSession().can;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try { setMe((await api.get<Me | undefined>('/api/auth/me')) ?? null); } catch { setMe(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setAuthHandlers(
      () => { setMe(null); qc.clear(); },
      () => setMe(m => (m ? { ...m, mustChangePassword: true } : m)),
    );
    void refresh();
  }, [refresh, qc]);

  const signOut = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } finally { setMe(null); qc.clear(); }
  }, [qc]);

  const can = useCallback((...perms: string[]) => !!me && perms.some(p => me.permissions.includes(p)), [me]);
  const value = useMemo(() => ({ me, loading, can, setMe, refresh, signOut }), [me, loading, can, refresh, signOut]);
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

/** Masters shared by every screen (states, categories, GST rates, payment methods…). Cached for 5 minutes. */
export function useLookups() {
  const { me } = useSession();
  return useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/api/lookups'), staleTime: 5 * 60_000, enabled: !!me });
}

// ============================================================ toasts
type ToastTone = 'ok' | 'bad' | 'info' | 'warn';
interface ToastItem { id: number; tone: ToastTone; title: string; desc?: string; action?: { label: string; run: () => void }; leaving?: boolean }
interface ToastCtx { show: (t: Omit<ToastItem, 'id'>) => void; success: (title: string, desc?: string, action?: ToastItem['action']) => void; error: (title: string, desc?: string) => void; info: (title: string, desc?: string) => void }
const Toasts = createContext<ToastCtx>(null!);
export const useToast = () => useContext(Toasts);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id: number) => {
    setItems(x => x.map(t => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), 200);
  }, []);
  const show = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++idRef.current;
    setItems(x => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === 'bad' ? 7000 : t.action ? 6500 : 4200);
  }, [dismiss]);
  const value = useMemo<ToastCtx>(() => ({
    show,
    success: (title, desc, action) => show({ tone: 'ok', title, desc, action }),
    error: (title, desc) => show({ tone: 'bad', title, desc }),
    info: (title, desc) => show({ tone: 'info', title, desc }),
  }), [show]);
  const icon = { ok: CheckCircle2, bad: XCircle, info: Info, warn: AlertTriangle };
  return (
    <Toasts.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {items.map(t => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} className={`toast tone-${t.tone}${t.leaving ? ' leaving' : ''}`} role={t.tone === 'bad' ? 'alert' : 'status'}>
              <Icon aria-hidden />
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                {t.desc && <div className="toast-desc">{t.desc}</div>}
              </div>
              {t.action && <button className="btn btn-link" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            </div>
          );
        })}
      </div>
    </Toasts.Provider>
  );
}
