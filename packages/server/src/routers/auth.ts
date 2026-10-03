import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";

import { hashPassword } from "@orrn/auth/password";
import { account, session as sessionTable, user } from "@orrn/db/schema/auth";
import { company } from "@orrn/db/schema/tenant";
import { createAuth } from "@orrn/auth";
import type { LengthUnit } from "../lib/length";

import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { can } from "../lib/permissions";
import { listActiveMemberships } from "../lib/tenantContext";
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

    const memberships = (await listActiveMemberships(ctx.db, userId)).map((m) => ({
      companyId: m.companyId,
      name: m.name,
      role: m.role,
    }));

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
      /** Every active company this user belongs to, most recent first (spec P10). */
      memberships,
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
      // First password for a magic-link account only. Better Auth refuses a
      // second one with a generic 500; say CONFLICT so the welcome stepper can
      // move on instead of showing a crash (Task 17).
      const existing = await ctx.db
        .select({ id: account.id })
        .from(account)
        .where(
          and(
            eq(account.userId, ctx.session.user.id),
            eq(account.providerId, "credential"),
            isNotNull(account.password),
          ),
        )
        .get();
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A password is already set for this account" });
      }

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
   * clearing `must_change_password`, revoking every other session of the user
   * and emitting an audit row.
   *
   * Only callable while `must_change_password` is set: otherwise any stolen
   * session could rotate the password without knowing the current one.
   */
  changeInitialPassword: authedProcedure
    .input(z.object({ newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const flagRow = await ctx.db
        .select({ mustChangePassword: user.mustChangePassword })
        .from(user)
        .where(eq(user.id, userId))
        .get();
      if (!flagRow?.mustChangePassword) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Password change is not required for this account",
        });
      }

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
      const currentSessionId = ctx.session.session?.id;

      await atomicBatch(ctx.db, [
        ctx.db
          .update(account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(account.id, credential.id)),
        ctx.db
          .update(user)
          .set({ mustChangePassword: false })
          .where(eq(user.id, userId)),
        // Revoke every other session (e.g. whoever knew the temporary
        // password); keep the one performing the change.
        currentSessionId
          ? ctx.db
              .delete(sessionTable)
              .where(and(eq(sessionTable.userId, userId), ne(sessionTable.id, currentSessionId)))
          : ctx.db.delete(sessionTable).where(eq(sessionTable.userId, userId)),
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
        facilityLocation: z.string().trim().min(1).max(200).optional(),
        primaryContact: z.string().trim().min(1).max(64).optional(),
        timezone: z.string().trim().min(1).max(64).optional(),
        pressCount: z.number().int().min(0).max(500).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Company fields (facility, contact, timezone, press count) are company
      // settings: only roles that may update settings write them, and they
      // must send them. Everyone else just marks their own onboarding done and
      // may send nothing (the welcome stepper's last step); company inputs are
      // ignored for them.
      const canWriteCompany = Boolean(
        ctx.companyId &&
          can({ company: ctx.role ? { role: ctx.role } : null, isPlatformAdmin: false }, "settings.update"),
      );
      if (canWriteCompany && (!input.facilityLocation || !input.primaryContact || !input.timezone)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Location, contact phone and time zone are required",
        });
      }

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(user)
          .set({ onboardingCompleted: true })
          .where(eq(user.id, userId)),
      ];

      if (canWriteCompany && ctx.companyId) {
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
            auditInsert(ctx, {
              action: "settings.update",
              subjectType: "company",
              subjectId: ctx.companyId,
              meta: { via: "onboarding" },
            }),
          );
        }
      }

      await atomicBatch(ctx.db, statements);

      return { success: true };
    }),
});
