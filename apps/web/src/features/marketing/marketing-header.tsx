import { useT } from "@orrn/i18n";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

/** Homepage sections the bar links to, in page order. */
const SECTIONS = [
  { id: "flow", label: "navChain" },
  { id: "floor", label: "navFloor" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Which homepage section crosses the middle of the screen, for the bar's current-section mark. */
function useCurrentSection(enabled: boolean): SectionId | null {
  const [current, setCurrent] = useState<SectionId | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<SectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id as SectionId;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        setCurrent(SECTIONS.find((section) => visible.has(section.id))?.id ?? null);
      },
      { rootMargin: "-45% 0px -55% 0px" },
    );
    for (const { id } of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [enabled]);
  return current;
}

export function MarketingHeader() {
  const { t, locale, setLocale } = useT();
  const onHome = useLocation({ select: (location) => location.pathname === "/" });
  const current = useCurrentSection(onHome);

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
          {SECTIONS.map(({ id, label }) =>
            // On the homepage a plain anchor scrolls in place; elsewhere the router opens the homepage at the section.
            onHome ? (
              <a key={id} href={`#${id}`} data-section aria-current={current === id ? "location" : undefined}>
                {t(`marketing.${label}`)}
              </a>
            ) : (
              <Link key={id} to="/" hash={id} data-section>
                {t(`marketing.${label}`)}
              </Link>
            ),
          )}
          <Link to="/guides" data-section>
            {t("marketing.guides")}
          </Link>
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
