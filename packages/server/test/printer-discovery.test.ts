import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { wrapSecret } from "@orrn/crypto";
import { operationsDense } from "@orrn/domain";
import { labelTemplate, printerProfile } from "@orrn/db/schema/printing";
import { spoolDeployment } from "@orrn/db/schema/spool";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { pollEdgeCommands } from "../src/lib/edge-v1";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function fixture() {
  const { companyId } = await env.seedCompany();
  const deploymentId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id: deploymentId,
    companyId,
    instanceId: crypto.randomUUID(),
    installId: crypto.randomUUID(),
    status: "active",
    subdomain: `cap-${deploymentId.slice(0, 8)}`,
    nodeDomain: `cap-${deploymentId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret("secret", DEV_MASTER_KEY),
    desiredPrinters: [{ printerId: "tsc-1", name: "Packing", host: "10.0.0.40", port: 9100, paused: false }],
  });
  const templateId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: "Dense", schema: operationsDense as unknown as Record<string, unknown>, variables: {} });
  const profileId = crypto.randomUUID();
  await env.db.insert(printerProfile).values({ id: profileId, companyId, deploymentId, name: "Packing", spoolPrinterId: "tsc-1", templateId });
  return { companyId, deploymentId, profileId };
}

describe("printer discovery and preferences", () => {
  test("persists explicit preferences without inventing verified evidence", async () => {
    const { companyId, deploymentId, profileId } = await fixture();
    const admin = env.caller({ role: "admin", companyId });
    const updated = await admin.spool.updatePrinterPreferences({
      profileId,
      mediaType: "gap",
      mediaWidthMm: 102.25,
      mediaHeightMm: 76.2,
      gapMm: 2,
      dpi: 203,
      speedInSec: 5,
      density: 8,
      cutterEnabled: false,
    });
    expect(updated.gapMm).toBe(2);
    expect(updated.capabilitiesVerifiedAt).toBeNull();
    const node = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, deploymentId)).get();
    expect(node?.configVersion).toBe(2);
    expect(node?.desiredPrinters).toEqual([{ printerId: "tsc-1", name: "Packing", host: "10.0.0.40", port: 9100, paused: false, labelWidthMm: 102.25, labelHeightMm: 76.2, gapMm: 2, dpi: 203, mediaType: "gap", speedInSec: 5, density: 8, cutterEnabled: false }]);
  });

  test("stores genuine discovery separately and ignores verification from heartbeat-only reports", async () => {
    const { companyId, deploymentId, profileId } = await fixture();
    const verifiedAt = "2026-10-27T12:00:00.000Z";
    await pollEdgeCommands(env.db, {
      companyId,
      deploymentId,
      printers: [{ printerId: "tsc-1", name: "Packing", ipAddress: "10.0.0.40", port: 9100, status: "online", canPrint: true, lastSeenAt: verifiedAt, lastError: null }],
      nowMs: Date.parse(verifiedAt),
    });
    let profile = await env.db.select().from(printerProfile).where(eq(printerProfile.id, profileId)).get();
    expect(profile?.capabilitiesVerifiedAt).toBeNull();
    expect(profile?.macAddress).toBeNull();

    await pollEdgeCommands(env.db, {
      companyId,
      deploymentId,
      printers: [{
        printerId: "tsc-1", name: "Packing", ipAddress: "10.0.0.40", port: 9100, status: "online", canPrint: true, lastSeenAt: verifiedAt, lastError: null,
        capabilities: { macAddress: "a4:b1:c2:d3:e4:f5", host: "10.0.0.40", port: 9100, features: ["rtc", "cutter"], mediaType: "gap", mediaWidthMm: 102.25, mediaHeightMm: 76.2, gapMm: 2, dpi: 203, speedInSec: 5, density: 8, cutter: false, verifiedAt },
      }],
      nowMs: Date.parse(verifiedAt) + 1000,
    });
    profile = await env.db.select().from(printerProfile).where(eq(printerProfile.id, profileId)).get();
    expect(profile?.macAddress).toBe("a4:b1:c2:d3:e4:f5");
    expect(profile?.verifiedHost).toBe("10.0.0.40");
    expect(profile?.discoveredFeatures).toEqual(["rtc", "cutter"]);
    expect(profile?.capabilitiesVerifiedAt?.toISOString()).toBe(verifiedAt);
    expect(profile?.cutterEnabled).toBe(false);
  });
});
