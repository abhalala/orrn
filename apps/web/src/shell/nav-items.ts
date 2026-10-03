import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";
import {
  BookOpen,
  Building2,
  Cylinder,
  House,
  Inbox,
  LayoutDashboard,
  PackagePlus,
  Printer,
  Settings,
  Truck,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { legacyPrefixes, navTarget } from "./route-compat";

export type NavModule = "customers" | "dies" | "bundles" | "dispatches";

export type NavItem = {
  key: string;
  /** C2 path. Link with `navTarget(item.to)` until the route map lands. */
  to: string;
  labelKey: MessageKey;
  /** Shorter label for the phone tab bar, where five items share 375px. */
  tabLabelKey?: MessageKey;
  icon: LucideIcon;
  /** Shown when the user can do any of these. */
  requires?: readonly Action[];
  /** Hidden when the company has modules switched on and this isn't one of them. */
  module?: NavModule;
  /** Active only on this exact path (a parent of other items, like `/admin`). */
  exact?: boolean;
};

/** Phone tab bar order is Today · Pack · [Scan] · Stock · Dispatch. */
export const TENANT_PRIMARY: readonly NavItem[] = [
  { key: "today", to: "/today", labelKey: "nav.today", icon: House },
  { key: "pack", to: "/pack", labelKey: "nav.pack", icon: PackagePlus, requires: ["bundle.create"], module: "bundles" },
  { key: "stock", to: "/stock", labelKey: "nav.stock", icon: Warehouse, module: "bundles" },
  { key: "dispatch", to: "/dispatch", labelKey: "nav.dispatch", icon: Truck, module: "dispatches" },
];

export const TENANT_MORE: readonly NavItem[] = [
  { key: "dies", to: "/dies", labelKey: "nav.dies", icon: Cylinder, module: "dies" },
  { key: "customers", to: "/customers", labelKey: "nav.customers", icon: Users, module: "customers" },
  { key: "printing", to: "/printing", labelKey: "nav.printing", icon: Printer, requires: ["spool.view_queue"] },
  { key: "guides", to: "/guides", labelKey: "nav.guides", icon: BookOpen },
  {
    key: "settings",
    to: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    // Ruling R24: people who can change company settings or the team.
    requires: ["settings.update", "member.invite", "member.updateRole", "member.remove"],
  },
];

export const GODSEYE_NAV: readonly NavItem[] = [
  { key: "overview", to: "/admin", labelKey: "nav.adminOverview", icon: LayoutDashboard, exact: true },
  {
    key: "companies",
    to: "/admin/companies",
    labelKey: "nav.adminCompanies",
    icon: Building2,
    requires: ["platform.company.manage"],
  },
  {
    key: "requests",
    to: "/admin/requests",
    labelKey: "nav.adminRequests",
    tabLabelKey: "nav.adminRequestsShort",
    icon: Inbox,
    requires: ["platform.waitlist.review"],
  },
  { key: "staff", to: "/admin/staff", labelKey: "nav.adminStaff", icon: UserCog, requires: ["platform.staff.list"] },
];

/**
 * Items this person may see: permission (`canAny`) and company modules. An
 * empty modules list means every module is on (companies created before
 * modules existed have none set).
 */
export function visibleItems(items: readonly NavItem[], me: Me | null | undefined): NavItem[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return items.filter((item) => {
    if (item.requires && !canAny(me, item.requires)) return false;
    if (item.module && modules.length > 0 && !modules.includes(item.module)) return false;
    return true;
  });
}

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Whether `pathname` belongs to this item (its section, old URLs included). */
export function isItemActive(item: NavItem, pathname: string): boolean {
  const target = navTarget(item.to);
  if (item.exact) return pathname === item.to || pathname === target;
  const prefixes = [item.to, target, ...(legacyPrefixes[item.key] ?? [])];
  return prefixes.some((p) => under(pathname, p));
}
