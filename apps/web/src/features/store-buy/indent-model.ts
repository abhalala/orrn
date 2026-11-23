/**
 * The indent screens' logic, without React: line checks, the create input, and which buttons show for a
 * status and a person (server: routers/storeIndent.ts).
 */
import { parseQtyMilli, type QtyProblem, type StoreUnit } from "@/features/store/store-qty";

/** At most this many items on one indent (server STORE_MAX_DOC_LINES). */
export const MAX_INDENT_LINES = 40;

export type IndentDraftLine = { key: string; itemId: string | null; qty: string };
export type LineProblem = "item" | "twice" | QtyProblem;
export type IndentLineInput = { itemId: string; qtyMilli: number };
export type IndentCreateInput = {
  department: string;
  neededBy: string | null;
  reason: string;
  lines: IndentLineInput[];
};

export type IndentChecked =
  | { ok: true; input: IndentCreateInput }
  | { ok: false; department: boolean; neededBy: boolean; noLines: boolean; lines: Record<string, LineProblem> };

/** A real calendar day typed as YYYY-MM-DD. */
export function isDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** A blank draft line. */
export function blankLine(key: string): IndentDraftLine {
  return { key, itemId: null, qty: "" };
}

/** Check the whole form; on success the exact input for `store.indents.create`. */
export function checkIndent(
  draft: { department: string; neededBy: string; reason: string; lines: IndentDraftLine[] },
  unitOf: (itemId: string) => StoreUnit | null,
): IndentChecked {
  const department = draft.department.trim();
  const neededBy = draft.neededBy.trim();
  const problems: Record<string, LineProblem> = {};
  const lines: IndentLineInput[] = [];
  const seen = new Set<string>();
  for (const l of draft.lines) {
    if (!l.itemId) {
      problems[l.key] = "item";
      continue;
    }
    if (seen.has(l.itemId)) {
      problems[l.key] = "twice";
      continue;
    }
    seen.add(l.itemId);
    const parsed = parseQtyMilli(l.qty, unitOf(l.itemId));
    if (!parsed.ok) {
      problems[l.key] = parsed.problem;
      continue;
    }
    lines.push({ itemId: l.itemId, qtyMilli: parsed.milli });
  }
  const badDay = neededBy !== "" && !isDay(neededBy);
  const noLines = draft.lines.length === 0;
  if (department === "" || badDay || noLines || Object.keys(problems).length > 0) {
    return { ok: false, department: department === "", neededBy: badDay, noLines, lines: problems };
  }
  return { ok: true, input: { department, neededBy: neededBy === "" ? null : neededBy, reason: draft.reason.trim(), lines } };
}

export type IndentActions = { approve: boolean; reject: boolean; cancel: boolean; makeOrder: boolean };

/** Which buttons an indent shows to this person. */
export function indentActions(
  status: string,
  indent: { createdBy: string | null },
  who: { userId: string | null; decide: boolean; manageOrders: boolean },
): IndentActions {
  const open = status === "open";
  const live = open || status === "approved";
  const mine = who.userId !== null && indent.createdBy === who.userId;
  return {
    approve: open && who.decide,
    reject: open && who.decide,
    cancel: live && (mine || who.decide),
    makeOrder: status === "approved" && who.manageOrders,
  };
}

export const INDENT_STATUSES = ["open", "approved", "rejected", "ordered", "cancelled"] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];

export function indentTone(status: string): "amber" | "green" | "red" | "blue" | "neutral" {
  switch (status) {
    case "open":
      return "amber";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "ordered":
      return "blue";
    default:
      return "neutral";
  }
}

/** A status the shared words know; an unknown one reads as waiting. */
export function knownStatus(status: string): IndentStatus {
  return (INDENT_STATUSES as readonly string[]).includes(status) ? (status as IndentStatus) : "open";
}
