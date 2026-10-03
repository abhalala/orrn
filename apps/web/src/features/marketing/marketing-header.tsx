/**
 * Marketing header: wordmark, language, Sign in, Request access. Clear over
 * the hero; once the page scrolls (IntersectionObserver on a sentinel, no
 * scroll listener) it gets the canvas colour and a hairline so text below
 * never shows through. Phones keep the wordmark and the language toggle; the
 * hero right below carries both actions.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

export function MarketingHeader() {
  const { t } = useT();
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-4 w-px" />
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color] duration-[var(--dur-base)]",
          scrolled ? "border-border bg-background/95 backdrop-blur-md" : "border-transparent bg-transparent",
        )}
      >
        <div className="orrn-section flex h-16 items-center justify-between gap-3">
          <Link
            to="/"
            aria-label={t("marketing.homeLabel")}
            className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-full pr-1 no-underline"
          >
            <span aria-hidden="true" className="orrn-mark size-8" />
            <span aria-hidden="true" className="font-display text-[22px] font-extrabold tracking-[-0.035em] text-foreground">
              {t("common.appName")}
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <LanguageToggle className="w-auto" />
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link to="/login">{t("marketing.signIn")}</Link>
            </Button>
            <Button asChild className="hidden md:inline-flex">
              <Link to="/request-access">{t("marketing.requestAccess")}</Link>
            </Button>
          </div>
        </div>
      </header>
    </>
  );
}
