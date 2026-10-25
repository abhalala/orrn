/**
 * FP-DR-18 die work log (W4-NEXTROWS): in-house work on a die copy besides nitriding and maker trips
 * (polish, correction, inspection, cleaning, other). Mounted as `dieInstance.work.*`.
 *
 * - The kinds are `reason_code` rows of kind `die_work` (an editable list under Masters); `other`
 *   or a plant code marked so needs a note.
 * - Work is logged on the rack only (`available` / `on_trial`, `dieWorkCheck`). A correction may
 *   send an available copy back on trial (`setOnTrial`, event `workCorrect`).
 * - Append only, audited (`die_work.add`, plus `die_work.trial` when the status moves). No stock moves.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { dieInstance, dieWork } from "@orrn/db/schema/dies";
import { reasonCode } from "@orrn/db/schema/reasons";
import { dieWorkCheck, MAX_REASON_NOTE, reasonNoteMissing, type DieCopyStatus, type DieWorkRefusal } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { auditCtx } from "../lib/dieRoom";
import { ensureDefaultReasonCodes } from "../lib/reasonCodes";
import { nextCompanySeq } from "../lib/sequence";

/** Paper is often filled in later, never ahead (a day of clock slack, as nitriding). */
const FUTURE_SLACK_MS = 86_400_000;

function refusalText(refusal: DieWorkRefusal, code: string): string {
  switch (refusal) {
    case "copy_in_use":
      return `${code} is issued to a press; return it before logging work`;
    case "copy_at_maker":
      return `${code} is at the die maker; receive it before logging work`;
    case "copy_at_nitriding":
      return `${code} is out at nitriding; record it back first`;
    case "copy_retired":
      return `${code} is retired`;
    case "trial_needs_correct":
      return "Only a correction can send the copy back on trial";
  }
}

export const dieWorkRouter = router({
  /** The plant's active work kinds (`reason_code` kind `die_work`), defaults added on first read. */
  kinds: companyProcedure.query(async ({ ctx }) => {
    await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
    return ctx.db
      .select({ id: reasonCode.id, code: reasonCode.code, label: reasonCode.label, requiresNote: reasonCode.requiresNote })
      .from(reasonCode)
      .where(and(eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, "die_work"), eq(reasonCode.active, true)))
      .orderBy(asc(reasonCode.sortOrder), asc(reasonCode.code));
  }),

  add: actionProcedure("die.card")
    .input(
      z.object({
        dieInstanceId: z.string().min(1).max(64),
        reasonCodeId: z.string().min(1).max(64),
        /** The day the work was done (epoch ms); defaults to now. */
        workedAt: z.number().int().positive().optional(),
        note: z.string().trim().max(MAX_REASON_NOTE).optional(),
        /** HV after the work, when measured. */
        hardness: z.number().int().min(1).max(5_000).optional(),
        /** A correction that sends the copy back on trial. */
        setOnTrial: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [copy] = await ctx.db
        .select({ id: dieInstance.id, code: dieInstance.code, status: dieInstance.status })
        .from(dieInstance)
        .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
        .limit(1);
      if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      const [kind] = await ctx.db
        .select({ id: reasonCode.id, code: reasonCode.code, requiresNote: reasonCode.requiresNote })
        .from(reasonCode)
        .where(
          and(
            eq(reasonCode.id, input.reasonCodeId),
            eq(reasonCode.companyId, ctx.companyId),
            eq(reasonCode.kind, "die_work"),
            eq(reasonCode.active, true),
          ),
        )
        .limit(1);
      if (!kind) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick what was done" });
      if (reasonNoteMissing({ code: kind.code, requiresNote: kind.requiresNote, note: input.note })) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Say what was done in the note" });
      }
      const check = dieWorkCheck({ status: copy.status as DieCopyStatus, code: kind.code, setOnTrial: input.setOnTrial });
      if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: refusalText(check.refusal, copy.code) });

      const at = clockNow().getTime();
      if (input.workedAt !== undefined && input.workedAt > at + FUTURE_SLACK_MS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The work date is in the future" });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const col = (c: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(c)}`;
      const landed = and(eq(dieWork.id, id), eq(dieWork.companyId, ctx.companyId));

      await atomicBatch(ctx.db, [
        // Keys follow die_work's column order (insert-select rule). Lands only while the copy is still
        // in the status read above (a press issue or maker send in between wins).
        ctx.db.insert(dieWork).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${col("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${col("id")}`.as("die_instance_id"),
              reasonCodeId: sql<string>`${kind.id}`.as("reason_code_id"),
              kindCode: sql<string>`${kind.code}`.as("kind_code"),
              workedAt: sql<number>`${input.workedAt ?? at}`.as("worked_at"),
              note: sql<string | null>`${input.note ? input.note : null}`.as("note"),
              hardness: sql<number | null>`${input.hardness ?? null}`.as("hardness"),
              setOnTrial: sql<number>`${check.movesToTrial ? 1 : 0}`.as("set_on_trial"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at}`.as("created_at"),
            })
            .from(dieInstance)
            .where(
              and(
                eq(dieInstance.id, copy.id),
                eq(dieInstance.companyId, ctx.companyId),
                eq(dieInstance.status, copy.status),
                inArray(dieInstance.status, ["available", "on_trial"]),
              ),
            ),
        ),
        ...(check.movesToTrial
          ? [
              ctx.db
                .update(dieInstance)
                .set({ status: "on_trial", serverSeq: seq })
                .where(
                  and(
                    eq(dieInstance.id, copy.id),
                    eq(dieInstance.companyId, ctx.companyId),
                    eq(dieInstance.status, "available"),
                    sql`exists (select 1 from die_work w where w.id = ${id} and w.company_id = ${ctx.companyId})`,
                  ),
                ),
            ]
          : []),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_work.add",
            subjectType: "die_instance",
            subjectId: copy.id,
            meta: { code: copy.code, workId: id, kind: kind.code, hardness: input.hardness ?? null, setOnTrial: check.movesToTrial },
          },
          { from: dieWork, where: landed },
        ),
        ...(check.movesToTrial
          ? [
              auditInsertGuarded(
                auditCtx(ctx),
                { action: "die_work.trial", subjectType: "die_instance", subjectId: copy.id, meta: { code: copy.code, workId: id, from: "available", to: "on_trial" } },
                { from: dieWork, where: landed },
              ),
            ]
          : []),
      ]);
      const [row] = await ctx.db.select({ id: dieWork.id }).from(dieWork).where(landed).limit(1);
      if (!row) throw new TRPCError({ code: "CONFLICT", message: `${copy.code} changed meanwhile; open the card again` });
      return { id, status: check.nextStatus };
    }),
});
