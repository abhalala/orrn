import { AppFrame, AppStatusBar, MobileNav } from "@orrn/ui/components/app-frame";
import { Badge, StatusBadge } from "@orrn/ui/components/badge";
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
} from "@orrn/ui/components/sidebar";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Building2, Shield } from "lucide-react";
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

  const mobileItems = filteredNav.map((item) => ({
    key: item.key,
    label: item.label,
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
          brand={
            <Link to={homePath as any} className="flex min-w-0 items-center gap-2 no-underline">
              <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                O
              </div>
              <span className="truncate text-base font-semibold text-foreground">
                {staffMode ? "ORRN Staff" : "ORRN"}
              </span>
            </Link>
          }
          footer={<ModeToggle />}
        >
          <SidebarSection label={staffMode ? "Platform" : "Operations"}>
            {filteredNav.map((item) => {
              const isActive = isItemActive(item.to);
              return (
                <Link key={item.key} to={item.to as any} className="block w-full no-underline">
                  <SidebarItem active={isActive} icon={item.icon}>
                    {item.label}
                  </SidebarItem>
                </Link>
              );
            })}
          </SidebarSection>
          {!staffMode && me?.isPlatformAdmin ? (
            <SidebarSection label="Staff">
              <Link to={PLATFORM_LINK.to as any} className="block w-full no-underline">
                <SidebarItem icon={PLATFORM_LINK.icon}>{PLATFORM_LINK.label}</SidebarItem>
              </Link>
            </SidebarSection>
          ) : null}
        </Sidebar>
      }
      statusBar={
        <>
          <AppStatusBar
            brand={
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-sm font-medium text-foreground">{staffMode ? "Staff Console" : "Operations"}</span>
              </div>
            }
            context={<StatusContext staffMode={staffMode} />}
            actions={
              <>
                <ModeToggle />
                <UserMenu signInTo={staffMode ? "/" : "/login"} />
              </>
            }
          />
          <Breadcrumbs homePath={homePath} homeLabel={homeLabel} skipSegments={skipSegments} />
        </>
      }
      mobileNav={<MobileNav items={mobileItems} />}
    >
      {children}
    </AppFrame>
  );
}

function StatusContext({ staffMode }: { staffMode?: boolean }) {
  const { data: me } = useMe();
  if (staffMode) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm text-foreground">{me?.user.email}</span>
        {me?.platformRole ? (
          <StatusBadge kind="role" value="platform" label={me.platformRole.replace("_", " ").toUpperCase()} />
        ) : null}
      </div>
    );
  }

  if (!me?.company) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Building2 size={14} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <span className="truncate text-sm text-foreground">{me.company.name}</span>
      {me.company.role ? <StatusBadge kind="role" value={me.company.role} label={me.company.role.toUpperCase()} /> : null}
      {me.isPlatformAdmin ? (
        <Badge tone="warning">
          <span className="inline-flex items-center gap-1">
            <Shield size={10} aria-hidden="true" /> PLATFORM
          </span>
        </Badge>
      ) : null}
    </div>
  );
}
