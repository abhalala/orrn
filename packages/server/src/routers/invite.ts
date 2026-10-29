import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { companyRoles, invite, membership } from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { customerPortalUser } from "@orrn/db/schema/portal";
import type { Context } from "../context";
import type { OrrnDb } from "../lib/atomic";
import { hasLivePortalRow } from "../lib/portal";
import { nextCompanySeq } from "../lib/sequence";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { sendEmail, renderOrrnEmailHtml } from "../lib/email";
import { webBaseUrl } from "../lib/webUrl";
import { errorText } from "../lib/pack";
import { REPLAY_KEY_PATTERN, replayRowId, replayToken } from "../lib/replayToken";
import { actionProcedure, companyProcedure, publicProcedure, router } from "../index";

export const inviteRouter = router({
  list: companyProcedure.query(async ({ ctx }) => {
    return ctx.db.query.invite.findMany({
      where: and(
        eq(invite.companyId, ctx.companyId),
        // Party logins are listed by portal.users.list (Team tab second list), not here.
        eq(invite.kind, "member"),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt)
      ),
    });
  }),

  create: actionProcedure("member.invite")
    .input(
      z.object({
        email: z.string().trim().max(320).email(),
        role: z.enum(companyRoles),
        /**
         * Replay key (final fixes 5, M4): a repeat of the same request (a double tap, a reply lost on the way) answers the
         * FIRST invite and its link with `replayed: true` and makes no second one. Another email or role under the same
         * key is a CONFLICT. The email is not sent again on a repeat.
         */
        clientMutationId: z.string().regex(REPLAY_KEY_PATTERN, "clientMutationId is 16 to 64 letters, digits, - or _").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Emails are compared case-insensitively everywhere; store them lower-cased (audit S7).
      const email = input.email.toLowerCase();
      if (input.role === "owner" && ctx.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an owner can invite another owner",
        });
      }
      const keyed = input.clientMutationId ? { id: await replayRowId(ctx.companyId, "invite.create", input.clientMutationId), key: input.clientMutationId } : null;
      const inviteReplay = async () => {
        if (!keyed) return null;
        const prior = await ctx.db.query.invite.findFirst({ where: and(eq(invite.id, keyed.id), eq(invite.companyId, ctx.companyId)) });
        if (!prior) return null;
        if (prior.email !== email || prior.role !== input.role) {
          throw new TRPCError({ code: "CONFLICT", message: "This request id was already used for a different request." });
        }
        const link = `${webBaseUrl()}/invite/${await replayToken(ctx.companyId, "invite.create", keyed.key, "uuid")}`;
        // The first call tried the email; whether it went is not kept, so a repeat says it did not and hands over the link.
        return { success: true, inviteId: prior.id, email, role: input.role, link, emailSent: false, expiresAt: prior.expiresAt, replayed: true as const };
      };
      const again = await inviteReplay();
      if (again) return again;

      const existingUser = await ctx.db.query.user.findFirst({
        where: sql`lower(${user.email}) = ${email}`,
      });
      
      if (existingUser) {
        // Check if already a member
        const existingMembership = await ctx.db.query.membership.findFirst({
          where: and(
             eq(membership.userId, existingUser.id),
             eq(membership.companyId, ctx.companyId)
          )
        });
        if (existingMembership) {
           throw new TRPCError({ code: "BAD_REQUEST", message: "User is already a member" });
        }
      }
      // PF §9-12: an email that is a party login in this plant is never also staff here.
      if (await hasLivePortalRow(ctx.db, ctx.companyId, { email })) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This email is a party login here. Use another email for staff." });
      }

      const inviteId = keyed?.id ?? crypto.randomUUID();
      const token = keyed ? await replayToken(ctx.companyId, "invite.create", keyed.key, "uuid") : crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

      try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(invite).values({
          id: inviteId,
          companyId: ctx.companyId,
          email,
          role: input.role,
          tokenHash,
          expiresAt,
          invitedBy: ctx.session.user.id,
        }),
        auditInsert(ctx, {
          action: "member.invite",
          subjectType: "invite",
          subjectId: inviteId,
          meta: { email, role: input.role },
        }),
      ]);
      } catch (e) {
        // Two identical requests racing end on the row's primary key: the second answers the first invite.
        if (keyed && /UNIQUE constraint failed: invite\.(id|token_hash)|PRIMARY KEY/i.test(errorText(e))) {
          const won = await inviteReplay();
          if (won) return won;
        }
        throw e;
      }

      const inviteUrl = `${webBaseUrl()}/invite/${token}`;

      // M3 (final explore): the invite is written; nothing after this throws. The email can fail
      // (Resend, Oct 2026) or not be set up (local), so the inviter always gets the link to copy and
      // send by WhatsApp or their own mail, the same way Godseye gets an owner's sign-in details.
      let emailSent = false;
      try {
        await sendEmail({
          to: email,
          subject: "You've been invited to join a company on ORRN",
          text: `You have been invited to join an ORRN company workspace as ${input.role.toUpperCase()}.\n\nAccept the invitation: ${inviteUrl}\n\nIf you did not expect this invitation, ignore this email. This link works for 7 days.`,
          html: renderOrrnEmailHtml({
            title: "Workspace Invitation",
            description: `You have been invited to join a company workspace on ORRN-AL with the role of ${input.role.toUpperCase()}. Click the button below to accept the invitation and complete your account setup.`,
            buttonText: "Accept Invitation",
            buttonUrl: inviteUrl,
            footerText: "If you did not expect this invitation, you can safely ignore this email. This invitation is valid for 7 days."
          }),
        });
        emailSent = true;
      } catch (error) {
        // Neutral log: no address, no link (the link is a live invite). Provider, SMTP code and our own
        // message (never the server's reply) say which mail path failed.
        const failure = error instanceof Error ? error : new Error(String(error));
        const provider = "provider" in failure ? String(failure.provider) : "unknown";
        const status = "status" in failure ? String(failure.status) : "";
        console.warn("Invite saved; its email did not go:", failure.name, provider, status, failure.message);
      }

      return { success: true, inviteId, email, role: input.role, link: inviteUrl, emailSent, expiresAt, replayed: false as const };
    }),

  revoke: actionProcedure("member.invite")
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const targetInvite = await ctx.db.query.invite.findFirst({
        where: and(
          eq(invite.id, input.inviteId),
          eq(invite.companyId, ctx.companyId)
        )
      });
      
      // Party invites are revoked with portal.users.revoke (it also revokes the login).
      if (!targetInvite || targetInvite.kind !== "member") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      if (targetInvite.acceptedAt || targetInvite.revokedAt) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is no longer pending" });
      }

      await atomicBatch(ctx.db, [
        ctx.db
          .update(invite)
          .set({ revokedAt: new Date() })
          .where(and(eq(invite.id, input.inviteId), eq(invite.companyId, ctx.companyId))),
        auditInsert(ctx, {
          action: "member.invite.revoke",
          subjectType: "invite",
          subjectId: input.inviteId,
          meta: { email: targetInvite.email, role: targetInvite.role },
        }),
      ]);

      return { success: true };
    }),

  acceptByToken: publicProcedure
    .input(z.object({ token: z.string(), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));
      
      const targetInvite = await ctx.db.query.invite.findFirst({
        where: eq(invite.tokenHash, tokenHash)
      });

      if (!targetInvite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite token" });
      }

      if (targetInvite.acceptedAt || targetInvite.revokedAt || targetInvite.expiresAt < new Date()) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is expired or no longer valid" });
      }

      // Check if the user is already authenticated
      if (!ctx.session) {
         throw new TRPCError({ code: "UNAUTHORIZED", message: "Must be logged in to accept invite" });
      }

      const userId = ctx.session.user.id;
      
      // Ensure the logged in user matches the invite email
      const currentUser = await ctx.db.query.user.findFirst({ where: eq(user.id, userId) });
      if (currentUser?.email.toLowerCase() !== targetInvite.email.toLowerCase()) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match logged in user" });
      }

      if (targetInvite.kind === "portal") {
        return acceptPortalInvite({ db: ctx.db, session: ctx.session, impersonation: ctx.impersonation }, targetInvite, userId);
      }

      // PF §9-12: a party login in this plant never also becomes staff here.
      if (await hasLivePortalRow(ctx.db, targetInvite.companyId, { userId })) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This login is a party login in this plant. Ask for an invite on another email." });
      }

      const membershipId = crypto.randomUUID();

      await atomicBatch(ctx.db, [
        ctx.db.insert(membership).values({
          id: membershipId,
          userId,
          companyId: targetInvite.companyId,
          role: targetInvite.role,
        }),
        ctx.db
          .update(invite)
          .set({ acceptedAt: new Date() })
          .where(eq(invite.id, targetInvite.id)),
        auditInsert(
          { ...ctx, companyId: targetInvite.companyId },
          {
            action: "member.invite.accept",
            subjectType: "membership",
            subjectId: membershipId,
            meta: { inviteId: targetInvite.id, role: targetInvite.role },
          },
        ),
      ]);

      return { success: true };
    }),
});

/**
 * Accept a party invite (Wave 3 portal): the portal row turns `active` for this account. No
 * membership is ever created; an account that is staff in this plant is refused (PF §9-12).
 */
async function acceptPortalInvite(
  ctx: { db: OrrnDb; session: NonNullable<Context["session"]>; impersonation?: Context["impersonation"] },
  target: typeof invite.$inferSelect,
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
  return { success: true, portal: true as const };
}
