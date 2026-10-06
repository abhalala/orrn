import { and, eq, sql, type SQL } from "drizzle-orm";

import { approval, type ApprovalKind } from "@orrn/db/schema/approval";
import { countLine } from "@orrn/db/schema/count";
import { dieInstance, dieTierChange } from "@orrn/db/schema/dies";
import { bundle, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { dcNote } from "@orrn/db/schema/purchase";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { stillPhantomOfLine } from "./count";
import { dcNoteDeductionRows, phantomVoidRows, sqlUuid } from "./ledger";

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
 * have landed, so the losing approver of a race (or a forged subject) changes nothing.
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
    );
  }
  return statements;
};

/**
 * Phantom void (PL-10, spec §5 "phantom list → void as phantom (manager)"): the request put the
 * count's phantom lines in `void_requested` under this approval. Approved: each bundle that is
 * STILL a phantom is voided: available, at the location the count expected it, with no ledger row
 * since that close, not scanned by another count since that count began and with no older
 * sighting still pending in another count (`stillPhantomOfLine`). Its pack / opening / restore row is
 * reversed (voucher = the count line), a status event is written and the line becomes `voided`.
 * Lines whose bundle turned up meanwhile become `cleared` (nothing voided). Rejected: lines go
 * back to `open`. Everything is scoped to the approval's company and guarded by "this decision
 * landed", so a losing approver (or an approval forged onto another company's count) changes
 * nothing.
 */
const phantomVoidDecision: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq, userId } = ctx;
  const landed = decisionLanded(ctx, row.id, decision);
  const requestedLines = and(
    eq(countLine.companyId, companyId),
    eq(countLine.approvalId, row.id),
    eq(countLine.kind, "phantom"),
    eq(countLine.resolution, "void_requested"),
  );
  if (decision === "rejected") {
    return [db.update(countLine).set({ resolution: "open", serverSeq: seq }).where(and(requestedLines, landed))];
  }
  const B = (column: string) => sql`${sql.identifier("bundle")}.${sql.identifier(column)}`;
  const L = (column: string) => sql`${sql.identifier("count_line")}.${sql.identifier(column)}`;
  const stillPhantom = sql`exists (
    select 1 from count_line cl
    inner join count_session cs on cs.id = cl.session_id and cs.company_id = cl.company_id
    where cl.company_id = ${companyId} and cl.approval_id = ${row.id} and cl.kind = 'phantom'
      and cl.resolution = 'void_requested' and cl.bundle_id = ${B("id")}
      and ${stillPhantomOfLine(companyId, B("id"), B("location_id"))}
  )`;
  const voidedByUs = and(eq(bundle.companyId, companyId), eq(bundle.status, "void"), eq(bundle.serverSeq, seq));
  return [
    db
      .update(bundle)
      .set({ status: "void", serverSeq: seq })
      .where(and(eq(bundle.companyId, companyId), eq(bundle.status, "available"), stillPhantom, landed)),
    phantomVoidRows({ db, companyId, userId, seq, postedAt: ctx.decidedAt }, { approvalId: row.id }),
    // Keys follow bundle_status_event's column order (insert-select rule).
    db.insert(bundleStatusEvent).select(
      db
        .select({
          id: sqlUuid.as("id"),
          companyId: sql<string>`${companyId}`.as("company_id"),
          bundleId: sql<string>`${B("id")}`.as("bundle_id"),
          fromStatus: sql<string>`'available'`.as("from_status"),
          toStatus: sql<string>`'void'`.as("to_status"),
          reason: sql<string>`'Phantom at count ' || coalesce((
            select cs.number from count_session cs where cs.id = ${L("session_id")} and cs.company_id = ${L("company_id")}
          ), '')`.as("reason"),
          actorId: sql<string | null>`${userId}`.as("actor_id"),
          dispatchId: sql<string | null>`null`.as("dispatch_id"),
          at: sql<number>`${ctx.decidedAt.getTime()}`.as("at"),
        })
        .from(bundle)
        .innerJoin(countLine, and(eq(countLine.companyId, bundle.companyId), eq(countLine.bundleId, bundle.id)))
        .where(and(voidedByUs, requestedLines)),
    ),
    db
      .update(countLine)
      .set({ resolution: "voided", resolvedAt: ctx.decidedAt, resolvedBy: userId, serverSeq: seq })
      .where(
        and(
          requestedLines,
          sql`exists (select 1 from bundle b where b.id = ${L("bundle_id")} and b.company_id = ${companyId} and b.status = 'void' and b.server_seq = ${seq})`,
        ),
      ),
    // What is left turned up after the count (moved, dispatched, seen again): nothing to void.
    db
      .update(countLine)
      .set({ resolution: "cleared", resolvedAt: ctx.decidedAt, resolvedBy: userId, serverSeq: seq })
      .where(and(requestedLines, landed)),
  ];
};

/**
 * Per-kind apply hooks run by `approval.decide` inside the decision's own batch. A kind with no
 * hook is a pure sign-off (its module reads the approval's status itself).
 */
export const APPROVAL_APPLIERS: Partial<Record<ApprovalKind, ApprovalApplier>> = {
  die_rerank: dieRerank,
  dc_note: dcNoteDecision,
  phantom_void: phantomVoidDecision,
};
