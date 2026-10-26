/**
 * FP-PF-14 support (Open -> Answered -> Closed), FP-PF-16 audit viewer (paged, filtered, cap 50,
 * never deletes), FP-PF-15 Today per role (viewer: four KPIs; rate slice needs priceOnSalesOrder +
 * order.price), FP-PF-10 team (13 roles, audit rows) and the idempotent dev seed rows.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, bundle, dispatch, dispatchItem, membership, salesOrder, salesOrderLine, supportRequest } from "@orrn/db/schema";
import { companyRoles, type CompanyRole } from "@orrn/db/schema/tenant";
import { and, eq } from "drizzle-orm";

import { can } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";

// The seed / matrix tests in this file take 2 to 5 s of Miniflare work each; bun's 5 s default fails them when the machine is busy.
setDefaultTimeout(30_000);

let env: TestEnv;
let support: typeof import("../src/lib/support");

beforeAll(async () => {
  env = await createTestEnv();
  support = await import("../src/lib/support");
});

afterAll(async () => {
  await env.dispose();
});

describe("support requests (FP-PF-14)", () => {
  test("state table: Open -> Answered -> Closed; Open -> Closed; Closed is final; no second reply", () => {
    expect(support.supportNext("open", { reply: true, close: false })).toBe("answered");
    expect(support.supportNext("open", { reply: true, close: true })).toBe("closed");
    expect(support.supportNext("open", { reply: false, close: true })).toBe("closed");
    expect(support.supportNext("answered", { reply: false, close: true })).toBe("closed");
    expect(support.supportNext("answered", { reply: true, close: false })).toBeNull();
    expect(support.supportNext("closed", { reply: false, close: true })).toBeNull();
    expect(support.supportNext("closed", { reply: true, close: false })).toBeNull();
    expect(support.supportNext("open", { reply: false, close: false })).toBeNull();
  });

  test("every company role may ask (viewer included); mine shows only your own", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of companyRoles) {
      const res = await env.caller({ role, companyId }).support.request({ body: `Help from ${role}`, screen: "/today" });
      expect(res.status).toBe("open");
    }
    const mine = await env.caller({ role: "viewer", companyId }).support.mine();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ body: "Help from viewer", subject: "Help from viewer", screen: "/today", status: "open", reply: null });
    await expect(env.caller({ role: "viewer", companyId }).support.request({ body: "x".repeat(2001) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("staff reply answers, close closes, audits land in the plant's log; support role may reply", async () => {
    const { companyId } = await env.seedCompany();
    const { id } = await env.caller({ role: "packer", companyId }).support.request({ subject: "Printer", body: "Skips labels" });
    const listed = await env.caller({ platformRole: "support" }).platform.support.list({ status: "open", companyId });
    expect(listed.map((r) => r.id)).toEqual([id]);

    await expect(env.caller({ role: "owner", companyId }).platform.support.reply({ id, reply: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const answered = await env.caller({ platformRole: "support" }).platform.support.reply({ id, reply: "Clean the sensor" });
    expect(answered.status).toBe("answered");
    await expect(env.caller({ platformRole: "admin" }).platform.support.reply({ id, reply: "again" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This request already has a reply",
    });
    const closed = await env.caller({ platformRole: "admin" }).platform.support.reply({ id, close: true });
    expect(closed.status).toBe("closed");
    await expect(env.caller({ platformRole: "admin" }).platform.support.reply({ id, close: true })).rejects.toMatchObject({
      message: "This request is closed",
    });
    await expect(env.caller({ platformRole: "admin" }).platform.support.reply({ id } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const mine = await env.caller({ role: "packer", companyId }).support.mine();
    expect(mine[0]).toMatchObject({ status: "closed", reply: "Clean the sensor" });
    const actions = (await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.subjectId, id))))
      .map((r) => r.action)
      .sort();
    expect(actions).toEqual(["support_request.close", "support_request.create", "support_request.reply"]);
  });

  for (const other of ["reply", "close"] as const) {
    test(`race: another staff member's ${other} lands after this reply read the request: CONFLICT, no second audit row`, async () => {
      const { companyId } = await env.seedCompany();
      const { id } = await env.caller({ role: "packer", companyId }).support.request({ body: "Scale drifts" });
      env.beforeNextBatch(() =>
        env.caller({ platformRole: "admin" }).platform.support.reply(other === "reply" ? { id, reply: "First answer" } : { id, close: true }),
      );
      await expect(env.caller({ platformRole: "support" }).platform.support.reply({ id, reply: "Second answer" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const row = await env.db.select().from(supportRequest).where(eq(supportRequest.id, id)).get();
      expect(row!.status).toBe(other === "reply" ? "answered" : "closed");
      expect(row!.reply).toBe(other === "reply" ? "First answer" : null);
      const audits = (await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.subjectId, id)))).map(
        (r) => r.action,
      );
      expect(audits.sort()).toEqual(["support_request.create", other === "reply" ? "support_request.reply" : "support_request.close"].sort());
    });
  }

  test("Open -> Closed without a reply", async () => {
    const { companyId } = await env.seedCompany();
    const { id } = await env.caller({ role: "office", companyId }).support.request({ body: "Never mind" });
    const res = await env.caller({ platformRole: "admin" }).platform.support.reply({ id, close: true });
    expect(res.status).toBe("closed");
    const row = await env.db.select().from(supportRequest).where(eq(supportRequest.id, id)).get();
    expect(row!.reply).toBeNull();
  });
});

describe("audit viewer (FP-PF-16)", () => {
  async function seedAudit(companyId: string, actorId: string, n: number, opts: { action?: string; subjectType?: string; subjectId?: string; at?: number } = {}) {
    const base = opts.at ?? Date.now() - 60_000;
    for (let i = 0; i < n; i++) {
      await env.db.insert(auditLog).values({
        id: crypto.randomUUID(),
        companyId,
        actorId,
        action: opts.action ?? "bundle.pack",
        subjectType: opts.subjectType ?? "bundle",
        subjectId: opts.subjectId ?? `b-${i}`,
        meta: { i },
        at: new Date(base + i * 1000),
      });
    }
  }

  test("audit.read is owner, admin and manager only", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of companyRoles) {
      const call = env.caller({ role, companyId }).audit.list({});
      if (["owner", "admin", "manager"].includes(role)) await call;
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("pages newest first with a cursor, no row twice, no row lost; filters by actor, action kind, subject and date", async () => {
    const { companyId, users } = await env.seedCompany();
    const other = await env.seedCompany();
    await seedAudit(companyId, users.packer.id, 7);
    await seedAudit(companyId, users.office.id, 3, { action: "dispatch.complete", subjectType: "dispatch", subjectId: "d-1" });
    await seedAudit(other.companyId, other.users.packer.id, 4);
    const manager = env.caller({ role: "manager", companyId });

    const seen: string[] = [];
    let cursor: { at: number; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await manager.audit.list({ limit: 4, cursor });
      seen.push(...res.items.map((r) => r.id));
      for (let i = 1; i < res.items.length; i++) expect(res.items[i - 1]!.at >= res.items[i]!.at).toBe(true);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);

    expect((await manager.audit.list({ actorId: users.office.id })).items).toHaveLength(3);
    expect((await manager.audit.list({ action: "dispatch." })).items).toHaveLength(3);
    expect((await manager.audit.list({ action: "dispatch.complete" })).items).toHaveLength(3);
    expect((await manager.audit.list({ action: "dispatch" })).items).toHaveLength(0);
    expect((await manager.audit.list({ subjectType: "bundle", subjectId: "b-2" })).items).toHaveLength(1);
    const packed = (await manager.audit.list({ action: "bundle.pack" })).items;
    expect(packed[0]!.actorName).toContain("packer");
    const fromMid = new Date(packed[3]!.at).getTime();
    expect((await manager.audit.list({ action: "bundle.pack", from: fromMid })).items).toHaveLength(4);
    expect((await manager.audit.list({ action: "bundle.pack", to: fromMid })).items).toHaveLength(4);
    // The other plant's rows never show.
    expect(seen.length).toBe(10);
  });

  test("actions takes several prefixes and exact codes at once (one Kind covers die_instance., nitriding. and the like)", async () => {
    const { companyId, users } = await env.seedCompany();
    await seedAudit(companyId, users.packer.id, 2, { action: "die.update", subjectType: "die" });
    await seedAudit(companyId, users.packer.id, 2, { action: "die_instance.create", subjectType: "die_instance" });
    await seedAudit(companyId, users.packer.id, 1, { action: "nitriding.add", subjectType: "die_instance" });
    await seedAudit(companyId, users.packer.id, 3, { action: "dispatch.complete", subjectType: "dispatch" });
    await seedAudit(companyId, users.packer.id, 1, { action: "move_found", subjectType: "bundle" });
    const manager = env.caller({ role: "manager", companyId });
    expect((await manager.audit.list({ actions: ["die.", "die_instance.", "nitriding."] })).items).toHaveLength(5);
    expect((await manager.audit.list({ actions: ["die.", "move_found"] })).items).toHaveLength(3);
    expect((await manager.audit.list({ actions: ["die"] })).items).toHaveLength(0);
    // `_` in a prefix is literal: "die_" must not match "die.update".
    expect((await manager.audit.list({ actions: ["die_instance."] })).items).toHaveLength(2);
    await expect(manager.audit.list({ actions: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("default from = auditRetentionDays ago (a filter, not a delete); forSubject caps at 50", async () => {
    const { companyId, users } = await env.seedCompany();
    await seedAudit(companyId, users.owner.id, 2, { action: "old.thing", at: Date.now() - 400 * 86_400_000 });
    const owner = env.caller({ role: "owner", companyId });
    expect((await owner.audit.list({ action: "old.thing" })).items).toHaveLength(0);
    expect((await owner.audit.list({ action: "old.thing", from: 0 })).items).toHaveLength(2);
    const stored = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "old.thing")));
    expect(stored).toHaveLength(2);

    for (let i = 0; i < 53; i++) {
      await env.db.insert(auditLog).values({
        id: crypto.randomUUID(),
        companyId,
        actorId: users.owner.id,
        action: "dispatch.scan",
        subjectType: "dispatch",
        subjectId: "d-cap",
        meta: {},
        at: new Date(Date.now() - i * 1000),
      });
    }
    const res = await owner.audit.forSubject({ subjectType: "dispatch", subjectId: "d-cap" });
    expect(res.items).toHaveLength(50);
    expect(res.capped).toBe(true);
    await expect(owner.audit.list({ limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("there is no delete procedure on the audit router", async () => {
    const { auditRouter } = await import("../src/routers/audit");
    expect(Object.keys(auditRouter._def.procedures).sort()).toEqual(["forSubject", "list"]);
  });
});

describe("Today per role (FP-PF-15)", () => {
  async function plantWithActivity(settings: Record<string, unknown> = {}) {
    const { companyId, users } = await env.seedCompany({ settings: { timezone: "Asia/Kolkata", ...settings } });
    const dieId = await env.seedDie(companyId);
    const customerId = await env.seedCustomer(companyId);
    const inStock = await env.seedBundles(companyId, dieId, 3);
    const gone = await env.seedBundles(companyId, dieId, 2, "dispatched");
    const orderId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    await env.db.insert(salesOrder).values({
      id: orderId,
      companyId,
      period: "2026-27",
      number: `SO-${orderId.slice(0, 4)}`,
      customerId,
      orderDate: "2026-10-24",
      status: "confirmed",
    } as never);
    await env.db
      .insert(salesOrderLine)
      .values({ id: lineId, companyId, salesOrderId: orderId, lineNo: 1, dieId, cutLengthMm: 3660, kgG: 100_000, ratePaise: 25_000 } as never);
    const dispatchId = crypto.randomUUID();
    await env.db.insert(dispatch).values({ id: dispatchId, companyId, code: "D-1", customerId, status: "completed", completedAt: new Date() });
    for (const b of gone) {
      await env.db.insert(dispatchItem).values({ id: crypto.randomUUID(), companyId, dispatchId, bundleId: b.id, salesOrderLineId: lineId });
    }
    return { companyId, users, inStock };
  }

  test("viewer: the four KPIs only; lists empty; no void/dispatched stock; no rate", async () => {
    const { companyId } = await plantWithActivity({ priceOnSalesOrder: true });
    const viewer = await env.caller({ role: "viewer", companyId }).dashboard.today();
    expect(viewer.scope).toBe("kpis");
    expect(viewer.kpis).toEqual({ packedG: 125_000, packedBundles: 5, dispatchedG: 50_000, inStockG: 75_000, inStockBundles: 3 });
    expect(viewer.openDispatches).toEqual([]);
    expect(viewer.recentSessions).toEqual([]);
    expect(viewer.failedPrintJobs).toBe(0);
    expect(viewer.openDispatchCount).toBe(0);
    expect(viewer.stock.dispatched).toEqual({ bundles: 0, weightG: 0 });
    expect(viewer.value).toBeNull();
    expect(viewer.productionDay).toMatchObject({ shiftsSet: false });
  });

  test("manager: full payload and the rate slice (priceOnSalesOrder on + order.price); packer never gets a rate", async () => {
    const { companyId } = await plantWithActivity({ priceOnSalesOrder: true });
    const manager = await env.caller({ role: "manager", companyId }).dashboard.today();
    expect(manager.scope).toBe("full");
    expect(manager.kpis.packedBundles).toBe(5);
    expect(manager.stock.dispatched.bundles).toBe(2);
    expect(manager.recentSessions.length).toBeGreaterThan(0);
    // 2 bundles x 25 kg at Rs 250/kg = Rs 12,500 = 1,250,000 paise.
    expect(manager.value).toEqual({ dispatchedPaise: 1_250_000, pricedBundles: 2 });
    expect(can({ company: { role: "packer" }, isPlatformAdmin: false }, "order.price")).toBe(false);
    expect((await env.caller({ role: "packer", companyId }).dashboard.today()).value).toBeNull();
    expect((await env.caller({ role: "accountant", companyId }).dashboard.today()).value).not.toBeNull();
  });

  test("rate slice is off while priceOnSalesOrder is off, even for owner", async () => {
    const { companyId } = await plantWithActivity();
    expect((await env.caller({ role: "owner", companyId }).dashboard.today()).value).toBeNull();
  });

  test("In stock on Today is the Stock screen's In stock: available only, not held, dispatched or void", async () => {
    const { companyId } = await plantWithActivity();
    const dieId = await env.seedDie(companyId);
    await env.seedBundles(companyId, dieId, 2, "reserved");
    await env.seedBundles(companyId, dieId, 1, "void");
    for (const role of ["viewer", "owner"] as const) {
      const caller = env.caller({ role, companyId });
      const today = await caller.dashboard.today();
      const stock = await caller.bundle.stockSummary({ status: "available" });
      expect(today.kpis.inStockBundles).toBe(3);
      expect(today.kpis.inStockBundles).toBe(stock.totals.bundleCount);
      expect(today.kpis.inStockG).toBe(stock.totals.totalWeightG);
      expect(today.stock.reserved.bundles).toBe(2);
    }
  });
});

describe("team: the 13 roles (FP-PF-10)", () => {
  test("only users.manage holders (owner, admin) invite, change roles and remove; every change is audited", async () => {
    const { companyId, users } = await env.seedCompany();
    for (const role of companyRoles) {
      const allowed = role === "owner" || role === "admin";
      for (const action of ["member.invite", "member.updateRole", "member.remove", "settings.update"] as const) {
        expect({ role, action, ok: can({ company: { role }, isPlatformAdmin: false }, action) }).toEqual({ role, action, ok: allowed });
      }
    }

    const admin = env.caller({ role: "admin", companyId });
    const target = (await env.db
      .select()
      .from(membership)
      .where(and(eq(membership.companyId, companyId), eq(membership.userId, users.packer.id)))
      .get())!;
    for (const role of companyRoles.filter((r) => r !== "owner") as CompanyRole[]) {
      await admin.company.membersUpdateRole({ membershipId: target.id, role });
    }
    await expect(admin.company.membersUpdateRole({ membershipId: target.id, role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      env.caller({ role: "manager", companyId }).company.membersUpdateRole({ membershipId: target.id, role: "packer" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const roleAudits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "member.updateRole")));
    expect(roleAudits).toHaveLength(companyRoles.length - 1);

    await env.caller({ role: "owner", companyId }).invite.create({ email: "new.hand@test.orrn", role: "foundry" });
    const [inv] = await env.caller({ role: "owner", companyId }).invite.list();
    await admin.invite.revoke({ inviteId: inv!.id });
    await admin.company.membersRemove({ membershipId: target.id });
    const actions = (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["member.invite", "member.invite.revoke", "member.remove"]));
  });
});

describe("dev seed platform rows (idempotent)", () => {
  test("a build per native platform, one device, one support request; a re-seed keeps exactly one of each", async () => {
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const { appRelease, device } = await import("@orrn/db/schema");
    // The seed makes users through Better Auth: bind it to this file's D1.
    (await import("@orrn/auth")).resetAuthForTests();
    for (let i = 0; i < 2; i++) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      const releases = await env.db.select().from(appRelease);
      expect(releases.filter((r) => r.id.startsWith("dev-release-")).map((r) => r.platform).sort()).toEqual(["android", "ios"]);
      expect(await env.db.select().from(device).where(eq(device.companyId, "dev-company-orrn"))).toHaveLength(1);
      expect(await env.db.select().from(supportRequest).where(eq(supportRequest.companyId, "dev-company-orrn"))).toHaveLength(1);
    }
    // The seeded floor build passes the gate, and so does a local native build (apps/native has no
    // versionCode / buildNumber, so it reports 1): the seed floor is minBuild 1.
    for (const buildNumber of [12, 9, 1]) {
      expect({ buildNumber, state: (await env.caller(null).release.check({ platform: "android", channel: "floor", buildNumber })).state }).toEqual({
        buildNumber,
        state: "open",
      });
    }
    expect((await env.caller(null).release.check({ platform: "ios", channel: "production", buildNumber: 1 })).state).toBe("open");
    expect((await env.caller(null).release.check({ platform: "android", channel: "floor", buildNumber: 0 })).state).toBe("blocked");
  });
});

// Keep the bundle import used (weights in fixtures above come from seedBundles: 25 kg each).
void bundle;
