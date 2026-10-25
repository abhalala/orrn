# AGENTS.md

Instructions for AI agents working in this repository. One document, in the order a change travels: who may do it
(tenancy, permissions), how it is written (D1, ledger, numbers, approvals), the modules (die room, orders, press,
purchase and store, foundry, pack and dispatch, analytics), the platform and the portal, then the cross-cutting rules
(i18n, web bundle, testing, native, hardware). A rule here is a rule the code or a test enforces; where a test pins
it, the test is named. When code and this file disagree, fix the file in the same change.

## Project overview

ORRN (domain: orrn.in) is built as a sellable multi-company ERP SaaS for manufactured inventory operations: dies, bundles, stock, label printing, dispatches, packing lists, customers, permissions, auditability, web app, and native iOS/iPadOS/Android apps. This is like a collection of ERP modules that can be setup with different tenants based on their needs. The first plant is FourCubes (aluminium extrusion): the flow is order, press plan, die issue, press, ageing, pack, dispatch, packing list, with the stock ledger balancing at every step. The foundry and ageing modules are PAUSED on a satellite machine (see Foundry and Ageing); everything else described here is built.

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
- Pure rules (kg per 12 ft, drift, recovery, baki, capacity, close gates) live in `packages/domain`; routers are thin and the server computes every derived number. Clients never send them.

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

Gates and the per-worktree way of running them (ports, per-file server runs, e2e groups) are in "Testing rules" below and
in `docs/LOCAL_DEV.md`. Promotion to production is `docs/DEPLOY_PROMOTION.md`; agents never run it.

# 1. Tenancy and permissions

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
- Sign-out differs on purpose. Web (`shared/lib/sign-out-core.ts`): signing out while offline is refused (the
  session cookie is httpOnly, so only the server can end it, and the outbox with its lease stays until it
  has); the offline path only counts what would be lost (`warnLeaving`) and clears nothing. Native signs out
  locally even offline, because it wipes its own token. Do not "fix" one to match the other.
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

## Roles and client-side capability gating

- The canonical role-capability matrix lives in
  `packages/server/src/lib/permissions.ts` (`ACTIONS`, `ROLE_ACTIONS`, `can`,
  `canAny`, `APPROVER_ROLES`, `canApprove`). It is the single source of truth
  for server `actionProcedure(action)` guards and client `<Can>` / `useMe`
  hooks.
- Guard every new mutation with `actionProcedure(<plant action>)` (or `anyActionProcedure` when two actions
  both qualify) using the plant keys in `PLANT_ACTIONS`, not the legacy keys: `bundle.pack`, `bundle.void`,
  `stock.move`, `stock.count`, `dispatch.scan`, `dispatch.complete`, `cast.enter`, `cast.close`, `press.run`,
  `press.close`, `press.queue`, `die.reading`, `die.card`, `die.rerank`, `die.issue`, `die.maker`,
  `purchase.receipt`, `purchase.dcnote`, `store.txn`, `order.manage`, `order.plan`, `order.reallocate`,
  `order.price`, `invoice.link`, `packingList.combine`, `portal.manage`, `masters.draft`, `masters.publish`,
  `users.manage`, `export.accounts`, `reports.read`, `analytics.view`, `audit.read`, `support.request`,
  `qc.enter`, `ageing.view`, `ageing.enter`. Every holder of a legacy key also holds its plant equivalent, so
  moving a guard to a plant key removes access from nobody (`packages/server/test/plant-roles.test.ts` pins
  this, and checks every plant action is a key of the matrix and has a procedure). One deliberate exception:
  `bundle.void` (and the legacy `bundle.transition`) is supervisor, manager, admin (and owner); the floor
  `operator` was dropped from it (Q29, `plant-roles.test.ts`).
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
- Approvals are in their own section below. Impersonation is above.

# 2. D1 limits and writes

## D1 writes (atomic multi-statement)

- Do **not** use `db.transaction()` on Cloudflare D1 — Drizzle emits SQL `BEGIN`, which D1 rejects.
- Perform reads with `db` first, then `atomicBatch()` from `@orrn/db/atomic` (re-exported as `@orrn/server/lib/atomic`) for writes that must succeed or fail together. `atomicBatchLast` returns the rows of the last statement (a SELECT).
- `nextCompanySeq()` runs outside the batch (a failed batch may leave a gap in sequence numbers; that is acceptable). The same holds for numbers from `nextDocNumber` / `allocateDocNumbers`.
- **At most 100 bound parameters per statement** (`D1_MAX_PARAMS` in `packages/db/src/chunk.ts`). `IN (...)` lists go through `mapInChunks` / `chunk` with `IN_LIST_CHUNK` (90); multi-row inserts use `rowsPerStatement(columnsPerRow)` or `pushChunkedInserts`. Never bind an id list into one statement; aggregate with GROUP BY instead. `packages/server/test/d1-limits.test.ts` exercises the limit.
- Name every bound column of a multi-row INSERT explicitly. Drizzle binds a JS default (`time_unconfirmed`, `source`, ...) for a column a row leaves out, which silently breaks the chunk arithmetic (seen at 7 dies in `pressRunInserts`).
- No transactions means every multi-row write needs a guard that makes a lost race fail the whole batch. The pattern: the guard lives in the statement's own WHERE (not only in a read before it), and the batch ends with an abort statement (`batchAbortUnless(...)`, or a module's own `dieRoomAbortUnless` / `foundryAbort` / `isStoreDrawAbort` / `isDieRoomAbort`) that violates a NOT NULL unless every statement landed. Catch the abort, re-read, and give the precise refusal (CONFLICT or BAD_REQUEST); `approval.decide` does the same through `explainApplyAbort`.
- In correlated subqueries name the outer table explicitly (`"sales_order_line"."company_id"`, `"press_plan"."id"`): a bare column in a single-table select binds to the INNER table. Never use `cast` unquoted in raw SQL (it is a keyword): interpolate `${cast}` or `sql.identifier("cast")`.
- Migrations are additive (`packages/db/src/migrations`, journal `meta/_journal.json`); a new one chains `prevId` off the previous snapshot and takes the next consecutive number (map in `docs/LOCAL_DEV.md`). Never edit a shipped migration. 0028 rebuilds `melt` and refuses to run if any melt row exists (D18): a local DB with melts must be reset.

### Worker performance rules

- Minimize Worker CPU and wall time.
- Paginate all lists, sync pulls, platform admin views, and audit views.
- Avoid full-table scans and N+1 query patterns.
- Do not generate PDFs/xlsx files in Workers; clients render exports from snapshots.
- Do not perform printer IO in Workers; delegate queueing and printer connectivity to orrn-spool.
- Keep webhook handlers O(1): verify signature, update one row, return.
- Large imports must be bounded by row/file limits and validated in manageable batches.

# 3. Ledger and locations

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

# 4. Document numbers

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

# 5. Approvals

## Approvals

- A submit that needs a second person opens an `approval` row (`lib/approval.ts`, in the same `atomicBatch` as the document) and is decided with `approval.decide`. One pending request per (company, kind, subject). The requester can never decide their own request (owner included); a decided request cannot be decided again.
- Kinds and who may decide them (`APPROVER_ROLES` in `lib/permissions.ts`, typed over every kind; `APPROVAL_KIND_MODULE` in `lib/moduleGate.ts` is typed the same way, so a new kind does not compile until both have it):

  | kind | approvers | what deciding does (`APPROVAL_APPLIERS`, `lib/approvalApply.ts`) |
  |---|---|---|
  | `dc_note` | owner, admin, manager | note status and the bori deduction posting; refused at write time when the bori would take an OK lot below what the foundry melted |
  | `cast_close` | owner, admin, manager, foundry | closes the cast, or re-opens it with the close-out cleared |
  | `die_rerank` | owner, admin, manager | applies the tier change (`die_tier_change`) |
  | `dispatch_overdraw` | owner, admin, manager | no applier, by design: `dispatch.complete` reads the status |
  | `phantom_void` | owner, admin, manager | voids a count's still-missing phantoms with reversal rows (one request per count) |
  | `die_owner_override` | owner, admin, manager | the approved row is the grant: `assertDieAllowed` reads it until `meta.closedAt` is set by `dieInstance.closeOwnerOverride`; approval stamps `meta.grantedAt`, a rejection writes nothing |
  | `order_reallocate` | owner, admin, manager | moves another customer's bundles (re-runs the owner gate at the decision) |
  | `press_time` | owner, supervisor, manager | clears `time_unconfirmed` on the run (tablet clock skewed more than 2 minutes) |
  | `press_reopen` | owner, admin, manager | reopens a logged run with reversal postings |
  | `press_late_entry` | owner, supervisor, manager | approved: the run's `late_entry_approval_id` names it and the close gate passes (billets still debit the cast); rejected: the late run is voided and a copy it held goes back to the rack |
  | `ageing_override` | owner, admin, manager | no applier (the ageing lane is paused; the operator re-releases) |
- A hook runs in the decision's own batch, scopes its statements by company and guards them with `decisionLanded`. A hook that can refuse adds its own batch abort and an explanation in `explainApplyAbort`, which `approval.decide` calls when the batch fails. A kind with an effect adds its hook to `APPROVAL_APPLIERS`; a kind without one says so in this table.
- **Prepare step.** Work that needs reads or allocation (party numbers, for one) cannot run inside the batch, so a kind may add an `APPROVAL_PREPARERS` entry (`lib/approvalApply.ts`). `approval.decide` runs it for the kind after the request is read and before the decision batch, and hands the result to the applier as `prepared`. A prepare step must spend only what the applier will really use (`order_reallocate` allocates party numbers only for bundles still available on the line they were asked from, so the customer's series has no gap); anything it allocates and the batch then refuses is lost, which the numbering convention (`allocateDocNumbers`) accepts as a residual gap.
- **Live facts.** The review sheet shows the FACTS of the thing a request touches, not only the requester's note, and Approve stays disabled until they load (Reject is open). The request's own meta is the snapshot (second); `approval.facts` (`lib/approvalFacts.ts`, open to every role like `list`, ids/names/kg/numbers only) is what is true now (first). `press_late_entry` reads the run (`press.runs.get`), `order_reallocate` reads each bundle (still available on the asked line, who would move, who takes a new party number, whether the target order is still open), `die_rerank` reads the copy now (tier, band, last reading against the band, and a flag when the copy changed after the ask). A tier request that changes nothing is refused when it is made (`planTierChange` `nothing_changes`), so a title never reads "tier 2 to 2"; a band lift names both bands. A new kind whose meta cannot stay true adds its facts to `loadApprovalFacts` and to `FACT_KINDS` in `approval-view.ts`.
- `approval.list` is readable by every role, so `meta` carries ids, numbers, bundles, kg and from/to only: never money (a `dc_note`'s rate is amount over kg), never weights of a note. `approval.list` also strips other keys and the request note for callers without purchase read access; approvers read figures from the document itself. The approval sheet must show what is being decided (an `order_reallocate` shows serials, kg and from/to, a `dispatch_overdraw` the per-line kg).
- Rejecting or withdrawing is a decision too: a pending `dispatch_overdraw` is never rewritten, a request for new figures withdraws the old one with the note "Withdrawn: ..." (see Dispatch).

# 6. Die room

## Sections, copies and tiers

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

## Issue, return, files and drift (W1-DR-S, D13)

- An issue ALWAYS targets a run: `dieInstance.issues.issue({ dieInstanceId, pressLineId, pressRunId,
  note? })`, `pressRunId` required, and the UI makes the die room pick the run (no "oldest queued run" default). The run must be `queued` with no copy, of the copy's section, and
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
- **Issue cap per press line (D29, Q44).** The plant preheats the NEXT die in the die oven while the current one runs, so a press line may hold the RUNNING run's copy plus ONE more issued copy for the next queued run (`die_issue.status = 'issued'`, `LINE_COPY_CAP = 2` in `routers/dieIssue.ts`). A third is refused. The cap is read for the message and re-checked in the issue's own INSERT, so two racing issues cannot both land. A holder whose run is gone, logged, voided or whose die is out no longer counts.

## Copy on trial and bulk drawings (W2-DR2)

- Copy on trial (FP-DR-17): `dieInstance.create` and a maker receive put the copy `on_trial` while
  `settings.dieRoom.newCopyOnTrial` is on (default; `company.updateSettings({ dieRoom })`, owner/admin).
  Only a manager (`masters.publish`) may create a copy straight to `available`. `canIssueDie` refuses
  an on_trial copy unless the run's plan purpose is `die_trial` (`lib/dieTrial.ts runPurpose`).
  Nitriding and card status-by-hand refuse it; retire and "send to maker" accept it.
- Trial state lives on the rows, never in `audit_log` (migration `0029_die_trial`): `die_issue.trial`
  (1 when the copy went out `on_trial`, set in the issue insert-select from the copy row) and
  `die_maker_job.from_status` (`available` | `on_trial`; '' on older rows = `available`). Return and
  cancel read `trial`; a maker cancel puts the copy back to `from_status`. The audit meta keeps a copy
  as a log only. A trial issue comes back `on_trial`, unless its run is logged with `trial_result =
  pass`: then the return batch moves it to `available` and writes `die_trial.pass` (`via: "return"`),
  re-checking the pass inside the batch (a reopen meanwhile aborts with CONFLICT).
- `dieInstance.trialPass({ id, pressRunId? , reason? })` (`press.close` or `masters.publish`): with a
  logged `die_trial` run of this copy and result `pass` -> `die_trial.pass`; without a run, only
  `masters.publish` with a reason -> `die_trial.release` (reason in the audit meta). `trialFail`
  (`press.close`, `die.card`, `masters.publish`) writes `die_trial.fail`, optionally retires.
- Press close seam (W2-PR-S): the close records the verdict on the run, then appends
  `applyTrialVerdictOnReturn(ctx, { run, verdict, seq, at, after })` from `lib/dieTrial.ts` to its batch
  (`after` = its own "run logged at seq" SQL). Issue still open on the run: the seam returns it and moves
  the copy (`available`, or `on_trial` for a trial issue without a pass; `die_trial.pass` `via: "close"`
  on a pass). Copy already back `on_trial`: a pass moves it to `available` with `die_trial.pass`. A
  carried-over issue (C43) skips the seam. The contract is at the top of `lib/dieTrial.ts`.
- Bulk attach (FP-DR-19): `files.matchNames({ names })` reads file names (`12170.pdf` -> section by
  section code, `12170-1.cdr` -> copy code, `/` reads as `-`), never writes; two sections with one code
  are `ambiguous`, never guessed. The web then runs `beginUpload` (`pressDrawingIfNone` for a section
  PDF) / PUT / `commit` per file, one at a time. `commit` inserts the PDF as a plain file, sets
  `die.drawing_key` only where it is still null (and no file is flagged), then flags the file only if
  the key is now its own: two commits racing never fail, and the loser stays a plain file.
- Board: `die.list` takes `copyStatus`, `copies`, `profileKind`, `owner`, `sort`; `die.boardCounts`
  feeds the tiles, which count copies. A copy-status tile opens the copies in that status
  (`dieInstance.list({ status })`, so the list total equals the tile); "Dies without copies" lists
  sections. A die import goes in calls of 2,000 rows (`importChunkSize("dies")`), other sheets 500.
- Die copy status +`on_trial` (FP-DR-17): `newCopyStatus(settings)` from
  `settings.dieRoom.newCopyOnTrial` (default on); trial events in `dieCopyNext`; `canIssueDie`
  refuses an on_trial copy (`copy_on_trial`) unless `purpose: "die_trial"`. `maker_die_no`,
  `maker_project_no` on `die_instance`.

## Die room rules that live elsewhere

- Owner gate: `assertDieAllowed` (`lib/dieOwner.ts`) is called for purposes `plan`, `press`, `pack` and `dispatch`; a customer's own die never goes to another party's order, run, bundle or load unless an approved `die_owner_override` exists. A section grant in the portal never overrides another party's ownership (see Customer portal).
- A press run's close reaches the copy through `applyTrialVerdictOnReturn` (see Press); drift on a reading is never stored (above); die life (`life_g` against logged runs) is a report (see Analytics).
- Nitriding: maker send/receive and nitriding out/back have no e2e yet (BACKLOG 19, open).
- Nitriding close is server-derived: the client sends `openG` and `usedG` and the server derives `closeG = open - used` (a `closeG` still sent must equal it; used above open is refused).
- Files (`DIE_FILES` R2 bucket) are committed in two steps (signed PUT, then `files.commit`); an upload that is never committed leaves an orphan object.
- The daily cron purges orphan die-file objects (`lib/dieFilesPurge.ts`, lifecycle note in `docs/R2_BUCKETS.md`).

# 7. Orders and planning

## Sales orders, lines and baki (PL-8)

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
- **Order status.** booking → confirmed (`orders.confirm`) → dispatching (set by the first completed dispatch) → closed (`orders.close`); booking / confirmed → cancelled (`orders.cancel`). There is no reopen. These moves are the ONLY status moves (D11): `orders.create` makes a booking (a `status` other than booking is refused) and `orders.update` refuses any `status` other than the current one; an edit of a confirmed / dispatching order must still pass the confirm blockers and the owner check (purpose `plan`) on a changed pin.
  - `orders.confirm` is the checked move (`confirmBlockers`): PO number present, at least one line, each line complete (pieces or kg, cut length, alloy, temper, a copy or a tier when `dieRequired` is on), owner check on a pinned copy. PO is unique per company + customer among non-cancelled orders (`assertPoFree` at read time, `poRepeatGuard` in the write).
  - `close` needs a reason while baki is left and is guarded by the order's `server_seq` (a kg raise meanwhile fails it); `cancel` needs a reason and nothing packed, planned or dispatched (also in the UPDATE's WHERE).
  - A line that has bundles or dispatch items cannot be removed or change section, and the order's customer cannot change once any line has links; these checks also sit in the UPDATE / DELETE WHERE with a `batchAbortUnless`, so an edit that loses a race fails whole (CONFLICT), never half-applies.
- `dispatch_item.sales_order_line_id` and `bundle.sales_order_line_id` have no foreign key (SQLite
  cannot add one to an existing table): every writer checks company + open order + same section +
  same customer at write time (`dispatch.linkItem`, `bundle.createReceipt`, `addBundles*`).

## Order flow: procedures, line maths, edits (FP-OP)

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
- Line edits (`orders.update`, `lib/orderLines.ts resolveLineEdits`): a W1 line keeps the basis it was locked with and recomputes the uncommitted side from it (typed kg on a pieces line is ignored); a section, pin or basis-choice change re-bases it like `repriceWeight` and writes `order.weight.refresh` (`via: "order.update"`). kg / pcs / length / section of a line on a released plan are refused (read time and in the line UPDATE's WHERE); a W1 line can't go below its dispatched kg. A line on any press plan can't be removed.
- Price: `ratePaise` exists only on lines whose caller holds `order.price` and only while `priceOnSalesOrder` is on. Rates reach no other surface: not the portal, not the order book unless `withRates`, not the packing list. Accounts stay outside ORRN (O1): a rate is operational data, never a tax invoice.
- Dispatch value (`dispatch.getDispatch.value`, FP-OP-14) sums `round(weightG x ratePaise / 1000)` over items whose order line has a rate (unrated items counted in `rateMissing`), only with `order.price` and the switch; the web dispatch detail shows it as a value card, not a tax invoice.

## Balance strip, hold and reallocation

- Balance strip (`lib/orderStrip.ts`, `orders.balance` and `orders.get` -> `strip` per line):
  planned = draft plans + released plans whose run is still live (queued ... counting); logged = good kg of LOGGED runs'
  `press_run_line` rows naming the order line (a run logged without lines shares its good kg over the plan die's lines
  by kg); pressed = max(0, logged − aged − produced) (the press log never reduces baki); aged = 0 until the ageing lane
  returns (`ageing.forOrder`); packed = linked bundles available + reserved; inStock = available only; held = bundles
  held for the line in the yard (`heldG`, `heldBundles`); over = max(0, produced − ordered) per line; planable =
  max(0, ordered − dispatched − packed − held-in-yard − planned − pressed − aged) (`@orrn/domain` `planableG`), the held
  term counting only held bundles on no line so a held bundle on this line is never taken off twice. The strip also
  gives `inStockBundles` / `inStockPcs` (FP-OP-05).
  Correlated subqueries name the outer line as `"sales_order_line"."company_id"` explicitly (a bare
  column in a single-table select would bind to the inner table).
- **Hold for an order line (FP-OP-17, D17).** `lib/orderHold.ts`: `orders.hold` / `orders.release` / `orders.holds` / `orders.matchStock` (`order.manage`) set `bundle.held_for_line_id`; the bundle stays available and stays where it is. Dispatch refuses a bundle held for another customer's open line (`held_for_order`, "Held for SO-n (customer)"); held for this customer it goes on linked to that line and the hold ends when the dispatch completes. Closing or cancelling the order, or voiding the bundle (D17), releases the hold, all audited. Known gap: a count's `phantom_void` does not release a hold (BACKLOG 24). UI: `/orders/$id` per line "Hold stock" (`orders.matchStock` → bundles on no line or this line, not held, at most 100 → `orders.hold`, length warnings shown from the answer), a "Held" chip (`strip.heldBundles`, `heldG`) and "Held bundles" with Release selected / all. Hold refusals are mapped with every other orders refusal (see i18n).
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

## Press plans (FP-OP-10..13, 15, 16)

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
- An owned die is never planned for another party: `plans.create` / `update` / `release` run the owner gate (purpose `plan`) on every line, and a line whose die belongs to someone else shows `ownerBlocked` + `ownerName` in `plans.openLinesForDies`. `plans.update` also respects `plan.purpose` (BACKLOG 41: order lines on a die_trial plan are refused; trial and sample plans carry no order line).
- A plan's window defaults from `plans.defaultWindow` in the company time zone and production day (`productionDayWindow`), never the browser's zone (BACKLOG 51). The plan board is desktop and 11-inch only.
- Under 820 px the plan is a read-only phone view (`plans.phone`, FP-OP-21; `reports.read` or `order.plan`): released plans with per-die cut lengths, planned vs pressed from logged runs only (`planDieView` in `@orrn/domain`), a run-state chip and the day summary. No rates, no 17-column grid.

## Order book (FP-OP-18..20)

- The order book (`orders.list`, FP-OP-20) and its header strip (`totals` of the same answer,
  `orders.bookTotals`) come from ONE SQL text (`lib/orderBook.ts`): per line, segments are taken in
  order and capped so they add up to the ordered kg: dispatched, in stock (AVAILABLE on the line
  only, the D-3B rule, the same set as the detail strip's `inStockG`; `inStockBundles` counts the
  same set), held (reserved on a dispatch + held in the yard for the line; `heldBundles`), pressed
  not packed, planned, rest (not planned); `over` is its own figure. Stage filter `held` exists. Every filter
  (party, `city` = the customer's billing address city, status, `late`, order-date range, `stage`,
  search) narrows rows and strip together. The strip is the sum of the grid by construction; a test
  holds it. Never sum bars on a client. `orders.bookCities` lists the city options.
- Book labels = line strip figures (BACKLOG 52): `bar.inStockG` / `totals.inStockG` = Σ AVAILABLE
  bundle kg on the order's lines (= Σ strip `inStockG`, never capped at the baki); `overG` = Σ
  max(0, produced − ordered) per line (= Σ strip `overG`; planned, pressed or held kg never make an
  order "over"). The drawn in-stock segment is `inStockBarG` (capped so the segments add up to
  ordered); the web draws widths from it and names kg from `inStockG`. Header = Σ rows = Σ line
  strips for the same filter (`orders-w4-book-strip.test.ts`).
- Late (FP-OP-18, Q7 A): confirmed / dispatching, baki left, and the expected date passed; with no
  expected date, ordered more than 15 days ago (`lateOf` in `lib/orderStrip.ts`, the same rule in
  SQL in `orderBook.ts` and `LineFilter.late`). `lateRule` says which date fired. `expectedDate`
  is stored as typed (`orders.create|update`, null clears it); the server does not default it. The
  new-order form starts it at order date + `settings.orderLeadDays` (default 15, Q8). The late
  fallback for an order with NO expected date stays a fixed 15 days (`LATE_AFTER_DAYS`); it is not
  tied to `orderLeadDays` (a plant that changes its lead days changes only the form's prefill).
  `orderLeadDays` has no settings screen yet (set with `company.updateSettings`).
- No client arithmetic on kg / pcs / % (review r1 I-1): the new-order form's row quotes, die-block
  and order totals and each row's share (`shareBp`, shown with `bpPercent1`) come from
  `orders.quoteMany` (a read sent as POST because a long order's rows do not fit a GET URL);
  `orders.get` returns `dieTotals` and, for `lineFilter` (die, cut length, stage, has baki), `shown`
  = the kept `lineIds` with their ordered kg / pieces (`pcsMissing` counts lines with no pieces).
  Bars are drawn with `flex-grow: grams`, never a computed width.
- `orders.stockOn` (FP-OP-19) is the in-yard bundles of an order by line from
  `bundle.sales_order_line_id`; the print, PDF and Excel are made on the client from it
  (`@orrn/documents/stock-on-order`). No rate in it.
- Print and Excel (FP-OP-19, `@orrn/documents` order-sheet): the order sheet (rate column only when the server sent rates), the plan's shift die list (never a rate) and the order book export (up to 2,000 orders, current filter) are built on the client from server rows and load on click only. Documents are never generated in the Worker.

# 8. Press

## Press runs, close and the ledger (FP-PR)

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
  BILLET `billet_store`; +discard to stream DISCARD, +ends/+rejects to PLANT-SCRAP, D23), reopen posts
  `press_run_reopen` reversals.
- D22 (0030_press_fixes): `input_g` is the WEIGHED billet kg; recovery and balance use it. When the
  cast's billets on hand are less, the close needs `billet_short_reason`, still debits the full kg
  (BILLET may go negative), and writes `press_run.billet_short_g`; the cast shows Σ of its logged
  runs as `billetsShortG` (`foundry.casts.list` / `get().closeout`). The billet row's write-time guard
  is "on hand ≥ min(input, on hand as read)".
- Run lines on a production run whose plan die has lines must each name a `pressPlanLineId`; a row
  without one takes the plan's single line of that cut length, else "Pick the order line for N mm".
  Rows with no order line only on trial / sample runs (or a run with no plan lines). A die trial's
  verdict (and the issue return) reaches the copy through lib/dieTrial `applyTrialVerdictOnReturn`
  (skipped when C43 carries the issue on); a reopen puts a copy its pass racked back `on_trial`
  (`die_trial.reopen`).
- Reopen blockers: `lib/press/reopenBlockers.ts` `registerReopenBlocker((db, companyId, runId) =>
  Promise<string | null>)`; `press.runs.reopen` calls `reopenBlockers` and refuses with CONFLICT and
  the first reason. The ageing lane registers its check there (a non-void `ageing_row` pointing at
  the run); register at module load of the ageing router so every worker has it. Late entry checks the copy with
  `assertLateEntryCopy` (issue words, owner gate) and refuses retired lines and runs > 7 days old.
  The late-entry sheet's queued-run path names the copy when the run has none issued (BACKLOG 50):
  a searchable picker of the run's die only, `available` copies (+ `on_trial` for a die trial run).
- **Trial, sample and other runs.** `press_plan.purpose` is production | die_trial | sample | other. A non-production run needs no order line and never moves baki (Q12 A: its good pieces are packed as plant stock). The trial verdict (`trial_result` pass | fail) reaches the die copy through `applyTrialVerdictOnReturn` (see Die room). Trial, sample and other runs are counted apart in the day summary (`trialKgG`, `trialRuns`). KNOWN GAP: no screen creates a non-production plan (the plan board's `plans.create` call sends no `purpose`; only the API and the e2e helper `ownPress` do), so on a real plant a die trial run is set up through the API until a plan-purpose picker exists.
- Press summary and Today's tile, ONE rule (BACKLOG 53b; `lib/pressReport.ts` `dayFigures`):
  `press.summary` / `dashboard.today.pressedToday` `kgG`, `inputG`, `pcs` and `recoveryBp` count
  PRODUCTION runs only (pressed kg and its recovery share one base); die trial, sample and other runs
  are `trialKgG` / `trialRuns` and the screens say them apart ("Pressed 710.4 kg · trials 13.8 kg").
  `runs`, scrap, downtime and the late share count every run. The press report keeps every run as a
  row and its `totals.productionGoodG` / `productionInputG` are the same production figures. Today's
  tile reads `today.press.*` (a gu floor namespace, BACKLOG 54), never `press.summary.*`.

## The press station on the web (FP-PR-02..15, W2-PR-W)

- Routes: `/press` (board), `/press/lines` (press master), `/press/lines/$id` (queue), `/press/runs/$id` (the station), `/press/report`, `/press/summary`. The station is for an 11-inch tablet; the phone gets a read-only Press tab (see Native rules).
- The server owns time: Start, Stop, Resume and Undo start take the server clock, not the tablet's. A tablet clock more than 2 minutes off marks the times unconfirmed (`skewUnconfirmed`) and a supervisor confirms them through an approval (`press_time`). Start stays locked until the die room has issued a copy to this run (FP-PR-04); one running run per line.
- Counting is a stepper (billets, pieces, butt and ends, rejects, remark and reading). What the operator has typed lives in the screen state and `sessionStorage` (`count-draft.ts`), starts from what the server holds, carries a fingerprint of the saved rows it started against (a different base means another device saved newer figures), and a failed save never clears it. Close figures (balance, recovery, theoretical hint, gate list) are only ever the server's: the close preview calls the same `closeGates` / `closeFigures` as the close.
- Gates: the 24 `CLOSE_GATE_CODES` equal the server's `GATE_TEXT` (`features/press/errors.test.ts` compares them) and each has `press.console.gates.*` in en, hi and gu. Rejects take a `qc_reject` reason code and a zero row means "checked, none"; a blank is not a check. An open downtime blocks the close.
- Roles on the buttons: `press.run` (press, supervisor) runs the station; Log run, reopen and confirm-times are `press.close` holders and appear through the `STATION_ACTION` map wrapped in `<Can>`. Only the run's supervisor can log it. A reopen is an approval (`press_reopen`) and refuses while any `registerReopenBlocker` check names the run.
- Every refusal sentence a press router can raise is mapped in `features/press/errors.ts` to `press.console.errors.*` (en, hi, gu); `errors.test.ts` fails on any plain `bad()` in the press routers that has no mapping. Never show `error.message` on the tablet.
- Queue (FP-PR-02, 25): `press.queue.list` filters by section, order and copy; `press.queue.move` / `urgent` / `pullBack` (action `press.queue` = supervisor, office, manager, Q15) reorder queued and die_issued runs, put an urgent run first and take one cut length back to planable, each audited. Downtime (FP-PR-12): reason code kind `downtime`, server start and stop, one open per line (partial unique index). Handover names a relief operator and keeps the start time. A run's remark is bound to the run AND the die copy (`press_remark`, `die_remark`).
- Report and summary (FP-PR-17, 18): `press.report` is the 17-column grid plus CSV; `press.summary` (`pressedToday`, recovery, downtime, by line and shift, late share) is the Today tile's source. The production day starts with shift 1, never at midnight.
- Late entry (FP-PR-24, Q17 A): supervisor only, flagged `late_entry`, the start at most `LATE_ENTRY_MAX_DAYS` (7) days back, the stop already past, approval `press_late_entry` (never the requester); billets still debit the cast. With no supervisor named the logger becomes the supervisor (Q23).
- Offline outbox (FP-PR-19): while the tablet reports offline, a station write (start, stop, count, resume, undo start, billets, pieces and kg, butt and ends, rejects, log run) waits in a per-plant outbox in localStorage and is sent in order with the same `clientMutationId` when the link is back; later writes of a run queue behind earlier ones; a refused write stays as a conflict with its own message and other runs carry on. Station mutations use `networkMode: "always"` so an offline tap reaches the outbox instead of pausing in React Query. Remarks and the die reading carry no key and are not queued (an offline Log run asks to clear them first). The queue is keyed by plant: one user's writes are never sent as another's.

## Collectors: press frames, alerts, spectro inbox (FP-PR-21, 22, FP-FD-12, W4-COLLECTORS)

- Contract documents live in orrn-spool (`docs/press-collector.md`, `docs/spectro-watcher.md`, branch `fp/collectors`). Only simulators run today (`--press-sim`, `--spectro-sim`); real PLC and spectrometer bring-up is owner-only (Q46, Q47) and nothing is faked as done. A simulated frame or file says `simulated: true` all the way through and is never upgraded to a device reading.
- Endpoints are called by an orrn-spool node, never by a person: `POST /collector/press/frames` (at most 100 frames), `POST /collector/spectro/ingest` and `PUT /collector/spectro/upload` (`apps/server/src/collector-routes.ts`, `lib/collectorNode.ts`). The request carries `Authorization: Bearer v1:<ts>:<hmac>` over `METHOD|path|ts|sha256(body)` with the node's shared secret (the heartbeat's token; vectors in `test/fixtures/spool-hmac-vectors.json`). There is no unsigned fallback and no session path. Bodies are capped (256 KB) before they are read.
- Read-only towards the press: the collector never writes the PLC and `lib/pressCollector.ts` never writes a press run's figures. It stores frames (idempotent on node + seq), keeps one annotation row per run (`press_run_collector`) and opens, extends and ends alerts (`press_alert`, limits in `press_alert_threshold`, an alert ends after 5 minutes without an out-of-band frame). Q-09: collector billet kg within 2 % of the run's typed input is accepted; beyond it the annotation says `collector_variance` and the run is untouched.
- A frame belongs to the run that was on its line when it was sampled; the rule is applied when a run is evaluated (on ingest, by the sweep of recently changed runs, and on every `runSummary` read), so a late-entered, re-timed or voided run is still right. `press_run_id` on a frame is only a cache of that rule. A frame sampled more than 5 minutes ahead of ORRN's clock is refused.
- Retention: simulated frames 24 h, real frames 90 days (the real period is an owner decision), purged by the daily cron; run annotations outlive their frames.
- Spectro: the file is hashed before it is stored (R2 `{companyId}/spectro/{inboxId}`, at most 5 MB, ticketed 10-minute PUT), idempotent on (company, sha256). A person with `cast.enter` attaches it to a melt of an existing cast or dismisses it; nothing is attached automatically (the sample label is free text) and a simulated file can only be dismissed.
- Screens: `/press/alerts` (list + acknowledge, `press.close`), Settings > Devices "Collectors" card (limits per press and reading, `masters.publish`; needs users.manage to reach, managers use the API) and `/casts/inbox` (attach / dismiss, `cast.enter`). The Today alerts chip links to the list.

# 9. Purchase, store and foundry

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

**The foundry web screens and the melt lock are PAUSED (D27): they were built on the omafranky satellite (`wt/W2-FD-S` @28a5a83, unpushed) and are not on this branch.** What main holds is the PL5 server (below), the pack cast picker and `receiptCast`, the press billet ledger, the portal certificate and the collector inbox. `/casts` and `/foundry/*` do not exist yet (the old `/preview/foundry*` URLs redirect to `/preview/coming-soon`; the fixture components stay in `features/preview` only for the lane); casts can be opened by API only. On resume the foundry migrations renumber after the current head.

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
  KNOWN DEFECT (BACKLOG 55, FINAL-CHAIN finding 3): press runs now post − billets (item_ref = cast id)
  at the BILLET store and discard / ends / rejects to DISCARD / PLANT-SCRAP when they are logged (see Press),
  but `castPressReturnsSql` still returns 0, so the tail does not credit what the press consumed and a
  reason-free close is refused after any logged press run. Fix it before the foundry lane resumes.
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

### Foundry and press contracts from migration 0028 (FP-W2)

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

## Ageing (paused)

The ageing lane (AG-01..17: trolleys, readings, ageing rows, packed share per batch, the `ageing_override` applier, `bundle.ageing_row_id`, pack from a trolley) was built only as contracts on the satellite (`wt/W3-AG-C` @1ebdd0d) and is not on this branch. What main holds: reason kinds `ageing_hold` / `ageing_rework` / `ageing_scrap` (en, hi, gu), actions `ageing.view` / `ageing.enter` (no procedure uses them), the `ageing_override` kind (no applier), the `reopenBlockers` registry in `lib/press`, and `ageing` in `ROUTER_MODULE` with no router. `createReceipt` refuses `bundle.ageing_row_id`, pack is a hand path, `agedG` on the order strip is 0, and the chain test skips the ageing step. When the lane resumes its migrations take the next free numbers and it registers its reopen check in `registerReopenBlocker` at module load of its router.

# 10. Pack, stock and dispatch

## Pack (FP-PK-01..05, 07, 10, 14)

- **One band rule (D15).** `lib/bundleBand.ts`: a bundle's band is its die copy's band when it names a
  copy (a copy without `band_id` takes the section's primary band), else the section's
  (`die.weight_min_g/max_g`). `bandVerdict` gives `position` (below/in/above) and the drift `tone`
  from `driftTone` with the plant's `drift` settings. `bundle.previewLine`, `bundle.getBySerial`
  (`/b/$serial`), the pack session and the stock views all call it; never compute a tone elsewhere.
  Drift limits are the plant's (Settings > Standards > Thresholds), default green 800 bp, amber 1000.
- **Weight.** Server derives kg per 12 ft; a typed weight needs a reason whenever the plant's edge
  node reports a scale (`weightNeedsReason`); `weight_source` is `scale` or `manual`, and `scale` with
  no scale on the node is refused. Pack rejects take a `qc_reject` reason code (`rejectReasons`).
- **Numbers.** Company serial: plant style (`26I4086`, monthly `bundle` series) or legacy
  `BG-000001-B001` by `bundleNumbering`. Party number (C25): a customer with a bundle-number policy
  (`monthly` `26J12`, `fy` `2026-27/12`, `lifelong` `4086`) gets its own `party_bundle` series per
  customer (`allocatePartyBundleNumbers`); without a policy the party number is the serial. The PL
  shows the party column only when a party number differs from the serial. A reallocation renumbers
  (`lib/reallocate.ts`): bundles that go to another customer's line take that customer's next numbers
  (its series under a policy, else the serial); bundles that go to plant stock take their serial back, so
  no customer's number travels into plant stock and onto another customer's load. The `order.reallocate`
  audit row keeps `partyNos` (`{ bundleId, serial, from, to }` per bundle that really moved). Every
  renumber sets `bundle.sticker_stale`: the printed sticker still carries the old number until the label
  is printed again (the label printer clears it when the spool takes the job; the label sheet's Print
  calls `bundle.labelsPrinted`, `bundle.pack`). Web and native show "Sticker needs reprint"
  (`pack.stickerStale`) on the bundle page, the stock list and the pack session. A typed old party number
  no longer resolves; the QR carries the serial and still does.
- **Plant stock (D20).** `createReceipt` with source Plant stock writes a `bundle_transfer` to plant
  and no ledger row, so the floor can scan it onto any load under D12's office rule. Imported legacy
  bundles stay unassigned until the office acts.
- **Pinned copy and cast.** An order line that pins a die copy packs on that copy (D15); another copy
  is refused unless an `order.manage` holder sends `overridePin` (audited `bundle.receipt.pin_override`).
  `receiptCast` accepts only a cast with a locked melt (a draft melt has made no billets).
- **Pack cast and ageing.** `createReceipt` takes the die copy, the cast (`receiptCast`, locked melts only), the source (order line, Plant stock) and the rejects with `qc_reject` reason codes. Pack today is the hand path: the trolley slice waits for the ageing lane (see Ageing). `requireCastOnBundle` turns on automatically after the first locked melt (`castAuto`); a plant with no foundry module keeps it off.
- **Void holders (Q29).** `bundle.void` (and the legacy `bundle.transition`) = supervisor, manager,
  admin (and owner); the floor operator does not void.
- **Label contract (Q31, BACKLOG 54).** Frozen in `@orrn/domain` (`labelContract.ts` + its test): the
  QR holds the bundle number only (`{origin}/b/{number}?c={slug}`; `{tenant}.orrn.in/b/{number}`, bare,
  month-only, cuid and BG forms keep resolving), and template variables are exactly `LABEL_VARIABLES`
  (no `uuid` or other id). Changing either needs a decision and a plan for labels already in the yard.
- **Labels and printing.** No printer node configured: the saved session shows the A4 sticker-sheet fallback with an honest message instead of a dead print button (BACKLOG 13). Print attempts are always logged, success or failure (`print_log`). The label template variables are `LABEL_VARIABLES`; a cast label variable exists in `lib/bundle-label.ts`.

## Replay-safe floor writes (BACKLOG 50, 47)

- Floor writes that a bad network retries take an optional
  `clientRequestId` (`clientRequestIdSchema`): `bundle.createReceipt`, `dispatch.scan`,
  `dispatch.addBundlesBySerial`, `stock.move`, `orders.create`, `count.start`, the store's receive / issue / exchange, and the
  `dispatch.create` / `dieInstance.addReading` pair below. The write's own audit row is the record
  (`lib/requestReplay.ts`): its id comes from (company, kind, key), its meta carries the request
  fingerprint and the first answer. A repeat answers the first result with `replayed: true` and writes
  nothing (no second serial, bundle, label, item or ledger row); the same key with other content is a
  CONFLICT; two identical calls racing end on the audit primary key and both answer the first result.
  Web pack keeps one key per session + payload in the draft (`receiptRequestKey`); the dispatch scan /
  paste / search sheets send one key per call and resend it once on no reply
  (`features/dispatch/request-key.ts`: `newRequestKey`, `sendOnce`).
  Native sends the same keys through `replayKey` + `sendOnce` (`apps/native/lib/replay-key.ts`; see Native rules). Retry-prone
  imports use `lib/importReplay.ts` (row ids derive from the request id; same id with other rows is a
  CONFLICT); the store and stock count sessions have their own request ids. A new floor write that can
  be retried follows the same rule.
- `dispatch.create` and `dieInstance.addReading` take the same `clientRequestId` (the write's own audit row id derives from the key, `meta` holds the fingerprint; a repeat answers the first result with `replayed: true`, other content is CONFLICT); the web sends them from `dispatch/request-key.ts` `requestIdFor` (the same content keeps the key, a landed write clears it). A new floor write that can be retried follows the same rule, and `apps/native/__tests__/replay-audit.test.ts` fails until the phone's side of it is listed.
- The press station has its own key, `client_mutation_id` on `press_run` (unique per company), and the outbox reuses it (see Press).

## Dispatch (FP-PK-10..17)

- **Add paths (D12).** Every way onto a dispatch classifies a code in ONE place, `lib/scan.ts`
  (`classifyScan`), in a fixed order: not_found, ambiguous, void, dispatched, held, held_for_order,
  reallocation_pending, unassigned, wrong_customer, owned_die, already_on_dispatch, added. The paths
  are `dispatch.scan` (floor, `dispatch.scan`), `dispatch.addBundlesBySerial` and `dispatch.addBundle`
  (office, `dispatch.addBundle`). Scan codes look up serial AND party number; two different bundles
  matching is `ambiguous`, never a silent pick. `allowUnassigned: true` (office paths only, needs
  `order.manage`, audited `dispatch.add_unassigned`) lifts ONLY the unassigned block, because legacy
  stock has no order line; the scan path never lifts it. `wrong_customer` always blocks: moving a
  bundle to another customer is `orders.reallocate`, not a dispatch add. Refusals reach clients as
  `ScanRefusal` (`lib/scanRefusal.ts`) with a code the web maps to its own words.
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
- **Capacity override.** `dispatch.create|update` store `vehicleCapacityG` (warn only while loading,
  `capacityCheck`). `dispatch.complete` over capacity needs `capacityOverrideReason` (audit
  `dispatch.capacity_override`); the completing UPDATE re-checks capacity in SQL, so a capacity
  lowered after the read cannot slip through without a reason.
- **Dispatch header and ship-to.** Vehicle, driver, transporter and capacity are entered on the dispatch detail ("Edit details"); the Complete sheet (web `complete-sheet.tsx`, native dispatch screen) asks for a vehicle number first (`vehicleGate`, `normaliseVehicleNo` in `@orrn/domain`) and cannot be skipped there; the server does not refuse `dispatch.complete` without one (BACKLOG 70, open), so direct API use still passes. The vehicle number and driver print on the packing list when set. A ship-to address per dispatch ("Same as bill-to" or a second address) is not built (BACKLOG 63); the PL prints the customer's billing address.
- Dispatch from a sales order (FP-PK-17, migration 0031 `dispatch.sales_order_id` + `truck_id`):
  `dispatch.create({ salesOrderId })` takes the order's customer (a different `customerId` is
  refused; the order must be open); `dispatch.update` cannot move such a dispatch to another
  customer. `getDispatch.salesOrder.progress` is the order's live baki against this load, per line
  (`lib/dispatchOrder.ts orderProgress`). Line pick for a bundle on no line (`suggestLines`, spec
  §E2): a line of the same die AND cut length with baki, the caller's `preferLineIds` first (the
  suggest sheet sends the lines it showed), then the dispatch's own order (`preferOrderId`), then
  the oldest; only then the oldest line of the die in another length, then the newest (overdraw).
  A bundle packed for another order of the party keeps that link. `suggestBundles` names the same
  line the add will pick (a test holds it with two lengths of one die). `dispatch.suggestBundles` (action `dispatch.addBundle`) lists the order's own yard
  stock (on its lines or held for them) first, then plant stock (moved to plant stock; never
  legacy stock on no line) of the same die and cut length; every candidate passes the scan's own
  classifier, bundles held for another order's line are left out, and `fits` marks what stays
  within the baki in the order listed.
- Packing list scope (Q37, `settings.packingList.scope`, `company.updateSettings` only):
  `one_customer` (default) one customer's lines from several of their orders; `one_so` a dispatch
  must start from a sales order and carries that order only: the classifier refuses
  `outside_order` ("This packing list is for SO-n only") for a bundle on another order or of a die
  the order lacks, and after the line picks (`refuseOutsideOrder`) for plant stock once the
  order's line of that die and length has no baki left; `suggestLines({ onlyOrderId, strict })`
  never links to another order of the party (complete's relink too); `per_truck` several
  customers on one truck: `dispatch.create({ truckOf })` makes a sibling dispatch sharing
  `truck_id` (the first dispatch's id), vehicle, driver, transporter and capacity (its own
  `transporterId` / `vehicleCapacityG` are ignored); one customer once per truck (read check +
  write-time `batchAbortUnless`; `update` cannot switch a sibling to a customer already on the
  truck); capacity counts the whole truck (`truckDispatchIds`); each customer gets its own PL
  number.
- Q36 (warning, never a block): add / scan reports `warnings[]` (`{ serial, orderNumber, lineNo,
  bundleMilli, lineMilli, diffMilli }`, domain `offLineBand`) for a
  bundle whose kg/12ft is more than 0.100 (100 milli, exclusive) off its order line's
  `kg_per_12ft_milli`; `getDispatch` items carry `offBand`, `lineKgPer12ftMilli`,
  `offBandDiffMilli`. A bundle with no line has nothing to compare with. Pack's D15 band is
  separate and untouched.
- "Add all that fit" sends ≤ 100 serials per call, one call after another, with progress
  (`addInChunks`); a failed call stops the run and says how many went on.
- The off-band chip and the capacity fill are computed by the server on every read (`getDispatch`); the web draws them and sums nothing.

## Packing list v2 (C24, FP-PK-13)

- **Packing list v2 (C24).** A PL number is issued once, at first issue, from the `pl` series.
  `packingList.regenerate` (`dispatch.complete`) writes a NEW revision under the same number
  (`supersedes_id`, `revision + 1`), keeps the sent one readable, and never advances the number;
  `revisions` returns each revision with `diffPackingListRevisions` against the one before.
  `packingList.combine` (supervisor, office, manager, admin) folds current, uncombined lists of ONE
  customer over completed dispatches into a new PL number; each folded list keeps its own number and
  gets `combined_into_id`. A combined list cannot be regenerated by its parts. Snapshots come only from
  `buildPlSnapshotV2`; the client never sends figures.
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
- Packing list: `settings.packingList.kgPerPiece` (default off, `company.updateSettings`,
  `settings.update`) adds a "kg/pc" column to the screen, the PDF, the v2 print and the Excel
  sheet (render-time option `kgPerPiece`; stored snapshots do not change). One rounding rule:
  grams per piece half up (`kgPerPieceG`).
- `reports.salesRegisterCsv({ month })` (reports.read or export.accounts): one CSV row per completed
  dispatch in the company calendar month, cells guarded against spreadsheet formulas.
- Not built (BACKLOG 61, 63-66, 68-70, still open; 67, the refusal wording, is partly done): amber "over tolerance" at scan time with an early `dispatch_overdraw` request, the `dispatch_off_band` approval kind (Q36 is a warning today), per-dispatch ship-to, PL footer / signature lines / "Page x of y", dispatch labels (Q38), the rejected-scan log, the weak-link device scan queue (Q41), and the "scan to verify" QR. Late PL entry for line-down hours (Q30, BACKLOG 52) is not built either: until it is, a paper PL is entered afterwards by an `order.manage` holder at the time of entry.

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

# 11. Analytics and reports

## Analytics (charts, customer numbers, office reports)

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
- Office reports (W4-ANALYTICS, `routers/analyticsReports.ts` + `lib/reportsAnalytics.ts`, mounted on
  `analytics`): `recovery({from,to,groupBy die|copy|press|shift, shiftSeq?, pressLineId?, planId?})`,
  `stockAge({customerId?|plantOnly?})`, `orders({...orders.list filters, groupBy customer|month, withRates})`
  are `reports.read` (viewer and supervisor included); `dieLife` is `reports.read` OR `die.card` OR
  `die.reading` (the die card's Runs header). Recovery = Σ good ÷ Σ input of logged PRODUCTION runs
  (plan purpose production or no plan), `recoveryPct` = `bpPercent1`; never an average of percents.
  Die life = `life_g` vs Σ `good_g` of the copy's logged runs, `usedBp` half up, `near` from 90 %,
  `reached` at 100 % (warn only). Stock age (FP-PK-16) counts AVAILABLE bundles only (held on a truck is
  not lying in the yard), buckets 0-7 / 8-30 / 31-90 / 90+ company calendar days; party = the order of
  `bundle.sales_order_line_id`, no line = plant stock; Today's "older than 90 days" tile is `over90`
  (shown inside the `analytics.view` block). `analytics.stockAgeing` (0-15/16-30/31-60/60+, available +
  reserved, analytics.view) is unchanged for the Stock and Today charts. The order summary uses
  `lib/orderBook.ts` `bookSummary` on the SAME `fo` CTE as the grid, so each row is the sum of its book
  rows and `totals` is `bookTotals`; dispatched kg is counted up to ordered per line (the bar's and the strip's
  figure, so ordered - dispatched = baki; the excess is `excessG`), and `sum` is the rows added up, equal to the
  strip unless `truncated` (more than 500 groups), when `sum` is the strip. The page asks for OPEN orders by
  default (`ordersFilterInput`) and has a status select (open / closed / cancelled / all); `today` is the
  company's day for the months chart. Rupee `dispatched` value is `round(min(dispatched, ordered) x rate)` per
  line, so it can differ by paise from the dispatch's per-weight sum. Stock age: a bundle held for a line
  (`held_for_line_id`) but not packed on one is plant stock until packed on the line. Recovery by shift groups
  by the stable `shift_id` (key = shift id, `seq:N` for a run with none).
  Rupee columns (`bookCte(..., {rates})`) exist only when `withRates` is sent, which is FORBIDDEN unless
  the caller holds `order.price` AND `priceOnSalesOrder` is on; the plain answer has no rupee field
  (`ratesAllowed` tells the page whether to offer the toggle). Pages `/reports`, `/reports/production`
  (mounts `press/report-view` `ReportScreen` with `title/back/children`), `/reports/die-life`,
  `/reports/stock-age`, `/reports/orders`; print CSS via `ReportPrintStyle` (`data-report-print`,
  `.report-no-print`; `ReportPrintContext` prints the filters); CSV written on the client from the server rows
  (`features/reports/model.ts`) and saved with the shared `downloadCsv` (UTF-8 BOM, so Excel reads Hindi);
  a text cell starting with = + - @ gets a leading `'`;
  charts lazy (`report-charts.tsx`) behind `<Can do="analytics.view">`, tables for every reader.

# 12. Platform

## Modules, shifts, thresholds, releases, backups, reason codes

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
  again. Dev seed floors are `minBuild: 1` because apps/native sets no versionCode or buildNumber. The native gate reads the build from `expo-application` (`nativeBuildVersion`; an unreadable build is blocked, `UNREADABLE_BUILD`), re-checks on a 30 s tick and on foreground, and a revoked device gets the `device_revoked` meta code.
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
- **Reason codes and thresholds (W2-PF2).** `reason_code` rows are ensured, never migrated: a
  company approved from the waiting list gets `defaultReasonCodeRows()`; `ensureDefaultReasonCodes`
  (`lib/reasonCodes.ts`) adds only the missing (kind, code) pairs on the first `press.reasons` read,
  reallocate or pack reject, so a renamed or retired code is never recreated. Labels for seeded codes
  are `t("reasons.{kind}.{code}")` (en, hi, gu); a plant-added code shows its stored `label`. Drift
  bands, recovery bands and `press.balanceWarnBp` are set in Settings > Standards > Thresholds through
  `company.updateSettings` (`driftGreenMaxBp`, `driftAmberMaxBp`, `recoveryBands`, `pressBalanceWarnBp`;
  basis points, green below amber, 0 to 100 %; `validateThresholds` is shared with the form).
- **Support (FP-PF-14).** Status goes Open → Answered → Closed, or Open → Closed. A staff reply or
  close lands only if the request is unchanged since it was read; otherwise it is a CONFLICT and no
  audit row is written.
- **Sign-in facts (T17 rulings, BACKLOG 6).** `auth.me.user.hasPassword` (the account has a credential) and `twoFactorEnabled` are what the welcome steps and the sign-in guard read; every first-setup owner, approved or invited, must finish two-factor setup (Q2 A). `POST /dev/invite` and `POST /dev/magic-link` (`apps/server/src/index.ts`) hand an invite token or a magic link to front-door e2e that otherwise only leave the server by email; they sit behind the same gate as `/dev/seed` (404 unless the local-only `ORRN_LOCAL_PASSWORD` binding is set and the host is loopback). Links are logged only on a development stack.
- **Today and its tiles (FP-PF-15, `lib/todayTiles.ts`).** `dashboard.today` sends the role's KPIs (four, on the production day) and role tiles: owner, admin and manager see every tile; office orders, dispatch, stock, approvals; supervisor press, pack, dispatch, approvals; operator pack, dispatch, stock; packer pack, stock; die_room the die room; press the press; storekeeper the store; foundry approvals; viewer and accountant none (a viewer gets the four KPIs only, `scope: "kpis"`). A tile of a module the plant switched off is left out. `ROLE_TILES` is pure, so the web reads the same list for its loading shape; add a tile to `TODAY_TILE_KEYS`, `ROLE_TILES` and `TILE_MODULE` together. "In stock" on Today is AVAILABLE bundles only (held and reserved are shown apart), and every figure and the trend chart come from the server (the chart buckets by production day, not by calendar day, and its stock sum is the KPI's, never summed on the client). Press tile strings are `today.press.*` (a Gujarati floor namespace), never `press.summary.*`.
- **Reason-code masters (BACKLOG 40).** `reasonCodes.list` (any member, all kinds, retired included), `create`, `rename`, `setActive` (`masters.publish`, audit `reason_code.create|rename|retire|reactivate`). A code's key is made once from its English wording and never changes; `other` is fixed in every kind (cannot be renamed or retired, always last, always asks for a note). Two live codes of one kind never read the same (Q61): the router checks first for a clear message (case and spacing ignored), and the partial unique index `reason_code_live_label_unique` (company, kind, `lower(trim(label))` where active) is the guard in the statement itself, so two concurrent creates land once; reactivating a retired code into a live code's words is refused too. `ensureDefaultReasonCodes` inserts with `on conflict do nothing`, so a default whose words match a live custom code is skipped, not an error. Hindi and Gujarati wording is typed per code (`reason_code.label_hi/label_gu`); pickers (`press.reasons`) carry it and `features/press/reason-label.ts` picks typed wording, then the built-in translation of an unrenamed standard code, then the English label. Page: `/masters/reasons?kind=`. Kinds: downtime, qc_reject, void, reprint, reallocate, ageing_* (and `die_work` once the die work log lands).
- **Password reset limit.** `/request-password-reset` is limited to 5 calls per 15 minutes per address (hash) and per IP (`auth_throttle`, `packages/auth/src/reset-throttle.ts`); the 429 body is the same for known and unknown addresses.
- **Motion.** The route cross-fade starts no view transition under `prefers-reduced-motion`.
- **Plant switcher (FP-PF-17).** Shown when `auth.me.memberships` has more than one plant and never while impersonating; it calls `company.switch`, drops the old plant's cached queries, reloads `auth.me` and lands on /today. Phone: the plant name in the top bar is the trigger; side nav: name at lg, icon in the rail.
- **Release notes (FP-PF-14).** `release.notes` (any member) returns the last eight published native builds with their notes, newest first (the update gate's own text); edge builds are left out. Settings > About shows them under "What changed".
- **Audit.** `writeAudit` records the acting user, `impersonatorId` when impersonating, and the subject. Known gap (BACKLOG 55): floor writes do not yet record a `deviceId` / app version.

# 13. Customer portal

## Customer portal (FP-PF-01..04, W3)

- Router `portal` (`packages/server/src/routers/portal.ts`), rules in `lib/portal.ts`, migration 0032, D28. A party login is a `customer_portal_user` row: never a membership, never a company role, never `can()`.
- Party procedures use `portalProcedure` (`packages/server/src/index.ts`): session + an `active` portal row + company `active` + `portalEnabled` (floor settings) + NO membership of that user in that plant. Company AND customer come from the portal row (`ctx.portal.companyId/customerId`), never from input; `x-orrn-company` only picks among the party's own plants (naming another is FORBIDDEN, never a fallback). Impersonation is refused (the header too); downstream ctx has `role: null`, `membership: null`.
- Staff side (`portal.users.*`, `portal.sections.*`) is `actionProcedure("portal.manage")` (office, manager, admin; owner holds all). `portal.certificates.issue|forDispatch` take `portal.manage` OR `dispatch.complete`. `portal.access` is session-only (which plants this login can read).
- A miss is NOT_FOUND "Not found" (`portalNotFound()`), including a real row of another party or plant: never FORBIDDEN, never a hint.
- Visibility: a section shows when this customer owns it or one live copy, or has a live `customer_portal_section` grant AND the section is not owned by another customer (a grant never overrides a foreign owner). A copy shows when its effective owner (copy, else section) is null or this customer. Archived/deleted sections and retired copies never show. Use `sectionVisibleSql`/`copyVisibleSql` (fixed param count, no id lists); `assertSectionsVisible` before any write that names a section.
- Inputs are closed: `z.strictObject` with `unknownKeyError` — an unknown key is BAD_REQUEST naming it ("the plant picks this"), a rate-like key (`rate|price|paise`) gets `PORTAL_RATE_REFUSAL`. A portal order line is section + cut length + pcs OR kg (+ note), at most `MAX_PORTAL_LINES` (20); it books `status: "booking"`, `source: "portal"`, `weightBasis: "band_start"`, `canPrice: false`; `clientRequestId` is namespaced `portal:<portalUserId>:…`.
- What the party never sees: rates, office notes (an order's note only when `source === "portal"`), copy, tier, `generatedBy`, internal ids (`salesOrderLineId`, `groupId`). Dispatches are only the party's own `completed`, not deleted ones.
- Packing list: `stripForParty` drops every key naming a cast (Q39), rate-like keys, `notes` and author ids. The TEST CERTIFICATE is different: `stripCertificateForParty` keeps cast numbers and per-cast chemistry (the certificate cites them, D28/C30) and drops only author and rate-like keys. Certificates are staff-issued (re-issue = next revision, same number); untested chemistry is marked pending, never invented.
- Logins: `portal.users.grant` makes an `invite` row of `kind: "portal"` (7 days; an older pending one is revoked) + the portal row `invited`, and returns `inviteUrl` for the office to copy (email is unreliable). `/invite/{token}` → `invite.acceptByToken` turns the row `active` without creating a membership. Re-granting a revoked login that already has an account goes straight back to `active` (`inviteUrl: null`). One email is never staff and party in the same plant (grant, accept and `portalProcedure` all refuse it). Member invites list/revoke never touch `kind: "portal"`.
- Web: party routes live under `apps/web/src/routes/_portal*`. tRPC header rule (`shared/lib/trpc-links.ts` + `portal-plant.ts`): party procedures travel in their own batch carrying `x-orrn-company` (the chosen plant, `orrn.portalPlant`); every other call travels in a batch that never carries it. A new party procedure MUST be added to `PARTY_PROCEDURE` in `portal-plant.ts`, or it loses the plant choice.
- Staff screens: the customer page's "Portal access" card (logins, dies the party sees), the dispatch page's "Issue test certificate" and Settings > modules "Party portal" switch. The portal opens only for a plant whose `portalEnabled` is on. The switch's hint text still says "The portal opens in a later release" (stale copy, `settings.modules.portalEnabledHint`; reword when the dictionaries are next touched).

# 14. i18n

## Dictionaries are lazy; the `/` budget

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

## Gujarati, server refusals, default language (W4-GU)

- Gujarati is complete for the namespaces in `GU_FLOOR_NAMESPACES` (`packages/i18n/src/gu.ts`; the
  floor, settings, approvals, the die room, `dies`, `nav`, `errors`, `status`, `native`, `bundle`,
  `dispatch`, the orders words that reach the floor or the phone, phone sign in); `gu.test.ts` fails on any en key
  missing under one. A new key there needs its Gujarati in the same change. Office-only namespaces and
  the guide texts fall back to English on purpose. Plant words stay Latin (die, bundle, dispatch, PO, kg).
  The Gujarati strings of the sweep live in `packages/i18n/src/gu-more/*.ts` (one file per namespace
  group, typed `DeepPartial<Messages>`), merged into `gu` by `mergeGu` (a key written twice throws).
- Server refusal sentences are English. Die room, orders and approval refusals are matched in
  `packages/i18n/src/refusal.ts` (`SERVER_REFUSALS`) and said from `refusal.*` (en, hi, gu); web
  (`features/shared/server-refusal.ts`: `serverRefusal`, `serverRefusalLines`) and native
  (`lib/server-refusal.ts`) share the table. Never show `error.message` from these routers: call
  `serverRefusal(t, error)`; an unknown sentence shows `refusal.unknown`. A new `message:` sentence in
  the routers listed in `refusal-sentences.ts` (`FILES`) fails the web and native completeness tests
  until it has an entry and a key in `native/refusal.{en,hi,gu}.ts`.
- Default language: a device that never chose one opens in the plant's `settings.locale`, else English.
  `GUJARATI_DEFAULT_FOR_GUJARAT_PLANTS` (`packages/domain/src/settings.ts`) ships `false`; the owner
  flips it once the native-speaker review (`.fp-build/reports/gu-review-list-web.md`) is done, and a
  plant with no chosen language and a Gujarat GSTIN (24...) then opens in Gujarati
  (`shell/plant-locale.tsx`).
- Every new key needs en and hi in the same change (`parity.test.ts`: same keys, same `{vars}`), and gu where its namespace is in `GU_FLOOR_NAMESPACES`. Copy rules the tests enforce on dictionaries AND guides: no em dash, en dash, arrow or curly quote; never the words "spool", "receipt", "tenant", "mutation"; no ALL-CAPS word outside the allow-list in `parity.test.ts` (PO, PDF, QR, PL, HV, CDR, DWG, MB and the like); at most one middle dot per string. Use ORRN's own wording, never a competitor's screen names.
- Review lists: `bun run --cwd packages/i18n export-review` rewrites `docs/superpowers/review/hindi-review.md` (every string and every guide); `review-sync.test.ts` fails when it is stale, so run it after any change to `en.ts`, `hi.ts` or a guide. The Gujarati words await a native reader (`.fp-build/reports/gu-review-list*.md`, Q48).

## Guides (SOPs per flow)

- Guides live in `packages/i18n/src/guides`: slugs in `types.ts` (`GUIDE_SLUGS_BASE`, `GUIDE_SLUGS_FP`), English in `en.ts` / `en-fp.ts`, Hindi in `hi.ts` / `hi-fp.ts`, Gujarati floor flows in `gu.ts` (`GUIDE_SLUGS_GU`; every other guide reads the English book in gu), roles per guide in `fp-roles.ts` (follow `PLANT_ACTION_ROLES`; the owner is in every list). A guide has 4 to 7 steps and at least one problem; en, hi and gu have the same steps, problems and roles one for one.
- A button, tab or status name in straight double quotes MUST be an exact en.ts value (hi.ts value in Hindi, a value the Gujarati screen shows in Gujarati, which is the English value where gu has none): `parity.test.ts` and `guides.gu.test.ts` fail on a quoted name that is not on a screen. Describe a screen that is not on this branch without quotes.
- A new guide needs: the slug in `types.ts`, text in en and hi (and gu for a floor flow), roles, an entry in `RELATED_SCREENS` (`apps/web/src/features/guides/related.ts`, `requires` mirrors the nav item), and `export-review`. `guides.spec.ts` renders every slug in en, hi and gu.

# 15. Web bundle and routes

## Route files and the `/` budget

- Route files: `validateSearch`, `beforeLoad`, `loader` and `head` stay in the entry chunk
  (`autoCodeSplitting` splits only the component). Their helpers (search parsers, filter lists,
  `isX` guards) live in pure modules; never import them from a component/page module (that drags
  the page into every first load: `/purchase` once put `/` at 306.8 kB) and never use a zod
  schema there (zod is ~18 kB gzip: `/login` parses `?next` with a plain function). The same holds
  for anything the entry imports (`@orrn/env/web` validates with a Standard Schema check, no zod).
- `bun run --cwd apps/web build` runs `scripts/check-route-budget.ts`: the marketing `/` closure stays under 250 kB gzip (about 222 kB at the end of the FP build) and fails if Hindi, the full English or guide text reaches it. A heavy new library or dictionary goes behind a dynamic import (`report-charts.tsx`, the order-sheet builders and the PDF code load on click only).

## No fixture-only routes in production nav

- A screen that runs on fixtures or client-only demo state never ships in the nav, the More sheet, the
  command palette or a gallery. The `/preview/*` demos were retired on 2026-10-25: each old URL is a
  `redirect` in `beforeLoad` to its real route (`apps/web/src/routes/_tenant/preview.*.tsx`, guarded by
  `tests/e2e/preview-redirects.spec.ts`). Keep those files so bookmarks keep working.
- A module that is not built here yet gets `/preview/coming-soon?module=<slug>` (honest copy,
  `comingSoon.*` in en and hi), never a fixture screen. `features/preview/{foundry,ageing}` and
  `preview-frame.tsx` are kept only for the paused foundry and ageing lane; they have no route and no
  nav entry. New work does not add to `features/preview` or `PREVIEW_MODULES`.
- To promote a module, build the real route against tRPC, add it to `shell/nav-items.ts` with
  `requires`, and delete the fixtures it replaces; do not leave a demo copy beside it.

# 16. Testing rules

## Gates and how to run them

- A change is done when these pass in its own worktree (cwd = worktree root): `bun run check-types`; `bun run --cwd packages/server test`; `bun run --cwd packages/domain test`; `bun run --cwd packages/i18n test`; `bun run --cwd apps/web test`; `bun run --cwd apps/web build` (the route budget); `bun run --cwd apps/native test` and `check-types` when native is touched; and the e2e specs of the flows touched. Never weaken, skip or delete a test to get a gate green, and never claim a gate you did not run.
- Tests first for every state transition and every worked arithmetic example in a spec. Server tests are Miniflare D1 files `packages/server/test/<module>-*.test.ts`; pure rules are domain tests; pins that exist on purpose: the permission matrix (`plant-roles.test.ts`), the append-only ledger grep (`plant-ledger.test.ts`), the cross-tenant joins (`plant-analytics.test.ts`), the label contract (`labelContract.test.ts`), the 100-parameter limit (`d1-limits.test.ts`), the `/` route budget (build), no RouteStub (`screens-static.test.ts`), every native write (`replay-audit.test.ts`), every server refusal sentence (web and native completeness tests), every press gate code (`errors.test.ts`).
- Tests that depend on "now" pin it with `setClockForTests` (`lib/clock.ts`). Date wording in web unit tests must not depend on a locale's own wording (ICU differs on Linux; BACKLOG 27): build it from `Intl` format parts.
- The demo seed is a fixture: seed-dependent tests create the same users with `precreateDevSeedUsers(env)` from `test/dev-seed-fixture.ts`; a figure a spec asserts on comes from the seed's own rows (`docs/DEMO_PLANT.md`), and the seed is pinned by `dev-seed-demo-plant.test.ts`.

## Machine load: rules 12 and 13 of the FP build

- Other agents and the owner share the machine. Run e2e with `E2E_WORKERS=2`, never two heavy gates (server tests, build, e2e) at once in one worktree, and if a test fails only under load (timeouts, a blank first load) rerun it alone before calling it a failure. Never kill a process you did not start: port 3001 is the owner's, and other worktrees run dev servers on their own pairs.
- Filter e2e with Playwright directly, after sourcing the worktree's ports: `cd apps/web && bunx playwright test --project=e2e tests/e2e/<spec>.spec.ts`. `bun run --cwd apps/web test:e2e -- <spec>` does NOT filter (bun passes the argument oddly) and runs the whole suite.
- The full e2e suite (about 1,000 tests in 40 spec files) is run in three groups, A, B and C, one after another on one port pair, never together: `bun run e2e:group A|B|C` (`apps/web/scripts/e2e-group.sh`, membership in `apps/web/tests/e2e/GROUPS.md`; a spec in no group is warned about). A new spec is added to a group in both places.
- One bun process runs about 100 Miniflare D1 files back to back; on a loaded machine (or Linux) one stuck file leaves a poisoned stub and the failure cascades as timeouts into every later file. For a trustworthy full run use the per-file runner: `bun run test:server:files` (`packages/server/scripts/test-per-file.sh`; `JOBS`, `RETRY=1`, a name filter, per-file logs). Heavy files set their own `setDefaultTimeout`; `--timeout 60000` rescues a single slow test.
- Specs own their fixtures: a spec that changes data creates its own customer, order, press line, die copy and bundles (helpers `own-press.ts`, `owner-api.ts`, `fresh-plant.ts`), cleans up in `finally` / `afterAll` (finish or void every run it created, retire its lines and copies even after a failure) and asserts only on its own rows when it reads a shared list. Two specs must not plan the same seeded order line (the press.spec and orders.spec clash that cost a merge round), and a count over a shared list is scoped to the spec's own party. This is what lets the files of a group run in any order on any worker count.
- Visual QA is at 375, 820 and 1280 px (phone, tablet, desktop); a new screen is checked at all three, in en and hi (and gu for floor screens), with axe (`@axe-core/playwright`) and the layout guards (`expectNoHorizontalScroll`, `expectNoClippedText`).

# 17. Native rules (apps/native)

## Native app

- Read `apps/native/README.md` first (run, checks, Maestro, Gujarati). The phone shows server figures and never works out a weight, drift or baki. Roles get their tab set from `lib/nav.ts` (press has its own); every action button is wrapped in `<Can>` and every screen sits behind the shared session and release gates.
- Native local mirrors are tenant-local only. Sync endpoints derive company scope from the session and device registration, never from client input. The server is authoritative for bundle and dispatch state transitions; content fields may use last-write-wins by server timestamp. No offline mirror exists yet: floor writes are online, and the intended floor-worker subset (dies read, customers read, bundles read / create / transitions, dispatches read / add bundle, print queue) is still the scope when one is built.
- **Replay keys everywhere a write can be sent twice.** `lib/replay-key.ts`: `replayKey(attempt, content, fresh)` reuses the id when the same content is sent again after an unsure answer and remembers earlier unsaved sends (an unsure send may have landed, so reverting an edit sends the FIRST id again); a saved write ends the attempt. `sendOnce(call, key)` repeats once with the SAME key when no reply came back (`noReply`). The server answers a repeat with the first result (`replayed: true`) and another payload under the same key is a CONFLICT. `__tests__/replay-audit.test.ts` reads every `trpc.<proc>.mutationOptions` in the app and the server routers: a new write, or a server that learns a key, fails it until the write is keyed or listed as guarded some other way.
- **Press on the phone.** The press role has its own tab set (`tabSetFor` in `lib/nav.ts`). Its screens are read only (line queue and run); the only press writes from the phone are downtime start / stop and handover. The station (counting, close, late entry) is the web tablet's. `__tests__/press-role.test.ts` pins the tab bar, the routes behind it and what the permissions allow.
- **Refusals in the user's language.** `lib/server-refusal.ts` turns a server sentence into a `native.refusal.*` key (en, hi, gu) from the shared table `packages/i18n/src/refusal.ts`; the app never shows or speaks the server's English. A new `message:` sentence in the routers listed in `refusal-sentences.ts` fails `server-refusal.test.ts` until it has a pattern and keys. Voice reads the same text the screen shows.
- **Dates and numbers** use the plant's time zone from `me.company.settings.timezone` (IST when unset), never the phone's (`lib/format.ts`, `use-format.ts`); the production day is the server's.
- **Release gate.** `lib/release-gate.ts` asks `release.check` (public, no company data); Blocked below the effective `minBuild`; offline the last Open answer holds 24 h; a revoked install is blocked everywhere. The build number comes from `expo-application`.
- **Build dependencies (a new development build is needed).** The app has native modules Expo Go does not carry: `expo-speech`, `expo-application`, `expo-crypto` (replay ids and the install id) on top of `expo-camera` and `expo-haptics`. Rebuild with `bunx expo run:android` / `run:ios` or EAS after any native dependency or `app.json` change; an OTA update cannot clear a block. `EXPO_PUBLIC_SERVER_URL` and `EXPO_PUBLIC_WEB_URL` come from `apps/native/.env`. Android emulator: `10.0.2.2:<api port>` or `adb reverse`.
- **Maestro** flows (`apps/native/.maestro/flows`) have never been run on a device; do not mark one run from a machine that did not run it (README table).
- Gujarati: every key the app reads has a Gujarati string (`gu-coverage.test.ts`); the words await a native reader (Q48).

# 18. Spool, scale and hardware

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
- **Print exactly once.** `print_log.id` and `job_key = bundle:<serial>:label:v<template version>:attempt:<n>` identify a label job. The spool stores UNIQUE(job key) and a repeat POST answers the first job (`docs/print-exactly-once.md` in orrn-spool); a 200 `duplicate: true` is success, a 409 `job_key_conflict` is logged as a bug and refused. `attempt` rises only for `reprint: true` on a bundle whose latest attempt really went out; a transport retry, a double tap or a reprint that never reached the spool reuses it.
- **Scale.** `scale.reading` (`bundle.pack`) polls the node's `/scale/reading` through the signed client; a typed weight needs a reason whenever the node reports a scale (D12, `weightNeedsReason`). `SCALE_SIMULATOR=1` in `apps/server/.dev.vars` (never in production) lets `scale.reading` answer from a deterministic cycle; the Go spool has `--scale-sim`. The real indicator make, frame and baud are owner-only (Q5).
- **Collectors** (press frames, spectro files) use the same node token; see Press. Hardware is never faked as done: a simulator says `simulated: true`, a PLC is never written, and bring-up items stay in `TODO.md` under hardware.
- The Go spool is built outside this repo (`orrn-spool`, branches `fp/scale-reader`, `fp/collectors`; Go 1.22+ in `go.mod`, 1.24 used for the FP build; there is no Go on the Mac, see `docs/LOCAL_DEV.md`).

# 19. Data, seed and orchestration

## Data and documents

- Packing lists store a historical JSON snapshot in D1.
- Web and native generate PDF/xlsx on the client from that snapshot.
- Print attempts must always be logged whether they succeed or fail.
- Bundle serials are unique per company.
- Bundles are never deleted; use status transitions including `void`.

## Demo plant seed (W2-SEED)

- `POST /dev/seed` (`apps/server/src/dev-seed.ts` plus one `dev-seed-{area}.ts` per module) builds one coherent plant; `docs/DEMO_PLANT.md` is the tour (logins, orders, press board, stock, dispatches).
- A new demo login goes in `dev-accounts.ts` (`DEV_ACCOUNTS`, and `DEV_MEMBER_ROLES` when it is a plant member). Tests create the same users with `precreateDevSeedUsers(env)` from `test/dev-seed-fixture.ts` (never a hand-written key list); the e2e helper type `LocalRole` and `write-local-accounts.ts` follow.
- Idempotent: fixed ids (`dev-*`), children before parents in the reset, doc_series counters written past every seeded number, at most 100 bound parameters per statement (`insertChunks`). Add a table to the reset in the same change that seeds it (a new table with a RESTRICT FK to a demo row, location, bundle or lot must be added to the reset too). Never seed a secret (the spool node holds placeholder text).
- Time: nothing is a fixed date. `seedClock` (`dev-seed-kit.ts`) gives `pastAt(days, hour)` and `dayAt(fraction)`, the current production day; anything that must read as "today" uses `dayAt`. `seedDevData(db, { password, now? })` takes `now` for the test that seeds at seven moments.
- Quantities of an order line that stands on bundles are derived from those bundles, so baki reconciles by construction. SO-1..SO-4 keep the quantities older specs read; keep the ids that specs name. The plant in numbers is pinned by `dev-seed-demo-plant.test.ts`; change the seed, that file and `docs/DEMO_PLANT.md` together.

## Orchestration notes

- Keep root `TODO.md` updated when changing milestone scope or status (open work only, with its backlog rank).
- Keep this file updated when durable conventions or project constraints change.
- Do not add an audit pruning Worker cron unless explicitly requested.
- Never push, deploy or merge to `main`/`prod` from a task worktree; promotion is `docs/DEPLOY_PROMOTION.md`, run by the owner.
- Accounts stay outside ORRN (O1): no accounting, GST e-invoice / e-way bill, Tally export or invoicing inside the app. Prices on orders and dispatch value are optional operational data.
