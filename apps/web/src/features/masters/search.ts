/**
 * URL search params of the masters routes. No imports on purpose: route files keep
 * `validateSearch` in the shared route tree (entry chunk), so anything they import lands in the
 * JS every first visit to `/` downloads (route budget). The pages import the same types from here.
 */

export type DieCopyStatus = "in_use" | "available" | "at_nitriding" | "retired";
export const DIE_COPY_STATUSES: readonly DieCopyStatus[] = ["available", "in_use", "at_nitriding", "retired"];

export type ScrapTab = "items" | "grades" | "streams";
export const SCRAP_TABS: readonly ScrapTab[] = ["items", "grades", "streams"];

export type VendorFilter = "all" | "draft" | "archived" | "merged";
const VENDOR_FILTERS: readonly Exclude<VendorFilter, "all">[] = ["draft", "archived", "merged"];

export type DieCopiesSearch = { section?: string; status?: DieCopyStatus; offset?: number };
export type VendorsSearch = { q?: string; status?: Exclude<VendorFilter, "all">; offset?: number };

function offsetOf(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** `?section=<section id>&status=available|in_use|at_nitriding|retired&offset=50`. */
export function parseDieCopiesSearch(search: Record<string, unknown>): DieCopiesSearch {
  const out: DieCopiesSearch = {};
  if (typeof search.section === "string" && search.section) out.section = search.section;
  const status = oneOf(search.status, DIE_COPY_STATUSES);
  if (status) out.status = status;
  const offset = offsetOf(search.offset);
  if (offset) out.offset = offset;
  return out;
}

/** `?tab=grades|streams` (items when missing or unknown, so items keeps a clean URL). */
export function parseScrapSearch(search: Record<string, unknown>): { tab?: ScrapTab } {
  const tab = oneOf(search.tab, SCRAP_TABS);
  return tab && tab !== "items" ? { tab } : {};
}

/** `?q=<name or spelling>&status=draft|archived|merged&offset=50`. */
export function parseVendorsSearch(search: Record<string, unknown>): VendorsSearch {
  const out: VendorsSearch = {};
  if (typeof search.q === "string" && search.q.trim()) out.q = search.q.trim().slice(0, 120);
  const status = oneOf(search.status, VENDOR_FILTERS);
  if (status) out.status = status;
  const offset = offsetOf(search.offset);
  if (offset) out.offset = offset;
  return out;
}
