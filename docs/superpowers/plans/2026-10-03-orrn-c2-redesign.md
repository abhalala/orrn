# orrn C2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every orrn surface (web + native) on the C2 design system with a simplified route map, fix the audited backend/frontend defects behind them, and ship to dev.orrn.app then orrn.in.

**Architecture:** Shared packages first (`@orrn/domain` maths, `@orrn/i18n` strings + guides, C2 tokens/components in `@orrn/ui`), then a hardened server (test harness + audit fixes + three small procedures), then the web shell, routes and screens, then the native tab app on the same packages, then end-to-end verification and deploy. Backend behaviour is preserved except for audited bugs.

**Tech Stack:** Bun 1.3.13, Turborepo, TypeScript 6, React 19, Vite + TanStack Router/Query + tRPC 11, Tailwind v4, Radix, Expo 55 + expo-router + NativeWind 4 + Reanimated 4, Hono on Cloudflare Workers, D1 + Drizzle, Better Auth 1.6.9, Alchemy, Playwright, Miniflare (tests).

**Spec:** `docs/superpowers/specs/2026-10-03-orrn-c2-redesign-design.md` · **Audit:** `docs/superpowers/review/2026-10-03-audit.md` (finding ids S#, W#, N# are referenced below; read the row for evidence).

## Global Constraints

- Tenant rules in `AGENTS.md` stay: never accept `companyId` from clients; every query scoped by `ctx.companyId`; generic "Not found"; `<Can do>` on every mutating control; impersonation header web-only.
- No D1 `db.transaction()`; writes via `atomicBatch`. **Every statement ≤ 100 bound parameters.**
- Weights display in kg (`weightG / 1000`), never grams. Lengths input in company `settings.lengthUnit` (`mm` | `inch`); inch companies see feet + inches.
- kg/12ft = `(weightKg / pcs) / (lengthMm / 304.8) * 12`. Weight range /12' = `Math.floor((kg12ft + 0.01) * 10) / 10`.
- Status colours: green=available/completed, blue=reserved, amber=attention/ageing, red=void/cancelled/error, violet=Godseye only.
- Fonts: Bricolage Grotesque (display), Geist (body), Geist Mono (numbers/codes), self-hosted (`@fontsource-variable/*` web, `expo-font` native).
- Touch targets ≥ 44px; primary actions ≥ 56px on touch layouts. Breakpoints: phone < 768, iPad 768–1279 (sidebar ≥ 1024 landscape), laptop ≥ 1280.
- Every user-visible string goes through `t()` from `@orrn/i18n`; `hi.ts` keys must equal `en.ts` keys.
- Motion respects reduced-motion. GSAP only in the marketing chunk; no Three.js; `@react-pdf` and `xlsx` only via `await import()` on click.
- Every old URL redirects (table in spec §3.2), query preserved.
- No new runtime dependency beyond: `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `barcode-detector`, `expo-camera`, `expo-localization`; dev-only: `miniflare`, `wrangler`, `@axe-core/playwright`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `redesign/c2`.

## Review Focus

1. **Scanning the same bundle twice** (camera double-read, wedge scanner repeat) during Build must not error the batch or add twice — expect a calm "already in this dispatch" toast. Test in Task 5 (server, held and draft) and Task 22 (UI continuous scan).
2. **A 120-bundle dispatch / 40-bundle packing session** must save, reserve, complete and export (D1 limit). Test in Task 2 (server) and Task 30 (E2E creates a 40-bundle session).
3. **A viewer or operator calling a mutation they lack** must get FORBIDDEN from the server even if the UI is bypassed. Test matrix in Task 3.
4. **Inch-unit company entering 11 ft 6 in, and a mm sheet imported into an inch company** must store 3505 mm and 3658 mm respectively, never 25.4× off. Test in Task 7 (domain parse) and Task 25 (import parser).
5. **Session expiry or a revoked impersonation grant mid-use** must land on /login (or drop impersonation) without a redirect loop. Test in Task 13.

---

## Phase A — Shared domain + server hardening

**Execution order for this phase:** 1 → 7 → 2 → 3 → 4 → 5 → 6 → 8 → 9 (Task 5 imports `normalizeSerial` from Task 7).

### Task 1: Server test harness

**Files:**
- Create: `packages/server/test/harness.ts`, `packages/server/test/harness.test.ts`
- Modify: `packages/server/package.json` (script `"test": "bun test"`), `turbo.json` (task `test`), root `package.json` (script `"test": "turbo test"`)

**Interfaces:**
- Produces:
  - `createTestEnv(): Promise<TestEnv>` — Miniflare D1 with all `packages/db/src/migrations/*.sql` applied, `cloudflare:workers` mocked via `mock.module` (env: `DB`, `NODE_ENV:"test"`, `ORRN_MASTER_KEY` dev key, `WEB_PUBLIC_URL:"https://app.test"`).
  - `TestEnv = { db: Db; d1: D1Database; dispose(): Promise<void>; seedCompany(opts?: { modules?: string[]; settings?: Record<string, unknown> }): Promise<{ companyId: string; users: Record<CompanyRole, { id: string; email: string }> }>; caller(as: { role: CompanyRole; companyId: string } | { platformRole: PlatformStaffRole } | null): ReturnType<typeof appRouter.createCaller>; seedDie(companyId: string, over?: Partial<DieInsert>): Promise<string>; seedCustomer(companyId: string): Promise<string>; seedBundles(companyId: string, dieId: string, n: number, status?: BundleStatus): Promise<{ id: string; serial: string }[]> }`
  - The D1 binding passed to Drizzle is wrapped so `prepare(sql).bind(...args)` throws `Error("D1_TOO_MANY_PARAMS")` when `args.length > 100` (mirrors production).

- [ ] **Step 1: Write `harness.test.ts`** — `test("rejects statements over 100 params")` binds 101 params → throws `D1_TOO_MANY_PARAMS`; `test("caller resolves company context")` seeds a company and `caller({role:"owner",companyId}).auth.me()` returns `company.role === "owner"`.
- [ ] **Step 2: Run** `bun test --cwd packages/server` → FAIL (harness missing).
- [ ] **Step 3: Implement `harness.ts`.** Context is built by constructing the same object `createContext` returns (read `packages/server/src/context.ts`) with a fake session `{ user: { id, name, email } }`; do not go through Better Auth.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `test(server): miniflare D1 harness with production param limit`.

### Task 2: D1 parameter-limit chunking (S1)

**Files:**
- Create: `packages/db/src/chunk.ts` (+ export from `packages/db/src/index.ts`), `packages/server/test/d1-limits.test.ts`
- Modify: `packages/server/src/routers/bundle.ts` (createReceipt, bulkImport), `dispatch.ts` (addBundlesBySerial select, reserve, unreserve, complete, cancel, softDelete status events + bundle updates), `packingList.ts` (lines insert), `customer.ts` (importCsv), `die.ts` (processImport), and `pushChunkedInserts` helper wherever defined.

**Interfaces:**
- Produces: `rowsPerStatement(columnsPerRow: number, limit = 100): number` (= `Math.max(1, Math.floor(limit / columnsPerRow))`); `chunk<T>(items: T[], size: number): T[][]`; `pushChunkedInserts(statements, build, rows)` now derives the chunk size from `Object.keys(rows[0]).length` (callers stop passing a size). `inArray` lists are chunked at 90 ids.

- [ ] **Step 1: Write tests** (`d1-limits.test.ts`): `createReceipt with 40 bundles succeeds and creates 40 rows`; `reserve, unreserve, reserve, complete a 120-bundle dispatch`; `addBundlesBySerial with 100 serials`; `packing list for 120 bundles has 120 lines`; `customer.importCsv 250 rows`; `die.processImport 250 rows`.
- [ ] **Step 2: Run** → FAIL with `D1_TOO_MANY_PARAMS`.
- [ ] **Step 3: Implement** chunk helpers and apply to every listed site. For status-event inserts and `UPDATE … WHERE id IN (…)`, chunk ids at 90.
- [ ] **Step 4: Run** → PASS; also `bun run check-types`.
- [ ] **Step 5: Commit** `fix(server): keep every D1 statement under 100 bound params`.

### Task 3: Server-side action guards (S2)

**Files:**
- Modify: `packages/server/src/index.ts` (add `actionProcedure`), routers `customer.ts`, `die.ts`, `bundle.ts`, `dispatch.ts`, `packingList.ts`
- Test: `packages/server/test/permissions.test.ts`

**Interfaces:**
- Produces: `actionProcedure(action: Action)` — `companyProcedure` + `can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, action)` else `TRPCError FORBIDDEN "You don't have permission to do that"`.
- Mapping (exact): customer.create/update/delete/importCsv → `customer.create|update|delete|import`; die.create/update/delete → `die.*`; die.validateImport/processImport → `die.import`; bundle.createReceipt → `bundle.create`; bundle.transitionStatus → `bundle.transition`; bundle.bulkImport → `bundle.import`; dispatch.create → `dispatch.create`; dispatch.update → `dispatch.update`; addBundle/addBundlesBySerial/setItemGroupLabel/removeBundle → `dispatch.addBundle`; reserve/unreserve → `dispatch.reserve`; complete → `dispatch.complete`; cancel → `dispatch.cancel`; softDelete → `dispatch.delete`; packingList.create → `dispatch.complete`; packingList.regenerate → `packingList.regenerate`.

- [ ] **Step 1: Write table-driven test** — for each mapped procedure × role (`owner, admin, manager, operator, viewer`), expected allow/deny = `can(role, action)`; deny asserts `code === "FORBIDDEN"` and no rows changed; specific cases: `viewer → dispatch.complete FORBIDDEN`, `operator → bundle.createReceipt allowed`, `operator → bundle.bulkImport FORBIDDEN` (cannot auto-create dies).
- [ ] **Step 2: Run** → FAIL (viewer cases succeed today).
- [ ] **Step 3: Implement** `actionProcedure` and swap each mutation's builder.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(server): enforce the permission matrix on every ops mutation`.

### Task 4: Auth, ownership and impersonation fixes (S3, S4, S5, S14)

**Files:**
- Modify: `packages/server/src/routers/auth.ts` (changeInitialPassword, completeOnboarding), `company.ts` (membersUpdateRole, membersRemove), `invite.ts` (create role check), `platform/impersonation.ts`, `packages/server/src/context.ts` (grant use re-check)
- Test: `packages/server/test/auth-ownership.test.ts`

**Interfaces:** none new; behaviour changes only.

- [ ] **Step 1: Write tests:** `changeInitialPassword rejects when mustChangePassword is false (FORBIDDEN)`; `changeInitialPassword clears the flag and deletes the user's other sessions`; `admin cannot demote owner / remove owner / invite owner (FORBIDDEN)`; `owner cannot demote the last owner (BAD_REQUEST "A company needs at least one owner")`; `role change, removal and invite each write an audit_log row`; `support staff cannot create an impersonation grant`; `a grant held by staff later downgraded to support is rejected in context`; `operator completeOnboarding cannot change company fields (FORBIDDEN)`, owner can.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Session revocation: delete from Better Auth `session` table where `userId = me and id != current`. Impersonation: `platformGuard("platform.impersonate")`; in context, require `can(me, "platform.impersonate")` when honouring a grant.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(server): lock down password change, ownership and impersonation`.

### Task 5: Dispatch and bundle state predicates (S6 partial, S13, S18 dispatch parts)

**Files:**
- Modify: `packages/server/src/routers/dispatch.ts`, `bundle.ts` (transitionStatus)
- Test: `packages/server/test/dispatch-state.test.ts`

- [ ] **Step 1: Write tests:** `addBundle of a bundle reserved by another dispatch → BAD_REQUEST "Bundle is held by DSP-…"`; `removeBundle from dispatch B does not free dispatch A's reservation`; `rescanning an already-added bundle on a draft and on a held dispatch returns { added: [], alreadyInDispatch: [serial] } without error`; `addBundlesBySerial` returns `{ added: string[]; alreadyInDispatch: string[]; notFound: string[]; unavailable: { serial: string; reason: string }[] }` (serials) and adds the valid ones; `complete after cancel → BAD_REQUEST`, `cancel after complete → BAD_REQUEST` (re-read status inside predicate: UPDATE … WHERE status IN allowed); `softDelete of a held dispatch → BAD_REQUEST "Release the held stock first"`; `transitionStatus void of a reserved bundle → BAD_REQUEST`; `dispatch.update can clear notes with null`; `setItemGroupLabel on a bundle not in the dispatch → NOT_FOUND`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Every bundle UPDATE adds `status = <expected>` and (where relevant) `current_dispatch_id = <this dispatch>`; dispatch UPDATEs add `status IN (<allowed from>)`. `addBundlesBySerial` normalises serials with `normalizeSerial` from `@orrn/domain` (Task 7), splits already-added first, then availability; returns the report shape above (partial success instead of all-or-nothing). Leave a code comment pointing to audit S6 for the residual concurrent race.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(server): guard dispatch and bundle transitions by current state`.

### Task 6: Invites, sequences, CORS, seed, bounds (S7, S8, S11, S15, S16, S17, S18 rest)

**Files:**
- Modify: `packages/server/src/routers/invite.ts`, `lib/sequence.ts`, `apps/server/src/index.ts`, `routers/die.ts`, `routers/customer.ts`, `routers/bundle.ts` (input schema), `routers/waitlist.ts`, `routers/platform/waitlist.ts`, `apps/server/src/spool-routes.ts`
- Test: `packages/server/test/misc-fixes.test.ts`

- [ ] **Step 1: Write tests:** `invite link uses WEB_PUBLIC_URL` (`https://app.test/invite/<token>`); `invite for Ramesh@X.com is accepted by ramesh@x.com`; `two concurrent nextCompanySeq calls return distinct values` (Promise.all of 20); `creating a die with the series+section of a deleted die → CONFLICT "A deleted die uses this code"`; `createReceipt rejects weightKg 0 / pieces 0 / length 0 (BAD_REQUEST)`; `customer.importCsv rejects > 2000 rows`; `die imports reject > 2000 rows`; `strings over 500 chars rejected` on name/notes fields; `waitlistReject of an approved request → BAD_REQUEST`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Sequence: single `INSERT … ON CONFLICT(company_id) DO UPDATE SET value = value + 1 RETURNING value`. CORS: allow `http://localhost:3001`/`3002` only when `env.NODE_ENV === "development"`. `/dev/seed`: also require `new URL(c.req.url).hostname` in `localhost|127.0.0.1`. Webhook: return 400 when `data` missing. Zod: `.max(500)` on free text, `.positive()` on weightG/lengthMm/quantity, `.int()` on die mm/g fields, arrays `.max(2000)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(server): invites, atomic sequences, dev-only CORS/seed, input bounds`.

### Task 7: `@orrn/domain` package + label fix (S19)

**Files:**
- Create: `packages/domain/{package.json,tsconfig.json,src/index.ts,src/units.ts,src/status.ts,src/serial.ts}`, tests `packages/domain/src/*.test.ts`
- Modify: `packages/server/src/lib/bundle-label.ts` (use `kgPer12ft`), `packages/server/src/lib/length.ts` (re-export from domain, keep signatures for existing callers)

**Interfaces (Produces):**
- `units.ts`: `MM_PER_INCH = 25.4`, `MM_PER_FOOT = 304.8`; `gToKg(g: number): number`; `kgToG(kg: number): number` (rounded int); `kgPer12ft(input: { weightG: number; pieces: number; lengthMm: number }): number | null` (null if pieces or length ≤ 0); `weightRange12ft(kg12ft: number): number`; `formatKg(kg: number, digits = 2): string` (`en-IN`, e.g. `"52.40"`), `formatKgTotal(kg: number): string` (1 decimal, grouped); `parseDecimal(text: string): number | null` (accepts `"1,234.5"`, rejects `"1e3"`, `""`, negatives); `lengthFromInput(input: { unit: "mm" | "inch"; mm?: string; feet?: string; inches?: string }): number | null` (mm integer); `formatLength(mm: number, unit: "mm" | "inch"): string` (`"3658 mm"` / `"12 ft"` / `"11 ft 6 in"`, inches rounded to 0.25).
- `status.ts`: `BUNDLE_STATUSES`, `DISPATCH_STATUSES`; `type StatusTone = "green" | "blue" | "amber" | "red" | "neutral"`; `bundleTone(s): StatusTone` (available→green, reserved→blue, dispatched→neutral, void→red); `dispatchTone(s)` (draft→amber, reserved→blue, completed→green, cancelled→red); `dispatchActions(status): { canEdit: boolean; canReserve: boolean; canUnreserve: boolean; canComplete: boolean; canCancel: boolean; canDelete: boolean }` matching `dispatch.ts:23`.
- `serial.ts`: `normalizeSerial(raw: string): string` (trim, uppercase, strip surrounding quotes); `parseScan(raw: string): { kind: "serial"; serial: string } | { kind: "unknown"; raw: string }` (accepts bare serial or any URL whose path ends `/b/<serial>`); `splitPastedSerials(text: string): string[]` (newline/comma/space/tab separated, deduped, normalised).

- [ ] **Step 1: Write tests** with exact values: `kgPer12ft({weightG:52400,pieces:21,lengthMm:3658})` ≈ `2.495` (±0.001); `weightRange12ft(2.522)===2.5`, `(2.388)===2.3`, `(1.786)===1.7`, `(1.813)===1.8`, `(2.499)===2.5`; `lengthFromInput({unit:"inch",feet:"11",inches:"6"})===3505`; `lengthFromInput({unit:"mm",mm:"3658"})===3658`; `parseDecimal("1e3")===null`; `formatLength(3658,"inch")==="12 ft"`; `formatLength(3505,"inch")==="11 ft 6 in"`; `parseScan("https://orrn.in/b/bg-000001-b001")` → serial `BG-000001-B001`; `splitPastedSerials("a\nb, a")` → `["A","B"]`; label test in server: `buildBundleLabelVariables` for that bundle has `weight12ft === "2.495 kg/12ft"` (formatting per existing `formatUnit`).
- [ ] **Step 2: Run** `bun test --cwd packages/domain` → FAIL.
- [ ] **Step 3: Implement.** Package name `@orrn/domain`, `exports` `{ ".": "./src/index.ts" }`, no runtime deps. Add to workspaces automatically (packages/*).
- [ ] **Step 4: Run** → PASS (domain + server label test).
- [ ] **Step 5: Commit** `feat(domain): shared units/status/serial maths; fix label kg/12ft`.

> Ordering note: run Task 7 before Task 5 (Task 5 imports `normalizeSerial`).

### Task 8: New procedures — `dashboard.today`, `bundle.getBySerial`, `company.updateSettings`

**Files:**
- Create: `packages/server/src/routers/dashboard.ts`
- Modify: `routers/index.ts` (mount `dashboard`), `routers/bundle.ts`, `routers/company.ts`
- Test: `packages/server/test/new-procedures.test.ts`

**Interfaces (Produces):**
- `dashboard.today` (companyProcedure, query, no input) → `{ timezone: string; packedToday: { bundles: number; weightG: number }; dispatchedToday: { dispatches: number; weightG: number }; stock: Record<BundleStatus, { bundles: number; weightG: number }>; openDispatches: { id: string; code: string; status: "draft" | "reserved"; customerName: string; bundles: number; weightG: number }[] (max 10, newest first); recentSessions: { id: string; code: string; dieLabel: string; bundles: number; weightG: number; createdAt: string }[] (today, max 10); failedPrintJobs: number }`. Day window = local midnight→midnight in `settings.timezone ?? "Asia/Kolkata"` converted to UTC ms (use `Intl.DateTimeFormat` offset maths, no new dep).
- `bundle.getBySerial({ serial: string })` → same shape as `getBundle`; serial normalised; NOT_FOUND otherwise.
- `company.updateSettings({ lengthUnit?: "mm" | "inch"; timezone?: string })` → `{ settings }`; `actionProcedure("settings.update")`; validates timezone with `Intl.supportedValuesOf("timeZone")`; merges into existing JSON; audit row `company.settings.update`.

- [ ] **Step 1: Write tests:** packed/dispatched counts respect an `Asia/Kolkata` day (a bundle created 23:30 IST yesterday is excluded; 00:10 IST today included); cross-tenant data never counted; `getBySerial` lower-case input finds the bundle, other company's serial → NOT_FOUND; `updateSettings` by manager → FORBIDDEN, by admin → persists and `auth.me` reflects it; bad timezone → BAD_REQUEST.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(server): dashboard.today, bundle.getBySerial, company.updateSettings`.

### Task 9: Local dev tooling + rich seed

**Files:**
- Already created (commit them here): `apps/server/wrangler.local.jsonc`, `apps/server/package.json` scripts `dev:local`, `dev:local:migrate`.
- Modify: `apps/server/src/dev-seed.ts`
- Create: `docs/LOCAL_DEV.md`, `apps/web/.env.example`, `apps/native/.env.example`

- [ ] **Step 1:** Extend seed (idempotent, dev only) to: 12 dies with fourcubes-like names (`Patti 1" × 1/8"` 14701 2.4–2.6 kg/12ft, `Angle 1" × 1"` 11250, `Tee 1¼"` 13090, `Channel ¾"` 12212, …) with `weightMinG/MaxG` set per 12 ft; 6 customers (KD Extrusion, Royal Aluminium, Tejura & Sons, Shivam Bhavnagar, Apex Fabricators, Mehta Windows) with addresses; 8 packing sessions over the last 10 days (incl. 2 today) totalling ~120 bundles with realistic weights (40–60 kg, 18–24 pcs, 12 ft); dispatches: 1 draft with 6 bundles, 1 held with 10, 2 completed with packing lists (one today); 3 bundles void; company `settings.lengthUnit = "inch"`, `timezone = "Asia/Kolkata"`, modules all on; `owner`, `operator`, `viewer` local users created if missing (passwords from `ORRN_LOCAL_PASSWORD` env or generated and printed once).
- [ ] **Step 2:** Write `docs/LOCAL_DEV.md`: migrate, run server (`bun run --cwd apps/server dev:local`), web (`bun run --cwd apps/web dev:bare -- --port 3002`), seed (`curl -XPOST localhost:3000/dev/seed`), test accounts location (`apps/server/.dev.local-account.local`, gitignored).
- [ ] **Step 3: Verify:** reset local D1 (`rm -rf apps/server/.wrangler/state`), migrate, start, seed → `curl` returns `ok:true`; `dashboard.today` via web shows non-zero numbers (checked in Task 19).
- [ ] **Step 4: Commit** `chore(dev): local wrangler stack and realistic seed`.

---

## Phase B — Design system

### Task 10: Dependencies, tokens and fonts

**Files:**
- Modify: `apps/web/package.json`, `packages/ui/package.json` (react → peerDependency, N9), `apps/native/package.json`, `packages/ui/src/tokens.ts`, `packages/ui/src/styles/globals.css`, `apps/native/tailwind.config.js`, `apps/native/global.css`, `apps/web/src/main.tsx` (font imports)
- Remove deps: `@hookform/resolvers`, `dotenv` (web), `@types/xlsx`; native: `@gorhom/bottom-sheet`, `react-native-svg` (if unused after audit check), `expo-network`, `expo-web-browser`, `tailwind-merge`, `dotenv`. Add per Global Constraints. Align `lucide-react` to one version.

**Interfaces (Produces):** `tokens.ts` exports `colors` (`canvas, surface, ink, inkMuted, hairline` × `light|dark`), `tones: Record<StatusTone, { from: string; to: string; tint: string; ink: string; onBlock: string }>` with values from spec §2, `radius { input:12, card:16, block:22, hero:26, pill:9999 }`, `space` (4-pt scale), `type { display1:52, display2:44, display3:34, title:22, body:15, bodyTouch:16, small:13, micro:11 }`, `motion { fast:150, base:250, slow:400, springPop: "cubic-bezier(.2,.9,.3,1.35)", easeOut: "cubic-bezier(.16,1,.3,1)" }`, `touch { min:44, primary:56 }`. CSS vars in `globals.css` named `--c-canvas`, `--c-surface`, `--c-ink`, `--c-ink-muted`, `--c-hairline`, `--tone-<tone>-from|to|tint|ink`, with dark values under `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`; Tailwind v4 `@theme` maps them to `bg-canvas`, `text-ink`, `bg-tone-green`, etc. Native Tailwind config mirrors the same names (fixes N8 undefined classes).

- [ ] **Step 1:** `bun install`; `bun run check-types` passes.
- [ ] **Step 2: Write `packages/ui/src/tokens.test.ts`:** every tone has 5 keys; `onBlock` contrast ≥ 4.5 against the tone's `from` (small WCAG helper in the test).
- [ ] **Step 3:** Implement tokens/CSS/native config; fonts imported once in `main.tsx` and loaded via `useFonts` in native root.
- [ ] **Step 4: Run** tests + `check-types` → PASS.
- [ ] **Step 5: Commit** `feat(ui): C2 tokens, fonts, dependency cleanup`.

### Task 11: `@orrn/i18n` package + guides

**Files:**
- Create: `packages/i18n/{package.json,src/index.ts,src/en.ts,src/hi.ts,src/use-t.ts,src/guides/types.ts,src/guides/en.ts,src/guides/hi.ts,src/parity.test.ts}`
- Create: `docs/superpowers/review/hindi-review.md` (list of every Hindi string with English source for Lalubhai), `docs/superpowers/review/owner-questions.md` (Q1–Q4 from spec §9 as WhatsApp-ready MCQs)

**Interfaces (Produces):**
- `en` is a nested `as const` object; `type MessageKey` = dotted paths; `hi: Messages` must satisfy the same shape (`satisfies DeepStringRecord<typeof en>`).
- `createI18n(locale: "en" | "hi")`, React `I18nProvider({ locale, onLocaleChange, children })`, `useT(): { t(key: MessageKey, vars?: Record<string, string | number>): string; locale; setLocale }`. Interpolation `{name}`.
- Guides: `type Guide = { slug: GuideSlug; roles: CompanyRole[]; title: string; when: string; steps: { title: string; body: string }[]; problems: { title: string; fix: string }[] }`; `GUIDE_SLUGS = ["pack-session","reprint-label","scan-bundle","build-dispatch","hold-and-dispatch","void-bundle","edit-die","add-customer","invite-member","printer-trouble"] as const`; `getGuide(slug, locale): Guide`.
- Key namespaces (minimum): `common`, `nav`, `auth`, `welcome`, `today`, `pack`, `scan`, `stock`, `bundle`, `dispatch`, `packingList`, `dies`, `customers`, `printing`, `settings`, `guides`, `admin`, `marketing`, `errors`, `status`.

- [ ] **Step 1: Write `parity.test.ts`:** deep key sets of `en` and `hi` are equal; every `{var}` in an `en` string appears in the `hi` string; guide arrays have equal lengths per slug in both locales; no empty strings.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** strings for every screen in spec §3 (write English with `unslop` rules: plain verbs, no hype) and Hindi (Devanagari, English technical terms kept: bundle, die, dispatch, PO, kg). Guides follow spec §3.1, each 4–7 steps.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(i18n): English/Hindi messages and SOP guides`.

### Task 12: Web component library (C2)

**Files:**
- Create in `packages/ui/src/components/`: `status-block.tsx`, `big-number.tsx`, `action-tile.tsx`, `chip.tsx`, `page-header.tsx`, `empty-state.tsx`, `field.tsx` (Field, TextInput, NumberInput), `segmented-control.tsx`, `stepper.tsx`, `sheet.tsx` (rewrite), `combobox.tsx`, `responsive-list.tsx` (replaces data-table), `scan-field.tsx`, `how-to-button.tsx`, `motion.ts` (`useCountUp`, `usePrefersReducedMotion`, CSS keyframe class names `animate-pop|rise|shimmer|press`)
- Modify: `button.tsx` (pill variants `primary|secondary|danger|ghost`, sizes `md|lg`), `dialog.tsx`, `tabs.tsx`, `skeleton.tsx`, `sonner.tsx` restyle; delete `data-table.tsx`, `app-frame.tsx` unused exports, `table.tsx`/`checkbox.tsx` if unused after Phase D.
- Create: `apps/web/src/routes/__ui.tsx` (dev-only kitchen sink; `beforeLoad` throws notFound when `import.meta.env.PROD`)
- Modify: `apps/web/playwright.config.ts` — add an `e2e` project (`testDir: tests/e2e`) whose `webServer` starts the local stack (`bun run --cwd ../server dev:local` on 3000 after `dev:local:migrate`, `vite dev --port 3002 --strictPort`, then `POST /dev/seed`), keep the existing visual project; `apps/web/package.json` scripts `"test": "bun test src"`, `"test:e2e": "playwright test --project=e2e"`
- Test: `apps/web/tests/e2e/ui-kit.spec.ts`

**Interfaces (Produces):**
- `StatusBlock({ tone: StatusTone; title: string; meta?: string; value: number | string; unit?: string; progress?: number /*0..1*/; href?: string; onClick?(): void })`
- `BigNumber({ value: number; format?: (n: number) => string; countUp?: boolean })`
- `ActionTile({ tone: StatusTone | "ink"; title: string; hint?: string; icon: ReactNode; to: string })`
- `Chip({ tone: StatusTone; children })`
- `PageHeader({ title: string; subtitle?: string; actions?: ReactNode; back?: { to: string; label: string } })`
- `EmptyState({ title: string; body?: string; action?: ReactNode })`
- `Field({ label: string; hint?: string; error?: string; children })`, `NumberInput({ value: string; onValueChange(text: string): void; suffix?: string; decimal?: boolean })` (keeps raw text; `inputMode="decimal"`; never reformats while typing — W9)
- `SegmentedControl<T extends string>({ value: T; options: { value: T; label: string }[]; onChange(v: T): void })`
- `Stepper({ steps: string[]; current: number })`
- `Sheet({ open; onOpenChange; title: string; children; footer?: ReactNode })` — bottom sheet < 1024px, right panel ≥ 1024px (Radix Dialog underneath)
- `Combobox<T>({ value: T | null; onChange(v: T): void; search(q: string): Promise<{ value: T; label: string; hint?: string }[]>; placeholder: string; recent?: ... })` — server-side search (W8), debounced 200 ms
- `ResponsiveList<T>({ rows: T[]; columns: { key: string; header: string; cell(row: T): ReactNode; align?: "end"; hideOnPhone?: boolean }[]; rowHref?(row: T): string; total?: number; page?: { offset: number; limit: number; onChange(offset: number): void }; empty: ReactNode; loading?: boolean })` — `<table>` ≥ 1024px with real `<th>`, stacked rows below.
- `ScanField({ onScan(raw: string): void; placeholder: string; autoFocus?: boolean })` — Enter submits (wedge scanners), clears after submit.
- `HowToButton({ slug: GuideSlug })` opens `GuideSheet`.

- [ ] **Step 1: Write `ui-kit.spec.ts`** (Playwright, against `/__ui`): at 390/820/1280 widths no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`); buttons ≥ 44px tall and `size="lg"` ≥ 56px on 390 width; `NumberInput` typing `1.25` keeps `1.25`; `ResponsiveList` renders `<table>` at 1280 and no `<table>` at 390; axe: no serious/critical violations; reduced-motion emulation → no element has a running animation.
- [ ] **Step 2: Run** `bun run --cwd apps/web test:e2e -- ui-kit` → FAIL.
- [ ] **Step 3: Implement** components (Radix where it exists; Tailwind classes from Task 10 tokens; all strings via props, no hard-coded copy).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui): C2 component library and dev kitchen sink`.

---

## Phase C — Web infrastructure, shell, routes

### Task 13: Web session, guards and loading hygiene (W2, W3, W4, W11, W12, W13)

**Files:**
- Modify: `apps/web/src/shared/lib/guards.ts`, `shared/lib/impersonation.ts`, `shared/utils/trpc.ts`, `routes/__root.tsx`, `routes/_tenant.tsx`, `routes/_platform.tsx`, `routes/_authed.tsx`, `vite.config.ts` (remove pdf/xlsx/react manualChunks), `shared/components/user-menu.tsx` (moves into shell in Task 14)
- Create: `apps/web/src/shared/lib/safe-next.ts`, `apps/web/src/shared/components/tenant-cache-guard.tsx` (rewrite, mounted once in `__root.tsx`), `apps/web/src/shared/lib/exports.ts` (single lazy module: `downloadPackingListPdf`, `downloadPackingListXlsx` via `await import()`)
- Delete: `staff-sign-in-form.tsx`, `sign-up-form.tsx`, `shared/lib/urls.ts`, `packingListExport.ts`, `packingListXlsx.ts` shims
- Test: `apps/web/src/shared/lib/safe-next.test.ts`, `impersonation.test.ts` (bun test, happy-dom not needed), `apps/web/tests/e2e/session.spec.ts`

**Interfaces (Produces):**
- `safeNext(next: string | null | undefined, fallback: string): string` — returns `next` only if it starts with `/`, not `//` or `/\`, and parses to the same origin.
- `getImpersonation(): { companyId: string; expiresAt: number } | null` (drops expired), `setImpersonation(companyId, expiresAtIso)`, `clearImpersonation()`.
- `requireSession`, `requireCompanyMe`, `requirePlatformAdmin` now attached as layout `beforeLoad` and always `fetchQuery` `auth.me` with `staleTime: 30_000`; post-login redirect `homeFor(me): "/admin" | "/today" | "/welcome" | "/no-access"`.
- QueryClient defaults: `retry(count, err)` → false for tRPC 4xx; global `onError` → on `UNAUTHORIZED` clear cache + navigate `/login?next=<current>`; on FORBIDDEN with impersonation message → `clearImpersonation()` + reload.

- [ ] **Step 1: Write tests:** `safeNext("//evil.com","/today")==="/today"`, `safeNext("https://evil.com","/today")==="/today"`, `safeNext("/dispatch/1?x=2","/today")==="/dispatch/1?x=2"`, `safeNext("/\\evil","/today")==="/today"`; impersonation expiry drops stored value; e2e: signed-out visit to `/today` → `/login?next=%2Ftoday`; after sign-in lands on `/today`; corrupt impersonation value in sessionStorage → app still loads `/today` without loop; network log on `/` contains no `pdf-export`/`@react-pdf` request.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `bun run build` shows no chunk containing `@react-pdf` in `index.html` modulepreload list.
- [ ] **Step 5: Commit** `fix(web): safe redirects, session expiry, impersonation expiry, lazy exports`.

### Task 14: App shell (phone tabs, iPad rail, laptop sidebar, ⌘K, More)

**Files:**
- Create: `apps/web/src/shell/{app-shell.tsx,tab-bar.tsx,side-nav.tsx,more-menu.tsx,command-palette.tsx,nav-items.ts,language-toggle.tsx,skip-link.tsx}`
- Modify: `routes/_tenant.tsx`, `routes/_platform.tsx` (use shell with `variant: "tenant" | "godseye"`), `routes/__root.tsx` (I18nProvider, theme from system with override stored in localStorage `orrn.theme`)
- Delete: `shared/components/app-shell.tsx`, `staff-shell.tsx`, `mode-toggle.tsx`, `breadcrumbs.tsx`, `packages/ui/src/components/sidebar.tsx`, `app-frame.tsx`
- Test: `apps/web/tests/e2e/shell.spec.ts`

**Interfaces (Produces):**
- `nav-items.ts`: `TENANT_PRIMARY = [today, pack, stock, dispatch]`, `TENANT_MORE = [dies, customers, printing, guides, settings]`, `GODSEYE_NAV = [overview, companies, requests, staff]`; each `{ key; to; labelKey: MessageKey; icon; requires?: Action[]; module?: "customers" | "dies" | "bundles" | "dispatches" }`; `visibleItems(items, me): NavItem[]` filters by `canAny` **and** `me.company.modules` (empty modules array = all modules on).
- `AppShell({ variant, children })` renders `<header>`/`<nav aria-label>`/`<main id="main">`, skip link, impersonation banner, focuses `<main>` heading on route change.
- `CommandPalette` (⌘K / Ctrl+K / `/`): input → if `parseScan` gives a serial → `/b/:serial`; matches dispatch codes (`DSP-`) via `dispatch.listDispatches({search})`, dies via `die.list({search})`, customers via `customer.list({search})`, and pages from nav items.
- Tab bar: Today · Pack · Scan (raised, opens ScanSheet from Task 16) · Stock · Dispatch; hides on scroll down; all `Link` (no `<a href>` reloads).

- [ ] **Step 1: Write `shell.spec.ts`:** at 390: tab bar visible with 5 items, avatar opens More with Dies/Customers/Printing/Guides/Settings; navigating Today→Stock does not reload (a `window.__orrnBoot` marker set at boot survives); at 820: icon rail visible, no tab bar; at 1280: sidebar with labels and "⌘K"; viewer role has no Pack tab action tiles but sees Stock; company with modules `["customers"]` hides Dies/Dispatch; skip link moves focus to main; ⌘K + typing `BG-000001-B001` + Enter opens `/b/BG-000001-B001`; Godseye uses violet `--tone-violet` and admin nav.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): responsive C2 shell with tabs, rail, sidebar and command palette`.

### Task 15: Route map and redirects

**Files:**
- Create: `apps/web/src/shared/lib/redirects.ts` + `redirects.test.ts`; new route files: `routes/_tenant/today.tsx`, `pack.index.tsx`, `pack.new.tsx`, `pack.$id.tsx`, `stock.index.tsx` (rewrite), `stock.$dieId.tsx`, `stock.bundles.tsx`, `b.$serial.tsx`, `dispatch.index.tsx`, `dispatch.new.tsx`, `dispatch.$id.tsx`, `printing.tsx`, `guides.index.tsx`, `guides.$slug.tsx`, `settings.tsx`; `routes/_authed/welcome.tsx`; `routes/_public/request-access.tsx`; `routes/_platform/admin.requests.tsx`. (Screens are stubs rendering `PageHeader` until their tasks.)
- Convert to redirect-only files: `dashboard.tsx`, `receipts.*`, `bundles.*`, `dispatches.*`, `packing-lists.$id.tsx`, `spool.index.tsx`, `settings.members.tsx`, `_authed/setup-credentials.tsx`, `onboarding.tsx`, `change-password.tsx`, `_public/waitlist.tsx`, `_platform/admin.waitlist.tsx`, `admin.spool.index.tsx`.

**Interfaces (Produces):** `STATIC_REDIRECTS: Record<string, string>` (spec §3.2 exact pairs, except `/setup-credentials` → `/welcome?magic=1`); `resolveRedirect(pathname: string, search: string): string | null` handles params (`/receipts/abc` → `/pack/abc`, `/dispatches/x` → `/dispatch/x`, `/settings/members` → `/settings?tab=team`); id→serial (`/bundles/$id`) and PL→dispatch (`/packing-lists/$id`) resolve in the route's loader via `bundle.getBundle` / `packingList.get`.

- [ ] **Step 1: Write `redirects.test.ts`** covering every row of spec §3.2 incl. query preservation (`/bundles?status=void` → `/stock/bundles?status=void`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; regenerate `routeTree.gen.ts` via `bun run --cwd apps/web build`.
- [ ] **Step 4: Run** tests + `check-types` → PASS.
- [ ] **Step 5: Commit** `feat(web): simplified route map with redirects for every old URL`.

### Task 16: Scan (web)

**Files:**
- Create: `apps/web/src/features/scan/{scan-sheet.tsx,camera-scanner.tsx,use-resolve-scan.ts,scan-context.tsx}`
- Test: `apps/web/tests/e2e/scan.spec.ts`

**Interfaces (Produces):**
- `ScanProvider` (in tenant layout) + `useScan(): { open(mode?: ScanMode): void }`; `type ScanMode = { kind: "lookup" } | { kind: "dispatch"; dispatchId: string; onAdded(report): void }`.
- `CameraScanner({ onDetect(raw: string): void })` — uses `window.BarcodeDetector` if present, else `await import("barcode-detector/ponyfill")`; formats `qr_code`, `code_128`; explains permission before calling `getUserMedia`; 1.5 s de-dupe window per value.
- `useResolveScan()` → `resolve(raw): Promise<{ ok: true; bundle } | { ok: false; reason: "not_found" | "unrecognised" }>` via `parseScan` + `bundle.getBySerial`.
- Lookup mode → navigates to `/b/:serial` (sheet closes). Dispatch mode → calls `dispatch.addBundlesBySerial({ dispatchId, serials:[serial] })`, shows `pop` row + running count; "already in this dispatch" is a neutral toast (Review Focus 1).

- [ ] **Step 1: Write `scan.spec.ts`** using the manual `ScanField` (camera not available in CI): lookup of a seeded serial in lower case opens bundle page; unknown serial shows "Not found in this company"; dispatch mode adds a bundle, second identical scan shows "Already in this dispatch" and count stays.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): camera and wedge scanning with context-aware actions`.

---

## Phase D — Web screens

Each screen task: (1) write the Playwright spec named below (runs at 390 and 1280, light; asserts the listed behaviour, no overflow, axe no serious/critical); (2) run → FAIL; (3) implement with Task 12 components, `t()` strings, `@orrn/domain` formatting, `<Can>` on mutations, `HowToButton` where listed; (4) run → PASS; (5) commit. Only the decisions are listed.

### Task AN-2: Chart kit (analytics addendum)

**Spec:** `docs/superpowers/specs/2026-10-03-orrn-analytics-addendum.md` §2 (A1–A4) and §4 chart kit. **Rules:** dataviz skill at `/private/tmp/claude-501/bundled-skills/2.1.286/2cebe3d6bc2035b3958410c0eed96bb0/dataviz/` (read SKILL.md and every reference file before writing chart code; run `scripts/validate_palette.js` for light and dark).

**Files:** `packages/ui/src/charts/{chart-card.tsx,time-series-chart.tsx,bar-chart.tsx,ranked-bars.tsx,sparkline.tsx,chart-table.tsx,scales.ts,index.ts}`, `packages/ui/src/tokens.ts` (`chartCategorical`, `chartSequential`, light + dark), `packages/ui/src/charts/palette.test.ts`, `/__ui` kit section, `apps/web/tests/e2e/charts.spec.ts`; deps `d3-scale`, `d3-shape`, `d3-array` (+ types) in packages/ui.

**Interfaces (Produces):** `ChartCard({ title, subtitle?, controls?, legend?: { label; color }[], table: { columns; rows }, state?: "loading" | "empty" | "error", children })`; `TimeSeriesChart({ series: { key; label; points: { t: Date; v: number }[] }[], kind: "line" | "area", format(v): string, height? })`; `BarChart({ data: { key; label; value }[], format, height? })`; `RankedBars({ rows: { key; label; value; share?: number; movement?: number | null }[], format, other?: number })`; `Sparkline({ points: number[], label: string })`. Categorical palette never uses the C2 status tones; series colour follows the series key (stable), never rank.

- [ ] Tests (Playwright on /__ui + bun): palette validator passes light and dark; each chart has a working "Show table" view with the same numbers; tooltips reachable by keyboard and pointer; legend present for ≥2 series; no element identifies a series by colour alone; axe clean; reduced motion = no animation; layout guards at 375/820/1280; charts are lazy (not in the entry chunk — modulepreload check still passes).
- [ ] Commit `feat(ui): accessible chart kit for analytics`.

### Task 17: Front door — login, request access, invite, welcome, no-access

**Files:** `routes/_public/login.tsx`, `request-access.tsx`, `invite.$token.tsx`; `routes/_authed/welcome.tsx`, `no-access.tsx`; `features/auth/{sign-in-form.tsx,welcome-steps.ts}`; delete `shared/components/auth-screen.tsx`, `force-password-change-form.tsx` (logic folds into welcome). Test: `tests/e2e/front-door.spec.ts`.
- `welcomeSteps(me): ("password" | "twoFactor" | "company")[]` — password if `mustChangePassword` or arrived via magic link (`?magic=1` set by the setup-credentials redirect); twoFactor if magic-link owner and `!twoFactorEnabled`; company if role ∈ {owner, admin} and `!onboardingCompleted`. Unit-test this function (bun test) for the four user types.
- Login: TOTP step kept; uses `safeNext`; language toggle; laptop split panel with animated StatusBlocks (reduced-motion static).
- Invite: generic copy (no new procedure; the token is only validated on accept); handles Better Auth `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` by switching to sign-in (N4 parity on web).
- Spec asserts: bad password shows inline error; `next` honoured; request-access success state; seeded user with `mustChangePassword` sees only the password step.

### Task 18: Marketing hero `/`

**Files:** `routes/_public/index.tsx`; `features/marketing/{hero.tsx,flow.tsx,floor.tsx,office.tsx,trust.tsx,cta.tsx,footer.tsx,marketing-header.tsx,use-gsap.ts}`; delete old `sections/*`. Test: `tests/visual/public.spec.ts` (regenerate snapshots) + `tests/e2e/marketing.spec.ts`.
- Copy from `t("marketing.*")`, headline "Every bundle, accounted for.", no invented metrics (numbers on the visual are labelled demo UI with `aria-hidden` decoration and a visible "Demo data" micro-label).
- GSAP only: hero tiles float-in, scroll-linked flow highlights; `prefers-reduced-motion` → static. Lighthouse-ish budget: `/` JS (excluding fonts) < 250 kB gzip measured from build output in the spec.
- Spec asserts: CTA links go to `/request-access` and `/login`; signed-in owner visiting `/` is redirected to `/today`; no overflow at 390.

### Task 19: Today

**Files:** `routes/_tenant/today.tsx`, `features/today/{kpis.tsx,open-dispatches.tsx,recent-sessions.tsx,start-here.tsx}`. Test: `tests/e2e/today.spec.ts`.
- Data: `dashboard.today` (all roles) plus, for `analytics.view` only, `analytics.trends` (90-day packed vs dispatched TimeSeriesChart) and `analytics.stockAgeing` (BarChart) from the analytics addendum. KPI blocks with `BigNumber countUp`. Action tiles: Pack (`bundle.create`), Dispatch (`dispatch.create` or `dispatch.addBundle`), Stock (all), Guides (all). Start-here checklist when company has 0 dies or 0 bundles.
- Spec asserts: seeded numbers match a direct `dashboard.today` call; viewer sees no Pack tile; empty company shows checklist.

### Task 20: Pack — list, new, session detail

**Files:** `routes/_tenant/pack.index.tsx`, `pack.new.tsx`, `pack.$id.tsx`; `features/pack/{die-step.tsx,bundles-step.tsx,review-step.tsx,use-pack-draft.ts,print-labels.ts}`. Test: `tests/e2e/pack.spec.ts`.
- `usePackDraft()` state `{ dieId; defaults: { lengthMm: number; po?: string }; bundles: { weightG: number; pieces: number; lengthMm?: number; po?: string }[] }` persisted to `sessionStorage` key `orrn.packDraft` so a reload doesn't lose work.
- Bundle card: Weight (kg, decimal) → Pieces → Enter saves and opens next; live `kgPer12ft` + Chip green/amber vs die range (`weightMinG/MaxG` per 12 ft, spec Q1); "Different length / PO" toggle.
- Save: `bundle.createReceipt({ dieId, unit: company lengthUnit, purchaseOrderRef, rows })`; then if `spool.deploymentStatus` active and user can `spool.create_jobs`, print each via `spool.printBundleLabel` sequentially with progress; failures listed with retry.
- `HowToButton slug="pack-session"`.
- Spec asserts: create a 40-bundle session (Review Focus 2) using keyboard only; amber chip appears for an out-of-range bundle; inch company enters 11 ft 6 in once and all bundles store 3505 mm (check on detail page "11 ft 6 in"); reload mid-session keeps drafted bundles.

### Task 21: Stock — sections, section, all bundles, bundle detail

**Files:** `routes/_tenant/stock.index.tsx`, `stock.$dieId.tsx`, `stock.bundles.tsx`, `b.$serial.tsx`; `features/stock/{section-blocks.tsx,bundle-hero.tsx,bundle-timeline.tsx,add-to-dispatch-sheet.tsx}`. Test: `tests/e2e/stock.spec.ts`.
- For `analytics.view`: stock ageing BarChart + top sections RankedBars (analytics addendum §4).
- Sections from `stockSummary({status:"available"})` + `stockSummary({status:"reserved"})` merged per die; sort by kg/A–Z; search client-side over loaded sections.
- Bundles list: server paging via `listBundles({status, search, limit:50, offset})`, debounced search with `placeholderData: keepPreviousData` (W15), status chips.
- Bundle page via `getBySerial`; actions: Add to dispatch (sheet lists `listDispatches({status:"draft"})`), Reprint, Void/Restore with reason. `HowToButton` `reprint-label` / `void-bundle`.
- Spec asserts: section block counts equal seed; status filter `void` shows 3; paging beyond 50 works; void then restore round-trip; weights in kg (no "g" suffix anywhere on the page: `expect(page.getByText(/\d g\b/)).toHaveCount(0)`).

### Task 22: Dispatch — list, new, build/hold/dispatch, packing list

**Files:** `routes/_tenant/dispatch.index.tsx`, `dispatch.new.tsx`, `dispatch.$id.tsx`; `features/dispatch/{dispatch-header.tsx,build-step.tsx,paste-serials-sheet.tsx,hold-step.tsx,complete-sheet.tsx,packing-list-view.tsx,group-items.ts}`; modify `packages/documents/src/packing-list/{xlsx.ts,types.ts}` and `apps/web/src/shared/lib/packingListPdf.tsx` (W5, W6, W17). Test: `tests/e2e/dispatch.spec.ts`, `packages/documents/src/packing-list/xlsx.test.ts`.
- For `analytics.view`: dispatch list shows a monthly volume BarChart (`analytics.dispatchVolume`).
- `groupItems(items): { key: string; label: string; dieLabel: string; bundles: Item[]; weightG: number; pieces: number }[]` — group by `groupLabel` else die (never receipt id).
- Action availability from `dispatchActions(status)` (Task 7); overflow menu holds Cancel/Delete.
- Paste sheet uses `splitPastedSerials`, sends in chunks of 100, shows the server report (added / already / not found / unavailable with reasons).
- Packing list view: header (company name, customer, PL code, dispatch code, date, ship date, totals "N bundles · X kg"), columns Sr · Bundle no · Item · Weight kg · Cut length ft · Cut length in · Pcs · kg/12ft · Weight range /12'; parse the snapshot once with a zod schema (W17). Exports via `exports.ts` lazy module; XLSX numeric cells, ISO dates; no `totalLengthM` anywhere (S12/W7).
- `HowToButton` `build-dispatch` / `hold-and-dispatch`.
- Spec asserts: new dispatch → paste 10 seeded serials → hold → dispatch → PL shows 10 rows and correct kg total; duplicate paste reports "already in this dispatch"; viewer sees no mutation buttons; PDF download triggers a download event and the `@react-pdf` chunk loads only then. xlsx unit test: weight/length cells are numbers, group column never contains a UUID pattern.

### Task 23: Dies and Customers

**Files:** `routes/_tenant/dies.index.tsx`, `dies.$id.tsx`, `customers.index.tsx`, `customers.$id.tsx`; `features/dies/die-form.tsx`, `features/customers/customer-form.tsx`. Test: `tests/e2e/catalog.spec.ts`.
- Die form: weight range edited in kg/12ft (`kgToG` on save), geometry under Advanced with `NumberInput` in company unit, only changed fields sent (N6 parity). Conflict message for deleted-die codes (S16).
- Customer detail is view-first per the analytics addendum §4: header (last dispatch, cadence), KPI tiles, monthly volume chart, top sections, recent dispatches, open orders/baki when available, Edit as a secondary sheet; charts only with `analytics.view`. Customers list shows the leaderboard card (period control, RankedBars with movement) for `analytics.view`. Customer form adds billing/shipping address fields the server already accepts.
- Lists: server search + paging. `HowToButton` `edit-die` / `add-customer`.
- Spec asserts: inch company opens a die with 10 mm thickness and saves untouched → still 10 mm; customer address persists; deleted die code shows the conflict message.

### Task 24: Printing and Settings

**Files:** `routes/_tenant/printing.tsx`, `settings.tsx`; `features/printing/{queue-tab.tsx,printers-tab.tsx,labels-tab.tsx,advanced-job-sheet.tsx}`, `features/settings/{company-tab.tsx,team-tab.tsx,printing-tab.tsx,data-tab.tsx}`. Test: `tests/e2e/settings.spec.ts`.
- Tabs via `?tab=` search param. Company tab: length unit + timezone (`company.updateSettings`, `<Can do="settings.update">`). Team tab: members/roles/invites (existing procedures; owner rows not editable by admins — matches S4). Printing tab: deployment status + printers. Data tab: imports (Task 25).
- Printing page restricted/no-deployment states with one next step. `HowToButton` `printer-trouble` / `invite-member`.
- Spec asserts: admin switches unit to mm → Pack inputs show mm; manager sees Company tab read-only; admin cannot change owner role in UI.

### Task 25: Import parser and Data tab (W1, W10)

**Files:** Create `apps/web/src/features/imports/{parse.ts,parse.test.ts,import-sheet.tsx}`; delete `shared/components/import-*-modal.tsx`.

**Interfaces (Produces):** `parseImport(kind: "bundles" | "dies" | "customers", rows: Record<string, string>[], ctx: { companyUnit: "mm" | "inch" }): { ok: ParsedRow[]; rejected: { row: number; reason: string }[] }` — unit comes from the column header (`Length (mm)`, `Length (in)`, `Length (ft)`, `Weight (kg)`, `Weight (g)`), falling back to the company unit only for unit-less headers; uses `parseDecimal`.
- [ ] Tests: mm sheet into inch company → 3658 stays 3658 (Review Focus 4); `Length (in)` 144 → 3658; blank weight row rejected with reason; `1e3` rejected.
- [ ] UI: drag-and-drop sheet showing ok/rejected counts before submit; submits in chunks of 500 (server max 2000).

### Task 26: Guides and HowTo

**Files:** `routes/_tenant/guides.index.tsx`, `guides.$slug.tsx`; `packages/ui/src/components/how-to-button.tsx` wiring `GuideSheet` to `getGuide`. Test: `tests/e2e/guides.spec.ts`.
- Index filters guides by the user's role; slug page renders steps as numbered blocks; Hindi toggle switches content instantly.
- Spec asserts: all 10 slugs render in en and hi; HowTo on `/pack/new` opens `pack-session`.

### Task 27: Godseye

**Files:** `routes/_platform/admin.index.tsx`, `admin.companies.index.tsx`, `admin.companies.$id.tsx` (tabs plan/printing/access), `admin.requests.tsx`, `admin.staff.tsx`; `features/admin/*` (move spool deployment UI from `admin.spool.index.tsx` into `features/admin/company-printing-tab.tsx`). Test: `tests/e2e/godseye.spec.ts`.
- Violet tone via `variant="godseye"`; impersonate → `setImpersonation` with `expiresAt` → `/today` with banner; stop → revoke + `clearImpersonation`.
- Seed adds a local platform staff user (super_admin) for this spec.
- Spec asserts: approve a request; create spool deployment on a company's Printing tab; impersonate and stop.

---

## Phase E — Native

### Task 28: Native foundation (N1–N3, N5, N9, N10, N13–N15)

**Files:**
- Modify: `apps/native/app.json` (bundle ids `in.orrn.app`, icon/splash from `assets/`, plugins `expo-camera` with `cameraPermission` text, `expo-font`, `expo-localization`), `babel.config.js` (remove duplicate reanimated plugin), `tailwind.config.js` (content globs incl. `lib/`, `features/`; tokens from Task 10), `packages/env/src/native.ts` (explicit `process.env.EXPO_PUBLIC_SERVER_URL`), `lib/auth-client.ts` (`twoFactorClient`), `utils/trpc.ts` (retry policy like web)
- Replace: `app/_layout.tsx` (fonts, I18nProvider with locale from SecureStore `orrn.locale`, QueryClient, auth gate, cache guard on `me.company.id` using `resetQueries`), delete `app/(drawer)/**`
- Create: `app/(auth)/sign-in.tsx` (email/password + TOTP), `app/(tabs)/_layout.tsx` (Tabs: today, pack, scan, stock, dispatch; centre Scan button), per-tab stacks `app/(tabs)/{today,pack,stock,dispatch}/_layout.tsx`, `app/more/_layout.tsx`
- Delete: `components/sign-up.tsx`, `components/theme-toggle.tsx`, `contexts/*`, `lib/edge-node-store.ts`, `components/impersonation-banner.tsx`, `packages/ui/src/components/impersonation-banner.native.tsx`, `not-found.native.tsx`, `toaster-native.tsx`, `utils/navigation.ts`, `components/container.tsx`, template logo assets, unused deps
- Test: `apps/native/__tests__/gate.test.ts` (bun test for `routeForMe(me): "/(auth)/sign-in" | "/(tabs)/today" | "/no-access"`)

- [ ] Steps: write gate test → fail → implement → `bun run --cwd apps/native check-types` and `bunx expo export --platform ios --output-dir /tmp/orrn-export` (outside repo) succeed → commit `feat(native): tab shell, auth gate, 2FA, config fixes`.

### Task 29: Native components and screens

**Files:**
- Create `apps/native/components/ui/{status-block.tsx,big-number.tsx,button.tsx,chip.tsx,field.tsx,number-input.tsx,segmented-control.tsx,sheet.tsx,empty-state.tsx,page-header.tsx,list-row.tsx,how-to-button.tsx}` (Reanimated `pop/rise/press`, `expo-haptics` on success/error, reduced-motion respected)
- Screens: `(tabs)/today/index.tsx`; `(tabs)/pack/{index,new,[id]}.tsx`; `(tabs)/scan.tsx` (modal camera via `expo-camera` `CameraView` `barcodeScannerSettings={{ barcodeTypes: ["qr","code128"] }}`, torch, 1.5 s de-dupe, lookup/dispatch modes like web); `(tabs)/stock/{index,[dieId],bundles}.tsx`, `b/[serial].tsx`; `(tabs)/dispatch/{index,new,[id]}.tsx` (+ packing list share via existing `lib/packing-list-export.ts` with correct UTI `com.adobe.pdf` / `org.openxmlformats.spreadsheetml.sheet`); `more/{index,dies,dies/[id],customers,customers/[id],guides,guides/[slug],settings}.tsx`; `invite/[token].tsx` (N4: handle `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, check invite before sign-up)
- Reuse `@orrn/domain`, `@orrn/i18n`, `can()`.
- Test: Maestro `.maestro/flows/{sign-in.yaml,pack.yaml,dispatch-paste.yaml}` replace old flows (run only if a simulator is available; otherwise validated by `expo export`).

- [ ] Steps: implement per screen → `check-types` + `expo export` for ios and android pass → if `xcrun simctl list devices booted` shows a device, build with `npx expo run:ios` and run Maestro flows → commit per screen group (`feat(native): today and pack`, `… scan and stock`, `… dispatch`, `… more and invite`).

---

## Phase F — Verification, docs, ship

### Task 30: End-to-end suite and visual QA

**Files:** `apps/web/playwright.config.ts` (projects: phone 390×844, ipad 820×1180, laptop 1280×800 × light/dark; `webServer` entries start local wrangler + vite + seed), `apps/web/tests/e2e/journey.spec.ts`, `apps/web/tests/e2e/fixtures.ts` (login helpers per role reading `apps/server/.dev.local-account.local`).
- [ ] `journey.spec.ts`: owner signs in → Today → Pack 40 bundles → Stock shows them → Dispatch new → paste 12 serials (crosses old 12-bundle limit) → hold → dispatch → PL totals match → download PDF and XLSX; operator journey: pack + scan into an existing draft, cannot complete; viewer: read-only everywhere.
- [ ] Global checks on every route in the map: no horizontal overflow at all three widths, axe no serious/critical, no console errors.
- [ ] Run full suite: `bun run test` (all unit) and `bun run --cwd apps/web test:e2e` → PASS. Capture before/after screenshots into `docs/superpowers/review/screens/` for the PR.
- [ ] Commit `test: end-to-end journeys across devices and roles`.

### Task 31: Docs and repo hygiene

**Files:** `AGENTS.md` (stack line: shadcn/Radix + NativeWind, not Tamagui; test commands; local dev; `actionProcedure` rule; ≤100 params rule; i18n rule), `DESIGN.md` (rewrite to C2 tokens/components/motion), `TODO.md` (milestone status), `README.md` (screens, local dev link), `docs/superpowers/review/2026-10-03-audit.md` (mark each FIX row with its commit hash).
- [ ] Commit `docs: C2 design system, conventions and audit status`.

### Task 32: Review, merge, deploy

- [ ] Whole-branch review (superpowers:requesting-code-review) on `main...redesign/c2`; fix confirmed issues.
- [ ] `bun run check-types && bun run test && bun run build && bun run --cwd apps/web test:e2e` all green.
- [ ] Push branch, open PR to `main` with screenshots and the audit summary; merge (fast-forward or merge commit, no squash of history needed).
- [ ] Watch `Deploy Dev` (`gh run watch`) → green; smoke: `https://dev.orrn.app/` renders new hero, `/login` renders, `/dashboard` redirects to `/today` (→ login), API `https://api.dev.orrn.app/` returns `OK`.
- [ ] Fast-forward `prod` to `main` and push; watch `Deploy Production` → green; same smoke on `https://orrn.in`.
- [ ] Report: what shipped, what's flagged (S6 residual, S9, S10, S20, Q1–Q4), Hindi review list, native needs an EAS build.
