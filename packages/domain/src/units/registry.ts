/**
 * The unit registry: data, not code. Each unit has an exact rational factor to its kind's base unit.
 * Ids are append-only (snapshots name them). Design: UNITS-DESIGN.md section 4.
 */
import { cmpRatio, divRatio, isMultipleOf, mulRatio, pow10, ratio, type Ratio } from "./rational";

export type Kind =
  | "mass" | "length" | "linear_mass" | "money" | "money_per_mass" | "ratio"
  | "temperature" | "pressure" | "speed" | "volume" | "duration" | "count";

export type UnitId =
  | "g" | "kg" | "t" | "quintal" | "lb"
  | "um" | "tenth_mm" | "mm" | "cm" | "m" | "in" | "tenth_in" | "ft" | "ft_in"
  | "g_12ft" | "kg_12ft" | "kg_m" | "g_m" | "kg_ft" | "lb_ft"
  | "paise" | "inr"
  | "paise_kg" | "inr_kg" | "inr_quintal" | "inr_t"
  | "ppm" | "bp" | "pct"
  | "deci_c" | "c" | "f"
  | "deci_bar" | "bar" | "mpa" | "kgf_cm2" | "psi"
  | "deci_mm_s" | "mm_s" | "m_min" | "ft_min"
  | "ml" | "l" | "m3"
  | "ms" | "s" | "min" | "h"
  | "pcs" | "milli_pcs";

/** 1 unit = num/den base units; base = value * num/den + offNum/offDen (temperature only). */
export type UnitDef = {
  id: UnitId;
  kind: Kind;
  symbol: string;
  num: bigint;
  den: bigint;
  offNum?: bigint;
  offDen?: bigint;
  aliases: readonly string[];
  system: "si" | "us" | "trade" | "storage";
  composite?: "ft_in";
  /** True for units a person does not type: storage steps and display-only units. */
  noEntry?: boolean;
};

export const BASE_UNIT: Readonly<Record<Kind, UnitId>> = {
  mass: "g", length: "mm", linear_mass: "g_12ft", money: "paise", money_per_mass: "paise_kg",
  ratio: "ppm", temperature: "deci_c", pressure: "deci_bar", speed: "deci_mm_s", volume: "ml",
  duration: "ms", count: "pcs",
};

type Spec = [
  id: UnitId, kind: Kind, symbol: string, num: bigint, den: bigint,
  system: UnitDef["system"], aliases: string[], extra?: Partial<UnitDef>,
];

const SPECS: Spec[] = [
  // mass, base g
  ["g", "mass", "g", 1n, 1n, "si", ["g", "gm", "gms", "gram", "grams", "gr"]],
  ["kg", "mass", "kg", 1000n, 1n, "si", ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"]],
  ["quintal", "mass", "quintal", 100000n, 1n, "trade", ["quintal", "quintals", "qtl", "qtls", "qntl"]],
  ["t", "mass", "t", 1000000n, 1n, "si", ["t", "tn", "tonne", "tonnes", "ton", "tons", "mt", "mts"]],
  ["lb", "mass", "lb", 45359237n, 100000n, "us", ["lb", "lbs", "pound", "pounds"]],
  // length, base mm
  ["um", "length", "µm", 1n, 1000n, "storage", ["um", "micron", "microns", "micrometre", "micrometer"], { noEntry: true }],
  ["tenth_mm", "length", "0.1 mm", 1n, 10n, "storage", [], { noEntry: true }],
  ["mm", "length", "mm", 1n, 1n, "si", ["mm", "mms", "millimetre", "millimetres", "millimeter", "millimeters"]],
  ["cm", "length", "cm", 10n, 1n, "si", ["cm", "cms", "centimetre", "centimetres", "centimeter", "centimeters"]],
  ["m", "length", "m", 1000n, 1n, "si", ["m", "mtr", "mtrs", "meter", "meters", "metre", "metres"]],
  ["in", "length", "in", 127n, 5n, "us", ["in", "inch", "inches", "ins", "\"", "''"]],
  ["tenth_in", "length", "0.1 in", 127n, 50n, "storage", [], { noEntry: true }],
  ["ft", "length", "ft", 1524n, 5n, "us", ["ft", "fts", "feet", "foot", "'"]],
  ["ft_in", "length", "ft in", 1524n, 5n, "us", ["ft-in", "ft+in", "ftin", "ft/in", "feet-inches", "feetinches", "ft&in"], { composite: "ft_in" }],
  // linear mass, base g per 12 ft
  ["g_12ft", "linear_mass", "g/12ft", 1n, 1n, "si", ["g/12ft", "gm/12ft", "gms/12ft", "g/12'", "g/12feet", "g/12foot"]],
  ["kg_12ft", "linear_mass", "kg/12ft", 1000n, 1n, "si", ["kg/12ft", "kgs/12ft", "kg/12'", "kg/12feet", "kg/12foot", "kg/12fts"]],
  ["kg_m", "linear_mass", "kg/m", 18288n, 5n, "si", ["kg/m", "kgs/m", "kg/mtr", "kg/meter", "kg/metre", "kg/mt"]],
  ["g_m", "linear_mass", "g/m", 2286n, 625n, "si", ["g/m", "gm/m", "gms/m", "g/mtr", "g/meter", "g/metre"]],
  ["kg_ft", "linear_mass", "kg/ft", 12000n, 1n, "us", ["kg/ft", "kgs/ft", "kg/foot", "kg/feet"]],
  ["lb_ft", "linear_mass", "lb/ft", 136077711n, 25000n, "us", ["lb/ft", "lbs/ft", "lb/foot", "lbs/foot", "lb/feet"]],
  // money, base paise
  ["paise", "money", "paise", 1n, 1n, "trade", ["paise", "paisa", "ps"]],
  ["inr", "money", "₹", 100n, 1n, "trade", ["inr", "rs", "rupee", "rupees"]],
  // money per mass, base paise per kg
  ["paise_kg", "money_per_mass", "paise/kg", 1n, 1n, "trade", ["paise/kg", "paisa/kg", "ps/kg", "paise/kgs"]],
  ["inr_kg", "money_per_mass", "₹/kg", 100n, 1n, "trade", ["inr/kg", "rs/kg", "rupee/kg", "rupees/kg", "inr/kgs", "rs/kgs"]],
  ["inr_quintal", "money_per_mass", "₹/quintal", 1n, 1n, "trade", ["inr/quintal", "inr/qtl", "rs/quintal", "rs/qtl", "rupees/quintal", "rupees/qtl"]],
  ["inr_t", "money_per_mass", "₹/t", 1n, 10n, "trade", ["inr/t", "inr/tonne", "inr/mt", "inr/ton", "rs/t", "rs/tonne", "rs/mt", "rs/ton", "rupees/tonne"]],
  // ratio, base ppm
  ["ppm", "ratio", "ppm", 1n, 1n, "si", ["ppm"]],
  ["bp", "ratio", "bp", 100n, 1n, "si", ["bp", "bps", "bips", "basispoints", "basispoint"]],
  ["pct", "ratio", "%", 10000n, 1n, "si", ["%", "pct", "percent", "percentage"]],
  // temperature, base deci C
  ["deci_c", "temperature", "0.1 °C", 1n, 1n, "storage", [], { noEntry: true }],
  ["c", "temperature", "°C", 10n, 1n, "si", ["c", "°c", "degc", "deg.c", "celsius", "centigrade"]],
  ["f", "temperature", "°F", 50n, 9n, "us", ["f", "°f", "degf", "fahrenheit"], { offNum: -1600n, offDen: 9n }],
  // pressure, base deci bar
  ["deci_bar", "pressure", "0.1 bar", 1n, 1n, "storage", [], { noEntry: true }],
  ["bar", "pressure", "bar", 10n, 1n, "si", ["bar", "bars"]],
  ["mpa", "pressure", "MPa", 100n, 1n, "si", ["mpa"]],
  ["kgf_cm2", "pressure", "kgf/cm²", 196133n, 20000n, "si", ["kgf/cm2", "kg/cm2", "kgf/sqcm", "ksc"]],
  ["psi", "pressure", "psi", 44482216152605n, 64516000000000n, "us", ["psi", "lbf/in2"], { noEntry: true }],
  // speed, base deci mm per s
  ["deci_mm_s", "speed", "0.1 mm/s", 1n, 1n, "storage", [], { noEntry: true }],
  ["mm_s", "speed", "mm/s", 10n, 1n, "si", ["mm/s", "mm/sec"]],
  ["m_min", "speed", "m/min", 500n, 3n, "si", ["m/min", "mtr/min", "m/minute", "mpm"]],
  ["ft_min", "speed", "ft/min", 254n, 5n, "us", ["ft/min", "fpm", "feet/min"]],
  // volume, base ml
  ["ml", "volume", "ml", 1n, 1n, "si", ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"]],
  ["l", "volume", "l", 1000n, 1n, "si", ["l", "lt", "ltr", "ltrs", "litre", "litres", "liter", "liters"]],
  ["m3", "volume", "m³", 1000000n, 1n, "si", ["m3", "cum", "cu.m", "cubicmetre", "cubicmeter", "cbm"]],
  // duration, base ms
  ["ms", "duration", "ms", 1n, 1n, "si", ["ms", "msec", "millisecond", "milliseconds"]],
  ["s", "duration", "s", 1000n, 1n, "si", ["s", "sec", "secs", "second", "seconds"]],
  ["min", "duration", "min", 60000n, 1n, "si", ["min", "mins", "minute", "minutes"]],
  ["h", "duration", "h", 3600000n, 1n, "si", ["h", "hr", "hrs", "hour", "hours"]],
  // count, base pcs
  ["pcs", "count", "pcs", 1n, 1n, "si", ["pcs", "pc", "nos", "no", "piece", "pieces", "number", "numbers", "qty"]],
  ["milli_pcs", "count", "0.001 pcs", 1n, 1000n, "storage", [], { noEntry: true }],
];

function build(): Record<UnitId, UnitDef> {
  const out = {} as Record<UnitId, UnitDef>;
  for (const [id, kind, symbol, n, d, system, aliases, extra] of SPECS) {
    const r = ratio(n, d);
    const def: UnitDef = { id, kind, symbol, num: r.num, den: r.den, aliases, system, ...extra };
    if (extra?.offNum !== undefined && extra.offDen !== undefined) {
      const o = ratio(extra.offNum, extra.offDen);
      def.offNum = o.num;
      def.offDen = o.den;
    }
    out[id] = def;
  }
  return out;
}

export const UNITS: Readonly<Record<UnitId, UnitDef>> = Object.freeze(build());
export const UNIT_IDS = Object.freeze(SPECS.map((s) => s[0])) as readonly UnitId[];
export const KINDS = Object.freeze(Object.keys(BASE_UNIT)) as readonly Kind[];

export function isUnitId(x: unknown): x is UnitId {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(UNITS, x);
}

export function isKind(x: unknown): x is Kind {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(BASE_UNIT, x);
}

export function unitsOf(kind: Kind): readonly UnitDef[] {
  return UNIT_IDS.filter((id) => UNITS[id].kind === kind).map((id) => UNITS[id]);
}

/** Unit text in its compact form: lower case, no spaces, " per " read as "/", unicode digits and symbols folded. */
export function normalizeUnitText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/₹/g, "inr")
    .replace(/µ/g, "u")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\s+per\s+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .replace(/(?<=[a-z])\.$/, "");
}

let aliasIndex: Map<string, UnitId[]> | null = null;
function aliasMap(): Map<string, UnitId[]> {
  if (aliasIndex) return aliasIndex;
  const m = new Map<string, UnitId[]>();
  const add = (key: string, id: UnitId) => {
    const list = m.get(key);
    if (!list) m.set(key, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const id of UNIT_IDS) {
    const def = UNITS[id];
    add(normalizeUnitText(id), id);
    add(normalizeUnitText(def.symbol), id);
    for (const a of def.aliases) add(normalizeUnitText(a), id);
  }
  aliasIndex = m;
  return m;
}

/** Alias lookup for headers, recipes and typed text. With a kind, only that kind answers. Null when nothing matches. */
export function findUnit(text: string, kind?: Kind): UnitId | null {
  const hits = aliasMap().get(normalizeUnitText(text));
  if (!hits) return null;
  const ok = kind ? hits.filter((id) => UNITS[id].kind === kind) : hits;
  return ok[0] ?? null;
}

/** Every token that reads as this unit, normalised. For tests and for pickers. */
export function aliasesOf(id: UnitId): readonly string[] {
  const out: string[] = [];
  for (const [key, ids] of aliasMap()) if (ids.includes(id)) out.push(key);
  return out;
}

/** Factor from one unit of `from` to one unit of `to` (same kind, offsets ignored). */
export function factorBetween(from: UnitId, to: UnitId): Ratio {
  const a = UNITS[from];
  const b = UNITS[to];
  return divRatio(ratio(a.num, a.den), ratio(b.num, b.den));
}

const decimalsCache = new Map<string, number>();

/**
 * Most decimals a person may type in `unit` for a column stored in `storage`: the largest d with
 * 10^-d of the unit at least one storage unit. Then what was typed reads back the same.
 * Can be negative (rupees per tonne go in whole tens). Composite and storage-only units follow the same maths.
 */
export function entryDecimals(unit: UnitId, storage: UnitId): number {
  const key = `${unit}>${storage}`;
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  const f = factorBetween(unit, storage);
  if (UNITS[unit].kind !== UNITS[storage].kind) throw new RangeError(`entryDecimals: ${unit} and ${storage} differ in kind`);
  let d = 12;
  while (d > -12) {
    const step = d >= 0 ? mulRatio(f, ratio(1n, pow10(d))) : mulRatio(f, ratio(pow10(-d), 1n));
    if (cmpRatio(step, ratio(1n)) >= 0) break;
    d--;
  }
  decimalsCache.set(key, d);
  return d;
}

/** True when `amount` sits on the unit's typing grid for this storage. */
export function onEntryGrid(amount: Ratio, unit: UnitId, storage: UnitId): boolean {
  const d = entryDecimals(unit, storage);
  const step = d >= 0 ? ratio(1n, pow10(d)) : ratio(pow10(-d), 1n);
  return isMultipleOf(amount, step);
}
