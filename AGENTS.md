# AGENTS.md

Instructions for AI agents working in this repository.

## Project overview

ORRN (domain: orrn.in) is built as a sellable multi-company ERP SaaS for manufactured inventory operations: dies, bundles, stock, label printing, dispatches, packing lists, customers, permissions, auditability, web app, and native iOS/iPadOS/Android apps. This is like a collection of ERP modules that can be setup with different tenants based on their needs.

## Stack

- Package manager: Bun.
- Monorepo: Turborepo.
- Web: Vite + React + TanStack Router + TanStack Query + tRPC client.
- Native: Expo + React Native + expo-router.
- Shared UI: `@orrn/ui` Tamagui components, tokens, and Tamagui config for web and native.
- Server: `@orrn/server` tRPC package + thin Cloudflare Worker/Hono entrypoint.
- Auth: Better Auth with email/password and Expo support.
- Database: Cloudflare D1 / SQLite via Drizzle ORM.
- Infra: Alchemy.
- Printing: per-tenant LAN `orrn-spool` deployment; ORRN calls its HTTP API and receives signed webhooks.

## Core commands

```bash
bun install
bun run dev
bun run dev:web
bun run dev:native
bun run dev:server
bun run check-types
bun run build
bun run db:generate
bun run db:push
bun run deploy
```

## Tenant isolation rules

- Every operational table must include `companyId` unless explicitly global/platform-only.
- Tenant APIs must never accept `companyId` from web/native inputs.
- `companyId` must be derived from authenticated server context.
- Every read, update, delete, export, search, count, sync pull, and join must be scoped by `companyId`.
- Prefer composite tenant indexes such as `(companyId, id)`, `(companyId, status)`, and `(companyId, serverSeq)`.
- Return generic `Not found` errors instead of revealing that a row exists in another tenant.
- Do not sync or cache cross-tenant data in web or native clients.
- Every authenticated route (web + native) must enforce a session check and an
  active company membership check. Use the shared `requireCompanyMe` /
  `requirePlatformAdmin` guards on web and the `useMe()` gate on native; do
  not roll your own per-route session checks.
- Clear the React Query cache (`queryClient.clear()`) on sign-out, and drop
  all non-`auth.me` queries when the active `companyId` changes. The
  `TenantCacheGuard` on web and its native equivalent handle this — do not
  delete them.
- A person can belong to several plants (companies). The active plant comes
  from the `x-orrn-company` request header, resolved in
  `packages/server/src/lib/tenantContext.ts`:
  - The header is honoured only when the user has a membership in that company
    and the company is active. Any other value makes every authenticated call
    fail with `403 FORBIDDEN` "You don't have access to that plant" — never a
    silent fallback to another plant.
  - Clients that get that error must clear their stored `x-orrn-company`
    value, refetch `auth.me` and let the user pick a plant again.
  - Without the header, the active plant is the one last chosen with
    `company.switch({ companyId })`, else the newest membership.
  - `auth.me` returns `company` (the active plant) and `memberships:
    { companyId, name, role }[]`; build the plant switcher from that.
  - A valid impersonation grant wins over `x-orrn-company`.
  - The header carries a choice, never authority: the server still derives
    `companyId` from the session + membership, and inputs still never carry
    `companyId`.

## Roles & client-side capability gating

- The canonical role-capability matrix lives in
  `packages/server/src/lib/permissions.ts` (`ACTIONS`, `ROLE_ACTIONS`, `can`,
  `canAny`, `APPROVER_ROLES`, `canApprove`). It is the single source of truth
  for server `actionProcedure(action)` guards and client `<Can>` / `useMe`
  hooks.
- Guard every new mutation with `actionProcedure(<plant action>)` using the
  plant keys (`bundle.pack`, `bundle.void`, `stock.move`, `stock.count`,
  `dispatch.scan`, `dispatch.complete`, `cast.enter`, `cast.close`, `press.run`,
  `die.reading`, `die.card`, `die.rerank`, `purchase.receipt`,
  `purchase.dcnote`, `store.txn`, `order.manage`, `invoice.link`,
  `masters.draft`, `masters.publish`, `users.manage`, `export.accounts`,
  `reports.read`, `qc.enter`, `ageing.enter`, `analytics.view`), not the legacy keys. Every
  holder of a legacy key also holds its plant equivalent, so moving a guard to
  a plant key removes access from nobody (tests in
  `packages/server/test/plant-roles.test.ts` pin this).
- Add new actions to that file (do not invent ad-hoc client-side booleans),
  then reuse them via `<Can do="…">` on web (`apps/web/src/shared/components/can.tsx`)
  and native (`apps/native/components/can.tsx`).
- Action buttons that mutate state must be wrapped in `<Can>` — never
  conditionally removed by hand. The server is still authoritative.
- Platform-admin-only links must be gated by `me.isPlatformAdmin`. Tenant
  users must never see `/platform/*` in their navigation.

## Impersonation

- The only way to impersonate a tenant is via the `x-orrn-impersonate-company`
  request header. The server honours it only when the caller is a platform
  admin **and** holds a valid row in `impersonation_grant` (not expired, not
  revoked). Never accept impersonation targets from the request body.
- Platform admins create grants via `platform.impersonationCreateGrant` (web
  console). The web client stores the target `companyId` in `sessionStorage`
  and sends it as the header on every tRPC request. Revoke via
  `platform.impersonationRevokeGrant` when stopping impersonation.
- If the header is present but the grant is missing, expired, or revoked,
  authenticated tRPC calls return `403 Forbidden`. Clear sessionStorage and
  reload after revoke.
- Impersonation is **web-only** — native must not set the header. Native may
  show the banner if a session somehow includes impersonation metadata, but
  grant creation and tenant switching stay on web.
- `writeAudit` must always receive `ctx.impersonation` when impersonation is
  active so every audit row records `impersonatorId`. Do not call `writeAudit`
  with a synthetic context that drops it.
- Render the impersonation banner on every authenticated screen on both web
  and native. "Stop impersonating" revokes the grant, clears sessionStorage
  (web), and clears the React Query cache.

## User and role model

- Regular users can belong to several companies (plants), one membership per
  (user, company), each with its own role. See Tenant isolation for how the
  active plant is chosen.
- Platform admins are stored separately and are not normal tenant members.
- Company roles (13): `owner`, `admin` (plant admin), `manager`, `office`,
  `accountant`, `supervisor`, `packer`, `foundry`, `press`, `storekeeper`,
  `die_room`, `operator` (floor operator), `viewer`. The matrix follows the
  plant architecture digest §4.2; owner holds every tenant action.
- Approvals: submits that need a second person open an `approval` row
  (`lib/approval.ts`, in the same `atomicBatch` as the document) and are decided
  with `approval.decide`. Kinds and approver roles: `dc_note`, `die_rerank`,
  `dispatch_overdraw`, `phantom_void` → owner, admin, manager; `cast_close` →
  owner, admin, manager, foundry. The requester can never decide their own
  request (owner included); a decided request cannot be decided again. One
  pending request per (company, kind, subject). Kinds with an effect apply it in
  the decision's batch through `APPROVAL_APPLIERS` (`lib/approvalApply.ts`):
  `die_rerank` (tier) and `dc_note` (note status, bori deduction posting).
- Platform impersonation is web-only/support-only, time-boxed, bannered, and audited.

## Native sync rules

- Native local mirrors are tenant-local only.
- Sync endpoints must derive company scope from session and device registration, not client input.
- Offline-first v1 sync scope is the floor-worker subset: dies read, customers read, bundles read/create/transitions, dispatches read/add bundle, print queue.
- Server is authoritative for bundle/dispatch state transitions.
- Content fields may use last-write-wins by server timestamp.
- Client mutation pushes must be idempotent.

## D1 writes (atomic multi-statement)

- Do **not** use `db.transaction()` on Cloudflare D1 — Drizzle emits SQL `BEGIN`, which D1 rejects.
- Perform reads with `db` first, then `atomicBatch()` from `@orrn/db/atomic` (re-exported as `@orrn/server/lib/atomic`) for writes that must succeed or fail together.
- `nextCompanySeq()` runs outside the batch (a failed batch may leave a gap in sequence numbers; that is acceptable).

## Document numbers (doc series)

- Plant document numbers (bundle, cast, PL, lot, MRS/GRN, SO, press run, D/C note, count) come
  only from `nextDocNumber` / `allocateDocNumbers` (`packages/server/src/lib/docNumber.ts`), backed by
  the `doc_series` counter per (company, doc_type, period). Never build a number client-side or
  with `nextCompanySeq` (that is the `serverSeq` sync cursor and the legacy `BG-` group code).
- Periods are computed on the company wall clock (`settings.timezone`, default `Asia/Kolkata`):
  `YYYY-MM` for bundle and cast (sequence resets each month), the Apr-Mar financial year
  (`2026-27`) for everything else. **Do not change `timezone` mid-period**: the period key would
  shift and a month/FY could be split or restarted.
- `settings.bundleNumbering` is `"plant"` (`26I4086`) or `"legacy"` (`BG-000001-B001`, default).
  A plant admin can switch only in a month with no bundles; platform staff (impersonating) any
  time. `settings.plSeries = { prefix, start }` sets the PL book prefix and the first number of
  each new FY (it does not renumber a series already started). Both are set via
  `company.updateSettings` (audited).
- `resolve.byCode` (signed in) resolves plant numbers, old month-only numbers (ambiguous across
  years), legacy cuids (`legacy_bundle_map`) and BG serials. The signed-out QR page
  (`resolve.publicBundle`) returns only `{ number, section }`; kg, pcs and status need a membership
  in that company. Numbers are sequential and there is no rate limit, so never add more public fields.
- Tests that depend on "now" must pin it with `setClockForTests` (`lib/clock.ts`); `createReceipt`
  reads that clock.

## Stock ledger and locations

- `stock_ledger` is append-only: never UPDATE or DELETE a row (a grep test in
  `packages/server/test/plant-ledger.test.ts` fails the build; only the dev-seed reset may delete).
  A correction is a new opposite-sign row with `reversal_of` = the row it cancels.
- Every stock-affecting submit writes its document rows, its ledger rows and an audit row in ONE
  `atomicBatch`. Use the builders in `packages/server/src/lib/ledger.ts` (`packRows`, `moveRows`,
  `voidRows`, `restoreRows`, `dispatchRows`, `openingRows`). For existing bundles they are
  INSERT … SELECT statements that read location and weight at write time and land only if the
  bundle write beside them landed (the bundle carries this request's `server_seq`).
- Invariant (Review Focus 1): for every bundle, ledger balance = projection (available/reserved →
  +weight at `bundle.location_id`, dispatched/void → 0). Bundles from before the ledger have no rows
  and are skipped by every posting until `stock.openingBalance` takes them on.
- The only things that ever touch a ledger row are foreign-key actions: the company cascade
  (deleting a company deletes its rows) and `created_by` SET NULL (deleting a user blanks the actor).
  Code never UPDATEs or DELETEs one. `location_id` is `ON DELETE restrict`, so a location with ledger
  rows cannot be deleted (retire it instead).
- Locations: a location that holds stock (in-stock bundles or a non-zero ledger balance) cannot be
  retired or change `kind`. The check is part of the UPDATE itself (`locationIsEmpty`), not a read
  before it, and the other side is guarded too: `moveRows` only lands bundles while the target is
  still an active yard, and `createReceipt` inserts its `bundle_group` with `INSERT … SELECT` from the
  active yard, so a yard retired after the request read it makes the batch roll back (the bundle rows
  break their group foreign key). `stock.move` returns `moved` counted inside its own batch.
- Weights in the ledger are signed integer grams (`qty_g`). `location_id` NULL = place unknown
  (legacy); there is no location 0 and no default location. `createReceipt` requires a yard
  `locationId` once the company has an active yard location.

## Die room (sections, die copies, tiers)

- The `die` table is the SECTION catalogue (12170 Domal and its weight band per 12 ft); do not rename
  it. A physical copy ("oblique") is a `die_instance` row (`packages/db/src/schema/dies.ts`,
  `routers/dieInstance.ts`). Bundles and press runs reference the copy (`bundle.die_instance_id` is
  nullable for legacy stock and not a foreign key; validate it in code).
- `dieInstance.create`/`update` (die card fields) accept `die.card` OR `masters.publish` (ruling RP7,
  `anyActionProcedure`); nitriding stays `die.card`, tier proposals `die.rerank`.
- The oblique code `{sectionCode}-{n}` and `n` are allocated inside the insert (`INSERT … SELECT`),
  unique per section, permanent, never reused; `update` cannot change them.
- A tier (`tier_rank`, 1 = best, several copies may share one) changes only through `die_tier_change`:
  `dieInstance.proposeTier` (die.rerank) opens an approval of kind `die_rerank` (subject = the tier
  change id), and `approval.decide` applies it in the decision's own batch through the per-kind hook
  table `APPROVAL_APPLIERS` in `lib/approvalApply.ts`. A later approval kind that needs an effect adds
  its hook there; hook statements must be scoped by company and guarded with `decisionLanded`.
- `kg_per_12ft_milli` is thousandths of a kg, which equals grams per 12 ft, the unit of the section
  band (`die.weight_min_g` / `weight_max_g`). `drift` compares them directly.

## Scrap purchase (vendors, lots, D/C notes)

- Tables in `packages/db/src/schema/purchase.ts`; routers `vendor` (`routers/vendor.ts`) and
  `purchase` (`routers/purchase.ts`: `scrapItems`, `scrapGrades`, `lots`, `dcNotes`, `register`,
  `scrapStock`, `seedScrapDefaults`). Weights grams, money paise, percentages basis points.
- Vendors resolve by `nameKey` (letters/digits, lower case) of the name or any alias; one key belongs
  to one live vendor. masters.publish creates active vendors; purchase.receipt / masters.draft holders
  create `draft` vendors inline that a masters.publish holder confirms. `vendor.merge` moves lots and
  aliases to the keeper and turns the merged names into aliases; merged rows stay (`merged_into_id`).
  Brokers (dalal, "K" in a party name) are never vendors.
- Lots: `booking → unload → ok` (booking → ok allowed), `cancelled`. Review Focus 2: OK is refused
  when party − FC > party × `settings.dcTolerancePct` / 10 000 (basis points despite the name, default
  50 = 0.5 %) unless the lot's live weight debit notes (pending or approved) cover the shortfall beyond
  tolerance: Σ kg_diff_g ≥ (party − FC) − floor(party × bp / 10 000) (ruling RP8). The rule sits in
  the OK UPDATE's WHERE (not only in a read before it); keep it there.
- Ledger: OK posts `purchase_lot` (+ FC kg − approved bori) at the scrap store, item_kind
  `scrap_grade`, item_ref `{scrapItemId}:{scrapGradeId}` (`lib/purchase.ts scrapItemRef`), voucher =
  lot id. A note approved after OK posts `dc_note` (− bori) from the `dc_note` approval hook. Cancelling
  an OK lot (masters.publish) posts `purchase_lot_cancel` reversals and is refused if the item+grade at
  that store holds less than the lot put there; when melts record the lot they draw from, tighten
  `lotCancelLeavesStockNonNegative` to "no draw on this lot".
- After OK the stock fields (item, grade, party/FC kg) are locked; rate, bill no, dross stay editable.
  Weights are locked while a weight note or any note with bori is pending or approved.
- Bori is allowed only on debit notes and needs FC kg; Σ live bori (pending + approved + new) < FC kg
  is checked inside the note INSERT, and OK also requires FC − Σ approved bori > 0. Caps: lot weights
  ≤ 100 t (1e8 g), rate ≤ ₹10,000/kg (1e6 paise), kg diff ≤ party kg.
- `approval.list` is readable by every role, so a dc_note approval's `meta` carries only number, lot
  and type/reason — never weights or money (rate = amount ÷ kg); `approval.list` also strips other
  keys and the request note for callers without purchase read access. Approvers read the figures
  from `purchase.dcNotes.get`. Merging needs a confirmed (active) keeper.

## Central store (items, GRN, MRS)

- Tables `store_item` and `store_txn` in `packages/db/src/schema/store.ts`; router `store`
  (`routers/store.ts`, builders and shared checks in `lib/store.ts`): `items.list` (any member),
  `items.create` / `items.update` (store.txn OR masters.publish), `receive` (GRN), `issue` (MRS),
  `exchange` (old for new), `cancel` (all store.txn = storekeeper, owner), `balances` and `txns`
  (store.txn OR masters.publish = storekeeper, manager, admin, owner).
- Quantities are integer milli-units of the item's unit (`qtyMilli`, `qty_milli`; 1000 = 1 kg, 1 litre
  or 1 piece), capped at 100,000 units; piece/set/box/bag take whole units. The ledger carries the
  same number in `qty_g` for item_kind `store_item`. Because of that, `stock.balance` and
  `stock.byLocation` return `qtyG: null` for store rows, with `qtyMilli` + `unit` (balance) or
  `byUnit[]` (byLocation); never add grams and milli-units. They also leave store rows out for callers
  without store.txn, masters.publish or analytics.view. The unit is locked once an item has a movement.
  An item can be retired only at balance 0; the name is unique among items with `retired_at` null.
- A GRN or MRS is one `store_txn` row + one ledger row (`store_grn` / `store_mrs`, voucher = the txn
  id, at the active `store` location, never created implicitly: no store location, no posting) + audit
  row in one `atomicBatch`. The ledger and audit rows are `INSERT … SELECT … FROM store_txn`, so they
  land exactly when the document did. An issue's document INSERT holds the balance check
  (`sum(stock_ledger) >= qty`) in its WHERE, so racing issues cannot overdraw; keep it there.
  `lib/store.ts resolveStoreLocation` is the one location resolver for reads and writes.
- Numbers `GRN-{n}` / `MRS-{n}` per financial year (`doc_series`, unique per company, kind, period).
  An exchange takes one MRS (the old out, purpose `exchange`) and one GRN (the new in), linked by
  `exchange_id`. Numbers allocated before a write that then loses a race leave a gap.
- `store.cancel` (RP15): the entry keeps its number and gets `cancelled_at/by/reason`; reversal rows
  (`store_grn_cancel` / `store_mrs_cancel`, same voucher id, `reversal_of` = the original row) are
  inserted first, guarded at write time by "balance minus what the group added stays >= 0" and
  `cancelled_at is null`, then the mark UPDATE keys on those rows. Either leg cancels both legs. No new
  number. A second concurrent cancel inserts nothing.
- `clientRequestId` (RP18, max 64) on receive/issue/exchange: unique per company; looked up before a
  number is taken; a unique-index race returns the original; the same id with a different entry is a
  CONFLICT. An exchange keeps it on its MRS leg.
- Other documents that consume store items (a cast's chemicals, LDO) call
  `prepareStoreDraws` (lib/store.ts) and put its `statements` in their own batch. The last statement
  aborts the whole batch (NOT NULL on `store_txn.id`) unless every draw landed, so the cast cannot
  land without its consumables; catch with `isStoreDrawAbort(e)` and `await prepared.explain()`.
  Use purpose `melt` and `refId` = the cast id. `ref_id` is an opaque id, not a foreign key.

## Analytics (charts and customer numbers)

- Router `analytics` (`routers/analytics.ts`, spec
  `docs/superpowers/specs/2026-10-03-orrn-analytics-addendum.md` §3): `customerSummary`,
  `customerLeaderboard`, `trends`, `stockAgeing`, `dispatchVolume`. All read-only and guarded by
  `actionProcedure("analytics.view")` = owner, admin, manager, office, accountant. Floor roles and
  viewer get FORBIDDEN; on the client gate every chart with `<Can do="analytics.view">`.
- Volume counts completed dispatches only (`status = 'completed'`, not soft-deleted), dated by
  `completed_at` and weighed as the sum of their bundles' `weight_g`. Weights return as integer grams.
  One join rule everywhere: dispatch LEFT JOIN item LEFT JOIN bundle, every join scoped by
  `company_id` (a foreign key does not check the company; the cross-wired tenant test in
  `plant-analytics.test.ts` fails if any join filter goes). A completed dispatch with no items is a
  dispatch of 0 kg.
- Buckets use the company timezone (`settings.timezone`, IST default). Dates are company-local
  `YYYY-MM-DD`; `from` and `to` are both inclusive days (ruling RP10, as `purchase.register`), so
  `from == to` is one day and the query ends at the local midnight after `to`. The previous period
  is the same number of days ending the day before `from`. `lib/zonedBuckets.ts` shifts timestamps
  by the zone's offset inside SQL; the offset segments are inlined integer literals, so bucketing
  binds no parameters. Aggregate with GROUP BY and never bind id lists.
- Leaderboard: competition ranks (equal kg → equal rank, 1, 1, 3), ties listed by lower(name) then
  id, previous ranks the same way. Soft-deleted or unmatched customers are never rows; their kg stays
  in `otherKgG`/`totalKgG`. Shares use the largest-remainder method (rows + Other = 100.0).
- Stock ageing counts available + reserved bundles by company calendar days from the pack date
  (`bundle.created_at`) to today. Section breakdowns are the top 8 plus an `Other` row
  (`sectionId: null`). `openOrders` stays null until sales orders exist (PL-8).
- Indexes `dispatch(company_id, completed_at)` and `bundle(company_id, created_at)` (migration 0016)
  serve the range filters.

## Worker performance rules

- Minimize Worker CPU and wall time.
- Paginate all lists, sync pulls, platform admin views, and audit views.
- Avoid full-table scans and N+1 query patterns.
- Do not generate PDFs/xlsx files in Workers; clients render exports from snapshots.
- Do not perform printer IO in Workers; delegate queueing and printer connectivity to orrn-spool.
- Keep webhook handlers O(1): verify signature, update one row, return.
- Large imports must be bounded by row/file limits and validated in manageable batches.

## Spool integration (orrn-spool)

- Each tenant gets a `spool_deployment` row in D1 with a shared secret (HMAC-SHA256), Cloudflare Tunnel token, and subdomain.
- ORRN calls the spool's HTTP API with `Authorization: Bearer v1:<timestamp>:<HMAC>` — verified by `@orrn/server/lib/spool-crypto`.
- Spool webhooks to ORRN carry `X-Webhook-Signature: <HMAC-SHA256>` — verified at `POST /webhooks/spool`.
- Spool activation heartbeat: `POST /webhooks/spool/activate` with `X-Spool-Subdomain` header.
- Auto-update: spool checks `GET /api/spool/update-check` on startup.
- Platform admins create/revoke/rotate deployments via `platform.spool.*` tRPC routes.
- Tenant users interact via `spool.*` tRPC routes (printers, templates, jobs).
- Deliverables are platform-specific archives (zip/tar.gz) with pre-embedded config.yaml containing secrets.
- The `@orrn/server/lib/cloudflare.ts` client provisions CF Tunnels and DNS CNAMEs for `<subdomain>.spool.orrn.in`.
- The `@orrn/server/lib/spool-client.ts` SpoolClient class wraps all spool API calls with auto-signing.

## Data and documents

- Packing lists store a historical JSON snapshot in D1.
- Web and native generate PDF/xlsx on the client from that snapshot.
- Print attempts must always be logged whether they succeed or fail.
- Bundle serials are unique per company.
- Bundles are never deleted; use status transitions including `void`.

## Orchestration notes

- Keep root `TODO.md` updated when changing milestone scope or status.
- Keep this file updated when durable conventions or project constraints change.
- Do not add an audit pruning Worker cron unless explicitly requested.
