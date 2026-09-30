// Visits every route, reports console errors, page errors, error panels and horizontal overflow.
// Usage: node tests/crawl.cjs [baseUrl]   env: MOBILE=1 SHOTS=dir
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:5090/';
const ROUTES = ['/', '/menu', '/sales', '/sales/new', '/purchases', '/purchases/new', '/daybook', '/parties', '/parties?tab=supplier', '/parties?tab=agent', '/party-report', '/items', '/stock', '/stock-entry', '/sales-return', '/purchase-return', '/transfer', '/cheques', '/cash', '/po', '/reports', '/settings',
  ...['purchase-summary', 'purchase-details', 'sales-summary', 'sales-details', 'gstr1', 'gstr2', 'gstr-summary', 'item-profit', 'bill-profit', 'hsn', 'receivable', 'payable', 'due-amount', 'agent', 'purchase-order', 'item-sales', 'item-transaction', 'loading-list'].map(k => '/reports/' + k)];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: process.env.MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(BASE);
  await page.waitForSelector('.page');
  let bad = 0;
  for (const r of ROUTES) {
    errs.length = 0;
    await page.goto(BASE + '#' + r);
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => ({ err: !!document.querySelector('.empty.error'), noaccess: /No access/.test(document.querySelector('main').innerText), ow: document.documentElement.scrollWidth - innerWidth, mainOw: (() => { const m = document.querySelector('main'); return m.scrollWidth - m.clientWidth; })(), rows: document.querySelectorAll('main tbody tr').length }));
    const issues = [...errs];
    if (info.err) issues.push('error panel');
    if (info.ow > 1 || info.mainOw > 1) issues.push('horizontal overflow ' + Math.max(info.ow, info.mainOw));
    if (issues.length) { bad++; console.log(r, '\n   ', issues.join('\n    ')); }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${(process.env.MOBILE ? 'm' : '') + r.replace(/[\/?=&]/g, '_')}.png`, fullPage: false });
  }
  console.log(`checked ${ROUTES.length} routes, ${bad} with issues`);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
