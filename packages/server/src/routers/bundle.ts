import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizeSerial } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { openSalesOrderStatuses, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";
import { dispatch } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  bundleStatuses,
  type BundleStatus,
} from "@orrn/db/schema/inventory";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { bundleBlockReason, holdingDispatchCodes } from "../lib/bundleHold";
import { formatBundleSerial, formatGroupCode } from "../lib/bundleSerial";
import { kgPer12ftMilli } from "../lib/bundleWeight";
import { now as clockNow } from "../lib/clock";
import { allocateDocNumbers } from "../lib/docNumber";
import { packRows, restoreRows, voidRows, type PostingCtx } from "../lib/ledger";
import { batchAbortUnless, isBatchAbort } from "../lib/orders";
import { nextCompanySeq } from "../lib/sequence";

const bundleRowSchema = z.object({
  quantity: z.number().int().positive("Quantity must be at least 1"),
  weightG: z.number().int().positive("Weight must be greater than 0"),
  lengthMm: z.number().int().positive("Length must be greater than 0"),
  poNumber: z.string().max(500).nullable().optional(),
});

const receiptInputSchema = z.object({
  dieId: z.string().min(1, "Die is required"),
  unit: z.string().min(1, "Unit is required").max(500),
  purchaseOrderRef: z.string().max(500).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Yard location the bundles are put in (spec P6). Required once the company has yard locations. */
  locationId: z.string().min(1).optional(),
  /** Sales order line these bundles are packed for (spec P13; `orders.openLines` suggests one). */
  salesOrderLineId: z.string().min(1).max(64).optional(),
  rows: z.array(bundleRowSchema).min(1, "At least one bundle row is required").max(200, "Max 200 rows per receipt"),
});

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

/**
 * The yard a receipt's bundles go to. Required once the company has an active yard location
 * (no default, digest Stage 13); companies without locations keep packing without one.
 */
async function receiptLocation(db: OrrnDb, companyId: string, locationId: string | undefined): Promise<string | null> {
  if (locationId) {
    const loc = await db.query.location.findFirst({
      where: and(eq(location.id, locationId), eq(location.companyId, companyId)),
    });
    if (!loc) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
    if (!loc.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Location ${loc.code} is retired` });
    if (loc.kind !== "yard") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Bundles go to a yard location, not ${loc.code}` });
    }
    return loc.id;
  }
  const [anyYard] = await db
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.companyId, companyId), eq(location.kind, "yard"), eq(location.active, true)))
    .limit(1);
  if (anyYard) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the yard location for these bundles" });
  return null;
}

/**
 * The order line a receipt is packed for: a line of this company, of an open order, for the same
 * section. No line given = not packed against an order.
 */
async function receiptOrderLine(
  db: OrrnDb,
  companyId: string,
  lineId: string | undefined,
  dieId: string,
): Promise<string | null> {
  if (!lineId) return null;
  const [line] = await db
    .select({ id: salesOrderLine.id, dieId: salesOrderLine.dieId, status: salesOrder.status, number: salesOrder.number })
    .from(salesOrderLine)
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .where(and(eq(salesOrderLine.id, lineId), eq(salesOrderLine.companyId, companyId)))
    .limit(1);
  if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
  if (!(openSalesOrderStatuses as readonly string[]).includes(line.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Order ${line.number} is ${line.status}; pick an open order` });
  }
  if (line.dieId !== dieId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That order line is for another section" });
  }
  return line.id;
}

/**
 * One row from a legacy bundle import CSV/JSON. Each row identifies its die by
 * (series, sectionCode) — the same natural key dies are imported with — so
 * customers don't have to know internal die IDs when migrating data.
 */
const bundleImportRowSchema = z.object({
  dieSeries: z.string().min(1, "dieSeries is required").max(500),
  dieSectionCode: z.string().min(1, "dieSectionCode is required").max(500),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  weightG: z.number().int().positive("Weight must be greater than 0"),
  lengthMm: z.number().int().positive("Length must be greater than 0"),
  poNumber: z.string().max(500).nullable().optional(),
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

/** Shared by getBundle / getBySerial: die, group, active dispatch and recent events for a bundle row. */
async function loadBundleDetail(
  db: OrrnDb,
  companyId: string,
  row: typeof bundle.$inferSelect | undefined,
) {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
  }

  const [dieRow, groupRow] = await Promise.all([
    db.query.die.findFirst({
      where: and(eq(die.id, row.dieId), eq(die.companyId, companyId)),
    }),
    db.query.bundleGroup.findFirst({
      where: and(eq(bundleGroup.id, row.groupId), eq(bundleGroup.companyId, companyId)),
    }),
  ]);

  let activeDispatch: { id: string; code: string; status: string } | null = null;
  if (row.currentDispatchId && (row.status === "reserved" || row.status === "dispatched")) {
    const d = await db.query.dispatch.findFirst({
      where: and(eq(dispatch.id, row.currentDispatchId), eq(dispatch.companyId, companyId)),
    });
    if (d) {
      activeDispatch = { id: d.id, code: d.code, status: d.status };
    }
  }

  const events = await db
    .select()
    .from(bundleStatusEvent)
    .where(and(eq(bundleStatusEvent.companyId, companyId), eq(bundleStatusEvent.bundleId, row.id)))
    .orderBy(desc(bundleStatusEvent.at))
    .limit(20);

  return {
    bundle: row,
    die: dieRow ?? null,
    group: groupRow ?? null,
    activeDispatch,
    events,
  };
}

export const bundleRouter = router({
  createReceipt: actionProcedure("bundle.pack")
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
      const locationId = await receiptLocation(ctx.db, ctx.companyId, input.locationId);
      const salesOrderLineId = await receiptOrderLine(ctx.db, ctx.companyId, input.salesOrderLineId, input.dieId);

      const groupId = crypto.randomUUID();
      const now = clockNow();
      const userId = ctx.session.user.id;

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const code = formatGroupCode(seq);

      // Plant tenants number every bundle from the monthly doc series (26I4086); everyone else
      // keeps BG-000001-B001. The block is reserved in one atomic statement before the batch.
      const [co] = await ctx.db
        .select({ settings: company.settings })
        .from(company)
        .where(eq(company.id, ctx.companyId))
        .limit(1);
      const plantNumbers =
        co?.settings?.bundleNumbering === "plant"
          ? (await allocateDocNumbers(ctx.db, ctx.companyId, "bundle", now, input.rows.length, userId)).numbers
          : null;

      const bundleRows = input.rows.map((row, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        groupId,
        dieId: input.dieId,
        serial: plantNumbers ? plantNumbers[idx]! : formatBundleSerial(code, idx + 1),
        poNumber: row.poNumber ?? input.purchaseOrderRef ?? null,
        quantity: row.quantity,
        weightG: row.weightG,
        lengthMm: row.lengthMm,
        status: "available" as const,
        locationId,
        salesOrderLineId,
        kgPer12ftMilli: kgPer12ftMilli(row),
        numberStyle: plantNumbers ? ("plant" as const) : ("legacy" as const),
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

      const groupValues = {
        id: groupId,
        companyId: ctx.companyId,
        serverSeq: seq,
        code,
        dieId: input.dieId,
        unit: input.unit,
        purchaseOrderRef: input.purchaseOrderRef ?? null,
        notes: input.notes ?? null,
        createdBy: userId,
      };
      const statements: SqliteBatchItem[] = [
        locationId
          ? // The group row lands only while the yard is still an active yard. Without it the bundle
            // inserts below break their group foreign key and the whole batch rolls back, so a yard
            // retired or re-typed after our read takes no bundles (write-time guard).
            ctx.db.insert(bundleGroup).select(
              ctx.db
                .select({
                  id: sql<string>`${groupValues.id}`.as("id"),
                  companyId: sql<string>`${groupValues.companyId}`.as("company_id"),
                  serverSeq: sql<number>`${groupValues.serverSeq}`.as("server_seq"),
                  code: sql<string>`${groupValues.code}`.as("code"),
                  dieId: sql<string>`${groupValues.dieId}`.as("die_id"),
                  unit: sql<string>`${groupValues.unit}`.as("unit"),
                  purchaseOrderRef: sql<string | null>`${groupValues.purchaseOrderRef}`.as("purchase_order_ref"),
                  notes: sql<string | null>`${groupValues.notes}`.as("notes"),
                  createdBy: sql<string>`${groupValues.createdBy}`.as("created_by"),
                  createdAt: sql<number>`${now.getTime()}`.as("created_at"),
                  updatedAt: sql<number>`${now.getTime()}`.as("updated_at"),
                })
                .from(location)
                .where(
                  and(
                    eq(location.id, locationId),
                    eq(location.companyId, ctx.companyId),
                    eq(location.active, true),
                    eq(location.kind, "yard"),
                  ),
                ),
            )
          : ctx.db.insert(bundleGroup).values(groupValues),
      ];
      pushChunkedInserts(statements, (rows) => ctx.db.insert(bundle).values(rows), bundleRows);
      if (salesOrderLineId) {
        // Write-time: the order line still exists, is for this section and its order is still open
        // (closed, cancelled or the line removed after the read above rolls the whole pack back).
        statements.push(
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`exists (select 1 from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = ${ctx.companyId} where l.id = ${salesOrderLineId} and l.company_id = ${ctx.companyId} and l.die_id = ${input.dieId} and o.status in ('booking', 'confirmed', 'dispatching'))`,
          ),
        );
      }
      pushChunkedInserts(statements, (rows) => ctx.db.insert(bundleStatusEvent).values(rows), eventRows);
      // Pack = + bundle kg at its location, voucher = this receipt (spec §5).
      statements.push(
        ...packRows(
          { db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: now },
          { type: "pack", id: groupId },
          bundleRows,
        ),
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
              locationId,
              salesOrderLineId,
            },
          },
        ),
      );

      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (salesOrderLineId && isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That order line changed meanwhile (closed, cancelled or removed). Pick the line again.",
          });
        }
        if (locationId && errorText(e).includes("FOREIGN KEY constraint failed")) {
          // Rolled back by the write-time yard guard: name the reason.
          await receiptLocation(ctx.db, ctx.companyId, locationId);
        }
        throw e;
      }

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
      return loadBundleDetail(ctx.db, ctx.companyId, row);
    }),

  getBySerial: companyProcedure
    .input(z.object({ serial: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.bundle.findFirst({
        where: and(eq(bundle.serial, normalizeSerial(input.serial)), eq(bundle.companyId, ctx.companyId)),
      });
      return loadBundleDetail(ctx.db, ctx.companyId, row);
    }),

  transitionStatus: actionProcedure("bundle.void")
    .input(
      z.object({
        id: z.string(),
        toStatus: z.enum(bundleStatuses),
        reason: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.bundle.findFirst({
        where: and(eq(bundle.id, input.id), eq(bundle.companyId, ctx.companyId)),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      }

      // Reserved/dispatched bundles belong to the dispatch flow; say who holds them.
      if (
        input.toStatus !== existing.status &&
        (existing.status === "reserved" || existing.status === "dispatched")
      ) {
        const codes = await holdingDispatchCodes(ctx.db, ctx.companyId, [existing]);
        throw new TRPCError({ code: "BAD_REQUEST", message: bundleBlockReason(existing, codes) });
      }
      assertTransitionAllowed(existing.status, input.toStatus);

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const eventId = crypto.randomUUID();
      const posting: PostingCtx = {
        db: ctx.db,
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        seq,
        postedAt: clockNow(),
      };
      // Void reverses the pack row; restore packs again. Voucher = the status event. Runs after
      // the UPDATE and lands only if it did (lib/ledger.ts).
      const ledgerPosting =
        input.toStatus === "void"
          ? voidRows(posting, { bundleId: existing.id, voucherId: eventId, reason: input.reason ?? null })
          : restoreRows(posting, { bundleId: existing.id, voucherId: eventId, reason: input.reason ?? null });

      await atomicBatch(ctx.db, [
        ctx.db
          .update(bundle)
          .set({ status: input.toStatus, serverSeq: seq })
          // Status predicate (audit S6): a dispatch that reserved the bundle
          // after our read must not have its hold overwritten by a void.
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              eq(bundle.id, existing.id),
              eq(bundle.status, existing.status),
            ),
          ),
        ledgerPosting,
        ctx.db.insert(bundleStatusEvent).values({
          id: eventId,
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
          // The die's weight band (grams per 12 ft): the Stock section block shows it (Task 21).
          dieWeightMinG: die.weightMinG,
          dieWeightMaxG: die.weightMaxG,
          bundleCount: sql<number>`count(*)`.as("bundle_count"),
          totalQuantity: sql<number>`coalesce(sum(${bundle.quantity}), 0)`.as("total_quantity"),
          totalWeightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`.as("total_weight_g"),
          totalLengthMm: sql<number>`coalesce(sum(${bundle.lengthMm}), 0)`.as("total_length_mm"),
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.status, input.status)))
        .groupBy(bundle.dieId, die.series, die.sectionCode, die.name, die.weightMinG, die.weightMaxG)
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
  bulkImport: actionProcedure("bundle.import")
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

      // Chunked: a 2000-row import can touch far more than 100 dies.
      const existingLegacyGroups = await mapInChunks(dieIds, (ids) =>
        ctx.db
          .select({
            id: bundleGroup.id,
            code: bundleGroup.code,
            dieId: bundleGroup.dieId,
          })
          .from(bundleGroup)
          .where(
            and(
              eq(bundleGroup.companyId, ctx.companyId),
              inArray(bundleGroup.dieId, ids),
              like(bundleGroup.code, `${LEGACY_GROUP_PREFIX}-%`),
            ),
          ),
      );

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
      const now = clockNow();
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
          kgPer12ftMilli: kgPer12ftMilli(row),
          numberStyle: "legacy",
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

      // 7. Chunk-insert everything in a single atomic batch. Imported stock is taken onto the
      //    ledger with an opening voucher; its place is unknown until it is moved.
      const openingVoucherId = crypto.randomUUID();
      pushChunkedInserts(statements, (rows) => ctx.db.insert(bundle).values(rows), bundleRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(bundleStatusEvent).values(rows), eventRows);
      statements.push(
        ...packRows(
          { db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: now },
          { type: "opening", id: openingVoucherId },
          bundleRows.map((b) => ({ id: b.id!, weightG: b.weightG, locationId: null })),
        ),
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
              openingVoucherId,
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
