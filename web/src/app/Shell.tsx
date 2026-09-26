import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Boxes, ChevronRight, CircleUser, FileText, Hammer, KeyRound, LayoutDashboard, LogOut, Menu as MenuIcon, Package, PanelLeftClose, PanelLeftOpen,
  Factory, Plus, Receipt, Search, ShieldCheck, ShoppingBag, Sofa, Target, Truck, Users, Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced, useHotkey, useStored } from '@/lib/hooks';
import { relative, label as statusLabel } from '@/lib/format';
import type { Notification, SearchResult } from '@/lib/types';
import { P } from '@/lib/perms';
import { NAV, type NavGroup } from './nav';
import { useCan, useMe, useSession } from './providers';
import { Avatar, Status } from '@/components/ui/display';
import { Menu } from '@/components/ui/overlay';
import { ChangePasswordModal } from './auth';

export function Shell() {
  const me = useMe();
  const can = useCan();
  const loc = useLocation();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useStored('nav-collapsed', false);
  const [expanded, setExpanded] = useState(false); // tablet/phone overlay
  const [searchOpen, setSearchOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const { signOut } = useSession();

  useEffect(() => setExpanded(false), [loc.pathname]);
  useHotkey('mod+k', () => setSearchOpen(true), { inFields: true });
  useHotkey('/', () => setSearchOpen(true));
  useHotkey('f2', () => can(P.InvoiceCreate) && nav('/pos'), { inFields: true });
  useIdleSignOut(me.security.idleTimeoutMinutes, signOut);

  const groups = useMemo(() => NAV
    .map(g => ({ ...g, children: g.children?.filter(c => !c.perms || can(...c.perms)) }))
    .filter(g => (g.children ? g.children.length > 0 : !g.perms || can(...g.perms))), [can]);

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${expanded ? ' expanded' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      {expanded && <div className="nav-scrim" onClick={() => setExpanded(false)} aria-hidden />}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden><Sofa /></span>
          <div className="brand-text" style={{ minWidth: 0 }}>
            <div className="brand-name truncate">{me.shop.name}</div>
            <div className="brand-sub">{me.shop.city ?? me.shop.stateName ?? 'Showroom'}</div>
          </div>
        </div>
        {can(P.InvoiceCreate) && (
          <div className="nav-cta">
            <button className="btn" onClick={() => nav('/pos')} title="New invoice (F2)">
              <Plus aria-hidden /><span className="label">New invoice</span><span className="kbd">F2</span>
            </button>
          </div>
        )}
        <nav className="nav-scroll">
          {groups.map(g => <NavGroupView key={g.label} group={g} collapsed={collapsed} onExpandRail={() => { setCollapsed(false); }} />)}
        </nav>
        <div className="nav-foot desktop-only">
          <button className="nav-item" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}<span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-only" onClick={() => setExpanded(true)} aria-label="Open menu"><MenuIcon /></button>
          <button className="btn btn-ghost btn-icon tablet-toggle desktop-only" style={{ display: 'none' }} onClick={() => setExpanded(e => !e)} aria-label="Toggle menu"><MenuIcon /></button>
          <button className="global-search" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl K)">
            <Search aria-hidden /><span className="truncate">Search products, customers, invoices…</span><span className="kbd desktop-only">Ctrl K</span>
          </button>
          <div className="topbar-actions">
            <Notifications />
            <Menu
              label="Account"
              trigger={
                <span className="row gap-2">
                  <Avatar name={me.user.fullName} size="sm" />
                  <span className="who desktop-only" style={{ textAlign: 'left', lineHeight: 1.2 }}>
                    <b style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{me.user.fullName}</b>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{me.user.roleName}</span>
                  </span>
                </span>
              }
              items={[
                { label: 'Change password', icon: <KeyRound />, onClick: () => setPwdOpen(true) },
                { separator: true, label: '' },
                { label: 'Sign out', icon: <LogOut />, onClick: () => void signOut() },
              ]}
            />
          </div>
        </header>
        <main id="main" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>

      <BottomNav onMenu={() => setExpanded(true)} />
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}

function NavGroupView({ group, collapsed, onExpandRail }: { group: NavGroup; collapsed: boolean; onExpandRail: () => void }) {
  const loc = useLocation();
  const Icon = group.icon;
  const activeChild = group.children?.some(c => (c.end ? loc.pathname === c.to : loc.pathname === c.to || loc.pathname.startsWith(c.to + '/')));
  const [open, setOpen] = useState(!!activeChild);
  useEffect(() => { if (activeChild) setOpen(true); }, [activeChild]);

  if (!group.children) {
    return (
      <NavLink to={group.to!} end={group.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={collapsed ? group.label : undefined}>
        <Icon aria-hidden /><span className="nav-label">{group.label}</span>
      </NavLink>
    );
  }
  return (
    <div className="nav-section">
      <button
        className={`nav-group-toggle${activeChild ? ' has-active' : ''}`} aria-expanded={open} title={collapsed ? group.label : undefined}
        onClick={() => { if (collapsed) { onExpandRail(); setOpen(true); } else setOpen(o => !o); }}
      >
        <Icon aria-hidden style={activeChild ? { color: 'var(--nav-accent)' } : undefined} /><span className="nav-label">{group.label}</span><ChevronRight className="chev" aria-hidden />
      </button>
      {open && (
        <div className="nav-sub">
          {group.children.map(c => (
            <NavLink key={c.to} to={c.to} end={c.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-label">{c.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function BottomNav({ onMenu }: { onMenu: () => void }) {
  const can = useCan();
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard aria-hidden />Home</NavLink>
      {can(P.InvoiceView) ? <NavLink to="/sales/invoices" className={({ isActive }) => (isActive ? 'active' : '')}><Receipt aria-hidden />Invoices</NavLink>
        : <NavLink to="/delivery/scheduled" className={({ isActive }) => (isActive ? 'active' : '')}><Truck aria-hidden />Delivery</NavLink>}
      {can(P.InvoiceCreate) ? <NavLink to="/pos" className="fab"><span className="icon"><Plus aria-hidden /></span>Bill</NavLink>
        : <NavLink to="/installation" className={({ isActive }) => (isActive ? 'active' : '')}><Hammer aria-hidden />Jobs</NavLink>}
      {can(P.CustomerView) ? <NavLink to="/customers" className={({ isActive }) => (isActive ? 'active' : '')}><Users aria-hidden />Customers</NavLink>
        : <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}><Boxes aria-hidden />Stock</NavLink>}
      <button onClick={onMenu}><MenuIcon aria-hidden />More</button>
    </nav>
  );
}

// ------------------------------------------------------------ notifications
function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { data = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications'), refetchInterval: 120_000 });
  const generated = useRef(false);
  useEffect(() => {
    if (generated.current) return;
    generated.current = true;
    api.post('/api/notifications/generate').then(() => qc.invalidateQueries({ queryKey: ['notifications'] })).catch(() => {});
  }, [qc]);
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: () => qc.setQueryData(['notifications'], []) });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = (n: Notification) => {
    api.post(`/api/notifications/${n.id}/read`).catch(() => {});
    qc.setQueryData<Notification[]>(['notifications'], x => (x ?? []).filter(i => i.id !== n.id));
    setOpen(false);
    const to = n.refType ? NOTIFICATION_ROUTES[n.refType]?.(n.refId) : undefined;
    if (to) nav(to);
    else if (n.kind === 'FOLLOW_UP') nav('/crm/follow-ups');
    else if (n.kind === 'BACKUP') nav('/settings/backup');
  };
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} className="btn btn-ghost btn-icon" style={{ position: 'relative' }} onClick={() => setOpen(o => !o)} aria-label={`Notifications, ${data.length} unread`} aria-expanded={open}>
        <Bell />{data.length > 0 && <span className="notif-dot">{data.length > 9 ? '9+' : data.length}</span>}
      </button>
      {open && r && createPortal(
        <div ref={panel} className="popover" role="dialog" aria-label="Notifications" style={{ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 380, window.innerWidth - 388)), width: 380, maxWidth: 'calc(100vw - 16px)', padding: 0 }}>
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
            <b>Notifications</b>
            {data.length > 0 && <button className="btn btn-link text-sm" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {data.length === 0 ? <div className="empty compact"><div className="empty-icon"><Bell /></div><div className="empty-title">You’re all caught up</div></div>
              : data.map(n => (
                <button key={n.id} className="list-row" onClick={() => go(n)} style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
                  <span className={`icon-circle tone-${n.kind.includes('OUT') || n.kind === 'OVERDUE' ? 'bad' : n.kind.includes('LOW') || n.kind.includes('DELAY') ? 'warn' : 'info'}`}><Bell aria-hidden /></span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row between"><b className="text-sm">{n.title}</b><span className="text-xs muted">{relative(n.createdAt)}</span></span>
                    <span className="text-sm soft" style={{ display: 'block' }}>{n.message}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Where a notification about each kind of record opens. */
const NOTIFICATION_ROUTES: Record<string, (id?: number | null) => string | undefined> = {
  INVOICE: id => id ? `/sales/invoices/${id}` : undefined,
  QUOTATION: id => id ? `/sales/quotations/${id}` : undefined,
  SALES_ORDER: id => id ? `/sales/orders/${id}` : undefined,
  CUSTOM_ORDER: id => id ? `/custom-orders/${id}` : undefined,
  CUSTOMER: id => id ? `/customers/${id}` : undefined,
  VARIANT: () => '/inventory/low',
  WARRANTY: id => id ? `/service/warranties?open=${id}` : '/service/warranties',
  SERVICE: id => id ? `/service/tickets?open=${id}` : '/service/tickets',
  LEAD: id => id ? `/crm/leads?open=${id}` : '/crm/leads',
  PRODUCTION_ORDER: id => id ? `/production/orders?open=${id}` : '/production',
  RAW_MATERIAL: () => '/production/materials?low=true',
  CASH_SESSION: () => '/cash',
};

// ------------------------------------------------------------ global search
const KIND_ICON: Record<string, typeof Search> = { Product: Package, Customer: CircleUser, Invoice: Receipt, Quotation: FileText, 'Sales order': FileText, Supplier: ShoppingBag, Purchase: ShoppingBag, 'Custom order': Hammer, Delivery: Truck,
  'Service ticket': Wrench, Warranty: ShieldCheck, Lead: Target, 'Production order': Factory, 'Raw material': Boxes };

function routeFor(r: SearchResult): string {
  switch (r.kind) {
    case 'Product': return `/products/${r.id}`;
    case 'Customer': return `/customers/${r.id}`;
    case 'Invoice': return `/sales/invoices/${r.id}`;
    case 'Quotation': return `/sales/quotations/${r.id}`;
    case 'Sales order': return `/sales/orders/${r.id}`;
    case 'Supplier': return `/purchases/suppliers/${r.id}`;
    case 'Purchase': return `/purchases/${r.id}`;
    case 'Custom order': return `/custom-orders/${r.id}`;
    case 'Delivery': return `/delivery/all?open=${r.id}`;
    case 'Service ticket': return `/service/tickets?open=${r.id}`;
    case 'Warranty': return `/service/warranties?open=${r.id}`;
    case 'Lead': return `/crm/leads?open=${r.id}`;
    case 'Production order': return `/production/orders?open=${r.id}`;
    case 'Raw material': return `/production/materials?q=${encodeURIComponent(r.title)}`;
    default: return '/';
  }
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const can = useCan();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(text, 180);
  const input = useRef<HTMLInputElement>(null);
  const { data = [], isFetching } = useQuery({ queryKey: ['search', q], queryFn: () => api.get<SearchResult[]>('/api/search', { q }), enabled: q.trim().length >= 2, staleTime: 15_000 });

  const actions = [
    can(P.InvoiceCreate) && { title: 'New invoice', sub: 'F2', to: '/pos', icon: Receipt },
    can(P.QuotationManage) && { title: 'New quotation', to: '/sales/quotations/new', icon: FileText },
    can(P.CustomerManage) && { title: 'Add customer', to: '/customers?new=1', icon: Users },
    can(P.ProductManage) && { title: 'Add product', to: '/products/new', icon: Package },
    can(P.PaymentReceive) && { title: 'Receive payment', to: '/sales/payments?receive=1', icon: Receipt },
    can(P.PurchaseManage) && { title: 'New purchase', to: '/purchases/new', icon: ShoppingBag },
  ].filter(Boolean) as { title: string; sub?: string; to: string; icon: typeof Search }[];
  const results = q.trim().length >= 2 ? data.map(r => ({ title: r.title, sub: r.subtitle, to: routeFor(r), icon: KIND_ICON[r.kind] ?? Search, kind: r.kind, status: r.status }))
    : actions.map(a => ({ ...a, kind: 'Action', status: undefined as string | undefined }));

  useEffect(() => setActive(0), [q, data.length]);
  const go = (to: string) => { onClose(); nav(to); };

  return createPortal(
    <div className="modal-wrap" style={{ alignItems: 'start', paddingTop: '12vh' }}>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Search" style={{ ['--modal-w' as string]: '620px' }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active].to); }
        }}>
        <div className="input-wrap has-left" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="adorn"><Search /></span>
          <input ref={input} autoFocus className="input" style={{ border: 0, height: 56, fontSize: 16, boxShadow: 'none', borderRadius: '14px 14px 0 0' }}
            placeholder="Search products, SKU, barcode, customers, mobile, invoice or order number" value={text} onChange={e => setText(e.target.value)}
            role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={results[active] ? `pal-${active}` : undefined} />
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto', padding: 6 }} id="palette-list" role="listbox">
          {q.trim().length < 2 && <div className="caps" style={{ padding: '8px 10px 4px' }}>Quick actions</div>}
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <button key={i} id={`pal-${i}`} role="option" aria-selected={i === active} className="menu-item" data-active={i === active}
                style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal' }} onMouseEnter={() => setActive(i)} onClick={() => go(r.to)}>
                <span className="icon-circle"><Icon aria-hidden /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="medium truncate" style={{ display: 'block' }}>{r.title}</span>
                  {r.sub && <span className="text-xs muted truncate" style={{ display: 'block' }}>{r.sub}</span>}
                </span>
                {r.status && <Status value={r.status} />}
                <span className="text-xs muted">{r.kind === 'Action' ? '' : r.kind}</span>
              </button>
            );
          })}
          {q.trim().length >= 2 && !isFetching && data.length === 0 && <div className="empty compact"><div className="empty-title">No results for “{q}”</div><div className="empty-desc">Try a mobile number, SKU, or document number like INV-2026-0012.</div></div>}
          {isFetching && data.length === 0 && <div className="muted text-sm" style={{ padding: 12 }}>Searching…</div>}
        </div>
        <div className="row gap-4 text-xs muted" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)' }}>
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">Enter</span> open</span><span><span className="kbd">Esc</span> close</span>
          <span style={{ marginLeft: 'auto' }}>{statusLabel('')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Signs out after the configured idle time (Settings → Security). Any key, click or scroll counts as activity. */
function useIdleSignOut(minutes: number, signOut: () => Promise<void>) {
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last > minutes * 60_000) void signOut(); }, 30_000);
    return () => { events.forEach(e => window.removeEventListener(e, touch)); clearInterval(t); };
  }, [minutes, signOut]);
}
