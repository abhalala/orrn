import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { auditLog } from "@orrn/db/schema";

import type { OrrnDb } from "./atomic";
import { requestRowIds } from "./importReplay";
import { errorText } from "./pack";

/**
 * Replay-safe floor writes (BACKLOG 50, architecture SAD §5): `bundle.createReceipt`,
 * `dispatch.scan` / `addBundlesBySerial` and `stock.move` take (BACKLOG 47 adds `dispatch.create` and
 * `dieInstance.addReading`) an optional `clientRequestId`.
 *
 * The write's own audit row is the record: its id is derived from (company, kind, request id)
 * (`requestRowIds`, as the imports do), and its meta carries the request's fingerprint and what the
 * first call answered. So:
 * - before writing, the procedure reads that one row by primary key; there = the request already
 *   landed and the call answers the first result with `replayed: true`, writing nothing (no second
 *   serial, bundle, ledger row or label);
 * - the same id with a different request (other die, bundles, serials or yard) is a CONFLICT;
 * - two identical requests racing each other end on the audit row's primary key: the second batch
 *   fails as a whole (D1 batches are atomic) and answers the replay too.
 *
 * No table and no migration. Audit rows are never pruned, so a replay is recognised for as long as
 * the company exists. A write that changed nothing (every serial already on the load, every bundle
 * already in the yard) writes no row; its repeat recomputes the same answer.
 */
export type ReplayKind =
  | "bundle.receipt"
  | "dispatch.add"
  | "stock.move"
  | "dispatch.create"
  | "die_reading.add"
  // W3-AG-S: the oven phone's floor writes (`clientMutationId`).
  | "ageing.load"
  | "ageing.start"
  | "ageing.out"
  | "ageing.hardness"
  | "ageing.release";

export type Replay = {
  /** The audit row id this request writes (and a repeat finds). */
  id: string;
  fingerprint: string;
  /** The first call's audit meta when this request already landed. */
  prior: Record<string, unknown> | null;
  /** The first call's audit subject (the receipt group, dispatch or move voucher). */
  priorSubjectId: string | null;
};

export const REPLAY_CONFLICT = {
  code: "CONFLICT",
  message: "This request id was already used for a different request.",
} as const;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the request's content (the parsed input without its `clientRequestId`). */
export async function requestFingerprint(content: unknown): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(content))));
}

/** The replay record of one request: its id, fingerprint and, when it landed before, what it answered. */
export async function openReplay(
  db: OrrnDb,
  companyId: string,
  kind: ReplayKind,
  clientRequestId: string,
  content: unknown,
): Promise<Replay> {
  const [id] = await requestRowIds(companyId, kind, clientRequestId, 1);
  const fingerprint = await requestFingerprint(content);
  const replay: Replay = { id: id!, fingerprint, prior: null, priorSubjectId: null };
  return readReplay(db, companyId, replay);
}

/** Re-reads the record (after a race lost on its primary key). CONFLICT when the content differs. */
export async function readReplay(db: OrrnDb, companyId: string, replay: Replay): Promise<Replay> {
  const [row] = await db
    .select({ meta: auditLog.meta, subjectId: auditLog.subjectId })
    .from(auditLog)
    .where(and(eq(auditLog.id, replay.id), eq(auditLog.companyId, companyId)))
    .limit(1);
  if (!row) return { ...replay, prior: null, priorSubjectId: null };
  if (row.meta?.requestFingerprint !== replay.fingerprint) throw new TRPCError(REPLAY_CONFLICT);
  return { ...replay, prior: row.meta, priorSubjectId: row.subjectId };
}

/** What a write stores beside its usual audit meta so a repeat can be recognised and answered. */
export function replayMeta(replay: Replay | null, clientRequestId: string | undefined, answer?: Record<string, unknown>) {
  if (!replay || !clientRequestId) return {};
  return { clientRequestId, requestFingerprint: replay.fingerprint, ...(answer ? { replay: answer } : {}) };
}

/** The batch failed on the replay record's primary key: an identical request landed first. */
export function lostReplayRace(e: unknown, replay: Replay | null): boolean {
  return Boolean(replay) && /UNIQUE constraint failed: audit_log\.id|PRIMARY KEY/i.test(errorText(e));
}
