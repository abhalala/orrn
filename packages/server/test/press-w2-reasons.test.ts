/** `press.reasons`: the station's pickers read the active reason codes of a kind (W2-PR-W). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { reasonCode } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { pressHelpers } from "./press-w2-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

describe("press.reasons", () => {
  test("lists the active codes of one kind, any member; a retired code drops out; other is last", async () => {
    const p = await pressPlant();
    const downtime = await p.as("press").press.reasons({ kind: "downtime" });
    expect(downtime.map((r) => r.code)).toContain("die_change");
    expect(downtime.at(-1)!.code).toBe("other");
    expect(downtime.find((r) => r.code === "other")!.requiresNote).toBe(true);
    const rejects = await p.as("viewer").press.reasons({ kind: "qc_reject" });
    expect(rejects.map((r) => r.code)).toEqual(expect.arrayContaining(["dimension", "surface", "bend", "crack", "short_length", "other"]));
    // Other kinds stay out.
    expect(rejects.some((r) => r.code === "die_change")).toBe(false);
    const [bend] = rejects.filter((r) => r.code === "bend");
    await env.db.update(reasonCode).set({ active: false }).where(and(eq(reasonCode.companyId, p.companyId), eq(reasonCode.id, bend!.id)));
    expect((await p.as("press").press.reasons({ kind: "qc_reject" })).some((r) => r.code === "bend")).toBe(false);
  });
});
