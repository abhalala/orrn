import { BUNDLE_STATUSES, type BundleStatus } from "@orrn/domain";

/** Bundles per page on every stock list (server `listBundles` allows up to 100). */
export const PAGE_SIZE = 50;

const MAX_QUERY = 100;
const MAX_ID = 64;

/** `/stock/bundles` URL state. Old `/bundles?dieId=…&groupId=…` links keep their filter. */
export type BundlesSearch = {
  status?: BundleStatus;
  q?: string;
  page?: number;
  dieId?: string;
  groupId?: string;
};

/** `/stock/$dieId` URL state. No status means the section's default (`sectionDefaultStatus`). */
export type SectionSearch = {
  status?: BundleStatus | "all";
  page?: number;
};

function isStatus(v: unknown): v is BundleStatus {
  return typeof v === "string" && (BUNDLE_STATUSES as readonly string[]).includes(v);
}

function page(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 2 ? n : undefined;
}

function id(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID ? v : undefined;
}

function query(v: unknown): string | undefined {
  // TanStack Router parses `?q=4086` as a number.
  const text = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : "";
  const trimmed = text.trim().slice(0, MAX_QUERY);
  return trimmed ? trimmed : undefined;
}

/** Drops keys whose value is undefined, so URLs stay clean and equality checks are simple. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function validateBundlesSearch(raw: Record<string, unknown>): BundlesSearch {
  return compact({
    status: isStatus(raw.status) ? raw.status : undefined,
    q: query(raw.q),
    page: page(raw.page),
    dieId: id(raw.dieId),
    groupId: id(raw.groupId),
  });
}

export function validateSectionSearch(raw: Record<string, unknown>): SectionSearch {
  const status = raw.status === "all" ? "all" : isStatus(raw.status) ? raw.status : undefined;
  return compact({ status, page: page(raw.page) });
}

/**
 * The chip a section opens on (spec §3 Stock: available first): In stock,
 * or Held when every bundle is held, or All when nothing is on the floor,
 * so a section never opens on an empty list it has bundles for.
 */
export function sectionDefaultStatus(state: "inStock" | "held" | "none"): BundleStatus | "all" {
  return state === "inStock" ? "available" : state === "held" ? "reserved" : "all";
}

/** Server offset for a 1-based page (page 1 is omitted from the URL). */
export function offsetOf(p: number | undefined): number {
  return ((p ?? 1) - 1) * PAGE_SIZE;
}
