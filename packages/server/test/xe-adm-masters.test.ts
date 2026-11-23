/**
 * XE parity lane ADM: plant masters (#57 #75 #76), bank details (#20), transit insurance (#21), member
 * department and designation (#75), mode of packing on the order line and the dispatch, printed on
 * the PL with the insurance policy (#21 #76). Every procedure: tenancy, permission, happy path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, membership } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { NOON, salesHelpers, SLOW } from "./sales-fixture";

let env: TestEnv;
let setClock: typeof import("../src/lib/clock").setClockForTests;
beforeAll(async () => {
  env = await createTestEnv({ defaultModules: ["masters_plus", "docs"] });
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

async function plant(modules?: string[]) {
  const { companyId, users } = await env.seedCompany(modules ? { modules } : undefined);
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, manager: as("manager") };
}
const audits = (companyId: string, action: string) =>
  env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));

describe("masters.lists", () => {
  test("a manager adds, renames and retires; every member reads; the starters add once", async () => {
    const p = await plant();
    const dept = await p.manager.masters.lists.create({ kind: "department", name: "Press shop" });
    await p.manager.masters.lists.create({ kind: "designation", name: "Shift in charge" });
    const read = await p.as("viewer").masters.lists.list({ kind: "department" });
    expect(read.map((r) => r.name)).toEqual(["Press shop"]);
    await expect(p.manager.masters.lists.create({ kind: "department", name: " press  SHOP " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.masters.lists.update({ id: dept.id, name: "Press" });
    await p.manager.masters.lists.update({ id: dept.id, active: false });
    expect((await p.manager.masters.lists.list({ kind: "department" }))[0]).toMatchObject({ name: "Press", active: false });
    const first = await p.manager.masters.lists.addStarters({ kind: "packing_mode" });
    expect(first.added).toBe(5);
    expect((await p.manager.masters.lists.addStarters({ kind: "packing_mode" })).added).toBe(0);
    expect((await audits(p.companyId, "plant_master.create")).length).toBe(2);
  });

  test("a die category carries an expected life; other kinds refuse one", async () => {
    const p = await plant();
    const cat = await p.manager.masters.lists.create({ kind: "die_category", name: "Hollow", expectedLifeG: 40_000_000 });
    expect((await p.manager.masters.lists.list({ kind: "die_category" }))[0]).toMatchObject({ id: cat.id, expectedLifeG: 40_000_000 });
    await expect(p.manager.masters.lists.create({ kind: "department", name: "X", expectedLifeG: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("die categories need the die room module; other lists do not", async () => {
    const p = await plant(["orders", "masters_plus"]);
    await expect(p.manager.masters.lists.create({ kind: "die_category", name: "Solid" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.masters.lists.create({ kind: "department", name: "Office" });
  });

  test("permission: floor roles and the office cannot write", async () => {
    const p = await plant();
    for (const role of ["office", "die_room", "viewer", "packer"] as CompanyRole[]) {
      await expect(p.as(role).masters.lists.create({ kind: "department", name: `D ${role}` })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("tenancy: another plant's entry is Not found and never listed", async () => {
    const a = await plant();
    const b = await plant();
    const row = await a.manager.masters.lists.create({ kind: "department", name: "Foundry" });
    await expect(b.manager.masters.lists.update({ id: row.id, name: "Mine" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await b.manager.masters.lists.list()).toEqual([]);
  });
});

describe("masters.bank and getPlantBankForPrint", () => {
  const acct = { bankName: "State Bank of India", branch: "Udhna", accountName: "Fourcubes Aluminium Pvt Ltd", accountNo: "3012 3456 789", ifsc: "sbin0001234", note: null };

  test("the first account is the default; another made default takes over; papers read the default", async () => {
    const p = await plant();
    const { getPlantBankForPrint } = await import("../src/lib/plantPrint");
    expect(await getPlantBankForPrint(env.db, p.companyId)).toBeNull();
    const a = await p.manager.masters.bank.create(acct);
    expect(a.isDefault).toBe(true);
    expect(await getPlantBankForPrint(env.db, p.companyId)).toEqual({ bankName: "State Bank of India", branch: "Udhna", accountName: "Fourcubes Aluminium Pvt Ltd", accountNo: "30123456789", ifsc: "SBIN0001234" });
    const b = await p.manager.masters.bank.create({ ...acct, bankName: "HDFC Bank", accountNo: "50100123456789", ifsc: "HDFC0000123", makeDefault: true });
    const list = await p.manager.masters.bank.list();
    expect(list.map((r) => [r.bankName, r.isDefault])).toEqual([["HDFC Bank", true], ["State Bank of India", false]]);
    await p.manager.masters.bank.setDefault({ id: a.id });
    expect((await getPlantBankForPrint(env.db, p.companyId))!.bankName).toBe("State Bank of India");
    // Retiring the default leaves none until another is chosen.
    await p.manager.masters.bank.setActive({ id: a.id, active: false });
    expect(await getPlantBankForPrint(env.db, p.companyId)).toBeNull();
    await expect(p.manager.masters.bank.setDefault({ id: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.masters.bank.setDefault({ id: b.id });
    expect((await getPlantBankForPrint(env.db, p.companyId))!.bankName).toBe("HDFC Bank");
    // The audit names the bank and last four digits, never the whole number.
    const [row] = await audits(p.companyId, "bank_account.create");
    expect(JSON.stringify(row!.meta)).not.toContain("30123456789");
  });

  test("bad IFSC and account numbers are refused", async () => {
    const p = await plant();
    await expect(p.manager.masters.bank.create({ ...acct, ifsc: "SBIN1001234" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.masters.bank.create({ ...acct, accountNo: "12-AB" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("permission: floor roles cannot read or write accounts; the accountant reads", async () => {
    const p = await plant();
    await p.manager.masters.bank.create(acct);
    await expect(p.as("packer").masters.bank.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("viewer").masters.bank.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await p.as("accountant").masters.bank.list()).toHaveLength(1);
    await expect(p.as("accountant").masters.bank.create(acct)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("tenancy: another plant's account is Not found and its default never prints here", async () => {
    const a = await plant();
    const b = await plant();
    const row = await a.manager.masters.bank.create(acct);
    await expect(b.manager.masters.bank.setDefault({ id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.manager.masters.bank.update({ ...acct, id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { getPlantBankForPrint } = await import("../src/lib/plantPrint");
    expect(await getPlantBankForPrint(env.db, b.companyId)).toBeNull();
    expect(await b.manager.masters.bank.list()).toEqual([]);
  });
});

describe("masters.insurance", () => {
  test("set, read by any member, clear; dates checked; managers only", async () => {
    const p = await plant();
    expect(await p.as("packer").masters.insurance.get()).toBeNull();
    await expect(p.manager.masters.insurance.set({ policyNo: "P1", insurer: "X", validFrom: "2026-05-01", validTo: "2026-04-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.masters.insurance.set({ policyNo: "OMP/2026/77", insurer: "New India Assurance", validFrom: "2026-04-01", validTo: "2027-03-31" });
    expect(await p.as("packer").masters.insurance.get()).toMatchObject({ policyNo: "OMP/2026/77", printOnPl: true });
    await expect(p.as("office").masters.insurance.set(null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.masters.insurance.set(null);
    expect(await p.manager.masters.insurance.get()).toBeNull();
    const other = await plant();
    expect(await other.manager.masters.insurance.get()).toBeNull();
  });
});

describe("masters.people.assign", () => {
  test("the admin sets a member's department and designation; ids of another plant or kind are Not found", async () => {
    const p = await plant();
    const other = await plant();
    const dept = await p.manager.masters.lists.create({ kind: "department", name: "Press" });
    const desg = await p.manager.masters.lists.create({ kind: "designation", name: "Operator" });
    const foreign = await other.manager.masters.lists.create({ kind: "department", name: "Press" });
    const [m] = await env.db.select({ id: membership.id }).from(membership).where(and(eq(membership.companyId, p.companyId), eq(membership.userId, p.users.press.id)));
    await p.as("admin").masters.people.assign({ membershipId: m!.id, departmentId: dept.id, designationId: desg.id });
    const members = await p.as("admin").company.membersList();
    expect(members.find((x) => x.id === m!.id)).toMatchObject({ departmentId: dept.id, designationId: desg.id });
    await expect(p.as("admin").masters.people.assign({ membershipId: m!.id, departmentId: foreign.id, designationId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.as("admin").masters.people.assign({ membershipId: m!.id, departmentId: desg.id, designationId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.manager.masters.people.assign({ membershipId: m!.id, departmentId: null, designationId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.as("admin").masters.people.assign({ membershipId: m!.id, departmentId: null, designationId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("mode of packing and insurance on the packing list", () => {
  const { plant: salesPlant, plRow } = salesHelpers(() => env);

  test(
    "order line mode prints; the dispatch's own mode wins; insurance prints while valid",
    async () => {
      setClock(NOON);
      const p = await salesPlant();
      const poly = await p.owner.masters.lists.create({ kind: "packing_mode", name: "Poly wrap" });
      const crate = await p.owner.masters.lists.create({ kind: "packing_mode", name: "Wooden crate" });
      await p.owner.masters.insurance.set({ policyNo: "OMP/2026/77", insurer: "New India Assurance", validFrom: "2026-04-01", validTo: "2027-03-31" });
      const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
      await p.as("office").masters.packing.setForLine({ lineId: o.lineIds[0]!, packingModeId: poly.id });
      await expect(p.as("packer").masters.packing.setForLine({ lineId: o.lineIds[0]!, packingModeId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await p.as("viewer").masters.packing.forOrder({ orderId: o.id })).toEqual([{ lineId: o.lineIds[0]!, packingModeId: poly.id }]);

      const first = await p.pack(p.dieA, [{ kg: 20 }], o.lineIds[0]);
      const d1 = await p.held(first);
      await p.owner.dispatch.complete({ id: d1 });
      const snap1 = (await plRow(d1))!.snapshot as { header: { packingMode?: string | null; transitInsurance?: unknown } };
      expect(snap1.header.packingMode).toBe("Poly wrap");
      expect(snap1.header.transitInsurance).toEqual({ policyNo: "OMP/2026/77", insurer: "New India Assurance", validTo: "2027-03-31" });

      const second = await p.pack(p.dieA, [{ kg: 20 }], o.lineIds[0]);
      const d2 = await p.held(second);
      await p.as("supervisor").masters.packing.setForDispatch({ dispatchId: d2, packingModeId: crate.id });
      await p.owner.masters.insurance.set({ policyNo: "OMP/2026/77", insurer: "New India Assurance", validFrom: "2026-04-01", validTo: "2026-09-30" });
      await p.owner.dispatch.complete({ id: d2 });
      const snap2 = (await plRow(d2))!.snapshot as { header: { packingMode?: string | null; transitInsurance?: unknown } };
      expect(snap2.header.packingMode).toBe("Wooden crate");
      // Lapsed on the PL date (3 Oct 2026): not printed as cover.
      expect(snap2.header.transitInsurance).toBeNull();

      // The print and the sheet carry them.
      // @orrn/documents is a client package: load it by a path variable so this package's type check skips it.
      const docsPath = "../../documents/src/packing-list/index";
      const docs = (await import(docsPath)) as unknown as { buildPackingListHtml(pl: unknown, code: string): string };
      expect(docs.buildPackingListHtml(snap1, "PL")).toContain("Packing Poly wrap");
      expect(docs.buildPackingListHtml(snap1, "PL")).toContain("Transit insurance OMP/2026/77, New India Assurance");
    },
    SLOW,
  );

  test("tenancy and refusals for the dispatch and line setters", async () => {
    setClock(NOON);
    const a = await salesPlant();
    const b = await salesPlant();
    const mode = await a.owner.masters.lists.create({ kind: "packing_mode", name: "Carton" });
    const o = await a.order([{ dieId: a.dieA, kg: 100 }]);
    await expect(b.owner.masters.packing.setForLine({ lineId: o.lineIds[0]!, packingModeId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await b.owner.masters.packing.forOrder({ orderId: o.id })).toEqual([]);
    const bo = await b.order([{ dieId: b.dieA, kg: 100 }]);
    await expect(b.owner.masters.packing.setForLine({ lineId: bo.lineIds[0]!, packingModeId: mode.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const serials = await a.pack(a.dieA, [{ kg: 10 }], o.lineIds[0]);
    const d = await a.held(serials);
    await expect(b.owner.masters.packing.setForDispatch({ dispatchId: d, packingModeId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.as("viewer").masters.packing.setForDispatch({ dispatchId: d, packingModeId: mode.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});
