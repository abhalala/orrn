import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { hashPassword } from "@orrn/auth/password";
import { account, auditLog, company, user } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

/**
 * Server touch points of the web front door (Task 17): the welcome stepper's
 * last step for people without company settings rights, and the magic-link
 * password step when a password is already set.
 */

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));
}

describe("completeOnboarding without company fields", () => {
  test("an invited operator or viewer finishes onboarding with no company fields at all", async () => {
    const { companyId, users } = await env.seedCompany({ settings: { facilityLocation: "Sachin GIDC" } });
    for (const role of ["operator", "viewer"] as const) {
      await env.db.update(user).set({ onboardingCompleted: false }).where(eq(user.id, users[role].id));
      await env.caller({ role, companyId }).auth.completeOnboarding({});
      const [u] = await env.db.select().from(user).where(eq(user.id, users[role].id));
      expect(u!.onboardingCompleted).toBe(true);
    }
    const [row] = await env.db.select().from(company).where(eq(company.id, companyId));
    expect(row!.settings).toMatchObject({ facilityLocation: "Sachin GIDC" });
    expect((await audits(companyId, "settings.update")).length).toBe(0);
  });

  test("an owner or admin must send the company fields (BAD_REQUEST), and nothing changes", async () => {
    const { companyId, users } = await env.seedCompany();
    for (const role of ["owner", "admin"] as const) {
      await env.db.update(user).set({ onboardingCompleted: false }).where(eq(user.id, users[role].id));
      await expect(env.caller({ role, companyId }).auth.completeOnboarding({})).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(
        env.caller({ role, companyId }).auth.completeOnboarding({ facilityLocation: "Sachin GIDC" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [u] = await env.db.select().from(user).where(eq(user.id, users[role].id));
      expect(u!.onboardingCompleted).toBe(false);
    }
  });

  test("blank company fields count as missing", async () => {
    const { companyId } = await env.seedCompany();
    await expect(
      env.caller({ role: "owner", companyId }).auth.completeOnboarding({
        facilityLocation: "  ",
        primaryContact: "+91 98250 41177",
        timezone: "Asia/Kolkata",
        pressCount: 2,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("setPassword when a password already exists", () => {
  test("CONFLICT, without clearing the forced-change flag or writing an audit row", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = users.owner;
    await env.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: owner.id,
      providerId: "credential",
      userId: owner.id,
      password: await hashPassword("existing-pass-1"),
      updatedAt: new Date(),
    });
    await env.db.update(user).set({ mustChangePassword: true }).where(eq(user.id, owner.id));

    await expect(
      env.caller({ role: "owner", companyId }).auth.setPassword({ password: "another-pass-2" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [u] = await env.db.select().from(user).where(eq(user.id, owner.id));
    expect(u!.mustChangePassword).toBe(true);
    expect((await audits(companyId, "auth.password_set")).length).toBe(0);
  });
});

describe("auth.me hasPassword", () => {
  test("false for a magic-link account (no credential password), true once one exists", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = users.owner;
    const caller = () => env.caller({ role: "owner", companyId });

    // Waitlist approval makes the owner with no account row at all.
    expect((await caller().auth.me()).user.hasPassword).toBe(false);

    // A credential row without a password (Better Auth never writes one, but the column allows it) still counts as none.
    const accountId = crypto.randomUUID();
    await env.db.insert(account).values({
      id: accountId,
      accountId: owner.id,
      providerId: "credential",
      userId: owner.id,
      password: null,
      updatedAt: new Date(),
    });
    expect((await caller().auth.me()).user.hasPassword).toBe(false);

    await env.db
      .update(account)
      .set({ password: await hashPassword("first-pass-1") })
      .where(eq(account.id, accountId));
    expect((await caller().auth.me()).user.hasPassword).toBe(true);
  });

  test("another provider's account is not a password", async () => {
    const { companyId, users } = await env.seedCompany();
    await env.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: "google-123",
      providerId: "google",
      userId: users.admin.id,
      password: null,
      updatedAt: new Date(),
    });
    expect((await env.caller({ role: "admin", companyId }).auth.me()).user.hasPassword).toBe(false);
  });
});
