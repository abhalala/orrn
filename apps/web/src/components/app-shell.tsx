import type { Action } from "@orrn/api/lib/permissions";
import { Badge, StatusBadge } from "@orrn/ui/components/badge";
import { Input } from "@orrn/ui/components/input";
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
} from "@orrn/ui/components/sidebar";
import { Link, useLocation, useMatchRoute } from "@tanstack/react-router";
import {
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  LayoutGrid,
  Package,
  Receipt,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShoppingBag,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import type { ReactNode } from "react";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { canAny, useMe } from "@/lib/me";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  /** If set, item is only shown when the user can perform at least one of these actions. */
  requires?: readonly Action[];
};

const OPERATIONS_NAV: readonly NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: <LayoutGrid size={16} /> },
  { to: "/customers", label: "Customers", icon: <Users size={16} /> },
  { to: "/dies", label: "Dies", icon: <Boxes size={16} /> },
  { to: "/receipts", label: "Receipts", icon: <Receipt size={16} /> },
  { to: "/bundles", label: "Bundles", icon: <Package size={16} /> },
  { to: "/stock", label: "Stock", icon: <Warehouse size={16} /> },
  { to: "/dispatches", label: "Dispatches", icon: <Truck size={16} /> },
];

const ADMIN_NAV: readonly NavItem[] = [
  {
    to: "/settings/members",
    label: "Members",
    icon: <Users size={16} />,
    requires: ["member.invite", "member.updateRole", "member.remove"],
  },
];

const PLATFORM_NAV: readonly NavItem[] = [
  { to: "/platform", label: "Console", icon: <Shield size={16} /> },
  { to: "/platform/companies", label: "Companies", icon: <Building2 size={16} /> },
  { to: "/platform/waitlist", label: "Waitlist", icon: <ClipboardList size={16} /> },
];

export type AppShellProps = {
  children: ReactNode;
};

/**
 * Standard ORRN authenticated app shell. Renders a left sidebar (collapsible,
 * localStorage-persisted) with role-filtered nav sections, a top bar with the
 * active company + role badge, optional search/notification placeholders, the
 * user menu, and a sticky impersonation banner above everything when active.
 *
 * Public routes (/, /login, /waitlist, /invite/$token, /no-access) should be
 * rendered without this wrapper — see `__root.tsx`.
 */
export function AppShell({ children }: AppShellProps) {
  const { data: me } = useMe();
  const matchRoute = useMatchRoute();

  const operationsItems = OPERATIONS_NAV.filter((item) => {
    if (!me?.company) return false;
    if (!item.requires) return true;
    return canAny(me, item.requires);
  });
  const adminItems = ADMIN_NAV.filter((item) => {
    if (!me?.company) return false;
    if (!item.requires) return true;
    return canAny(me, item.requires);
  });

  return (
    <div className="flex flex-col h-svh w-full">
      {me?.impersonation ? <ImpersonationBanner /> : null}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <Sidebar
          brand={
            <Link to="/dashboard" className="flex items-center gap-2 no-underline">
              <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                O
              </div>
              <span className="font-semibold text-base text-foreground">ORRN</span>
            </Link>
          }
          footer={<ModeToggle />}
        >
          <SidebarSection label="Operations">
            {operationsItems.map((item) => {
              const isActive = !!matchRoute({ to: item.to as any, fuzzy: true });
              return (
                <Link key={item.to} to={item.to as any} className="no-underline">
                  <SidebarItem active={isActive} icon={item.icon}>
                    {item.label}
                  </SidebarItem>
                </Link>
              );
            })}
          </SidebarSection>
          {adminItems.length > 0 ? (
            <SidebarSection label="Admin">
              {adminItems.map((item) => {
                const isActive = !!matchRoute({ to: item.to as any, fuzzy: true });
                return (
                  <Link key={item.to} to={item.to as any} className="no-underline">
                    <SidebarItem active={isActive} icon={item.icon}>
                      {item.label}
                    </SidebarItem>
                  </Link>
                );
              })}
            </SidebarSection>
          ) : null}
          {me?.isPlatformAdmin ? (
            <SidebarSection label="Platform">
              {PLATFORM_NAV.map((item) => {
                const isActive = !!matchRoute({ to: item.to as any, fuzzy: true });
                return (
                  <Link key={item.to} to={item.to as any} className="no-underline">
                    <SidebarItem active={isActive} icon={item.icon}>
                      {item.label}
                    </SidebarItem>
                  </Link>
                );
              })}
            </SidebarSection>
          ) : null}
        </Sidebar>
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <Breadcrumbs />
          <main className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const { data: me } = useMe();
  const role = me?.company?.role;
  return (
    <div className="flex items-center justify-between gap-3 px-6 h-14 border-b border-border bg-background">
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <div className="relative w-full">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            placeholder="Search… (coming soon)"
            disabled
            className="pl-8 h-9 w-full"
            paddingLeft={32}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        {me?.company ? (
          <div className="hidden sm:flex items-center gap-2">
            <Building2 size={14} className="text-muted-foreground" />
            <span className="text-sm text-foreground">{me.company.name}</span>
            {role ? (
              <StatusBadge kind="role" value={role} label={role.toUpperCase()} />
            ) : null}
            {me.isPlatformAdmin ? (
              <Badge tone="warning">
                <span className="inline-flex items-center gap-1">
                  <Shield size={10} /> PLATFORM
                </span>
              </Badge>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Notifications (coming soon)"
          className="size-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          disabled
        >
          <Bell size={16} />
        </button>
        <UserMenu />
      </div>
    </div>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 px-6 h-9 text-xs text-muted-foreground border-b border-border bg-background"
    >
      <Link to="/dashboard" className="hover:text-foreground hover:underline">
        Home
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={path} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            {isLast ? (
              <span className="text-foreground">{prettifySegment(seg)}</span>
            ) : (
              <Link to={path as any} className="hover:text-foreground hover:underline">
                {prettifySegment(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function prettifySegment(seg: string): string {
  if (seg === "$id" || seg.startsWith("$")) return "Detail";
  if (seg === "new") return "New";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Tag exported so unused import lint doesn't strip it during the shell migration.
 */
export const __APP_SHELL_ICONS_USED = [
  ShoppingBag,
  SettingsIcon,
];
