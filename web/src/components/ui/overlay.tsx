import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, MoreHorizontal, Trash2, X } from 'lucide-react';
import { TextArea } from './form';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Traps Tab inside the element, closes on Escape, and returns focus to the opener. */
function useDialogFocus(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>, initialFocus = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && initialFocus) {
      const auto = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (auto ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, [open, ref, initialFocus]);
}

export function Drawer({ open, onClose, title, sub, children, footer, wide, headerExtra, label }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; headerExtra?: ReactNode; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div ref={ref} className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)} tabIndex={-1}>
        <div className="drawer-header">
          <div className="grow">
            <h2 className="drawer-title">{title}</h2>
            {sub && <div className="drawer-sub">{sub}</div>}
          </div>
          {headerExtra}
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, width, icon, label }: {
  open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode; width?: number; icon?: ReactNode; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="modal-wrap">
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)} tabIndex={-1}
        style={width ? ({ ['--modal-w' as string]: `${width}px` }) : undefined}>
        <div className="modal-header">
          {icon}
          <h2 className="modal-title grow">{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------ confirm
interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  tone?: 'danger' | 'warn' | 'default';
  /** Ask for a reason (cancel invoice, void payment…). The promise resolves with the text. */
  reason?: { label: string; placeholder?: string; required?: boolean };
}
type ConfirmFn = (o: ConfirmOptions) => Promise<string | null>;
const ConfirmCtx = createContext<ConfirmFn>(() => Promise.resolve(null));
/** `await confirm({...})` → null when cancelled, otherwise '' (or the reason text). */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const confirm = useCallback<ConfirmFn>(o => new Promise(resolve => { setReason(''); setTouched(false); setState({ ...o, resolve }); }), []);
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const needReason = state?.reason?.required !== false && !!state?.reason;
  const invalid = needReason && reason.trim().length < 3;
  const tone = state?.tone ?? 'danger';
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(null)}
        title={state?.title ?? ''}
        width={460}
        icon={tone !== 'default' ? <span className={`modal-icon tone-${tone === 'danger' ? 'bad' : 'warn'}`}>{tone === 'danger' ? <Trash2 /> : <AlertTriangle />}</span> : undefined}
        footer={
          <>
            <button className="btn" onClick={() => close(null)}>Keep as is</button>
            <button
              className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => { setTouched(true); if (!invalid) close(reason.trim()); }}
              data-autofocus={state?.reason ? undefined : true}
            >
              {state?.confirmText ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="stack gap-4">
          <div>{state?.message}</div>
          {state?.reason && (
            <TextArea
              label={state.reason.label} placeholder={state.reason.placeholder} value={reason} autoFocus rows={3}
              onChange={e => setReason(e.target.value)} error={touched && invalid ? 'Please give a short reason — it is kept in the activity log.' : undefined}
              required={needReason}
            />
          )}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ------------------------------------------------------------ menu
export interface MenuAction { label: string; icon?: ReactNode; onClick?: () => void; href?: string; danger?: boolean; disabled?: boolean; hidden?: boolean; separator?: boolean }

/** Contextual "⋯" menu: keyboard navigable, positioned in a portal so tables never clip it. */
export function Menu({ items, label = 'More actions', trigger, align = 'end' }: { items: MenuAction[]; label?: string; trigger?: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter(i => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    let left = align === 'end' ? r.right - m.width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    let top = r.bottom + 4;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
    setPos({ top, left });
    menu.current.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);

  if (visible.filter(i => !i.separator).length === 0) return null;

  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); btn.current?.focus(); }
  };

  return (
    <>
      <button
        ref={btn} type="button" className={trigger ? 'btn' : 'btn btn-ghost btn-icon btn-sm'} aria-haspopup="menu" aria-expanded={open} aria-label={trigger ? undefined : label}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
      >
        {trigger ?? <MoreHorizontal />}
      </button>
      {open && createPortal(
        <div ref={menu} className="popover" role="menu" aria-label={label} style={{ top: pos.top, left: pos.left }} onKeyDown={onKey} onClick={e => e.stopPropagation()}>
          {visible.map((it, i) => it.separator ? <div key={i} className="menu-sep" role="separator" /> : it.href ? (
            <a key={i} role="menuitem" className={`menu-item${it.danger ? ' danger' : ''}`} href={it.href} onClick={() => setOpen(false)}>{it.icon}{it.label}</a>
          ) : (
            <button key={i} role="menuitem" type="button" className={`menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
