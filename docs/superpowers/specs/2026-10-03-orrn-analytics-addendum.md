# orrn analytics addendum — customer analytics and role-gated charts

Date: 2026-10-03 · Extends: `2026-10-03-orrn-c2-redesign-design.md` and `2026-10-03-orrn-plant-modules-design.md`

## 1. Intent

**User request (2026-10-03):** "When I click on a customer I only see a way to edit them. Where are the analytics per customer? And overall, who is leading. I want charts and visuals for most things depending on role: owner or manager get charts, not operators."

**Success:** an owner opens a customer and sees, without editing anything, how much they buy over time, what they buy, how often, how big each load is, what is still pending, and when they last took material; the customers list shows who is leading this month/quarter/year with share and movement; Today, Stock, Dispatch, Dies, Purchase and Production show the right charts to owners/managers while floor roles keep the simple big-button screens.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| A1 | New action `analytics.view` → owner, admin, manager, office, accountant. Floor roles (operator, packer, foundry, press, supervisor, storekeeper, die_room) and viewer do not get it. Every chart and analytics query is gated by it (server: `actionProcedure("analytics.view")` on analytics reads; client: `<Can do="analytics.view">`). | User: charts for owner/manager, not operators. Office (order desk) and accountant need customer numbers. |
| A2 | Charts are a small in-house kit in `@orrn/ui/charts` built with SVG + `d3-scale`, `d3-shape`, `d3-array` (small, tree-shakeable; only allowed chart deps). No heavyweight chart library. Lazy-loaded with the screens that use them (not in the entry chunk). | Full control of C2 tokens, accessibility and bundle size. |
| A3 | Follow the dataviz skill exactly (`/private/tmp/claude-501/bundled-skills/2.1.286/2cebe3d6bc2035b3958410c0eed96bb0/dataviz/` — `SKILL.md` + `references/*`): form first, then colour; **categorical palette is separate from the C2 status tones** (green/blue/amber/red stay reserved for status); palette validated with `scripts/validate_palette.js` against C2 surfaces (light `#ffffff` card / `#f4f4f1` canvas, dark `#17171a`), fixed order never cycled, >8 series fold into "Other"; one axis per chart; legend for ≥2 series + direct labels for ≤4; crosshair tooltip on line/area, per-mark tooltip on bars; table view for every chart; dark mode validated separately; reduced motion = no animation. | Consistent, accessible charts. |
| A4 | Money and weights in charts use `@orrn/domain` formatting (kg en-IN, ₹ en-IN lakh/crore grouping). Time buckets in company timezone (IST default). | Plant conventions. |
| A5 | Customer analytics come from data that exists today (dispatches, dispatch items, bundles, packing lists). Order/baki fields are optional in the response and filled once sales orders exist (plant PL-8). | Ship now, enrich later. |

## 3. Server (plant branch, task PL-A1)

All tenant-scoped, read-only, `actionProcedure("analytics.view")`, ≤100 params, company-timezone buckets, completed dispatches only for volume.

- `analytics.customerSummary({ customerId, from, to, bucket: "week" | "month" })` → `{ customer: { id, name }, totals: { dispatches, bundles, kgG, pieces, avgLoadKgG }, firstDispatchAt, lastDispatchAt, daysSinceLast, series: { bucketStart, kgG, dispatches }[], topSections: { sectionId, label, kgG, bundles, sharePct }[] (top 8 + "Other"), recentDispatches: { id, code, completedAt, bundles, kgG, plNumber? }[] (10), cadenceDays (median gap between dispatches), openOrders?: { orderedG, dispatchedG, bakiG, lines } (null until PL-8) }`.
- `analytics.customerLeaderboard({ from, to, limit = 10 })` → `{ period: { from, to }, previous: { from, to }, rows: { customerId, name, kgG, sharePct, dispatches, rank, previousRank: number | null, deltaPct: number | null }[], otherKgG, totalKgG }` (previous = same-length period immediately before).
- `analytics.trends({ days = 90 })` → daily `{ date, packedKgG, dispatchedKgG }` for the Today chart.
- `analytics.stockAgeing()` → buckets 0–15 / 16–30 / 31–60 / 60+ days by kg and bundles (available + reserved), plus top 8 sections by kg.
- `analytics.dispatchVolume({ months = 12 })` → monthly kg + dispatch count.
Later tasks add `analytics.production` (PL-9/PL-11), `analytics.vendorRates` (PL-6 data), `analytics.dieDrift` (exists as `dieInstance.drift`).

## 4. Web (redesign branch)

- **Chart kit (task AN-2, before Today):** `ChartCard` (title, subtitle, range control row, legend, "Show table" toggle, empty/loading/error states, `analytics.view` gate helper), `TimeSeriesChart` (line or area, single axis, crosshair tooltip, keyboard focusable points), `BarChart` (vertical; grouped not stacked unless parts-of-whole), `RankedBars` (horizontal leaderboard bars with direct value labels and rank movement chips ▲▼ as text + icon, not colour only), `Sparkline` (for tiles; aria-label summarises), `DataTable` view generated from the same data. Palette tokens added to `packages/ui/src/tokens.ts` (`chartCategorical`, `chartSequential`) with a contrast/CVD test calling the dataviz validator.
- **Customer detail (`/customers/:id`)** becomes a view-first page: header (name, GSTIN, last dispatch "12 days ago", cadence "every ~9 days"), KPI tiles (kg this period, dispatches, avg load, share of total), volume chart (monthly kg, 12 months), top sections ranked bars, recent dispatches list linking to `/dispatch/:id`, open orders/baki block (when available); **Edit** moves to a secondary action (sheet). Users without `analytics.view` see the contact card, recent dispatches and edit (if permitted), no charts.
- **Customers list (`/customers`)**: for `analytics.view`, a leaderboard card on top (period segmented control: This month / Quarter / Year; ranked bars top 10 + Other; movement chips), then the searchable list with a kg-this-period column.
- **Role-gated charts elsewhere** (each only with `analytics.view`): Today — 90-day packed vs dispatched (two series, one axis, kg) and stock ageing; Stock — ageing bars + top sections; Dispatch list — monthly volume; Dies (PL-W5) — drift line per copy vs band; Purchase (PL-W2) — vendor rate trend + kg by vendor; Production (PL-W4/W9) — recovery trend, downtime Pareto (bars sorted, no cumulative second axis).
- Native: charts are web-first; native shows KPI tiles + sparklines only for `analytics.view` roles (PL-N tasks).

## 5. Testing

Server: harness tests per procedure (tenant isolation, analytics.view matrix incl. operator/viewer FORBIDDEN, bucket boundaries in IST, Other folding, previous-period ranks). Web: chart kit tests in /__ui (axe, keyboard tooltip, table view parity, dark mode screenshots, no colour-only identity, layout guards); customer page e2e (owner sees charts; operator sees no charts; numbers match server); palette validator run in CI for both modes.

## 6. Questions for the owner (added to the list)

- **Q-A1** Who should see charts and customer numbers? [owner, admin, manager, office, accountant; not floor roles or viewers]
- **Q-A2** Which period should "who is leading" default to? [this financial year to date, with month and quarter one tap away]
