import * as st from '../store.js';
import { h, matches, qty, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, modal, field, input, num, select, attempt, statusBadge, exportButtons, badge } from '../ui.js';
import { query, navigate, onMounted } from '../router.js';

const INDIAN_STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
export { INDIAN_STATES };
const canEdit = () => st.can('settings') || st.can('sales') || st.can('purchases');
const UNITS = ['Nos', 'Sheet', 'Sq.ft', 'Cft', 'Rft', 'Pair', 'Box', 'Kg', 'Ltr', 'Set'];

// ---------------------------------------------------------------- items
export function itemsPage() {
  const s = st.getState();
  const showCost = st.can('profit');
  let q = '', cat = '';
  const cols = [
    { key: 'code', label: 'Code', render: r => h('span', { class: 'mono' }, r.code) },
    { key: 'name', label: 'Item Name' }, { key: 'category', label: 'Category' }, { key: 'hsn', label: 'HSN' }, { key: 'unit', label: 'Unit' },
    { key: 'gst', label: 'GST %', type: 'qty' },
    ...(showCost ? [{ key: 'cost', label: 'Cost', type: 'money' }] : []),
    { key: 'price', label: 'Selling Price', type: 'money' },
    { key: 'stock', label: 'Stock', type: 'qty', value: r => st.stockOf(r.id) },
    { key: 'reorder', label: 'Reorder', type: 'qty' },
    { key: 'status', label: 'Status', value: r => st.stockStatus(r), render: r => statusBadge(st.stockStatus(r)) },
  ];
  const table = dataTable({ columns: cols, onRowClick: r => (canEdit() ? editItem(r) : navigate('/reports/item-transaction?item=' + r.id)) });
  const refresh = () => table.setRows(st.getState().items.filter(i => (!cat || i.category === cat) && matches(q, i.code, i.name, i.hsn, i.category)));
  const catSel = select([['', 'All categories'], ...s.categories.map(c => [c, c])], '', { onchange: e => { cat = e.target.value; refresh(); }, 'aria-label': 'Category' });
  const ex = exportButtons(() => table.exportTable('Item Master', cat || 'All categories'));
  const editItem = it => itemForm(it, () => { refresh(); });
  const el = h('div', { class: 'page' },
    pageHeader('Items', [{ label: 'Items' }], [
      canEdit() ? h('button', { class: 'btn', onclick: () => categoryManager(() => { fill(catSel, ...[['', 'All categories'], ...st.getState().categories.map(c => [c, c])].map(([v, l]) => h('option', { value: v }, l))); refresh(); }) }, icon('layers'), 'Categories') : null,
      canEdit() ? h('button', { class: 'btn btn-primary', onclick: () => editItem(null) }, icon('plus'), 'Add Item') : null]),
    h('div', { class: 'toolbar' }, searchBox({ placeholder: 'Search code, name, HSN… ( / )', onInput: v => { q = v; refresh(); }, autofocus: true }), catSel, h('div', { class: 'grow' }), ex.el),
    table);
  refresh();
  if (query().get('new')) onMounted(() => editItem(null));
  return el;
}

export function itemForm(it, onSaved) {
  const s = st.getState();
  const v = it ? { ...it } : { code: '', name: '', category: s.categories[0] || '', hsn: '', unit: 'Nos', gst: s.settings.tax.defaultRate, cost: 0, price: 0, reorder: s.settings.inventory.defaultReorder, opening: {} };
  const f = {
    code: input({ value: v.code, autofocus: true, maxlength: 20 }), name: input({ value: v.name }),
    category: select(s.categories, v.category), hsn: input({ value: v.hsn, inputmode: 'numeric', maxlength: 8 }), unit: select(UNITS, v.unit),
    gst: select(s.settings.tax.rates.map(r => [r, r + '%']), v.gst), cost: num({ value: v.cost, min: 0 }), price: num({ value: v.price, min: 0 }), reorder: num({ value: v.reorder, min: 0 }),
  };
  const opening = s.locations.map(l => [l.id, num({ value: v.opening?.[l.id] || 0, min: 0 })]);
  const margin = h('div', { class: 'hint' });
  const upd = () => { const c = +f.cost.value, p = +f.price.value; margin.textContent = p > 0 ? `Margin ${(((p - c) / p) * 100).toFixed(1)}% on selling price` : ''; };
  f.cost.oninput = f.price.oninput = upd; upd();
  const save = () => {
    const rec = attempt(() => st.saveItem({ ...v, code: f.code.value, name: f.name.value, category: f.category.value, hsn: f.hsn.value.trim(), unit: f.unit.value, gst: +f.gst.value, cost: +f.cost.value, price: +f.price.value, reorder: +f.reorder.value, opening: it ? v.opening : Object.fromEntries(opening.map(([id, i]) => [id, +i.value || 0])) }), r => `Item ${r.code} saved`);
    if (rec) { m.close(); onSaved?.(rec); }
  };
  const m = modal({
    title: it ? `Edit ${it.code}` : 'Add Item', width: 640,
    body: h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); save(); } },
      field('Item code', f.code, { req: true }), field('Item name', f.name, { req: true, cls: 'span-2' }),
      field('Category', f.category), field('HSN code', f.hsn, { hint: '4–8 digits' }), field('Unit', f.unit),
      field('GST rate', f.gst), field('Cost price (₹)', f.cost), field('Selling price (₹)', f.price, { hint: margin }),
      field('Reorder level', f.reorder),
      !it ? h('div', { class: 'span-3 subhead' }, 'Opening stock by location') : null,
      !it ? opening.map(([id, i]) => field(st.location(id).name, i)) : null,
      it ? h('div', { class: 'span-3 hint' }, `Current stock ${qty(st.stockOf(it.id))} ${it.unit}. Stock changes only through purchases, sales, returns, stock entry and transfers.`) : null,
      h('button', { type: 'submit', hidden: true })),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save item')],
  });
}

function categoryManager(onChange) {
  const listEl = h('div', { class: 'cat-list' });
  const render = () => fill(listEl, ...st.getState().categories.map(c => {
    const count = st.getState().items.filter(i => i.category === c).length;
    return h('div', { class: 'cat-row' }, h('span', null, c, h('span', { class: 'muted small' }, ` · ${count} item(s)`)),
      h('button', { class: 'btn btn-sm', onclick: () => renameCategory(c, () => { render(); onChange(); }) }, 'Rename'),
      h('button', { class: 'btn btn-sm', disabled: count > 0, title: count ? 'Has items' : 'Delete', onclick: () => { if (attempt(() => st.deleteCategory(c), 'Category deleted')) { render(); onChange(); } } }, icon('trash')));
  }));
  const add = input({ placeholder: 'New category name' });
  const doAdd = () => { if (attempt(() => st.saveCategory(add.value), 'Category added')) { add.value = ''; render(); onChange(); } };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  render();
  const m = modal({ title: 'Categories', width: 480, body: h('div', { class: 'stack' }, h('div', { class: 'row' }, add, h('button', { class: 'btn btn-primary', onclick: doAdd }, icon('plus'), 'Add')), listEl), footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Done')] });
}

function renameCategory(old, done) {
  const inp = input({ value: old, autofocus: true });
  const save = () => { if (inp.value.trim() === old) { m.close(); return; } if (attempt(() => st.saveCategory(inp.value, old), 'Category renamed')) { m.close(); done(); } };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const m = modal({ title: 'Rename category', width: 400, body: field('Category name', inp, { req: true }), footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Rename')] });
}

// ---------------------------------------------------------------- parties & agents
export function partiesPage() {
  let tab = query().get('tab') || 'customer';
  let q = '';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  let table, ex;
  const tabDefs = [['customer', 'Customers'], ['supplier', 'Suppliers'], ['agent', 'Agents']];
  const buildTable = () => {
    if (tab === 'agent') {
      table = dataTable({
        columns: [{ key: 'name', label: 'Agent' }, { key: 'phone', label: 'Phone' }, { key: 'commission', label: 'Commission %', type: 'qty' },
          { key: 'bills', label: 'Bills', type: 'qty', value: r => st.activeSales().filter(s => s.agentId === r.id).length },
          { key: 'sales', label: 'Sales (taxable)', type: 'money', value: r => st.activeSales().filter(s => s.agentId === r.id).reduce((a, s) => a + st.totals(s).taxable, 0) }],
        onRowClick: r => canEdit() && agentForm(r, refresh),
      });
    } else {
      table = dataTable({
        columns: [
          { key: 'name', label: tab === 'customer' ? 'Customer' : 'Supplier', render: r => h('span', null, r.name, r.walkIn ? badge('Walk-in', 'muted') : null) },
          { key: 'gstin', label: 'GSTIN', render: r => h('span', { class: 'mono' }, r.gstin || '—') }, { key: 'state', label: 'State' }, { key: 'phone', label: 'Phone' },
          { key: 'creditDays', label: 'Credit days', type: 'qty' },
          { key: 'balance', label: tab === 'customer' ? 'Receivable' : 'Payable', type: 'money', value: r => st.partyBalance(r.id), total: true },
          { key: 'act', label: '', sortable: false, export: false, render: r => h('a', { class: 'btn btn-sm', href: '#/party-report?party=' + r.id }, 'Ledger') },
        ],
        onRowClick: r => (canEdit() ? partyForm(r, tab, refresh) : navigate('/party-report?party=' + r.id)),
      });
    }
    ex = exportButtons(() => table.exportTable(tabDefs.find(t => t[0] === tab)[1], ''));
  };
  const refresh = () => {
    const s = st.getState();
    table.setRows(tab === 'agent' ? s.agents.filter(a => matches(q, a.name, a.phone)) : s.parties.filter(p => p.type === tab && matches(q, p.name, p.gstin, p.phone, p.state, p.address)));
  };
  const renderTab = () => {
    fill(tabs, ...tabDefs.map(([k, l]) => h('button', { role: 'tab', class: 'tab' + (k === tab ? ' active' : ''), 'aria-selected': k === tab, onclick: () => { tab = k; renderTab(); } }, l)));
    buildTable();
    fill(body, 
      h('div', { class: 'toolbar' }, searchBox({ placeholder: 'Search name, GSTIN, phone… ( / )', value: q, onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el,
        canEdit() ? h('button', { class: 'btn btn-primary', onclick: () => (tab === 'agent' ? agentForm(null, refresh) : partyForm(null, tab, refresh)) }, icon('plus'), tab === 'customer' ? 'Add Customer' : tab === 'supplier' ? 'Add Supplier' : 'Add Agent') : null),
      table);
    refresh();
  };
  renderTab();
  if (query().get('new')) onMounted(() => partyForm(null, tab, refresh));
  return h('div', { class: 'page' }, pageHeader('Parties', [{ label: 'Parties' }]), tabs, body);
}

export function partyForm(p, type, onSaved) {
  const v = p ? { ...p } : { type, name: '', gstin: '', state: st.S().business.state, phone: '', address: '', opening: 0, creditDays: type === 'customer' ? 30 : 30 };
  const f = { name: input({ value: v.name, autofocus: true }), gstin: input({ value: v.gstin, maxlength: 15, class: 'input mono' }), state: select(INDIAN_STATES, v.state), phone: input({ value: v.phone, inputmode: 'tel' }), address: input({ value: v.address }), opening: num({ value: v.opening }), creditDays: num({ value: v.creditDays, min: 0 }) };
  f.gstin.addEventListener('input', () => {
    const code = f.gstin.value.slice(0, 2);
    const map = { '32': 'Kerala', '33': 'Tamil Nadu', '29': 'Karnataka', '24': 'Gujarat', '27': 'Maharashtra', '07': 'Delhi', '36': 'Telangana', '37': 'Andhra Pradesh', '19': 'West Bengal', '09': 'Uttar Pradesh', '08': 'Rajasthan', '30': 'Goa' };
    if (map[code]) f.state.value = map[code];
  });
  const save = () => {
    const rec = attempt(() => st.saveParty({ ...v, name: f.name.value, gstin: f.gstin.value.trim(), state: f.state.value, phone: f.phone.value.trim(), address: f.address.value.trim(), opening: +f.opening.value || 0, creditDays: +f.creditDays.value || 0 }), r => `${r.name} saved`);
    if (rec) { m.close(); onSaved?.(rec); }
  };
  const m = modal({
    title: p ? `Edit ${p.name}` : `Add ${v.type === 'customer' ? 'Customer' : 'Supplier'}`, width: 620,
    body: h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); save(); } },
      field('Name', f.name, { req: true, cls: 'span-2' }), field('Phone', f.phone),
      field('GSTIN', f.gstin, { hint: 'Leave empty for unregistered (B2C)' }), field('State', f.state, { hint: 'Decides CGST+SGST or IGST' }), field('Credit days', f.creditDays),
      field('Address', f.address, { cls: 'span-2' }), field(`Opening balance (₹)`, f.opening, { hint: v.type === 'customer' ? 'Positive = customer owes you' : 'Positive = you owe supplier' }),
      h('button', { type: 'submit', hidden: true })),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save')],
  });
}

function agentForm(a, onSaved) {
  const v = a ? { ...a } : { name: '', phone: '', commission: 2 };
  const f = { name: input({ value: v.name, autofocus: true }), phone: input({ value: v.phone }), commission: num({ value: v.commission, min: 0, max: 100 }) };
  const save = () => { const rec = attempt(() => st.saveAgent({ ...v, name: f.name.value, phone: f.phone.value.trim(), commission: +f.commission.value }), r => `${r.name} saved`); if (rec) { m.close(); onSaved?.(); } };
  const m = modal({ title: a ? `Edit ${a.name}` : 'Add Agent', width: 480, body: h('form', { class: 'form-grid cols-2', onsubmit: e => { e.preventDefault(); save(); } }, field('Name', f.name, { req: true, cls: 'span-2' }), field('Phone', f.phone), field('Commission %', f.commission, { hint: 'On net taxable sales' }), h('button', { type: 'submit', hidden: true })), footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Save')] });
}
