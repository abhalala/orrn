import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  company,
  companyStatus,
  impersonationGrant,
  invite,
  membership,
  waitlistRequest,
} from "@orrn/db/schema/tenant";
import { env } from "@orrn/env/server";

import { sendEmail } from "../lib/email";
import { platformProcedure, router } from "../index";

const DEFAULT_IMPERSONATION_TTL_MINUTES = 30;

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
      const tokenHash = await crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(token))
        .then((b) =>
          Array.from(new Uint8Array(b))
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
        );
      const slug =
        request.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") +
        "-" +
        crypto.randomUUID().split("-")[0];

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
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedBy: ctx.session.user.id,
        });
      });

      const webBase = env.CORS_ORIGIN.replace(/\/$/, "");
      const inviteUrl = `${webBase}/invite/${token}`;

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
      const row = await ctx.db.select().from(company).where(eq(company.id, input.id)).get();
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
      const row = await ctx.db.select().from(company).where(eq(company.id, input.id)).get();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (row.status === "active") {
        return { success: true };
      }
      await ctx.db.update(company).set({ status: "active" }).where(eq(company.id, input.id));
      return { success: true };
    }),

  impersonationCreateGrant: platformProcedure
    .input(
      z.object({
        companyId: z.string(),
        ttlMinutes: z.number().int().min(5).max(480).default(DEFAULT_IMPERSONATION_TTL_MINUTES),
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

  impersonationListActive: platformProcedure.query(async ({ ctx }) => {
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
    }),
});
