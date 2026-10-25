import { describe, expect, test } from "bun:test";

import { apkAllowed, EMPTY_RELEASE_FORM, parseReleaseForm, releaseErrorKey, type ReleaseForm } from "./releases";

const good: ReleaseForm = { ...EMPTY_RELEASE_FORM, version: "1.4.0", build: "14", minBuild: "12", notes: "Scale weights on the pack screen" };

describe("publish form", () => {
  test("a good form becomes the server input; a blank minimum build keeps the current minimum, never the build number", () => {
    expect(parseReleaseForm(good)).toEqual({
      ok: true,
      input: { platform: "android", channel: "floor", version: "1.4.0", buildNumber: 14, minBuild: 12, mandatory: false, notes: "Scale weights on the pack screen" },
    });
    // Blank = keep the floor that is in force today, so publishing never blocks older installs by itself.
    const keep = parseReleaseForm({ ...good, minBuild: "" }, 9);
    expect(keep.ok && keep.input.minBuild).toBe(9);
    const none = parseReleaseForm({ ...good, minBuild: "" });
    expect(none.ok && none.input.minBuild).toBe(0);
    // A typed value always wins, including raising the floor to the new build on purpose.
    const raise = parseReleaseForm({ ...good, minBuild: "14" }, 9);
    expect(raise.ok && raise.input.minBuild).toBe(14);
    // The kept floor can never exceed the build being published.
    const clamped = parseReleaseForm({ ...good, build: "5", minBuild: "" }, 9);
    expect(clamped.ok && clamped.input.minBuild).toBe(5);
  });

  test("minimum above the build, blank notes, a missing version and a bad build number are each flagged", () => {
    const bad = parseReleaseForm({ ...good, minBuild: "15" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.minBuild).toBe("admin.releases.errors.minAbove");
    const many = parseReleaseForm({ ...good, version: " ", build: "0", notes: "  " });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(Object.keys(many.errors).sort()).toEqual(["build", "notes", "version"]);
    expect(parseReleaseForm({ ...good, build: "1.5" }).ok).toBe(false);
  });

  test("notes stop at 500 characters", () => {
    expect(parseReleaseForm({ ...good, notes: "x".repeat(500) }).ok).toBe(true);
    expect(parseReleaseForm({ ...good, notes: "x".repeat(501) }).ok).toBe(false);
  });

  test("a download link is for the Android floor build only, and must be a web address", () => {
    expect(apkAllowed({ platform: "android", channel: "floor" })).toBe(true);
    expect(apkAllowed({ platform: "ios", channel: "production" })).toBe(false);
    expect(apkAllowed({ platform: "android", channel: "production" })).toBe(false);
    const ios = parseReleaseForm({ ...good, platform: "ios", channel: "production", apkUrl: "https://files.orrn.in/a.apk" });
    expect(ios.ok).toBe(false);
    expect(parseReleaseForm({ ...good, apkUrl: "files/a.apk" }).ok).toBe(false);
    const ok = parseReleaseForm({ ...good, apkUrl: "https://files.orrn.in/a.apk" });
    expect(ok.ok && ok.input.apkUrl).toBe("https://files.orrn.in/a.apk");
  });

  test("server refusals map to the screen's wording", () => {
    const err = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });
    expect(releaseErrorKey(err("CONFLICT", "That version is already published on this channel"))).toBe("admin.releases.errors.exists");
    expect(releaseErrorKey(err("BAD_REQUEST", "Minimum build cannot be above the build number"))).toBe("admin.releases.errors.minAbove");
    expect(releaseErrorKey(err("BAD_REQUEST", "Build 5 is not above the last published build 9"))).toBe("admin.releases.errors.notAbove");
    expect(releaseErrorKey(err("BAD_REQUEST", "An APK link is for Android only"))).toBe("admin.releases.errors.android");
    expect(releaseErrorKey(err("INTERNAL_SERVER_ERROR", "x"))).toBe("admin.releases.errors.generic");
    expect(releaseErrorKey(new Error("offline"))).toBe("admin.releases.errors.generic");
  });
});
