import type { Action } from "@orrn/server/lib/permissions";
import {
  Boxes,
  Building2,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Printer,
  Receipt,
  Shield,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import type { ReactNode } from "react";

export type WebNavItem = {
  key: string;
  to: string;
  label: string;
  icon: ReactNode;
  scope: "tenant" | "staff";
  requires?: readonly Action[];
  implemented: boolean;
};

export const TENANT_NAV: readonly WebNavItem[] = [
  {
    key: "dashboard",
    to: "/dashboard",
    label: "Dashboard",
    icon: <LayoutGrid size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "customers",
    to: "/customers",
    label: "Customers",
    icon: <Users size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "dies",
    to: "/dies",
    label: "Dies",
    icon: <Boxes size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "receipts",
    to: "/receipts",
    label: "Receipts",
    icon: <Receipt size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "bundles",
    to: "/bundles",
    label: "Bundles",
    icon: <Package size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "stock",
    to: "/stock",
    label: "Stock",
    icon: <Warehouse size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "dispatches",
    to: "/dispatches",
    label: "Dispatches",
    icon: <Truck size={16} aria-hidden="true" />,
    scope: "tenant",
    implemented: true,
  },
  {
    key: "spool",
    to: "/spool",
    label: "Print Queue",
    icon: <Printer size={16} aria-hidden="true" />,
    scope: "tenant",
    requires: ["spool.view_queue"],
    implemented: true,
  },
  {
    key: "members",
    to: "/settings/members",
    label: "Members",
    icon: <Users size={16} aria-hidden="true" />,
    scope: "tenant",
    requires: ["member.invite", "member.updateRole", "member.remove"],
    implemented: true,
  },
];

export const STAFF_NAV: readonly WebNavItem[] = [
  {
    key: "console",
    to: "/admin",
    label: "Console",
    icon: <LayoutDashboard size={16} aria-hidden="true" />,
    scope: "staff",
    implemented: true,
  },
  {
    key: "companies",
    to: "/admin/companies",
    label: "Companies",
    icon: <Building2 size={16} aria-hidden="true" />,
    scope: "staff",
    requires: ["platform.company.manage"],
    implemented: true,
  },
  {
    key: "waitlist",
    to: "/admin/waitlist",
    label: "Waitlist",
    icon: <ClipboardList size={16} aria-hidden="true" />,
    scope: "staff",
    requires: ["platform.waitlist.review"],
    implemented: true,
  },
  {
    key: "staff",
    to: "/admin/staff",
    label: "Staff",
    icon: <Users size={16} aria-hidden="true" />,
    scope: "staff",
    requires: ["platform.staff.list"],
    implemented: true,
  },
  {
    key: "spool",
    to: "/admin/spool",
    label: "Spool",
    icon: <Printer size={16} aria-hidden="true" />,
    scope: "staff",
    requires: ["platform.spool.manage"],
    implemented: true,
  },
];

export const PLATFORM_LINK: WebNavItem = {
  key: "platform-console",
  to: "/admin",
  label: "Staff Console",
  icon: <Shield size={16} aria-hidden="true" />,
  scope: "staff",
  implemented: true,
};
