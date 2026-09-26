# FurniShop web — design system ("showroom ledger")

Staff use this app 8–10 hours a day at a showroom counter, on a tablet at the delivery bay and on a phone at a customer's door. It should feel calm and trustworthy, and it should be quick to scan. It must not look like a generic admin template.

## Direction

- **Canvas.** Warm linen (`--canvas #f6f4f0`) with white working surfaces. The warm tone keeps the screen from glaring after hours of use, and white cards separate the working areas.
- **Ink and colour.** Espresso ink (`--espresso #1f1a14`) is used for primary buttons and the sidebar. Walnut (`--walnut #8a4a1f`) is used for links, focus rings and selected states. Brand colour stays scarce, so status colours and data carry the meaning.
- **Status colours.** Five tones: ok, warn, bad, info and muted. Each has a text, background and line value. Status is never shown by colour alone: `Status` and `Badge` always pair the colour with an icon and a label.
- **Type.** IBM Plex Sans for text and IBM Plex Mono for document numbers, SKUs, GSTINs and OTPs, which are the things people read out or copy. Numbers use tabular figures and Indian digit grouping (₹1,23,456.00).
- **Density.** Table rows are 46px, or 36px compact. Controls come in four heights: 30, 36, 44 (default touch) and 52 (POS). Spacing uses a 4px grid.
- **Motion.** Three durations: 120ms, 180ms and 260ms. Motion is used only for drawers, toasts and hover states. `prefers-reduced-motion` turns it off.

All values live in `web/src/styles/tokens.css`. Components read variables only.

## Data visualisation

- Categorical palette `--viz-1…8`, checked with the dataviz palette validator (lightness band, chroma, CVD separation and contrast on the white surface). Colours are assigned in fixed order and never cycled.
- A single series always uses `--viz-1`.
- Charts use one y-axis, thin marks, recessive grid lines, a legend when there are two or more series, and hover tooltips. Every chart sits next to a table or summary with the same numbers.
- Charts: `TrendChart` (area with crosshair), `BarChart`, `HBarChart` (ranked) and `Donut` (share, at most 6 slices, with legend and percentages).

## Layout

- **Shell.** Dark sidebar with the full navigation tree, a topbar with global search (Ctrl K), notifications and the user menu.
  - Tablet: the sidebar collapses to icons.
  - Phone (≤ 760px): the sidebar becomes a drawer, and a bottom bar shows Home, Invoices, Bill, Customers and More.
- **Page anatomy.** `PageHeader` (breadcrumbs, title, one-line purpose, actions), then filters in one row, then summary strip, chart, table.
- **Detail pages.** Two columns (`doc-layout`): content on the left, and a sticky side panel on the right for money position, related documents and the customer. Below 1100px the side panel stacks under the content.
- **Drawers** are used to inspect or edit a record without losing the list (payments, deliveries, users, expenses, activity). **Modals** are for short confirmations and focused tasks (schedule, proof of delivery, cancel with reason).
- **Split rows** (`.split`, `.split.wide-left`, `.split.narrow-left`) stack under 1000px. The page must never scroll sideways, and the QA crawl checks this on every route at 390px width.

## Components (web/src/components)

| Component | Notes |
|---|---|
| `DataTable` | Server paging, sorting and search with URL state (Back and shared links keep filters). Column visibility is remembered per table. Includes CSV/Excel/PDF export of the full filtered result, bulk selection, sticky header and footer, and a card layout on phones via `mobile: title/sub/right/meta`. |
| `Kpi`, `StatStrip` | Headline numbers. A KPI links to the list it summarises. |
| `Tracker`, `Timeline` | Stage progress (custom orders: Received → Design → Production → QC → Ready → Delivery → Installation → Completed) and dated history. |
| `Money`, `DocNo`, `Status`, `Badge` | Consistent formatting for rupees, document numbers and status everywhere. |
| `Field` family | Every input has a label and optional hint/error wired with `aria-describedby`. The `optional` tag is shown instead of asterisks. |
| `useConfirm` | Destructive actions ask for a reason (cancel invoice, void payment, cancel delivery). |
| `SignaturePad` | Pointer-events canvas, works with finger, pen or mouse, and is sent as PNG with the proof of delivery. |

## States

Every data view handles five states:

- **Loading:** skeleton rows in the final layout, with no spinners over blank pages.
- **Empty:** says what goes here and offers the action that fills it.
- **Error:** an `ErrorPanel` with the server's message and a retry button.
- **Success:** a toast, with an optional follow-up action.
- **Permission-limited:** hidden actions. The server enforces permissions regardless.

## Accessibility

- Visible focus rings (walnut) and full keyboard reach: F2 opens a new bill, Ctrl K opens search, and the POS has its own shortcuts.
- Semantic tables, labelled icon buttons, and `aria-sort` on sorted columns.
- Contrast: text tokens pass WCAG AA on both the canvas and white surfaces.

## Honesty rules

- No button pretends to do something the system cannot do.
- WhatsApp opens a pre-filled chat, and the settings page says that nothing is sent automatically.
- Backups show when the last one was taken.
- GST figures are read from saved documents, never recomputed for display.
