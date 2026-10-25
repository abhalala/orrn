/**
 * OVEN_SIMULATOR seam (W3-AG-C; FP-AG-17 has no plant device yet). Local dev only, like
 * SCALE_SIMULATOR: `OVEN_SIMULATOR=1` in apps/server/.dev.vars (git-ignored; wrangler reads it next to
 * wrangler.local.jsonc), optional `OVEN_SIMULATOR_PROFILE=normal|under|over|dip` (default normal).
 * Refused when NODE_ENV is production. Never set on dev or production stages.
 *
 * The curve is `ovenSimulatedCurve` (`@orrn/domain`): a ramp below the band, a hold inside it with
 * deterministic jitter (seeded by the batch id), and the profile's fault. The server lane's
 * `ageing.batches.simulate` (ageing.record) posts `simulatedReadings(...)` through the same insert as a
 * collector (`ageing_temp_log.source = 'simulator'`, unique on batch + source + at, so a replay adds
 * nothing). Typed readings stay valid next to simulated ones; nothing upgrades a simulated reading to a
 * device reading, and the screen labels them (`ageing.tempSource.simulator`).
 */
import { AGEING_READINGS_MAX, OVEN_CURVE_PROFILES, ovenSimulatedCurve, type AgeingReading, type OvenCurveProfile } from "@orrn/domain";

export type OvenSimulatorEnv = { OVEN_SIMULATOR?: string; OVEN_SIMULATOR_PROFILE?: string; NODE_ENV?: string };

/** True when the local oven simulator may post readings. */
export function ovenSimulatorEnabled(env: OvenSimulatorEnv): boolean {
  return env.OVEN_SIMULATOR === "1" && env.NODE_ENV !== "production";
}

/** The profile from the env (unknown or missing → normal). An explicit procedure input wins over it. */
export function ovenSimulatorProfile(env: OvenSimulatorEnv): OvenCurveProfile {
  const p = env.OVEN_SIMULATOR_PROFILE;
  return (OVEN_CURVE_PROFILES as readonly string[]).includes(p ?? "") ? (p as OvenCurveProfile) : "normal";
}

/**
 * The simulated readings a batch has "taken" by `now`: every point of the curve from in_at up to now
 * (or up to out_at when the batch is out), at most AGEING_READINGS_MAX of the latest per call.
 */
export function simulatedReadings(input: {
  batchId: string;
  snapshot: { targetTempX10: number; toleranceX10: number; soakMin: number };
  inAt: number;
  outAt: number | null;
  now: number;
  profile: OvenCurveProfile;
  stepMin?: number;
}): AgeingReading[] {
  const end = Math.min(input.now, input.outAt ?? input.now);
  const curve = ovenSimulatedCurve({
    ...input.snapshot,
    startMs: input.inAt,
    stepMin: input.stepMin,
    profile: input.profile,
    seed: input.batchId,
  }).filter((r) => r.at <= end);
  return curve.slice(-AGEING_READINGS_MAX);
}
