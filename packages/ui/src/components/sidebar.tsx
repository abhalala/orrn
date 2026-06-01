import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SidebarProps = {
  brand: ReactNode;
  children: ReactNode;
  storageKey?: string;
  footer?: ReactNode;
};

const COLLAPSED_WIDTH = 64;
const EXPANDED_WIDTH = 240;

type SidebarContextValue = { collapsed: boolean; toggle: () => void };
const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, toggle: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export function Sidebar({ brand, children, storageKey = "orrn:sidebar:v1", footer }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return false;
      return stored === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }, [collapsed, storageKey]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed((v) => !v) }}>
      <aside
        style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
        className="flex h-full flex-col gap-4 overflow-hidden border-r border-border bg-card py-4 transition-[width] duration-200 ease-out"
      >
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {brand}
        </div>
        <div className={cn("flex flex-1 flex-col gap-1 overflow-y-auto", collapsed ? "px-2" : "px-2")}>{children}</div>
        {footer ? (
          <div className={cn("flex flex-col gap-2", collapsed ? "px-2" : "px-3")}>{footer}</div>
        ) : null}
        <div className={cn("flex items-center", collapsed ? "justify-center px-2" : "justify-end px-3")}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {collapsed ? "›" : "‹ Collapse"}
          </button>
        </div>
      </aside>
    </SidebarContext.Provider>
  );
}

export type SidebarSectionProps = {
  label?: ReactNode;
  children: ReactNode;
};

export function SidebarSection({ label, children }: SidebarSectionProps) {
  const { collapsed } = useSidebar();
  return (
    <div className="flex flex-col gap-0.5">
      {label && !collapsed ? (
        <p className="m-0 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export type SidebarItemProps = {
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
};

export function SidebarItem({ active, icon, children, onPress, testID }: SidebarItemProps) {
  const { collapsed } = useSidebar();
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onPress}
      className={cn(
        "flex w-full items-center rounded-md border-l-[3px] py-2 text-left transition-colors",
        collapsed ? "justify-center px-0 gap-0" : "justify-start gap-2.5 px-2.5",
        active ? "border-primary bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/40",
      )}
    >
      {icon ? (
        <span className={cn("flex w-5 shrink-0 items-center justify-center", active ? "text-primary" : "text-muted-foreground")}>
          {icon}
        </span>
      ) : null}
      {!collapsed ? (
        <span className={cn("min-w-0 truncate text-sm", active ? "font-semibold" : "font-medium")}>{children}</span>
      ) : null}
    </button>
  );
}
