/**
 * Structured output schemas for the bot (plan B6 and the vision read).
 *
 * No free model text reaches the UI: the model answers with one of these shapes or the answer
 * is thrown away. Bounds (3 cols, 6 steps, and so on) are not here. The SDK strips min and max
 * from the schema it sends, so `validateRecipe` (plan B2) enforces them after parsing.
 */
import * as z from "zod/v4";

import { recipeSchema } from "./recipe-local";

export { recipeSchema, INGEST_TARGETS } from "./recipe-local";
export type { Recipe } from "./recipe-local";

export const NO_TARGET_REASONS = ["not_a_table", "summary_only", "unsupported_target", "unreadable"] as const;
export type NoTargetReason = (typeof NO_TARGET_REASONS)[number];

export const botOutput = z
  .object({
    result: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("recipe"), recipe: recipeSchema }).strict(),
      z.object({ kind: z.literal("no_target"), reason: z.enum(NO_TARGET_REASONS) }).strict(),
    ]),
  })
  .strict();
export type BotOutput = z.infer<typeof botOutput>;

/** One table read from a page image. `rowConfidence` has one entry per row, 0 to 1. */
export const visionOutput = z
  .object({
    tables: z.array(
      z
        .object({
          title: z.string().nullable(),
          headers: z.array(z.string()),
          rows: z.array(z.array(z.string())),
          rowConfidence: z.array(z.number()),
        })
        .strict(),
    ),
  })
  .strict();
export type VisionOutput = z.infer<typeof visionOutput>;

/**
 * Turns a failed parse into short codes that are safe to show a model in a retry turn.
 * A code is built only from schema paths and zod issue codes, never from file content.
 */
export function schemaErrorCodes(error: z.ZodError, max = 20): string[] {
  const out: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map((p) => String(p)).join(".");
    const code = `schema:${path || "root"}:${issue.code}`.toLowerCase().replace(/[^a-z0-9_.:]/g, "_");
    if (!out.includes(code)) out.push(code.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}
