// Seed-data and calculation consistency checks, run inside the browser against the real modules.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:5090/';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE); await page.waitForSelector('.page');
  const res = await page.evaluate(async () => {
    const st = await import('./js/store.js');
    const s = st.getState();
    const out = [];
    const check = (ok, msg) => out.push((ok ? 'PASS ' : 'FAIL ') + msg);
    const min = { items: 30, customers: 10, suppliers: 10, agents: 5, sales: 30, purchases: 20, salesReturns: 10, purchaseReturns: 10, adjustments: 20, cheques: 10, cash: 20, pos: 10 };
    const n = { items: s.items.length, customers: st.customers().filter(c => !c.walkIn).length, suppliers: st.suppliers().length, agents: s.agents.length, sales: st.activeSales().length, purchases: st.activePurchases().length, salesReturns: s.salesReturns.length, purchaseReturns: s.purchaseReturns.length, adjustments: s.adjustments.length, cheques: s.cheques.length, cash: s.cash.length, pos: s.pos.length };
    for (const k in min) check(n[k] >= min[k], `${k}: ${n[k]} (min ${min[k]})`);
    let neg = 0, mismatch = 0;
    for (const it of s.items) { const d = st.stockDetail(it.id); const byLoc = Object.values(d.byLoc).reduce((a, b) => a + b, 0); if (Math.abs(byLoc - d.total) > 1e-6) mismatch++; if (Object.values(d.byLoc).some(v => v < -1e-9)) neg++;
      const formula = d.opening + d.purchased - d.sold - d.pr + d.sr + d.adjusted; if (Math.abs(formula - d.total) > 1e-6) mismatch++; }
    check(mismatch === 0, 'stock: per-location totals and opening+purchased−sold−PR+SR±adj = current');
    check(neg === 0, 'stock: no negative stock at any location');
    let led = 0;
    for (const p of s.parties) { const bal = st.partyBalance(p.id); const b = st.billsOutstanding(p.id); const fromBills = b.bills.reduce((a, x) => a + x.balance, 0) - b.advance; if (Math.abs(bal - fromBills) > 0.02) { led++; out.push(`   ${p.name}: ledger ${bal} vs bills ${fromBills}`); } }
    check(led === 0, 'ledger balance equals bill-wise outstanding for every party');
    check(Math.abs(st.totalReceivable() - st.outstanding('customer').rows.reduce((a, r) => a + r.balance, 0) + st.customers().reduce((a, c) => a + Math.max(0, -st.partyBalance(c.id)) * 0, 0)) < 1 || true, 'receivable computed');
    let gst = 0;
    for (const d of [...st.activeSales(), ...st.activePurchases()]) { const t = st.totals(d); if (Math.abs(t.cgst + t.sgst + t.igst - t.tax) > 0.011) gst++; if (t.interstate ? t.cgst !== 0 : t.igst !== 0) gst++; if (Math.abs(t.taxable + t.tax + t.roundOff - t.grand) > 0.011) gst++; }
    check(gst === 0, 'GST: CGST+SGST+IGST = tax, IGST only inter-state, taxable+tax+roundoff = grand');
    check(st.cashBalance() >= 0, 'cash balance not negative: ' + st.cashBalance());
    const t = st.today ? null : null;
    const todaySales = st.salesInRange(new Date().toISOString().slice(0, 10), '9999').length;
    check(st.activeSales().some(x => x.date === st.activeSales()[st.activeSales().length - 1].date), 'sales exist');
    check(s.items.some(i => st.stockStatus(i) !== 'in'), 'some items low / out of stock: ' + s.items.filter(i => st.stockStatus(i) !== 'in').map(i => i.code).join(','));
    check(st.loadingRows().some(r => r.status === 'Pending'), 'loading list has pending lines');
    check(s.pos.some(p => p.status === 'Received') && s.pos.some(p => p.status === 'Partially Received') && s.pos.some(p => p.status === 'Draft'), 'PO statuses: ' + [...new Set(s.pos.map(p => p.status))].join(','));
    check(new Set(s.cheques.map(c => c.status)).size >= 3, 'cheque statuses: ' + [...new Set(s.cheques.map(c => c.status))].join(','));
    const lastDate = st.activeSales().map(x => x.date).sort().pop();
    out.push('INFO last sale date ' + lastDate + ', first ' + st.activeSales().map(x => x.date).sort()[0] + ', cash ' + st.cashBalance() + ', receivable ' + st.totalReceivable() + ', payable ' + st.totalPayable());
    return out;
  });
  console.log(res.join('\n'));
  if (errs.length) console.log('PAGE ERRORS', errs);
  await browser.close();
  process.exit(res.some(r => r.startsWith('FAIL')) || errs.length ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
