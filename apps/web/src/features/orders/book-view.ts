/**
 * The order book at a glance (FP-OP-20): the URL filters, the query the list asks, and how a bar
 * is drawn. Every kg figure is the server's (`orders.list`, `orders.bookTotals`): a bar's segment
 * widths are only the CSS share of the ordered kg the server already made add up, never a sum
 * the page works out for the person.
 */
import type { MessageKey } from "@orrn/i18n";

import type { OrderStatus } from "./view";

export const BOOK_STAGES = ["dispatched", "in_stock", "held", "pressed", "planned", "unplanned", "over"] as const;
export type BookStage = (typeof BOOK_STAGES)[number];

/** The status chips: open (default), one status, or late (open orders past their date). */
export const BOOK_SHOWS = ["open", "booking", "confirmed", "dispatching", "late", "closed", "cancelled"] as const;
export type BookShow = (typeof BOOK_SHOWS)[number];

export type BookSearch = {
  q?: string;
  party?: string;
  city?: string;
  show?: BookShow;
  from?: string;
  to?: string;
  stage?: BookStage;
  page?: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, max = 100): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && s.length <= max ? s : undefined;
}

function ymd(v: unknown): string | undefined {
  return typeof v === "string" && YMD.test(v) ? v : undefined;
}

/** The URL's search params as a clean filter: unknown or malformed values are dropped, defaults are omitted. */
export function parseBookSearch(raw: Record<string, unknown>): BookSearch {
  const out: BookSearch = {};
  const q = text(raw.q);
  if (q) out.q = q;
  const party = text(raw.party, 64);
  if (party) out.party = party;
  const city = text(raw.city, 80);
  if (city) out.city = city;
  if (typeof raw.show === "string" && (BOOK_SHOWS as readonly string[]).includes(raw.show) && raw.show !== "open") out.show = raw.show as BookShow;
  const from = ymd(raw.from);
  if (from) out.from = from;
  const to = ymd(raw.to);
  if (to) out.to = to;
  if (typeof raw.stage === "string" && (BOOK_STAGES as readonly string[]).includes(raw.stage)) out.stage = raw.stage as BookStage;
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 0) out.page = page;
  return out;
}

/** A filter change: sets or clears one key and always goes back to page 1. */
export function withBookFilter(current: BookSearch, patch: Partial<Record<keyof BookSearch, string | number | undefined>>): BookSearch {
  const next: Record<string, unknown> = { ...current, page: undefined };
  for (const [k, v] of Object.entries(patch)) next[k] = v === "" ? undefined : v;
  return parseBookSearch(next);
}

/** How many filters (apart from the status chip and the page) are narrowing the book. */
export function activeBookFilters(s: BookSearch): number {
  return [s.q, s.party, s.city, s.from, s.to, s.stage].filter(Boolean).length;
}

export const BOOK_PAGE = 25;

/** The `orders.list` / `orders.bookTotals` input for these filters (the page is added by the list). */
export function bookQueryInput(s: BookSearch) {
  const show = s.show ?? "open";
  return {
    ...(show === "open" ? { openOnly: true } : {}),
    ...(show === "late" ? { late: true } : {}),
    ...(show === "booking" || show === "confirmed" || show === "dispatching" || show === "closed" || show === "cancelled"
      ? { status: show satisfies OrderStatus }
      : {}),
    ...(s.q ? { search: s.q } : {}),
    ...(s.party ? { customerId: s.party } : {}),
    ...(s.city ? { city: s.city } : {}),
    ...(s.from ? { dateFrom: s.from } : {}),
    ...(s.to ? { dateTo: s.to } : {}),
    ...(s.stage ? { stage: s.stage } : {}),
  };
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export type Bar = {
  dispatchedG: number;
  inStockG: number;
  /** On a truck being loaded, or held in the yard for the order (FP-OP-17). */
  heldG: number;
  pressedG: number;
  plannedG: number;
  restG: number;
  overG: number;
  dispatchedBp: number;
};

export type BarKey = "dispatched" | "inStock" | "held" | "pressed" | "planned" | "rest";

export type BarSegment = {
  key: BarKey;
  stage: BookStage;
  labelKey: MessageKey;
  /** The server's kg; the segment's CSS flex-grow, so the browser shares out the bar (no sums here). */
  grams: number;
};

const SEGMENTS: readonly { key: BarKey; stage: BookStage; grams: keyof Bar; labelKey: MessageKey }[] = [
  { key: "dispatched", stage: "dispatched", grams: "dispatchedG", labelKey: "orders.book.stage.dispatched" },
  { key: "inStock", stage: "in_stock", grams: "inStockG", labelKey: "orders.book.stage.in_stock" },
  { key: "held", stage: "held", grams: "heldG", labelKey: "orders.book.stage.held" },
  { key: "pressed", stage: "pressed", grams: "pressedG", labelKey: "orders.book.stage.pressed" },
  { key: "planned", stage: "planned", grams: "plannedG", labelKey: "orders.book.stage.planned" },
  { key: "rest", stage: "unplanned", grams: "restG", labelKey: "orders.book.stage.unplanned" },
];

/**
 * The segments in bar order. The server's segments add up to the ordered kg, so drawing each with
 * `flex-grow: grams` fills the bar in proportion without the page dividing anything.
 */
export function barSegments(bar: Bar): BarSegment[] {
  return SEGMENTS.map((s) => ({ key: s.key, stage: s.stage, labelKey: s.labelKey, grams: bar[s.grams] as number }));
}

/** "0 planned, nothing else": the bar is all "not planned" (a grey bar plus its baki). */
export function nothingPlanned(bar: Bar): boolean {
  return bar.dispatchedG === 0 && bar.inStockG === 0 && bar.heldG === 0 && bar.pressedG === 0 && bar.plannedG === 0;
}


/** Tone class of one segment (colour is never the only signal: the legend names every segment). */
export const BAR_TONE: Record<BarKey, string> = {
  dispatched: "bg-tone-green",
  inStock: "bg-tone-blue",
  held: "bg-tone-blue/45",
  pressed: "bg-tone-amber",
  planned: "bg-tone-neutral-ink/55",
  rest: "bg-surface-sunken",
};

export type BookTotals = {
  orders: number;
  openOrders: number;
  lateOrders: number;
  orderedG: number;
  dispatchedG: number;
  inStockG: number;
  inStockBundles: number;
  heldG: number;
  heldBundles: number;
  bakiG: number;
  dispatchedBp: number;
};

/** The order a late chip reads: which date made it late. */
export function lateRuleKey(rule: string | null | undefined): MessageKey {
  return rule === "expected_date" ? "orders.lateRule.expected_date" : "orders.lateRule.order_date";
}
