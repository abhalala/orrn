/**
 * Pure helpers of the foundry screens (W2-FD-W): tones, the cast tail chip, the close-out sentence,
 * the cast list search, spectro rows against an alloy's limits, and the limits editor's percent text.
 * Every figure here is the server's (`casts.get().closeout`, the melt row); nothing is recomputed
 * except the spectro readings, which the client shows next to the stored verdict.
 */
import {
  percentToPpm,
  SPECTRO_ELEMENTS,
  spectroCheck,
  type SpectroElementKey,
  type SpectroLimit,
  type SpectroReading,
  type SpectroVerdict,
  type StatusTone,
} from "@orrn/domain";

export const CAST_STATUSES = ["open", "closing", "closed", "cancelled"] as const;
export type CastStatus = (typeof CAST_STATUSES)[number];
export type MeltStatus = "draft" | "locked" | "cancelled";

export const CAST_TONE: Record<CastStatus, StatusTone> = { open: "blue", closing: "amber", closed: "neutral", cancelled: "red" };
export const MELT_TONE: Record<MeltStatus, StatusTone> = { draft: "amber", locked: "green", cancelled: "red" };

export function verdictTone(v: SpectroVerdict | null | undefined): StatusTone {
  return v === "pass" ? "green" : v === "fail" ? "red" : v === "incomplete" ? "amber" : "neutral";
}

export function readingTone(r: SpectroReading): StatusTone {
  return r === "pass" ? "green" : r === "fail" ? "red" : "neutral";
}

/**
 * A locked melt's state colour (spec "States worth naming"): green when the verdict is a pass and the
 * burn is inside 3 %, red when the verdict is a fail, amber when it was locked with a reason.
 */
export function lockedMeltTone(m: { verdict: SpectroVerdict | null; lossBp: number; warnings: readonly unknown[] }): StatusTone {
  if (m.verdict === "fail") return "red";
  if (m.verdict === "pass" && m.warnings.length === 0 && Math.abs(m.lossBp) <= 300) return "green";
  return "amber";
}

// --- List search -------------------------------------------------------------------------------------

export type CastsSearch = { status?: CastStatus; q?: string };

/** `/casts?status=open&q=K31` (plain function: the route entry chunk must not import zod). */
export function parseCastsSearch(raw: Record<string, unknown>): CastsSearch {
  const out: CastsSearch = {};
  if (typeof raw.status === "string" && (CAST_STATUSES as readonly string[]).includes(raw.status)) out.status = raw.status as CastStatus;
  if (typeof raw.q === "string" && raw.q.trim() !== "" && raw.q.length <= 40) out.q = raw.q.trim();
  return out;
}

export type TraceQuery = { kind: "cast"; number: string } | { kind: "bundle"; serial: string };

/**
 * What the trace box searched for. A cast code is a month letter and a number (`K31`); a bundle
 * serial is longer (`26J1842`). Case is ignored; anything else is not a code.
 */
export function traceQuery(text: string): TraceQuery | null {
  const s = text.trim().toUpperCase();
  if (/^[A-L]\d{1,4}$/.test(s)) return { kind: "cast", number: s };
  if (/^[0-9]{2}[A-L]\d{1,6}$/.test(s)) return { kind: "bundle", serial: s };
  return null;
}

// --- Cast ------------------------------------------------------------------------------------------

/** The server's close-out figures (`casts.get().closeout`), the ones the screen reads. */
export type Closeout = {
  producedG: number;
  creditedG: number;
  billetsOnHandG: number;
  tailG: number;
  tailBp: number | null;
  shortG: number;
  needsReason: boolean;
  needsApproval: boolean;
  burnG: number;
  bundlesG: number;
  liveMelts: number;
  draftMelts: number;
};

export type TailChip = { tone: StatusTone; kind: "balanced" | "tail" | "short" | "empty" };

/** The tail chip: green when every billet is accounted for, amber for a tail, red when billets are short. */
export function tailChip(c: Pick<Closeout, "producedG" | "tailG" | "shortG" | "needsApproval" | "liveMelts">): TailChip {
  if (c.shortG > 0) return { tone: "red", kind: "short" };
  if (c.liveMelts === 0 && c.producedG === 0) return { tone: "neutral", kind: "empty" };
  if (c.tailG === 0) return { tone: "green", kind: "balanced" };
  return { tone: c.needsApproval ? "red" : "amber", kind: "tail" };
}

/** Why a close button is off, or null when the cast can be closed. */
export type CloseBlock = "not_open" | "draft_melts" | null;
export function closeBlock(status: string, c: Pick<Closeout, "draftMelts">): CloseBlock {
  if (status !== "open") return "not_open";
  return c.draftMelts > 0 ? "draft_melts" : null;
}

/** The close sheet's form is complete: a reason when the tail needs one, and a note when the code asks for it. */
export function closeFormIssue(
  c: Pick<Closeout, "needsReason">,
  form: { reasonCode: string; note: string },
  reasons: readonly { code: string; requiresNote: boolean }[],
): "reason" | "note" | null {
  if (!c.needsReason) return null;
  if (form.reasonCode === "") return "reason";
  const row = reasons.find((r) => r.code === form.reasonCode);
  return (row?.requiresNote || form.reasonCode === "other") && form.note.trim() === "" ? "note" : null;
}

/** A cast can be cancelled while it is open, with no live and no draft melt (the server also checks billets). */
export function canCancelCast(status: string, c: Pick<Closeout, "liveMelts" | "draftMelts">): boolean {
  return status === "open" && c.liveMelts === 0 && c.draftMelts === 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 2026" for the header: the number prints the month letter and the sequence, the year is said here. */
export function castPeriodText(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** Percent of basis points: 286 -> "2.9", null -> "". */
export function bpText(bp: number | null | undefined): string {
  return bp === null || bp === undefined ? "" : (bp / 100).toFixed(1);
}

// --- Spectro -----------------------------------------------------------------------------------------

export const ELEMENT_LABEL: Record<SpectroElementKey, string> = { si: "Si", fe: "Fe", cu: "Cu", mn: "Mn", mg: "Mg", zn: "Zn", ti: "Ti", cr: "Cr", al: "Al" };

/** ppm to percent text as the lab sheet writes it: 4500 -> "0.450". */
export const ppmPct = (ppm: number | null | undefined): string => (ppm === null || ppm === undefined ? "-" : (ppm / 10_000).toFixed(3));

/** A limit as "0.20 to 0.60", "max 0.35", "min 0.45" or "" when neither bound is set. */
export function limitText(l: Pick<SpectroLimit, "minPpm" | "maxPpm"> | undefined, words: { max: string; min: string; to: string }): string {
  if (!l || (l.minPpm == null && l.maxPpm == null)) return "";
  if (l.minPpm != null && l.maxPpm != null) return `${(l.minPpm / 10_000).toFixed(2)} ${words.to} ${(l.maxPpm / 10_000).toFixed(2)}`;
  return l.maxPpm != null ? `${words.max} ${(l.maxPpm / 10_000).toFixed(2)}` : `${words.min} ${(l.minPpm! / 10_000).toFixed(2)}`;
}

export type SpectroRow = { element: SpectroElementKey; ppm: number | null; source: "measured" | "balance" | null; reading: SpectroReading; limit: SpectroLimit | undefined };

/**
 * The nine elements of a result with the alloy's limits beside them. `values` are percent (what
 * `casts.get` returns: ppm / 10,000). Al is measured or the balance, as the server judged it.
 */
export function spectroRows(values: Partial<Record<string, number>>, limits: readonly SpectroLimit[]): { rows: SpectroRow[]; verdict: SpectroVerdict } | null {
  const ppm: Partial<Record<SpectroElementKey, number>> = {};
  for (const el of SPECTRO_ELEMENTS) {
    const v = values[el];
    if (typeof v === "number") ppm[el] = Math.round(v * 10_000);
  }
  try {
    const check = spectroCheck(ppm, limits);
    const byEl = new Map(limits.map((l) => [l.element, l]));
    return {
      verdict: check.verdict,
      rows: SPECTRO_ELEMENTS.map((element) => ({
        element,
        ppm: element === "al" ? check.alPpm : (ppm[element] ?? null),
        source: element === "al" ? check.alSource : ppm[element] != null ? ("measured" as const) : null,
        reading: check.readings[element],
        limit: byEl.get(element),
      })),
    };
  } catch {
    return null;
  }
}

/** Typed percent text per element to `valuesPpm` for `spectro.enter`: blank = not measured; a bad entry is reported. */
export function spectroInput(texts: Partial<Record<SpectroElementKey, string>>): { ok: true; valuesPpm: Partial<Record<SpectroElementKey, number>> } | { ok: false; element: SpectroElementKey; reason: "invalid" | "none" | "over" } {
  const valuesPpm: Partial<Record<SpectroElementKey, number>> = {};
  for (const el of SPECTRO_ELEMENTS) {
    const raw = (texts[el] ?? "").trim().replace(",", ".");
    if (raw === "") continue;
    const ppm = percentToPpm(raw);
    if (ppm === null || ppm > 1_000_000) return { ok: false, element: el, reason: "invalid" };
    valuesPpm[el] = ppm;
  }
  if (Object.keys(valuesPpm).length === 0) return { ok: false, element: "si", reason: "none" };
  const eight = SPECTRO_ELEMENTS.filter((e) => e !== "al").reduce((s, e) => s + (valuesPpm[e] ?? 0), 0);
  if (eight > 1_000_000) return { ok: false, element: "si", reason: "over" };
  return { ok: true, valuesPpm };
}

// --- Alloy limits editor ----------------------------------------------------------------------------------

export type LimitDraft = Record<SpectroElementKey, { min: string; max: string }>;

export function limitDraft(limits: readonly SpectroLimit[]): LimitDraft {
  const draft = {} as LimitDraft;
  for (const el of SPECTRO_ELEMENTS) {
    const l = limits.find((x) => x.element === el);
    draft[el] = { min: l?.minPpm != null ? String(l.minPpm / 10_000) : "", max: l?.maxPpm != null ? String(l.maxPpm / 10_000) : "" };
  }
  return draft;
}

/** The editor's percent text as `setLimits` rows (both blank = dropped); the first bad cell is named. */
export function limitRows(draft: LimitDraft): { ok: true; limits: SpectroLimit[] } | { ok: false; element: SpectroElementKey; reason: "invalid" | "order" } {
  const limits: SpectroLimit[] = [];
  for (const el of SPECTRO_ELEMENTS) {
    const minRaw = draft[el].min.trim().replace(",", ".");
    const maxRaw = draft[el].max.trim().replace(",", ".");
    const minPpm = minRaw === "" ? null : percentToPpm(minRaw);
    const maxPpm = maxRaw === "" ? null : percentToPpm(maxRaw);
    if ((minRaw !== "" && minPpm === null) || (maxRaw !== "" && maxPpm === null)) return { ok: false, element: el, reason: "invalid" };
    if (minPpm !== null && maxPpm !== null && minPpm > maxPpm) return { ok: false, element: el, reason: "order" };
    if (minPpm !== null || maxPpm !== null) limits.push({ element: el, minPpm, maxPpm });
  }
  return { ok: true, limits };
}

/** Furnace form: capacity in kg and billet diameter in mm to the server's grams and mm. */
export function furnaceInput(f: { code: string; name: string; capacityKg: string; billetDiaMm: string }): { ok: true; code: string; name: string; capacityG: number; billetDiaMm: number } | { ok: false; field: "code" | "name" | "capacity" | "dia" } {
  const code = f.code.trim().toUpperCase();
  const name = f.name.trim();
  if (!/^[A-Z0-9-]{1,12}$/.test(code)) return { ok: false, field: "code" };
  if (name === "") return { ok: false, field: "name" };
  const kg = Number(f.capacityKg.replace(",", "."));
  if (!Number.isFinite(kg) || kg <= 0 || kg > 100_000) return { ok: false, field: "capacity" };
  const dia = Number(f.billetDiaMm);
  if (!Number.isInteger(dia) || dia < 25 || dia > 500) return { ok: false, field: "dia" };
  return { ok: true, code, name, capacityG: Math.round(kg * 1000), billetDiaMm: dia };
}

// --- Today ---------------------------------------------------------------------------------------------------

/** The Foundry tile's three numbers: open casts, melts in progress (drafts) and spectro files waiting. */
export function todayCounts(casts: readonly { status: string; draftMelts: number }[], inboxWaiting: number): { openCasts: number; meltsInProgress: number; spectroPending: number } {
  const open = casts.filter((c) => c.status === "open" || c.status === "closing");
  return { openCasts: open.length, meltsInProgress: open.reduce((s, c) => s + c.draftMelts, 0), spectroPending: inboxWaiting };
}
