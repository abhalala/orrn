import { OFFLINE_GRACE_MS, offlineGate, RELEASE_CHANNELS, type GateReason, type GateState as ReleaseState, type ReleaseChannel } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

/**
 * The distribution gate on the phone (FP-PF-11, spec E7 "Native"): `release.check` runs before the
 * tabs. Open lets the app in; Blocked is a full screen with no dismiss. When the server cannot be
 * reached the rule from @orrn/domain applies to the last answer: a build that last checked Open may
 * open for 24 hours from that check, a build never checked (or last blocked) may not. Pure, so the
 * mapping is unit-tested; `components/release-gate.tsx` renders it.
 */

/** What `release.check` answers that the phone uses. */
export type CheckAnswer = {
  state: ReleaseState;
  reason: GateReason;
  latest: { version: string } | null;
  apkUrl: string | null;
};

/** The last answer kept on the device. `at` is the device clock when it was received, so clock skew with the server cannot matter. */
export type StoredCheck = {
  at: number;
  state: ReleaseState;
  buildNumber: number;
  latestVersion: string | null;
  apkUrl: string | null;
};

export type ReleaseDecision =
  | { kind: "open"; via: "server" | "grace"; /** Offline only: when the grace ends (ms). */ graceUntil: number | null }
  | { kind: "blocked"; reason: BlockedReason; latestVersion: string | null; apkUrl: string | null };

/** A server reason, or this phone could not read its own build number (so it cannot be checked at all). */
export type BlockedReason = GateReason | "unreadable_build";

export function storedFrom(answer: CheckAnswer, buildNumber: number, now: number): StoredCheck {
  return { at: now, state: answer.state, buildNumber, latestVersion: answer.latest?.version ?? null, apkUrl: answer.apkUrl };
}

/**
 * The release decision at one moment (E7), from what the phone knows. Pure: the clock is an input, so a
 * screen that stays open recomputes it as time passes and the 24 h grace can end under a running app.
 *
 * - `lastVerdict`: the last answer the server gave THIS build (a live answer, or the stored one at a cold start).
 * - `lastOpenAt`: device-clock time that answer arrived, when it said Open; null when it never did. Stamped once
 *   per answer (`shouldStore`), never when a screen mounts.
 * - `online`: the latest check succeeded. A failed refetch keeps the old answer in memory but is NOT online.
 *
 * Open holds only while `now` is within 24 h of `lastOpenAt` (a clock set back is not trusted), online or not.
 * A Blocked answer stays Blocked until the server says otherwise.
 */
export function gateState(input: { lastOpenAt: number | null; lastVerdict: CheckAnswer | null; now: number; online: boolean }): ReleaseDecision {
  const { lastOpenAt, lastVerdict, now, online } = input;
  const latestVersion = lastVerdict?.latest?.version ?? null;
  const apkUrl = lastVerdict?.apkUrl ?? null;
  if (lastVerdict?.state === "blocked") {
    return { kind: "blocked", reason: online ? lastVerdict.reason : "last_blocked", latestVersion, apkUrl };
  }
  if (lastVerdict == null || lastOpenAt == null) return { kind: "blocked", reason: "never_checked", latestVersion, apkUrl };
  // The 24 h rule lives once, in @orrn/domain (builds are compared by the caller, so any equal pair does here).
  const grace = offlineGate({ at: lastOpenAt, state: "open", buildNumber: 0 }, { at: now, buildNumber: 0 });
  if (grace.state === "blocked") return { kind: "blocked", reason: grace.reason, latestVersion, apkUrl };
  return online ? { kind: "open", via: "server", graceUntil: null } : { kind: "open", via: "grace", graceUntil: lastOpenAt + OFFLINE_GRACE_MS };
}

/** The decision when the phone cannot read its own build number: there is nothing to check, so it is blocked. */
export const UNREADABLE_BUILD: ReleaseDecision = { kind: "blocked", reason: "unreadable_build", latestVersion: null, apkUrl: null };

/** The kept answer as a verdict, for a cold start (it counts only for the build that got it). */
function verdictFromStored(stored: StoredCheck | null, buildNumber: number): { lastVerdict: CheckAnswer | null; lastOpenAt: number | null } {
  if (!stored || stored.buildNumber !== buildNumber) return { lastVerdict: null, lastOpenAt: null };
  const lastVerdict: CheckAnswer = {
    state: stored.state,
    reason: stored.state === "open" ? "ok" : "last_blocked",
    latest: stored.latestVersion ? { version: stored.latestVersion } : null,
    apkUrl: stored.apkUrl,
  };
  return { lastVerdict, lastOpenAt: stored.state === "open" ? stored.at : null };
}

/**
 * `gateState`'s verdict and Open time from the live query and the kept answer. A live answer wins and is
 * timed by when it arrived (`dataUpdatedAt`), so cached data seen again on a remount keeps its old time.
 */
export function gateInputs(input: {
  data: CheckAnswer | null | undefined;
  dataUpdatedAt: number;
  stored: StoredCheck | null;
  buildNumber: number;
}): { lastVerdict: CheckAnswer | null; lastOpenAt: number | null } {
  if (input.data) return { lastVerdict: input.data, lastOpenAt: input.data.state === "open" ? input.dataUpdatedAt : null };
  return verdictFromStored(input.stored, input.buildNumber);
}

/** Write the kept answer only for a new answer: the same one seen again (a remount) must not restart the 24 h. */
export function shouldStore(stored: StoredCheck | null, answer: CheckAnswer, buildNumber: number, arrivedAt: number): boolean {
  return !stored || stored.at !== arrivedAt || stored.buildNumber !== buildNumber || stored.state !== answer.state;
}

/** The sentence for a blocked reason. */
export function blockedKey(reason: BlockedReason): MessageKey {
  switch (reason) {
    case "unreadable_build":
      return "native.gate.blocked.unreadable_build";
    case "below_min_build":
      return "native.gate.blocked.below_min_build";
    case "revoked":
      return "native.gate.blocked.revoked";
    case "never_checked":
      return "native.gate.blocked.never_checked";
    case "grace_expired":
      return "native.gate.blocked.grace_expired";
    default:
      return "native.gate.blocked.last_blocked";
  }
}

/** Reasons that more internet will not fix: the person must update or ask an admin. */
export function needsUpdate(reason: BlockedReason): boolean {
  return reason === "below_min_build";
}

export function parseStored(raw: string | null | undefined): StoredCheck | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredCheck> | null;
    if (!v || typeof v.at !== "number" || typeof v.buildNumber !== "number") return null;
    if (v.state !== "open" && v.state !== "blocked") return null;
    return {
      at: v.at,
      state: v.state,
      buildNumber: v.buildNumber,
      latestVersion: typeof v.latestVersion === "string" ? v.latestVersion : null,
      apkUrl: typeof v.apkUrl === "string" ? v.apkUrl : null,
    };
  } catch {
    return null;
  }
}

type BuildConfig = {
  extra?: { releaseChannel?: unknown } | null;
};

/**
 * The build number of the INSTALLED binary: `expo-application`'s `nativeBuildVersion` (iOS CFBundleVersion,
 * Android versionCode, read from the app package). It is never read from the update manifest
 * (`Constants.expoConfig`), which an OTA update replaces: an OTA must not be able to lift a block (E7).
 * Null when it is missing or not a whole number above 0; the gate then blocks.
 */
export function installedBuildNumber(raw: string | number | null | undefined): number | null {
  const text = typeof raw === "number" ? String(raw) : raw?.trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `production` (store builds) unless the build says `floor` (the signed APK for plant phones). */
export function releaseChannel(config: BuildConfig | null | undefined): ReleaseChannel {
  const c = config?.extra?.releaseChannel;
  return (RELEASE_CHANNELS as readonly unknown[]).includes(c) ? (c as ReleaseChannel) : "production";
}

/** The label `device.register` stores and the Devices tab reads its build from: `1.0.0 (11)`. */
export function appVersionLabel(version: string | null | undefined, buildNumber: number): string {
  return `${version ?? "0"} (${buildNumber})`;
}
