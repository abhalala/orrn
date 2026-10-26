/**
 * Search params of the ageing routes. Plain functions (no zod, no components): `validateSearch` stays
 * in the route entry chunk (AGENTS.md "Web bundle"), so this module imports nothing.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pickId = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : undefined);
const STATUSES = ["loading", "in_oven", "out", "released", "held", "closed", "void"] as const;

export type HistoryStatus = (typeof STATUSES)[number];
export type HistorySearch = { from?: string; to?: string; oven?: string; status?: HistoryStatus; recipe?: string; offset?: number };

export function parseHistorySearch(raw: Record<string, unknown>): HistorySearch {
  const out: HistorySearch = {};
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  const oven = pickId(raw.oven);
  if (oven) out.oven = oven;
  const recipe = typeof raw.recipe === "string" && raw.recipe && raw.recipe.length <= 40 ? raw.recipe : undefined;
  if (recipe) out.recipe = recipe;
  if (typeof raw.status === "string" && (STATUSES as readonly string[]).includes(raw.status)) out.status = raw.status as HistoryStatus;
  const offset = Number(raw.offset);
  if (Number.isInteger(offset) && offset > 0) out.offset = offset;
  return out;
}

export type AgeingReportSearch = { from?: string; to?: string; oven?: string; shift?: string; status?: HistoryStatus; group?: "day" | "oven" | "none"; offset?: number };

export function parseAgeingReportSearch(raw: Record<string, unknown>): AgeingReportSearch {
  const out: AgeingReportSearch = parseHistorySearch(raw);
  delete (out as HistorySearch).recipe;
  const shift = pickId(raw.shift);
  if (shift) (out as AgeingReportSearch).shift = shift;
  const g = raw.group;
  if (g === "day" || g === "oven") (out as AgeingReportSearch).group = g;
  return out as AgeingReportSearch;
}

/** `/ageing/load?trolley=<id>`: the trolley chosen on the board; `batch=<id>` adds to a loading batch. */
export type LoadSearch = { trolley?: string; batch?: string };

export function parseLoadSearch(raw: Record<string, unknown>): LoadSearch {
  const out: LoadSearch = {};
  const trolley = pickId(raw.trolley);
  const batch = pickId(raw.batch);
  if (trolley) out.trolley = trolley;
  if (batch) out.batch = batch;
  return out;
}

export type MastersShow = "active" | "all";
