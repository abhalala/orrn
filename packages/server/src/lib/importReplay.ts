import { z } from "zod";

/**
 * Imports that can be sent again safely (T25 fix round 1).
 *
 * A client that may resend a chunk (the reply was lost on plant Wi-Fi, a Worker
 * timed out after committing, or the person picked the same sheet again) sends a
 * `clientRequestId` with it. Every row the chunk creates then gets an id derived
 * from (company, import kind, request id, row index), so:
 * - before writing, the procedure looks for the chunk's first and last row; both
 *   there means the chunk already landed and the call answers `replayed` without
 *   writing anything;
 * - two identical requests racing each other end on the primary key: the batch
 *   of the second one fails as a whole (D1 batches are atomic) and it answers
 *   `replayed` too.
 *
 * No table and no migration: the created rows' own primary keys are the record,
 * and bundles are never deleted (customers and dies are soft-deleted), so a
 * replay is recognised for as long as the rows exist. The contract is "same id,
 * same rows": the web sheet derives the id from the chunk's content.
 */
export const clientRequestIdSchema = z
  .string()
  .min(16, "clientRequestId is too short")
  .max(64, "clientRequestId is too long")
  .regex(/^[A-Za-z0-9_-]+$/, "clientRequestId may use letters, digits, - and _ only");

export type ImportReplayKind =
  | "bundle.import"
  | "customer.import"
  | "die.import"
  // BACKLOG 50: floor writes, recorded by `lib/requestReplay.ts`.
  | "bundle.receipt"
  | "dispatch.add"
  | "stock.move"
  // BACKLOG 47.
  | "dispatch.create"
  | "die_reading.add"
  // W3-AG-S: the oven phone (lib/requestReplay.ts ReplayKind).
  | "ageing.load"
  | "ageing.start"
  | "ageing.out"
  | "ageing.hardness"
  | "ageing.release";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Row ids for one request: UUID-shaped (version 8, RFC 4122 variant). The first
 * 12 bytes come from SHA-256(company, kind, request id); the last 4 are the row
 * index, so ids within a request never collide.
 */
export async function requestRowIds(
  companyId: string,
  kind: ImportReplayKind,
  clientRequestId: string,
  count: number,
): Promise<string[]> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${companyId}\u0000${kind}\u0000${clientRequestId}`)),
  );
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = digest.slice(0, 16);
    b[6] = (b[6]! & 0x0f) | 0x80;
    b[8] = (b[8]! & 0x3f) | 0x80;
    b[12] = (i >>> 24) & 0xff;
    b[13] = (i >>> 16) & 0xff;
    b[14] = (i >>> 8) & 0xff;
    b[15] = i & 0xff;
    const h = hex(b);
    ids.push(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`);
  }
  return ids;
}

/** The two ids that tell whether a request already landed. */
export function replayProbe(ids: readonly string[]): string[] {
  return [...new Set([ids[0]!, ids[ids.length - 1]!])];
}

/**
 * `found` = which probe ids already exist. Both: the chunk landed before. None:
 * a new chunk. Only one: the id was used for a chunk of a different size.
 */
export function replayState(ids: readonly string[], found: Iterable<string>): "new" | "replayed" | "conflict" {
  const have = new Set(found);
  const first = have.has(ids[0]!);
  const last = have.has(ids[ids.length - 1]!);
  if (first && last) return "replayed";
  if (!first && !last) return "new";
  return "conflict";
}

export const REQUEST_ID_CONFLICT = {
  code: "CONFLICT",
  message: "This import request id was already used for different rows.",
} as const;
