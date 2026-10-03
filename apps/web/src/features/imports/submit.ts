/**
 * Sending a parsed sheet to the server: fixed-size chunks, one call after
 * another, stopping at the first failure so a retry can pick up exactly where
 * the run stopped (rows already saved are never sent twice).
 */
import { chunk, IMPORT_CHUNK_SIZE, type DieImportRow, type RejectedRow } from "./parse";

export type ChunkRunResult<Res> =
  | { ok: true; done: number; results: Res[] }
  | { ok: false; done: number; failedChunk: number; error: unknown; results: Res[] };

export async function runChunks<T, Res>(
  items: readonly T[],
  send: (chunk: T[], index: number) => Promise<Res>,
  opts: { size?: number; startChunk?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChunkRunResult<Res>> {
  const size = opts.size ?? IMPORT_CHUNK_SIZE;
  const chunks = chunk(items, size);
  const start = opts.startChunk ?? 0;
  let done = Math.min(items.length, start * size);
  const results: Res[] = [];
  for (let index = start; index < chunks.length; index++) {
    const part = chunks[index]!;
    try {
      results.push(await send(part, index));
    } catch (error) {
      return { ok: false, done, failedChunk: index, error, results };
    }
    done += part.length;
    opts.onProgress?.(done, items.length);
  }
  return { ok: true, done, results };
}

/** What `die.validateImport` said about the rows (only the parts the sheet needs). */
export type DieCheck = {
  duplicates: readonly (DieImportRow & { existingId: string })[];
  errors: readonly DieImportRow[];
};

export type DieOp = { row: number; data: DieImportRow; existingId?: string };

const dieKey = (d: { series: string; sectionCode: string }) => `${d.series}\u0000${d.sectionCode}`;

/**
 * Turns the server check into the rows to send. Dies already in orrn are
 * updated only when the person chose "update"; codes held by a deleted die
 * become rejected rows (with their sheet row number) instead of failing the
 * whole import. Keys are unique within a sheet (the parser rejects repeats).
 */
export function planDies(
  ok: readonly DieImportRow[],
  okRows: readonly number[],
  check: DieCheck,
  mode: "skip" | "update",
  sectionColumn = "Section code",
): { ops: DieOp[]; existing: number; blocked: RejectedRow[] } {
  const existingIds = new Map(check.duplicates.map((d) => [dieKey(d), d.existingId]));
  const deleted = new Set(check.errors.map(dieKey));
  const ops: DieOp[] = [];
  const blocked: RejectedRow[] = [];
  ok.forEach((data, i) => {
    const row = okRows[i]!;
    const key = dieKey(data);
    if (deleted.has(key)) {
      blocked.push({ row, reason: "imports.reason.deletedDie", column: sectionColumn });
      return;
    }
    const existingId = existingIds.get(key);
    if (existingId === undefined) ops.push({ row, data });
    else if (mode === "update") ops.push({ row, data, existingId });
  });
  return { ops, existing: existingIds.size, blocked };
}

export function dieChunkInput(ops: readonly DieOp[]) {
  return {
    newRows: ops.filter((o) => o.existingId === undefined).map((o) => o.data),
    updatedRows: ops.filter((o) => o.existingId !== undefined).map((o) => ({ ...o.data, existingId: o.existingId! })),
  };
}
