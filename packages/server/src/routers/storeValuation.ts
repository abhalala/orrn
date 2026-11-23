/**
 * XE store (rows 71 to 73), nested under `store`:
 * - `store.valuation.items`: what each item holds now, its value and average rate (store.value);
 * - `store.valuation.month`: the month-end stock value per item, opening / in / out / closing on the
 *   plant's calendar month (store.value);
 * - `store.settings`: the over-receipt tolerance on PO lines (read by store and PO people, set by
 *   masters.publish holders);
 * - `store.belowMinimum`: items under their minimum, with any indent already raised for them (Today).
 *
 * Every figure is a sum of the money frozen on the entries (`lib/storeValue.ts`); nothing is revalued.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { company } from "@orrn/db/schema/tenant";
import { COUNTABLE_STORE_UNITS, storeItem, storeTxn } from "@orrn/db/schema/store";
import { storeIndent, storeIndentLine, storePo } from "@orrn/db/schema/storeBuy";
import {
  averageRatePaise,
  belowMinimum,
  heldValueShown,
  MAX_PO_OVER_RECEIPT_BP,
  reorderQtyMilli,
} from "@orrn/domain";

import { anyActionProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { settingsPatchSql } from "../lib/companySettings";
import { companyTimezone, zonedMidnightMs } from "../lib/dayWindow";
import { resolveStoreLocation, storeBalanceSql } from "../lib/store";
import { PO_TOLERANCE_KEY, readPoTolerance } from "../lib/storeBuy";
import { storeHeldQtySql, storeHeldValueSql } from "../lib/storeValue";

const valueReader = anyActionProcedure("store.value");
const settingsReader = anyActionProcedure("store.txn", "masters.publish", "po.view", "po.manage", "store.value");
const settingsWriter = anyActionProcedure("masters.publish");
const lowReader = anyActionProcedure("store.txn", "masters.publish");

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const storeValuationRouter = router({
  /** Per item: held quantity, held value, average rate, and how much of what came in had no rate. */
  items: valueReader.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: storeItem.id,
        name: storeItem.name,
        unit: storeItem.unit,
        category: storeItem.category,
        active: storeItem.active,
        heldMilli: storeHeldQtySql(ctx.companyId, sql`${storeItem.id}`),
        heldPaise: storeHeldValueSql(ctx.companyId, sql`${storeItem.id}`),
        /** Live GRNs with no rate (not an exchange's new leg, which carries the old leg's value). */
        unratedMilli: sql<number>`coalesce((
          select sum(u.qty_milli) from ${storeTxn} u
          where u.company_id = ${ctx.companyId} and u.item_id = ${sql`${storeItem.id}`} and u.kind = 'grn'
            and u.cancelled_at is null and u.rate_paise is null and u.exchange_id is null
        ), 0)`,
      })
      .from(storeItem)
      .where(eq(storeItem.companyId, ctx.companyId))
      .orderBy(asc(storeItem.name))
      .limit(1000);
    const items = rows
      .map((r) => {
        const heldMilli = Number(r.heldMilli);
        const raw = Number(r.heldPaise);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          active: r.active,
          heldMilli,
          valuePaise: heldValueShown(heldMilli, raw),
          avgRatePaise: averageRatePaise(heldMilli, raw),
          noRate: Number(r.unratedMilli) > 0,
        };
      })
      .filter((r) => r.active || r.heldMilli !== 0);
    return { items, totalPaise: items.reduce((s, r) => s + r.valuePaise, 0) };
  }),

  /**
   * Month-end stock value for `month` (`YYYY-MM`) on the plant's calendar: per item, held at the start,
   * received (GRNs, less GRNs cancelled in the month), issued (MRSs, less MRSs cancelled in the month)
   * and held at the end, in quantity and money. Same rules as `monthValuation` in @orrn/domain.
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
    const rows = await ctx.db.all<{
      item_id: string;
      open_q: number; open_v: number; in_q: number; in_v: number; out_q: number; out_v: number;
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
          - sum(case when t.kind = 'mrs' and t.cancelled_at is not null and ${within("cancelled_at")} then t.value_paise else 0 end) as out_v
      from ${storeTxn} t
      where t.company_id = ${ctx.companyId} and t.created_at < ${to}
      group by t.item_id
    `);
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
        const openingMilli = Number(r.open_q);
        const openingPaise = Number(r.open_v);
        const inMilli = Number(r.in_q);
        const inPaise = Number(r.in_v);
        const outMilli = Number(r.out_q);
        const outPaise = Number(r.out_v);
        const closingMilli = openingMilli + inMilli - outMilli;
        const closingRaw = openingPaise + inPaise - outPaise;
        return {
          itemId: r.item_id,
          name: n?.name ?? "",
          unit: n?.unit ?? "kg",
          category: n?.category ?? "other",
          openingMilli,
          openingPaise: heldValueShown(openingMilli, openingPaise),
          inMilli,
          inPaise,
          outMilli,
          outPaise,
          closingMilli,
          closingPaise: heldValueShown(closingMilli, closingRaw),
        };
      })
      .filter((r) => r.openingMilli !== 0 || r.inMilli !== 0 || r.outMilli !== 0 || r.closingMilli !== 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    const sum = (k: "openingPaise" | "inPaise" | "outPaise" | "closingPaise") => items.reduce((s, r) => s + r[k], 0);
    return {
      month: input.month,
      from,
      to,
      items,
      totals: { openingPaise: sum("openingPaise"), inPaise: sum("inPaise"), outPaise: sum("outPaise"), closingPaise: sum("closingPaise") },
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
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
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
