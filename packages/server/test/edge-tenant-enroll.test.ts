/**
 * Security review 2026-11-04, CRITICAL 1. Tenant `edge.enroll` (owner, admin, manager) used to create
 * a locally managed Cloudflare Tunnel plus a proxied `<chosen>.spool.orrn.in` CNAME and hand the raw
 * tunnel token back. Whoever held it served any name inside the session-cookie domain.
 *
 * Now a tenant enrolment makes an outbound-only ORRN Edge node (no Cloudflare call, no DNS) and
 * returns only a 15-minute single-use enrolment code, which the node exchanges at
 * POST /api/edge/v1/enroll for its node secret. The address is ORRN's, never the caller's, and a
 * plant holds at most MAX_EDGE_NODES_PER_COMPANY live nodes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";

import { spoolDeployment } from "@orrn/db/schema/spool";

import { DEV_MASTER_KEY, workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const cloudflareCalls: string[] = [];
const realFetch = globalThis.fetch;
const CLOUDFLARE_API = "https://api.cloudflare.com/";

const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** Fakes the Cloudflare API only; Miniflare's own D1 traffic goes through untouched. */
function fakeCloudflare(answer: (url: string) => unknown) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!url.startsWith(CLOUDFLARE_API)) return realFetch(input, init);
    cloudflareCalls.push(url);
    return new Response(JSON.stringify({ success: true, errors: [], result: answer(url) }), { status: 200 });
  }) as typeof fetch;
}

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

beforeEach(() => {
  // Cloudflare is configured, so the old code would have reached it.
  Object.assign(workersEnv, { CF_API_TOKEN: "test-cloudflare-token", CF_ACCOUNT_ID: "acct-test", CF_ZONE_ID_IN: "zone-test" });
  cloudflareCalls.length = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    fakeCloudflare((url) =>
      url.includes("/cfd_tunnel")
        ? { id: crypto.randomUUID(), name: "edge", status: "inactive", token: "LIVE-TUNNEL-TOKEN", created_at: "" }
        : { id: crypto.randomUUID(), type: "CNAME", name: "x", content: "y", proxied: true },
    ),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
  for (const key of ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_ZONE_ID_IN"]) delete workersEnv[key];
});

const enrollInput = { nodeName: "Print PC", siteLabel: "Plant" };

describe("tenant edge.enroll (CRITICAL 1)", () => {
  test("a manager gets a one-time enrolment code, never a tunnel token or node secret, and Cloudflare is not called", async () => {
    const { companyId } = await env.seedCompany();
    const result = await env.caller({ role: "manager", companyId }).edge.enroll({ ...enrollInput, subdomain: "godseye" });

    const body = JSON.stringify(result);
    expect(body).not.toContain("LIVE-TUNNEL-TOKEN");
    expect(body).not.toContain("cfTunnelToken");
    expect(body).not.toContain("sharedSecret");
    expect(cloudflareCalls).toEqual([]);

    expect(result.enrollment.enrollmentToken).toMatch(/^enr_[0-9a-f]{48}$/);
    expect(result.enrollment.exchangePath).toBe("/api/edge/v1/enroll");
    const minutes = (new Date(result.enrollment.enrollmentExpiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const row = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, result.deployment.id)).get();
    expect(row!.companyId).toBe(companyId);
    expect(row!.cfTunnelId).toBeNull();
    // The address is ORRN's: the caller's choice is ignored and nothing lives under spool.orrn.in.
    expect(row!.subdomain).not.toBe("godseye");
    expect(row!.nodeDomain.endsWith(".spool.orrn.in")).toBe(false);
    expect(result.deployment.nodeDomain).toBe(row!.nodeDomain);
  });

  test("the node exchanges the code once for its node secret, and the answer carries no tunnel token", async () => {
    const { companyId } = await env.seedCompany();
    const { exchangeEdgeEnrollmentToken } = await import("../src/lib/edge-v1");
    const result = await env.caller({ role: "owner", companyId }).edge.enroll(enrollInput);
    const exchanged = await exchangeEdgeEnrollmentToken(env.db, {
      enrollmentToken: result.enrollment.enrollmentToken,
      agentVersion: "1.0.0",
      os: "linux",
      arch: "amd64",
      installId: crypto.randomUUID(),
      apiOrigin: "https://api.test",
      masterKey: DEV_MASTER_KEY,
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    expect(exchanged.value.deploymentId).toBe(result.deployment.id);
    expect(exchanged.value.nodeSecret).toMatch(/^nsec_/);
    expect(JSON.stringify(exchanged.value)).not.toContain("TUNNEL");
  });

  test("roles without edge.manage are refused", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["office", "operator", "viewer"] as const) {
      await expect(env.caller({ role, companyId }).edge.enroll(enrollInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("a plant holds at most MAX_EDGE_NODES_PER_COMPANY live nodes; revoked ones and other plants do not count", async () => {
    const { MAX_EDGE_NODES_PER_COMPANY } = await import("../src/routers/edge");
    const { companyId } = await env.seedCompany();
    const other = await env.seedCompany();
    const manager = env.caller({ role: "manager", companyId });

    await env.caller({ role: "manager", companyId: other.companyId }).edge.enroll(enrollInput);
    const made = [];
    for (let i = 0; i < MAX_EDGE_NODES_PER_COMPANY; i += 1) made.push(await manager.edge.enroll(enrollInput));
    await expect(manager.edge.enroll(enrollInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const live = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.companyId, companyId));
    expect(live).toHaveLength(MAX_EDGE_NODES_PER_COMPANY);

    // A revoked node frees its place.
    await manager.edge.revoke({ id: made[0]!.deployment.id });
    const again = await manager.edge.enroll(enrollInput);
    expect(again.enrollment.enrollmentToken).toMatch(/^enr_/);
    await expect(manager.edge.enroll(enrollInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("concurrent enrolments never push a plant past the cap", async () => {
    const { MAX_EDGE_NODES_PER_COMPANY } = await import("../src/routers/edge");
    const { companyId } = await env.seedCompany();
    const manager = env.caller({ role: "manager", companyId });
    await Promise.allSettled(Array.from({ length: MAX_EDGE_NODES_PER_COMPANY + 4 }, () => manager.edge.enroll(enrollInput)));
    const rows = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.companyId, companyId));
    expect(rows.filter((r) => r.status !== "revoked").length).toBeLessThanOrEqual(MAX_EDGE_NODES_PER_COMPANY);
  });

  test("revoking a node made before this change still removes its tunnel and DNS record", async () => {
    const { companyId } = await env.seedCompany();
    const { wrapSecret } = await import("@orrn/crypto");
    const id = crypto.randomUUID();
    await env.db.insert(spoolDeployment).values({
      id,
      companyId,
      instanceId: crypto.randomUUID(),
      status: "active",
      subdomain: `old-${id.slice(0, 8)}`,
      nodeDomain: `old-${id.slice(0, 8)}.spool.orrn.in`,
      cfTunnelId: crypto.randomUUID(),
      cfTunnelTokenWrapped: await wrapSecret("old-token", DEV_MASTER_KEY),
      sharedSecretHash: "x",
      sharedSecretWrapped: await wrapSecret("old-secret", DEV_MASTER_KEY),
    });
    fetchSpy.mockImplementation(fakeCloudflare((url) => (url.includes("dns_records?") ? [{ id: "dns-1" }] : {})));
    await env.caller({ role: "owner", companyId }).edge.revoke({ id });
    expect(cloudflareCalls.some((u) => u.includes("/dns_records/dns-1"))).toBe(true);
    expect(cloudflareCalls.some((u) => u.includes("/cfd_tunnel/"))).toBe(true);
    const row = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, id)).get();
    expect(row!.status).toBe("revoked");
  });
});
