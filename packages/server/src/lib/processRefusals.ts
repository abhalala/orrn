/**
 * Every sentence a process step (job work, finishing line, draw bench, fabrication) or a process gate
 * in another module (dispatch, stock move, bundle void and restore, ageing load) may refuse with (XE
 * parity lane JOBWORK). Code goes in, sentence comes out: callers never write their own words. Each
 * sentence is matched in `@orrn/i18n/refusal-jobwork` and said from `jw.refusal.*` (en, hi, gu);
 * `packages/i18n/src/refusal-jobwork.test.ts` reads this file and fails on a sentence left unmapped.
 */
import { TRPCError } from "@trpc/server";

import type { ProcessRefusalCode } from "@orrn/domain";

type Code = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND";
type V = Record<string, string | number>;
const s = (v: V, k: string) => String(v[k] ?? "");

export type JobworkRefusalCode = ProcessRefusalCode | "vendor_code_taken" | "vendor_has_stock" | "consumed_input" | "vendor_location";

/** Code to sentence. Variables: serial, step, code. */
export const JOBWORK_REFUSALS: Record<JobworkRefusalCode, (v: V) => { code: Code; message: string }> = {
  bundle_at_vendor: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is out for job work on ${s(v, "step")}` }),
  bundle_in_process: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is on process step ${s(v, "step")}` }),
  bundle_not_in_stock: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not in the yard; only yard stock can go on a process step` }),
  bundle_on_dispatch: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is on a dispatch; take it off the load first` }),
  bundle_off_ledger: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not on the stock ledger yet; take the opening balance first` }),
  bundle_twice: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is listed twice` }),
  vendor_needed: () => ({ code: "BAD_REQUEST", message: "Pick the job-work vendor" }),
  vendor_inactive: (v) => ({ code: "BAD_REQUEST", message: `Vendor ${s(v, "code")} is not active` }),
  vendor_code_taken: (v) => ({ code: "CONFLICT", message: `Vendor code ${s(v, "code")} is already used` }),
  vendor_has_stock: (v) => ({ code: "BAD_REQUEST", message: `Vendor ${s(v, "code")} still has bundles out; receive them first` }),
  step_closed: (v) => ({ code: "CONFLICT", message: `${s(v, "step")} is already closed` }),
  input_not_on_step: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not on ${s(v, "step")}` }),
  input_already_back: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is already back from ${s(v, "step")}` }),
  no_output: () => ({ code: "BAD_REQUEST", message: "Enter what came back: good weight, rejects or scrap" }),
  negative_weight: () => ({ code: "BAD_REQUEST", message: "Weights cannot be below zero" }),
  gain_too_high: () => ({ code: "BAD_REQUEST", message: "More came back than was sent, by over 5 in 100; check the weights" }),
  output_over_input: () => ({ code: "BAD_REQUEST", message: "More came back than was sent; check the weights" }),
  cancel_after_return: (v) => ({ code: "CONFLICT", message: `${s(v, "step")} has returns; it cannot be cancelled` }),
  no_yard: () => ({ code: "BAD_REQUEST", message: "Pick the yard the bundles come back to" }),
  process_kind_mismatch: () => ({ code: "BAD_REQUEST", message: "That process does not belong to this kind of step" }),
  vendor_location: () => ({ code: "BAD_REQUEST", message: "This place belongs to a job-work vendor; change it on the vendor" }),
  consumed_input: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} was used up on ${s(v, "step")}; it cannot come back` }),
};

export function jobworkRefusal(code: JobworkRefusalCode, vars: V = {}): TRPCError {
  const r = JOBWORK_REFUSALS[code](vars);
  return new TRPCError({ code: r.code, message: r.message });
}
