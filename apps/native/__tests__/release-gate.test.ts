import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OFFLINE_GRACE_MS } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";

import { isDeviceRevoked } from "../lib/device-revoked";
import {
  appVersionLabel,
  blockedKey,
  decideRelease,
  nativeBuildNumber,
  needsUpdate,
  optimisticDecision,
  parseStored,
  releaseChannel,
  storedFrom,
  type CheckAnswer,
  type StoredCheck,
} from "../lib/release-gate";
import { randomId } from "../lib/random-id";
import { FORGOT_PASSWORD_PATH, joinWebUrl, settingsTabPath, webLinkRows } from "../lib/web-link";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const HOUR = 3_600_000;
const open: CheckAnswer = { state: "open", reason: "ok", latest: { version: "1.2.0" }, apkUrl: null };
const below: CheckAnswer = { state: "blocked", reason: "below_min_build", latest: { version: "1.2.0" }, apkUrl: "https://files.example/orrn.apk" };
const lastOpen = (ago: number, build = 11): StoredCheck => ({ at: NOW - ago, state: "open", buildNumber: build, latestVersion: "1.2.0", apkUrl: null });

describe("release gate decision (spec E7: Check to Open or Blocked)", () => {
  test("an Open answer lets the app in", () => {
    expect(decideRelease({ answer: open, last: null, now: NOW, buildNumber: 11 })).toEqual({ kind: "open", via: "server", graceUntil: null });
  });

  test("a Blocked answer is a block with its reason, the newest version and the APK link", () => {
    expect(decideRelease({ answer: below, last: lastOpen(HOUR), now: NOW, buildNumber: 5 })).toEqual({
      kind: "blocked",
      reason: "below_min_build",
      latestVersion: "1.2.0",
      apkUrl: "https://files.example/orrn.apk",
    });
  });

  test("a revoked install is blocked whatever the build", () => {
    const revoked: CheckAnswer = { state: "blocked", reason: "revoked", latest: null, apkUrl: null };
    expect(decideRelease({ answer: revoked, last: lastOpen(HOUR), now: NOW, buildNumber: 99 })).toMatchObject({ kind: "blocked", reason: "revoked" });
  });
});

describe("offline grace (24 h from the last Open check, never-checked is Blocked)", () => {
  test("offline within 24 hours of an Open check for this build opens, saying until when", () => {
    const d = decideRelease({ answer: null, last: lastOpen(23 * HOUR), now: NOW, buildNumber: 11 });
    expect(d).toEqual({ kind: "open", via: "grace", graceUntil: NOW - 23 * HOUR + OFFLINE_GRACE_MS });
  });

  test("at exactly 24 hours the grace has ended", () => {
    expect(decideRelease({ answer: null, last: lastOpen(OFFLINE_GRACE_MS), now: NOW, buildNumber: 11 })).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("offline and never checked is Blocked", () => {
    expect(decideRelease({ answer: null, last: null, now: NOW, buildNumber: 11 })).toMatchObject({ kind: "blocked", reason: "never_checked" });
  });

  test("an answer kept for another build does not count (an update must check once)", () => {
    expect(decideRelease({ answer: null, last: lastOpen(HOUR, 10), now: NOW, buildNumber: 11 })).toMatchObject({ kind: "blocked", reason: "never_checked" });
  });

  test("a Blocked answer stays blocked offline", () => {
    const blocked: StoredCheck = { at: NOW - HOUR, state: "blocked", buildNumber: 11, latestVersion: null, apkUrl: null };
    expect(decideRelease({ answer: null, last: blocked, now: NOW, buildNumber: 11 })).toMatchObject({ kind: "blocked", reason: "last_blocked" });
  });

  test("a phone clock set back before the last check is not trusted", () => {
    expect(decideRelease({ answer: null, last: lastOpen(-HOUR), now: NOW, buildNumber: 11 })).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("the first frame opens at once only when this build last checked Open inside the grace", () => {
    expect(optimisticDecision(lastOpen(HOUR), NOW, 11)).toMatchObject({ kind: "open", via: "grace" });
    expect(optimisticDecision(lastOpen(25 * HOUR), NOW, 11)).toBeNull();
    expect(optimisticDecision(null, NOW, 11)).toBeNull();
    expect(optimisticDecision(lastOpen(HOUR, 10), NOW, 11)).toBeNull();
  });
});

describe("blocked copy", () => {
  const reasons = ["below_min_build", "revoked", "never_checked", "grace_expired", "last_blocked"] as const;

  test("every blocked reason has a sentence in English and Hindi", () => {
    for (const r of reasons) {
      const key = blockedKey(r);
      expect(createI18n("en").t(key)).not.toBe(key);
      expect(createI18n("hi").t(key)).not.toBe(createI18n("en").t(key));
    }
  });

  test("the offline grace message says 24 hours", () => {
    expect(createI18n("en").t(blockedKey("grace_expired"))).toContain("24 hours");
  });

  test("only an old build is fixed by updating (the APK button)", () => {
    expect(needsUpdate("below_min_build")).toBe(true);
    expect(needsUpdate("revoked")).toBe(false);
    expect(needsUpdate("grace_expired")).toBe(false);
  });

  test("the blocked screen has no dismiss: it renders no close, skip or continue action", () => {
    const src = read("components/release-gate.tsx");
    expect(src).not.toMatch(/common\.(close|skip|continue|cancel)|router\.(back|replace|push)/);
    expect(src).toMatch(/native\.checkAgain/);
  });
});

describe("storing the last answer", () => {
  test("the stored check uses the phone's clock and this build", () => {
    expect(storedFrom(below, 11, NOW)).toEqual({ at: NOW, state: "blocked", buildNumber: 11, latestVersion: "1.2.0", apkUrl: "https://files.example/orrn.apk" });
  });

  test("round trip, and garbage reads as nothing stored", () => {
    const check = storedFrom(open, 11, NOW);
    expect(parseStored(JSON.stringify(check))).toEqual(check);
    expect(parseStored(null)).toBeNull();
    expect(parseStored("")).toBeNull();
    expect(parseStored("{")).toBeNull();
    expect(parseStored(JSON.stringify({ at: "x", state: "open", buildNumber: 1 }))).toBeNull();
    expect(parseStored(JSON.stringify({ at: 1, state: "maybe", buildNumber: 1 }))).toBeNull();
  });
});

describe("build identity", () => {
  test("iOS reads buildNumber, Android reads versionCode, missing is 0", () => {
    const cfg = { ios: { buildNumber: "11" }, android: { versionCode: 12 } };
    expect(nativeBuildNumber("ios", cfg)).toBe(11);
    expect(nativeBuildNumber("android", cfg)).toBe(12);
    expect(nativeBuildNumber("android", {})).toBe(0);
    expect(nativeBuildNumber("ios", null)).toBe(0);
    expect(nativeBuildNumber("ios", { ios: { buildNumber: "x" } })).toBe(0);
  });

  test("channel is production unless the build says floor", () => {
    expect(releaseChannel({ extra: { releaseChannel: "floor" } })).toBe("floor");
    expect(releaseChannel({ extra: { releaseChannel: "beta" } })).toBe("production");
    expect(releaseChannel(null)).toBe("production");
  });

  test("the version label is the one the Devices tab parses: 1.0.0 (11)", () => {
    expect(appVersionLabel("1.0.0", 11)).toBe("1.0.0 (11)");
    expect(/\((\d+)\)\s*$/.exec(appVersionLabel("1.0.0", 11))?.[1]).toBe("11");
  });

  test("app.json carries a build number for both platforms and the production channel", () => {
    const app = JSON.parse(read("app.json")).expo;
    expect(Number.parseInt(app.ios.buildNumber, 10)).toBeGreaterThan(0);
    expect(app.android.versionCode).toBeGreaterThan(0);
    expect(app.extra.releaseChannel).toBe("production");
  });

  test("random ids are 32 hex characters and differ", () => {
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(randomId());
    expect(randomId().length).toBeGreaterThanOrEqual(8);
  });
});

describe("device.register on launch", () => {
  test("only the server's 'turned off' refusal signs the phone out", () => {
    expect(isDeviceRevoked({ data: { code: "FORBIDDEN" }, message: "This device has been turned off for this plant" })).toBe(true);
    expect(isDeviceRevoked({ data: { code: "FORBIDDEN" }, message: "Company suspended" })).toBe(false);
    expect(isDeviceRevoked({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "turned off" })).toBe(false);
    expect(isDeviceRevoked(new Error("Network request failed"))).toBe(false);
    expect(isDeviceRevoked(null)).toBe(false);
  });

  test("wiring: the root layout gates the signed-in app, the tabs register the device", () => {
    const root = read("app/_layout.tsx");
    expect(root).toMatch(/<ReleaseGate active=\{state === "\/\(tabs\)\/today"\}>/);
    expect(read("app/(tabs)/_layout.tsx")).toMatch(/useDeviceRegister\(me\?\.company\?\.id\)/);
    expect(read("lib/device-register.ts")).toMatch(/trpc\.device\.register\.mutationOptions/);
    expect(read("components/release-gate.tsx")).toMatch(/trpc\.release\.check\.queryOptions/);
  });
});

describe("Open on the web, forgot password", () => {
  test("urls join without doubled slashes", () => {
    expect(joinWebUrl("https://orrn.in/", "/settings?tab=team")).toBe("https://orrn.in/settings?tab=team");
    expect(joinWebUrl("http://localhost:3001", "forgot-password")).toBe("http://localhost:3001/forgot-password");
  });

  test("the forgot-password link opens the web page, and sign-in carries it", () => {
    expect(FORGOT_PASSWORD_PATH).toBe("/forgot-password");
    expect(read("app/(auth)/sign-in.tsx")).toMatch(/Linking\.openURL\(webUrl\(FORGOT_PASSWORD_PATH\)\)/);
  });

  test("More lists team, shifts and standards for everyone, backup only with settings.update", () => {
    expect(webLinkRows(false).map((r) => r.key)).toEqual(["team", "shifts", "standards"]);
    expect(webLinkRows(true).map((r) => r.key)).toEqual(["team", "shifts", "standards", "backup"]);
    expect(webLinkRows(true).find((r) => r.key === "backup")?.path).toBe(settingsTabPath("backup"));
    expect(settingsTabPath("shifts")).toBe("/settings?tab=shifts");
  });

  test("the web settings page really has those tabs", () => {
    const sections = readFileSync(join(ROOT, "..", "web", "src", "features", "settings", "sections.tsx"), "utf8");
    for (const id of ["team", "shifts", "standards", "backup"]) expect(sections).toContain(`id: "${id}"`);
    expect(readFileSync(join(ROOT, "..", "web", "src", "routes", "_public", "forgot-password.tsx"), "utf8")).toContain("/forgot-password");
  });
});

describe("languages", () => {
  test("Gujarati is a choice (the switch lists every locale) and the OS knows it", () => {
    expect(read("components/language-switch.tsx")).toMatch(/LOCALES\.map/);
    expect(read("components/language-switch.tsx")).toMatch(/gu-IN/);
    const app = JSON.parse(read("app.json")).expo;
    expect(app.locales.gu).toBe("./locales/gu.json");
  });

  test("new native strings exist in English and Hindi", () => {
    const flat = (tree: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v as Record<string, unknown>, `${prefix}${k}.`)));
    for (const ns of ["gate", "web", "dies", "orders", "tabs"] as const) {
      const e = flat((en.native as unknown as Record<string, Record<string, unknown>>)[ns]!);
      const h = flat((hi.native as unknown as Record<string, Record<string, unknown>>)[ns]!);
      expect(e.length).toBeGreaterThan(0);
      expect(h.sort()).toEqual(e.sort());
    }
  });
});
