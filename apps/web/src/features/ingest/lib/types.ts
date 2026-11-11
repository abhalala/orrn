/**
 * Infinity Portal web types. They mirror plan sections B1, B5, B7 and B8 so the screens can be built before
 * the server lane lands. When `portal/A-core` is merged the router types win: `api.ts` is the only file that
 * touches the router, and these shapes are checked against it there.
 */

export const INGEST_TARGETS = [
  "customers", "customer_aliases", "vendors", "vendor_aliases", "dies", "die_copies", "bundles", "orders",
] as const;
export type IngestTarget = (typeof INGEST_TARGETS)[number];

export const CANDIDATE_STATES = [
  "processing", "needs_shape", "needs_confirm", "ready", "held", "approved", "merging", "merged", "failed", "discarded",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const ROW_STATES = [
  "pending", "ready_create", "ready_update", "unchanged", "ambiguous", "conflict", "refused", "skipped",
] as const;
export type RowState = (typeof ROW_STATES)[number];

export const QUESTION_CODES = [
  "unit_unknown", "date_format_ambiguous", "period_needed", "rates_hidden", "column_meaning_unclear",
  "create_legacy_die", "new_customers",
] as const;
export type QuestionCode = (typeof QUESTION_CODES)[number];

export const ROW_DECISIONS = ["skip", "keep_file", "keep_live", "create_new", "use_match"] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

export type ArtifactKind = "sheet" | "csv" | "sql" | "pdf_text" | "pdf_scan" | "image";
export type CellKind = "date" | "int" | "decimal" | "code" | "text" | "mixed" | "empty";
export type FitKind = "exact" | "near" | "none" | "manual" | "bot";
export type VaultState = "pending" | "stored" | "not_stored";
export type ReadState = "reading" | "read" | "failed";
export type MergeRunState = "planning" | "running" | "done" | "done_with_holds" | "stopped";
export type MergeChunkState = "planned" | "sent" | "written" | "failed";
export type BotOutcome = "recipe" | "no_target" | "invalid" | "refused" | "error" | "capped" | "sample_failed";
export type BotNext = "retry" | "escalate" | "manual" | "done";

export type PeriodConfidence = "high" | "medium" | "low" | "unknown";
export type PeriodGuess = {
  fy: string | null;
  asOf: string | null;
  confidence: PeriodConfidence;
  sources: { kind: string; value: string }[];
};

/** One table found in a file, as the browser sends it to `artifact.putBlocks` (plan B5, B1 `ingest_block`). */
export type BlockInput = {
  ordinal: number;
  sheetName: string | null;
  title: string | null;
  headerRow: number;
  headerRows: number;
  headers: string[];
  kinds: CellKind[];
  headerKey: string;
  columnCount: number;
  rowCount: number;
  sample: string[][];
};

export type CandidateCounts = {
  rowsTotal: number | null;
  rowsCreate: number;
  rowsUpdate: number;
  rowsUnchanged: number;
  rowsAmbiguous: number;
  rowsConflict: number;
  rowsRefused: number;
  rowsSkipped: number;
  rowsWritten: number;
};

export type CandidateSummary = CandidateCounts & {
  id: string;
  artifactId: string;
  blockId: string;
  parentId: string | null;
  target: IngestTarget | null;
  holeRef: string | null;
  fit: FitKind;
  fitScore: number | null;
  state: CandidateState;
  reasonCode: string | null;
  reasonDetail: string | null;
  serverSeq: number;
  dryCursor: number | null;
  openQuestions: number | null;
  botAttempts: number | null;
  recipeLocked: boolean;
};

/** What the near-fit card lists (plan B3 near matching). */
export type FitDiff = {
  name?: string;
  renamed: { old: string; new: string }[];
  extra: string[];
  missing: string[];
};

/** An unanswered or answered question of a candidate (plan B7 "Questions"). */
export type CandidateQuestion = {
  code: QuestionCode;
  subject: string;
  answer: unknown | null;
  /** Values the question sentence needs: field, sample, name, code, count. */
  context: Record<string, string | number>;
  rows: number;
};

export type CandidateDetail = CandidateSummary & {
  fitDiff: FitDiff | null;
  recipe: unknown | null;
  questions: CandidateQuestion[];
  blockOrdinal: number;
  sheetName: string | null;
  headers: string[];
  readBy: "parser" | "model";
  modelChecked: boolean;
};

export type StagedRow = {
  id: string;
  rowIndex: number;
  raw: string[];
  values: Record<string, unknown> | null;
  state: RowState;
  reasons: string[] | null;
  matchId: string | null;
  /** Options for an `ambiguous` row, when the server lists them. */
  matchOptions?: { id: string; name: string }[];
  diff: Record<string, { live: unknown; file: unknown }> | null;
  decision: RowDecision | null;
  mergeState: "open" | "queued" | "written";
  committedType: string | null;
  committedId: string | null;
  rate?: number | null;
  rateHidden?: boolean;
};

export type ArtifactSummary = {
  id: string;
  sha256: string;
  fileName: string;
  contentType: string | null;
  kind: ArtifactKind;
  sizeBytes: number;
  vaultState: VaultState;
  readState: ReadState;
  readError: string | null;
  blockCount: number | null;
  rowCount: number | null;
  period: PeriodGuess | null;
  periodConfirmed: { fy: string | null; asOf: string | null } | null;
  note: string | null;
  createdAt: string | number;
};

export type ArtifactDetail = ArtifactSummary & {
  blocks: { id: string; ordinal: number; sheetName: string | null; title: string | null; rowCount: number | null; rowsPut: number | null }[];
  candidates: CandidateSummary[];
};

export type IngestLimits = {
  maxFiles: number;
  maxBlocks: number;
  maxColumns: number;
  maxRawRows: number;
  maxStagedRowsPerBlock: number;
  openStagedRows: number;
  /** MB per file kind, plan A9. */
  maxMb: Record<"sheet" | "csv" | "sql" | "pdf" | "image", number>;
};

export type IngestStatus = {
  botReady: boolean;
  vaultReady: boolean;
  limits: IngestLimits;
  activeRunId: string | null;
  botToday: { calls: number; costMicroUsd: number };
};

export type UploadTicket = { url: string; ticket: string; expiresAt: string | number };

export type BeginResult = { artifactId: string; existing: boolean; upload: UploadTicket | null };

export type CandidateStepResult = { cursor: number; done: boolean; counts: CandidateCounts };

export type MergeStepResult = {
  state: MergeRunState;
  cursor: number | null;
  chunksTotal: number;
  chunksWritten: number;
  chunksFailed: number;
};

export type MergeRunDetail = MergeStepResult & {
  id: string;
  startedAt: string | number;
  finishedAt: string | number | null;
  created: number;
  updated: number;
  results: MergeCandidateResult[];
};

export type MergeCandidateResult = {
  candidateId: string;
  target: IngestTarget;
  state: "merging" | "merged" | "held" | "failed";
  rowsWritten: number;
  created: number;
  updated: number;
  reasonCode: string | null;
  reasonDetail: string | null;
};

export type ShapeMakeResult = { outcome: BotOutcome; attempt: number; model: string; next: BotNext };

/** A tRPC-style failure reduced to what the pumps need. */
export type ApiFailure = { code: string; message: string };
