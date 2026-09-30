import * as st from '../store.js';
import { h, money, qty, today, fdate, matches, sum, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, field, input, num, select, dateInput, combo, attempt, exportButtons, modal, card, kpi, statusBadge } from '../ui.js';
import { query, setHooks, navigate, onMounted } from '../router.js';

const itemOpts = loc => () => st.getState().items.map(i => ({ value: i.id, label: i.name, sub: `${i.code} · ${loc ? st.location(loc)?.name + ' ' : ''}stock ${qty(loc ? st.stockOf(i.id, loc) : st.stockOf(i.id))} ${i.unit}`, search: i.code }));

// ---------------------------------------------------------------- stock
export function stockPage() {
  const s = st.getState();
  const showCost = st.can('profit');
  const qs = query();
  let q = '', cat = '', status = qs.get('filter') || '', loc = '';
  const cur = r => (loc ? st.stockOf(r.id, loc) : st.stockOf(r.id));
  const d = r => st.stockDetail(r.id);
  const cols = [
    { key: 'code', label: 'Item Code', render: r => h('span', { class: 'mono' }, r.code) }, { key: 'name', label: 'Item Name' }, { key: 'category', label: 'Category' },
    { key: 'hsn', label: 'HSN' }, { key: 'unit', label: 'Unit' },
    { key: 'opening', label: 'Opening', type: 'qty', value: r => d(r).opening }, { key: 'purchased', label: 'Purchased', type: 'qty', value: r => d(r).purchased },
    { key: 'sold', label: 'Sold', type: 'qty', value: r => d(r).sold }, { key: 'pr', label: 'Pur. Return', type: 'qty', value: r => d(r).pr }, { key: 'sr', label: 'Sales Return', type: 'qty', value: r => d(r).sr },
    { key: 'transferred', label: 'Transferred', type: 'qty', value: r => d(r).transferred }, { key: 'adjusted', label: 'Adjusted', type: 'qty', value: r => d(r).adjusted },
    { key: 'current', label: 'Current Stock', type: 'qty', value: cur, cls: 'strong' }, { key: 'reorder', label: 'Reorder', type: 'qty' },
    ...(showCost ? [{ key: 'cost', label: 'Cost Price', type: 'money' }] : []), { key: 'price', label: 'Selling Price', type: 'money' },
    { key: 'value', label: showCost ? 'Stock Value' : 'Value (MRP)', type: 'money', value: r => Math.max(0, cur(r)) * (showCost ? r.cost : r.price), total: true },
    { key: 'status', label: 'Status', value: r => st.stockStatus(r), render: r => statusBadge(st.stockStatus(r)) },
  ];
  const table = dataTable({ columns: cols, onRowClick: r => itemDetail(r), rowClass: r => (st.stockStatus(r) === 'out' ? 'row-bad' : st.stockStatus(r) === 'low' ? 'row-warn' : '') });
  const kpis = h('div', { class: 'kpi-grid kpi-sm' });
  const refresh = () => {
    const rows = st.getState().items.filter(i => (!cat || i.category === cat) && (!status || (status === 'low' ? st.stockStatus(i) !== 'in' : st.stockStatus(i) === status)) && matches(q, i.code, i.name, i.hsn, i.category));
    table.setRows(rows);
    fill(kpis, 
      kpi('Items', String(rows.length)), showCost ? kpi('Value at cost', money(sum(rows, i => Math.max(0, cur(i)) * i.cost))) : null,
      kpi('Value at selling price', money(sum(rows, i => Math.max(0, cur(i)) * i.price))),
      kpi('Low stock', String(rows.filter(i => st.stockStatus(i) === 'low').length), null, 'warn'), kpi('Out of stock', String(rows.filter(i => st.stockStatus(i) === 'out').length), null, 'bad'));
  };
  const ex = exportButtons(() => table.exportTable('Stock Statement', [loc ? st.location(loc).name : 'All locations', cat || 'All categories', status ? { low: 'Low / out', out: 'Out of stock', in: 'In stock' }[status] : ''].filter(Boolean).join(' · ')));
  setHooks({ print: ex.print });
  const el = h('div', { class: 'page' },
    pageHeader('Stock', [{ label: 'Stock' }], [st.can('stock') ? h('a', { class: 'btn', href: '#/stock-entry' }, icon('edit'), 'Stock Entry') : null, st.can('stock') ? h('a', { class: 'btn', href: '#/transfer' }, icon('swap'), 'Transfer') : null]),
    kpis,
    h('div', { class: 'toolbar' },
      searchBox({ placeholder: 'Search item, code, HSN… ( / )', onInput: v => { q = v; refresh(); }, autofocus: true }),
      select([['', 'All categories'], ...s.categories.map(c => [c, c])], '', { 'aria-label': 'Category', onchange: e => { cat = e.target.value; refresh(); } }),
      select([['', 'All stock'], ['in', 'In stock'], ['low', 'Low / out of stock'], ['out', 'Out of stock']], status, { 'aria-label': 'Stock status', onchange: e => { status = e.target.value; refresh(); } }),
      select([['', 'All locations'], ...s.locations.map(l => [l.id, l.name])], '', { 'aria-label': 'Location', onchange: e => { loc = e.target.value; refresh(); } }),
      h('div', { class: 'grow' }), ex.el),
    table);
  refresh();
  const open = qs.get('item') && st.item(qs.get('item'));
  if (open) onMounted(() => itemDetail(open));
  return el;
}

function itemDetail(it) {
  const s = st.getState();
  const mv = st.movements(it.id).slice(-8).reverse();
  const m = modal({
    title: it.name, width: 640,
    body: h('div', { class: 'stack' },
      h('div', { class: 'kv' }, h('div', null, h('span', null, 'Code'), h('b', { class: 'mono' }, it.code)), h('div', null, h('span', null, 'HSN / GST'), h('b', null, `${it.hsn} · ${it.gst}%`)), h('div', null, h('span', null, 'Total stock'), h('b', null, `${qty(st.stockOf(it.id))} ${it.unit}`)), h('div', null, h('span', null, 'Status'), statusBadge(st.stockStatus(it)))),
      h('div', { class: 'loc-chips' }, s.locations.map(l => h('div', { class: 'loc-chip' }, h('span', null, l.name), h('b', null, qty(st.stockOf(it.id, l.id)))))),
      h('h4', null, 'Latest movements'),
      h('table', { class: 'tbl compact' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Type'), h('th', null, 'Ref'), h('th', null, 'Location'), h('th', { class: 'num' }, 'Qty'))),
        h('tbody', null, mv.map(x => h('tr', null, h('td', null, fdate(x.date)), h('td', null, x.type), h('td', { class: 'mono' }, x.ref), h('td', null, st.location(x.loc)?.name), h('td', { class: 'num ' + (x.qty < 0 ? 't-bad' : 't-ok') }, (x.qty > 0 ? '+' : '') + qty(x.qty))))))),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn btn-primary', onclick: () => { m.close(); navigate('/reports/item-transaction?item=' + it.id); } }, 'Full transaction history')],
  });
}

// ---------------------------------------------------------------- stock entry (adjustment)
export function stockEntryPage() {
  const s = st.getState();
  const REASONS = { increase: ['Physical count surplus', 'Found in yard audit', 'Returned from site (no bill)', 'Opening correction', 'Other'], decrease: ['Termite damage', 'Breakage during handling', 'Used for showroom display', 'Sample given to customer', 'Theft / missing', 'Other'] };
  let direction = 'increase', itemId = '';
  const locS = select(s.locations.map(l => [l.id, l.name]), 'L1', { onchange: () => upd() });
  const qtyI = num({ min: 0, placeholder: '0', oninput: () => upd() });
  const unitI = input({ readOnly: true, tabindex: '-1', placeholder: '—' });
  const dateI = dateInput({ value: today(), max: today() });
  const reasonS = select(REASONS.increase, REASONS.increase[0]);
  const other = input({ placeholder: 'Describe the reason', hidden: true });
  reasonS.onchange = () => { other.hidden = reasonS.value !== 'Other'; };
  const refI = input({ placeholder: 'e.g. PC-014 / audit sheet no.' });
  const info = h('div', { class: 'hint' });
  const itemC = combo({ options: () => itemOpts(locS.value)(), autofocus: true, placeholder: 'Item name or code…', onChange: v => { itemId = v; unitI.value = st.item(v).unit; upd(); } });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Adjustment type' });
  const renderSeg = () => fill(seg, ...[['increase', 'Stock Increase'], ['decrease', 'Stock Decrease']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': direction === k, class: direction === k ? 'on' : '', onclick: () => { direction = k; fill(reasonS, ...REASONS[k].map(r => h('option', { value: r }, r))); other.hidden = true; renderSeg(); upd(); } }, l)));
  renderSeg();
  const upd = () => {
    if (!itemId) { info.textContent = ''; return; }
    const have = st.stockOf(itemId, locS.value), qn = +qtyI.value || 0;
    const after = direction === 'increase' ? have + qn : have - qn;
    info.textContent = `At ${st.location(locS.value).name}: ${qty(have)} → ${qty(after)} ${st.item(itemId).unit}`;
    info.className = 'hint' + (after < 0 ? ' t-bad' : '');
  };
  const save = () => {
    const rec = attempt(() => st.saveAdjustment({ direction, itemId, loc: locS.value, qty: qtyI.value, date: dateI.value, reason: reasonS.value === 'Other' ? other.value : reasonS.value, ref: refI.value }), r => `${r.no} saved — stock ${r.qty > 0 ? 'increased' : 'decreased'}`);
    if (rec) { qtyI.value = ''; refI.value = ''; upd(); refresh(); itemC.focus(); }
  };
  setHooks({ save });
  let q = '';
  const table = dataTable({
    columns: [{ key: 'no', label: 'No.', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' }, { key: 'item', label: 'Item', value: r => st.item(r.itemId)?.name },
      { key: 'loc', label: 'Location', value: r => st.location(r.loc)?.name }, { key: 'type', label: 'Type', value: r => (r.qty > 0 ? 'Increase' : 'Decrease'), render: r => h('span', { class: r.qty > 0 ? 't-ok' : 't-bad' }, r.qty > 0 ? 'Increase' : 'Decrease') },
      { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'unit', label: 'Unit', value: r => st.item(r.itemId)?.unit }, { key: 'reason', label: 'Reason' }, { key: 'ref', label: 'Reference' }],
    pageSize: 20,
  });
  const refresh = () => table.setRows([...st.getState().adjustments].reverse().filter(a => matches(q, a.no, st.item(a.itemId)?.name, a.reason, a.ref, a.date)));
  refresh();
  const ex = exportButtons(() => table.exportTable('Stock Adjustments', ''));
  return h('div', { class: 'page' },
    pageHeader('Stock Entry', [{ label: 'Stock', href: '#/stock' }, { label: 'Stock Entry' }], [h('span', { class: 'muted small' }, 'Ctrl+S to save')]),
    h('div', { class: 'card form-card' }, seg,
      h('div', { class: 'form-grid cols-4' },
        h('div', { class: 'field span-2' }, h('label', null, 'Item ', h('span', { class: 'req' }, '*')), itemC, info),
        field('Location', locS), field('Date', dateI, { req: true }), field('Quantity', qtyI, { req: true }), field('Unit', unitI),
        h('div', { class: 'field' }, h('label', null, 'Reason ', h('span', { class: 'req' }, '*')), reasonS, other), field('Reference', refI)),
      h('div', { class: 'action-bar inline' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), 'Save adjustment'))),
    card('Stock movement history (adjustments)', h('div', null, h('div', { class: 'toolbar' }, searchBox({ placeholder: 'Search…', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el), table)));
}

// ---------------------------------------------------------------- transfers
export function transferPage() {
  const s = st.getState();
  let itemId = '';
  const fromS = select(s.locations.map(l => [l.id, l.name]), 'L1', { onchange: () => upd() });
  const toS = select(s.locations.map(l => [l.id, l.name]), 'L2', { onchange: () => upd() });
  const qtyI = num({ min: 0, placeholder: '0', oninput: () => upd() });
  const dateI = dateInput({ value: today(), max: today() });
  const notesI = input({ placeholder: 'e.g. Showroom display refill' });
  const info = h('div', { class: 'hint' });
  const itemC = combo({ options: () => itemOpts(fromS.value)(), autofocus: true, placeholder: 'Item name or code…', onChange: v => { itemId = v; upd(); } });
  const upd = () => {
    if (!itemId) { info.textContent = ''; return; }
    const it = st.item(itemId), qn = +qtyI.value || 0, have = st.stockOf(itemId, fromS.value);
    info.textContent = `${st.location(fromS.value).name}: ${qty(have)} → ${qty(have - qn)} · ${st.location(toS.value).name}: ${qty(st.stockOf(itemId, toS.value))} → ${qty(st.stockOf(itemId, toS.value) + qn)} ${it.unit}`;
    info.className = 'hint' + (qn > have ? ' t-bad' : '');
  };
  const save = () => {
    const rec = attempt(() => st.saveTransfer({ itemId, from: fromS.value, to: toS.value, qty: qtyI.value, date: dateI.value, notes: notesI.value }), r => `${r.no}: ${r.qty} moved to ${st.location(r.to).name}`);
    if (rec) { qtyI.value = ''; notesI.value = ''; upd(); refresh(); }
  };
  setHooks({ save });
  let q = '';
  const table = dataTable({
    columns: [{ key: 'no', label: 'Transfer No.', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' }, { key: 'item', label: 'Item', value: r => st.item(r.itemId)?.name },
      { key: 'from', label: 'From', value: r => st.location(r.from)?.name }, { key: 'to', label: 'To', value: r => st.location(r.to)?.name },
      { key: 'qty', label: 'Qty', type: 'qty', total: true }, { key: 'unit', label: 'Unit', value: r => st.item(r.itemId)?.unit }, { key: 'notes', label: 'Notes' }],
    pageSize: 20,
  });
  const refresh = () => table.setRows([...st.getState().transfers].reverse().filter(t => matches(q, t.no, st.item(t.itemId)?.name, st.location(t.from)?.name, st.location(t.to)?.name, t.date, t.notes)));
  refresh();
  const ex = exportButtons(() => table.exportTable('Stock Transfers', ''));
  return h('div', { class: 'page' },
    pageHeader('Stock Transfer', [{ label: 'Stock', href: '#/stock' }, { label: 'Stock Transfer' }], [h('span', { class: 'muted small' }, 'Ctrl+S to save')]),
    h('div', { class: 'card form-card' },
      h('div', { class: 'form-grid cols-4' },
        field('From location', fromS, { req: true }), field('To location', toS, { req: true }), field('Date', dateI, { req: true }), field('Quantity', qtyI, { req: true }),
        h('div', { class: 'field span-2' }, h('label', null, 'Item ', h('span', { class: 'req' }, '*')), itemC, info), field('Notes', notesI, { cls: 'span-2' })),
      h('div', { class: 'action-bar inline' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('swap'), 'Transfer stock'))),
    card('Transfer history', h('div', null, h('div', { class: 'toolbar' }, searchBox({ placeholder: 'Search transfers…', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el), table)));
}
