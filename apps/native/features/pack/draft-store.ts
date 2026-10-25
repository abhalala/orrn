import type { LengthUnit } from "@orrn/domain";

import type { DraftBundle, DraftReject, LengthFields, PackSource } from "./pack-math";

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
  /** What the bundles are for (D20), the die copy, the cast and the logo. Drafts from before this have none. */
  source?: PackSource;
  /** Pieces rejected at pack (FP-PK-14). */
  rejects?: DraftReject[];
  /**
   * This session's nonce for `clientRequestId` (BACKLOG 50): kept with the draft so a save sent again after the
   * app was killed and reopened still carries the same key for the same bundles.
   */
  sessionKey?: string;
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
    (b.po === null || isString(b.po)) &&
    (b.weightSource === undefined || b.weightSource === "scale" || b.weightSource === "manual") &&
    (b.scaleReadingG === undefined || (isNum(b.scaleReadingG) && b.scaleReadingG > 0)) &&
    (b.weightOverrideReason === undefined || isString(b.weightOverrideReason))
  );
}

const optionalString = (v: unknown) => v === undefined || isString(v);

function isSource(v: unknown): v is PackSource {
  const s = v as Record<string, unknown> | null;
  return (
    !!s &&
    typeof s.showLogo === "boolean" &&
    optionalString(s.salesOrderLineId) &&
    optionalString(s.dieInstanceId) &&
    optionalString(s.castId) &&
    (s.overridePin === undefined || typeof s.overridePin === "boolean")
  );
}

function isReject(v: unknown): v is DraftReject {
  const r = v as Record<string, unknown> | null;
  return (
    !!r &&
    isNum(r.pcs) &&
    r.pcs > 0 &&
    (r.weightG === undefined || (isNum(r.weightG) && r.weightG > 0)) &&
    isString(r.reasonCode) &&
    r.reasonCode !== "" &&
    optionalString(r.note)
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
  if (d.source !== undefined && !isSource(d.source)) return null;
  if (d.rejects !== undefined && !(Array.isArray(d.rejects) && d.rejects.length <= 50 && d.rejects.every(isReject))) return null;
  if (d.sessionKey !== undefined && !(isString(d.sessionKey) && /^[A-Za-z0-9_-]{8,55}$/.test(d.sessionKey))) return null;
  return d as PackDraft;
}
