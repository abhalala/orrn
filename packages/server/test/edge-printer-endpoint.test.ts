import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { wrapSecret } from "@orrn/crypto";
import { operationsDense } from "@orrn/domain";
import { labelTemplate, printerProfile } from "@orrn/db/schema/printing";
import { spoolDeployment } from "@orrn/db/schema/spool";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { ingestEdgeEventBatch } from "../src/lib/edge-v1";

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.dispose(); });

test("verified endpoint events are idempotent and never rewrite desired configuration", async () => {
  const { companyId } = await env.seedCompany();
  const deploymentId = crypto.randomUUID();
  const desiredPrinters = [{ printerId: "tsc-1", name: "Packing", host: "10.0.0.40", port: 9100, paused: false }];
  await env.db.insert(spoolDeployment).values({
    id: deploymentId, companyId, instanceId: crypto.randomUUID(), installId: crypto.randomUUID(), status: "active",
    subdomain: `dhcp-${deploymentId.slice(0, 8)}`, nodeDomain: `dhcp-${deploymentId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY), sharedSecretHash: "hash", sharedSecretWrapped: await wrapSecret("secret", DEV_MASTER_KEY), desiredPrinters,
  });
  const templateId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: "Dense", schema: operationsDense as unknown as Record<string, unknown>, variables: {} });
  const profileId = crypto.randomUUID();
  await env.db.insert(printerProfile).values({ id: profileId, companyId, deploymentId, name: "Packing", spoolPrinterId: "tsc-1", templateId });
  const eventId = crypto.randomUUID();
  const event = {
    eventId, aggregateId: "printer:tsc-1", sequence: 1, kind: "printer_endpoint_verified" as const,
    occurredAt: "2026-10-27T12:00:00.000Z",
    payload: { printerId: "tsc-1", host: "10.0.0.41", port: 9100, macAddress: "a4:b1:c2:d3:e4:f5", model: "TA220", verifiedAt: "2026-10-27T12:00:00.000Z" },
  };
  const first = await ingestEdgeEventBatch(env.db, { companyId, deploymentId, events: [event] });
  expect(first.processed).toBe(1);
  const profile = await env.db.select().from(printerProfile).where(eq(printerProfile.id, profileId)).get();
  expect(profile?.verifiedHost).toBe("10.0.0.41");
  expect(profile?.macAddress).toBe("a4:b1:c2:d3:e4:f5");
  expect(profile?.capabilitiesVerifiedAt?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
  const node = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, deploymentId)).get();
  expect(node?.desiredPrinters).toEqual(desiredPrinters);
  const second = await ingestEdgeEventBatch(env.db, { companyId, deploymentId, events: [event] });
  expect(second.deduplicated).toBe(1);
});
