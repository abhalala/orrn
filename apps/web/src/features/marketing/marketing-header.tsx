/**
 * Marketing header. Transparent over the hero; once the page scrolls past a
 * sentinel (IntersectionObserver, no scroll listener) it settles into a
 * compact surface pill. Mobile gets a simple disclosure menu.
 */
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const NAV_LINKS = [
  { label: "Modules", href: "#modules" },
  { label: "Workflow", href: "#workflow" },
  { label: "Security", href: "#tenant-first" },
] as const;

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-6 w-px" />
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-[padding] duration-[var(--dur-base)]",
          scrolled ? "py-2" : "py-3 md:py-4",
        )}
      >
        <div
          className={cn(
            "orrn-section flex items-center justify-between gap-4 rounded-full transition-[background-color,box-shadow,border-color] duration-[var(--dur-base)]",
            scrolled
              ? "max-w-[calc(100%-1.5rem)] border border-border bg-card/90 py-1.5 shadow-md backdrop-blur-md md:max-w-5xl md:pl-4 md:pr-2"
              : "border border-transparent",
          )}
        >
          <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full no-underline" aria-label="ORRN home">
            <span aria-hidden="true" className="orrn-mark size-8" />
            <span className="flex items-baseline gap-2.5 leading-none">
              <span className="font-display text-[22px] font-extrabold tracking-[-0.035em] text-foreground">
                orrn
              </span>
              <span className="hidden text-[13px] font-medium text-muted-foreground lg:inline">
                Manufactured inventory ERP
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button asChild variant="ghost">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/waitlist" search={{ mode: "demo" }}>
                Request demo
              </Link>
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="marketing-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </Button>
        </div>

        {menuOpen ? (
          <div
            id="marketing-menu"
            className="orrn-rise mx-3 mt-2 flex flex-col gap-1 rounded-card border border-border bg-card p-2 shadow-md md:hidden"
          >
            <nav aria-label="Sections" className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-3 text-[15px] font-medium text-foreground no-underline transition-colors hover:bg-accent"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="my-1 border-t border-border" />
            <div className="grid grid-cols-2 gap-2 p-1">
              <Button asChild variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link to="/waitlist" search={{ mode: "demo" }}>
                  Request demo
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}
