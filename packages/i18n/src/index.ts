export type { DeepStringRecord, MessageKey, Messages } from "./en";
// No dictionary VALUES here: this index is in the web entry chunk, and re-exporting a dictionary
// pins it there. Raw messages: `@orrn/i18n/en`, `@orrn/i18n/hi` (tests, native). On web the entry
// carries only the public `/` English (en-public.gen.ts); full English and Hindi are fetched on
// demand (dictionaries.web.ts) and `t()` stays synchronous.
export { hasMessages, loadMessages } from "./dictionaries";
export {
  createI18n,
  DEFAULT_LOCALE,
  interpolate,
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  type I18n,
  type Locale,
  type Translate,
  type TranslateVars,
} from "./core";
export { I18nProvider, useT, type I18nContextValue, type I18nProviderProps } from "./use-t";
// Guide metadata only. The guide text (getGuide, listGuides) lives at `@orrn/i18n/guides`: re-exporting
// it here put ~50 kB of SOP text into the web entry chunk (over the 700 kB budget). Import it from the
// subpath in the lazy screens that show guides.
export {
  COMPANY_ROLES,
  GUIDE_SLUGS,
  isGuideSlug,
  type CompanyRole,
  type Guide,
  type GuideBook,
  type GuideProblem,
  type GuideSlug,
  type GuideStep,
} from "./guides/types";
