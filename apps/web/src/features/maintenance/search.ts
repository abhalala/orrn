/**
 * The work order list's URL (`/maintenance/work-orders?status=done&asset=<id>`). A pure module: the route's
 * `validateSearch` imports it, so it must not import a page or zod (AGENTS.md, route files).
 */
export const WO_FILTERS = ["live", "open", "in_progress", "waiting_spares", "done", "cancelled", "all"] as const;
export type WoFilter = (typeof WO_FILTERS)[number];

export type WoSearch = { status?: Exclude<WoFilter, "live">; asset?: string };

export function parseWoSearch(raw: Record<string, unknown>): WoSearch {
  const out: WoSearch = {};
  const s = raw.status;
  if (typeof s === "string" && s !== "live" && (WO_FILTERS as readonly string[]).includes(s)) out.status = s as Exclude<WoFilter, "live">;
  const a = raw.asset;
  if (typeof a === "string" && a.length > 0 && a.length <= 64) out.asset = a;
  return out;
}

export function woFilterOf(search: WoSearch): WoFilter {
  return search.status ?? "live";
}
