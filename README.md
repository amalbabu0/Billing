# Reseller Solution — Retail / Wholesale ERP (prototype)

A working browser prototype of a legacy desktop-style ERP ("RESELLER SOLUTION FOR WOOD PILLER") for a business that buys and sells physical products: billing, stock, cash and cheques, GST and 18 business reports.

It is plain **HTML, CSS and JavaScript** (ES modules). There is no build step, framework or backend. All data lives in the browser (localStorage) and is seeded with realistic data for a Kerala-based wood pillar and timber reseller.

## Run it

ES modules need to be served over http (opening `index.html` as a `file://` URL will not work):

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or: npx serve .
```

It deploys to Vercel as a static site with no build command. Every push to the connected branch is deployed.

The first visit seeds the demo data. To start over, use **Clean Temp Data → Reset ALL business data**, or **Settings → Data & Backup** to download or restore a JSON backup.

## What works

Every button does something real. Stock, balances, GST and reports are all calculated from the transactions you enter.

| Area | Features |
|---|---|
| **Dashboard** | Today's sales and purchases, cash and bank balance, receivable, payable, stock value, low stock, customer and supplier counts. Charts: 30-day sales vs purchases, top products, category sales. Recent sales, purchases, returns and payments. Quick actions. |
| **Main Menu** | Tile menu for Sales, Purchases, Customers, Suppliers, Items, Stock, Payments, Receipts, Cheques, POs, Reports and Settings. |
| **Sales** | Invoice number, date, customer, salesperson, agent and stock location. Item grid with HSN, qty, rate, discount %, GST and amount, and available stock per row. Subtotal, discount, CGST/SGST or IGST (chosen from the party's state), round off and grand total. Payment by cash, card, UPI, bank or credit (with advance). Save, Save & Print, Hold (resume later), Clear and Cancel. Unsaved drafts are restored. Invoice view and print, and invoice cancellation with a reason. **Saving reduces stock.** |
| **Purchases** | Purchase number, supplier, date, supplier invoice number, payment terms, location, items and GST. **Saving increases stock** and updates the weighted-average cost. Goods can be received against a purchase order. |
| **Sales / Purchase Return** | Pick the original bill and see the items sold or bought, what was already returned and what is still returnable. Enter return qty, reason and refund. A sales return adds stock; a purchase return removes it. The party account is adjusted by the return value less the refund. |
| **Stock** | Code, name, category, HSN, unit, opening, purchased, sold, purchase return, sales return, transferred, adjusted, current, reorder, cost, selling price, value and status (In / Low / Out). Filters by search, category, status and location. Per-location detail. |
| **Stock Entry** | Increase or decrease stock with item, location, qty, unit, date, reason and reference. Every change is kept in the movement history. |
| **Stock Transfer** | From and to location, date, item, qty and notes. Stock leaves the source and arrives at the destination. Transfer history. |
| **Cheque Entry** | Received or issued cheques with party, bank, amount and notes. Status: Pending → Cleared / Bounced / Cancelled, with history. Only cleared cheques change party and bank balances. |
| **Cash Entry** | Cash receipts and payments with party, amount, description and reference, optionally against a specific bill. The cash balance updates immediately, and paying more cash than you have is blocked. |
| **Purchase Orders** | Draft → Ordered → Partially Received → Received, or Cancelled. Edit, print, and receive goods (which creates a purchase). |
| **Day Book** | Every voucher in date order with debit, credit and running balance. Filters: date range, type, party, payment mode and search. Reset, totals, Excel, CSV and print. |
| **Party-Wise Report** | Customer or supplier statement over a date range: opening, sales/purchases, returns, receipts/payments, adjustments, closing. Rows open the source document. Also lists the party's open bills. |
| **Masters** | Items (with a category manager), customers, suppliers and agents. GSTIN format is checked, and the state is filled in from the GSTIN. |
| **Reports (18)** | Purchase Summary / Details, Sales Summary / Details, GSTR1, GSTR2, GSTR Summary, Item-Wise Profit, Bill-Wise Profit, HSN-Wise, Receivable and Payable (with aging buckets), Due Amount, Agent-Wise (commission), Purchase Order, Item-Wise Sales, Item-Wise Transaction, Items Loading List (Pending / Loaded / Completed). Each report has filters, date presets, instant search, summary cards, sortable columns and totals, plus **Excel (.xlsx), CSV, print preview and print**. Exports use the current filters and search. |
| **Utilities** | Calculator (F9): + − × ÷, %, decimals, sign, keyboard input. Clean Temp Data: clears search history, remembered filters, drafts and held bills, or resets demo data (with confirmation). Close Window: closes the open dialog or goes back. Live date and time in the top bar. |
| **Settings** | Business profile and invoice prefix. GST rates with the CGST/SGST/IGST split. Invoice numbering, decimals, round off and credit days. Inventory settings: negative stock, reorder level, locations. Users with roles and permissions (menus, screens and cost/profit visibility follow the signed-in user). Backup and restore. |

### Keyboard

| Key | Action |
|---|---|
| Ctrl+K | Global search: invoices, purchases, items, customers, suppliers, returns, POs, screens, dates |
| / | Focus the page's search box |
| Ctrl+S | Save the current form |
| Ctrl+P | Print the current report or invoice (Save & Print on the sales form) |
| F9 | Calculator |
| Alt+W | Close window |
| Esc | Close the dialog, clear a search box, or close a dropdown |
| Enter / ↑ ↓ | Move through invoice cells, pick from lists, open table rows |

## Routes

Hash routes:

- **Transactions:**
  - `#/` Dashboard, `#/menu` Main Menu
  - `#/sales`, `#/sales/new`, `#/sales/:id`, `#/sales/edit/:id` (held bill)
  - `#/purchases`, `#/purchases/new[?po=]`, `#/purchases/:id`
  - `#/sales-return`, `#/purchase-return`
- **Stock:** `#/stock`, `#/stock-entry`, `#/transfer`, `#/po`
- **Accounts:** `#/cheques`, `#/cash`, `#/daybook`, `#/party-report`
- **Masters:** `#/parties`, `#/items`
- **Reports:** `#/reports`, `#/reports/:key`
- **Settings:** `#/settings`

## Code layout

```
index.html            shell page
css/app.css           design tokens, layout, tables, forms, print and responsive rules
js/utils.js           formatting (₹, Indian grouping, dates), DOM helper, PRNG
js/store.js           data model, persistence, business rules, GST maths, stock ledger,
                      party ledgers, bill-wise allocation, day book, validation
js/seed.js            demo data, replayed through the store so everything is consistent
js/ui.js              components: data table, modal, confirm, combobox, toast, export buttons
js/export.js          XLSX writer (Office Open XML, no library), CSV, print layouts
js/charts.js          SVG line chart with tooltip, ranked bar list
js/calc.js            calculator (no eval)
js/router.js          navigation helpers and page shortcuts
js/app.js             shell, sidebar, routes, global search, keyboard shortcuts, utilities
js/pages/*.js         dashboard, masters, billing, returns, stock, accounts, po, reports, settings
tests/*.cjs           Playwright route crawl, data-consistency checks, end-to-end acceptance test
```

All reads and writes go through `store.js`, so replacing `load`/`commit` with API calls is enough to connect a real backend later.

## Tests

With a static server on port 5090 and Playwright available:

```bash
node tests/crawl.cjs http://127.0.0.1:5090/          # every route: console errors, error panels, overflow (MOBILE=1 for phone width)
node tests/data.cjs  http://127.0.0.1:5090/          # seed counts, stock / ledger / GST consistency
node tests/e2e.cjs   http://127.0.0.1:5090/          # the 20 acceptance workflows + validation (55 checks)
```

## Assumptions

- **Tax and pricing.**
  - Prices are exclusive of GST.
  - Discount is a percentage per line.
  - Bill totals are rounded to the rupee (configurable).
  - Parties in the business's state (Kerala) pay CGST + SGST; everyone else pays IGST.
- **Returns.** A return is valued proportionally to the original line, tax included. A refund is paid now; the rest is adjusted against the account.
- **Outstanding bills.** Money received on a bill settles that bill first. Other receipts and payments settle the oldest bills first. Receivable and payable aging uses due dates (bill date + credit days).
- **Profit.** Profit uses the item's weighted-average cost at the time of sale. Sales amounts in the profit reports exclude GST.
- **Day Book.** Debit is value coming in (sales, receipts, purchase returns) and Credit is value going out.
- **Items Loading List.** Built from the lines of saved sales.

## Limitations

- Single browser, single user at a time. Data is stored in this browser's localStorage (use Backup to move it). There is no server, login or passwords, and users exist only to demonstrate permissions.
- The GST reports are prototype summaries. No JSON is generated for the GST portal, and there is no e-invoice or e-way bill.
- Saved invoices and purchases cannot be edited (cancel or return instead). Purchases cannot be cancelled in this version.
- Printing uses the browser's print dialog (A4).
