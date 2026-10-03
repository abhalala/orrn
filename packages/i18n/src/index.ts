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
