import { afterAll, describe, expect, mock, test } from "bun:test";

/**
 * Google on the phone only where the auth session is ephemeral (controller ruling, Task 6 fix round 1).
 * On Android expo-web-browser's Custom Tab shares Chrome's cookies, so on a shared floor phone the next
 * person could pick the last person's Google account: Android hides "Continue with Google". Platform is
 * mocked for both OSes.
 */
let os = "ios";
mock.module("react-native", () => {
  const web = require("react-native-web");
  return {
    ...web,
    Platform: {
      ...web.Platform,
      get OS() {
        return os;
      },
    },
  };
});

afterAll(() => {
  os = "web";
});

const WITH_GOOGLE = { google: true, passkey: { rpID: "orrn.in" }, native: { ios: true, android: true } };

describe("googleAvailableOnThisPlatform", () => {
  test("iOS offers Google when the stage has it", async () => {
    os = "ios";
    const { googleAvailableOnThisPlatform } = await import("../lib/google-availability");
    expect(googleAvailableOnThisPlatform(WITH_GOOGLE)).toBe(true);
    expect(googleAvailableOnThisPlatform({ ...WITH_GOOGLE, google: false })).toBe(false);
    expect(googleAvailableOnThisPlatform(undefined)).toBe(false);
  });

  test("Android never offers Google, even when the stage has it", async () => {
    os = "android";
    const { googleAvailableOnThisPlatform } = await import("../lib/google-availability");
    expect(googleAvailableOnThisPlatform(WITH_GOOGLE)).toBe(false);
    // And back on iOS the same call offers it again: the gate reads the platform, not a cached value.
    os = "ios";
    expect(googleAvailableOnThisPlatform(WITH_GOOGLE)).toBe(true);
  });

  test("the sign-in buttons ask this one gate", async () => {
    const src = await Bun.file(`${import.meta.dir}/../features/auth/alt-sign-in.tsx`).text();
    expect(src).toMatch(/const google = googleAvailableOnThisPlatform\(methods\.data\)/);
  });
});
