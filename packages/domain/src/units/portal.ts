/**
 * The import portal's four functions (plan B11), with exactly the signatures the plan assumes. They sit on the
 * registry. Where the plan and the design name a thing differently, both names work:
 *  - kinds `price_per_mass` (design: `money_per_mass`) and `dimension` (one-decimal mm, stored as tenths of mm)
 *  - unit text `qtl` (design id `quintal`), `kg/12ft`, `INR/kg` and so on, through the alias table
 */
import { convertText } from "./canonical";
import { ratioToString } from "./rational";
import { BASE_UNIT, findUnit, isKind, isUnitId, UNITS, type Kind, type UnitId } from "./registry";
import { DEFAULT_NUMBER_STYLE } from "./style";
import type { Entered } from "./canonical";

export type UnitKind = Kind | "price_per_mass" | "dimension";

const TYPED: Partial<Record<UnitKind, readonly UnitId[]>> = {
  mass: ["g", "kg", "t", "quintal", "lb"],
  length: ["mm", "cm", "m", "in", "ft", "ft_in"],
  linear_mass: ["g_12ft", "kg_12ft", "kg_m", "g_m", "kg_ft", "lb_ft"],
  money_per_mass: ["paise_kg", "inr_kg", "inr_quintal", "inr_t"],
  price_per_mass: ["paise_kg", "inr_kg", "inr_quintal", "inr_t"],
  count: ["pcs"],
  dimension: ["mm", "in"],
};

function designKind(kind: UnitKind): Kind {
  if (kind === "price_per_mass") return "money_per_mass";
  if (kind === "dimension") return "length";
  return kind;
}

/** Units a file may use for this kind, typed units only. */
export function unitsFor(kind: UnitKind): UnitId[] {
  const listed = TYPED[kind];
  if (listed) return [...listed];
  const k = designKind(kind);
  return Object.values(UNITS).filter((u) => u.kind === k && !u.noEntry).map((u) => u.id);
}

/** The unit the portal's result is in. `dimension` is mm with one decimal. */
export function canonicalUnit(kind: UnitKind): UnitId {
  if (kind === "dimension") return "mm";
  return BASE_UNIT[designKind(kind)];
}

/** "Kgs" gives "kg", "qtl" gives "quintal", "INR/t" gives "inr_t". Null when the kind has no such unit. */
export function parseUnitToken(kind: UnitKind, text: string): UnitId | null {
  const id = findUnit(text, designKind(kind));
  return id && unitsFor(kind).includes(id) ? id : null;
}

export type ConvertToCanonicalResult =
  | { ok: true; canonical: number; rounded: boolean; entered: Entered; residue?: string }
  | { ok: false; code: "bad_number" | "unit_mismatch" | "out_of_range" };

/** Largest canonical value the portal accepts, per kind. Past it is a unit slip, not a quantity. */
const CAP: Partial<Record<UnitKind, number>> = {
  mass: 1e12, length: 1e9, linear_mass: 1e9, money_per_mass: 1e10, price_per_mass: 1e10, count: 1e9, dimension: 1e7,
};

/**
 * One cell to its canonical number, rounded half away from zero once, at the end. `decimal` arrives cleaned;
 * length kinds also read feet and inches (`12' 6"`, `12-6`). `rounded` says the rounding changed the value.
 * `dimension` answers in mm with one decimal, every other kind in its canonical integer unit.
 */
export function convertToCanonical(a: { kind: UnitKind; unit: UnitId | (string & {}); decimal: string }): ConvertToCanonicalResult {
  const rk = designKind(a.kind);
  if (!isKind(a.kind) && a.kind !== "price_per_mass" && a.kind !== "dimension") return { ok: false, code: "unit_mismatch" };
  const unit: UnitId | null = isUnitId(a.unit) ? a.unit : findUnit(a.unit, rk);
  if (!unit || !unitsFor(a.kind).includes(unit)) return { ok: false, code: "unit_mismatch" };
  const storage: UnitId = a.kind === "dimension" ? "tenth_mm" : BASE_UNIT[rk];
  const r = convertText({ kind: rk, storage }, a.decimal, unit, { mode: "round", style: DEFAULT_NUMBER_STYLE });
  if (!r.ok) {
    const outOfRange = r.problem === "negative" || r.problem === "tooBig" || r.problem === "tooSmall";
    return { ok: false, code: r.problem === "unit" || r.problem === "kind" ? "unit_mismatch" : outOfRange ? "out_of_range" : "bad_number" };
  }
  const cap = (CAP[a.kind] ?? Number.MAX_SAFE_INTEGER) * (a.kind === "dimension" ? 10 : 1);
  if (r.value > cap) return { ok: false, code: "out_of_range" };
  const out = { ok: true as const, canonical: a.kind === "dimension" ? r.value / 10 : r.value, rounded: !r.exact, entered: r.entered };
  return r.exact ? out : { ...out, residue: ratioToString(r.residue) };
}
