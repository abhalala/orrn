# Phase 6: Cross-Platform Permissions Unification

## Why

`apps/native/utils/me.ts` and `packages/web-shared/src/lib/me.ts` have identical `can()`/`canAny()` wrapper logic. The `Me` type differs only in two optional fields (`mustChangePassword`, `platformRole`). After Phase 2, both import from `@orrn/server/lib/permissions`. Making these fields optional in the canonical type eliminates the duplication.

## Steps

### 1. Update `Me` type in `packages/server/src/lib/permissions.ts`

Add optional fields:

```typescript
export type Me = {
  user: { id: string; name: string; email: string };
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
    role: CompanyRole;
    settings?: { lengthUnit?: LengthUnit };
  } | null;
  isPlatformAdmin: boolean;
  platformRole?: PlatformStaffRole | null;    // ← NOW OPTIONAL
  mustChangePassword?: boolean;               // ← NOW OPTIONAL
  impersonation?: {
    grantId: string;
    companyId: string;
    companyName: string;
    expiresAt: string;
  } | null;
};
```

### 2. Update `apps/web/src/shared/me.ts` (after Phase 3)

Import `can`, `canAny`, `Me`, `Action` from `@orrn/server/lib/permissions`. Remove local re-definitions.

### 3. Update `apps/native/utils/me.ts`

Import `can`, `canAny`, `MeLike`, `Action` from `@orrn/server/lib/permissions`. Remove local re-definitions.

### 4. Verify both platforms

- Web: `can(me, "customer.create")` works with `mustChangePassword` and `platformRole` populated
- Native: `can(me, "customer.create")` works with `platformRole: undefined` and `mustChangePassword: undefined`
- Both: `<Can do="dispatch.complete">` renders correctly

### 5. Run `bun run check-types` for both web and native

## What stays duplicated

- `useMe()` hooks — each platform has its own tRPC client setup (web uses sessionStorage impersonation header, native uses Better Auth cookie forwarding). The hook itself stays local.
- `<Can>` component — 5 lines of rendering logic. Not worth a cross-platform package.
- `useLengthUnit()` hook — depends on `useMe()` which is platform-specific.

## Rollback

Revert the `Me` type changes. Restore local type definitions in web-shared and native.