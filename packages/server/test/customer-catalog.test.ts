/**
 * T23 server touch points for the Customers screens:
 * - `customer.list` search matches name, phone and GSTIN (the list and the guide promise all three).
 * - `analytics.customerKg` gives the kg column of the customers list for the page on screen:
 *   completed dispatch kg per customer over an inclusive company-day range (ruling RP10),
 *   gated by analytics.view, tenant-scoped, one statement under D1's 100 parameters.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, bundleGroup, customer, dispatch, dispatchItem } from "@orrn/db/schema";
import type { DispatchStatus } from "@orrn/db/schema/dispatch";

import { createTestEnv, D1_MAX_PARAMS, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const ist = (wall: string) => new Date(`${wall}+05:30`);
const id = () => crypto.randomUUID();
const kg = (n: number) => n * 1000;

let seq = 0;
async function seedDispatch(
  companyId: string,
  customerId: string,
  dieId: string,
  at: Date,
  weights: number[],
  status: DispatchStatus = "completed",
) {
  seq += 1;
  const groupId = id();
  const dispatchId = id();
  await env.db.insert(bundleGroup).values({ id: groupId, companyId, code: `T23G${seq}-${groupId.slice(0, 6)}`, dieId, unit: "pcs" });
  const bundleIds: string[] = [];
  for (const [i, weightG] of weights.entries()) {
    const bundleId = id();
    await env.db.insert(bundle).values({
      id: bundleId,
      companyId,
      groupId,
      dieId,
      serial: `T23S${seq}-${i}-${groupId.slice(0, 6)}`,
      quantity: 10,
      weightG,
      lengthMm: 3_658,
      status: status === "completed" ? "dispatched" : "reserved",
      createdAt: new Date(at.getTime() - 86_400_000),
    });
    bundleIds.push(bundleId);
  }
  await env.db.insert(dispatch).values({
    id: dispatchId,
    companyId,
    code: `T23-DN-${seq}`,
    customerId,
    status,
    completedAt: status === "completed" ? at : null,
    createdAt: at,
  });
  for (const bundleId of bundleIds) {
    await env.db.insert(dispatchItem).values({ id: id(), companyId, dispatchId, bundleId });
  }
  return dispatchId;
}

async function plant() {
  const { companyId } = await env.seedCompany();
  const owner = env.caller({ role: "owner", companyId });
  const dieId = await env.seedDie(companyId, { series: "PATTI", sectionCode: `14${seq}${Date.now() % 1000}` });
  return { companyId, owner, dieId };
}

async function namedCustomer(companyId: string, values: { name: string; phone?: string; taxId?: string }) {
  const customerId = id();
  await env.db.insert(customer).values({ id: customerId, companyId, ...values });
  return customerId;
}

describe("customer.list search", () => {
  test("matches name, phone and GSTIN, only inside the caller's company", async () => {
    const a = await plant();
    const b = await plant();
    const kd = await namedCustomer(a.companyId, { name: "KD Extrusion", phone: "+91 98250 11234", taxId: "24AABCK4471M1Z6" });
    const royal = await namedCustomer(a.companyId, { name: "Royal Aluminium", phone: "+91 98240 55781", taxId: "24AAGFR8812K1Z2" });
    await namedCustomer(b.companyId, { name: "Other plant buyer", phone: "+91 98250 11234", taxId: "24AABCK4471M1Z6" });

    const ids = async (search: string) =>
      (await a.owner.customer.list({ search })).items.map((c) => c.id).sort();

    expect(await ids("Royal")).toEqual([royal]);
    expect(await ids("98250 11234")).toEqual([kd]);
    expect(await ids("24AAGFR")).toEqual([royal]);
    // GSTINs are typed in any case on the floor.
    expect(await ids("24aagfr8812k1z2")).toEqual([royal]);
    expect(await ids("24AA")).toEqual([kd, royal].sort());
    const res = await a.owner.customer.list({ search: "24AA" });
    expect(res.total).toBe(2);
  });

  test("a search term with LIKE wildcards is taken literally", async () => {
    const a = await plant();
    await namedCustomer(a.companyId, { name: "Shivam Bhavnagar" });
    expect((await a.owner.customer.list({ search: "%" })).items).toEqual([]);
    expect((await a.owner.customer.list({ search: "_" })).items).toEqual([]);
  });
});

describe("analytics.customerKg", () => {
  test("completed kg and dispatch count per requested customer, inclusive company days", async () => {
    const p = await plant();
    const kd = await namedCustomer(p.companyId, { name: "KD Extrusion" });
    const royal = await namedCustomer(p.companyId, { name: "Royal Aluminium" });
    const quiet = await namedCustomer(p.companyId, { name: "Tejura & Sons" });
    setClock(ist("2026-10-03T12:00:00"));

    // In range: 1 Sep 00:00 IST through 30 Sep 23:59 IST.
    await seedDispatch(p.companyId, kd, p.dieId, ist("2026-09-01T00:00:00"), [kg(100), kg(50)]);
    await seedDispatch(p.companyId, kd, p.dieId, ist("2026-09-30T23:59:00"), [kg(25)]);
    await seedDispatch(p.companyId, royal, p.dieId, ist("2026-09-15T10:00:00"), [kg(40)]);
    // Outside the range on either side (IST, not UTC, decides the day).
    await seedDispatch(p.companyId, kd, p.dieId, ist("2026-08-31T23:59:00"), [kg(999)]);
    await seedDispatch(p.companyId, royal, p.dieId, ist("2026-10-01T00:00:00"), [kg(999)]);
    // Not completed: never counted.
    await seedDispatch(p.companyId, royal, p.dieId, ist("2026-09-20T10:00:00"), [kg(999)], "reserved");

    const res = await p.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [kd, royal, quiet] });
    expect(res).toEqual({
      period: { from: "2026-09-01", to: "2026-09-30" },
      rows: [
        { customerId: kd, kgG: kg(175), dispatches: 2 },
        { customerId: royal, kgG: kg(40), dispatches: 1 },
        { customerId: quiet, kgG: 0, dispatches: 0 },
      ],
    });

    // from == to is one whole day.
    const oneDay = await p.owner.analytics.customerKg({ from: "2026-09-30", to: "2026-09-30", customerIds: [kd] });
    expect(oneDay.rows).toEqual([{ customerId: kd, kgG: kg(25), dispatches: 1 }]);
  });

  test("another plant's customers and dispatches read as zero, never as their figures", async () => {
    const a = await plant();
    const b = await plant();
    const mine = await namedCustomer(a.companyId, { name: "Mine" });
    const theirs = await namedCustomer(b.companyId, { name: "Theirs" });
    await seedDispatch(b.companyId, theirs, b.dieId, ist("2026-09-10T10:00:00"), [kg(9_000)]);
    // A dispatch row filed under A's customer id but belonging to plant B.
    await seedDispatch(b.companyId, mine, b.dieId, ist("2026-09-11T10:00:00"), [kg(7_000)]);

    const res = await a.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [mine, theirs] });
    expect(res.rows).toEqual([
      { customerId: mine, kgG: 0, dispatches: 0 },
      { customerId: theirs, kgG: 0, dispatches: 0 },
    ]);
  });

  test("a full page of 50 customers stays under D1's parameter limit", async () => {
    const p = await plant();
    const ids = await Promise.all(Array.from({ length: 50 }, (_, i) => namedCustomer(p.companyId, { name: `Buyer ${i}` })));
    await seedDispatch(p.companyId, ids[49]!, p.dieId, ist("2026-09-10T10:00:00"), [kg(12)]);
    env.resetPeakParams();
    const res = await p.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: ids });
    expect(res.rows).toHaveLength(50);
    expect(res.rows[49]).toEqual({ customerId: ids[49]!, kgG: kg(12), dispatches: 1 });
    expect(env.peakParams()).toBeLessThanOrEqual(D1_MAX_PARAMS);
  });

  test("repeated ids come back once, in first-seen order", async () => {
    const p = await plant();
    const a = await namedCustomer(p.companyId, { name: "A" });
    const b = await namedCustomer(p.companyId, { name: "B" });
    const res = await p.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [b, a, b] });
    expect(res.rows.map((r) => r.customerId)).toEqual([b, a]);
  });

  test("input bounds: at most 50 ids, a valid inclusive range", async () => {
    const p = await plant();
    const many = Array.from({ length: 51 }, () => id());
    await expect(p.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: many })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.owner.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.owner.analytics.customerKg({ from: "2026-10-01", to: "2026-09-30", customerIds: [id()] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("analytics.view roles read it; floor roles and viewer get FORBIDDEN", async () => {
    const p = await plant();
    const c = await namedCustomer(p.companyId, { name: "Gate" });
    const allowed: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant"];
    const denied: CompanyRole[] = ["supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
    for (const role of allowed) {
      const api = env.caller({ role, companyId: p.companyId });
      const res = await api.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [c] });
      expect({ role, rows: res.rows.length }).toEqual({ role, rows: 1 });
    }
    for (const role of denied) {
      const api = env.caller({ role, companyId: p.companyId });
      await expect(api.analytics.customerKg({ from: "2026-09-01", to: "2026-09-30", customerIds: [c] })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});
