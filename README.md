# FurniShop — Furniture Shop Billing & Management

A Windows desktop application (WPF, .NET 8) for Indian furniture retailers: GST billing / POS, quotations → sales orders → invoices, advances and part payments, customer credit, inventory with reservations, purchases and suppliers, custom-made orders, deliveries with proof, installations, expenses, reports, users and permissions. Data is stored in **PostgreSQL**, designed for **Neon** (serverless Postgres) so several counters or branches can share one database.

---

## Contents

1. [Quick start](#quick-start)
2. [Setting up Neon](#setting-up-neon)
3. [Features](#features)
4. [Keyboard shortcuts](#keyboard-shortcuts)
5. [Architecture](#architecture)
6. [Business rules and data integrity](#business-rules-and-data-integrity)
7. [Security](#security)
8. [Backups](#backups)
9. [Command-line tool](#command-line-tool)
10. [Development and tests](#development-and-tests)
11. [Known limitations](#known-limitations)

---

## Quick start

**Requirements:** Windows 10/11, the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (or just the .NET 8 Desktop Runtime to run a published build), and a PostgreSQL 14+ database — a free Neon project works.

```powershell
git clone <this repository>
cd Billing
dotnet run --project src/FurniShop.Wpf
```

Or publish a single folder to copy to shop PCs:

```powershell
dotnet publish src/FurniShop.Wpf -c Release -r win-x64 --self-contained false -o publish
# run publish\FurniShop.exe
```

On first launch:

1. **Connect to database** – paste your Neon connection string (either the `postgresql://…` URL from the Neon console or a `Host=…;Database=…` string) and press *Test & connect*. It is stored encrypted for the current Windows user.
2. The database schema is created automatically (migrations run on every start and are safe to repeat).
3. **Create the owner account** – shop name, state, GSTIN (optional) and an administrator login. Tick *Load demo data* to explore with sample data.
4. Sign in.

### Demo data

The demo seed creates *Royal Oak Furniture Gallery, Bengaluru* with ~45 days of sales, products with variants, customers (including an inter-state GST customer for IGST), purchases, sales orders with advances, custom orders, deliveries, a return and an exchange.

| User | Role | Password |
|---|---|---|
| *(the admin you create)* | Admin | *(your choice)* |
| `manager` | Manager | `Demo@1234` |
| `sales1`, `sales2` | Sales | `Demo@1234` |
| `delivery1` | Delivery | `Demo@1234` |
| `accounts` | Accountant | `Demo@1234` |

Change or disable demo users before real use (Employees → Users).

---

## Setting up Neon

1. Create a project at [neon.tech](https://neon.tech) — choose the **AWS Asia Pacific (Mumbai / Singapore)** region for lowest latency from India.
2. In *Connection details*, pick the **pooled** connection (host contains `-pooler`) and copy the connection string.
3. Paste it into FurniShop's connection screen. SSL is always required for Neon hosts.

Every PC in the shop connects to the same database; each user signs in with their own login.

Neon suspends idle compute; the first request after a pause can take a second or two while it wakes. The app retries the connection on start.

---

## Features

| Area | What it does |
|---|---|
| **Dashboard** | Today / month sales, collections, outstanding, low-stock, pending deliveries, orders due; 30-day sales trend, sales by category, payment mix, top products; quick actions. |
| **Sales (POS)** | Fast counter billing: barcode scan / product search / category browse, per-line and bill discounts (limited by role), inclusive or exclusive GST, CGST+SGST or IGST chosen automatically from the customer's state, delivery and installation charges, split payments (cash + UPI + card…), customer advance, credit sale with due date. Save as draft / print / PDF / WhatsApp. |
| **Quotations → Sales orders → Invoices** | Convert with one click; references and prices are preserved. Sales orders take advances, reserve stock and track expected delivery. Converting applies the advances automatically. |
| **Payments** | Receipts against an invoice, an order, or a customer account (oldest invoices first; excess held as advance). Refunds. Payments are never edited or deleted — a mistake is *voided* with a reason. |
| **Returns & exchanges** | Return by line and condition (restock / damaged / scrap); credit to customer account or refund. Exchanges net the old items against new ones: e.g. return a ₹50,000 sofa for a ₹65,000 one and pay the ₹15,000 difference. |
| **Customers** | Profile, addresses, GSTIN (checksum-validated), credit limit, full ledger (invoices, payments, returns, running balance), outstanding and ageing, WhatsApp reminders. |
| **Products** | Categories, brands, variants (size / colour / finish / material) each with its own SKU, barcode, price and stock; HSN and GST rate; cost price visible only to permitted roles; barcode / QR labels. |
| **Inventory** | On hand, reserved (for confirmed orders), available (= on hand − reserved), damaged, on display; stock in, adjustments with reasons, full movement history. Negative stock is blocked unless an admin enables it. |
| **Purchases** | Purchase entry with GST adds stock and updates cost; supplier ledger, supplier payments, outstanding. |
| **Custom orders** | Made-to-order furniture: specification, dimensions, material, photos / drawings, quoted price, advance, production stages (Measurement → Design approved → In production → Quality check → Ready → Delivered → Installed), then invoice. |
| **Delivery** | Pending → Scheduled (date, slot, driver, vehicle) → Out for delivery → Delivered, with proof: signature pad, customer OTP, photo, remarks. Failed / rescheduled deliveries tracked. |
| **Installation** | Scheduled installation jobs with technician, status and completion notes. |
| **Expenses** | Rent, salaries, transport, etc. by category and payment method; included in profit reports. |
| **Reports** | 27 reports: sales (by period / product / category / salesperson / customer), GST (GSTR-1 style B2B / B2C / HSN summary, tax liability), purchases, profit (gross and net of expenses), inventory valuation / low stock / movement / dead stock, payments / collections by method, outstanding & ageing, supplier dues… Filters, quick date presets, and export to Excel, CSV and PDF. |
| **Employees** | Users, roles (Admin, Manager, Sales, Delivery, Accountant + custom), 49 granular permissions, activity log. |
| **Settings** | Shop profile & logo, GST rates & HSN codes, invoice numbering (e.g. `INV-2026-0001`), terms, print formats, payment methods, printers (A4 / 80 mm / 58 mm thermal / labels), WhatsApp templates with live preview, security policy, backups. |
| **Everywhere** | Global search (Ctrl+K) across products, customers, invoices and orders; notifications (low stock, overdue payments, deliveries today); print preview; A4 and thermal layouts; PDF; WhatsApp sharing; tables that switch to cards on narrow windows. |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| **F2** | New invoice (from anywhere) |
| **Ctrl+K** | Global search |
| **F4** | POS: jump to barcode / product search |
| **F6** | POS: jump to customer search |
| **F8** | POS: save draft |
| **F9** | POS: save & print |
| **F10** | POS: save & PDF |
| **F11** | POS: save & WhatsApp |
| **Alt+←** | Back |
| **Esc** | Close dialog / search |
| **Enter** / double-click | Open the selected row |

---

## Architecture

```
FurniShop.sln
├─ src/FurniShop.Core            Domain models, GST calculator, money & Indian formatting, validators (GSTIN, mobile, PIN), permissions, settings, message templates. No I/O.
├─ src/FurniShop.Infrastructure  PostgreSQL (Npgsql + Dapper), migrations, all business services, PDF/print layouts (PDFsharp), barcodes/QR (ZXing), Excel (ClosedXML), backup.
├─ src/FurniShop.Wpf             WPF MVVM desktop app (CommunityToolkit.Mvvm). Views are data templates; printing via WPF FixedDocument.
├─ tools/FurniShop.Cli           furnishop-cli: migrate, create admin, seed demo data, render sample PDFs.
└─ tests/FurniShop.Tests         xUnit: unit tests + end-to-end workflow tests against a real PostgreSQL.
```

* **One source of truth for tax.** `GstCalculator` (Core) computes every line and document total. The POS uses it for the live preview; the server-side service recomputes with the same code on save and never trusts totals from the screen.
* **Services own the rules.** Every write goes through a service method which checks the signed-in user's permission, validates, and runs inside one database transaction (stock, numbering, payment and audit entry commit together or not at all).
* **One path for stock.** `InventoryService.ApplyAsync` is the only code that changes stock; it writes an `inventory_movements` row for every change.
* **Payments as allocations.** A payment has lines (how it was paid) and allocations (what it was applied to). Moving an advance from a sales order to its invoice is a pair of −/+ allocations, so history is never rewritten and every rupee is traceable.
* **Documents.** Layouts draw to an abstract canvas rendered either to PDF (PDFsharp) or to WPF visuals for preview/printing, so the printout and the PDF are identical.
* **Money** is `numeric(14,2)` in the database and `decimal` in code — never floating point. Amounts are shown in Indian grouping (₹1,23,456.00) and in words on invoices.

### Database

Migrations live in `src/FurniShop.Infrastructure/Database/Migrations` and are embedded in the assembly. They run under a PostgreSQL advisory lock, so two PCs starting at once are safe. Main tables: `products`, `product_variants`, `inventory`, `inventory_movements`, `customers`, `quotations`, `sales_orders`, `invoices` (+ `_items`), `payments`, `payment_lines`, `payment_allocations`, `sales_returns`, `exchanges`, `purchases`, `supplier_payments`, `custom_orders`, `deliveries`, `installations`, `expenses`, `users`, `roles`, `permissions`, `audit_logs`, `settings`, `document_sequences`, `attachments`.

---

## Business rules and data integrity

* Credit (unpaid or part-paid) sales require a named customer, not *Walk-in*.
* Credit limit is checked when set.
* Stock cannot go negative unless an admin turns that on; *available* stock excludes reserved quantities.
* Document numbers (`INV-2026-0001`, `QTN-…`, `SO-…`, `RCPT-…`) are assigned inside the saving transaction with a row lock: unique and without gaps even with several counters. Draft invoices get a number only when finalised. Year-based series restart each year; the invoice series cannot be set backwards.
* Finalised invoices cannot be edited; they can be **cancelled** with a reason (stock returns, any money received is kept as customer advance). Cancelled invoices remain visible.
* Payments, stock movements and the activity log cannot be updated or deleted — enforced by database triggers as well as by the services.
* Records with history are soft-deleted (deactivated).
* Discounts above a role's limit need a manager.
* Cost price and profit are only shown to roles with *See cost price*.
* Customer snapshot (name, address, GSTIN, state) is stored on each invoice so reprints never change.

---

## Security

* Passwords are hashed with PBKDF2-SHA256 (210,000 iterations, per-user salt). Accounts lock after repeated failed sign-ins (configurable). Forced password change on first sign-in for users created by an admin. Idle auto sign-out.
* Every service method checks permissions for the signed-in user before reading or changing data; the UI hiding buttons is only a convenience.
* The database connection string is encrypted with Windows DPAPI for the current user and never shown back.
* All SQL is parameterised. CSV exports neutralise spreadsheet formula injection. Uploaded files are checked by content (JPEG / PNG / WEBP / PDF) and size (5 MB).
* **Trust boundary — please read.** This is a two-tier desktop application: each PC connects directly to PostgreSQL with the database credentials. Permission checks run in the app, so anyone who extracts those credentials from a shop PC could bypass them and use the database directly. The database triggers still protect payments, stock history and the audit log from edits and deletes, but for stronger isolation:
  * use a dedicated Neon role for the app (not the project owner) and keep the owner credentials off shop PCs;
  * use Windows accounts with passwords on shop PCs and turn on disk encryption (BitLocker);
  * rotate the Neon password if a PC is lost (Neon console → Roles → Reset password), then reconnect each PC via *Settings → Security → Connect to a different database*.
  A future version could move the services behind a small web API so PCs never hold database credentials; the service layer is already separated to make that straightforward.

---

## Backups

Three layers, all under *Settings → Backup*:

1. **Neon point-in-time restore** – Neon keeps history of the database (the window depends on your plan). Use the Neon console to restore or branch to a moment before a mistake.
2. **Full backup with `pg_dump`** – *Back up now* writes a `.backup` file (custom format) to the backup folder; *Restore* replaces the database from one. Requires the PostgreSQL client tools on the PC (install *Command Line Tools* only from the PostgreSQL installer; version ≥ the Neon server version) — set the path in settings if they are not on `PATH`. Keep the backup folder inside OneDrive / Google Drive for an off-site copy.
3. **Export all data** – a ZIP of JSON files, one per table, for your accountant or migration. No extra software needed. Password hashes are not exported.

The dashboard reminds the admin when the last backup is older than the configured number of days.

---

## Command-line tool

```bash
dotnet run --project tools/FurniShop.Cli -- migrate      --db "<connection string>"
dotnet run --project tools/FurniShop.Cli -- create-admin --db "..." --user admin --name "Owner" --password "..."
dotnet run --project tools/FurniShop.Cli -- seed-demo    --db "..." --user admin --password "..."
dotnet run --project tools/FurniShop.Cli -- sample-pdfs  --db "..." --user admin --password "..." --out ./samples
```

The connection string may instead be given in the `FURNISHOP_DB` environment variable. The CLI runs on Windows, Linux and macOS.

---

## Development and tests

```bash
dotnet build FurniShop.sln
dotnet test tests/FurniShop.Tests
```

Workflow tests need a PostgreSQL server; each test class creates and drops its own temporary database. Point them at a server with:

```bash
export FURNISHOP_TEST_DB="Host=127.0.0.1;Port=5432;Username=postgres;Password=...;Database=postgres"
```

Without a server they are skipped (unit tests still run). The 38 tests cover GST maths (intra/inter-state, inclusive/exclusive, rounding), validators, cash / credit / split-payment sales, quotation → order → invoice with advances, reservations, negative-stock rules, returns and refunds, exchanges, invoice cancellation, immutability of payments, concurrent invoice numbering, purchases and supplier ledger, custom order to installation, delivery proof, permissions and lockout, and consistency between reports, PDFs and exports on the demo data set.

The WPF project builds on any OS with the .NET 8 SDK (`EnableWindowsTargeting`), but only runs on Windows.

---

## Known limitations

* WhatsApp sharing opens WhatsApp (desktop or web) with the message pre-filled; the user presses Send and attaches the saved PDF. Fully automatic sending needs the WhatsApp Business API, which requires a Meta business account — not included.
* E-invoicing (IRN / QR from the GST portal) and e-way bills are not integrated; GST reports are prepared for filing but not uploaded.
* The application needs an internet connection to Neon; there is no offline mode.
* Built and tested on Linux (business logic, database, PDFs, and a full WPF compile); the desktop UI itself should be checked on Windows before rollout — screen layouts, printing to your specific printers, and the signature pad on touch screens.
