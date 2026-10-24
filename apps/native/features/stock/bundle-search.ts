import { BUNDLE_STATUSES, type BundleStatus } from "@orrn/domain";

/** Bundles per page on every stock list (server `listBundles` allows up to 100). */
export const PAGE_SIZE = 50;

/** Chips on the bundle lists: every status, or one. */
export type StatusFilterValue = BundleStatus | "all";
export const STATUS_FILTERS: readonly StatusFilterValue[] = ["all", "available", "reserved", "dispatched", "void"];

const MAX_QUERY = 100;
const MAX_ID = 64;

/** `/stock/bundles` search params as expo-router hands them (strings, or arrays when repeated). */
export type BundlesParams = { status?: BundleStatus; q?: string; dieId?: string; groupId?: string };

function first(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}

function isStatus(v: unknown): v is BundleStatus {
  return typeof v === "string" && (BUNDLE_STATUSES as readonly string[]).includes(v);
}

function id(v: unknown): string | undefined {
  const x = first(v);
  return x && x.length <= MAX_ID ? x : undefined;
}

/** Cleans the params of `/stock/bundles`: unknown statuses and over-long text are dropped. */
export function parseBundlesParams(raw: Record<string, unknown>): BundlesParams {
  const status = first(raw.status);
  const q = first(raw.q)?.trim().slice(0, MAX_QUERY);
  const out: BundlesParams = {};
  if (isStatus(status)) out.status = status;
  if (q) out.q = q;
  const dieId = id(raw.dieId);
  if (dieId) out.dieId = dieId;
  const groupId = id(raw.groupId);
  if (groupId) out.groupId = groupId;
  return out;
}

/** The chip a section opens on: In stock, or Held when every bundle is held, or All when nothing is on the floor. */
export function sectionDefaultStatus(state: "inStock" | "held" | "none"): StatusFilterValue {
  return state === "inStock" ? "available" : state === "held" ? "reserved" : "all";
}

/** Server offset for a 1-based page. */
export function offsetOf(page: number): number {
  return (Math.max(1, page) - 1) * PAGE_SIZE;
}

/** The page to show for `total` bundles: the same page while it has rows, else the last page that has some. */
export function pageWithinTotal(page: number, total: number): number {
  if (offsetOf(page) < total) return Math.max(1, page);
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** `1-50 of 120` numbers for the pager. */
export function pageWindow(page: number, total: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  const start = offsetOf(page);
  const to = Math.min(total, start + PAGE_SIZE);
  return { from: total === 0 ? 0 : start + 1, to, hasPrev: page > 1, hasNext: to < total };
}
