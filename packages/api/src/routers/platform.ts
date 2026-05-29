import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  company,
  companyStatus,
  impersonationGrant,
  membership,
  platformAdmin,
  platformStaffRoles,
  waitlistRequest,
  type PlatformStaffRole,
} from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { env } from "@orrn/env/server";
import { createAuth } from "@orrn/auth";

import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { createPlatformStaffAccount } from "../lib/create-platform-staff";
import { assignablePlatformRoles, can, canAssignPlatformRole } from "../lib/permissions";
import { platformGuard, platformProcedure, router } from "../index";

const DEFAULT_IMPERSONATION_TTL_MINUTES = 30;

export const platformRouter = router({
  /**
   * Aggregated counts + recent rows for the staff console home page. Every
   * field is gated by the caller's platform role so a support agent doesn't
   * leak counts they aren't allowed to act on. One round-trip per scope using
   * Promise.all to keep Worker wall time bounded.
   */
  overview: platformProcedure.query(async ({ ctx }) => {
    const me = {
      company: null,
      isPlatformAdmin: true,
      platformRole: ctx.platformRole,
    };

    const canCompanies = can(me, "platform.company.manage");
    const canWaitlist = can(me, "platform.waitlist.review");
    const canStaff = can(me, "platform.staff.list");

    const [companyCounts, waitlistPendingRow, staffCountRow, recentCompanies, recentWaitlist] =
      await Promise.all([
        canCompanies
          ? ctx.db
              .select({ status: company.status, count: count() })
              .from(company)
              .groupBy(company.status)
          : Promise.resolve([] as { status: string; count: number }[]),
        canWaitlist
          ? ctx.db
              .select({ count: count() })
              .from(waitlistRequest)
              .where(eq(waitlistRequest.status, "pending"))
              .get()
          : Promise.resolve(undefined),
        canStaff
          ? ctx.db.select({ count: count() }).from(platformAdmin).get()
          : Promise.resolve(undefined),
        canCompanies
          ? ctx.db
              .select({
                id: company.id,
                name: company.name,
                slug: company.slug,
                status: company.status,
                plan: company.plan,
                createdAt: company.createdAt,
              })
              .from(company)
              .orderBy(desc(company.createdAt))
              .limit(5)
          : Promise.resolve([] as Array<{
              id: string;
              name: string;
              slug: string;
              status: string;
              plan: string | null;
              createdAt: Date;
            }>),
        canWaitlist
          ? ctx.db
              .select({
                id: waitlistRequest.id,
                companyName: waitlistRequest.companyName,
                requesterEmail: waitlistRequest.requesterEmail,
                requesterName: waitlistRequest.requesterName,
                createdAt: waitlistRequest.createdAt,
              })
              .from(waitlistRequest)
              .where(eq(waitlistRequest.status, "pending"))
              .orderBy(desc(waitlistRequest.createdAt))
              .limit(5)
          : Promise.resolve([] as Array<{
              id: string;
              companyName: string;
              requesterEmail: string;
              requesterName: string;
              createdAt: Date;
            }>),
      ]);

    const byStatus = new Map(companyCounts.map((r) => [r.status, r.count]));
    const companiesActive = byStatus.get("active") ?? 0;
    const companiesSuspended = byStatus.get("suspended") ?? 0;
    const companiesTotal = Array.from(byStatus.values()).reduce((sum, n) => sum + n, 0);

    return {
      companies: canCompanies
        ? {
            total: companiesTotal,
            active: companiesActive,
            suspended: companiesSuspended,
            recent: recentCompanies,
          }
        : null,
      waitlist: canWaitlist
        ? {
            pending: waitlistPendingRow?.count ?? 0,
            recent: recentWaitlist,
          }
        : null,
      staff: canStaff
        ? {
            total: staffCountRow?.count ?? 0,
          }
        : null,
    };
  }),

  waitlistList: platformGuard("platform.waitlist.review").query(async ({ ctx }) => {
    return ctx.db.select().from(waitlistRequest).where(eq(waitlistRequest.status, "pending")).all();
  }),

  waitlistApprove: platformGuard("platform.waitlist.review")
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

      const companyId = request.companyId ?? crypto.randomUUID();
      const webBase = (env.WEB_ERP_URL ?? env.CORS_ORIGIN).replace(/\/$/, "");

      const companyExists = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, companyId))
        .get();

      const existingUser = await ctx.db
        .select()
        .from(user)
        .where(eq(user.email, request.requesterEmail))
        .get();

      const userId = existingUser?.id ?? crypto.randomUUID();

      const existingMembership = existingUser
        ? await ctx.db
            .select()
            .from(membership)
            .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
            .get()
        : null;

      const batchStatements: SqliteBatchItem[] = [
        ctx.db
          .update(waitlistRequest)
          .set({ status: "approved", reviewedBy: ctx.session.user.id, reviewedAt: new Date() })
          .where(eq(waitlistRequest.id, input.id)),
      ];

      if (companyExists) {
        batchStatements.push(
          ctx.db.update(company).set({ status: "active" }).where(eq(company.id, companyId)),
        );
      } else {
        const slugBase = request.companyName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        const slug = `${slugBase || "company"}-${crypto.randomUUID().split("-")[0]}`;
        batchStatements.push(
          ctx.db.insert(company).values({
            id: companyId,
            name: request.companyName.trim(),
            slug,
            status: "active",
            settings: {},
            modules: [],
          }),
        );
      }

      if (!existingUser) {
        batchStatements.push(
          ctx.db.insert(user).values({
            id: userId,
            name: request.requesterName,
            email: request.requesterEmail,
            emailVerified: true,
            onboardingCompleted: false,
          }),
        );
      }

      if (!existingMembership) {
        batchStatements.push(
          ctx.db.insert(membership).values({
            id: crypto.randomUUID(),
            userId,
            companyId,
            role: "owner",
          }),
        );
      }

      await atomicBatch(ctx.db, batchStatements);

      const auth = createAuth();
      await auth.api.signInMagicLink({
        body: {
          email: request.requesterEmail,
          callbackURL: `${webBase}/setup-credentials`,
        },
        headers: ctx.request.headers,
      });

      return { success: true };
    }),

  updatePlanAndModules: platformProcedure
    .input(
      z.object({
        companyId: z.string(),
        plan: z.string(),
        modules: z.array(z.string()),
      })
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

  impersonationListActive: platformGuard("platform.impersonate").query(async ({ ctx }) => {
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
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign this staff role" });
      }

      const target = await ctx.db
        .select({ role: platformAdmin.role })
        .from(platformAdmin)
        .where(eq(platformAdmin.userId, input.userId))
        .get();

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found" });
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found" });
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

      if (target.role === "super_admin" && (superAdminCount?.count ?? 0) <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the last super admin",
        });
      }

      await ctx.db.delete(platformAdmin).where(eq(platformAdmin.userId, input.userId));

      return { success: true };
    }),

  staffAssignableRoles: platformProcedure.query(({ ctx }) => {
    return assignablePlatformRoles(ctx.platformRole as PlatformStaffRole);
  }),
});
