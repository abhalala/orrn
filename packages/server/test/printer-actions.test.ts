import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { wrapSecret } from "@orrn/crypto";
import { operationsDense } from "@orrn/domain";
import { auditLog } from "@orrn/db/schema/audit";
import { labelTemplate, printerProfile } from "@orrn/db/schema/printing";
import { edgeCommand, spoolDeployment } from "@orrn/db/schema/spool";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { ingestEdgeEventBatch } from "../src/lib/edge-v1";

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.dispose(); });

test("administrator device actions are authorized, durable, audited, and receive results", async () => {
  const { companyId } = await env.seedCompany();
  const deploymentId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id: deploymentId, companyId, instanceId: crypto.randomUUID(), installId: crypto.randomUUID(), status: "active",
    subdomain: `act-${deploymentId.slice(0, 8)}`, nodeDomain: `act-${deploymentId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY), sharedSecretHash: "hash", sharedSecretWrapped: await wrapSecret("secret", DEV_MASTER_KEY),
    desiredPrinters: [{ printerId: "tsc-1", name: "Packing", host: "10.0.0.40", port: 9100, paused: false }],
  });
  const templateId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: "Dense", schema: operationsDense as unknown as Record<string, unknown>, variables: {} });
  const profileId = crypto.randomUUID();
  await env.db.insert(printerProfile).values({ id: profileId, companyId, deploymentId, name: "Packing", spoolPrinterId: "tsc-1", templateId });
  const viewer = env.caller({ role: "viewer", companyId });
  await expect(viewer.spool.deviceAction({ profileId, action: "set_cutter", enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

  const admin = env.caller({ role: "admin", companyId });
  const result = await admin.spool.deviceAction({ profileId, action: "set_cutter", enabled: true });
  const command = await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, result.commandId)).get();
  expect(command?.kind).toBe("device_action");
  expect(JSON.parse(command!.payloadJson)).toMatchObject({ printerId: "tsc-1", action: "set_cutter", enabled: true });
  const audits = await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId)).all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ action: "printer.device_action", subjectType: "printer_profile", subjectId: profileId });
  expect(audits[0]?.meta).toMatchObject({ action: "set_cutter", commandId: result.commandId });

  await ingestEdgeEventBatch(env.db, {
    companyId, deploymentId,
    events: [{ eventId: crypto.randomUUID(), aggregateId: result.commandId, sequence: 1, kind: "device_action_result", occurredAt: "2026-10-27T12:00:00.000Z", payload: { commandId: result.commandId, state: "sent", reason: null } }],
  });
  const completed = await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, result.commandId)).get();
  expect(JSON.parse(completed!.resolutionJson!)).toMatchObject({ state: "sent" });
});
