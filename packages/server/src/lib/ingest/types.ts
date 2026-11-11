/**
 * Shared types of the Infinity Portal server (plan B5). The `ingest` router returns these shapes; the
 * web codes against them through tRPC inference, and the merge (lane B) and bot (lane D) modules take
 * `IngestCtx`.
 */
import type { OrrnDb } from "@orrn/db/atomic";
import type {
  ArtifactKind,
  CandidateFit,
  CandidateState,
  IngestCellKind,
  IngestFitDiffJson,
  IngestPeriodGuess,
  IngestRecipeJson,
  IngestTarget,
  MergeChunkState,
  MergeRunState,
  QuestionCode,
  ReadState,
  RowDecision,
  RowState,
  VaultState,
} from "@orrn/db/schema/ingest";
import type { CompanyRole } from "@orrn/db/schema/tenant";

import type { Context } from "../../context";

/** The context every ingest procedure, merge step and bot call runs with (after the action guard). */
export type IngestCtx = Pick<Context, "request" | "impersonation" | "ingestSource"> & {
  db: OrrnDb;
  companyId: string;
  role: CompanyRole;
  session: NonNullable<Context["session"]>;
};

/** Plan A9. One object so the browser and the server read the same numbers. */
export const INGEST_LIMITS = {
  maxFileBytes: {
    sheet: 20 * 1024 * 1024,
    csv: 50 * 1024 * 1024,
    sql: 100 * 1024 * 1024,
    pdf_text: 25 * 1024 * 1024,
    pdf_scan: 25 * 1024 * 1024,
    image: 10 * 1024 * 1024,
  } satisfies Record<ArtifactKind, number>,
  filesPerUpload: 20,
  blocksPerFile: 50,
  columnsPerBlock: 200,
  rawRowsPerFile: 200_000,
  stagedRowsPerBlock: 50_000,
  openRowsPerPlant: 300_000,
  cellChars: 200,
  /** `raw` JSON of one staged row, in bytes (A3). */
  rawBytesPerRow: 4096,
  rowsPerPut: 500,
  sampleRowsPerBlock: 200,
  dryRunRowsPerStep: 200,
  rowsPerPage: 100,
  decideRowsPerCall: 200,
  noteChars: 500,
} as const;
export type IngestLimits = typeof INGEST_LIMITS;

export type IngestStatus = {
  botReady: boolean;
  vaultReady: boolean;
  limits: IngestLimits;
  activeRunId: string | null;
  botToday: { calls: number; costMicroUsd: number };
};

export type UploadTicketOut = { url: string; ticket: string; expiresAt: number };

export type ArtifactBeginOut = {
  artifactId: string;
  /** The same file (same SHA-256) was uploaded before; this is that artifact. */
  existing: boolean;
  /** When the artifact was first uploaded (ms), for "You uploaded this file on {date}". */
  uploadedAt: number;
  /** Null when the vault is off or the bytes are already stored. */
  upload: UploadTicketOut | null;
};

/** One block the browser read (A1). The server recomputes kinds and the header key from it. */
export type BlockInput = {
  ordinal: number;
  sheetName: string | null;
  title: string | null;
  headerRow: number;
  headerRows: number;
  headers: string[];
  rowCount: number;
  /** Up to 200 data rows (first 100 plus 100 spread), cells cut to 200 characters. */
  sample: string[][];
  /** Column indexes the reader saw as real date cells (an Excel date), when it knows. */
  dateColumns?: number[];
  /**
   * Rule 4.1: the first raw rows of the region as read, before any header was applied (at most 12
   * rows of at most 200 cells, each cut to 200 characters), with their raw row numbers. With it the
   * server checks the header itself (`HeaderAnswer`). Without it (the old shape, for one release)
   * the header is taken as the browser read it and recorded as `reader`.
   */
  preview?: { row: number; page?: number; cells: string[] }[];
  /** The header row a person picked on the preview. Trusted; `headerRow` and `headerRows` must be it. */
  hint?: HeaderPickIn;
};

/** A header as hints take it: the raw row number and one or two header rows. */
export type HeaderPickIn = { headerRow: number; headerRows: 1 | 2 };

/** Who settled a block's header: the reader alone (old shape), a fit to a known layout, or a person. */
export type HeaderBy = "reader" | "fit" | "person";

/**
 * The server's answer for one block of `putBlocks` (rule 4.1). `keep`: the header is settled and
 * the block is saved; send its rows. `reread`: another row fits a known layout; read the table
 * again with that header and send the block again. `ask`: nothing fits; ask the person which row
 * has the column names (`guess` first, then `candidates`), read again with their pick, and send the
 * block again with that pick as `hint`. Rows of a block are taken only after `keep`.
 */
export type HeaderAnswer =
  | { ordinal: number; answer: "keep"; by: HeaderBy; blockId: string }
  | { ordinal: number; answer: "reread"; headerRow: number; headerRows: 1 | 2 }
  | { ordinal: number; answer: "ask"; guess: HeaderPickIn; candidates: HeaderPickIn[]; resembles: HeaderResemblesOut | null };

/**
 * Rule 5.1: the row that looks like a known layout but is not trusted, and that layout, so the screen
 * can say "This looks like <name>. Is row <headerRow> the column names?". It is `candidates[0]`.
 * `fit` is "near" (some columns differ) or "exact" (an exact fit the server still may not trust alone).
 */
export type HeaderResemblesOut = { headerRow: number; headerRows: 1 | 2; name: string; target: IngestTarget; fit: "exact" | "near" };

/** Rule 5.3: how a PDF reader doubted a row's split (packages/ingest RowDoubt codes). */
export const DOUBT_CODES = ["crosses_column", "cells_joined", "cells_close", "few_columns", "off_column"] as const;
export type DoubtCode = (typeof DOUBT_CODES)[number];
export type RowDoubtView = { code: DoubtCode; line: number; page?: number };
/** The open doubted rows of a candidate: `open` is the count the bulk answer must send back. */
export type DoubtListOut = { open: number; items: StagedRowView[]; nextCursor: string | null };

export type CandidateCounts = {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  ambiguous: number;
  conflict: number;
  refused: number;
  skipped: number;
  written: number;
};

export type CandidateSummary = {
  id: string;
  artifactId: string;
  blockId: string;
  parentId: string | null;
  target: IngestTarget | null;
  holeRef: string | null;
  /** The learned layout's name, or null for a built-in or no layout. */
  holeName: string | null;
  fit: CandidateFit;
  fitScore: number | null;
  state: CandidateState;
  reasonCode: string | null;
  reasonDetail: string | null;
  serverSeq: number;
  dryCursor: number;
  counts: CandidateCounts;
  openQuestions: number;
  botAttempts: number;
  recipeLocked: boolean;
  fileName: string;
  sheetName: string | null;
  blockOrdinal: number;
  updatedAt: number;
};

export type IngestQuestion = {
  code: QuestionCode;
  /** Field name, source value, or "" for the whole candidate. */
  subject: string;
  /** Values for the i18n text, e.g. `{ field: "rate" }` or `{ count: 12 }`. */
  params: Record<string, string | number>;
  answer: unknown;
  open: boolean;
};

export type BlockView = {
  id: string;
  ordinal: number;
  sheetName: string | null;
  title: string | null;
  headerRow: number;
  headerRows: number;
  headers: string[];
  kinds: IngestCellKind[];
  headerKey: string;
  columnCount: number;
  rowCount: number;
  rowsPut: number;
  sample: string[][];
  readBy: "parser" | "model";
  modelChecked: boolean;
  /** The canonical rows file of this block is in the vault. */
  canonicalStored: boolean;
};

export type CandidateDetail = CandidateSummary & {
  recipe: IngestRecipeJson | null;
  fitDiff: IngestFitDiffJson | null;
  questions: IngestQuestion[];
  block: BlockView;
  period: IngestPeriodGuess | null;
  periodConfirmed: { fy: string | null; asOf: string | null } | null;
  /** Rows of this block the browser has not sent yet. The dry run waits for them. */
  rowsMissing: number;
  /**
   * Orders: rows with no old order number and no PO. Each becomes its own order (rule 1); the
   * screen says so in the summary ("N rows have no order number; each becomes its own order").
   */
  rowsOwnOrder: number;
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
  blockCount: number;
  rowCount: number;
  period: IngestPeriodGuess | null;
  periodConfirmed: { fy: string | null; asOf: string | null } | null;
  note: string | null;
  uploadedBy: string | null;
  createdAt: number;
};

export type ArtifactDetail = ArtifactSummary & {
  blocks: (BlockView & { candidates: CandidateSummary[] })[];
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type RowMatchOption = { id: string; label: string };

export type StagedRowView = {
  id: string;
  rowIndex: number;
  state: RowState;
  values: Record<string, unknown> | null;
  /** What the file gave for each number before conversion ("12.5" "kg"). Rate masked like `rate`. */
  entered: Record<string, { text: string; unit: string | null }> | null;
  raw: string[];
  reasons: string[];
  matchId: string | null;
  /** Live records an ambiguous row could mean, best first. */
  options: RowMatchOption[];
  diff: Record<string, { live: unknown; file: unknown }> | null;
  decision: RowDecision | null;
  mergeState: "open" | "queued" | "written";
  committedType: string | null;
  committedId: string | null;
  /** Paise per kg, or null when the row has none or the viewer cannot see rates (A8). */
  rate: number | null;
  rateHidden: boolean;
  /** Rule 5.3: where the reader doubted the split (PDF): code, file line and page. Empty for most rows. */
  doubts: RowDoubtView[];
  /** A person said this doubted row is right, as read. */
  doubtConfirmed: boolean;
};

export type DryRunStepOut = { cursor: number; done: boolean; counts: CandidateCounts; state: CandidateState };

export type ShapeMakeOut = {
  /** `skipped`: no model call was made (no key, too many columns, attempts used up); see `skipReason`. */
  outcome: "recipe" | "no_target" | "invalid" | "refused" | "error" | "capped" | "sample_failed" | "skipped";
  skipReason: string | null;
  attempt: number;
  model: string;
  next: "retry" | "escalate" | "manual" | "done";
};

export type MergeStepOut = {
  state: MergeRunState;
  cursor: number;
  chunksTotal: number;
  chunksWritten: number;
  chunksFailed: number;
};

export type MergeCandidateResult = {
  candidateId: string;
  target: IngestTarget | null;
  state: CandidateState;
  reasonCode: string | null;
  reasonDetail: string | null;
  rowsWritten: number;
  rowsCreate: number;
  rowsUpdate: number;
  fileName: string;
  sheetName: string | null;
};

export type MergeChunkView = {
  id: string;
  candidateId: string;
  target: IngestTarget;
  seq: number;
  rowFrom: number;
  rowTo: number;
  rowCount: number;
  state: MergeChunkState;
  errorCode: string | null;
  errorMessage: string | null;
};

export type MergeRunView = MergeStepOut & {
  id: string;
  serverSeq: number;
  startedBy: string | null;
  startedAt: number;
  finishedAt: number | null;
  candidates: MergeCandidateResult[];
  /** Failed chunks only (the reasons behind holds). */
  failedChunks: MergeChunkView[];
};

export type HoleVersionView = {
  id: string;
  version: number;
  headerKey: string;
  madeBy: "person" | "bot" | "bot_edited";
  state: "draft" | "approved";
  createdAt: number;
};

export type HoleView = {
  id: string;
  target: IngestTarget;
  name: string;
  currentVersion: number;
  state: "active" | "retired";
  createdAt: number;
  versions: HoleVersionView[];
};

export type ProvenanceOut = {
  artifact: { id: string; fileName: string; sha256: string; createdAt: number };
  sheet: string | null;
  blockOrdinal: number;
  rowIndex: number;
  raw: string[];
} | null;
