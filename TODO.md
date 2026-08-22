# ORRN ERP Rebuild TODO

This file is the source of truth for current implementation orchestration.

## Completed architecture migration: Simplification ✅

### Scope
Eliminate package and app boundaries that no longer carried independent
ownership while preserving the product surface: marketing, tenant ERP,
platform admin, native app, tRPC API, auth, D1 schema, and Alchemy deploy.

### Deliverables
- [x] 1. Merged `@orrn/design` tokens/config into `@orrn/ui`.
- [x] 2. Merged `@orrn/api` and `@orrn/infra` into `@orrn/server`.
- [x] 3. Dissolved `@orrn/web-shared` into `apps/web/src/shared`.
- [x] 4. Merged `apps/web`, `apps/erp`, and `apps/admin` into one TanStack
         Router app with `_public`, `_authed`, `_tenant`, and `_platform`
         route groups.
- [x] 5. Split the platform tRPC router into focused waitlist, companies,
         impersonation, and staff modules.
- [x] 6. Added reusable tRPC CRUD helpers and refactored the customer router as
         the pilot call site.
- [x] 7. Centralized the `Me` type and permission helpers in
         `packages/server/src/lib/permissions.ts` for web and native.
- [x] 8. Updated docs and repo guidance for the simplified package/domain
         layout.

### Validation
- `bun run check-types` passes across all 7 turbo tasks.

---

## Active milestone: M9 Platform Admin Console + Impersonation Grants

### M9 Scope
Platform-admin console for tenant management, time-boxed impersonation backed by
`impersonation_grant`, and waitlist invite URLs that respect deployed web origin.
Impersonation is web-only; native gets a read-only waitlist drawer entry.

### M9 Deliverables
- [x] 1. `impersonation_grant` table + Drizzle migration `0003_yielding_leper_queen.sql`
- [x] 2. `platform.companiesList` / `companiesGet` / `companiesSuspend` /
         `companiesReactivate` (paginated, member counts)
- [x] 3. `platform.impersonationCreateGrant` / `impersonationRevokeGrant` /
         `impersonationListActive`
- [x] 4. `createContext` validates grant before honouring
         `x-orrn-impersonate-company`; rejects invalid header with 403 on authed
         tRPC calls
- [x] 5. Web: `/platform` index, `/platform/companies`, `/platform/companies/$id`
         with suspend/reactivate + impersonate flow (`sessionStorage` header)
- [x] 6. Web impersonation banner stop revokes grant + clears storage
- [x] 7. Waitlist approve invite URL uses `env.CORS_ORIGIN` (not localhost)
- [x] 8. Native: platform-admin-only read-only waitlist drawer screen
- [x] 9. `AGENTS.md` grant-table impersonation rules

### M9 API additions
- `platform.companiesList({ limit, offset, search?, status? })`
- `platform.companiesGet({ id })` — includes recent grants for company
- `platform.companiesSuspend({ id })` / `companiesReactivate({ id })`
- `platform.impersonationCreateGrant({ companyId, ttlMinutes?, reason? })`
- `platform.impersonationRevokeGrant({ id })`
- `platform.impersonationListActive()` — caller's non-revoked, unexpired grants
- `auth.me.impersonation` now includes `grantId` + `expiresAt`

### M9 Schema additions
- `impersonation_grant`: `id`, `platformAdminId`, `companyId`, `expiresAt`,
  `revokedAt`, `reason`, `createdAt`; indexes on `(platformAdminId, expiresAt)`
  and `companyId`

### M9 Testing
- Platform admin creates 30-minute grant → tenant UI loads with banner
- Expired/revoked grant + header → 403 on tenant mutations
- Non-platform-admin cannot call grant endpoints
- Waitlist approval email links to `https://dev.orrn.app/invite/...` on dev
- Audit rows during impersonation include `impersonatorId`

---

## Completed milestone: M8 Packing List Snapshots & Client-side Exports ✅

### M8 Scope
Auto-generate an immutable packing list snapshot on every `dispatch.complete`,
expose a manual Regenerate action, and provide client-side PDF + Excel downloads
on web and a Share export on native. No new permission set — reuses `dispatch.*`.

### M8 Deliverables
- [x] 1. `packingList.ts` tRPC router (`create`, `get`, `byDispatch`, `list`,
         `regenerate`). Snapshot written as Drizzle `mode:"json"` column —
         Drizzle handles serialisation, no manual `JSON.stringify`.
- [x] 2. `createPackingListInTx` helper exported from `packingList.ts` and
         called inside the `dispatch.complete` transaction so the packing list
         is always atomically present when a dispatch becomes `completed`.
- [x] 3. `buildSnapshot` captures company, customer (full address/contact),
         all dispatch items (joined bundle + die), and computed totals at
         completion time. Snapshot is immutable; Regenerate deletes + recreates.
- [x] 4. Packing list code format: `PL-{6-digit serverSeq}` (same rhythm as
         `DSP-######`). Unique per-company via DB constraint.
- [x] 5. `packingList.regenerate` permission added to `permissions.ts`; all
         manager-and-above roles receive it; operators and viewers do not.
- [x] 6. Web: `packing-lists.$id.tsx` — standalone packing list detail page
         with totals, items table, Download PDF, Download Excel, Regenerate.
- [x] 7. Web: `dispatches.$id.tsx` — `<PackingListSection>` card auto-shown for
         completed dispatches; links to detail; inline PDF + Excel + Regenerate.
- [x] 8. `apps/web/src/shared/lib/packingListPdf.tsx` — PDF template built with
         `@react-pdf/renderer` (A4, company header, items table, totals,
         footer). Lazy-imported to keep the initial bundle lean.
- [x] 9. `apps/web/src/shared/lib/packingListXlsx.ts` — Excel workbook (Summary +
         Items sheets) via SheetJS `xlsx`. Lazy-imported.
- [x] 10. Native: `PackingListCard` component in dispatch detail, visible for
          completed dispatches. "Share / Export" uses `Share.share()` from
          `react-native` with a human-readable text summary.

### M8 API additions
- `packingList.create({ dispatchId })` — manual trigger; errors if already exists
- `packingList.get({ id })` — returns snapshot as parsed object
- `packingList.byDispatch({ dispatchId })` — returns null if none yet
- `packingList.list({ limit, offset })` — paginated list for company
- `packingList.regenerate({ id })` — delete + recreate with fresh snapshot

### M8 Schema used
- `packing_list` + `packing_list_line` tables existed from schema bootstrap.
  No new migration needed.

### M8 Dependencies added
- `apps/web`: `@react-pdf/renderer@4.5.1`, `xlsx@0.18.5`

### M8 Testing
- `dispatch.complete` → `packingList.byDispatch` returns new PL with correct code
- Snapshot contains customer contact, all items (serial, die, dimensions),
  totals that match item-level sum, `generatedAt` timestamp
- `regenerate` produces new `PL-XXXXXX` code; old row is gone
- PDF download: opens in browser PDF viewer with correct company/customer/items
- Excel download: two sheets, totals match
- Native Share: shares human-readable text summary with all bundle serials
- Dev deploy verified at `dev.orrn.app` (Deploy Dev GHA success for `f19886c`)

---

## Completed milestone: M7 SaaS Visual Rewrite ✅

(Delivered before M8 — commits ff07099, 84d42e4, 6cb903c, b24f1d3, 3ddd9e4
on branch m7-design-system. See git log for details.)

---

## Completed milestone: M6 Multi-tenant Security & Role Awareness ✅

### M6 Scope
Make the client side as multi-tenant aware as the server already is: gate every
authenticated route behind a session + company check, redirect platform admins
into their own console, surface the active company + role in the header,
silently hide actions the current role can't perform, clear the React Query
cache on sign-out and company switch, and stub the impersonation banner that
M9 will fully wire up. No visual rewrite — that's M7.

### M6 Deliverables
- [x] 1. New `auth.me` tRPC query in `packages/server/src/routers/auth.ts`,
       registered in `packages/server/src/routers/index.ts`, returning
       `{ user, company: { id, name, slug, status, plan, role } | null,
       isPlatformAdmin, impersonation }`.
- [x] 2. Role-capability matrix in `packages/server/src/lib/permissions.ts`
       (actions for customer/die/receipt/bundle/dispatch/member/settings/
       platform.*) plus pure `can(me, action)` / `canAny(me, actions)` helpers
       reused by web and native.
- [x] 3. Route guards on web via shared `apps/web/src/shared/lib/guards.ts`
       (`requireSession`, `requireCompanyMe`, `requirePlatformAdmin`,
       `loadMe`). Decision: kept the flat route layout (Option A) instead of
       layout-group restructure to minimise router churn. Every authenticated
       route now sets `beforeLoad: requireCompanyMe`; `/platform/*` uses
       `requirePlatformAdmin`; `/login` accepts a `next` search param.
- [x] 4. New `/no-access` page for signed-in users without an active company
       membership, with a sign-out action that clears the QueryClient.
- [x] 5. `<Can do="…">` component + `useMe()` hook on web
       (`apps/web/src/shared/lib/me.ts`, `apps/web/src/shared/components/can.tsx`) and on
       native (`apps/native/utils/me.ts`, `apps/native/components/can.tsx`).
- [x] 6. Web shell (`apps/web/src/shared/components/app-shell.tsx`) filters nav links
       by capability, shows company name + role badge, exposes the platform
       link only for platform admins, and renders the impersonation banner.
- [x] 7. Action gating across web screens: customers, dies, receipts,
       bundles, dispatches, settings/members, platform/waitlist. Buttons are
       wrapped in `<Can>` — never removed — so the server stays authoritative.
- [x] 8. Native session + role gating: `apps/native/app/_layout.tsx` mounts
       the impersonation banner and tenant cache guard;
       `apps/native/app/(drawer)/_layout.tsx` hides Receipts/Members drawer
       entries by capability. Mobile-only floors still see
       Bundles/Dispatches/Stock.
- [x] 9. Cache hygiene: `queryClient.clear()` on sign-out everywhere, plus a
       `TenantCacheGuard` on web (and native parity) that drops non-`auth.me`
       queries whenever the active `companyId` changes.
- [x] 10. Impersonation stub: `x-orrn-impersonate-company` header is honoured
        in `createContext` only for platform admins; impersonation info is
        threaded into the tRPC context and into `writeAudit` so every audit
        row records `impersonatorId`. Client banner (`ImpersonationBanner`)
        renders on web + native and "Stop impersonating" drops the cached
        `auth.me` so the next request runs without the header.

### M6 API additions
- `auth.me` query (authenticated; returns null `company` when the caller has no
  active membership instead of throwing).

### M6 Schema additions
- None. `auditLog.impersonatorId` already existed in `packages/db/src/schema/
  auth.ts`, so no Drizzle migration was generated.

### M6 Skipped / simplified vs the plan
- Route layout-groups (`_public/`, `_app/`, `_platform/`) — kept the flat
  routes and applied per-file `beforeLoad: requireCompanyMe`. Same security
  outcome; smaller diff; safer for the TanStack Router code-gen.
- Native impersonation "Stop" button currently just clears the cached
  `auth.me`. The actual `x-orrn-impersonate-company` header is only set by the
  M9 admin console anyway; on native we never set it, so the banner is
  effectively dormant on mobile.
- No new audit migration — the `impersonatorId` column already exists from M0
  and is now populated.

### M6 Testing
- `bun run check-types` passes (web/server/native + every shared package).
- `auth.me` returns `UNAUTHORIZED` without cookies and the full
  `{ user, company, isPlatformAdmin, impersonation }` shape with a valid
  session. Tenant data is never returned for other companies.
- Hitting any authenticated web route without a session redirects to
  `/login?next=…`; after login the user is sent back to `next`.
- Platform admins without a company membership land on `/platform/waitlist`
  (or any `/platform/*` route) without being redirected to `/no-access`.
- For a forced `viewer` role, action buttons across customers/dies/dispatches
  disappear while read views still render.

### M6 Follow-ups for M7
- The header redesign is functional but still uses the existing shadcn shell.
  The Tamagui-driven visual rewrite is M7's job.
- Native still uses NativeWind classes for the impersonation banner; replace
  with the shared `@orrn/ui` Tamagui primitives in M7.

## Completed milestone: M5 Dispatch State Machine ✅

### M5 Scope
Atomic dispatch lifecycle (`draft -> reserved -> completed/cancelled`) with synchronized bundle status transitions (`available <-> reserved -> dispatched`), customer linkage, dispatch code auto-gen, Web/Native parity, and an audit-derived activity timeline. The bundle state machine in M4 stays intact: `reserved`/`dispatched` transitions are owned exclusively by the dispatch flow.

### M5 Deliverables
- [x] 1. Schema: `bundle_company_dispatch_idx` index + migration `0002_nebulous_zarda.sql`
- [x] 2. Dispatch tRPC router (`create`, `listDispatches`, `getDispatch`, `update`, `addBundle`, `addBundlesBySerial`, `removeBundle`, `reserve`, `unreserve`, `complete`, `cancel`, `softDelete`) with atomic bundle transitions, audit, and sequence on every mutation
- [x] 3. Bundle router: `getBundle` returns `activeDispatch` when status is `reserved` or `dispatched`
- [x] 4. Web: `/dispatches`, `/dispatches/new`, `/dispatches/$id` with status-aware action bar, serial search + paste composers, items table, activity timeline. Bundle detail page links to active dispatch.
- [x] 5. Native: `dispatches/index`, `dispatches/new`, `dispatches/[id]` with scan-serial workflow + status-aware actions and confirmations
- [x] 6. Nav: web header now has `Dispatches`; native drawer has `Dispatches` (MaterialIcons local-shipping)
- [x] 7. Auto-generated dispatch codes: `DSP-{6-digit serverSeq}` via existing `nextCompanySeq`

### M5 API Additions
- `dispatch.create({ customerId, shipDate?, notes? })` — draft + auto code
- `dispatch.listDispatches({ search?, status?, customerId?, limit, offset })` — paginated with per-row item/quantity/weight aggregates
- `dispatch.getDispatch({ id })` — header + items (joined to bundle/die) + recent audit events
- `dispatch.update({ id, ... })` — only when status is `draft`
- `dispatch.addBundle({ id, bundleId })` — only `draft`/`reserved`; reserves the new bundle atomically if dispatch is already reserved
- `dispatch.addBundlesBySerial({ id, serials[] })` — bulk add via scan/paste workflow
- `dispatch.removeBundle({ id, bundleId })` — only `draft`/`reserved`; releases the bundle atomically if dispatch is reserved
- `dispatch.reserve({ id })` — `draft -> reserved` with bulk bundle `available -> reserved`
- `dispatch.unreserve({ id })` — inverse of reserve
- `dispatch.complete({ id })` — `reserved -> completed` with bulk bundle `reserved -> dispatched`, sets `completedBy/completedAt`
- `dispatch.cancel({ id, reason? })` — `draft/reserved -> cancelled`; releases reserved bundles back to `available`
- `dispatch.softDelete({ id })` — only `draft`/`cancelled`, sets `deletedAt`

### M5 State Machines

Dispatch:
- `draft -> reserved | cancelled`
- `reserved -> draft | completed | cancelled`
- `completed` and `cancelled` are terminal

Bundle (driven exclusively by dispatch actions in M5):
- On `reserve` / `addBundle(reserved)` : `available -> reserved`, `currentDispatchId = dispatch.id`
- On `unreserve` / `removeBundle(reserved)` / `cancel(from reserved)` : `reserved -> available`, `currentDispatchId = null`
- On `complete` : `reserved -> dispatched`
- M4's `bundle.transitionStatus` still only permits `available <-> void` — manual reserved/dispatched transitions are rejected

### M5 Testing
- Create dispatch + 3 bundles -> Reserve -> verify all bundles `reserved` + `currentDispatchId` set + 3 `bundle_status_event` rows with `dispatchId`
- Unreserve -> bundles back to `available`, `currentDispatchId` cleared
- Reserve -> Complete -> bundles `dispatched`, `dispatch.completedBy/At` populated
- Adding a `reserved` bundle to a different dispatch -> 409 `Bundle not available`
- `bundle.transitionStatus({ to: "reserved" })` -> 400 (M4 invariant preserved)
- All routes derive `companyId` from server context; no cross-tenant disclosure

## Completed milestone: M4 Bundles and Stock ✅

### M4 Scope
Production-Receipt-based bundle creation with auto-generated codes/serials, an M4-scope status state machine (`available` ↔ `void`), filterable bundle list/detail with status timeline, aggregated Stock view, and CSV/JSON bulk import via the receipt form. Web/Native parity throughout.

### M4 Deliverables
- [x] 1. Schema additions: `bundle_group.code` + 3 indexes + migration `0001_normal_gauntlet.sql`
- [x] 2. Bundle tRPC router (`createReceipt`, `listGroups`, `getGroup`, `listBundles`, `getBundle`, `transitionStatus`, `stockSummary`)
- [x] 3. Web: `/bundles`, `/bundles/$id`, `/receipts`, `/receipts/new`, `/receipts/$id`, `/stock`
- [x] 4. Native: `bundles/index`, `bundles/[id]`, `receipts/index`, `receipts/new`, `receipts/[id]`, `stock/index`
- [x] 5. Auto-generated codes: `bundleGroup.code = BG-{6-digit serverSeq}`; `bundle.serial = {groupCode}-B{3-digit row idx}`
- [x] 6. State machine: M4 supports `available` ↔ `void`. Reserved/dispatched transitions reserved for M5.

## Completed milestone: M0 Foundation ✅

- [x] Resolve product and architecture ambiguities.
- [x] Confirm stack: Bun/Turborepo, Vite React web, Expo native, Hono/tRPC Worker, Drizzle + D1, Better Auth, Tamagui, Alchemy.
- [x] Confirm native app is in v1 scope with web parity.
- [x] Confirm tenant-local-only native mirrors; no cross-tenant data is sent to web/native clients.
- [x] Confirm no audit cron for now.
- [x] Add tenant, role, audit, sync, printing, waitlist, and device schema foundations.
- [x] Add tenant-aware tRPC context and procedure guards.
- [x] Add AES-GCM helper for tenant secrets using Worker-bound master key.
- [x] Replace shadcn UI foundation with Tamagui foundation for web + native parity.
- [x] Add root-level developer guidance in `AGENTS.md`.
- [x] Run typecheck/build validation.

### M0 Deliverables

**Database (D1/SQLite)**
- 25 tables generated via Drizzle ORM
- Tenant-scoped operational tables with `companyId` FK and composite indexes
- Audit log with configurable retention per company
- Sync metadata (device, mutation, company_sequence) for offline-first native
- Printing metadata (label_template, printer_profile, print_log) for orrn-spool integration
- Soft-delete support for dies, customers, dispatches; status-only for bundles

**API Layer (tRPC v11)**
- `companyProcedure` enforces tenant isolation and active company status
- `platformProcedure` for platform-admin-only endpoints
- `roleGuard(...roles)` middleware for fine-grained permissions
- Context injects `db`, `companyId`, `role`, `membership`, `isPlatformAdmin`
- Audit helper `writeAudit()` for every state-changing mutation
- Sequence helper `nextCompanySeq()` for monotonic `serverSeq` per tenant

**Crypto & Secrets**
- AES-GCM wrap/unwrap utilities in `@orrn/crypto` for tenant secrets (spool API keys)
- Master key bound to Worker via `ORRN_MASTER_KEY` secret

**UI Foundation (Tamagui)**
- Shared design system in `@orrn/ui` with tokens and Tamagui v4 config
- Web: Vite plugin + generated CSS; Native: Babel plugin
- Provider wrapper `OrrnUiProvider` injected at app roots
- Existing shadcn components remain functional; new components use Tamagui primitives

**Infra & Env**
- Alchemy bindings updated: `ORRN_MASTER_KEY`, `RESEND_API_KEY`, `WEBHOOK_BASE_URL`, `NODE_ENV`
- All packages have `check-types` scripts; full repo passes `bun run check-types`
- Build passes: `bun run build` (web + server Worker)

## Locked product constraints

- Shared D1 database with tenant-scoped operational tables.
- `companyId` must come from authenticated server context, never from tenant API inputs.
- Regular users belong to exactly one company.
- Platform admins are separate from company users and can list, suspend, and time-box impersonate tenants.
- Native offline sync is tenant-local and limited to floor-worker subset.
- Workers should do bounded, indexed, short-lived work only.
- PDF/xlsx exports are generated client-side from server-generated snapshots.
- Printing goes through per-tenant LAN `orrn-spool` deployments.

## Future milestones

- M10: Printing via orrn-spool (per-tenant LAN deployment + webhooks).
- M11: Audit log viewer + retention settings.
- M12: Native offline-first sync (floor-worker subset).

## Completed milestones

### M3 Dies ✅

#### M3 Scope
Full CRUD capabilities and bulk import for Dies across Web and Native platforms, fully respecting tenant isolation rules.

#### M3 Deliverables
- [x] 1. Structured dimensions schema
- [x] 2. Die API (tRPC) with duplicate validation
- [x] 3. Die Web Views & Form
- [x] 4. CSV/JSON Bulk Import & Resolution UI
- [x] 5. Die Native Views & Form

### M2 Customers ✅

#### M2 Scope
Full CRUD capabilities and bulk import for Customers across Web and Native platforms, fully respecting tenant isolation rules.

#### M2 Deliverables
- [x] 1. Auditing & Sequences
- [x] 2. Customer API (tRPC)
- [x] 3. Customer Web Views & Form
- [x] 4. CSV Bulk Import UI
- [x] 5. Customer Native Views & Form

### M1 Implementation ✅
Self-serve company onboarding flow: public waitlist form → platform-admin approval → owner invite email → member management UI.

### M1 Deliverables
- [x] 1. Public waitlist route (`/waitlist`) with form validation
- [x] 2. Platform-admin waitlist review screen (`/platform/waitlist`) with approve/reject actions
- [x] 3. Email adapter (pluggable: mock dev + Resend prod) for invite emails
- [x] 4. Company creation atomic transaction (company + owner membership + invite)
- [x] 5. Member management UI (list, change role, remove) under `/settings/members`
- [x] 6. Invite accept flow (`/invite/:token`) with role assignment
- [x] 7. Token-based invite flow implementation
- [x] 8. Audit trail metadata built-in to schema operations

### M1 Schema Additions
- None (reuse existing `waitlist_request`, `company`, `membership`, `invite` tables)

### M1 API Additions
- `waitlist.submit` (public)
- `platform.waitlist.list` / `approve` / `reject` (platform-admin only)
- `company.invites.create` / `list` / `revoke` (owner/admin)
- `invite.acceptByToken` (public, sets password)
- `company.members.list` / `updateRole` / `remove` (owner/admin)

### M1 UI Additions
- Web: waitlist form, platform admin waitlist review, members settings
- Native: members list (read-only), invite accept screen

### M1 Email Templates
- `invite_owner` (first user of new company)
- `invite_member` (subsequent invites)
- `waitlist_approved` (optional notification)

### M1 Testing
- Tenant isolation: ensure waitlist approval creates only the approved company
- Role matrix: only owner can create invites; admin can manage members
- Email delivery: mock in dev, Resend in prod

Ready to start M1 implementation.
# PR B — grouped packing lists

- Implement snapshot v2 grouped packing lists, automatic tenant-configured labels, D1-safe scan chunks, grouped web/native previews, and Fourcubes opt-in without schema or transition changes.

# PR C0 — dispatch invoice number

- Add a nullable first-class invoice number, editable on draft/reserved dispatches and frozen into packing-list snapshots before PR C adds Complete & print.

# PR C — complete and print

- Allow manager-led draft or reserved completion with an atomic bundle lock, immutable packing-list creation, and immediate PDF/share output on web and native.
