# Phase 2: Merge `@orrn/api` + `@orrn/infra` → `@orrn/server`

## Why

Both packages are server-only concerns. `@orrn/infra` imports from `@orrn/api` (for seed scripts). Merging eliminates the `api → infra` boundary and creates a single server package.

## New package structure

```
packages/server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # initTRPC, procedure hierarchy, appRouter
    ├── context.ts            # createContext
    ├── app.ts                # Hono app (from apps/server/src/index.ts)
    ├── routers/
    │   ├── index.ts          # appRouter assembly
    │   ├── auth.ts
    │   ├── bundle.ts
    │   ├── company.ts
    │   ├── customer.ts
    │   ├── die.ts
    │   ├── dispatch.ts
    │   ├── invite.ts
    │   ├── packingList.ts
    │   ├── platform.ts       # (split into sub-files in Phase 5)
    │   └── waitlist.ts
    ├── lib/
    │   ├── permissions.ts
    │   ├── audit.ts
    │   ├── id.ts
    │   ├── sequence.ts
    │   ├── length.ts
    │   ├── atomic.ts         # re-exports from @orrn/db/atomic
    │   ├── email.ts
    │   ├── create-platform-staff.ts
    │   ├── dispatchCode.ts
    │   └── bundleSerial.ts
    └── infra/
        ├── alchemy.run.ts
        └── scripts/
            ├── bootstrap-super-admin.ts
            └── set-staff-password.ts
```

## Steps

### 1. Create `packages/server/` directory

Copy all files from `packages/api/src/` into `packages/server/src/`.
Copy `packages/infra/alchemy.run.ts` into `packages/server/src/infra/`.
Copy `packages/infra/scripts/` into `packages/server/src/infra/scripts/`.

### 2. Create `packages/server/package.json`

Merge dependencies from both `@orrn/api` and `@orrn/infra` package.json files.

### 3. Create `packages/server/tsconfig.json`

Merge tsconfig from `@orrn/api` (which has `composite: true`, `declaration: true`, etc.).

### 4. Update all import paths

Every file that imports from `@orrn/api/...` changes to `@orrn/server/...`:

| Old import | New import | Files affected |
|-----------|-----------|---------------|
| `@orrn/api/context` | `@orrn/server/context` | apps/server/src/index.ts |
| `@orrn/api/routers/index` | `@orrn/server/routers/index` | apps/server/src/index.ts, web-shared/utils/trpc.ts, native/utils/trpc.ts |
| `@orrn/api/lib/permissions` | `@orrn/server/lib/permissions` | web-shared/lib/me.ts, native/utils/me.ts |
| `@orrn/api/lib/length` | `@orrn/server/lib/length` | web-shared/lib/me.ts, web-shared/lib/length.ts, web-shared/lib/packingListPdf.tsx, web-shared/lib/packingListXlsx.ts, native/utils/length.ts, native/utils/me.ts |
| `@orrn/api/routers/die` | `@orrn/server/routers/die` | web-shared/components/import-dies-modal.tsx |

Also update `@orrn/infra/alchemy.run` type reference in `packages/env/env.d.ts`.

### 5. Update internal imports within `@orrn/server`

Files that were in `@orrn/api` and imported from `@orrn/api/...` subpaths now use relative paths.

### 6. Move Hono app creation

Extract the Hono app setup from `apps/server/src/index.ts` into `packages/server/src/app.ts`. `apps/server/src/index.ts` becomes a thin re-export.

### 7. Update root `package.json` and `turbo.json`

- Remove `@orrn/api`, `@orrn/infra` from workspaces
- Add `@orrn/server`
- Update turbo task references

### 8. Delete old packages

```
rm -rf packages/api
rm -rf packages/infra
```

### 9. Run `bun install` + `bun run check-types`

## Rollback

Restore deleted packages from git. Revert import paths.

## Files affected

- **Created**: ~40 files in `packages/server/`
- **Modified**: ~19 import sites across apps and packages
- **Deleted**: `packages/api/`, `packages/infra/`