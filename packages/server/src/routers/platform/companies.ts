import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  company,
  companyStatus,
  impersonationGrant,
  membership,
} from "@orrn/db/schema/tenant";
import { platformProcedure } from "../../index";

export const companiesProcedures = {
  companiesList: platformProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        search: z.string().trim().optional(),
        status: z.enum(companyStatus).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.status) {
        filters.push(eq(company.status, input.status));
      }
      if (input.search) {
        const q = `%${input.search}%`;
        filters.push(or(like(company.name, q), like(company.slug, q))!);
      }
      const whereClause = filters.length ? and(...filters) : undefined;

      const [totalRow] = await ctx.db
        .select({ count: count() })
        .from(company)
        .where(whereClause);

      const rows = await ctx.db
        .select({
          id: company.id,
          name: company.name,
          slug: company.slug,
          status: company.status,
          plan: company.plan,
          createdAt: company.createdAt,
          memberCount: sql<number>`(
            select count(*) from ${membership}
            where ${membership.companyId} = ${company.id}
          )`.mapWith(Number),
        })
        .from(company)
        .where(whereClause)
        .orderBy(desc(company.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        items: rows,
        total: totalRow?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  companiesGet: platformProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({
          id: company.id,
          name: company.name,
          slug: company.slug,
          status: company.status,
          plan: company.plan,
          modules: company.modules,
          createdAt: company.createdAt,
          updatedAt: company.updatedAt,
          memberCount: sql<number>`(
            select count(*) from ${membership}
            where ${membership.companyId} = ${company.id}
          )`.mapWith(Number),
        })
        .from(company)
        .where(eq(company.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      const grants = await ctx.db
        .select({
          id: impersonationGrant.id,
          platformAdminId: impersonationGrant.platformAdminId,
          expiresAt: impersonationGrant.expiresAt,
          revokedAt: impersonationGrant.revokedAt,
          reason: impersonationGrant.reason,
          createdAt: impersonationGrant.createdAt,
        })
        .from(impersonationGrant)
        .where(eq(impersonationGrant.companyId, input.id))
        .orderBy(desc(impersonationGrant.createdAt))
        .limit(20);

      return { company: row, recentGrants: grants };
    }),

  companiesSuspend: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, input.id))
        .get();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (row.status === "suspended") {
        return { success: true };
      }
      await ctx.db
        .update(company)
        .set({ status: "suspended" })
        .where(eq(company.id, input.id));
      return { success: true };
    }),

  companiesReactivate: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, input.id))
        .get();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (row.status === "active") {
        return { success: true };
      }
      await ctx.db
        .update(company)
        .set({ status: "active" })
        .where(eq(company.id, input.id));
      return { success: true };
    }),

  updatePlanAndModules: platformProcedure
    .input(
      z.object({
        companyId: z.string(),
        plan: z.string(),
        modules: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, input.companyId))
        .get();

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      await ctx.db
        .update(company)
        .set({
          plan: input.plan,
          modules: input.modules,
        })
        .where(eq(company.id, input.companyId));

      return { success: true };
    }),
};
