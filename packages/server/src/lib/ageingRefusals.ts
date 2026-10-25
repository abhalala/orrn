/**
 * Every sentence an ageing procedure may refuse with (W3-AG-C). The router never writes its own
 * sentence: it calls `ageingRefusal(code, vars)` with a code from `AGEING_REFUSAL_CODES`
 * (`@orrn/domain`). Each sentence below is matched in `packages/i18n/src/refusal.ts` and said from
 * `ageing.refusal.*` (en, hi, gu); this file is in `refusal-sentences.ts` FILES, so a new or reworded
 * sentence fails the web and native completeness tests until it is mapped.
 */
import { TRPCError } from "@trpc/server";

import type { AgeingBatchStatus, AgeingRefusalCode } from "@orrn/domain";

type Code = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN";
type Refusal = { code: Code; message: string };

/** The English words for a batch status inside a sentence (refusal.ts maps them back). */
export const AGEING_STATUS_PHRASE: Record<AgeingBatchStatus, string> = {
  loading: "loading",
  in_oven: "in the oven",
  out: "out of the oven",
  released: "released",
  held: "held",
  closed: "closed",
  void: "void",
};

type V = Record<string, string | number>;
const s = (v: V, k: string) => String(v[k] ?? "");

/** Code → sentence. Variables: oven, code, batch, n, serial, cast, alloy, recipeAlloy, temper, recipeTemper, run, status. */
export const AGEING_REFUSALS: Record<AgeingRefusalCode, (v: V) => Refusal> = {
  // masters
  oven_not_active: (v) => ({ code: "BAD_REQUEST", message: `Oven ${s(v, "oven")} is not in service` }),
  oven_busy: (v) => ({ code: "CONFLICT", message: `Oven ${s(v, "oven")} already has a batch in it` }),
  oven_too_hot: (v) => ({ code: "BAD_REQUEST", message: `Oven ${s(v, "oven")} cannot run this recipe's temperature` }),
  trolley_not_active: (v) => ({ code: "BAD_REQUEST", message: `Trolley ${s(v, "code")} is not in service` }),
  trolley_busy: (v) => ({ code: "CONFLICT", message: `Trolley ${s(v, "code")} is on ${s(v, "batch")}; close or void that batch first` }),
  recipe_not_active: () => ({ code: "BAD_REQUEST", message: "Pick an active ageing recipe" }),
  recipe_max_soak_below_soak: () => ({ code: "BAD_REQUEST", message: "The over-age limit must be longer than the soak" }),
  recipe_hardness_max_below_min: () => ({ code: "BAD_REQUEST", message: "The hardness warning must be above the minimum" }),
  code_taken: (v) => ({ code: "CONFLICT", message: `The code ${s(v, "code")} is already used` }),
  code_invalid: () => ({ code: "BAD_REQUEST", message: "Use letters, digits and dashes for the code, at most 16" }),
  recipe_active_locked: () => ({ code: "BAD_REQUEST", message: "An active recipe's numbers cannot change; save a new recipe and archive this one" }),
  oven_in_use: (v) => ({ code: "CONFLICT", message: `Oven ${s(v, "oven")} has a batch in it; take it out before changing its status` }),
  trolley_in_use: (v) => ({ code: "CONFLICT", message: `Trolley ${s(v, "code")} carries ${s(v, "batch")}; it stays in service until that batch closes` }),
  reason_wrong_kind: () => ({ code: "BAD_REQUEST", message: "Pick a reason from this list" }),
  // load
  no_rows: () => ({ code: "BAD_REQUEST", message: "Load at least one line on the trolley" }),
  too_many_rows: (v) => ({ code: "BAD_REQUEST", message: `Load at most ${s(v, "n")} lines at a time` }),
  run_not_logged: (v) => ({ code: "BAD_REQUEST", message: `${s(v, "run")} is not logged yet; load its pieces after the log` }),
  over_line: (v) => ({ code: "BAD_REQUEST", message: `Only ${s(v, "n")} pieces of this press line are left to load` }),
  manual_off: () => ({ code: "BAD_REQUEST", message: "Typed lines are off for this plant; load from a press run" }),
  bundle_not_available: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not in stock` }),
  bundle_on_batch: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is already on ${s(v, "batch")}` }),
  bundle_already_aged: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is already aged` }),
  alloy_mismatch: (v) => ({ code: "BAD_REQUEST", message: `Cast ${s(v, "cast")} is alloy ${s(v, "alloy")}; this recipe is for ${s(v, "recipeAlloy")}` }),
  temper_mismatch: (v) => ({ code: "BAD_REQUEST", message: `This line is temper ${s(v, "temper")}; this recipe is for ${s(v, "recipeTemper")}` }),
  // cycle
  wrong_status: (v) => ({ code: "CONFLICT", message: `${s(v, "batch")} is ${AGEING_STATUS_PHRASE[v.status as AgeingBatchStatus] ?? s(v, "status")}; that step is not open now` }),
  no_shifts: () => ({ code: "BAD_REQUEST", message: "Add shifts in Settings before starting a batch" }),
  shift_unknown: () => ({ code: "BAD_REQUEST", message: "Pick a shift of this plant" }),
  time_future: () => ({ code: "BAD_REQUEST", message: "That time is in the future" }),
  backdate_too_far: () => ({ code: "BAD_REQUEST", message: "A time can go back at most 12 hours" }),
  gas_end_below_start: () => ({ code: "BAD_REQUEST", message: "Gas end is below gas start" }),
  no_reading: () => ({ code: "BAD_REQUEST", message: "Record a temperature before taking the batch out" }),
  out_before_in: () => ({ code: "BAD_REQUEST", message: "The out time must be after the in time" }),
  reading_closed: () => ({ code: "BAD_REQUEST", message: "Readings close 30 minutes after the batch comes out" }),
  reading_before_in: () => ({ code: "BAD_REQUEST", message: "That reading is before the batch went in" }),
  // release, override
  override_pending: (v) => ({ code: "CONFLICT", message: `${s(v, "batch")} already has an override waiting for approval` }),
  override_not_needed: (v) => ({ code: "BAD_REQUEST", message: `${s(v, "batch")} passed; it needs no override` }),
  simulator_off: () => ({ code: "FORBIDDEN", message: "The oven simulator is off on this server" }),
  // hold, void, rework, discard, split
  already_held: () => ({ code: "CONFLICT", message: "This trolley line is already held" }),
  not_held: () => ({ code: "BAD_REQUEST", message: "This trolley line has no hold to clear; a failed test clears with a retest or an approval" }),
  hold_after_pack: () => ({ code: "BAD_REQUEST", message: "Pieces were packed from this trolley; hold the lines that are still full" }),
  void_in_oven: (v) => ({ code: "BAD_REQUEST", message: `${s(v, "batch")} is in the oven; take it out first` }),
  void_after_pack: (v) => ({ code: "BAD_REQUEST", message: `Pieces were packed from ${s(v, "batch")}; it cannot be voided` }),
  void_reason_missing: () => ({ code: "BAD_REQUEST", message: "Say why this batch is voided" }),
  void_after_rework: (v) => ({ code: "BAD_REQUEST", message: `Pieces of ${s(v, "batch")} were aged again or discarded; it cannot be voided` }),
  nothing_to_rework: () => ({ code: "BAD_REQUEST", message: "No held pieces are left to age again" }),
  discard_over: (v) => ({ code: "BAD_REQUEST", message: `Only ${s(v, "n")} pieces are left on this trolley line` }),
  split_off: () => ({ code: "FORBIDDEN", message: "Splitting lengths is off for this plant" }),
  split_after_pack: () => ({ code: "BAD_REQUEST", message: "Pieces were packed from this trolley line; it cannot be split" }),
  split_length: () => ({ code: "BAD_REQUEST", message: "The cuts must add up to the loaded length" }),
  // pack and dispatch
  not_released: () => ({ code: "BAD_REQUEST", message: "This trolley line is not released; it is not on the pack list" }),
  draw_over: (v) => ({ code: "BAD_REQUEST", message: `Only ${s(v, "n")} pieces are left on this trolley line to pack` }),
  cast_mismatch: (v) => ({ code: "BAD_REQUEST", message: `This trolley line is from cast ${s(v, "cast")}; pick that cast for the bundle` }),
  ageing_row_required: () => ({ code: "BAD_REQUEST", message: "This plant packs aged metal from a trolley; pick the trolley line" }),
  row_void: () => ({ code: "BAD_REQUEST", message: "This trolley line is void" }),
  bundle_in_ageing: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is in ageing on ${s(v, "batch")}` }),
  bundle_ageing_held: (v) => ({ code: "CONFLICT", message: `Bundle ${s(v, "serial")} is held in ageing on ${s(v, "batch")}` }),
  bundle_not_aged: (v) => ({ code: "BAD_REQUEST", message: `Bundle ${s(v, "serial")} is not aged; this plant dispatches aged metal only` }),
  // not found
  batch_not_found: () => ({ code: "NOT_FOUND", message: "Ageing batch not found" }),
  oven_not_found: () => ({ code: "NOT_FOUND", message: "Ageing oven not found" }),
  trolley_not_found: () => ({ code: "NOT_FOUND", message: "Trolley not found" }),
  recipe_not_found: () => ({ code: "NOT_FOUND", message: "Ageing recipe not found" }),
};

/** The sentence for a code (tests, the dispatch scan refusal, `ScanRefusal` text). */
export function ageingRefusalMessage(code: AgeingRefusalCode, vars: V = {}): Refusal {
  return AGEING_REFUSALS[code](vars);
}

/** Throw-ready: `throw ageingRefusal("oven_busy", { oven: "OV-1" })`. `cause.ageingCode` carries the code. */
export function ageingRefusal(code: AgeingRefusalCode, vars: V = {}): TRPCError {
  const r = AGEING_REFUSALS[code](vars);
  return new TRPCError({ code: r.code, message: r.message, cause: Object.assign(new Error(code), { ageingCode: code }) });
}
