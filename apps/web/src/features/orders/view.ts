/**
 * What the orders screens show and offer, as pure functions so the rules are unit-tested and the
 * list, the detail page and the plan board agree. No arithmetic on kg, pieces or baki lives here:
 * the strip, the figures and the blockers are the server's; this file words them.
 */
import type { StatusTone } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

import { orderKgText, pcsText } from "./format";

export type OrderStatus = "booking" | "confirmed" | "dispatching" | "closed" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["booking", "confirmed", "dispatching", "closed", "cancelled"];

export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  booking: "neutral",
  confirmed: "blue",
  dispatching: "amber",
  closed: "green",
  cancelled: "red",
};

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);
}

export function isOpenStatus(status: OrderStatus): boolean {
  return status === "booking" || status === "confirmed" || status === "dispatching";
}

/** What the order's status allows (the server decides; this hides buttons that would only be refused). */
export function statusActions(status: OrderStatus): { edit: boolean; confirm: boolean; close: boolean; cancel: boolean; move: boolean } {
  return {
    edit: status === "booking" || status === "confirmed",
    confirm: status === "booking",
    close: status === "confirmed" || status === "dispatching",
    cancel: status === "booking" || status === "confirmed",
    move: isOpenStatus(status),
  };
}

// ---------------------------------------------------------------------------
// The balance strip (FP-OP-05): eight figures from the server's `strip`.
// ---------------------------------------------------------------------------

export type Strip = {
  orderedG: number;
  orderedPcs: number | null;
  plannedG: number;
  pressedG: number;
  agedG: number;
  packedG: number;
  /** BACKLOG 88: the line funnel the strip reads (pressed >= packed incl. dispatched >= dispatched). Absent on an older server answer. */
  pressedAllG?: number;
  packedAllG?: number;
  inStockG: number;
  /** FP-OP-05: the bundles and pieces that make up "in stock" (absent on an older server answer). */
  inStockBundles?: number;
  inStockPcs?: number;
  /** FP-OP-17: held for this line in the yard (absent on an older server answer). */
  heldG?: number;
  heldPcs?: number;
  heldBundles?: number;
  dispatchedG: number;
  bakiG: number;
  bakiPcs: number | null;
  overG: number;
};

type StripGramKey = "orderedG" | "plannedG" | "pressedG" | "agedG" | "packedG" | "inStockG" | "dispatchedG" | "bakiG";
type StripPcsKey = "orderedPcs" | "bakiPcs";

export const STRIP_CELLS: readonly { key: StripGramKey; pcs?: StripPcsKey; labelKey: MessageKey; balance?: boolean }[] = [
  { key: "orderedG", pcs: "orderedPcs", labelKey: "orders.strip.ordered" },
  { key: "plannedG", labelKey: "orders.strip.planned" },
  { key: "pressedG", labelKey: "orders.strip.pressed" },
  { key: "agedG", labelKey: "orders.strip.aged" },
  // BACKLOG 39: packed counts bundles on a truck too (available + reserved), so it never reads as "In stock".
  { key: "packedG", labelKey: "orders.strip.packed" },
  { key: "inStockG", labelKey: "orders.strip.inStock" },
  { key: "dispatchedG", labelKey: "orders.strip.dispatched" },
  { key: "bakiG", pcs: "bakiPcs", labelKey: "orders.strip.baki", balance: true },
];

export type StripCell = {
  key: StripGramKey;
  labelKey: MessageKey;
  kg: string;
  /** Only where the server gives pieces (ordered, baki, in stock); the other figures are kg. */
  pcs: string | null;
  /** In stock only: how many bundles those kg are (FP-OP-05: "100 kg, 50 pcs, 1 bundle"). */
  bundles: number | null;
  /** The baki cell while kg are still to dispatch. */
  open: boolean;
};

/** The kg a strip cell shows: Pressed and Packed read the line funnel (BACKLOG 88), the rest are the strip's own figure. */
export function stripGrams(strip: Strip, key: StripGramKey): number {
  if (key === "pressedG") return strip.pressedAllG ?? strip.pressedG;
  if (key === "packedG") return strip.packedAllG ?? strip.packedG;
  // Aged is the server's real figure; an answer from before ageing has none, which reads as 0.
  if (key === "agedG") return strip.agedG ?? 0;
  return strip[key];
}

export function stripCells(strip: Strip): StripCell[] {
  return STRIP_CELLS.map((cell) => {
    const grams = stripGrams(strip, cell.key);
    const inStock = cell.key === "inStockG";
    const pcs = inStock ? (strip.inStockPcs ?? null) : cell.pcs ? strip[cell.pcs] : null;
    return {
      key: cell.key,
      labelKey: cell.labelKey,
      kg: orderKgText(grams),
      pcs: pcs == null ? null : pcsText(pcs),
      bundles: inStock ? (strip.inStockBundles ?? null) : null,
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
    const problem = (LINE_PROBLEMS as readonly string[]).find((p) => p === m[2]);
    if (problem) return { kind: "line", n: Number(m[1]), problem: problem as (typeof LINE_PROBLEMS)[number] };
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

/** "PO X is already on SO-4 for this customer" (the server's CONFLICT) as the code it names, if it is that refusal. */
export function poRepeatFromMessage(message: string | undefined | null): { po: string; code: string } | null {
  const m = /^PO (.+) is already on (\S+) for this customer$/.exec(message ?? "");
  return m ? { po: m[1]!, code: m[2]! } : null;
}

// ---------------------------------------------------------------------------
// Reallocating bundles (FP-OP-08): what the sheet checks before asking the server.
// ---------------------------------------------------------------------------


export type MovableBundle = { id: string; status: string; lengthMm: number; movedAway?: boolean };

/** Only available bundles on the line move; held, dispatched, void or moved-away ones do not. */
export function isMovable(b: Pick<MovableBundle, "status" | "movedAway">): boolean {
  return b.status === "available" && !b.movedAway;
}

/** Selected bundles whose cut length differs from the target line's (a warning, never a block). */
export function lengthMismatches(bundles: readonly MovableBundle[], selected: ReadonlySet<string>, targetLengthMm: number | null): string[] {
  if (targetLengthMm == null) return [];
  return bundles.filter((b) => selected.has(b.id) && b.lengthMm !== targetLengthMm).map((b) => b.id);
}

export function reallocateProblem(input: {
  selected: number;
  max: number;
  mismatch: boolean;
  reasonCode: string;
  note: string;
  /** The picked code needs a note (a code the plant set so in Masters); `other` always does. */
  requiresNote?: boolean;
}): MessageKey | null {
  if (input.selected < 1) return "reallocate.pickBundles";
  if (input.selected > input.max) return "reallocate.tooMany";
  const note = input.note.trim();
  if (input.mismatch && !input.reasonCode) return "reallocate.lengthMismatch";
  if (input.reasonCode === "other" && !note) return "common.noteRequired";
  if (input.reasonCode && input.requiresNote && !note) return "common.noteRequiredReason";
  if (!input.reasonCode && !note) return "reallocate.reasonNeeded";
  return null;
}

// ---------------------------------------------------------------------------
// Timeline wording
// ---------------------------------------------------------------------------

/** One end of a move on the timeline: an order line of a customer, or null for plant stock. */
export type TimelineMoveEnd = { customerName: string; orderNumber: string; lineNo: number } | null;

/** The server's reading of an `order.reallocate` row (BACKLOG 34): count, kg, and the ends when known. */
export type TimelineMove = { count: number; kgG: number; from: TimelineMoveEnd[] | null; to?: TimelineMoveEnd };

export type TimelineEvent = {
  id: string;
  at: Date | string;
  action: string;
  actorName: string | null;
  meta: unknown;
  move?: TimelineMove | null;
};

/** "KD Extrusion" (or several, comma separated) for where a move comes from. */
function fromText(from: readonly TimelineMoveEnd[], plant: string): string {
  return [...new Set(from.map((e) => (e ? e.customerName : plant)))].join(", ");
}

/** "Royal Aluminium SO-5" for a line, the plant word for plant stock. */
function toText(to: TimelineMoveEnd, plant: string): string {
  return to ? `${to.customerName} ${to.orderNumber}` : plant;
}

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

export function timelineLabel(
  ev: Pick<TimelineEvent, "action" | "meta" | "move">,
  words: { plant: string } = { plant: "plant stock" },
): { key: MessageKey; vars: Record<string, string | number> } {
  const meta = metaOf(ev.meta);
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const num = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : 0);
  const listLength = (k: string) => (Array.isArray(meta[k]) ? (meta[k] as unknown[]).length : 0);
  switch (ev.action) {
    case "order.create":
      return { key: "orders.timeline.create", vars: {} };
    case "portal.order.create":
      return { key: "orders.timeline.portalCreate", vars: {} };
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
      const status = str("status");
      const move = ev.move;
      // BACKLOG 34: "3 bundles, 57.000 kg, from KD Extrusion to plant stock" (the server's figures).
      if (move && move.from && move.from.length > 0 && move.to !== undefined) {
        const vars = { count: move.count, kg: orderKgText(move.kgG), from: fromText(move.from, words.plant), to: toText(move.to, words.plant) };
        if (status === "pending") return { key: "orders.timeline.movePending", vars };
        if (status === "rejected") return { key: "orders.timeline.moveRejected", vars };
        return { key: "orders.timeline.moveApplied", vars };
      }
      const vars = { count: move?.count ?? num("bundles"), kg: orderKgText(move?.kgG ?? num("kgG")) };
      if (status === "pending") return { key: "orders.timeline.reallocatePending", vars };
      if (status === "rejected") return { key: "orders.timeline.reallocateRejected", vars };
      return { key: "orders.timeline.reallocateApplied", vars };
    }
    // Explorer W1 M5: holds read as words, not "order.hold" / "order.release".
    case "order.hold":
      return { key: "orders.timeline.hold", vars: { count: listLength("serials") || listLength("bundleIds"), kg: orderKgText(num("kgG")), line: num("lineNo") } };
    case "order.release":
      return {
        key: str("reason") === "dispatched" ? "orders.timeline.releaseDispatched" : "orders.timeline.release",
        vars: { count: listLength("serials") || listLength("bundleIds"), kg: orderKgText(num("kgG")), line: num("lineNo"), code: str("dispatchCode") },
      };
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

// ---------------------------------------------------------------------------
// Press plan board (FP-OP-11/12): the draft the planner builds before `plans.create`.
// ---------------------------------------------------------------------------

export const PLAN_MAX_WINDOW_MS = 24 * 3_600_000;

export type DraftDie = { sectionId: string; urgent: boolean; lineIds: string[] };

export function addPlanLine(draft: readonly DraftDie[], sectionId: string, lineId: string): DraftDie[] {
  const at = draft.findIndex((d) => d.sectionId === sectionId);
  if (at < 0) return [...draft, { sectionId, urgent: false, lineIds: [lineId] }];
  if (draft[at]!.lineIds.includes(lineId)) return [...draft];
  return draft.map((d, i) => (i === at ? { ...d, lineIds: [...d.lineIds, lineId] } : d));
}

export function removePlanLine(draft: readonly DraftDie[], sectionId: string, lineId: string): DraftDie[] {
  return draft
    .map((d) => (d.sectionId === sectionId ? { ...d, lineIds: d.lineIds.filter((l) => l !== lineId) } : d))
    .filter((d) => d.lineIds.length > 0);
}

export function movePlanDie(draft: readonly DraftDie[], sectionId: string, delta: -1 | 1): DraftDie[] {
  const from = draft.findIndex((d) => d.sectionId === sectionId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.length) return [...draft];
  const next = [...draft];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Marking a die urgent puts it ahead of the dies that are not (after the urgent ones already there). */
export function toggleUrgent(draft: readonly DraftDie[], sectionId: string): DraftDie[] {
  const die = draft.find((d) => d.sectionId === sectionId);
  if (!die) return [...draft];
  const flipped = { ...die, urgent: !die.urgent };
  const rest = draft.filter((d) => d.sectionId !== sectionId);
  if (!flipped.urgent) return draft.map((d) => (d.sectionId === sectionId ? flipped : d));
  const firstCalm = rest.findIndex((d) => !d.urgent);
  const at = firstCalm < 0 ? rest.length : firstCalm;
  return [...rest.slice(0, at), flipped, ...rest.slice(at)];
}

export type WindowState = "ok" | "order" | "long";

export function windowState(startMs: number, endMs: number): WindowState {
  if (!(endMs > startMs)) return "order";
  if (endMs - startMs > PLAN_MAX_WINDOW_MS) return "long";
  return "ok";
}

const pad = (n: number) => String(n).padStart(2, "0");

const WALL = new Map<string, Intl.DateTimeFormat>();
/** The wall clock of `timeZone` at `ms`: year, month, day, hour, minute. */
function wallOf(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; mi: number } {
  let f = WALL.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    WALL.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) };
}

/**
 * ms -> the value of a `datetime-local` input on the PLANT's clock (`settings.timezone`; BACKLOG 51):
 * the planner reads 08:00 for the plant's 08:00 whatever zone the browser is set to.
 */
export function toZonedInput(ms: number, timeZone: string): string {
  const w = wallOf(ms, timeZone);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

/** The value of a `datetime-local` input, read as the plant's wall clock -> ms, or null when it is not a full date and time. */
export function fromZonedInput(text: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(asUtc)) return null;
  // The zone's offset at a guess, then once more at the answer (a summer-time change between them).
  const offsetAt = (ms: number) => {
    const w = wallOf(ms, timeZone);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000;
  };
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms);
  return ms;
}

export type WindowEnd = { day: "today" | "tomorrow" | "other"; time: string; date: string };

/**
 * The window in words on the plant's clock (BACKLOG 51): "today 08:00 to tomorrow 08:00", where
 * today is the production day the server named (`plans.defaultWindow`), not the browser's date.
 */
export function windowWords(startMs: number, endMs: number, timeZone: string, productionDay: string): { from: WindowEnd; to: WindowEnd } {
  const [y, mo, d] = productionDay.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const tomorrow = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  const end = (ms: number): WindowEnd => {
    const w = wallOf(ms, timeZone);
    const date = `${w.y}-${pad(w.m)}-${pad(w.d)}`;
    return { day: date === productionDay ? "today" : date === tomorrow ? "tomorrow" : "other", time: `${pad(w.h)}:${pad(w.mi)}`, date };
  };
  return { from: end(startMs), to: end(endMs) };
}

/** Every line of one sales order among the open lines, with its die (review I-6 "add all of this SO"). */
export function soLines(
  open: readonly { sectionId: string; lines: readonly { lineId: string; orderId: string }[] }[],
  orderId: string,
): { sectionId: string; lineId: string }[] {
  return open.flatMap((d) => d.lines.filter((l) => l.orderId === orderId).map((l) => ({ sectionId: d.sectionId, lineId: l.lineId })));
}

export function addPlanLines(draft: readonly DraftDie[], items: readonly { sectionId: string; lineId: string }[]): DraftDie[] {
  return items.reduce<DraftDie[]>((cur, i) => addPlanLine(cur, i.sectionId, i.lineId), [...draft]);
}

/** The draft footer: dies and lines (a count, never kg; the kg is the server's). */
export function draftCounts(draft: readonly DraftDie[]): { dies: number; lines: number } {
  return { dies: draft.length, lines: draft.reduce((n, d) => n + d.lineIds.length, 0) };
}

// ---------------------------------------------------------------------------
// The draft's three views (FP-OP-11): by die (the run order), by sales order, flat.
// ---------------------------------------------------------------------------

export const PLAN_VIEWS = ["die", "order", "flat"] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export type DraftLineRef = { sectionId: string; lineId: string };
export type DraftGroup = { key: string; kind: PlanView; sectionId?: string; orderNumber?: string; lines: DraftLineRef[] };

/**
 * The draft's lines grouped for the view picked. By die keeps the dies in run order (they can be
 * moved and marked urgent there); by sales order groups every line of an order together, orders in
 * the order their first line appears; flat is one list in run order.
 */
export function draftGroups(draft: readonly DraftDie[], view: PlanView, orderOf: (lineId: string) => string | undefined): DraftGroup[] {
  const lines = draft.flatMap((d) => d.lineIds.map((lineId) => ({ sectionId: d.sectionId, lineId })));
  if (view === "die") return draft.map((d) => ({ key: d.sectionId, kind: "die", sectionId: d.sectionId, lines: d.lineIds.map((lineId) => ({ sectionId: d.sectionId, lineId })) }));
  if (view === "flat") return lines.length > 0 ? [{ key: "flat", kind: "flat", lines }] : [];
  const byOrder = new Map<string, DraftLineRef[]>();
  for (const l of lines) {
    const order = orderOf(l.lineId) ?? "";
    byOrder.set(order, [...(byOrder.get(order) ?? []), l]);
  }
  return [...byOrder].map(([orderNumber, grouped]) => ({ key: `order:${orderNumber}`, kind: "order", orderNumber, lines: grouped }));
}

/** Distinct sales orders on the draft. */
export function draftOrderCount(draft: readonly DraftDie[], orderOf: (lineId: string) => string | undefined): number {
  return new Set(draft.flatMap((d) => d.lineIds.map((id) => orderOf(id) ?? ""))).size;
}

/** Quick lengths for the order line, in feet (inch companies). */
export const QUICK_FEET = [12, 14, 18] as const;

/** "14701 Patti 1" × 1/8"" (code and name), else "14701 PATTI" (code and series). */
export function dieTitle(die: { sectionCode: string; name?: string | null; series?: string | null; sectionName?: string | null }): string {
  const name = (die.sectionName ?? die.name)?.trim() || die.series?.trim() || "";
  return [die.sectionCode.trim(), name].filter(Boolean).join(" ");
}

/** The `dieInstanceId` / `tierRank` a copy choice ("any", "copy:<id>", "tier:<n>") stands for. */
export function copyChoiceInput(value: string): { dieInstanceId: string | null; tierRank: number | null } {
  if (value.startsWith("copy:")) return { dieInstanceId: value.slice(5), tierRank: null };
  if (value.startsWith("tier:")) {
    const rank = Number(value.slice(5));
    return { dieInstanceId: null, tierRank: Number.isInteger(rank) && rank > 0 ? rank : null };
  }
  return { dieInstanceId: null, tierRank: null };
}

/**
 * FP-OP-17: the yard bundles that can be held for a line, from `orders.matchStock`: on no order
 * line or on this one, and not held yet. (The server checks again and says why if not.)
 */
export function holdableItems<T extends { lineId: string | null; heldForLineId: string | null }>(items: readonly T[], lineId: string): T[] {
  return items.filter((i) => (i.lineId == null || i.lineId === lineId) && i.heldForLineId == null);
}
