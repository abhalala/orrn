/**
 * Types and small helpers shared by the merge planner, the step runner and the target adapters
 * (plan A5).
 */
import { orderIdentityOf, ownOrderKey } from "../orderid";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { ZodError } from "zod";

import type { ingestMergeChunk, ingestStagedRow, IngestTarget } from "@orrn/db/schema/ingest";

import type { CandidateRow } from "../core";
import type { IngestSource } from "../source";
import type { IngestCtx } from "../types";

export type StagedRow = typeof ingestStagedRow.$inferSelect;
export type ChunkRow = typeof ingestMergeChunk.$inferSelect;
export type Values = Record<string, unknown>;

/** What a staged row became in a live table. `committedType` is the live table's name. */
export type Written = { rowId: string; committedType: string; committedId: string; reasons?: string[] };

/**
 * Why a chunk was refused. `merge_failed`: the procedure's own message, shown as it is. `dependency_held`: `message` is the
 * held candidate's name. `customer_missing` (design fix M1): `message` is the party's name as the file wrote it, so the
 * page can say which customer is missing and what to do, in the person's language.
 */
export type ChunkFailure = { code: string; message: string; reason: "merge_failed" | "dependency_held" | "customer_missing" };

export type AdapterOut = { written: Written[]; failure: ChunkFailure | null };

/** A procedure caller that runs as the person, with this call's provenance on the context. */
export type CallerFor = (source: IngestSource) => Promise<MergeCaller>;
export type MergeCaller = ReturnType<typeof import("../../../routers/index").appRouter.createCaller>;

export type AdapterArgs = {
  ctx: IngestCtx;
  callerFor: CallerFor;
  chunk: ChunkRow;
  candidate: CandidateRow;
  rows: StagedRow[];
  /** `pending:<rowKey>` resolved to the live id written earlier in this run. */
  refs: Map<string, string>;
  /** The provenance of one call: the chunk's, narrowed to the rows the call carries. */
  sourceOf: (rows: readonly StagedRow[]) => IngestSource;
};

export type Adapter = (args: AdapterArgs) => Promise<AdapterOut>;

/** Rows per call and calls per chunk for each target (plan A5 table). */
export const CHUNK_ROWS: Record<IngestTarget, { create: number; update: number }> = {
  customers: { create: 500, update: 20 },
  customer_aliases: { create: 500, update: 500 },
  vendors: { create: 20, update: 20 },
  vendor_aliases: { create: 20, update: 20 },
  dies: { create: 500, update: 500 },
  die_copies: { create: 20, update: 20 },
  bundles: { create: 500, update: 500 },
  orders: { create: 0, update: 0 },
};

/** Orders: at most this many orders per chunk, and lines per order (`MAX_LINES` in routers/salesOrder.ts). */
export const ORDERS_PER_CHUNK = 10;
export const LINES_PER_ORDER = 100;

/** Targets whose updates go through a different procedure than their creates, one row per call. */
export const SPLIT_UPDATES: ReadonlySet<IngestTarget> = new Set(["customers", "vendors", "die_copies", "customer_aliases", "vendor_aliases"]);

export const MESSAGE_MAX = 300;

/**
 * The chunk mark (B-new-2). While a staged row is `queued`, `committed_type` holds this value and
 * `committed_id` holds the id of the chunk that will send it. A write step reads its rows by
 * `ingest_staged_row_committed_idx` (company, type, id): exactly the chunk's rows, never a range.
 * Writing the row replaces the mark with the live table and id; a row that opens again loses it.
 * Readers: `committed_type` and `committed_id` name a live record only when `merge_state` is
 * `written`.
 */
export const CHUNK_MARK = "ingest_merge_chunk";

/**
 * Where a chunk sits in its run's `seq` (B-new-2). A planned or sent chunk has a seq of at least
 * this; it is planned there in merge order. A finished chunk (written or failed, including the empty
 * chunks planning records) moves below it, to the next free seq from 0, so finished chunks are
 * numbered 0, 1, 2 in the order they finished. The write step then finds the next chunk with one
 * read on `ingest_merge_chunk_run_seq_unique` (`seq >= SEQ_PLANNED_FROM`), and never walks the
 * chunks finished before it. A run never holds a billion chunks.
 */
export const SEQ_PLANNED_FROM = 1_000_000_000;

/** The next free finished seq of a run (see SEQ_PLANNED_FROM), as SQL for an insert or update. */
export function finishedSeq(runId: string): SQL {
  return sql`(select coalesce(max(f.seq), -1) + 1 from ingest_merge_chunk f where f.run_id = ${runId} and f.seq < ${SEQ_PLANNED_FROM})`;
}

/**
 * The tenant filter `company_id = ?` written so SQLite never takes it as the index (a unary plus).
 * Use it next to a primary key `IN` list. With no ANALYZE statistics SQLite guesses 10 rows for one
 * company and would walk the company's whole index instead of the listed ids: for 50 ids of a
 * 5,000-row sheet it read all 5,000 rows (B-new-2).
 */
export function companyNotIndexed(column: SQLiteColumn, companyId: string): SQL {
  return sql`+${column} = ${companyId}`;
}

/** A text value of a staged row, or null when blank. */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  return s === "" ? null : s;
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function valuesOf(row: StagedRow): Values {
  return (row.values ?? {}) as Values;
}

/** Thrown when a row points at a record of a candidate that was not written (plan A5 step 6). */
export class DependencyHeld extends Error {
  constructor(readonly heldName: string) {
    super(heldName);
  }
}

/** Thrown inside a one-call chunk when a customer its rows point at is gone (design fix M1). `failureOf` hands the failure back as it is. */
export class CustomerMissing extends Error {
  constructor(readonly failure: ChunkFailure) {
    super(failure.message);
  }
}

/** The live id a row refers to for `field` (`_ids`), with `pending:` references resolved. */
export function refOf(row: StagedRow, field: string, refs: Map<string, string>): string | null {
  const ids = (valuesOf(row)._ids ?? {}) as Record<string, unknown>;
  const raw = ids[field];
  if (typeof raw !== "string" || raw === "") return null;
  if (!raw.startsWith("pending:")) return raw;
  const hit = refs.get(raw.slice("pending:".length));
  if (!hit) throw new DependencyHeld(raw.slice("pending:".length));
  return hit;
}

/** Every `pending:` row key a set of rows refers to. */
export function pendingKeys(rows: readonly StagedRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const ids = (valuesOf(r)._ids ?? {}) as Record<string, unknown>;
    for (const v of Object.values(ids)) if (typeof v === "string" && v.startsWith("pending:")) out.add(v.slice("pending:".length));
  }
  return [...out];
}

/** What a person reads for an error orrn did not mean to show (Bm3). The raw error goes to the log. */
export const INTERNAL_MESSAGE = "The import could not be written. Try again; if it fails again, tell support.";

/**
 * A failure the person can read: the procedure's own message, field by field for an input refusal.
 * An internal error (a driver or SQL error, which can carry the statement and its values) is never
 * stored: the hold reason and audit row get INTERNAL_MESSAGE, and the raw error is logged (Bm3).
 */
export function failureOf(e: unknown): ChunkFailure {
  if (e instanceof CustomerMissing) return e.failure;
  if (e instanceof DependencyHeld) return { code: "DEPENDENCY_HELD", message: e.heldName.slice(0, MESSAGE_MAX), reason: "dependency_held" };
  let code = "INTERNAL_SERVER_ERROR";
  let message = e instanceof Error ? e.message : String(e);
  if (e instanceof TRPCError) code = e.code;
  const zod = e instanceof ZodError ? e : e instanceof TRPCError && e.cause instanceof ZodError ? e.cause : null;
  if (!zod && code === "INTERNAL_SERVER_ERROR") {
    console.error("ingest merge: internal error in a chunk", e);
    return { code, message: INTERNAL_MESSAGE, reason: "merge_failed" };
  }
  if (zod) {
    code = "BAD_REQUEST";
    message = zod.issues
      .slice(0, 5)
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
  }
  return { code, message: message.slice(0, MESSAGE_MAX), reason: "merge_failed" };
}

/** The rows a bulk call sent, by the input array a refusal's path names. */
export type SentRows = Partial<Record<"rows" | "newRows" | "updatedRows", readonly StagedRow[]>>;

/**
 * Point a refusal at the file, not at the call (Bm2): `rows.37.email: ...` becomes
 * `File row 512, email: ...` from the staged row sent at that place.
 */
export function fileRowsIn(message: string, sent: SentRows): string {
  return message.replace(/\b(rows|newRows|updatedRows)\.(\d+)(?:\.([A-Za-z0-9_.]+))?:/g, (m, key: keyof SentRows, n: string, field?: string) => {
    const row = sent[key]?.[Number(n)];
    if (!row) return m;
    return `File row ${row.rowIndex + 1}${field ? `, ${field}` : ""}:`;
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The replay key of one call that writes the given staged rows: `ing-` plus 40 hex of sha256 of
 * the sorted row ids. It depends on the rows only, never on the chunk or the row's place in it, so
 * a resend from any later chunk or run carries the same key (B8).
 */
export async function rowsRequestId(rowIds: readonly string[]): Promise<string> {
  return `ing-${(await sha256Hex(["rows", ...[...rowIds].sort()].join("|"))).slice(0, 40)}`;
}

/**
 * The order a staged row belongs to: the key the dry run stored (`order_key`), or the row's own
 * order. The rule itself is `orderIdentityOf` in orderid.ts.
 */
export const rowOrderKey = (row: Pick<StagedRow, "id" | "orderKey">): string => row.orderKey ?? ownOrderKey(row.id);

/** The order key the dry run would store for these values (orderid.ts), for code that has no stored key. */
export function orderKeyOf(values: Values, rowKey = ""): string {
  return orderIdentityOf(values, rowKey)?.key ?? ownOrderKey(rowKey);
}
