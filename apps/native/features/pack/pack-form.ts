import { gToKg, type LengthUnit } from "@orrn/domain";

import {
  draftTotals,
  lengthFieldsToMm,
  parsePieces,
  parseWeightG,
  type LengthFields,
} from "./pack-math";

/** Pure helpers behind the New session screen: form parsing, readouts, labels. */

export type DieRange = { weightMinG: number; weightMaxG: number };

export type PickedDie = { id: string; label: string; weightMinG: number; weightMaxG: number };

/** "PATTI 14701": the die code as the floor writes it. */
export function dieCode(die: { series: string; sectionCode: string }): string {
  return `${die.series} ${die.sectionCode}`.trim();
}

/** Range edge in kg without trailing zeros (5900 g is "5.9"). */
export function kgText(g: number): string {
  return String(Number(gToKg(g).toFixed(2)));
}

/** True when the die carries a usable kg/12ft range. */
export function hasRange(die: DieRange): boolean {
  return die.weightMinG > 0 && die.weightMaxG >= die.weightMinG;
}

export type TypedBundle = {
  weight: string;
  pieces: string;
  override: boolean;
  lengthFields: LengthFields;
  po: string;
};

export type BundleEntryErrors = {
  weight?: true;
  pieces?: true;
  length?: true;
};

export type BundleEntryResult =
  | { ok: true; weightG: number; pieces: number; lengthMm: number | null; po: string | null }
  | { ok: false; errors: BundleEntryErrors };

/**
 * One typed bundle to numbers. Without the override the bundle follows the
 * session defaults (lengthMm and po are null). With it, a blank length also
 * follows the session; a typed length must be a real length.
 */
export function parseBundleEntry(unit: LengthUnit, typed: TypedBundle): BundleEntryResult {
  const errors: BundleEntryErrors = {};
  const weightG = parseWeightG(typed.weight);
  const pieces = parsePieces(typed.pieces);
  if (weightG === null) errors.weight = true;
  if (pieces === null) errors.pieces = true;

  let lengthMm: number | null = null;
  let po: string | null = null;
  if (typed.override) {
    const f = typed.lengthFields;
    const blank = !f.mm.trim() && !f.feet.trim() && !f.inches.trim();
    if (!blank) {
      lengthMm = lengthFieldsToMm(unit, f);
      if (lengthMm === null) errors.length = true;
    }
    po = typed.po.trim() || null;
  }

  if (errors.weight || errors.pieces || errors.length || weightG === null || pieces === null) return { ok: false, errors };
  return { ok: true, weightG, pieces, lengthMm, po };
}

/** Totals of a saved session. Void bundles are listed but never counted (web semantics). */
export function sessionTotals(bundles: readonly { status: string; weightG: number; quantity: number }[]) {
  const live = bundles.filter((b) => b.status !== "void");
  const totals = draftTotals(live.map((b) => ({ weightG: b.weightG, pieces: b.quantity })));
  return { ...totals, kg: gToKg(totals.weightG), voidCount: bundles.length - live.length };
}

let counter = 0;
/** A key for a typed bundle; unique within the phone's session. */
export function newBundleKey(now: number = Date.now()): string {
  counter += 1;
  return `${now.toString(36)}-${counter.toString(36)}`;
}

/** The step the person may move to: bundles need a die, a cut length and (when the company has yards) a yard. */
export function canLeaveDefaults(input: { die: PickedDie | null; lengthMm: number | null; yardCount: number; locationId: string | null }): boolean {
  return !!input.die && input.lengthMm !== null && (input.yardCount === 0 || !!input.locationId);
}

/** A draft owner string: a draft is only offered back to its own packer in that company. */
export function draftOwner(userId: string | undefined, companyId: string | undefined): string | null {
  return userId && companyId ? `${userId}:${companyId}` : null;
}
