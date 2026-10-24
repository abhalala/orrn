export { en, type DeepStringRecord, type MessageKey, type Messages } from "./en";
export { hi } from "./hi";
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
// Guide CONTENT (getGuide, listGuides) is imported from "@orrn/i18n/guides",
// never from here: this index is in the web entry chunk, and re-exporting the
// guide books from it put ~45 kB of SOP text into every first load (the
// entry is capped at 700 kB by apps/web/scripts/check-modulepreload.ts).
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
