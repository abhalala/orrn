import { isModuleOn } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";
import {
  BadgeCheck,
  BookOpen,
  BookMarked,
  Boxes,
  Building2,
  FileText,
  ClipboardCheck,
  ChartColumn,
  Cylinder,
  Factory,
  Flame,
  Thermometer,
  House,
  Inbox,
  LayoutDashboard,
  ListChecks,
  PackagePlus,
  Printer,
  Tags,
  Calculator,
  Rocket,
  Scale,
  ScrollText,
  ShoppingCart,
  Settings,
  DatabaseBackup,
  LifeBuoy,
  Truck,
  UserCog,
  Users,
  Warehouse,
  UploadCloud,
  MessageSquareWarning,
  Sunrise,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavModule = "customers" | "dies" | "bundles" | "dispatches" | "press" | "foundry" | "ageing" | "complaints" | "qa" | "pricing" | "billing" | "store" | "maintenance" | "costing";

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

/** The foundry: who enters casts and melts, closes them, and who reads reports (the cast pages are readable by any member). */
const FOUNDRY_PEOPLE: readonly Action[] = ["cast.enter", "melt.enter", "cast.close", "reports.read"];

/** Quality (XE parity lane QA): who checks, holds, releases, keeps its lists, or reads reports. */
const QA_PEOPLE: readonly Action[] = ["qa.check", "qa.hold", "qa.release", "qa.masters", "reports.read"];
/** Billing: who reads invoices, issues them, records payments or sets up GST. */
const BILLING_PEOPLE: readonly Action[] = ["invoice.read", "invoice.issue", "payment.record", "gst.settings"];

export const TENANT_MORE: readonly NavItem[] = [
  { key: "ingest", to: "/ingest", labelKey: "nav.ingest", icon: UploadCloud, requires: ["ingest.upload", "ingest.merge", "ingest.check"] },
  // FP-OP: customer POs and what is still to dispatch. The press plan (/orders/plan) is reached from here.
  { key: "orders", to: "/orders", labelKey: "nav.orders", icon: ListChecks, requires: ["order.manage", "order.plan"] },
  { key: "press", to: "/press", labelKey: "nav.press", icon: Factory, requires: PRESS_PEOPLE, module: "press" },
  // W2-FD-W: casts, melts, spectro, billet stock (the Foundry entry; Billet stock and the inbox are linked from it).
  { key: "foundry", to: "/casts", labelKey: "nav.foundry", icon: Flame, requires: FOUNDRY_PEOPLE, module: "foundry" },
  // W3-AG-W: the ageing ovens and trolleys, between the press and pack. Floor roles hold ageing.view / ageing.enter.
  { key: "ageing", to: "/ageing", labelKey: "nav.ageing", icon: Thermometer, requires: ["ageing.view", "ageing.enter"], module: "ageing" },
  // XE parity lane QA: what waits for a check, quality holds, registers and instruments.
  { key: "qa", to: "/qa", labelKey: "nav.qa", icon: BadgeCheck, requires: QA_PEOPLE, module: "qa" },
  // W4-ANALYTICS: production, die life, stock age and the order book (reports.read).
  { key: "reports", to: "/reports", labelKey: "nav.reports", icon: ChartColumn, requires: ["reports.read"] },
  // XE parity REG: the complaint register and the owner's morning page.
  { key: "complaints", to: "/complaints", labelKey: "nav.complaints", icon: MessageSquareWarning, requires: ["complaint.open", "complaint.manage"], module: "complaints" },
  { key: "owner", to: "/owner", labelKey: "nav.owner", icon: Sunrise, requires: ["mis.view"] },
  // XE-BILL: tax invoices, payments, outstanding and the accounts exports. Opt-in module, hidden while it is off.
  { key: "billing", to: "/billing", labelKey: "nav.billing", icon: FileText, requires: BILLING_PEOPLE, module: "billing" },
  // XE parity lane MAINT: assets, preventive plans, work orders and readings.
  { key: "maintenance", to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench, requires: ["maint.view"], module: "maintenance" },
  { key: "purchase", to: "/purchase", labelKey: "nav.purchase", icon: Scale, requires: PURCHASE_READERS },
  { key: "approvals", to: "/approvals", labelKey: "nav.approvals", icon: ClipboardCheck, requires: APPROVAL_PEOPLE },
  { key: "dies", to: "/dies", labelKey: "nav.dies", icon: Cylinder, module: "dies" },
  { key: "customers", to: "/customers", labelKey: "nav.customers", icon: Users, module: "customers" },
  // XE-PRICE: the price master, quotes and enquiries. People who read prices or run enquiries.
  { key: "pricing", to: "/pricing", labelKey: "nav.pricing", icon: Tags, requires: ["price.view", "enquiry.manage"], module: "pricing" },
  // XE parity lane COST: cost per kg, margins, press load, forecast, dies due. Opt-in module.
  { key: "costing", to: "/costing", labelKey: "nav.costing", icon: Calculator, requires: ["cost.view"], module: "costing" },
  // PL-W6. Plant screens are gated by role, not by the legacy SaaS modules. PL-W10 owns the
  // role-aware nav table (storekeeper: Today · Purchase · Scan · Store · More) and moves this entry.
  { key: "store", to: "/store", labelKey: "nav.store", icon: Boxes, requires: ["store.txn", "masters.publish"], module: "store" },
  // XE store (rows 69, 70, 73): indents, purchase orders and the store's value, for department heads, the office,
  // the store and managers.
  {
    key: "storeBuying",
    to: "/store/buy",
    labelKey: "nav.storeBuying",
    icon: ShoppingCart,
    requires: ["indent.raise", "indent.approve", "po.view", "po.manage", "store.value"],
    module: "store",
  },
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
  // FP-PF-16: the plant's audit log; owner, admin and manager hold audit.read.
  { key: "audit", to: "/audit", labelKey: "nav.audit", icon: ScrollText, requires: ["audit.read"] },
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

/** Godseye pages beyond the four tabs: on the rail under More, in the phone sheet. */
export const GODSEYE_MORE: readonly NavItem[] = [
  { key: "releases", to: "/admin/releases", labelKey: "nav.adminReleases", icon: Rocket, requires: ["platform.company.manage"] },
  { key: "backups", to: "/admin/backups", labelKey: "nav.adminBackups", icon: DatabaseBackup, requires: ["platform.backup.run"] },
  { key: "support", to: "/admin/support", labelKey: "nav.adminSupport", icon: LifeBuoy, requires: ["platform.company.manage"] },
];

/** Is this company module on? The server's rule (`isModuleOn`): opt-in modules only when named. */
export function moduleOn(me: Me | null | undefined, module: NavModule): boolean {
  return isModuleOn(me?.company?.modules ?? [], module);
}

/**
 * Items this person may see: permission (`canAny`) and company modules. An
 * empty modules list means every module is on (companies created before
 * modules existed have none set).
 */
export function visibleItems(items: readonly NavItem[], me: Me | null | undefined): NavItem[] {
  const modules = me?.company?.modules ?? [];
  return items.filter((item) => {
    if (item.requires && !canAny(me, item.requires)) return false;
    // The server's rule (`isModuleOn`): opt-in modules such as billing show only when named.
    if (item.module && !isModuleOn(modules, item.module)) return false;
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
  if (item.key === "foundry" && under(pathname, "/foundry")) return true;
  return under(pathname, item.to);
}
