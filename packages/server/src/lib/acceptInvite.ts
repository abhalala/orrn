import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { invite, membership } from "@orrn/db/schema/tenant";
import { customerPortalUser } from "@orrn/db/schema/portal";
import type { Context } from "../context";
import type { OrrnDb } from "./atomic";
import { atomicBatch } from "./atomic";
import { auditInsert } from "./audit";
import { hasLivePortalRow } from "./portal";
import { nextCompanySeq } from "./sequence";

export type InviteRow = typeof invite.$inferSelect;

/** Who accepts: the signed-in account (its id is the audit actor) and any impersonation in force. */
export type InviteActor = {
  session: NonNullable<Context["session"]>;
  impersonation?: Context["impersonation"];
};

/**
 * Accepts one invite for `userId`, the shared step of `invite.acceptByToken` and Google sign-up
 * (plan 2026-11-18). The caller has already checked the invite is live and is for this account's
 * email. A party (portal) invite turns its portal row active; a member invite makes the membership.
 * A party login is never also staff in the same plant, either way round (PF §9-12).
 */
export async function acceptInvite(
  db: OrrnDb,
  actor: InviteActor,
  target: InviteRow,
  userId: string,
): Promise<{ success: true; portal?: true }> {
  if (target.kind === "portal") {
    return acceptPortalInvite({ db, session: actor.session, impersonation: actor.impersonation }, target, userId);
  }

  // PF §9-12: a party login in this plant never also becomes staff here.
  if (await hasLivePortalRow(db, target.companyId, { userId })) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This login is a party login in this plant. Ask for an invite on another email." });
  }

  const membershipId = crypto.randomUUID();

  await atomicBatch(db, [
    db.insert(membership).values({
      id: membershipId,
      userId,
      companyId: target.companyId,
      role: target.role,
    }),
    db
      .update(invite)
      .set({ acceptedAt: new Date() })
      .where(eq(invite.id, target.id)),
    auditInsert(
      { db, session: actor.session, impersonation: actor.impersonation, companyId: target.companyId },
      {
        action: "member.invite.accept",
        subjectType: "membership",
        subjectId: membershipId,
        meta: { inviteId: target.id, role: target.role },
      },
    ),
  ]);

  return { success: true };
}

/**
 * Google sign-up (plan 2026-11-18): accepts every live invite for the email, each through
 * `acceptInvite`, so the person lands in every plant that invited them. An invite `acceptInvite`
 * refuses (party/staff conflict, a portal row gone) is skipped and logged by invite id only.
 * Registered with the auth package in `context.ts` (`configureAuthHooks`).
 */
export async function acceptLiveInvitesFor(db: OrrnDb, userId: string, email: string, now: Date = new Date()): Promise<number> {
  const address = email.trim().toLowerCase();
  if (!address) return 0;
  const live = await db
    .select()
    .from(invite)
    .where(and(sql`lower(${invite.email}) = ${address}`, isNull(invite.acceptedAt), isNull(invite.revokedAt), gt(invite.expiresAt, now)))
    .all();
  // Only `session.user.id` is read (the audit actor): the new account accepts its own invites.
  const actor: InviteActor = { session: { user: { id: userId } } as NonNullable<Context["session"]>, impersonation: null };
  let accepted = 0;
  for (const target of live) {
    try {
      await acceptInvite(db, actor, target, userId);
      accepted += 1;
    } catch (error) {
      const reason = error instanceof TRPCError ? error.code : error instanceof Error ? error.name : "unknown";
      console.warn(`Google sign-up: invite ${target.id} not accepted (${reason})`);
    }
  }
  return accepted;
}

/**
 * Accept a party invite (Wave 3 portal): the portal row turns `active` for this account. No
 * membership is ever created; an account that is staff in this plant is refused (PF §9-12).
 */
async function acceptPortalInvite(
  ctx: { db: OrrnDb; session: NonNullable<Context["session"]>; impersonation?: Context["impersonation"] },
  target: InviteRow,
  userId: string,
) {
  const [member] = await ctx.db
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, target.companyId)))
    .limit(1);
  if (member) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This login works in the plant here. A party needs its own email." });
  }
  const [row] = await ctx.db
    .select()
    .from(customerPortalUser)
    .where(
      and(
        eq(customerPortalUser.companyId, target.companyId),
        eq(customerPortalUser.inviteId, target.id),
        eq(customerPortalUser.status, "invited"),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is expired or no longer valid" });
  const [other] = await ctx.db
    .select({ id: customerPortalUser.id })
    .from(customerPortalUser)
    .where(and(eq(customerPortalUser.companyId, target.companyId), eq(customerPortalUser.userId, userId)))
    .limit(1);
  if (other && other.id !== row.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This account already has a party login in this plant" });
  }
  const at = new Date();
  const seq = await nextCompanySeq({ db: ctx.db }, target.companyId);
  await atomicBatch(ctx.db, [
    ctx.db
      .update(customerPortalUser)
      .set({ status: "active", userId, acceptedAt: at, serverSeq: seq, updatedAt: at })
      .where(
        and(
          eq(customerPortalUser.id, row.id),
          eq(customerPortalUser.companyId, target.companyId),
          eq(customerPortalUser.status, "invited"),
          eq(customerPortalUser.inviteId, target.id),
        ),
      ),
    ctx.db
      .update(invite)
      .set({ acceptedAt: at })
      .where(and(eq(invite.id, target.id), isNull(invite.acceptedAt), isNull(invite.revokedAt))),
    auditInsert(
      { ...ctx, companyId: target.companyId },
      {
        action: "portal.user.accept",
        subjectType: "customer_portal_user",
        subjectId: row.id,
        meta: { inviteId: target.id, customerId: row.customerId },
      },
    ),
  ]);
  return { success: true as const, portal: true as const };
}
