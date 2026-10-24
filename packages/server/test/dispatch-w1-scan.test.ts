/**
 * W1-PK-S dispatch: the §E6 scan order (FP-PK-11/15), owned-die block on add (FP-PK-10), transporter
 * master and vehicle capacity (FP-PK-12), and the dispatch ledger rows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, customer, die, dispatch } from "@orrn/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { t } from "../src/index";
import { ScanRefusalError } from "../src/lib/scanRefusal";

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

async function setPolicy(p: SalesPlant, customerId: string, policy: "lifelong" | "monthly") {
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

    const bundleId = async (serial: string) =>
      (await env.db.query.bundle.findFirst({ where: (b, { and: a, eq: e }) => a(e(b.companyId, p.companyId), e(b.serial, serial)) }))!.id;
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

  test("addBundlesBySerial refuses like the scan (D12): unassigned, wrong customer, owned die, each with a code", async () => {
    setClock(NOON);
    const p = await plant();
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const mine = await p.order([{ dieId: p.dieB, kg: 1000 }]);
    const [plantS] = await p.pack(p.dieA, [{ kg: 10 }]);
    const [wrongS] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const [ownedS] = await p.pack(p.dieB, [{ kg: 10 }], mine.lineIds[0]);
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieB));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    // The floor holds dispatch.addBundle too: the office procedure is no way around the scan gate.
    for (const role of ["owner", "packer", "operator"] as const) {
      const report = await p.as(role).dispatch.addBundlesBySerial({ id, serials: [plantS!, wrongS!, ownedS!] });
      expect(Object.keys(report).sort()).toEqual(["added", "alreadyInDispatch", "linked", "notFound", "unavailable"]);
      expect(report.added).toEqual([]);
      expect(report.unavailable).toEqual([
        { serial: plantS!, code: "unassigned", reason: "Not assigned to a sales order", status: "available", heldBy: null },
        { serial: wrongS!, code: "wrong_customer", reason: `Packed for ${await nameOf(p.otherCustomer)}`, status: "available", heldBy: null },
        { serial: ownedS!, code: "owned_die", reason: `This die belongs to ${await nameOf(p.otherCustomer)}`, status: "available", heldBy: null },
      ]);
    }
    expect(await itemsOf(id)).toHaveLength(0);
  }, SLOW);

  test("office override: allowUnassigned lifts only unassigned, audits each bundle; the floor is FORBIDDEN; scan never honours it", async () => {
    setClock(NOON);
    const p = await plant();
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const [plant1, plant2, plant3] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }, { kg: 10 }]);
    const [wrongS] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });

    await expect(p.as("packer").dispatch.addBundlesBySerial({ id, serials: [plant1!], allowUnassigned: true })).rejects.toThrow(
      "Only the office can add bundles that are not on a sales order",
    );
    await expect(p.as("operator").dispatch.addBundlesBySerial({ id, serials: [plant1!], allowUnassigned: true })).rejects.toThrow(/Only the office/);
    // The scan input has no such flag: it is dropped and the bundle is refused.
    const scanned = await p.as("packer").dispatch.scan({ id, serials: [plant1!], allowUnassigned: true } as { id: string; serials: string[] });
    expect(scanned.results.map((r) => r.outcome)).toEqual(["unassigned"]);
    expect(await itemsOf(id)).toHaveLength(0);

    const report = await p.as("office").dispatch.addBundlesBySerial({ id, serials: [plant1!, plant2!, wrongS!], allowUnassigned: true });
    expect(report.added.sort()).toEqual([plant1!, plant2!].sort());
    expect(report.unavailable).toEqual([expect.objectContaining({ serial: wrongS!, code: "wrong_customer" })]);
    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.add_unassigned")));
    expect(audits.map((a) => (a.meta as { serial: string }).serial).sort()).toEqual([plant1!, plant2!].sort());
    expect(audits.every((a) => a.subjectId === id)).toBe(true);

    // The single add: same rule, same audit.
    const b3 = (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, plant3!)) }))!;
    await expect(p.as("packer").dispatch.addBundle({ id, bundleId: b3.id, allowUnassigned: true })).rejects.toThrow(/Only the office/);
    await p.as("office").dispatch.addBundle({ id, bundleId: b3.id, allowUnassigned: true });
    const after = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.add_unassigned")));
    expect(after).toHaveLength(3);
    expect((await itemsOf(id)).map((i) => i.serial).sort()).toEqual([plant1!, plant2!, plant3!].sort());
  }, SLOW);

  test("dispatch.addBundle refuses in the scan order with the scan sentence and a code on every refusal", async () => {
    setClock(NOON);
    const p = await plant();
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const [plantS] = await p.pack(p.dieA, [{ kg: 10 }]);
    const [wrongS] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const [ownedS] = await p.pack(p.dieB, [{ kg: 10 }]);
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieB));
    const idOf = async (serial: string) =>
      (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, serial)) }))!.id;
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const other = await nameOf(p.otherCustomer);
    const cases = [
      { serial: plantS!, code: "unassigned", reason: "Not assigned to a sales order", trpc: "BAD_REQUEST" as const },
      { serial: wrongS!, code: "wrong_customer", reason: `Packed for ${other}`, trpc: "BAD_REQUEST" as const },
      // Unassigned AND owned die: unassigned comes first in the §E6 order.
      { serial: ownedS!, code: "unassigned", reason: "Not assigned to a sales order", trpc: "BAD_REQUEST" as const },
    ];
    for (const c of cases) {
      const err = await p.owner.dispatch.addBundle({ id, bundleId: await idOf(c.serial) }).then(
        () => null,
        (e: unknown) => e as TRPCError,
      );
      expect(err).toBeInstanceOf(TRPCError);
      expect(err!.code).toBe(c.trpc);
      expect(err!.message).toBe(c.reason);
      expect(err!.cause).toBeInstanceOf(ScanRefusalError);
      expect((err!.cause as ScanRefusalError).refusal).toMatchObject({ serial: c.serial, code: c.code, reason: c.reason });
    }
    // The office lifts unassigned; the owned die still refuses, FORBIDDEN, code owned_die.
    const owned = await p.as("office").dispatch.addBundle({ id, bundleId: await idOf(ownedS!), allowUnassigned: true }).then(
      () => null,
      (e: unknown) => e as TRPCError,
    );
    expect(owned!.code).toBe("FORBIDDEN");
    expect(owned!.message).toBe(`This die belongs to ${other}`);
    expect((owned!.cause as ScanRefusalError).refusal).toMatchObject({ code: "owned_die", customerName: other });
    // The error formatter sends the refusal to clients as data.refusal.
    const shape = (t._config.errorFormatter as (o: unknown) => { data: { refusal: unknown } })({
      error: owned,
      type: "mutation",
      path: "dispatch.addBundle",
      input: undefined,
      ctx: undefined,
      shape: { message: owned!.message, code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path: "dispatch.addBundle" } },
    });
    expect(shape.data.refusal).toMatchObject({ code: "owned_die", reason: `This die belongs to ${other}` });
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

describe("refusal precedence: a bundle with two problems gets the earlier outcome (§E6 order)", () => {
  test("held + other customer → held; unassigned + owned die → unassigned; other customer + owned die → wrong customer", async () => {
    setClock(NOON);
    const p = await plant();
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 1000 }], { customerId: p.otherCustomer });
    const [heldWrong] = await p.pack(p.dieA, [{ kg: 10 }], theirs.lineIds[0]);
    const holder = await p.held([heldWrong!], p.otherCustomer);
    const holderCode = (await dispatchRow(holder)).code;
    const [unassignedOwned] = await p.pack(p.dieB, [{ kg: 10 }]);
    const [wrongOwned] = await p.pack(p.dieB, [{ kg: 10 }], theirs.lineIds[1]);
    // The die becomes a third party's after packing: owned for both customers.
    const third = await env.seedCustomer(p.companyId);
    await env.db.update(die).set({ ownerCustomerId: third }).where(eq(die.id, p.dieB));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.scan({ id, serials: [heldWrong!, unassignedOwned!, wrongOwned!] });
    expect(report.results.map((r) => r.outcome)).toEqual(["held", "unassigned", "wrong_customer"]);
    expect(report.results[0]!.message).toBe(`Bundle is held by ${holderCode}`);
    expect(report.refused.map((r) => r.code)).toEqual(["held", "unassigned", "wrong_customer"]);
    expect(report.refused.every((r) => r.reason.length > 0)).toBe(true);
  }, SLOW);

  test("the second number of a refused bundle repeats the refusal, not 'already on'", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "lifelong");
    const mine = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const [s] = await p.pack(p.dieA, [{ kg: 10 }], mine.lineIds[0]);
    const b = (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, s!)) }))!;
    await p.owner.bundle.transitionStatus({ id: b.id, toStatus: "void", reason: "damaged" });
    expect(b.partyNo).not.toBe(b.serial);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.scan({ id, serials: [b.serial, b.partyNo!] });
    expect(report.results.map((r) => r.outcome)).toEqual(["void", "void"]);
    expect(report.results[1]!.code).toBe(b.partyNo!);
    // An added bundle scanned again by its other number is "already on", once.
    const [s2] = await p.pack(p.dieA, [{ kg: 10 }], mine.lineIds[0]);
    const b2 = (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, s2!)) }))!;
    const twice = await p.owner.dispatch.scan({ id, serials: [b2.partyNo!, b2.serial] });
    expect(twice.results.map((r) => [r.outcome, r.message])).toEqual([
      ["added", "Added"],
      ["already_on_dispatch", "Already on this dispatch"],
    ]);
    expect(twice.added).toEqual([b2.serial]);
  }, SLOW);
});

describe("code resolution: serial AND party number every time (D15)", () => {
  test("a monthly party number equal to another bundle's plant serial is ambiguous on scan, add and resolve", async () => {
    setClock(NOON);
    const p = await plant({ settings: { bundleNumbering: "plant" } });
    await setPolicy(p, p.customerId, "monthly");
    const mine = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const [stockS] = await p.pack(p.dieA, [{ kg: 10 }]);
    const [mineS] = await p.pack(p.dieA, [{ kg: 10 }], mine.lineIds[0]);
    const mineRow = (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, mineS!)) }))!;
    // The collision: kd-style monthly party no 26J1 is also the plant serial of the stock bundle.
    expect(mineRow.partyNo).toBe(stockS!);
    expect(mineRow.serial).not.toBe(stockS!);

    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const scanned = await p.owner.dispatch.scan({ id, serials: [stockS!] });
    expect(scanned.results.map((r) => r.outcome)).toEqual(["ambiguous"]);
    expect(scanned.results[0]!.candidates).toEqual([stockS!, mineS!].sort());
    expect(scanned.refused).toEqual([expect.objectContaining({ code: "ambiguous", serial: stockS! })]);

    const office = await p.owner.dispatch.addBundlesBySerial({ id, serials: [stockS!], allowUnassigned: true });
    expect(office.added).toEqual([]);
    expect(office.notFound).toEqual([stockS!]);

    const resolved = await p.owner.resolve.byCode({ code: stockS! });
    expect(resolved.kind).toBe("ambiguous");
    expect(resolved.kind === "ambiguous" && resolved.candidates.map((c) => c.number).sort()).toEqual([stockS!, mineS!].sort());
    expect(await itemsOf(id)).toHaveLength(0);

    // The serial nobody's party number shadows resolves to its one bundle and goes on.
    const ok = await p.owner.dispatch.scan({ id, serials: [mineS!] });
    expect(ok.results.map((r) => r.outcome)).toEqual(["added"]);
    expect((await p.owner.resolve.byCode({ code: mineS! })).kind).toBe("bundle");
  }, SLOW);

  test("serial and party number of the same bundle are one bundle, not ambiguous", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "lifelong");
    const mine = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const [s] = await p.pack(p.dieA, [{ kg: 10 }], mine.lineIds[0]);
    const b = (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, s!)) }))!;
    // A bundle whose party number equals its own serial (no policy) also resolves to itself.
    await env.db.update(bundle).set({ partyNo: b.serial }).where(eq(bundle.id, b.id));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.scan({ id, serials: [b.serial] });
    expect(report.results.map((r) => r.outcome)).toEqual(["added"]);
    expect(await p.owner.resolve.byCode({ code: b.serial })).toMatchObject({ kind: "bundle", bundleId: b.id });
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

  test("a capacity lowered while completing is caught at write time; it can't change after completion (m-2)", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId, vehicleCapacityG: kg(100) });
    await p.owner.dispatch.scan({ id, serials });
    await p.owner.dispatch.reserve({ id });
    env.beforeNextBatch(() => p.as("office").dispatch.update({ id, vehicleCapacityG: kg(15) }));
    await expect(p.owner.dispatch.complete({ id })).rejects.toThrow(/over the vehicle/);
    expect(await dispatchRow(id)).toMatchObject({ status: "reserved", vehicleCapacityG: kg(15), capacityOverrideReason: null });
    await p.owner.dispatch.complete({ id, capacityOverrideReason: "Second truck broke down" });
    await expect(p.owner.dispatch.update({ id, vehicleCapacityG: kg(30) })).rejects.toThrow("The vehicle capacity can't change after the dispatch is completed");
    expect(await dispatchRow(id)).toMatchObject({ vehicleCapacityG: kg(15), capacityOverrideReason: "Second truck broke down" });
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
