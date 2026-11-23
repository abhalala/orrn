import type { MessageKey, Translate } from "@orrn/i18n";

import { castsAt, pcsOf, type CastAtPlace, type PlaceKind, type StockPlace } from "./billets-model";
import { kgToG } from "./melt-form";

/** Search and form logic of `/foundry/rejects` (log and billet reject registers). Pure: no React. */

export type RejectKind = "log" | "billet";
export type RejectsSearch = { kind?: "billet"; from?: string; to?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `/foundry/rejects?kind=billet&from=2026-11-01&to=2026-11-22` (log is the default and stays out of the URL). */
export function parseRejectsSearch(raw: Record<string, unknown>): RejectsSearch {
  const out: RejectsSearch = {};
  if (raw.kind === "billet") out.kind = "billet";
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  return out;
}
export const kindOfSearch = (s: RejectsSearch): RejectKind => s.kind ?? "log";

/** A range with the end before the start is not asked for. */
export const rangeBackwards = (s: Pick<RejectsSearch, "from" | "to">): boolean => Boolean(s.from && s.to && s.from > s.to);

/** The reason kind of the register. */
export const reasonKindOf = (k: RejectKind): "log_reject" | "billet_reject" => (k === "log" ? "log_reject" : "billet_reject");

/** Where each kind of reject lies: logs at the billet store; billets on the rack or a press floor. */
export const REJECT_PLACE_KINDS: Record<RejectKind, readonly PlaceKind[]> = { log: ["billet_store"], billet: ["billet_rack", "press_floor"] };

/** The cast-at-place picks of a register: the places filtered by what the kind can be rejected from. */
export function rejectPlaceOptions(kind: RejectKind, places: readonly StockPlace[]): CastAtPlace[] {
  return castsAt(places, REJECT_PLACE_KINDS[kind]);
}

/** A reason asks for a note when its row says so, and always for "other". */
export const noteRequired = (code: string, requiresNote: boolean | null | undefined): boolean => Boolean(requiresNote) || code === "other";

export type RejectDraft = { pick: string; reasonCode: string; note: string; pcs: string; kg: string; streamId: string };
export const blankReject = (): RejectDraft => ({ pick: "", reasonCode: "", note: "", pcs: "", kg: "", streamId: "" });
export type RejectIssue = "pick" | "reason" | "note" | "pcs" | "kg" | "more_than_stock";

export type RejectCheck =
  | { ok: true; input: { castId: string; locationId: string; reasonCodeId: string; note?: string; pcs: number; kgG: number; streamId?: string } }
  | { ok: false; issue: RejectIssue };

/** The reject form against the stock picks and the reason rows (`id`, `code`, `requiresNote`). */
export function checkReject(d: RejectDraft, picks: readonly CastAtPlace[], reasons: readonly { id: string; code: string; requiresNote?: boolean | null }[]): RejectCheck {
  const pick = picks.find((p) => p.value === d.pick);
  if (!pick) return { ok: false, issue: "pick" };
  const reason = reasons.find((r) => r.code === d.reasonCode);
  if (!reason) return { ok: false, issue: "reason" };
  const note = d.note.trim();
  if (noteRequired(reason.code, reason.requiresNote) && note === "") return { ok: false, issue: "note" };
  const pcs = pcsOf(d.pcs);
  if (pcs === null) return { ok: false, issue: "pcs" };
  const kgG = kgToG(d.kg);
  if (kgG === null || kgG <= 0 || kgG > 100_000_000) return { ok: false, issue: "kg" };
  if (kgG > pick.kgG) return { ok: false, issue: "more_than_stock" };
  return { ok: true, input: { castId: pick.castId, locationId: pick.locationId, reasonCodeId: reason.id, ...(note ? { note } : {}), pcs, kgG, ...(d.streamId ? { streamId: d.streamId } : {}) } };
}

export type ReasonTotal = { code: string; label: string; pcs: number; kgG: number };
/** Totals by reason with each one's share of the kg (basis points), heaviest first. */
export function reasonShares(rows: readonly ReasonTotal[]): (ReasonTotal & { shareBp: number })[] {
  const total = rows.reduce((t, r) => t + r.kgG, 0);
  return [...rows].sort((a, b) => b.kgG - a.kgG || a.code.localeCompare(b.code)).map((r) => ({ ...r, shareBp: total > 0 ? Math.round((r.kgG * 10_000) / total) : 0 }));
}

/** The rows' own totals (the server's totals cover the same rows; this is for a row set filtered on the screen). */
export function sumRejects(rows: readonly { pcs: number; kgG: number }[]): { entries: number; pcs: number; kgG: number } {
  return { entries: rows.length, pcs: rows.reduce((t, r) => t + r.pcs, 0), kgG: rows.reduce((t, r) => t + r.kgG, 0) };
}

/** A reject reason in the reader's words: the built-in translation of the code (`reasons.<kind>_reject.<code>`), else the label the plant stored. */
export function rejectReasonText(t: Translate, kind: RejectKind, code: string, label: string | null | undefined): string {
  const key = `reasons.${reasonKindOf(kind)}.${code}` as MessageKey;
  const text = t(key);
  return text !== key ? text : label || code;
}
