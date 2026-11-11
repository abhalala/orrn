import { DIE_SHEET_HEADERS, EXAMPLE_DIE_RECIPE } from "@orrn/ingest";

import { defaultCatalogue, fakeResponse, type BotBlock, type CatalogueTarget, type Recipe, type RunShapeArgs, type SampleStats } from "../src/lib/ingest/bot";
import { MemoryBotRunStore } from "../src/lib/ingest/bot/caps";

export const HEADERS = DIE_SHEET_HEADERS;

export const BLOCK: BotBlock = {
  id: "blk1",
  sheetName: "Dies",
  title: "DIE LIST",
  headerKey: EXAMPLE_DIE_RECIPE.match.headerKey,
  headerRow: 0,
  headerRows: 1,
  headers: HEADERS,
  kinds: ["code", "code", "decimal", "decimal", "text", "decimal", "decimal", "decimal", "text", "text"],
  columnCount: HEADERS.length,
};

export const ROWS: string[][] = Array.from({ length: 12 }, (_, i) => [
  "FC",
  `S${100 + i}`,
  String(3 + i / 10),
  String(3.2 + i / 10),
  `Angle ${i}`,
  "25",
  "2",
  "25",
  "active",
  "",
]);

/** The engine's own target catalogue: every target and field the model may map to. */
export const CATALOGUE: CatalogueTarget[] = defaultCatalogue();

/** Example 1 of plan B2, which `recipeSchema` accepts. */
export function validRecipe(): Recipe {
  return structuredClone(EXAMPLE_DIE_RECIPE);
}

export const recipeAnswer = (r: Recipe = validRecipe()) => ({ result: { kind: "recipe", recipe: r } });
export const noTargetAnswer = (reason = "not_a_table") => ({ result: { kind: "no_target", reason } });
/** Valid JSON that fails botOutput: the discriminator is wrong. */
export const badAnswer = () => ({ result: { kind: "recipe" } });

export const GOOD_STATS: SampleStats = { rows: 40, refused: 0, ambiguous: 2, conflict: 0, requiredBlank: 0 };
export const BAD_STATS: SampleStats = { rows: 40, refused: 20, ambiguous: 0, conflict: 0, requiredBlank: 0 };

export const haiku = (json: unknown, over = {}) => fakeResponse(json, { modelUsed: "claude-haiku-5-5", ...over });
export const sonnet = (json: unknown, over = {}) =>
  fakeResponse(json, { modelUsed: "claude-sonnet-5-5", usage: { input: 14_000, output: 5_000, cacheRead: 0, cacheWrite: 0 }, ...over });

export function baseArgs(over: Partial<RunShapeArgs> = {}): RunShapeArgs & { store: MemoryBotRunStore } {
  const store = new MemoryBotRunStore();
  return {
    env: { ANTHROPIC_API_KEY: "sk-test" },
    store,
    companyId: "co1",
    userId: "u1",
    candidateId: "cand1",
    block: BLOCK,
    rows: ROWS,
    noFitBlocks: 1,
    catalogue: CATALOGUE,
    note: null,
    validate: () => [],
    sampleCheck: async () => GOOD_STATS,
    nowMs: () => Date.UTC(2026, 10, 10, 12, 0, 0),
    ...over,
  } as RunShapeArgs & { store: MemoryBotRunStore };
}
