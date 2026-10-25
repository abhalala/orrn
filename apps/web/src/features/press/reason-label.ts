import type { Locale, MessageKey, Translate } from "@orrn/i18n";

export type ReasonCodeKind = "downtime" | "qc_reject" | "void" | "reprint" | "ageing_hold" | "ageing_rework" | "ageing_scrap" | "reallocate";

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
