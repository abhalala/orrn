import { anyModuleOn } from "@orrn/domain";
import type { Me } from "@orrn/server/lib/permissions";

import { canAny } from "@orrn/server/lib/permissions";

import { extraTabs, visibleTabs } from "@/lib/nav";

import { showsAgeing } from "@/features/ageing/model";

export type MoreRowKey = "dies" | "customers" | "guides" | "settings" | "orders" | "dieRoom" | "press" | "cast" | "furnaces" | "alloys" | "nitriding" | "makers" | "ageing" | "me";

export type MoreRow = {
  key: MoreRowKey;
  /** The More stack's own screens, or a tab screen reached from More (Orders, Dies). */
  href: "/more/dies" | "/more/customers" | "/more/guides" | "/more/settings" | "/orders" | "/dies" | "/press" | "/cast" | "/more/furnaces" | "/more/alloys" | "/more/nitriding" | "/more/makers" | "/more/ageing" | "/more/me";
  labelKey: "nav.dies" | "nav.customers" | "nav.guides" | "nav.settings" | "nav.orders" | "native.tabs.press" | "foundry.casts.title" | "foundry.masters.furnaces" | "foundry.masters.alloys" | "dieRoom.status.at_nitriding" | "dieRoom.makers.withMakers" | "nav.ageing" | "native.hr.title";
  /** A Feather glyph. */
  icon: "layers" | "users" | "book-open" | "settings" | "file-text" | "disc" | "activity" | "droplet" | "tool" | "percent" | "archive" | "truck" | "thermometer" | "user";
  /** Company modules (lower case) any one of which keeps the row. No entry: always shown. */
  modules?: readonly string[];
};

const ROWS: readonly MoreRow[] = [
  // Pack needs the die list, so a company that bought only the bundles module keeps Dies.
  { key: "dies", href: "/more/dies", labelKey: "nav.dies", icon: "layers", modules: ["dies", "bundles"] },
  { key: "customers", href: "/more/customers", labelKey: "nav.customers", icon: "users", modules: ["customers"] },
  { key: "guides", href: "/more/guides", labelKey: "nav.guides", icon: "book-open" },
  { key: "settings", href: "/more/settings", labelKey: "nav.settings", icon: "settings" },
];

const ORDERS_ROW: MoreRow = { key: "orders", href: "/orders", labelKey: "nav.orders", icon: "file-text" };
const PRESS_ROW: MoreRow = { key: "press", href: "/press", labelKey: "native.tabs.press", icon: "activity" };
const CAST_ROW: MoreRow = { key: "cast", href: "/cast", labelKey: "foundry.casts.title", icon: "droplet" };
const FURNACES_ROW: MoreRow = { key: "furnaces", href: "/more/furnaces", labelKey: "foundry.masters.furnaces", icon: "tool" };
const ALLOYS_ROW: MoreRow = { key: "alloys", href: "/more/alloys", labelKey: "foundry.masters.alloys", icon: "percent" };
const NITRIDING_ROW: MoreRow = { key: "nitriding", href: "/more/nitriding", labelKey: "dieRoom.status.at_nitriding", icon: "archive" };
const MAKERS_ROW: MoreRow = { key: "makers", href: "/more/makers", labelKey: "dieRoom.makers.withMakers", icon: "truck" };
const AGEING_ROW: MoreRow = { key: "ageing", href: "/more/ageing", labelKey: "nav.ageing", icon: "thermometer" };
const MY_WORK_ROW: MoreRow = { key: "me", href: "/more/me", labelKey: "native.hr.title", icon: "user" };
const DIE_ROOM_ROW: MoreRow = { key: "dieRoom", href: "/dies", labelKey: "nav.dies", icon: "disc" };

/**
 * The rows More shows above the language switch. Every member sees them all
 * unless the company has modules switched on and this one is not among them
 * (an empty list means every module is on, as on web's nav).
 *
 * Roles whose bar is the packer set but who hold order.manage / order.plan get an Orders row, and those
 * holding die.card / die.reading get the Dies row that opens the die room's attention list and cards
 * (same screens as the die room and office tabs), replacing the read-only die list. The office and the
 * die room already have those tabs, so they get no duplicate row.
 */
export function showsFoundryMasters(me: Pick<Me, "company"> | null | undefined): boolean {
  const moduleOn = anyModuleOn(me?.company?.modules, ["foundry"]);
  return moduleOn && canAny(me as Me, ["masters.publish"]);
}

export function showsDieWorkLists(me: Pick<Me, "company"> | null | undefined): boolean {
  const moduleOn = anyModuleOn(me?.company?.modules, ["dies"]);
  return moduleOn && canAny(me as Me, ["die.card", "die.maker"]);
}

/** My work (XE-HR): attendance, leave and payslips for a person the office linked to a login: module `hr` on and leave.apply held. */
export function showsMyWork(me: Pick<Me, "company"> | null | undefined): boolean {
  return !!me?.company && anyModuleOn(me.company.modules, ["hr"]) && canAny(me as Me, ["leave.apply"]);
}

/** Payslips on the phone need the `payroll` module as well (the server refuses them otherwise). */
export function showsMyPayslips(me: Pick<Me, "company"> | null | undefined): boolean {
  return showsMyWork(me) && anyModuleOn(me?.company?.modules, ["payroll"]);
}

export function moreRows(me: Pick<Me, "company"> | null | undefined): MoreRow[] {
  const modules = me?.company?.modules;
  // The die room has a Dies tab: More does not list a second "Dies" that opens the read-only list.
  const hasDiesTab = me?.company ? visibleTabs(me as Me).includes("dies") : false;
  const base = ROWS.filter(
    (row) => anyModuleOn(modules, row.modules) && !(row.key === "dies" && hasDiesTab),
  );
  const extra = me?.company ? extraTabs(me as Me) : [];
  const rows = extra.includes("dies") ? base.map((r) => (r.key === "dies" ? DIE_ROOM_ROW : r)) : base;
  // Press (supervisor, manager, admin) is the plant's live view; Ageing, added next, goes in front of it.
  const withPress = extra.includes("press") ? [PRESS_ROW, ...rows] : rows;
  // Cast (the supervisor): the foundry floor sits after Press, before the rest.
  const withCast = extra.includes("cast") ? (extra.includes("press") ? [withPress[0]!, CAST_ROW, ...withPress.slice(1)] : [CAST_ROW, ...withPress]) : withPress;
  const withMasters = me?.company && showsFoundryMasters(me) ? [FURNACES_ROW, ALLOYS_ROW, ...withCast] : withCast;
  const withDieWork = me?.company && showsDieWorkLists(me) ? [NITRIDING_ROW, MAKERS_ROW, ...withMasters] : withMasters;
  // Ageing is the first item for anyone who works or reads the ovens (spec 5: under More, never a sixth tab).
  const withAgeing = me?.company && showsAgeing(me as Me) ? [AGEING_ROW, ...withDieWork] : withDieWork;
  // My work sits just before Guides, for a person who is on the HR list (module `hr`, leave.apply).
  const withMine = me?.company && showsMyWork(me) ? (() => {
    const g = withAgeing.findIndex((r) => r.key === "guides");
    return g < 0 ? [...withAgeing, MY_WORK_ROW] : [...withAgeing.slice(0, g), MY_WORK_ROW, ...withAgeing.slice(g)];
  })() : withAgeing;
  if (!extra.includes("orders")) return withMine;
  // Orders sits right after Dies, before Customers.
  const at = withMine.findIndex((r) => r.key === "dies" || r.key === "dieRoom");
  return [...withMine.slice(0, at + 1), ORDERS_ROW, ...withMine.slice(at + 1)];
}
