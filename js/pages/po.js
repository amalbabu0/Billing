import * as st from '../store.js';
import { h, money, amt, qty, today, fdate, matches, addDays, esc, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, field, input, num, select, dateInput, combo, attempt, exportButtons, modal, statusBadge, confirmDialog, kpi, toast } from '../ui.js';
import { printNow } from '../export.js';
import { navigate, query, setHooks, onMounted } from '../router.js';

export function poPage() {
  let q = '', status = '';
  const table = dataTable({
    columns: [{ key: 'no', label: 'PO Number', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' }, { key: 'expected', label: 'Expected', type: 'date' },
      { key: 'party', label: 'Supplier', value: r => st.party(r.partyId)?.name }, { key: 'items', label: 'Items', value: r => r.lines.map(l => st.item(l.itemId)?.name).join(', '), cls: 'truncate-cell' },
      { key: 'qty', label: 'Qty', type: 'qty', value: r => r.lines.reduce((a, l) => a + l.qty, 0) }, { key: 'recd', label: 'Received', type: 'qty', value: r => r.lines.reduce((a, l) => a + (l.received || 0), 0) },
      { key: 'total', label: 'Total', type: 'money', value: r => st.poTotal(r), total: true }, { key: 'status', label: 'Status', render: r => statusBadge(r.status) }],
    onRowClick: r => poDetail(r, refresh), rowClass: r => (r.expected && r.expected < today() && ['Ordered', 'Partially Received'].includes(r.status) ? 'row-warn' : ''),
  });
  const kp = h('div', { class: 'kpi-grid kpi-sm' });
  const refresh = () => {
    const all = st.getState().pos;
    table.setRows([...all].reverse().filter(p => (!status || p.status === status) && matches(q, p.no, st.party(p.partyId)?.name, p.status, p.date, ...p.lines.map(l => st.item(l.itemId)?.name))));
    const open = all.filter(p => ['Ordered', 'Partially Received'].includes(p.status));
    fill(kp, kpi('Open orders', String(open.length), money(open.reduce((a, p) => a + st.poTotal(p), 0))), kpi('Overdue', String(open.filter(p => p.expected < today()).length), 'Past expected date', 'warn'), kpi('Drafts', String(all.filter(p => p.status === 'Draft').length)), kpi('Received', String(all.filter(p => p.status === 'Received').length)));
  };
  refresh();
  const ex = exportButtons(() => table.exportTable('Purchase Orders', status || 'All statuses'));
  setHooks({ print: ex.print });
  const qs = query();
  if (qs.get('new')) onMounted(() => poForm(null, refresh));
  const open = qs.get('open') && st.getState().pos.find(p => p.id === qs.get('open'));
  if (open) onMounted(() => poDetail(open, refresh));
  return h('div', { class: 'page' },
    pageHeader('Purchase Orders', [{ label: 'Purchase Orders' }], [h('button', { class: 'btn btn-primary', onclick: () => poForm(null, refresh) }, icon('plus'), 'New Purchase Order')]),
    kp,
    h('div', { class: 'toolbar' }, select([['', 'All statuses'], ...st.PO_STATUSES.map(s => [s, s])], '', { 'aria-label': 'Status', onchange: e => { status = e.target.value; refresh(); } }), searchBox({ placeholder: 'PO no., supplier, item… ( / )', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el),
    table);
}

function poForm(po, onSaved) {
  const v = po ? JSON.parse(JSON.stringify(po)) : { partyId: '', date: today(), expected: addDays(today(), 10), lines: [{ itemId: '', qty: 1, rate: 0 }], notes: '', status: 'Draft' };
  const linesBox = h('div');
  const total = h('b');
  const upd = () => { total.textContent = money(v.lines.reduce((a, l) => a + (+l.qty || 0) * (+l.rate || 0), 0)); };
  const renderLines = () => {
    fill(linesBox, h('table', { class: 'tbl compact grid-edit' },
      h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, 'Quantity'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'Total'), h('th', null, ''))),
      h('tbody', null, v.lines.map((l, i) => {
        const tot = h('span', null, amt((+l.qty || 0) * (+l.rate || 0)));
        const q = num({ value: l.qty, min: 0, 'aria-label': 'Quantity', oninput: e => { l.qty = +e.target.value; tot.textContent = amt(l.qty * l.rate); upd(); } });
        const r = num({ value: l.rate, min: 0, 'aria-label': 'Rate', oninput: e => { l.rate = +e.target.value; tot.textContent = amt(l.qty * l.rate); upd(); } });
        return h('tr', null,
          h('td', { class: 'item-cell' }, combo({ options: () => st.getState().items.map(it => ({ value: it.id, label: it.name, sub: `${it.code} · stock ${qty(st.stockOf(it.id))} ${it.unit} · last cost ₹${amt(it.cost)}` })), value: l.itemId, placeholder: 'Item…', onChange: id => { l.itemId = id; l.rate = st.item(id).cost; renderLines(); upd(); } })),
          h('td', { class: 'num' }, q), h('td', { class: 'num' }, r), h('td', { class: 'num' }, tot),
          h('td', null, v.lines.length > 1 ? h('button', { class: 'btn-icon', 'aria-label': 'Remove', onclick: () => { v.lines.splice(i, 1); renderLines(); upd(); } }, icon('trash')) : null));
      }))),
      h('button', { class: 'btn btn-sm', onclick: () => { v.lines.push({ itemId: '', qty: 1, rate: 0 }); renderLines(); } }, icon('plus'), 'Add item'));
  };
  renderLines(); upd();
  const partyC = combo({ options: () => st.suppliers().map(p => ({ value: p.id, label: p.name, sub: p.gstin })), value: v.partyId, autofocus: true, placeholder: 'Supplier…', onChange: id => { v.partyId = id; } });
  const dateI = dateInput({ value: v.date, onchange: e => { v.date = e.target.value; } });
  const expI = dateInput({ value: v.expected, onchange: e => { v.expected = e.target.value; } });
  const notesI = input({ value: v.notes, placeholder: 'Delivery / quality instructions', oninput: e => { v.notes = e.target.value; } });
  const save = asStatus => {
    const rec = attempt(() => st.savePO({ ...v, status: po ? po.status : 'Draft' }));
    if (!rec) return;
    if (asStatus === 'Ordered' && rec.status === 'Draft') attempt(() => st.setPOStatus(rec.id, 'Ordered'));
    toast(`${rec.no} ${asStatus === 'Ordered' ? 'placed with supplier' : 'saved'}`);
    m.close(); onSaved();
  };
  const m = modal({
    title: po ? `Edit ${po.no}` : 'New Purchase Order', width: 820,
    body: h('div', { class: 'stack' }, h('div', { class: 'form-grid cols-4' },
      h('div', { class: 'field span-2' }, h('label', null, 'Supplier ', h('span', { class: 'req' }, '*')), partyC), field('PO date', dateI, { req: true }), field('Expected date', expI), field('Notes', notesI, { cls: 'span-4' })),
      linesBox, h('div', { class: 'tot-row grand' }, h('span', null, 'PO Total (before GST)'), total)),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn', onclick: () => save('Draft') }, 'Save as Draft'), (!po || po.status === 'Draft') ? h('button', { class: 'btn btn-primary', onclick: () => save('Ordered') }, 'Save & Mark Ordered') : h('button', { class: 'btn btn-primary', onclick: () => save() }, 'Save')],
  });
}

function poHtml(po) {
  const b = st.S().business, p = st.party(po.partyId);
  return `<div class="invoice"><div class="inv-head"><div><div class="inv-biz">${esc(b.name)}</div><div>${esc(b.address)}</div><div>GSTIN ${esc(b.gstin)}</div></div><div class="inv-title"><div>PURCHASE ORDER</div><div class="print-sub">${esc(po.status)}</div></div></div>
  <div class="inv-meta"><div><div class="lbl">To</div><b>${esc(p?.name)}</b><div>${esc(p?.address || '')}</div><div>GSTIN ${esc(p?.gstin || '-')}</div></div><div class="inv-kv"><div><span>PO No.</span><b>${esc(po.no)}</b></div><div><span>Date</span><b>${fdate(po.date)}</b></div><div><span>Expected by</span><b>${fdate(po.expected)}</b></div></div></div>
  <table class="inv-table"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Received</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>${po.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(st.item(l.itemId)?.name)}</td><td>${esc(st.item(l.itemId)?.hsn)}</td><td class="num">${qty(l.qty)} ${esc(st.item(l.itemId)?.unit)}</td><td class="num">${qty(l.received || 0)}</td><td class="num">${amt(l.rate)}</td><td class="num">${amt(l.qty * l.rate)}</td></tr>`).join('')}</tbody></table>
  <div class="inv-bottom"><div>${po.notes ? 'Notes: ' + esc(po.notes) : ''}<div class="muted">Prices exclude GST. Please quote the PO number on your invoice.</div></div><div class="inv-totals"><div class="grand"><span>Total</span><b>₹${amt(st.poTotal(po))}</b></div></div></div>
  <div class="inv-sign"><div></div><div>For ${esc(b.name)}<br><br><br>Authorised Signatory</div></div></div>`;
}

function poDetail(po, onChange) {
  const act = async (status, msg) => {
    if (status === 'Cancelled' && !(await confirmDialog({ title: `Cancel ${po.no}?`, message: 'The supplier order will be marked cancelled. Stock already received stays.', okText: 'Cancel PO', danger: true }))) return;
    if (attempt(() => st.setPOStatus(po.id, status), msg)) { m.close(); onChange(); }
  };
  const canReceive = ['Ordered', 'Partially Received'].includes(po.status);
  const purchases = (po.purchases || []).map(id => st.getState().purchases.find(p => p.id === id)).filter(Boolean);
  const m = modal({
    title: `${po.no} — ${st.party(po.partyId)?.name}`, width: 860,
    body: h('div', { class: 'stack' }, h('div', { class: 'paper', html: poHtml(po) }),
      purchases.length ? h('div', { class: 'muted small' }, 'Received through: ', purchases.map(p => h('a', { href: '#/purchases/' + p.id, onclick: () => m.close(), style: { marginRight: '8px' } }, p.no))) : null),
    footer: [
      h('button', { class: 'btn', onclick: () => printNow(poHtml(po)) }, icon('print'), 'Print'),
      ['Draft', 'Ordered'].includes(po.status) ? h('button', { class: 'btn', onclick: () => { m.close(); poForm(po, onChange); } }, icon('edit'), 'Edit') : null,
      po.status === 'Draft' ? h('button', { class: 'btn', onclick: () => act('Ordered', `${po.no} marked ordered`) }, 'Mark Ordered') : null,
      !['Received', 'Cancelled'].includes(po.status) ? h('button', { class: 'btn btn-danger-ghost', onclick: () => act('Cancelled', `${po.no} cancelled`) }, 'Cancel PO') : null,
      canReceive ? h('button', { class: 'btn btn-primary', onclick: () => { m.close(); navigate('/purchases/new?po=' + po.id); } }, icon('truck'), 'Receive goods') : null,
    ],
  });
}
