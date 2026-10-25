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
  | { kind: "blocked"; reason: GateReason; latestVersion: string | null; apkUrl: string | null };

export function storedFrom(answer: CheckAnswer, buildNumber: number, now: number): StoredCheck {
  return { at: now, state: answer.state, buildNumber, latestVersion: answer.latest?.version ?? null, apkUrl: answer.apkUrl };
}

export function decideRelease(input: { answer: CheckAnswer | null; last: StoredCheck | null; now: number; buildNumber: number }): ReleaseDecision {
  const { answer, last, now, buildNumber } = input;
  if (answer) {
    if (answer.state === "open") return { kind: "open", via: "server", graceUntil: null };
    return { kind: "blocked", reason: answer.reason, latestVersion: answer.latest?.version ?? null, apkUrl: answer.apkUrl };
  }
  const offline = offlineGate(last ? { at: last.at, state: last.state, buildNumber: last.buildNumber } : null, { at: now, buildNumber });
  if (offline.state === "open" && last) return { kind: "open", via: "grace", graceUntil: last.at + OFFLINE_GRACE_MS };
  return { kind: "blocked", reason: offline.reason, latestVersion: last?.latestVersion ?? null, apkUrl: last?.apkUrl ?? null };
}

/**
 * What to show while the first check is still on its way: the app opens at once when this build
 * last checked Open and the grace has not run out (the check then runs in the background and can
 * still block). Otherwise null: wait for the answer.
 */
export function optimisticDecision(last: StoredCheck | null, now: number, buildNumber: number): ReleaseDecision | null {
  const d = decideRelease({ answer: null, last, now, buildNumber });
  return d.kind === "open" ? d : null;
}

/** The sentence for a blocked reason. */
export function blockedKey(reason: GateReason): MessageKey {
  switch (reason) {
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
export function needsUpdate(reason: GateReason): boolean {
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
  ios?: { buildNumber?: string | number | null } | null;
  android?: { versionCode?: number | string | null } | null;
  extra?: { releaseChannel?: unknown } | null;
};

/** The native build number: iOS `buildNumber`, Android `versionCode` (app.json). 0 when the build did not set one. */
export function nativeBuildNumber(platform: string, config: BuildConfig | null | undefined): number {
  const raw = platform === "ios" ? config?.ios?.buildNumber : config?.android?.versionCode;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0;
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
