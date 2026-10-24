import { TRPCError } from "@trpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { approval, type ApprovalKind } from "@orrn/db/schema/approval";
import { dieInstance, dieTierChange } from "@orrn/db/schema/dies";
import { cast } from "@orrn/db/schema/foundry";
import { dcNote, purchaseLot } from "@orrn/db/schema/purchase";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { boriMeltedMessage, dcNoteOverdrawAbort, isFoundryAbort, lotRemaining } from "./foundry";
import { dcNoteDeductionRows } from "./ledger";

/** What an approval's apply hook sees: this request, and the decision that is being written. */
export type ApplyCtx = {
  db: OrrnDb;
  companyId: string;
  /** The deciding user (ledger rows the hook posts carry it as created_by). */
  userId: string | null;
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
 * D/C note on a scrap lot (spec P14): the note takes the decision. Approved: if its lot is already
 * OK, the bori deduction is posted now (− at the lot's scrap store); if the lot is not OK yet, its
 * OK posting will subtract it. A lot never waits on approval to go OK: a pending weight note is
 * enough (the debit note is "started on the spot"); approval only makes the deduction effective.
 * Statements are scoped to the company, the note must still be pending, and the decision must
 * have landed, so the losing approver of a race (or a forged subject) changes nothing. An approval
 * whose bori would take an OK lot below what the foundry melted aborts the whole decision
 * (`dcNoteOverdrawAbort`, explained by `explainApplyAbort`); rejecting is always possible.
 */
const dcNoteDecision: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq } = ctx;
  const statements: SqliteBatchItem[] = [
    db
      .update(dcNote)
      .set({ status: decision, approvalId: row.id, decidedAt: ctx.decidedAt, serverSeq: seq })
      .where(
        and(
          eq(dcNote.id, row.subjectId),
          eq(dcNote.companyId, companyId),
          eq(dcNote.status, "pending"),
          decisionLanded(ctx, row.id, decision),
        ),
      ),
  ];
  if (decision === "approved") {
    statements.push(
      dcNoteDeductionRows(
        { db, companyId, userId: ctx.userId, seq, postedAt: ctx.decidedAt },
        { noteId: row.subjectId },
      ),
      dcNoteOverdrawAbort(db, companyId, row.subjectId),
    );
  }
  return statements;
};

/**
 * Cast close-out with an unexplained tail (Review Focus 4): approved → the cast is closed (closed
 * by the approver); rejected → back to open, the close-out figures cleared, so melts can be added
 * and the close asked again. Only the close request this approval was opened for is touched
 * (`close_approval_id`), scoped to the company, and only if this decision landed.
 */
const castCloseDecision: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq } = ctx;
  const subject = and(
    eq(cast.id, row.subjectId),
    eq(cast.companyId, companyId),
    eq(cast.status, "closing"),
    eq(cast.closeApprovalId, row.id),
    decisionLanded(ctx, row.id, decision),
  );
  if (decision === "approved") {
    return [
      db
        .update(cast)
        .set({ status: "closed", closedAt: ctx.decidedAt, closedBy: ctx.userId, serverSeq: seq, updatedAt: ctx.decidedAt })
        .where(subject),
    ];
  }
  return [
    db
      .update(cast)
      .set({
        status: "open",
        closeRequestedAt: null,
        closeRequestedBy: null,
        tailG: null,
        tailBp: null,
        tailReason: null,
        closeSummary: null,
        closedAt: null,
        closedBy: null,
        serverSeq: seq,
        updatedAt: ctx.decidedAt,
      })
      .where(subject),
  ];
};

/**
 * Per-kind apply hooks run by `approval.decide` inside the decision's own batch. A kind with no
 * hook is a pure sign-off (its module reads the approval's status itself).
 */
export const APPROVAL_APPLIERS: Partial<Record<ApprovalKind, ApprovalApplier>> = {
  die_rerank: dieRerank,
  dc_note: dcNoteDecision,
  cast_close: castCloseDecision,
};

/**
 * A decision batch failed: if an apply hook's own abort refused it, throw the reason (BAD_REQUEST)
 * read from the current state; otherwise return and let the caller rethrow the original error.
 */
export async function explainApplyAbort(
  db: OrrnDb,
  companyId: string,
  row: { kind: ApprovalKind; subjectId: string },
  e: unknown,
): Promise<void> {
  if (row.kind !== "dc_note" || !isFoundryAbort(e)) return;
  const [note] = await db
    .select({ lotId: dcNote.lotId, lotNumber: purchaseLot.number, number: dcNote.number, boriG: dcNote.boriDeductionG, status: dcNote.status })
    .from(dcNote)
    .innerJoin(purchaseLot, and(eq(purchaseLot.id, dcNote.lotId), eq(purchaseLot.companyId, dcNote.companyId)))
    .where(and(eq(dcNote.id, row.subjectId), eq(dcNote.companyId, companyId)))
    .limit(1);
  if (!note) return;
  const left = await lotRemaining(db, companyId, note.lotId);
  // The batch rolled back, so the note is still pending and its own bori is held back in `remainingG`.
  const forBori = left.remainingG + (note.status === "pending" ? note.boriG : 0);
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: boriMeltedMessage(note.lotNumber, left.drawnG, forBori, `Reject ${note.number} and raise it again`),
  });
}
