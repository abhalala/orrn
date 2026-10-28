# ORRN Edge Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the outbound-only ORRN control plane for site edge nodes: one-time enrollment, non-stranding two-secret rotation, durable D1 command leases/resolutions, idempotent event receipts, and desired-state node configuration without Cloudflare Tunnels or inbound agent calls.

**Architecture:** Extend `spool_deployment` in D1 with enrollment-expiry, pending-secret rotation, and desired-config version columns, and add `edge_command` plus `edge_event_receipt` tables (`0043_edge_v1_control_plane.sql`). Mount `/api/edge/v1/*` Hono routes backed by pure library functions in `packages/server/src/lib/edge-v1.ts`, and update `routers/spool.ts` plus `routers/platform/spool.ts` to enqueue durable commands and issue one-time enrollment tokens instead of provisioning Cloudflare Tunnels.

**Tech Stack:** TypeScript, Bun test, Drizzle ORM + Cloudflare D1 SQLite, Hono, tRPC, `@orrn/crypto` AES-GCM wrapping, `@orrn/edge-runtime` Zod schemas.

---

## File Structure

- Modify: `packages/edge-runtime/src/index.ts` — add V1 wire schemas (`edgeEnrollRequestSchema`, `edgeEnrollResponseSchema`, `edgePollRequestSchema`, `edgePollResponseSchema`, `edgeCommandAckRequestSchema`, `edgeEventsBatchRequestSchema`, `edgeConfigResponseSchema`, `edgeConfirmCredentialRequestSchema`).
- Modify: `packages/db/src/schema/spool.ts` — add rotation/enrollment/config columns on `spool_deployment`, plus `edgeCommand` and `edgeEventReceipt` tables.
- Modify: `packages/db/src/schema/printing.ts` — add nullable `deploymentId` on `printer_profile`, `copies` and `deploymentId` on `print_log`, and expand `printStatuses` with `"accepted"`, `"outcome_unknown"`, `"cancelled"`.
- Create: `packages/db/src/migrations/0043_edge_v1_control_plane.sql` — expand-only D1 migration for the columns and tables above.
- Modify: `packages/db/src/migrations/meta/_journal.json` — register migration `0043_edge_v1_control_plane`.
- Create: `packages/server/src/lib/edge-v1.ts` — enrollment token issue/exchange, dual-secret node authentication, rotation confirmation, command enqueue/poll/ack, desired-config builder, and monotonic event ingestion.
- Create: `apps/server/src/edge-v1-routes.ts` — Hono router mounting `/api/edge/v1/*`.
- Modify: `apps/server/src/index.ts` — mount `edgeV1Routes`.
- Modify: `packages/server/src/routers/platform/spool.ts` — issue 15-minute one-time enrollment tokens without calling Cloudflare Tunnel/DNS APIs; stage pending secret on rotate.
- Modify: `packages/server/src/routers/spool.ts` — route by explicit `profile.deploymentId`, enqueue `edge_command` rows instead of calling `SpoolClient`, and read agent-reported printer/status snapshots.
- Test: `packages/server/test/edge-v1-control-plane.test.ts` — end-to-end D1 tests for enrollment, dual-secret rotation, command lease/ack/conflict, cancellation states, and idempotent event receipts.

---

### Task 1: Add V1 Edge Protocol Schemas in `@orrn/edge-runtime`

**Files:**
- Modify: `packages/edge-runtime/src/index.ts`
- Test: `packages/server/test/edge-v1-control-plane.test.ts`

- [ ] **Step 1: Write the failing schema validation test**

Create `packages/server/test/edge-v1-control-plane.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  edgeCommandAckRequestSchema,
  edgeConfirmCredentialRequestSchema,
  edgeEnrollRequestSchema,
  edgeEventsBatchRequestSchema,
  edgeJobStates,
  edgePollRequestSchema,
} from "@orrn/edge-runtime";

describe("edge v1 protocol schemas", () => {
  test("validates enrollment, poll, ack, credential confirm, and event batches", () => {
    expect(
      edgeEnrollRequestSchema.parse({
        enrollmentToken: "enr_0123456789abcdef0123456789abcdef",
        agentVersion: "1.0.0",
        os: "linux",
        arch: "amd64",
        installId: "019a0000-0000-7000-8000-000000000001",
      }).agentVersion,
    ).toBe("1.0.0");

    expect(() =>
      edgeEnrollRequestSchema.parse({
        enrollmentToken: "enr_0123456789abcdef0123456789abcdef",
        agentVersion: "dev",
        os: "linux",
        arch: "amd64",
        installId: "019a0000-0000-7000-8000-000000000001",
      }),
    ).toThrow();

    expect(edgePollRequestSchema.parse({ limit: 10 }).limit).toBe(10);

    expect(
      edgeCommandAckRequestSchema.parse({
        commandId: "019a0000-0000-7000-8000-000000000010",
        leaseId: "019a0000-0000-7000-8000-000000000011",
        outcome: "rejected",
        resolution: "job_key_conflict",
        agentJobId: null,
        detail: "Payload hash mismatch for existing job_key",
      }).outcome,
    ).toBe("rejected");

    expect(
      edgeConfirmCredentialRequestSchema.parse({
        credentialVersion: 2,
      }).credentialVersion,
    ).toBe(2);

    expect(edgeJobStates).toContain("outcome_unknown");

    expect(
      edgeEventsBatchRequestSchema.parse({
        events: [
          {
            eventId: "019a0000-0000-7000-8000-000000000020",
            aggregateId: "1",
            sequence: 1,
            kind: "job_state_changed",
            occurredAt: "2026-10-26T12:00:00.000Z",
            payload: {
              state: "sent",
              jobKey: "bundle:26I4086:label:v1:attempt:1",
              reason: null,
            },
          },
        ],
      }).events,
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: FAIL with export errors from `@orrn/edge-runtime`.

- [ ] **Step 3: Add the V1 schemas to `packages/edge-runtime/src/index.ts`**

Append to `packages/edge-runtime/src/index.ts`:

```ts
export const releaseSemverSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Release version must be explicit semver (never dev)");

export const edgeCommandKinds = ["print_job", "test_print", "cancel_job"] as const;
export type EdgeCommandKind = (typeof edgeCommandKinds)[number];

export const edgeCommandStates = ["queued", "leased", "accepted", "rejected"] as const;
export type EdgeCommandState = (typeof edgeCommandStates)[number];

export const edgeJobStates = [
  "accepted",
  "device_open",
  "transmitting",
  "sent",
  "failed_retryable",
  "failed_final",
  "outcome_unknown",
  "cancelled",
] as const;
export type EdgeJobState = (typeof edgeJobStates)[number];

export const edgeEnrollRequestSchema = z.object({
  enrollmentToken: z.string().trim().min(24).max(256),
  agentVersion: releaseSemverSchema,
  os: z.enum(["windows", "linux"]),
  arch: z.enum(["amd64", "arm64"]),
  installId: z.string().uuid(),
});
export type EdgeEnrollRequest = z.infer<typeof edgeEnrollRequestSchema>;

export const edgeEnrollResponseSchema = z.object({
  protocolVersion: z.literal(1),
  deploymentId: z.string().uuid(),
  instanceId: z.string().uuid(),
  nodeName: z.string(),
  siteLabel: z.string(),
  apiOrigin: z.string().url(),
  nodeSecret: z.string().min(32),
  credentialVersion: z.number().int().positive(),
  configVersion: z.number().int().positive(),
});
export type EdgeEnrollResponse = z.infer<typeof edgeEnrollResponseSchema>;

export const edgePollRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).default(10),
  appliedConfigVersion: z.number().int().min(0).default(0),
  activeCredentialVersion: z.number().int().min(1).default(1),
  printers: z
    .array(
      z.object({
        printerId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1).max(128),
        port: z.number().int().min(1).max(65535),
        status: z.enum(["online", "offline", "error", "paused", "unknown"]),
        canPrint: z.boolean(),
        lastSeenAt: z.string().datetime().nullable(),
        lastError: z.string().max(512).nullable(),
      }),
    )
    .max(32)
    .optional(),
});
export type EdgePollRequest = z.infer<typeof edgePollRequestSchema>;

export const edgeCommandAckRequestSchema = z.object({
  commandId: z.string().uuid(),
  leaseId: z.string().uuid(),
  outcome: z.enum(["accepted", "rejected"]),
  resolution: z.enum([
    "accepted",
    "already_accepted",
    "cancelled",
    "already_cancelled",
    "job_key_conflict",
    "job_not_found",
    "transmission_started",
    "job_not_cancellable",
    "invalid_payload",
  ]),
  agentJobId: z.string().min(1).max(64).nullable(),
  detail: z.string().max(512).nullable().default(null),
});
export type EdgeCommandAckRequest = z.infer<typeof edgeCommandAckRequestSchema>;

export const edgeConfirmCredentialRequestSchema = z.object({
  credentialVersion: z.number().int().positive(),
});
export type EdgeConfirmCredentialRequest = z.infer<typeof edgeConfirmCredentialRequestSchema>;

export const edgeEventItemSchema = z.object({
  eventId: z.string().uuid(),
  aggregateId: z.string().min(1).max(128),
  sequence: z.number().int().positive(),
  kind: z.enum(["job_state_changed", "config_applied", "offline_reprint", "test_print_result"]),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type EdgeEventItem = z.infer<typeof edgeEventItemSchema>;

export const edgeEventsBatchRequestSchema = z.object({
  events: z.array(edgeEventItemSchema).min(1).max(50),
});
export type EdgeEventsBatchRequest = z.infer<typeof edgeEventsBatchRequestSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/edge-runtime/src/index.ts packages/server/test/edge-v1-control-plane.test.ts
git commit -m "feat(edge-runtime): add v1 control-plane wire schemas"
```

---

### Task 2: Add Expand-Only D1 Schema and Migration `0043_edge_v1_control_plane`

**Files:**
- Modify: `packages/db/src/schema/spool.ts`
- Modify: `packages/db/src/schema/printing.ts`
- Create: `packages/db/src/migrations/0043_edge_v1_control_plane.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `packages/server/test/edge-v1-control-plane.test.ts`

- [ ] **Step 1: Write the failing D1 table test**

Append to `packages/server/test/edge-v1-control-plane.test.ts`:

```ts
import { createTestEnv } from "./helpers/test-env";
import { edgeCommand, edgeEventReceipt, spoolDeployment } from "@orrn/db/schema/spool";
import { printerProfile, printLog } from "@orrn/db/schema/printing";

describe("edge v1 D1 schema", () => {
  test("supports credential rotation columns, edge_command, and edge_event_receipt", async () => {
    const t = await createTestEnv();
    try {
      const rows = await t.db.select().from(edgeCommand).all();
      const receipts = await t.db.select().from(edgeEventReceipt).all();
      expect(rows).toEqual([]);
      expect(receipts).toEqual([]);
      expect(spoolDeployment.pendingSecretWrapped).toBeDefined();
      expect(printerProfile.deploymentId).toBeDefined();
      expect(printLog.copies).toBeDefined();
    } finally {
      await t.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: FAIL with missing `edgeCommand`, `edgeEventReceipt`, and migration columns.

- [ ] **Step 3: Update `packages/db/src/schema/spool.ts`, `packages/db/src/schema/printing.ts`, and create migration `0043_edge_v1_control_plane.sql`**

In `packages/db/src/schema/spool.ts`, add columns to `edgeNodeDeployment` and add `edgeCommand` plus `edgeEventReceipt`:

```ts
    enrollmentExpiresAt: integer("enrollment_expires_at", { mode: "timestamp_ms" }),
    enrollmentUsedAt: integer("enrollment_used_at", { mode: "timestamp_ms" }),
    installId: text("install_id"),
    credentialVersion: integer("credential_version").notNull().default(1),
    pendingCredentialVersion: integer("pending_credential_version"),
    pendingSecretHash: text("pending_secret_hash"),
    pendingSecretWrapped: text("pending_secret_wrapped"),
    configVersion: integer("config_version").notNull().default(1),
    appliedConfigVersion: integer("applied_config_version").notNull().default(0),
    reportedPrinters: text("reported_printers", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
```

And append to `packages/db/src/schema/spool.ts`:

```ts
export const edgeCommand = sqliteTable(
  "edge_command",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => edgeNodeDeployment.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    jobKey: text("job_key"),
    payloadHash: text("payload_hash"),
    printLogId: text("print_log_id"),
    state: text("state").notNull().default("queued"),
    leaseId: text("lease_id"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    deliveryCount: integer("delivery_count").notNull().default(0),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolutionJson: text("resolution_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("edge_command_deployment_state_idx").on(table.deploymentId, table.state, table.createdAt),
    index("edge_command_company_job_key_idx").on(table.companyId, table.jobKey),
  ],
);

export const edgeEventReceipt = sqliteTable(
  "edge_event_receipt",
  {
    eventId: text("event_id").notNull(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => edgeNodeDeployment.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    responseJson: text("response_json").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("edge_event_receipt_deployment_event_unique").on(table.deploymentId, table.eventId),
  ],
);
```

In `packages/db/src/schema/printing.ts`, update `printStatuses`, `printerProfile`, and `printLog`:

```ts
export const printStatuses = [
  "queued",
  "accepted",
  "sent",
  "success",
  "failed",
  "outcome_unknown",
  "cancelled",
] as const;
```

Add `deploymentId: text("deployment_id")` to `printerProfile`, and add `deploymentId: text("deployment_id")`, `copies: integer("copies").notNull().default(1)`, plus `commandId: text("command_id")` to `printLog`.

Create `packages/db/src/migrations/0043_edge_v1_control_plane.sql`:

```sql
ALTER TABLE `spool_deployment` ADD `enrollment_expires_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `enrollment_used_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `install_id` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `credential_version` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_credential_version` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_secret_hash` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_secret_wrapped` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `config_version` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `applied_config_version` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `reported_printers` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `deployment_id` text;--> statement-breakpoint
ALTER TABLE `print_log` ADD `deployment_id` text;--> statement-breakpoint
ALTER TABLE `print_log` ADD `copies` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `print_log` ADD `command_id` text;--> statement-breakpoint
CREATE TABLE `edge_command` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL,
  `deployment_id` text NOT NULL,
  `kind` text NOT NULL,
  `payload_json` text NOT NULL,
  `job_key` text,
  `payload_hash` text,
  `print_log_id` text,
  `state` text NOT NULL DEFAULT 'queued',
  `lease_id` text,
  `lease_expires_at` integer,
  `delivery_count` integer NOT NULL DEFAULT 0,
  `resolved_at` integer,
  `resolution_json` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`deployment_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `edge_command_deployment_state_idx` ON `edge_command` (`deployment_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `edge_command_company_job_key_idx` ON `edge_command` (`company_id`,`job_key`);--> statement-breakpoint
CREATE TABLE `edge_event_receipt` (
  `event_id` text NOT NULL,
  `deployment_id` text NOT NULL,
  `company_id` text NOT NULL,
  `kind` text NOT NULL,
  `response_json` text NOT NULL,
  `received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`deployment_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `edge_event_receipt_deployment_event_unique` ON `edge_event_receipt` (`deployment_id`,`event_id`);
```

Add entry `idx: 43`, `tag: "0043_edge_v1_control_plane"` to `packages/db/src/migrations/meta/_journal.json`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/spool.ts packages/db/src/schema/printing.ts packages/db/src/migrations/0043_edge_v1_control_plane.sql packages/db/src/migrations/meta/_journal.json packages/server/test/edge-v1-control-plane.test.ts
git commit -m "feat(db): add edge v1 command, receipt, and rotation schema"
```

---

### Task 3: Implement Enrollment, Overlapping Rotation, and Node Authentication (`packages/server/src/lib/edge-v1.ts`)

**Files:**
- Create: `packages/server/src/lib/edge-v1.ts`
- Test: `packages/server/test/edge-v1-control-plane.test.ts`

- [ ] **Step 1: Write the failing enrollment and rotation tests**

Append to `packages/server/test/edge-v1-control-plane.test.ts`:

```ts
import {
  authenticateEdgeV1Request,
  confirmEdgeCredentialRotation,
  createEdgeEnrollmentNode,
  exchangeEdgeEnrollmentToken,
  stageEdgeSecretRotation,
} from "../src/lib/edge-v1";
import { signSpoolRequest } from "../src/lib/spool-crypto";

describe("edge v1 enrollment and dual-secret rotation", () => {
  test("enrolls once within 15m, rejects token reuse, and rotates secrets without stranding", async () => {
    const t = await createTestEnv();
    try {
      const created = await createEdgeEnrollmentNode(t.db, {
        companyId: t.company.id,
        nodeName: "Fourcubes Plant Node",
        siteLabel: "Surat Plant",
        masterKey: t.env.ORRN_MASTER_KEY,
        nowMs: 1_700_000_000_000,
      });

      const enrolled = await exchangeEdgeEnrollmentToken(t.db, {
        enrollmentToken: created.enrollmentToken,
        agentVersion: "1.0.0",
        os: "linux",
        arch: "amd64",
        installId: "019a0000-0000-7000-8000-000000000001",
        apiOrigin: "https://api.orrn.in",
        masterKey: t.env.ORRN_MASTER_KEY,
        nowMs: 1_700_000_060_000,
      });
      expect(enrolled.ok).toBe(true);
      if (!enrolled.ok) return;

      const replay = await exchangeEdgeEnrollmentToken(t.db, {
        enrollmentToken: created.enrollmentToken,
        agentVersion: "1.0.0",
        os: "linux",
        arch: "amd64",
        installId: "019a0000-0000-7000-8000-000000000001",
        apiOrigin: "https://api.orrn.in",
        masterKey: t.env.ORRN_MASTER_KEY,
        nowMs: 1_700_000_061_000,
      });
      expect(replay.ok).toBe(false);

      const staged = await stageEdgeSecretRotation(t.db, {
        deploymentId: created.deploymentId,
        masterKey: t.env.ORRN_MASTER_KEY,
      });
      expect(staged.pendingCredentialVersion).toBe(2);

      // Old secret still authenticates while version 2 is unconfirmed
      const body = new TextEncoder().encode(JSON.stringify({ limit: 10 }));
      const oldToken = await signSpoolRequest("POST", "/api/edge/v1/commands/poll", body, enrolled.value.nodeSecret);
      const authOld = await authenticateEdgeV1Request(t.db, {
        method: "POST",
        path: "/api/edge/v1/commands/poll",
        rawBody: body,
        nodeIdHeader: enrolled.value.instanceId,
        authorization: `Bearer ${oldToken}`,
        masterKey: t.env.ORRN_MASTER_KEY,
      });
      expect(authOld.ok).toBe(true);

      // Confirm with new secret (idempotent across retries)
      const confirmBody = new TextEncoder().encode(JSON.stringify({ credentialVersion: 2 }));
      const newToken = await signSpoolRequest(
        "POST",
        "/api/edge/v1/credentials/confirm",
        confirmBody,
        staged.pendingSecret,
      );
      const confirmed1 = await confirmEdgeCredentialRotation(t.db, {
        rawBody: confirmBody,
        nodeIdHeader: enrolled.value.instanceId,
        authorization: `Bearer ${newToken}`,
        masterKey: t.env.ORRN_MASTER_KEY,
      });
      expect(confirmed1.ok).toBe(true);

      const confirmed2 = await confirmEdgeCredentialRotation(t.db, {
        rawBody: confirmBody,
        nodeIdHeader: enrolled.value.instanceId,
        authorization: `Bearer ${newToken}`,
        masterKey: t.env.ORRN_MASTER_KEY,
      });
      expect(confirmed2.ok).toBe(true);

      // Old secret is rejected after confirmation
      const authOldAfter = await authenticateEdgeV1Request(t.db, {
        method: "POST",
        path: "/api/edge/v1/commands/poll",
        rawBody: body,
        nodeIdHeader: enrolled.value.instanceId,
        authorization: `Bearer ${oldToken}`,
        masterKey: t.env.ORRN_MASTER_KEY,
      });
      expect(authOldAfter.ok).toBe(false);
    } finally {
      await t.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: FAIL with module `../src/lib/edge-v1` not found.

- [ ] **Step 3: Implement enrollment, rotation, and authentication in `packages/server/src/lib/edge-v1.ts`**

Create `packages/server/src/lib/edge-v1.ts` with:
- `createEdgeEnrollmentNode`: inserts `spool_deployment` with `enrollmentTokenHash = sha256(rawToken)`, `enrollmentIssuedAt = now`, `enrollmentExpiresAt = now + 15 * 60_000`, `credentialVersion = 1`, `configVersion = 1`, and a wrapped `sharedSecret` without calling Cloudflare APIs.
- `exchangeEdgeEnrollmentToken`: validates `edgeEnrollRequestSchema`, checks `enrollmentUsedAt IS NULL` and `enrollmentExpiresAt > now`, allows idempotent re-enrollment only when `installId` matches existing `installId`, marks `enrollmentUsedAt`, and returns `EdgeEnrollResponse`.
- `stageEdgeSecretRotation`: generates `pendingSecret`, wraps it in `pendingSecretWrapped`, sets `pendingCredentialVersion = credentialVersion + 1`, and increments `configVersion`.
- `authenticateEdgeV1Request`: verifies `X-ORRN-Node-ID`, rejects `status === "revoked"` with `{ code: "node_revoked" }`, verifies HMAC against `sharedSecretWrapped` or (when present) `pendingSecretWrapped`, and returns the authenticated node plus which credential slot matched.
- `confirmEdgeCredentialRotation`: requires signature by `pendingSecretWrapped` (or already-promoted `sharedSecretWrapped` at `credentialVersion === requestedVersion`), promotes `pendingSecretWrapped` → `sharedSecretWrapped`, sets `credentialVersion = requestedVersion`, clears `pending*`, and returns `{ credentialVersion }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/edge-v1.ts packages/server/test/edge-v1-control-plane.test.ts
git commit -m "feat(server): add edge v1 enrollment and overlapping secret rotation"
```

---

### Task 4: Implement Durable Command Enqueue, Lease Polling, Acknowledgement, and Monotonic Events

**Files:**
- Modify: `packages/server/src/lib/edge-v1.ts`
- Create: `apps/server/src/edge-v1-routes.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `packages/server/src/routers/spool.ts`
- Modify: `packages/server/src/routers/platform/spool.ts`
- Test: `packages/server/test/edge-v1-control-plane.test.ts`

- [ ] **Step 1: Write the failing command lease, conflict rejection, and monotonic event tests**

Append to `packages/server/test/edge-v1-control-plane.test.ts`:

```ts
import {
  acknowledgeEdgeCommand,
  enqueueEdgePrintCommand,
  ingestEdgeEventBatch,
  pollEdgeCommands,
} from "../src/lib/edge-v1";
import { bundle } from "@orrn/db/schema/inventory";
import { eq } from "drizzle-orm";

describe("edge v1 command leases and event receipts", () => {
  test("redelivers expired leases with the same commandId, handles conflict rejection, and prevents status regression", async () => {
    const t = await createTestEnv();
    try {
      const node = await createEdgeEnrollmentNode(t.db, {
        companyId: t.company.id,
        nodeName: "Plant Node",
        siteLabel: "Surat",
        masterKey: t.env.ORRN_MASTER_KEY,
      });

      const cmd = await enqueueEdgePrintCommand(t.db, {
        companyId: t.company.id,
        deploymentId: node.deploymentId,
        templateId: t.template.id,
        profileId: t.profile.id,
        bundleId: t.bundle.id,
        requestedBy: t.user.id,
        jobKey: "bundle:26I4086:label:v1:attempt:1",
        payloadHash: "a".repeat(64),
        copies: 2,
        labelVersion: 1,
        attempt: 1,
        variables: { bundleSerial: "26I4086" },
      });

      const poll1 = await pollEdgeCommands(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        limit: 10,
        nowMs: 1_700_000_000_000,
      });
      expect(poll1.commands).toHaveLength(1);
      expect(poll1.commands[0]!.commandId).toBe(cmd.commandId);

      // Before lease expiry, another poll sees 0 commands
      const poll2 = await pollEdgeCommands(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        limit: 10,
        nowMs: 1_700_000_010_000,
      });
      expect(poll2.commands).toHaveLength(0);

      // After 60s lease expiry, the exact same commandId is redelivered
      const poll3 = await pollEdgeCommands(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        limit: 10,
        nowMs: 1_700_000_061_000,
      });
      expect(poll3.commands).toHaveLength(1);
      expect(poll3.commands[0]!.commandId).toBe(cmd.commandId);

      // Durable acceptance clears bundle.stickerStale and is idempotent on stale/repeated ack
      const ack1 = await acknowledgeEdgeCommand(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        commandId: cmd.commandId,
        leaseId: poll3.commands[0]!.leaseId,
        outcome: "accepted",
        resolution: "accepted",
        agentJobId: "42",
        detail: null,
      });
      expect(ack1.outcome).toBe("accepted");

      const ackStale = await acknowledgeEdgeCommand(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        commandId: cmd.commandId,
        leaseId: poll1.commands[0]!.leaseId,
        outcome: "rejected",
        resolution: "job_key_conflict",
        agentJobId: null,
        detail: "stale lease must not overwrite",
      });
      expect(ackStale.outcome).toBe("accepted");

      // Event batch moves print_log to sent, and a delayed accepted event cannot regress it
      const evSent = await ingestEdgeEventBatch(t.db, {
        deploymentId: node.deploymentId,
        companyId: t.company.id,
        events: [
          {
            eventId: "019a0000-0000-7000-8000-000000000101",
            aggregateId: "42",
            sequence: 2,
            kind: "job_state_changed",
            occurredAt: "2026-10-26T12:00:02.000Z",
            payload: { state: "sent", jobKey: "bundle:26I4086:label:v1:attempt:1", reason: null },
          },
          {
            eventId: "019a0000-0000-7000-8000-000000000100",
            aggregateId: "42",
            sequence: 1,
            kind: "job_state_changed",
            occurredAt: "2026-10-26T12:00:01.000Z",
            payload: { state: "accepted", jobKey: "bundle:26I4086:label:v1:attempt:1", reason: null },
          },
        ],
      });
      expect(evSent.processed).toBe(2);

      const logRow = await t.db.select().from(printLog).where(eq(printLog.id, cmd.printLogId)).get();
      expect(logRow?.status).toBe("sent");
    } finally {
      await t.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts`
Expected: FAIL with missing command/event exports.

- [ ] **Step 3: Implement command queue, event receipts, Hono routes, and router wiring**

1. Add `enqueueEdgePrintCommand`, `pollEdgeCommands`, `acknowledgeEdgeCommand`, `buildEdgeDesiredConfig`, and `ingestEdgeEventBatch` in `packages/server/src/lib/edge-v1.ts`.
2. Mount `/api/edge/v1/enroll`, `/api/edge/v1/commands/poll`, `/api/edge/v1/commands/ack`, `/api/edge/v1/events`, `/api/edge/v1/config`, and `/api/edge/v1/credentials/confirm` in `apps/server/src/edge-v1-routes.ts` and register it in `apps/server/src/index.ts`.
3. Update `packages/server/src/routers/platform/spool.ts` and `packages/server/src/routers/spool.ts` to use `createEdgeEnrollmentNode`, `stageEdgeSecretRotation`, and `enqueueEdgePrintCommand`, routing by explicit `profile.deploymentId`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test packages/server/test/edge-v1-control-plane.test.ts && bun run --cwd packages/server check-types`
Expected: PASS with 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/edge-v1.ts apps/server/src/edge-v1-routes.ts apps/server/src/index.ts packages/server/src/routers/spool.ts packages/server/src/routers/platform/spool.ts packages/server/test/edge-v1-control-plane.test.ts
git commit -m "feat(server): implement edge v1 command leases, acks, and event receipts"
```
