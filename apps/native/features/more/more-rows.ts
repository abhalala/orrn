import type { Me } from "@orrn/server/lib/permissions";

import { extraTabs, visibleTabs } from "@/lib/nav";

import { showsAgeing } from "@/features/ageing/model";

export type MoreRowKey = "dies" | "customers" | "guides" | "settings" | "orders" | "dieRoom" | "press" | "ageing";

export type MoreRow = {
  key: MoreRowKey;
  /** The More stack's own screens, or a tab screen reached from More (Orders, Dies). */
  href: "/more/dies" | "/more/customers" | "/more/guides" | "/more/settings" | "/orders" | "/dies" | "/press" | "/more/ageing";
  labelKey: "nav.dies" | "nav.customers" | "nav.guides" | "nav.settings" | "nav.orders" | "native.tabs.press" | "nav.ageing";
  /** A Feather glyph. */
  icon: "layers" | "users" | "book-open" | "settings" | "file-text" | "disc" | "activity" | "thermometer";
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
const AGEING_ROW: MoreRow = { key: "ageing", href: "/more/ageing", labelKey: "nav.ageing", icon: "thermometer" };
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
export function moreRows(me: Pick<Me, "company"> | null | undefined): MoreRow[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  // The die room has a Dies tab: More does not list a second "Dies" that opens the read-only list.
  const hasDiesTab = me?.company ? visibleTabs(me as Me).includes("dies") : false;
  const base = ROWS.filter(
    (row) => (!row.modules || modules.length === 0 || row.modules.some((m) => modules.includes(m))) && !(row.key === "dies" && hasDiesTab),
  );
  const extra = me?.company ? extraTabs(me as Me) : [];
  const rows = extra.includes("dies") ? base.map((r) => (r.key === "dies" ? DIE_ROOM_ROW : r)) : base;
  // Press (supervisor, manager, admin) sits first: it is the plant's live view.
  const withPress = extra.includes("press") ? [PRESS_ROW, ...rows] : rows;
  // Ageing is the first item for anyone who works or reads the ovens (spec 5: under More, never a sixth tab).
  const withAgeing = me?.company && showsAgeing(me as Me) ? [AGEING_ROW, ...withPress] : withPress;
  if (!extra.includes("orders")) return withAgeing;
  // Orders sits right after Dies, before Customers.
  const at = withAgeing.findIndex((r) => r.key === "dies" || r.key === "dieRoom");
  return [...withAgeing.slice(0, at + 1), ORDERS_ROW, ...withAgeing.slice(at + 1)];
}
