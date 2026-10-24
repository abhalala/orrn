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
      staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["dies", "payroll"] as never }),
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

/** Files an access request the way the website does: a `pending` company plus the request. */
async function fileRequest(name = `Pending ${crypto.randomUUID().slice(0, 8)}`) {
  const { company, waitlistRequest } = await import("@orrn/db/schema/tenant");
  const { eq } = await import("drizzle-orm");
  const { id } = await env.caller(null).waitlist.submit({
    companyName: name,
    requesterName: "Requester",
    requesterEmail: `req.${crypto.randomUUID().slice(0, 8)}@test.orrn`,
  });
  const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, id)).get();
  const shell = await env.db.select().from(company).where(eq(company.id, request!.companyId!)).get();
  expect(shell?.status).toBe("pending");
  return { requestId: id, companyId: request!.companyId!, name };
}

describe("a company whose request is not approved (pending)", () => {
  test("rejecting the request removes its never-approved company; the request stays on record", async () => {
    const { requestId, companyId, name } = await fileRequest();
    const staff = env.caller({ platformRole: "support" });
    await staff.platform.waitlistReject({ id: requestId });

    const waiting = await staff.platform.companiesList({ status: "pending", search: name });
    expect(waiting.items.map((r) => r.id)).not.toContain(companyId);
    const all = await staff.platform.companiesList({ search: name });
    expect(all.total).toBe(0);
    await expect(staff.platform.companiesGet({ id: companyId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { waitlistRequest } = await import("@orrn/db/schema/tenant");
    const { eq } = await import("drizzle-orm");
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, requestId)).get();
    expect(request?.status).toBe("rejected");
    expect(request?.companyName).toBe(name);
  });

  test("rejecting never removes a company that has members", async () => {
    const { requestId, companyId } = await fileRequest();
    const userId = await env.seedUser("member");
    await env.addMembership(userId, companyId, "owner");
    const staff = env.caller({ platformRole: "admin" });
    await staff.platform.waitlistReject({ id: requestId });
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.company.memberCount).toBe(1);
  });

  test("the overview leaves rejected requests out of the company totals and recent companies", async () => {
    const staff = env.caller({ platformRole: "super_admin" });
    const before = await staff.platform.overview();
    const { requestId, companyId } = await fileRequest();
    const filed = await staff.platform.overview();
    expect(filed.companies?.total).toBe((before.companies?.total ?? 0) + 1);
    await staff.platform.waitlistReject({ id: requestId });
    const after = await staff.platform.overview();
    expect(after.companies?.total).toBe(before.companies?.total);
    expect(after.companies?.recent.map((r) => r.id)).not.toContain(companyId);
  });

  test("a request rejected before this fix (company still pending) is not listed as a company", async () => {
    const { requestId, companyId, name } = await fileRequest();
    const { waitlistRequest } = await import("@orrn/db/schema/tenant");
    const { eq } = await import("drizzle-orm");
    // The old reject only closed the request and left the company pending.
    await env.db.update(waitlistRequest).set({ status: "rejected" }).where(eq(waitlistRequest.id, requestId));

    const staff = env.caller({ platformRole: "super_admin" });
    const waiting = await staff.platform.companiesList({ status: "pending", search: name });
    expect(waiting.total).toBe(0);
    expect(waiting.items).toHaveLength(0);
    const overview = await staff.platform.overview();
    expect(overview.companies?.recent.map((r) => r.id)).not.toContain(companyId);
    await expect(staff.platform.companiesGet({ id: companyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("Reactivate and Suspend refuse a company that was never approved", async () => {
    const { companyId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    await expect(staff.platform.companiesReactivate({ id: companyId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(staff.platform.companiesSuspend({ id: companyId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.company.status).toBe("pending");
    expect(got.company.memberCount).toBe(0);
  });

  test("approving still turns the waiting company into an active one with its owner", async () => {
    const { requestId, companyId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    // Approval never throws because of the sign-in email: the details (or the reason there are none) come back.
    const result = await staff.platform.waitlistApprove({ id: requestId });
    expect(result.success).toBe(true);
    expect(result.signIn !== null || typeof result.signInError === "string").toBe(true);
    const got = await staff.platform.companiesGet({ id: companyId });
    expect(got.company.status).toBe("active");
    expect(got.company.memberCount).toBe(1);
  });
});

describe("sign-in details for an approved owner", () => {
  test("an approved owner is listed as awaiting until a password is set", async () => {
    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    const approved = await staff.platform.waitlistApprove({ id: requestId });
    expect(approved.success).toBe(true);
    const awaiting = await staff.platform.waitlistAwaitingSignIn();
    expect(awaiting.map((r) => r.id)).toContain(requestId);
  });

  test("an owner who has set a password is no longer awaiting", async () => {
    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    await staff.platform.waitlistApprove({ id: requestId });
    const { waitlistRequest } = await import("@orrn/db/schema/tenant");
    const { account, user } = await import("@orrn/db/schema/auth");
    const { eq } = await import("drizzle-orm");
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, requestId)).get();
    const owner = await env.db.select().from(user).where(eq(user.email, request!.requesterEmail)).get();
    expect(owner).toBeTruthy();
    await env.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: owner!.id,
      providerId: "credential",
      userId: owner!.id,
      password: "x",
    });
    const awaiting = await staff.platform.waitlistAwaitingSignIn();
    expect(awaiting.map((r) => r.id)).not.toContain(requestId);
  });

  test("fresh details are only issued for an approved request", async () => {
    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    await expect(staff.platform.waitlistSignInDetails({ id: requestId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(staff.platform.waitlistSignInDetails({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("both are closed to a caller who is not platform staff", async () => {
    const anon = env.caller(null);
    await expect(anon.platform.waitlistAwaitingSignIn()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.platform.waitlistSignInDetails({ id: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

/** The requester's user row after approval. */
async function ownerOf(requestId: string) {
  const { waitlistRequest } = await import("@orrn/db/schema/tenant");
  const { user } = await import("@orrn/db/schema/auth");
  const { eq } = await import("drizzle-orm");
  const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, requestId)).get();
  const owner = await env.db.select().from(user).where(eq(user.email, request!.requesterEmail)).get();
  return { request: request!, owner: owner! };
}

async function givePassword(userId: string) {
  const { account } = await import("@orrn/db/schema/auth");
  await env.db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: "hashed",
  });
}

async function linkAudits(userId: string) {
  const { auditLog } = await import("@orrn/db/schema/audit");
  const { and, eq } = await import("drizzle-orm");
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "platform.waitlist.signInLink"), eq(auditLog.subjectId, userId)))
    .all();
}

/** Magic-link rows (the plugin's format) for an email. */
async function linkRows(email: string) {
  const { verification } = await import("@orrn/db/schema/auth");
  const rows = await env.db.select().from(verification).all();
  return rows.filter((r) => {
    try {
      return (JSON.parse(r.value) as { email?: string }).email === email.toLowerCase();
    } catch {
      return false;
    }
  });
}

function tokenOf(link: string) {
  return new URL(link).searchParams.get("token")!;
}

describe("owner sign-in links (review T27 C-1, I-1)", () => {
  test("approving a new owner issues a 3-day /continue link and audits it (actor, owner, reason)", async () => {
    const { requestId, companyId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    const result = await staff.platform.waitlistApprove({ id: requestId });
    expect(result.signInRefused).toBeNull();
    expect(result.signIn).not.toBeNull();
    const link = result.signIn!.link;
    expect(link).toContain("/continue?token=");

    const { owner, request } = await ownerOf(requestId);
    const rows = await linkRows(request.requesterEmail);
    expect(rows.map((r) => r.identifier)).toEqual([tokenOf(link)]);
    const ttlHours = (rows[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(71);
    expect(ttlHours).toBeLessThanOrEqual(72);

    const audits = await linkAudits(owner.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBeTruthy();
    expect(audits[0]!.actorId).not.toBe(owner.id);
    expect(audits[0]!.subjectType).toBe("user");
    expect(audits[0]!.companyId).toBe(companyId);
    expect(audits[0]!.meta).toMatchObject({ reason: "approve", requestId });
  });

  test("fresh details for an approved owner with no password: a new link, earlier ones revoked, one audit row each", async () => {
    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "admin" });
    const first = await staff.platform.waitlistApprove({ id: requestId });
    const fresh = await staff.platform.waitlistSignInDetails({ id: requestId });
    expect(fresh.link).toContain("/continue?token=");
    expect(tokenOf(fresh.link)).not.toBe(tokenOf(first.signIn!.link));

    const { owner, request } = await ownerOf(requestId);
    expect((await linkRows(request.requesterEmail)).map((r) => r.identifier)).toEqual([tokenOf(fresh.link)]);
    const audits = await linkAudits(owner.id);
    expect(audits.map((a) => (a.meta as { reason?: string }).reason).sort()).toEqual(["approve", "fresh_link"]);
  });

  test("an owner who already has a password is refused a link (CONFLICT), and nothing is issued or audited", async () => {
    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    await staff.platform.waitlistApprove({ id: requestId });
    const { owner, request } = await ownerOf(requestId);
    await givePassword(owner.id);
    const before = await linkRows(request.requesterEmail);

    await expect(staff.platform.waitlistSignInDetails({ id: requestId })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This owner already signs in with a password; ask them to use Forgot password.",
    });
    expect(await linkRows(request.requesterEmail)).toEqual(before);
    expect(await linkAudits(owner.id)).toHaveLength(1); // the approval's link only
  });

  test("approving a request whose email already has an account with a password returns no link", async () => {
    const { requestId } = await fileRequest();
    const { request } = await ownerOf(requestId);
    const { user } = await import("@orrn/db/schema/auth");
    const existingId = crypto.randomUUID();
    await env.db.insert(user).values({ id: existingId, name: "Owner elsewhere", email: request.requesterEmail, emailVerified: true });
    await givePassword(existingId);

    const staff = env.caller({ platformRole: "super_admin" });
    const result = await staff.platform.waitlistApprove({ id: requestId });
    expect(result.success).toBe(true);
    expect(result.signIn).toBeNull();
    expect(result.signInRefused).toBe("has_password");
    expect(await linkRows(request.requesterEmail)).toHaveLength(0);
    expect(await linkAudits(existingId)).toHaveLength(0);
  });

  test("support may approve but may not issue a link: approval returns none, fresh details are FORBIDDEN", async () => {
    const { requestId } = await fileRequest();
    const support = env.caller({ platformRole: "support" });
    const result = await support.platform.waitlistApprove({ id: requestId });
    expect(result.success).toBe(true);
    expect(result.signIn).toBeNull();
    expect(result.signInRefused).toBe("not_allowed");
    await expect(support.platform.waitlistSignInDetails({ id: requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { owner, request } = await ownerOf(requestId);
    expect(await linkRows(request.requesterEmail)).toHaveLength(0);
    expect(await linkAudits(owner.id)).toHaveLength(0);
    // The owner waits for someone who may issue the link.
    expect((await support.platform.waitlistAwaitingSignIn()).map((r) => r.id)).toContain(requestId);
  });

  test("the matrix grants signInLink to super_admin and admin only", async () => {
    const { can } = await import("../src/lib/permissions");
    const me = (platformRole: PlatformStaffRole) => ({ company: null, isPlatformAdmin: true, platformRole });
    expect(can(me("super_admin"), "platform.waitlist.signInLink")).toBe(true);
    expect(can(me("admin"), "platform.waitlist.signInLink")).toBe(true);
    expect(can(me("support"), "platform.waitlist.signInLink")).toBe(false);
    expect(can(me("support"), "platform.waitlist.review")).toBe(true);
  });

  test("an anonymous request to the public magic-link endpoint fills nothing the admin procedure reads", async () => {
    const authModule = (await import("@orrn/auth")) as Record<string, unknown>;
    expect(authModule.takeCapturedMagicLink).toBeUndefined();

    const { requestId } = await fileRequest();
    const staff = env.caller({ platformRole: "super_admin" });
    await staff.platform.waitlistApprove({ id: requestId });
    const { request } = await ownerOf(requestId);

    // The old capture hack read `metadata.captureKey` from this public body. Since FP-PF-08 / D14
    // (magic-link-guard.ts) the public request is refused outright: no email, no verification row.
    const before = (await linkRows(request.requesterEmail)).map((r) => r.identifier).sort();
    const log = spyOn(console, "log").mockImplementation(() => {});
    let anonToken: string | undefined;
    try {
      const res = await (authModule.createAuth as () => { handler(r: Request): Promise<Response> })().handler(
        new Request("https://api.test/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://app.test" },
          body: JSON.stringify({ email: request.requesterEmail, metadata: { captureKey: "anon-key" } }),
        }),
      );
      expect(res.status).toBe(403);
      const printed = log.mock.calls.flat().map(String).join("\n");
      expect(printed).not.toContain("not sent: no provider");
      expect(printed).not.toContain("anon-key");
      const after = (await linkRows(request.requesterEmail)).map((r) => r.identifier).sort();
      expect(after).toEqual(before);
      anonToken = after.find((id) => !before.includes(id));
      expect(anonToken).toBeUndefined();
    } finally {
      log.mockRestore();
    }

    const fresh = await staff.platform.waitlistSignInDetails({ id: requestId });
    expect(tokenOf(fresh.link)).not.toBe(anonToken);
    expect(tokenOf(fresh.link)).toHaveLength(64);
    // The fresh link revoked every earlier one, the anonymous request's included.
    expect((await linkRows(request.requesterEmail)).map((r) => r.identifier)).toEqual([tokenOf(fresh.link)]);
  });
});

describe("printing status with several stations", () => {
  test("the newest station that is not turned off decides the company's printing status", async () => {
    const { companyId } = await env.seedCompany();
    const tag = crypto.randomUUID().slice(0, 6);
    await insertDeployment(companyId, "active", `old-${tag}`);
    await new Promise((r) => setTimeout(r, 5));
    await insertDeployment(companyId, "pending", `new-${tag}`);
    await new Promise((r) => setTimeout(r, 5));
    await insertDeployment(companyId, "revoked", `gone-${tag}`);

    const staff = env.caller({ platformRole: "super_admin" });
    const all = await staff.platform.companiesList({ limit: 100 });
    expect(all.items.find((r) => r.id === companyId)?.printing).toBe("pending");
    const filtered = await staff.platform.companiesList({ limit: 100, printing: true });
    expect(filtered.items.filter((r) => r.id === companyId)).toHaveLength(1);
  });
});
