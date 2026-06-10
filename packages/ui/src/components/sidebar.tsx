import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SidebarProps = {
  brand: ReactNode;
  children: ReactNode;
  storageKey?: string;
  footer?: ReactNode;
};

const COLLAPSED_WIDTH = 64;
const EXPANDED_WIDTH = 248;

/**
 * Tablet range (768–1099px): the sidebar is forced into the collapsed icon
 * rail so content keeps room. The user's expand/collapse preference only
 * applies on desktop (>=1100px). Mobile (<768px) hides the sidebar entirely
 * (`.orrn-desktop-nav` media rule) in favor of the bottom MobileNav.
 */
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1099px)";

type SidebarContextValue = { collapsed: boolean; toggle: () => void };
const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, toggle: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

function useIsTablet(): boolean {
  const [isTablet, setIsTablet] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TABLET_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY);
    const onChange = () => setIsTablet(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isTablet;
}

export function Sidebar({ brand, children, storageKey = "orrn:sidebar:v1", footer }: SidebarProps) {
  const isTablet = useIsTablet();
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return false;
      return stored === "1";
    } catch {
      return false;
    }
  });

  const collapsed = isTablet || userCollapsed;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, userCollapsed ? "1" : "0");
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }, [userCollapsed, storageKey]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setUserCollapsed((v) => !v) }}>
      <aside
        style={{
          width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
          transitionTimingFunction: "var(--ease-spring)",
          transitionDuration: "var(--dur-base)",
        }}
        className="flex h-full flex-col gap-4 overflow-hidden border-r border-border bg-sidebar py-4 transition-[width]"
      >
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {brand}
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-2">{children}</div>
        {footer ? (
          <div className={cn("flex flex-col gap-2", collapsed ? "px-2" : "px-3")}>{footer}</div>
        ) : null}
        {/* Hide the manual toggle on tablet — the rail is forced there. */}
        {!isTablet ? (
          <div className={cn("flex items-center", collapsed ? "justify-center px-2" : "justify-end px-3")}>
            <button
              type="button"
              onClick={() => setUserCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-accent hover:text-foreground"
            >
              {collapsed ? "›" : "‹ Collapse"}
            </button>
          </div>
        ) : null}
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
      {label ? (
        collapsed ? (
          <div className="mx-2 my-1 border-t border-sidebar-border" aria-hidden="true" />
        ) : (
          <p className="m-0 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
        )
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
  /** Tooltip text when collapsed. Defaults to string children. */
  tooltip?: string;
};

export function SidebarItem({ active, icon, children, onPress, testID, tooltip }: SidebarItemProps) {
  const { collapsed } = useSidebar();
  const title = collapsed
    ? (tooltip ?? (typeof children === "string" ? children : undefined))
    : undefined;
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onPress}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center rounded-lg py-2 text-left transition-colors duration-[var(--dur-fast)]",
        collapsed ? "justify-center gap-0 px-0" : "justify-start gap-2.5 px-2.5",
        active
          ? "bg-sidebar-primary/12 text-sidebar-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {/* Active rail indicator */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary transition-all duration-[var(--dur-base)]",
          active ? "opacity-100" : "opacity-0",
        )}
        style={{ transitionTimingFunction: "var(--ease-spring)" }}
      />
      {icon ? (
        <span
          className={cn(
            "flex w-5 shrink-0 items-center justify-center",
            active ? "text-sidebar-primary" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      {!collapsed ? (
        <span className={cn("min-w-0 truncate text-sm", active ? "font-semibold" : "font-medium")}>{children}</span>
      ) : null}
    </button>
  );
}
