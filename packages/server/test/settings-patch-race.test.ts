/**
 * Council round 1, A3 (GPT I2): a settings save writes only the keys it names, against the value in
 * the database at write time, never a stale copy of the whole object. So an admin's unrelated save
 * that started before the owner turned on "Require secure sign-in" cannot turn it off again, and the
 * security audit row describes the value that was actually replaced. Same for the welcome company
 * step (`auth.completeOnboarding`) and the cast series start (`foundry.castSeries`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, company } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

const settingsOf = async (companyId: string) =>
  ((await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get())?.settings ?? {}) as Record<
    string,
    unknown
  >;
const securityRows = (companyId: string) =>
  env.db
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.security.update")))
    .all();

/** The owner's session for the plant, signed in with a passkey (the policy holds them too once it is on). */
const owner = (companyId: string) => env.caller({ role: "owner", companyId, signInMethod: "passkey" });

describe("company.updateSettings against the current value", () => {
  test("an admin's empty save that started before the owner turned the policy on leaves it on", async () => {
    const { companyId } = await env.seedCompany();
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    await env.caller({ role: "admin", companyId }).company.updateSettings({});
    expect((await settingsOf(companyId)).requireStrongSignIn).toBe(true);
  });

  test("an admin's real save in the same race keeps the policy and adds its own key", async () => {
    const { companyId } = await env.seedCompany();
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    const answer = await env.caller({ role: "admin", companyId }).company.updateSettings({ timezone: "Asia/Kolkata" });
    const now = await settingsOf(companyId);
    expect(now.requireStrongSignIn).toBe(true);
    expect(now.timezone).toBe("Asia/Kolkata");
    // The answer is what the plant has now, not the admin's stale copy.
    expect(answer.settings.requireStrongSignIn).toBe(true);
  });

  test("another key written by someone else in between survives an unrelated save", async () => {
    const { companyId } = await env.seedCompany({ settings: { orderLeadDays: 3 } });
    env.beforeNextBatch(() => env.caller({ role: "admin", companyId }).company.updateSettings({ orderLeadDays: 9 }));
    await env.caller({ role: "admin", companyId }).company.updateSettings({ timezone: "Asia/Kolkata" });
    const now = await settingsOf(companyId);
    expect(now.orderLeadDays).toBe(9);
    expect(now.timezone).toBe("Asia/Kolkata");
  });

  test("the audit transition is the value actually replaced: two owners turning it on at once write one row", async () => {
    const { companyId } = await env.seedCompany();
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    await owner(companyId).company.updateSettings({ requireStrongSignIn: true });
    expect((await settingsOf(companyId)).requireStrongSignIn).toBe(true);
    const rows = await securityRows(companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toEqual({ requireStrongSignIn: { from: false, to: true } });
  });

  test("on then off racing: each row names what it replaced", async () => {
    const { companyId } = await env.seedCompany();
    // The owner reads false and asks for off (no change from what it read); another owner turns it on first.
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    await owner(companyId).company.updateSettings({ requireStrongSignIn: false });
    expect((await settingsOf(companyId)).requireStrongSignIn).toBe(false);
    const rows = (await securityRows(companyId)).map((r) => r.meta);
    expect(rows).toContainEqual({ requireStrongSignIn: { from: false, to: true } });
    expect(rows).toContainEqual({ requireStrongSignIn: { from: true, to: false } });
    expect(rows).toHaveLength(2);
  });

  test("a value it already has writes no security row", async () => {
    const { companyId } = await env.seedCompany({ settings: { requireStrongSignIn: true } });
    await owner(companyId).company.updateSettings({ requireStrongSignIn: true });
    expect(await securityRows(companyId)).toHaveLength(0);
  });
});

describe("auth.completeOnboarding against the current value", () => {
  test("the welcome company step does not undo a policy the owner turned on in between", async () => {
    const { companyId } = await env.seedCompany();
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    await env.caller({ role: "admin", companyId }).auth.completeOnboarding({
      facilityLocation: "Sachin GIDC, Surat",
      primaryContact: "+91 98250 41177",
      timezone: "Asia/Kolkata",
      pressCount: 3,
    });
    const now = await settingsOf(companyId);
    expect(now.requireStrongSignIn).toBe(true);
    expect(now.facilityLocation).toBe("Sachin GIDC, Surat");
    expect(now.pressCount).toBe(3);
  });
});

describe("foundry.casts.setSeriesStart against the current value", () => {
  test("setting where the cast book continues does not undo a policy turned on in between", async () => {
    const { companyId } = await env.seedCompany({ modules: ["foundry"] });
    env.beforeNextBatch(() => owner(companyId).company.updateSettings({ requireStrongSignIn: true }));
    await env.caller({ role: "admin", companyId }).foundry.casts.setSeriesStart({ start: { period: "2031-04", start: 120 } });
    const now = await settingsOf(companyId);
    expect(now.requireStrongSignIn).toBe(true);
    expect(now.castSeriesStart).toEqual({ period: "2031-04", start: 120 });
  });
});
