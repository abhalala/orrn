/**
 * Unit maths for the ingest engine (plan B11). Every numeric conversion in this package goes through here.
 *
 * Exact rational arithmetic on BigInt: the typed decimal text becomes an integer over a power of ten, the unit factor
 * is a ratio of integers, and the result is rounded half-up ONCE at the end. No floating point is used between the
 * text and the stored integer. The only Number conversion is the last step, after rounding.
 *
 * Canonical units: length mm, mass g, linear_mass g per 12 ft (equals kgPer12ftMilli), price_per_mass paise per kg,
 * count pcs, dimension mm with one decimal.
 *
 * `decimal` arrives cleaned (digits and one dot, no commas, no sign). For the compound unit `ft_in` it holds the
 * feet and the inches separated by one space (`"12 6.5"`); `splitFeetInches` builds that text from `12' 6"`.
 *
 * When the units registry lands in `@orrn/domain` this file becomes a re-export and the tests here stay as parity tests.
 */
import type { UnitKind } from "./recipe";

export type MassUnit = "g" | "kg" | "t" | "qtl" | "lb";
export type LinearMassUnit =
  | "kg/12ft"
  | "g/12ft"
  | "lb/12ft"
  | "kg/ft"
  | "g/ft"
  | "lb/ft"
  | "kg/m"
  | "g/m"
  | "lb/m";
export type PriceUnit = "inr/kg" | "paise/kg" | "inr/t" | "paise/t" | "inr/qtl" | "paise/qtl";
export type LengthUnitId = "mm" | "cm" | "m" | "in" | "ft" | "ft_in";
export type DimensionUnitId = "mm" | "cm" | "in";
export type CountUnit = "pcs" | "nos";
export type UnitId = MassUnit | LinearMassUnit | PriceUnit | LengthUnitId | DimensionUnitId | CountUnit;

export type ConvertInput = { kind: UnitKind; unit: UnitId; decimal: string };
export type ConvertResult =
  | { ok: true; canonical: number; rounded: boolean }
  | { ok: false; code: "bad_number" | "unit_mismatch" | "out_of_range" };

type Ratio = { n: bigint; d: bigint };
const r = (n: number | bigint, d: number | bigint = 1): Ratio => ({ n: BigInt(n), d: BigInt(d) });

const CANONICAL: Record<UnitKind, UnitId> = {
  length: "mm",
  mass: "g",
  linear_mass: "g/12ft",
  price_per_mass: "paise/kg",
  count: "pcs",
  dimension: "mm",
};

/** Canonical value times SCALE is the stored integer. Only `dimension` has a scale: one decimal. */
const SCALE: Record<UnitKind, bigint> = {
  length: 1n,
  mass: 1n,
  linear_mass: 1n,
  price_per_mass: 1n,
  count: 1n,
  dimension: 10n,
};

const G_PER_LB = r(45_359_237, 100_000);
const MASS: Record<MassUnit, Ratio> = {
  g: r(1),
  kg: r(1000),
  t: r(1_000_000),
  qtl: r(100_000),
  lb: G_PER_LB,
};
/** How many "12 ft" fit in one unit of the length at the bottom of the fraction. */
const PER_LENGTH_IN_12FT: Record<"12ft" | "ft" | "m", Ratio> = {
  "12ft": r(1),
  ft: r(12),
  // 12 ft is 3.6576 m exactly (0.3048 m per ft).
  m: r(36_576, 10_000),
};

function mul(a: Ratio, b: Ratio): Ratio {
  return { n: a.n * b.n, d: a.d * b.d };
}

const LINEAR: Record<LinearMassUnit, Ratio> = {} as Record<LinearMassUnit, Ratio>;
for (const m of ["kg", "g", "lb"] as const) {
  for (const l of ["12ft", "ft", "m"] as const) {
    LINEAR[`${m}/${l}` as LinearMassUnit] = mul(MASS[m], PER_LENGTH_IN_12FT[l]);
  }
}

const PRICE_LEFT = { inr: r(100), paise: r(1) } as const;
const PRICE_RIGHT = { kg: r(1), t: r(1, 1000), qtl: r(1, 100) } as const;
const PRICE: Record<PriceUnit, Ratio> = {} as Record<PriceUnit, Ratio>;
for (const left of ["inr", "paise"] as const) {
  for (const right of ["kg", "t", "qtl"] as const) {
    PRICE[`${left}/${right}` as PriceUnit] = mul(PRICE_LEFT[left], PRICE_RIGHT[right]);
  }
}

const LENGTH: Record<Exclude<LengthUnitId, "ft_in">, Ratio> = {
  mm: r(1),
  cm: r(10),
  m: r(1000),
  in: r(254, 10),
  ft: r(3048, 10),
};
const DIM_TENTHS: Record<DimensionUnitId, Ratio> = { mm: r(10), cm: r(100), in: r(254) };

/** Factor from one unit to the canonical unit times the kind's scale. */
const FACTORS: Record<UnitKind, Partial<Record<UnitId, Ratio>>> = {
  length: { ...LENGTH },
  mass: { ...MASS },
  linear_mass: { ...LINEAR },
  price_per_mass: { ...PRICE },
  count: { pcs: r(1), nos: r(1) },
  dimension: { ...DIM_TENTHS },
};

const UNIT_LISTS: Record<UnitKind, UnitId[]> = {
  length: ["mm", "cm", "m", "in", "ft", "ft_in"],
  mass: ["g", "kg", "t", "qtl", "lb"],
  linear_mass: Object.keys(LINEAR) as UnitId[],
  price_per_mass: Object.keys(PRICE) as UnitId[],
  count: ["pcs", "nos"],
  dimension: ["mm", "cm", "in"],
};

export function unitsFor(kind: UnitKind): UnitId[] {
  return [...UNIT_LISTS[kind]];
}

export function canonicalUnit(kind: UnitKind): UnitId {
  return CANONICAL[kind];
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
  cm: "cm",
  centimetre: "cm",
  centimeter: "cm",
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
      return `${mass}/${per}` as LinearMassUnit;
    }
    case "price_per_mass": {
      const [left, right, ...rest] = t.split("/");
      if (left === undefined || right === undefined || rest.length > 0) return null;
      const l = PRICE_LEFT_ALIASES[left.trim()];
      const rr = PRICE_RIGHT_ALIASES[right.trim()];
      if (l === undefined || rr === undefined) return null;
      return `${l}/${rr}` as PriceUnit;
    }
  }
}

// ---------------------------------------------------------------- numbers

const MAX_DIGITS = 60;
const DECIMAL = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

type Dec = { num: bigint; den: bigint };

/** `"58.40"` to 5840 over 100. Null when the text is not a plain non-negative decimal. */
function parseDec(text: string): Dec | null {
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const whole = m[1] ?? "";
  const frac = m[2] ?? m[3] ?? "";
  if (whole.length + frac.length > MAX_DIGITS) return null;
  const digits = `${whole}${frac}` || "0";
  return { num: BigInt(digits), den: 10n ** BigInt(frac.length) };
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

function roundHalfUp(num: bigint, den: bigint): { q: bigint; exact: boolean } {
  const q = (2n * num + den) / (2n * den);
  return { q, exact: num % den === 0n };
}

function scaledResult(kind: UnitKind, num: bigint, den: bigint): ConvertResult {
  // Factors already carry the kind's scale (dimension is stored in tenths).
  const { q, exact } = roundHalfUp(num, den);
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, code: "out_of_range" };
  const n = Number(q);
  const canonical = SCALE[kind] === 1n ? n : n / Number(SCALE[kind]);
  return { ok: true, canonical, rounded: !exact };
}

export function convertToCanonical(a: ConvertInput): ConvertResult {
  const factor = FACTORS[a.kind][a.unit];
  const compound = a.kind === "length" && a.unit === "ft_in";
  if (factor === undefined && !compound) return { ok: false, code: "unit_mismatch" };

  if (compound) {
    const parts = a.decimal.trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 2) return { ok: false, code: "bad_number" };
    const feet = parseDec(parts[0]!);
    const inches = parts[1] === undefined ? { num: 0n, den: 1n } : parseDec(parts[1]);
    if (feet === null || inches === null) return { ok: false, code: "bad_number" };
    // mm = feet * 304.8 + inches * 25.4, as one fraction over feet.den * inches.den * 10.
    const den = feet.den * inches.den * 10n;
    const num = feet.num * inches.den * 3048n + inches.num * feet.den * 254n;
    return scaledResult(a.kind, num, den);
  }

  const dec = parseDec(a.decimal.trim());
  if (dec === null) return { ok: false, code: "bad_number" };
  const f = factor!;
  return scaledResult(a.kind, dec.num * f.n, dec.den * f.d);
}

/**
 * The canonical value written in `unit` with `decimals` places, rounded half-up. For display and tests; it never
 * feeds a stored value. Returns null for a unit that does not belong to the kind.
 */
export function canonicalToUnitText(kind: UnitKind, unit: UnitId, canonical: number, decimals: number): string | null {
  const f = FACTORS[kind][unit];
  if (f === undefined || !Number.isFinite(canonical) || canonical < 0) return null;
  const scaled = BigInt(Math.round(canonical * Number(SCALE[kind])));
  // canonical = scaled / SCALE; value in unit = canonical / (f.n / f.d / SCALE)... factor already includes SCALE.
  const pow = 10n ** BigInt(decimals);
  const num = scaled * f.d * pow;
  const den = f.n;
  const { q } = roundHalfUp(num, den);
  const s = q.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
