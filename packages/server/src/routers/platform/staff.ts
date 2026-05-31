import { TRPCError } from "@trpc/server";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  platformAdmin,
  platformStaffRoles,
  type PlatformStaffRole,
} from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { createPlatformStaffAccount } from "../../lib/create-platform-staff";
import { assignablePlatformRoles, canAssignPlatformRole } from "../../lib/permissions";
import { platformGuard, platformProcedure } from "../../index";

export const staffProcedures = {
  staffList: platformGuard("platform.staff.list").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        userId: platformAdmin.userId,
        role: platformAdmin.role,
        createdAt: platformAdmin.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(platformAdmin)
      .innerJoin(user, eq(user.id, platformAdmin.userId))
      .orderBy(desc(platformAdmin.createdAt));

    return rows;
  }),

  staffCreate: platformGuard("platform.staff.create")
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().email(),
        password: z.string().min(12).max(128),
        role: z.enum(platformStaffRoles),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorRole = ctx.platformRole as PlatformStaffRole;
      if (!canAssignPlatformRole(actorRole, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot assign this staff role",
        });
      }

      const { userId } = await createPlatformStaffAccount(ctx.db, {
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.role,
        createdByUserId: ctx.session.user.id,
      });

      return { userId, role: input.role };
    }),

  staffUpdateRole: platformGuard("platform.staff.updateRole")
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(platformStaffRoles),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own staff role",
        });
      }

      const actorRole = ctx.platformRole as PlatformStaffRole;
      if (!canAssignPlatformRole(actorRole, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot assign this staff role",
        });
      }

      const target = await ctx.db
        .select({ role: platformAdmin.role })
        .from(platformAdmin)
        .where(eq(platformAdmin.userId, input.userId))
        .get();

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff account not found",
        });
      }

      if (!canAssignPlatformRole(actorRole, target.role as PlatformStaffRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot modify this staff account",
        });
      }

      await ctx.db
        .update(platformAdmin)
        .set({ role: input.role })
        .where(eq(platformAdmin.userId, input.userId));

      return { success: true };
    }),

  staffRemove: platformGuard("platform.staff.remove")
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove your own staff account",
        });
      }

      const actorRole = ctx.platformRole as PlatformStaffRole;
      const target = await ctx.db
        .select({ role: platformAdmin.role })
        .from(platformAdmin)
        .where(eq(platformAdmin.userId, input.userId))
        .get();

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff account not found",
        });
      }

      if (!canAssignPlatformRole(actorRole, target.role as PlatformStaffRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot remove this staff account",
        });
      }

      const superAdminCount = await ctx.db
        .select({ count: count() })
        .from(platformAdmin)
        .where(eq(platformAdmin.role, "super_admin"))
        .get();

      if (
        target.role === "super_admin" &&
        (superAdminCount?.count ?? 0) <= 1
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the last super admin",
        });
      }

      await ctx.db
        .delete(platformAdmin)
        .where(eq(platformAdmin.userId, input.userId));

      return { success: true };
    }),

  staffAssignableRoles: platformProcedure.query(({ ctx }) => {
    return assignablePlatformRoles(ctx.platformRole as PlatformStaffRole);
  }),
};
