// Checks every function shown on the reference screenshot's menus, one by one.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:5090/';
const TMP = require('os').tmpdir();
const res = [];
const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE); await page.waitForSelector('.kpi');
  const nav = name => page.locator('#nav').getByRole('link', { name, exact: true }).click().then(() => page.waitForTimeout(250));
  const rows = () => page.locator('main tbody tr:not(.empty-row)').count();
  const h1 = () => page.locator('main h1').innerText();

  // ---- left menu (screenshot column 1)
  await nav('Main Menu'); ok(await h1() === 'Main Menu' && await page.locator('.menu-tile').count() >= 10, 'MAIN MENU opens with tiles');
  await nav('Day Book'); ok(await h1() === 'Day Book' && await rows() > 0 && (await page.locator('main th').first().textContent()).trim() === 'No.', `DAY BOOK lists vouchers with No. column (${await rows()})`);
  await nav('Party-Wise Report'); { const i = page.getByPlaceholder('Choose customer or supplier…'); await i.click(); await i.fill('Sreenivas'); await page.waitForTimeout(100); await i.press('Enter'); await page.waitForTimeout(200); ok((await page.locator('main').textContent()).includes('Closing Balance') && await rows() > 0, 'PARTY-WISE REPORT shows a statement'); }
  await nav('Stock'); ok(await rows() >= 32, `STOCK lists items (${await rows()})`);
  await nav('Stock Entry'); { const i = page.getByPlaceholder('Item name or code…', { exact: true }); await i.click(); await i.fill('WP-TK-08'); await page.waitForTimeout(100); await i.press('Enter'); await page.locator('main input[type=number]').first().fill('1'); await page.getByRole('button', { name: 'Save adjustment' }).click(); ok(await page.locator('.toast', { hasText: 'increased' }).count() === 1, 'STOCK ENTRY saves an adjustment'); }
  await nav('Reports'); ok(await page.locator('.report-link').count() === 18, 'REPORT opens the report menu (18 reports)');
  await nav('Sales Return'); ok(await h1() === 'Sales Return' && await rows() >= 10, 'SALES RETURN form + history');
  await nav('Purchase Return'); ok(await h1() === 'Purchase Return' && await rows() >= 10, 'PURCHASE RETURN form + history');
  await nav('Stock Transfer'); ok(await h1() === 'Stock Transfer' && await rows() >= 5, 'STOCK TRANSFER form + history');
  await nav('Cheque Entry'); ok(await h1() === 'Cheque Entry' && await rows() >= 10, 'CHEQUE ENTRY form + register');
  await nav('Cash Entry'); ok(await h1() === 'Cash Entry' && await rows() >= 20, 'CASH ENTRY form + cash book');
  const before = page.url();
  await page.locator('#nav').getByRole('button', { name: /Close Window/ }).click(); await page.waitForTimeout(250);
  ok(page.url() !== before, 'CLOSE WINDOW returns to the previous screen');
  await page.locator('#nav').getByRole('button', { name: /Calculator/ }).click(); await page.keyboard.type('125*4'); await page.keyboard.press('Enter');
  ok((await page.locator('.calc-result').innerText()) === '500', 'CALC. works (125×4 = 500)'); await page.keyboard.press('Escape');
  const c1 = await page.locator('#side-clock').innerText(); await page.waitForTimeout(1100); const c2 = await page.locator('#side-clock').innerText();
  const wd = new Date().toLocaleDateString('en-IN', { weekday: 'long' });
  ok(c1 !== c2 && c1.includes(wd) && /\d{2}-\d{2}-\d{4}/.test(c1) && /(AM|PM)/.test(c1), `DATE / TIME panel ticks (${c1.replace(/\n/g, ' ')})`);
  await nav('Settings'); ok(await page.locator('.settings-link').count() === 6, 'SETTINGS opens (6 sections)');
  await page.locator('#nav').getByRole('button', { name: /Clean Temp Data/ }).click(); await page.locator('.modal').getByRole('button', { name: 'Clean selected' }).click(); await page.waitForTimeout(200);
  ok(await page.locator('.toast', { hasText: 'Cleanup finished' }).count() === 1, 'Clean Temp Data runs');

  // ---- report menu (screenshot column 2) + Search + Excel
  const REPORTS = ['Purchase Summary', 'Purchase Details', 'Sales Summary', 'Sales Details', 'GSTR1 (Sales)', 'GSTR2 (Purchase)', 'GSTR Summary', 'Item-Wise Profit', 'Bill-Wise Profit', 'HSN-Wise', 'Receivable', 'Payable', 'Due Amount', 'Agent-Wise Report', 'Purchase Order', 'Item-Wise Sales', 'Item-Wise Transaction', 'Items Loading List'];
  await page.goto(BASE + '#/reports'); await page.waitForTimeout(200);
  for (const name of REPORTS) {
    await page.locator('.report-nav').getByRole('link', { name, exact: true }).click(); await page.waitForTimeout(200);
    if (name === 'Item-Wise Transaction') { const i = page.getByPlaceholder('Choose item…'); await i.click(); await i.fill('WP-TK-08'); await page.waitForTimeout(100); await i.press('Enter'); await page.waitForTimeout(150); }
    const preset = page.locator('select[aria-label="Date preset"]');
    if (await preset.count()) { await preset.selectOption({ label: 'All' }); await page.waitForTimeout(150); }
    const n = await rows();
    const heads = (await page.locator('main thead th').allTextContents()).map(x => x.trim());
    // Search: take a value from the first data row and search for it
    const term = (await page.locator('main tbody tr').first().locator('td').nth(name === 'GSTR Summary' ? 1 : 2).innerText()).split('\n')[0].trim().split(' ')[0];
    await page.getByPlaceholder('Search in report… ( / )').fill(term); await page.waitForTimeout(250);
    const m = await rows();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    const f = `${TMP}/menu-${name.replace(/\W+/g, '_')}.xlsx`; await dl.saveAs(f);
    const isXlsx = fs.readFileSync(f).slice(0, 2).toString() === 'PK';
    await page.getByPlaceholder('Search in report… ( / )').fill('');
    ok(n > 0 && heads[0] === 'No.' && m >= 1 && m <= n && isXlsx, `${name}: ${n} rows, No./Type/Date columns [${heads.slice(0, 4).join(', ')}], search "${term}" → ${m}, Excel ✓`);
  }
  ok(errs.length === 0, 'no console errors ' + errs.join(' | '));
  console.log(res.join('\n')); console.log(`${res.filter(r => r.startsWith('PASS')).length}/${res.length} passed`);
  await b.close(); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('ERR', e.message.slice(0, 600)); process.exit(1); });
