import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { companyRoles, membership } from "@orrn/db/schema/tenant";
import { companyProcedure, roleGuard, router } from "../index";

export const companyRouter = router({
  membersList: companyProcedure.query(async ({ ctx }) => {
    return ctx.db.query.membership.findMany({
      where: eq(membership.companyId, ctx.companyId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });
  }),

  membersUpdateRole: roleGuard("owner", "admin")
    .input(z.object({ membershipId: z.string(), role: z.enum(companyRoles) }))
    .mutation(async ({ ctx, input }) => {
      // Don't let someone change their own role to something else if they are the only owner
      // or similar checks. For now, simple update:
      const targetMembership = await ctx.db.query.membership.findFirst({
        where: and(
          eq(membership.id, input.membershipId),
          eq(membership.companyId, ctx.companyId)
        )
      });
      
      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Membership not found" });
      }

      if (targetMembership.userId === ctx.session.user.id) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
      }

      await ctx.db
        .update(membership)
        .set({ role: input.role })
        .where(eq(membership.id, input.membershipId));

      return { success: true };
    }),

  membersRemove: roleGuard("owner", "admin")
    .input(z.object({ membershipId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const targetMembership = await ctx.db.query.membership.findFirst({
        where: and(
          eq(membership.id, input.membershipId),
          eq(membership.companyId, ctx.companyId)
        )
      });
      
      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Membership not found" });
      }

      if (targetMembership.userId === ctx.session.user.id) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      await ctx.db
        .delete(membership)
        .where(eq(membership.id, input.membershipId));

      return { success: true };
    }),
});
