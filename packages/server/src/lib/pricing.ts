/**
 * XE-PRICE (lane PRICE): the server side of the price master. Reads master rows, prices a line
 * through `@orrn/domain` computeLineRate, freezes the breakdown at order confirm, and applies the
 * `price_change` approval. Pure rules stay in `packages/domain/src/pricing.ts`.
 *
 * When pricing applies to an order confirm (`pricingApplies`): the `pricing` module is on, the plant
 * has `priceOnSalesOrder` on, the order is not an Infinity Portal import, and the plant has an active
 * base metal rate (its chosen source) AND an active plant default conversion on the confirm date.
 * Otherwise nothing changes at confirm, so a plant that never set up a master confirms as before.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, like, lte, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import { priceRate } from "@orrn/db/schema/pricing";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";
import {
  activeRatesOf,
  computeLineRate,
  conversionKey,
  customerTermKey,
  isModuleOn,
  priceKey,
  readFloorSettings,
  readPricingSettings,
  resolveRate,
  spreadByWeight,
  type BreakupComponent,
  type BreakupOverride,
  type ComponentBasis,
  type ComputeLineResult,
  type LmeInputs,
  type MetalSource,
  type PriceBreakup,
  type PriceRateKind,
  type PriceRateRow,
  type PriceRateStatus,
  type PricingSettings,
} from "@orrn/domain";

import type { ApplyCtx, ApprovalApplier } from "./approvalApply";
import { mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { auditInsertGuarded } from "./audit";
import { companyToday } from "./purchase";

type DbRate = typeof priceRate.$inferSelect;

export function toRateRow(r: DbRate): PriceRateRow {
  return {
    id: r.id,
    kind: r.kind as PriceRateKind,
    key: r.key,
    paise: r.paise,
    effectiveFrom: r.effectiveFrom,
    status: r.status as PriceRateStatus,
    createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
    detail: r.detail ?? null,
  };
}

/** The plant's settings that pricing reads, in one query. */
export async function pricingCompany(db: OrrnDb, companyId: string) {
  const row = await db.select({ settings: company.settings, modules: company.modules }).from(company).where(eq(company.id, companyId)).get();
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  return {
    settings,
    pricing: readPricingSettings(settings.pricing),
    priceOnSalesOrder: readFloorSettings(settings).priceOnSalesOrder,
    moduleOn: isModuleOn(Array.isArray(row?.modules) ? row.modules : [], "pricing"),
  };
}

/** Today on the company wall clock. */
export function pricingToday(settings: Record<string, unknown>, at: Date): string {
  return companyToday(settings, at);
}

/**
 * Every active master row a pricing pass may need, on or before `onDate`: the plant-wide kinds
 * (metal of the chosen source, conversion, alloy, finish, component), the customer's terms, and the
 * overrides of the given lines. Masters are small (dozens to a few hundred rows); metal is read as
 * one row.
 */
export async function loadPricingRows(
  db: OrrnDb,
  companyId: string,
  opts: { onDate: string; metalSource: MetalSource; customerId?: string | null; lineIds?: readonly string[] },
): Promise<PriceRateRow[]> {
  const active = and(eq(priceRate.companyId, companyId), eq(priceRate.status, "active"), lte(priceRate.effectiveFrom, opts.onDate));
  const metal = await db
    .select()
    .from(priceRate)
    .where(and(active, eq(priceRate.kind, "metal"), eq(priceRate.key, opts.metalSource)))
    .orderBy(desc(priceRate.effectiveFrom), desc(priceRate.createdAt))
    .limit(1);
  const masters = await db
    .select()
    .from(priceRate)
    .where(and(active, inArray(priceRate.kind, ["conversion", "alloy", "finish", "component"])));
  const customer = opts.customerId
    ? await db
        .select()
        .from(priceRate)
        .where(and(active, eq(priceRate.kind, "customer"), like(priceRate.key, `${opts.customerId}:%`)))
    : [];
  const lines =
    opts.lineIds && opts.lineIds.length > 0
      ? await mapInChunks([...opts.lineIds], (part) => db.select().from(priceRate).where(and(active, eq(priceRate.kind, "line"), inArray(priceRate.key, part))))
      : [];
  return [...metal, ...masters, ...customer, ...lines].map(toRateRow);
}

/** A component master row's label, basis and "always charged" flag. */
export function componentInfo(r: PriceRateRow): { label: string; basis: ComponentBasis; always: boolean } {
  const d = (r.detail ?? {}) as Record<string, unknown>;
  return {
    label: typeof d.label === "string" && d.label ? d.label : r.key,
    basis: d.basis === "order" ? "order" : "piece",
    always: d.always === true,
  };
}

export type PricingLine = {
  /** Order line id (for its override) or a client key on a quote. */
  lineId?: string | null;
  dieId: string;
  /** The section's series (its group for conversion). */
  series: string | null;
  alloy: string | null;
  finish: string | null;
  kgG: number;
  pcs: number | null;
  /** Extra component keys picked on this line (quotes); "always" components are added anyway. */
  componentKeys?: readonly string[];
};

/** Approver names are not part of the snapshot; ids are (the print reads names when it needs them). */
export function overrideOf(rows: readonly PriceRateRow[], lineId: string, onDate: string, meta: Map<string, { approvalId: string | null; approvedBy: string | null; requestedBy: string | null; reason: string | null }>): BreakupOverride | null {
  const r = resolveRate(rows, "line", lineId, onDate);
  if (!r) return null;
  const m = meta.get(r.id);
  return { ratePaise: r.paise, reason: m?.reason ?? "", rateId: r.id, approvalId: m?.approvalId ?? null, approvedBy: m?.approvedBy ?? null, requestedBy: m?.requestedBy ?? null };
}

/**
 * Price every line of one order or quote with the rows given (`loadPricingRows`). Per-order
 * components are spread over the lines by weight (`spreadByWeight`) so the line rates carry them.
 */
export function priceLines(
  rows: readonly PriceRateRow[],
  opts: { onDate: string; metalSource: MetalSource; customerId: string | null; overrides?: Map<string, BreakupOverride | null> },
  lines: readonly PricingLine[],
): ComputeLineResult[] {
  const { onDate } = opts;
  const metalRow = resolveRate(rows, "metal", opts.metalSource, onDate);
  const metal = metalRow
    ? {
        source: opts.metalSource,
        paisePerKg: metalRow.paise,
        rateDate: metalRow.effectiveFrom,
        rateId: metalRow.id,
        lme: opts.metalSource === "lme" ? lmeOf(metalRow) : null,
      }
    : null;
  const custConv = opts.customerId ? resolveRate(rows, "customer", customerTermKey(opts.customerId, "conversion"), onDate) : null;
  const discount = opts.customerId ? resolveRate(rows, "customer", customerTermKey(opts.customerId, "discount"), onDate) : null;
  const fixed = opts.customerId ? resolveRate(rows, "customer", customerTermKey(opts.customerId, "fixed"), onDate) : null;
  const components = activeRatesOf(rows, "component", onDate);
  const always = components.filter((c) => componentInfo(c).always);

  // Per-order components (always ones, plus any picked on a line) are charged once and spread by weight.
  const orderComps = new Map<string, PriceRateRow>();
  for (const c of always) if (componentInfo(c).basis === "order") orderComps.set(c.key, c);
  for (const l of lines)
    for (const k of l.componentKeys ?? []) {
      const c = components.find((x) => x.key === k);
      if (c && componentInfo(c).basis === "order") orderComps.set(c.key, c);
    }
  const weights = lines.map((l) => l.kgG);
  const orderShares = new Map<string, number[]>();
  for (const c of orderComps.values()) orderShares.set(c.key, spreadByWeight(c.paise, weights));

  return lines.map((l, i) => {
    const conv =
      custConv
        ? { paisePerKg: custConv.paise, from: "customer" as const, rateId: custConv.id }
        : (() => {
            const byDie = resolveRate(rows, "conversion", conversionKey.die(l.dieId), onDate);
            if (byDie) return { paisePerKg: byDie.paise, from: "die" as const, rateId: byDie.id };
            const bySeries = l.series ? resolveRate(rows, "conversion", conversionKey.series(l.series), onDate) : null;
            if (bySeries) return { paisePerKg: bySeries.paise, from: "series" as const, rateId: bySeries.id };
            const def = resolveRate(rows, "conversion", conversionKey.default(), onDate);
            return def ? { paisePerKg: def.paise, from: "default" as const, rateId: def.id } : null;
          })();
    const alloyKey = l.alloy ? priceKey(l.alloy) : "";
    const alloyRow = alloyKey ? resolveRate(rows, "alloy", alloyKey, onDate) : null;
    const finishKey = l.finish ? priceKey(l.finish) : "";
    const finishRow = finishKey && finishKey !== "none" ? resolveRate(rows, "finish", finishKey, onDate) : null;

    const lineComps: BreakupComponent[] = [];
    const pieceKeys = new Set<string>();
    for (const c of always) if (componentInfo(c).basis === "piece") pieceKeys.add(c.key);
    for (const k of l.componentKeys ?? []) pieceKeys.add(k);
    for (const k of [...pieceKeys].sort()) {
      const c = components.find((x) => x.key === k);
      if (!c) continue;
      const info = componentInfo(c);
      if (info.basis !== "piece") continue;
      const qty = l.pcs ?? 0;
      lineComps.push({ key: c.key, label: info.label, basis: "piece", paise: c.paise, qty, totalPaise: c.paise * qty, rateId: c.id });
    }
    for (const c of orderComps.values()) {
      const share = orderShares.get(c.key)![i]!;
      lineComps.push({ key: c.key, label: componentInfo(c).label, basis: "order", paise: c.paise, qty: 1, totalPaise: share, rateId: c.id });
    }

    return computeLineRate({
      rateDate: onDate,
      metal,
      conversion: conv,
      alloy: alloyRow ? { alloy: l.alloy!, paisePerKg: alloyRow.paise, rateId: alloyRow.id } : { alloy: l.alloy, paisePerKg: 0, rateId: null },
      finish: finishRow ? { finish: l.finish!, paisePerKg: finishRow.paise, rateId: finishRow.id } : { finish: l.finish, paisePerKg: 0, rateId: null },
      components: lineComps,
      discountPaisePerKg: discount?.paise ?? 0,
      fixedPaisePerKg: fixed?.paise ?? null,
      kgG: l.kgG,
      override: l.lineId ? (opts.overrides?.get(l.lineId) ?? null) : null,
    });
  });
}

function lmeOf(r: PriceRateRow): LmeInputs | null {
  const d = (r.detail ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const usd = n("usdPerTonneCents");
  const inr = n("inrPerUsdPaise");
  if (usd == null || inr == null) return null;
  return { usdPerTonneCents: usd, inrPerUsdPaise: inr, premiumPaisePerKg: n("premiumPaisePerKg") ?? 0 };
}

/** Override rows of these lines with who asked, who approved and why (from the rate row and its approval). */
export async function overrideMeta(db: OrrnDb, companyId: string, rows: readonly PriceRateRow[]) {
  const ids = rows.filter((r) => r.kind === "line").map((r) => r.id);
  const out = new Map<string, { approvalId: string | null; approvedBy: string | null; requestedBy: string | null; reason: string | null }>();
  if (ids.length === 0) return out;
  const found = await mapInChunks(ids, (part) =>
    db
      .select({ id: priceRate.id, approvalId: priceRate.approvalId, decidedBy: priceRate.decidedBy, createdBy: priceRate.createdBy, reason: priceRate.reason })
      .from(priceRate)
      .where(and(eq(priceRate.companyId, companyId), inArray(priceRate.id, part))),
  );
  for (const f of found) out.set(f.id, { approvalId: f.approvalId, approvedBy: f.decidedBy, requestedBy: f.createdBy, reason: f.reason });
  return out;
}

/** Does pricing freeze rates for this plant on `onDate`? (see the file comment) */
export function masterReady(rows: readonly PriceRateRow[], metalSource: MetalSource, onDate: string): boolean {
  return Boolean(resolveRate(rows, "metal", metalSource, onDate) && resolveRate(rows, "conversion", conversionKey.default(), onDate));
}

/**
 * The confirm-time freeze (row "line breakdown snapshot"): one guarded UPDATE per line setting
 * `rate_paise` and `price_breakup`, landing only if the confirm itself landed (`landed`). Returns no
 * statements when pricing does not apply. Existing orders are never touched: only a confirm writes.
 */
export async function planConfirmFreeze(
  db: OrrnDb,
  companyId: string,
  order: { id: string; customerId: string },
  lines: readonly { id: string; dieId: string; alloy: string | null; finish: string | null; kgG: number; pcs: number | null }[],
  opts: { at: Date; ingest: boolean },
): Promise<{ statements: (landed: SQL) => SqliteBatchItem[]; priced: number; rateDate: string | null }> {
  const none = { statements: () => [], priced: 0, rateDate: null };
  if (opts.ingest || lines.length === 0) return none;
  const co = await pricingCompany(db, companyId);
  if (!co.moduleOn || !co.priceOnSalesOrder) return none;
  const onDate = pricingToday(co.settings, opts.at);
  const rows = await loadPricingRows(db, companyId, { onDate, metalSource: co.pricing.metalSource, customerId: order.customerId, lineIds: lines.map((l) => l.id) });
  if (!masterReady(rows, co.pricing.metalSource, onDate)) return none;
  const sections = new Map(
    (
      await mapInChunks([...new Set(lines.map((l) => l.dieId))], (part) =>
        db.select({ id: die.id, series: die.series }).from(die).where(and(eq(die.companyId, companyId), inArray(die.id, part))),
      )
    ).map((d) => [d.id, d.series] as const),
  );
  const meta = await overrideMeta(db, companyId, rows);
  const overrides = new Map(lines.map((l) => [l.id, overrideOf(rows, l.id, onDate, meta)] as const));
  const priced = priceLines(rows, { onDate, metalSource: co.pricing.metalSource, customerId: order.customerId, overrides }, lines.map((l) => ({
    lineId: l.id,
    dieId: l.dieId,
    series: sections.get(l.dieId) ?? null,
    alloy: l.alloy,
    finish: l.finish,
    kgG: l.kgG,
    pcs: l.pcs,
  })));
  const writes: { id: string; breakup: PriceBreakup }[] = [];
  for (const [i, r] of priced.entries()) if (r.ok) writes.push({ id: lines[i]!.id, breakup: r.breakup });
  return {
    priced: writes.length,
    rateDate: onDate,
    statements: (landed) =>
      writes.map((w) =>
        db
          .update(salesOrderLine)
          .set({ ratePaise: w.breakup.finalPaisePerKg, priceBreakup: w.breakup as unknown as Record<string, unknown> })
          .where(and(eq(salesOrderLine.id, w.id), eq(salesOrderLine.companyId, companyId), eq(salesOrderLine.salesOrderId, order.id), landed)),
      ),
  };
}

export const FROZEN_RATE_MESSAGE = "This line's rate was fixed when the order was confirmed. Ask for a rate change from the order's price sheet";

/**
 * `orders.update` must not bypass the override approval: a line with a frozen breakdown keeps its
 * rate unless the edit sends the same rate (or none).
 */
export function assertFrozenRatesKept(edits: readonly { stored: { priceBreakup: unknown; ratePaise: number | null }; ratePaise: number | null | undefined }[]): void {
  for (const e of edits) {
    if (e.stored.priceBreakup == null || e.ratePaise === undefined) continue;
    if (e.ratePaise !== e.stored.ratePaise) throw new TRPCError({ code: "BAD_REQUEST", message: FROZEN_RATE_MESSAGE });
  }
}

/**
 * `price_change` decision (subject = the price_rate row): approved makes it `active`, rejected
 * `rejected`, both stamping who decided; an audit row names the kind, key, rate and date. Guarded by
 * "this decision landed" and by the row still pending, scoped to the company.
 */
export const priceChangeDecision: ApprovalApplier = (ctx: ApplyCtx, row, decision) => {
  const { db, companyId } = ctx;
  const where = and(eq(priceRate.id, row.subjectId), eq(priceRate.companyId, companyId), eq(priceRate.status, "pending"), eq(priceRate.approvalId, row.id));
  const status = decision === "approved" ? "active" : "rejected";
  // An approved line override on a confirmed order: the frozen breakdown takes it now (the line's
  // rate becomes the override). A booking order picks it up at confirm. Guarded the same way.
  const lineUpdate =
    decision === "approved"
      ? [
          db
            .update(salesOrderLine)
            .set({
              ratePaise: sql`(select pr.paise from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId})`,
              priceBreakup: sql`json_set(${salesOrderLine.priceBreakup},
                '$.override', json_object(
                  'ratePaise', (select pr.paise from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId}),
                  'reason', coalesce((select pr.reason from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId}), ''),
                  'rateId', ${row.subjectId},
                  'approvalId', ${row.id},
                  'approvedBy', ${ctx.userId},
                  'requestedBy', (select pr.created_by from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId})),
                '$.finalPaisePerKg', (select pr.paise from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId}))` as never,
              serverSeq: ctx.seq,
            })
            .where(
              and(
                eq(salesOrderLine.companyId, companyId),
                isNotNull(salesOrderLine.priceBreakup),
                sql`${salesOrderLine.id} = (select pr.key from price_rate pr where pr.id = ${row.subjectId} and pr.company_id = ${companyId} and pr.kind = 'line' and pr.status = 'active' and pr.server_seq = ${ctx.seq})`,
                decisionLanded(ctx, row.id, decision),
              ),
            ),
        ]
      : [];
  return [
    db
      .update(priceRate)
      .set({ status, decidedBy: ctx.userId, decidedAt: ctx.decidedAt, serverSeq: ctx.seq })
      .where(and(where, decisionLanded(ctx, row.id, decision))),
    auditInsertGuarded(
      { db, companyId, session: ctx.session ?? null, impersonation: ctx.impersonation ?? null },
      { action: decision === "approved" ? "price.rate.activate" : "price.rate.reject", subjectType: "price_rate", subjectId: row.subjectId, meta: { approvalId: row.id } },
      { from: priceRate, where: and(eq(priceRate.id, row.subjectId), eq(priceRate.companyId, companyId), eq(priceRate.status, status), eq(priceRate.serverSeq, ctx.seq)) },
    ),
    ...lineUpdate,
  ];
};

function decisionLanded(ctx: ApplyCtx, approvalId: string, decision: "approved" | "rejected"): SQL {
  return sql`exists (select 1 from ${approval} a where a.id = ${approvalId} and a.company_id = ${ctx.companyId} and a.server_seq = ${ctx.seq} and a.status = ${decision})`;
}

export type { PricingSettings };
