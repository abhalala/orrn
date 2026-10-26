/**
 * The four office reports (W4-ANALYTICS), mounted on the `analytics` router:
 *
 * - `analytics.recovery`  recovery by die (section) / copy / press line / shift over production days,
 *                         production runs only (`/reports/production`, with `press.report`).
 * - `analytics.dieLife`   life_g against Σ good kg of each copy's logged runs (`/reports/die-life`,
 *                         the die card's Runs tab header).
 * - `analytics.stockAge`  available bundles by age 0-7 / 8-30 / 31-90 / over 90 days, per party and
 *                         plant stock (`/reports/stock-age`, Today's "older than 90 days" tile).
 * - `analytics.orders`    the order book summed by party or by order month, from the order book's
 *                         own SQL (`/reports/orders`); rupee columns only for `order.price` holders
 *                         while `priceOnSalesOrder` is on, and asking without both is refused.
 *
 * Guard: `reports.read` (supervisor, office, manager, admin, accountant, viewer; owner holds all).
 * `dieLife` also answers the die room (die.card / die.reading) for the card. Floor roles without
 * these keys get FORBIDDEN. Reads only; nothing here writes.
 */
import { bpPercent1 } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { can } from "../lib/permissions";
import { actionProcedure, anyActionProcedure } from "../index";
import { now } from "../lib/clock";
import { BOOK_SUMMARY_GROUPS, bookSummary, bookTotals } from "../lib/orderBook";
import { companyFloor } from "../lib/orderLines";
import { dieLife, RECOVERY_GROUPS, recoverySummary, stockAge } from "../lib/reportsAnalytics";
import { bookFilterOf, bookInput } from "./salesOrder";
import { foundryYieldProcedure } from "./foundryTrace";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Day as YYYY-MM-DD");

const reportsProcedure = actionProcedure("reports.read");

export const analyticsReportProcedures = {
  /** W2-FD-S (FP-FD-19): foundry yield by production day, alloy or furnace. */
  foundryYield: foundryYieldProcedure,
  /** Recovery per die / copy / press / shift: Σ good ÷ Σ input of logged production runs. */
  recovery: reportsProcedure
    .input(
      z.object({
        from: day,
        to: day,
        groupBy: z.enum(RECOVERY_GROUPS).default("die"),
        shiftSeq: z.number().int().min(1).max(4).optional(),
        pressLineId: id.optional(),
        planId: id.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.to < input.from) throw new TRPCError({ code: "BAD_REQUEST", message: "The period must end after it starts" });
      return recoverySummary(ctx.db, ctx.companyId, input);
    }),

  /** Die life per copy, highest share used first (`withLife` keeps copies with a life set). */
  dieLife: anyActionProcedure("reports.read", "die.card", "die.reading")
    .input(
      z
        .object({
          dieInstanceId: id.optional(),
          sectionId: id.optional(),
          includeRetired: z.boolean().default(false),
          withLife: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .default({ includeRetired: false, withLife: false, limit: 100, offset: 0 }),
    )
    .query(({ ctx, input }) => dieLife(ctx.db, ctx.companyId, input)),

  /** Stock age of the yard: available bundles only, per party and plant stock. */
  stockAge: reportsProcedure
    .input(z.object({ customerId: id.optional(), plantOnly: z.boolean().optional() }).default({}))
    .query(({ ctx, input }) => stockAge(ctx.db, ctx.companyId, now().getTime(), input)),

  /**
   * The order book by party or by order month: orders, ordered, dispatched, baki, late. `totals` is
   * `orders.bookTotals` for the same filter (one SQL text, so rows add up to it). `withRates` adds
   * the rupee columns and is refused (FORBIDDEN) unless the caller holds `order.price` and the plant
   * has `priceOnSalesOrder` on; without it the answer has no rupee field at all.
   */
  orders: reportsProcedure
    .input(
      bookInput.extend({
        groupBy: z.enum(BOOK_SUMMARY_GROUPS).default("customer"),
        withRates: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { groupBy, withRates, ...book } = input;
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const ratesAllowed = can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.price") && floor.floor.priceOnSalesOrder;
      if (withRates && !ratesAllowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Rates are not shown to you" });
      }
      const { filter, today } = await bookFilterOf(ctx.db, ctx.companyId, book);
      const [{ rows, truncated }, totals] = await Promise.all([
        bookSummary(ctx.db, ctx.companyId, filter, groupBy, { rates: withRates }),
        bookTotals(ctx.db, ctx.companyId, filter),
      ]);
      const rateTotals = withRates
        ? rows.reduce(
            (s, r) => ({
              orderedValuePaise: s.orderedValuePaise + (r.rates?.orderedValuePaise ?? 0),
              dispatchedValuePaise: s.dispatchedValuePaise + (r.rates?.dispatchedValuePaise ?? 0),
              bakiValuePaise: s.bakiValuePaise + (r.rates?.bakiValuePaise ?? 0),
              rateMissingLines: s.rateMissingLines + (r.rates?.rateMissingLines ?? 0),
            }),
            { orderedValuePaise: 0, dispatchedValuePaise: 0, bakiValuePaise: 0, rateMissingLines: 0 },
          )
        : null;
      // The table's foot: the rows summed here. Dispatched is counted up to ordered per line, as the
      // strip does, so the foot's ordered - dispatched = baki and it equals `totals`.
      const sum = rows.reduce(
        (s, r) => ({
          orders: s.orders + r.orders,
          openOrders: s.openOrders + r.openOrders,
          lateOrders: s.lateOrders + r.lateOrders,
          lines: s.lines + r.lines,
          orderedG: s.orderedG + r.orderedG,
          dispatchedG: s.dispatchedG + r.dispatchedG,
          bakiG: s.bakiG + r.bakiG,
          excessG: s.excessG + r.excessG,
        }),
        { orders: 0, openOrders: 0, lateOrders: 0, lines: 0, orderedG: 0, dispatchedG: 0, bakiG: 0, excessG: 0 },
      );
      // More than BOOK_SUMMARY_LIMIT groups: the rows are a head, so the foot is the whole filter's strip.
      const foot = truncated
        ? { ...sum, orders: totals.orders, openOrders: totals.openOrders, lateOrders: totals.lateOrders, lines: totals.lines, orderedG: totals.orderedG, dispatchedG: totals.dispatchedG, bakiG: totals.bakiG }
        : sum;
      return { groupBy, today, rows, truncated, sum: { ...foot, dispatchedBp: totals.dispatchedBp, dispatchedPct: bpPercent1(totals.dispatchedBp) }, totals, rateTotals, ratesAllowed };
    }),
};
