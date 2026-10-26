import { LOCALE_NAMES, LOCALES, useT, type Locale } from "@orrn/i18n";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";

/**
 * English / हिंदी. Each option is written in its own script so a person who
 * can't read the current language still finds theirs. The provider in
 * `__root.tsx` saves the choice and updates `<html lang>`.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, locale, setLocale } = useT();
  return (
    <SegmentedControl<Locale>
      label={t("common.language")}
      value={locale}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      onChange={setLocale}
      className={className}
    />
  );
}
