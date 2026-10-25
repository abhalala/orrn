/**
 * W4-NEXTROWS FP-PF-14: `release.notes` lists the last eight published native and web builds with
 * their notes (the same text the update gate shows), newest first, for any plant member. Edge
 * (spool) builds are not listed; signed-out callers get nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { appRelease } from "@orrn/db/schema/platform";

import { setClockForTests } from "../src/lib/clock";
import { RELEASE_NOTES_SHOWN } from "../src/routers/release";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  setClockForTests(null);
  await env.dispose();
});

const staff = () => env.caller({ platformRole: "admin" });

describe("release.notes (FP-PF-14 About)", () => {
  test("last eight native app notes, newest first; edge left out; any member reads", async () => {
    const t0 = Date.UTC(2026, 9, 1, 6, 0, 0);
    for (let i = 1; i <= 10; i += 1) {
      setClockForTests(new Date(t0 + i * 60_000));
      await staff().platform.release.publish({
        platform: i % 2 === 0 ? "android" : "ios",
        channel: "production",
        version: `9.${i}.0`,
        buildNumber: 5_000 + i,
        minBuild: 0,
        notes: `Change ${i}`,
      });
    }
    setClockForTests(new Date(t0 + 11 * 60_000));
    // An edge (spool) build is not the app's: written directly, it is never listed.
    await env.db.insert(appRelease).values({ id: crypto.randomUUID(), platform: "edge", channel: "production", version: "9.11.0", buildNumber: 5_011, notes: "Edge 11", publishedAt: new Date() });

    // Wave 1's unused first channel names and a build with no notes never reach a plant (m-1).
    await env.db.insert(appRelease).values([
      { id: crypto.randomUUID(), platform: "android", channel: "beta", version: "9.12.0", buildNumber: 5_012, notes: "Beta 12", publishedAt: new Date(t0 + 12 * 60_000) },
      { id: crypto.randomUUID(), platform: "ios", channel: "stable", version: "9.13.0", buildNumber: 5_013, notes: "Stable 13", publishedAt: new Date(t0 + 13 * 60_000) },
      { id: crypto.randomUUID(), platform: "web", channel: "floor", version: "9.14.0", buildNumber: 5_014, notes: "   ", publishedAt: new Date(t0 + 14 * 60_000) },
    ]);

    const { companyId } = await env.seedCompany();
    for (const role of ["owner", "packer", "viewer"] as const) {
      const got = await env.caller({ role, companyId }).release.notes();
      expect(got.items).toHaveLength(RELEASE_NOTES_SHOWN);
      expect(got.items.every((r) => r.channel === "production" || r.channel === "floor")).toBe(true);
      expect(got.items.map((r) => r.notes)).toEqual([10, 9, 8, 7, 6, 5, 4, 3].map((i) => `Change ${i}`));
      expect(got.items[0]).toMatchObject({ platform: "android", version: "9.10.0", buildNumber: 5_010, channel: "production", mandatory: false });
      expect(typeof got.items[0]!.publishedAt).toBe("number");
    }
    await expect(env.caller(null).release.notes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
