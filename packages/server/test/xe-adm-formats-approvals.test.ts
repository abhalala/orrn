/**
 * XE parity lane ADM: number formats (#77) and approver rules (#78).
 *
 * #77: the existing series API (`nextDocNumber`, `allocateDocNumbers`) keeps working and prints
 * today's text without a format; a format set later changes only numbers issued after it; the count
 * continues and still restarts each financial year; another plant's format never applies.
 * #78: with no rules every kind's deciders equal `APPROVER_ROLES` for every role (today's behaviour);
 * a rule changes who may decide in `approval.decide` and `approval.list` (`canDecide`); a threshold
 * reads the request's own figure (dispatch overdraw above 2% needs the owner).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, approvalKinds, companyRoles } from "@orrn/db/schema";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: typeof import("../src/lib/clock").setClockForTests;
let docs: typeof import("../src/lib/docNumber");
beforeAll(async () => {
  env = await createTestEnv({ defaultModules: ["masters_plus", "docs"] });
  setClock = (await import("../src/lib/clock")).setClockForTests;
  docs = await import("../src/lib/docNumber");
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

async function plant() {
  const { companyId, users } = await env.seedCompany({ settings: { timezone: "Asia/Kolkata" } });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, admin: as("admin") };
}

const OCT = new Date("2026-10-03T06:30:00.000Z");
const NEXT_FY = new Date("2027-04-02T06:30:00.000Z");

describe("number formats (#77)", () => {
  test("without a format the series API prints today's text", async () => {
    const p = await plant();
    expect((await docs.nextDocNumber(env.db, p.companyId, "so", OCT)).number).toBe("SO-1");
    expect((await docs.nextDocNumber(env.db, p.companyId, "pl", OCT)).number).toBe("PL/2026-27/1");
    expect((await docs.allocateDocNumbers(env.db, p.companyId, "grn", OCT, 2)).numbers).toEqual(["GRN-1", "GRN-2"]);
    expect((await docs.nextDocNumber(env.db, p.companyId, "bundle", OCT)).number).toMatch(/^26J/);
  });

  test("a format changes only later numbers, the count continues, and the year restarts it", async () => {
    const p = await plant();
    setClock(OCT);
    const before = await docs.allocateDocNumbers(env.db, p.companyId, "so", OCT, 2);
    expect(before.numbers).toEqual(["SO-1", "SO-2"]);
    const shown = await p.admin.masters.numberFormats.get();
    expect(shown.find((r) => r.docType === "so")).toMatchObject({ next: "SO-3", custom: null, period: "2026-27" });
    await p.admin.masters.numberFormats.set({ docType: "so", format: { prefix: "FC/SO/", fy: "short", pad: 4 } });
    expect((await p.admin.masters.numberFormats.get()).find((r) => r.docType === "so")!.next).toBe("FC/SO/26-27/0003");
    expect((await docs.nextDocNumber(env.db, p.companyId, "so", OCT)).number).toBe("FC/SO/26-27/0003");
    // A real order takes its number from the same counter.
    const cust = await env.seedCustomer(p.companyId);
    const section = await env.seedDie(p.companyId);
    const order = await p.as("office").orders.create({ customerId: cust, poNumber: null, lines: [{ sectionId: section, cutLengthMm: 3658, kgG: 100_000 }] });
    expect(order.number).toBe("FC/SO/26-27/0004");
    // 1 April: the counter's period moves, so the count starts at 1 again.
    expect((await docs.nextDocNumber(env.db, p.companyId, "so", NEXT_FY)).number).toBe("FC/SO/27-28/0001");
    // Back to today's text: later numbers only.
    await p.admin.masters.numberFormats.set({ docType: "so", format: null });
    expect((await docs.nextDocNumber(env.db, p.companyId, "so", OCT)).number).toBe("SO-5");
  });

  test("checks: no digits in the prefix; the year is required where the number is unique across years", async () => {
    const p = await plant();
    await expect(p.admin.masters.numberFormats.set({ docType: "so", format: { prefix: "SO1/", fy: "none", pad: 0 } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The prefix may hold letters and / - _ . only, no digits" });
    await expect(p.admin.masters.numberFormats.set({ docType: "pl", format: { prefix: "PL-", fy: "none", pad: 0 } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This number must show the year, or it would repeat next year" });
    await p.admin.masters.numberFormats.set({ docType: "pl", format: { prefix: "DL/", fy: "short", pad: 3 } });
    expect((await docs.nextDocNumber(env.db, p.companyId, "pl", OCT)).number).toBe("DL/26-27/001");
  });

  test("permission and tenancy: only the admin (and owner) set formats; one plant's format never touches another", async () => {
    const a = await plant();
    const b = await plant();
    for (const role of ["manager", "office", "viewer"] as CompanyRole[]) {
      await expect(a.as(role).masters.numberFormats.set({ docType: "grn", format: { prefix: "G/", fy: "none", pad: 0 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await a.as("owner").masters.numberFormats.set({ docType: "grn", format: { prefix: "G/", fy: "none", pad: 0 } });
    expect((await docs.nextDocNumber(env.db, a.companyId, "grn", OCT)).number).toBe("G/1");
    expect((await docs.nextDocNumber(env.db, b.companyId, "grn", OCT)).number).toBe("GRN-1");
  });
});

/** A pending request opened by `by`, as a module would (lib/approval.ts), with the given meta. */
async function request(companyId: string, kind: (typeof approvalKinds)[number], by: string, meta: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await env.db.insert(approval).values({ id, companyId, kind, subjectId: crypto.randomUUID(), status: "pending", meta, requestedBy: by });
  return id;
}

const overMeta = (orderedG: number, totalG: number) => ({
  dispatchId: "d",
  dispatchCode: "D-1",
  toleranceBp: 0,
  lines: [{ lineId: "l", orderNumber: "SO-1", orderPeriod: "2026-27", lineNo: 1, sectionCode: "1", orderedG, limitG: orderedG, totalG, overG: totalG - orderedG }],
});

describe("approver rules (#78)", () => {
  test("defaults: with no rules, every kind and role decides exactly as APPROVER_ROLES says", async () => {
    const { mayDecide, kindsRoleMayDecide } = await import("../src/lib/approverRules");
    const { APPROVER_ROLES, canApprove } = await import("../src/lib/permissions");
    for (const kind of approvalKinds) {
      for (const role of companyRoles) {
        expect({ kind, role, may: mayDecide(role, kind, {}, {}) }).toEqual({ kind, role, may: APPROVER_ROLES[kind].includes(role) });
        expect(mayDecide(role, kind, {}, {})).toBe(canApprove(role, kind));
      }
    }
    for (const role of companyRoles) {
      expect(kindsRoleMayDecide(role, {})).toEqual(approvalKinds.filter((k) => canApprove(role, k)));
    }
  });

  test("a rule moves who decides: the office may decide a D/C note, the manager no longer", async () => {
    const p = await plant();
    await p.admin.masters.approvalRules.set({ kind: "dc_note", rule: { roles: ["office"] } });
    const rules = await p.as("viewer").masters.approvalRules.get();
    expect(rules.find((r) => r.kind === "dc_note")).toMatchObject({ builtIn: ["owner", "admin", "manager"], rule: { roles: ["owner", "office"] } });
    const req = await request(p.companyId, "dc_note", p.users.storekeeper.id);
    const listed = await p.as("manager").approval.list({ status: "pending" });
    expect(listed.items.find((i) => i.id === req)!.canDecide).toBe(false);
    expect((await p.as("office").approval.list({ status: "pending" })).items.find((i) => i.id === req)!.canDecide).toBe(true);
    await expect(p.as("manager").approval.decide({ id: req, decision: "rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("office").approval.decide({ id: req, decision: "rejected", note: "No note needed" });
    // Clearing the rule brings the built-in approvers back.
    await p.admin.masters.approvalRules.set({ kind: "dc_note", rule: null });
    const req2 = await request(p.companyId, "dc_note", p.users.storekeeper.id);
    await expect(p.as("office").approval.decide({ id: req2, decision: "rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: req2, decision: "rejected" });
  });

  test("dispatch overdraw above 2% needs the owner; at or under 2% the manager decides", async () => {
    const p = await plant();
    await p.admin.masters.approvalRules.set({ kind: "dispatch_overdraw", rule: { roles: ["manager", "admin"], above: { value: 200, roles: ["owner"] } } });
    const small = await request(p.companyId, "dispatch_overdraw", p.users.supervisor.id, overMeta(100_000, 102_000));
    const big = await request(p.companyId, "dispatch_overdraw", p.users.supervisor.id, overMeta(100_000, 103_000));
    const view = (await p.as("manager").approval.list({ status: "pending" })).items;
    expect(view.find((i) => i.id === small)!.canDecide).toBe(true);
    expect(view.find((i) => i.id === big)!.canDecide).toBe(false);
    await expect(p.as("manager").approval.decide({ id: big, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: small, decision: "approved" });
    await p.as("owner").approval.decide({ id: big, decision: "approved" });
  });

  test("a role a rule names passes the early refusal of decide; the requester still cannot decide", async () => {
    const p = await plant();
    await expect(p.as("storekeeper").approval.decide({ id: "x", decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.admin.masters.approvalRules.set({ kind: "phantom_void", rule: { roles: ["storekeeper"] } });
    await expect(p.as("storekeeper").approval.decide({ id: "x", decision: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const own = await request(p.companyId, "phantom_void", p.users.storekeeper.id);
    await expect(p.as("storekeeper").approval.decide({ id: own, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Someone else has to approve your request" });
  });

  test("checks, permission and tenancy", async () => {
    const a = await plant();
    const b = await plant();
    await expect(a.admin.masters.approvalRules.set({ kind: "dc_note", rule: { roles: ["manager"], above: { value: 10, roles: ["owner"] } } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This kind of request has no figure to set a limit on" });
    for (const role of ["manager", "office", "viewer"] as CompanyRole[]) {
      await expect(a.as(role).masters.approvalRules.set({ kind: "dc_note", rule: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await a.admin.masters.approvalRules.set({ kind: "dc_note", rule: { roles: ["office"] } });
    // Plant B keeps the built-in approvers.
    expect((await b.admin.masters.approvalRules.get()).find((r) => r.kind === "dc_note")!.rule).toBeNull();
    const reqB = await request(b.companyId, "dc_note", b.users.storekeeper.id);
    await expect(b.as("office").approval.decide({ id: reqB, decision: "rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A's request is Not found from B.
    const reqA = await request(a.companyId, "dc_note", a.users.storekeeper.id);
    await expect(b.as("manager").approval.decide({ id: reqA, decision: "rejected" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("review B1: a rule names only roles that may approve, and for a D/C note only roles that see its figures", async () => {
    const a = await plant();
    for (const role of ["viewer", "packer", "operator", "press"] as CompanyRole[]) {
      await expect(a.admin.masters.approvalRules.set({ kind: "dc_note", rule: { roles: [role] } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Choose roles from the list" });
      await expect(a.admin.masters.approvalRules.set({ kind: "cast_close", rule: { roles: [role] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(a.admin.masters.approvalRules.set({ kind: "dispatch_overdraw", rule: { roles: ["manager"], above: { value: 200, roles: [role] } } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const dc = (await a.admin.masters.approvalRules.get()).find((r) => r.kind === "dc_note")!;
    expect(dc.pickable).not.toContain("viewer");
    expect(dc.pickable).not.toContain("packer");
    expect(dc.pickable).toContain("manager");
    // A stored rule that breaks the list (written before this check) falls back to the built-in approvers.
    const { company } = await import("@orrn/db/schema/tenant");
    const { eq, sql } = await import("drizzle-orm");
    await env.db.update(company).set({ settings: sql`json_set(coalesce(settings, '{}'), '$.approvalRules', json('{"dc_note":{"roles":["packer"]}}'))` }).where(eq(company.id, a.companyId));
    expect((await a.admin.masters.approvalRules.get()).find((r) => r.kind === "dc_note")!.rule).toBeNull();
  });
});
