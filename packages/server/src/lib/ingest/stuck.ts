/**
 * A way out of a stuck part (X-new-5). A merge chunk that ended the request on every send is marked
 * failed with CHUNK_STUCK, its candidate held, and its rows kept `queued`, because some of them may
 * have landed. Approving again resends the same part. When it fails on every send, the person needs
 * to reach those rows: "Check again" (candidate.release) opens the part first.
 *
 * Opening a part:
 * - Rows whose record landed are found by their replay key, the same key the merge sent: the chunk id
 *   for one call over the whole chunk (bundles, customer aliases), the row's own key for one-row calls
 *   (die copies, vendors, vendor aliases), the order's key for orders. Those rows are marked written
 *   with the record's id, as the merge would have recorded them.
 * - Every other row of the part opens again, so the person can skip or fix it and the dry run checks
 *   it again. A row whose record landed by another path is found there by its natural key (a customer
 *   or a die by name or section, a bundle by its old id), and a one-row call sent again replays.
 * - The chunk keeps state `failed` with STUCK_OPENED, so no later run resends it.
 */
import { and, eq, inArray } from "drizzle-orm";

import { bundle, customerAlias, dieInstance, salesOrder, vendor, vendorAlias } from "@orrn/db/schema";
import { ingestMergeChunk, ingestStagedRow, type IngestTarget } from "@orrn/db/schema/ingest";

import { mapInChunks, type SqliteBatchItem } from "../atomic";
import { now } from "../clock";
import { requestRowIds, type ImportReplayKind } from "../importReplay";
import type { IngestCtx } from "./types";
import { orderKeyOf, rowsRequestId, type StagedRow } from "./merge/shared";
import { STUCK_CODE } from "./merge/runner";

/** The error code of a stuck chunk whose rows a person opened again. */
export const STUCK_OPENED_CODE = "CHUNK_STUCK_OPENED";

type Landed = Map<string, { type: string; id: string }>;

/** Which of these ids exist in a table, by its `id` column. */
async function existing(ctx: IngestCtx, table: typeof bundle | typeof customerAlias | typeof dieInstance | typeof vendor | typeof vendorAlias, ids: readonly string[]): Promise<Set<string>> {
  const found = await mapInChunks([...ids], (part) =>
    ctx.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.companyId, ctx.companyId), inArray(table.id, part))),
  );
  return new Set(found.map((f) => f.id));
}

/** Rows of one call over the whole chunk: row i made the record `requestRowIds(chunk id)[i]`. */
async function byChunkKey(ctx: IngestCtx, rows: readonly StagedRow[], chunkId: string, kind: ImportReplayKind, table: Parameters<typeof existing>[1], type: string, out: Landed) {
  const ids = await requestRowIds(ctx.companyId, kind, chunkId, rows.length);
  const have = await existing(ctx, table, ids);
  rows.forEach((r, i) => {
    if (have.has(ids[i]!)) out.set(r.id, { type, id: ids[i]! });
  });
}

/** Rows of one-row calls: each row made the record `requestRowIds(row key)[0]`. */
async function byRowKey(ctx: IngestCtx, rows: readonly StagedRow[], kind: ImportReplayKind, table: Parameters<typeof existing>[1], type: string, out: Landed) {
  const ids = await Promise.all(rows.map(async (r) => (await requestRowIds(ctx.companyId, kind, await rowsRequestId([r.id]), 1))[0]!));
  const have = await existing(ctx, table, ids);
  rows.forEach((r, i) => {
    if (have.has(ids[i]!)) out.set(r.id, { type, id: ids[i]! });
  });
}

/** The rows of a stuck part whose record landed, by replay key. */
export async function landedRows(ctx: IngestCtx, target: IngestTarget, chunkId: string, rows: readonly StagedRow[]): Promise<Landed> {
  const out: Landed = new Map();
  const creates = rows.filter((r) => r.state === "ready_create");
  switch (target) {
    case "bundles":
      await byChunkKey(ctx, rows, chunkId, "bundle.import", bundle, "bundle", out);
      break;
    case "customer_aliases":
      await byChunkKey(ctx, rows, chunkId, "customer.alias", customerAlias, "customer_alias", out);
      break;
    case "die_copies":
      await byRowKey(ctx, creates, "die_instance.create", dieInstance, "die_instance", out);
      break;
    case "vendors":
      await byRowKey(ctx, creates, "vendor.create", vendor, "vendor", out);
      break;
    case "vendor_aliases":
      await byRowKey(ctx, rows, "vendor.alias", vendorAlias, "vendor_alias", out);
      break;
    case "orders": {
      const groups = new Map<string, StagedRow[]>();
      for (const r of rows) {
        const k = orderKeyOf((r.values ?? {}) as Record<string, unknown>);
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const keyed = await Promise.all([...groups.values()].map(async (list) => ({ list, key: await rowsRequestId(list.map((r) => r.id)) })));
      const made = await mapInChunks(
        keyed.map((k) => k.key),
        (part) =>
          ctx.db
            .select({ id: salesOrder.id, key: salesOrder.clientRequestId })
            .from(salesOrder)
            .where(and(eq(salesOrder.companyId, ctx.companyId), inArray(salesOrder.clientRequestId, part))),
      );
      const byKey = new Map(made.map((m) => [m.key, m.id]));
      for (const { list, key } of keyed) {
        const id = byKey.get(key);
        if (id) for (const r of list) out.set(r.id, { type: "sales_order", id });
      }
      break;
    }
    default:
      // Customers and dies are found by name or section at the next dry run; their updates replay.
      break;
  }
  return out;
}

/**
 * The statements that open a held candidate's stuck parts (X-new-5), or none when it has none. Put
 * them in the batch that sends the candidate back to checking. `written` counts the rows that landed;
 * `from` is the first row opened again.
 */
export async function openStuckParts(
  ctx: IngestCtx,
  candidateId: string,
  target: IngestTarget,
): Promise<{ statements: SqliteBatchItem[]; written: number; from: number | null }> {
  const chunks = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(
      and(
        eq(ingestMergeChunk.companyId, ctx.companyId),
        eq(ingestMergeChunk.candidateId, candidateId),
        eq(ingestMergeChunk.state, "failed"),
        eq(ingestMergeChunk.errorCode, STUCK_CODE),
      ),
    );
  if (chunks.length === 0) return { statements: [], written: 0, from: null };
  const statements: SqliteBatchItem[] = [];
  let written = 0;
  let from: number | null = null;
  const at = now();
  for (const chunk of chunks) {
    // The candidate's queued rows are this part's: a hold opens every other queued row (runner).
    const rows = (
      await ctx.db
        .select()
        .from(ingestStagedRow)
        .where(
          and(
            eq(ingestStagedRow.companyId, ctx.companyId),
            eq(ingestStagedRow.candidateId, candidateId),
            eq(ingestStagedRow.mergeState, "queued"),
            inArray(ingestStagedRow.state, ["ready_create", "ready_update"]),
          ),
        )
    )
      .filter((r) => r.rowIndex >= chunk.rowFrom && r.rowIndex <= chunk.rowTo)
      .sort((a, b) => a.rowIndex - b.rowIndex);
    const landed = await landedRows(ctx, target, chunk.id, rows);
    for (const r of rows) {
      const hit = landed.get(r.id);
      statements.push(
        ctx.db
          .update(ingestStagedRow)
          .set(hit ? { mergeState: "written", committedType: hit.type, committedId: hit.id, updatedAt: at } : { mergeState: "open", updatedAt: at })
          .where(and(eq(ingestStagedRow.id, r.id), eq(ingestStagedRow.companyId, ctx.companyId), eq(ingestStagedRow.mergeState, "queued"))),
      );
      if (hit) written += 1;
      else from = from === null ? r.rowIndex : Math.min(from, r.rowIndex);
    }
    statements.push(
      ctx.db
        .update(ingestMergeChunk)
        .set({ errorCode: STUCK_OPENED_CODE })
        .where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "failed"), eq(ingestMergeChunk.errorCode, STUCK_CODE))),
    );
  }
  return { statements, written, from };
}
