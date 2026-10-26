import type { StatusTone } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

import { serverRefusalLines } from "@/lib/server-refusal";

/**
 * What the Orders screens show and offer, as pure functions (mirrors apps/web/src/features/orders/{view,format,errors}.ts).
 * No arithmetic on kg, pieces or baki lives here: the strip, the figures, the late days and the confirm
 * blockers are the server's; this file words them.
 */
export type OrderStatus = "booking" | "confirmed" | "dispatching" | "closed" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["booking", "confirmed", "dispatching", "closed", "cancelled"];

export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  booking: "neutral",
  confirmed: "blue",
  dispatching: "amber",
  closed: "green",
  cancelled: "red",
};

export const STATUS_KEY: Record<OrderStatus, MessageKey> = {
  booking: "orders.status.booking",
  confirmed: "orders.status.confirmed",
  dispatching: "orders.status.dispatching",
  closed: "orders.status.closed",
  cancelled: "orders.status.cancelled",
};

export function isOpenStatus(status: OrderStatus): boolean {
  return status === "booking" || status === "confirmed" || status === "dispatching";
}

/** The list's three views: open orders, closed, cancelled. */
export type OrderFilter = "open" | "closed" | "cancelled";
export const ORDER_FILTERS: readonly OrderFilter[] = ["open", "closed", "cancelled"];

/** The `orders.list` input for one view. */
export function listInput(filter: OrderFilter, search: string): { openOnly?: true; status?: "closed" | "cancelled"; search?: string; limit: number } {
  const base = { limit: 30, ...(search ? { search } : {}) };
  if (filter === "open") return { ...base, openOnly: true };
  return { ...base, status: filter };
}

/** The chip on a late order: the server's `lateDays`, null when the order is not late. */
export function lateLabel(lateDays: number | null | undefined, t: Translate): string | null {
  return lateDays != null && lateDays > 0 ? t("orders.late", { days: lateDays }) : null;
}

const KG = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const PCS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Grams as kg to the gram: "553.500", "1,280.000". */
export function orderKgText(grams: number): string {
  return KG.format(grams / 1000);
}

export function pcsText(pcs: number): string {
  return PCS.format(pcs);
}

/** A weight basis in milli kg per 12 ft as "12.300". */
export function milliText(milli: number): string {
  return (milli / 1000).toFixed(3);
}

// ---------------------------------------------------------------------------
// The balance strip: eight figures from the server's per-line `strip`.
// ---------------------------------------------------------------------------

export type Strip = {
  orderedG: number;
  orderedPcs: number | null;
  plannedG: number;
  pressedG: number;
  agedG: number;
  packedG: number;
  /** BACKLOG 88: the line funnel (pressed >= packed incl. dispatched >= dispatched); absent on an older server answer. */
  pressedAllG?: number;
  packedAllG?: number;
  inStockG: number;
  dispatchedG: number;
  bakiG: number;
  bakiPcs: number | null;
  overG: number;
};

type GramKey = "orderedG" | "plannedG" | "pressedG" | "agedG" | "packedG" | "inStockG" | "dispatchedG" | "bakiG";

const CELLS: readonly { key: GramKey; pcs?: "orderedPcs" | "bakiPcs"; labelKey: MessageKey; balance?: boolean }[] = [
  { key: "orderedG", pcs: "orderedPcs", labelKey: "orders.strip.ordered" },
  { key: "plannedG", labelKey: "orders.strip.planned" },
  { key: "pressedG", labelKey: "orders.strip.pressed" },
  { key: "agedG", labelKey: "orders.strip.aged" },
  { key: "packedG", labelKey: "orders.strip.packed" },
  { key: "inStockG", labelKey: "orders.strip.inStock" },
  { key: "dispatchedG", labelKey: "orders.strip.dispatched" },
  { key: "bakiG", pcs: "bakiPcs", labelKey: "orders.strip.baki", balance: true },
];

export type StripCell = { key: GramKey; labelKey: MessageKey; kg: string; pcs: string | null; open: boolean };

/** Pressed and Packed read the line funnel (BACKLOG 88); the rest are the strip's own figure. */
export function stripGrams(strip: Strip, key: GramKey): number {
  if (key === "pressedG") return strip.pressedAllG ?? strip.pressedG;
  if (key === "packedG") return strip.packedAllG ?? strip.packedG;
  // Aged is the server's real figure; an answer from before ageing has none, which reads as 0.
  if (key === "agedG") return strip.agedG ?? 0;
  return strip[key];
}

export function stripCells(strip: Strip): StripCell[] {
  return CELLS.map((cell) => {
    const pcs = cell.pcs ? strip[cell.pcs] : null;
    const grams = stripGrams(strip, cell.key);
    return {
      key: cell.key,
      labelKey: cell.labelKey,
      kg: orderKgText(grams),
      pcs: pcs == null ? null : pcsText(pcs),
      open: Boolean(cell.balance) && grams > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Confirm blockers (server codes: po_number, no_lines, line_{n}_{pcs|kg|length|alloy|temper|die_or_tier}).
// ---------------------------------------------------------------------------

export type ParsedBlocker =
  | { kind: "po_number" }
  | { kind: "no_lines" }
  | { kind: "line"; n: number; problem: "pcs" | "kg" | "length" | "alloy" | "temper" | "die_or_tier" }
  | { kind: "unknown"; code: string };

const LINE_PROBLEMS = ["pcs", "kg", "length", "alloy", "temper", "die_or_tier"] as const;

export function parseBlocker(code: string): ParsedBlocker {
  if (code === "po_number") return { kind: "po_number" };
  if (code === "no_lines") return { kind: "no_lines" };
  const m = /^line_(\d+)_(.+)$/.exec(code);
  if (m) {
    const problem = LINE_PROBLEMS.find((p) => p === m[2]);
    if (problem) return { kind: "line", n: Number(m[1]), problem };
  }
  return { kind: "unknown", code };
}

/** One blocker as a sentence in the person's language. */
export function blockerText(code: string, t: Translate): string {
  const b = parseBlocker(code);
  switch (b.kind) {
    case "po_number":
      return t("orders.blockers.po_number");
    case "no_lines":
      return t("orders.blockers.no_lines");
    case "line":
      return t("orders.blockers.line", { n: b.n, problem: t(`orders.blockers.${b.problem}`) });
    default:
      return t("refusal.unknown");
  }
}

const BLOCKER_PREFIX = "Fill these before confirming:";

/** The codes inside the server's refusal text ("Fill these before confirming: po_number, line_1_pcs"). */
export function blockersFromMessage(message: string | undefined | null): string[] {
  if (!message) return [];
  const at = message.indexOf(BLOCKER_PREFIX);
  if (at < 0) return [];
  return message
    .slice(at + BLOCKER_PREFIX.length)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** "PO X is already on SO-4 for this customer" (the server's CONFLICT) as the PO and order it names. */
export function poRepeatFromMessage(message: string | undefined | null): { po: string; code: string } | null {
  const m = /^PO (.+) is already on (\S+) for this customer$/.exec(message ?? "");
  return m ? { po: m[1]!, code: m[2]! } : null;
}

/**
 * What to tell someone when an orders write was refused, as lines: confirm blockers in their language, and
 * every other sentence the orders routers raise from the app's own dictionary (`serverRefusal`; BACKLOG 43).
 * The server's English is never shown. An answer that never came ("unsure") says to check the order before trying again.
 */
export function orderErrorLines(t: Translate, error: unknown): string[] {
  return serverRefusalLines(error, t, (code) => blockerText(code, t));
}

// ---------------------------------------------------------------------------
// Timeline wording (the order's audit events).
// ---------------------------------------------------------------------------

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

export function timelineLabel(ev: { action: string; meta: unknown }): { key: MessageKey; vars: Record<string, string | number> } {
  const meta = metaOf(ev.meta);
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const num = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : 0);
  switch (ev.action) {
    case "order.create":
      return { key: "orders.timeline.create", vars: {} };
    case "order.update":
      return { key: "orders.timeline.update", vars: {} };
    case "order.confirm":
      return { key: "orders.timeline.confirm", vars: {} };
    case "order.close":
      return { key: "orders.timeline.close", vars: {} };
    case "order.cancel":
      return { key: "orders.timeline.cancel", vars: {} };
    case "order.weight.refresh":
      return { key: "orders.timeline.weightRefresh", vars: {} };
    case "order.reallocate": {
      const vars = { count: num("bundles"), kg: orderKgText(num("kgG")) };
      const status = str("status");
      if (status === "pending") return { key: "orders.timeline.reallocatePending", vars };
      if (status === "rejected") return { key: "orders.timeline.reallocateRejected", vars };
      return { key: "orders.timeline.reallocateApplied", vars };
    }
    case "plan.create":
      return { key: "orders.timeline.planCreate", vars: { number: str("number") } };
    case "plan.release":
      return { key: "orders.timeline.planRelease", vars: { number: str("number") } };
    case "plan.cancel":
      return { key: "orders.timeline.planCancel", vars: { number: str("number") } };
    case "plan.close":
      return { key: "orders.timeline.planClose", vars: { number: str("number") } };
    case "plan.update":
      return { key: "orders.timeline.planUpdate", vars: { number: str("number") } };
    case "bundle.receipt.create":
      return { key: "orders.timeline.packed", vars: {} };
    case "dispatch.complete":
      return { key: "orders.timeline.dispatched", vars: {} };
    case "dispatch.overdraw.request":
      return { key: "orders.timeline.overdraw", vars: {} };
    default:
      return { key: "orders.timeline.other", vars: { action: ev.action } };
  }
}

/** "PATTI 14701 Patti 1": the code then the name (else the series). */
export function dieTitle(die: { sectionCode: string; name?: string | null; series?: string | null; sectionName?: string | null }): string {
  const name = (die.sectionName ?? die.name)?.trim() || die.series?.trim() || "";
  return [die.sectionCode.trim(), name].filter(Boolean).join(" ");
}
