/**
 * BACKLOG 70: the packing list and the e-way bill name the truck, so `dispatch.complete` refuses a
 * dispatch with no vehicle number (PRECONDITION_FAILED, nothing held or posted), on the read and in the
 * completing UPDATE (a header cleared meanwhile). `dispatch.create` may take the vehicle at the start;
 * a dispatch joining a truck takes the truck's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dispatch } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { plant, dispatchRow, plRow, ledgerOf } = salesHelpers(() => env);
const NO_VEHICLE = "No vehicle number: add it before this dispatch can complete.";

/** A held dispatch of one bundle whose vehicle number was cleared. */
async function heldWithoutVehicle(): Promise<{ p: SalesPlant; id: string }> {
  const p = await plant();
  const id = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
  await p.owner.dispatch.update({ id, vehicleNo: null });
  return { p, id };
}

describe("dispatch.complete needs a vehicle number (BACKLOG 70)", () => {
  test("refused with no vehicle, or a blank one: still held, no packing list, nothing posted", async () => {
    const { p, id } = await heldWithoutVehicle();
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: NO_VEHICLE });
    await p.owner.dispatch.update({ id, vehicleNo: "  " });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: NO_VEHICLE });
    expect(await dispatchRow(id)).toMatchObject({ status: "reserved", vehicleNo: null, plNumber: null });
    expect(await plRow(id)).toBeNull();
    expect(await ledgerOf(p.companyId, id)).toEqual([]);
  }, SLOW);

  test("allowed once the vehicle is on it; the packing list names it", async () => {
    const { p, id } = await heldWithoutVehicle();
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await p.as("office").dispatch.update({ id, vehicleNo: "gj 05-cd 4321" });
    await expect(p.as("office").dispatch.complete({ id })).resolves.toMatchObject({ success: true });
    expect(await dispatchRow(id)).toMatchObject({ status: "completed", vehicleNo: "GJ05CD4321" });
    expect(((await plRow(id))!.snapshot as { header: { vehicleNo: string | null } }).header.vehicleNo).toBe("GJ05CD4321");
  }, SLOW);

  test("create takes the vehicle at the start (normalised); a dispatch joining a truck takes the truck's", async () => {
    const p = await plant();
    await p.owner.company.updateSettings({ packingList: { scope: "per_truck" } });
    const first = await p.owner.dispatch.create({ customerId: p.customerId, vehicleNo: "gj 05 ab-1111" });
    expect(await dispatchRow(first.id)).toMatchObject({ vehicleNo: "GJ05AB1111" });
    const second = await p.owner.dispatch.create({ customerId: p.otherCustomer, truckOf: first.id, vehicleNo: "GJ05ZZ9999" });
    expect(await dispatchRow(second.id)).toMatchObject({ vehicleNo: "GJ05AB1111" });
    await expect(p.owner.dispatch.create({ customerId: p.customerId, vehicleNo: "GJ@5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("a vehicle cleared while completing: the write refuses it the same way and nothing lands", async () => {
    const p = await plant();
    const id = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    env.beforeNextBatch(() => env.db.update(dispatch).set({ vehicleNo: null }).where(eq(dispatch.id, id)));
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: NO_VEHICLE });
    expect(await dispatchRow(id)).toMatchObject({ status: "reserved", plNumber: null });
    expect(await ledgerOf(p.companyId, id)).toEqual([]);
  }, SLOW);

  test("replayed: pressing Complete again with no vehicle writes nothing; after it completes it is refused", async () => {
    const { p, id } = await heldWithoutVehicle();
    const audits = async () => (await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, id)))).length;
    const before = await audits();
    for (let i = 0; i < 3; i++) await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await audits()).toBe(before);
    await p.owner.dispatch.update({ id, vehicleNo: "GJ05AB1234" });
    await p.owner.dispatch.complete({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("wrong role: a viewer or packer cannot complete, with or without a vehicle", async () => {
    const { p, id } = await heldWithoutVehicle();
    for (const role of ["viewer", "packer"] as const) {
      await expect(p.as(role).dispatch.complete({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.owner.dispatch.update({ id, vehicleNo: "GJ05AB1234" });
    for (const role of ["viewer", "packer"] as const) {
      await expect(p.as(role).dispatch.complete({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await dispatchRow(id)).status).toBe("reserved");
  }, SLOW);

  test("cross-tenant: another plant cannot set the vehicle or complete the dispatch", async () => {
    const { id } = await heldWithoutVehicle();
    const other = await plant();
    await expect(other.owner.dispatch.update({ id, vehicleNo: "GJ05AB1234" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.owner.dispatch.complete({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await dispatchRow(id)).toMatchObject({ status: "reserved", vehicleNo: null });
  }, SLOW);
});
