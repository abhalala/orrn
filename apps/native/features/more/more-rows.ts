import type { Me } from "@orrn/server/lib/permissions";

export type MoreRowKey = "dies" | "customers" | "guides" | "settings";

export type MoreRow = {
  key: MoreRowKey;
  /** Inside the More stack. */
  href: "/more/dies" | "/more/customers" | "/more/guides" | "/more/settings";
  labelKey: "nav.dies" | "nav.customers" | "nav.guides" | "nav.settings";
  /** A Feather glyph. */
  icon: "layers" | "users" | "book-open" | "settings";
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

/**
 * The rows More shows above the language switch. Every member sees them all
 * unless the company has modules switched on and this one is not among them
 * (an empty list means every module is on, as on web's nav).
 */
export function moreRows(me: Pick<Me, "company"> | null | undefined): MoreRow[] {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return ROWS.filter((row) => !row.modules || modules.length === 0 || row.modules.some((m) => modules.includes(m)));
}
