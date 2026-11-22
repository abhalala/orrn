/**
 * Tool room extras (XE parity lane ADM, rows 57-60, 62). Mounted as `toolRoom`, gated on `dies`.
 *
 * - `tooling.*` (#58): bolsters, backers, die rings, containers, liners, one row per piece, with size,
 *   place and status. Read by every member; written by the die room (`die.card`) or a manager.
 * - `inspections.*` (#59): a receive inspection, pass or fail with notes, for a die copy or a tooling
 *   piece that came from the maker. A failed copy cannot be issued (`dieIssue.issue` re-checks it in
 *   its own INSERT); a later pass clears it. A failed piece goes to `failed` until a pass.
 * - `copy` / `cost.*` (#57, #60): the die card's category, expected life, inspection and, for the
 *   people who see money, purchase cost and cost per kg extruded; a by-maker summary.
 * - `minStock.*`, `shortfalls` (#62): the fewest pieces of each type the plant wants; Today flags a
 *   type below it.
 * - `sections.setCategory` (#57): a section's die category (`profileKind` stays as it is).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { dieCopyExtra, plantMaster, toolInspection, toolingItem, toolingStatuses, toolingTypes } from "@orrn/db/schema/admin";
import { die } from "@orrn/db/schema/catalog";
import { dieInstance, dieMaker } from "@orrn/db/schema/dies";
import { pressRun } from "@orrn/db/schema/press";
import { company } from "@orrn/db/schema/tenant";
import {
  dieCostPerKgPaise,
  MAX_TOOLING_MIN,
  readToolingMinStock,
  TOOLING_COUNTED,
  toolingShortfalls,
  toolingStatusAfterInspection,
  type ToolingType,
} from "@orrn/domain";

import { anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { settingsPatchSql } from "../lib/companySettings";
import { canAny, type Action, type CompanyRole } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { assertMasterOfKind } from "./plantMasters";

const id = z.string().min(1).max(64);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
};

/** Who sees die cost (money): managers and the people who read the plant's numbers. */
const DIE_COST_READERS: readonly Action[] = ["masters.publish", "analytics.view"];
const meOf = (role: CompanyRole) => ({ company: { role }, isPlatformAdmin: false, platformRole: null });
const seesCost = (role: CompanyRole) => canAny(meOf(role), DIE_COST_READERS);

/** Statuses a piece may be put in by hand. `awaiting_inspection` and `failed` move only by an inspection. */
const HAND_STATUSES = ["in_store", "in_use", "at_maker", "retired"] as const;

function codeClash(e: unknown, code: string): void {
  const text = `${(e as Error)?.message ?? e} ${(e as { cause?: { message?: string } })?.cause?.message ?? ""}`;
  if (/tooling_item_live_code_unique|tooling_item\.company_id/i.test(text)) bad(`${code.trim()} is already a tooling piece here`);
}

async function producedG(db: OrrnDb, companyId: string, dieInstanceId: string): Promise<number> {
  const [row] = await db
    .select({ g: sql<number>`coalesce(sum(${pressRun.goodG}), 0)` })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.dieInstanceId, dieInstanceId), eq(pressRun.status, "logged")));
  return Number(row?.g ?? 0);
}

async function loadCopy(db: OrrnDb, companyId: string, copyId: string) {
  const [row] = await db
    .select({ id: dieInstance.id, code: dieInstance.code, sectionId: dieInstance.sectionId, status: dieInstance.status, dieMakerId: dieInstance.dieMakerId })
    .from(dieInstance)
    .where(and(eq(dieInstance.id, copyId), eq(dieInstance.companyId, companyId)))
    .limit(1);
  return row ?? notFound();
}

/** Held count per tooling type (the statuses that count as having one). */
async function heldByType(db: OrrnDb, companyId: string): Promise<Partial<Record<ToolingType, number>>> {
  const rows = await db
    .select({ type: toolingItem.type, n: sql<number>`count(*)` })
    .from(toolingItem)
    .where(and(eq(toolingItem.companyId, companyId), inArray(toolingItem.status, [...TOOLING_COUNTED])))
    .groupBy(toolingItem.type);
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

/** Tooling types below the plant's minimum (Today's flag). */
export async function toolingShortfallsFor(db: OrrnDb, companyId: string) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const min = readToolingMinStock(co?.settings?.toolingMinStock);
  if (Object.keys(min).length === 0) return [];
  return toolingShortfalls(min, await heldByType(db, companyId));
}

export const toolRoomRouter = router({
  tooling: router({
    list: companyProcedure
      .input(z.object({ type: z.enum(toolingTypes).optional(), status: z.enum(toolingStatuses).optional(), includeRetired: z.boolean().default(false) }).optional())
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: toolingItem.id,
            type: toolingItem.type,
            code: toolingItem.code,
            size: toolingItem.size,
            location: toolingItem.location,
            status: toolingItem.status,
            makerName: toolingItem.makerName,
            receivedAt: toolingItem.receivedAt,
            notes: toolingItem.notes,
          })
          .from(toolingItem)
          .where(
            and(
              eq(toolingItem.companyId, ctx.companyId),
              input?.type ? eq(toolingItem.type, input.type) : undefined,
              input?.status ? eq(toolingItem.status, input.status) : input?.includeRetired ? undefined : ne(toolingItem.status, "retired"),
            ),
          )
          .orderBy(asc(toolingItem.type), asc(toolingItem.code))
          .limit(1000);
      }),

    /**
     * Add a piece. A new piece from the maker waits for its receive inspection; a piece the plant
     * already holds can be added straight in store or in use.
     */
    create: anyActionProcedure("die.card", "masters.publish")
      .input(
        z.object({
          type: z.enum(toolingTypes),
          code: z.string().trim().min(1, "Give the piece its mark").max(40),
          size: optText(60),
          location: optText(60),
          makerName: optText(80),
          notes: optText(500),
          status: z.enum(["awaiting_inspection", "in_store", "in_use"]).default("awaiting_inspection"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const rowId = crypto.randomUUID();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const at = clockNow();
        try {
          await atomicBatch(ctx.db, [
            ctx.db.insert(toolingItem).values({
              id: rowId,
              companyId: ctx.companyId,
              serverSeq: seq,
              type: input.type,
              code: input.code,
              size: input.size,
              location: input.location,
              status: input.status,
              makerName: input.makerName,
              receivedAt: input.status === "awaiting_inspection" ? at : null,
              notes: input.notes,
              createdBy: ctx.session.user.id,
            }),
            auditInsert(ctx, { action: "tooling.create", subjectType: "tooling_item", subjectId: rowId, meta: { type: input.type, code: input.code, status: input.status } }),
          ]);
        } catch (e) {
          codeClash(e, input.code);
          throw e;
        }
        return { id: rowId };
      }),

    /** Size, place, notes, and status by hand (store, in use, at maker, retired). */
    update: anyActionProcedure("die.card", "masters.publish")
      .input(
        z.object({
          id,
          size: optText(60),
          location: optText(60),
          makerName: optText(80),
          notes: optText(500),
          status: z.enum(HAND_STATUSES).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(toolingItem)
          .where(and(eq(toolingItem.id, input.id), eq(toolingItem.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        if (input.status && input.status !== row.status && input.status !== "retired") {
          if (row.status === "awaiting_inspection") bad(`${row.code} is waiting for its receive inspection`);
          if (row.status === "failed") bad(`${row.code} failed its receive inspection; it needs a pass first`);
          if (row.status === "retired") bad(`${row.code} is retired`);
        }
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const status = input.status ?? row.status;
        await atomicBatch(ctx.db, [
          ctx.db
            .update(toolingItem)
            .set({ size: input.size, location: input.location, makerName: input.makerName, notes: input.notes, status, serverSeq: seq })
            .where(and(eq(toolingItem.id, row.id), eq(toolingItem.companyId, ctx.companyId), eq(toolingItem.status, row.status))),
          auditInsert(ctx, { action: "tooling.update", subjectType: "tooling_item", subjectId: row.id, meta: { code: row.code, from: row.status, to: status } }),
        ]);
        return { id: row.id, status };
      }),
  }),

  inspections: router({
    /** Inspections of one copy or piece, newest first. */
    list: companyProcedure
      .input(z.object({ subjectType: z.enum(["die_copy", "tooling"]), subjectId: id }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: toolInspection.id,
            result: toolInspection.result,
            notes: toolInspection.notes,
            inspectedBy: toolInspection.inspectedBy,
            inspectedAt: toolInspection.inspectedAt,
          })
          .from(toolInspection)
          .where(and(eq(toolInspection.companyId, ctx.companyId), eq(toolInspection.subjectType, input.subjectType), eq(toolInspection.subjectId, input.subjectId)))
          .orderBy(desc(toolInspection.inspectedAt), desc(toolInspection.id))
          .limit(50);
      }),

    /**
     * Record a receive inspection. A die copy: the result becomes the copy's inspection state (a fail
     * stops its issue, a later pass clears it). A tooling piece: pass puts it in store, fail marks it failed.
     */
    record: anyActionProcedure("die.card", "die.maker", "masters.publish")
      .input(
        z.object({
          subjectType: z.enum(["die_copy", "tooling"]),
          subjectId: id,
          result: z.enum(["pass", "fail"]),
          notes: optText(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.result === "fail" && !input.notes) bad("Say what failed");
        const rowId = crypto.randomUUID();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const at = clockNow();
        const userId = ctx.session.user.id;
        const insert = ctx.db.insert(toolInspection).values({
          id: rowId,
          companyId: ctx.companyId,
          serverSeq: seq,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          result: input.result,
          notes: input.notes,
          inspectedBy: userId,
          inspectedAt: at,
        });
        if (input.subjectType === "die_copy") {
          const copy = await loadCopy(ctx.db, ctx.companyId, input.subjectId);
          await atomicBatch(ctx.db, [
            insert,
            ctx.db
              .insert(dieCopyExtra)
              .values({ dieInstanceId: copy.id, companyId: ctx.companyId, serverSeq: seq, inspection: input.result, inspectionId: rowId, updatedBy: userId })
              .onConflictDoUpdate({
                target: dieCopyExtra.dieInstanceId,
                set: { inspection: input.result, inspectionId: rowId, serverSeq: seq, updatedBy: userId, updatedAt: at },
                where: eq(dieCopyExtra.companyId, ctx.companyId),
              }),
            auditInsert(ctx, { action: `die_copy.inspection.${input.result}`, subjectType: "die_instance", subjectId: copy.id, meta: { code: copy.code, inspectionId: rowId, notes: input.notes } }),
          ]);
          return { id: rowId };
        }
        const [piece] = await ctx.db
          .select({ id: toolingItem.id, code: toolingItem.code, status: toolingItem.status })
          .from(toolingItem)
          .where(and(eq(toolingItem.id, input.subjectId), eq(toolingItem.companyId, ctx.companyId)))
          .limit(1);
        if (!piece) return notFound();
        if (piece.status === "retired") bad(`${piece.code} is retired`);
        const next = toolingStatusAfterInspection(input.result);
        await atomicBatch(ctx.db, [
          insert,
          ctx.db
            .update(toolingItem)
            .set({ status: next, serverSeq: seq })
            .where(and(eq(toolingItem.id, piece.id), eq(toolingItem.companyId, ctx.companyId), ne(toolingItem.status, "retired"))),
          auditInsert(ctx, { action: `tooling.inspection.${input.result}`, subjectType: "tooling_item", subjectId: piece.id, meta: { code: piece.code, from: piece.status, to: next, inspectionId: rowId, notes: input.notes } }),
        ]);
        return { id: rowId };
      }),
  }),

  /**
   * The die card's extras for one copy: section category and its expected life, the latest receive
   * inspection, kg made, and (for the people who see money) purchase cost and cost per kg.
   */
  copy: companyProcedure.input(z.object({ dieInstanceId: id })).query(async ({ ctx, input }) => {
    const copy = await loadCopy(ctx.db, ctx.companyId, input.dieInstanceId);
    const [cat] = await ctx.db
      .select({ id: plantMaster.id, name: plantMaster.name, expectedLifeG: plantMaster.expectedLifeG })
      .from(die)
      .innerJoin(plantMaster, and(eq(plantMaster.id, die.dieCategoryId), eq(plantMaster.companyId, die.companyId)))
      .where(and(eq(die.id, copy.sectionId), eq(die.companyId, ctx.companyId)))
      .limit(1);
    const [extra] = await ctx.db
      .select({ costPaise: dieCopyExtra.costPaise, inspection: dieCopyExtra.inspection, inspectionId: dieCopyExtra.inspectionId })
      .from(dieCopyExtra)
      .where(and(eq(dieCopyExtra.dieInstanceId, copy.id), eq(dieCopyExtra.companyId, ctx.companyId)))
      .limit(1);
    const made = await producedG(ctx.db, ctx.companyId, copy.id);
    const cost = seesCost(ctx.role) ? (extra?.costPaise ?? null) : undefined;
    return {
      dieInstanceId: copy.id,
      category: cat ? { id: cat.id, name: cat.name, expectedLifeG: cat.expectedLifeG } : null,
      inspection: extra?.inspection ?? null,
      producedG: made,
      seesCost: cost !== undefined,
      costPaise: cost ?? null,
      costPerKgPaise: cost === undefined ? null : dieCostPerKgPaise(cost, made),
    };
  }),

  cost: router({
    /** Set or clear (null) a copy's purchase cost in paise. Managers only. */
    set: anyActionProcedure("masters.publish")
      .input(z.object({ dieInstanceId: id, costPaise: z.number().int().min(0).max(100_000_000_000).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const copy = await loadCopy(ctx.db, ctx.companyId, input.dieInstanceId);
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const userId = ctx.session.user.id;
        await atomicBatch(ctx.db, [
          ctx.db
            .insert(dieCopyExtra)
            .values({ dieInstanceId: copy.id, companyId: ctx.companyId, serverSeq: seq, costPaise: input.costPaise, updatedBy: userId })
            .onConflictDoUpdate({
              target: dieCopyExtra.dieInstanceId,
              set: { costPaise: input.costPaise, serverSeq: seq, updatedBy: userId, updatedAt: clockNow() },
              where: eq(dieCopyExtra.companyId, ctx.companyId),
            }),
          // The audit row names the copy, never the amount (audit is read wider than money).
          auditInsert(ctx, { action: "die_copy.cost", subjectType: "die_instance", subjectId: copy.id, meta: { code: copy.code, set: input.costPaise !== null } }),
        ]);
        return { dieInstanceId: copy.id };
      }),

    /**
     * Cost per kg by die maker: copies with a cost, their total cost, the good kg they made, and the
     * cost per kg over them. Copies without a maker group as "no maker".
     */
    byMaker: companyProcedure.query(async ({ ctx }) => {
      if (!seesCost(ctx.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      const made = ctx.db
        .select({ copyId: pressRun.dieInstanceId, g: sql<number>`sum(${pressRun.goodG})`.as("g") })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.status, "logged")))
        .groupBy(pressRun.dieInstanceId)
        .as("made");
      const rows = await ctx.db
        .select({
          makerId: dieInstance.dieMakerId,
          makerName: dieMaker.name,
          copies: sql<number>`count(*)`,
          costPaise: sql<number>`coalesce(sum(${dieCopyExtra.costPaise}), 0)`,
          producedG: sql<number>`coalesce(sum(${made.g}), 0)`,
        })
        .from(dieCopyExtra)
        .innerJoin(dieInstance, and(eq(dieInstance.id, dieCopyExtra.dieInstanceId), eq(dieInstance.companyId, dieCopyExtra.companyId)))
        .leftJoin(dieMaker, and(eq(dieMaker.id, dieInstance.dieMakerId), eq(dieMaker.companyId, dieInstance.companyId)))
        .leftJoin(made, eq(made.copyId, dieInstance.id))
        .where(and(eq(dieCopyExtra.companyId, ctx.companyId), sql`${dieCopyExtra.costPaise} is not null`))
        .groupBy(dieInstance.dieMakerId, dieMaker.name);
      return rows
        .map((r) => {
          const costPaise = Number(r.costPaise);
          const g = Number(r.producedG);
          return { makerId: r.makerId, makerName: r.makerName, copies: Number(r.copies), costPaise, producedG: g, costPerKgPaise: dieCostPerKgPaise(costPaise, g) };
        })
        .sort((a, b) => (a.costPerKgPaise ?? Number.MAX_SAFE_INTEGER) - (b.costPerKgPaise ?? Number.MAX_SAFE_INTEGER));
    }),
  }),

  minStock: router({
    get: companyProcedure.query(async ({ ctx }) => {
      const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
      return { min: readToolingMinStock(co?.settings?.toolingMinStock), held: await heldByType(ctx.db, ctx.companyId) };
    }),

    /** The fewest pieces of each type the plant wants (0 = no alert). Replaces the whole list. */
    set: anyActionProcedure("die.card", "masters.publish")
      .input(z.object({ min: z.partialRecord(z.enum(toolingTypes), z.number().int().min(0).max(MAX_TOOLING_MIN)) }))
      .mutation(async ({ ctx, input }) => {
        const value = readToolingMinStock(input.min);
        await atomicBatch(ctx.db, [
          ctx.db.update(company).set({ settings: settingsPatchSql({ toolingMinStock: value }) }).where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "tooling.min_stock", subjectType: "company", subjectId: ctx.companyId, meta: { min: value } }),
        ]);
        return { min: value };
      }),
  }),

  /** Tooling types below their minimum (the Today flag reads the same). */
  shortfalls: companyProcedure.query(async ({ ctx }) => toolingShortfallsFor(ctx.db, ctx.companyId)),

  sections: router({
    /** A section's die category (null clears). */
    setCategory: anyActionProcedure("die.card", "masters.publish")
      .input(z.object({ sectionId: id, categoryId: id.nullable() }))
      .mutation(async ({ ctx, input }) => {
        const [section] = await ctx.db
          .select({ id: die.id, sectionCode: die.sectionCode, dieCategoryId: die.dieCategoryId })
          .from(die)
          .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId)))
          .limit(1);
        if (!section) return notFound();
        await assertMasterOfKind(ctx.db, ctx.companyId, "die_category", input.categoryId);
        await atomicBatch(ctx.db, [
          ctx.db.update(die).set({ dieCategoryId: input.categoryId }).where(and(eq(die.id, section.id), eq(die.companyId, ctx.companyId))),
          auditInsert(ctx, { action: "die.category", subjectType: "die", subjectId: section.id, meta: { section: section.sectionCode, from: section.dieCategoryId, to: input.categoryId } }),
        ]);
        return { id: section.id };
      }),
  }),
});
