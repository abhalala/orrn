# Phase 4: Single Web App via Route Groups

## Why

Three web apps (`web`, `admin`, `erp`) share 100% identical `main.tsx`, `index.html`, `tsconfig.json`, `index.css`, and `vite.config.ts` (except port). They differ only in routes and which shell they render. TanStack Router route groups handle this natively.

## Route structure

```
apps/web/src/routes/
├── __root.tsx                     # Role-detecting adaptive shell
├── index.tsx                      # Landing page (redirects authed users)
├── login.tsx                      # Sign-in
├── waitlist.tsx                   # Waitlist form
├── invite.$token.tsx              # Invite acceptance
├── (authed)/
│   ├── _layout.tsx                # beforeLoad: requireSession
│   ├── no-access.tsx
│   ├── setup-credentials.tsx
│   └── change-password.tsx
├── (tenant)/
│   ├── _layout.tsx                # beforeLoad: requireCompanyMe
│   ├── dashboard.tsx
│   ├── dies.index.tsx
│   ├── dies.$id.tsx
│   ├── bundles.index.tsx
│   ├── bundles.$id.tsx
│   ├── dispatches.index.tsx
│   ├── dispatches.new.tsx
│   ├── dispatches.$id.tsx
│   ├── packing-lists.$id.tsx
│   ├── receipts.index.tsx
│   ├── receipts.new.tsx
│   ├── receipts.$id.tsx
│   ├── customers.index.tsx
│   ├── customers.$id.tsx
│   ├── stock.index.tsx
│   ├── settings.members.tsx
│   └── onboarding.tsx
└── (platform)/
    ├── _layout.tsx                # beforeLoad: requirePlatformAdmin
    ├── index.tsx                  # Overview dashboard
    ├── waitlist.tsx
    ├── companies.index.tsx
    ├── companies.$id.tsx
    └── staff.tsx
```

## Steps

### 1. Move all route files from `apps/erp/src/routes/` into `apps/web/src/routes/`

Place ERP routes under `(tenant)/` group:
- `dashboard.tsx`, `dies.*`, `bundles.*`, `dispatches.*`, `packing-lists.*`, `receipts.*`, `customers.*`, `stock.*`, `settings.members.tsx`, `onboarding.tsx`

### 2. Move all route files from `apps/admin/src/routes/` into `apps/web/src/routes/`

Place admin routes under `(platform)/` group:
- `admin.index.tsx` → `(platform)/index.tsx`
- `admin.waitlist.tsx` → `(platform)/waitlist.tsx`
- `admin.staff.tsx` → `(platform)/staff.tsx`
- `admin.companies.index.tsx` → `(platform)/companies.index.tsx`
- `admin.companies.$id.tsx` → `(platform)/companies.$id.tsx`

### 3. Move authed-but-no-company routes under `(authed)/` group

- `no-access.tsx`, `setup-credentials.tsx`, `change-password.tsx`

### 4. Create route group layout files

- `(authed)/_layout.tsx` — `beforeLoad: requireSession`
- `(tenant)/_layout.tsx` — `beforeLoad: requireCompanyMe`
- `(platform)/_layout.tsx` — `beforeLoad: requirePlatformAdmin`

### 5. Rewrite `__root.tsx`

The root layout detects the user's role and renders the appropriate shell:
- Platform admin → `StaffShell`
- Company member → `AppShell`
- Neither → `PublicLayout` (no sidebar, hero background)

### 6. Merge `package.json`

Start with `apps/erp/package.json` (has the most deps including PDF/xlsx). Add any admin-only deps if present.

### 7. Update `vite.config.ts`

Single config, port 3001 (or configurable via env).

### 8. Update deployment config

In `packages/server/src/infra/alchemy.run.ts`: Replace 3 Vite resources with 1. All domains serve the same build.

### 9. Delete `apps/admin/` and `apps/erp/`

### 10. Update root `package.json` and `turbo.json`

Remove `dev:admin`, `dev:erp` scripts. Update `dev:web` to single dev server.

### 11. Run `bun install` + `bun run check-types` + `bun run dev:web`

## Rollback

Restore deleted apps from git. Revert route tree changes.

## Key concern

The `__root.tsx` must handle three states:
1. **No session** → public layout (marketing, login, waitlist, invite)
2. **Session + company** → tenant layout (AppShell + sidebar)
3. **Session + platform admin** → staff layout (StaffShell + sidebar)

The route group layouts handle the guard logic. The root layout only handles the shell selection.