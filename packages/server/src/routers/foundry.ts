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
  castCloseCheck,
  MELT_BALANCE_WARN_BP,
  MELT_TIME_KEYS,
  meltLockGates,
  meltBalance,
  PPM_TOTAL,
  reasonNoteMissing,
  SPECTRO_ELEMENTS,
  type SpectroElementKey,
  type SpectroVerdict,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { reasonCode } from "@orrn/db/schema/reasons";
import {
  alloy,
  cast,
  castStatuses,
  furnace,
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
import { location, stockLedger } from "@orrn/db/schema/stock";
import { storeItem, storeTxn, storeUnits, type StoreItemRow } from "@orrn/db/schema/store";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { TRPCMetaError } from "../lib/errorMeta";
import {
  activeLocation,
  castBilletsOnHandSql,
  castBilletsShortSql,
  castCloseout,
  castInputSql,
  castTailAdjustRow,
  type CastCloseout,
  castLiveMeltsSql,
  castLogsSql,
  castDraftMeltsSql,
  castTailSql,
  defaultReturnStreamStatements,
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
  assertStreamsCover,
  streamChargeAborts,
  streamCharges,
} from "../lib/foundry";
import { nameKey } from "../lib/purchase";
import { lostReplayRace, openReplay, readReplay, replayMeta, type Replay } from "../lib/requestReplay";
import { nextCompanySeq } from "../lib/sequence";
import {
  diagnoseStoreCancel,
  isStoreDrawAbort,
  MAX_STORE_DRAWS,
  MAX_STORE_QTY_MILLI,
  prepareStoreDraws,
  type PreparedStoreDraws,
} from "../lib/store";
import {
  activeStream,
  auditCtx,
  bad,
  castStateMessage,
  liveMeltDraws,
  loadCast,
  lotsForMelt,
  MELT_NOT_FOUND,
  meltReversalStatements,
  storeReturnBlock,
  streamByCode,
  streamsByIds,
  spectroJudge,
  type Ctx,
  type LotForMelt,
} from "../lib/foundryKit";
import { foundryMastersRouter } from "./foundryMasters";
import { MELT_GATE_TEXT, meltStepperProcedures } from "./foundryMelt";
import { foundryReadingsRouter, foundryStockRouter, foundryTraceProcedures } from "./foundryTrace";
import { spectroInboxRouter } from "./spectroInbox";


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

const REQUEST_REUSED = "That request id was already used for something else";

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
/** The physical billet count at close (Q59-A): pieces and grams, both zero or both above zero. */
const billetCount = z
  .object({
    count: z.number().int().min(0).max(1_000_000),
    kgG: grams,
  })
  .refine((b) => (b.count === 0) === (b.kgG === 0), { message: "Count the billets and weigh them together" });
const clientRequestId = z.string().trim().min(1).max(64).optional();
/** W2-FD-S replay key (the audit row records the first answer; a retry gets it back). */
const clientMutationId = z.string().trim().min(8).max(64).optional();

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
    // The one opening a stream may have (voucher = the stream): the screen stops offering it once posted.
    const hasOpening = sql<number>`exists (
      select 1 from ${stockLedger} ol
      where ol.company_id = ${ctx.companyId} and ol.voucher_type = 'opening' and ol.item_kind = 'return_stream'
        and ol.item_ref = ${sql.identifier("return_stream")}.${sql.identifier("id")}
    )`;
    const items = await ctx.db
      .select({
        id: returnStream.id,
        code: returnStream.code,
        name: returnStream.name,
        kind: returnStream.kind,
        active: returnStream.active,
        sortOrder: returnStream.sortOrder,
        balanceG: balance,
        hasOpening,
      })
      .from(returnStream)
      .where(eq(returnStream.companyId, ctx.companyId))
      .orderBy(asc(returnStream.sortOrder), asc(returnStream.code));
    return { items: items.map((s) => ({ ...s, balanceG: Number(s.balanceG), hasOpening: Number(s.hasOpening) === 1 })) };
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
    const before = await count();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ...defaultReturnStreamStatements(ctx.db, ctx.companyId, { userId: ctx.session.user.id, seq }),
      auditInsert(ctx, { action: "return_stream.seed", subjectType: "return_stream", subjectId: null }),
    ]);
    return { added: (await count()) - before };
  }),

  /**
   * Opening balance of a return stream (go-live, masters.publish): one `opening` ledger row of the kg
   * the plant holds of this stream at PLANT-SCRAP, so a fresh plant can lock its first melt (a melt
   * may not take more of a stream than the ledger holds). One per stream (voucher = the stream, line 1:
   * a second post, or a race, is refused); any later stock moves through melts, the press and the
   * count. Nothing is reversed by editing this: the ledger is append-only.
   */
  opening: actionProcedure("masters.publish")
    .input(z.object({ streamId: id, kgG: positiveGrams, note: optText(200) }))
    .mutation(async ({ ctx, input }) => {
      const stream = (await streamsByIds(ctx, [input.streamId])).get(input.streamId);
      if (!stream) throw new TRPCError({ code: "NOT_FOUND", message: "Return stream not found" });
      if (!stream.active) bad(`${stream.name} is retired`);
      const place = await resolvePlantScrap(ctx.db, ctx.companyId);
      const already = await ctx.db
        .select({ id: stockLedger.id })
        .from(stockLedger)
        .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.voucherType, "opening"), eq(stockLedger.itemKind, "return_stream"), eq(stockLedger.itemRef, stream.id)))
        .limit(1);
      if (already.length > 0) bad(`${stream.name} already has an opening balance`);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(stockLedger).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            voucherType: "opening",
            voucherId: stream.id,
            line: 1,
            itemKind: "return_stream",
            itemRef: stream.id,
            locationId: place.id,
            qtyG: input.kgG,
            postedAt: at,
            reason: input.note ?? "Opening balance",
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "return_stream.opening", subjectType: "return_stream", subjectId: stream.id, meta: { code: stream.code, kgG: input.kgG, note: input.note } }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e, "stock_ledger.company_id, stock_ledger.voucher_type, stock_ledger.voucher_id, stock_ledger.line")) bad(`${stream.name} already has an opening balance`);
        throw e;
      }
      return { id: stream.id, code: stream.code, kgG: input.kgG };
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

/** The cast's live summary columns (melt count, kg in, logs, billets on hand) for lists. */
function castSummaryFields(companyId: string) {
  return {
    liveMelts: castLiveMeltsSql(companyId, OUTER_CAST_ID),
    draftMelts: castDraftMeltsSql(companyId, OUTER_CAST_ID),
    inputG: castInputSql(companyId, OUTER_CAST_ID),
    logsG: castLogsSql(companyId, OUTER_CAST_ID),
    billetsOnHandG: castBilletsOnHandSql(companyId, OUTER_CAST_ID),
    billetsShortG: castBilletsShortSql(companyId, OUTER_CAST_ID),
  };
}

const castsRouter = router({
  /** W2-FD-S: trace (FP-FD-16/17), traceBundle, cost (FP-FD-20). */
  ...foundryTraceProcedures,
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
        draftMelts: Number(r.draftMelts),
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
          billetLengthMm: meltOutput.billetLengthMm,
          diameterMm: meltOutput.diameterMm,
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
          verdict: spectroResult.verdict,
          source: spectroResult.source,
          entryReason: spectroResult.entryReason,
          alPpm: spectroResult.alPpm,
          alSource: spectroResult.alSource,
          voidedAt: spectroResult.voidedAt,
          voidReason: spectroResult.voidReason,
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
      z
        .object({
          /** The alloy code (PL5 list) or, W2-FD-S, the alloy master row; one of them. */
          alloy: z.enum(CAST_ALLOYS).optional(),
          alloyId: id.optional(),
          grade: optText(20),
          notes: optText(500),
          clientRequestId,
        })
        .refine((v) => v.alloy !== undefined || v.alloyId !== undefined, { message: "Pick the alloy" }),
    )
    .mutation(async ({ ctx, input: raw }) => {
      // The alloy master row: picked by id, or found by the code (a plant with no master keeps the code only).
      let alloyId: string | null = null;
      let alloyCode: string;
      if (raw.alloyId) {
        const [a] = await ctx.db.select().from(alloy).where(and(eq(alloy.id, raw.alloyId), eq(alloy.companyId, ctx.companyId))).limit(1);
        if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Alloy not found" });
        if (a.status !== "active") bad(`Alloy ${a.code} is retired`);
        if (raw.alloy && raw.alloy !== a.code) bad(`Alloy ${a.code} is not ${raw.alloy}`);
        alloyId = a.id;
        alloyCode = a.code;
      } else {
        alloyCode = raw.alloy!;
        const [a] = await ctx.db.select({ id: alloy.id }).from(alloy).where(and(eq(alloy.companyId, ctx.companyId), eq(alloy.code, alloyCode), eq(alloy.status, "active"))).limit(1);
        alloyId = a?.id ?? null;
      }
      const input = { ...raw, alloy: alloyCode };
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
        alloyId,
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
   * The close-out a count would give, without closing (cast.close; the close screen's last step):
   * the same figures `casts.close` would write for this count. Server-computed; nothing is stored.
   */
  closePreview: actionProcedure("cast.close")
    .input(z.object({ castId: id, billetsOnHand: billetCount }))
    .query(async ({ ctx, input }) => {
      const c = await loadCast(ctx, input.castId);
      const co = await castCloseout(ctx.db, ctx.companyId, c.id);
      const check = countedClose(co, input.billetsOnHand);
      return {
        castId: c.id,
        number: c.number,
        status: c.status,
        producedG: co.producedG,
        creditedG: co.creditedG,
        ledgerOnHandG: co.billetsOnHandG,
        countedCount: input.billetsOnHand.count,
        countedG: input.billetsOnHand.kgG,
        tailG: check.tailG,
        tailBp: check.tailBp,
        shortG: check.shortG,
        adjustG: check.adjustG ?? 0,
        needsReason: check.needsReason,
        needsApproval: check.needsApproval,
        draftMelts: co.draftMelts,
      };
    }),

  /**
   * Close-out (cast.close: supervisor, manager, admin, owner; spec E4, Q59-A). The closer counts the
   * billets of the cast still in the yard (`billetsOnHand`: pieces and kg). Ledger on hand =
   * produced (Σ locked log kg) − billets the press used (its rows per cast, net of reopens);
   * tail = ledger on hand − counted. A non-zero tail, or billets short (the press logged more than
   * the store held, D22), needs a reason code (kind `cast_tail`); beyond 3 % of produced, or short,
   * the cast waits in `closing` for a `cast_close` approval (never the requester). The adjustment
   * (counted − ledger, one `cast_tail` billet row) posts with the close, or with the approval when
   * one is needed. The counted billets stay in stock on the cast: a later press run may still use
   * them (and is tracked against them). Refused while a melt is still a draft. The UPDATE re-checks
   * the figures it read (cast row, tail, on hand, no drafts), so a melt, cancel or press posting in
   * between makes it refuse. `clientMutationId` makes a retry answer the first close.
   */
  close: actionProcedure("cast.close")
    .input(
      z.object({
        castId: id,
        /** The physical count of the cast's billets left (Q59-A). Required: only a count finds a real tail. */
        billetsOnHand: billetCount,
        reasonCodeId: id.optional(),
        /** Free text beside the reason code (required for `other`). `tailReason` is the PL5 name. */
        note: optText(500),
        tailReason: optText(500),
        clientMutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const note = input.note ?? input.tailReason;
      const content = { castId: input.castId, billetsOnHand: input.billetsOnHand, reasonCodeId: input.reasonCodeId ?? null, note };
      let replay: Replay | null = input.clientMutationId ? await openReplay(ctx.db, ctx.companyId, "cast.close", input.clientMutationId, content) : null;
      if (replay?.prior?.replay) return replay.prior.replay as CastCloseAnswer;
      const c = await loadCast(ctx, input.castId);
      if (c.status !== "open") bad(c.status === "closed" ? `${c.number} is already closed` : castStateMessage(c));
      const co = await castCloseout(ctx.db, ctx.companyId, c.id);
      if (co.draftMelts > 0) bad(`${c.number} has a melt that is not locked; lock or discard it first`);
      const check = countedClose(co, input.billetsOnHand);
      const adjustG = check.adjustG ?? 0;
      let reason: { id: string; code: string; label: string } | null = null;
      if (check.needsReason || input.reasonCodeId) {
        if (!input.reasonCodeId) {
          if (check.shortG > 0) bad(`The press used ${fmtKg(check.shortG)} kg more billets of ${c.number} than the store held; pick a reason`);
          if (check.tailG > 0) bad(`${fmtKg(check.tailG)} kg of ${c.number} billets is not explained; pick a reason`);
          bad(`The count finds ${fmtKg(-check.tailG)} kg more billets of ${c.number} than the ledger; pick a reason`);
        }
        reason = await castTailReason(ctx, input.reasonCodeId, note);
      }
      const billetStore = adjustG !== 0 ? await resolveBilletStore(ctx.db, ctx.companyId) : null;
      const userId = ctx.session.user.id;
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const status = check.needsApproval ? ("closing" as const) : ("closed" as const);
      const approvalId = check.needsApproval ? crypto.randomUUID() : null;
      const summary: CastCloseSummary = {
        producedG: co.producedG,
        creditedG: co.creditedG,
        billetsOnHandG: co.billetsOnHandG,
        shortG: check.shortG,
        tailG: check.tailG,
        tailBp: check.tailBp,
        inputG: co.inputG,
        logsG: co.logsG,
        bundlesG: co.bundlesG,
        reasonCode: reason?.code ?? null,
        countedCount: input.billetsOnHand.count,
        countedG: input.billetsOnHand.kgG,
        adjustG,
        adjustLocationId: billetStore?.id ?? null,
      };
      const reasonText = reason ? (note ? `${reason.label}: ${note}` : reason.label) : note;
      const answer: CastCloseAnswer = {
        id: c.id,
        number: c.number,
        status,
        tailG: check.tailG,
        tailBp: check.tailBp,
        shortG: check.shortG,
        countedG: input.billetsOnHand.kgG,
        adjustG,
        approvalId,
      };
      const castId = sql`${c.id}`;
      const mine = and(eq(cast.id, c.id), eq(cast.companyId, ctx.companyId), eq(cast.serverSeq, seq), eq(cast.status, status));
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(cast)
          .set({
            status,
            closeRequestedAt: at,
            closeRequestedBy: userId,
            tailG: check.tailG,
            tailBp: check.tailBp,
            tailReason: reasonText,
            tailReasonCodeId: reason?.id ?? null,
            closeSummary: summary,
            closeApprovalId: approvalId,
            closedAt: check.needsApproval ? null : at,
            closedBy: check.needsApproval ? null : userId,
            serverSeq: seq,
            updatedAt: at,
          })
          .where(
            and(
              eq(cast.id, c.id),
              eq(cast.companyId, ctx.companyId),
              eq(cast.status, "open"),
              // Every melt save, lock, discard and cancel moves server_seq (melt_count alone misses a cancel).
              eq(cast.serverSeq, c.serverSeq),
              eq(cast.meltCount, c.meltCount),
              // The ledger the count was compared with is still the ledger (a press run or a cancel in
              // between would move it, and the tail with it).
              sql`${castTailSql(ctx.companyId, castId)} = ${co.tailG}`,
              sql`${castBilletsOnHandSql(ctx.companyId, castId)} = ${co.billetsOnHandG}`,
              sql`${castDraftMeltsSql(ctx.companyId, castId)} = 0`,
              billetStore ? activeLocation(ctx.companyId, billetStore.id, "billet_store") : undefined,
            ),
          ),
      ];
      if (adjustG !== 0 && !approvalId) {
        statements.push(
          castTailAdjustRow(ctx.db, {
            companyId: ctx.companyId,
            castId: c.id,
            qtyG: adjustG,
            locationId: billetStore!.id,
            seq,
            at,
            userId,
            reason: `${c.number} count at close${reasonText ? `: ${reasonText}` : ""}`,
            when: sql`exists (select 1 from ${cast} tc where tc.id = ${c.id} and tc.company_id = ${ctx.companyId} and tc.server_seq = ${seq} and tc.status = 'closed')`,
          }),
        );
      }
      if (approvalId) {
        statements.push(
          requestApprovalInsert(ctx, {
            id: approvalId,
            kind: "cast_close",
            subjectId: c.id,
            serverSeq: seq,
            requestNote: reasonText,
            meta: {
              number: c.number,
              year: c.year,
              producedG: co.producedG,
              inputG: co.inputG,
              ledgerOnHandG: co.billetsOnHandG,
              countedG: input.billetsOnHand.kgG,
              countedCount: input.billetsOnHand.count,
              adjustG,
              tailG: check.tailG,
              tailBp: check.tailBp,
              shortG: check.shortG,
              reasonCode: reason?.code ?? null,
            },
            guard: { from: cast, where: mine },
          }).statement,
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            id: replay?.id,
            action: check.needsApproval ? "cast.close_request" : "cast.close",
            subjectType: "cast",
            subjectId: c.id,
            meta: { number: c.number, ...summary, reason: reasonText, approvalId, ...replayMeta(replay, input.clientMutationId, answer) },
          },
          { from: cast, where: mine },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (lostReplayRace(e, replay)) {
          replay = await readReplay(ctx.db, ctx.companyId, replay!);
          if (replay.prior?.replay) return replay.prior.replay as CastCloseAnswer;
        }
        throw e;
      }
      const [landed] = await ctx.db.select({ id: cast.id }).from(cast).where(mine).limit(1);
      if (!landed) {
        const now = await loadCast(ctx, c.id);
        if (now.status !== "open") bad(castStateMessage(now));
        if (billetStore) await resolveBilletStore(ctx.db, ctx.companyId);
        bad(`${c.number} changed while you were closing it; check the close-out again`);
      }
      return answer;
    }),

  /**
   * Cancel a cast opened by mistake (cast.close): only while it has no locked melt and no draft.
   * Its number stays used (the series never reuses one).
   */
  cancel: actionProcedure("cast.close")
    .input(z.object({ castId: id, reason: z.string().trim().min(1, "Give a reason").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const c = await loadCast(ctx, input.castId);
      if (c.status === "cancelled") bad(`${c.number} is already cancelled`);
      if (c.status !== "open") bad(castStateMessage(c));
      const castId = sql`${c.id}`;
      const notEmpty = () => bad(`${c.number} has melts; cancel or discard them first`);
      const co = await castCloseout(ctx.db, ctx.companyId, c.id);
      if (co.liveMelts > 0 || co.draftMelts > 0 || co.billetsOnHandG !== 0) notEmpty();
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mine = and(eq(cast.id, c.id), eq(cast.companyId, ctx.companyId), eq(cast.serverSeq, seq), eq(cast.status, "cancelled"));
      await atomicBatch(ctx.db, [
        ctx.db
          .update(cast)
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: ctx.session.user.id, cancelReason: input.reason, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(cast.id, c.id),
              eq(cast.companyId, ctx.companyId),
              eq(cast.status, "open"),
              sql`${castLiveMeltsSql(ctx.companyId, castId)} = 0`,
              sql`${castDraftMeltsSql(ctx.companyId, castId)} = 0`,
              sql`${castBilletsOnHandSql(ctx.companyId, castId)} = 0`,
            ),
          ),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "foundry.cast.cancel", subjectType: "cast", subjectId: c.id, meta: { number: c.number, reason: input.reason } },
          { from: cast, where: mine },
        ),
      ]);
      const [landed] = await ctx.db.select({ id: cast.id }).from(cast).where(mine).limit(1);
      if (!landed) notEmpty();
      return { id: c.id, number: c.number, status: "cancelled" as const };
    }),
});

type CastCloseAnswer = {
  id: string;
  number: string;
  status: "closed" | "closing";
  tailG: number;
  tailBp: number | null;
  shortG: number;
  /** r1 (Q59-A): the count the closer gave, and the `cast_tail` row it posts (now, or on approval). */
  countedG: number;
  adjustG: number;
  approvalId: string | null;
};

/** The close check for a count (Q59-A): tail = ledger on hand − counted. */
function countedClose(co: CastCloseout, counted: { kgG: number }) {
  return castCloseCheck({ producedG: co.producedG, onHandG: co.billetsOnHandG, creditedG: co.creditedG, countedG: counted.kgG });
}

/** The closer's tail reason: an active `cast_tail` reason code of the company; `other` (or a code that asks) needs the note. */
async function castTailReason(ctx: Ctx, reasonCodeId: string, note: string | null) {
  // The id came from reasonCodes.list (which adds the defaults); no write here, so a close reads before it writes.
  const [row] = await ctx.db
    .select({ id: reasonCode.id, code: reasonCode.code, label: reasonCode.label, requiresNote: reasonCode.requiresNote })
    .from(reasonCode)
    .where(and(eq(reasonCode.id, reasonCodeId), eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, "cast_tail"), eq(reasonCode.active, true)))
    .limit(1);
  if (!row) bad("Pick why the billets do not add up");
  if (reasonNoteMissing({ code: row.code, requiresNote: row.requiresNote, note })) bad("Say what happened in the note");
  return row;
}

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
  /**
   * r1 (I-2): this one-step path locks the melt as it saves it, so it passes the stepper's lock gates;
   * no spectro result can exist yet, so the reason the melt is locked without one is required.
   */
  spectroReason: optText(500),
  notes: optText(500),
  clientRequestId,
});

type MeltCreateInput = z.infer<typeof meltCreateInput>;

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
  /** W2-FD-S stepper: save (draft), preview, lock, discard, requestCorrection, correct. */
  ...meltStepperProcedures,
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
      // r1 (I-2): the same lock gates as melts.lock (spec E4, C18): spectro reason (no result can exist
      // yet), furnace capacity (the single active furnace), the balance reason (3 % either way, or more
      // out than in), logs, times. Refused with the stepper's words and `meta.gates`.
      const furnaces = await ctx.db.select().from(furnace).where(and(eq(furnace.companyId, companyId), eq(furnace.status, "active"))).limit(2);
      const furnaceRow = furnaces.length === 1 ? furnaces[0]! : null;
      const lotsInG = input.inputs.filter((i) => i.kind === "lot").reduce((s, i) => s + i.kgG, 0);
      const gates = meltLockGates({
        status: "draft",
        inputsG: input.inputs.map((i) => i.kgG),
        logLinesG: hasLogs ? [logs.kgG] : [],
        chargingStartMs: input.timestamps.chargingStart,
        castingEndMs: input.timestamps.castingEnd,
        capacityG: furnaceRow?.capacityG ?? null,
        balance: meltBalance({ lotsG: lotsInG, streamsG: inputG - lotsInG, logsG: logs.kgG, drossG: input.outputs.drossG, feG: input.outputs.feG, returnsG }),
        balanceReason: input.balanceNote,
        spectroVerdict: null,
        spectroReason: input.spectroReason,
        timesMs: MELT_TIME_KEYS.map((k) => input.timestamps[k]),
      });
      if (gates.length > 0) throw new TRPCMetaError({ code: "BAD_REQUEST", message: MELT_GATE_TEXT[gates[0]!], meta: { gates } });
      // r1 (I-3): a stream is never charged below its ledger balance (net of what this melt puts back).
      const charges = plantScrap
        ? streamCharges(
            input.inputs.filter((i) => i.kind === "return_stream").map((i) => ({ streamId: i.ref, locationId: plantScrap.id, kgG: i.kgG })),
            outReturns.map((o) => ({ streamId: o.streamId, locationId: plantScrap.id, kgG: o.kgG })),
          )
        : [];
      const streamName = (sid: string) => streams.get(sid)?.name ?? "a return stream";
      await assertStreamsCover(ctx.db, companyId, charges, streamName);
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
              furnaceId: v(furnaceRow?.id ?? null).as("furnace_id"),
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
              spectroReason: v(input.spectroReason ?? null).as("spectro_reason"),
              notes: v(input.notes).as("notes"),
              clientRequestId: v(input.clientRequestId ?? null).as("client_request_id"),
              alloyReason: sql`null`.as("alloy_reason"),
              correctsMeltId: sql`null`.as("corrects_melt_id"),
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
      statements.push(...streamChargeAborts(ctx.db, companyId, charges));
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
        if (isFoundryAbort(e)) {
          await assertStreamsCover(ctx.db, companyId, charges, streamName);
          await explainMeltLost(ctx, c, input, lots);
        }
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
   * Cancel a locked melt (cast.close: supervisor, manager and up, spec E4; the foundry floor asks
   * for a correction instead, `melts.requestCorrection`) while its cast is open: the melt keeps its number and
   * gets `cancelled_*`; every ledger row of the melt is reversed (`melt_cancel`, `reversal_of`);
   * its store draws are cancelled (store reversal rows); its lot kg is free again. Refused once the
   * cast's billets on hand are below what the melt made (the press used them).
   */
  cancel: actionProcedure("cast.close")
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
      if (m.status === "draft") bad("This melt is not locked; discard the draft instead");
      const c = await loadCast(ctx, m.castId);
      if (c.status !== "open") bad(castStateMessage(c));
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
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: userId, cancelReason: reason, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(melt.id, m.id),
              eq(melt.companyId, companyId),
              eq(melt.status, "locked"),
              isNull(melt.cancelledAt),
              sql`exists (select 1 from ${cast} oc where oc.id = ${c.id} and oc.company_id = ${companyId} and oc.status = 'open' and oc.server_seq = ${seq})`,
              sql`${billetsSql} >= ${melt.logsG}`,
            ),
          ),
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${melt} mm where mm.id = ${m.id} and mm.company_id = ${companyId} and mm.server_seq = ${seq} and mm.cancelled_at is not null)`),
      ];
      statements.push(
        ...meltReversalStatements(ctx.db, {
          companyId,
          meltId: m.id,
          seq,
          at,
          userId,
          reason,
          storeTxnIds: txns.map((t) => t.id),
          storeReason: `Melt cancelled: ${reason}`,
        }),
      );
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
          if (castNow.status !== "open") bad(castStateMessage(castNow));
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

/** The melt a spectro result goes on: the company's, not cancelled. */
async function spectroMelt(ctx: Ctx, meltId: string) {
  const [m] = await ctx.db
    .select({ id: melt.id, castId: melt.castId, cancelledAt: melt.cancelledAt, status: melt.status, alloy: melt.alloy, alloyId: melt.alloyId })
    .from(melt)
    .where(and(eq(melt.id, meltId), eq(melt.companyId, ctx.companyId)))
    .limit(1);
  if (!m) throw new TRPCError(MELT_NOT_FOUND);
  if (m.cancelledAt || m.status === "cancelled") bad("This melt is cancelled");
  return m;
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
        /** r1 (I-4): with no file the numbers are typed, and typed numbers need the reason (as spectro.enter). */
        entryReason: optText(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const size = base64Bytes(input.base64);
      if (size === null) bad("The file is not valid base64");
      if (size > MAX_SPECTRO_BYTES) bad("The file is larger than 1 MB");
      const entries = Object.entries(input.values);
      if (entries.length > MAX_SPECTRO_VALUES) bad(`At most ${MAX_SPECTRO_VALUES} values`);
      if (size === 0 && entries.length === 0) bad("Attach the file or enter the values");
      // A result with no file is typed numbers: the same rule as spectro.enter (a reason, 1-500).
      if (size === 0 && !input.entryReason) bad("No file is attached; say why the numbers are typed");
      const m = await spectroMelt(ctx, input.meltId);
      const valuesPpm = Object.fromEntries(entries.map(([k, val]) => [k, Math.round(val * 10_000)]));
      const judged = await spectroJudge(ctx.db, ctx.companyId, { alloyId: m.alloyId, alloyCode: m.alloy }, valuesPpm);
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
          ...judged,
          source: size > 0 ? "file" : "typed",
          entryReason: size > 0 ? null : input.entryReason,
          createdBy: ctx.session.user.id,
        }),
        auditInsert(ctx, {
          action: "spectro.attach",
          subjectType: "spectro_result",
          subjectId: rowId,
          meta: { meltId: m.id, castId: m.castId, fileName: input.fileName, mime: input.mime, sizeBytes: size, valuesPpm, verdict: judged.verdict },
        }),
      ]);
      return { id: rowId, sizeBytes: size, verdict: judged.verdict };
    }),

  /**
   * Type the spectro numbers with no printout or file (melt.enter; spec E4 "manual entry with
   * reason"): integer ppm per element (0.45 % = 4500), a reason (the machine printer is down, …).
   * Judged against the alloy's limits like a file. A retry with the same `clientRequestId` returns it.
   */
  enter: actionProcedure("melt.enter")
    .input(
      z.object({
        meltId: id,
        valuesPpm: z.object(Object.fromEntries(SPECTRO_ELEMENTS.map((el) => [el, z.number().int().min(0).max(PPM_TOTAL).nullable().optional()])) as Record<SpectroElementKey, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>),
        entryReason: z.string().trim().min(1, "Say why the numbers are typed").max(500),
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prior = async () =>
        input.clientRequestId
          ? (
              await ctx.db
                .select({ id: spectroResult.id, meltId: spectroResult.meltId, verdict: spectroResult.verdict })
                .from(spectroResult)
                .where(and(eq(spectroResult.companyId, ctx.companyId), eq(spectroResult.clientRequestId, input.clientRequestId)))
                .limit(1)
            )[0]
          : undefined;
      const shape = (r: { id: string; meltId: string; verdict: SpectroVerdict | null }) => {
        if (r.meltId !== input.meltId) throw new TRPCError({ code: "CONFLICT", message: REQUEST_REUSED });
        return { id: r.id, verdict: r.verdict };
      };
      const before = await prior();
      if (before) return shape(before);
      const valuesPpm = Object.fromEntries(Object.entries(input.valuesPpm).filter(([, v]) => v != null)) as Record<string, number>;
      if (Object.keys(valuesPpm).length === 0) bad("Enter at least one element");
      const m = await spectroMelt(ctx, input.meltId);
      const judged = await spectroJudge(ctx.db, ctx.companyId, { alloyId: m.alloyId, alloyCode: m.alloy }, valuesPpm);
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(spectroResult).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            meltId: m.id,
            castId: m.castId,
            fileName: "typed",
            mime: "text/plain",
            sizeBytes: 0,
            dataBase64: "",
            valuesPpm,
            ...judged,
            source: "typed",
            entryReason: input.entryReason,
            clientRequestId: input.clientRequestId ?? null,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, {
            action: "spectro.attach",
            subjectType: "spectro_result",
            subjectId: rowId,
            meta: { meltId: m.id, castId: m.castId, source: "typed", valuesPpm, verdict: judged.verdict, entryReason: input.entryReason },
          }),
        ]);
      } catch (e) {
        if (input.clientRequestId && isUniqueViolation(e, "spectro_result.company_id, spectro_result.client_request_id")) {
          const won = await prior();
          if (won) return shape(won);
        }
        throw e;
      }
      return { id: rowId, verdict: judged.verdict };
    }),

  /**
   * Void a result entered on the wrong melt or with a wrong number (melt.enter), while its melt is
   * still a draft. A locked melt keeps the result it was locked with (a correction redoes it).
   */
  void: actionProcedure("melt.enter")
    .input(z.object({ id, reason: z.string().trim().min(1, "Give a reason").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select({ id: spectroResult.id, meltId: spectroResult.meltId, voidedAt: spectroResult.voidedAt, meltStatus: melt.status })
        .from(spectroResult)
        .innerJoin(melt, and(eq(melt.id, spectroResult.meltId), eq(melt.companyId, spectroResult.companyId)))
        .where(and(eq(spectroResult.id, input.id), eq(spectroResult.companyId, ctx.companyId)))
        .limit(1);
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (r.voidedAt) bad("This result is already void");
      if (r.meltStatus !== "draft") bad("The melt is locked; its spectro stays as it is");
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const gone = and(eq(spectroResult.id, r.id), eq(spectroResult.companyId, ctx.companyId), eq(spectroResult.serverSeq, seq));
      await atomicBatch(ctx.db, [
        ctx.db
          .update(spectroResult)
          .set({ voidedAt: at, voidedBy: ctx.session.user.id, voidReason: input.reason, serverSeq: seq })
          .where(
            and(
              eq(spectroResult.id, r.id),
              eq(spectroResult.companyId, ctx.companyId),
              isNull(spectroResult.voidedAt),
              sql`exists (select 1 from ${melt} vm where vm.id = ${r.meltId} and vm.company_id = ${ctx.companyId} and vm.status = 'draft')`,
            ),
          ),
        auditInsertGuarded(auditCtx(ctx), { action: "foundry.spectro.void", subjectType: "spectro_result", subjectId: r.id, meta: { meltId: r.meltId, reason: input.reason } }, { from: spectroResult, where: gone }),
      ]);
      const [landed] = await ctx.db.select({ id: spectroResult.id }).from(spectroResult).where(gone).limit(1);
      if (!landed) bad("The melt is locked; its spectro stays as it is");
      return { id: r.id, voided: true as const };
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
  /** W2-FD-S (FP-FD-01, 09): furnace and alloy masters. */
  ...foundryMastersRouter,
  returnStreams: returnStreamsRouter,
  lots: lotsRouter,
  casts: castsRouter,
  melts: meltsRouter,
  spectro: spectroRouter,
  /** W4-COLLECTORS (FP-FD-12): watcher files waiting for a person. */
  spectroInbox: spectroInboxRouter,
  /** W2-FD-S: billet stock by cast and alloy. */
  stock: foundryStockRouter,
  /** W2-FD-S: furnace readings (typed; FOUNDRY_SIMULATOR seam). */
  readings: foundryReadingsRouter,
});
