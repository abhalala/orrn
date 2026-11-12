import { LDO_KEYS, saveInputOf, type FormIssue, type MeltForm, type SaveContext } from "./melt-form";

/** Commas are digit grouping only. The first group has 1 to 3 digits, later groups 2 or 3, and the last group 3. */
export function hasValidDigitGrouping(text: string): boolean {
  const clean = text.trim();
  return !clean.includes(",") || /^\d{1,3}(?:,\d{2,3})*,\d{3}(?:\.\d+)?$/.test(clean);
}

export function phoneQuantityIssue(form: MeltForm): FormIssue | null {
  for (const [line, chemical] of form.chemicals.entries()) {
    if (!hasValidDigitGrouping(chemical.openText) || !hasValidDigitGrouping(chemical.usedText)) return { code: "chemical", step: "chemicals", line };
  }
  for (const key of LDO_KEYS) {
    if (!hasValidDigitGrouping(form.ldo[key])) return { code: "ldo", step: "chemicals" };
  }
  return null;
}

/** The phone validates locale-sensitive fields before the shared parser removes digit-grouping commas. */
export function phoneMeltInputOf(form: MeltForm, ctx: SaveContext): ReturnType<typeof saveInputOf> {
  const issue = phoneQuantityIssue(form);
  if (issue) return { ok: false, issue };
  return saveInputOf(form, ctx);
}
