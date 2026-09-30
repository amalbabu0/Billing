import * as st from '../store.js';
import { h, money, amt, qty, today, fdate, matches, round2, fill } from '../utils.js';
import { icon, pageHeader, dataTable, searchBox, field, input, num, select, dateInput, combo, attempt, exportButtons, modal, card } from '../ui.js';
import { navigate, query, setHooks, onMounted } from '../router.js';

const REASONS = {
  sale: ['Damaged in transit', 'Wrong size supplied', 'Customer changed design', 'Finish not as sample', 'Excess quantity', 'Other'],
  purchase: ['Quality rejected', 'Cracks / splits', 'Wrong thickness', 'Excess supplied', 'Moisture damage', 'Other'],
};

export const salesReturnPage = () => returnPage('sale');
export const purchaseReturnPage = () => returnPage('purchase');

function returnPage(kind) {
  const isSale = kind === 'sale';
  const s = st.getState();
  const srcList = () => (isSale ? st.activeSales() : st.activePurchases());
  const qs = query();
  let srcId = qs.get(isSale ? 'sale' : 'purchase') || '';
  let qtys = {};
  const dateI = dateInput({ value: today(), max: today() });
  const reasonS = select(REASONS[kind], REASONS[kind][0]);
  const reasonOther = input({ placeholder: 'Describe the reason', hidden: true });
  reasonS.onchange = () => { reasonOther.hidden = reasonS.value !== 'Other'; };
  const refundI = num({ min: 0, value: 0 });
  const refundMode = select([['cash', 'Cash'], ['bank', 'Bank / UPI']], 'cash');
  const linesBox = h('div');
  const summary = h('div', { class: 'totals' });

  const srcCombo = combo({
    options: () => srcList().map(d => ({ value: d.id, label: `${d.no} — ${st.party(d.partyId)?.name}`, sub: `${fdate(d.date)} · ${money(st.totals(d).grand)}${d.supplierInv ? ' · bill ' + d.supplierInv : ''}`, search: d.date + ' ' + (d.supplierInv || '') })),
    value: srcId, autofocus: !srcId, placeholder: isSale ? 'Search invoice no. or customer…' : 'Search purchase no., supplier bill or supplier…',
    onChange: v => { srcId = v; qtys = {}; renderLines(); },
  });

  const draft = () => ({ [isSale ? 'saleId' : 'purchaseId']: srcId, lines: Object.entries(qtys).map(([idx, q]) => ({ idx: +idx, qty: +q || 0 })) });
  const updateSummary = () => {
    const t = st.returnTotals(draft(), kind);
    fill(summary, 
      h('div', { class: 'tot-row' }, h('span', null, 'Return quantity'), h('span', null, qty(t.qty))),
      h('div', { class: 'tot-row' }, h('span', null, 'Taxable value'), h('span', null, amt(t.taxable))),
      h('div', { class: 'tot-row' }, h('span', null, 'GST'), h('span', null, amt(t.tax))),
      h('div', { class: 'tot-row grand' }, h('span', null, 'Return value'), h('span', null, money(t.total))),
      h('div', { class: 'muted small' }, isSale ? 'Customer account is credited with the return value less any refund paid now.' : 'Supplier account is debited with the return value less any refund received now.'));
    refundI.max = t.total;
    return t;
  };
  const renderLines = () => {
    const src = srcList().find(d => d.id === srcId);
    if (!src) { fill(linesBox, h('div', { class: 'empty' }, icon('search'), `Choose the original ${isSale ? 'sale' : 'purchase'} to see its items.`)); updateSummary(); return; }
    const t = st.totals(src);
    fill(linesBox, 
      h('div', { class: 'src-info' }, h('b', null, src.no), ` · ${fdate(src.date)} · ${st.party(src.partyId)?.name} · ${money(t.grand)} · paid ${money(src.paid)} · ${st.location(src.location)?.name}`),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl compact' },
        h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, isSale ? 'Sold' : 'Purchased'), h('th', { class: 'num' }, 'Returned'), h('th', { class: 'num' }, 'Returnable'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'Return qty'), h('th', { class: 'num' }, 'Value'))),
        h('tbody', null, t.lines.map((l, idx) => {
          const done = st.returnedQty(kind, src.id, idx);
          const left = round2(l.qty - done);
          const val = h('span', null, '0.00');
          const inp = num({ min: 0, max: left, value: qtys[idx] || '', disabled: left <= 0, 'aria-label': 'Return quantity for ' + st.item(l.itemId).name, placeholder: '0' });
          inp.addEventListener('input', () => {
            qtys[idx] = inp.value;
            inp.classList.toggle('invalid', +inp.value > left || +inp.value < 0);
            val.textContent = amt(st.returnTotals({ [isSale ? 'saleId' : 'purchaseId']: src.id, lines: [{ idx, qty: +inp.value || 0 }] }, kind).total);
            const tt = updateSummary();
            if (isSale && src.mode !== 'credit') refundI.value = tt.total;
          });
          return h('tr', null, h('td', null, st.item(l.itemId).name, h('div', { class: 'cell-hint' }, st.item(l.itemId).code)), h('td', { class: 'num' }, qty(l.qty)), h('td', { class: 'num' }, qty(done)), h('td', { class: 'num strong' }, qty(left)), h('td', { class: 'num' }, amt(l.rate)), h('td', { class: 'num' }, inp), h('td', { class: 'num' }, val));
        })))));
    refundMode.value = src.mode === 'cash' ? 'cash' : 'bank';
    updateSummary();
  };
  renderLines();

  const save = () => {
    const reason = reasonS.value === 'Other' ? reasonOther.value : reasonS.value;
    const payload = { ...draft(), date: dateI.value, reason, refund: +refundI.value || 0, mode: refundMode.value };
    const rec = attempt(() => (isSale ? st.saveSalesReturn(payload) : st.savePurchaseReturn(payload)), r => `${r.no} saved — stock ${isSale ? 'added back' : 'reduced'}`);
    if (rec) navigate(`/${isSale ? 'sales' : 'purchase'}-return?view=${rec.id}`);
  };
  setHooks({ save });

  // History
  let q = '';
  const list = () => (isSale ? st.getState().salesReturns : st.getState().purchaseReturns);
  const table = dataTable({
    columns: [
      { key: 'no', label: 'Return No.', render: r => h('span', { class: 'mono' }, r.no) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'src', label: isSale ? 'Invoice' : 'Purchase', value: r => (isSale ? s.sales.find(x => x.id === r.saleId) : s.purchases.find(x => x.id === r.purchaseId))?.no },
      { key: 'party', label: isSale ? 'Customer' : 'Supplier', value: r => st.party(r.partyId)?.name }, { key: 'reason', label: 'Reason' },
      { key: 'qty', label: 'Qty', type: 'qty', value: r => st.totals(r).qty }, { key: 'value', label: 'Value', type: 'money', value: r => st.totals(r).total, total: true },
      { key: 'refund', label: isSale ? 'Refunded' : 'Refund recd.', type: 'money', total: true },
    ],
    onRowClick: r => viewReturn(kind, r), pageSize: 15,
  });
  const refresh = () => table.setRows([...list()].reverse().filter(r => matches(q, r.no, st.party(r.partyId)?.name, r.reason, r.date)));
  refresh();
  const ex = exportButtons(() => table.exportTable(isSale ? 'Sales Returns' : 'Purchase Returns', ''));
  const view = qs.get('view') && list().find(r => r.id === qs.get('view'));
  if (view) onMounted(() => viewReturn(kind, view));

  return h('div', { class: 'page' },
    pageHeader(isSale ? 'Sales Return' : 'Purchase Return', [{ label: isSale ? 'Sales Return' : 'Purchase Return' }], [h('span', { class: 'muted small' }, 'Ctrl+S to save')]),
    h('div', { class: 'card form-card' },
      h('div', { class: 'form-grid cols-4' },
        h('div', { class: 'field span-2' }, h('label', null, `Original ${isSale ? 'sale' : 'purchase'} `, h('span', { class: 'req' }, '*')), srcCombo),
        field('Return date', dateI, { req: true }), field('Return No.', input({ value: st.peekNo(isSale ? 'sr' : 'pr', isSale ? 'SR' : 'PR'), readOnly: true, class: 'input mono', tabindex: '-1' }))),
      linesBox),
    h('div', { class: 'bill-foot' },
      h('div', { class: 'card' }, h('div', { class: 'form-grid cols-2' },
        h('div', { class: 'field span-2' }, h('label', null, 'Return reason ', h('span', { class: 'req' }, '*')), reasonS, reasonOther),
        field(isSale ? 'Refund paid now (₹)' : 'Refund received now (₹)', refundI, { hint: 'Leave 0 to adjust against the account' }), field('Refund mode', refundMode))),
      h('div', { class: 'card' }, summary)),
    h('div', { class: 'action-bar' }, h('button', { class: 'btn btn-primary', onclick: save }, icon('save'), `Save ${isSale ? 'Sales' : 'Purchase'} Return`)),
    card(`${isSale ? 'Sales' : 'Purchase'} return history`, h('div', null, h('div', { class: 'toolbar' }, searchBox({ placeholder: 'Search returns…', onInput: v => { q = v; refresh(); } }), h('div', { class: 'grow' }), ex.el), table)));
}

function viewReturn(kind, r) {
  const t = st.totals(r);
  const src = t.src;
  const m = modal({
    title: `${r.no} — ${kind === 'sale' ? 'Sales' : 'Purchase'} return`, width: 680,
    body: h('div', { class: 'stack' },
      h('div', { class: 'kv' }, h('div', null, h('span', null, 'Date'), h('b', null, fdate(r.date))), h('div', null, h('span', null, 'Against'), h('a', { href: `#/${kind === 'sale' ? 'sales' : 'purchases'}/${src?.id}`, onclick: () => m.close() }, src?.no)), h('div', null, h('span', null, 'Party'), h('b', null, st.party(r.partyId)?.name)), h('div', null, h('span', null, 'Reason'), h('b', null, r.reason))),
      h('table', { class: 'tbl compact' }, h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Taxable'), h('th', { class: 'num' }, 'GST'), h('th', { class: 'num' }, 'Value'))),
        h('tbody', null, t.lines.map(l => h('tr', null, h('td', null, st.item(l.itemId).name), h('td', { class: 'num' }, qty(l.qty)), h('td', { class: 'num' }, amt(l.taxable)), h('td', { class: 'num' }, amt(l.tax)), h('td', { class: 'num' }, amt(l.total))))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'num' }, qty(t.qty)), h('td', { class: 'num' }, amt(t.taxable)), h('td', { class: 'num' }, amt(t.tax)), h('td', { class: 'num' }, amt(t.total))))),
      h('div', { class: 'kv' }, h('div', null, h('span', null, kind === 'sale' ? 'Refund paid' : 'Refund received'), h('b', null, `${money(r.refund)} (${r.mode})`)), h('div', null, h('span', null, 'Adjusted to account'), h('b', null, money(t.total - r.refund))))),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Close')],
  });
}
