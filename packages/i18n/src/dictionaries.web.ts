import type { Messages } from "./en";
import { enPublic } from "./en-public.gen";

/**
 * Web build stand-in for `dictionaries.ts` (swapped in by apps/web/vite.config.ts). The entry
 * chunk carries only the English the public `/` page renders (en-public.gen.ts, picked by
 * public-keys.ts), so a first visit to `/` stays inside its JS budget however many screens
 * add keys. The full English and Hindi are their own chunks, fetched on demand: the root
 * route's beforeLoad awaits the saved language before any other page renders, and the
 * provider fetches a language when it is chosen. Until a dictionary lands, `createI18n`
 * answers with what is here (English, then the key itself).
 *
 * A new locale gets a line in LOADERS (the Record fails to type-check until it does).
 */
export const DICTIONARIES: Partial<Record<"en" | "hi" | "gu", Messages>> = { en: enPublic as unknown as Messages };

const complete = new Set<"en" | "hi" | "gu">();

/** Whether a language's FULL messages are here (English starts with the public subset only). */
export function hasMessages(locale: "en" | "hi" | "gu"): boolean {
  return complete.has(locale);
}

const LOADERS: Record<"en" | "hi" | "gu", () => Promise<Messages>> = {
  en: () => import("./en").then((m) => m.en),
  hi: () => import("./hi").then((m) => m.hi),
  // Partial: missing keys fall back to English in createI18n, so the full English comes with it
  // (the entry only has the public subset: without it a gu page would print raw keys).
  gu: async () => {
    await loadMessages("en");
    return import("./gu").then((m) => m.gu as unknown as Messages);
  },
};

const pending: Partial<Record<"en" | "hi" | "gu", Promise<void>>> = {};

/** Fetches a language's messages once (concurrent callers share the request; a failure can be retried). */
export function loadMessages(locale: "en" | "hi" | "gu"): Promise<void> {
  if (hasMessages(locale)) return Promise.resolve();
  // Gujarati is partial: the keys it lacks answer in English, so the full English comes with it
  // (without it a Gujarati screen outside the floor namespaces would show raw keys).
  const load = locale === "gu" ? loadMessages("en").then(() => LOADERS.gu()) : LOADERS[locale]();
  pending[locale] ??= load.then(
    (messages) => {
      DICTIONARIES[locale] = messages;
      complete.add(locale);
    },
    (error: unknown) => {
      delete pending[locale];
      throw error;
    },
  );
  return pending[locale];
}
