import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createI18n, DEFAULT_LOCALE, type Locale, type Translate } from "./core";

/**
 * React binding shared by web and React Native: no DOM or platform APIs here.
 * Saving the choice (localStorage on web, SecureStore on native) and setting
 * `<html lang>` are the caller's job, via `onLocaleChange`.
 */
export type I18nContextValue = {
  t: Translate;
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const fallback = createI18n(DEFAULT_LOCALE);
const I18nContext = createContext<I18nContextValue>({
  t: fallback.t,
  locale: fallback.locale,
  setLocale: () => {},
});

export type I18nProviderProps = {
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  children?: ReactNode;
};

export function I18nProvider({ locale: initial, onLocaleChange, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  // A new `locale` prop (for example read late from storage) wins.
  useEffect(() => {
    setLocaleState(initial);
  }, [initial]);

  // Keep the latest callback in a ref so an inline `onLocaleChange` doesn't
  // give `setLocale` (and so every `useT()` consumer) a new identity each render.
  const onLocaleChangeRef = useRef(onLocaleChange);
  useEffect(() => {
    onLocaleChangeRef.current = onLocaleChange;
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    onLocaleChangeRef.current?.(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const { t } = createI18n(locale);
    return { t, locale, setLocale };
  }, [locale, setLocale]);

  return createElement(I18nContext.Provider, { value }, children);
}

/** `t()`, the current locale and `setLocale`. Outside a provider it returns English. */
export function useT(): I18nContextValue {
  return useContext(I18nContext);
}
