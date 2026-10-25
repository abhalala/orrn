/**
 * PL-1: plant roles (spec P9), approvals, many plants per person (spec P10).
 *
 * The expected tables below are written out by hand from digest §4.2 so the
 * test is an independent statement of the matrix, not a copy of permissions.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, customer, membership } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { ACTIONS, APPROVER_ROLES, PLANT_ACTIONS, can, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const ALL_ROLES: CompanyRole[] = [
  "owner",
  "admin",
  "manager",
  "office",
  "accountant",
  "supervisor",
  "packer",
  "foundry",
  "press",
  "storekeeper",
  "die_room",
  "operator",
  "viewer",
];

const meOf = (role: CompanyRole) => ({ company: { role }, isPlatformAdmin: false, platformRole: null });

/**
 * Digest §4.2, one row per new action. Owner is not a matrix column: it is the
 * tenant superuser and holds every action. "approve" cells are approver roles
 * (see APPROVALS below), not holders of the submit action. Viewer reads reports.
 */
const MATRIX: Record<string, CompanyRole[]> = {
  // Digest: packer + supervisor. Ruling RP3: every role that already packs via bundle.create
  // keeps it, so packing can be guarded by bundle.pack without anyone losing it.
  "bundle.pack": ["packer", "supervisor", "manager", "admin", "operator"],
  // BACKLOG 51: the operator no longer voids (nor holds the legacy bundle.transition).
  "bundle.void": ["supervisor", "manager", "admin"],
  "stock.move": ["operator", "packer", "supervisor", "office"],
  "stock.count": ["operator", "packer", "supervisor", "office"],
  // RP4: manager/admin hold dispatch.addBundle → also dispatch.scan.
  "dispatch.scan": ["operator", "packer", "supervisor", "office", "manager", "admin"],
  // Pre-existing action: legacy admin keeps it (old 5-role matrix is frozen).
  "dispatch.complete": ["supervisor", "office", "manager", "admin"],
  "cast.enter": ["foundry", "supervisor"],
  // W2-FD-S: manager and up (admin) close a cast; the supervisor keeps it (spec E4).
  "cast.close": ["supervisor", "manager", "admin"],
  "press.run": ["press", "supervisor"],
  "die.reading": ["press", "supervisor", "die_room"],
  "die.card": ["die_room"],
  "die.rerank": ["die_room"],
  "purchase.receipt": ["operator", "storekeeper", "office"],
  "purchase.dcnote": ["office"],
  "store.txn": ["storekeeper"],
  "order.manage": ["office", "manager"],
  "invoice.link": ["office", "manager"],
  "masters.draft": ["office", "manager", "admin"],
  "masters.publish": ["manager", "admin"],
  "users.manage": ["admin"],
  "export.accounts": ["office", "accountant"],
  "reports.read": ["supervisor", "office", "manager", "admin", "accountant", "viewer"],
  // QC / ageing / cut stations → press + supervisor (spec P9).
  "qc.enter": ["press", "supervisor"],
  "ageing.enter": ["press", "supervisor"],
  // Analytics addendum A1: charts for owner/manager and the office roles, not the floor or viewer.
  "analytics.view": ["admin", "manager", "office", "accountant"],
  // Wave 1 contracts (FP). Moving bundles between orders is order.reallocate (D6), never bundle.transfer.
  "die.issue": ["die_room"],
  "die.maker": ["die_room"],
  "order.plan": ["office", "manager"],
  "order.price": ["office", "manager", "accountant"],
  "order.reallocate": ["supervisor", "office", "manager", "admin"],
  "press.close": ["supervisor", "manager", "admin"],
  "ageing.view": ["press", "supervisor", "office", "manager", "admin"],
  "packingList.combine": ["supervisor", "office", "manager", "admin"],
  "portal.manage": ["office", "manager", "admin"],
  "audit.read": ["admin", "manager"],
  // Wave 2 contracts (FP-PR-25, Q15 A).
  "press.queue": ["supervisor", "office", "manager"],
  // W2-FD-S: the melt stepper and its correction request.
  "melt.enter": ["foundry", "supervisor"],
  "melt.correct": ["foundry", "supervisor"],
  "support.request": ALL_ROLES.filter((r) => r !== "owner"),
};

/** The pre-PL-1 permission matrix for the five original roles; must not move (except BACKLOG 51 below). */
const LEGACY_ACTIONS = [
  "customer.create", "customer.update", "customer.delete", "customer.import",
  "die.create", "die.update", "die.delete", "die.import",
  "receipt.create", "receipt.update", "receipt.delete",
  "bundle.create", "bundle.update", "bundle.delete", "bundle.transition", "bundle.import",
  "dispatch.create", "dispatch.update", "dispatch.delete", "dispatch.reserve", "dispatch.complete",
  "dispatch.cancel", "dispatch.addBundle",
  "packingList.regenerate",
  "member.invite", "member.updateRole", "member.remove",
  "settings.update", "edge.manage",
  "spool.list_printers", "spool.manage_printers", "spool.manage_templates", "spool.push_templates",
  "spool.create_jobs", "spool.manage_jobs", "spool.view_queue",
] as const;

const LEGACY_MANAGER = LEGACY_ACTIONS.filter(
  (a) => !["member.invite", "member.updateRole", "member.remove", "settings.update"].includes(a),
);
const LEGACY: Record<"owner" | "admin" | "manager" | "operator" | "viewer", readonly string[]> = {
  owner: LEGACY_ACTIONS,
  admin: LEGACY_ACTIONS,
  manager: LEGACY_MANAGER,
  // BACKLOG 51 (Q29): the one deliberate change: the operator's legacy void (bundle.transition) is gone.
  operator: [
    "bundle.create", "bundle.update", "dispatch.addBundle",
    "spool.list_printers", "spool.create_jobs", "spool.view_queue",
  ],
  viewer: ["spool.list_printers", "spool.view_queue"],
};

describe("role list", () => {
  test("membership roles are the document's 13 (spec P9)", async () => {
    const { companyRoles } = await import("@orrn/db/schema/tenant");
    expect([...companyRoles]).toEqual(ALL_ROLES);
  });

  test("seedCompany seeds one member per role", async () => {
    const { users } = await env.seedCompany();
    expect(Object.keys(users).sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe("permission matrix (digest §4.2)", () => {
  test("every plant action has at least one role besides owner, and there is no bundle.transfer", () => {
    for (const action of PLANT_ACTIONS) {
      const holders = ALL_ROLES.filter((role) => role !== "owner" && can(meOf(role), action));
      expect({ action, held: holders.length > 0 }).toEqual({ action, held: true });
      expect(MATRIX).toHaveProperty([action]);
    }
    expect(ACTIONS as readonly string[]).not.toContain("bundle.transfer");
  });

  test("every new action is registered", () => {
    for (const action of Object.keys(MATRIX)) {
      expect(ACTIONS as readonly string[]).toContain(action);
    }
  });

  for (const [action, roles] of Object.entries(MATRIX)) {
    describe(action, () => {
      for (const role of ALL_ROLES) {
        const expected = role === "owner" || roles.includes(role);
        test(`${role} -> ${expected ? "allowed" : "denied"}`, () => {
          expect(can(meOf(role), action as Action)).toBe(expected);
        });
      }
    });
  }

  test("the five original roles keep exactly their old actions", () => {
    for (const [role, allowed] of Object.entries(LEGACY)) {
      for (const action of LEGACY_ACTIONS) {
        expect({ role, action, ok: can(meOf(role as CompanyRole), action) }).toEqual({
          role,
          action,
          ok: allowed.includes(action),
        });
      }
    }
  });

  test("bundle.pack and bundle.create have exactly the same holders (RP3)", () => {
    for (const role of ALL_ROLES) {
      expect({ role, pack: can(meOf(role), "bundle.pack") }).toEqual({
        role,
        pack: can(meOf(role), "bundle.create"),
      });
    }
  });

  /**
   * RP4: every holder of a legacy action also holds its plant key, so later
   * tasks can switch a guard to the plant key without anyone silently losing it.
   * (edge.manage and printer/template admin are deliberately not mapped to
   * users.manage: that would hand managers user management.)
   */
  const LEGACY_TO_PLANT: Record<string, Action> = {
    "bundle.create": "bundle.pack",
    "bundle.update": "bundle.pack",
    "receipt.create": "bundle.pack",
    "receipt.update": "bundle.pack",
    "bundle.transition": "bundle.void",
    "bundle.delete": "bundle.void",
    "receipt.delete": "bundle.void",
    "dispatch.addBundle": "dispatch.scan",
    "dispatch.create": "dispatch.scan",
    "dispatch.update": "dispatch.scan",
    "dispatch.reserve": "dispatch.scan",
    "dispatch.cancel": "dispatch.complete",
    "dispatch.delete": "dispatch.complete",
    "packingList.regenerate": "dispatch.complete",
    "customer.create": "masters.publish",
    "customer.update": "masters.publish",
    "customer.delete": "masters.publish",
    "customer.import": "masters.publish",
    "die.create": "masters.publish",
    "die.update": "masters.publish",
    "die.delete": "masters.publish",
    "die.import": "masters.publish",
    "bundle.import": "masters.publish",
    "member.invite": "users.manage",
    "member.updateRole": "users.manage",
    "member.remove": "users.manage",
    "settings.update": "users.manage",
  };

  test("every holder of a legacy action holds its plant key (RP4)", () => {
    for (const [legacy, plant] of Object.entries(LEGACY_TO_PLANT)) {
      for (const role of ALL_ROLES) {
        if (!can(meOf(role), legacy as Action)) continue;
        expect({ role, legacy, plant, held: can(meOf(role), plant) }).toEqual({ role, legacy, plant, held: true });
      }
    }
  });

  test("the primary pairs have exactly the same holders (RP3/RP4)", () => {
    for (const [legacy, plant] of [
      ["bundle.create", "bundle.pack"],
      ["dispatch.addBundle", "dispatch.scan"],
      ["bundle.transition", "bundle.void"],
    ] as const) {
      for (const role of ALL_ROLES) {
        expect({ role, legacy, held: can(meOf(role), plant) }).toEqual({
          role,
          legacy,
          held: can(meOf(role), legacy),
        });
      }
    }
  });

  test("no tenant role holds a platform action", () => {
    for (const role of ALL_ROLES) {
      for (const action of ACTIONS.filter((a) => a.startsWith("platform."))) {
        expect(can(meOf(role), action)).toBe(false);
      }
    }
  });
});

describe("new roles through existing procedures", () => {
  test("packer packs a bundle and prints its label job; office cannot pack", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const row = { quantity: 10, weightG: 25_000, lengthMm: 3_000 };
    for (const role of ["packer", "supervisor"] as const) {
      await expect(
        env.caller({ role, companyId }).bundle.createReceipt({ dieId, unit: "pcs", rows: [row] }),
      ).resolves.toBeDefined();
    }
    for (const role of ["office", "foundry", "accountant", "viewer"] as const) {
      await expect(
        env.caller({ role, companyId }).bundle.createReceipt({ dieId, unit: "pcs", rows: [row] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("office and supervisor complete a dispatch; packer scans but cannot complete", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const customerId = await env.seedCustomer(companyId);
    const bundles = await env.seedBundles(companyId, dieId, 3);
    // D12: the floor dispatches plant stock; a bundle with no line and no transfer is refused.
    await env.plantStock(companyId, bundles.map((b) => b.id));
    const owner = env.caller({ role: "owner", companyId });

    for (const [i, role] of (["office", "supervisor"] as const).entries()) {
      const api = env.caller({ role, companyId });
      const { id } = await api.dispatch.create({ customerId });
      await api.dispatch.addBundle({ id, bundleId: bundles[i]!.id });
      await api.dispatch.reserve({ id });
      await expect(api.dispatch.complete({ id })).resolves.toBeDefined();
    }

    const packer = env.caller({ role: "packer", companyId });
    const { id } = await packer.dispatch.create({ customerId });
    await expect(packer.dispatch.addBundle({ id, bundleId: bundles[2]!.id })).resolves.toBeDefined();
    await owner.dispatch.reserve({ id });
    await expect(packer.dispatch.complete({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("approvals", () => {
  async function seedApproval(
    companyId: string,
    requestedBy: string,
    kind: (typeof approval.$inferInsert)["kind"],
  ) {
    const id = crypto.randomUUID();
    await env.db.insert(approval).values({ id, companyId, kind, subjectId: crypto.randomUUID(), requestedBy });
    return id;
  }

  test("approver roles per kind", () => {
    expect(APPROVER_ROLES).toEqual({
      dc_note: ["owner", "admin", "manager"],
      cast_close: ["owner", "admin", "manager", "foundry"],
      die_rerank: ["owner", "admin", "manager"],
      dispatch_overdraw: ["owner", "admin", "manager"],
      phantom_void: ["owner", "admin", "manager"],
      die_owner_override: ["owner", "admin", "manager"],
      order_reallocate: ["owner", "admin", "manager"],
      press_time: ["owner", "supervisor", "manager"],
      press_reopen: ["owner", "admin", "manager"],
      ageing_override: ["owner", "admin", "manager"],
      press_late_entry: ["owner", "supervisor", "manager"],
      melt_correct: ["owner", "admin", "manager"],
    });
  });

  test("a non-approver gets FORBIDDEN and the row stays pending", async () => {
    const { companyId, users } = await env.seedCompany();
    const id = await seedApproval(companyId, users.office.id, "dc_note");
    for (const role of ["office", "supervisor", "foundry", "accountant", "viewer", "die_room"] as const) {
      await expect(
        env.caller({ role, companyId }).approval.decide({ id, decision: "approved" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const [row] = await env.db.select().from(approval).where(eq(approval.id, id));
    expect(row?.status).toBe("pending");
    expect(row?.decidedBy).toBeNull();
  });

  test("a manager approves; the decision and an audit row land together", async () => {
    const { companyId, users } = await env.seedCompany();
    // Open the request the way plant modules will: a batch item from lib/approval.ts.
    const { requestApprovalInsert } = await import("../src/lib/approval");
    const { id, statement } = requestApprovalInsert(
      { db: env.db, companyId, session: { user: { id: users.office.id } } },
      { kind: "dc_note", subjectId: crypto.randomUUID(), serverSeq: 1, requestNote: "FC kanta 1.2% short", meta: { diffG: 4_200 } },
    );
    await env.db.batch([statement]);
    const {
      items: [opened],
    } = await env.caller({ role: "manager", companyId }).approval.list({ status: "pending" });
    expect(opened).toMatchObject({ id, kind: "dc_note", requestNote: "FC kanta 1.2% short", meta: { diffG: 4_200 } });

    const res = await env
      .caller({ role: "manager", companyId })
      .approval.decide({ id, decision: "approved", note: "bori weight checked" });
    expect(res.status).toBe("approved");

    const [row] = await env.db.select().from(approval).where(eq(approval.id, id));
    expect(row?.status).toBe("approved");
    expect(row?.decidedBy).toBe(users.manager.id);
    expect(row?.decidedAt).toBeInstanceOf(Date);
    expect(row?.note).toBe("bori weight checked");
    expect(row?.serverSeq).toBeGreaterThan(0);

    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.subjectId, id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("approval.approved");
    expect(audits[0]?.actorId).toBe(users.manager.id);
    expect(audits[0]?.meta).toMatchObject({ kind: "dc_note", decision: "approved" });
  });

  test("deciding twice is BAD_REQUEST", async () => {
    const { companyId, users } = await env.seedCompany();
    const id = await seedApproval(companyId, users.die_room.id, "die_rerank");
    await env.caller({ role: "manager", companyId }).approval.decide({ id, decision: "rejected" });
    await expect(
      env.caller({ role: "admin", companyId }).approval.decide({ id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select().from(approval).where(eq(approval.id, id));
    expect(row?.status).toBe("rejected");
    expect(row?.decidedBy).toBe(users.manager.id);
  });

  test("two approvers racing: one wins, the loser gets BAD_REQUEST, one audit row", async () => {
    const { companyId, users } = await env.seedCompany();
    const id = await seedApproval(companyId, users.supervisor.id, "phantom_void");
    // The manager's decide reads the pending row; the owner's decision lands before its write.
    env.beforeNextBatch(() =>
      env.caller({ role: "owner", companyId }).approval.decide({ id, decision: "rejected" }),
    );
    await expect(
      env.caller({ role: "manager", companyId }).approval.decide({ id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select().from(approval).where(eq(approval.id, id));
    expect(row?.status).toBe("rejected");
    expect(row?.decidedBy).toBe(users.owner.id);
    const audits = await env.db.select().from(auditLog).where(eq(auditLog.subjectId, id));
    expect(audits).toHaveLength(1);
  });

  test("the requester cannot approve their own request", async () => {
    const { companyId, users } = await env.seedCompany();
    const id = await seedApproval(companyId, users.manager.id, "dispatch_overdraw");
    await expect(
      env.caller({ role: "manager", companyId }).approval.decide({ id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("foundry approves a cast close but not a D/C note", async () => {
    const { companyId, users } = await env.seedCompany();
    const cast = await seedApproval(companyId, users.supervisor.id, "cast_close");
    const dc = await seedApproval(companyId, users.office.id, "dc_note");
    const foundry = env.caller({ role: "foundry", companyId });
    await expect(foundry.approval.decide({ id: cast, decision: "approved" })).resolves.toMatchObject({
      status: "approved",
    });
    await expect(foundry.approval.decide({ id: dc, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("another company's approval is NOT_FOUND and list is tenant-scoped", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const idA = await seedApproval(a.companyId, a.users.office.id, "dc_note");
    const idB = await seedApproval(b.companyId, b.users.office.id, "dc_note");
    await expect(
      env.caller({ role: "manager", companyId: b.companyId }).approval.decide({ id: idA, decision: "approved" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const listB = await env.caller({ role: "viewer", companyId: b.companyId }).approval.list({ status: "pending" });
    expect(listB.items.map((r) => r.id)).toEqual([idB]);
    expect(listB.total).toBe(1);
    expect(listB.items[0]?.requestedByName).toContain("office");

    await env.caller({ role: "manager", companyId: b.companyId }).approval.decide({ id: idB, decision: "approved" });
    const pendingB = await env.caller({ role: "viewer", companyId: b.companyId }).approval.list({ status: "pending" });
    expect(pendingB.items).toHaveLength(0);
    expect(pendingB.total).toBe(0);
    const approvedB = await env.caller({ role: "viewer", companyId: b.companyId }).approval.list({ status: "approved" });
    expect(approvedB.items.map((r) => r.id)).toEqual([idB]);
    expect(approvedB.items[0]?.decidedByName).toContain("manager");
  });

  test("list pages with limit/offset and reports total and nextOffset", async () => {
    const { companyId, users } = await env.seedCompany();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await seedApproval(companyId, users.office.id, "dc_note"));
    }
    const api = env.caller({ role: "viewer", companyId });
    const p1 = await api.approval.list({ status: "pending", limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.nextOffset).toBe(2);
    const p2 = await api.approval.list({ status: "pending", limit: 2, offset: 2 });
    const p3 = await api.approval.list({ status: "pending", limit: 2, offset: 4 });
    expect(p3.items).toHaveLength(1);
    expect(p3.nextOffset).toBeNull();
    const seen = [...p1.items, ...p2.items, ...p3.items].map((r) => r.id);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  test("only one pending approval per kind and subject", async () => {
    const { companyId, users } = await env.seedCompany();
    const subjectId = crypto.randomUUID();
    const row = { companyId, kind: "cast_close" as const, subjectId, requestedBy: users.supervisor.id };
    await env.db.insert(approval).values({ id: crypto.randomUUID(), ...row });
    const dup = async () => env.db.insert(approval).values({ id: crypto.randomUUID(), ...row });
    await expect(dup()).rejects.toThrow();
    // Once decided, a fresh request for the same subject is allowed again.
    await env.db.update(approval).set({ status: "rejected" }).where(eq(approval.subjectId, subjectId));
    await expect(dup()).resolves.toBeDefined();
  });
});

describe("many plants per person (spec P10)", () => {
  async function accountantInTwoPlants() {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const userId = await env.seedUser("accountant two-plant");
    // A first, B later: B is the most recent membership.
    await env.addMembership(userId, a.companyId, "accountant", { createdAt: new Date(Date.now() - 60_000) });
    await env.addMembership(userId, b.companyId, "office");
    const custA = await env.seedCustomer(a.companyId);
    const custB = await env.seedCustomer(b.companyId);
    return { a, b, userId, custA, custB };
  }

  test("one user may hold memberships in two companies, but not two in the same one", async () => {
    const { a, userId } = await accountantInTwoPlants();
    const rows = await env.db.select().from(membership).where(eq(membership.userId, userId));
    expect(rows).toHaveLength(2);
    await expect(env.addMembership(userId, a.companyId, "viewer")).rejects.toThrow();
  });

  test("without a header the most recent membership is active", async () => {
    const { b, userId, custB } = await accountantInTwoPlants();
    const api = env.callerForUser(userId);
    const me = await api.auth.me();
    expect(me.company?.id).toBe(b.companyId);
    expect(me.company?.role).toBe("office");
    const list = await api.customer.list({});
    expect(list.items.map((c) => c.id)).toEqual([custB]);
  });

  test("the x-orrn-company header picks the active company and data follows it", async () => {
    const { a, b, userId, custA } = await accountantInTwoPlants();
    const api = env.callerForUser(userId, { company: a.companyId });
    const me = await api.auth.me();
    expect(me.company?.id).toBe(a.companyId);
    expect(me.company?.role).toBe("accountant");
    expect(me.memberships).toEqual(
      expect.arrayContaining([
        { companyId: a.companyId, name: expect.any(String), role: "accountant" },
        { companyId: b.companyId, name: expect.any(String), role: "office" },
      ]),
    );
    expect(me.memberships).toHaveLength(2);
    const list = await api.customer.list({});
    expect(list.items.map((c) => c.id)).toEqual([custA]);
    // An id from the other plant is invisible here.
    const otherCustomers = await api.customer.list({ search: "Customer" });
    expect(otherCustomers.items.every((c) => c.companyId === a.companyId)).toBe(true);
  });

  test("a header naming a company the user is not in is FORBIDDEN, never a silent fallback (RP2)", async () => {
    const { userId } = await accountantInTwoPlants();
    const stranger = await env.seedCompany();
    const api = env.callerForUser(userId, { company: stranger.companyId });
    for (const call of [() => api.auth.me(), () => api.customer.list({}), () => api.customer.create({ name: "x" })]) {
      await expect(call()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "You don't have access to that plant",
      });
    }
    const leaked = await env.db.select().from(customer).where(eq(customer.name, "x"));
    expect(leaked).toHaveLength(0);
  });

  test("a missing header still falls back to the last switched / newest membership (RP2)", async () => {
    const { a, b, userId } = await accountantInTwoPlants();
    expect((await env.callerForUser(userId).auth.me()).company?.id).toBe(b.companyId);
    await env.callerForUser(userId).company.switch({ companyId: a.companyId });
    expect((await env.callerForUser(userId).auth.me()).company?.id).toBe(a.companyId);
  });

  test("a single-membership user resolves exactly as before", async () => {
    const { companyId, users } = await env.seedCompany();
    const me = await env.callerForUser(users.packer.id).auth.me();
    expect(me.company?.id).toBe(companyId);
    expect(me.company?.role).toBe("packer");
    expect(me.memberships).toEqual([{ companyId, name: expect.any(String), role: "packer" }]);
  });

  test("company.switch checks membership and becomes the default without a header", async () => {
    const { a, b, userId } = await accountantInTwoPlants();
    const api = env.callerForUser(userId);
    const res = await api.company.switch({ companyId: a.companyId });
    expect(res).toMatchObject({ companyId: a.companyId, role: "accountant" });
    expect((await env.callerForUser(userId).auth.me()).company?.id).toBe(a.companyId);

    const stranger = await env.seedCompany();
    await expect(api.company.switch({ companyId: stranger.companyId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Switching back works too.
    await env.callerForUser(userId).company.switch({ companyId: b.companyId });
    expect((await env.callerForUser(userId).auth.me()).company?.id).toBe(b.companyId);
  });

  test("a membership in a suspended company is neither active nor listed", async () => {
    const { a, b, userId } = await accountantInTwoPlants();
    const { company } = await import("@orrn/db/schema");
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, b.companyId));
    await expect(env.callerForUser(userId, { company: b.companyId }).auth.me()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const me = await env.callerForUser(userId).auth.me();
    expect(me.company?.id).toBe(a.companyId);
    expect(me.memberships.map((m) => m.companyId)).toEqual([a.companyId]);
    await expect(env.callerForUser(userId).company.switch({ companyId: b.companyId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("impersonation wins over x-orrn-company; a foreign plant header is not rejected under a grant", async () => {
    const { impersonationGrant, platformAdmin } = await import("@orrn/db/schema");
    const own = await env.seedCompany();
    const target = await env.seedCompany();
    const foreign = await env.seedCompany();
    // A support engineer who is also a member of their own plant.
    const staffId = await env.seedUser("staff");
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "super_admin" });
    await env.addMembership(staffId, own.companyId, "viewer");
    await env.db.insert(impersonationGrant).values({
      id: crypto.randomUUID(),
      platformAdminId: staffId,
      companyId: target.companyId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    for (const header of [own.companyId, foreign.companyId]) {
      const me = await env
        .callerForUser(staffId, { impersonate: target.companyId, company: header })
        .auth.me();
      expect(me.company?.id).toBe(target.companyId);
      expect(me.company?.role).toBe("owner");
      expect(me.impersonation?.companyId).toBe(target.companyId);
    }
    // Without a grant the foreign header is rejected as usual.
    await expect(
      env.callerForUser(staffId, { company: foreign.companyId }).auth.me(),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "You don't have access to that plant" });
  });

  test("writes land in the active company only", async () => {
    const { a, b, userId } = await accountantInTwoPlants();
    // Make the user able to write customers in both plants.
    await env.db.update(membership).set({ role: "manager" }).where(eq(membership.userId, userId));
    await env.callerForUser(userId, { company: a.companyId }).customer.create({ name: "Only in A" });
    const inA = await env.db
      .select()
      .from(customer)
      .where(and(eq(customer.companyId, a.companyId), eq(customer.name, "Only in A")));
    const inB = await env.db
      .select()
      .from(customer)
      .where(and(eq(customer.companyId, b.companyId), eq(customer.name, "Only in A")));
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(0);
  });
});
