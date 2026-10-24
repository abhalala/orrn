/**
 * Transporter master (FP-PK-11/12). A vehicle is not a master: its number and capacity live on the
 * dispatch. Reading is open to every member (the dispatch screen picks one); writing is a master
 * (`masters.publish`). A transporter is never deleted, only retired (`active` false); a dispatch
 * keeps the name it was given (`dispatch.transporter_name`), so a rename never rewrites a sent PL.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { transporter } from "@orrn/db/schema/dispatch";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { nextCompanySeq } from "../lib/sequence";
import type { OrrnDb } from "../lib/atomic";

const name = z.string().trim().min(1, "Name is required").max(120);
const phone = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || /^[+0-9 ()-]{6,20}$/.test(v), "Phone: digits, spaces, + ( ) -")
  .nullable()
  .optional();

/** Another live transporter of the company with the same name (case-insensitive)? */
async function nameTaken(db: OrrnDb, companyId: string, value: string, exceptId?: string) {
  const [row] = await db
    .select({ id: transporter.id })
    .from(transporter)
    .where(
      and(
        eq(transporter.companyId, companyId),
        eq(transporter.active, true),
        sql`lower(${transporter.name}) = lower(${value})`,
        exceptId ? ne(transporter.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const transporterRouter = router({
  list: companyProcedure
    .input(z.object({ includeRetired: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select({
          id: transporter.id,
          name: transporter.name,
          phone: transporter.phone,
          active: transporter.active,
          updatedAt: transporter.updatedAt,
        })
        .from(transporter)
        .where(and(eq(transporter.companyId, ctx.companyId), input?.includeRetired ? undefined : eq(transporter.active, true)))
        .orderBy(asc(transporter.name))
        .limit(500);
      return { items };
    }),

  create: actionProcedure("masters.publish")
    .input(z.object({ name, phone }))
    .mutation(async ({ ctx, input }) => {
      if (await nameTaken(ctx.db, ctx.companyId, input.name)) {
        throw new TRPCError({ code: "CONFLICT", message: `Transporter ${input.name} already exists` });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db.insert(transporter).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          name: input.name,
          phone: input.phone || null,
          active: true,
          createdBy: ctx.session.user.id,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          { action: "transporter.create", subjectType: "transporter", subjectId: id, meta: { name: input.name } },
        ),
      ]);
      return { id };
    }),

  update: actionProcedure("masters.publish")
    .input(z.object({ id: z.string().min(1), name: name.optional(), phone, active: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(transporter)
        .where(and(eq(transporter.id, input.id), eq(transporter.companyId, ctx.companyId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Transporter not found" });
      const nextName = input.name ?? existing.name;
      const nextActive = input.active ?? existing.active;
      if (nextActive && (await nameTaken(ctx.db, ctx.companyId, nextName, existing.id))) {
        throw new TRPCError({ code: "CONFLICT", message: `Transporter ${nextName} already exists` });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(transporter)
          .set({
            name: nextName,
            phone: input.phone === undefined ? existing.phone : input.phone || null,
            active: nextActive,
            serverSeq: seq,
          })
          .where(and(eq(transporter.id, existing.id), eq(transporter.companyId, ctx.companyId))),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "transporter.update",
            subjectType: "transporter",
            subjectId: existing.id,
            meta: {
              ...(input.name !== undefined && input.name !== existing.name ? { name: { from: existing.name, to: input.name } } : {}),
              ...(input.active !== undefined && input.active !== existing.active ? { active: input.active } : {}),
            },
          },
        ),
      ]);
      return { success: true };
    }),
});
