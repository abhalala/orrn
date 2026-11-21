/**
 * Shared set-up for the buddy-import* tests (fix round decision 8, delta round S2, S3, S6): a plant with a learned
 * bundles layout in grams, a 4,000-row-capable upload done the browser's way, and the bubble's dry run drive.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";

import { expect } from "bun:test";

import { fingerprint, type Recipe } from "@orrn/ingest";

import { listPlant, tool } from "./buddy-fixture";
import type { TestEnv } from "./harness";
import { plant as ingestPlant, putBlocksPicked, putRowsAs, sha, type Caller, type Plant } from "./ingest-portal-helpers";

export const HEADERS = ["Bundle id", "Series", "Section", "Pcs", "Wt (g)", "Len (mm)"];

/** A learned bundles layout in grams (a weight of 20 g is below the plausible range and asks magnitude_check). */
export function gramLayout(): Recipe {
  const fp = fingerprint({ headers: HEADERS, rows: [] });
  const col = (i: number) => ({ kind: "columns" as const, cols: [{ col: i, header: HEADERS[i]! }] });
  const steps: Recipe["fields"][number]["steps"][] = [
    [{ op: "trim" }],
    [{ op: "trim" }, { op: "case", to: "upper" }],
    [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }],
    [{ op: "number", kind: "count", unit: "pcs" }],
    [{ op: "number", kind: "mass", unit: "g" }],
    [{ op: "number", kind: "length", unit: "mm" }],
  ];
  const fields = ["legacyId", "series", "sectionCode", "quantity", "weightG", "lengthMm"];
  return {
    schemaVersion: 1,
    target: "bundles",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((field, i) => ({ field, source: col(i), steps: steps[i]! })),
    filters: [],
    keys: ["legacyId"],
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

export async function learnRecipe(env: TestEnv, p: Plant, recipe: Recipe, name: string): Promise<void> {
  const { ingestHole, ingestHoleVersion } = await import("@orrn/db/schema/ingest");
  const holeId = `hole_${randomUUID()}`;
  await env.db.insert(ingestHole).values({ id: holeId, companyId: p.companyId, target: recipe.target, name, currentVersion: 1, state: "active", createdBy: p.users.owner.id });
  await env.db.insert(ingestHoleVersion).values({
    id: `hv_${randomUUID()}`,
    companyId: p.companyId,
    holeId,
    version: 1,
    headerKey: recipe.match.headerKey,
    recipe: recipe as never,
    madeBy: "person",
    state: "approved",
    createdBy: p.users.owner.id,
  });
}

/** `n` bundle rows; every 500th weighs 20 (grams), which asks one magnitude_check question. */
export function bundleRows(n: number, odd = true): string[][] {
  return Array.from({ length: n }, (_, i) => [`SB-${i + 1}`, "R", "5100", "10", odd && i % 500 === 0 ? "20" : "25000", "3658"]);
}

/** The browser's upload: begin, the tables, rows 500 at a time, complete. Never through the buddy (§12.2). */
export async function uploadSheet(
  as: Caller,
  headers: string[],
  rows: string[][],
  fileName = "synthetic-bundles.xlsx",
  sheetName = "Stock",
): Promise<{ artifactId: string; candidateId: string }> {
  const begin = await as.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await putBlocksPicked(as, {
    artifactId: begin.artifactId,
    blocks: [{ ordinal: 0, sheetName, title: null, headerRow: 0, headerRows: 1, headers, rowCount: rows.length, sample: rows.slice(0, 200) }],
  });
  const blockId = put.blocks[0]!.blockId;
  for (let from = 0; from < rows.length; from += 500) {
    await putRowsAs(as, { blockId, fromIndex: from, expectRowsPut: from, rows: rows.slice(from, from + 500) });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return { artifactId: begin.artifactId, candidateId: put.candidates[0]!.id };
}

/** A plant listed for the buddy, with a grant, the bundles layout and one uploaded sheet of `rows` bundle rows. */
export async function importPlant(env: TestEnv, rows: number, odd = true) {
  const p = await ingestPlant(env);
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learnRecipe(env, p, gramLayout(), "Bundles in g");
  await listPlant(env, p.companyId);
  const { token, grantId } = await p.owner.buddy.grant.create();
  const sheet = await uploadSheet(p.owner, HEADERS, bundleRows(rows, odd));
  return { p, token, grantId, ...sheet };
}

/** The browser's own dry run, outside the buddy: pump `ingest.dryRun.step` until done. Returns the steps taken. */
export async function pump(as: Caller, candidateId: string, max = 200): Promise<number> {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  let steps = 0;
  for (;;) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    steps += 1;
    if (out.done) return steps;
    cursor = out.cursor;
    if (steps > max) throw new Error("dry run did not finish");
  }
}

/** What the bubble does for a confirmed dry run draft: pump `ingest.dryRun.step` until done, then report. */
export async function drive(p: Plant, draftId: string): Promise<number> {
  const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === draftId)!;
  expect(card.drive).toEqual({ kind: "dryRun", candidateId: expect.any(String) });
  const steps = await pump(p.owner, card.drive!.candidateId);
  const reported = await p.owner.buddy.drafts.report({ draftId, outcome: "done", summary: "Synthetic run finished" });
  expect(reported.drive).toBeNull();
  return steps;
}

export async function draft(env: TestEnv, token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const r = await tool(env, token, name, args);
  if (r.status !== "needs_confirm") throw new Error(`expected a draft, got ${JSON.stringify(r)}`);
  return r.data.draftId as string;
}

export const MAGNITUDE = { questionCode: "magnitude_check", subject: "weightG|g|below" };
