import { useT } from "@orrn/i18n";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

/** Homepage sections the bar links to, in page order. */
const SECTIONS = [
  { id: "flow", label: "navFlow" },
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

/**
 * The sticky bar: brand, two section anchors from 900 px, the language switch,
 * Sign in and Request access. The switch is the app's own `LanguageToggle`;
 * below 480 px marketing.css shows it as EN and a short Devanagari label while
 * the accessible names stay "English" and "हिंदी".
 */
export function MarketingHeader() {
  const { t, locale, setLocale } = useT();
  const pathname = useLocation({ select: (location) => location.pathname });
  const onHome = pathname === "/";
  const current = useCurrentSection(onHome);

  useEffect(() => {
    // Public marketing and legal copy ships in English and Hindi only.
    if (locale === "gu") setLocale("en");
  }, [locale, setLocale]);

  return (
    <header className="marketing-header">
      <div className="marketing-wrap marketing-header-inner">
        <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
          <span aria-hidden="true" className="orrn-mark" />
          <span aria-hidden="true" className="marketing-brand-word">
            {t("common.appName")}
          </span>
        </Link>
        <nav className="marketing-nav" aria-label={t("marketing.mainNav")}>
          {SECTIONS.map(({ id, label }) =>
            // On the homepage a plain anchor scrolls in place; elsewhere the router opens the homepage at the section.
            onHome ? (
              <a key={id} href={`#${id}`} aria-current={current === id ? "location" : undefined}>
                {t(`marketing.${label}`)}
              </a>
            ) : (
              <Link key={id} to="/" hash={id}>
                {t(`marketing.${label}`)}
              </Link>
            ),
          )}
        </nav>
        <div className="marketing-header-end">
          <LanguageToggle className="marketing-language" locales={["en", "hi"]} />
          <Link to="/login" className="marketing-signin">
            {t("marketing.signIn")}
          </Link>
          <Link to="/request-access" className="marketing-button marketing-button-sm">
            {t("marketing.requestAccess")}
          </Link>
        </div>
      </div>
    </header>
  );
}
