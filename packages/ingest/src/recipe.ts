/**
 * The recipe: a declarative, closed, non-recursive description of how one block becomes typed rows for one target
 * (plan B2). Strict, so the same schema is the bot's structured output. Bounds that the SDK strips from a JSON schema
 * live in `validateRecipe` (validate.ts).
 */
import { z } from "zod";

import { INGEST_TARGETS, type IngestTarget } from "./states";

export const UNIT_KINDS = ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** Separators - / . and space are accepted for every format that has separators. */
export const DATE_FORMATS = ["dmy", "mdy", "ymd", "d_mon_y", "excel_serial"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const RESOLVERS = [
  "customer_by_name",
  "vendor_by_name",
  "section_by_code",
  "die_copy_by_code",
  "bundle_by_legacy_id",
] as const;
export type ResolverId = (typeof RESOLVERS)[number];

export const UNCLEAR_CODES = [
  "unit_unknown",
  "date_format_ambiguous",
  "column_meaning_unclear",
  "mixed_units",
  "total_rows_present",
  "merged_header",
  "two_tables_in_sheet",
  "period_missing",
] as const;
export type UnclearCode = (typeof UNCLEAR_CODES)[number];

export const CELL_KINDS = ["date", "int", "decimal", "code", "text", "mixed", "empty"] as const;
export type CellKind = (typeof CELL_KINDS)[number];

/** Recipe bounds checked by `validateRecipe`. */
export const RECIPE_LIMITS = {
  colsPerSource: 3,
  steps: 6,
  pickPairs: 50,
  filters: 5,
  filterValues: 20,
  keys: 3,
  unclear: 20,
} as const;

const colRef = z.object({ col: z.number().int(), header: z.string() }).strict(); // header must equal block.headers[col]
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("columns"), cols: z.array(colRef) }).strict(), // 1..3, first non-blank wins
  z.object({ kind: z.literal("constant"), value: z.string() }).strict(),
  z.object({ kind: z.literal("period_as_of") }).strict(), // the confirmed as-of date
]);
const step = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim") }).strict(),
  z.object({ op: z.literal("case"), to: z.enum(["upper", "lower", "title"]) }).strict(),
  z.object({ op: z.literal("split"), sep: z.enum([" ", "-", "/", ",", "x", "*", "|"]), index: z.number().int() }).strict(),
  z
    .object({
      op: z.literal("pick"),
      map: z.array(z.object({ from: z.string(), to: z.string() }).strict()),
      otherwise: z.enum(["keep", "blank", "refuse"]),
    })
    .strict(),
  z.object({ op: z.literal("date"), format: z.enum(DATE_FORMATS) }).strict(),
  z.object({ op: z.literal("number"), kind: z.enum(UNIT_KINDS), unit: z.string().nullable() }).strict(), // null = ask
  z.object({ op: z.literal("lookup"), resolver: z.enum(RESOLVERS) }).strict(),
]);
const filter = z
  .object({
    col: colRef,
    test: z.enum(["equals", "in", "not_blank", "blank"]),
    values: z.array(z.string()),
    action: z.enum(["keep", "drop"]),
  })
  .strict();

export const recipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: z.enum(INGEST_TARGETS),
    headerRow: z.number().int(),
    headerRows: z.number().int(), // 0-based row in the block; 1 or 2
    match: z.object({ headerKey: z.string(), headers: z.array(z.string()) }).strict(),
    fields: z.array(z.object({ field: z.string(), source, steps: z.array(step) }).strict()),
    filters: z.array(filter),
    keys: z.array(z.string()), // target fields that find a live record
    onExisting: z.enum(["ask", "fill_blanks", "skip"]),
    unclear: z.array(z.object({ field: z.string(), code: z.enum(UNCLEAR_CODES) }).strict()),
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeField = Recipe["fields"][number];
export type RecipeSource = RecipeField["source"];
export type RecipeStep = RecipeField["steps"][number];
export type RecipeFilter = Recipe["filters"][number];
export type ColRef = z.infer<typeof colRef>;
export type { IngestTarget };

/** What a block looks like to the fit, the validator and the bot: no rows, only shape. */
export type BlockShape = {
  /** The headers as written in the file (merged top and bottom for a two-row header). */
  headers: string[];
  columnCount: number;
  kinds: CellKind[];
  headerKey: string;
  headerRow?: number;
  headerRows?: number;
};

/** Why a block fits a hole only nearly (plan B3). Stored on the candidate as `fit_diff`. */
export type FitDiff = {
  /** The hole expected `from`; the block has `to` in column `col`. */
  renamed: { col: number; from: string; to: string }[];
  /** Block columns the hole does not use. */
  extra: { col: number; header: string }[];
  /** Optional hole columns the block lacks. */
  missing: { field: string; header: string }[];
  kindMismatch: { col: number; header: string; expected: CellKind; found: CellKind }[];
  /** Required numeric fields whose header names no unit (built-in holes only). */
  unitless: string[];
};

export type PeriodConfidence = "high" | "medium" | "low" | "unknown";

/** Plan B8. `fy` is "2025-26", `asOf` is "YYYY-MM-DD". */
export type PeriodGuess = {
  fy: string | null;
  asOf: string | null;
  confidence: PeriodConfidence;
  sources: { kind: string; value: string }[];
};

/** A block as the server stores it from `artifact.putBlocks` (plan B1, B5). */
export const blockInputSchema = z
  .object({
    ordinal: z.number().int().min(0),
    sheetName: z.string().nullable(),
    title: z.string().nullable(),
    headerRow: z.number().int().min(0),
    headerRows: z.number().int().min(1).max(2),
    headers: z.array(z.string()),
    kinds: z.array(z.enum(CELL_KINDS)),
    headerKey: z.string(),
    columnCount: z.number().int().min(0),
    rowCount: z.number().int().min(0).nullable(),
    sample: z.array(z.array(z.string())),
  })
  .strict();
export type BlockInput = z.infer<typeof blockInputSchema>;
