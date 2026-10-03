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
export {
  COMPANY_ROLES,
  getGuide,
  GUIDE_SLUGS,
  isGuideSlug,
  listGuides,
  type CompanyRole,
  type Guide,
  type GuideBook,
  type GuideProblem,
  type GuideSlug,
  type GuideStep,
} from "./guides";
