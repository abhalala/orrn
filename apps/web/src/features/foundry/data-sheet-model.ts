import type { SpectroElementKey, SpectroVerdict } from "@orrn/domain";

import { spectroRows, type SpectroRow } from "./model";

/** Figures and ordering of the cast data sheet (`/casts/$id/sheet`). Pure: no React. */

type Stamp = Date | string | number | null | undefined;
/** A server date (a Date, an ISO text or ms) to ms; null for none. */
export function toMs(v: Stamp): number | null {
  if (v === null || v === undefined) return null;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// --- Chemistry against the alloy's limits ----------------------------------------------------------------------

export type SheetChemistry = { verdict: SpectroVerdict; rows: SpectroRow[]; outside: SpectroElementKey[]; resultId: string };

/**
 * The deciding spectro result of a melt (latest live result that carries numbers; `values` are percent as `casts.get`
 * returns them) judged against the alloy's limits: which elements are inside and which outside. Null when there is none.
 */
export function chemistryOfMelt(
  spectro: readonly { id: string; voidedAt?: unknown; values?: Partial<Record<string, number>> }[],
  limits: readonly { element: SpectroElementKey; minPpm: number | null; maxPpm: number | null }[],
): SheetChemistry | null {
  const result = [...spectro].reverse().find((s) => !s.voidedAt && Object.keys(s.values ?? {}).length > 0);
  if (!result) return null;
  const judged = spectroRows(result.values ?? {}, limits);
  if (!judged) return null;
  return { verdict: judged.verdict, rows: judged.rows, outside: judged.rows.filter((r) => r.reading === "fail").map((r) => r.element), resultId: result.id };
}

// --- Temperatures ----------------------------------------------------------------------------------------------

/** Degrees C x10 as text: 7355 -> "735.5". */
export const tempText = (x10: number): string => (x10 / 10).toFixed(1);

export type ReadingRow = { meltId: string; kind: string; valueX10: number; readAt: Stamp; createdBy?: string | null };
/** Count, lowest, highest and last furnace reading of one melt. */
export function tempSummary(readings: readonly ReadingRow[], meltId: string): { n: number; minX10: number; maxX10: number; lastX10: number } | null {
  const mine = readings.filter((r) => r.meltId === meltId).sort((a, b) => (toMs(a.readAt) ?? 0) - (toMs(b.readAt) ?? 0));
  if (mine.length === 0) return null;
  const v = mine.map((r) => r.valueX10);
  return { n: mine.length, minX10: Math.min(...v), maxX10: Math.max(...v), lastX10: v[v.length - 1]! };
}

// --- Timeline ---------------------------------------------------------------------------------------------------

export type SheetEventKind = "preheat" | "chargingStart" | "chargingEnd" | "castingStart" | "castingEnd" | "reading" | "homogIn" | "homogOut" | "cut" | "reject";
const RANK: Record<SheetEventKind, number> = { preheat: 0, chargingStart: 1, chargingEnd: 2, reading: 3, castingStart: 4, castingEnd: 5, homogIn: 6, homogOut: 7, cut: 8, reject: 9 };

export type SheetEvent = { at: number; kind: SheetEventKind; meltSeq: number | null; actorId: string | null; /** The temperature of a reading (x10), the machine of a cut, the kind of a reject. */ detail: string | number | null };

type MeltTimes = { id: string; seq: number; preheatStartAt?: Stamp; chargingStartAt?: Stamp; chargingEndAt?: Stamp; castingStartAt?: Stamp; castingEndAt?: Stamp };

/**
 * Everything with a time on the cast, oldest first (ties by the order the work happens in). Melt times are credited to the
 * person who locked the melt, else who made it.
 */
export function buildTimeline(input: {
  melts: readonly MeltTimes[];
  sheetMelts: readonly { id: string; createdBy?: string | null; lockedBy?: string | null }[];
  readings: readonly ReadingRow[];
  homog: readonly { inAt?: Stamp; outAt?: Stamp; releasedBy?: string | null }[];
  cuts: readonly { cutAt?: Stamp; machine: string; createdBy?: string | null }[];
  rejects: readonly { rejectedAt?: Stamp; kind: string; createdBy?: string | null }[];
}): SheetEvent[] {
  const out: SheetEvent[] = [];
  const add = (at: Stamp, kind: SheetEventKind, meltSeq: number | null, actorId: string | null | undefined, detail: SheetEvent["detail"] = null) => {
    const ms = toMs(at);
    if (ms !== null) out.push({ at: ms, kind, meltSeq, actorId: actorId ?? null, detail });
  };
  const seqOf = new Map(input.melts.map((m) => [m.id, m.seq]));
  for (const m of input.melts) {
    const who = input.sheetMelts.find((s) => s.id === m.id);
    const actor = who?.lockedBy ?? who?.createdBy ?? null;
    add(m.preheatStartAt, "preheat", m.seq, actor);
    add(m.chargingStartAt, "chargingStart", m.seq, actor);
    add(m.chargingEndAt, "chargingEnd", m.seq, actor);
    add(m.castingStartAt, "castingStart", m.seq, actor);
    add(m.castingEndAt, "castingEnd", m.seq, actor);
  }
  for (const r of input.readings) add(r.readAt, "reading", seqOf.get(r.meltId) ?? null, r.createdBy, r.valueX10);
  for (const h of input.homog) {
    add(h.inAt, "homogIn", null, null);
    add(h.outAt, "homogOut", null, h.releasedBy);
  }
  for (const c of input.cuts) add(c.cutAt, "cut", null, c.createdBy, c.machine);
  for (const r of input.rejects) add(r.rejectedAt, "reject", null, r.createdBy, r.kind);
  return out.sort((a, b) => a.at - b.at || RANK[a.kind] - RANK[b.kind] || (a.meltSeq ?? 0) - (b.meltSeq ?? 0));
}

// --- Totals -----------------------------------------------------------------------------------------------------

/** Logs in, billets out, end cuts and the yield (basis points) of a cast's cuts. */
export function cutTotals(cuts: readonly { logG: number; billetG: number }[]): { logG: number; billetG: number; endG: number; yieldBp: number | null } {
  const logG = cuts.reduce((t, c) => t + c.logG, 0);
  const billetG = cuts.reduce((t, c) => t + c.billetG, 0);
  return { logG, billetG, endG: logG - billetG, yieldBp: logG > 0 ? Math.floor((billetG * 10_000) / logG) : null };
}

/** A person's name for a stored id; a former member (not in the plant list) shows as a dash, never an id. */
export const nameOf = (people: Record<string, string>, id: string | null | undefined): string => (id ? (people[id] ?? "-") : "-");
