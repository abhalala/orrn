/**
 * What a refused foundry write says on the phone (W2-FD-N). The foundry sentences are not in the shared
 * refusal table: importing the module below registers them once (`foundry.refusal.*`, en, hi and gu), and
 * every foundry screen reaches it through this file, so `serverRefusal` speaks them in the person's language.
 * Never show `error.message` on a foundry screen.
 */
import "@orrn/i18n/refusal-foundry";

import type { MeltLockError } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

import { serverRefusal } from "@/lib/server-refusal";

/** The sentence for a refused write, in the person's language. An answer that never came says "not sure it saved". */
export function foundryError(t: Translate, error: unknown): string {
  return serverRefusal(error, t);
}

/**
 * The lock gates the server returns with a draft (`DraftView.gates`) and the sentence each one is said
 * with. `foundry-errors.test.ts` compares the codes with the server's `MELT_GATE_TEXT`.
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

/** The section of the melt sheet where each lock gate is put right. */
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

/** The section that puts a gate right; `null` for a code this build does not know. */
export function gateStep(code: string): "times" | "charge" | "output" | "spectro" | null {
  return isGate(code) ? GATE_STEP[code] : null;
}

/** The server refused a save because the melt moved on since this sheet read it (a web edit, or a save of this phone that landed unseen). */
export function isStaleMelt(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && /^(?:The|This) melt changed; open it again$/.test(message);
}
