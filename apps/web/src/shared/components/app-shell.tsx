import { AppFrame, AppStatusBar, MobileNav } from "@orrn/ui/components/app-frame";
import { StatusBadge } from "@orrn/ui/components/badge";
import { cn } from "@orrn/ui/lib/utils";
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
  useSidebar,
} from "@orrn/ui/components/sidebar";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Building2, Eye } from "lucide-react";
import type { ReactNode } from "react";

import { Breadcrumbs } from "../components/breadcrumbs";
import { ImpersonationBanner } from "../components/impersonation-banner";
import { ModeToggle } from "../components/mode-toggle";
import UserMenu from "../components/user-menu";
import { PLATFORM_LINK, TENANT_NAV, type WebNavItem } from "../lib/navigation";
import { canAny, useMe } from "../lib/me";

export type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return <WorkspaceShell homePath="/dashboard" nav={TENANT_NAV} maxWidth={1180}>{children}</WorkspaceShell>;
}

export type WorkspaceShellProps = {
  children: ReactNode;
  homePath: string;
  nav: readonly WebNavItem[];
  maxWidth?: number;
  homeLabel?: string;
  skipSegments?: string[];
  staffMode?: boolean;
};

export function WorkspaceShell({
  children,
  homePath,
  nav,
  maxWidth,
  homeLabel,
  skipSegments,
  staffMode,
}: WorkspaceShellProps) {
  const { data: me } = useMe();
  const matchRoute = useMatchRoute();
  const filteredNav = nav.filter((item) => {
    if (!item.implemented) return false;
    if (item.scope === "tenant" && !me?.company) return false;
    if (!item.requires) return true;
    return canAny(me, item.requires);
  });

  /**
   * An item is "parent-like" when another visible nav item's `to` lives under
   * its `to` (e.g. `/admin` is the parent of `/admin/waitlist`). Parent items
   * must match the path exactly so they don't show as active alongside their
   * children. Leaf items keep fuzzy matching so detail pages like
   * `/admin/companies/123` still light up their parent ("Companies").
   */
  function isItemActive(itemTo: string): boolean {
    const isParent = filteredNav.some(
      (other) => other.to !== itemTo && other.to.startsWith(`${itemTo}/`),
    );
    return !!matchRoute({ to: itemTo as any, fuzzy: !isParent });
  }

  const priority = mobilePriority(staffMode ? "staff" : me?.company?.role);
  const rank = (key: string) => {
    const i = priority.indexOf(key);
    return i === -1 ? priority.length : i;
  };
  // Phone tab bar: the role's most-used destinations first; the rest go
  // behind "More" (MobileNav keeps at most 5 tabs).
  const mobileItems = filteredNav
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
    .map(({ item }) => ({
      key: item.key,
      label: item.shortLabel ? (
        <>
          <span aria-hidden="true">{item.shortLabel}</span>
          <span className="sr-only">{item.label}</span>
        </>
      ) : (
        item.label
      ),
      fullLabel: item.label,
      icon: item.icon,
      href: item.to,
      active: isItemActive(item.to),
    }));

  return (
    <AppFrame
      banner={me?.impersonation ? <ImpersonationBanner /> : null}
      maxWidth={maxWidth}
      sidebar={
        <Sidebar
          brand={<SidebarBrand homePath={homePath} staffMode={staffMode} />}
          footer={<ModeToggle />}
        >
          <SidebarSection label={staffMode ? "Godseye" : "Operations"}>
            {filteredNav.map((item) => {
              const isActive = isItemActive(item.to);
              return (
                <Link
                  key={item.key}
                  to={item.to as any}
                  aria-current={isActive ? "page" : undefined}
                  className="block w-full rounded-full no-underline"
                >
                  <SidebarItem active={isActive} icon={item.icon}>
                    {item.label}
                  </SidebarItem>
                </Link>
              );
            })}
          </SidebarSection>
          {!staffMode && me?.isPlatformAdmin ? (
            <SidebarSection label="Staff">
              <Link to={PLATFORM_LINK.to as any} className="block w-full rounded-full no-underline">
                <SidebarItem icon={PLATFORM_LINK.icon}>{PLATFORM_LINK.label}</SidebarItem>
              </Link>
            </SidebarSection>
          ) : null}
        </Sidebar>
      }
      statusBar={
        <AppStatusBar
          /* Mobile: title + actions only. Desktop adds context + breadcrumbs. */
          brand={<StatusContext staffMode={staffMode} />}
          context={
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              <Breadcrumbs homePath={homePath} homeLabel={homeLabel} skipSegments={skipSegments} />
            </div>
          }
          actions={
            <>
              <ModeToggle />
              <UserMenu signInTo={staffMode ? "/" : "/login"} />
            </>
          }
        />
      }
      mobileNav={
        <MobileNav
          items={mobileItems}
          renderLink={({ item, className, children, onNavigate }) => (
            <Link
              key={item.key}
              to={item.href as any}
              aria-current={item.active ? "page" : undefined}
              className={className}
              onClick={onNavigate}
            >
              {children}
            </Link>
          )}
        />
      }
    >
      {children}
    </AppFrame>
  );
}

function SidebarBrand({ homePath, staffMode }: { homePath: string; staffMode?: boolean }) {
  const { collapsed } = useSidebar();
  return (
    <Link
      to={homePath as any}
      className={cn(
        "flex min-h-11 min-w-0 items-center rounded-full no-underline",
        collapsed ? "justify-center gap-0" : "gap-2.5 px-1.5",
      )}
      aria-label={staffMode ? "Godseye console home" : "ORRN home"}
    >
      <span
        aria-hidden="true"
        className="orrn-mark flex size-8 items-center justify-center text-white"
      >
        {staffMode ? <Eye size={16} aria-hidden="true" /> : null}
      </span>
      {!collapsed ? (
        <span className="flex min-w-0 items-baseline gap-1.5 truncate font-display text-xl font-extrabold tracking-[-0.03em] text-sidebar-foreground">
          {staffMode ? (
            <>
              Godseye
              <span className="font-sans text-xs font-medium tracking-normal text-sidebar-muted">
                by orrn
              </span>
            </>
          ) : (
            "orrn"
          )}
        </span>
      ) : null}
    </Link>
  );
}

function StatusContext({ staffMode }: { staffMode?: boolean }) {
  const { data: me } = useMe();
  if (staffMode) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Eye size={16} className="hidden shrink-0 text-tone-violet-ink sm:block" aria-hidden="true" />
        <span className="hidden truncate text-sm font-medium text-foreground sm:block">Godseye</span>
        <span className="truncate text-sm text-muted-foreground" title={me?.user.email}>
          {me?.user.email}
        </span>
        {me?.platformRole ? (
          <StatusBadge
            kind="role"
            value="platform"
            label={sentenceCase(me.platformRole.replace(/_/g, " "))}
            className="hidden sm:inline-flex"
          />
        ) : null}
      </div>
    );
  }

  if (!me?.company) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Building2 size={16} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <span className="truncate text-sm font-semibold text-foreground" title={me.company.name}>
        {me.company.name}
      </span>
      {me.company.role ? (
        <StatusBadge
          kind="role"
          value={me.company.role}
          label={sentenceCase(me.company.role)}
          className="hidden sm:inline-flex"
        />
      ) : null}
      {me.isPlatformAdmin ? (
        <StatusBadge kind="role" value="platform" label="Platform" className="hidden md:inline-flex" />
      ) : null}
    </div>
  );
}

/** Tab-bar order per role: what each person reaches for most on the floor. */
function mobilePriority(role: string | null | undefined): string[] {
  switch (role) {
    case "staff":
      return ["console", "companies", "waitlist", "staff", "spool"];
    case "operator":
      return ["dashboard", "bundles", "dispatches", "spool", "stock"];
    case "viewer":
      return ["dashboard", "stock", "bundles", "dispatches"];
    default:
      return ["dashboard", "dispatches", "bundles", "stock"];
  }
}

function sentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
