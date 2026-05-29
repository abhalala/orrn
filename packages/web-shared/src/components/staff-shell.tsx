import type { Action } from "@orrn/api/lib/permissions";
import { StatusBadge } from "@orrn/ui/components/badge";
import {
  Sidebar,
  SidebarItem,
  SidebarSection,
} from "@orrn/ui/components/sidebar";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Building2, ClipboardList, LayoutDashboard, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Breadcrumbs } from "../components/breadcrumbs";
import { ModeToggle } from "../components/mode-toggle";
import UserMenu from "../components/user-menu";
import { can, useMe } from "../lib/me";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  requires?: readonly Action[];
};

const STAFF_NAV: readonly NavItem[] = [
  { to: "/admin", label: "Console", icon: <LayoutDashboard size={16} /> },
  {
    to: "/admin/companies",
    label: "Companies",
    icon: <Building2 size={16} />,
    requires: ["platform.company.manage"],
  },
  {
    to: "/admin/waitlist",
    label: "Waitlist",
    icon: <ClipboardList size={16} />,
    requires: ["platform.waitlist.review"],
  },
  {
    to: "/admin/staff",
    label: "Staff",
    icon: <Users size={16} />,
    requires: ["platform.staff.list"],
  },
];

export function StaffShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const matchRoute = useMatchRoute();

  const items = STAFF_NAV.filter((item) => {
    if (!item.requires) return true;
    return can(me, item.requires[0]!);
  });

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <Sidebar
          brand={
            <Link to="/admin" className="flex items-center gap-2 no-underline">
              <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                O
              </div>
              <span className="font-semibold text-base text-foreground">ORRN Staff</span>
            </Link>
          }
          footer={<ModeToggle />}
        >
          <SidebarSection label="Platform">
            {items.map((item) => {
              const isActive = !!matchRoute({ to: item.to as "/admin", fuzzy: true });
              return (
                <Link key={item.to} to={item.to as "/admin"} className="no-underline">
                  <SidebarItem active={isActive} icon={item.icon}>
                    {item.label}
                  </SidebarItem>
                </Link>
              );
            })}
          </SidebarSection>
        </Sidebar>
        <div className="flex-1 flex flex-col min-w-0">
          <StaffTopBar />
          <Breadcrumbs homePath="/admin" homeLabel="Console" skipSegments={["admin"]} />
          <main className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-7xl px-6 py-6 space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function StaffTopBar() {
  const { data: me } = useMe();
  const platformRole = me?.platformRole;
  return (
    <div className="flex items-center justify-between gap-3 px-6 h-14 border-b border-border bg-background">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-muted-foreground hidden sm:inline">Signed in as</span>
        <span className="text-sm font-medium text-foreground truncate">{me?.user.email}</span>
        {platformRole ? (
          <StatusBadge
            kind="role"
            value="platform"
            label={platformRole.replace("_", " ").toUpperCase()}
          />
        ) : null}
      </div>
      <UserMenu signInTo="/" />
    </div>
  );
}
