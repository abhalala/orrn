/**
 * What the Pack die picker lists. The plant has about a thousand sections and
 * `die.list` returns at most 100 per call, so the picker never pretends its
 * first page is the whole catalogue: Recent dies are looked up by id (they
 * lead even when they are not in that page), and when more dies exist the
 * picker says so and asks for a code. Pure; die-step.tsx wires the queries.
 */

export type DieOption = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  weightMinG: number;
  weightMaxG: number;
  status: string;
};

/** Recent dies shown first: the dies of the latest sessions, newest first. */
export const RECENT_MAX = 5;

/** Distinct die ids of the latest sessions (newest first), at most `max`. */
export function recentDieIds(sessions: readonly { dieId: string }[] | undefined, max = RECENT_MAX): string[] {
  const ids: string[] = [];
  for (const s of sessions ?? []) {
    if (!ids.includes(s.dieId)) ids.push(s.dieId);
    if (ids.length >= max) break;
  }
  return ids;
}

const bySection = (a: DieOption, b: DieOption) =>
  a.sectionCode.localeCompare(b.sectionCode, "en", { numeric: true }) || a.series.localeCompare(b.series);

const isActive = (d: DieOption | undefined): d is DieOption => !!d && d.status !== "archived";

type Page = { items: readonly DieOption[]; total: number } | undefined;

export type DieListView = {
  /** Recent dies (no search typed), in recency order. */
  recent: DieOption[];
  /** The other listed dies, in section order. */
  rest: DieOption[];
  /** Set when the list holds fewer dies than exist ("Showing 100 of 1,047"). */
  more: { shown: number; total: number } | null;
};

/**
 * The picker's groups. `page` is the first page of active dies, `searched`
 * the matches for the typed text, `recent` the recent dies looked up by id
 * (undefined while loading or when the die is gone).
 */
export function dieListView(opts: {
  query: string;
  page: Page;
  searched: Page;
  recent: readonly (DieOption | undefined)[];
}): DieListView {
  const more = (p: NonNullable<Page>) => (p.total > p.items.length ? { shown: p.items.length, total: p.total } : null);
  if (opts.query !== "") {
    const p = opts.searched;
    if (!p) return { recent: [], rest: [], more: null };
    return { recent: [], rest: p.items.filter(isActive).sort(bySection), more: more(p) };
  }
  const recent = opts.recent.filter(isActive);
  const p = opts.page;
  if (!p) return { recent, rest: [], more: null };
  const recentIds = new Set(recent.map((d) => d.id));
  return {
    recent,
    rest: p.items.filter((d) => isActive(d) && !recentIds.has(d.id)).sort(bySection),
    more: more(p),
  };
}
