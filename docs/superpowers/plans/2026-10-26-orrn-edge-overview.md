# ORRN Edge implementation overview

Approved specification: `docs/superpowers/specs/2026-10-26-orrn-edge-agent-design.md`
Specification commit: `28ed117a41a1f25941f3e8e559efe5e23045dca6`

## Delivery shape

The work is split into four independently testable implementation plans. Together they deliver one feature; none is an optional side project.

| Order | Plan | Repository | Working result |
|---|---|---|---|
| 1 | `2026-10-26-orrn-edge-control-plane.md` | ORRN | A fake edge node can enroll, rotate credentials, lease/acknowledge commands, and replay events against D1 |
| 1 | `2026-10-26-orrn-edge-agent-runtime.md` | Agent | A local agent can enroll, persist commands/jobs/events, recover crashes, and drive a fake TSC safely |
| 2 | `2026-10-26-orrn-edge-cache-fallback.md` | Both | Sanitized snapshots converge into an atomic local cache and an authenticated LAN fallback app |
| 3 | `2026-10-26-orrn-edge-packaging-migration.md` | Both | Windows/Linux/Docker/ARM64 service packages pass lifecycle tests and Fourcubes migrates with legacy fallback |

Control-plane and agent-runtime work may proceed independently against the frozen contracts below. Cache/fallback requires enrollment and node configuration. Packaging requires the agent runtime. Fourcubes production migration requires every test gate.

## Worktrees

- ORRN: `/Users/abhalala/Documents/business/fc/wt/ORRN-EDGE`, branch `feature/orrn-edge`
- Agent: `/Users/abhalala/Documents/business/fc/wt/ORRN-EDGE-AGENT`, branch `feature/orrn-edge`

Do not copy uncommitted agni/filter changes from `orrn-spool-agni`; they belong to other work.

## Frozen protocol

### Versions

- `protocolVersion`: `1`
- `configSchemaVersion`: `1`
- `cacheSchemaVersion`: `1`
- Agent version: release semantic version stamped into `main.Version`; development builds use `dev` and cannot enroll as production releases.

### HTTP endpoints

| Endpoint | Authentication | Owner |
|---|---|---|
| `POST /api/edge/v1/enroll` | One-time enrollment token | Control plane |
| `POST /api/edge/v1/commands/poll` | Node HMAC | Control plane |
| `POST /api/edge/v1/commands/ack` | Node HMAC | Control plane |
| `POST /api/edge/v1/events` | Node HMAC | Control plane |
| `GET /api/edge/v1/config` | Node HMAC | Control plane |
| `POST /api/edge/v1/credentials/confirm` | Pending node HMAC | Control plane |
| `GET /api/edge/v1/snapshots/manifest` | Node HMAC | Control plane |
| `GET /api/edge/v1/snapshots/:snapshotId/chunks/:sequence` | Node HMAC | Control plane |

Every authenticated request signs the exact method and request URI using the existing `v1:<unix-ms>:<hmac>` construction. `X-ORRN-Node-ID` selects the node only after signature verification; the server derives company and permissions from that node. Request JSON uses camelCase. Database columns use snake_case. Go JSON tags explicitly match the wire names.

### Command JSON

```json
{
  "commandId": "019a0000-0000-7000-8000-000000000001",
  "kind": "print_job",
  "leaseId": "019a0000-0000-7000-8000-000000000002",
  "leaseExpiresAt": "2026-10-26T12:00:00.000Z",
  "payload": {
    "jobKey": "bundle:26I4086:label:v3:attempt:0",
    "payloadHash": "64-lowercase-hex-characters",
    "printerProfileId": "profile-id",
    "templateId": "template-id",
    "templateVersion": 3,
    "variables": { "bundleSerial": "26I4086" },
    "copies": 1
  }
}
```

`kind` is `print_job`, `test_print`, or `cancel_job`. Acknowledgement uses `commandId`, `leaseId`, `outcome` (`accepted` or `rejected`), `resolution`, and `agentJobId` when a job exists. A resolution is stable forever for one command ID.

### Job JSON states

`accepted`, `device_open`, `transmitting`, `sent`, `failed_retryable`, `failed_final`, `outcome_unknown`, and `cancelled` are the only agent execution states. `sent` means all bytes were written, not physical print confirmation. Cloud presentation uses Queued, Accepted, Sending, Sent to printer, Retry scheduled, Failed, Outcome unknown, and Cancelled.

### Event JSON

```json
{
  "eventId": "019a0000-0000-7000-8000-000000000003",
  "aggregateId": "agent-job-id",
  "sequence": 4,
  "kind": "job_state_changed",
  "occurredAt": "2026-10-26T11:59:59.000Z",
  "payload": {
    "state": "sent",
    "reason": null
  }
}
```

ORRN stores one receipt per `(deploymentId,eventId)` and its original response. Duplicate delivery returns that response without reapplying the event.

### Snapshot JSON

A manifest has `schemaVersion`, `companyId`, and `sections`. Each section has `section`, `snapshotId`, `generatedAt`, `contentSha256`, `recordCount`, `complete`, and ordered `chunks`. Each chunk has `sequence`, `sha256`, and `recordCount`. Section names are `stock`, `orders`, `dies`, `print_status`, and `company_format`.

Chunk content is a JSON object:

```json
{
  "snapshotId": "snapshot-uuid",
  "sequence": 0,
  "records": [
    { "entityId": "stable-server-id", "sortKey": "stable-sort-value", "dto": {} }
  ],
  "summaries": []
}
```

The agent verifies every hash and count before replacing one section in a single SQLite transaction. No partial generation becomes visible.

## Shared ownership rules

- ORRN owns desired printer/template configuration. The agent applies complete config versions and does not accept local desired-config edits.
- ORRN owns cloud print history. The agent owns local execution history until its durable events are acknowledged.
- A command lease controls delivery only. It never creates a new print attempt.
- A job key identifies one immutable logical payload. An explicit retry/reprint creates a new linked attempt and key.
- Every local state transition and its outbox event commit in the same SQLite transaction.
- No online call is required for cached reads or local cached-label reprints.
- Prices, secrets, cloud credentials, R2 credentials, and label variables never enter sanitized snapshot sections.

## Test doubles shared by the plans

- ORRN integration tests use the existing D1/test-router harness and a fake signed node client.
- Agent transport tests use an `httptest.Server` that verifies HMAC and can duplicate, delay, or drop responses.
- Printer tests use a fake TCP TSC server controlling status bytes, short writes, resets, and timeouts.
- Snapshot tests use Fourcubes-scale server fixtures and corrupt/missing chunk injection.
- Service tests use real Windows and Linux VMs for lifecycle verification; unit tests do not substitute for those gates.

## Commit and documentation discipline

Each task commits its tests and minimal implementation together. Do not commit generated secrets, node configuration, local databases, downloaded snapshots, or support bundles. Update `README.md`, `AGENTS.md`, `TODO.md`, `docs/DEPLOYMENT.md`, and the agent deployment guide when the corresponding behavior changes. Obsolete tunnel/trailer/inbound-spool code is deleted only in the cutover task after all callers use the new contracts.
