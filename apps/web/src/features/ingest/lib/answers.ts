import type { QuestionCode } from "./types";

/** What the server stores for each question (`readAnswers` in the dry run). One shape per code, built here. */
export type BuiltAnswer =
  | { code: "unit_unknown"; answer: string }
  | { code: "date_format_ambiguous"; answer: "dmy" | "mdy" | "ymd" }
  | { code: "rates_hidden"; answer: "leave_out" | "owner_merges" }
  | { code: "column_meaning_unclear"; answer: string }
  | { code: "create_legacy_die" | "new_customers"; answer: boolean }
  | { code: "period_needed"; answer: { fy: string | null; asOf: string } }
  /** "as_is" (the flagged values are right) or the unit they are in, as a bare unit id like `unit_unknown`. */
  | { code: "magnitude_check"; answer: string };

/** The unit is the bare unit id (`"kg"`, `"inr/kg"`), never an object. */
export const answerUnit = (unit: string): BuiltAnswer => ({ code: "unit_unknown", answer: unit });
export const answerDateFormat = (format: "dmy" | "mdy" | "ymd"): BuiltAnswer => ({ code: "date_format_ambiguous", answer: format });
export const answerRatesHidden = (choice: "leave_out" | "owner_merges"): BuiltAnswer => ({ code: "rates_hidden", answer: choice });
export const answerColumn = (field: string): BuiltAnswer => ({ code: "column_meaning_unclear", answer: field });
/** Value check on a column (work order, `magnitude_check`): the values are right, or they are in this unit. */
export const answerMagnitude = (value: "as_is" | (string & {})): BuiltAnswer => ({ code: "magnitude_check", answer: value });
export const answerYesNo = (code: "create_legacy_die" | "new_customers", yes: boolean): BuiltAnswer => ({ code, answer: yes });

/** The answer a control produced (its select value, or a yes or no) for a question code. */
export function answerFromValue(code: QuestionCode, value: string | boolean): BuiltAnswer {
  switch (code) {
    case "unit_unknown":
      return answerUnit(String(value));
    case "date_format_ambiguous":
      return answerDateFormat(value === "mdy" ? "mdy" : value === "ymd" ? "ymd" : "dmy");
    case "rates_hidden":
      return answerRatesHidden(value === "owner_merges" ? "owner_merges" : "leave_out");
    case "column_meaning_unclear":
      return answerColumn(String(value));
    case "create_legacy_die":
    case "new_customers":
      return answerYesNo(code, value === true);
    case "magnitude_check":
      return answerMagnitude(String(value));
    case "period_needed":
      throw new Error("The period is confirmed with confirmPeriod, not answered");
  }
}

