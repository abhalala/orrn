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

/**
 * Whether the hero card or one of the page's own "Request access" buttons is on screen. On phones the
 * floating action is then faded out, so it never sits over the hero text or next to the button it repeats.
 */
function useInlineActionInView(pathname: string): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const main = document.querySelector("main");
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setInView(visible.size > 0);
    });
    // The story re-renders once it knows the screen width, which replaces the hero: look again
    // whenever main's content changes so the observer never watches a detached node.
    let frame = 0;
    const scan = () => {
      frame = 0;
      observer.disconnect();
      visible.clear();
      const targets = main?.querySelectorAll("[data-marketing-hero], a[href='/request-access']") ?? [];
      targets.forEach((target) => observer.observe(target));
      if (targets.length === 0) setInView(false);
    };
    scan();
    const mutations = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(scan);
    });
    if (main) mutations.observe(main, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [pathname]);
  return inView;
}

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
  const pathname = useLocation({ select: (location) => location.pathname });
  const onHome = pathname === "/";
  const current = useCurrentSection(onHome);
  const inlineActionInView = useInlineActionInView(pathname);

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
        <Link to="/request-access" className="marketing-mobile-action" data-tucked={inlineActionInView || undefined}>
          {t("marketing.requestAccess")}
        </Link>
      </div>
    </header>
  );
}
