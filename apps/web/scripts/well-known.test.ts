import { describe, expect, test } from "bun:test";

import { wellKnownFiles, wellKnownPlugin } from "./well-known";

/**
 * Passkey domain association (plan 2026-11-18, Task 6). The iOS and Android apps may use passkeys for
 * orrn.in only when orrn.in says they belong to it. Both values are optional build-time env: until the
 * owner gives the Apple Team ID and the Android release certificate, no file is written and the apps
 * hide their passkey button.
 */
const TEAM = "ABCDE12345";
const CERT = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

describe("wellKnownFiles", () => {
  test("both files with both values, exact JSON", () => {
    const files = wellKnownFiles({ ORRN_APPLE_TEAM_ID: TEAM, ORRN_ANDROID_CERT_SHA256: CERT });
    expect(Object.keys(files).sort()).toEqual([".well-known/apple-app-site-association", ".well-known/assetlinks.json"]);
    expect(files[".well-known/apple-app-site-association"]).toBe('{"webcredentials":{"apps":["ABCDE12345.in.orrn.app"]}}');
    expect(JSON.parse(files[".well-known/assetlinks.json"]!)).toEqual([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: "in.orrn.app", sha256_cert_fingerprints: [CERT] },
      },
    ]);
  });

  test("no files without values (unset or blank)", () => {
    expect(wellKnownFiles({})).toEqual({});
    expect(wellKnownFiles({ ORRN_APPLE_TEAM_ID: " ", ORRN_ANDROID_CERT_SHA256: "" })).toEqual({});
  });

  test("each file stands alone", () => {
    expect(Object.keys(wellKnownFiles({ ORRN_APPLE_TEAM_ID: TEAM }))).toEqual([".well-known/apple-app-site-association"]);
    expect(Object.keys(wellKnownFiles({ ORRN_ANDROID_CERT_SHA256: CERT }))).toEqual([".well-known/assetlinks.json"]);
  });

  test("the certificate is written in the colon-separated upper-case form Android compares", () => {
    const bare = CERT.replaceAll(":", "").toLowerCase();
    const files = wellKnownFiles({ ORRN_ANDROID_CERT_SHA256: bare });
    expect(JSON.parse(files[".well-known/assetlinks.json"]!)[0].target.sha256_cert_fingerprints).toEqual([CERT]);
  });

  test("a value that is set but malformed fails the build instead of shipping a broken file", () => {
    expect(() => wellKnownFiles({ ORRN_APPLE_TEAM_ID: "abc" })).toThrow(/ORRN_APPLE_TEAM_ID/);
    expect(() => wellKnownFiles({ ORRN_ANDROID_CERT_SHA256: "12:34" })).toThrow(/ORRN_ANDROID_CERT_SHA256/);
  });
});

describe("wellKnownPlugin", () => {
  type Emitted = { type: string; fileName: string; source: string };
  function run(env: Record<string, string | undefined>) {
    const emitted: Emitted[] = [];
    const plugin = wellKnownPlugin(env);
    expect(plugin.apply).toBe("build");
    const hook = plugin.generateBundle as unknown as (this: { emitFile(f: Emitted): string }) => void;
    hook.call({ emitFile: (file) => (emitted.push(file), "id") });
    return emitted;
  }

  test("the web build writes the files into dist when the values are set", () => {
    const emitted = run({ ORRN_APPLE_TEAM_ID: TEAM, ORRN_ANDROID_CERT_SHA256: CERT });
    expect(emitted.map((f) => f.fileName).sort()).toEqual([".well-known/apple-app-site-association", ".well-known/assetlinks.json"]);
    expect(emitted.every((f) => f.type === "asset")).toBe(true);
  });

  test("and nothing when they are not", () => {
    expect(run({})).toEqual([]);
  });
});
