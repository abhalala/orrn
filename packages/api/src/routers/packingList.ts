import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

import { companyProcedure, router } from "../index";
import type { Context } from "../context";
import { writeAudit } from "../lib/audit";
import { nextCompanySeq } from "../lib/sequence";

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
  groupId: string | null;
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

  const items = await db
    .select({
      itemId: dispatchItem.id,
      bundleId: bundle.id,
      bundleSerial: bundle.serial,
      bundleQuantity: bundle.quantity,
      bundleWeightG: bundle.weightG,
      bundleLengthMm: bundle.lengthMm,
      dieId: die.id,
      dieSeries: die.series,
      dieSectionCode: die.sectionCode,
      groupId: bundle.groupId,
    })
    .from(dispatchItem)
    .innerJoin(
      bundle,
      and(
        eq(bundle.id, dispatchItem.bundleId),
        eq(bundle.companyId, dispatchItem.companyId),
      ),
    )
    .innerJoin(
      die,
      and(
        eq(die.id, bundle.dieId),
        eq(die.companyId, bundle.companyId),
      ),
    )
    .where(
      and(
        eq(dispatchItem.dispatchId, dispatchRow.id),
        eq(dispatchItem.companyId, companyId),
      ),
    ) as PackingLineItem[];

  const totalQuantity = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleQuantity), 0);
  const totalWeightG = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleWeightG), 0);
  const totalLengthMm = items.reduce((s: number, i: PackingLineItem) => s + Number(i.bundleLengthMm), 0);

  const snapshot: Record<string, unknown> = {
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
      },
      groupId: item.groupId ?? "",
      quantity: Number(item.bundleQuantity),
      weightG: Number(item.bundleWeightG),
      lengthMm: Number(item.bundleLengthMm),
    })),
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
// Exported helper — called from dispatch.complete inside its transaction so
// a packing list is always atomically present when a dispatch completes.
// ---------------------------------------------------------------------------
type DispatchRowForPL = {
  id: string;
  code: string;
  customerId: string;
  shipDate: Date | null;
  notes: string | null;
  status: string;
  completedAt: Date | null;
};

export async function createPackingListInTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  opts: {
    companyId: string;
    dispatchRow: DispatchRowForPL;
    session: NonNullable<Context["session"]>;
    impersonation?: Context["impersonation"];
  },
) {
  const seq = await nextCompanySeq({ db: tx }, opts.companyId);
  const code = `PL-${seq.toString().padStart(6, "0")}`;

  const { snapshot, items } = await buildSnapshot(
    tx,
    opts.companyId,
    opts.dispatchRow,
    opts.session.user.id,
  );

  const [pl] = await tx
    .insert(packingList)
    .values({
      id: crypto.randomUUID(),
      companyId: opts.companyId,
      serverSeq: seq,
      dispatchId: opts.dispatchRow.id,
      code,
      snapshot,
      createdBy: opts.session.user.id,
    })
    .returning();

  if (!pl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to auto-create packing list" });

  if (items.length > 0) {
    await tx.insert(packingListLine).values(
      items.map((item, index) => ({
        id: crypto.randomUUID(),
        companyId: opts.companyId,
        packingListId: pl.id,
        bundleId: item.bundleId,
        dieId: item.dieId,
        quantity: Number(item.bundleQuantity),
        weightG: Number(item.bundleWeightG),
        lengthMm: Number(item.bundleLengthMm),
        groupLabel: item.groupId ?? `GROUP-${index + 1}`,
      })),
    );
  }

  await writeAudit(
    { db: tx, companyId: opts.companyId, session: opts.session, impersonation: opts.impersonation },
    {
      action: "packingList.create",
      subjectType: "packing_list",
      subjectId: pl.id,
      meta: { dispatchId: opts.dispatchRow.id, code, bundleCount: items.length },
    },
  );

  return pl;
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
        where: eq(packingList.dispatchId, input.dispatchId),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Packing list already exists for this dispatch",
        });
      }

      const result = await ctx.db.transaction(async (tx) => {
        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        const code = `PL-${seq.toString().padStart(6, "0")}`;

        const { snapshot, items } = await buildSnapshot(
          tx as any,
          ctx.companyId,
          dispatchRow,
          ctx.session.user.id,
        );

        const [pl] = await tx
          .insert(packingList)
          .values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            dispatchId: dispatchRow.id,
            code,
            snapshot,
            createdBy: ctx.session.user.id,
          })
          .returning();

        if (!pl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create packing list" });

        if (items.length > 0) {
          await tx.insert(packingListLine).values(
            items.map((item, index) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              packingListId: pl.id,
              bundleId: item.bundleId,
              dieId: item.dieId,
              quantity: Number(item.bundleQuantity),
              weightG: Number(item.bundleWeightG),
              lengthMm: Number(item.bundleLengthMm),
              groupLabel: item.groupId ?? `GROUP-${index + 1}`,
            })),
          );
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "packingList.create",
            subjectType: "packing_list",
            subjectId: pl.id,
            meta: { dispatchId: dispatchRow.id, code, bundleCount: items.length },
          },
        );

        return pl;
      });

      return result;
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

      const result = await ctx.db.transaction(async (tx) => {
        const dispatchRow = await tx.query.dispatch.findFirst({
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

        // Delete lines then header
        await tx
          .delete(packingListLine)
          .where(eq(packingListLine.packingListId, existing.id));
        await tx
          .delete(packingList)
          .where(eq(packingList.id, existing.id));

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        const code = `PL-${seq.toString().padStart(6, "0")}`;

        const { snapshot, items } = await buildSnapshot(
          tx as any,
          ctx.companyId,
          dispatchRow,
          ctx.session.user.id,
        );

        const [pl] = await tx
          .insert(packingList)
          .values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            dispatchId: dispatchRow.id,
            code,
            snapshot,
            createdBy: ctx.session.user.id,
          })
          .returning();

        if (!pl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to regenerate packing list" });

        if (items.length > 0) {
          await tx.insert(packingListLine).values(
            items.map((item, index) => ({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              packingListId: pl.id,
              bundleId: item.bundleId,
              dieId: item.dieId,
              quantity: Number(item.bundleQuantity),
              weightG: Number(item.bundleWeightG),
              lengthMm: Number(item.bundleLengthMm),
              groupLabel: item.groupId ?? `GROUP-${index + 1}`,
            })),
          );
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "packingList.regenerate",
            subjectType: "packing_list",
            subjectId: pl.id,
            meta: {
              dispatchId: dispatchRow.id,
              previousId: existing.id,
              code,
              bundleCount: items.length,
            },
          },
        );

        return pl;
      });

      return result;
    }),
});
