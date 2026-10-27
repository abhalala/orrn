# Reformed ORRN Spool and Label Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared legacy/Edge printing core with refined A/B/C labels, a tenant label studio, and safe MAC-locked printer recovery.

**Architecture:** Add one versioned label document and validation pipeline shared by TypeScript and Go. Keep `cmd/spool` as the legacy composition root and `cmd/orrn-edge` as the V1 runtime, with the same TSPL2 rendering and printer behavior. Add draft/publish APIs, an accessible studio, read-only capability discovery, and evidence-based DHCP recovery.

**Tech Stack:** TypeScript, Bun, Zod, Drizzle/D1, React/TanStack Query, Go 1.22, modernc SQLite, Playwright, fake TA220 TCP server.

**Spec:** `docs/superpowers/specs/2026-10-27-reformed-spool-design.md`

## Global Constraints

- `LABEL_VARIABLES` is closed; never add `uuid`, `id`, or `bundleId`. Bundle QR content uses only the frozen `qr` value.
- Coordinates/sizes use at most two decimal millimetres, deterministic DPI conversion, and CRLF. Maximum 64 elements and 64 KiB rendered TSPL.
- `spool.push_templates` authorizes publish; all reads/writes derive `companyId` from authenticated context.
- Preserve `cmd/spool` legacy compatibility and all current job invariants. Never redirect after the first device byte or blindly retry `outcome_unknown`.
- D1 multi-writes use `atomicBatch`; migrations are additive and consecutive. Never edit a shipped migration.
- No automatic `AUTO.BAS`, factory reset, firmware update, `IgnorePrinterResponse`, calibration, download, or production migration.
- Do not change live Agni, CT 130, legacy spool credentials, or production Cloudflare resources without a separate explicit request.

## Review Focus

- Forbidden identifiers or arbitrary TSPL enter QR/static content: Task 1 rejects them with exact errors.
- Decimal/DPI conversion and quiet zones produce unreadable labels: Task 2 checks exact geometry and scanner-oriented output.
- Cross-tenant or unauthorized draft/publish changes leak business data: Task 3 tests permissions and server-derived values.
- DHCP/ARP changes redirect work incorrectly: Task 6 requires MAC + status proof and never redirects after byte one.
- Preview or service health is mistaken for physical/native readiness: Task 9 requires physical label and native lifecycle evidence.

---

### Task 1: Versioned label document and A/B/C built-ins

**Files:**
- Create: `packages/domain/src/label-document.ts`
- Create: `packages/domain/src/label-document.test.ts`
- Create: `packages/domain/src/builtin-labels.ts`
- Create: `packages/domain/src/builtin-labels.test.ts`
- Create: `internal/core/label_document.go`
- Create: `internal/core/label_document_test.go`

**Interfaces:**
- Consumes: `LABEL_VARIABLES`, TE200 profile limits from the spec.
- Produces: `LabelDocument`, `LabelPage`, `LabelElement`, `LabelIssue`, `validateLabelDocument(document, profile) []LabelIssue`, `operationsDense`, `polishedLabel`, `compactLabel`, and Go `ParseLabelDocument` / `ValidateLabelDocument` equivalents.

- [ ] **Step 1: Write failing contract tests**

Cover valid B/A/C documents and exact refusals for `uuid`, arbitrary TSPL, >64 elements, out-of-bounds geometry, unsupported font/symbology, bad rotation, invalid QR model/mask, and missing quiet zone. Include `qr` as the only bundle QR variable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd packages/domain test label-document` and `CGO_ENABLED=0 go test ./internal/core -run 'Test(Parse|Validate)LabelDocument' -v`.
Expected: FAIL because the types and validators do not exist.

- [ ] **Step 3: Implement the shared models, validators, and built-ins**

Use a versioned `LabelDocument` with page settings and an ordered `LabelElement[]`. Keep legacy schema JSON readable. Model B with serial + QR anchors, dense operational fields, two-column facts, and total weight at bottom-right; retain A and C without auto-publishing.

- [ ] **Step 4: Run the contract tests to verify they pass**

Run the Step 2 commands.
Expected: all label-document and built-in tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/label-document* packages/domain/src/builtin-labels* internal/core/label_document*
git commit -m "feat(labels): add validated label documents and built-ins"
```

### Task 2: Deterministic TSPL2 rendering and expanded symbologies

**Files:**
- Modify: `internal/core/tspl2_generator.go`
- Create: `internal/core/label_renderer.go`
- Create: `internal/core/label_renderer_test.go`
- Modify: `internal/edgeclient/render.go`

**Interfaces:**
- Consumes: Task 1 documents and built-ins.
- Produces: `RenderLabelDocument(document, variables) (string, error)` and `dots(mm float64, dpi int) (int, error)` for Go; `renderPrintJob` delegates to it.

- [ ] **Step 1: Write failing renderer fixtures**

Assert exact TSPL for B, decimal `SIZE`/`GAP`, half-up DPI rounding, `BARCODE`, `QRCODE`, `DMATRIX`, Aztec, MaxiCode modes 2–5, PDF417, Composite/RSS, line/box, variable escaping, and 64 KiB rejection. Include official syntax and CRLF.

- [ ] **Step 2: Run renderer tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/core ./internal/edgeclient -run 'TestRenderLabelDocument|TestDots' -v`.
Expected: FAIL because the renderer is absent.

- [ ] **Step 3: Implement the renderer and delegate legacy/Edge rendering**

Implement deterministic geometry and official TSPL2 commands. Preserve existing variable contracts, copies, and frozen payload behavior. Do not add MicroPDF417 or arbitrary TSPL.

- [ ] **Step 4: Run renderer and existing print tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/core ./internal/edgeclient -v`.
Expected: new and existing renderer tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/core/tspl2_generator.go internal/core/label_renderer* internal/edgeclient/render.go
git commit -m "feat(tspl): render validated labels deterministically"
```

### Task 3: Draft/publish API and migration `0044_label_studio`

**Files:**
- Modify: `packages/db/src/schema/printing.ts`
- Create: `packages/db/src/migrations/0044_label_studio.sql`
- Create: `packages/db/src/migrations/meta/0044_snapshot.json`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Create: `packages/server/src/lib/label-documents.ts`
- Modify: `packages/server/src/routers/spool.ts`
- Create: `packages/server/test/label-documents.test.ts`

**Interfaces:**
- Consumes: Task 1 documents and existing `labelTemplate`, `spool.push_templates`.
- Produces: `spool.labelDocuments.list`, `get`, `createDraft`, `updateDraft`, `publish`, and `clone`. Drafts use `draftSchema`; publish writes `schema`, increments `version`, and leaves queued jobs unchanged.

- [ ] **Step 1: Write failing API and migration tests**

Cover draft create/update, clone, publish version increments, forbidden fields, tenant isolation, permission refusal, and frozen payload/hash after later publish.

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `bun test packages/server/test/label-documents.test.ts`.
Expected: FAIL because draft columns and procedures are absent.

- [ ] **Step 3: Implement migration, validators, and procedures**

Add only `draft_schema` and `draft_updated_at` to `label_template`. Validate on draft update and publish. Use `atomicBatch` for publish and preserve existing `spool.push_templates` behavior for legacy callers.

- [ ] **Step 4: Run the API and server type tests to verify they pass**

Run: `bun test packages/server/test/label-documents.test.ts && bun run --cwd packages/server check-types`.
Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/printing.ts packages/db/src/migrations/0044_label_studio.sql packages/db/src/migrations/meta/0044_snapshot.json packages/db/src/migrations/meta/_journal.json packages/server/src/lib/label-documents.ts packages/server/src/routers/spool.ts packages/server/test/label-documents.test.ts
git commit -m "feat(labels): add tenant draft and publish workflow"
```

### Task 4: Accessible label studio editor

**Files:**
- Create: `apps/web/src/routes/_tenant/printing.templates.$templateId.tsx`
- Create: `apps/web/src/features/printing/label-studio.tsx`
- Create: `apps/web/src/features/printing/label-canvas.tsx`
- Create: `apps/web/src/features/printing/label-inspector.tsx`
- Create: `apps/web/src/features/printing/label-studio-model.ts`
- Create: `apps/web/src/features/printing/label-studio.test.ts`
- Create: `apps/web/tests/e2e/label-studio.spec.ts`

**Interfaces:**
- Consumes: Task 3 procedures and Task 1 document types/built-ins.
- Produces: studio route and `LabelEditor` with drag/resize/rotate, align/distribute/snap, zoom, duplicate/delete, layers, undo/redo, field insertion, inspector, preview, clone, and publish.

- [ ] **Step 1: Write failing model and browser tests**

Test editing, keyboard operation, undo/redo, alternate built-ins, invalid publish, accessible labels, and server-driven validation. Include 375/820/1280 widths and no clipped controls.

- [ ] **Step 2: Run model and Playwright tests to verify they fail**

Run: `bun run --cwd apps/web test label-studio` and, after sourcing worktree ports, `bunx playwright test --project=e2e tests/e2e/label-studio.spec.ts --retries=0` from `apps/web`.
Expected: FAIL because the route and editor do not exist.

- [ ] **Step 3: Implement the studio without custom TSPL injection**

Use TanStack Query and existing UI conventions. Keep route-entry code small so the route budget remains valid. Preview uses document geometry, not physical-readiness claims.

- [ ] **Step 4: Run unit, browser, build, and accessibility checks**

Run the Step 2 commands plus `bun run --cwd apps/web build`.
Expected: model/browser/build and accessibility checks pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_tenant/printing.templates.\$templateId.tsx apps/web/src/features/printing/label-* apps/web/tests/e2e/label-studio.spec.ts
git commit -m "feat(labels): add accessible tenant label studio"
```

### Task 5: Capability discovery and printer preferences `0045_printer_discovery`

**Files:**
- Create: `internal/printer/capabilities.go`
- Create: `internal/printer/capabilities_test.go`
- Modify: `internal/printer/target.go`
- Modify: `packages/db/src/schema/printing.ts`
- Create: `packages/db/src/migrations/0045_printer_discovery.sql`
- Create: `packages/db/src/migrations/meta/0045_snapshot.json`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/server/src/routers/spool.ts`
- Create: `packages/server/test/printer-discovery.test.ts`

**Interfaces:**
- Consumes: TE200 profile and actual device responses.
- Produces: normalized MAC/profile endpoint, discovered features, `INSTALLEDFEATURES` parsing, media/post-print preferences, and last-verified status evidence.

- [ ] **Step 1: Write failing discovery and preference tests**

Use a fake TA220 for `INSTALLEDFEATURES`, media, gap, DPI, speed, density, and optional cutter. Verify container health cannot set `lastSeenAt`; only genuine responses can.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/printer -run TestCapabilities -v` and `bun test packages/server/test/printer-discovery.test.ts`.
Expected: FAIL because discovery and preference persistence are absent.

- [ ] **Step 3: Implement read-only capability detection and migration**

Add normalized `mac_address`, verified endpoint, media/post-print preferences, and evidence timestamps. Do not activate optional hardware or rewrite desired config from unverified data.

- [ ] **Step 4: Run discovery tests to verify they pass**

Run the Step 2 commands and `bun run --cwd packages/server check-types`.
Expected: all discovery tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add internal/printer/capabilities* internal/printer/target.go packages/db/src/schema/printing.ts packages/db/src/migrations/0045_printer_discovery.sql packages/db/src/migrations/meta/0045_snapshot.json packages/db/src/migrations/meta/_journal.json packages/server/src/routers/spool.ts packages/server/test/printer-discovery.test.ts
git commit -m "feat(printers): add capability discovery and preferences"
```

### Task 6: MAC-locked DHCP recovery

**Files:**
- Create: `internal/printer/discovery_dhcp.go`
- Create: `internal/printer/discovery_dhcp_test.go`
- Create: `internal/printer/neighbors_unix.go`
- Create: `internal/printer/neighbors_windows.go`
- Modify: `internal/worker/worker.go`
- Modify: `internal/edgeclient/client.go`
- Modify: `packages/edge-runtime/src/index.ts`
- Modify: `packages/server/src/lib/edge-v1.ts`
- Create: `packages/server/test/edge-printer-endpoint.test.ts`

**Interfaces:**
- Consumes: Task 5 verified profile/MAC/status.
- Produces: `VerifyEndpoint(ctx, target) (EndpointEvidence, error)`, `printer_endpoint_verified` event, and worker redirection only for pre-byte eligible jobs.

- [ ] **Step 1: Write failing DHCP and redirection tests**

Cover IP change with valid MAC + status, MAC mismatch, delayed/partial status, unknown endpoint, unsupported model, no redirect after byte one, and no duplicate transmission.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/printer ./internal/worker ./internal/edgeclient -run 'TestVerifyEndpoint|TestDHCP' -v` and `bun test packages/server/test/edge-printer-endpoint.test.ts`.
Expected: FAIL because recovery is absent.

- [ ] **Step 3: Implement neighbor lookup, verification, and event ingestion**

Read ARP/neighbor state without Internet scanning. Require successful status + MAC match. Add the versioned event and persist endpoint evidence. Keep previous endpoint unavailable on proof failure.

- [ ] **Step 4: Run DHCP, race, and endpoint tests to verify they pass**

Run the Step 2 commands plus `CGO_ENABLED=1 go test -race ./internal/printer ./internal/worker`.
Expected: all endpoint and race tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/printer/discovery_dhcp* internal/printer/neighbors_* internal/worker/worker.go internal/edgeclient/client.go packages/edge-runtime/src/index.ts packages/server/src/lib/edge-v1.ts packages/server/test/edge-printer-endpoint.test.ts
git commit -m "feat(printers): recover verified endpoints after DHCP changes"
```

### Task 7: Audited administrator printer actions

**Files:**
- Create: `internal/printer/actions.go`
- Create: `internal/printer/actions_test.go`
- Modify: `packages/edge-runtime/src/index.ts`
- Modify: `packages/server/src/lib/edge-v1.ts`
- Modify: `packages/server/src/routers/spool.ts`
- Create: `packages/server/test/printer-actions.test.ts`

**Interfaces:**
- Consumes: discovered optional features and an administrator action command.
- Produces: `device_action` command with `calibrate`, `set_cutter`, `set_rtc`, or `download_font`; agent validates support and emits `device_action_result`.

- [ ] **Step 1: Write failing authorization and action-safety tests**

Verify unprivileged refusal, unsupported feature refusal, exact TSPL, audit history, and no automatic `AUTO.BAS`, reset, or `IgnorePrinterResponse`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/printer -run TestActions -v` and `bun test packages/server/test/printer-actions.test.ts`.
Expected: FAIL because actions are absent.

- [ ] **Step 3: Implement guarded commands and result events**

Validate every action against discovered features. Keep downloads explicit, bounded, and audited. Do not add firmware update or arbitrary file execution.

- [ ] **Step 4: Run action tests to verify they pass**

Run the Step 2 commands and server typecheck.
Expected: all action tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add internal/printer/actions* packages/edge-runtime/src/index.ts packages/server/src/lib/edge-v1.ts packages/server/src/routers/spool.ts packages/server/test/printer-actions.test.ts
git commit -m "feat(printers): add audited administrator actions"
```

### Task 8: Unified acceptance and physical label verification

**Files:**
- Modify: `cmd/orrn-edge/e2e_test.go`
- Create: `internal/core/physical_label_fixtures_test.go`
- Modify: `docs/FOURCUBES_CUTOVER.md`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: compiled-agent acceptance for B/A/C, studio smoke evidence, physical verification checklist, and operational documentation.

- [ ] **Step 1: Extend failing acceptance fixtures**

Add B/A/C compiled-agent proof, geometry/copy checks, DHCP proof, revocation, and physical-label evidence fields without claiming an unperformed check.

- [ ] **Step 2: Run acceptance to verify it fails before physical/native gaps are hidden**

Run: `CGO_ENABLED=0 go test ./cmd/orrn-edge -run 'TestLocalEdgeEndToEnd|TestPhysicalLabelFixtures' -v`.
Expected: FAIL for new acceptance paths; physical/native evidence remains explicitly pending until observed.

- [ ] **Step 3: Complete the shared acceptance and runbook**

Document exact physical B-label ruler/QR/barcode/copy checks, native Windows SCM, Linux systemd, Docker rollback, and ARM64/AMD64 execution gates. Keep live backup unchanged.

- [ ] **Step 4: Run full local verification and record only observed evidence**

Run full TypeScript/Go suites, race tests, typechecks, affected Playwright specs, release builds, and compiled-agent acceptance.
Expected: all local gates pass; physical/native items are recorded only after actual observation.

- [ ] **Step 5: Commit**

```bash
git add cmd/orrn-edge/e2e_test.go internal/core/physical_label_fixtures_test.go docs/FOURCUBES_CUTOVER.md README.md AGENTS.md
git commit -m "test(edge): verify reformed spool acceptance"
```

### Task 9: Final native lifecycle and production-readiness gate

**Files:**
- Modify: `.github/workflows/release-binaries.yml`
- Modify: `docs/FOURCUBES_CUTOVER.md`

**Interfaces:**
- Consumes: all implementation and local verification.
- Produces: native Windows SCM, Linux systemd, Docker rollback, and native AMD64 execution evidence before any production migration.

- [ ] **Step 1: Execute native lifecycle checks on authorized runners**

Run Windows install/start/stop/restart/recovery/upgrade/rollback/uninstall, Linux systemd install/reboot/upgrade/rollback, Docker both-architecture persistence and failed-candidate rollback, and native artifact version/checksum checks.

- [ ] **Step 2: Retain exact evidence or block cutover**

Record runner, artifact digest, service result, and rollback result. If any check is unavailable or fails, leave production migration blocked.

- [ ] **Step 3: Update the runbook with observed results**

Do not claim native readiness from cross-compilation, QEMU, or container health. Preserve the legacy backup and request a separate production decision.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-binaries.yml docs/FOURCUBES_CUTOVER.md
git commit -m "test(edge): verify native service lifecycle"
```
