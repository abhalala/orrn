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

## Roles & client-side capability gating

- The canonical role-capability matrix lives in
  `packages/server/src/lib/permissions.ts` (`ACTIONS`, `ROLE_ACTIONS`, `can`,
  `canAny`). It is the single source of truth for both server `roleGuard`
  middleware and client `<Can>` / `useMe` hooks.
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

- Regular users belong to exactly one company.
- Platform admins are stored separately and are not normal tenant members.
- Company roles for v1: `owner`, `admin`, `manager`, `operator`, `viewer`.
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
