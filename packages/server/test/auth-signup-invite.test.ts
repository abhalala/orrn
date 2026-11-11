/**
 * Security review 2026-11-04, HIGH 3. `POST /api/auth/sign-up/email` was open to anyone, with no
 * email check. Registering a plant owner's address before their access request was approved made
 * `waitlistApprove` give `owner` of the new plant to the attacker's account (and send the real
 * owner no link).
 *
 * Now:
 *   - a sign-up over HTTP needs a live invite for that exact email (`inviteToken` in the body);
 *     server code (Godseye staff, the dev seed) still creates accounts in-process;
 *   - waitlist approval binds the owner role only to an account that proved it holds the mailbox
 *     (`emailVerified`), never to whoever registered the address first;
 *   - finishing a password reset proves the mailbox (the link went there), so it marks it verified.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, membership, user, verification, waitlistRequest } from "@orrn/db/schema";
import { company, invite } from "@orrn/db/schema/tenant";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type AuthModule = typeof import("@orrn/auth");
let auth: ReturnType<AuthModule["createAuth"]>;

beforeAll(async () => {
  env = await createTestEnv();
  const mod = await import("@orrn/auth");
  mod.resetAuthForTests();
  auth = mod.createAuth();
}, 60_000);

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

const PASSWORD = "attacker-chosen-password-1";

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify(body),
    }),
  );

const unique = (tag: string) => `${tag}.${crypto.randomUUID().slice(0, 8)}@test.orrn`;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeInvite(email: string, over: Partial<typeof invite.$inferInsert> = {}) {
  const { companyId } = await env.seedCompany();
  const token = crypto.randomUUID();
  await env.db.insert(invite).values({
    id: crypto.randomUUID(),
    companyId,
    email: email.toLowerCase(),
    role: "office",
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  return { token, companyId };
}

const userByEmail = (email: string) => env.db.select().from(user).where(eq(user.email, email.toLowerCase())).get();

describe("public sign-up is closed (HIGH 3)", () => {
  test("a sign-up with no invite is refused and makes no account", async () => {
    const email = unique("owner");
    const res = await post("sign-up/email", { name: "x", email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("SIGN_UP_NEEDS_INVITE");
    expect(await userByEmail(email)).toBeUndefined();
  });

  test("an invite for another address, or a dead invite, makes no account", async () => {
    const invited = unique("invited");
    const live = await makeInvite(invited);
    const other = unique("other");
    const wrong = await post("sign-up/email", { name: "x", email: other, password: PASSWORD, inviteToken: live.token });
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { code?: string }).code).toBe("SIGN_UP_INVITE_EMAIL_MISMATCH");
    expect(await userByEmail(other)).toBeUndefined();

    for (const over of [
      { expiresAt: new Date(Date.now() - 1000) },
      { revokedAt: new Date() },
      { acceptedAt: new Date() },
    ]) {
      const email = unique("dead");
      const dead = await makeInvite(email, over);
      const res = await post("sign-up/email", { name: "x", email, password: PASSWORD, inviteToken: dead.token });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe("SIGN_UP_INVITE_NOT_VALID");
      expect(await userByEmail(email)).toBeUndefined();
    }
    const unknown = unique("unknown");
    const res = await post("sign-up/email", { name: "x", email: unknown, password: PASSWORD, inviteToken: crypto.randomUUID() });
    expect(res.status).toBe(403);
    expect(await userByEmail(unknown)).toBeUndefined();
  });

  test("a live invite for the same address (any case) makes an unverified account, which can then accept", async () => {
    const email = unique("Invitee");
    const { token, companyId } = await makeInvite(email);
    const res = await post("sign-up/email", { name: "Invitee", email: email.toUpperCase(), password: PASSWORD, inviteToken: token });
    expect(res.status).toBe(200);
    const made = await userByEmail(email);
    expect(made?.emailVerified).toBe(false);
    await env.callerForUser(made!.id).invite.acceptByToken({ token });
    const member = await env.db
      .select()
      .from(membership)
      .where(and(eq(membership.userId, made!.id), eq(membership.companyId, companyId)))
      .get();
    expect(member?.role).toBe("office");
  });

  test("server code still makes accounts in-process (Godseye staff)", async () => {
    const { createPlatformStaffAccount } = await import("../src/lib/create-platform-staff");
    const admin = await env.seedUser("Staff maker");
    const email = unique("staff");
    const { userId } = await createPlatformStaffAccount(env.db, { name: "New staff", email, password: "staff-password-123", role: "support", createdByUserId: admin });
    expect((await userByEmail(email))?.id).toBe(userId);
  });
});

async function fileRequest(requesterEmail: string) {
  const { id } = await env.caller(null).waitlist.submit({
    companyName: `Plant ${crypto.randomUUID().slice(0, 8)}`,
    requesterName: "Real owner",
    requesterEmail,
  });
  return id;
}

/** An account someone else registered at this address: a password, never proved the mailbox. */
async function squat(email: string, verified = false) {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  await env.db.insert(user).values({ id, name: "Squatter", email, emailVerified: verified } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  return id;
}

describe("waitlist approval binds the owner to a proven mailbox (HIGH 3)", () => {
  test("an account that never proved the address is refused the owner role; nothing is approved", async () => {
    const email = unique("target-owner");
    const squatter = await squat(email);
    const requestId = await fileRequest(email);
    const staff = env.caller({ platformRole: "super_admin" });

    await expect(staff.platform.waitlistApprove({ id: requestId })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await env.db.select().from(membership).where(eq(membership.userId, squatter))).toHaveLength(0);
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, requestId)).get();
    expect(request?.status).toBe("pending");
    const shell = await env.db.select().from(company).where(eq(company.id, request!.companyId!)).get();
    expect(shell?.status).toBe("pending");
  });

  test("once the address is proved (a finished password reset), approval goes ahead", async () => {
    const email = unique("reset-owner");
    const id = await squat(email);
    const requestId = await fileRequest(email);

    // The reset link only ever goes to the mailbox: finishing it proves the address.
    const token = `reset${crypto.randomUUID().replaceAll("-", "")}`;
    await env.db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `reset-password:${token}`,
      value: id,
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never);
    const done = await post("reset-password", { newPassword: "the-real-owners-password-2", token });
    expect(done.status).toBe(200);
    expect((await userByEmail(email))?.emailVerified).toBe(true);

    const result = await env.caller({ platformRole: "super_admin" }).platform.waitlistApprove({ id: requestId });
    expect(result.success).toBe(true);
    expect(result.signInRefused).toBe("has_password");
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, requestId)).get();
    const owner = await env.db
      .select()
      .from(membership)
      .where(and(eq(membership.userId, id), eq(membership.companyId, request!.companyId!)))
      .get();
    expect(owner?.role).toBe("owner");
  });
});
