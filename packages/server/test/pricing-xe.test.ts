/**
 * XE-PRICE (lane PRICE): price master (rows 1-9), the breakdown frozen at confirm, price_change
 * approvals, quotes (10), proforma (11), works order (12), enquiries (19). Tenancy, permission
 * refusals and the module gate on every procedure group.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, priceRate, salesOrderLine } from "@orrn/db/schema";
import type { PriceBreakup } from "@orrn/domain";
import { and, eq } from "drizzle-orm";

import { setClockForTests } from "../src/lib/clock";
import { planConfirmFreeze } from "../src/lib/pricing";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { confirmOrder, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});
afterEach(() => setClockForTests(null));

/** 2026-11-15 12:00 IST. */
const NOON = new Date("2026-11-15T06:30:00.000Z");
const MOD_OFF = "That module is not on for this plant";

async function plant(opts: { modules?: string[]; priceOnSalesOrder?: boolean } = {}) {
  setClockForTests(NOON);
  const { companyId, users } = await env.seedCompany({
    modules: opts.modules ?? [],
    settings: { timezone: "Asia/Kolkata", priceOnSalesOrder: opts.priceOnSalesOrder ?? true, defaultAlloy: "6063", defaultTemper: "T6" },
  });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const dieA = await env.seedDie(companyId, { series: "Domal", alloy: "6061", temper: "T6" });
  const dieB = await env.seedDie(companyId, { series: "Slim", alloy: "6063", temper: "T5" });
  const customerId = await env.seedCustomer(companyId);
  return { companyId, users, as, office: as("office"), manager: as("manager"), owner: as("owner"), dieA, dieB, customerId };
}
type Plant = Awaited<ReturnType<typeof plant>>;

/** Office proposes, manager approves. */
async function setRate(p: Plant, change: Parameters<ReturnType<Plant["as"]>["pricing"]["rates"]["propose"]>[0]["change"], effectiveFrom = "2026-11-01") {
  const r = await p.office.pricing.rates.propose({ change, effectiveFrom, reason: "Rate list" });
  await p.manager.approval.decide({ id: r.approvalId, decision: "approved" });
  return r;
}

/** NALCO 250, default conversion 45, 6061 surcharge 8, anodise 18 (Rs per kg). */
async function readyMaster(p: Plant) {
  await setRate(p, { kind: "metal", source: "nalco", paisePerKg: 25_000 });
  await setRate(p, { kind: "conversion", scope: "default", paisePerKg: 4_500 });
  await setRate(p, { kind: "alloy", alloy: "6061", paisePerKg: 800 });
  await setRate(p, { kind: "finish", finish: "Anodise", paisePerKg: 1_800 });
}

async function bookOrder(p: Plant, lines: { sectionId: string; kg: number; pcs?: number; finish?: string | null; ratePaise?: number }[]) {
  const res = await p.owner.orders.create({
    customerId: p.customerId,
    poNumber: `PO-${crypto.randomUUID().slice(0, 6)}`,
    lines: lines.map((l) => ({ sectionId: l.sectionId, cutLengthMm: 3_658, kgG: l.kg * 1000, pcs: l.pcs ?? 100, finish: l.finish ?? null, tierRank: 1, ...(l.ratePaise != null ? { ratePaise: l.ratePaise } : {}) })),
  });
  return res.id;
}

const lineRows = (orderId: string) => env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, orderId)).orderBy(salesOrderLine.lineNo);

describe("price master (rows 2-9)", () => {
  test(
    "a proposed rate waits for a second person; until approved the old rate applies; approved is audited",
    async () => {
      const p = await plant();
      const first = await p.office.pricing.rates.propose({ change: { kind: "metal", source: "nalco", paisePerKg: 25_000 }, effectiveFrom: "2026-11-01", reason: "Nalco list 1 Nov" });
      expect(first.status).toBe("pending");
      let cur = await p.office.pricing.rates.current();
      expect(cur.ready).toBe(false);
      expect(cur.items.find((i) => i.kind === "metal")).toMatchObject({ current: null, pending: [{ paise: 25_000 }] });
      // The requester can never approve their own change; office is not an approver anyway.
      await expect(p.office.approval.decide({ id: first.approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await p.manager.approval.decide({ id: first.approvalId, decision: "approved" });
      cur = await p.office.pricing.rates.current();
      expect(cur.items.find((i) => i.kind === "metal")!.current).toMatchObject({ paise: 25_000, status: "active" });

      // A change to 260 waits; the 250 rate still applies; rejecting it keeps 250.
      const next = await p.office.pricing.rates.propose({ change: { kind: "metal", source: "nalco", paisePerKg: 26_000 }, effectiveFrom: "2026-11-10", reason: "Nalco list 10 Nov" });
      cur = await p.office.pricing.rates.current();
      expect(cur.items.find((i) => i.kind === "metal")!.current!.paise).toBe(25_000);
      await p.manager.approval.decide({ id: next.approvalId, decision: "rejected" });
      const row = await env.db.select().from(priceRate).where(eq(priceRate.id, next.id)).get();
      expect(row).toMatchObject({ status: "rejected" });
      expect((await p.office.pricing.rates.current()).items.find((i) => i.kind === "metal")!.current!.paise).toBe(25_000);

      const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, first.id)));
      expect(audits.map((a) => a.action).sort()).toEqual(["price.rate.activate", "price.rate.propose"]);
      // Approval meta carries no money (approval.list is open to every role).
      const ap = await env.db.select().from(approval).where(eq(approval.id, first.approvalId)).get();
      expect(ap!.meta).toEqual({ rateKind: "metal", key: "nalco", effectiveFrom: "2026-11-01" });
      expect(JSON.stringify(await p.as("packer").approval.list({} as never))).not.toContain("25000");
    },
    SLOW,
  );

  test(
    "LME is stored as dollars, exchange rate and premium; the rate per kg is computed on the server",
    async () => {
      const p = await plant();
      const r = await p.office.pricing.rates.propose({
        change: { kind: "metal", source: "lme", lme: { usdPerTonneCents: 250_000, inrPerUsdPaise: 8_350, premiumPaisePerKg: 1_200 } },
        reason: "Lme today",
      });
      expect(r.paise).toBe(22_075);
      const row = await env.db.select().from(priceRate).where(eq(priceRate.id, r.id)).get();
      expect(row!.detail).toEqual({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8_350, premiumPaisePerKg: 1_200 });
      expect(row!.effectiveFrom).toBe("2026-11-15");
      await expect(p.office.pricing.rates.propose({ change: { kind: "metal", source: "lme" }, reason: "No inputs" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    },
    SLOW,
  );

  test(
    "one pending change per rate; keys: conversion by group and section, alloy and finish lower case, components, customer terms",
    async () => {
      const p = await plant();
      await p.office.pricing.rates.propose({ change: { kind: "conversion", scope: "default", paisePerKg: 4_500 }, reason: "Plant default" });
      await expect(p.office.pricing.rates.propose({ change: { kind: "conversion", scope: "default", paisePerKg: 4_600 }, reason: "Again" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "A change to this rate is already waiting for approval",
      });
      const a = await p.office.pricing.rates.propose({ change: { kind: "conversion", scope: "series", series: " Domal ", paisePerKg: 5_000 }, reason: "Domal group" });
      const b = await p.office.pricing.rates.propose({ change: { kind: "conversion", scope: "die", sectionId: p.dieB, paisePerKg: 6_000 }, reason: "Slim section" });
      const c = await p.office.pricing.rates.propose({ change: { kind: "alloy", alloy: "6082", paisePerKg: 900 }, reason: "6082" });
      const d = await p.office.pricing.rates.propose({ change: { kind: "component", label: "Cutting to length", basis: "piece", always: false, paise: 200 }, reason: "Cutting" });
      const e = await p.office.pricing.rates.propose({ change: { kind: "customer", customerId: p.customerId, mode: "discount", paisePerKg: 500 }, reason: "Old buyer" });
      expect([a.key, b.key, c.key, d.key, e.key]).toEqual(["series:domal", `die:${p.dieB}`, "6082", "cutting_to_length", `${p.customerId}:discount`]);
      await expect(p.office.pricing.rates.propose({ change: { kind: "finish", finish: "None", paisePerKg: 1 }, reason: "No" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const cur = await p.office.pricing.rates.current();
      expect(cur.items.find((i) => i.key === `die:${p.dieB}`)!.name).toBeTruthy();
      expect(cur.items.find((i) => i.kind === "customer")!.name).toMatch(/^Customer/);
    },
    SLOW,
  );

  test(
    "permissions: packer and viewer cannot read; floor roles and accountant cannot propose; settings need price.manage",
    async () => {
      const p = await plant();
      for (const role of ["packer", "viewer", "press", "supervisor"] as const) {
        await expect(p.as(role).pricing.rates.current()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await p.as("accountant").pricing.rates.current();
      for (const role of ["accountant", "packer", "supervisor"] as const) {
        await expect(p.as(role).pricing.rates.propose({ change: { kind: "alloy", alloy: "6061", paisePerKg: 1 }, reason: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(p.as(role).pricing.settings.update({ estimatedGstBp: 1200 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const s = await p.manager.pricing.settings.update({ metalSource: "lme", estimatedGstBp: 1200 });
      expect(s).toMatchObject({ metalSource: "lme", estimatedGstBp: 1200, quoteValidDays: 15 });
      expect(await p.as("accountant").pricing.settings.get()).toMatchObject({ metalSource: "lme", estimatedGstBp: 1200, priceOnSalesOrder: true });
    },
    SLOW,
  );

  test(
    "tenancy: another plant's rate, customer, section and line answer Not found",
    async () => {
      const a = await plant();
      const b = await plant();
      const r = await a.office.pricing.rates.propose({ change: { kind: "alloy", alloy: "6082", paisePerKg: 900 }, reason: "A plant" });
      await expect(b.office.pricing.rates.get({ id: r.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.office.pricing.rates.propose({ change: { kind: "customer", customerId: a.customerId, mode: "fixed", paisePerKg: 1 }, reason: "Cross" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.office.pricing.rates.propose({ change: { kind: "conversion", scope: "die", sectionId: a.dieA, paisePerKg: 1 }, reason: "Cross" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await readyMaster(a);
      const orderId = await bookOrder(a, [{ sectionId: a.dieA, kg: 100 }]);
      const [line] = await lineRows(orderId);
      await expect(b.office.pricing.lines.requestOverride({ lineId: line!.id, ratePaise: 1, reason: "Cross plant" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.office.pricing.lines.overrides({ lineId: line!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      // B's master never prices A's line: B's history is empty.
      expect((await b.office.pricing.rates.history({ kind: "alloy" })).items).toEqual([]);
    },
    SLOW,
  );

  test(
    "module off: every pricing read and write is refused, even for the owner",
    async () => {
      const p = await plant({ modules: ["customers", "dies", "orders"] });
      await expect(p.owner.pricing.rates.current()).rejects.toMatchObject({ code: "FORBIDDEN", message: MOD_OFF });
      await expect(p.owner.pricing.rates.propose({ change: { kind: "alloy", alloy: "6061", paisePerKg: 1 }, reason: "Off" })).rejects.toMatchObject({ code: "FORBIDDEN", message: MOD_OFF });
      await expect(p.owner.pricing.quotes.list({})).rejects.toMatchObject({ message: MOD_OFF });
      await expect(p.owner.pricing.enquiries.list({})).rejects.toMatchObject({ message: MOD_OFF });
      await expect(p.owner.pricing.enquiries.create({ prospectName: "X" })).rejects.toMatchObject({ message: MOD_OFF });
    },
    SLOW,
  );
});

describe("line breakdown frozen at confirm", () => {
  test(
    "confirm freezes each line: 6061 + anodise = Rs 321/kg, 6063 plain = Rs 295/kg; rate and breakdown shown only to price holders",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [
        { sectionId: p.dieA, kg: 1000, finish: "anodise", ratePaise: 1 },
        { sectionId: p.dieB, kg: 500 },
      ]);
      await confirmOrder(p.owner, orderId);
      const [l1, l2] = await lineRows(orderId);
      expect(l1!.ratePaise).toBe(32_100);
      expect(l2!.ratePaise).toBe(29_500);
      const b1 = l1!.priceBreakup as unknown as PriceBreakup;
      expect(b1).toMatchObject({ v: 1, rateDate: "2026-11-15", metal: { source: "nalco", paisePerKg: 25_000, rateDate: "2026-11-01" }, conversion: { paisePerKg: 4_500, from: "default" }, alloy: { alloy: "6061", paisePerKg: 800 }, finish: { finish: "anodise", paisePerKg: 1_800 }, finalPaisePerKg: 32_100 });
      const office = await p.office.orders.get({ id: orderId });
      expect(office.lineDetails[0]).toMatchObject({ ratePaise: 32_100, priceBreakup: { finalPaisePerKg: 32_100 } });
      const packer = await p.as("packer").orders.get({ id: orderId });
      expect(packer.lineDetails[0]).not.toHaveProperty("priceBreakup");
      expect(packer.lineDetails[0]).not.toHaveProperty("ratePaise");
      const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.confirm"), eq(auditLog.subjectId, orderId))).get();
      expect(audit!.meta).toMatchObject({ pricedLines: 2, rateDate: "2026-11-15" });
    },
    SLOW,
  );

  test(
    "group and section conversions and customer terms win over the plant default; a fixed rate replaces the sum",
    async () => {
      const p = await plant();
      await readyMaster(p);
      await setRate(p, { kind: "conversion", scope: "series", series: "Slim", paisePerKg: 6_000 });
      await setRate(p, { kind: "conversion", scope: "die", sectionId: p.dieA, paisePerKg: 7_000 });
      await setRate(p, { kind: "customer", customerId: p.customerId, mode: "discount", paisePerKg: 1_000 });
      const o1 = await bookOrder(p, [{ sectionId: p.dieA, kg: 100 }, { sectionId: p.dieB, kg: 100 }]);
      await confirmOrder(p.owner, o1);
      const [a, b] = await lineRows(o1);
      expect((a!.priceBreakup as unknown as PriceBreakup).conversion.from).toBe("die");
      expect(a!.ratePaise).toBe(25_000 + 7_000 + 800 - 1_000);
      expect((b!.priceBreakup as unknown as PriceBreakup).conversion.from).toBe("series");
      expect(b!.ratePaise).toBe(25_000 + 6_000 - 1_000);
      await setRate(p, { kind: "customer", customerId: p.customerId, mode: "fixed", paisePerKg: 30_000 });
      const o2 = await bookOrder(p, [{ sectionId: p.dieA, kg: 100 }]);
      await confirmOrder(p.owner, o2);
      expect((await lineRows(o2))[0]!.ratePaise).toBe(30_000);
    },
    SLOW,
  );

  test(
    "nothing changes at confirm without a ready master, with the module off, or with rates off; an import never freezes",
    async () => {
      const bare = await plant();
      const o1 = await bookOrder(bare, [{ sectionId: bare.dieA, kg: 100, ratePaise: 31_000 }]);
      await confirmOrder(bare.owner, o1);
      expect((await lineRows(o1))[0]).toMatchObject({ ratePaise: 31_000, priceBreakup: null });

      const off = await plant({ modules: ["customers", "dies", "orders", "bundles", "dispatches"] });
      const o2 = await bookOrder(off, [{ sectionId: off.dieA, kg: 100, ratePaise: 31_000 }]);
      await confirmOrder(off.owner, o2);
      expect((await lineRows(o2))[0]).toMatchObject({ ratePaise: 31_000, priceBreakup: null });

      const noRates = await plant();
      await readyMaster(noRates);
      await env.db.update((await import("@orrn/db/schema")).company).set({ settings: { timezone: "Asia/Kolkata", priceOnSalesOrder: false } }).where(eq((await import("@orrn/db/schema")).company.id, noRates.companyId));
      const o3 = await bookOrder(noRates, [{ sectionId: noRates.dieA, kg: 100 }]);
      await confirmOrder(noRates.owner, o3);
      expect((await lineRows(o3))[0]).toMatchObject({ ratePaise: null, priceBreakup: null });

      const ready = await plant();
      await readyMaster(ready);
      const o4 = await bookOrder(ready, [{ sectionId: ready.dieA, kg: 100 }]);
      const lines = await lineRows(o4);
      const plan = await planConfirmFreeze(env.db, ready.companyId, { id: o4, customerId: ready.customerId }, lines, { at: NOON, ingest: true });
      expect(plan.priced).toBe(0);
      const live = await planConfirmFreeze(env.db, ready.companyId, { id: o4, customerId: ready.customerId }, lines, { at: NOON, ingest: false });
      expect(live.priced).toBe(1);
    },
    SLOW,
  );

  test(
    "a frozen rate cannot be typed over through orders.update",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }]);
      await confirmOrder(p.owner, orderId);
      const got = await p.office.orders.get({ id: orderId });
      const l = got.lines[0]!;
      const base = { id: l.lineId, sectionId: l.sectionId, cutLengthMm: l.cutLengthMm, kgG: l.orderedG, pcs: l.orderedPcs ?? 100, finish: l.finish, tierRank: 1 };
      await expect(p.office.orders.update({ id: orderId, serverSeq: got.order.serverSeq, lines: [{ ...base, ratePaise: 20_000 }] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This line's rate was fixed when the order was confirmed. Ask for a rate change from the order's price sheet",
      });
      // Sending the same rate (or none) is a normal edit.
      await p.office.orders.update({ id: orderId, serverSeq: got.order.serverSeq, lines: [{ ...base, ratePaise: 29_500, note: "Same rate" }] });
    },
    SLOW,
  );
});

describe("line overrides (rows 5, 9)", () => {
  test(
    "below the computed rate waits for approval; approved, the frozen line takes it with who approved; at or above applies at once",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }, { sectionId: p.dieB, kg: 50 }]);
      await confirmOrder(p.owner, orderId);
      const [l1, l2] = await lineRows(orderId);
      const ask = await p.office.pricing.lines.requestOverride({ lineId: l1!.id, ratePaise: 28_000, reason: "Matched a competitor" });
      expect(ask).toMatchObject({ status: "pending", computedPaisePerKg: 29_500 });
      expect((await lineRows(orderId))[0]!.ratePaise).toBe(29_500);
      const ap = await env.db.select().from(approval).where(eq(approval.id, ask.approvalId!)).get();
      expect(ap!.meta).toEqual({ rateKind: "line", key: l1!.id, effectiveFrom: "2026-11-15", orderId });
      const facts = await p.manager.pricing.rates.get({ id: ask.id });
      expect(facts.line).toMatchObject({ orderId, lineNo: 1, computedPaisePerKg: 29_500 });
      expect(facts.rate.paise).toBe(28_000);
      await p.manager.approval.decide({ id: ask.approvalId!, decision: "approved" });
      const after = (await lineRows(orderId))[0]!;
      expect(after.ratePaise).toBe(28_000);
      const b = after.priceBreakup as unknown as PriceBreakup;
      expect(b.finalPaisePerKg).toBe(28_000);
      expect(b.computedPaisePerKg).toBe(29_500);
      expect(b.override).toMatchObject({ ratePaise: 28_000, reason: "Matched a competitor", approvalId: ask.approvalId, approvedBy: p.users.manager.id, requestedBy: p.users.office.id });

      const up = await p.office.pricing.lines.requestOverride({ lineId: l2!.id, ratePaise: 30_000, reason: "Rush order" });
      expect(up).toMatchObject({ status: "active", approvalId: null });
      expect((await lineRows(orderId))[1]).toMatchObject({ ratePaise: 30_000 });
      expect(await p.office.pricing.lines.overrides({ lineId: l2!.id })).toHaveLength(1);
      await expect(p.as("accountant").pricing.lines.requestOverride({ lineId: l2!.id, ratePaise: 1, reason: "No right" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
    SLOW,
  );

  test(
    "an override approved on a booking applies at confirm; a rejected one never does",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }, { sectionId: p.dieB, kg: 100 }]);
      const [l1, l2] = await lineRows(orderId);
      const a = await p.office.pricing.lines.requestOverride({ lineId: l1!.id, ratePaise: 27_000, reason: "Agreed on call" });
      const b = await p.office.pricing.lines.requestOverride({ lineId: l2!.id, ratePaise: 26_000, reason: "Too low" });
      await p.manager.approval.decide({ id: a.approvalId!, decision: "approved" });
      await p.manager.approval.decide({ id: b.approvalId!, decision: "rejected" });
      await confirmOrder(p.owner, orderId);
      const [x, y] = await lineRows(orderId);
      expect(x!.ratePaise).toBe(27_000);
      expect((x!.priceBreakup as unknown as PriceBreakup).override).toMatchObject({ approvalId: a.approvalId, approvedBy: p.users.manager.id });
      expect(y!.ratePaise).toBe(29_500);
      expect((y!.priceBreakup as unknown as PriceBreakup).override).toBeNull();
    },
    SLOW,
  );
});

describe("quotes (row 10)", () => {
  test(
    "a quote is priced by the master, numbered, valid for the plant's days, refuses a rate below the master, and converts once",
    async () => {
      const p = await plant();
      await readyMaster(p);
      await setRate(p, { kind: "component", label: "Packing", basis: "order", always: true, paise: 50_000 });
      const enq = await p.office.pricing.enquiries.create({ customerId: p.customerId, sectionId: p.dieA, kgG: 1_000_000, followUpDate: "2026-11-20" });
      await expect(
        p.office.pricing.quotes.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1_000_000, pcs: 400, ratePaise: 100 }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const q = await p.office.pricing.quotes.create({
        customerId: p.customerId,
        enquiryId: enq.id,
        lines: [
          { sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1_000_000, pcs: 400, finish: "anodise" },
          { sectionId: p.dieB, cutLengthMm: 3_658, kgG: 250_000, pcs: 100, ratePaise: 40_000 },
        ],
      });
      expect(q.number).toBe("Q-1");
      const got = await p.office.pricing.quotes.get({ id: q.id });
      expect(got.quote).toMatchObject({ quoteDate: "2026-11-15", validUntil: "2026-11-30", status: "draft" });
      // Packing Rs 500 per order spread by weight: 400 to line 1 (1000 kg) -> 40 paise/kg.
      expect(got.lines[0]!.ratePaise).toBe(32_100 + 40);
      expect(got.lines[1]!.ratePaise).toBe(40_000);
      expect(got.quote.charges).toEqual([expect.objectContaining({ key: "packing", paise: 50_000 })]);
      expect((await p.office.pricing.enquiries.list({})).items[0]).toMatchObject({ status: "quoted", quoteNumber: "Q-1" });

      await p.office.pricing.quotes.setStatus({ id: q.id, status: "sent" });
      const made = await p.office.pricing.quotes.convert({ id: q.id, poNumber: "PO-77" });
      const order = await p.office.orders.get({ id: made.orderId });
      expect(order.order).toMatchObject({ status: "booking", poNumber: "PO-77", customerId: p.customerId });
      expect(order.lines).toHaveLength(2);
      expect(order.lineDetails.map((d) => d.ratePaise)).toEqual([32_140, 40_000]);
      const again = await p.office.pricing.quotes.convert({ id: q.id });
      expect(again).toMatchObject({ orderId: made.orderId, replayed: true });
      expect((await p.office.pricing.enquiries.list({})).items[0]!.status).toBe("won");
      expect((await p.office.pricing.quotes.list({ status: "converted" })).items.map((i) => i.id)).toEqual([q.id]);
    },
    SLOW,
  );

  test(
    "quote refusals: master not ready, an expired quote, roles, another plant",
    async () => {
      const p = await plant();
      await expect(p.office.pricing.quotes.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1000 }] })).rejects.toMatchObject({
        message: "Set the base metal rate and the plant conversion first",
      });
      await readyMaster(p);
      const q = await p.office.pricing.quotes.create({ customerId: p.customerId, validUntil: "2026-11-16", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1000, pcs: 1 }] });
      for (const role of ["accountant", "packer", "viewer"] as const) {
        await expect(p.as(role).pricing.quotes.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1000 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await expect(p.as("packer").pricing.quotes.get({ id: q.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const other = await plant();
      await expect(other.office.pricing.quotes.get({ id: q.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.office.pricing.quotes.convert({ id: q.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      setClockForTests(new Date("2026-11-20T06:30:00.000Z"));
      await expect(p.office.pricing.quotes.convert({ id: q.id })).rejects.toMatchObject({ message: "This quote ran out on 2026-11-16. Make a new one" });
      expect((await p.office.pricing.quotes.list({ status: "expired" })).items.map((i) => i.id)).toEqual([q.id]);
    },
    SLOW,
  );
});

describe("proforma (row 11) and works order (row 12)", () => {
  test(
    "a proforma of a confirmed order is numbered and frozen with an 18 % estimate and no bank yet; not from a booking",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 1000 }]);
      await expect(p.office.pricing.proforma.create({ source: "order", id: orderId })).rejects.toMatchObject({ message: "A proforma is made from a confirmed order" });
      await confirmOrder(p.owner, orderId);
      const pi = await p.office.pricing.proforma.create({ source: "order", id: orderId });
      expect(pi.number).toBe("PI-1");
      expect(pi.snapshot.totals).toEqual({ subtotalPaise: 29_500_000, gstBp: 1800, gstPaise: 5_310_000, totalPaise: 34_810_000 });
      expect(pi.snapshot.bank).toBeNull();
      expect(pi.snapshot.lines[0]).toMatchObject({ ratePaise: 29_500, amountPaise: 29_500_000, breakup: { metalPaisePerKg: 25_000, conversionPaisePerKg: 4_500 } });
      expect((await p.office.pricing.proforma.list({ source: "order", id: orderId })).map((r) => r.number)).toEqual(["PI-1"]);
      const other = await plant();
      await expect(other.office.pricing.proforma.get({ id: pi.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.office.pricing.proforma.create({ source: "order", id: orderId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(p.as("supervisor").pricing.proforma.create({ source: "order", id: orderId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
    SLOW,
  );

  test(
    "a proforma refuses an order line without a rate",
    async () => {
      const p = await plant();
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 10 }]);
      await confirmOrder(p.owner, orderId);
      await expect(p.office.pricing.proforma.create({ source: "order", id: orderId })).rejects.toMatchObject({ message: "Line 1 has no rate yet" });
    },
    SLOW,
  );

  test(
    "the works order shows what to make with no prices; one number per order; any member reads, planners issue",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieA, kg: 100, finish: "anodise" }]);
      await expect(p.office.pricing.worksOrder.issue({ orderId })).rejects.toMatchObject({ message: "A works order is made from a confirmed order" });
      await confirmOrder(p.owner, orderId);
      const wo = await p.office.pricing.worksOrder.issue({ orderId });
      expect(wo).toMatchObject({ number: "WO-1", replayed: false });
      expect(await p.as("manager").pricing.worksOrder.issue({ orderId })).toMatchObject({ number: "WO-1", replayed: true });
      const read = await p.as("packer").pricing.worksOrder.get({ orderId });
      expect(read.worksOrder).toMatchObject({ number: "WO-1" });
      expect(read.lines[0]).toMatchObject({ alloy: "6061", temper: "T6", finish: "anodise", kgG: 100_000 });
      expect(JSON.stringify(read)).not.toMatch(/ratePaise|priceBreakup|rate_paise/);
      await expect(p.as("packer").pricing.worksOrder.issue({ orderId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const other = await plant();
      await expect(other.office.pricing.worksOrder.get({ orderId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    },
    SLOW,
  );
});

describe("enquiries (row 19)", () => {
  test(
    "overdue follow-ups show on Today for office roles; status moves; refusals",
    async () => {
      const p = await plant();
      await expect(p.office.pricing.enquiries.create({})).rejects.toMatchObject({ message: "Name the customer or the buyer" });
      const late = await p.office.pricing.enquiries.create({ prospectName: "Shah Windows", sectionText: "Sliding track", kgG: 500_000, followUpDate: "2026-11-10" });
      await p.office.pricing.enquiries.create({ customerId: p.customerId, followUpDate: "2026-11-30" });
      const list = await p.office.pricing.enquiries.list({ overdue: true });
      expect(list.items.map((i) => i.id)).toEqual([late.id]);
      expect(list.items[0]).toMatchObject({ overdue: true, prospectName: "Shah Windows" });
      const today = await p.office.dashboard.today();
      expect(today.tiles.find((t) => t.key === "enquiries")).toEqual({ key: "enquiries", count: 1 });
      const packerToday = await p.as("packer").dashboard.today();
      expect(packerToday.tiles.find((t) => t.key === "enquiries")).toBeUndefined();
      const row = list.items[0]!;
      await p.office.pricing.enquiries.update({ id: late.id, serverSeq: row.serverSeq, status: "lost" });
      expect((await p.office.pricing.enquiries.list({ overdue: true })).items).toEqual([]);
      await expect(p.office.pricing.enquiries.update({ id: late.id, serverSeq: row.serverSeq, note: "stale" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p.as("supervisor").pricing.enquiries.create({ prospectName: "No" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p.as("packer").pricing.enquiries.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      const other = await plant();
      await expect(other.office.pricing.enquiries.update({ id: late.id, serverSeq: 0, status: "won" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      // The tile is off with the module off.
      const off = await plant({ modules: ["orders", "customers"] });
      expect((await off.office.dashboard.today()).tiles.find((t) => t.key === "enquiries")).toBeUndefined();
    },
    SLOW,
  );
});

describe("fix round 1 (review of PR #15)", () => {
  const editBase = (l: { lineId: string; sectionId: string; cutLengthMm: number; orderedG: number; orderedPcs: number | null; finish: string | null }) => ({
    id: l.lineId,
    sectionId: l.sectionId,
    cutLengthMm: l.cutLengthMm,
    kgG: l.orderedG,
    pcs: l.orderedPcs ?? 100,
    finish: l.finish,
    tierRank: 1,
  });

  test(
    "B1: a quote's rates and picked add-ons survive convert and confirm, even after the metal rate moves",
    async () => {
      const p = await plant();
      await readyMaster(p);
      await setRate(p, { kind: "component", label: "Cutting", basis: "piece", always: false, paise: 200 });
      const q = await p.office.pricing.quotes.create({
        customerId: p.customerId,
        lines: [
          { sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1_000_000, pcs: 400, finish: "anodise", componentKeys: ["cutting"] },
          { sectionId: p.dieB, cutLengthMm: 3_658, kgG: 250_000, pcs: 100, ratePaise: 40_000 },
        ],
      });
      const quoted = await p.office.pricing.quotes.get({ id: q.id });
      const quotedRates = quoted.lines.map((l) => l.ratePaise);
      // 6061 + anodise = 321, plus cutting Rs 2 x 400 pcs over 1000 kg = 80 paise per kg.
      expect(quotedRates).toEqual([32_100 + 80, 40_000]);
      // The metal list moves up from the 16th; the quote is valid to the 30th.
      await setRate(p, { kind: "metal", source: "nalco", paisePerKg: 27_000 }, "2026-11-16");
      const made = await p.office.pricing.quotes.convert({ id: q.id, poNumber: "PO-B1" });
      setClockForTests(new Date("2026-11-17T06:30:00.000Z"));
      await confirmOrder(p.owner, made.orderId);
      const [l1, l2] = await lineRows(made.orderId);
      expect([l1!.ratePaise, l2!.ratePaise]).toEqual(quotedRates);
      const b1 = l1!.priceBreakup as unknown as PriceBreakup;
      expect(b1.components.map((c) => c.key)).toEqual(["cutting"]);
      expect(b1.metal.paisePerKg).toBe(25_000);
      expect((l2!.priceBreakup as unknown as PriceBreakup).finalPaisePerKg).toBe(40_000);
    },
    SLOW,
  );

  test(
    "B1: a quoted booking line whose finish changes is priced from the master again at confirm",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const q = await p.office.pricing.quotes.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 100_000, pcs: 40, finish: "anodise", ratePaise: 40_000 }] });
      const made = await p.office.pricing.quotes.convert({ id: q.id, poNumber: "PO-B1b" });
      const got = await p.office.orders.get({ id: made.orderId });
      await p.office.orders.update({ id: made.orderId, serverSeq: got.order.serverSeq, lines: [{ ...editBase(got.lines[0]!), finish: null }] });
      expect((await lineRows(made.orderId))[0]!.priceBreakup).toBeNull();
      await confirmOrder(p.owner, made.orderId);
      expect((await lineRows(made.orderId))[0]!.ratePaise).toBe(25_000 + 4_500 + 800);
    },
    SLOW,
  );

  test(
    "B2: line rates stay behind order.price; admin keeps the master and decides master changes, not line overrides",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const admin = p.as("admin");
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }, { sectionId: p.dieB, kg: 100 }]);
      await confirmOrder(p.owner, orderId);
      const [l1, l2] = await lineRows(orderId);
      const ask = await p.office.pricing.lines.requestOverride({ lineId: l1!.id, ratePaise: 28_000, reason: "Matched a competitor" });
      const DENY = { code: "FORBIDDEN" };
      await expect(admin.pricing.rates.get({ id: ask.id })).rejects.toMatchObject(DENY);
      await expect(admin.pricing.rates.history({ kind: "line" })).rejects.toMatchObject(DENY);
      await expect(admin.pricing.lines.overrides({ lineId: l1!.id })).rejects.toMatchObject(DENY);
      await expect(admin.pricing.lines.requestOverride({ lineId: l2!.id, ratePaise: 40_000, reason: "Admin raise" })).rejects.toMatchObject(DENY);
      expect((await lineRows(orderId))[1]!.ratePaise).toBe(29_500);
      const pi = await p.office.pricing.proforma.create({ source: "order", id: orderId });
      await expect(admin.pricing.proforma.get({ id: pi.id })).rejects.toMatchObject(DENY);
      await expect(admin.pricing.proforma.list({ source: "order", id: orderId })).rejects.toMatchObject(DENY);
      // A line override is decided only by someone who holds order.price.
      await expect(admin.approval.decide({ id: ask.approvalId!, decision: "approved" })).rejects.toMatchObject(DENY);
      expect((await lineRows(orderId))[0]!.ratePaise).toBe(29_500);
      await p.owner.approval.decide({ id: ask.approvalId!, decision: "approved" });
      expect((await lineRows(orderId))[0]!.ratePaise).toBe(28_000);
      // The master stays admin's: it reads rows and decides a master change.
      const m = await p.office.pricing.rates.propose({ change: { kind: "alloy", alloy: "6082", paisePerKg: 900 }, reason: "6082" });
      expect((await admin.pricing.rates.get({ id: m.id })).rate.paise).toBe(900);
      await admin.approval.decide({ id: m.approvalId, decision: "approved" });
      // Audit reads: the money in line-rate rows is hidden from admin, shown to the manager.
      const adminAudit = await admin.audit.list({ action: "price.override.request" });
      expect(adminAudit.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(adminAudit.items.map((i) => i.meta))).not.toMatch(/ratePaise|computedPaisePerKg|28000|29500/);
      const mgrAudit = await p.manager.audit.list({ action: "price.override.request" });
      expect(mgrAudit.items[0]!.meta).toMatchObject({ ratePaise: 28_000 });
      const piAudit = await admin.audit.list({ action: "proforma.create" });
      expect(piAudit.items[0]!.meta).not.toHaveProperty("totalPaise");
    },
    SLOW,
  );

  test(
    "S1: a line added after confirm is priced and frozen on add; delete and re-add can't bypass; a product change on a frozen line is refused",
    async () => {
      const p = await plant();
      await readyMaster(p);
      await setRate(p, { kind: "component", label: "Packing", basis: "order", always: true, paise: 50_000 });
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 1000 }]);
      await confirmOrder(p.owner, orderId);
      expect((await lineRows(orderId))[0]!.ratePaise).toBe(29_500 + 50);
      let got = await p.office.orders.get({ id: orderId });
      // Added with a typed Rs 250: priced from the master instead, without charging packing again.
      await p.office.orders.update({
        id: orderId,
        serverSeq: got.order.serverSeq,
        lines: [editBase(got.lines[0]!), { sectionId: p.dieB, cutLengthMm: 3_658, kgG: 500_000, pcs: 100, finish: null, tierRank: 1, ratePaise: 25_000 }],
      });
      let rows = await lineRows(orderId);
      expect(rows[1]!.ratePaise).toBe(29_500);
      expect((rows[1]!.priceBreakup as unknown as PriceBreakup).finalPaisePerKg).toBe(29_500);
      // Delete line 1 and add the same section back at Rs 250.
      got = await p.office.orders.get({ id: orderId });
      await p.office.orders.update({
        id: orderId,
        serverSeq: got.order.serverSeq,
        lines: [editBase(got.lines[1]!), { sectionId: p.dieB, cutLengthMm: 3_658, kgG: 1_000_000, pcs: 100, finish: null, tierRank: 1, ratePaise: 25_000 }],
      });
      rows = await lineRows(orderId);
      expect(rows.map((r) => r.ratePaise)).toEqual([29_500, 29_500]);
      // A finish change on a frozen line is refused.
      got = await p.office.orders.get({ id: orderId });
      await expect(
        p.office.orders.update({ id: orderId, serverSeq: got.order.serverSeq, lines: got.lines.map((l, i) => (i === 0 ? { ...editBase(l), finish: "anodise" } : editBase(l))) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This line's price was fixed when the order was confirmed. Add a new line for a different section, alloy or finish" });
      // The master stops being ready (metal list switched to an empty one): an added line is refused, not left unpriced.
      await p.manager.pricing.settings.update({ metalSource: "manual" });
      got = await p.office.orders.get({ id: orderId });
      await expect(
        p.office.orders.update({ id: orderId, serverSeq: got.order.serverSeq, lines: [...got.lines.map(editBase), { sectionId: p.dieA, cutLengthMm: 3_658, kgG: 100_000, pcs: 10, finish: null, tierRank: 1 }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This line can't be priced from the master today. Set the base metal rate and the plant conversion first" });
    },
    SLOW,
  );

  test(
    "S2: an unapproved override below the confirm-day rate is not frozen; a confirmed line never frozen refuses an override",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }]);
      const [l] = await lineRows(orderId);
      const ask = await p.office.pricing.lines.requestOverride({ lineId: l!.id, ratePaise: 29_500, reason: "Same as today" });
      expect(ask.status).toBe("active");
      await setRate(p, { kind: "metal", source: "nalco", paisePerKg: 27_000 }, "2026-11-16");
      setClockForTests(new Date("2026-11-16T06:30:00.000Z"));
      await confirmOrder(p.owner, orderId);
      const after = (await lineRows(orderId))[0]!;
      expect(after.ratePaise).toBe(31_500);
      expect((after.priceBreakup as unknown as PriceBreakup).override).toBeNull();

      const bare = await plant();
      const o2 = await bookOrder(bare, [{ sectionId: bare.dieB, kg: 100, ratePaise: 31_000 }]);
      await confirmOrder(bare.owner, o2);
      await readyMaster(bare);
      const [b] = await lineRows(o2);
      await expect(bare.office.pricing.lines.requestOverride({ lineId: b!.id, ratePaise: 40_000, reason: "Raise it" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This line was confirmed without a price from the master. Change its rate on the order",
      });
      expect((await lineRows(o2))[0]!.ratePaise).toBe(31_000);
    },
    SLOW,
  );

  test(
    "S3: changing the metal list needs a price_change approver; other settings stay with price.manage",
    async () => {
      const p = await plant();
      await expect(p.office.pricing.settings.update({ metalSource: "manual" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await p.office.pricing.settings.update({ metalSource: "nalco", estimatedGstBp: 1200 });
      expect((await p.office.pricing.settings.get()).metalSource).toBe("nalco");
      await p.as("admin").pricing.settings.update({ metalSource: "manual" });
      expect((await p.office.pricing.settings.get()).metalSource).toBe("manual");
    },
    SLOW,
  );

  test(
    "S4: with the module off, an order.price holder corrects a frozen line's rate on the order (audited)",
    async () => {
      const p = await plant();
      await readyMaster(p);
      const orderId = await bookOrder(p, [{ sectionId: p.dieB, kg: 100 }]);
      await confirmOrder(p.owner, orderId);
      const { company } = await import("@orrn/db/schema");
      await env.db.update(company).set({ modules: ["customers", "dies", "orders", "bundles", "dispatches"] }).where(eq(company.id, p.companyId));
      const got = await p.office.orders.get({ id: orderId });
      await p.office.orders.update({ id: orderId, serverSeq: got.order.serverSeq, lines: [{ ...editBase(got.lines[0]!), ratePaise: 31_000 }] });
      const row = (await lineRows(orderId))[0]!;
      expect(row.ratePaise).toBe(31_000);
      expect((row.priceBreakup as unknown as PriceBreakup)).toMatchObject({ finalPaisePerKg: 31_000, computedPaisePerKg: 29_500, override: { ratePaise: 31_000, requestedBy: p.users.office.id } });
      const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.rate.correct"))).get();
      expect(audit!.meta).toMatchObject({ orderId, lineId: row.id, fromPaise: 29_500, toPaise: 31_000 });
    },
    SLOW,
  );
});
