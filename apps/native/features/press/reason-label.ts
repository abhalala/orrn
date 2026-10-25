import type { MessageKey, Translate } from "@orrn/i18n";

/** A reason code in the reader's language: `reasons.<kind>.<code>` for the seeded codes, the stored English label for a plant-added one. */
export function reasonLabel(t: Translate, kind: "downtime" | "qc_reject" | "void", code: string, label: string): string {
  const key = `reasons.${kind}.${code}` as MessageKey;
  const text = t(key);
  return text === key ? label : text;
}
