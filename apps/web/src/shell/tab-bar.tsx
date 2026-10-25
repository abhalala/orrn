import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Ellipsis, ScanLine } from "lucide-react";

import type { ShellVariant } from "./more-menu";
import { isItemActive, type NavItem } from "./nav-items";

/**
 * Phone bottom bar (< 768px): Today · Pack · Scan · Stock · Dispatch · More for a
 * company, the admin pages and More for Godseye. Scan is a raised green button in the
 * middle; More (BACKLOG 92) opens the sheet with the office pages the person may use
 * (Orders, Press, Approvals, Reports...) so they do not hide behind the avatar; the rest are router links. Always visible, like native tab bars
 * (ruling R23); screens' sticky action bars sit above it via
 * `--shell-tabbar-offset`.
 */
export function TabBar({
  items,
  pathname,
  variant,
  onScan,
  onMore,
}: {
  items: readonly NavItem[];
  pathname: string;
  variant: ShellVariant;
  /** Set when Scan is available (tenant, bundles module on). */
  onScan?: () => void;
  /** Set when the person has pages beyond the tabs (role-aware, from `visibleItems`): opens the More sheet. */
  onMore?: () => void;
}) {
  const { t } = useT();
  const scanAt = onScan ? Math.floor(items.length / 2) : -1;
  const slots = items.length + (onScan ? 1 : 0) + (onMore ? 1 : 0);

  const tabs = items.map((item) => {
    const active = isItemActive(item, pathname);
    const Icon = item.icon;
    return (
      <li key={item.key} className="min-w-0">
        <Link
          to={item.to as never}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex h-[62px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-card pt-1.5 pb-1 no-underline transition-[color,scale] duration-[var(--dur-fast)] active:scale-[0.97]",
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

  if (onMore) {
    tabs.push(
      <li key="more" className="min-w-0">
        <button
          type="button"
          onClick={onMore}
          aria-haspopup="dialog"
          data-slot="tab-more"
          className="group flex h-[62px] w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-card pt-1.5 pb-1 text-muted-foreground transition-[color,scale] duration-[var(--dur-fast)] hover:text-foreground active:scale-[0.97]"
        >
          <span aria-hidden="true" className="flex h-8 w-14 items-center justify-center rounded-full">
            <Ellipsis className="size-[22px]" strokeWidth={2} />
          </span>
          <span className="max-w-full truncate px-0.5 text-[11px] leading-4 font-medium">{t("nav.more")}</span>
        </button>
      </li>,
    );
  }

  return (
    <nav
      aria-label={t("nav.main")}
      data-slot="tab-bar"
      data-shell-chrome=""
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden",
      )}
    >
      <ul
        className="m-0 grid h-[72px] list-none items-end gap-1 px-2 pt-1 pb-1.5"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {tabs}
      </ul>
    </nav>
  );
}
