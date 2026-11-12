import { describe, expect, test } from "bun:test";

import { answerColumn, answerDateFormat, answerFromValue, answerMagnitude, answerRatesHidden, answerUnit, answerYesNo } from "./answers";
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
    // `ANSWER_CHECK.magnitude_check` accepts a unit (checked again in `setAnswer`) or "as_is", as a string.
    : code === "magnitude_check" ? typeof answer === "string" && answer.length > 0 && answer.length <= 20
    : false;
  return { accepted, usable: accepted };
}
const sends = (b: { code: string; answer: unknown }) => serverStores(b.code, b.answer);

describe("answer builders against the server's rules", () => {
  test("every builder makes an answer the server accepts and keeps", () => {
    for (const b of [
      answerUnit("inr/kg"), answerUnit("kg/12ft"), answerDateFormat("mdy"), answerRatesHidden("leave_out"),
      answerRatesHidden("owner_merges"), answerColumn("sectionCode"), answerYesNo("new_customers", true), answerYesNo("create_legacy_die", false), answerMagnitude("as_is"), answerMagnitude("kg"), answerMagnitude("kg/12ft"),
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
    expect(answerFromValue("magnitude_check", "as_is")).toEqual({ code: "magnitude_check", answer: "as_is" });
    expect(answerFromValue("magnitude_check", "kg")).toEqual({ code: "magnitude_check", answer: "kg" });
    expect(() => answerFromValue("period_needed", "x")).toThrow();
  });
  test("a value check is answered as the bare string: the values are right, or the unit they are in", () => {
    const q = questionView({ code: "magnitude_check", subject: "weightG", params: { field: "weightG", unit: "t", likelyUnit: "", side: "above", count: 3 }, answer: null, open: true }, "bundles");
    expect(q.control).toMatchObject({ kind: "magnitude", likelyUnit: null });
    expect(q.key).toBe("ingest.q.magnitude_check");
    expect(q.answers.map((a) => a.value)).toEqual(["as_is"]);
    expect(answerMagnitude("as_is").answer).toBe("as_is");
    // The unit picker lists every unit of the column's kind, as recipe unit ids the server reads again.
    expect(q.control.kind === "magnitude" ? q.control.units.map((u) => u.value) : []).toEqual(["g", "kg", "t", "qtl", "lb"]);
  });
  test("an answered value check says what was answered", () => {
    const yes = questionView({ code: "magnitude_check", subject: "weightG", params: { field: "weightG", unit: "", side: "", count: 0 }, answer: "as_is", open: false }, "bundles");
    expect(yes.answered).toBe(true);
    expect(yes.answeredWords).toEqual({ key: "ingest.q.magnitudeAsIs" });
    const unit = questionView({ code: "magnitude_check", subject: "weightG", params: { field: "weightG", unit: "", side: "", count: 0 }, answer: "kg", open: false }, "bundles");
    expect(unit.answeredWords).toEqual({ key: "ingest.q.magnitudeUnit", varKeys: { unit: "ingest.unit.kg" } });
  });
  test("an answered question shows its answer in words: the unit, the date order, the add-it choice", () => {
    const unit = questionView({ code: "unit_unknown", subject: "weightMinG", params: { field: "weightMinG", kind: "linear_mass" }, answer: "kg/12ft", open: false });
    expect(unit.answeredWords).toEqual({ key: "ingest.unit.kg_12ft" });
    const date = questionView({ code: "date_format_ambiguous", subject: "d", params: { sample: "03/04/2025" }, answer: "dmy", open: false });
    expect(date.answeredWords).toEqual({ key: "", text: "dd/mm/yyyy" });
    const legacy = questionView({ code: "create_legacy_die", subject: "X", params: { code: "X" }, answer: false, open: false });
    expect(legacy.answeredWords).toEqual({ key: "ingest.q.skipRows" });
  });
  test("rates_hidden offers two answers that do not borrow the Hold label", () => {
    const q = questionView({ code: "rates_hidden", subject: "", params: {}, answer: null, open: true });
    expect(q.control).toMatchObject({ kind: "choice" });
    const options = q.control.kind === "choice" ? q.control.options : [];
    expect(options.map((o) => [o.value, o.labelKey])).toEqual([["leave_out", "ingest.q.leaveRatesOut"], ["owner_merges", "ingest.q.ownerMerges"]]);
  });
});
