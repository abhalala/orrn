/**
 * W1-PK-S dispatch: the §E6 scan order (FP-PK-11/15), owned-die block on add (FP-PK-10), transporter
 * master and vehicle capacity (FP-PK-12), and the dispatch ledger rows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, customer, die, dispatch } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

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

const { plant, ledgerOf, dispatchRow, itemsOf } = salesHelpers(() => env);

async function nameOf(id: string) {
  const [c] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, id));
  return c!.name;
}

async function setPolicy(p: SalesPlant, customerId: string, policy: "lifelong") {
  await p.owner.customer.update({ id: customerId, name: await nameOf(customerId), bundleNumberPolicy: policy });
}

describe("dispatch.scan: one outcome per code in the §E6 order", () => {
  test("not found, ambiguous, void, dispatched, held, unassigned, wrong customer, owned die, added, already on", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "lifelong");
    await setPolicy(p, p.otherCustomer, "lifelong");
    const mine = await p.order([{ dieId: p.dieA, kg: 5000 }, { dieId: p.dieB, kg: 5000 }]);
    const theirs = await p.order([{ dieId: p.dieA, kg: 5000 }], { customerId: p.otherCustomer });

    // Party no "1" exists for both customers: ambiguous when scanned by party number.
    const [m1, voidS, dispS, heldS, okS] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }, { kg: 10 }, { kg: 10 }, { kg: 10 }], mine.lineIds[0]);
    const [wrongS] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const [ownedS] = await p.pack(p.dieB, [{ kg: 10 }], mine.lineIds[1]);
    const [plantS] = await p.pack(p.dieA, [{ kg: 10 }]);
    expect(m1).toBeDefined();

    const bundleId = async (serial: string) => (await env.db.query.bundle.findFirst({ where: (b, { eq: e }) => e(b.serial, serial) }))!.id;
    await p.owner.bundle.transitionStatus({ id: await bundleId(voidS!), toStatus: "void", reason: "damaged" });
    await p.owner.dispatch.complete({ id: await p.held([dispS!]) });
    const holder = await p.held([heldS!]);
    const holderCode = (await dispatchRow(holder)).code;
    // The die becomes the other customer's after the bundle was packed.
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieB));

    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.scan({
      id,
      serials: ["NOPE-404", "1", voidS!, dispS!, heldS!, plantS!, wrongS!, ownedS!, okS!],
    });
    expect(report.results.map((r) => r.outcome)).toEqual([
      "not_found",
      "ambiguous",
      "void",
      "dispatched",
      "held",
      "unassigned",
      "wrong_customer",
      "owned_die",
      "added",
    ]);
    expect(report.results[1]!.candidates).toHaveLength(2);
    expect(report.results[4]!.message).toBe(`Bundle is held by ${holderCode}`);
    expect(report.results[6]!.message).toBe(`Packed for ${await nameOf(p.otherCustomer)}`);
    expect(report.results[7]!.message).toBe(`This die belongs to ${await nameOf(p.otherCustomer)}`);
    expect(report.added).toEqual([okS!]);
    expect((await itemsOf(id)).map((i) => i.serial)).toEqual([okS!]);

    const again = await p.owner.dispatch.scan({ id, serials: [okS!] });
    expect(again.results.map((r) => r.outcome)).toEqual(["already_on_dispatch"]);
    expect(again.added).toEqual([]);
  }, SLOW);

  test("addBundlesBySerial keeps the office path: unassigned and other-customer bundles go on; owned die does not", async () => {
    setClock(NOON);
    const p = await plant();
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const [plantS] = await p.pack(p.dieA, [{ kg: 10 }]);
    const [wrongS] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const [ownedS] = await p.pack(p.dieB, [{ kg: 10 }]);
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieB));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ id, serials: [plantS!, wrongS!, ownedS!] });
    expect(Object.keys(report).sort()).toEqual(["added", "alreadyInDispatch", "linked", "notFound", "unavailable"]);
    expect(report.added.sort()).toEqual([plantS!, wrongS!].sort());
    expect(report.unavailable).toEqual([
      expect.objectContaining({ serial: ownedS!, reason: `This die belongs to ${await nameOf(p.otherCustomer)}` }),
    ]);
  }, SLOW);

  test("dispatch.addBundle refuses an owned die naming the owner", async () => {
    setClock(NOON);
    const p = await plant();
    const [s] = await p.pack(p.dieB, [{ kg: 10 }]);
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieB));
    const b = (await env.db.query.bundle.findFirst({ where: (x, { eq: e }) => e(x.serial, s!) }))!;
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.owner.dispatch.addBundle({ id, bundleId: b.id })).rejects.toThrow(`This die belongs to ${await nameOf(p.otherCustomer)}`);
    expect(await itemsOf(id)).toHaveLength(0);
  }, SLOW);

  test("scan needs dispatch.scan: a viewer is refused and nothing lands", async () => {
    setClock(NOON);
    const p = await plant();
    const [s] = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.as("viewer").dispatch.scan({ id, serials: [s!] })).rejects.toThrow();
    expect(await itemsOf(id)).toHaveLength(0);
  }, SLOW);
});

describe("transporter master and vehicle capacity (FP-PK-12)", () => {
  test("transporter list/create/update; duplicate names refused; masters.publish only", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await p.owner.transporter.create({ name: "Shree Roadlines", phone: "+91 98250 11111" });
    await expect(p.owner.transporter.create({ name: "shree roadlines" })).rejects.toThrow("already exists");
    await expect(p.as("viewer").transporter.create({ name: "Other" })).rejects.toThrow();
    expect((await p.as("viewer").transporter.list()).items.map((t) => t.name)).toEqual(["Shree Roadlines"]);
    await p.owner.transporter.update({ id, name: "Shree Road Lines" });
    await p.owner.transporter.update({ id, active: false });
    expect((await p.owner.transporter.list()).items).toHaveLength(0);
    expect((await p.owner.transporter.list({ includeRetired: true })).items[0]!.name).toBe("Shree Road Lines");
    await expect(p.owner.dispatch.create({ customerId: p.customerId, transporterId: id })).rejects.toThrow("retired");
  }, SLOW);

  test("dispatch snapshots the transporter name; a rename later does not change it", async () => {
    setClock(NOON);
    const p = await plant();
    const t = await p.owner.transporter.create({ name: "VRL Logistics" });
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId, transporterId: t.id, vehicleCapacityG: kg(9000) });
    await p.owner.transporter.update({ id: t.id, name: "VRL Logistics Ltd" });
    expect(await dispatchRow(id)).toMatchObject({ transporterId: t.id, transporterName: "VRL Logistics", vehicleCapacityG: kg(9000) });
    await p.owner.dispatch.update({ id, transporterId: null, vehicleCapacityG: null });
    expect(await dispatchRow(id)).toMatchObject({ transporterId: null, transporterName: null, vehicleCapacityG: null });
  }, SLOW);

  test("capacity near and over are reported; completing over capacity needs a reason, which is audited", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }, { kg: 6 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId, vehicleCapacityG: kg(21) });
    const first = await p.owner.dispatch.scan({ id, serials: serials.slice(0, 2) });
    expect(first.capacity).toMatchObject({ state: "near", loadedG: kg(20), capacityG: kg(21) });
    const second = await p.owner.dispatch.scan({ id, serials: serials.slice(2) });
    expect(second.capacity).toMatchObject({ state: "over", overG: kg(5) });
    expect((await p.owner.dispatch.getDispatch({ id })).capacity.state).toBe("over");
    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).rejects.toThrow(/over the vehicle/);
    expect((await dispatchRow(id)).status).toBe("reserved");
    await p.owner.dispatch.complete({ id, capacityOverrideReason: "Second trip cancelled; same truck" });
    expect((await dispatchRow(id)).capacityOverrideReason).toBe("Second trip cancelled; same truck");
    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.capacity_override")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ loadedG: kg(26), capacityG: kg(21), overG: kg(5), reason: "Second trip cancelled; same truck" });
  }, SLOW);

  test("within capacity completes without a reason and stores none", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId, vehicleCapacityG: kg(100) });
    await p.owner.dispatch.scan({ id, serials });
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id, capacityOverrideReason: "not needed" });
    expect((await dispatchRow(id)).capacityOverrideReason).toBeNull();
  }, SLOW);
});

describe("ledger: dispatch posts -kg; pack +kg", () => {
  test("completing posts the bundle kg out of the yard; the projection stays equal", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 12.5 }, { kg: 7.5 }], o.lineIds[0]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    const rows = await ledgerOf(p.companyId, d);
    expect(rows.every((r) => r.voucherType === "dispatch" && r.qtyG < 0 && r.locationId === p.yard)).toBe(true);
    expect(rows.reduce((s, r) => s + r.qtyG, 0)).toBe(-kg(20));
    const [row] = await env.db.select({ id: dispatch.id }).from(dispatch).where(eq(dispatch.id, d));
    expect(row).toBeDefined();
  }, SLOW);
});
