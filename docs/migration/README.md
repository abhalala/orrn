# ORRN Simplification Migration

Multi-phase architectural simplification that eliminates complexity without losing functionality.

## Overview

| Metric | Before | After |
|--------|--------|-------|
| Packages | 10 | 7 |
| Web apps | 3 | 1 |
| Vite builds | 3 | 1 |
| Deploy targets (web) | 3 Cloudflare Pages | 1 |
| Duplicated config files | 13 | 0 |
| tRPC procedure LOC (est.) | ~2000 | ~1000 |
| Platform router | 1 file, 17 procs | 4 files, 3-5 each |

## Phases

| # | Phase | Risk | Description |
|---|-------|------|-------------|
| 1 | [design → ui merge](./phase-1-design-merge.md) | None | Merge `@orrn/design` into `@orrn/ui` |
| 2 | [api + infra → server merge](./phase-2-server-merge.md) | Low | Merge `@orrn/api` + `@orrn/infra` into `@orrn/server` |
| 3 | [web-shared dissolution](./phase-3-web-shared-dissolution.md) | Medium | Move `@orrn/web-shared` into `apps/web/src/shared/` |
| 4 | [single web app](./phase-4-single-web-app.md) | Medium | Merge admin + erp + web into one app with route groups |
| 5 | [tRPC simplification](./phase-5-trpc-simplification.md) | Low | Helper functions + platform router split |
| 6 | [permissions unification](./phase-6-permissions-unification.md) | None | Unify `Me` type across web + native |

## Dependency graph

```
P1 (design→ui) ──→ P3 (web-shared) ──→ P4 (single web app)
P2 (api+infra→server) ──→ P3
P2 ──→ P5 (tRPC helpers)
P2 ──→ P6 (permissions)
```

P1 and P2 can run in parallel. P3 requires both P1 and P2. P4 requires P3. P5 and P6 require P2 but are independent of P3/P4.

## Validation after every phase

```bash
bun install
bun run check-types
bun run dev:web     # verify web renders
bun run dev:server  # verify API responds
```

## What does NOT change

- `@orrn/db` — 27 tables, 7 migrations, schema, connection factory, atomic batch
- `@orrn/auth` — Better Auth config, custom scrypt, origins
- `@orrn/crypto` — AES-GCM wrap/unwrap (orphaned but reserved for spool)
- `@orrn/env` — per-platform env validation
- `@orrn/config` — shared tsconfig
- `apps/server` — Cloudflare Worker entry (becomes thinner after P2)
- `apps/native` — Expo app (structure unchanged, future Tamagui migration is separate)
- Database schema — no table changes in any phase
- API contract — all 68 tRPC endpoints preserved
- Auth flow — Better Auth + impersonation unchanged