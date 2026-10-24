import type { LengthUnit } from "@orrn/domain";

import type { DraftBundle, LengthFields } from "./pack-math";

/**
 * The unsaved packing session, kept on the phone so an OS kill mid-session
 * (a call, the camera) does not lose typed bundles (ruling T29). Pure
 * (de)serialisation here; lib/pack-draft-file.ts reads and writes the file.
 */
export const DRAFT_VERSION = 1;

export type PackDraft = {
  version: typeof DRAFT_VERSION;
  /** `${userId}:${companyId}`: a draft is only ever offered back to its packer in that company. */
  owner: string;
  die: { id: string; label: string; weightMinG: number; weightMaxG: number };
  unit: LengthUnit;
  lengthFields: LengthFields;
  po: string;
  locationId: string | null;
  bundles: DraftBundle[];
  savedAt: number;
};

export function serializeDraft(draft: PackDraft): string {
  return JSON.stringify(draft);
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isBundle(v: unknown): v is DraftBundle {
  const b = v as Record<string, unknown> | null;
  return (
    !!b &&
    isString(b.key) &&
    isNum(b.weightG) &&
    b.weightG > 0 &&
    isNum(b.pieces) &&
    b.pieces > 0 &&
    (b.lengthMm === null || (isNum(b.lengthMm) && b.lengthMm > 0)) &&
    (b.po === null || isString(b.po))
  );
}

/** The stored draft if it is valid, belongs to `owner` and holds at least one bundle; else null. */
export function parseDraft(text: string | null | undefined, owner: string): PackDraft | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const d = raw as Partial<PackDraft> | null;
  if (!d || d.version !== DRAFT_VERSION || d.owner !== owner) return null;
  const die = d.die as PackDraft["die"] | undefined;
  if (!die || !isString(die.id) || !isString(die.label) || !isNum(die.weightMinG) || !isNum(die.weightMaxG)) return null;
  if (d.unit !== "mm" && d.unit !== "inch") return null;
  const lf = d.lengthFields as LengthFields | undefined;
  if (!lf || !isString(lf.mm) || !isString(lf.feet) || !isString(lf.inches)) return null;
  if (!isString(d.po) || !(d.locationId === null || isString(d.locationId)) || !isNum(d.savedAt)) return null;
  if (!Array.isArray(d.bundles) || d.bundles.length === 0 || !d.bundles.every(isBundle)) return null;
  return d as PackDraft;
}
