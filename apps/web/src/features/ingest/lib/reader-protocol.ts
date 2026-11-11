import type { ArtifactKind, BlockInput } from "./types";

/** Messages between the page and `reader.worker.ts` (plan A4). */
export type ReadPhase = "hash" | "open" | "sheet" | "table" | "page" | "blocks";

export type ReadProgress = {
  phase: ReadPhase;
  sheet: string | null;
  rowsRead: number;
  rowsTotal: number | null;
};

export type WorkerRequest =
  | { id: number; type: "hash"; file: File }
  | { id: number; type: "read"; file: File; kind: ArtifactKind };

/** A block as read: what `putBlocks` sends, plus the rows that follow it in `putRows` and the canonical file. */
export type ReadBlock = { input: BlockInput; rows: string[][] };

export type ReadFailure =
  | { code: "no_text_layer" }
  | { code: "too_many_rows"; rows: number }
  | { code: "too_many_columns"; sheet: string | null; columns: number }
  | { code: "too_many_blocks"; blocks: number }
  | { code: "unreadable"; detail: string };

export type WorkerResponse =
  | { id: number; type: "progress"; progress: ReadProgress }
  | { id: number; type: "hashed"; sha256: string }
  | { id: number; type: "blocks"; kind: ArtifactKind; blocks: ReadBlock[]; rawRows: number }
  | { id: number; type: "failed"; failure: ReadFailure };
