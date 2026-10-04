import { describe, expect, test } from "bun:test";

import { DEV_LOCAL_TRUSTED_ORIGINS, trustedOriginsFor } from "@orrn/auth/origins";

const WEB = "https://app.orrn.in";
const APEX = "https://orrn.app";

/** Anything a local dev server, Expo or a LAN device could send as an Origin. */
const LOCAL = /localhost|127\.0\.0\.1|192\.168\.|exp:\/\//;

describe("Better Auth trustedOrigins (packages/auth buildAuth)", () => {
  test("production trusts exactly the configured web origins and the native scheme", () => {
    expect(trustedOriginsFor({ NODE_ENV: "production", CORS_ORIGIN: WEB, CORS_ALLOWED_ORIGINS: `${WEB},${APEX}` })).toEqual([
      WEB,
      APEX,
      "orrn://",
    ]);
  });

  test("outside development no localhost, 127.0.0.1, LAN or Expo pattern is ever trusted", () => {
    for (const NODE_ENV of ["production", "test", "staging", undefined]) {
      const origins = trustedOriginsFor({ NODE_ENV, CORS_ORIGIN: WEB });
      expect(origins.filter((o) => LOCAL.test(o))).toEqual([]);
      for (const pattern of DEV_LOCAL_TRUSTED_ORIGINS) expect(origins).not.toContain(pattern);
    }
  });

  test("development adds the any-port localhost patterns, so every worktree's web port can sign in", () => {
    const origins = trustedOriginsFor({ NODE_ENV: "development", CORS_ORIGIN: "http://localhost:3002" });
    for (const pattern of DEV_LOCAL_TRUSTED_ORIGINS) expect(origins).toContain(pattern);
    expect(origins).toContain("http://localhost:3002");
    expect(origins).toContain("orrn://");
    expect(origins).toContain("exp://");
  });
});
