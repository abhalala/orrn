/**
 * Period storage (plan B8). The guess itself is `detectPeriod` from `@orrn/ingest` (lane C); this file
 * feeds it what the server has and the result is stored on the artifact. A period the system cannot
 * tell is asked, never guessed.
 *
 * When the file is read the server has the file name, sheet names and title rows. After a sheet's
 * first dry run pass it also has parsed values (A24): the range of order dates read from a date
 * column, and bundle numbers and legacy codes. The guess is then made again with them.
 */
import { detectPeriod, periodRequired, recipeSchema, type PeriodInput } from "@orrn/ingest";
import { ingestArtifact, ingestBlock, ingestCandidate, ingestStagedRow, type IngestPeriodGuess } from "@orrn/db/schema/ingest";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { now } from "../clock";
import type { ArtifactRow, BlockRow } from "./core";
import type { IngestCtx } from "./types";

/** Bundle numbers and codes read for the guess, at most. */
const CODES_FOR_GUESS = 500;

export function guessArtifactPeriod(
  artifact: Pick<ArtifactRow, "fileName">,
  blocks: readonly Pick<BlockRow, "sheetName" | "title">[],
  parsed: Pick<PeriodInput, "dateRange" | "bundleNos" | "codes"> = {},
): IngestPeriodGuess {
  return detectPeriod({
    fileName: artifact.fileName,
    sheetNames: blocks.map((b) => b.sheetName).filter((s): s is string => !!s),
    titles: blocks.map((b) => b.title),
    currentYear: now().getUTCFullYear(),
    ...parsed,
  });
}

/**
 * The guess again with the file's parsed values (A24). Order dates count only from sheets that read
 * them from a column: on a sheet with no date column the order date is the confirmed as-of date
 * itself. Bundle ids feed both bundle numbers (`26I4086`) and legacy codes; detectPeriod ignores what
 * does not parse. Refused and skipped rows are left out.
 */
export async function refreshArtifactPeriod(ctx: Pick<IngestCtx, "db" | "companyId">, artifact: Pick<ArtifactRow, "id" | "fileName">): Promise<void> {
  const candidates = await ctx.db
    .select({ id: ingestCandidate.id, target: ingestCandidate.target, recipe: ingestCandidate.recipe })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, artifact.id), inArray(ingestCandidate.target, ["orders", "bundles"])));
  const dated = candidates
    .filter((c) => {
      if (c.target !== "orders") return false;
      const r = recipeSchema.safeParse(c.recipe);
      return r.success && !periodRequired(r.data);
    })
    .map((c) => c.id);
  const bundles = candidates.filter((c) => c.target === "bundles").map((c) => c.id);
  const kept = notInArray(ingestStagedRow.state, ["refused", "skipped", "pending"]);

  let dateRange: PeriodInput["dateRange"] = null;
  if (dated.length > 0) {
    const orderDate = sql<string | null>`json_extract(${ingestStagedRow.values}, '$.orderDate')`;
    const [range] = await ctx.db
      .select({ min: sql<string | null>`min(${orderDate})`, max: sql<string | null>`max(${orderDate})` })
      .from(ingestStagedRow)
      .where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.candidateId, dated), kept, sql`${orderDate} is not null`));
    if (range?.min && range.max) dateRange = { min: range.min, max: range.max };
  }
  let codes: string[] = [];
  if (bundles.length > 0) {
    const legacyId = sql<string | null>`json_extract(${ingestStagedRow.values}, '$.legacyId')`;
    const rows = await ctx.db
      .selectDistinct({ code: legacyId })
      .from(ingestStagedRow)
      .where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.candidateId, bundles), kept, sql`${legacyId} is not null`))
      .limit(CODES_FOR_GUESS);
    codes = rows.map((r) => String(r.code ?? "").trim()).filter(Boolean);
  }
  if (!dateRange && codes.length === 0) return;

  const blocks = await ctx.db
    .select({ sheetName: ingestBlock.sheetName, title: ingestBlock.title })
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, artifact.id)));
  const period = guessArtifactPeriod(artifact, blocks, { dateRange, bundleNos: codes, codes });
  await ctx.db
    .update(ingestArtifact)
    .set({ period, updatedAt: now() })
    .where(and(eq(ingestArtifact.id, artifact.id), eq(ingestArtifact.companyId, ctx.companyId)));
}
