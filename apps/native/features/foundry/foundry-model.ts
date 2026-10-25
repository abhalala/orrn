/**
 * Pure rules of the foundry phone screens (W2-FD-N): tones, the tail chip, the close count, which cast
 * the Cast tab shows, the lock button's state, billet stock cards, the spectro photo. The phone shows the
 * server's figures (`casts.get().closeout`, `casts.closePreview`, `melts.preview`) and never works one
 * out; the only sums here are the live balance preview in `melt-form.ts`, which is never sent.
 * Mirrors `apps/web/src/features/foundry/model.ts`.
 */
import {
  bpPercent1,
  decidingSpectro,
  percentToPpm,
  SPECTRO_ELEMENTS,
  SPECTRO_FILE_MAX_BASE64,
  spectroCheck,
  type SpectroElementKey,
  type SpectroLimit,
  type SpectroReading,
  type SpectroVerdict,
  type StatusTone,
} from "@orrn/domain";

import { can, canAny, type Me } from "@orrn/server/lib/permissions";

import { tabSetFor } from "@/lib/nav";

import { MELT_TIME_KEYS, type MeltTimeKey } from "./melt-times";

export type CastStatus = "open" | "closing" | "closed" | "cancelled";
export type MeltStatus = "draft" | "locked" | "cancelled" | "corrected";

export const CAST_TONE: Record<CastStatus, StatusTone> = { open: "blue", closing: "amber", closed: "neutral", cancelled: "red" };
export const MELT_TONE: Record<MeltStatus, StatusTone> = { draft: "amber", locked: "green", cancelled: "red", corrected: "neutral" };

export function verdictTone(v: SpectroVerdict | null | undefined): StatusTone {
  return v === "pass" ? "green" : v === "fail" ? "red" : v === "incomplete" ? "amber" : "neutral";
}

/**
 * The verdict that decides a melt: the latest live result that carries numbers (a photo of the printout is stored
 * with none and judges `incomplete`; it never replaces typed numbers that passed). The server reads the same result.
 */
export function latestVerdict(spectro: readonly { verdict: string | null; voidedAt: unknown; values?: unknown }[]): SpectroVerdict | null {
  return (decidingSpectro(spectro)?.verdict as SpectroVerdict | null | undefined) ?? null;
}

export function readingTone(r: SpectroReading): StatusTone {
  return r === "pass" ? "green" : r === "fail" ? "red" : "neutral";
}

/** A locked melt's colour: green with a pass and burn inside 3 %, red on a fail, amber when it was locked with a reason. */
export function lockedMeltTone(m: { verdict: SpectroVerdict | null; lossBp: number; warnings: readonly unknown[] }): StatusTone {
  if (m.verdict === "fail") return "red";
  if (m.verdict === "pass" && m.warnings.length === 0 && Math.abs(m.lossBp) <= 300) return "green";
  return "amber";
}

// --- Which cast the Cast tab shows -----------------------------------------------------------------

/**
 * The cast the tab opens on. `casts` is the server's list, newest first. The person's own pick holds while
 * it is still listed; otherwise the newest open cast, otherwise the newest one; an empty list is no cast.
 */
export function chooseCast(casts: readonly { id: string; status: string }[], selectedId: string | null | undefined): string | null {
  if (selectedId && casts.some((c) => c.id === selectedId)) return selectedId;
  return (casts.find((c) => c.status === "open") ?? casts[0])?.id ?? null;
}

/**
 * Which melt the melt route shows. `param` is the route's melt id ("new" until the first save sets it), `opened` is
 * what it was when the screen first opened. The melt the first save just made may not be in the cast's list yet:
 * a screen that opened on "new" keeps its editor then (null) instead of flashing "not found". undefined = no such melt.
 */
export function meltForScreen<T extends { id: string }>(param: string, opened: string, melts: readonly T[]): T | null | undefined {
  if (param === "new") return null;
  const found = melts.find((m) => m.id === param);
  if (found) return found;
  return opened === "new" ? null : undefined;
}

/**
 * The Foundry tile's numbers: null until the server has answered (never a 0 that is only "not loaded yet").
 * Open casts are the server's total; drafts are summed over the casts listed, so they are shown only when the
 * list holds every open cast (otherwise null: no partial number passed off as the whole).
 */
export function foundryTile(open: { items: readonly { draftMelts: number }[]; total: number } | undefined): { openCasts: number | null; drafts: number | null } {
  if (!open) return { openCasts: null, drafts: null };
  return { openCasts: open.total, drafts: open.items.length >= open.total ? open.items.reduce((s, c) => s + c.draftMelts, 0) : null };
}

// --- Cast close-out ------------------------------------------------------------------------------------

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

/** The tail chip: green when every billet is accounted for, amber for a tail, red when billets are short or the tail needs approval. */
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

export type CountIssue = "pcs" | "kg" | "together";

/**
 * The closer's physical count: pieces and kg of this cast's billets still in the yard, typed as text. Both
 * are required (zero and zero is a real count: nothing left); one without the other is not. The server works
 * the tail out from this and the ledger.
 */
export function countedBillets(pcsText: string, kgText: string): { ok: true; billetsOnHand: { count: number; kgG: number } } | { ok: false; issue: CountIssue } {
  const pcsRaw = pcsText.trim().replace(/,/g, "");
  const kgRaw = kgText.trim().replace(/,/g, "");
  if (!/^\d{1,7}$/.test(pcsRaw)) return { ok: false, issue: "pcs" };
  if (!/^\d+(\.\d{1,3})?$/.test(kgRaw)) return { ok: false, issue: "kg" };
  const count = Number(pcsRaw);
  const kgG = Math.round(Number(kgRaw) * 1000);
  if (count > 1_000_000 || kgG > 100_000_000) return { ok: false, issue: "kg" };
  if ((count === 0) !== (kgG === 0)) return { ok: false, issue: "together" };
  return { ok: true, billetsOnHand: { count, kgG } };
}

/** A count as one comparable string, "" for no valid count: the sheet asks the server only for a count that has stopped changing. */
export function countKey(c: ReturnType<typeof countedBillets>): string {
  return c.ok ? `${c.billetsOnHand.count}:${c.billetsOnHand.kgG}` : "";
}

/**
 * The reason and note a close sends: only when the server's answer for the count on screen asks for a reason.
 * A reason and note picked for an earlier count are not sent after a recount that needs none.
 */
export function closeReasonFields(reasonRequired: boolean, reasonCodeId: string | undefined, note: string): { reasonCodeId?: string; note?: string } {
  if (!reasonRequired) return {};
  return { ...(reasonCodeId ? { reasonCodeId } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
}

/** The close form is complete: a reason when the tail needs one, and a note when the code asks for it. */
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

/** What the close sheet says about a count, from the server's `casts.closePreview`. */
export type CloseAdvice = { tone: "amber" | "green"; reasonRequired: boolean; approval: boolean };

/**
 * Green when the count leaves no tail; amber when there is one. Whether a reason is required, and whether a
 * second person must approve, are the server's words (`needsReason`, `needsApproval`), never worked out here.
 */
export function closeAdvice(p: { tailG: number; shortG: number; needsReason: boolean; needsApproval: boolean } | undefined): CloseAdvice | null {
  if (!p) return null;
  return { tone: p.tailG === 0 && p.shortG === 0 ? "green" : "amber", reasonRequired: p.needsReason, approval: p.needsApproval };
}

/** Percent of basis points, rounded half away from zero by the shared rule: 286 -> "2.9", null -> "". */
export function bpText(bp: number | null | undefined): string {
  return bp === null || bp === undefined ? "" : bpPercent1(bp);
}

// --- Melt times on a phone --------------------------------------------------------------------------------

/** The big pair on the melt sheet; the other three times sit behind "All times". Lock needs both. */
export const MELT_PAIR: readonly MeltTimeKey[] = ["chargingStart", "castingEnd"];
export const MELT_MORE_TIMES: readonly MeltTimeKey[] = MELT_TIME_KEYS.filter((k) => !MELT_PAIR.includes(k));

// --- The lock button -----------------------------------------------------------------------------------------

export type LockState = "ready" | "save_first" | "gated" | "needs_reason" | "loading";

/**
 * What the Lock button does. Gates always come from the server's preview of the SAVED draft, so a changed
 * or unsaved sheet is saved first. Every code the server names holds the lock, even one this build has no
 * sentence for. A latest spectro judged for another alloy asks for a new sample or a written reason.
 */
export function lockState(s: { saved: boolean; dirty: boolean; gates: readonly string[]; needsNewSample: boolean; spectroReason: string; pending: boolean }): LockState {
  if (!s.saved || s.dirty) return "save_first";
  if (s.pending) return "loading";
  if (s.gates.length > 0) return "gated";
  if (s.needsNewSample && s.spectroReason.trim() === "") return "needs_reason";
  return "ready";
}

// --- Billet stock ----------------------------------------------------------------------------------------------

type BilletStock = {
  casts: readonly { castId: string; number: string | null; alloy: string; status: string | null; onHandG: number; adjustedG: number }[];
  byAlloy: readonly { alloy: string; casts: number; onHandG: number }[];
  totalG: number;
};

export type BilletCard = { castId: string; number: string; alloy: string; status: string; onHandG: number };

/**
 * What the Billets cards ask `stock.billets` for: only casts that hold stock (a cast at 0 kg is not asked for,
 * so the page cannot fill with a year's oldest empty casts), up to the server's page ceiling. The totals and
 * the per-alloy counts cover every cast whatever the page.
 */
export const BILLET_QUERY = { includeZero: false, limit: 500 } as const;

/** One card per cast with kg on hand, grouped by alloy in the server's order; a cast at or below 0 kg drops to "finished". `count` is the server's number of casts of the alloy. */
export function billetCards(stock: BilletStock | undefined): { groups: { alloy: string; onHandG: number; count: number; casts: BilletCard[] }[]; finished: BilletCard[]; totalG: number } {
  if (!stock) return { groups: [], finished: [], totalG: 0 };
  const card = (c: BilletStock["casts"][number]): BilletCard => ({ castId: c.castId, number: c.number ?? "?", alloy: c.alloy, status: c.status ?? "open", onHandG: c.onHandG });
  const live = stock.casts.filter((c) => c.onHandG > 0).map(card);
  const finished = stock.casts.filter((c) => c.onHandG <= 0).map(card);
  const groups = stock.byAlloy.map((a) => ({ alloy: a.alloy, onHandG: a.onHandG, count: a.casts, casts: live.filter((c) => c.alloy === a.alloy) })).filter((g) => g.casts.length > 0);
  return { groups, finished, totalG: stock.totalG };
}

// --- Spectro ---------------------------------------------------------------------------------------------------

export const ELEMENT_LABEL: Record<SpectroElementKey, string> = { si: "Si", fe: "Fe", cu: "Cu", mn: "Mn", mg: "Mg", zn: "Zn", ti: "Ti", cr: "Cr", al: "Al" };

/** ppm to percent text as the lab sheet writes it: 4500 -> "0.450". */
export const ppmPct = (ppm: number | null | undefined): string => (ppm === null || ppm === undefined ? "-" : (ppm / 10_000).toFixed(3));

/** The most base64 characters of a photo the phone sends (the domain's cap, a little under the server's). */
const PHOTO_MAX_BASE64 = SPECTRO_FILE_MAX_BASE64;
/** JPEG qualities tried in turn: the first photo that fits is sent. */
export const PHOTO_QUALITIES: readonly number[] = [0.5, 0.3, 0.15];
/** About 2 MP: enough for a printout to be read, small enough that a JPEG sits well under the server's 1 MB cap. */
export const PHOTO_MAX_PIXELS = 2_200_000;

/**
 * The picture size to set on the camera, from `getAvailablePictureSizesAsync()` ("4000x3000", and on iOS also
 * presets such as "Photo"): the largest at or under about 2 MP, else the smallest there is, else undefined
 * (the camera keeps its own choice). A sensor-resolution frame can be over the cap even at the lowest quality.
 */
export function pickPictureSize(sizes: readonly string[]): string | undefined {
  const parsed = sizes
    .map((size) => {
      const m = /^(\d+)x(\d+)$/.exec(size);
      return m ? { size, pixels: Number(m[1]) * Number(m[2]) } : null;
    })
    .filter((x): x is { size: string; pixels: number } => x !== null && x.pixels > 0);
  if (parsed.length === 0) return undefined;
  const fits = parsed.filter((x) => x.pixels <= PHOTO_MAX_PIXELS).sort((a, b) => b.pixels - a.pixels);
  if (fits[0]) return fits[0].size;
  return parsed.sort((a, b) => a.pixels - b.pixels)[0]!.size;
}

export const photoFits = (base64: string): boolean => base64.length > 0 && base64.length <= PHOTO_MAX_BASE64;

export type SpectroRow = { element: SpectroElementKey; ppm: number | null; source: "measured" | "balance" | null; reading: SpectroReading; limit: SpectroLimit | undefined };

/** The nine elements of a result with the alloy's limits beside them. `values` are percent (what `casts.get` returns: ppm / 10,000). */
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

// --- Who sees the foundry on Stock and Today ---------------------------------------------------------------------

/** The company has the foundry module on (an empty module list means every module is on). */
function foundryOn(me: Pick<Me, "company"> | null | undefined): boolean {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.length === 0 || modules.includes("foundry");
}

/** The Billets section on Stock: the foundry floor and the people who open casts or close them, in a plant with the foundry module. */
export function showsBillets(me: Me | null | undefined): boolean {
  if (!me?.company || !foundryOn(me)) return false;
  return tabSetFor(me) === "foundry" || canAny(me, ["cast.enter", "cast.close"]);
}

/** The Foundry tile on Today: those who open casts (cast.enter) in a plant with the foundry module. */
export function showsFoundryToday(me: Me | null | undefined): boolean {
  return Boolean(me?.company) && foundryOn(me) && can(me, "cast.enter");
}
