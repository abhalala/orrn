/**
 * Foundry (spec P3, P15, §5; digest Stages 3-5): return streams, casts, melts, spectro results and
 * the cast close-out.
 *
 * - A cast is a campaign (ADR-013): `casts.open` takes its letter code from the doc series (`K31`),
 *   melts are added while it is open, `casts.close` explains its tail.
 * - `melts.create` writes the melt, its input / output / chemical lines, its ledger rows, the store
 *   draws of its chemicals (ruling RP17) and the audit rows in ONE atomicBatch. Every guard sits in
 *   the statements themselves (cast still open, lot still has the kg, stream still live, store
 *   still has the chemical); one that fails aborts the whole batch, so a melt never lands half.
 * - Balance (spec P15): loss above 3 % of the input, or more out than in, warns; the warning is
 *   returned and stored on the melt. Burn loss within 3 % counts as explained at close-out; the
 *   excess flows into the cast's tail.
 * - Close-out (Review Focus 4): tail = input − (by-products + allowed burn + bundles + press returns
 *   + billets on hand). |tail| > 1 % needs a reason and opens a `cast_close` approval (foundry,
 *   manager, admin, owner approve; never the requester); the cast waits in `closing`.
 * - Corrections are cancels with reversal rows (`melts.cancel`), never edits.
 * - The foundry picks lots from `lots.available`: remaining kg by lot and grade, no rates (RP9).
 */
import {
  CAST_ALLOYS,
  CAST_TAIL_REASON_BP,
  MELT_BALANCE_WARN_BP,
  meltBalance,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import {
  cast,
  castStatuses,
  melt,
  meltChemical,
  meltInput,
  meltOutput,
  returnStream,
  returnStreamKinds,
  spectroResult,
  type CastCloseSummary,
  type CastRow,
  type MeltRow,
  type MeltWarning,
} from "@orrn/db/schema/foundry";
import { purchaseLot, scrapGrade, scrapItem } from "@orrn/db/schema/purchase";
import { location, stockLedger, type LedgerVoucherType } from "@orrn/db/schema/stock";
import { storeItem, storeTxn, storeUnits, type StoreItemRow } from "@orrn/db/schema/store";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import type { Context } from "../context";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import {
  activeLocation,
  castBilletsOnHandSql,
  castBilletsShortSql,
  castCloseout,
  castInputSql,
  castLiveMeltsSql,
  castLogsSql,
  castTailSql,
  castTailWithinBand,
  defaultReturnStreamStatements,
  defaultReturnStreamsPresent,
  DROSS_STREAM,
  FE_STREAM,
  fmtKg,
  foundryAbort,
  isFoundryAbort,
  isUniqueViolation,
  lotDrawnSql,
  lotRemainingSql,
  lotStockSql,
  OUTER_CAST_ID,
  OUTER_LOT_ID,
  resolveBilletStore,
  resolvePlantScrap,
} from "../lib/foundry";
import { nameKey } from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";
import {
  diagnoseStoreCancel,
  isStoreDrawAbort,
  MAX_STORE_DRAWS,
  MAX_STORE_QTY_MILLI,
  prepareStoreDraws,
  storeCancelMark,
  storeCancelRows,
  type PreparedStoreDraws,
} from "../lib/store";
import { spectroInboxRouter } from "./spectroInbox";

type Ctx = Pick<Context, "db" | "session" | "impersonation"> & {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
};

const sqlUuid = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** 100 t per line: beyond any furnace charge, far below 2^53 in every sum. */
const MAX_LINE_G = 100_000_000;
/** Input lines per melt: lots and streams together (each is one guarded statement). */
export const MAX_MELT_INPUTS = 60;
/** By-product lines put back into charge streams (reusable metal, dross ingot, …). */
export const MAX_MELT_RETURNS = 10;
/** A melt runs a few hours; a span above 3 days is a typing slip. */
const MAX_MELT_SPAN_MS = 72 * 3_600_000;
/** Clock slack for "not in the future". */
const FUTURE_SLACK_MS = 10 * 60_000;
/**
 * How long before its cast was opened a melt may have started: a cast is often opened on the
 * tablet after the campaign began (the sheet is typed up later), but a melt weeks earlier is a
 * wrong date, and it would move the melt in the yield report (casting end dates it).
 */
const MAX_MELT_BEFORE_CAST_MS = 7 * 24 * 3_600_000;
/** LDO tank dip: 0 … 240 inches, in tenths. */
const MAX_TENTH_IN = 2_400;
/** Spectro file: 1 MB decoded (base64 of it is at most 1,398,104 characters). */
export const MAX_SPECTRO_BYTES = 1_048_576;
const MAX_SPECTRO_BASE64 = 4 * Math.ceil(MAX_SPECTRO_BYTES / 3);
const SPECTRO_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv", "text/plain"] as const;
const MAX_SPECTRO_VALUES = 40;

const CAST_NOT_FOUND = { code: "NOT_FOUND", message: "Cast not found" } as const;
const REQUEST_REUSED = "That request id was already used for something else";
const MELT_NOT_FOUND = { code: "NOT_FOUND", message: "Melt not found" } as const;

const id = z.string().min(1).max(64);
const grams = z.number().int().min(0).max(MAX_LINE_G);
const positiveGrams = z.number().int().min(1).max(MAX_LINE_G);
const epochMs = z.number().int().min(Date.UTC(2020, 0, 1)).max(Date.UTC(2100, 0, 1));
const tenthIn = z.number().int().min(0).max(MAX_TENTH_IN);
const milli = z.number().int().min(0).max(MAX_STORE_QTY_MILLI);
/** Trimmed optional text; empty becomes null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));
const clientRequestId = z.string().trim().min(1).max(64).optional();

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

// ---------------------------------------------------------------------------
// Return streams
// ---------------------------------------------------------------------------

const streamCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,20}$/, "Code like PLANT-SCRAP (letters, digits, dashes)")
  .transform((s) => s.toUpperCase());
const streamName = z.string().trim().min(1, "Give a name").max(60);

async function streamConflict(ctx: Ctx, code: string | null, key: string, exceptId?: string) {
  const rows = await ctx.db
    .select({ id: returnStream.id })
    .from(returnStream)
    .where(
      and(
        eq(returnStream.companyId, ctx.companyId),
        code ? or(eq(returnStream.code, code), eq(returnStream.nameKey, key)) : eq(returnStream.nameKey, key),
        exceptId ? ne(returnStream.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (rows.length > 0) throw new TRPCError({ code: "CONFLICT", message: "A return stream with that code or name exists" });
}

const returnStreamsRouter = router({
  /** Every stream with its ledger balance (all locations). Any member reads it. */
  list: companyProcedure.query(async ({ ctx }) => {
    const balance = sql<number>`coalesce((
      select sum(rl.qty_g) from ${stockLedger} rl
      where rl.company_id = ${ctx.companyId} and rl.item_kind = 'return_stream'
        and rl.item_ref = ${sql.identifier("return_stream")}.${sql.identifier("id")}
    ), 0)`;
    const items = await ctx.db
      .select({
        id: returnStream.id,
        code: returnStream.code,
        name: returnStream.name,
        kind: returnStream.kind,
        active: returnStream.active,
        sortOrder: returnStream.sortOrder,
        balanceG: balance,
      })
      .from(returnStream)
      .where(eq(returnStream.companyId, ctx.companyId))
      .orderBy(asc(returnStream.sortOrder), asc(returnStream.code));
    return { items: items.map((s) => ({ ...s, balanceG: Number(s.balanceG) })) };
  }),

  /** Add the foundry sheet's streams a company is missing. Opening a cast does this too. */
  seedDefaults: anyActionProcedure("masters.publish", "cast.enter").mutation(async ({ ctx }) => {
    const count = async () =>
      Number(
        (
          await ctx.db
            .select({ n: sql<number>`count(*)` })
            .from(returnStream)
            .where(eq(returnStream.companyId, ctx.companyId))
        )[0]?.n ?? 0,
      );
    // Wave-2 M11: when every default stream is there (by code or name) nothing is written and no
    // number is taken from the shared company counter.
    if (await defaultReturnStreamsPresent(ctx.db, ctx.companyId)) return { added: 0 };
    const before = await count();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ...defaultReturnStreamStatements(ctx.db, ctx.companyId, { userId: ctx.session.user.id, seq }),
      auditInsert(ctx, { action: "return_stream.seed", subjectType: "return_stream", subjectId: null }),
    ]);
    return { added: (await count()) - before };
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        code: streamCode,
        name: streamName,
        kind: z.enum(returnStreamKinds).default("charge"),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = nameKey(input.name);
      if (!key) bad("Give a name");
      await streamConflict(ctx, input.code, key);
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(returnStream).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            code: input.code,
            name: input.name,
            nameKey: key,
            kind: input.kind,
            sortOrder: input.sortOrder ?? 100,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, {
            action: "return_stream.create",
            subjectType: "return_stream",
            subjectId: rowId,
            meta: { code: input.code, name: input.name, kind: input.kind },
          }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e, "return_stream.")) {
          throw new TRPCError({ code: "CONFLICT", message: "A return stream with that code or name exists" });
        }
        throw e;
      }
      return { id: rowId, code: input.code };
    }),

  /** Rename, re-order or retire. Code and kind never change (ledger rows and other modules use them). */
  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id,
        name: streamName.optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(returnStream)
        .where(and(eq(returnStream.id, input.id), eq(returnStream.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Return stream not found" });
      const patch: Partial<typeof returnStream.$inferInsert> = {};
      if (input.name !== undefined) {
        const key = nameKey(input.name);
        if (!key) bad("Give a name");
        await streamConflict(ctx, null, key, row.id);
        patch.name = input.name;
        patch.nameKey = key;
      }
      if (input.active !== undefined) patch.active = input.active;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (Object.keys(patch).length === 0) return { id: row.id };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(returnStream)
            .set({ ...patch, serverSeq: seq })
            .where(and(eq(returnStream.id, row.id), eq(returnStream.companyId, ctx.companyId))),
          auditInsert(ctx, {
            action: "return_stream.update",
            subjectType: "return_stream",
            subjectId: row.id,
            meta: { before: { name: row.name, active: row.active, sortOrder: row.sortOrder }, after: patch },
          }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e, "return_stream.")) {
          throw new TRPCError({ code: "CONFLICT", message: "A return stream with that code or name exists" });
        }
        throw e;
      }
      return { id: row.id };
    }),
});

// ---------------------------------------------------------------------------
// Lots for the foundry (RP9: remaining kg, no commercial figures)
// ---------------------------------------------------------------------------

const AVAILABLE_LOTS_MAX = 1_000;

const lotsRouter = router({
  /**
   * OK lots that still hold scrap, in book order (oldest first), with remaining kg = what the lot
   * holds for the furnace (its postings less the bori of a pending D/C note, never shown on its own)
   * − what live melts drew; and the same totals by item + grade. No rate, party kg, vendor, bill or
   * D/C figures: the foundry picks lots without seeing what they cost.
   */
  available: anyActionProcedure("cast.enter", "cast.close", "purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish").query(
    async ({ ctx }) => {
      // Company-scoped sums (do not drop their company_id terms: the lot filter below does not cover them).
      const stock = lotStockSql(ctx.companyId, OUTER_LOT_ID);
      const drawn = lotDrawnSql(ctx.companyId, OUTER_LOT_ID);
      const rows = await ctx.db
        .select({
          id: purchaseLot.id,
          number: purchaseLot.number,
          lotDate: purchaseLot.lotDate,
          origin: purchaseLot.origin,
          scrapItemId: purchaseLot.scrapItemId,
          itemName: scrapItem.name,
          scrapGradeId: purchaseLot.scrapGradeId,
          gradeCode: scrapGrade.code,
          gradeSort: scrapGrade.sortOrder,
          locationId: purchaseLot.locationId,
          locationCode: location.code,
          okAt: purchaseLot.okAt,
          stockG: stock,
          drawnG: drawn,
        })
        .from(purchaseLot)
        .innerJoin(scrapItem, and(eq(scrapItem.id, purchaseLot.scrapItemId), eq(scrapItem.companyId, purchaseLot.companyId)))
        .innerJoin(scrapGrade, and(eq(scrapGrade.id, purchaseLot.scrapGradeId), eq(scrapGrade.companyId, purchaseLot.companyId)))
        // Every join matches the company too: a foreign key does not check it (location.id is a primary
        // key, so the company term never changes a match today; it keeps a cross-wired row out).
        .leftJoin(location, and(eq(location.id, purchaseLot.locationId), eq(location.companyId, purchaseLot.companyId)))
        .where(and(eq(purchaseLot.companyId, ctx.companyId), eq(purchaseLot.status, "ok"), sql`${stock} - ${drawn} > 0`))
        // Book order: financial year, then the lot's number (LOT-2 before LOT-10).
        .orderBy(
          asc(purchaseLot.period),
          sql`cast(substr(${purchaseLot.number}, instr(${purchaseLot.number}, '-') + 1) as integer)`,
          asc(purchaseLot.id),
        )
        .limit(AVAILABLE_LOTS_MAX + 1);
      const truncated = rows.length > AVAILABLE_LOTS_MAX;
      const lots = (truncated ? rows.slice(0, AVAILABLE_LOTS_MAX) : rows).map(({ gradeSort: _s, ...r }) => {
        const stockG = Number(r.stockG);
        const drawnG = Number(r.drawnG);
        return { ...r, stockG, drawnG, remainingG: stockG - drawnG };
      });
      const groups = new Map<
        string,
        { itemRef: string; scrapItemId: string; itemName: string; scrapGradeId: string; gradeCode: string; sort: number; remainingG: number; lots: number }
      >();
      rows.slice(0, AVAILABLE_LOTS_MAX).forEach((r, i) => {
        const key = `${r.scrapItemId}:${r.scrapGradeId}`;
        const g = groups.get(key) ?? {
          itemRef: key,
          scrapItemId: r.scrapItemId,
          itemName: r.itemName,
          scrapGradeId: r.scrapGradeId,
          gradeCode: r.gradeCode,
          sort: r.gradeSort,
          remainingG: 0,
          lots: 0,
        };
        g.remainingG += lots[i]!.remainingG;
        g.lots += 1;
        groups.set(key, g);
      });
      const byGrade = [...groups.values()]
        .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.sort - b.sort)
        .map(({ sort: _s, ...g }) => g);
      return { lots, byGrade, totalG: lots.reduce((s, l) => s + l.remainingG, 0), truncated };
    },
  ),
});

// ---------------------------------------------------------------------------
// Casts
// ---------------------------------------------------------------------------

async function loadCast(ctx: Pick<Ctx, "db" | "companyId">, castId: string): Promise<CastRow> {
  const [row] = await ctx.db
    .select()
    .from(cast)
    .where(and(eq(cast.id, castId), eq(cast.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(CAST_NOT_FOUND);
  return row;
}

function castStateMessage(c: Pick<CastRow, "number" | "status">): string {
  return c.status === "closed"
    ? `${c.number} is closed`
    : c.status === "closing"
      ? `${c.number} is waiting for its close-out approval`
      : `${c.number} changed; open it again`;
}

/** The cast's live summary columns (melt count, kg in, logs, billets on hand) for lists. */
function castSummaryFields(companyId: string) {
  return {
    liveMelts: castLiveMeltsSql(companyId, OUTER_CAST_ID),
    inputG: castInputSql(companyId, OUTER_CAST_ID),
    logsG: castLogsSql(companyId, OUTER_CAST_ID),
    billetsOnHandG: castBilletsOnHandSql(companyId, OUTER_CAST_ID),
    billetsShortG: castBilletsShortSql(companyId, OUTER_CAST_ID),
  };
}

const castsRouter = router({
  /** Newest first; filter by status or by letter code (the code repeats every year). Any member. */
  list: companyProcedure
    .input(
      z
        .object({
          status: z.enum(castStatuses).optional(),
          number: z.string().trim().max(12).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(cast.companyId, ctx.companyId),
        input.status ? eq(cast.status, input.status) : undefined,
        input.number ? eq(cast.number, input.number.toUpperCase()) : undefined,
      );
      const [rows, [totalRow]] = await Promise.all([
        ctx.db
          .select({
            id: cast.id,
            number: cast.number,
            year: cast.year,
            month: cast.month,
            alloy: cast.alloy,
            grade: cast.grade,
            status: cast.status,
            openedAt: cast.openedAt,
            closedAt: cast.closedAt,
            tailG: cast.tailG,
            tailBp: cast.tailBp,
            ...castSummaryFields(ctx.companyId),
          })
          .from(cast)
          .where(where)
          .orderBy(desc(cast.openedAt), desc(cast.period), desc(cast.seq))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(cast).where(where),
      ]);
      const items = rows.map(({ liveMelts, ...r }) => ({
        ...r,
        // LIVE melts (cancelled ones excluded). casts.get().cast.meltCount is different: every melt
        // ever added, cancelled included (the next melt's number − 1). Screens show this one.
        meltCount: Number(liveMelts),
        inputG: Number(r.inputG),
        logsG: Number(r.logsG),
        billetsOnHandG: Number(r.billetsOnHandG),
        billetsShortG: Number(r.billetsShortG),
      }));
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /** A cast with every melt (inputs, outputs, chemicals, spectro list), the live close-out and its approval. */
  get: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const c = await loadCast(ctx, input.id);
    const meltOfCast = and(eq(melt.companyId, ctx.companyId), eq(melt.castId, c.id));
    const [melts, inputs, outputs, chemicals, spectro, closeout, approvals] = await Promise.all([
      ctx.db.select().from(melt).where(meltOfCast).orderBy(asc(melt.seq)),
      ctx.db
        .select({
          meltId: meltInput.meltId,
          line: meltInput.line,
          kind: meltInput.kind,
          lotId: meltInput.lotId,
          lotNumber: purchaseLot.number,
          itemName: scrapItem.name,
          gradeCode: scrapGrade.code,
          returnStreamId: meltInput.returnStreamId,
          streamCode: returnStream.code,
          streamName: returnStream.name,
          locationId: meltInput.locationId,
          kgG: meltInput.kgG,
        })
        .from(meltInput)
        .innerJoin(melt, and(eq(melt.id, meltInput.meltId), eq(melt.companyId, meltInput.companyId)))
        .leftJoin(purchaseLot, and(eq(purchaseLot.id, meltInput.lotId), eq(purchaseLot.companyId, meltInput.companyId)))
        .leftJoin(scrapItem, and(eq(scrapItem.id, purchaseLot.scrapItemId), eq(scrapItem.companyId, meltInput.companyId)))
        .leftJoin(scrapGrade, and(eq(scrapGrade.id, purchaseLot.scrapGradeId), eq(scrapGrade.companyId, meltInput.companyId)))
        .leftJoin(returnStream, and(eq(returnStream.id, meltInput.returnStreamId), eq(returnStream.companyId, meltInput.companyId)))
        .where(and(eq(meltInput.companyId, ctx.companyId), eq(melt.castId, c.id)))
        .orderBy(asc(meltInput.line)),
      ctx.db
        .select({
          meltId: meltOutput.meltId,
          line: meltOutput.line,
          kind: meltOutput.kind,
          returnStreamId: meltOutput.returnStreamId,
          streamCode: returnStream.code,
          streamName: returnStream.name,
          pcs: meltOutput.pcs,
          lengthMm: meltOutput.lengthMm,
          kgG: meltOutput.kgG,
        })
        .from(meltOutput)
        .innerJoin(melt, and(eq(melt.id, meltOutput.meltId), eq(melt.companyId, meltOutput.companyId)))
        .leftJoin(returnStream, and(eq(returnStream.id, meltOutput.returnStreamId), eq(returnStream.companyId, meltOutput.companyId)))
        .where(and(eq(meltOutput.companyId, ctx.companyId), eq(melt.castId, c.id)))
        .orderBy(asc(meltOutput.line)),
      ctx.db
        .select({
          meltId: meltChemical.meltId,
          line: meltChemical.line,
          storeItemId: meltChemical.storeItemId,
          name: meltChemical.name,
          unit: meltChemical.unit,
          openMilli: meltChemical.openMilli,
          usedMilli: meltChemical.usedMilli,
          closeMilli: meltChemical.closeMilli,
          storeTxnId: meltChemical.storeTxnId,
          mrsNumber: storeTxn.number,
        })
        .from(meltChemical)
        .innerJoin(melt, and(eq(melt.id, meltChemical.meltId), eq(melt.companyId, meltChemical.companyId)))
        .leftJoin(storeTxn, and(eq(storeTxn.id, meltChemical.storeTxnId), eq(storeTxn.companyId, meltChemical.companyId)))
        .where(and(eq(meltChemical.companyId, ctx.companyId), eq(melt.castId, c.id)))
        .orderBy(asc(meltChemical.line)),
      ctx.db
        .select({
          id: spectroResult.id,
          meltId: spectroResult.meltId,
          fileName: spectroResult.fileName,
          mime: spectroResult.mime,
          sizeBytes: spectroResult.sizeBytes,
          valuesPpm: spectroResult.valuesPpm,
          createdBy: spectroResult.createdBy,
          createdAt: spectroResult.createdAt,
        })
        .from(spectroResult)
        .where(and(eq(spectroResult.companyId, ctx.companyId), eq(spectroResult.castId, c.id)))
        .orderBy(asc(spectroResult.createdAt)),
      castCloseout(ctx.db, ctx.companyId, c.id),
      ctx.db
        .select({
          id: approval.id,
          status: approval.status,
          requestNote: approval.requestNote,
          decidedBy: approval.decidedBy,
          decidedAt: approval.decidedAt,
          note: approval.note,
          createdAt: approval.createdAt,
        })
        .from(approval)
        .where(and(eq(approval.companyId, ctx.companyId), eq(approval.kind, "cast_close"), eq(approval.subjectId, c.id)))
        .orderBy(desc(approval.createdAt))
        .limit(1),
    ]);
    const group = <T extends { meltId: string }>(rows: T[]) => {
      const m = new Map<string, Omit<T, "meltId">[]>();
      for (const { meltId, ...rest } of rows) m.set(meltId, [...(m.get(meltId) ?? []), rest]);
      return m;
    };
    const ins = group(inputs);
    const outs = group(outputs);
    const chems = group(chemicals);
    const specs = group(
      spectro.map(({ valuesPpm, ...s }) => ({
        ...s,
        values: Object.fromEntries(Object.entries(valuesPpm ?? {}).map(([k, v]) => [k, v / 10_000])),
      })),
    );
    return {
      cast: c,
      melts: melts.map((m) => ({
        ...m,
        inputs: ins.get(m.id) ?? [],
        outputs: outs.get(m.id) ?? [],
        chemicals: chems.get(m.id) ?? [],
        spectro: specs.get(m.id) ?? [],
      })),
      closeout,
      approval: approvals[0] ?? null,
    };
  }),

  /** Open a cast (cast.enter). Its number comes from the doc series; the year is stored, not shown. */
  open: actionProcedure("cast.enter")
    .input(
      z.object({
        alloy: z.enum(CAST_ALLOYS),
        grade: optText(20),
        notes: optText(500),
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prior = async () =>
        input.clientRequestId
          ? (
              await ctx.db
                .select()
                .from(cast)
                .where(and(eq(cast.companyId, ctx.companyId), eq(cast.clientRequestId, input.clientRequestId)))
                .limit(1)
            )[0]
          : undefined;
      // RP18 pattern: a replay returns the first cast; the same id for a different cast is a CONFLICT.
      const shape = (c: CastRow) => {
        if (c.alloy !== input.alloy) throw new TRPCError({ code: "CONFLICT", message: REQUEST_REUSED });
        return { id: c.id, number: c.number, period: c.period, alloy: c.alloy, status: c.status };
      };
      const before = await prior();
      if (before) return shape(before);

      const userId = ctx.session.user.id;
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "cast", at, userId);
      const castId = crypto.randomUUID();
      const row = {
        id: castId,
        companyId: ctx.companyId,
        serverSeq: seq,
        number: doc.number,
        period: doc.period,
        year: Number(doc.period.slice(0, 4)),
        month: Number(doc.period.slice(5, 7)),
        seq: doc.seq,
        alloy: input.alloy,
        grade: input.grade,
        status: "open" as const,
        notes: input.notes,
        openedAt: at,
        clientRequestId: input.clientRequestId ?? null,
        createdBy: userId,
      };
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(cast).values(row),
          // The first cast of a company brings its return streams with it.
          ...defaultReturnStreamStatements(ctx.db, ctx.companyId, { userId, seq }),
          auditInsert(ctx, {
            action: "cast.open",
            subjectType: "cast",
            subjectId: castId,
            meta: { number: doc.number, period: doc.period, alloy: input.alloy, grade: input.grade },
          }),
        ]);
      } catch (e) {
        if (input.clientRequestId && isUniqueViolation(e, "cast.company_id, cast.client_request_id")) {
          const won = await prior();
          if (won) return shape(won);
        }
        throw e;
      }
      return { id: castId, number: doc.number, period: doc.period, alloy: input.alloy, status: "open" as const };
    }),

  /**
   * Close-out (cast.close, Review Focus 4). Tail within 1 % of the input: the cast closes now.
   * Above it: a reason is required and the cast waits in `closing` for a `cast_close` approval.
   * The UPDATE carries the guards (still open; the cast row unchanged since the read — every melt
   * create AND cancel moves its server_seq; for a no-reason close the tail still within 1 % at
   * write time, for a close with a reason the tail still exactly what was read, so the approval
   * never shows stale figures), so a melt, a melt cancel or a billet movement that lands between
   * the read and the batch makes the close refuse instead of closing on stale figures.
   */
  close: actionProcedure("cast.close")
    .input(z.object({ castId: id, tailReason: optText(500) }))
    .mutation(async ({ ctx, input }) => {
      const c = await loadCast(ctx, input.castId);
      if (c.status !== "open") bad(c.status === "closed" ? `${c.number} is already closed` : castStateMessage(c));
      const co = await castCloseout(ctx.db, ctx.companyId, c.id);
      if (co.needsReason && !input.tailReason) {
        bad(
          `${fmtKg(co.tailG)} kg of ${c.number} is not explained${
            co.tailBp === null ? "" : ` (${(co.tailBp / 100).toFixed(2)} % of the input, more than 1 %)`
          }; give a reason`,
        );
      }
      const userId = ctx.session.user.id;
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const status = co.needsReason ? ("closing" as const) : ("closed" as const);
      const approvalId = co.needsReason ? crypto.randomUUID() : null;
      const summary: CastCloseSummary = {
        inputG: co.inputG,
        logsG: co.logsG,
        byproductG: co.byproductG,
        allowedBurnG: co.allowedBurnG,
        bundlesG: co.bundlesG,
        pressReturnsG: co.pressReturnsG,
        billetsOnHandG: co.billetsOnHandG,
        explainedG: co.explainedG,
        tailG: co.tailG,
        tailBp: co.tailBp,
      };
      const mine = and(eq(cast.id, c.id), eq(cast.companyId, ctx.companyId), eq(cast.serverSeq, seq), eq(cast.status, status));
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(cast)
          .set({
            status,
            closeRequestedAt: at,
            closeRequestedBy: userId,
            tailG: co.tailG,
            tailBp: co.tailBp,
            tailReason: input.tailReason,
            closeSummary: summary,
            closeApprovalId: approvalId,
            closedAt: co.needsReason ? null : at,
            closedBy: co.needsReason ? null : userId,
            serverSeq: seq,
            updatedAt: at,
          })
          .where(
            and(
              eq(cast.id, c.id),
              eq(cast.companyId, ctx.companyId),
              eq(cast.status, "open"),
              // melts.create and melts.cancel both move server_seq (melt_count alone misses a cancel).
              eq(cast.serverSeq, c.serverSeq),
              eq(cast.meltCount, c.meltCount),
              co.needsReason
                ? sql`${castTailSql(ctx.companyId, sql`${c.id}`)} = ${co.tailG}`
                : castTailWithinBand(ctx.companyId, sql`${c.id}`, CAST_TAIL_REASON_BP),
            ),
          ),
      ];
      if (approvalId) {
        statements.push(
          requestApprovalInsert(ctx, {
            id: approvalId,
            kind: "cast_close",
            subjectId: c.id,
            serverSeq: seq,
            requestNote: input.tailReason,
            meta: { number: c.number, year: c.year, inputG: co.inputG, tailG: co.tailG, tailBp: co.tailBp },
            guard: { from: cast, where: mine },
          }).statement,
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: co.needsReason ? "cast.close_request" : "cast.close",
            subjectType: "cast",
            subjectId: c.id,
            meta: { number: c.number, ...summary, reason: input.tailReason, approvalId },
          },
          { from: cast, where: mine },
        ),
      );
      await atomicBatch(ctx.db, statements);
      const [landed] = await ctx.db.select({ id: cast.id }).from(cast).where(mine).limit(1);
      if (!landed) {
        const now = await loadCast(ctx, c.id);
        if (now.status !== "open") bad(castStateMessage(now));
        bad(`${c.number} changed while you were closing it; check the close-out again`);
      }
      return { id: c.id, number: c.number, status, tailG: co.tailG, tailBp: co.tailBp, approvalId };
    }),
});

// ---------------------------------------------------------------------------
// Melts
// ---------------------------------------------------------------------------

const meltInputLine = z.object({
  kind: z.enum(["lot", "return_stream"]),
  ref: id,
  kgG: positiveGrams,
});

const chemicalLine = z.object({
  storeItemId: id.optional(),
  name: z.string().trim().max(60).optional(),
  unit: z.enum(storeUnits).optional(),
  openMilli: milli,
  usedMilli: milli,
  closeMilli: milli,
});

const meltCreateInput = z.object({
  castId: id,
  alloy: z.enum(CAST_ALLOYS).optional(),
  timestamps: z.object({
    preheatStart: epochMs,
    chargingStart: epochMs,
    chargingEnd: epochMs,
    castingStart: epochMs,
    castingEnd: epochMs,
  }),
  ldoTenthIn: z.object({
    start: tenthIn,
    end: tenthIn,
    chargingStart: tenthIn.nullable().optional(),
    chargingEnd: tenthIn.nullable().optional(),
    castingStart: tenthIn.nullable().optional(),
  }),
  inputs: z.array(meltInputLine).min(1, "Add what went into the furnace").max(MAX_MELT_INPUTS),
  chemicals: z.array(chemicalLine).max(MAX_STORE_DRAWS).default([]),
  outputs: z.object({
    logs: z.object({
      pcs: z.number().int().min(0).max(10_000),
      lengthMm: z.number().int().min(0).max(20_000),
      kgG: grams,
    }),
    drossG: grams,
    feG: grams,
    returns: z.array(z.object({ streamId: id, kgG: positiveGrams })).max(MAX_MELT_RETURNS).default([]),
  }),
  balanceNote: optText(500),
  notes: optText(500),
  clientRequestId,
});

type MeltCreateInput = z.infer<typeof meltCreateInput>;

type LotForMelt = {
  id: string;
  number: string;
  status: string;
  locationId: string | null;
  scrapItemId: string;
  scrapGradeId: string;
  remainingG: number;
};

async function lotsForMelt(ctx: Ctx, lotIds: string[]): Promise<Map<string, LotForMelt>> {
  const remaining = lotRemainingSql(ctx.companyId, OUTER_LOT_ID);
  const rows = await mapInChunks(
    lotIds,
    (ids) =>
      ctx.db
        .select({
          id: purchaseLot.id,
          number: purchaseLot.number,
          status: purchaseLot.status,
          locationId: purchaseLot.locationId,
          scrapItemId: purchaseLot.scrapItemId,
          scrapGradeId: purchaseLot.scrapGradeId,
          remainingG: remaining,
        })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.id, ids))),
    60,
  );
  return new Map(rows.map((r) => [r.id, { ...r, remainingG: Number(r.remainingG) }]));
}

async function streamsByIds(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof returnStream.$inferSelect>();
  const rows = await mapInChunks(ids, (part) =>
    ctx.db
      .select()
      .from(returnStream)
      .where(and(eq(returnStream.companyId, ctx.companyId), inArray(returnStream.id, part))),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** The by-product stream dross / Fe posts to: it must exist, be active and be a by-product. */
async function streamByCode(ctx: Ctx, code: string) {
  const label = code === DROSS_STREAM ? "Dross" : "Fe";
  const [row] = await ctx.db
    .select()
    .from(returnStream)
    .where(and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.code, code)))
    .limit(1);
  if (!row) bad(`Add the ${label} return stream first (Masters → Return streams)`);
  if (!row.active) bad(`The ${label} return stream (${code}) is retired; reactivate it first (Masters → Return streams)`);
  if (row.kind !== "byproduct") bad(`The ${code} return stream must be a by-product stream to take ${label.toLowerCase()}`);
  return row;
}

/** EXISTS: the stream is still active and of `kind` (write-time guard for output streams). */
function activeStream(companyId: string, streamId: string, kind: "charge" | "byproduct") {
  return sql`exists (select 1 from ${returnStream} os where os.id = ${streamId} and os.company_id = ${companyId} and os.active = 1 and os.kind = ${kind})`;
}

/** The shape every melts.create caller gets back (a repeat with the same clientRequestId included). */
async function meltResult(ctx: Ctx, m: MeltRow) {
  const [c, mrs] = await Promise.all([
    loadCast(ctx, m.castId),
    ctx.db
      .select({ number: storeTxn.number })
      .from(meltChemical)
      .innerJoin(storeTxn, and(eq(storeTxn.id, meltChemical.storeTxnId), eq(storeTxn.companyId, meltChemical.companyId)))
      .where(and(eq(meltChemical.companyId, ctx.companyId), eq(meltChemical.meltId, m.id)))
      .orderBy(asc(meltChemical.line)),
  ]);
  return {
    id: m.id,
    castId: m.castId,
    castNumber: c.number,
    seq: m.seq,
    inputG: m.inputG,
    outputG: m.outputG,
    lossG: m.lossG,
    balanceBp: m.lossBp,
    balancePct: m.lossBp / 100,
    allowedBurnG: m.allowedBurnG,
    warnings: m.warnings,
    mrsNumbers: mrs.map((r) => r.number),
  };
}

/** A repeat of an earlier submit returns it; the same request id on another cast is a CONFLICT (RP18 pattern). */
function replayMelt(ctx: Ctx, prior: MeltRow, castId: string) {
  if (prior.castId !== castId) throw new TRPCError({ code: "CONFLICT", message: REQUEST_REUSED });
  return meltResult(ctx, prior);
}

async function meltByRequest(ctx: Ctx, requestId: string) {
  const [row] = await ctx.db
    .select()
    .from(melt)
    .where(and(eq(melt.companyId, ctx.companyId), eq(melt.clientRequestId, requestId)))
    .limit(1);
  return row;
}

function validateTimes(t: MeltCreateInput["timestamps"], at: Date, c: Pick<CastRow, "number" | "openedAt">) {
  const order = [t.preheatStart, t.chargingStart, t.chargingEnd, t.castingStart, t.castingEnd];
  const names = ["preheat start", "charging start", "charging end", "casting start", "casting end"];
  for (let i = 1; i < order.length; i += 1) {
    if (order[i]! < order[i - 1]!) bad(`The ${names[i]} is before the ${names[i - 1]}`);
  }
  if (t.castingEnd > at.getTime() + FUTURE_SLACK_MS) bad("The casting end is in the future");
  if (t.castingEnd - t.preheatStart > MAX_MELT_SPAN_MS) bad("Check the times: the melt runs over 3 days");
  if (t.preheatStart < c.openedAt.getTime() - MAX_MELT_BEFORE_CAST_MS) {
    bad(`The preheat start is more than 7 days before ${c.number} was opened; check the date`);
  }
}

type LedgerValues = typeof stockLedger.$inferInsert;

const meltsRouter = router({
  /**
   * Record a melt (cast.enter): inputs (lots by remaining kg, charge streams), chemicals (store
   * items are drawn now, RP17), outputs (logs, dross, Fe, returned metal), the five times and the
   * LDO dips. Returns the balance and its warnings.
   */
  create: actionProcedure("cast.enter")
    .input(meltCreateInput)
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const userId = ctx.session.user.id;
      if (input.clientRequestId) {
        const prior = await meltByRequest(ctx, input.clientRequestId);
        if (prior) return replayMelt(ctx, prior, input.castId);
      }
      const c = await loadCast(ctx, input.castId);
      if (c.status !== "open") bad(castStateMessage(c));
      if (input.alloy && input.alloy !== c.alloy) bad(`${c.number} is ${c.alloy}; open a new cast for ${input.alloy}`);
      const at = clockNow();
      validateTimes(input.timestamps, at, c);

      // Inputs
      const seen = new Set<string>();
      for (const i of input.inputs) {
        const key = `${i.kind}:${i.ref}`;
        if (seen.has(key)) bad(i.kind === "lot" ? "A lot is listed twice; put its kg on one line" : "A return stream is listed twice; put its kg on one line");
        seen.add(key);
      }
      const lotIds = input.inputs.filter((i) => i.kind === "lot").map((i) => i.ref);
      const lots = lotIds.length > 0 ? await lotsForMelt(ctx, lotIds) : new Map<string, LotForMelt>();
      for (const i of input.inputs.filter((x) => x.kind === "lot")) {
        const lot = lots.get(i.ref);
        if (!lot) throw new TRPCError({ code: "NOT_FOUND", message: "Lot not found" });
        if (lot.status !== "ok" || !lot.locationId) bad(`${lot.number} is not in scrap stock`);
        if (lot.remainingG < i.kgG) bad(`Only ${fmtKg(Math.max(lot.remainingG, 0))} kg left in ${lot.number}`);
      }
      const outReturns = input.outputs.returns;
      const returnIds = new Set<string>();
      for (const r of outReturns) {
        if (returnIds.has(r.streamId)) bad("A return stream is listed twice in the outputs");
        returnIds.add(r.streamId);
      }
      const streamIds = [...new Set([...input.inputs.filter((i) => i.kind === "return_stream").map((i) => i.ref), ...returnIds])];
      const streams = await streamsByIds(ctx, streamIds);
      for (const sid of streamIds) {
        const s = streams.get(sid);
        if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Return stream not found" });
        if (!s.active) bad(`${s.name} is retired`);
        if (s.kind !== "charge") bad(`${s.name} is a by-product; it is not charged or returned as metal`);
      }

      // Outputs
      const logs = input.outputs.logs;
      const hasLogs = logs.kgG > 0 || logs.pcs > 0;
      if (hasLogs && (logs.kgG === 0 || logs.pcs === 0 || logs.lengthMm === 0)) bad("Logs need pieces, length and kg together");
      const dross = input.outputs.drossG > 0 ? await streamByCode(ctx, DROSS_STREAM) : null;
      const fe = input.outputs.feG > 0 ? await streamByCode(ctx, FE_STREAM) : null;

      // Chemicals
      const storeIds = new Set<string>();
      for (const ch of input.chemicals) {
        if (ch.closeMilli !== ch.openMilli - ch.usedMilli) bad("For each chemical, close must be open minus used");
        if (ch.storeItemId) {
          if (ch.usedMilli < 1) bad("A store item needs the quantity used");
          if (storeIds.has(ch.storeItemId)) bad("A store item is listed twice");
          storeIds.add(ch.storeItemId);
        } else if (!ch.name) {
          bad("Name the chemical, or pick it from the store");
        }
      }
      const storeItems = new Map<string, StoreItemRow>();
      if (storeIds.size > 0) {
        const rows = await ctx.db
          .select()
          .from(storeItem)
          .where(and(eq(storeItem.companyId, companyId), inArray(storeItem.id, [...storeIds])));
        for (const r of rows) storeItems.set(r.id, r);
        if (storeItems.size !== storeIds.size) throw new TRPCError({ code: "NOT_FOUND", message: "Store item not found" });
      }

      // Locations
      const needsPlantScrap =
        input.inputs.some((i) => i.kind === "return_stream") || input.outputs.drossG > 0 || input.outputs.feG > 0 || outReturns.length > 0;
      const billet = hasLogs ? await resolveBilletStore(ctx.db, companyId) : null;
      const plantScrap = needsPlantScrap ? await resolvePlantScrap(ctx.db, companyId) : null;

      // Balance
      const inputG = input.inputs.reduce((s, i) => s + i.kgG, 0);
      const returnsG = outReturns.reduce((s, r) => s + r.kgG, 0);
      const outputG = logs.kgG + input.outputs.drossG + input.outputs.feG + returnsG;
      const bal = meltBalance({ inputG, outputG });
      const warnings: MeltWarning[] = [];
      if (bal.warning) warnings.push({ code: bal.warning, lossBp: bal.lossBp, limitBp: MELT_BALANCE_WARN_BP });
      if (!hasLogs) warnings.push({ code: "no_logs" });
      if (input.ldoTenthIn.end > input.ldoTenthIn.start) {
        warnings.push({ code: "ldo_rise", startTenthIn: input.ldoTenthIn.start, endTenthIn: input.ldoTenthIn.end });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const meltId = crypto.randomUUID();

      // Store draws: validated (and MRS numbers taken) before the batch; their statements join it.
      const draws = input.chemicals.filter((ch) => ch.storeItemId);
      const prepared: PreparedStoreDraws | null =
        draws.length > 0
          ? await prepareStoreDraws(ctx.db, {
              companyId,
              userId,
              seq,
              at,
              audit: auditCtx(ctx),
              // The draw belongs to this melt: store.cancel refuses it, melts.cancel reverses it (PL7RR).
              source: { type: "melt", id: meltId },
              draws: draws.map((d) => ({
                itemId: d.storeItemId!,
                qtyMilli: d.usedMilli,
                purpose: "melt" as const,
                refId: c.id,
                note: `Cast ${c.number}`,
              })),
            })
          : null;

      const meltLanded = sql`exists (select 1 from ${melt} ml where ml.id = ${meltId} and ml.company_id = ${companyId} and ml.server_seq = ${seq})`;
      const statements: SqliteBatchItem[] = [];

      // 1. The cast takes the melt: still open, still has its posting locations and output streams
      //    (input streams are guarded on their own lines below). Everything after lands only if this did.
      statements.push(
        ctx.db
          .update(cast)
          .set({ meltCount: sql`${cast.meltCount} + 1`, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(cast.id, c.id),
              eq(cast.companyId, companyId),
              eq(cast.status, "open"),
              billet ? activeLocation(companyId, billet.id, "billet_store") : undefined,
              plantScrap ? activeLocation(companyId, plantScrap.id, "wip") : undefined,
              dross ? activeStream(companyId, dross.id, "byproduct") : undefined,
              fe ? activeStream(companyId, fe.id, "byproduct") : undefined,
              ...outReturns.map((r) => activeStream(companyId, r.streamId, "charge")),
            ),
          ),
      );
      // 2. The melt row, numbered by the cast's melt count; lands only if step 1 did.
      const v = <T>(value: T) => sql`${value}`;
      const ldo = input.ldoTenthIn;
      const t = input.timestamps;
      statements.push(
        ctx.db.insert(melt).select(
          ctx.db
            .select({
              id: v(meltId).as("id"),
              companyId: sql<string>`${cast.companyId}`.as("company_id"),
              serverSeq: v(seq).as("server_seq"),
              castId: sql<string>`${cast.id}`.as("cast_id"),
              seq: sql<number>`${cast.meltCount}`.as("seq"),
              alloy: sql<string>`${cast.alloy}`.as("alloy"),
              // Wave 2 columns (0028): this path posts on create, so the melt is born locked.
              status: sql<string>`'locked'`.as("status"),
              furnaceId: sql`null`.as("furnace_id"),
              alloyId: sql<string | null>`${cast.alloyId}`.as("alloy_id"),
              preheatStartAt: v(t.preheatStart).as("preheat_start_at"),
              chargingStartAt: v(t.chargingStart).as("charging_start_at"),
              chargingEndAt: v(t.chargingEnd).as("charging_end_at"),
              castingStartAt: v(t.castingStart).as("casting_start_at"),
              castingEndAt: v(t.castingEnd).as("casting_end_at"),
              ldoStartTenthIn: v(ldo.start).as("ldo_start_tenth_in"),
              ldoChargingStartTenthIn: v(ldo.chargingStart ?? null).as("ldo_charging_start_tenth_in"),
              ldoChargingEndTenthIn: v(ldo.chargingEnd ?? null).as("ldo_charging_end_tenth_in"),
              ldoCastingStartTenthIn: v(ldo.castingStart ?? null).as("ldo_casting_start_tenth_in"),
              ldoEndTenthIn: v(ldo.end).as("ldo_end_tenth_in"),
              inputG: v(inputG).as("input_g"),
              logsPcs: v(logs.pcs).as("logs_pcs"),
              logsLengthMm: v(logs.lengthMm).as("logs_length_mm"),
              logsG: v(logs.kgG).as("logs_g"),
              drossG: v(input.outputs.drossG).as("dross_g"),
              feG: v(input.outputs.feG).as("fe_g"),
              returnsG: v(returnsG).as("returns_g"),
              outputG: v(outputG).as("output_g"),
              lossG: v(bal.lossG).as("loss_g"),
              lossBp: v(bal.lossBp).as("loss_bp"),
              allowedBurnG: v(bal.allowedBurnG).as("allowed_burn_g"),
              yieldBp: v(Math.round((logs.kgG * 10_000) / inputG)).as("yield_bp"),
              warnings: v(JSON.stringify(warnings)).as("warnings"),
              balanceNote: v(input.balanceNote).as("balance_note"),
              spectroReason: sql`null`.as("spectro_reason"),
              notes: v(input.notes).as("notes"),
              clientRequestId: v(input.clientRequestId ?? null).as("client_request_id"),
              lockedAt: v(at.getTime()).as("locked_at"),
              lockedBy: v(userId).as("locked_by"),
              cancelledAt: sql`null`.as("cancelled_at"),
              cancelledBy: sql`null`.as("cancelled_by"),
              cancelReason: sql`null`.as("cancel_reason"),
              createdBy: v(userId).as("created_by"),
              createdAt: v(at.getTime()).as("created_at"),
              updatedAt: sql`null`.as("updated_at"),
            })
            .from(cast)
            .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId), eq(cast.serverSeq, seq), eq(cast.status, "open"))),
        ),
      );
      // 3. Input lines, each guarded at write time (the melt landed; lot still OK with the kg; stream live).
      const ledgerRows: LedgerValues[] = [];
      const ledgerRow = (line: number, itemKind: LedgerValues["itemKind"], itemRef: string, locationId: string, qtyG: number, reason: string | null): LedgerValues => ({
        id: crypto.randomUUID(),
        companyId,
        serverSeq: seq,
        voucherType: "melt",
        voucherId: meltId,
        line,
        itemKind,
        itemRef,
        locationId,
        qtyG,
        postedAt: at,
        reversalOf: null,
        reason,
        createdBy: userId,
        createdAt: at,
      });
      input.inputs.forEach((inp, idx) => {
        const line = idx + 1;
        const lineId = crypto.randomUUID();
        if (inp.kind === "lot") {
          const lot = lots.get(inp.ref)!;
          const itemRef = `${lot.scrapItemId}:${lot.scrapGradeId}`;
          statements.push(
            ctx.db.insert(meltInput).select(
              ctx.db
                .select({
                  id: v(lineId).as("id"),
                  companyId: sql<string>`${purchaseLot.companyId}`.as("company_id"),
                  serverSeq: v(seq).as("server_seq"),
                  meltId: v(meltId).as("melt_id"),
                  line: v(line).as("line"),
                  kind: sql`'lot'`.as("kind"),
                  lotId: sql<string>`${purchaseLot.id}`.as("lot_id"),
                  returnStreamId: sql`null`.as("return_stream_id"),
                  itemRef: v(itemRef).as("item_ref"),
                  locationId: v(lot.locationId).as("location_id"),
                  kgG: v(inp.kgG).as("kg_g"),
                  createdBy: v(userId).as("created_by"),
                  createdAt: v(at.getTime()).as("created_at"),
                })
                .from(purchaseLot)
                .where(
                  and(
                    eq(purchaseLot.id, lot.id),
                    eq(purchaseLot.companyId, companyId),
                    eq(purchaseLot.status, "ok"),
                    eq(purchaseLot.locationId, lot.locationId!),
                    eq(purchaseLot.scrapItemId, lot.scrapItemId),
                    eq(purchaseLot.scrapGradeId, lot.scrapGradeId),
                    // Postings − pending bori − live draws (the same expression lots.available shows).
                    sql`${lotRemainingSql(companyId, OUTER_LOT_ID)} >= ${inp.kgG}`,
                    meltLanded,
                  ),
                ),
            ),
          );
          ledgerRows.push(ledgerRow(line, "scrap_grade", itemRef, lot.locationId!, -inp.kgG, lot.number));
        } else {
          statements.push(
            ctx.db.insert(meltInput).select(
              ctx.db
                .select({
                  id: v(lineId).as("id"),
                  companyId: sql<string>`${returnStream.companyId}`.as("company_id"),
                  serverSeq: v(seq).as("server_seq"),
                  meltId: v(meltId).as("melt_id"),
                  line: v(line).as("line"),
                  kind: sql`'return_stream'`.as("kind"),
                  lotId: sql`null`.as("lot_id"),
                  returnStreamId: sql<string>`${returnStream.id}`.as("return_stream_id"),
                  itemRef: sql<string>`${returnStream.id}`.as("item_ref"),
                  locationId: v(plantScrap!.id).as("location_id"),
                  kgG: v(inp.kgG).as("kg_g"),
                  createdBy: v(userId).as("created_by"),
                  createdAt: v(at.getTime()).as("created_at"),
                })
                .from(returnStream)
                .where(
                  and(
                    eq(returnStream.id, inp.ref),
                    eq(returnStream.companyId, companyId),
                    eq(returnStream.active, true),
                    eq(returnStream.kind, "charge"),
                    meltLanded,
                  ),
                ),
            ),
          );
          ledgerRows.push(ledgerRow(line, "return_stream", inp.ref, plantScrap!.id, -inp.kgG, streams.get(inp.ref)!.code));
        }
      });
      // 4. Abort the whole batch unless the melt and every input line landed.
      statements.push(
        foundryAbort(
          ctx.db,
          companyId,
          sql`(select count(*) from ${meltInput} ci where ci.company_id = ${companyId} and ci.melt_id = ${meltId}) < ${input.inputs.length}`,
        ),
      );
      // 5. Output lines and their ledger rows (lines continue after the inputs).
      type OutputValues = typeof meltOutput.$inferInsert;
      const outputRows: OutputValues[] = [];
      let line = input.inputs.length;
      const pushOutput = (
        kind: OutputValues["kind"],
        kgG: number,
        locationId: string,
        stream: { id: string; code: string } | null,
        pcs: number | null,
        lengthMm: number | null,
      ) => {
        line += 1;
        outputRows.push({
          id: crypto.randomUUID(),
          companyId,
          serverSeq: seq,
          meltId,
          line,
          kind,
          returnStreamId: stream?.id ?? null,
          pcs,
          lengthMm,
          kgG,
          locationId,
          createdBy: userId,
          createdAt: at,
        });
        ledgerRows.push(
          kind === "logs"
            ? ledgerRow(line, "billet", c.id, locationId, kgG, `${c.number} logs`)
            : ledgerRow(line, "return_stream", stream!.id, locationId, kgG, stream!.code),
        );
      };
      if (hasLogs) pushOutput("logs", logs.kgG, billet!.id, null, logs.pcs, logs.lengthMm);
      if (dross) pushOutput("dross", input.outputs.drossG, plantScrap!.id, dross, null, null);
      if (fe) pushOutput("fe", input.outputs.feG, plantScrap!.id, fe, null, null);
      for (const r of outReturns) pushOutput("return_stream", r.kgG, plantScrap!.id, streams.get(r.streamId)!, null, null);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltOutput).values(rows), outputRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(stockLedger).values(rows), ledgerRows);
      // 6. Store draws (each guarded by the store balance; their own abort fails the batch).
      if (prepared) statements.push(...prepared.statements);
      // 7. Chemical lines, linked to their MRS.
      let drawIdx = 0;
      const chemRows: (typeof meltChemical.$inferInsert)[] = input.chemicals.map((ch, idx) => {
        const item = ch.storeItemId ? storeItems.get(ch.storeItemId)! : null;
        const txnId = item ? prepared!.ids[drawIdx++]! : null;
        return {
          id: crypto.randomUUID(),
          companyId,
          serverSeq: seq,
          meltId,
          line: idx + 1,
          storeItemId: item?.id ?? null,
          name: item ? item.name : ch.name!,
          unit: item ? item.unit : (ch.unit ?? "kg"),
          openMilli: ch.openMilli,
          usedMilli: ch.usedMilli,
          closeMilli: ch.closeMilli,
          storeTxnId: txnId,
          createdBy: userId,
          createdAt: at,
        };
      });
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltChemical).values(rows), chemRows);
      // 8. Audit.
      statements.push(
        auditInsert(ctx, {
          action: "melt.create",
          subjectType: "melt",
          subjectId: meltId,
          meta: {
            castId: c.id,
            castNumber: c.number,
            inputG,
            outputG,
            lossG: bal.lossG,
            lossBp: bal.lossBp,
            warnings: warnings.map((w) => w.code),
            mrs: prepared?.numbers ?? [],
          },
        }),
      );

      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isFoundryAbort(e)) await explainMeltLost(ctx, c, input, lots);
        if (prepared && isStoreDrawAbort(e)) await prepared.explain();
        if (input.clientRequestId && isUniqueViolation(e, "melt.company_id, melt.client_request_id")) {
          const won = await meltByRequest(ctx, input.clientRequestId);
          if (won) return replayMelt(ctx, won, input.castId);
        }
        throw e;
      }
      const [created] = await ctx.db
        .select()
        .from(melt)
        .where(and(eq(melt.id, meltId), eq(melt.companyId, companyId)))
        .limit(1);
      if (!created) bad("The melt did not save; try again");
      return meltResult(ctx, created);
    }),

  /**
   * Cancel a melt (cast.enter or cast.close) while its cast is open: the melt keeps its number and
   * gets `cancelled_*`; every ledger row of the melt is reversed (`melt_cancel`, `reversal_of`);
   * its store draws are cancelled (store reversal rows); its lot kg is free again. Refused once the
   * cast's billets on hand are below what the melt made (the press used them).
   */
  cancel: anyActionProcedure("cast.enter", "cast.close")
    .input(z.object({ meltId: id, reason: z.string().trim().min(1, "Give a reason").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const [m] = await ctx.db
        .select()
        .from(melt)
        .where(and(eq(melt.id, input.meltId), eq(melt.companyId, companyId)))
        .limit(1);
      if (!m) throw new TRPCError(MELT_NOT_FOUND);
      if (m.cancelledAt) bad("This melt is already cancelled");
      const c = await loadCast(ctx, m.castId);
      if (c.status !== "open") bad(`${castStateMessage(c)}; its melts stay as they are`);
      const billetsSql = castBilletsOnHandSql(companyId, sql`${c.id}`);
      const [onHand] = await ctx.db
        .select({ g: billetsSql })
        .from(cast)
        .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId)))
        .limit(1);
      const billetsShort = () =>
        bad(`The press has already used billets of ${c.number}; this melt can no longer be cancelled`);
      if (Number(onHand?.g ?? 0) < m.logsG) billetsShort();
      const txns = await liveMeltDraws(ctx, m.id);
      const blocked = storeReturnBlock(txns);
      if (blocked) bad(blocked);

      const userId = ctx.session.user.id;
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const reason = input.reason;
      const orig = alias(stockLedger, "orig");
      const o = (col: string) => sql`${sql.identifier("orig")}.${sql.identifier(col)}`;
      const statements: SqliteBatchItem[] = [
        // The cast changes with its melt: a close that read the figures before this cancel then
        // refuses (it guards on the cast's server_seq), and sync clients see the cast move. The
        // abort below rolls this back when the melt itself does not cancel.
        ctx.db
          .update(cast)
          .set({ serverSeq: seq, updatedAt: at })
          .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId), eq(cast.status, "open"))),
        ctx.db
          .update(melt)
          .set({ cancelledAt: at, cancelledBy: userId, cancelReason: reason, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(melt.id, m.id),
              eq(melt.companyId, companyId),
              isNull(melt.cancelledAt),
              sql`exists (select 1 from ${cast} oc where oc.id = ${c.id} and oc.company_id = ${companyId} and oc.status = 'open' and oc.server_seq = ${seq})`,
              sql`${billetsSql} >= ${melt.logsG}`,
            ),
          ),
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${melt} mm where mm.id = ${m.id} and mm.company_id = ${companyId} and mm.server_seq = ${seq} and mm.cancelled_at is not null)`),
        ctx.db.insert(stockLedger).select(
          ctx.db
            .select({
              id: sqlUuid.as("id"),
              companyId: sql<string>`${o("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              voucherType: sql<LedgerVoucherType>`'melt_cancel'`.as("voucher_type"),
              voucherId: sql<string>`${o("voucher_id")}`.as("voucher_id"),
              line: sql<number>`${o("line")}`.as("line"),
              itemKind: sql<string>`${o("item_kind")}`.as("item_kind"),
              itemRef: sql<string>`${o("item_ref")}`.as("item_ref"),
              locationId: sql<string | null>`${o("location_id")}`.as("location_id"),
              qtyG: sql<number>`-${o("qty_g")}`.as("qty_g"),
              postedAt: sql<number>`max(${at.getTime()}, ${o("posted_at")} + 1)`.as("posted_at"),
              reversalOf: sql<string>`${o("id")}`.as("reversal_of"),
              reason: sql<string>`${reason}`.as("reason"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
            })
            .from(orig)
            .where(
              and(
                eq(orig.companyId, companyId),
                eq(orig.voucherType, "melt"),
                eq(orig.voucherId, m.id),
                sql`not exists (select 1 from ${stockLedger} r where r.company_id = ${companyId} and r.reversal_of = ${o("id")})`,
              ),
            ),
        ),
      ];
      for (const t of txns) {
        const cancelInput = { companyId, seq, txnId: t.id, exchangeId: null, userId, at, reason: `Melt cancelled: ${reason}` };
        statements.push(storeCancelRows(ctx.db, cancelInput), storeCancelMark(ctx.db, cancelInput));
      }
      if (txns.length > 0) {
        statements.push(
          foundryAbort(
            ctx.db,
            companyId,
            sql`(select count(*) from ${storeTxn} st where st.company_id = ${companyId} and st.server_seq = ${seq} and st.cancelled_at is not null and st.id in (${sql.join(
              txns.map((t) => sql`${t.id}`),
              sql`, `,
            )})) < ${txns.length}`,
          ),
        );
      }
      statements.push(
        auditInsert(ctx, {
          action: "melt.cancel",
          subjectType: "melt",
          subjectId: m.id,
          meta: { castId: c.id, castNumber: c.number, seq: m.seq, reason, storeTxns: txns.map((t) => t.id) },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isFoundryAbort(e)) {
          const [now] = await ctx.db.select().from(melt).where(and(eq(melt.id, m.id), eq(melt.companyId, companyId))).limit(1);
          if (now?.cancelledAt) bad("This melt is already cancelled");
          const castNow = await loadCast(ctx, c.id);
          if (castNow.status !== "open") bad(`${castStateMessage(castNow)}; its melts stay as they are`);
          const [h] = await ctx.db.select({ g: billetsSql }).from(cast).where(and(eq(cast.id, c.id), eq(cast.companyId, companyId))).limit(1);
          if (Number(h?.g ?? 0) < m.logsG) billetsShort();
          const drawsNow = await liveMeltDraws(ctx, m.id);
          const blockedNow = storeReturnBlock(drawsNow);
          if (blockedNow) bad(blockedNow);
          for (const d of txns) {
            const why = await diagnoseStoreCancel(ctx.db, companyId, d.id);
            if (why) throw why;
          }
          bad("The melt changed; open it again");
        }
        throw e;
      }
      return { id: m.id, cancelled: true as const };
    }),
});

/** The melt's store draws not cancelled yet, with what a cancel would return them to. */
async function liveMeltDraws(ctx: Ctx, meltId: string) {
  return ctx.db
    .select({
      id: storeTxn.id,
      number: storeTxn.number,
      itemName: storeItem.name,
      itemActive: storeItem.active,
      locationCode: location.code,
      locationActive: location.active,
      locationKind: location.kind,
    })
    .from(meltChemical)
    .innerJoin(storeTxn, and(eq(storeTxn.id, meltChemical.storeTxnId), eq(storeTxn.companyId, meltChemical.companyId)))
    .leftJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
    .leftJoin(location, and(eq(location.id, storeTxn.locationId), eq(location.companyId, storeTxn.companyId)))
    .where(and(eq(meltChemical.companyId, ctx.companyId), eq(meltChemical.meltId, meltId), isNull(storeTxn.cancelledAt)));
}

/**
 * Cancelling a melt puts its chemicals back in the store. Like `store.cancel` (ruling PL7RR), it
 * never puts stock on a retired item or into a retired / re-typed store location: this read gives
 * the melt-side message; `storeCancelRows` holds the same rule at write time (nothing lands, the
 * cancel's store abort fails the batch).
 */
function storeReturnBlock(draws: Awaited<ReturnType<typeof liveMeltDraws>>): string | null {
  for (const d of draws) {
    if (!d.itemActive) return `${d.itemName ?? d.number} is retired in the store; reactivate it first (cancelling the melt returns it)`;
    if (!d.locationActive || d.locationKind !== "store") {
      return `${d.locationCode ?? "The store location"} is retired; reactivate it first (cancelling the melt returns ${d.itemName ?? d.number} there)`;
    }
  }
  return null;
}

/** A melt batch aborted: say why from the state as it is now. */
async function explainMeltLost(ctx: Ctx, c: CastRow, input: MeltCreateInput, before: Map<string, LotForMelt>): Promise<never> {
  const now = await loadCast(ctx, c.id);
  if (now.status !== "open") bad(castStateMessage(now));
  const lotIds = [...before.keys()];
  if (lotIds.length > 0) {
    const lots = await lotsForMelt(ctx, lotIds);
    for (const i of input.inputs.filter((x) => x.kind === "lot")) {
      const lot = lots.get(i.ref);
      if (!lot || lot.status !== "ok") bad(`${before.get(i.ref)?.number ?? "A lot"} is no longer in scrap stock`);
      if (lot.remainingG < i.kgG) bad(`Only ${fmtKg(Math.max(lot.remainingG, 0))} kg left in ${lot.number}`);
    }
  }
  const streamIds = [
    ...new Set([...input.inputs.filter((x) => x.kind === "return_stream").map((x) => x.ref), ...input.outputs.returns.map((r) => r.streamId)]),
  ];
  const streams = await streamsByIds(ctx, streamIds);
  for (const sid of streamIds) {
    const s = streams.get(sid);
    if (!s || !s.active) bad(`${s?.name ?? "A return stream"} was retired`);
  }
  if (input.outputs.drossG > 0) await streamByCode(ctx, DROSS_STREAM);
  if (input.outputs.feG > 0) await streamByCode(ctx, FE_STREAM);
  const hasLogs = input.outputs.logs.kgG > 0 || input.outputs.logs.pcs > 0;
  if (hasLogs) await resolveBilletStore(ctx.db, ctx.companyId);
  if (streamIds.length > 0 || input.outputs.drossG > 0 || input.outputs.feG > 0) await resolvePlantScrap(ctx.db, ctx.companyId);
  bad("The foundry data changed; try again");
}

// ---------------------------------------------------------------------------
// Spectro
// ---------------------------------------------------------------------------

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decoded size of a well-formed base64 string, or null when it is not one. */
function base64Bytes(b64: string): number | null {
  if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

const spectroRouter = router({
  /**
   * Attach a spectro result to a melt (cast.enter): the printout, photo or results file as base64
   * (≤ 1 MB decoded) and/or the parsed values in percent (`{ Si: 0.45, Fe: 0.18 }`), stored as
   * integer ppm. A melt may carry several (re-tests). Stock is not affected.
   */
  attach: actionProcedure("cast.enter")
    .input(
      z.object({
        meltId: id,
        fileName: z.string().trim().min(1, "Name the file").max(120),
        mime: z.enum(SPECTRO_MIMES),
        base64: z.string().max(MAX_SPECTRO_BASE64, "The file is larger than 1 MB"),
        values: z.record(
          z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,7}$/, "Element like Si, Fe, Mg"),
          z.number().finite().min(0).max(100),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const size = base64Bytes(input.base64);
      if (size === null) bad("The file is not valid base64");
      if (size > MAX_SPECTRO_BYTES) bad("The file is larger than 1 MB");
      const entries = Object.entries(input.values);
      if (entries.length > MAX_SPECTRO_VALUES) bad(`At most ${MAX_SPECTRO_VALUES} values`);
      if (size === 0 && entries.length === 0) bad("Attach the file or enter the values");
      const [m] = await ctx.db
        .select({ id: melt.id, castId: melt.castId, cancelledAt: melt.cancelledAt })
        .from(melt)
        .where(and(eq(melt.id, input.meltId), eq(melt.companyId, ctx.companyId)))
        .limit(1);
      if (!m) throw new TRPCError(MELT_NOT_FOUND);
      if (m.cancelledAt) bad("This melt is cancelled");
      const valuesPpm = Object.fromEntries(entries.map(([k, val]) => [k, Math.round(val * 10_000)]));
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db.insert(spectroResult).values({
          id: rowId,
          companyId: ctx.companyId,
          serverSeq: seq,
          meltId: m.id,
          castId: m.castId,
          fileName: input.fileName,
          mime: input.mime,
          sizeBytes: size,
          dataBase64: input.base64,
          valuesPpm,
          createdBy: ctx.session.user.id,
        }),
        auditInsert(ctx, {
          action: "spectro.attach",
          subjectType: "spectro_result",
          subjectId: rowId,
          meta: { meltId: m.id, castId: m.castId, fileName: input.fileName, mime: input.mime, sizeBytes: size, valuesPpm },
        }),
      ]);
      return { id: rowId, sizeBytes: size };
    }),

  /** The stored file of a spectro result (any member of the company). */
  file: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({
        id: spectroResult.id,
        fileName: spectroResult.fileName,
        mime: spectroResult.mime,
        sizeBytes: spectroResult.sizeBytes,
        base64: spectroResult.dataBase64,
      })
      .from(spectroResult)
      .where(and(eq(spectroResult.id, input.id), eq(spectroResult.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    return row;
  }),
});

export const foundryRouter = router({
  returnStreams: returnStreamsRouter,
  lots: lotsRouter,
  casts: castsRouter,
  melts: meltsRouter,
  spectro: spectroRouter,
  /** W4-COLLECTORS (FP-FD-12): watcher files waiting for a person. */
  spectroInbox: spectroInboxRouter,
});
