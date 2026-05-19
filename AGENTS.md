# AGENTS.md

Instructions for AI agents working in this repository.

## Project overview

ORRN is being rebuilt as a sellable multi-company ERP SaaS for manufactured inventory operations: dies, bundles, stock, label printing, dispatches, packing lists, customers, permissions, auditability, web app, and native iOS/iPadOS/Android apps.

## Stack

- Package manager: Bun.
- Monorepo: Turborepo.
- Web: Vite + React + TanStack Router + TanStack Query + tRPC client.
- Native: Expo + React Native + expo-router.
- Shared UI: Tamagui for both web and native.
- Server: Cloudflare Worker + Hono + tRPC v11.
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

## Worker performance rules

- Minimize Worker CPU and wall time.
- Paginate all lists, sync pulls, platform admin views, and audit views.
- Avoid full-table scans and N+1 query patterns.
- Do not generate PDFs/xlsx files in Workers; clients render exports from snapshots.
- Do not perform printer IO in Workers; delegate queueing and printer connectivity to orrn-spool.
- Keep webhook handlers O(1): verify signature, update one row, return.
- Large imports must be bounded by row/file limits and validated in manageable batches.

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
