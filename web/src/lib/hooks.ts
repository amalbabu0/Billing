import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsMobile = () => useMediaQuery('(max-width: 760px)');

/** Global keyboard shortcut. Ignored while typing in a field unless `inFields`. */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, opts: { inFields?: boolean; enabled?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (opts.enabled === false) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const mod = parts.includes('mod'); const shift = parts.includes('shift'); const alt = parts.includes('alt');
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing && !opts.inFields && !mod && !key.startsWith('f')) return;
      if (mod !== (e.ctrlKey || e.metaKey) || shift !== e.shiftKey || alt !== e.altKey) return;
      if (e.key.toLowerCase() !== key) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, opts.inFields, opts.enabled]);
}

export interface ListState {
  page: number; pageSize: number; search: string; sortBy?: string; sortDescending: boolean; filters: Record<string, string>;
}

/**
 * List screen state kept in the URL (so Back, refresh and shared links keep filters).
 * `filters` holds any extra keys (status, categoryId, from, to…).
 */
export function useListState(defaults: Partial<ListState> = {}, filterKeys: string[] = []) {
  const [params, setParams] = useSearchParams();
  const state: ListState = useMemo(() => {
    const filters: Record<string, string> = {};
    for (const k of filterKeys) {
      const v = params.get(k) ?? defaults.filters?.[k];
      if (v) filters[k] = v;
    }
    return {
      page: Number(params.get('page') ?? defaults.page ?? 1) || 1,
      pageSize: Number(params.get('size') ?? defaults.pageSize ?? 25) || 25,
      search: params.get('q') ?? defaults.search ?? '',
      sortBy: params.get('sort') ?? defaults.sortBy,
      sortDescending: (params.get('dir') ?? (defaults.sortDescending ? 'desc' : 'asc')) === 'desc',
      filters,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback((patch: Omit<Partial<ListState>, 'filters'> & { filters?: Record<string, string | undefined> }, resetPage = true) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      const set = (k: string, v: string | number | undefined | null) => (v === undefined || v === null || v === '' ? next.delete(k) : next.set(k, String(v)));
      if (patch.page !== undefined) set('page', patch.page === 1 ? undefined : patch.page);
      else if (resetPage) next.delete('page');
      if (patch.pageSize !== undefined) set('size', patch.pageSize === (defaults.pageSize ?? 25) ? undefined : patch.pageSize);
      if (patch.search !== undefined) set('q', patch.search);
      if (patch.sortBy !== undefined) set('sort', patch.sortBy);
      if (patch.sortDescending !== undefined) set('dir', patch.sortDescending ? 'desc' : 'asc');
      if (patch.filters) for (const [k, v] of Object.entries(patch.filters)) set(k, v);
      return next;
    }, { replace: true });
  }, [setParams, defaults.pageSize]);

  return [state, update] as const;
}

/** Remembers a per-browser preference (column visibility, view mode). Safe when storage is unavailable. */
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('fs:' + key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem('fs:' + key, JSON.stringify(next)); } catch { /* private mode */ }
  }, [key]);
  return [v, set];
}

export function useDateRange(preset = 'month') {
  return useMemo(() => rangeFor(preset), [preset]);
}

export function rangeFor(preset: string): { from: string; to: string } {
  const t = new Date();
  const d = (x: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };
  const back = (n: number) => { const x = new Date(t); x.setDate(x.getDate() - n); return x; };
  switch (preset) {
    case 'today': return { from: d(t), to: d(t) };
    case 'yesterday': return { from: d(back(1)), to: d(back(1)) };
    case '7d': return { from: d(back(6)), to: d(t) };
    case '30d': return { from: d(back(29)), to: d(t) };
    case 'lastMonth': { const f = new Date(t.getFullYear(), t.getMonth() - 1, 1); const l = new Date(t.getFullYear(), t.getMonth(), 0); return { from: d(f), to: d(l) }; }
    case 'quarter': { const q = Math.floor(t.getMonth() / 3) * 3; return { from: d(new Date(t.getFullYear(), q, 1)), to: d(t) }; }
    case 'fy': { const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; return { from: d(new Date(y, 3, 1)), to: d(t) }; }
    case 'month':
    default: return { from: d(new Date(t.getFullYear(), t.getMonth(), 1)), to: d(t) };
  }
}
