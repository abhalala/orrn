import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { hashPassword } from "@orrn/auth/password";
import {
  account,
  auditLog,
  company,
  impersonationGrant,
  invite,
  membership,
  platformAdmin,
  session,
  user,
} from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const uid = () => crypto.randomUUID();

async function seedSession(userId: string) {
  const id = uid();
  await env.db.insert(session).values({
    id,
    token: `tok-${id}`,
    userId,
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date(),
  });
  return id;
}

async function seedCredential(userId: string) {
  await env.db.insert(account).values({
    id: uid(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword("old-password-1"),
    updatedAt: new Date(),
  });
}

async function memberId(companyId: string, userId: string) {
  const [row] = await env.db
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.userId, userId)));
  return row!.id;
}

async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));
}

describe("changeInitialPassword (S3)", () => {
  test("rejects when mustChangePassword is false (FORBIDDEN)", async () => {
    const { companyId, users } = await env.seedCompany();
    await seedCredential(users.operator.id);
    const api = env.caller({ role: "operator", companyId });
    await expect(api.auth.changeInitialPassword({ newPassword: "brand-new-pass" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("clears the flag and deletes the user's other sessions", async () => {
    const { companyId, users } = await env.seedCompany();
    const u = users.operator;
    await seedCredential(u.id);
    await env.db.update(user).set({ mustChangePassword: true }).where(eq(user.id, u.id));
    const current = await seedSession(u.id);
    const other = await seedSession(u.id);
    const bystander = await seedSession(users.viewer.id);

    const api = env.caller({ role: "operator", companyId, sessionId: current });
    await api.auth.changeInitialPassword({ newPassword: "brand-new-pass" });

    const [row] = await env.db.select().from(user).where(eq(user.id, u.id));
    expect(row!.mustChangePassword).toBe(false);

    const mine = await env.db.select({ id: session.id }).from(session).where(eq(session.userId, u.id));
    expect(mine.map((s) => s.id)).toEqual([current]);
    expect(mine.map((s) => s.id)).not.toContain(other);
    const theirs = await env.db.select({ id: session.id }).from(session).where(eq(session.userId, users.viewer.id));
    expect(theirs.map((s) => s.id)).toEqual([bystander]);

    expect((await audits(companyId, "auth.password_force_change")).length).toBe(1);
  });
});

describe("owner protection (S4)", () => {
  test("admin cannot demote owner / remove owner / invite owner (FORBIDDEN)", async () => {
    const { companyId, users } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    const ownerMembership = await memberId(companyId, users.owner.id);
    const managerMembership = await memberId(companyId, users.manager.id);

    await expect(admin.company.membersUpdateRole({ membershipId: ownerMembership, role: "admin" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.company.membersRemove({ membershipId: ownerMembership })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.invite.create({ email: "x@test.orrn", role: "owner" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // promoting someone to owner is also owner-only
    await expect(admin.company.membersUpdateRole({ membershipId: managerMembership, role: "owner" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const [still] = await env.db.select().from(membership).where(eq(membership.id, ownerMembership));
    expect(still!.role).toBe("owner");
  });

  test("owner cannot demote or remove the last owner (BAD_REQUEST)", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const ownerMembership = await memberId(companyId, users.owner.id);
    const msg = "A company needs at least one owner";

    await expect(owner.company.membersUpdateRole({ membershipId: ownerMembership, role: "admin" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: msg,
    });
    await expect(owner.company.membersRemove({ membershipId: ownerMembership })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: msg,
    });
  });

  test("an owner can demote and remove another owner while one remains", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    // promote admin to a second owner, then demote that owner again
    const adminMembership = await memberId(companyId, users.admin.id);
    await owner.company.membersUpdateRole({ membershipId: adminMembership, role: "owner" });
    await owner.company.membersUpdateRole({ membershipId: adminMembership, role: "manager" });
    const [row] = await env.db.select().from(membership).where(eq(membership.id, adminMembership));
    expect(row!.role).toBe("manager");
  });

  test("role change, removal and invite each write an audit_log row", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const viewerMembership = await memberId(companyId, users.viewer.id);
    const operatorMembership = await memberId(companyId, users.operator.id);

    await owner.company.membersUpdateRole({ membershipId: viewerMembership, role: "operator" });
    await owner.company.membersRemove({ membershipId: operatorMembership });
    await owner.invite.create({ email: `new.${uid()}@test.orrn`, role: "manager" });

    const [roleRow] = await audits(companyId, "member.updateRole");
    expect(roleRow).toMatchObject({ subjectType: "membership", subjectId: viewerMembership, actorId: users.owner.id });
    expect(roleRow!.meta).toMatchObject({ from: "viewer", to: "operator" });

    const [removeRow] = await audits(companyId, "member.remove");
    expect(removeRow).toMatchObject({ subjectType: "membership", subjectId: operatorMembership });

    const [inviteRow] = await audits(companyId, "member.invite");
    expect(inviteRow).toMatchObject({ subjectType: "invite", actorId: users.owner.id });
    const [inv] = await env.db.select().from(invite).where(eq(invite.companyId, companyId));
    expect(inviteRow!.subjectId).toBe(inv!.id);
  });
});

describe("impersonation (S5)", () => {
  test("support staff cannot create an impersonation grant", async () => {
    const { companyId } = await env.seedCompany();
    await expect(
      env.caller({ platformRole: "support" }).platform.impersonationCreateGrant({ companyId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const grants = await env.db.select().from(impersonationGrant).where(eq(impersonationGrant.companyId, companyId));
    expect(grants.length).toBe(0);
  });

  test("admin staff can still create a grant", async () => {
    const { companyId } = await env.seedCompany();
    const g = await env.caller({ platformRole: "admin" }).platform.impersonationCreateGrant({ companyId });
    expect(g.companyId).toBe(companyId);
  });

  test("a grant held by staff later downgraded to support is rejected in context", async () => {
    const { resolveImpersonation } = await import("../src/lib/impersonation");
    const { companyId } = await env.seedCompany();

    const staffId = uid();
    await env.db.insert(user).values({ id: staffId, name: "Staff", email: `staff.${staffId}@test.orrn` });
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "admin" });
    await env.db.insert(impersonationGrant).values({
      id: uid(),
      platformAdminId: staffId,
      companyId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const args = { userId: staffId, isPlatformAdmin: true, targetCompanyId: companyId };
    // As admin the grant is honoured.
    expect((await resolveImpersonation(env.db, { ...args, platformRole: "admin" })).ok).toBe(true);

    // Downgrade the staff member, re-read the role as the context does, re-check.
    await env.db.update(platformAdmin).set({ role: "support" }).where(eq(platformAdmin.userId, staffId));
    const [now] = await env.db.select().from(platformAdmin).where(eq(platformAdmin.userId, staffId));
    expect(now!.role).toBe("support");
    expect((await resolveImpersonation(env.db, { ...args, platformRole: now!.role })).ok).toBe(false);
  });

  test("non-staff and inactive-company grants are still rejected", async () => {
    const { resolveImpersonation } = await import("../src/lib/impersonation");
    const { companyId } = await env.seedCompany();
    const staffId = uid();
    await env.db.insert(user).values({ id: staffId, name: "Staff", email: `staff.${staffId}@test.orrn` });
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "super_admin" });
    await env.db.insert(impersonationGrant).values({
      id: uid(),
      platformAdminId: staffId,
      companyId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const base = { userId: staffId, targetCompanyId: companyId };
    expect((await resolveImpersonation(env.db, { ...base, isPlatformAdmin: false, platformRole: null })).ok).toBe(false);
    expect((await resolveImpersonation(env.db, { ...base, isPlatformAdmin: true, platformRole: "super_admin" })).ok).toBe(true);
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, companyId));
    expect((await resolveImpersonation(env.db, { ...base, isPlatformAdmin: true, platformRole: "super_admin" })).ok).toBe(false);
  });
});

describe("completeOnboarding (S14)", () => {
  const input = {
    facilityLocation: "Plant 9",
    primaryContact: "Someone",
    timezone: "Asia/Kolkata",
    pressCount: 3,
  };

  test("non-settings members complete only their own onboarding; company row untouched", async () => {
    const { companyId, users } = await env.seedCompany({ settings: { facilityLocation: "Original" } });
    for (const role of ["operator", "viewer", "manager"] as const) {
      const [before] = await env.db.select().from(company).where(eq(company.id, companyId));
      await env.caller({ role, companyId }).auth.completeOnboarding(input);
      const [after] = await env.db.select().from(company).where(eq(company.id, companyId));
      expect(after).toEqual(before!);
      expect(after!.settings).toMatchObject({ facilityLocation: "Original" });
      const [u] = await env.db.select().from(user).where(eq(user.id, users[role].id));
      expect(u!.onboardingCompleted).toBe(true);
    }
    expect((await audits(companyId, "settings.update")).length).toBe(0);
  });

  test("owner and admin can", async () => {
    const { companyId, users } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).auth.completeOnboarding(input);
    const [row] = await env.db.select().from(company).where(eq(company.id, companyId));
    expect(row!.settings).toMatchObject({ facilityLocation: "Plant 9", pressCount: 3 });
    const [u] = await env.db.select().from(user).where(eq(user.id, users.owner.id));
    expect(u!.onboardingCompleted).toBe(true);
    await env.caller({ role: "admin", companyId }).auth.completeOnboarding({ ...input, facilityLocation: "Plant 10" });
    expect((await audits(companyId, "settings.update")).length).toBe(2);
  });
});
