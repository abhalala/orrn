import { en, type Messages } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";

/**
 * Every language's messages, loaded up front (Bun tests, native, the server).
 * The web build swaps this module for `dictionaries.web.ts` (apps/web/vite.config.ts),
 * which keeps only English in the entry chunk and fetches Hindi when it is chosen.
 * Both modules export the same three names.
 */
// gu is partial (floor namespaces complete); createI18n falls back to English for the rest.
export const DICTIONARIES: Partial<Record<"en" | "hi" | "gu", Messages>> = { en, hi, gu: gu as unknown as Messages };

/** Whether a language's messages are here (always, in this module). */
export function hasMessages(locale: "en" | "hi" | "gu"): boolean {
  return DICTIONARIES[locale] !== undefined;
}

/** Makes a language's messages available; a no-op here, where all are loaded. */
export async function loadMessages(_locale: "en" | "hi" | "gu"): Promise<void> {}
