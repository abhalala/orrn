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
  chooseHeader,
  combineHeaders,
  findBuiltin,
  headerKey,
  cellKind,
  inferKinds,
  usedWidth,
  unitsFor,
  fitBlock,
  normalizeHeaders,
  nullUnshownUnits,
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
  ingestBotRun,
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
import { defaultCatalogue, runShapeAttempt, type SampleStats } from "./bot";
import {
  artifactSummary,
  assertState,
  blockViewFor,
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
  maskCells,
  MOVED,
  RATE_FIELDS,
  rateMaskColumns,
  seesRates,
  summarize,
  type BlockRow,
  type CandidateRow,
} from "./core";
import {
  answerKey,
  candidateQuestions,
  classifyRows,
  clearLayoutAnswers,
  clearMagnitudeAnswers,
  openQuestionCount,
  openUnitFields,
  parseMagnitudeSubject,
  parseRecipe,
  readAnswers,
  recountStatement,
  staleRefusal,
  undecidedRows,
  waitingLines,
  ORDER_WAITS,
  CHECK_AGAINST_FILE,
  othersAgainAfter,
  openDoubts,
  openDoubtWhere,
  Q_ORDER_FILL_ABOVE,
} from "./dryrun";
import { fyOfDate, periodRerun, validDate, validFy } from "./artifacts";
import { aliasMoveRefusal } from "./merge/rowchecks";
import { openStuckParts } from "./stuck";
import { anthropicEnv, botRunStore, shapeBot } from "./engines";
import { vaultReady } from "./vault";
import {
  INGEST_LIMITS,
  KEPT_UNREAD_NOT_READ,
  isKeptUnread,
  type BlockInput,
  type ReaderFacts,
  type HeaderAnswer,
  type DoubtListOut,
  type RowDoubtView,
  type HeaderBy,
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
import { ORDERS_PLAN_MAX_ROWS, ORDERS_TOO_BIG } from "./merge/planner";

const DONE_STATES: readonly CandidateState[] = ["merging", "merged", "discarded"];

/** `header_mismatch:fields.2.source.cols.0`: a recipe error as a code and a dotted path, for the retry. */
export function errorWithPath(e: { code: string; path?: string | null }): string {
  const path = (e.path ?? "").replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  const out = path && /^[a-z0-9_.]{1,80}$/i.test(path) ? `${e.code}:${path}` : e.code;
  return out.slice(0, 120);
}

/** A derived list (the new customers of an order sheet) changes only through its parent sheet (A12). */
function assertNotDerived(c: CandidateRow): void {
  if (c.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "This list comes from another sheet. Change that sheet instead." });
}

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

/** Rule 7.2: refusal words of the header check. */
export const HEADER_NOT_ASKED = "orrn has not asked about this table. Send it without a pick first.";
export const HEADER_PICK_OUTSIDE = "The row you picked is not in the preview";
export const PREVIEW_ORDER = "The preview has a row twice or out of order";
export const HEADER_NOT_IN_PREVIEW = "The column names row is not in the preview. Read the table again.";
export const REPICK_WRITTEN = "Rows of this sheet are already written. Its columns cannot change now.";
/** Rule 10.2: re-put and repick refuse once a sheet of the file is approved or merging. */
export const FILE_APPROVED = "A sheet of this file is approved. Its tables cannot change now.";
/** Inside a batch: no sheet of the file is approved, merging or merged (rule 10.2). */
const noSheetApproved = (companyId: string, artifactId: string) =>
  sql`not exists (select 1 from ingest_candidate k where k.company_id = ${companyId} and k.artifact_id = ${artifactId} and k.state in ('approved', 'merging', 'merged'))`;

/** Rule 7.2: preview rows in order, each once (by page, then row). */
function checkPreview(b: BlockInput): void {
  for (let i = 1; i < b.preview.length; i++) {
    const a = b.preview[i - 1]!;
    const c = b.preview[i]!;
    const pa = a.page ?? 0;
    const pc = c.page ?? 0;
    if (pc < pa || (pc === pa && c.row <= a.row)) throw new TRPCError({ code: "BAD_REQUEST", message: PREVIEW_ORDER });
  }
}

/** Rule 7.2: the column names the server takes, from the preview row it settled (and the next for two rows). */
function namesFromPreview(b: Pick<BlockInput, "preview" | "headerRow" | "headerRows">): string[] {
  const at = b.preview.findIndex((p) => p.row === b.headerRow);
  if (at === -1) throw new TRPCError({ code: "BAD_REQUEST", message: HEADER_NOT_IN_PREVIEW });
  const top = b.preview[at]!.cells.map((c) => c.trim().slice(0, INGEST_LIMITS.cellChars));
  if (b.headerRows !== 2) return top;
  const next = b.preview[at + 1];
  if (!next || next.row !== b.headerRow + 1 || next.page !== b.preview[at]!.page) throw new TRPCError({ code: "BAD_REQUEST", message: HEADER_NOT_IN_PREVIEW });
  return combineHeaders(top, next.cells.map((c) => c.trim().slice(0, INGEST_LIMITS.cellChars)));
}

/**
 * Who settles a block's header (rules 4.1 and 7.2). A person's pick (`hint`) is taken only after the
 * server asked about the table, told it to read again, or reset it for a pick, and only for a row of
 * the preview. Otherwise the server runs `chooseHeader` over the block's preview with the plant's
 * approved layouts and the built-in ones: the guess fits (`keep`), another row fits (`reread`), or
 * nothing fits (`ask`, with the offers of rule 6.1 when the table follows another). The server never
 * trusts a browser's fit or its names.
 */
function settleHeader(
  b: BlockInput,
  learned: readonly LearnedHole[],
  asked: boolean,
  above: { headers: string[]; rows: string[][] } | null,
): { by: HeaderBy } | Exclude<HeaderAnswer, { answer: "keep" }> {
  if (b.hint) {
    if (b.hint.headerRow !== b.headerRow || b.hint.headerRows !== b.headerRows) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Read this table again with the row you picked, then send it" });
    }
    if (!asked) throw new TRPCError({ code: "BAD_REQUEST", message: HEADER_NOT_ASKED });
    if (!b.preview.some((p) => p.row === b.hint!.headerRow)) throw new TRPCError({ code: "BAD_REQUEST", message: HEADER_PICK_OUTSIDE });
    return { by: "person" };
  }
  const guess = { headerRow: b.headerRow, headerRows: (b.headerRows === 2 ? 2 : 1) as 1 | 2 };
  const choice = chooseHeader(
    { preview: b.preview, guess, width: b.width, above, headerRow: Math.max(0, b.headerRow - (b.preview[0]?.row ?? b.headerRow)) },
    { learned },
  );
  // Round 7 item 3, the owner's rule: a clean sheet is never asked. The guess is one row, nothing
  // but blank rows is above it in the preview, and it looks like no known layout: the reader's
  // guess stands and the table goes on to "needs a layout" ("Wrong columns? Pick the row" stays).
  // A table with an offer about the table above (all text above, the same columns) still asks.
  if (choice.kind === "ask" && cleanGuess(b, choice)) return { by: "reader" };
  if (choice.kind === "ask") {
    const r = choice.resembles;
    const resembles = r ? { headerRow: r.headerRow, headerRows: r.headerRows, name: r.name, target: r.target, fit: r.fit } : null;
    return {
      ordinal: b.ordinal,
      answer: "ask",
      guess: choice.guess,
      candidates: choice.candidates,
      resembles,
      follows: b.follows ? { ordinal: b.follows.ordinal, gapRows: b.follows.gapRows, continues: b.follows.continues === true } : null,
      sameColumnsAsAbove: choice.sameColumnsAsAbove,
    };
  }
  if (choice.headerRow === guess.headerRow && choice.headerRows === guess.headerRows) return { by: "fit" };
  return { ordinal: b.ordinal, answer: "reread", headerRow: choice.headerRow, headerRows: choice.headerRows };
}

/**
 * Round 7 item 3 and rule 10.3: whether the reader's guess is a clean sheet's header, kept with no
 * question. One row, nothing but blank rows above it, and narrow: every filled cell is text (not a
 * number or a date), two or more filled cells with no blank between them, and the row below has at
 * least one number or date.
 */
function cleanGuess(b: BlockInput, choice: { resembles: unknown; sameColumnsAsAbove: boolean }): boolean {
  if (b.headerRows !== 1 || choice.resembles || choice.sameColumnsAsAbove || b.follows?.continues === true) return false;
  const at = b.preview.findIndex((p) => p.row === b.headerRow);
  if (at === -1) return false;
  if (!b.preview.every((p) => p.row >= b.headerRow || p.cells.every((c) => c.trim() === ""))) return false;
  const numberOrDate = (c: string) => {
    const k = cellKind(c);
    return k === "date" || k === "int" || k === "decimal";
  };
  const cells = b.preview[at]!.cells;
  const filled = cells.map((c, i) => (c.trim() === "" ? -1 : i)).filter((i) => i >= 0);
  if (filled.length < 2 || filled.at(-1)! - filled[0]! + 1 !== filled.length) return false;
  if (filled.some((i) => numberOrDate(cells[i]!))) return false;
  const below = b.preview[at + 1];
  return !!below && below.row === b.headerRow + 1 && (below.page ?? 0) === (b.preview[at]!.page ?? 0) && below.cells.some(numberOrDate);
}

/**
 * Round 7 item 4: whether a block sent again is the block saved. The same sheet, header rows and
 * row count, the same names from the preview, and, when a pick is sent, the same pick.
 */
function sameBlock(e: BlockRow, b: BlockInput): boolean {
  if (e.sheetName !== b.sheetName || e.headerRow !== b.headerRow || e.headerRows !== b.headerRows || e.rowCount !== b.rowCount) return false;
  let names: string[];
  try {
    names = namesFromPreview(b);
  } catch {
    return false;
  }
  const bare = (a: readonly string[]) => {
    const out = [...a];
    while (out.length && out[out.length - 1] === "") out.pop();
    return out;
  };
  if (JSON.stringify(bare(names)) !== JSON.stringify(bare(e.headers))) return false;
  if (!b.hint) return true;
  const p = e.headerPick;
  if (!p) return false;
  const skips = (r: readonly number[] | undefined) => JSON.stringify([...(r ?? [])].sort((x, y) => x - y));
  return p.headerRow === b.hint.headerRow && p.headerRows === b.hint.headerRows && (p.lastDataRow ?? null) === (b.hint.lastDataRow ?? null) && skips(p.skipRows) === skips(b.hint.skipRows);
}

/** Round 7 item 2: the reader's display facts of one block as stored, or null when it sent none. */
function readerFactsOf(b: BlockInput): ReaderFacts | null {
  const warnings = b.warnings ?? [];
  const sections = b.sections ?? [];
  if (!b.gaps && warnings.length === 0 && sections.length === 0 && !b.warningsTotal && !b.sectionsTotal) return null;
  return {
    gaps: b.gaps ?? 0,
    warnings,
    warningsTotal: Math.max(b.warningsTotal ?? 0, warnings.length),
    sections,
    sectionsTotal: Math.max(b.sectionsTotal ?? 0, sections.length),
  };
}

export async function putBlocks(
  ctx: IngestCtx,
  input: { artifactId: string; blocks: BlockInput[] },
): Promise<{ blocks: { blockId: string; ordinal: number }[]; candidates: CandidateSummary[]; header: HeaderAnswer[] }> {
  const artifact = await loadArtifact(ctx, input.artifactId);
  if (isKeptUnread(artifact.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: KEPT_UNREAD_NOT_READ });
  const ordinals = input.blocks.map((b) => b.ordinal);
  if (new Set(ordinals).size !== ordinals.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Two sheets have the same number" });

  const existing = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, artifact.id)))
    .orderBy(asc(ingestBlock.ordinal));
  // A later call sends every block of the file (rule 4.1). A block already saved and sent again the
  // same stays as it is, with its rows. Round 7 item 4: while no row of the file is written, a saved
  // block may be sent again with a new pick ("It continues the table above", "Same columns as the
  // table above", "Start a new table here"), and the list may gain or lose blocks. A changed or
  // dropped block goes with its staged rows; the changed one is saved again from this call.
  const keepOf = (b: BlockRow): HeaderAnswer => ({ ordinal: b.ordinal, answer: "keep", by: b.headerBy, blockId: b.id });
  const sent = new Map(input.blocks.map((b) => [b.ordinal, b]));
  const changed = existing.filter((e) => sent.has(e.ordinal) && !sameBlock(e, sent.get(e.ordinal)!));
  const dropped = existing.filter((e) => !sent.has(e.ordinal));
  const countChanged = (artifact.blockCount ?? 0) > 0 && ordinals.length !== artifact.blockCount;
  const fresh = input.blocks.filter((b) => !existing.some((e) => e.ordinal === b.ordinal) || changed.some((e) => e.ordinal === b.ordinal));
  const added = fresh.filter((b) => !existing.some((e) => e.ordinal === b.ordinal) && !(artifact.headerAsked ?? {})[String(b.ordinal)]);
  const reput = changed.length > 0 || dropped.length > 0 || countChanged || (artifact.readState === "read" && added.length > 0);
  if (fresh.length === 0 && !reput) {
    // A replay of the same call (a reload, a second tab): answer with what is stored.
    return { ...(await storedBlocks(ctx, artifact.id, existing)), header: existing.map(keepOf) };
  }
  const all = await ctx.db
    .select({
      id: ingestCandidate.id,
      blockId: ingestCandidate.blockId,
      parentId: ingestCandidate.parentId,
      state: ingestCandidate.state,
      rowsWritten: ingestCandidate.rowsWritten,
      recipeLocked: ingestCandidate.recipeLocked,
      target: ingestCandidate.target,
    })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, artifact.id)));
  if (reput) {
    const written = all.some((k) => k.rowsWritten > 0 || k.recipeLocked || k.state === "merged");
    if (written) throw new TRPCError({ code: "BAD_REQUEST", message: REPICK_WRITTEN });
    if (all.some((k) => k.state === "approved" || k.state === "merging")) throw new TRPCError({ code: "BAD_REQUEST", message: FILE_APPROVED });
    if (artifact.readState !== "reading" && artifact.readState !== "read") throw new TRPCError({ code: "BAD_REQUEST", message: "This file is already read" });
  } else if (artifact.readState !== "reading") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This file is already read" });
  }
  const totalRows = input.blocks.reduce((n, b) => n + b.rowCount, 0);
  if (totalRows > INGEST_LIMITS.rawRowsPerFile) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${artifact.fileName} has more than 200,000 rows. Split it and try again.` });
  }

  const learned = await learnedHoles(ctx);
  const at = now();
  const statements: SqliteBatchItem[] = [];
  const open: HeaderAnswer[] = [];
  const asked = { ...(artifact.headerAsked ?? {}) };
  for (const key of Object.keys(asked)) if (!sent.has(Number(key))) delete asked[key];
  const byOrdinal = sent;
  for (const b of input.blocks) checkPreview(b);
  if (reput) {
    // The changed and dropped blocks go, with every sheet read from them (the derived lists too).
    // Pending references other sheets hold to their rows are checked again while the rows exist.
    const goneBlocks = [...changed, ...dropped].map((e) => e.id);
    const roots = all.filter((k) => goneBlocks.includes(k.blockId)).map((k) => k.id);
    const kin = all.filter((k) => roots.includes(k.id) || (k.parentId != null && roots.includes(k.parentId)));
    const ids = kin.map((k) => k.id);
    const allIds = all.map((k) => k.id);
    // No row of the file was written in between.
    statements.push(
      ctx.db
        .update(ingestArtifact)
        .set({ updatedAt: at })
        .where(
          and(
            eq(ingestArtifact.id, artifact.id),
            eq(ingestArtifact.companyId, ctx.companyId),
            allIds.length
              ? sql`not exists (select 1 from ingest_staged_row r where r.candidate_id in ${allIds} and r.merge_state = 'written')`
              : sql`1 = 1`,
            // Rule 10.2: no sheet of the file was approved or started merging in between.
            noSheetApproved(ctx.companyId, artifact.id),
          ),
        ),
      ingestAbortUnlessChanged(ctx.db),
    );
    for (const k of kin) if (k.target) statements.push(...(await othersAgainAfter(ctx, { id: k.id, target: k.target }, "discarded", at)));
    if (ids.length) {
      statements.push(
        ctx.db.delete(ingestStagedRow).where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.candidateId, ids))),
        ctx.db.delete(ingestAnswer).where(and(eq(ingestAnswer.companyId, ctx.companyId), inArray(ingestAnswer.candidateId, ids))),
        ctx.db.delete(ingestBotRun).where(and(eq(ingestBotRun.companyId, ctx.companyId), inArray(ingestBotRun.candidateId, ids))),
        ctx.db.delete(ingestCandidate).where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, ids))),
      );
    }
    if (goneBlocks.length) statements.push(ctx.db.delete(ingestBlock).where(and(eq(ingestBlock.companyId, ctx.companyId), inArray(ingestBlock.id, goneBlocks))));
    statements.push(
      auditInsert(ctx, {
        action: "ingest.block.reput",
        subjectType: "ingest_artifact",
        subjectId: artifact.id,
        meta: {
          changed: changed.map((e) => e.ordinal),
          added: added.map((b) => b.ordinal),
          dropped: dropped.map((e) => e.ordinal),
          blockCount: { from: artifact.blockCount ?? 0, to: input.blocks.length },
          candidateIds: ids,
        },
      }),
    );
  }
  for (const b of fresh) {
    // Rule 6.1: the table above, for the two offers. Its names come from its own preview.
    let above: { headers: string[]; rows: string[][] } | null = null;
    if (b.follows) {
      const up = byOrdinal.get(b.follows.ordinal);
      if (!up || up.ordinal === b.ordinal || up.sheetName !== b.sheetName) throw new TRPCError({ code: "BAD_REQUEST", message: "A table follows a table that was not sent" });
      try {
        above = { headers: namesFromPreview(up), rows: up.sample };
      } catch {
        above = null;
      }
    }
    // A saved block sent again with a pick counts as asked: the person picks again (round 7 item 4).
    const resent = changed.some((e) => e.ordinal === b.ordinal);
    const settled = settleHeader(b, learned, !!asked[String(b.ordinal)] || resent, above);
    if (!("by" in settled)) {
      open.push(settled);
      if (settled.answer === "ask" || settled.answer === "reread") asked[String(b.ordinal)] = { answer: settled.answer, at: at.getTime() };
      continue;
    }
    const sample = capSample(b.sample.slice(0, INGEST_LIMITS.sampleRowsPerBlock).map((r) => r.map((c) => c.slice(0, INGEST_LIMITS.cellChars))));
    // Rule 7.2: the names are the preview's, never the browser's. The fingerprint and the fit are
    // worked out here, padded to the region's width (a column filled only below the sample counts).
    const names = namesFromPreview(b);
    const width = Math.max(usedWidth(names, sample), Math.min(b.width ?? 0, INGEST_LIMITS.columnsPerBlock));
    const padded = [...names, ...Array<string>(Math.max(0, width - names.length)).fill("")].slice(0, width);
    const normalized = normalizeHeaders(padded, width);
    const fp = { headers: padded, normalized, columnCount: width, kinds: inferKinds(sample, width), headerKey: headerKey(normalized), headerRow: b.headerRow, headerRows: b.headerRows };
    if (fp.columnCount === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A sheet has no columns" });
    for (const m of b.merged ?? []) {
      if (m.lastRow <= m.firstRow) throw new TRPCError({ code: "BAD_REQUEST", message: "A merged range must run down from its first row" });
      if (m.col >= fp.columnCount || m.lastRow >= b.rowCount) throw new TRPCError({ code: "BAD_REQUEST", message: "A merged range is outside the table" });
    }
    let headerPick: BlockRow["headerPick"] = null;
    if (settled.by === "person") {
      const h = b.hint!;
      const top = h.headerRow + h.headerRows - 1;
      for (const r of h.skipRows ?? []) {
        if (r <= top || (h.lastDataRow != null && r > h.lastDataRow)) throw new TRPCError({ code: "BAD_REQUEST", message: "A skipped row must be inside the table" });
      }
      if (h.lastDataRow != null && h.lastDataRow <= top) throw new TRPCError({ code: "BAD_REQUEST", message: "The last row must be below the column names" });
      headerPick = { by: ctx.session.user.id, at: at.getTime(), headerRow: h.headerRow, headerRows: h.headerRows, lastDataRow: h.lastDataRow ?? null, skipRows: h.skipRows ?? [] };
    }
    const fit = fitBlock(fp, learned);
    const blockId = createId();
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
        headerBy: settled.by,
        headerPick,
        merged: b.merged?.length ? b.merged : null,
        readerFacts: readerFactsOf(b),
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
        // One millisecond a sheet: the sheets of one upload keep their order, so the merge always
        // holds the later sheet (comesBefore). A Worker's clock does not move while code runs.
        createdAt: new Date(at.getTime() + b.ordinal),
        updatedAt: at,
      }),
    );
  }
  // The file's block count is every block it has, settled or not: complete waits for all of them.
  // The tables asked about are kept, so a person's pick for them is taken (rule 7.2).
  statements.push(
    ctx.db
      .update(ingestArtifact)
      .set({ blockCount: input.blocks.length, rowCount: totalRows, headerAsked: asked, ...(reput ? { readState: "reading" as const } : {}), updatedAt: at })
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
  const header = [...blocks.map(keepOf), ...open].sort((a, b) => a.ordinal - b.ordinal);
  return { ...(await storedBlocks(ctx, artifact.id, blocks)), header };
}

/** The stored sample, at most 512 KB of JSON, cut from the end (A38: D1 keeps at most 2 MB per value). */
export const SAMPLE_MAX_BYTES = 512 * 1024;
export function capSample(rows: string[][]): string[][] {
  const enc = new TextEncoder();
  let bytes = 2;
  const out: string[][] = [];
  for (const r of rows) {
    const n = enc.encode(JSON.stringify(r)).length + 1;
    if (bytes + n > SAMPLE_MAX_BYTES) break;
    bytes += n;
    out.push(r);
  }
  return out;
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
  const siblings = await ctx.db
    .select({ recipe: ingestCandidate.recipe })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.blockId, block.id)));
  return {
    ...summary!,
    recipe: c.recipe ?? null,
    fitDiff: c.fitDiff ?? null,
    questions,
    block: blockViewFor(ctx, block, siblings.map((x) => x.recipe)),
    period: artifact.period ?? null,
    periodConfirmed: artifact.periodConfirmed ?? null,
    rowsMissing: Math.max(0, block.rowCount - block.rowsPut),
    rowsOwnOrder: c.target === "orders" ? await rowsOwnOrder(ctx, c.id) : 0,
  };
}

/** Order rows of a candidate that are their own order: no old order number, no PO (rule 1). */
async function rowsOwnOrder(ctx: IngestCtx, candidateId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, candidateId),
        sql`substr(${ingestStagedRow.orderKey}, 1, 4) = ${"row\u001f"}`,
        sql`${ingestStagedRow.state} not in ('skipped', 'refused')`,
      ),
    );
  return Number(row?.n ?? 0);
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
  assertNotDerived(c);
  if (c.state === "merging" || c.state === "merged" || c.recipeLocked) throw new TRPCError({ code: "BAD_REQUEST", message: "This import can no longer change" });
  // An approved import is held first, so its approval is cleared and audited there (A30, A39).
  if (c.state === "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Hold this import first, then change what it holds" });
  if (c.state === "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "This file could not be read. Upload it again." });
  if (c.state === "discarded") {
    // A sheet ignored by mistake comes back when every row of it was kept (A41).
    const sheet = await loadBlock(ctx, c.blockId);
    if (c.rowsWritten > 0 || c.rowsTotal !== sheet.rowCount || input.target === "ignore") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The rows of this sheet were not kept. Upload the file again." });
    }
  }
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
  opts: { name: string; madeBy: "person" | "bot" | "bot_edited"; botRunId?: string | null; headerKey: string; approved?: boolean },
): Promise<{ statements: SqliteBatchItem[]; versionId: string; holeId: string; version: number }> {
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
        currentVersion: opts.approved ? version : 0,
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
      state: opts.approved ? "approved" : "draft",
      createdBy: ctx.session.user.id,
    }),
  );
  return { statements, versionId, holeId, version };
}

/**
 * The recipe with this candidate's answers written in (A19): an answered unit goes into the field's
 * open number steps, an answered date format into its date steps, and answered entries leave
 * `unclear`. Null when no answer changes it. The next file of this layout then asks nothing.
 */
export function foldAnswers(recipe: Recipe, answers: readonly { questionCode: string; subject: string; answer: unknown }[]): Recipe | null {
  const units = new Map<string, string>();
  const dates = new Map<string, string>();
  const columns = new Set<string>();
  const unitOpen = openUnitFields(recipe);
  for (const a of answers) {
    if (a.questionCode === "unit_unknown" && typeof a.answer === "string" && unitOpen.has(a.subject)) units.set(a.subject, a.answer);
    if (a.questionCode === "date_format_ambiguous" && typeof a.answer === "string") dates.set(a.subject, a.answer);
    if (a.questionCode === "column_meaning_unclear" && a.answer === a.subject) columns.add(a.subject);
  }
  const answered = (u: Recipe["unclear"][number]) =>
    (u.code === "unit_unknown" && units.has(u.field)) ||
    (u.code === "date_format_ambiguous" && dates.has(u.field)) ||
    (u.code === "column_meaning_unclear" && columns.has(u.field));
  if (!recipe.unclear.some(answered) && ![...units.keys()].length) return null;
  const folded: Recipe = {
    ...recipe,
    fields: recipe.fields.map((f) => ({
      ...f,
      steps: f.steps.map((st) => {
        if (st.op === "number" && st.unit === null && units.has(f.field)) return { ...st, unit: units.get(f.field)! };
        if (st.op === "date" && dates.has(f.field) && recipe.unclear.some((u) => u.code === "date_format_ambiguous" && u.field === f.field)) {
          return { ...st, format: dates.get(f.field) as typeof st.format };
        }
        return st;
      }),
    })),
    unclear: recipe.unclear.filter((u) => !answered(u)),
  };
  const parsed = recipeSchema.safeParse(folded);
  return parsed.success ? parsed.data : null;
}

/**
 * The recipe as stored: its match is the block's header key and normalized headers, never what a
 * model or the editor wrote, so the next file of this shape fits exactly or near (A9).
 */
function withBlockMatch(recipe: Recipe, block: BlockRow): Recipe {
  return { ...recipe, match: { headerKey: block.headerKey, headers: normalizeHeaders(block.headers, block.columnCount) } };
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
  assertNotDerived(c);
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
  const { statements, versionId } = await draftVersion(ctx, c, withBlockMatch(recipe, block), {
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
  assertNotDerived(c);
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
  const stored = withBlockMatch(recipe, block);
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
  assertNotDerived(c);
  assertState(c, ["needs_shape"], "This sheet does not need the helper");
  // No PDF or photo goes to a model in this release (owner's decision).
  if (isKeptUnread((await loadArtifact(ctx, c.artifactId)).kind)) throw new TRPCError({ code: "BAD_REQUEST", message: KEPT_UNREAD_NOT_READ });
  // Claim the candidate before any model call, so a second tab gets CONFLICT before it spends (A8).
  let seq = input.expectSeq;
  if (shapeBot.botReady()) {
    await guardedBatch(ctx.db, candidateChange(ctx, c.id, seq, {}));
    seq += 1;
  }
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
    // A unit the file does not show (header or note) is asked of the person, never guessed (C4, C20).
    normalize: (recipe) => nullUnshownUnits(recipe, block, artifact.note),
    // Code plus path (never the model's own text), so a retry knows which field to fix (A35).
    validate: (recipe) => validateRecipe(recipe, block, "bot", { note: artifact.note }).map((e) => errorWithPath(e)),
    sampleCheck: async (recipe): Promise<SampleStats> => {
      const sampleRows = [...block.sample.map((raw, i) => ({ rowIndex: -1 - i, raw })), ...staged];
      const classified = await classifyRows(ctx, { target: recipe.target, recipe, answers, rows: sampleRows });
      let refused = 0;
      let ambiguous = 0;
      let conflict = 0;
      let requiredBlank = 0;
      let blankRows = 0;
      let filtered = 0;
      for (const { outcome } of classified) {
        // Blank rows are not data; filtered rows are, and too many of them fail the check (A23).
        if (outcome.reasons.includes("blank_row")) blankRows += 1;
        if (outcome.reasons.includes("filtered")) filtered += 1;
        if (outcome.state === "refused") refused += 1;
        if (outcome.state === "ambiguous") ambiguous += 1;
        if (outcome.state === "conflict") conflict += 1;
        if (outcome.reasons.some((r) => r.startsWith("blank_required"))) requiredBlank += 1;
      }
      return { rows: classified.length - blankRows, refused, ambiguous, conflict, requiredBlank, filtered };
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
      const stored = withBlockMatch(recipe, block);
      const { statements, versionId } = await draftVersion(ctx, c, stored, {
        name: layoutName(c, block, artifact.fileName),
        madeBy: "bot",
        botRunId: result.runId,
        headerKey: block.headerKey,
      });
      try {
        await guardedBatch(ctx.db, [
          ...candidateChange(ctx, c.id, seq, {
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
      } catch (e) {
        // The candidate moved during the call: the recipe is not saved, so the run is not done (A33).
        await ctx.db
          .update(ingestBotRun)
          .set({ outcome: "error", errorCodes: ["candidate_moved"] })
          .where(and(eq(ingestBotRun.id, result.runId), eq(ingestBotRun.companyId, ctx.companyId)));
        throw e;
      }
      return { outcome: "recipe", skipReason: null, attempt: result.attempt, model: result.model, next: "done" };
    }
    // The sheet already has an import of that kind: the recipe is not saved, so the run is not a
    // finished recipe and the bot does not count the sheet as done (A33, A36).
    await ctx.db
      .update(ingestBotRun)
      .set({ outcome: "no_target", errorCodes: ["target_taken"] })
      .where(and(eq(ingestBotRun.id, result.runId), eq(ingestBotRun.companyId, ctx.companyId)));
    await guardedBatch(ctx.db, candidateChange(ctx, c.id, seq, { botAttempts: c.botAttempts + 1 }));
    return { outcome: "no_target", skipReason: null, attempt: result.attempt, model: result.model, next: "manual" };
  }
  await guardedBatch(ctx.db, candidateChange(ctx, c.id, seq, { botAttempts: c.botAttempts + 1 }));
  return { outcome: result.outcome, skipReason: null, attempt: result.attempt, model: result.model, next: result.next };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function listRows(
  ctx: IngestCtx,
  input: { candidateId: string; state?: RowState; cursor?: string; limit: number; doubted?: boolean },
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
        input.doubted ? openDoubtWhere(c.id) : undefined,
        gt(ingestStagedRow.rowIndex, from),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex))
    .limit(input.limit + 1);
  const seesPrices = seesRates(ctx);
  const maskCols = seesPrices ? new Set<number>() : rateMaskColumns((await loadBlock(ctx, c.blockId)).headers, [c.recipe]);
  const page = rows.slice(0, input.limit);
  const items = page.map((r): StagedRowView => {
    const values = r.values ? { ...r.values } : null;
    const entered = r.entered ? { ...r.entered } : null;
    let rate: number | null = null;
    let rateHidden = false;
    // The likely value of a rate flag (C19) is a rate too (X-new-2).
    if (values && !seesPrices && Array.isArray(values._magnitude)) {
      values._magnitude = (values._magnitude as { field?: unknown }[]).filter((n) => !RATE_FIELDS.includes(String(n.field)));
    }
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
    // Raw cells are masked by column, whatever state the row is in: a pending, blank, filtered or
    // refused row still holds the rate cell (A7).
    const raw = seesPrices ? r.raw : maskCells(r.raw, maskCols);
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
      rateHidden: rateHidden || (!seesPrices && maskCols.size > 0),
      doubts: (r.doubts ?? []) as RowDoubtView[],
      doubtConfirmed: r.doubtBy !== null,
    };
  });
  const last = page.at(-1);
  return { items, nextCursor: rows.length > input.limit && last ? String(last.rowIndex) : null };
}

/** Rule 5.3: the open doubted rows of a candidate, a page at a time, and how many there are. */
export async function listDoubts(ctx: IngestCtx, input: { candidateId: string; cursor?: string; limit: number }): Promise<DoubtListOut> {
  const page = await listRows(ctx, { ...input, doubted: true });
  return { open: await openDoubts(ctx, input.candidateId), ...page };
}

/**
 * Rule 5.3: a person answers doubted rows. "right": the row goes on as read, and the merge records
 * who confirmed it in the audit meta; "skip": the row is left out. One row, or every open doubted
 * row of the candidate when `expectCount` is the count the person was shown. The rows re-run from
 * the first one answered, so the answer passes through the dry run like any decision.
 */
export async function answerDoubts(
  ctx: IngestCtx,
  input: { candidateId: string; answer: "right" | "skip"; rowId?: string; expectCount?: number; expectSeq: number },
): Promise<CandidateCounts> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertState(c, ["ready", "held", "processing"], "Rows of this import can no longer change");
  const where = and(openDoubtWhere(c.id), eq(ingestStagedRow.companyId, ctx.companyId), input.rowId ? eq(ingestStagedRow.id, input.rowId) : undefined);
  const [found] = await ctx.db.select({ n: sql<number>`count(*)`, from: sql<number | null>`min(${ingestStagedRow.rowIndex})` }).from(ingestStagedRow).where(where);
  const n = Number(found?.n ?? 0);
  if (input.rowId && n === 0) throw new TRPCError({ code: "NOT_FOUND", message: "This row has no doubt to answer" });
  if (input.expectCount !== undefined && n !== input.expectCount) {
    throw new TRPCError({ code: "CONFLICT", message: "The list of rows to check changed. Open it again." });
  }
  const from = Number(found?.from ?? 0);
  // The candidate's server_seq guards the whole batch: nothing changed since the count was read.
  const statements: SqliteBatchItem[] = [
    ...candidateChange(ctx, c.id, input.expectSeq, { state: "processing", dryCursor: Math.min(c.dryCursor, from) }),
    ctx.db
      .update(ingestStagedRow)
      .set(input.answer === "right" ? { doubtBy: ctx.session.user.id, updatedAt: now() } : { decision: "skip", updatedAt: now() })
      .where(where),
    recountStatement(ctx, c.id),
  ];
  await guardedBatch(ctx.db, statements);
  return candidateCounts(await loadCandidate(ctx, c.id));
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
  // A row held only for its doubt takes "It is right" or a skip (rule 5.3, rows.answerDoubts).
  if (input.decision !== "skip" && rows.some((r) => (r.reasons ?? []).includes(CHECK_AGAINST_FILE) && (r.reasons ?? []).every((x) => x === CHECK_AGAINST_FILE || x === "cell_cut" || x === "row_cut"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Check this row against the file: say it is right, or skip it" });
  }
  // Rule 7.1: a line that waits on other lines of its order takes no choice but a skip.
  if (input.decision !== "skip" && rows.some((r) => (r.reasons ?? []).some((x) => x.startsWith(ORDER_WAITS)))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This line waits on other lines of its order. Fix or skip those lines first." });
  }
  if (input.decision !== "skip" && rows.some((r) => (r.reasons ?? []).some((x) => x.startsWith("q:")))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Answer the question above for these rows, or skip them" });
  }
  // A line that is not on the matched live order (A-new-1). The merge only makes new orders, so it
  // cannot add this line to that order: the person leaves it out, skips it, or adds it in orrn.
  // A numbered old order whose PO is on a live order of another old order (rule 4.2): the order
  // screens take a PO once, so the person leaves the rows out or skips them.
  if (input.decision !== "skip" && input.decision !== "keep_live" && rows.some((r) => (r.reasons ?? []).includes("po_on_live_order:poNumber"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This PO is already on another order in orrn. Leave these rows out, or skip them" });
  }
  if (input.decision !== "skip" && input.decision !== "keep_live" && rows.some((r) => (r.reasons ?? []).includes("order_line_new"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This line is not on the order in orrn. Add it to that order there, or leave the row out" });
  }
  // An alias of another customer or vendor is never moved by the merge (X-new-3).
  if (input.decision !== "skip" && input.decision !== "keep_live" && rows.some((r) => (r.reasons ?? []).includes("alias_taken:alias"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: aliasMoveRefusal(c.target === "vendor_aliases" ? "vendor_aliases" : "customer_aliases") });
  }
  if (input.decision === "use_match") {
    for (const r of rows) {
      const opts = ((r.values?._options as { options: { id: string }[] }[] | undefined) ?? []).flatMap((o) => o.options.map((x) => x.id));
      if (!opts.includes(input.matchId!) && r.matchId !== input.matchId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That record is not one of the choices for this row" });
      }
    }
  }
  if (c.parentId) {
    // A derived list has no recipe to re-run: a skip lands on the rows at once and the list keeps its
    // state (A12).
    if (input.decision !== "skip") throw new TRPCError({ code: "BAD_REQUEST", message: "Rows of this list can only be skipped" });
    const derived: SqliteBatchItem[] = [...candidateChange(ctx, c.id, input.expectSeq, {})];
    for (const r of rows) {
      derived.push(
        ctx.db
          .update(ingestStagedRow)
          .set({ decision: "skip", state: "skipped", updatedAt: now() })
          .where(and(eq(ingestStagedRow.id, r.id), eq(ingestStagedRow.candidateId, c.id), eq(ingestStagedRow.mergeState, "open"))),
      );
    }
    derived.push(recountStatement(ctx, c.id));
    await guardedBatch(ctx.db, derived);
    return candidateCounts(await loadCandidate(ctx, c.id));
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
  // The same checks as period.confirm (A40): a real date, a financial year like 2025-26, the date in it.
  period_needed: (a) => {
    if (!a || typeof a !== "object") return false;
    const { asOf, fy } = a as { asOf?: unknown; fy?: unknown };
    if (typeof asOf !== "string" || !validDate(asOf)) return false;
    if (fy === undefined || fy === null) return true;
    return typeof fy === "string" && validFy(fy) && fyOfDate(asOf) === fy;
  },
  rates_hidden: (a) => a === "leave_out" || a === "owner_merges",
  column_meaning_unclear: (a) => typeof a === "string" && a.length <= 100,
  create_legacy_die: (a) => typeof a === "boolean",
  new_customers: (a) => typeof a === "boolean",
  // "Import them" (true) or "Do not import" (false), rule 7.5.
  bundles_no_old_id: (a) => typeof a === "boolean",
  // Rule 10.1: "Yes" (true) keeps the fill from the line just above; "No" (false) refuses those lines.
  order_fill_above: (a) => typeof a === "boolean",
  // "as_is" (the value is right) or the unit the question offers (checked in setAnswer).
  magnitude_check: (a) => typeof a === "string" && a.length > 0 && a.length <= 20,
  // The PO picked for one old order ({ po }, one of the order's), or "skip" (checked in setAnswer).
  order_po: (a) => a === "skip" || (!!a && typeof a === "object" && typeof (a as { po?: unknown }).po === "string" && (a as { po: string }).po.trim().length > 0 && (a as { po: string }).po.length <= 100),
};

/**
 * The stored form of an answer. The screens send `{ unit }` and `{ field }` objects for two codes; the
 * bare string is stored so the dry run reads one shape.
 */
export function normalizeAnswer(code: QuestionCode, answer: unknown): unknown {
  if ((code === "unit_unknown" || code === "magnitude_check") && answer && typeof answer === "object" && "unit" in answer) return (answer as { unit: unknown }).unit;
  if (code === "column_meaning_unclear" && answer && typeof answer === "object" && "field" in answer) return (answer as { field: unknown }).field;
  return answer;
}

/** Answer one question; the candidate's rows re-run from the start. */
export async function setAnswer(
  ctx: IngestCtx,
  input: { candidateId: string; questionCode: QuestionCode; subject: string; answer: unknown; expectSeq: number },
): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  assertNotDerived(c);
  assertState(c, ["ready", "held", "processing"], "This import is not waiting for answers");
  const answer = normalizeAnswer(input.questionCode, input.answer);
  if (!ANSWER_CHECK[input.questionCode](answer)) throw new TRPCError({ code: "BAD_REQUEST", message: "That answer does not fit the question" });
  const artifact = await loadArtifact(ctx, c.artifactId);
  const questions = await candidateQuestions(ctx, c, artifact);
  if (!questions.some((q) => q.code === input.questionCode && q.subject === input.subject)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This import does not ask that" });
  }
  if (input.questionCode === "rates_hidden" && answer === "owner_merges" && questions.some((q) => q.code === "rates_hidden" && q.params.reason === "pricing_off")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Rates on sales orders are off for this plant. Turn rates on first, or leave rates out." });
  }
  if (input.questionCode === "order_po" && answer !== "skip") {
    const q = questions.find((x) => x.code === "order_po" && x.subject === input.subject)!;
    const pos = String(q.params.pos ?? "").split(", ").filter(Boolean);
    const picked = (answer as { po: string }).po.trim().toLowerCase();
    if (!pos.some((p) => p.toLowerCase() === picked)) throw new TRPCError({ code: "BAD_REQUEST", message: "That answer does not fit the question" });
  }
  if (input.questionCode === "column_meaning_unclear" && answer !== input.subject) {
    // The only answer that changes nothing is "the mapped column is right". Another column is a new
    // layout, made in the column mapping, so an answer is never stored without effect (A17).
    throw new TRPCError({ code: "BAD_REQUEST", message: "To use another column for this, change it in the column mapping" });
  }
  // A magnitude subject is `<field>|<unit>|<side>`; the unit check is on its field.
  const subjectField = input.questionCode === "magnitude_check" ? parseMagnitudeSubject(input.subject).field : input.subject;
  if (input.questionCode === "magnitude_check" && RATE_FIELDS.includes(subjectField) && !seesRates(ctx)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Rates are hidden from you. Leave rates out, or ask the owner to answer this." });
  }
  if ((input.questionCode === "unit_unknown" || (input.questionCode === "magnitude_check" && answer !== "as_is")) && c.recipe) {
    const recipe = parseRecipe(c.recipe);
    const field = recipe.fields.find((f) => f.field === subjectField);
    const step = field?.steps.find((s) => s.op === "number");
    if (step && step.op === "number") {
      if (!unitsFor(step.kind).includes(answer as never)) throw new TRPCError({ code: "BAD_REQUEST", message: "That unit does not fit this column" });
    } else if (input.questionCode === "magnitude_check") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That unit does not fit this column" });
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
  // The field is read in another unit now: its magnitude answers were about values the person no
  // longer sees, so they go (X-new-1).
  if (input.questionCode === "unit_unknown") statements.push(clearMagnitudeAnswers(ctx, c.id, input.subject));
  // Rule 10.1: one question per file. The other sheets whose lines wait on it check again.
  if (input.questionCode === "order_fill_above") statements.push(...(await fillAboveRerun(ctx, artifact.id, c.id)));
  if (input.questionCode === "period_needed") {
    const a = answer as { fy?: string | null; asOf: string };
    // Sibling order sheets of the file take the same date: they re-run too (A13).
    statements.push(...(await periodRerun(ctx, artifact.id, c.id, (artifact.periodConfirmed?.asOf ?? null) !== a.asOf)));
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

/** The other sheets of the file with a line waiting on `order_fill_above`: back to checking. */
async function fillAboveRerun(ctx: IngestCtx, artifactId: string, except: string): Promise<SqliteBatchItem[]> {
  const others = await ctx.db
    .select({ id: ingestCandidate.id, serverSeq: ingestCandidate.serverSeq })
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.artifactId, artifactId),
        eq(ingestCandidate.target, "orders"),
        inArray(ingestCandidate.state, ["processing", "ready", "held"]),
        ne(ingestCandidate.id, except),
      ),
    );
  if (others.length === 0) return [];
  const waiting = new Set(
    (
      await mapInChunks(
        others.map((o) => o.id),
        (part) =>
          ctx.db
            .selectDistinct({ id: ingestStagedRow.candidateId })
            .from(ingestStagedRow)
            .where(and(inArray(ingestStagedRow.candidateId, part), eq(ingestStagedRow.state, "ambiguous"), sql`${ingestStagedRow.reasons} like ${`%"${Q_ORDER_FILL_ABOVE}"%`}`)),
      )
    ).map((r) => r.id),
  );
  return others.filter((o) => waiting.has(o.id)).flatMap((o) => candidateChange(ctx, o.id, o.serverSeq, { state: "processing", dryCursor: 0 }));
}

// ---------------------------------------------------------------------------
// Approve, hold, discard
// ---------------------------------------------------------------------------

/** Rule 10.2: the words when a sheet is approved while its file is being read again. */
export const FILE_READING = "This file is being read again. Finish it, then approve.";

/** Rule 7.4: the words when no row of a sheet would be written. */
export const NOTHING_TO_IMPORT = "Nothing in this sheet can be imported. Fix the rows or discard it.";

export async function approveCandidate(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  // A held candidate finished its dry run before it was held, so it may be approved again (A20).
  assertState(c, ["ready", "held"], "Only an import that is ready or held can be approved");
  const block = await loadBlock(ctx, c.blockId);
  if (block.readBy === "model" && !block.modelChecked) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Check these rows against the page first" });
  }
  const artifact = await loadArtifact(ctx, c.artifactId);
  // Rule 10.2: nothing is approved while its file is being read (a re-put or a pick sent it back).
  if (artifact.readState !== "read") throw new TRPCError({ code: "PRECONDITION_FAILED", message: FILE_READING });
  // Raw files are kept forever: with a vault, nothing is approved before its bytes are stored (A21).
  if (vaultReady() && artifact.vaultState !== "stored") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The original file is not saved yet. Upload the same file again, then approve." });
  }
  // Refusals that are out of date (rule 2): a section or customer a row was refused for exists now.
  if (c.target === "orders" || c.target === "die_copies" || c.target === "customer_aliases") {
    const stale = await staleRefusal(ctx, c.id, c.target, c.artifactId);
    if (stale) throw new TRPCError({ code: "PRECONDITION_FAILED", message: stale });
  }
  // An orders sheet the planner cannot read in one step is refused here with the planner's words.
  if (c.target === "orders" && c.rowsTotal > ORDERS_PLAN_MAX_ROWS) throw new TRPCError({ code: "PRECONDITION_FAILED", message: ORDERS_TOO_BIG });
  // Rows the reader doubted wait for a person (rule 5.3).
  const doubts = await openDoubts(ctx, c.id);
  if (doubts > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Check ${doubts} ${doubts === 1 ? "row" : "rows"} against the file first. Open the list, then say each is right or skip it.`,
    });
  }
  const questions = await candidateQuestions(ctx, c, artifact);
  if (openQuestionCount(questions) > 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Answer every question first" });
  // Rule 7.1: an order is written whole; its lines wait while another line of it is refused or open.
  const waiting = await waitingLines(ctx, c.id);
  if (waiting > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${waiting} ${waiting === 1 ? "line waits" : "lines wait"} on other lines of their order. Fix the file, answer, or skip those lines first.`,
    });
  }
  const undecided = await undecidedRows(ctx, c.id);
  // Conflicts and doubts are choices, not questions (M-4).
  if (undecided > 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Choose for ${undecided} ${undecided === 1 ? "row" : "rows"} first` });
  // Rule 7.4: a sheet in which no row would be written (all refused or skipped) is not approved.
  // By the rows themselves (the candidate state index), not the stored counts.
  if (c.rowsWritten === 0) {
    const [one] = await ctx.db
      .select({ id: ingestStagedRow.id })
      .from(ingestStagedRow)
      .where(and(eq(ingestStagedRow.candidateId, c.id), inArray(ingestStagedRow.state, ["ready_create", "ready_update", "unchanged"])))
      .limit(1);
    if (!one) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOTHING_TO_IMPORT });
  }
  if (questions.some((q) => q.code === "rates_hidden" && q.open)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This file has rates you cannot see. Leave rates out, or ask the owner to merge it." });
  }
  const answerRows = await ctx.db
    .select()
    .from(ingestAnswer)
    .where(and(eq(ingestAnswer.companyId, ctx.companyId), eq(ingestAnswer.candidateId, c.id)));
  // Numbers a person kept or re-read after a magnitude check (C19) go in the approval's audit meta.
  const magnitude = answerRows
    .filter((a) => a.questionCode === "magnitude_check")
    .map((a) => {
      const { field, unit, side } = parseMagnitudeSubject(a.subject);
      const seen = `the ${field} values read in ${unit || "no unit"} that looked too ${side === "below" ? "small" : "large"}`;
      return a.answer === "as_is"
        ? { field, unit, side, answer: "as_is", note: `The person said ${seen} are right` }
        : { field, unit, side, answer: String(a.answer), note: `The person said ${seen} are in ${String(a.answer)}` };
    });
  const statements: SqliteBatchItem[] = [
    ...candidateChange(ctx, c.id, input.expectSeq, {
      state: "approved",
      openQuestions: 0,
      approvedBy: ctx.session.user.id,
      approvedAt: now(),
      reasonCode: null,
      reasonDetail: null,
    }),
    // Rule 10.2, inside the batch: a re-put or a pick that lands first wins.
    ctx.db
      .update(ingestArtifact)
      .set({ readState: "read" })
      .where(and(eq(ingestArtifact.id, artifact.id), eq(ingestArtifact.companyId, ctx.companyId), eq(ingestArtifact.readState, "read"))),
    ingestAbortUnlessChanged(ctx.db),
    auditInsert(ctx, {
      action: "ingest.candidate.approve",
      subjectType: "ingest_candidate",
      subjectId: c.id,
      meta: {
        target: c.target,
        rows: c.rowsTotal,
        create: c.rowsCreate,
        update: c.rowsUpdate,
        holeRef: c.holeRef,
        ...(magnitude.length ? { magnitude } : {}),
      },
    }),
  ];
  // Answers to unit, date and column questions are written into the layout, so the next file of this
  // shape asks nothing (A19). Magnitude answers are about single rows and stay out of it.
  const current = c.recipe ? recipeSchema.safeParse(c.recipe) : null;
  const folded = current?.success && !c.parentId ? foldAnswers(current.data, answerRows) : null;
  // A draft layout this candidate used becomes the plant's approved version now (brief: saved only
  // when a person approves the candidate that used it).
  const [v] = c.holeRef?.startsWith("learned:")
    ? await ctx.db
        .select()
        .from(ingestHoleVersion)
        .where(and(eq(ingestHoleVersion.companyId, ctx.companyId), eq(ingestHoleVersion.id, c.holeRef.slice(8))))
        .limit(1)
    : [];
  // A candidate approved again after a hold (B-new-3) saves its answered layout once: an approved
  // version of this plant with the very same recipe is already that layout.
  const variant = folded && !(v && v.state === "draft") ? withBlockMatch(folded, block) : null;
  if (variant && !(await approvedVersionWith(ctx, block.headerKey, variant))) {
    // An approved or built-in layout is not changed in place: the answered variant is a new version.
    const made = await draftVersion(ctx, c, variant, {
      name: layoutName(c, block, artifact.fileName),
      madeBy: "person",
      headerKey: block.headerKey,
      approved: true,
    });
    statements.push(
      ...made.statements,
      ctx.db
        .update(ingestHole)
        .set({ currentVersion: sql`max(${ingestHole.currentVersion}, ${made.version})`, updatedAt: now() })
        .where(and(eq(ingestHole.id, made.holeId), eq(ingestHole.companyId, ctx.companyId))),
      auditInsert(ctx, { action: "ingest.hole.save", subjectType: "ingest_hole", subjectId: made.holeId, meta: { version: made.version, madeBy: "person", answers: true } }),
    );
  }
  if (v && v.state === "draft") {
    statements.push(
      ctx.db
        .update(ingestHoleVersion)
        .set({ state: "approved", ...(folded ? { recipe: withBlockMatch(folded, block) as never } : {}) })
        .where(and(eq(ingestHoleVersion.id, v.id), eq(ingestHoleVersion.companyId, ctx.companyId))),
      ctx.db
        .update(ingestHole)
        .set({ currentVersion: sql`max(${ingestHole.currentVersion}, ${v.version})`, updatedAt: now() })
        .where(and(eq(ingestHole.id, v.holeId), eq(ingestHole.companyId, ctx.companyId))),
      auditInsert(ctx, { action: "ingest.hole.save", subjectType: "ingest_hole", subjectId: v.holeId, meta: { version: v.version, madeBy: v.madeBy } }),
    );
  }
  await guardedBatch(ctx.db, statements);
  return candidateDetail(ctx, c.id);
}

/** JSON with object keys sorted, so two equal recipes compare equal whatever their key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether an approved layout version of the plant for this header key holds exactly this recipe. */
async function approvedVersionWith(ctx: Pick<IngestCtx, "db" | "companyId">, headerKey: string, recipe: Recipe): Promise<boolean> {
  const rows = await ctx.db
    .select({ recipe: ingestHoleVersion.recipe })
    .from(ingestHoleVersion)
    .innerJoin(ingestHole, eq(ingestHole.id, ingestHoleVersion.holeId))
    .where(
      and(
        eq(ingestHoleVersion.companyId, ctx.companyId),
        eq(ingestHoleVersion.headerKey, headerKey),
        eq(ingestHoleVersion.state, "approved"),
        eq(ingestHole.state, "active"),
      ),
    );
  const want = canonicalJson(recipe);
  return rows.some((r) => canonicalJson(r.recipe) === want);
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

/**
 * Held back to checking (A15): the open rows run again from the first one, so a cause fixed outside
 * (a die added, a customer merged) shows in the rows; the candidate then reaches ready and can be
 * approved again. A merged row stays merged and the layout stays locked.
 */
export async function releaseCandidate(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<CandidateDetail> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  // A ready one too (rule 2): its refusals may be out of date, and approve says so.
  assertState(c, ["held", "ready"], "Only a held or ready import can be checked again");
  if (c.parentId) {
    // A derived list has no recipe to run: it goes straight back to ready. A part of it that stopped
    // the server on every send opens first, as for any candidate (X-new-5), so the person can skip
    // its rows. Names that landed need no lookup: the customers adapter sends only names not in orrn.
    const stuck = c.state === "held" ? await openStuckParts(ctx, c.id, "customers") : { statements: [], written: 0, from: null };
    await guardedBatch(ctx.db, [
      ...candidateChange(ctx, c.id, input.expectSeq, {
        state: "ready",
        reasonCode: null,
        reasonDetail: null,
        approvedBy: null,
        approvedAt: null,
        ...(stuck.written > 0 ? { recipeLocked: true } : {}),
      }),
      ...stuck.statements,
      ...(stuck.statements.length ? [recountStatement(ctx, c.id)] : []),
      auditInsert(ctx, {
        action: "ingest.candidate.recheck",
        subjectType: "ingest_candidate",
        subjectId: c.id,
        meta: { from: c.state, reason: c.reasonCode, ...(stuck.statements.length ? { stuckOpened: true, stuckWritten: stuck.written } : {}) },
      }),
    ]);
    return candidateDetail(ctx, c.id);
  }
  // A part that stopped the server on every send is opened first (X-new-5): rows that landed are
  // recorded as written, the rest open again for the person and the dry run.
  const stuck = c.target ? await openStuckParts(ctx, c.id, c.target) : { statements: [], written: 0, from: null };
  const [first] = await ctx.db
    .select({ n: sql<number | null>`min(${ingestStagedRow.rowIndex})` })
    .from(ingestStagedRow)
    .where(and(eq(ingestStagedRow.candidateId, c.id), eq(ingestStagedRow.mergeState, "open")));
  const opened = [first?.n, stuck.from].filter((x): x is number => x !== null && x !== undefined).map(Number);
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, {
      state: "processing",
      dryCursor: opened.length ? Math.min(...opened) : 0,
      reasonCode: null,
      reasonDetail: null,
      approvedBy: null,
      approvedAt: null,
      ...(stuck.written > 0 ? { recipeLocked: true } : {}),
    }),
    ...stuck.statements,
    ...(stuck.statements.length ? [recountStatement(ctx, c.id)] : []),
    auditInsert(ctx, {
      action: "ingest.candidate.recheck",
      subjectType: "ingest_candidate",
      subjectId: c.id,
      meta: { from: c.state, reason: c.reasonCode, ...(stuck.statements.length ? { stuckOpened: true, stuckWritten: stuck.written } : {}) },
    }),
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
  // Sheets that waited on this one check again at once (item 3).
  const again = await othersAgainAfter(ctx, c, "discarded", now());
  if (again.length) await ctx.db.batch(again as never);
  return candidateDetail(ctx, c.id);
}

/**
 * Rule 7.2, "Wrong columns? Pick the row": a sheet with no row written goes back to its header pick.
 * Its staged rows, answers, candidates (the derived list too) and the block go; the file is reading
 * again and takes a person's pick for that table. Sheets that waited on it check again.
 */
export async function repickHeader(ctx: IngestCtx, input: { candidateId: string; expectSeq: number }): Promise<{ artifactId: string; ordinal: number }> {
  const c = await loadCandidateAt(ctx, input.candidateId, input.expectSeq);
  if (c.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the row on the sheet this list came from" });
  const kin = await ctx.db
    .select({ id: ingestCandidate.id, state: ingestCandidate.state, rowsWritten: ingestCandidate.rowsWritten, recipeLocked: ingestCandidate.recipeLocked, target: ingestCandidate.target })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), or(eq(ingestCandidate.blockId, c.blockId), eq(ingestCandidate.parentId, c.id))));
  const written = (k: { state: CandidateState; rowsWritten: number; recipeLocked: boolean }) =>
    k.rowsWritten > 0 || k.recipeLocked || k.state === "approved" || k.state === "merging" || k.state === "merged";
  if (kin.some(written)) throw new TRPCError({ code: "BAD_REQUEST", message: REPICK_WRITTEN });
  // Rule 10.2: no other sheet of the file is approved, merging or written.
  const file = await ctx.db
    .select({ state: ingestCandidate.state, rowsWritten: ingestCandidate.rowsWritten })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, c.artifactId)));
  if (file.some((k) => k.rowsWritten > 0 || k.state === "merged")) throw new TRPCError({ code: "BAD_REQUEST", message: REPICK_WRITTEN });
  if (file.some((k) => k.state === "approved" || k.state === "merging")) throw new TRPCError({ code: "BAD_REQUEST", message: FILE_APPROVED });
  const block = await loadBlock(ctx, c.blockId);
  const artifact = await loadArtifact(ctx, c.artifactId);
  const at = now();
  const ids = kin.map((k) => k.id);
  // Pending references other sheets hold to these rows are checked again, while the rows still exist.
  const again: SqliteBatchItem[] = [];
  for (const k of kin) if (k.target) again.push(...(await othersAgainAfter(ctx, { id: k.id, target: k.target }, "discarded", at)));
  const asked = { ...(artifact.headerAsked ?? {}), [String(block.ordinal)]: { answer: "pick" as const, at: at.getTime() } };
  await guardedBatch(ctx.db, [
    ...candidateChange(ctx, c.id, input.expectSeq, {}),
    // No row of the sheet was written in between.
    ctx.db
      .update(ingestCandidate)
      .set({ updatedAt: at })
      .where(
        and(
          eq(ingestCandidate.id, c.id),
          sql`not exists (select 1 from ingest_staged_row r where r.candidate_id in ${ids} and r.merge_state = 'written')`,
          noSheetApproved(ctx.companyId, c.artifactId),
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
    ...again,
    ctx.db.delete(ingestStagedRow).where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.candidateId, ids))),
    ctx.db.delete(ingestAnswer).where(and(eq(ingestAnswer.companyId, ctx.companyId), inArray(ingestAnswer.candidateId, ids))),
    ctx.db.delete(ingestBotRun).where(and(eq(ingestBotRun.companyId, ctx.companyId), inArray(ingestBotRun.candidateId, ids))),
    ctx.db.delete(ingestCandidate).where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, ids))),
    ctx.db.delete(ingestBlock).where(and(eq(ingestBlock.id, block.id), eq(ingestBlock.companyId, ctx.companyId))),
    ctx.db
      .update(ingestArtifact)
      .set({ readState: "reading", headerAsked: asked, updatedAt: at })
      .where(and(eq(ingestArtifact.id, artifact.id), eq(ingestArtifact.companyId, ctx.companyId))),
    auditInsert(ctx, {
      action: "ingest.block.repick",
      subjectType: "ingest_artifact",
      subjectId: artifact.id,
      meta: { ordinal: block.ordinal, sheetName: block.sheetName, headerRow: block.headerRow, headerRows: block.headerRows, headerBy: block.headerBy, candidateIds: ids },
    }),
  ]);
  return { artifactId: artifact.id, ordinal: block.ordinal };
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
  // Retiring changes what fits for the plant, so it is audited with the change (A31).
  await guardedBatch(ctx.db, [
    ctx.db.update(ingestHole).set({ state: "retired", updatedAt: now() }).where(and(eq(ingestHole.id, h.id), eq(ingestHole.companyId, ctx.companyId))),
    auditInsert(ctx, { action: "ingest.hole.retire", subjectType: "ingest_hole", subjectId: h.id, meta: { name: h.name, target: h.target, from: h.state } }),
  ]);
  const [view] = (await listHoles(ctx, { target: h.target })).filter((x) => x.id === h.id);
  return view!;
}

/** The file, sheet and row behind a record the merge wrote (plan A6). */
export async function provenanceFor(ctx: IngestCtx, input: { type: string; id: string }): Promise<ProvenanceOut> {
  const [row] = await ctx.db
    .select({
      raw: ingestStagedRow.raw,
      recipe: ingestCandidate.recipe,
      headers: ingestBlock.headers,
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
  return {
    artifact: { id: row.artifactId, fileName: row.fileName, sha256: row.sha256, createdAt: row.createdAt.getTime() },
    sheet: row.sheet,
    blockOrdinal: row.ordinal,
    rowIndex: row.rowIndex,
    // A person who cannot see rates never reads them through the source row either, whatever the
    // record's type is called (A29).
    raw: seesRates(ctx) ? row.raw : maskCells(row.raw, rateMaskColumns(row.headers, [row.recipe])),
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
