import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { hashPassword } from "@orrn/auth/password";
import { account, user } from "@orrn/db/schema/auth";
import { company } from "@orrn/db/schema/tenant";
import { createAuth } from "@orrn/auth";
import type { LengthUnit } from "../lib/length";

import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
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
        mustChangePassword: user.mustChangePassword,
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
                settings: company.settings,
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
        mustChangePassword: userRow?.mustChangePassword ?? false,
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
              settings: (companyRow.settings ?? {}) as { lengthUnit?: LengthUnit; [key: string]: unknown },
            }
          : null,
      isPlatformAdmin: ctx.isPlatformAdmin,
      platformRole: ctx.platformRole,
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

      await atomicBatch(ctx.db, [
        ctx.db
          .update(user)
          .set({ mustChangePassword: false })
          .where(eq(user.id, ctx.session.user.id)),
        auditInsert(ctx, {
          action: "auth.password_set",
          subjectType: "user",
          subjectId: ctx.session.user.id,
        }),
      ]);

      return { success: true };
    }),

  /**
   * Force-change flow for users provisioned with a temporary password.
   * The user has a live session (signed in with the temp password) and is
   * required to rotate it before reaching any protected screen.
   *
   * Bypasses Better Auth's `changePassword` (which would need the current
   * password) by writing directly to the credential row, then atomically
   * clearing `must_change_password` and emitting an audit row.
   */
  changeInitialPassword: authedProcedure
    .input(z.object({ newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const credential = await ctx.db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
        .get();

      if (!credential) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No credential account found for this user",
        });
      }

      const hashed = await hashPassword(input.newPassword);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(account.id, credential.id)),
        ctx.db
          .update(user)
          .set({ mustChangePassword: false })
          .where(eq(user.id, userId)),
        auditInsert(ctx, {
          action: "auth.password_force_change",
          subjectType: "user",
          subjectId: userId,
        }),
      ]);

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

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(user)
          .set({ onboardingCompleted: true })
          .where(eq(user.id, userId)),
      ];

      if (ctx.companyId) {
        const currentCompany = await ctx.db
          .select()
          .from(company)
          .where(eq(company.id, ctx.companyId))
          .get();

        if (currentCompany) {
          const currentSettings = currentCompany.settings ?? {};
          statements.push(
            ctx.db
              .update(company)
              .set({
                settings: {
                  ...currentSettings,
                  facilityLocation: input.facilityLocation,
                  primaryContact: input.primaryContact,
                  timezone: input.timezone,
                  pressCount: input.pressCount,
                },
              })
              .where(eq(company.id, ctx.companyId)),
          );
        }
      }

      await atomicBatch(ctx.db, statements);

      return { success: true };
    }),
});
