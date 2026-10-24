/**
 * App distribution gate (FP-PF-11; platform spec §4 Distribution, §6 Distribution gate).
 * `release.check` decides online; the native app keeps the last answer and applies the offline
 * grace itself. Both sides use these two functions so the rule exists once.
 *
 *   Check -> Open     build >= minBuild and the install is not revoked
 *   Check -> Blocked  build < minBuild (newest row, or any mandatory row with a higher floor)
 *   Check -> Blocked  device revoked
 *   offline: a build that last checked Open may open for 24 h from that check; never checked = Blocked.
 * An OTA update never clears a block: the gate reads the native build number, not the JS bundle.
 */

export const RELEASE_PLATFORMS = ["android", "ios"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
export const RELEASE_CHANNELS = ["production", "floor"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const MAX_RELEASE_NOTES = 500;
/** How long a build that last checked Open may start without reaching the server. */
export const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

export type GateState = "open" | "blocked";
export type GateReason = "ok" | "below_min_build" | "revoked" | "never_checked" | "grace_expired" | "grace" | "last_blocked";

export type ReleaseFloor = { buildNumber: number; minBuild: number; mandatory: boolean };

/**
 * The floor an install must reach: the newest release's `minBuild`, raised by any mandatory
 * release whose `minBuild` is higher. 0 when nothing is published (nothing to gate on).
 */
export function effectiveMinBuild(releases: readonly ReleaseFloor[]): number {
  if (releases.length === 0) return 0;
  const newest = releases.reduce((a, b) => (b.buildNumber > a.buildNumber ? b : a));
  let floor = newest.minBuild;
  for (const r of releases) if (r.mandatory && r.minBuild > floor) floor = r.minBuild;
  return floor;
}

/** The online decision `release.check` returns. */
export function releaseGate(input: { buildNumber: number; minBuild: number; revoked: boolean }): {
  state: GateState;
  reason: GateReason;
} {
  if (input.revoked) return { state: "blocked", reason: "revoked" };
  if (input.buildNumber < input.minBuild) return { state: "blocked", reason: "below_min_build" };
  return { state: "open", reason: "ok" };
}

/**
 * The offline decision on the device when `release.check` cannot be reached. `lastCheck` is the
 * last answer the server gave THIS build (null = never checked). A Blocked answer stays blocked.
 */
export function offlineGate(
  lastCheck: { at: number; state: GateState; buildNumber: number } | null,
  now: { at: number; buildNumber: number },
): { state: GateState; reason: GateReason } {
  if (!lastCheck || lastCheck.buildNumber !== now.buildNumber) return { state: "blocked", reason: "never_checked" };
  if (lastCheck.state === "blocked") return { state: "blocked", reason: "last_blocked" };
  if (now.at - lastCheck.at >= OFFLINE_GRACE_MS || now.at < lastCheck.at) return { state: "blocked", reason: "grace_expired" };
  return { state: "open", reason: "grace" };
}

/** Publish rules: positive integer builds, minBuild <= buildNumber, notes 1-500 characters. */
export function releasePublishErrors(input: { buildNumber: number; minBuild: number; notes: string }): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.buildNumber) || input.buildNumber < 1) errors.push("build_number");
  if (!Number.isInteger(input.minBuild) || input.minBuild < 0) errors.push("min_build");
  if (input.minBuild > input.buildNumber) errors.push("min_build_above_build");
  const notes = input.notes.trim();
  if (notes === "" || notes.length > MAX_RELEASE_NOTES) errors.push("notes");
  return errors;
}
