/**
 * XE-BILL rows 13, 14, 15, 97: tax invoice from frozen packing lists, gap-free FY numbering, cancel by
 * approval (number stays used), credit notes, payments and outstanding, Tally / register exports, and the
 * IRN status machine against the fake IRP adapter. Opt-in modules: a plant without `billing` gets FORBIDDEN.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, billingEvent, company, customer, dispatch, docSeries, invoice, packingList, salesOrderLine } from "@orrn/db/schema";
import { computeInvoice, decodeSignedInvoice, gstinCheckDigit, STANDARD_MODULES } from "@orrn/domain";
import { and, eq, sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
let lib: {
  setClock: (at: Date | null) => void;
  setAdapter: typeof import("../src/lib/billing/irp").setIrpAdapterForTests;
  fakeAdapter: typeof import("../src/lib/billing/irp").fakeIrpAdapter;
  runIrnCron: typeof import("../src/lib/billing/einvoiceFlow").runIrnCron;
  issueStatements: typeof import("../src/lib/billing/numbering").issueStatements;
  isBillingAbort: typeof import("../src/lib/billing/numbering").isBillingAbort;
  atomicBatch: typeof import("../src/lib/atomic").atomicBatch;
};
beforeAll(async () => {
  env = await createTestEnv();
  const irp = await import("../src/lib/billing/irp");
  const numbering = await import("../src/lib/billing/numbering");
  lib = {
    setClock: (await import("../src/lib/clock")).setClockForTests,
    setAdapter: irp.setIrpAdapterForTests,
    fakeAdapter: irp.fakeIrpAdapter,
    runIrnCron: (await import("../src/lib/billing/einvoiceFlow")).runIrnCron,
    issueStatements: numbering.issueStatements,
    isBillingAbort: numbering.isBillingAbort,
    atomicBatch: (await import("../src/lib/atomic")).atomicBatch,
  };
}, 60_000);
afterAll(async () => {
  await env.dispose();
});
afterEach(() => {
  lib.setClock(null);
  lib.setAdapter(undefined);
});

const { plant, dispatchRow, plRow } = salesHelpers(() => env);
const portal = portalHelpers(() => env);
const gstin = (first14: string) => first14 + gstinCheckDigit(first14);
const PLANT_GSTIN = gstin("24AAACF1234A1Z");
const PARTY_GSTIN = gstin("24ABCDE1234F1Z");
/** 2026-10-03 12:00 IST (FY 2026-27). */
const OCT = new Date("2026-10-03T06:30:00.000Z");

/** A plant on billing (optionally e-invoice) with GST settings, the HSN seed, and valid GSTINs. */
async function billingPlant(modules: string[] = ["billing"]): Promise<SalesPlant> {
  const p = await plant({ settings: { portalEnabled: true, letterhead: { legalName: "Fourcubes Aluminium Pvt Ltd", gstin: PLANT_GSTIN, address: "Plot 12, GIDC, Surat", phone: "+91 98250 00000" } } });
  await env.db.update(company).set({ modules }).where(eq(company.id, p.companyId));
  await env.db.update(customer).set({ taxId: PARTY_GSTIN }).where(eq(customer.id, p.customerId));
  await p.as("admin").billing.settings.save({ stateCode: "24", pincode: "394230", place: "Surat" });
  await p.as("admin").billing.hsn.seedDefaults();
  return p;
}

/** A completed dispatch of `kgs` bundles on one order line at `ratePaise`/kg; returns its PL id. */
async function completedPl(p: SalesPlant, kgs: number[], ratePaise = 24_550): Promise<{ plId: string; dispatchId: string; lineId: string }> {
  lib.setClock(OCT);
  const o = await p.order([{ dieId: p.dieA, kg: kgs.reduce((a, b) => a + b, 0) }], { status: "confirmed" });
  const lineId = o.lineIds[0]!;
  await env.db.update(salesOrderLine).set({ ratePaise }).where(eq(salesOrderLine.id, lineId));
  const serials = await p.pack(p.dieA, kgs.map((k) => ({ kg: k })), lineId);
  const dispatchId = await p.held(serials);
  await p.owner.dispatch.complete({ id: dispatchId });
  const pl = await plRow(dispatchId);
  return { plId: pl!.id, dispatchId, lineId };
}

async function issued(p: SalesPlant, plIds: string[]) {
  const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: plIds });
  const out = await p.as("office").billing.invoices.issue({ id });
  return { ...out, id };
}

describe("module and permission gate", () => {
  test("a plant without billing is refused, reads included", async () => {
    const p = await plant();
    await expect(p.owner.billing.invoices.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.billing.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.billing.hsn.seedDefaults()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.einvoice.relayStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("einvoice needs its own module on top of billing", async () => {
    const p = await billingPlant(["billing"]);
    await expect(p.owner.einvoice.relayStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const q = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    await expect(q.owner.einvoice.relayStatus()).resolves.toEqual({ configured: false });
  }, SLOW);

  test("floor roles and the viewer cannot read or issue invoices", async () => {
    const p = await billingPlant();
    await expect(p.as("packer").billing.invoices.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("viewer").billing.invoices.createDraft({ packingListIds: ["x"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("supervisor").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-03", amountPaise: 100, mode: "cash" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("packer").billing.settings.save({ stateCode: "24", pincode: "394230", place: "Surat" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});

describe("GST relay authority (review S2)", () => {
  test("the Worker signs as the invoice's plant (tenant key); the GSTIN only rides in the body", async () => {
    const { relayIrpAdapter } = await import("../src/lib/billing/irp");
    const { relayTenantKey, verifyRelaySignature } = await import("@orrn/domain");
    const master = "m".repeat(40);
    const seen: { headers: Headers; body: string }[] = [];
    const fetchStub = (async (_url: string, init: RequestInit) => {
      seen.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response(JSON.stringify({ ok: false, code: "2283", message: "not found", retryable: false }));
    }) as unknown as typeof fetch;
    const adapter = relayIrpAdapter({ url: "https://relay.example", secret: master, fetch: fetchStub });
    await adapter.irnByDocument({ companyId: "plant-a", gstin: PLANT_GSTIN }, { docType: "INV", docNo: "INV/26-27/1", docDate: "03/10/2026" });
    const sent = seen[0]!;
    expect(sent.headers.get("x-orrn-tenant")).toBe("plant-a");
    expect(JSON.parse(sent.body)).toMatchObject({ gstin: PLANT_GSTIN });
    const req = { method: "POST", path: "/v1/irn/by-document", body: sent.body, headers: sent.headers };
    expect((await verifyRelaySignature(await relayTenantKey(master, "plant-a"), req)).ok).toBe(true);
    // Another plant's key does not verify it: a plant cannot borrow another's authority.
    expect((await verifyRelaySignature(await relayTenantKey(master, "plant-b"), req)).ok).toBe(false);
  });
});

describe("effective modules (review B1)", () => {
  test("a plant on [] that ticks billing in Godseye keeps every floor module, in auth.me and on the server", async () => {
    const { companyId } = await env.seedCompany({ modules: [] });
    const staff = env.caller({ platformRole: "admin" });
    // Godseye: every floor box ticked plus Billing saves the compact list.
    await staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["billing"] });
    const stored = await env.db.select({ modules: company.modules }).from(company).where(eq(company.id, companyId)).get();
    expect(stored!.modules).toEqual(["billing"]);
    const owner = env.caller({ role: "owner", companyId });
    const me = await owner.auth.me();
    expect(me.company?.modules).toEqual([...STANDARD_MODULES, "billing"]);
    // An old phone's rule ("empty = all on, else includes") over that list keeps every floor tab.
    for (const m of STANDARD_MODULES) expect(me.company!.modules.includes(m)).toBe(true);
    expect((await owner.company.getSettings()).modules).toEqual([...STANDARD_MODULES, "billing"]);
    // The server agrees: floor modules are on, einvoice is not.
    const gate = await import("../src/lib/moduleGate");
    for (const m of STANDARD_MODULES) await gate.assertModule({ db: env.db, companyId }, m);
    await expect(gate.assertModule({ db: env.db, companyId }, "einvoice")).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});

describe("GST settings (row 14)", () => {
  test("pincode must be in the state; HSN seed is 7604 default, 7608, 7610 at 18% and editable", async () => {
    const p = await billingPlant();
    await expect(p.as("admin").billing.settings.save({ stateCode: "24", pincode: "400001", place: "Surat" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const hsn = await p.owner.billing.hsn.list();
    expect(hsn.map((h) => [h.code, h.rateBp, h.isDefault])).toEqual([
      ["7604", 1800, true],
      ["7608", 1800, false],
      ["7610", 1800, false],
    ]);
    const h7610 = hsn.find((h) => h.code === "7610")!;
    await p.as("accountant").billing.hsn.save({ id: h7610.id, code: "7610", description: "Structures", rateBp: 1800, uqc: "KGS", isDefault: true });
    expect((await p.owner.billing.hsn.list()).filter((h) => h.isDefault).map((h) => h.code)).toEqual(["7610"]);
    expect((await p.owner.billing.settings.get()).ready).toBe(true);
  }, SLOW);

  test("customer GST card: ship-to party, and another plant's customer is not found", async () => {
    const p = await billingPlant();
    await p.as("office").billing.party.save({ customerId: p.customerId, taxCategory: "regular", shipToKind: "party", shipToCustomerId: p.otherCustomer, pincode: "394210", place: "Surat" });
    const got = await p.owner.billing.party.get({ customerId: p.customerId });
    expect(got).toMatchObject({ shipToKind: "party", shipToCustomerId: p.otherCustomer, gstinProblem: null });
    const q = await billingPlant();
    await expect(q.owner.billing.party.get({ customerId: p.customerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);
});

describe("tax invoice (row 13)", () => {
  test("issue: lines are kg x rate, intra-state CGST+SGST, number INV/26-27/1, shown on dispatch and PL", async () => {
    const p = await billingPlant();
    const { plId, dispatchId } = await completedPl(p, [600.25, 634.317]);
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(plId);
    const preview = await p.as("office").billing.invoices.preview({ packingListIds: [plId] });
    expect(preview.missing).toEqual([]);
    const inv = await issued(p, [plId]);
    expect(inv).toMatchObject({ status: "issued", number: "INV/26-27/1", irnStatus: "none" });
    const got = await p.owner.billing.invoices.get({ id: inv.id });
    const expected = computeInvoice(
      [{ key: "k", description: "x", hsn: "7604", uqc: "KGS", gstRateBp: 1800, kind: "weight", weightG: 1_234_567, ratePaise: 24_550 }],
      "intra",
    );
    expect(got.snapshot.supplyType).toBe("intra");
    expect(got.snapshot.totals).toMatchObject({ taxablePaise: 30_308_620, cgstPaise: 2_727_776, sgstPaise: 2_727_776, igstPaise: 0, roundOffPaise: 28, totalPaise: 35_764_200 });
    expect(got.snapshot.totals.totalPaise).toBe(expected.totalPaise);
    expect(got.snapshot.amountInWords).toContain("Three Lakh Fifty Seven Thousand Six Hundred Forty Two");
    expect(await dispatchRow(dispatchId)).toMatchObject({ invoiceNumber: "INV/26-27/1", invoiceDate: "2026-10-03" });
    const pl = (await plRow(dispatchId))!.snapshot as { header: { invoiceNumber: string; invoiceDate: string } };
    expect(pl.header).toMatchObject({ invoiceNumber: "INV/26-27/1", invoiceDate: "2026-10-03" });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).not.toContain(plId);

    const second = await issued(p, [(await completedPl(p, [10])).plId]);
    expect(second.number).toBe("INV/26-27/2");
  }, SLOW);

  test("a packing list goes on one live invoice only; another plant's list is not found", async () => {
    const p = await billingPlant();
    const { plId } = await completedPl(p, [50]);
    await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    await expect(p.as("office").billing.invoices.createDraft({ packingListIds: [plId] })).rejects.toMatchObject({ code: "CONFLICT" });
    const q = await billingPlant();
    await expect(q.as("office").billing.invoices.createDraft({ packingListIds: [plId] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = (await p.owner.billing.invoices.list({ limit: 10 }))[0]!;
    await expect(q.owner.billing.invoices.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(q.as("office").billing.invoices.issue({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  test("missing GST facts block the draft with plant words", async () => {
    const p = await billingPlant();
    const { plId } = await completedPl(p, [20]);
    await env.db.update(customer).set({ taxId: "24ABCDE1234F1Z0" }).where(eq(customer.id, p.customerId));
    const preview = await p.as("office").billing.invoices.preview({ packingListIds: [plId] });
    expect(preview.missing).toContain("party_gstin");
    await expect(p.as("office").billing.invoices.createDraft({ packingListIds: [plId] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, SLOW);

  test("a refused issue batch rolls the series back: no gap", async () => {
    const p = await billingPlant();
    const { plId } = await completedPl(p, [30]);
    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    const before = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "invoice")));
    const statements = lib.issueStatements(env.db, {
      companyId: p.companyId,
      invoiceId: id,
      kind: "invoice",
      period: "2026-27",
      invoiceDate: "2026-10-03",
      status: "issued",
      userId: p.users.owner.id,
      seq: 999_999,
      at: Date.now(),
      irnStatus: "none",
      guard: sql`0`,
    });
    const err = await lib.atomicBatch(env.db, statements).catch((e: unknown) => e);
    expect(lib.isBillingAbort(err)).toBe(true);
    const after = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "invoice")));
    expect(after).toEqual(before);
    lib.setClock(OCT);
    expect((await p.as("office").billing.invoices.issue({ id })).number).toBe("INV/26-27/1");
  }, SLOW);

  test("a regenerated packing list cannot be issued from the old draft", async () => {
    const p = await billingPlant();
    const { plId } = await completedPl(p, [30]);
    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    await env.db.update(packingList).set({ combinedIntoId: crypto.randomUUID() }).where(eq(packingList.id, plId));
    await expect(p.as("office").billing.invoices.issue({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, id)))[0]).toMatchObject({ status: "draft", number: null });
  }, SLOW);

  test("numbers restart each financial year", async () => {
    const p = await billingPlant();
    expect((await issued(p, [(await completedPl(p, [10])).plId])).number).toBe("INV/26-27/1");
    const { plId } = await completedPl(p, [10]);
    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    lib.setClock(new Date("2027-04-01T06:30:00.000Z"));
    expect((await p.as("office").billing.invoices.issue({ id })).number).toBe("INV/27-28/1");
  }, SLOW);

  test("cancel needs approval; the number stays used and the list is billable again", async () => {
    const p = await billingPlant();
    const { plId, dispatchId } = await completedPl(p, [40]);
    const inv = await issued(p, [plId]);
    const { approvalId } = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong rate" });
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.as("office").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    const got = await p.owner.billing.invoices.get({ id: inv.id });
    expect(got).toMatchObject({ status: "cancelled", number: "INV/26-27/1", cancel: { reason: "Wrong rate" } });
    expect(await dispatchRow(dispatchId)).toMatchObject({ invoiceNumber: null, invoiceDate: null });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(plId);
    expect((await issued(p, [plId])).number).toBe("INV/26-27/2");
  }, SLOW);

  test("cancel is refused while a payment is recorded against the invoice", async () => {
    const p = await billingPlant();
    const inv = await issued(p, [(await completedPl(p, [10])).plId]);
    await p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-04", amountPaise: 1000_00, mode: "neft", reference: "UTR1", allocations: [{ invoiceId: inv.id, amountPaise: 1000_00 }] });
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("credit note against an invoice: own series, capped at the invoice", async () => {
    const p = await billingPlant();
    const inv = await issued(p, [(await completedPl(p, [100])).plId]);
    const total = (await p.owner.billing.invoices.get({ id: inv.id })).snapshot.totals.totalPaise;
    await expect(
      p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: inv.id, reason: "rate_difference", lines: [{ kind: "amount", description: "Rate", amountPaise: total }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { id } = await p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: inv.id, reason: "rate_difference", note: "Rs 2/kg", lines: [{ kind: "weight", description: "Rate difference", weightG: 100_000, ratePaise: 200 }] });
    const cn = await p.as("office").billing.invoices.issue({ id });
    expect(cn).toMatchObject({ number: "CN/26-27/1", status: "issued" });
    const got = await p.owner.billing.invoices.get({ id: inv.id });
    expect(got.creditedPaise).toBeGreaterThan(0);
    expect(got.outstandingPaise).toBe(total - got.creditedPaise);
  }, SLOW);

  test("a dispatch on a live orrn invoice refuses a typed Tally number", async () => {
    const p = await billingPlant();
    const { plId, dispatchId } = await completedPl(p, [10]);
    await issued(p, [plId]);
    await expect(p.as("office").dispatch.update({ id: dispatchId, invoiceNumber: "T/9" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await dispatchRow(dispatchId)).toMatchObject({ invoiceNumber: "INV/26-27/1" });
  }, SLOW);

  test("the party's portal shows the invoice number and date once issued", async () => {
    const p = await billingPlant();
    const { plId, dispatchId } = await completedPl(p, [10]);
    const party = await portal.partyLogin(p);
    expect((await party.api.portal.dispatches.get({ id: dispatchId })).invoiceNumber).toBeNull();
    await issued(p, [plId]);
    const row = (await party.api.portal.dispatches.list()).items.find((d) => d.id === dispatchId)!;
    expect(row).toMatchObject({ invoiceNumber: "INV/26-27/1", invoiceDate: "2026-10-03" });
    expect(await party.api.portal.dispatches.get({ id: dispatchId })).toMatchObject({ invoiceNumber: "INV/26-27/1" });
  }, SLOW);

  test("plants not on billing keep the Tally invoice number link", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 10 }], { status: "confirmed" });
    const id = await p.held(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]));
    await p.owner.dispatch.complete({ id });
    await p.as("office").dispatch.update({ id, invoiceNumber: "T/123", invoiceDate: "2026-10-03" });
    expect(await dispatchRow(id)).toMatchObject({ invoiceNumber: "T/123" });
  }, SLOW);

  test("billing switched on later: a dispatch already invoiced in Tally is not billable, and issue never overwrites it (S3)", async () => {
    const p = await billingPlant();
    const tallied = await completedPl(p, [300]);
    await p.as("office").dispatch.update({ id: tallied.dispatchId, invoiceNumber: "T/77", invoiceDate: "2026-10-01" });
    const fresh = await completedPl(p, [200]);
    const billable = (await p.as("office").billing.invoices.billable({})).map((r) => r.id);
    expect(billable).toContain(fresh.plId);
    expect(billable).not.toContain(tallied.plId);
    await expect(p.as("office").billing.invoices.createDraft({ packingListIds: [tallied.plId] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A number typed after the draft (the draft was made, then Tally was used) refuses the issue; the number stays.
    const later = await completedPl(p, [100]);
    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [later.plId] });
    await env.db.update(dispatch).set({ invoiceNumber: "T/78" }).where(eq(dispatch.id, later.dispatchId));
    await expect(p.as("office").billing.invoices.issue({ id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("T/78") });
    expect(await dispatchRow(later.dispatchId)).toMatchObject({ invoiceNumber: "T/78" });
    expect(await dispatchRow(tallied.dispatchId)).toMatchObject({ invoiceNumber: "T/77" });
  }, SLOW);
});

describe("payments and outstanding (row 97)", () => {
  test("part payment, ageing buckets, statement, Tally and the GST register", async () => {
    const p = await billingPlant();
    const a = await issued(p, [(await completedPl(p, [100])).plId]);
    const aTotal = (await p.owner.billing.invoices.get({ id: a.id })).snapshot.totals.totalPaise;
    await expect(
      p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-05", amountPaise: aTotal + 100, mode: "neft", allocations: [{ invoiceId: a.id, amountPaise: aTotal + 100 }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const pay = await p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-05", amountPaise: 10_000_00, mode: "upi", reference: "UPI9", allocations: [{ invoiceId: a.id, amountPaise: 10_000_00 }] });
    expect(pay.number).toBe("PAY-1");
    const out = await p.owner.billing.receivables.outstanding({ asOf: "2026-12-10" });
    const row = out.rows.find((r) => r.customerId === p.customerId)!;
    expect(row.invoicesDuePaise).toBe(aTotal - 10_000_00);
    expect(row.buckets.d61_90).toBe(aTotal - 10_000_00);
    const st = await p.owner.billing.receivables.statement({ customerId: p.customerId, from: "2026-10-01", to: "2026-10-31" });
    expect(st.lines.map((l) => l.kind)).toEqual(["invoice", "payment"]);
    expect(st.closingPaise).toBe(aTotal - 10_000_00);
    const tally = await p.as("accountant").billing.export.tally({ month: "2026-10" });
    expect(tally.xml).toContain('VCHTYPE="Sales"');
    expect(tally.xml).toContain('VCHTYPE="Receipt"');
    expect(tally.xml).toContain("INV/26-27/1");
    const reg = await p.as("accountant").billing.export.salesRegister({ month: "2026-10" });
    expect(reg.csv.split("\n")[1]).toContain("INV/26-27/1");
    await p.as("accountant").billing.payments.void({ id: pay.id, reason: "Bounced" });
    const after = (await p.owner.billing.receivables.outstanding({ asOf: "2026-12-10" })).rows.find((r) => r.customerId === p.customerId)!;
    expect(after.invoicesDuePaise).toBe(aTotal);
    const q = await billingPlant();
    await expect(q.owner.billing.receivables.statement({ customerId: p.customerId, from: "2026-10-01", to: "2026-10-31" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(q.as("accountant").billing.payments.void({ id: pay.id, reason: "x x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);
});

describe("e-invoice (row 15)", () => {
  test("relay not configured: the invoice stays IRN pending, never issued, and stays out of the e-way bill file (S5)", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    expect(inv).toMatchObject({ status: "irn_pending", irnStatus: "pending", number: "INV/26-27/1" });
    await expect(p.as("office").einvoice.generate({ id: inv.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // Review S5: an invoice still waiting for its IRN never goes in the e-way bill file.
    await expect(p.as("office").billing.export.ewbJson({ invoiceIds: [inv.id], distanceKm: 120, vehicleNo: "GJ05AB1234" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The file still works with no relay for an invoice that needs no IRN (a plant on billing only).
    const q = await billingPlant(["billing"]);
    const plain = await issued(q, [(await completedPl(q, [300])).plId]);
    expect(plain.status).toBe("issued");
    const file = await q.as("office").billing.export.ewbJson({ invoiceIds: [plain.id], distanceKm: 120, vehicleNo: "GJ05AB1234" });
    const parsed = JSON.parse(file.json) as { billLists: { docNo: string }[] };
    expect(parsed.billLists[0]!.docNo).toBe("INV/26-27/1");
  }, SLOW);

  test("fake IRP: generated on issue, signed invoice kept", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => OCT);
    lib.setAdapter(fake);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    expect(inv).toMatchObject({ status: "issued", irnStatus: "generated" });
    const [row] = await env.db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(row!.irn).toHaveLength(64);
    expect(decodeSignedInvoice(row!.signedInvoice!)?.irn).toBe(row!.irn!);
  }, SLOW);

  test("duplicate IRN (2150) is recovered from the IRP by document, not left failed", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    const fake = lib.fakeAdapter(() => OCT);
    // An earlier call landed at the IRP but its answer was lost.
    const first = await fake.generateIrn({ companyId: p.companyId, gstin: PLANT_GSTIN }, { DocDtls: { Typ: "INV", No: inv.number, Dt: "03/10/2026" } });
    lib.setAdapter(fake);
    await expect(p.as("office").einvoice.generate({ id: inv.id })).resolves.toEqual({ outcome: "generated" });
    const [row] = await env.db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(row).toMatchObject({ status: "issued", irnStatus: "generated", irn: first.ok ? first.data.Irn : "x" });
    expect(fake.script.calls.map((c) => c.op)).toEqual(["generate", "generate", "byDocument"]);
  }, SLOW);

  test("S7: a refused IRN is tried again with the fixed party details, same number, with an audit row", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    await p.as("office").billing.party.save({ customerId: p.customerId, taxCategory: "regular", shipToKind: "same", pincode: "394210", place: "Surat" });
    const fake = lib.fakeAdapter(() => OCT, { calls: [], failGenerate: { times: 1, response: { ok: false, code: "2172", message: "Invalid buyer pincode", retryable: false } } });
    lib.setAdapter(fake);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    expect(inv).toMatchObject({ status: "irn_pending", irnStatus: "failed" });
    await p.as("office").billing.party.save({ customerId: p.customerId, taxCategory: "regular", shipToKind: "same", pincode: "395003", place: "Surat" });
    const out = await p.as("office").einvoice.generate({ id: inv.id });
    expect(out.outcome).toBe("generated");
    const row = (await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]!;
    expect(row).toMatchObject({ status: "issued", irnStatus: "generated", number: inv.number });
    expect((row.snapshot as { party: { pincode: string } }).party.pincode).toBe("395003");
    const sent = fake.script.calls.filter((c) => c.op === "generate").map((c) => (c.body as { BuyerDtls: { Pin: number }; DocDtls: { No: string } }));
    expect(sent.map((b) => b.BuyerDtls.Pin)).toEqual([394210, 395003]);
    expect(sent.map((b) => b.DocDtls.No)).toEqual([inv.number!, inv.number!]);
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "invoice.irn.refresh")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ changed: ["party"] });
  }, SLOW);

  test("S7: a fix that moves the tax (another state) is refused; the IRN stays failed", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => OCT, { calls: [], failGenerate: { times: 1, response: { ok: false, code: "2172", message: "Invalid buyer pincode", retryable: false } } });
    lib.setAdapter(fake);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    await env.db.update(customer).set({ taxId: gstin("27ABCDE1234F1Z") }).where(eq(customer.id, p.customerId));
    await p.as("office").billing.party.save({ customerId: p.customerId, taxCategory: "regular", shipToKind: "same", stateCode: "27", pincode: "400001", place: "Mumbai" } as never);
    await expect(p.as("office").einvoice.generate({ id: inv.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("change the tax") });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ irnStatus: "failed" });
  }, SLOW);

  test("retryable failure: auto retry, then the cron generates it", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => OCT, { calls: [], failGenerate: { times: 1, response: { ok: false, code: "relay_unreachable", message: "down", retryable: true } } });
    lib.setAdapter(fake);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    expect(inv).toMatchObject({ status: "irn_pending", irnStatus: "auto_retry" });
    // Not due yet: the cron leaves it (other plants' rows in this shared database may be tried).
    await lib.runIrnCron(env.db, fake, Date.now());
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ irnStatus: "auto_retry", irnAttempts: 1 });
    await lib.runIrnCron(env.db, fake, Date.now() + 6 * 60_000);
    const [row] = await env.db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(row).toMatchObject({ status: "issued", irnStatus: "generated" });
  }, SLOW);

  test("cancel after 24 h of the IRN, or with a live e-way bill, is refused", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(lib.fakeAdapter(() => OCT));
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    await p.as("office").einvoice.ewbGenerate({ id: inv.id, distanceKm: 250, vehicleNo: "GJ05AB1234" });
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cancel the e-way bill first" });
    await env.db.update(invoice).set({ ewbStatus: "cancelled", irnGeneratedAt: new Date(OCT.getTime() - 25 * 3600_000) }).where(eq(invoice.id, inv.id));
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const pending = await env.db.select().from(approval).where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "invoice_cancel")));
    expect(pending).toEqual([]);
    expect((await env.db.select().from(dispatch).where(eq(dispatch.companyId, p.companyId))).length).toBeGreaterThan(0);
  }, SLOW);
});

describe("procedure coverage (review round)", () => {
  test("hsn.assign over 25 sections (chunked insert), back to default, and another plant's section is not found", async () => {
    const p = await billingPlant();
    const tag = crypto.randomUUID().slice(0, 6);
    const dieIds: string[] = [];
    for (let i = 0; i < 30; i += 1) dieIds.push(await env.seedDie(p.companyId, { series: "Bulk", sectionCode: `B${tag}${i}`, name: null }));
    const h7608 = (await p.owner.billing.hsn.list()).find((h) => h.code === "7608")!;
    await p.as("admin").billing.hsn.assign({ dieIds, hsnId: h7608.id });
    expect((await p.owner.billing.hsn.list()).find((h) => h.code === "7608")!.sections).toBe(30);
    await p.as("admin").billing.hsn.assign({ dieIds, hsnId: null });
    expect((await p.owner.billing.hsn.list()).find((h) => h.code === "7608")!.sections).toBe(0);
    const q = await billingPlant();
    await expect(q.as("admin").billing.hsn.assign({ dieIds: [dieIds[0]!], hsnId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.as("packer").billing.hsn.assign({ dieIds, hsnId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("discard frees the packing list; an issued invoice cannot be discarded", async () => {
    const p = await billingPlant();
    const { plId } = await completedPl(p, [10]);
    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).not.toContain(plId);
    const q = await billingPlant();
    await expect(q.as("office").billing.invoices.discard({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await p.as("office").billing.invoices.discard({ id });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(plId);
    const inv = await issued(p, [plId]);
    await expect(p.as("office").billing.invoices.discard({ id: inv.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("two issues at once get consecutive numbers, never the same", async () => {
    const p = await billingPlant();
    const a = await completedPl(p, [10]);
    const b = await completedPl(p, [12]);
    const da = await p.as("office").billing.invoices.createDraft({ packingListIds: [a.plId] });
    const db = await p.as("manager").billing.invoices.createDraft({ packingListIds: [b.plId] });
    const out = await Promise.all([p.as("office").billing.invoices.issue({ id: da.id }), p.as("manager").billing.invoices.issue({ id: db.id })]);
    expect(out.map((o) => o.number).sort()).toEqual(["INV/26-27/1", "INV/26-27/2"]);
  }, SLOW);

  test("payments.list and receivables.openInvoices; tenancy and permission", async () => {
    const p = await billingPlant();
    const inv = await issued(p, [(await completedPl(p, [10])).plId]);
    const total = (await p.owner.billing.invoices.get({ id: inv.id })).snapshot.totals.totalPaise;
    await p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-04", amountPaise: 600_00, mode: "cheque", reference: "CHQ 1", allocations: [{ invoiceId: inv.id, amountPaise: 500_00 }] });
    const list = await p.as("accountant").billing.payments.list({ limit: 10 });
    expect(list[0]).toMatchObject({ amountPaise: 600_00, allocatedPaise: 500_00, mode: "cheque", status: "active" });
    expect(await p.as("office").billing.receivables.openInvoices({ customerId: p.customerId })).toEqual([
      { id: inv.id, number: "INV/26-27/1", invoiceDate: "2026-10-03", totalPaise: total, duePaise: total - 500_00 },
    ]);
    const out = (await p.owner.billing.receivables.outstanding({ asOf: "2026-10-10" })).rows.find((r) => r.customerId === p.customerId)!;
    expect(out).toMatchObject({ onAccountPaise: 100_00, balancePaise: total - 600_00 });
    const q = await billingPlant();
    expect(await q.owner.billing.receivables.openInvoices({ customerId: p.customerId })).toEqual([]);
    expect(await q.owner.billing.payments.list({ limit: 10 })).toEqual([]);
    await expect(p.as("packer").billing.payments.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("a payment recorded after the cancel request: the approval is refused with the reason, nothing changes", async () => {
    const p = await billingPlant();
    const inv = await issued(p, [(await completedPl(p, [10])).plId]);
    const { approvalId } = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong rate" });
    await p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-10-04", amountPaise: 100_00, mode: "cash", allocations: [{ invoiceId: inv.id, amountPaise: 100_00 }] });
    await expect(p.as("manager").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A payment is recorded against this invoice: void the payment first. Reject this request.",
    });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ status: "issued", number: "INV/26-27/1" });
    expect((await env.db.select().from(approval).where(eq(approval.id, approvalId)))[0]).toMatchObject({ status: "pending" });
  }, SLOW);

  test("einvoice.status, cancelIrn after an approved cancel, the cron cancel branch, and e-way bill cancel", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter(fake);
    const pa = await completedPl(p, [300]);
    const a = await issued(p, [pa.plId]);
    const st = await p.as("office").einvoice.status({ id: a.id });
    expect(st).toMatchObject({ needsIrn: true, irnStatus: "generated", canCancelIrn: false, irnWindowClosed: false, ewbStatus: "none", ewbNeeded: true });
    const q = await billingPlant(["billing", "einvoice"]);
    await expect(q.owner.einvoice.status({ id: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await p.as("office").einvoice.ewbGenerate({ id: a.id, distanceKm: 120, vehicleNo: "GJ05AB1234" });
    await expect(p.as("packer").einvoice.ewbCancel({ id: a.id, remark: "Wrong vehicle" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("office").einvoice.ewbCancel({ id: a.id, remark: "Wrong vehicle" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ ewbStatus: "cancelled" });

    await expect(p.as("office").einvoice.cancelIrn({ id: a.id, remark: "Wrong rate" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Review S1: approved while the relay is down: cancel_pending, the list stays bound, the number stays.
    lib.setAdapter(null);
    const ap = await p.as("office").billing.invoices.requestCancel({ id: a.id, reason: "Wrong rate" });
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ status: "cancel_pending", irnStatus: "generated" });
    expect(await dispatchRow(pa.dispatchId)).toMatchObject({ invoiceNumber: a.number });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).not.toContain(pa.plId);
    await expect(p.as("office").billing.invoices.requestCancel({ id: a.id, reason: "Again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    lib.setAdapter(fake);
    expect(await p.as("office").einvoice.status({ id: a.id })).toMatchObject({ canCancelIrn: true });
    await p.as("office").einvoice.cancelIrn({ id: a.id, remark: "Wrong rate" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(await dispatchRow(pa.dispatchId)).toMatchObject({ invoiceNumber: null });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(pa.plId);

    // With the relay up the approval cancels the IRN at once.
    const b = await issued(p, [(await completedPl(p, [200])).plId]);
    const bp = await p.as("office").billing.invoices.requestCancel({ id: b.id, reason: "Duplicate" });
    await p.as("manager").approval.decide({ id: bp.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, b.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });

    // Approved with the relay down, the cron finishes it.
    const c = await issued(p, [(await completedPl(p, [100])).plId]);
    const cp = await p.as("office").billing.invoices.requestCancel({ id: c.id, reason: "Duplicate" });
    lib.setAdapter(null);
    await p.as("manager").approval.decide({ id: cp.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, c.id)))[0]).toMatchObject({ status: "cancel_pending" });
    await lib.runIrnCron(env.db, fake, Date.now());
    expect((await env.db.select().from(invoice).where(eq(invoice.id, c.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(fake.script.calls.filter((x) => x.op === "cancel")).toHaveLength(3);
  }, SLOW);

  test("S1: an approved cancel that misses the 24 h window goes back to issued; the screen says credit note", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => OCT);
    lib.setAdapter(fake);
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    expect(inv.status).toBe("issued");
    lib.setClock(new Date(OCT.getTime() + 23.5 * 3600_000));
    const ap = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong rate" });
    lib.setAdapter(null); // the relay is down past hour 24
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ status: "cancel_pending" });
    const late = OCT.getTime() + 24.5 * 3600_000;
    await lib.runIrnCron(env.db, null, late);
    const row = (await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]!;
    expect(row).toMatchObject({ status: "issued", irnStatus: "generated", cancelledAt: null });
    expect(row.irnError).toContain("credit note");
    expect(await dispatchRow(pl.dispatchId)).toMatchObject({ invoiceNumber: inv.number });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).not.toContain(pl.plId);
    expect(fake.script.calls.filter((x) => x.op === "cancel")).toHaveLength(0);
    lib.setClock(new Date(late));
    lib.setAdapter(fake);
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Again" })).rejects.toMatchObject({ message: expect.stringContaining("credit note") });
  }, SLOW);

  test("S1: a cancel while the IRN call was in flight waits, looks the document up, and cancels the IRN it finds", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    // The call lands at the IRP but its answer is lost (Worker timeout).
    const lossy = { ...fake, generateIrn: async (g: { companyId: string; gstin: string }, payload: Record<string, unknown>) => (await fake.generateIrn(g, payload), { ok: false as const, code: "relay_unreachable", message: "timeout", retryable: true }) };
    lib.setAdapter(lossy);
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    expect(inv).toMatchObject({ status: "irn_pending", irnStatus: "auto_retry" });
    const ap = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong party" });
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ status: "cancel_pending", irn: null });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).not.toContain(pl.plId);
    // Too soon: a call may still be on its way, so nothing is looked up.
    await lib.runIrnCron(env.db, fake, Date.now());
    expect(fake.script.calls.filter((x) => x.op === "byDocument")).toHaveLength(0);
    await lib.runIrnCron(env.db, fake, Date.now() + 3 * 60_000);
    const row = (await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]!;
    expect(row).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(row.irn).toHaveLength(64);
    expect(fake.script.calls.map((x) => x.op)).toEqual(["generate", "byDocument", "cancel"]);
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(pl.plId);

    // No IRN at the IRP (2283): cancelled with no IRN call; any other answer proves nothing and waits.
    const refused = { ...fake, generateIrn: async () => ({ ok: false as const, code: "relay_unreachable", message: "timeout", retryable: true }) };
    lib.setAdapter(refused);
    const two = await issued(p, [(await completedPl(p, [200])).plId]);
    lib.setClock(null); // the approval on the same clock as the calls (completedPl pins OCT)
    const bp = await p.as("office").billing.invoices.requestCancel({ id: two.id, reason: "Wrong party" });
    await p.as("manager").approval.decide({ id: bp.approvalId, decision: "approved" });
    const down = { ...fake, irnByDocument: async () => ({ ok: false as const, code: "relay_unknown_gstin", message: "no", retryable: false }) };
    await lib.runIrnCron(env.db, down, Date.now() + 3 * 60_000);
    expect((await env.db.select().from(invoice).where(eq(invoice.id, two.id)))[0]).toMatchObject({ status: "cancel_pending" });
    await lib.runIrnCron(env.db, fake, Date.now() + 10 * 60_000);
    expect((await env.db.select().from(invoice).where(eq(invoice.id, two.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "none" });
  }, SLOW);

  test("S4: the IRN cron is fair: one plant's backlog with e-invoice off never blocks another plant", async () => {
    const a = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const first = await issued(a, [(await completedPl(a, [300])).plId]);
    expect(first.status).toBe("irn_pending");
    const [row] = await env.db.select().from(invoice).where(eq(invoice.id, first.id));
    // 30 more pending invoices for plant A (copies with their own numbers), then A switches e-invoice off.
    for (let i = 2; i <= 31; i += 1) await env.db.insert(invoice).values({ ...row!, id: crypto.randomUUID(), seq: i, number: `INV/26-27/${i}` });
    await env.db.update(company).set({ modules: ["billing"] }).where(eq(company.id, a.companyId));
    const b = await billingPlant(["billing", "einvoice"]);
    const due = await issued(b, [(await completedPl(b, [200])).plId]);
    expect(due.status).toBe("irn_pending");
    const fake = lib.fakeAdapter(() => OCT);
    const generatedOf = async (companyId: string) =>
      (await env.db.select().from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.irnStatus, "generated")))).length;
    await lib.runIrnCron(env.db, fake, Date.now());
    // (Other tests' rows share this database, so count per plant, not the run's total.)
    expect((await env.db.select().from(invoice).where(eq(invoice.id, due.id)))[0]).toMatchObject({ status: "issued", irnStatus: "generated" });
    expect(await generatedOf(a.companyId)).toBe(0);
    // Plant A back on: at most 5 of its rows per run, so a third plant still gets its turn.
    await env.db.update(company).set({ modules: ["billing", "einvoice"] }).where(eq(company.id, a.companyId));
    const c = await billingPlant(["billing", "einvoice"]);
    const third = await issued(c, [(await completedPl(c, [100])).plId]);
    await lib.runIrnCron(env.db, lib.fakeAdapter(() => OCT), Date.now());
    expect(await generatedOf(a.companyId)).toBe(5);
    expect((await env.db.select().from(invoice).where(eq(invoice.id, third.id)))[0]).toMatchObject({ irnStatus: "generated" });
  }, SLOW);

  test("S1: a cancel days after the last IRN call asks the IRP first (not a bounce); a refused IRN cancels at once", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter({ ...fake, generateIrn: async () => ({ ok: false as const, code: "relay_unreachable", message: "timeout", retryable: true }) });
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    const later = Date.now() + 25 * 3600_000;
    lib.setClock(new Date(later));
    lib.setAdapter(null);
    const ap = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong party" });
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ status: "cancel_pending" });
    await lib.runIrnCron(env.db, fake, later + 60_000);
    expect((await env.db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "none" });
    expect((await p.owner.billing.invoices.billable({})).map((b) => b.id)).toContain(pl.plId);

    // The IRP itself refused the document: no IRN can exist, so the approval cancels at once.
    lib.setClock(OCT);
    lib.setAdapter(lib.fakeAdapter(() => OCT, { calls: [], failGenerate: { times: 1, response: { ok: false, code: "2172", message: "Invalid buyer pincode", retryable: false } } }));
    const two = await issued(p, [(await completedPl(p, [200])).plId]);
    expect(two).toMatchObject({ status: "irn_pending", irnStatus: "failed" });
    const bp = await p.as("office").billing.invoices.requestCancel({ id: two.id, reason: "Wrong party" });
    await p.as("manager").approval.decide({ id: bp.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, two.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "none" });
  }, SLOW);

  test("S4: a row that throws in the cron is pushed back and the run goes on to the next plant", async () => {
    const a = await billingPlant(["billing", "einvoice"]);
    const b = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const ia = await issued(a, [(await completedPl(a, [300])).plId]);
    const ib = await issued(b, [(await completedPl(b, [300])).plId]);
    const fake = lib.fakeAdapter(() => OCT);
    const flaky = {
      ...fake,
      generateIrn: async (to: { companyId: string; gstin: string }, payload: Record<string, unknown>) => {
        if (to.companyId === a.companyId) throw new Error("boom");
        return fake.generateIrn(to, payload);
      },
    };
    await lib.runIrnCron(env.db, flaky, Date.now());
    expect((await env.db.select().from(invoice).where(eq(invoice.id, ib.id)))[0]).toMatchObject({ irnStatus: "generated" });
    const rowA = (await env.db.select().from(invoice).where(eq(invoice.id, ia.id)))[0]!;
    expect(rowA.irnStatus).toBe("pending");
    expect(rowA.irnNextTryAt!.getTime()).toBeGreaterThan(Date.now());
  }, SLOW);

  test("S6: a PL regenerated after issue loses the cancelled number too", async () => {
    const p = await billingPlant();
    const { plId, dispatchId } = await completedPl(p, [40]);
    const inv = await issued(p, [plId]);
    const r2 = await p.owner.packingList.regenerate({ id: plId });
    const r2Id = (r2 as { id: string }).id;
    const head = async (id: string) => ((await env.db.select().from(packingList).where(eq(packingList.id, id)))[0]!.snapshot as { header: { invoiceNumber: string | null } }).header.invoiceNumber;
    expect(await head(r2Id)).toBe(inv.number);
    const { approvalId } = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong rate" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    expect(await head(r2Id)).toBeNull();
    expect(await head(plId)).toBeNull();
    expect(await dispatchRow(dispatchId)).toMatchObject({ invoiceNumber: null });
  }, SLOW);

  test("a credit note after the plant's e-invoice start gets an IRN, also against an invoice from before it", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter(fake);
    await p.as("admin").billing.settings.save({ stateCode: "24", pincode: "394230", place: "Surat", einvoiceFrom: "2026-11-01" });
    const inv = await issued(p, [(await completedPl(p, [300])).plId]); // 2026-10-03: before the start
    expect(inv).toMatchObject({ status: "issued", irnStatus: "none" });
    lib.setClock(new Date("2026-11-10T06:30:00.000Z"));
    const { id } = await p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: inv.id, reason: "rate_difference", note: "", lines: [{ kind: "amount", description: "Rate", amountPaise: 10_000 }] });
    const cn = await p.as("office").billing.invoices.issue({ id });
    expect(cn).toMatchObject({ status: "issued", irnStatus: "generated" });
    expect(fake.script.calls.filter((x) => x.op === "generate")).toHaveLength(1);
  }, SLOW);
});

describe("e-invoice fix round 2", () => {
  type Target = { companyId: string; gstin: string };
  type Res = { ok: false; code: string; message: string; retryable: boolean };
  const down = (code = "relay_unreachable"): Res => ({ ok: false, code, message: "timeout", retryable: true });
  const rowOf = async (id: string) => (await env.db.select().from(invoice).where(eq(invoice.id, id)))[0]!;
  const billable = async (p: SalesPlant) => (await p.owner.billing.invoices.billable({})).map((b) => b.id);
  /** Rows of other tests share this database: keep the cron on this plant's rows only. */
  const onlyThisPlant = async (companyId: string) => {
    await env.db.run(sql`update invoice set irn_next_try_at = 32503680000000 where company_id <> ${companyId} and (status = 'cancel_pending' or (irn is null and status in ('irn_pending', 'issued')))`);
  };
  const approveCancel = async (p: SalesPlant, id: string) => {
    const ap = await p.as("office").billing.invoices.requestCancel({ id, reason: "Wrong party" });
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
  };

  test("1: the cron stamps each IRN call when it leaves, so a cancel approved just after waits instead of freeing the lists", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const one = await issued(p, [(await completedPl(p, [300])).plId]);
    const pl2 = await completedPl(p, [200]);
    const two = await issued(p, [pl2.plId]);
    lib.setClock(null);
    await onlyThisPlant(p.companyId);
    const fake = lib.fakeAdapter(() => new Date());
    const t0 = Date.now();
    let clock = t0;
    let secondNo = "";
    // The first row's call takes 3 minutes (a slow IRP); the second is still on its way when the cancel comes.
    const slow = {
      ...fake,
      generateIrn: async (_to: Target, payload: Record<string, unknown>) => {
        if (!secondNo && clock === t0) {
          clock += 3 * 60_000;
          return down();
        }
        secondNo = (payload.DocDtls as { No: string }).No;
        return down();
      },
    };
    await lib.runIrnCron(env.db, slow, t0, () => clock);
    const target = secondNo === one.number ? one : two;
    expect(secondNo).not.toBe("");
    expect((await rowOf(target.id)).irnCallAt!.getTime()).toBe(t0 + 3 * 60_000);
    lib.setAdapter(fake);
    lib.setClock(new Date(t0 + 3.5 * 60_000));
    await approveCancel(p, target.id);
    expect(await rowOf(target.id)).toMatchObject({ status: "cancel_pending" });
    expect(fake.script.calls.filter((x) => x.op === "byDocument")).toHaveLength(0);
  }, SLOW);

  test("1: an IRN that lands on a cancelled invoice is kept and raises an alarm on the invoice", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    let invoiceNo = "";
    lib.setAdapter({
      ...fake,
      generateIrn: async (to: Target, payload: Record<string, unknown>) => {
        invoiceNo = (payload.DocDtls as { No: string }).No;
        await env.db.update(invoice).set({ status: "cancelled" }).where(and(eq(invoice.companyId, p.companyId), eq(invoice.number, invoiceNo)));
        return fake.generateIrn(to, payload);
      },
    });
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    const row = await rowOf(inv.id);
    expect(row).toMatchObject({ status: "cancelled", irnStatus: "generated" });
    expect(row.irnError).toContain("cancelled");
    const events = await env.db.select().from(billingEvent).where(eq(billingEvent.invoiceId, inv.id));
    expect(events.map((e) => e.outcome)).toContain("live_on_cancelled");
  }, SLOW);

  test("2: an IRP refusal after a call whose answer was lost keeps the IRN suspicion: the cancel looks it up and cancels it", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    let n = 0;
    // Attempt 1 makes the IRN but its answer is lost; attempt 2 is refused (expired token).
    const flaky = {
      ...fake,
      generateIrn: async (to: Target, payload: Record<string, unknown>) => {
        n += 1;
        if (n === 1) return (await fake.generateIrn(to, payload), down());
        return { ok: false as const, code: "1005", message: "Invalid Token", retryable: false };
      },
    };
    lib.setAdapter(flaky);
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    lib.setClock(null);
    await onlyThisPlant(p.companyId);
    await lib.runIrnCron(env.db, flaky, Date.now() + 6 * 60_000);
    expect(await rowOf(inv.id)).toMatchObject({ status: "irn_pending", irnStatus: "failed", irn: null });
    lib.setAdapter(fake);
    await approveCancel(p, inv.id);
    expect(await rowOf(inv.id)).toMatchObject({ status: "cancel_pending" });
    expect(await billable(p)).not.toContain(pl.plId);
    await lib.runIrnCron(env.db, fake, Date.now() + 10 * 60_000);
    const row = await rowOf(inv.id);
    expect(row).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(row.irn).toHaveLength(64);
  }, SLOW);

  test("2: Try again after a lost answer and a refusal looks the IRN up first (no snapshot rewrite)", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    let n = 0;
    const flaky = {
      ...fake,
      generateIrn: async (to: Target, payload: Record<string, unknown>) => {
        n += 1;
        if (n === 1) return (await fake.generateIrn(to, payload), down());
        return { ok: false as const, code: "1005", message: "Invalid Token", retryable: false };
      },
    };
    lib.setAdapter(flaky);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    lib.setClock(null);
    await onlyThisPlant(p.companyId);
    await lib.runIrnCron(env.db, flaky, Date.now() + 6 * 60_000);
    lib.setAdapter(fake);
    expect(await p.as("office").einvoice.generate({ id: inv.id })).toEqual({ outcome: "generated" });
    expect(fake.script.calls.map((x) => x.op)).toEqual(["generate", "byDocument"]);
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, inv.id), eq(auditLog.action, "invoice.irn.refresh")));
    expect(audit[0]?.meta).toMatchObject({ recovered: true });
  }, SLOW);

  test("3: past the IRP's lookup window, the office records what the IRP portal shows and the invoice moves on", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter({ ...fake, generateIrn: async () => down() });
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    lib.setClock(null);
    lib.setAdapter(fake);
    // Not stuck yet: the IRP can still be asked, so no manual answer is taken.
    await expect(p.as("office").einvoice.recordPortalCheck({ id: inv.id, seen: "none", note: "Checked the portal" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await env.db.update(invoice).set({ irnStatus: "failed", irnCallAt: old, irnUnknownSince: old }).where(eq(invoice.id, inv.id));
    await expect(p.as("office").einvoice.generate({ id: inv.id })).rejects.toMatchObject({ message: expect.stringContaining("IRP portal") });
    expect(await p.as("office").einvoice.status({ id: inv.id })).toMatchObject({ portalCheckNeeded: true });
    await expect(p.as("packer").einvoice.recordPortalCheck({ id: inv.id, seen: "none", note: "Checked the portal" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const q = await billingPlant(["billing", "einvoice"]);
    await expect(q.owner.einvoice.recordPortalCheck({ id: inv.id, seen: "none", note: "Checked the portal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await p.as("office").einvoice.recordPortalCheck({ id: inv.id, seen: "none", note: "No IRN for INV on the portal" });
    expect(await rowOf(inv.id)).toMatchObject({ status: "irn_pending", irnUnknownSince: null });
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, inv.id), eq(auditLog.action, "invoice.irn.portal_check")));
    expect(audit[0]).toMatchObject({ meta: { seen: "none", note: "No IRN for INV on the portal" } });
    expect(audit[0]!.actorId).toBeTruthy();
    await approveCancel(p, inv.id);
    expect(await rowOf(inv.id)).toMatchObject({ status: "cancelled" });
    expect(await billable(p)).toContain(pl.plId);

    // A cancel that is stuck: the portal shows an IRN, so it is kept, the invoice is live, and a credit note goes.
    lib.setAdapter({ ...fake, generateIrn: async () => down() });
    const two = await issued(p, [(await completedPl(p, [200])).plId]);
    lib.setClock(null);
    lib.setAdapter(null);
    await approveCancel(p, two.id);
    expect(await rowOf(two.id)).toMatchObject({ status: "cancel_pending" });
    await env.db.update(invoice).set({ irnCallAt: old, irnUnknownSince: old }).where(eq(invoice.id, two.id));
    const irn = "a".repeat(64);
    await p.as("office").einvoice.recordPortalCheck({ id: two.id, seen: "found", irn, ackNo: "112610000000123", note: "Portal shows the IRN" });
    expect(await rowOf(two.id)).toMatchObject({ status: "issued", irn, irnStatus: "generated", ackNo: "112610000000123", irnUnknownSince: null });
    await p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: two.id, reason: "other", note: "", lines: [{ kind: "amount", description: "Cancel", amountPaise: 10_000 }] });
  }, SLOW);

  test("3: a wrong \"no IRN\" from the portal: the IRP answers duplicate, so the next cancel never takes \"not found\" as proof", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    // The first call made the IRN, its answer was lost, and the IRP no longer serves it by document.
    const blind = { ...fake, irnByDocument: async () => ({ ok: false as const, code: "2283", message: "not found", retryable: false }) };
    lib.setAdapter({ ...blind, generateIrn: async (to: Target, payload: Record<string, unknown>) => (await fake.generateIrn(to, payload), down()) });
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    lib.setClock(null);
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await env.db.update(invoice).set({ irnStatus: "failed", irnCallAt: old, irnUnknownSince: old }).where(eq(invoice.id, inv.id));
    await p.as("office").einvoice.recordPortalCheck({ id: inv.id, seen: "none", note: "Looked, saw nothing" });
    lib.setAdapter(blind);
    expect(await p.as("office").einvoice.generate({ id: inv.id })).toEqual({ outcome: "failed" });
    expect(await p.as("office").einvoice.status({ id: inv.id })).toMatchObject({ portalCheckNeeded: true });
    await approveCancel(p, inv.id);
    await onlyThisPlant(p.companyId);
    await lib.runIrnCron(env.db, blind, Date.now() + 10 * 60_000);
    expect(await rowOf(inv.id)).toMatchObject({ status: "cancel_pending" });
    expect(await billable(p)).not.toContain(pl.plId);
  }, SLOW);

  test("4: a cancel whose answer was lost is finished from the IRP's own record, also at the 24 h edge", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter(fake);
    const lost = { ...fake, cancelIrn: async (to: Target, input: { irn: string; reasonCode: string; remark: string }) => (await fake.cancelIrn(to, input), down()) };
    const pa = await completedPl(p, [300]);
    const a = await issued(p, [pa.plId]);
    const b = await issued(p, [(await completedPl(p, [200])).plId]);
    lib.setClock(null);
    await onlyThisPlant(p.companyId);
    lib.setAdapter(lost);
    await approveCancel(p, a.id);
    await approveCancel(p, b.id);
    expect(await rowOf(a.id)).toMatchObject({ status: "cancel_pending" });
    // The retry is answered "already cancelled": look it up, see it cancelled, finish.
    await lib.runIrnCron(env.db, fake, Date.now() + 6 * 60_000, () => Date.now() + 6 * 60_000);
    expect(await rowOf(a.id)).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(await rowOf(b.id)).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(await billable(p)).toContain(pa.plId);

    // At hour 24 the revert asks the IRP once more: cancelled there, so cancelled here.
    lib.setAdapter(fake);
    const c = await issued(p, [(await completedPl(p, [100])).plId]);
    lib.setClock(null);
    lib.setAdapter(lost);
    await approveCancel(p, c.id);
    expect(await rowOf(c.id)).toMatchObject({ status: "cancel_pending" });
    const late = Date.now() + 24.5 * 3600_000;
    await lib.runIrnCron(env.db, fake, late, () => late);
    expect(await rowOf(c.id)).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });

    // At hour 24 with no answer at all from the IRP: back to issued, as before.
    lib.setAdapter(fake);
    const d = await issued(p, [(await completedPl(p, [100])).plId]);
    lib.setClock(null);
    lib.setAdapter(null);
    await approveCancel(p, d.id);
    const deaf = { ...fake, cancelIrn: async () => down(), irnByDocument: async () => down() };
    await lib.runIrnCron(env.db, deaf, Date.now() + 24.5 * 3600_000);
    expect(await rowOf(d.id)).toMatchObject({ status: "issued", irnStatus: "generated" });
  }, SLOW);

  test("4: the IRP cancel succeeds after the 24 h revert ran: the invoice ends cancelled and the result says so", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter(fake);
    const pl = await completedPl(p, [300]);
    const inv = await issued(p, [pl.plId]);
    lib.setClock(null);
    lib.setAdapter(null);
    await approveCancel(p, inv.id);
    // The cron's revert lands while "Cancel IRN" is at the IRP.
    const racing = {
      ...fake,
      cancelIrn: async (to: Target, input: { irn: string; reasonCode: string; remark: string }) => {
        await env.db.update(invoice).set({ status: "issued", cancelApprovalId: null, cancelledAt: null }).where(eq(invoice.id, inv.id));
        return fake.cancelIrn(to, input);
      },
    };
    lib.setAdapter(racing);
    const out = await p.as("office").einvoice.cancelIrn({ id: inv.id, remark: "Wrong rate" });
    expect(out).toMatchObject({ ok: true, outcome: "cancelled" });
    expect(await rowOf(inv.id)).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(await dispatchRow(pl.dispatchId)).toMatchObject({ invoiceNumber: null });
  }, SLOW);

  test("5: a credit note waiting on its own cancel still counts: no second note, no payment past it, no invoice cancel", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    const fake = lib.fakeAdapter(() => new Date());
    lib.setAdapter(fake);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    lib.setClock(null);
    const invCancel = await p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong rate" });
    const cn = await p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: inv.id, reason: "other", note: "", lines: [{ kind: "amount", description: "Rate", amountPaise: 45_000_00 }] });
    expect(await p.as("office").billing.invoices.issue({ id: cn.id })).toMatchObject({ status: "issued", irnStatus: "generated" });
    lib.setAdapter(null);
    await approveCancel(p, cn.id);
    expect(await rowOf(cn.id)).toMatchObject({ status: "cancel_pending" });
    // (a) a second note that fits only if the first is ignored
    await expect(
      p.as("office").billing.invoices.createCreditDraft({ againstInvoiceId: inv.id, reason: "other", note: "", lines: [{ kind: "amount", description: "Rate", amountPaise: 45_000_00 }] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("more than the invoice") });
    // (b) a payment past what the first note leaves
    await expect(
      p.as("accountant").billing.payments.record({ customerId: p.customerId, receivedOn: "2026-11-20", amountPaise: 50_000_00, mode: "cash", allocations: [{ invoiceId: inv.id, amountPaise: 50_000_00 }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // (c) the invoice's own cancel, requested before the note
    await expect(p.as("manager").approval.decide({ id: invCancel.approvalId, decision: "approved" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await rowOf(inv.id)).toMatchObject({ status: "issued" });
  }, SLOW);

  test("settle window: longer than the Worker's relay timeout plus the relay's own upstream limit, with margin", async () => {
    const flow = await import("../src/lib/billing/einvoiceFlow");
    const irp = await import("../src/lib/billing/irp");
    // The relay may first see the call up to 15 s after the stamp, then run it for up to 20 s more.
    expect(flow.IRN_CALL_SETTLE_MS).toBeGreaterThanOrEqual(irp.RELAY_TIMEOUT_MS + irp.RELAY_UPSTREAM_MAX_MS + 60_000);
  });
});
