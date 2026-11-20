import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { spoolDeployment } from "@orrn/db/schema/spool";
import {
  company,
  companyStatus,
  impersonationGrant,
  membership,
  waitlistRequest,
} from "@orrn/db/schema/tenant";
import { normalizeModules } from "@orrn/domain";
import { atomicBatch } from "../../lib/atomic";
import { guardedBatch, ingestAbortUnlessChanged } from "../../lib/ingest/core";
import { auditInsert } from "../../lib/audit";
import { limitsPatchSql } from "../../lib/companySettings";
import { COMPANY_MODULES } from "../../lib/modules";
import { limitProblems, PLANT_LIMIT_KEYS, PLANT_LIMITS, setLimits, type PlantLimitKey } from "../../lib/plantLimits";
import { platformGuard } from "../../index";
import { auditListInput, listAudit } from "../audit";

/**
 * The outer company row's id, table-qualified. Drizzle renders `${company.id}`
 * as a bare "id" in a single-table select, which inside a correlated subquery
 * binds to the INNER table (membership.id, spool_deployment.id): every member
 * count came back 0.
 */
const outerCompanyId = sql`${company}.${sql.identifier(company.id.name)}`;

const memberCount = sql<number>`(
  select count(*) from ${membership}
  where ${membership.companyId} = ${outerCompanyId}
)`.mapWith(Number);

/** Status of the company's newest print station that is not turned off, or null (no label printing). */
const printingStatus = sql<"pending" | "active" | "offline" | null>`(
  select ${spoolDeployment.status} from ${spoolDeployment}
  where ${spoolDeployment.companyId} = ${outerCompanyId} and ${spoolDeployment.status} != 'revoked'
  order by ${spoolDeployment.createdAt} desc limit 1
)`;

/**
 * A company that `waitlist.submit` created for a request that was then
 * rejected. Reject now removes it (waitlistReject); this hides the ones
 * rejected before that, which are still `pending` with no members. Not a
 * company: never listed, counted or opened.
 */
export const LIMITS_MOVED = "Someone else changed these limits just now. Reload and save again.";

/**
 * True in SQL while each named limit is stored as `from` says, read the way `setLimits` reads it (a whole number of
 * at least 1, else not set). Keys must be `PLANT_LIMIT_KEYS` (plain names).
 */
export function limitsUnchangedSql(from: Record<string, number | null>): SQL {
  const parts = Object.entries(from).map(([key, was]) => {
    if (!(PLANT_LIMIT_KEYS as readonly string[]).includes(key)) throw new Error(`limit key ${key} is not known`);
    const v = sql.raw(`json_extract(coalesce(settings, '{}'), '$.limits.${key}')`);
    const usable = sql`(CASE WHEN json_type(coalesce(settings, '{}'), ${`$.limits.${key}`}) = 'integer' AND ${v} >= 1 THEN ${v} END)`;
    return was === null ? sql`${usable} IS NULL` : sql`${usable} = ${was}`;
  });
  return parts.length === 0 ? sql`1 = 1` : sql.join(parts, sql` AND `);
}

export const notRejectedRequest = sql`not (${company.status} = 'pending' and exists (
  select 1 from ${waitlistRequest}
  where ${waitlistRequest.companyId} = ${outerCompanyId} and ${waitlistRequest.status} = 'rejected'
) and not exists (
  select 1 from ${membership} where ${membership.companyId} = ${outerCompanyId}
))`;

const hasPrinting = sql`exists (
  select 1 from ${spoolDeployment}
  where ${spoolDeployment.companyId} = ${outerCompanyId} and ${spoolDeployment.status} != 'revoked'
)`;

export const companiesProcedures = {
  companiesList: platformGuard("platform.company.manage")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        search: z.string().trim().max(200).optional(),
        status: z.enum(companyStatus).optional(),
        /** Only companies with label printing set up (a print station that is not turned off). */
        printing: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [notRejectedRequest];
      if (input.status) {
        filters.push(eq(company.status, input.status));
      }
      if (input.search) {
        const q = `%${input.search}%`;
        filters.push(or(like(company.name, q), like(company.slug, q))!);
      }
      if (input.printing) {
        filters.push(hasPrinting);
      }
      const whereClause = and(...filters);

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
          memberCount,
          printing: printingStatus,
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

  companiesGet: platformGuard("platform.company.manage")
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
          settings: company.settings,
          createdAt: company.createdAt,
          updatedAt: company.updatedAt,
          memberCount,
        })
        .from(company)
        .where(and(eq(company.id, input.id), notRejectedRequest))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      // Only the limits leave; the rest of the plant's settings are not this page's business.
      const { settings, ...rest } = row;

      const grants = await ctx.db
        .select({
          id: impersonationGrant.id,
          platformAdminId: impersonationGrant.platformAdminId,
          expiresAt: impersonationGrant.expiresAt,
          revokedAt: impersonationGrant.revokedAt,
          reason: impersonationGrant.reason,
          createdAt: impersonationGrant.createdAt,
          staffName: user.name,
        })
        .from(impersonationGrant)
        .leftJoin(user, eq(user.id, impersonationGrant.platformAdminId))
        .where(eq(impersonationGrant.companyId, input.id))
        .orderBy(desc(impersonationGrant.createdAt))
        .limit(20);

      return { company: { ...rest, limits: setLimits(settings) }, recentGrants: grants };
    }),

  companiesSuspend: platformGuard("platform.company.manage")
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
      if (row.status === "pending") {
        // Never approved: it has no owner yet. Approve or reject its access request instead.
        throw new TRPCError({ code: "BAD_REQUEST", message: "This company is waiting for approval" });
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

  companiesReactivate: platformGuard("platform.company.manage")
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
      if (row.status === "pending") {
        // Reactivating would make an active company with no owner and no
        // sign-in email; only approving its access request may activate it.
        throw new TRPCError({ code: "BAD_REQUEST", message: "This company is waiting for approval" });
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

  updatePlanAndModules: platformGuard("platform.company.manage")
    .input(
      z.object({
        companyId: z.string(),
        plan: z.string().trim().min(1).max(40),
        // Known keys are checked (lower-cased, de-duplicated) by normalizeModules below, so an
        // unknown key answers "Unknown module: …" instead of a zod enum error.
        modules: z.array(z.string().trim().min(1).max(40)).max(COMPANY_MODULES.length * 2),
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

      // FP-PF-07: only known module keys, lower-cased and de-duplicated; empty = every module on.
      const { modules, unknown } = normalizeModules(input.modules);
      if (unknown.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown module: ${unknown.join(", ")}` });
      }
      const previous = Array.isArray(target.modules) ? target.modules : [];
      const modulesChanged = previous.length !== modules.length || previous.some((m, i) => m !== modules[i]);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(company)
          .set({
            plan: input.plan,
            modules,
          })
          .where(eq(company.id, input.companyId)),
        ...(modulesChanged || target.plan !== input.plan
          ? [
              auditInsert(
                { ...ctx, companyId: input.companyId },
                {
                  action: "platform.company.modules.update",
                  subjectType: "company",
                  subjectId: input.companyId,
                  meta: { from: previous, to: modules, planFrom: target.plan, planTo: input.plan },
                },
              ),
            ]
          : []),
      ]);

      return { success: true, modules };
    }),

  /**
   * The plant's limits (limits brief, section A; Limits section of /admin/companies/$id). `limits` names
   * only the keys to change: a whole number from 1 to the key's hard ceiling sets it, `null` removes it
   * ("Use default"). Unknown keys, values below 1, fractions and values above the ceiling are refused and
   * nothing is written. Written per key in SQL against the row as it is (`limitsPatchSql`), with one audit
   * row of the old and new values; a call that changes nothing writes nothing.
   */
  companiesSetLimits: platformGuard("platform.company.manage")
    .input(
      z.object({
        companyId: z.string().min(1).max(64),
        limits: z
          .record(z.string().max(40), z.number().nullable())
          .refine((r) => Object.keys(r).length <= PLANT_LIMIT_KEYS.length * 2, "Too many limits"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const problems = limitProblems(input.limits);
      if (problems.length > 0) {
        const words = problems.map((p) =>
          p.problem === "unknown"
            ? `Unknown limit: ${p.key}`
            : p.problem === "above_ceiling"
              ? `${p.key} can be at most ${PLANT_LIMITS[p.key as PlantLimitKey].ceiling}`
              : `${p.key} must be a whole number of at least 1`,
        );
        throw new TRPCError({ code: "BAD_REQUEST", message: words.join(". ") });
      }
      const target = await ctx.db
        .select({ id: company.id, settings: company.settings })
        .from(company)
        .where(eq(company.id, input.companyId))
        .get();
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      const before = setLimits(target.settings);
      const change: Record<string, number | null> = {};
      const from: Record<string, number | null> = {};
      const to: Record<string, number | null> = {};
      for (const key of PLANT_LIMIT_KEYS) {
        if (!(key in input.limits)) continue;
        const next = input.limits[key] ?? null;
        const was = before[key] ?? null;
        if (next === was) continue;
        change[key] = next;
        from[key] = was;
        to[key] = next;
      }
      if (Object.keys(change).length === 0) return { limits: before };

      // The audit's `from` is what the row held when this call read it; the write lands only while the row still holds
      // those values, so two staff saving the same key at once cannot both record the same old value (server N2).
      await guardedBatch(
        ctx.db,
        [
          ctx.db
            .update(company)
            .set({ settings: limitsPatchSql(change) })
            .where(and(eq(company.id, input.companyId), limitsUnchangedSql(from))),
          ingestAbortUnlessChanged(ctx.db),
          auditInsert(
            { ...ctx, companyId: input.companyId },
            {
              action: "platform.company.limits.update",
              subjectType: "company",
              subjectId: input.companyId,
              meta: { from, to },
            },
          ),
        ],
        { code: "CONFLICT", message: LIMITS_MOVED },
      );
      const after = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, input.companyId)).get();
      return { limits: setLimits(after?.settings ?? {}) };
    }),

  /**
   * One plant's audit trail for staff (the Audit tab of /admin/companies/$id): same filters and
   * paging as the plant's own viewer, read-only. Purchase figures are hidden, as for a plant role
   * without purchase access.
   */
  companiesAudit: platformGuard("platform.company.manage")
    .input(auditListInput.extend({ companyId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const { companyId, ...rest } = input;
      const target = await ctx.db.select({ id: company.id }).from(company).where(eq(company.id, companyId)).get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      return listAudit(ctx.db, companyId, rest, false);
    }),
};
