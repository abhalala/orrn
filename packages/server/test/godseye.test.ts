/**
 * Godseye (platform console) server pieces used by the T27 screens:
 * company list printing filter, grant authors, plan/module validation, and
 * the local-stack print station stub (no Cloudflare calls on the local worker).
 */
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import type { Context } from "../src/context";
import { createTestEnv, type PlatformStaffRole, type TestEnv } from "./harness";
import { workersEnv } from "./env-mock";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.dispose());

/** A platform staff caller whose request comes from `url` (the local worker is loopback). */
async function staffCallerAt(role: PlatformStaffRole, url: string) {
  const { appRouter } = await import("../src/routers/index");
  const { platformAdmin } = await import("@orrn/db/schema");
  const id = await env.seedUser("staff");
  await env.db.insert(platformAdmin).values({ userId: id, role });
  const ctx = {
    auth: null,
    db: env.db,
    request: new Request(url),
    session: { user: { id, name: "Staff", email: `${id}@test.orrn` }, session: { id: "s" } },
    membership: null,
    companyId: null,
    role: null,
    isPlatformAdmin: true,
    platformRole: role,
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
  } as unknown as Context;
  return appRouter.createCaller(ctx);
}

async function insertDeployment(companyId: string, status: "pending" | "active" | "revoked", sub: string) {
  const { spoolDeployment } = await import("@orrn/db/schema/spool");
  await env.db.insert(spoolDeployment).values({
    id: crypto.randomUUID(),
    companyId,
    instanceId: crypto.randomUUID(),
    status,
    subdomain: sub,
    nodeDomain: `${sub}.spool.orrn.in`,
    cfTunnelId: `local-${sub}`,
    cfTunnelTokenWrapped: "x",
    sharedSecretHash: "x",
    sharedSecretWrapped: "x",
  });
}

const LOCAL_ENV = { NODE_ENV: "development", ORRN_LOCAL_PASSWORD: "local-test", CF_API_TOKEN: "", CF_ACCOUNT_ID: "", CF_ZONE_ID_IN: "" };
const saved: Record<string, unknown> = {};
function useEnv(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = workersEnv[k];
    workersEnv[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete workersEnv[k];
    else workersEnv[k] = v;
    delete saved[k];
  }
});

describe("platform.companiesList printing", () => {
  test("each row says whether label printing is set up; `printing: true` keeps only those", async () => {
    const withPrinting = await env.seedCompany();
    const turnedOff = await env.seedCompany();
    const none = await env.seedCompany();
    const tag = crypto.randomUUID().slice(0, 6);
    await insertDeployment(withPrinting.companyId, "active", `on-${tag}`);
    await insertDeployment(turnedOff.companyId, "revoked", `off-${tag}`);

    const staff = env.caller({ platformRole: "super_admin" });
    const all = await staff.platform.companiesList({ limit: 100 });
    const byId = new Map(all.items.map((r) => [r.id, r]));
    expect(byId.get(withPrinting.companyId)?.printing).toBe("active");
    expect(byId.get(turnedOff.companyId)?.printing).toBeNull();
    expect(byId.get(none.companyId)?.printing).toBeNull();

    const filtered = await staff.platform.companiesList({ limit: 100, printing: true });
    const ids = filtered.items.map((r) => r.id);
    expect(ids).toContain(withPrinting.companyId);
    expect(ids).not.toContain(turnedOff.companyId);
    expect(ids).not.toContain(none.companyId);
    expect(filtered.total).toBe(filtered.items.length);
  });

  test("member counts are per company (list and detail)", async () => {
    const { companyId } = await env.seedCompany();
    const { companyRoles } = await import("@orrn/db/schema/tenant");
    const staff = env.caller({ platformRole: "support" });
    const all = await staff.platform.companiesList({ limit: 100 });
    expect(all.items.find((r) => r.id === companyId)?.memberCount).toBe(companyRoles.length);
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.company.memberCount).toBe(companyRoles.length);
  });
});

describe("platform.companiesGet grants", () => {
  test("each grant names the staff member who opened it", async () => {
    const { companyId } = await env.seedCompany();
    const staff = env.caller({ platformRole: "admin" });
    await staff.platform.impersonationCreateGrant({ companyId, reason: "Label printer check" });
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.recentGrants).toHaveLength(1);
    expect(got.recentGrants[0]?.staffName).toBe("platform admin");
    expect(got.recentGrants[0]?.reason).toBe("Label printer check");
  });
});

describe("platform.updatePlanAndModules", () => {
  test("saves a plan and known modules, de-duplicated", async () => {
    const { companyId } = await env.seedCompany();
    const staff = env.caller({ platformRole: "support" });
    await staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["dies", "bundles", "dies"] });
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.company.plan).toBe("growth");
    expect(got.company.modules).toEqual(["dies", "bundles"]);
  });

  test("rejects a module orrn does not have", async () => {
    const { companyId } = await env.seedCompany();
    const staff = env.caller({ platformRole: "super_admin" });
    await expect(
      staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["dies", "payroll"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejects an empty plan", async () => {
    const { companyId } = await env.seedCompany();
    const staff = env.caller({ platformRole: "super_admin" });
    await expect(
      staff.platform.updatePlanAndModules({ companyId, plan: "  ", modules: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("print station on the local stack", () => {
  test("create and turn off work without Cloudflare on the local worker", async () => {
    useEnv(LOCAL_ENV);
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const { companyId } = await env.seedCompany();
      const staff = await staffCallerAt("super_admin", "http://localhost:3226/trpc/platform.spoolDeploymentCreate");
      const sub = `local-${crypto.randomUUID().slice(0, 8)}`;
      const created = await staff.platform.spoolDeploymentCreate({ companyId, subdomain: sub });
      expect(created.spoolDomain).toBe(`${sub}.spool.orrn.in`);
      expect(created.sharedSecret.length).toBeGreaterThan(30);
      expect(created.cfTunnelToken.length).toBeGreaterThan(10);

      const listed = await staff.platform.spoolDeploymentsList({ companyId });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.status).toBe("pending");

      await staff.platform.spoolDeploymentRevoke({ id: created.id });
      const after = await staff.platform.spoolDeploymentsList({ companyId });
      expect(after.items[0]?.status).toBe("revoked");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("a deployed worker (not loopback) still needs Cloudflare", async () => {
    useEnv(LOCAL_ENV);
    const { companyId } = await env.seedCompany();
    const staff = await staffCallerAt("super_admin", "https://api.dev.orrn.app/trpc/platform.spoolDeploymentCreate");
    await expect(
      staff.platform.spoolDeploymentCreate({ companyId, subdomain: `deployed-${crypto.randomUUID().slice(0, 8)}` }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  test("without the local password binding it still needs Cloudflare", async () => {
    useEnv({ ...LOCAL_ENV, ORRN_LOCAL_PASSWORD: "" });
    const { companyId } = await env.seedCompany();
    const staff = await staffCallerAt("super_admin", "http://localhost:3226/trpc");
    await expect(
      staff.platform.spoolDeploymentCreate({ companyId, subdomain: `nopass-${crypto.randomUUID().slice(0, 8)}` }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  test("support staff cannot set up label printing", async () => {
    useEnv(LOCAL_ENV);
    const { companyId } = await env.seedCompany();
    const staff = await staffCallerAt("support", "http://localhost:3226/trpc");
    await expect(
      staff.platform.spoolDeploymentCreate({ companyId, subdomain: `support-${crypto.randomUUID().slice(0, 8)}` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
