# orrn Plant Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend orrn.in from bundles/dispatch into the full extrusion-plant product (purchase → foundry → press → QC/ageing → pack → stock → orders → dispatch, plus store, die room, count and reports) on the existing Cloudflare stack.

**Architecture:** Server modules first on branch `plant/core` (worktree `../orrn-plant`, merged into `redesign/c2` after each reviewed task): roles/approvals, document series, locations + append-only kg ledger, then each stage's tables + tRPC routers with ledger postings. Web screens follow once the C2 shell (C2 plan Tasks 14–15) exists, using `@orrn/ui` C2 components. Native station screens last.

**Tech Stack:** as the C2 plan (Bun, Turbo, Hono/tRPC on Workers, D1 + Drizzle, React/TanStack, Expo).

**Spec:** `docs/superpowers/specs/2026-10-03-orrn-plant-modules-design.md` (decisions P1–P20) · **Plant facts:** `docs/superpowers/review/2026-10-03-architecture-digest.md` (stage N = digest §2 "Stage N"; entities = digest §3; roles = digest §4.2).

## Global Constraints

- Everything in `docs/superpowers/plans/2026-10-03-orrn-c2-redesign.md` Global Constraints applies (tenant scoping, ≤100 bound params, kg display, kg/12ft formula, status colours, i18n, design brief, a11y, redirects).
- Migrations are additive only (new tables/columns, nullable or defaulted); never rename/drop existing tables or columns. Generate with `bun run db:generate` (drizzle-kit) into `packages/db/src/migrations/`.
- Every new table: `id` text uuid pk, `company_id` not null + index `(company_id, …)`, `server_seq` integer default 0, `created_at`, `created_by`, `updated_at` where mutable, soft delete only where the spec says.
- Every stock-affecting submit = document rows + `stock_ledger` rows + audit row in ONE `atomicBatch`. Ledger rows are never updated or deleted; corrections are `cancelled_at` on the voucher + reversal rows referencing `reversal_of`.
- Weights stored as integer grams (`*_g`), lengths integer mm (`*_mm`, 0.1 mm precision fields as `*_dmm` integer tenths where the spec needs it), money integer paise (`*_paise`), percentages integer basis points (`*_bp`).
- Every mutation is `actionProcedure(<action>)`; new actions are added to `packages/server/src/lib/permissions.ts` with role sets exactly per digest §4.2 and spec P9.
- Document numbers come only from `nextDocNumber(db, companyId, docType, at)` (PL-2); never generated client-side.
- Each server task ships harness tests for: tenant isolation (other company's ids → NOT_FOUND), permission matrix rows for its actions, ≤100-param chunking on multi-row writes (use the harness wrapper), ledger rows and balances, and the stage's validation rules.
- User-facing strings via `@orrn/i18n` (`en` + `hi`, parity test; rerun `bun run --cwd packages/i18n export-review`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Ledger = projection**: after any sequence of pack / move / void / dispatch / cancel, `stock.balance` per bundle and per location equals what the bundle rows say. Test in PL-3 (property-style sequence test) and re-asserted in PL-8, PL-10.
2. **Short-weighed scrap lot without a D/C note** must be impossible to mark OK. Test in PL-6.
3. **Document number collisions and month/year rollover** (bundle `26L…` → `27A1` on 1 Jan IST; cast letters; PL FY rollover on 1 Apr). Test in PL-2.
4. **Cast tail**: closing a cast whose logs/billets/bundles/returns don't explain its input kg must require a reason; balance outside 3 % warns, never silently passes. Test in PL-5.
5. **Baki goes negative / over-dispatch**: dispatching more kg than an SO line's balance (beyond customer kg tolerance) needs a manager override; baki never shows negative. Test in PL-8.

---

## Phase P-A — Plant core (server)

### PL-1: Roles, approvals, multi-plant membership

**Files:** modify `packages/server/src/lib/permissions.ts`, `packages/db/src/schema/tenant.ts` (role enum values; drop unique-per-user via new index — additive: create new non-unique index and a new unique `(user_id, company_id)`; the old unique index must be dropped by a migration — this is the ONE allowed index change, ruling recorded), `packages/server/src/context.ts` (active company from `x-orrn-company` header validated against memberships, else the most recent), new `packages/server/src/routers/approval.ts`, `packages/db/src/schema/approval.ts`. Test `packages/server/test/plant-roles.test.ts`.

**Interfaces (Produces):**
- Roles: `owner, admin, manager, office, accountant, supervisor, packer, foundry, press, storekeeper, die_room, operator, viewer`.
- New actions (digest §4.2 rows): `bundle.pack`, `bundle.void`, `stock.move`, `stock.count`, `dispatch.scan`, `dispatch.complete` (exists), `cast.enter`, `cast.close`, `press.run`, `die.reading`, `die.card`, `die.rerank`, `purchase.receipt`, `purchase.dcnote`, `store.txn`, `order.manage`, `invoice.link`, `masters.draft`, `masters.publish`, `users.manage`, `export.accounts`, `reports.read`, `qc.enter`, `ageing.enter`. Existing actions keep working (map old ones onto new roles sensibly; `bundle.create` ≡ `bundle.pack`).
- `approval` table: `{ id, companyId, kind: "dc_note" | "cast_close" | "die_rerank" | "dispatch_overdraw" | "phantom_void", subjectId, requestedBy, status: "pending" | "approved" | "rejected", decidedBy, decidedAt, note }`; router `approval.list({ status })`, `approval.decide({ id, decision, note })` guarded by the approver role for that kind (manager/admin/owner).
- `company.switch({ companyId })` (membership check) and `auth.me` returns `memberships: { companyId, name, role }[]`.
- [ ] Tests: matrix rows for every new action × 13 roles; a user in two companies sees only the active one's data; approval decide by a non-approver → FORBIDDEN; approving twice → BAD_REQUEST.
- [ ] Implement → tests + check-types green → commit `feat(server): plant roles, approvals, multi-plant membership`.

### PL-2: Document series, plant numbers, QR resolver

**Files:** create `packages/db/src/schema/series.ts` (`doc_series`), `packages/server/src/lib/docNumber.ts`, `packages/server/src/routers/resolve.ts`, `packages/db/src/schema/legacy.ts` (`legacy_bundle_map`); modify `packages/domain/src/serial.ts` (formats + parsing), `packages/server/src/routers/bundle.ts` (createReceipt uses plant numbering when `settings.bundleNumbering === "plant"`). Test `plant-series.test.ts`, domain tests.

**Interfaces (Produces):**
- `nextDocNumber(db, companyId, docType: "bundle" | "cast" | "pl" | "lot" | "mrs" | "grn" | "so" | "press_run" | "dc_note" | "count", at: Date): Promise<{ seq: number; number: string; period: string }>` — period = `YYYY-MM` for bundle/cast (IST month), FY `2026-27` for pl/so/lot/dc_note/mrs/grn/count/press_run; formats: bundle `26I4086`, cast `K31` (store year/month/seq), pl `{prefix}{FY}/{seq}` with `settings.plSeries = { prefix: "PL/", start: 1 }`, others `{TYPE}-{seq}`.
- Domain: `monthLetter(month1to12): string`, `formatBundleNo(year, month, seq)`, `parseBundleNo(raw): { year?: number; month: number; seq: number } | null` (accepts `26I4086` and `J540`), `formatCastCode(month, seq)`.
- `resolve.byCode({ code })` → `{ kind: "bundle"; bundleId; number } | { kind: "ambiguous"; candidates: { bundleId; number; year }[] } | { kind: "not_found" }` handling plant numbers, old month-only numbers (candidates across years, newest first), legacy cuid via map, BG serials. Public `resolve.publicBundle({ code, companyHost })` returns `{ number, section, kg, pcs, status }` only.
- [ ] Tests: 20 concurrent `nextDocNumber` distinct; Dec→Jan IST rollover; FY rollover 31 Mar→1 Apr IST; parse/format round-trips; resolver for all four inputs; tenant isolation.
- [ ] Implement → green → commit `feat(server): document series, plant bundle numbers, code resolver`.

### PL-3: Locations and the kg ledger (pack, move, void, dispatch)

**Files:** create `packages/db/src/schema/stock.ts` (`location`, `stock_ledger`), `packages/server/src/lib/ledger.ts`, `packages/server/src/routers/stock.ts`; modify `packages/db/src/schema/inventory.ts` (bundle columns: `location_id`, `die_instance_id`, `cast_id`, `sales_order_line_id`, `kg_per_12ft_milli`, `number_style`), `routers/bundle.ts` (createReceipt posts + rows, requires `locationId` when company has locations; void posts reversal), `routers/dispatch.ts` (complete posts − rows per item at the bundle's location). Test `plant-ledger.test.ts`.

**Interfaces (Produces):**
- `ledgerRows(...)` builders: `packRows(bundle)`, `moveRows(bundle, from, to)`, `voidRows(bundle)`, `dispatchRows(items)`; each returns drizzle insert statements (chunked).
- Routers: `stock.locations.list/create/update` (masters.publish), `stock.move({ bundleIds | codes, toLocationId })` (stock.move; rejects dispatched/void; same-location no-op), `stock.balance({ at?, locationId?, itemKind? })` → `{ items: { itemKind, itemRef, locationId, qtyG }[] }`, `stock.byLocation()` summary.
- [ ] Tests: Review Focus 1 sequence test (random 200-step sequence of pack/move/void/reserve/complete/cancel on 30 bundles, assert ledger balance == projection after each step); move of a dispatched bundle → BAD_REQUEST; ledger rows never updated (no UPDATE statements on stock_ledger in code — grep test); seed creates Y1–Y6, BILLET, SCRAP locations.
- [ ] Implement → green → commit `feat(server): locations and append-only kg ledger`.

### PL-4: Die instances, readings, nitriding, tier history

**Files:** create `packages/db/src/schema/dies.ts` (`die_instance`, `die_tier_change`, `die_weight_reading`, `nitriding_log`), `packages/server/src/routers/dieInstance.ts`. Fields per digest §3.3 and Stage 19. Test `plant-dies.test.ts`.

**Interfaces (Produces):** `dieInstance.list({ sectionId? , status? })`, `get`, `create` (oblique code auto `{sectionCode}-{n}`, n = next per section), `update` (die card fields; die.card), `addReading({ dieInstanceId, pressRunId?, kgPer12ftMilli })` (die.reading; stores previous as `last`), `addNitriding({...})` (die.card; chemicals optionally as store issues once PL-7 lands — nullable FK now), `proposeTier({ dieInstanceId, rank, reason })` (die.rerank → approval kind die_rerank; applied on approve), `drift({ sectionId })` → per instance latest kg/12ft, band min/max, trend over last N readings, `suggestFirst` = lightest in-band.
- [ ] Tests: oblique codes per section unique and permanent; tier applies only after approval; drift ordering; tenant isolation.
- [ ] Commit `feat(server): die instances, readings, nitriding, tier re-rank`.

### PL-A1: Analytics queries (analytics addendum)

**Spec:** `docs/superpowers/specs/2026-10-03-orrn-analytics-addendum.md` §2–§3. **Files:** `packages/server/src/routers/analytics.ts` (mount `analytics`), `packages/server/src/lib/permissions.ts` (`analytics.view` → owner, admin, manager, office, accountant), test `plant-analytics.test.ts`.

**Interfaces (Produces):** exactly the five procedures and return shapes in addendum §3 (`customerSummary`, `customerLeaderboard`, `trends`, `stockAgeing`, `dispatchVolume`); `openOrders` null until PL-8.
- [ ] Tests: tenant isolation; analytics.view matrix (operator, packer, viewer FORBIDDEN); IST bucket boundaries; top-8 + Other folding; previous-period rank and delta; cadence median; ≤100 params with 200 dispatches.
- [ ] Commit `feat(server): analytics queries for customers, trends, ageing and volume`.

### PL-5: Foundry — casts and melts

**Files:** `packages/db/src/schema/foundry.ts` (`cast`, `melt`, `melt_input`, `melt_output`, `spectro_result`, `return_stream`), `packages/server/src/routers/foundry.ts`. Stage 3–5 fields. Test `plant-foundry.test.ts`.

**Interfaces (Produces):** `foundry.casts.list/get`, `foundry.casts.open({ alloy, grade? })` (cast.enter; number via PL-2), `foundry.melts.create({ castId, timestamps: { preheatStart, chargingStart, chargingEnd, castingStart, castingEnd }, ldoInches: { start, end }, inputs: { kind: "lot" | "return_stream"; ref: string; kgG: number }[], chemicals: { storeItemId?: string; name: string; openQty; usedQty; closeQty }[], outputs: { logs: { pcs, lengthMm, kgG }, drossG, feG }, alloy })` → posts ledger (− lots by grade at SCRAP, − return streams, + billets at BILLET, + dross/Fe streams); returns `{ balancePct, warnings }`; `foundry.spectro.attach({ meltId, fileName, mime, base64 ≤ 1 MB, values: Record<string, number> })`; `foundry.casts.close({ castId, tailReason? })` (cast.close; computes tail = inputs − (bundles + returns + billets on hand); tail > 1 % requires reason → approval cast_close).
- Lots referenced in inputs must exist with enough remaining kg (from ledger balance by lot) — until PL-6 lands, allow `kind: "lot"` only when the lot table exists; land PL-6 before PL-5 if simpler (see order note).
- [ ] Tests: Review Focus 4; balance > 3 % warns; return streams seeded (9); cast numbers per month; tenant isolation.
- [ ] Commit `feat(server): foundry casts and melts with ledger postings`.

> Order note: execute PL-6 (purchase) and PL-7 (store) before PL-5 so melt inputs and chemicals can reference real lots and store items.

### PL-6: Purchase — vendors, scrap, lots, D/C notes

**Files:** `packages/db/src/schema/purchase.ts` (`vendor`, `vendor_alias`, `scrap_item`, `scrap_grade`, `purchase_lot`, `dc_note`), `packages/server/src/routers/purchase.ts`. Stages 1–2. Test `plant-purchase.test.ts`.

**Interfaces (Produces):** vendors CRUD + `vendor.merge({ keepId, mergeIds })` (aliases move; masters.publish); scrap items/grades CRUD (masters); `purchase.lots.create({ vendorId, date, origin?, itemId, grade, partyKgG, fcKgG, ratePaise, drossBp?, billBook: "main" | "wb" | "ub", vehicleNo?, photoUrls?: string[] })` (purchase.receipt; status booking), `advance({ id, to: "unload" | "ok" })` (ok requires: within tolerance OR an approved/pending D/C note; posts + scrap ledger at SCRAP on ok), `purchase.dcNotes.create({ lotId, type: "debit" | "credit", reason: "weight" | "grade", kgDiffG, boriDeductionG, note })` (purchase.dcnote → approval dc_note), `purchase.register({ from, to, vendorId? })` (lots + D/C notes + totals).
- [ ] Tests: Review Focus 2; tolerance from settings (default 50 bp); vendor merge moves lots and aliases; tenant isolation.
- [ ] Commit `feat(server): scrap purchase, vendors and D/C notes`.

### PL-7: Store — items, GRN, MRS

**Files:** `packages/db/src/schema/store.ts` (`store_item`, `store_txn`), `packages/server/src/routers/store.ts`. Stage 18. Test `plant-store.test.ts`.

**Interfaces:** items CRUD (masters), `store.receive({ itemId, qty, note, grnRef? })` (store.txn; GRN number), `store.issue({ itemId, qty, purpose: "melt" | "nitriding" | "maintenance" | "other", refId? })` (MRS number; rejects if balance would go negative), `store.exchange({ itemId, qtyOut, qtyIn, note })` (old-for-new), `store.balances()`. Ledger item_kind `store_item`, location STORE.
- [ ] Tests: never negative (concurrency-safe: guarded insert using balance subquery or read-then-check inside batch with predicate), numbers, tenant isolation.
- [ ] Commit `feat(server): central store with GRN and MRS`.

### PL-8: Sales orders, baki, dispatch header, PL v2

**Files:** `packages/db/src/schema/sales.ts` (`sales_order`, `sales_order_line`), `routers/salesOrder.ts`; modify `dispatch.ts` (header fields, item↔line link, overdraw approval), `packingList.ts` + `packages/documents` (snapshot v2: header with company GSTIN/address, customer bill-to/ship-to, PL number, date, vehicle, driver, PO numbers, invoice no; 11 columns Sr · Bundle no · Section · Item · Weight kg · Cut ft · Cut in · Pcs · kg/12ft · Range /12' · PO; group by order line/section; totals "N bundles · X kg"). Test `plant-sales.test.ts`.

**Interfaces:** `orders.create/update/get/list({ status?, customerId? })` (order.manage), lines with `{ sectionId, kgPer12ftMilli?, cutLengthMm, pcs?, kgG, finish?: string, note? }`, `orders.balance({ customerId? })` → per line `{ orderedG, producedG, dispatchedG, bakiG, orderedPcs, dispatchedPcs }`; `dispatch.update` accepts `vehicleNo, driverName, driverPhone, transporter, invoiceNumber, invoiceDate` (invoice fields need invoice.link); `dispatch.linkItem({ itemId, salesOrderLineId })`; auto-suggest line on add (same customer + section, oldest open); completing a dispatch whose items overdraw a line beyond customer tolerance needs approval `dispatch_overdraw`; `pl_number` assigned at complete via PL-2; `reports.salesRegisterCsv({ month })`.
- [ ] Tests: Review Focus 5; baki math; PL snapshot v2 shape (zod) and number assignment once; tenant isolation.
- [ ] Commit `feat(server): sales orders, baki, dispatch header and packing list v2`.

### PL-9: Press runs, cut, QC, ageing

**Files:** `packages/db/src/schema/press.ts` (`press_run`, `press_downtime`, `press_run_line`, `reason_code`, `qc_entry`, `ageing_batch`, `ageing_row`), `routers/press.ts`, `routers/qc.ts`, `routers/ageing.ts`. Stages 8–11. Test `plant-press.test.ts`.

**Interfaces:** `press.runs.start({ shift, castId, dieInstanceId, operatorId, supervisorId? })` (press.run; die instance status → in_use; die in time), `press.runs.dieOut({ runId })`, `press.runs.downtime.add({ runId, startAt, endAt?, reasonCodeId, note? })`, `press.runs.lines.add({ runId, cutLengthMm, pcs, kgG })`, `press.runs.finish({ runId, billets: { count, kgG }, discardG, endsG, kgPer12ftMilli? })` → posts − billets (cast) at BILLET, + discard/ends at Plant Scrap stream; adds die weight reading if given; computes recovery = good kg (lines) / billet kg; `source` typed. `qc.create({ castId, dieInstanceId, rejectG, reasonCodeId, remark? })` (qc.enter; + Plant Scrap). `ageing.create({ shift, gasStart, gasEnd, tempC, inAt, outAt, rows: { castId, dieInstanceId, pcs, kgG, hardness?, poNumber? }[] })` (ageing.enter; no ledger). Reason codes seeded (downtime: die change, billet shortage, power cut, breakdown, die trial, cleaning, other; QC: dent, scratch, bend, dimension, surface, other) and editable (masters).
- [ ] Tests: pieces × length ≤ pressed length when pressed length typed (else skip); recovery math; billets cannot go negative per cast (warn + supervisor override); tenant isolation.
- [ ] Commit `feat(server): press runs, cutting, QC and ageing`.

### PL-10: Count and phantom report

**Files:** `packages/db/src/schema/count.ts` (`count_session`, `count_seen`), `routers/count.ts`. Stage 14. Test `plant-count.test.ts`.

**Interfaces:** `count.start({ locationIds })` (stock.count; number), `count.scan({ sessionId, codes: string[] })` (resolver; records seen with location; duplicates ignored), `count.close({ sessionId })` → `{ phantom: bundle[] (in system at those locations, not seen), found: { code, resolvedBundle? }[] (seen, not in system/elsewhere), moved: bundle[] (seen at another location) }`, `count.resolve({ sessionId, action: "void_phantom" | "move_found", bundleIds })` (void_phantom → approval phantom_void; move_found posts move rows).
- [ ] Tests: phantom/found/moved classification; void after approval posts reversal rows; tenant isolation.
- [ ] Commit `feat(server): stock count with phantom and found reports`.

### PL-11: Reports

**Files:** `routers/reports.ts`, extend `routers/dashboard.ts`. Stage 20 / spec P19. Test `plant-reports.test.ts`.

**Interfaces:** `dashboard.today` extended with `pressedToday { kgG, recoveryBp, downtimeMin }`, `scrapReceivedToday`, `ordersRunningLate` (lines with baki and order date older than 15 days), `phantomSinceLastCount`. `reports.stockByLocation`, `reports.stockAgeing` (buckets 0–15/16–30/31–60/60+ days), `reports.orderBalance`, `reports.purchaseRegister`, `reports.foundryYield({ month })` (+ LDO inches per tonne), `reports.production({ from, to })` (kg pressed, recovery, by die/section, downtime Pareto), `reports.dieDrift`, `reports.dispatchRegister`. All read-only (`reports.read`), paginated where lists, ≤100 params.
- [ ] Tests: each report against a seeded scenario with known totals; tenant isolation.
- [ ] Commit `feat(server): plant reports`.

### PL-12: Seed, dedupe and legacy import

**Files:** extend `apps/server/src/dev-seed.ts` (vendors, scrap items/grades, return streams, store items, 2 casts with melts, press runs, QC, ageing, sales orders with baki, locations with bundles, one count), `routers/legacy.ts`, `customer.merge`. Test `plant-legacy.test.ts`.

**Interfaces:** `customer.merge({ keepId, mergeIds })` (moves dispatches, orders, aliases); `legacy.importLive({ rows })` (FCMS live bundles CSV → bundles with legacy cuid map, location, die/section match, numbers preserved), `legacy.importHistory({ rows })` (sold bundles as dispatched history without ledger rows, flagged `historical`), chunked ≤ 2000 rows per call.
- [ ] Tests: merge moves everything; legacy QR resolves; history doesn't affect stock balance.
- [ ] Commit `feat(server): plant seed, customer merge and legacy import`.

## Phase P-B — Web screens (after C2 Tasks 14–15 land; each uses C2 components, design brief, i18n, layout guards + axe in e2e at 375/390/820/1280/1440)

| Task | Screens | Key e2e |
|---|---|---|
| PL-W1 | Masters: locations, vendors (+ merge), scrap items/grades, return streams, reason codes, store items, sections + die instances list | create/edit each, merge vendors |
| PL-W2 | Purchase: lots list, new lot stepper (vendor combobox, kanta weights with live difference + tolerance chip, grade/item, bill book, D/C note inline when short), lot detail with status advance; approvals inbox (shared, all kinds) | short lot → D/C → manager approves → lot OK → scrap stock up |
| PL-W3 | Foundry: casts list (open/closed, K31), cast detail (melts, inputs/outputs, balance), new melt stepper (timestamps, inputs picker by lot/stream with remaining kg, chemicals, LDO, logs out), close-out with tail | open cast → melt → billets in stock → close |
| PL-W4 | Press: run board for the shift (die in/out big buttons, live timer, downtime start/stop with reason, cut lines, finish with billets/discard/ends + reading); QC entry; ageing batch | run → lines → finish → recovery shown |
| PL-W5 | Die room: section page with copies (tier, status, latest kg/12ft vs band chip), die card, readings chart (simple SVG sparkline), nitriding log, propose tier → approval | propose → approve → tier changes |
| PL-W6 | Store: items with balances, receive (GRN), issue (MRS), exchange | issue beyond balance blocked |
| PL-W7 | Orders: list with baki chips, order detail with lines/produced/dispatched/baki, new order; Pack shows suggested open line; Dispatch header (vehicle, driver, invoice no) + line links + PL v2 view/export | order → pack against line → dispatch → baki drops |
| PL-W8 | Stock: by location, Move (scan to location), Count (start, scan, close, phantom/found/moved, resolve), public `/b/:no` | count with planted phantom → void after approval |
| PL-W9 | Reports hub + each report (printable, CSV), 7 am summary page | totals match seeded scenario |
| PL-W10 | Role-aware nav/tab bar (spec §3 table), company switcher, approvals badge | each role sees its tabs |

## Phase P-C — Native station screens

| Task | Screens |
|---|---|
| PL-N1 | Station-aware tab layout (spec §3), approvals badge |
| PL-N2 | Pack (with location, die instance, cast, order line), Move, Count (camera scan) |
| PL-N3 | Purchase (kanta), Cast/melt, Store |
| PL-N4 | Press run board, QC, Ageing, Die readings |
