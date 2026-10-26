/**
 * Press helpers (FP-PR, Wave 2; specs §E3): the run loader, the batch abort, the shift at an
 * instant, the close ledger rows, the issue hand-off after a log (C43) and the approval appliers
 * for `press_time`, `press_reopen` and `press_late_entry`.
 *
 * Ledger shape of a run (voucher `press_run`, voucher_id = run id, written by the close only):
 *   − billet `{castId}` at the billet store (input_g = the weighed kg, D22: debited in full even
 *     when the store goes negative; the row lands only while the store still holds at least what
 *     the close read, so a shortfall can never grow unrecorded between read and write)
 *   + return_stream DISCARD at plant scrap (butt, discard_g)
 *   + return_stream PLANT-SCRAP at plant scrap (ends_g, then reject_g on its own line)
 * D23 (LEDGER): the butt goes to the DISCARD stream at the Plant Scrap location, ends and rejects
 * to PLANT-SCRAP. AGENTS.md wins over the §E3 shorthand "+discard, +ends, +reject → Plant Scrap":
 * the foundry sheet keeps a separate "Plant Discard" stream, and the foundry lane reads DISCARD as
 * press butt.
 * Good kg is never posted here: it enters stock as bundles at pack. A reopen reverses every row
 * that is not reversed yet (voucher `press_run_reopen`, same line, `reversal_of`); the next close
 * numbers its lines after the highest line the run ever used, so the voucher-line unique index
 * never collides.
 */
import { productionDayWindow } from "./dayWindow";
import { sortPressQueue, type DieCopyStatus } from "@orrn/domain";
import { approval } from "@orrn/db/schema/approval";
import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { cast, returnStream } from "@orrn/db/schema/foundry";
import { dieIssue, pressLine, pressPlan, pressPlanDie, pressPlanLine, pressRemark, pressRun } from "@orrn/db/schema/press";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { stockLedger } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";
import { TRPCError } from "@trpc/server";
import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";

import type { ApplyCtx, ApprovalApplier } from "./approvalApply";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { assertDieAllowed } from "./dieOwner";
import { createId } from "./id";
import { defaultReturnStreamStatements } from "./foundry";
import { sqlUuid } from "./ledger";

export const DISCARD_STREAM = "DISCARD";
export const PLANT_SCRAP_STREAM = "PLANT-SCRAP";

/** Statuses where the run still holds the line or a copy (FP-PR-02 queue + station). */
export const LIVE_RUN_STATUSES = ["queued", "die_issued", "running", "stopped", "counting"] as const;

// ---------------------------------------------------------------------------
// Batch abort
// ---------------------------------------------------------------------------

/**
 * A statement that fails the WHOLE batch unless `landed` holds at that point (it inserts a
 * `press_remark` row with a NULL id: NOT NULL violation). Catch with `isPressAbort`, then re-read
 * to give the precise refusal (D1 has no transactions).
 */
export function pressAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  const nulls = Object.fromEntries(
    Object.entries(getTableColumns(pressRemark)).map(([key, column]) => [key, sql`null`.as(column.name)]),
  );
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("press_abort_src");
  return db.insert(pressRemark).select(db.select(nulls).from(from).where(sql`not (${landed})`) as never);
}

export function isPressAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes("NOT NULL constraint failed: press_remark.id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Error text through the `cause` chain (unique-index names live in the driver's message). */
export function pressErrorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

/** EXISTS: the run is in `status` and carries this request's sequence (it landed in this batch). */
export function runLanded(runId: string, seq: number, status: string | readonly string[]): SQL {
  const list = typeof status === "string" ? [status] : [...status];
  return sql`exists (select 1 from press_run lr where lr.id = ${runId} and lr.server_seq = ${seq} and lr.status in (${sql.join(
    list.map((s) => sql`${s}`),
    sql`, `,
  )}))`;
}

// ---------------------------------------------------------------------------
// Loading a run
// ---------------------------------------------------------------------------

export async function loadRun(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select({
      run: pressRun,
      purpose: pressPlan.purpose,
      planNumber: pressPlan.number,
      planStatus: pressPlan.status,
      urgent: pressPlanDie.urgent,
      sectionCode: die.sectionCode,
      sectionName: die.name,
      series: die.series,
      drawingKey: die.drawingKey,
    })
    .from(pressRun)
    .innerJoin(die, and(eq(die.id, pressRun.sectionId), eq(die.companyId, pressRun.companyId)))
    .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
    .leftJoin(pressPlanDie, and(eq(pressPlanDie.id, pressRun.pressPlanDieId), eq(pressPlanDie.companyId, pressRun.companyId)))
    .where(and(eq(pressRun.id, id), eq(pressRun.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
  return {
    ...row.run,
    purpose: (row.purpose ?? "production") as "production" | "die_trial" | "sample" | "other",
    planNumber: row.planNumber,
    planStatus: row.planStatus,
    urgent: Boolean(row.urgent),
    sectionCode: row.sectionCode,
    sectionName: row.sectionName,
    series: row.series,
    drawingKey: row.drawingKey,
  };
}
export type LoadedRun = Awaited<ReturnType<typeof loadRun>>;

/** Company settings (JSON) for the shift and the balance warn. */
export async function companySettings(db: OrrnDb, companyId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return (row?.settings ?? {}) as Record<string, unknown>;
}

/** Production day + shift at an instant (FP-PR-13, C14/C15): `resolveShift` through the day window. */
export function shiftAt(settings: Record<string, unknown>, atMs: number): { productionDay: string; shiftSeq: number | null; shiftId: string | null } {
  const w = productionDayWindow(settings, atMs);
  return { productionDay: w.productionDay, shiftSeq: w.shift?.seq ?? null, shiftId: w.shift?.id ?? null };
}

/** The numeric part of `PR-12` (queue tie-break inside one FY). */
export function runSeqOf(number: string): number {
  const m = /(\d+)\s*$/.exec(number);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// Return streams and the close ledger
// ---------------------------------------------------------------------------

/** DISCARD / PLANT-SCRAP stream ids, adding the default streams first when the plant has none. */
export async function pressStreams(db: OrrnDb, companyId: string, userId: string | null, seq: number): Promise<{ discardId: string; plantScrapId: string }> {
  const read = () =>
    db
      .select({ id: returnStream.id, code: returnStream.code })
      .from(returnStream)
      .where(and(eq(returnStream.companyId, companyId), inArray(returnStream.code, [DISCARD_STREAM, PLANT_SCRAP_STREAM])));
  let rows = await read();
  if (rows.length < 2) {
    await atomicBatch(db, defaultReturnStreamStatements(db, companyId, { userId, seq }));
    rows = await read();
  }
  const discard = rows.find((r) => r.code === DISCARD_STREAM);
  const scrap = rows.find((r) => r.code === PLANT_SCRAP_STREAM);
  if (!discard || !scrap) throw new TRPCError({ code: "BAD_REQUEST", message: "Add the DISCARD and PLANT-SCRAP return streams first" });
  return { discardId: discard.id, plantScrapId: scrap.id };
}

/** Highest ledger line any posting of this run ever used (close and reopen share the numbering). */
export async function lastLedgerLine(db: OrrnDb, companyId: string, runId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${stockLedger.line}), 0)` })
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.companyId, companyId),
        eq(stockLedger.voucherId, runId),
        inArray(stockLedger.voucherType, ["press_run", "press_run_reopen"]),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Billets of a cast on hand (Σ ledger, item `billet`, item_ref = cast id) as SQL. */
export function billetOnHandSql(companyId: string, castId: string): SQL<number> {
  return sql<number>`coalesce((select sum(bl.qty_g) from stock_ledger bl where bl.company_id = ${companyId} and bl.item_kind = 'billet' and bl.item_ref = ${castId}), 0)`;
}

/**
 * W2-FD-S r2 (m-c): the billets of a cast the press may count on. The ledger, plus the count
 * adjustment frozen in the close summary while the cast is `closing` (waiting for `cast_close`): the
 * yard was counted, so the press is judged against counted − what it used since, not the uncorrected
 * ledger. The approval then posts that adjustment (`cast_tail`), so the ledger agrees; a reject clears
 * it. Both signs: fewer counted records a short, more counted is usable without a false short.
 */
export function billetUsableSql(companyId: string, castId: string): SQL<number> {
  return sql<number>`(${billetOnHandSql(companyId, castId)} + coalesce((select json_extract(uc.close_summary, '$.adjustG') from ${cast} uc where uc.id = ${castId} and uc.company_id = ${companyId} and uc.status = 'closing'), 0))`;
}

/** One cast's share of a run's billets (W2-FD-S r1: a run may use billets of several casts). */
export type CloseBilletCharge = {
  castId: string;
  castNumber: string;
  /** Σ this cast's billet rows, grams (the row posts −inputG). */
  inputG: number;
  /**
   * D22: the cast's billets on hand the row needs at write time: min(input, on hand as read). Equal
   * to `inputG` when the store covered it; less (even below zero) when the close records a shortfall.
   */
  guardG: number;
};

export type CloseLedgerInput = {
  companyId: string;
  runId: string;
  runNumber: string;
  seq: number;
  userId: string;
  at: Date;
  firstLine: number;
  billetStoreId: string;
  plantScrapLocationId: string | null;
  streams: { discardId: string; plantScrapId: string } | null;
  /** One entry per cast the billet rows name, the run's own cast first. */
  billets: readonly CloseBilletCharge[];
  discardG: number;
  endsG: number;
  rejectG: number;
};

/**
 * The close's ledger rows. One billet row per cast (−that cast's weighed kg, item_ref = the cast),
 * each an INSERT … SELECT that lands only while the run is `logged` by this request and THAT cast's
 * billets on hand (read inside the statement) are still at least its `guardG`; the caller adds a
 * `pressAbortUnless` per line (`billetLines`). Scrap rows are plain values (they only add stock).
 */
export function closeLedgerStatements(
  db: OrrnDb,
  i: CloseLedgerInput,
): { statements: SqliteBatchItem[]; billetLine: number; billetLines: number[]; lines: number } {
  const statements: SqliteBatchItem[] = [];
  const billetLine = i.firstLine;
  const at = i.at.getTime();
  const billetLines: number[] = [];
  let line = billetLine - 1;
  for (const b of i.billets) {
    line += 1;
    billetLines.push(line);
    // Keys follow stock_ledger's column order (insert-select rule).
    statements.push(
      db.insert(stockLedger).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            companyId: sql<string>`${i.companyId}`.as("company_id"),
            serverSeq: sql<number>`${i.seq}`.as("server_seq"),
            voucherType: sql<string>`'press_run'`.as("voucher_type"),
            voucherId: sql<string>`${i.runId}`.as("voucher_id"),
            line: sql<number>`${line}`.as("line"),
            itemKind: sql<string>`'billet'`.as("item_kind"),
            itemRef: sql<string>`${b.castId}`.as("item_ref"),
            locationId: sql<string>`${i.billetStoreId}`.as("location_id"),
            qtyG: sql<number>`${-b.inputG}`.as("qty_g"),
            postedAt: sql<number>`${at}`.as("posted_at"),
            reversalOf: sql<string | null>`null`.as("reversal_of"),
            reason: sql<string>`${`${i.runNumber} billets of ${b.castNumber}`}`.as("reason"),
            createdBy: sql<string>`${i.userId}`.as("created_by"),
            createdAt: sql<number>`${at}`.as("created_at"),
          })
          .from(company)
          .where(and(eq(company.id, i.companyId), runLanded(i.runId, i.seq, "logged"), sql`${billetUsableSql(i.companyId, b.castId)} >= ${b.guardG}`)),
      ),
    );
  }
  const scrap = (itemRef: string, qtyG: number, reason: string) => {
    line += 1;
    statements.push(
      db.insert(stockLedger).values({
        id: crypto.randomUUID(),
        companyId: i.companyId,
        serverSeq: i.seq,
        voucherType: "press_run",
        voucherId: i.runId,
        line,
        itemKind: "return_stream",
        itemRef,
        locationId: i.plantScrapLocationId,
        qtyG,
        postedAt: i.at,
        reversalOf: null,
        reason,
        createdBy: i.userId,
        createdAt: i.at,
      }),
    );
  };
  if (i.streams && i.plantScrapLocationId) {
    if (i.discardG > 0) scrap(i.streams.discardId, i.discardG, `${i.runNumber} butt`);
    if (i.endsG > 0) scrap(i.streams.plantScrapId, i.endsG, `${i.runNumber} ends`);
    if (i.rejectG > 0) scrap(i.streams.plantScrapId, i.rejectG, `${i.runNumber} rejects`);
  }
  return { statements, billetLine, billetLines, lines: line - billetLine + 1 };
}

/** EXISTS: the close's billet row of this request landed. */
export function billetPostedSql(companyId: string, runId: string, line: number, seq: number): SQL {
  return sql`exists (select 1 from stock_ledger pl where pl.company_id = ${companyId} and pl.voucher_type = 'press_run' and pl.voucher_id = ${runId} and pl.line = ${line} and pl.server_seq = ${seq})`;
}

// ---------------------------------------------------------------------------
// Issue after log (C43)
// ---------------------------------------------------------------------------

export type NextRunCandidate = {
  id: string;
  number: string;
  status: string;
  sectionId: string;
  dieInstanceId: string | null;
  pressPlanDieId: string | null;
  queuePos: number | null;
  urgent: boolean;
  purpose: string;
};

/** Queued / die_issued runs of a line in queue order (urgent first, then queue_pos, then number). */
export async function lineQueue(db: OrrnDb, companyId: string, pressLineId: string, excludeRunId?: string): Promise<NextRunCandidate[]> {
  const rows = await db
    .select({
      id: pressRun.id,
      number: pressRun.number,
      period: pressRun.period,
      status: pressRun.status,
      sectionId: pressRun.sectionId,
      dieInstanceId: pressRun.dieInstanceId,
      pressPlanDieId: pressRun.pressPlanDieId,
      queuePos: pressRun.queuePos,
      urgent: pressPlanDie.urgent,
      purpose: pressPlan.purpose,
    })
    .from(pressRun)
    .leftJoin(pressPlanDie, and(eq(pressPlanDie.id, pressRun.pressPlanDieId), eq(pressPlanDie.companyId, pressRun.companyId)))
    .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.pressLineId, pressLineId), inArray(pressRun.status, ["queued", "die_issued"])))
    .limit(500);
  const list = rows
    .filter((r) => r.id !== excludeRunId)
    .map((r) => ({
      ...r,
      urgent: Boolean(r.urgent),
      purpose: r.purpose ?? "production",
      // FY first (2026-27 before 2027-28), then the number.
      seq: Number(r.period.replace(/\D/g, "").slice(0, 4) || 0) * 1_000_000 + runSeqOf(r.number),
    }));
  return sortPressQueue(list).map(({ seq: _seq, period: _period, ...r }) => r);
}

// ---------------------------------------------------------------------------
// Approval appliers (FP-PR-20)
// ---------------------------------------------------------------------------

function decisionLandedSql(ctx: ApplyCtx, approvalId: string, decision: "approved" | "rejected"): SQL {
  return sql`exists (select 1 from ${approval} a where a.id = ${approvalId} and a.company_id = ${ctx.companyId} and a.server_seq = ${ctx.seq} and a.status = ${decision})`;
}

function applierAudit(ctx: ApplyCtx, action: string, subjectId: string | SQL, meta: Record<string, unknown>, guard: SQL, subjectType = "press_run"): SqliteBatchItem {
  // Keys follow audit_log's column order (insert-select rule).
  return ctx.db.insert(auditLog).select(
    ctx.db
      .select({
        id: sql<string>`${createId()}`.as("id"),
        companyId: sql<string>`${ctx.companyId}`.as("company_id"),
        actorId: sql<string | null>`${ctx.userId}`.as("actor_id"),
        impersonatorId: sql<string | null>`null`.as("impersonator_id"),
        action: sql<string>`${action}`.as("action"),
        subjectType: sql<string>`${subjectType}`.as("subject_type"),
        subjectId: sql<string>`${subjectId}`.as("subject_id"),
        meta: sql<string>`${JSON.stringify(meta)}`.as("meta"),
        at: sql<number>`${ctx.decidedAt.getTime()}`.as("at"),
      })
      .from(company)
      .where(and(eq(company.id, ctx.companyId), guard)),
  );
}

/**
 * `press_time` (FP-PR-06): approved → the run's times are confirmed (`time_unconfirmed` off), so
 * the close gate passes. Rejected: nothing changes; the supervisor may ask again.
 */
export const pressTimeDecision: ApprovalApplier = (ctx, row, decision) => {
  if (decision === "rejected") return [];
  return [
    ctx.db
      .update(pressRun)
      .set({ timeUnconfirmed: false, serverSeq: ctx.seq, updatedAt: ctx.decidedAt })
      .where(and(eq(pressRun.id, row.subjectId), eq(pressRun.companyId, ctx.companyId), decisionLandedSql(ctx, row.id, decision))),
  ];
};

/**
 * `press_late_entry` (FP-PR-24): approved → the run's `late_entry_approval_id` names this approval
 * (the close gate passes; billets still debit the cast at close). Rejected → the late run is voided
 * (it never posted anything: close is gated), and a copy it held goes back to the rack.
 */
export const pressLateEntryDecision: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq } = ctx;
  const subject = and(eq(pressRun.id, row.subjectId), eq(pressRun.companyId, companyId), eq(pressRun.lateEntry, true));
  if (decision === "approved") {
    return [
      db
        .update(pressRun)
        .set({ lateEntryApprovalId: row.id, serverSeq: seq, updatedAt: ctx.decidedAt })
        .where(and(subject, inArray(pressRun.status, ["counting", "logged"]), decisionLandedSql(ctx, row.id, decision))),
    ];
  }
  const voided = sql`exists (select 1 from press_run v where v.id = ${row.subjectId} and v.company_id = ${companyId} and v.status = 'voided' and v.server_seq = ${seq})`;
  return [
    db
      .update(pressRun)
      .set({ status: "voided", voidedAt: ctx.decidedAt, voidNote: "Late entry rejected", serverSeq: seq, updatedAt: ctx.decidedAt })
      .where(and(subject, eq(pressRun.status, "counting"), decisionLandedSql(ctx, row.id, decision))),
    db
      .update(dieIssue)
      .set({ status: "returned", returnedAt: ctx.decidedAt, returnedBy: ctx.userId, serverSeq: seq })
      .where(and(eq(dieIssue.companyId, companyId), eq(dieIssue.pressRunId, row.subjectId), eq(dieIssue.status, "issued"), voided)),
    db
      .update(dieInstance)
      .set({ status: "available", serverSeq: seq })
      .where(
        and(
          eq(dieInstance.companyId, companyId),
          eq(dieInstance.status, "in_use"),
          sql`exists (select 1 from die_issue ri where ri.company_id = ${companyId} and ri.die_instance_id = ${dieInstance.id} and ri.press_run_id = ${row.subjectId} and ri.status = 'returned' and ri.server_seq = ${seq})`,
          sql`not exists (select 1 from die_issue oi where oi.company_id = ${companyId} and oi.die_instance_id = ${dieInstance.id} and oi.status = 'issued')`,
        ),
      ),
    applierAudit(ctx, "press_run.void", row.subjectId, { via: "press_late_entry", approvalId: row.id }, voided),
  ];
};

/**
 * `press_reopen` (FP-PR-20): approved → logged back to counting in the decision's batch, and every
 * `press_run` ledger row of the run that is not reversed yet is reversed (voucher
 * `press_run_reopen`, same line, `reversal_of`). The figures written at log are cleared (the next
 * close computes them again); the rows under the run stay for editing. Rejected: nothing.
 * There are no ageing rows yet (Wave 3), so nothing can have loaded the run's pieces.
 * A die trial whose pass put the copy on the rack (the copy is still `available` and its latest
 * issue is this run's trial issue; for a late entry with no issue, its latest trial audit is this
 * run's `die_trial.pass`) puts the copy back `on_trial` with audit `die_trial.reopen`; the next
 * close applies the new verdict through lib/dieTrial (I-4). A copy issued again since stays.
 */
export const pressReopenDecision: ApprovalApplier = (ctx, row, decision) => {
  if (decision === "rejected") return [];
  const { db, companyId, seq } = ctx;
  const reopened = runLanded(row.subjectId, seq, "counting");
  const O = (c: string) => sql`${sql.identifier("orig")}.${sql.identifier(c)}`;
  const at = ctx.decidedAt.getTime();
  return [
    db
      .update(pressRun)
      .set({
        status: "counting",
        loggedAt: null,
        inputG: null,
        inputWeighedG: null,
        goodG: null,
        rejectG: null,
        recoveryBp: null,
        balanceG: null,
        billetShortG: null,
        trialResult: null,
        serverSeq: seq,
        updatedAt: ctx.decidedAt,
      })
      .where(and(eq(pressRun.id, row.subjectId), eq(pressRun.companyId, companyId), eq(pressRun.status, "logged"), decisionLandedSql(ctx, row.id, decision))),
    db
      .update(dieInstance)
      .set({ status: "on_trial", serverSeq: seq })
      .where(
        and(
          eq(dieInstance.companyId, companyId),
          eq(dieInstance.status, "available"),
          sql`${dieInstance.id} = (select tr.die_instance_id from press_run tr where tr.id = ${row.subjectId} and tr.company_id = ${companyId})`,
          sql`(
            (select li.press_run_id || ':' || li.trial || ':' || li.status from die_issue li
              where li.company_id = ${companyId} and li.die_instance_id = ${dieInstance.id}
              order by li.issued_at desc, li.rowid desc limit 1) = ${`${row.subjectId}:1:returned`}
            or (not exists (select 1 from die_issue ni where ni.company_id = ${companyId} and ni.die_instance_id = ${dieInstance.id} and ni.press_run_id = ${row.subjectId})
              and (select la.action || ':' || coalesce(json_extract(la.meta, '$.pressRunId'), '') from audit_log la
                where la.company_id = ${companyId} and la.subject_type = 'die_instance' and la.subject_id = ${dieInstance.id} and la.action like 'die_trial.%'
                order by la.at desc, la.rowid desc limit 1) = ${`die_trial.pass:${row.subjectId}`})
          )`,
          reopened,
        ),
      ),
    applierAudit(
      ctx,
      "die_trial.reopen",
      sql`(select tr.die_instance_id from press_run tr where tr.id = ${row.subjectId} and tr.company_id = ${companyId})`,
      { pressRunId: row.subjectId, approvalId: row.id, from: "available", to: "on_trial" },
      sql`exists (select 1 from die_instance rc where rc.company_id = ${companyId} and rc.status = 'on_trial' and rc.server_seq = ${seq}
        and rc.id = (select tr.die_instance_id from press_run tr where tr.id = ${row.subjectId} and tr.company_id = ${companyId}))`,
      "die_instance",
    ),
    db.insert(stockLedger).select(
      sql`select ${sqlUuid}, ${O("company_id")}, ${seq}, 'press_run_reopen', ${O("voucher_id")}, ${O("line")}, ${O("item_kind")}, ${O("item_ref")}, ${O(
        "location_id",
      )}, -${O("qty_g")}, ${at}, ${O("id")}, 'Reopened', ${ctx.userId}, ${at}
        from stock_ledger orig
        where orig.company_id = ${companyId} and orig.voucher_type = 'press_run' and orig.voucher_id = ${row.subjectId}
          and not exists (select 1 from stock_ledger rv where rv.company_id = ${companyId} and rv.reversal_of = orig.id)
          and ${reopened}` as never,
    ),
    applierAudit(ctx, "press_run.reopen", row.subjectId, { approvalId: row.id }, reopened),
  ];
};

// ---------------------------------------------------------------------------
// Late entry: the copy is checked like an issue (I-1)
// ---------------------------------------------------------------------------

/** The issue screen's words for a copy that cannot go to a press (dieIssue.ts STATUS_WORDS). */
const COPY_STATUS_WORDS: Record<string, string> = {
  in_use: "is already issued to a press",
  at_nitriding: "is out at nitriding",
  at_maker: "is at the die maker",
  retired: "is retired",
  on_trial: "is on trial",
};

/** A late entry may be at most this many days old (m-3). */
export const LATE_ENTRY_MAX_DAYS = 7;

/**
 * Check a die copy for a late entry exactly as `dieInstance.issues.issue` would (same words): the
 * copy is of the run's die, not issued to another run, `available` (or `on_trial` for a die trial
 * run), and every party the run presses for may use it (`assertDieAllowed`, purpose press). The
 * run's own open issue counts as fine (a die_issued run entered late).
 */
export async function assertLateEntryCopy(
  db: OrrnDb,
  companyId: string,
  input: {
    copyId: string;
    run: { id: string; number: string; sectionId: string; pressPlanDieId: string | null; purpose: string } | null;
  },
): Promise<{ id: string; code: string; sectionId: string; status: DieCopyStatus }> {
  const [copy] = await db
    .select({ id: dieInstance.id, code: dieInstance.code, sectionId: dieInstance.sectionId, status: dieInstance.status })
    .from(dieInstance)
    .where(and(eq(dieInstance.id, input.copyId), eq(dieInstance.companyId, companyId)))
    .limit(1);
  if (!copy) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
  const bad = (message: string): never => {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  };
  const run = input.run;
  if (run && copy.sectionId !== run.sectionId) bad(`${copy.code} is not a copy of the die ${run.number} needs`);
  const [open] = await db
    .select({ id: dieIssue.id, pressRunId: dieIssue.pressRunId, lineCode: pressLine.code })
    .from(dieIssue)
    .innerJoin(pressLine, and(eq(pressLine.id, dieIssue.pressLineId), eq(pressLine.companyId, dieIssue.companyId)))
    .where(and(eq(dieIssue.companyId, companyId), eq(dieIssue.dieInstanceId, copy.id), eq(dieIssue.status, "issued")))
    .limit(1);
  const ownIssue = Boolean(open && run && open.pressRunId === run.id);
  if (open && !ownIssue) throw new TRPCError({ code: "CONFLICT", message: `${copy.code} is already issued to ${open.lineCode}` });
  if (!ownIssue) {
    if (copy.status === "on_trial") {
      if (run?.purpose !== "die_trial") bad(`${copy.code} is on trial; it goes only to a die trial run until the trial passes or a manager releases it`);
    } else if (copy.status !== "available") {
      bad(`${copy.code} ${COPY_STATUS_WORDS[copy.status] ?? `is ${copy.status}`}`);
    }
  }
  if (run?.pressPlanDieId) {
    const customers = await db
      .selectDistinct({ customerId: salesOrder.customerId })
      .from(pressPlanLine)
      .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
      .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
      .where(and(eq(pressPlanLine.companyId, companyId), eq(pressPlanLine.pressPlanDieId, run.pressPlanDieId)));
    for (const { customerId } of customers) await assertDieAllowed(db, companyId, { dieInstanceId: copy.id, customerId, purpose: "press" });
  }
  return copy;
}
