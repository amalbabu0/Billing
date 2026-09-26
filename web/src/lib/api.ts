/**
 * Thin fetch wrapper. Cookies carry the session; unsafe requests echo the XSRF token from the readable cookie.
 * Server errors arrive as { title, code, errors } and surface as ApiError so forms can show field messages.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  fieldErrors: Record<string, string>;
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors ?? {};
  }
}

let onUnauthorized: (() => void) | null = null;
let onPasswordChange: (() => void) | null = null;
export function setAuthHandlers(unauth: () => void, pwd: () => void) {
  onUnauthorized = unauth;
  onPasswordChange = pwd;
}

function xsrf(): string | undefined {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function ensureXsrf() {
  if (!xsrf()) await fetch('/api/auth/csrf', { credentials: 'same-origin' });
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const unsafe = method !== 'GET';
  if (unsafe) await ensureXsrf();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (unsafe) {
    const t = xsrf();
    if (t) headers['X-XSRF-TOKEN'] = t;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the internet connection and try again.', 'network');
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let data: { title?: string; code?: string; errors?: Record<string, string> } = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized?.();
    if (res.status === 403 && data.code === 'password_change_required') onPasswordChange?.();
    // A stale anti-forgery token (after sign-in elsewhere) is refreshed once automatically.
    if (res.status === 400 && data.code === 'csrf' && !(request as { retried?: boolean }).retried) {
      await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      (request as { retried?: boolean }).retried = true;
      try { return await request<T>(method, url, body, raw); } finally { (request as { retried?: boolean }).retried = false; }
    }
    const fallback = res.status === 429 ? 'Too many requests — please wait a moment.' : res.status >= 500 ? 'Something went wrong on the server.' : 'The request failed.';
    throw new ApiError(res.status, data.title || fallback, data.code, data.errors);
  }
  if (raw) return (await res.blob()) as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(url: string, q?: Query) => request<T>('GET', url + qs(q)),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = void>(url: string) => request<T>('DELETE', url),
  blob: (method: 'GET' | 'POST', url: string, body?: unknown) => request<Blob>(method, url, body, true),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Downloads a file produced by the server (exports, PDFs). */
export async function download(method: 'GET' | 'POST', url: string, fileName: string, body?: unknown) {
  const blob = await api.blob(method, url, body);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Opens a server-rendered PDF (A4 / thermal / receipt) in a new tab for printing. */
export async function openPdf(url: string) {
  const win = window.open('', '_blank');
  try {
    const blob = await api.blob('GET', url);
    const href = URL.createObjectURL(blob);
    if (win) win.location.href = href;
    else window.location.href = href;
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

export interface ExportColumn { key: string; label: string; money?: boolean }
/** Sends already-loaded rows to the server's generic table export (CSV / Excel / PDF, audited). */
export function exportTable(opts: { title: string; subtitle?: string; format: 'csv' | 'xlsx' | 'pdf'; columns: ExportColumn[]; rows: Record<string, unknown>[]; totals?: { label: string; value: string }[] }) {
  return download('POST', '/api/export', `${opts.title}.${opts.format}`, { ...opts, columns: opts.columns.map(c => ({ ...c, money: !!c.money })) });
}
