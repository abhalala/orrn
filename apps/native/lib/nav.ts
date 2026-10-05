import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";

/**
 * The native tab bar, mirroring the web phone tab bar
 * (`apps/web/src/shell/nav-items.ts`): same order, same permission and module
 * rules. Pure, so the rules are unit-tested; `app/(tabs)/_layout.tsx` and
 * `components/tab-bar.tsx` render it.
 */
export type TabName = "today" | "pack" | "scan" | "stock" | "dispatch";
export type NavModule = "bundles" | "dispatches";

/** Feather glyph names (Feather is the stroke-2 set Lucide grew from). */
export type TabIcon = "home" | "package" | "maximize" | "layers" | "truck";

export type TabRoute = {
  name: TabName;
  labelKey: MessageKey;
  icon: TabIcon;
  /** Has its own Stack (`(tabs)/<name>/_layout.tsx`) for detail screens. */
  stack: boolean;
  requires?: readonly Action[];
  module?: NavModule;
};

export const TAB_ROUTES: readonly TabRoute[] = [
  { name: "today", labelKey: "nav.today", icon: "home", stack: true },
  { name: "pack", labelKey: "nav.pack", icon: "package", stack: true, requires: ["bundle.create"], module: "bundles" },
  { name: "scan", labelKey: "nav.scan", icon: "maximize", stack: false, module: "bundles" },
  { name: "stock", labelKey: "nav.stock", icon: "layers", stack: true, module: "bundles" },
  { name: "dispatch", labelKey: "nav.dispatch", icon: "truck", stack: true, module: "dispatches" },
];

/** Tabs this person may see, in declared order. Today is always there. */
export function visibleTabs(me: Me | null | undefined): TabName[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return TAB_ROUTES.filter((tab) => {
    if (tab.name === "today") return true;
    if (!me?.company) return false;
    if (tab.requires && !canAny(me, tab.requires)) return false;
    if (tab.module && modules.length > 0 && !modules.includes(tab.module)) return false;
    return true;
  }).map((t) => t.name);
}

/** Scan goes in the middle of the other visible tabs, like the web tab bar. */
export function placeScan(names: readonly TabName[]): TabName[] {
  if (!names.includes("scan")) return [...names];
  const rest: TabName[] = names.filter((n) => n !== "scan");
  rest.splice(Math.floor(rest.length / 2), 0, "scan");
  return rest;
}
