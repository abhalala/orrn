import { useT } from "@orrn/i18n";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

import { RequestAccessLink } from "./hero";

const SECTIONS = [
  { id: "flow", label: "navFlow" },
  { id: "floor", label: "navFloor" },
  { id: "faq", label: "navFaq" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCta, setShowCta] = useState(!onHome);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (locale === "gu") setLocale("en");
  }, [locale, setLocale]);

  useEffect(() => {
    setMenuOpen(false);
    if (!onHome) {
      setShowCta(true);
      return;
    }
    const hero = document.getElementById("hero-cta");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowCta(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [onHome]);

  useEffect(() => {
    if (!menuOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.querySelectorAll<HTMLElement>('main, footer, a[href="#main"]'))
      .filter((element) => !element.hasAttribute("inert"));
    for (const element of background) element.setAttribute("inert", "");
    const desktop = window.matchMedia("(min-width: 56.25rem)");
    const closeOnDesktop = () => {
      if (!desktop.matches) return;
      if (menuRef.current?.contains(document.activeElement)) {
        document.querySelector<HTMLAnchorElement>(".marketing-brand")?.focus();
      }
      setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = oldOverflow;
      for (const element of background) element.removeAttribute("inert");
      desktop.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const sectionLink = ({ id, label }: (typeof SECTIONS)[number], mobile = false) => {
    const content = t(`marketing.${label}`);
    if (onHome) {
      return (
        <a key={`${mobile ? "m" : "d"}-${id}`} href={`#${id}`} aria-current={!mobile && current === id ? "location" : undefined} onClick={() => setMenuOpen(false)}>
          {content}
        </a>
      );
    }
    return <Link key={`${mobile ? "m" : "d"}-${id}`} to="/" hash={id} onClick={() => setMenuOpen(false)}>{content}</Link>;
  };

  return (
    <header className="marketing-header" data-show-cta={showCta} data-menu-open={menuOpen}>
      <div className="marketing-header-inner">
        <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
          <span aria-hidden="true" className="orrn-mark" />
          <span aria-hidden="true" className="marketing-brand-word">{t("common.appName")}</span>
        </Link>
        <nav className="marketing-nav" aria-label={t("marketing.mainNav")}>
          {SECTIONS.map((section) => sectionLink(section))}
        </nav>
        <div className="marketing-header-end">
          <LanguageToggle className="marketing-language" locales={["en", "hi"]} />
          <Link to="/login" className="marketing-text-link marketing-signin">{t("marketing.signIn")}</Link>
          <RequestAccessLink className="marketing-button marketing-button-sm marketing-header-cta" />
          <button
            ref={toggleRef}
            type="button"
            className="marketing-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="marketing-menu"
            aria-label={t(menuOpen ? "marketing.closeMenu" : "marketing.openMenu")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" /><span aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={menuRef} id="marketing-menu" className="marketing-menu" hidden={!menuOpen}>
        <nav aria-label={t("marketing.menuLabel")}>
          {SECTIONS.map((section) => sectionLink(section, true))}
          <Link to="/login" onClick={() => setMenuOpen(false)}>{t("marketing.signIn")}</Link>
          <div className="marketing-menu-action"><RequestAccessLink /></div>
        </nav>
      </div>
    </header>
  );
}
