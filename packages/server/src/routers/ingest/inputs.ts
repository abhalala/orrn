/** Zod inputs of the `ingest` router (plan B5). Bounds are plan A9. */
import { z } from "zod";

import { ARTIFACT_KINDS, CANDIDATE_STATES, INGEST_TARGETS, QUESTION_CODES, ROW_DECISIONS, ROW_STATES } from "@orrn/db/schema/ingest";

import { INGEST_LIMITS as L } from "../../lib/ingest/types";

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

const cell = z.string().max(L.cellChars);

export const blockInput = z.object({
  ordinal: z.number().int().min(0).max(L.blocksPerFile - 1),
  sheetName: z.string().max(200).nullable(),
  title: z.string().max(500).nullable(),
  headerRow: z.number().int().min(0).max(1000),
  headerRows: z.number().int().min(1).max(2),
  headers: z.array(z.string().max(L.cellChars)).min(1).max(L.columnsPerBlock),
  rowCount: z.number().int().min(0).max(L.stagedRowsPerBlock),
  sample: z.array(z.array(cell).max(L.columnsPerBlock)).max(L.sampleRowsPerBlock),
  dateColumns: z.array(z.number().int().min(0).max(L.columnsPerBlock)).max(L.columnsPerBlock).optional(),
});

export const putBlocksInput = z.object({
  artifactId: id,
  blocks: z.array(blockInput).min(1).max(L.blocksPerFile),
});

export const putRowsInput = z.object({
  blockId: id,
  fromIndex: z.number().int().min(0).max(L.stagedRowsPerBlock),
  expectRowsPut: z.number().int().min(0).max(L.stagedRowsPerBlock),
  rows: z.array(z.array(cell).max(L.columnsPerBlock)).min(1).max(L.rowsPerPut),
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

export const candidateSeqInput = z.object({ candidateId: id, expectSeq: seq });

export const holdInput = z.object({ candidateId: id, reason: z.string().trim().max(300).optional(), expectSeq: seq });

export const mergeStepInput = z.object({ runId: id, expectCursor: z.number().int().min(0) });

export const runIdInput = z.object({ runId: id });

export const holeListInput = z.object({ target: z.enum(INGEST_TARGETS).optional() });

export const holeIdInput = z.object({ holeId: id });

export const provenanceInput = z.object({ type: z.string().min(1).max(64), id });
