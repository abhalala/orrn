# ORRN Edge Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-contained Go edge runtime (`cmd/orrn-edge`) with pure-Go SQLite (`CGO_ENABLED=0`), embedded web assets, dual-credential node store, outbound signed HTTPS connector, atomic job/outbox transactions, serialized TSC sessions, and corrected TSPL2 barcode/dimension generation.

**Architecture:** Replace CGO `mattn/go-sqlite3` with pure-Go `modernc.org/sqlite` and embed `web/templates` + `web/static` directly into the binary. Introduce focused packages (`internal/node`, `internal/edgeclient`, `internal/jobs`, `internal/printer`) so every job state transition and outbox event commits in one SQLite transaction, startup marks interrupted `transmitting` jobs as `outcome_unknown`, and each physical printer uses one serialized TCP session with TA220 1-byte and 4-byte status decoding.

**Tech Stack:** Go 1.22+, `modernc.org/sqlite` (pure Go, `CGO_ENABLED=0`), Gin, standard `embed`, `net/http`, `crypto/hmac`, `crypto/sha256`.

---

## File Structure

- Modify: `go.mod` — replace `github.com/mattn/go-sqlite3` with `modernc.org/sqlite`.
- Create: `web/embed.go` — `//go:embed templates static` filesystem export so the binary needs no external working-directory assets.
- Modify: `internal/core/tspl2_generator.go` and `internal/core/tspl2_generator_test.go` — preserve decimal `SIZE %.2f mm, %.2f mm`, fix `BARCODE` parameter order (`human_readable=1, rotation=elem.Rotation, narrow, wide`), and fix test-label TSPL generation.
- Create: `internal/node/store.go` and `internal/node/store_test.go` — `node.json` (`0600`) reader/writer supporting `ActiveCredential` plus `PendingCredential` across crashes before rotation confirmation.
- Create: `internal/jobs/store.go` and `internal/jobs/store_test.go` — SQLite schema (`edge_commands`, `edge_jobs`, `edge_outbox`, `edge_config_state`), atomic command resolution (`accepted` vs `rejected` on `job_key_conflict`), target-state cancellation rules, atomic job-transition + outbox insertion, and startup crash recovery (`transmitting` → `outcome_unknown`).
- Create: `internal/printer/session.go` and `internal/printer/session_test.go` — per-printer serialized TCP `:9100` actor, TA220 1-byte (`0x00` normal) + 4-byte status decoding, full write loop, and zero-byte (`failed_retryable`) vs post-byte (`outcome_unknown`) classification.
- Create: `internal/edgeclient/client.go` and `internal/edgeclient/client_test.go` — outbound signed HTTPS client for `/api/edge/v1/{enroll,commands/poll,commands/ack,events,config,credentials/confirm}` with capped backoff + jitter.
- Create: `cmd/orrn-edge/main.go` — entrypoint wiring absolute paths, embedded assets, SQLite store, printer sessions, and outbound sync loops.

---

### Task 1: Fix TSPL2 Decimal Dimensions and `BARCODE` Parameter Order

**Files:**
- Modify: `internal/core/tspl2_generator.go`
- Modify: `internal/api/handlers/printers.go`
- Create: `internal/core/tspl2_generator_test.go`

- [ ] **Step 1: Write the failing TSPL2 barcode and decimal-size test**

Create `internal/core/tspl2_generator_test.go`:

```go
package core

import (
	"strings"
	"testing"
)

func TestGeneratePreservesDecimalMMAndValidBarcodeSyntax(t *testing.T) {
	gen := NewTSPL2Generator()
	schema := &LabelSchema{
		Name:     "fourcubes-102x76",
		WidthMM:  102.25,
		HeightMM: 76.2,
		GapMM:    2,
		DPI:      203,
		Elements: []LabelElement{
			{
				Type:      "barcode",
				X:         60,
				Y:         220,
				Symbology: "128",
				Height:    60,
				Rotation:  0,
				Narrow:    2,
				Wide:      2,
				Content:   "{{bundleSerial}}",
			},
		},
		Variables: map[string]VariableDef{
			"bundleSerial": {Type: "string", Required: true},
		},
	}

	tspl, err := gen.Generate(schema, map[string]string{"bundleSerial": "26I4086"})
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}
	if !strings.Contains(tspl, "SIZE 102.25 mm, 76.20 mm\r\n") {
		t.Fatalf("expected decimal SIZE in mm with CRLF, got:\n%s", tspl)
	}
	// TSPL2 BARCODE syntax: BARCODE X,Y,"type",height,human_readable,rotation,narrow,wide,"content"
	wantBarcode := `BARCODE 60,220,"128",60,1,0,2,2,"26I4086"`
	if !strings.Contains(tspl, wantBarcode) {
		t.Fatalf("expected %q in TSPL output, got:\n%s", wantBarcode, tspl)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/core -run TestGeneratePreservesDecimalMMAndValidBarcodeSyntax -v`
Expected: FAIL (`SIZE 102 mm, 76 mm` and `BARCODE 60,220,"128",60,0,2,2,2,"26I4086"` where `2` is in the rotation slot).

- [ ] **Step 3: Fix `internal/core/tspl2_generator.go` and `internal/api/handlers/printers.go`**

In `internal/core/tspl2_generator.go`, update `Generate` and `generateBarcode`:

```go
	sb.WriteString(fmt.Sprintf("SIZE %.2f mm, %.2f mm\r\n", schema.WidthMM, schema.HeightMM))
	sb.WriteString(fmt.Sprintf("GAP %.2f mm, 0 mm\r\n", schema.GapMM))
	sb.WriteString("DIRECTION 0\r\n")
	sb.WriteString("CLS\r\n")

	for _, elem := range schema.Elements {
		cmd, err := g.generateElement(&elem, variables, schema)
		if err != nil {
			return "", fmt.Errorf("error generating %s element: %w", elem.Type, err)
		}
		if cmd != "" {
			sb.WriteString(cmd)
			sb.WriteString("\r\n")
		}
	}

	sb.WriteString("PRINT 1,1\r\n")
```

And in `generateBarcode`:

```go
	// TSPL2 BARCODE: X, Y, "type", height, human_readable (1), rotation (0/90/180/270), narrow, wide, "content"
	return fmt.Sprintf(`BARCODE %d,%d,"%s",%d,1,%d,%d,%d,"%s"`,
		elem.X, elem.Y, symbology, height, elem.Rotation, narrow, wide, content)
```

In `internal/api/handlers/printers.go`, update `generateTestLabel` to use `SIZE %.2f mm, %.2f mm`, CRLF line endings, and `BARCODE %d,%d,"128",60,1,0,2,2,"%s"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/core -run TestGeneratePreservesDecimalMMAndValidBarcodeSyntax -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/core/tspl2_generator.go internal/core/tspl2_generator_test.go internal/api/handlers/printers.go
git commit -m "fix(tspl2): preserve decimal mm dimensions and fix BARCODE rotation slot"
```

---

### Task 2: Switch to Pure-Go SQLite (`modernc.org/sqlite`) and Embed Web Assets

**Files:**
- Modify: `go.mod`
- Modify: `internal/db/db.go`
- Create: `web/embed.go`
- Test: `internal/db/db_test.go`

- [ ] **Step 1: Write the failing pure-Go SQLite pragma and embedded asset test**

Create `internal/db/db_test.go`:

```go
package db

import (
	"path/filepath"
	"testing"

	"github.com/orrn/spool/web"
)

func TestOpenConfiguresWALAndEmbeddedAssetsExist(t *testing.T) {
	dir := t.TempDir()
	conn, err := Open(filepath.Join(dir, "edge.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer conn.Close()

	var mode string
	if err := conn.QueryRow("PRAGMA journal_mode;").Scan(&mode); err != nil {
		t.Fatalf("query journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}

	entries, err := web.Assets.ReadDir("templates")
	if err != nil || len(entries) == 0 {
		t.Fatalf("embedded templates missing: %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/db -v`
Expected: FAIL (`mattn/go-sqlite3` requires CGO and `web.Assets` does not exist).

- [ ] **Step 3: Create `web/embed.go` and switch `internal/db/db.go` to `modernc.org/sqlite`**

Create `web/embed.go`:

```go
package web

import "embed"

//go:embed templates static
var Assets embed.FS
```

Update `internal/db/db.go` to import `_ "modernc.org/sqlite"`, open with driver `"sqlite"`, and execute `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;` inside `Open(dbPath string) (*sql.DB, error)`.

- [ ] **Step 4: Run the test with `CGO_ENABLED=0`**

Run: `CGO_ENABLED=0 go test ./internal/db -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/db/db.go internal/db/db_test.go web/embed.go
git commit -m "feat(db): use pure-Go modernc sqlite with WAL and embed web assets"
```

---

### Task 3: Implement Crash-Safe Dual-Credential Node Store (`internal/node`)

**Files:**
- Create: `internal/node/store.go`
- Create: `internal/node/store_test.go`

- [ ] **Step 1: Write the failing credential store test**

Create `internal/node/store_test.go`:

```go
package node

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestNodeStorePersistsPendingRotationAndPromotesAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node.json")
	store := NewStore(path)

	initial := State{
		ProtocolVersion: 1,
		DeploymentID:    "019a0000-0000-7000-8000-000000000001",
		InstanceID:      "019a0000-0000-7000-8000-000000000002",
		NodeName:        "Fourcubes",
		SiteLabel:       "Surat",
		APIOrigin:       "https://api.orrn.in",
		Active: Credential{
			Version: 1,
			Secret:  "secret-v1-0000000000000000000000000000",
		},
	}
	if err := store.Save(initial); err != nil {
		t.Fatalf("Save initial: %v", err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("mode = %o, want 0600", got)
		}
	}

	if err := store.StagePending(Credential{Version: 2, Secret: "secret-v2-1111111111111111111111111111"}); err != nil {
		t.Fatalf("StagePending: %v", err)
	}

	reloaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if reloaded.Active.Version != 1 || reloaded.Pending == nil || reloaded.Pending.Version != 2 {
		t.Fatalf("unexpected state before confirm: %+v", reloaded)
	}

	if err := store.PromotePending(2); err != nil {
		t.Fatalf("PromotePending: %v", err)
	}
	after, err := store.Load()
	if err != nil {
		t.Fatalf("Load after promote: %v", err)
	}
	if after.Active.Version != 2 || after.Pending != nil {
		t.Fatalf("unexpected state after promote: %+v", after)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/node -v`
Expected: FAIL with package `./internal/node` not found.

- [ ] **Step 3: Implement `internal/node/store.go`**

Create `internal/node/store.go` writing temp files in the same directory with `0o600`, `Sync()`, and `os.Rename()` so `Active` and `Pending` credentials survive process kills before `/api/edge/v1/credentials/confirm` completes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test ./internal/node -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/node/store.go internal/node/store_test.go
git commit -m "feat(node): add atomic dual-credential node.json store"
```

---

### Task 4: Implement Durable Command Resolution, Atomic Job/Outbox Store, and Crash Recovery (`internal/jobs`)

**Files:**
- Create: `internal/jobs/store.go`
- Create: `internal/jobs/store_test.go`

- [ ] **Step 1: Write the failing command dedupe, conflict rejection, cancellation, and crash recovery tests**

Create `internal/jobs/store_test.go`:

```go
package jobs

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/orrn/spool/internal/db"
)

func TestStoreDeduplicatesCommandsRejectsConflictsAndRecoversTransmittingAsOutcomeUnknown(t *testing.T) {
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "edge.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer sqlDB.Close()

	s, err := NewStore(ctx, sqlDB)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}

	// 1. Accept print_job command
	res1, err := s.ResolvePrintCommand(ctx, PrintCommandInput{
		CommandID:   "019a0000-0000-7000-8000-000000000001",
		JobKey:      "bundle:26I4086:label:v1:attempt:1",
		PayloadHash: "hash-a",
		PrinterID:   "tsc-1",
		TSPL:        "SIZE 102.25 mm, 76.20 mm\r\nCLS\r\nPRINT 1,1\r\n",
		Copies:      1,
	})
	if err != nil {
		t.Fatalf("ResolvePrintCommand: %v", err)
	}
	if res1.Outcome != "accepted" || res1.AgentJobID == "" {
		t.Fatalf("unexpected res1: %+v", res1)
	}

	// 2. Redelivery of same commandId returns identical resolution without creating second job
	resReplay, err := s.ResolvePrintCommand(ctx, PrintCommandInput{
		CommandID:   "019a0000-0000-7000-8000-000000000001",
		JobKey:      "bundle:26I4086:label:v1:attempt:1",
		PayloadHash: "hash-a",
		PrinterID:   "tsc-1",
		TSPL:        "SIZE 102.25 mm, 76.20 mm\r\nCLS\r\nPRINT 1,1\r\n",
		Copies:      1,
	})
	if err != nil || resReplay.AgentJobID != res1.AgentJobID {
		t.Fatalf("replay mismatch: %+v vs %+v (err=%v)", resReplay, res1, err)
	}

	// 3. Different commandId with same job_key but different payloadHash is durably rejected
	resConflict, err := s.ResolvePrintCommand(ctx, PrintCommandInput{
		CommandID:   "019a0000-0000-7000-8000-000000000002",
		JobKey:      "bundle:26I4086:label:v1:attempt:1",
		PayloadHash: "hash-different",
		PrinterID:   "tsc-1",
		TSPL:        "SIZE 102.25 mm, 76.20 mm\r\nCLS\r\nPRINT 2,1\r\n",
		Copies:      2,
	})
	if err != nil {
		t.Fatalf("ResolvePrintCommand conflict: %v", err)
	}
	if resConflict.Outcome != "rejected" || resConflict.Resolution != "job_key_conflict" {
		t.Fatalf("expected job_key_conflict rejection, got %+v", resConflict)
	}

	// 4. Claim and move to transmitting, then simulate crash recovery
	claimed, err := s.ClaimNextJob(ctx, "tsc-1")
	if err != nil || claimed == nil {
		t.Fatalf("ClaimNextJob: %v %+v", err, claimed)
	}
	if err := s.MarkTransmitting(ctx, claimed.ID); err != nil {
		t.Fatalf("MarkTransmitting: %v", err)
	}
	// Cancel during transmitting must be rejected
	cancelRes, err := s.ResolveCancelCommand(ctx, "019a0000-0000-7000-8000-000000000003", claimed.ID)
	if err != nil || cancelRes.Outcome != "rejected" || cancelRes.Resolution != "transmission_started" {
		t.Fatalf("expected transmission_started rejection, got %+v (err=%v)", cancelRes, err)
	}

	// Startup crash recovery must turn transmitting into outcome_unknown (never back to accepted)
	if err := s.RecoverAfterCrash(ctx); err != nil {
		t.Fatalf("RecoverAfterCrash: %v", err)
	}
	job, err := s.GetJob(ctx, claimed.ID)
	if err != nil || job.State != StateOutcomeUnknown {
		t.Fatalf("expected outcome_unknown after crash, got %+v (err=%v)", job, err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/jobs -v`
Expected: FAIL with package `./internal/jobs` not found.

- [ ] **Step 3: Implement `internal/jobs/store.go`**

Create `internal/jobs/store.go` implementing:
- `ResolvePrintCommand`: single transaction inserting `edge_commands`, checking `edge_jobs` by `job_key`, returning `rejected/job_key_conflict` on payload hash mismatch, or inserting `edge_jobs` (`state='accepted'`) + `edge_outbox` event.
- `ResolveCancelCommand`: single transaction persisting the cancel command resolution across all target states (`job_not_found`, `already_cancelled`, `cancelled`, `transmission_started`, `job_not_cancellable`).
- `ClaimNextJob`, `MarkTransmitting`, `MarkSent`, `MarkFailedRetryable`, `MarkOutcomeUnknown`: each updates `edge_jobs` and appends its `job_state_changed` event to `edge_outbox` in the same SQLite transaction.
- `RecoverAfterCrash`: moves `device_open` → `accepted` (zero bytes were sent) and moves `transmitting` → `outcome_unknown` with reason `"process_interrupted"` plus an outbox event.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test -race ./internal/jobs -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/jobs/store.go internal/jobs/store_test.go
git commit -m "feat(jobs): add atomic command resolution, job state machine, and crash recovery"
```

---

### Task 5: Implement Serialized TSC Printer Session and Fault Classification (`internal/printer`)

**Files:**
- Create: `internal/printer/session.go`
- Create: `internal/printer/session_test.go`

- [ ] **Step 1: Write the failing fake-TSC fault-injection test**

Create `internal/printer/session_test.go`:

```go
package printer

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestSessionHandlesOneByteTA220StatusAndClassifiesShortWriteAsOutcomeUnknown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	mode := "ok_one_byte"
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 3)
				if _, err := io.ReadFull(c, buf); err != nil {
					return
				}
				// <ESC>!?
				if string(buf) == "\x1b!?" {
					_, _ = c.Write([]byte{0x00})
				}
				if mode == "reset_mid_write" {
					one := make([]byte, 4)
					_, _ = io.ReadFull(c, one)
					_ = c.(*net.TCPConn).SetLinger(0)
					_ = c.Close()
					return
				}
				_, _ = io.Copy(io.Discard, c)
			}(conn)
		}
	}()

	host, portStr, _ := net.SplitHostPort(ln.Addr().String())
	sess := NewSession(Config{
		PrinterID: "tsc-1",
		Host:      host,
		Port:      portStr,
		Timeout:   2 * time.Second,
	})

	res := sess.Transmit(context.Background(), "SIZE 102.25 mm, 76.20 mm\r\nCLS\r\nPRINT 1,1\r\n")
	if res.Outcome != OutcomeSent {
		t.Fatalf("expected OutcomeSent, got %+v", res)
	}

	mode = "reset_mid_write"
	res2 := sess.Transmit(context.Background(), "SIZE 102.25 mm, 76.20 mm\r\nCLS\r\nPRINT 1,1\r\n")
	if res2.Outcome != OutcomeUnknown {
		t.Fatalf("expected OutcomeUnknown on mid-stream reset, got %+v", res2)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/printer -v`
Expected: FAIL with package `./internal/printer` not found.

- [ ] **Step 3: Implement `internal/printer/session.go`**

Create `internal/printer/session.go` using `net.JoinHostPort(cfg.Host, cfg.Port)`, a single mutex serializing all status and print operations on that printer, 1-byte (`0x00` ready) + 4-byte status decoding, and a write loop that classifies `bytesWritten == 0` errors as `OutcomeRetryable` and `bytesWritten > 0` errors as `OutcomeUnknown`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=0 go test -race ./internal/printer -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/printer/session.go internal/printer/session_test.go
git commit -m "feat(printer): add serialized TSC session and byte-accurate outcome classification"
```

---

### Task 6: Implement Signed Outbound Edge Client and `cmd/orrn-edge` Composition Root

**Files:**
- Create: `internal/edgeclient/client.go`
- Create: `internal/edgeclient/client_test.go`
- Create: `cmd/orrn-edge/main.go`

- [ ] **Step 1: Write the failing outbound client test covering poll, config fetch on pending rotation, and event upload**

Create `internal/edgeclient/client_test.go`:

```go
package edgeclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/orrn/spool/internal/api/middleware"
	"github.com/orrn/spool/internal/node"
)

func TestClientSignsRequestsAndConfirmsPendingRotation(t *testing.T) {
	confirmed := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/edge/v1/commands/poll":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"commands":                 []any{},
				"configVersion":            1,
				"pendingCredentialVersion": 2,
				"snapshotManifestVersion":  "snap-1",
			})
		case "/api/edge/v1/config":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"configVersion":            1,
				"pendingCredentialVersion": 2,
				"pendingSecret":            "secret-v2-1111111111111111111111111111",
				"printers":                 []any{},
				"templates":                []any{},
			})
		case "/api/edge/v1/credentials/confirm":
			tok := r.Header.Get("Authorization")[len("Bearer "):]
			if err := middleware.NewORRNVerifier("secret-v2-1111111111111111111111111111").Verify(r.Method, r.URL.RequestURI(), []byte(`{"credentialVersion":2}`), tok); err != nil {
				t.Fatalf("new secret signature verify failed: %v", err)
			}
			confirmed = true
			_ = json.NewEncoder(w).Encode(map[string]any{"credentialVersion": 2})
		}
	}))
	defer srv.Close()

	store := node.NewStore(filepath.Join(t.TempDir(), "node.json"))
	_ = store.Save(node.State{
		ProtocolVersion: 1,
		DeploymentID:    "019a0000-0000-7000-8000-000000000001",
		InstanceID:      "019a0000-0000-7000-8000-000000000002",
		APIOrigin:       srv.URL,
		Active:          node.Credential{Version: 1, Secret: "secret-v1-0000000000000000000000000000"},
	})

	client := New(store, "1.0.0", srv.Client())
	if err := client.PollOnce(context.Background()); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if !confirmed {
		t.Fatalf("expected pending credential to be staged and confirmed")
	}
	st, _ := store.Load()
	if st.Active.Version != 2 || st.Pending != nil {
		t.Fatalf("expected active version 2 after confirm, got %+v", st)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=0 go test ./internal/edgeclient -v`
Expected: FAIL with package `./internal/edgeclient` not found.

- [ ] **Step 3: Implement `internal/edgeclient/client.go` and `cmd/orrn-edge/main.go`**

Create `internal/edgeclient/client.go` signing every request with `middleware.SignORRN`, staging and confirming `pendingCredentialVersion` when advertised, and uploading unacknowledged `edge_outbox` events. Create `cmd/orrn-edge/main.go` wiring `version`, `run`, `enroll`, `healthcheck`, and `doctor`.

- [ ] **Step 4: Run the full Go test suite with `CGO_ENABLED=0`**

Run: `CGO_ENABLED=0 go test -race ./internal/core ./internal/db ./internal/node ./internal/jobs ./internal/printer ./internal/edgeclient`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/edgeclient/client.go internal/edgeclient/client_test.go cmd/orrn-edge/main.go
git commit -m "feat(agent): add signed outbound edge client and cmd/orrn-edge entrypoint"
```
