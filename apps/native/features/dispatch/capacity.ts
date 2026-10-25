import { bpPercent1, formatKgTotal, gToKg } from "@orrn/domain";
import type { MessageKey, TranslateVars } from "@orrn/i18n";

import type { CapacityReport } from "../scan/outcome";

/**
 * How full the truck is (FP-PK-12), from the SERVER's check (`dispatch.getDispatch` and every add report
 * carry `capacity`). The phone never works out a state: it names the one the server sent. Warn only: an
 * over-capacity load still goes, with a reason when it is dispatched.
 */
export type CapacityView =
  | null
  | {
      state: "ok" | "near" | "over";
      /** i18n key and variables of the headline. */
      headline: { key: MessageKey; vars?: TranslateVars };
      /** "1,950 of 2,000 kg" pieces for the second line. */
      loaded: { loaded: string; capacity: string };
      /** Bar fill, 0 to 100. */
      pct: number;
      /** The Dispatch button must ask why before it completes. */
      needsReason: boolean;
    };

export function capacityView(capacity: CapacityReport | null | undefined): CapacityView {
  if (!capacity || capacity.state === "none" || capacity.capacityG == null) return null;
  // The server sends the fill in basis points; the shared domain formatter turns it into percent (no sum of our own).
  const pct = Math.max(0, Math.min(100, Math.round(Number(bpPercent1(capacity.fillBp ?? 0)))));
  const headline: { key: MessageKey; vars?: TranslateVars } =
    capacity.state === "over"
      ? { key: "dispatch.capacity.over" as const, vars: { kg: formatKgTotal(gToKg(capacity.overG)) } }
      : capacity.state === "near"
        ? { key: "dispatch.capacity.near" as const }
        : { key: "dispatch.capacity.fill" as const, vars: { pct } };
  return {
    state: capacity.state,
    headline,
    loaded: { loaded: formatKgTotal(gToKg(capacity.loadedG)), capacity: formatKgTotal(gToKg(capacity.capacityG)) },
    pct,
    needsReason: capacity.state === "over",
  };
}

/** The reason Dispatch asks for when the load is over: required, trimmed, at most 500 characters (the server's rule). */
export function overReasonError(view: CapacityView, reason: string): "required" | "tooLong" | null {
  if (!view?.needsReason) return null;
  const r = reason.trim();
  if (!r) return "required";
  return r.length > 500 ? "tooLong" : null;
}

/** The `dispatch.complete` extras: the reason travels only when the load is over. */
export function completeExtras(view: CapacityView, reason: string): { capacityOverrideReason?: string } {
  return view?.needsReason ? { capacityOverrideReason: reason.trim() } : {};
}

/**
 * `dispatch.complete` refused with PRECONDITION_FAILED although no reason was sent: the load went over
 * the truck's capacity after the sheet opened (another phone added a bundle). When the fresh read says
 * the load is over, this is that race, so the sheet stays open and asks for the reason. A refusal after a
 * reason was sent (or with the load not over) is something else, such as an overdraw request.
 */
export function overRaceAfterComplete(error: unknown, sentReason: boolean, fresh: CapacityReport | null | undefined): boolean {
  const code = error && typeof error === "object" ? (error as { data?: { code?: unknown } | null }).data?.code : undefined;
  return code === "PRECONDITION_FAILED" && !sentReason && capacityView(fresh)?.needsReason === true;
}

/** The text the Scan screen says when a scan pushes the load over (spoken as well). */
export function overCapacityLine(capacity: CapacityReport | null | undefined): { key: MessageKey; vars: TranslateVars } | null {
  if (!capacity || capacity.state !== "over") return null;
  return { key: "scan.continuous.overCapacity", vars: { kg: formatKgTotal(gToKg(capacity.overG)) } };
}
