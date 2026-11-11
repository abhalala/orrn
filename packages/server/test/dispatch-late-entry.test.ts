/**
 * Late packing-list entry for line-down hours (arch 52): `dispatch.complete({ occurredAt, lateReason })`
 * completes at the time the truck really left, at most 72 h back and never in the future, once a
 * second person approved exactly that time (`dispatch_late_entry`). The dispatch's `completed_at` and
 * the ledger's `posted_at` are that time; the dispatch carries `late_entry`, the reason and the approval.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, dispatch } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

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

const { plant, ledgerOf } = salesHelpers(() => env);
const NOW = new Date("2026-11-10T06:00:00.000Z");
const H = 60 * 60 * 1000;

async function lateRows(companyId: string) {
  return env.db
    .select()
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, "dispatch_late_entry")));
}

/** A held dispatch of one in-band bundle with nothing else to approve (no order line, no overdraw). */
async function heldDispatch(): Promise<{ p: SalesPlant; id: string }> {
  const p = await plant();
  const [serial] = await p.pack(p.dieA, [{ kg: 50 }]);
  const id = await p.held([serial!]);
  return { p, id };
}

describe("late packing-list entry (arch 52)", () => {
  test("allowed: asked, approved by a second person, then completed at the time the truck left; the ledger posts then", async () => {
    // Packed and held before the line went down; entered 5 h after the truck left.
    setClock(new Date(NOW.getTime() - 10 * H));
    const { p, id } = await heldDispatch();
    setClock(NOW);
    const office = p.as("office");
    const occurredAt = NOW.getTime() - 5 * H;
    await expect(office.dispatch.complete({ id, occurredAt, lateReason: "Line down 1 to 6, paper PL" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Entered late: a second person has to approve the dispatch time before this dispatch can complete.",
    });
    const [req, ...more] = await lateRows(p.companyId);
    expect(more).toEqual([]);
    expect(req).toMatchObject({ status: "pending", subjectId: id, requestedBy: p.users.office.id, requestNote: "Line down 1 to 6, paper PL" });
    expect(req!.meta).toEqual({ dispatchId: id, dispatchCode: expect.any(String), occurredAt, reason: "Line down 1 to 6, paper PL", bundles: 1, weightG: 50_000 });
    // Nothing moved yet.
    expect((await ledgerOf(p.companyId, id)).length).toBe(0);

    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await expect(office.dispatch.complete({ id, occurredAt, lateReason: "Line down 1 to 6, paper PL" })).resolves.toMatchObject({ success: true });

    const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(row).toMatchObject({ status: "completed", lateEntry: true, lateEntryReason: "Line down 1 to 6, paper PL", lateEntryApprovalId: req!.id });
    expect(row!.completedAt!.getTime()).toBe(occurredAt);
    const ledger = await ledgerOf(p.companyId, id);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.map((l) => [l.voucherType, l.postedAt.getTime()])).toEqual([["dispatch", occurredAt]]);
    const [audit] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.complete"), eq(auditLog.subjectId, id)));
    expect(audit!.meta).toMatchObject({ lateEntry: { occurredAt, reason: "Line down 1 to 6, paper PL", approvalId: req!.id } });
  }, SLOW);

  test("the ledger never posts before the bundle's last row: a bundle packed after the late time posts just after its pack", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch(); // packed at NOW
    const occurredAt = NOW.getTime() - 2 * H;
    await p.as("office").dispatch.complete({ id, occurredAt, lateReason: "Paper PL" }).catch(() => undefined);
    const [req] = await lateRows(p.companyId);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await p.as("office").dispatch.complete({ id, occurredAt, lateReason: "Paper PL" });
    const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(row!.completedAt!.getTime()).toBe(occurredAt);
    const [out] = await ledgerOf(p.companyId, id);
    expect(out!.postedAt.getTime()).toBeGreaterThan(occurredAt);
    expect(out!.postedAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 1);
  }, SLOW);

  test("refused: more than 72 h back, in the future, no reason, a reason with no time", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    await expect(c.dispatch.complete({ id, occurredAt: NOW.getTime() - 72 * H - 1, lateReason: "Line down" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A late packing list can go back at most 72 hours.",
    });
    await expect(c.dispatch.complete({ id, occurredAt: NOW.getTime() + 10 * 60 * 1000, lateReason: "Line down" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The dispatch time can't be in the future.",
    });
    await expect(c.dispatch.complete({ id, occurredAt: NOW.getTime() - H })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Give the reason the packing list is entered late.",
    });
    await expect(c.dispatch.complete({ id, lateReason: "Line down" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await lateRows(p.companyId)).toEqual([]);
    // Exactly 72 h back is still allowed (asked).
    await expect(c.dispatch.complete({ id, occurredAt: NOW.getTime() - 72 * H, lateReason: "Line down" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await lateRows(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("review 1: asked at 60 h, approved at 73 h: the approved time still completes; an unapproved time past 72 h is still refused", async () => {
    // The truck leaves Friday 18:00 (IST), the paper PL is entered Monday 06:00, a manager approves Monday 19:00.
    const friday1800 = Date.parse("2026-11-06T12:30:00.000Z");
    const monday0600 = Date.parse("2026-11-09T00:30:00.000Z");
    const monday1900 = Date.parse("2026-11-09T13:30:00.000Z");
    setClock(new Date(friday1800 - 8 * H));
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    setClock(new Date(monday0600));
    await expect(c.dispatch.complete({ id, occurredAt: friday1800, lateReason: "Line down all weekend" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await lateRows(p.companyId);
    setClock(new Date(monday1900));
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    // Another time, 73 h back and never approved: still too old, and nothing is asked.
    await expect(c.dispatch.complete({ id, occurredAt: friday1800 + 60_000, lateReason: "Line down" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A late packing list can go back at most 72 hours.",
    });
    expect(await lateRows(p.companyId)).toHaveLength(1);
    // The approved time completes, dated Friday.
    await expect(c.dispatch.complete({ id, occurredAt: friday1800, lateReason: "Line down all weekend" })).resolves.toMatchObject({ success: true });
    const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(row).toMatchObject({ status: "completed", lateEntry: true, lateEntryApprovalId: req!.id });
    expect(row!.completedAt!.getTime()).toBe(friday1800);
  }, SLOW);

  test("review 4: the dispatch keeps the reason the manager approved; a different reason on the second press is ignored", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    const occurredAt = NOW.getTime() - 5 * H;
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down, paper PL" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await lateRows(p.companyId);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "x x x" })).resolves.toMatchObject({ success: true });
    const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(row).toMatchObject({ lateEntry: true, lateEntryReason: "Line down, paper PL", lateEntryApprovalId: req!.id });
    const audits = await env.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, id), eq(auditLog.action, "dispatch.complete")));
    expect(audits).toHaveLength(1);
    expect((audits[0]!.meta as { lateEntry: { reason: string } }).lateEntry.reason).toBe("Line down, paper PL");
    // Asking again with only a different reason opened nothing.
    expect(await lateRows(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("review 5: getDispatch returns the late time waiting or approved, so the sheets can lock it; none once completed", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toBeNull();
    const occurredAt = NOW.getTime() - 4 * H;
    await c.dispatch.complete({ id, occurredAt, lateReason: "Internet down" }).catch(() => undefined);
    const [req] = await lateRows(p.companyId);
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toEqual({ status: "pending", occurredAt, reason: "Internet down", approvalId: req!.id });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toEqual({ status: "approved", occurredAt, reason: "Internet down", approvalId: req!.id });
    // A rejected ask is not offered.
    const other = NOW.getTime() - 2 * H;
    await c.dispatch.complete({ id, occurredAt: other, lateReason: "Internet down again" }).catch(() => undefined);
    const ask2 = (await lateRows(p.companyId)).find((r) => r.status === "pending")!;
    await p.as("manager").approval.decide({ id: ask2.id, decision: "rejected" });
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toMatchObject({ status: "approved", occurredAt });
    await c.dispatch.complete({ id, occurredAt, lateReason: "Internet down" });
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toBeNull();
  }, SLOW);

  test("review 7: an approval covers the bundles it was given for; bundles added after it ask again", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    const occurredAt = NOW.getTime() - 5 * H;
    await c.dispatch.complete({ id, occurredAt, lateReason: "Line down" }).catch(() => undefined);
    const [first] = await lateRows(p.companyId);
    expect(first!.meta).toMatchObject({ occurredAt, bundles: 1, weightG: 50_000 });
    await p.as("manager").approval.decide({ id: first!.id, decision: "approved" });
    const [more] = await p.pack(p.dieA, [{ kg: 60 }]);
    await p.owner.dispatch.addBundlesBySerial({ id, serials: [more!], allowUnassigned: true });
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toMatchObject({ status: "changed", occurredAt, approvalId: first!.id });
    // The same time, 2 bundles now: not the load approved, so a manager is asked again.
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const second = (await lateRows(p.companyId)).find((r) => r.status === "pending")!;
    expect(second.meta).toMatchObject({ occurredAt, bundles: 2, weightG: 110_000 });
    expect((await c.dispatch.getDispatch({ id })).lateEntry).toMatchObject({ status: "pending", approvalId: second.id });
    await p.as("manager").approval.decide({ id: second.id, decision: "approved" });
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).resolves.toMatchObject({ success: true });
    const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(row).toMatchObject({ lateEntryApprovalId: second.id });
  }, SLOW);

  test("review 7: past the 72 hours, a load changed after approval is refused and says why; putting it back completes", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    const occurredAt = NOW.getTime() - 60 * H;
    await c.dispatch.complete({ id, occurredAt, lateReason: "Line down" }).catch(() => undefined);
    const [req] = await lateRows(p.companyId);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    const [more] = await p.pack(p.dieA, [{ kg: 60 }]);
    await p.owner.dispatch.addBundlesBySerial({ id, serials: [more!], allowUnassigned: true });
    setClock(new Date(NOW.getTime() + 13 * H));
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The bundles changed after a manager approved this time. Put the load back as approved, or dispatch it at the time it leaves.",
    });
    expect(await lateRows(p.companyId)).toHaveLength(1);
    const added = (await c.dispatch.getDispatch({ id })).items.find((i) => i.serial === more)!;
    await p.owner.dispatch.removeBundle({ id, bundleId: added.bundleId });
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("an approval covers only the time it was asked for; another time withdraws a waiting ask and asks again", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    const t1 = NOW.getTime() - 3 * H;
    const t2 = NOW.getTime() - 2 * H;
    await c.dispatch.complete({ id, occurredAt: t1, lateReason: "Line down" }).catch(() => undefined);
    await c.dispatch.complete({ id, occurredAt: t2, lateReason: "Line down, it was 2 h ago" }).catch(() => undefined);
    const rows = await lateRows(p.companyId);
    const got = rows.map((r) => `${r.status} ${(r.meta as { occurredAt: number }).occurredAt}`).sort();
    expect(got).toEqual([`pending ${t2}`, `rejected ${t1}`]);
    expect(rows.find((r) => r.status === "rejected")!.note).toBe("Withdrawn: asked again with another time.");
    const pending = rows.find((r) => r.status === "pending")!;
    await p.as("manager").approval.decide({ id: pending.id, decision: "approved" });
    // Approved for t2: t1 asks again, it does not complete.
    await expect(c.dispatch.complete({ id, occurredAt: t1, lateReason: "Line down" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(c.dispatch.complete({ id, occurredAt: t2, lateReason: "Line down" })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("replayed: pressing Complete again with the same time opens no second request; after completion it is refused", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const c = p.as("office");
    const occurredAt = NOW.getTime() - H;
    for (let i = 0; i < 3; i++) {
      await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    const rows = await lateRows(p.companyId);
    expect(rows).toHaveLength(1);
    await p.as("manager").approval.decide({ id: rows[0]!.id, decision: "approved" });
    await c.dispatch.complete({ id, occurredAt, lateReason: "Line down" });
    await expect(c.dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await lateRows(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("wrong role: the requester cannot approve their own time; the office and supervisor cannot decide; a viewer cannot complete", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const occurredAt = NOW.getTime() - H;
    await expect(p.as("viewer").dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").dispatch.complete({ id, occurredAt, lateReason: "Line down" }).catch(() => undefined);
    const [req] = await lateRows(p.companyId);
    await expect(p.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["office", "supervisor", "packer"] as const) {
      await expect(p.as(role).approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.as("admin").approval.decide({ id: req!.id, decision: "approved" });
    await expect(p.as("manager").dispatch.complete({ id, occurredAt, lateReason: "Line down" })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("cross-tenant: another plant cannot complete the dispatch or decide its request", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    const occurredAt = NOW.getTime() - H;
    await p.as("office").dispatch.complete({ id, occurredAt, lateReason: "Line down" }).catch(() => undefined);
    const [req] = await lateRows(p.companyId);
    const other = await plant();
    await expect(other.as("office").dispatch.complete({ id, occurredAt, lateReason: "Line down" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.owner.approval.list({ status: "pending", kind: "dispatch_late_entry" })).items).toEqual([]);
  }, SLOW);

  test("cancelling the dispatch withdraws a waiting late request", async () => {
    setClock(NOW);
    const { p, id } = await heldDispatch();
    await p.as("office").dispatch.complete({ id, occurredAt: NOW.getTime() - H, lateReason: "Line down" }).catch(() => undefined);
    await p.owner.dispatch.cancel({ id, reason: "Entered twice" });
    expect((await lateRows(p.companyId)).map((r) => [r.status, r.note])).toEqual([["rejected", "Withdrawn: the dispatch was cancelled."]]);
  }, SLOW);
});
