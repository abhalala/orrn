# ORRN Edge Packaging, Service Lifecycle & Fourcubes Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `orrn-edge` as an immutable, SHA-256-verified service for Windows (`ORRNEdge` SCM service), Linux (`orrn-edge.service` systemd), Docker (`linux/amd64` and `linux/arm64`), and Raspberry Pi, with consistent SQLite backup + health-gated upgrade rollback, then execute the staged Fourcubes CT 130 migration while keeping legacy BarTender intact.

**Architecture:** Build all release binaries with `CGO_ENABLED=0` and linker-stamped `-X main.Version=$VERSION`. Keep secrets out of binaries and environment variables (`node.json` with `0600` / Windows ACLs). Implement `internal/install` (paths, SHA-256 verification, SQLite `VACUUM INTO` backup, binary staging, health-gated rollback) and `internal/service` (Windows SCM + recovery actions), plus Linux/Docker installers and ORRN’s strict `edge-release.ts` manifest resolver.

**Tech Stack:** Go (`golang.org/x/sys/windows/svc`), systemd, Docker buildx (`linux/amd64,linux/arm64`), PowerShell, Bash, GitHub Actions, TypeScript/Zod.

---

## File Structure

- Create (Agent): `internal/install/paths.go`, `internal/install/paths_windows.go`, `internal/install/paths_linux.go`
- Create (Agent): `internal/install/artifact.go`, `internal/install/backup.go`, `internal/install/upgrade.go`, `internal/install/upgrade_test.go`
- Create (Agent): `internal/service/windows.go`, `internal/service/windows_stub.go`
- Create (Agent): `packaging/linux/orrn-edge.service`, `packaging/linux/install.sh`, `packaging/linux/uninstall.sh`, `packaging/docker/install.sh`
- Modify (Agent): `Dockerfile`, `docker-compose.yml`, `.github/workflows/release-binaries.yml`
- Create (Agent): `scripts/build-release.sh`, `scripts/release-manifest.sh`, `scripts/release_test.sh`
- Create (ORRN): `packages/server/src/lib/edge-release.ts` and `packages/server/test/edge-release.test.ts`
- Modify (ORRN): `apps/web/src/features/admin/company-printing-tab.tsx`
- Create (ORRN): `docs/FOURCUBES_CUTOVER.md`

---

### Task 1: Implement Consistent SQLite Backup, Binary Staging, and Health-Gated Upgrade Rollback (`internal/install`)

**Files:**
- Create (Agent): `internal/install/paths.go`
- Create (Agent): `internal/install/artifact.go`
- Create (Agent): `internal/install/backup.go`
- Create (Agent): `internal/install/upgrade.go`
- Create (Agent): `internal/install/upgrade_test.go`

- [ ] **Step 1: Write the failing WAL-backup and automatic-rollback test**

Create `internal/install/upgrade_test.go`:

```go
package install

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/orrn/spool/internal/db"
)

type fakeSvc struct{ started, stopped int }

func (f *fakeSvc) Stop(context.Context) error  { f.stopped++; return nil }
func (f *fakeSvc) Start(context.Context) error { f.started++; return nil }

type failingReady struct{}

func (failingReady) WaitReady(context.Context, time.Duration) error {
	return errors.New("candidate failed readiness")
}

func TestApplyUpgradeBacksUpSQLiteAndRestoresPreviousBinaryOnFailedHealth(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "edge.db")
	sqlDB, err := db.Open(dbPath)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	_, _ = sqlDB.Exec("CREATE TABLE sample (id TEXT PRIMARY KEY); INSERT INTO sample VALUES ('row-1');")
	_ = sqlDB.Close()

	execPath := filepath.Join(dir, "orrn-edge")
	prevPath := filepath.Join(dir, "orrn-edge.previous")
	candPath := filepath.Join(dir, "candidate")
	backupPath := filepath.Join(dir, "edge-backup.db")

	_ = os.WriteFile(execPath, []byte("v1.0.0-binary"), 0o755)
	candBytes := []byte("v1.1.0-broken-binary")
	_ = os.WriteFile(candPath, candBytes, 0o755)
	sum := sha256.Sum256(candBytes)

	svc := &fakeSvc{}
	err = ApplyUpgrade(ctx, UpgradeDeps{
		Paths: Paths{
			Executable:         execPath,
			PreviousExecutable: prevPath,
			StateDir:           dir,
			DatabaseFile:       dbPath,
			NodeFile:           filepath.Join(dir, "node.json"),
		},
		Service: svc,
		Ready:   failingReady{},
		Backup:  BackupSQLite,
	}, candPath, hex.EncodeToString(sum[:]), backupPath, time.Second)
	if err == nil {
		t.Fatalf("expected upgrade to fail when readiness fails")
	}

	restored, _ := os.ReadFile(execPath)
	if string(restored) != "v1.0.0-binary" {
		t.Fatalf("expected previous binary restored, got %q", string(restored))
	}
	if _, err := os.Stat(backupPath); err != nil {
		t.Fatalf("expected consistent SQLite backup at %s: %v", backupPath, err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/install -v`
Expected: FAIL with package `./internal/install` not found.

- [ ] **Step 3: Implement `internal/install/{paths,artifact,backup,upgrade}.go`**

Create `internal/install` using `VACUUM INTO` for consistent online/offline SQLite backups, SHA-256 verification before stopping the service, atomic rename to `PreviousExecutable`, and automatic rollback + service restart when `Ready.WaitReady` fails.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test -race ./internal/install -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/install/
git commit -m "feat(install): add SHA-256 verification, SQLite backup, and health-gated rollback"
```

---

### Task 2: Add Windows SCM Service, Linux systemd Unit, Docker Multi-Arch Packaging, and Release Scripts

**Files:**
- Create (Agent): `internal/service/windows.go`, `internal/service/windows_stub.go`
- Create (Agent): `packaging/linux/orrn-edge.service`, `packaging/linux/install.sh`, `packaging/linux/uninstall.sh`, `packaging/docker/install.sh`
- Create (Agent): `scripts/build-release.sh`, `scripts/release-manifest.sh`, `scripts/release_test.sh`
- Modify (Agent): `Dockerfile`, `docker-compose.yml`, `.github/workflows/release-binaries.yml`

- [ ] **Step 1: Write the failing release-script and manifest validation test**

Create `scripts/release_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if bash scripts/build-release.sh dev 2>/dev/null; then
  echo "expected dev version to be rejected" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
OUT_DIR="$tmpdir" bash scripts/build-release.sh 1.0.0
OUT_DIR="$tmpdir" bash scripts/release-manifest.sh 1.0.0 "ghcr.io/abhalala/orrn-edge@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

grep -q '"version": "1.0.0"' "$tmpdir/orrn-edge-release.json"
grep -q 'orrn-edge-windows-amd64.exe' "$tmpdir/orrn-edge-release.json"
grep -q 'orrn-edge-linux-amd64' "$tmpdir/orrn-edge-release.json"
grep -q 'orrn-edge-linux-arm64' "$tmpdir/orrn-edge-release.json"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/release_test.sh`
Expected: FAIL with `scripts/build-release.sh: No such file or directory`.

- [ ] **Step 3: Implement `scripts/build-release.sh`, `scripts/release-manifest.sh`, service files, and `Dockerfile`**

1. Create `scripts/build-release.sh` compiling `windows/amd64`, `linux/amd64`, and `linux/arm64` with `CGO_ENABLED=0` and `-ldflags="-s -w -X main.Version=$VERSION"` plus `.sha256` sidecars.
2. Create `scripts/release-manifest.sh` writing `orrn-edge-release.json`.
3. Create `internal/service/windows.go` (`//go:build windows`) using `golang.org/x/sys/windows/svc` + `mgr` with 3 restart recovery actions (`5s/15s/60s`) and `internal/service/windows_stub.go` (`//go:build !windows`).
4. Create `packaging/linux/orrn-edge.service`, `packaging/linux/install.sh`, `packaging/linux/uninstall.sh`, and `packaging/docker/install.sh`.
5. Update `Dockerfile` and `docker-compose.yml` for `CGO_ENABLED=0`, `/var/lib/orrn-edge`, and fallback-only port publication.

- [ ] **Step 4: Run the release test script**

Run: `bash scripts/release_test.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/service/ packaging/ scripts/ Dockerfile docker-compose.yml .github/workflows/release-binaries.yml
git commit -m "feat(packaging): add Windows SCM, systemd, Docker multi-arch, and release scripts"
```

---

### Task 3: Add Strict Release Resolver and Enrollment-Only Install UI in ORRN

**Files:**
- Create (ORRN): `packages/server/src/lib/edge-release.ts`
- Create (ORRN): `packages/server/test/edge-release.test.ts`
- Modify (ORRN): `apps/web/src/features/admin/company-printing-tab.tsx`
- Create (ORRN): `docs/FOURCUBES_CUTOVER.md`

- [ ] **Step 1: Write the failing release-manifest resolver test**

Create `packages/server/test/edge-release.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { edgeReleaseManifestSchema, selectEdgeArtifact } from "../src/lib/edge-release";

describe("edge release manifest contract", () => {
  test("accepts only explicit semver manifests with sha256 and image digest and rejects dev or secret fields", () => {
    const valid = edgeReleaseManifestSchema.parse({
      version: "1.0.0",
      protocolVersion: 1,
      configSchemaVersion: 1,
      cacheSchemaVersion: 1,
      dockerImage: "ghcr.io/abhalala/orrn-edge@sha256:" + "a".repeat(64),
      artifacts: {
        "windows-amd64": {
          filename: "orrn-edge-windows-amd64.exe",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-windows-amd64.exe",
          sha256: "b".repeat(64),
        },
        "linux-amd64": {
          filename: "orrn-edge-linux-amd64",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-linux-amd64",
          sha256: "c".repeat(64),
        },
        "linux-arm64": {
          filename: "orrn-edge-linux-arm64",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-linux-arm64",
          sha256: "d".repeat(64),
        },
      },
    });
    expect(selectEdgeArtifact(valid, "windows-amd64").filename).toBe("orrn-edge-windows-amd64.exe");

    expect(() =>
      edgeReleaseManifestSchema.parse({
        ...valid,
        version: "dev",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-release.test.ts`
Expected: FAIL with module `../src/lib/edge-release` not found.

- [ ] **Step 3: Implement `packages/server/src/lib/edge-release.ts`, update `company-printing-tab.tsx`, and write `docs/FOURCUBES_CUTOVER.md`**

Create `packages/server/src/lib/edge-release.ts`, update `apps/web/src/features/admin/company-printing-tab.tsx` to display the one-time enrollment token plus immutable Windows/Linux/Docker/Pi install commands (with no tunnel token or binary trailer), and document the staged CT 130 + Pi cutover checklist in `docs/FOURCUBES_CUTOVER.md`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test packages/server/test/edge-release.test.ts && bun run --cwd packages/server check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/edge-release.ts packages/server/test/edge-release.test.ts apps/web/src/features/admin/company-printing-tab.tsx docs/FOURCUBES_CUTOVER.md
git commit -m "feat(edge): add immutable release manifest resolver and Fourcubes cutover runbook"
```
