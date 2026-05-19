import { eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { company, invite, waitlistRequest } from "@orrn/db/schema/tenant";
import { sendEmail } from "../lib/email";
import { platformProcedure, router } from "../index";

export const platformRouter = router({
  waitlistList: platformProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(waitlistRequest).where(eq(waitlistRequest.status, "pending")).all();
  }),
  
  waitlistApprove: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is already processed" });
      }

      const companyId = crypto.randomUUID();
      const inviteId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));
      const slug = request.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomUUID().split('-')[0];

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(waitlistRequest)
          .set({ status: "approved", reviewedBy: ctx.session.user.id, reviewedAt: new Date() })
          .where(eq(waitlistRequest.id, input.id));

        await tx.insert(company).values({
          id: companyId,
          name: request.companyName,
          slug,
          status: "active",
        });

        await tx.insert(invite).values({
          id: inviteId,
          companyId,
          email: request.requesterEmail,
          role: "owner",
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          invitedBy: ctx.session.user.id,
        });
      });

      // TODO: Get base URL from environment
      const inviteUrl = `http://localhost:5173/invite/${token}`;

      await sendEmail({
        to: request.requesterEmail,
        subject: "Your ORRN waitlist request has been approved!",
        html: `<p>Hi ${request.requesterName},</p>
               <p>Good news! Your company ${request.companyName} has been approved for ORRN.</p>
               <p>Click <a href="${inviteUrl}">here</a> to set up your account.</p>`,
      });

      return { success: true };
    }),

  waitlistReject: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(waitlistRequest)
        .set({ status: "rejected", reviewedBy: ctx.session.user.id, reviewedAt: new Date() })
        .where(eq(waitlistRequest.id, input.id));
      
      return { success: true };
    }),
});
