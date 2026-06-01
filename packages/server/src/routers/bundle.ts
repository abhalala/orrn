import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
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
import { auditInsert } from "../lib/audit";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { formatBundleSerial, formatGroupCode } from "../lib/bundleSerial";
import { nextCompanySeq } from "../lib/sequence";

const bundleRowSchema = z.object({
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  weightG: z.number().int().min(0, "Weight must be >= 0"),
  lengthMm: z.number().int().min(0, "Length must be >= 0"),
  poNumber: z.string().nullable().optional(),
});

const receiptInputSchema = z.object({
  dieId: z.string().min(1, "Die is required"),
  unit: z.string().min(1, "Unit is required"),
  purchaseOrderRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  rows: z.array(bundleRowSchema).min(1, "At least one bundle row is required").max(200, "Max 200 rows per receipt"),
});

/**
 * One row from a legacy bundle import CSV/JSON. Each row identifies its die by
 * (series, sectionCode) — the same natural key dies are imported with — so
 * customers don't have to know internal die IDs when migrating data.
 */
const bundleImportRowSchema = z.object({
  dieSeries: z.string().min(1, "dieSeries is required"),
  dieSectionCode: z.string().min(1, "dieSectionCode is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  weightG: z.number().int().min(0, "Weight must be >= 0"),
  lengthMm: z.number().int().min(0, "Length must be >= 0"),
  poNumber: z.string().nullable().optional(),
});

/**
 * Code prefix used for auto-created legacy import receipts (per company, per
 * die). We allocate one bundleGroup per (companyId, dieId) the first time a
 * die appears in any import, then reuse it on subsequent imports. The prefix
 * is also how the UI distinguishes legacy receipts in the receipts list.
 */
const LEGACY_GROUP_PREFIX = "LEGACY";
const LEGACY_GROUP_UNIT = "legacy";
const LEGACY_GROUP_NOTES = "Auto-generated for legacy/bulk bundle imports.";

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

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const code = formatGroupCode(seq);

      const bundleRows = input.rows.map((row, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        groupId,
        dieId: input.dieId,
        serial: formatBundleSerial(code, idx + 1),
        poNumber: row.poNumber ?? input.purchaseOrderRef ?? null,
        quantity: row.quantity,
        weightG: row.weightG,
        lengthMm: row.lengthMm,
        status: "available" as const,
        createdBy: userId,
      }));

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

      const statements: SqliteBatchItem[] = [
        ctx.db.insert(bundleGroup).values({
          id: groupId,
          companyId: ctx.companyId,
          serverSeq: seq,
          code,
          dieId: input.dieId,
          unit: input.unit,
          purchaseOrderRef: input.purchaseOrderRef ?? null,
          notes: input.notes ?? null,
          createdBy: userId,
        }),
      ];
      pushChunkedInserts(statements, (chunk) => ctx.db.insert(bundle).values(chunk), bundleRows, 50);
      pushChunkedInserts(
        statements,
        (chunk) => ctx.db.insert(bundleStatusEvent).values(chunk),
        eventRows,
        50,
      );
      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
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
        ),
      );

      await atomicBatch(ctx.db, statements);

      return { success: true, groupId, code, bundleCount: bundleRows.length };
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
        const pattern = `%${input.search}%`;
        conditions.push(sql`(${bundle.serial} LIKE ${pattern} OR ${bundle.poNumber} LIKE ${pattern})`);
      }

      const items = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          status: bundle.status,
          quantity: bundle.quantity,
          weightG: bundle.weightG,
          lengthMm: bundle.lengthMm,
          poNumber: bundle.poNumber,
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
      const existing = await ctx.db.query.bundle.findFirst({
        where: and(eq(bundle.id, input.id), eq(bundle.companyId, ctx.companyId)),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      }

      assertTransitionAllowed(existing.status, input.toStatus);

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(bundle)
          .set({ status: input.toStatus, serverSeq: seq })
          .where(eq(bundle.id, existing.id)),
        ctx.db.insert(bundleStatusEvent).values({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: existing.id,
          fromStatus: existing.status,
          toStatus: input.toStatus,
          reason: input.reason ?? null,
          actorId: ctx.session.user.id,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
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
        ),
      ]);

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

  /**
   * Bulk-import bundles from a CSV / JSON file (typically migrating from a
   * legacy system). Each row identifies its die by (series, sectionCode);
   * bundles for the same die land in a single auto-created `LEGACY-…` bundle
   * group, lazily allocated on first use and reused on subsequent imports.
   *
   * This is intentionally separate from `createReceipt` — production receipts
   * are operator workflow with PO refs, units, etc.; legacy bundles are a
   * "just put these on the shelf" data-migration tool.
   */
  bulkImport: companyProcedure
    .input(
      z.object({
        rows: z
          .array(bundleImportRowSchema)
          .min(1, "At least one row is required")
          .max(2000, "Max 2000 bundles per import — split larger files into batches"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Resolve every (series, sectionCode) in the file to a die id.
      //    Build a Set of unique keys first so a 2000-row file with 5 distinct
      //    dies hits the DB once per die rather than once per row. While
      //    walking the rows we also track the weight min/max per die-key so
      //    any die we have to auto-create gets a sensible initial range
      //    derived from the bundles being imported, rather than `0..0`.
      const uniqueDieKeys = new Map<string, { series: string; sectionCode: string }>();
      const weightRangeByKey = new Map<string, { min: number; max: number }>();
      for (const row of input.rows) {
        const key = `${row.dieSeries}::${row.dieSectionCode}`;
        if (!uniqueDieKeys.has(key)) {
          uniqueDieKeys.set(key, { series: row.dieSeries, sectionCode: row.dieSectionCode });
        }
        const range = weightRangeByKey.get(key);
        if (range) {
          if (row.weightG < range.min) range.min = row.weightG;
          if (row.weightG > range.max) range.max = row.weightG;
        } else {
          weightRangeByKey.set(key, { min: row.weightG, max: row.weightG });
        }
      }

      const dieKeyToId = new Map<string, { id: string; series: string; sectionCode: string }>();
      const keysToCreate: Array<{ series: string; sectionCode: string }> = [];
      const archivedKeys: string[] = [];
      for (const [key, { series, sectionCode }] of uniqueDieKeys) {
        // Look up by the natural key WITHOUT a `deletedAt` filter so we can
        // tell "doesn't exist yet" apart from "exists but was soft-deleted".
        // The latter is a hard error: the unique index is on
        // (companyId, series, sectionCode) regardless of deletedAt, so we'd
        // hit a constraint violation if we tried to auto-create over it, and
        // silently resurrecting a die the operator retired is the wrong call.
        const dieRow = await ctx.db.query.die.findFirst({
          where: and(
            eq(die.companyId, ctx.companyId),
            eq(die.series, series),
            eq(die.sectionCode, sectionCode),
          ),
          columns: { id: true, series: true, sectionCode: true, deletedAt: true },
        });
        if (!dieRow) {
          keysToCreate.push({ series, sectionCode });
          continue;
        }
        if (dieRow.deletedAt) {
          archivedKeys.push(`${series} / ${sectionCode}`);
          continue;
        }
        dieKeyToId.set(key, {
          id: dieRow.id,
          series: dieRow.series,
          sectionCode: dieRow.sectionCode,
        });
      }

      if (archivedKeys.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Die${archivedKeys.length === 1 ? "" : "s"} previously deleted: ${archivedKeys
            .slice(0, 5)
            .join(", ")}${archivedKeys.length > 5 ? ` (+${archivedKeys.length - 5} more)` : ""}. Restore them from the dies page before importing bundles.`,
        });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const statements: SqliteBatchItem[] = [];

      // 2. Auto-create any dies that don't exist yet. The natural key
      //    (series, sectionCode) stays exactly as the operator imported it so
      //    subsequent imports — and a later real dies-catalog import — match
      //    the same row. The "legacy" marker lives in the `name` field so it
      //    stands out on the dies index page without polluting the natural
      //    key. Weight min/max default to the range observed in this import;
      //    dimensions are empty and notes prompt operators to fill in the
      //    real values before producing new receipts against the die.
      const newDieIds: string[] = [];
      for (const { series, sectionCode } of keysToCreate) {
        const dieId = crypto.randomUUID();
        const range = weightRangeByKey.get(`${series}::${sectionCode}`) ?? { min: 0, max: 0 };
        statements.push(
          ctx.db.insert(die).values({
            id: dieId,
            companyId: ctx.companyId,
            serverSeq: seq,
            series,
            sectionCode,
            name: `LEGACY · ${series} / ${sectionCode}`,
            dimensions: {},
            weightMinG: range.min,
            weightMaxG: range.max,
            status: "active",
            notes:
              "Auto-created from a bulk bundle import. Review the weight range and add dimensions before producing new receipts against this die.",
          }),
        );
        dieKeyToId.set(`${series}::${sectionCode}`, { id: dieId, series, sectionCode });
        newDieIds.push(dieId);
      }

      // 3. For every die used in this import, find-or-create its legacy group.
      //    A single (companyId, dieId) can have at most ONE legacy group; if
      //    one exists we append to it so the receipts list doesn't explode
      //    after repeated imports.
      const dieIds = Array.from(dieKeyToId.values()).map((d) => d.id);

      const existingLegacyGroups = dieIds.length > 0
        ? await ctx.db
            .select({
              id: bundleGroup.id,
              code: bundleGroup.code,
              dieId: bundleGroup.dieId,
            })
            .from(bundleGroup)
            .where(
              and(
                eq(bundleGroup.companyId, ctx.companyId),
                inArray(bundleGroup.dieId, dieIds),
                like(bundleGroup.code, `${LEGACY_GROUP_PREFIX}-%`),
              ),
            )
        : [];

      const dieIdToGroup = new Map<string, { id: string; code: string }>();
      for (const g of existingLegacyGroups) {
        // First match wins — we expect at most one per (companyId, dieId).
        if (!dieIdToGroup.has(g.dieId)) {
          dieIdToGroup.set(g.dieId, { id: g.id, code: g.code });
        }
      }

      // 4. Allocate a new legacy group for any die that doesn't have one yet.
      //    Codes use a monotonic suffix derived from the company sequence so
      //    they're unique-by-construction and order roughly by creation.
      let nextLegacySuffix = seq;
      const newGroups: Array<{
        id: string;
        code: string;
        dieId: string;
      }> = [];
      for (const dieRow of dieKeyToId.values()) {
        if (dieIdToGroup.has(dieRow.id)) continue;
        const code = `${LEGACY_GROUP_PREFIX}-${String(nextLegacySuffix).padStart(6, "0")}`;
        nextLegacySuffix += 1;
        const groupId = crypto.randomUUID();
        dieIdToGroup.set(dieRow.id, { id: groupId, code });
        newGroups.push({ id: groupId, code, dieId: dieRow.id });
        statements.push(
          ctx.db.insert(bundleGroup).values({
            id: groupId,
            companyId: ctx.companyId,
            serverSeq: seq,
            code,
            dieId: dieRow.id,
            unit: LEGACY_GROUP_UNIT,
            purchaseOrderRef: null,
            notes: LEGACY_GROUP_NOTES,
            createdBy: userId,
          }),
        );
      }

      // 5. For each existing legacy group we're appending to, find the highest
      //    serial index so we can continue numbering without collisions. New
      //    groups start at 1.
      const existingDieIdsAppendedTo = Array.from(dieIdToGroup.keys()).filter(
        (id) => !newGroups.some((g) => g.dieId === id),
      );
      const groupIdToNextIdx = new Map<string, number>();
      for (const g of newGroups) {
        groupIdToNextIdx.set(g.id, 1);
      }
      for (const dieId of existingDieIdsAppendedTo) {
        const group = dieIdToGroup.get(dieId)!;
        const existing = await ctx.db
          .select({ serial: bundle.serial })
          .from(bundle)
          .where(
            and(eq(bundle.companyId, ctx.companyId), eq(bundle.groupId, group.id)),
          );
        let maxIdx = 0;
        for (const row of existing) {
          // Serial is `{groupCode}-B{N…}` — strip prefix and parse the tail.
          const m = row.serial.match(/-B(\d+)$/);
          const tail = m?.[1];
          if (tail) {
            const n = parseInt(tail, 10);
            if (!isNaN(n) && n > maxIdx) maxIdx = n;
          }
        }
        groupIdToNextIdx.set(group.id, maxIdx + 1);
      }

      // 6. Build the bundle + status event rows.
      const now = new Date();
      const bundleRows: Array<typeof bundle.$inferInsert> = [];
      const eventRows: Array<typeof bundleStatusEvent.$inferInsert> = [];

      for (const row of input.rows) {
        const dieRow = dieKeyToId.get(`${row.dieSeries}::${row.dieSectionCode}`)!;
        const group = dieIdToGroup.get(dieRow.id)!;
        const idx = groupIdToNextIdx.get(group.id)!;
        groupIdToNextIdx.set(group.id, idx + 1);

        const bundleId = crypto.randomUUID();
        bundleRows.push({
          id: bundleId,
          companyId: ctx.companyId,
          serverSeq: seq,
          groupId: group.id,
          dieId: dieRow.id,
          serial: formatBundleSerial(group.code, idx),
          quantity: row.quantity,
          weightG: row.weightG,
          lengthMm: row.lengthMm,
          poNumber: row.poNumber ?? null,
          status: "available",
          createdBy: userId,
        });
        eventRows.push({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId,
          fromStatus: null,
          toStatus: "available",
          reason: "legacy-import",
          actorId: userId,
          at: now,
        });
      }

      // 7. Chunk-insert everything in a single atomic batch.
      pushChunkedInserts(statements, (chunk) => ctx.db.insert(bundle).values(chunk), bundleRows, 50);
      pushChunkedInserts(
        statements,
        (chunk) => ctx.db.insert(bundleStatusEvent).values(chunk),
        eventRows,
        50,
      );

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "bundle.import",
            subjectType: "bundle_group",
            meta: {
              bundleCount: bundleRows.length,
              dieCount: dieKeyToId.size,
              newDies: newDieIds.length,
              newGroups: newGroups.length,
              reusedGroups: existingDieIdsAppendedTo.length,
            },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);

      return {
        success: true,
        bundleCount: bundleRows.length,
        dieCount: dieKeyToId.size,
        newDies: newDieIds.length,
        newGroups: newGroups.length,
        reusedGroups: existingDieIdsAppendedTo.length,
      };
    }),
});
