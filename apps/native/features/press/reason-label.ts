import type { Locale, MessageKey, Translate } from "@orrn/i18n";

// Same rule as apps/web/src/features/press/reason-label.ts (W4-MASTERS review m-2): keep the two in step.

export type ReasonCodeKind = "downtime" | "qc_reject" | "void" | "reprint" | "ageing_hold" | "ageing_rework" | "ageing_scrap" | "ageing_abort" | "ageing_reject" | "reallocate" | "cast_tail" | "melt_correct";

/** The wording a plant typed for a code in another language (null / missing = none typed). */
/** `standard`: a standard code still on its standard English wording (the server says; not renamed). */
export type ReasonWording = { labelHi?: string | null; labelGu?: string | null; standard?: boolean };

/**
 * A reason code in the reader's language. In order:
 * 1. the Hindi / Gujarati wording the plant typed for this code (Masters, Reason codes), when the reader uses that language;
 * 2. the built-in translation (`reasons.<kind>.<code>`) of a standard code that was not renamed;
 * 3. the stored English label (a plant-added or renamed code).
 */
export function reasonLabel(
  t: Translate,
  kind: ReasonCodeKind,
  code: string,
  label: string,
  wording?: ReasonWording,
  locale?: Locale | string,
): string {
  const typed = locale === "hi" ? wording?.labelHi : locale === "gu" ? wording?.labelGu : null;
  if (typed) return typed;
  // A standard code that kept its standard English wording (or came with no wording at all) shows its
  // built-in translation; a renamed or plant-added code shows its own English label.
  const unchanged = !label || label === code || wording?.standard === true;
  if (unchanged) {
    const key = `reasons.${kind}.${code}` as MessageKey;
    const text = t(key);
    if (text !== key) return text;
  }
  return label || code;
}

/** One row of `press.reasons` (the plant's active codes of a kind, in its order). */
export type ReasonRow = { code: string; label: string; requiresNote?: boolean | null; active?: boolean | null } & ReasonWording;

/**
 * Picker options from the plant's codes (W4-MASTERS review I-3): the server list, never a fixed one,
 * so a retired code is gone and a code the plant added is there. `value` is the code.
 */
export function reasonOptions(
  t: Translate,
  kind: ReasonCodeKind,
  rows: readonly ReasonRow[] | undefined,
  locale?: Locale | string,
): { value: string; label: string; requiresNote: boolean }[] {
  return (rows ?? [])
    .filter((r) => r.active !== false)
    .map((r) => ({ value: r.code, label: reasonLabel(t, kind, r.code, r.label, r, locale), requiresNote: Boolean(r.requiresNote) || r.code === "other" }));
}

/** A saved code in the reader's language, using the plant's row when it is still listed. */
export function reasonCodeText(t: Translate, kind: ReasonCodeKind, code: string, rows: readonly ReasonRow[] | undefined, locale?: Locale | string): string {
  const row = rows?.find((r) => r.code === code);
  return row ? reasonLabel(t, kind, code, row.label, row, locale) : reasonLabel(t, kind, code, code);
}
