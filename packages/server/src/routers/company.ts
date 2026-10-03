import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { companyRoles, membership } from "@orrn/db/schema/tenant";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { actionProcedure, companyProcedure, router } from "../index";

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

  membersUpdateRole: actionProcedure("member.updateRole")
    .input(z.object({ membershipId: z.string(), role: z.enum(companyRoles) }))
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

      const touchesOwner = targetMembership.role === "owner" || input.role === "owner";
      if (touchesOwner && ctx.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an owner can change owner roles",
        });
      }

      if (targetMembership.role === "owner" && input.role !== "owner") {
        await assertAnotherOwnerExists(ctx.db, ctx.companyId);
      }

      if (targetMembership.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
      }

      await atomicBatch(ctx.db, [
        ctx.db
          .update(membership)
          .set({ role: input.role })
          .where(
            and(
              eq(membership.id, input.membershipId),
              eq(membership.companyId, ctx.companyId),
            ),
          ),
        auditInsert(ctx, {
          action: "member.updateRole",
          subjectType: "membership",
          subjectId: input.membershipId,
          meta: { userId: targetMembership.userId, from: targetMembership.role, to: input.role },
        }),
      ]);

      return { success: true };
    }),

  membersRemove: actionProcedure("member.remove")
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

      if (targetMembership.role === "owner") {
        if (ctx.role !== "owner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only an owner can remove an owner",
          });
        }
        await assertAnotherOwnerExists(ctx.db, ctx.companyId);
      }

      if (targetMembership.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      await atomicBatch(ctx.db, [
        ctx.db
          .delete(membership)
          .where(
            and(
              eq(membership.id, input.membershipId),
              eq(membership.companyId, ctx.companyId),
            ),
          ),
        auditInsert(ctx, {
          action: "member.remove",
          subjectType: "membership",
          subjectId: input.membershipId,
          meta: { userId: targetMembership.userId, role: targetMembership.role },
        }),
      ]);

      return { success: true };
    }),
});

/** A company must always keep at least one owner besides the one being changed. */
async function assertAnotherOwnerExists(db: OrrnDb, companyId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.role, "owner")));
  if ((row?.n ?? 0) <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A company needs at least one owner",
    });
  }
}
