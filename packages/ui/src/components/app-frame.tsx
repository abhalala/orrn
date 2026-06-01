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
    <div className="orrn-status-bar flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card px-4">
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
      className="flex w-full max-w-screen flex-col overflow-hidden bg-background"
      style={{ height: "100svh" }}
    >
      {banner}
      <div className="flex w-full flex-1 overflow-hidden min-h-0">
        {sidebar ? <div className="orrn-desktop-nav h-full">{sidebar}</div> : null}
        <div className="flex min-w-0 max-w-full flex-1 flex-col">
          {statusBar}
          <div className="orrn-page-scroll min-w-0 flex-1 overflow-auto w-full">
            <div
              className="orrn-app-content mx-auto flex w-full min-w-0 flex-col gap-4 px-4 py-5"
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
          </div>
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
    <div className="flex min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-4 duration-300 ease-out">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {eyebrow ? (
            <p className="m-0 text-[11px] uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1 className="orrn-page-title m-0 text-2xl font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="orrn-page-description m-0 max-w-[680px] text-sm text-muted-foreground">
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
    <div
      className="orrn-mobile-nav hidden flex-shrink-0 items-stretch gap-1 overflow-x-auto border-t border-border bg-card px-2 pb-2.5 pt-2"
      style={{ zIndex: 20 }}
    >
      {visible.map((item) => {
        const content = (
          <div
            key={item.key}
            onClick={item.onPress}
            className={cn(
              "orrn-mobile-nav-item flex min-w-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-1.5",
              item.active ? "bg-accent" : "",
            )}
          >
            {item.icon ? (
              <span className={cn(item.active ? "text-primary" : "text-muted-foreground")}>{item.icon}</span>
            ) : null}
            <span
              className={cn(
                "text-[10px]",
                item.active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </div>
        );
        if (!item.href) return content;
        return (
          <a key={item.key} href={item.href} className="no-underline">
            {content}
          </a>
        );
      })}
    </div>
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
