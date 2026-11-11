/**
 * Local copy of the recipe schema of plan section B2.
 *
 * Lane C owns the real one (`packages/ingest/src/recipe.ts`). This file exists only so the bot
 * client compiles and its tests run before lane C lands. When `@orrn/ingest` exports
 * `recipeSchema`, `Recipe` and `INGEST_TARGETS`, `schema.ts` switches to that import and this
 * file is deleted. Keep it identical to B2 until then.
 */
import * as z from "zod/v4";

export const INGEST_TARGETS = [
  "customers",
  "customer_aliases",
  "vendors",
  "vendor_aliases",
  "dies",
  "die_copies",
  "bundles",
  "orders",
] as const;
export const UNIT_KINDS = ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"] as const;
export const DATE_FORMATS = ["dmy", "mdy", "ymd", "d_mon_y", "excel_serial"] as const;
export const RESOLVERS = [
  "customer_by_name",
  "vendor_by_name",
  "section_by_code",
  "die_copy_by_code",
  "bundle_by_legacy_id",
] as const;
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

const colRef = z.object({ col: z.number().int(), header: z.string() }).strict();
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("columns"), cols: z.array(colRef) }).strict(),
  z.object({ kind: z.literal("constant"), value: z.string() }).strict(),
  z.object({ kind: z.literal("period_as_of") }).strict(),
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
  z.object({ op: z.literal("number"), kind: z.enum(UNIT_KINDS), unit: z.string().nullable() }).strict(),
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
    headerRows: z.number().int(),
    match: z.object({ headerKey: z.string(), headers: z.array(z.string()) }).strict(),
    fields: z.array(z.object({ field: z.string(), source, steps: z.array(step) }).strict()),
    filters: z.array(filter),
    keys: z.array(z.string()),
    onExisting: z.enum(["ask", "fill_blanks", "skip"]),
    unclear: z.array(z.object({ field: z.string(), code: z.enum(UNCLEAR_CODES) }).strict()),
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;
