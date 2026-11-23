/**
 * XE store (rows 71 to 73), nested under `store`:
 * - `store.valuation.items`: what each item holds now, its value and average rate (store.value);
 * - `store.valuation.month`: the month-end stock value per item, opening / in / out / closing on the
 *   plant's calendar month (store.value);
 * - `store.settings`: the over-receipt tolerance on PO lines (read by store and PO people, set by
 *   masters.publish holders);
 * - `store.belowMinimum`: items under their minimum, with any indent already raised for them (Today).
 *
 * - `store.valuation.pending` / `setGrnRate` / `setOpeningRate`: rates the storekeeper did not set
 *   (store.rate: office, manager, admin, accountant, owner).
 *
 * Every figure is a sum of the money frozen on the entries and opening rates (`lib/storeValue.ts`).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { company } from "@orrn/db/schema/tenant";
import { COUNTABLE_STORE_UNITS, storeItem, storeTxn } from "@orrn/db/schema/store";
import { storeIndent, storeIndentLine, storeOpeningRate, storePo } from "@orrn/db/schema/storeBuy";
import {
  averageRatePaise,
  belowMinimum,
  MAX_PO_OVER_RECEIPT_BP,
  rateFitsQty,
  reorderQtyMilli,
  STORE_MAX_RATE_PAISE,
  unratedMilli,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, router } from "../index";
import type { Context } from "../context";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { settingsPatchSql } from "../lib/companySettings";
import { companyTimezone, zonedMidnightMs } from "../lib/dayWindow";
import { nextCompanySeq } from "../lib/sequence";
import { loadStoreItem, resolveStoreLocation, storeBalanceSql } from "../lib/store";
import { PO_TOLERANCE_KEY, readPoTolerance } from "../lib/storeBuy";
import {
  ISSUED_SINCE_MESSAGE,
  storeHeldQtySql,
  storeHeldValueSql,
  storeOutSinceSql,
  storeRatedQtySql,
} from "../lib/storeValue";

const valueReader = anyActionProcedure("store.value");
const rateReader = anyActionProcedure("store.rate", "store.value");
const rateSetter = actionProcedure("store.rate");
const settingsReader = anyActionProcedure("store.txn", "masters.publish", "po.view", "po.manage", "store.value");
const settingsWriter = actionProcedure("masters.publish");
const lowReader = anyActionProcedure("store.txn", "masters.publish");

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const id64 = z.string().min(1).max(64);
const rateInput = z.number().int().min(0).max(STORE_MAX_RATE_PAISE);

type Ctx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

/** Why a pending GRN's rate cannot be set now, from the state as it is (null = it can). */
async function pendingRateBlock(ctx: Ctx, txnId: string): Promise<TRPCError | null> {
  const [txn] = await ctx.db
    .select({
      number: storeTxn.number,
      kind: storeTxn.kind,
      cancelledAt: storeTxn.cancelledAt,
      ratePending: storeTxn.ratePending,
      outSince: sql<number>`(case when ${storeOutSinceSql(ctx.companyId, sql`${storeTxn}`)} then 1 else 0 end)`,
    })
    .from(storeTxn)
    .where(and(eq(storeTxn.id, txnId), eq(storeTxn.companyId, ctx.companyId)))
    .limit(1);
  if (!txn) return new TRPCError({ code: "NOT_FOUND", message: "Store entry not found" });
  if (txn.kind !== "grn" || txn.cancelledAt !== null || !txn.ratePending) {
    return new TRPCError({ code: "BAD_REQUEST", message: `${txn.number} has no rate waiting to be set` });
  }
  if (Number(txn.outSince) === 1) return new TRPCError({ code: "BAD_REQUEST", message: ISSUED_SINCE_MESSAGE });
  return null;
}

export const storeValuationRouter = router({
  /**
   * Per item: held quantity, held value, the average rate over RATED stock, the quantity held with no
   * rate yet ("rate not set": old stock until an opening rate is given), and GRNs whose rate is pending.
   */
  items: valueReader.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: storeItem.id,
        name: storeItem.name,
        unit: storeItem.unit,
        category: storeItem.category,
        active: storeItem.active,
        heldMilli: storeHeldQtySql(ctx.companyId, sql`${storeItem.id}`),
        ratedMilli: storeRatedQtySql(ctx.companyId, sql`${storeItem.id}`),
        heldPaise: storeHeldValueSql(ctx.companyId, sql`${storeItem.id}`),
        pendingCount: sql<number>`(
          select count(*) from ${storeTxn} u
          where u.company_id = ${ctx.companyId} and u.item_id = ${sql`${storeItem.id}`} and u.kind = 'grn'
            and u.cancelled_at is null and u.rate_pending = 1
        )`,
        openingRatePaise: sql<number | null>`(
          select o.rate_paise from ${storeOpeningRate} o where o.company_id = ${ctx.companyId} and o.item_id = ${sql`${storeItem.id}`}
          order by o.created_at desc limit 1
        )`,
      })
      .from(storeItem)
      .where(eq(storeItem.companyId, ctx.companyId))
      .orderBy(asc(storeItem.name))
      .limit(1000);
    const items = rows
      .map((r) => {
        const heldMilli = Number(r.heldMilli);
        const ratedMilli = Number(r.ratedMilli);
        const valuePaise = Number(r.heldPaise);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          active: r.active,
          heldMilli,
          valuePaise,
          avgRatePaise: averageRatePaise({ ratedMilli, valuePaise }),
          /** Held with no rate ("rate not set"); not in the value or the average until an opening rate. */
          unratedMilli: unratedMilli(heldMilli, ratedMilli),
          pendingCount: Number(r.pendingCount),
          openingRatePaise: r.openingRatePaise === null ? null : Number(r.openingRatePaise),
        };
      })
      .filter((r) => r.active || r.heldMilli !== 0);
    return { items, totalPaise: items.reduce((s, r) => s + r.valuePaise, 0) };
  }),

  /**
   * GRNs taken in with their rate pending (newest first), each valued at the average it borrowed, and
   * whether its rate can still be set (nothing went out of the item since it came in).
   */
  pending: rateReader.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: storeTxn.id,
        number: storeTxn.number,
        itemId: storeTxn.itemId,
        itemName: storeItem.name,
        unit: storeItem.unit,
        qtyMilli: storeTxn.qtyMilli,
        valuePaise: storeTxn.valuePaise,
        grnRef: storeTxn.grnRef,
        createdAt: storeTxn.createdAt,
        outSince: sql<number>`(case when ${storeOutSinceSql(ctx.companyId, sql`${storeTxn}`)} then 1 else 0 end)`,
      })
      .from(storeTxn)
      .innerJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
      .where(
        and(
          eq(storeTxn.companyId, ctx.companyId),
          eq(storeTxn.kind, "grn"),
          sql`${storeTxn.cancelledAt} is null`,
          eq(storeTxn.ratePending, true),
        ),
      )
      .orderBy(desc(storeTxn.createdAt))
      .limit(200);
    return { items: rows.map(({ outSince, ...r }) => ({ ...r, canSet: Number(outSince) !== 1 })) };
  }),

  /**
   * Set a pending GRN's rate (store.rate). Only while nothing went out of the item after it: no issue
   * was valued with the money it borrowed, so its value can change exactly. The UPDATE holds the same
   * rule in its WHERE (write time), so a racing issue cannot slip in. Audited with both values.
   */
  setGrnRate: rateSetter.input(z.object({ txnId: id64, ratePaise: rateInput })).mutation(async ({ ctx, input }) => {
    const block = await pendingRateBlock(ctx, input.txnId);
    if (block) throw block;
    const [txn] = await ctx.db
      .select({ number: storeTxn.number, itemId: storeTxn.itemId, qtyMilli: storeTxn.qtyMilli, valuePaise: storeTxn.valuePaise })
      .from(storeTxn)
      .where(and(eq(storeTxn.id, input.txnId), eq(storeTxn.companyId, ctx.companyId)))
      .limit(1);
    if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "Store entry not found" });
    if (!rateFitsQty(txn.qtyMilli, input.ratePaise)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity times rate is too large for one GRN" });
    }
    const valuePaise = Math.round((txn.qtyMilli * input.ratePaise) / 1000);
    const at = clockNow();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const mine = and(eq(storeTxn.id, input.txnId), eq(storeTxn.companyId, ctx.companyId), eq(storeTxn.serverSeq, seq), eq(storeTxn.ratePending, false));
    await atomicBatch(ctx.db, [
      ctx.db
        .update(storeTxn)
        .set({ ratePaise: input.ratePaise, valuePaise, ratedMilli: txn.qtyMilli, ratePending: false, serverSeq: seq, updatedAt: at })
        .where(
          and(
            eq(storeTxn.id, input.txnId),
            eq(storeTxn.companyId, ctx.companyId),
            eq(storeTxn.kind, "grn"),
            sql`${storeTxn.cancelledAt} is null`,
            eq(storeTxn.ratePending, true),
            sql`not ${storeOutSinceSql(ctx.companyId, sql`${storeTxn}`)}`,
          ),
        ),
      auditInsertGuarded(
        auditCtx(ctx),
        {
          action: "store.rate.set",
          subjectType: "store_txn",
          subjectId: input.txnId,
          meta: { number: txn.number, itemId: txn.itemId, ratePaise: input.ratePaise, valuePaise: { before: txn.valuePaise, after: valuePaise } },
        },
        { from: storeTxn, where: mine },
      ),
    ]);
    const [ok] = await ctx.db.select({ id: storeTxn.id }).from(storeTxn).where(mine).limit(1);
    if (!ok) throw (await pendingRateBlock(ctx, input.txnId)) ?? new TRPCError({ code: "CONFLICT", message: "The store changed; try again" });
    return { txnId: input.txnId, number: txn.number, ratePaise: input.ratePaise, valuePaise };
  }),

  /**
   * An item's opening rate (store.rate): the stock it holds with no rate (old stock from before
   * valuation) becomes rated at this rate. The quantity is what is unrated when the INSERT runs, so an
   * issue racing it cannot be rated twice; pending GRNs that had no average to borrow are covered by it
   * and their own rate can no longer be set. Audited.
   */
  setOpeningRate: rateSetter.input(z.object({ itemId: id64, ratePaise: rateInput })).mutation(async ({ ctx, input }) => {
    const item = await loadStoreItem(ctx.db, ctx.companyId, input.itemId);
    const itemSql = sql`${storeItem.id}`;
    const unrated = sql<number>`(${storeHeldQtySql(ctx.companyId, itemSql)} - ${storeRatedQtySql(ctx.companyId, itemSql)})`;
    const [now] = await ctx.db
      .select({ unrated })
      .from(storeItem)
      .where(and(eq(storeItem.id, item.id), eq(storeItem.companyId, ctx.companyId)))
      .limit(1);
    const unratedNow = Number(now?.unrated ?? 0);
    if (unratedNow <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: `All the ${item.name} in the store already has a rate` });
    if (!rateFitsQty(unratedNow, input.ratePaise)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity times rate is too large" });
    }
    const id = crypto.randomUUID();
    const userId = ctx.session.user.id;
    const at = clockNow();
    await atomicBatch(ctx.db, [
      ctx.db.insert(storeOpeningRate).select(
        ctx.db
          .select({
            id: sql<string>`${id}`.as("id"),
            companyId: sql<string>`${storeItem.companyId}`.as("company_id"),
            itemId: sql<string>`${storeItem.id}`.as("item_id"),
            ratePaise: sql<number>`${input.ratePaise}`.as("rate_paise"),
            qtyMilli: unrated.as("qty_milli"),
            // round(qty x rate / 1000) in integers, as `lineValuePaise` (both are positive).
            valuePaise: sql<number>`cast(((${unrated}) * ${input.ratePaise} + 500) / 1000 as integer)`.as("value_paise"),
            createdBy: sql<string | null>`${userId}`.as("created_by"),
            createdAt: sql<number>`${at.getTime()}`.as("created_at"),
          })
          .from(storeItem)
          .where(and(eq(storeItem.id, item.id), eq(storeItem.companyId, ctx.companyId), sql`${unrated} > 0`)),
      ),
      // Pending GRNs with no average to borrow are now valued by this rate: their own rate is closed.
      ctx.db
        .update(storeTxn)
        .set({ ratePending: false, updatedAt: at })
        .where(
          and(
            eq(storeTxn.companyId, ctx.companyId),
            eq(storeTxn.itemId, item.id),
            eq(storeTxn.kind, "grn"),
            sql`${storeTxn.cancelledAt} is null`,
            eq(storeTxn.ratePending, true),
            eq(storeTxn.ratedMilli, 0),
            sql`exists (select 1 from ${storeOpeningRate} n where n.id = ${id} and n.company_id = ${ctx.companyId})`,
          ),
        ),
      auditInsertGuarded(
        auditCtx(ctx),
        {
          action: "store.rate.opening",
          subjectType: "store_item",
          subjectId: item.id,
          meta: { name: item.name, ratePaise: input.ratePaise, unratedMilli: unratedNow },
        },
        { from: storeOpeningRate, where: and(eq(storeOpeningRate.id, id), eq(storeOpeningRate.companyId, ctx.companyId)) },
      ),
    ]);
    const [row] = await ctx.db
      .select({ qtyMilli: storeOpeningRate.qtyMilli, valuePaise: storeOpeningRate.valuePaise })
      .from(storeOpeningRate)
      .where(and(eq(storeOpeningRate.id, id), eq(storeOpeningRate.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: `All the ${item.name} in the store already has a rate` });
    return { id, itemId: item.id, ratePaise: input.ratePaise, qtyMilli: row.qtyMilli, valuePaise: row.valuePaise };
  }),

  /**
   * Month-end stock value for `month` (`YYYY-MM`) on the plant's calendar: per item, held at the start,
   * received (GRNs, less GRNs cancelled in the month), issued (MRSs, less MRSs cancelled in the month),
   * the value opening rates gave old stock in the month, and held at the end, in quantity and money,
   * plus how much held at the end has no rate. Same rules as `monthValuation` in @orrn/domain: opening
   * + in - out + rated = closing, with nothing clamped.
   */
  month: valueReader.input(z.object({ month: z.string().regex(MONTH) })).query(async ({ ctx, input }) => {
    const [, y, m] = MONTH.exec(input.month)!;
    const year = Number(y);
    const month = Number(m);
    const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
    const tz = companyTimezone(co?.settings as Record<string, unknown> | null);
    const from = zonedMidnightMs(tz, { year, month, day: 1 });
    const to = zonedMidnightMs(tz, { year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 });
    const sign = sql`(case when t.kind = 'grn' then 1 else -1 end)`;
    const before = (col: string) => sql.raw(`t.${col} < ${from}`);
    const within = (col: string) => sql.raw(`(t.${col} >= ${from} and t.${col} < ${to})`);
    const untilEnd = sql.raw(`(t.cancelled_at is null or t.cancelled_at >= ${to})`);
    const rows = await ctx.db.all<{
      item_id: string;
      open_q: number; open_v: number; in_q: number; in_v: number; out_q: number; out_v: number; rated_q: number;
    }>(sql`
      select t.item_id as item_id,
        sum(case when ${before("created_at")} then ${sign} * t.qty_milli else 0 end)
          - sum(case when t.cancelled_at is not null and ${before("cancelled_at")} then ${sign} * t.qty_milli else 0 end) as open_q,
        sum(case when ${before("created_at")} then ${sign} * t.value_paise else 0 end)
          - sum(case when t.cancelled_at is not null and ${before("cancelled_at")} then ${sign} * t.value_paise else 0 end) as open_v,
        sum(case when t.kind = 'grn' and ${within("created_at")} then t.qty_milli else 0 end)
          - sum(case when t.kind = 'grn' and t.cancelled_at is not null and ${within("cancelled_at")} then t.qty_milli else 0 end) as in_q,
        sum(case when t.kind = 'grn' and ${within("created_at")} then t.value_paise else 0 end)
          - sum(case when t.kind = 'grn' and t.cancelled_at is not null and ${within("cancelled_at")} then t.value_paise else 0 end) as in_v,
        sum(case when t.kind = 'mrs' and ${within("created_at")} then t.qty_milli else 0 end)
          - sum(case when t.kind = 'mrs' and t.cancelled_at is not null and ${within("cancelled_at")} then t.qty_milli else 0 end) as out_q,
        sum(case when t.kind = 'mrs' and ${within("created_at")} then t.value_paise else 0 end)
          - sum(case when t.kind = 'mrs' and t.cancelled_at is not null and ${within("cancelled_at")} then t.value_paise else 0 end) as out_v,
        sum(case when ${untilEnd} then ${sign} * t.rated_milli else 0 end) as rated_q
      from ${storeTxn} t
      where t.company_id = ${ctx.companyId} and t.created_at < ${to}
      group by t.item_id
    `);
    // Opening rates: value before the month goes into the opening, in the month into "rated".
    const rates = await ctx.db.all<{ item_id: string; open_v: number; rated_v: number; rated_q: number }>(sql`
      select o.item_id as item_id,
        sum(case when o.created_at < ${from} then o.value_paise else 0 end) as open_v,
        sum(case when o.created_at >= ${from} then o.value_paise else 0 end) as rated_v,
        sum(o.qty_milli) as rated_q
      from ${storeOpeningRate} o
      where o.company_id = ${ctx.companyId} and o.created_at < ${to}
      group by o.item_id
    `);
    const rateBy = new Map(rates.map((r) => [r.item_id, r]));
    const ids = rows.map((r) => r.item_id);
    const names = new Map<string, { name: string; unit: string; category: string }>();
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const found = await ctx.db
        .select({ id: storeItem.id, name: storeItem.name, unit: storeItem.unit, category: storeItem.category })
        .from(storeItem)
        .where(and(eq(storeItem.companyId, ctx.companyId), inArray(storeItem.id, part)));
      for (const f of found) names.set(f.id, f);
    }
    const items = rows
      .map((r) => {
        const n = names.get(r.item_id);
        const rate = rateBy.get(r.item_id);
        const openingMilli = Number(r.open_q);
        const openingPaise = Number(r.open_v) + Number(rate?.open_v ?? 0);
        const inMilli = Number(r.in_q);
        const inPaise = Number(r.in_v);
        const outMilli = Number(r.out_q);
        const outPaise = Number(r.out_v);
        const ratedPaise = Number(rate?.rated_v ?? 0);
        const closingMilli = openingMilli + inMilli - outMilli;
        return {
          itemId: r.item_id,
          name: n?.name ?? "",
          unit: n?.unit ?? "kg",
          category: n?.category ?? "other",
          openingMilli,
          openingPaise,
          inMilli,
          inPaise,
          outMilli,
          outPaise,
          ratedPaise,
          closingMilli,
          closingPaise: openingPaise + inPaise - outPaise + ratedPaise,
          /** Held at the end with no rate ("rate not set"). */
          closingUnratedMilli: unratedMilli(closingMilli, Number(r.rated_q) + Number(rate?.rated_q ?? 0)),
        };
      })
      .filter((r) => r.openingMilli !== 0 || r.inMilli !== 0 || r.outMilli !== 0 || r.closingMilli !== 0 || r.ratedPaise !== 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    const sum = (k: "openingPaise" | "inPaise" | "outPaise" | "ratedPaise" | "closingPaise") => items.reduce((s, r) => s + r[k], 0);
    return {
      month: input.month,
      from,
      to,
      items,
      totals: {
        openingPaise: sum("openingPaise"),
        inPaise: sum("inPaise"),
        outPaise: sum("outPaise"),
        ratedPaise: sum("ratedPaise"),
        closingPaise: sum("closingPaise"),
      },
    };
  }),
});

export const storeSettingsRouter = router({
  get: settingsReader.query(async ({ ctx }) => ({ poOverReceiptBp: await readPoTolerance(ctx.db, ctx.companyId) })),

  /** The over-receipt tolerance on PO lines in basis points (500 = 5 %). */
  setPoTolerance: settingsWriter
    .input(z.object({ bp: z.number().int().min(0).max(MAX_PO_OVER_RECEIPT_BP) }))
    .mutation(async ({ ctx, input }) => {
      const before = await readPoTolerance(ctx.db, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(company)
          .set({ settings: settingsPatchSql({ [PO_TOLERANCE_KEY]: input.bp }) as never })
          .where(eq(company.id, ctx.companyId)),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "store.settings.update", subjectType: "company", subjectId: ctx.companyId, meta: { poOverReceiptBp: { before, after: input.bp } } },
          { from: company, where: eq(company.id, ctx.companyId) },
        ),
      ]);
      return { poOverReceiptBp: input.bp };
    }),
});

/**
 * Items with a minimum that hold less than it (row 72), with what "make indent" would ask for, and the
 * live indent (open, approved, or ordered on an order not yet closed or cancelled) that already has the
 * item, so Today offers "open the indent" instead of making a second one.
 */
export const storeBelowMinimum = lowReader.query(async ({ ctx }) => {
  const store = await resolveStoreLocation(ctx.db, ctx.companyId, { optional: true });
  if (!store) return { items: [] };
  const rows = await ctx.db
    .select({
      id: storeItem.id,
      name: storeItem.name,
      unit: storeItem.unit,
      minMilli: storeItem.minMilli,
      reorderMilli: storeItem.reorderMilli,
      balanceMilli: storeBalanceSql(ctx.companyId, sql`${storeItem.id}`, store.id),
    })
    .from(storeItem)
    .where(and(eq(storeItem.companyId, ctx.companyId), eq(storeItem.active, true), sql`${storeItem.minMilli} > 0`))
    .orderBy(asc(storeItem.name))
    .limit(500);
  const low = rows
    .map((r) => ({ ...r, balanceMilli: Number(r.balanceMilli) }))
    .filter((r) => belowMinimum(r.balanceMilli, r.minMilli));
  const open = new Map<string, { indentId: string; number: string; status: string }>();
  const ids = low.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const found = await ctx.db
      .select({ itemId: storeIndentLine.itemId, indentId: storeIndent.id, number: storeIndent.number, status: storeIndent.status })
      .from(storeIndentLine)
      .innerJoin(storeIndent, and(eq(storeIndent.id, storeIndentLine.indentId), eq(storeIndent.companyId, storeIndentLine.companyId)))
      .leftJoin(storePo, and(eq(storePo.id, storeIndent.poId), eq(storePo.companyId, storeIndent.companyId)))
      .where(
        and(
          eq(storeIndentLine.companyId, ctx.companyId),
          inArray(storeIndentLine.itemId, part),
          sql`(${storeIndent.status} in ('open', 'approved') or (${storeIndent.status} = 'ordered' and ${storePo.status} in ('draft', 'issued', 'part_received')))`,
        ),
      )
      .orderBy(asc(storeIndent.createdAt));
    for (const f of found) open.set(f.itemId, { indentId: f.indentId, number: f.number, status: f.status });
  }
  return {
    items: low.map((r) => ({
      itemId: r.id,
      name: r.name,
      unit: r.unit,
      balanceMilli: r.balanceMilli,
      minMilli: r.minMilli,
      askMilli: reorderQtyMilli({
        balanceMilli: r.balanceMilli,
        minMilli: r.minMilli,
        reorderMilli: r.reorderMilli,
        countable: (COUNTABLE_STORE_UNITS as readonly string[]).includes(r.unit),
      }),
      indent: open.get(r.id) ?? null,
    })),
  };
});
