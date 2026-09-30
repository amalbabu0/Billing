import * as st from '../store.js';
import { h, money, money0, today, addDays, fdate, fdateShort, sum, qty } from '../utils.js';
import { icon, kpi, card, pageHeader, dataTable, badge } from '../ui.js';
import { lineChart, barList } from '../charts.js';
import { navigate } from '../router.js';

const AV_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5'];
const initials = n => (n || '?').split(/[\s(]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avColor = n => AV_COLORS[[...(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
export const avatar = name => h('span', { class: 'avatar-sm', title: name, style: { background: avColor(name) } }, initials(name));
const avatars = names => h('div', { class: 'avatars' }, [...new Set(names)].slice(0, 4).map(avatar));
function when(dateIso, createdAt) {
  const t = today();
  const label = dateIso === t ? 'Today' : dateIso === addDays(t, -1) ? 'Yesterday' : fdateShort(dateIso);
  const c = createdAt ? new Date(createdAt) : null;
  const sameDay = c && `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}` === dateIso;
  return sameDay ? `${label} - ${c.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}` : label;
}

export function dashboard() {
  const t = today();
  const s = st.getState();
  const salesToday = st.salesInRange(t, t);
  const purToday = st.purchasesInRange(t, t);
  const low = s.items.filter(i => st.stockStatus(i) !== 'in');
  const showCost = st.can('profit');
  const debtors = st.customers().filter(c => st.partyBalance(c.id) > 0).sort((a, b) => st.partyBalance(b.id) - st.partyBalance(a.id));
  const creditors = st.suppliers().filter(c => st.partyBalance(c.id) > 0).sort((a, b) => st.partyBalance(b.id) - st.partyBalance(a.id));

  // Recent activity across all voucher types
  const txs = [
    ...st.activeSales().map(x => ({ at: x.date, c: x.createdAt, kind: 'sale', icon: 'receipt', cls: 'ri-sale', title: st.party(x.partyId)?.name, sub: `${x.no} · ${st.totals(x).lines.length} item(s)`, who: x.salesperson || '', amount: st.totals(x).grand, status: salesStatus(x), path: '/sales/' + x.id, print: x })),
    ...st.activePurchases().map(x => ({ at: x.date, c: x.createdAt, kind: 'purchase', icon: 'truck', cls: 'ri-purchase', title: st.party(x.partyId)?.name, sub: `${x.no} · bill ${x.supplierInv || '-'}`, who: 'Admin', amount: st.totals(x).grand, status: x.mode === 'credit' ? 'On credit' : 'Paid', path: '/purchases/' + x.id })),
    ...s.salesReturns.map(x => ({ at: x.date, c: x.createdAt, kind: 'return', icon: 'undo', cls: 'ri-return', title: st.party(x.partyId)?.name, sub: `${x.no} · sales return · ${x.reason}`, who: 'Admin', amount: st.totals(x).total, status: 'Returned', path: '/sales-return?view=' + x.id })),
    ...s.purchaseReturns.map(x => ({ at: x.date, c: x.createdAt, kind: 'return', icon: 'redo', cls: 'ri-return', title: st.party(x.partyId)?.name, sub: `${x.no} · purchase return · ${x.reason}`, who: 'Admin', amount: st.totals(x).total, status: 'Returned', path: '/purchase-return?view=' + x.id })),
    ...s.cash.map(x => ({ at: x.date, c: x.createdAt, kind: 'cash', icon: 'cash', cls: 'ri-cash', title: st.party(x.partyId)?.name || x.description, sub: `${x.no} · cash ${x.type}`, who: 'Admin', amount: x.amount, status: x.type === 'receipt' ? 'Received' : 'Paid out', path: '/cash?open=' + x.id })),
    ...s.cheques.map(x => ({ at: x.date, c: x.createdAt, kind: 'cheque', icon: 'cheque', cls: 'ri-cheque', title: st.party(x.partyId)?.name, sub: `Cheque #${x.chequeNo} · ${x.bank}`, who: 'Admin', amount: x.amount, status: x.status, path: '/cheques?open=' + x.id })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (b.c || 0) - (a.c || 0)));
  const latest = txs[0];

  const headline = h('div', { class: 'kpi-grid' },
    h('button', { class: 'kpi kpi-blue', onclick: () => navigate('/reports/sales-summary') }, h('div', { class: 'kpi-label' }, "Today's sales"), avatars(salesToday.map(x => st.party(x.partyId)?.name)), h('div', { class: 'kpi-sub' }, `${salesToday.length} bill(s) today`), h('div', { class: 'kpi-value' }, money(sum(salesToday, x => st.totals(x).grand)))),
    h('button', { class: 'kpi', onclick: () => navigate('/reports/receivable') }, h('div', { class: 'kpi-label' }, 'Receivable'), avatars(debtors.map(p => p.name)), h('div', { class: 'kpi-sub' }, `${debtors.length} customers owe you`), h('div', { class: 'kpi-value' }, money(st.totalReceivable()))),
    h('button', { class: 'kpi', onclick: () => navigate('/reports/payable') }, h('div', { class: 'kpi-label' }, 'Payable'), avatars(creditors.map(p => p.name)), h('div', { class: 'kpi-sub' }, `${creditors.length} suppliers to pay`), h('div', { class: 'kpi-value' }, money(st.totalPayable()))),
    latest ? h('button', { class: 'kpi kpi-accent', onclick: () => navigate(latest.path) }, h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('span', { class: 'row-icon ' + latest.cls }, icon(latest.icon)), h('div', { class: 'grow' }, h('div', { class: 'kpi-value', style: { marginTop: 0 } }, `${latest.title} — ${money(latest.amount)}`), h('div', { class: 'kpi-sub' }, latest.sub))), h('div', { class: 'kpi-label', style: { marginTop: '10px' } }, 'Latest activity'), h('div', { class: 'kpi-sub' }, when(latest.at, latest.c))) : null);

  const secondary = h('div', { class: 'kpi-grid kpi-sm' },
    kpi("Today's purchases", money(sum(purToday, p => st.totals(p).grand)), `${purToday.length} bill(s)`, null, () => navigate('/reports/purchase-summary')),
    kpi('Cash balance', money(st.cashBalance()), 'Bank ' + money0(st.bankBalance()), 'green', () => navigate('/cash')),
    showCost ? kpi('Stock value', money(st.stockValue()), 'At cost price', null, () => navigate('/stock')) : null,
    kpi('Low / out of stock', String(low.length), `${low.filter(i => st.stockStatus(i) === 'out').length} out of stock`, low.length ? 'warn' : null, () => navigate('/stock?filter=low')),
    kpi('Customers', String(st.customers().filter(c => !c.walkIn).length), 'Active accounts', null, () => navigate('/parties?tab=customer')),
    kpi('Suppliers', String(st.suppliers().length), 'Active accounts', null, () => navigate('/parties?tab=supplier')));

  const recent = dataTable({
    columns: [
      { key: 'title', label: 'Client / Transaction', render: r => h('div', { class: 'tx-title' }, h('span', { class: 'row-icon ' + r.cls }, icon(r.icon)), h('div', null, h('div', null, r.title), h('div', { class: 'tx-sub' }, r.sub))) },
      { key: 'who', label: 'Assigned', render: r => h('div', { class: 'avatars' }, avatar(r.who)) },
      { key: 'at', label: 'Timestamp', render: r => h('span', { class: 'muted' }, when(r.at, r.c)) },
      { key: 'amount', label: 'Amount / Status', type: 'money', render: r => h('span', { class: 'amount-status' }, money(r.amount), ' ', h('span', null, `(${r.status})`)) },
      { key: 'act', label: '', sortable: false, render: r => h('div', { class: 'row-actions' }, h('a', { class: 'btn-icon', href: '#' + r.path, title: 'Open', 'aria-label': 'Open ' + r.sub }, icon('link'))) },
    ],
    rows: txs.slice(0, 8), pageSize: 8, onRowClick: r => navigate(r.path), keyOf: r => r.path,
  });

  // 30-day trend
  const days = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
  const salesBy = Object.fromEntries(days.map(d => [d, 0])), purBy = Object.fromEntries(days.map(d => [d, 0]));
  st.salesInRange(days[0], t).forEach(x => { salesBy[x.date] += st.totals(x).grand; });
  st.purchasesInRange(days[0], t).forEach(p => { purBy[p.date] += st.totals(p).grand; });
  const trend = lineChart({ labels: days, label: 'Sales and purchases per day, last 30 days', series: [{ name: 'Sales', values: days.map(d => salesBy[d]), color: 'var(--series-1)' }, { name: 'Purchases', values: days.map(d => purBy[d]), color: 'var(--series-2)' }] });
  const since = addDays(t, -90);
  const byItem = {}, byCat = {};
  st.salesInRange(since, t).forEach(x => st.totals(x).lines.forEach(l => {
    const it = st.item(l.itemId);
    byItem[l.itemId] = byItem[l.itemId] || { value: 0, qty: 0 };
    byItem[l.itemId].value += l.taxable; byItem[l.itemId].qty += l.qty;
    byCat[it.category] = (byCat[it.category] || 0) + l.taxable;
  }));
  const top = Object.entries(byItem).sort((a, b) => b[1].value - a[1].value).slice(0, 6).map(([id, v]) => ({ label: st.item(id).name, value: v.value, sub: `${qty(v.qty)} ${st.item(id).unit} sold` }));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: c, value: v }));
  const quick = [['New Sale', '/sales/new', 'cart', 'sales'], ['New Purchase', '/purchases/new', 'truck', 'purchases'], ['Add Customer', '/parties?tab=customer&new=1', 'users'], ['Add Supplier', '/parties?tab=supplier&new=1', 'users'], ['Add Item', '/items?new=1', 'tag'], ['Stock Transfer', '/transfer', 'swap', 'stock'], ['Purchase Order', '/po?new=1', 'clipboard', 'purchases']];
  const quickBar = h('div', { class: 'quick' }, quick.filter(q => !q[3] || st.can(q[3])).map(([l, p, ic]) => h('a', { class: 'quick-btn', href: '#' + p }, icon(ic), l)));
  const lowList = low.slice(0, 8).map(i => h('a', { class: 'low-row', href: '#/reports/item-transaction?item=' + i.id }, h('span', { class: 'truncate' }, i.name), h('span', { class: st.stockStatus(i) === 'out' ? 't-bad' : 't-warn' }, `${qty(st.stockOf(i.id))} ${i.unit}`), h('span', { class: 'muted small' }, `reorder ${i.reorder}`)));

  return h('div', { class: 'page' },
    pageHeader('Dashboard', [], [h('span', { class: 'muted small' }, `Business date ${fdate(t)}`)], 'rupee'),
    h('div', { class: 'section-label' }, 'Key performance metrics'), headline, secondary,
    h('div', { class: 'section-label' }, 'Recent transactions & clients'), recent,
    h('div', { class: 'section-label' }, 'Quick actions'), quickBar,
    h('div', { class: 'grid-2-1' },
      card('Sales vs purchases — last 30 days', trend),
      card('Items low in stock', lowList.length ? h('div', { class: 'low-list' }, lowList) : h('div', { class: 'empty' }, 'All items above reorder level'), h('a', { href: '#/stock?filter=low', class: 'link small' }, 'View all'))),
    h('div', { class: 'grid-2' }, card('Top selling products — 90 days', barList({ rows: top })), card('Category-wise sales — 90 days', barList({ rows: cats }))));
}

function salesStatus(x) {
  const bill = st.billsOutstanding(x.partyId).bills.find(b => b.id === x.id);
  const bal = bill ? bill.balance : 0;
  return bal <= 0.004 ? 'Paid' : bal < st.totals(x).grand - 0.004 ? 'Part paid' : 'Due';
}

export function mainMenu() {
  const tiles = [
    ['Sales', 'Create invoices, hold and resume bills', '/sales', 'cart', 'sales'], ['Purchases', 'Enter supplier bills; stock goes up', '/purchases', 'truck', 'purchases'],
    ['Customers / Parties', 'Customer master, balances, GSTIN', '/parties?tab=customer', 'users'], ['Suppliers', 'Supplier master & dues', '/parties?tab=supplier', 'users'],
    ['Items', 'Item master, HSN, prices, categories', '/items', 'tag'], ['Stock', 'Stock by item and location', '/stock', 'box'],
    ['Payments', 'Pay suppliers & expenses (cash)', '/cash?type=payment', 'cash', 'accounts'], ['Receipts', 'Receive from customers (cash)', '/cash?type=receipt', 'receipt', 'accounts'],
    ['Cheques', 'Cheques received & issued', '/cheques', 'cheque', 'accounts'], ['Purchase Orders', 'Order from suppliers, receive later', '/po', 'clipboard', 'purchases'],
    ['Reports', '18 business & GST reports', '/reports', 'chart', 'reports'], ['Settings', 'Business, tax, invoice, users', '/settings', 'settings', 'settings'],
  ];
  return h('div', { class: 'page' }, pageHeader('Main Menu', [{ label: 'Main Menu' }]),
    h('div', { class: 'menu-grid' }, tiles.map(([t, d, p, ic, perm]) => {
      const allowed = !perm || st.can(perm);
      return h(allowed ? 'a' : 'div', { class: 'menu-tile' + (allowed ? '' : ' disabled'), href: allowed ? '#' + p : null, title: allowed ? null : 'No permission' }, icon(ic), h('div', null, h('b', null, t), h('div', { class: 'muted small' }, allowed ? d : 'No permission')));
    })));
}
