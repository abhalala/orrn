import { LOCALE_NAMES, LOCALES, isLocale, useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Eye, LogOut } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { useTheme } from "@/shared/components/theme-provider";
import { useMe, type Me } from "@/shared/lib/me";
import { signOutAndReset } from "@/shared/lib/sign-out";

import { LanguageToggle } from "./language-toggle";
import type { NavItem } from "./nav-items";
import { navTarget } from "./route-compat";

export type ShellVariant = "tenant" | "godseye";

type ThemeChoice = "system" | "light" | "dark";
const THEMES: readonly { value: ThemeChoice; labelKey: MessageKey }[] = [
  { value: "system", labelKey: "common.themeSystem" },
  { value: "light", labelKey: "common.themeLight" },
  { value: "dark", labelKey: "common.themeDark" },
];

function toThemeChoice(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** Up to two initials from a display name ("Local Owner" → "LO"). */
export function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts.slice(0, 1);
  return letters.map((p) => Array.from(p)[0]!.toUpperCase()).join("") || "?";
}

/** Who and where: company and role for tenants, platform role for Godseye. */
function useIdentity(variant: ShellVariant) {
  const { t } = useT();
  const { data: me } = useMe();
  const roleKey = me?.company?.role ? (`roles.${me.company.role}` as MessageKey) : null;
  const place = variant === "godseye" ? t("nav.godseye") : (me?.company?.name ?? "");
  const role =
    variant === "godseye"
      ? me?.platformRole
        ? sentenceCase(me.platformRole.replace(/_/g, " "))
        : null
      : roleKey
        ? t(roleKey)
        : null;
  return { me, place, role };
}

function sentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function Avatar({ name, className }: { name: string | undefined; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold tracking-[0.01em] text-primary-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function useSignOut() {
  const navigate = useNavigate();
  return () => void signOutAndReset(() => void navigate({ to: "/" }));
}

function showGodseyeLink(me: Me | undefined, variant: ShellVariant) {
  return variant === "tenant" && !!me?.isPlatformAdmin && !!me.platformRole;
}

/**
 * The avatar's sheet on phones (title "More": the office pages, then
 * language, theme and sign out) and on the iPad rail (account only, the rail
 * already lists the pages).
 */
export function MoreSheet({
  open,
  onOpenChange,
  variant,
  items,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  variant: ShellVariant;
  items: readonly NavItem[];
}) {
  const { t } = useT();
  const { me, place, role } = useIdentity(variant);
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();
  const close = () => onOpenChange(false);
  const godseye = showGodseyeLink(me, variant);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={items.length ? t("nav.more") : t("nav.account")}>
      <div className="flex flex-col gap-6 pt-1">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={me?.user.name} className="size-12 text-[16px]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[17px] font-semibold" title={me?.user.name}>
              {me?.user.name}
            </span>
            <span className="truncate text-[14px] text-muted-foreground" title={me?.user.email}>
              {me?.user.email}
            </span>
            <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[14px]">
              <span className="min-w-0 truncate font-medium" title={place}>
                {place}
              </span>
              {role ? <span className="shrink-0 text-muted-foreground">· {role}</span> : null}
            </span>
          </div>
        </div>

        {items.length || godseye ? (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border p-0">
            {items.map((item) => (
              <li key={item.key} className="border-b border-border last:border-b-0">
                <SheetRow to={navTarget(item.to)} icon={<item.icon className="size-5" strokeWidth={2} />} onClick={close}>
                  {t(item.labelKey)}
                </SheetRow>
              </li>
            ))}
            {godseye ? (
              <li className="border-b border-border last:border-b-0">
                <SheetRow to="/admin" icon={<Eye className="size-5" strokeWidth={2} />} onClick={close}>
                  {t("nav.godseye")}
                </SheetRow>
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="m-0 text-[14px] font-semibold">{t("common.language")}</p>
          <LanguageToggle className="sm:w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[14px] font-semibold">{t("common.theme")}</p>
          <SegmentedControl<ThemeChoice>
            label={t("common.theme")}
            value={toThemeChoice(theme)}
            options={THEMES.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={setTheme}
            className="sm:w-full"
          />
        </div>

        <Button variant="secondary" className="w-full" onClick={signOut}>
          <LogOut aria-hidden="true" strokeWidth={2} />
          {t("nav.signOut")}
        </Button>
      </div>
    </Sheet>
  );
}

function SheetRow({
  to,
  icon,
  children,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <Link
      to={to as never}
      onClick={onClick}
      className="flex min-h-14 min-w-0 items-center gap-3 px-4 text-[16px] font-medium text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent active:bg-accent"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground dark:bg-background"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
    </Link>
  );
}

/** Sidebar footer from 1024px: who you are, opening language, theme and sign out. */
export function AccountMenu({ variant }: { variant: ShellVariant }) {
  const { t, locale, setLocale } = useT();
  const { me, place, role } = useIdentity(variant);
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AccountTrigger name={me?.user.name} place={place} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-60">
        <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5 py-2">
          <span className="truncate text-[13px] text-muted-foreground" title={me?.user.email}>
            {t("nav.signedInAs", { email: me?.user.email ?? "" })}
          </span>
          {role ? <span className="truncate text-[13px] font-semibold text-foreground">{role}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("common.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(v) => {
            if (isLocale(v)) setLocale(v);
          }}
        >
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("common.theme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={toThemeChoice(theme)} onValueChange={setTheme}>
          {THEMES.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {t(o.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {showGodseyeLink(me, variant) ? (
          <DropdownMenuItem onSelect={() => void navigate({ to: "/admin" })}>
            <Eye aria-hidden="true" strokeWidth={2} />
            {t("nav.godseye")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden="true" strokeWidth={2} />
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AccountTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & { name: string | undefined; place: string }
>(function AccountTrigger({ name, place, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-full px-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
        className,
      )}
    >
      <Avatar name={name} className="bg-sidebar-foreground text-sidebar" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-semibold text-sidebar-foreground" title={name}>
          {name}
        </span>
        <span className="truncate text-[13px] text-sidebar-muted" title={place}>
          {place}
        </span>
      </span>
    </button>
  );
});
