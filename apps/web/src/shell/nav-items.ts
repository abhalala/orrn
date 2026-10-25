import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";
import {
  BookOpen,
  BookMarked,
  Boxes,
  Building2,
  ClipboardCheck,
  Cylinder,
  Factory,
  FlaskConical,
  House,
  Inbox,
  LayoutDashboard,
  PackagePlus,
  Printer,
  Scale,
  Settings,
  Truck,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type NavModule = "customers" | "dies" | "bundles" | "dispatches" | "press";

export type NavItem = {
  key: string;
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

/** Who may read scrap lots: the server's `purchaseReader` (routers/vendor.ts). */
const PURCHASE_READERS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];

/**
 * Approvals: approvers (manager/admin/owner via masters.publish, foundry for a cast close) and the
 * roles that raise requests (office D/C notes, die room re-ranks, supervisor cast close).
 * PL-W10 replaces this with the role-aware nav table.
 */
const APPROVAL_PEOPLE: readonly Action[] = ["masters.publish", "purchase.dcnote", "die.rerank", "cast.close", "cast.enter"];

/** The press: who runs it, who logs it, and who reads its report (FP-PR). The viewer's page shows nothing actionable. */
const PRESS_PEOPLE: readonly Action[] = ["press.run", "press.close", "reports.read"];

export const TENANT_MORE: readonly NavItem[] = [
  { key: "press", to: "/press", labelKey: "nav.press", icon: Factory, requires: PRESS_PEOPLE, module: "press" },
  { key: "purchase", to: "/purchase", labelKey: "nav.purchase", icon: Scale, requires: PURCHASE_READERS },
  { key: "approvals", to: "/approvals", labelKey: "nav.approvals", icon: ClipboardCheck, requires: APPROVAL_PEOPLE },
  { key: "dies", to: "/dies", labelKey: "nav.dies", icon: Cylinder, module: "dies" },
  { key: "customers", to: "/customers", labelKey: "nav.customers", icon: Users, module: "customers" },
  // PL-W6. Plant screens are gated by role, not by the legacy SaaS modules. PL-W10 owns the
  // role-aware nav table (storekeeper: Today · Purchase · Scan · Store · More) and moves this entry.
  { key: "store", to: "/store", labelKey: "nav.store", icon: Boxes, requires: ["store.txn", "masters.publish"] },
  { key: "printing", to: "/printing", labelKey: "nav.printing", icon: Printer, requires: ["spool.view_queue"] },
  // PL-W1: the plant's lists (vendors, scrap, locations, die copies). Gated by role; PL-W10 owns the
  // role-aware nav table and moves this into the sidebar's Masters group.
  { key: "masters", to: "/masters", labelKey: "nav.masters", icon: BookMarked, requires: ["masters.publish", "masters.draft"] },
  { key: "guides", to: "/guides", labelKey: "nav.guides", icon: BookOpen },
  {
    key: "settings",
    to: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    // Ruling R24: people who can change company settings or the team.
    requires: ["settings.update", "member.invite", "member.updateRole", "member.remove", "users.manage"],
  },
  { key: "preview", to: "/preview", labelKey: "nav.preview", icon: FlaskConical },
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

/**
 * Whether `pathname` belongs to this item. Old URLs never get here: they
 * redirect before the shell renders, so only current paths are matched.
 * A bundle (`/b/...`) is part of Stock; vendor pages (`/vendors/...`) are part of Masters.
 */
export function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  if (item.key === "stock" && under(pathname, "/b")) return true;
  if (item.key === "masters" && under(pathname, "/vendors")) return true;
  return under(pathname, item.to);
}
