/**
 * Candidate procedures (plan B5, B7): blocks and the fit, the candidate state machine, rows and their
 * decisions, answers, layouts (holes), the bot call, provenance and the merge run view.
 *
 * Every change to a candidate is guarded by `expectSeq` (compare-and-set on `server_seq`). Learned
 * layouts belong to one plant. A layout saved by a person or the bot stays a draft until a person
 * approves the candidate that used it; only approved versions take part in the fit.
 */
import {
  BUILTIN_HOLES,
  findBuiltin,
  unitsFor,
  fingerprint,
  fitBlock,
  recipeSchema,
  validateRecipe,
  type FitResult,
  type IngestTarget,
  type LearnedHole,
  type Recipe,
} from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";

import {
  ingestAnswer,
  ingestArtifact,
  ingestBlock,
  ingestCandidate,
  ingestHole,
  ingestHoleVersion,
  ingestMergeChunk,
  ingestMergeRun,
  ingestStagedRow,
  type CandidateState,
  type QuestionCode,
  type RowDecision,
  type RowState,
} from "@orrn/db/schema/ingest";

import { mapInChunks, type SqliteBatchItem } from "../atomic";
import { auditInsert } from "../audit";
import { now } from "../clock";
import { createId } from "../id";
import { can } from "../permissions";
import { defaultCatalogue, runShapeAttempt, type SampleStats } from "./bot";
import {
  artifactSummary,
  assertState,
  blockView,
  candidateChange,
  candidateCounts,
  decodeCursor,
  encodeCursor,
  guardedBatch,
  ingestAbortUnlessChanged,
  loadArtifact,
  loadBlock,
  loadCandidate,
  loadCandidateAt,
  MOVED,
  summarize,
  type BlockRow,
  type CandidateRow,
} from "./core";
import {
  answerKey,
  candidateQuestions,
  classifyRows,
  clearLayoutAnswers,
  openQuestionCount,
  parseRecipe,
  readAnswers,
  recountStatement,
  undecidedRows,
} from "./dryrun";
import { anthropicEnv, botRunStore } from "./engines";
import {
  INGEST_LIMITS,
  type BlockInput,
  type CandidateCounts,
  type CandidateDetail,
  type CandidateSummary,
  type HoleView,
  type IngestCtx,
  type MergeRunView,
  type Page,
  type ProvenanceOut,
  type ShapeMakeOut,
  type StagedRowView,
} from "./types";

const DONE_STATES: readonly CandidateState[] = ["merging", "merged", "discarded"];

// ---------------------------------------------------------------------------
// Learned layouts
// ---------------------------------------------------------------------------

/** This plant's approved layout versions of active holes, newest first (plan B3), at most 200. */
export async function learnedHoles(ctx: Pick<IngestCtx, "db" | "companyId">): Promise<LearnedHole[]> {
  const rows = await ctx.db
    .select({
      holeId: ingestHole.id,
      holeVersionId: ingestHoleVersion.id,
      name: ingestHole.name,
      version: ingestHoleVersion.version,
      recipe: ingestHoleVersion.recipe,
    })
    .from(ingestHoleVersion)
    .innerJoin(ingestHole, eq(ingestHole.id, ingestHoleVersion.holeId))
    .where(
      and(
        eq(ingestHoleVersion.companyId, ctx.companyId),
        eq(ingestHole.companyId, ctx.companyId),
        eq(ingestHole.state, "active"),
        eq(ingestHoleVersion.state, "approved"),
      ),
    )
    .orderBy(desc(ingestHoleVersion.createdAt), desc(ingestHoleVersion.version))
    .limit(200);
  const out: LearnedHole[] = [];
  for (const r of rows) {
    const parsed = recipeSchema.safeParse(r.recipe);
    if (parsed.success) out.push({ holeId: r.holeId, holeVersionId: r.holeVersionId, name: r.name, version: r.version, recipe: parsed.data });
  }
  return out;
}

function stateForFit(fit: FitResult): CandidateState {
  if (fit.fit === "exact") return "processing";
  if (fit.fit === "near") return "needs_confirm";
  return "needs_shape";
}

function fitDiffJson(fit: FitResult): Record<string, unknown> | null {
  if (fit.fit === "near" && fit.diff) return { ...fit.diff, name: fit.name };
  if (fit.tie) return { tie: true, alternatives: fit.alternatives };
  return null;
}

// ---------------------------------------------------------------------------
// putBlocks
// ---------------------------------------------------------------------------

export async function putBlocks(
  ctx: IngestCtx,
  input: { artifactId: string; blocks: BlockInput[] },
): Promise<{ blocks: { blockId: string; ordinal: number }[]; candidates: CandidateSummary[] }> {
  const artifact = await loadArtifact(ctx, input.artifactId);
  const ordinals = input.blocks.map((b) => b.ordinal);
  if (new Set(ordinals).size !== ordinals.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Two sheets have the same number" });

  const existing = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, artifact.id)))
    .orderBy(asc(ingestBlock.ordinal));
  if (existing.length > 0) {
    // A replay of the same call (a reload, a second tab): answer with what is stored.
    const same = existing.length === ordinals.length && existing.every((b) => ordinals.includes(b.ordinal));
    if (!same) throw new TRPCError({ code: "CONFLICT", message: "The sheets of this file are already saved" });
    return storedBlocks(ctx, artifact.id, existing);
  }
  if (artifact.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: "This file is already read" });

  const learned = await learnedHoles(ctx);
  const at = now();
  const statements: SqliteBatchItem[] = [];
  const out: { blockId: string; ordinal: number }[] = [];
  let totalRows = 0;
  for (const b of input.blocks) {
    totalRows += b.rowCount;
    const sample = b.sample.slice(0, INGEST_LIMITS.sampleRowsPerBlock).map((r) => r.map((c) => c.slice(0, INGEST_LIMITS.cellChars)));
    const headersIn = b.headers.map((h) => h.slice(0, INGEST_LIMITS.cellChars));
    // The server never trusts a browser fit: fingerprint and fit are recomputed here.
    const fp = fingerprint({ headers: headersIn, rows: sample, headerRow: b.headerRow, headerRows: b.headerRows });
    if (fp.columnCount === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A sheet has no columns" });
    const fit = fitBlock(fp, learned);
    const blockId = createId();
    out.push({ blockId, ordinal: b.ordinal });
    statements.push(
      ctx.db.insert(ingestBlock).values({
        id: blockId,
        companyId: ctx.companyId,
        artifactId: artifact.id,
        ordinal: b.ordinal,
        sheetName: b.sheetName,
        title: b.title,
        headerRow: b.headerRow,
        headerRows: b.headerRows,
        headers: fp.headers,
        kinds: fp.kinds,
        headerKey: fp.headerKey,
        columnCount: fp.columnCount,
        rowCount: b.rowCount,
        rowsPut: 0,
        sample: sample.map((r) => r.slice(0, fp.columnCount)),
        readBy: "parser",
        modelChecked: false,
        createdAt: at,
      }),
      ctx.db.insert(ingestCandidate).values({
        id: createId(),
        companyId: ctx.companyId,
        artifactId: artifact.id,
        blockId,
        parentId: null,
        target: fit.target,
        holeRef: fit.holeRef,
        recipe: fit.recipe as never,
        fit: fit.fit,
        fitScore: fit.fit === "none" ? null : fit.score,
        fitDiff: fitDiffJson(fit),
        state: stateForFit(fit),
        createdAt: at,
        updatedAt: at,
      }),
    );
  }
  if (totalRows > INGEST_LIMITS.rawRowsPerFile) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${artifact.fileName} has more than 200,000 rows. Split it and try again.` });
  }
  statements.push(
    ctx.db
      .update(ingestArtifact)
      .set({ blockCount: input.blocks.length, rowCount: totalRows, updatedAt: at })
      .where(and(eq(ingestArtifact.id, artifact.id), eq(ingestArtifact.companyId, ctx.companyId))),
  );
  try {
    await guardedBatch(ctx.db, statements);
  } catch (e) {
    if (/UNIQUE constraint failed: ingest_block/.test(String((e as Error)?.message ?? e))) {
      throw new TRPCError({ code: "CONFLICT", message: "The sheets of this file are already saved" });
    }
    throw e;
  }
  const blocks = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, artifact.id)))
    .orderBy(asc(ingestBlock.ordinal));
  return storedBlocks(ctx, artifact.id, blocks);
}

async function storedBlocks(ctx: IngestCtx, artifactId: string, blocks: readonly BlockRow[]) {
  const candidates = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, artifactId)))
    .orderBy(asc(ingestCandidate.createdAt));
  return { blocks: blocks.map((b) => ({ blockId: b.id, ordinal: b.ordinal })), candidates: await summarize(ctx, candidates) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCandidates(
  ctx: IngestCtx,
  input: { state?: CandidateState; artifactId?: string; cursor?: string; limit: number },
): Promise<Page<CandidateSummary>> {
  const c = decodeCursor(input.cursor);
  const rows = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        input.state ? eq(ingestCandidate.state, input.state) : undefined,
        input.artifactId ? eq(ingestCandidate.artifactId, input.artifactId) : undefined,
        c
          ? or(lt(ingestCandidate.createdAt, new Date(c.at)), and(eq(ingestCandidate.createdAt, new Date(c.at)), lt(ingestCandidate.id, c.id)))
          : undefined,
      ),
    )
    .orderBy(desc(ingestCandidate.createdAt), desc(ingestCandidate.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: await summarize(ctx, page), nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

export async function candidateDetail(ctx: IngestCtx, candidateId: string): Promise<CandidateDetail> {
  const c = await loadCandidate(ctx, candidateId);
  const [summary] = await summarize(ctx, [c]);
  const block = await loadBlock(ctx, c.blockId);
  const artifact = await loadArtifact(ctx, c.artifactId);
  const questions = await candidateQuestions(ctx, c, artifact);
  return {
    ...summary!,
    recipe: c.recipe ?? null,
    fitDiff: c.fitDiff ?? null,
    questions,
    block: blockView(block),
    period: artifact.period ?? null,
    periodConfirmed: artifact.periodConfirmed ?? null,
    rowsMissing: Math.max(0, block.rowCount - block.rowsPut),
  };
}

// ---------------------------------------------------------------------------
// Target, near fit, layouts
// ---------------------------------------------------------------------------

async function assertTargetFree(ctx: IngestCtx, c: CandidateRow, target: IngestTarget): Promise<void> {
  const [other] = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.blockId, c.blockId),
        eq(ingestCandidate.target, target),
        ne(ingestCandidate.id, c.id),
      ),
    )
    .limit(1);
  if (other) throw new TRPCError({ code: "BAD_REQUEST", message: "This sheet already has an import of that kind" });
}

/**
 * The person says what the sheet holds, or to ignore it. With a target, the best known layout for
 * that target is used when one fits (exact: checking rows; near: asks once); otherwise the columns
 * still need mapping.
 */
export async function setTarget(
  ctx: IngestCtx,
  input: { candidateId: string; target: IngestTarget | "ignore"; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  if (DONE_STATES.includes(c.state) || c.recipeLocked) throw new TRPCError({ code: "BAD_REQUEST", message: "This import can no longer change" });
  if (input.target === "ignore") {
    await guardedBatch(ctx.db, [
      ...candidateChange(ctx, c.id, input.expectSeq, { state: "discarded", reasonCode: "ignored" }),
      auditInsert(ctx, { action: "ingest.candidate.discard", subjectType: "ingest_candidate", subjectId: c.id, meta: { ignored: true } }),
    ]);
    return candidateDetail(ctx, c.id);
  }
  await assertTargetFree(ctx, c, input.target);
  const block = await loadBlock(ctx, c.blockId);
  const learned = (await learnedHoles(ctx)).filter((h) => h.recipe.target === input.target);
  const builtins = BUILTIN_HOLES.filter((h) => h.target === input.target);
  const fit = fitBlock({ headers: block.headers, columnCount: block.columnCount, kinds: block.kinds, headerKey: block.headerKey }, learned, builtins);
  const set =
    fit.fit === "none"
      ? { target: input.target, fit: "manual" as const, holeRef: null, recipe: null, fitScore: null, fitDiff: null, state: "needs_shape" as const }
      : {
          target: input.target,
          fit: fit.fit,
          holeRef: fit.holeRef,
          recipe: fit.recipe as never,
          fitScore: fit.score,
          fitDiff: fitDiffJson(fit),
          state: stateForFit(fit),
        };
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, { ...set, dryCursor: 0, reasonCode: null, reasonDetail: null }),
    clearLayoutAnswers(ctx, c.id),
  ]);
  return candidateDetail(ctx, c.id);
}

/** Save a draft layout version for a candidate; it becomes approved when the candidate is approved. */
async function draftVersion(
  ctx: IngestCtx,
  c: CandidateRow,
  recipe: Recipe,
  opts: { name: string; madeBy: "person" | "bot" | "bot_edited"; botRunId?: string | null; headerKey: string },
): Promise<{ statements: SqliteBatchItem[]; versionId: string }> {
  let holeId: string | null = null;
  let version = 1;
  if (c.holeRef?.startsWith("learned:")) {
    const [v] = await ctx.db
      .select({ holeId: ingestHoleVersion.holeId, target: ingestHole.target })
      .from(ingestHoleVersion)
      .innerJoin(ingestHole, eq(ingestHole.id, ingestHoleVersion.holeId))
      .where(and(eq(ingestHoleVersion.companyId, ctx.companyId), eq(ingestHoleVersion.id, c.holeRef.slice(8))))
      .limit(1);
    if (v && v.target === recipe.target) holeId = v.holeId;
  }
  const statements: SqliteBatchItem[] = [];
  if (holeId) {
    const [max] = await ctx.db
      .select({ v: sql<number>`coalesce(max(${ingestHoleVersion.version}), 0)` })
      .from(ingestHoleVersion)
      .where(eq(ingestHoleVersion.holeId, holeId));
    version = Number(max?.v ?? 0) + 1;
  } else {
    holeId = createId();
    statements.push(
      ctx.db.insert(ingestHole).values({
        id: holeId,
        companyId: ctx.companyId,
        target: recipe.target,
        name: opts.name,
        currentVersion: 0,
        state: "active",
        createdBy: ctx.session.user.id,
      }),
    );
  }
  const versionId = createId();
  statements.push(
    ctx.db.insert(ingestHoleVersion).values({
      id: versionId,
      companyId: ctx.companyId,
      holeId,
      version,
      headerKey: opts.headerKey,
      recipe: recipe as never,
      madeBy: opts.madeBy,
      botRunId: opts.botRunId ?? null,
      state: "draft",
      createdBy: ctx.session.user.id,
    }),
  );
  return { statements, versionId };
}

function layoutName(c: CandidateRow, block: BlockRow, fallback: string): string {
  void c;
  return (block.sheetName || fallback).slice(0, 100);
}

/** Near fit: accept saves the variant (a draft version, approved with the candidate); reject asks for a layout. */
export async function confirmNear(
  ctx: IngestCtx,
  input: { candidateId: string; accept: boolean; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["needs_confirm"], "This import is not waiting for that");
  if (!input.accept) {
    await guardedBatch(
      ctx.db,
      candidateChange(ctx, c.id, input.expectSeq, { state: "needs_shape", fit: "none", recipe: null, holeRef: null, fitScore: null, fitDiff: null }),
    );
    return candidateDetail(ctx, c.id);
  }
  const recipe = parseRecipe(c.recipe);
  const block = await loadBlock(ctx, c.blockId);
  const builtin = c.holeRef ? findBuiltin(c.holeRef) : null;
  const artifact = await loadArtifact(ctx, c.artifactId);
  const { statements, versionId } = await draftVersion(ctx, c, { ...recipe, match: { ...recipe.match, headerKey: block.headerKey } }, {
    name: builtin ? layoutName(c, block, artifact.fileName) : layoutName(c, block, artifact.fileName),
    madeBy: "person",
    headerKey: block.headerKey,
  });
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "processing", holeRef: `learned:${versionId}`, dryCursor: 0 }),
    clearLayoutAnswers(ctx, c.id),
    ...statements,
  ]);
  return candidateDetail(ctx, c.id);
}

/** A layout from the mapping editor (or an edited bot layout). Checked with `validateRecipe`. */
export async function saveShape(
  ctx: IngestCtx,
  input: { candidateId: string; recipe: unknown; holeName: string; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  if (DONE_STATES.includes(c.state) || c.state === "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "This import can no longer change" });
  if (c.recipeLocked) throw new TRPCError({ code: "BAD_REQUEST", message: "Rows of this import are already merged; change single rows instead" });
  const parsed = recipeSchema.safeParse(input.recipe);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "This layout is not complete" });
  const recipe = parsed.data;
  const block = await loadBlock(ctx, c.blockId);
  const errors = validateRecipe(recipe, block, "person");
  if (errors.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This layout has problems: ${[...new Set(errors.map((e) => e.code))].join(", ")}` });
  }
  await assertTargetFree(ctx, c, recipe.target);
  const madeBy = c.fit === "bot" ? "bot_edited" : "person";
  const stored = { ...recipe, match: { ...recipe.match, headerKey: block.headerKey } };
  const { statements, versionId } = await draftVersion(ctx, c, stored, { name: input.holeName, madeBy, headerKey: block.headerKey });
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, {
      state: "processing",
      target: recipe.target,
      recipe: stored as never,
      holeRef: `learned:${versionId}`,
      fit: c.fit === "bot" ? "bot" : "manual",
      fitScore: null,
      fitDiff: null,
      dryCursor: 0,
      reasonCode: null,
      reasonDetail: null,
    }),
    clearLayoutAnswers(ctx, c.id),
    ...statements,
  ]);
  return candidateDetail(ctx, c.id);
}

// ---------------------------------------------------------------------------
// The column helper
// ---------------------------------------------------------------------------

export async function makeShape(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<ShapeMakeOut> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["needs_shape"], "This sheet does not need the helper");
  const block = await loadBlock(ctx, c.blockId);
  const artifact = await loadArtifact(ctx, c.artifactId);
  const staged = await ctx.db
    .select({ rowIndex: ingestStagedRow.rowIndex, raw: ingestStagedRow.raw })
    .from(ingestStagedRow)
    .where(eq(ingestStagedRow.candidateId, c.id))
    .orderBy(asc(ingestStagedRow.rowIndex))
    .limit(200);
  const rows = staged.length > 0 ? staged.map((r) => r.raw) : block.sample;
  const [noFit] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, c.artifactId), eq(ingestCandidate.state, "needs_shape")));
  const answers = readAnswers([], artifact);

  const result = await runShapeAttempt({
    env: anthropicEnv(),
    store: botRunStore(ctx),
    companyId: ctx.companyId,
    userId: ctx.session.user.id,
    candidateId: c.id,
    block: {
      id: block.id,
      sheetName: block.sheetName,
      title: block.title,
      headerKey: block.headerKey,
      headerRow: block.headerRow,
      headerRows: block.headerRows,
      headers: block.headers,
      kinds: block.kinds,
      columnCount: block.columnCount,
    },
    rows,
    noFitBlocks: Number(noFit?.n ?? 1),
    catalogue: defaultCatalogue(),
    note: artifact.note,
    validate: (recipe) => validateRecipe(recipe, block, "bot").map((e) => e.code),
    sampleCheck: async (recipe): Promise<SampleStats> => {
      const sampleRows = [...block.sample.map((raw, i) => ({ rowIndex: -1 - i, raw })), ...staged];
      const classified = await classifyRows(ctx, { target: recipe.target, recipe, answers, rows: sampleRows });
      let refused = 0;
      let ambiguous = 0;
      let conflict = 0;
      let requiredBlank = 0;
      for (const { outcome } of classified) {
        if (outcome.state === "refused") refused += 1;
        if (outcome.state === "ambiguous") ambiguous += 1;
        if (outcome.state === "conflict") conflict += 1;
        if (outcome.reasons.some((r) => r.startsWith("blank_required"))) requiredBlank += 1;
      }
      return { rows: classified.length, refused, ambiguous, conflict, requiredBlank };
    },
  });

  if (result.status === "skipped") {
    return { outcome: "skipped", skipReason: result.reason, attempt: c.botAttempts, model: "", next: result.next };
  }
  if (result.outcome === "recipe" && result.recipe) {
    const recipe = result.recipe;
    const free = await ctx.db
      .select({ id: ingestCandidate.id })
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.blockId, c.blockId), eq(ingestCandidate.target, recipe.target), ne(ingestCandidate.id, c.id)))
      .limit(1);
    if (free.length === 0) {
      const stored = { ...recipe, match: { ...recipe.match, headerKey: block.headerKey } };
      const { statements, versionId } = await draftVersion(ctx, c, stored, {
        name: layoutName(c, block, artifact.fileName),
        madeBy: "bot",
        botRunId: result.runId,
        headerKey: block.headerKey,
      });
      await guardedBatch(ctx.db, [
        ...candidateChange(ctx, c.id, input.expectSeq, {
          state: "processing",
          target: recipe.target,
          recipe: stored as never,
          holeRef: `learned:${versionId}`,
          fit: "bot",
          dryCursor: 0,
          botAttempts: c.botAttempts + 1,
        }),
        clearLayoutAnswers(ctx, c.id),
        ...statements,
      ]);
      return { outcome: "recipe", skipReason: null, attempt: result.attempt, model: result.model, next: "done" };
    }
  }
  await guardedBatch(ctx.db, candidateChange(ctx, c.id, input.expectSeq, { botAttempts: c.botAttempts + 1 }));
  return { outcome: result.outcome, skipReason: null, attempt: result.attempt, model: result.model, next: result.next };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const RATE_FIELDS = ["rate"];

export async function listRows(
  ctx: IngestCtx,
  input: { candidateId: string; state?: RowState; cursor?: string; limit: number },
): Promise<Page<StagedRowView>> {
  const c = await loadCandidate(ctx, input.candidateId);
  const from = input.cursor ? Number(input.cursor) : -1;
  if (!Number.isInteger(from)) throw new TRPCError({ code: "BAD_REQUEST", message: "Bad page cursor" });
  const rows = await ctx.db
    .select()
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, c.id),
        eq(ingestStagedRow.companyId, ctx.companyId),
        input.state ? eq(ingestStagedRow.state, input.state) : undefined,
        gt(ingestStagedRow.rowIndex, from),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex))
    .limit(input.limit + 1);
  const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
  const seesPrices = can(me, "order.price");
  const page = rows.slice(0, input.limit);
  const items = page.map((r): StagedRowView => {
    const values = r.values ? { ...r.values } : null;
    const entered = r.entered ? { ...r.entered } : null;
    let rate: number | null = null;
    let rateHidden = false;
    for (const f of RATE_FIELDS) {
      if (values && f in values) {
        if (seesPrices) rate = typeof values[f] === "number" ? (values[f] as number) : null;
        else {
          rateHidden = true;
          delete values[f];
        }
      }
      if (entered && f in entered && !seesPrices) {
        rateHidden = true;
        delete entered[f];
      }
    }
    const raw = seesPrices || !rateHidden ? r.raw : maskRawRate(r.raw, c.recipe);
    const options = ((values?._options as { field: string; options: { id: string; label: string }[] }[] | undefined) ?? []).flatMap((o) => o.options);
    return {
      id: r.id,
      rowIndex: r.rowIndex,
      state: r.state,
      values,
      entered,
      raw,
      reasons: r.reasons ?? [],
      matchId: r.matchId,
      options,
      diff: r.diff ?? null,
      decision: r.decision,
      mergeState: r.mergeState,
      committedType: r.committedType,
      committedId: r.committedId,
      rate,
      rateHidden: rateHidden || (!seesPrices && hasRateColumn(c.recipe)),
    };
  });
  const last = page.at(-1);
  return { items, nextCursor: rows.length > input.limit && last ? String(last.rowIndex) : null };
}

function rateColumns(recipe: unknown): number[] {
  const parsed = recipeSchema.safeParse(recipe);
  if (!parsed.success) return [];
  return parsed.data.fields
    .filter((f) => RATE_FIELDS.includes(f.field) && f.source.kind === "columns")
    .flatMap((f) => (f.source.kind === "columns" ? f.source.cols.map((x) => x.col) : []));
}

function hasRateColumn(recipe: unknown): boolean {
  return rateColumns(recipe).length > 0;
}

/** The raw cells with the rate column blanked, for a viewer who cannot see rates (A8). */
function maskRawRate(raw: string[], recipe: unknown): string[] {
  const cols = new Set(rateColumns(recipe));
  return raw.map((cell, i) => (cols.has(i) ? "" : cell));
}

/**
 * Plan B7 decisions on rows. The rows re-run from the first decided one (state processing), so the
 * decision passes through the same classification as everything else.
 */
export async function decideRows(
  ctx: IngestCtx,
  input: { candidateId: string; rowIds: string[]; decision: RowDecision; matchId?: string; expectSeq: number },
): Promise<CandidateCounts> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["ready", "held", "processing"], "Rows of this import can no longer change");
  if (input.decision === "use_match" && !input.matchId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the record to use" });
  const ids = [...new Set(input.rowIds)];
  const rows = await mapInChunks(ids, (part) =>
    ctx.db
      .select()
      .from(ingestStagedRow)
      .where(and(eq(ingestStagedRow.candidateId, c.id), eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part))),
  );
  if (rows.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Row not found" });
  if (rows.some((r) => r.mergeState !== "open")) throw new TRPCError({ code: "BAD_REQUEST", message: "A merged row cannot change" });
  if (input.decision !== "skip" && rows.some((r) => r.state !== "ambiguous" && r.state !== "conflict")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only rows that need a choice can take one" });
  }
  if (input.decision === "use_match") {
    for (const r of rows) {
      const opts = ((r.values?._options as { options: { id: string }[] }[] | undefined) ?? []).flatMap((o) => o.options.map((x) => x.id));
      if (!opts.includes(input.matchId!) && r.matchId !== input.matchId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That record is not one of the choices for this row" });
      }
    }
  }
  const from = Math.min(...rows.map((r) => r.rowIndex));
  const statements: SqliteBatchItem[] = [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "processing", dryCursor: Math.min(c.dryCursor, from) }),
  ];
  for (const r of rows) {
    statements.push(
      ctx.db
        .update(ingestStagedRow)
        .set({ decision: input.decision, matchId: input.decision === "use_match" ? input.matchId! : r.matchId, updatedAt: now() })
        .where(and(eq(ingestStagedRow.id, r.id), eq(ingestStagedRow.candidateId, c.id), eq(ingestStagedRow.mergeState, "open"))),
    );
  }
  statements.push(recountStatement(ctx, c.id));
  await guardedBatch(ctx.db, statements);
  return candidateCounts(await loadCandidate(ctx, c.id));
}

const ANSWER_CHECK: Record<QuestionCode, (a: unknown) => boolean> = {
  unit_unknown: (a) => typeof a === "string" && a.length > 0 && a.length <= 20,
  date_format_ambiguous: (a) => typeof a === "string" && ["dmy", "mdy", "ymd", "d_mon_y", "excel_serial"].includes(a),
  period_needed: (a) => !!a && typeof a === "object" && typeof (a as { asOf?: unknown }).asOf === "string",
  rates_hidden: (a) => a === "leave_out" || a === "owner_merges",
  column_meaning_unclear: (a) => typeof a === "string" && a.length <= 100,
  create_legacy_die: (a) => typeof a === "boolean",
  new_customers: (a) => typeof a === "boolean",
};

/**
 * The stored form of an answer. The screens send `{ unit }` and `{ field }` objects for two codes; the
 * bare string is stored so the dry run reads one shape.
 */
export function normalizeAnswer(code: QuestionCode, answer: unknown): unknown {
  if (code === "unit_unknown" && answer && typeof answer === "object" && "unit" in answer) return (answer as { unit: unknown }).unit;
  if (code === "column_meaning_unclear" && answer && typeof answer === "object" && "field" in answer) return (answer as { field: unknown }).field;
  return answer;
}

/** Answer one question; the candidate's rows re-run from the start. */
export async function setAnswer(
  ctx: IngestCtx,
  input: { candidateId: string; questionCode: QuestionCode; subject: string; answer: unknown; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["ready", "held", "processing"], "This import is not waiting for answers");
  const answer = normalizeAnswer(input.questionCode, input.answer);
  if (!ANSWER_CHECK[input.questionCode](answer)) throw new TRPCError({ code: "BAD_REQUEST", message: "That answer does not fit the question" });
  const artifact = await loadArtifact(ctx, c.artifactId);
  const questions = await candidateQuestions(ctx, c, artifact);
  if (!questions.some((q) => q.code === input.questionCode && q.subject === input.subject)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This import does not ask that" });
  }
  if (input.questionCode === "unit_unknown" && c.recipe) {
    const recipe = parseRecipe(c.recipe);
    const field = recipe.fields.find((f) => f.field === input.subject);
    const step = field?.steps.find((s) => s.op === "number");
    if (step && step.op === "number") {
      if (!unitsFor(step.kind).includes(answer as never)) throw new TRPCError({ code: "BAD_REQUEST", message: "That unit does not fit this column" });
    }
  }
  const at = now();
  const statements: SqliteBatchItem[] = [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "processing", dryCursor: 0 }),
    ctx.db
      .insert(ingestAnswer)
      .values({
        id: createId(),
        companyId: ctx.companyId,
        candidateId: c.id,
        questionCode: input.questionCode,
        subject: input.subject,
        answer: answer as never,
        answeredBy: ctx.session.user.id,
        answeredAt: at,
      })
      .onConflictDoUpdate({
        target: [ingestAnswer.candidateId, ingestAnswer.questionCode, ingestAnswer.subject],
        set: { answer: answer as never, answeredBy: ctx.session.user.id, answeredAt: at },
      }),
  ];
  if (input.questionCode === "period_needed") {
    const a = answer as { fy?: string | null; asOf: string };
    statements.push(
      ctx.db
        .update(ingestArtifact)
        .set({ periodConfirmed: { fy: a.fy ?? null, asOf: a.asOf }, updatedAt: at })
        .where(and(eq(ingestArtifact.id, artifact.id), eq(ingestArtifact.companyId, ctx.companyId))),
    );
  }
  await guardedBatch(ctx.db, statements);
  return candidateDetail(ctx, c.id);
}

// ---------------------------------------------------------------------------
// Approve, hold, discard
// ---------------------------------------------------------------------------

export async function approveCandidate(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["ready"], "Only an import that is ready can be approved");
  const block = await loadBlock(ctx, c.blockId);
  if (block.readBy === "model" && !block.modelChecked) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Check these rows against the page first" });
  }
  const artifact = await loadArtifact(ctx, c.artifactId);
  const questions = await candidateQuestions(ctx, c, artifact);
  const open = openQuestionCount(questions) + (await undecidedRows(ctx, c.id));
  if (open > 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Answer every question first" });
  if (questions.some((q) => q.code === "rates_hidden" && q.open)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This file has rates you cannot see. Leave rates out, or ask the owner to merge it." });
  }
  const statements: SqliteBatchItem[] = [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "approved", openQuestions: 0, approvedBy: ctx.session.user.id, approvedAt: now() }),
    auditInsert(ctx, {
      action: "ingest.candidate.approve",
      subjectType: "ingest_candidate",
      subjectId: c.id,
      meta: { target: c.target, rows: c.rowsTotal, create: c.rowsCreate, update: c.rowsUpdate, holeRef: c.holeRef },
    }),
  ];
  // A draft layout this candidate used becomes the plant's approved version now (brief: saved only
  // when a person approves the candidate that used it).
  if (c.holeRef?.startsWith("learned:")) {
    const [v] = await ctx.db
      .select()
      .from(ingestHoleVersion)
      .where(and(eq(ingestHoleVersion.companyId, ctx.companyId), eq(ingestHoleVersion.id, c.holeRef.slice(8))))
      .limit(1);
    if (v && v.state === "draft") {
      statements.push(
        ctx.db.update(ingestHoleVersion).set({ state: "approved" }).where(and(eq(ingestHoleVersion.id, v.id), eq(ingestHoleVersion.companyId, ctx.companyId))),
        ctx.db
          .update(ingestHole)
          .set({ currentVersion: sql`max(${ingestHole.currentVersion}, ${v.version})`, updatedAt: now() })
          .where(and(eq(ingestHole.id, v.holeId), eq(ingestHole.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "ingest.hole.save", subjectType: "ingest_hole", subjectId: v.holeId, meta: { version: v.version, madeBy: v.madeBy } }),
      );
    }
  }
  await guardedBatch(ctx.db, statements);
  return candidateDetail(ctx, c.id);
}

export async function holdCandidate(
  ctx: IngestCtx,
  input: { candidateId: string; reason?: string; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["ready", "approved"], "Only a ready or approved import can be held");
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, {
      state: "held",
      reasonCode: input.reason ? "person" : null,
      reasonDetail: input.reason ?? null,
      approvedBy: null,
      approvedAt: null,
    }),
    auditInsert(ctx, { action: "ingest.candidate.hold", subjectType: "ingest_candidate", subjectId: c.id, meta: { reason: input.reason ?? null, from: c.state } }),
  ]);
  return candidateDetail(ctx, c.id);
}

export async function discardCandidate(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  if (c.state === "merging" || c.state === "merged") throw new TRPCError({ code: "BAD_REQUEST", message: "A merged import cannot be discarded" });
  if (c.state === "discarded") return candidateDetail(ctx, c.id);
  if (c.rowsWritten > 0 || c.recipeLocked) throw new TRPCError({ code: "BAD_REQUEST", message: "Rows of this import are already merged" });
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "discarded", approvedBy: null, approvedAt: null }),
    // The statement's own guard: no row of this candidate was written in between.
    ctx.db
      .update(ingestCandidate)
      .set({ updatedAt: now() })
      .where(
        and(
          eq(ingestCandidate.id, c.id),
          sql`not exists (select 1 from ingest_staged_row r where r.candidate_id = ${c.id} and r.merge_state = 'written')`,
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
    auditInsert(ctx, { action: "ingest.candidate.discard", subjectType: "ingest_candidate", subjectId: c.id, meta: { from: c.state } }),
  ]);
  return candidateDetail(ctx, c.id);
}

// ---------------------------------------------------------------------------
// Layouts, provenance, merge view
// ---------------------------------------------------------------------------

export async function listHoles(ctx: IngestCtx, input: { target?: IngestTarget }): Promise<HoleView[]> {
  const holes = await ctx.db
    .select()
    .from(ingestHole)
    .where(and(eq(ingestHole.companyId, ctx.companyId), input.target ? eq(ingestHole.target, input.target) : undefined))
    .orderBy(desc(ingestHole.updatedAt))
    .limit(200);
  const versions = await mapInChunks(
    holes.map((h) => h.id),
    (part) =>
      ctx.db
        .select()
        .from(ingestHoleVersion)
        .where(and(eq(ingestHoleVersion.companyId, ctx.companyId), inArray(ingestHoleVersion.holeId, part))),
  );
  return holes.map((h) => ({
    id: h.id,
    target: h.target,
    name: h.name,
    currentVersion: h.currentVersion,
    state: h.state,
    createdAt: h.createdAt.getTime(),
    versions: versions
      .filter((v) => v.holeId === h.id)
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ id: v.id, version: v.version, headerKey: v.headerKey, madeBy: v.madeBy, state: v.state, createdAt: v.createdAt.getTime() })),
  }));
}

export async function retireHole(ctx: IngestCtx, input: { holeId: string }): Promise<HoleView> {
  const [h] = await ctx.db
    .select()
    .from(ingestHole)
    .where(and(eq(ingestHole.id, input.holeId), eq(ingestHole.companyId, ctx.companyId)))
    .limit(1);
  if (!h) throw new TRPCError({ code: "NOT_FOUND", message: "Layout not found" });
  await ctx.db.update(ingestHole).set({ state: "retired", updatedAt: now() }).where(and(eq(ingestHole.id, h.id), eq(ingestHole.companyId, ctx.companyId)));
  const [view] = (await listHoles(ctx, { target: h.target })).filter((x) => x.id === h.id);
  return view!;
}

/** The file, sheet and row behind a record the merge wrote (plan A6). */
export async function provenanceFor(ctx: IngestCtx, input: { type: string; id: string }): Promise<ProvenanceOut> {
  const [row] = await ctx.db
    .select({
      raw: ingestStagedRow.raw,
      rowIndex: ingestStagedRow.rowIndex,
      artifactId: ingestArtifact.id,
      fileName: ingestArtifact.fileName,
      sha256: ingestArtifact.sha256,
      createdAt: ingestArtifact.createdAt,
      sheet: ingestBlock.sheetName,
      ordinal: ingestBlock.ordinal,
    })
    .from(ingestStagedRow)
    .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
    .innerJoin(ingestBlock, eq(ingestBlock.id, ingestCandidate.blockId))
    .innerJoin(ingestArtifact, eq(ingestArtifact.id, ingestCandidate.artifactId))
    .where(
      and(
        eq(ingestStagedRow.companyId, ctx.companyId),
        eq(ingestStagedRow.committedType, input.type),
        eq(ingestStagedRow.committedId, input.id),
        isNotNull(ingestStagedRow.committedId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
  return {
    artifact: { id: row.artifactId, fileName: row.fileName, sha256: row.sha256, createdAt: row.createdAt.getTime() },
    sheet: row.sheet,
    blockOrdinal: row.ordinal,
    rowIndex: row.rowIndex,
    // A person who cannot see rates never reads them through the source row either.
    raw: can(me, "order.price") || input.type !== "sales_order" ? row.raw : [],
  };
}

export async function mergeRunView(ctx: IngestCtx, runId: string): Promise<MergeRunView> {
  const [run] = await ctx.db
    .select()
    .from(ingestMergeRun)
    .where(and(eq(ingestMergeRun.id, runId), eq(ingestMergeRun.companyId, ctx.companyId)))
    .limit(1);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Merge not found" });
  const chunkCandidates = await ctx.db
    .selectDistinct({ id: ingestMergeChunk.candidateId })
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId)));
  const ids = new Set(chunkCandidates.map((x) => x.id));
  const merging = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging")));
  for (const m of merging) ids.add(m.id);
  const candidates = await mapInChunks([...ids], (part) =>
    ctx.db
      .select()
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, part))),
  );
  const summaries = await summarize(ctx, candidates);
  const failed = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "failed")))
    .orderBy(asc(ingestMergeChunk.seq))
    .limit(100);
  return {
    id: run.id,
    state: run.state,
    cursor: run.cursor,
    serverSeq: run.serverSeq,
    chunksTotal: run.chunksTotal,
    chunksWritten: run.chunksWritten,
    chunksFailed: run.chunksFailed,
    startedBy: run.startedBy,
    startedAt: run.startedAt.getTime(),
    finishedAt: run.finishedAt ? run.finishedAt.getTime() : null,
    candidates: summaries.map((s) => ({
      candidateId: s.id,
      target: s.target,
      state: s.state,
      reasonCode: s.reasonCode,
      reasonDetail: s.reasonDetail,
      rowsWritten: s.counts.written,
      rowsCreate: s.counts.create,
      rowsUpdate: s.counts.update,
      fileName: s.fileName,
      sheetName: s.sheetName,
    })),
    failedChunks: failed.map((f) => ({
      id: f.id,
      candidateId: f.candidateId,
      target: f.target,
      seq: f.seq,
      rowFrom: f.rowFrom,
      rowTo: f.rowTo,
      rowCount: f.rowCount,
      state: f.state,
      errorCode: f.errorCode,
      errorMessage: f.errorMessage,
    })),
  };
}

export { artifactSummary, MOVED, answerKey };
