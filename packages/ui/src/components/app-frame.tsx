import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";
import { Sheet } from "./sheet";

export type AppFrameNavItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  href?: string;
  onPress?: () => void;
  hidden?: boolean;
};

export type AppStatusBarProps = {
  brand?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  navToggle?: ReactNode;
};

export function AppStatusBar({ brand, context, actions, navToggle }: AppStatusBarProps) {
  return (
    <div className="orrn-status-bar flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-5 backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {navToggle}
        {brand}
        {context ? <div className="flex min-w-0 flex-1 items-center gap-2">{context}</div> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type AppFrameProps = {
  children: ReactNode;
  sidebar?: ReactNode;
  statusBar?: ReactNode;
  mobileNav?: ReactNode;
  banner?: ReactNode;
  maxWidth?: number | string;
};

export function AppFrame({
  children,
  sidebar,
  statusBar,
  mobileNav,
  banner,
  maxWidth = 1180,
}: AppFrameProps) {
  return (
    <div
      // `overflow-clip` (not hidden) so focus/scrollIntoView can never scroll
      // the chrome sideways; the page scrolls vertically inside <main> only.
      className="relative flex w-full max-w-screen flex-col overflow-clip bg-background text-foreground"
      style={{ height: "100dvh" }}
    >
      {banner}
      <div data-shell-row="" className="flex min-h-0 w-full flex-1 overflow-clip">
        {sidebar ? <div className="orrn-desktop-nav h-full shrink-0">{sidebar}</div> : null}
        {/* min-w-0 + basis-0: the column takes the space left by the sidebar
            and never grows to fit its content. */}
        <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col">
          {statusBar}
          <main
            id="main"
            // Focusable so keyboard users can scroll a page with no controls.
            tabIndex={0}
            className="orrn-page-scroll relative min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-offset-[-2px]"
          >
            <div
              // Content can never widen the page: the column is min-w-0
              // and anything wider than it is clipped here (and caught by the
              // layout guards in apps/web/tests/visual/layout-guards.ts).
              className="orrn-app-content mx-auto flex w-full min-w-0 flex-col gap-5 overflow-x-clip px-6 py-7"
              style={{
                maxWidth,
                paddingBottom: mobileNav ? 84 : 24,
                /**
                 * Scope the View Transitions API cross-fade to just the
                 * page-content region. The sidebar and status bar are
                 * persistent chrome — fading them on every route change
                 * feels like the whole app is repainting. See
                 * `::view-transition-*(page-content)` rules in globals.css.
                 */
                viewTransitionName: "page-content",
              }}
            >
              {children}
            </div>
          </main>
          {mobileNav}
        </div>
      </div>
    </div>
  );
}

export type PageScaffoldProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageScaffold({
  title,
  description,
  eyebrow,
  actions,
  children,
}: PageScaffoldProps) {
  return (
    <div className="flex min-w-0 animate-in fade-in-0 slide-in-from-bottom-2 flex-col gap-5 duration-500 ease-[var(--ease-rise)]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5">
          {eyebrow ? (
            <p className="m-0 text-[13px] font-medium text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1 className="orrn-page-title m-0 min-w-0 break-words font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="orrn-page-description m-0 max-w-[680px] text-[15px] leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <PageActions>{actions}</PageActions> : null}
      </div>
      {children}
    </div>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="page-actions"
      className={cn(
        // Phones: full-width grid under the title; pairs sit side by side and
        // an odd last action (the primary, by convention) spans the row.
        "grid w-full grid-cols-2 gap-2 [&>*]:min-w-0 [&>*:nth-child(odd):last-child]:col-span-2 [&_[data-slot=button]]:w-full [&>a:not([data-slot=button])]:block",
        // From sm: a right-aligned wrapping row of pills.
        "sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:[&_[data-slot=button]]:w-auto",
      )}
    >
      {children}
    </div>
  );
}

export type MobileNavProps = {
  items: readonly AppFrameNavItem[];
  /**
   * Most tabs shown in the bar. When there are more items, the bar shows
   * `maxItems - 1` of them plus a "More" tab that opens a sheet with the rest.
   */
  maxItems?: number;
  moreLabel?: string;
  /**
   * Render a client-side link (e.g. a TanStack Router `Link`) for items with
   * an `href`, so tab switches don't reload the page. Defaults to `<a>`.
   */
  renderLink?: (args: {
    item: AppFrameNavItem;
    className: string;
    children: ReactNode;
    onNavigate?: () => void;
  }) => ReactNode;
};

function defaultRenderLink({
  item,
  className,
  children,
  onNavigate,
}: Parameters<NonNullable<MobileNavProps["renderLink"]>>[0]) {
  return (
    <a
      key={item.key}
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={className}
      onClick={onNavigate}
    >
      {children}
    </a>
  );
}

const TAB_CLASS =
  "orrn-mobile-nav-item relative flex min-h-14 min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-card px-1 py-1.5 no-underline transition-[background-color,color,transform] duration-[var(--dur-fast)] active:scale-[0.97]";

function tabTone(active?: boolean) {
  return active ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-accent";
}

function TabContent({ item, active }: { item: Pick<AppFrameNavItem, "icon" | "label">; active?: boolean }) {
  return (
    <>
      {item.icon ? (
        <span aria-hidden="true" className="[&_svg]:size-5">
          {item.icon}
        </span>
      ) : null}
      <span
        className={cn(
          "block max-w-full truncate text-[11px] leading-none",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
    </>
  );
}

/**
 * Phone tab bar: at most `maxItems` (5) labelled 56px tabs above the home
 * indicator. Extra destinations live behind "More", a bottom sheet of
 * full-width rows.
 */
export function MobileNav({ items, maxItems = 5, moreLabel = "More", renderLink = defaultRenderLink }: MobileNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;

  const overflow = visible.length > maxItems;
  const primary = overflow ? visible.slice(0, maxItems - 1) : visible;
  const rest = overflow ? visible.slice(maxItems - 1) : [];
  const restActive = rest.some((item) => item.active);

  const renderTab = (item: AppFrameNavItem) => {
    if (!item.href) {
      return (
        <button
          key={item.key}
          type="button"
          onClick={item.onPress}
          aria-current={item.active ? "page" : undefined}
          className={cn(TAB_CLASS, tabTone(item.active))}
        >
          <TabContent item={item} active={item.active} />
        </button>
      );
    }
    return renderLink({
      item,
      className: cn(TAB_CLASS, tabTone(item.active)),
      children: <TabContent item={item} active={item.active} />,
    });
  };

  return (
    <nav
      aria-label="Main"
      className="orrn-mobile-nav hidden flex-shrink-0 items-stretch gap-1 border-t border-border bg-card/92 px-2 pb-2.5 pt-2 backdrop-blur-md"
      style={{ zIndex: 20 }}
    >
      {primary.map(renderTab)}
      {overflow ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(TAB_CLASS, tabTone(restActive))}
        >
          <TabContent item={{ icon: <MoreHorizontal />, label: moreLabel }} active={restActive} />
        </button>
      ) : null}
      {overflow ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} snapPoints={[70]} title={moreLabel}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pb-1">
            {rest.map((item) => {
              const rowClass = cn(
                "flex min-h-14 w-full items-center gap-3 rounded-card px-4 text-left text-[15px] no-underline transition-colors duration-[var(--dur-fast)]",
                item.active
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "font-medium text-foreground hover:bg-accent active:bg-accent",
              );
              const content = (
                <>
                  {item.icon ? (
                    <span aria-hidden="true" className="flex w-6 shrink-0 justify-center [&_svg]:size-5">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </>
              );
              return (
                <li key={item.key}>
                  {item.href ? (
                    renderLink({
                      item,
                      className: rowClass,
                      children: content,
                      onNavigate: () => setMoreOpen(false),
                    })
                  ) : (
                    <button
                      type="button"
                      className={rowClass}
                      aria-current={item.active ? "page" : undefined}
                      onClick={() => {
                        setMoreOpen(false);
                        item.onPress?.();
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Sheet>
      ) : null}
    </nav>
  );
}

export function ActionMenu({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function ConfirmAction({
  label,
  message,
  onConfirm,
  variant = "destructive",
  disabled,
}: {
  label: ReactNode;
  message: string;
  onConfirm: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      onPress={() => {
        if (typeof window === "undefined" || window.confirm(message)) {
          onConfirm();
        }
      }}
    >
      {label}
    </Button>
  );
}
