/**
 * Foundry reads and the furnace readings seam (W2-FD-S):
 *
 * - FP-FD-16/17 trace: a cast's lots in → spectro → billets → press runs → bundles → customers
 *   (`foundry.casts.trace`), and the same chain from one bundle (`foundry.casts.traceBundle`).
 *   A bundle is linked to the runs of its cast on the same die copy (the bundle row has no run id).
 * - FP-FD-20 cost (`foundry.casts.cost`): Σ lot kg × the lot's stored rate (paise), purchase
 *   readers only (rates are commercial, RP9). Remelted return streams carry no rate and are shown
 *   apart. No finance module: this is a read.
 * - Billet stock (`foundry.stock.billets`): the BILLET ledger by cast and alloy (one GROUP BY).
 * - FP-FD-19 yield (`analytics.foundryYield`): locked melts by production day, alloy or furnace.
 * - Furnace readings (`foundry.readings.*`): typed pyrometer readings, and `simulate` behind the
 *   FOUNDRY_SIMULATOR env seam (the real PLC is owner-only, Q46). Readings never move stock.
 */
import { chargeCostPaise, ldoUsedTenthIn } from "@orrn/domain";
import { env } from "@orrn/env/server";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { dispatch } from "@orrn/db/schema/dispatch";
import { alloy, cast, furnace, melt, meltInput, meltReading, spectroResult } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { pressRun } from "@orrn/db/schema/press";
import { purchaseLot, scrapGrade, scrapItem } from "@orrn/db/schema/purchase";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { stockLedger } from "@orrn/db/schema/stock";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, pushChunkedInserts } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { castCloseout } from "../lib/foundry";
import { bad, loadCast, MELT_NOT_FOUND, type Ctx } from "../lib/foundryKit";
import { companySettings, shiftAt } from "../lib/press";
import { productionDayBounds } from "../lib/pressReport";
import { nextCompanySeq } from "../lib/sequence";
import { purchaseReader } from "./vendor";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Day like 2026-10-25");
const BUNDLES_MAX = 500;
const RUNS_MAX = 200;

/** The cast's chain: melts, lots in, spectro, billets, runs, bundles and the customers they went to. */
async function castChain(ctx: Ctx, castId: string) {
  const c = await loadCast(ctx, castId);
  const live = and(eq(melt.companyId, ctx.companyId), eq(melt.castId, c.id), eq(melt.status, "locked"), isNull(melt.cancelledAt));
  // r2 (I-5): a run's billet rows may name several casts (same alloy). `mixed` = a row names a cast other
  // than the run's own; this cast's kg on the run is Σ its own rows.
  const mixedRun = sql`exists (select 1 from press_billet_use mu where mu.company_id = ${ctx.companyId} and mu.press_run_id = ${pressRun.id} and mu.cast_id <> ${pressRun.castId})`;
  const castRowsG = sql`(select sum(cu.kg_g) from press_billet_use cu where cu.company_id = ${ctx.companyId} and cu.press_run_id = ${pressRun.id} and cu.cast_id = ${c.id})`;
  const [melts, lotsIn, spectro, billets, runs, bundles] = await Promise.all([
    ctx.db
      .select({
        id: melt.id,
        seq: melt.seq,
        status: melt.status,
        cancelledAt: melt.cancelledAt,
        inputG: melt.inputG,
        logsG: melt.logsG,
        logsPcs: melt.logsPcs,
        yieldBp: melt.yieldBp,
        castingEndAt: melt.castingEndAt,
        lockedAt: melt.lockedAt,
        furnaceCode: furnace.code,
        correctsMeltId: melt.correctsMeltId,
      })
      .from(melt)
      .leftJoin(furnace, and(eq(furnace.id, melt.furnaceId), eq(furnace.companyId, melt.companyId)))
      .where(and(eq(melt.companyId, ctx.companyId), eq(melt.castId, c.id)))
      .orderBy(asc(melt.seq)),
    ctx.db
      .select({
        lotId: purchaseLot.id,
        lotNumber: purchaseLot.number,
        itemName: scrapItem.name,
        gradeCode: scrapGrade.code,
        kgG: sql<number>`sum(${meltInput.kgG})`,
      })
      .from(meltInput)
      .innerJoin(melt, and(eq(melt.id, meltInput.meltId), eq(melt.companyId, meltInput.companyId)))
      .innerJoin(purchaseLot, and(eq(purchaseLot.id, meltInput.lotId), eq(purchaseLot.companyId, meltInput.companyId)))
      .leftJoin(scrapItem, and(eq(scrapItem.id, purchaseLot.scrapItemId), eq(scrapItem.companyId, purchaseLot.companyId)))
      .leftJoin(scrapGrade, and(eq(scrapGrade.id, purchaseLot.scrapGradeId), eq(scrapGrade.companyId, purchaseLot.companyId)))
      .where(and(eq(meltInput.companyId, ctx.companyId), eq(meltInput.kind, "lot"), live))
      .groupBy(purchaseLot.id, purchaseLot.number, scrapItem.name, scrapGrade.code)
      .orderBy(asc(purchaseLot.number)),
    ctx.db
      .select({ id: spectroResult.id, meltId: spectroResult.meltId, verdict: spectroResult.verdict, source: spectroResult.source, createdAt: spectroResult.createdAt })
      .from(spectroResult)
      .where(and(eq(spectroResult.companyId, ctx.companyId), eq(spectroResult.castId, c.id), isNull(spectroResult.voidedAt)))
      .orderBy(desc(spectroResult.createdAt)),
    castCloseout(ctx.db, ctx.companyId, c.id),
    ctx.db
      .select({
        id: pressRun.id,
        number: pressRun.number,
        status: pressRun.status,
        productionDay: pressRun.productionDay,
        dieInstanceId: pressRun.dieInstanceId,
        dieCode: dieInstance.code,
        // r2 (I-5): a run whose billet rows name several casts reports this cast's rows only.
        billetG: sql<number>`case when ${mixedRun} then ${castRowsG} else coalesce(${pressRun.inputWeighedG}, ${pressRun.inputG}, ${castRowsG}, 0) end`,
        mixed: sql<number>`${mixedRun}`,
        mainCast: sql<number>`${pressRun.castId} = ${c.id}`,
        goodG: pressRun.goodG,
      })
      .from(pressRun)
      .leftJoin(dieInstance, and(eq(dieInstance.id, pressRun.dieInstanceId), eq(dieInstance.companyId, pressRun.companyId)))
      .where(
        and(
          eq(pressRun.companyId, ctx.companyId),
          ne(pressRun.status, "voided"),
          // r2 (I-5): every run that took billets of this cast, not just the runs it is the main cast of.
          sql`(${pressRun.castId} = ${c.id} or exists (select 1 from press_billet_use tu where tu.company_id = ${ctx.companyId} and tu.press_run_id = ${pressRun.id} and tu.cast_id = ${c.id}))`,
        ),
      )
      .orderBy(asc(pressRun.number))
      .limit(RUNS_MAX),
    ctx.db
      .select({
        id: bundle.id,
        serial: bundle.serial,
        status: bundle.status,
        weightG: bundle.weightG,
        dieInstanceId: bundle.dieInstanceId,
        customerId: sql<string | null>`coalesce(${dispatch.customerId}, ${salesOrder.customerId})`,
        customerName: sql<string | null>`(select cu.name from ${customer} cu where cu.company_id = ${ctx.companyId} and cu.id = coalesce(${dispatch.customerId}, ${salesOrder.customerId}))`,
      })
      .from(bundle)
      .leftJoin(dispatch, and(eq(dispatch.id, bundle.currentDispatchId), eq(dispatch.companyId, bundle.companyId)))
      .leftJoin(salesOrderLine, and(eq(salesOrderLine.id, bundle.salesOrderLineId), eq(salesOrderLine.companyId, bundle.companyId)))
      .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, bundle.companyId)))
      .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.castId, c.id), ne(bundle.status, "void")))
      .orderBy(asc(bundle.serial))
      .limit(BUNDLES_MAX + 1),
  ]);
  const latest = new Map<string, (typeof spectro)[number]>();
  for (const s of spectro) if (!latest.has(s.meltId)) latest.set(s.meltId, s);
  // r1 (m-4): the verdict the melt was LOCKED with (latest live result at the lock), shown beside the
  // latest, so a later pass never hides the fail it was locked on.
  const atLock = (meltId: string, lockedAt: Date | null) =>
    lockedAt ? (spectro.find((s) => s.meltId === meltId && s.createdAt.getTime() <= lockedAt.getTime())?.verdict ?? null) : null;
  const customers = new Map<string, { customerId: string; name: string; bundles: number; weightG: number }>();
  for (const b of bundles.slice(0, BUNDLES_MAX)) {
    if (!b.customerId) continue;
    const row = customers.get(b.customerId) ?? { customerId: b.customerId, name: b.customerName ?? "", bundles: 0, weightG: 0 };
    row.bundles += 1;
    row.weightG += b.weightG ?? 0;
    customers.set(b.customerId, row);
  }
  return {
    cast: { id: c.id, number: c.number, year: c.year, alloy: c.alloy, status: c.status, openedAt: c.openedAt, closedAt: c.closedAt },
    melts: melts.map((m) => ({ ...m, spectroVerdict: latest.get(m.id)?.verdict ?? null, lockSpectroVerdict: atLock(m.id, m.lockedAt) })),
    lotsIn: lotsIn.map((l) => ({ ...l, kgG: Number(l.kgG) })),
    billets: {
      producedG: billets.producedG,
      creditedG: billets.creditedG,
      onHandG: billets.billetsOnHandG,
      shortG: billets.shortG,
      tailG: billets.tailG,
      /** r1 (Q59-A): the close's count adjustment (`cast_tail` rows; − = billets the count did not find). */
      adjustedG: billets.adjustedG,
      /** r1: the billets counted at close (kg and pieces), null before a close. */
      countedG: c.closeSummary?.countedG ?? null,
      countedCount: c.closeSummary?.countedCount ?? null,
    },
    /** r2 (I-5): `mainCast` false = the run's bundles carry another cast (the run's own) though it took this cast's billets. */
    runs: runs.map((r) => ({ ...r, billetG: Number(r.billetG), mixed: Boolean(r.mixed), mainCast: Boolean(r.mainCast) })),
    bundles: bundles.slice(0, BUNDLES_MAX).map(({ customerName: _n, ...b }) => ({
      ...b,
      runIds: runs.filter((r) => r.dieInstanceId && r.dieInstanceId === b.dieInstanceId).map((r) => r.id),
    })),
    bundlesTruncated: bundles.length > BUNDLES_MAX,
    customers: [...customers.values()].sort((a, b) => b.weightG - a.weightG),
  };
}

export const foundryTraceProcedures = {
  /** FP-FD-16/17: everything a cast became (any member: the floor and QC trace by cast number). */
  trace: companyProcedure.input(z.object({ castId: id })).query(({ ctx, input }) => castChain(ctx, input.castId)),

  /** FP-FD-17 from a bundle (by id or serial): its cast's chain, the runs narrowed to the bundle's die copy. */
  traceBundle: companyProcedure
    .input(z.object({ bundleId: id.optional(), serial: z.string().trim().min(1).max(40).optional() }).refine((v) => v.bundleId || v.serial, { message: "Give the bundle" }))
    .query(async ({ ctx, input }) => {
      const [b] = await ctx.db
        .select({ id: bundle.id, serial: bundle.serial, status: bundle.status, weightG: bundle.weightG, castId: bundle.castId, dieInstanceId: bundle.dieInstanceId })
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), input.bundleId ? eq(bundle.id, input.bundleId) : eq(bundle.serial, input.serial!)))
        .limit(1);
      if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      if (!b.castId) return { bundle: b, chain: null };
      const chain = await castChain(ctx, b.castId);
      return { bundle: b, chain: { ...chain, runs: chain.runs.filter((r) => !b.dieInstanceId || r.dieInstanceId === b.dieInstanceId) } };
    }),

  /**
   * FP-FD-20: what the metal of a cast cost: Σ lot kg × the lot's rate per kg (paise), from the
   * locked melts. `costPaise` is null when a lot has no rate. Purchase readers only (RP9).
   */
  cost: purchaseReader.input(z.object({ castId: id })).query(async ({ ctx, input }) => {
    const c = await loadCast(ctx, input.castId);
    const live = and(eq(melt.companyId, ctx.companyId), eq(melt.castId, c.id), eq(melt.status, "locked"), isNull(melt.cancelledAt));
    const [lots, [streams], co] = await Promise.all([
      ctx.db
        .select({ lotId: purchaseLot.id, number: purchaseLot.number, ratePaise: purchaseLot.ratePaise, kgG: sql<number>`sum(${meltInput.kgG})` })
        .from(meltInput)
        .innerJoin(melt, and(eq(melt.id, meltInput.meltId), eq(melt.companyId, meltInput.companyId)))
        .innerJoin(purchaseLot, and(eq(purchaseLot.id, meltInput.lotId), eq(purchaseLot.companyId, meltInput.companyId)))
        .where(and(eq(meltInput.companyId, ctx.companyId), eq(meltInput.kind, "lot"), live))
        .groupBy(purchaseLot.id, purchaseLot.number, purchaseLot.ratePaise)
        .orderBy(asc(purchaseLot.number)),
      ctx.db
        .select({ g: sql<number>`coalesce(sum(${meltInput.kgG}), 0)` })
        .from(meltInput)
        .innerJoin(melt, and(eq(melt.id, meltInput.meltId), eq(melt.companyId, meltInput.companyId)))
        .where(and(eq(meltInput.companyId, ctx.companyId), eq(meltInput.kind, "return_stream"), live)),
      castCloseout(ctx.db, ctx.companyId, c.id),
    ]);
    const lines = lots.map((l) => {
      const kgG = Number(l.kgG);
      const ratePaise = l.ratePaise > 0 ? l.ratePaise : null;
      return { lotId: l.lotId, number: l.number, kgG, ratePaise, costPaise: chargeCostPaise([{ kgG, ratePaise }]) };
    });
    const costPaise = chargeCostPaise(lines);
    return {
      castId: c.id,
      number: c.number,
      lots: lines,
      lotsG: lines.reduce((s, l) => s + l.kgG, 0),
      streamsG: Number(streams?.g ?? 0),
      producedG: co.producedG,
      costPaise,
      /** Metal cost per kg of billets produced (paise), null without billets or a rate. */
      perKgBilletPaise: costPaise != null && co.producedG > 0 ? Math.round((costPaise * 1000) / co.producedG) : null,
    };
  }),
};

export const foundryStockRouter = router({
  /** Billets in stock by cast (BILLET ledger, any location) with alloy totals. Any member. */
  billets: companyProcedure
    .input(z.object({ includeZero: z.boolean().default(false), limit: z.number().int().min(1).max(500).default(200) }).default({ includeZero: false, limit: 200 }))
    .query(async ({ ctx, input }) => {
      const g = sql<number>`sum(${stockLedger.qtyG})`;
      // r1 (Q59-A): the count adjustment at close, part of on hand, shown on its own.
      const adj = sql<number>`coalesce(sum(case when ${stockLedger.voucherType} = 'cast_tail' then ${stockLedger.qtyG} else 0 end), 0)`;
      const rows = await ctx.db
        .select({ castId: stockLedger.itemRef, onHandG: g, adjustedG: adj, number: cast.number, year: cast.year, alloy: cast.alloy, status: cast.status })
        .from(stockLedger)
        .leftJoin(cast, and(eq(cast.id, stockLedger.itemRef), eq(cast.companyId, stockLedger.companyId)))
        .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.itemKind, "billet")))
        .groupBy(stockLedger.itemRef, cast.number, cast.year, cast.alloy, cast.status)
        .having(input.includeZero ? undefined : sql`${g} <> 0`)
        .orderBy(desc(cast.year), asc(cast.number))
        .limit(input.limit);
      const casts = rows.map((r) => ({ ...r, onHandG: Number(r.onHandG), adjustedG: Number(r.adjustedG), alloy: r.alloy ?? "?" }));
      // r2 (ported rule, satellite @ddf3bd9c): the alloy totals and the totals cover EVERY cast, not
      // just the page the limit returned. One grouped pass over the per-cast sums.
      const perCast = ctx.db
        .select({ alloy: sql<string | null>`${cast.alloy}`.as("pc_alloy"), onHandG: sql<number>`${g}`.as("pc_g"), adjustedG: sql<number>`${adj}`.as("pc_adj") })
        .from(stockLedger)
        .leftJoin(cast, and(eq(cast.id, stockLedger.itemRef), eq(cast.companyId, stockLedger.companyId)))
        .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.itemKind, "billet")))
        .groupBy(stockLedger.itemRef, cast.alloy)
        .having(input.includeZero ? undefined : sql`${g} <> 0`)
        .as("per_cast");
      const totals = await ctx.db
        .select({ alloy: perCast.alloy, casts: sql<number>`count(*)`, onHandG: sql<number>`coalesce(sum(${perCast.onHandG}), 0)`, adjustedG: sql<number>`coalesce(sum(${perCast.adjustedG}), 0)` })
        .from(perCast)
        .groupBy(sql`pc_alloy`);
      const byAlloy = totals
        .map((t) => ({ alloy: t.alloy ?? "?", casts: Number(t.casts), onHandG: Number(t.onHandG) }))
        .sort((a, b) => a.alloy.localeCompare(b.alloy));
      return {
        casts,
        byAlloy,
        totalG: byAlloy.reduce((s, r) => s + r.onHandG, 0),
        adjustedG: totals.reduce((s, r) => s + Number(r.adjustedG), 0),
      };
    }),
});

/** FP-FD-19: locked melts grouped by production day (casting end), alloy or furnace. */
export const foundryYieldProcedure = actionProcedure("reports.read")
  .input(z.object({ from: day, to: day, groupBy: z.enum(["day", "alloy", "furnace"]).default("day") }))
  .query(async ({ ctx, input }) => {
    if (input.to < input.from) bad("The end day is before the start day");
    const settings = await companySettings(ctx.db, ctx.companyId);
    const start = productionDayBounds(settings, input.from).startMs;
    const end = productionDayBounds(settings, input.to).endMs;
    if (end - start > 93 * 86_400_000) bad("Pick at most 92 days");
    const rows = await ctx.db
      .select({
        castingEndAt: melt.castingEndAt,
        alloy: melt.alloy,
        alloyName: alloy.name,
        furnaceCode: furnace.code,
        inputG: melt.inputG,
        logsG: melt.logsG,
        drossG: melt.drossG,
        feG: melt.feG,
        returnsG: melt.returnsG,
        lossG: melt.lossG,
        ldoStart: melt.ldoStartTenthIn,
        ldoEnd: melt.ldoEndTenthIn,
      })
      .from(melt)
      .leftJoin(alloy, and(eq(alloy.id, melt.alloyId), eq(alloy.companyId, melt.companyId)))
      .leftJoin(furnace, and(eq(furnace.id, melt.furnaceId), eq(furnace.companyId, melt.companyId)))
      .where(and(eq(melt.companyId, ctx.companyId), eq(melt.status, "locked"), isNull(melt.cancelledAt), gte(melt.castingEndAt, new Date(start)), lt(melt.castingEndAt, new Date(end))))
      .orderBy(asc(melt.castingEndAt))
      .limit(5_000);
    // r1 (Q59-A): the casts' count adjustments posted in the range (billets the close count did not
    // find, or found extra), by the day they posted or the cast's alloy. A furnace cannot own one.
    const tails = await ctx.db
      .select({ postedAt: stockLedger.postedAt, alloy: cast.alloy, qtyG: stockLedger.qtyG })
      .from(stockLedger)
      .innerJoin(cast, and(eq(cast.id, stockLedger.voucherId), eq(cast.companyId, stockLedger.companyId)))
      .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.voucherType, "cast_tail"), gte(stockLedger.postedAt, new Date(start)), lt(stockLedger.postedAt, new Date(end))))
      .limit(5_000);
    type Group = { key: string; melts: number; inputG: number; logsG: number; drossG: number; feG: number; returnsG: number; burnG: number; ldoTenthIn: number; tailAdjustG: number };
    const empty = (key: string): Group => ({ key, melts: 0, inputG: 0, logsG: 0, drossG: 0, feG: 0, returnsG: 0, burnG: 0, ldoTenthIn: 0, tailAdjustG: 0 });
    const groups = new Map<string, Group>();
    for (const t of tails) {
      if (input.groupBy === "furnace") continue;
      const key = input.groupBy === "day" ? shiftAt(settings, t.postedAt.getTime()).productionDay : t.alloy;
      const g = groups.get(key) ?? empty(key);
      g.tailAdjustG += t.qtyG;
      groups.set(key, g);
    }
    for (const r of rows) {
      const key =
        input.groupBy === "day" ? shiftAt(settings, r.castingEndAt!.getTime()).productionDay : input.groupBy === "alloy" ? r.alloy : (r.furnaceCode ?? "-");
      const g = groups.get(key) ?? empty(key);
      g.melts += 1;
      g.inputG += r.inputG;
      g.logsG += r.logsG;
      g.drossG += r.drossG;
      g.feG += r.feG;
      g.returnsG += r.returnsG;
      g.burnG += r.lossG;
      g.ldoTenthIn += ldoUsedTenthIn(r.ldoStart, r.ldoEnd) ?? 0;
      groups.set(key, g);
    }
    const bp = (n: number, d: number) => (d > 0 ? Math.round((n * 10_000) / d) : null);
    const out = [...groups.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => ({
        ...g,
        yieldBp: bp(g.logsG, g.inputG),
        burnBp: bp(g.burnG, g.inputG),
        /** LDO used per tonne of logs cast (FP-FD-19), tenths of an inch. r1 (m-9): was per tonne charged. */
        ldoPerTonneTenthIn: g.logsG > 0 ? Math.round((g.ldoTenthIn * 1_000_000) / g.logsG) : null,
      }));
    const total = out.reduce(
      (t, g) => ({ melts: t.melts + g.melts, inputG: t.inputG + g.inputG, logsG: t.logsG + g.logsG, burnG: t.burnG + g.burnG }),
      { melts: 0, inputG: 0, logsG: 0, burnG: 0 },
    );
    const tailAdjustG = tails.reduce((s, t) => s + t.qtyG, 0);
    return {
      groupBy: input.groupBy,
      from: input.from,
      to: input.to,
      rows: out,
      total: {
        ...total,
        yieldBp: bp(total.logsG, total.inputG),
        /** r1: Σ count adjustments at close in the range, and the yield of the billets the counts found. */
        tailAdjustG,
        netYieldBp: bp(total.logsG + tailAdjustG, total.inputG),
      },
      truncated: rows.length === 5_000,
    };
  });

/** FOUNDRY_SIMULATOR seam: "1" / "true" turns on `readings.simulate` (never a device reading). */
export function foundrySimulatorEnabled(e: { FOUNDRY_SIMULATOR?: string } = env as { FOUNDRY_SIMULATOR?: string }): boolean {
  return e.FOUNDRY_SIMULATOR === "1" || e.FOUNDRY_SIMULATOR === "true";
}

/** A melt the readings go on: the company's, not cancelled. */
async function readingMelt(ctx: Ctx, meltId: string) {
  const [m] = await ctx.db
    .select({ id: melt.id, furnaceId: melt.furnaceId, status: melt.status, cancelledAt: melt.cancelledAt, chargingStartAt: melt.chargingStartAt, castingEndAt: melt.castingEndAt, seq: melt.seq })
    .from(melt)
    .where(and(eq(melt.id, meltId), eq(melt.companyId, ctx.companyId)))
    .limit(1);
  if (!m) throw new TRPCError(MELT_NOT_FOUND);
  if (m.cancelledAt || m.status === "cancelled") bad("This melt is cancelled");
  return m;
}

/** Deterministic furnace curve for the simulator: heat up to ~760 °C, hold, small wobble (°C × 10). */
export function simulatedFurnaceCurve(fromMs: number, toMs: number, stepMs = 10 * 60_000): { readAt: number; valueX10: number }[] {
  const out: { readAt: number; valueX10: number }[] = [];
  const span = Math.max(toMs - fromMs, stepMs);
  for (let t = fromMs, i = 0; t <= fromMs + span && out.length < 200; t += stepMs, i += 1) {
    const share = Math.min(1, (t - fromMs) / (span * 0.4));
    const base = 250 + share * (760 - 250);
    const wobble = ((i * 37) % 11) - 5;
    out.push({ readAt: t, valueX10: Math.round((base + wobble) * 10) });
  }
  return out;
}

export const foundryReadingsRouter = router({
  /** A melt's furnace readings, oldest first (≤ 500). Any member. */
  list: companyProcedure.input(z.object({ meltId: id })).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select({ id: meltReading.id, kind: meltReading.kind, valueX10: meltReading.valueX10, readAt: meltReading.readAt, source: meltReading.source })
      .from(meltReading)
      .where(and(eq(meltReading.companyId, ctx.companyId), eq(meltReading.meltId, input.meltId)))
      .orderBy(asc(meltReading.readAt))
      .limit(500);
    return { items, simulator: foundrySimulatorEnabled() };
  }),

  /** A pyrometer reading typed by a person (melt.enter). */
  add: actionProcedure("melt.enter")
    .input(z.object({ meltId: id, valueX10: z.number().int().min(0).max(15_000), readAt: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      const m = await readingMelt(ctx, input.meltId);
      const at = clockNow();
      const readAt = input.readAt ?? at.getTime();
      if (readAt > at.getTime() + 10 * 60_000) bad("The reading time is in the future");
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(meltReading)
          .values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, meltId: m.id, furnaceId: m.furnaceId, kind: "furnace_temp", valueX10: input.valueX10, readAt: new Date(readAt), source: "typed", createdBy: ctx.session.user.id })
          .onConflictDoNothing(),
        // r1 (m-12): a repeated reading (same melt, instant, source) is dropped, and so is its audit.
        auditInsertGuarded(
          ctx,
          { action: "foundry.reading.add", subjectType: "melt", subjectId: m.id, meta: { readingId: rowId, valueX10: input.valueX10, readAt } },
          { from: meltReading, where: and(eq(meltReading.id, rowId), eq(meltReading.companyId, ctx.companyId)) },
        ),
      ]);
      const [landed] = await ctx.db.select({ id: meltReading.id }).from(meltReading).where(and(eq(meltReading.id, rowId), eq(meltReading.companyId, ctx.companyId))).limit(1);
      return { id: rowId, added: Boolean(landed) };
    }),

  /**
   * FOUNDRY_SIMULATOR only (local / demo): a temperature curve over the melt's charging → casting
   * window (or the last 4 hours), source `simulated`. A repeat writes nothing new.
   */
  simulate: actionProcedure("melt.enter")
    .input(z.object({ meltId: id }))
    .mutation(async ({ ctx, input }) => {
      if (!foundrySimulatorEnabled()) throw new TRPCError({ code: "FORBIDDEN", message: "The furnace simulator is off" });
      const m = await readingMelt(ctx, input.meltId);
      const now = clockNow().getTime();
      const from = m.chargingStartAt?.getTime() ?? now - 4 * 3_600_000;
      const to = m.castingEndAt?.getTime() ?? now;
      const curve = simulatedFurnaceCurve(from, Math.max(to, from));
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const rows = curve.map((p) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        meltId: m.id,
        furnaceId: m.furnaceId,
        kind: "furnace_temp" as const,
        valueX10: p.valueX10,
        readAt: new Date(p.readAt),
        source: "simulated" as const,
        createdBy: ctx.session.user.id,
      }));
      const statements = [auditInsert(ctx, { action: "foundry.reading.simulate", subjectType: "melt", subjectId: m.id, meta: { readings: rows.length, from, to } })];
      pushChunkedInserts(statements, (part) => ctx.db.insert(meltReading).values(part).onConflictDoNothing(), rows);
      await atomicBatch(ctx.db, statements);
      return { readings: rows.length };
    }),
});

