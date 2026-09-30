import * as st from '../store.js';
import { h, money, amt, today, fdate, matches, monthStart, inRange, sum, round2, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, field, input, num, select, dateInput, combo, attempt, exportButtons, modal, card, kpi, statusBadge, badge } from '../ui.js';
import { navigate, query, setHooks, onMounted } from '../router.js';
import { modeLabel } from './billing.js';

export function refPath(kind, id) {
  return { sale: '/sales/' + id, purchase: '/purchases/' + id, salesReturn: '/sales-return?view=' + id, purchaseReturn: '/purchase-return?view=' + id, cash: '/cash?open=' + id, cheque: '/cheques?open=' + id, transfer: '/transfer', adjustment: '/stock-entry' }[kind];
}
const partyOpts = (types = ['customer', 'supplier']) => () => st.getState().parties.filter(p => types.includes(p.type)).map(p => ({ value: p.id, label: p.name, sub: `${p.type === 'customer' ? 'Customer' : 'Supplier'} · ${p.gstin || 'Unregistered'} · balance ${money(st.partyBalance(p.id))}` }));

// ---------------------------------------------------------------- day book
export function dayBookPage() {
  const s = st.getState();
  const def = { from: monthStart(), to: today(), type: '', party: '', mode: '', q: '' };
  const f = { ...def, ...(st.temp.get().daybookFilters || {}) };
  const fromI = dateInput({ value: f.from, onchange: e => { f.from = e.target.value; refresh(); } });
  const toI = dateInput({ value: f.to, onchange: e => { f.to = e.target.value; refresh(); } });
  const typeS = select([['', 'All types'], ...st.DAYBOOK_TYPES.map(t => [t, t])], f.type, { 'aria-label': 'Transaction type', onchange: e => { f.type = e.target.value; refresh(); } });
  const partyS = select([['', 'All parties'], ...s.parties.map(p => [p.id, p.name])], f.party, { 'aria-label': 'Party', onchange: e => { f.party = e.target.value; refresh(); } });
  const modeS = select([['', 'All modes'], ['cash', 'Cash'], ['card', 'Card'], ['upi', 'UPI'], ['bank', 'Bank'], ['credit', 'Credit'], ['cheque', 'Cheque']], f.mode, { 'aria-label': 'Payment mode', onchange: e => { f.mode = e.target.value; refresh(); } });
  const search = searchBox({ placeholder: 'Voucher, party, description… ( / )', value: f.q, onInput: v => { f.q = v; refresh(); } });
  const cols = [
    { key: 'date', label: 'Date', type: 'date' }, { key: 'no', label: 'Voucher No.', render: r => h('span', { class: 'mono' }, r.no) },
    { key: 'type', label: 'Type', render: r => badge(r.type, { Sale: 'info', Purchase: 'muted', 'Cash Receipt': 'ok', 'Cash Payment': 'warn', 'Cheque Receipt': 'ok', 'Cheque Payment': 'warn' }[r.type] || 'muted') },
    { key: 'party', label: 'Party' }, { key: 'desc', label: 'Description' },
    { key: 'dr', label: 'Debit', type: 'money', total: true }, { key: 'cr', label: 'Credit', type: 'money', total: true },
    { key: 'balance', label: 'Balance', type: 'money', total: rows => rows.length ? rows[rows.length - 1].balance : 0 },
  ];
  const table = dataTable({ columns: cols, onRowClick: r => navigate(refPath(r.kind, r.refId)), keyOf: r => r.no + r.type });
  const summary = h('div', { class: 'kpi-grid kpi-sm' });
  const refresh = () => {
    st.temp.set('daybookFilters', f);
    let bal = 0;
    const rows = st.dayBook().filter(r => inRange(r.date, f.from, f.to) && (!f.type || r.type === f.type) && (!f.party || r.partyId === f.party) && (!f.mode || r.mode === f.mode) && matches(f.q, r.no, r.party, r.desc, r.type, r.date))
      .map(r => ({ ...r, balance: (bal = round2(bal + r.dr - r.cr)) }));
    table.setRows(rows);
    fill(summary, kpi('Vouchers', String(rows.length)), kpi('Total debit', money(sum(rows, r => r.dr))), kpi('Total credit', money(sum(rows, r => r.cr))), kpi('Net', money(sum(rows, r => r.dr - r.cr))), kpi('Cash in hand (today)', money(st.cashBalance())));
  };
  const reset = () => { Object.assign(f, def); fromI.value = f.from; toI.value = f.to; typeS.value = ''; partyS.value = ''; modeS.value = ''; search.querySelector('input').value = ''; refresh(); };
  const ex = exportButtons(() => table.exportTable('Day Book', `${fdate(f.from)} to ${fdate(f.to)}${f.type ? ' · ' + f.type : ''}${f.party ? ' · ' + st.party(f.party)?.name : ''}${f.mode ? ' · ' + modeLabel(f.mode) : ''}`));
  setHooks({ print: ex.print });
  refresh();
  return h('div', { class: 'page' },
    pageHeader('Day Book', [{ label: 'Day Book' }]),
    h('div', { class: 'toolbar wrap' }, h('label', { class: 'inline' }, 'From', fromI), h('label', { class: 'inline' }, 'To', toI), typeS, partyS, modeS, search,
      h('button', { class: 'btn', onclick: refresh }, icon('filter'), 'Filter'), h('button', { class: 'btn btn-ghost', onclick: reset }, 'Reset'), h('div', { class: 'grow' }), ex.el),
    summary,
    h('p', { class: 'muted small' }, 'Debit = value coming in (sales, receipts, purchase returns). Credit = value going out (purchases, payments, sales returns). Balance is the running net of the rows shown.'),
    table);
}

// ---------------------------------------------------------------- party-wise report
export function partyReportPage() {
  let partyId = query().get('party') || '';
  let from = '', to = today();
  const out = h('div');
  const partyBox = h('div', { class: 'party-pick' });
  const buildCombo = (types, focus) => { const c = combo({ options: partyOpts(types), value: partyId, autofocus: focus, placeholder: 'Choose customer or supplier…', onChange: v => { partyId = v; render(); } }); fill(partyBox, c); if (focus) setTimeout(() => c.focus(), 0); };
  buildCombo(undefined, !partyId);
  const typeS = select([['', 'Customers & suppliers'], ['customer', 'Customers only'], ['supplier', 'Suppliers only']], '', { 'aria-label': 'Party type', onchange: e => buildCombo(e.target.value ? [e.target.value] : undefined, true) });
  let ex = null;
  const render = () => {
    const p = st.party(partyId);
    if (!p) { fill(out, h('div', { class: 'empty big' }, icon('users'), h('p', null, 'Choose a customer or supplier to see their statement.'))); ex = null; setHooks({}); return; }
    const all = st.ledgerEntries(p.id);
    const before = all.filter(e => from && e.date < from);
    const opening = before.length ? before[before.length - 1].balance : 0;
    const inR = all.filter(e => inRange(e.date, from, to));
    const g = k => sum(inR.filter(e => e.group === k), e => e.dr + e.cr);
    const openInRange = sum(inR.filter(e => e.group === 'opening'), e => e.dr - e.cr);
    const closing = round2(opening + sum(inR, e => e.dr - e.cr));
    const isC = p.type === 'customer';
    const table = dataTable({
      columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Particulars' }, { key: 'ref', label: 'Ref No.', render: r => h('span', { class: 'mono' }, r.ref) },
        { key: 'dr', label: isC ? 'Debit (+)' : 'Credit (+)', type: 'money', total: true }, { key: 'cr', label: isC ? 'Credit (−)' : 'Debit (−)', type: 'money', total: true },
        { key: 'bal', label: 'Balance', type: 'money', value: r => round2(opening + r.running) }],
      rows: (() => { let run = 0; return inR.map(e => ({ ...e, running: (run = round2(run + e.dr - e.cr)) })); })(),
      onRowClick: r => r.kind && navigate(refPath(r.kind, r.refId)), keyOf: r => r.ref + r.type + r.seq,
    });
    const bills = st.billsOutstanding(p.id).bills.filter(b => b.balance > 0.004);
    ex = exportButtons(() => table.exportTable(`Party Statement - ${p.name}`, `${from ? fdate(from) : 'Beginning'} to ${fdate(to)}`, [['Opening', amt(opening + openInRange)], ['Closing', amt(closing)]]));
    setHooks({ print: ex.print });
    fill(out, 
      h('div', { class: 'party-head card' }, h('div', null, h('h2', null, p.name), h('div', { class: 'muted' }, `${isC ? 'Customer' : 'Supplier'} · ${p.gstin || 'Unregistered'} · ${p.state} · ${p.phone || ''}`), h('div', { class: 'muted small' }, p.address)), ex.el),
      h('div', { class: 'kpi-grid kpi-sm' },
        kpi('Opening Balance', money(opening + openInRange)),
        kpi(isC ? 'Sales' : 'Purchases', money(g(isC ? 'sales' : 'purchases'))),
        kpi('Returns', money(g('returns'))),
        kpi(isC ? 'Receipts' : 'Payments', money(g(isC ? 'receipts' : 'payments'))),
        kpi('Adjustments', money(g('adjustments')), 'Refunds, cash out/in'),
        kpi('Closing Balance', money(closing), closing > 0 ? (isC ? 'Customer owes you' : 'You owe supplier') : closing < 0 ? 'Advance' : 'Settled', closing > 0 ? 'warn' : 'green')),
      card('Statement', table),
      card(`Open bills (${bills.length})`, dataTable({ columns: [{ key: 'no', label: 'Bill', render: b => h('span', { class: 'mono' }, b.no) }, { key: 'date', label: 'Date', type: 'date' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'paid', label: 'Settled', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money', total: true }, { key: 'days', label: 'Days overdue', type: 'qty' }], rows: bills, empty: 'No open bills', onRowClick: b => b.doc && navigate((isC ? '/sales/' : '/purchases/') + b.id) })));
  };
  render();
  return h('div', { class: 'page' },
    pageHeader('Party-Wise Report', [{ label: 'Party-Wise Report' }]),
    h('div', { class: 'toolbar wrap' }, typeS, partyBox, h('label', { class: 'inline' }, 'From', dateInput({ value: from, onchange: e => { from = e.target.value; render(); } })), h('label', { class: 'inline' }, 'To', dateInput({ value: to, onchange: e => { to = e.target.value; render(); } }))),
    out);
}

// ---------------------------------------------------------------- cash entry
export function cashPage() {
  const qs = query();
  let type = qs.get('type') === 'payment' ? 'payment' : 'receipt';
  let partyId = qs.get('party') || '';
  let against = qs.get('against') || '';
  const dateI = dateInput({ value: today(), max: today() });
  const amountI = num({ min: 0, value: qs.get('amount') || '', placeholder: '0.00' });
  const descI = input({ placeholder: 'e.g. Received towards INV/2026/0012' });
  const refI = input({ placeholder: 'Receipt / voucher no.' });
  const againstS = select([], '', { 'aria-label': 'Against bill' });
  const balBox = h('div', { class: 'cash-bal' });
  const partyWrap = h('div');
  const renderAgainst = () => {
    const p = st.party(partyId);
    const bills = p ? st.billsOutstanding(p.id).bills.filter(b => b.balance > 0.004 && b.doc) : [];
    fill(againstS, h('option', { value: '' }, p ? (bills.length ? 'Oldest bills first (auto)' : 'No open bills') : 'Choose a party first'), ...bills.map(b => h('option', { value: b.id, selected: b.id === against }, `${b.no} · ${fdate(b.date)} · balance ${amt(b.balance)}`)));
    againstS.disabled = !bills.length;
  };
  const buildParty = () => {
    const c = combo({ options: partyOpts(), value: partyId, placeholder: 'Party (optional for expenses)…', onChange: v => { partyId = v; against = ''; renderAgainst(); } });
    fill(partyWrap, c, partyId ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { partyId = ''; against = ''; buildParty(); renderAgainst(); } }, 'Clear party') : null);
  };
  buildParty();
  renderAgainst();
  againstS.onchange = () => { against = againstS.value; const b = st.billsOutstanding(partyId).bills.find(x => x.id === against); if (b && !amountI.value) amountI.value = b.balance; };
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Entry type' });
  const renderSeg = () => fill(seg, ...[['receipt', 'Cash Receipt'], ['payment', 'Cash Payment']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': type === k, class: type === k ? 'on' : '', onclick: () => { type = k; renderSeg(); } }, l)));
  renderSeg();
  const renderBal = () => fill(balBox, h('span', null, 'Cash in hand'), h('b', null, money(st.cashBalance())));
  renderBal();
  const save = () => {
    const rec = attempt(() => st.saveCash({ type, date: dateI.value, partyId, amount: amountI.value, description: descI.value, ref: refI.value, against: againstS.value || null }), r => `${r.no} saved · cash in hand ${money(st.cashBalance())}`);
    if (rec) { amountI.value = ''; descI.value = ''; refI.value = ''; against = ''; renderAgainst(); renderBal(); refresh(); }
  };
  setHooks({ save });
  let q = '', from = '', to = today(), ftype = '';
  const table = dataTable({
    columns: [{ key: 'no', label: 'Voucher', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Type', value: r => (r.type === 'receipt' ? 'Receipt' : 'Payment'), render: r => badge(r.type === 'receipt' ? 'Receipt' : 'Payment', r.type === 'receipt' ? 'ok' : 'warn') },
      { key: 'party', label: 'Party', value: r => st.party(r.partyId)?.name || '—' }, { key: 'description', label: 'Description' }, { key: 'ref', label: 'Reference' },
      { key: 'in', label: 'Receipt', type: 'money', value: r => (r.type === 'receipt' ? r.amount : 0), total: true }, { key: 'out', label: 'Payment', type: 'money', value: r => (r.type === 'payment' ? r.amount : 0), total: true }],
    pageSize: 25, rowClass: r => (r.id === qs.get('open') ? 'row-hl' : ''),
  });
  const refresh = () => table.setRows([...st.getState().cash].reverse().filter(c => inRange(c.date, from, to) && (!ftype || c.type === ftype) && matches(q, c.no, st.party(c.partyId)?.name, c.description, c.ref, c.date)));
  refresh();
  const ex = exportButtons(() => table.exportTable('Cash Entries', `${from ? fdate(from) : 'Start'} to ${fdate(to)}`));
  return h('div', { class: 'page' },
    pageHeader('Cash Entry', [{ label: 'Cash Entry' }], [balBox]),
    h('div', { class: 'card form-card' }, seg,
      h('div', { class: 'form-grid cols-4' },
        field('Date', dateI, { req: true }), h('div', { class: 'field span-2' }, h('label', null, 'Party'), partyWrap), field('Amount (₹)', amountI, { req: true }),
        field('Against bill', againstS, { cls: 'span-2' }), field('Description', descI), field('Reference', refI)),
      h('div', { class: 'action-bar inline' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save entry'))),
    card('Cash book', h('div', null, h('div', { class: 'toolbar' },
      h('label', { class: 'inline' }, 'From', dateInput({ value: from, onchange: e => { from = e.target.value; refresh(); } })), h('label', { class: 'inline' }, 'To', dateInput({ value: to, onchange: e => { to = e.target.value; refresh(); } })),
      select([['', 'Receipts & payments'], ['receipt', 'Receipts'], ['payment', 'Payments']], '', { 'aria-label': 'Type', onchange: e => { ftype = e.target.value; refresh(); } }),
      searchBox({ placeholder: 'Search…', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el), table)));
}

// ---------------------------------------------------------------- cheques
export function chequePage() {
  const s = st.getState();
  const banks = [...new Set(['SBI Edappally', 'Federal Bank Aluva', 'South Indian Bank Kochi', 'HDFC Bank MG Road', 'Canara Bank Thrissur', 'ICICI Bank Kakkanad', ...s.cheques.map(c => c.bank)])];
  let type = 'received', partyId = '';
  const f = { no: input({ placeholder: '6 digits', maxlength: 6, inputmode: 'numeric', class: 'input mono' }), date: dateInput({ value: today() }), bank: input({ list: 'bank-list', placeholder: 'Bank & branch' }), amount: num({ min: 0, placeholder: '0.00' }), status: select(st.CHEQUE_STATUSES.slice(0, 2), 'Pending'), notes: input({ placeholder: 'Notes' }) };
  const partyWrap = h('div');
  const buildParty = () => fill(partyWrap, combo({ options: partyOpts(type === 'received' ? ['customer'] : ['supplier']), value: partyId, placeholder: type === 'received' ? 'Customer…' : 'Supplier…', onChange: v => { partyId = v; } }));
  buildParty();
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Cheque type' });
  const renderSeg = () => fill(seg, ...[['received', 'Received'], ['issued', 'Issued']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': type === k, class: type === k ? 'on' : '', onclick: () => { type = k; partyId = ''; renderSeg(); buildParty(); } }, l)));
  renderSeg();
  const save = () => {
    const rec = attempt(() => st.saveCheque({ chequeNo: f.no.value, date: f.date.value, partyId, bank: f.bank.value, amount: f.amount.value, type, status: f.status.value, notes: f.notes.value }), r => `Cheque #${r.chequeNo} saved (${r.status})`);
    if (rec) { f.no.value = ''; f.amount.value = ''; f.notes.value = ''; refresh(); }
  };
  setHooks({ save });
  let q = '', ftype = '', fstatus = '';
  const table = dataTable({
    columns: [{ key: 'chequeNo', label: 'Cheque No.', render: r => h('span', { class: 'mono' }, r.chequeNo) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Type', value: r => (r.type === 'received' ? 'Received' : 'Issued') }, { key: 'party', label: 'Party', value: r => st.party(r.partyId)?.name },
      { key: 'bank', label: 'Bank' }, { key: 'amount', label: 'Amount', type: 'money', total: true }, { key: 'status', label: 'Status', render: r => statusBadge(r.status) }, { key: 'notes', label: 'Notes' },
      { key: 'act', label: '', sortable: false, export: false, render: r => (['Cancelled', 'Bounced'].includes(r.status) ? '' : h('button', { class: 'btn btn-sm', onclick: () => statusModal(r, refresh) }, 'Update status')) }],
    onRowClick: r => statusModal(r, refresh), pageSize: 25,
  });
  const refresh = () => table.setRows([...st.getState().cheques].reverse().filter(c => (!ftype || c.type === ftype) && (!fstatus || c.status === fstatus) && matches(q, c.chequeNo, st.party(c.partyId)?.name, c.bank, c.status, c.date)));
  refresh();
  const kp = () => { const c = st.getState().cheques; const p = c.filter(x => x.status === 'Pending'); return h('div', { class: 'kpi-grid kpi-sm' }, kpi('Pending received', money(sum(p.filter(x => x.type === 'received'), x => x.amount)), `${p.filter(x => x.type === 'received').length} cheque(s)`), kpi('Pending issued', money(sum(p.filter(x => x.type === 'issued'), x => x.amount)), `${p.filter(x => x.type === 'issued').length} cheque(s)`), kpi('Bounced', String(c.filter(x => x.status === 'Bounced').length), null, 'bad'), kpi('Bank balance', money(st.bankBalance()))); };
  const ex = exportButtons(() => table.exportTable('Cheque Register', [ftype, fstatus].filter(Boolean).join(' · ')));
  const open = query().get('open') && st.getState().cheques.find(c => c.id === query().get('open'));
  if (open) onMounted(() => statusModal(open, refresh));
  return h('div', { class: 'page' },
    pageHeader('Cheque Entry', [{ label: 'Cheque Entry' }]),
    kp(),
    h('div', { class: 'card form-card' }, seg,
      h('div', { class: 'form-grid cols-4' }, field('Cheque No.', f.no, { req: true }), field('Cheque date', f.date, { req: true }), h('div', { class: 'field span-2' }, h('label', null, 'Party ', h('span', { class: 'req' }, '*')), partyWrap),
        field('Bank', f.bank, { req: true }), field('Amount (₹)', f.amount, { req: true }), field('Status', f.status), field('Notes', f.notes)),
      h('datalist', { id: 'bank-list' }, banks.map(b => h('option', { value: b }))),
      h('div', { class: 'action-bar inline' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save cheque'))),
    card('Cheque register', h('div', null, h('div', { class: 'toolbar' },
      select([['', 'Received & issued'], ['received', 'Received'], ['issued', 'Issued']], '', { 'aria-label': 'Type', onchange: e => { ftype = e.target.value; refresh(); } }),
      select([['', 'All statuses'], ...st.CHEQUE_STATUSES.map(x => [x, x])], '', { 'aria-label': 'Status', onchange: e => { fstatus = e.target.value; refresh(); } }),
      searchBox({ placeholder: 'Cheque no., party, bank…', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el), table)));
}

function statusModal(c, onDone) {
  const allowed = c.status === 'Pending' ? ['Cleared', 'Bounced', 'Cancelled'] : c.status === 'Cleared' ? ['Bounced'] : [];
  const sel = select(allowed, allowed[0]);
  const dateI = dateInput({ value: today(), min: c.date });
  const save = () => { if (attempt(() => st.setChequeStatus(c.id, sel.value, dateI.value), `Cheque #${c.chequeNo} marked ${sel.value.toLowerCase()}`)) { m.close(); onDone(); } };
  const m = modal({
    title: `Cheque #${c.chequeNo}`, width: 480,
    body: h('div', { class: 'stack' },
      h('div', { class: 'kv' }, h('div', null, h('span', null, 'Party'), h('b', null, st.party(c.partyId)?.name)), h('div', null, h('span', null, 'Amount'), h('b', null, money(c.amount))), h('div', null, h('span', null, 'Bank'), h('b', null, c.bank)), h('div', null, h('span', null, 'Current status'), statusBadge(c.status))),
      h('div', { class: 'muted small' }, 'History: ' + (c.history || []).map(x => `${x.status} (${fdate(x.at)})`).join(' → ')),
      allowed.length ? h('div', { class: 'form-grid cols-2' }, field('New status', sel), field('Status date', dateI)) : h('p', { class: 'muted' }, `A ${c.status.toLowerCase()} cheque cannot change further.`),
      h('p', { class: 'muted small' }, 'Cleared cheques update the party balance and bank balance; bounced or cancelled cheques have no effect.')),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), allowed.length ? h('button', { class: 'btn btn-primary', onclick: save }, 'Update status') : null],
  });
}
