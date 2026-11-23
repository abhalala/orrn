/**
 * Foundry depth (XE parity lane FOUNDRY): homogenizing batches (#41), bought-in logs (#42), the log
 * and billet reject registers (#43), billet cutting and issue to a press floor (#44, #50). Spread into
 * `foundryRouter`, so the `foundry` module gates every mutation (lib/moduleGate.ts ROUTER_MODULE).
 *
 * Ledger (lib/foundryDepth.ts): logs and billets are item `billet` (item_ref = cast id); a cut moves
 * kg from the billet store to the rack and posts the end cuts to a return stream, an issue moves kg to
 * a press floor, a reject takes kg out to a return stream, a receipt posts a bought-in cast's logs. No
 * ledger row in homogenizing: the furnace is not a location (as ageing's oven is not).
 */
import { billetCutFigures, homogCutAllowance, homogRecipeError, homogSoak, HOMOG_DEFAULT_RECIPE, readFloorSettings, reasonNoteMissing } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { alloy, cast, furnace, melt, returnStream } from "@orrn/db/schema/foundry";
import { billetCut, billetCutMachines, billetIssue, foundryReject, foundryRejectKinds, homogBatch, homogBatchStatuses, homogLine, homogReading, logReceipt } from "@orrn/db/schema/foundryDepth";
import { pressLine } from "@orrn/db/schema/press";
import { vendor } from "@orrn/db/schema/purchase";
import { reasonCode } from "@orrn/db/schema/reasons";
import { location, stockLedger } from "@orrn/db/schema/stock";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { companyTimezone, zonedMidnightMs, zonedYmd } from "../lib/dayWindow";
import {
  checkDieFile,
  DIE_FILE_COMMIT_GRACE_MS,
  DIE_FILE_LIMITS,
  DIE_FILE_UPLOAD_TTL_MS,
  dieFileKindOfName,
  dieFileUploadUrl,
  dieFilesBucket,
  readUploadTicket,
  signDieFileUrl,
  signUploadTicket,
  ticketKey,
  type DieUploadTicket,
} from "../lib/dieFiles";
import { nextDocNumber } from "../lib/docNumber";
import { foundryAbort, isFoundryAbort, resolveBilletStore, resolvePlantScrap } from "../lib/foundry";
import {
  activePlaceSql,
  billetPlace,
  billetPlaces,
  castAt,
  castAtAbort,
  homogLeft,
  homogPcsAbort,
  homogWindow,
  type HomogWindow,
  keyedBatch,
  openFloorReplay,
  pressFloorFor,
  priorAnswer,
  voucherRows,
  type BilletPlaceKind,
} from "../lib/foundryDepth";
import { clientRequestIdSchema } from "../lib/importReplay";
import { replayMeta } from "../lib/requestReplay";
import { bad, loadCast, type Ctx } from "../lib/foundryKit";
import { companySettings } from "../lib/press";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const grams = z.number().int().min(1).max(100_000_000);
const pcs = z.number().int().min(1).max(100_000);
const note = z.string().trim().max(300).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Day like 2026-11-22");
const LIST_MAX = 200;
/** A floor write's replay key (AGENTS.md "Replay-safe floor writes"): a repeat answers the first result. */
const clientRequestId = clientRequestIdSchema.optional();

/** The request's content for its replay fingerprint: the input without its key. */
function contentOf<T extends { clientRequestId?: string }>(input: T): Omit<T, "clientRequestId"> {
  const { clientRequestId: _key, ...rest } = input;
  return rest;
}

const num = (v: unknown) => Number(v ?? 0);
const kgText = (g: number) => (g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** A plant day `YYYY-MM-DD` on the company clock. */
function plantDay(settings: Record<string, unknown>, ms: number): string {
  const y = zonedYmd(companyTimezone(settings), ms);
  return `${y.year}-${String(y.month).padStart(2, "0")}-${String(y.day).padStart(2, "0")}`;
}

/** The alloy master row by id, or by code (a plant with no master keeps the code only). */
async function resolveAlloy(ctx: Ctx, input: { alloyId?: string; alloy?: string }): Promise<{ id: string | null; code: string }> {
  if (input.alloyId) {
    const [a] = await ctx.db.select().from(alloy).where(and(eq(alloy.id, input.alloyId), eq(alloy.companyId, ctx.companyId))).limit(1);
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Alloy not found" });
    if (a.status !== "active") bad(`Alloy ${a.code} is retired`);
    return { id: a.id, code: a.code };
  }
  const code = (input.alloy ?? "").trim().toUpperCase();
  if (!code) bad("Pick the alloy");
  const [a] = await ctx.db.select({ id: alloy.id }).from(alloy).where(and(eq(alloy.companyId, ctx.companyId), eq(alloy.code, code), eq(alloy.status, "active"))).limit(1);
  return { id: a?.id ?? null, code };
}

/** A charge return stream by code (end cuts and rejects go back as scrap), active. */
async function chargeStream(ctx: Ctx, streamId: string | undefined): Promise<{ id: string; code: string; name: string }> {
  const where = streamId
    ? and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.id, streamId))
    : and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.code, "PLANT-SCRAP"));
  const [s] = await ctx.db.select().from(returnStream).where(where).limit(1);
  if (!s) {
    if (streamId) throw new TRPCError({ code: "NOT_FOUND", message: "Return stream not found" });
    bad("Add the plant scrap return stream first (Foundry → Stock)");
  }
  if (!s.active) bad(`${s.name} is retired`);
  if (s.kind !== "charge") bad(`${s.name} is not a stream the furnace takes back`);
  return { id: s.id, code: s.code, name: s.name };
}

/** Explain a failed foundry batch from what is true now. */
function abortOr(e: unknown, message: string): never {
  if (isFoundryAbort(e)) throw new TRPCError({ code: "CONFLICT", message });
  throw e;
}

// ---------------------------------------------------------------------------
// #41 Homogenizing
// ---------------------------------------------------------------------------

const HOMOG_NOT_FOUND = { code: "NOT_FOUND", message: "Homogenizing batch not found" } as const;

async function loadBatch(ctx: Pick<Ctx, "db" | "companyId">, batchId: string) {
  const [row] = await ctx.db.select().from(homogBatch).where(and(eq(homogBatch.id, batchId), eq(homogBatch.companyId, ctx.companyId))).limit(1);
  if (!row) throw new TRPCError(HOMOG_NOT_FOUND);
  return row;
}

/** Log pieces a cast has: its locked melts' logs, or the receipt of a bought-in cast. */
function castLogsPcsSql(companyId: string, castId: string) {
  return sql<number>`(coalesce((select sum(m.logs_pcs) from ${melt} m where m.company_id = ${companyId} and m.cast_id = ${castId} and m.status = 'locked' and m.cancelled_at is null), 0)
    + coalesce((select sum(r.pcs) from ${logReceipt} r where r.company_id = ${companyId} and r.cast_id = ${castId}), 0))`;
}

/** Log pieces of a cast on batches that are not void. */
function castOnBatchesPcsSql(companyId: string, castId: string) {
  return sql<number>`coalesce((select sum(l.pcs) from ${homogLine} l join ${homogBatch} b on b.id = l.batch_id and b.company_id = l.company_id
    where l.company_id = ${companyId} and l.cast_id = ${castId} and b.status <> 'void'), 0)`;
}

/** Log pieces a cast has and the pieces already on live batches. */
async function castLogPieces(ctx: Ctx, castId: string): Promise<{ logs: number; onBatches: number }> {
  const [r] = await ctx.db.all<{ logs: number; batched: number }>(sql`
    select ${castLogsPcsSql(ctx.companyId, castId)} as logs, ${castOnBatchesPcsSql(ctx.companyId, castId)} as batched`);
  return { logs: num(r?.logs), onBatches: num(r?.batched) };
}

const homog = router({
  list: companyProcedure
    .input(z.object({ status: z.enum(homogBatchStatuses).optional(), limit: z.number().int().min(1).max(LIST_MAX).default(50) }).default({ limit: 50 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: homogBatch.id,
          number: homogBatch.number,
          status: homogBatch.status,
          alloy: homogBatch.alloy,
          furnaceCode: furnace.code,
          targetTempX10: homogBatch.targetTempX10,
          soakMin: homogBatch.soakMin,
          inAt: homogBatch.inAt,
          outAt: homogBatch.outAt,
          soakOk: homogBatch.soakOk,
          soakedMin: homogBatch.soakedMin,
          createdAt: homogBatch.createdAt,
          pcs: sql<number>`coalesce((select sum(l.pcs) from ${homogLine} l where l.batch_id = ${homogBatch.id} and l.company_id = ${homogBatch.companyId}), 0)`,
          kgG: sql<number>`coalesce((select sum(l.kg_g) from ${homogLine} l where l.batch_id = ${homogBatch.id} and l.company_id = ${homogBatch.companyId}), 0)`,
        })
        .from(homogBatch)
        .innerJoin(furnace, and(eq(furnace.id, homogBatch.furnaceId), eq(furnace.companyId, homogBatch.companyId)))
        .where(and(eq(homogBatch.companyId, ctx.companyId), input.status ? eq(homogBatch.status, input.status) : undefined))
        .orderBy(desc(homogBatch.createdAt))
        .limit(input.limit);
      return { items: rows.map((r) => ({ ...r, pcs: num(r.pcs), kgG: num(r.kgG) })) };
    }),

  get: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const b = await loadBatch(ctx, input.id);
    const [f] = await ctx.db.select({ code: furnace.code, name: furnace.name }).from(furnace).where(and(eq(furnace.id, b.furnaceId), eq(furnace.companyId, ctx.companyId))).limit(1);
    const lines = await ctx.db
      .select({ id: homogLine.id, castId: homogLine.castId, castNumber: cast.number, pcs: homogLine.pcs, kgG: homogLine.kgG })
      .from(homogLine)
      .innerJoin(cast, and(eq(cast.id, homogLine.castId), eq(cast.companyId, homogLine.companyId)))
      .where(and(eq(homogLine.companyId, ctx.companyId), eq(homogLine.batchId, b.id)))
      .orderBy(asc(homogLine.createdAt));
    const readings = await ctx.db
      .select({ id: homogReading.id, at: homogReading.at, tempX10: homogReading.tempX10 })
      .from(homogReading)
      .where(and(eq(homogReading.companyId, ctx.companyId), eq(homogReading.batchId, b.id)))
      .orderBy(asc(homogReading.at))
      .limit(500);
    const soak = b.inAt
      ? homogSoak({
          readings: readings.map((r) => ({ at: r.at.getTime(), tempCX10: r.tempX10 })),
          recipe: { targetTempX10: b.targetTempX10, toleranceX10: b.toleranceX10, soakMin: b.soakMin },
          inAt: b.inAt.getTime(),
          outAt: b.outAt?.getTime() ?? null,
          now: clockNow().getTime(),
        })
      : null;
    return {
      batch: { ...b, furnaceCode: f?.code ?? "", furnaceName: f?.name ?? "" },
      lines,
      readings,
      soak: soak ? { verdict: soak.homogVerdict, inBandMin: soak.inBandMin, unknownMin: soak.unknownMin, aboveBandMin: soak.aboveBandMin, minX10: soak.minX10, maxX10: soak.maxX10, readingCount: soak.readingCount } : null,
    };
  }),

  /** A new batch in a homogenizing furnace, with the recipe frozen on it (default 580 °C ± 10 for 6 h). */
  create: actionProcedure("foundry.homog")
    .input(
      z.object({
        furnaceId: id,
        alloyId: id.optional(),
        alloy: z.string().trim().max(16).optional(),
        targetTempX10: z.number().int().optional(),
        toleranceX10: z.number().int().optional(),
        soakMin: z.number().int().optional(),
        note,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [f] = await ctx.db.select().from(furnace).where(and(eq(furnace.id, input.furnaceId), eq(furnace.companyId, ctx.companyId))).limit(1);
      if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Furnace not found" });
      if (f.status !== "active") bad(`${f.code} is retired`);
      if (f.kind !== "homogenizing") bad(`${f.code} is a melting furnace; pick a homogenizing furnace`);
      const a = await resolveAlloy(ctx, input);
      const recipe = {
        targetTempX10: input.targetTempX10 ?? HOMOG_DEFAULT_RECIPE.targetTempX10,
        toleranceX10: input.toleranceX10 ?? HOMOG_DEFAULT_RECIPE.toleranceX10,
        soakMin: input.soakMin ?? HOMOG_DEFAULT_RECIPE.soakMin,
      };
      const err = homogRecipeError(recipe);
      if (err === "temp_range") bad("Soak temperature must be 300 to 650 °C");
      if (err === "band_range") bad("The band must be 1 to 50 °C");
      if (err === "soak_range") bad("Soak time must be 10 minutes to 48 hours");
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "homog", at, ctx.session.user.id);
      const rowId = crypto.randomUUID();
      await atomicBatch(ctx.db, [
        ctx.db.insert(homogBatch).values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, number: doc.number, furnaceId: f.id, alloyId: a.id, alloy: a.code, ...recipe, note: input.note ?? null, createdBy: ctx.session.user.id }),
        auditInsert(ctx, { action: "foundry.homog.create", subjectType: "homog_batch", subjectId: rowId, meta: { number: doc.number, furnace: f.code, alloy: a.code, ...recipe } }),
      ]);
      return { id: rowId, number: doc.number };
    }),

  /** Put logs of a cast on a loading batch. The cast's alloy must be the batch's; pieces never exceed its logs. */
  addLine: actionProcedure("foundry.homog")
    .input(z.object({ batchId: id, castId: id, pcs, kgG: grams }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.batchId);
      if (b.status !== "loading") bad(`${b.number} is no longer loading`);
      const c = await loadCast(ctx, input.castId);
      if (c.status === "cancelled") bad(`${c.number} is cancelled`);
      if (c.alloy !== b.alloy) bad(`${c.number} is ${c.alloy}; this batch is ${b.alloy}`);
      const p = await castLogPieces(ctx, c.id);
      if (p.onBatches + input.pcs > p.logs) bad(`${c.number} has ${Math.max(0, p.logs - p.onBatches)} logs left to homogenize`);
      const lineId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(homogLine).values({ id: lineId, companyId: ctx.companyId, batchId: b.id, castId: c.id, pcs: input.pcs, kgG: input.kgG, createdBy: ctx.session.user.id }),
          foundryAbort(ctx.db, ctx.companyId, sql`not exists (select 1 from ${homogBatch} hb where hb.id = ${b.id} and hb.company_id = ${ctx.companyId} and hb.status = 'loading')`),
          // Two loads at once never put more pieces on batches than the cast has logs.
          foundryAbort(ctx.db, ctx.companyId, sql`${castOnBatchesPcsSql(ctx.companyId, c.id)} > ${castLogsPcsSql(ctx.companyId, c.id)}`),
          auditInsert(ctx, { action: "foundry.homog.load", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number, cast: c.number, pcs: input.pcs, kgG: input.kgG } }),
        ]);
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes("UNIQUE constraint failed: homog_line.batch_id, homog_line.cast_id")) bad(`${c.number} is already on ${b.number}`);
        if (isFoundryAbort(e) && (await loadBatch(ctx, b.id)).status === "loading") {
          const now = await castLogPieces(ctx, c.id);
          bad(`${c.number} has ${Math.max(0, now.logs - now.onBatches)} logs left to homogenize`);
        }
        abortOr(e, `${b.number} is no longer loading`);
      }
      return { id: lineId };
    }),

  removeLine: actionProcedure("foundry.homog")
    .input(z.object({ lineId: id }))
    .mutation(async ({ ctx, input }) => {
      const [l] = await ctx.db.select().from(homogLine).where(and(eq(homogLine.id, input.lineId), eq(homogLine.companyId, ctx.companyId))).limit(1);
      if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const b = await loadBatch(ctx, l.batchId);
      if (b.status !== "loading") bad(`${b.number} is no longer loading`);
      await atomicBatch(ctx.db, [
        ctx.db.delete(homogLine).where(and(eq(homogLine.id, l.id), eq(homogLine.companyId, ctx.companyId), sql`exists (select 1 from ${homogBatch} hb where hb.id = ${b.id} and hb.status = 'loading')`)),
        auditInsert(ctx, { action: "foundry.homog.unload", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number, castId: l.castId, pcs: l.pcs } }),
      ]);
      return { success: true };
    }),

  /** Into the furnace: the server clock is the start. One batch per furnace at a time. */
  start: actionProcedure("foundry.homog")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.id);
      if (b.status !== "loading") bad(`${b.number} is not loading`);
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)` }).from(homogLine).where(and(eq(homogLine.companyId, ctx.companyId), eq(homogLine.batchId, b.id)));
      if (num(n) === 0) bad("Load logs before the batch goes in");
      const at = clockNow();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.update(homogBatch).set({ status: "in_furnace", loadedAt: at, inAt: at, updatedAt: at }).where(and(eq(homogBatch.id, b.id), eq(homogBatch.companyId, ctx.companyId), eq(homogBatch.status, "loading"))),
          auditInsert(ctx, { action: "foundry.homog.start", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number } }),
        ]);
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes("homog_batch.company_id, homog_batch.furnace_id")) bad("Another batch is in this furnace; take it out first");
        throw e;
      }
      return { id: b.id, inAt: at };
    }),

  /** A typed furnace reading while the batch is in (°C ×10). */
  reading: actionProcedure("foundry.homog")
    .input(z.object({ batchId: id, tempX10: z.number().int().min(0).max(8_000), at: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.batchId);
      if (b.status !== "in_furnace" || !b.inAt) bad(`${b.number} is not in the furnace`);
      const now = clockNow().getTime();
      const at = input.at ?? now;
      if (at > now + 2 * 60_000) bad("A reading cannot be in the future");
      if (at < b.inAt!.getTime()) bad("A reading cannot be before the batch went in");
      const rowId = crypto.randomUUID();
      await atomicBatch(ctx.db, [
        ctx.db.insert(homogReading).values({ id: rowId, companyId: ctx.companyId, batchId: b.id, at: new Date(at), tempX10: input.tempX10, createdBy: ctx.session.user.id }),
        foundryAbort(ctx.db, ctx.companyId, sql`not exists (select 1 from ${homogBatch} hb where hb.id = ${b.id} and hb.company_id = ${ctx.companyId} and hb.status = 'in_furnace')`),
      ]).catch((e) => abortOr(e, `${b.number} is not in the furnace`));
      return { id: rowId };
    }),

  /** Out of the furnace: the soak is judged from the readings and frozen on the batch. */
  out: actionProcedure("foundry.homog")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.id);
      if (b.status !== "in_furnace" || !b.inAt) bad(`${b.number} is not in the furnace`);
      const at = clockNow();
      const readings = await ctx.db.select({ at: homogReading.at, tempX10: homogReading.tempX10 }).from(homogReading).where(and(eq(homogReading.companyId, ctx.companyId), eq(homogReading.batchId, b.id)));
      const soak = homogSoak({
        readings: readings.map((r) => ({ at: r.at.getTime(), tempCX10: r.tempX10 })),
        recipe: { targetTempX10: b.targetTempX10, toleranceX10: b.toleranceX10, soakMin: b.soakMin },
        inAt: b.inAt!.getTime(),
        outAt: at.getTime(),
        now: at.getTime(),
      });
      await atomicBatch(ctx.db, [
        ctx.db.update(homogBatch).set({ status: "out", outAt: at, soakedMin: soak.inBandMin, soakOk: soak.met, updatedAt: at }).where(and(eq(homogBatch.id, b.id), eq(homogBatch.companyId, ctx.companyId), eq(homogBatch.status, "in_furnace"))),
        auditInsert(ctx, { action: "foundry.homog.out", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number, soakedMin: soak.inBandMin, verdict: soak.homogVerdict } }),
      ]);
      return { id: b.id, verdict: soak.homogVerdict, soakedMin: soak.inBandMin };
    }),

  /**
   * The verdict. A batch whose soak passed is released. One that did not is held, unless a reason is
   * given: then it is released with that reason on record. A held batch releases only with a reason.
   */
  release: actionProcedure("foundry.homogRelease")
    .input(z.object({ id, note: z.string().trim().min(3).max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.id);
      if (b.status !== "out" && b.status !== "held") bad(`${b.number} is not out of the furnace`);
      if (b.status === "held" && !input.note) bad("Say why a held batch is released");
      const released = b.soakOk === true || Boolean(input.note);
      const at = clockNow();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(homogBatch)
          .set(released ? { status: "released", releasedAt: at, releasedBy: ctx.session.user.id, decisionNote: input.note ?? null, updatedAt: at } : { status: "held", updatedAt: at })
          .where(and(eq(homogBatch.id, b.id), eq(homogBatch.companyId, ctx.companyId), eq(homogBatch.status, b.status))),
        auditInsert(ctx, { action: released ? "foundry.homog.release" : "foundry.homog.hold", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number, soakOk: b.soakOk, note: input.note ?? null } }),
      ]);
      return { id: b.id, status: released ? ("released" as const) : ("held" as const) };
    }),

  void: actionProcedure("foundry.homogRelease")
    .input(z.object({ id, note: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const b = await loadBatch(ctx, input.id);
      if (b.status === "released" || b.status === "void") bad(`${b.number} is ${b.status === "void" ? "already void" : "released"}`);
      const at = clockNow();
      await atomicBatch(ctx.db, [
        ctx.db.update(homogBatch).set({ status: "void", decisionNote: input.note, updatedAt: at }).where(and(eq(homogBatch.id, b.id), eq(homogBatch.companyId, ctx.companyId), ne(homogBatch.status, "released"))),
        auditInsert(ctx, { action: "foundry.homog.void", subjectType: "homog_batch", subjectId: b.id, meta: { number: b.number, note: input.note } }),
      ]);
      return { id: b.id };
    }),
});

// ---------------------------------------------------------------------------
// #42 Bought-in logs
// ---------------------------------------------------------------------------

const RECEIPT_NOT_FOUND = { code: "NOT_FOUND", message: "Log receipt not found" } as const;
/** Mill test certificates sit in the die-files bucket under a 4-part key the purge knows (lib/dieFilesPurge.ts). */
const mtcSection = (receiptId: string) => `mtc-${receiptId}`;

async function loadReceipt(ctx: Pick<Ctx, "db" | "companyId">, receiptId: string) {
  const [r] = await ctx.db.select().from(logReceipt).where(and(eq(logReceipt.id, receiptId), eq(logReceipt.companyId, ctx.companyId))).limit(1);
  if (!r) throw new TRPCError(RECEIPT_NOT_FOUND);
  return r;
}

type ReceiveAnswer = { id: string; number: string; castId: string };

const logs = router({
  receipts: companyProcedure
    .input(z.object({ limit: z.number().int().min(1).max(LIST_MAX).default(50) }).default({ limit: 50 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: logReceipt.id,
          number: logReceipt.number,
          castId: logReceipt.castId,
          vendorName: vendor.name,
          alloy: logReceipt.alloy,
          receivedOn: logReceipt.receivedOn,
          diameterMm: logReceipt.diameterMm,
          lengthMm: logReceipt.lengthMm,
          pcs: logReceipt.pcs,
          kgG: logReceipt.kgG,
          vendorCastNo: logReceipt.vendorCastNo,
          challanNo: logReceipt.challanNo,
          mtcName: logReceipt.mtcName,
          note: logReceipt.note,
        })
        .from(logReceipt)
        .innerJoin(vendor, and(eq(vendor.id, logReceipt.vendorId), eq(vendor.companyId, logReceipt.companyId)))
        .where(eq(logReceipt.companyId, ctx.companyId))
        .orderBy(desc(logReceipt.receivedOn), desc(logReceipt.createdAt))
        .limit(input.limit);
      return { items: rows.map((r) => ({ ...r, hasMtc: Boolean(r.mtcName) })) };
    }),

  /**
   * Logs from a vendor: a new receipt `OL-n`, a bought-in cast with the same number (closed at once, it
   * takes no melts) and + kg of billets at the billet store. A bundle pressed from them traces to the vendor.
   */
  receive: actionProcedure("foundry.logs")
    .input(
      z.object({
        vendorId: id,
        alloyId: id.optional(),
        alloy: z.string().trim().max(16).optional(),
        receivedOn: day,
        diameterMm: z.number().int().min(20).max(1_000).optional(),
        lengthMm: z.number().int().min(100).max(10_000).optional(),
        pcs,
        kgG: grams,
        vendorCastNo: z.string().trim().max(40).optional(),
        challanNo: z.string().trim().max(40).optional(),
        note,
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Before any check or number: a retry of a receipt that landed answers it and burns no OL number.
      const replay = await openFloorReplay(ctx.db, ctx.companyId, "foundry.logs.receive", input.clientRequestId, contentOf(input));
      const prior = priorAnswer<ReceiveAnswer>(replay);
      if (prior) return prior;
      const [v] = await ctx.db.select().from(vendor).where(and(eq(vendor.id, input.vendorId), eq(vendor.companyId, ctx.companyId))).limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
      if (v.status !== "active") bad(`${v.name} is not an active vendor`);
      const a = await resolveAlloy(ctx, input);
      const settings = await companySettings(ctx.db, ctx.companyId);
      const at = clockNow();
      if (input.receivedOn > plantDay(settings, at.getTime())) bad("The receipt date cannot be in the future");
      const store = await resolveBilletStore(ctx.db, ctx.companyId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "log_receipt", at, ctx.session.user.id);
      const [y, m] = input.receivedOn.split("-").map(Number);
      const castId = crypto.randomUUID();
      const receiptId = crypto.randomUUID();
      const userId = ctx.session.user.id;
      const answer: ReceiveAnswer = { id: receiptId, number: doc.number, castId };
      const won = await keyedBatch<ReceiveAnswer>(
        ctx.db,
        ctx.companyId,
        replay,
        [
          ctx.db.insert(cast).values({
            id: castId,
            companyId: ctx.companyId,
            serverSeq: seq,
            number: doc.number,
            // Its own period key, so a bought-in cast never takes a seq of the plant's cast book.
            period: `OL-${doc.period}`,
            year: y!,
            month: m!,
            seq: doc.seq,
            alloy: a.code,
            alloyId: a.id,
            status: "closed",
            source: "bought_in",
            notes: input.vendorCastNo ? `${v.name} cast ${input.vendorCastNo}` : v.name,
            openedAt: at,
            closedAt: at,
            closedBy: userId,
            createdBy: userId,
          }),
          ctx.db.insert(logReceipt).values({
            id: receiptId,
            companyId: ctx.companyId,
            serverSeq: seq,
            number: doc.number,
            vendorId: v.id,
            castId,
            alloyId: a.id,
            alloy: a.code,
            receivedOn: input.receivedOn,
            diameterMm: input.diameterMm ?? null,
            lengthMm: input.lengthMm ?? null,
            pcs: input.pcs,
            kgG: input.kgG,
            vendorCastNo: input.vendorCastNo ?? null,
            challanNo: input.challanNo ?? null,
            locationId: store.id,
            note: input.note ?? null,
            createdBy: userId,
          }),
          ...voucherRows(ctx.db, {
            companyId: ctx.companyId,
            voucherType: "log_receipt",
            voucherId: receiptId,
            seq,
            at,
            userId,
            lines: [{ itemKind: "billet", itemRef: castId, locationId: store.id, qtyG: input.kgG, reason: `${doc.number} logs from ${v.name}` }],
          }),
          foundryAbort(ctx.db, ctx.companyId, sql`not ${activePlaceSql(ctx.companyId, store.id, ["billet_store"])}`),
          auditInsert(ctx, {
            id: replay?.id,
            action: "foundry.logs.receive",
            subjectType: "log_receipt",
            subjectId: receiptId,
            meta: {
              number: doc.number,
              vendor: v.name,
              alloy: a.code,
              pcs: input.pcs,
              kgG: input.kgG,
              vendorCastNo: input.vendorCastNo ?? null,
              ...replayMeta(replay, input.clientRequestId, answer),
            },
          }),
        ],
        (e) => abortOr(e, `The billet store ${store.code} was retired; reactivate it first`),
      );
      return won ?? { ...answer, replayed: false };
    }),

  /** Step 1 of a mill test certificate upload (PDF or photo): a signed PUT into the die-files bucket. */
  beginMtc: actionProcedure("foundry.logs")
    .input(z.object({ id, name: z.string().trim().min(1).max(200), size: z.number().int().min(0).max(DIE_FILE_LIMITS.pdf + 1), mime: z.string().max(100).default("") }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReceipt(ctx, input.id);
      const kind = dieFileKindOfName(input.name);
      if (kind !== "pdf" && kind !== "image") bad("The mill test certificate must be a PDF or a photo");
      const contentType = checkDieFile(kind, { filename: input.name, contentType: input.mime, bytes: input.size });
      dieFilesBucket();
      const expiresAt = clockNow().getTime() + DIE_FILE_UPLOAD_TTL_MS;
      const ticket: DieUploadTicket = {
        v: 1,
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        sectionId: mtcSection(r.id),
        dieInstanceId: null,
        fileId: crypto.randomUUID(),
        kind,
        name: input.name,
        size: input.size,
        contentType,
        pressDrawing: false,
        exp: expiresAt,
      };
      const uploadId = await signUploadTicket(ticket);
      return { uploadId, uploadUrl: dieFileUploadUrl(ctx, uploadId), method: "PUT" as const, headers: { "content-type": contentType }, expiresAt };
    }),

  /** Step 3: after the PUT, the certificate becomes the receipt's (the object must be there, whole). */
  commitMtc: actionProcedure("foundry.logs")
    .input(z.object({ id, uploadId: z.string().min(1).max(4100) }))
    .mutation(async ({ ctx, input }) => {
      const r = await loadReceipt(ctx, input.id);
      const ticket = await readUploadTicket(input.uploadId, clockNow().getTime(), DIE_FILE_COMMIT_GRACE_MS);
      if (!ticket || ticket.companyId !== ctx.companyId || ticket.userId !== ctx.session.user.id || ticket.sectionId !== mtcSection(r.id)) throw new TRPCError(RECEIPT_NOT_FOUND);
      const bucket = dieFilesBucket();
      const key = ticketKey(ticket);
      const head = await bucket.head(key);
      if (!head || head.size !== ticket.size) {
        if (head) await bucket.delete(key).catch(() => undefined);
        bad("The upload did not finish; try again");
      }
      await atomicBatch(ctx.db, [
        ctx.db.update(logReceipt).set({ mtcKey: key, mtcName: ticket.name }).where(and(eq(logReceipt.companyId, ctx.companyId), eq(logReceipt.id, r.id))),
        auditInsert(ctx, { action: "foundry.logs.mtc", subjectType: "log_receipt", subjectId: r.id, meta: { number: r.number, name: ticket.name, bytes: head!.size } }),
      ]);
      return { success: true };
    }),

  /** A 10-minute signed link to the certificate (any member). */
  mtcUrl: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const r = await loadReceipt(ctx, input.id);
    if (!r.mtcKey) throw new TRPCError(RECEIPT_NOT_FOUND);
    return signDieFileUrl(ctx, ctx.companyId, r.mtcKey);
  }),
});

// ---------------------------------------------------------------------------
// #44 Cutting, #50 issue and floor stock
// ---------------------------------------------------------------------------

/** The plant's only active billet rack, else a refusal (a rack is needed before the first cut). */
async function soleRack(ctx: Ctx): Promise<{ id: string; code: string }> {
  const racks = (await billetPlaces(ctx.db, ctx.companyId, { activeOnly: true })).filter((p) => p.kind === "billet_rack");
  if (racks.length === 0) bad("Add a billet rack location first (Masters → Locations)");
  if (racks.length > 1) bad("Pick the billet rack the billets go to");
  return racks[0]!;
}

/**
 * The homogenizing gate for logs leaving the billet store (#41, fix round 1): on only when the plant
 * setting is on and the cast is 6xxx. `pcs` = homogenized log pieces not yet cut or issued whole.
 */
async function homogGate(ctx: Ctx, c: { id: string; alloy: string | null; source: "melt" | "bought_in" }): Promise<{ on: boolean; pcs: number; w: HomogWindow }> {
  const settings = readFloorSettings(await companySettings(ctx.db, ctx.companyId));
  const w = homogWindow(settings.foundry);
  const on = homogCutAllowance({ required: settings.foundry.requireHomogenizing, alloy: c.alloy, source: c.source, releasedPcs: 0, cutPcs: 0 }) !== null;
  if (!on) return { on, pcs: Number.POSITIVE_INFINITY, w };
  return { on, pcs: Math.max(0, (await homogLeft(ctx.db, ctx.companyId, c.id, w)).pcs), w };
}

type CutAnswer = { id: string; endG: number; yieldBp: number };
type IssueAnswer = { id: string };

const billets = router({
  /** Billet places (store, racks, press floors) with the press each floor serves, and the active press lines. */
  places: companyProcedure.query(async ({ ctx }) => {
    const places = await billetPlaces(ctx.db, ctx.companyId);
    const lines = await ctx.db.select({ id: pressLine.id, code: pressLine.code, name: pressLine.name, status: pressLine.status }).from(pressLine).where(eq(pressLine.companyId, ctx.companyId)).orderBy(asc(pressLine.code)).limit(50);
    return { places, pressLines: lines };
  }),

  /**
   * Logs and billets on hand by place and cast (one GROUP BY over the billet ledger). Floors carry their
   * press line, so the screen shows floor stock per press. A negative figure means the press logged more
   * than was issued to its floor.
   */
  stock: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.all<{ location_id: string | null; cast_id: string; g: number; number: string; alloy: string; source: string }>(sql`
      select l.location_id, l.item_ref as cast_id, sum(l.qty_g) as g, c.number, c.alloy, c.source
      from ${stockLedger} l join ${cast} c on c.id = l.item_ref and c.company_id = l.company_id
      where l.company_id = ${ctx.companyId} and l.item_kind = 'billet'
      group by l.location_id, l.item_ref
      having sum(l.qty_g) <> 0
      order by c.number`);
    const places = await billetPlaces(ctx.db, ctx.companyId);
    const lines = await ctx.db.select({ id: pressLine.id, code: pressLine.code }).from(pressLine).where(eq(pressLine.companyId, ctx.companyId));
    const lineCode = new Map(lines.map((l) => [l.id, l.code]));
    const byPlace = places.map((p) => {
      const casts = rows.filter((r) => r.location_id === p.id).map((r) => ({ castId: r.cast_id, number: r.number, alloy: r.alloy, source: r.source as "melt" | "bought_in", kgG: num(r.g) }));
      return { ...p, pressLineCode: p.pressLineId ? (lineCode.get(p.pressLineId) ?? null) : null, kgG: casts.reduce((t, c) => t + c.kgG, 0), casts };
    });
    const unplaced = rows.filter((r) => r.location_id == null || !places.some((p) => p.id === r.location_id)).reduce((t, r) => t + num(r.g), 0);
    return { places: byPlace, otherG: unplaced };
  }),

  /**
   * Cut logs of a cast into billets of one length on the saw or the hot shear: −log kg at the billet
   * store, +billet kg at the rack, end cuts (log − billet kg) to a return stream at plant scrap.
   */
  cut: actionProcedure("foundry.billets")
    .input(
      z.object({
        castId: id,
        machine: z.enum(billetCutMachines),
        logPcs: pcs,
        logG: grams,
        billetLengthMm: z.number().int(),
        billetPcs: pcs,
        billetG: grams,
        fromLocationId: id.optional(),
        toLocationId: id.optional(),
        endStreamId: id.optional(),
        note,
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // First: a retry of a cut that took the logs answers the first cut, not "only 0 kg at BILLET".
      const replay = await openFloorReplay(ctx.db, ctx.companyId, "foundry.billets.cut", input.clientRequestId, contentOf(input));
      const prior = priorAnswer<CutAnswer>(replay);
      if (prior) return prior;
      const c = await loadCast(ctx, input.castId);
      if (c.status === "cancelled") bad(`${c.number} is cancelled`);
      const f = billetCutFigures(input);
      if (!f.ok) {
        if (f.error === "more_out_than_in") bad("Billets cannot weigh more than the logs they were cut from");
        if (f.error === "length_range") bad("Billet length must be 100 to 2,000 mm");
        bad(f.error === "no_logs" ? "Enter the logs cut and their kg" : "Enter the billets and their kg");
      }
      const from = input.fromLocationId ? await billetPlace(ctx.db, ctx.companyId, input.fromLocationId, ["billet_store"]) : await resolveBilletStore(ctx.db, ctx.companyId);
      const to = input.toLocationId ? await billetPlace(ctx.db, ctx.companyId, input.toLocationId, ["billet_rack"]) : await soleRack(ctx);
      const gate = await homogGate(ctx, c);
      const homogRefusal = (allowed: number): never =>
        bad(allowed === 0 ? `Homogenize the logs of ${c.number} before cutting them` : `Only ${allowed} logs of ${c.number} have been homogenized and not cut`);
      if (gate.on && input.logPcs > gate.pcs) homogRefusal(gate.pcs);
      const have = await castAt(ctx.db, ctx.companyId, c.id, from.id);
      if (have < input.logG) bad(`Only ${kgText(Math.max(0, have))} kg of ${c.number} is at ${from.code}`);
      const stream = await chargeStream(ctx, input.endStreamId);
      const scrap = await resolvePlantScrap(ctx.db, ctx.companyId);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const rowId = crypto.randomUUID();
      const userId = ctx.session.user.id;
      const answer: CutAnswer = { id: rowId, endG: f.endG, yieldBp: f.yieldBp };
      const won = await keyedBatch<CutAnswer>(
        ctx.db,
        ctx.companyId,
        replay,
        [
          ctx.db.insert(billetCut).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            castId: c.id,
            machine: input.machine,
            logPcs: input.logPcs,
            logG: input.logG,
            billetLengthMm: input.billetLengthMm,
            billetPcs: input.billetPcs,
            billetG: input.billetG,
            endG: f.endG,
            yieldBp: f.yieldBp,
            fromLocationId: from.id,
            toLocationId: to.id,
            endStreamId: stream.id,
            cutAt: at,
            note: input.note ?? null,
            createdBy: userId,
          }),
          ...voucherRows(ctx.db, {
            companyId: ctx.companyId,
            voucherType: "billet_cut",
            voucherId: rowId,
            seq,
            at,
            userId,
            lines: [
              { itemKind: "billet", itemRef: c.id, locationId: from.id, qtyG: -input.logG, reason: `${c.number} logs cut` },
              { itemKind: "billet", itemRef: c.id, locationId: to.id, qtyG: input.billetG, reason: `${c.number} billets ${input.billetLengthMm} mm` },
              { itemKind: "return_stream", itemRef: stream.id, locationId: scrap.id, qtyG: f.endG, reason: `${c.number} end cuts` },
            ],
          }),
          castAtAbort(ctx.db, ctx.companyId, c.id, from.id),
          foundryAbort(ctx.db, ctx.companyId, sql`not ${activePlaceSql(ctx.companyId, to.id, ["billet_rack"])}`),
          // Two cuts at once never cut more logs than came out of released batches.
          ...(gate.on ? [homogPcsAbort(ctx.db, ctx.companyId, c.id, gate.w)] : []),
          auditInsert(ctx, {
            id: replay?.id,
            action: "foundry.billets.cut",
            subjectType: "billet_cut",
            subjectId: rowId,
            meta: {
              cast: c.number,
              machine: input.machine,
              logPcs: input.logPcs,
              logG: input.logG,
              billetPcs: input.billetPcs,
              billetG: input.billetG,
              endG: f.endG,
              yieldBp: f.yieldBp,
              ...replayMeta(replay, input.clientRequestId, answer),
            },
          }),
        ],
        async (e) => {
          // Say which guard tripped, from what is true now.
          if (isFoundryAbort(e) && gate.on) {
            const now = await homogGate(ctx, c);
            if (input.logPcs > now.pcs) homogRefusal(now.pcs);
          }
          abortOr(e, `The logs of ${c.number} at ${from.code} changed; check the stock and cut again`);
        },
      );
      return won ?? { ...answer, replayed: false };
    }),

  cuts: companyProcedure
    .input(z.object({ from: day.optional(), to: day.optional(), limit: z.number().int().min(1).max(LIST_MAX).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: billetCut.id,
          castId: billetCut.castId,
          castNumber: cast.number,
          alloy: cast.alloy,
          machine: billetCut.machine,
          logPcs: billetCut.logPcs,
          logG: billetCut.logG,
          billetLengthMm: billetCut.billetLengthMm,
          billetPcs: billetCut.billetPcs,
          billetG: billetCut.billetG,
          endG: billetCut.endG,
          yieldBp: billetCut.yieldBp,
          cutAt: billetCut.cutAt,
          note: billetCut.note,
        })
        .from(billetCut)
        .innerJoin(cast, and(eq(cast.id, billetCut.castId), eq(cast.companyId, billetCut.companyId)))
        .where(eq(billetCut.companyId, ctx.companyId))
        .orderBy(desc(billetCut.cutAt))
        .limit(input.limit);
      const logG = rows.reduce((t, r) => t + r.logG, 0);
      const billetG = rows.reduce((t, r) => t + r.billetG, 0);
      return { items: rows, totals: { logG, billetG, endG: logG - billetG, yieldBp: logG > 0 ? Math.floor((billetG * 10_000) / logG) : null } };
    }),

  /** Billets to a press floor: −kg at the store or rack, +kg at the floor of that press. */
  issue: actionProcedure("foundry.billets")
    .input(z.object({ castId: id, pressLineId: id, fromLocationId: id, pcs, kgG: grams, note, clientRequestId }))
    .mutation(async ({ ctx, input }) => {
      const replay = await openFloorReplay(ctx.db, ctx.companyId, "foundry.billets.issue", input.clientRequestId, contentOf(input));
      const prior = priorAnswer<IssueAnswer>(replay);
      if (prior) return prior;
      const c = await loadCast(ctx, input.castId);
      if (c.status === "cancelled") bad(`${c.number} is cancelled`);
      const [line] = await ctx.db.select({ id: pressLine.id, code: pressLine.code }).from(pressLine).where(and(eq(pressLine.id, input.pressLineId), eq(pressLine.companyId, ctx.companyId))).limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
      const floor = await pressFloorFor(ctx.db, ctx.companyId, line.id);
      if (!floor) bad(`Add a press floor location for ${line.code} first (Masters → Locations)`);
      const from = await billetPlace(ctx.db, ctx.companyId, input.fromLocationId, ["billet_store", "billet_rack"]);
      // Whole logs from the store to a press pass the same homogenizing gate as a cut (a rack holds cut billets, already gated).
      const gate = from.kind === "billet_store" ? await homogGate(ctx, c) : { on: false, pcs: Number.POSITIVE_INFINITY, w: { since: 0, toleranceBp: 0 } };
      const homogRefusal = (allowed: number): never =>
        bad(allowed === 0 ? `Homogenize the logs of ${c.number} before issuing them` : `Only ${allowed} logs of ${c.number} have been homogenized and not cut or issued`);
      if (gate.on && input.pcs > gate.pcs) homogRefusal(gate.pcs);
      const have = await castAt(ctx.db, ctx.companyId, c.id, from.id);
      if (have < input.kgG) bad(`Only ${kgText(Math.max(0, have))} kg of ${c.number} is at ${from.code}`);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const rowId = crypto.randomUUID();
      const userId = ctx.session.user.id;
      const answer: IssueAnswer = { id: rowId };
      const won = await keyedBatch<IssueAnswer>(
        ctx.db,
        ctx.companyId,
        replay,
        [
          ctx.db.insert(billetIssue).values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, castId: c.id, pressLineId: line.id, fromLocationId: from.id, toLocationId: floor!.id, pcs: input.pcs, kgG: input.kgG, issuedAt: at, note: input.note ?? null, createdBy: userId }),
          ...voucherRows(ctx.db, {
            companyId: ctx.companyId,
            voucherType: "billet_issue",
            voucherId: rowId,
            seq,
            at,
            userId,
            lines: [
              { itemKind: "billet", itemRef: c.id, locationId: from.id, qtyG: -input.kgG, reason: `${c.number} to ${line.code}` },
              { itemKind: "billet", itemRef: c.id, locationId: floor!.id, qtyG: input.kgG, reason: `${c.number} from ${from.code}` },
            ],
          }),
          castAtAbort(ctx.db, ctx.companyId, c.id, from.id),
          foundryAbort(ctx.db, ctx.companyId, sql`not ${activePlaceSql(ctx.companyId, floor!.id, ["press_floor"])}`),
          ...(gate.on ? [homogPcsAbort(ctx.db, ctx.companyId, c.id, gate.w)] : []),
          auditInsert(ctx, {
            id: replay?.id,
            action: "foundry.billets.issue",
            subjectType: "billet_issue",
            subjectId: rowId,
            meta: { cast: c.number, press: line.code, from: from.code, pcs: input.pcs, kgG: input.kgG, ...replayMeta(replay, input.clientRequestId, answer) },
          }),
        ],
        async (e) => {
          if (isFoundryAbort(e) && gate.on) {
            const now = await homogGate(ctx, c);
            if (input.pcs > now.pcs) homogRefusal(now.pcs);
          }
          abortOr(e, `The billets of ${c.number} at ${from.code} changed; check the stock and issue again`);
        },
      );
      return won ?? { ...answer, replayed: false };
    }),

  issues: companyProcedure
    .input(z.object({ pressLineId: id.optional(), limit: z.number().int().min(1).max(LIST_MAX).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: billetIssue.id,
          castId: billetIssue.castId,
          castNumber: cast.number,
          alloy: cast.alloy,
          pressLineId: billetIssue.pressLineId,
          pressCode: pressLine.code,
          fromCode: location.code,
          pcs: billetIssue.pcs,
          kgG: billetIssue.kgG,
          issuedAt: billetIssue.issuedAt,
          note: billetIssue.note,
        })
        .from(billetIssue)
        .innerJoin(cast, and(eq(cast.id, billetIssue.castId), eq(cast.companyId, billetIssue.companyId)))
        .innerJoin(pressLine, and(eq(pressLine.id, billetIssue.pressLineId), eq(pressLine.companyId, billetIssue.companyId)))
        .innerJoin(location, and(eq(location.id, billetIssue.fromLocationId), eq(location.companyId, billetIssue.companyId)))
        .where(and(eq(billetIssue.companyId, ctx.companyId), input.pressLineId ? eq(billetIssue.pressLineId, input.pressLineId) : undefined))
        .orderBy(desc(billetIssue.issuedAt))
        .limit(input.limit);
      return { items: rows };
    }),
});

// ---------------------------------------------------------------------------
// #43 Reject registers
// ---------------------------------------------------------------------------

/** Where a rejected piece can lie: logs at the billet store; billets wherever billets are kept. */
const REJECT_PLACES: Record<(typeof foundryRejectKinds)[number], readonly BilletPlaceKind[]> = {
  log: ["billet_store"],
  billet: ["billet_store", "billet_rack", "press_floor"],
};

const rejects = router({
  list: companyProcedure
    .input(z.object({ kind: z.enum(foundryRejectKinds), from: day.optional(), to: day.optional(), limit: z.number().int().min(1).max(LIST_MAX).default(100) }))
    .query(async ({ ctx, input }) => {
      const tz = companyTimezone(await companySettings(ctx.db, ctx.companyId));
      const ymdOf = (d: string) => {
        const [y, m, dd] = d.split("-").map(Number);
        return { year: y!, month: m!, day: dd! };
      };
      const startOf = (d: string) => zonedMidnightMs(tz, ymdOf(d));
      const rows = await ctx.db
        .select({
          id: foundryReject.id,
          castId: foundryReject.castId,
          castNumber: cast.number,
          alloy: cast.alloy,
          locationCode: location.code,
          reasonCode: reasonCode.code,
          reasonLabel: reasonCode.label,
          reasonNote: foundryReject.reasonNote,
          pcs: foundryReject.pcs,
          kgG: foundryReject.kgG,
          streamCode: returnStream.code,
          rejectedAt: foundryReject.rejectedAt,
        })
        .from(foundryReject)
        .innerJoin(cast, and(eq(cast.id, foundryReject.castId), eq(cast.companyId, foundryReject.companyId)))
        .innerJoin(location, and(eq(location.id, foundryReject.locationId), eq(location.companyId, foundryReject.companyId)))
        .innerJoin(returnStream, and(eq(returnStream.id, foundryReject.streamId), eq(returnStream.companyId, foundryReject.companyId)))
        .leftJoin(reasonCode, and(eq(reasonCode.id, foundryReject.reasonCodeId), eq(reasonCode.companyId, foundryReject.companyId)))
        .where(
          and(
            eq(foundryReject.companyId, ctx.companyId),
            eq(foundryReject.kind, input.kind),
            input.from ? gte(foundryReject.rejectedAt, new Date(startOf(input.from))) : undefined,
            // The end day is whole: up to the next plant midnight.
            input.to ? lt(foundryReject.rejectedAt, new Date(zonedMidnightMs(tz, { ...ymdOf(input.to), day: ymdOf(input.to).day + 1 }))) : undefined,
          ),
        )
        .orderBy(desc(foundryReject.rejectedAt))
        .limit(input.limit);
      const byReason = new Map<string, { code: string; label: string; pcs: number; kgG: number }>();
      for (const r of rows) {
        const k = r.reasonCode ?? "other";
        const t = byReason.get(k) ?? { code: k, label: r.reasonLabel ?? k, pcs: 0, kgG: 0 };
        t.pcs += r.pcs;
        t.kgG += r.kgG;
        byReason.set(k, t);
      }
      return { items: rows, totals: { entries: rows.length, pcs: rows.reduce((t, r) => t + r.pcs, 0), kgG: rows.reduce((t, r) => t + r.kgG, 0), byReason: [...byReason.values()] } };
    }),

  /** Reject logs or billets with a reason: −kg where they lay, +kg back as scrap to a return stream. */
  create: actionProcedure("foundry.reject")
    .input(
      z.object({
        kind: z.enum(foundryRejectKinds),
        castId: id,
        locationId: id,
        reasonCodeId: id,
        note: z.string().trim().max(500).optional(),
        pcs,
        kgG: grams,
        streamId: id.optional(),
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const replay = await openFloorReplay(ctx.db, ctx.companyId, "foundry.reject", input.clientRequestId, contentOf(input));
      const prior = priorAnswer<{ id: string }>(replay);
      if (prior) return prior;
      const c = await loadCast(ctx, input.castId);
      if (c.status === "cancelled") bad(`${c.number} is cancelled`);
      const place = await billetPlace(ctx.db, ctx.companyId, input.locationId, REJECT_PLACES[input.kind]);
      const reasonKind = input.kind === "log" ? "log_reject" : "billet_reject";
      const [reason] = await ctx.db.select().from(reasonCode).where(and(eq(reasonCode.id, input.reasonCodeId), eq(reasonCode.companyId, ctx.companyId))).limit(1);
      if (!reason || reason.kind !== reasonKind) throw new TRPCError({ code: "NOT_FOUND", message: "Reason not found" });
      if (!reason.active) bad(`${reason.label} is retired`);
      if (reasonNoteMissing({ code: reason.code, requiresNote: reason.requiresNote, note: input.note })) bad("Add a note for this reason");
      const have = await castAt(ctx.db, ctx.companyId, c.id, place.id);
      if (have < input.kgG) bad(`Only ${kgText(Math.max(0, have))} kg of ${c.number} is at ${place.code}`);
      const stream = await chargeStream(ctx, input.streamId);
      const scrap = await resolvePlantScrap(ctx.db, ctx.companyId);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const rowId = crypto.randomUUID();
      const userId = ctx.session.user.id;
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(foundryReject).values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, kind: input.kind, castId: c.id, locationId: place.id, reasonCodeId: reason.id, reasonNote: input.note ?? null, pcs: input.pcs, kgG: input.kgG, streamId: stream.id, rejectedAt: at, createdBy: userId }),
        ...voucherRows(ctx.db, {
          companyId: ctx.companyId,
          voucherType: "foundry_reject",
          voucherId: rowId,
          seq,
          at,
          userId,
          lines: [
            { itemKind: "billet", itemRef: c.id, locationId: place.id, qtyG: -input.kgG, reason: `${c.number} ${input.kind} reject: ${reason.label}` },
            { itemKind: "return_stream", itemRef: stream.id, locationId: scrap.id, qtyG: input.kgG, reason: `${c.number} ${input.kind} reject` },
          ],
        }),
        castAtAbort(ctx.db, ctx.companyId, c.id, place.id),
        auditInsert(ctx, {
          id: replay?.id,
          action: input.kind === "log" ? "foundry.reject.log" : "foundry.reject.billet",
          subjectType: "foundry_reject",
          subjectId: rowId,
          meta: { cast: c.number, at: place.code, reason: reason.code, pcs: input.pcs, kgG: input.kgG, stream: stream.code, ...replayMeta(replay, input.clientRequestId, { id: rowId }) },
        }),
      ];
      const won = await keyedBatch<{ id: string }>(ctx.db, ctx.companyId, replay, statements, (e) =>
        abortOr(e, `The stock of ${c.number} at ${place.code} changed; check it and reject again`),
      );
      return won ?? { id: rowId, replayed: false };
    }),
});

/** Spread into `foundryRouter` (routers/foundry.ts). */
export const foundryDepthRouter = { homog, logs, billets, rejects };
