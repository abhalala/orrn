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
  `TenantCacheGuard` on web (mounted once in `__root.tsx`) and its native
  equivalent handle this — do not delete them.
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
  (with the grant's `expiresAt`; expired or corrupt values are dropped on read)
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
  `die_rerank` (tier), `dc_note` (note status, bori deduction posting; refused at write time when
  the bori would take an OK lot below what the foundry melted), `phantom_void` (voids a count's
  still-missing phantoms, reversal rows) and `cast_close` (closes the cast, or re-opens it with the
  close-out cleared). A hook that can refuse adds its own batch abort and an explanation in
  `explainApplyAbort`, which `approval.decide` calls when the batch fails.
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
  `voidRows`, `restoreRows`, `dispatchRows`, `openingRows`, `phantomVoidRows`). For existing bundles they are
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

### Die room conventions (W1-DR-S, LEDGER D13)

- An issue ALWAYS targets a run: `dieInstance.issues.issue({ dieInstanceId, pressLineId, pressRunId,
  note? })`, `pressRunId` required. The run must be `queued` with no copy, of the copy's section, and
  on the same line when it has one (a run with no line takes the issue's line). One batch: issue row,
  copy `in_use`, `press_run.die_instance_id`, run `die_issued`. There is no issue without a run and
  no "attach later".
- `issues.cancel` (before die-in) and `issues.return` before die-in both put the run back to
  `queued` with `die_instance_id` null in the same batch; return is refused while die-in is set and
  die-out is not; after die-out a finished run keeps its copy. No path may leave a run `die_issued`
  on a copy that is back on the rack (`runIssueClose` asserts it).
- Multi-row die room writes use `dieRoomAbortUnless(db, landedSql)` as the last guard of the batch
  (D1 has no transactions); catch with `isDieRoomAbort` and re-read to give the precise refusal.
- Copy status by hand: the card (`dieInstance.update`) can only retire a copy from the rack. Nitriding
  moves only through `nitridingOut` / `nitridingBack`, issue through `issues.*`, maker through
  `maker.jobs.*`.
- Files go through a signed PUT, never base64 in a tRPC body: `files.beginUpload({ sectionId? |
  copyId?, kind, name, size, mime, pressDrawing? })` checks limits (image 8 MB, PDF 25 MB, CDR/DWG
  40 MB) and returns `{ uploadId, uploadUrl, method: "PUT", headers, key, fileId, expiresAt }`; the
  client PUTs the raw bytes to `uploadUrl` (Worker route `PUT /files/dies/upload`, streamed into R2,
  Content-Length must equal `size`); then `files.commit({ uploadId })` checks the object and writes
  the row. Reads are `GET /files/dies?key&exp&sig` (10 minutes). Both are HMAC-signed with a key
  derived from `ORRN_MASTER_KEY`; a stage without it refuses (PRECONDITION_FAILED / 503), never an
  empty secret.
- Drift is never stored. Percent, tone, band position and kg/m come from `copyFigures` in
  `lib/dieRoom.ts` on every read (`die.list`, `die.get`, `dieInstance.list`, `dieInstance.get`);
  clients show `latestMilli`, `percentTenths`, `tone`, `position`, `kgPerMetre` as given.
- Owner gate: `assertDieAllowed` (purpose `press`) on issue for every customer of the run; FORBIDDEN
  carries `meta`, read as `error.data.meta` (`TRPCMetaError`). An approved owner override lasts until
  its `meta.closedAt`.
- Newest-first die room lists (`issues.list`, `maker.jobs.list`) page by `limit` + opaque `cursor`
  and return `{ items, nextCursor }` (null on the last page); `dieInstance.list` and `die.list` page
  by `limit`/`offset` with `total`/`nextOffset`.

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
  is checked inside the note INSERT, and OK also requires FC − Σ approved bori > 0. On an OK lot the
  bori may take at most the lot's remaining kg (`lotRemainingSql`: postings − pending bori − live
  melt draws), on read and inside the note INSERT; the bori of a pending note is held back from the
  foundry (lots.available and every melt line subtract it), and the `dc_note` approval aborts if
  the deduction would still leave the lot below zero. A note without bori (kg diff, amount) is never
  limited by melts. Caps: lot weights
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
  inserted first, guarded at write time by "balance minus what the group added stays >= 0",
  `cancelled_at is null`, the item still active and the entry's location still an active `store`
  location (a cancel never puts stock onto a retired item or location: reactivate it first), then the
  mark UPDATE keys on those rows. Either leg cancels both legs. No new number. A second concurrent
  cancel inserts nothing. `diagnoseStoreCancel(db, companyId, txnId)` says why a reversal did not land.
  Who may cancel: store.txn only (storekeeper, owner), any entry, with a reason (ruling PL7RR).
- `clientRequestId` (RP18, max 64) on receive/issue/exchange: unique per company; looked up before a
  number is taken; a unique-index race returns the original; the same id with a different entry
  (kind, item, quantity, purpose, exchange in-quantity) is a CONFLICT. An exchange keeps it on its MRS
  leg. Results carry `replayed` and `cancelled` (a retry of an entry cancelled since must not show it as
  saved stock).
- Other documents that consume store items (a melt's chemicals, LDO; a nitriding log's gas) call
  `prepareStoreDraws` (lib/store.ts) and put its `statements` in their own batch. The last statement
  aborts the whole batch (NOT NULL on `store_txn.id`) unless every draw landed, so the melt cannot
  land without its consumables; catch with `isStoreDrawAbort(e)` and `await prepared.explain()`.
  Use purpose `melt` and `refId` = the cast id, and pass `source: { type: "melt", id: meltId }`.
  At most 40 draws (the abort binds one id each; 40 bind 43 parameters); refId ≤ 64, note ≤ 500;
  skip the call when nothing is drawn (an empty list throws). `ref_id` / `source_id` are opaque ids,
  not foreign keys.
- Draws are marked: `store_txn.source_type` / `source_id` name the drawing document (default: the
  draw's purpose and refId); store-screen entries have NULL. `store.cancel` refuses a marked entry
  ("MRS-12 belongs to a melt; cancel the melt instead"), so a melt's consumption and the store
  register cannot drift apart. The document's own cancel reverses its draws in its batch with
  `storeCancelRows` + `storeCancelMark` per draw (they ignore `source_type`) plus its own "every draw
  reversed" abort, and explains a refusal with `diagnoseStoreCancel`. `store.txns` returns the marker
  so the screen offers "open the melt" instead of Cancel.

## Foundry (casts, melts, spectro, close-out)

- Tables in `packages/db/src/schema/foundry.ts` (`return_stream`, `cast`, `melt`, `melt_input`,
  `melt_output`, `melt_chemical`, `spectro_result`); router `foundry` (`routers/foundry.ts`), shared
  SQL in `lib/foundry.ts`, maths in `@orrn/domain` (`meltBalance`, `castTail`, `CAST_ALLOYS`).
- Return streams: the foundry sheet's 9 `charge` streams (INGOT, PLANT-SCRAP, DISCARD, DROSS-INGOT,
  BEND-LOG, HILL-METAL, PIT-METAL, TENDIS, DROSS-METAL) plus 2 `byproduct` streams (DROSS, FE).
  Codes are stable keys other modules post to (press discard → DISCARD, ends / QC rejects →
  PLANT-SCRAP); code and kind never change after create. They sit at the plant-scrap (`wip`)
  location. `seedDefaults` (masters.publish or cast.enter) and every `casts.open` add missing ones.
  Stream draws are not balance-guarded (no opening counts yet); negative balances show on
  `returnStreams.list`.
- A cast is a campaign: `casts.open` (cast.enter) takes its number from the doc series (`K31`, month
  letter + monthly seq, year stored). Status `open → closing → closed` (`closing` = waiting on a
  `cast_close` approval; rejected → `open`). Never use `cast` unquoted in raw SQL (it is a keyword):
  interpolate `${cast}` or `sql.identifier("cast")`.
- `melts.create` (cast.enter) is ONE batch: cast `melt_count + 1` (guarded: still open, billet store
  and plant scrap still active, output streams still active) → melt row (INSERT … SELECT from that
  cast) → one guarded INSERT … SELECT per input line (lot still OK with remaining ≥ kg; stream still active and
  `charge`) → `foundryAbort` (NOT NULL on `melt_input.id`) unless every line landed → outputs,
  ledger rows (VALUES; the abort makes them safe) → `prepareStoreDraws` statements for store chemicals
  (ruling RP17, purpose `melt`, refId = cast id, `source` = the melt; its own abort) → chemical
  lines (each with its MRS id in `store_txn_id`) → audit. Catch
  `isFoundryAbort` / `isStoreDrawAbort` and explain from current state.
- Ledger of a melt (voucher `melt`, line = melt_input / melt_output line): − `scrap_grade`
  `{item}:{grade}` at the lot's scrap store per lot line, − `return_stream` at plant scrap, + `billet`
  item_ref = cast id at the billet store, + DROSS / FE / returned charge streams at plant scrap.
  A lot's remaining kg = its ledger postings (OK, D/C deductions, cancel) − Σ kg of live melt lines on
  it − the bori of a pending D/C note (`lotRemainingSql`; the postings are read by voucher on the voucher-line unique
  index, never by item_kind, or every scrap row is scanned per lot); `lotCancelLeavesStockNonNegative`
  refuses cancelling an OK lot any live melt has drawn from.
- Balance (spec P15): `meltBalance` — loss above 3 % of the input (`lossG × 10000 > inputG × 300`) or
  any output above input warns; warnings are returned and stored on the melt (`melt.warnings`), never
  block. Burn loss up to 3 % per melt (`allowed_burn_g`) counts as explained at close-out.
- Close-out (Review Focus 4, cast.close): tail = input − (by-products + allowed burn + bundles
  (not void) with `cast_id` + press returns + billets of the cast on hand). `|tail| × 10000 >
  input × 100` needs a reason → `closing` + approval `cast_close` (foundry, manager, admin, owner;
  never the requester; applied by the `cast_close` hook in `lib/approvalApply.ts`). The close UPDATE
  is guarded by the cast's `server_seq` unchanged (moved by every melt create AND cancel), `melt_count`
  unchanged and, for a no-reason close, `castTailWithinBand` at write time.
  `castPressReturnsSql` returns 0 until PL-9 adds press-run / QC returns for the cast; PL-9 must also
  post − billets (item_ref = cast id) when a press run consumes them, or the tail double counts.
- `melts.cancel` (cast.enter or cast.close, open casts only): moves the cast's `server_seq` (so a close
  that read the figures before refuses), marks the melt, reverses every melt ledger row
  (`melt_cancel`, `reversal_of`), cancels its MRS draws through `storeCancelRows/Mark`;
  refused when the cast's billets on hand are below the melt's logs (the press used them), or while a
  drawn store item or the store location is retired (reactivate first; `storeCancelRows` holds the
  same rule at write time and the cancel's "every draw reversed" abort fails the batch).
- `lots.available` (RP9) is the foundry's lot list: remaining kg by lot and by item + grade, never
  rates, party kg, vendor, bill or D/C figures (a pending bori is folded into `stockG`, never shown on
  its own). Readable by cast.enter, cast.close and purchase readers. `casts.list` `meltCount` = live
  melts; `casts.get().cast.meltCount` = every melt ever added (cancelled included).
- Melt inputs: output streams (returned charge streams, DROSS / FE) are re-checked active (and of
  their kind) inside the melt's first UPDATE; melt times may start at most 7 days before the cast
  was opened. The demo seed reset (`apps/server/src/dev-seed.ts`) deletes the foundry and store
  rows before the lots and locations they point at; a new table with a RESTRICT FK to a demo row
  must be added there too.
- `spectro.attach` (cast.enter): file as base64 text ≤ 1 MB decoded (image/jpeg|png|webp, pdf, csv,
  text) and/or values in percent stored as integer ppm (`values_ppm`); `casts.get` lists results
  without the file, `spectro.file` returns it. Moves to R2 later.
- `clientRequestId` on `casts.open` and `melts.create`: a repeat returns the first; the same id for
  another cast (or alloy) is a CONFLICT.

## Press and foundry, Wave 2 contracts (migration 0028, FP-W2)

- Press run children (`schema/press.ts`): `press_run_line` (cut length, pcs, good_g; optional plan /
  order line), `press_billet_use` (cast, length, count, kg; at most `MAX_BILLET_ROWS` = 10),
  `qc_entry` (reason_code kind `qc_reject`; a zero row = "no rejects"), `press_downtime` (reason_code
  kind `downtime`, server start/stop; partial unique = one open downtime per line), `press_remark` /
  `die_remark` (bound to run AND copy; `press_run.press_remark/die_remark` stay as the latest-text
  snapshot). Run shift = `production_day` + `shift_seq` + `shift_id` (never letters; there is no
  separate shift_date). Tap times = `tapped_start_at` / `tapped_stop_at`.
- `press_run` adds `late_entry` + `late_entry_approval_id` (FP-PR-24, approval `press_late_entry`:
  owner, supervisor, manager; never the requester), `client_mutation_id` (unique per company),
  `queue_pos` (FP-PR-25; action `press.queue` = supervisor, office, manager), `trial_result`
  (pass|fail). `press_plan.purpose` production|die_trial|sample|other (FP-PR-23; non-production
  needs no order line, never moves baki).
- Close arithmetic and gates live in `@orrn/domain` (`closeGates`, `closeFigures`, `recoveryBp`,
  `balanceG`, `theoreticalHintG`, `skewUnconfirmed`, `bpPercent1`); the server never trusts a client
  figure. Ledger on close only: voucher `press_run` (−input_g `billet` item_ref = cast id at the
  BILLET `billet_store`; +discard to stream DISCARD, +ends/+rejects to PLANT-SCRAP), reopen posts
  `press_run_reopen` reversals.
- Foundry: `furnace`, `alloy`, `alloy_limit` (ppm min/max per element), cast `alloy_id` + cancel
  columns (status +`cancelled`), melt `status` draft|locked|cancelled (SQL default `locked`: the PL5
  create path posts on create), nullable times/dips for drafts, `furnace_id`, `alloy_id`, `yield_bp`,
  `spectro_reason`, `locked_at/by`. Spec names map onto PL5 columns: metal_in_g = `input_g`, burn_g =
  `loss_g`, balance_bp = `loss_bp`, balance_reason = `balance_note`. Spectro typed ppm columns +
  `verdict` + `limits_snapshot` + `al_source` + `file_key` + void columns. Maths: `meltBalance`
  (lock shape `{lotsG, streamsG, logsG, drossG, feG}`), `castTail({producedG, onHandG, creditedG})`
  (3 %), `spectroCheck` / `spectroVerdict`, `meltLockGates`, `furnaceLoad`, `ALLOY_LIMIT_SEEDS`.
  The PL5 shapes of `meltBalance` / `castTail` still answer as before until W2-FD-S moves to lock.
- A draft melt must not count against a lot or post anything: readers that sum melt lines filter
  `melt.status = 'locked'` (W2-FD-S). 0028 rebuilds `melt` and refuses to run (NOT NULL failure on
  `__w2_melt_guard`) when melts already exist, rather than cascading their lines away.
- Cast numbers: `castSeriesStart` {period, start} now feeds `allocateDocNumbers` for type `cast`
  (the month's first seq); `castNumberParts`, `parseCastCode`, `isSeriesCastCode` in `@orrn/domain`.
- Die copy status +`on_trial` (FP-DR-17): `newCopyStatus(settings)` from
  `settings.dieRoom.newCopyOnTrial` (default on); trial events in `dieCopyNext`; `canIssueDie`
  refuses an on_trial copy (`copy_on_trial`) unless `purpose: "die_trial"`. `maker_die_no`,
  `maker_project_no` on `die_instance`.

## Stock count (phantom report)

- Tables in `packages/db/src/schema/count.ts`: `count_session` (`CNT-{n}` per financial year,
  open → closed | cancelled), `count_location` (the yards a count covers; partial unique index = one
  open count per location), `count_seen` (scans; repeat code or bundle ignored, unknown codes kept),
  `count_line` (the report frozen at close), `count_tally` (variance per yard and section, frozen at
  close; unique per (count, yard, section) with NULL yard / NULL section as keys). Router `count` (`routers/count.ts`), SQL in `lib/count.ts`. Mutations need `stock.count`; `list`, `get`, `phantomSummary` are open to members.
- Replay-safe (review round 1 m-3): `count.start` takes an optional `clientRequestId` (unique per
  company, `count_session.client_request_id`); a retry returns the first count (`replayed: true`),
  the same key for other yards is a CONFLICT. `count.cancel` repeated by the same user with the same
  reason on the count it cancelled answers success again (no second audit row); anyone else's cancel
  of a cancelled count stays BAD_REQUEST.
- One classification for the open-count preview (`count.get`, the "missing list before close") and
  the frozen close: phantom = in stock at a counted yard, not seen, and no ledger row after the
  count's `start_seq` (bundles packed or moved in during the count and not scanned are `changed`,
  never phantom; a bundle with no ledger rows at all, legacy stock not yet taken on, counts as
  changed when its own `server_seq` is past `start_seq`, since its moves post no row); moved =
  seen at a counted yard, system has it at another counted yard; found = seen but unknown/ambiguous
  code, not in stock, or in stock outside the count (or place unknown).
  A scan with a newer ledger row than the scan (`server_seq` compare) is superseded (matched).
- A bundle is a phantom only if NO count saw it: one scanned by another count (any company count,
  cancelled ones too) after this count's `start_seq` is `seenElsewhere` (summary total, column
  `seen_elsewhere_count`), never a phantom. An older sighting in another count that is still
  pending there (its count is open, or its found/moved line is open, and no ledger row since the
  scan) does not change the frozen report but flags the phantom (`CountReportBundle.seenElsewhere`:
  count, yard, `countOpen`, `resolveThere`), makes `void_phantom` refuse it ("Not missing: … seen at
  Y1 in CNT-1 …": move it from that count instead) and keeps it out of "still missing". Yards
  counted as separate counts (at once or one after another) therefore never void real stock that
  another yard's count saw. `sightingsOf` / `sightingClears` in `lib/count.ts` hold the rule.
- Bundles with no location (legacy stock taken on by `stock.openingBalance`) are expected only by a
  count with `include_unplaced` (start input `includeUnplaced`; default on when the count covers
  every active yard, refused otherwise): unseen they are phantoms with `system_location_id` NULL,
  seen they are found (move_found places them). Pass the session's `CountScope`
  (`{ id, startSeq, includeUnplaced }`) to `phantomWhere` / `changedWhere` / `closeStatements`.
- Close posts NO kg rows (spec §5); the closed session is the checkpoint. Close is idempotent and
  every statement after the session UPDATE is guarded by `close_seq`. A counted yard with no scan
  that would report phantoms (or a count with no scan and unplaced phantoms) makes close answer
  PRECONDITION_FAILED until the caller sends `confirmUnscanned: true` (close is final).
- `count.resolve` `void_phantom` stamps the lines `void_requested` and opens ONE `phantom_void`
  approval per count (subject = session id). On approval the hook voids only bundles still
  available at the expected location, with no ledger row since close and no later scan; it posts
  `void` reversal rows (voucher = the count line, `reversal_of` = pack/opening/restore row) and
  status events; the rest become `cleared`. That "still a phantom" rule is ONE SQL fragment,
  `stillPhantomOfLine` in `lib/count.ts`, shared by the hook and `phantomSummary().open` (the 7 am
  "phantoms still missing" number); change it there, never in one caller. It compares other
  counts' scans with the line's count `start_seq` (not its close) and includes pending older
  sightings, so the hook clears what the void request would now refuse. `move_found` moves moved/found bundles to the seen yard
  with ordinary `move` rows, guarded by "still where the count saw the system have it".
- Variance per yard and per section = expected − counted (bundles and kg; positive short, negative
  extra): `count_tally`, one row per (yard, section), written by the close batch from `tallySource`
  (the live tally of an open count is the same SQL), never updated. Expected = the summary's
  expected set at its system location; counted = this count's scans at the scanned yard, except a
  scan superseded by a later ledger row: counted where the system now has the bundle if it is still
  expected, else nowhere (moved out of the count or dispatched). Unknown codes count with die NULL
  and 0 kg; `location_id` NULL = unplaced bundles. Read as `report.variance.{ byLocation, bySection }`;
  "section" is `bundle.die_id` (the `die` catalogue row), not a physical die copy (`die_instance`).
  The adjustments themselves stay ledger rows: phantom void = `void` reversal rows (reason
  "Phantom at count CNT-n", voucher = the count line), move_found = `move` rows (reason "Found at
  count CNT-n"); nothing on the ledger is ever edited.
- `phantomSummary()` = `{ lastCount (with its `locationCodes`), lastDay, open }`: `lastDay` sums
  every count closed on the last count's company calendar day (yards counted one by one in an
  evening read as one full count, owner measure M1); a count whose yards a later count that day
  ALL counted again is left out of the sums and listed in `lastDay.recounted` (a partial overlap
  stays in, so its shared yard counts twice).
- The dev-seed reset (`apps/server/src/dev-seed.ts`) deletes the demo company's count tables (with
  `count_tally`) before `bundle` and `location` (RESTRICT keys) and `doc_series` (CNT-n restarts); a new table with a
  RESTRICT key to location/bundle/purchase_lot must be added to that reset too.

## Analytics (charts and customer numbers)

- Router `analytics` (`routers/analytics.ts`, spec
  `docs/superpowers/specs/2026-10-03-orrn-analytics-addendum.md` §3): `customerSummary`,
  `customerLeaderboard`, `customerKg` (the customers list kg column), `trends`, `stockAgeing`, `dispatchVolume`. All read-only and guarded by
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
  (`sectionId: null`). `openOrders` sums the customer's open order lines (`lib/orders.ts`); null when
  the customer has no open order line.
- Indexes `dispatch(company_id, completed_at)` and `bundle(company_id, created_at)` (migration 0016)
  serve the range filters.

## Sales orders, baki and dispatch header (PL-8)

- Tables `sales_order` + `sales_order_line` (`packages/db/src/schema/sales.ts`); router `orders`
  (`routers/salesOrder.ts`): `create` / `update` need `order.manage` (office, manager, owner); `get`,
  `list`, `balance`, `openLines` are open to every member (lines carry no prices; Pack and Dispatch
  need them, ruling PL8-R1). Numbers `SO-{n}` per FY from `nextDocNumber(.., "so", ..)`; the order stores
  that `period` and the unique key is (company, period, number), so a number repeats every FY: show the
  order date or period beside it. A line's
  section is a `die` row (`sectionId` in the API, `die_id` in SQL); weights are grams (`kgG`),
  `kgPer12ftMilli` = grams per 12 ft, cut length mm, `finish` free text (OI-09).
- Baki maths live only in `lib/orders.ts` (`lineBalances`, `lineBalancePage`, `lineTotals`,
  `orderTotals`, `sumBalances`): ordered = line kg/pcs;
  produced = non-void bundles whose `sales_order_line_id` is the line (set by `createReceipt`; completion
  sets it to the line the dispatch item was linked to, NULL when it left unlinked); dispatched = bundles of
  completed, live dispatches whose `dispatch_item.sales_order_line_id` is the line; baki = ordered −
  dispatched floored at 0, the excess is `overG`. Every subquery is scoped by the outer line's
  company (a forged cross-company id adds nothing); never compute baki anywhere else.
- Rows are never cut silently: `lineBalances` throws `LineLimitError` past 1,000 lines; screens page
  with `lineBalancePage` (`orders.balance` takes `limit`/`offset`, returns `nextOffset`), and report
  totals come from SQL (`lineTotals`, `orderTotals`), never from summing a page. `withBaki` filters
  baki > 0 in SQL before any limit (`openLines`).
- `orders.create` takes an optional `clientRequestId` (unique per company): a retry with the same key
  returns the first order (`replayed: true`) and burns no second SO number; the same key with another
  order (fingerprint of customer, PO, date, status, note and lines in the `order.create` audit meta)
  is a CONFLICT. `orders.update` REQUIRES `serverSeq` (from `orders.get`): a save over a newer
  version answers CONFLICT, read and write time (review round 3).
- Order status: booking → confirmed (`orders.confirm`) → dispatching (set by the first completed
  dispatch) → closed (`orders.close`); booking / confirmed → cancelled (`orders.cancel`). There is
  no reopen. `orders.create` makes a booking and `orders.update` never moves a status (D11; a
  `status` other than the current one is BAD_REQUEST). A line that has bundles
  or dispatch items cannot be removed or change section, and the order's customer cannot change once
  any line has links; these checks also sit in the UPDATE/DELETE WHERE with a `batchAbortUnless`
  statement, so an edit that loses a race fails whole (CONFLICT), never half-applies.
- `dispatch_item.sales_order_line_id` and `bundle.sales_order_line_id` have no foreign key (SQLite
  cannot add one to an existing table): every writer checks company + open order + same section +
  same customer at write time (`dispatch.linkItem`, `bundle.createReceipt`, `addBundles*`).
- Scanning a bundle onto a dispatch links it (`lib/orders.ts suggestLines`): the line it was packed
  for if that line is open for this customer and section, else the oldest open line of this customer
  and section with baki left after what is already on this dispatch, else the NEWEST open line of that
  customer and section (so kg beyond the order meets the overdraw rule), else (no open line for the
  section) unlinked. The add reports return `linked[]`. Unlinking (`linkItem` null) a bundle whose
  section has an open line of the dispatch's customer needs `order.manage` (read and write time):
  the floor cannot take kg off the order to skip the override (ruling PL8-R15).
- The link is decided again where its premise changes (fix round 2, spec S-2): a customer change in
  `dispatch.update` clears every unlink mark and re-suggests every item for the new customer in the
  same batch; `dispatch.complete` re-suggests every item left unlinked by nobody before the overdraw
  read (`relinkOpen`, audited `dispatch.relink`), and its completing UPDATE also requires that no
  such item has an open line of the customer for its section (`noUnlinkedWithOpenLine`; an order
  saved in between answers CONFLICT, and the message says an order for this customer was saved).
  `linkItem(null)` stores the user in `dispatch_item.unlinked_by` (unlinked on purpose, never
  re-suggested) only when an `order.manage` holder unlinks an item that was linked at write time; a
  no-op unlink of a never-linked item and any floor unlink leave the mark as it was, so completion
  still relinks it (review round 3 I-1). A link clears it. `dispatch.relink` audit rows list only the
  links that landed (read back after the batch).
- Review Focus 5: `dispatch.complete` refuses (PRECONDITION_FAILED) when a linked line's dispatched
  total would pass ordered + tolerance (`customer.kg_tolerance_bp`, else `settings.orderToleranceBp`,
  else 500 bp = 5 %) and opens one `dispatch_overdraw` approval (meta = per-line kg, no money);
  nothing moves and no PL number is taken. An approval covers only the line totals it was asked for.
  A pending request is never rewritten: the same figures leave it as it is; new figures withdraw it
  ("Withdrawn: asked again with new figures.") and open a new one requested by whoever pressed
  Complete (an approver approves only what they saw; nobody approves their own figures). The same rule is in the completing UPDATE's WHERE (`overdrawGuard`), followed by a
  `batchAbortUnless`, so a concurrent completion or a late link cannot slip through. A request left
  open becomes `rejected` with note "Withdrawn: …" when the dispatch completes within limits, is
  cancelled or is deleted (ruling PL8-R6).
- Dispatch header: `vehicleNo` (normalised GJ05AB1234), `driverName`, `driverPhone`, `transporter`
  via `dispatch.update` until cancelled (after completion only `dispatch.complete` holders, and the
  stored v2 PL header follows with `json_set`, same number and rows); `invoiceNumber`, `invoiceDate`
  (Tally, P12) need `invoice.link`. `dispatch.update` answers CONFLICT when its write lost a race.
- `dispatch.pl_number` is taken from the PL book series (`settings.plSeries`) at completion, once;
  `packingList.regenerate` and a manual `packingList.create` reuse it. The snapshot is v2
  (`lib/packingListSnapshot.ts`, zod `plSnapshotV2Schema`): `header` (letterhead from
  `settings.letterhead`, bill-to/ship-to, PL no, date, vehicle, driver, PO and invoice numbers),
  `columns` (11), `groups` by order line else section with subtotals, `summary.text` "N bundles ·
  X kg", plus every v1 key with its old meaning so v1 renderers keep working. Range /12' is the
  plant's Excel formula `floor((kg12 + 0.01) × 10) / 10` on the RAW kg/12ft (weight, pcs, length;
  what the customer is billed on), evaluated exactly on integers (`weightRange12ftOf`): raw 2.0895 →
  2.0 although the kg/12ft column prints 2.090; raw 2.090 → 2.1. Only a bundle without pcs or length
  uses the stored thousandths (`weightRange12ftFromMilli`). `header.shipDate` is the ship date as the
  company's calendar day (`settings.timezone`), printed by hand (`plShipDateText`). A group carries
  `orderPeriod`; `plGroupTitle(g, groups)` prints it when two groups share an SO number. The v2 print
  and xlsx carry the dispatch notes and ship date; "1 bundle" everywhere (`bundlesText`). The overdraw
  approval meta names each line's `orderPeriod`; a repeat Complete with the same figures leaves the
  request alone and writes a `dispatch.overdraw.request` audit row (`repeat: true`, with its note).
- `reports.salesRegisterCsv({ month })` (reports.read or export.accounts): one CSV row per completed
  dispatch in the company calendar month, cells guarded against spreadsheet formulas.

## Orders and planning, Wave 1 (FP-OP, W1-OP-S)

- Procedures live beside PL-8's on `orders` (`routers/orderFlow.ts`, spread into `salesOrder.ts`)
  and on `plans` (`routers/pressPlan.ts`). Writes: `orders.confirm|close|cancel|repriceWeight`
  need `order.manage`; `orders.reallocate` needs `order.reallocate`; `plans.create|release|cancel|close`
  need `order.plan`. Reads (`get`, `balance`, `quote`, `timeline`, `lineBundles`, `plantStock`,
  `matchStock`, `late`, `suggestLine`, `plans.get|list|candidates`) are open to members; no prices
  in them (`orders.get` adds `ratePaise` only for `order.price` holders with `priceOnSalesOrder`).
- Line maths only on the server (`lib/orderLines.ts`): a line with `qtyBasis` takes the W1 path:
  basis = the pinned copy's latest reading, else the copy `suggestFirstCopy` picks, else band start
  (`die.weight_min_g`) with `basis_note`; `pcs` -> kg via `orderGrams`, kg -> pcs via `orderPieces`
  (`implied_g`), on the company's `lengthUnit` (inch companies use quarter-inch lengths, so 18 ft
  is exactly 18 ft). Without `qtyBasis` PL-8 figures are stored as typed. Alloy / temper default
  from the die, else `defaultAlloy` / `defaultTemper`.
- Status: `orders.confirm` is the checked booking -> confirmed move (`confirmBlockers`, PO free,
  owner check on a pinned copy). PO is unique per company + customer among non-cancelled orders
  (`assertPoFree` read time + `poRepeatGuard` write time). `close` needs a reason while baki is left;
  `cancel` needs a reason and nothing packed / planned / dispatched (also in the UPDATE's WHERE).
  These three are the only status moves (D11): `create` is booking only, `update` refuses a
  `status` other than the current one, and an edit of a confirmed / dispatching order must still
  pass the confirm blockers and the owner check (purpose `plan`) on a changed pin. `close` is
  guarded by the order's `server_seq` (a kg raise meanwhile fails it).
- Line edits (`orders.update`, `lib/orderLines.ts resolveLineEdits`): a W1 line keeps the basis it
  was locked with and recomputes the uncommitted side from it (typed kg on a pieces line is
  ignored); a section, pin or basis-choice change re-bases it like `repriceWeight` and writes
  `order.weight.refresh` (`via: "order.update"`). kg / pcs / length / section of a line on a
  released plan are refused (read time and in the line UPDATE's WHERE); a W1 line can't go below
  its dispatched kg. A line on any press plan can't be removed.
- Balance strip (`lib/orderStrip.ts`, `orders.balance` and `orders.get` -> `strip` per line):
  planned = draft plans + released plans whose run is live; pressed = good kg of logged runs shared
  over the plan die's lines by kg, minus aged and produced (press_run_line arrives in Wave 2);
  aged = 0 until ageing rows exist; planable = ordered − dispatched − packed − planned − pressed − aged.
  Correlated subqueries name the outer line as `"sales_order_line"."company_id"` explicitly (a bare
  column in a single-table select would bind to the inner table).
- Reallocation (`lib/reallocate.ts`): same customer / plant / unassigned -> applied in one batch
  (bundle UPDATE per from-line, append-only `bundle_transfer` rows, a count abort); another
  customer's bundles -> pending `order_reallocate` (subject = batch id, meta bundle + line ids and
  kg only) applied by its APPROVAL_APPLIERS entry. Bundles in a pending request can't be asked again
  and are not offered by `matchStock`. The first move sets `packed_sales_order_line_id` (original SO
  / PO). The stock ledger is never touched. Owner gate (purpose `dispatch`) for a customer target only;
  `dieOwnerApprovalId` names the approved `die_owner_override` (C47) and the applier re-runs the
  gate at the decision (an override closed meanwhile moves nothing). Plant stock remembers the
  customer it came from (`plantOriginCustomerSql`: its latest transfer's from-line), so giving it to
  another customer needs `order_reallocate`. A bundle on a live dispatch can't be reallocated, and a
  bundle in a pending request can't be dispatched: `addBundlesBySerial` reports it
  (`code: "reallocation_pending"`), `addBundle` refuses, `dispatch.complete` refuses (read time and
  in the completing UPDATE). `orders.reallocations.list` / `get` (members) read the requests
  (pending / applied / rejected) with serials, kg, from / to order, PO and customer names.
- `orders.timeline` also lists `bundle.receipt.create` of bundles packed for the order's lines and
  `dispatch.complete` / `dispatch.overdraw.request` of dispatches carrying them.
- `plans.release`: window ≤ 24 h, each line ≤ planable without its own plan, owner check on the
  preferred copy (owned section without a pin -> "Pick the die copy"), one `queued` press run per plan
  die (`PR-n`), FP-OP-15 warnings returned. `cancel` voids queued runs (refused once one is issued).
  Planable is checked again inside the batch of `plans.create` and `plans.release`
  (`planOverPlannedSql`, CONFLICT when a pack, dispatch or another plan landed after the read).
  `plans.update({ id, serverSeq?, add: [{ salesOrderLineId, kgG?, pcs? }], remove: [salesOrderLineId] })`
  edits a DRAFT plan only (added lines go under their die, a new plan die when needed; an emptied
  die goes; owner gate refuses another party's line on an owned die; planable re-checked in the
  batch; audit `plan.update`). `plans.openLinesForDies({ dieIds, planId?, excludeLineIds? })` lists
  every open line on those dies with planable kg (party, SO number + period, PO, length, planable
  kg / pcs, `ownerBlocked` + `ownerName`); release warnings carry the same fields.
  `plans.pressLines` (members) lists active press lines for the plan's press pick.
  `plans.list` subqueries name the outer plan as `"press_plan"."id"` (a bare column binds inside).
  `orders.quote({ …, lineId })` quotes a saved line on its locked basis (`locked: true`) unless the
  section, pin or basis choice changed; `orders.get` / `orders.list` return `lateDays` (late rule).
  Queued runs are inserted with `pressRunInserts` (every bound column explicit: drizzle binds a JS
  default such as `time_unconfirmed` / `source` when a row leaves it out, which broke the 100-param
  chunking at 7 dies).

## Platform: modules, shifts, releases, backups

- **Modules (FP-PF-07, D14).** `company.modules` is the bought-module list; `[]` means every module
  is on. Migration 0026 turned the old Godseye default `[customers, dies, bundles, dispatches]` into
  `[]`. The gate is in `companyProcedure` (`packages/server/src/index.ts`) and covers mutations
  only: reads stay open (a packer picks a die inside pack with `dies` off) and the nav hides what is
  off. Register every new router in `ROUTER_MODULE` (`lib/moduleGate.ts`), for example press,
  ageing, plans and dieRoom, in the same change that adds the router. A single procedure of an
  ungated router goes in `PROCEDURE_MODULE` (`stock.move`, `stock.openingBalance`). A new approval
  kind goes in `APPROVAL_KIND_MODULE`; it is typed over every kind, so it will not compile until
  you add it. When a mutation writes another module's rows, also call `assertModule(ctx, module)`
  inside it. Godseye `platform.updatePlanAndModules` refuses unknown keys and writes the audit row.
- **Shifts and the production day (FP-PF-05).** Shifts live in `company.settings.shifts` (1 to 4
  of them, they cover 24 h with no gap or overlap, and ids stay the same on rename). Never compute
  "today" for the floor by calendar date. Use `productionDayWindowFor(db, companyId, at?)`
  (`lib/productionDay.ts`): before shift 1 starts, the time belongs to the previous day. It reads
  the settings fresh and never rewrites past rows (`press_run.shift_id` keeps its old id; you
  cannot delete a shift that a press run cites).
- **Releases and devices (FP-PF-11, D8).** `release.check` is public and returns no company data,
  only the gate, the latest version and the APK url. Lookups by install use `device_install_idx`.
  A build is Blocked below the effective `minBuild` (mandatory floors raise it) or when every plant
  that knows the install has revoked it. Offline, the last Open answer holds for 24 h, and an OTA
  update cannot clear a block. `device.register` stores the session that registered
  (`device.auth_session_id`). `device.revoke` ends that session (and only that one), a revoked
  install's register is refused and ends the session that asked, and restore lets it register
  again. Dev seed floors are `minBuild: 1` because apps/native sets no versionCode or buildNumber.
- **Magic links (FP-PF-08, D14).** `disableSignUp: true`. Accounts come only from an approved
  access request or an invite. The public `POST /sign-in/magic-link` is refused. Godseye writes
  owner links straight into `verification`. A link never signs in an account that has a password
  or 2FA (`packages/auth/src/magic-link-guard.ts`). The guard finds tokens stored plain or hashed;
  never configure a custom token hasher.
- **Backups (FP-PF-12).** Every table that has `company_id` is exported unless it is in
  `EXCLUDED_TABLES`, and any column matching `isSecretColumn` is dropped (`lib/backup.ts`). Give a
  new credential column a name ending `*_wrapped` or `*_hash`, or one containing token, secret or
  password, or list it there; the backup test checks every schema table against this.
  Export and drill write an audit row (`backup.export` / `backup.drill`, `meta.ok`) whether they
  succeed or fail. A drill restores into a suspended `restore-drill-{date}` company. The daily cron
  (`30 21 * * *` UTC) exports each active plant once per IST day, then removes drill scratch
  companies older than `DRILL_SCRATCH_KEEP_DAYS` (7), children first, and logs
  `backup.drill.discard`. Runbook: `docs/RESTORE_DRILL.md`.
- **Settings tabs, Today, audit, forgot password (W1-PF-W).** `/settings` tabs live in
  `features/settings/sections.tsx` (`requires` hides a tab from roles without the action; the
  server still judges). Shifts, standards, letterhead and the commercial switches all save through
  `company.updateSettings`; a refused shift save shows the server's message. `/today` reads
  `dashboard.today.kpis` and shows the rate slice only when `value` is non-null; a viewer's
  `scope: "kpis"` answer hides the lists. `/audit` is `audit.list` (cursor paging, filters in the
  URL); Godseye's company Audit tab uses `platform.companiesAudit`. Forgot password is Better Auth's
  `requestPasswordReset` / `resetPassword` (`sendResetPassword` in packages/auth: the email body is
  logged only on a development stack, like magic links). The magic-link guard redirects a refused
  link to `errorCallbackURL?error=ACCOUNT_USES_PASSWORD` when that URL is on a trusted origin
  (/continue shows the password message), else it answers 403. `gu` loads English with it, so a
  key gu lacks falls back to English instead of printing the key.
- **Support (FP-PF-14).** Status goes Open → Answered → Closed, or Open → Closed. A staff reply or
  close lands only if the request is unchanged since it was read; otherwise it is a CONFLICT and no
  audit row is written.

## Worker performance rules

- Minimize Worker CPU and wall time.
- Paginate all lists, sync pulls, platform admin views, and audit views.
- Avoid full-table scans and N+1 query patterns.
- Do not generate PDFs/xlsx files in Workers; clients render exports from snapshots.
- Do not perform printer IO in Workers; delegate queueing and printer connectivity to orrn-spool.
- Keep webhook handlers O(1): verify signature, update one row, return.
- Large imports must be bounded by row/file limits and validated in manageable batches.

## Web bundle: dictionaries and the `/` budget

- Dictionaries are lazy on web. `@orrn/i18n` (the index) exports no dictionary values (raw
  messages: `@orrn/i18n/en`, `@orrn/i18n/hi`, for tests and native only). The web build swaps the
  package's `./dictionaries` for `dictionaries.web.ts` (vite plugin in `apps/web/vite.config.ts`):
  the entry carries only the English the public `/` page renders (`en-public.gen.ts`, picked by
  `packages/i18n/src/public-keys.ts`); full English and Hindi are chunks fetched by `loadMessages`.
  The root route's `beforeLoad` (`ensureLocale`, `shared/lib/locale.ts`) awaits the saved language
  before any page but English `/` renders; `t()` stays synchronous. A new locale (gu) goes in
  `LOCALES` (core.ts), `dictionaries.ts` and the `LOADERS` of `dictionaries.web.ts`. Never import a
  locale file, `@orrn/i18n/en`, `@orrn/i18n/hi` or `@orrn/i18n/guides` from a route or shared web
  code. A new `t()` on the marketing page needs its key in `public-keys.ts` plus
  `bun run --cwd packages/i18n gen:public` (tests fail until then).
  `apps/web/scripts/check-route-budget.ts` fails the build when Hindi, the full English or guide
  text reaches the `/` closure.
- Route files: `validateSearch`, `beforeLoad`, `loader` and `head` stay in the entry chunk
  (`autoCodeSplitting` splits only the component). Their helpers (search parsers, filter lists,
  `isX` guards) live in pure modules; never import them from a component/page module (that drags
  the page into every first load: `/purchase` once put `/` at 306.8 kB) and never use a zod
  schema there (zod is ~18 kB gzip: `/login` parses `?next` with a plain function). The same holds
  for anything the entry imports (`@orrn/env/web` validates with a Standard Schema check, no zod).

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
