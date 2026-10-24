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
  inStockG: number;
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
  { key: "packedG", labelKey: "orders.strip.packed" },
  { key: "inStockG", labelKey: "orders.strip.inStock" },
  { key: "dispatchedG", labelKey: "orders.strip.dispatched" },
  { key: "bakiG", pcs: "bakiPcs", labelKey: "orders.strip.baki", balance: true },
];

export type StripCell = {
  key: StripGramKey;
  labelKey: MessageKey;
  kg: string;
  /** Only where the server gives pieces (ordered, baki); the other figures are kg. */
  pcs: string | null;
  /** The baki cell while kg are still to dispatch. */
  open: boolean;
};

export function stripCells(strip: Strip): StripCell[] {
  return STRIP_CELLS.map((cell) => {
    const grams = strip[cell.key];
    const pcs = cell.pcs ? strip[cell.pcs] : null;
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
      return b.code;
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

export const REALLOCATE_REASONS = ["length_mismatch", "customer_request", "packed_wrong_order", "other"] as const;
export type ReallocateReason = (typeof REALLOCATE_REASONS)[number];

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
}): MessageKey | null {
  if (input.selected < 1) return "reallocate.pickBundles";
  if (input.selected > input.max) return "reallocate.tooMany";
  const note = input.note.trim();
  if (input.mismatch && !input.reasonCode) return "reallocate.lengthMismatch";
  if (input.reasonCode === "other" && !note) return "common.noteRequired";
  if (!input.reasonCode && !note) return "reallocate.reasonNeeded";
  return null;
}

// ---------------------------------------------------------------------------
// Timeline wording
// ---------------------------------------------------------------------------

export type TimelineEvent = { id: string; at: Date | string; action: string; actorName: string | null; meta: unknown };

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

export function timelineLabel(ev: Pick<TimelineEvent, "action" | "meta">): { key: MessageKey; vars: Record<string, string | number> } {
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
      const status = str("status");
      const vars = { count: num("bundles"), kg: orderKgText(num("kgG")) };
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

/** Next whole hour, and 24 hours after it (the plan's longest window). */
export function defaultWindow(nowMs: number): { start: number; end: number } {
  const hour = 3_600_000;
  const start = Math.ceil(nowMs / hour) * hour;
  return { start, end: start + PLAN_MAX_WINDOW_MS };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ms -> the value of a `datetime-local` input, in the browser's (the plant's) zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The value of a `datetime-local` input -> ms, or null when it is not a full date and time. */
export function fromLocalInput(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export type CandidateDie = {
  sectionId: string;
  sectionCode: string;
  lines: { lineId: string; customerId: string; customerName: string; poNumber: string | null; orderNumber: string; planableG: number }[];
};

export type OtherPartyNote = {
  sectionId: string;
  sectionCode: string;
  customerName: string;
  poNumber: string | null;
  orderNumber: string;
  planableG: number;
};

/**
 * FP-OP-15 while drafting: open lines of OTHER customers on a die that is on the draft and not
 * on it yet. A note, never a block (the release returns the server's own list).
 */
export function otherPartyNotes(draft: readonly DraftDie[], candidates: readonly CandidateDie[]): OtherPartyNote[] {
  const out: OtherPartyNote[] = [];
  for (const d of draft) {
    const cand = candidates.find((c) => c.sectionId === d.sectionId);
    if (!cand) continue;
    const onDraft = cand.lines.filter((l) => d.lineIds.includes(l.lineId));
    const customers = new Set(onDraft.map((l) => l.customerId));
    for (const l of cand.lines) {
      if (d.lineIds.includes(l.lineId) || customers.has(l.customerId)) continue;
      out.push({
        sectionId: cand.sectionId,
        sectionCode: cand.sectionCode,
        customerName: l.customerName,
        poNumber: l.poNumber,
        orderNumber: l.orderNumber,
        planableG: l.planableG,
      });
    }
  }
  return out;
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
