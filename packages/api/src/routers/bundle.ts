import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dispatch } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  bundleStatuses,
  type BundleStatus,
} from "@orrn/db/schema/inventory";

import { companyProcedure, router } from "../index";
import { writeAudit } from "../lib/audit";
import { formatBundleSerial, formatGroupCode } from "../lib/bundleSerial";
import { nextCompanySeq } from "../lib/sequence";

const bundleRowSchema = z.object({
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  weightG: z.number().int().min(0, "Weight must be >= 0"),
  lengthMm: z.number().int().min(0, "Length must be >= 0"),
});

const receiptInputSchema = z.object({
  dieId: z.string().min(1, "Die is required"),
  unit: z.string().min(1, "Unit is required"),
  purchaseOrderRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  rows: z.array(bundleRowSchema).min(1, "At least one bundle row is required").max(200, "Max 200 rows per receipt"),
});

// M4 state machine: only available <-> void.
// Reserved/dispatched transitions are owned by the dispatch state machine in M5.
const M4_ALLOWED_TRANSITIONS: Record<BundleStatus, BundleStatus[]> = {
  available: ["void"],
  void: ["available"],
  reserved: [],
  dispatched: [],
};

function assertTransitionAllowed(from: BundleStatus, to: BundleStatus) {
  if (from === to) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Bundle is already in status "${to}"`,
    });
  }
  const allowed = M4_ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Transition ${from} -> ${to} is not allowed in M4. Dispatch transitions are managed by the dispatch flow.`,
    });
  }
}

export const bundleRouter = router({
  createReceipt: companyProcedure
    .input(receiptInputSchema)
    .mutation(async ({ ctx, input }) => {
      const dieRow = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.id, input.dieId),
          eq(die.companyId, ctx.companyId),
          isNull(die.deletedAt),
        ),
      });
      if (!dieRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      const groupId = crypto.randomUUID();
      const now = new Date();
      const userId = ctx.session.user.id;

      const created = await ctx.db.transaction(async (tx) => {
        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);
        const code = formatGroupCode(seq);

        await tx.insert(bundleGroup).values({
          id: groupId,
          companyId: ctx.companyId,
          serverSeq: seq,
          code,
          dieId: input.dieId,
          unit: input.unit,
          purchaseOrderRef: input.purchaseOrderRef ?? null,
          notes: input.notes ?? null,
          createdBy: userId,
        });

        const bundleRows = input.rows.map((row, idx) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          groupId,
          dieId: input.dieId,
          serial: formatBundleSerial(code, idx + 1),
          quantity: row.quantity,
          weightG: row.weightG,
          lengthMm: row.lengthMm,
          status: "available" as const,
          createdBy: userId,
        }));

        // Chunk inserts to stay under SQLite variable limits.
        const chunkSize = 50;
        for (let i = 0; i < bundleRows.length; i += chunkSize) {
          await tx.insert(bundle).values(bundleRows.slice(i, i + chunkSize));
        }

        const eventRows = bundleRows.map((row) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: row.id,
          fromStatus: null,
          toStatus: "available" as const,
          reason: "receipt",
          actorId: userId,
          at: now,
        }));
        for (let i = 0; i < eventRows.length; i += chunkSize) {
          await tx.insert(bundleStatusEvent).values(eventRows.slice(i, i + chunkSize));
        }

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "bundle.receipt.create",
            subjectType: "bundle_group",
            subjectId: groupId,
            meta: {
              code,
              dieId: input.dieId,
              count: bundleRows.length,
              purchaseOrderRef: input.purchaseOrderRef ?? null,
            },
          },
        );

        return { groupId, code, bundleCount: bundleRows.length };
      });

      return { success: true, ...created };
    }),

  listGroups: companyProcedure
    .input(
      z.object({
        search: z.string().optional(),
        dieId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(bundleGroup.companyId, ctx.companyId)];
      if (input.dieId) {
        conditions.push(eq(bundleGroup.dieId, input.dieId));
      }
      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          sql`(${bundleGroup.code} LIKE ${pattern} OR ${bundleGroup.purchaseOrderRef} LIKE ${pattern})`,
        );
      }

      const items = await ctx.db
        .select({
          id: bundleGroup.id,
          code: bundleGroup.code,
          dieId: bundleGroup.dieId,
          dieSeries: die.series,
          dieSectionCode: die.sectionCode,
          unit: bundleGroup.unit,
          purchaseOrderRef: bundleGroup.purchaseOrderRef,
          notes: bundleGroup.notes,
          createdAt: bundleGroup.createdAt,
          bundleCount: sql<number>`count(${bundle.id})`.as("bundle_count"),
          totalQuantity: sql<number>`coalesce(sum(${bundle.quantity}), 0)`.as("total_quantity"),
          totalWeightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`.as("total_weight_g"),
          totalLengthMm: sql<number>`coalesce(sum(${bundle.lengthMm}), 0)`.as("total_length_mm"),
        })
        .from(bundleGroup)
        .innerJoin(
          die,
          and(eq(die.id, bundleGroup.dieId), eq(die.companyId, bundleGroup.companyId)),
        )
        .leftJoin(
          bundle,
          and(eq(bundle.groupId, bundleGroup.id), eq(bundle.companyId, bundleGroup.companyId)),
        )
        .where(and(...conditions))
        .groupBy(bundleGroup.id, die.series, die.sectionCode)
        .orderBy(desc(bundleGroup.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRow = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(bundleGroup)
        .where(and(...conditions));

      return {
        items,
        total: totalRow[0]?.count ?? 0,
      };
    }),

  getGroup: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const group = await ctx.db.query.bundleGroup.findFirst({
        where: and(
          eq(bundleGroup.id, input.id),
          eq(bundleGroup.companyId, ctx.companyId),
        ),
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      }

      const dieRow = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, group.dieId), eq(die.companyId, ctx.companyId)),
      });

      const bundles = await ctx.db
        .select()
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.groupId, group.id)))
        .orderBy(asc(bundle.serial))
        .limit(500);

      return { group, die: dieRow ?? null, bundles };
    }),

  listBundles: companyProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(bundleStatuses).optional(),
        dieId: z.string().optional(),
        groupId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(bundle.companyId, ctx.companyId)];
      if (input.status) conditions.push(eq(bundle.status, input.status));
      if (input.dieId) conditions.push(eq(bundle.dieId, input.dieId));
      if (input.groupId) conditions.push(eq(bundle.groupId, input.groupId));
      if (input.search) {
        conditions.push(sql`${bundle.serial} LIKE ${`%${input.search}%`}`);
      }

      const items = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          status: bundle.status,
          quantity: bundle.quantity,
          weightG: bundle.weightG,
          lengthMm: bundle.lengthMm,
          dieId: bundle.dieId,
          dieSeries: die.series,
          dieSectionCode: die.sectionCode,
          groupId: bundle.groupId,
          groupCode: bundleGroup.code,
          createdAt: bundle.createdAt,
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .innerJoin(
          bundleGroup,
          and(eq(bundleGroup.id, bundle.groupId), eq(bundleGroup.companyId, bundle.companyId)),
        )
        .where(and(...conditions))
        .orderBy(desc(bundle.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRow = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(bundle)
        .where(and(...conditions));

      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  getBundle: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.bundle.findFirst({
        where: and(eq(bundle.id, input.id), eq(bundle.companyId, ctx.companyId)),
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      }

      const [dieRow, groupRow] = await Promise.all([
        ctx.db.query.die.findFirst({
          where: and(eq(die.id, row.dieId), eq(die.companyId, ctx.companyId)),
        }),
        ctx.db.query.bundleGroup.findFirst({
          where: and(eq(bundleGroup.id, row.groupId), eq(bundleGroup.companyId, ctx.companyId)),
        }),
      ]);

      let activeDispatch: { id: string; code: string; status: string } | null = null;
      if (row.currentDispatchId && (row.status === "reserved" || row.status === "dispatched")) {
        const d = await ctx.db.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, row.currentDispatchId),
            eq(dispatch.companyId, ctx.companyId),
          ),
        });
        if (d) {
          activeDispatch = { id: d.id, code: d.code, status: d.status };
        }
      }

      const events = await ctx.db
        .select()
        .from(bundleStatusEvent)
        .where(
          and(
            eq(bundleStatusEvent.companyId, ctx.companyId),
            eq(bundleStatusEvent.bundleId, row.id),
          ),
        )
        .orderBy(desc(bundleStatusEvent.at))
        .limit(20);

      return {
        bundle: row,
        die: dieRow ?? null,
        group: groupRow ?? null,
        activeDispatch,
        events,
      };
    }),

  transitionStatus: companyProcedure
    .input(
      z.object({
        id: z.string(),
        toStatus: z.enum(bundleStatuses),
        reason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const existing = await tx.query.bundle.findFirst({
          where: and(eq(bundle.id, input.id), eq(bundle.companyId, ctx.companyId)),
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
        }

        assertTransitionAllowed(existing.status, input.toStatus);

        const seq = await nextCompanySeq({ db: tx as any }, ctx.companyId);

        await tx
          .update(bundle)
          .set({ status: input.toStatus, serverSeq: seq })
          .where(eq(bundle.id, existing.id));

        await tx.insert(bundleStatusEvent).values({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: existing.id,
          fromStatus: existing.status,
          toStatus: input.toStatus,
          reason: input.reason ?? null,
          actorId: ctx.session.user.id,
        });

        await writeAudit(
          { db: tx as any, companyId: ctx.companyId, session: ctx.session },
          {
            action: "bundle.transition",
            subjectType: "bundle",
            subjectId: existing.id,
            meta: {
              from: existing.status,
              to: input.toStatus,
              reason: input.reason ?? null,
            },
          },
        );
      });

      return { success: true };
    }),

  stockSummary: companyProcedure
    .input(
      z.object({
        status: z.enum(bundleStatuses).default("available"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          dieId: bundle.dieId,
          dieSeries: die.series,
          dieSectionCode: die.sectionCode,
          dieName: die.name,
          bundleCount: sql<number>`count(*)`.as("bundle_count"),
          totalQuantity: sql<number>`coalesce(sum(${bundle.quantity}), 0)`.as("total_quantity"),
          totalWeightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`.as("total_weight_g"),
          totalLengthMm: sql<number>`coalesce(sum(${bundle.lengthMm}), 0)`.as("total_length_mm"),
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.status, input.status)))
        .groupBy(bundle.dieId, die.series, die.sectionCode, die.name)
        .orderBy(asc(die.series), asc(die.sectionCode));

      const totals = rows.reduce(
        (acc, row) => ({
          bundleCount: acc.bundleCount + Number(row.bundleCount),
          totalQuantity: acc.totalQuantity + Number(row.totalQuantity),
          totalWeightG: acc.totalWeightG + Number(row.totalWeightG),
          totalLengthMm: acc.totalLengthMm + Number(row.totalLengthMm),
        }),
        { bundleCount: 0, totalQuantity: 0, totalWeightG: 0, totalLengthMm: 0 },
      );

      return { items: rows, totals };
    }),
});
