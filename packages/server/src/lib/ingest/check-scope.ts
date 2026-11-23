/**
 * Item 16 (owner decision "Price-viewers tick, admin approves"): what `ingest.check` opens.
 *
 * A person who holds `ingest.check` but neither `ingest.upload` nor `ingest.merge` (office, manager, accountant)
 * reads, and only reads, the review of a table the model read from a page: the candidate, its rows, its page image
 * by a signed read, and the list of such tables still waiting for a check. A table read from a sheet, a table typed
 * by hand (read by "parser"), a discarded table and the raw file stay closed to them, with the same not-found words
 * as a table of another plant. Rate cells stay hidden from anyone without `order.price`, as everywhere.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { ingestArtifact, ingestBlock, ingestCandidate, type CandidateState } from "@orrn/db/schema/ingest";

import { ctxCanAny } from "../permissions";
import { loadBlock, loadCandidate, NOT_FOUND_ARTIFACT, NOT_FOUND_CANDIDATE, rateMaskColumns, seesRates } from "./core";
import type { IngestCtx } from "./types";

/** The caller holds `ingest.check` only: no upload, no merge. */
export function checkOnly(ctx: Pick<IngestCtx, "role">): boolean {
  return !ctxCanAny(ctx, ["ingest.upload", "ingest.merge"]);
}

/** A check-only caller opens a candidate only when its table was read by the model and is not discarded. */
export async function assertCheckable(ctx: IngestCtx, candidateId: string): Promise<void> {
  if (!checkOnly(ctx)) return;
  const c = await loadCandidate(ctx, candidateId);
  const block = await loadBlock(ctx, c.blockId);
  if (block.readBy !== "model" || c.state === "discarded") throw new TRPCError(NOT_FOUND_CANDIDATE);
}

/**
 * A check-only caller gets a signed read of a page (or a band of it) only when a model-read table of that file came
 * from that page. Never the raw file: it holds every page, so every table.
 */
export async function assertCheckableRead(ctx: IngestCtx, input: { artifactId: string; what: "raw" } | { artifactId: string; what: "page"; page: number }): Promise<void> {
  if (!checkOnly(ctx)) return;
  if (input.what !== "page") throw new TRPCError(NOT_FOUND_ARTIFACT);
  const blocks = await ctx.db
    .select({ readerFacts: ingestBlock.readerFacts, state: ingestCandidate.state })
    .from(ingestBlock)
    .innerJoin(ingestCandidate, and(eq(ingestCandidate.blockId, ingestBlock.id), eq(ingestCandidate.companyId, ctx.companyId)))
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, input.artifactId), eq(ingestBlock.readBy, "model")));
  if (!blocks.some((b) => b.state !== "discarded" && b.readerFacts?.vision?.page === input.page)) throw new TRPCError(NOT_FOUND_ARTIFACT);
}

/** The states in which the review offers the tick (the web's check panel); a written row closes it. */
export const WAITING_STATES: readonly CandidateState[] = ["ready", "held", "needs_confirm", "needs_shape"];
/** Most tables the list shows; the rest wait behind them. */
export const WAITING_LIMIT = 200;

export type VisionWaitingItem = {
  candidateId: string;
  artifactId: string;
  fileName: string;
  title: string | null;
  page: number;
  pageCount: number;
  rows: number;
  /** The table has a price column and this viewer cannot see prices: someone who can must tick it. */
  needsPrices: boolean;
};

/** "Tables waiting for a check": model-read tables of the plant not ticked, oldest file first, then page order. */
export async function visionWaiting(ctx: IngestCtx): Promise<VisionWaitingItem[]> {
  const rows = await ctx.db
    .select({
      candidateId: ingestCandidate.id,
      artifactId: ingestCandidate.artifactId,
      blockId: ingestBlock.id,
      fileName: ingestArtifact.fileName,
      title: ingestBlock.title,
      headers: ingestBlock.headers,
      readerFacts: ingestBlock.readerFacts,
      rows: ingestCandidate.rowsTotal,
    })
    .from(ingestCandidate)
    .innerJoin(ingestBlock, and(eq(ingestBlock.id, ingestCandidate.blockId), eq(ingestBlock.companyId, ctx.companyId)))
    .innerJoin(ingestArtifact, and(eq(ingestArtifact.id, ingestCandidate.artifactId), eq(ingestArtifact.companyId, ctx.companyId)))
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        inArray(ingestCandidate.state, [...WAITING_STATES]),
        eq(ingestCandidate.rowsWritten, 0),
        eq(ingestBlock.readBy, "model"),
        eq(ingestBlock.modelChecked, false),
      ),
    )
    .orderBy(asc(ingestArtifact.createdAt), asc(ingestBlock.ordinal), asc(ingestCandidate.id))
    .limit(WAITING_LIMIT);
  const prices = seesRates(ctx);
  const recipes = new Map<string, unknown[]>();
  if (!prices && rows.length > 0) {
    const siblings = await ctx.db
      .select({ blockId: ingestCandidate.blockId, recipe: ingestCandidate.recipe })
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.blockId, [...new Set(rows.map((r) => r.blockId))])));
    for (const s of siblings) recipes.set(s.blockId, [...(recipes.get(s.blockId) ?? []), s.recipe]);
  }
  return rows.map((r) => ({
    candidateId: r.candidateId,
    artifactId: r.artifactId,
    fileName: r.fileName,
    title: r.title,
    page: r.readerFacts?.vision?.page ?? 1,
    pageCount: r.readerFacts?.vision?.pageCount ?? 1,
    rows: r.rows,
    needsPrices: !prices && rateMaskColumns(r.headers, recipes.get(r.blockId) ?? []).size > 0,
  }));
}
