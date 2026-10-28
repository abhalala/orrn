import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { and, eq } from "drizzle-orm";
import { wrapSecret } from "@orrn/crypto";
import { labelTemplate, printLog, printerProfile } from "@orrn/db/schema";
import { edgeCommand, spoolDeployment } from "@orrn/db/schema/spool";

import { createEdgeEnrollmentNode } from "../src/lib/edge-v1";
import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function enrolledNode(companyId: string) {
  const node = await createEdgeEnrollmentNode(env.db, {
    companyId,
    nodeName: "Plant Edge",
    siteLabel: "Main Plant",
    masterKey: DEV_MASTER_KEY,
  });
  await env.db
    .update(spoolDeployment)
    .set({ installId: crypto.randomUUID(), status: "active", runtimeVersion: "1.2.3" })
    .where(eq(spoolDeployment.id, node.deploymentId));
  return node;
}

async function printRefs(companyId: string, deploymentId: string) {
  const templateId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({
    id: templateId,
    companyId,
    name: "Bundle label",
    kind: "bundle",
    schema: { width_mm: 100, height_mm: 50 },
    spoolTemplateId: null,
    version: 3,
  });
  await env.db.insert(printerProfile).values({
    id: profileId,
    companyId,
    name: "Packing printer",
    spoolPrinterId: "tsc-main",
    deploymentId,
    templateId,
    defaultCopies: 2,
  });
  return { templateId, profileId };
}

describe("V1 spool router callers", () => {
  test("prints without a legacy template id, waits for cancellation, and retries as a linked new attempt", async () => {
    const { companyId } = await env.seedCompany();
    const node = await enrolledNode(companyId);
    const refs = await printRefs(companyId, node.deploymentId);
    const dieId = await env.seedDie(companyId);
    const [seededBundle] = await env.seedBundles(companyId, dieId, 1);
    const packer = env.caller({ role: "packer", companyId });
    const owner = env.caller({ role: "owner", companyId });

    const printed = await packer.spool.printBundleLabel({ bundleId: seededBundle!.id, profileId: refs.profileId });
    expect(printed.commandId).toBeString();
    const source = await env.db.select().from(printLog).where(eq(printLog.id, printed.id)).get();
    expect(source).toMatchObject({
      deploymentId: node.deploymentId,
      templateId: refs.templateId,
      status: "queued",
      attempt: 1,
      labelVersion: 3,
      copies: 2,
    });
    const printCommand = await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, printed.commandId!)).get();
    expect(printCommand).toMatchObject({ kind: "print_job", state: "queued", printLogId: printed.id });
    expect(JSON.parse(printCommand!.payloadJson)).toMatchObject({ templateId: refs.templateId, spoolTemplateId: null });

    await env.db.update(printLog).set({ status: "outcome_unknown", responseText: "socket timeout" }).where(eq(printLog.id, printed.id));
    const cancelled = await owner.spool.cancelJob({ id: printed.id });
    expect(cancelled.commandId).toBeString();
    expect(await env.db.select().from(printLog).where(eq(printLog.id, printed.id)).get()).toMatchObject({
      status: "outcome_unknown",
      responseText: "socket timeout",
    });
    expect(await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, cancelled.commandId!)).get()).toMatchObject({
      kind: "cancel_job",
      state: "queued",
      printLogId: printed.id,
    });

    const retried = await owner.spool.retryJob({ id: printed.id });
    expect(retried.id).not.toBe(printed.id);
    expect(retried.commandId).not.toBe(printed.commandId);
    expect(retried.jobKey).toBe(source!.jobKey!.replace("attempt:1", "attempt:2"));
    expect(await env.db.select().from(printLog).where(eq(printLog.id, retried.id!)).get()).toMatchObject({
      status: "queued",
      attempt: 2,
      deploymentId: node.deploymentId,
      payloadHash: source!.payloadHash,
      variables: source!.variables,
    });
    expect(await env.db.select().from(printLog).where(eq(printLog.id, printed.id)).get()).toMatchObject({
      status: "outcome_unknown",
      attempt: 1,
    });
    expect(await env.db.select().from(edgeCommand).where(eq(edgeCommand.id, retried.commandId!)).get()).toMatchObject({
      kind: "print_job",
      state: "queued",
      printLogId: retried.id,
    });

    const generic = await packer.spool.createJob({
      profileId: refs.profileId,
      variables: { bundleSerial: "26I4086" },
      copies: 1,
    });
    expect(generic.commandId).toBeString();
    expect(await env.db.select().from(printLog).where(eq(printLog.id, generic.id)).get()).toMatchObject({
      status: "queued",
      deploymentId: node.deploymentId,
      labelVersion: 3,
    });
    await owner.spool.pushTemplate({ templateId: refs.templateId });
    expect(await env.db.select().from(labelTemplate).where(eq(labelTemplate.id, refs.templateId)).get()).toMatchObject({
      spoolTemplateId: null,
    });
    expect((await env.db.select().from(labelTemplate).where(eq(labelTemplate.id, refs.templateId)).get())!.spoolPushedAt).not.toBeNull();
    expect((await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, node.deploymentId)).get())!.configVersion).toBe(2);
  });

  test("a deployment id alone does not convert legacy cancellation or retry into V1 commands", async () => {
    const { companyId } = await env.seedCompany();
    const deploymentId = crypto.randomUUID();
    await env.db.insert(spoolDeployment).values({
      id: deploymentId,
      companyId,
      instanceId: crypto.randomUUID(),
      status: "active",
      subdomain: `legacy-${deploymentId.slice(0, 8)}`,
      nodeDomain: `legacy-${deploymentId.slice(0, 8)}.spool.orrn.in`,
      cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
      sharedSecretHash: "legacy-hash",
      sharedSecretWrapped: await wrapSecret("legacy-secret", DEV_MASTER_KEY),
    });
    const refs = await printRefs(companyId, deploymentId);
    const logId = crypto.randomUUID();
    await env.db.insert(printLog).values({
      id: logId,
      companyId,
      ...refs,
      deploymentId,
      status: "failed",
      responseText: "legacy failure",
      attempt: 1,
    });
    const owner = env.caller({ role: "owner", companyId });

    await owner.spool.cancelJob({ id: logId });
    expect(await env.db.select().from(printLog).where(eq(printLog.id, logId)).get()).toMatchObject({
      status: "failed",
      responseText: "Cancelled by user",
    });
    await owner.spool.retryJob({ id: logId });
    expect(await env.db.select().from(printLog).where(eq(printLog.id, logId)).get()).toMatchObject({ status: "queued", attempt: 2 });
    expect(await env.db.select().from(printLog).where(eq(printLog.companyId, companyId)).all()).toHaveLength(1);
    expect(await env.db.select().from(edgeCommand).where(and(eq(edgeCommand.companyId, companyId), eq(edgeCommand.deploymentId, deploymentId))).all()).toEqual([]);
  });

  test("regenerate stages V1 overlap while preserving immediate legacy rotation", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ platformRole: "admin" });
    const node = await enrolledNode(companyId);
    const before = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, node.deploymentId)).get();
    const rotated = await admin.platform.spoolDeploymentRegenerateSecret({ id: node.deploymentId });
    expect(rotated).toMatchObject({ overlap: true, pendingCredentialVersion: 2 });
    expect(await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, node.deploymentId)).get()).toMatchObject({
      sharedSecretHash: before!.sharedSecretHash,
      sharedSecretWrapped: before!.sharedSecretWrapped,
      credentialVersion: 1,
      pendingCredentialVersion: 2,
    });

    const legacyId = crypto.randomUUID();
    await env.db.insert(spoolDeployment).values({
      id: legacyId,
      companyId,
      instanceId: crypto.randomUUID(),
      status: "active",
      subdomain: `legacy-${legacyId.slice(0, 8)}`,
      nodeDomain: `legacy-${legacyId.slice(0, 8)}.spool.orrn.in`,
      cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
      sharedSecretHash: "old-legacy-hash",
      sharedSecretWrapped: await wrapSecret("old-legacy-secret", DEV_MASTER_KEY),
    });
    const legacy = await admin.platform.spoolDeploymentRegenerateSecret({ id: legacyId });
    expect(legacy.overlap).toBe(false);
    expect(await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, legacyId)).get()).toMatchObject({
      credentialVersion: 1,
      pendingCredentialVersion: null,
      pendingSecretHash: null,
    });
    expect((await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, legacyId)).get())!.sharedSecretHash).not.toBe("old-legacy-hash");
    await expect(admin.platform.edgeNodeIssueEnrollmentToken({ id: legacyId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("V1 download selects linux-arm64 from the immutable manifest without embedding a secret", async () => {
    const { companyId } = await env.seedCompany();
    const node = await enrolledNode(companyId);
    const manifest = {
      version: "1.2.3",
      protocolVersion: 1,
      configSchemaVersion: 1,
      cacheSchemaVersion: 1,
      dockerImage: `ghcr.io/abhalala/orrn-edge@sha256:${"a".repeat(64)}`,
      artifacts: {
        "windows-amd64": { filename: "orrn-edge-windows-amd64.exe", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-windows-amd64.exe", sha256: "b".repeat(64) },
        "linux-amd64": { filename: "orrn-edge-linux-amd64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-amd64", sha256: "c".repeat(64) },
        "linux-arm64": { filename: "orrn-edge-linux-arm64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-arm64", sha256: "d".repeat(64) },
      },
    };
    await expect(
      env.caller({ platformRole: "admin" }).platform.spoolDeploymentDockerInstallScript({ id: node.deploymentId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json(manifest), { preconnect: () => {} }));
    try {
      const result = await env.caller({ platformRole: "admin" }).platform.spoolDeploymentDownloadUrl({
        id: node.deploymentId,
        platform: "linux-arm64",
      });
      expect(result).toMatchObject({
        downloadUrl: manifest.artifacts["linux-arm64"].url,
        filename: "orrn-edge-linux-arm64",
        sha256: "d".repeat(64),
        releaseVersion: "1.2.3",
      });
      expect(result.downloadUrl).not.toContain("secret");
      expect(String(fetcher.mock.calls[0]![0])).toBe("https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-release.json");
      const docker = await env.caller({ platformRole: "admin" }).platform.spoolDeploymentDownloadUrl({
        id: node.deploymentId,
        platform: "docker",
      });
      expect(docker).toMatchObject({
        downloadUrl: manifest.dockerImage,
        dockerImage: manifest.dockerImage,
        filename: "orrn-edge-docker",
        sha256: null,
        releaseVersion: "1.2.3",
      });
    } finally {
      fetcher.mockRestore();
    }
  });

});
