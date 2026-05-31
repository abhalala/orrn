import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { company, impersonationGrant } from "@orrn/db/schema/tenant";
import { platformGuard, platformProcedure } from "../../index";

const DEFAULT_IMPERSONATION_TTL_MINUTES = 30;

export const impersonationProcedures = {
  impersonationCreateGrant: platformProcedure
    .input(
      z.object({
        companyId: z.string(),
        ttlMinutes: z
          .number()
          .int()
          .min(5)
          .max(480)
          .default(DEFAULT_IMPERSONATION_TTL_MINUTES),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db
        .select({ id: company.id, status: company.status })
        .from(company)
        .where(eq(company.id, input.companyId))
        .get();

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (target.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active companies can be impersonated",
        });
      }

      const grantId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + input.ttlMinutes * 60 * 1000);

      await ctx.db.insert(impersonationGrant).values({
        id: grantId,
        platformAdminId: ctx.session.user.id,
        companyId: input.companyId,
        expiresAt,
        reason: input.reason ?? null,
      });

      return { id: grantId, companyId: input.companyId, expiresAt };
    }),

  impersonationRevokeGrant: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const grant = await ctx.db
        .select()
        .from(impersonationGrant)
        .where(eq(impersonationGrant.id, input.id))
        .get();

      if (!grant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found" });
      }
      if (grant.platformAdminId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your grant" });
      }
      if (grant.revokedAt) {
        return { success: true };
      }

      await ctx.db
        .update(impersonationGrant)
        .set({ revokedAt: new Date() })
        .where(eq(impersonationGrant.id, input.id));

      return { success: true };
    }),

  impersonationListActive: platformGuard("platform.impersonate").query(
    async ({ ctx }) => {
      const now = new Date();
      const rows = await ctx.db
        .select({
          id: impersonationGrant.id,
          companyId: impersonationGrant.companyId,
          companyName: company.name,
          expiresAt: impersonationGrant.expiresAt,
          reason: impersonationGrant.reason,
          createdAt: impersonationGrant.createdAt,
        })
        .from(impersonationGrant)
        .innerJoin(company, eq(company.id, impersonationGrant.companyId))
        .where(
          and(
            eq(impersonationGrant.platformAdminId, ctx.session.user.id),
            isNull(impersonationGrant.revokedAt),
            gt(impersonationGrant.expiresAt, now),
          ),
        )
        .orderBy(desc(impersonationGrant.createdAt));

      return rows;
    },
  ),
};
