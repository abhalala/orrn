import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { companyRoles, invite, membership } from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { sendEmail } from "../lib/email";
import { companyProcedure, roleGuard, publicProcedure, router } from "../index";

export const inviteRouter = router({
  list: companyProcedure.query(async ({ ctx }) => {
    return ctx.db.query.invite.findMany({
      where: and(
        eq(invite.companyId, ctx.companyId),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt)
      ),
    });
  }),

  create: roleGuard("owner", "admin")
    .input(z.object({ email: z.string().email(), role: z.enum(companyRoles) }))
    .mutation(async ({ ctx, input }) => {
      const existingUser = await ctx.db.query.user.findFirst({
        where: eq(user.email, input.email)
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

      const inviteId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

      await ctx.db.insert(invite).values({
        id: inviteId,
        companyId: ctx.companyId,
        email: input.email,
        role: input.role,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        invitedBy: ctx.session.user.id,
      });

      // TODO: Get base URL from environment
      const inviteUrl = `http://localhost:5173/invite/${token}`;

      await sendEmail({
        to: input.email,
        subject: "You've been invited to join a company on ORRN",
        html: `<p>You have been invited to join a company on ORRN.</p>
               <p>Click <a href="${inviteUrl}">here</a> to accept the invitation and set up your account.</p>`,
      });

      return { success: true };
    }),

  revoke: roleGuard("owner", "admin")
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const targetInvite = await ctx.db.query.invite.findFirst({
        where: and(
          eq(invite.id, input.inviteId),
          eq(invite.companyId, ctx.companyId)
        )
      });
      
      if (!targetInvite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      if (targetInvite.acceptedAt || targetInvite.revokedAt) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is no longer pending" });
      }

      await ctx.db
        .update(invite)
        .set({ revokedAt: new Date() })
        .where(eq(invite.id, input.inviteId));

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
      if (currentUser?.email !== targetInvite.email) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match logged in user" });
      }

      const membershipId = crypto.randomUUID();

      await ctx.db.transaction(async (tx) => {
         await tx.insert(membership).values({
            id: membershipId,
            userId,
            companyId: targetInvite.companyId,
            role: targetInvite.role,
         });

         await tx.update(invite)
            .set({ acceptedAt: new Date() })
            .where(eq(invite.id, targetInvite.id));
      });

      return { success: true };
    }),
});
