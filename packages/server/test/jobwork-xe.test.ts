/**
 * XE parity lane JOBWORK: one process-step engine for job work out to a vendor (rows 33, 55), an
 * in-house finishing line (55), the draw bench (54) and fabrication (56). The stock ledger balances
 * through every step; a bundle at a vendor is not packable, dispatchable, movable or plant stock
 * (CONTRACTS-W2 item 3). Every procedure: another plant gets "Not found", the permission refusal,
 * the module gate, the happy path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { auditLog, bundle, company, location, stockLedger } from "@orrn/db/schema";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, type SalesPlant } from "./sales-fixture";

setDefaultTimeout(60_000);

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

const { plant, expectLedgerConsistent, ledgerOf } = salesHelpers(() => env);
const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
const can = (role: CompanyRole, action: Action) => canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);
const MODULE_OFF = "That module is not on for this plant";
const DAY = 86_400_000;

async function bundleBy(p: SalesPlant, serial: string) {
  return (await env.db.query.bundle.findFirst({ where: (b, o) => o.and(o.eq(b.companyId, p.companyId), o.eq(b.serial, serial)) }))!;
}
async function vendorOf(p: SalesPlant, code = "ANO") {
  const { id } = await p.as("office").process.vendors.save({ code, name: "Shree Anodisers", gstin: "27AABCS1234A1Z1", address: "MIDC, Pune", state: "Maharashtra", processes: ["anodise", "powder_coat"], ratePaisePerKg: 1_850 });
  return id;
}
async function auditActions(companyId: string) {
  return (await env.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

describe("permissions", () => {
  test("the matrix", () => {
    const holders = (a: Action) => ROLES.filter((r) => can(r, a));
    expect(holders("jobwork.send")).toEqual(["owner", "manager", "office", "supervisor", "storekeeper"]);
    expect(holders("jobwork.receive")).toEqual(["owner", "manager", "office", "supervisor", "storekeeper"]);
    expect(holders("jobwork.masters")).toEqual(["owner", "admin", "manager", "office"]);
    expect(holders("jobwork.cost")).toEqual(["owner", "admin", "manager", "office", "accountant"]);
    expect(holders("process.run")).toEqual(["owner", "manager", "supervisor", "press", "operator"]);
  });
});

describe("job-work vendors", () => {
  test("a vendor gets its own place of kind vendor; codes are unique; the location masters cannot touch it", async () => {
    const p = await plant();
    const vid = await vendorOf(p);
    const { items } = await p.as("viewer").process.vendors.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: "ANO", name: "Shree Anodisers", ratePaisePerKg: null, outBundles: 0 });
    expect((await p.as("accountant").process.vendors.list()).items[0]!.ratePaisePerKg).toBe(1_850);
    const [loc] = await env.db.select().from(location).where(and(eq(location.companyId, p.companyId), eq(location.code, "JW-ANO")));
    expect(loc).toMatchObject({ kind: "vendor", active: true });
    await expect(p.as("office").process.vendors.save({ code: "ano", name: "Again", processes: [] })).rejects.toMatchObject({ code: "CONFLICT", message: "Vendor code ANO is already used" });
    await expect(p.owner.stock.locations.update({ id: loc!.id, name: "Mine" })).rejects.toMatchObject({ message: "This place belongs to a job-work vendor; change it on the vendor" });
    await expect(p.owner.stock.locations.create({ code: "V9", name: "x", kind: "vendor" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Edit keeps the place in step.
    await p.as("manager").process.vendors.save({ id: vid, code: "ANO", name: "Shree Anodisers LLP", processes: ["anodise"] });
    const [loc2] = await env.db.select().from(location).where(eq(location.id, loc!.id));
    expect(loc2!.name).toBe("Shree Anodisers LLP");
    expect(await auditActions(p.companyId)).toContain("process.vendor.save");
  });

  test("tenancy, permission and the module gate", async () => {
    const p = await plant();
    const other = await plant();
    const vid = await vendorOf(p);
    await expect(other.as("office").process.vendors.save({ id: vid, code: "ANO", name: "x", processes: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.owner.process.vendors.list()).items).toEqual([]);
    for (const role of ROLES.filter((r) => !can(r, "jobwork.masters"))) {
      await expect(p.as(role).process.vendors.save({ code: "ZZ", name: "x", processes: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders"] }).where(eq(company.id, p.companyId));
    await expect(p.as("office").process.vendors.save({ code: "ZZ", name: "x", processes: [] })).rejects.toMatchObject({ message: MODULE_OFF });
  });
});

describe("row 33: out-challan, the bundles at the vendor, and the return", () => {
  test("send: bundles move to the vendor, are held, leave plant stock, and refuse dispatch, move and void", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const [s1, s2, s3] = await p.pack(p.dieA, [{ kg: 100, pcs: 20 }, { kg: 80, pcs: 16 }, { kg: 50 }]);
    const b1 = await bundleBy(p, s1!);

    const sent = await p.as("storekeeper").process.steps.send({ vendorId: vid, process: "powder_coat", finishCode: "RAL 9016", expectedReturn: "2026-10-10", valuePaisePerKg: 25_000, vehicleNo: "GJ05AB1234", codes: [s1!, s2!] });
    expect(sent.number).toBe("JW/2026-27/1");

    const vendorLoc = (await env.db.select().from(location).where(and(eq(location.companyId, p.companyId), eq(location.code, "JW-ANO"))))[0]!;
    expect((await bundleBy(p, s1!)).locationId).toBe(vendorLoc.id);
    expect((await bundleBy(p, s1!)).status).toBe("available");
    // The move is on the ledger: − at the yard, + at the vendor.
    const moves = await ledgerOf(p.companyId, sent.id);
    expect(moves.filter((r) => r.voucherType === "move").map((r) => r.qtyG).sort((a, b) => a - b)).toEqual([-kg(100), -kg(80), kg(80), kg(100)]);
    await expectLedgerConsistent(p);

    // Not plant stock: the stock views leave them out, unless the vendor's place is asked by name.
    const lengths = await p.owner.stock.byDieLength({ dieId: p.dieA });
    expect(lengths.items.reduce((a, r) => a + Number(r.bundles), 0)).toBe(1);
    const yards = await p.owner.stock.byYard({ dieId: p.dieA });
    expect(JSON.stringify(yards)).not.toContain(vendorLoc.id);
    const listed = await p.owner.bundle.listBundles({ locationId: vendorLoc.id });
    expect(listed.items.map((b: { serial: string }) => b.serial).sort()).toEqual([s1!, s2!].sort());

    // Not dispatchable, not movable, not voidable, not twice on a step.
    await env.plantStock(p.companyId, [b1.id]);
    const { id: dispatchId } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await expect(p.as("packer").dispatch.scan({ id: dispatchId, serials: [s1!] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
    await expect(p.owner.dispatch.addBundlesBySerial({ id: dispatchId, serials: [s1!] })).rejects.toMatchObject({ message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
    await expect(p.owner.stock.move({ codes: [s1!], toLocationId: p.yard })).rejects.toMatchObject({ message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
    await expect(p.owner.bundle.transitionStatus({ id: b1.id, toStatus: "void", reason: "x" })).rejects.toMatchObject({ message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [s1!] })).rejects.toMatchObject({ message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [s3!, s3!] })).rejects.toMatchObject({ message: `Bundle ${s3} is listed twice` });

    // The challan snapshot: rule 55 fields.
    const ch = await p.as("office").process.steps.challan({ id: sent.id });
    expect(ch).toMatchObject({ number: "JW/2026-27/1", date: "2026-10-03", hsn: "7604", process: "powder_coat", finishCode: "RAL 9016", vehicleNo: "GJ05AB1234", interState: true });
    expect(ch.consigner).toMatchObject({ legalName: "Fourcubes Aluminium Pvt Ltd", gstin: "24AAACF1234A1Z5" });
    expect(ch.consignee).toMatchObject({ name: "Shree Anodisers", gstin: "27AABCS1234A1Z1", state: "Maharashtra" });
    expect(ch.totals).toEqual({ bundles: 2, pcs: 36, weightG: kg(180), valuePaise: 4_500_000 });
    expect(ch.serials.sort()).toEqual([s1!, s2!].sort());
    await expect(p.as("viewer").process.steps.challan({ id: sent.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Pending at the vendor, with age.
    setClock(new Date(NOON.getTime() + 9 * DAY));
    const pend = await p.as("viewer").process.steps.pending();
    expect(pend.items).toHaveLength(1);
    expect(pend.items[0]).toMatchObject({ number: "JW/2026-27/1", outBundles: 2, outG: kg(180), days: 9, bucket: "d8_15", overdue: true, vendorCode: "ANO" });
    expect(pend.buckets.d8_15).toEqual({ steps: 1, outG: kg(180) });
    expect(await auditActions(p.companyId)).toContain("process.send");
  });

  test("receive the same bundles: finish set, weight after, rejects to plant scrap, loss on the ledger, cost per kg; partial then done", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const [s1, s2] = await p.pack(p.dieA, [{ kg: 100, pcs: 20 }, { kg: 80, pcs: 16 }]);
    const b1 = await bundleBy(p, s1!);
    const b2 = await bundleBy(p, s2!);
    const { id } = await p.as("office").process.steps.send({ vendorId: vid, process: "anodise", finishCode: "AA15 silver", ratePaisePerKg: 2_000, codes: [s1!, s2!] });

    // First part: b1 back at 98 kg with 1 reject piece of 4 kg (loss 100 − 98 − 4 = −2: anodise adds film).
    await expect(p.as("viewer").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b1.id, weightG: kg(98), rejectPcs: 1, rejectG: kg(4) }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("supervisor").process.steps.receive({ id, mode: "same", same: [{ bundleId: b1.id, weightG: kg(98) }] })).rejects.toMatchObject({ message: "Pick the yard the bundles come back to" });
    await expect(p.as("supervisor").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b1.id, weightG: kg(120) }] })).rejects.toMatchObject({ message: "More came back than was sent, by over 5 in 100; check the weights" });
    const r1 = await p.as("supervisor").process.steps.receive({ id, mode: "same", locationId: p.yard, vendorDocNo: "SA/88", same: [{ bundleId: b1.id, weightG: kg(95), rejectPcs: 1, rejectG: kg(4) }] });
    expect(r1.lossG).toBe(kg(1));
    expect(r1.amountPaise).toBeNull(); // the supervisor does not see money
    const back = await bundleBy(p, s1!);
    expect(back).toMatchObject({ locationId: p.yard, weightG: kg(95), quantity: 19, finish: "anodise", finishCode: "AA15 silver" });
    const rows = await ledgerOf(p.companyId, r1.returnId);
    expect(rows.find((r) => r.voucherType === "process_loss")).toMatchObject({ itemRef: b1.id, qtyG: -kg(5), locationId: p.yard });
    expect(rows.find((r) => r.voucherType === "process_scrap")).toMatchObject({ itemKind: "return_stream", qtyG: kg(4) });
    await expectLedgerConsistent(p);
    const mid = await p.as("office").process.steps.get({ id });
    expect(mid.step.status).toBe("partial");
    expect(mid.bundlesOut).toBe(1);
    await expect(p.as("supervisor").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b1.id, weightG: kg(95) }] })).rejects.toMatchObject({ message: `Bundle ${s1} is already back from ${mid.step.number}` });
    await expect(p.as("office").process.steps.cancel({ id, reason: "x" })).rejects.toMatchObject({ message: `${mid.step.number} has returns; it cannot be cancelled` });

    // Back at the yard it dispatches again.
    await env.plantStock(p.companyId, [b1.id]);
    const { id: dispatchId } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    expect((await p.as("packer").dispatch.scan({ id: dispatchId, serials: [s1!] })).added).toEqual([s1!]);

    // Second part: b2 back heavier by the coat (80 → 81 kg).
    const r2 = await p.as("office").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b2.id, weightG: kg(81) }] });
    expect(r2.lossG).toBe(-kg(1));
    expect(r2.amountPaise).toBe(160_000); // ₹20/kg × 80 kg sent
    expect(r2.costPerKgPaise).toBe(1_975);
    const done = await p.as("accountant").process.steps.get({ id });
    expect(done.step.status).toBe("done");
    expect(done.totals).toMatchObject({ inputG: kg(180), outputG: kg(176), lossG: 0, rejectG: kg(4), amountPaise: 360_000 });
    await expectLedgerConsistent(p);
    expect((await p.owner.process.steps.pending()).items).toEqual([]);
    const reg = await p.as("accountant").process.steps.list({ kind: "jobwork" });
    expect(reg.items[0]).toMatchObject({ status: "done", bundles: 2, bundlesOut: 0, outputG: kg(176), amountPaise: 360_000 });
    expect((await p.as("viewer").process.steps.list()).items[0]!.amountPaise).toBeNull();
    expect(await auditActions(p.companyId)).toContain("process.receive");
  });

  test("cancel before anything came back: the bundles return to their yard", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const [s1] = await p.pack(p.dieA, [{ kg: 40 }]);
    const { id } = await p.as("office").process.steps.send({ vendorId: vid, process: "pvd", codes: [s1!] });
    await expect(p.as("press").process.steps.cancel({ id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("office").process.steps.cancel({ id, reason: "Vendor shut for Diwali" });
    expect((await bundleBy(p, s1!)).locationId).toBe(p.yard);
    expect((await p.owner.process.steps.get({ id })).step.status).toBe("cancelled");
    await expect(p.as("office").process.steps.cancel({ id, reason: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expectLedgerConsistent(p);
    // Free again: a move works.
    const y2 = (await p.owner.stock.locations.list()).items.find((l) => l.code === "Y2")!.id;
    expect((await p.owner.stock.move({ codes: [s1!], toLocationId: y2 })).moved).toBe(1);
  });

  test("only free yard stock goes out: a bundle on a dispatch, void, or a vendor that is off", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const [onLoad, voided] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }]);
    await p.held([onLoad!]);
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [onLoad!] })).rejects.toMatchObject({ message: `Bundle ${onLoad} is on a dispatch; take it off the load first` });
    const v = await bundleBy(p, voided!);
    await p.owner.bundle.transitionStatus({ id: v.id, toStatus: "void", reason: "damaged" });
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", bundleIds: [v.id] })).rejects.toMatchObject({ message: `Bundle ${voided} is not in the yard; only yard stock can go on a process step` });
    await p.as("office").process.vendors.save({ id: vid, code: "ANO", name: "Shree Anodisers", processes: [], active: false });
    const [fresh] = await p.pack(p.dieA, [{ kg: 10 }]);
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [fresh!] })).rejects.toMatchObject({ message: "Vendor ANO is not active" });
  });

  test("a vendor with bundles out cannot be turned off", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    await p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [s1!] });
    await expect(p.as("office").process.vendors.save({ id: vid, code: "ANO", name: "Shree Anodisers", processes: [], active: false })).rejects.toMatchObject({ message: "Vendor ANO still has bundles out; receive them first" });
  });

  test("tenancy, permission and the module gate on steps", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const vid = await vendorOf(p);
    const ovid = await vendorOf(other);
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleBy(p, s1!);
    // Another plant's bundle is not found, nor is another plant's vendor or step.
    await expect(other.as("office").process.steps.send({ vendorId: ovid, process: "anodise", bundleIds: [b1.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: ["ZZZ"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = await p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [s1!] });
    await expect(other.owner.process.steps.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    await expect(other.owner.process.steps.challan({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.owner.process.steps.receive({ id, mode: "same", locationId: other.yard, same: [{ bundleId: b1.id, weightG: kg(10) }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.owner.process.steps.cancel({ id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.owner.process.steps.list()).items).toEqual([]);
    expect(await other.owner.process.forBundle({ bundleId: b1.id })).toBeNull();
    const [s2] = await p.pack(p.dieA, [{ kg: 10 }]);
    for (const role of ROLES.filter((r) => !can(r, "jobwork.send"))) {
      await expect(p.as(role).process.steps.send({ vendorId: vid, process: "anodise", codes: [s2!] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders", "drawbench"] }).where(eq(company.id, p.companyId));
    await expect(p.as("office").process.steps.send({ vendorId: vid, process: "anodise", codes: [s2!] })).rejects.toMatchObject({ message: MODULE_OFF });
    await expect(p.as("office").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b1.id, weightG: kg(10) }] })).rejects.toMatchObject({ message: MODULE_OFF });
    // The hold stays a fact with the module off: the bundle still does not dispatch.
    await env.plantStock(p.companyId, [b1.id]);
    const { id: dispatchId } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await expect(p.as("packer").dispatch.scan({ id: dispatchId, serials: [s1!] })).rejects.toMatchObject({ message: `Bundle ${s1} is out for job work on JW/2026-27/1` });
  });

  test("the order line's finish: powder coat on the line, the bundle's state from pending to at the vendor to done", async () => {
    setClock(NOON);
    const p = await plant();
    const vid = await vendorOf(p);
    const o = await p.order([{ dieId: p.dieA, kg: 500, finish: "powder_coat" }, { dieId: p.dieA, kg: 100 }]);
    const [s1, s2] = await p.pack(p.dieA, [{ kg: 60 }, { kg: 40 }], o.lineIds[0]);
    const first = await p.as("viewer").process.forOrder({ orderId: o.id });
    expect(first.lines).toEqual([{ lineId: o.lineIds[0]!, finish: "powder_coat", done: { bundles: 0, weightG: 0 }, at_vendor: { bundles: 0, weightG: 0 }, in_process: { bundles: 0, weightG: 0 }, pending: { bundles: 2, weightG: kg(100) } }]);
    const { id } = await p.as("office").process.steps.send({ vendorId: vid, process: "powder_coat", finishCode: "RAL 9005", codes: [s1!] });
    expect((await p.owner.process.forOrder({ orderId: o.id })).lines[0]!.at_vendor).toEqual({ bundles: 1, weightG: kg(60) });
    const b1 = await bundleBy(p, s1!);
    await p.as("office").process.steps.receive({ id, mode: "same", locationId: p.yard, same: [{ bundleId: b1.id, weightG: kg(61) }] });
    const after = (await p.owner.process.forOrder({ orderId: o.id })).lines[0]!;
    expect(after.done).toEqual({ bundles: 1, weightG: kg(61) });
    expect(after.pending.bundles).toBe(1);
    const fb = await p.owner.process.forBundle({ bundleId: b1.id });
    expect(fb).toMatchObject({ finish: "powder_coat", finishCode: "RAL 9005", open: null });
    expect(fb!.history).toHaveLength(1);
    expect(s2).toBeDefined();
  });
});

describe("rows 54, 55, 56: in-house steps on the same engine", () => {
  test("draw bench: tube in, drawn output out as new bundles; inputs used up; ledger balances; a used-up input never restores", async () => {
    setClock(NOON);
    const p = await plant();
    const [t1, t2] = await p.pack(p.dieA, [{ kg: 60, pcs: 10, mm: 6_000 }, { kg: 40, pcs: 10, mm: 6_000 }]);
    const b1 = await bundleBy(p, t1!);
    await expect(p.as("office").drawbench.start({ codes: [t1!] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("press").process.steps.start({ process: "machining", codes: [t1!] })).rejects.toMatchObject({ message: "That process does not belong to this kind of step" });
    const st = await p.as("press").drawbench.start({ passes: 2, outSize: "25 x 1.2 tube", codes: [t1!, t2!] });
    expect(st.number).toBe("PS/2026-27/1");
    // In-house: the bundles stay in the yard but are on the step (not dispatchable, still plant stock).
    expect((await bundleBy(p, t1!)).locationId).toBe(p.yard);
    await env.plantStock(p.companyId, [b1.id]);
    const { id: dispatchId } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await expect(p.as("packer").dispatch.scan({ id: dispatchId, serials: [t1!] })).rejects.toMatchObject({ message: `Bundle ${t1} is on process step PS/2026-27/1` });

    // The job-work receive does not take a draw-bench step.
    await expect(p.as("office").process.steps.receive({ id: st.id, mode: "new", locationId: p.yard, outputs: [] })).rejects.toMatchObject({ message: "That process does not belong to this kind of step" });
    const r = await p.as("press").drawbench.receive({
      id: st.id,
      mode: "new",
      locationId: p.yard,
      passes: 2,
      minutes: 95,
      scrapG: kg(3),
      outputs: [
        { dieId: p.dieB, lengthMm: 6_400, pcs: 10, weightG: kg(56) },
        { dieId: p.dieB, lengthMm: 6_400, pcs: 10, weightG: kg(39) },
      ],
    });
    expect(r.newBundleIds).toHaveLength(2);
    expect(r.lossG).toBe(kg(2)); // 100 − 95 − 3
    expect((await bundleBy(p, t1!)).status).toBe("void");
    const rows = await ledgerOf(p.companyId, r.returnId);
    const sum = (t: string) => rows.filter((x) => x.voucherType === t).reduce((a, x) => a + x.qtyG, 0);
    expect(sum("process_in")).toBe(-kg(98));
    expect(sum("process_loss")).toBe(-kg(2));
    expect(sum("process_out")).toBe(kg(95));
    expect(sum("process_scrap")).toBe(kg(3));
    await expectLedgerConsistent(p);
    const outs = await env.db.select().from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.dieId, p.dieB)));
    expect(outs.map((b) => b.weightG).sort()).toEqual([kg(39), kg(56)]);
    expect(outs[0]!.locationId).toBe(p.yard);
    // A used-up input never comes back.
    await expect(p.owner.bundle.transitionStatus({ id: b1.id, toStatus: "available", reason: "x" })).rejects.toMatchObject({ message: `Bundle ${t1} was used up on PS/2026-27/1; it cannot come back` });
    // The new bundles dispatch.
    await env.plantStock(p.companyId, outs.map((b) => b.id));
    expect((await p.as("packer").dispatch.scan({ id: dispatchId, serials: [outs[0]!.serial] })).added).toEqual([outs[0]!.serial]);
    const got = await p.owner.process.steps.get({ id: st.id });
    expect(got.step).toMatchObject({ kind: "draw", status: "done", passes: 2, outSize: "25 x 1.2 tube" });
    expect(got.outputs).toHaveLength(2);
  });

  test("the draw bench is behind its module; fabrication behind its own", async () => {
    setClock(NOON);
    const p = await plant();
    const [t1] = await p.pack(p.dieA, [{ kg: 10 }]);
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders", "jobwork"] }).where(eq(company.id, p.companyId));
    await expect(p.as("press").drawbench.start({ codes: [t1!] })).rejects.toMatchObject({ message: MODULE_OFF });
    await expect(p.as("press").fabrication.start({ ops: ["cut"], codes: [t1!] })).rejects.toMatchObject({ message: MODULE_OFF });
    const fin = await p.as("press").process.steps.start({ process: "anodise", batchNo: "AN-12", chemicals: [{ name: "Sulphuric acid", qty: "20 L" }], codes: [t1!] });
    expect(fin.number).toBe("PS/2026-27/1");
  });

  test("draw bench with job work off: its own register and step read; another kind's step is not found there; job-work writes are off", async () => {
    setClock(NOON);
    const p = await plant();
    const [t1, t2] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 12 }]);
    const fin = await p.as("press").process.steps.start({ process: "anodise", codes: [t2!] });
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders", "drawbench"] }).where(eq(company.id, p.companyId));
    const st = await p.as("press").drawbench.start({ passes: 1, codes: [t1!] });
    const list = await p.as("press").drawbench.list({ limit: 50, offset: 0 });
    expect(list.items.map((r) => r.id)).toEqual([st.id]);
    const got = await p.as("press").drawbench.get({ id: st.id });
    expect(got.step).toMatchObject({ kind: "draw", status: "open" });
    expect(got.inputs).toHaveLength(1);
    await expect(p.as("press").drawbench.get({ id: fin.id })).rejects.toMatchObject({ message: "Not found" });
    // Reads are never module gated (moduleGate.ts): the register still lists both kinds; writes are.
    expect((await p.as("press").process.steps.list({ limit: 50, offset: 0 })).items).toHaveLength(2);
    await expect(p.as("press").process.steps.start({ process: "anodise", codes: [t2!] })).rejects.toMatchObject({ message: MODULE_OFF });
    // Tenancy: another plant never reads this step.
    const other = await plant();
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders", "drawbench"] }).where(eq(company.id, other.companyId));
    await expect(other.as("press").drawbench.get({ id: st.id })).rejects.toMatchObject({ message: "Not found" });
    expect((await other.as("press").drawbench.list({ limit: 50, offset: 0 })).items).toEqual([]);
  });

  test("fabrication: cut to length on the same bundles with rejects and the time taken; in-house finishing records batch and chemicals", async () => {
    setClock(NOON);
    const p = await plant();
    const [f1, a1] = await p.pack(p.dieA, [{ kg: 30, pcs: 10 }, { kg: 20, pcs: 8 }]);
    const fb = await bundleBy(p, f1!);
    const fab = await p.as("supervisor").fabrication.start({ ops: ["cut", "punch"], codes: [f1!] });
    const rf = await p.as("supervisor").fabrication.receive({ id: fab.id, mode: "same", minutes: 40, scrapG: kg(1), same: [{ bundleId: fb.id, weightG: kg(28), rejectPcs: 1, rejectG: kg(1) }] });
    expect(rf.lossG).toBe(0);
    expect(await bundleBy(p, f1!)).toMatchObject({ weightG: kg(28), quantity: 9, finish: null, locationId: p.yard });
    expect((await p.owner.process.steps.get({ id: fab.id })).step.ops).toEqual(["cut", "punch"]);

    const ab = await bundleBy(p, a1!);
    const line = await p.as("press").process.steps.start({ process: "powder_coat", finishCode: "RAL 7016", batchNo: "PC-7", chemicals: [{ name: "Powder RAL 7016", qty: "3 kg" }], codes: [a1!] });
    await p.as("press").process.steps.receive({ id: line.id, mode: "same", minutes: 25, same: [{ bundleId: ab.id, weightG: kg(20.4) }] });
    expect(await bundleBy(p, a1!)).toMatchObject({ finish: "powder_coat", finishCode: "RAL 7016" });
    const got = await p.owner.process.steps.get({ id: line.id });
    expect(got.step).toMatchObject({ batchNo: "PC-7", chemicals: [{ name: "Powder RAL 7016", qty: "3 kg" }] });
    expect(got.returns[0]).toMatchObject({ minutes: 25 });
    await expectLedgerConsistent(p);
    // A process gain without a coat is refused.
    const [m1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const mb = await bundleBy(p, m1!);
    const fab2 = await p.as("supervisor").fabrication.start({ ops: ["cnc"], codes: [m1!] });
    await expect(p.as("supervisor").fabrication.receive({ id: fab2.id, mode: "same", same: [{ bundleId: mb.id, weightG: kg(10.2) }] })).rejects.toMatchObject({ message: "More came back than was sent; check the weights" });
    const ledgerRows = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.itemRef, mb.id)));
    expect(ledgerRows).toHaveLength(1);
  });
});
