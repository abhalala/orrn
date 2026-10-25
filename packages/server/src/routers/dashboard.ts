import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle, bundleGroup, bundleStatuses, type BundleStatus } from "@orrn/db/schema/inventory";
import { printLog, printerProfile } from "@orrn/db/schema/printing";
import { pressRun } from "@orrn/db/schema/press";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company, type CompanyRole } from "@orrn/db/schema/tenant";
import { readFloorSettings } from "@orrn/domain";

import { companyProcedure, router } from "../index";
import { mapInChunks, type OrrnDb } from "../lib/atomic";
import { now } from "../lib/clock";
import { productionDayWindow } from "../lib/dayWindow";
import { APPROVER_ROLES, can } from "../lib/permissions";
import { pressedToday as pressedTodayOf } from "../lib/pressReport";
import { pressAlertsToday } from "../lib/pressCollector";
import { todayTileKeys, type TodayTileKey } from "../lib/todayTiles";

const LIST_LIMIT = 10;

const num = (v: unknown) => Number(v ?? 0);

export const dashboardRouter = router({
  today: companyProcedure.query(async ({ ctx }) => {
    const companyId = ctx.companyId;

    // The company row plus the "Start here" facts in one statement (4 bound params).
    const [companyRow] = await ctx.db
      .select({
        settings: company.settings,
        modules: company.modules,
        hasDie: sql<number>`exists(select 1 from ${die} where ${die.companyId} = ${companyId} and ${die.deletedAt} is null)`,
        hasCustomer: sql<number>`exists(select 1 from ${customer} where ${customer.companyId} = ${companyId} and ${customer.deletedAt} is null)`,
        hasPrinter: sql<number>`exists(select 1 from ${printerProfile} where ${printerProfile.companyId} = ${companyId} and ${printerProfile.deletedAt} is null)`,
      })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1);
    const settings = companyRow?.settings ?? {};
    // One clock for the window and its date, the same one analytics.trends reads. The window is
    // the production day (FP-PF-05, C15/C16): shift 1's start to the next, or calendar midnight
    // when no shifts are saved. Read fresh each call, so a shift change applies from the next read.
    const nowMs = now().getTime();
    const day = productionDayWindow(settings, nowMs);
    const timezone = day.timezone;
    const start = new Date(day.startMs);
    const end = new Date(day.endMs);
    // FP-PF-15: viewers get the four KPIs only (kg packed, bundles, kg dispatched, in stock).
    const kpisOnly = ctx.role === "viewer";
    const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
    // Rate slices need both the plant switch and order.price (C23; platform spec §6 Today).
    const showValue = !kpisOnly && readFloorSettings(settings).priceOnSalesOrder && can(me, "order.price");

    const openDispatch = and(
      eq(dispatch.companyId, companyId),
      inArray(dispatch.status, ["draft", "reserved"]),
      isNull(dispatch.deletedAt),
    );

    const skip = <T,>(rows: T[]) => Promise.resolve(rows);
    const [packedRows, dispatchedRows, stockRows, openRows, sessionRows, failedRows, openCountRows, valueRows] = await Promise.all([
      ctx.db
        .select({ n: sql<number>`count(*)`, w: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
        .from(bundle)
        .where(
          and(
            eq(bundle.companyId, companyId),
            // RP11: a void bundle was never really packed; it stays out of every packed figure.
            ne(bundle.status, "void"),
            gte(bundle.createdAt, start),
            lt(bundle.createdAt, end),
          ),
        ),
      ctx.db
        .select({
          dispatches: sql<number>`count(distinct ${dispatch.id})`,
          w: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
        })
        .from(dispatch)
        .leftJoin(
          dispatchItem,
          and(eq(dispatchItem.dispatchId, dispatch.id), eq(dispatchItem.companyId, dispatch.companyId)),
        )
        .leftJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatch.companyId)))
        .where(
          and(
            eq(dispatch.companyId, companyId),
            eq(dispatch.status, "completed"),
            isNull(dispatch.deletedAt),
            gte(dispatch.completedAt, start),
            lt(dispatch.completedAt, end),
          ),
        ),
      ctx.db
        .select({
          status: bundle.status,
          n: sql<number>`count(*)`,
          w: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
        })
        .from(bundle)
        .where(eq(bundle.companyId, companyId))
        .groupBy(bundle.status),
      kpisOnly
        ? skip<{ id: string; code: string; status: string; customerName: string }>([])
        : ctx.db
        .select({
          id: dispatch.id,
          code: dispatch.code,
          status: dispatch.status,
          customerName: customer.name,
        })
        .from(dispatch)
        .innerJoin(customer, and(eq(customer.id, dispatch.customerId), eq(customer.companyId, dispatch.companyId)))
        .where(openDispatch)
        .orderBy(desc(dispatch.createdAt), desc(dispatch.id))
        .limit(LIST_LIMIT),
      kpisOnly
        ? skip<{ id: string; code: string; createdAt: Date; dieName: string | null; series: string; sectionCode: string }>([])
        : ctx.db
        .select({
          id: bundleGroup.id,
          code: bundleGroup.code,
          createdAt: bundleGroup.createdAt,
          dieName: die.name,
          series: die.series,
          sectionCode: die.sectionCode,
        })
        .from(bundleGroup)
        .innerJoin(die, and(eq(die.id, bundleGroup.dieId), eq(die.companyId, bundleGroup.companyId)))
        .where(
          and(
            eq(bundleGroup.companyId, companyId),
            gte(bundleGroup.createdAt, start),
            lt(bundleGroup.createdAt, end),
          ),
        )
        .orderBy(desc(bundleGroup.createdAt), desc(bundleGroup.id))
        .limit(LIST_LIMIT),
      kpisOnly
        ? skip<{ n: number }>([])
        : ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(printLog)
        .where(
          and(
            eq(printLog.companyId, companyId),
            eq(printLog.status, "failed"),
            gte(printLog.createdAt, start),
            lt(printLog.createdAt, end),
          ),
        ),
      // The open list is capped at LIST_LIMIT; the count is not.
      kpisOnly ? skip<{ n: number }>([]) : ctx.db.select({ n: sql<number>`count(*)` }).from(dispatch).where(openDispatch),
      // Value dispatched in the window at each line's rate (Rs/kg in paise; grams / 1000 * rate).
      showValue
        ? ctx.db
            .select({ paise: sql<number>`coalesce(sum(${bundle.weightG} * ${salesOrderLine.ratePaise} / 1000.0), 0)`, priced: sql<number>`count(${salesOrderLine.ratePaise})` })
            .from(dispatch)
            .innerJoin(dispatchItem, and(eq(dispatchItem.dispatchId, dispatch.id), eq(dispatchItem.companyId, dispatch.companyId)))
            .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatch.companyId)))
            .leftJoin(
              salesOrderLine,
              and(
                eq(salesOrderLine.id, sql`coalesce(${dispatchItem.salesOrderLineId}, ${bundle.salesOrderLineId})`),
                eq(salesOrderLine.companyId, dispatch.companyId),
              ),
            )
            .where(
              and(
                eq(dispatch.companyId, companyId),
                eq(dispatch.status, "completed"),
                isNull(dispatch.deletedAt),
                gte(dispatch.completedAt, start),
                lt(dispatch.completedAt, end),
              ),
            )
        : skip<{ paise: number; priced: number }>([]),
    ]);

    const stock = Object.fromEntries(bundleStatuses.map((s) => [s, { bundles: 0, weightG: 0 }])) as Record<
      BundleStatus,
      { bundles: number; weightG: number }
    >;
    const anyBundleEver = stockRows.some((r) => num(r.n) > 0);
    for (const r of stockRows) {
      // Viewers see "in stock" (available + reserved) only, not void or dispatched totals.
      if (kpisOnly && r.status !== "available" && r.status !== "reserved") continue;
      stock[r.status] = { bundles: num(r.n), weightG: num(r.w) };
    }

    // Per-row bundle count / weight for the (<= 10) listed dispatches and sessions.
    const dispatchIds = openRows.map((r) => r.id);
    const dispatchTotals = new Map<string, { bundles: number; weightG: number }>();
    if (dispatchIds.length > 0) {
      const rows = await mapInChunks(dispatchIds, (ids) =>
        ctx.db
          .select({
            dispatchId: dispatchItem.dispatchId,
            n: sql<number>`count(*)`,
            w: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          })
          .from(dispatchItem)
          .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)))
          .where(and(eq(dispatchItem.companyId, companyId), inArray(dispatchItem.dispatchId, ids)))
          .groupBy(dispatchItem.dispatchId),
      );
      for (const r of rows) dispatchTotals.set(r.dispatchId, { bundles: num(r.n), weightG: num(r.w) });
    }

    const groupIds = sessionRows.map((r) => r.id);
    const groupTotals = new Map<string, { bundles: number; weightG: number }>();
    if (groupIds.length > 0) {
      const rows = await mapInChunks(groupIds, (ids) =>
        ctx.db
          .select({
            groupId: bundle.groupId,
            n: sql<number>`count(*)`,
            w: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          })
          .from(bundle)
          .where(and(eq(bundle.companyId, companyId), ne(bundle.status, "void"), inArray(bundle.groupId, ids)))
          .groupBy(bundle.groupId),
      );
      for (const r of rows) groupTotals.set(r.groupId, { bundles: num(r.n), weightG: num(r.w) });
    }

    // FP-PR-18: the press tile (logged runs of this production day; downtime of the day's rows).
    const pressedToday = kpisOnly ? null : await pressedTodayOf(ctx.db, companyId, day.productionDay, nowMs);
    // W4-COLLECTORS (FP-PR-22): press alerts from a collector; null when none (no collector, no chip).
    const pressAlerts = kpisOnly ? null : await pressAlertsToday(ctx.db, companyId, day.startMs);

    // FP-PF-15 role tiles (explorer W1 H6): each role's station shortcuts with the count it acts on.
    const tileKeys = kpisOnly ? [] : todayTileKeys(ctx.role, companyRow?.modules);
    const tiles = await roleTiles(ctx, tileKeys, num(openCountRows[0]?.n));

    const none = { bundles: 0, weightG: 0 };
    const packedToday = { bundles: num(packedRows[0]?.n), weightG: num(packedRows[0]?.w) };
    const dispatchedToday = { dispatches: num(dispatchedRows[0]?.dispatches), weightG: num(dispatchedRows[0]?.w) };
    return {
      timezone,
      /** The production day these figures cover (YYYY-MM-DD); the calendar day with no shifts. */
      date: day.productionDay,
      /** "full" or "kpis" (viewer: the four KPIs only; lists come back empty). */
      scope: kpisOnly ? ("kpis" as const) : ("full" as const),
      /** Caption data: the window, whether shifts are saved, and the shift now. */
      productionDay: {
        day: day.productionDay,
        startMs: day.startMs,
        endMs: day.endMs,
        shiftsSet: day.shiftsSet,
        shift: day.shift,
      },
      /**
       * The four KPIs every role sees (FP-PF-15). In stock = available bundles only, the same
       * figure the Stock screen shows as "In stock" (`bundle.stockSummary`, status available):
       * held (reserved), dispatched and void bundles are not counted.
       */
      kpis: {
        packedG: packedToday.weightG,
        packedBundles: packedToday.bundles,
        dispatchedG: dispatchedToday.weightG,
        inStockG: stock.available.weightG,
        inStockBundles: stock.available.bundles,
      },
      /** Rate slice: only with priceOnSalesOrder on and order.price held; null otherwise. */
      value: showValue
        ? { dispatchedPaise: Math.round(num(valueRows[0]?.paise)), pricedBundles: num(valueRows[0]?.priced) }
        : null,
      packedToday,
      dispatchedToday,
      stock,
      openDispatchCount: num(openCountRows[0]?.n),
      openDispatches: openRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status as "draft" | "reserved",
        customerName: r.customerName,
        ...(dispatchTotals.get(r.id) ?? none),
      })),
      recentSessions: sessionRows.map((r) => ({
        id: r.id,
        code: r.code,
        dieLabel: r.dieName?.trim() ? r.dieName : `${r.series} ${r.sectionCode}`,
        ...(groupTotals.get(r.id) ?? none),
        createdAt: r.createdAt.toISOString(),
      })),
      failedPrintJobs: num(failedRows[0]?.n),
      /**
       * The role's tiles in plant-flow order (`lib/todayTiles.ts`), each with the count it acts
       * on: orders open, runs waiting for a die (die room), runs queued or with their die (press),
       * open dispatches, approvals waiting (an approver: requests this role decides, not its own;
       * anyone else: its own requests still waiting). Empty for viewers (four KPIs only).
       */
      tiles,
      /** FP-PR-18 `{ kgG, recoveryBp, downtimeMin, byLine[] }` (+ runs, late share); null for viewers. */
      pressedToday,
      /** `{ open, today, simulated }` press alerts (FP-PR-22) for the Today chip; null when none / viewer. */
      pressAlerts,
      /**
       * First steps for an empty plant (Today's "Start here"): a live die, a live customer, any
       * bundle ever packed (void included: the step was done) and a live label printer.
       */
      setup: {
        dies: num(companyRow?.hasDie) > 0,
        customers: num(companyRow?.hasCustomer) > 0,
        bundles: anyBundleEver,
        printers: num(companyRow?.hasPrinter) > 0,
      },
    };
  }),
});

type TileCtx = { db: OrrnDb; companyId: string; role: CompanyRole; session: { user: { id: string } } };

/** One tile of Today: its key and the count shown under its title (null = no count). */
export type TodayTileOut = { key: TodayTileKey; count: number | null };

async function roleTiles(ctx: TileCtx, keys: readonly TodayTileKey[], openDispatches: number): Promise<TodayTileOut[]> {
  if (keys.length === 0) return [];
  const has = (k: TodayTileKey) => keys.includes(k);
  const companyId = ctx.companyId;
  const zero = Promise.resolve([{ n: 0 }]);
  const approverKinds = (Object.keys(APPROVER_ROLES) as (keyof typeof APPROVER_ROLES)[]).filter((k) => APPROVER_ROLES[k].includes(ctx.role));
  const [orders, toIssue, pressQueue, approvals] = await Promise.all([
    has("orders")
      ? ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(salesOrder)
          .where(and(eq(salesOrder.companyId, companyId), inArray(salesOrder.status, ["booking", "confirmed", "dispatching"])))
      : zero,
    has("dieRoom")
      ? ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(pressRun)
          .where(and(eq(pressRun.companyId, companyId), eq(pressRun.status, "queued"), isNull(pressRun.dieInstanceId)))
      : zero,
    has("press")
      ? ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(pressRun)
          .where(and(eq(pressRun.companyId, companyId), inArray(pressRun.status, ["queued", "die_issued"])))
      : zero,
    has("approvals")
      ? ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(approval)
          .where(
            and(
              eq(approval.companyId, companyId),
              eq(approval.status, "pending"),
              approverKinds.length > 0
                ? and(inArray(approval.kind, approverKinds), sql`coalesce(${approval.requestedBy}, '') <> ${ctx.session.user.id}`)
                : eq(approval.requestedBy, ctx.session.user.id),
            ),
          )
      : zero,
  ]);
  const counts: Partial<Record<TodayTileKey, number>> = {
    orders: num(orders[0]?.n),
    dieRoom: num(toIssue[0]?.n),
    press: num(pressQueue[0]?.n),
    approvals: num(approvals[0]?.n),
    dispatch: openDispatches,
  };
  return keys.map((key) => ({ key, count: counts[key] ?? null }));
}
