import { kgPer12ft, kgToG, lengthFromInput, MM_PER_INCH, weightRange12ft, type LengthUnit } from "@orrn/domain";

/**
 * Packing maths for the native Pack screens (mirrors web T20's pack-math).
 * Weights are typed in kg and stored in whole grams; lengths are typed in the
 * company unit and stored in mm (conversions from `@orrn/domain`).
 */

/** The most pieces one bundle can hold before it is surely a typo. */
export const MAX_PIECES = 100_000;

/**
 * Weight field to whole grams, or null. A dot or a comma is the decimal point
 * (the iOS decimal pad shows "," in comma-decimal regions) and there is no
 * thousands grouping: `@orrn/domain` parseDecimal strips every comma, which
 * read "45,5" as 455 kg (T25 gotcha, ruling T29).
 */
export function parseWeightG(text: string): number | null {
  const t = text.trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const kg = Number(t.replace(",", "."));
  if (!Number.isFinite(kg)) return null;
  const g = kgToG(kg);
  return g > 0 ? g : null;
}

/** Pieces field: digits only, 1 to MAX_PIECES. */
export function parsePieces(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_PIECES ? n : null;
}

export type LengthFields = { mm: string; feet: string; inches: string };

/** The length fields for the company's unit to whole mm (11 ft 6 in = 3505 mm); null if not a positive length. */
export function lengthFieldsToMm(unit: LengthUnit, fields: LengthFields): number | null {
  return unit === "mm" ? lengthFromInput({ unit, mm: fields.mm }) : lengthFromInput({ unit, feet: fields.feet, inches: fields.inches });
}

/** Stored mm back into the fields (inches to the nearest 0.25, zero parts left blank). */
export function lengthToFields(mm: number, unit: LengthUnit): LengthFields {
  if (!(mm > 0)) return { mm: "", feet: "", inches: "" };
  if (unit === "mm") return { mm: String(Math.round(mm)), feet: "", inches: "" };
  const totalInches = Math.round(mm / MM_PER_INCH / 0.25) * 0.25;
  const feet = Math.floor(totalInches / 12);
  const inches = Number((totalInches - feet * 12).toFixed(2));
  return { mm: "", feet: feet > 0 ? String(feet) : "", inches: inches > 0 ? String(inches) : "" };
}

/** kg per 12 ft for one bundle, or null without pieces or length. */
export function bundleKgPer12ft(b: { weightG: number; pieces: number; lengthMm: number }): number | null {
  return kgPer12ft(b);
}

export type RangeVerdict = "in" | "below" | "above";

/**
 * Where a bundle sits against its die's weight range (kg / 12 ft, stored in
 * grams on the die). Compares the plant's billed band (`weightRange12ft`, the
 * packing list's "Weight range /12'"), ruling T20. Null without a usable range.
 */
export function rangeVerdict(kg12ft: number, die: { weightMinG: number; weightMaxG: number }): RangeVerdict | null {
  const min = die.weightMinG / 1000;
  const max = die.weightMaxG / 1000;
  if (!Number.isFinite(kg12ft) || !(min > 0) || !(max > 0) || min > max) return null;
  const band = weightRange12ft(kg12ft);
  const EPS = 1e-6;
  if (band < min - EPS) return "below";
  if (band > max + EPS) return "above";
  return "in";
}

/** One typed bundle. `lengthMm`/`po` null means "use the session default". */
export type DraftBundle = {
  key: string;
  weightG: number;
  pieces: number;
  lengthMm: number | null;
  po: string | null;
  /** Where the weight came from (FP-PK-02). Left out = typed (the server's default). */
  weightSource?: "scale" | "manual";
  /** The steady scale grams on the screen when the weight was taken or typed over. */
  scaleReadingG?: number;
  /** Why the weight was typed while a scale is connected. */
  weightOverrideReason?: string;
};

/** Pieces rejected at pack (FP-PK-14): they leave the pile and are not a bundle. */
export type DraftReject = {
  pcs: number;
  /** Weighed rejects post kg at plant scrap; left out when the pieces were not weighed. */
  weightG?: number;
  /** A `qc_reject` reason code. `other` needs a note. */
  reasonCode: string;
  note?: string;
};

/** What the Source step chose (FP-PK-01/04/10, D20): the order line (none = Plant stock), die copy, cast and label logo. */
export type PackSource = {
  salesOrderLineId?: string;
  dieInstanceId?: string;
  castId?: string;
  /** Label branding, default on. */
  showLogo: boolean;
  /** D15: the office packs on another copy than the line's pin (the server checks `order.manage` and audits). */
  overridePin?: boolean;
};

export const DEFAULT_SOURCE: PackSource = { showLogo: true };

export type Totals = { bundles: number; pieces: number; weightG: number };

export function draftTotals(bundles: readonly { weightG: number; pieces: number }[]): Totals {
  let pieces = 0;
  let weightG = 0;
  for (const b of bundles) {
    pieces += b.pieces;
    weightG += b.weightG;
  }
  return { bundles: bundles.length, pieces, weightG };
}

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** The bundle's own length and PO, else the session's. */
export function effectiveBundle(b: DraftBundle, defaults: { lengthMm: number; po: string | null }) {
  return { lengthMm: b.lengthMm ?? defaults.lengthMm, po: blankToNull(b.po) ?? blankToNull(defaults.po) };
}

const MAX_REJECTS = 50;

/**
 * `bundle.createReceipt` input. Weights in grams, lengths in mm. With `source` (the Source step) it also
 * carries what the bundles are packed for: `plant_stock` unless an order line was chosen (D20), the die copy,
 * the cast, the pin override and the label logo; with `rejects` the pieces taken out of the pile. Without
 * them the payload is the plain one older callers sent.
 */
export function receiptPayload(input: {
  dieId: string;
  unit: LengthUnit;
  defaults: { lengthMm: number; po: string | null };
  locationId: string | undefined;
  bundles: readonly DraftBundle[];
  source?: PackSource;
  rejects?: readonly DraftReject[];
}) {
  const purchaseOrderRef = blankToNull(input.defaults.po);
  const src = input.source;
  const { salesOrderLineId, dieInstanceId, castId, overridePin } = src ?? {};
  const rejects = (input.rejects ?? []).slice(0, MAX_REJECTS);
  return {
    dieId: input.dieId,
    unit: input.unit,
    purchaseOrderRef,
    ...(input.locationId ? { locationId: input.locationId } : {}),
    ...(src
      ? {
          // D20: no order line is the deliberate "Plant stock" choice; the server writes it as plant stock.
          source: salesOrderLineId ? ("order" as const) : ("plant_stock" as const),
          ...(salesOrderLineId ? { salesOrderLineId } : {}),
          ...(dieInstanceId ? { dieInstanceId } : {}),
          ...(castId ? { castId } : {}),
          ...(salesOrderLineId && dieInstanceId && overridePin ? { overridePin: true as const } : {}),
          ...(src.showLogo === false ? { showLogo: false as const } : {}),
        }
      : {}),
    rows: input.bundles.map((b) => {
      const e = effectiveBundle(b, input.defaults);
      return {
        quantity: b.pieces,
        weightG: b.weightG,
        lengthMm: e.lengthMm,
        poNumber: e.po,
        ...(b.weightSource ? { weightSource: b.weightSource } : {}),
        ...(b.scaleReadingG ? { scaleReadingG: b.scaleReadingG } : {}),
        ...(b.weightOverrideReason?.trim() ? { weightOverrideReason: b.weightOverrideReason.trim() } : {}),
      };
    }),
    ...(rejects.length > 0
      ? {
          rejects: rejects.map((r) => ({
            pcs: r.pcs,
            ...(r.weightG ? { weightG: r.weightG } : {}),
            reasonCode: r.reasonCode,
            ...(r.note?.trim() ? { note: r.note.trim() } : {}),
          })),
        }
      : {}),
  };
}

export type YardOption = { id: string; code: string; name: string };

/** Active yard locations in the server's order; empty for a company without yards. */
export function activeYards(
  items: readonly { id: string; code: string; name: string; kind: string; active: boolean }[] | undefined,
): YardOption[] {
  return (items ?? []).filter((l) => l.kind === "yard" && l.active).map(({ id, code, name }) => ({ id, code, name }));
}
