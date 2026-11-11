/**
 * Canonical integers to text. Digits and grouping are written by hand (style.ts); only month names and the
 * plant clock use Intl, assembled from parts. Never throws: null, undefined and non-finite give "-".
 */
import { fromBase, toBase } from "./convert";
import { resolveField, type FieldId, type QuantityField } from "./fields";
import { toCanonical, type CanonicalResult } from "./canonical";
import { numberToDecimalText, parseAmount } from "./parse";
import { gcd, pow10, ratio, roundHalfAway, type Ratio } from "./rational";
import { entryDecimals, factorBetween, UNITS, type Kind, type UnitDef, type UnitId } from "./registry";
import { type Context, type ResolvedPrefs, prefsKey } from "./prefs";
import { writeAmount, writeScaled, type NumberStyle } from "./style";

export const EMPTY_TEXT = "-";

/** A stored number as an exact ratio. A stray non-integer reads as the decimal it prints as. */
function valueRatio(value: number): Ratio | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value) && Number.isSafeInteger(value)) return ratio(BigInt(value));
  const t = numberToDecimalText(value);
  const p = t === null ? null : parseAmount(t, { grouping: "none", decimal: ".", group: "," }, { negative: true });
  return p?.ok ? p.amount : null;
}

/** A stored value as an amount of `unit`, rounded to `decimals` and written. Number fast path, BigInt after. */
export function formatStorage(
  value: number,
  storage: UnitId,
  unit: UnitId,
  decimals: number,
  style: NumberStyle,
  opts: { trim?: boolean; minDecimals?: number } = {},
): string {
  const a = UNITS[storage];
  const b = UNITS[unit];
  if (Number.isSafeInteger(value) && decimals >= 0 && a.offNum === undefined && b.offNum === undefined) {
    const f = factorBetween(storage, unit);
    const mul = f.num * pow10(decimals);
    const n = Number(mul);
    const d = Number(f.den);
    if (Number.isSafeInteger(n) && Number.isSafeInteger(d)) {
      const p = value * n;
      if (Number.isSafeInteger(p)) {
        const neg = p < 0;
        const abs = neg ? -p : p;
        const r = (2 * abs + d) % (2 * d);
        const q = (2 * abs + d - r) / (2 * d);
        if (Number.isSafeInteger(2 * abs + d)) return writeScaled(BigInt(neg ? -q : q), decimals, style, opts);
      }
    }
  }
  const r = valueRatio(value);
  if (!r) return EMPTY_TEXT;
  return writeAmount(fromBase(toBase(r, storage), unit), decimals, style, opts);
}

/**
 * Feet and inches from mm on a grid of 1/4, 1/8 or 1/16 inch: "11 ft 6.25 in", "12 ft", "6.5 in".
 * With `fraction` the inches read "6 1/4". Today's quarter-inch output is `grid: 4` without `fraction`.
 */
export function formatFtIn(mm: number, grid: 4 | 8 | 16, style: NumberStyle, opts: { fraction?: boolean } = {}): string {
  const r = valueRatio(mm);
  if (!r) return EMPTY_TEXT;
  const g = BigInt(grid);
  const total = roundHalfAway(r.num * 5n * g, r.den * 127n);
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const perFoot = 12n * g;
  const feet = abs / perFoot;
  const rem = abs % perFoot;
  const wholeIn = rem / g;
  const part = rem % g;
  let inchText: string;
  if (opts.fraction) {
    const k = gcd(part, g) || 1n;
    const frac = part === 0n ? "" : `${part / k}/${g / k}`;
    inchText = frac ? (wholeIn === 0n ? frac : `${wholeIn} ${frac}`) : `${wholeIn}`;
  } else {
    inchText = writeAmount(ratio(rem, g), grid === 4 ? 2 : grid === 8 ? 3 : 4, { ...style, grouping: "none" }, { trim: true });
  }
  const sign = neg ? "-" : "";
  if (feet === 0n) return `${sign}${inchText} in`;
  if (rem === 0n) return `${sign}${feet} ft`;
  return `${sign}${feet} ft ${inchText} in`;
}

// Default decimals per unit for screen, total, print, export. They reproduce today's helpers (design table 4.6).
const PREC: Partial<Record<UnitId, readonly [number, number, number, number]>> = {
  g: [0, 0, 0, 0], kg: [3, 1, 2, 3], quintal: [2, 2, 2, 5], t: [3, 3, 3, 6], lb: [2, 1, 2, 2],
  cm: [1, 1, 1, 1], m: [3, 3, 3, 3], in: [2, 2, 2, 2], ft: [2, 2, 2, 2], mm: [0, 0, 0, 0],
  g_12ft: [0, 0, 0, 0], kg_12ft: [3, 3, 3, 3], kg_m: [3, 3, 3, 3], g_m: [1, 1, 1, 1], kg_ft: [3, 3, 3, 3], lb_ft: [3, 3, 3, 3],
  paise: [0, 0, 0, 0], inr: [2, 2, 2, 2], paise_kg: [0, 0, 0, 0], inr_kg: [2, 2, 2, 2], inr_quintal: [0, 0, 0, 0], inr_t: [0, 0, 0, 0],
  bp: [0, 0, 0, 0], ppm: [0, 0, 0, 0], c: [1, 1, 1, 1], f: [0, 0, 0, 0],
  bar: [1, 1, 1, 1], mpa: [2, 2, 2, 2], kgf_cm2: [1, 1, 1, 1], psi: [0, 0, 0, 0],
  mm_s: [1, 1, 1, 1], m_min: [2, 2, 2, 2], ft_min: [1, 1, 1, 1],
  ml: [0, 0, 0, 0], l: [3, 3, 3, 3], m3: [3, 3, 3, 3], ms: [0, 0, 0, 0], s: [0, 0, 0, 0], min: [0, 0, 0, 0], h: [2, 2, 2, 2],
  pcs: [0, 0, 0, 0],
};
const CTX_INDEX: Record<Exclude<Context, "entry" | "axis">, number> = { screen: 0, total: 1, print: 2, export: 3 };

export function defaultDecimals(unit: UnitId, storage: UnitId, ctx: Context): number {
  if (ctx === "entry") return Math.min(8, Math.max(0, entryDecimals(unit, storage)));
  const c = ctx === "axis" ? "screen" : ctx;
  if (unit === "pct") return (storage === "ppm" ? [3, 3, 3, 4] : [1, 1, 1, 2])[CTX_INDEX[c]]!;
  const row = PREC[unit];
  if (row) return row[CTX_INDEX[c]]!;
  return Math.min(6, Math.max(0, entryDecimals(unit, storage)));
}

const COMPACT_TIERS = {
  indian: [{ size: 10_000_000n, suffix: "Cr" }, { size: 100_000n, suffix: "L" }, { size: 1_000n, suffix: "k" }],
  international: [{ size: 1_000_000_000n, suffix: "B" }, { size: 1_000_000n, suffix: "M" }, { size: 1_000n, suffix: "k" }],
} as const;

/** Compact number for axis ticks, exact: "950", "12k", "1.2L", "1.1Cr" (indian) or "1.2M" (international). */
export function formatCompact(value: number, scale: "indian" | "international", style: NumberStyle): string {
  const r = valueRatio(value);
  if (!r) return "";
  const tiers = COMPACT_TIERS[scale];
  const neg = r.num < 0n;
  const abs = ratio(neg ? -r.num : r.num, r.den);
  const sign = neg ? "-" : "";
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    if (abs.num < tier.size * abs.den) continue;
    const under100 = abs.num < tier.size * 100n * abs.den;
    // value in tier units, to one decimal below 100 and to whole units from 100
    const scaledTenths = under100
      ? roundHalfAway(abs.num * 10n, abs.den * tier.size)
      : roundHalfAway(abs.num, abs.den * tier.size) * 10n;
    const bigger = tiers[i - 1];
    if (bigger && scaledTenths * tier.size >= bigger.size * 10n) return `${sign}1${bigger.suffix}`;
    return `${sign}${writeScaled(scaledTenths, 1, style, { trim: true })}${tier.suffix}`;
  }
  const whole = roundHalfAway(abs.num, abs.den);
  return whole >= 1000n ? `${sign}1k` : `${sign}${whole}`;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = dtfCache.get(key);
  if (!f) {
    f = make();
    dtfCache.set(key, f);
  }
  return f;
}

export type FormatEnv = { locale: "en" | "hi" | "gu"; timeZone: string };
const LOCALE_TAG = { en: "en-IN-u-nu-latn", hi: "hi-IN-u-nu-latn", gu: "gu-IN-u-nu-latn" } as const;

function zoned(at: number, zone: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  if (!Number.isFinite(at)) return null;
  try {
    const f = dtf(`z|${zone}`, () => new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    }));
    const get = (t: string) => Number(f.formatToParts(at).find((p) => p.type === t)?.value);
    return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
  } catch {
    return null;
  }
}

function monthName(locale: FormatEnv["locale"], m: number): string {
  const f = dtf(`m|${locale}`, () => new Intl.DateTimeFormat(LOCALE_TAG[locale], { timeZone: "UTC", month: "short" }));
  return f.format(Date.UTC(2024, m - 1, 15));
}

const p2 = (n: number) => String(n).padStart(2, "0");

function assembleDate(prefs: ResolvedPrefs, env: FormatEnv, y: number, m: number, d: number, withYear: boolean): string {
  const { order, month } = prefs.date;
  if (month === "numeric") {
    if (order === "ymd") return withYear ? `${y}-${p2(m)}-${p2(d)}` : `${p2(m)}-${p2(d)}`;
    const [a, b] = order === "dmy" ? [p2(d), p2(m)] : [p2(m), p2(d)];
    return withYear ? `${a}/${b}/${y}` : `${a}/${b}`;
  }
  const name = monthName(env.locale, m);
  if (order === "dmy") return withYear ? `${d} ${name} ${y}` : `${d} ${name}`;
  if (order === "mdy") return withYear ? `${name} ${d}, ${y}` : `${name} ${d}`;
  return withYear ? `${y} ${name} ${d}` : `${name} ${d}`;
}

export type Fmt = {
  key: string;
  /** The resolved number style (grouping and marks), for callers that read text with `convertText` or `parseAmount`. */
  style: NumberStyle;
  /** The plant clock's zone and the screen language, for callers that need the year of an instant or a language's own joiner. */
  zone: string;
  locale: "en" | "hi" | "gu";
  q(field: QuantityField | FieldId, value: number | null | undefined, ctx?: Context): string;
  /** `trim` drops trailing zeros of the fraction ("12.5" for "12.500"), as the purchase and die screens do. */
  n(field: QuantityField | FieldId, value: number | null | undefined, ctx?: Context, opts?: { trim?: boolean }): string;
  unitOf(kind: Kind): UnitDef;
  header(caption: string, kind: Kind): string;
  entryText(field: QuantityField | FieldId, value: number): string;
  parse(field: QuantityField | FieldId, text: string): CanonicalResult;
  money(paise: number, ctx?: Context): string;
  compact(value: number): string;
  date(at: number | string, opts?: { year?: boolean }): string;
  time(at: number): string;
  /** A production day (no zone shift). `year` defaults to true. */
  day(ymd: string, opts?: { year?: boolean }): string;
};

const memo = new Map<string, Fmt>();

export function formatterFor(prefs: ResolvedPrefs, env: FormatEnv): Fmt {
  const key = `${prefsKey(prefs)}|${env.locale}|${env.timeZone}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const fmt = build(prefs, env, key);
  if (memo.size > 64) memo.clear();
  memo.set(key, fmt);
  return fmt;
}

function build(prefs: ResolvedPrefs, env: FormatEnv, key: string): Fmt {
  const plain: NumberStyle = { grouping: "none", decimal: ".", group: "," };
  // Lengths are never grouped: today's screens print "3658 mm" (slice b parity), and a cut length never needs it.
  const styleFor = (ctx: Context, kind?: Kind): NumberStyle =>
    ctx === "export" ? plain : kind === "length" ? { ...prefs.number, grouping: "none" } : prefs.number;
  const unitFor = (kind: Kind): UnitDef => UNITS[prefs.units[kind]];
  const decimalsFor = (kind: Kind, unit: UnitId, storage: UnitId, ctx: Context): number =>
    prefs.precision[`${kind}.${ctx}`] ?? defaultDecimals(unit, storage, ctx);
  const currency = (sym: string): string => (sym.startsWith("₹") ? prefs.currency.symbol + sym.slice(1) : sym);
  const withCurrency = (num: string, unit: UnitDef): string => {
    if (!unit.symbol.startsWith("₹")) return `${num} ${unit.symbol}`;
    const c = prefs.currency.symbol;
    return `${c}${c === "₹" ? "" : " "}${num}${unit.symbol.slice(1)}`;
  };
  const text = (field: QuantityField | FieldId, value: number | null | undefined, ctx: Context, withUnit: boolean, trim = false): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_TEXT;
    const f = resolveField(field);
    const unit = unitFor(f.kind);
    if (unit.composite) {
      const grid = ctx === "entry" ? 16 : prefs.inchGrid;
      return formatFtIn(value, grid, styleFor(ctx, f.kind), { fraction: ctx === "entry" });
    }
    const num = formatStorage(value, f.storage, unit.id, decimalsFor(f.kind, unit.id, f.storage, ctx), styleFor(ctx, f.kind), { trim });
    if (!withUnit || num === EMPTY_TEXT) return num;
    if (f.kind === "money" || f.kind === "money_per_mass") return withCurrency(num, unit);
    return unit.symbol === "%" ? `${num}%` : `${num} ${unit.symbol}`;
  };
  return {
    key,
    style: prefs.number,
    zone: env.timeZone,
    locale: env.locale,
    q: (field, value, ctx = "screen") => text(field, value, ctx, true),
    n: (field, value, ctx = "screen", opts = {}) => text(field, value, ctx, false, opts.trim === true),
    unitOf: unitFor,
    header(caption, kind) {
      return `${caption} (${currency(unitFor(kind).symbol)})`;
    },
    entryText(field, value) {
      const f = resolveField(field);
      const unit = unitFor(f.kind);
      if (unit.composite) return formatFtIn(value, 16, { ...prefs.number, grouping: "none" }, { fraction: true });
      const d = entryDecimals(unit.id, f.storage);
      return formatStorage(value, f.storage, unit.id, d, { ...prefs.number, grouping: "none" }, { trim: true });
    },
    parse(field, input) {
      return toCanonical(field, input, unitFor(resolveField(field).kind).id, { mode: "strict", style: prefs.number });
    },
    money(paise, ctx = "screen") {
      if (!Number.isFinite(paise)) return EMPTY_TEXT;
      const d = prefs.precision[`money.${ctx}`] ?? 2;
      const num = formatStorage(paise, "paise", "inr", d, styleFor(ctx));
      if (ctx === "export") return num;
      const c = prefs.currency.symbol;
      return `${c}${c === "₹" ? "" : " "}${num}`;
    },
    compact: (value) => formatCompact(value, prefs.currency.compact, prefs.number),
    date(at, opts = {}) {
      if (typeof at === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return this.day(at);
        at = Date.parse(at);
      }
      const z = zoned(at, env.timeZone);
      return z ? assembleDate(prefs, env, z.y, z.m, z.d, opts.year !== false) : EMPTY_TEXT;
    },
    time(at) {
      const z = zoned(at, env.timeZone);
      if (!z) return EMPTY_TEXT;
      if (prefs.clock === "h23") return `${p2(z.hh)}:${p2(z.mm)}`;
      const h = z.hh % 12 === 0 ? 12 : z.hh % 12;
      return `${h}:${p2(z.mm)} ${z.hh < 12 ? "am" : "pm"}`;
    },
    day(ymd, opts = {}) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
      if (!m) return EMPTY_TEXT;
      return assembleDate(prefs, env, Number(m[1]), Number(m[2]), Number(m[3]), opts.year !== false);
    },
  };
}

