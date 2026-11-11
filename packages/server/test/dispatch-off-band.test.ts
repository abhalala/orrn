/**
 * Q36 decided (owner 2026-10-24, Q40): a bundle more than 0.1 kg/12ft off its ORDER LINE goes onto the
 * dispatch in a needs-approval state. One `dispatch_off_band` request per row (subject = the item);
 * owner, admin or manager decide it, never the requester; `dispatch.complete` refuses while a row is
 * waiting or rejected for the line it is on now. A relink asks again, a removal withdraws.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { approval, salesOrderLine } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";
import { SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant, itemsOf } = opHelpers(() => env);

async function offBandRows(companyId: string) {
  return env.db
    .select()
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, "dispatch_off_band")));
}

/** A plant with one confirmed order line at 12.000 kg/12ft, a dispatch from it, one bundle on the line and one 0.5 heavy. */
async function setup(): Promise<{ p: OpPlant; id: string; ok: string; heavy: string; lineId: string; sectionId: string }> {
  const p = await opPlant();
  const s = await p.section();
  await p.copy(s, { milli: 12_000 });
  const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
  const [ok, heavy] = [...(await p.pack(s, [{ kg: 120 }], o.lineIds[0])), ...(await p.pack(s, [{ kg: 125 }], o.lineIds[0]))] as [string, string];
  const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", salesOrderId: o.id });
  return { p, id, ok, heavy, lineId: o.lineIds[0]!, sectionId: s };
}

describe("dispatch_off_band: the off-band row needs a second person", () => {
  test("the scan adds it in a needs-approval state; complete refuses until a manager approves; then it completes", async () => {
    const { p, id, ok, heavy, lineId } = await setup();
    const packer = p.as("packer");
    const rep = await packer.dispatch.scan({ id, serials: [ok, heavy] });
    expect(rep.added.sort()).toEqual([ok, heavy].sort());
    expect(rep.warnings!.map((w) => w.serial)).toEqual([heavy]);

    const [req, ...more] = await offBandRows(p.companyId);
    expect(more).toEqual([]);
    const heavyItem = (await itemsOf(id)).find((i) => i.serial === heavy)!;
    expect(req).toMatchObject({ status: "pending", subjectId: heavyItem.id, requestedBy: p.users.packer.id });
    expect(req!.meta).toMatchObject({ dispatchId: id, serial: heavy, lineId, lineNo: 1, lineMilli: 12_000 });
    // No money in the meta (approval.list is readable by every role).
    expect(Object.keys(req!.meta).sort()).toEqual(
      ["bundleId", "bundleMilli", "diffMilli", "dispatchCode", "dispatchId", "itemId", "lineId", "lineMilli", "lineNo", "orderNumber", "serial"].sort(),
    );

    const got = await p.owner.dispatch.getDispatch({ id });
    expect(got.offBand).toMatchObject({ pending: 1, rejected: 0, unasked: 0, blocked: true });
    expect(got.items.find((i) => i.serial === heavy)).toMatchObject({ offBandStatus: "pending", offBandApprovalId: req!.id });
    expect(got.items.find((i) => i.serial === ok)).toMatchObject({ offBandStatus: null });

    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`${heavy} is more than 0.1 kg/12ft off the order line`),
    });
    // Nothing left: no PL number, still held.
    expect((await p.owner.dispatch.getDispatch({ id })).dispatch).toMatchObject({ status: "reserved", plNumber: null });

    // The review sheet's live facts: the row as it is now.
    expect(await p.as("manager").approval.facts({ id: req!.id })).toMatchObject({
      kind: "dispatch_off_band",
      row: { serial: heavy, dispatchStatus: "reserved", sameLine: true, line: { lineNo: 1, kgPer12ftMilli: 12_000 } },
    });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    expect((await p.owner.dispatch.getDispatch({ id })).offBand).toMatchObject({ pending: 0, approved: 1, blocked: false });
    await expect(p.owner.dispatch.complete({ id })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("review 2: an approval covers only the weights it was given for; a line edited after it asks again", async () => {
    const { p, id, heavy, lineId } = await setup();
    await p.as("packer").dispatch.scan({ id, serials: [heavy] });
    const [req] = await offBandRows(p.companyId);
    const bundleMilli = (req!.meta as { bundleMilli: number }).bundleMilli;
    expect(req!.meta).toMatchObject({ lineMilli: 12_000, diffMilli: bundleMilli - 12_000 });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    expect((await p.owner.dispatch.getDispatch({ id })).offBand).toMatchObject({ approved: 1, blocked: false });
    // The office edits the line's kg/12ft (as orders.update or repriceWeight would): about 0.300 off now, not the 0.500 approved.
    await env.db.update(salesOrderLine).set({ kgPer12ftMilli: 12_200 }).where(eq(salesOrderLine.id, lineId));
    expect((await p.owner.dispatch.getDispatch({ id })).offBand).toMatchObject({ approved: 0, unasked: 1 });
    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const rows = await offBandRows(p.companyId);
    const fresh = rows.find((r) => r.status === "pending");
    expect(fresh?.meta).toMatchObject({ bundleMilli, lineMilli: 12_200, diffMilli: bundleMilli - 12_200 });
    await p.as("admin").approval.decide({ id: fresh!.id, decision: "approved" });
    await expect(p.owner.dispatch.complete({ id })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("wrong role and the requester: a packer, office or supervisor cannot decide; the manager who scanned cannot approve their own", async () => {
    const { p, id, heavy } = await setup();
    await p.as("manager").dispatch.scan({ id, serials: [heavy] });
    const [req] = await offBandRows(p.companyId);
    for (const role of ["packer", "office", "supervisor", "viewer"] as const) {
      await expect(p.as(role).approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(p.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await offBandRows(p.companyId))[0]!.status).toBe("pending");
    // Another approver may.
    await p.as("admin").approval.decide({ id: req!.id, decision: "approved" });
    expect((await offBandRows(p.companyId))[0]!.status).toBe("approved");
  }, SLOW);

  test("review 3: two people on every off-band row: the scanner cannot approve their own; a manager who did not scan approves, then completes", async () => {
    const { p, id, heavy } = await setup();
    await p.as("packer").dispatch.scan({ id, serials: [heavy] });
    const [req] = await offBandRows(p.companyId);
    expect(req!.requestedBy).toBe(p.users.packer.id);
    await expect(p.as("packer").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await p.as("manager").dispatch.reserve({ id });
    await expect(p.as("manager").dispatch.complete({ id })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("rejected: complete refuses and says to take it off; removing the bundle lets the rest complete", async () => {
    const { p, id, ok, heavy } = await setup();
    await p.owner.dispatch.scan({ id, serials: [ok, heavy] });
    const [req] = await offBandRows(p.companyId);
    await p.as("manager").approval.decide({ id: req!.id, decision: "rejected", note: "Too heavy for this party" });
    expect((await p.owner.dispatch.getDispatch({ id })).offBand).toMatchObject({ rejected: 1, blocked: true });
    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`${heavy} was rejected for the order line. Take it off the dispatch`),
    });
    const heavyItem = (await itemsOf(id)).find((i) => i.serial === heavy)!;
    await p.owner.dispatch.removeBundle({ id, bundleId: heavyItem.bundleId });
    await expect(p.owner.dispatch.complete({ id })).resolves.toMatchObject({ success: true });
  }, SLOW);

  test("replayed: the same scan resent with its request key opens no second request", async () => {
    const { p, id, heavy } = await setup();
    const key = crypto.randomUUID();
    const first = await p.owner.dispatch.scan({ id, serials: [heavy], clientRequestId: key });
    const again = await p.owner.dispatch.scan({ id, serials: [heavy], clientRequestId: key });
    expect(again.replayed).toBe(true);
    expect(again.warnings).toEqual(first.warnings);
    expect(await offBandRows(p.companyId)).toHaveLength(1);
    // A plain rescan of the bundle already on it: no second request either.
    await p.owner.dispatch.scan({ id, serials: [heavy] });
    expect(await offBandRows(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("cross-tenant: another plant's manager cannot see or decide the request", async () => {
    const { p, id, heavy } = await setup();
    await p.owner.dispatch.scan({ id, serials: [heavy] });
    const [req] = await offBandRows(p.companyId);
    const other = await opPlant();
    await expect(other.as("manager").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const theirs = await other.owner.approval.list({ status: "pending", kind: "dispatch_off_band" });
    expect(theirs.items).toEqual([]);
    expect((await offBandRows(p.companyId))[0]!.status).toBe("pending");
  }, SLOW);

  test("removing the row withdraws its waiting request; unlinking withdraws it; linking back asks again", async () => {
    const { p, id, heavy, lineId } = await setup();
    await p.owner.dispatch.scan({ id, serials: [heavy] });
    const item = (await itemsOf(id)).find((i) => i.serial === heavy)!;

    // The office takes it off the line: the request is moot.
    await p.as("office").dispatch.linkItem({ itemId: item.id, salesOrderLineId: null });
    let rows = await offBandRows(p.companyId);
    expect(rows.map((r) => [r.status, r.note])).toEqual([["rejected", "Withdrawn: the bundle is on another order line now."]]);
    expect((await p.owner.dispatch.getDispatch({ id })).offBand.blocked).toBe(false);

    // Linked back to the line it is off of: a new request, needs approval again.
    await p.as("office").dispatch.linkItem({ itemId: item.id, salesOrderLineId: lineId });
    rows = await offBandRows(p.companyId);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);

    // Off the dispatch: withdrawn, and the facts say it came off.
    const asked = rows.find((r) => r.status === "pending")!;
    await p.owner.dispatch.removeBundle({ id, bundleId: item.bundleId });
    expect(await p.as("manager").approval.facts({ id: asked.id })).toEqual({ kind: "dispatch_off_band", row: null });
    rows = await offBandRows(p.companyId);
    expect(rows.filter((r) => r.status === "pending")).toEqual([]);
    expect(rows.some((r) => r.note === "Withdrawn: the bundle came off the dispatch.")).toBe(true);
  }, SLOW);

  test("cancelling the dispatch withdraws its waiting requests", async () => {
    const { p, id, heavy } = await setup();
    await p.owner.dispatch.scan({ id, serials: [heavy] });
    await p.owner.dispatch.cancel({ id, reason: "Truck did not come" });
    const rows = await offBandRows(p.companyId);
    expect(rows.map((r) => [r.status, r.note])).toEqual([["rejected", "Withdrawn: the dispatch was cancelled."]]);
  }, SLOW);

  test("a row that became off band with nobody asking (written straight to the line) is asked at complete", async () => {
    const { p, id, ok, heavy, lineId } = await setup();
    // Scan both onto no line, then link the heavy one by a write that skips linkItem (as a relink would).
    await p.owner.dispatch.scan({ id, serials: [ok, heavy] });
    await env.db.update(approval).set({ status: "rejected", note: "test reset" }).where(eq(approval.companyId, p.companyId));
    await env.db.delete(approval).where(eq(approval.companyId, p.companyId));
    expect((await p.owner.dispatch.getDispatch({ id })).offBand).toMatchObject({ unasked: 1, blocked: false });
    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const rows = await offBandRows(p.companyId);
    expect(rows.map((r) => [r.status, (r.meta as { serial: string; lineId: string }).serial, (r.meta as { lineId: string }).lineId])).toEqual([
      ["pending", heavy, lineId],
    ]);
    // Asked once: a second Complete does not open another.
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await offBandRows(p.companyId)).toHaveLength(1);
  }, SLOW);
});
