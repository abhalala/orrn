import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { bundle } from "@orrn/db/schema/inventory";
import { company, companyRoles, membership } from "@orrn/db/schema/tenant";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now } from "../lib/clock";
import { DEFAULT_TIMEZONE, isValidTimezone, monthStartMs } from "../lib/dayWindow";
import { listActiveMemberships } from "../lib/tenantContext";
import { actionProcedure, authedProcedure, companyProcedure, router } from "../index";

export const companyRouter = router({
  /**
   * Make `companyId` this user's default active company (spec P10). Requires a
   * membership in an active company there; anything else is a generic NOT_FOUND.
   * Clients may also send `x-orrn-company` per request; without it the company
   * switched to last is active.
   */
  switch: authedProcedure
    .input(z.object({ companyId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const target = (await listActiveMemberships(ctx.db, userId)).find((m) => m.companyId === input.companyId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }

      await atomicBatch(ctx.db, [
        ctx.db
          .update(membership)
          // Strictly later than any earlier switch, so two switches in one millisecond still order.
          .set({
            lastActiveAt: sql`max(${Date.now()}, coalesce((select max(m2.last_active_at) from ${membership} m2 where m2.user_id = ${userId}), 0) + 1)`,
          })
          .where(and(eq(membership.id, target.id), eq(membership.userId, userId))),
        auditInsert(
          { ...ctx, companyId: target.companyId },
          {
            action: "company.switch",
            subjectType: "membership",
            subjectId: target.id,
            meta: { from: ctx.companyId, to: target.companyId },
          },
        ),
      ]);

      return { companyId: target.companyId, name: target.name, role: target.role };
    }),

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

  updateSettings: actionProcedure("settings.update")
    .input(
      z.object({
        lengthUnit: z.enum(["mm", "inch"]).optional(),
        timezone: z
          .string()
          .max(100)
          .refine(isValidTimezone, "Unknown timezone")
          .optional(),
        /** Bundle number style (spec P7). Switching mid-month would mix styles; see the guard below. */
        bundleNumbering: z.enum(["plant", "legacy"]).optional(),
        /** The plant's PL book: printed before the FY and the first sequence number of each new FY. */
        plSeries: z
          .object({
            prefix: z.string().max(12).regex(/^\S*$/, "No spaces in the prefix"),
            start: z.number().int().positive().max(999_999_999),
          })
          .optional(),
        /**
         * Scrap D/C note tolerance (spec P14) in basis points of the party weight, despite the
         * name: 50 = 0.5 % (the default). A lot short by more needs a debit note before OK.
         */
        dcTolerancePct: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ settings: company.settings })
        .from(company)
        .where(eq(company.id, ctx.companyId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }

      const patch: Record<string, unknown> = {};
      if (input.lengthUnit !== undefined) patch.lengthUnit = input.lengthUnit;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (input.plSeries !== undefined) patch.plSeries = input.plSeries;
      if (input.dcTolerancePct !== undefined) patch.dcTolerancePct = input.dcTolerancePct;
      if (input.bundleNumbering !== undefined) {
        patch.bundleNumbering = input.bundleNumbering;
        const current = row.settings?.bundleNumbering === "plant" ? "plant" : "legacy";
        // Platform staff (impersonating) may switch at any time; the plant's own admin only when no
        // bundle has been created this month, so one month never mixes BG serials and plant numbers.
        if (input.bundleNumbering !== current && !(ctx.isPlatformAdmin && ctx.impersonation)) {
          const tz = typeof row.settings?.timezone === "string" && isValidTimezone(row.settings.timezone)
            ? row.settings.timezone
            : DEFAULT_TIMEZONE;
          const [{ n } = { n: 0 }] = await ctx.db
            .select({ n: count() })
            .from(bundle)
            .where(and(eq(bundle.companyId, ctx.companyId), gte(bundle.createdAt, new Date(monthStartMs(tz, now().getTime())))));
          if (n > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Bundle numbering can only be changed in a month with no bundles yet. Ask support to switch it now.",
            });
          }
        }
      }
      const settings = { ...(row.settings ?? {}), ...patch };

      await atomicBatch(ctx.db, [
        ctx.db.update(company).set({ settings }).where(eq(company.id, ctx.companyId)),
        auditInsert(ctx, {
          action: "company.settings.update",
          subjectType: "company",
          subjectId: ctx.companyId,
          meta: { changed: patch, previous: Object.fromEntries(Object.keys(patch).map((k) => [k, (row.settings ?? {})[k] ?? null])) },
        }),
      ]);

      return { settings };
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
