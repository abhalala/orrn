/**
 * Unit spelling for the ingest engine (plan B11). The maths is the shared registry's (`@orrn/domain` units):
 * this file keeps the recipe spelling of units (`kg/12ft`, `inr/kg`, `qtl`), maps each one to its registry id and
 * hands every conversion to `convertToCanonical` of the registry. No factor or rounding rule lives here.
 *
 * Canonical units: length mm, mass g, linear_mass g per 12 ft (equals kgPer12ftMilli), price_per_mass paise per kg,
 * count pcs, dimension mm with one decimal.
 *
 * `decimal` arrives cleaned (digits and one dot, no commas, no sign). For the compound unit `ft_in` it holds the
 * feet and the inches separated by one space (`"12 6.5"`); `splitFeetInches` builds that text from `12' 6"`.
 *
 * Units the registry does not list are not offered here (see PORTAL-C-FIX-REPORT.md): lb/12ft, g/ft, lb/m,
 * paise/t, paise/qtl, and cm for a dimension. The units lane adds them to the registry first.
 */
import { convertToCanonical as registryConvert, fromStorage, type UnitId as RegistryUnitId } from "@orrn/domain";

import type { UnitKind } from "./recipe";

export type MassUnit = "g" | "kg" | "t" | "qtl" | "lb";
export type LinearMassUnit = "kg/12ft" | "g/12ft" | "kg/ft" | "lb/ft" | "kg/m" | "g/m";
export type PriceUnit = "inr/kg" | "paise/kg" | "inr/t" | "inr/qtl";
export type LengthUnitId = "mm" | "cm" | "m" | "in" | "ft" | "ft_in";
export type DimensionUnitId = "mm" | "in";
export type CountUnit = "pcs" | "nos";
export type UnitId = MassUnit | LinearMassUnit | PriceUnit | LengthUnitId | DimensionUnitId | CountUnit;

export type ConvertInput = { kind: UnitKind; unit: UnitId; decimal: string };
export type ConvertResult =
  | { ok: true; canonical: number; rounded: boolean }
  | { ok: false; code: "bad_number" | "unit_mismatch" | "out_of_range" };

const CANONICAL: Record<UnitKind, UnitId> = {
  length: "mm",
  mass: "g",
  linear_mass: "g/12ft",
  price_per_mass: "paise/kg",
  count: "pcs",
  dimension: "mm",
};

/** Recipe spelling to registry id, per kind. The order of each list is the order `unitsFor` gives. */
const REGISTRY_ID: Record<UnitKind, Partial<Record<UnitId, RegistryUnitId>>> = {
  length: { mm: "mm", cm: "cm", m: "m", in: "in", ft: "ft", ft_in: "ft_in" },
  mass: { g: "g", kg: "kg", t: "t", qtl: "quintal", lb: "lb" },
  linear_mass: { "kg/12ft": "kg_12ft", "g/12ft": "g_12ft", "kg/ft": "kg_ft", "lb/ft": "lb_ft", "kg/m": "kg_m", "g/m": "g_m" },
  price_per_mass: { "inr/kg": "inr_kg", "paise/kg": "paise_kg", "inr/t": "inr_t", "inr/qtl": "inr_quintal" },
  count: { pcs: "pcs", nos: "pcs" },
  dimension: { mm: "mm", in: "in" },
};

/** The registry unit each canonical value is stored in. A dimension is stored in tenths of a mm. */
const STORAGE: Record<UnitKind, RegistryUnitId> = {
  length: "mm",
  mass: "g",
  linear_mass: "g_12ft",
  price_per_mass: "paise_kg",
  count: "pcs",
  dimension: "tenth_mm",
};
const SCALE: Record<UnitKind, number> = { length: 1, mass: 1, linear_mass: 1, price_per_mass: 1, count: 1, dimension: 10 };

export function unitsFor(kind: UnitKind): UnitId[] {
  return Object.keys(REGISTRY_ID[kind]) as UnitId[];
}

export function canonicalUnit(kind: UnitKind): UnitId {
  return CANONICAL[kind];
}

/** The registry id behind a recipe unit, or null when the kind has no such unit. */
export function registryUnitOf(kind: UnitKind, unit: UnitId | string): RegistryUnitId | null {
  return REGISTRY_ID[kind][unit as UnitId] ?? null;
}

// ---------------------------------------------------------------- tokens

const MASS_ALIASES: Record<string, MassUnit> = {
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  t: "t",
  ton: "t",
  tons: "t",
  tonne: "t",
  tonnes: "t",
  mt: "t",
  qtl: "qtl",
  qtls: "qtl",
  quintal: "qtl",
  quintals: "qtl",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
};
const LENGTH_ALIASES: Record<string, LengthUnitId> = {
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  cm: "cm",
  centimetre: "cm",
  centimetres: "cm",
  centimeter: "cm",
  centimeters: "cm",
  m: "m",
  mtr: "m",
  mtrs: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  in: "in",
  inch: "in",
  inches: "in",
  '"': "in",
  "''": "in",
  ft: "ft",
  feet: "ft",
  foot: "ft",
  "'": "ft",
  "ft in": "ft_in",
  "ft+in": "ft_in",
  "ft-in": "ft_in",
  "feet inches": "ft_in",
  "feet+inches": "ft_in",
  ftin: "ft_in",
  ft_in: "ft_in",
};
const PER_LENGTH_ALIASES: Record<string, "12ft" | "ft" | "m"> = {
  "12ft": "12ft",
  "12 ft": "12ft",
  "12feet": "12ft",
  "12foot": "12ft",
  "12'": "12ft",
  ft: "ft",
  feet: "ft",
  foot: "ft",
  m: "m",
  mtr: "m",
  mtrs: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
};
const PRICE_LEFT_ALIASES: Record<string, "inr" | "paise"> = {
  inr: "inr",
  rs: "inr",
  "₹": "inr",
  rupee: "inr",
  rupees: "inr",
  paise: "paise",
  paisa: "paise",
  ps: "paise",
};
const PRICE_RIGHT_ALIASES: Record<string, "kg" | "t" | "qtl"> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilogram: "kg",
  t: "t",
  ton: "t",
  tonne: "t",
  tonnes: "t",
  mt: "t",
  qtl: "qtl",
  quintal: "qtl",
};
const COUNT_ALIASES: Record<string, CountUnit> = {
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  nos: "nos",
  no: "nos",
  number: "nos",
  numbers: "nos",
};
const DIM_ALIASES: Record<string, DimensionUnitId> = {
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  in: "in",
  inch: "in",
  inches: "in",
  '"': "in",
};

function cleanToken(text: string): string {
  let t = text.normalize("NFKC").trim().toLowerCase();
  t = t.replace(/^[([{]+|[)\]}]+$/g, "").trim();
  t = t.replace(/\./g, "");
  t = t.replace(/\bper\b/g, "/");
  t = t.replace(/\s*\/\s*/g, "/");
  t = t.replace(/\s+/g, " ");
  return t;
}

/** "Kgs" gives "kg". Null when the text names no unit of this kind. */
export function parseUnitToken(kind: UnitKind, text: string): UnitId | null {
  const t = cleanToken(text);
  if (t === "") return null;
  switch (kind) {
    case "mass":
      return MASS_ALIASES[t] ?? null;
    case "length":
      return LENGTH_ALIASES[t] ?? null;
    case "dimension":
      return DIM_ALIASES[t] ?? null;
    case "count":
      return COUNT_ALIASES[t] ?? null;
    case "linear_mass": {
      const [left, right, ...rest] = t.split("/");
      if (left === undefined || right === undefined || rest.length > 0) return null;
      const mass = MASS_ALIASES[left.trim()];
      const per = PER_LENGTH_ALIASES[right.trim()];
      if (mass === undefined || per === undefined) return null;
      if (mass !== "g" && mass !== "kg" && mass !== "lb") return null;
      const id = `${mass}/${per}` as LinearMassUnit;
      return id in REGISTRY_ID.linear_mass ? id : null;
    }
    case "price_per_mass": {
      const [left, right, ...rest] = t.split("/");
      if (left === undefined || right === undefined || rest.length > 0) return null;
      const l = PRICE_LEFT_ALIASES[left.trim()];
      const rr = PRICE_RIGHT_ALIASES[right.trim()];
      if (l === undefined || rr === undefined) return null;
      const id = `${l}/${rr}` as PriceUnit;
      return id in REGISTRY_ID.price_per_mass ? id : null;
    }
  }
}

// ---------------------------------------------------------------- numbers

const MAX_DIGITS = 60;
const DECIMAL = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

/** A plain non-negative decimal of at most 60 digits. The shape check only; the registry does the maths. */
function isPlainDecimal(text: string): boolean {
  const m = DECIMAL.exec(text);
  if (!m) return false;
  const whole = m[1] ?? "";
  const frac = m[2] ?? m[3] ?? "";
  return whole.length + frac.length <= MAX_DIGITS;
}

/** Builds the `ft_in` decimal text from `12' 6"`, `12 ft 6 in`, `12ft`, `6 in` and the like. Null when it is not that shape. */
export function splitFeetInches(text: string): string | null {
  const t = text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"');
  const both = t.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*[-,]?\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|"|'')?$/);
  if (both) return `${both[1]} ${both[2] ?? "0"}`;
  const inchesOnly = t.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|'')$/);
  if (inchesOnly) return `0 ${inchesOnly[1]}`;
  return null;
}

/** One cleaned decimal in a recipe unit to its canonical value, through the registry. Half away from zero, once. */
export function convertToCanonical(a: ConvertInput): ConvertResult {
  const reg = registryUnitOf(a.kind, a.unit);
  if (reg === null) return { ok: false, code: "unit_mismatch" };

  let text: string;
  if (reg === "ft_in") {
    const parts = a.decimal.trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 2 || !parts.every(isPlainDecimal)) return { ok: false, code: "bad_number" };
    text = `${parts[0]} ft ${parts[1] ?? "0"} in`;
  } else {
    text = a.decimal.trim();
    if (!isPlainDecimal(text)) return { ok: false, code: "bad_number" };
  }
  const r = registryConvert({ kind: a.kind, unit: reg, decimal: text });
  return r.ok ? { ok: true, canonical: r.canonical, rounded: r.rounded } : { ok: false, code: r.code };
}

/**
 * The canonical value written in `unit` with `decimals` places, rounded half-up. For display and tests; it never
 * feeds a stored value. Returns null for a unit that does not belong to the kind.
 */
export function canonicalToUnitText(kind: UnitKind, unit: UnitId, canonical: number, decimals: number): string | null {
  const reg = registryUnitOf(kind, unit);
  if (reg === null || !Number.isFinite(canonical) || canonical < 0) return null;
  const stored = Math.round(canonical * SCALE[kind]);
  const amount = fromStorage(stored, STORAGE[kind], reg);
  const pow = 10n ** BigInt(decimals);
  const q = (2n * amount.num * pow + amount.den) / (2n * amount.den);
  const s = q.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
