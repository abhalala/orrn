/**
 * The melt stepper (W2-FD-S; spec E4, FP-FD-03..08, 13): a melt is a DRAFT until it is locked.
 *
 * - `melts.save` (melt.enter) writes or rewrites a draft: furnace, alloy, the five times, LDO dips,
 *   charge lines (lots from purchase and return streams), chemicals, logs (count, length, kg),
 *   dross, Fe, metal returned to streams. A draft posts NOTHING (C18): no ledger, no store draw,
 *   and its lot kg stay free for others (`lotDrawnSql` counts locked melts only).
 * - `melts.lock` (melt.enter) runs the lock gates (times in order, kg in ≥ kg out or a reason,
 *   furnace capacity, spectro passed or a reason, alloy as the cast or a reason), then in ONE
 *   atomicBatch flips the melt to `locked`, posts its ledger rows, draws its store chemicals and
 *   re-checks every lot's remaining kg at write time. A retry with the same `clientMutationId`
 *   answers the first lock.
 * - `melts.discard` drops a draft (it keeps its number; nothing was posted).
 * - After lock nothing is edited. `melts.requestCorrection` (melt.correct) asks for approval
 *   `melt_correct` with a reason code; once approved, `melts.correct` reverses the locked melt
 *   (`melt_cancel` rows, store draws cancelled) and opens a draft copy (`corrects_melt_id`) to fix
 *   and lock again. The approval is used once (meta `usedAt`, `draftId`).
 */
import {
  FOUNDRY_LINE_MAX_G,
  MELT_BALANCE_WARN_BP,
  meltBalance,
  meltLockGates,
  reasonNoteMissing,
  type MeltLockError,
  type SpectroVerdict,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { alloy, cast, furnace, melt, meltChemical, meltInput, meltOutput, spectroResult, type MeltRow, type MeltWarning } from "@orrn/db/schema/foundry";
import { reasonCode } from "@orrn/db/schema/reasons";
import { stockLedger } from "@orrn/db/schema/stock";
import { storeItem, storeUnits, type StoreItemRow } from "@orrn/db/schema/store";

import { actionProcedure } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { TRPCMetaError } from "../lib/errorMeta";
import {
  activeLocation,
  castBilletsOnHandSql,
  DROSS_STREAM,
  FE_STREAM,
  fmtKg,
  foundryAbort,
  isFoundryAbort,
  isUniqueViolation,
  lotRemainingSql,
  resolveBilletStore,
  resolvePlantScrap,
  assertStreamsCover,
  streamChargeAborts,
  streamCharges,
} from "../lib/foundry";
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
  type Ctx,
  type LotForMelt,
} from "../lib/foundryKit";
import { lostReplayRace, openReplay, readReplay, replayMeta, type Replay } from "../lib/requestReplay";
import { nextCompanySeq } from "../lib/sequence";
import { isStoreDrawAbort, MAX_STORE_DRAWS, MAX_STORE_QTY_MILLI, prepareStoreDraws, type PreparedStoreDraws } from "../lib/store";


/** Input lines per melt (each lot line is one write-time guard at lock). */
const MAX_INPUTS = 60;
const MAX_RETURNS = 10;
const MAX_LOG_LINES = 10;
const MAX_MELT_SPAN_MS = 72 * 3_600_000;
const FUTURE_SLACK_MS = 10 * 60_000;
const MAX_TENTH_IN = 2_400;

const id = z.string().min(1).max(64);
const grams = z.number().int().min(0).max(FOUNDRY_LINE_MAX_G);
const positiveGrams = z.number().int().min(1).max(FOUNDRY_LINE_MAX_G);
const epochMs = z.number().int().min(Date.UTC(2020, 0, 1)).max(Date.UTC(2100, 0, 1));
const tenthIn = z.number().int().min(0).max(MAX_TENTH_IN);
const milli = z.number().int().min(0).max(MAX_STORE_QTY_MILLI);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));
const clientMutationId = z.string().trim().min(8).max(64).optional();

const saveInput = z.object({
  /** Rewrite this draft; without it a new draft is numbered on the cast. */
  meltId: id.optional(),
  castId: id,
  /** The draft's server_seq as last read: a save over someone else's newer save refuses. */
  expectedServerSeq: z.number().int().min(0).optional(),
  furnaceId: id.nullable().optional(),
  alloyId: id.nullable().optional(),
  alloyReason: optText(500),
  times: z
    .object({
      preheatStart: epochMs.nullable().optional(),
      chargingStart: epochMs.nullable().optional(),
      chargingEnd: epochMs.nullable().optional(),
      castingStart: epochMs.nullable().optional(),
      castingEnd: epochMs.nullable().optional(),
    })
    .default({}),
  ldoTenthIn: z
    .object({
      start: tenthIn.nullable().optional(),
      chargingStart: tenthIn.nullable().optional(),
      chargingEnd: tenthIn.nullable().optional(),
      castingStart: tenthIn.nullable().optional(),
      end: tenthIn.nullable().optional(),
    })
    .default({}),
  inputs: z.array(z.object({ kind: z.enum(["lot", "return_stream"]), ref: id, kgG: positiveGrams })).max(MAX_INPUTS).default([]),
  chemicals: z
    .array(
      z.object({
        storeItemId: id.optional(),
        name: z.string().trim().max(60).optional(),
        unit: z.enum(storeUnits).optional(),
        openMilli: milli,
        usedMilli: milli,
        closeMilli: milli,
      }),
    )
    .max(MAX_STORE_DRAWS)
    .default([]),
  /** Billets out: count, cast length, the length the press charges (defaults to it) and kg. */
  logs: z
    .array(
      z.object({
        pcs: z.number().int().min(1).max(10_000),
        lengthMm: z.number().int().min(1).max(20_000),
        billetLengthMm: z.number().int().min(1).max(20_000).optional(),
        kgG: positiveGrams,
      }),
    )
    .max(MAX_LOG_LINES)
    .default([]),
  drossG: grams.default(0),
  feG: grams.default(0),
  returns: z.array(z.object({ streamId: id, kgG: positiveGrams })).max(MAX_RETURNS).default([]),
  balanceNote: optText(500),
  spectroReason: optText(500),
  notes: optText(500),
  /** A retried first save returns the draft it made (unique per company). */
  clientRequestId: z.string().trim().min(1).max(64).optional(),
});
type SaveInput = z.infer<typeof saveInput>;

/** Lock gate → the sentence the floor reads (the screens map these through the refusal table). */
export const MELT_GATE_TEXT: Record<MeltLockError, string> = {
  not_draft: "This melt is already locked",
  times_out_of_order: "The melt times are out of order; check them",
  no_input: "Add what went into the furnace",
  no_logs: "Add the logs that came out",
  no_charging_start: "Write the charging start time",
  casting_before_charging: "Write the casting end time, after the charging start",
  over_capacity: "More metal than the furnace holds; check the kg",
  balance_reason_missing: "The kg in and out do not match; say why in the balance note",
  spectro_reason_missing: "Spectro has not passed; say why the melt is locked anyway",
  alloy_reason_missing: "This melt's alloy is not the cast's; say why",
  line_too_large: "A line is above 100 t; check the kg",
};

type InputRow = typeof meltInput.$inferInsert;
type OutputRow = typeof meltOutput.$inferInsert;
type ChemRow = typeof meltChemical.$inferInsert;
type LedgerRow = typeof stockLedger.$inferInsert;

/** The melt's figures from its lines (grams): what the lock stores and the stepper previews. */
function meltFigures(inputs: readonly Pick<InputRow, "kind" | "kgG">[], outputs: readonly Pick<OutputRow, "kind" | "kgG" | "pcs" | "lengthMm">[], ldo: { start: number | null; end: number | null }) {
  const sum = (rows: readonly { kgG: number }[]) => rows.reduce((s, r) => s + r.kgG, 0);
  const lotsG = sum(inputs.filter((i) => i.kind === "lot"));
  const streamsG = sum(inputs.filter((i) => i.kind === "return_stream"));
  const logs = outputs.filter((o) => o.kind === "logs");
  const logsG = sum(logs);
  const drossG = sum(outputs.filter((o) => o.kind === "dross"));
  const feG = sum(outputs.filter((o) => o.kind === "fe"));
  const returnsG = sum(outputs.filter((o) => o.kind === "return_stream"));
  const balance = meltBalance({ lotsG, streamsG, logsG, drossG, feG, returnsG });
  const inputG = balance.metalInG;
  const outputG = logsG + drossG + feG + returnsG;
  const band = Math.floor((inputG * MELT_BALANCE_WARN_BP) / 10_000);
  const warnings: MeltWarning[] = [];
  if (inputG > 0 && balance.burnG < 0) warnings.push({ code: "out_exceeds_in", lossBp: balance.balanceBp ?? 0, limitBp: MELT_BALANCE_WARN_BP });
  else if (inputG > 0 && balance.burnG > band) warnings.push({ code: "loss_high", lossBp: balance.balanceBp ?? 0, limitBp: MELT_BALANCE_WARN_BP });
  if (logsG === 0) warnings.push({ code: "no_logs" });
  if (ldo.start != null && ldo.end != null && ldo.end > ldo.start) warnings.push({ code: "ldo_rise", startTenthIn: ldo.start, endTenthIn: ldo.end });
  return {
    lotsG,
    streamsG,
    inputG,
    logsG,
    logsPcs: logs.reduce((s, l) => s + (l.pcs ?? 0), 0),
    logsLengthMm: logs[0]?.lengthMm ?? 0,
    drossG,
    feG,
    returnsG,
    outputG,
    balance,
    lossG: balance.burnG,
    lossBp: balance.balanceBp ?? 0,
    allowedBurnG: balance.burnG <= 0 ? 0 : Math.min(balance.burnG, band),
    yieldBp: balance.yieldBp,
    warnings,
    logLinesG: logs.map((l) => l.kgG),
  };
}

/** The latest result on the melt that is not voided (its verdict gates the lock). */
async function latestSpectro(ctx: Ctx, meltId: string): Promise<{ id: string; verdict: SpectroVerdict | null } | null> {
  const [row] = await ctx.db
    .select({ id: spectroResult.id, verdict: spectroResult.verdict })
    .from(spectroResult)
    .where(and(eq(spectroResult.companyId, ctx.companyId), eq(spectroResult.meltId, meltId), isNull(spectroResult.voidedAt)))
    .orderBy(desc(spectroResult.createdAt), desc(spectroResult.serverSeq))
    .limit(1);
  return row ?? null;
}

/** INSERT … SELECT a melt row from its cast (number = the cast's bumped melt count), every column in table order. */
function meltInsertFromCast(ctx: Ctx, castId: string, seq: number, values: Record<string, unknown>): SqliteBatchItem {
  const select: Record<string, SQL.Aliased> = {};
  for (const [key, col] of Object.entries(getTableColumns(melt))) {
    let expr: SQL;
    if (key === "companyId") expr = sql`${cast.companyId}`;
    else if (key === "castId") expr = sql`${cast.id}`;
    else if (key === "seq") expr = sql`${cast.meltCount}`;
    else {
      const v = values[key];
      expr = v === undefined || v === null ? sql`null` : sql`${v}`;
    }
    select[key] = expr.as(col.name);
  }
  return ctx.db.insert(melt).select(
    ctx.db
      .select(select)
      .from(cast)
      .where(and(eq(cast.id, castId), eq(cast.companyId, ctx.companyId), eq(cast.serverSeq, seq), eq(cast.status, "open"))) as never,
  );
}

/** Checks a save input against the company's rows and builds the draft's lines (nothing posts). */
async function buildDraft(ctx: Ctx, input: SaveInput, meltId: string, seq: number, at: Date) {
  const { companyId } = ctx;
  const userId = ctx.session.user.id;
  const seen = new Set<string>();
  for (const i of input.inputs) {
    const key = `${i.kind}:${i.ref}`;
    if (seen.has(key)) bad(i.kind === "lot" ? "A lot is listed twice; put its kg on one line" : "A return stream is listed twice; put its kg on one line");
    seen.add(key);
  }
  const lotIds = input.inputs.filter((i) => i.kind === "lot").map((i) => i.ref);
  const lots = lotIds.length > 0 ? await lotsForMelt(ctx, lotIds) : new Map<string, LotForMelt>();
  for (const ref of lotIds) {
    const lot = lots.get(ref);
    if (!lot) throw new TRPCError({ code: "NOT_FOUND", message: "Lot not found" });
    if (lot.status !== "ok" || !lot.locationId) bad(`${lot.number} is not in scrap stock`);
  }
  const returnIds = new Set<string>();
  for (const r of input.returns) {
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
  const dross = input.drossG > 0 ? await streamByCode(ctx, DROSS_STREAM) : null;
  const fe = input.feG > 0 ? await streamByCode(ctx, FE_STREAM) : null;
  const needsPlantScrap = streamIds.length > 0 || dross !== null || fe !== null;
  const billet = input.logs.length > 0 ? await resolveBilletStore(ctx.db, companyId) : null;
  const plantScrap = needsPlantScrap ? await resolvePlantScrap(ctx.db, companyId) : null;

  const storeIds = new Set<string>();
  for (const ch of input.chemicals) {
    if (ch.closeMilli !== ch.openMilli - ch.usedMilli) bad("For each chemical, close must be open minus used");
    if (ch.storeItemId) {
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

  const base = { companyId, serverSeq: seq, meltId, createdBy: userId, createdAt: at };
  const inputRows: InputRow[] = input.inputs.map((i, idx) => {
    if (i.kind === "lot") {
      const lot = lots.get(i.ref)!;
      return { ...base, id: crypto.randomUUID(), line: idx + 1, kind: "lot", lotId: lot.id, returnStreamId: null, itemRef: `${lot.scrapItemId}:${lot.scrapGradeId}`, locationId: lot.locationId!, kgG: i.kgG };
    }
    return { ...base, id: crypto.randomUUID(), line: idx + 1, kind: "return_stream", lotId: null, returnStreamId: i.ref, itemRef: i.ref, locationId: plantScrap!.id, kgG: i.kgG };
  });
  let line = inputRows.length;
  const outputRows: OutputRow[] = [];
  const out = (row: Omit<OutputRow, "id" | "line" | "companyId" | "serverSeq" | "meltId" | "createdBy" | "createdAt">) => {
    line += 1;
    outputRows.push({ ...base, id: crypto.randomUUID(), line, ...row });
  };
  for (const l of input.logs) {
    out({ kind: "logs", returnStreamId: null, pcs: l.pcs, lengthMm: l.lengthMm, billetLengthMm: l.billetLengthMm ?? l.lengthMm, kgG: l.kgG, locationId: billet!.id });
  }
  if (dross) out({ kind: "dross", returnStreamId: dross.id, pcs: null, lengthMm: null, kgG: input.drossG, locationId: plantScrap!.id });
  if (fe) out({ kind: "fe", returnStreamId: fe.id, pcs: null, lengthMm: null, kgG: input.feG, locationId: plantScrap!.id });
  for (const r of input.returns) out({ kind: "return_stream", returnStreamId: r.streamId, pcs: null, lengthMm: null, kgG: r.kgG, locationId: plantScrap!.id });
  const chemRows: ChemRow[] = input.chemicals.map((ch, idx) => {
    const item = ch.storeItemId ? storeItems.get(ch.storeItemId)! : null;
    return {
      ...base,
      id: crypto.randomUUID(),
      line: idx + 1,
      storeItemId: item?.id ?? null,
      name: item ? item.name : ch.name!,
      unit: item ? item.unit : (ch.unit ?? "kg"),
      openMilli: ch.openMilli,
      usedMilli: ch.usedMilli,
      closeMilli: ch.closeMilli,
      storeTxnId: null,
    };
  });
  return { inputRows, outputRows, chemRows };
}

/** The furnace and alloy a draft names (both must belong to the company; a retired one cannot be picked). */
async function draftMasters(ctx: Ctx, input: Pick<SaveInput, "furnaceId" | "alloyId">) {
  let furnaceRow: typeof furnace.$inferSelect | null = null;
  if (input.furnaceId) {
    furnaceRow = (await ctx.db.select().from(furnace).where(and(eq(furnace.id, input.furnaceId), eq(furnace.companyId, ctx.companyId))).limit(1))[0] ?? null;
    if (!furnaceRow) throw new TRPCError({ code: "NOT_FOUND", message: "Furnace not found" });
    if (furnaceRow.status !== "active") bad(`${furnaceRow.code} is retired`);
  } else if (input.furnaceId === undefined) {
    // One active furnace (FourCubes: F1): it is the default.
    const rows = await ctx.db.select().from(furnace).where(and(eq(furnace.companyId, ctx.companyId), eq(furnace.status, "active"))).limit(2);
    if (rows.length === 1) furnaceRow = rows[0]!;
  }
  let alloyRow: typeof alloy.$inferSelect | null = null;
  if (input.alloyId) {
    alloyRow = (await ctx.db.select().from(alloy).where(and(eq(alloy.id, input.alloyId), eq(alloy.companyId, ctx.companyId))).limit(1))[0] ?? null;
    if (!alloyRow) throw new TRPCError({ code: "NOT_FOUND", message: "Alloy not found" });
    if (alloyRow.status !== "active") bad(`Alloy ${alloyRow.code} is retired`);
  }
  return { furnaceRow, alloyRow };
}

type DraftView = {
  id: string;
  castId: string;
  castNumber: string;
  seq: number;
  status: "draft";
  serverSeq: number;
  inputG: number;
  logsG: number;
  burnG: number;
  balanceBp: number | null;
  yieldBp: number | null;
  warnings: MeltWarning[];
  spectroVerdict: SpectroVerdict | null;
  /** What still stops the lock (empty = ready). */
  gates: MeltLockError[];
};

/** Everything the lock needs about a draft: the row, its cast and lines, furnace capacity and spectro. */
async function loadDraft(ctx: Ctx, meltId: string) {
  const [m] = await ctx.db.select().from(melt).where(and(eq(melt.id, meltId), eq(melt.companyId, ctx.companyId))).limit(1);
  if (!m) throw new TRPCError(MELT_NOT_FOUND);
  const [c, inputs, outputs, chemicals, spectro, furnaceRow] = await Promise.all([
    loadCast(ctx, m.castId),
    ctx.db.select().from(meltInput).where(and(eq(meltInput.companyId, ctx.companyId), eq(meltInput.meltId, m.id))).orderBy(asc(meltInput.line)),
    ctx.db.select().from(meltOutput).where(and(eq(meltOutput.companyId, ctx.companyId), eq(meltOutput.meltId, m.id))).orderBy(asc(meltOutput.line)),
    ctx.db.select().from(meltChemical).where(and(eq(meltChemical.companyId, ctx.companyId), eq(meltChemical.meltId, m.id))).orderBy(asc(meltChemical.line)),
    latestSpectro(ctx, m.id),
    m.furnaceId ? ctx.db.select().from(furnace).where(and(eq(furnace.id, m.furnaceId), eq(furnace.companyId, ctx.companyId))).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const figures = meltFigures(inputs, outputs, { start: m.ldoStartTenthIn, end: m.ldoEndTenthIn });
  const timesMs = [m.preheatStartAt, m.chargingStartAt, m.chargingEndAt, m.castingStartAt, m.castingEndAt].map((t) => (t ? t.getTime() : null));
  const alloyDiffers = (m.alloyId != null && c.alloyId != null && m.alloyId !== c.alloyId) || m.alloy !== c.alloy;
  const gates = meltLockGates({
    status: m.cancelledAt || m.status === "corrected" ? "cancelled" : m.status,
    inputsG: inputs.map((i) => i.kgG),
    logLinesG: figures.logLinesG,
    chargingStartMs: timesMs[1] ?? null,
    castingEndMs: timesMs[4] ?? null,
    capacityG: furnaceRow?.capacityG ?? null,
    balance: figures.balance,
    balanceReason: m.balanceNote,
    spectroVerdict: spectro?.verdict ?? null,
    spectroReason: m.spectroReason,
    alloyDiffersFromCast: alloyDiffers,
    alloyReason: m.alloyReason,
    timesMs,
  });
  return { m, c, inputs, outputs, chemicals, spectro, furnaceRow, figures, timesMs, gates };
}

function draftView(d: Awaited<ReturnType<typeof loadDraft>>): DraftView {
  return {
    id: d.m.id,
    castId: d.c.id,
    castNumber: d.c.number,
    seq: d.m.seq,
    status: "draft",
    serverSeq: d.m.serverSeq,
    inputG: d.figures.inputG,
    logsG: d.figures.logsG,
    burnG: d.figures.balance.burnG,
    balanceBp: d.figures.balance.balanceBp,
    yieldBp: d.figures.yieldBp,
    warnings: d.figures.warnings,
    spectroVerdict: d.spectro?.verdict ?? null,
    gates: d.gates,
  };
}

/** The melt's columns a save writes (figures included, so a draft lists with its kg). */
function draftColumns(input: SaveInput, figs: ReturnType<typeof meltFigures>, masters: Awaited<ReturnType<typeof draftMasters>>, castRow: { alloy: string; alloyId: string | null }) {
  const t = input.times;
  const ldo = input.ldoTenthIn;
  return {
    furnaceId: masters.furnaceRow?.id ?? null,
    alloyId: masters.alloyRow?.id ?? castRow.alloyId,
    alloy: masters.alloyRow?.code ?? castRow.alloy,
    alloyReason: input.alloyReason,
    preheatStartAt: t.preheatStart ?? null,
    chargingStartAt: t.chargingStart ?? null,
    chargingEndAt: t.chargingEnd ?? null,
    castingStartAt: t.castingStart ?? null,
    castingEndAt: t.castingEnd ?? null,
    ldoStartTenthIn: ldo.start ?? null,
    ldoChargingStartTenthIn: ldo.chargingStart ?? null,
    ldoChargingEndTenthIn: ldo.chargingEnd ?? null,
    ldoCastingStartTenthIn: ldo.castingStart ?? null,
    ldoEndTenthIn: ldo.end ?? null,
    inputG: figs.inputG,
    logsPcs: figs.logsPcs,
    logsLengthMm: figs.logsLengthMm,
    logsG: figs.logsG,
    drossG: figs.drossG,
    feG: figs.feG,
    returnsG: figs.returnsG,
    outputG: figs.outputG,
    lossG: figs.lossG,
    lossBp: figs.lossBp,
    allowedBurnG: figs.allowedBurnG,
    yieldBp: figs.yieldBp,
    balanceNote: input.balanceNote,
    spectroReason: input.spectroReason,
    notes: input.notes,
  };
}

const dateOf = (ms: number | null) => (ms == null ? null : new Date(ms));

export const meltStepperProcedures = {
  /** Write a draft melt (melt.enter). Returns its figures and what still stops the lock. */
  save: actionProcedure("melt.enter")
    .input(saveInput)
    .mutation(async ({ ctx, input }): Promise<DraftView> => {
      const { companyId } = ctx;
      const userId = ctx.session.user.id;
      if (!input.meltId && input.clientRequestId) {
        const [prior] = await ctx.db.select({ id: melt.id, castId: melt.castId }).from(melt).where(and(eq(melt.companyId, companyId), eq(melt.clientRequestId, input.clientRequestId))).limit(1);
        if (prior) {
          if (prior.castId !== input.castId) throw new TRPCError({ code: "CONFLICT", message: "That request id was already used for something else" });
          return draftView(await loadDraft(ctx, prior.id));
        }
      }
      const c = await loadCast(ctx, input.castId);
      if (c.status !== "open") bad(castStateMessage(c));
      let existing: MeltRow | null = null;
      if (input.meltId) {
        existing = (await ctx.db.select().from(melt).where(and(eq(melt.id, input.meltId), eq(melt.companyId, companyId))).limit(1))[0] ?? null;
        if (!existing) throw new TRPCError(MELT_NOT_FOUND);
        if (existing.castId !== c.id) bad("This melt belongs to another cast");
        if (existing.cancelledAt || existing.status === "cancelled") bad("This melt is cancelled");
        if (existing.status !== "draft") bad("This melt is locked; ask for a correction to change it");
        if (input.expectedServerSeq !== undefined && input.expectedServerSeq !== existing.serverSeq) bad("This melt changed; open it again");
      }
      const masters = await draftMasters(ctx, input);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const meltId = existing?.id ?? crypto.randomUUID();
      const lines = await buildDraft(ctx, input, meltId, seq, at);
      const figs = meltFigures(lines.inputRows, lines.outputRows, { start: input.ldoTenthIn.start ?? null, end: input.ldoTenthIn.end ?? null });
      const cols = draftColumns(input, figs, masters, c);
      const statements: SqliteBatchItem[] = [];
      if (!existing) {
        statements.push(
          ctx.db
            .update(cast)
            .set({ meltCount: sql`${cast.meltCount} + 1`, serverSeq: seq, updatedAt: at })
            .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId), eq(cast.status, "open"))),
          meltInsertFromCast(ctx, c.id, seq, {
            ...cols,
            id: meltId,
            serverSeq: seq,
            status: "draft",
            preheatStartAt: cols.preheatStartAt,
            warnings: JSON.stringify(figs.warnings),
            clientRequestId: input.clientRequestId ?? null,
            correctsMeltId: null,
            createdBy: userId,
            createdAt: at.getTime(),
          }),
        );
      } else {
        statements.push(
          ctx.db
            .update(cast)
            .set({ serverSeq: seq, updatedAt: at })
            .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId), eq(cast.status, "open"))),
          ctx.db
            .update(melt)
            .set({
              ...cols,
              preheatStartAt: dateOf(cols.preheatStartAt),
              chargingStartAt: dateOf(cols.chargingStartAt),
              chargingEndAt: dateOf(cols.chargingEndAt),
              castingStartAt: dateOf(cols.castingStartAt),
              castingEndAt: dateOf(cols.castingEndAt),
              warnings: figs.warnings,
              serverSeq: seq,
              updatedAt: at,
            })
            .where(
              and(
                eq(melt.id, meltId),
                eq(melt.companyId, companyId),
                eq(melt.status, "draft"),
                isNull(melt.cancelledAt),
                eq(melt.serverSeq, existing.serverSeq),
                sql`exists (select 1 from ${cast} sc where sc.id = ${c.id} and sc.company_id = ${companyId} and sc.status = 'open' and sc.server_seq = ${seq})`,
              ),
            ),
        );
      }
      statements.push(
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${melt} sm where sm.id = ${meltId} and sm.company_id = ${companyId} and sm.server_seq = ${seq} and sm.status = 'draft')`),
      );
      if (existing) {
        statements.push(
          ctx.db.delete(meltInput).where(and(eq(meltInput.companyId, companyId), eq(meltInput.meltId, meltId))),
          ctx.db.delete(meltOutput).where(and(eq(meltOutput.companyId, companyId), eq(meltOutput.meltId, meltId))),
          ctx.db.delete(meltChemical).where(and(eq(meltChemical.companyId, companyId), eq(meltChemical.meltId, meltId))),
        );
      }
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltInput).values(rows), lines.inputRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltOutput).values(rows), lines.outputRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltChemical).values(rows), lines.chemRows);
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "foundry.melt.save",
            subjectType: "melt",
            subjectId: meltId,
            meta: { castId: c.id, castNumber: c.number, created: !existing, inputG: figs.inputG, logsG: figs.logsG },
          },
          { from: melt, where: and(eq(melt.id, meltId), eq(melt.companyId, companyId), eq(melt.serverSeq, seq)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isFoundryAbort(e)) {
          const now = await loadCast(ctx, c.id);
          if (now.status !== "open") bad(castStateMessage(now));
          bad("This melt changed; open it again");
        }
        if (!existing && input.clientRequestId && isUniqueViolation(e, "melt.company_id, melt.client_request_id")) {
          const [won] = await ctx.db.select({ id: melt.id }).from(melt).where(and(eq(melt.companyId, companyId), eq(melt.clientRequestId, input.clientRequestId))).limit(1);
          if (won) return draftView(await loadDraft(ctx, won.id));
        }
        throw e;
      }
      return draftView(await loadDraft(ctx, meltId));
    }),

  /** A draft's figures and lock gates without saving (the stepper's last page). */
  preview: actionProcedure("melt.enter")
    .input(z.object({ meltId: id }))
    .query(async ({ ctx, input }) => {
      const d = await loadDraft(ctx, input.meltId);
      if (d.m.status !== "draft" || d.m.cancelledAt) bad("This melt is not a draft");
      return draftView(d);
    }),

  /**
   * Lock a draft (melt.enter): gates, then ONE batch that flips it to locked, posts the ledger
   * (lots and streams out, logs to the billet store, dross / Fe / metal back to streams), draws the
   * store chemicals and re-checks each lot's remaining kg with this melt counted.
   */
  lock: actionProcedure("melt.enter")
    .input(z.object({ meltId: id, clientMutationId }))
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const userId = ctx.session.user.id;
      let replay: Replay | null = input.clientMutationId ? await openReplay(ctx.db, companyId, "melt.lock", input.clientMutationId, { meltId: input.meltId }) : null;
      if (replay?.prior?.replay) return replay.prior.replay as LockAnswer;
      const d = await loadDraft(ctx, input.meltId);
      const { m, c } = d;
      if (m.cancelledAt || m.status === "cancelled") bad("This melt is cancelled");
      if (m.status === "locked") bad(MELT_GATE_TEXT.not_draft);
      if (c.status !== "open") bad(castStateMessage(c));
      if (d.gates.length > 0) {
        throw new TRPCMetaError({ code: "BAD_REQUEST", message: MELT_GATE_TEXT[d.gates[0]!], meta: { gates: d.gates } });
      }
      const at = clockNow();
      const castingEnd = d.timesMs[4]!;
      if (castingEnd > at.getTime() + FUTURE_SLACK_MS) bad("The casting end is in the future");
      const first = d.timesMs.find((t) => t != null)!;
      if (castingEnd - first > MAX_MELT_SPAN_MS) bad("Check the times: the melt runs over 3 days");
      // Read-time stock checks (the batch repeats them).
      const lotLines = d.inputs.filter((i) => i.kind === "lot");
      const lots = lotLines.length > 0 ? await lotsForMelt(ctx, lotLines.map((l) => l.lotId!)) : new Map<string, LotForMelt>();
      for (const l of lotLines) {
        const lot = lots.get(l.lotId!);
        if (!lot || lot.status !== "ok" || lot.locationId !== l.locationId) bad(`${lot?.number ?? "A lot"} is no longer in scrap stock`);
        if (lot.remainingG < l.kgG) bad(`Only ${fmtKg(Math.max(lot.remainingG, 0))} kg left in ${lot.number}`);
      }
      const streamLineIds = [...new Set([...d.inputs.filter((i) => i.kind === "return_stream").map((i) => i.returnStreamId!), ...d.outputs.filter((o) => o.returnStreamId).map((o) => o.returnStreamId!)])];
      const streams = await streamsByIds(ctx, streamLineIds);
      for (const sid of streamLineIds) {
        const s = streams.get(sid);
        if (!s || !s.active) bad(`${s?.name ?? "A return stream"} is retired`);
      }
      // FP-FD-05 (r1, I-3): a stream is never charged below its ledger balance (net of what this melt puts back).
      const charges = streamCharges(
        d.inputs.filter((i) => i.kind === "return_stream").map((i) => ({ streamId: i.returnStreamId!, locationId: i.locationId, kgG: i.kgG })),
        d.outputs.filter((o) => o.returnStreamId).map((o) => ({ streamId: o.returnStreamId!, locationId: o.locationId, kgG: o.kgG })),
      );
      const streamName = (sid: string) => streams.get(sid)?.name ?? "a return stream";
      await assertStreamsCover(ctx.db, companyId, charges, streamName);
      const draws = d.chemicals.filter((ch) => ch.storeItemId && ch.usedMilli > 0);
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const prepared: PreparedStoreDraws | null =
        draws.length > 0
          ? await prepareStoreDraws(ctx.db, {
              companyId,
              userId,
              seq,
              at,
              audit: auditCtx(ctx),
              source: { type: "melt", id: m.id },
              draws: draws.map((ch) => ({ itemId: ch.storeItemId!, qtyMilli: ch.usedMilli, purpose: "melt" as const, refId: c.id, note: `Cast ${c.number}` })),
            })
          : null;

      const f = d.figures;
      const locked = and(eq(melt.id, m.id), eq(melt.companyId, companyId), eq(melt.serverSeq, seq), eq(melt.status, "locked"));
      const billetLocs = [...new Set(d.outputs.filter((o) => o.kind === "logs").map((o) => o.locationId))];
      const scrapLocs = [...new Set([...d.inputs.filter((i) => i.kind === "return_stream").map((i) => i.locationId), ...d.outputs.filter((o) => o.kind !== "logs").map((o) => o.locationId)])];
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(cast)
          .set({ serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(cast.id, c.id),
              eq(cast.companyId, companyId),
              eq(cast.status, "open"),
              ...billetLocs.map((l) => activeLocation(companyId, l, "billet_store")),
              ...scrapLocs.map((l) => activeLocation(companyId, l, "wip")),
            ),
          ),
        ctx.db
          .update(melt)
          .set({
            status: "locked",
            inputG: f.inputG,
            logsPcs: f.logsPcs,
            logsLengthMm: f.logsLengthMm,
            logsG: f.logsG,
            drossG: f.drossG,
            feG: f.feG,
            returnsG: f.returnsG,
            outputG: f.outputG,
            lossG: f.lossG,
            lossBp: f.lossBp,
            allowedBurnG: f.allowedBurnG,
            yieldBp: f.yieldBp,
            warnings: f.warnings,
            lockedAt: at,
            lockedBy: userId,
            serverSeq: seq,
            updatedAt: at,
          })
          .where(
            and(
              eq(melt.id, m.id),
              eq(melt.companyId, companyId),
              eq(melt.status, "draft"),
              isNull(melt.cancelledAt),
              eq(melt.serverSeq, m.serverSeq),
              sql`exists (select 1 from ${cast} lc where lc.id = ${c.id} and lc.company_id = ${companyId} and lc.status = 'open' and lc.server_seq = ${seq})`,
            ),
          ),
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${melt} lm where lm.id = ${m.id} and lm.company_id = ${companyId} and lm.server_seq = ${seq} and lm.status = 'locked')`),
      ];
      // Each lot: still OK at the same place, and its remaining kg (this melt now counted) not below 0.
      for (const l of lotLines) {
        const lotRef = sql`${l.lotId}`;
        statements.push(
          foundryAbort(
            ctx.db,
            companyId,
            sql`not exists (select 1 from purchase_lot pl where pl.id = ${l.lotId} and pl.company_id = ${companyId} and pl.status = 'ok' and pl.location_id = ${l.locationId}) or ${lotRemainingSql(companyId, lotRef)} < 0`,
          ),
        );
      }
      for (const sid of streamLineIds) {
        const s = streams.get(sid)!;
        statements.push(foundryAbort(ctx.db, companyId, sql`not ${activeStream(companyId, sid, s.kind)}`));
      }
      const ledger: LedgerRow[] = [];
      const lrow = (line: number, itemKind: LedgerRow["itemKind"], itemRef: string, locationId: string, qtyG: number, reason: string | null): LedgerRow => ({
        id: crypto.randomUUID(),
        companyId,
        serverSeq: seq,
        voucherType: "melt",
        voucherId: m.id,
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
      for (const i of d.inputs) {
        if (i.kind === "lot") ledger.push(lrow(i.line, "scrap_grade", i.itemRef, i.locationId, -i.kgG, lots.get(i.lotId!)?.number ?? null));
        else ledger.push(lrow(i.line, "return_stream", i.returnStreamId!, i.locationId, -i.kgG, streams.get(i.returnStreamId!)?.code ?? null));
      }
      for (const o of d.outputs) {
        if (o.kind === "logs") ledger.push(lrow(o.line, "billet", c.id, o.locationId, o.kgG, `${c.number} logs`));
        else ledger.push(lrow(o.line, "return_stream", o.returnStreamId!, o.locationId, o.kgG, streams.get(o.returnStreamId!)?.code ?? (o.kind === "dross" ? DROSS_STREAM : FE_STREAM)));
      }
      pushChunkedInserts(statements, (rows) => ctx.db.insert(stockLedger).values(rows), ledger);
      statements.push(...streamChargeAborts(ctx.db, companyId, charges));
      if (d.furnaceRow?.billetDiaMm) {
        statements.push(
          ctx.db
            .update(meltOutput)
            .set({ diameterMm: d.furnaceRow.billetDiaMm })
            .where(and(eq(meltOutput.companyId, companyId), eq(meltOutput.meltId, m.id), eq(meltOutput.kind, "logs"))),
        );
      }
      if (prepared) {
        statements.push(...prepared.statements);
        draws.forEach((ch, k) => {
          statements.push(ctx.db.update(meltChemical).set({ storeTxnId: prepared.ids[k]! }).where(and(eq(meltChemical.id, ch.id), eq(meltChemical.companyId, companyId))));
        });
      }
      const answer: LockAnswer = {
        id: m.id,
        castId: c.id,
        castNumber: c.number,
        seq: m.seq,
        status: "locked",
        inputG: f.inputG,
        logsG: f.logsG,
        burnG: f.balance.burnG,
        balanceBp: f.balance.balanceBp,
        yieldBp: f.yieldBp,
        warnings: f.warnings.map((w) => w.code),
        spectroVerdict: d.spectro?.verdict ?? null,
        mrsNumbers: prepared?.numbers ?? [],
      };
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            id: replay?.id,
            action: "foundry.melt.lock",
            subjectType: "melt",
            subjectId: m.id,
            meta: { castId: c.id, castNumber: c.number, seq: m.seq, inputG: f.inputG, logsG: f.logsG, burnG: f.balance.burnG, balanceBp: f.balance.balanceBp, mrs: answer.mrsNumbers, ...replayMeta(replay, input.clientMutationId, answer) },
          },
          { from: melt, where: locked },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (lostReplayRace(e, replay)) {
          replay = await readReplay(ctx.db, companyId, replay!);
          if (replay.prior?.replay) return replay.prior.replay as LockAnswer;
        }
        if (prepared && isStoreDrawAbort(e)) await prepared.explain();
        if (isFoundryAbort(e)) {
          const [now] = await ctx.db.select().from(melt).where(and(eq(melt.id, m.id), eq(melt.companyId, companyId))).limit(1);
          if (now?.status === "locked") bad(MELT_GATE_TEXT.not_draft);
          const castNow = await loadCast(ctx, c.id);
          if (castNow.status !== "open") bad(castStateMessage(castNow));
          if (lotLines.length > 0) {
            const lotsNow = await lotsForMelt(ctx, lotLines.map((l) => l.lotId!));
            for (const l of lotLines) {
              const lot = lotsNow.get(l.lotId!);
              if (!lot || lot.status !== "ok") bad(`${lots.get(l.lotId!)?.number ?? "A lot"} is no longer in scrap stock`);
              if (lot.remainingG < l.kgG) bad(`Only ${fmtKg(Math.max(lot.remainingG, 0))} kg left in ${lot.number}`);
            }
          }
          if (billetLocs.length > 0) await resolveBilletStore(ctx.db, companyId);
          if (scrapLocs.length > 0) await resolvePlantScrap(ctx.db, companyId);
          await assertStreamsCover(ctx.db, companyId, charges, streamName);
          bad("This melt changed; open it again");
        }
        throw e;
      }
      return answer;
    }),

  /** Drop a draft (melt.enter). It keeps its number; nothing was posted, so nothing is reversed. */
  discard: actionProcedure("melt.enter")
    .input(z.object({ meltId: id, reason: optText(500) }))
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const [m] = await ctx.db.select().from(melt).where(and(eq(melt.id, input.meltId), eq(melt.companyId, companyId))).limit(1);
      if (!m) throw new TRPCError(MELT_NOT_FOUND);
      if (m.status !== "draft" || m.cancelledAt) bad("Only a draft can be discarded");
      const c = await loadCast(ctx, m.castId);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const reason = input.reason ?? "Draft discarded";
      const gone = and(eq(melt.id, m.id), eq(melt.companyId, companyId), eq(melt.serverSeq, seq), eq(melt.status, "cancelled"));
      await atomicBatch(ctx.db, [
        ctx.db.update(cast).set({ serverSeq: seq, updatedAt: at }).where(and(eq(cast.id, c.id), eq(cast.companyId, companyId))),
        ctx.db
          .update(melt)
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: ctx.session.user.id, cancelReason: reason, serverSeq: seq, updatedAt: at })
          .where(and(eq(melt.id, m.id), eq(melt.companyId, companyId), eq(melt.status, "draft"), isNull(melt.cancelledAt))),
        auditInsertGuarded(auditCtx(ctx), { action: "foundry.melt.discard", subjectType: "melt", subjectId: m.id, meta: { castId: c.id, castNumber: c.number, seq: m.seq, reason } }, { from: melt, where: gone }),
      ]);
      const [landed] = await ctx.db.select({ id: melt.id }).from(melt).where(gone).limit(1);
      if (!landed) bad("Only a draft can be discarded");
      return { id: m.id, status: "cancelled" as const };
    }),

  /**
   * Ask to correct a locked melt (melt.correct): a reason code (kind `melt_correct`) and a note go
   * to an approver (owner, admin, manager; never the requester). One open request per melt.
   */
  requestCorrection: actionProcedure("melt.correct")
    .input(z.object({ meltId: id, reasonCodeId: id, note: optText(500) }))
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const [m] = await ctx.db.select().from(melt).where(and(eq(melt.id, input.meltId), eq(melt.companyId, companyId))).limit(1);
      if (!m) throw new TRPCError(MELT_NOT_FOUND);
      if (m.status !== "locked" || m.cancelledAt) bad("Only a locked melt can be corrected");
      const c = await loadCast(ctx, m.castId);
      if (c.status !== "open") bad(castStateMessage(c));
      const [rc] = await ctx.db
        .select({ id: reasonCode.id, code: reasonCode.code, label: reasonCode.label, requiresNote: reasonCode.requiresNote })
        .from(reasonCode)
        .where(and(eq(reasonCode.id, input.reasonCodeId), eq(reasonCode.companyId, companyId), eq(reasonCode.kind, "melt_correct"), eq(reasonCode.active, true)))
        .limit(1);
      if (!rc) bad("Pick what is wrong with the melt");
      if (reasonNoteMissing({ code: rc.code, requiresNote: rc.requiresNote, note: input.note })) bad("Say what is wrong in the note");
      const open = await openCorrection(ctx, m.id);
      if (open) bad(open.status === "pending" ? "A correction for this melt is already waiting for approval" : "A correction for this melt is approved; correct it now");
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const requestNote = input.note ? `${rc.label}: ${input.note}` : rc.label;
      const req = requestApprovalInsert(ctx, {
        kind: "melt_correct",
        subjectId: m.id,
        serverSeq: seq,
        requestNote,
        meta: { castId: c.id, castNumber: c.number, meltSeq: m.seq, reasonCode: rc.code, logsG: m.logsG, inputG: m.inputG },
      });
      await atomicBatch(ctx.db, [
        req.statement,
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "foundry.melt.correct_request", subjectType: "melt", subjectId: m.id, meta: { approvalId: req.id, reasonCode: rc.code, note: input.note } },
          { from: melt, where: and(eq(melt.id, m.id), eq(melt.companyId, companyId)) },
        ),
      ]);
      return { approvalId: req.id };
    }),

  /**
   * Use an approved correction (melt.correct): the locked melt is cancelled with reversal rows (its
   * store draws come back), and a draft copy with the same lines opens on the same cast for the
   * floor to fix and lock. Refused once the press used the melt's billets.
   */
  correct: actionProcedure("melt.correct")
    .input(z.object({ meltId: id, clientMutationId }))
    .mutation(async ({ ctx, input }) => {
      const { companyId } = ctx;
      const userId = ctx.session.user.id;
      let replay: Replay | null = input.clientMutationId ? await openReplay(ctx.db, companyId, "melt.correct", input.clientMutationId, { meltId: input.meltId }) : null;
      if (replay?.prior?.replay) return replay.prior.replay as CorrectAnswer;
      const [m] = await ctx.db.select().from(melt).where(and(eq(melt.id, input.meltId), eq(melt.companyId, companyId))).limit(1);
      if (!m) throw new TRPCError(MELT_NOT_FOUND);
      if (m.status !== "locked" || m.cancelledAt) bad("Only a locked melt can be corrected");
      const grant = await openCorrection(ctx, m.id);
      if (!grant || grant.status !== "approved") bad("Ask for a correction first; an approver has to agree");
      const c = await loadCast(ctx, m.castId);
      if (c.status !== "open") bad(castStateMessage(c));
      const billetsSql = castBilletsOnHandSql(companyId, sql`${c.id}`);
      const [onHand] = await ctx.db.select({ g: billetsSql }).from(cast).where(and(eq(cast.id, c.id), eq(cast.companyId, companyId))).limit(1);
      const used = () => bad(`The press has already used billets of ${c.number}; this melt can no longer be corrected`);
      if (Number(onHand?.g ?? 0) < m.logsG) used();
      const txns = await liveMeltDraws(ctx, m.id);
      const blocked = storeReturnBlock(txns);
      if (blocked) bad(blocked);
      // r1 (m-3): the copy keeps the spectro the melt was judged by (the latest live result), so a
      // correction of a weight does not ask for a new sample or a reason.
      const [spec] = await ctx.db
        .select()
        .from(spectroResult)
        .where(and(eq(spectroResult.companyId, companyId), eq(spectroResult.meltId, m.id), isNull(spectroResult.voidedAt)))
        .orderBy(desc(spectroResult.createdAt), desc(spectroResult.serverSeq))
        .limit(1);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, companyId);
      const draftId = crypto.randomUUID();
      const copy = await copiedLines(ctx, m.id, draftId, seq, at);
      const reason = `Corrected: ${grant.requestNote ?? "approved correction"}`.slice(0, 500);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(cast)
          .set({ meltCount: sql`${cast.meltCount} + 1`, serverSeq: seq, updatedAt: at })
          .where(and(eq(cast.id, c.id), eq(cast.companyId, companyId), eq(cast.status, "open"))),
        ctx.db
          .update(melt)
          .set({ status: "corrected", cancelledAt: at, cancelledBy: userId, cancelReason: reason, serverSeq: seq, updatedAt: at })
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
        ...meltReversalStatements(ctx.db, { companyId, meltId: m.id, seq, at, userId, reason, storeTxnIds: txns.map((t) => t.id), storeReason: `Melt corrected: ${c.number}-${m.seq}` }),
        meltInsertFromCast(ctx, c.id, seq, {
          ...m,
          id: draftId,
          serverSeq: seq,
          status: "draft",
          preheatStartAt: m.preheatStartAt?.getTime() ?? null,
          chargingStartAt: m.chargingStartAt?.getTime() ?? null,
          chargingEndAt: m.chargingEndAt?.getTime() ?? null,
          castingStartAt: m.castingStartAt?.getTime() ?? null,
          castingEndAt: m.castingEndAt?.getTime() ?? null,
          warnings: JSON.stringify(m.warnings ?? []),
          clientRequestId: null,
          correctsMeltId: m.id,
          lockedAt: null,
          lockedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          createdBy: userId,
          createdAt: at.getTime(),
          updatedAt: null,
        }),
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${melt} dm where dm.id = ${draftId} and dm.company_id = ${companyId} and dm.status = 'draft')`),
      ];
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltInput).values(rows), copy.inputs);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltOutput).values(rows), copy.outputs);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(meltChemical).values(rows), copy.chemicals);
      if (spec) {
        statements.push(
          ctx.db.insert(spectroResult).values({ ...spec, id: crypto.randomUUID(), meltId: draftId, serverSeq: seq, clientRequestId: null, createdBy: userId, createdAt: at }),
        );
      }
      statements.push(
        ctx.db
          .update(approval)
          .set({ meta: sql`json_set(coalesce(${approval.meta}, '{}'), '$.usedAt', ${at.getTime()}, '$.draftId', ${draftId})`, serverSeq: seq })
          .where(and(eq(approval.id, grant.id), eq(approval.companyId, companyId), eq(approval.status, "approved"), sql`json_extract(${approval.meta}, '$.usedAt') is null`)),
        foundryAbort(ctx.db, companyId, sql`not exists (select 1 from ${approval} ga where ga.id = ${grant.id} and ga.company_id = ${companyId} and json_extract(ga.meta, '$.draftId') = ${draftId})`),
      );
      const answer: CorrectAnswer = { id: m.id, draftId, castId: c.id, castNumber: c.number, approvalId: grant.id };
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            id: replay?.id,
            action: "foundry.melt.correct",
            subjectType: "melt",
            subjectId: m.id,
            meta: { castId: c.id, castNumber: c.number, seq: m.seq, draftId, approvalId: grant.id, storeTxns: txns.map((t) => t.id), ...replayMeta(replay, input.clientMutationId, answer) },
          },
          { from: melt, where: and(eq(melt.id, draftId), eq(melt.companyId, companyId)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (lostReplayRace(e, replay)) {
          replay = await readReplay(ctx.db, companyId, replay!);
          if (replay.prior?.replay) return replay.prior.replay as CorrectAnswer;
        }
        if (isFoundryAbort(e)) {
          const castNow = await loadCast(ctx, c.id);
          if (castNow.status !== "open") bad(castStateMessage(castNow));
          const [h] = await ctx.db.select({ g: billetsSql }).from(cast).where(and(eq(cast.id, c.id), eq(cast.companyId, companyId))).limit(1);
          if (Number(h?.g ?? 0) < m.logsG) used();
          bad("This melt changed; open it again");
        }
        throw e;
      }
      return answer;
    }),
};

type LockAnswer = {
  id: string;
  castId: string;
  castNumber: string;
  seq: number;
  status: "locked";
  inputG: number;
  logsG: number;
  burnG: number;
  balanceBp: number | null;
  yieldBp: number | null;
  warnings: string[];
  spectroVerdict: SpectroVerdict | null;
  mrsNumbers: string[];
};

type CorrectAnswer = { id: string; draftId: string; castId: string; castNumber: string; approvalId: string };

/** The melt's correction request that is pending, or approved and not used yet. */
async function openCorrection(ctx: Ctx, meltId: string) {
  const rows = await ctx.db
    .select({ id: approval.id, status: approval.status, meta: approval.meta, requestNote: approval.requestNote })
    .from(approval)
    .where(and(eq(approval.companyId, ctx.companyId), eq(approval.kind, "melt_correct"), eq(approval.subjectId, meltId), inArray(approval.status, ["pending", "approved"])))
    .orderBy(desc(approval.createdAt))
    .limit(5);
  return rows.find((r) => r.status === "pending" || (r.status === "approved" && r.meta?.usedAt == null)) ?? null;
}

/** Copies of a locked melt's lines for its correction draft (new ids, same line numbers; chemicals lose their MRS link). */
async function copiedLines(ctx: Ctx, fromMeltId: string, toMeltId: string, seq: number, at: Date) {
  const mine = <T extends typeof meltInput | typeof meltOutput | typeof meltChemical>(t: T) => and(eq(t.companyId, ctx.companyId), eq(t.meltId, fromMeltId));
  const [inputs, outputs, chemicals] = await Promise.all([
    ctx.db.select().from(meltInput).where(mine(meltInput)),
    ctx.db.select().from(meltOutput).where(mine(meltOutput)),
    ctx.db.select().from(meltChemical).where(mine(meltChemical)),
  ]);
  const fresh = { meltId: toMeltId, serverSeq: seq, createdBy: ctx.session.user.id, createdAt: at };
  return {
    inputs: inputs.map((r) => ({ ...r, ...fresh, id: crypto.randomUUID() })),
    outputs: outputs.map((r) => ({ ...r, ...fresh, id: crypto.randomUUID() })),
    chemicals: chemicals.map((r) => ({ ...r, ...fresh, id: crypto.randomUUID(), storeTxnId: null })),
  };
}
