import { eq } from "drizzle-orm";
import { z } from "zod";

import { company } from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { createAuth } from "@orrn/auth";

import { authedProcedure, router } from "../index";

/**
 * Single source of truth for client-side identity + tenancy.
 *
 * Web and native clients call `auth.me` once via the route guard / app shell,
 * and read role + company + platform flag from the returned shape rather than
 * piecing it together from `authClient.useSession()`.
 */
export const authRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const userRow = await ctx.db
      .select({
        onboardingCompleted: user.onboardingCompleted,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.id, userId))
      .get();

    const companyRow =
      ctx.membership && ctx.companyId
        ? (
            await ctx.db
              .select({
                id: company.id,
                name: company.name,
                slug: company.slug,
                status: company.status,
                plan: company.plan,
                modules: company.modules,
              })
              .from(company)
              .where(eq(company.id, ctx.companyId))
              .limit(1)
          )[0] ?? null
        : null;

    return {
      user: {
        id: userId,
        name: ctx.session.user.name,
        email: ctx.session.user.email,
        image: ctx.session.user.image ?? null,
        onboardingCompleted: userRow?.onboardingCompleted ?? false,
        twoFactorEnabled: userRow?.twoFactorEnabled ?? false,
      },
      company:
        companyRow && ctx.role
          ? {
              id: companyRow.id,
              name: companyRow.name,
              slug: companyRow.slug,
              status: companyRow.status,
              plan: companyRow.plan,
              modules: companyRow.modules ?? [],
              role: ctx.role,
            }
          : null,
      isPlatformAdmin: ctx.isPlatformAdmin,
      impersonation: ctx.impersonation
        ? {
            actorUserId: ctx.impersonation.actorUserId,
            companyId: ctx.impersonation.companyId,
            grantId: ctx.impersonation.grantId,
            expiresAt: ctx.impersonation.expiresAt.toISOString(),
          }
        : null,
    };
  }),

  setPassword: authedProcedure
    .input(z.object({ password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const auth = createAuth();
      await auth.api.setPassword({
        body: {
          newPassword: input.password,
        },
        headers: ctx.request.headers,
      });

      return { success: true };
    }),

  completeOnboarding: authedProcedure
    .input(
      z.object({
        facilityLocation: z.string().min(1),
        primaryContact: z.string().min(1),
        timezone: z.string().min(1),
        pressCount: z.number().int().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(user)
          .set({ onboardingCompleted: true })
          .where(eq(user.id, userId));

        if (ctx.companyId) {
          const currentCompany = await tx
            .select()
            .from(company)
            .where(eq(company.id, ctx.companyId))
            .get();

          if (currentCompany) {
            const currentSettings = currentCompany.settings ?? {};
            const updatedSettings = {
              ...currentSettings,
              facilityLocation: input.facilityLocation,
              primaryContact: input.primaryContact,
              timezone: input.timezone,
              pressCount: input.pressCount,
            };

            await tx
              .update(company)
              .set({ settings: updatedSettings })
              .where(eq(company.id, ctx.companyId));
          }
        }
      });

      return { success: true };
    }),
});
