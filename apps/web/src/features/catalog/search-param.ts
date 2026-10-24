/**
 * Search params for the catalogue lists. TanStack Router parses a hand-typed `?q=14701` as the
 * number 14701 (and writes a typed "14701" back as `?q="14701"`), so a search term may arrive as
 * a number: keep it as text rather than dropping a die code or phone number someone shared.
 */
export function searchTermParam(value: unknown): string | undefined {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  const term = text.trim();
  return term ? term : undefined;
}

/** A positive whole row offset, else absent (the first page). */
export function offsetParam(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}
