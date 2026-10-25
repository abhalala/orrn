/**
 * What a refused foundry write says (W2-FD-W). The foundry sentences are not in the shared refusal
 * table (that would grow `/`): importing the module below registers them once, and every foundry
 * screen reaches it through this file, so `serverRefusal` speaks them in the person's language.
 * Never show `error.message` on a foundry screen.
 */
import "@orrn/i18n/refusal-foundry";

import type { MeltLockError } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

import { serverRefusal } from "@/features/shared/server-refusal";

/** The sentence for a refused write, in the person's language. */
export function foundryError(t: Translate, error: unknown): string {
  return serverRefusal(t, error);
}

/**
 * The lock gates the server returns with a draft (`DraftView.gates`) and the refusal text each one
 * is said with. `errors.test.ts` compares the codes with the server's `MELT_GATE_TEXT`.
 */
export const GATE_KEY: Record<MeltLockError, MessageKey> = {
  not_draft: "foundry.refusal.alreadyLocked",
  times_out_of_order: "foundry.refusal.timesOrder",
  no_input: "foundry.refusal.addInput",
  no_logs: "foundry.refusal.addLogs",
  no_charging_start: "foundry.refusal.chargingStart",
  casting_before_charging: "foundry.refusal.castingEnd",
  over_capacity: "foundry.refusal.overCapacity",
  balance_reason_missing: "foundry.refusal.balanceReason",
  spectro_reason_missing: "foundry.refusal.spectroReason",
  alloy_reason_missing: "foundry.refusal.alloyReason",
  line_too_large: "foundry.refusal.lineTooLarge",
};

export function isGate(code: string): code is MeltLockError {
  return code in GATE_KEY;
}

/** The gates of a draft as sentences; a code this build does not know shows the generic line. */
export function gateSentences(t: Translate, codes: readonly string[]): string[] {
  return codes.map((c) => (isGate(c) ? t(GATE_KEY[c]) : t("refusal.unknown")));
}

/** The step of the melt form where each lock gate is put right. */
export const GATE_STEP: Record<MeltLockError, "times" | "charge" | "output" | "spectro"> = {
  not_draft: "times",
  times_out_of_order: "times",
  no_charging_start: "times",
  casting_before_charging: "times",
  alloy_reason_missing: "times",
  no_input: "charge",
  over_capacity: "charge",
  no_logs: "output",
  balance_reason_missing: "output",
  line_too_large: "output",
  spectro_reason_missing: "spectro",
};
