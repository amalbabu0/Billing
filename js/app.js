// Application shell: router, sidebar, top bar, clock, global search, keyboard shortcuts.
import * as st from './store.js';
import { buildSeed } from './seed.js';
import { h, fdate, today, matches, money, setDecimals, fill } from './utils.js';
import { icon, toast, modal, closeTopModal, modalOpen, confirmDialog } from './ui.js';
import { openCalculator } from './calc.js';
import { setHooks, getHooks, navigate, currentPath, flushMounted, clearMounted } from './router.js';
import { dashboard, mainMenu } from './pages/dashboard.js';
import { itemsPage, partiesPage } from './pages/masters.js';
import { salesList, saleForm, purchaseList, purchaseForm, docView } from './pages/billing.js';
import { salesReturnPage, purchaseReturnPage } from './pages/returns.js';
import { stockPage, stockEntryPage, transferPage } from './pages/stock.js';
import { dayBookPage, partyReportPage, chequePage, cashPage } from './pages/accounts.js';
import { poPage } from './pages/po.js';
import { reportsPage, REPORTS } from './pages/reports.js';
import { settingsPage } from './pages/settings.js';

// ---------------------------------------------------------------- data bootstrap
if (!st.load()) st.setState(buildSeed());
setDecimals(st.S().invoice.decimals);

// ---------------------------------------------------------------- routes
const ROUTES = [
  { path: '/', title: 'Dashboard', render: dashboard },
  { path: '/menu', title: 'Main Menu', render: mainMenu },
  { path: '/sales', title: 'Sales', render: salesList, perm: 'sales' },
  { path: '/sales/new', title: 'New Sale', render: saleForm, perm: 'sales' },
  { path: '/sales/edit/:id', title: 'Resume Held Bill', render: saleForm, perm: 'sales' },
  { path: '/sales/:id', title: 'Sales Invoice', render: p => docView('sale', p), perm: 'sales' },
  { path: '/purchases', title: 'Purchases', render: purchaseList, perm: 'purchases' },
  { path: '/purchases/new', title: 'New Purchase', render: purchaseForm, perm: 'purchases' },
  { path: '/purchases/:id', title: 'Purchase', render: p => docView('purchase', p), perm: 'purchases' },
  { path: '/daybook', title: 'Day Book', render: dayBookPage, perm: 'reports' },
  { path: '/parties', title: 'Parties', render: partiesPage },
  { path: '/party-report', title: 'Party-Wise Report', render: partyReportPage, perm: 'reports' },
  { path: '/items', title: 'Items', render: itemsPage },
  { path: '/stock', title: 'Stock', render: stockPage },
  { path: '/stock-entry', title: 'Stock Entry', render: stockEntryPage, perm: 'stock' },
  { path: '/sales-return', title: 'Sales Return', render: salesReturnPage, perm: 'sales' },
  { path: '/purchase-return', title: 'Purchase Return', render: purchaseReturnPage, perm: 'purchases' },
  { path: '/transfer', title: 'Stock Transfer', render: transferPage, perm: 'stock' },
  { path: '/cheques', title: 'Cheque Entry', render: chequePage, perm: 'accounts' },
  { path: '/cash', title: 'Cash Entry', render: cashPage, perm: 'accounts' },
  { path: '/po', title: 'Purchase Orders', render: poPage, perm: 'purchases' },
  { path: '/reports', title: 'Reports', render: reportsPage, perm: 'reports' },
  { path: '/reports/:key', title: 'Report', render: reportsPage, perm: 'reports' },
  { path: '/settings', title: 'Settings', render: settingsPage, perm: 'settings' },
];

const NAV = [
  ['Dashboard', '/', 'home'], ['Main Menu', '/menu', 'grid'], ['Sales', '/sales', 'cart', 'sales'], ['Purchases', '/purchases', 'truck', 'purchases'],
  ['Day Book', '/daybook', 'book', 'reports'], ['Parties', '/parties', 'users'], ['Party-Wise Report', '/party-report', 'users', 'reports'], ['Items', '/items', 'tag'],
  ['Stock', '/stock', 'box'], ['Stock Entry', '/stock-entry', 'edit', 'stock'],
  ['Sales Return', '/sales-return', 'undo', 'sales'], ['Purchase Return', '/purchase-return', 'redo', 'purchases'], ['Stock Transfer', '/transfer', 'swap', 'stock'],
  ['Cheque Entry', '/cheques', 'cheque', 'accounts'], ['Cash Entry', '/cash', 'cash', 'accounts'], ['Purchase Orders', '/po', 'clipboard', 'purchases'],
  ['Reports', '/reports', 'chart', 'reports'], ['Settings', '/settings', 'settings', 'settings'],
];

let history = [];
let tick = () => {};
function match(path) {
  for (const r of ROUTES) {
    const a = r.path.split('/'), b = path.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(b[i])), true) : seg === b[i]))) return { route: r, params };
  }
  return null;
}

let cleanup = null;
function renderRoute() {
  const path = currentPath();
  const m = match(path) || match('/');
  const main = document.getElementById('main');
  cleanup?.(); cleanup = null; setHooks({}); clearMounted();
  while (modalOpen()) closeTopModal();
  document.body.classList.remove('nav-open');
  if (history[history.length - 1] !== path) history.push(path);
  if (history.length > 50) history.shift();
  st.temp.set('lastRoute', path);
  let content;
  if (m.route.perm && !st.can(m.route.perm)) {
    content = h('div', { class: 'page' }, h('div', { class: 'empty big' }, icon('alert'), h('h2', null, 'No access'), h('p', null, `${st.currentUser().name} (${st.currentUser().role}) does not have permission for ${m.route.title}.`), h('a', { class: 'btn', href: '#/' }, 'Back to dashboard')));
  } else {
    try {
      const r = m.route.render(m.params);
      content = r?.el || r;
      cleanup = r?.cleanup || null;
    } catch (e) {
      console.error(e);
      content = h('div', { class: 'page' }, h('div', { class: 'empty big error' }, icon('alert'), h('h2', null, 'This screen could not be opened'), h('p', null, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to dashboard')));
    }
  }
  fill(main, content);
  main.scrollTop = 0;
  flushMounted();
  document.title = `${m.route.title} — ${st.S().business.name}`;
  renderNav(path);
  const focusTarget = main.querySelector('[autofocus]');
  if (focusTarget) setTimeout(() => (focusTarget.input || focusTarget).focus(), 30);
}

// ---------------------------------------------------------------- shell
function renderNav(path) {
  const nav = document.getElementById('nav');
  const active = p => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/'));
  const reportsOpen = !!st.temp.get().navReportsOpen;
  fill(nav, 
    h('div', { class: 'nav-section' }, 'Main'),
    NAV.filter(([, , , perm]) => !perm || st.can(perm)).map(([label, p, ic]) => [
      p === '/reports'
        ? h('div', { class: 'nav-row' },
          h('a', { href: '#' + p, class: 'nav-link' + (active(p) ? ' active' : ''), 'aria-current': active(p) ? 'page' : null }, icon(ic), h('span', null, label)),
          h('button', { class: 'nav-toggle' + (reportsOpen ? ' open' : ''), 'aria-label': reportsOpen ? 'Collapse report list' : 'Expand report list', 'aria-expanded': String(reportsOpen), onclick: () => { st.temp.set('navReportsOpen', !reportsOpen); renderNav(path); } }, icon('chevron')))
        : h('a', { href: '#' + p, class: 'nav-link' + (active(p) ? ' active' : ''), 'aria-current': active(p) ? 'page' : null }, icon(ic), h('span', null, label)),
      p === '/reports' && reportsOpen ? h('div', { class: 'nav-sub' }, REPORTS.map(r => h('a', { href: '#/reports/' + r.key, class: 'nav-sublink' + (path === '/reports/' + r.key ? ' active' : '') }, r.title))) : null,
    ]),
    h('div', { class: 'nav-section' }, 'Utilities'),
    h('button', { class: 'nav-link', onclick: openCalculator }, icon('calc'), h('span', null, 'Calculator'), h('kbd', null, 'F9')),
    h('button', { class: 'nav-link', onclick: cleanTempData }, icon('broom'), h('span', null, 'Clean Temp Data')),
    h('button', { class: 'nav-link', onclick: closeWindow }, icon('x'), h('span', null, 'Close Window'), h('kbd', null, 'Alt+W')),
    h('div', { class: 'side-clock', id: 'side-clock', 'aria-label': 'Current date and time' }),
  );
  tick();
}

function shell() {
  const b = st.S().business;
  const user = st.currentUser();
  const clock = h('div', { class: 'clock', title: 'Local date & time' }, icon('clock'), h('span', { id: 'clock-text' }));
  const app = document.getElementById('app');
  fill(app, 
    h('aside', { class: 'sidebar', id: 'sidebar' },
      h('a', { class: 'brand', href: '#/' }, h('div', { class: 'brand-mark' }, 'WP'), h('div', null, h('div', { class: 'brand-name' }, 'Reseller Solution'), h('div', { class: 'brand-sub' }, 'for ' + b.name))),
      h('nav', { id: 'nav', 'aria-label': 'Main navigation' }),
      h('div', { class: 'side-foot' }, h('div', { class: 'user-chip' }, h('div', { class: 'avatar' }, user.name.slice(0, 1)), h('div', null, h('div', null, user.name), h('div', { class: 'muted' }, user.role))))),
    h('div', { class: 'nav-scrim', onclick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'workspace' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn-icon hamburger', 'aria-label': 'Open menu', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
        h('div', { class: 'app-title' }, 'RESELLER SOLUTION FOR ', h('b', null, b.name.toUpperCase())),
        h('button', { class: 'global-search', onclick: openPalette }, icon('search'), h('span', null, 'Search invoices, items, parties…'), h('kbd', null, 'Ctrl K')),
        h('div', { class: 'top-actions' },
          h('button', { class: 'btn-icon', title: 'Calculator (F9)', 'aria-label': 'Calculator', onclick: openCalculator }, icon('calc')),
          clock,
          h('button', { class: 'btn-icon', title: 'Close window (Alt+W)', 'aria-label': 'Close window', onclick: closeWindow }, icon('x')))),
      h('main', { id: 'main', tabindex: '-1' })),
  );
  tick = () => {
    const d = new Date();
    const el = document.getElementById('clock-text');
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();
    const day = d.toLocaleDateString('en-IN', { weekday: 'long' });
    if (el) el.textContent = `${fdate(today())}  ${time}`;
    const side = document.getElementById('side-clock');
    if (side) fill(side, h('b', null, fdate(today()).replace(/\//g, '-')), h('span', null, time), h('span', null, day));
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------------------------------------------------------- utilities
/** "Close Window": close the top dialog, else go back to the previous screen, else the dashboard. */
export function closeWindow() {
  if (closeTopModal()) return;
  if (currentPath() === '/') { toast('Already on the dashboard'); return; }
  history.pop();
  const prev = history.pop();
  navigate(prev && prev !== currentPath() ? prev : '/');
}

async function cleanTempData() {
  const sizeKb = (st.temp.size() / 1024).toFixed(1);
  const opts = [
    ['temp', 'Temporary data — search history, remembered filters, unsaved drafts, session cache', true, false],
    ['held', `Held (unsaved) bills — ${st.getState().sales.filter(s => s.status === 'held').length} bill(s)`, false, false],
    ['reset', 'Reset ALL business data to the demo data set (sales, purchases, items, parties…)', false, true],
  ];
  const boxes = opts.map(([k, label, checked, danger]) => h('label', { class: 'check' + (danger ? ' danger' : '') }, h('input', { type: 'checkbox', value: k, checked }), h('span', null, label)));
  const m = modal({
    title: 'Clean Temp Data', width: 520,
    body: h('div', { class: 'stack' }, h('p', null, `Temporary data currently uses ${sizeKb} KB. Permanent records are kept unless you tick them below.`), ...boxes),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-danger', onclick: async () => {
      const chosen = boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value);
      if (!chosen.length) { toast('Nothing selected', 'bad'); return; }
      if (chosen.includes('reset') && !(await confirmDialog({ title: 'Reset all data?', message: 'Every sale, purchase, payment and master record you entered will be replaced by the demo data. This cannot be undone.', okText: 'Reset everything', danger: true }))) return;
      m.close();
      if (chosen.includes('temp')) st.temp.clear();
      if (chosen.includes('held')) st.getState().sales.filter(s => s.status === 'held').forEach(s => st.deleteHeld(s.id));
      if (chosen.includes('reset')) { st.setState(buildSeed()); shell(); }
      toast('Cleanup finished', 'ok', chosen.map(c => ({ temp: 'Temporary data cleared', held: 'Held bills removed', reset: 'Demo data restored' }[c])).join(' · '));
      renderRoute();
    } }, icon('broom'), 'Clean selected')],
  });
}

// ---------------------------------------------------------------- global search (Ctrl+K)
function searchIndex() {
  const s = st.getState();
  const out = [];
  NAV.forEach(([label, p, ic, perm]) => { if (!perm || st.can(perm)) out.push({ group: 'Screens', label, sub: 'Go to screen', path: p, icon: ic }); });
  REPORTS.forEach(r => st.can('reports') && out.push({ group: 'Reports', label: r.title, sub: 'Report', path: '/reports/' + r.key, icon: 'chart' }));
  s.sales.forEach(x => out.push({ group: 'Sales invoices', label: x.no, sub: `${st.party(x.partyId)?.name} · ${fdate(x.date)} · ${money(st.totals(x).grand)} · ${x.status}`, search: x.date + ' sale ' + st.party(x.partyId)?.name, path: x.status === 'held' ? '/sales/edit/' + x.id : '/sales/' + x.id, icon: 'receipt' }));
  s.purchases.forEach(x => out.push({ group: 'Purchases', label: x.no, sub: `${st.party(x.partyId)?.name} · bill ${x.supplierInv || '-'} · ${fdate(x.date)} · ${money(st.totals(x).grand)}`, search: x.date + ' purchase ' + x.supplierInv, path: '/purchases/' + x.id, icon: 'truck' }));
  s.items.forEach(x => out.push({ group: 'Items', label: x.name, sub: `${x.code} · ${x.category} · stock ${st.stockOf(x.id)} ${x.unit}`, search: x.code + ' ' + x.hsn, path: '/stock?item=' + x.id, icon: 'tag' }));
  s.parties.forEach(x => out.push({ group: x.type === 'customer' ? 'Customers' : 'Suppliers', label: x.name, sub: `${x.gstin || 'No GSTIN'} · ${x.phone || ''} · balance ${money(st.partyBalance(x.id))}`, search: x.type, path: '/party-report?party=' + x.id, icon: 'users' }));
  s.salesReturns.forEach(x => out.push({ group: 'Returns', label: x.no, sub: `Sales return · ${st.party(x.partyId)?.name} · ${fdate(x.date)}`, search: x.date + ' sales return', path: '/sales-return?view=' + x.id, icon: 'undo' }));
  s.purchaseReturns.forEach(x => out.push({ group: 'Returns', label: x.no, sub: `Purchase return · ${st.party(x.partyId)?.name} · ${fdate(x.date)}`, search: x.date + ' purchase return', path: '/purchase-return?view=' + x.id, icon: 'redo' }));
  s.pos.forEach(x => out.push({ group: 'Purchase orders', label: x.no, sub: `${st.party(x.partyId)?.name} · ${x.status}`, search: x.date, path: '/po?open=' + x.id, icon: 'clipboard' }));
  return out;
}
export function openPalette() {
  if (document.querySelector('.palette')) return;
  const idx = searchIndex();
  let active = 0, shown = [];
  const inp = h('input', { class: 'palette-input', placeholder: 'Search invoice no., item, customer, supplier, date (yyyy-mm-dd) or type…', 'aria-label': 'Global search' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const go = r => { m.close(); const recent = st.temp.get().recentSearches || []; st.temp.set('recentSearches', [inp.value, ...recent.filter(x => x !== inp.value)].filter(Boolean).slice(0, 8)); navigate(r.path); };
  const render = () => {
    const q = inp.value.trim();
    shown = (q ? idx.filter(r => matches(q, r.label, r.sub, r.search, r.group)) : idx.filter(r => r.group === 'Screens')).slice(0, 40);
    active = Math.min(active, Math.max(0, shown.length - 1));
    let lastGroup = '';
    fill(list, ...(shown.length ? shown.flatMap((r, i) => {
      const head = r.group !== lastGroup ? h('div', { class: 'palette-group' }, (lastGroup = r.group)) : null;
      return [head, h('div', { class: 'palette-item' + (i === active ? ' active' : ''), role: 'option', onmousedown: e => { e.preventDefault(); go(r); }, onmousemove: () => { if (active !== i) { active = i; render(); } } }, icon(r.icon), h('div', null, h('div', null, r.label), h('div', { class: 'muted small' }, r.sub)))].filter(Boolean);
    }) : [h('div', { class: 'empty' }, 'No matches for “' + q + '”')]));
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  inp.addEventListener('input', () => { active = 0; render(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); go(shown[active]); }
  });
  const recent = (st.temp.get().recentSearches || []);
  const m = modal({ title: 'Search', width: 640, cls: 'palette', body: h('div', null, inp, recent.length ? h('div', { class: 'recent' }, h('span', { class: 'muted small' }, 'Recent:'), recent.map(r => h('button', { class: 'chip', onclick: () => { inp.value = r; render(); inp.focus(); } }, r))) : null, list, h('div', { class: 'palette-foot muted small' }, '↑↓ to move · Enter to open · Esc to close')) });
  render();
  inp.focus();
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape' && modalOpen()) { e.preventDefault(); closeTopModal(); return; }
  if (e.key === 'F9') { e.preventDefault(); openCalculator(); return; }
  if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); closeWindow(); return; }
  if (modalOpen()) {
    if (mod && e.key.toLowerCase() === 's') { const btn = document.querySelector('.modal-back:last-of-type .modal-foot .btn-primary'); if (btn) { e.preventDefault(); btn.click(); } }
    return;
  }
  const hooks = getHooks();
  if (mod && e.key.toLowerCase() === 's' && hooks.save) { e.preventDefault(); hooks.save(); return; }
  if (mod && e.key.toLowerCase() === 'p' && hooks.print) { e.preventDefault(); hooks.print(); return; }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { const s = document.querySelector('[data-page-search]'); if (s) { e.preventDefault(); s.focus(); } }
});

window.addEventListener('hashchange', renderRoute);
window.addEventListener('storage', e => { if (e.key === 'wp-erp-data-v1') { st.load(); renderRoute(); } });
window.addEventListener('error', e => console.error('Unhandled', e.error || e.message));

shell();
renderRoute();
