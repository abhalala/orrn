import { editDistance } from "./names";

/** Share of tokens two normalized headers have in common (Jaccard). */
export function tokenJaccard(a: string, b: string): number {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

/** `1 - distance / longer length`. */
export function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max([...a].length, [...b].length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

export const JACCARD_MIN = 0.5;
export const LEVENSHTEIN_MIN = 0.8;

/** A close enough header for the near fit: Jaccard at least 0.5 or Levenshtein ratio at least 0.8. Returns the score or 0. */
export function headerSimilarity(a: string, b: string): number {
  const j = tokenJaccard(a, b);
  const l = levenshteinRatio(a, b);
  return j >= JACCARD_MIN || l >= LEVENSHTEIN_MIN ? Math.max(j, l) : 0;
}
