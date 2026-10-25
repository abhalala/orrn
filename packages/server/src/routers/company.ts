import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { bundle } from "@orrn/db/schema/inventory";
import { cast } from "@orrn/db/schema/foundry";
import { pressRun } from "@orrn/db/schema/press";
import { company, companyRoles, membership } from "@orrn/db/schema/tenant";
import {
  MAX_SHIFT_NAME,
  MAX_SHIFTS,
  MAX_STANDARD_TEXT,
  PACKING_LIST_SCOPES,
  SETTINGS_LOCALES,
  readFloorSettings,
  validateShifts,
  validateThresholds,
  type Shift,
  type ThresholdError,
} from "@orrn/domain";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now } from "../lib/clock";
import { companyTimezone, DEFAULT_TIMEZONE, isValidTimezone, monthStartMs, productionDayWindow, zonedYmd } from "../lib/dayWindow";
import { ageingSettingsInput } from "../lib/ageingContracts";
import { companyStandards, shiftErrorMessage, shiftGapMinutes } from "../lib/companySettings";
import { listActiveMemberships } from "../lib/tenantContext";
import { actionProcedure, authedProcedure, companyProcedure, router } from "../index";

const THRESHOLD_MESSAGES: Record<ThresholdError, string> = {
  drift_range: "Drift limits are between 0 and 100 %",
  drift_order: "The green drift limit must be below the amber limit",
  recovery_range: "Recovery limits are between 0 and 100 %",
  recovery_order: "The amber recovery minimum must be below the green minimum",
  balance_range: "The balance warning is between 0 and 100 %",
};

const bpInput = z.number().int().min(0).max(10_000);

const standardPair = z.object({
  standard: z.string().trim().max(MAX_STANDARD_TEXT),
  cml: z.string().trim().max(MAX_STANDARD_TEXT),
});

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
        /**
         * Default order kg tolerance in basis points (500 = 5 %) for customers without their own
         * (PL-8, Review Focus 5). Dispatching past ordered + tolerance needs a manager's approval.
         */
        orderToleranceBp: z.number().int().min(0).max(10_000).optional(),
        /** Packing list letterhead (PL v2 header): legal name, GSTIN, address, phone. */
        letterhead: z
          .object({
            legalName: z.string().trim().max(200).nullable().optional(),
            gstin: z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN is 15 letters and digits")
              .nullable()
              .optional(),
            address: z.string().trim().max(500).nullable().optional(),
            phone: z.string().trim().max(40).nullable().optional(),
          })
          .optional(),
        /**
         * Named shifts (FP-PF-05; C14). Replaces the whole list. A shift without an id is new and
         * gets one here; ids never change on rename or reorder (press runs keep `shift_id`).
         */
        shifts: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(64).optional(),
              name: z.string().trim().min(1).max(MAX_SHIFT_NAME),
              seq: z.number().int().min(1).max(MAX_SHIFTS * 2),
              startMin: z.number().int().min(0).max(1439),
              endMin: z.number().int().min(0).max(1439),
            }),
          )
          .max(MAX_SHIFTS * 2)
          .optional(),
        /** Commercial switches (FP-PF-06). Applied on the next request. */
        dieBands: z.boolean().optional(),
        priceOnSalesOrder: z.boolean().optional(),
        dieRequiredOnSalesOrder: z.boolean().optional(),
        portalEnabled: z.boolean().optional(),
        /** null = automatic (on after the first locked melt, FP-FD-16). */
        requireCastOnBundle: z.boolean().nullable().optional(),
        /** Die room (FP-DR-17): new copies and copies back from the maker start on trial. */
        dieRoom: z.object({ newCopyOnTrial: z.boolean() }).optional(),
        /** W3-AG-S: ageing switches (manualLoad, split, requireForPack, requireAgeing, requireAgeingSince). */
        ageing: ageingSettingsInput.optional(),
        /** Days from the order date to a new order's expected date (FP-OP-01, Q8). */
        orderLeadDays: z.number().int().min(0).max(120).optional(),
        /** The packing list's optional kg-per-piece column (FP-PK-13): off by default. */
        packingList: z
          .object({ kgPerPiece: z.boolean().optional(), scope: z.enum(PACKING_LIST_SCOPES).optional() })
          .optional(),
        /** Continue the cast book (FP-FD-02): only for a month with no cast yet. */
        castSeriesStart: z
          .object({
            period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month is YYYY-MM"),
            start: z.number().int().min(1).max(99_999),
          })
          .nullable()
          .optional(),
        /**
         * BIS designation and CM/L per profile kind (FP-PF-09). Partial: omitted kinds stay; a kind
         * sent as `{ standard: "", cml: "" }` clears it. Blank CM/L prints no licence line.
         */
        standards: z
          .object({ solid: standardPair.optional(), hollow: standardPair.optional(), semi: standardPair.optional() })
          .optional(),
        /**
         * The plant's own support contact shown on Settings > About (FP-PF-14). Partial: only the
         * fields sent change, a blank field clears it, and a stored `email` is left alone.
         */
        support: z
          .object({
            name: z.string().trim().max(100).nullable().optional(),
            phone: z.string().trim().max(40).nullable().optional(),
            hours: z.string().trim().max(100).nullable().optional(),
          })
          .optional(),
        /** Company default language (FP-PF-13); the device's `orrn.locale` wins when set. */
        locale: z.enum(SETTINGS_LOCALES).optional(),
        /**
         * Thresholds (rank 31), in basis points (100 bp = 1 %). Drift: green up to `driftGreenMaxBp`,
         * amber up to `driftAmberMaxBp`, red above (green < amber; one sent alone is checked against
         * the stored other). Recovery bands for the press report: green at or above `greenMinBp`,
         * amber at or above `amberMinBp` (amber < green); null clears them (no colour).
         * `pressBalanceWarnBp`: a run's balance past this share of its input is flagged.
         */
        driftGreenMaxBp: bpInput.optional(),
        driftAmberMaxBp: bpInput.optional(),
        recoveryBands: z.object({ greenMinBp: bpInput, amberMinBp: bpInput }).nullable().optional(),
        pressBalanceWarnBp: bpInput.optional(),
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
      if (input.orderToleranceBp !== undefined) patch.orderToleranceBp = input.orderToleranceBp;
      if (input.letterhead !== undefined) {
        const current = (row.settings?.letterhead ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(input.letterhead)) {
          if (v !== undefined) next[k] = v === "" ? null : v;
        }
        patch.letterhead = next;
      }
      if (input.support !== undefined) {
        const current = (row.settings?.support ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(input.support)) {
          if (v !== undefined) next[k] = v === "" ? null : v;
        }
        patch.support = next;
      }
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
      for (const key of ["dieBands", "priceOnSalesOrder", "dieRequiredOnSalesOrder", "portalEnabled", "locale"] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      if (input.requireCastOnBundle !== undefined) patch.requireCastOnBundle = input.requireCastOnBundle;
      if (input.dieRoom !== undefined) {
        patch.dieRoom = { ...((row.settings?.dieRoom ?? {}) as Record<string, unknown>), newCopyOnTrial: input.dieRoom.newCopyOnTrial };
      }
      if (input.orderLeadDays !== undefined) patch.orderLeadDays = input.orderLeadDays;
      if (input.ageing !== undefined) {
        const was = readFloorSettings(row.settings).ageing;
        const next = { ...was, ...Object.fromEntries(Object.entries(input.ageing).filter(([, v]) => v !== undefined)) };
        // Review m4: turning requireAgeing on with no day would strand every bundle in the yard; the day
        // defaults to today on the plant clock, so bundles packed before it still dispatch.
        if (next.requireAgeing && !next.requireAgeingSince) {
          const ymd = zonedYmd(companyTimezone(row.settings ?? {}), now().getTime());
          next.requireAgeingSince = `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
        }
        patch.ageing = { ...((row.settings?.ageing ?? {}) as Record<string, unknown>), ...next };
      }
      if (input.packingList !== undefined) {
        patch.packingList = {
          ...((row.settings?.packingList ?? {}) as Record<string, unknown>),
          ...(input.packingList.kgPerPiece !== undefined ? { kgPerPiece: input.packingList.kgPerPiece } : {}),
          ...(input.packingList.scope !== undefined ? { scope: input.packingList.scope } : {}),
        };
      }
      if (input.standards !== undefined) {
        const current = readFloorSettings(row.settings).standards;
        const next: Record<string, { standard: string; cml: string }> = { ...current };
        for (const [kind, pair] of Object.entries(input.standards)) {
          if (!pair) continue;
          if (pair.standard === "" && pair.cml === "") delete next[kind];
          else next[kind] = { standard: pair.standard, cml: pair.cml };
        }
        patch.standards = next;
      }
      if (input.driftGreenMaxBp !== undefined || input.driftAmberMaxBp !== undefined || input.recoveryBands !== undefined || input.pressBalanceWarnBp !== undefined) {
        const floor = readFloorSettings(row.settings);
        const drift = {
          greenMaxBp: input.driftGreenMaxBp ?? floor.drift.greenMaxBp,
          amberMaxBp: input.driftAmberMaxBp ?? floor.drift.amberMaxBp,
        };
        const problems = validateThresholds({
          drift: input.driftGreenMaxBp !== undefined || input.driftAmberMaxBp !== undefined ? drift : undefined,
          recoveryBands: input.recoveryBands,
          balanceWarnBp: input.pressBalanceWarnBp,
        });
        if (problems.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: problems.map((p) => THRESHOLD_MESSAGES[p]).join(". ") });
        }
        if (input.driftGreenMaxBp !== undefined || input.driftAmberMaxBp !== undefined) {
          patch.driftGreenMaxBp = drift.greenMaxBp;
          patch.driftAmberMaxBp = drift.amberMaxBp;
        }
        if (input.recoveryBands !== undefined) patch.recoveryBands = input.recoveryBands;
        if (input.pressBalanceWarnBp !== undefined) {
          patch.press = { ...((row.settings?.press ?? {}) as Record<string, unknown>), balanceWarnBp: input.pressBalanceWarnBp };
        }
      }
      if (input.castSeriesStart !== undefined) {
        if (input.castSeriesStart !== null) {
          const [year, month] = input.castSeriesStart.period.split("-").map(Number) as [number, number];
          const used = await ctx.db
            .select({ id: cast.id })
            .from(cast)
            .where(and(eq(cast.companyId, ctx.companyId), eq(cast.year, year), eq(cast.month, month)))
            .limit(1)
            .get();
          if (used) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That month already has a cast; the book can only be continued before the first cast",
            });
          }
        }
        patch.castSeriesStart = input.castSeriesStart;
      }
      if (input.shifts !== undefined) {
        patch.shifts = await checkedShifts(ctx.db, ctx.companyId, input.shifts, readFloorSettings(row.settings).shifts);
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

  /**
   * The plant's settings for screens and clients (FP-PF-05/06/09/13): the floor settings (tolerant
   * reader, defaults filled), the as-built keys, modules and today's production day. Not secret:
   * no spool keys (columns, not settings) and no backup keys.
   */
  getSettings: companyProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ settings: company.settings, modules: company.modules })
      .from(company)
      .where(eq(company.id, ctx.companyId))
      .get();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    const raw = row.settings ?? {};
    const floor = readFloorSettings(raw);
    const day = productionDayWindow(raw, now().getTime());
    return {
      ...floor,
      lengthUnit: raw.lengthUnit === "inch" ? ("inch" as const) : ("mm" as const),
      timezone: day.timezone,
      bundleNumbering: raw.bundleNumbering === "plant" ? ("plant" as const) : ("legacy" as const),
      plSeries: (raw.plSeries ?? null) as { prefix: string; start: number } | null,
      dcTolerancePct: typeof raw.dcTolerancePct === "number" ? raw.dcTolerancePct : null,
      orderToleranceBp: typeof raw.orderToleranceBp === "number" ? raw.orderToleranceBp : null,
      castSeriesStart: floor.castSeriesStart,
      modules: Array.isArray(row.modules) ? row.modules : [],
      productionDay: {
        day: day.productionDay,
        startMs: day.startMs,
        endMs: day.endMs,
        shiftsSet: day.shiftsSet,
        shift: day.shift,
      },
    };
  }),

  /**
   * BIS designation and CM/L per profile kind, resolved for pack labels and certificates
   * (FP-PF-09): semi falls back to solid, a null kind uses solid, blank CM/L = no licence line.
   */
  standards: companyProcedure.query(async ({ ctx }) => {
    return companyStandards(ctx.db, ctx.companyId);
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

type ShiftInput = { id?: string; name: string; seq: number; startMin: number; endMin: number };

/**
 * FP-PF-05 rules on a submitted shift list: ids for new shifts, every validateShifts rule (a gap
 * names the missing minutes), and a shift any press run cites cannot be deleted.
 */
async function checkedShifts(db: OrrnDb, companyId: string, input: ShiftInput[], stored: Shift[]): Promise<Shift[]> {
  const shifts: Shift[] = input.map((s) => ({
    id: s.id ?? crypto.randomUUID(),
    name: s.name.trim(),
    seq: s.seq,
    startMin: s.startMin,
    endMin: s.endMin,
  }));
  const errors = validateShifts(shifts);
  if (errors.length > 0) {
    const gap = errors.includes("gap_or_overlap") ? shiftGapMinutes(shifts) : null;
    throw new TRPCError({ code: "BAD_REQUEST", message: shiftErrorMessage(errors[0]!, gap) });
  }
  const kept = new Set(shifts.map((s) => s.id));
  const removed = stored.filter((s) => !kept.has(s.id));
  if (removed.length > 0) {
    const cited = await db
      .select({ shiftId: pressRun.shiftId })
      .from(pressRun)
      .where(and(eq(pressRun.companyId, companyId), inArray(pressRun.shiftId, removed.map((s) => s.id))))
      .limit(1)
      .get();
    if (cited) {
      const name = removed.find((s) => s.id === cited.shiftId)?.name ?? "";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Shift ${name} has press runs; rename it instead of deleting it`,
      });
    }
  }
  return shifts;
}

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
