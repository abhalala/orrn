/**
 * What a refused ageing write says on the phone (FP-AG-16). The ageing sentences are not in the shared refusal
 * table: importing the module below registers them once (`ageing.refusal.*`, en, hi and gu, the same hook
 * `@orrn/i18n/refusal-foundry` uses), and every ageing screen reaches it through this file, so `serverRefusal`
 * speaks them in the person's language. An answer that never came says "not sure it saved". Never show
 * `error.message` on an ageing screen.
 */
import "@orrn/i18n/refusal-ageing";

import type { Translate } from "@orrn/i18n";
import { mapSentence } from "@orrn/i18n/refusal";

import { serverRefusal } from "@/lib/server-refusal";

/** The sentence for a refused write, in the person's language. */
export function ageingError(t: Translate, error: unknown): string {
  return serverRefusal(error, t);
}

/**
 * An ageing refusal found in an error (a bundle restore whose trolley line is no longer released, a void whose
 * batch moved on) said in the person's language, or null for anything else.
 */
export function ageingRefusalText(t: Translate, error: unknown): string | null {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string") return null;
  const hit = mapSentence(message, t);
  return hit && String(hit.key).startsWith("ageing.refusal.") ? t(hit.key, hit.vars) : null;
}
