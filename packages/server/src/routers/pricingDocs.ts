/**
 * XE-PRICE (lane PRICE): the documents built on the price master, spread into `pricing.*`.
 *
 * - `quotes.*` (row 10): a customer, lines priced by the master, a validity date and a `Q-{n}`
 *   number per FY; converts to a booking sales order through `createSalesOrder` (replay key
 *   `quote:<id>`, so a retried convert makes one order).
 * - `proforma.*` (row 11): a numbered `PI-{n}` print of a confirmed order or a quote, frozen as a
 *   snapshot with GST shown as an estimate. Not a tax invoice and not a ledger document.
 * - `worksOrder.*` (row 12): what to make for production and dispatch, no prices, `WO-{n}` once per order.
 * - `enquiries.*` (row 19): a light enquiry list with follow-up dates; overdue ones reach Today.
 *
 * Module `pricing` on every procedure. Prices are read only with `price.view`; the works order
 * carries no price and is open to every member, like `orders.get`.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { customer } from "@orrn/db/schema/customers";
import { enquiry, proforma, quote, quoteLine, worksOrder } from "@orrn/db/schema/pricing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import {
  addDaysYmd,
  ENQUIRY_STATUSES,
  enquiryOverdue,
  lineAmountPaise,
  MAX_RATE_PAISE,
  OPEN_ENQUIRY_STATUSES,
  proformaTotals,
  quoteExpired,
  readFloorSettings,
  type EnquiryStatus,
  type PriceBreakup,
  type QuoteStatus,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { allocateDocNumbers } from "../lib/docNumber";
import { can } from "../lib/permissions";
import { loadPricingRows, masterReady, priceLines, pricingCompany, pricingToday } from "../lib/pricing";
import { assertOrderPrice, bad, MASTER_NOT_READY, notFound, pricingOn, sectionInfo, ymd } from "../lib/pricingKit";
import { nextCompanySeq } from "../lib/sequence";
import { getPlantBankForPrint, proformaBank } from "../lib/plantPrint";
import { createSalesOrder } from "./salesOrder";

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const quoteLineInput = z.object({
  sectionId: id,
  cutLengthMm: z.number().int().min(1).max(30_000),
  pcs: z.number().int().min(1).max(10_000_000).nullish(),
  kgG: z.number().int().min(1, "Weight must be more than 0").max(1_000_000_000),
  finish: text(40).nullish(),
  alloy: text(16).nullish(),
  temper: text(8).nullish(),
  componentKeys: z.array(z.string().min(1).max(60)).max(20).optional(),
  /** A rate above the master's (never below: a lower rate is a customer term or an order override). */
  ratePaise: z.number().int().min(0).max(MAX_RATE_PAISE).nullish(),
  note: text(300).nullish(),
});
const quoteInput = z.object({
  customerId: id,
  quoteDate: ymd.optional(),
  validUntil: ymd.optional(),
  note: text(1000).nullish(),
  enquiryId: id.nullish(),
  lines: z.array(quoteLineInput).min(1, "Add at least one line").max(100, "At most 100 lines"),
});

const BELOW_MASTER = "A quote line can't go below the master rate. Add a customer term, or override the rate on the order";

async function customerRow(db: OrrnDb, companyId: string, customerId: string) {
  const row = await db
    .select({ id: customer.id, name: customer.name, taxId: customer.taxId, billingAddress: customer.billingAddress })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
    .get();
  if (!row) notFound();
  return row!;
}

/** Price a quote's lines with the master on the quote date; refuse a typed rate below the master. */
async function priceQuote(db: OrrnDb, companyId: string, input: z.infer<typeof quoteInput>, quoteDate: string) {
  const co = await pricingCompany(db, companyId);
  const rows = await loadPricingRows(db, companyId, { onDate: quoteDate, metalSource: co.pricing.metalSource, customerId: input.customerId });
  if (!masterReady(rows, co.pricing.metalSource, quoteDate)) bad(MASTER_NOT_READY);
  const sections = await sectionInfo(db, companyId, input.lines.map((l) => l.sectionId));
  const lines = input.lines.map((l) => {
    const s = sections.get(l.sectionId);
    if (!s) notFound();
    return { ...l, section: s!, alloy: blank(l.alloy) ?? s!.alloy, temper: blank(l.temper) ?? s!.temper, finish: blank(l.finish) };
  });
  const priced = priceLines(
    rows,
    { onDate: quoteDate, metalSource: co.pricing.metalSource, customerId: input.customerId },
    lines.map((l) => ({ dieId: l.sectionId, series: l.section.series, alloy: l.alloy, finish: l.finish, kgG: l.kgG, pcs: l.pcs ?? null, componentKeys: l.componentKeys })),
  );
  const out = lines.map((l, i) => {
    const r = priced[i]!;
    if (!r.ok) bad(MASTER_NOT_READY);
    const breakup = (r as { ok: true; breakup: PriceBreakup }).breakup;
    if (l.ratePaise != null && l.ratePaise < breakup.computedPaisePerKg) bad(BELOW_MASTER);
    const rate = l.ratePaise ?? breakup.computedPaisePerKg;
    return { line: l, breakup: { ...breakup, finalPaisePerKg: rate }, ratePaise: rate };
  });
  // Whole-order add-ons as priced (they are spread into the line rates; this is for the print).
  const charges = new Map<string, { key: string; label: string; paise: number; rateId: string | null }>();
  for (const o of out) for (const c of o.breakup.components) if (c.basis === "order") charges.set(c.key, { key: c.key, label: c.label, paise: c.paise, rateId: c.rateId });
  return { lines: out, charges: [...charges.values()], settings: co };
}

async function loadQuote(db: OrrnDb, companyId: string, quoteId: string) {
  const row = await db.select().from(quote).where(and(eq(quote.id, quoteId), eq(quote.companyId, companyId))).get();
  if (!row) notFound();
  return row!;
}

async function quoteLines(db: OrrnDb, companyId: string, quoteId: string) {
  return db.select().from(quoteLine).where(and(eq(quoteLine.companyId, companyId), eq(quoteLine.quoteId, quoteId))).orderBy(asc(quoteLine.lineNo));
}

function quoteLineRows(companyId: string, quoteId: string, lines: Awaited<ReturnType<typeof priceQuote>>["lines"]) {
  return lines.map((l, i) => ({
    id: crypto.randomUUID(),
    companyId,
    quoteId,
    lineNo: i + 1,
    dieId: l.line.sectionId,
    cutLengthMm: l.line.cutLengthMm,
    pcs: l.line.pcs ?? null,
    kgG: l.line.kgG,
    finish: l.line.finish,
    alloy: l.line.alloy,
    temper: l.line.temper,
    ratePaise: l.ratePaise,
    priceBreakup: l.breakup as unknown as Record<string, unknown>,
    note: blank(l.line.note),
  }));
}

async function assertEnquiry(db: OrrnDb, companyId: string, enquiryId: string) {
  const row = await db.select({ id: enquiry.id }).from(enquiry).where(and(eq(enquiry.id, enquiryId), eq(enquiry.companyId, companyId))).get();
  if (!row) notFound();
}

const proformaSource = z.object({ source: z.enum(["order", "quote"]), id });

/** The lines a proforma prints, with their rates; a line without a rate is refused by number. */
async function proformaLines(db: OrrnDb, companyId: string, src: z.infer<typeof proformaSource>) {
  if (src.source === "quote") {
    const q = await loadQuote(db, companyId, src.id);
    if (q.status === "cancelled") bad("This quote was cancelled");
    const lines = await quoteLines(db, companyId, q.id);
    return { customerId: q.customerId, number: q.number, date: q.quoteDate, charges: q.charges ?? [], lines: lines.map((l) => ({ ...l, breakup: l.priceBreakup as PriceBreakup | null })) };
  }
  const o = await db.select().from(salesOrder).where(and(eq(salesOrder.id, src.id), eq(salesOrder.companyId, companyId))).get();
  if (!o) notFound();
  if (o!.status !== "confirmed" && o!.status !== "dispatching") bad("A proforma is made from a confirmed order");
  const lines = await db.select().from(salesOrderLine).where(and(eq(salesOrderLine.companyId, companyId), eq(salesOrderLine.salesOrderId, o!.id))).orderBy(asc(salesOrderLine.lineNo));
  const unrated = lines.filter((l) => l.ratePaise == null).map((l) => l.lineNo);
  if (unrated.length > 0) bad(`Line ${unrated.join(", ")} has no rate yet`);
  return {
    customerId: o!.customerId,
    number: o!.number,
    date: o!.orderDate,
    poNumber: o!.poNumber,
    charges: [] as Record<string, unknown>[],
    lines: lines.map((l) => ({ ...l, ratePaise: l.ratePaise!, breakup: l.priceBreakup as PriceBreakup | null })),
  };
}

const enquiryInput = z.object({
  customerId: id.nullish(),
  prospectName: text(120).nullish(),
  contact: text(120).nullish(),
  sectionId: id.nullish(),
  sectionText: text(120).nullish(),
  kgG: z.number().int().min(1).max(1_000_000_000).nullish(),
  followUpDate: ymd.nullish(),
  note: text(1000).nullish(),
});

/** Re-check X1: the longest a quote may stay valid; a quote is never dated before today. */
export const MAX_QUOTE_VALID_DAYS = 90;
function assertQuoteWindow(today: string, quoteDate: string, validUntil: string): void {
  if (quoteDate < today) bad("A quote can't be dated before today. Prices come from the master on its date");
  if (validUntil > addDaysYmd(quoteDate, MAX_QUOTE_VALID_DAYS)) bad(`A quote can stay valid for at most ${MAX_QUOTE_VALID_DAYS} days`);
}

export const pricingDocsProcedures = {
  quotes: router({
    list: actionProcedure("price.view")
      .input(
        z.object({
          status: z.enum(["draft", "sent", "converted", "cancelled", "expired"]).optional(),
          customerId: id.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const today = pricingToday(co.settings, clockNow());
        const where = and(
          eq(quote.companyId, ctx.companyId),
          input.customerId ? eq(quote.customerId, input.customerId) : undefined,
          input.status === "expired"
            ? and(inArray(quote.status, ["draft", "sent"]), lt(quote.validUntil, today))
            : input.status
              ? eq(quote.status, input.status)
              : undefined,
        );
        const rows = await ctx.db
          .select({
            id: quote.id,
            number: quote.number,
            period: quote.period,
            customerId: quote.customerId,
            customerName: customer.name,
            quoteDate: quote.quoteDate,
            validUntil: quote.validUntil,
            status: quote.status,
            salesOrderId: quote.salesOrderId,
            kgG: sql<number>`(select coalesce(sum(ql.kg_g), 0) from quote_line ql where ql.company_id = ${ctx.companyId} and ql.quote_id = "quote"."id")`,
            amountPaise: sql<number>`(select coalesce(sum((ql.kg_g * ql.rate_paise + 500) / 1000), 0) from quote_line ql where ql.company_id = ${ctx.companyId} and ql.quote_id = "quote"."id")`,
          })
          .from(quote)
          .innerJoin(customer, and(eq(customer.id, quote.customerId), eq(customer.companyId, quote.companyId)))
          .where(where)
          .orderBy(desc(quote.createdAt))
          .limit(input.limit + 1)
          .offset(input.offset);
        const page = rows.slice(0, input.limit);
        return {
          items: page.map((r) => ({ ...r, kgG: Number(r.kgG), amountPaise: Number(r.amountPaise), expired: quoteExpired({ status: r.status as QuoteStatus, validUntil: r.validUntil }, today) })),
          nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
        };
      }),

    get: actionProcedure("price.view")
      .input(z.object({ id }))
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        const q = await loadQuote(ctx.db, ctx.companyId, input.id);
        const lines = await quoteLines(ctx.db, ctx.companyId, q.id);
        const cust = await customerRow(ctx.db, ctx.companyId, q.customerId);
        const sections = await sectionInfo(ctx.db, ctx.companyId, lines.map((l) => l.dieId));
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const today = pricingToday(co.settings, clockNow());
        const order = q.salesOrderId
          ? await ctx.db.select({ id: salesOrder.id, number: salesOrder.number, period: salesOrder.period }).from(salesOrder).where(and(eq(salesOrder.id, q.salesOrderId), eq(salesOrder.companyId, ctx.companyId))).get()
          : null;
        return {
          quote: { ...q, expired: quoteExpired({ status: q.status as QuoteStatus, validUntil: q.validUntil }, today) },
          customer: cust,
          order: order ?? null,
          letterhead: readFloorSettings(co.settings).letterhead,
          lines: lines.map((l) => {
            const s = sections.get(l.dieId);
            return { ...l, sectionCode: s?.code ?? null, sectionName: s?.name ?? null, amountPaise: lineAmountPaise(l.kgG, l.ratePaise), priceBreakup: l.priceBreakup as PriceBreakup | null };
          }),
          totals: proformaTotals(lines.map((l) => ({ kgG: l.kgG, paisePerKg: l.ratePaise })), 0),
        };
      }),

    create: actionProcedure("quote.manage")
      .input(quoteInput)
      .mutation(async ({ ctx, input }) => {
        await customerRow(ctx.db, ctx.companyId, input.customerId);
        if (input.enquiryId) await assertEnquiry(ctx.db, ctx.companyId, input.enquiryId);
        const at = clockNow();
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const today = pricingToday(co.settings, at);
        const quoteDate = input.quoteDate ?? today;
        const validUntil = input.validUntil ?? addDaysYmd(quoteDate, co.pricing.quoteValidDays);
        if (validUntil < quoteDate) bad("The quote can't run out before its date");
        assertQuoteWindow(today, quoteDate, validUntil);
        const priced = await priceQuote(ctx.db, ctx.companyId, input, quoteDate);
        const { period, numbers } = await allocateDocNumbers(ctx.db, ctx.companyId, "quote", at, 1, ctx.session.user.id);
        const quoteId = crypto.randomUUID();
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db.insert(quote).values({
            id: quoteId,
            companyId: ctx.companyId,
            serverSeq: seq,
            period,
            number: numbers[0]!,
            customerId: input.customerId,
            quoteDate,
            validUntil,
            status: "draft",
            note: blank(input.note),
            charges: priced.charges,
            salesOrderId: null,
            enquiryId: input.enquiryId ?? null,
            createdBy: ctx.session.user.id,
          }),
          ...quoteLineRows(ctx.companyId, quoteId, priced.lines).map((r) => ctx.db.insert(quoteLine).values(r)),
          ...(input.enquiryId
            ? [
                ctx.db
                  .update(enquiry)
                  .set({ quoteId, status: sql`case when ${enquiry.status} = 'open' then 'quoted' else ${enquiry.status} end`, serverSeq: seq })
                  .where(and(eq(enquiry.id, input.enquiryId), eq(enquiry.companyId, ctx.companyId))),
              ]
            : []),
          auditInsert(ctx, { action: "quote.create", subjectType: "quote", subjectId: quoteId, meta: { number: numbers[0], period, lines: priced.lines.length, enquiryId: input.enquiryId ?? null } }),
        ]);
        return { id: quoteId, number: numbers[0]!, period };
      }),

    /** A draft is priced again from the master on its date with the new lines. */
    update: actionProcedure("quote.manage")
      .input(quoteInput.extend({ id, serverSeq: z.number().int().nonnegative() }))
      .mutation(async ({ ctx, input }) => {
        const q = await loadQuote(ctx.db, ctx.companyId, input.id);
        if (q.status !== "draft") bad("Only a draft quote can be changed");
        if (q.serverSeq !== input.serverSeq) bad("This quote changed meanwhile. Reload and try again.");
        if (input.customerId !== q.customerId) await customerRow(ctx.db, ctx.companyId, input.customerId);
        const quoteDate = input.quoteDate ?? q.quoteDate;
        const validUntil = input.validUntil ?? q.validUntil;
        if (validUntil < quoteDate) bad("The quote can't run out before its date");
        {
          const today = pricingToday((await pricingCompany(ctx.db, ctx.companyId)).settings, clockNow());
          // A date kept as it was may lie in the past (an older draft); a changed date follows the create rule.
          if (quoteDate !== q.quoteDate) assertQuoteWindow(today, quoteDate, validUntil);
          else if (validUntil !== q.validUntil) assertQuoteWindow(today, quoteDate < today ? today : quoteDate, validUntil);
        }
        const priced = await priceQuote(ctx.db, ctx.companyId, input, quoteDate);
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        const landed = and(eq(quote.id, q.id), eq(quote.companyId, ctx.companyId), eq(quote.serverSeq, seq));
        await atomicBatch(ctx.db, [
          ctx.db
            .update(quote)
            .set({ customerId: input.customerId, quoteDate, validUntil, note: blank(input.note), charges: priced.charges, serverSeq: seq })
            .where(and(eq(quote.id, q.id), eq(quote.companyId, ctx.companyId), eq(quote.status, "draft"), eq(quote.serverSeq, q.serverSeq))),
          ctx.db.delete(quoteLine).where(and(eq(quoteLine.companyId, ctx.companyId), eq(quoteLine.quoteId, q.id), sql`exists (select 1 from quote x where x.id = ${q.id} and x.company_id = ${ctx.companyId} and x.server_seq = ${seq})`)),
          ...quoteLineRows(ctx.companyId, q.id, priced.lines).map((r) =>
            ctx.db.insert(quoteLine).select(
              ctx.db
                .select({
                  id: sql<string>`${r.id}`.as("id"),
                  companyId: sql<string>`${r.companyId}`.as("company_id"),
                  quoteId: sql<string>`${r.quoteId}`.as("quote_id"),
                  lineNo: sql<number>`${r.lineNo}`.as("line_no"),
                  dieId: sql<string>`${r.dieId}`.as("die_id"),
                  cutLengthMm: sql<number>`${r.cutLengthMm}`.as("cut_length_mm"),
                  pcs: sql<number | null>`${r.pcs}`.as("pcs"),
                  kgG: sql<number>`${r.kgG}`.as("kg_g"),
                  finish: sql<string | null>`${r.finish}`.as("finish"),
                  alloy: sql<string | null>`${r.alloy}`.as("alloy"),
                  temper: sql<string | null>`${r.temper}`.as("temper"),
                  ratePaise: sql<number>`${r.ratePaise}`.as("rate_paise"),
                  priceBreakup: sql<string>`${JSON.stringify(r.priceBreakup)}`.as("price_breakup"),
                  note: sql<string | null>`${r.note}`.as("note"),
                })
                .from(quote)
                .where(landed),
            ),
          ),
          auditInsert(ctx, { action: "quote.update", subjectType: "quote", subjectId: q.id, meta: { number: q.number, lines: priced.lines.length } }),
        ]);
        const after = await loadQuote(ctx.db, ctx.companyId, q.id);
        if (after.serverSeq !== seq) bad("This quote changed meanwhile. Reload and try again.");
        return { id: q.id };
      }),

    /** draft → sent (it went to the buyer); sent → cancelled or draft → cancelled. */
    setStatus: actionProcedure("quote.manage")
      .input(z.object({ id, status: z.enum(["sent", "cancelled"]), reason: text(300).nullish() }))
      .mutation(async ({ ctx, input }) => {
        const q = await loadQuote(ctx.db, ctx.companyId, input.id);
        const from: QuoteStatus[] = input.status === "sent" ? ["draft"] : ["draft", "sent"];
        if (!from.includes(q.status as QuoteStatus)) bad(`This quote is ${q.status}`);
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(quote)
            .set({ status: input.status, serverSeq: seq })
            .where(and(eq(quote.id, q.id), eq(quote.companyId, ctx.companyId), inArray(quote.status, from))),
          auditInsert(ctx, { action: `quote.${input.status === "sent" ? "send" : "cancel"}`, subjectType: "quote", subjectId: q.id, meta: { number: q.number, reason: blank(input.reason) } }),
        ]);
        return { id: q.id, status: input.status };
      }),

    /**
     * A quote becomes a booking sales order (lines, rates where the plant puts rates on orders). One
     * order per quote: the replay key `quote:<id>` makes a retry return the same order.
     */
    convert: actionProcedure("quote.manage")
      .input(z.object({ id, poNumber: text(100).nullish() }))
      .mutation(async ({ ctx, input }) => {
        if (!can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.manage")) {
          bad("Your role can't make sales orders");
        }
        const q = await loadQuote(ctx.db, ctx.companyId, input.id);
        if (q.status === "converted" && q.salesOrderId) {
          const o = await ctx.db.select({ id: salesOrder.id, number: salesOrder.number }).from(salesOrder).where(and(eq(salesOrder.id, q.salesOrderId), eq(salesOrder.companyId, ctx.companyId))).get();
          if (o) return { orderId: o.id, number: o.number, replayed: true };
        }
        if (q.status !== "draft" && q.status !== "sent") bad(`This quote is ${q.status}`);
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const today = pricingToday(co.settings, clockNow());
        if (q.validUntil < today) bad(`This quote ran out on ${q.validUntil}. Make a new one`);
        const lines = await quoteLines(ctx.db, ctx.companyId, q.id);
        const withRates = co.priceOnSalesOrder && can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.price");
        const made = await createSalesOrder(
          ctx,
          {
            customerId: q.customerId,
            poNumber: blank(input.poNumber),
            note: `From quote ${q.number}`,
            lines: lines.map((l) => ({
              sectionId: l.dieId,
              cutLengthMm: l.cutLengthMm,
              pcs: l.pcs,
              kgG: l.kgG,
              finish: l.finish,
              alloy: l.alloy,
              temper: l.temper,
              note: l.note,
              ...(withRates ? { ratePaise: l.ratePaise } : {}),
            })),
            clientRequestId: `quote:${q.id}`,
          },
          { canPrice: withRates, source: "office" },
        );
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        // Review B1: the order keeps the quote's prices. Each line takes its quote line's breakdown
        // (marked with the quote), and confirm freezes it as is instead of pricing it again. Written
        // only while the order is still a booking and the line has no breakdown yet, so a replayed
        // convert writes it once and never over a later decision.
        const keepQuoted = withRates
          ? lines.map((l, i) =>
              ctx.db
                .update(salesOrderLine)
                .set({
                  ratePaise: l.ratePaise,
                  priceBreakup: { ...(l.priceBreakup as Record<string, unknown>), quote: { id: q.id, number: q.number, lineNo: l.lineNo } },
                })
                .where(
                  and(
                    eq(salesOrderLine.companyId, ctx.companyId),
                    eq(salesOrderLine.salesOrderId, made.id),
                    eq(salesOrderLine.lineNo, i + 1),
                    isNull(salesOrderLine.priceBreakup),
                    sql`exists (select 1 from sales_order o where o.id = ${made.id} and o.company_id = ${ctx.companyId} and o.status = 'booking')`,
                  ),
                ),
            )
          : [];
        await atomicBatch(ctx.db, [
          ...keepQuoted,
          ctx.db
            .update(quote)
            .set({ status: "converted", salesOrderId: made.id, serverSeq: seq })
            .where(and(eq(quote.id, q.id), eq(quote.companyId, ctx.companyId), inArray(quote.status, ["draft", "sent"]))),
          ...(q.enquiryId
            ? [ctx.db.update(enquiry).set({ status: "won", serverSeq: seq }).where(and(eq(enquiry.id, q.enquiryId), eq(enquiry.companyId, ctx.companyId), inArray(enquiry.status, ["open", "quoted"])))]
            : []),
          auditInsert(ctx, { action: "quote.convert", subjectType: "quote", subjectId: q.id, meta: { number: q.number, orderId: made.id, orderNumber: made.number } }),
        ]);
        return { orderId: made.id, number: made.number, replayed: made.replayed };
      }),
  }),

  proforma: router({
    /**
     * Number and freeze a proforma of a confirmed order or a quote: lines and rates as they are now,
     * GST as an estimate at the plant's percent, the plant bank line. Every call is a new number.
     */
    create: actionProcedure("quote.manage")
      .input(proformaSource)
      .mutation(async ({ ctx, input }) => {
        // Review B2: an order's proforma carries its line rates.
        if (input.source === "order") assertOrderPrice(ctx);
        const src = await proformaLines(ctx.db, ctx.companyId, input);
        const cust = await customerRow(ctx.db, ctx.companyId, src.customerId);
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const sections = await sectionInfo(ctx.db, ctx.companyId, src.lines.map((l) => l.dieId));
        const at = clockNow();
        const date = pricingToday(co.settings, at);
        const totals = proformaTotals(src.lines.map((l) => ({ kgG: l.kgG, paisePerKg: l.ratePaise })), co.pricing.estimatedGstBp);
        const { period, numbers } = await allocateDocNumbers(ctx.db, ctx.companyId, "proforma", at, 1, ctx.session.user.id);
        const snapshot = {
          v: 1,
          number: numbers[0]!,
          date,
          source: { kind: input.source, id: input.id, number: src.number, date: src.date, poNumber: "poNumber" in src ? (src.poNumber ?? null) : null },
          letterhead: readFloorSettings(co.settings).letterhead,
          customer: { id: cust.id, name: cust.name, gstin: cust.taxId, billingAddress: cust.billingAddress ?? null },
          lines: src.lines.map((l) => {
            const s = sections.get(l.dieId);
            return {
              lineNo: l.lineNo,
              sectionCode: s?.code ?? null,
              sectionName: s?.name ?? null,
              alloy: l.alloy,
              temper: l.temper,
              finish: l.finish,
              cutLengthMm: l.cutLengthMm,
              pcs: l.pcs,
              kgG: l.kgG,
              ratePaise: l.ratePaise,
              amountPaise: lineAmountPaise(l.kgG, l.ratePaise),
              breakup: l.breakup
                ? {
                    metalPaisePerKg: l.breakup.metal.paisePerKg,
                    metalSource: l.breakup.metal.source,
                    conversionPaisePerKg: l.breakup.conversion.paisePerKg,
                    alloyPaisePerKg: l.breakup.alloy.paisePerKg,
                    finishPaisePerKg: l.breakup.finish.paisePerKg,
                    componentsPaisePerKg: l.breakup.componentsPaisePerKg,
                    discountPaisePerKg: l.breakup.discountPaisePerKg,
                  }
                : null,
            };
          }),
          charges: src.charges,
          totals,
          // XE ADM contract 4: the plant's default live bank account, frozen with the proforma (null: "not set").
          bank: proformaBank(await getPlantBankForPrint(ctx.db, ctx.companyId)),
        };
        const pid = crypto.randomUUID();
        await atomicBatch(ctx.db, [
          ctx.db.insert(proforma).values({ id: pid, companyId: ctx.companyId, period, number: numbers[0]!, sourceKind: input.source, sourceId: input.id, customerId: cust.id, snapshot, createdBy: ctx.session.user.id }),
          auditInsert(ctx, { action: "proforma.create", subjectType: "proforma", subjectId: pid, meta: { number: numbers[0], period, source: input.source, sourceId: input.id, totalPaise: totals.totalPaise } }),
        ]);
        return { id: pid, number: numbers[0]!, snapshot };
      }),

    list: actionProcedure("price.view")
      .input(proformaSource)
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        if (input.source === "order") assertOrderPrice(ctx);
        return ctx.db
          .select({ id: proforma.id, number: proforma.number, createdAt: proforma.createdAt })
          .from(proforma)
          .where(and(eq(proforma.companyId, ctx.companyId), eq(proforma.sourceKind, input.source), eq(proforma.sourceId, input.id)))
          .orderBy(desc(proforma.createdAt))
          .limit(50);
      }),

    get: actionProcedure("price.view")
      .input(z.object({ id }))
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        const row = await ctx.db.select().from(proforma).where(and(eq(proforma.id, input.id), eq(proforma.companyId, ctx.companyId))).get();
        if (!row) notFound();
        if (row!.sourceKind === "order") assertOrderPrice(ctx);
        return row!;
      }),
  }),

  worksOrder: router({
    /** What to make, from the live order: no prices, open to every member like `orders.get`. */
    get: companyProcedure.input(z.object({ orderId: id })).query(async ({ ctx, input }) => {
      await pricingOn(ctx);
      const o = await ctx.db
        .select({
          id: salesOrder.id,
          number: salesOrder.number,
          period: salesOrder.period,
          status: salesOrder.status,
          orderDate: salesOrder.orderDate,
          expectedDate: salesOrder.expectedDate,
          poNumber: salesOrder.poNumber,
          note: salesOrder.note,
          customerName: customer.name,
        })
        .from(salesOrder)
        .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, salesOrder.companyId)))
        .where(and(eq(salesOrder.id, input.orderId), eq(salesOrder.companyId, ctx.companyId)))
        .get();
      if (!o) notFound();
      // Explicit projection: never rate_paise or price_breakup.
      const lines = await ctx.db
        .select({
          lineNo: salesOrderLine.lineNo,
          dieId: salesOrderLine.dieId,
          cutLengthMm: salesOrderLine.cutLengthMm,
          pcs: salesOrderLine.pcs,
          kgG: salesOrderLine.kgG,
          kgPer12ftMilli: salesOrderLine.kgPer12ftMilli,
          finish: salesOrderLine.finish,
          alloy: salesOrderLine.alloy,
          temper: salesOrderLine.temper,
          tierRank: salesOrderLine.tierRank,
          note: salesOrderLine.note,
        })
        .from(salesOrderLine)
        .where(and(eq(salesOrderLine.companyId, ctx.companyId), eq(salesOrderLine.salesOrderId, o!.id)))
        .orderBy(asc(salesOrderLine.lineNo));
      const sections = await sectionInfo(ctx.db, ctx.companyId, lines.map((l) => l.dieId));
      const wo = await ctx.db.select({ number: worksOrder.number, period: worksOrder.period }).from(worksOrder).where(and(eq(worksOrder.companyId, ctx.companyId), eq(worksOrder.salesOrderId, o!.id))).get();
      const co = await pricingCompany(ctx.db, ctx.companyId);
      const floor = readFloorSettings(co.settings);
      return {
        order: o!,
        worksOrder: wo ?? null,
        letterhead: floor.letterhead,
        lines: lines.map((l) => ({ ...l, sectionCode: sections.get(l.dieId)?.code ?? null, sectionName: sections.get(l.dieId)?.name ?? null })),
      };
    }),

    /** Take the order's works order number (once; a second call returns the same number). */
    issue: anyActionProcedure("order.manage", "order.plan")
      .input(z.object({ orderId: id }))
      .mutation(async ({ ctx, input }) => {
        const o = await ctx.db.select({ id: salesOrder.id, status: salesOrder.status, number: salesOrder.number }).from(salesOrder).where(and(eq(salesOrder.id, input.orderId), eq(salesOrder.companyId, ctx.companyId))).get();
        if (!o) notFound();
        const existing = await ctx.db.select({ number: worksOrder.number, period: worksOrder.period }).from(worksOrder).where(and(eq(worksOrder.companyId, ctx.companyId), eq(worksOrder.salesOrderId, o!.id))).get();
        if (existing) return { ...existing, replayed: true };
        if (o!.status !== "confirmed" && o!.status !== "dispatching") bad("A works order is made from a confirmed order");
        const at = clockNow();
        const { period, numbers } = await allocateDocNumbers(ctx.db, ctx.companyId, "works_order", at, 1, ctx.session.user.id);
        const woId = crypto.randomUUID();
        await atomicBatch(ctx.db, [
          ctx.db.insert(worksOrder).values({ id: woId, companyId: ctx.companyId, salesOrderId: o!.id, period, number: numbers[0]!, createdBy: ctx.session.user.id }).onConflictDoNothing(),
          auditInsert(ctx, { action: "works_order.issue", subjectType: "sales_order", subjectId: o!.id, meta: { number: numbers[0], period, orderNumber: o!.number } }),
        ]);
        const row = await ctx.db.select({ number: worksOrder.number, period: worksOrder.period }).from(worksOrder).where(and(eq(worksOrder.companyId, ctx.companyId), eq(worksOrder.salesOrderId, o!.id))).get();
        return { ...row!, replayed: row!.number !== numbers[0] };
      }),
  }),

  enquiries: router({
    list: anyActionProcedure("enquiry.manage", "price.view")
      .input(
        z.object({
          status: z.enum(ENQUIRY_STATUSES).optional(),
          open: z.boolean().optional(),
          overdue: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const today = pricingToday(co.settings, clockNow());
        const where = and(
          eq(enquiry.companyId, ctx.companyId),
          input.status ? eq(enquiry.status, input.status) : undefined,
          input.open || input.overdue ? inArray(enquiry.status, [...OPEN_ENQUIRY_STATUSES]) : undefined,
          input.overdue ? lt(enquiry.followUpDate, today) : undefined,
        );
        const rows = await ctx.db
          .select({
            id: enquiry.id,
            customerId: enquiry.customerId,
            customerName: customer.name,
            prospectName: enquiry.prospectName,
            contact: enquiry.contact,
            sectionId: enquiry.dieId,
            sectionText: enquiry.sectionText,
            kgG: enquiry.kgG,
            followUpDate: enquiry.followUpDate,
            status: enquiry.status,
            quoteId: enquiry.quoteId,
            quoteNumber: quote.number,
            note: enquiry.note,
            serverSeq: enquiry.serverSeq,
            createdAt: enquiry.createdAt,
          })
          .from(enquiry)
          .leftJoin(customer, and(eq(customer.id, enquiry.customerId), eq(customer.companyId, enquiry.companyId)))
          .leftJoin(quote, and(eq(quote.id, enquiry.quoteId), eq(quote.companyId, enquiry.companyId)))
          .where(where)
          .orderBy(sql`case when ${enquiry.followUpDate} is null then 1 else 0 end`, asc(enquiry.followUpDate), desc(enquiry.createdAt))
          .limit(input.limit + 1)
          .offset(input.offset);
        const page = rows.slice(0, input.limit);
        const sections = await sectionInfo(ctx.db, ctx.companyId, page.map((r) => r.sectionId).filter((v): v is string => Boolean(v)));
        return {
          today,
          items: page.map((r) => ({
            ...r,
            sectionCode: r.sectionId ? (sections.get(r.sectionId)?.code ?? null) : null,
            overdue: enquiryOverdue({ status: r.status as EnquiryStatus, followUpDate: r.followUpDate }, today),
          })),
          nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
        };
      }),

    create: actionProcedure("enquiry.manage")
      .input(enquiryInput)
      .mutation(async ({ ctx, input }) => {
        if (!input.customerId && !blank(input.prospectName)) bad("Name the customer or the buyer");
        if (input.customerId) await customerRow(ctx.db, ctx.companyId, input.customerId);
        if (input.sectionId) {
          const s = await sectionInfo(ctx.db, ctx.companyId, [input.sectionId]);
          if (!s.has(input.sectionId)) notFound();
        }
        const eid = crypto.randomUUID();
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db.insert(enquiry).values({
            id: eid,
            companyId: ctx.companyId,
            serverSeq: seq,
            customerId: input.customerId ?? null,
            prospectName: blank(input.prospectName),
            contact: blank(input.contact),
            dieId: input.sectionId ?? null,
            sectionText: blank(input.sectionText),
            kgG: input.kgG ?? null,
            followUpDate: input.followUpDate ?? null,
            status: "open",
            quoteId: null,
            note: blank(input.note),
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "enquiry.create", subjectType: "enquiry", subjectId: eid, meta: { customerId: input.customerId ?? null, followUpDate: input.followUpDate ?? null } }),
        ]);
        return { id: eid };
      }),

    update: actionProcedure("enquiry.manage")
      .input(enquiryInput.partial().extend({ id, serverSeq: z.number().int().nonnegative(), status: z.enum(ENQUIRY_STATUSES).optional() }))
      .mutation(async ({ ctx, input }) => {
        const row = await ctx.db.select().from(enquiry).where(and(eq(enquiry.id, input.id), eq(enquiry.companyId, ctx.companyId))).get();
        if (!row) notFound();
        if (row!.serverSeq !== input.serverSeq) bad("This enquiry changed meanwhile. Reload and try again.");
        if (input.customerId) await customerRow(ctx.db, ctx.companyId, input.customerId);
        if (input.sectionId) {
          const s = await sectionInfo(ctx.db, ctx.companyId, [input.sectionId]);
          if (!s.has(input.sectionId)) notFound();
        }
        const next = {
          customerId: input.customerId !== undefined ? input.customerId : row!.customerId,
          prospectName: input.prospectName !== undefined ? blank(input.prospectName) : row!.prospectName,
        };
        if (!next.customerId && !next.prospectName) bad("Name the customer or the buyer");
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        const set: Partial<typeof enquiry.$inferInsert> = { serverSeq: seq, ...next };
        if (input.contact !== undefined) set.contact = blank(input.contact);
        if (input.sectionId !== undefined) set.dieId = input.sectionId;
        if (input.sectionText !== undefined) set.sectionText = blank(input.sectionText);
        if (input.kgG !== undefined) set.kgG = input.kgG;
        if (input.followUpDate !== undefined) set.followUpDate = input.followUpDate;
        if (input.note !== undefined) set.note = blank(input.note);
        if (input.status !== undefined) set.status = input.status;
        await atomicBatch(ctx.db, [
          ctx.db.update(enquiry).set(set).where(and(eq(enquiry.id, row!.id), eq(enquiry.companyId, ctx.companyId), eq(enquiry.serverSeq, row!.serverSeq))),
          auditInsert(ctx, { action: "enquiry.update", subjectType: "enquiry", subjectId: row!.id, meta: { status: input.status ?? null, followUpDate: input.followUpDate ?? null } }),
        ]);
        const after = await ctx.db.select({ serverSeq: enquiry.serverSeq }).from(enquiry).where(and(eq(enquiry.id, row!.id), eq(enquiry.companyId, ctx.companyId))).get();
        if (after?.serverSeq !== seq) bad("This enquiry changed meanwhile. Reload and try again.");
        return { id: row!.id, serverSeq: seq };
      }),
  }),
};

/** Overdue open enquiries of a plant (Today's enquiries tile). */
export async function overdueEnquiryCount(db: OrrnDb, companyId: string, today: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(enquiry)
    .where(and(eq(enquiry.companyId, companyId), inArray(enquiry.status, [...OPEN_ENQUIRY_STATUSES]), lt(enquiry.followUpDate, today)));
  return Number(row?.n ?? 0);
}

