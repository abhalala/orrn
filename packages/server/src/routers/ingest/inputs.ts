/** Zod inputs of the `ingest` router (plan B5). Bounds are plan A9. */
import { z } from "zod";
import { PREVIEW_HEAD_ROWS, PREVIEW_ROWS } from "@orrn/ingest";

import { ARTIFACT_KINDS, CANDIDATE_STATES, INGEST_TARGETS, QUESTION_CODES, ROW_DECISIONS, ROW_STATES } from "@orrn/db/schema/ingest";

import { DOUBT_CODES, INGEST_LIMITS as L } from "../../lib/ingest/types";

const id = z.string().min(1).max(64);
const seq = z.number().int().min(0);
const cursor = z.string().max(200).optional();

export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "Not a SHA-256 digest");

export const beginInput = z.object({
  sha256: sha256Hex,
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(L.maxFileBytes.sql),
  contentType: z.string().max(200).nullable(),
  kind: z.enum(ARTIFACT_KINDS),
  note: z.string().max(L.noteChars).optional(),
});

export const artifactIdInput = z.object({ artifactId: id });

/** `readError` set: the browser could not read the file; the artifact and its candidates become failed. */
export const completeInput = z.object({ artifactId: id, readError: z.string().trim().min(1).max(300).optional() });

/**
 * Cells longer than 200 characters are cut by the server with a reason code (A9). The wire takes at
 * most 1,000, and a row at most 8 KB of JSON, so a request stays near what the server keeps (A32).
 */
const cell = z.string().max(1000);
const ROW_JSON_MAX = 8 * 1024;
const row = z
  .array(cell)
  .max(L.columnsPerBlock)
  .refine((r) => new TextEncoder().encode(JSON.stringify(r)).length <= ROW_JSON_MAX, "A row is too long");

/**
 * The highest raw row a reader may report: a sheet has at most 1,048,576 rows, and a PDF line number is
 * smaller. A reread or picked header may be anywhere in the region, so the header and preview rows use it.
 */
const RAW_ROW_MAX = 1_048_576;

export const blockInput = z.object({
  ordinal: z.number().int().min(0).max(L.blocksPerFile - 1),
  sheetName: z.string().max(200).nullable(),
  title: z.string().max(500).nullable(),
  headerRow: z.number().int().min(0).max(RAW_ROW_MAX),
  headerRows: z.number().int().min(1).max(2),
  headers: z.array(cell).min(1).max(L.columnsPerBlock),
  rowCount: z.number().int().min(0).max(L.stagedRowsPerBlock),
  /** The browser's own reading; the server recomputes both and never trusts these. */
  kinds: z.array(z.string().max(20)).max(L.columnsPerBlock).optional(),
  headerKey: z.string().max(100).optional(),
  sample: z.array(row).max(L.sampleRowsPerBlock),
  dateColumns: z.array(z.number().int().min(0).max(L.columnsPerBlock)).max(L.columnsPerBlock).optional(),
  /** Rules 4.1 and 5.1: the raw rows the header is checked on (at most 15 rows: the first 3 of the region and 12 around the header; 200 cells, 200 characters). */
  preview: z
    .array(
      z.object({
        row: z.number().int().min(0).max(RAW_ROW_MAX),
        page: z.number().int().min(1).max(10_000).optional(),
        cells: z.array(z.string().max(200)).max(200),
      }),
    )
    .max(PREVIEW_ROWS + PREVIEW_HEAD_ROWS)
    .optional(),
  /**
   * Lead answer (b): vertical merged cell ranges the reader saw, by block row index (0 is the first
   * row after the header) and column. Without them a blank cell stays blank.
   */
  merged: z
    .array(z.object({ col: z.number().int().min(0).max(L.columnsPerBlock), firstRow: z.number().int().min(0).max(L.stagedRowsPerBlock), lastRow: z.number().int().min(0).max(L.stagedRowsPerBlock) }))
    .max(10_000)
    .optional(),
  /** The header row a person picked on the preview; trusted. */
  hint: z.object({ headerRow: z.number().int().min(0).max(RAW_ROW_MAX), headerRows: z.union([z.literal(1), z.literal(2)]) }).optional(),
});

export const putBlocksInput = z.object({
  artifactId: id,
  blocks: z.array(blockInput).min(1).max(L.blocksPerFile),
});

export const putRowsInput = z.object({
  blockId: id,
  fromIndex: z.number().int().min(0).max(L.stagedRowsPerBlock),
  expectRowsPut: z.number().int().min(0).max(L.stagedRowsPerBlock),
  rows: z.array(row).min(1).max(L.rowsPerPut),
  /**
   * Rule 5.3: rows of this call the reader doubted (PDF). `row` is the block row index (from
   * `fromIndex`), `line` and `page` point into the file. One entry per row and code.
   */
  doubts: z
    .array(
      z.object({
        row: z.number().int().min(0).max(L.stagedRowsPerBlock),
        code: z.enum(DOUBT_CODES),
        line: z.number().int().min(0).max(RAW_ROW_MAX),
        page: z.number().int().min(1).max(10_000).optional(),
      }),
    )
    .max(L.rowsPerPut * DOUBT_CODES.length)
    .optional(),
});

export const listInput = z.object({ cursor, limit: z.number().int().min(1).max(50).default(20) });

export const periodConfirmInput = z.object({
  artifactId: id,
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Financial year looks like 2025-26")
    .nullable(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date looks like 2025-10-31")
    .nullable(),
});

export const candidateListInput = z.object({
  state: z.enum(CANDIDATE_STATES).optional(),
  artifactId: id.optional(),
  cursor,
  limit: z.number().int().min(1).max(50).default(50),
});

export const candidateIdInput = z.object({ candidateId: id });

export const setTargetInput = z.object({
  candidateId: id,
  target: z.union([z.enum(INGEST_TARGETS), z.literal("ignore")]),
  expectSeq: seq,
});

export const confirmNearInput = z.object({ candidateId: id, accept: z.boolean(), expectSeq: seq });

export const shapeMakeInput = z.object({ candidateId: id, expectSeq: seq });

export const shapeSaveInput = z.object({
  candidateId: id,
  /** Checked against `recipeSchema` and `validateRecipe` from `@orrn/ingest`. */
  recipe: z.unknown(),
  holeName: z.string().trim().min(1).max(100),
  expectSeq: seq,
});

export const dryRunStepInput = z.object({ candidateId: id, expectCursor: z.number().int().min(0) });

export const rowsListInput = z.object({
  candidateId: id,
  state: z.enum(ROW_STATES).optional(),
  cursor,
  limit: z.number().int().min(1).max(L.rowsPerPage).default(L.rowsPerPage),
});

export const answerSetInput = z.object({
  candidateId: id,
  questionCode: z.enum(QUESTION_CODES),
  subject: z.string().max(200),
  answer: z.unknown(),
  expectSeq: seq,
});

export const rowsDecideInput = z.object({
  candidateId: id,
  rowIds: z.array(id).min(1).max(L.decideRowsPerCall),
  decision: z.enum(ROW_DECISIONS),
  matchId: id.optional(),
  expectSeq: seq,
});

/** Rule 5.3: the open doubted rows of a candidate, a page at a time, with their count. */
export const rowsDoubtsInput = z.object({ candidateId: id, cursor, limit: z.number().int().min(1).max(L.rowsPerPage).default(L.rowsPerPage) });

/**
 * Rule 5.3: answer doubted rows. "right": the row goes on as read; "skip": the row is left out. One
 * row (`rowId`), or every open doubted row of the candidate with the count the person saw (`expectCount`).
 */
export const rowsAnswerDoubtsInput = z
  .object({ candidateId: id, answer: z.enum(["right", "skip"]), rowId: id.optional(), expectCount: z.number().int().min(1).max(L.stagedRowsPerBlock).optional(), expectSeq: seq })
  .refine((v) => (v.rowId === undefined) !== (v.expectCount === undefined), "Send one row, or the count of rows shown");

export const candidateSeqInput = z.object({ candidateId: id, expectSeq: seq });

export const holdInput = z.object({ candidateId: id, reason: z.string().trim().max(300).optional(), expectSeq: seq });

export const mergeStepInput = z.object({ runId: id, expectCursor: z.number().int().min(0) });

export const runIdInput = z.object({ runId: id });

export const holeListInput = z.object({ target: z.enum(INGEST_TARGETS).optional() });

export const holeIdInput = z.object({ holeId: id });

export const provenanceInput = z.object({ type: z.string().min(1).max(64), id });
