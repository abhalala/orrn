/**
 * XE-BILL rows 13, 14, 15, 97: tax invoice from frozen packing lists, gap-free FY numbering, cancel by
 * approval (number stays used), credit notes, payments and outstanding, Tally / register exports, and the
 * IRN status machine against the fake IRP adapter. Opt-in modules: a plant without `billing` gets FORBIDDEN.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, company, customer, dispatch, docSeries, invoice, packingList, salesOrderLine } from "@orrn/db/schema";
import { computeInvoice, decodeSignedInvoice, gstinCheckDigit } from "@orrn/domain";
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
  test("relay not configured: the invoice stays IRN pending, never issued; the e-way bill file still works", async () => {
    const p = await billingPlant(["billing", "einvoice"]);
    lib.setAdapter(null);
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    expect(inv).toMatchObject({ status: "irn_pending", irnStatus: "pending", number: "INV/26-27/1" });
    await expect(p.as("office").einvoice.generate({ id: inv.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const file = await p.as("office").billing.export.ewbJson({ invoiceIds: [inv.id], distanceKm: 120, vehicleNo: "GJ05AB1234" });
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
    const first = await fake.generateIrn(PLANT_GSTIN, { DocDtls: { Typ: "INV", No: inv.number, Dt: "03/10/2026" } });
    lib.setAdapter(fake);
    await expect(p.as("office").einvoice.generate({ id: inv.id })).resolves.toEqual({ outcome: "generated" });
    const [row] = await env.db.select().from(invoice).where(eq(invoice.id, inv.id));
    expect(row).toMatchObject({ status: "issued", irnStatus: "generated", irn: first.ok ? first.data.Irn : "x" });
    expect(fake.script.calls.map((c) => c.op)).toEqual(["generate", "generate", "byDocument"]);
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
    lib.setAdapter(lib.fakeAdapter(() => new Date()));
    const inv = await issued(p, [(await completedPl(p, [300])).plId]);
    await p.as("office").einvoice.ewbGenerate({ id: inv.id, distanceKm: 250, vehicleNo: "GJ05AB1234" });
    await expect(p.as("office").billing.invoices.requestCancel({ id: inv.id, reason: "Wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cancel the e-way bill first" });
    await env.db.update(invoice).set({ ewbStatus: "cancelled", irnGeneratedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(invoice.id, inv.id));
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
    const a = await issued(p, [(await completedPl(p, [300])).plId]);
    const st = await p.as("office").einvoice.status({ id: a.id });
    expect(st).toMatchObject({ needsIrn: true, irnStatus: "generated", canCancelIrn: true, ewbStatus: "none", ewbNeeded: true });
    const q = await billingPlant(["billing", "einvoice"]);
    await expect(q.owner.einvoice.status({ id: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await p.as("office").einvoice.ewbGenerate({ id: a.id, distanceKm: 120, vehicleNo: "GJ05AB1234" });
    await expect(p.as("packer").einvoice.ewbCancel({ id: a.id, remark: "Wrong vehicle" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("office").einvoice.ewbCancel({ id: a.id, remark: "Wrong vehicle" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ ewbStatus: "cancelled" });

    await expect(p.as("office").einvoice.cancelIrn({ id: a.id, remark: "Wrong rate" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ap = await p.as("office").billing.invoices.requestCancel({ id: a.id, reason: "Wrong rate" });
    await p.as("manager").approval.decide({ id: ap.approvalId, decision: "approved" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "generated" });
    await p.as("office").einvoice.cancelIrn({ id: a.id, remark: "Wrong rate" });
    expect((await env.db.select().from(invoice).where(eq(invoice.id, a.id)))[0]).toMatchObject({ irnStatus: "cancelled" });

    const b = await issued(p, [(await completedPl(p, [200])).plId]);
    const bp = await p.as("office").billing.invoices.requestCancel({ id: b.id, reason: "Duplicate" });
    await p.as("manager").approval.decide({ id: bp.approvalId, decision: "approved" });
    await lib.runIrnCron(env.db, fake, Date.now());
    expect((await env.db.select().from(invoice).where(eq(invoice.id, b.id)))[0]).toMatchObject({ status: "cancelled", irnStatus: "cancelled" });
    expect(fake.script.calls.filter((c) => c.op === "cancel")).toHaveLength(2);
  }, SLOW);
});
