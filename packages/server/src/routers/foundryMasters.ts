/**
 * Foundry masters (FP-FD-01 furnace, FP-FD-09 alloy limits; W2-FD-S). Published with
 * `masters.publish` (manager, admin, owner; C40: no draft step for furnaces), read by any member
 * (the melt stepper's pickers). Codes never change after create (melts and casts point at the row);
 * a furnace or alloy is retired, never deleted. Limits are integer ppm (0.45 % = 4500); a spectro
 * result snapshots the limits in force when it was attached, so a later edit rewrites no verdict.
 */
import { ALLOY_LIMIT_SEEDS, FOUNDRY_LINE_MAX_G, FURNACE_SEED, PPM_TOTAL, SPECTRO_ELEMENTS } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { alloy, alloyLimit, foundryMasterStatuses, furnace, type AlloyRow, type FurnaceRow } from "@orrn/db/schema/foundry";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { isUniqueViolation } from "../lib/foundry";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const code = (max: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^[A-Za-z0-9-]{1,${max}}$`), "Letters, digits and dashes only")
    .transform((s) => s.toUpperCase());
const name = z.string().trim().min(1, "Give a name").max(60);
const ppm = z.number().int().min(0).max(PPM_TOTAL);
const limitRow = z.object({ element: z.enum(SPECTRO_ELEMENTS), minPpm: ppm.nullable(), maxPpm: ppm.nullable() });
export type AlloyLimitInput = z.infer<typeof limitRow>;

export const FURNACE_EXISTS = "A furnace with that code exists";
export const ALLOY_EXISTS = "An alloy with that code exists";
const FURNACE_NOT_FOUND = { code: "NOT_FOUND", message: "Furnace not found" } as const;
const ALLOY_NOT_FOUND = { code: "NOT_FOUND", message: "Alloy not found" } as const;

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Limits: each element at most once, min ≤ max (a null side has no bound). */
export function checkLimits(rows: readonly AlloyLimitInput[]) {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.element)) bad("An element is listed twice");
    seen.add(r.element);
    if (r.minPpm != null && r.maxPpm != null && r.minPpm > r.maxPpm) bad("A minimum is above its maximum");
  }
}

function limitRows(companyId: string, alloyId: string, seq: number, userId: string | null, rows: readonly AlloyLimitInput[]) {
  const at = new Date();
  return rows
    .filter((r) => r.minPpm != null || r.maxPpm != null)
    .map((r) => ({
      id: crypto.randomUUID(),
      companyId,
      serverSeq: seq,
      alloyId,
      element: r.element,
      minPpm: r.minPpm,
      maxPpm: r.maxPpm,
      createdBy: userId,
      createdAt: at,
      updatedAt: at,
    }));
}

export async function loadFurnace(db: OrrnDb, companyId: string, furnaceId: string): Promise<FurnaceRow> {
  const [row] = await db
    .select()
    .from(furnace)
    .where(and(eq(furnace.id, furnaceId), eq(furnace.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError(FURNACE_NOT_FOUND);
  return row;
}

export async function loadAlloy(db: OrrnDb, companyId: string, alloyId: string): Promise<AlloyRow> {
  const [row] = await db
    .select()
    .from(alloy)
    .where(and(eq(alloy.id, alloyId), eq(alloy.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError(ALLOY_NOT_FOUND);
  return row;
}

/** The alloy's limits, element order (si … cr, al). */
export async function limitsOf(db: OrrnDb, companyId: string, alloyId: string) {
  const rows = await db
    .select({ element: alloyLimit.element, minPpm: alloyLimit.minPpm, maxPpm: alloyLimit.maxPpm })
    .from(alloyLimit)
    .where(and(eq(alloyLimit.companyId, companyId), eq(alloyLimit.alloyId, alloyId)));
  return rows.sort((a, b) => SPECTRO_ELEMENTS.indexOf(a.element) - SPECTRO_ELEMENTS.indexOf(b.element));
}

/**
 * Statements that create a seeded alloy (6063 / 6061, spec E4 limits the owner confirms, Q-FD-1).
 * Callers add only codes the company does not have; a racing create fails on (company, code).
 */
export function seedAlloyStatements(db: OrrnDb, companyId: string, codeText: "6063" | "6061", alloyId: string, seq: number, userId: string | null): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [
    db
      .insert(alloy)
      .values({ id: alloyId, companyId, serverSeq: seq, code: codeText, name: `Alloy ${codeText}`, status: "active", sortOrder: codeText === "6063" ? 1 : 2, createdBy: userId }),
  ];
  pushChunkedInserts(out, (rows) => db.insert(alloyLimit).values(rows), limitRows(companyId, alloyId, seq, userId, ALLOY_LIMIT_SEEDS[codeText]));
  return out;
}

const furnacesRouter = router({
  /** Every furnace (active first), with capacity and billet diameter. Any member. */
  list: companyProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select({
        id: furnace.id,
        code: furnace.code,
        name: furnace.name,
        capacityG: furnace.capacityG,
        billetDiaMm: furnace.billetDiaMm,
        status: furnace.status,
        sortOrder: furnace.sortOrder,
      })
      .from(furnace)
      .where(eq(furnace.companyId, ctx.companyId))
      .orderBy(asc(furnace.status), asc(furnace.sortOrder), asc(furnace.code));
    return { items };
  }),

  /** F1, 6 t, 127 mm (Q-FD-8, Q27) for a plant with no furnace yet. */
  seedDefaults: actionProcedure("masters.publish").mutation(async ({ ctx }) => {
    const [any] = await ctx.db.select({ id: furnace.id }).from(furnace).where(eq(furnace.companyId, ctx.companyId)).limit(1);
    if (any) return { added: 0 };
    const rowId = crypto.randomUUID();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ctx.db
        .insert(furnace)
        .values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, ...FURNACE_SEED, status: "active", sortOrder: 1, createdBy: ctx.session.user.id })
        .onConflictDoNothing(),
      auditInsert(ctx, { action: "foundry.furnace.create", subjectType: "furnace", subjectId: rowId, meta: { ...FURNACE_SEED, seeded: true } }),
    ]);
    return { added: 1 };
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        code: code(12),
        name,
        capacityG: z.number().int().min(1_000).max(FOUNDRY_LINE_MAX_G),
        billetDiaMm: z.number().int().min(25).max(500).nullable().default(null),
        sortOrder: z.number().int().min(0).max(10_000).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(furnace).values({ id: rowId, companyId: ctx.companyId, serverSeq: seq, ...input, status: "active", createdBy: ctx.session.user.id }),
          auditInsert(ctx, { action: "foundry.furnace.create", subjectType: "furnace", subjectId: rowId, meta: input }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e, "furnace.company_id, furnace.code")) throw new TRPCError({ code: "CONFLICT", message: FURNACE_EXISTS });
        throw e;
      }
      return { id: rowId, code: input.code };
    }),

  /** Rename, re-rate, retire or bring back. The code never changes; a retired furnace cannot be picked for a melt. */
  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id,
        name: name.optional(),
        capacityG: z.number().int().min(1_000).max(FOUNDRY_LINE_MAX_G).optional(),
        billetDiaMm: z.number().int().min(25).max(500).nullable().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
        status: z.enum(foundryMasterStatuses).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadFurnace(ctx.db, ctx.companyId, input.id);
      const { id: _id, ...patch } = input;
      const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(changed).length === 0) return { id: before.id };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(furnace)
          .set({ ...changed, serverSeq: seq })
          .where(and(eq(furnace.id, before.id), eq(furnace.companyId, ctx.companyId))),
        auditInsert(ctx, {
          action: "foundry.furnace.update",
          subjectType: "furnace",
          subjectId: before.id,
          meta: { code: before.code, before: { name: before.name, capacityG: before.capacityG, billetDiaMm: before.billetDiaMm, status: before.status }, after: changed },
        }),
      ]);
      return { id: before.id };
    }),
});

const alloysRouter = router({
  /** Every alloy with its limits (ppm). Any member: the cast and melt pickers and the spectro screen read it. */
  list: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(alloy)
      .where(eq(alloy.companyId, ctx.companyId))
      .orderBy(asc(alloy.status), asc(alloy.sortOrder), asc(alloy.code));
    const limits =
      rows.length === 0
        ? []
        : await ctx.db
            .select({ alloyId: alloyLimit.alloyId, element: alloyLimit.element, minPpm: alloyLimit.minPpm, maxPpm: alloyLimit.maxPpm })
            .from(alloyLimit)
            .where(and(eq(alloyLimit.companyId, ctx.companyId), inArray(alloyLimit.alloyId, rows.slice(0, 90).map((r) => r.id))));
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        note: r.note,
        sortOrder: r.sortOrder,
        limits: limits
          .filter((l) => l.alloyId === r.id)
          .map(({ alloyId: _a, ...l }) => l)
          .sort((a, b) => SPECTRO_ELEMENTS.indexOf(a.element) - SPECTRO_ELEMENTS.indexOf(b.element)),
      })),
    };
  }),

  /** 6063 and 6061 with the seeded limits (spec E4) for a plant that has neither; existing codes are untouched. */
  seedDefaults: actionProcedure("masters.publish").mutation(async ({ ctx }) => {
    const have = new Set(
      (await ctx.db.select({ code: alloy.code }).from(alloy).where(eq(alloy.companyId, ctx.companyId))).map((r) => r.code),
    );
    const missing = (["6063", "6061"] as const).filter((c) => !have.has(c));
    if (missing.length === 0) return { added: 0 };
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [];
    for (const c of missing) {
      const alloyId = crypto.randomUUID();
      statements.push(...seedAlloyStatements(ctx.db, ctx.companyId, c, alloyId, seq, ctx.session.user.id));
      statements.push(auditInsert(ctx, { action: "foundry.alloy.create", subjectType: "alloy", subjectId: alloyId, meta: { code: c, seeded: true } }));
    }
    try {
      await atomicBatch(ctx.db, statements);
    } catch (e) {
      if (isUniqueViolation(e, "alloy.company_id, alloy.code")) throw new TRPCError({ code: "CONFLICT", message: ALLOY_EXISTS });
      throw e;
    }
    return { added: missing.length };
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        code: code(12),
        name,
        note: z.string().trim().max(500).optional(),
        sortOrder: z.number().int().min(0).max(10_000).default(0),
        limits: z.array(limitRow).max(SPECTRO_ELEMENTS.length).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      checkLimits(input.limits);
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(alloy).values({
          id: rowId,
          companyId: ctx.companyId,
          serverSeq: seq,
          code: input.code,
          name: input.name,
          note: input.note || null,
          sortOrder: input.sortOrder,
          status: "active",
          createdBy: ctx.session.user.id,
        }),
      ];
      pushChunkedInserts(statements, (rows) => ctx.db.insert(alloyLimit).values(rows), limitRows(ctx.companyId, rowId, seq, ctx.session.user.id, input.limits));
      statements.push(auditInsert(ctx, { action: "foundry.alloy.create", subjectType: "alloy", subjectId: rowId, meta: { code: input.code, name: input.name, limits: input.limits } }));
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isUniqueViolation(e, "alloy.company_id, alloy.code")) throw new TRPCError({ code: "CONFLICT", message: ALLOY_EXISTS });
        throw e;
      }
      return { id: rowId, code: input.code };
    }),

  update: actionProcedure("masters.publish")
    .input(z.object({ id, name: name.optional(), note: z.string().trim().max(500).nullable().optional(), status: z.enum(foundryMasterStatuses).optional(), sortOrder: z.number().int().min(0).max(10_000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const before = await loadAlloy(ctx.db, ctx.companyId, input.id);
      const { id: _id, ...patch } = input;
      const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(changed).length === 0) return { id: before.id };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(alloy)
          .set({ ...changed, serverSeq: seq })
          .where(and(eq(alloy.id, before.id), eq(alloy.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "foundry.alloy.update", subjectType: "alloy", subjectId: before.id, meta: { code: before.code, before: { name: before.name, note: before.note, status: before.status }, after: changed } }),
      ]);
      return { id: before.id };
    }),

  /**
   * Replace an alloy's limits (FP-FD-09). Elements left out lose their limits. Results already
   * attached keep the limits they were judged by (snapshot); only later attaches use the new ones.
   */
  setLimits: actionProcedure("masters.publish")
    .input(z.object({ alloyId: id, limits: z.array(limitRow).max(SPECTRO_ELEMENTS.length) }))
    .mutation(async ({ ctx, input }) => {
      checkLimits(input.limits);
      const a = await loadAlloy(ctx.db, ctx.companyId, input.alloyId);
      const before = await limitsOf(ctx.db, ctx.companyId, a.id);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const kept = input.limits.filter((r) => r.minPpm != null || r.maxPpm != null);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .delete(alloyLimit)
          .where(
            and(
              eq(alloyLimit.companyId, ctx.companyId),
              eq(alloyLimit.alloyId, a.id),
              kept.length > 0 ? sql`${alloyLimit.element} not in (${sql.join(kept.map((r) => sql`${r.element}`), sql`, `)})` : undefined,
            ),
          ),
        ctx.db.update(alloy).set({ serverSeq: seq }).where(and(eq(alloy.id, a.id), eq(alloy.companyId, ctx.companyId))),
      ];
      for (const r of limitRows(ctx.companyId, a.id, seq, ctx.session.user.id, kept)) {
        statements.push(
          ctx.db
            .insert(alloyLimit)
            .values(r)
            .onConflictDoUpdate({ target: [alloyLimit.alloyId, alloyLimit.element], set: { minPpm: r.minPpm, maxPpm: r.maxPpm, serverSeq: seq, updatedAt: r.updatedAt } }),
        );
      }
      statements.push(auditInsert(ctx, { action: "foundry.alloy.limits", subjectType: "alloy", subjectId: a.id, meta: { code: a.code, before, after: kept } }));
      await atomicBatch(ctx.db, statements);
      return { id: a.id, limits: await limitsOf(ctx.db, ctx.companyId, a.id) };
    }),
});

/** Other active furnaces besides this one (for "exactly one furnace" defaults). */
export async function activeFurnaces(db: OrrnDb, companyId: string, exceptId?: string) {
  return db
    .select()
    .from(furnace)
    .where(and(eq(furnace.companyId, companyId), eq(furnace.status, "active"), exceptId ? ne(furnace.id, exceptId) : undefined))
    .orderBy(asc(furnace.sortOrder), asc(furnace.code))
    .limit(5);
}

export const foundryMastersRouter = { furnaces: furnacesRouter, alloys: alloysRouter };
