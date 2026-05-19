# ORRN ERP Rebuild TODO

This file is the source of truth for current implementation orchestration.

## Active milestone: M0 Foundation ✅

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
- Shared design system `@orrn/design` with v4 config
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

- M3: Dies and server-side bulk import.
- M4: Bundles and stock.
- M5: Dispatch state machine.
- M6: Packing list snapshots and client-side exports.
- M7: Printing via orrn-spool.
- M8: Audit log viewer and retention settings.
- M9: Platform admin area.
- M10: Native offline-first sync.

## Completed milestones

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