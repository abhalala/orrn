/**
 * Sending a parsed sheet to the server: fixed-size chunks, one call after
 * another, stopping at the first failure so a retry can pick up exactly where
 * the run stopped.
 *
 * Every chunk carries a `clientRequestId` derived from its content (kind, sheet
 * row numbers, rows). The server gives the rows of one request fixed ids, so a
 * chunk that is sent again (its reply was lost, or the same unchanged sheet is
 * chosen again later) answers `replayed` instead of saving its rows twice
 * (packages/server/src/lib/importReplay.ts).
 */
import type { MessageKey } from "@orrn/i18n";

import {
  chunk,
  IMPORT_CHUNK_SIZE,
  type BundleImportRow,
  type DieImportRow,
  type ImportKind,
  type ParsedRow,
  type RejectedRow,
} from "./parse";

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

/** One row to send, with its sheet row number (and, for a die already in orrn, its id). */
export type ImportOp<R extends ParsedRow = ParsedRow> = { row: number; data: R; existingId?: string };

/* -------------------------------------------------------------------------- */
/* Dies                                                                        */
/* -------------------------------------------------------------------------- */

/** What `die.validateImport` said about the rows (only the parts the sheet needs). */
export type DieCheck = {
  duplicates: readonly (DieImportRow & { existingId: string })[];
  errors: readonly DieImportRow[];
};

export type DieOp = ImportOp<DieImportRow>;

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

/**
 * The `die.processImport` input for one chunk. An update carries only the
 * fields the sheet filled in (the parser leaves the rest out), and the server
 * writes only the keys it is sent, so a column the sheet lacks never clears a die.
 */
export function dieChunkInput(ops: readonly DieOp[]) {
  return {
    newRows: ops.filter((o) => o.existingId === undefined).map((o) => o.data),
    updatedRows: ops.filter((o) => o.existingId !== undefined).map((o) => ({ existingId: o.existingId!, ...o.data })),
  };
}

/* -------------------------------------------------------------------------- */
/* Old bundles                                                                 */
/* -------------------------------------------------------------------------- */

export type DieRef = { series: string; sectionCode: string };

/** What `bundle.importCheck` said: the sheet's dies that were deleted in orrn. */
export type BundleCheck = { deleted: readonly DieRef[] };

/** Each (series, section code) in the sheet once, in sheet order: the input of `bundle.importCheck`. */
export function uniqueDies(rows: readonly BundleImportRow[]): DieRef[] {
  const seen = new Set<string>();
  const out: DieRef[] = [];
  for (const r of rows) {
    const ref = { series: r.dieSeries, sectionCode: r.dieSectionCode };
    const key = dieKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * `bundle.bulkImport` refuses a whole call that names a deleted die, so those
 * rows become problem rows before anything is saved (orrn has no restore for
 * a deleted die; the rest of the sheet still imports).
 */
export function planBundles(
  ok: readonly BundleImportRow[],
  okRows: readonly number[],
  check: BundleCheck,
  sectionColumn = "Section code",
): { ops: ImportOp<BundleImportRow>[]; blocked: RejectedRow[] } {
  const deleted = new Set(check.deleted.map(dieKey));
  const ops: ImportOp<BundleImportRow>[] = [];
  const blocked: RejectedRow[] = [];
  ok.forEach((data, i) => {
    const row = okRows[i]!;
    if (deleted.has(dieKey({ series: data.dieSeries, sectionCode: data.dieSectionCode }))) {
      blocked.push({ row, reason: "imports.reason.dieDeleted", column: sectionColumn });
    } else {
      ops.push({ row, data });
    }
  });
  return { ops, blocked };
}

/* -------------------------------------------------------------------------- */
/* Request ids and failures                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The chunk's `clientRequestId`: SHA-256 of its kind, sheet row numbers, rows
 * and update targets. Same chunk, same id, so the server recognises a resend.
 */
export async function chunkRequestId(kind: ImportKind, ops: readonly ImportOp[]): Promise<string> {
  const body = JSON.stringify([kind, ops.map((o) => [o.row, o.data, o.existingId ?? null])]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const hex = Array.from(digest.subarray(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
  return `imp-${hex}`;
}

/**
 * What a failed call means for its rows.
 * - `unknown`: the server never answered, or failed on its side (5xx). The
 *   rows may have been saved; sending them again is safe (request id).
 * - `refused`: the server answered and saved nothing from this call.
 * `retry` says whether trying again can work. Server text is never shown: it
 * is English, and some of it points at actions orrn does not have.
 */
export type ImportFailure = { outcome: "unknown" | "refused"; message: MessageKey; retry: boolean };

const SERVER_SIDE = new Set(["INTERNAL_SERVER_ERROR", "TIMEOUT", "CLIENT_CLOSED_REQUEST", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"]);

export function importFailure(error: unknown): ImportFailure {
  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } | null } | null)?.data;
  if (!data || typeof data.code !== "string") return { outcome: "unknown", message: "errors.network", retry: true };
  const status = typeof data.httpStatus === "number" ? data.httpStatus : 0;
  if (SERVER_SIDE.has(data.code) || status >= 500) return { outcome: "unknown", message: "imports.failed.server", retry: true };
  if (data.code === "TOO_MANY_REQUESTS") return { outcome: "refused", message: "imports.failed.busy", retry: true };
  if (data.code === "FORBIDDEN") return { outcome: "refused", message: "errors.forbidden", retry: false };
  if (data.code === "UNAUTHORIZED") return { outcome: "refused", message: "errors.sessionExpired", retry: false };
  return { outcome: "refused", message: "imports.failed.refused", retry: false };
}

/** tRPC routers whose lists change after an import of each kind (refreshed even when a later call failed). */
export const IMPORT_INVALIDATES = {
  bundles: ["bundle", "die", "dashboard", "stock", "analytics"],
  dies: ["die"],
  customers: ["customer"],
} as const satisfies Record<ImportKind, readonly string[]>;
