/**
 * The lots list status filter. Its own module so the route's `validateSearch`
 * (which stays in the app entry when the route component is split out) does
 * not pull the lots page into every first visit.
 */
export const LOT_FILTERS = ["all", "booking", "unload", "ok"] as const;
export type LotFilter = (typeof LOT_FILTERS)[number];

export function isLotFilter(v: unknown): v is LotFilter {
  return typeof v === "string" && (LOT_FILTERS as readonly string[]).includes(v);
}
