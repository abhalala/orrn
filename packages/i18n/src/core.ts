import { DICTIONARIES } from "./dictionaries";
import type { MessageKey } from "./en";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in its own script, for the language toggle. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिंदी" };

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

export type I18n = { locale: Locale; t: Translate };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Fills `{name}` with `vars.name`, and `{count:one|other}` with `one` when
 * `vars.count` is 1, else `other`. A missing variable renders as `{name}` (form
 * templates too) so the gap is visible instead of silently blank.
 */
export function interpolate(template: string, vars: TranslateVars = {}): string {
  return template.replace(/\{(\w+)(?::([^|}]*)\|([^}]*))?\}/g, (_whole, name: string, one?: string, other?: string) => {
    const value = vars[name];
    if (value === undefined) return `{${name}}`;
    if (one !== undefined && other !== undefined) return Number(value) === 1 ? one : other;
    return String(value);
  });
}

/**
 * A translator for one locale. Falls back to English, then to the key itself. On web a dictionary
 * may not have arrived yet (dictionaries.web.ts: the entry holds only the public `/` English), so
 * this reads the loaded dictionaries on every call: a `t` made before a load sees it afterwards.
 */
export function createI18n(locale: Locale): I18n {
  const t: Translate = (key, vars) =>
    interpolate(lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES.en, key) ?? key, vars);
  return { locale, t };
}
