import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Infinity Portal (plan 2026-11-10, section B1). A file comes in as an artifact; each table read from
 * it is a block; each block gets one candidate per target; a candidate stages one row per source row.
 * Raw bytes live in the R2 vault (`INGEST_VAULT`), never in D1. Nothing here writes live tables: the
 * merge does, through the existing procedures.
 *
 * The JSON columns hold shapes defined in `@orrn/ingest` (Recipe, FitDiff, PeriodGuess). The db package
 * does not depend on that package, so the types here are structural; the server checks a recipe with
 * `recipeSchema` before it uses one.
 */

export const INGEST_TARGETS = [
  "customers",
  "customer_aliases",
  "vendors",
  "vendor_aliases",
  "dies",
  "die_copies",
  "bundles",
  "orders",
] as const;
export type IngestTarget = (typeof INGEST_TARGETS)[number];

export const CANDIDATE_STATES = [
  "processing",
  "needs_shape",
  "needs_confirm",
  "ready",
  "held",
  "approved",
  "merging",
  "merged",
  "failed",
  "discarded",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const ROW_STATES = [
  "pending",
  "ready_create",
  "ready_update",
  "unchanged",
  "ambiguous",
  "conflict",
  "refused",
  "skipped",
] as const;
export type RowState = (typeof ROW_STATES)[number];

export const QUESTION_CODES = [
  "unit_unknown",
  "date_format_ambiguous",
  "period_needed",
  "rates_hidden",
  "column_meaning_unclear",
  "create_legacy_die",
  "new_customers",
] as const;
export type QuestionCode = (typeof QUESTION_CODES)[number];

export const ARTIFACT_KINDS = ["sheet", "csv", "sql", "pdf_text", "pdf_scan", "image"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const VAULT_STATES = ["pending", "stored", "not_stored"] as const;
export type VaultState = (typeof VAULT_STATES)[number];
export const READ_STATES = ["reading", "read", "failed"] as const;
export type ReadState = (typeof READ_STATES)[number];
export const CANDIDATE_FITS = ["exact", "near", "none", "manual", "bot"] as const;
export type CandidateFit = (typeof CANDIDATE_FITS)[number];
export const ROW_DECISIONS = ["skip", "keep_file", "keep_live", "create_new", "use_match"] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];
export const ROW_MERGE_STATES = ["open", "queued", "written"] as const;
export const MERGE_RUN_STATES = ["planning", "running", "done", "done_with_holds", "stopped"] as const;
export type MergeRunState = (typeof MERGE_RUN_STATES)[number];
export const MERGE_CHUNK_STATES = ["planned", "sent", "written", "failed"] as const;
export type MergeChunkState = (typeof MERGE_CHUNK_STATES)[number];
/** `pending`: a call claimed its place under the caps and has not answered yet (A8). */
export const BOT_RUN_OUTCOMES = ["recipe", "no_target", "invalid", "refused", "error", "capped", "sample_failed", "pending"] as const;
export type BotRunOutcome = (typeof BOT_RUN_OUTCOMES)[number];

/** Column kinds of plan B3 (`@orrn/ingest` fingerprint). */
export type IngestCellKind = "date" | "int" | "decimal" | "code" | "text" | "mixed" | "empty";

/** Plan B8 `PeriodGuess`. */
export type IngestPeriodGuess = {
  fy: string | null;
  asOf: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
  sources: { kind: string; value: string }[];
};

/** A recipe (plan B2) as stored. Checked with `recipeSchema` from `@orrn/ingest` before use. */
export type IngestRecipeJson = { schemaVersion: 1; target: IngestTarget } & Record<string, unknown>;

/** A fit diff (plan B3) as stored; the exact shape is `FitDiff` in `@orrn/ingest`. */
export type IngestFitDiffJson = Record<string, unknown>;

const companyRef = () =>
  text("company_id")
    .notNull()
    .references(() => company.id, { onDelete: "cascade" });
const userRef = (name: string) => text(name).references(() => user.id, { onDelete: "set null" });
const createdAtCol = () => integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull();
const updatedAtCol = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .default(nowMs)
    .$onUpdate(() => new Date())
    .notNull();
const count = (name: string) => integer(name).notNull().default(0);

export const ingestArtifact = sqliteTable(
  "ingest_artifact",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    /** Hex SHA-256 of the raw bytes. One artifact per plant per digest. */
    sha256: text("sha256").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    kind: text("kind", { enum: ARTIFACT_KINDS }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    vaultState: text("vault_state", { enum: VAULT_STATES }).notNull(),
    readState: text("read_state", { enum: READ_STATES }).notNull(),
    readError: text("read_error"),
    blockCount: count("block_count"),
    rowCount: count("row_count"),
    period: text("period", { mode: "json" }).$type<IngestPeriodGuess>(),
    periodConfirmed: text("period_confirmed", { mode: "json" }).$type<{ fy: string | null; asOf: string | null }>(),
    note: text("note"),
    uploadedBy: userRef("uploaded_by"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex("ingest_artifact_company_sha_unique").on(t.companyId, t.sha256),
    index("ingest_artifact_company_created_idx").on(t.companyId, t.createdAt),
  ],
);

export const ingestBlock = sqliteTable(
  "ingest_block",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => ingestArtifact.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    sheetName: text("sheet_name"),
    title: text("title"),
    headerRow: integer("header_row").notNull(),
    headerRows: integer("header_rows").notNull().default(1),
    headers: text("headers", { mode: "json" }).$type<string[]>().notNull(),
    kinds: text("kinds", { mode: "json" }).$type<IngestCellKind[]>().notNull(),
    headerKey: text("header_key").notNull(),
    columnCount: integer("column_count").notNull(),
    rowCount: count("row_count"),
    rowsPut: count("rows_put"),
    sample: text("sample", { mode: "json" }).$type<string[][]>().notNull(),
    readBy: text("read_by", { enum: ["parser", "model"] }).notNull().default("parser"),
    modelChecked: integer("model_checked", { mode: "boolean" }).notNull().default(false),
    /** The browser's canonical rows file for this block landed in the vault (set by the upload route). */
    canonicalStored: integer("canonical_stored", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex("ingest_block_artifact_ordinal_unique").on(t.artifactId, t.ordinal),
    index("ingest_block_company_header_key_idx").on(t.companyId, t.headerKey),
  ],
);

/** A learned layout of one plant (plan B1). Built-in layouts are code, not rows. */
export const ingestHole = sqliteTable(
  "ingest_hole",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    target: text("target", { enum: INGEST_TARGETS }).notNull(),
    name: text("name").notNull(),
    currentVersion: integer("current_version").notNull(),
    state: text("state", { enum: ["active", "retired"] }).notNull().default("active"),
    createdBy: userRef("created_by"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index("ingest_hole_company_target_idx").on(t.companyId, t.target)],
);

export const ingestHoleVersion = sqliteTable(
  "ingest_hole_version",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    holeId: text("hole_id")
      .notNull()
      .references(() => ingestHole.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    headerKey: text("header_key").notNull(),
    recipe: text("recipe", { mode: "json" }).$type<IngestRecipeJson>().notNull(),
    madeBy: text("made_by", { enum: ["person", "bot", "bot_edited"] }).notNull(),
    botRunId: text("bot_run_id"),
    state: text("state", { enum: ["draft", "approved"] }).notNull(),
    createdBy: userRef("created_by"),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex("ingest_hole_version_unique").on(t.holeId, t.version),
    index("ingest_hole_version_company_key_idx").on(t.companyId, t.headerKey, t.state),
  ],
);

export const ingestCandidate = sqliteTable(
  "ingest_candidate",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => ingestArtifact.id, { onDelete: "cascade" }),
    blockId: text("block_id")
      .notNull()
      .references(() => ingestBlock.id, { onDelete: "cascade" }),
    /** A derived candidate, e.g. new customers found in an orders block. */
    parentId: text("parent_id"),
    /** Null while `needs_shape` with no guess. */
    target: text("target", { enum: INGEST_TARGETS }),
    /** "builtin:<id>@<v>" or "learned:<holeVersionId>". */
    holeRef: text("hole_ref"),
    /** The recipe this candidate runs. Null while `needs_shape`. */
    recipe: text("recipe", { mode: "json" }).$type<IngestRecipeJson>(),
    fit: text("fit", { enum: CANDIDATE_FITS }).notNull(),
    fitScore: integer("fit_score"),
    fitDiff: text("fit_diff", { mode: "json" }).$type<IngestFitDiffJson>(),
    state: text("state", { enum: CANDIDATE_STATES }).notNull(),
    reasonCode: text("reason_code"),
    reasonDetail: text("reason_detail"),
    /** Compare-and-set guard for every change (`expectSeq`). */
    serverSeq: count("server_seq"),
    /** The dry-run pump cursor: the next row index to run (`expectCursor`). */
    dryCursor: count("dry_cursor"),
    rowsTotal: count("rows_total"),
    rowsCreate: count("rows_create"),
    rowsUpdate: count("rows_update"),
    rowsUnchanged: count("rows_unchanged"),
    rowsAmbiguous: count("rows_ambiguous"),
    rowsConflict: count("rows_conflict"),
    rowsRefused: count("rows_refused"),
    rowsSkipped: count("rows_skipped"),
    rowsWritten: count("rows_written"),
    openQuestions: count("open_questions"),
    botAttempts: count("bot_attempts"),
    recipeLocked: integer("recipe_locked", { mode: "boolean" }).notNull().default(false),
    approvedBy: userRef("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex("ingest_candidate_block_target_unique").on(t.blockId, t.target),
    index("ingest_candidate_company_state_idx").on(t.companyId, t.state),
    index("ingest_candidate_artifact_idx").on(t.artifactId),
  ],
);

export const ingestStagedRow = sqliteTable(
  "ingest_staged_row",
  {
    /** Hex sha256(rowKey + "|" + target). */
    id: text("id").primaryKey(),
    companyId: companyRef(),
    /** Hex sha256(artifactId|blockOrdinal|rowIndex). */
    rowKey: text("row_key").notNull(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestCandidate.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    raw: text("raw", { mode: "json" }).$type<string[]>().notNull(),
    values: text("values", { mode: "json" }).$type<Record<string, unknown>>(),
    /**
     * What the file gave for each numeric field before conversion, kept for audit (owner rule):
     * `{ field: { text: "12.5", unit: "kg" } }`. `values` holds the canonical integers.
     */
    entered: text("entered", { mode: "json" }).$type<Record<string, { text: string; unit: string | null }>>(),
    state: text("state", { enum: ROW_STATES }).notNull().default("pending"),
    reasons: text("reasons", { mode: "json" }).$type<string[]>(),
    matchId: text("match_id"),
    diff: text("diff", { mode: "json" }).$type<Record<string, { live: unknown; file: unknown }>>(),
    decision: text("decision", { enum: ROW_DECISIONS }),
    mergeState: text("merge_state", { enum: ROW_MERGE_STATES }).notNull().default("open"),
    committedType: text("committed_type"),
    committedId: text("committed_id"),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex("ingest_staged_row_candidate_index_unique").on(t.candidateId, t.rowIndex),
    index("ingest_staged_row_candidate_state_idx").on(t.candidateId, t.state),
    index("ingest_staged_row_committed_idx").on(t.companyId, t.committedType, t.committedId),
    index("ingest_staged_row_company_key_idx").on(t.companyId, t.rowKey),
  ],
);

export const ingestAnswer = sqliteTable(
  "ingest_answer",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestCandidate.id, { onDelete: "cascade" }),
    questionCode: text("question_code", { enum: QUESTION_CODES }).notNull(),
    /** Field name, source value, or "" for the whole candidate. */
    subject: text("subject").notNull(),
    answer: text("answer", { mode: "json" }).$type<unknown>().notNull(),
    answeredBy: userRef("answered_by"),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("ingest_answer_unique").on(t.candidateId, t.questionCode, t.subject)],
);

export const ingestMergeRun = sqliteTable(
  "ingest_merge_run",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    state: text("state", { enum: MERGE_RUN_STATES }).notNull(),
    cursor: count("cursor"),
    serverSeq: count("server_seq"),
    chunksTotal: count("chunks_total"),
    chunksWritten: count("chunks_written"),
    chunksFailed: count("chunks_failed"),
    startedBy: userRef("started_by"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // One active run per plant: a second start fails in the statement itself.
    uniqueIndex("ingest_merge_run_one_active")
      .on(t.companyId)
      .where(sql`${t.state} in ('planning','running')`),
    index("ingest_merge_run_company_started_idx").on(t.companyId, t.startedAt),
  ],
);

export const ingestMergeChunk = sqliteTable(
  "ingest_merge_chunk",
  {
    /** The chunk's clientRequestId, "ing-" plus 40 hex. */
    id: text("id").primaryKey(),
    companyId: companyRef(),
    runId: text("run_id")
      .notNull()
      .references(() => ingestMergeRun.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => ingestCandidate.id, { onDelete: "cascade" }),
    target: text("target", { enum: INGEST_TARGETS }).notNull(),
    seq: integer("seq").notNull(),
    rowFrom: integer("row_from").notNull(),
    rowTo: integer("row_to").notNull(),
    rowCount: integer("row_count").notNull(),
    state: text("state", { enum: MERGE_CHUNK_STATES }).notNull(),
    attempts: count("attempts"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    writtenAt: integer("written_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("ingest_merge_chunk_run_seq_unique").on(t.runId, t.seq),
    index("ingest_merge_chunk_candidate_idx").on(t.candidateId),
  ],
);

export const ingestBotRun = sqliteTable(
  "ingest_bot_run",
  {
    id: text("id").primaryKey(),
    companyId: companyRef(),
    /**
     * The block a shape run worked on, or the page key of a vision run (`<artifactId>:p<page>`): a
     * scan or photo has no block until the vision read makes one. No foreign key, so a run's cost
     * stays counted toward the day caps when a failed file is read again and its blocks go.
     */
    blockId: text("block_id").notNull(),
    candidateId: text("candidate_id"),
    purpose: text("purpose", { enum: ["shape", "vision"] }).notNull(),
    /** The model actually used; fallbacks may change it. */
    model: text("model").notNull(),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome", { enum: BOT_RUN_OUTCOMES }).notNull(),
    inputTokens: count("input_tokens"),
    outputTokens: count("output_tokens"),
    cacheReadTokens: count("cache_read_tokens"),
    cacheWriteTokens: count("cache_write_tokens"),
    costMicroUsd: count("cost_micro_usd"),
    durationMs: count("duration_ms"),
    /** Codes of a failed attempt (never free model text); sent back on the retry. */
    errorCodes: text("error_codes", { mode: "json" }).$type<string[]>(),
    createdBy: userRef("created_by"),
    createdAt: createdAtCol(),
  },
  (t) => [
    index("ingest_bot_run_company_created_idx").on(t.companyId, t.createdAt),
    index("ingest_bot_run_block_idx").on(t.blockId),
  ],
);
