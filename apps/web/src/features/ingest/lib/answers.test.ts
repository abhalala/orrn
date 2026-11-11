import { describe, expect, test } from "bun:test";

import { answerColumn, answerDateFormat, answerFromValue, answerRatesHidden, answerUnit, answerYesNo } from "./answers";
import { questionView } from "./model";

/**
 * Review E10: what the screens send is what the dry run reads.
 *
 * Server code cannot load in a web test (it imports the Cloudflare runtime), so `serverStores` restates the two
 * server rules this depends on, from `packages/server/src/lib/ingest/candidates.ts` (`ANSWER_CHECK`, accepted
 * answers) and `dryrun.ts` (`readAnswers`, which keeps `unit_unknown` and `date_format_ambiguous` only as strings).
 * If either changes, this restatement is what to change, with the server test that pins it.
 */
function serverStores(code: string, answer: unknown): { accepted: boolean; usable: boolean } {
  const accepted =
    code === "unit_unknown" ? typeof answer === "string" && answer.length > 0 && answer.length <= 20
    : code === "date_format_ambiguous" ? typeof answer === "string" && ["dmy", "mdy", "ymd", "d_mon_y", "excel_serial"].includes(answer)
    : code === "rates_hidden" ? answer === "leave_out" || answer === "owner_merges"
    : code === "column_meaning_unclear" ? typeof answer === "string" && answer.length <= 100
    : code === "create_legacy_die" || code === "new_customers" ? typeof answer === "boolean"
    : false;
  return { accepted, usable: accepted };
}
const sends = (b: { code: string; answer: unknown }) => serverStores(b.code, b.answer);

describe("answer builders against the server's rules", () => {
  test("every builder makes an answer the server accepts and keeps", () => {
    for (const b of [
      answerUnit("inr/kg"), answerUnit("kg/12ft"), answerDateFormat("mdy"), answerRatesHidden("leave_out"),
      answerRatesHidden("owner_merges"), answerColumn("sectionCode"), answerYesNo("new_customers", true), answerYesNo("create_legacy_die", false),
    ]) expect({ code: b.code, ...sends(b) }).toEqual({ code: b.code, accepted: true, usable: true });
  });
  test("the object shape the old README showed is not accepted for a unit, and the builders never make it", () => {
    expect(serverStores("unit_unknown", { unit: "lb" }).accepted).toBe(false);
    for (const b of [answerUnit("kg"), answerColumn("sectionCode"), answerDateFormat("dmy")]) expect(typeof b.answer).toBe("string");
  });
  test("every control value maps to a builder with the code of its question", () => {
    for (const code of ["unit_unknown", "date_format_ambiguous", "rates_hidden", "column_meaning_unclear"] as const) {
      expect(answerFromValue(code, "dmy").code).toBe(code);
    }
    expect(answerFromValue("new_customers", true)).toEqual({ code: "new_customers", answer: true });
    expect(() => answerFromValue("period_needed", "x")).toThrow();
  });
  test("rates_hidden offers two answers that do not borrow the Hold label", () => {
    const q = questionView({ code: "rates_hidden", subject: "", params: {}, answer: null, open: true });
    expect(q.control).toMatchObject({ kind: "choice" });
    const options = q.control.kind === "choice" ? q.control.options : [];
    expect(options.map((o) => [o.value, o.labelKey])).toEqual([["leave_out", "ingest.q.leaveRatesOut"], ["owner_merges", "ingest.q.ownerMerges"]]);
  });
});
