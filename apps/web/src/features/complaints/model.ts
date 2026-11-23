/**
 * Pure rules for the complaint register screens (XE parity lane REG): status chip tones, which writes a
 * status allows, the list's URL filter, the frozen trace turned into links, and the dictionary key of a
 * refusal. The server stays the authority on every move (`complaintNext` in `@orrn/domain`).
 */
import { complaintEditable, type ComplaintStatusValue, type StatusTone } from "@orrn/domain";

export const COMPLAINT_STATUSES: readonly ComplaintStatusValue[] = ["open", "investigating", "replied", "closed"];
export const COMPLAINT_KINDS = ["dimension", "surface", "hardness", "bend", "weight", "packing", "short_supply", "other"] as const;
export type ComplaintKindValue = (typeof COMPLAINT_KINDS)[number];

export const COMPLAINT_FILTERS = ["active", "open", "investigating", "replied", "closed", "all"] as const;
export type ComplaintFilter = (typeof COMPLAINT_FILTERS)[number];
export const DEFAULT_FILTER: ComplaintFilter = "active";

export const COMPLAINT_STATUS_TONE: Record<ComplaintStatusValue, StatusTone> = {
  open: "amber",
  investigating: "blue",
  replied: "green",
  closed: "neutral",
};

export function isComplaintStatus(v: unknown): v is ComplaintStatusValue {
  return typeof v === "string" && (COMPLAINT_STATUSES as readonly string[]).includes(v);
}

export function isComplaintKind(v: unknown): v is ComplaintKindValue {
  return typeof v === "string" && (COMPLAINT_KINDS as readonly string[]).includes(v);
}

/**
 * The writes a status offers: open -> investigating -> replied -> closed, a reply the customer does not
 * accept goes back to investigating, and a closed complaint is final. Saving the investigation moves
 * open and replied to investigating; a reply and a close are open from any status that is not closed.
 */
export function complaintActions(status: ComplaintStatusValue): { investigate: boolean; reply: boolean; close: boolean } {
  const live = complaintEditable(status);
  return { investigate: live, reply: live, close: live };
}

/** The status a save of the investigation lands in (the server's own rule). */
export function statusAfterInvestigate(status: ComplaintStatusValue): ComplaintStatusValue {
  return status === "open" || status === "replied" ? "investigating" : status;
}

// ---------------------------------------------------------------------------
// The list's URL
// ---------------------------------------------------------------------------

export type ComplaintSearch = { status?: Exclude<ComplaintFilter, "active"> };

/** The URL's search as a clean filter: an unknown value is dropped and the default (active) is left out. */
export function parseComplaintSearch(raw: Record<string, unknown>): ComplaintSearch {
  const s = raw.status;
  if (typeof s === "string" && s !== DEFAULT_FILTER && (COMPLAINT_FILTERS as readonly string[]).includes(s)) {
    return { status: s as Exclude<ComplaintFilter, "active"> };
  }
  return {};
}

export const filterOf = (s: ComplaintSearch): ComplaintFilter => s.status ?? DEFAULT_FILTER;

/** The number on a filter chip. `counts` is per status; active is everything but closed. */
export function filterCount(filter: ComplaintFilter, counts: Partial<Record<ComplaintStatusValue, number>> | undefined): number {
  const c = counts ?? {};
  const n = (s: ComplaintStatusValue) => c[s] ?? 0;
  if (filter === "all") return COMPLAINT_STATUSES.reduce((a, s) => a + n(s), 0);
  if (filter === "active") return n("open") + n("investigating") + n("replied");
  return n(filter);
}

// ---------------------------------------------------------------------------
// The frozen trace
// ---------------------------------------------------------------------------

export type TraceLinkKind = "bundle" | "run" | "ageing" | "order" | "dispatch";
export type TraceLink = { kind: TraceLinkKind; href: string; label: string; detail: string | null };

export type TraceView = {
  bundle: { serial: string; partyNo: string | null; pcs: number; packedAt: number } | null;
  section: { code: string; name: string | null } | null;
  copy: { code: string } | null;
  cast: { number: string; alloy: string | null } | null;
  runs: { id: string; number: string; productionDay: string | null; shiftSeq: number | null; press: string | null }[];
  ageing: { batchId: string; number: string } | null;
  order: { id: string; number: string; poNumber: string | null } | null;
  dispatch: { id: string; code: string; plNumber: string | null; invoiceNumber: string | null; completedAt: number | null } | null;
};

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The stored `traceJson` read defensively: a row written by an older build still renders. */
export function readTrace(raw: unknown): TraceView {
  const t = rec(raw) ?? {};
  const b = rec(t.bundle);
  const s = rec(t.section);
  const c = rec(t.copy);
  const k = rec(t.cast);
  const a = rec(t.ageing);
  const o = rec(t.order);
  const d = rec(t.dispatch);
  return {
    bundle: b && str(b.serial) ? { serial: str(b.serial)!, partyNo: str(b.partyNo), pcs: numOrNull(b.pcs) ?? 0, packedAt: numOrNull(b.packedAt) ?? 0 } : null,
    section: s && str(s.code) ? { code: str(s.code)!, name: str(s.name) } : null,
    copy: c && str(c.code) ? { code: str(c.code)! } : null,
    cast: k && str(k.number) ? { number: str(k.number)!, alloy: str(k.alloy) } : null,
    runs: (Array.isArray(t.runs) ? t.runs : []).flatMap((r) => {
      const x = rec(r);
      if (!x || !str(x.id)) return [];
      return [{ id: str(x.id)!, number: str(x.number) ?? "", productionDay: str(x.productionDay), shiftSeq: numOrNull(x.shiftSeq), press: str(x.press) }];
    }),
    ageing: a && str(a.batchId) ? { batchId: str(a.batchId)!, number: str(a.number) ?? "" } : null,
    order: o && str(o.id) ? { id: str(o.id)!, number: str(o.number) ?? "", poNumber: str(o.poNumber) } : null,
    dispatch: d && str(d.id) ? { id: str(d.id)!, code: str(d.code) ?? "", plNumber: str(d.plNumber), invoiceNumber: str(d.invoiceNumber), completedAt: numOrNull(d.completedAt) } : null,
  };
}

const enc = encodeURIComponent;

/** Each place the trace can send you: bundle, press runs, ageing batch, order and dispatch (with its PL number). */
export function traceLinks(trace: TraceView): TraceLink[] {
  const out: TraceLink[] = [];
  if (trace.bundle) out.push({ kind: "bundle", href: `/b/${enc(trace.bundle.serial)}`, label: trace.bundle.serial, detail: trace.bundle.partyNo });
  for (const r of trace.runs) out.push({ kind: "run", href: `/press/runs/${enc(r.id)}`, label: r.number, detail: r.press });
  if (trace.ageing) out.push({ kind: "ageing", href: `/ageing/batch/${enc(trace.ageing.batchId)}`, label: trace.ageing.number, detail: null });
  if (trace.order) out.push({ kind: "order", href: `/orders/${enc(trace.order.id)}`, label: trace.order.number, detail: trace.order.poNumber });
  if (trace.dispatch) out.push({ kind: "dispatch", href: `/dispatches/${enc(trace.dispatch.id)}`, label: trace.dispatch.code, detail: trace.dispatch.plNumber });
  return out;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export type PiecesParse = { ok: true; value: number | undefined } | { ok: false };

/** The optional "pieces hit" box: empty is fine, otherwise a whole number from 1 to `max` (when the bundle's count is known). */
export function parsePiecesHit(text: string, max?: number): PiecesParse {
  const s = text.trim();
  if (s === "") return { ok: true, value: undefined };
  if (!/^\d{1,6}$/.test(s)) return { ok: false };
  const n = Number(s);
  if (n < 1 || (max != null && n > max)) return { ok: false };
  return { ok: true, value: n };
}

export type InvestigationForm = { rootCause: string; correctiveAction: string; ownerId: string; due: string; done: boolean };

/** What `complaints.investigate` gets: a blank box clears the field (null), a blank owner or date too. */
export function investigationPayload(f: InvestigationForm) {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    rootCause: blank(f.rootCause),
    correctiveAction: blank(f.correctiveAction),
    actionOwnerId: f.ownerId === "" ? null : f.ownerId,
    actionDue: /^\d{4}-\d{2}-\d{2}$/.test(f.due) ? f.due : null,
    actionDone: f.done,
  };
}

/** True when the plant's module list has `complaints` on. An empty list means every module is on. */
export function complaintsModuleOn(modules: readonly string[] | null | undefined): boolean {
  const list = (modules ?? []).map((m) => m.toLowerCase());
  return list.length === 0 || list.includes("complaints");
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type ComplaintErrorKey =
  | "reg.complaints.errors.changed"
  | "reg.complaints.errors.closed"
  | "reg.complaints.errors.badMove"
  | "reg.complaints.errors.notMember"
  | "reg.complaints.errors.tooManyPieces"
  | "reg.complaints.errors.bundleNotFound"
  | "reg.complaints.errors.noPermission"
  | "reg.complaints.errors.moduleOff"
  | "reg.complaints.notFound"
  | "reg.complaints.errors.saveFailed";

/**
 * The dictionary key of a refused complaint write. The server's English sentence only picks the reason; the
 * screen says it from the dictionary, and a sentence this build does not know shows the generic save error,
 * never the server's words.
 */
export function complaintErrorKey(error: unknown): ComplaintErrorKey {
  const e = error as { message?: unknown; data?: { code?: unknown } } | null;
  const code = e?.data?.code;
  const message = typeof e?.message === "string" ? e.message : "";
  if (code === "CONFLICT") return "reg.complaints.errors.changed";
  if (code === "NOT_FOUND") return /bundle/i.test(message) ? "reg.complaints.errors.bundleNotFound" : "reg.complaints.notFound";
  if (code === "FORBIDDEN") return /module is not on|is switched off|module/i.test(message) ? "reg.complaints.errors.moduleOff" : "reg.complaints.errors.noPermission";
  if (code === "BAD_REQUEST") {
    if (/is closed/i.test(message)) return "reg.complaints.errors.closed";
    if (/cannot move/i.test(message)) return "reg.complaints.errors.badMove";
    if (/not a member/i.test(message)) return "reg.complaints.errors.notMember";
    if (/more pieces/i.test(message)) return "reg.complaints.errors.tooManyPieces";
  }
  return "reg.complaints.errors.saveFailed";
}

/** A CONFLICT: the screen refetches the row so the next save carries the new `serverSeq`. */
export const isConflict = (error: unknown): boolean => (error as { data?: { code?: unknown } } | null)?.data?.code === "CONFLICT";

/** The party's refusal on create: a miss is the bundle sentence; anything else falls back to the send error. */
export function portalCreateErrorKey(error: unknown): "reg.complaints.portal.bundleNotFound" | "reg.complaints.portal.sendFailed" {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  return code === "NOT_FOUND" ? "reg.complaints.portal.bundleNotFound" : "reg.complaints.portal.sendFailed";
}
