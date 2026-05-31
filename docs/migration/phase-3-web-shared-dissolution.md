# Phase 3: Dissolve `@orrn/web-shared`

## Why

`web-shared` exists only because 3 web apps needed shared code. After Phase 4 merges them into 1 app, all 117 import sites point to the same app. No cross-app sharing needed.

## What goes where

| web-shared file | Destination | Notes |
|----------------|-------------|-------|
| `utils/trpc.ts` | `apps/web/src/shared/trpc.ts` | tRPC client + queryClient |
| `lib/auth-client.ts` | `apps/web/src/shared/auth-client.ts` | Better Auth web client |
| `lib/me.ts` | `apps/web/src/shared/me.ts` | useMe hook |
| `lib/impersonation.ts` | `apps/web/src/shared/impersonation.ts` | sessionStorage helpers |
| `lib/length.ts` | `apps/web/src/shared/length.ts` | useLengthUnit hook |
| `lib/urls.ts` | `apps/web/src/shared/urls.ts` | App URL constants |
| `lib/erp-guards.ts` | `apps/web/src/shared/guards.ts` | ALL guards in one file |
| `lib/admin-guards.ts` | (merged into guards.ts) | requirePlatformAdmin |
| `lib/packingListPdf.tsx` | `apps/web/src/shared/packingListPdf.tsx` | PDF generation |
| `lib/packingListXlsx.ts` | `apps/web/src/shared/packingListXlsx.ts` | XLSX generation |
| `components/loader.tsx` | `apps/web/src/shared/loader.tsx` | Loading spinner |
| `components/theme-provider.tsx` | `apps/web/src/shared/theme-provider.tsx` | Dark/light theme |
| `components/tenant-cache-guard.tsx` | `apps/web/src/shared/tenant-cache-guard.tsx` | Cache clearing |
| `components/can.tsx` | `apps/web/src/shared/can.tsx` | Capability gate |
| `components/impersonation-banner.tsx` | `apps/web/src/shared/impersonation-banner.tsx` | Web impersonation banner |
| `components/mode-toggle.tsx` | `apps/web/src/shared/mode-toggle.tsx` | Theme toggle |
| `components/user-menu.tsx` | `apps/web/src/shared/user-menu.tsx` | User dropdown |
| `components/app-shell.tsx` | `apps/web/src/shared/app-shell.tsx` | ERP layout shell |
| `components/staff-shell.tsx` | `apps/web/src/shared/staff-shell.tsx` | Admin layout shell |
| `components/sign-in-form.tsx` | `apps/web/src/shared/sign-in-form.tsx` | Tenant sign-in |
| `components/staff-sign-in-form.tsx` | `apps/web/src/shared/staff-sign-in-form.tsx` | Staff sign-in |
| `components/sign-up-form.tsx` | `apps/web/src/shared/sign-up-form.tsx` | Sign-up form |
| `components/force-password-change-form.tsx` | `apps/web/src/shared/force-password-change-form.tsx` | Password rotation |
| `components/breadcrumbs.tsx` | `apps/web/src/shared/breadcrumbs.tsx` | Breadcrumb nav |
| `components/import-dies-modal.tsx` | `apps/web/src/shared/import-dies-modal.tsx` | CSV import modal |
| `components/admin/nav-card.tsx` | `apps/web/src/shared/nav-card.tsx` | Admin nav card |
| `components/admin/stat-card.tsx` | `apps/web/src/shared/stat-card.tsx` | Admin stat card |
| `index.css` | (deleted) | apps/web already imports from @orrn/ui/globals.css |

## Steps

### 1. Create `apps/web/src/shared/` directory

### 2. Copy all web-shared files to `apps/web/src/shared/`

### 3. Update all import paths

Every file in `apps/web/`, `apps/admin/`, `apps/erp/` that imports from `@orrn/web-shared/...` changes to `@/shared/...`.

This is a find-and-replace across ~117 import sites. Pattern:

```
@orrn/web-shared/utils/trpc        → @/shared/trpc
@orrn/web-shared/lib/auth-client    → @/shared/auth-client
@orrn/web-shared/lib/me             → @/shared/me
@orrn/web-shared/lib/impersonation  → @/shared/impersonation
@orrn/web-shared/lib/length         → @/shared/length
@orrn/web-shared/lib/urls           → @/shared/urls
@orrn/web-shared/lib/erp-guards     → @/shared/guards
@orrn/web-shared/lib/admin-guards   → @/shared/guards
@orrn/web-shared/lib/packingListPdf → @/shared/packingListPdf
@orrn/web-shared/lib/packingListXlsx → @/shared/packingListXlsx
@orrn/web-shared/components/*       → @/shared/*
@orrn/web-shared/index.css          → (removed, already covered by @orrn/ui/globals.css)
```

### 4. Merge `erp-guards.ts` and `admin-guards.ts` into `guards.ts`

Combine `requireCompanyMe`, `requireSession`, `requireErpEntry` (from erp-guards) and `requirePlatformAdmin` (from admin-guards) into a single `apps/web/src/shared/guards.ts`.

### 5. Remove `@orrn/web-shared` from root package.json workspaces

### 6. Delete `packages/web-shared/`

### 7. Run `bun install` + `bun run check-types`

## Rollback

Restore web-shared package from git. Revert import paths.

## Note

This phase must happen BEFORE Phase 4 (single web app) because Phase 4 merges the three web apps, and the import paths need to be stable first.