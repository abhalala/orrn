import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";

import {
  castRequiredOnBundle,
  normalizeSerial,
  readFloorSettings,
  resolveStandard,
  weightNeedsReason,
  weightRange12ftFromMilli,
  type BundleNumberPolicy,
} from "@orrn/domain";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { cast as castTable, melt } from "@orrn/db/schema/foundry";
import { openSalesOrderStatuses, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";
import { dispatch } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  bundleStatuses,
  bundleWeightSources,
  packReject,
  type BundleStatus,
  type BundleWeightSource,
} from "@orrn/db/schema/inventory";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { bundleBlockReason, holdingDispatchCodes } from "../lib/bundleHold";
import { formatBundleSerial, formatGroupCode } from "../lib/bundleSerial";
import { bundleBandTone, bundleBandTones } from "../lib/bundleBand";
import { kgPer12ftMilli } from "../lib/bundleWeight";
import { now as clockNow } from "../lib/clock";
import { assertDieAllowed } from "../lib/dieOwner";
import { allocateDocNumbers, allocatePartyBundleNumbers } from "../lib/docNumber";
import { clientRequestIdSchema, replayProbe, replayState, REQUEST_ID_CONFLICT, requestRowIds } from "../lib/importReplay";
import { resolvePlantScrap } from "../lib/foundry";
import {
  ageingTablesExist,
  drawAgeingRowStatements,
  restoreAgeingRowStatements,
  errorText,
  isPackAbort,
  packRejectLedgerRow,
  plantScrapStreamId,
  plantScrapStreamStatements,
  readAgeingRow,
  rejectReasons,
  scaleConfigured,
} from "../lib/pack";
import { packRows, restoreRows, voidRows, type PostingCtx } from "../lib/ledger";
import { releaseOnVoidStatements } from "../lib/orderHold";
import { batchAbortUnless, isBatchAbort } from "../lib/orders";
import { nextCompanySeq } from "../lib/sequence";

/** Most bundles one receipt makes (spec §E6). */
const MAX_RECEIPT_ROWS = 200;

const bundleRowSchema = z.object({
  quantity: z.number().int().positive("Quantity must be at least 1"),
  weightG: z.number().int().positive("Weight must be greater than 0").max(10_000_000, "Weight is over 10 t"),
  lengthMm: z.number().int().positive("Length must be greater than 0"),
  poNumber: z.string().max(500).nullable().optional(),
  /** FP-PK-02: where the weight came from. Omitted = typed (`manual`). */
  weightSource: z.enum(bundleWeightSources).optional(),
  /** The stable scale grams the screen held (evidence when the packer typed over it). */
  scaleReadingG: z.number().int().positive().max(10_000_000).nullable().optional(),
  /** Required for a typed weight while the plant's edge node reports a scale (`weightNeedsReason`). */
  weightOverrideReason: z.string().trim().min(1).max(500).nullable().optional(),
});

const rejectRowSchema = z.object({
  pcs: z.number().int().positive("Reject pieces must be at least 1").max(100_000),
  /** Weighed rejects post +kg at plant scrap (PLANT-SCRAP); pieces without a weight post nothing. */
  weightG: z.number().int().positive().max(10_000_000).nullable().optional(),
  /** A `qc_reject` reason code (`bend`, `surface`, …, `other` needs a note). */
  reasonCode: z.string().trim().min(1).max(40),
  note: z.string().trim().max(500).nullable().optional(),
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
  /** The die copy that made them; required when the section or a copy is customer-owned (FP-PK-10). */
  dieInstanceId: z.string().min(1).max(64).optional(),
  /** An approved `die_owner_override` the screen just got (FP-DR-13). */
  approvalId: z.string().min(1).max(64).optional(),
  /** The cast the billets came from; required while `requireCastOnBundle` is in effect. */
  castId: z.string().min(1).max(64).optional(),
  /** Trolley slice (Next): validated only once ageing tables exist. */
  ageingRowId: z.string().min(1).max(64).optional(),
  /** Label branding (FP-PK-05), snapshotted on every bundle; default on. */
  showLogo: z.boolean().optional(),
  rows: z.array(bundleRowSchema).min(1, "At least one bundle row is required").max(MAX_RECEIPT_ROWS, "Max 200 rows per receipt"),
  /** Pieces rejected at pack (FP-PK-14). */
  rejects: z.array(rejectRowSchema).max(50, "Max 50 reject lines per receipt").optional(),
});


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
): Promise<{ id: string; customerId: string; policy: BundleNumberPolicy | null; number: string; lineNo: number } | null> {
  if (!lineId) return null;
  const [line] = await db
    .select({
      id: salesOrderLine.id,
      dieId: salesOrderLine.dieId,
      lineNo: salesOrderLine.lineNo,
      status: salesOrder.status,
      number: salesOrder.number,
      customerId: salesOrder.customerId,
      policy: customer.bundleNumberPolicy,
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .leftJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
    .where(and(eq(salesOrderLine.id, lineId), eq(salesOrderLine.companyId, companyId)))
    .limit(1);
  if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
  if (!(openSalesOrderStatuses as readonly string[]).includes(line.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Order ${line.number} is ${line.status}; pick an open order` });
  }
  if (line.dieId !== dieId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That order line is for another section" });
  }
  return { id: line.id, customerId: line.customerId, policy: line.policy ?? null, number: line.number, lineNo: Number(line.lineNo) };
}

/**
 * `requireCastOnBundle` (settings, else on once the company has a live melt): the cast must be
 * this company's and have a live melt. Returns the cast id to store, or null.
 */
async function receiptCast(
  db: OrrnDb,
  companyId: string,
  castId: string | undefined,
  requireSetting: boolean | null,
): Promise<string | null> {
  const liveMelt = (castFilter?: string) =>
    db
      .select({ id: melt.id })
      .from(melt)
      .where(and(eq(melt.companyId, companyId), isNull(melt.cancelledAt), castFilter ? eq(melt.castId, castFilter) : undefined))
      .limit(1);
  if (castId) {
    const [row] = await db
      .select({ id: castTable.id, number: castTable.number })
      .from(castTable)
      .where(and(eq(castTable.id, castId), eq(castTable.companyId, companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Cast not found" });
    const [m] = await liveMelt(row.id);
    if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: `Cast ${row.number} has no melt yet; pick another cast` });
    return row.id;
  }
  const required = castRequiredOnBundle({ requireCastOnBundle: requireSetting }, requireSetting === null ? (await liveMelt()).length > 0 : false);
  if (required) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the cast these bundles came from" });
  return null;
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

  // D15: the same band verdict as the pack line and the stock views (`/b/$serial`).
  const band = await bundleBandTone(db, companyId, {
    dieId: row.dieId,
    dieInstanceId: row.dieInstanceId,
    kgPer12ftMilli: row.kgPer12ftMilli ?? kgPer12ftMilli(row),
  });

  return {
    bundle: row,
    die: dieRow ?? null,
    group: groupRow ?? null,
    activeDispatch,
    events,
    band,
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
      const rejects = input.rejects ?? [];

      // Trolley seam (C32): server remaining, refuse an over-draw; die and length come from the row.
      const ageingRow = input.ageingRowId ? await readAgeingRow(ctx.db, ctx.companyId, input.ageingRowId) : null;
      const drawPcs = input.rows.reduce((s, r) => s + r.quantity, 0) + rejects.reduce((s, r) => s + r.pcs, 0);
      if (ageingRow) {
        if (ageingRow.dieId !== input.dieId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That trolley row is of another section" });
        }
        if (input.rows.some((r) => r.lengthMm > ageingRow.lengthMm)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A bundle can't be longer than the trolley row's cut length" });
        }
        if (drawPcs > ageingRow.remaining) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only ${ageingRow.remaining} pieces left on this trolley row; this pack takes ${drawPcs}`,
          });
        }
      }

      const locationId = await receiptLocation(ctx.db, ctx.companyId, input.locationId);
      const line = await receiptOrderLine(ctx.db, ctx.companyId, input.salesOrderLineId, input.dieId);
      const salesOrderLineId = line?.id ?? null;

      // m-13: a retired copy or one away at the die maker cannot have pressed these.
      if (input.dieInstanceId) {
        const [copy] = await ctx.db
          .select({ code: dieInstance.code, status: dieInstance.status })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.sectionId, input.dieId)))
          .limit(1);
        if (copy?.status === "retired") throw new TRPCError({ code: "BAD_REQUEST", message: `Die copy ${copy.code} is retired` });
        if (copy?.status === "at_maker") throw new TRPCError({ code: "BAD_REQUEST", message: `Die copy ${copy.code} is at the die maker` });
      }

      // FP-PK-10: an owned die makes only its owner's material; plant stock (no line) is blocked.
      const owner = await assertDieAllowed(ctx.db, ctx.companyId, {
        dieId: input.dieId,
        dieInstanceId: input.dieInstanceId ?? null,
        customerId: line?.customerId ?? null,
        purpose: "pack",
        approvalId: input.approvalId ?? null,
      });

      const [co] = await ctx.db
        .select({ settings: company.settings })
        .from(company)
        .where(eq(company.id, ctx.companyId))
        .limit(1);
      const floor = readFloorSettings(co?.settings);
      const castId = await receiptCast(ctx.db, ctx.companyId, input.castId, floor.requireCastOnBundle);

      // FP-PK-02: a typed weight needs a reason while a scale is on the node.
      const scaleOn = await scaleConfigured(ctx.db, ctx.companyId);
      const weights = input.rows.map((row, idx) => {
        const source: BundleWeightSource = row.weightSource ?? "manual";
        if (source === "scale") {
          // m-1: "scale" without a scale on the node would dodge the typed-weight reason.
          if (!scaleOn) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Row ${idx + 1}: no scale is connected; type the weight and say why` });
          }
          if (row.scaleReadingG != null && row.scaleReadingG !== row.weightG) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Row ${idx + 1}: a scale weight must be the reading` });
          }
          return { weightSource: source, scaleReadingG: row.weightG, weightOverrideReason: null };
        }
        const reason = row.weightOverrideReason?.trim() || null;
        if (weightNeedsReason({ weightSource: source, scaleConfigured: scaleOn }) && !reason) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Row ${idx + 1}: say why the weight was typed instead of weighed` });
        }
        return { weightSource: source, scaleReadingG: row.scaleReadingG ?? null, weightOverrideReason: reason };
      });

      const rejectReasonTexts = await rejectReasons(ctx.db, ctx.companyId, rejects);
      const plantScrap = rejects.some((r) => r.weightG) ? await resolvePlantScrap(ctx.db, ctx.companyId) : null;
      // m-5: the stream the reject kg posts to, resolved before the batch (created in it when new).
      const existingStream = plantScrap ? await plantScrapStreamId(ctx.db, ctx.companyId) : null;
      const scrapStreamId = existingStream ?? crypto.randomUUID();

      const groupId = crypto.randomUUID();
      const now = clockNow();
      const userId = ctx.session.user.id;

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const code = formatGroupCode(seq);

      // Plant tenants number every bundle from the monthly doc series (26I4086); everyone else
      // keeps BG-000001-B001. The block is reserved in one atomic statement before the batch.
      const plantNumbers =
        co?.settings?.bundleNumbering === "plant"
          ? (await allocateDocNumbers(ctx.db, ctx.companyId, "bundle", now, input.rows.length, userId)).numbers
          : null;
      const serials = input.rows.map((_, idx) => (plantNumbers ? plantNumbers[idx]! : formatBundleSerial(code, idx + 1)));
      // FP-PK-07 (C25): the customer's own series when it has a policy, else the company serial.
      const partyNos =
        line?.policy
          ? (await allocatePartyBundleNumbers(ctx.db, ctx.companyId, line.customerId, line.policy, now, input.rows.length, userId)).numbers
          : serials;
      // Snapshot the BIS pair for the section's profile kind (semi falls back to solid).
      const standard = resolveStandard(floor.standards, dieRow.profileKind ?? null);
      const showLogo = input.showLogo ?? true;
      const dieInstanceId = owner.dieInstanceId ?? input.dieInstanceId ?? null;

      const bundleRows = input.rows.map((row, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        groupId,
        dieId: input.dieId,
        serial: serials[idx]!,
        poNumber: row.poNumber ?? input.purchaseOrderRef ?? null,
        quantity: row.quantity,
        weightG: row.weightG,
        lengthMm: row.lengthMm,
        status: "available" as const,
        currentDispatchId: null,
        locationId,
        dieInstanceId,
        castId,
        salesOrderLineId,
        // Server-computed; a client value is never read (spec §E6).
        kgPer12ftMilli: kgPer12ftMilli(row),
        numberStyle: plantNumbers ? ("plant" as const) : ("legacy" as const),
        ageingRowId: ageingRow?.id ?? null,
        packedSalesOrderLineId: salesOrderLineId,
        partyNo: partyNos[idx]!,
        recut: Boolean(ageingRow && row.lengthMm < ageingRow.lengthMm),
        weightSource: weights[idx]!.weightSource,
        weightOverrideReason: weights[idx]!.weightOverrideReason,
        scaleReadingG: weights[idx]!.scaleReadingG,
        bisStandard: standard?.standard || null,
        cmlNo: standard?.cml || null,
        showLogo,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
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

      const rejectRows = rejects.map((r, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        groupId,
        ageingRowId: ageingRow?.id ?? null,
        dieId: input.dieId,
        pcs: r.pcs,
        weightG: r.weightG ?? null,
        reason: rejectReasonTexts[idx]!,
        createdBy: userId,
        createdAt: now,
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
        ageingBatchId: null,
        dieInstanceId,
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
                  ageingBatchId: sql<string | null>`null`.as("ageing_batch_id"),
                  dieInstanceId: sql<string | null>`${dieInstanceId}`.as("die_instance_id"),
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
      if (ageingRow) statements.push(...drawAgeingRowStatements(ctx.db, ctx.companyId, ageingRow.id, drawPcs));
      pushChunkedInserts(statements, (rows) => ctx.db.insert(bundleStatusEvent).values(rows), eventRows);
      // Pack = + bundle kg at its location, voucher = this receipt (spec §5).
      statements.push(
        ...packRows(
          { db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: now },
          { type: "pack", id: groupId },
          bundleRows,
        ),
      );
      if (rejectRows.length > 0) {
        pushChunkedInserts(statements, (rows) => ctx.db.insert(packReject).values(rows), rejectRows);
        if (plantScrap) {
          statements.push(
            ...plantScrapStreamStatements(ctx.db, ctx.companyId, { id: scrapStreamId, existing: existingStream !== null, userId, seq }),
          );
          for (const r of rejectRows) {
            if (!r.weightG) continue;
            // C10: weighed reject kg = + at plant scrap (PLANT-SCRAP stream), voucher = the reject row.
            statements.push(
              packRejectLedgerRow(ctx.db, {
                companyId: ctx.companyId,
                seq,
                rejectId: r.id,
                weightG: r.weightG,
                plantScrapId: plantScrap.id,
                streamId: scrapStreamId,
                userId,
                postedAt: now,
              }),
            );
          }
        }
      }
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
              dieInstanceId,
              castId,
              ageingRowId: ageingRow?.id ?? null,
              rejectPcs: rejects.reduce((s, r) => s + r.pcs, 0),
              typedWeights: weights.filter((w) => w.weightSource === "manual").length,
              ...(owner.grantId ? { dieOwnerOverride: owner.grantId } : {}),
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
        if (ageingRow && isPackAbort(e)) {
          const now2 = await readAgeingRow(ctx.db, ctx.companyId, ageingRow.id);
          throw new TRPCError({
            code: "CONFLICT",
            message: `Only ${now2.remaining} pieces left on this trolley row; this pack takes ${drawPcs}`,
          });
        }
        if (locationId && errorText(e).includes("FOREIGN KEY constraint failed")) {
          // Rolled back by the write-time yard guard: name the reason.
          await receiptLocation(ctx.db, ctx.companyId, locationId);
        }
        throw e;
      }

      return {
        success: true,
        groupId,
        code,
        bundleCount: bundleRows.length,
        bundles: bundleRows.map((b) => ({ id: b.id, serial: b.serial, partyNo: b.partyNo, kgPer12ftMilli: b.kgPer12ftMilli })),
        rejectCount: rejectRows.length,
      };
    }),

  /**
   * FP-PK-03: live kg per 12 ft and drift for one line on the pack screen, computed on the server
   * (clients never send derived numbers). Band and tone come from the one band rule (D15,
   * `lib/bundleBand.ts`): the copy's band when a copy is named, else the section's primary band.
   */
  previewLine: companyProcedure
    .input(
      z.object({
        dieId: z.string().min(1),
        dieInstanceId: z.string().min(1).max(64).optional(),
        lengthMm: z.number().int().positive().max(100_000),
        weightG: z.number().int().positive().max(10_000_000),
        pcs: z.number().int().positive().max(100_000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [section] = await ctx.db
        .select({ id: die.id, weightMinG: die.weightMinG, weightMaxG: die.weightMaxG, profileKind: die.profileKind })
        .from(die)
        .where(and(eq(die.id, input.dieId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
        .limit(1);
      if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      if (input.dieInstanceId) {
        const [copy] = await ctx.db
          .select({ sectionId: dieInstance.sectionId })
          .from(dieInstance)
          .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
          .limit(1);
        if (!copy || copy.sectionId !== section.id) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
      }
      const milli = kgPer12ftMilli({ weightG: input.weightG, quantity: input.pcs, lengthMm: input.lengthMm });
      // D15: the one band rule (lib/bundleBand.ts), the same verdict `/b`, the pack session and stock show.
      const v = await bundleBandTone(ctx.db, ctx.companyId, { dieId: section.id, dieInstanceId: input.dieInstanceId ?? null, kgPer12ftMilli: milli });
      return {
        kgPer12ftMilli: milli,
        /** Display only (the billed range text). Never colour from it: use `position` / `driftTone`. */
        range12ft: milli == null ? null : weightRange12ftFromMilli(milli),
        band: v.source ? { bandId: v.bandId, minG: v.minG!, maxG: v.maxG!, source: v.source } : null,
        position: v.position,
        driftTone: v.tone,
        driftPercentTenths: v.percentTenths,
      };
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
          /** Who packed the session ("Packed by"); null once that user is deleted. */
          createdByName: user.name,
          // Void bundles are out of every packed figure (plant ruling RP11, as Today); the left join
          // keeps a session whose bundles are all void in the list, at 0.
          bundleCount: sql<number>`count(case when ${bundle.status} <> 'void' then ${bundle.id} end)`.as(
            "bundle_count",
          ),
          totalQuantity: sql<number>`coalesce(sum(case when ${bundle.status} <> 'void' then ${bundle.quantity} end), 0)`.as(
            "total_quantity",
          ),
          totalWeightG: sql<number>`coalesce(sum(case when ${bundle.status} <> 'void' then ${bundle.weightG} end), 0)`.as(
            "total_weight_g",
          ),
          totalLengthMm: sql<number>`coalesce(sum(case when ${bundle.status} <> 'void' then ${bundle.lengthMm} end), 0)`.as(
            "total_length_mm",
          ),
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
        .leftJoin(user, eq(user.id, bundleGroup.createdBy))
        .where(and(...conditions))
        .groupBy(bundleGroup.id, die.series, die.sectionCode, user.name)
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

      // "Packed by" on the session page; null once that user is deleted.
      const packer = group.createdBy
        ? await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, group.createdBy)).get()
        : undefined;

      // The session's packed figures leave void bundles out (RP11); the list above still has them.
      const totals = { bundles: 0, pieces: 0, weightG: 0 };
      for (const b of bundles) {
        if (b.status === "void") continue;
        totals.bundles += 1;
        totals.pieces += b.quantity;
        totals.weightG += b.weightG;
      }


      // D15: each bundle's band verdict, the same one `/b/$serial` shows.
      const bands = await bundleBandTones(
        ctx.db,
        ctx.companyId,
        bundles.map((b) => ({ dieId: b.dieId, dieInstanceId: b.dieInstanceId, kgPer12ftMilli: b.kgPer12ftMilli ?? kgPer12ftMilli(b) })),
      );
      return {
        group,
        die: dieRow ?? null,
        bundles: bundles.map((b, i) => ({ ...b, band: bands[i]! })),
        totals,
        packedByName: packer?.name ?? null,
      };
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
          dieInstanceId: bundle.dieInstanceId,
          kgPer12ftMilli: bundle.kgPer12ftMilli,
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

      // D15: the stock Bundles list shows the same band verdict as `/b/$serial`.
      const bands = await bundleBandTones(
        ctx.db,
        ctx.companyId,
        items.map((b) => ({ dieId: b.dieId, dieInstanceId: b.dieInstanceId, kgPer12ftMilli: b.kgPer12ftMilli ?? kgPer12ftMilli(b) })),
      );
      return { items: items.map((b, i) => ({ ...b, band: bands[i]! })), total: totalRow[0]?.count ?? 0 };
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

      // D6: a bundle packed from a trolley row gives its pieces back on void (seam until ageing ships).
      const ageingRestore =
        existing.ageingRowId && (await ageingTablesExist(ctx.db))
          ? restoreAgeingRowStatements(ctx.db, {
              companyId: ctx.companyId,
              bundleId: existing.id,
              ageingRowId: existing.ageingRowId,
              seq,
              to: input.toStatus === "void" ? "void" : "available",
            })
          : [];

      // D17: voiding a held bundle releases its hold (audited `order.release`, reason `voided`).
      const voiding = input.toStatus === "void";
      const holdRelease = voiding
        ? await releaseOnVoidStatements(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            existing.id,
            and(eq(bundle.companyId, ctx.companyId), eq(bundle.id, existing.id), eq(bundle.status, "void"), eq(bundle.serverSeq, seq)),
          )
        : [];

      await atomicBatch(ctx.db, [
        ctx.db
          .update(bundle)
          .set({ status: input.toStatus, serverSeq: seq, ...(voiding ? { heldForLineId: null, heldAt: null } : {}) })
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
        ...ageingRestore,
        ...holdRelease,
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
        /** Same id, same rows: a resend answers `replayed` instead of adding the bundles twice (lib/importReplay). */
        clientRequestId: clientRequestIdSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 0. A chunk sent again (lost reply, same sheet picked again) must never add its bundles twice.
      const rowIds = input.clientRequestId
        ? await requestRowIds(ctx.companyId, "bundle.import", input.clientRequestId, input.rows.length)
        : null;
      const landed = async (ids: string[]) =>
        replayState(
          ids,
          (
            await ctx.db
              .select({ id: bundle.id })
              .from(bundle)
              .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, replayProbe(ids))))
          ).map((r) => r.id),
        );
      const replayed = {
        success: true,
        replayed: true,
        bundleCount: input.rows.length,
        dieCount: 0,
        newDies: 0,
        newGroups: 0,
        reusedGroups: 0,
      } as const;
      if (rowIds) {
        const state = await landed(rowIds);
        if (state === "replayed") return replayed;
        if (state === "conflict") throw new TRPCError(REQUEST_ID_CONFLICT);
      }

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
            .join(", ")}${archivedKeys.length > 5 ? ` (+${archivedKeys.length - 5} more)` : ""}. Bundles can't be imported into a deleted die; remove those rows (bundle.importCheck lists them).`,
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

      for (const [rowIndex, row] of input.rows.entries()) {
        const dieRow = dieKeyToId.get(`${row.dieSeries}::${row.dieSectionCode}`)!;
        const group = dieIdToGroup.get(dieRow.id)!;
        const idx = groupIdToNextIdx.get(group.id)!;
        groupIdToNextIdx.set(group.id, idx + 1);

        const bundleId = rowIds?.[rowIndex] ?? crypto.randomUUID();
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

      try {
        await atomicBatch(ctx.db, statements);
      } catch (error) {
        // An identical request that landed a moment earlier: its bundle ids are taken, so this
        // whole batch rolled back. Answer as a replay; anything else is a real failure.
        if (rowIds && (await landed(rowIds)) === "replayed") return replayed;
        throw error;
      }

      return {
        success: true,
        replayed: false,
        bundleCount: bundleRows.length,
        dieCount: dieKeyToId.size,
        newDies: newDieIds.length,
        newGroups: newGroups.length,
        reusedGroups: existingDieIdsAppendedTo.length,
      };
    }),

  /**
   * Read-only check before an old-bundles sheet is saved: which of its dies
   * (series, section code) were deleted. `bulkImport` refuses a whole chunk
   * that names one, so the sheet turns those rows into problem rows first
   * instead of stopping part-way (T25 fix round 1).
   */
  importCheck: actionProcedure("bundle.import")
    .input(
      z.object({
        dies: z
          .array(z.object({ series: z.string().min(1).max(500), sectionCode: z.string().min(1).max(500) }))
          .min(1, "At least one die is required")
          .max(2000, "Max 2000 dies per check"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = (d: { series: string; sectionCode: string }) => `${d.series}\u0000${d.sectionCode}`;
      const codes = [...new Set(input.dies.map((d) => d.sectionCode))];
      const deleted = await mapInChunks(codes, (slice) =>
        ctx.db
          .select({ series: die.series, sectionCode: die.sectionCode })
          .from(die)
          .where(and(eq(die.companyId, ctx.companyId), isNotNull(die.deletedAt), inArray(die.sectionCode, slice))),
      );
      const asked = new Set(input.dies.map(key));
      return { deleted: deleted.filter((d) => asked.has(key(d))) };
    }),
});
