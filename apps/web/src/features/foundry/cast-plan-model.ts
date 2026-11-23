import { addDays } from "./melt-times";
import { kgToG } from "./melt-form";

/** Search and form logic of `/foundry/plan` (the casting plan). Pure: no React. */

export type PlanSearch = { from?: string; to?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The longest window one proposal looks at (the server refuses more). */
export const PLAN_DAYS_MAX = 31;
/** The default window: today and the six days after. */
export const PLAN_DEFAULT_DAYS = 6;

export function parsePlanSearch(raw: Record<string, unknown>): PlanSearch {
  const out: PlanSearch = {};
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  return out;
}

/** The range shown: what the URL says, else today to today + 6 days (a lone `from` runs 6 days on; a lone `to` starts 6 days before). */
export function planRange(search: PlanSearch, today: string): { from: string; to: string } {
  if (search.from && search.to) return { from: search.from, to: search.to };
  if (search.from) return { from: search.from, to: addDays(search.from, PLAN_DEFAULT_DAYS) };
  if (search.to) return { from: addDays(search.to, -PLAN_DEFAULT_DAYS), to: search.to };
  return { from: today, to: addDays(today, PLAN_DEFAULT_DAYS) };
}

/** Why a range is not asked for, or null. */
export function rangeIssue(r: { from: string; to: string }): "backwards" | "too_long" | null {
  if (r.from > r.to) return "backwards";
  if (addDays(r.from, PLAN_DAYS_MAX - 1) < r.to) return "too_long";
  return null;
}

/** Which furnace-size line to say: the size, or that one cast per row is assumed. */
export const furnaceLine = (castSizeG: number | null | undefined): "size" | "unset" => (castSizeG && castSizeG > 0 ? "size" : "unset");

export type PlanRow = { day: string; alloy: string; alloyId: string | null; needG: number; coveredG: number; castG: number; casts: number };
/** Rows grouped by day, days and alloys in order. */
export function groupByDay<R extends { day: string; alloy: string }>(rows: readonly R[]): { day: string; rows: R[] }[] {
  const out: { day: string; rows: R[] }[] = [];
  for (const r of [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.alloy.localeCompare(b.alloy))) {
    const last = out[out.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, rows: [r] });
  }
  return out;
}

export type AcceptState = "ready" | "nothing" | "no_alloy";
/** Whether a row can be accepted: it needs metal to cast and an alloy in the masters. */
export const acceptState = (row: Pick<PlanRow, "castG" | "alloyId">): AcceptState => (row.castG <= 0 ? "nothing" : row.alloyId ? "ready" : "no_alloy");

export type LineStatus = "accepted" | "opened" | "dropped";
export type LineActions = { edit: boolean; drop: boolean; open: boolean; castLink: boolean };
/** What a line's status allows: only an accepted line changes; an opened one links to its cast. */
export function lineActions(status: string): LineActions {
  const accepted = status === "accepted";
  return { edit: accepted, drop: accepted, open: accepted, castLink: status === "opened" };
}
export const LINE_TONE: Record<LineStatus, "blue" | "green" | "neutral"> = { accepted: "blue", opened: "green", dropped: "neutral" };

export type PlanDraft = { kg: string; day: string; note: string };
export type PlanIssue = "kg" | "day";
export type PlanCheck = { ok: true; kgG: number; day: string; note?: string } | { ok: false; issue: PlanIssue };
/** The accept and edit form: 1 to 500,000 in kg (the server's gram limits), a plant day, an optional note. */
export function checkPlanDraft(d: PlanDraft): PlanCheck {
  const kgG = kgToG(d.kg);
  if (kgG === null || kgG < 1_000 || kgG > 500_000_000) return { ok: false, issue: "kg" };
  if (!DAY.test(d.day)) return { ok: false, issue: "day" };
  const note = d.note.trim();
  return { ok: true, kgG, day: d.day, ...(note ? { note } : {}) };
}
