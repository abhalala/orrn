import { fakeResponse, type BotBlock, type CatalogueTarget, type Recipe, type RunShapeArgs, type SampleStats } from "../src/lib/ingest/bot";
import { MemoryBotRunStore } from "../src/lib/ingest/bot/caps";

export const HEADERS = ["Section", "Min weight (g/m)", "Max weight (g/m)", "Name"];

export const BLOCK: BotBlock = {
  id: "blk1",
  sheetName: "Dies",
  title: "DIE LIST",
  headerKey: "hk_dies_4",
  headerRow: 0,
  headerRows: 1,
  headers: HEADERS,
  kinds: ["text", "number", "number", "text"],
  columnCount: 4,
};

export const ROWS: string[][] = Array.from({ length: 12 }, (_, i) => [`S${100 + i}`, String(300 + i), String(320 + i), `Angle ${i}`]);

export const CATALOGUE: CatalogueTarget[] = [
  {
    target: "dies",
    fields: [
      { field: "sectionCode", kind: "text", required: true },
      { field: "weightMinG", kind: "linear_mass", required: true },
      { field: "weightMaxG", kind: "linear_mass", required: true },
      { field: "name", kind: "text", required: false },
    ],
  },
];

export function validRecipe(): Recipe {
  const col = (c: number) => ({ col: c, header: HEADERS[c]! });
  return {
    schemaVersion: 1,
    target: "dies",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: "hk_dies_4", headers: HEADERS },
    fields: [
      { field: "sectionCode", source: { kind: "columns", cols: [col(0)] }, steps: [{ op: "trim" }] },
      { field: "weightMinG", source: { kind: "columns", cols: [col(1)] }, steps: [{ op: "number", kind: "linear_mass", unit: "g/m" }] },
      { field: "weightMaxG", source: { kind: "columns", cols: [col(2)] }, steps: [{ op: "number", kind: "linear_mass", unit: "g/m" }] },
      { field: "name", source: { kind: "columns", cols: [col(3)] }, steps: [] },
    ],
    filters: [],
    keys: ["sectionCode"],
    onExisting: "ask",
    unclear: [],
  };
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
