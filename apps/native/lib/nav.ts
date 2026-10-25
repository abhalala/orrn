import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";

/**
 * The native tab bar, mirroring the web phone tab bar
 * (`apps/web/src/shell/nav-items.ts`): same permission and module rules. Pure,
 * so the rules are unit-tested; `app/(tabs)/_layout.tsx` and
 * `components/tab-bar.tsx` render it.
 *
 * Three role-aware sets (spec E1, E2 "Native"):
 *   floor    Today · Pack · [Scan] · Stock · Dispatch   (packer set, every other role)
 *   dieRoom  Today · Dies · [Scan] · Press · More       (die_room)
 *   office   Today · Dispatch · [Scan] · Orders · More  (office)
 * `menu` is not a screen: pressing it opens More (the same screen the avatar opens).
 */
export type TabName = "today" | "pack" | "scan" | "stock" | "dispatch" | "dies" | "press" | "orders" | "menu";
export type TabSet = "floor" | "dieRoom" | "office";
export type NavModule = "bundles" | "dispatches" | "dies" | "press" | "orders";

/** Feather glyph names (Feather is the stroke-2 set Lucide grew from). */
export type TabIcon = "home" | "package" | "maximize" | "layers" | "truck" | "disc" | "activity" | "file-text" | "menu";

export type TabRoute = {
  name: TabName;
  labelKey: MessageKey;
  icon: TabIcon;
  /** Has its own Stack (`(tabs)/<name>/_layout.tsx`) for detail screens. */
  stack: boolean;
  requires?: readonly Action[];
  /** Company modules (lower case) any one of which keeps the tab. No entry: always on. */
  modules?: readonly NavModule[];
};

/**
 * Every tab route, in the order the bar draws them before `placeScan` moves Scan
 * to the middle of what is visible. Hidden ones are `Tabs.Protected`.
 */
export const TAB_ROUTES: readonly TabRoute[] = [
  { name: "today", labelKey: "nav.today", icon: "home", stack: true },
  { name: "pack", labelKey: "nav.pack", icon: "package", stack: true, requires: ["bundle.create"], modules: ["bundles"] },
  { name: "scan", labelKey: "nav.scan", icon: "maximize", stack: false, modules: ["bundles", "dies"] },
  { name: "stock", labelKey: "nav.stock", icon: "layers", stack: true, modules: ["bundles"] },
  { name: "dispatch", labelKey: "nav.dispatch", icon: "truck", stack: true, modules: ["dispatches"] },
  { name: "dies", labelKey: "nav.dies", icon: "disc", stack: true, modules: ["dies"] },
  { name: "press", labelKey: "native.tabs.press", icon: "activity", stack: true, modules: ["press"] },
  { name: "orders", labelKey: "nav.orders", icon: "file-text", stack: true, requires: ["order.manage"], modules: ["orders"] },
  { name: "menu", labelKey: "nav.more", icon: "menu", stack: false },
];

export const TAB_SETS: Record<TabSet, readonly TabName[]> = {
  floor: ["today", "pack", "scan", "stock", "dispatch"],
  dieRoom: ["today", "dies", "scan", "press", "menu"],
  office: ["today", "dispatch", "scan", "orders", "menu"],
};

/** Which set a membership role gets: the die room and the office have their own, everyone else the packer set. */
export function tabSetFor(me: Pick<Me, "company"> | null | undefined): TabSet {
  const role = me?.company?.role;
  if (role === "die_room") return "dieRoom";
  if (role === "office") return "office";
  return "floor";
}

/** Tabs this person may see, in declared order. Today is always there. */
export function visibleTabs(me: Me | null | undefined): TabName[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  const set = TAB_SETS[tabSetFor(me)];
  return TAB_ROUTES.filter((tab) => {
    if (tab.name === "today") return true;
    if (!me?.company) return false;
    if (!set.includes(tab.name)) return false;
    if (tab.requires && !canAny(me, tab.requires)) return false;
    if (tab.modules && modules.length > 0 && !tab.modules.some((m) => modules.includes(m))) return false;
    return true;
  }).map((t) => t.name);
}

/**
 * Tabs this person can open but that are not on their bar: the packer set's owner, manager and admin
 * reach Orders (order.manage / order.plan) and Dies (die.card / die.reading) from More. They stay
 * routes (not `Tabs.Protected`) so More can link to them; the bar draws only `visibleTabs`.
 */
export function extraTabs(me: Me | null | undefined): TabName[] {
  if (!me?.company) return [];
  const modules = (me.company.modules ?? []).map((m) => m.toLowerCase());
  const moduleOn = (m: NavModule) => modules.length === 0 || modules.includes(m);
  const onBar = new Set(visibleTabs(me));
  const out: TabName[] = [];
  if (!onBar.has("dies") && moduleOn("dies") && canAny(me, ["die.card", "die.reading"])) out.push("dies");
  if (!onBar.has("orders") && moduleOn("orders") && canAny(me, ["order.manage", "order.plan"])) out.push("orders");
  return out;
}

/** Every tab route this person may open: the bar's tabs plus `extraTabs`, in declared order. */
export function reachableTabs(me: Me | null | undefined): TabName[] {
  const set = new Set<TabName>([...visibleTabs(me), ...extraTabs(me)]);
  return TAB_ROUTES.filter((t) => set.has(t.name)).map((t) => t.name);
}

/** Scan goes in the middle of the other visible tabs, like the web tab bar. */
export function placeScan(names: readonly TabName[]): TabName[] {
  if (!names.includes("scan")) return [...names];
  const rest: TabName[] = names.filter((n) => n !== "scan");
  rest.splice(Math.floor(rest.length / 2), 0, "scan");
  return rest;
}
