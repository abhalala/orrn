import { describe, expect, test } from "bun:test";

import { effectiveMinBuild, OFFLINE_GRACE_MS, offlineGate, releaseGate, releasePublishErrors } from "./distribution";

const HOUR = 3_600_000;

describe("distribution gate (FP-PF-11)", () => {
  test("effective min build: newest row's floor, raised by any mandatory row", () => {
    expect(effectiveMinBuild([])).toBe(0);
    expect(effectiveMinBuild([{ buildNumber: 10, minBuild: 8, mandatory: false }, { buildNumber: 12, minBuild: 9, mandatory: false }])).toBe(9);
    expect(effectiveMinBuild([{ buildNumber: 10, minBuild: 10, mandatory: true }, { buildNumber: 12, minBuild: 9, mandatory: false }])).toBe(10);
  });

  test("online: below min build or revoked is blocked", () => {
    expect(releaseGate({ buildNumber: 12, minBuild: 10, revoked: false })).toEqual({ state: "open", reason: "ok" });
    expect(releaseGate({ buildNumber: 10, minBuild: 10, revoked: false }).state).toBe("open");
    expect(releaseGate({ buildNumber: 9, minBuild: 10, revoked: false })).toEqual({ state: "blocked", reason: "below_min_build" });
    expect(releaseGate({ buildNumber: 99, minBuild: 10, revoked: true })).toEqual({ state: "blocked", reason: "revoked" });
  });

  test("offline: 24 h grace from the last Open answer for this build; never checked or another build is blocked", () => {
    const at = 1_000_000_000_000;
    expect(offlineGate(null, { at, buildNumber: 12 })).toEqual({ state: "blocked", reason: "never_checked" });
    expect(offlineGate({ at, state: "open", buildNumber: 11 }, { at: at + HOUR, buildNumber: 12 }).reason).toBe("never_checked");
    expect(offlineGate({ at, state: "open", buildNumber: 12 }, { at: at + 23 * HOUR, buildNumber: 12 })).toEqual({ state: "open", reason: "grace" });
    expect(offlineGate({ at, state: "open", buildNumber: 12 }, { at: at + OFFLINE_GRACE_MS, buildNumber: 12 })).toEqual({
      state: "blocked",
      reason: "grace_expired",
    });
    expect(offlineGate({ at, state: "blocked", buildNumber: 12 }, { at: at + HOUR, buildNumber: 12 }).state).toBe("blocked");
    // A clock set back before the last check does not extend the grace.
    expect(offlineGate({ at, state: "open", buildNumber: 12 }, { at: at - HOUR, buildNumber: 12 }).state).toBe("blocked");
  });

  test("publish rules", () => {
    expect(releasePublishErrors({ buildNumber: 12, minBuild: 12, notes: "ok" })).toEqual([]);
    expect(releasePublishErrors({ buildNumber: 12, minBuild: 13, notes: "ok" })).toContain("min_build_above_build");
    expect(releasePublishErrors({ buildNumber: 12, minBuild: 1, notes: " " })).toContain("notes");
    expect(releasePublishErrors({ buildNumber: 12, minBuild: 1, notes: "x".repeat(501) })).toContain("notes");
    expect(releasePublishErrors({ buildNumber: 0, minBuild: 0, notes: "x" })).toContain("build_number");
  });
});
