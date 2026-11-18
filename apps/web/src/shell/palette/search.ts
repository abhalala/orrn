/**
 * Command palette matching (owner decision 2026-11-18). Interface stub: lane SEARCH replaces the body with fuzzy
 * matching, aliases and ranking; lane ACTIONS consumes `rankItems` and `Searchable` as they are typed here.
 */

export type SearchGroup = "recent" | "commands" | "pages" | "sections";

export type Searchable = {
  id: string;
  group: SearchGroup;
  /** Label in the person's UI language. */
  label: string;
  /** English label, matched too when the UI is Hindi or Gujarati. */
  labelEn?: string;
  /** Keyword alternatives: plant words, Hindi and Gujarati words, abbreviations. */
  aliases?: readonly string[];
  /** Main words used inside the page or section. */
  terms?: readonly string[];
};

export type Match = {
  /** Higher is better. */
  score: number;
  /** The alias or term that matched, when the match was not the label itself. */
  matched?: string;
};

export type Ranked<T extends Searchable> = T & { match: Match };

/** One item against a query; null when it does not match. An empty query matches everything with score 0. */
export function matchItem(query: string, item: Searchable): Match | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0 };
  if (item.label.toLowerCase().includes(q)) return { score: 1 };
  if (item.labelEn?.toLowerCase().includes(q)) return { score: 1 };
  const word = [...(item.aliases ?? []), ...(item.terms ?? [])].find((w) => w.toLowerCase().includes(q));
  return word ? { score: 0.5, matched: word } : null;
}

/** Matching items, best first. Stable for equal scores. */
export function rankItems<T extends Searchable>(query: string, items: readonly T[]): Ranked<T>[] {
  return items
    .map((item, i) => ({ item, i, match: matchItem(query, item) }))
    .filter((x): x is { item: T; i: number; match: Match } => x.match !== null)
    .sort((a, b) => b.match.score - a.match.score || a.i - b.i)
    .map(({ item, match }) => ({ ...item, match }));
}
