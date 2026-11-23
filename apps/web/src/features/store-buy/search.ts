/**
 * `/store/buy?tab=indents|orders|value` (indents when missing). Pure and zod-free: the route file's
 * `validateSearch` imports it, so it stays in the entry chunk (AGENTS.md, route files).
 */
export const BUY_TABS = ["indents", "orders", "value"] as const;
export type BuyTab = (typeof BUY_TABS)[number];

export function parseBuySearch(raw: Record<string, unknown>): { tab?: BuyTab } {
  const tab = raw.tab;
  return typeof tab === "string" && (BUY_TABS as readonly string[]).includes(tab) && tab !== "indents" ? { tab: tab as BuyTab } : {};
}

/** `/store/po/new?indent=<id>`: fill a new order from an approved indent. */
export function parsePoNewSearch(raw: Record<string, unknown>): { indent?: string } {
  const indent = raw.indent;
  return typeof indent === "string" && indent.length > 0 && indent.length <= 64 ? { indent } : {};
}
