import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Eye, ScanLine, Search } from "lucide-react";
import { useId, type ReactNode } from "react";

import { useMe } from "@/shared/lib/me";

import { usePalette, paletteShortcutLabel } from "./command-palette";
import { AccountMenu, Avatar, type ShellVariant } from "./more-menu";
import { isItemActive, type NavItem } from "./nav-items";
import { PlantSwitcher } from "./plant-switcher";

/**
 * From 768px: one ink panel that is an icon rail on iPad portrait (88px, icon
 * over a short label) and a full sidebar from 1024px (272px, icon beside the
 * label, "Scan or search ⌘K" at the top, the More group under a quiet label,
 * account in the footer). Same DOM for both, so there is exactly one primary
 * `nav` landmark at any width.
 */
export function SideNav({
  variant,
  primary,
  more,
  pathname,
  onScan,
  onOpenAccount,
}: {
  variant: ShellVariant;
  primary: readonly NavItem[];
  more: readonly NavItem[];
  pathname: string;
  onScan?: () => void;
  /** Rail (768-1023): the avatar opens the account sheet. */
  onOpenAccount(): void;
}) {
  const { t } = useT();
  const palette = usePalette();
  const moreLabelId = useId();
  const home = variant === "godseye" ? "/admin" : "/today";

  // In the rail, Scan sits in the middle of the primary items, like the tab bar.
  const scanAt = Math.floor(primary.length / 2);

  return (
    <div
      data-slot="side-nav"
      data-shell-chrome=""
      className="orrn-ink-panel sticky top-0 hidden h-[100dvh] w-[88px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex lg:w-[272px]"
    >
      <div className="flex shrink-0 justify-center px-3 pt-4 pb-2 lg:justify-start lg:px-5 lg:pt-5">
        <Link
          to={home as never}
          aria-label={variant === "godseye" ? t("nav.godseyeHome") : t("nav.home")}
          className="flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-full no-underline lg:justify-start lg:pr-2"
        >
          <span aria-hidden="true" className="orrn-mark flex size-8 items-center justify-center text-white">
            {variant === "godseye" ? <Eye className="size-4" strokeWidth={2} /> : null}
          </span>
          <span
            aria-hidden="true"
            className="hidden font-display text-[20px] font-extrabold tracking-[-0.03em] text-sidebar-foreground lg:inline"
          >
            {variant === "godseye" ? t("nav.godseye") : t("common.appName")}
          </span>
        </Link>
      </div>

      {variant === "tenant" ? (
        <div className="flex shrink-0 px-3 pb-2 lg:px-3">
          <PlantSwitcher variant="rail" />
        </div>
      ) : null}

      <nav aria-label={t("nav.main")} className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain">
        {palette.available ? (
          <div className="hidden items-center gap-2 px-3 pt-2 pb-3 lg:flex">
            <button
              type="button"
              onClick={palette.open}
              aria-keyshortcuts="Meta+K Control+K /"
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-sidebar-accent pr-1.5 pl-3 text-left text-[14px] text-sidebar-muted transition-colors duration-[var(--dur-fast)] hover:text-sidebar-foreground"
            >
              <Search aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">{t("nav.scanOrSearch")}</span>
              <kbd className="shrink-0 rounded-full border border-sidebar-border px-1.5 py-0.5 font-sans text-[12px] font-medium text-sidebar-muted">
                {paletteShortcutLabel()}
              </kbd>
            </button>
            {onScan ? <ScanButton onScan={onScan} label={t("nav.scan")} compact /> : null}
          </div>
        ) : null}

        <ul className="m-0 flex list-none flex-col gap-1 px-2 py-1 lg:gap-0.5 lg:px-3">
          {primary.map((item, i) => (
            <FragmentWithScan key={item.key} showScan={!!onScan && i === scanAt} onScan={onScan} label={t("nav.scan")}>
              <li>
                <NavLink item={item} pathname={pathname} variant={variant} label={t(item.labelKey)} />
              </li>
            </FragmentWithScan>
          ))}
        </ul>

        {more.length ? (
          <div className="flex flex-col pt-2 pb-3">
            <div aria-hidden="true" className="mx-5 my-2 h-px bg-sidebar-border lg:hidden" />
            <p id={moreLabelId} className="m-0 hidden px-6 pt-3 pb-1.5 text-[13px] font-medium text-sidebar-muted lg:block">
              {t("nav.more")}
            </p>
            <ul aria-labelledby={moreLabelId} className="m-0 flex list-none flex-col gap-1 px-2 lg:gap-0.5 lg:px-3">
              {more.map((item) => (
                <li key={item.key}>
                  <NavLink item={item} pathname={pathname} variant={variant} label={t(item.labelKey)} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-2 py-3 lg:px-3">
        <div className="flex justify-center lg:hidden">
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label={t("nav.openAccount")}
            title={t("nav.openAccount")}
            className="flex size-14 items-center justify-center rounded-full transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-accent"
          >
            <AvatarFromMe />
          </button>
        </div>
        <div className="hidden lg:block">
          <AccountMenu variant={variant} />
        </div>
      </div>
    </div>
  );
}

function AvatarFromMe() {
  const { data: me } = useMe();
  return <Avatar name={me?.user.name} className="bg-sidebar-foreground text-sidebar" />;
}

function FragmentWithScan({
  showScan,
  onScan,
  label,
  children,
}: {
  showScan: boolean;
  onScan?: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      {showScan && onScan ? (
        <li className="lg:hidden">
          <ScanButton onScan={onScan} label={label} />
        </li>
      ) : null}
      {children}
    </>
  );
}

function ScanButton({ onScan, label, compact }: { onScan(): void; label: string; compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onScan}
        aria-label={label}
        title={label}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(160deg,var(--tone-green-from),var(--tone-green-to))] text-tone-green-on shadow-button transition-[scale] duration-[var(--dur-fast)] active:scale-[0.95]"
      >
        <ScanLine aria-hidden="true" className="size-5" strokeWidth={2} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onScan}
      className="flex w-full min-w-0 flex-col items-center gap-1 rounded-card py-2 text-[11px] font-semibold text-sidebar-foreground transition-[scale] duration-[var(--dur-fast)] active:scale-[0.97]"
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(160deg,var(--tone-green-from),var(--tone-green-to))] text-tone-green-on shadow-button"
      >
        <ScanLine className="size-[22px]" strokeWidth={2} />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function NavLink({
  item,
  pathname,
  variant,
  label,
}: {
  item: NavItem;
  pathname: string;
  variant: ShellVariant;
  label: string;
}) {
  const active = isItemActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.to as never}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 rounded-card px-1 py-2 text-[11px] font-medium no-underline transition-[background-color,color,scale] duration-[var(--dur-fast)] active:scale-[0.97]",
        "lg:h-11 lg:flex-row lg:gap-3 lg:rounded-full lg:px-3.5 lg:py-0 lg:text-[15px]",
        active
          ? variant === "godseye"
            ? "bg-[linear-gradient(160deg,var(--tone-violet-from),var(--tone-violet-to))] font-semibold text-tone-violet-on"
            : "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
          : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-[22px] shrink-0 lg:size-5" strokeWidth={2} />
      <span className="max-w-full min-w-0 truncate lg:flex-1">{label}</span>
    </Link>
  );
}
