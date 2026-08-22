import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { bundle } from "@orrn/db/schema/inventory";
import { company } from "@orrn/db/schema/tenant";
import { customer } from "@orrn/db/schema/customers";
import {
  dispatch,
  dispatchItem,
  type DispatchStatus,
} from "@orrn/db/schema/dispatch";
import { die } from "@orrn/db/schema/catalog";
import { packingList, packingListLine } from "@orrn/db/schema/packing";

import type { BatchItem } from "drizzle-orm/batch";

import type { Context } from "../context";
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type OrrnDb } from "../lib/atomic";
import { nextCompanySeq } from "../lib/sequence";
import { chunk } from "../lib/d1-in";
import { defaultGroupLabel, packingGroupKeyFromSettings } from "../lib/packing-group";
import { formatWeightRange12ft, kgPer12ft, mmToFeet } from "../lib/weight-range";
import { companyProcedure, router } from "../index";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------
type PackingLineItem = {
  itemId: string;
  bundleId: string;
  bundleSerial: string;
  bundleQuantity: number;
  bundleWeightG: number;
  bundleLengthMm: number;
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
  dieName: string | null;
  poNumber: string | null;
  bundleCreatedAt: Date;
  addedAt: Date;
  groupLabel: string | null;
  resolvedGroupLabel: string;
};

// ---------------------------------------------------------------------------
// Shared helper: gather all data needed for a snapshot and build it.
// Used by both create (on first generate) and regenerate.
// ---------------------------------------------------------------------------
async function buildSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  companyId: string,
  dispatchRow: {
    id: string;
    code: string;
    customerId: string;
    shipDate: Date | null;
    invoiceNo: string | null;
    notes: string | null;
    status: string;
    completedAt: Date | null;
  },
  actorId: string,
): Promise<{ snapshot: Record<string, unknown>; items: PackingLineItem[] }> {
  const customerRow = await db.query.customer.findFirst({
    where: and(
      eq(customer.id, dispatchRow.customerId),
      eq(customer.companyId, companyId),
      isNull(customer.deletedAt),
    ),
  });

  const companyRow = await db.query.company.findFirst({
    where: eq(company.id, companyId),
  });

  const dispatchItems = await db
    .select({
      itemId: dispatchItem.id,
      bundleId: dispatchItem.bundleId,
      groupLabel: dispatchItem.groupLabel,
      addedAt: dispatchItem.addedAt,
    })
    .from(dispatchItem)
    .where(and(eq(dispatchItem.dispatchId, dispatchRow.id), eq(dispatchItem.companyId, companyId)))
    .orderBy(asc(dispatchItem.addedAt));

  const bundleRows: Array<Omit<PackingLineItem, "itemId" | "groupLabel" | "resolvedGroupLabel" | "addedAt">> = [];
  for (const ids of chunk<string>(dispatchItems.map((item: { bundleId: string }) => item.bundleId))) {
    bundleRows.push(...await db.select({
      bundleId: bundle.id,
      bundleSerial: bundle.serial,
      bundleQuantity: bundle.quantity,
      bundleWeightG: bundle.weightG,
      bundleLengthMm: bundle.lengthMm,
      poNumber: bundle.poNumber,
      bundleCreatedAt: bundle.createdAt,
      dieId: die.id,
      dieSeries: die.series,
      dieSectionCode: die.sectionCode,
      dieName: die.name,
    })
    .from(bundle)
    .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
    .where(and(eq(bundle.companyId, companyId), inArray(bundle.id, ids))));
  }
  const bundlesById = new Map(bundleRows.map((row) => [row.bundleId, row]));
  const packingGroupKey = packingGroupKeyFromSettings(companyRow?.settings);
  const items: PackingLineItem[] = dispatchItems.flatMap((item: { itemId: string; bundleId: string; groupLabel: string | null; addedAt: Date }) => {
    const row = bundlesById.get(item.bundleId);
    if (!row) return [];
    const resolvedGroupLabel = item.groupLabel?.trim() || defaultGroupLabel(
      { sectionCode: row.dieSectionCode, name: row.dieName },
      { weightG: row.bundleWeightG, quantity: row.bundleQuantity, lengthMm: row.bundleLengthMm },
      packingGroupKey,
    ) || "UNGROUPED";
    return [{ ...row, ...item, resolvedGroupLabel }];
  });

  const firstSeen = new Map<string, number>();
  for (const item of items) firstSeen.set(item.resolvedGroupLabel, Math.min(firstSeen.get(item.resolvedGroupLabel) ?? Infinity, item.addedAt.getTime()));
  items.sort((a, b) => (firstSeen.get(a.resolvedGroupLabel)! - firstSeen.get(b.resolvedGroupLabel)!) || (a.addedAt.getTime() - b.addedAt.getTime()) || a.bundleSerial.localeCompare(b.bundleSerial));

  const totalQuantity = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleQuantity), 0);
  const totalWeightG = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleWeightG), 0);
  const totalLengthMm = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleLengthMm), 0);

  const snapshot: Record<string, unknown> = {
    schemaVersion: 2,
    packingGroupKey,
    packingListLayout: "orrn",
    dispatch: {
      code: dispatchRow.code,
      customer: {
        id: customerRow?.id ?? "",
        name: customerRow?.name ?? "",
        phone: customerRow?.phone ?? null,
        email: customerRow?.email ?? null,
        billingAddress: customerRow?.billingAddress ?? null,
        shippingAddress: customerRow?.shippingAddress ?? null,
        taxId: customerRow?.taxId ?? null,
      },
      shipDate: dispatchRow.shipDate
        ? new Date(dispatchRow.shipDate).toISOString()
        : null,
      invoiceNo: dispatchRow.invoiceNo ?? null,
      notes: dispatchRow.notes ?? "",
      status: dispatchRow.status as DispatchStatus,
      completedAt: dispatchRow.completedAt
        ? new Date(dispatchRow.completedAt).toISOString()
        : null,
    },
    company: {
      id: companyRow?.id ?? "",
      name: companyRow?.name ?? "",
    },
    items: items.map((item: PackingLineItem) => ({
      bundleSerial: item.bundleSerial,
      die: {
        series: item.dieSeries,
        sectionCode: item.dieSectionCode,
        name: item.dieName,
      },
      uid: item.bundleId,
      groupId: item.resolvedGroupLabel,
      groupLabel: item.resolvedGroupLabel,
      poNumber: item.poNumber,
      quantity: Number(item.bundleQuantity),
      weightG: Number(item.bundleWeightG),
      lengthMm: Number(item.bundleLengthMm),
      kgPer12ft: kgPer12ft(item.bundleWeightG, item.bundleQuantity, item.bundleLengthMm),
      kgPerCut: item.bundleQuantity > 0 ? item.bundleWeightG / 1000 / item.bundleQuantity : null,
      weightRange: formatWeightRange12ft(kgPer12ft(item.bundleWeightG, item.bundleQuantity, item.bundleLengthMm) ?? Number.NaN),
      lengthFt: mmToFeet(item.bundleLengthMm),
      packedAt: item.bundleCreatedAt.toISOString(),
    })),
    groups: Array.from(new Set(items.map((item) => item.resolvedGroupLabel))).map((label) => {
      const groupItems = items.filter((item) => item.resolvedGroupLabel === label);
      const indexes = groupItems.map((item) => items.indexOf(item) + 1);
      return {
        label,
        firstSeenAt: new Date(firstSeen.get(label) ?? 0).toISOString(),
        bundleCount: groupItems.length,
        quantity: groupItems.reduce((sum, item) => sum + Number(item.bundleQuantity), 0),
        weightKg: Number((groupItems.reduce((sum, item) => sum + Number(item.bundleWeightG), 0) / 1000).toFixed(3)),
        lotFrom: Math.min(...indexes),
        lotTo: Math.max(...indexes),
      };
    }),
    totals: {
      totalBundles: items.length,
      totalQuantity,
      totalWeightKg: Number((totalWeightG / 1000).toFixed(3)),
      totalLengthM: Number((totalLengthMm / 1000).toFixed(3)),
    },
    generatedAt: new Date().toISOString(),
    generatedBy: actorId,
  };

  return { snapshot, items };
}

// ---------------------------------------------------------------------------
// Exported helper — called from dispatch.complete inside the same D1 batch so
// a packing list is always atomically present when a dispatch completes.
// ---------------------------------------------------------------------------
type DispatchRowForPL = {
  id: string;
  code: string;
  customerId: string;
  shipDate: Date | null;
  invoiceNo: string | null;
  notes: string | null;
  status: string;
  completedAt: Date | null;
};

type PackingListWriteOpts = {
  companyId: string;
  dispatchRow: DispatchRowForPL;
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
): Promise<{ plId: string; code: string; statements: BatchItem<"sqlite">[] }> {
  const plId = opts.plId ?? crypto.randomUUID();
  const seq = await nextCompanySeq({ db }, opts.companyId);
  const code = `PL-${seq.toString().padStart(6, "0")}`;

  const { snapshot, items } = await buildSnapshot(
    db,
    opts.companyId,
    opts.dispatchRow,
    opts.session.user.id,
  );

  const statements: BatchItem<"sqlite">[] = [
    db.insert(packingList).values({
      id: plId,
      companyId: opts.companyId,
      serverSeq: seq,
      dispatchId: opts.dispatchRow.id,
      code,
      snapshot,
      createdBy: opts.session.user.id,
    }),
  ];

  if (items.length > 0) {
    const lineValues = items.map((item) => ({
      id: crypto.randomUUID(),
      companyId: opts.companyId,
      packingListId: plId,
      bundleId: item.bundleId,
      dieId: item.dieId,
      quantity: Number(item.bundleQuantity),
      weightG: Number(item.bundleWeightG),
      lengthMm: Number(item.bundleLengthMm),
      groupLabel: item.resolvedGroupLabel,
    }));
    pushChunkedInserts(
      statements,
      (chunk) => db.insert(packingListLine).values(chunk),
      lineValues,
      10,
    );
  }

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
          bundleCount: items.length,
        },
      },
    ),
  );

  return { plId, code, statements };
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
   * Manually generate a packing list for a completed dispatch.
   * Auto-creation is handled inside dispatch.complete; this endpoint is for
   * the rare case where auto-creation was missed or for future re-trigger.
   */
  create: companyProcedure
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
        where: and(
          eq(packingList.dispatchId, input.dispatchId),
          eq(packingList.companyId, ctx.companyId),
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Packing list already exists for this dispatch",
        });
      }

      const { plId, statements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow,
        session: ctx.session,
        impersonation: ctx.impersonation,
      });
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
   * Regenerate: delete the existing packing list and create a fresh one.
   * New code + sequence number; snapshot is rebuilt from live data.
   */
  regenerate: companyProcedure
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
        session: ctx.session,
        impersonation: ctx.impersonation,
        plId: newPlId,
        auditAction: "packingList.regenerate",
        auditMeta: {
          dispatchId: dispatchRow.id,
          previousId: existing.id,
        },
      });

      await atomicBatch(ctx.db, [
        ctx.db.delete(packingListLine).where(eq(packingListLine.packingListId, existing.id)),
        ctx.db.delete(packingList).where(eq(packingList.id, existing.id)),
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
