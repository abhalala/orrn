import { useT } from "@orrn/i18n";

/**
 * The "Demo data" tag on every sample product screen. The screens are
 * `aria-hidden`, so the tag is a visible disclosure only; it carries the page
 * language because the screen around it is tagged `lang="en"`.
 */
export function DemoTag() {
  const { t, locale } = useT();
  return (
    <span className="marketing-demo" lang={locale}>
      {t("common.demoData")}
    </span>
  );
}
