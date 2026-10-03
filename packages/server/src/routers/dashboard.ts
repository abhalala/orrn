import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle, bundleGroup, bundleStatuses, type BundleStatus } from "@orrn/db/schema/inventory";
import { printLog, printerProfile } from "@orrn/db/schema/printing";
import { company } from "@orrn/db/schema/tenant";

import { companyProcedure, router } from "../index";
import { mapInChunks } from "../lib/atomic";
import { DEFAULT_TIMEZONE, dayWindow } from "../lib/dayWindow";

const LIST_LIMIT = 10;

const num = (v: unknown) => Number(v ?? 0);

export const dashboardRouter = router({
  today: companyProcedure.query(async ({ ctx }) => {
    const companyId = ctx.companyId;

    // The company row plus the "Start here" facts in one statement (4 bound params).
    const [companyRow] = await ctx.db
      .select({
        settings: company.settings,
        hasDie: sql<number>`exists(select 1 from ${die} where ${die.companyId} = ${companyId} and ${die.deletedAt} is null)`,
        hasCustomer: sql<number>`exists(select 1 from ${customer} where ${customer.companyId} = ${companyId} and ${customer.deletedAt} is null)`,
        hasPrinter: sql<number>`exists(select 1 from ${printerProfile} where ${printerProfile.companyId} = ${companyId} and ${printerProfile.deletedAt} is null)`,
      })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1);
    const configured = (companyRow?.settings ?? {}).timezone;
    const timezone = typeof configured === "string" && configured ? configured : DEFAULT_TIMEZONE;
    const { startMs, endMs } = dayWindow(timezone);
    const start = new Date(startMs);
    const end = new Date(endMs);

    const openDispatch = and(
      eq(dispatch.companyId, companyId),
      inArray(dispatch.status, ["draft", "reserved"]),
      isNull(dispatch.deletedAt),
    );

    const [packedRows, dispatchedRows, stockRows, openRows, sessionRows, failedRows, openCountRows] = await Promise.all([
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
      ctx.db
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
      ctx.db
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
      ctx.db
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
      ctx.db.select({ n: sql<number>`count(*)` }).from(dispatch).where(openDispatch),
    ]);

    const stock = Object.fromEntries(bundleStatuses.map((s) => [s, { bundles: 0, weightG: 0 }])) as Record<
      BundleStatus,
      { bundles: number; weightG: number }
    >;
    for (const r of stockRows) stock[r.status] = { bundles: num(r.n), weightG: num(r.w) };

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

    const none = { bundles: 0, weightG: 0 };
    return {
      timezone,
      packedToday: { bundles: num(packedRows[0]?.n), weightG: num(packedRows[0]?.w) },
      dispatchedToday: { dispatches: num(dispatchedRows[0]?.dispatches), weightG: num(dispatchedRows[0]?.w) },
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
       * First steps for an empty plant (Today's "Start here"): a live die, a live customer, any
       * bundle ever packed (void included: the step was done) and a live label printer.
       */
      setup: {
        dies: num(companyRow?.hasDie) > 0,
        customers: num(companyRow?.hasCustomer) > 0,
        bundles: bundleStatuses.some((s) => stock[s].bundles > 0),
        printers: num(companyRow?.hasPrinter) > 0,
      },
    };
  }),
});
