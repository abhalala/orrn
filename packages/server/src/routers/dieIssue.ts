/**
 * Die issue (FP-DR-16, C6, C43), mounted as `dieInstance.issues`. The die room hands a copy to a
 * press line, usually for a released press run that waits `queued` with no copy. One batch: the
 * `die_issue` row, the copy `available -> in_use`, `press_run.die_instance_id` and the run
 * `queued -> die_issued`; all or nothing. One open issue per copy (partial unique). Return is
 * refused while the die is in the press (die-in set, die-out unset); cancel only before die-in,
 * and it puts the run back to `queued`. `die.issue` is the die room's alone.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { dieIssue, dieIssueStatuses, pressLine, pressPlanLine, pressRun } from "@orrn/db/schema/press";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { canCancelIssue, canIssueDie, canReturnDie } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { auditCtx, dieRoomAbortUnless, errorText, isDieRoomAbort } from "../lib/dieRoom";
import { assertDieAllowed } from "../lib/dieOwner";
import { nextCompanySeq } from "../lib/sequence";

const STATUS_WORDS: Record<string, string> = {
  in_use: "is already issued to a press",
  at_nitriding: "is out at nitriding",
  at_maker: "is at the die maker",
  retired: "is retired",
};

async function loadCopy(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select({
      id: dieInstance.id,
      code: dieInstance.code,
      status: dieInstance.status,
      sectionId: dieInstance.sectionId,
      lifeG: dieInstance.lifeG,
      sectionDeletedAt: die.deletedAt,
    })
    .from(dieInstance)
    .innerJoin(die, and(eq(die.id, dieInstance.sectionId), eq(die.companyId, dieInstance.companyId)))
    .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
  return row;
}

async function loadIssue(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select({
      issue: dieIssue,
      code: dieInstance.code,
      run: {
        id: pressRun.id,
        number: pressRun.number,
        status: pressRun.status,
        dieInAt: pressRun.dieInAt,
        dieOutAt: pressRun.dieOutAt,
        dieInstanceId: pressRun.dieInstanceId,
      },
    })
    .from(dieIssue)
    .innerJoin(dieInstance, and(eq(dieInstance.id, dieIssue.dieInstanceId), eq(dieInstance.companyId, dieIssue.companyId)))
    .leftJoin(pressRun, and(eq(pressRun.id, dieIssue.pressRunId), eq(pressRun.companyId, dieIssue.companyId)))
    .where(and(eq(dieIssue.id, id), eq(dieIssue.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Die issue not found" });
  const run = row.run?.id ? row.run : null;
  return { ...row.issue, code: row.code, run };
}

/** The customers whose order lines a run presses (its plan die's lines). */
async function runCustomers(db: OrrnDb, companyId: string, pressPlanDieId: string | null): Promise<string[]> {
  if (!pressPlanDieId) return [];
  const rows = await db
    .selectDistinct({ customerId: salesOrder.customerId })
    .from(pressPlanLine)
    .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
    .where(and(eq(pressPlanLine.companyId, companyId), eq(pressPlanLine.pressPlanDieId, pressPlanDieId)));
  return rows.map((r) => r.customerId);
}

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

export const dieIssueRouter = router({
  /** Issues, newest first; filter by line, copy, status. Any member (press start reads it). */
  list: companyProcedure
    .input(
      z
        .object({
          pressLineId: z.string().min(1).optional(),
          dieInstanceId: z.string().min(1).optional(),
          status: z.enum(dieIssueStatuses).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) =>
      ctx.db
        .select({
          id: dieIssue.id,
          status: dieIssue.status,
          dieInstanceId: dieIssue.dieInstanceId,
          code: dieInstance.code,
          pressLineId: dieIssue.pressLineId,
          pressLineCode: pressLine.code,
          pressRunId: dieIssue.pressRunId,
          pressRunNumber: pressRun.number,
          pressRunStatus: pressRun.status,
          issuedAt: dieIssue.issuedAt,
          issuedBy: dieIssue.issuedBy,
          returnedAt: dieIssue.returnedAt,
          returnedBy: dieIssue.returnedBy,
          note: dieIssue.note,
        })
        .from(dieIssue)
        .innerJoin(dieInstance, and(eq(dieInstance.id, dieIssue.dieInstanceId), eq(dieInstance.companyId, dieIssue.companyId)))
        .innerJoin(pressLine, and(eq(pressLine.id, dieIssue.pressLineId), eq(pressLine.companyId, dieIssue.companyId)))
        .leftJoin(pressRun, and(eq(pressRun.id, dieIssue.pressRunId), eq(pressRun.companyId, dieIssue.companyId)))
        .where(
          and(
            eq(dieIssue.companyId, ctx.companyId),
            input.pressLineId ? eq(dieIssue.pressLineId, input.pressLineId) : undefined,
            input.dieInstanceId ? eq(dieIssue.dieInstanceId, input.dieInstanceId) : undefined,
            input.status ? eq(dieIssue.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(dieIssue.issuedAt))
        .limit(input.limit),
    ),

  /** Active press lines, for the issue form's line picker. Any member. */
  pressLines: companyProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name })
      .from(pressLine)
      .where(and(eq(pressLine.companyId, ctx.companyId), eq(pressLine.status, "active")))
      .orderBy(asc(pressLine.sortOrder), asc(pressLine.code)),
  ),

  issue: actionProcedure("die.issue")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        pressLineId: z.string().min(1),
        pressRunId: z.string().min(1).optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const copy = await loadCopy(ctx.db, ctx.companyId, input.dieInstanceId);
      if (copy.sectionDeletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code}'s section is deleted; it cannot be issued` });
      }
      const [line] = await ctx.db
        .select({ id: pressLine.id, code: pressLine.code, status: pressLine.status })
        .from(pressLine)
        .where(and(eq(pressLine.id, input.pressLineId), eq(pressLine.companyId, ctx.companyId)))
        .limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
      if (line.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: `${line.code} is retired` });

      let run: { id: string; number: string; status: string; sectionId: string; pressLineId: string | null; dieInstanceId: string | null; pressPlanDieId: string | null } | null = null;
      if (input.pressRunId) {
        const [r] = await ctx.db
          .select({
            id: pressRun.id,
            number: pressRun.number,
            status: pressRun.status,
            sectionId: pressRun.sectionId,
            pressLineId: pressRun.pressLineId,
            dieInstanceId: pressRun.dieInstanceId,
            pressPlanDieId: pressRun.pressPlanDieId,
          })
          .from(pressRun)
          .where(and(eq(pressRun.id, input.pressRunId), eq(pressRun.companyId, ctx.companyId)))
          .limit(1);
        if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
        run = r;
      }

      const [open] = await ctx.db
        .select({ id: dieIssue.id, lineCode: pressLine.code })
        .from(dieIssue)
        .innerJoin(pressLine, eq(pressLine.id, dieIssue.pressLineId))
        .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, copy.id), eq(dieIssue.status, "issued")))
        .limit(1);
      const verdict = canIssueDie({
        copy: { status: copy.status, sectionId: copy.sectionId },
        openIssueForCopy: Boolean(open),
        pressLineId: line.id,
        run: run ? { status: run.dieInstanceId ? "die_issued" : run.status, sectionId: run.sectionId, pressLineId: run.pressLineId } : null,
      });
      if (!verdict.ok) {
        switch (verdict.refusal) {
          case "open_issue_exists":
            throw new TRPCError({ code: "CONFLICT", message: `${copy.code} is already issued to ${open?.lineCode ?? "a press"}` });
          case "copy_not_available":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} ${STATUS_WORDS[copy.status] ?? `is ${copy.status}`}` });
          case "run_not_queued":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${run!.number} already has a die or has started; only a queued run takes a die` });
          case "section_mismatch":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} is not a copy of the die ${run!.number} needs` });
          case "line_mismatch":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${run!.number} is planned on another press line` });
        }
      }
      // Customer-owned die (FP-DR-12): every party this run presses for must be allowed on this copy.
      if (run) {
        for (const customerId of await runCustomers(ctx.db, ctx.companyId, run.pressPlanDieId)) {
          await assertDieAllowed(ctx.db, ctx.companyId, { dieInstanceId: copy.id, customerId, purpose: "press" });
        }
      }

      // Life (FP-DR-07): a warning only; issue is never blocked by it.
      const [produced] = await ctx.db
        .select({ g: sql<number>`coalesce(sum(${pressRun.goodG}), 0)` })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.dieInstanceId, copy.id), eq(pressRun.status, "logged")));
      const producedG = Number(produced?.g ?? 0);
      const warnings: { code: "life_reached"; lifeG: number; producedG: number }[] =
        copy.lifeG != null && producedG >= copy.lifeG ? [{ code: "life_reached", lifeG: copy.lifeG, producedG }] : [];

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const userId = ctx.session.user.id;
      const I = (c: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(c)}`;
      const statements: SqliteBatchItem[] = [
        // Keys follow die_issue's column order (insert-select rule).
        ctx.db.insert(dieIssue).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${I("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${I("id")}`.as("die_instance_id"),
              pressLineId: sql<string>`${line.id}`.as("press_line_id"),
              pressRunId: sql<string | null>`${run?.id ?? null}`.as("press_run_id"),
              status: sql<string>`'issued'`.as("status"),
              issuedAt: sql<number>`${at.getTime()}`.as("issued_at"),
              issuedBy: sql<string>`${userId}`.as("issued_by"),
              returnedAt: sql<number | null>`null`.as("returned_at"),
              returnedBy: sql<string | null>`null`.as("returned_by"),
              note: sql<string | null>`${input.note ?? null}`.as("note"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
              updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
            })
            .from(dieInstance)
            .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "available"))),
        ),
        ctx.db
          .update(dieInstance)
          .set({ status: "in_use", serverSeq: seq })
          .where(
            and(
              eq(dieInstance.id, copy.id),
              eq(dieInstance.companyId, ctx.companyId),
              eq(dieInstance.status, "available"),
              sql`exists (select 1 from die_issue x where x.id = ${id} and x.server_seq = ${seq})`,
            ),
          ),
      ];
      let landed = sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = 'in_use' and i.server_seq = ${seq})`;
      if (run) {
        statements.push(
          ctx.db
            .update(pressRun)
            .set({ dieInstanceId: copy.id, status: "die_issued", serverSeq: seq })
            .where(
              and(
                eq(pressRun.id, run.id),
                eq(pressRun.companyId, ctx.companyId),
                eq(pressRun.status, "queued"),
                sql`${pressRun.dieInstanceId} is null`,
                sql`exists (select 1 from die_issue x where x.id = ${id} and x.server_seq = ${seq})`,
              ),
            ),
        );
        landed = sql`${landed} and exists (select 1 from press_run r where r.id = ${run.id} and r.status = 'die_issued' and r.die_instance_id = ${copy.id} and r.server_seq = ${seq})`;
      }
      statements.push(
        dieRoomAbortUnless(ctx.db, landed),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_issue.issue",
            subjectType: "die_instance",
            subjectId: copy.id,
            meta: { issueId: id, code: copy.code, pressLineId: line.id, pressRunId: run?.id ?? null, pressRunNumber: run?.number ?? null, warnings },
          },
          { from: dieIssue, where: and(eq(dieIssue.id, id), eq(dieIssue.serverSeq, seq)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isDieRoomAbort(e) || errorText(e).includes("die_issue.die_instance_id")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: run ? `${copy.code} or ${run.number} changed meanwhile; nothing was issued` : `${copy.code} changed meanwhile; nothing was issued`,
          });
        }
        throw e;
      }
      return { id, warnings };
    }),

  /** Back to the rack. Refused while the die is in the press; a finished run keeps its copy and status. */
  return: actionProcedure("die.issue")
    .input(z.object({ id: z.string().min(1), note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const issue = await loadIssue(ctx.db, ctx.companyId, input.id);
      const verdict = canReturnDie({
        issueStatus: issue.status,
        run: issue.run ? { dieInAt: ms(issue.run.dieInAt), dieOutAt: ms(issue.run.dieOutAt) } : null,
      });
      if (!verdict.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            verdict.refusal === "die_on_press"
              ? `${issue.code} is in the press for ${issue.run!.number}; take the die out first`
              : `This issue is already ${issue.status}`,
        });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      await runIssueClose(ctx, issue, seq, [
        ctx.db
          .update(dieIssue)
          .set({
            status: "returned",
            returnedAt: at,
            returnedBy: ctx.session.user.id,
            serverSeq: seq,
            ...(input.note ? { note: input.note } : {}),
          })
          .where(
            and(
              eq(dieIssue.id, issue.id),
              eq(dieIssue.companyId, ctx.companyId),
              eq(dieIssue.status, "issued"),
              // Write-time C43 guard: die in and not out = still on the press.
              sql`not exists (select 1 from press_run r where r.id = ${sql.identifier("die_issue")}.${sql.identifier("press_run_id")} and r.die_in_at is not null and r.die_out_at is null)`,
            ),
          ),
      ], "returned");
      return { success: true };
    }),

  /** Undo an issue before die-in: copy back to the rack, the run back to `queued` with no copy. */
  cancel: actionProcedure("die.issue")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const issue = await loadIssue(ctx.db, ctx.companyId, input.id);
      const runForRule = issue.run ? { status: issue.run.status, dieInAt: ms(issue.run.dieInAt) } : null;
      if (!canCancelIssue({ issueStatus: issue.status, run: runForRule })) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            issue.status !== "issued"
              ? `This issue is already ${issue.status}`
              : `${issue.run!.number} has started; return the die when it is out`,
        });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dieIssue)
          .set({ status: "cancelled", serverSeq: seq })
          .where(and(eq(dieIssue.id, issue.id), eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.status, "issued"))),
      ];
      if (issue.run) {
        statements.push(
          ctx.db
            .update(pressRun)
            .set({ dieInstanceId: null, status: "queued", serverSeq: seq })
            .where(
              and(
                eq(pressRun.id, issue.run.id),
                eq(pressRun.companyId, ctx.companyId),
                eq(pressRun.status, "die_issued"),
                eq(pressRun.dieInstanceId, issue.dieInstanceId),
                sql`${pressRun.dieInAt} is null`,
                sql`exists (select 1 from die_issue x where x.id = ${issue.id} and x.server_seq = ${seq} and x.status = 'cancelled')`,
              ),
            ),
        );
      }
      await runIssueClose(ctx, issue, seq, statements, "cancelled");
      return { success: true };
    }),
});

/**
 * The shared tail of return and cancel: the issue row change(s) given, then the copy back to
 * `available`, all-or-nothing (and the run back to `queued` on cancel), with the audit row.
 */
async function runIssueClose(
  ctx: Parameters<typeof auditCtx>[0] & { db: OrrnDb },
  issue: Awaited<ReturnType<typeof loadIssue>>,
  seq: number,
  head: SqliteBatchItem[],
  to: "returned" | "cancelled",
): Promise<void> {
  const issueLanded = sql`exists (select 1 from die_issue x where x.id = ${issue.id} and x.server_seq = ${seq} and x.status = ${to})`;
  let landed = sql`${issueLanded} and exists (select 1 from die_instance i where i.id = ${issue.dieInstanceId} and i.status = 'available' and i.server_seq = ${seq})`;
  if (to === "cancelled" && issue.run) {
    landed = sql`${landed} and exists (select 1 from press_run r where r.id = ${issue.run.id} and r.status = 'queued' and r.die_instance_id is null and r.server_seq = ${seq})`;
  }
  const statements: SqliteBatchItem[] = [
    ...head,
    ctx.db
      .update(dieInstance)
      .set({ status: "available", serverSeq: seq })
      .where(and(eq(dieInstance.id, issue.dieInstanceId), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "in_use"), issueLanded)),
    dieRoomAbortUnless(ctx.db, landed),
    auditInsertGuarded(
      auditCtx(ctx),
      {
        action: to === "returned" ? "die_issue.return" : "die_issue.cancel",
        subjectType: "die_instance",
        subjectId: issue.dieInstanceId,
        meta: { issueId: issue.id, code: issue.code, pressLineId: issue.pressLineId, pressRunId: issue.pressRunId },
      },
      { from: dieIssue, where: and(eq(dieIssue.id, issue.id), eq(dieIssue.serverSeq, seq)) },
    ),
  ];
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    if (isDieRoomAbort(e)) {
      const now = await loadIssue(ctx.db, ctx.companyId, issue.id);
      if (now.status !== "issued") throw new TRPCError({ code: "BAD_REQUEST", message: `This issue is already ${now.status}` });
      if (now.run && now.run.dieInAt && !now.run.dieOutAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${issue.code} is in the press for ${now.run.number}; take the die out first` });
      }
      throw new TRPCError({ code: "CONFLICT", message: `${issue.code} changed meanwhile; nothing was changed` });
    }
    throw e;
  }
}
