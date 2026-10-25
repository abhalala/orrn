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
  gateInputs,
  gateState,
  installedBuildNumber,
  needsUpdate,
  parseStored,
  releaseChannel,
  shouldStore,
  storedFrom,
  UNREADABLE_BUILD,
  type CheckAnswer,
  type StoredCheck,
} from "../lib/release-gate";
import { hexId } from "../lib/hex-id";
import { FORGOT_PASSWORD_PATH, joinWebUrl, settingsTabPath, webLinkRows } from "../lib/web-link";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const HOUR = 3_600_000;
const open: CheckAnswer = { state: "open", reason: "ok", latest: { version: "1.2.0" }, apkUrl: null };
const below: CheckAnswer = { state: "blocked", reason: "below_min_build", latest: { version: "1.2.0" }, apkUrl: "https://files.example/orrn.apk" };
const lastOpen = (ago: number, build = 11): StoredCheck => ({ at: NOW - ago, state: "open", buildNumber: build, latestVersion: "1.2.0", apkUrl: null });

describe("release gate decision (spec E7: Check to Open or Blocked)", () => {
  test("an Open answer, online and fresh, lets the app in", () => {
    expect(gateState({ lastOpenAt: NOW - HOUR, lastVerdict: open, now: NOW, online: true })).toEqual({ kind: "open", via: "server", graceUntil: null });
  });

  test("a Blocked answer is a block with its reason, the newest version and the APK link", () => {
    expect(gateState({ lastOpenAt: null, lastVerdict: below, now: NOW, online: true })).toEqual({
      kind: "blocked",
      reason: "below_min_build",
      latestVersion: "1.2.0",
      apkUrl: "https://files.example/orrn.apk",
    });
  });

  test("a revoked install is blocked", () => {
    const revoked: CheckAnswer = { state: "blocked", reason: "revoked", latest: null, apkUrl: null };
    expect(gateState({ lastOpenAt: NOW - HOUR, lastVerdict: revoked, now: NOW, online: true })).toMatchObject({ kind: "blocked", reason: "revoked" });
  });
});

describe("gateState: offline grace (24 h from the last Open answer, never-checked is Blocked)", () => {
  const offline = (lastOpenAt: number | null, lastVerdict: CheckAnswer | null, now = NOW) => gateState({ lastOpenAt, lastVerdict, now, online: false });

  test("offline within 24 hours of an Open answer opens, saying until when", () => {
    expect(offline(NOW - 23 * HOUR, open)).toEqual({ kind: "open", via: "grace", graceUntil: NOW - 23 * HOUR + OFFLINE_GRACE_MS });
  });

  test("at exactly 24 hours the grace has ended", () => {
    expect(offline(NOW - OFFLINE_GRACE_MS, open)).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("never checked is Blocked", () => {
    expect(offline(null, null)).toMatchObject({ kind: "blocked", reason: "never_checked" });
  });

  test("an offline Blocked answer stays blocked, as last_blocked", () => {
    expect(offline(null, below)).toMatchObject({ kind: "blocked", reason: "last_blocked", latestVersion: "1.2.0" });
  });

  test("a phone clock set back before the last answer is not trusted", () => {
    expect(offline(NOW + HOUR, open)).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("I-1: the same inputs, a later clock: the app that was Open at 23 h is Blocked at 24 h (recomputed while it stays open)", () => {
    const lastOpenAt = NOW - 23 * HOUR;
    expect(offline(lastOpenAt, open, NOW)).toMatchObject({ kind: "open", via: "grace" });
    expect(offline(lastOpenAt, open, NOW + HOUR)).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("I-1: a failed refetch is not online: old Open data past 24 h is Blocked, not 'open via server'", () => {
    // React Query keeps `data` after a failed refetch; the caller passes online: false for it.
    const arrived = NOW - 30 * HOUR;
    expect(gateState({ lastOpenAt: arrived, lastVerdict: open, now: NOW, online: false })).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });

  test("I-1: even an 'online' Open answer older than 24 h is not trusted (no recheck has landed)", () => {
    expect(gateState({ lastOpenAt: NOW - 25 * HOUR, lastVerdict: open, now: NOW, online: true })).toMatchObject({ kind: "blocked", reason: "grace_expired" });
  });
});

describe("gateInputs: what the live query and the kept answer say", () => {
  const keptOpen = (ago: number, build = 11): StoredCheck => ({ at: NOW - ago, state: "open", buildNumber: build, latestVersion: "1.2.0", apkUrl: null });

  test("a live answer is timed by when it arrived, not by now (a remount keeps the old time)", () => {
    const i = gateInputs({ data: open, dataUpdatedAt: NOW - 20 * HOUR, stored: null, buildNumber: 11 });
    expect(i).toEqual({ lastVerdict: open, lastOpenAt: NOW - 20 * HOUR });
    expect(gateState({ ...i, now: NOW, online: false })).toMatchObject({ kind: "open", via: "grace", graceUntil: NOW + 4 * HOUR });
  });

  test("a live Blocked answer has no Open time", () => {
    expect(gateInputs({ data: below, dataUpdatedAt: NOW, stored: keptOpen(HOUR), buildNumber: 11 })).toEqual({ lastVerdict: below, lastOpenAt: null });
  });

  test("cold start with no answer yet: the kept Open answer for this build opens inside the grace", () => {
    const i = gateInputs({ data: undefined, dataUpdatedAt: 0, stored: keptOpen(HOUR), buildNumber: 11 });
    expect(gateState({ ...i, now: NOW, online: false })).toMatchObject({ kind: "open", via: "grace" });
  });

  test("cold start: an answer kept for another build does not count (an update must check once)", () => {
    const i = gateInputs({ data: undefined, dataUpdatedAt: 0, stored: keptOpen(HOUR, 10), buildNumber: 11 });
    expect(i).toEqual({ lastVerdict: null, lastOpenAt: null });
    expect(gateState({ ...i, now: NOW, online: false })).toMatchObject({ kind: "blocked", reason: "never_checked" });
  });

  test("cold start: past 24 h, or last blocked, or nothing kept, is Blocked", () => {
    const stale = gateInputs({ data: undefined, dataUpdatedAt: 0, stored: keptOpen(25 * HOUR), buildNumber: 11 });
    expect(gateState({ ...stale, now: NOW, online: false })).toMatchObject({ reason: "grace_expired" });
    const blocked: StoredCheck = { at: NOW - HOUR, state: "blocked", buildNumber: 11, latestVersion: null, apkUrl: null };
    const last = gateInputs({ data: undefined, dataUpdatedAt: 0, stored: blocked, buildNumber: 11 });
    expect(gateState({ ...last, now: NOW, online: false })).toMatchObject({ reason: "last_blocked" });
    expect(gateState({ ...gateInputs({ data: undefined, dataUpdatedAt: 0, stored: null, buildNumber: 11 }), now: NOW, online: false })).toMatchObject({ reason: "never_checked" });
  });

  test("I-1: the answer is stored once; seeing it again (a remount) does not restamp and restart the 24 h", () => {
    const stored = storedFrom(open, 11, NOW - 20 * HOUR);
    expect(shouldStore(null, open, 11, NOW - 20 * HOUR)).toBe(true);
    expect(shouldStore(stored, open, 11, NOW - 20 * HOUR)).toBe(false);
    expect(shouldStore(stored, open, 11, NOW)).toBe(true);
    expect(shouldStore(stored, below, 11, NOW - 20 * HOUR)).toBe(true);
    expect(shouldStore(stored, open, 12, NOW - 20 * HOUR)).toBe(true);
  });

  test("I-1 wiring: the gate stamps with dataUpdatedAt (never Date.now), recomputes on a clock tick, and rechecks on an interval", () => {
    const src = read("components/release-gate.tsx");
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).toMatch(/storedFrom\([^)]*check\.dataUpdatedAt\)/);
    expect(src).toMatch(/useNow\(/);
    expect(src).toMatch(/refetchInterval/);
    expect(src).toMatch(/online = data !== null && !check\.isError/);
    expect(read("lib/use-now.ts")).toMatch(/AppState\.addEventListener\("change"/);
    expect(read("lib/use-now.ts")).toMatch(/setInterval/);
  });
});

describe("blocked copy", () => {
  const reasons = ["below_min_build", "revoked", "never_checked", "grace_expired", "last_blocked", "unreadable_build"] as const;

  test("every blocked reason has a sentence in English, Hindi and Gujarati (floor phones see this screen)", () => {
    for (const r of reasons) {
      const key = blockedKey(r);
      expect(createI18n("en").t(key)).not.toBe(key);
      expect(createI18n("hi").t(key)).not.toBe(createI18n("en").t(key));
      expect(createI18n("gu").t(key)).not.toBe(createI18n("en").t(key));
    }
  });

  test("every gate string and every 'Open on the web' string has Gujarati", () => {
    const gu = createI18n("gu");
    const en = createI18n("en");
    const keys = [
      "native.checkAgain", "native.gate.checking", "native.gate.blockedTitle", "native.gate.latest", "native.gate.getLatest", "native.gate.graceNote",
      "native.web.title", "native.web.hint", "native.web.team", "native.web.shifts", "native.web.standards", "native.web.backup",
    ] as const;
    for (const k of keys) expect(gu.t(k, { version: "1", time: "2" })).not.toBe(en.t(k, { version: "1", time: "2" }));
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

describe("build identity (I-2: the installed binary, never the update manifest)", () => {
  test("the build is a whole number above 0 from the binary's own string; anything else is unreadable", () => {
    expect(installedBuildNumber("11")).toBe(11);
    expect(installedBuildNumber(" 12 ")).toBe(12);
    expect(installedBuildNumber(13)).toBe(13);
    for (const bad of [null, undefined, "", "0", "-1", "1.0.0", "abc", "12a", "1e3"]) expect(installedBuildNumber(bad)).toBeNull();
  });

  test("an unreadable build is a block with its own sentence", () => {
    expect(UNREADABLE_BUILD).toMatchObject({ kind: "blocked", reason: "unreadable_build" });
    expect(createI18n("en").t(blockedKey("unreadable_build"))).toContain("could not read");
    expect(needsUpdate("unreadable_build")).toBe(false);
  });

  test("the gate, device.register and More read the build through expo-application, none from Constants.expoConfig", () => {
    for (const f of ["components/release-gate.tsx", "lib/device-register.ts", "app/more/index.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/buildNumber\b[^\n]*expoConfig|expoConfig[^\n]*(buildNumber|versionCode|\.version)|nativeBuildNumber/);
      expect(src).toMatch(/lib\/native-build|\.\/native-build/);
    }
    const native = read("lib/native-build.ts");
    expect(native).toMatch(/from "expo-application"/);
    expect(native).toMatch(/nativeBuildVersion/);
    expect(native).not.toMatch(/expo-constants/);
    // unreadable means blocked
    expect(read("components/release-gate.tsx")).toMatch(/buildNumber === null\) return UNREADABLE_BUILD/);
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

  test("hex ids are 2 hex characters per byte from the byte source", () => {
    expect(hexId(16, () => Uint8Array.from({ length: 16 }, (_, i) => i * 16 + 1))).toBe(["01", "11", "21", "31", "41", "51", "61", "71", "81", "91", "a1", "b1", "c1", "d1", "e1", "f1"].join(""));
    expect(hexId(2, () => Uint8Array.from([0, 255]))).toBe("00ff");
    expect(() => hexId(4, () => new Uint8Array(3))).toThrow();
  });

  test("m-9: ids and the install id come from expo-crypto, never Math.random", () => {
    for (const f of ["lib/random-id.ts", "lib/hex-id.ts", "lib/install-id.ts"]) expect(read(f)).not.toMatch(/Math\.random/);
    expect(read("lib/random-id.ts")).toMatch(/from "expo-crypto"/);
    expect(read("lib/random-id.ts")).toMatch(/randomUUID\(\)/);
    expect(read("lib/install-id.ts")).toMatch(/newInstallId\(\)/);
  });
});

describe("device.register on launch", () => {
  test("m-8: the sign-out decision is the server's code (data.meta.reason), never its English sentence", () => {
    const revoked = { data: { code: "FORBIDDEN", meta: { reason: "device_revoked" } }, message: "anything at all" };
    expect(isDeviceRevoked(revoked)).toBe(true);
    // A reworded or translated sentence still revokes; the old sentence without the code does not.
    expect(isDeviceRevoked({ ...revoked, message: "यह डिवाइस बंद है" })).toBe(true);
    expect(isDeviceRevoked({ data: { code: "FORBIDDEN" }, message: "This device has been turned off for this plant" })).toBe(false);
    expect(isDeviceRevoked({ data: { code: "FORBIDDEN", meta: { reason: "suspended" } }, message: "turned off" })).toBe(false);
    expect(isDeviceRevoked({ data: { code: "INTERNAL_SERVER_ERROR", meta: { reason: "device_revoked" } } })).toBe(false);
    expect(isDeviceRevoked(new Error("Network request failed"))).toBe(false);
    expect(isDeviceRevoked(null)).toBe(false);
    expect(read("lib/device-revoked.ts")).not.toMatch(/turned off"\)|includes\(/);
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
