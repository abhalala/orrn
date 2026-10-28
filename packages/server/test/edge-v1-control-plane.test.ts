import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { bundle } from "@orrn/db/schema/inventory";
import { labelTemplate, printerProfile, printLog } from "@orrn/db/schema/printing";
import { edgeCommand, edgeEventReceipt, spoolDeployment } from "@orrn/db/schema/spool";
import {
  edgeCommandAckRequestSchema,
  edgeConfirmCredentialRequestSchema,
  edgeEnrollRequestSchema,
  edgeEventsBatchRequestSchema,
  edgeJobStates,
  edgePollRequestSchema,
} from "@orrn/edge-runtime";

import {
  acknowledgeEdgeCommand,
  authenticateEdgeV1Request,
  buildEdgeDesiredConfig,
  clearEdgeV1ReplayCache,
  confirmEdgeCredentialRotation,
  createEdgeEnrollmentNode,
  enqueueEdgeCancelCommand,
  enqueueEdgePrintCommand,
  enqueueEdgeTestPrintCommand,
  exchangeEdgeEnrollmentToken,
  ingestEdgeEventBatch,
  pollEdgeCommands,
  setEdgeNodePrinters,
  stageEdgeSecretRotation,
  retryEdgePrintCommand,
} from "../src/lib/edge-v1";
import { signSpoolRequest } from "../src/lib/spool-crypto";
import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function seedPrintFixture(companyId: string, deploymentId: string, jobKey: string) {
  const dieId = await env.seedDie(companyId);
  const [seededBundle] = await env.seedBundles(companyId, dieId, 1);
  await env.db.update(bundle).set({ stickerStale: true }).where(eq(bundle.id, seededBundle!.id));
  const templateId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({
    id: templateId,
    companyId,
    name: `Label ${crypto.randomUUID()}`,
    kind: "bundle",
    schema: { width_mm: 100, height_mm: 50 },
    version: 3,
  });
  await env.db.insert(printerProfile).values({
    id: profileId,
    companyId,
    name: `Printer ${crypto.randomUUID()}`,
    spoolPrinterId: "tsc-1",
    deploymentId,
    templateId,
    defaultCopies: 2,
  });
  const command = await enqueueEdgePrintCommand(env.db, {
    companyId,
    deploymentId,
    templateId,
    profileId,
    bundleId: seededBundle!.id,
    jobKey,
    payloadHash: "a".repeat(64),
    copies: 2,
    labelVersion: 3,
    attempt: 1,
    variables: { bundleSerial: "26I4086", frozen: true },
  });
  return { ...command, bundleId: seededBundle!.id, templateId, profileId };
}

async function leaseAndAccept(companyId: string, deploymentId: string, commandId: string, agentJobId: string) {
  const poll = await pollEdgeCommands(env.db, { companyId, deploymentId });
  const leased = poll.commands.find((command) => command.commandId === commandId);
  expect(leased).toBeDefined();
  return acknowledgeEdgeCommand(env.db, {
    companyId,
    deploymentId,
    commandId,
    leaseId: leased!.leaseId,
    outcome: "accepted",
    resolution: "accepted",
    agentJobId,
    detail: null,
  });
}

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

describe("edge v1 D1 schema", () => {
  test("supports credential rotation columns, edge_command, and edge_event_receipt", async () => {
    const rows = await env.db.select().from(edgeCommand).all();
    const receipts = await env.db.select().from(edgeEventReceipt).all();
    expect(rows).toEqual([]);
    expect(receipts).toEqual([]);
    expect(spoolDeployment.pendingSecretWrapped).toBeDefined();
    expect(printerProfile.deploymentId).toBeDefined();
    expect(printLog.copies).toBeDefined();
  });
});

describe("edge v1 enrollment and dual-secret rotation", () => {
  test("enrolls within 15m, permits same-install retries, and rotates secrets without stranding", async () => {
    clearEdgeV1ReplayCache();
    const { companyId } = await env.seedCompany();
    const created = await createEdgeEnrollmentNode(env.db, {
      companyId,
      nodeName: "Fourcubes Plant Node",
      siteLabel: "Surat Plant",
      masterKey: DEV_MASTER_KEY,
      nowMs: 1_700_000_000_000,
    });

    // Expired enrollment attempt (>15 minutes) is rejected without consuming the token
    const expiredAttempt = await exchangeEdgeEnrollmentToken(env.db, {
      enrollmentToken: created.enrollmentToken,
      agentVersion: "1.0.0",
      os: "linux",
      arch: "amd64",
      installId: "019a0000-0000-7000-8000-000000000001",
      apiOrigin: "https://api.orrn.in",
      masterKey: DEV_MASTER_KEY,
      nowMs: 1_700_000_000_000 + 16 * 60_000,
    });
    expect(expiredAttempt.ok).toBe(false);

    const enrolled = await exchangeEdgeEnrollmentToken(env.db, {
      enrollmentToken: created.enrollmentToken,
      agentVersion: "1.0.0",
      os: "linux",
      arch: "amd64",
      installId: "019a0000-0000-7000-8000-000000000001",
      apiOrigin: "https://api.orrn.in",
      masterKey: DEV_MASTER_KEY,
      nowMs: 1_700_000_060_000,
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    // The same installation can recover a lost enrollment response
    const replay = await exchangeEdgeEnrollmentToken(env.db, {
      enrollmentToken: created.enrollmentToken,
      agentVersion: "1.0.0",
      os: "linux",
      arch: "amd64",
      installId: "019a0000-0000-7000-8000-000000000001",
      apiOrigin: "https://api.orrn.in",
      masterKey: DEV_MASTER_KEY,
      nowMs: 1_700_000_061_000,
    });
    expect(replay.ok).toBe(true);

    const staged = await stageEdgeSecretRotation(env.db, {
      deploymentId: created.deploymentId,
      masterKey: DEV_MASTER_KEY,
    });
    expect(staged.pendingCredentialVersion).toBe(2);

    // Desired config includes pendingSecret and pendingCredentialVersion while rotation is staged
    const desiredDuringRotation = await buildEdgeDesiredConfig(env.db, {
      deploymentId: created.deploymentId,
      companyId,
      masterKey: DEV_MASTER_KEY,
    });
    expect(desiredDuringRotation.pendingCredentialVersion).toBe(2);
    expect(desiredDuringRotation.pendingSecret).toBe(staged.pendingSecret);

    // Old secret still authenticates while version 2 is unconfirmed
    const body = new TextEncoder().encode(JSON.stringify({ limit: 10 }));
    const oldToken = await signSpoolRequest("POST", "/api/edge/v1/commands/poll", body, enrolled.value.nodeSecret);
    const authOld = await authenticateEdgeV1Request(env.db, {
      method: "POST",
      path: "/api/edge/v1/commands/poll",
      rawBody: body,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${oldToken}`,
      masterKey: DEV_MASTER_KEY,
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
    const confirmed1 = await confirmEdgeCredentialRotation(env.db, {
      rawBody: confirmBody,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${newToken}`,
      masterKey: DEV_MASTER_KEY,
    });
    expect(confirmed1.ok).toBe(true);

    const confirmed2 = await confirmEdgeCredentialRotation(env.db, {
      rawBody: confirmBody,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${newToken}`,
      masterKey: DEV_MASTER_KEY,
    });
    expect(confirmed2.ok).toBe(true);

    const nextRotation = await stageEdgeSecretRotation(env.db, {
      deploymentId: created.deploymentId,
      masterKey: DEV_MASTER_KEY,
    });
    const retryPreviousConfirmation = await confirmEdgeCredentialRotation(env.db, {
      rawBody: confirmBody,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${newToken}`,
      masterKey: DEV_MASTER_KEY,
    });
    expect(retryPreviousConfirmation.ok).toBe(true);
    const rotationAfterRetry = await env.db
      .select()
      .from(spoolDeployment)
      .where(eq(spoolDeployment.id, created.deploymentId))
      .get();
    expect(rotationAfterRetry?.pendingCredentialVersion).toBe(nextRotation.pendingCredentialVersion);
    expect(rotationAfterRetry?.pendingSecretWrapped).not.toBeNull();

    // Old secret is rejected after confirmation
    const authOldAfter = await authenticateEdgeV1Request(env.db, {
      method: "POST",
      path: "/api/edge/v1/commands/poll",
      rawBody: body,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${oldToken}`,
      masterKey: DEV_MASTER_KEY,
    });
    expect(authOldAfter.ok).toBe(false);

    // Revoked node returns 403 { code: "node_revoked" }
    await env.db
      .update(spoolDeployment)
      .set({ status: "revoked" })
      .where(eq(spoolDeployment.id, created.deploymentId));
    const pollTokenAfter = await signSpoolRequest("POST", "/api/edge/v1/commands/poll", body, staged.pendingSecret);
    const authRevoked = await authenticateEdgeV1Request(env.db, {
      method: "POST",
      path: "/api/edge/v1/commands/poll",
      rawBody: body,
      nodeIdHeader: enrolled.value.instanceId,
      authorization: `Bearer ${pollTokenAfter}`,
      masterKey: DEV_MASTER_KEY,
    });
    expect(authRevoked.ok).toBe(false);
    if (!authRevoked.ok) {
      expect(authRevoked.status).toBe(403);
      expect(authRevoked.body.code).toBe("node_revoked");
    }
  });

  test("allows only one atomic installation claim and reuses an existing pending rotation", async () => {
    const { companyId } = await env.seedCompany();
    const created = await createEdgeEnrollmentNode(env.db, {
      companyId,
      nodeName: "Concurrent Node",
      siteLabel: "Plant",
      masterKey: DEV_MASTER_KEY,
    });
    const installIds = [crypto.randomUUID(), crypto.randomUUID()];
    const enrollments = await Promise.all(
      installIds.map((installId) =>
        exchangeEdgeEnrollmentToken(env.db, {
          enrollmentToken: created.enrollmentToken,
          agentVersion: "1.0.0",
          os: "linux",
          arch: "arm64",
          installId,
          apiOrigin: "https://api.orrn.in",
          masterKey: DEV_MASTER_KEY,
        }),
      ),
    );
    const successes = enrollments.filter((result) => result.ok);
    expect(successes).toHaveLength(1);
    const winningInstallId = installIds[enrollments.findIndex((result) => result.ok)]!;
    const stored = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, created.deploymentId)).get();
    expect(stored?.installId).toBe(winningInstallId);

    const replay = await exchangeEdgeEnrollmentToken(env.db, {
      enrollmentToken: created.enrollmentToken,
      agentVersion: "1.0.0",
      os: "linux",
      arch: "arm64",
      installId: winningInstallId,
      apiOrigin: "https://api.orrn.in",
      masterKey: DEV_MASTER_KEY,
    });
    expect(replay.ok).toBe(true);

    const rotations = await Promise.all([
      stageEdgeSecretRotation(env.db, { deploymentId: created.deploymentId, masterKey: DEV_MASTER_KEY }),
      stageEdgeSecretRotation(env.db, { deploymentId: created.deploymentId, masterKey: DEV_MASTER_KEY }),
    ]);
    expect(rotations[0]).toEqual(rotations[1]);
    const repeated = await stageEdgeSecretRotation(env.db, {
      deploymentId: created.deploymentId,
      masterKey: DEV_MASTER_KEY,
    });
    expect(repeated).toEqual(rotations[0]);
  });
});

describe("edge v1 command leases and event receipts", () => {
  test("redelivers expired leases with the same commandId, handles conflict rejection, and prevents status regression", async () => {
    const { companyId, users } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const [seededBundle] = await env.seedBundles(companyId, dieId, 1);
    await env.db.update(bundle).set({ stickerStale: true }).where(eq(bundle.id, seededBundle!.id));

    const node = await createEdgeEnrollmentNode(env.db, {
      companyId,
      nodeName: "Plant Node",
      siteLabel: "Surat",
      masterKey: DEV_MASTER_KEY,
    });

    const templateId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    await env.db.insert(labelTemplate).values({
      id: templateId,
      companyId,
      name: "Bundle Label",
      kind: "bundle",
      schema: { width_mm: 100, height_mm: 50 },
      spoolTemplateId: "1",
      version: 1,
    });
    await env.db.insert(printerProfile).values({
      id: profileId,
      companyId,
      name: "Packing Printer",
      spoolPrinterId: "tsc-1",
      deploymentId: node.deploymentId,
      templateId,
      defaultCopies: 2,
    });

    const cmd = await enqueueEdgePrintCommand(env.db, {
      companyId,
      deploymentId: node.deploymentId,
      templateId,
      profileId,
      bundleId: seededBundle!.id,
      requestedBy: users.packer.id,
      jobKey: "bundle:26I4086:label:v1:attempt:1",
      payloadHash: "a".repeat(64),
      copies: 2,
      labelVersion: 1,
      attempt: 1,
      variables: { bundleSerial: "26I4086" },
    });

    const poll1 = await pollEdgeCommands(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      limit: 10,
      nowMs: 1_700_000_000_000,
    });
    expect(poll1.commands).toHaveLength(1);
    expect(poll1.commands[0]!.commandId).toBe(cmd.commandId);
    expect(poll1.commands[0]!.deliveryCount).toBe(1);

    // Before lease expiry, another poll sees 0 commands
    const poll2 = await pollEdgeCommands(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      limit: 10,
      nowMs: 1_700_000_010_000,
    });
    expect(poll2.commands).toHaveLength(0);

    // After 60s lease expiry, the exact same commandId is redelivered with incremented deliveryCount
    const poll3 = await pollEdgeCommands(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      limit: 10,
      nowMs: 1_700_000_061_000,
    });
    expect(poll3.commands).toHaveLength(1);
    expect(poll3.commands[0]!.commandId).toBe(cmd.commandId);
    expect(poll3.commands[0]!.deliveryCount).toBe(2);

    // Durable acceptance clears bundle.stickerStale and is idempotent on stale/repeated ack
    const ack1 = await acknowledgeEdgeCommand(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      commandId: cmd.commandId,
      leaseId: poll3.commands[0]!.leaseId,
      outcome: "accepted",
      resolution: "accepted",
      agentJobId: "42",
      detail: null,
    });
    expect(ack1.outcome).toBe("accepted");

    const updatedBundle = await env.db.select().from(bundle).where(eq(bundle.id, seededBundle!.id)).get();
    expect(updatedBundle?.stickerStale).toBe(false);

    const ackStale = await acknowledgeEdgeCommand(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      commandId: cmd.commandId,
      leaseId: poll1.commands[0]!.leaseId,
      outcome: "rejected",
      resolution: "job_key_conflict",
      agentJobId: null,
      detail: "stale lease must not overwrite",
    });
    expect(ackStale.outcome).toBe("accepted");

    // Event batch moves print_log to sent, and a delayed accepted event cannot regress it
    const evSent = await ingestEdgeEventBatch(env.db, {
      deploymentId: node.deploymentId,
      companyId,
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

    // Duplicate event batch is deduplicated via edge_event_receipt
    const evDup = await ingestEdgeEventBatch(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      events: [
        {
          eventId: "019a0000-0000-7000-8000-000000000101",
          aggregateId: "42",
          sequence: 2,
          kind: "job_state_changed",
          occurredAt: "2026-10-26T12:00:02.000Z",
          payload: { state: "sent", jobKey: "bundle:26I4086:label:v1:attempt:1", reason: null },
        },
      ],
    });
    expect(evDup.processed).toBe(0);
    expect(evDup.deduplicated).toBe(1);

    const logRow = await env.db.select().from(printLog).where(eq(printLog.id, cmd.printLogId)).get();
    expect(logRow?.status).toBe("sent");

    // Offline reprint event creates a new print_log record with origin = "offline_reprint"
    await ingestEdgeEventBatch(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      events: [
        {
          eventId: "019a0000-0000-7000-8000-000000000102",
          aggregateId: "43",
          sequence: 1,
          kind: "offline_reprint",
          occurredAt: "2026-10-26T12:05:00.000Z",
          payload: {
            sourceJobKey: "bundle:26I4086:label:v1:attempt:1",
            jobKey: "bundle:26I4086:label:v1:attempt:2:offline",
            operator: "operator1",
            reason: "damaged sticker",
            copies: 1,
          },
        },
      ],
    });

    const reprintRow = await env.db
      .select()
      .from(printLog)
      .where(eq(printLog.jobKey, "bundle:26I4086:label:v1:attempt:2:offline"))
      .get();
    expect(reprintRow).toBeDefined();
    expect(reprintRow?.variables).toMatchObject({ origin: "offline_reprint" });
    expect(reprintRow?.status).toBe("accepted");

    // The agent's later state event for the reprint job moves it to sent; a replayed
    // reprint under a new event ID does not duplicate it; an unknown source is never
    // attributed to another bundle.
    await ingestEdgeEventBatch(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      events: [
        {
          eventId: "019a0000-0000-7000-8000-000000000103",
          aggregateId: "43",
          sequence: 2,
          kind: "job_state_changed",
          occurredAt: "2026-10-26T12:05:01.000Z",
          payload: { state: "sent", jobKey: "bundle:26I4086:label:v1:attempt:2:offline", reason: null },
        },
        {
          eventId: "019a0000-0000-7000-8000-000000000104",
          aggregateId: "43",
          sequence: 1,
          kind: "offline_reprint",
          occurredAt: "2026-10-26T12:05:00.000Z",
          payload: {
            sourceJobKey: "bundle:26I4086:label:v1:attempt:1",
            jobKey: "bundle:26I4086:label:v1:attempt:2:offline",
            operator: "operator1",
          },
        },
        {
          eventId: "019a0000-0000-7000-8000-000000000105",
          aggregateId: "44",
          sequence: 1,
          kind: "offline_reprint",
          occurredAt: "2026-10-26T12:06:00.000Z",
          payload: { sourceJobKey: "bundle:NOPE:label:v1:attempt:1", jobKey: "bundle:NOPE:offline", operator: "operator1" },
        },
      ],
    });
    const reprints = await env.db
      .select()
      .from(printLog)
      .where(eq(printLog.jobKey, "bundle:26I4086:label:v1:attempt:2:offline"))
      .all();
    expect(reprints.map((r) => r.status)).toEqual(["sent"]);
    expect(await env.db.select().from(printLog).where(eq(printLog.jobKey, "bundle:NOPE:offline")).get()).toBeUndefined();

    // Conflict rejection marks print_log failed and leaves stickerStale untouched
    await env.db.update(bundle).set({ stickerStale: true }).where(eq(bundle.id, seededBundle!.id));
    const conflictCmd = await enqueueEdgePrintCommand(env.db, {
      companyId,
      deploymentId: node.deploymentId,
      templateId,
      profileId,
      bundleId: seededBundle!.id,
      requestedBy: users.packer.id,
      jobKey: "bundle:26I4086:label:v1:attempt:1",
      payloadHash: "b".repeat(64),
      copies: 3,
      labelVersion: 1,
      attempt: 1,
      variables: { bundleSerial: "26I4086" },
    });
    const conflictPoll = await pollEdgeCommands(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      limit: 10,
      nowMs: 1_700_000_100_000,
    });
    const conflictLeased = conflictPoll.commands.find((c) => c.commandId === conflictCmd.commandId)!;
    await acknowledgeEdgeCommand(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      commandId: conflictCmd.commandId,
      leaseId: conflictLeased.leaseId,
      outcome: "rejected",
      resolution: "job_key_conflict",
      agentJobId: null,
      detail: "Payload hash mismatch",
    });

    const conflictLog = await env.db.select().from(printLog).where(eq(printLog.id, conflictCmd.printLogId)).get();
    expect(conflictLog?.status).toBe("failed");
    expect(conflictLog?.responseText).toContain("job_key_conflict");
    const bundleAfterConflict = await env.db.select().from(bundle).where(eq(bundle.id, seededBundle!.id)).get();
    expect(bundleAfterConflict?.stickerStale).toBe(true);

    // Enqueue test_print and cancel_job commands
    const testCmd = await enqueueEdgeTestPrintCommand(env.db, {
      companyId,
      deploymentId: node.deploymentId,
      printerId: "tsc-1",
    });
    expect(testCmd.commandId).toBeDefined();

    const cancelCmd = await enqueueEdgeCancelCommand(env.db, {
      companyId,
      deploymentId: node.deploymentId,
      printLogId: cmd.printLogId,
      agentJobId: "42",
      jobKey: "bundle:26I4086:label:v1:attempt:1",
    });
    expect(cancelCmd.commandId).toBeDefined();
  });
});

describe("edge v1 desired printers", () => {
  test("replaces the node's printers, bumps configVersion, and serves them in desired config", async () => {
    const { companyId } = await env.seedCompany();
    const node = await createEdgeEnrollmentNode(env.db, {
      companyId,
      nodeName: "Fourcubes Plant Node",
      siteLabel: "Fourcubes Packing",
      masterKey: DEV_MASTER_KEY,
    });
    const before = await buildEdgeDesiredConfig(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      masterKey: DEV_MASTER_KEY,
    });
    expect(before.printers).toEqual([]);

    const set = await setEdgeNodePrinters(env.db, {
      deploymentId: node.deploymentId,
      printers: [{ printerId: "1", name: "Packing TA220", host: "20.0.0.182", paused: true, labelWidthMm: 102.25, labelHeightMm: 76.2 }],
    });
    expect(set.configVersion).toBe(before.configVersion + 1);

    const after = await buildEdgeDesiredConfig(env.db, {
      deploymentId: node.deploymentId,
      companyId,
      masterKey: DEV_MASTER_KEY,
    });
    expect(after.configVersion).toBe(set.configVersion);
    expect(after.printers).toEqual([
      { printerId: "1", name: "Packing TA220", host: "20.0.0.182", port: 9100, paused: true, labelWidthMm: 102.25, labelHeightMm: 76.2 },
    ]);

    await expect(
      setEdgeNodePrinters(env.db, {
        deploymentId: node.deploymentId,
        printers: [
          { printerId: "1", name: "A", host: "20.0.0.182" },
          { printerId: "1", name: "B", host: "20.0.0.183" },
        ],
      }),
    ).rejects.toThrow("printerId must be unique");
    const unchanged = await env.db
      .select({ configVersion: spoolDeployment.configVersion })
      .from(spoolDeployment)
      .where(eq(spoolDeployment.id, node.deploymentId))
      .get();
    expect(unchanged?.configVersion).toBe(set.configVersion);
  });
});

describe("edge v1 atomic concurrency and isolation", () => {
  test("leases once, rolls back failed ack batches, repairs duplicate success, and retries as a fresh attempt", async () => {
    const { companyId } = await env.seedCompany();
    const node = await createEdgeEnrollmentNode(env.db, {
      companyId,
      nodeName: "Race Node",
      siteLabel: "Plant",
      masterKey: DEV_MASTER_KEY,
    });
    const fixture = await seedPrintFixture(companyId, node.deploymentId, "bundle:RACE:label:v3:attempt:1");
    const polls = await Promise.all(
      Array.from({ length: 4 }, () =>
        pollEdgeCommands(env.db, { companyId, deploymentId: node.deploymentId, nowMs: 1_700_000_000_000 }),
      ),
    );
    const delivered = polls.flatMap((poll) => poll.commands);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.commandId).toBe(fixture.commandId);
    expect(delivered[0]?.deliveryCount).toBe(1);

    const ackInput = {
      companyId,
      deploymentId: node.deploymentId,
      commandId: fixture.commandId,
      leaseId: delivered[0]!.leaseId,
      outcome: "accepted" as const,
      resolution: "accepted" as const,
      agentJobId: "agent-race-1",
      detail: null,
    };
    env.beforeNextBatch(() => Promise.reject(new Error("forced ack batch failure")));
    await expect(acknowledgeEdgeCommand(env.db, ackInput)).rejects.toThrow("forced ack batch failure");
    const unresolved = await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, fixture.commandId)).get();
    expect(unresolved?.state).toBe("leased");
    expect(unresolved?.resolutionJson).toBeNull();
    expect((await env.db.select().from(printLog).where(eq(printLog.id, fixture.printLogId)).get())?.status).toBe("queued");

    await acknowledgeEdgeCommand(env.db, ackInput);
    await env.db
      .update(printLog)
      .set({ status: "queued", spoolJobId: null })
      .where(eq(printLog.id, fixture.printLogId));
    await env.db.update(bundle).set({ stickerStale: true }).where(eq(bundle.id, fixture.bundleId));
    const duplicate = await acknowledgeEdgeCommand(env.db, ackInput);
    expect(duplicate.outcome).toBe("accepted");
    const repaired = await env.db.select().from(printLog).where(eq(printLog.id, fixture.printLogId)).get();
    expect(repaired?.status).toBe("accepted");
    expect(repaired?.spoolJobId).toBe("agent-race-1");
    expect((await env.db.select().from(bundle).where(eq(bundle.id, fixture.bundleId)).get())?.stickerStale).toBe(false);

    const retry = await retryEdgePrintCommand(env.db, {
      companyId,
      deploymentId: node.deploymentId,
      printLogId: fixture.printLogId,
    });
    expect(retry.commandId).not.toBe(fixture.commandId);
    expect(retry.printLogId).not.toBe(fixture.printLogId);
    expect(retry.jobKey).toBe("bundle:RACE:label:v3:attempt:2");
    const retryLog = await env.db.select().from(printLog).where(eq(printLog.id, retry.printLogId)).get();
    expect(retryLog?.variables).toEqual({ bundleSerial: "26I4086", frozen: true });
    expect(retryLog?.payloadHash).toBe("a".repeat(64));

    const retryPoll = await pollEdgeCommands(env.db, { companyId, deploymentId: node.deploymentId });
    const retryLease = retryPoll.commands.find((command) => command.commandId === retry.commandId)!;
    const outcomes = await Promise.all([
      acknowledgeEdgeCommand(env.db, {
        companyId,
        deploymentId: node.deploymentId,
        commandId: retry.commandId,
        leaseId: retryLease.leaseId,
        outcome: "accepted",
        resolution: "accepted",
        agentJobId: "agent-race-2",
        detail: null,
      }),
      acknowledgeEdgeCommand(env.db, {
        companyId,
        deploymentId: node.deploymentId,
        commandId: retry.commandId,
        leaseId: retryLease.leaseId,
        outcome: "rejected",
        resolution: "job_key_conflict",
        agentJobId: null,
        detail: "competing ack",
      }),
    ]);
    const terminal = await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, retry.commandId)).get();
    expect(outcomes.every((result) => result.outcome === terminal?.state)).toBe(true);
    const terminalLog = await env.db.select().from(printLog).where(eq(printLog.id, retry.printLogId)).get();
    expect(terminalLog?.status).toBe(terminal?.state === "accepted" ? "accepted" : "failed");
  });

  test("isolates event projections by deployment and safely retries errors and concurrent redelivery", async () => {
    const { companyId } = await env.seedCompany();
    const nodes = await Promise.all([
      createEdgeEnrollmentNode(env.db, { companyId, nodeName: "Node A", siteLabel: "A", masterKey: DEV_MASTER_KEY }),
      createEdgeEnrollmentNode(env.db, { companyId, nodeName: "Node B", siteLabel: "B", masterKey: DEV_MASTER_KEY }),
    ]);
    const jobKey = "bundle:SHARED:label:v1:attempt:1";
    const first = await seedPrintFixture(companyId, nodes[0]!.deploymentId, jobKey);
    const second = await seedPrintFixture(companyId, nodes[1]!.deploymentId, jobKey);
    await leaseAndAccept(companyId, nodes[0]!.deploymentId, first.commandId, "shared-agent-job");
    await leaseAndAccept(companyId, nodes[1]!.deploymentId, second.commandId, "shared-agent-job");

    const sentEvent = {
      eventId: crypto.randomUUID(),
      aggregateId: "shared-agent-job",
      sequence: 2,
      kind: "job_state_changed" as const,
      occurredAt: "2026-10-26T12:00:02.000Z",
      payload: { state: "sent", jobKey, reason: null },
    };
    await ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[0]!.deploymentId, events: [sentEvent] });
    expect((await env.db.select().from(printLog).where(eq(printLog.id, first.printLogId)).get())?.status).toBe("sent");
    expect((await env.db.select().from(printLog).where(eq(printLog.id, second.printLogId)).get())?.status).toBe(
      "accepted",
    );

    const failedEvent = { ...sentEvent, eventId: crypto.randomUUID(), payload: { state: "failed_final", jobKey } };
    env.beforeNextBatch(() => Promise.reject(new Error("forced event projection failure")));
    await expect(
      ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[1]!.deploymentId, events: [failedEvent] }),
    ).rejects.toThrow("forced event projection failure");
    expect(
      await env.db
        .select()
        .from(edgeEventReceipt)
        .where(
          and(
            eq(edgeEventReceipt.deploymentId, nodes[1]!.deploymentId),
            eq(edgeEventReceipt.eventId, failedEvent.eventId),
          ),
        )
        .get(),
    ).toBeUndefined();
    await ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[1]!.deploymentId, events: [failedEvent] });
    expect((await env.db.select().from(printLog).where(eq(printLog.id, second.printLogId)).get())?.status).toBe(
      "failed",
    );

    const reprintEvent = {
      eventId: crypto.randomUUID(),
      aggregateId: "offline-reprint-job",
      sequence: 1,
      kind: "offline_reprint" as const,
      occurredAt: "2026-10-26T12:05:00.000Z",
      payload: { sourceJobKey: jobKey, jobKey: `${jobKey}:offline`, operator: "operator1", copies: 1 },
    };
    const redeliveries = await Promise.allSettled([
      ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[0]!.deploymentId, events: [reprintEvent] }),
      ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[0]!.deploymentId, events: [reprintEvent] }),
    ]);
    expect(redeliveries.every((result) => result.status === "fulfilled")).toBe(true);
    const applied = redeliveries.reduce(
      (count, result) => count + (result.status === "fulfilled" ? result.value.processed : 0),
      0,
    );
    expect(applied).toBe(1);
    const reprints = await env.db
      .select()
      .from(printLog)
      .where(and(eq(printLog.deploymentId, nodes[0]!.deploymentId), eq(printLog.jobKey, `${jobKey}:offline`)))
      .all();
    expect(reprints).toHaveLength(1);
    const receipts = await env.db
      .select()
      .from(edgeEventReceipt)
      .where(
        and(
          eq(edgeEventReceipt.deploymentId, nodes[0]!.deploymentId),
          eq(edgeEventReceipt.eventId, reprintEvent.eventId),
        ),
      )
      .all();
    expect(receipts).toHaveLength(1);
    const duplicate = await ingestEdgeEventBatch(env.db, {
      companyId,
      deploymentId: nodes[0]!.deploymentId,
      events: [reprintEvent],
    });
    expect(duplicate.deduplicated).toBe(1);
    expect(duplicate.processed).toBe(0);

    const racingJobKey = `${jobKey}:offline-new-event-race`;
    const racingEvents = [crypto.randomUUID(), crypto.randomUUID()].map((eventId) => ({
      ...reprintEvent,
      eventId,
      payload: { ...reprintEvent.payload, jobKey: racingJobKey },
    }));
    await Promise.all(
      racingEvents.map((event) =>
        ingestEdgeEventBatch(env.db, { companyId, deploymentId: nodes[0]!.deploymentId, events: [event] }),
      ),
    );
    const racingReprints = await env.db
      .select()
      .from(printLog)
      .where(and(eq(printLog.deploymentId, nodes[0]!.deploymentId), eq(printLog.jobKey, racingJobKey)))
      .all();
    expect(racingReprints).toHaveLength(1);
  });
});
