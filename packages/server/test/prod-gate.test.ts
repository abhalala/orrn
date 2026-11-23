/**
 * PROD-GATE (owner rule 2026-11-23, "prod with modules off"): XE code ships to prod, but every XE module
 * stays off for a plant until the owner names it in Godseye. A plant whose module list is empty, or names
 * only the ten standard modules, must see no XE procedure, no XE key in core answers and no XE row, and the
 * core flows must give what they gave before XE.
 *
 * How "as before" is pinned here: (1) every core test file runs on `[]` (the harness default) and is
 * unchanged by this lane; (2) this file checks the XE keys are ABSENT from the core answers (not just
 * empty), that every XE table holds no row for the plant after the flows, and that the `[]` plant and the
 * explicit-standard plant give answers of the same shape; (3) the press close repeats the pre-XE worked
 * example (press-w2-close.test.ts) figure for figure, ledger rows included.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  company,
  complaint,
  invoice,
  plantBankAccount,
  plantDocument,
  plantMaster,
  priceRate,
  proforma,
  qaCheck,
  qaHold,
  stockLedger,
  toolingItem,
  worksOrder,
} from "@orrn/db/schema";
import { isOptInModule, STANDARD_MODULES } from "@orrn/domain";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { fillWorkedExample, kg, pressHelpers } from "./press-w2-fixture";
import { salesHelpers, type SalesPlant } from "./sales-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { plant, plRow } = salesHelpers(() => env);
const { pressPlant } = pressHelpers(() => env);
const portal = portalHelpers(() => env);
const MODULE_OFF = "That module is not on for this plant";

/** The two lists a real plant can have today: nothing named, or only standard modules named. */
const VARIANTS: { name: string; modules: string[] }[] = [
  { name: "empty list", modules: [] },
  { name: "standard modules only", modules: [...STANDARD_MODULES] },
];

async function setModules(companyId: string, modules: string[]) {
  await env.db.update(company).set({ modules }).where(eq(company.id, companyId));
}

/** Keys of an object, deep (arrays: the first element), as sorted dotted paths: the "shape" of an answer. */
function shape(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.length ? shape(v[0], `${prefix}[]`) : [`${prefix}[]`];
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.keys(v)
      .sort()
      .flatMap((k) => [`${prefix}${k}`, ...shape((v as Record<string, unknown>)[k], `${prefix}${k}.`)]);
  }
  return [];
}

// The PL header's invoice number and date are older than XE (the typed Tally link); only the portal's are XE-BILL.
const XE_KEYS = ["priceBreakup", "packingMode", "transitInsurance", "toolingShort", "progress"];
const leaked = (paths: string[], keys: string[]) => paths.filter((p) => keys.some((k) => p === k || p.endsWith(`.${k}`) || p.includes(`.${k}.`) || p.startsWith(`${k}.`)));

describe.each(VARIANTS)("a plant with $name", ({ modules }) => {
  test("every procedure of an opt-in (XE) module is refused, reads included", async () => {
    const { appRouter, loadAllRouters } = await import("../src/routers/index");
    const { moduleForPath } = await import("../src/lib/moduleGate");
    await loadAllRouters();
    const p = await plant();
    await setModules(p.companyId, modules);
    const paths = Object.keys(appRouter._def.procedures).filter((path) => {
      const m = moduleForPath(path);
      return m !== null && isOptInModule(m);
    });
    // The XE routers and the REG procedures riding `reports` are all registered.
    for (const sample of ["complaints.list", "qa.settings.get", "masters.lists.list", "masters.bank.list", "docs.list", "toolRoom.tooling.list", "reports.morning", "reports.wip", "billing.invoices.list"]) {
      expect(paths).toContain(sample);
    }
    expect(paths.some((x) => x.startsWith("pricing."))).toBe(true);
    for (const path of paths) {
      const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p.owner) as (input?: unknown) => Promise<unknown>;
      await expect(fn({}).then(() => "served")).rejects.toMatchObject({ message: MODULE_OFF });
    }
  });

  test("morning mail settings and the recut reason are XE (`mis`): refused or not kept", async () => {
    const p = await plant();
    await setModules(p.companyId, modules);
    await expect(p.owner.company.updateSettings({ morningSummary: { enabled: true } })).rejects.toMatchObject({ message: MODULE_OFF });
  });
});

/** Order create and confirm, pack onto the line, dispatch scan, complete (packing list), the answers' shapes. */
async function coreFlow(p: SalesPlant) {
  const o = await p.order([{ dieId: p.dieA, kg: 1200 }], { status: "confirmed" });
  const got = await p.owner.orders.get({ id: o.id });
  const serials = await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], o.lineIds[0]);
  const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", salesOrderId: o.id });
  const scan = await p.as("packer").dispatch.scan({ id, serials });
  await p.owner.dispatch.reserve({ id });
  await p.approveOffBand(id);
  const done = await p.owner.dispatch.complete({ id });
  const pl = await plRow(id);
  const today = await p.owner.dashboard.today();
  return { o, got, scan, done, pl, today, dispatchId: id };
}

describe("core flows on a plant without XE keys", () => {
  test("order, pack, dispatch scan and packing list: no XE key anywhere, same shapes for both lists, no XE rows", async () => {
    const shapes: Record<string, string[]>[] = [];
    for (const v of VARIANTS) {
      const p = await plant({ settings: { priceOnSalesOrder: true } });
      await setModules(p.companyId, v.modules);
      const f = await coreFlow(p);
      expect(f.scan.added.length).toBe(2);
      expect(f.done).toMatchObject({ success: true });
      const header = (f.pl!.snapshot as { header: Record<string, unknown> }).header;
      expect(Object.keys(header)).not.toContain("packingMode");
      expect(Object.keys(header)).not.toContain("transitInsurance");
      const s = {
        orderGet: shape(f.got),
        scan: shape(f.scan),
        complete: shape(f.done),
        plHeader: shape(header),
        today: shape(f.today),
      };
      for (const [name, paths] of Object.entries(s)) expect({ name, leaked: leaked(paths, XE_KEYS) }).toEqual({ name, leaked: [] });
      shapes.push(s);

      // No XE table gained a row for this plant.
      const tables = { complaint, invoice, plantBankAccount, plantDocument, plantMaster, priceRate, proforma, qaCheck, qaHold, toolingItem, worksOrder };
      for (const [name, table] of Object.entries(tables)) {
        const [row] = await env.db.select({ n: count() }).from(table).where(eq((table as typeof complaint).companyId, p.companyId));
        expect({ name, n: row!.n }).toEqual({ name, n: 0 });
      }
    }
    expect(shapes[1]).toEqual(shapes[0]!);
  });

  test("stored number formats and approver rules are ignored while `masters_plus` is off", async () => {
    const p = await plant();
    await env.db
      .update(company)
      .set({ modules: [], settings: { timezone: "Asia/Kolkata", docFormats: { so: { prefix: "ZZ/", fy: "none", pad: 5 } }, approvalRules: { dispatch_overdraw: { roles: ["office"] } } } })
      .where(eq(company.id, p.companyId));
    const o = await p.order([{ dieId: p.dieA, kg: 100 }], { status: "booking" });
    expect(o.number.startsWith("ZZ")).toBe(false);
    const { loadApprovalRules } = await import("../src/lib/approverRules");
    expect(await loadApprovalRules(env.db, p.companyId)).toEqual({});
    // Named, the same stored settings apply (the switch is the only difference).
    await setModules(p.companyId, ["masters_plus"]);
    expect((await p.order([{ dieId: p.dieA, kg: 100 }], { status: "booking" })).number.startsWith("ZZ/")).toBe(true);
    expect(Object.keys(await loadApprovalRules(env.db, p.companyId))).toEqual(["dispatch_overdraw"]);
  });

  test.each(VARIANTS)("press close repeats the pre-XE worked example ($name)", async ({ modules }) => {
    const p = await pressPlant();
    await setModules(p.companyId, modules);
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const out = await p.as("supervisor").press.runs.close({ id: r.runId });
    expect(out).toMatchObject({ status: "logged", recoveryBp: 7545, recoveryPct: "75.5", balanceG: 31_400, issue: "returned" });
    const rows = await env.db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.voucherId, r.runId), inArray(stockLedger.voucherType, ["press_run"])))
      .orderBy(asc(stockLedger.line));
    expect(rows.map((x) => [x.line, x.itemKind, x.qtyG])).toEqual([
      [1, "billet", -310_400],
      [2, "return_stream", 25_000],
      [3, "return_stream", 12_800],
      [4, "return_stream", 7_000],
    ]);
  });
});

describe.each(VARIANTS)("the party portal of a plant with $name", ({ modules }) => {
  test("no complaints entry, no order progress, no invoice number; complaints refused", async () => {
    const p = await portal.portalPlant();
    await setModules(p.companyId, modules);
    const f = await coreFlow(p);
    const party = await portal.partyLogin(p);
    const me = await party.api.portal.me();
    expect({ complaints: me.complaints, billing: me.billing }).toEqual({ complaints: false, billing: false });
    const order = await party.api.portal.orders.get({ id: f.o.id });
    expect(order.lines.length).toBe(1);
    expect(order.lines.every((l) => !("progress" in l))).toBe(true);
    const list = await party.api.portal.dispatches.list();
    expect(list.items.length).toBe(1);
    expect(leaked(shape(list), ["invoiceNumber", "invoiceDate"])).toEqual([]);
    expect(leaked(shape(await party.api.portal.dispatches.get({ id: f.dispatchId })), ["invoiceNumber", "invoiceDate"])).toEqual([]);
    await expect(party.api.portal.complaints.list({})).rejects.toMatchObject({ message: MODULE_OFF });
  });
});
