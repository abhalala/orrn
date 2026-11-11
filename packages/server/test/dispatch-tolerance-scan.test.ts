/**
 * Tolerance at scan (pl-flow 61): an add that takes an order line past ordered + tolerance reports it
 * (`overTolerance`, the scan's amber "Over +5% on line n") and opens the dispatch_overdraw request then,
 * not only at Complete. Complete with the same figures leaves that request as it is, and its
 * `overdrawNote` fills the request's note only while it has none.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";
import { kg, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);

async function overdraws(companyId: string) {
  return env.db
    .select()
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, "dispatch_overdraw")));
}

/** 1,000 kg ordered (5 % = 1,050 kg limit), nine 120 kg bundles on the line's own weight (1,080 kg). */
async function setup(): Promise<{ p: OpPlant; id: string; serials: string[]; lineId: string; number: string }> {
  const p = await opPlant();
  const s = await p.section();
  await p.copy(s, { milli: 12_000 });
  const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
  const serials = await p.pack(s, Array.from({ length: 9 }, () => ({ kg: 120 })), o.lineIds[0]);
  const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", salesOrderId: o.id });
  return { p, id, serials, lineId: o.lineIds[0]!, number: o.number };
}

describe("tolerance at scan (pl-flow 61)", () => {
  test("within the limit: nothing over, nothing asked", async () => {
    const { p, id, serials } = await setup();
    const rep = await p.as("packer").dispatch.scan({ id, serials: serials.slice(0, 8) }); // 960 kg
    expect(rep.overTolerance).toEqual([]);
    expect(await overdraws(p.companyId)).toEqual([]);
  }, SLOW);

  test("the add that passes the limit reports the line and opens the request; Complete's note fills it; a manager approves; it completes", async () => {
    const { p, id, serials, lineId, number } = await setup();
    await p.as("packer").dispatch.scan({ id, serials: serials.slice(0, 8) });
    const rep = await p.as("packer").dispatch.scan({ id, serials: [serials[8]!] }); // 1,080 kg > 1,050
    expect(rep.added).toEqual([serials[8]!]);
    expect(rep.overTolerance).toEqual([
      { lineId, orderNumber: number, lineNo: 1, toleranceBp: 500, limitG: kg(1_050), totalG: rep.overTolerance![0]!.totalG, overG: rep.overTolerance![0]!.overG },
    ]);
    expect(rep.overTolerance![0]!.overG).toBe(rep.overTolerance![0]!.totalG - kg(1_050));
    expect(rep.overTolerance![0]!.overG).toBeGreaterThan(0);

    const [req, ...more] = await overdraws(p.companyId);
    expect(more).toEqual([]);
    expect(req).toMatchObject({ status: "pending", subjectId: id, requestedBy: p.users.packer.id, requestNote: null });
    expect(req!.meta).toMatchObject({ dispatchId: id, toleranceBp: 500, lines: [{ lineId, limitG: kg(1_050) }] });
    // The dispatch screen reads the same request.
    expect((await p.owner.dispatch.getDispatch({ id })).overdraw?.approval).toMatchObject({ id: req!.id, status: "pending" });

    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id, overdrawNote: "Party asked for the full truck" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // Same figures: the same request, its note filled; no second request.
    const after = await overdraws(p.companyId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: req!.id, status: "pending", requestNote: "Party asked for the full truck", requestedBy: p.users.packer.id });
    // A later note never replaces it.
    await expect(p.owner.dispatch.complete({ id, overdrawNote: "Something else" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await overdraws(p.companyId))[0]!.requestNote).toBe("Party asked for the full truck");

    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await expect(p.owner.dispatch.complete({ id })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("replayed: the same add resent with its key reports the line again and opens or writes nothing more", async () => {
    const { p, id, serials } = await setup();
    const key = crypto.randomUUID();
    const first = await p.owner.dispatch.scan({ id, serials, clientRequestId: key });
    expect(first.overTolerance).toHaveLength(1);
    const audits = async () =>
      (await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, id)))).length;
    const before = await audits();
    const again = await p.owner.dispatch.scan({ id, serials, clientRequestId: key });
    expect(again.replayed).toBe(true);
    expect(again.overTolerance).toEqual(first.overTolerance);
    expect(await overdraws(p.companyId)).toHaveLength(1);
    expect(await audits()).toBe(before);
  }, SLOW);

  test("wrong role and the requester: the packer who scanned, the office and the supervisor cannot decide", async () => {
    const { p, id, serials } = await setup();
    await p.as("manager").dispatch.scan({ id, serials });
    const [req] = await overdraws(p.companyId);
    expect(req!.requestedBy).toBe(p.users.manager.id);
    for (const role of ["packer", "office", "supervisor"] as const) {
      await expect(p.as(role).approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(p.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("admin").approval.decide({ id: req!.id, decision: "approved" });
  }, SLOW);

  test("cross-tenant: another plant cannot see or decide the request", async () => {
    const { p, id, serials } = await setup();
    await p.owner.dispatch.scan({ id, serials });
    const [req] = await overdraws(p.companyId);
    const other = await opPlant();
    await expect(other.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.owner.approval.list({ status: "pending", kind: "dispatch_overdraw" })).items).toEqual([]);
    // And another plant cannot scan onto this dispatch.
    await expect(other.owner.dispatch.scan({ id, serials: [serials[0]!] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  test("new figures after the early ask withdraw it and ask again (a bundle more)", async () => {
    const { p, id, serials } = await setup();
    await p.owner.dispatch.scan({ id, serials: serials.slice(0, 8) });
    await p.owner.dispatch.scan({ id, serials: [serials[8]!] });
    const extra = await p.pack((await p.owner.dispatch.getDispatch({ id })).items[0]!.dieId, [{ kg: 120 }], (await p.owner.dispatch.getDispatch({ id })).items[0]!.salesOrderLineId!);
    const rep = await p.owner.dispatch.scan({ id, serials: extra });
    expect(rep.overTolerance).toHaveLength(1);
    const rows = await overdraws(p.companyId);
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "rejected"]);
    expect(rows.find((r) => r.status === "rejected")!.note).toBe("Withdrawn: asked again with new figures.");
  }, SLOW);
});
