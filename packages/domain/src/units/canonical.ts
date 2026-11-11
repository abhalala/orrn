/** Typed or imported text to a stored integer, and the magnitude hook. Never throws for a person's text. */
import { toStorageBig } from "./convert";
import { resolveField, type FieldId, type QuantityField } from "./fields";
import { numberToDecimalText, parseAmount, parseLengthText, type ParseProblem } from "./parse";
import { isMultipleOf, ratio, ratioToString, type Ratio } from "./rational";
import { entryDecimals, isUnitId, onEntryGrid, UNITS, type Kind, type UnitId } from "./registry";
import { DEFAULT_NUMBER_STYLE, type NumberStyle } from "./style";

export type Entered = { text: string; unit: UnitId };

export type CanonicalResult =
  | { ok: true; value: number; exact: boolean; entered: Entered; residue?: string }
  | { ok: false; problem: ParseProblem | "kind"; entered: Entered };

export type ConvertMode = "strict" | "round";

/** What the converter needs of a field. A QuantityField fits; the portal passes a bare kind and storage. */
export type ConvertTarget = Pick<QuantityField, "kind" | "storage" | "hard" | "whole">;

const SIXTEENTH = ratio(1n, 16n);
const TENTH = ratio(1n, 10n);
const HUNDREDTH = ratio(1n, 100n);

/** Strict entry: the amount must sit on the unit's typing grid, so what was typed reads back the same. */
function onGrid(amount: Ratio, unit: UnitId, storage: UnitId): boolean {
  if (unit === "in") return isMultipleOf(amount, TENTH) || isMultipleOf(amount, SIXTEENTH);
  if (unit === "ft_in") return isMultipleOf(amount, SIXTEENTH);
  return onEntryGrid(amount, unit, storage);
}

export type ConvertOutcome =
  | { ok: true; big: bigint; value: number; exact: boolean; residue: Ratio; entered: Entered }
  | { ok: false; problem: ParseProblem | "kind"; entered: Entered };

export function convertText(
  target: ConvertTarget,
  input: string | number,
  unit: UnitId,
  opts: { mode?: ConvertMode; style?: NumberStyle } = {},
): ConvertOutcome {
  // A sheet cell is an IEEE double. Excel keeps 15 significant digits, so 12.300000000000001 is 12.3.
  const sheet = typeof input === "number" && Number.isFinite(input) && !Number.isInteger(input) ? Number(input.toPrecision(15)) : input;
  const text = typeof sheet === "number" ? (numberToDecimalText(sheet) ?? String(sheet)) : sheet;
  const entered: Entered = { text, unit };
  const fail = (problem: ParseProblem | "kind"): ConvertOutcome => ({ ok: false, problem, entered });
  if (typeof input === "string" ? false : !Number.isFinite(input)) return fail("invalid");
  if (!isUnitId(unit)) return fail("unit");
  if (UNITS[unit].kind !== target.kind) return fail("kind");
  const strict = (opts.mode ?? "strict") === "strict";
  const style = opts.style ?? DEFAULT_NUMBER_STYLE;
  const signed = (target.hard?.[0] ?? 0) < 0;

  let amount: Ratio;
  let mathUnit: UnitId = unit;
  if (target.kind === "length") {
    const p = parseLengthText(text, unit === "ft_in" ? "ft" : unit, { style, negative: signed });
    if (!p.ok) return fail(p.problem);
    amount = p.amount;
    mathUnit = p.unit;
    if (p.explicit) entered.unit = p.parts?.feet && p.parts.inches ? "ft_in" : p.unit;
    if (strict && !p.parts?.feet && !onGrid(p.amount, p.unit, target.storage)) return fail("decimals");
    if (strict && p.parts?.inches && !onGrid(p.parts.inches, p.parts.feet ? "ft_in" : "in", target.storage)) return fail("decimals");
    if (strict && p.parts?.feet && p.parts.inches && !isMultipleOf(p.parts.feet, HUNDREDTH)) return fail("decimals");
    if (strict && p.parts?.feet && !p.parts.inches && !onGrid(p.parts.feet, "ft", target.storage)) return fail("decimals");
  } else {
    const p = parseAmount(text, style, { negative: signed });
    if (!p.ok) return fail(p.problem);
    amount = p.amount;
    if (strict && !onGrid(amount, unit, target.storage)) return fail("decimals");
  }

  const r = toStorageBig(amount, mathUnit, target.storage);
  const value = Number(r.big);
  if (!Number.isSafeInteger(value)) return fail("tooBig");
  if (strict && target.whole && !r.exact) return fail("whole");
  const [lo, hi] = target.hard ?? [-Infinity, Infinity];
  if (value > hi) return fail("tooBig");
  if (value < lo) return fail(value < 0 ? "negative" : "tooSmall");
  return { ok: true, big: r.big, value, exact: r.exact, residue: r.residue, entered };
}

/**
 * The import portal's entry point. `strict` holds the typing grid (a form refuses what it cannot store and read back);
 * `round` takes any text, rounds half away from zero once, and says `exact: false` with the leftover in `residue`.
 */
export function toCanonical(
  field: QuantityField | FieldId,
  input: string | number,
  unit: UnitId,
  opts?: { mode?: ConvertMode; style?: NumberStyle },
): CanonicalResult {
  const f = resolveField(field);
  const r = convertText(f, input, unit, opts);
  if (!r.ok) return r;
  const base = { ok: true as const, value: r.value, exact: r.exact, entered: r.entered };
  return r.exact ? base : { ...base, residue: ratioToString(r.residue) };
}

export type MagnitudeVerdict =
  | { ok: true }
  | { ok: false; level: "refuse" | "flag"; side: "below" | "above"; likelyUnit?: UnitId; likelyValue?: number };

const within = (v: number, range: readonly [number, number] | undefined) => !range || (v >= range[0] && v <= range[1]);

/**
 * Hard limits refuse, plausible limits flag. With the entered text, reads the number in every other unit of the kind and
 * names the one unit that lands inside `plausible`, when there is exactly one. It is an offer, never applied silently.
 */
export function checkMagnitude(field: QuantityField | FieldId, value: number, entered?: Entered): MagnitudeVerdict {
  const f = resolveField(field);
  const level: "refuse" | "flag" | null = !within(value, f.hard) ? "refuse" : !within(value, f.plausible) ? "flag" : null;
  if (!level) return { ok: true };
  const range = level === "refuse" ? f.hard! : f.plausible!;
  const side = value < range[0] ? "below" : "above";
  if (entered) {
    const hits: { unit: UnitId; value: number }[] = [];
    for (const def of Object.values(UNITS)) {
      if (def.kind !== f.kind || def.noEntry || def.id === entered.unit) continue;
      const r = toCanonical(f, entered.text, def.id, { mode: "round" });
      if (r.ok && within(r.value, f.plausible) && within(r.value, f.hard) && r.value !== value) hits.push({ unit: def.id, value: r.value });
    }
    if (hits.length === 1) return { ok: false, level, side, likelyUnit: hits[0]!.unit, likelyValue: hits[0]!.value };
  }
  return { ok: false, level, side };
}

export { entryDecimals };
export type { Kind };
