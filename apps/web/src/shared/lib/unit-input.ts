/**
 * The input side of the units layer, as pure functions (no React): what a person typed in the plant's unit
 * becomes the canonical integer, or a clear reason it was refused. The exact path of `@orrn/domain` does the
 * arithmetic (BigInt rationals, no float multiply), so `1.005` per kg is 101 paise, not 100.
 */
import { entryDecimals, resolveField, type CanonicalResult, type Fmt, type FieldId, type ParseProblem, type QuantityField } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

export type UnitEntry =
  | { state: "blank" }
  | { state: "ok"; value: number; text: string; exact: boolean }
  | { state: "refused"; problem: ParseProblem | "kind" };

/** Typed text to a canonical integer in the plant's unit for `field`. Blank is its own state, not a zero. */
export function readUnitEntry(fmt: Fmt, field: QuantityField | FieldId, text: string): UnitEntry {
  if (text.trim() === "") return { state: "blank" };
  const r: CanonicalResult = fmt.parse(field, text);
  if (r.ok) return { state: "ok", value: r.value, text, exact: r.exact };
  return { state: "refused", problem: r.problem };
}

/** The text an edit field starts with for a stored value: the most digits that read back the same, no grouping. */
export function unitEntryText(fmt: Fmt, field: QuantityField | FieldId, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return fmt.entryText(field, value);
}

const PROBLEM_KEY: Record<ParseProblem | "kind", MessageKey> = {
  empty: "units.problem.empty",
  invalid: "units.problem.invalid",
  grouping: "units.problem.grouping",
  decimals: "units.problem.decimals",
  whole: "units.problem.whole",
  negative: "units.problem.negative",
  tooBig: "units.problem.tooBig",
  tooSmall: "units.problem.tooSmall",
  unit: "units.problem.invalid",
  kind: "units.problem.invalid",
};

/** The sentence for a refusal, in the person's language, naming the unit and the finest step it can hold. */
export function unitProblemText(t: Translate, fmt: Fmt, field: QuantityField | FieldId, problem: ParseProblem | "kind"): string {
  const f = resolveField(field);
  const unit = fmt.unitOf(f.kind);
  if (problem === "decimals") {
    if (unit.composite) return t("units.problem.decimalsFtIn");
    const places = Math.max(0, entryDecimals(unit.id, f.storage));
    return t(places === 0 ? "units.problem.decimalsWhole" : "units.problem.decimals", { unit: unit.symbol, places });
  }
  return t(PROBLEM_KEY[problem], { unit: unit.symbol });
}

/**
 * One keystroke of a unit field: the integer the form should hold (null while blank or refused) and the
 * sentence to show, if any. The field component calls this on every change, so tests can drive typing without a DOM.
 */
export function stepUnitText(
  t: Translate,
  fmt: Fmt,
  field: QuantityField | FieldId,
  text: string,
  required = false,
): { value: number | null; problem: string | null } {
  const entry = readUnitEntry(fmt, field, text);
  if (entry.state === "ok") return { value: entry.value, problem: null };
  if (entry.state === "refused") return { value: null, problem: unitProblemText(t, fmt, field, entry.problem) };
  return { value: null, problem: required ? unitProblemText(t, fmt, field, "empty") : null };
}
