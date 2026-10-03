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
  `reports.read`, `qc.enter`, `ageing.enter`), not the legacy keys. Every
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
  pending request per (company, kind, subject).
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
- Weights in the ledger are signed integer grams (`qty_g`). `location_id` NULL = place unknown
  (legacy); there is no location 0 and no default location. `createReceipt` requires a yard
  `locationId` once the company has an active yard location.

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
