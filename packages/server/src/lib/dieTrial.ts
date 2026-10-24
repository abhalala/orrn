/**
 * Copy on trial (FP-DR-17, backlog rank 42). A new copy, and a copy back from the maker, is
 * `on_trial` while `company.settings.dieRoom.newCopyOnTrial` is on. It goes to a press only for a
 * `die_trial` plan; it becomes `available` only by a passed trial run (`die_trial.pass`) or by a
 * manager with a reason (`die_trial.release`).
 *
 * State lives on the rows (migration 0029_die_trial), never in `audit_log` (a log that may be pruned):
 * - `die_issue.trial` is 1 when the copy was `on_trial` as it went out (set in the issue's
 *   insert-select from the copy row itself);
 * - `die_maker_job.from_status` is the copy's status when it was sent (`available` | `on_trial`;
 *   '' on older rows, read as `available`). A cancelled job puts the copy back as it went.
 *
 * Contract for the press close (W2-PR-S; one seam, `applyTrialVerdictOnReturn`):
 * 1. The close records the verdict on the run (`press_run.status = 'logged'`, `trial_result`) in its
 *    own batch, then appends the statements `applyTrialVerdictOnReturn(ctx, { run, verdict, seq, at,
 *    after })` returns. `after` is SQL that holds once the close's own run update landed (e.g.
 *    `exists (select 1 from press_run r where r.id = <run> and r.status = 'logged' and r.server_seq =
 *    <seq>)`); every seam statement waits on it, so a close that does not land moves nothing.
 * 2. Issue still open on this run (the usual order: close, then the die goes back): the seam returns
 *    it (`die_issue` -> `returned`, audit `die_issue.return` with `via: "close"`) and moves the copy
 *    `in_use` -> `available` (rack issue, or trial issue with verdict `pass`, plus audit
 *    `die_trial.pass` `via: "close"`) or `in_use` -> `on_trial` (trial issue, verdict `fail` or none).
 *    When the close carries the open issue on to the next queued run (C43) it does not call the seam.
 * 3. No open issue, the copy already back `on_trial` (returned before the close) and verdict `pass`
 *    on a `die_trial` run of this copy: the seam passes it (`on_trial` -> `available`, audit
 *    `die_trial.pass` `via: "close"`). Anything else: no statements, `copyTo: null`.
 * 4. The die room's own return of a trial issue whose run is already logged with `pass` writes
 *    `die_trial.pass` (`via: "return"`) in the return batch (`issueReturnStatements`); the pass is
 *    re-checked inside the batch, so a run reopened meanwhile aborts the return (CONFLICT).
 * 5. A failed verdict never retires or re-sends a copy by itself: the die room decides with
 *    `dieInstance.trialFail` (stay or retire) or a maker job.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { dieInstance } from "@orrn/db/schema/dies";
import { dieIssue, pressPlan, pressRun } from "@orrn/db/schema/press";
import { dieCopyNext, type DieCopyStatus } from "@orrn/domain";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { auditInsertGuarded } from "./audit";
import { auditCtx, type DieRoomCtx } from "./dieRoom";

export type TrialVerdict = "pass" | "fail" | null;

/** Plan purpose of a run (production when the run has no plan). */
export async function runPurpose(db: OrrnDb, companyId: string, runId: string): Promise<"production" | "die_trial" | "sample" | "other"> {
  const [row] = await db
    .select({ purpose: pressPlan.purpose })
    .from(pressRun)
    .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
    .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
    .limit(1);
  return row?.purpose ?? "production";
}

/** Where a cancelled maker job puts the copy back: `from_status` of the job ('' on rows before 0029 = the rack). */
export function makerCancelStatus(fromStatus: string): "on_trial" | "available" {
  return fromStatus === "on_trial" ? "on_trial" : "available";
}

/** The status a closing issue sends its copy to: a trial issue back on trial unless its run passed. */
export function copyStatusOnReturn(input: { trial: boolean; to: "returned" | "cancelled"; verdict: TrialVerdict }): "on_trial" | "available" {
  if (!input.trial) return "available";
  return input.to === "returned" && input.verdict === "pass" ? "available" : "on_trial";
}

/** The run's trial verdict as it stands now: `pass` / `fail` only once the run is logged. */
export async function loggedVerdict(db: OrrnDb, companyId: string, runId: string | null | undefined): Promise<TrialVerdict> {
  if (!runId) return null;
  const [run] = await db
    .select({ status: pressRun.status, trialResult: pressRun.trialResult })
    .from(pressRun)
    .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
    .limit(1);
  return run?.status === "logged" ? (run.trialResult ?? null) : null;
}

const passedSql = (companyId: string, runId: string) =>
  sql`exists (select 1 from press_run r where r.id = ${runId} and r.company_id = ${companyId} and r.status = 'logged' and r.trial_result = 'pass')`;

/**
 * The copy move of an issue that closes (die room return or cancel, or the press close through the
 * seam), for the caller's batch AFTER the statement that moves the `die_issue` row to `to` at `seq`:
 * the copy `in_use -> copyTo` and, for a trial issue that passed, the `die_trial.pass` audit row.
 * The verdict read before the batch is re-checked inside it; `landed` holds when the copy moved.
 */
export function issueReturnStatements(
  ctx: DieRoomCtx,
  input: {
    issue: { id: string; trial: boolean; to: "returned" | "cancelled" };
    copy: { id: string; code: string };
    run: { id: string; number: string } | null;
    verdict: TrialVerdict;
    seq: number;
    via: "return" | "cancel" | "close";
  },
): { copyTo: "on_trial" | "available"; statements: SqliteBatchItem[]; landed: SQL } {
  const { issue, copy, run, seq } = input;
  const copyTo = copyStatusOnReturn({ trial: issue.trial, to: issue.to, verdict: run ? input.verdict : null });
  const issueLanded = sql`exists (select 1 from die_issue x where x.id = ${issue.id} and x.server_seq = ${seq} and x.status = ${issue.to})`;
  // m-2: the verdict that decided `copyTo` must still hold when the batch runs (a reopen aborts it).
  const verdictHolds = issue.trial && run ? (copyTo === "available" ? passedSql(ctx.companyId, run.id) : sql`not ${passedSql(ctx.companyId, run.id)}`) : undefined;
  const landed = sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = ${copyTo} and i.server_seq = ${seq})`;
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(dieInstance)
      .set({ status: copyTo, serverSeq: seq })
      .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "in_use"), issueLanded, verdictHolds)),
  ];
  if (issue.trial && copyTo === "available" && run) {
    statements.push(
      auditInsertGuarded(
        auditCtx(ctx),
        {
          action: "die_trial.pass",
          subjectType: "die_instance",
          subjectId: copy.id,
          meta: { code: copy.code, from: "in_use", to: "available", issueId: issue.id, pressRunId: run.id, pressRunNumber: run.number, via: input.via },
        },
        { from: dieInstance, where: and(eq(dieInstance.id, copy.id), eq(dieInstance.serverSeq, seq), eq(dieInstance.status, "available")) },
      ),
    );
  }
  return { copyTo, statements, landed };
}

/**
 * THE seam for the press close (see the contract at the top of this file). Reads the copy and its
 * open issue on `run`, and returns the statements to append to the close's batch after the close's
 * own run update. `copyTo` is where the copy lands (null: nothing to move); `issueId` is the issue
 * it returned (null: none was open on this run).
 */
export async function applyTrialVerdictOnReturn(
  ctx: DieRoomCtx,
  input: {
    run: { id: string; number: string; dieInstanceId: string | null };
    verdict: TrialVerdict;
    seq: number;
    at: Date;
    after: SQL;
  },
): Promise<{ copyTo: "on_trial" | "available" | null; issueId: string | null; statements: SqliteBatchItem[]; landed: SQL | null }> {
  const none = { copyTo: null, issueId: null, statements: [], landed: null };
  const { run, seq } = input;
  if (!run.dieInstanceId) return none;
  const [copy] = await ctx.db
    .select({ id: dieInstance.id, code: dieInstance.code, status: dieInstance.status })
    .from(dieInstance)
    .where(and(eq(dieInstance.id, run.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
    .limit(1);
  if (!copy) return none;
  const [open] = await ctx.db
    .select({ id: dieIssue.id, trial: dieIssue.trial, pressLineId: dieIssue.pressLineId })
    .from(dieIssue)
    .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, copy.id), eq(dieIssue.status, "issued"), eq(dieIssue.pressRunId, run.id)))
    .limit(1);
  const verdict = input.verdict;
  const verdictNow = verdict === "pass" ? passedSql(ctx.companyId, run.id) : undefined;

  if (open) {
    const userId = ctx.session.user.id;
    const back = issueReturnStatements(ctx, {
      issue: { id: open.id, trial: open.trial === 1, to: "returned" },
      copy,
      run: { id: run.id, number: run.number },
      verdict,
      seq,
      via: "close",
    });
    return {
      copyTo: back.copyTo,
      issueId: open.id,
      landed: back.landed,
      statements: [
        ctx.db
          .update(dieIssue)
          .set({ status: "returned", returnedAt: input.at, returnedBy: userId, serverSeq: seq })
          .where(and(eq(dieIssue.id, open.id), eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.status, "issued"), input.after)),
        ...back.statements,
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_issue.return",
            subjectType: "die_instance",
            subjectId: copy.id,
            meta: { issueId: open.id, code: copy.code, pressLineId: open.pressLineId, pressRunId: run.id, runRequeued: false, copyTo: back.copyTo, via: "close" },
          },
          { from: dieIssue, where: and(eq(dieIssue.id, open.id), eq(dieIssue.serverSeq, seq), eq(dieIssue.status, "returned")) },
        ),
      ],
    };
  }

  // Returned before the close: a passed trial of this copy moves it off trial now.
  if (copy.status === "on_trial" && verdict === "pass" && (await runPurpose(ctx.db, ctx.companyId, run.id)) === "die_trial") {
    const statements = trialMoveStatements(ctx, {
      copy,
      move: "trialPass",
      seq,
      action: "die_trial.pass",
      meta: { pressRunId: run.id, pressRunNumber: run.number, via: "close" },
      where: and(input.after, verdictNow),
    });
    return { copyTo: "available", issueId: null, statements, landed: sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = 'available' and i.server_seq = ${seq})` };
  }
  return none;
}

export type TrialRunFacts = {
  id: string;
  number: string;
  status: string;
  purpose: string;
  trialResult: "pass" | "fail" | null;
  dieInstanceId: string | null;
};

/** A run read for a trial verdict. */
export async function loadTrialRun(db: OrrnDb, companyId: string, runId: string): Promise<TrialRunFacts> {
  const [row] = await db
    .select({
      id: pressRun.id,
      number: pressRun.number,
      status: pressRun.status,
      purpose: pressPlan.purpose,
      trialResult: pressRun.trialResult,
      dieInstanceId: pressRun.dieInstanceId,
    })
    .from(pressRun)
    .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
    .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
  return { ...row, purpose: row.purpose ?? "production", trialResult: row.trialResult ?? null };
}

/**
 * Check that `run` is a logged die trial of this copy with the verdict wanted. Throws the sentence
 * the die room reads.
 */
export function trialRunCheck(run: TrialRunFacts, copy: { id: string; code: string }, want: "pass" | "fail"): void {
  if (run.purpose !== "die_trial") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${run.number} is not a die trial run` });
  }
  if (run.dieInstanceId !== copy.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${run.number} did not press ${copy.code}` });
  }
  if (run.status !== "logged") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${run.number} is not closed yet; close the trial first` });
  }
  if (run.trialResult !== want) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: run.trialResult === null ? `${run.number} has no trial result` : `${run.number} was marked ${run.trialResult}, not ${want}`,
    });
  }
}

export type TrialMove = "trialPass" | "trialRelease" | "trialRetire" | "trialToMaker";

/**
 * The batch statements of one trial move: copy `on_trial -> next`, guarded by the status read, and
 * a guarded audit row. The caller runs them in its own `atomicBatch` (and adds
 * `dieRoomAbortUnless` if it needs the race to abort the batch).
 */
export function trialMoveStatements(
  ctx: DieRoomCtx,
  input: {
    copy: { id: string; code: string; status: DieCopyStatus };
    move: TrialMove;
    seq: number;
    action: string;
    meta: Record<string, unknown>;
    /** Extra condition the copy move waits on (the press close's "run logged" check). */
    where?: SQL;
  },
): SqliteBatchItem[] {
  const next = dieCopyNext(input.copy.status, input.move);
  if (!next) throw new TRPCError({ code: "BAD_REQUEST", message: `${input.copy.code} is not on trial` });
  const landed = and(eq(dieInstance.id, input.copy.id), eq(dieInstance.serverSeq, input.seq), eq(dieInstance.status, next));
  return [
    ctx.db
      .update(dieInstance)
      .set({ status: next, serverSeq: input.seq })
      .where(and(eq(dieInstance.id, input.copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, input.copy.status), input.where)),
    auditInsertGuarded(
      auditCtx(ctx),
      { action: input.action, subjectType: "die_instance", subjectId: input.copy.id, meta: { code: input.copy.code, from: input.copy.status, to: next, ...input.meta } },
      { from: dieInstance, where: landed },
    ),
  ];
}

/** Statements for a passed trial (event `trialPass`) of a copy that is `on_trial`, with a logged passed run. */
export function trialPassStatements(
  ctx: DieRoomCtx,
  input: { copy: { id: string; code: string; status: DieCopyStatus }; seq: number; run: { id: string; number: string } },
): SqliteBatchItem[] {
  return trialMoveStatements(ctx, {
    copy: input.copy,
    move: "trialPass",
    seq: input.seq,
    action: "die_trial.pass",
    meta: { pressRunId: input.run.id, pressRunNumber: input.run.number },
  });
}
