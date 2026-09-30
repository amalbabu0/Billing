// End-to-end acceptance test for the prototype (the 20 workflows in the brief + validation).
// Usage: node tests/e2e.cjs [baseUrl]
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:5090/';
const results = [];
const ok = (cond, msg) => { results.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) console.log('FAIL', msg); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('console', m => m.type() === 'error' && errs.push(m.text())); page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  const go = async p => { await page.goto(BASE + '#' + p); await page.waitForTimeout(200); };
  const S = fn => page.evaluate(fn);
  const store = `const st = await import('./js/store.js');`;
  const pick = async (placeholder, text, nth = 0) => { const inp = page.getByPlaceholder(placeholder, { exact: true }).nth(nth); await inp.click(); await inp.fill(text); await page.waitForTimeout(150); await inp.press('Enter'); };
  const toast = async re => { const t = page.locator('.toast').filter({ hasText: re }).first(); await t.waitFor({ timeout: 4000 }); return t.innerText(); };

  await page.goto(BASE); await S(() => localStorage.clear()); await page.goto(BASE); await page.waitForSelector('.kpi');
  // 1 Dashboard
  ok(await page.locator('.kpi').count() >= 9, '1 dashboard shows KPI cards');
  ok(await page.locator('svg.chart path').count() >= 2, '1 dashboard sales/purchase chart rendered');

  // 2 Add item
  await go('/items?new=1'); await page.waitForSelector('.modal');
  const m = page.locator('.modal');
  await m.getByLabel('Item code').fill('TEST-01'); await m.getByLabel('Item name').fill('Test Teak Beam 12 ft'); await m.getByLabel('HSN code').fill('4407');
  await m.getByLabel('Cost price (₹)').fill('1000'); await m.getByLabel('Selling price (₹)').fill('1500');
  await m.getByRole('button', { name: 'Save item' }).click(); await toast(/TEST-01 saved/);
  const itemId = await S(async () => { const st = await import('./js/store.js'); return st.getState().items.find(i => i.code === 'TEST-01')?.id; });
  ok(!!itemId, '2 item added');

  // 3 Add customer (plus validation of bad GSTIN)
  await go('/parties?tab=customer&new=1'); await page.waitForSelector('.modal');
  await page.locator('.modal').getByLabel('Name').fill('Test Customer Pvt Ltd'); await page.locator('.modal').getByLabel('GSTIN').fill('BADGSTIN');
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click(); await toast(/GSTIN format/);
  ok(true, '53 invalid GSTIN rejected');
  await page.locator('.modal').getByLabel('GSTIN').fill('32ABCDE1234F1Z5');
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click(); await toast(/Test Customer Pvt Ltd saved/);
  const custId = await S(async () => { const st = await import('./js/store.js'); return st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd')?.id; });
  ok(!!custId, '3 customer added');

  // 4 Purchase -> 5 stock increases
  await go('/purchases/new');
  await pick('Supplier name or GSTIN…', 'Perumbavoor');
  await page.getByPlaceholder('e.g. PPI/2231').fill('E2E/001');
  await pick('Item name or code…', 'TEST-01');
  await page.locator('input[aria-label="qty row 1"]').fill('20');
  await page.getByRole('button', { name: 'Save Purchase' }).click(); await toast(/stock updated/);
  const stock1 = await S(async () => { const st = await import('./js/store.js'); const id = st.getState().items.find(i => i.code === 'TEST-01').id; return st.stockOf(id); });
  ok(stock1 === 20, `4-5 purchase increased stock to 20 (got ${stock1})`);
  ok(/\/purchases\//.test(page.url()), '4 purchase view opened');

  // 53 cannot sell more than stock
  await go('/sales/new');
  await pick('Customer name, GSTIN or phone…', 'Test Customer');
  await pick('Item name or code…', 'TEST-01');
  await page.locator('input[aria-label="qty row 1"]').fill('25');
  await page.keyboard.press('Control+s'); await toast(/only 20/);
  ok(true, '53 overselling blocked');
  // 6 sale on credit -> 7 stock decrease
  await page.locator('input[aria-label="qty row 1"]').fill('5');
  await page.getByRole('radio', { name: 'Credit' }).click();
  const before = await S(async () => { const st = await import('./js/store.js'); return st.totalReceivable(); });
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await toast(/Invoice .* saved/);
  const sale = await S(async () => { const st = await import('./js/store.js'); const s = st.activeSales().find(x => x.partyId === st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd').id); return { id: s.id, grand: st.totals(s).grand, no: s.no }; });
  const stock2 = await S(async () => { const st = await import('./js/store.js'); return st.stockOf(st.getState().items.find(i => i.code === 'TEST-01').id); });
  ok(stock2 === 15, `6-7 sale reduced stock to 15 (got ${stock2})`);
  ok(sale.grand === Math.round(5 * 1500 * 1.18), `GST maths: 5 × 1500 + 18% = ${sale.grand}`);
  const after = await S(async () => { const st = await import('./js/store.js'); return st.totalReceivable(); });
  ok(Math.abs(after - before - sale.grand) < 0.01, `11 receivable increased by bill amount (${after - before})`);

  // 8-9 sales return
  await go('/sales-return?sale=' + sale.id);
  await page.locator('input[aria-label^="Return quantity"]').first().fill('9');
  await page.getByRole('button', { name: /Save Sales Return/ }).click(); await toast(/at most 5/);
  ok(true, '53 over-return blocked');
  await page.locator('input[aria-label^="Return quantity"]').first().fill('2');
  await page.getByRole('button', { name: /Save Sales Return/ }).click(); await toast(/stock added back/);
  const stock3 = await S(async () => { const st = await import('./js/store.js'); return st.stockOf(st.getState().items.find(i => i.code === 'TEST-01').id); });
  ok(stock3 === 17, `8-9 sales return increased stock to 17 (got ${stock3})`);

  // 10-11 receipt against bill changes receivable
  const bal0 = await S(async () => { const st = await import('./js/store.js'); return st.partyBalance(st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd').id); });
  await go(`/cash?type=receipt&party=${custId}&against=${sale.id}&amount=1000`);
  await page.getByRole('button', { name: 'Save entry' }).click(); await toast(/saved · cash in hand/);
  const bal1 = await S(async () => { const st = await import('./js/store.js'); return st.partyBalance(st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd').id); });
  ok(Math.abs(bal0 - bal1 - 1000) < 0.01, `10-11 receipt reduced customer balance by 1000 (${bal0} → ${bal1})`);
  const exp = Math.round(5 * 1500 * 1.18) - Math.round(2 * 1500 * 1.18 * 100) / 100 - 1000;
  ok(Math.abs(bal1 - exp) < 0.02, `receivable arithmetic: bill − return − receipt = ${exp} (got ${bal1})`);

  // payable changes with supplier payment
  const pay0 = await S(async () => { const st = await import('./js/store.js'); return st.totalPayable(); });
  await go('/cash?type=payment'); await pick('Party (optional for expenses)…', 'Perumbavoor');
  await page.getByPlaceholder('0.00').fill('5000'); await page.getByRole('button', { name: 'Save entry' }).click(); await toast(/saved/);
  const pay1 = await S(async () => { const st = await import('./js/store.js'); return st.totalPayable(); });
  ok(Math.abs(pay0 - pay1 - 5000) < 0.01, `payable reduced by supplier payment (${pay0 - pay1})`);

  // 12-15 reports: open, filter, search, export
  await go('/reports/sales-summary');
  await page.locator('select[aria-label="customer"]').selectOption(custId);
  await page.waitForTimeout(200);
  ok(await page.locator('main tbody tr').count() === 1, '12-13 sales summary filtered to the test customer');
  await page.locator('select[aria-label="customer"]').selectOption('');
  await page.getByPlaceholder('Search in report… ( / )').fill(sale.no); await page.waitForTimeout(300);
  ok(await page.locator('main tbody tr').count() === 1, '14 report search finds the invoice');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
  const xp = '/tmp/claude-0/-home-user-Billing/0f8c75bf-9ca3-5f2a-980a-54bfe76e0182/scratchpad/e2e.xlsx'; await dl.saveAs(xp);
  ok(fs.readFileSync(xp).slice(0, 2).toString() === 'PK', '15 Excel export downloaded (.xlsx zip) ' + dl.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  const cp = xp.replace('xlsx', 'csv'); await dl2.saveAs(cp);
  const csv = fs.readFileSync(cp, 'utf8');
  ok(csv.includes(sale.no) && csv.split('\n').length === 3, '15 CSV export respects search filter (header + 1 row + total)');
  // all reports have data
  for (const k of ['purchase-summary', 'purchase-details', 'sales-details', 'gstr1', 'gstr2', 'gstr-summary', 'item-profit', 'bill-profit', 'hsn', 'receivable', 'payable', 'due-amount', 'agent', 'purchase-order', 'item-sales', 'loading-list']) {
    await go('/reports/' + k + '?x=1'); await page.locator('select[aria-label="Date preset"]').selectOption({ label: 'All' }).catch(() => {});
    await page.waitForTimeout(120);
    const n = await page.locator('main tbody tr:not(.empty-row)').count();
    ok(n > 0, `report ${k} has rows (${n})`);
  }
  // print preview
  await go('/reports/gstr-summary'); await page.getByRole('button', { name: 'Preview' }).click();
  ok(await page.locator('.modal .print-table').count() === 1, 'print preview renders');
  await page.keyboard.press('Escape');

  // 16 calculator
  await page.keyboard.press('F9'); await page.waitForSelector('.calc');
  await page.keyboard.type('12+8%'); await page.keyboard.press('Enter');
  const r1 = await page.locator('.calc-result').innerText();
  await page.keyboard.type('100/4'); await page.keyboard.press('Enter');
  const r2 = await page.locator('.calc-result').innerText();
  await page.keyboard.type('7*6-2'); await page.keyboard.press('Enter');
  const r3 = await page.locator('.calc-result').innerText();
  ok(r1 === '12.96' && r2 === '25' && r3 === '40', `16 calculator: 12+8%=${r1}, 100/4=${r2}, 7*6-2=${r3}`);
  await page.keyboard.press('Escape');

  // 17 settings
  await go('/settings'); await page.getByLabel('Business name').fill('Wood Piller Traders');
  await page.getByRole('button', { name: 'Save changes' }).click(); await toast(/Business profile saved/);
  ok((await page.locator('.brand-sub').innerText()).includes('Wood Piller Traders'), '17 settings change reflected in shell');

  // 18 stock transfer (+ over-transfer validation)
  await go('/transfer'); await pick('Item name or code…', 'TEST-01');
  await page.locator('main input[type=number]').first().fill('500'); await page.getByRole('button', { name: 'Transfer stock' }).click(); await toast(/Only 17/);
  await page.locator('main input[type=number]').first().fill('3'); await page.getByRole('button', { name: 'Transfer stock' }).click(); await toast(/moved to/);
  const loc = await S(async () => { const st = await import('./js/store.js'); const id = st.getState().items.find(i => i.code === 'TEST-01').id; return [st.stockOf(id, 'L1'), st.stockOf(id, 'L2'), st.stockOf(id)]; });
  ok(loc[0] === 14 && loc[1] === 3 && loc[2] === 17, `18 transfer moved 3 to Showroom (${loc})`);

  // 19 purchase order
  await go('/po?new=1'); await page.waitForSelector('.modal');
  await pick('Supplier…', 'Nilambur'); await pick('Item…', 'TEST-01');
  await page.locator('.modal input[aria-label="Quantity"]').fill('40');
  await page.getByRole('button', { name: 'Save & Mark Ordered' }).click(); await toast(/placed/);
  const po = await S(async () => { const st = await import('./js/store.js'); return st.getState().pos.slice(-1)[0]; });
  ok(po.status === 'Ordered' && po.lines[0].qty === 40, '19 purchase order created and ordered');
  // receive part of it
  await go('/purchases/new?po=' + po.id);
  await page.locator('input[aria-label="qty row 1"]').fill('15');
  await page.getByRole('button', { name: 'Save Purchase' }).click(); await toast(/stock updated/);
  const po2 = await S(async () => { const st = await import('./js/store.js'); return st.getState().pos.slice(-1)[0]; });
  ok(po2.status === 'Partially Received' && po2.lines[0].received === 15, 'PO partially received through purchase');

  // 20 item transaction history
  await go('/reports/item-transaction?item=' + itemId);
  const types = await page.locator('main tbody td:nth-child(3)').allInnerTexts();
  ok(['Purchase', 'Sale', 'Sales Return', 'Transfer Out', 'Transfer In'].every(t => types.includes(t)), '20 item history: ' + types.join(', '));
  const lastBal = (await page.locator('main tfoot td').last().innerText()).trim();
  ok(lastBal === '32', `20 closing balance 32 (got ${lastBal})`);

  // Stock entry
  await go('/stock-entry'); await pick('Item name or code…', 'TEST-01');
  await page.getByRole('radio', { name: 'Stock Decrease' }).click();
  await page.locator('main input[type=number]').first().fill('2'); await page.getByRole('button', { name: 'Save adjustment' }).click(); await toast(/decreased/);
  ok(await S(async () => { const st = await import('./js/store.js'); return st.stockOf(st.getState().items.find(i => i.code === 'TEST-01').id); }) === 30, 'stock entry decreased stock to 30');

  // Cancel the purchase that received the PO: stock goes back out and the PO reopens
  const poPur = await S(async () => { const st = await import('./js/store.js'); return st.getState().purchases.slice(-1)[0].id; });
  await go('/purchases/' + poPur); await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await page.locator('.modal textarea').fill('Entered twice'); await page.locator('.modal').getByRole('button', { name: 'Cancel purchase' }).click(); await toast(/Purchase cancelled/);
  const pc = await S(async () => { const st = await import('./js/store.js'); return [st.stockOf(st.getState().items.find(i => i.code === 'TEST-01').id), st.getState().pos.slice(-1)[0].status]; });
  ok(pc[0] === 15 && pc[1] === 'Ordered', `purchase cancel removed stock and reopened PO (${pc})`);

  // GSTR-1 JSON
  await go('/reports/gstr1'); await page.locator('select[aria-label="Date preset"]').selectOption({ label: 'This month' });
  const [dj] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download GSTR-1 JSON' }).click()]);
  const jp = xp.replace('.xlsx', '.json'); await dj.saveAs(jp);
  const gj = JSON.parse(fs.readFileSync(jp, 'utf8'));
  const hsnTx = gj.hsn.data.reduce((a, x) => a + x.txval, 0);
  const secTx = (gj.b2b || []).flatMap(x => x.inv).flatMap(i => i.itms).reduce((a, x) => a + x.itm_det.txval, 0) + (gj.b2cl || []).flatMap(x => x.inv).flatMap(i => i.itms).reduce((a, x) => a + x.itm_det.txval, 0) + (gj.b2cs || []).reduce((a, x) => a + x.txval, 0) - (gj.cdnr || []).flatMap(x => x.nt).flatMap(n => n.itms).reduce((a, x) => a + x.itm_det.txval, 0);
  ok(gj.fp.length === 6 && gj.hsn.data.length > 0 && Math.abs(hsnTx - secTx) < 1, `GSTR-1 JSON: sections reconcile with HSN (${hsnTx.toFixed(2)} vs ${secTx.toFixed(2)})`);

  // Cheque entry + status
  await go('/cheques'); await page.getByPlaceholder('6 digits').fill('445566'); await pick('Customer…', 'Test Customer');
  await page.getByPlaceholder('Bank & branch').fill('SBI Edappally'); await page.locator('main input[type=number]').first().fill('2000');
  await page.getByRole('button', { name: 'Save cheque' }).click(); await toast(/445566 saved/);
  await page.locator('main tbody tr', { hasText: '445566' }).getByRole('button', { name: 'Update status' }).click();
  const bal2 = await S(async () => { const st = await import('./js/store.js'); return st.partyBalance(st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd').id); });
  await page.locator('.modal').getByRole('button', { name: 'Update status' }).click(); await toast(/marked cleared/);
  const bal3 = await S(async () => { const st = await import('./js/store.js'); return st.partyBalance(st.getState().parties.find(p => p.name === 'Test Customer Pvt Ltd').id); });
  ok(Math.abs(bal2 - bal3 - 2000) < 0.01, 'cleared cheque reduced customer balance by 2000');

  // Day book, party report
  await go('/daybook'); ok(await page.locator('main tbody tr').count() > 5, 'day book lists vouchers');
  await go('/party-report?party=' + custId); ok((await page.locator('main').innerText()).includes('Closing Balance'), 'party-wise report shows balances');

  // Global search (Ctrl+K)
  await go('/'); await page.keyboard.press('Control+k'); await page.keyboard.type(sale.no); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  ok(page.url().includes('/sales/' + sale.id), 'Ctrl+K search opens the invoice');
  // Close window returns to previous screen
  await page.getByRole('button', { name: 'Close window', exact: true }).click(); await page.waitForTimeout(250);
  ok(!page.url().includes('/sales/' + sale.id), 'Close Window navigates back');
  // Held bill
  await go('/sales/new'); await pick('Item name or code…', 'TEST-01'); await page.getByRole('button', { name: 'Hold' }).click(); await toast(/held/);
  ok(await S(async () => { const st = await import('./js/store.js'); return st.getState().sales.filter(s => s.status === 'held').length; }) >= 2, 'Hold saves a held bill');
  // Clean temp data
  await S(() => localStorage.setItem('wp-erp-temp-v1', JSON.stringify({ recentSearches: ['x'] })));
  await page.getByRole('button', { name: 'Clean Temp Data' }).click(); await page.locator('.modal').getByRole('button', { name: 'Clean selected' }).click(); await toast(/Cleanup finished/);
  const tempAfter = await S(() => localStorage.getItem('wp-erp-temp-v1'));
  const salesKept = await S(async () => { const st = await import('./js/store.js'); return st.activeSales().length; });
  ok((!tempAfter || !tempAfter.includes('recentSearches')) && salesKept > 30, 'Clean temp data clears temp only, keeps sales');
  // Permissions: switch to sales user hides reports
  await go('/settings?s=users'); await page.getByRole('button', { name: 'User Settings' }).click();
  await page.locator('.user-row', { hasText: 'Rahul' }).getByRole('button', { name: 'Switch to user' }).click(); await page.waitForTimeout(800);
  await go('/reports/sales-summary');
  ok((await page.locator('main').innerText()).includes('No access'), 'sales user cannot open reports');
  ok(await S(() => !document.querySelector('a.nav-link[href="#/settings"]')), 'settings hidden for sales user');

  ok(errs.length === 0, 'no console errors ' + errs.join(' | '));
  console.log(results.join('\n'));
  console.log(`${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(async e => { console.log(results.join('\n')); console.error('ERR', e.message.slice(0, 800)); process.exit(1); });
