import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";

/**
 * The native tab bar, mirroring the web phone tab bar
 * (`apps/web/src/shell/nav-items.ts`): same permission and module rules. Pure,
 * so the rules are unit-tested; `app/(tabs)/_layout.tsx` and
 * `components/tab-bar.tsx` render it.
 *
 * Four role-aware sets (spec E1, E2, E3 "Native"):
 *   floor    Today · Pack · [Scan] · Stock · Dispatch   (packer set, every other role)
 *   dieRoom  Today · Dies · [Scan] · Press · More       (die_room)
 *   office   Today · Dispatch · [Scan] · Orders · More  (office)
 *   press    Today · Press · [Scan] · Dies · More       (press: line state, queue, downtime, handover; the station is the tablet)
 *   foundry  Today · Cast · [Scan] · Stock · More       (foundry: casts, melts, spectro, billet stock; Close is for cast.close holders)
 * `menu` is not a screen: pressing it opens More (the same screen the avatar opens).
 */
export type TabName = "today" | "pack" | "scan" | "stock" | "dispatch" | "dies" | "press" | "cast" | "orders" | "menu";
export type TabSet = "floor" | "dieRoom" | "office" | "press" | "foundry";
export type NavModule = "bundles" | "dispatches" | "dies" | "press" | "orders" | "foundry";

/** Feather glyph names (Feather is the stroke-2 set Lucide grew from). */
export type TabIcon = "home" | "package" | "maximize" | "layers" | "truck" | "disc" | "activity" | "droplet" | "file-text" | "menu";

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

/** Who works the foundry floor: opens casts, enters melts, closes a cast. */
const CAST_PEOPLE = ["cast.enter", "melt.enter", "cast.close"] as const satisfies readonly Action[];

/**
 * Every tab route, in the order the bar draws them before `placeScan` moves Scan
 * to the middle of what is visible. Hidden ones are `Tabs.Protected`.
 */
export const TAB_ROUTES: readonly TabRoute[] = [
  { name: "today", labelKey: "nav.today", icon: "home", stack: true },
  { name: "pack", labelKey: "nav.pack", icon: "package", stack: true, requires: ["bundle.create"], modules: ["bundles"] },
  { name: "scan", labelKey: "nav.scan", icon: "maximize", stack: false, modules: ["bundles", "dies"] },
  { name: "stock", labelKey: "nav.stock", icon: "layers", stack: true, modules: ["bundles", "foundry"] },
  { name: "dispatch", labelKey: "nav.dispatch", icon: "truck", stack: true, modules: ["dispatches"] },
  { name: "dies", labelKey: "nav.dies", icon: "disc", stack: true, modules: ["dies"] },
  { name: "press", labelKey: "native.tabs.press", icon: "activity", stack: true, modules: ["press"] },
  { name: "cast", labelKey: "foundry.casts.title", icon: "droplet", stack: true, requires: CAST_PEOPLE, modules: ["foundry"] },
  { name: "orders", labelKey: "nav.orders", icon: "file-text", stack: true, requires: ["order.manage"], modules: ["orders"] },
  { name: "menu", labelKey: "nav.more", icon: "menu", stack: false },
];

export const TAB_SETS: Record<TabSet, readonly TabName[]> = {
  floor: ["today", "pack", "scan", "stock", "dispatch"],
  dieRoom: ["today", "dies", "scan", "press", "menu"],
  office: ["today", "dispatch", "scan", "orders", "menu"],
  press: ["today", "press", "scan", "dies", "menu"],
  foundry: ["today", "cast", "scan", "stock", "menu"],
};

/** Which set a membership role gets: the die room, the office and the press have their own, everyone else the packer set. */
export function tabSetFor(me: Pick<Me, "company"> | null | undefined): TabSet {
  const role = me?.company?.role;
  if (role === "die_room") return "dieRoom";
  if (role === "office") return "office";
  if (role === "press") return "press";
  if (role === "foundry") return "foundry";
  return "floor";
}

/** Tabs this person may see, in their set's order (the bar draws them in this order; `placeScan` then centres Scan). Today is always there. */
export function visibleTabs(me: Me | null | undefined): TabName[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  const set = TAB_SETS[tabSetFor(me)];
  const byName = new Map(TAB_ROUTES.map((tab) => [tab.name, tab]));
  const inSetOrder = set.map((name) => byName.get(name)!).filter(Boolean);
  return inSetOrder.filter((tab) => {
    if (tab.name === "today") return true;
    if (!me?.company) return false;
    if (!set.includes(tab.name)) return false;
    if (tab.requires && !canAny(me, tab.requires)) return false;
    // Stock is the bundle stock for the packer set; only the foundry role's Stock (billets) is on with the foundry module alone.
    const tabModules = tab.name === "stock" && tabSetFor(me) !== "foundry" ? (["bundles"] as const) : tab.modules;
    if (tabModules && modules.length > 0 && !tabModules.some((m) => modules.includes(m))) return false;
    return true;
  }).map((t) => t.name);
}

/** Who may open the Dies screens from More: the die room's actions, or the masters people who see the board read-only (as on the web). */
const DIE_READERS = ["die.card", "die.reading", "masters.publish"] as const satisfies readonly Action[];

/** Who opens the Press screens from More when Press is not on their bar: the people who run or log presses. */
const PRESS_READERS = ["press.run", "press.close"] as const satisfies readonly Action[];

/**
 * Tabs this person can open but that are not on their bar: the packer set's owner, manager and admin
 * reach Orders (order.manage / order.plan) and Dies (die.card / die.reading, or masters.publish for the read-only board) from More. They stay
 * routes (not `Tabs.Protected`) so More can link to them; the bar draws only `visibleTabs`.
 */
export function extraTabs(me: Me | null | undefined): TabName[] {
  if (!me?.company) return [];
  const modules = (me.company.modules ?? []).map((m) => m.toLowerCase());
  const moduleOn = (m: NavModule) => modules.length === 0 || modules.includes(m);
  const onBar = new Set(visibleTabs(me));
  const out: TabName[] = [];
  if (!onBar.has("dies") && moduleOn("dies") && canAny(me, DIE_READERS)) out.push("dies");
  if (!onBar.has("orders") && moduleOn("orders") && canAny(me, ["order.manage", "order.plan"])) out.push("orders");
  // The people who run or log presses but have the packer bar (supervisor, manager, admin) read the lines from More.
  if (!onBar.has("press") && moduleOn("press") && canAny(me, PRESS_READERS)) out.push("press");
  // The people who enter casts, enter melts or close a cast but have the packer bar (supervisor, manager, admin) reach Cast from More:
  // the Billets cards on Stock open a cast for everyone who sees them (cast.close included), and Close lives there.
  if (!onBar.has("cast") && moduleOn("foundry") && canAny(me, CAST_PEOPLE)) out.push("cast");
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
