import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { packingList, packingListLine } from "@orrn/db/schema/packing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";

import type { BatchItem } from "drizzle-orm/batch";

import type { Context } from "../context";
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type OrrnDb } from "../lib/atomic";
import { now as clockNow } from "../lib/clock";
import { companyTimezone, zonedYmd } from "../lib/dayWindow";
import { nextDocNumber } from "../lib/docNumber";
import { buildPlSnapshotV2, type PlBuildInput, type PlSnapshotV2 } from "../lib/packingListSnapshot";
import { nextCompanySeq } from "../lib/sequence";
import { actionProcedure, companyProcedure, router } from "../index";

/** The dispatch fields a packing list snapshot reads (a full `dispatch` row satisfies it). */
export type DispatchRowForPL = {
  id: string;
  code: string;
  customerId: string;
  shipDate: Date | null;
  notes: string | null;
  status: string;
  completedAt: Date | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Read everything a v2 snapshot needs (company letterhead, customer, items with their section and
 * order line), every join scoped by company. Reads only; the caller writes in its own batch.
 */
export async function loadPlInput(
  db: OrrnDb,
  companyId: string,
  dispatchRow: DispatchRowForPL,
  opts: { plNumber: string; actorId: string; at: Date },
): Promise<PlBuildInput> {
  const [[co], [cust], items] = await Promise.all([
    db.select({ id: company.id, name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
    db
      .select({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        billingAddress: customer.billingAddress,
        shippingAddress: customer.shippingAddress,
        taxId: customer.taxId,
      })
      .from(customer)
      .where(and(eq(customer.id, dispatchRow.customerId), eq(customer.companyId, companyId)))
      .limit(1),
    db
      .select({
        bundleId: bundle.id,
        serial: bundle.serial,
        quantity: bundle.quantity,
        weightG: bundle.weightG,
        lengthMm: bundle.lengthMm,
        kgPer12ftMilli: bundle.kgPer12ftMilli,
        bundlePo: bundle.poNumber,
        bundleGroupId: bundle.groupId,
        groupLabel: dispatchItem.groupLabel,
        dieId: die.id,
        series: die.series,
        sectionCode: die.sectionCode,
        sectionName: die.name,
        lineId: salesOrderLine.id,
        lineNo: salesOrderLine.lineNo,
        finish: salesOrderLine.finish,
        orderNumber: salesOrder.number,
        orderPeriod: salesOrder.period,
        orderPo: salesOrder.poNumber,
      })
      .from(dispatchItem)
      .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
      .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, companyId)))
      .leftJoin(
        salesOrderLine,
        and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, companyId)),
      )
      .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
      .where(and(eq(dispatchItem.dispatchId, dispatchRow.id), eq(dispatchItem.companyId, companyId))),
  ]);

  const tz = companyTimezone(co?.settings);
  const dateMs = (dispatchRow.completedAt ?? opts.at).getTime();
  const d = zonedYmd(tz, dateMs);
  return {
    plNumber: opts.plNumber,
    date: `${d.year}-${pad2(d.month)}-${pad2(d.day)}`,
    generatedAt: opts.at,
    generatedBy: opts.actorId,
    company: { id: co?.id ?? companyId, name: co?.name ?? "", settings: co?.settings ?? null },
    dispatch: {
      code: dispatchRow.code,
      status: dispatchRow.status,
      shipDate: dispatchRow.shipDate,
      notes: dispatchRow.notes,
      completedAt: dispatchRow.completedAt,
      vehicleNo: dispatchRow.vehicleNo,
      driverName: dispatchRow.driverName,
      driverPhone: dispatchRow.driverPhone,
      transporter: dispatchRow.transporter,
      invoiceNumber: dispatchRow.invoiceNumber,
      invoiceDate: dispatchRow.invoiceDate,
    },
    customer: cust ?? null,
    items: items.map((i) => ({
      bundleId: i.bundleId,
      serial: i.serial,
      quantity: Number(i.quantity),
      weightG: Number(i.weightG),
      lengthMm: Number(i.lengthMm),
      kgPer12ftMilli: i.kgPer12ftMilli == null ? null : Number(i.kgPer12ftMilli),
      bundlePo: i.bundlePo,
      bundleGroupId: i.bundleGroupId,
      groupLabel: i.groupLabel,
      dieId: i.dieId,
      series: i.series,
      sectionCode: i.sectionCode,
      sectionName: i.sectionName,
      line:
        i.lineId && i.orderNumber
          ? { id: i.lineId, orderNumber: i.orderNumber, orderPeriod: i.orderPeriod, lineNo: Number(i.lineNo), finish: i.finish, poNumber: i.orderPo }
          : null,
    })),
  };
}

type PackingListWriteOpts = {
  companyId: string;
  dispatchRow: DispatchRowForPL;
  /** The PL book number (dispatch.pl_number); it is also the packing list's code. */
  plNumber: string;
  session: NonNullable<Context["session"]>;
  impersonation?: Context["impersonation"];
  plId?: string;
  auditAction?: "packingList.create" | "packingList.regenerate";
  auditMeta?: Record<string, unknown>;
};

/** Build D1 batch statements for a new packing list (reads use `db` first). */
export async function packingListWriteBatch(
  db: OrrnDb,
  opts: PackingListWriteOpts,
): Promise<{ plId: string; code: string; snapshot: PlSnapshotV2; statements: BatchItem<"sqlite">[] }> {
  const plId = opts.plId ?? crypto.randomUUID();
  const seq = await nextCompanySeq({ db }, opts.companyId);
  const input = await loadPlInput(db, opts.companyId, opts.dispatchRow, {
    plNumber: opts.plNumber,
    actorId: opts.session.user.id,
    at: clockNow(),
  });
  const snapshot = buildPlSnapshotV2(input);
  const code = opts.plNumber;

  const statements: BatchItem<"sqlite">[] = [
    db.insert(packingList).values({
      id: plId,
      companyId: opts.companyId,
      serverSeq: seq,
      dispatchId: opts.dispatchRow.id,
      code,
      snapshot: snapshot as unknown as Record<string, unknown>,
      createdBy: opts.session.user.id,
    }),
  ];

  // One line per bundle, in printed order; group label = the order line / section group.
  const bySerial = new Map(input.items.map((i) => [i.serial, i]));
  const lineValues = snapshot.groups.flatMap((g) =>
    g.rows.map((r) => {
      const item = bySerial.get(r.bundleNo)!;
      return {
        id: crypto.randomUUID(),
        companyId: opts.companyId,
        packingListId: plId,
        bundleId: item.bundleId,
        dieId: item.dieId,
        quantity: item.quantity,
        weightG: item.weightG,
        lengthMm: item.lengthMm,
        groupLabel: g.orderNumber ? `${g.orderNumber}/${g.lineNo}` : g.sectionCode,
      };
    }),
  );
  pushChunkedInserts(statements, (rows) => db.insert(packingListLine).values(rows), lineValues);

  statements.push(
    auditInsert(
      { db, companyId: opts.companyId, session: opts.session, impersonation: opts.impersonation },
      {
        action: opts.auditAction ?? "packingList.create",
        subjectType: "packing_list",
        subjectId: plId,
        meta: opts.auditMeta ?? {
          dispatchId: opts.dispatchRow.id,
          code,
          bundleCount: lineValues.length,
        },
      },
    ),
  );

  return { plId, code, snapshot, statements };
}

/** Auto-create packing list during dispatch.complete (append to a larger atomic batch). */
export async function appendPackingListWrites(
  db: OrrnDb,
  opts: PackingListWriteOpts,
): Promise<{ plId: string; statements: BatchItem<"sqlite">[] }> {
  const { plId, statements } = await packingListWriteBatch(db, opts);
  return { plId, statements };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const packingListRouter = router({
  /**
   * Manually generate a packing list for a completed dispatch that has none (auto-creation runs
   * inside dispatch.complete). Uses the dispatch's PL number; a dispatch completed before PL
   * numbers existed gets its number now, once.
   */
  create: actionProcedure("dispatch.complete")
    .input(z.object({ dispatchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dispatchRow = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.dispatchId),
          eq(dispatch.companyId, ctx.companyId),
          eq(dispatch.status, "completed"),
          isNull(dispatch.deletedAt),
        ),
      });

      if (!dispatchRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Completed dispatch not found",
        });
      }

      const existing = await ctx.db.query.packingList.findFirst({
        where: and(eq(packingList.dispatchId, input.dispatchId), eq(packingList.companyId, ctx.companyId)),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Packing list already exists for this dispatch",
        });
      }

      const plNumber =
        dispatchRow.plNumber ??
        (await nextDocNumber(ctx.db, ctx.companyId, "pl", dispatchRow.completedAt ?? clockNow(), ctx.session.user.id)).number;
      const { plId, statements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow,
        plNumber,
        session: ctx.session,
        impersonation: ctx.impersonation,
      });
      if (!dispatchRow.plNumber) {
        statements.unshift(
          ctx.db
            .update(dispatch)
            .set({ plNumber })
            .where(and(eq(dispatch.id, dispatchRow.id), eq(dispatch.companyId, ctx.companyId), isNull(dispatch.plNumber))),
        );
      }
      await atomicBatch(ctx.db, statements);

      const pl = await ctx.db.query.packingList.findFirst({
        where: and(eq(packingList.id, plId), eq(packingList.companyId, ctx.companyId)),
      });
      if (!pl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create packing list" });
      }

      return pl;
    }),

  get: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pl = await ctx.db.query.packingList.findFirst({
        where: and(
          eq(packingList.id, input.id),
          eq(packingList.companyId, ctx.companyId),
        ),
      });

      if (!pl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Packing list not found" });
      }

      // snapshot is already an object — Drizzle deserialises mode:"json" columns
      return pl;
    }),

  byDispatch: companyProcedure
    .input(z.object({ dispatchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pl = await ctx.db.query.packingList.findFirst({
        where: and(
          eq(packingList.dispatchId, input.dispatchId),
          eq(packingList.companyId, ctx.companyId),
        ),
      });
      // Returns null when none exists yet — callers must handle
      return pl ?? null;
    }),

  list: companyProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = eq(packingList.companyId, ctx.companyId);

      const items = await ctx.db
        .select({
          id: packingList.id,
          code: packingList.code,
          dispatchId: packingList.dispatchId,
          serverSeq: packingList.serverSeq,
          createdAt: packingList.createdAt,
          createdBy: packingList.createdBy,
        })
        .from(packingList)
        .where(where)
        .orderBy(desc(packingList.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countRow] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(packingList)
        .where(where);

      return { items, total: countRow?.count ?? 0 };
    }),

  /**
   * Regenerate: rebuild the snapshot from live data (header corrections, a v1 snapshot brought to
   * v2). The PL number never changes: it is the dispatch's `pl_number` (or the old code for a
   * dispatch completed before PL numbers existed).
   */
  regenerate: actionProcedure("packingList.regenerate")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.packingList.findFirst({
        where: and(
          eq(packingList.id, input.id),
          eq(packingList.companyId, ctx.companyId),
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Packing list not found" });
      }

      const dispatchRow = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, existing.dispatchId),
          eq(dispatch.companyId, ctx.companyId),
          eq(dispatch.status, "completed"),
          isNull(dispatch.deletedAt),
        ),
      });

      if (!dispatchRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Associated dispatch not found or not completed",
        });
      }

      const newPlId = crypto.randomUUID();
      const { statements: createStatements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow,
        plNumber: dispatchRow.plNumber ?? existing.code,
        session: ctx.session,
        impersonation: ctx.impersonation,
        plId: newPlId,
        auditAction: "packingList.regenerate",
        auditMeta: {
          dispatchId: dispatchRow.id,
          previousId: existing.id,
          code: dispatchRow.plNumber ?? existing.code,
        },
      });

      await atomicBatch(ctx.db, [
        ctx.db
          .delete(packingListLine)
          .where(and(eq(packingListLine.packingListId, existing.id), eq(packingListLine.companyId, ctx.companyId))),
        ctx.db.delete(packingList).where(and(eq(packingList.id, existing.id), eq(packingList.companyId, ctx.companyId))),
        ...createStatements,
      ]);

      const pl = await ctx.db.query.packingList.findFirst({
        where: and(eq(packingList.id, newPlId), eq(packingList.companyId, ctx.companyId)),
      });
      if (!pl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to regenerate packing list" });
      }

      return pl;
    }),
});
