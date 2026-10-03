import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";

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
      className="flex w-full max-w-screen flex-col overflow-hidden bg-background text-foreground"
      style={{ height: "100dvh" }}
    >
      {banner}
      <div className="flex w-full flex-1 overflow-hidden min-h-0">
        {sidebar ? <div className="orrn-desktop-nav h-full">{sidebar}</div> : null}
        <div className="flex min-w-0 max-w-full flex-1 flex-col">
          {statusBar}
          <main id="main" className="orrn-page-scroll min-w-0 flex-1 overflow-auto w-full">
            <div
              className="orrn-app-content mx-auto flex w-full min-w-0 flex-col gap-5 px-6 py-7"
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
          <h1 className="orrn-page-title m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground">
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
    <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
  );
}

export function MobileNav({ items }: { items: readonly AppFrameNavItem[] }) {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Main"
      className="orrn-mobile-nav hidden flex-shrink-0 items-stretch gap-1.5 overflow-x-auto border-t border-border bg-card/92 px-3 pb-2.5 pt-2 backdrop-blur-md"
      style={{ zIndex: 20 }}
    >
      {visible.map((item) => {
        const content = (
          <div
            key={item.key}
            onClick={item.onPress}
            // When wrapped in an <a> (href set) the link carries aria-current.
            aria-current={!item.href && item.active ? "page" : undefined}
            className={cn(
              "orrn-mobile-nav-item relative flex min-h-14 min-w-[56px] cursor-pointer flex-col items-center justify-center gap-1 rounded-card px-2 py-1.5 transition-[background-color,color,transform] duration-[var(--dur-fast)] active:scale-[0.97]",
              item.active ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-accent",
            )}
          >
            {item.icon ? (
              <span aria-hidden="true" className="[&_svg]:size-5">
                {item.icon}
              </span>
            ) : null}
            <span className={cn("text-[11px] leading-none", item.active ? "font-semibold" : "font-medium")}>
              {item.label}
            </span>
          </div>
        );
        if (!item.href) return content;
        return (
          <a
            key={item.key}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className="rounded-card no-underline"
          >
            {content}
          </a>
        );
      })}
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
