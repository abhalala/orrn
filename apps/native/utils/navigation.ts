import type { Action } from "@orrn/server/lib/permissions";

export type NativeNavItem = {
  key: string;
  href: string;
  label: string;
  icon: string;
  description?: string;
  requires?: readonly Action[];
  implemented: boolean;
};

export const TENANT_NAV: readonly NativeNavItem[] = [
  { key: "home", href: "/", label: "Home", icon: "home", implemented: true },
  { key: "customers", href: "/customers", label: "Customers", icon: "people", description: "Customer profiles", implemented: true },
  { key: "dies", href: "/dies", label: "Dies", icon: "category", description: "Tooling catalog", implemented: true },
  {
    key: "receipts",
    href: "/receipts",
    label: "Receipts",
    icon: "receipt-long",
    description: "Production intake",
    requires: ["receipt.create", "receipt.update", "receipt.delete"],
    implemented: true,
  },
  { key: "bundles", href: "/bundles", label: "Bundles", icon: "inventory-2", description: "Bundle inventory", implemented: true },
  { key: "stock", href: "/stock", label: "Stock", icon: "warehouse", description: "Stock by die", implemented: true },
  { key: "dispatches", href: "/dispatches", label: "Dispatches", icon: "local-shipping", description: "Outbound work", implemented: true },
  {
    key: "members",
    href: "/members",
    label: "Members",
    icon: "group",
    requires: ["member.invite", "member.updateRole"],
    implemented: true,
  },
];

export const PLATFORM_NAV: readonly NativeNavItem[] = [
  { key: "platform-waitlist", href: "/platform-waitlist", label: "Waitlist", icon: "admin-panel-settings", implemented: true },
];
