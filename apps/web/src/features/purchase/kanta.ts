/**
 * Party kanta vs our kanta (spec P14, D/C NOTE sheet): the live difference and
 * whether the lot needs a debit note. The rule is the server's own
 * (`@orrn/server/lib/purchase`), so the screen and the OK check never disagree:
 * short beyond tolerance means party - ours > party x bp / 10 000, and a
 * weight note must cover at least the short beyond the tolerance.
 */
import { kgToG, parseDecimal } from "@orrn/domain";
import { isShortBeyondTolerance, toleranceG } from "@orrn/server/lib/purchase";

/** Up to 100 t, the server's limit per lot. */
export const MAX_LOT_KG = 100_000;

export type KantaState =
  /** One of the two weights is missing. */
  | "incomplete"
  | "even"
  /** Our kanta is heavier: never a note. */
  | "over"
  /** Short, inside the tolerance. */
  | "within"
  /** Short beyond the tolerance: OK needs a weight debit note. */
  | "short";

export type KantaReading = {
  state: KantaState;
  partyG: number | null;
  fcG: number | null;
  /** Ours minus party (negative when short). Null while incomplete. */
  diffG: number | null;
  /** Party minus ours when short, else 0. */
  shortG: number;
  /** Grams the lot may be short without a note. */
  toleranceG: number;
  needsNote: boolean;
  /** What live weight notes must add up to before OK (0 when no note is needed). */
  minNoteG: number;
  /** Short as basis points of the party weight (rounded). Null while incomplete. */
  shortBp: number | null;
};

/** A weight as typed from the kanta ("12,450.5") in whole grams; null when empty, zero or not a number. */
export function kgTextToG(text: string): number | null {
  const kg = parseDecimal(text);
  if (kg === null || kg <= 0) return null;
  const g = kgToG(kg);
  return g > 0 ? g : null;
}

export function readKantaG(partyG: number | null, fcG: number | null, toleranceBp: number): KantaReading {
  const tolG = partyG === null ? 0 : toleranceG(partyG, toleranceBp);
  if (partyG === null || fcG === null) {
    return { state: "incomplete", partyG, fcG, diffG: null, shortG: 0, toleranceG: tolG, needsNote: false, minNoteG: 0, shortBp: null };
  }
  const diffG = fcG - partyG;
  const shortG = Math.max(0, -diffG);
  const needsNote = isShortBeyondTolerance(partyG, fcG, toleranceBp);
  const state: KantaState = diffG === 0 ? "even" : diffG > 0 ? "over" : needsNote ? "short" : "within";
  return {
    state,
    partyG,
    fcG,
    diffG,
    shortG,
    toleranceG: tolG,
    needsNote,
    minNoteG: needsNote ? shortG - tolG : 0,
    shortBp: Math.round((shortG * 10_000) / partyG),
  };
}

export function readKanta(partyText: string, fcText: string, toleranceBp: number): KantaReading {
  return readKantaG(kgTextToG(partyText), kgTextToG(fcText), toleranceBp);
}
