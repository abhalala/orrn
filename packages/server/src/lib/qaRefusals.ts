/**
 * Every sentence a quality procedure or a quality gate in another module (dispatch scan, pack, melt
 * lock) may refuse with (XE parity lane QA). Code goes in, sentence comes out: callers never write their
 * own words. Each sentence is matched in `@orrn/i18n/refusal-qa` and said from `qa.refusal.*` (en, hi);
 * `packages/i18n/src/refusal-qa.test.ts` reads this file and fails on a sentence left unmapped.
 */
import { TRPCError } from "@trpc/server";

import type { QaRefusalCode } from "@orrn/domain";

type Code = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND";
type V = Record<string, string | number>;
const s = (v: V, k: string) => String(v[k] ?? "");

/** Code to sentence. Variables: serial, lot, run, code, alloy, n. */
export const QA_REFUSALS: Record<QaRefusalCode, (v: V) => { code: Code; message: string }> = {
  bundle_on_qa_hold: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is on quality hold` }),
  already_on_hold: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is already on quality hold` }),
  not_on_hold: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is not on quality hold` }),
  bundle_not_in_stock: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not in stock; only stock can go on quality hold` }),
  bundle_on_load: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is held on a load; take it off the load first` }),
  lot_waiting: (v) => ({ code: "BAD_REQUEST", message: `${s(v, "lot")} is waiting for inspection` }),
  lot_failed: (v) => ({ code: "BAD_REQUEST", message: `${s(v, "lot")} failed inspection` }),
  first_piece_waiting: (v) => ({ code: "BAD_REQUEST", message: `The first piece of ${s(v, "run")} is not checked yet` }),
  first_piece_failed: (v) => ({ code: "BAD_REQUEST", message: `The first piece of ${s(v, "run")} failed; check a new piece first` }),
  kind_subject: () => ({ code: "BAD_REQUEST", message: "This check cannot be recorded on that" }),
  subject_not_found: () => ({ code: "NOT_FOUND", message: "Not found" }),
  dimensions_none: () => ({ code: "BAD_REQUEST", message: "Enter at least one dimension" }),
  dimensions_too_many: (v) => ({ code: "BAD_REQUEST", message: `Enter at most ${s(v, "n")} dimensions` }),
  dimensions_bad_value: () => ({ code: "BAD_REQUEST", message: "Each dimension needs a name, a nominal above zero and its tolerances" }),
  dimensions_duplicate: () => ({ code: "BAD_REQUEST", message: "A dimension is listed twice" }),
  mechanical_none: () => ({ code: "BAD_REQUEST", message: "Enter at least one test value" }),
  result_needed: () => ({ code: "BAD_REQUEST", message: "Pick pass or fail" }),
  temper_code: () => ({ code: "BAD_REQUEST", message: "Use a temper code such as T6, T5 or O, at most 8 letters and digits" }),
  temper_taken: (v) => ({ code: "CONFLICT", message: `Temper ${s(v, "code")} is already in the list` }),
  temper_yield: () => ({ code: "BAD_REQUEST", message: "The yield minimum cannot be above the tensile minimum" }),
  plan_limits: () => ({ code: "BAD_REQUEST", message: "A lower limit is above its upper limit" }),
  plan_copy_section: () => ({ code: "BAD_REQUEST", message: "This die copy belongs to another section" }),
  station_taken: (v) => ({ code: "CONFLICT", message: `The code ${s(v, "code")} is already used` }),
  station_code: () => ({ code: "BAD_REQUEST", message: "Use letters, digits and dashes for the code, at most 16" }),
  substitute_same: () => ({ code: "BAD_REQUEST", message: "An alloy cannot be its own substitute" }),
  substitute_taken: (v) => ({ code: "CONFLICT", message: `${s(v, "alloy")} is already a substitute here` }),
  instrument_taken: (v) => ({ code: "CONFLICT", message: `Instrument ${s(v, "code")} is already in the list` }),
  instrument_code: () => ({ code: "BAD_REQUEST", message: "Use letters, digits and dashes for the instrument code, at most 24" }),
  calibration_future: () => ({ code: "BAD_REQUEST", message: "The calibration date cannot be in the future" }),
  certificate_kind: () => ({ code: "BAD_REQUEST", message: "The certificate must be a PDF or a photo" }),
};

export function qaRefusal(code: QaRefusalCode, vars: V = {}): TRPCError {
  const r = QA_REFUSALS[code](vars);
  return new TRPCError({ code: r.code, message: r.message });
}
