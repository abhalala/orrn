# Phase 5: tRPC Simplification

## Why

25 procedures repeat the same 6-step pattern (validate → scoped find → throw NOT_FOUND → nextCompanySeq → atomicBatch + auditInsert → return). Helper functions reduce this to ~8 lines per procedure while keeping unique business logic visible.

The platform router is a 17-procedure monolith. Splitting it into 4 files improves navigation and reduces merge conflicts.

## Helper functions

New file: `packages/server/src/lib/helpers.ts`

### 1. `scopedFindOrThrow`

```typescript
async function scopedFindOrThrow<T>(
  db: OrrnDb,
  companyId: string,
  table: any,
  id: string,
  opts?: { softDeleteField?: string }
): Promise<T>
```

Handles: companyId-scoped select + `deletedAt IS NULL` check + generic NOT_FOUND throw.

### 2. `withAudit`

```typescript
async function withAudit(
  ctx: Context,
  action: string,
  subjectType: string,
  subjectId: string,
  writeFn: (seq: number, id: string) => BatchItem[]
): Promise<{ id: string; serverSeq: number }>
```

Handles: `nextCompanySeq()` + `atomicBatch()` + `auditInsert()` + return `{ id, serverSeq }`.

### 3. `paginatedList`

```typescript
async function paginatedList<T>(
  ctx: Context,
  table: any,
  opts: {
    search?: string;
    limit: number;
    offset: number;
    searchFields?: Array<{ column: any; type: "text" | "exact" }>;
    filters?: Record<string, unknown>;
    orderBy?: any;
    includeDeleted?: boolean;
  }
): Promise<{ items: T[]; total: number }>
```

Handles: dynamic WHERE building + LIMIT/OFFSET + COUNT + return `{ items, total }`.

### 4. `assertNoDuplicate`

```typescript
async function assertNoDuplicate(
  db: OrrnDb,
  companyId: string,
  table: any,
  fields: Record<string, unknown>,
  excludeId?: string
): Promise<void>
```

Handles: uniqueness check + CONFLICT throw.

## Platform router split

| Current file | New files | Procedures |
|-------------|-----------|-----------|
| `routers/platform.ts` (17 procs) | `routers/platform/waitlist.ts` | `waitlistList`, `waitlistApprove`, `waitlistReject` |
| | `routers/platform/companies.ts` | `companiesList`, `companiesGet`, `companiesSuspend`, `companiesReactivate`, `updatePlanAndModules` |
| | `routers/platform/impersonation.ts` | `impersonationCreateGrant`, `impersonationRevokeGrant`, `impersonationListActive` |
| | `routers/platform/staff.ts` | `staffList`, `staffCreate`, `staffUpdateRole`, `staffRemove`, `staffAssignableRoles` |
| | `routers/platform/index.ts` | `overview` + re-exports merged router |

## Steps

### 1. Create `packages/server/src/lib/helpers.ts`

### 2. Refactor `customer.ts` as pilot

Replace the 6 CRUD procedures with helper-based versions. Verify types compile.

### 3. Roll out to remaining routers

Apply helpers to `die.ts`, `bundle.ts`, `dispatch.ts`, `packingList.ts`, `invite.ts`, `company.ts`.

### 4. Split `platform.ts` into 4 sub-files

### 5. Update `routers/index.ts` to import from new platform sub-files

### 6. Run `bun run check-types` + `bun run dev:server`

## Rollback

Revert helper imports, restore original procedure bodies. Re-merge platform sub-files into single file.