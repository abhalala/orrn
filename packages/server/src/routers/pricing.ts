/**
 * XE-PRICE (lane PRICE): `pricing.*`. The price master (rows 1-9), pricing settings, the live price
 * preview and line overrides; quotes, proforma, works order and enquiries live in `pricingDocs.ts`
 * and are spread in here.
 *
 * Gates: every procedure checks the `pricing` module (mutations at the router level through
 * ROUTER_MODULE, reads here with `assertModule`). Reading the master needs `price.view`; proposing a
 * rate, a customer term or an override needs `price.manage`. Every master change is a new
 * `price_rate` row, pending until a second person approves it (`price_change`); until then the old
 * rate applies. Approval meta carries ids and the date only, never money (approval.list is open).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { priceRate } from "@orrn/db/schema/pricing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";
import {
  COMPONENT_BASES,
  conversionKey,
  CUSTOMER_TERM_MODES,
  customerTermKey,
  lmePaisePerKg,
  MAX_RATE_PAISE,
  METAL_SOURCES,
  overrideNeedsApproval,
  PRICE_RATE_KINDS,
  PRICE_RATE_STATUSES,
  priceKey,
  resolveRate,
  type PriceBreakup,
  type PriceRateKind,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, mapInChunks, type OrrnDb } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { settingsPatchSql } from "../lib/companySettings";
import {
  loadPricingRows,
  masterReady,
  priceLines,
  pricingCompany,
  pricingToday,
  toRateRow,
} from "../lib/pricing";
import { assertOrderPrice, bad, MASTER_NOT_READY, notFound, pricingOn, sectionInfo, ymd } from "../lib/pricingKit";
import { canApprove } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { pricingDocsProcedures } from "./pricingDocs";

const id = z.string().min(1).max(64);
const paise = z.number().int().min(0).max(MAX_RATE_PAISE);
const reason = z.string().trim().min(3, "Give a reason").max(300);

const viewProcedure = actionProcedure("price.view");
const manageProcedure = actionProcedure("price.manage");

/** What the office proposes; the server turns it into (kind, key, paise, detail). */
const proposeInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metal"),
    source: z.enum(METAL_SOURCES),
    /** NALCO or a typed rate, paise per kg. */
    paisePerKg: paise.optional(),
    /** LME: USD per tonne (cents), rupees per USD (paise), premium per kg (paise). */
    lme: z
      .object({
        usdPerTonneCents: z.number().int().min(1).max(10_000_000),
        inrPerUsdPaise: z.number().int().min(1).max(100_000),
        premiumPaisePerKg: paise.default(0),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("conversion"),
    scope: z.enum(["default", "series", "die"]),
    series: z.string().trim().min(1).max(60).optional(),
    sectionId: id.optional(),
    paisePerKg: paise,
  }),
  z.object({ kind: z.literal("alloy"), alloy: z.string().trim().min(1).max(16), paisePerKg: paise }),
  z.object({ kind: z.literal("finish"), finish: z.string().trim().min(1).max(40), paisePerKg: paise }),
  z.object({
    kind: z.literal("component"),
    label: z.string().trim().min(1).max(60),
    basis: z.enum(COMPONENT_BASES),
    /** Charged on every order (else only when picked on a quote line). */
    always: z.boolean().default(false),
    paise,
  }),
  z.object({ kind: z.literal("customer"), customerId: id, mode: z.enum(CUSTOMER_TERM_MODES), paisePerKg: paise }),
]);

/** `Cutting to length` -> `cutting_to_length` (a component's key; fixed once made). */
export function componentKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || `c_${[...label].reduce((h, ch) => ((h * 33) ^ ch.codePointAt(0)!) >>> 0, 5381).toString(36)}`;
}

async function assertSection(db: OrrnDb, companyId: string, sectionId: string) {
  const row = await db.select({ id: die.id }).from(die).where(and(eq(die.id, sectionId), eq(die.companyId, companyId), isNull(die.deletedAt))).get();
  if (!row) notFound();
}
async function assertCustomer(db: OrrnDb, companyId: string, customerId: string) {
  const row = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt))).get();
  if (!row) notFound();
}

async function resolveProposal(db: OrrnDb, companyId: string, input: z.infer<typeof proposeInput>): Promise<{ kind: PriceRateKind; key: string; paise: number; detail: Record<string, unknown> }> {
  switch (input.kind) {
    case "metal": {
      if (input.source === "lme") {
        if (!input.lme) bad("Enter the LME price, the dollar rate and the premium");
        const lme = input.lme!;
        return { kind: "metal", key: "lme", paise: lmePaisePerKg(lme), detail: { ...lme } };
      }
      if (input.paisePerKg == null) bad("Enter the rate per kg");
      return { kind: "metal", key: input.source, paise: input.paisePerKg!, detail: {} };
    }
    case "conversion": {
      if (input.scope === "series") {
        if (!input.series) bad("Pick the section group");
        return { kind: "conversion", key: conversionKey.series(input.series!), paise: input.paisePerKg, detail: { series: input.series } };
      }
      if (input.scope === "die") {
        if (!input.sectionId) bad("Pick the section");
        await assertSection(db, companyId, input.sectionId!);
        return { kind: "conversion", key: conversionKey.die(input.sectionId!), paise: input.paisePerKg, detail: {} };
      }
      return { kind: "conversion", key: conversionKey.default(), paise: input.paisePerKg, detail: {} };
    }
    case "alloy":
      return { kind: "alloy", key: priceKey(input.alloy), paise: input.paisePerKg, detail: { alloy: input.alloy } };
    case "finish": {
      const key = priceKey(input.finish);
      if (key === "none") bad("A plain finish has no price");
      return { kind: "finish", key, paise: input.paisePerKg, detail: { finish: input.finish } };
    }
    case "component":
      return { kind: "component", key: componentKey(input.label), paise: input.paise, detail: { label: input.label, basis: input.basis, always: input.always } };
    case "customer":
      await assertCustomer(db, companyId, input.customerId);
      return { kind: "customer", key: customerTermKey(input.customerId, input.mode), paise: input.paisePerKg, detail: { customerId: input.customerId, mode: input.mode } };
  }
}

const PENDING_EXISTS = "A change to this rate is already waiting for approval";
export const UNFROZEN_CONFIRMED = "This line was confirmed without a price from the master. Change its rate on the order";

/** Names for the keys of a list of rows: section codes for die conversions, customer names for terms. */
async function keyNames(db: OrrnDb, companyId: string, rows: readonly { kind: string; key: string }[]) {
  const dieIds = [...new Set(rows.filter((r) => r.kind === "conversion" && r.key.startsWith("die:")).map((r) => r.key.slice(4)))];
  const custIds = [...new Set(rows.filter((r) => r.kind === "customer").map((r) => r.key.split(":")[0]!))];
  const sections = new Map(
    (await mapInChunks(dieIds, (part) => db.select({ id: die.id, code: die.sectionCode }).from(die).where(and(eq(die.companyId, companyId), inArray(die.id, part))))).map((d) => [d.id, d.code] as const),
  );
  const customers = new Map(
    (await mapInChunks(custIds, (part) => db.select({ id: customer.id, name: customer.name }).from(customer).where(and(eq(customer.companyId, companyId), inArray(customer.id, part))))).map(
      (c) => [c.id, c.name] as const,
    ),
  );
  return (r: { kind: string; key: string }): string | null => {
    if (r.kind === "conversion" && r.key.startsWith("die:")) return sections.get(r.key.slice(4)) ?? null;
    if (r.kind === "customer") return customers.get(r.key.split(":")[0]!) ?? null;
    return null;
  };
}

function rateOut(r: typeof priceRate.$inferSelect, name: string | null) {
  return {
    id: r.id,
    kind: r.kind as PriceRateKind,
    key: r.key,
    name,
    paise: r.paise,
    effectiveFrom: r.effectiveFrom,
    status: r.status,
    detail: r.detail ?? {},
    reason: r.reason,
    approvalId: r.approvalId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
  };
}

const previewLine = z.object({
  sectionId: id,
  alloy: z.string().trim().max(16).nullish(),
  finish: z.string().trim().max(40).nullish(),
  kgG: z.number().int().min(1).max(1_000_000_000),
  pcs: z.number().int().min(1).max(10_000_000).nullish(),
  componentKeys: z.array(z.string().min(1).max(60)).max(20).optional(),
});

export const pricingRouter = router({
  settings: router({
    get: viewProcedure.query(async ({ ctx }) => {
      await pricingOn(ctx);
      const co = await pricingCompany(ctx.db, ctx.companyId);
      return { ...co.pricing, priceOnSalesOrder: co.priceOnSalesOrder };
    }),
    /**
     * price.manage: estimated GST and quote days. Which metal list prices every order (`metalSource`)
     * changes only by a `price_change` approver (owner, admin, manager; review S3), since it moves
     * every later confirm as much as a metal rate does.
     */
    update: manageProcedure
      .input(
        z.object({
          metalSource: z.enum(METAL_SOURCES).optional(),
          estimatedGstBp: z.number().int().min(0).max(10_000).optional(),
          quoteValidDays: z.number().int().min(1).max(365).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const co = await pricingCompany(ctx.db, ctx.companyId);
        if (input.metalSource !== undefined && input.metalSource !== co.pricing.metalSource && !canApprove(ctx.role, "price_change")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
        }
        const next = { ...co.pricing, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
        await atomicBatch(ctx.db, [
          ctx.db.update(company).set({ settings: settingsPatchSql({ pricing: next }) as never }).where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "price.settings.update", subjectType: "company", subjectId: ctx.companyId, meta: { from: co.pricing, to: next } }),
        ]);
        return next;
      }),
  }),

  rates: router({
    /**
     * The master as it stands on `onDate` (default today): the rate that applies per (kind, key),
     * with any pending change beside it, newest first in the history list.
     */
    current: viewProcedure.input(z.object({ onDate: ymd.optional() }).optional()).query(async ({ ctx, input }) => {
      await pricingOn(ctx);
      const co = await pricingCompany(ctx.db, ctx.companyId);
      const onDate = input?.onDate ?? pricingToday(co.settings, clockNow());
      const rows = await ctx.db
        .select()
        .from(priceRate)
        .where(and(eq(priceRate.companyId, ctx.companyId), sql`${priceRate.kind} <> 'line'`, inArray(priceRate.status, ["active", "pending"])))
        .orderBy(asc(priceRate.kind), asc(priceRate.key), desc(priceRate.effectiveFrom), desc(priceRate.createdAt))
        .limit(2000);
      const domainRows = rows.map(toRateRow);
      const name = await keyNames(ctx.db, ctx.companyId, rows);
      const keys = new Map<string, { kind: string; key: string }>();
      for (const r of rows) keys.set(`${r.kind}|${r.key}`, { kind: r.kind, key: r.key });
      const byId = new Map(rows.map((r) => [r.id, r] as const));
      const items = [...keys.values()].map(({ kind, key }) => {
        const cur = resolveRate(domainRows, kind as PriceRateKind, key, onDate);
        const pending = rows.filter((r) => r.kind === kind && r.key === key && r.status === "pending");
        const upcoming = rows.filter((r) => r.kind === kind && r.key === key && r.status === "active" && r.effectiveFrom > onDate);
        return {
          kind: kind as PriceRateKind,
          key,
          name: name({ kind, key }),
          current: cur ? rateOut(byId.get(cur.id)!, name({ kind, key })) : null,
          pending: pending.map((r) => rateOut(r, name(r))),
          upcoming: upcoming.map((r) => rateOut(r, name(r))),
        };
      });
      return { onDate, metalSource: co.pricing.metalSource, ready: masterReady(domainRows, co.pricing.metalSource, onDate), items };
    }),

    /** History of one (kind, key) or of a kind, newest first, paged. */
    history: viewProcedure
      .input(
        z.object({
          kind: z.enum(PRICE_RATE_KINDS),
          key: z.string().min(1).max(200).optional(),
          status: z.enum(PRICE_RATE_STATUSES).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        await pricingOn(ctx);
        // Review B2: line overrides are order-line rates.
        if (input.kind === "line") assertOrderPrice(ctx);
        const where = and(
          eq(priceRate.companyId, ctx.companyId),
          eq(priceRate.kind, input.kind),
          input.key ? eq(priceRate.key, input.key) : undefined,
          input.status ? eq(priceRate.status, input.status) : undefined,
        );
        const rows = await ctx.db.select().from(priceRate).where(where).orderBy(desc(priceRate.effectiveFrom), desc(priceRate.createdAt)).limit(input.limit + 1).offset(input.offset);
        const page = rows.slice(0, input.limit);
        const name = await keyNames(ctx.db, ctx.companyId, page);
        return { items: page.map((r) => rateOut(r, name(r))), nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
      }),

    /**
     * One row with what it would replace (the rate that applies on its date without it) and, for a
     * line override, the line's computed rate. The approval sheet reads it (approvers hold price.view).
     */
    get: viewProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
      await pricingOn(ctx);
      const row = await ctx.db.select().from(priceRate).where(and(eq(priceRate.id, input.id), eq(priceRate.companyId, ctx.companyId))).get();
      if (!row) notFound();
      const r = row!;
      // Review B2: a line override is an order-line rate (approvers of it hold order.price).
      if (r.kind === "line") assertOrderPrice(ctx);
      const others = await ctx.db
        .select()
        .from(priceRate)
        .where(and(eq(priceRate.companyId, ctx.companyId), eq(priceRate.kind, r.kind), eq(priceRate.key, r.key), eq(priceRate.status, "active")));
      const before = resolveRate(
        others.filter((o) => o.id !== r.id).map(toRateRow),
        r.kind as PriceRateKind,
        r.key,
        r.effectiveFrom,
      );
      const name = await keyNames(ctx.db, ctx.companyId, [r]);
      let line: { orderId: string; orderNumber: string; lineNo: number; computedPaisePerKg: number | null; kgG: number } | null = null;
      if (r.kind === "line") {
        const l = await ctx.db
          .select({ orderId: salesOrder.id, number: salesOrder.number, lineNo: salesOrderLine.lineNo, kgG: salesOrderLine.kgG, breakup: salesOrderLine.priceBreakup })
          .from(salesOrderLine)
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
          .where(and(eq(salesOrderLine.id, r.key), eq(salesOrderLine.companyId, ctx.companyId)))
          .get();
        if (l) {
          const detail = (r.detail ?? {}) as { computedPaisePerKg?: number };
          const frozen = l.breakup as PriceBreakup | null;
          line = { orderId: l.orderId, orderNumber: l.number, lineNo: l.lineNo, kgG: l.kgG, computedPaisePerKg: frozen?.computedPaisePerKg ?? detail.computedPaisePerKg ?? null };
        }
      }
      return { rate: rateOut(r, name(r)), replaces: before ? { id: before.id, paise: before.paise, effectiveFrom: before.effectiveFrom } : null, line };
    }),

    /**
     * Propose a master rate or a customer term. It is a new row, pending until an approver decides
     * the `price_change` request (never the requester); one pending change per rate at a time.
     */
    propose: manageProcedure
      .input(z.object({ change: proposeInput, effectiveFrom: ymd.optional(), reason }))
      .mutation(async ({ ctx, input }) => {
        const co = await pricingCompany(ctx.db, ctx.companyId);
        const effectiveFrom = input.effectiveFrom ?? pricingToday(co.settings, clockNow());
        const p = await resolveProposal(ctx.db, ctx.companyId, input.change);
        const pendingSame = await ctx.db
          .select({ id: priceRate.id })
          .from(priceRate)
          .where(and(eq(priceRate.companyId, ctx.companyId), eq(priceRate.kind, p.kind), eq(priceRate.key, p.key), eq(priceRate.status, "pending")))
          .get();
        if (pendingSame) bad(PENDING_EXISTS);
        const rateId = crypto.randomUUID();
        const approvalId = crypto.randomUUID();
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        const now = Date.now();
        // INSERT … SELECT guarded by "no other pending change of this rate" in the statement itself.
        const insertRate = ctx.db.insert(priceRate).select(
          ctx.db
            .select({
              id: sql<string>`${rateId}`.as("id"),
              companyId: sql<string>`${ctx.companyId}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              kind: sql<string>`${p.kind}`.as("kind"),
              key: sql<string>`${p.key}`.as("key"),
              paise: sql<number>`${p.paise}`.as("paise"),
              effectiveFrom: sql<string>`${effectiveFrom}`.as("effective_from"),
              status: sql<string>`'pending'`.as("status"),
              detail: sql<string>`${JSON.stringify(p.detail)}`.as("detail"),
              reason: sql<string>`${input.reason}`.as("reason"),
              approvalId: sql<string | null>`null`.as("approval_id"),
              decidedBy: sql<string | null>`null`.as("decided_by"),
              decidedAt: sql<number | null>`null`.as("decided_at"),
              createdBy: sql<string>`${ctx.session.user.id}`.as("created_by"),
              createdAt: sql<number>`${now}`.as("created_at"),
            })
            .from(company)
            .where(
              and(
                eq(company.id, ctx.companyId),
                sql`not exists (select 1 from price_rate x where x.company_id = ${ctx.companyId} and x.kind = ${p.kind} and x.key = ${p.key} and x.status = 'pending')`,
              ),
            ),
        );
        const req = requestApprovalInsert(ctx, {
          id: approvalId,
          kind: "price_change",
          subjectId: rateId,
          serverSeq: seq,
          requestNote: input.reason,
          meta: { rateKind: p.kind, key: p.key, effectiveFrom },
          guard: { from: priceRate, where: and(eq(priceRate.id, rateId), eq(priceRate.companyId, ctx.companyId)) },
        });
        await atomicBatch(ctx.db, [
          insertRate,
          req.statement,
          ctx.db.update(priceRate).set({ approvalId }).where(and(eq(priceRate.id, rateId), eq(priceRate.companyId, ctx.companyId))),
          auditInsertGuarded(
            ctx,
            { action: "price.rate.propose", subjectType: "price_rate", subjectId: rateId, meta: { kind: p.kind, key: p.key, paise: p.paise, effectiveFrom, approvalId } },
            { from: priceRate, where: and(eq(priceRate.id, rateId), eq(priceRate.companyId, ctx.companyId)) },
          ),
        ]);
        const landed = await ctx.db.select({ id: priceRate.id }).from(priceRate).where(and(eq(priceRate.id, rateId), eq(priceRate.companyId, ctx.companyId))).get();
        if (!landed) bad(PENDING_EXISTS);
        return { id: rateId, approvalId, kind: p.kind, key: p.key, paise: p.paise, effectiveFrom, status: "pending" as const };
      }),
  }),

  /**
   * Price lines as the master stands on `onDate` for a customer (quote form, order screen). Nothing
   * is stored. `ready` is false while the metal rate or the plant conversion is missing.
   */
  preview: viewProcedure
    .input(z.object({ customerId: id.nullish(), onDate: ymd.optional(), lines: z.array(previewLine).min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      await pricingOn(ctx);
      const co = await pricingCompany(ctx.db, ctx.companyId);
      const onDate = input.onDate ?? pricingToday(co.settings, clockNow());
      if (input.customerId) await assertCustomer(ctx.db, ctx.companyId, input.customerId);
      const rows = await loadPricingRows(ctx.db, ctx.companyId, { onDate, metalSource: co.pricing.metalSource, customerId: input.customerId ?? null });
      const sections = await sectionInfo(ctx.db, ctx.companyId, input.lines.map((l) => l.sectionId));
      const out = priceLines(
        rows,
        { onDate, metalSource: co.pricing.metalSource, customerId: input.customerId ?? null },
        input.lines.map((l) => {
          const s = sections.get(l.sectionId);
          if (!s) notFound();
          return { dieId: l.sectionId, series: s!.series, alloy: l.alloy ?? s!.alloy, finish: l.finish ?? null, kgG: l.kgG, pcs: l.pcs ?? null, componentKeys: l.componentKeys };
        }),
      );
      return { onDate, ready: masterReady(rows, co.pricing.metalSource, onDate), lines: out };
    }),

  lines: router({
    /**
     * Ask for a line rate other than the computed one (rows 5, 9). At or above the computed rate it
     * applies at once; below it opens a `price_change` request and the computed rate stands until it
     * is approved. On a confirmed order the frozen breakdown takes the override in the same batch.
     */
    requestOverride: anyActionProcedure("price.manage")
      .input(z.object({ lineId: id, ratePaise: paise, reason }))
      .mutation(async ({ ctx, input }) => {
        // Review B2: it writes an order-line rate, so it needs order.price as well as price.manage.
        assertOrderPrice(ctx);
        const line = await ctx.db
          .select({
            id: salesOrderLine.id,
            orderId: salesOrder.id,
            status: salesOrder.status,
            customerId: salesOrder.customerId,
            dieId: salesOrderLine.dieId,
            alloy: salesOrderLine.alloy,
            finish: salesOrderLine.finish,
            kgG: salesOrderLine.kgG,
            pcs: salesOrderLine.pcs,
            breakup: salesOrderLine.priceBreakup,
            series: die.series,
          })
          .from(salesOrderLine)
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
          .innerJoin(die, and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, salesOrderLine.companyId)))
          .where(and(eq(salesOrderLine.id, input.lineId), eq(salesOrderLine.companyId, ctx.companyId)))
          .get();
        if (!line) notFound();
        const l = line!;
        if (l.status === "closed" || l.status === "cancelled") bad("This order is closed; its rates can't change");
        const co = await pricingCompany(ctx.db, ctx.companyId);
        if (!co.priceOnSalesOrder) bad("Rates on sales orders are turned off for this plant");
        const today = pricingToday(co.settings, clockNow());
        const frozen = l.breakup as PriceBreakup | null;
        // Review S2: a confirmed line that was never priced from the master has no breakdown to take
        // an override; an "active" answer would change nothing. Its rate is edited on the order.
        if (!frozen && l.status !== "booking") bad(UNFROZEN_CONFIRMED);
        let computed: number;
        if (frozen) computed = frozen.computedPaisePerKg;
        else {
          const rows = await loadPricingRows(ctx.db, ctx.companyId, { onDate: today, metalSource: co.pricing.metalSource, customerId: l.customerId });
          if (!masterReady(rows, co.pricing.metalSource, today)) bad(MASTER_NOT_READY);
          const [r] = priceLines(rows, { onDate: today, metalSource: co.pricing.metalSource, customerId: l.customerId }, [
            { dieId: l.dieId, series: l.series, alloy: l.alloy, finish: l.finish, kgG: l.kgG, pcs: l.pcs },
          ]);
          if (!r || !r.ok) bad(MASTER_NOT_READY);
          computed = (r as { ok: true; breakup: PriceBreakup }).breakup.computedPaisePerKg;
        }
        const pendingSame = await ctx.db
          .select({ id: priceRate.id })
          .from(priceRate)
          .where(and(eq(priceRate.companyId, ctx.companyId), eq(priceRate.kind, "line"), eq(priceRate.key, l.id), eq(priceRate.status, "pending")))
          .get();
        if (pendingSame) bad(PENDING_EXISTS);
        const needs = overrideNeedsApproval(computed, input.ratePaise);
        const rateId = crypto.randomUUID();
        const approvalId = needs ? crypto.randomUUID() : null;
        const seq = await nextCompanySeq(ctx, ctx.companyId);
        const userId = ctx.session.user.id;
        const statements = [
          ctx.db.insert(priceRate).values({
            id: rateId,
            companyId: ctx.companyId,
            serverSeq: seq,
            kind: "line",
            key: l.id,
            paise: input.ratePaise,
            effectiveFrom: today,
            status: needs ? "pending" : "active",
            detail: { computedPaisePerKg: computed, orderId: l.orderId },
            reason: input.reason,
            approvalId,
            decidedBy: null,
            decidedAt: null,
            createdBy: userId,
          }),
          auditInsert(ctx, {
            action: "price.override.request",
            subjectType: "sales_order",
            subjectId: l.orderId,
            meta: { lineId: l.id, rateId, ratePaise: input.ratePaise, computedPaisePerKg: computed, needsApproval: needs, approvalId },
          }),
        ];
        if (needs) {
          // The approval goes first: price_rate.approval_id references it.
          statements.unshift(
            requestApprovalInsert(ctx, {
              id: approvalId!,
              kind: "price_change",
              subjectId: rateId,
              serverSeq: seq,
              requestNote: input.reason,
              meta: { rateKind: "line", key: l.id, effectiveFrom: today, orderId: l.orderId },
            }).statement,
          );
        } else if (frozen) {
          const breakup: PriceBreakup = {
            ...frozen,
            override: { ratePaise: input.ratePaise, reason: input.reason, rateId, approvalId: null, approvedBy: null, requestedBy: userId },
            finalPaisePerKg: input.ratePaise,
          };
          statements.push(
            ctx.db
              .update(salesOrderLine)
              .set({ ratePaise: input.ratePaise, priceBreakup: breakup as unknown as Record<string, unknown>, serverSeq: seq })
              .where(and(eq(salesOrderLine.id, l.id), eq(salesOrderLine.companyId, ctx.companyId))),
          );
        }
        await atomicBatch(ctx.db, statements as Parameters<typeof atomicBatch>[1]);
        return { id: rateId, approvalId, status: needs ? ("pending" as const) : ("active" as const), computedPaisePerKg: computed };
      }),

    /** The line's override history (newest first) with the computed rate each was asked against. */
    overrides: viewProcedure.input(z.object({ lineId: id })).query(async ({ ctx, input }) => {
      await pricingOn(ctx);
      assertOrderPrice(ctx);
      const owner = await ctx.db.select({ id: salesOrderLine.id }).from(salesOrderLine).where(and(eq(salesOrderLine.id, input.lineId), eq(salesOrderLine.companyId, ctx.companyId))).get();
      if (!owner) notFound();
      const rows = await ctx.db
        .select()
        .from(priceRate)
        .where(and(eq(priceRate.companyId, ctx.companyId), eq(priceRate.kind, "line"), eq(priceRate.key, input.lineId)))
        .orderBy(desc(priceRate.createdAt))
        .limit(50);
      return rows.map((r) => rateOut(r, null));
    }),
  }),

  ...pricingDocsProcedures,
});
