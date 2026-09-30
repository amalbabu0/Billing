// Data layer: state, persistence (localStorage), business rules and derived figures.
// Every screen reads and writes through this module, so a real API can later replace
// load/commit without touching the pages.
import { round2, sum, uid, today, addDays, daysBetween, inRange } from './utils.js';

const DATA_KEY = 'wp-erp-data-v1';
const TEMP_KEY = 'wp-erp-temp-v1';

export class ValidationError extends Error {
  constructor(errors) { super(Array.isArray(errors) ? errors.join('\n') : errors); this.errors = Array.isArray(errors) ? errors : [errors]; }
}

let state = null;
let version = 0;
const listeners = new Set();

export const PERMS = [
  ['sales', 'Sales & sales returns'], ['purchases', 'Purchases, returns & orders'], ['stock', 'Stock entry & transfers'],
  ['accounts', 'Cash & cheque entries'], ['reports', 'Reports'], ['profit', 'See cost & profit'], ['settings', 'Settings & masters'],
];

export function emptyState() {
  return {
    settings: {
      business: { name: 'Wood Piller Resellers', address: 'XIV/412, NH Bypass, Edappally, Kochi, Kerala - 682024', phone: '+91 484 280 4455', email: 'accounts@woodpiller.in', gstin: '32AAHFW4817K1Z3', state: 'Kerala' },
      tax: { rates: [0, 5, 12, 18, 28], defaultRate: 18 },
      invoice: { salePrefix: 'INV', purchasePrefix: 'PUR', startNo: 1, decimals: 2, roundOff: true, creditDays: 30 },
      inventory: { allowNegative: false, defaultReorder: 10 },
      openingCash: 150000, openingBank: 1500000, openingDate: '2026-06-30',
      currentUserId: 'u1',
    },
    locations: [{ id: 'L1', name: 'Main Godown' }, { id: 'L2', name: 'Showroom' }, { id: 'L3', name: 'Kalamassery Yard' }],
    categories: [], items: [], parties: [], agents: [], users: [
      { id: 'u1', name: 'Admin', role: 'Administrator', perms: Object.fromEntries(PERMS.map(([k]) => [k, true])) },
    ],
    sales: [], purchases: [], salesReturns: [], purchaseReturns: [], adjustments: [], transfers: [], cheques: [], cash: [], pos: [],
    loading: {}, counters: {},
  };
}

// ------------------------------------------------------------------ persistence
export function load() {
  try { const raw = localStorage.getItem(DATA_KEY); if (raw) { state = JSON.parse(raw); version++; return true; } } catch { /* fall through */ }
  return false;
}
export function setState(s, persist = true) { state = s; version++; if (persist) save(); notify(); }
export function getState() { return state; }
function save() { try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep working in memory */ } }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach(fn => fn()); }
function commit() { version++; save(); notify(); }
export const dataVersion = () => version;

// Temporary data (search history, remembered filters, held drafts) lives apart from business data.
export const temp = {
  get() { try { return JSON.parse(localStorage.getItem(TEMP_KEY)) || {}; } catch { return {}; } },
  set(k, v) { const t = temp.get(); t[k] = v; try { localStorage.setItem(TEMP_KEY, JSON.stringify(t)); } catch { /* ignore */ } },
  size() { try { return (localStorage.getItem(TEMP_KEY) || '').length; } catch { return 0; } },
  clear() { try { localStorage.removeItem(TEMP_KEY); } catch { /* ignore */ } try { sessionStorage.clear(); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ lookups
export const S = () => state.settings;
export const item = id => state.items.find(i => i.id === id);
export const party = id => state.parties.find(p => p.id === id);
export const agent = id => state.agents.find(a => a.id === id);
export const location = id => state.locations.find(l => l.id === id);
export const customers = () => state.parties.filter(p => p.type === 'customer');
export const suppliers = () => state.parties.filter(p => p.type === 'supplier');
export const currentUser = () => state.users.find(u => u.id === state.settings.currentUserId) || state.users[0];
export const can = perm => !!currentUser()?.perms?.[perm];
export const isInterstate = p => !!p && !!p.state && p.state !== state.settings.business.state;
export const activeSales = () => state.sales.filter(s => s.status === 'saved');
export const activePurchases = () => state.purchases.filter(p => p.status !== 'cancelled');

function nextNo(kind, prefix) {
  const n = (state.counters[kind] || 0) + 1;
  state.counters[kind] = n;
  const year = today().slice(0, 4);
  return `${prefix}/${year}/${String(n).padStart(4, '0')}`;
}
export function peekNo(kind, prefix) {
  const n = (state.counters[kind] || 0) + 1;
  return `${prefix}/${today().slice(0, 4)}/${String(n).padStart(4, '0')}`;
}

// ------------------------------------------------------------------ GST maths
/** One invoice line: gst% is exclusive; disc is a percentage of the gross. */
export function lineCalc(l, interstate) {
  const gross = round2((+l.qty || 0) * (+l.rate || 0));
  const discount = round2(gross * (+l.disc || 0) / 100);
  const taxable = round2(gross - discount);
  const tax = round2(taxable * (+l.gst || 0) / 100);
  const igst = interstate ? tax : 0;
  const cgst = interstate ? 0 : round2(tax / 2);
  const sgst = interstate ? 0 : round2(tax - cgst);
  return { gross, discount, taxable, tax, cgst, sgst, igst, total: round2(taxable + tax) };
}

export function docTotals(doc) {
  const inter = isInterstate(party(doc.partyId));
  const lines = (doc.lines || []).map(l => ({ ...l, ...lineCalc(l, inter) }));
  const t = {
    lines, interstate: inter,
    subtotal: sum(lines, l => l.gross), discount: sum(lines, l => l.discount), taxable: sum(lines, l => l.taxable),
    tax: sum(lines, l => l.tax), cgst: sum(lines, l => l.cgst), sgst: sum(lines, l => l.sgst), igst: sum(lines, l => l.igst),
    qty: sum(lines, l => l.qty), cost: sum(lines, l => (+l.cost || 0) * (+l.qty || 0)),
  };
  const raw = round2(t.taxable + t.tax);
  const grand = state.settings.invoice.roundOff ? Math.round(raw) : raw;
  t.roundOff = round2(grand - raw);
  t.grand = round2(grand);
  return t;
}

/** Value of returned quantities, proportional to the original line (tax included). */
export function returnTotals(ret, kind) {
  const src = kind === 'sale' ? state.sales.find(s => s.id === ret.saleId) : state.purchases.find(p => p.id === ret.purchaseId);
  if (!src) return { lines: [], taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, total: 0, cost: 0, qty: 0 };
  const inter = isInterstate(party(src.partyId));
  const lines = ret.lines.filter(l => l.qty > 0).map(l => {
    const o = src.lines[l.idx];
    const c = lineCalc({ ...o, qty: l.qty }, inter);
    return { ...l, itemId: o.itemId, rate: o.rate, gst: o.gst, cost: round2((o.cost || o.rate) * l.qty), ...c };
  });
  return {
    lines, src, interstate: inter, qty: sum(lines, l => l.qty), taxable: sum(lines, l => l.taxable), tax: sum(lines, l => l.tax),
    cgst: sum(lines, l => l.cgst), sgst: sum(lines, l => l.sgst), igst: sum(lines, l => l.igst), total: sum(lines, l => l.total), cost: sum(lines, l => l.cost),
  };
}

// ------------------------------------------------------------------ derived cache
let cache = { v: -1 };
function derived() {
  if (cache.v === version) return cache;
  const c = { v: version, totals: new Map(), movements: [], stock: new Map() };
  for (const s of state.sales) c.totals.set(s.id, docTotals(s));
  for (const p of state.purchases) c.totals.set(p.id, docTotals(p));
  for (const r of state.salesReturns) c.totals.set(r.id, returnTotals(r, 'sale'));
  for (const r of state.purchaseReturns) c.totals.set(r.id, returnTotals(r, 'purchase'));
  const mv = [];
  const od = state.settings.openingDate;
  for (const it of state.items) for (const [loc, q] of Object.entries(it.opening || {})) if (q) mv.push({ date: od, seq: 0, itemId: it.id, loc, qty: +q, type: 'Opening', ref: 'Opening stock' });
  for (const p of state.purchases) if (p.status !== 'cancelled') p.lines.forEach(l => mv.push({ date: p.date, seq: p.createdAt || 1, itemId: l.itemId, loc: p.location, qty: +l.qty, type: 'Purchase', ref: p.no, refId: p.id, kind: 'purchase' }));
  for (const s of state.sales) if (s.status === 'saved') s.lines.forEach(l => mv.push({ date: s.date, seq: s.createdAt || 2, itemId: l.itemId, loc: s.location, qty: -l.qty, type: 'Sale', ref: s.no, refId: s.id, kind: 'sale' }));
  for (const r of state.salesReturns) { const src = state.sales.find(s => s.id === r.saleId); r.lines.forEach(l => l.qty > 0 && mv.push({ date: r.date, seq: r.createdAt || 3, itemId: src.lines[l.idx].itemId, loc: src.location, qty: +l.qty, type: 'Sales Return', ref: r.no, refId: r.id, kind: 'salesReturn' })); }
  for (const r of state.purchaseReturns) { const src = state.purchases.find(p => p.id === r.purchaseId); r.lines.forEach(l => l.qty > 0 && mv.push({ date: r.date, seq: r.createdAt || 3, itemId: src.lines[l.idx].itemId, loc: src.location, qty: -l.qty, type: 'Purchase Return', ref: r.no, refId: r.id, kind: 'purchaseReturn' })); }
  for (const a of state.adjustments) mv.push({ date: a.date, seq: a.createdAt || 4, itemId: a.itemId, loc: a.loc, qty: +a.qty, type: a.qty >= 0 ? 'Stock Increase' : 'Stock Decrease', ref: a.no, refId: a.id, kind: 'adjustment', note: a.reason });
  for (const t of state.transfers) {
    mv.push({ date: t.date, seq: t.createdAt || 5, itemId: t.itemId, loc: t.from, qty: -t.qty, type: 'Transfer Out', ref: t.no, refId: t.id, kind: 'transfer' });
    mv.push({ date: t.date, seq: (t.createdAt || 5) + 0.5, itemId: t.itemId, loc: t.to, qty: +t.qty, type: 'Transfer In', ref: t.no, refId: t.id, kind: 'transfer' });
  }
  mv.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  c.movements = mv;
  for (const m of mv) {
    let s = c.stock.get(m.itemId);
    if (!s) c.stock.set(m.itemId, s = { total: 0, byLoc: {}, opening: 0, purchased: 0, sold: 0, pr: 0, sr: 0, transferred: 0, adjusted: 0 });
    s.total = round2(s.total + m.qty);
    s.byLoc[m.loc] = round2((s.byLoc[m.loc] || 0) + m.qty);
    if (m.type === 'Opening') s.opening += m.qty;
    else if (m.type === 'Purchase') s.purchased += m.qty;
    else if (m.type === 'Sale') s.sold -= m.qty;
    else if (m.type === 'Purchase Return') s.pr -= m.qty;
    else if (m.type === 'Sales Return') s.sr += m.qty;
    else if (m.type === 'Transfer In') s.transferred += m.qty;
    else if (m.type === 'Transfer Out') { /* counted once via Transfer In */ }
    else s.adjusted += m.qty;
  }
  cache = c;
  return c;
}
export const totals = doc => derived().totals.get(doc.id) || (doc.saleId || doc.purchaseId ? returnTotals(doc, doc.saleId ? 'sale' : 'purchase') : docTotals(doc));
export const movements = itemId => derived().movements.filter(m => !itemId || m.itemId === itemId);
export function stockOf(itemId, loc) {
  const s = derived().stock.get(itemId);
  if (!s) return 0;
  return loc ? (s.byLoc[loc] || 0) : s.total;
}
export const stockDetail = itemId => derived().stock.get(itemId) || { total: 0, byLoc: {}, opening: 0, purchased: 0, sold: 0, pr: 0, sr: 0, transferred: 0, adjusted: 0 };
export function stockStatus(it) {
  const q = stockOf(it.id);
  if (q <= 0) return 'out';
  if (q <= (it.reorder ?? state.settings.inventory.defaultReorder)) return 'low';
  return 'in';
}
export const stockValue = () => sum(state.items, it => Math.max(0, stockOf(it.id)) * (it.cost || 0));

// ------------------------------------------------------------------ validation helpers
function req(errors, v, msg) { if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) errors.push(msg); }
function checkStock(errors, needs, loc, label = 'Available') {
  if (state.settings.inventory.allowNegative) return;
  for (const [itemId, q] of Object.entries(needs)) {
    const have = stockOf(itemId, loc);
    if (q > have + 1e-9) errors.push(`${item(itemId)?.name ?? itemId}: only ${have} ${item(itemId)?.unit ?? ''} available at ${location(loc)?.name ?? loc} (${label.toLowerCase()} ${q}).`);
  }
}
function checkLines(errors, lines) {
  if (!lines.length) errors.push('Add at least one item.');
  lines.forEach((l, i) => {
    const n = `Row ${i + 1}`;
    if (!item(l.itemId)) errors.push(`${n}: choose an item.`);
    if (!(l.qty > 0)) errors.push(`${n}: quantity must be more than zero.`);
    if (!(l.rate >= 0)) errors.push(`${n}: rate cannot be negative.`);
    if (l.disc < 0 || l.disc > 100) errors.push(`${n}: discount must be between 0 and 100%.`);
  });
}
const cleanLines = lines => (lines || []).filter(l => l.itemId).map(l => ({ itemId: l.itemId, qty: +l.qty || 0, rate: +l.rate || 0, disc: +l.disc || 0, gst: +l.gst || 0 }));

// ------------------------------------------------------------------ masters
export function saveItem(it) {
  const e = [];
  req(e, it.name?.trim(), 'Item name is required.');
  req(e, it.code?.trim(), 'Item code is required.');
  if (state.items.some(x => x.code.toLowerCase() === it.code?.trim().toLowerCase() && x.id !== it.id)) e.push(`Item code ${it.code} already exists.`);
  if (!(it.price >= 0) || !(it.cost >= 0)) e.push('Prices cannot be negative.');
  if (it.hsn && !/^\d{4,8}$/.test(it.hsn)) e.push('HSN must be 4 to 8 digits.');
  if (e.length) throw new ValidationError(e);
  const rec = { reorder: state.settings.inventory.defaultReorder, opening: {}, ...it, name: it.name.trim(), code: it.code.trim().toUpperCase(), price: +it.price, cost: +it.cost, gst: +it.gst, reorder: +it.reorder || 0 };
  if (it.id) Object.assign(state.items.find(x => x.id === it.id), rec);
  else { rec.id = uid('it'); state.items.push(rec); }
  if (rec.category && !state.categories.includes(rec.category)) state.categories.push(rec.category);
  commit();
  return rec;
}
export function saveCategory(name, old) {
  name = name.trim();
  if (!name) throw new ValidationError('Category name is required.');
  if (state.categories.some(c => c.toLowerCase() === name.toLowerCase() && c !== old)) throw new ValidationError('That category already exists.');
  if (old) { state.categories = state.categories.map(c => (c === old ? name : c)); state.items.forEach(i => { if (i.category === old) i.category = name; }); }
  else state.categories.push(name);
  commit();
}
export function deleteCategory(name) {
  if (state.items.some(i => i.category === name)) throw new ValidationError('Move the items in this category first.');
  state.categories = state.categories.filter(c => c !== name);
  commit();
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function saveParty(p) {
  const e = [];
  req(e, p.name?.trim(), 'Name is required.');
  if (!['customer', 'supplier'].includes(p.type)) e.push('Choose customer or supplier.');
  if (p.gstin && !GSTIN_RE.test(p.gstin.toUpperCase())) e.push('GSTIN format is not valid (e.g. 32AAHFW4817K1Z3).');
  if (p.phone && !/^[+\d][\d\s-]{7,}$/.test(p.phone)) e.push('Phone number is not valid.');
  if (e.length) throw new ValidationError(e);
  const rec = { ...p, name: p.name.trim(), gstin: (p.gstin || '').toUpperCase(), opening: +p.opening || 0, creditDays: +p.creditDays || 0 };
  if (p.id) Object.assign(party(p.id), rec);
  else { rec.id = uid('pt'); state.parties.push(rec); }
  commit();
  return rec;
}
export function saveAgent(a) {
  if (!a.name?.trim()) throw new ValidationError('Agent name is required.');
  if (!(a.commission >= 0 && a.commission <= 100)) throw new ValidationError('Commission must be between 0 and 100%.');
  const rec = { ...a, name: a.name.trim(), commission: +a.commission };
  if (a.id) Object.assign(agent(a.id), rec); else { rec.id = uid('ag'); state.agents.push(rec); }
  commit();
  return rec;
}

// ------------------------------------------------------------------ sales & purchases
export function saveSale(doc, { hold = false } = {}) {
  const lines = cleanLines(doc.lines).map(l => ({ ...l, cost: item(l.itemId)?.cost ?? 0 }));
  const e = [];
  req(e, doc.date, 'Invoice date is required.');
  const p = party(doc.partyId);
  if (!p || p.type !== 'customer') e.push('Choose a customer.');
  if (!location(doc.location)) e.push('Choose the location stock is sold from.');
  checkLines(e, lines);
  const draft = { ...doc, lines };
  if (!e.length && !hold) {
    const needs = {};
    lines.forEach(l => { needs[l.itemId] = (needs[l.itemId] || 0) + l.qty; });
    checkStock(e, needs, doc.location, 'Needed');
    const t = docTotals(draft);
    const paid = doc.mode === 'credit' ? +doc.paid || 0 : doc.paid == null || doc.paid === '' ? t.grand : +doc.paid;
    if (paid < 0) e.push('Amount received cannot be negative.');
    if (paid > t.grand + 0.001) e.push('Amount received is more than the bill total.');
    if (p?.walkIn && paid < t.grand - 0.001) e.push('Cash customer bills must be paid in full. Choose a named customer for credit.');
    draft.paid = round2(paid);
  }
  if (e.length) throw new ValidationError(e);
  const existing = doc.id && state.sales.find(s => s.id === doc.id);
  if (existing && existing.status !== 'held') throw new ValidationError('Saved invoices cannot be edited. Cancel it or make a return.');
  const rec = {
    ...draft, id: existing?.id || uid('sl'), status: hold ? 'held' : 'saved', createdAt: Date.now() + Math.random(),
    no: hold ? (existing?.no || 'HOLD-' + String(state.sales.filter(s => s.status === 'held').length + 1).padStart(3, '0')) : nextNo('sale', state.settings.invoice.salePrefix),
    salesperson: doc.salesperson || currentUser().name, dueDate: addDays(doc.date, p.walkIn ? 0 : (p.creditDays || state.settings.invoice.creditDays)),
  };
  if (hold) rec.paid = 0;
  if (existing) Object.assign(existing, rec); else state.sales.push(rec);
  if (!hold) rec.lines.forEach((_, i) => { state.loading[rec.id + ':' + i] = 'Pending'; });
  commit();
  return rec;
}
export function deleteHeld(id) { state.sales = state.sales.filter(s => !(s.id === id && s.status === 'held')); commit(); }
export function cancelSale(id, reason) {
  const s = state.sales.find(x => x.id === id);
  if (!s || s.status !== 'saved') throw new ValidationError('Only saved invoices can be cancelled.');
  if (state.salesReturns.some(r => r.saleId === id)) throw new ValidationError('This invoice has returns; it cannot be cancelled.');
  if (!reason?.trim()) throw new ValidationError('Give a reason for cancelling.');
  s.status = 'cancelled'; s.cancelReason = reason.trim();
  commit();
}

export function savePurchase(doc) {
  const lines = cleanLines(doc.lines);
  const e = [];
  req(e, doc.date, 'Purchase date is required.');
  const p = party(doc.partyId);
  if (!p || p.type !== 'supplier') e.push('Choose a supplier.');
  if (!location(doc.location)) e.push('Choose the location stock is received into.');
  if (doc.supplierInv && state.purchases.some(x => x.partyId === doc.partyId && x.supplierInv?.toLowerCase() === doc.supplierInv.trim().toLowerCase() && x.status !== 'cancelled')) e.push(`Supplier invoice ${doc.supplierInv} is already entered for this supplier.`);
  checkLines(e, lines);
  const po = doc.poId && state.pos.find(x => x.id === doc.poId);
  if (po) lines.forEach(l => {
    const pl = po.lines.find(x => x.itemId === l.itemId);
    if (pl && l.qty > pl.qty - (pl.received || 0) + 1e-9) e.push(`${item(l.itemId).name}: only ${pl.qty - (pl.received || 0)} pending on ${po.no}.`);
  });
  const draft = { ...doc, lines, terms: +doc.terms || 0 };
  if (!e.length) {
    const t = docTotals(draft);
    const paid = doc.mode === 'credit' ? +doc.paid || 0 : doc.paid == null || doc.paid === '' ? t.grand : +doc.paid;
    if (paid < 0) e.push('Amount paid cannot be negative.');
    if (paid > t.grand + 0.001) e.push('Amount paid is more than the bill total.');
    if (doc.mode === 'cash' && paid > cashBalance() + 0.001) e.push(`Cash in hand is only ${cashBalance().toFixed(2)}; pay by bank or on credit.`);
    draft.paid = round2(paid);
  }
  if (e.length) throw new ValidationError(e);
  // Weighted-average cost before adding the new stock.
  for (const l of lines) {
    const it = item(l.itemId);
    const have = Math.max(0, stockOf(l.itemId));
    const net = round2(l.rate * (1 - l.disc / 100));
    it.cost = have + l.qty > 0 ? round2((have * (it.cost || 0) + l.qty * net) / (have + l.qty)) : net;
  }
  const rec = { ...draft, supplierInv: (doc.supplierInv || '').trim(), id: uid('pu'), no: nextNo('purchase', state.settings.invoice.purchasePrefix), status: 'saved', createdAt: Date.now() + Math.random(), dueDate: addDays(doc.date, +doc.terms || 0) };
  state.purchases.push(rec);
  if (po) {
    lines.forEach(l => { const pl = po.lines.find(x => x.itemId === l.itemId); if (pl) pl.received = round2((pl.received || 0) + l.qty); });
    po.status = po.lines.every(x => (x.received || 0) >= x.qty) ? 'Received' : 'Partially Received';
    (po.purchases ||= []).push(rec.id);
  }
  commit();
  return rec;
}

// ------------------------------------------------------------------ returns
export function returnedQty(kind, srcId, idx, exceptId) {
  const list = kind === 'sale' ? state.salesReturns.filter(r => r.saleId === srcId) : state.purchaseReturns.filter(r => r.purchaseId === srcId);
  return sum(list.filter(r => r.id !== exceptId), r => r.lines.filter(l => l.idx === idx).reduce((a, l) => a + l.qty, 0));
}
export function saveSalesReturn(r) {
  const src = state.sales.find(s => s.id === r.saleId);
  const e = [];
  if (!src || src.status !== 'saved') e.push('Choose the original sale.');
  req(e, r.date, 'Return date is required.');
  if (src && r.date < src.date) e.push('Return date cannot be before the sale date.');
  const lines = (r.lines || []).map(l => ({ idx: +l.idx, qty: +l.qty || 0 })).filter(l => l.qty !== 0);
  if (!lines.length) e.push('Enter a return quantity for at least one item.');
  if (src) lines.forEach(l => {
    const o = src.lines[l.idx];
    if (l.qty < 0) e.push('Return quantity cannot be negative.');
    const left = o.qty - returnedQty('sale', src.id, l.idx);
    if (l.qty > left + 1e-9) e.push(`${item(o.itemId).name}: sold ${o.qty}, already returned ${o.qty - left}; at most ${left} can be returned.`);
  });
  if (!r.reason?.trim()) e.push('Give a return reason.');
  if (e.length) throw new ValidationError(e);
  const rec = { id: uid('sr'), no: nextNo('sr', 'SR'), date: r.date, saleId: src.id, partyId: src.partyId, lines, reason: r.reason.trim(), refund: 0, mode: r.mode || 'cash', createdAt: Date.now() + Math.random() };
  const t = returnTotals(rec, 'sale');
  const refund = +r.refund || 0;
  if (refund < 0) throw new ValidationError('Refund cannot be negative.');
  if (refund > t.total + 0.001) throw new ValidationError(`Refund cannot be more than the return value (${t.total.toFixed(2)}).`);
  if (rec.mode === 'cash' && refund > cashBalance() + 0.001) throw new ValidationError(`Cash in hand is only ${cashBalance().toFixed(2)}; refund by bank instead.`);
  rec.refund = round2(refund);
  state.salesReturns.push(rec);
  commit();
  return rec;
}
export function savePurchaseReturn(r) {
  const src = state.purchases.find(p => p.id === r.purchaseId);
  const e = [];
  if (!src || src.status === 'cancelled') e.push('Choose the original purchase.');
  req(e, r.date, 'Return date is required.');
  if (src && r.date < src.date) e.push('Return date cannot be before the purchase date.');
  const lines = (r.lines || []).map(l => ({ idx: +l.idx, qty: +l.qty || 0 })).filter(l => l.qty !== 0);
  if (!lines.length) e.push('Enter a return quantity for at least one item.');
  const needs = {};
  if (src) lines.forEach(l => {
    const o = src.lines[l.idx];
    if (l.qty < 0) e.push('Return quantity cannot be negative.');
    const left = o.qty - returnedQty('purchase', src.id, l.idx);
    if (l.qty > left + 1e-9) e.push(`${item(o.itemId).name}: purchased ${o.qty}, already returned ${o.qty - left}; at most ${left} can be returned.`);
    needs[o.itemId] = (needs[o.itemId] || 0) + l.qty;
  });
  if (src && !e.length) checkStock(e, needs, src.location, 'Returning');
  if (!r.reason?.trim()) e.push('Give a return reason.');
  if (e.length) throw new ValidationError(e);
  const rec = { id: uid('pr'), no: nextNo('pr', 'PR'), date: r.date, purchaseId: src.id, partyId: src.partyId, lines, reason: r.reason.trim(), refund: 0, mode: r.mode || 'cash', createdAt: Date.now() + Math.random() };
  const t = returnTotals(rec, 'purchase');
  const refund = +r.refund || 0;
  if (refund < 0 || refund > t.total + 0.001) throw new ValidationError(`Refund received must be between 0 and the return value (${t.total.toFixed(2)}).`);
  rec.refund = round2(refund);
  state.purchaseReturns.push(rec);
  commit();
  return rec;
}

// ------------------------------------------------------------------ stock
export function saveAdjustment(a) {
  const e = [];
  const it = item(a.itemId);
  if (!it) e.push('Choose an item.');
  if (!location(a.loc)) e.push('Choose a location.');
  req(e, a.date, 'Date is required.');
  const q = +a.qty;
  if (!(q > 0)) e.push('Quantity must be more than zero.');
  if (!a.reason?.trim()) e.push('Give a reason for the adjustment.');
  const signed = a.direction === 'decrease' ? -q : q;
  if (!e.length && signed < 0) checkStock(e, { [a.itemId]: q }, a.loc, 'Decreasing');
  if (e.length) throw new ValidationError(e);
  const rec = { id: uid('adj'), no: nextNo('adj', 'ADJ'), date: a.date, itemId: a.itemId, loc: a.loc, qty: signed, reason: a.reason.trim(), ref: (a.ref || '').trim(), createdAt: Date.now() + Math.random() };
  state.adjustments.push(rec);
  commit();
  return rec;
}
export function saveTransfer(t) {
  const e = [];
  if (!item(t.itemId)) e.push('Choose an item.');
  if (!location(t.from) || !location(t.to)) e.push('Choose both locations.');
  if (t.from && t.from === t.to) e.push('From and To locations must be different.');
  req(e, t.date, 'Date is required.');
  const q = +t.qty;
  if (!(q > 0)) e.push('Quantity must be more than zero.');
  if (!e.length) {
    const have = stockOf(t.itemId, t.from);
    if (q > have + 1e-9) e.push(`Only ${have} ${item(t.itemId).unit} available at ${location(t.from).name}.`);
  }
  if (e.length) throw new ValidationError(e);
  const rec = { id: uid('tr'), no: nextNo('tr', 'TRF'), date: t.date, itemId: t.itemId, from: t.from, to: t.to, qty: q, notes: (t.notes || '').trim(), createdAt: Date.now() + Math.random() };
  state.transfers.push(rec);
  commit();
  return rec;
}

// ------------------------------------------------------------------ cash & cheques
export function saveCash(c) {
  const e = [];
  if (!['receipt', 'payment'].includes(c.type)) e.push('Choose receipt or payment.');
  req(e, c.date, 'Date is required.');
  if (!(+c.amount > 0)) e.push('Amount must be more than zero.');
  if (!c.partyId && !c.description?.trim()) e.push('Choose a party or enter a description.');
  if (c.against) {
    const bill = state.sales.find(s => s.id === c.against) || state.purchases.find(p => p.id === c.against);
    if (!bill || bill.partyId !== c.partyId) e.push('The bill does not belong to this party.');
  }
  if (!e.length && c.type === 'payment' && +c.amount > cashBalance() + 0.001) e.push(`Cash in hand is only ${cashBalance().toFixed(2)}.`);
  if (e.length) throw new ValidationError(e);
  const rec = { id: uid('cs'), no: nextNo('cash-' + c.type, c.type === 'receipt' ? 'CR' : 'CP'), date: c.date, type: c.type, partyId: c.partyId || null, amount: round2(+c.amount), description: (c.description || '').trim(), ref: (c.ref || '').trim(), against: c.against || null, createdAt: Date.now() + Math.random() };
  state.cash.push(rec);
  commit();
  return rec;
}
export const CHEQUE_STATUSES = ['Pending', 'Cleared', 'Bounced', 'Cancelled'];
export function saveCheque(c) {
  const e = [];
  if (!c.chequeNo?.trim() || !/^\d{6}$/.test(c.chequeNo.trim())) e.push('Cheque number must be 6 digits.');
  req(e, c.date, 'Date is required.');
  if (!party(c.partyId)) e.push('Choose a party.');
  if (!c.bank?.trim()) e.push('Bank is required.');
  if (!(+c.amount > 0)) e.push('Amount must be more than zero.');
  if (!['received', 'issued'].includes(c.type)) e.push('Choose received or issued.');
  if (state.cheques.some(x => x.chequeNo === c.chequeNo?.trim() && x.bank.toLowerCase() === c.bank?.trim().toLowerCase() && x.id !== c.id)) e.push('This cheque number is already entered for that bank.');
  if (e.length) throw new ValidationError(e);
  const rec = { id: c.id || uid('cq'), chequeNo: c.chequeNo.trim(), date: c.date, partyId: c.partyId, bank: c.bank.trim(), amount: round2(+c.amount), type: c.type, status: c.status || 'Pending', notes: (c.notes || '').trim(), history: c.history || [{ at: c.date, status: c.status || 'Pending' }], createdAt: Date.now() + Math.random() };
  rec.no = c.no || nextNo('chq-' + c.type, c.type === 'received' ? 'CHR' : 'CHI');
  if (c.id) Object.assign(state.cheques.find(x => x.id === c.id), rec); else state.cheques.push(rec);
  commit();
  return rec;
}
export function setChequeStatus(id, status, date = today()) {
  const c = state.cheques.find(x => x.id === id);
  if (!c) throw new ValidationError('Cheque not found.');
  if (!CHEQUE_STATUSES.includes(status)) throw new ValidationError('Unknown status.');
  if (c.status === 'Cleared' && status !== 'Bounced') throw new ValidationError('A cleared cheque can only be marked bounced.');
  if (c.status === 'Cancelled') throw new ValidationError('A cancelled cheque cannot change.');
  c.status = status; c.statusDate = date;
  (c.history ||= []).push({ at: date, status });
  commit();
}

// ------------------------------------------------------------------ purchase orders & loading
export const PO_STATUSES = ['Draft', 'Ordered', 'Partially Received', 'Received', 'Cancelled'];
export function savePO(po) {
  const lines = (po.lines || []).filter(l => l.itemId).map(l => ({ itemId: l.itemId, qty: +l.qty || 0, rate: +l.rate || 0, received: +l.received || 0 }));
  const e = [];
  const p = party(po.partyId);
  if (!p || p.type !== 'supplier') e.push('Choose a supplier.');
  req(e, po.date, 'PO date is required.');
  if (po.expected && po.expected < po.date) e.push('Expected date cannot be before the PO date.');
  if (!lines.length) e.push('Add at least one item.');
  lines.forEach((l, i) => { if (!(l.qty > 0)) e.push(`Row ${i + 1}: quantity must be more than zero.`); if (l.rate < 0) e.push(`Row ${i + 1}: rate cannot be negative.`); });
  if (e.length) throw new ValidationError(e);
  const existing = po.id && state.pos.find(x => x.id === po.id);
  if (existing && !['Draft', 'Ordered'].includes(existing.status)) throw new ValidationError('Only draft or ordered POs can be edited.');
  const rec = { ...po, lines, status: po.status || 'Draft', notes: (po.notes || '').trim() };
  if (existing) Object.assign(existing, rec);
  else { rec.id = uid('po'); rec.no = nextNo('po', 'PO'); rec.createdAt = Date.now(); state.pos.push(rec); }
  commit();
  return rec;
}
export function setPOStatus(id, status) {
  const po = state.pos.find(x => x.id === id);
  if (!po) throw new ValidationError('PO not found.');
  const allowed = { Draft: ['Ordered', 'Cancelled'], Ordered: ['Cancelled', 'Draft'], 'Partially Received': ['Cancelled'], Received: [], Cancelled: [] }[po.status] || [];
  if (!allowed.includes(status)) throw new ValidationError(`A ${po.status.toLowerCase()} PO cannot be marked ${status.toLowerCase()}.`);
  po.status = status;
  commit();
}
export const poTotal = po => sum(po.lines, l => l.qty * l.rate);

export const LOADING_STATUSES = ['Pending', 'Loaded', 'Completed'];
export function loadingRows() {
  const rows = [];
  for (const s of state.sales) if (s.status === 'saved') s.lines.forEach((l, i) => {
    const key = s.id + ':' + i;
    if (state.loading[key]) rows.push({ key, date: s.date, saleId: s.id, ref: s.no, partyId: s.partyId, itemId: l.itemId, qty: l.qty, loc: s.location, status: state.loading[key] });
  });
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}
export function setLoadingStatus(keys, status) {
  if (!LOADING_STATUSES.includes(status)) throw new ValidationError('Unknown status.');
  keys.forEach(k => { state.loading[k] = status; });
  commit();
}

// ------------------------------------------------------------------ settings & users
export function saveSettings(patch) {
  const e = [];
  const b = patch.business;
  if (b) { if (!b.name?.trim()) e.push('Business name is required.'); if (b.gstin && !GSTIN_RE.test(b.gstin.toUpperCase())) e.push('Business GSTIN format is not valid.'); if (!b.state) e.push('State is required.'); }
  if (patch.tax && (!patch.tax.rates.length || patch.tax.rates.some(r => !(r >= 0 && r <= 40)))) e.push('GST rates must be between 0 and 40%.');
  if (patch.invoice) { if (!/^[A-Z0-9-]{1,8}$/i.test(patch.invoice.salePrefix) || !/^[A-Z0-9-]{1,8}$/i.test(patch.invoice.purchasePrefix)) e.push('Prefixes: 1–8 letters, digits or dashes.'); if (![0, 2].includes(+patch.invoice.decimals)) e.push('Decimals must be 0 or 2.'); }
  if (patch.inventory && !(patch.inventory.defaultReorder >= 0)) e.push('Reorder level cannot be negative.');
  if (e.length) throw new ValidationError(e);
  for (const [k, v] of Object.entries(patch)) state.settings[k] = typeof v === 'object' && !Array.isArray(v) ? { ...state.settings[k], ...v } : v;
  commit();
}
export function saveUser(u) {
  if (!u.name?.trim()) throw new ValidationError('User name is required.');
  if (!u.role?.trim()) throw new ValidationError('Role is required.');
  const rec = { ...u, name: u.name.trim(), role: u.role.trim(), perms: { ...u.perms } };
  if (u.id) {
    const cur = state.users.find(x => x.id === u.id);
    if (cur.id === state.settings.currentUserId && !rec.perms.settings) throw new ValidationError('You cannot remove Settings access from the signed-in user.');
    Object.assign(cur, rec);
  } else { rec.id = uid('u'); state.users.push(rec); }
  commit();
  return rec;
}

// ------------------------------------------------------------------ money: balances & ledgers
export function cashBalance(upTo) {
  const ok = d => !upTo || d <= upTo;
  let b = state.settings.openingCash;
  for (const s of activeSales()) if (s.mode === 'cash' && ok(s.date)) b += s.paid;
  for (const p of activePurchases()) if (p.mode === 'cash' && ok(p.date)) b -= p.paid;
  for (const c of state.cash) if (ok(c.date)) b += c.type === 'receipt' ? c.amount : -c.amount;
  for (const r of state.salesReturns) if (r.mode === 'cash' && ok(r.date)) b -= r.refund;
  for (const r of state.purchaseReturns) if (r.mode === 'cash' && ok(r.date)) b += r.refund;
  return round2(b);
}
export function bankBalance() {
  let b = state.settings.openingBank;
  const bankModes = ['card', 'upi', 'bank'];
  for (const s of activeSales()) if (bankModes.includes(s.mode)) b += s.paid;
  for (const p of activePurchases()) if (bankModes.includes(p.mode)) b -= p.paid;
  for (const c of state.cheques) if (c.status === 'Cleared') b += c.type === 'received' ? c.amount : -c.amount;
  for (const r of state.salesReturns) if (r.mode !== 'cash') b -= r.refund;
  for (const r of state.purchaseReturns) if (r.mode !== 'cash') b += r.refund;
  return round2(b);
}

/**
 * Party ledger in the party's own direction: for customers, positive balance = they owe us;
 * for suppliers, positive balance = we owe them. Each entry has `dr` (increases balance) and `cr` (reduces it).
 */
export function ledgerEntries(partyId) {
  const p = party(partyId);
  if (!p) return [];
  const out = [];
  const add = (date, seq, type, ref, dr, cr, extra = {}) => { if (dr || cr) out.push({ date, seq, type, ref, dr: round2(dr), cr: round2(cr), ...extra }); };
  if (p.opening) add(state.settings.openingDate, 0, 'Opening Balance', '', p.opening > 0 ? p.opening : 0, p.opening < 0 ? -p.opening : 0, { group: 'opening' });
  if (p.type === 'customer') {
    for (const s of activeSales().filter(x => x.partyId === partyId)) {
      const t = totals(s);
      add(s.date, s.createdAt, 'Sale', s.no, t.grand, 0, { group: 'sales', kind: 'sale', refId: s.id });
      if (s.paid) add(s.date, s.createdAt + 0.1, `Received (${s.mode})`, s.no, 0, s.paid, { group: 'receipts', kind: 'sale', refId: s.id });
    }
    for (const r of state.salesReturns.filter(x => x.partyId === partyId)) {
      add(r.date, r.createdAt, 'Sales Return', r.no, 0, totals(r).total, { group: 'returns', kind: 'salesReturn', refId: r.id });
      if (r.refund) add(r.date, r.createdAt + 0.1, 'Refund paid', r.no, r.refund, 0, { group: 'adjustments', kind: 'salesReturn', refId: r.id });
    }
  } else {
    for (const pu of activePurchases().filter(x => x.partyId === partyId)) {
      const t = totals(pu);
      add(pu.date, pu.createdAt, 'Purchase', pu.no, t.grand, 0, { group: 'purchases', kind: 'purchase', refId: pu.id });
      if (pu.paid) add(pu.date, pu.createdAt + 0.1, `Paid (${pu.mode})`, pu.no, 0, pu.paid, { group: 'payments', kind: 'purchase', refId: pu.id });
    }
    for (const r of state.purchaseReturns.filter(x => x.partyId === partyId)) {
      add(r.date, r.createdAt, 'Purchase Return', r.no, 0, totals(r).total, { group: 'returns', kind: 'purchaseReturn', refId: r.id });
      if (r.refund) add(r.date, r.createdAt + 0.1, 'Refund received', r.no, r.refund, 0, { group: 'adjustments', kind: 'purchaseReturn', refId: r.id });
    }
  }
  const inflow = p.type === 'customer' ? 'receipt' : 'payment';
  for (const c of state.cash.filter(x => x.partyId === partyId)) {
    if (c.type === inflow) add(c.date, c.createdAt, p.type === 'customer' ? 'Cash Receipt' : 'Cash Payment', c.no, 0, c.amount, { group: p.type === 'customer' ? 'receipts' : 'payments', kind: 'cash', refId: c.id });
    else add(c.date, c.createdAt, p.type === 'customer' ? 'Cash Payment' : 'Cash Receipt', c.no, c.amount, 0, { group: 'adjustments', kind: 'cash', refId: c.id });
  }
  const chqIn = p.type === 'customer' ? 'received' : 'issued';
  for (const c of state.cheques.filter(x => x.partyId === partyId && x.status === 'Cleared')) {
    if (c.type === chqIn) add(c.statusDate || c.date, c.createdAt, `Cheque ${c.type} #${c.chequeNo}`, c.no, 0, c.amount, { group: p.type === 'customer' ? 'receipts' : 'payments', kind: 'cheque', refId: c.id });
    else add(c.statusDate || c.date, c.createdAt, `Cheque ${c.type} #${c.chequeNo}`, c.no, c.amount, 0, { group: 'adjustments', kind: 'cheque', refId: c.id });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let bal = 0;
  for (const e of out) { bal = round2(bal + e.dr - e.cr); e.balance = bal; }
  return out;
}
export const partyBalance = partyId => { const l = ledgerEntries(partyId); return l.length ? l[l.length - 1].balance : 0; };

/**
 * Bill-wise outstanding for one party. Payments made on a bill (at billing, returns, receipts
 * linked to it) settle that bill first; everything else settles the oldest bills first.
 */
export function billsOutstanding(partyId, asOf = today()) {
  const p = party(partyId);
  if (!p) return { bills: [], advance: 0 };
  const isC = p.type === 'customer';
  const bills = [];
  if (p.opening > 0) bills.push({ id: 'open-' + p.id, no: 'Opening', date: state.settings.openingDate, due: state.settings.openingDate, amount: p.opening, paid: 0 });
  const docs = isC ? activeSales().filter(s => s.partyId === partyId) : activePurchases().filter(x => x.partyId === partyId);
  for (const d of docs) bills.push({ id: d.id, no: d.no, date: d.date, due: d.dueDate || d.date, amount: totals(d).grand, paid: d.paid || 0, doc: d, extraRef: d.supplierInv });
  const byId = Object.fromEntries(bills.map(b => [b.id, b]));
  let pool = p.opening < 0 ? -p.opening : 0;
  const rets = isC ? state.salesReturns.filter(r => r.partyId === partyId) : state.purchaseReturns.filter(r => r.partyId === partyId);
  for (const r of rets) {
    const b = byId[r.saleId || r.purchaseId];
    let net = round2(totals(r).total - r.refund);
    if (b) { const use = Math.min(net, b.amount - b.paid); b.paid = round2(b.paid + use); net = round2(net - use); }
    pool = round2(pool + net);
  }
  const inflow = isC ? 'receipt' : 'payment';
  for (const c of state.cash.filter(x => x.partyId === partyId)) {
    if (c.type !== inflow) { pool = round2(pool - c.amount); continue; }
    let amtLeft = c.amount;
    const b = c.against && byId[c.against];
    if (b) { const use = Math.min(amtLeft, b.amount - b.paid); b.paid = round2(b.paid + use); amtLeft = round2(amtLeft - use); }
    pool = round2(pool + amtLeft);
  }
  const chqIn = isC ? 'received' : 'issued';
  for (const c of state.cheques.filter(x => x.partyId === partyId && x.status === 'Cleared')) pool = round2(pool + (c.type === chqIn ? c.amount : -c.amount));
  bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const b of bills) {
    if (pool <= 0) break;
    const use = Math.min(pool, round2(b.amount - b.paid));
    if (use > 0) { b.paid = round2(b.paid + use); pool = round2(pool - use); }
  }
  // A negative pool (money paid out to the party beyond bills) becomes an extra amount due.
  if (pool < 0) bills.push({ id: 'adj-' + p.id, no: 'Adjustment', date: asOf, due: asOf, amount: -pool, paid: 0 }), pool = 0;
  for (const b of bills) { b.balance = round2(b.amount - b.paid); b.days = Math.max(0, daysBetween(b.due, asOf)); b.partyId = partyId; }
  return { bills, advance: round2(pool) };
}
export const AGING = [['Current', 0, 0], ['1-30 days', 1, 30], ['31-60 days', 31, 60], ['61-90 days', 61, 90], ['90+ days', 91, Infinity]];
export const agingBucket = days => AGING.find(([, a, b]) => days >= a && days <= b)[0];
export function outstanding(type, asOf = today()) {
  const rows = [];
  let advance = 0;
  for (const p of state.parties.filter(x => x.type === type)) {
    const r = billsOutstanding(p.id, asOf);
    advance += r.advance;
    r.bills.filter(b => b.balance > 0.004).forEach(b => rows.push(b));
  }
  return { rows, advance: round2(advance) };
}
export const totalReceivable = () => sum(customers(), p => Math.max(0, partyBalance(p.id)));
export const totalPayable = () => sum(suppliers(), p => Math.max(0, partyBalance(p.id)));

// ------------------------------------------------------------------ day book
export const DAYBOOK_TYPES = ['Sale', 'Purchase', 'Sales Return', 'Purchase Return', 'Cash Receipt', 'Cash Payment', 'Cheque Receipt', 'Cheque Payment', 'Stock Transfer', 'Other'];
/** Debit = value coming in (sales, receipts, purchase returns); Credit = value going out. */
export function dayBook() {
  const rows = [];
  const pn = id => party(id)?.name || '';
  for (const s of activeSales()) { const t = totals(s); rows.push({ date: s.date, seq: s.createdAt, no: s.no, type: 'Sale', partyId: s.partyId, party: pn(s.partyId), desc: `${t.lines.length} item(s) · ${s.mode === 'credit' ? 'credit' : 'paid ' + s.mode}`, dr: t.grand, cr: 0, mode: s.mode, kind: 'sale', refId: s.id }); }
  for (const p of activePurchases()) { const t = totals(p); rows.push({ date: p.date, seq: p.createdAt, no: p.no, type: 'Purchase', partyId: p.partyId, party: pn(p.partyId), desc: `Bill ${p.supplierInv || '-'} · ${t.lines.length} item(s)`, dr: 0, cr: t.grand, mode: p.mode, kind: 'purchase', refId: p.id }); }
  for (const r of state.salesReturns) rows.push({ date: r.date, seq: r.createdAt, no: r.no, type: 'Sales Return', partyId: r.partyId, party: pn(r.partyId), desc: `${r.reason}${r.refund ? ' · refund ' + r.refund.toFixed(2) : ''}`, dr: 0, cr: totals(r).total, mode: r.mode, kind: 'salesReturn', refId: r.id });
  for (const r of state.purchaseReturns) rows.push({ date: r.date, seq: r.createdAt, no: r.no, type: 'Purchase Return', partyId: r.partyId, party: pn(r.partyId), desc: r.reason, dr: totals(r).total, cr: 0, mode: r.mode, kind: 'purchaseReturn', refId: r.id });
  for (const c of state.cash) rows.push({ date: c.date, seq: c.createdAt, no: c.no, type: c.type === 'receipt' ? 'Cash Receipt' : 'Cash Payment', partyId: c.partyId, party: pn(c.partyId), desc: c.description || c.ref, dr: c.type === 'receipt' ? c.amount : 0, cr: c.type === 'payment' ? c.amount : 0, mode: 'cash', kind: 'cash', refId: c.id });
  for (const c of state.cheques) if (c.status !== 'Cancelled') rows.push({ date: c.date, seq: c.createdAt, no: c.no, type: c.type === 'received' ? 'Cheque Receipt' : 'Cheque Payment', partyId: c.partyId, party: pn(c.partyId), desc: `#${c.chequeNo} ${c.bank} · ${c.status}`, dr: c.type === 'received' && c.status !== 'Bounced' ? c.amount : 0, cr: c.type === 'issued' && c.status !== 'Bounced' ? c.amount : 0, mode: 'cheque', kind: 'cheque', refId: c.id });
  for (const t of state.transfers) rows.push({ date: t.date, seq: t.createdAt, no: t.no, type: 'Stock Transfer', partyId: null, party: '', desc: `${item(t.itemId)?.name} × ${t.qty}: ${location(t.from)?.name} → ${location(t.to)?.name}`, dr: 0, cr: 0, mode: '', kind: 'transfer', refId: t.id });
  for (const a of state.adjustments) rows.push({ date: a.date, seq: a.createdAt, no: a.no, type: 'Other', partyId: null, party: '', desc: `Stock ${a.qty > 0 ? 'increase' : 'decrease'}: ${item(a.itemId)?.name} × ${Math.abs(a.qty)} (${a.reason})`, dr: 0, cr: 0, mode: '', kind: 'adjustment', refId: a.id });
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
}

// ------------------------------------------------------------------ misc
export const salesInRange = (from, to) => activeSales().filter(s => inRange(s.date, from, to));
export const purchasesInRange = (from, to) => activePurchases().filter(p => inRange(p.date, from, to));
export function commissionFor(agentId, from, to) {
  const a = agent(agentId);
  const sales = salesInRange(from, to).filter(s => s.agentId === agentId);
  const gross = sum(sales, s => totals(s).taxable);
  const returns = sum(state.salesReturns.filter(r => inRange(r.date, from, to) && sales.concat(activeSales()).some(s => s.id === r.saleId && s.agentId === agentId)), r => totals(r).taxable);
  const net = round2(gross - returns);
  return { bills: sales.length, gross, returns, net, commission: round2(net * (a?.commission || 0) / 100) };
}
