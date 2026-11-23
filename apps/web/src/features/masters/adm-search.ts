/**
 * URL search params of the plant masters routes (XE ADM). No imports on purpose: route files keep
 * `validateSearch` in the entry chunk, so anything they import lands in the JS every first visit downloads.
 */

export const PLANT_LIST_KINDS = ["department", "designation", "packing_mode", "die_category"] as const;
export type PlantListKind = (typeof PLANT_LIST_KINDS)[number];

export const RULES_TABS = ["formats", "approvals", "insurance"] as const;
export type RulesTab = (typeof RULES_TABS)[number];

function oneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** `?kind=designation|packing_mode|die_category` (departments when missing or unknown, so it keeps a clean URL). */
export function parseListsSearch(search: Record<string, unknown>): { kind?: PlantListKind } {
  const kind = oneOf(search.kind, PLANT_LIST_KINDS);
  return kind && kind !== "department" ? { kind } : {};
}

/** `?tab=approvals|insurance` (number formats when missing or unknown). */
export function parseRulesSearch(search: Record<string, unknown>): { tab?: RulesTab } {
  const tab = oneOf(search.tab, RULES_TABS);
  return tab && tab !== "formats" ? { tab } : {};
}
