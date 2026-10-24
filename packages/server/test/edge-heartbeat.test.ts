/**
 * Node heartbeat (orrn-spool -> ORRN /webhooks/spool/activate) with scale presence.
 * The "heartbeat" vector in fixtures/spool-hmac-vectors.json is the exact token orrn-spool's Go
 * signer produces for that body (TestORRNVectorsSign in orrn-spool), so verifying it here is the
 * Go-signs / ORRN-verifies half of the cross-repo check.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { spoolDeployment } from "@orrn/db/schema/spool";
import { wrapSecret } from "@orrn/crypto";
import { eq } from "drizzle-orm";

import { vectors } from "./fixtures/spool-hmac-vectors";
import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { handleNodeHeartbeat } from "../src/lib/edge-heartbeat";
import { signSpoolRequest } from "../src/lib/spool-crypto";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

async function seedNode(opts: { secret?: string; instanceId?: string; status?: "pending" | "active" | "revoked" } = {}) {
  const { companyId } = await env.seedCompany();
  const id = crypto.randomUUID();
  const instanceId = opts.instanceId ?? crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id,
    companyId,
    instanceId,
    status: opts.status ?? "pending",
    subdomain: `hb-${id.slice(0, 8)}`,
    nodeDomain: `hb-${id.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(opts.secret ?? "hb-secret", DEV_MASTER_KEY),
  });
  const row = async () => (await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, id)).get())!;
  return { id, instanceId, companyId, row };
}

const beat = (rawBody: Uint8Array, authorization: string | null, nowMs?: number) =>
  handleNodeHeartbeat(env.db, { rawBody, authorization, masterKey: DEV_MASTER_KEY, nowMs });

describe("node heartbeat", () => {
  test("a signed heartbeat marks the node active and stores scale presence", async () => {
    const node = await seedNode();
    const body = enc({
      instance_id: node.instanceId,
      version: "1.4.0",
      // Go's time.Time marshals with microseconds.
      scale: { configured: true, simulated: false, connected: true, lastFrameAt: "2026-10-24T06:29:59.900123Z" },
    });
    const now = Date.parse("2026-10-24T06:30:00Z");
    const token = await signSpoolRequest("POST", "/webhooks/spool/activate", body, "hb-secret", now);
    const res = await beat(body, `Bearer ${token}`, now + 2000);
    expect(res.status).toBe(200);
    const r = await node.row();
    expect(r.status).toBe("active");
    expect(r.runtimeVersion).toBe("1.4.0");
    expect(r.scaleConfigured).toBe(true);
    expect(r.scaleSimulated).toBe(false);
    expect(r.scaleLastFrameAt?.toISOString()).toBe("2026-10-24T06:29:59.900Z");
    expect(r.scaleReportedAt?.getTime()).toBe(now + 2000);
    expect(r.lastHeartbeatAt?.getTime()).toBe(now + 2000);
  });

  test("the Go-signed vector verifies here (cross-repo)", async () => {
    const v = vectors.vectors.find((x) => x.name === "heartbeat")!;
    const instanceId = JSON.parse(v.body!).instance_id as string;
    const node = await seedNode({ secret: v.secret, instanceId });
    const res = await beat(enc(v.body!), `Bearer ${v.token}`, v.verifyAtMs);
    expect(res.status).toBe(200);
    expect((await node.row()).scaleConfigured).toBe(true);
  });

  test("a heartbeat signed for the alias path is accepted", async () => {
    const node = await seedNode();
    const body = enc({ instance_id: node.instanceId, scale: { configured: false, lastFrameAt: null } });
    const token = await signSpoolRequest("POST", "/webhooks/edge/heartbeat", body, "hb-secret");
    expect((await beat(body, `Bearer ${token}`)).status).toBe(200);
    const r = await node.row();
    expect(r.scaleConfigured).toBe(false);
    expect(r.scaleLastFrameAt).toBeNull();
  });

  test("an unsigned heartbeat keeps the old behaviour and never writes scale presence", async () => {
    const node = await seedNode();
    const body = enc({ instance_id: node.instanceId, version: "0.9", scale: { configured: true, lastFrameAt: "2026-10-24T06:29:59Z" } });
    expect((await beat(body, null)).status).toBe(200);
    const r = await node.row();
    expect(r.status).toBe("active");
    expect(r.runtimeVersion).toBe("0.9");
    expect(r.scaleConfigured).toBeNull();
    expect(r.scaleLastFrameAt).toBeNull();
  });

  test("a bad signature, a tampered body or an old token is refused and changes nothing", async () => {
    const node = await seedNode();
    const body = enc({ instance_id: node.instanceId, scale: { configured: true, lastFrameAt: null } });
    const now = Date.now();
    const wrongKey = await signSpoolRequest("POST", "/webhooks/spool/activate", body, "not-the-secret", now);
    const good = await signSpoolRequest("POST", "/webhooks/spool/activate", body, "hb-secret", now);
    const tampered = enc({ instance_id: node.instanceId, scale: { configured: false, lastFrameAt: null } });
    expect((await beat(body, `Bearer ${wrongKey}`, now)).status).toBe(403);
    expect((await beat(tampered, `Bearer ${good}`, now)).status).toBe(403);
    expect((await beat(body, `Bearer ${good}`, now + 5 * 60_000 + 1)).status).toBe(403);
    const r = await node.row();
    expect(r.status).toBe("pending");
    expect(r.scaleConfigured).toBeNull();
  });

  test("unknown or revoked instances are refused; malformed bodies are 400", async () => {
    expect((await beat(enc({ instance_id: crypto.randomUUID() }), null)).status).toBe(403);
    const revoked = await seedNode({ status: "revoked" });
    expect((await beat(enc({ instance_id: revoked.instanceId }), null)).status).toBe(403);
    expect((await revoked.row()).status).toBe("revoked");
    expect((await beat(enc("{not json"), null)).status).toBe(400);
    expect((await beat(enc({ version: "1" }), null)).status).toBe(400);
  });
});
