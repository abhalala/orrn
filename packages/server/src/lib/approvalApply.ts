import { TRPCError } from "@trpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { approval, type ApprovalKind } from "@orrn/db/schema/approval";
import { countLine } from "@orrn/db/schema/count";
import { dieInstance, dieTierChange } from "@orrn/db/schema/dies";
import { cast } from "@orrn/db/schema/foundry";
import { bundle, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { location } from "@orrn/db/schema/stock";
import { dcNote, purchaseLot } from "@orrn/db/schema/purchase";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { stillPhantomOfLine } from "./count";
import { billetStoreRetiredMessage, boriMeltedMessage, castTailAdjustRow, dcNoteOverdrawAbort, foundryAbort, isFoundryAbort, lotRemaining } from "./foundry";
import { dcNoteDeductionRows, phantomVoidRows, sqlUuid } from "./ledger";
import { ageingOverrideDecision } from "./ageing";
import { pressLateEntryDecision, pressReopenDecision, pressTimeDecision } from "./press";
import { reallocateDecision, reallocatePrepare } from "./reallocate";

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
  /** What the kind's `APPROVAL_PREPARERS` entry read or allocated before the batch, if it has one. */
  prepared?: unknown,
) => SqliteBatchItem[];

/**
 * Async work a kind needs before its decision batch (numbers to allocate, rows to read). The
 * result is handed to its applier. Order reallocation allocates the target customer's party
 * numbers here (M4, final explore).
 */
export const APPROVAL_PREPARERS: Partial<
  Record<ApprovalKind, (ctx: ApplyCtx, row: { id: string; subjectId: string; meta: Record<string, unknown> | null }, decision: "approved" | "rejected") => Promise<unknown>>
> = {
  order_reallocate: (ctx, row, decision) => (decision === "approved" ? reallocatePrepare(ctx.db, ctx.companyId, row, ctx.decidedAt, ctx.userId) : Promise.resolve([])),
};

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
 * Die re-rank (spec P18) and band lift (FP-DR-10): the approved tier change becomes `applied` and
 * the copy's rank (and band, on a lift) changes in the same batch as the approval; a rejection only closes the proposal. Both statements are
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
        // FP-DR-10: a lift also moves the copy to its new band (null = back to the primary band).
        // The code and seq never change; the old band shows "Lifted to …" from this row.
        bandId: sql<string | null>`(case when (select t.is_lift from die_tier_change t where t.id = ${row.subjectId}) = 1
          then (select t.to_band_id from die_tier_change t where t.id = ${row.subjectId})
          else ${sql.identifier("die_instance")}.${sql.identifier("band_id")} end)`,
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
    // Q59-A: the count's adjustment (frozen in the close summary at the request) posts with the
    // approval, never before. It is the tail AS COUNTED: billets the press used after the count are
    // its own rows, so on hand = counted − later use. Guarded on "this approval closed the cast".
    const closedNow = sql`exists (select 1 from ${cast} ac where ac.id = ${row.subjectId} and ac.company_id = ${companyId} and ac.status = 'closed' and ac.server_seq = ${seq} and ac.close_approval_id = ${row.id})`;
    const frozen = (key: string) =>
      sql`(select json_extract(fc.close_summary, ${`$.${key}`}) from ${cast} fc where fc.id = ${row.subjectId} and fc.company_id = ${companyId})`;
    const activeBilletStore = sql`exists (select 1 from ${location} al where al.id = ${frozen("adjustLocationId")} and al.company_id = ${companyId} and al.kind = 'billet_store' and al.active = 1)`;
    return [
      db
        .update(cast)
        .set({ status: "closed", closedAt: ctx.decidedAt, closedBy: ctx.userId, serverSeq: seq, updatedAt: ctx.decidedAt })
        .where(subject),
      castTailAdjustRow(db, {
        companyId,
        castId: row.subjectId,
        qtyG: frozen("adjustG"),
        locationId: frozen("adjustLocationId"),
        seq,
        at: ctx.decidedAt,
        userId: ctx.userId,
        reason: "Count at close (approved)",
        when: and(closedNow, sql`${frozen("adjustLocationId")} is not null`, activeBilletStore),
      }),
      // r2 (m-d): never close on a count the ledger cannot take: a retired billet store refuses the
      // approval (explained by `explainApplyAbort`); reactivate it, or reject the close.
      foundryAbort(db, companyId, sql`${closedNow} and coalesce(${frozen("adjustG")}, 0) <> 0 and not ${activeBilletStore}`),
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
        tailReasonCodeId: null,
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
 * Customer-owned die exception (FP-DR-12, kind `die_owner_override`, subject = the copy id). The
 * grant itself is the approved row: `assertDieAllowed` reads it until `meta.closedAt` is set by
 * `dieInstance.closeOwnerOverride`. Approval stamps `meta.grantedAt` and makes sure the grant
 * starts open (`closedAt` null), guarded by "this decision landed"; a rejection writes nothing.
 */
const dieOwnerOverrideDecision: ApprovalApplier = (ctx, row, decision) => {
  if (decision === "rejected") return [];
  const { db, companyId, seq } = ctx;
  return [
    db
      .update(approval)
      .set({
        meta: sql`json_set(${approval.meta}, '$.grantedAt', ${ctx.decidedAt.getTime()}, '$.closedAt', json('null'))`,
      })
      .where(
        and(
          eq(approval.id, row.id),
          eq(approval.companyId, companyId),
          eq(approval.kind, "die_owner_override"),
          eq(approval.serverSeq, seq),
          decisionLanded(ctx, row.id, decision),
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
  dc_note: dcNoteDecision,
  phantom_void: phantomVoidDecision,
  cast_close: castCloseDecision,
  die_owner_override: dieOwnerOverrideDecision,
  // FP-OP-08 (W1-OP-S): cross-customer reallocation moves its bundles on approval.
  order_reallocate: reallocateDecision,
  // FP-PR-20 (W2-PR-S): confirm times, reopen with ledger reversals, late entry flag / void.
  press_time: pressTimeDecision,
  press_reopen: pressReopenDecision,
  press_late_entry: pressLateEntryDecision,
  // FP-AG-14 (W3-AG-S): the approved override goes on the batch; the supervisor releases after it.
  ageing_override: ageingOverrideDecision,
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
  if (!isFoundryAbort(e)) return;
  if (row.kind === "cast_close") {
    // r2 (m-d): the frozen count adjustment's billet store was retired after the request.
    const [c] = await db
      .select({ code: location.code, active: location.active })
      .from(cast)
      .innerJoin(location, and(eq(location.companyId, cast.companyId), sql`${location.id} = json_extract(${cast.closeSummary}, '$.adjustLocationId')`))
      .where(and(eq(cast.id, row.subjectId), eq(cast.companyId, companyId)))
      .limit(1);
    if (c && !c.active) throw new TRPCError({ code: "BAD_REQUEST", message: billetStoreRetiredMessage(c.code) });
    return;
  }
  if (row.kind !== "dc_note") return;
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
