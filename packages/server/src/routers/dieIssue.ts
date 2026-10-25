/**
 * Die issue (FP-DR-16, C6, C43, LEDGER D13), mounted as `dieInstance.issues`. The die room hands a
 * copy to a press line for a released press run that waits `queued` with no copy: `pressRunId` is
 * required, the run must be of the copy's section and (when it has one) on the same line. One
 * batch: the `die_issue` row, the copy `available -> in_use`, `press_run.die_instance_id`, the run
 * `queued -> die_issued` (and its line when it had none); all or nothing. One open issue per copy
 * (partial unique). Return is refused while the die is in the press (die-in set, die-out unset); a
 * return before die-in and a cancel both put the run back to `queued` with no copy in the same
 * batch. `die.issue` is the die room's alone.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { dieIssue, dieIssueStatuses, pressLine, pressPlan, pressPlanLine, pressRun } from "@orrn/db/schema/press";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { canCancelIssue, canIssueDie, canReturnDie } from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { auditCtx, decodeListCursor, dieRoomAbortUnless, encodeListCursor, errorText, isDieRoomAbort, listCursorInput } from "../lib/dieRoom";
import { assertDieAllowed } from "../lib/dieOwner";
import { issueReturnStatements, loggedVerdict, runPurpose } from "../lib/dieTrial";
import { nextCompanySeq } from "../lib/sequence";

const STATUS_WORDS: Record<string, string> = {
  in_use: "is already issued to a press",
  at_nitriding: "is out at nitriding",
  at_maker: "is at the die maker",
  retired: "is retired",
  on_trial: "is on trial",
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
  /**
   * Issues, newest first; filter by line, copy, status. Any member (press start reads it). Paged:
   * pass the previous page's `nextCursor` as `cursor`; `nextCursor` is null on the last page.
   */
  list: companyProcedure
    .input(
      z
        .object({
          pressLineId: z.string().min(1).optional(),
          dieInstanceId: z.string().min(1).optional(),
          status: z.enum(dieIssueStatuses).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          cursor: listCursorInput,
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const after = decodeListCursor(input.cursor);
      const rows = await ctx.db
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
          pressRunDieInAt: pressRun.dieInAt,
          pressRunDieOutAt: pressRun.dieOutAt,
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
            after
              ? or(lt(dieIssue.issuedAt, new Date(after.at)), and(eq(dieIssue.issuedAt, new Date(after.at)), lt(dieIssue.id, after.id)))
              : undefined,
          ),
        )
        .orderBy(desc(dieIssue.issuedAt), desc(dieIssue.id))
        .limit(input.limit + 1);
      const items = rows.slice(0, input.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > input.limit && last ? encodeListCursor(last.issuedAt, last.id) : null };
    }),

  /** Active press lines, for the issue form's line picker. Any member. */
  pressLines: companyProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name })
      .from(pressLine)
      .where(and(eq(pressLine.companyId, ctx.companyId), eq(pressLine.status, "active")))
      .orderBy(asc(pressLine.sortOrder), asc(pressLine.code)),
  ),

  /**
   * Released runs waiting for a die (`queued`, no copy): the runs a copy can be issued to. With
   * `sectionId` only runs of that section (a copy goes to a run of its own section). Any member.
   */
  queuedRuns: companyProcedure
    .input(z.object({ sectionId: z.string().min(1).optional() }).default({}))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: pressRun.id,
          number: pressRun.number,
          sectionId: pressRun.sectionId,
          sectionSeries: die.series,
          sectionCode: die.sectionCode,
          pressLineId: pressRun.pressLineId,
          pressLineCode: pressLine.code,
          /** The plan purpose: an on_trial copy goes only to `die_trial` (FP-DR-17). */
          purpose: sql<"production" | "die_trial" | "sample" | "other">`coalesce(${pressPlan.purpose}, 'production')`,
        })
        .from(pressRun)
        .innerJoin(die, and(eq(die.id, pressRun.sectionId), eq(die.companyId, pressRun.companyId)))
        .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
        .leftJoin(pressLine, and(eq(pressLine.id, pressRun.pressLineId), eq(pressLine.companyId, pressRun.companyId)))
        .where(
          and(
            eq(pressRun.companyId, ctx.companyId),
            eq(pressRun.status, "queued"),
            sql`${pressRun.dieInstanceId} is null`,
            input.sectionId ? eq(pressRun.sectionId, input.sectionId) : undefined,
          ),
        )
        .orderBy(asc(pressRun.number))
        .limit(100),
    ),

  issue: actionProcedure("die.issue")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        pressLineId: z.string().min(1),
        /** Required (D13): the queued press run of this copy's section the die goes to. */
        pressRunId: z.string().min(1),
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

      const [run] = await ctx.db
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
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });

      const [open] = await ctx.db
        .select({ id: dieIssue.id, lineCode: pressLine.code })
        .from(dieIssue)
        .innerJoin(pressLine, and(eq(pressLine.id, dieIssue.pressLineId), eq(pressLine.companyId, dieIssue.companyId)))
        .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, copy.id), eq(dieIssue.status, "issued")))
        .limit(1);
      // FP-DR-17: an on_trial copy goes only to a die trial run (plan purpose `die_trial`).
      const purpose = await runPurpose(ctx.db, ctx.companyId, run.id);
      const verdict = canIssueDie({
        copy: { status: copy.status, sectionId: copy.sectionId },
        openIssueForCopy: Boolean(open),
        pressLineId: line.id,
        run: { status: run.dieInstanceId ? "die_issued" : run.status, sectionId: run.sectionId, pressLineId: run.pressLineId },
        purpose,
      });
      if (!verdict.ok) {
        switch (verdict.refusal) {
          case "open_issue_exists":
            throw new TRPCError({ code: "CONFLICT", message: `${copy.code} is already issued to ${open?.lineCode ?? "a press"}` });
          case "copy_not_available":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} ${STATUS_WORDS[copy.status] ?? `is ${copy.status}`}` });
          case "copy_on_trial":
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${copy.code} is on trial; it goes only to a die trial run until the trial passes or a manager releases it`,
            });
          case "run_not_queued":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${run.number} already has a die or has started; only a queued run takes a die` });
          case "section_mismatch":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} is not a copy of the die ${run.number} needs` });
          case "line_mismatch":
            throw new TRPCError({ code: "BAD_REQUEST", message: `${run.number} is planned on another press line` });
        }
      }
      // Customer-owned die (FP-DR-12): every party this run presses for must be allowed on this copy.
      for (const customerId of await runCustomers(ctx.db, ctx.companyId, run.pressPlanDieId)) {
        await assertDieAllowed(ctx.db, ctx.companyId, { dieInstanceId: copy.id, customerId, purpose: "press" });
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
              pressRunId: sql<string>`${run.id}`.as("press_run_id"),
              status: sql<string>`'issued'`.as("status"),
              issuedAt: sql<number>`${at.getTime()}`.as("issued_at"),
              issuedBy: sql<string>`${userId}`.as("issued_by"),
              returnedAt: sql<number | null>`null`.as("returned_at"),
              returnedBy: sql<string | null>`null`.as("returned_by"),
              note: sql<string | null>`${input.note ?? null}`.as("note"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
              updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
              // 0029: the copy row itself says whether it goes out on trial (dieTrial.ts).
              trial: sql<number>`case when ${I("status")} = 'on_trial' then 1 else 0 end`.as("trial"),
            })
            .from(dieInstance)
            .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, copy.status))),
        ),
        ctx.db
          .update(dieInstance)
          .set({ status: "in_use", serverSeq: seq })
          .where(
            and(
              eq(dieInstance.id, copy.id),
              eq(dieInstance.companyId, ctx.companyId),
              eq(dieInstance.status, copy.status),
              sql`exists (select 1 from die_issue x where x.id = ${id} and x.server_seq = ${seq})`,
            ),
          ),
      ];
      statements.push(
        ctx.db
          .update(pressRun)
          // A run released without a line takes the issue's line (§E1 "press_line_id = run line").
          .set({ dieInstanceId: copy.id, status: "die_issued", pressLineId: sql`coalesce(${pressRun.pressLineId}, ${line.id})`, serverSeq: seq })
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
      const landed = sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = 'in_use' and i.server_seq = ${seq})
        and exists (select 1 from press_run r where r.id = ${run.id} and r.status = 'die_issued' and r.die_instance_id = ${copy.id} and r.press_line_id = ${line.id} and r.server_seq = ${seq})`;
      statements.push(
        dieRoomAbortUnless(ctx.db, landed),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_issue.issue",
            subjectType: "die_instance",
            subjectId: copy.id,
            meta: {
              issueId: id,
              code: copy.code,
              pressLineId: line.id,
              pressRunId: run.id,
              pressRunNumber: run.number,
              warnings,
              // A log of what die_issue.trial holds; return and cancel read the column, never this row.
              trial: copy.status === "on_trial" ? 1 : 0,
              purpose,
            },
          },
          { from: dieIssue, where: and(eq(dieIssue.id, id), eq(dieIssue.serverSeq, seq)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isDieRoomAbort(e) || errorText(e).includes("die_issue.die_instance_id")) {
          throw new TRPCError({ code: "CONFLICT", message: `${copy.code} or ${run.number} changed meanwhile; nothing was issued` });
        }
        throw e;
      }
      return { id, warnings };
    }),

  /**
   * Back to the rack. Refused while the die is in the press. Before die-in (D13) the run goes back
   * to `queued` with no copy in the same batch, exactly as `cancel` does; a finished run keeps its
   * copy and status.
   */
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
      const statements: SqliteBatchItem[] = [
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
      ];
      if (issue.run) statements.push(requeueRun(ctx, issue, seq, "returned"));
      const status = await runIssueClose(ctx, issue, seq, statements, "returned");
      return { success: true, status };
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
      if (issue.run) statements.push(requeueRun(ctx, issue, seq, "cancelled"));
      const status = await runIssueClose(ctx, issue, seq, statements, "cancelled");
      return { success: true, status };
    }),
});

/**
 * The run back to `queued` with no copy, when it still waits for this copy before die-in (cancel,
 * and return before die-in). Runs only after the issue row moved to `to` in the same batch.
 */
function requeueRun(
  ctx: { db: OrrnDb; companyId: string },
  issue: Awaited<ReturnType<typeof loadIssue>>,
  seq: number,
  to: "returned" | "cancelled",
): SqliteBatchItem {
  return ctx.db
    .update(pressRun)
    .set({ dieInstanceId: null, status: "queued", serverSeq: seq })
    .where(
      and(
        eq(pressRun.id, issue.run!.id),
        eq(pressRun.companyId, ctx.companyId),
        eq(pressRun.status, "die_issued"),
        eq(pressRun.dieInstanceId, issue.dieInstanceId),
        sql`${pressRun.dieInAt} is null`,
        sql`exists (select 1 from die_issue x where x.id = ${issue.id} and x.server_seq = ${seq} and x.status = ${to})`,
      ),
    );
}

/**
 * The shared tail of return and cancel: the issue row change(s) given, then the copy back to the
 * rack (or `on_trial` for a trial issue that has not passed, plus `die_trial.pass` for one that has:
 * `issueReturnStatements`), all-or-nothing, with the audit row. Whatever the path, no run may be left
 * `die_issued` on the copy that went back (D13). Returns where the copy landed.
 */
async function runIssueClose(
  ctx: Parameters<typeof auditCtx>[0] & { db: OrrnDb },
  issue: Awaited<ReturnType<typeof loadIssue>>,
  seq: number,
  head: SqliteBatchItem[],
  to: "returned" | "cancelled",
): Promise<"available" | "on_trial"> {
  const issueLanded = sql`exists (select 1 from die_issue x where x.id = ${issue.id} and x.server_seq = ${seq} and x.status = ${to})`;
  const back = issueReturnStatements(ctx, {
    issue: { id: issue.id, trial: issue.trial === 1, to },
    copy: { id: issue.dieInstanceId, code: issue.code },
    run: issue.run ? { id: issue.run.id, number: issue.run.number } : null,
    verdict: issue.trial === 1 && to === "returned" ? await loggedVerdict(ctx.db, ctx.companyId, issue.run?.id) : null,
    seq,
    via: to === "returned" ? "return" : "cancel",
  });
  const copyTo = back.copyTo;
  let landed = sql`${issueLanded} and ${back.landed}`;
  if (issue.run) {
    landed = sql`${landed} and not exists (select 1 from press_run r where r.id = ${issue.run.id} and r.status = 'die_issued' and r.die_instance_id = ${issue.dieInstanceId})`;
  }
  if (to === "cancelled" && issue.run) {
    landed = sql`${landed} and exists (select 1 from press_run r where r.id = ${issue.run.id} and r.status = 'queued' and r.die_instance_id is null and r.server_seq = ${seq})`;
  }
  const runRequeued = Boolean(issue.run && issue.run.status === "die_issued" && issue.run.dieInAt == null);
  const statements: SqliteBatchItem[] = [
    ...head,
    ...back.statements,
    dieRoomAbortUnless(ctx.db, landed),
    auditInsertGuarded(
      auditCtx(ctx),
      {
        action: to === "returned" ? "die_issue.return" : "die_issue.cancel",
        subjectType: "die_instance",
        subjectId: issue.dieInstanceId,
        meta: { issueId: issue.id, code: issue.code, pressLineId: issue.pressLineId, pressRunId: issue.pressRunId, runRequeued, copyTo },
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
  return copyTo;
}
