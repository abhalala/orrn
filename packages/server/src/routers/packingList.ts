import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { packingList, packingListDispatch, packingListLine } from "@orrn/db/schema/packing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";

import type { BatchItem } from "drizzle-orm/batch";

import type { Context } from "../context";
import { auditInsert } from "../lib/audit";
import { diffPackingListRevisions, type PlDiffRow } from "@orrn/domain";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb } from "../lib/atomic";
import { batchAbortUnless, isBatchAbort } from "../lib/orders";
import { errorText, salesOrderLineCode } from "../lib/pack";
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
  transporterName?: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Distinct non-empty values joined for a combined header ("GJ05AB1234, GJ05CD5678"). */
function joined(values: readonly (string | null | undefined)[]): string | null {
  const out = [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))];
  return out.length ? out.join(", ") : null;
}

/**
 * Read everything a v2 snapshot needs (company letterhead, customer, items with their section and
 * order line), every join scoped by company. Reads only; the caller writes in its own batch.
 * A combined list passes every dispatch (`extra`), all of one customer; the header joins their
 * vehicles, drivers and transporters and dates at the latest completion.
 */
export async function loadPlInput(
  db: OrrnDb,
  companyId: string,
  dispatchRow: DispatchRowForPL,
  opts: { plNumber: string; actorId: string; at: Date; extra?: readonly DispatchRowForPL[] },
): Promise<PlBuildInput> {
  const all = [dispatchRow, ...(opts.extra ?? [])];
  const dispatchIds = all.map((d) => d.id);
  const packedLine = alias(salesOrderLine, "packed_line");
  const packedOrder = alias(salesOrder, "packed_order");
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
    mapInChunks(dispatchIds, (ids) =>
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
          partyNo: bundle.partyNo,
          groupLabel: dispatchItem.groupLabel,
          dieId: die.id,
          series: die.series,
          sectionCode: die.sectionCode,
          sectionName: die.name,
          profileKind: die.profileKind,
          lineId: salesOrderLine.id,
          lineNo: salesOrderLine.lineNo,
          finish: salesOrderLine.finish,
          orderNumber: salesOrder.number,
          orderPeriod: salesOrder.period,
          orderPo: salesOrder.poNumber,
          packedLineNo: packedLine.lineNo,
          packedOrderNumber: packedOrder.number,
        })
        .from(dispatchItem)
        .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, companyId)))
        .leftJoin(
          salesOrderLine,
          and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, companyId)),
        )
        .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
        .leftJoin(packedLine, and(eq(packedLine.id, bundle.packedSalesOrderLineId), eq(packedLine.companyId, companyId)))
        .leftJoin(packedOrder, and(eq(packedOrder.id, packedLine.salesOrderId), eq(packedOrder.companyId, companyId)))
        .where(and(inArray(dispatchItem.dispatchId, ids), eq(dispatchItem.companyId, companyId))),
    ),
  ]);

  const tz = companyTimezone(co?.settings);
  const completed = all.map((d) => d.completedAt?.getTime() ?? 0);
  const dateMs = Math.max(...completed) || opts.at.getTime();
  const d = zonedYmd(tz, dateMs);
  const combined = all.length > 1;
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
      notes: combined ? joined(all.map((x) => x.notes)) : dispatchRow.notes,
      completedAt: dispatchRow.completedAt,
      vehicleNo: combined ? joined(all.map((x) => x.vehicleNo)) : dispatchRow.vehicleNo,
      driverName: combined ? joined(all.map((x) => x.driverName)) : dispatchRow.driverName,
      driverPhone: combined ? joined(all.map((x) => x.driverPhone)) : dispatchRow.driverPhone,
      transporter: combined ? joined(all.map((x) => x.transporter)) : dispatchRow.transporter,
      transporterName: combined ? joined(all.map((x) => x.transporterName)) : (dispatchRow.transporterName ?? null),
      invoiceNumber: combined ? joined(all.map((x) => x.invoiceNumber)) : dispatchRow.invoiceNumber,
      invoiceDate: combined ? null : dispatchRow.invoiceDate,
    },
    dispatchCodes: all.map((x) => x.code),
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
      partyNo: i.partyNo,
      profileKind: i.profileKind ?? null,
      packedLineCode: i.packedOrderNumber && i.packedLineNo != null ? salesOrderLineCode(i.packedOrderNumber, Number(i.packedLineNo)) : null,
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
  auditAction?: "packingList.create" | "packingList.regenerate" | "packingList.combine";
  auditMeta?: Record<string, unknown>;
  /** FP-PK-13: revision under the same number (regenerate), the row it supersedes, print choices. */
  revision?: number;
  supersedesId?: string | null;
  showBranding?: boolean;
  showOriginalSo?: boolean;
  /** Other dispatches a combined list covers (same customer). */
  extraDispatches?: readonly DispatchRowForPL[];
};

/** Build D1 batch statements for a new packing list (reads use `db` first). */
export async function packingListWriteBatch(
  db: OrrnDb,
  opts: PackingListWriteOpts,
): Promise<{ plId: string; code: string; snapshot: PlSnapshotV2; statements: BatchItem<"sqlite">[] }> {
  const plId = opts.plId ?? crypto.randomUUID();
  const seq = await nextCompanySeq({ db }, opts.companyId);
  const revision = opts.revision ?? 1;
  const showBranding = opts.showBranding ?? true;
  const showOriginalSo = opts.showOriginalSo ?? true;
  const input = await loadPlInput(db, opts.companyId, opts.dispatchRow, {
    plNumber: opts.plNumber,
    actorId: opts.session.user.id,
    at: clockNow(),
    extra: opts.extraDispatches,
  });
  const snapshot = buildPlSnapshotV2({ ...input, revision, showBranding, showOriginalSo });
  const code = opts.plNumber;

  const statements: BatchItem<"sqlite">[] = [
    db.insert(packingList).values({
      id: plId,
      companyId: opts.companyId,
      serverSeq: seq,
      dispatchId: opts.dispatchRow.id,
      code,
      snapshot: snapshot as unknown as Record<string, unknown>,
      revision,
      supersedesId: opts.supersedesId ?? null,
      combinedIntoId: null,
      showBranding,
      showOriginalSo,
      createdBy: opts.session.user.id,
    }),
  ];
  pushChunkedInserts(
    statements,
    (rows) => db.insert(packingListDispatch).values(rows),
    [opts.dispatchRow, ...(opts.extraDispatches ?? [])].map((d) => ({
      id: crypto.randomUUID(),
      companyId: opts.companyId,
      packingListId: plId,
      dispatchId: d.id,
    })),
  );

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
        partyNo: item.partyNo ?? item.serial,
        kgPer12ftMilli: r.kgPer12ftMilli,
        profileKind: item.profileKind ?? null,
        salesOrderCode: g.orderNumber ? salesOrderLineCode(g.orderNumber, g.lineNo ?? 0) : null,
        packedSalesOrderCode: item.packedLineCode ?? null,
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

/** SQL: the outer packing_list row is the current revision of its number (nothing supersedes it). */
function isCurrentRevision(companyId: string): SQL {
  return sql`not exists (select 1 from ${packingList} pn where pn.company_id = ${companyId} and pn.supersedes_id = ${packingList.id})`;
}

/** The current revision of a packing list number (highest revision nothing supersedes). */
async function currentRevision(db: OrrnDb, companyId: string, code: string) {
  const [row] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.companyId, companyId), eq(packingList.code, code), isCurrentRevision(companyId)))
    .orderBy(desc(packingList.revision))
    .limit(1);
  return row ?? null;
}

const MAX_COMBINE = 20;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const printChoices = {
  /** Branding off hides logo and tagline; the legal name always prints (FP-PK-05). */
  showBranding: z.boolean().optional(),
  /** The "Original SO" column (packed-for order); default on. */
  showOriginalSo: z.boolean().optional(),
};

export const packingListRouter = router({
  /**
   * Manually generate a packing list for a completed dispatch that has none (auto-creation runs
   * inside dispatch.complete). Uses the dispatch's PL number; a dispatch completed before PL
   * numbers existed gets its number now, once.
   */
  create: actionProcedure("dispatch.complete")
    .input(z.object({ dispatchId: z.string(), ...printChoices }))
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
        showBranding: input.showBranding,
        showOriginalSo: input.showOriginalSo,
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

  /** Any revision by id (a superseded revision stays readable: it is what was sent). */
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

  /** The dispatch's own packing list, current revision (null when none yet). */
  byDispatch: companyProcedure
    .input(z.object({ dispatchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [pl] = await ctx.db
        .select()
        .from(packingList)
        .where(
          and(
            eq(packingList.dispatchId, input.dispatchId),
            eq(packingList.companyId, ctx.companyId),
            isCurrentRevision(ctx.companyId),
          ),
        )
        // A combined list also points at its first dispatch; the dispatch's own number wins.
        .orderBy(sql`${packingList.code} = (select d.pl_number from ${dispatch} d where d.id = ${input.dispatchId} and d.company_id = ${ctx.companyId}) desc`, desc(packingList.revision))
        .limit(1);
      // Returns null when none exists yet — callers must handle
      return pl ?? null;
    }),

  /** Packing lists, newest first; the current revision of each number unless `allRevisions`. */
  list: companyProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
        allRevisions: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(eq(packingList.companyId, ctx.companyId), input.allRevisions ? undefined : isCurrentRevision(ctx.companyId));

      const items = await ctx.db
        .select({
          id: packingList.id,
          code: packingList.code,
          dispatchId: packingList.dispatchId,
          revision: packingList.revision,
          combinedIntoId: packingList.combinedIntoId,
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
   * Every revision of a packing list number, oldest first, with what changed from the one before
   * (`diffPackingListRevisions` on the stored lines). Each stays readable through `get`.
   */
  revisions: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [one] = await ctx.db
        .select({ code: packingList.code })
        .from(packingList)
        .where(and(eq(packingList.id, input.id), eq(packingList.companyId, ctx.companyId)))
        .limit(1);
      if (!one) throw new TRPCError({ code: "NOT_FOUND", message: "Packing list not found" });
      const revs = await ctx.db
        .select({
          id: packingList.id,
          revision: packingList.revision,
          supersedesId: packingList.supersedesId,
          combinedIntoId: packingList.combinedIntoId,
          showBranding: packingList.showBranding,
          showOriginalSo: packingList.showOriginalSo,
          createdAt: packingList.createdAt,
          createdBy: packingList.createdBy,
        })
        .from(packingList)
        .where(and(eq(packingList.companyId, ctx.companyId), eq(packingList.code, one.code)))
        .orderBy(asc(packingList.revision))
        .limit(100);
      const lines = await mapInChunks(
        revs.map((r) => r.id),
        (ids) =>
          ctx.db
            .select({
              packingListId: packingListLine.packingListId,
              bundleId: packingListLine.bundleId,
              serial: bundle.serial,
              weightG: packingListLine.weightG,
              pcs: packingListLine.quantity,
              lengthMm: packingListLine.lengthMm,
              partyNo: packingListLine.partyNo,
            })
            .from(packingListLine)
            .innerJoin(bundle, and(eq(bundle.id, packingListLine.bundleId), eq(bundle.companyId, ctx.companyId)))
            .where(and(eq(packingListLine.companyId, ctx.companyId), inArray(packingListLine.packingListId, ids))),
      );
      const byList = new Map<string, PlDiffRow[]>();
      for (const l of lines) {
        const list = byList.get(l.packingListId) ?? [];
        list.push({ bundleId: l.bundleId, serial: l.serial, weightG: l.weightG, pcs: l.pcs, lengthMm: l.lengthMm, partyNo: l.partyNo });
        byList.set(l.packingListId, list);
      }
      const current = revs.filter((r) => !revs.some((x) => x.supersedesId === r.id)).at(-1)?.id ?? null;
      return {
        code: one.code,
        currentId: current,
        revisions: revs.map((r, i) => ({
          ...r,
          bundleCount: byList.get(r.id)?.length ?? 0,
          changes: i === 0 ? null : diffPackingListRevisions(byList.get(revs[i - 1]!.id) ?? [], byList.get(r.id) ?? []),
        })),
      };
    }),

  /**
   * Regenerate (C24): rebuild the snapshot from live data as a NEW revision under the same PL
   * number; the sent revision is kept (never deleted) and the new one supersedes it. The number
   * never advances here. A combined list is rebuilt over all its dispatches.
   */
  regenerate: actionProcedure("packingList.regenerate")
    .input(z.object({ id: z.string(), ...printChoices }))
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
      const latest = await currentRevision(ctx.db, ctx.companyId, existing.code);
      if (!latest || latest.id !== existing.id) {
        throw new TRPCError({ code: "CONFLICT", message: `A newer revision of ${existing.code} exists; regenerate that one` });
      }
      if (existing.combinedIntoId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This list was combined into another; regenerate the combined list" });
      }

      const covered = await ctx.db
        .select({ dispatchId: packingListDispatch.dispatchId })
        .from(packingListDispatch)
        .where(and(eq(packingListDispatch.companyId, ctx.companyId), eq(packingListDispatch.packingListId, existing.id)));
      const dispatchIds = [...new Set([existing.dispatchId, ...covered.map((c) => c.dispatchId)])];
      const rows = await mapInChunks(dispatchIds, (ids) =>
        ctx.db
          .select()
          .from(dispatch)
          .where(
            and(
              inArray(dispatch.id, ids),
              eq(dispatch.companyId, ctx.companyId),
              eq(dispatch.status, "completed"),
              isNull(dispatch.deletedAt),
            ),
          ),
      );
      const dispatchRow = rows.find((r) => r.id === existing.dispatchId);
      if (!dispatchRow || rows.length !== dispatchIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Associated dispatch not found or not completed",
        });
      }

      const newPlId = crypto.randomUUID();
      const revision = existing.revision + 1;
      const { statements: createStatements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow,
        extraDispatches: rows.filter((r) => r.id !== dispatchRow.id),
        // The code never changes: the dispatch's PL number, or the combined list's own number.
        plNumber: existing.code,
        session: ctx.session,
        impersonation: ctx.impersonation,
        plId: newPlId,
        revision,
        supersedesId: existing.id,
        showBranding: input.showBranding ?? existing.showBranding,
        showOriginalSo: input.showOriginalSo ?? existing.showOriginalSo,
        auditAction: "packingList.regenerate",
        auditMeta: {
          dispatchId: dispatchRow.id,
          previousId: existing.id,
          code: existing.code,
          revision,
        },
      });

      try {
        // The unique (company, code, revision) index refuses a second regenerate of the same revision.
        await atomicBatch(ctx.db, createStatements);
      } catch (e) {
        if (errorText(e).includes("UNIQUE constraint failed: packing_list.company_id, packing_list.code, packing_list.revision")) {
          throw new TRPCError({ code: "CONFLICT", message: `${existing.code} was regenerated meanwhile; reload it` });
        }
        throw e;
      }

      const pl = await ctx.db.query.packingList.findFirst({
        where: and(eq(packingList.id, newPlId), eq(packingList.companyId, ctx.companyId)),
      });
      if (!pl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to regenerate packing list" });
      }

      return pl;
    }),

  /**
   * Combine (FP-PK-13): one packing list over several completed dispatches of ONE customer. Takes a
   * new PL number (the only other time the number advances besides first issue); each folded list
   * keeps its own number and gets `combined_into_id`. Only current, not yet combined lists.
   */
  combine: actionProcedure("packingList.combine")
    .input(z.object({ ids: z.array(z.string().min(1)).min(2, "Pick at least two packing lists").max(MAX_COMBINE), ...printChoices }))
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set(input.ids)];
      if (ids.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick at least two packing lists" });
      const lists = await ctx.db
        .select()
        .from(packingList)
        .where(and(eq(packingList.companyId, ctx.companyId), inArray(packingList.id, ids)));
      if (lists.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Packing list not found" });
      for (const l of lists) {
        if (l.combinedIntoId) throw new TRPCError({ code: "BAD_REQUEST", message: `${l.code} is already combined` });
        const latest = await currentRevision(ctx.db, ctx.companyId, l.code);
        if (latest?.id !== l.id) throw new TRPCError({ code: "BAD_REQUEST", message: `${l.code} has a newer revision; pick that one` });
      }
      const covered = await mapInChunks(ids, (part) =>
        ctx.db
          .select({ packingListId: packingListDispatch.packingListId, dispatchId: packingListDispatch.dispatchId })
          .from(packingListDispatch)
          .where(and(eq(packingListDispatch.companyId, ctx.companyId), inArray(packingListDispatch.packingListId, part))),
      );
      const dispatchIds = [...new Set([...lists.map((l) => l.dispatchId), ...covered.map((c) => c.dispatchId)])];
      const rows = await mapInChunks(dispatchIds, (part) =>
        ctx.db
          .select()
          .from(dispatch)
          .where(and(inArray(dispatch.id, part), eq(dispatch.companyId, ctx.companyId), eq(dispatch.status, "completed"), isNull(dispatch.deletedAt))),
      );
      if (rows.length !== dispatchIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Every dispatch must be completed" });
      }
      if (new Set(rows.map((r) => r.customerId)).size > 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Packing lists of one customer only can be combined" });
      }
      rows.sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0) || a.code.localeCompare(b.code));
      const primary = rows[0]!;

      const plNumber = (await nextDocNumber(ctx.db, ctx.companyId, "pl", clockNow(), ctx.session.user.id)).number;
      const newPlId = crypto.randomUUID();
      const { statements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow: primary,
        extraDispatches: rows.slice(1),
        plNumber,
        session: ctx.session,
        impersonation: ctx.impersonation,
        plId: newPlId,
        showBranding: input.showBranding,
        showOriginalSo: input.showOriginalSo,
        auditAction: "packingList.combine",
        auditMeta: { code: plNumber, from: lists.map((l) => ({ id: l.id, code: l.code })), dispatchIds },
      });
      statements.push(
        ctx.db
          .update(packingList)
          .set({ combinedIntoId: newPlId })
          .where(and(eq(packingList.companyId, ctx.companyId), inArray(packingList.id, ids), isNull(packingList.combinedIntoId))),
        // Write-time: every folded list was still free (a concurrent combine of one of them fails all).
        batchAbortUnless(
          ctx.db,
          "packing_list_line",
          sql`(select count(*) from ${packingList} pc where pc.company_id = ${ctx.companyId} and pc.combined_into_id = ${newPlId}) = ${ids.length}`,
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "packing_list_line")) {
          throw new TRPCError({ code: "CONFLICT", message: "One of these lists was combined meanwhile; reload them" });
        }
        throw e;
      }
      const pl = await ctx.db.query.packingList.findFirst({
        where: and(eq(packingList.id, newPlId), eq(packingList.companyId, ctx.companyId)),
      });
      if (!pl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to combine packing lists" });
      return pl;
    }),
});
