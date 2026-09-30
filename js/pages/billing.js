import * as st from '../store.js';
import { h, money, amt, qty, today, fdate, matches, inWords, esc, monthStart, inRange, round2, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, field, input, num, select, dateInput, combo, attempt, badge, statusBadge, exportButtons, confirmDialog, toast, card } from '../ui.js';
import { printNow } from '../export.js';
import { navigate, query, setHooks } from '../router.js';
import { partyForm } from './masters.js';

const MODES_SALE = [['cash', 'Cash'], ['card', 'Card'], ['upi', 'UPI'], ['bank', 'Bank'], ['credit', 'Credit']];
const MODES_PUR = [['cash', 'Cash'], ['bank', 'Bank'], ['credit', 'Credit']];
export const modeLabel = m => ({ cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank', credit: 'Credit', cheque: 'Cheque' }[m] || m || '');

const itemOptions = () => st.getState().items.map(i => ({ value: i.id, label: i.name, sub: `${i.code} · HSN ${i.hsn} · stock ${qty(st.stockOf(i.id))} ${i.unit} · ₹${amt(i.price)}`, search: i.code + ' ' + i.hsn }));
const partyOptions = type => () => st.getState().parties.filter(p => p.type === type).map(p => ({ value: p.id, label: p.name, sub: [p.gstin || 'Unregistered', p.state, p.phone].filter(Boolean).join(' · ') }));

// ---------------------------------------------------------------- line grid
function lineGrid({ kind, doc, onChange }) {
  const body = h('tbody');
  const table = h('table', { class: 'tbl grid-edit' }, h('thead', null, h('tr', null,
    h('th', { style: { width: '34px' } }, '#'), h('th', null, 'Item'), h('th', null, 'HSN'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, kind === 'sale' ? 'Rate' : 'Purchase Rate'),
    h('th', { class: 'num' }, 'Disc %'), h('th', { class: 'num' }, 'GST %'), h('th', { class: 'num' }, 'Amount'), h('th', { style: { width: '36px' } }, ''))), body);
  const rates = st.S().tax.rates;
  const render = () => {
    const inter = st.isInterstate(st.party(doc.partyId));
    fill(body, ...doc.lines.map((l, i) => {
      const it = st.item(l.itemId);
      const c = st.lineCalc(l, inter);
      const avail = it && kind === 'sale' ? st.stockOf(it.id, doc.location) : null;
      const itemCombo = combo({
        options: itemOptions, value: l.itemId, placeholder: 'Item name or code…',
        onChange: id => { const x = st.item(id); Object.assign(l, { itemId: id, rate: kind === 'sale' ? x.price : x.cost, gst: x.gst, qty: l.qty || 1 }); if (i === doc.lines.length - 1) doc.lines.push(blank()); render(); onChange(); setTimeout(() => body.querySelectorAll('tr')[i]?.querySelector('.q')?.select(), 0); },
      });
      const numCell = (key, cls, attrs = {}) => {
        const inp = num({ value: l[key], class: 'input num ' + cls, min: 0, ...attrs, 'aria-label': key + ' row ' + (i + 1) });
        inp.addEventListener('input', () => { l[key] = inp.value === '' ? '' : +inp.value; amount.textContent = amt(st.lineCalc(l, inter).total); warn(); onChange(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const next = inp.closest('td').nextElementSibling?.querySelector('input,select'); if (next) next.focus(); else body.querySelectorAll('tr')[i + 1]?.querySelector('.combo-input')?.focus(); } });
        return inp;
      };
      const amount = h('span', null, amt(c.total));
      const stockHint = h('div', { class: 'cell-hint' });
      const warn = () => { if (avail == null) return; stockHint.textContent = `avail ${qty(avail)}`; stockHint.className = 'cell-hint' + ((+l.qty || 0) > avail ? ' t-bad' : ''); };
      warn();
      const gstSel = select(rates.map(r => [r, r + '%']), l.gst, { class: 'input num', 'aria-label': 'GST row ' + (i + 1), onchange: e => { l.gst = +e.target.value; amount.textContent = amt(st.lineCalc(l, inter).total); onChange(); } });
      return h('tr', null, h('td', { class: 'muted row-no' }, i + 1), h('td', { class: 'item-cell' }, itemCombo), h('td', { class: 'mono small', 'data-label': 'HSN' }, it?.hsn || ''),
        h('td', { class: 'num', 'data-label': 'Qty' }, numCell('qty', 'q', { step: 'any' }), it ? h('div', { class: 'cell-hint' }, it.unit) : null, stockHint),
        h('td', { class: 'num', 'data-label': 'Rate' }, numCell('rate', 'r')), h('td', { class: 'num', 'data-label': 'Disc %' }, numCell('disc', 'd', { max: 100 })), h('td', { class: 'num', 'data-label': 'GST %' }, gstSel),
        h('td', { class: 'num strong', 'data-label': 'Amount' }, amount),
        h('td', null, doc.lines.length > 1 ? h('button', { class: 'btn-icon', 'aria-label': 'Remove row ' + (i + 1), title: 'Remove row', onclick: () => { doc.lines.splice(i, 1); render(); onChange(); } }, icon('trash')) : null));
    }));
  };
  const blank = () => ({ itemId: '', qty: 1, rate: 0, disc: 0, gst: st.S().tax.defaultRate });
  if (!doc.lines.length || doc.lines[doc.lines.length - 1].itemId) doc.lines.push(blank());
  render();
  const wrap = h('div', { class: 'tbl-wrap grid-wrap' }, table);
  wrap.render = render;
  wrap.addRow = () => { doc.lines.push(blank()); render(); body.lastElementChild?.querySelector('.combo-input')?.focus(); };
  return wrap;
}

function totalsPanel(doc) {
  const el = h('div', { class: 'totals' });
  el.update = () => {
    const t = st.docTotals(doc);
    const rows = [['Subtotal', t.subtotal], ['Discount', -t.discount], ['Taxable value', t.taxable]];
    if (t.interstate) rows.push(['IGST', t.igst]); else rows.push(['CGST', t.cgst], ['SGST', t.sgst]);
    rows.push(['Round off', t.roundOff]);
    fill(el, ...rows.map(([k, v]) => h('div', { class: 'tot-row' }, h('span', null, k), h('span', null, amt(v)))),
      h('div', { class: 'tot-row grand' }, h('span', null, 'Grand Total'), h('span', null, money(t.grand))),
      h('div', { class: 'muted small' }, `${t.lines.filter(l => l.itemId).length} item(s) · qty ${qty(t.qty)} · ${t.interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}`));
    return t;
  };
  return el;
}

// ---------------------------------------------------------------- sale form
export function saleForm(params = {}) {
  const s = st.getState();
  const held = params.id && s.sales.find(x => x.id === params.id && x.status === 'held');
  const draftKey = 'draft-sale';
  const saved = !held && st.temp.get()[draftKey];
  const doc = held ? JSON.parse(JSON.stringify(held)) : saved ? saved : { date: today(), partyId: 'pt_cash', agentId: '', salesperson: st.currentUser().name, mode: 'cash', paid: '', location: 'L1', lines: [], notes: '' };
  if (held) doc.lines = doc.lines.map(l => ({ ...l }));
  const persist = () => { if (!held) st.temp.set(draftKey, { ...doc, lines: doc.lines.filter(l => l.itemId) }); };

  const partyC = combo({ options: partyOptions('customer'), value: doc.partyId, onChange: v => { doc.partyId = v; changed(); grid.render(); }, autofocus: true, placeholder: 'Customer name, GSTIN or phone…' });
  const dateI = dateInput({ value: doc.date, max: today(), onchange: e => { doc.date = e.target.value; persist(); } });
  const agentS = select([['', '— None —'], ...s.agents.map(a => [a.id, a.name])], doc.agentId, { onchange: e => { doc.agentId = e.target.value; persist(); } });
  const spS = select(s.users.map(u => [u.name, u.name]), doc.salesperson, { onchange: e => { doc.salesperson = e.target.value; persist(); } });
  const locS = select(s.locations.map(l => [l.id, l.name]), doc.location, { onchange: e => { doc.location = e.target.value; grid.render(); persist(); } });
  const paidI = num({ min: 0, value: doc.mode === 'credit' ? doc.paid || 0 : '', placeholder: 'Full amount', oninput: e => { doc.paid = e.target.value; persist(); } });
  const modes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Payment mode' });
  const renderModes = () => fill(modes, ...MODES_SALE.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': doc.mode === k, class: doc.mode === k ? 'on' : '', onclick: () => { doc.mode = k; doc.paid = k === 'credit' ? 0 : ''; paidI.value = k === 'credit' ? 0 : ''; paidI.disabled = k !== 'credit'; renderModes(); changed(); } }, l)));
  renderModes(); paidI.disabled = doc.mode !== 'credit';
  const notesI = input({ value: doc.notes, placeholder: 'Notes / delivery instructions', oninput: e => { doc.notes = e.target.value; persist(); } });
  const tot = totalsPanel(doc);
  const balanceInfo = h('div', { class: 'party-info' });
  const changed = () => {
    const t = tot.update();
    const p = st.party(doc.partyId);
    fill(balanceInfo, p ? h('span', null, p.walkIn ? 'Walk-in customer · full payment required' : `${p.gstin || 'Unregistered'} · ${p.state} · balance ${money(st.partyBalance(p.id))}`) : '');
    if (doc.mode !== 'credit') paidI.placeholder = amt(t.grand);
    persist();
  };
  const grid = lineGrid({ kind: 'sale', doc, onChange: changed });
  changed();

  const doSave = (print = false) => {
    const rec = attempt(() => st.saveSale(doc), r => `Invoice ${r.no} saved`);
    if (!rec) return;
    st.temp.set(draftKey, null);
    if (print) printNow(invoiceHtml('sale', rec));
    navigate('/sales/' + rec.id);
  };
  const doHold = () => { const rec = attempt(() => st.saveSale(doc, { hold: true }), r => `Bill held as ${r.no}`); if (rec) { st.temp.set(draftKey, null); navigate('/sales?status=held'); } };
  const doClear = async () => { if (!(await confirmDialog({ title: 'Clear this bill?', message: 'All items and details entered will be removed.', okText: 'Clear' }))) return; st.temp.set(draftKey, null); navigate('/sales/new?fresh=' + Date.now()); };
  const doCancel = () => { st.temp.set(draftKey, null); navigate('/sales'); };
  setHooks({ save: () => doSave(false), print: () => doSave(true) });

  return h('div', { class: 'page' },
    pageHeader(held ? `Resume ${held.no}` : 'New Sale', [{ label: 'Sales', href: '#/sales' }, { label: held ? held.no : 'New' }], [h('span', { class: 'muted small' }, 'Ctrl+S save · Ctrl+P save & print · Enter moves to next cell')]),
    saved && !held && saved.lines?.length ? h('div', { class: 'notice' }, icon('refresh'), 'Unsaved draft restored from your last session.', h('button', { class: 'btn btn-sm', onclick: () => { st.temp.set(draftKey, null); navigate('/sales/new?fresh=' + Date.now()); } }, 'Discard draft')) : null,
    h('div', { class: 'card form-card' },
      h('div', { class: 'form-grid cols-4' },
        field('Invoice No.', input({ value: held ? 'Assigned on save' : st.peekNo('sale', st.S().invoice.salePrefix), readOnly: true, class: 'input mono', tabindex: '-1' })),
        field('Date', dateI, { req: true }),
        h('div', { class: 'field span-2' }, h('label', null, 'Customer ', h('span', { class: 'req' }, '*')), h('div', { class: 'row' }, partyC, h('button', { class: 'btn', type: 'button', title: 'Add customer', onclick: () => partyForm(null, 'customer', p => { doc.partyId = p.id; partyC.setValue(p.id); changed(); }) }, icon('plus'))), balanceInfo),
        field('Salesperson', spS), field('Agent', agentS), field('Stock from', locS), field('Notes', notesI))),
    h('div', { class: 'card' }, grid, h('div', { class: 'grid-foot' }, h('button', { class: 'btn btn-sm', onclick: () => grid.addRow() }, icon('plus'), 'Add row'))),
    h('div', { class: 'bill-foot' },
      h('div', { class: 'card pay-card' }, h('h3', null, 'Payment'), modes, field('Amount received now (₹)', paidI, { hint: 'For credit bills enter any advance; other modes collect the full amount.' })),
      h('div', { class: 'card' }, tot)),
    h('div', { class: 'action-bar' },
      h('button', { class: 'btn btn-primary', onclick: () => doSave(false) }, icon('save'), 'Save'),
      h('button', { class: 'btn', onclick: () => doSave(true) }, icon('print'), 'Save & Print'),
      h('button', { class: 'btn', onclick: doHold }, icon('pause'), 'Hold'),
      h('button', { class: 'btn', onclick: doClear }, icon('refresh'), 'Clear'),
      h('button', { class: 'btn btn-ghost', onclick: doCancel }, 'Cancel')));
}

// ---------------------------------------------------------------- purchase form
export function purchaseForm() {
  const s = st.getState();
  const po = query().get('po') && s.pos.find(x => x.id === query().get('po'));
  const doc = { date: today(), partyId: po?.partyId || '', supplierInv: '', terms: po ? st.party(po.partyId).creditDays : 30, mode: 'credit', paid: 0, location: 'L1', lines: [], notes: '', poId: po?.id };
  if (po) doc.lines = po.lines.filter(l => l.qty > (l.received || 0)).map(l => ({ itemId: l.itemId, qty: round2(l.qty - (l.received || 0)), rate: l.rate, disc: 0, gst: st.item(l.itemId).gst }));
  const partyC = combo({ options: partyOptions('supplier'), value: doc.partyId, onChange: v => { doc.partyId = v; doc.terms = st.party(v).creditDays || 0; termsI.value = doc.terms; changed(); grid.render(); }, autofocus: !po, placeholder: 'Supplier name or GSTIN…' });
  const termsI = num({ value: doc.terms, min: 0, oninput: e => { doc.terms = e.target.value; } });
  const paidI = num({ min: 0, value: 0, oninput: e => { doc.paid = e.target.value; } });
  const modes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Payment mode' });
  const renderModes = () => fill(modes, ...MODES_PUR.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': doc.mode === k, class: doc.mode === k ? 'on' : '', onclick: () => { doc.mode = k; doc.paid = k === 'credit' ? 0 : ''; paidI.value = k === 'credit' ? 0 : ''; paidI.disabled = k !== 'credit'; renderModes(); changed(); } }, l)));
  renderModes();
  const tot = totalsPanel(doc);
  const info = h('div', { class: 'party-info' });
  const changed = () => { const t = tot.update(); const p = st.party(doc.partyId); info.textContent = p ? `${p.gstin || 'Unregistered'} · ${p.state} · payable ${money(st.partyBalance(p.id))}` : ''; if (doc.mode !== 'credit') paidI.placeholder = amt(t.grand); };
  const grid = lineGrid({ kind: 'purchase', doc, onChange: changed });
  changed();
  const doSave = () => { const rec = attempt(() => st.savePurchase(doc), r => `Purchase ${r.no} saved — stock updated`); if (rec) navigate('/purchases/' + rec.id); };
  setHooks({ save: doSave });
  return h('div', { class: 'page' },
    pageHeader('New Purchase', [{ label: 'Purchases', href: '#/purchases' }, { label: 'New' }], [h('span', { class: 'muted small' }, 'Ctrl+S to save')]),
    po ? h('div', { class: 'notice' }, icon('clipboard'), `Receiving against ${po.no}. Quantities are the pending balance; adjust to what actually arrived.`) : null,
    h('div', { class: 'card form-card' }, h('div', { class: 'form-grid cols-4' },
      field('Purchase No.', input({ value: st.peekNo('purchase', st.S().invoice.purchasePrefix), readOnly: true, class: 'input mono', tabindex: '-1' })),
      field('Date', dateInput({ value: doc.date, max: today(), onchange: e => { doc.date = e.target.value; } }), { req: true }),
      h('div', { class: 'field span-2' }, h('label', null, 'Supplier ', h('span', { class: 'req' }, '*')), h('div', { class: 'row' }, partyC, h('button', { class: 'btn', type: 'button', title: 'Add supplier', onclick: () => partyForm(null, 'supplier', p => { doc.partyId = p.id; partyC.setValue(p.id); changed(); }) }, icon('plus'))), info),
      field('Supplier Invoice No.', input({ value: '', autofocus: !!po, placeholder: 'e.g. PPI/2231', oninput: e => { doc.supplierInv = e.target.value; } })),
      field('Payment terms (days)', termsI),
      field('Receive into', select(s.locations.map(l => [l.id, l.name]), doc.location, { onchange: e => { doc.location = e.target.value; } })),
      field('Notes', input({ oninput: e => { doc.notes = e.target.value; } })))),
    h('div', { class: 'card' }, grid, h('div', { class: 'grid-foot' }, h('button', { class: 'btn btn-sm', onclick: () => grid.addRow() }, icon('plus'), 'Add row'))),
    h('div', { class: 'bill-foot' }, h('div', { class: 'card pay-card' }, h('h3', null, 'Payment'), modes, field('Amount paid now (₹)', paidI, { hint: 'Credit purchases go to Payable; cash & bank pay the full bill.' })), h('div', { class: 'card' }, tot)),
    h('div', { class: 'action-bar' }, h('button', { class: 'btn btn-primary', onclick: doSave }, icon('save'), 'Save Purchase'), h('button', { class: 'btn btn-ghost', onclick: () => navigate(po ? '/po' : '/purchases') }, 'Cancel')));
}

// ---------------------------------------------------------------- lists
function paidStatus(doc) {
  const t = st.totals(doc).grand;
  const bill = st.billsOutstanding(doc.partyId).bills.find(b => b.id === doc.id);
  const bal = bill ? bill.balance : 0;
  return bal <= 0.004 ? 'Paid' : bal < t - 0.004 ? 'Partial' : 'Unpaid';
}
export { paidStatus };

export function salesList() {
  const qs = query();
  let q = '', from = monthStart(), to = today(), status = qs.get('status') || 'saved';
  if (status !== 'saved') from = '';
  const cols = [
    { key: 'no', label: 'Invoice No.', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' },
    { key: 'party', label: 'Customer', value: r => st.party(r.partyId)?.name }, { key: 'agent', label: 'Agent', value: r => st.agent(r.agentId)?.name || '' },
    { key: 'mode', label: 'Mode', value: r => modeLabel(r.mode) }, { key: 'taxable', label: 'Taxable', type: 'money', value: r => st.totals(r).taxable, total: true },
    { key: 'tax', label: 'Tax', type: 'money', value: r => st.totals(r).tax, total: true }, { key: 'grand', label: 'Total', type: 'money', value: r => st.totals(r).grand, total: true },
    { key: 'pay', label: 'Payment', value: r => (r.status === 'saved' ? paidStatus(r) : ''), render: r => (r.status === 'saved' ? statusBadge(paidStatus(r)) : statusBadge(r.status)) },
  ];
  const table = dataTable({ columns: cols, onRowClick: r => navigate(r.status === 'held' ? '/sales/edit/' + r.id : '/sales/' + r.id) });
  const refresh = () => table.setRows([...st.getState().sales].filter(x => (status === 'all' || x.status === status) && inRange(x.date, from, to) && matches(q, x.no, st.party(x.partyId)?.name, x.date, modeLabel(x.mode))).reverse());
  const ex = exportButtons(() => table.exportTable('Sales Register', `${from ? fdate(from) : 'Start'} to ${to ? fdate(to) : 'Today'} · ${status}`));
  const fromI = dateInput({ value: from, 'aria-label': 'From date', onchange: e => { from = e.target.value; refresh(); } });
  const toI = dateInput({ value: to, 'aria-label': 'To date', onchange: e => { to = e.target.value; refresh(); } });
  const statusS = select([['saved', 'Saved'], ['held', 'On hold'], ['cancelled', 'Cancelled'], ['all', 'All']], status, { onchange: e => { status = e.target.value; refresh(); }, 'aria-label': 'Status' });
  setHooks({ print: ex.print });
  const el = h('div', { class: 'page' },
    pageHeader('Sales', [{ label: 'Sales' }], [h('a', { class: 'btn btn-primary', href: '#/sales/new' }, icon('plus'), 'New Sale')]),
    h('div', { class: 'toolbar' }, h('label', { class: 'inline' }, 'From', fromI), h('label', { class: 'inline' }, 'To', toI), statusS, searchBox({ placeholder: 'Invoice, customer, date… ( / )', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el),
    table);
  refresh();
  return el;
}

export function purchaseList() {
  let q = '', from = '', to = today();
  const cols = [
    { key: 'no', label: 'Purchase No.', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' },
    { key: 'supplierInv', label: 'Supplier Inv.' }, { key: 'party', label: 'Supplier', value: r => st.party(r.partyId)?.name },
    { key: 'loc', label: 'Received at', value: r => st.location(r.location)?.name }, { key: 'mode', label: 'Mode', value: r => modeLabel(r.mode) },
    { key: 'taxable', label: 'Taxable', type: 'money', value: r => st.totals(r).taxable, total: true }, { key: 'tax', label: 'Tax', type: 'money', value: r => st.totals(r).tax, total: true },
    { key: 'grand', label: 'Total', type: 'money', value: r => st.totals(r).grand, total: true },
    { key: 'pay', label: 'Payment', value: r => paidStatus(r), render: r => statusBadge(paidStatus(r)) },
  ];
  const table = dataTable({ columns: cols, onRowClick: r => navigate('/purchases/' + r.id) });
  const refresh = () => table.setRows([...st.activePurchases()].filter(x => inRange(x.date, from, to) && matches(q, x.no, x.supplierInv, st.party(x.partyId)?.name, x.date)).reverse());
  const ex = exportButtons(() => table.exportTable('Purchase Register', `${from ? fdate(from) : 'Start'} to ${fdate(to)}`));
  setHooks({ print: ex.print });
  const el = h('div', { class: 'page' },
    pageHeader('Purchases', [{ label: 'Purchases' }], [h('a', { class: 'btn', href: '#/po' }, icon('clipboard'), 'Purchase Orders'), h('a', { class: 'btn btn-primary', href: '#/purchases/new' }, icon('plus'), 'New Purchase')]),
    h('div', { class: 'toolbar' }, h('label', { class: 'inline' }, 'From', dateInput({ value: from, onchange: e => { from = e.target.value; refresh(); } })), h('label', { class: 'inline' }, 'To', dateInput({ value: to, onchange: e => { to = e.target.value; refresh(); } })), searchBox({ placeholder: 'Purchase no., supplier invoice, supplier… ( / )', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el),
    table);
  refresh();
  return el;
}

// ---------------------------------------------------------------- invoice view & print
export function invoiceHtml(kind, doc) {
  const b = st.S().business;
  const p = st.party(doc.partyId);
  const t = st.totals(doc);
  const title = kind === 'sale' ? (p?.gstin ? 'TAX INVOICE' : 'TAX INVOICE (B2C)') : 'PURCHASE VOUCHER';
  const hsn = {};
  t.lines.forEach(l => { const k = st.item(l.itemId).hsn + '|' + l.gst; hsn[k] = hsn[k] || { hsn: st.item(l.itemId).hsn, gst: l.gst, taxable: 0, cgst: 0, sgst: 0, igst: 0 }; ['taxable', 'cgst', 'sgst', 'igst'].forEach(x => { hsn[k][x] += l[x]; }); });
  return `<div class="invoice">
  <div class="inv-head"><div><div class="inv-biz">${esc(b.name)}</div><div>${esc(b.address)}</div><div>Ph ${esc(b.phone)} · ${esc(b.email)}</div><div><b>GSTIN ${esc(b.gstin)}</b> · State ${esc(b.state)}</div></div>
  <div class="inv-title"><div>${title}</div>${doc.status === 'cancelled' ? '<div class="inv-cancel">CANCELLED</div>' : ''}</div></div>
  <div class="inv-meta"><div><div class="lbl">${kind === 'sale' ? 'Bill to' : 'Supplier'}</div><b>${esc(p?.name)}</b><div>${esc(p?.address || '')}</div><div>${p?.gstin ? 'GSTIN ' + esc(p.gstin) : 'Unregistered'} · ${esc(p?.state || '')}</div></div>
  <div class="inv-kv"><div><span>${kind === 'sale' ? 'Invoice No.' : 'Voucher No.'}</span><b>${esc(doc.no)}</b></div><div><span>Date</span><b>${fdate(doc.date)}</b></div>${kind === 'purchase' ? `<div><span>Supplier Inv.</span><b>${esc(doc.supplierInv || '-')}</b></div>` : ''}<div><span>Payment</span><b>${modeLabel(doc.mode)}</b></div><div><span>Due date</span><b>${fdate(doc.dueDate)}</b></div>${doc.agentId ? `<div><span>Agent</span><b>${esc(st.agent(doc.agentId)?.name)}</b></div>` : ''}</div></div>
  <table class="inv-table"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Disc</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Amount</th></tr></thead><tbody>
  ${t.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(st.item(l.itemId).name)}</td><td>${esc(st.item(l.itemId).hsn)}</td><td class="num">${qty(l.qty)} ${esc(st.item(l.itemId).unit)}</td><td class="num">${amt(l.rate)}</td><td class="num">${l.disc ? l.disc + '%' : ''}</td><td class="num">${amt(l.taxable)}</td><td class="num">${l.gst}%</td><td class="num">${amt(l.total)}</td></tr>`).join('')}
  </tbody></table>
  <div class="inv-bottom"><div><table class="inv-hsn"><thead><tr><th>HSN</th><th class="num">Taxable</th>${t.interstate ? '<th class="num">IGST</th>' : '<th class="num">CGST</th><th class="num">SGST</th>'}</tr></thead><tbody>
  ${Object.values(hsn).map(x => `<tr><td>${x.hsn} @${x.gst}%</td><td class="num">${amt(x.taxable)}</td>${t.interstate ? `<td class="num">${amt(x.igst)}</td>` : `<td class="num">${amt(x.cgst)}</td><td class="num">${amt(x.sgst)}</td>`}</tr>`).join('')}</tbody></table>
  <div class="inv-words">${inWords(t.grand)}</div>${doc.notes ? `<div class="muted">Note: ${esc(doc.notes)}</div>` : ''}</div>
  <div class="inv-totals"><div><span>Subtotal</span><b>${amt(t.subtotal)}</b></div><div><span>Discount</span><b>-${amt(t.discount)}</b></div><div><span>Taxable</span><b>${amt(t.taxable)}</b></div>${t.interstate ? `<div><span>IGST</span><b>${amt(t.igst)}</b></div>` : `<div><span>CGST</span><b>${amt(t.cgst)}</b></div><div><span>SGST</span><b>${amt(t.sgst)}</b></div>`}<div><span>Round off</span><b>${amt(t.roundOff)}</b></div><div class="grand"><span>Grand Total</span><b>₹${amt(t.grand)}</b></div><div><span>${kind === 'sale' ? 'Received' : 'Paid'}</span><b>${amt(doc.paid || 0)}</b></div></div></div>
  <div class="inv-sign"><div>${kind === 'sale' ? 'Goods once sold are taken back only as per return policy. Subject to Kochi jurisdiction.' : ''}</div><div>For ${esc(b.name)}<br><br><br>Authorised Signatory</div></div></div>`;
}

export function docView(kind, { id }) {
  const s = st.getState();
  const doc = (kind === 'sale' ? s.sales : s.purchases).find(x => x.id === id);
  if (!doc) return h('div', { class: 'page' }, h('div', { class: 'empty big' }, h('h2', null, 'Document not found'), h('a', { class: 'btn', href: kind === 'sale' ? '#/sales' : '#/purchases' }, 'Back')));
  const bill = st.billsOutstanding(doc.partyId).bills.find(b => b.id === doc.id);
  const print = () => printNow(invoiceHtml(kind, doc));
  setHooks({ print });
  const returns = kind === 'sale' ? s.salesReturns.filter(r => r.saleId === id) : s.purchaseReturns.filter(r => r.purchaseId === id);
  const cancel = async () => {
    const reason = await confirmDialog({ title: `Cancel ${doc.no}?`, message: 'Stock will be added back and the bill removed from receivables and reports. The invoice number stays used.', okText: 'Cancel invoice', danger: true, reason: true });
    if (reason && attempt(() => st.cancelSale(doc.id, reason), 'Invoice cancelled')) navigate('/sales/' + doc.id + '?r=' + Date.now());
  };
  const actions = [
    h('button', { class: 'btn', onclick: print }, icon('print'), 'Print'),
    kind === 'sale' && doc.status === 'saved' ? h('a', { class: 'btn', href: '#/sales-return?sale=' + doc.id }, icon('undo'), 'Sales Return') : null,
    kind === 'purchase' ? h('a', { class: 'btn', href: '#/purchase-return?purchase=' + doc.id }, icon('redo'), 'Purchase Return') : null,
    bill && bill.balance > 0 && st.can('accounts') ? h('a', { class: 'btn', href: `#/cash?type=${kind === 'sale' ? 'receipt' : 'payment'}&party=${doc.partyId}&against=${doc.id}&amount=${bill.balance}` }, icon('cash'), kind === 'sale' ? 'Receive payment' : 'Pay supplier') : null,
    kind === 'sale' && doc.status === 'saved' && !returns.length ? h('button', { class: 'btn btn-danger-ghost', onclick: cancel }, icon('x'), 'Cancel invoice') : null,
  ];
  return h('div', { class: 'page' },
    pageHeader(doc.no, [{ label: kind === 'sale' ? 'Sales' : 'Purchases', href: kind === 'sale' ? '#/sales' : '#/purchases' }, { label: doc.no }], actions),
    h('div', { class: 'doc-layout' },
      h('div', { class: 'paper', html: invoiceHtml(kind, doc) }),
      h('div', { class: 'stack' },
        card('Status', h('div', { class: 'kv' },
          h('div', null, h('span', null, 'Status'), statusBadge(doc.status)),
          doc.status === 'saved' && bill ? [h('div', null, h('span', null, 'Bill amount'), h('b', null, money(bill.amount))), h('div', null, h('span', null, 'Settled'), h('b', null, money(bill.paid))), h('div', null, h('span', null, 'Balance'), h('b', { class: bill.balance > 0 ? 't-bad' : 't-ok' }, money(bill.balance))), h('div', null, h('span', null, 'Due'), h('b', null, fdate(bill.due)))] : null,
          doc.cancelReason ? h('div', null, h('span', null, 'Reason'), h('b', null, doc.cancelReason)) : null,
          h('div', null, h('span', null, 'Location'), h('b', null, st.location(doc.location)?.name)),
          kind === 'sale' ? h('div', null, h('span', null, 'Salesperson'), h('b', null, doc.salesperson || '')) : null,
          st.can('profit') && kind === 'sale' ? h('div', null, h('span', null, 'Gross profit'), h('b', null, money(st.totals(doc).taxable - st.totals(doc).cost))) : null)),
        returns.length ? card('Returns', h('div', { class: 'kv' }, returns.map(r => h('div', null, h('a', { href: `#/${kind === 'sale' ? 'sales' : 'purchase'}-return?view=${r.id}` }, r.no), h('b', null, money(st.totals(r).total)))))) : null,
        h('a', { class: 'btn btn-block', href: '#/party-report?party=' + doc.partyId }, icon('users'), 'Party ledger'))));
}

