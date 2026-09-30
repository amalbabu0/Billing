import * as st from '../store.js';
import { h, money, money0, today, addDays, fdate, sum, qty } from '../utils.js';
import { icon, kpi, card, pageHeader, dataTable, badge } from '../ui.js';
import { lineChart, barList } from '../charts.js';
import { navigate } from '../router.js';

export function dashboard() {
  const t = today();
  const salesToday = st.salesInRange(t, t);
  const purToday = st.purchasesInRange(t, t);
  const low = st.getState().items.filter(i => st.stockStatus(i) !== 'in');
  const showCost = st.can('profit');

  const kpis = h('div', { class: 'kpi-grid' },
    kpi("Today's Sales", money(sum(salesToday, s => st.totals(s).grand)), `${salesToday.length} bill(s)`, 'blue', () => navigate('/reports/sales-summary')),
    kpi("Today's Purchases", money(sum(purToday, p => st.totals(p).grand)), `${purToday.length} bill(s)`, null, () => navigate('/reports/purchase-summary')),
    kpi('Cash Balance', money(st.cashBalance()), 'Bank ' + money0(st.bankBalance()), 'green', () => navigate('/cash')),
    kpi('Receivable', money(st.totalReceivable()), 'From customers', null, () => navigate('/reports/receivable')),
    kpi('Payable', money(st.totalPayable()), 'To suppliers', null, () => navigate('/reports/payable')),
    showCost ? kpi('Stock Value', money(st.stockValue()), 'At cost price', null, () => navigate('/stock')) : null,
    kpi('Low / Out of Stock', String(low.length), `${low.filter(i => st.stockStatus(i) === 'out').length} out of stock`, low.length ? 'warn' : null, () => navigate('/stock?filter=low')),
    kpi('Customers', String(st.customers().filter(c => !c.walkIn).length), 'Active parties', null, () => navigate('/parties?tab=customer')),
    kpi('Suppliers', String(st.suppliers().length), 'Active parties', null, () => navigate('/parties?tab=supplier')));

  // 30-day trend
  const days = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
  const salesBy = Object.fromEntries(days.map(d => [d, 0])), purBy = Object.fromEntries(days.map(d => [d, 0]));
  st.salesInRange(days[0], t).forEach(s => { salesBy[s.date] += st.totals(s).grand; });
  st.purchasesInRange(days[0], t).forEach(p => { purBy[p.date] += st.totals(p).grand; });
  const trend = lineChart({ labels: days, label: 'Sales and purchases per day, last 30 days', series: [{ name: 'Sales', values: days.map(d => salesBy[d]), color: 'var(--series-1)' }, { name: 'Purchases', values: days.map(d => purBy[d]), color: 'var(--series-2)' }] });

  // Top products & categories (last 90 days, taxable value)
  const since = addDays(t, -90);
  const byItem = {}, byCat = {};
  st.salesInRange(since, t).forEach(s => st.totals(s).lines.forEach(l => {
    const it = st.item(l.itemId);
    byItem[l.itemId] = byItem[l.itemId] || { value: 0, qty: 0 };
    byItem[l.itemId].value += l.taxable; byItem[l.itemId].qty += l.qty;
    byCat[it.category] = (byCat[it.category] || 0) + l.taxable;
  }));
  const top = Object.entries(byItem).sort((a, b) => b[1].value - a[1].value).slice(0, 6).map(([id, v]) => ({ label: st.item(id).name, value: v.value, sub: `${qty(v.qty)} ${st.item(id).unit} sold` }));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: c, value: v }));

  // Recent activity
  const s = st.getState();
  const recent = (list, cols, onClick) => dataTable({ columns: cols, rows: list, pageSize: 6, onRowClick: onClick, empty: 'Nothing yet' });
  const recentSales = recent([...st.activeSales()].reverse().slice(0, 6), [
    { key: 'no', label: 'Invoice', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'party', label: 'Customer', value: r => st.party(r.partyId)?.name },
    { key: 'date', label: 'Date', type: 'date' }, { key: 'amt', label: 'Amount', type: 'money', value: r => st.totals(r).grand },
  ], r => navigate('/sales/' + r.id));
  const recentPur = recent([...st.activePurchases()].reverse().slice(0, 6), [
    { key: 'no', label: 'Purchase', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'party', label: 'Supplier', value: r => st.party(r.partyId)?.name },
    { key: 'date', label: 'Date', type: 'date' }, { key: 'amt', label: 'Amount', type: 'money', value: r => st.totals(r).grand },
  ], r => navigate('/purchases/' + r.id));
  const returns = [...s.salesReturns.map(r => ({ ...r, kind: 'Sales Return' })), ...s.purchaseReturns.map(r => ({ ...r, kind: 'Purchase Return' }))].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const recentRet = recent(returns, [
    { key: 'no', label: 'Return', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'kind', label: 'Type', render: r => badge(r.kind, r.kind === 'Sales Return' ? 'info' : 'muted') },
    { key: 'party', label: 'Party', value: r => st.party(r.partyId)?.name }, { key: 'amt', label: 'Value', type: 'money', value: r => st.totals(r).total },
  ], r => navigate((r.kind === 'Sales Return' ? '/sales-return?view=' : '/purchase-return?view=') + r.id));
  const payments = [...s.cash.map(c => ({ id: c.id, no: c.no, date: c.date, kind: c.type === 'receipt' ? 'Cash Receipt' : 'Cash Payment', party: st.party(c.partyId)?.name || c.description, amount: c.amount, path: '/cash' })),
    ...s.cheques.map(c => ({ id: c.id, no: c.no, date: c.date, kind: `Cheque ${c.type} · ${c.status}`, party: st.party(c.partyId)?.name, amount: c.amount, path: '/cheques' }))].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const recentPay = recent(payments, [
    { key: 'no', label: 'Voucher', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'kind', label: 'Type' }, { key: 'party', label: 'Party' }, { key: 'amount', label: 'Amount', type: 'money' },
  ], r => navigate(r.path));

  const quick = [['New Sale', '/sales/new', 'cart', 'sales'], ['New Purchase', '/purchases/new', 'truck', 'purchases'], ['Add Customer', '/parties?tab=customer&new=1', 'users'], ['Add Supplier', '/parties?tab=supplier&new=1', 'users'], ['Add Item', '/items?new=1', 'tag'], ['Stock Transfer', '/transfer', 'swap', 'stock'], ['Purchase Order', '/po?new=1', 'clipboard', 'purchases']];
  const quickBar = h('div', { class: 'quick' }, quick.filter(q => !q[3] || st.can(q[3])).map(([l, p, ic]) => h('a', { class: 'quick-btn', href: '#' + p }, icon(ic), l)));

  const lowList = low.slice(0, 8).map(i => h('a', { class: 'low-row', href: '#/reports/item-transaction?item=' + i.id }, h('span', { class: 'truncate' }, i.name), h('span', { class: st.stockStatus(i) === 'out' ? 't-bad' : 't-warn' }, `${qty(st.stockOf(i.id))} ${i.unit}`), h('span', { class: 'muted small' }, `reorder ${i.reorder}`)));

  return h('div', { class: 'page' },
    pageHeader('Dashboard', [], [h('span', { class: 'muted small' }, `Business date ${fdate(t)}`)]),
    quickBar, kpis,
    h('div', { class: 'grid-2-1' },
      card('Sales vs purchases — last 30 days', trend),
      card('Items low in stock', lowList.length ? h('div', { class: 'low-list' }, lowList) : h('div', { class: 'empty' }, 'All items above reorder level'), h('a', { href: '#/stock?filter=low', class: 'link small' }, 'View all'))),
    h('div', { class: 'grid-2' },
      card('Top selling products — 90 days', barList({ rows: top })),
      card('Category-wise sales — 90 days', barList({ rows: cats }))),
    h('div', { class: 'grid-2' }, card('Recent sales', recentSales, h('a', { href: '#/sales', class: 'link small' }, 'All sales')), card('Recent purchases', recentPur, h('a', { href: '#/purchases', class: 'link small' }, 'All purchases'))),
    h('div', { class: 'grid-2' }, card('Recent returns', recentRet), card('Recent payments & receipts', recentPay)));
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
