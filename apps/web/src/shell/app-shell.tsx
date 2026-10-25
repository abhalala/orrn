import { useT } from "@orrn/i18n";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { OutboxSessionGuard } from "@/features/press/outbox-session-guard";
import { useScan } from "@/features/scan/scan-context";
import { ImpersonationBanner } from "@/shared/components/impersonation-banner";
import { useMe } from "@/shared/lib/me";

import { CommandPaletteProvider } from "./command-palette";
import { Avatar, MoreSheet, type ShellVariant } from "./more-menu";
import { GODSEYE_MORE, GODSEYE_NAV, TENANT_MORE, TENANT_PRIMARY, visibleItems } from "./nav-items";
import { PlantSwitcher } from "./plant-switcher";
import { switcherPlants } from "./plant-switcher-model";
import { SideNav } from "./side-nav";
import { SkipLink } from "./skip-link";
import { TabBar } from "./tab-bar";

export type AppShellProps = {
  variant: ShellVariant;
  children: ReactNode;
};

/**
 * The signed-in app frame for companies (`tenant`) and for orrn staff
 * (`godseye`, violet). Phones get a slim top bar and the bottom tab bar;
 * iPad portrait an icon rail; from 1024px a sidebar. The page scrolls the
 * document (not an inner box), so mobile browser chrome collapses naturally.
 *
 * Landmarks: skip link, `header` (phone top bar), one `nav` labelled "Main",
 * `main#main`. After a route change focus moves to the new page's `h1`.
 */
export function AppShell(props: AppShellProps) {
  if (props.variant === "tenant") {
    return (
      <CommandPaletteProvider>
        <ShellFrame {...props} />
      </CommandPaletteProvider>
    );
  }
  return <ShellFrame {...props} />;
}

function ShellFrame({ variant, children }: AppShellProps) {
  const { t } = useT();
  const { data: me } = useMe();
  const scan = useScan();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const tablet = useMediaQuery(breakpoints.tablet);

  const godseye = variant === "godseye";
  const primary = visibleItems(godseye ? GODSEYE_NAV : TENANT_PRIMARY, me);
  const more = visibleItems(godseye ? GODSEYE_MORE : TENANT_MORE, me);
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  const scanOn = !godseye && scan.available && (modules.length === 0 || modules.includes("bundles"));
  const openScan = scanOn ? () => scan.open({ kind: "lookup" }) : undefined;

  // Portalled sheets and menus live outside this tree; give them the violet tone too.
  useLayoutEffect(() => {
    if (!godseye) return;
    document.documentElement.classList.add("godseye");
    return () => document.documentElement.classList.remove("godseye");
  }, [godseye]);

  useFocusHeadingOnRouteChange();
  const scrolled = useScrolledPastTop();

  return (
    <div
      data-slot="app-shell"
      data-variant={variant}
      className={cn(
        "min-h-[100dvh] bg-background text-foreground md:grid md:grid-cols-[auto_minmax(0,1fr)]",
        // Sticky bottom bars inside screens use `bottom: var(--shell-tabbar-offset)` to sit above the phone tab bar.
        "[--shell-tabbar-offset:calc(73px+env(safe-area-inset-bottom))] md:[--shell-tabbar-offset:0px]",
        godseye && "godseye",
      )}
    >
      <SkipLink />
      <OutboxSessionGuard />

      <SideNav
        variant={variant}
        primary={primary}
        more={more}
        pathname={pathname}
        onScan={openScan}
        onOpenAccount={() => setMoreOpen(true)}
      />

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30">
          {me?.impersonation ? <ImpersonationBanner /> : null}
          <header
            data-shell-chrome=""
            className={cn(
              "flex h-14 min-w-0 items-center gap-3 border-b px-4 backdrop-blur-xl backdrop-saturate-150 transition-colors duration-[var(--dur-base)] md:hidden",
              "box-content pt-[env(safe-area-inset-top)]",
              scrolled ? "border-border bg-background/85" : "border-transparent bg-background",
            )}
          >
            <Link
              to={(godseye ? "/admin" : "/today") as never}
              aria-label={godseye ? t("nav.godseyeHome") : t("nav.home")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <span aria-hidden="true" className="orrn-mark flex size-7 items-center justify-center text-white">
                {godseye ? <Eye className="size-3.5" strokeWidth={2} /> : null}
              </span>
            </Link>
            {!godseye && switcherPlants(me) ? (
              <PlantSwitcher variant="header" />
            ) : (
              <p
                className="m-0 min-w-0 flex-1 truncate font-display text-[17px] font-bold tracking-[-0.02em]"
                title={godseye ? t("nav.godseye") : me?.company?.name}
              >
                {godseye ? t("nav.godseye") : me?.company?.name}
              </p>
            )}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label={t("nav.openAccount")}
              aria-haspopup="dialog"
              className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-[scale] duration-[var(--dur-fast)] active:scale-[0.95]"
            >
              <Avatar name={me?.user.name} />
            </button>
          </header>
        </div>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div
            className={cn(
              "mx-auto flex w-full min-w-0 flex-col gap-5 px-4 pt-4 md:px-6 md:pt-7 md:pb-12 lg:px-8 lg:pt-8",
              "pb-[calc(var(--shell-tabbar-offset)+32px)]",
              godseye ? "max-w-[1200px]" : "max-w-[1100px]",
            )}
            style={{ viewTransitionName: "page-content" }}
          >
            {children}
          </div>
        </main>
      </div>

      <TabBar
        items={primary}
        pathname={pathname}
        variant={variant}
        onScan={openScan}
        onMore={more.length ? () => setMoreOpen(true) : undefined}
      />

      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        variant={variant}
        // The phone sheet carries the office pages; on the rail they're already listed.
        items={tablet ? [] : more}
      />
    </div>
  );
}

/** Whether the page has scrolled under the phone top bar (an IntersectionObserver on a sentinel, no scroll listener). */
function useScrolledPastTop(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:8px;pointer-events:none;";
    document.body.insertBefore(sentinel, document.body.firstChild);
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    io.observe(sentinel);
    return () => {
      io.disconnect();
      sentinel.remove();
    };
  }, []);
  return scrolled;
}

/**
 * After a client-side navigation, move focus to the new page's `h1` (or to
 * `main` if the page has none yet), so screen reader and keyboard users start
 * at the top of the new content. Pages that render their heading after data
 * loads get up to 2 s. Never steals focus the person has already moved.
 */
function useFocusHeadingOnRouteChange() {
  const resolvedPath = useRouterState({ select: (s) => s.resolvedLocation?.pathname });
  const first = useRef(true);

  useEffect(() => {
    if (!resolvedPath) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const main = document.getElementById("main");
    if (!main) return;
    const startedOn = document.activeElement;

    // Someone moved focus on purpose (typed in a field, opened a sheet): leave it.
    const userMovedFocus = () => {
      const active = document.activeElement;
      return !!active && active !== startedOn && active !== document.body && active !== main;
    };

    const focusHeading = () => {
      if (userMovedFocus()) return true;
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.dataset.routeFocus = "";
      heading.focus({ preventScroll: true });
      return true;
    };

    if (focusHeading()) return;
    let timeout = 0;
    const observer = new MutationObserver(() => {
      if (!focusHeading()) return;
      observer.disconnect();
      window.clearTimeout(timeout);
    });
    observer.observe(main, { childList: true, subtree: true });
    // No heading after 2 s: focus main itself, unless the person has moved on.
    timeout = window.setTimeout(() => {
      observer.disconnect();
      if (!userMovedFocus()) main.focus({ preventScroll: true });
    }, 2000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [resolvedPath]);
}
