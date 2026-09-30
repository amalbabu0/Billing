// Reusable UI components: toast, modal, confirm, form fields, combobox, data table, toolbar.
import { h, amt, qty, fdate, pct, money, matches, debounce, fill } from './utils.js';
import { ValidationError } from './store.js';
import { toXlsx, toCsv, download, fileName, printHtml, printNow } from './export.js';

// ---------------------------------------------------------------- icons (inline SVG, Lucide-style paths)
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  cart: 'M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  cheque: 'M3 6h18v12H3zM7 10h6M7 14h3M16 14h2',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  calc: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h0M16 11h0M8 15h2M12 15h0M16 15v3M8 18h2M12 18h0',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  excel: 'M4 3h11l5 5v13H4zM14 3v6h6M8 12l4 6M12 12l-4 6',
  file: 'M4 3h11l5 5v13H4zM14 3v6h6M8 13h8M8 17h6',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  broom: 'M14 4l6 6M9 9l6 6M4 20l5-11 6 6z',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h0M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  chevron: 'M9 18l6-6-6-6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  pause: 'M8 5v14M16 5v14',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  layers: 'M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h4',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h0',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  filter: 'M3 4h18l-7 8v6l-4 2v-8z',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic ' + cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.box);
  s.append(p);
  return s;
}

// ---------------------------------------------------------------- toast
export function toast(message, tone = 'ok', detail) {
  const host = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, icon(tone === 'bad' ? 'alert' : 'check'), h('div', null, h('b', null, message), detail ? h('div', { class: 'toast-detail' }, detail) : null));
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, tone === 'bad' ? 6000 : 3200);
}
/** Run an action; show validation errors instead of throwing. Returns the result or undefined. */
export function attempt(fn, okMsg) {
  try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r ?? true; }
  catch (e) {
    if (e instanceof ValidationError) { toast(e.errors.length > 1 ? 'Please fix the following' : e.errors[0], 'bad', e.errors.length > 1 ? h('ul', null, e.errors.map(x => h('li', null, x))) : null); return undefined; }
    console.error(e); toast('Something went wrong', 'bad', e.message); return undefined;
  }
}

// ---------------------------------------------------------------- modal / confirm
const stack = [];
export const modalOpen = () => stack.length > 0;
export function modal({ title, body, footer, width = 560, onClose, cls = '' }) {
  const prevFocus = document.activeElement;
  const close = () => {
    const i = stack.indexOf(api); if (i < 0) return;
    stack.splice(i, 1); back.remove(); onClose?.(); prevFocus?.focus?.();
  };
  const closeBtn = h('button', { class: 'btn-icon', 'aria-label': 'Close', onclick: close }, icon('x'));
  const dlg = h('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, calc(100vw - 24px))` } },
    h('div', { class: 'modal-head' }, h('h2', null, title), closeBtn),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } }, dlg);
  document.body.append(back);
  const api = { close, el: dlg, back };
  stack.push(api);
  (dlg.querySelector('[autofocus], input:not([type=hidden]):not([disabled]):not([hidden]), select, textarea, .modal-foot .btn-primary') || closeBtn).focus();
  return api;
}
export function closeTopModal() { const m = stack[stack.length - 1]; if (m) { m.close(); return true; } return false; }

export function confirmDialog({ title, message, okText = 'Confirm', danger = false, reason = false }) {
  return new Promise(resolve => {
    let done = false;
    const input = reason ? h('textarea', { class: 'input', rows: 2, placeholder: 'Reason (required)' }) : null;
    const finish = v => { done = true; m.close(); resolve(v); };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { if (input && !input.value.trim()) { input.focus(); input.classList.add('invalid'); return; } finish(input ? input.value.trim() : true); } }, okText);
    const m = modal({
      title, width: 440,
      body: h('div', { class: 'stack' }, h('p', null, message), input),
      footer: [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'), ok],
      onClose: () => { if (!done) resolve(null); },
    });
    if (!input) setTimeout(() => ok.focus(), 30);
  });
}

// ---------------------------------------------------------------- form fields
export function field(label, control, { hint, req, cls = '' } = {}) {
  const id = control.id || (control.id = 'f' + Math.random().toString(36).slice(2, 8));
  return h('div', { class: 'field ' + cls }, h('label', { for: id }, label, req ? h('span', { class: 'req' }, ' *') : null), control, hint ? h('div', { class: 'hint' }, hint) : null);
}
export const input = (attrs = {}) => h('input', { class: 'input', ...attrs });
export const num = (attrs = {}) => h('input', { class: 'input num', type: 'number', step: 'any', inputmode: 'decimal', ...attrs });
export const dateInput = (attrs = {}) => h('input', { class: 'input', type: 'date', ...attrs });
export function select(options, value, attrs = {}) {
  const s = h('select', { class: 'input', ...attrs });
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o];
    s.append(h('option', { value: v, selected: String(v) === String(value ?? '') }, l));
  }
  return s;
}
export const badge = (text, tone = 'muted') => h('span', { class: `badge b-${tone}` }, text);
export const STATUS_TONE = {
  in: 'ok', low: 'warn', out: 'bad', Pending: 'warn', Cleared: 'ok', Bounced: 'bad', Cancelled: 'muted', Loaded: 'info', Completed: 'ok',
  Draft: 'muted', Ordered: 'info', 'Partially Received': 'warn', Received: 'ok', Paid: 'ok', Unpaid: 'bad', Partial: 'warn', held: 'warn', saved: 'ok', cancelled: 'muted',
};
export const statusBadge = s => badge({ in: 'In Stock', low: 'Low Stock', out: 'Out of Stock', held: 'On hold', saved: 'Saved', cancelled: 'Cancelled' }[s] || s, STATUS_TONE[s] || 'muted');

/**
 * Keyboard-friendly typeahead. options: [{value, label, sub, disabled}]
 * getOptions may be a function for live data.
 */
export function combo({ options, value, placeholder = 'Type to search…', onChange, width, autofocus, name }) {
  const getOpts = () => (typeof options === 'function' ? options() : options);
  const cur = () => getOpts().find(o => o.value === value);
  const inp = h('input', { class: 'input combo-input', placeholder, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', autofocus, name, value: cur()?.label || '' });
  const list = h('div', { class: 'combo-list', role: 'listbox' });
  const wrap = h('div', { class: 'combo', style: width ? { width } : null }, inp, list);
  let active = 0, shown = [];
  const render = () => {
    const q = inp.value === (cur()?.label || '') ? '' : inp.value;
    shown = getOpts().filter(o => matches(q, o.label, o.sub, o.search)).slice(0, 60);
    fill(list, ...(shown.length ? shown.map((o, i) => h('div', { class: `combo-opt${i === active ? ' active' : ''}${o.disabled ? ' disabled' : ''}`, role: 'option', onmousedown: e => { e.preventDefault(); choose(o); } }, h('div', null, o.label), o.sub ? h('div', { class: 'combo-sub' }, o.sub) : null)) : [h('div', { class: 'combo-empty' }, 'No matches')]));
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const open = () => { wrap.classList.add('open'); inp.setAttribute('aria-expanded', 'true'); render(); };
  const closeL = () => { wrap.classList.remove('open'); inp.setAttribute('aria-expanded', 'false'); };
  const choose = o => { if (o.disabled) return; value = o.value; inp.value = o.label; closeL(); onChange?.(o.value, o); };
  inp.addEventListener('focus', () => { inp.select(); active = 0; });
  inp.addEventListener('mousedown', () => { if (document.activeElement === inp) open(); else setTimeout(open, 0); });
  inp.addEventListener('input', () => { active = 0; open(); });
  inp.addEventListener('blur', () => { closeL(); if (!cur() || inp.value !== cur().label) inp.value = cur()?.label || ''; });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!wrap.classList.contains('open')) open(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter' && wrap.classList.contains('open') && shown[active]) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape' && wrap.classList.contains('open')) { e.stopPropagation(); closeL(); }
  });
  wrap.setValue = v => { value = v; inp.value = cur()?.label || ''; };
  wrap.getValue = () => value;
  wrap.focus = () => inp.focus();
  wrap.input = inp;
  return wrap;
}

// ---------------------------------------------------------------- formatting per column type
export function fmt(v, type) {
  if (v == null || v === '') return '';
  switch (type) {
    case 'money': return amt(v);
    case 'qty': return qty(v);
    case 'date': return fdate(v);
    case 'pct': return pct(v);
    default: return String(v);
  }
}

// ---------------------------------------------------------------- data table
/**
 * columns: [{ key, label, type, value(row), render(row), total: true | fn(rows), cls, width }]
 * Returns an element with .setRows(rows) and .getView() (filtered+sorted rows).
 */
export function dataTable({ columns, rows = [], onRowClick, pageSize = 50, empty = 'No records found', rowClass, compact = true, keyOf = r => r.id, maxHeight }) {
  let data = rows, sortKey = null, sortDir = 1, page = 1;
  const val = (c, r) => (c.value ? c.value(r) : r[c.key]);
  const isNum = c => ['money', 'qty', 'pct'].includes(c.type);
  const table = h('table', { class: `tbl${compact ? ' compact' : ''}` });
  const wrap = h('div', { class: 'tbl-wrap', style: maxHeight ? { maxHeight } : null }, table);
  const pager = h('div', { class: 'pager' });
  const root = h('div', { class: 'tbl-root' }, wrap, pager);
  const view = () => {
    if (!sortKey) return data;
    const c = columns.find(x => x.key === sortKey);
    return [...data].sort((a, b) => { const x = val(c, a), y = val(c, b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  };
  const render = () => {
    const all = view();
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    page = Math.min(page, pages);
    const slice = all.slice((page - 1) * pageSize, page * pageSize);
    const thead = h('thead', null, h('tr', null, columns.map(c => h('th', {
      class: `${isNum(c) ? 'num' : ''} ${c.sortable === false ? '' : 'sortable'} ${sortKey === c.key ? (sortDir > 0 ? 'asc' : 'desc') : ''}`, style: c.width ? { width: c.width } : null,
      tabindex: c.sortable === false ? null : '0', 'aria-sort': sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : null,
      onclick: () => { if (c.sortable === false) return; if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = isNum(c) || c.type === 'date' ? -1 : 1; } render(); },
      onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); },
    }, c.label))));
    const tbody = h('tbody');
    if (!slice.length) tbody.append(h('tr', { class: 'empty-row' }, h('td', { colspan: columns.length }, h('div', { class: 'empty' }, icon('search'), h('div', null, empty)))));
    for (const r of slice) {
      const tr = h('tr', { class: `${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) || '' : ''}`, tabindex: onRowClick ? '0' : null, dataset: { key: keyOf(r) ?? '' } },
        columns.map(c => { const content = c.render ? c.render(r) : fmt(val(c, r), c.type); return h('td', { class: `${isNum(c) ? 'num' : ''} ${c.cls || ''}` }, content); }));
      if (onRowClick) {
        tr.addEventListener('click', e => { if (e.target.closest('button, a, input, select')) return; onRowClick(r); });
        tr.addEventListener('keydown', e => {
          if (e.key === 'Enter' && e.target === tr) onRowClick(r);
          else if (e.key === 'ArrowDown') { e.preventDefault(); tr.nextElementSibling?.focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); tr.previousElementSibling?.focus(); }
        });
      }
      tbody.append(tr);
    }
    const hasTotals = columns.some(c => c.total);
    const tfoot = hasTotals ? h('tfoot', null, h('tr', null, columns.map((c, i) => {
      if (!c.total) return h('td', null, i === 0 ? `Total (${all.length})` : '');
      const v = typeof c.total === 'function' ? c.total(all) : all.reduce((a, r) => a + (Number(val(c, r)) || 0), 0);
      return h('td', { class: isNum(c) ? 'num' : '' }, fmt(v, c.type));
    }))) : null;
    fill(table, thead, tbody, tfoot || '');
    fill(pager, 
      h('span', { class: 'muted' }, all.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, all.length)} of ${all.length}` : '0 records'),
      pages > 1 ? h('span', { class: 'pager-btns' },
        h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => { page--; render(); } }, 'Prev'),
        h('span', null, ` Page ${page} / ${pages} `),
        h('button', { class: 'btn btn-sm', disabled: page >= pages, onclick: () => { page++; render(); } }, 'Next')) : '');
  };
  root.setRows = r => { data = r; page = 1; render(); };
  root.getView = view;
  root.columns = columns;
  /** Export-ready table (raw values) of the current filtered and sorted rows. */
  root.exportTable = (title, subtitle, summary) => {
    const all = view();
    const cols = columns.filter(c => c.export !== false);
    const hasTotals = cols.some(c => c.total);
    return {
      title, subtitle, summary,
      columns: cols.map(c => ({ label: c.label, type: c.type || 'text' })),
      rows: all.map(r => cols.map(c => { const v = c.exportValue ? c.exportValue(r) : val(c, r); return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v ?? ''; })),
      totals: hasTotals ? cols.map((c, i) => (c.total ? (typeof c.total === 'function' ? c.total(all) : Math.round(all.reduce((a, r) => a + (Number(val(c, r)) || 0), 0) * 100) / 100) : i === 0 ? 'Total' : '')) : null,
    };
  };
  render();
  return root;
}

// ---------------------------------------------------------------- export / print actions
export function exportButtons(getTable) {
  const xl = () => { const t = getTable(); download(toXlsx(t), fileName(t.title, 'xlsx')); toast('Excel file downloaded', 'ok', `${t.rows.length} rows`); };
  const csv = () => { const t = getTable(); download(toCsv(t), fileName(t.title, 'csv')); toast('CSV file downloaded', 'ok', `${t.rows.length} rows`); };
  const preview = () => showPrintPreview(getTable());
  const print = () => printNow(printHtml(getTable(), fmt));
  return {
    el: h('div', { class: 'btn-group' },
      h('button', { class: 'btn btn-excel', onclick: xl, title: 'Export to Excel (.xlsx)' }, icon('excel'), 'Excel'),
      h('button', { class: 'btn', onclick: csv, title: 'Export to CSV' }, icon('file'), 'CSV'),
      h('button', { class: 'btn', onclick: preview, title: 'Print preview' }, icon('eye'), 'Preview'),
      h('button', { class: 'btn', onclick: print, title: 'Print (Ctrl+P)' }, icon('print'), 'Print')),
    xl, csv, print, preview,
  };
}
export function showPrintPreview(table) {
  const paper = h('div', { class: 'paper', html: printHtml(table, fmt) });
  const m = modal({
    title: 'Print preview — ' + table.title, width: 1000, cls: 'modal-preview',
    body: h('div', { class: 'preview-scroll' }, paper),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn btn-primary', onclick: () => { m.close(); printNow(printHtml(table, fmt)); } }, icon('print'), 'Print')],
  });
}

// ---------------------------------------------------------------- toolbar & layout pieces
export function searchBox({ value = '', placeholder = 'Search…', onInput, autofocus }) {
  const inp = h('input', { class: 'input search-input', type: 'search', placeholder, value, 'aria-label': 'Search', autofocus, dataset: { pageSearch: '1' } });
  const fire = debounce(() => onInput(inp.value), 120);
  inp.addEventListener('input', fire);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape' && inp.value) { e.stopPropagation(); inp.value = ''; onInput(''); } });
  return h('div', { class: 'search' }, icon('search'), inp);
}
export function kpi(label, value, sub, tone, onclick) {
  return h(onclick ? 'button' : 'div', { class: `kpi ${tone ? 'kpi-' + tone : ''}`, onclick }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}
export function pageHeader(title, crumbs = [], actions = []) {
  return h('div', { class: 'page-head' },
    h('div', null, h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), crumbs.map(c => [h('span', { class: 'sep' }, '›'), c.href ? h('a', { href: c.href }, c.label) : h('span', null, c.label)])), h('h1', null, title)),
    h('div', { class: 'page-actions' }, actions));
}
export const card = (title, body, actions) => h('section', { class: 'card' }, title ? h('div', { class: 'card-head' }, h('h3', null, title), actions ? h('div', { class: 'card-actions' }, actions) : null) : null, h('div', { class: 'card-body' }, body));
export const moneyCell = v => h('span', { class: v < 0 ? 't-bad' : '' }, amt(v));
export { money };
