/**
 * The closed set of value transforms (plan B2): trim, case, split, pick, date, number, lookup. Each step reads the
 * text the step before produced. A number goes through `units-adapter.ts` only: exact, half-up once, never a float.
 */
import { parseDate } from "./dates";
import type { DateFormat, RecipeStep, ResolverId, UnitKind } from "./recipe";
import type { RefusalCode } from "./states";
import { canonicalUnit, convertToCanonical, parseUnitToken, splitFeetInches, unitsFor, type UnitId } from "./units-adapter";

export type NumberValue = {
  kind: UnitKind;
  /** Canonical value: whole grams, paise, mm, pcs; mm with one decimal for a dimension. */
  canonical: number;
  /** The unit the number was read in. */
  unit: UnitId;
  /** The text the person had, unchanged. */
  entered: string;
  /** True when half-up rounding changed the exact value. */
  rounded: boolean;
};

export type StepState = {
  text: string;
  number: NumberValue | null;
  date: string | null;
  lookup: ResolverId | null;
};

export type StepContext = {
  /** Replaces the unit of every `number` step of this field (the person's answer to `unit_unknown`). */
  unit?: UnitId;
  /** Replaces the format of every `date` step of this field (the answer to `date_format_ambiguous`). */
  dateFormat?: DateFormat;
  currentYear?: number;
};

export type StepResult = { ok: true; state: StepState } | { ok: false; code: RefusalCode; detail?: string };

export const startState = (text: string): StepState => ({ text, number: null, date: null, lookup: null });

// ---------------------------------------------------------------- text

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

export function splitText(text: string, sep: string, index: number): string {
  const parts = sep === " " ? text.trim().split(/\s+/) : sep === "x" ? text.split(/x/i) : text.split(sep);
  const i = index < 0 ? parts.length + index : index;
  return (parts[i] ?? "").trim();
}

// ---------------------------------------------------------------- numbers

/** Thousands grouping: western `1,234,567.5` or Indian `12,34,567.5`. Any other comma is a typo or a decimal comma. */
const WESTERN_GROUPS = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
const INDIAN_GROUPS = /^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d*)?$/;

const NUMBER_HEAD = /^(\d[\d,]*(?:\.\d*)?|\.\d+)\s*(.*)$/s;

/** A unit name that the plan allows on this kind, from the recipe text. Null when it names nothing valid. */
export function resolveUnit(kind: UnitKind, unit: string): UnitId | null {
  const direct = unitsFor(kind).find((u) => u === unit);
  return direct ?? parseUnitToken(kind, unit);
}

const OTHER_KINDS: UnitKind[] = ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"];

export type NumberRead =
  | { ok: true; value: NumberValue }
  | { ok: false; code: RefusalCode };

/** Devanagari (U+0966..096F) and Gujarati (U+0AE6..0AEF) digits to ASCII, as the registry's parser folds them. */
export function foldIndicDigits(text: string): string {
  return text.replace(/[\u0966-\u096F\u0AE6-\u0AEF]/g, (ch) => {
    const c = ch.charCodeAt(0);
    return String(c >= 0x0ae6 ? c - 0x0ae6 : c - 0x0966);
  });
}

export function readNumber(textIn: string, kind: UnitKind, declared: UnitId | null): NumberRead {
  let t = foldIndicDigits(textIn.normalize("NFKC")).trim();
  if (kind === "price_per_mass") t = t.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/\s*\/-$/, "");
  let decimal: string;
  let unit: UnitId | null = declared;

  const lengthLike = kind === "length";
  const feetInches = lengthLike ? splitFeetInches(t) : null;
  if (feetInches !== null) {
    decimal = feetInches;
    unit = "ft_in";
  } else if (lengthLike && declared === "ft_in" && /^\d+-\d+(?:\.\d+)?$/.test(t)) {
    decimal = t.replace("-", " ");
  } else {
    const m = NUMBER_HEAD.exec(t);
    if (!m) return { ok: false, code: "bad_number" };
    const head = m[1]!;
    const rest = m[2]!.trim();
    if (head.includes(",") && !WESTERN_GROUPS.test(head) && !INDIAN_GROUPS.test(head)) return { ok: false, code: "bad_number" };
    decimal = head.replace(/,/g, "");
    if (rest !== "") {
      const own = parseUnitToken(kind, rest);
      if (own === null) {
        // A unit of another kind in the cell is a mismatch, anything else is not a number.
        const other = OTHER_KINDS.some((k) => k !== kind && parseUnitToken(k, rest) !== null);
        return { ok: false, code: other ? "unit_mismatch" : "bad_number" };
      }
      unit = own;
    }
  }
  if (unit === null) return { ok: false, code: "unit_unknown" };
  const r = convertToCanonical({ kind, unit, decimal });
  if (!r.ok) return { ok: false, code: r.code };
  // A count is whole: 12.5 pieces is a typo or a weight in the wrong column, never 13 pieces.
  if (kind === "count" && r.rounded) return { ok: false, code: "not_whole" };
  return { ok: true, value: { kind, canonical: r.canonical, unit, entered: textIn.trim(), rounded: r.rounded } };
}

// ---------------------------------------------------------------- steps

export function runStep(step: RecipeStep, state: StepState, cx: StepContext): StepResult {
  const ok = (patch: Partial<StepState>): StepResult => ({ ok: true, state: { ...state, ...patch } });
  switch (step.op) {
    case "trim":
      return ok({ text: state.text.trim() });
    case "case":
      return ok({
        text: step.to === "upper" ? state.text.toUpperCase() : step.to === "lower" ? state.text.toLowerCase() : titleCase(state.text),
      });
    case "split":
      return ok({ text: splitText(state.text, step.sep, step.index) });
    case "pick": {
      const t = state.text.trim();
      if (t === "") return ok({});
      const hit = step.map.find((p) => p.from === t) ?? step.map.find((p) => p.from.toLowerCase() === t.toLowerCase());
      if (hit) return ok({ text: hit.to });
      if (step.otherwise === "keep") return ok({});
      if (step.otherwise === "blank") return ok({ text: "" });
      return { ok: false, code: "pick_refused", detail: t };
    }
    case "date": {
      if (state.text.trim() === "") return ok({ date: null });
      const iso = parseDate(state.text, cx.dateFormat ?? step.format, { currentYear: cx.currentYear });
      return iso === null ? { ok: false, code: "bad_date", detail: state.text.trim() } : ok({ date: iso });
    }
    case "number": {
      if (state.text.trim() === "") return ok({ number: null });
      const declared = cx.unit ?? (step.unit === null ? null : resolveUnit(step.kind, step.unit));
      if (declared === null && step.unit !== null && cx.unit === undefined) return { ok: false, code: "unit_mismatch", detail: step.unit };
      const r = readNumber(state.text, step.kind, declared);
      return r.ok ? ok({ number: r.value }) : { ok: false, code: r.code, detail: state.text.trim() };
    }
    case "lookup":
      return ok({ lookup: step.resolver });
  }
}

export function runSteps(steps: readonly RecipeStep[], text: string, cx: StepContext): StepResult {
  let state = startState(text);
  for (const step of steps) {
    const r = runStep(step, state, cx);
    if (!r.ok) return r;
    state = r.state;
  }
  return { ok: true, state };
}

export { canonicalUnit };
