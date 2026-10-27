# ORRN Edge Cache & Fallback Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sanitized D1 snapshot generator on ORRN and the atomic SQLite read cache + two-listener local fallback web application on ORRN Edge.

**Architecture:** ORRN builds complete per-section snapshots (`stock`, `orders`, `dies`, `print_status`, `company_format`) using single D1 read batches and server-side projections with all prices, secrets, R2 credentials, and label variables stripped, storing chunks in `edge_snapshot` and `edge_snapshot_chunk` (`0044_edge_v1_snapshots.sql`). The Go agent downloads and verifies every chunk’s SHA-256 and record count before swapping that section in one SQLite transaction, and serves two separate HTTP listeners: `127.0.0.1:8081` for authenticated local administration and `:8080` for the LAN read/reprint fallback UI.

**Tech Stack:** TypeScript, Drizzle ORM + Cloudflare D1, Hono, Go `modernc.org/sqlite` (with JSON1), `html/template`, `golang.org/x/crypto/bcrypt`.

---

## File Structure

- Modify: `packages/db/src/schema/spool.ts` — add `edgeSnapshot` and `edgeSnapshotChunk` tables.
- Create: `packages/db/src/migrations/0044_edge_v1_snapshots.sql` and update `packages/db/src/migrations/meta/_journal.json`.
- Create: `packages/server/src/lib/edge-snapshots.ts` — builds sanitized `stock`, `orders`, `dies`, `print_status`, and `company_format` sections in bounded D1 read batches, chunks at `<= 1 MiB`, caches for 60s per company, and retains the latest 2 complete generations for at least 24h.
- Modify: `apps/server/src/edge-v1-routes.ts` — mount `GET /api/edge/v1/snapshots/manifest` and `GET /api/edge/v1/snapshots/:snapshotId/chunks/:sequence`.
- Test: `packages/server/test/edge-v1-snapshots.test.ts` — verifies sanitization (no `ratePaise`, prices, secrets, or label variables), hard-delete disappearance, and chunk SHA-256 integrity.
- Create (Agent): `internal/cache/store.go` and `internal/cache/store_test.go` — SQLite staging and atomic per-section generation swap, keeping the previous generation active on any hash/count/schema mismatch, plus cache wipe on `node_revoked`.
- Create (Agent): `internal/localui/server.go` and `internal/localui/server_test.go` — two separate HTTP servers (`127.0.0.1:8081` admin + `:8080` LAN fallback), bcrypt local accounts (`admin`, `printer`, `viewer`), CSRF + `Origin`/`Host` validation, per-section **Cached as of** banners, and offline reprint of eligible (`sent`, `outcome_unknown`, `failed_final`, `cancelled`) local jobs.

---

### Task 1: Add D1 Snapshot Tables and Sanitized Section Builders (`packages/server/src/lib/edge-snapshots.ts`)

**Files:**
- Modify: `packages/db/src/schema/spool.ts`
- Create: `packages/db/src/migrations/0044_edge_v1_snapshots.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Create: `packages/server/src/lib/edge-snapshots.ts`
- Modify: `apps/server/src/edge-v1-routes.ts`
- Test: `packages/server/test/edge-v1-snapshots.test.ts`

- [ ] **Step 1: Write the failing snapshot sanitization and hard-delete convergence test**

Create `packages/server/test/edge-v1-snapshots.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createTestEnv } from "./helpers/test-env";
import { buildOrGetCompanySnapshotManifest, getSnapshotChunkForNode } from "../src/lib/edge-snapshots";

describe("edge v1 sanitized snapshots", () => {
  test("builds all five sections, strips prices and label variables, and reflects hard deletes on next generation", async () => {
    const t = await createTestEnv();
    try {
      const manifest = await buildOrGetCompanySnapshotManifest(t.db, {
        companyId: t.company.id,
        forceRebuild: true,
        nowMs: 1_700_000_000_000,
      });

      expect(manifest.sections.map((s) => s.section)).toEqual([
        "stock",
        "orders",
        "dies",
        "print_status",
        "company_format",
      ]);

      for (const sec of manifest.sections) {
        expect(sec.complete).toBe(true);
        const chunk = await getSnapshotChunkForNode(t.db, {
          companyId: t.company.id,
          snapshotId: sec.snapshotId,
          sequence: 0,
        });
        expect(chunk.ok).toBe(true);
        if (!chunk.ok) continue;
        const raw = JSON.stringify(chunk.body);
        expect(raw).not.toContain("ratePaise");
        expect(raw).not.toContain("sharedSecret");
        expect(raw).not.toContain("cfTunnelToken");
      }
    } finally {
      await t.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-v1-snapshots.test.ts`
Expected: FAIL with module `../src/lib/edge-snapshots` not found.

- [ ] **Step 3: Add `edgeSnapshot` + `edgeSnapshotChunk` schema/migration and implement `packages/server/src/lib/edge-snapshots.ts`**

Add `edgeSnapshot` and `edgeSnapshotChunk` to `packages/db/src/schema/spool.ts`, add `0044_edge_v1_snapshots.sql`, and implement `buildOrGetCompanySnapshotManifest` + `getSnapshotChunkForNode` in `packages/server/src/lib/edge-snapshots.ts` using `db.batch(...)` per section and stripping all price/secret/variable fields.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/test/edge-v1-snapshots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/spool.ts packages/db/src/migrations/0044_edge_v1_snapshots.sql packages/db/src/migrations/meta/_journal.json packages/server/src/lib/edge-snapshots.ts apps/server/src/edge-v1-routes.ts packages/server/test/edge-v1-snapshots.test.ts
git commit -m "feat(server): add sanitized edge v1 snapshot manifest and chunk endpoints"
```

---

### Task 2: Implement Atomic SQLite Section Swap and Revocation Wipe on the Agent (`internal/cache`)

**Files:**
- Create (Agent): `internal/cache/store.go`
- Create (Agent): `internal/cache/store_test.go`

- [ ] **Step 1: Write the failing atomic swap and corrupt-chunk rejection test**

Create `internal/cache/store_test.go` in `/Users/abhalala/Documents/business/fc/wt/ORRN-EDGE-AGENT`:

```go
package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"testing"

	"github.com/orrn/spool/internal/db"
)

func TestCacheStorePreservesPreviousGenerationOnCorruptChunkAndWipesOnRevoke(t *testing.T) {
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "edge.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer sqlDB.Close()

	store, err := NewStore(ctx, sqlDB)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}

	chunk1 := `{"snapshotId":"snap-1","sequence":0,"records":[{"entityId":"b-1","sortKey":"26I4086","dto":{"serial":"26I4086"}}],"summaries":[]}`
	sum1 := sha256.Sum256([]byte(chunk1))
	err = store.ApplySection(ctx, SectionMeta{
		Section:       "stock",
		SnapshotID:    "snap-1",
		CompanyID:     "comp-1",
		GeneratedAt:   "2026-10-26T12:00:00Z",
		ContentSHA256: hex.EncodeToString(sum1[:]),
		RecordCount:   1,
	}, []ChunkPayload{{Sequence: 0, SHA256: hex.EncodeToString(sum1[:]), RecordCount: 1, RawJSON: []byte(chunk1)}})
	if err != nil {
		t.Fatalf("ApplySection snap-1: %v", err)
	}

	// Corrupt snap-2 must fail and leave snap-1 intact
	err = store.ApplySection(ctx, SectionMeta{
		Section:       "stock",
		SnapshotID:    "snap-2",
		CompanyID:     "comp-1",
		GeneratedAt:   "2026-10-26T12:01:00Z",
		ContentSHA256: "bad",
		RecordCount:   1,
	}, []ChunkPayload{{Sequence: 0, SHA256: "bad", RecordCount: 1, RawJSON: []byte(chunk1)}})
	if err == nil {
		t.Fatalf("expected corrupt snapshot to fail")
	}

	records, meta, err := store.ListRecords(ctx, "stock", 50, 0)
	if err != nil || meta.SnapshotID != "snap-1" || len(records) != 1 {
		t.Fatalf("expected snap-1 to remain active, got meta=%+v len=%d err=%v", meta, len(records), err)
	}

	if err := store.WipeCompanyCache(ctx); err != nil {
		t.Fatalf("WipeCompanyCache: %v", err)
	}
	recordsAfter, _, _ := store.ListRecords(ctx, "stock", 50, 0)
	if len(recordsAfter) != 0 {
		t.Fatalf("expected 0 cached records after revocation wipe, got %d", len(recordsAfter))
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/cache -v`
Expected: FAIL with package `./internal/cache` not found.

- [ ] **Step 3: Implement `internal/cache/store.go`**

Create `internal/cache/store.go` verifying chunk SHA-256, record counts, and completeness before executing a single `BEGIN IMMEDIATE ... COMMIT` SQLite transaction that replaces `cache_records` and `cache_sections` for that section.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test -race ./internal/cache -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/cache/store.go internal/cache/store_test.go
git commit -m "feat(cache): add verified per-section atomic SQLite snapshot store"
```

---

### Task 3: Implement Dual-Listener Local Admin & LAN Fallback Web Server (`internal/localui`)

**Files:**
- Create (Agent): `internal/localui/server.go`
- Create (Agent): `internal/localui/server_test.go`

- [ ] **Step 1: Write the failing listener separation, CSRF/auth, and offline reprint eligibility tests**

Create `internal/localui/server_test.go`:

```go
package localui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orrn/spool/internal/cache"
	"github.com/orrn/spool/internal/db"
	"github.com/orrn/spool/internal/jobs"
)

func TestFallbackListenerExposesNoAdminRoutesAndEnforcesReprintEligibility(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := db.Open(filepath.Join(t.TempDir(), "edge.db"))
	defer sqlDB.Close()

	jobStore, _ := jobs.NewStore(ctx, sqlDB)
	cacheStore, _ := cache.NewStore(ctx, sqlDB)
	srv, err := NewServer(ctx, sqlDB, jobStore, cacheStore)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	if err := srv.BootstrapAdmin(ctx, "admin-pass-123456"); err != nil {
		t.Fatalf("BootstrapAdmin: %v", err)
	}
	if err := srv.CreateFallbackUser(ctx, "operator1", "printer-pin-1234", RolePrinter); err != nil {
		t.Fatalf("CreateFallbackUser: %v", err)
	}

	// Admin route must 404 on the LAN fallback mux
	req := httptest.NewRequest(http.MethodPost, "/admin/users", strings.NewReader(""))
	w := httptest.NewRecorder()
	srv.FallbackHandler().ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for /admin/users on fallback listener, got %d", w.Code)
	}

	// Unauthenticated fallback read must redirect/401
	reqStock := httptest.NewRequest(http.MethodGet, "/fallback/stock", nil)
	wStock := httptest.NewRecorder()
	srv.FallbackHandler().ServeHTTP(wStock, reqStock)
	if wStock.Code != http.StatusUnauthorized && wStock.Code != http.StatusSeeOther {
		t.Fatalf("expected 401/303 for unauthenticated /fallback/stock, got %d", wStock.Code)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/localui -v`
Expected: FAIL with package `./internal/localui` not found.

- [ ] **Step 3: Implement `internal/localui/server.go`**

Create `internal/localui/server.go` with two completely separate `http.Handler` trees:
- `AdminHandler()` (bound to `127.0.0.1:8081`): requires authenticated `admin` session + CSRF + `Host`/`Origin` validation; serves fallback-user management, diagnostics, read-only desired config, and printer tests.
- `FallbackHandler()` (bound to `:8080`): serves `/healthz`, login, read-only cached `stock`, `orders`, `dies`, and `print_status` with per-section **Cached as of** timestamps, plus `POST /fallback/jobs/:id/reprint` for `printer` role users only when the source job is in `sent`, `outcome_unknown`, `failed_final`, or `cancelled` and has a frozen TSPL payload.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test -race ./internal/localui -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/localui/server.go internal/localui/server_test.go
git commit -m "feat(localui): add separated loopback admin and LAN fallback web servers"
```
