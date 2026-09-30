// Realistic demo data for a Kerala-based wood pillar / timber reseller.
// Transactions are replayed day by day through the real store functions,
// so stock, balances and reports are consistent by construction.
import * as st from './store.js';
import { today, addDays, rng, round2 } from './utils.js';

const CATS = ['Wooden Pillars', 'Door Frames', 'Doors', 'Plywood & Boards', 'Veneers & Laminates', 'Timber', 'Hardware', 'Adhesives & Polish', 'Accessories'];

// code, name, category, hsn, unit, gst, cost, price, reorder, opening L1, opening L2
const ITEMS = [
  ['WP-TK-08', 'Teak Wood Pillar 8 ft (6"x6")', 0, '4418', 'Nos', 18, 14200, 18500, 4, 14, 3],
  ['WP-TK-10', 'Teak Wood Pillar 10 ft (8"x8")', 0, '4418', 'Nos', 18, 23800, 31000, 3, 8, 2],
  ['WP-MH-08', 'Mahogany Round Pillar 8 ft', 0, '4418', 'Nos', 18, 9200, 12400, 4, 16, 4],
  ['WP-JK-09', 'Jackwood Turned Pillar 9 ft', 0, '4418', 'Nos', 18, 11600, 15200, 3, 10, 2],
  ['WP-RW-08', 'Rosewood Carved Pillar 8 ft', 0, '4418', 'Nos', 18, 38500, 49500, 4, 3, 1],
  ['WP-CAP-TK', 'Carved Teak Pillar Cap', 0, '4420', 'Nos', 12, 2100, 3200, 8, 30, 6],
  ['WP-BASE-GR', 'Granite Pillar Base 12"', 0, '6802', 'Nos', 18, 1450, 2150, 8, 6, 0],
  ['DF-TK-7x3', 'Teak Door Frame 7x3 ft', 1, '4418', 'Nos', 18, 8600, 11800, 5, 18, 4],
  ['DF-SL-7x3', 'Sal Wood Door Frame 7x3 ft', 1, '4418', 'Nos', 18, 4200, 5900, 8, 30, 5],
  ['DF-WPC-7x3', 'WPC Door Frame 7x3 ft', 1, '3925', 'Nos', 18, 2900, 4100, 8, 24, 0],
  ['DR-TK-PNL', 'Teak Panel Door 7x3 ft', 2, '4418', 'Nos', 18, 21500, 28500, 3, 9, 3],
  ['DR-FL-30', 'Flush Door 30 mm 7x3 ft', 2, '4418', 'Nos', 18, 3350, 4650, 10, 40, 6],
  ['DR-FRP-BR', 'FRP Bathroom Door 6.5x2.5 ft', 2, '3925', 'Nos', 18, 2650, 3800, 8, 9, 0],
  ['PLY-BWP-18', 'BWP Marine Plywood 18 mm 8x4', 3, '4412', 'Sheet', 18, 3150, 3990, 20, 90, 10],
  ['PLY-MR-12', 'MR Plywood 12 mm 8x4', 3, '4412', 'Sheet', 18, 1480, 1920, 25, 120, 0],
  ['PLY-MR-06', 'MR Plywood 6 mm 8x4', 3, '4412', 'Sheet', 18, 820, 1090, 25, 110, 0],
  ['BB-PRE-18', 'Pre-laminated Particle Board 18 mm', 3, '4410', 'Sheet', 18, 1650, 2190, 15, 60, 0],
  ['VN-TK-4', 'Teak Veneer 4 mm', 4, '4408', 'Sq.ft', 18, 58, 86, 300, 1800, 200],
  ['LM-1MM-GL', 'Decorative Laminate 1 mm Gloss', 4, '4823', 'Sheet', 18, 780, 1150, 30, 140, 20],
  ['LM-08-MT', 'Decorative Laminate 0.8 mm Matte', 4, '4823', 'Sheet', 18, 610, 890, 30, 150, 0],
  ['TM-TK-CFT', 'Teak Sawn Timber', 5, '4407', 'Cft', 18, 3900, 5200, 15, 60, 0],
  ['TM-RW-CFT', 'Rubber Wood Planks (Treated)', 5, '4407', 'Cft', 18, 760, 1050, 40, 180, 0],
  ['TM-AN-CFT', 'Anjili Wood Timber', 5, '4407', 'Cft', 18, 1850, 2500, 20, 70, 0],
  ['HW-HNG-4', 'SS Butt Hinges 4"', 6, '8302', 'Pair', 18, 145, 220, 50, 260, 40],
  ['HW-TWR-8', 'Brass Tower Bolt 8"', 6, '8302', 'Nos', 18, 185, 290, 40, 180, 30],
  ['HW-SCR-15', 'Wood Screws 1.5" (Box of 100)', 6, '7318', 'Box', 18, 95, 150, 30, 150, 0],
  ['HW-LCK-MS', 'Mortise Handle Lock Set', 6, '8301', 'Nos', 18, 1150, 1690, 40, 45, 8],
  ['AD-SR-5', 'Synthetic Resin Adhesive 5 kg', 7, '3506', 'Nos', 18, 1080, 1340, 10, 48, 6],
  ['PL-MLM-4', 'Melamine Wood Polish 4 L', 7, '3208', 'Nos', 18, 1480, 1980, 8, 36, 4],
  ['PL-TK-OIL', 'Teak Wood Oil 1 L', 7, '3208', 'Nos', 18, 340, 480, 15, 70, 10],
  ['AC-COIR-23', 'Coir Door Mat 2x3 ft', 8, '5702', 'Nos', 5, 190, 290, 25, 28, 6],
  ['AC-BRK-SS', 'SS Pillar Bracket Set', 8, '7326', 'Set', 18, 640, 950, 10, 0, 0],
];

// name, gstin, state, phone, address, opening, creditDays
const CUSTOMERS = [
  ['Sreenivas Builders', '32AAKFS2231M1ZT', 'Kerala', '9847012345', 'Infopark Road, Kakkanad, Kochi', 45000, 30],
  ['Malabar Homes & Interiors', '32AAQCM8841R1Z6', 'Kerala', '9895123456', 'Mavoor Road, Kozhikode', 0, 30],
  ['St. Thomas Church Renovation Committee', '', 'Kerala', '9446234567', 'Chiyyaram, Thrissur', 0, 15],
  ['Green Leaf Resorts Pvt Ltd', '32AADCG5520P1ZX', 'Kerala', '9447345678', 'Pothamedu, Munnar', 82000, 45],
  ['Arun Kumar P', '', 'Kerala', '9745456789', 'Choornikkara, Aluva', 0, 7],
  ['Coimbatore Timber Traders', '33ABDFC6613K1ZQ', 'Tamil Nadu', '9842567890', 'Mettupalayam Road, Coimbatore', 0, 30],
  ['Mangalore Heritage Villas', '29AAJFM4478D1Z2', 'Karnataka', '9845678901', 'Kadri Hills, Mangaluru', 0, 30],
  ['Fathima Interiors', '32BHGPF7712L1ZK', 'Kerala', '9656789012', 'Baker Junction, Kottayam', 12500, 21],
  ['Rajesh Menon (Temple Works Contractor)', '32ARHPM3345Q1Z9', 'Kerala', '9387890123', 'Kalpathy, Palakkad', 0, 30],
  ['Nair & Sons Constructions', '32AAEFN9031H1ZM', 'Kerala', '9446901234', 'Pattom, Thiruvananthapuram', 0, 30],
];
const SUPPLIERS = [
  ['Perumbavoor Plywood Industries', '32AAFCP4410E1ZR', 'Kerala', '0484 252 3301', 'Industrial Estate, Perumbavoor', 64000, 30],
  ['Nilambur Teak Depot', '32AABFN2287C1Z4', 'Kerala', '04931 222 845', 'Vadapuram, Nilambur', 0, 21],
  ['Kottayam Timber Mart', '32AADFK7730G1ZB', 'Kerala', '0481 256 1123', 'Nagampadam, Kottayam', 0, 30],
  ['Karnataka Forest Products', '29AAGFK1123B1ZP', 'Karnataka', '08182 271 540', 'Sagar Road, Shivamogga', 0, 30],
  ['Rajkot Brass Hardware Co.', '24AAHFR5561N1Z8', 'Gujarat', '0281 245 7788', 'Aji GIDC, Rajkot', 18000, 45],
  ['Chennai Doors & Frames', '33AAIFC4402J1ZW', 'Tamil Nadu', '044 2625 4410', 'Ambattur Industrial Estate, Chennai', 0, 30],
  ['Kerala Laminates & Veneers', '32AAJFK6618F1Z1', 'Kerala', '0484 270 9934', 'Kalamassery, Ernakulam', 0, 30],
  ['Sri Ganesh Adhesives & Chemicals', '33AAKFS9924A1ZC', 'Tamil Nadu', '0422 257 3312', 'Ganapathy, Coimbatore', 0, 15],
  ['Kannur Handicraft Carvers Society', '32AALAK3310D1ZH', 'Kerala', '0497 270 1256', 'Thavakkara, Kannur', 0, 15],
  ['Granite World', '29AAMFG2205K1ZE', 'Karnataka', '080 2839 4410', 'Hosur Road, Bengaluru', 0, 30],
];
// Which categories each supplier sells.
const SUPPLIES = [[3], [0, 5], [5, 1], [0, 5], [6], [1, 2], [4], [7], [0], [0]];

const AGENTS = [['Suresh Babu', '9847011122', 2], ['Joseph Mathew', '9895022233', 1.5], ['Lakshmi Nair', '9447033344', 2.5], ['Imran Khan', '9746044455', 1], ['Priya Varghese', '9656055566', 3]];

export function buildSeed() {
  const r = rng(20260930);
  const s = st.emptyState();
  const end = today();
  const start = addDays(end, -92);
  s.settings.openingDate = start;
  s.categories = [...CATS];
  st.setState(s, false);

  ITEMS.forEach(([code, name, c, hsn, unit, gst, cost, price, reorder, o1, o2]) => {
    s.items.push({ id: 'it_' + code.toLowerCase().replace(/[^a-z0-9]/g, ''), code, name, category: CATS[c], hsn, unit, gst, cost, price, reorder, opening: { L1: o1, ...(o2 ? { L2: o2 } : {}) } });
  });
  s.parties.push({ id: 'pt_cash', type: 'customer', name: 'Cash Customer', gstin: '', state: 'Kerala', phone: '', address: 'Counter sale', opening: 0, creditDays: 0, walkIn: true });
  CUSTOMERS.forEach(([name, gstin, state, phone, address, opening, creditDays], i) => s.parties.push({ id: 'pt_c' + (i + 1), type: 'customer', name, gstin, state, phone, address, opening, creditDays }));
  SUPPLIERS.forEach(([name, gstin, state, phone, address, opening, creditDays], i) => s.parties.push({ id: 'pt_s' + (i + 1), type: 'supplier', name, gstin, state, phone, address, opening, creditDays }));
  AGENTS.forEach(([name, phone, commission], i) => s.agents.push({ id: 'ag_' + (i + 1), name, phone, commission }));
  s.users.push(
    { id: 'u2', name: 'Anitha Joseph', role: 'Accountant', perms: { sales: false, purchases: true, stock: false, accounts: true, reports: true, profit: true, settings: false } },
    { id: 'u3', name: 'Rahul Krishnan', role: 'Sales Executive', perms: { sales: true, purchases: false, stock: true, accounts: false, reports: false, profit: false, settings: false } },
  );

  const custs = s.parties.filter(p => p.type === 'customer' && !p.walkIn);
  const sups = s.parties.filter(p => p.type === 'supplier');
  const pick = arr => r.pick(arr);
  const salesPeople = ['Admin', 'Rahul Krishnan'];
  const quiet = fn => { try { return fn(); } catch (e) { if (!(e instanceof st.ValidationError)) throw e; return null; } };

  const days = [];
  for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) days.push(d);
  const counts = { sale: 0, purchase: 0 };

  const makePurchase = (date, supIdx, poId, poLines) => {
    const sup = sups[supIdx];
    const pool = s.items.filter(it => SUPPLIES[supIdx].includes(CATS.indexOf(it.category)));
    const lines = poLines || Array.from({ length: r.int(2, 4) }, () => pick(pool)).filter((it, i, a) => a.indexOf(it) === i).map(it => ({
      itemId: it.id, qty: it.price > 10000 ? r.int(2, 6) : it.price > 1500 ? r.int(8, 30) : r.int(30, 150), rate: round2(it.cost * (0.94 + r.next() * 0.08)), disc: r.next() < 0.3 ? r.pick([2, 3, 5]) : 0, gst: it.gst,
    }));
    let mode = r.next() < 0.55 ? 'credit' : pick(['cash', 'bank', 'bank']);
    if (mode === 'cash' && st.docTotals({ partyId: sup.id, lines }).grand > st.cashBalance() * 0.4) mode = 'bank';
    const rec = quiet(() => st.savePurchase({ date, partyId: sup.id, supplierInv: `${sup.name.split(' ')[0].slice(0, 3).toUpperCase()}/${r.int(1000, 9999)}`, terms: sup.creditDays, mode, paid: mode === 'credit' ? (r.next() < 0.3 ? r.int(1, 3) * 10000 : 0) : '', location: r.next() < 0.85 ? 'L1' : 'L3', lines, poId, notes: '' }));
    if (rec) counts.purchase++;
    return rec;
  };

  const makeSale = date => {
    const walk = r.next() < 0.25;
    const cust = walk ? st.party('pt_cash') : pick(custs);
    const loc = r.next() < 0.75 ? 'L1' : 'L2';
    const avail = s.items.filter(it => st.stockOf(it.id, loc) > 2);
    if (!avail.length) return null;
    const chosen = Array.from({ length: r.int(1, 4) }, () => pick(avail)).filter((it, i, a) => a.indexOf(it) === i);
    const lines = chosen.map(it => {
      const have = st.stockOf(it.id, loc);
      const want = it.price > 10000 ? r.int(1, 3) : it.price > 1500 ? r.int(2, 10) : it.unit === 'Sq.ft' ? r.int(40, 220) : r.int(5, 40);
      return { itemId: it.id, qty: Math.max(1, Math.min(want, Math.floor(have * 0.6))), rate: it.price, disc: r.next() < 0.35 ? r.pick([2, 5, 7.5, 10]) : 0, gst: it.gst };
    });
    const mode = walk ? pick(['cash', 'cash', 'upi', 'card']) : r.next() < 0.5 ? 'credit' : pick(['cash', 'upi', 'bank', 'card']);
    const draft = { date, partyId: cust.id, agentId: !walk && r.next() < 0.8 ? pick(s.agents).id : '', salesperson: pick(salesPeople), mode, location: loc, lines, notes: '' };
    if (mode === 'credit') draft.paid = r.next() < 0.35 ? r.int(1, 4) * 5000 : 0;
    const t = st.docTotals(draft);
    if (mode === 'credit' && draft.paid > t.grand) draft.paid = 0;
    const rec = quiet(() => st.saveSale(draft));
    if (rec) counts.sale++;
    return rec;
  };

  // Purchase orders: some are received later through purchases.
  const poPlan = [];
  // Spread ~17 purchases and ~31 sales evenly across the period (PO receipts add more purchases).
  const spread = (n, offset) => new Set(Array.from({ length: n }, (_, i) => Math.min(days.length - 1, Math.round(offset + (i * (days.length - 1 - offset)) / (n - 1)))));
  const purchaseDays = spread(17, 1), saleDays = spread(29, 2);
  days.forEach((date, di) => {
    if (purchaseDays.has(di)) makePurchase(date, di % 10);
    if (saleDays.has(di)) makeSale(date);
    if (di === days.length - 1) { makeSale(date); makeSale(date); while (counts.sale < 31) if (!makeSale(date)) break; }
    // POs at intervals
    if (di % 9 === 3 && poPlan.length < 10) {
      const supIdx = (di / 9 | 0) % 10;
      const pool = s.items.filter(it => SUPPLIES[supIdx].includes(CATS.indexOf(it.category)));
      const lines = pool.slice(0, r.int(1, 3)).map(it => ({ itemId: it.id, qty: it.price > 10000 ? r.int(2, 5) : r.int(10, 60), rate: it.cost }));
      const status = poPlan.length < 2 ? 'Draft' : 'Ordered';
      const po = quiet(() => st.savePO({ date, partyId: sups[supIdx].id, expected: addDays(date, r.int(7, 20)), lines, status: 'Draft', notes: '' }));
      if (po) { if (status === 'Ordered') st.setPOStatus(po.id, 'Ordered'); poPlan.push({ po, supIdx, di }); }
    }
  });
  // Receive some POs (full / partial), cancel one.
  poPlan.forEach(({ po, supIdx, di }, i) => {
    if (po.status !== 'Ordered') return;
    const date = days[Math.min(days.length - 1, di + 8)];
    if (i % 4 === 2) makePurchase(date, supIdx, po.id, po.lines.map(l => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, disc: 0, gst: st.item(l.itemId).gst })));
    else if (i % 4 === 3) makePurchase(date, supIdx, po.id, po.lines.slice(0, 1).map(l => ({ itemId: l.itemId, qty: Math.ceil(l.qty / 2), rate: l.rate, disc: 0, gst: st.item(l.itemId).gst })));
    else if (i === 9) st.setPOStatus(po.id, 'Cancelled');
  });

  // Returns against earlier documents.
  const sales = st.activeSales();
  const reasons = ['Damaged in transit', 'Wrong size supplied', 'Customer changed design', 'Finish not as sample', 'Excess quantity'];
  let srN = 0;
  for (let i = 0; srN < 10 && i < sales.length * 2; i++) {
    const sale = sales[(i * 7 + 3) % sales.length];
    const idx = i % sale.lines.length;
    const left = sale.lines[idx].qty - st.returnedQty('sale', sale.id, idx);
    if (left < 1) continue;
    const date = addDays(sale.date, r.int(1, 6)) > end ? end : addDays(sale.date, r.int(1, 6));
    const q = Math.max(1, Math.floor(left / 3));
    const probe = { saleId: sale.id, lines: [{ idx, qty: q }] };
    const value = st.returnTotals(probe, 'sale').total;
    const refund = sale.mode === 'credit' ? 0 : r.next() < 0.6 ? value : round2(value / 2);
    if (quiet(() => st.saveSalesReturn({ date, saleId: sale.id, lines: [{ idx, qty: q }], reason: pick(reasons), refund, mode: sale.mode === 'cash' ? 'cash' : 'bank' }))) srN++;
  }
  const purchases = st.activePurchases();
  let prN = 0;
  for (let i = 0; prN < 10 && i < purchases.length * 2; i++) {
    const pu = purchases[(i * 5 + 1) % purchases.length];
    const idx = i % pu.lines.length;
    const left = pu.lines[idx].qty - st.returnedQty('purchase', pu.id, idx);
    const q = Math.max(1, Math.floor(left / 5));
    const date = addDays(pu.date, r.int(2, 8)) > end ? end : addDays(pu.date, r.int(2, 8));
    if (quiet(() => st.savePurchaseReturn({ date, purchaseId: pu.id, lines: [{ idx, qty: q }], reason: pick(['Quality rejected', 'Cracks / splits', 'Wrong thickness', 'Excess supplied', 'Moisture damage']), refund: 0, mode: 'bank' }))) prN++;
  }

  // Stock adjustments and transfers.
  const adjReasons = [['increase', 'Physical count surplus'], ['decrease', 'Termite damage'], ['decrease', 'Breakage during handling'], ['increase', 'Found in yard audit'], ['decrease', 'Used for showroom display'], ['decrease', 'Sample given to customer']];
  for (let i = 0, n = 0; n < 20 && i < 60; i++) {
    const it = s.items[(i * 11 + 4) % s.items.length];
    const [direction, reason] = adjReasons[i % adjReasons.length];
    const date = days[Math.min(days.length - 1, 4 + i * 4)];
    const qn = it.price > 10000 ? 1 : it.unit === 'Sq.ft' ? r.int(10, 40) : r.int(1, 6);
    if (quiet(() => st.saveAdjustment({ date, itemId: it.id, loc: 'L1', direction, qty: qn, reason, ref: `PC-${String(i + 1).padStart(3, '0')}` }))) n++;
  }
  [['WP-TK-08', 'L1', 'L2', 2], ['PLY-BWP-18', 'L1', 'L2', 12], ['DR-FL-30', 'L1', 'L2', 6], ['TM-RW-CFT', 'L3', 'L1', 10], ['HW-LCK-MS', 'L1', 'L2', 5], ['LM-1MM-GL', 'L1', 'L2', 15]].forEach(([code, from, to, qn], i) => {
    const it = s.items.find(x => x.code === code);
    quiet(() => st.saveTransfer({ date: days[10 + i * 13], itemId: it.id, from, to, qty: Math.min(qn, Math.max(1, st.stockOf(it.id, from))), notes: i % 2 ? 'Showroom display refill' : 'Moved for customer pick-up' }));
  });

  // Cheques.
  const banks = ['SBI Edappally', 'Federal Bank Aluva', 'South Indian Bank Kochi', 'HDFC Bank MG Road', 'Canara Bank Thrissur', 'ICICI Bank Kakkanad'];
  const chqPlan = [['received', 'Cleared'], ['received', 'Cleared'], ['received', 'Pending'], ['received', 'Bounced'], ['received', 'Cleared'], ['issued', 'Cleared'], ['issued', 'Pending'], ['issued', 'Cleared'], ['received', 'Pending'], ['issued', 'Cancelled']];
  chqPlan.forEach(([type, status], i) => {
    const p = type === 'received' ? custs[(i * 3) % custs.length] : sups[(i * 3) % sups.length];
    const date = days[Math.min(days.length - 1, 15 + i * 7)];
    const c = quiet(() => st.saveCheque({ chequeNo: String(r.int(100000, 999999)), date, partyId: p.id, bank: pick(banks), amount: r.int(3, 18) * 5000, type, status: 'Pending', notes: type === 'received' ? 'Against running account' : 'Part payment' }));
    if (c && status !== 'Pending') st.setChequeStatus(c.id, status, addDays(date, 3) > end ? end : addDays(date, 3));
  });

  // Cash entries: receipts against credit bills, supplier payments and shop expenses.
  const creditSales = st.activeSales().filter(x => x.mode === 'credit');
  const creditPurchases = st.activePurchases().filter(x => x.mode === 'credit');
  const expenses = ['Loading & unloading charges', 'Electricity bill - godown', 'Tea & refreshments', 'Lorry hire - Perumbavoor', 'Stationery', 'Diesel for pickup van'];
  let cashN = 0;
  for (let i = 0; cashN < 20 && i < 40; i++) {
    const kind = i % 3;
    let rec = null;
    if (kind === 0 && creditSales.length) {
      const sale = creditSales[(i * 5) % creditSales.length];
      const bal = st.totals(sale).grand - sale.paid;
      const date = addDays(sale.date, r.int(3, 20)) > end ? end : addDays(sale.date, r.int(3, 20));
      if (bal > 100) rec = quiet(() => st.saveCash({ date, type: 'receipt', partyId: sale.partyId, amount: Math.min(bal, r.int(2, 10) * 5000), description: `Received towards ${sale.no}`, ref: 'RCPT-' + (100 + i), against: sale.id }));
    } else if (kind === 1 && creditPurchases.length) {
      const pu = creditPurchases[(i * 3) % creditPurchases.length];
      const date = addDays(pu.date, r.int(5, 25)) > end ? end : addDays(pu.date, r.int(5, 25));
      rec = quiet(() => st.saveCash({ date, type: 'payment', partyId: pu.partyId, amount: r.int(2, 6) * 5000, description: `Paid towards ${pu.supplierInv || pu.no}`, ref: 'VCH-' + (200 + i), against: pu.id }));
    } else {
      rec = quiet(() => st.saveCash({ date: days[Math.min(days.length - 1, 3 + i * 2)], type: 'payment', partyId: null, amount: r.int(3, 40) * 50, description: pick(expenses), ref: 'EXP-' + (300 + i) }));
    }
    if (rec) cashN++;
  }

  // Loading list: older lines completed, recent ones pending / loaded.
  for (const sale of st.activeSales()) sale.lines.forEach((_, i) => {
    const age = Math.round((new Date(end) - new Date(sale.date)) / 86400000);
    s.loading[sale.id + ':' + i] = age > 6 ? 'Completed' : age > 2 ? 'Loaded' : 'Pending';
  });
  // One held bill to show the Hold feature.
  quiet(() => st.saveSale({ date: end, partyId: custs[4].id, agentId: '', mode: 'cash', location: 'L2', lines: [{ itemId: s.items[29].id, qty: 3, rate: s.items[29].price, disc: 0, gst: s.items[29].gst }], notes: 'Customer will confirm finish' }, { hold: true }));
  // Give every record a realistic time of day on its own date (09:30–19:00), keeping entry order.
  const recs = [...s.sales, ...s.purchases, ...s.salesReturns, ...s.purchaseReturns, ...s.adjustments, ...s.transfers, ...s.cheques, ...s.cash, ...s.pos].filter(x => x.date);
  const byDate = {};
  recs.forEach(x => (byDate[x.date] ||= []).push(x));
  for (const [date, list] of Object.entries(byDate)) {
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    let base = new Date(date + 'T09:30:00').getTime();
    let span = 9.5 * 3600000;
    if (base + span > Date.now()) { // today: never later than now
      if (Date.now() - base < list.length * 60000) base = Date.now() - Math.max(list.length * 60000, 3600000);
      span = Date.now() - base;
    }
    list.forEach((x, i) => { x.createdAt = base + Math.round(((i + 0.2 + r.next() * 0.6) / list.length) * span); });
  }
  return s;
}
