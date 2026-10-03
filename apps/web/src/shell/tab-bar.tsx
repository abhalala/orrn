import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ScanLine } from "lucide-react";
import { useEffect, useState } from "react";

import type { ShellVariant } from "./more-menu";
import { isItemActive, type NavItem } from "./nav-items";
import { navTarget } from "./route-compat";

/**
 * True while the person is scrolling down the page (the bar steps aside) and
 * false again on the way up, at the top, and at the very bottom.
 *
 * No scroll listener (design brief): a ladder of 1px sentinels down the
 * document feeds one IntersectionObserver, which fires each time the page
 * moves by a rung (~72px). Each firing compares `scrollY` with the last one.
 */
export function useHiddenOnScrollDown(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      setHidden(false);
      return;
    }
    const RUNG = 72;
    const MAX_RUNGS = 400;
    const ladder = document.createElement("div");
    ladder.setAttribute("aria-hidden", "true");
    ladder.dataset.slot = "scroll-ladder";
    ladder.style.cssText = "position:absolute;top:0;left:0;width:1px;height:0;pointer-events:none;visibility:hidden;";
    document.body.appendChild(ladder);

    let lastY = window.scrollY;
    const observer = new IntersectionObserver(() => {
      const y = window.scrollY;
      const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (y <= RUNG || atBottom) setHidden(false);
      else if (y > lastY + 8) setHidden(true);
      else if (y < lastY - 8) setHidden(false);
      lastY = y;
    });

    const build = () => {
      const height = document.documentElement.scrollHeight;
      const step = Math.max(RUNG, Math.ceil(height / MAX_RUNGS));
      const count = Math.ceil(height / step) + 1;
      if (ladder.childElementCount === count && ladder.dataset.step === String(step)) return;
      observer.disconnect();
      ladder.replaceChildren();
      ladder.dataset.step = String(step);
      for (let i = 0; i < count; i += 1) {
        const rung = document.createElement("div");
        rung.style.cssText = `position:absolute;left:0;top:${i * step}px;width:1px;height:1px;`;
        ladder.appendChild(rung);
        observer.observe(rung);
      }
    };
    build();
    const resize = new ResizeObserver(build);
    resize.observe(document.body);

    return () => {
      resize.disconnect();
      observer.disconnect();
      ladder.remove();
    };
  }, [enabled]);

  return hidden;
}

/**
 * Phone bottom bar (< 768px): Today · Pack · Scan · Stock · Dispatch for a
 * company, the admin pages for Godseye. Scan is a raised green button in the
 * middle; the rest are router links. Slides away while scrolling down and
 * returns on the way up, or as soon as anything in it has keyboard focus.
 */
export function TabBar({
  items,
  pathname,
  variant,
  onScan,
  hidden,
}: {
  items: readonly NavItem[];
  pathname: string;
  variant: ShellVariant;
  /** Set when Scan is available (tenant, bundles module on). */
  onScan?: () => void;
  /** From `useHiddenOnScrollDown`, owned by the shell so sticky bars can follow it. */
  hidden: boolean;
}) {
  const { t } = useT();
  const scanAt = onScan ? Math.floor(items.length / 2) : -1;
  const slots = items.length + (onScan ? 1 : 0);

  const tabs = items.map((item) => {
    const active = isItemActive(item, pathname);
    const Icon = item.icon;
    return (
      <li key={item.key} className="min-w-0">
        <Link
          to={navTarget(item.to) as never}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-card pt-1.5 pb-1 no-underline transition-[color,scale] duration-[var(--dur-fast)] active:scale-[0.97]",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-[var(--dur-base)]",
              active && (variant === "godseye" ? "bg-tone-violet-tint text-tone-violet-ink" : "bg-surface-sunken"),
            )}
          >
            <Icon className="size-[22px]" strokeWidth={2} />
          </span>
          <span
            className={cn(
              "max-w-full truncate px-0.5 text-[11px] leading-4",
              active ? "font-semibold" : "font-medium",
              active && variant === "godseye" && "text-tone-violet-ink",
            )}
          >
            {t(item.tabLabelKey ?? item.labelKey)}
          </span>
        </Link>
      </li>
    );
  });

  if (onScan) {
    tabs.splice(
      scanAt,
      0,
      <li key="scan" className="flex min-w-0 justify-center">
        <button
          type="button"
          onClick={onScan}
          className="group -mt-5 flex min-w-0 flex-col items-center gap-0.5 rounded-card pb-1 text-muted-foreground transition-[scale] duration-[var(--dur-fast)] active:scale-[0.95]"
        >
          <span
            aria-hidden="true"
            className="flex size-[60px] items-center justify-center rounded-full bg-[linear-gradient(160deg,var(--tone-green-from),var(--tone-green-to))] text-tone-green-on shadow-button ring-4 ring-card"
          >
            <ScanLine className="size-7" strokeWidth={2} />
          </span>
          <span className="max-w-full truncate text-[11px] leading-4 font-semibold text-foreground">
            {t("nav.scan")}
          </span>
        </button>
      </li>,
    );
  }

  return (
    <nav
      aria-label={t("nav.main")}
      data-slot="tab-bar"
      data-shell-chrome=""
      data-hidden={hidden ? "true" : "false"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-xl backdrop-saturate-150 md:hidden",
        "pb-[env(safe-area-inset-bottom)] transition-transform duration-[var(--dur-slow)] ease-[var(--ease-spring)]",
        "translate-y-0 data-[hidden=true]:translate-y-[calc(100%+8px)] focus-within:!translate-y-0",
      )}
    >
      <ul
        className="m-0 grid list-none items-end gap-1 px-2 pt-1 pb-1.5"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {tabs}
      </ul>
    </nav>
  );
}
