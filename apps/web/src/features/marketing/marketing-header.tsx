import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

export function MarketingHeader() {
  const { t, locale, setLocale } = useT();

  useEffect(() => {
    // Public marketing and legal copy currently ships in English and Hindi only.
    if (locale === "gu") setLocale("en");
  }, [locale, setLocale]);

  useEffect(() => {
    const root = document.documentElement;
    const themeColors = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    root.style.backgroundColor = "#0c0c0e";
    for (const meta of themeColors) meta.content = "#0c0c0e";
    return () => {
      root.style.backgroundColor = "";
      for (const meta of themeColors) meta.content = meta.media.includes("light") ? "#f4f4f1" : "#0c0c0e";
    };
  }, []);
  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header-inner">
        <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
          <span aria-hidden="true" className="orrn-mark" />
          <span aria-hidden="true">{t("common.appName")}</span>
        </Link>
        <nav className="marketing-header-links" aria-label={t("marketing.mainNav")}>
          <Link to="/guides">{t("marketing.guides")}</Link>
          <Link to="/login">{t("marketing.signIn")}</Link>
        </nav>
        <LanguageToggle className="marketing-language" locales={["en", "hi"]} />
        <Link to="/request-access" className="marketing-mobile-action">
          {t("marketing.requestAccess")}
        </Link>
      </div>
    </header>
  );
}
