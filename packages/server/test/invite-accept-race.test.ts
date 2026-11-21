/**
 * Council round 1, A1 (GPT C1): an invite accept that races a revoke or a resend must not land.
 *
 * `acceptInvite` claims the invite inside its batch (current token hash, not accepted, not revoked,
 * not expired) and fails the whole batch when the claim changed nothing, so the membership, the portal
 * row and the audit row land only with the claim. `beforeNextBatch` runs the other mutation after the
 * accept's reads and before its write, which is the race GPT reproduced.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { auditLog, customerPortalUser, invite, membership, user } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";

let env: TestEnv;
const h = portalHelpers(() => env);

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

const DAY = 24 * 60 * 60 * 1000;
const uid = () => crypto.randomUUID().slice(0, 8);

async function sha256(text: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

async function memberInvite(companyId: string, email: string) {
  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  await env.db.insert(invite).values({
    id,
    companyId,
    email,
    role: "viewer",
    tokenHash: await sha256(token),
    expiresAt: new Date(Date.now() + 7 * DAY),
    kind: "member",
  });
  return { id, token };
}

async function accountFor(email: string) {
  const id = crypto.randomUUID();
  await env.db.insert(user).values({ id, name: "Ramesh Vaghela", email } as never);
  return id;
}

const membershipOf = (userId: string, companyId: string) =>
  env.db.select().from(membership).where(and(eq(membership.userId, userId), eq(membership.companyId, companyId))).get();
const inviteRow = (id: string) => env.db.select().from(invite).where(eq(invite.id, id)).get();
const auditRows = (companyId: string, action: string) =>
  env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action))).all();

describe("member invite: accept racing revoke or resend", () => {
  test("a revoke that lands after the accept's reads wins: no membership, no accept, no audit row", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.revoke.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);

    env.beforeNextBatch(() => env.caller({ role: "owner", companyId }).invite.revoke({ inviteId: inv.id }));
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invite is expired or no longer valid",
    });

    expect(await membershipOf(userId, companyId)).toBeUndefined();
    const row = await inviteRow(inv.id);
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.acceptedAt).toBeNull();
    expect(await auditRows(companyId, "member.invite.accept")).toHaveLength(0);
  });

  test("a resend that rotates the token after the accept's reads wins: the old link grants nothing", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.resend.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);

    let newLink = "";
    env.beforeNextBatch(async () => {
      newLink = (await env.caller({ role: "owner", companyId }).invite.resend({ inviteId: inv.id })).link;
    });
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(await membershipOf(userId, companyId)).toBeUndefined();
    expect((await inviteRow(inv.id))?.acceptedAt).toBeNull();
    expect(await auditRows(companyId, "member.invite.accept")).toHaveLength(0);

    // The new link still works.
    const fresh = newLink.split("/invite/")[1]!;
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: fresh })).resolves.toEqual({ success: true });
    expect(await membershipOf(userId, companyId)).toBeDefined();
    expect(await auditRows(companyId, "member.invite.accept")).toHaveLength(1);
  });

  test("Google sign-up's acceptLiveInvitesFor skips an invite revoked under it", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.google.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);
    const { acceptLiveInvitesFor } = await import("../src/lib/acceptInvite");

    env.beforeNextBatch(() => env.caller({ role: "owner", companyId }).invite.revoke({ inviteId: inv.id }));
    expect(await acceptLiveInvitesFor(env.db, userId, email)).toBe(0);
    expect(await membershipOf(userId, companyId)).toBeUndefined();
    expect(await auditRows(companyId, "member.invite.accept")).toHaveLength(0);
  });

  test("the same account accepting twice at once: one membership, and both answers are success", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.twice.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);

    let inner: unknown;
    env.beforeNextBatch(async () => {
      inner = await env.callerForUser(userId).invite.acceptByToken({ token: inv.token });
    });
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).resolves.toEqual({ success: true });
    expect(inner).toEqual({ success: true });
    expect(await auditRows(companyId, "member.invite.accept")).toHaveLength(1);
    const rows = await env.db.select().from(membership).where(and(eq(membership.userId, userId), eq(membership.companyId, companyId))).all();
    expect(rows).toHaveLength(1);
  });

  test("an invite that expires between the read and the write is not claimed", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.expire.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);

    env.beforeNextBatch(() => env.db.update(invite).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invite.id, inv.id)));
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await membershipOf(userId, companyId)).toBeUndefined();
  });
});

describe("party (portal) invite: accept racing revoke or a fresh grant", () => {
  async function grantedParty() {
    const p = await h.portalPlant();
    const email = `party.race.${uid()}@test.orrn`;
    const granted = await p.as("office").portal.users.grant({ customerId: p.customerId, email });
    const token = granted.inviteUrl!.split("/invite/")[1]!;
    const userId = await accountFor(email);
    return { p, email, token, userId, portalUserId: granted.id };
  }

  test("a login revoked after the accept's reads stays revoked, and no accept row is written", async () => {
    const { p, token, userId, portalUserId } = await grantedParty();

    env.beforeNextBatch(() => p.as("office").portal.users.revoke({ id: portalUserId }));
    await expect(env.callerForUser(userId).invite.acceptByToken({ token })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const row = await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, portalUserId)).get();
    expect(row?.status).toBe("revoked");
    expect(row?.userId ?? null).toBeNull();
    expect(await auditRows(p.companyId, "portal.user.accept")).toHaveLength(0);
  });

  test("a fresh grant (the party's resend) after the accept's reads kills the old link", async () => {
    const { p, email, token, userId, portalUserId } = await grantedParty();

    let fresh = "";
    env.beforeNextBatch(async () => {
      const again = await p.as("office").portal.users.grant({ customerId: p.customerId, email });
      fresh = again.inviteUrl!.split("/invite/")[1]!;
    });
    await expect(env.callerForUser(userId).invite.acceptByToken({ token })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const row = await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, portalUserId)).get();
    expect(row?.status).toBe("invited");
    expect(await auditRows(p.companyId, "portal.user.accept")).toHaveLength(0);

    // The new link works.
    await expect(env.callerForUser(userId).invite.acceptByToken({ token: fresh })).resolves.toEqual({ success: true, portal: true });
    expect((await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, portalUserId)).get())?.status).toBe("active");
  });
});

/**
 * Council round 2 (Claude N-M3): the abort is recognised by its SQLite text, which live D1 might wrap.
 * With the text not recognised, a lost claim still answers as a lost claim (never a 500), and a batch
 * that failed for another reason while the claim could still land is thrown as it is.
 */
describe("a lost claim whose abort text is not recognised", () => {
  async function unrecognised(run: () => Promise<unknown>): Promise<void> {
    const atomic = await import("../src/lib/atomic");
    const spy = spyOn(atomic, "isBatchAbort").mockReturnValue(false);
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
  }

  test("a revoke that won still answers 'expired or no longer valid'", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.unrecognised.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);
    env.beforeNextBatch(() => env.caller({ role: "owner", companyId }).invite.revoke({ inviteId: inv.id }));
    await unrecognised(async () =>
      await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Invite is expired or no longer valid",
      }),
    );
    expect(await membershipOf(userId, companyId)).toBeUndefined();
  });

  test("the same account's double accept still answers success", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.unrecognised2.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);
    env.beforeNextBatch(() => env.callerForUser(userId).invite.acceptByToken({ token: inv.token }));
    await unrecognised(async () => await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).resolves.toMatchObject({ success: true }));
    expect(await membershipOf(userId, companyId)).toBeDefined();
  });

  test("a batch that failed for another reason, with the claim still open, is thrown as it is", async () => {
    const { companyId } = await env.seedCompany();
    const email = `race.other.${uid()}@test.orrn`;
    const inv = await memberInvite(companyId, email);
    const userId = await accountFor(email);
    env.beforeNextBatch(async () => {
      throw new Error("D1_ERROR: network connection lost");
    });
    await unrecognised(async () => await expect(env.callerForUser(userId).invite.acceptByToken({ token: inv.token })).rejects.toThrow(/network connection lost/));
    expect((await inviteRow(inv.id))?.acceptedAt).toBeNull();
  });
});
