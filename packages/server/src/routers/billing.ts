/**
 * XE-BILL rows 13, 14, 97: GST settings, tax invoices, credit notes, payments received, outstanding and
 * the accounts exports. Opt-in module `billing`; every procedure (reads too) checks it (lib/billing/gate.ts).
 * Heavy work lives in lib/billing/*; nothing runs at module scope.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { billingEvent, billingSettings, customerGst, gstHsn, gstSectionHsn, gstTaxCategories, invoice, invoiceSource, payment, paymentAllocation, paymentModes, shipToKinds } from "@orrn/db/schema/billing";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch } from "@orrn/db/schema/dispatch";
import { packingList } from "@orrn/db/schema/packing";
import {
  ageInvoices,
  ALUMINIUM_HSN_SEED,
  buildStatement,
  ewbOfflineBill,
  ewbOfflineFile,
  GST_UQC,
  gstinProblem,
  invoiceOutstanding,
  isHsnCode,
  isPincode,
  isStateCode,
  normaliseGstin,
  pincodeFitsState,
  readTallyLedgers,
  tallyEnvelope,
  type StatementEntry,
  type TallyVoucher,
} from "@orrn/domain";

import { router } from "../index";
import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { billingProcedure } from "../lib/billing/gate";
import { buyerParty, sellerParty, type InvoiceSnapshot } from "../lib/billing/snapshot";
import {
  createCreditDraft,
  createInvoiceDraft,
  customerNames,
  discardDraft,
  issueDocument,
  onAccountByCustomer,
  prepareInvoice,
  receivableInvoices,
  recordPayment,
  requestCancel,
  voidPayment,
  ymdText,
  type BillCtx,
} from "../lib/billing/invoices";
import { loadPartyGst, loadPlantGst } from "../lib/billing/facts";
import { now } from "../lib/clock";
import { companyTimezone } from "../lib/dayWindow";
import { nextCompanySeq } from "../lib/sequence";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const paise = z.number().int().nonnegative().max(1e13);
const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);

const chargeSchema = z.object({ label: text(120).min(1), amountPaise: paise.min(1), hsnId: id.nullish() });
const invoiceInput = z.object({
  packingListIds: z.array(id).min(1).max(20),
  rates: z.record(z.string().max(200), z.number().int().positive().max(1e9)).default({}),
  charges: z.array(chargeSchema).max(10).default([]),
});
const creditLine = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("weight"), description: text(160).min(1), hsnId: id.nullish(), weightG: z.number().int().positive().max(1e10), ratePaise: z.number().int().positive().max(1e9) }),
  z.object({ kind: z.literal("amount"), description: text(160).min(1), hsnId: id.nullish(), amountPaise: paise.min(1) }),
]);

const bill = (ctx: unknown) => ctx as BillCtx;

function monthRange(m: string): { from: string; to: string } {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

async function plantTz(ctx: BillCtx) {
  const { settings } = await loadPlantGst(ctx.db, ctx.companyId);
  return companyTimezone(settings);
}

// ---------------------------------------------------------------------------
// Settings (row 14)
// ---------------------------------------------------------------------------

const settingsRouter = router({
  get: billingProcedure("gst.settings", "invoice.read").query(async ({ ctx }) => {
    const { plant, missing, settings } = await loadPlantGst(ctx.db, ctx.companyId);
    const [bs] = await ctx.db.select().from(billingSettings).where(eq(billingSettings.companyId, ctx.companyId)).limit(1);
    const lh = (settings.letterhead ?? {}) as Record<string, unknown>;
    return {
      gstin: typeof lh.gstin === "string" ? lh.gstin : null,
      legalName: typeof lh.legalName === "string" ? lh.legalName : null,
      address: typeof lh.address === "string" ? lh.address : null,
      stateCode: bs?.stateCode ?? null,
      pincode: bs?.pincode ?? null,
      place: bs?.place ?? null,
      tradeName: bs?.tradeName ?? null,
      signatory: bs?.signatory ?? null,
      terms: bs?.terms ?? null,
      einvoiceFrom: bs?.einvoiceFrom ?? null,
      tallyLedgers: readTallyLedgers(bs?.tallyLedgers ?? null),
      ready: plant !== null,
      missing,
    };
  }),
  save: billingProcedure("gst.settings")
    .input(
      z.object({
        stateCode: z.string().length(2),
        pincode: z.string().length(6),
        place: text(100).min(3),
        tradeName: text(100).nullish(),
        signatory: text(100).nullish(),
        terms: text(1000).nullish(),
        einvoiceFrom: ymd.nullish(),
        tallyLedgers: z.record(z.string().max(20), text(100)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isStateCode(input.stateCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown GST state code" });
      if (!isPincode(input.pincode) || !pincodeFitsState(input.pincode, input.stateCode)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This pincode is not in that state" });
      }
      const seq = await nextCompanySeq(ctx, ctx.companyId);
      const values = {
        stateCode: input.stateCode,
        pincode: input.pincode,
        place: input.place,
        tradeName: input.tradeName || null,
        signatory: input.signatory || null,
        terms: input.terms || null,
        einvoiceFrom: input.einvoiceFrom ?? null,
        tallyLedgers: input.tallyLedgers ? readTallyLedgers(input.tallyLedgers) : undefined,
        serverSeq: seq,
        updatedBy: ctx.session.user.id,
        updatedAt: now(),
      };
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(billingSettings)
          .values({ companyId: ctx.companyId, ...values })
          .onConflictDoUpdate({ target: billingSettings.companyId, set: values }),
        auditInsert(ctx, { action: "billing.settings", subjectType: "company", subjectId: ctx.companyId, meta: { stateCode: input.stateCode } }),
      ]);
      return { ok: true };
    }),
});

const hsnRouter = router({
  list: billingProcedure("gst.settings", "invoice.read").query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(gstHsn).where(eq(gstHsn.companyId, ctx.companyId)).orderBy(asc(gstHsn.code));
    const counts = await ctx.db
      .select({ hsnId: gstSectionHsn.hsnId, n: sql<number>`count(*)` })
      .from(gstSectionHsn)
      .where(eq(gstSectionHsn.companyId, ctx.companyId))
      .groupBy(gstSectionHsn.hsnId);
    const byId = new Map(counts.map((c) => [c.hsnId, Number(c.n)]));
    return rows.map((r) => ({ id: r.id, code: r.code, description: r.description, rateBp: r.rateBp, uqc: r.uqc, isDefault: r.isDefault, active: r.active, sections: byId.get(r.id) ?? 0 }));
  }),
  /** Put the aluminium seed rows (7604 default, 7608, 7610 at 18%) in, skipping codes the plant already has. */
  seedDefaults: billingProcedure("gst.settings").mutation(async ({ ctx }) => {
    const have = await ctx.db.select({ code: gstHsn.code, isDefault: gstHsn.isDefault }).from(gstHsn).where(eq(gstHsn.companyId, ctx.companyId));
    const codes = new Set(have.map((h) => h.code));
    const anyDefault = have.some((h) => h.isDefault);
    const add = ALUMINIUM_HSN_SEED.filter((s) => !codes.has(s.code));
    if (add.length === 0) return { added: 0 };
    const seq = await nextCompanySeq(ctx, ctx.companyId);
    await atomicBatch(ctx.db, [
      ctx.db.insert(gstHsn).values(
        add.map((s) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, serverSeq: seq, code: s.code, description: s.description, rateBp: s.rateBp, uqc: s.uqc, isDefault: s.isDefault && !anyDefault })),
      ),
      auditInsert(ctx, { action: "billing.hsn.seed", subjectType: "company", subjectId: ctx.companyId, meta: { codes: add.map((s) => s.code) } }),
    ]);
    return { added: add.length };
  }),
  save: billingProcedure("gst.settings")
    .input(
      z.object({
        id: id.nullish(),
        code: z.string().trim(),
        description: text(120).min(1),
        rateBp: z.number().int().min(0).max(2800),
        uqc: z.enum(GST_UQC),
        isDefault: z.boolean(),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isHsnCode(input.code)) throw new TRPCError({ code: "BAD_REQUEST", message: "An HSN code is 4, 6 or 8 digits" });
      if (input.isDefault && !input.active) throw new TRPCError({ code: "BAD_REQUEST", message: "The default HSN must be active" });
      if (input.id) {
        const [own] = await ctx.db.select({ id: gstHsn.id }).from(gstHsn).where(and(eq(gstHsn.id, input.id), eq(gstHsn.companyId, ctx.companyId))).limit(1);
        if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      const rowId = input.id ?? crypto.randomUUID();
      const seq = await nextCompanySeq(ctx, ctx.companyId);
      const values = { code: input.code, description: input.description, rateBp: input.rateBp, uqc: input.uqc, isDefault: input.isDefault, active: input.active, serverSeq: seq, updatedAt: now() };
      const statements: SqliteBatchItem[] = [];
      if (input.isDefault) {
        statements.push(ctx.db.update(gstHsn).set({ isDefault: false }).where(and(eq(gstHsn.companyId, ctx.companyId), sql`${gstHsn.id} <> ${rowId}`)));
      }
      statements.push(
        input.id
          ? ctx.db.update(gstHsn).set(values).where(and(eq(gstHsn.id, rowId), eq(gstHsn.companyId, ctx.companyId)))
          : ctx.db.insert(gstHsn).values({ id: rowId, companyId: ctx.companyId, ...values }),
        auditInsert(ctx, { action: "billing.hsn.save", subjectType: "gst_hsn", subjectId: rowId, meta: { code: input.code, rateBp: input.rateBp } }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes("UNIQUE") || String((e as { cause?: unknown })?.cause ?? "").includes("UNIQUE")) {
          throw new TRPCError({ code: "CONFLICT", message: "This HSN code is already in the list" });
        }
        throw e;
      }
      return { id: rowId };
    }),
  /** Give sections (dies) an HSN; `hsnId: null` puts them back on the plant default. */
  assign: billingProcedure("gst.settings")
    .input(z.object({ dieIds: z.array(id).min(1).max(40), hsnId: id.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const dies = await ctx.db.select({ id: die.id }).from(die).where(and(eq(die.companyId, ctx.companyId), inArray(die.id, input.dieIds)));
      if (dies.length !== new Set(input.dieIds).size) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (input.hsnId) {
        const [h] = await ctx.db.select({ id: gstHsn.id }).from(gstHsn).where(and(eq(gstHsn.id, input.hsnId), eq(gstHsn.companyId, ctx.companyId))).limit(1);
        if (!h) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      const statements: SqliteBatchItem[] = [
        ctx.db.delete(gstSectionHsn).where(and(eq(gstSectionHsn.companyId, ctx.companyId), inArray(gstSectionHsn.dieId, input.dieIds))),
      ];
      if (input.hsnId) {
        statements.push(ctx.db.insert(gstSectionHsn).values(input.dieIds.map((dieId) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, dieId, hsnId: input.hsnId! }))));
      }
      statements.push(auditInsert(ctx, { action: "billing.hsn.assign", subjectType: "gst_hsn", subjectId: input.hsnId, meta: { sections: input.dieIds.length } }));
      await atomicBatch(ctx.db, statements);
      return { ok: true };
    }),
});

const partyRouter = router({
  get: billingProcedure("gst.settings", "invoice.read")
    .input(z.object({ customerId: id }))
    .query(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({ id: customer.id, name: customer.name, taxId: customer.taxId, billingAddress: customer.billingAddress })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [g] = await ctx.db.select().from(customerGst).where(and(eq(customerGst.companyId, ctx.companyId), eq(customerGst.customerId, c.id))).limit(1);
      const { missing } = await loadPartyGst(ctx.db, ctx.companyId, c.id);
      return {
        customerId: c.id,
        name: c.name,
        gstin: c.taxId,
        gstinProblem: c.taxId ? gstinProblem(c.taxId) : "empty",
        taxCategory: g?.taxCategory ?? "regular",
        stateCode: g?.stateCode ?? null,
        pincode: g?.pincode ?? null,
        place: g?.place ?? null,
        placeOfSupply: g?.placeOfSupply ?? null,
        shipToKind: g?.shipToKind ?? "same",
        shipToCustomerId: g?.shipToCustomerId ?? null,
        shipToName: g?.shipToName ?? null,
        shipToGstin: g?.shipToGstin ?? null,
        shipToAddress: g?.shipToAddress ?? null,
        shipToPlace: g?.shipToPlace ?? null,
        shipToStateCode: g?.shipToStateCode ?? null,
        shipToPincode: g?.shipToPincode ?? null,
        distanceKm: g?.distanceKm ?? null,
        missing,
      };
    }),
  save: billingProcedure("gst.settings")
    .input(
      z.object({
        customerId: id,
        taxCategory: z.enum(gstTaxCategories),
        stateCode: z.string().length(2).nullish(),
        pincode: z.string().length(6).nullish(),
        place: text(100).nullish(),
        placeOfSupply: z.string().length(2).nullish(),
        shipToKind: z.enum(shipToKinds),
        shipToCustomerId: id.nullish(),
        shipToName: text(100).nullish(),
        shipToGstin: z.string().trim().max(15).nullish(),
        shipToAddress: text(200).nullish(),
        shipToPlace: text(100).nullish(),
        shipToStateCode: z.string().length(2).nullish(),
        shipToPincode: z.string().length(6).nullish(),
        distanceKm: z.number().int().min(0).max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({ id: customer.id })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (input.stateCode && !isStateCode(input.stateCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown GST state code" });
      if (input.placeOfSupply && !isStateCode(input.placeOfSupply)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown place of supply" });
      if (input.pincode && input.stateCode && !pincodeFitsState(input.pincode, input.stateCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "This pincode is not in that state" });
      if (input.shipToGstin && gstinProblem(input.shipToGstin)) throw new TRPCError({ code: "BAD_REQUEST", message: "The ship-to GSTIN is not valid" });
      if (input.shipToKind === "party") {
        if (!input.shipToCustomerId || input.shipToCustomerId === input.customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick another customer to ship to" });
        const [s] = await ctx.db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, input.shipToCustomerId), eq(customer.companyId, ctx.companyId))).limit(1);
        if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      if (input.shipToKind === "address" && input.shipToStateCode && input.shipToPincode && !pincodeFitsState(input.shipToPincode, input.shipToStateCode)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The ship-to pincode is not in that state" });
      }
      const seq = await nextCompanySeq(ctx, ctx.companyId);
      const addr = input.shipToKind === "address";
      const values = {
        taxCategory: input.taxCategory,
        stateCode: input.stateCode ?? null,
        pincode: input.pincode ?? null,
        place: input.place || null,
        placeOfSupply: input.placeOfSupply ?? null,
        shipToKind: input.shipToKind,
        shipToCustomerId: input.shipToKind === "party" ? input.shipToCustomerId! : null,
        shipToName: addr ? input.shipToName || null : null,
        shipToGstin: addr && input.shipToGstin ? normaliseGstin(input.shipToGstin) : null,
        shipToAddress: addr ? input.shipToAddress || null : null,
        shipToPlace: addr ? input.shipToPlace || null : null,
        shipToStateCode: addr ? (input.shipToStateCode ?? null) : null,
        shipToPincode: addr ? (input.shipToPincode ?? null) : null,
        distanceKm: input.distanceKm ?? null,
        serverSeq: seq,
        updatedBy: ctx.session.user.id,
        updatedAt: now(),
      };
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(customerGst)
          .values({ id: crypto.randomUUID(), companyId: ctx.companyId, customerId: input.customerId, ...values })
          .onConflictDoUpdate({ target: [customerGst.companyId, customerGst.customerId], set: values }),
        auditInsert(ctx, { action: "billing.party.save", subjectType: "customer", subjectId: input.customerId, meta: { taxCategory: input.taxCategory, shipTo: input.shipToKind } }),
      ]);
      return { ok: true };
    }),
});

// ---------------------------------------------------------------------------
// Invoices and credit notes (row 13)
// ---------------------------------------------------------------------------

const BILLABLE_LIMIT = 200;

const invoicesRouter = router({
  /** Current packing lists of completed dispatches not yet on a live invoice. */
  billable: billingProcedure("invoice.read")
    .input(z.object({ customerId: id.nullish() }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: packingList.id,
          code: packingList.code,
          revision: packingList.revision,
          customerId: dispatch.customerId,
          customerName: customer.name,
          date: sql<string | null>`json_extract(${packingList.snapshot}, '$.header.date')`,
          weightG: sql<number>`coalesce(json_extract(${packingList.snapshot}, '$.summary.weightG'), 0)`,
          bundles: sql<number>`coalesce(json_extract(${packingList.snapshot}, '$.summary.bundles'), 0)`,
        })
        .from(packingList)
        .innerJoin(dispatch, and(eq(dispatch.id, packingList.dispatchId), eq(dispatch.companyId, packingList.companyId)))
        .innerJoin(customer, and(eq(customer.id, dispatch.customerId), eq(customer.companyId, packingList.companyId)))
        .where(
          and(
            eq(packingList.companyId, ctx.companyId),
            eq(dispatch.status, "completed"),
            isNull(packingList.combinedIntoId),
            input.customerId ? eq(dispatch.customerId, input.customerId) : undefined,
            sql`json_extract(${packingList.snapshot}, '$.version') = 2`,
            sql`not exists (select 1 from packing_list p2 where p2.company_id = ${ctx.companyId} and p2.supersedes_id = ${packingList.id})`,
            sql`not exists (select 1 from invoice_source s where s.company_id = ${ctx.companyId} and s.active = 1
                  and (s.packing_list_id = ${packingList.id} or s.dispatch_id = ${packingList.dispatchId}
                    or s.dispatch_id in (select pld.dispatch_id from packing_list_dispatch pld where pld.company_id = ${ctx.companyId} and pld.packing_list_id = ${packingList.id})))`,
          ),
        )
        .orderBy(desc(packingList.createdAt))
        .limit(BILLABLE_LIMIT);
      return rows.map((r) => ({ ...r, weightG: Number(r.weightG), bundles: Number(r.bundles) }));
    }),
  /** What the invoice would be (lines, tax, total) and what is missing, without writing. */
  preview: billingProcedure("invoice.issue")
    .input(invoiceInput)
    .query(async ({ ctx, input }) => {
      const prep = await prepareInvoice(ctx.db, ctx.companyId, input);
      return { missing: prep.missing, missingRates: prep.build.missingRates, snapshot: prep.snapshot };
    }),
  createDraft: billingProcedure("invoice.issue")
    .input(invoiceInput)
    .mutation(async ({ ctx, input }) => createInvoiceDraft(bill(ctx), input)),
  createCreditDraft: billingProcedure("invoice.issue")
    .input(z.object({ againstInvoiceId: id, reason: z.enum(["return", "rate_difference", "other"]), note: text(300).default(""), lines: z.array(creditLine).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => createCreditDraft(bill(ctx), input)),
  discard: billingProcedure("invoice.issue")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      await discardDraft(bill(ctx), input.id);
      return { ok: true };
    }),
  issue: billingProcedure("invoice.issue")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => issueDocument(bill(ctx), input.id, ctx.modules)),
  requestCancel: billingProcedure("invoice.cancel")
    .input(z.object({ id, reason: text(300).min(3) }))
    .mutation(async ({ ctx, input }) => requestCancel(bill(ctx), input.id, input.reason)),
  list: billingProcedure("invoice.read")
    .input(
      z
        .object({
          kind: z.enum(["invoice", "credit_note"]).optional(),
          status: z.enum(["draft", "irn_pending", "issued", "cancelled"]).optional(),
          customerId: id.optional(),
          from: ymd.optional(),
          to: ymd.optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .default({ limit: 100 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: invoice.id,
          kind: invoice.kind,
          status: invoice.status,
          number: invoice.number,
          invoiceDate: invoice.invoiceDate,
          customerId: invoice.customerId,
          customerName: customer.name,
          totalPaise: invoice.totalPaise,
          taxablePaise: invoice.taxablePaise,
          weightG: invoice.weightG,
          irnStatus: invoice.irnStatus,
          needsIrn: invoice.needsIrn,
          ewbStatus: invoice.ewbStatus,
          createdAt: invoice.createdAt,
        })
        .from(invoice)
        .innerJoin(customer, and(eq(customer.id, invoice.customerId), eq(customer.companyId, invoice.companyId)))
        .where(
          and(
            eq(invoice.companyId, ctx.companyId),
            input.kind ? eq(invoice.kind, input.kind) : undefined,
            input.status ? eq(invoice.status, input.status) : undefined,
            input.customerId ? eq(invoice.customerId, input.customerId) : undefined,
            input.from ? gte(invoice.invoiceDate, input.from) : undefined,
            input.to ? lte(invoice.invoiceDate, input.to) : undefined,
          ),
        )
        .orderBy(desc(invoice.createdAt))
        .limit(input.limit);
      return rows;
    }),
  get: billingProcedure("invoice.read")
    .input(z.object({ id }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(invoice)
        .where(and(eq(invoice.id, input.id), eq(invoice.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [sources, allocations, credits, events, pendingCancel] = await Promise.all([
        ctx.db
          .select({ plCode: invoiceSource.plCode, plRevision: invoiceSource.plRevision, packingListId: invoiceSource.packingListId, active: invoiceSource.active })
          .from(invoiceSource)
          .where(and(eq(invoiceSource.companyId, ctx.companyId), eq(invoiceSource.invoiceId, row.id))),
        ctx.db
          .select({ paymentId: payment.id, number: payment.number, receivedOn: payment.receivedOn, mode: payment.mode, amountPaise: paymentAllocation.amountPaise })
          .from(paymentAllocation)
          .innerJoin(payment, and(eq(payment.id, paymentAllocation.paymentId), eq(payment.companyId, paymentAllocation.companyId)))
          .where(and(eq(paymentAllocation.companyId, ctx.companyId), eq(paymentAllocation.invoiceId, row.id), eq(payment.status, "active"))),
        ctx.db
          .select({ id: invoice.id, number: invoice.number, status: invoice.status, totalPaise: invoice.totalPaise, invoiceDate: invoice.invoiceDate })
          .from(invoice)
          .where(and(eq(invoice.companyId, ctx.companyId), eq(invoice.againstInvoiceId, row.id), eq(invoice.kind, "credit_note"))),
        ctx.db
          .select({ action: billingEvent.action, outcome: billingEvent.outcome, code: billingEvent.code, message: billingEvent.message, at: billingEvent.at })
          .from(billingEvent)
          .where(and(eq(billingEvent.companyId, ctx.companyId), eq(billingEvent.invoiceId, row.id)))
          .orderBy(desc(billingEvent.at))
          .limit(20),
        ctx.db
          .select({ id: approval.id })
          .from(approval)
          .where(and(eq(approval.companyId, ctx.companyId), eq(approval.kind, "invoice_cancel"), eq(approval.subjectId, row.id), eq(approval.status, "pending")))
          .limit(1),
      ]);
      const paidPaise = allocations.reduce((n, a) => n + a.amountPaise, 0);
      const creditedPaise = credits.filter((c) => c.status === "issued").reduce((n, c) => n + c.totalPaise, 0);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        number: row.number,
        invoiceDate: row.invoiceDate,
        customerId: row.customerId,
        againstInvoiceId: row.againstInvoiceId,
        noteReason: row.noteReason,
        reason: row.reason,
        snapshot: row.snapshot as unknown as InvoiceSnapshot,
        needsIrn: row.needsIrn,
        irn: {
          status: row.irnStatus,
          irn: row.irn,
          ackNo: row.ackNo,
          ackDt: row.ackDt,
          signedQrCode: row.signedQrCode,
          attempts: row.irnAttempts,
          nextTryAt: row.irnNextTryAt,
          error: row.irnError,
          generatedAt: row.irnGeneratedAt,
        },
        ewb: { status: row.ewbStatus, number: row.ewbNo, date: row.ewbDate, validUntil: row.ewbValidUntil, distanceKm: row.distanceKm, vehicleNo: row.vehicleNo },
        cancel: { reason: row.cancelReason, at: row.cancelledAt, pendingApprovalId: pendingCancel[0]?.id ?? null },
        sources,
        allocations,
        credits,
        events,
        paidPaise,
        creditedPaise,
        outstandingPaise: row.kind === "invoice" && row.status === "issued" ? row.totalPaise - paidPaise - creditedPaise : 0,
      };
    }),
});

// ---------------------------------------------------------------------------
// Payments and outstanding (row 97)
// ---------------------------------------------------------------------------

const paymentsRouter = router({
  record: billingProcedure("payment.record")
    .input(
      z.object({
        customerId: id,
        receivedOn: ymd,
        amountPaise: paise.min(1),
        mode: z.enum(paymentModes),
        reference: text(60).nullish(),
        note: text(300).nullish(),
        allocations: z.array(z.object({ invoiceId: id, amountPaise: paise.min(1) })).max(40).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => recordPayment(bill(ctx), { ...input, reference: input.reference ?? null, note: input.note ?? null })),
  void: billingProcedure("payment.record")
    .input(z.object({ id, reason: text(300).min(3) }))
    .mutation(async ({ ctx, input }) => {
      await voidPayment(bill(ctx), input.id, input.reason);
      return { ok: true };
    }),
  list: billingProcedure("invoice.read", "payment.record")
    .input(z.object({ customerId: id.optional(), limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: payment.id,
          number: payment.number,
          customerId: payment.customerId,
          customerName: customer.name,
          receivedOn: payment.receivedOn,
          amountPaise: payment.amountPaise,
          mode: payment.mode,
          reference: payment.reference,
          status: payment.status,
          allocatedPaise: sql<number>`coalesce((select sum(pa.amount_paise) from payment_allocation pa where pa.payment_id = ${payment.id}), 0)`,
        })
        .from(payment)
        .innerJoin(customer, and(eq(customer.id, payment.customerId), eq(customer.companyId, payment.companyId)))
        .where(and(eq(payment.companyId, ctx.companyId), input.customerId ? eq(payment.customerId, input.customerId) : undefined))
        .orderBy(desc(payment.receivedOn), desc(payment.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({ ...r, allocatedPaise: Number(r.allocatedPaise) }));
    }),
});

const receivablesRouter = router({
  /** Per-customer outstanding with ageing buckets (0-30, 31-60, 61-90, 90+ days from invoice date). */
  outstanding: billingProcedure("invoice.read")
    .input(z.object({ asOf: ymd.optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const asOf = input.asOf ?? ymdText(await plantTz(bill(ctx)), Date.now());
      const invoices = await receivableInvoices(ctx.db, ctx.companyId);
      const onAccount = await onAccountByCustomer(ctx.db, ctx.companyId);
      const byCustomer = new Map<string, typeof invoices>();
      for (const i of invoices) byCustomer.set(i.customerId, [...(byCustomer.get(i.customerId) ?? []), i]);
      for (const c of onAccount.keys()) if (!byCustomer.has(c)) byCustomer.set(c, []);
      const names = await customerNames(ctx.db, ctx.companyId, [...byCustomer.keys()]);
      const rows = [...byCustomer.entries()]
        .map(([customerId, list]) => {
          const aged = ageInvoices(list, asOf);
          const advance = onAccount.get(customerId) ?? 0;
          return {
            customerId,
            customerName: names.get(customerId)?.name ?? "",
            openInvoices: list.filter((i) => invoiceOutstanding(i) !== 0).length,
            buckets: aged.buckets,
            invoicesDuePaise: aged.outstandingPaise,
            onAccountPaise: advance,
            balancePaise: aged.outstandingPaise - advance,
          };
        })
        .filter((r) => r.invoicesDuePaise !== 0 || r.onAccountPaise !== 0)
        .sort((a, b) => b.balancePaise - a.balancePaise);
      return { asOf, rows };
    }),
  /** Open invoices of one customer (for allocating a payment). */
  openInvoices: billingProcedure("invoice.read", "payment.record")
    .input(z.object({ customerId: id }))
    .query(async ({ ctx, input }) => {
      const list = await receivableInvoices(ctx.db, ctx.companyId, input.customerId);
      return list
        .map((i) => ({ id: i.id, number: i.number, invoiceDate: i.invoiceDate, totalPaise: i.totalPaise, duePaise: invoiceOutstanding(i) }))
        .filter((i) => i.duePaise > 0)
        .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
    }),
  /** Customer statement: opening balance, invoices, credit notes and payments, running balance. */
  statement: billingProcedure("invoice.read")
    .input(z.object({ customerId: id, from: ymd, to: ymd }))
    .query(async ({ ctx, input }) => {
      if (input.from > input.to) throw new TRPCError({ code: "BAD_REQUEST", message: "The start date is after the end date" });
      const [c] = await ctx.db
        .select({ id: customer.id, name: customer.name, gstin: customer.taxId, billingAddress: customer.billingAddress })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId)))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [docs, pays] = await Promise.all([
        ctx.db
          .select({ kind: invoice.kind, number: invoice.number, date: invoice.invoiceDate, totalPaise: invoice.totalPaise })
          .from(invoice)
          .where(and(eq(invoice.companyId, ctx.companyId), eq(invoice.customerId, c.id), eq(invoice.status, "issued"), lte(invoice.invoiceDate, input.to))),
        ctx.db
          .select({ number: payment.number, date: payment.receivedOn, amountPaise: payment.amountPaise })
          .from(payment)
          .where(and(eq(payment.companyId, ctx.companyId), eq(payment.customerId, c.id), eq(payment.status, "active"), lte(payment.receivedOn, input.to))),
      ]);
      const entries: StatementEntry[] = [
        ...docs.map((d) => ({
          date: d.date ?? "",
          kind: d.kind,
          number: d.number ?? "",
          debitPaise: d.kind === "invoice" ? d.totalPaise : 0,
          creditPaise: d.kind === "credit_note" ? d.totalPaise : 0,
        })),
        ...pays.map((p) => ({ date: p.date, kind: "payment" as const, number: p.number, debitPaise: 0, creditPaise: p.amountPaise })),
      ];
      const { plant } = await loadPlantGst(ctx.db, ctx.companyId);
      return {
        customer: { id: c.id, name: c.name, gstin: c.gstin },
        plant: plant ? { legalName: plant.legalName, gstin: plant.gstin, address: plant.address } : null,
        from: input.from,
        to: input.to,
        ...buildStatement(entries, input.from, input.to),
      };
    }),
});

// ---------------------------------------------------------------------------
// Accounts exports (row 97) and the offline e-way bill file (row 15 fallback)
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const rupees = (p: number) => (p / 100).toFixed(2);

const exportRouter = router({
  /** Tally XML: Sales and Credit Note vouchers for issued documents, Receipt vouchers for payments, one month. */
  tally: billingProcedure("export.accounts")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const { from, to } = monthRange(input.month);
      const [co] = await Promise.all([loadPlantGst(ctx.db, ctx.companyId)]);
      const [bs] = await ctx.db.select({ tallyLedgers: billingSettings.tallyLedgers }).from(billingSettings).where(eq(billingSettings.companyId, ctx.companyId)).limit(1);
      const ledgers = readTallyLedgers(bs?.tallyLedgers ?? null);
      const docs = await ctx.db
        .select()
        .from(invoice)
        .where(and(eq(invoice.companyId, ctx.companyId), eq(invoice.status, "issued"), gte(invoice.invoiceDate, from), lte(invoice.invoiceDate, to)))
        .orderBy(asc(invoice.invoiceDate), asc(invoice.seq));
      const pays = await ctx.db
        .select()
        .from(payment)
        .where(and(eq(payment.companyId, ctx.companyId), eq(payment.status, "active"), gte(payment.receivedOn, from), lte(payment.receivedOn, to)))
        .orderBy(asc(payment.receivedOn), asc(payment.seq));
      const allocs = pays.length
        ? await ctx.db
            .select({ paymentId: paymentAllocation.paymentId, amountPaise: paymentAllocation.amountPaise, number: invoice.number })
            .from(paymentAllocation)
            .innerJoin(invoice, and(eq(invoice.id, paymentAllocation.invoiceId), eq(invoice.companyId, paymentAllocation.companyId)))
            .where(and(eq(paymentAllocation.companyId, ctx.companyId), inArray(paymentAllocation.paymentId, pays.map((p) => p.id).slice(0, 90))))
        : [];
      const names = await customerNames(ctx.db, ctx.companyId, [...docs.map((d) => d.customerId), ...pays.map((p) => p.customerId)]);
      const vouchers: TallyVoucher[] = [
        ...docs.map((d): TallyVoucher => {
          const s = d.snapshot as unknown as InvoiceSnapshot;
          return {
            type: d.kind === "invoice" ? "Sales" : "Credit Note",
            number: d.number ?? "",
            date: d.invoiceDate ?? "",
            party: names.get(d.customerId)?.name ?? s.party.name,
            partyGstin: s.party.gstin,
            placeOfSupply: d.placeOfSupply,
            reference: s.against?.number ?? null,
            taxablePaise: d.taxablePaise,
            cgstPaise: d.cgstPaise,
            sgstPaise: d.sgstPaise,
            igstPaise: d.igstPaise,
            roundOffPaise: d.roundOffPaise,
            totalPaise: d.totalPaise,
            narration: s.sources.length ? `Packing lists ${s.sources.map((x) => x.plCode).join(", ")}` : (d.reason ?? ""),
          };
        }),
        ...pays.map(
          (p): TallyVoucher => ({
            type: "Receipt",
            number: p.number,
            date: p.receivedOn,
            party: names.get(p.customerId)?.name ?? "",
            mode: p.mode,
            amountPaise: p.amountPaise,
            against: allocs.filter((a) => a.paymentId === p.id).map((a) => ({ number: a.number ?? "", amountPaise: a.amountPaise })),
            narration: [p.mode.toUpperCase(), p.reference].filter(Boolean).join(" "),
          }),
        ),
      ];
      return { fileName: `orrn-tally-${input.month}.xml`, xml: tallyEnvelope(vouchers, ledgers, co.plant?.legalName ?? null), count: vouchers.length };
    }),
  /** GST sales register: one row per issued or cancelled invoice and credit note in the month. */
  salesRegister: billingProcedure("export.accounts", "invoice.read")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const { from, to } = monthRange(input.month);
      const docs = await ctx.db
        .select()
        .from(invoice)
        .where(and(eq(invoice.companyId, ctx.companyId), inArray(invoice.status, ["issued", "cancelled", "irn_pending"]), gte(invoice.invoiceDate, from), lte(invoice.invoiceDate, to)))
        .orderBy(asc(invoice.kind), asc(invoice.seq));
      const names = await customerNames(ctx.db, ctx.companyId, docs.map((d) => d.customerId));
      const head = ["Type", "Number", "Date", "Status", "Party", "GSTIN", "Place of supply", "Kg", "Taxable", "CGST", "SGST", "IGST", "Round off", "Total", "IRN", "Against"];
      const lines = docs.map((d) => {
        const s = d.snapshot as unknown as InvoiceSnapshot;
        const cancelled = d.status === "cancelled";
        const amt = (p: number) => (cancelled ? "0.00" : rupees(p));
        return [
          d.kind === "invoice" ? "Invoice" : "Credit note",
          d.number,
          d.invoiceDate,
          d.status,
          names.get(d.customerId)?.name ?? s.party.name,
          s.party.gstin ?? "",
          d.placeOfSupply,
          (d.weightG / 1000).toFixed(3),
          amt(d.taxablePaise),
          amt(d.cgstPaise),
          amt(d.sgstPaise),
          amt(d.igstPaise),
          amt(d.roundOffPaise),
          amt(d.totalPaise),
          d.irn ?? "",
          s.against?.number ?? "",
        ]
          .map(csvCell)
          .join(",");
      });
      return { fileName: `orrn-gst-sales-${input.month}.csv`, csv: [head.join(","), ...lines].join("\n") + "\n", count: docs.length };
    }),
  /**
   * The e-way bill portal's bulk upload JSON for issued invoices: works with no relay and no credentials
   * (the office uploads it on the portal by hand).
   */
  ewbJson: billingProcedure("invoice.issue")
    .input(z.object({ invoiceIds: z.array(id).min(1).max(50), distanceKm: z.number().int().min(0).max(4000).optional(), vehicleNo: text(15).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(invoice)
        .where(and(eq(invoice.companyId, ctx.companyId), inArray(invoice.id, input.invoiceIds)));
      if (rows.length !== new Set(input.invoiceIds).size) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const bills = rows.map((r) => {
        if (r.kind !== "invoice" || (r.status !== "issued" && r.status !== "irn_pending") || !r.number || !r.invoiceDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only issued invoices go in the e-way bill file" });
        }
        const s = r.snapshot as unknown as InvoiceSnapshot;
        return ewbOfflineBill({
          invoiceNumber: r.number,
          invoiceDate: r.invoiceDate,
          supplyType: s.supplyType,
          seller: sellerParty(s),
          buyer: buyerParty(s),
          shipTo: s.party.shipTo,
          totals: s.totals,
          distanceKm: input.distanceKm ?? s.party.distanceKm ?? 0,
          vehicleNo: input.vehicleNo ?? r.vehicleNo ?? s.vehicleNo,
          transporterName: null,
          transporterId: null,
        });
      });
      return { fileName: `orrn-ewb-${rows.length}.json`, json: JSON.stringify(ewbOfflineFile(bills), null, 2) };
    }),
});

export const billingRouter = router({
  settings: settingsRouter,
  hsn: hsnRouter,
  party: partyRouter,
  invoices: invoicesRouter,
  payments: paymentsRouter,
  receivables: receivablesRouter,
  export: exportRouter,
});
