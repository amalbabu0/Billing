/** Indian number & date formatting. Money is always shown with ₹ and lakh/crore grouping. */

const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function money(v: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const s = opts.decimals === false ? inr0.format(abs) : inr2.format(abs);
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  return `${sign}₹${s}`;
}

/** ₹1.2 L / ₹3.4 Cr for charts and KPIs where space is tight. */
export function compactMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}k`;
  return `${sign}₹${inr0.format(abs)}`;
}

function trim(n: number) {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '');
}

export function qty(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : qtyFmt.format(v);
}

export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : inr0.format(v);
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${qtyFmt.format(v)}%`;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  // "2026-09-25" or "2026-09-25T00:00:00" from the server are local calendar dates.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m && !/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const tFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

export function date(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dFmt.format(d) : '—';
}

export function shortDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dShort.format(d) : '—';
}

export function dateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? `${dFmt.format(d)}, ${tFmt.format(d)}` : '—';
}

export function time(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? tFmt.format(d) : '—';
}

/** "Today, 3:40 pm" / "Yesterday" / "12 Sep" — for feeds and timelines. */
export function relative(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diffMin >= 0 && diffMin < 1) return 'Just now';
  if (diffMin >= 0 && diffMin < 60) return `${diffMin} min ago`;
  if (d.getTime() >= startToday) return `Today, ${tFmt.format(d)}`;
  if (d.getTime() >= startToday - 86400000) return `Yesterday, ${tFmt.format(d)}`;
  return d.getFullYear() === now.getFullYear() ? dShort.format(d) : dFmt.format(d);
}

export function daysFromToday(v: string | null | undefined): number | null {
  const d = toDate(v);
  if (!d) return null;
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today) / 86400000);
}

/** yyyy-mm-dd in local time, for <input type=date> and API filters. */
export function iso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoInput(v: string | null | undefined): string {
  const d = toDate(v);
  return d ? iso(d) : '';
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function plural(n: number, one: string, many?: string) {
  return `${num(n)} ${n === 1 ? one : many ?? one + 's'}`;
}

/** Status labels: "OUT_FOR_DELIVERY" → "Out for delivery". */
const LABELS: Record<string, string> = {
  FINAL: 'Final', DRAFT: 'Draft', CANCELLED: 'Cancelled', PAID: 'Paid', PARTIAL: 'Part paid', PARTIALLY_PAID: 'Part paid', UNPAID: 'Unpaid', OVERDUE: 'Overdue',
  QUALITY_CHECK: 'Quality check', OUT_FOR_DELIVERY: 'Out for delivery', IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock',
  MADE_TO_ORDER: 'Made to order', RECEIVED: 'Received', ON_ACCOUNT: 'On account', SALES_ORDER: 'Sales order', CUSTOM_ORDER: 'Custom order',
  PURCHASE_IN: 'Purchase', SALE_OUT: 'Sale', RESERVED_SALE_OUT: 'Sale (reserved)', RETURN_IN: 'Return', RETURN_DAMAGED: 'Return (damaged)',
  ADJUSTMENT_IN: 'Adjustment +', ADJUSTMENT_OUT: 'Adjustment −', DAMAGE_REPAIRED: 'Repaired', DAMAGE_WRITE_OFF: 'Written off',
  SALE_CANCEL_IN: 'Sale cancelled', PURCHASE_CANCEL_OUT: 'Purchase cancelled', PURCHASE_RETURN_OUT: 'Returned to supplier', DEBIT_NOTE: 'Debit note',
  MARK_DAMAGED: 'Mark damaged', SET_DISPLAY: 'Set display qty', VOIDED: 'Voided', REFUND: 'Refund',
};

export function label(status: string | null | undefined): string {
  if (!status) return '';
  if (LABELS[status]) return LABELS[status];
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
