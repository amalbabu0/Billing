// The report module: one generic report screen (report list on the left, filters, search,
// summary, table, Excel/CSV/print) driven by the report definitions below.
import * as st from '../store.js';
import { h, money, amt, qty, pct, today, fdate, matches, monthStart, inRange, sum, round2, addDays, daysBetween, fill } from '../utils.js';
import { icon, dataTable, searchBox, select, dateInput, combo, exportButtons, kpi, statusBadge, badge, attempt, fmt, toast } from '../ui.js';
import { navigate, query, setHooks } from '../router.js';
import { modeLabel, paidStatus } from './billing.js';
import { refPath } from './accounts.js';
import { gstr1Json } from '../gst.js';
import { download } from '../export.js';

const MODES = [['', 'All payment modes'], ['cash', 'Cash'], ['card', 'Card'], ['upi', 'UPI'], ['bank', 'Bank'], ['credit', 'Credit']];
const pname = id => st.party(id)?.name || '';
const mono = v => h('span', { class: 'mono' }, v);
const net = (a, b) => round2(a - b);

// Sales returns grouped by original sale, with line detail (for profit & net figures).
function returnsBySale(from, to) {
  const map = {};
  for (const r of st.getState().salesReturns) if (inRange(r.date, from, to)) { (map[r.saleId] ||= []).push(r); }
  return map;
}

/** Filters a report can use: date, asof, customer, supplier, agent, salesperson, mode, gstType, item, location, category, status, side, partyType */
export const REPORTS = [
  {
    key: 'purchase-summary', title: 'Purchase Summary', group: 'Purchase', filters: ['date', 'supplier', 'mode'],
    build(f) {
      const rows = st.purchasesInRange(f.from, f.to).filter(p => (!f.supplier || p.partyId === f.supplier) && (!f.mode || p.mode === f.mode)).map(p => ({ id: p.id, p, t: st.totals(p) }));
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date', value: r => r.p.date }, { key: 'no', label: 'Voucher', value: r => r.p.no, render: r => mono(r.p.no) }, { key: 'inv', label: 'Supplier Invoice', value: r => r.p.supplierInv },
          { key: 'sup', label: 'Supplier', value: r => pname(r.p.partyId) }, { key: 'mode', label: 'Payment', value: r => modeLabel(r.p.mode) },
          { key: 'amount', label: 'Amount', type: 'money', value: r => r.t.taxable, total: true }, { key: 'tax', label: 'Tax', type: 'money', value: r => r.t.tax, total: true },
          { key: 'total', label: 'Total', type: 'money', value: r => r.t.grand, total: true }, { key: 'status', label: 'Payment Status', value: r => paidStatus(r.p), render: r => statusBadge(paidStatus(r.p)) }],
        rows, open: r => navigate('/purchases/' + r.id),
        summary: [['Purchases', rows.length], ['Total purchase amount', money(sum(rows, r => r.t.subtotal))], ['Discount', money(sum(rows, r => r.t.discount))], ['Tax', money(sum(rows, r => r.t.tax))], ['Net amount', money(sum(rows, r => r.t.grand))]],
      };
    },
  },
  {
    key: 'purchase-details', title: 'Purchase Details', group: 'Purchase', filters: ['date', 'supplier', 'mode'],
    build(f) {
      const rows = [];
      st.purchasesInRange(f.from, f.to).filter(p => (!f.supplier || p.partyId === f.supplier) && (!f.mode || p.mode === f.mode)).forEach((p, pi) => st.totals(p).lines.forEach((l, i) => rows.push({ id: p.id + i, p, l, first: i === 0, band: pi % 2 })));
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date', value: r => r.p.date }, { key: 'no', label: 'Voucher', value: r => r.p.no, render: r => (r.first ? mono(r.p.no) : h('span', { class: 'muted' }, '〃')) }, { key: 'inv', label: 'Supplier Inv.', value: r => r.p.supplierInv },
          { key: 'sup', label: 'Supplier', value: r => pname(r.p.partyId) }, { key: 'item', label: 'Item', value: r => st.item(r.l.itemId).name }, { key: 'hsn', label: 'HSN', value: r => st.item(r.l.itemId).hsn },
          { key: 'qty', label: 'Qty', type: 'qty', value: r => r.l.qty, total: true }, { key: 'rate', label: 'Rate', type: 'money', value: r => r.l.rate }, { key: 'disc', label: 'Disc %', type: 'qty', value: r => r.l.disc },
          { key: 'taxable', label: 'Taxable', type: 'money', value: r => r.l.taxable, total: true }, { key: 'gst', label: 'GST %', type: 'qty', value: r => r.l.gst }, { key: 'tax', label: 'Tax', type: 'money', value: r => r.l.tax, total: true }, { key: 'total', label: 'Amount', type: 'money', value: r => r.l.total, total: true }],
        rows, open: r => navigate('/purchases/' + r.p.id), rowClass: r => (r.band ? 'band' : ''), sortable: false,
        summary: [['Invoices', new Set(rows.map(r => r.p.id)).size], ['Lines', rows.length], ['Taxable', money(sum(rows, r => r.l.taxable))], ['Tax', money(sum(rows, r => r.l.tax))]],
      };
    },
  },
  {
    key: 'sales-summary', title: 'Sales Summary', group: 'Sales', filters: ['date', 'customer', 'salesperson', 'mode'],
    build(f) {
      const rows = st.salesInRange(f.from, f.to).filter(s => (!f.customer || s.partyId === f.customer) && (!f.salesperson || s.salesperson === f.salesperson) && (!f.mode || s.mode === f.mode)).map(s => ({ id: s.id, s, t: st.totals(s) }));
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date', value: r => r.s.date }, { key: 'no', label: 'Invoice', value: r => r.s.no, render: r => mono(r.s.no) }, { key: 'cust', label: 'Customer', value: r => pname(r.s.partyId) },
          { key: 'sp', label: 'Salesperson', value: r => r.s.salesperson }, { key: 'mode', label: 'Mode', value: r => modeLabel(r.s.mode) },
          { key: 'gross', label: 'Gross', type: 'money', value: r => r.t.subtotal, total: true }, { key: 'disc', label: 'Discount', type: 'money', value: r => r.t.discount, total: true },
          { key: 'tax', label: 'Tax', type: 'money', value: r => r.t.tax, total: true }, { key: 'net', label: 'Net Sales', type: 'money', value: r => r.t.grand, total: true },
          { key: 'status', label: 'Payment', value: r => paidStatus(r.s), render: r => statusBadge(paidStatus(r.s)) }],
        rows, open: r => navigate('/sales/' + r.id),
        summary: [['Number of bills', rows.length], ['Gross sales', money(sum(rows, r => r.t.subtotal))], ['Discount', money(sum(rows, r => r.t.discount))], ['Tax', money(sum(rows, r => r.t.tax))], ['Net sales', money(sum(rows, r => r.t.grand))]],
      };
    },
  },
  {
    key: 'sales-details', title: 'Sales Details', group: 'Sales', filters: ['date', 'customer', 'salesperson', 'mode'],
    build(f) {
      const rows = [];
      st.salesInRange(f.from, f.to).filter(s => (!f.customer || s.partyId === f.customer) && (!f.salesperson || s.salesperson === f.salesperson) && (!f.mode || s.mode === f.mode)).forEach((s, si) => st.totals(s).lines.forEach((l, i) => rows.push({ id: s.id + i, s, l, first: i === 0, band: si % 2 })));
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date', value: r => r.s.date }, { key: 'no', label: 'Invoice', value: r => r.s.no, render: r => (r.first ? mono(r.s.no) : h('span', { class: 'muted' }, '〃')) }, { key: 'cust', label: 'Customer', value: r => pname(r.s.partyId) },
          { key: 'item', label: 'Item', value: r => st.item(r.l.itemId).name }, { key: 'hsn', label: 'HSN', value: r => st.item(r.l.itemId).hsn }, { key: 'qty', label: 'Qty', type: 'qty', value: r => r.l.qty, total: true },
          { key: 'rate', label: 'Rate', type: 'money', value: r => r.l.rate }, { key: 'disc', label: 'Discount', type: 'money', value: r => r.l.discount, total: true }, { key: 'taxable', label: 'Taxable', type: 'money', value: r => r.l.taxable, total: true },
          { key: 'gst', label: 'GST %', type: 'qty', value: r => r.l.gst }, { key: 'tax', label: 'Tax', type: 'money', value: r => r.l.tax, total: true }, { key: 'total', label: 'Amount', type: 'money', value: r => r.l.total, total: true }],
        rows, open: r => navigate('/sales/' + r.s.id), rowClass: r => (r.band ? 'band' : ''), sortable: false,
        summary: [['Invoices', new Set(rows.map(r => r.s.id)).size], ['Lines', rows.length], ['Quantity', qty(sum(rows, r => r.l.qty))], ['Taxable', money(sum(rows, r => r.l.taxable))], ['Tax', money(sum(rows, r => r.l.tax))]],
      };
    },
  },
  {
    key: 'gstr1', title: 'GSTR1 (Sales)', group: 'GST', filters: ['date', 'gstType', 'customer'],
    build(f) {
      const rows = [];
      const push = (doc, t, kind, sign) => {
        const p = st.party(doc.partyId);
        const type = kind === 'CDN' ? 'CDN' : p.gstin ? 'B2B' : t.interstate && t.total > 250000 ? 'B2CL' : 'B2CS';
        const byRate = {};
        t.lines.forEach(l => { const k = st.item(l.itemId).hsn + '|' + l.gst; const x = (byRate[k] ||= { hsn: st.item(l.itemId).hsn, rate: l.gst, taxable: 0, cgst: 0, sgst: 0, igst: 0 }); x.taxable += l.taxable; x.cgst += l.cgst; x.sgst += l.sgst; x.igst += l.igst; });
        Object.values(byRate).forEach((x, i) => rows.push({ id: doc.id + i, doc, kind, type, gstin: p.gstin, pos: p.state, inter: t.interstate, hsn: x.hsn, rate: x.rate, taxable: round2(sign * x.taxable), cgst: round2(sign * x.cgst), sgst: round2(sign * x.sgst), igst: round2(sign * x.igst), total: round2(sign * (x.taxable + x.cgst + x.sgst + x.igst)) }));
      };
      st.salesInRange(f.from, f.to).forEach(s => push(s, st.totals(s), 'INV', 1));
      st.getState().salesReturns.filter(r => inRange(r.date, f.from, f.to)).forEach(r => push(r, st.totals(r), 'CDN', -1));
      const out = rows.filter(r => (!f.customer || r.doc.partyId === f.customer) && (!f.gstType || (f.gstType === 'inter' ? r.inter : f.gstType === 'intra' ? !r.inter : f.gstType === 'B2C' ? r.type.startsWith('B2C') : r.type === f.gstType)));
      return {
        columns: [{ key: 'no', label: 'Invoice No.', value: r => r.doc.no, render: r => mono(r.doc.no) }, { key: 'date', label: 'Date', type: 'date', value: r => r.doc.date }, { key: 'cust', label: 'Customer', value: r => pname(r.doc.partyId) },
          { key: 'gstin', label: 'GSTIN', value: r => r.gstin || 'URP', render: r => mono(r.gstin || 'URP') }, { key: 'type', label: 'Type', render: r => badge(r.type, r.type === 'CDN' ? 'warn' : r.type === 'B2B' ? 'info' : 'muted'), value: r => r.type },
          { key: 'pos', label: 'Place of Supply', value: r => r.pos }, { key: 'hsn', label: 'HSN' }, { key: 'rate', label: 'Rate %', type: 'qty' },
          { key: 'taxable', label: 'Taxable Value', type: 'money', total: true }, { key: 'cgst', label: 'CGST', type: 'money', total: true }, { key: 'sgst', label: 'SGST', type: 'money', total: true }, { key: 'igst', label: 'IGST', type: 'money', total: true }, { key: 'total', label: 'Total', type: 'money', total: true }],
        rows: out, open: r => navigate(r.kind === 'CDN' ? '/sales-return?view=' + r.doc.id : '/sales/' + r.doc.id),
        summary: [['Invoices', new Set(out.filter(r => r.kind === 'INV').map(r => r.doc.id)).size], ['Credit notes', new Set(out.filter(r => r.kind === 'CDN').map(r => r.doc.id)).size], ['Taxable value', money(sum(out, r => r.taxable))], ['Total tax', money(sum(out, r => r.cgst + r.sgst + r.igst))]],
        note: 'B2B = customer has GSTIN; B2CL = unregistered inter-state invoice above ₹2.5 lakh; B2CS = other unregistered sales; CDN = credit notes from sales returns (negative). The JSON file follows the GST offline-tool sections (b2b, b2cl, b2cs, cdnr, hsn) for one month; check it before uploading on the portal.',
        actions: [['Download GSTR-1 JSON', () => {
          const r = attempt(() => gstr1Json(f.from, f.to));
          if (!r) return;
          download(new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' }), `GSTR1_${st.S().business.gstin}_${r.json.fp}.json`);
          toast('GSTR-1 JSON downloaded', r.warnings.length ? 'bad' : 'ok', r.warnings.length ? r.warnings.join('; ') : `Period ${r.label}`);
        }]],
      };
    },
  },
  {
    key: 'gstr2', title: 'GSTR2 (Purchase)', group: 'GST', filters: ['date', 'gstType', 'supplier'],
    build(f) {
      const rows = [];
      const push = (doc, t, kind, sign, invNo) => {
        const p = st.party(doc.partyId);
        const byRate = {};
        t.lines.forEach(l => { const k = st.item(l.itemId).hsn + '|' + l.gst; const x = (byRate[k] ||= { hsn: st.item(l.itemId).hsn, rate: l.gst, taxable: 0, cgst: 0, sgst: 0, igst: 0 }); x.taxable += l.taxable; x.cgst += l.cgst; x.sgst += l.sgst; x.igst += l.igst; });
        Object.values(byRate).forEach((x, i) => rows.push({ id: doc.id + i, doc, kind, invNo, gstin: p.gstin, inter: t.interstate, hsn: x.hsn, rate: x.rate, taxable: round2(sign * x.taxable), cgst: round2(sign * x.cgst), sgst: round2(sign * x.sgst), igst: round2(sign * x.igst), total: round2(sign * (x.taxable + x.cgst + x.sgst + x.igst)) }));
      };
      st.purchasesInRange(f.from, f.to).forEach(p => push(p, st.totals(p), 'INV', 1, p.supplierInv || p.no));
      st.getState().purchaseReturns.filter(r => inRange(r.date, f.from, f.to)).forEach(r => push(r, st.totals(r), 'DN', -1, r.no));
      const out = rows.filter(r => (!f.supplier || r.doc.partyId === f.supplier) && (!f.gstType || (f.gstType === 'inter' ? r.inter : f.gstType === 'intra' ? !r.inter : f.gstType === 'CDN' ? r.kind === 'DN' : f.gstType === 'B2B' ? r.gstin && r.kind === 'INV' : !r.gstin)));
      return {
        columns: [{ key: 'sup', label: 'Supplier', value: r => pname(r.doc.partyId) }, { key: 'gstin', label: 'GSTIN', value: r => r.gstin || 'URP', render: r => mono(r.gstin || 'URP') },
          { key: 'inv', label: 'Invoice', value: r => r.invNo, render: r => h('span', null, mono(r.invNo), r.kind === 'DN' ? badge('Debit note', 'warn') : null) }, { key: 'date', label: 'Date', type: 'date', value: r => r.doc.date },
          { key: 'hsn', label: 'HSN' }, { key: 'rate', label: 'Rate %', type: 'qty' },
          { key: 'taxable', label: 'Taxable Value', type: 'money', total: true }, { key: 'cgst', label: 'CGST', type: 'money', total: true }, { key: 'sgst', label: 'SGST', type: 'money', total: true }, { key: 'igst', label: 'IGST', type: 'money', total: true }, { key: 'total', label: 'Total', type: 'money', total: true }],
        rows: out, open: r => navigate(r.kind === 'DN' ? '/purchase-return?view=' + r.doc.id : '/purchases/' + r.doc.id),
        summary: [['Invoices', new Set(out.filter(r => r.kind === 'INV').map(r => r.doc.id)).size], ['Debit notes', new Set(out.filter(r => r.kind === 'DN').map(r => r.doc.id)).size], ['Taxable value', money(sum(out, r => r.taxable))], ['Input tax (ITC)', money(sum(out, r => r.cgst + r.sgst + r.igst))]],
      };
    },
  },
  {
    key: 'gstr-summary', title: 'GSTR Summary', group: 'GST', filters: ['date'],
    build(f) {
      const agg = list => list.reduce((a, t) => ({ taxable: a.taxable + t.taxable, cgst: a.cgst + t.cgst, sgst: a.sgst + t.sgst, igst: a.igst + t.igst }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      const sales = agg(st.salesInRange(f.from, f.to).map(st.totals));
      const cn = agg(st.getState().salesReturns.filter(r => inRange(r.date, f.from, f.to)).map(st.totals));
      const pur = agg(st.purchasesInRange(f.from, f.to).map(st.totals));
      const dn = agg(st.getState().purchaseReturns.filter(r => inRange(r.date, f.from, f.to)).map(st.totals));
      const sub = (a, b) => ({ taxable: a.taxable - b.taxable, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst, igst: a.igst - b.igst });
      const outNet = sub(sales, cn), inNet = sub(pur, dn), pay = sub(outNet, inNet);
      const row = (id, label, x, cls, noTaxable) => ({ id, label, taxable: noTaxable ? null : round2(x.taxable), cgst: round2(x.cgst), sgst: round2(x.sgst), igst: round2(x.igst), tax: round2(x.cgst + x.sgst + x.igst), cls });
      const rows = [row(1, 'Output GST — Sales', sales), row(2, 'Less: Credit notes (sales returns)', cn), row(3, 'Net Output GST', outNet, 'strong'), row(4, 'Input GST — Purchases', pur), row(5, 'Less: Debit notes (purchase returns)', dn), row(6, 'Net Input GST (ITC)', inNet, 'strong'), row(7, 'Net GST payable', pay, 'grand', true)];
      const payable = round2(pay.cgst + pay.sgst + pay.igst);
      return {
        columns: [{ key: 'label', label: 'Particulars' }, { key: 'taxable', label: 'Taxable Value', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' }, { key: 'tax', label: 'Total Tax', type: 'money' }],
        rows, rowClass: r => r.cls || '', sortable: false,
        summary: [['Output GST', money(outNet.cgst + outNet.sgst + outNet.igst)], ['Input GST', money(inNet.cgst + inNet.sgst + inNet.igst)], ['CGST payable', money(pay.cgst)], ['SGST payable', money(pay.sgst)], ['IGST payable', money(pay.igst)], [payable >= 0 ? 'Net GST payable' : 'Excess ITC (carry forward)', money(Math.abs(payable)), payable > 0 ? 'warn' : 'green']],
        note: 'Prototype computation without cross-utilisation rules; a negative figure is input credit carried forward.',
      };
    },
  },
  {
    key: 'item-profit', title: 'Item-Wise Profit', group: 'Profit', perm: 'profit', filters: ['date', 'category'],
    build(f) {
      const map = {};
      const add = (itemId, qn, sales, cost) => { const x = (map[itemId] ||= { id: itemId, qty: 0, sales: 0, cost: 0 }); x.qty += qn; x.sales += sales; x.cost += cost; };
      st.salesInRange(f.from, f.to).forEach(s => st.totals(s).lines.forEach(l => add(l.itemId, l.qty, l.taxable, (l.cost || 0) * l.qty)));
      st.getState().salesReturns.filter(r => inRange(r.date, f.from, f.to)).forEach(r => st.totals(r).lines.forEach(l => add(l.itemId, -l.qty, -l.taxable, -l.cost)));
      const rows = Object.values(map).filter(x => !f.category || st.item(x.id).category === f.category).map(x => ({ ...x, sales: round2(x.sales), cost: round2(x.cost), profit: round2(x.sales - x.cost), pct: x.sales ? ((x.sales - x.cost) / x.sales) * 100 : NaN }));
      const ts = sum(rows, r => r.sales), tc = sum(rows, r => r.cost);
      return {
        columns: [{ key: 'item', label: 'Item', value: r => st.item(r.id).name }, { key: 'cat', label: 'Category', value: r => st.item(r.id).category }, { key: 'qty', label: 'Qty Sold', type: 'qty', total: true },
          { key: 'sales', label: 'Sales Amount', type: 'money', total: true }, { key: 'cost', label: 'Cost', type: 'money', total: true },
          { key: 'profit', label: 'Gross Profit', type: 'money', total: true, render: r => h('span', { class: r.profit < 0 ? 't-bad' : '' }, amt(r.profit)) }, { key: 'pct', label: 'Profit %', type: 'pct', total: rs => { const s2 = sum(rs, r => r.sales); return s2 ? (sum(rs, r => r.profit) / s2) * 100 : NaN; } }],
        rows, open: r => navigate('/reports/item-transaction?item=' + r.id), defaultSort: 'profit',
        summary: [['Items', rows.length], ['Sales (taxable)', money(ts)], ['Cost', money(tc)], ['Gross profit', money(ts - tc), 'green'], ['Margin', pct(ts ? ((ts - tc) / ts) * 100 : NaN)]],
        note: 'Sales amount is the taxable value (excluding GST) net of sales returns. Cost is the item cost at the time of sale.',
      };
    },
  },
  {
    key: 'bill-profit', title: 'Bill-Wise Profit', group: 'Profit', perm: 'profit', filters: ['date', 'customer'],
    build(f) {
      const rets = returnsBySale();
      const rows = st.salesInRange(f.from, f.to).filter(s => !f.customer || s.partyId === f.customer).map(s => {
        const t = st.totals(s);
        const rs = rets[s.id] || [];
        const sales = round2(t.taxable - sum(rs, r => st.totals(r).taxable)), cost = round2(t.cost - sum(rs, r => st.totals(r).cost));
        return { id: s.id, s, sales, cost, profit: round2(sales - cost), pct: sales ? ((sales - cost) / sales) * 100 : NaN, returned: rs.length > 0 };
      });
      const ts = sum(rows, r => r.sales), tc = sum(rows, r => r.cost);
      return {
        columns: [{ key: 'no', label: 'Invoice', value: r => r.s.no, render: r => h('span', null, mono(r.s.no), r.returned ? badge('returns', 'warn') : null) }, { key: 'date', label: 'Date', type: 'date', value: r => r.s.date }, { key: 'cust', label: 'Customer', value: r => pname(r.s.partyId) },
          { key: 'sales', label: 'Sales', type: 'money', total: true }, { key: 'cost', label: 'Cost', type: 'money', total: true }, { key: 'profit', label: 'Profit', type: 'money', total: true, render: r => h('span', { class: r.profit < 0 ? 't-bad' : '' }, amt(r.profit)) },
          { key: 'pct', label: 'Profit %', type: 'pct', total: rs => { const s2 = sum(rs, r => r.sales); return s2 ? (sum(rs, r => r.profit) / s2) * 100 : NaN; } }],
        rows, open: r => navigate('/sales/' + r.id),
        summary: [['Bills', rows.length], ['Sales (taxable)', money(ts)], ['Cost', money(tc)], ['Profit', money(ts - tc), 'green'], ['Margin', pct(ts ? ((ts - tc) / ts) * 100 : NaN)]],
        note: 'Sales exclude GST and are net of any returns against the bill.',
      };
    },
  },
  {
    key: 'hsn', title: 'HSN-Wise', group: 'GST', filters: ['date', 'side'],
    build(f) {
      const map = {};
      const docs = f.side === 'purchase' ? st.purchasesInRange(f.from, f.to) : st.salesInRange(f.from, f.to);
      docs.forEach(d => st.totals(d).lines.forEach(l => {
        const it = st.item(l.itemId);
        const x = (map[it.hsn] ||= { id: it.hsn, hsn: it.hsn, items: new Set(), cats: new Set(), qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
        x.items.add(it.id); x.cats.add(it.category); x.qty += l.qty; x.taxable += l.taxable; x.cgst += l.cgst; x.sgst += l.sgst; x.igst += l.igst;
      }));
      const rows = Object.values(map).map(x => ({ ...x, desc: [...x.cats].join(', '), count: x.items.size, total: round2(x.taxable + x.cgst + x.sgst + x.igst) }));
      return {
        columns: [{ key: 'hsn', label: 'HSN', render: r => mono(r.hsn) }, { key: 'desc', label: 'Description' }, { key: 'count', label: 'Item Count', type: 'qty', total: true }, { key: 'qty', label: 'Quantity', type: 'qty', total: true },
          { key: 'taxable', label: 'Taxable Value', type: 'money', total: true }, { key: 'cgst', label: 'CGST', type: 'money', total: true }, { key: 'sgst', label: 'SGST', type: 'money', total: true }, { key: 'igst', label: 'IGST', type: 'money', total: true }, { key: 'total', label: 'Total', type: 'money', total: true }],
        rows,
        summary: [['HSN codes', rows.length], ['Taxable value', money(sum(rows, r => r.taxable))], ['Total tax', money(sum(rows, r => r.cgst + r.sgst + r.igst))], ['Invoice value', money(sum(rows, r => r.total))]],
        note: `${f.side === 'purchase' ? 'Purchases' : 'Sales'} in the period, grouped by HSN (before returns and round-off).`,
      };
    },
  },
  { key: 'receivable', title: 'Receivable', group: 'Accounts', filters: ['asof', 'customer', 'status'], statusOptions: [['', 'All ages'], ...st.AGING.map(([b]) => [b, b])], build: f => agingReport('customer', f) },
  { key: 'payable', title: 'Payable', group: 'Accounts', filters: ['asof', 'supplier', 'status'], statusOptions: [['', 'All ages'], ...st.AGING.map(([b]) => [b, b])], build: f => agingReport('supplier', f) },
  {
    key: 'due-amount', title: 'Due Amount', group: 'Accounts', filters: ['date', 'partyType', 'party', 'status'], statusOptions: [['', 'All dues'], ['overdue', 'Overdue'], ['notdue', 'Not yet due']],
    build(f) {
      const t = today();
      const rows = [];
      for (const type of ['customer', 'supplier']) {
        if (f.partyType && f.partyType !== type) continue;
        st.outstanding(type, t).rows.forEach(b => rows.push({ ...b, id: b.id + type, type }));
      }
      const out = rows.filter(b => (!f.party || b.partyId === f.party) && inRange(b.date, f.from, f.to) && (!f.status || (f.status === 'overdue' ? b.due < t : b.due >= t)));
      const rec = sum(out.filter(r => r.type === 'customer'), r => r.balance), pay = sum(out.filter(r => r.type === 'supplier'), r => r.balance);
      return {
        columns: [{ key: 'type', label: 'Type', value: r => (r.type === 'customer' ? 'Receivable' : 'Payable'), render: r => badge(r.type === 'customer' ? 'Receivable' : 'Payable', r.type === 'customer' ? 'info' : 'warn') },
          { key: 'party', label: 'Party', value: r => pname(r.partyId) }, { key: 'no', label: 'Bill', render: r => mono(r.no), value: r => r.no }, { key: 'date', label: 'Bill Date', type: 'date' }, { key: 'due', label: 'Due Date', type: 'date' },
          { key: 'amount', label: 'Amount', type: 'money', total: true }, { key: 'paid', label: 'Paid', type: 'money', total: true }, { key: 'balance', label: 'Balance', type: 'money', total: true },
          { key: 'status', label: 'Due Status', value: r => (r.due < t ? `Overdue ${r.days}d` : `Due in ${daysBetween(t, r.due)}d`), render: r => badge(r.due < t ? `Overdue ${r.days}d` : `Due in ${daysBetween(t, r.due)}d`, r.due < t ? 'bad' : 'ok') }],
        rows: out, open: r => r.doc && navigate((r.type === 'customer' ? '/sales/' : '/purchases/') + r.doc.id), defaultSort: 'due',
        summary: [['Open bills', out.length], ['Receivable', money(rec)], ['Payable', money(pay)], ['Overdue', money(sum(out.filter(r => r.due < t), r => r.balance)), 'warn'], ['Total outstanding', money(rec + pay)]],
      };
    },
  },
  {
    key: 'agent', title: 'Agent-Wise Report', group: 'Sales', filters: ['date'],
    build(f) {
      const rows = st.getState().agents.map(a => ({ id: a.id, a, ...st.commissionFor(a.id, f.from, f.to) }));
      return {
        columns: [{ key: 'agent', label: 'Agent', value: r => r.a.name }, { key: 'bills', label: 'Bills', type: 'qty', total: true }, { key: 'gross', label: 'Sales', type: 'money', total: true }, { key: 'returns', label: 'Returns', type: 'money', total: true },
          { key: 'net', label: 'Net Sales', type: 'money', total: true }, { key: 'rate', label: 'Comm. %', type: 'qty', value: r => r.a.commission }, { key: 'commission', label: 'Commission', type: 'money', total: true }],
        rows,
        summary: [['Agents', rows.length], ['Bills', sum(rows, r => r.bills)], ['Net sales', money(sum(rows, r => r.net))], ['Commission payable', money(sum(rows, r => r.commission)), 'warn']],
        note: 'Sales are taxable values (before GST); returns are those against the agent’s bills in the period.',
      };
    },
  },
  {
    key: 'purchase-order', title: 'Purchase Order', group: 'Purchase', filters: ['date', 'supplier', 'status'], statusOptions: [['', 'All statuses'], ...st.PO_STATUSES.map(s => [s, s])],
    build(f) {
      const rows = st.getState().pos.filter(p => inRange(p.date, f.from, f.to) && (!f.supplier || p.partyId === f.supplier) && (!f.status || p.status === f.status)).map(p => {
        const ordered = sum(p.lines, l => l.qty), recd = sum(p.lines, l => l.received || 0);
        return { id: p.id, p, ordered, recd, pending: p.status === 'Cancelled' ? 0 : round2(ordered - recd), value: st.poTotal(p), pendingValue: p.status === 'Cancelled' ? 0 : sum(p.lines, l => Math.max(0, l.qty - (l.received || 0)) * l.rate) };
      });
      return {
        columns: [{ key: 'no', label: 'PO Number', value: r => r.p.no, render: r => mono(r.p.no) }, { key: 'date', label: 'Date', type: 'date', value: r => r.p.date }, { key: 'exp', label: 'Expected', type: 'date', value: r => r.p.expected },
          { key: 'sup', label: 'Supplier', value: r => pname(r.p.partyId) }, { key: 'items', label: 'Items', value: r => r.p.lines.map(l => st.item(l.itemId).name).join(', ') },
          { key: 'ordered', label: 'Ordered', type: 'qty', total: true }, { key: 'recd', label: 'Received', type: 'qty', total: true }, { key: 'pending', label: 'Pending', type: 'qty', total: true },
          { key: 'value', label: 'Total', type: 'money', total: true }, { key: 'pendingValue', label: 'Pending Value', type: 'money', total: true }, { key: 'status', label: 'Status', value: r => r.p.status, render: r => statusBadge(r.p.status) }],
        rows, open: r => navigate('/po?open=' + r.id),
        summary: [['Orders', rows.length], ['Order value', money(sum(rows, r => r.value))], ['Pending value', money(sum(rows, r => r.pendingValue)), 'warn'], ['Fully received', rows.filter(r => r.p.status === 'Received').length]],
      };
    },
  },
  {
    key: 'item-sales', title: 'Item-Wise Sales', group: 'Sales', filters: ['date', 'category', 'customer'],
    build(f) {
      const map = {};
      st.salesInRange(f.from, f.to).filter(s => !f.customer || s.partyId === f.customer).forEach(s => st.totals(s).lines.forEach(l => {
        const x = (map[l.itemId] ||= { id: l.itemId, qty: 0, gross: 0, discount: 0, taxable: 0, tax: 0, total: 0, bills: new Set() });
        x.qty += l.qty; x.gross += l.gross; x.discount += l.discount; x.taxable += l.taxable; x.tax += l.tax; x.total += l.total; x.bills.add(s.id);
      }));
      const rows = Object.values(map).filter(x => !f.category || st.item(x.id).category === f.category).map(x => ({ ...x, billCount: x.bills.size }));
      return {
        columns: [{ key: 'item', label: 'Item', value: r => st.item(r.id).name }, { key: 'code', label: 'Code', value: r => st.item(r.id).code, render: r => mono(st.item(r.id).code) }, { key: 'cat', label: 'Category', value: r => st.item(r.id).category },
          { key: 'billCount', label: 'Bills', type: 'qty' }, { key: 'qty', label: 'Quantity Sold', type: 'qty', total: true }, { key: 'unit', label: 'Unit', value: r => st.item(r.id).unit },
          { key: 'gross', label: 'Sales', type: 'money', total: true }, { key: 'discount', label: 'Discount', type: 'money', total: true }, { key: 'tax', label: 'Tax', type: 'money', total: true }, { key: 'total', label: 'Net Sales', type: 'money', total: true }],
        rows, open: r => navigate('/reports/item-transaction?item=' + r.id), defaultSort: 'total',
        summary: [['Items sold', rows.length], ['Sales', money(sum(rows, r => r.gross))], ['Discount', money(sum(rows, r => r.discount))], ['Tax', money(sum(rows, r => r.tax))], ['Net sales', money(sum(rows, r => r.total))]],
      };
    },
  },
  {
    key: 'item-transaction', title: 'Item-Wise Transaction', group: 'Stock', filters: ['item', 'date', 'location'],
    build(f) {
      if (!f.item) return { columns: [{ key: 'x', label: 'Choose an item' }], rows: [], empty: 'Choose an item above to see every stock movement.', summary: [] };
      const it = st.item(f.item);
      const all = st.movements(f.item).filter(m => !f.location || m.loc === f.location);
      const opening = sum(all.filter(m => f.from && m.date < f.from), m => m.qty);
      let bal = opening;
      const rows = all.filter(m => inRange(m.date, f.from, f.to)).map((m, i) => ({ id: i, ...m, in: m.qty > 0 ? m.qty : 0, out: m.qty < 0 ? -m.qty : 0, balance: (bal = round2(bal + m.qty)) }));
      if (f.from) rows.unshift({ id: 'open', date: f.from, type: 'Opening balance', ref: '', loc: f.location, in: 0, out: 0, balance: opening });
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Transaction Type' }, { key: 'ref', label: 'Reference', render: r => mono(r.ref) }, { key: 'loc', label: 'Location', value: r => st.location(r.loc)?.name || (f.location ? '' : 'All') },
          { key: 'in', label: 'Qty In', type: 'qty', total: true }, { key: 'out', label: 'Qty Out', type: 'qty', total: true }, { key: 'balance', label: 'Balance', type: 'qty', total: rs => (rs.length ? rs[rs.length - 1].balance : 0) }],
        rows, sortable: false, open: r => r.kind && navigate(refPath(r.kind, r.refId)),
        subtitle: `${it.name} (${it.code})`,
        summary: [['Item', it.code], ['Opening', `${qty(opening)} ${it.unit}`], ['In', qty(sum(rows, r => r.in))], ['Out', qty(sum(rows, r => r.out))], ['Closing', `${qty(rows.length ? rows[rows.length - 1].balance : opening)} ${it.unit}`, 'green']],
      };
    },
  },
  {
    key: 'loading-list', title: 'Items Loading List', group: 'Stock', filters: ['date', 'location', 'status'], statusOptions: [['', 'All statuses'], ...st.LOADING_STATUSES.map(s => [s, s])],
    build(f, refresh) {
      const rows = st.loadingRows().filter(r => inRange(r.date, f.from, f.to) && (!f.location || r.loc === f.location) && (!f.status || r.status === f.status)).map(r => ({ ...r, id: r.key }));
      const setStatus = (keys, s) => { if (attempt(() => st.setLoadingStatus(keys, s), `${keys.length} line(s) marked ${s.toLowerCase()}`)) refresh(); };
      return {
        columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'ref', label: 'Reference', render: r => mono(r.ref) }, { key: 'cust', label: 'Customer', value: r => pname(r.partyId) },
          { key: 'item', label: 'Item', value: r => st.item(r.itemId).name }, { key: 'qty', label: 'Quantity', type: 'qty', total: true }, { key: 'unit', label: 'Unit', value: r => st.item(r.itemId).unit },
          { key: 'loc', label: 'Location', value: r => st.location(r.loc)?.name },
          { key: 'status', label: 'Status', value: r => r.status, render: r => h('select', { class: 'input input-sm status-sel s-' + r.status.toLowerCase(), 'aria-label': 'Loading status', onchange: e => setStatus([r.key], e.target.value) }, st.LOADING_STATUSES.map(s => h('option', { value: s, selected: s === r.status }, s))) }],
        rows, open: null,
        actions: [['Mark all shown Loaded', () => setStatus(rows.filter(r => r.status === 'Pending').map(r => r.key), 'Loaded')], ['Mark all shown Completed', () => setStatus(rows.filter(r => r.status !== 'Completed').map(r => r.key), 'Completed')]],
        summary: [['Lines', rows.length], ['Pending', rows.filter(r => r.status === 'Pending').length, 'warn'], ['Loaded', rows.filter(r => r.status === 'Loaded').length], ['Completed', rows.filter(r => r.status === 'Completed').length, 'green']],
      };
    },
  },
];

function agingReport(type, f) {
  const asOf = f.asof || today();
  const { rows: all, advance } = st.outstanding(type, asOf);
  const rows = all.filter(b => b.date <= asOf && (!f[type] || b.partyId === f[type])).map(b => ({ ...b, bucket: st.agingBucket(b.days) })).filter(b => !f.status || b.bucket === f.status);
  const buckets = st.AGING.map(([b]) => [b, money(sum(rows.filter(r => r.bucket === b), r => r.balance)), b === '90+ days' ? 'bad' : b === 'Current' ? 'green' : null]);
  return {
    columns: [{ key: 'party', label: type === 'customer' ? 'Customer' : 'Supplier', value: r => pname(r.partyId) }, { key: 'no', label: type === 'customer' ? 'Invoice' : 'Bill', value: r => (r.extraRef ? `${r.no} (${r.extraRef})` : r.no), render: r => h('span', null, mono(r.no), r.extraRef ? h('span', { class: 'muted small' }, ' ' + r.extraRef) : null) },
      { key: 'date', label: 'Invoice Date', type: 'date' }, { key: 'due', label: 'Due Date', type: 'date' }, { key: 'amount', label: 'Invoice Amount', type: 'money', total: true }, { key: 'paid', label: 'Paid', type: 'money', total: true },
      { key: 'balance', label: 'Balance', type: 'money', total: true }, { key: 'days', label: 'Days Due', type: 'qty' }, { key: 'bucket', label: 'Aging', render: r => badge(r.bucket, r.bucket === 'Current' ? 'ok' : r.bucket === '90+ days' ? 'bad' : 'warn') }],
    rows, open: r => r.doc && navigate((type === 'customer' ? '/sales/' : '/purchases/') + r.doc.id), defaultSort: 'days',
    summary: [...buckets, ['Total outstanding', money(sum(rows, r => r.balance)), 'warn']],
    note: `As on ${fdate(asOf)}. Payments settle the bill they were made against first, then the oldest bills.${advance ? ` Unadjusted advances: ${money(advance)}.` : ''}`,
  };
}

// ---------------------------------------------------------------- page
const GROUPS = ['Purchase', 'Sales', 'GST', 'Profit', 'Accounts', 'Stock'];
const PRESETS = [['Today', () => [today(), today()]], ['This month', () => [monthStart(), today()]], ['Last month', () => { const last = addDays(monthStart(), -1); return [last.slice(0, 8) + '01', last]; }], ['Last 90 days', () => [addDays(today(), -89), today()]], ['This FY', () => { const t = today(); const y = +t.slice(5, 7) >= 4 ? +t.slice(0, 4) : +t.slice(0, 4) - 1; return [`${y}-04-01`, t]; }], ['All', () => ['', today()]]];

export function reportsPage({ key } = {}) {
  const available = REPORTS.filter(r => !r.perm || st.can(r.perm));
  const rep = available.find(r => r.key === key);
  const side = h('nav', { class: 'report-nav', 'aria-label': 'Reports' },
    h('div', { class: 'report-nav-head' }, 'Reports'),
    GROUPS.map(g => { const list = available.filter(r => r.group === g); return list.length ? [h('div', { class: 'report-group' }, g), list.map(r => h('a', { href: '#/reports/' + r.key, class: 'report-link' + (r.key === key ? ' active' : '') }, r.title))] : null; }));
  if (!rep) {
    return h('div', { class: 'page report-page' }, h('div', { class: 'report-layout' }, side,
      h('div', { class: 'report-main' }, h('div', { class: 'page-head' }, h('div', null, h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), h('span', { class: 'sep' }, '›'), h('span', null, 'Reports')), h('h1', null, 'Reports'))),
        key ? h('div', { class: 'notice' }, icon('alert'), 'That report is not available for your role.') : null,
        h('div', { class: 'report-cards' }, GROUPS.map(g => { const list = available.filter(r => r.group === g); return list.length ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, g)), h('div', { class: 'card-body report-card-links' }, list.map(r => h('a', { href: '#/reports/' + r.key }, icon('chart'), r.title)))) : null; })))));
  }
  const qs = query();
  const saved = st.temp.get()['rf-' + rep.key] || {};
  const f = { from: monthStart(), to: today(), asof: today(), side: 'sale', ...saved, q: '' };
  if (rep.key === 'item-transaction' && !saved.from) f.from = '';
  if (qs.get('item')) f.item = qs.get('item');
  if (qs.get('party')) f.party = qs.get('party');
  const s = st.getState();
  const persist = () => { const { q, ...rest } = f; st.temp.set('rf-' + rep.key, rest); };

  const filterEls = [];
  const on = (k, v) => { f[k] = v; persist(); refresh(); };
  let fromI, toI;
  for (const k of rep.filters) {
    if (k === 'date') {
      fromI = dateInput({ value: f.from, 'aria-label': 'Date from', onchange: e => on('from', e.target.value) });
      toI = dateInput({ value: f.to, 'aria-label': 'Date to', onchange: e => on('to', e.target.value) });
      const preset = select([['', 'Period…'], ...PRESETS.map(([l], i) => [i, l])], '', { 'aria-label': 'Date preset', class: 'input preset', onchange: e => { if (e.target.value === '') return; const [a, b] = PRESETS[+e.target.value][1](); f.from = a; f.to = b; fromI.value = a; toI.value = b; e.target.value = ''; persist(); refresh(); } });
      filterEls.push(h('label', { class: 'inline' }, 'Date From', fromI), h('label', { class: 'inline' }, 'To', toI), preset);
    } else if (k === 'asof') filterEls.push(h('label', { class: 'inline' }, 'As on', dateInput({ value: f.asof, onchange: e => on('asof', e.target.value) })));
    else if (k === 'customer' || k === 'supplier') filterEls.push(select([['', k === 'customer' ? 'All customers' : 'All suppliers'], ...s.parties.filter(p => p.type === k).map(p => [p.id, p.name])], f[k], { 'aria-label': k, onchange: e => on(k, e.target.value) }));
    else if (k === 'party') filterEls.push(select([['', 'All parties'], ...s.parties.map(p => [p.id, `${p.name} (${p.type === 'customer' ? 'C' : 'S'})`])], f.party, { 'aria-label': 'Party', onchange: e => on('party', e.target.value) }));
    else if (k === 'partyType') filterEls.push(select([['', 'Customers & suppliers'], ['customer', 'Customers (receivable)'], ['supplier', 'Suppliers (payable)']], f.partyType, { 'aria-label': 'Party type', onchange: e => on('partyType', e.target.value) }));
    else if (k === 'salesperson') filterEls.push(select([['', 'All salespersons'], ...s.users.map(u => [u.name, u.name])], f.salesperson, { 'aria-label': 'Salesperson', onchange: e => on('salesperson', e.target.value) }));
    else if (k === 'mode') filterEls.push(select(MODES, f.mode, { 'aria-label': 'Payment mode', onchange: e => on('mode', e.target.value) }));
    else if (k === 'gstType') filterEls.push(select([['', 'All GST types'], ['B2B', 'B2B (registered)'], ['B2C', 'B2C (unregistered)'], ['CDN', rep.key === 'gstr2' ? 'Debit notes' : 'Credit notes'], ['intra', 'Intra-state (CGST+SGST)'], ['inter', 'Inter-state (IGST)']], f.gstType, { 'aria-label': 'GST type', onchange: e => on('gstType', e.target.value) }));
    else if (k === 'category') filterEls.push(select([['', 'All categories'], ...s.categories.map(c => [c, c])], f.category, { 'aria-label': 'Category', onchange: e => on('category', e.target.value) }));
    else if (k === 'location') filterEls.push(select([['', 'All locations'], ...s.locations.map(l => [l.id, l.name])], f.location, { 'aria-label': 'Location', onchange: e => on('location', e.target.value) }));
    else if (k === 'status') filterEls.push(select(rep.statusOptions, f.status, { 'aria-label': 'Status', onchange: e => on('status', e.target.value) }));
    else if (k === 'side') filterEls.push(select([['sale', 'Sales (outward)'], ['purchase', 'Purchases (inward)']], f.side, { 'aria-label': 'Sales or purchases', onchange: e => on('side', e.target.value) }));
    else if (k === 'item') filterEls.push(h('div', { class: 'item-pick' }, combo({ options: () => s.items.map(i => ({ value: i.id, label: i.name, sub: `${i.code} · stock ${qty(st.stockOf(i.id))} ${i.unit}` })), value: f.item, autofocus: !f.item, placeholder: 'Choose item…', onChange: v => on('item', v) })));
  }
  const search = searchBox({ placeholder: 'Search in report… ( / )', onInput: v => { f.q = v; applySearch(); } });
  const summaryEl = h('div', { class: 'kpi-grid kpi-sm' });
  const noteEl = h('p', { class: 'muted small report-note' });
  const actionsEl = h('div', { class: 'row' });
  const tableHost = h('div');
  let table = null, built = null;
  const subtitle = () => {
    const parts = [];
    if (rep.filters.includes('date')) parts.push(`${f.from ? fdate(f.from) : 'Beginning'} to ${fdate(f.to)}`);
    if (rep.filters.includes('asof')) parts.push('As on ' + fdate(f.asof));
    ['customer', 'supplier', 'party'].forEach(k => f[k] && rep.filters.includes(k) && parts.push(pname(f[k])));
    if (f.mode && rep.filters.includes('mode')) parts.push(modeLabel(f.mode));
    if (f.salesperson && rep.filters.includes('salesperson')) parts.push(f.salesperson);
    if (f.category && rep.filters.includes('category')) parts.push(f.category);
    if (f.location && rep.filters.includes('location')) parts.push(st.location(f.location)?.name);
    if (f.status && rep.filters.includes('status')) parts.push(f.status);
    if (f.gstType && rep.filters.includes('gstType')) parts.push(f.gstType);
    if (built?.subtitle) parts.unshift(built.subtitle);
    if (f.q) parts.push(`search “${f.q}”`);
    return parts.join(' · ');
  };
  const applySearch = () => {
    if (!table) return;
    const cols = built.columns;
    table.setRows(built.rows.filter(r => !f.q || matches(f.q, ...cols.map(c => { const v = c.value ? c.value(r) : r[c.key]; return c.type === 'date' ? `${v} ${fdate(v)}` : fmt(v, c.type); }))));
  };
  const refresh = () => {
    built = rep.build(f, refresh);
    const cols = built.sortable === false ? built.columns.map(c => ({ ...c, sortable: false })) : built.columns;
    table = dataTable({ columns: cols, onRowClick: built.open || null, rowClass: built.rowClass, empty: built.empty || 'No records for these filters', pageSize: 100, maxHeight: 'calc(100vh - 330px)', numbered: true });
    fill(tableHost, table);
    fill(summaryEl, ...(built.summary || []).map(([l, v, tone]) => kpi(l, String(v), null, tone)));
    noteEl.textContent = built.note || '';
    fill(actionsEl, ...(built.actions || []).map(([l, fn]) => h('button', { class: 'btn btn-sm', onclick: fn }, l)));
    applySearch();
  };
  const ex = exportButtons(() => table.exportTable(rep.title, subtitle(), (built.summary || []).map(([l, v]) => [l, String(v)])));
  setHooks({ print: ex.print });
  refresh();
  const reset = () => { st.temp.set('rf-' + rep.key, null); navigate('/reports/' + rep.key + '?reset=' + Date.now()); };
  return h('div', { class: 'page report-page' }, h('div', { class: 'report-layout' }, side,
    h('div', { class: 'report-main' },
      h('div', { class: 'page-head' }, h('div', null, h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), h('span', { class: 'sep' }, '›'), h('a', { href: '#/reports' }, 'Reports'), h('span', { class: 'sep' }, '›'), h('span', null, rep.group)), h('h1', null, rep.title)), h('div', { class: 'page-actions' }, ex.el)),
      h('div', { class: 'toolbar wrap report-filters' }, ...filterEls, search, h('button', { class: 'btn btn-ghost', onclick: reset, title: 'Reset filters' }, 'Reset')),
      summaryEl, actionsEl, tableHost, noteEl)));
}
