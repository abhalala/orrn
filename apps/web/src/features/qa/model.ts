/**
 * Pure helpers of the quality screens (XE parity lane QA). The server computes every verdict; these only
 * read what people type (mm, MPa, %, °C, days) into the integers the procedures take, and pick tones.
 * Number boxes go through `parseDecimal` (a comma is digit grouping or nothing, units sweep 3).
 */
import { parseDecimal, type CalibrationState, type QaCheckKind, type QaSubjectType, QA_KIND_SUBJECTS } from "@orrn/domain";

/** "2.45" mm -> 2450 µm; null for blank, not a number, or more than three decimals. */
export function umFromMm(text: string): number | null {
  if (!text.trim()) return null;
  const n = parseDecimal(text);
  if (n === null) return null;
  const um = Math.round(n * 1000);
  return Math.abs(um - n * 1000) < 1e-6 ? um : null;
}

/** 2450 µm -> "2.45" (no trailing zeros). */
export function mmText(um: number | null | undefined): string {
  if (um === null || um === undefined) return "";
  return String(Number((um / 1000).toFixed(3)));
}

/** "12.5" -> 125 (tenths), null for blank, not a number or more than one decimal. */
export function tenthsFrom(text: string): number | null {
  if (!text.trim()) return null;
  const n = parseDecimal(text);
  if (n === null) return null;
  const x10 = Math.round(n * 10);
  return Math.abs(x10 - n * 10) < 1e-6 ? x10 : null;
}

/** 125 -> "12.5", 120 -> "12". */
export function tenthsText(x10: number | null | undefined): string {
  if (x10 === null || x10 === undefined) return "";
  return String(x10 / 10);
}

/** A whole number from a box, or null for blank or not a whole number. */
export function wholeFrom(text: string): number | null {
  if (!text.trim()) return null;
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** A box that may be blank: blank is ok (null), text must parse. `bad` is true when typed text does not read. */
export function optional<T>(text: string, read: (t: string) => T | null): { value: T | null; bad: boolean } {
  if (!text.trim()) return { value: null, bad: false };
  const value = read(text);
  return { value, bad: value === null };
}

export type DimensionDraft = { name: string; nominal: string; minus: string; plus: string; measured: string };
export const emptyDimension = (): DimensionDraft => ({ name: "", nominal: "", minus: "", plus: "", measured: "" });

export type DimensionInput = { name: string; nominalUm: number; minusUm: number; plusUm: number; measuredUm: number };

/** Draft rows to the procedure's rows; null when any row has a blank or unreadable box (rows left wholly blank are dropped). */
export function dimensionsFromDrafts(rows: readonly DimensionDraft[], withMeasured = true): DimensionInput[] | null {
  const out: DimensionInput[] = [];
  for (const r of rows) {
    const blank = !r.name.trim() && !r.nominal.trim() && !r.minus.trim() && !r.plus.trim() && !r.measured.trim();
    if (blank) continue;
    const nominalUm = umFromMm(r.nominal);
    const minusUm = umFromMm(r.minus);
    const plusUm = umFromMm(r.plus);
    const measuredUm = withMeasured ? umFromMm(r.measured) : nominalUm;
    if (!r.name.trim() || nominalUm === null || minusUm === null || plusUm === null || measuredUm === null) return null;
    out.push({ name: r.name.trim(), nominalUm, minusUm, plusUm, measuredUm });
  }
  return out;
}

/** Plan dimensions to drafts, the measured box empty (a check starts from the plan). */
export function draftsFromPlan(dims: readonly { name: string; nominalUm: number; minusUm: number; plusUm: number }[]): DimensionDraft[] {
  return dims.map((d) => ({ name: d.name, nominal: mmText(d.nominalUm), minus: mmText(d.minusUm), plus: mmText(d.plusUm), measured: "" }));
}

/** Which documents a kind of check can be recorded on (the server checks the same list). */
export function subjectsFor(kind: QaCheckKind): readonly QaSubjectType[] {
  return QA_KIND_SUBJECTS[kind];
}

/** Kinds where the person picks pass or fail; dimensions and mechanical tests are computed by the server. */
export function kindTakesResult(kind: QaCheckKind): boolean {
  return kind !== "dimension" && kind !== "mechanical";
}

export const resultTone = (result: string): "green" | "red" | "neutral" => (result === "pass" ? "green" : result === "unchecked" ? "neutral" : "red");

export function calibrationTone(state: CalibrationState): "green" | "amber" | "red" | "neutral" {
  return state === "ok" ? "green" : state === "due_soon" ? "amber" : state === "overdue" ? "red" : "neutral";
}

/** Flag names of a check row (`flags.flagged` for dimensions, `flags.low` for mechanical tests). */
export function flagNames(flags: unknown): { flagged: string[]; low: string[]; unchecked: string[] } {
  const f = (flags ?? {}) as { flagged?: unknown; low?: unknown; unchecked?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { flagged: list(f.flagged), low: list(f.low), unchecked: list(f.unchecked) };
}
