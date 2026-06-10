/**
 * Sticky glass marketing header. Compacts after the page scrolls past the
 * hero fold; mobile gets a sheet-style menu.
 */
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { label: "Modules", href: "#modules" },
  { label: "Workflow", href: "#workflow" },
  { label: "Security", href: "#tenant-first" },
] as const;

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 24));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-[var(--dur-base)]",
        scrolled ? "py-2" : "py-4",
      )}
    >
      <div
        className={cn(
          "orrn-section flex items-center justify-between gap-4 rounded-xl transition-all duration-[var(--dur-base)]",
          scrolled ? "orrn-glass mx-4 max-w-5xl px-4 py-2 shadow-md md:mx-auto" : "bg-transparent",
        )}
      >
        <Link to="/" className="flex items-center gap-3 no-underline">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground orrn-glow">
            O
          </div>
          <div className="leading-tight">
            <span className="block text-base font-semibold text-foreground">ORRN</span>
            <span className="hidden text-xs text-muted-foreground sm:block">
              Manufactured Inventory ERP
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Marketing">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost">
            <Link to="/login">Sign In</Link>
          </Button>
          <Button asChild className="orrn-glow">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              Request Demo
            </Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </div>

      {menuOpen ? (
        <div className="orrn-glass mx-4 mt-2 flex flex-col gap-1 rounded-xl p-3 shadow-lg md:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent"
            >
              {link.label}
            </a>
          ))}
          <div className="my-1 border-t border-border" />
          <Button asChild variant="ghost" className="justify-start">
            <Link to="/login">Sign In</Link>
          </Button>
          <Button asChild>
            <Link to="/waitlist" search={{ mode: "demo" }}>
              Request Demo
            </Link>
          </Button>
        </div>
      ) : null}
    </header>
  );
}
