import { and, eq, sql, type SQL } from "drizzle-orm";

import { approval, type ApprovalKind } from "@orrn/db/schema/approval";
import { dieInstance, dieTierChange } from "@orrn/db/schema/dies";

import type { OrrnDb, SqliteBatchItem } from "./atomic";

/** What an approval's apply hook sees: this request, and the decision that is being written. */
export type ApplyCtx = {
  db: OrrnDb;
  companyId: string;
  /** This decision's company sequence; the decided approval row carries it. */
  seq: number;
  decidedAt: Date;
};

export type ApprovalApplier = (
  ctx: ApplyCtx,
  row: { id: string; subjectId: string },
  decision: "approved" | "rejected",
) => SqliteBatchItem[];

/**
 * EXISTS: this request's decision landed on the approval row. Statements of an apply hook are
 * guarded by it, so a decide that lost the race to another approver changes nothing.
 */
export function decisionLanded(
  ctx: ApplyCtx,
  approvalId: string,
  decision: "approved" | "rejected",
): SQL {
  return sql`exists (select 1 from ${approval} a where a.id = ${approvalId} and a.company_id = ${ctx.companyId} and a.server_seq = ${ctx.seq} and a.status = ${decision})`;
}

/**
 * Die re-rank (spec P18): the approved tier change becomes `applied` and the copy's rank changes
 * in the same batch as the approval; a rejection only closes the proposal. Both statements are
 * scoped to the approval's company, so a subject id that points at another company's row (or at
 * nothing) changes nothing.
 */
const dieRerank: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq } = ctx;
  const subject = and(
    eq(dieTierChange.id, row.subjectId),
    eq(dieTierChange.companyId, companyId),
    eq(dieTierChange.status, "pending"),
    decisionLanded(ctx, row.id, decision),
  );
  if (decision === "rejected") {
    return [
      db
        .update(dieTierChange)
        .set({ status: "rejected", approvalId: row.id, serverSeq: seq })
        .where(subject),
    ];
  }
  return [
    db
      .update(dieTierChange)
      .set({ status: "applied", approvalId: row.id, effectiveAt: ctx.decidedAt, serverSeq: seq })
      .where(subject),
    // Runs after the statement above and only if it applied this tier change in this request.
    db
      .update(dieInstance)
      .set({
        tierRank: sql<number>`(select t.to_rank from die_tier_change t where t.id = ${row.subjectId})`,
        tierSince: ctx.decidedAt,
        serverSeq: seq,
      })
      .where(
        and(
          eq(dieInstance.companyId, companyId),
          sql`${dieInstance.id} = (select t.die_instance_id from die_tier_change t where t.id = ${row.subjectId} and t.company_id = ${companyId})`,
          sql`exists (select 1 from die_tier_change t where t.id = ${row.subjectId} and t.company_id = ${companyId} and t.status = 'applied' and t.server_seq = ${seq})`,
        ),
      ),
  ];
};

/**
 * Per-kind apply hooks run by `approval.decide` inside the decision's own batch. A kind with no
 * hook is a pure sign-off (its module reads the approval's status itself).
 */
export const APPROVAL_APPLIERS: Partial<Record<ApprovalKind, ApprovalApplier>> = {
  die_rerank: dieRerank,
};
