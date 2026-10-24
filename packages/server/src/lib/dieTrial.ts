/**
 * Copy on trial (FP-DR-17, backlog rank 42). A new copy, and a copy back from the maker, is
 * `on_trial` while `company.settings.dieRoom.newCopyOnTrial` is on. It goes to a press only for a
 * `die_trial` plan; it becomes `available` by a passed trial run or by a manager with a reason.
 *
 * The issue row has no trial flag (no migration): the issue audit row carries `trial: true` when
 * the copy was `on_trial` at issue time, so return and cancel send it back to `on_trial`, not to
 * the rack. `issueWasTrial` reads that row. W2-PR-S calls `trialRunCheck` and `trialPassStatements`
 * from the trial run's close.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";

import { auditLog } from "@orrn/db/schema";
import { dieInstance } from "@orrn/db/schema/dies";
import { pressPlan, pressRun } from "@orrn/db/schema/press";
import { dieCopyNext, type DieCopyStatus } from "@orrn/domain";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { auditInsertGuarded } from "./audit";
import { auditCtx, type DieRoomCtx } from "./dieRoom";

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

/** Whether this open issue was a trial issue (the copy was `on_trial` when it went out). */
export async function issueWasTrial(db: OrrnDb, companyId: string, copyId: string, issueId: string): Promise<boolean> {
  const [row] = await db
    .select({ trial: sql<number | null>`json_extract(${auditLog.meta}, '$.trial')` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, companyId),
        eq(auditLog.subjectType, "die_instance"),
        eq(auditLog.subjectId, copyId),
        eq(auditLog.action, "die_issue.issue"),
        sql`json_extract(${auditLog.meta}, '$.issueId') = ${issueId}`,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(1);
  return row?.trial === 1;
}

/**
 * The status a copy takes when its issue comes back: `on_trial` for a trial issue, else the rack.
 * A trial issue whose run is logged with a passed trial goes to the rack (the trial passed).
 */
export async function statusAfterReturn(
  db: OrrnDb,
  companyId: string,
  copyId: string,
  issueId: string,
  runId?: string | null,
): Promise<"on_trial" | "available"> {
  if (!(await issueWasTrial(db, companyId, copyId, issueId))) return "available";
  if (runId) {
    const [run] = await db
      .select({ status: pressRun.status, trialResult: pressRun.trialResult })
      .from(pressRun)
      .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
      .limit(1);
    if (run?.status === "logged" && run.trialResult === "pass") return "available";
  }
  return "on_trial";
}

/** Where a copy sat before a maker job took it (the send audit row): the rack, or on trial. */
export async function sentFromStatus(db: OrrnDb, companyId: string, copyId: string, jobId: string): Promise<"on_trial" | "available"> {
  const [row] = await db
    .select({ from: sql<string | null>`json_extract(${auditLog.meta}, '$.fromStatus')` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, companyId),
        eq(auditLog.subjectType, "die_instance"),
        eq(auditLog.subjectId, copyId),
        eq(auditLog.action, "die_maker_job.send"),
        sql`json_extract(${auditLog.meta}, '$.jobId') = ${jobId}`,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(1);
  return row?.from === "on_trial" ? "on_trial" : "available";
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
  input: { copy: { id: string; code: string; status: DieCopyStatus }; move: TrialMove; seq: number; action: string; meta: Record<string, unknown> },
): SqliteBatchItem[] {
  const next = dieCopyNext(input.copy.status, input.move);
  if (!next) throw new TRPCError({ code: "BAD_REQUEST", message: `${input.copy.code} is not on trial` });
  const landed = and(eq(dieInstance.id, input.copy.id), eq(dieInstance.serverSeq, input.seq), eq(dieInstance.status, next));
  return [
    ctx.db
      .update(dieInstance)
      .set({ status: next, serverSeq: input.seq })
      .where(and(eq(dieInstance.id, input.copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, input.copy.status))),
    auditInsertGuarded(
      auditCtx(ctx),
      { action: input.action, subjectType: "die_instance", subjectId: input.copy.id, meta: { code: input.copy.code, from: input.copy.status, to: next, ...input.meta } },
      { from: dieInstance, where: landed },
    ),
  ];
}

/** Statements for a passed trial (event `trialPass`): used by this module's procedures and by a trial run's close. */
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
