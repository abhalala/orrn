import {
  defaultDecimals,
  formatFtIn,
  formatStorage,
  formatterFor,
  groupDigits,
  readUnitSettings,
  screenPrefs,
  UNITS,
  type Fmt,
  type FormatEnv,
  type Kind,
  type NumberStyle,
  type ResolvedPrefs,
  type UnitId,
} from "@orrn/domain";
import { registryUnitOf, type UnitKind } from "@orrn/ingest";

/**
 * The plant's units for the Imports screens (work order section 4, lead answer 5). One object gives the formatter
 * of `@orrn/domain` and the few things the screens need on top of it: a stored number in the plant's unit, a count
 * with Indian grouping, a date, and the file's own value when its unit differs.
 *
 * Today the preferences are the orrn default plus the plant's `lengthUnit` setting, read by `readUnitSettings`
 * (it also reads a `units` block when the plant has one). When the plant settings provider merges, the one line
 * that builds `prefs` in `plantUnitsFor` is the only one that changes.
 */
export type PlantUnits = {
  prefs: ResolvedPrefs;
  fmt: Fmt;
  style: NumberStyle;
  /** The registry unit a stored number of this kind shows in. */
  unitIdOf: (kind: UnitKind) => UnitId;
  /** A whole number or a count, grouped the way the plant reads numbers: 1,400 and 2,00,000. */
  count: (n: number) => string;
  /** A stored value in the plant's unit: the number and, apart, its unit text. */
  quantity: (kind: UnitKind, stored: number) => Quantity;
  /** The unit text of a kind in the plant's unit ("kg", "kg/12ft", "₹/kg"), for a column header. */
  unitText: (kind: UnitKind) => string;
  /** The file's own value as a second line, or null when its unit is the plant's unit. */
  fileSaid: (kind: UnitKind, entered: { text: string; unit: string | null }) => string | null;
  /** An ISO day as the plant writes dates ("11 Nov 2026"). */
  day: (iso: string) => string;
};

export type Quantity = {
  /** The number as the plant writes it, trailing zeros dropped. For feet and inches this is the whole text. */
  text: string;
  /** Muted text after the number. Empty when `text` already carries it (feet and inches). */
  unit: string;
};

export const DEFAULT_ENV: FormatEnv = { locale: "en", timeZone: "Asia/Kolkata" };

/** Where a stored number of each kind is kept. A dimension is stored as millimetres with one decimal. */
const STORED: Record<UnitKind, { kind: Kind; storage: UnitId }> = {
  mass: { kind: "mass", storage: "g" },
  length: { kind: "length", storage: "mm" },
  linear_mass: { kind: "linear_mass", storage: "g_12ft" },
  price_per_mass: { kind: "money_per_mass", storage: "paise_kg" },
  count: { kind: "count", storage: "pcs" },
  dimension: { kind: "length", storage: "mm" },
};

/**
 * The plant's unit for a kind. A die cross-section size (width, thickness, leg) always reads in millimetres: dies are
 * drawn and named in mm, and a plant that reads lengths in feet and inches still reads a 30 mm die as 30 mm.
 */
function unitIdFor(prefs: ResolvedPrefs, kind: UnitKind): UnitId {
  if (kind === "dimension") return "mm";
  return prefs.units[STORED[kind].kind];
}

/** Decimals for a stored value. A dimension keeps its tenth of a millimetre; every other kind uses the registry's screen rule. */
function decimalsFor(prefs: ResolvedPrefs, kind: UnitKind, unit: UnitId): number {
  const { kind: k, storage } = STORED[kind];
  if (kind === "dimension") return 1;
  return prefs.precision[`${k}.screen`] ?? defaultDecimals(unit, storage, "screen");
}

/** `"58,400"`, `"58400"`, `"2.4"`. Anything with a letter or a quote in it (`12' 6"`, `58.4 kg`) is not a bare number. */
const BARE_NUMBER = /^-?\d[\d,]*(\.\d+)?$|^-?\.\d+$/;

/** A bare number grouped by the plant's style. Digits the file wrote are kept, only the grouping marks change. */
export function groupBareNumber(text: string, style: NumberStyle): string | null {
  const t = text.trim().replace(/\s/g, "");
  if (!BARE_NUMBER.test(t)) return null;
  const plain = t.replace(/,/g, "");
  const neg = plain.startsWith("-");
  const [whole = "0", frac] = (neg ? plain.slice(1) : plain).split(".");
  const intPart = whole === "" ? "0" : whole.replace(/^0+(?=\d)/, "");
  return `${neg ? "-" : ""}${groupDigits(intPart, style)}${frac !== undefined ? style.decimal + frac : ""}`;
}

export function plantUnitsFor(settings: unknown, env: FormatEnv = DEFAULT_ENV): PlantUnits {
  // The one line that moves to the plant settings provider.
  const prefs = screenPrefs(readUnitSettings(settings));
  const fmt = formatterFor(prefs, env);
  const style = prefs.number;

  const unitIdOf = (kind: UnitKind): UnitId => unitIdFor(prefs, kind);
  const symbol = (id: UnitId): string => {
    const s = UNITS[id].symbol;
    return s.startsWith("₹") ? prefs.currency.symbol + s.slice(1) : s;
  };

  const quantity = (kind: UnitKind, stored: number): Quantity => {
    const unit = unitIdOf(kind);
    if (UNITS[unit].composite) return { text: formatFtIn(stored, prefs.inchGrid, style), unit: "" };
    const decimals = decimalsFor(prefs, kind, unit);
    const money = STORED[kind].kind === "money_per_mass";
    const text = formatStorage(stored, STORED[kind].storage, unit, decimals, style, { trim: true, minDecimals: money ? Math.min(2, decimals) : 0 });
    return { text, unit: symbol(unit) };
  };

  const unitText = (kind: UnitKind): string => {
    const unit = unitIdOf(kind);
    return UNITS[unit].composite ? "" : symbol(unit);
  };

  const fileSaid = (kind: UnitKind, entered: { text: string; unit: string | null }): string | null => {
    const raw = entered.text.trim();
    if (raw === "") return null;
    const plantUnit = unitIdOf(kind);
    const enteredUnit = entered.unit === null ? null : registryUnitOf(kind, entered.unit);
    if (enteredUnit !== null && enteredUnit === plantUnit) return null;
    const grouped = groupBareNumber(raw, style);
    // A bare number gets the file's unit after it. A cell that already carries its unit (`12' 6"`) is shown as typed.
    const unitWords = enteredUnit !== null ? symbol(enteredUnit) : entered.unit ?? "";
    return grouped === null ? raw : unitWords ? `${grouped} ${unitWords}` : grouped;
  };

  return {
    prefs,
    fmt,
    style,
    unitIdOf,
    count: (n) => {
      if (!Number.isFinite(n)) return "-";
      const neg = n < 0 ? "-" : "";
      return neg + groupDigits(String(Math.trunc(Math.abs(n))), style);
    },
    quantity,
    unitText,
    fileSaid,
    day: (iso) => fmt.day(iso),
  };
}
