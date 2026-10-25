/**
 * Scrap purchase (spec P14, §5; digest Stages 1-2): scrap items and grades, purchase lots with
 * party vs FC kanta, debit/credit notes with manager approval, the purchase register and scrap
 * stock.
 *
 * - A lot moves booking → unload → ok (booking → ok is allowed for entries made after the fact).
 *   OK posts + scrap (item+grade) at the scrap store: FC kg minus the bori of D/C notes approved
 *   so far, in the same batch as the lot UPDATE and the audit row.
 * - Review Focus 2: OK is refused when FC kg is short of party kg beyond the company tolerance
 *   (`settings.dcTolerancePct`, basis points, default 50) unless the lot's debit notes on the
 *   weight that are pending or approved cover the shortfall beyond tolerance (ruling RP8). The rule
 *   is part of the UPDATE's WHERE, so a note rejected or a weight corrected after the request read
 *   the lot still cannot let a short lot through.
 * - A D/C note opens an approval (kind dc_note); `approval.decide` applies it (lib/approvalApply):
 *   approved bori comes off the stock (now if the lot is OK, else at OK) and off the payable kg.
 * - Cancelling an OK lot (masters.publish) writes reversal rows for every posting of the lot,
 *   refused if the item+grade at that store no longer holds what the lot put there.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  billBooks,
  dcNote,
  dcNoteReasons,
  dcNoteStatuses,
  dcNoteTypes,
  purchaseLot,
  purchaseLotStatuses,
  scrapGrade,
  scrapItem,
  vendor,
  type PurchaseLotRow,
} from "@orrn/db/schema/purchase";
import { location, stockLedger } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { boriMeltedMessage, lotRemaining, lotRemainingSql, OUTER_LOT_ID } from "../lib/foundry";
import { lotCancelLeavesStockNonNegative, lotCancelRows, lotOkRows } from "../lib/ledger";
import { can } from "../lib/permissions";
import {
  bookDateInstant,
  companyToday,
  dcToleranceBp,
  DEFAULT_SCRAP_GRADES,
  DEFAULT_SCRAP_ITEMS,
  isIsoDate,
  isShortBeyondTolerance,
  nameKey,
  parseScrapItemRef,
  toleranceG,
} from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";
import { purchaseReader } from "./vendor";

const LOT_NOT_FOUND = { code: "NOT_FOUND", message: "Lot not found" } as const;

/**
 * Up to 100 t in grams: beyond any truck. With rates capped at ₹10,000/kg (1e6 paise) every
 * amount (≤ 1e8 g × 1e6 paise / 1000 = 1e11) and every product in the register (party × rate ≤
 * 1e14) stays far below 2^53.
 */
const MAX_LOT_G = 100_000_000;
const MAX_RATE_PAISE = 1_000_000;
const grams = z.number().int().min(0).max(MAX_LOT_G);
const positiveGrams = z.number().int().min(1).max(MAX_LOT_G);
const isoDate = z.string().refine(isIsoDate, "Use a date like 2026-10-03");
const bp = z.number().int().min(0).max(10_000);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const gradeCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9+-]{1,8}$/, "Grade like A+, A, B, C")
  .transform((s) => s.toUpperCase());
const photoUrls = z.array(z.string().trim().url().max(500)).max(10);

type Ctx = { db: OrrnDb; companyId: string };

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

const kg = (g: number) => (g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const pct = (b: number) => `${(b / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} %`;

async function companySettings(ctx: Ctx): Promise<Record<string, unknown>> {
  const [row] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
  return row?.settings ?? {};
}

async function loadLot(ctx: Ctx, id: string): Promise<PurchaseLotRow> {
  const [row] = await ctx.db
    .select()
    .from(purchaseLot)
    .where(and(eq(purchaseLot.id, id), eq(purchaseLot.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(LOT_NOT_FOUND);
  return row;
}

async function liveVendor(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ id: vendor.id, name: vendor.name, status: vendor.status })
    .from(vendor)
    .where(and(eq(vendor.id, id), eq(vendor.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
  if (row.status !== "draft" && row.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: row.status === "merged" ? "This vendor was merged into another one; pick that one" : "This vendor is archived",
    });
  }
  return row;
}

async function activeItem(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ id: scrapItem.id, name: scrapItem.name, active: scrapItem.active })
    .from(scrapItem)
    .where(and(eq(scrapItem.id, id), eq(scrapItem.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Scrap item not found" });
  if (!row.active) throw new TRPCError({ code: "BAD_REQUEST", message: `${row.name} is no longer bought` });
  return row;
}

/** Grade by code ("a+" → "A+") or id, active only. */
async function activeGrade(ctx: Ctx, codeOrId: string) {
  const code = codeOrId.trim().toUpperCase();
  const [row] = await ctx.db
    .select({ id: scrapGrade.id, code: scrapGrade.code, active: scrapGrade.active })
    .from(scrapGrade)
    .where(and(eq(scrapGrade.companyId, ctx.companyId), sql`(${scrapGrade.code} = ${code} or ${scrapGrade.id} = ${codeOrId})`))
    .limit(1);
  if (!row || !row.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown grade ${codeOrId}` });
  return row;
}

/** The book date may be today or earlier (one day of slack for clocks and late-night entries). */
function checkBookDate(settings: Record<string, unknown>, date: string) {
  const latest = companyToday(settings, new Date(clockNow().getTime() + 86_400_000));
  if (date > latest) throw new TRPCError({ code: "BAD_REQUEST", message: "The lot date is in the future" });
}

/**
 * SQL over the outer `purchase_lot` row: total kg diff of its live weight debit notes (pending or
 * approved, type debit, reason weight).
 */
function lotLiveWeightNoteKg(): SQL {
  const lot = (c: string) => sql`${sql.identifier("purchase_lot")}.${sql.identifier(c)}`;
  return sql`coalesce((select sum(n.kg_diff_g) from ${dcNote} n where n.company_id = ${lot("company_id")} and n.lot_id = ${lot("id")}
    and n.type = 'debit' and n.reason = 'weight' and n.status in ('pending', 'approved')), 0)`;
}

/**
 * SQL over the outer `purchase_lot` row (Review Focus 2, ruling RP8): FC kg is within tolerance of
 * party kg, or the live weight notes cover the shortfall beyond tolerance:
 * Σ kg diff ≥ (party − FC) − floor(party × bp / 10 000). SQLite integer division floors positive
 * integers, the same as `toleranceG`.
 */
function lotMayBeOk(toleranceBp: number): SQL {
  const lot = (c: string) => sql`${sql.identifier("purchase_lot")}.${sql.identifier(c)}`;
  const bp = sql`cast(${toleranceBp} as integer)`;
  // floor(party × bp / 10 000) in integers even if D1 binds the parameter as a REAL.
  const tolG = sql`cast((${lot("party_kg_g")} * ${bp}) / 10000 as integer)`;
  return sql`(${lot("fc_kg_g")} is not null and ${lot("fc_kg_g")} > 0
    and ${lot("fc_kg_g")} - ${lotBoriG(["approved"])} > 0
    and (
      (${lot("party_kg_g")} - ${lot("fc_kg_g")}) * 10000 <= ${lot("party_kg_g")} * ${bp}
      or ${lotLiveWeightNoteKg()} >= (${lot("party_kg_g")} - ${lot("fc_kg_g")}) - ${tolG}
    ))`;
}

/** SQL over the outer `purchase_lot` row: bori of its notes with the given statuses. */
function lotBoriG(statuses: ("pending" | "approved")[]): SQL {
  const lot = (c: string) => sql`${sql.identifier("purchase_lot")}.${sql.identifier(c)}`;
  const list = sql.join(
    statuses.map((st) => sql`${st}`),
    sql`, `,
  );
  return sql`coalesce((select sum(n.bori_deduction_g) from ${dcNote} n where n.company_id = ${lot("company_id")} and n.lot_id = ${lot("id")}
    and n.status in (${list})), 0)`;
}

/** Kg diff a weight note must cover for the lot to go OK: shortfall beyond tolerance (0 if none). */
function uncoveredShortG(partyKgG: number, fcKgG: number, toleranceBp: number): number {
  if (!isShortBeyondTolerance(partyKgG, fcKgG, toleranceBp)) return 0;
  return partyKgG - fcKgG - toleranceG(partyKgG, toleranceBp);
}

/** Total kg diff of the lot's live weight debit notes (pending or approved). */
async function liveWeightNoteKg(ctx: Ctx, lotId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ g: sql<number>`coalesce(sum(${dcNote.kgDiffG}), 0)` })
    .from(dcNote)
    .where(
      and(
        eq(dcNote.companyId, ctx.companyId),
        eq(dcNote.lotId, lotId),
        eq(dcNote.type, "debit"),
        eq(dcNote.reason, "weight"),
        inArray(dcNote.status, ["pending", "approved"]),
      ),
    );
  return Number(row?.g ?? 0);
}

/**
 * The lot has a live note (pending or approved) raised on its weights: a weight debit note, or any
 * note with a bori deduction. Party and FC kg are then locked.
 */
async function hasWeightLockingNote(ctx: Ctx, lotId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: dcNote.id })
    .from(dcNote)
    .where(
      and(
        eq(dcNote.companyId, ctx.companyId),
        eq(dcNote.lotId, lotId),
        inArray(dcNote.status, ["pending", "approved"]),
        sql`((${dcNote.type} = 'debit' and ${dcNote.reason} = 'weight') or ${dcNote.boriDeductionG} > 0)`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** SQL over the outer `purchase_lot` row: the write-time form of `hasWeightLockingNote`. */
function lotHasWeightLockingNote(): SQL {
  const lot = (c: string) => sql`${sql.identifier("purchase_lot")}.${sql.identifier(c)}`;
  return sql`exists (select 1 from ${dcNote} n where n.company_id = ${lot("company_id")} and n.lot_id = ${lot("id")}
    and n.status in ('pending', 'approved') and ((n.type = 'debit' and n.reason = 'weight') or n.bori_deduction_g > 0))`;
}

function auditCtx(ctx: {
  db: OrrnDb;
  companyId: string;
  session: Parameters<typeof auditInsertGuarded>[0]["session"];
  impersonation: Parameters<typeof auditInsertGuarded>[0]["impersonation"];
}) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

// ---------------------------------------------------------------------------
// Scrap masters
// ---------------------------------------------------------------------------

const scrapItemsRouter = router({
  /** Every scrap item (active and retired), in book order. Any member may read (the foundry charges by item). */
  list: companyProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(scrapItem)
      .where(eq(scrapItem.companyId, ctx.companyId))
      .orderBy(asc(scrapItem.sortOrder), asc(scrapItem.name))
      .limit(500);
    return { items };
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        name: z.string().trim().min(1).max(80).refine((s) => nameKey(s).length > 0, "Name needs letters or digits"),
        expectedRecoveryBp: bp.nullable().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(scrapItem).values({
            id,
            companyId: ctx.companyId,
            serverSeq: seq,
            name: input.name,
            nameKey: nameKey(input.name),
            expectedRecoveryBp: input.expectedRecoveryBp ?? null,
            sortOrder: input.sortOrder ?? 0,
            createdBy: ctx.session.user.id,
          }),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "scrap_item.create", subjectType: "scrap_item", subjectId: id, meta: { name: input.name } },
            { from: scrapItem, where: eq(scrapItem.id, id) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: scrap_item/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That scrap item already exists" });
        }
        throw e;
      }
      return { id };
    }),

  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80).refine((s) => nameKey(s).length > 0).optional(),
        expectedRecoveryBp: bp.nullable().optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(scrapItem)
        .where(and(eq(scrapItem.id, input.id), eq(scrapItem.companyId, ctx.companyId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Scrap item not found" });
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof scrapItem.$inferInsert
      >;
      if (input.name !== undefined) patch.nameKey = nameKey(input.name);
      if (Object.keys(patch).length === 0) return { success: true };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(scrapItem)
            .set({ ...patch, serverSeq: seq })
            .where(and(eq(scrapItem.id, existing.id), eq(scrapItem.companyId, ctx.companyId))),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "scrap_item.update", subjectType: "scrap_item", subjectId: existing.id, meta: { patch } },
            { from: scrapItem, where: and(eq(scrapItem.id, existing.id), eq(scrapItem.serverSeq, seq)) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: scrap_item/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That scrap item already exists" });
        }
        throw e;
      }
      return { success: true };
    }),
});

const scrapGradesRouter = router({
  /** The grade ladder, best first. Any member may read. */
  list: companyProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(scrapGrade)
      .where(eq(scrapGrade.companyId, ctx.companyId))
      .orderBy(asc(scrapGrade.sortOrder), asc(scrapGrade.code))
      .limit(100);
    return { items };
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        code: gradeCode,
        name: optText(80),
        expectedRecoveryBp: bp.nullable().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(scrapGrade).values({
            id,
            companyId: ctx.companyId,
            serverSeq: seq,
            code: input.code,
            name: input.name ?? null,
            expectedRecoveryBp: input.expectedRecoveryBp ?? null,
            sortOrder: input.sortOrder ?? 0,
            createdBy: ctx.session.user.id,
          }),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "scrap_grade.create", subjectType: "scrap_grade", subjectId: id, meta: { code: input.code } },
            { from: scrapGrade, where: eq(scrapGrade.id, id) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: scrap_grade/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That grade already exists" });
        }
        throw e;
      }
      return { id };
    }),

  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id: z.string().min(1),
        name: optText(80),
        expectedRecoveryBp: bp.nullable().optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(scrapGrade)
        .where(and(eq(scrapGrade.id, input.id), eq(scrapGrade.companyId, ctx.companyId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Grade not found" });
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof scrapGrade.$inferInsert
      >;
      if (Object.keys(patch).length === 0) return { success: true };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(scrapGrade)
          .set({ ...patch, serverSeq: seq })
          .where(and(eq(scrapGrade.id, existing.id), eq(scrapGrade.companyId, ctx.companyId))),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "scrap_grade.update", subjectType: "scrap_grade", subjectId: existing.id, meta: { patch } },
          { from: scrapGrade, where: and(eq(scrapGrade.id, existing.id), eq(scrapGrade.serverSeq, seq)) },
        ),
      ]);
      return { success: true };
    }),
});

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

const lotFields = {
  origin: optText(80),
  drossBp: bp.nullable().optional(),
  partyBillNo: optText(60),
  vehicleNo: optText(20),
  photoUrls: photoUrls.optional(),
  notes: optText(500),
};

/** Lot rows with their vendor, item, grade and location names (company-scoped joins). */
function lotSelect(db: OrrnDb) {
  return db
    .select({
      id: purchaseLot.id,
      number: purchaseLot.number,
      period: purchaseLot.period,
      lotDate: purchaseLot.lotDate,
      vendorId: purchaseLot.vendorId,
      vendorName: vendor.name,
      origin: purchaseLot.origin,
      scrapItemId: purchaseLot.scrapItemId,
      itemName: scrapItem.name,
      scrapGradeId: purchaseLot.scrapGradeId,
      gradeCode: scrapGrade.code,
      partyKgG: purchaseLot.partyKgG,
      fcKgG: purchaseLot.fcKgG,
      ratePaise: purchaseLot.ratePaise,
      drossBp: purchaseLot.drossBp,
      billBook: purchaseLot.billBook,
      partyBillNo: purchaseLot.partyBillNo,
      vehicleNo: purchaseLot.vehicleNo,
      photoUrls: purchaseLot.photoUrls,
      status: purchaseLot.status,
      locationId: purchaseLot.locationId,
      locationCode: location.code,
      okAt: purchaseLot.okAt,
      cancelledAt: purchaseLot.cancelledAt,
      cancelReason: purchaseLot.cancelReason,
      notes: purchaseLot.notes,
      createdAt: purchaseLot.createdAt,
    })
    .from(purchaseLot)
    .innerJoin(vendor, and(eq(vendor.id, purchaseLot.vendorId), eq(vendor.companyId, purchaseLot.companyId)))
    .innerJoin(scrapItem, and(eq(scrapItem.id, purchaseLot.scrapItemId), eq(scrapItem.companyId, purchaseLot.companyId)))
    .innerJoin(scrapGrade, and(eq(scrapGrade.id, purchaseLot.scrapGradeId), eq(scrapGrade.companyId, purchaseLot.companyId)))
    .leftJoin(location, and(eq(location.id, purchaseLot.locationId), eq(location.companyId, purchaseLot.companyId)))
    .$dynamic();
}

type NoteForMath = {
  type: "debit" | "credit";
  reason: "weight" | "grade";
  status: "pending" | "approved" | "rejected";
  kgDiffG: number;
  boriDeductionG: number;
  amountPaise: number;
};

/**
 * The register's per-lot arithmetic. Approved notes only count:
 * payable kg = party − debit (kg diff + bori) + credit kg diff;
 * amount = party × rate − debit amounts + credit amounts;
 * stock = FC − approved bori (OK lots only).
 */
function lotMath(
  lot: { partyKgG: number; fcKgG: number | null; ratePaise: number; status: string },
  notes: NoteForMath[],
  tolBp: number,
) {
  const approved = notes.filter((n) => n.status === "approved");
  const debitKgG = approved.filter((n) => n.type === "debit").reduce((s, n) => s + n.kgDiffG + n.boriDeductionG, 0);
  const creditKgG = approved.filter((n) => n.type === "credit").reduce((s, n) => s + n.kgDiffG, 0);
  const boriG = approved.reduce((s, n) => s + n.boriDeductionG, 0);
  const debitPaise = approved.filter((n) => n.type === "debit").reduce((s, n) => s + n.amountPaise, 0);
  const creditPaise = approved.filter((n) => n.type === "credit").reduce((s, n) => s + n.amountPaise, 0);
  const shortG = lot.fcKgG === null ? null : lot.partyKgG - lot.fcKgG;
  const shortBeyondTolerance = isShortBeyondTolerance(lot.partyKgG, lot.fcKgG, tolBp);
  const liveWeight = notes.filter(
    (n) => n.type === "debit" && n.reason === "weight" && (n.status === "pending" || n.status === "approved"),
  );
  const hasWeightNote = liveWeight.length > 0;
  const weightNoteKgG = liveWeight.reduce((s, n) => s + n.kgDiffG, 0);
  // RP8: the live weight notes must cover the shortfall beyond tolerance.
  const uncoveredG = lot.fcKgG === null ? 0 : uncoveredShortG(lot.partyKgG, lot.fcKgG, tolBp);
  const noteCoversShort = weightNoteKgG >= uncoveredG;
  const pending = notes.some((n) => n.status === "pending");
  const flag: "short_without_note" | "note_pending" | null =
    lot.status !== "cancelled" && shortBeyondTolerance && !noteCoversShort ? "short_without_note" : pending ? "note_pending" : null;
  return {
    shortG,
    toleranceG: toleranceG(lot.partyKgG, tolBp),
    shortBeyondTolerance,
    hasWeightNote,
    weightNoteKgG,
    noteCoversShort,
    flag,
    debitKgG,
    creditKgG,
    boriG,
    payableKgG: lot.partyKgG - debitKgG + creditKgG,
    amountPaise: Math.round((lot.partyKgG * lot.ratePaise) / 1000) - debitPaise + creditPaise,
    stockKgG: lot.status === "ok" && lot.fcKgG !== null ? lot.fcKgG - boriG : null,
  };
}

async function notesForLots(ctx: Ctx, lotIds: string[]) {
  return mapInChunks(
    lotIds,
    (ids) =>
      ctx.db
        .select({
          id: dcNote.id,
          number: dcNote.number,
          lotId: dcNote.lotId,
          type: dcNote.type,
          reason: dcNote.reason,
          kgDiffG: dcNote.kgDiffG,
          boriDeductionG: dcNote.boriDeductionG,
          amountPaise: dcNote.amountPaise,
          toleranceBp: dcNote.toleranceBp,
          note: dcNote.note,
          status: dcNote.status,
          approvalId: dcNote.approvalId,
          decidedAt: dcNote.decidedAt,
          createdAt: dcNote.createdAt,
        })
        .from(dcNote)
        .where(and(eq(dcNote.companyId, ctx.companyId), inArray(dcNote.lotId, ids)))
        .orderBy(asc(dcNote.createdAt)),
    80,
  );
}

/** Pick the scrap store for an OK: the given one, else the company's only active scrap store. */
async function scrapStoreFor(ctx: Ctx, locationId: string | undefined) {
  const rows = await ctx.db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(
      and(
        eq(location.companyId, ctx.companyId),
        eq(location.kind, "scrap_store"),
        eq(location.active, true),
        locationId ? eq(location.id, locationId) : undefined,
      ),
    )
    .limit(5);
  if (locationId) {
    if (!rows[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "That is not an active scrap store" });
    return rows[0];
  }
  if (rows.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Add the scrap yard location first (Stock → Locations)" });
  }
  if (rows.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick which scrap store the lot goes to" });
  return rows[0]!;
}

const lotsRouter = router({
  list: purchaseReader
    .input(
      z
        .object({
          status: z.enum(purchaseLotStatuses).optional(),
          vendorId: z.string().min(1).optional(),
          from: isoDate.optional(),
          to: isoDate.optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(purchaseLot.companyId, ctx.companyId),
        input.status ? eq(purchaseLot.status, input.status) : undefined,
        input.vendorId ? eq(purchaseLot.vendorId, input.vendorId) : undefined,
        input.from ? gte(purchaseLot.lotDate, input.from) : undefined,
        input.to ? lte(purchaseLot.lotDate, input.to) : undefined,
      );
      const [items, [totalRow]] = await Promise.all([
        lotSelect(ctx.db)
          .where(where)
          .orderBy(desc(purchaseLot.lotDate), desc(purchaseLot.createdAt), desc(purchaseLot.id))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(purchaseLot).where(where),
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /** A lot with its notes, their approvals, its scrap postings and the D/C rule's numbers. */
  get: purchaseReader.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const [lot] = await lotSelect(ctx.db)
      .where(and(eq(purchaseLot.id, input.id), eq(purchaseLot.companyId, ctx.companyId)))
      .limit(1);
    if (!lot) throw new TRPCError(LOT_NOT_FOUND);
    const [notes, settings] = await Promise.all([notesForLots(ctx, [lot.id]), companySettings(ctx)]);
    const noteIds = notes.map((n) => n.id);
    const ledger = await ctx.db
      .select()
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.companyId, ctx.companyId),
          eq(stockLedger.itemKind, "scrap_grade"),
          sql`((${stockLedger.voucherType} in ('purchase_lot', 'purchase_lot_cancel') and ${stockLedger.voucherId} = ${lot.id})${
            noteIds.length > 0
              ? sql` or (${stockLedger.voucherType} = 'dc_note' and ${inArray(stockLedger.voucherId, noteIds.slice(0, 50))})`
              : sql``
          })`,
        ),
      )
      .orderBy(asc(stockLedger.postedAt), asc(stockLedger.line));
    const tolBp = dcToleranceBp(settings);
    return { lot, notes, ledger, toleranceBp: tolBp, ...lotMath(lot, notes, tolBp) };
  }),

  /**
   * A truck at the kanta (purchase.receipt): starts as `booking`. FC kg may follow later (update)
   * but must be in before OK. The vendor may be a draft (created inline); merged and archived
   * vendors, retired items and unknown grades are refused.
   */
  create: actionProcedure("purchase.receipt")
    .input(
      z.object({
        vendorId: z.string().min(1),
        date: isoDate.optional(),
        itemId: z.string().min(1),
        grade: z.string().trim().min(1).max(64),
        partyKgG: positiveGrams,
        fcKgG: positiveGrams.nullable().optional(),
        ratePaise: z.number().int().min(1).max(MAX_RATE_PAISE),
        billBook: z.enum(billBooks).default("main"),
        ...lotFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await companySettings(ctx);
      const date = input.date ?? companyToday(settings, clockNow());
      checkBookDate(settings, date);
      await liveVendor(ctx, input.vendorId);
      await activeItem(ctx, input.itemId);
      const grade = await activeGrade(ctx, input.grade);

      const userId = ctx.session.user.id;
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "lot", bookDateInstant(date), userId);
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow().getTime();
      const v = (c: string) => sql`${sql.identifier("vendor")}.${sql.identifier(c)}`;
      await atomicBatch(ctx.db, [
        // INSERT … SELECT: vendor still live, item and grade still active at write time.
        ctx.db.insert(purchaseLot).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${v("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              number: sql<string>`${doc.number}`.as("number"),
              period: sql<string>`${doc.period}`.as("period"),
              vendorId: sql<string>`${v("id")}`.as("vendor_id"),
              lotDate: sql<string>`${date}`.as("lot_date"),
              origin: sql<string | null>`${input.origin ?? null}`.as("origin"),
              scrapItemId: sql<string>`${input.itemId}`.as("scrap_item_id"),
              scrapGradeId: sql<string>`${grade.id}`.as("scrap_grade_id"),
              partyKgG: sql<number>`${input.partyKgG}`.as("party_kg_g"),
              fcKgG: sql<number | null>`${input.fcKgG ?? null}`.as("fc_kg_g"),
              ratePaise: sql<number>`${input.ratePaise}`.as("rate_paise"),
              drossBp: sql<number | null>`${input.drossBp ?? null}`.as("dross_bp"),
              billBook: sql<string>`${input.billBook}`.as("bill_book"),
              partyBillNo: sql<string | null>`${input.partyBillNo ?? null}`.as("party_bill_no"),
              vehicleNo: sql<string | null>`${input.vehicleNo ?? null}`.as("vehicle_no"),
              photoUrls: sql<string>`${JSON.stringify(input.photoUrls ?? [])}`.as("photo_urls"),
              status: sql<string>`'booking'`.as("status"),
              locationId: sql<string | null>`null`.as("location_id"),
              okAt: sql<number | null>`null`.as("ok_at"),
              okBy: sql<string | null>`null`.as("ok_by"),
              cancelledAt: sql<number | null>`null`.as("cancelled_at"),
              cancelledBy: sql<string | null>`null`.as("cancelled_by"),
              cancelReason: sql<string | null>`null`.as("cancel_reason"),
              notes: sql<string | null>`${input.notes ?? null}`.as("notes"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at}`.as("created_at"),
              updatedAt: sql<number>`${at}`.as("updated_at"),
            })
            .from(vendor)
            .where(
              and(
                eq(vendor.id, input.vendorId),
                eq(vendor.companyId, ctx.companyId),
                inArray(vendor.status, ["draft", "active"]),
                sql`exists (select 1 from ${scrapItem} i where i.id = ${input.itemId} and i.company_id = ${ctx.companyId} and i.active = 1)`,
                sql`exists (select 1 from ${scrapGrade} g where g.id = ${grade.id} and g.company_id = ${ctx.companyId} and g.active = 1)`,
              ),
            ),
        ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "purchase_lot.create",
            subjectType: "purchase_lot",
            subjectId: id,
            meta: {
              number: doc.number,
              vendorId: input.vendorId,
              partyKgG: input.partyKgG,
              fcKgG: input.fcKgG ?? null,
              ratePaise: input.ratePaise,
              billBook: input.billBook,
            },
          },
          { from: purchaseLot, where: and(eq(purchaseLot.id, id), eq(purchaseLot.serverSeq, seq)) },
        ),
      ]);
      const [landed] = await ctx.db
        .select({ id: purchaseLot.id })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.id, id), eq(purchaseLot.companyId, ctx.companyId)))
        .limit(1);
      if (!landed) throw new TRPCError({ code: "BAD_REQUEST", message: "The vendor, item or grade changed; try again" });
      return { id, number: doc.number, status: "booking" as const };
    }),

  /**
   * Edit a lot (purchase.receipt). Before OK everything but the number may change; weights are
   * locked while a weight note is pending or approved (the note was raised on them). After OK the
   * stock fields (item, grade, party and FC kg) are locked — cancel and re-enter instead — while
   * rate, bill no, dross, vehicle, photos and notes stay editable. Cancelled lots are frozen.
   */
  update: actionProcedure("purchase.receipt")
    .input(
      z.object({
        id: z.string().min(1),
        vendorId: z.string().min(1).optional(),
        date: isoDate.optional(),
        itemId: z.string().min(1).optional(),
        grade: z.string().trim().min(1).max(64).optional(),
        partyKgG: positiveGrams.optional(),
        fcKgG: positiveGrams.nullable().optional(),
        ratePaise: z.number().int().min(1).max(MAX_RATE_PAISE).optional(),
        billBook: z.enum(billBooks).optional(),
        ...lotFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lot = await loadLot(ctx, input.id);
      if (lot.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This lot is cancelled" });
      const patch: Partial<typeof purchaseLot.$inferInsert> = {};
      const gradeId = input.grade !== undefined ? (await activeGrade(ctx, input.grade)).id : undefined;
      if (input.itemId !== undefined && input.itemId !== lot.scrapItemId) {
        await activeItem(ctx, input.itemId);
        patch.scrapItemId = input.itemId;
      }
      if (gradeId !== undefined && gradeId !== lot.scrapGradeId) patch.scrapGradeId = gradeId;
      if (input.partyKgG !== undefined && input.partyKgG !== lot.partyKgG) patch.partyKgG = input.partyKgG;
      if (input.fcKgG !== undefined && input.fcKgG !== lot.fcKgG) patch.fcKgG = input.fcKgG;
      const stockChange = ["scrapItemId", "scrapGradeId", "partyKgG", "fcKgG"].some((k) => k in patch);
      const weightChange = "partyKgG" in patch || "fcKgG" in patch;
      if (stockChange && lot.status === "ok") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This lot is OK and in stock; its item, grade and weights are locked (cancel and re-enter it)",
        });
      }
      if (weightChange && (await hasWeightLockingNote(ctx, lot.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A D/C note on the weight or with a bori deduction is open for this lot; the weights are locked",
        });
      }
      if (input.vendorId !== undefined && input.vendorId !== lot.vendorId) {
        await liveVendor(ctx, input.vendorId);
        patch.vendorId = input.vendorId;
      }
      if (input.date !== undefined && input.date !== lot.lotDate) {
        checkBookDate(await companySettings(ctx), input.date);
        patch.lotDate = input.date;
      }
      for (const k of ["ratePaise", "billBook", "origin", "drossBp", "partyBillNo", "vehicleNo", "photoUrls", "notes"] as const) {
        if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
      }
      if (Object.keys(patch).length === 0) return { success: true };

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const where = and(
        eq(purchaseLot.id, lot.id),
        eq(purchaseLot.companyId, ctx.companyId),
        stockChange ? inArray(purchaseLot.status, ["booking", "unload"]) : ne(purchaseLot.status, "cancelled"),
        weightChange ? sql`not ${lotHasWeightLockingNote()}` : undefined,
        patch.vendorId
          ? sql`exists (select 1 from ${vendor} v where v.id = ${patch.vendorId} and v.company_id = ${ctx.companyId} and v.status in ('draft', 'active'))`
          : undefined,
      );
      await atomicBatch(ctx.db, [
        ctx.db
          .update(purchaseLot)
          .set({ ...patch, serverSeq: seq })
          .where(where),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "purchase_lot.update",
            subjectType: "purchase_lot",
            subjectId: lot.id,
            meta: {
              number: lot.number,
              before: Object.fromEntries(Object.keys(patch).map((k) => [k, lot[k as keyof PurchaseLotRow] ?? null])),
              patch,
            },
          },
          { from: purchaseLot, where: and(eq(purchaseLot.id, lot.id), eq(purchaseLot.serverSeq, seq)) },
        ),
      ]);
      const [landed] = await ctx.db
        .select({ id: purchaseLot.id })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.id, lot.id), eq(purchaseLot.serverSeq, seq)))
        .limit(1);
      if (!landed) throw new TRPCError({ code: "BAD_REQUEST", message: "The lot changed while saving; open it again" });
      return { success: true };
    }),

  /**
   * booking → unload, or booking/unload → ok (purchase.receipt). OK needs FC kg and an active
   * scrap store, and — Review Focus 2, ruling RP8 — when FC kg is short of party kg beyond the
   * tolerance, live weight debit notes (pending or approved) whose kg diff sums to at least the
   * shortfall beyond tolerance. The same rule is in the UPDATE's WHERE, and the ledger posting
   * lands only if the UPDATE did.
   */
  advance: actionProcedure("purchase.receipt")
    .input(z.object({ id: z.string().min(1), to: z.enum(["unload", "ok"]), locationId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const lot = await loadLot(ctx, input.id);
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mine = and(eq(purchaseLot.id, lot.id), eq(purchaseLot.serverSeq, seq));

      if (input.to === "unload") {
        if (lot.status !== "booking") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `This lot is already ${lot.status}` });
        }
        await atomicBatch(ctx.db, [
          ctx.db
            .update(purchaseLot)
            .set({ status: "unload", serverSeq: seq })
            .where(and(eq(purchaseLot.id, lot.id), eq(purchaseLot.companyId, ctx.companyId), eq(purchaseLot.status, "booking"))),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "purchase_lot.unload", subjectType: "purchase_lot", subjectId: lot.id, meta: { number: lot.number } },
            { from: purchaseLot, where: mine },
          ),
        ]);
        const [landed] = await ctx.db.select({ id: purchaseLot.id }).from(purchaseLot).where(mine).limit(1);
        if (!landed) throw new TRPCError({ code: "BAD_REQUEST", message: "This lot changed; open it again" });
        return { id: lot.id, status: "unload" as const };
      }

      if (lot.status !== "booking" && lot.status !== "unload") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This lot is already ${lot.status}` });
      }
      if (lot.fcKgG === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Weigh the lot on the FC kanta first" });
      }
      const tolBp = dcToleranceBp(await companySettings(ctx));
      const shortMessage = (party: number, fc: number, coveredG: number) => {
        const need = uncoveredShortG(party, fc, tolBp);
        return coveredG > 0
          ? `FC kanta is ${kg(party - fc)} kg short; the debit notes cover ${kg(coveredG)} kg but ${kg(need)} kg (the short beyond ${pct(tolBp)}) must be covered`
          : `FC kanta is ${kg(party - fc)} kg short of the party kanta (more than ${pct(tolBp)}): raise a debit note for at least ${kg(need)} kg first`;
      };
      if (isShortBeyondTolerance(lot.partyKgG, lot.fcKgG, tolBp)) {
        const coveredG = await liveWeightNoteKg(ctx, lot.id);
        if (coveredG < uncoveredShortG(lot.partyKgG, lot.fcKgG, tolBp)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: shortMessage(lot.partyKgG, lot.fcKgG, coveredG) });
        }
      }
      const store = await scrapStoreFor(ctx, input.locationId);
      const at = clockNow();

      await atomicBatch(ctx.db, [
        ctx.db
          .update(purchaseLot)
          .set({ status: "ok", locationId: store.id, okAt: at, okBy: userId, serverSeq: seq })
          .where(
            and(
              eq(purchaseLot.id, lot.id),
              eq(purchaseLot.companyId, ctx.companyId),
              inArray(purchaseLot.status, ["booking", "unload"]),
              lotMayBeOk(tolBp),
              sql`exists (select 1 from ${location} s where s.id = ${store.id} and s.company_id = ${ctx.companyId} and s.kind = 'scrap_store' and s.active = 1)`,
            ),
          ),
        lotOkRows({ db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: at }, { lotId: lot.id }),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "purchase_lot.ok",
            subjectType: "purchase_lot",
            subjectId: lot.id,
            meta: { number: lot.number, partyKgG: lot.partyKgG, fcKgG: lot.fcKgG, toleranceBp: tolBp, locationId: store.id },
          },
          { from: purchaseLot, where: mine },
        ),
      ]);

      const [landed] = await ctx.db.select({ id: purchaseLot.id }).from(purchaseLot).where(mine).limit(1);
      if (!landed) {
        // Lost a race: say why from the lot as it is now.
        const now = await loadLot(ctx, lot.id);
        if (now.status !== "booking" && now.status !== "unload") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `This lot is already ${now.status}` });
        }
        if (now.fcKgG === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Weigh the lot on the FC kanta first" });
        if (isShortBeyondTolerance(now.partyKgG, now.fcKgG, tolBp)) {
          const coveredG = await liveWeightNoteKg(ctx, lot.id);
          if (coveredG < uncoveredShortG(now.partyKgG, now.fcKgG, tolBp)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: shortMessage(now.partyKgG, now.fcKgG, coveredG) });
          }
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "The scrap store changed; try again" });
      }
      const [posted] = await ctx.db
        .select({ qtyG: stockLedger.qtyG })
        .from(stockLedger)
        .where(
          and(
            eq(stockLedger.companyId, ctx.companyId),
            eq(stockLedger.voucherType, "purchase_lot"),
            eq(stockLedger.voucherId, lot.id),
          ),
        )
        .limit(1);
      return { id: lot.id, status: "ok" as const, postedKgG: posted?.qtyG ?? 0, locationCode: store.code };
    }),

  /**
   * Cancel a lot. Before OK: purchase.receipt or masters.publish (the truck never came). An OK
   * lot: masters.publish only; every scrap posting of the lot is reversed, and the cancel is
   * refused if that item+grade at the store no longer holds what the lot put there (drawn by a
   * melt).
   */
  cancel: anyActionProcedure("purchase.receipt", "masters.publish")
    .input(z.object({ id: z.string().min(1), reason: z.string().trim().min(1, "Give a reason").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const lot = await loadLot(ctx, input.id);
      if (lot.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This lot is already cancelled" });
      const wasOk = lot.status === "ok";
      if (wasOk && !can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager can cancel a lot that is in stock" });
      }
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const mine = and(eq(purchaseLot.id, lot.id), eq(purchaseLot.serverSeq, seq), eq(purchaseLot.status, "cancelled"));
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(purchaseLot)
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: userId, cancelReason: input.reason, serverSeq: seq })
          .where(
            and(
              eq(purchaseLot.id, lot.id),
              eq(purchaseLot.companyId, ctx.companyId),
              wasOk
                ? and(eq(purchaseLot.status, "ok"), lotCancelLeavesStockNonNegative(ctx.companyId, lot.id))
                : inArray(purchaseLot.status, ["booking", "unload"]),
            ),
          ),
      ];
      if (wasOk) {
        statements.push(
          lotCancelRows({ db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: at }, { lotId: lot.id, reason: input.reason }),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "purchase_lot.cancel",
            subjectType: "purchase_lot",
            subjectId: lot.id,
            meta: { number: lot.number, from: lot.status, reason: input.reason },
          },
          { from: purchaseLot, where: mine },
        ),
      );
      await atomicBatch(ctx.db, statements);
      const [landed] = await ctx.db.select({ id: purchaseLot.id }).from(purchaseLot).where(mine).limit(1);
      if (!landed) {
        const now = await loadLot(ctx, lot.id);
        if (wasOk && now.status === "ok") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scrap from this lot has already been used; it cannot be cancelled",
          });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "This lot changed; open it again" });
      }
      return { id: lot.id, status: "cancelled" as const };
    }),
});

// ---------------------------------------------------------------------------
// D/C notes
// ---------------------------------------------------------------------------

const dcNotesRouter = router({
  list: purchaseReader
    .input(
      z
        .object({
          status: z.enum(dcNoteStatuses).optional(),
          lotId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dcNote.companyId, ctx.companyId),
        input.status ? eq(dcNote.status, input.status) : undefined,
        input.lotId ? eq(dcNote.lotId, input.lotId) : undefined,
      );
      const [items, [totalRow]] = await Promise.all([
        ctx.db
          .select({
            id: dcNote.id,
            number: dcNote.number,
            lotId: dcNote.lotId,
            lotNumber: purchaseLot.number,
            vendorName: vendor.name,
            type: dcNote.type,
            reason: dcNote.reason,
            kgDiffG: dcNote.kgDiffG,
            boriDeductionG: dcNote.boriDeductionG,
            amountPaise: dcNote.amountPaise,
            toleranceBp: dcNote.toleranceBp,
            note: dcNote.note,
            status: dcNote.status,
            approvalId: dcNote.approvalId,
            decidedAt: dcNote.decidedAt,
            createdAt: dcNote.createdAt,
          })
          .from(dcNote)
          .innerJoin(purchaseLot, and(eq(purchaseLot.id, dcNote.lotId), eq(purchaseLot.companyId, dcNote.companyId)))
          .innerJoin(vendor, and(eq(vendor.id, purchaseLot.vendorId), eq(vendor.companyId, purchaseLot.companyId)))
          .where(where)
          .orderBy(desc(dcNote.createdAt), desc(dcNote.id))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(dcNote).where(where),
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /**
   * Raise a debit/credit note on a lot (purchase.dcnote: office). Opens a dc_note approval for a
   * manager in the same batch. A weight note needs the FC weight; the bori deduction must be less
   * than the lot's weight; one note per lot may wait for a decision at a time. Amount defaults to
   * (kg diff + bori) × the lot's rate.
   */
  create: actionProcedure("purchase.dcnote")
    .input(
      z.object({
        lotId: z.string().min(1),
        type: z.enum(dcNoteTypes),
        reason: z.enum(dcNoteReasons),
        kgDiffG: grams,
        boriDeductionG: grams,
        amountPaise: z.number().int().min(0).max(100_000_000_000).optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lot = await loadLot(ctx, input.lotId);
      if (lot.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This lot is cancelled" });
      if (input.boriDeductionG > 0 && input.type !== "debit") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bori is deducted only on a debit note" });
      }
      const needsFc = input.reason === "weight" || input.boriDeductionG > 0;
      if (needsFc && lot.fcKgG === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Weigh the lot on the FC kanta first" });
      }
      if (input.kgDiffG + input.boriDeductionG === 0 && !(input.amountPaise && input.amountPaise > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the kg difference, the bori deduction or an amount" });
      }
      if (input.kgDiffG > lot.partyKgG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The kg difference cannot exceed the party weight" });
      }
      if (input.boriDeductionG > 0) {
        // All live bori on the lot (pending + approved + this one) must stay below its FC weight.
        const [live] = await ctx.db
          .select({ g: sql<number>`coalesce(sum(${dcNote.boriDeductionG}), 0)` })
          .from(dcNote)
          .where(and(eq(dcNote.companyId, ctx.companyId), eq(dcNote.lotId, lot.id), inArray(dcNote.status, ["pending", "approved"])));
        if (Number(live?.g ?? 0) + input.boriDeductionG >= lot.fcKgG!) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The bori deductions must stay below the lot's FC weight" });
        }
        // An OK lot the foundry has drawn from: the bori may take only what is left (PL-5 review I-1),
        // or approving it drives the lot and its scrap grade below zero.
        if (lot.status === "ok") {
          const left = await lotRemaining(ctx.db, ctx.companyId, lot.id);
          if (left.remainingG < input.boriDeductionG) {
            throw new TRPCError({ code: "BAD_REQUEST", message: boriMeltedMessage(lot.number, left.drawnG, left.remainingG) });
          }
        }
      }
      const [open] = await ctx.db
        .select({ number: dcNote.number })
        .from(dcNote)
        .where(and(eq(dcNote.companyId, ctx.companyId), eq(dcNote.lotId, lot.id), eq(dcNote.status, "pending")))
        .limit(1);
      if (open) throw new TRPCError({ code: "CONFLICT", message: `${open.number} is still waiting for approval on this lot` });

      const settings = await companySettings(ctx);
      const tolBp = dcToleranceBp(settings);
      const amountPaise = input.amountPaise ?? Math.round(((input.kgDiffG + input.boriDeductionG) * lot.ratePaise) / 1000);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "dc_note", at, userId);
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const approvalId = crypto.randomUUID();
      const request = requestApprovalInsert(ctx, {
        id: approvalId,
        kind: "dc_note",
        subjectId: id,
        serverSeq: seq,
        requestNote: input.note ?? null,
        // No weights or money here: approval.list is readable by every role (rate = amount ÷ kg).
        // The approver reads the figures from purchase.dcNotes.get.
        meta: { number: doc.number, lotId: lot.id, lotNumber: lot.number, type: input.type, reason: input.reason },
        // Only if the note below landed (the lot was not cancelled in between).
        guard: { from: dcNote, where: and(eq(dcNote.id, id), eq(dcNote.serverSeq, seq)) },
      });
      const lotCol = (c: string) => sql`${sql.identifier("purchase_lot")}.${sql.identifier(c)}`;
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(dcNote).select(
            ctx.db
              .select({
                id: sql<string>`${id}`.as("id"),
                companyId: sql<string>`${lotCol("company_id")}`.as("company_id"),
                serverSeq: sql<number>`${seq}`.as("server_seq"),
                number: sql<string>`${doc.number}`.as("number"),
                period: sql<string>`${doc.period}`.as("period"),
                lotId: sql<string>`${lotCol("id")}`.as("lot_id"),
                type: sql<string>`${input.type}`.as("type"),
                reason: sql<string>`${input.reason}`.as("reason"),
                kgDiffG: sql<number>`${input.kgDiffG}`.as("kg_diff_g"),
                boriDeductionG: sql<number>`${input.boriDeductionG}`.as("bori_deduction_g"),
                amountPaise: sql<number>`${amountPaise}`.as("amount_paise"),
                toleranceBp: sql<number>`${tolBp}`.as("tolerance_bp"),
                note: sql<string | null>`${input.note ?? null}`.as("note"),
                status: sql<string>`'pending'`.as("status"),
                approvalId: sql<string>`${approvalId}`.as("approval_id"),
                decidedAt: sql<number | null>`null`.as("decided_at"),
                createdBy: sql<string>`${userId}`.as("created_by"),
                createdAt: sql<number>`${at.getTime()}`.as("created_at"),
                updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
              })
              .from(purchaseLot)
              .where(
                and(
                  eq(purchaseLot.id, lot.id),
                  eq(purchaseLot.companyId, ctx.companyId),
                  ne(purchaseLot.status, "cancelled"),
                  // Write-time: weights the note relies on are still there and still large enough.
                  needsFc ? sql`${lotCol("fc_kg_g")} is not null` : undefined,
                  sql`${input.kgDiffG} <= ${lotCol("party_kg_g")}`,
                  input.boriDeductionG > 0
                    ? sql`${lotBoriG(["pending", "approved"])} + ${input.boriDeductionG} < ${lotCol("fc_kg_g")}`
                    : undefined,
                  // Write-time twin of the melted-kg check: a melt that lands first wins.
                  input.boriDeductionG > 0
                    ? sql`(${lotCol("status")} <> 'ok' or ${lotRemainingSql(ctx.companyId, OUTER_LOT_ID)} >= ${input.boriDeductionG})`
                    : undefined,
                ),
              ),
          ),
          request.statement,
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "dc_note.create",
              subjectType: "purchase_lot",
              subjectId: lot.id,
              meta: { number: doc.number, noteId: id, type: input.type, reason: input.reason, approvalId },
            },
            { from: dcNote, where: and(eq(dcNote.id, id), eq(dcNote.serverSeq, seq)) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: (dc_note\.lot_id|approval)/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "Another note is still waiting for approval on this lot" });
        }
        throw e;
      }
      const [landed] = await ctx.db
        .select({ id: dcNote.id })
        .from(dcNote)
        .where(and(eq(dcNote.id, id), eq(dcNote.companyId, ctx.companyId)))
        .limit(1);
      if (!landed) {
        if (input.boriDeductionG > 0) {
          const now = await loadLot(ctx, lot.id);
          const left = await lotRemaining(ctx.db, ctx.companyId, lot.id);
          if (now.status === "ok" && left.remainingG < input.boriDeductionG) {
            throw new TRPCError({ code: "BAD_REQUEST", message: boriMeltedMessage(lot.number, left.drawnG, left.remainingG) });
          }
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "The lot changed (cancelled or reweighed) while saving; open it again" });
      }
      return { id, number: doc.number, approvalId, amountPaise };
    }),

  /**
   * One note with what the approver needs to decide: the lot's weights, rate, shortfall,
   * tolerance and cover, and the lot's other notes. Purchase readers only (amounts are commercial).
   */
  get: purchaseReader.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const [note] = await ctx.db
      .select()
      .from(dcNote)
      .where(and(eq(dcNote.id, input.id), eq(dcNote.companyId, ctx.companyId)))
      .limit(1);
    if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    const [lot] = await lotSelect(ctx.db)
      .where(and(eq(purchaseLot.id, note.lotId), eq(purchaseLot.companyId, ctx.companyId)))
      .limit(1);
    if (!lot) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    const [notes, settings] = await Promise.all([notesForLots(ctx, [lot.id]), companySettings(ctx)]);
    const tolBp = dcToleranceBp(settings);
    return {
      note,
      lot,
      otherNotes: notes.filter((n) => n.id !== note.id),
      toleranceBp: tolBp,
      uncoveredShortG: lot.fcKgG === null ? 0 : uncoveredShortG(lot.partyKgG, lot.fcKgG, tolBp),
      ...lotMath(lot, notes, tolBp),
    };
  }),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const REGISTER_MAX_LOTS = 2_000;

export const purchaseRouter = router({
  scrapItems: scrapItemsRouter,
  scrapGrades: scrapGradesRouter,
  lots: lotsRouter,
  dcNotes: dcNotesRouter,

  /** Add the standard grades (A+/A/B/C) and the purchase book's scrap items a company is missing. */
  seedScrapDefaults: actionProcedure("masters.publish").mutation(async ({ ctx }) => {
    const [before] = await ctx.db
      .select({
        grades: sql<number>`(select count(*) from ${scrapGrade} where company_id = ${ctx.companyId})`,
        items: sql<number>`(select count(*) from ${scrapItem} where company_id = ${ctx.companyId})`,
      })
      .from(company)
      .where(eq(company.id, ctx.companyId));
    // Wave-2 M11: every default grade (by code) and item (by name) there already: write nothing,
    // take no number from the shared company counter.
    const [gradeRows, itemRows] = await Promise.all([
      ctx.db.select({ code: scrapGrade.code }).from(scrapGrade).where(eq(scrapGrade.companyId, ctx.companyId)),
      ctx.db.select({ nameKey: scrapItem.nameKey }).from(scrapItem).where(eq(scrapItem.companyId, ctx.companyId)),
    ]);
    const gradeCodes = new Set(gradeRows.map((r) => r.code));
    const itemKeys = new Set(itemRows.map((r) => r.nameKey));
    if (DEFAULT_SCRAP_GRADES.every((g) => gradeCodes.has(g.code)) && DEFAULT_SCRAP_ITEMS.every((n) => itemKeys.has(nameKey(n)))) {
      return { grades: 0, items: 0 };
    }
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const userId = ctx.session.user.id;
    const statements: SqliteBatchItem[] = [];
    pushChunkedInserts(
      statements,
      (rows) => ctx.db.insert(scrapGrade).values(rows).onConflictDoNothing(),
      DEFAULT_SCRAP_GRADES.map((g, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        code: g.code,
        name: g.name,
        sortOrder: idx + 1,
        createdBy: userId,
      })),
    );
    pushChunkedInserts(
      statements,
      (rows) => ctx.db.insert(scrapItem).values(rows).onConflictDoNothing(),
      DEFAULT_SCRAP_ITEMS.map((name, idx) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        name,
        nameKey: nameKey(name),
        sortOrder: idx + 1,
        createdBy: userId,
      })),
    );
    await atomicBatch(ctx.db, statements);
    const [after] = await ctx.db
      .select({
        grades: sql<number>`(select count(*) from ${scrapGrade} where company_id = ${ctx.companyId})`,
        items: sql<number>`(select count(*) from ${scrapItem} where company_id = ${ctx.companyId})`,
      })
      .from(company)
      .where(eq(company.id, ctx.companyId));
    return {
      grades: Number(after?.grades ?? 0) - Number(before?.grades ?? 0),
      items: Number(after?.items ?? 0) - Number(before?.items ?? 0),
    };
  }),

  /**
   * Purchase register (digest §8.7): lots in a date range (by book date), optionally one vendor,
   * with their D/C notes, payable kg, amount, stock kg and the owner's measure flag
   * `short_without_note`. Totals leave cancelled lots out. At most 2,000 lots (`truncated`).
   */
  register: purchaseReader
    .input(
      z.object({
        from: isoDate,
        to: isoDate,
        vendorId: z.string().min(1).optional(),
        includeCancelled: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.from > input.to) throw new TRPCError({ code: "BAD_REQUEST", message: "From must be on or before To" });
      const lots = await lotSelect(ctx.db)
        .where(
          and(
            eq(purchaseLot.companyId, ctx.companyId),
            gte(purchaseLot.lotDate, input.from),
            lte(purchaseLot.lotDate, input.to),
            input.vendorId ? eq(purchaseLot.vendorId, input.vendorId) : undefined,
            input.includeCancelled ? undefined : ne(purchaseLot.status, "cancelled"),
          ),
        )
        .orderBy(asc(purchaseLot.lotDate), asc(purchaseLot.createdAt), asc(purchaseLot.id))
        .limit(REGISTER_MAX_LOTS + 1);
      const truncated = lots.length > REGISTER_MAX_LOTS;
      const shown = truncated ? lots.slice(0, REGISTER_MAX_LOTS) : lots;
      const [notes, settings] = await Promise.all([
        notesForLots(
          ctx,
          shown.map((l) => l.id),
        ),
        companySettings(ctx),
      ]);
      const tolBp = dcToleranceBp(settings);
      const byLot = new Map<string, typeof notes>();
      for (const n of notes) {
        const list = byLot.get(n.lotId) ?? [];
        list.push(n);
        byLot.set(n.lotId, list);
      }
      const rows = shown.map((lot) => {
        const lotNotes = byLot.get(lot.id) ?? [];
        return { ...lot, notes: lotNotes, ...lotMath(lot, lotNotes, tolBp) };
      });
      const totals = {
        lots: 0,
        partyKgG: 0,
        fcKgG: 0,
        debitKgG: 0,
        creditKgG: 0,
        boriG: 0,
        payableKgG: 0,
        amountPaise: 0,
        stockKgG: 0,
        shortWithoutNote: 0,
        notesPending: 0,
      };
      for (const r of rows) {
        if (r.status === "cancelled") continue;
        totals.lots += 1;
        totals.partyKgG += r.partyKgG;
        totals.fcKgG += r.fcKgG ?? 0;
        totals.debitKgG += r.debitKgG;
        totals.creditKgG += r.creditKgG;
        totals.boriG += r.boriG;
        totals.payableKgG += r.payableKgG;
        totals.amountPaise += r.amountPaise;
        totals.stockKgG += r.stockKgG ?? 0;
        if (r.flag === "short_without_note") totals.shortWithoutNote += 1;
        totals.notesPending += r.notes.filter((n) => n.status === "pending").length;
      }
      return { from: input.from, to: input.to, toleranceBp: tolBp, lots: rows, totals, truncated };
    }),

  /** Scrap in stock by item and grade, per scrap store (ledger). The foundry reads it too. */
  scrapStock: anyActionProcedure("purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish", "cast.enter").query(
    async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          itemRef: stockLedger.itemRef,
          locationId: stockLedger.locationId,
          qtyG: sql<number>`sum(${stockLedger.qtyG})`,
        })
        .from(stockLedger)
        .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.itemKind, "scrap_grade")))
        .groupBy(stockLedger.itemRef, stockLedger.locationId)
        .having(sql`sum(${stockLedger.qtyG}) <> 0`);
      const [items, grades, locations] = await Promise.all([
        ctx.db.select({ id: scrapItem.id, name: scrapItem.name }).from(scrapItem).where(eq(scrapItem.companyId, ctx.companyId)),
        ctx.db
          .select({ id: scrapGrade.id, code: scrapGrade.code, sortOrder: scrapGrade.sortOrder })
          .from(scrapGrade)
          .where(eq(scrapGrade.companyId, ctx.companyId)),
        ctx.db.select({ id: location.id, code: location.code }).from(location).where(eq(location.companyId, ctx.companyId)),
      ]);
      const itemName = new Map(items.map((i) => [i.id, i.name]));
      const grade = new Map(grades.map((g) => [g.id, g]));
      const locCode = new Map(locations.map((l) => [l.id, l.code]));
      const out = rows.map((r) => {
        const ref = parseScrapItemRef(r.itemRef);
        const g = ref ? grade.get(ref.scrapGradeId) : undefined;
        return {
          itemRef: r.itemRef,
          scrapItemId: ref?.scrapItemId ?? null,
          itemName: ref ? (itemName.get(ref.scrapItemId) ?? null) : null,
          scrapGradeId: ref?.scrapGradeId ?? null,
          gradeCode: g?.code ?? null,
          locationId: r.locationId,
          locationCode: r.locationId ? (locCode.get(r.locationId) ?? null) : null,
          qtyG: Number(r.qtyG),
          sort: g?.sortOrder ?? 999,
        };
      });
      out.sort((a, b) => (a.itemName ?? "").localeCompare(b.itemName ?? "") || a.sort - b.sort);
      return {
        items: out.map(({ sort: _sort, ...rest }) => rest),
        totalG: out.reduce((s, r) => s + r.qtyG, 0),
      };
    },
  ),
});

