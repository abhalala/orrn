/**
 * Search params of `/costing` (XE parity lane COST). Plain functions, no imports: `validateSearch` stays in the
 * route entry chunk (AGENTS.md "Route files and the `/` budget"), so the lists are written out here.
 */
export const COST_TABS = ["outlook", "cost", "profit", "capacity", "forecast", "dies", "settings"] as const;
export type CostTab = (typeof COST_TABS)[number];

export type CostingSearch = { tab?: CostTab };

/** `outlook` is the default and stays out of the URL; anything unknown is dropped. */
export function parseCostingSearch(raw: Record<string, unknown>): CostingSearch {
  const out: CostingSearch = {};
  const tab = typeof raw.tab === "string" ? (COST_TABS as readonly string[]).indexOf(raw.tab) : -1;
  if (tab > 0) out.tab = COST_TABS[tab];
  return out;
}
