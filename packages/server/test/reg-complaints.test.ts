/**
 * XE parity lane REG, #18 and #34: the complaint register. A complaint opens on a bundle (staff by id or
 * number, the party from the portal on a bundle it received) with the trace attached by the server, takes
 * a CMP number from the doc series, moves open -> investigating -> replied -> closed, and keeps the
 * investigation (root cause, corrective action, who and by when) on the same row. Another plant gets
 * "Not found"; a party never sees the trace.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, complaint } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { NOON, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const helpers = portalHelpers(() => env);
const plant = (settings: Record<string, unknown> = {}) => helpers.portalPlant({ requireCastOnBundle: false, ...settings });

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

async function shipped(p: SalesPlant, kgs: number[], cust = p.customerId) {
  const serials = await p.pack(p.dieA, kgs.map((k) => ({ kg: k })));
  const d = await p.held(serials, cust);
  await p.owner.dispatch.complete({ id: d });
  return { d, serials };
}

describe("staff complaints", () => {
  test("open by bundle number attaches the trace, takes CMP-1 and writes the audit row", async () => {
    setClock(NOON);
    const p = await plant();
    const { d, serials } = await shipped(p, [10]);
    const opened = await p.as("office").complaints.open({ serial: serials[0]!, kind: "surface", description: "Scratches on every piece", affectedPcs: 1 });
    expect(opened.number).toBe("CMP-1");
    const got = await p.as("manager").complaints.get({ id: opened.id });
    expect(got).toMatchObject({ status: "open", source: "staff", kind: "surface", customerId: p.customerId, dispatchId: d });
    const trace = got.traceJson as { bundle: { serial: string }; dispatch: { id: string } | null; section: { id: string } };
    expect(trace.bundle.serial).toBe(serials[0]!);
    expect(trace.dispatch?.id).toBe(d);
    expect(trace.section.id).toBe(p.dieA);
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "complaint.open")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ number: "CMP-1", source: "staff", bundle: serials[0]! });
    expect((await p.as("office").complaints.forBundle({ bundleId: got.bundleId })).map((c) => c.number)).toEqual(["CMP-1"]);
    expect(await errOf(p.as("office").complaints.open({ serial: serials[0]!, kind: "surface", description: "x", affectedPcs: 99_999 }))).toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("another plant gets Not found, and roles without the action are refused", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const { serials } = await shipped(p, [10]);
    const opened = await p.owner.complaints.open({ serial: serials[0]!, kind: "bend", description: "Bent" });
    expect(await errOf(q.owner.complaints.get({ id: opened.id }))).toEqual({ code: "NOT_FOUND", message: "Complaint not found" });
    expect(await errOf(q.owner.complaints.open({ serial: serials[0]!, kind: "bend", description: "Bent" }))).toMatchObject({ code: "NOT_FOUND" });
    expect((await q.owner.complaints.list()).items).toHaveLength(0);
    expect(await errOf(q.owner.complaints.investigate({ id: opened.id, serverSeq: 0, rootCause: "x" }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(p.as("viewer").complaints.open({ serial: serials[0]!, kind: "bend", description: "Bent" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.as("viewer").complaints.list())).toMatchObject({ code: "FORBIDDEN" });
    const got = await p.as("packer").complaints.get({ id: opened.id });
    expect(await errOf(p.as("packer").complaints.reply({ id: opened.id, serverSeq: got.serverSeq, reply: "Sorry" }))).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("the module gate covers reads and writes", async () => {
    setClock(NOON);
    const p = await plant();
    const { serials } = await shipped(p, [10]);
    const { companyId } = p;
    const { company } = await import("@orrn/db/schema/tenant");
    await env.db.update(company).set({ modules: ["customers", "dies", "bundles", "dispatches", "orders"] }).where(eq(company.id, companyId));
    expect(await errOf(p.owner.complaints.open({ serial: serials[0]!, kind: "bend", description: "Bent" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.owner.complaints.list())).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("investigate, reply, close: the flow, the investigation fields and stale saves", async () => {
    setClock(NOON);
    const p = await plant();
    const { serials } = await shipped(p, [10]);
    const office = p.as("office");
    const opened = await office.complaints.open({ serial: serials[0]!, kind: "hardness", description: "Soft" });
    let row = await office.complaints.get({ id: opened.id });
    row = await office.complaints.investigate({
      id: opened.id,
      serverSeq: row.serverSeq,
      rootCause: "Soak cut short",
      correctiveAction: "Log a reading every 15 minutes",
      actionOwnerId: p.users.supervisor.id,
      actionDue: "2026-10-10",
    });
    expect(row).toMatchObject({ status: "investigating", rootCause: "Soak cut short", actionOwnerId: p.users.supervisor.id, actionDue: "2026-10-10", actionDoneAt: null });
    expect(row.actionOwnerName).not.toBeNull();
    expect(row.investigatedBy).toBe(p.users.office.id);
    // A save over an older version is a CONFLICT and writes nothing.
    expect(await errOf(office.complaints.reply({ id: opened.id, serverSeq: row.serverSeq - 1, reply: "x" }))).toMatchObject({ code: "CONFLICT" });
    // The action owner must be a member of this plant.
    const outsider = await env.seedUser("Outsider");
    expect(await errOf(office.complaints.investigate({ id: opened.id, serverSeq: row.serverSeq, actionOwnerId: outsider }))).toMatchObject({ code: "BAD_REQUEST" });
    row = await office.complaints.investigate({ id: opened.id, serverSeq: row.serverSeq, actionDone: true });
    expect(row.actionDoneAt).not.toBeNull();
    row = await office.complaints.reply({ id: opened.id, serverSeq: row.serverSeq, reply: "We found the cause and changed the oven log." });
    expect(row).toMatchObject({ status: "replied", repliedBy: p.users.office.id });
    row = await office.complaints.close({ id: opened.id, serverSeq: row.serverSeq, note: "Customer accepted" });
    expect(row).toMatchObject({ status: "closed", closeNote: "Customer accepted" });
    expect(await errOf(office.complaints.investigate({ id: opened.id, serverSeq: row.serverSeq, rootCause: "x" }))).toMatchObject({ code: "BAD_REQUEST", message: "This complaint is closed" });
    expect(await errOf(office.complaints.close({ id: opened.id, serverSeq: row.serverSeq }))).toMatchObject({ code: "BAD_REQUEST", message: "This complaint is closed" });
    const actions = (await env.db.select({ a: auditLog.action }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, opened.id)))).map((r) => r.a).sort();
    expect(actions).toEqual(["complaint.close", "complaint.investigate", "complaint.investigate", "complaint.open", "complaint.reply"]);
    const list = await office.complaints.list({ status: "all" });
    expect(list.counts).toMatchObject({ closed: 1, open: 0 });
    expect((await office.complaints.list()).items).toHaveLength(0);
  }, SLOW);
});

describe("party complaints", () => {
  test("a party raises one on a bundle it received, sees the reply, never the trace; others are Not found", async () => {
    setClock(NOON);
    const p = await plant();
    const party = await helpers.partyLogin(p);
    const mine = await shipped(p, [10]);
    const theirs = await shipped(p, [8], p.otherCustomer);
    const unshipped = await p.pack(p.dieA, [{ kg: 5 }]);
    const made = await party.api.portal.complaints.create({ bundleNo: mine.serials[0]!, kind: "dimension", description: "Too short", affectedPcs: 1 });
    expect(made).toMatchObject({ number: "CMP-1", status: "open", kind: "dimension", bundleNo: mine.serials[0]!, reply: null });
    expect(Object.keys(made)).not.toContain("traceJson");
    expect(Object.keys(made)).not.toContain("rootCause");
    for (const bundleNo of [theirs.serials[0]!, unshipped[0]!, "nope"]) {
      expect(await errOf(party.api.portal.complaints.create({ bundleNo, kind: "dimension", description: "x" }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    }
    expect(await errOf(party.api.portal.complaints.create({ bundleNo: mine.serials[0]!, kind: "dimension", description: "x", ratePaise: 1 } as never))).toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select().from(complaint).where(eq(complaint.id, made.id));
    expect(row).toMatchObject({ source: "portal", customerId: p.customerId, portalUserId: party.portalUserId });
    const office = p.as("office");
    const got = await office.complaints.get({ id: made.id });
    await office.complaints.reply({ id: made.id, serverSeq: got.serverSeq, reply: "Replacement on the next load" });
    const seen = await party.api.portal.complaints.get({ id: made.id });
    expect(seen).toMatchObject({ status: "replied", reply: "Replacement on the next load" });
    expect((await party.api.portal.complaints.list()).items.map((c) => c.id)).toEqual([made.id]);
    // The other party's own complaint is not listed for this party, and its id is Not found.
    const other = await office.complaints.open({ serial: theirs.serials[0]!, kind: "bend", description: "Bent" });
    expect(await errOf(party.api.portal.complaints.get({ id: other.id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect((await party.api.portal.complaints.list()).items).toHaveLength(1);
    // The portal shows Complaints only while the module is on.
    expect((await party.api.portal.me()).complaints).toBe(true);
    const { company } = await import("@orrn/db/schema/tenant");
    await env.db.update(company).set({ modules: ["customers", "dies", "bundles", "dispatches", "orders"] }).where(eq(company.id, p.companyId));
    expect((await party.api.portal.me()).complaints).toBe(false);
    expect(await errOf(party.api.portal.complaints.list())).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});

describe("review fixes", () => {
  test("a staff complaint with no dispatch stays out of the party's portal, even when it names the party", async () => {
    setClock(NOON);
    const p = await plant();
    const party = await helpers.partyLogin(p);
    const unshipped = await p.pack(p.dieA, [{ kg: 5 }]);
    const internal = await p.as("office").complaints.open({ serial: unshipped[0]!, kind: "surface", description: "Die marks, polish skipped" });
    // Pin the worst case: the row names this party (the sales-order fallback) but has no dispatch.
    await env.db.update(complaint).set({ customerId: p.customerId, dispatchId: null }).where(eq(complaint.id, internal.id));
    expect((await party.api.portal.complaints.list()).items.map((c) => c.id)).not.toContain(internal.id);
    expect(await errOf(party.api.portal.complaints.get({ id: internal.id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
  }, SLOW);

  test("staff open by a party number shared by two bundles is refused; the serial still works", async () => {
    setClock(NOON);
    const p = await plant();
    const a = await shipped(p, [10]);
    const b = await shipped(p, [8], p.otherCustomer);
    await env.db.update(bundle).set({ partyNo: "123" }).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, a.serials[0]!)));
    await env.db.update(bundle).set({ partyNo: "123" }).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, b.serials[0]!)));
    expect(await errOf(p.as("office").complaints.open({ serial: "123", kind: "bend", description: "Bent" }))).toMatchObject({ code: "BAD_REQUEST" });
    const ok = await p.as("office").complaints.open({ serial: b.serials[0]!, kind: "bend", description: "Bent" });
    expect((await p.as("office").complaints.get({ id: ok.id })).customerId).toBe(p.otherCustomer);
  }, SLOW);
});

describe("party order progress (#32)", () => {
  test("portal.orders.get carries each line's kg by stage and the headline stage", async () => {
    setClock(NOON);
    const p = await plant();
    const party = await helpers.partyLogin(p);
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 15 }], o.lineIds[0]!);
    const d = await p.held([serials[0]!]);
    await p.owner.dispatch.complete({ id: d });
    const got = await party.api.portal.orders.get({ id: o.id });
    expect(got.lines[0]!.progress).toMatchObject({ stage: "packed", packedG: 15_000, dispatchedG: 10_000 });
    expect(Object.keys(got.lines[0]!.progress!).sort()).toEqual(["ageingG", "dispatchedG", "notPlannedG", "onPressG", "packedG", "plannedG", "stage", "unpackedG"]);
  }, SLOW);
});
