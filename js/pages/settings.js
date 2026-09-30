import * as st from '../store.js';
import { h, today, setDecimals, fill } from '../utils.js';
import { icon, pageHeader, field, input, num, select, attempt, card, toast, confirmDialog, modal, badge } from '../ui.js';
import { download } from '../export.js';
import { setHooks, navigate, query } from '../router.js';
import { INDIAN_STATES } from './masters.js';

const SECTIONS = [['business', 'Business Profile'], ['tax', 'Tax Settings'], ['invoice', 'Invoice Settings'], ['inventory', 'Inventory Settings'], ['users', 'User Settings'], ['data', 'Data & Backup']];

export function settingsPage() {
  let sec = query().get('s') || 'business';
  const body = h('div', { class: 'settings-body' });
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' });
  const renderNav = () => fill(nav, ...SECTIONS.map(([k, l]) => h('button', { class: 'settings-link' + (k === sec ? ' active' : ''), onclick: () => { sec = k; renderNav(); render(); } }, l)));
  const render = () => { setHooks({}); fill(body, ({ business, tax, invoice, inventory, users, data })[sec]()); };
  renderNav(); render();
  return h('div', { class: 'page' }, pageHeader('Settings', [{ label: 'Settings' }]), h('div', { class: 'settings-layout' }, nav, body));
}

const saveBar = (save, extra) => h('div', { class: 'action-bar inline' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save changes'), extra, h('span', { class: 'muted small' }, 'Ctrl+S'));

function business() {
  const b = st.S().business;
  const f = { name: input({ value: b.name }), address: input({ value: b.address }), phone: input({ value: b.phone }), email: input({ value: b.email, type: 'email' }), gstin: input({ value: b.gstin, class: 'input mono', maxlength: 15 }), state: select(INDIAN_STATES, b.state) };
  const prefix = input({ value: st.S().invoice.salePrefix, maxlength: 8, class: 'input mono' });
  const save = () => {
    if (attempt(() => st.saveSettings({ business: { name: f.name.value.trim(), address: f.address.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), gstin: f.gstin.value.trim().toUpperCase(), state: f.state.value }, invoice: { ...st.S().invoice, salePrefix: prefix.value.trim().toUpperCase() } }), 'Business profile saved')) {
      document.querySelector('.brand-sub').textContent = 'for ' + st.S().business.name;
      document.querySelector('.app-title b').textContent = st.S().business.name.toUpperCase();
    }
  };
  setHooks({ save });
  return card('Business Profile', h('div', null, h('div', { class: 'form-grid cols-2' },
    field('Business name', f.name, { req: true }), field('Phone', f.phone), field('Address', f.address, { cls: 'span-2' }), field('Email', f.email),
    field('GSTIN', f.gstin, { hint: 'Printed on invoices' }), field('State', f.state, { hint: 'Parties from other states are billed with IGST' }), field('Invoice prefix', prefix, { hint: 'e.g. INV → INV/2026/0001' })), saveBar(save)));
}

function tax() {
  const t = st.S().tax;
  let rates = [...t.rates];
  const list = h('div', { class: 'chips' });
  const def = select([], t.defaultRate);
  const split = h('tbody');
  const render = () => {
    fill(list, ...rates.map(r => h('span', { class: 'chip' }, r + '%', h('button', { class: 'chip-x', 'aria-label': `Remove ${r}%`, onclick: () => { rates = rates.filter(x => x !== r); render(); } }, '×'))));
    const cur = def.value || t.defaultRate;
    fill(def, ...rates.map(r => h('option', { value: r, selected: String(r) === String(cur) }, r + '%')));
    fill(split, ...rates.map(r => h('tr', null, h('td', null, r + '%'), h('td', { class: 'num' }, r / 2 + '%'), h('td', { class: 'num' }, r / 2 + '%'), h('td', { class: 'num' }, r + '%'))));
  };
  const add = num({ min: 0, max: 40, placeholder: 'e.g. 3', class: 'input num', style: { width: '90px' } });
  const doAdd = () => { const v = +add.value; if (add.value === '' || !(v >= 0 && v <= 40)) { toast('Enter a rate between 0 and 40', 'bad'); return; } if (!rates.includes(v)) rates = [...rates, v].sort((a, b) => a - b); add.value = ''; render(); };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  render();
  const save = () => attempt(() => st.saveSettings({ tax: { rates, defaultRate: +def.value } }), 'Tax settings saved');
  setHooks({ save });
  return card('Tax Settings', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', null, 'GST rates in use'), list, h('div', { class: 'row' }, add, h('button', { class: 'btn', onclick: doAdd }, icon('plus'), 'Add rate'))),
    h('div', { class: 'form-grid cols-2' }, field('Default GST rate for new items', def)),
    h('div', null, h('h4', null, 'How each rate is split'), h('table', { class: 'tbl compact', style: { maxWidth: '480px' } }, h('thead', null, h('tr', null, h('th', null, 'GST rate'), h('th', { class: 'num' }, 'CGST (intra-state)'), h('th', { class: 'num' }, 'SGST (intra-state)'), h('th', { class: 'num' }, 'IGST (inter-state)'))), split),
      h('p', { class: 'muted small' }, `Your state is ${st.S().business.state}. Parties in the same state pay CGST + SGST; others pay IGST.`)),
    saveBar(save)));
}

function invoice() {
  const inv = st.S().invoice;
  const f = { salePrefix: input({ value: inv.salePrefix, class: 'input mono', maxlength: 8 }), purchasePrefix: input({ value: inv.purchasePrefix, class: 'input mono', maxlength: 8 }), decimals: select([[2, '2 decimals (₹1,234.50)'], [0, 'No decimals (₹1,235)']], inv.decimals), roundOff: h('input', { type: 'checkbox', checked: inv.roundOff }), creditDays: num({ value: inv.creditDays, min: 0 }) };
  const next = num({ value: (st.getState().counters.sale || 0) + 1, min: (st.getState().counters.sale || 0) + 1 });
  const preview = h('div', { class: 'hint mono' });
  const upd = () => { preview.textContent = `Next invoice: ${f.salePrefix.value.toUpperCase() || 'INV'}/${today().slice(0, 4)}/${String(+next.value || 1).padStart(4, '0')}`; };
  f.salePrefix.oninput = next.oninput = upd; upd();
  const save = () => {
    const n = +next.value, cur = st.getState().counters.sale || 0;
    if (!(n > cur)) { toast(`Next number must be greater than ${cur} (numbers already used cannot be reused)`, 'bad'); return; }
    if (attempt(() => st.saveSettings({ invoice: { salePrefix: f.salePrefix.value.trim().toUpperCase(), purchasePrefix: f.purchasePrefix.value.trim().toUpperCase(), decimals: +f.decimals.value, roundOff: f.roundOff.checked, creditDays: +f.creditDays.value || 0 } }), 'Invoice settings saved')) {
      st.getState().counters.sale = n - 1;
      st.setState(st.getState());
      setDecimals(+f.decimals.value);
    }
  };
  setHooks({ save });
  return card('Invoice Settings', h('div', null, h('div', { class: 'form-grid cols-2' },
    field('Sales invoice prefix', f.salePrefix), field('Purchase voucher prefix', f.purchasePrefix),
    field('Next sales invoice number', next, { hint: preview }), field('Default credit days', f.creditDays),
    field('Amount decimals', f.decimals, { hint: 'How amounts are shown on screens and reports' }),
    h('label', { class: 'check' }, f.roundOff, h('span', null, 'Round off bill totals to the nearest rupee'))), saveBar(save)));
}

function inventory() {
  const inv = st.S().inventory;
  const neg = h('input', { type: 'checkbox', checked: inv.allowNegative });
  const reorder = num({ value: inv.defaultReorder, min: 0 });
  const locBox = h('div', { class: 'cat-list' });
  const renderLocs = () => fill(locBox, ...st.getState().locations.map(l => h('div', { class: 'cat-row' }, h('span', null, l.name), h('span', { class: 'muted small' }, 'Stock: ' + st.getState().items.reduce((a, i) => a + Math.max(0, st.stockOf(i.id, l.id)), 0).toLocaleString('en-IN') + ' units'))));
  const newLoc = input({ placeholder: 'New location name' });
  const addLoc = () => { const n = newLoc.value.trim(); if (!n) return; if (st.getState().locations.some(l => l.name.toLowerCase() === n.toLowerCase())) { toast('Location already exists', 'bad'); return; } st.getState().locations.push({ id: 'L' + (st.getState().locations.length + 1) + Date.now().toString(36).slice(-3), name: n }); st.setState(st.getState()); newLoc.value = ''; renderLocs(); toast('Location added'); };
  renderLocs();
  const applyAll = async () => { if (!(await confirmDialog({ title: 'Apply reorder level to all items?', message: `Every item's reorder level will be set to ${reorder.value}.`, okText: 'Apply' }))) return; st.getState().items.forEach(i => { i.reorder = +reorder.value || 0; }); st.setState(st.getState()); toast('Reorder level applied to all items'); };
  const save = () => attempt(() => st.saveSettings({ inventory: { allowNegative: neg.checked, defaultReorder: +reorder.value } }), 'Inventory settings saved');
  setHooks({ save });
  return card('Inventory Settings', h('div', { class: 'stack' },
    h('label', { class: 'check' }, neg, h('span', null, 'Allow negative stock (sell or transfer more than available)')),
    h('div', { class: 'form-grid cols-2' }, field('Default reorder level for new items', reorder), h('div', { class: 'field' }, h('label', null, ' '), h('button', { class: 'btn', onclick: applyAll }, 'Apply to all items'))),
    h('div', null, h('h4', null, 'Locations'), locBox, h('div', { class: 'row' }, newLoc, h('button', { class: 'btn', onclick: addLoc }, icon('plus'), 'Add location'))),
    saveBar(save)));
}

function users() {
  const box = h('div', { class: 'stack' });
  const render = () => fill(box, ...st.getState().users.map(u => {
    const isCur = u.id === st.S().currentUserId;
    return h('div', { class: 'user-row card' },
      h('div', { class: 'avatar' }, u.name.slice(0, 1)),
      h('div', { class: 'grow' }, h('b', null, u.name), ' ', isCur ? badge('Signed in', 'ok') : null, h('div', { class: 'muted small' }, u.role), h('div', { class: 'perm-list' }, st.PERMS.filter(([k]) => u.perms[k]).map(([, l]) => h('span', { class: 'chip chip-sm' }, l)))),
      h('button', { class: 'btn btn-sm', onclick: () => userForm(u, render) }, icon('edit'), 'Edit'),
      !isCur ? h('button', { class: 'btn btn-sm', onclick: () => { st.getState().settings.currentUserId = u.id; st.setState(st.getState()); toast(`Now working as ${u.name}`, 'ok', 'Menus and screens follow this user’s permissions.'); navigate(u.perms.settings ? '/settings?s=users&u=' + Date.now() : '/'); location.reload(); } }, 'Switch to user') : null);
  }));
  render();
  return card('User Settings', h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Prototype users (no passwords). Permissions control the menu, screens and cost/profit visibility for the signed-in user.'), box, h('div', null, h('button', { class: 'btn', onclick: () => userForm(null, render) }, icon('plus'), 'Add user'))));
}

function userForm(u, done) {
  const v = u ? JSON.parse(JSON.stringify(u)) : { name: '', role: 'Staff', perms: Object.fromEntries(st.PERMS.map(([k]) => [k, false])) };
  const name = input({ value: v.name, autofocus: true }), role = input({ value: v.role, list: 'roles' });
  const boxes = st.PERMS.map(([k, l]) => { const c = h('input', { type: 'checkbox', checked: !!v.perms[k] }); return [k, h('label', { class: 'check' }, c, h('span', null, l)), c]; });
  const save = () => { if (attempt(() => st.saveUser({ ...v, name: name.value, role: role.value, perms: Object.fromEntries(boxes.map(([k, , c]) => [k, c.checked])) }), 'User saved')) { m.close(); done(); } };
  const m = modal({ title: u ? `Edit ${u.name}` : 'Add user', width: 520, body: h('div', { class: 'stack' }, h('div', { class: 'form-grid cols-2' }, field('User name', name, { req: true }), field('Role', role, { req: true })), h('datalist', { id: 'roles' }, ['Administrator', 'Accountant', 'Sales Executive', 'Store Keeper', 'Manager'].map(r => h('option', { value: r }))), h('h4', null, 'Permissions'), h('div', { class: 'perm-grid' }, boxes.map(b => b[1]))), footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: save }, 'Save user')] });
}

function data() {
  const s = st.getState();
  const counts = [['Items', s.items.length], ['Parties', s.parties.length], ['Sales', s.sales.length], ['Purchases', s.purchases.length], ['Returns', s.salesReturns.length + s.purchaseReturns.length], ['Cash entries', s.cash.length], ['Cheques', s.cheques.length], ['Purchase orders', s.pos.length]];
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileIn.onchange = async () => {
    const file = fileIn.files[0]; if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj.settings || !Array.isArray(obj.items) || !Array.isArray(obj.sales)) throw new Error('Not a backup from this application.');
      if (!(await confirmDialog({ title: 'Restore this backup?', message: `All current data will be replaced by ${file.name}.`, okText: 'Restore', danger: true }))) return;
      st.setState(obj); toast('Backup restored'); location.reload();
    } catch (e) { toast('Could not restore', 'bad', e.message); }
    fileIn.value = '';
  };
  return card('Data & Backup', h('div', { class: 'stack' },
    h('p', null, 'This prototype keeps all data in your browser (localStorage). Download a backup to move it to another computer.'),
    h('div', { class: 'kpi-grid kpi-sm' }, counts.map(([l, n]) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, l), h('div', { class: 'kpi-value' }, String(n))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', onclick: () => { download(new Blob([JSON.stringify(st.getState(), null, 1)], { type: 'application/json' }), `erp-backup-${today()}.json`); toast('Backup downloaded'); } }, icon('save'), 'Download backup'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, icon('refresh'), 'Restore from backup'), fileIn),
    h('p', { class: 'muted small' }, 'To clear search history, filters and drafts, or reset to demo data, use Clean Temp Data in the sidebar.')));
}
