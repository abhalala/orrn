import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

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
        // Ink panel in both themes (C2): near-black with light text. The
        // `orrn-ink-panel` scope re-points focus rings and nested component
        // tokens so everything stays legible on it.
        className="orrn-ink-panel flex h-full flex-col gap-5 overflow-hidden border-r border-sidebar-border bg-sidebar py-5 text-sidebar-foreground transition-[width]"
      >
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {brand}
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-0.5">
          {children}
        </nav>
        {footer ? (
          <div className={cn("flex flex-col gap-2", collapsed ? "px-2" : "px-3")}>{footer}</div>
        ) : null}
        {/* Hide the manual toggle on tablet — the rail is forced there. */}
        {!isTablet ? (
          <div className={cn("flex items-center", collapsed ? "justify-center px-2" : "justify-start px-2.5")}>
            <button
              type="button"
              onClick={() => setUserCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full text-[13px] font-medium text-sidebar-muted transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-accent hover:text-sidebar-foreground",
                collapsed ? "w-11 justify-center" : "px-3.5",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-[18px]" aria-hidden="true" />
              ) : (
                <>
                  <PanelLeftClose className="size-[18px]" aria-hidden="true" />
                  Collapse
                </>
              )}
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
          <p className="m-0 px-3.5 pb-1.5 pt-1 text-xs font-medium text-sidebar-muted">{label}</p>
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
  const className = cn(
    "relative flex min-h-11 w-full items-center rounded-full text-left transition-[background-color,color,transform] duration-[var(--dur-fast)] active:scale-[0.97]",
    collapsed ? "justify-center gap-0 px-0" : "justify-start gap-3 px-3.5",
    active
      ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
      : "font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );
  const content = (
    <>
      {icon ? (
        <span className="flex w-5 shrink-0 items-center justify-center [&_svg]:size-[18px]" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {collapsed ? (
        <span className="sr-only">{children}</span>
      ) : (
        <span className="min-w-0 truncate text-sm">{children}</span>
      )}
    </>
  );

  // When there's no press handler the item is wrapped in a router <Link>
  // (app shell). Render a non-interactive element then so we never nest a
  // button inside a link.
  if (!onPress) {
    return (
      <span data-testid={testID} title={title} data-active={active ? "" : undefined} className={className}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onPress}
      title={title}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
    </button>
  );
}
