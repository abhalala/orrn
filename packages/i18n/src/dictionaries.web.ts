import { en, type Messages } from "./en";

/**
 * Web build stand-in for `dictionaries.ts` (swapped in by apps/web/vite.config.ts): English
 * ships in the entry chunk, Hindi (about 20 kB gzip) is its own chunk fetched when chosen,
 * so a first visit to `/` stays inside its JS budget (scripts/check-route-budget.ts).
 * Until Hindi lands `createI18n("hi")` answers in English (its normal fallback).
 */
export const DICTIONARIES: Partial<Record<"en" | "hi", Messages>> = { en };

export function hasMessages(locale: "en" | "hi"): boolean {
  return DICTIONARIES[locale] !== undefined;
}

const LOADERS: Record<"hi", () => Promise<Messages>> = {
  hi: () => import("./hi").then((m) => m.hi),
};

const pending: Partial<Record<"hi", Promise<void>>> = {};

/** Fetches a language's messages once (concurrent callers share the request; a failure can be retried). */
export function loadMessages(locale: "en" | "hi"): Promise<void> {
  if (locale === "en" || hasMessages(locale)) return Promise.resolve();
  pending[locale] ??= LOADERS[locale]().then(
    (messages) => {
      DICTIONARIES[locale] = messages;
    },
    (error: unknown) => {
      delete pending[locale];
      throw error;
    },
  );
  return pending[locale];
}
