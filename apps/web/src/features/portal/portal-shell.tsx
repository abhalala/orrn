import { I18nProvider, isLocale, useT, type Locale, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ClipboardList, Cylinder, House, LogOut, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { LanguageToggle } from "@/shell/language-toggle";
import { SkipLink } from "@/shell/skip-link";
import { readStoredLocaleOrNull, storeLocale } from "@/shared/lib/locale";
import { storePortalPlant } from "@/shared/lib/portal-plant";
import { signOutAndReset } from "@/shared/lib/sign-out";
import { dropTenantQueries } from "@/shared/lib/tenant-cache";
import { queryClient } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { portalLocale } from "./model";

type NavEntry = { key: string; to: string; label: MessageKey; icon: LucideIcon; exact?: boolean };

const NAV: readonly NavEntry[] = [
  { key: "today", to: "/portal", label: "portal.nav.today", icon: House, exact: true },
  { key: "orders", to: "/portal/orders", label: "portal.nav.orders", icon: ClipboardList },
  { key: "dies", to: "/portal/dies", label: "portal.nav.dies", icon: Cylinder },
  { key: "dispatches", to: "/portal/dispatches", label: "portal.nav.dispatches", icon: Truck },
];

function isActive(entry: NavEntry, pathname: string) {
  if (entry.exact) return pathname === entry.to || pathname === `${entry.to}/`;
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`);
}

/**
 * The party's own frame (FP-PF-01): no plant navigation, no scan, no search. A phone gets the bottom
 * tabs, wider screens the same four links in the header. The language is the person's saved choice,
 * else the one the plant set for its parties (`portal.me.locale`); the choice is saved on this device
 * only when they make it.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const root = useT();
  const me = usePortalMe();
  const [chosen, setChosen] = useState<Locale | null>(() => readStoredLocaleOrNull());
  const plantLocale = me.data && isLocale(me.data.locale) ? me.data.locale : null;
  const locale = portalLocale(chosen, plantLocale, root.locale);
  return (
    <I18nProvider
      locale={locale}
      onLocaleChange={(next) => {
        storeLocale(next);
        setChosen(next);
      }}
    >
      <ShellFrame>{children}</ShellFrame>
    </I18nProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { t, locale } = useT();
  const me = usePortalMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <div data-slot="portal-shell" className="min-h-[100dvh] bg-background text-foreground [--shell-tabbar-offset:calc(73px+env(safe-area-inset-bottom))] md:[--shell-tabbar-offset:0px]">
      <SkipLink />
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl print:hidden">
        <header data-shell-chrome="" className="mx-auto flex h-14 w-full max-w-[1040px] min-w-0 items-center gap-3 px-4 md:px-6">
          <Link to={"/portal" as never} aria-label={t("portal.nav.today")} className="flex size-11 shrink-0 items-center justify-center rounded-full no-underline">
            <span aria-hidden="true" className="orrn-mark flex size-7 items-center justify-center text-white" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate font-display text-[17px] leading-tight font-bold tracking-[-0.02em]" title={me.data?.company.name}>
              {me.data?.company.name ?? t("portal.title")}
            </p>
            {me.data ? (
              <p className="m-0 truncate text-[13px] leading-4 text-muted-foreground" title={me.data.customer.name}>
                {t("portal.signedInAs", { party: me.data.customer.name })}
              </p>
            ) : null}
          </div>
          <nav aria-label={t("portal.nav.label")} className="hidden items-center gap-1 md:flex">
            {NAV.map((entry) => {
              const active = isActive(entry, pathname);
              return (
                <Link
                  key={entry.key}
                  to={entry.to as never}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full px-4 text-[15px] no-underline transition-colors duration-[var(--dur-fast)]",
                    active ? "bg-surface-sunken font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t(entry.label)}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label={t("portal.account.open")}
            aria-haspopup="dialog"
            className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-[scale] duration-[var(--dur-fast)] active:scale-[0.95]"
          >
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
              {Array.from(me.data?.customer.name ?? "?")[0]?.toUpperCase()}
            </span>
          </button>
        </header>
      </div>

      <main id="main" tabIndex={-1} className="outline-none">
        <div className="mx-auto flex w-full max-w-[1040px] min-w-0 flex-col gap-5 px-4 pt-4 pb-[calc(var(--shell-tabbar-offset)+32px)] md:px-6 md:pt-7 md:pb-12">{children}</div>
      </main>

      <nav
        aria-label={t("portal.nav.tabs")}
        data-slot="tab-bar"
        data-shell-chrome=""
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden print:hidden"
      >
        <ul className="m-0 grid h-[72px] list-none grid-cols-4 gap-1 px-2 pt-1 pb-1.5">
          {NAV.map((entry) => {
            const active = isActive(entry, pathname);
            const Icon = entry.icon;
            return (
              <li key={entry.key} className="min-w-0">
                <Link
                  to={entry.to as never}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-[62px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-card pt-1.5 pb-1 no-underline transition-[color,scale] duration-[var(--dur-fast)] active:scale-[0.97]",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span aria-hidden="true" className={cn("flex h-8 w-14 items-center justify-center rounded-full", active && "bg-surface-sunken")}>
                    <Icon className="size-[22px]" strokeWidth={2} />
                  </span>
                  <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-4", active ? "font-semibold" : "font-medium")}>{t(entry.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}

function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const me = usePortalMe();
  const navigate = useNavigate();
  const plants = me.data?.plants ?? [];

  function switchPlant(companyId: string) {
    storePortalPlant(companyId);
    dropTenantQueries(queryClient);
    onOpenChange(false);
    void navigate({ to: "/portal" as never, replace: true });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("portal.account.title")} description={me.data?.user.email}>
      <div className="flex min-w-0 flex-col gap-5 pb-4">
        {me.data ? (
          <p className="m-0 text-[15px] leading-6">
            {t("portal.signedInAs", { party: me.data.customer.name })}
            <span className="block text-[13px] text-muted-foreground">{me.data.company.name}</span>
          </p>
        ) : null}
        {plants.length > 1 ? (
          <Field id="portal-plant" label={t("portal.switchPlant")}>
            <NativeSelect id="portal-plant" value={me.data?.company.id} onChange={(e) => switchPlant(e.target.value)} data-testid="portal-plant">
              {plants.map((p) => (
                <option key={p.companyId} value={p.companyId}>
                  {p.companyName}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">{t("common.language")}</span>
          <LanguageToggle />
        </div>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => void signOutAndReset(() => void navigate({ to: "/login" }))}
        >
          <LogOut aria-hidden="true" strokeWidth={2} />
          {t("auth.signOut")}
        </Button>
      </div>
    </Sheet>
  );
}
