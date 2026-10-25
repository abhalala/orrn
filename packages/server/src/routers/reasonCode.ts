/**
 * Reason-code masters (BACKLOG 40, C39): ONE `reason_code` table with a `kind`. Reading is open to
 * every member (the station pickers use `press.reasons`); writing is a master (`masters.publish`).
 * A code is never deleted, only retired (`active` false), so history keeps its reason. `other` is
 * fixed in every kind: it always exists, always asks for a note, always sorts last and cannot be
 * renamed or retired. A code's key is made once from its English wording and never changes on rename.
 * Hindi and Gujarati wording is typed per code (blank = the built-in translation of a standard code,
 * else the English).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { reasonCode } from "@orrn/db/schema/reasons";
import { REASON_CODE_KINDS } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { ensureDefaultReasonCodes, hasStandardWording } from "../lib/reasonCodes";
import { nextCompanySeq } from "../lib/sequence";

const kind = z.enum(REASON_CODE_KINDS);
const id = z.string().min(1).max(64);
const wording = z.string().trim().min(1, "Give the wording").max(80);
const translation = z
  .string()
  .trim()
  .max(80)
  .nullish()
  .transform((v) => (v ? v : null));

const OTHER = "other";
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

/** `Cooling water low` -> `cooling_water_low`; a wording with no Latin letters or digits gets `code_<hash>`. */
export function reasonCodeKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (slug) return slug;
  let h = 5381;
  for (const ch of label) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `code_${h.toString(36)}`;
}

async function load(db: Parameters<typeof ensureDefaultReasonCodes>[0], companyId: string, codeId: string) {
  const [row] = await db
    .select()
    .from(reasonCode)
    .where(and(eq(reasonCode.id, codeId), eq(reasonCode.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Reason not found" });
  return row;
}

export const reasonCodeRouter = router({
  /** Every code (retired included) of one kind or all kinds, in picker order, `other` last. */
  list: companyProcedure.input(z.object({ kind: kind.optional() }).optional()).query(async ({ ctx, input }) => {
    await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
    const rows = await ctx.db
      .select({
        id: reasonCode.id,
        kind: reasonCode.kind,
        code: reasonCode.code,
        label: reasonCode.label,
        labelHi: reasonCode.labelHi,
        labelGu: reasonCode.labelGu,
        requiresNote: reasonCode.requiresNote,
        active: reasonCode.active,
        sortOrder: reasonCode.sortOrder,
      })
      .from(reasonCode)
      .where(and(eq(reasonCode.companyId, ctx.companyId), input?.kind ? eq(reasonCode.kind, input.kind) : undefined))
      .orderBy(asc(reasonCode.kind), asc(reasonCode.sortOrder), asc(reasonCode.code));
    return rows.map((r) => ({ ...r, standard: hasStandardWording(r.kind, r.code, r.label) }));
  }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        kind,
        label: wording,
        labelHi: translation,
        labelGu: translation,
        requiresNote: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
      const base = reasonCodeKey(input.label);
      if (base === OTHER) bad("Other already exists and is fixed");
      const rows = await ctx.db
        .select({ id: reasonCode.id, code: reasonCode.code, sortOrder: reasonCode.sortOrder })
        .from(reasonCode)
        .where(and(eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, input.kind)));
      const taken = new Set(rows.map((r) => r.code));
      let code = base;
      for (let n = 2; taken.has(code); n += 1) code = `${base}_${n}`.slice(0, 48);
      // New codes go before `other`, which stays last.
      const last = rows.filter((r) => r.code !== OTHER).reduce((m, r) => Math.max(m, r.sortOrder), 0);
      const other = rows.find((r) => r.code === OTHER);
      const rowId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(reasonCode).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            kind: input.kind,
            code,
            label: input.label,
            labelHi: input.labelHi,
            labelGu: input.labelGu,
            requiresNote: input.requiresNote,
            active: true,
            sortOrder: last + 1,
            createdBy: ctx.session.user.id,
          }),
          ...(other
            ? [ctx.db.update(reasonCode).set({ sortOrder: last + 2, serverSeq: seq }).where(and(eq(reasonCode.id, other.id), eq(reasonCode.companyId, ctx.companyId)))]
            : []),
          auditInsert(ctx, {
            action: "reason_code.create",
            subjectType: "reason_code",
            subjectId: rowId,
            meta: { kind: input.kind, code, label: input.label, labelHi: input.labelHi, labelGu: input.labelGu, requiresNote: input.requiresNote },
          }),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: reason_code/i.test(String((e as Error)?.message ?? e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That reason was just added; open the list again" });
        }
        throw e;
      }
      return { id: rowId, code };
    }),

  /** New wording (English, Hindi, Gujarati) for a code. The key stays. `null` clears a translation. */
  rename: actionProcedure("masters.publish")
    .input(
      z.object({
        id,
        label: wording,
        /** undefined = leave as it is; null or "" = clear. */
        labelHi: z.string().trim().max(80).nullish().transform((v) => (v === undefined ? undefined : v ? v : null)),
        labelGu: z.string().trim().max(80).nullish().transform((v) => (v === undefined ? undefined : v ? v : null)),
        requiresNote: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await load(ctx.db, ctx.companyId, input.id);
      if (row.code === OTHER) bad("Other is fixed; it cannot be changed");
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const set = {
        label: input.label,
        ...(input.labelHi !== undefined ? { labelHi: input.labelHi } : {}),
        ...(input.labelGu !== undefined ? { labelGu: input.labelGu } : {}),
        ...(input.requiresNote !== undefined ? { requiresNote: input.requiresNote } : {}),
        serverSeq: seq,
      };
      await atomicBatch(ctx.db, [
        ctx.db.update(reasonCode).set(set).where(and(eq(reasonCode.id, row.id), eq(reasonCode.companyId, ctx.companyId), ne(reasonCode.code, OTHER))),
        auditInsert(ctx, {
          action: "reason_code.rename",
          subjectType: "reason_code",
          subjectId: row.id,
          meta: {
            kind: row.kind,
            code: row.code,
            from: { label: row.label, labelHi: row.labelHi, labelGu: row.labelGu, requiresNote: row.requiresNote },
            to: { label: input.label, labelHi: set.labelHi ?? row.labelHi, labelGu: set.labelGu ?? row.labelGu, requiresNote: set.requiresNote ?? row.requiresNote },
          },
        }),
      ]);
      return { id: row.id };
    }),

  /** Retire or bring back. Retired codes leave the pickers; history keeps them. */
  setActive: actionProcedure("masters.publish")
    .input(z.object({ id, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const row = await load(ctx.db, ctx.companyId, input.id);
      if (row.code === OTHER) bad("Other is fixed; it cannot be retired");
      if (row.active === input.active) return { id: row.id, changed: false };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(reasonCode)
          .set({ active: input.active, serverSeq: seq })
          .where(and(eq(reasonCode.id, row.id), eq(reasonCode.companyId, ctx.companyId), ne(reasonCode.code, OTHER), sql`${reasonCode.active} <> ${input.active ? 1 : 0}`)),
        auditInsert(ctx, {
          action: input.active ? "reason_code.reactivate" : "reason_code.retire",
          subjectType: "reason_code",
          subjectId: row.id,
          meta: { kind: row.kind, code: row.code },
        }),
      ]);
      return { id: row.id, changed: true };
    }),
});
