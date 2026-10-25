/**
 * Press runs at the station (FP-PR-03..16, 20, 23, 24; specs §E3), mounted as `press.runs`.
 *
 * State machine (`@orrn/domain` pressRunNext): queued → die_issued (die room issue) → running
 * (Start, server time) ⇄ stopped (Stop / Resume) → counting (Count) → logged (supervisor Log run)
 * → counting again only through an approved `press_reopen`. queued | die_issued → voided. Start
 * needs `die_issued` AND an open die issue of the run's copy on the run's line naming this run; a
 * queued run answers "Die not issued. Start is locked." One running run per line (CONFLICT).
 *
 * Every figure is the server's: recovery, balance, input (Σ billet kg as weighed, D22), good,
 * rejects, the billets short of the store (`billet_short_g`). A client never sends them (zod
 * strips them).
 * Times are the server's; a device tap more than 2 min away marks the run `time_unconfirmed`
 * and asks a `press_time` approval (the close waits for it).
 *
 * Writes under `counting` (billets, pieces, QC, butt and ends) bump the run's `server_seq`; the
 * close writes only on the sequence it read, so a row changed after the read fails it (CONFLICT).
 * The close is ONE batch: run logged with its figures, the ledger rows (voucher `press_run`), the
 * die issue returned or carried to the next queued run of the same copy (C43), a trial verdict
 * on the copy (die_trial), audit `press_run.close`.
 *
 * Idempotency (FP-PR-19 groundwork): a transition sent again with the same `clientMutationId`
 * answers `{ replayed: true }` without writing.
 *
 * Audit: press_run.open / start / stop / resume / undo_start / count / handover / close / void /
 * reopen_request / time_request, press_remark.add, die_remark.add.
 */
import {
  bpPercent1,
  closeFigures,
  closeGates,
  readFloorSettings,
  skewUnconfirmed,
  theoreticalHintG,
  type CloseGateError,
  type PressRunStatus,
} from "@orrn/domain";
import { approval } from "@orrn/db/schema/approval";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance, dieWeightReading } from "@orrn/db/schema/dies";
import { cast } from "@orrn/db/schema/foundry";
import {
  dieIssue,
  dieRemark,
  pressBilletUse,
  pressDowntime,
  pressLine,
  pressPlan,
  pressPlanLine,
  pressRemark,
  pressRun,
  pressRunLine,
  pressRunStatuses,
  qcEntry,
} from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { membership } from "@orrn/db/schema/tenant";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { signDieFileUrl } from "../lib/dieFiles";
import { checkDieAllowed, assertDieAllowed } from "../lib/dieOwner";
import { nextDocNumber } from "../lib/docNumber";
import { TRPCMetaError } from "../lib/errorMeta";
import { resolveBilletStore, resolvePlantScrap } from "../lib/foundry";
import { can, type CompanyRole } from "../lib/permissions";
import {
  billetOnHandSql,
  billetPostedSql,
  closeLedgerStatements,
  companySettings,
  isPressAbort,
  lastLedgerLine,
  lineQueue,
  loadRun,
  pressAbortUnless,
  pressErrorText,
  pressStreams,
  runLanded,
  shiftAt,
  assertLateEntryCopy,
  LATE_ENTRY_MAX_DAYS,
  trialVerdictStatements,
  type LoadedRun,
} from "../lib/press";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const clientMutationId = z.string().trim().min(8).max(64).optional();
const grams = z.number().int().min(0).max(100_000_000);
const reason = z.string().trim().min(1).max(500);

export const MAX_RUN_LINES = 50;
export const MAX_QC_ROWS = 30;
export const MAX_BILLET_INPUT_ROWS = 10;

type Ctx = {
  db: OrrnDb;
  companyId: string;
  role: CompanyRole;
  session: { user: { id: string } };
  impersonation?: unknown;
};

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

const GATE_TEXT: Record<CloseGateError, string> = {
  not_counting: "Only a run being counted can be logged",
  no_close_permission: "Only a supervisor or manager can log a run",
  not_supervisor: "Only the run's supervisor can log it",
  no_cast: "Pick the cast the billets came from",
  no_billets: "Enter the billets used",
  too_many_billets: "At most 10 billet rows on a run",
  billet_row_invalid: "Every billet row needs a count and its kg",
  billet_cast_mismatch: "Every billet row must be of the run's cast",
  no_input: "The billets weigh nothing; enter their kg",
  no_lines: "Enter the pieces by cut length",
  line_without_kg: "A cut length with pieces needs its kg",
  line_invalid: "A cut length row is not valid",
  no_good: "Enter the good pieces and their kg",
  good_over_input: "Good kg is more than the billets that went in",
  pieces_over_pressed_length: "The pieces are longer in total than the pressed length",
  no_qc: "Enter the rejects (0 when there were none)",
  qc_row_invalid: "A reject row is not valid",
  qc_reason_missing: "Every reject needs a reason",
  qc_note_missing: "A reject marked Other needs a note",
  billet_short_reason_missing: "The billet store has less of this cast than entered; give the reason",
  time_unconfirmed: "The start or stop time is waiting for a supervisor to confirm it",
  late_entry_unapproved: "This late entry is waiting for approval",
  downtime_open: "Stop the open downtime first",
  trial_result_missing: "Say whether the die trial passed or failed",
};

function gateError(errors: CloseGateError[]): never {
  throw new TRPCMetaError({ code: "BAD_REQUEST", message: GATE_TEXT[errors[0]!], meta: { gates: errors } });
}

async function memberRole(db: OrrnDb, companyId: string, userId: string): Promise<CompanyRole | null> {
  const [row] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.userId, userId)))
    .limit(1);
  return (row?.role as CompanyRole | undefined) ?? null;
}

const canRole = (role: CompanyRole, action: Parameters<typeof can>[1]) => can({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

async function requireOperator(db: OrrnDb, companyId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const role = await memberRole(db, companyId, userId);
  if (!role) bad("That person is not a member of this plant");
  // m-5: an operator or relief is a floor hand (press.run, or the legacy `operator` role), or a
  // supervisor standing in; office, accounts, packers and viewers are refused.
  if (role !== "operator" && !canRole(role!, "press.run") && !canRole(role!, "press.close")) bad("The operator must be someone who runs the press");
  return userId;
}

async function requireSupervisor(db: OrrnDb, companyId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const role = await memberRole(db, companyId, userId);
  if (!role) bad("That person is not a member of this plant");
  if (!canRole(role!, "press.close")) bad("The supervisor must be someone who can log runs");
  return userId;
}

/** Find a run by id or by its plan die (the live run of that die). */
async function findRun(db: OrrnDb, companyId: string, input: { id?: string; pressPlanDieId?: string }): Promise<LoadedRun> {
  if (input.id) return loadRun(db, companyId, input.id);
  const [row] = await db
    .select({ id: pressRun.id })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.pressPlanDieId, input.pressPlanDieId!), sql`${pressRun.status} <> 'voided'`))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
  return loadRun(db, companyId, row.id);
}

function replayed(run: LoadedRun, cmid: string | undefined, statuses: readonly PressRunStatus[]) {
  return Boolean(cmid && run.clientMutationId === cmid && statuses.includes(run.status));
}

const STATUS_WORD: Record<PressRunStatus, string> = {
  queued: "queued",
  die_issued: "waiting to start",
  running: "running",
  stopped: "stopped",
  counting: "being counted",
  logged: "logged",
  voided: "voided",
};

function requireStatus(run: LoadedRun, allowed: readonly PressRunStatus[], what: string) {
  if (allowed.includes(run.status)) return;
  if (run.status === "queued" && allowed.includes("die_issued")) bad("Die not issued. Start is locked.");
  bad(`${run.number} is ${STATUS_WORD[run.status]}; ${what}`);
}

/** Pending approval of `kind` for this run (one open per kind and subject). */
async function pendingApproval(db: OrrnDb, companyId: string, kind: "press_time" | "press_reopen" | "press_late_entry", runId: string) {
  const [row] = await db
    .select({ id: approval.id, status: approval.status, requestedBy: approval.requestedBy })
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, kind), eq(approval.subjectId, runId), eq(approval.status, "pending")))
    .limit(1);
  return row ?? null;
}

/** Explain a failed transition batch from the state now. */
async function explainTransition(ctx: Ctx, runId: string, e: unknown, what: string): Promise<never> {
  const text = pressErrorText(e);
  if (text.includes("press_run_line_running_unique") || text.includes("press_run.press_line_id")) {
    throw new TRPCError({ code: "CONFLICT", message: "Another run is running on this press; stop it first" });
  }
  if (isPressAbort(e)) {
    const now = await loadRun(ctx.db, ctx.companyId, runId);
    throw new TRPCError({ code: "CONFLICT", message: `${now.number} is ${STATUS_WORD[now.status]} now; ${what} was not saved. Reload.` });
  }
  throw e;
}

async function runningOnLine(db: OrrnDb, companyId: string, pressLineId: string | null, exceptId: string) {
  if (!pressLineId) return null;
  const [row] = await db
    .select({ id: pressRun.id, number: pressRun.number })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.pressLineId, pressLineId), eq(pressRun.status, "running")))
    .limit(1);
  return row && row.id !== exceptId ? row : null;
}

function timeRequest(ctx: Ctx, run: LoadedRun, seq: number, meta: Record<string, unknown>) {
  return requestApprovalInsert(ctx as never, {
    kind: "press_time",
    subjectId: run.id,
    serverSeq: seq,
    requestNote: `${run.number}: device time differs from server time by more than 2 minutes`,
    meta: { runNumber: run.number, ...meta },
    guard: { from: pressRun, where: and(eq(pressRun.id, run.id), eq(pressRun.serverSeq, seq), eq(pressRun.timeUnconfirmed, true)) },
  });
}

/**
 * One status move: UPDATE … WHERE status in `from` (and `where`), then an abort unless the run is
 * `to` with this request's sequence, extra statements, the audit row.
 */
async function moveRun(
  ctx: Ctx,
  run: LoadedRun,
  opts: {
    from: readonly PressRunStatus[];
    to: PressRunStatus;
    set: Partial<typeof pressRun.$inferInsert>;
    where?: SQL;
    clientMutationId?: string;
    audit: string;
    meta?: Record<string, unknown>;
    extra?: (seq: number) => SqliteBatchItem[];
    what: string;
  },
): Promise<number> {
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const at = clockNow();
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(pressRun)
      .set({ ...opts.set, status: opts.to, serverSeq: seq, updatedAt: at, ...(opts.clientMutationId ? { clientMutationId: opts.clientMutationId } : {}) })
      .where(and(eq(pressRun.id, run.id), eq(pressRun.companyId, ctx.companyId), inArray(pressRun.status, [...opts.from]), opts.where)),
    pressAbortUnless(ctx.db, runLanded(run.id, seq, opts.to)),
    ...(opts.extra?.(seq) ?? []),
    auditInsert(ctx as never, {
      action: opts.audit,
      subjectType: "press_run",
      subjectId: run.id,
      meta: { number: run.number, from: run.status, to: opts.to, ...opts.meta },
    }),
  ];
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    await explainTransition(ctx, run.id, e, opts.what);
  }
  return seq;
}

/** The counting step's UPDATE: bump the run's sequence while it is still `counting`. */
function bumpCounting(ctx: Ctx, runId: string, seq: number, at: Date, set: Partial<typeof pressRun.$inferInsert> = {}): SqliteBatchItem[] {
  return [
    ctx.db
      .update(pressRun)
      .set({ ...set, serverSeq: seq, updatedAt: at })
      .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, ctx.companyId), eq(pressRun.status, "counting"))),
    pressAbortUnless(ctx.db, runLanded(runId, seq, "counting")),
  ];
}

async function writeCounting(ctx: Ctx, run: LoadedRun, statements: SqliteBatchItem[]) {
  try {
    await atomicBatch(ctx.db, statements);
  } catch (e) {
    await explainTransition(ctx, run.id, e, "the count");
  }
}

// ---------------------------------------------------------------------------
// Reading what the close needs
// ---------------------------------------------------------------------------

async function runChildren(db: OrrnDb, companyId: string, runId: string) {
  const [lines, billets, qc, downtime] = await Promise.all([
    db
      .select({
        id: pressRunLine.id,
        line: pressRunLine.line,
        pressPlanLineId: pressRunLine.pressPlanLineId,
        salesOrderLineId: pressRunLine.salesOrderLineId,
        cutLengthMm: pressRunLine.cutLengthMm,
        pcs: pressRunLine.pcs,
        goodG: pressRunLine.goodG,
        orderNumber: salesOrder.number,
        customerName: customer.name,
      })
      .from(pressRunLine)
      .leftJoin(salesOrderLine, and(eq(salesOrderLine.id, pressRunLine.salesOrderLineId), eq(salesOrderLine.companyId, pressRunLine.companyId)))
      .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
      .leftJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, salesOrder.companyId)))
      .where(and(eq(pressRunLine.companyId, companyId), eq(pressRunLine.pressRunId, runId)))
      .orderBy(asc(pressRunLine.line)),
    db
      .select({
        id: pressBilletUse.id,
        line: pressBilletUse.line,
        castId: pressBilletUse.castId,
        castNumber: cast.number,
        lengthMm: pressBilletUse.lengthMm,
        count: pressBilletUse.count,
        kgG: pressBilletUse.kgG,
      })
      .from(pressBilletUse)
      .innerJoin(cast, and(eq(cast.id, pressBilletUse.castId), eq(cast.companyId, pressBilletUse.companyId)))
      .where(and(eq(pressBilletUse.companyId, companyId), eq(pressBilletUse.pressRunId, runId)))
      .orderBy(asc(pressBilletUse.line)),
    db
      .select({
        id: qcEntry.id,
        line: qcEntry.line,
        pressRunLineId: qcEntry.pressRunLineId,
        reasonCodeId: qcEntry.reasonCodeId,
        reasonCode: reasonCode.code,
        reasonLabel: reasonCode.label,
        requiresNote: reasonCode.requiresNote,
        pcs: qcEntry.pcs,
        kgG: qcEntry.kgG,
        note: qcEntry.note,
      })
      .from(qcEntry)
      .leftJoin(reasonCode, and(eq(reasonCode.id, qcEntry.reasonCodeId), eq(reasonCode.companyId, qcEntry.companyId)))
      .where(and(eq(qcEntry.companyId, companyId), eq(qcEntry.pressRunId, runId)))
      .orderBy(asc(qcEntry.line)),
    db
      .select({
        id: pressDowntime.id,
        reasonCodeId: pressDowntime.reasonCodeId,
        reasonCode: reasonCode.code,
        reasonLabel: reasonCode.label,
        note: pressDowntime.note,
        startedAt: pressDowntime.startedAt,
        stoppedAt: pressDowntime.stoppedAt,
      })
      .from(pressDowntime)
      .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
      .where(and(eq(pressDowntime.companyId, companyId), eq(pressDowntime.pressRunId, runId)))
      .orderBy(asc(pressDowntime.startedAt)),
  ]);
  return { lines, billets, qc, downtime };
}

async function castOnHand(db: OrrnDb, companyId: string, castId: string | null): Promise<{ number: string | null; onHandG: number | null }> {
  if (!castId) return { number: null, onHandG: null };
  const [row] = await db
    .select({ number: cast.number, onHand: billetOnHandSql(companyId, castId) })
    .from(cast)
    .where(and(eq(cast.id, castId), eq(cast.companyId, companyId)))
    .limit(1);
  return { number: row?.number ?? null, onHandG: row ? Number(row.onHand) : null };
}

/** Gates + figures as the close would see them now (preview and close share it). */
async function evaluateClose(ctx: Ctx, run: LoadedRun, input: { billetShortReason?: string | null; trialResult?: "pass" | "fail" | null }) {
  const children = await runChildren(ctx.db, ctx.companyId, run.id);
  const settings = await companySettings(ctx.db, ctx.companyId);
  const floor = readFloorSettings(settings);
  const castInfo = await castOnHand(ctx.db, ctx.companyId, run.castId);
  const callerId = ctx.session.user.id;
  const errors = closeGates(
    {
      status: run.status,
      // No supervisor named: whoever logs it (with press.close) becomes it (Q-PR9).
      supervisorId: run.supervisorId ?? callerId,
      castId: run.castId,
      pressedLengthMm: run.pressedLengthMm,
      timeUnconfirmed: run.timeUnconfirmed,
      lateEntry: run.lateEntry,
      lateEntryApproved: Boolean(run.lateEntryApprovalId),
      billetShortReason: input.billetShortReason ?? run.billetShortReason,
      purpose: run.purpose,
      trialResult: input.trialResult ?? run.trialResult,
    },
    children.lines,
    children.billets,
    children.qc.map((q) => ({ pcs: q.pcs, kgG: q.kgG, reasonCode: q.reasonCode ?? null, reasonRequiresNote: Boolean(q.requiresNote), note: q.note })),
    children.downtime.map((d) => ({ stoppedAt: ms(d.stoppedAt) })),
    { balanceWarnBp: floor.press.balanceWarnBp },
    { callerId, callerCanClose: canRole(ctx.role, "press.close"), billetOnHandG: castInfo.onHandG },
  );
  const figures = closeFigures({
    billets: children.billets,
    lines: children.lines,
    qc: children.qc,
    discardG: run.discardG,
    endsG: run.endsG,
    billetOnHandG: castInfo.onHandG,
    balanceWarnBp: floor.press.balanceWarnBp,
  });
  return { children, errors, figures, castInfo, floor };
}

/** The copy's latest kg/12ft reading (for the theoretical hint; never stored). */
async function latestReading(db: OrrnDb, companyId: string, copyId: string | null): Promise<number | null> {
  if (!copyId) return null;
  const [row] = await db
    .select({ milli: dieWeightReading.kgPer12ftMilli })
    .from(dieWeightReading)
    .where(and(eq(dieWeightReading.companyId, companyId), eq(dieWeightReading.dieInstanceId, copyId)))
    .orderBy(desc(dieWeightReading.readAt))
    .limit(1);
  return row?.milli ?? null;
}

function figuresOut(f: ReturnType<typeof closeFigures>) {
  return {
    inputG: f.inputG,
    inputWeighedG: f.inputWeighedG,
    goodG: f.goodG,
    rejectG: f.rejectG,
    recoveryBp: f.recoveryBp,
    recoveryPct: f.recoveryBp == null ? null : bpPercent1(f.recoveryBp),
    balanceG: f.balanceG,
    balanceWarn: f.balanceWarn,
    short: f.short,
    billetShortG: f.billetShortG,
  };
}

// ---------------------------------------------------------------------------
// Issue hand-off at close (C43)
// ---------------------------------------------------------------------------

async function issueAtClose(ctx: Ctx, run: LoadedRun, trialResult: "pass" | "fail" | null) {
  if (!run.dieInstanceId) return { issue: null, carryTo: null as null | { id: string; number: string } };
  const [issue] = await ctx.db
    .select({ id: dieIssue.id, pressRunId: dieIssue.pressRunId, pressLineId: dieIssue.pressLineId })
    .from(dieIssue)
    .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, run.dieInstanceId), eq(dieIssue.status, "issued")))
    .limit(1);
  if (!issue || (issue.pressRunId && issue.pressRunId !== run.id)) return { issue: null, carryTo: null };
  // A die trial always goes back to the die room with its verdict.
  if (run.purpose === "die_trial" || trialResult || !run.pressLineId) return { issue, carryTo: null };
  // m-6: the copy stays only on the press it was issued to.
  if (issue.pressLineId !== run.pressLineId) return { issue, carryTo: null };
  const queue = await lineQueue(ctx.db, ctx.companyId, run.pressLineId, run.id);
  const next = queue[0];
  if (!next || next.status !== "queued" || next.dieInstanceId || next.sectionId !== run.sectionId || next.purpose === "die_trial") {
    return { issue, carryTo: null };
  }
  // The next job must not pin another copy, and every party it presses for may use this one.
  const prefs = await ctx.db
    .select({ preferred: pressPlanLine.preferredDieInstanceId, customerId: salesOrder.customerId })
    .from(pressPlanLine)
    .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
    .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanDieId, next.pressPlanDieId ?? "")));
  if (prefs.some((p) => p.preferred && p.preferred !== run.dieInstanceId)) return { issue, carryTo: null };
  for (const customerId of new Set(prefs.map((p) => p.customerId))) {
    const check = await checkDieAllowed(ctx.db, ctx.companyId, { dieInstanceId: run.dieInstanceId, customerId, purpose: "press" });
    if (!check.ok) return { issue, carryTo: null };
  }
  return { issue, carryTo: { id: next.id, number: next.number } };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const runRef = z.object({ id: id.optional(), pressPlanDieId: id.optional() }).refine((v) => Boolean(v.id || v.pressPlanDieId), "Name the run");

const billetRow = z.object({
  castId: id.optional(),
  lengthMm: z.number().int().min(1).max(20_000).nullable().optional(),
  count: z.number().int().min(0).max(10_000),
  kgG: grams,
});
const lineRow = z.object({
  cutLengthMm: z.number().int().min(1).max(30_000),
  pcs: z.number().int().min(0).max(1_000_000),
  goodG: grams,
  pressPlanLineId: id.nullable().optional(),
});
const qcRow = z.object({
  pcs: z.number().int().min(0).max(1_000_000),
  kgG: grams,
  reasonCodeId: id.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** The run line (1, 2, …) the rejects came from, optional. */
  runLine: z.number().int().min(1).max(MAX_RUN_LINES).nullable().optional(),
});

export const pressRunRouter = router({
  /** Runs, newest first; filters line / status / production day / plan. Any member. */
  list: companyProcedure
    .input(
      z
        .object({
          pressLineId: id.optional(),
          status: z.array(z.enum(pressRunStatuses)).max(7).optional(),
          productionDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          planId: id.optional(),
          dieInstanceId: id.optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(pressRun.companyId, ctx.companyId),
        input.pressLineId ? eq(pressRun.pressLineId, input.pressLineId) : undefined,
        input.status?.length ? inArray(pressRun.status, input.status) : undefined,
        input.productionDay ? eq(pressRun.productionDay, input.productionDay) : undefined,
        input.planId ? eq(pressRun.planId, input.planId) : undefined,
        input.dieInstanceId ? eq(pressRun.dieInstanceId, input.dieInstanceId) : undefined,
      );
      const rows = await ctx.db
        .select({
          id: pressRun.id,
          number: pressRun.number,
          status: pressRun.status,
          pressLineId: pressRun.pressLineId,
          lineCode: pressLine.code,
          sectionId: pressRun.sectionId,
          sectionCode: die.sectionCode,
          dieInstanceId: pressRun.dieInstanceId,
          copyCode: dieInstance.code,
          productionDay: pressRun.productionDay,
          shiftSeq: pressRun.shiftSeq,
          startedAt: pressRun.startedAt,
          stoppedAt: pressRun.stoppedAt,
          goodG: pressRun.goodG,
          inputG: pressRun.inputG,
          recoveryBp: pressRun.recoveryBp,
          lateEntry: pressRun.lateEntry,
          timeUnconfirmed: pressRun.timeUnconfirmed,
          purpose: pressPlan.purpose,
          planId: pressRun.planId,
        })
        .from(pressRun)
        .innerJoin(die, and(eq(die.id, pressRun.sectionId), eq(die.companyId, pressRun.companyId)))
        .leftJoin(pressLine, and(eq(pressLine.id, pressRun.pressLineId), eq(pressLine.companyId, pressRun.companyId)))
        .leftJoin(dieInstance, and(eq(dieInstance.id, pressRun.dieInstanceId), eq(dieInstance.companyId, pressRun.companyId)))
        .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
        .where(where)
        .orderBy(desc(pressRun.createdAt), desc(pressRun.number))
        .limit(input.limit + 1)
        .offset(input.offset);
      const items = rows.slice(0, input.limit).map((r) => ({ ...r, purpose: r.purpose ?? "production" }));
      return { items, nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
    }),

  /** Everything the station shows for one run, with the server's figures and close gates. */
  get: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const run = await loadRun(ctx.db, ctx.companyId, input.id);
    const evald = await evaluateClose(ctx as Ctx, run, {});
    const [planLines, line, copy, people, remarks, dieRemarks, openIssue, approvals, reading] = await Promise.all([
      run.pressPlanDieId
        ? ctx.db
            .select({
              id: pressPlanLine.id,
              salesOrderLineId: pressPlanLine.salesOrderLineId,
              cutLengthMm: pressPlanLine.cutLengthMm,
              pcs: pressPlanLine.pcs,
              kgG: pressPlanLine.kgG,
              orderId: salesOrder.id,
              orderNumber: salesOrder.number,
              poNumber: salesOrder.poNumber,
              customerName: customer.name,
              lineNo: salesOrderLine.lineNo,
            })
            .from(pressPlanLine)
            .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
            .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
            .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, salesOrder.companyId)))
            .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanDieId, run.pressPlanDieId)))
            .orderBy(asc(salesOrder.number), asc(salesOrderLine.lineNo))
        : Promise.resolve([]),
      run.pressLineId
        ? ctx.db.select({ id: pressLine.id, code: pressLine.code, name: pressLine.name }).from(pressLine).where(and(eq(pressLine.id, run.pressLineId), eq(pressLine.companyId, ctx.companyId))).limit(1)
        : Promise.resolve([]),
      run.dieInstanceId
        ? ctx.db
            .select({ id: dieInstance.id, code: dieInstance.code, status: dieInstance.status, bolster: dieInstance.bolster, backerNo: dieInstance.backerNo })
            .from(dieInstance)
            .where(and(eq(dieInstance.id, run.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
            .limit(1)
        : Promise.resolve([]),
      ctx.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, [run.operatorId, run.reliefOperatorId, run.supervisorId].filter((x): x is string => Boolean(x)).concat(["-"]))),
      ctx.db
        .select({ id: pressRemark.id, body: pressRemark.body, createdAt: pressRemark.createdAt, createdBy: pressRemark.createdBy })
        .from(pressRemark)
        .where(and(eq(pressRemark.companyId, ctx.companyId), eq(pressRemark.pressRunId, run.id)))
        .orderBy(desc(pressRemark.createdAt))
        .limit(20),
      ctx.db
        .select({ id: dieRemark.id, body: dieRemark.body, createdAt: dieRemark.createdAt, createdBy: dieRemark.createdBy })
        .from(dieRemark)
        .where(and(eq(dieRemark.companyId, ctx.companyId), eq(dieRemark.pressRunId, run.id)))
        .orderBy(desc(dieRemark.createdAt))
        .limit(20),
      run.dieInstanceId
        ? ctx.db
            .select({ id: dieIssue.id, pressLineId: dieIssue.pressLineId, pressRunId: dieIssue.pressRunId, issuedAt: dieIssue.issuedAt })
            .from(dieIssue)
            .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, run.dieInstanceId), eq(dieIssue.status, "issued")))
            .limit(1)
        : Promise.resolve([]),
      ctx.db
        .select({ id: approval.id, kind: approval.kind, status: approval.status, requestedBy: approval.requestedBy, createdAt: approval.createdAt, decidedAt: approval.decidedAt })
        .from(approval)
        .where(and(eq(approval.companyId, ctx.companyId), eq(approval.subjectId, run.id), inArray(approval.kind, ["press_time", "press_reopen", "press_late_entry"])))
        .orderBy(desc(approval.createdAt))
        .limit(20),
      latestReading(ctx.db, ctx.companyId, run.dieInstanceId),
    ]);
    const name = new Map(people.map((p) => [p.id, p.name]));
    const downtimeMin = evald.children.downtime.reduce(
      (s, d) => s + Math.max(0, Math.round(((ms(d.stoppedAt) ?? clockNow().getTime()) - d.startedAt.getTime()) / 60_000)),
      0,
    );
    return {
      run: {
        id: run.id,
        number: run.number,
        status: run.status,
        purpose: run.purpose,
        planId: run.planId,
        planNumber: run.planNumber,
        pressPlanDieId: run.pressPlanDieId,
        urgent: run.urgent,
        pressLineId: run.pressLineId,
        sectionId: run.sectionId,
        sectionCode: run.sectionCode,
        sectionName: run.sectionName,
        series: run.series,
        hasDrawing: Boolean(run.drawingKey),
        dieInstanceId: run.dieInstanceId,
        castId: run.castId,
        castNumber: evald.castInfo.number,
        billetsOnHandG: evald.castInfo.onHandG,
        productionDay: run.productionDay,
        shiftSeq: run.shiftSeq,
        shiftId: run.shiftId,
        operatorId: run.operatorId,
        operatorName: run.operatorId ? (name.get(run.operatorId) ?? null) : null,
        reliefOperatorId: run.reliefOperatorId,
        reliefOperatorName: run.reliefOperatorId ? (name.get(run.reliefOperatorId) ?? null) : null,
        supervisorId: run.supervisorId,
        supervisorName: run.supervisorId ? (name.get(run.supervisorId) ?? null) : null,
        dieInAt: run.dieInAt,
        dieOutAt: run.dieOutAt,
        startedAt: run.startedAt,
        stoppedAt: run.stoppedAt,
        timeUnconfirmed: run.timeUnconfirmed,
        lateEntry: run.lateEntry,
        lateEntryApproved: Boolean(run.lateEntryApprovalId),
        pressedLengthMm: run.pressedLengthMm,
        discardG: run.discardG,
        endsG: run.endsG,
        billetShortReason: run.billetShortReason,
        trialResult: run.trialResult,
        pressRemark: run.pressRemark,
        dieRemark: run.dieRemark,
        loggedAt: run.loggedAt,
        voidedAt: run.voidedAt,
        voidNote: run.voidNote,
        serverSeq: run.serverSeq,
        // Stored at log (logged runs); the live figures are under `figures`.
        stored: { inputG: run.inputG, goodG: run.goodG, rejectG: run.rejectG, recoveryBp: run.recoveryBp, balanceG: run.balanceG },
      },
      line: line[0] ?? null,
      copy: copy[0] ? { ...copy[0], kgPer12ftMilli: reading } : null,
      openIssue: openIssue[0] ?? null,
      /** Job card per die across parties (rank 31): SO numbers, cut length, pcs + kg per line. */
      planLines,
      planTotals: { pcs: planLines.reduce((s, l) => s + l.pcs, 0), kgG: planLines.reduce((s, l) => s + l.kgG, 0) },
      lines: evald.children.lines.map((l) => ({
        ...l,
        theoreticalG: theoreticalHintG({ pcs: l.pcs, cutLengthMm: l.cutLengthMm, kgPer12ftMilli: reading }),
      })),
      billets: evald.children.billets,
      qc: evald.children.qc,
      downtime: evald.children.downtime,
      downtimeMin,
      remarks,
      dieRemarks,
      approvals,
      figures: figuresOut(evald.figures),
      gates: evald.errors,
    };
  }),

  /** The close's figures and gates without saving ("not saved"). */
  preview: companyProcedure
    .input(z.object({ id, billetShortReason: reason.optional(), trialResult: z.enum(["pass", "fail"]).optional() }))
    .query(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      const { errors, figures, castInfo } = await evaluateClose(ctx as Ctx, run, input);
      return { saved: false as const, figures: figuresOut(figures), gates: errors, gateText: errors.map((e) => GATE_TEXT[e]), billetsOnHandG: castInfo.onHandG };
    }),

  /**
   * FP-PR-24 run entered after the fact (`press.runs.open`): supervisor only (press.close). Either a
   * queued / die_issued run of the queue (`runId`) or a fresh run on a line with a copy. The run
   * lands `counting`, flagged `late_entry`, with a `press_late_entry` approval (never decided by
   * the requester); billets still debit the cast at close, which waits for the approval.
   */
  open: actionProcedure("press.close")
    .input(
      z
        .object({
          clientMutationId,
          runId: id.optional(),
          pressLineId: id.optional(),
          dieInstanceId: id.optional(),
          startedAt: z.number().int().positive(),
          stoppedAt: z.number().int().positive(),
          operatorId: id.optional(),
          reliefOperatorId: id.optional(),
          reason,
        })
        .refine((v) => Boolean(v.runId || (v.pressLineId && v.dieInstanceId)), "Name the run, or the press and the die copy"),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.clientMutationId) {
        // m-4: later transitions overwrite the run's client_mutation_id, so the open's id is also
        // kept in its press_late_entry approval meta; a retry finds the run by either.
        const [prior] = await ctx.db
          .select({ id: pressRun.id, number: pressRun.number })
          .from(pressRun)
          .where(
            and(
              eq(pressRun.companyId, ctx.companyId),
              sql`(${pressRun.clientMutationId} = ${input.clientMutationId} or ${pressRun.id} in (select la.subject_id from approval la where la.company_id = ${ctx.companyId} and la.kind = 'press_late_entry' and json_extract(la.meta, '$.clientMutationId') = ${input.clientMutationId}))`,
            ),
          )
          .limit(1);
        if (prior) {
          const p = await pendingApproval(ctx.db, ctx.companyId, "press_late_entry", prior.id);
          return { id: prior.id, number: prior.number, approvalId: p?.id ?? null, replayed: true };
        }
      }
      const at = clockNow();
      if (!(input.startedAt < input.stoppedAt)) bad("The run must stop after it starts");
      if (input.stoppedAt > at.getTime()) bad("A late entry is for a run that has already stopped");
      if (input.startedAt < at.getTime() - LATE_ENTRY_MAX_DAYS * 86_400_000) bad(`A late entry must be within ${LATE_ENTRY_MAX_DAYS} days`);
      const operatorId = await requireOperator(ctx.db, ctx.companyId, input.operatorId);
      const reliefOperatorId = await requireOperator(ctx.db, ctx.companyId, input.reliefOperatorId);
      const settings = await companySettings(ctx.db, ctx.companyId);
      const shift = shiftAt(settings, input.startedAt);
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const late = {
        status: "counting" as const,
        lateEntry: true,
        startedAt: new Date(input.startedAt),
        stoppedAt: new Date(input.stoppedAt),
        dieInAt: new Date(input.startedAt),
        dieOutAt: new Date(input.stoppedAt),
        productionDay: shift.productionDay,
        shiftSeq: shift.shiftSeq,
        shiftId: shift.shiftId,
        operatorId,
        reliefOperatorId,
        supervisorId: userId,
        timeUnconfirmed: false,
        clientMutationId: input.clientMutationId ?? null,
        serverSeq: seq,
        updatedAt: at,
      };
      let runId: string;
      let number: string;
      const statements: SqliteBatchItem[] = [];
      if (input.runId) {
        const run = await loadRun(ctx.db, ctx.companyId, input.runId);
        if (run.status !== "queued" && run.status !== "die_issued") bad(`${run.number} is ${STATUS_WORD[run.status]}; only a run still in the queue can be entered late`);
        const copyId = run.dieInstanceId ?? input.dieInstanceId ?? null;
        if (!copyId) bad("Pick the die copy that was used");
        if (input.dieInstanceId && run.dieInstanceId && input.dieInstanceId !== run.dieInstanceId) bad(`${run.number} has another copy issued`);
        // I-1: the copy is checked as an issue would check it (status, open issue, owner).
        await assertLateEntryCopy(ctx.db, ctx.companyId, { copyId: copyId!, run });
        runId = run.id;
        number = run.number;
        statements.push(
          ctx.db
            .update(pressRun)
            .set({ ...late, dieInstanceId: copyId })
            .where(and(eq(pressRun.id, run.id), eq(pressRun.companyId, ctx.companyId), eq(pressRun.status, run.status), eq(pressRun.serverSeq, run.serverSeq))),
        );
      } else {
        const [line] = await ctx.db
          .select({ id: pressLine.id, code: pressLine.code, status: pressLine.status })
          .from(pressLine)
          .where(and(eq(pressLine.id, input.pressLineId!), eq(pressLine.companyId, ctx.companyId)))
          .limit(1);
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
        if (line.status !== "active") bad(`${line.code} is retired`);
        const copy = await assertLateEntryCopy(ctx.db, ctx.companyId, { copyId: input.dieInstanceId!, run: null });
        runId = crypto.randomUUID();
        const doc = await nextDocNumber(ctx.db, ctx.companyId, "press_run", at, userId);
        number = doc.number;
        statements.push(
          ctx.db.insert(pressRun).values({
            id: runId,
            companyId: ctx.companyId,
            number: doc.number,
            period: doc.period,
            pressLineId: line.id,
            sectionId: copy.sectionId,
            dieInstanceId: input.dieInstanceId!,
            source: "typed",
            createdBy: userId,
            createdAt: at,
            ...late,
          }),
        );
      }
      statements.push(pressAbortUnless(ctx.db, runLanded(runId, seq, "counting")));
      const req = requestApprovalInsert(ctx, {
        kind: "press_late_entry",
        subjectId: runId,
        serverSeq: seq,
        requestNote: input.reason,
        meta: {
          reason: input.reason,
          productionDay: shift.productionDay,
          shiftSeq: shift.shiftSeq,
          runNumber: number,
          ...(input.clientMutationId ? { clientMutationId: input.clientMutationId } : {}),
        },
        guard: { from: pressRun, where: and(eq(pressRun.id, runId), eq(pressRun.serverSeq, seq)) },
      });
      statements.push(
        req.statement,
        auditInsert(ctx, {
          action: "press_run.open",
          subjectType: "press_run",
          subjectId: runId,
          meta: { number, lateEntry: true, productionDay: shift.productionDay, shiftSeq: shift.shiftSeq, approvalId: req.id },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (pressErrorText(e).includes("press_run.company_id, press_run.client_mutation_id")) {
          throw new TRPCError({ code: "CONFLICT", message: "This entry was already saved" });
        }
        await explainTransition(ctx as Ctx, runId, e, "the late entry");
      }
      return { id: runId, number, approvalId: req.id, replayed: false };
    }),

  /** Start (FP-PR-04/05/06/13): server time, shift from the start instant, start lock. */
  start: actionProcedure("press.run")
    .input(
      z.object({
        id: id.optional(),
        pressPlanDieId: id.optional(),
        clientMutationId,
        tappedAt: z.number().int().positive().optional(),
        operatorId: id.optional(),
        supervisorId: id.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      runRef.parse(input);
      const run = await findRun(ctx.db, ctx.companyId, input);
      if (replayed(run, input.clientMutationId, ["running", "stopped", "counting", "logged"])) {
        return { id: run.id, status: run.status, timeUnconfirmed: run.timeUnconfirmed, approvalId: null, replayed: true };
      }
      requireStatus(run, ["die_issued"], "only a run with its die issued can start");
      const [issue] = await ctx.db
        .select({ id: dieIssue.id, pressLineId: dieIssue.pressLineId, pressRunId: dieIssue.pressRunId })
        .from(dieIssue)
        .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, run.dieInstanceId ?? ""), eq(dieIssue.status, "issued")))
        .limit(1);
      if (!issue) bad("Die not issued. Start is locked.");
      if (issue!.pressLineId !== run.pressLineId || (issue!.pressRunId && issue!.pressRunId !== run.id)) {
        bad("The die issued is for another run or press; ask the die room");
      }
      const busy = await runningOnLine(ctx.db, ctx.companyId, run.pressLineId, run.id);
      if (busy) throw new TRPCError({ code: "CONFLICT", message: `${busy.number} is running on this press; stop it first` });
      const callerId = ctx.session.user.id;
      const operatorId = (await requireOperator(ctx.db, ctx.companyId, input.operatorId)) ?? run.operatorId ?? (ctx.role === "press" ? callerId : null);
      const supervisorId =
        (await requireSupervisor(ctx.db, ctx.companyId, input.supervisorId)) ?? run.supervisorId ?? (canRole(ctx.role, "press.close") ? callerId : null);
      const at = clockNow();
      const unconfirmed = skewUnconfirmed(at.getTime(), input.tappedAt);
      const shift = shiftAt(await companySettings(ctx.db, ctx.companyId), at.getTime());
      const pending = unconfirmed ? await pendingApproval(ctx.db, ctx.companyId, "press_time", run.id) : null;
      let approvalId: string | null = pending?.id ?? null;
      await moveRun(ctx as Ctx, run, {
        from: ["die_issued"],
        to: "running",
        set: {
          startedAt: at,
          dieInAt: run.dieInAt ?? at,
          tappedStartAt: input.tappedAt ? new Date(input.tappedAt) : null,
          timeUnconfirmed: unconfirmed || run.timeUnconfirmed,
          productionDay: shift.productionDay,
          shiftSeq: shift.shiftSeq,
          shiftId: shift.shiftId,
          operatorId,
          supervisorId,
        },
        where: and(
          eq(pressRun.dieInstanceId, run.dieInstanceId!),
          sql`exists (select 1 from die_issue si where si.company_id = ${ctx.companyId} and si.id = ${issue!.id} and si.status = 'issued' and si.press_line_id = ${run.pressLineId})`,
        ),
        clientMutationId: input.clientMutationId,
        audit: "press_run.start",
        meta: { productionDay: shift.productionDay, shiftSeq: shift.shiftSeq, timeUnconfirmed: unconfirmed, skewMs: input.tappedAt ? at.getTime() - input.tappedAt : null },
        extra: (seq) => {
          if (!unconfirmed || pending) return [];
          const req = timeRequest(ctx as Ctx, run, seq, { at: "start", serverAt: at.getTime(), tappedAt: input.tappedAt });
          approvalId = req.id;
          return [req.statement];
        },
        what: "the start",
      });
      return { id: run.id, status: "running" as const, startedAt: at, timeUnconfirmed: unconfirmed || run.timeUnconfirmed, productionDay: shift.productionDay, shiftSeq: shift.shiftSeq, approvalId, replayed: false };
    }),

  stop: actionProcedure("press.run")
    .input(z.object({ id, clientMutationId, tappedAt: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (replayed(run, input.clientMutationId, ["stopped", "counting", "logged"])) return { id: run.id, status: run.status, approvalId: null, replayed: true };
      requireStatus(run, ["running"], "only a running run can stop");
      const at = clockNow();
      const unconfirmed = skewUnconfirmed(at.getTime(), input.tappedAt);
      const pending = unconfirmed ? await pendingApproval(ctx.db, ctx.companyId, "press_time", run.id) : null;
      let approvalId: string | null = pending?.id ?? null;
      await moveRun(ctx as Ctx, run, {
        from: ["running"],
        to: "stopped",
        set: { stoppedAt: at, tappedStopAt: input.tappedAt ? new Date(input.tappedAt) : null, timeUnconfirmed: unconfirmed || run.timeUnconfirmed },
        clientMutationId: input.clientMutationId,
        audit: "press_run.stop",
        meta: { timeUnconfirmed: unconfirmed, skewMs: input.tappedAt ? at.getTime() - input.tappedAt : null },
        extra: (seq) => {
          if (!unconfirmed || pending) return [];
          const req = timeRequest(ctx as Ctx, run, seq, { at: "stop", serverAt: at.getTime(), tappedAt: input.tappedAt });
          approvalId = req.id;
          return [req.statement];
        },
        what: "the stop",
      });
      return { id: run.id, status: "stopped" as const, stoppedAt: at, timeUnconfirmed: unconfirmed || run.timeUnconfirmed, approvalId, replayed: false };
    }),

  /** Pause over (D8): stopped → running again, if the press is free. */
  resume: actionProcedure("press.run")
    .input(z.object({ id, clientMutationId }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (replayed(run, input.clientMutationId, ["running"])) return { id: run.id, status: run.status, replayed: true };
      requireStatus(run, ["stopped"], "only a stopped run can resume");
      const busy = await runningOnLine(ctx.db, ctx.companyId, run.pressLineId, run.id);
      if (busy) throw new TRPCError({ code: "CONFLICT", message: `${busy.number} is running on this press; stop it first` });
      await moveRun(ctx as Ctx, run, { from: ["stopped"], to: "running", set: { stoppedAt: null, tappedStopAt: null }, clientMutationId: input.clientMutationId, audit: "press_run.resume", what: "the resume" });
      return { id: run.id, status: "running" as const, replayed: false };
    }),

  /** Started by mistake (D8): running → die_issued, start time and shift cleared. */
  undoStart: actionProcedure("press.run")
    .input(z.object({ id, clientMutationId }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (replayed(run, input.clientMutationId, ["die_issued"])) return { id: run.id, status: run.status, replayed: true };
      requireStatus(run, ["running"], "only a running run can be taken back");
      await moveRun(ctx as Ctx, run, {
        from: ["running"],
        to: "die_issued",
        set: { startedAt: null, dieInAt: null, tappedStartAt: null, productionDay: null, shiftSeq: null, shiftId: null, timeUnconfirmed: false },
        where: sql`not exists (select 1 from press_downtime d where d.company_id = ${ctx.companyId} and d.press_run_id = ${run.id})`,
        clientMutationId: input.clientMutationId,
        audit: "press_run.undo_start",
        what: "the undo",
      });
      return { id: run.id, status: "die_issued" as const, replayed: false };
    }),

  /** Die out, start counting (stopped → counting). */
  count: actionProcedure("press.run")
    .input(z.object({ id, clientMutationId }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (replayed(run, input.clientMutationId, ["counting", "logged"])) return { id: run.id, status: run.status, replayed: true };
      requireStatus(run, ["stopped"], "stop the run before counting");
      await moveRun(ctx as Ctx, run, {
        from: ["stopped"],
        to: "counting",
        set: { dieOutAt: run.dieOutAt ?? clockNow() },
        clientMutationId: input.clientMutationId,
        audit: "press_run.count",
        what: "the count",
      });
      return { id: run.id, status: "counting" as const, replayed: false };
    }),

  /** Operator, relief and supervisor (FP-PR-13). */
  handover: actionProcedure("press.run")
    .input(z.object({ id, operatorId: id.nullable().optional(), reliefOperatorId: id.nullable().optional(), supervisorId: id.nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["die_issued", "running", "stopped", "counting"], "people can change only on an open run");
      const set: Partial<typeof pressRun.$inferInsert> = {};
      if (input.operatorId !== undefined) set.operatorId = await requireOperator(ctx.db, ctx.companyId, input.operatorId);
      if (input.reliefOperatorId !== undefined) set.reliefOperatorId = await requireOperator(ctx.db, ctx.companyId, input.reliefOperatorId);
      if (input.supervisorId !== undefined) set.supervisorId = await requireSupervisor(ctx.db, ctx.companyId, input.supervisorId);
      await moveRun(ctx as Ctx, run, {
        from: [run.status],
        to: run.status,
        set,
        where: eq(pressRun.serverSeq, run.serverSeq),
        audit: "press_run.handover",
        meta: { ...set },
        what: "the handover",
      });
      return { success: true };
    }),

  /** Billets by cast and length (FP-PR-07). Replaces the run's rows; sets the run's cast. */
  billets: actionProcedure("press.run")
    .input(z.object({ id, castId: id, rows: z.array(billetRow).max(MAX_BILLET_INPUT_ROWS, "At most 10 billet rows on a run"), billetShortReason: reason.nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["counting"], "billets are entered while counting");
      const castIds = [...new Set([input.castId, ...input.rows.map((r) => r.castId ?? input.castId)])];
      const casts = await ctx.db
        .select({ id: cast.id, status: cast.status })
        .from(cast)
        .where(and(eq(cast.companyId, ctx.companyId), inArray(cast.id, castIds)));
      if (casts.length !== castIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "Cast not found" });
      if (casts.some((c) => c.status === "cancelled")) bad("That cast is cancelled");
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const statements = bumpCounting(ctx as Ctx, run.id, seq, at, {
        castId: input.castId,
        ...(input.billetShortReason !== undefined ? { billetShortReason: input.billetShortReason } : {}),
      });
      pushChunkedInserts(
        statements,
        (rows) =>
          ctx.db
            .insert(pressBilletUse)
            .values(rows)
            .onConflictDoUpdate({
              target: [pressBilletUse.pressRunId, pressBilletUse.line],
              set: {
                castId: sql`excluded.cast_id`,
                lengthMm: sql`excluded.length_mm`,
                count: sql`excluded.count`,
                kgG: sql`excluded.kg_g`,
                serverSeq: sql`excluded.server_seq`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        input.rows.map((r, i) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          pressRunId: run.id,
          line: i + 1,
          castId: r.castId ?? input.castId,
          lengthMm: r.lengthMm ?? null,
          count: r.count,
          kgG: r.kgG,
          createdBy: userId,
          createdAt: at,
          updatedAt: at,
        })),
      );
      statements.push(
        ctx.db.delete(pressBilletUse).where(and(eq(pressBilletUse.companyId, ctx.companyId), eq(pressBilletUse.pressRunId, run.id), sql`${pressBilletUse.line} > ${input.rows.length}`)),
      );
      await writeCounting(ctx as Ctx, run, statements);
      return { success: true, rows: input.rows.length };
    }),

  /** Pieces by cut length (FP-PR-08); each row may name the plan line (the order line it is for). */
  lines: actionProcedure("press.run")
    .input(z.object({ id, rows: z.array(lineRow).max(MAX_RUN_LINES) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["counting"], "pieces are entered while counting");
      const named = input.rows.some((r) => r.pressPlanLineId);
      if (named && (run.purpose !== "production" || !run.pressPlanDieId)) bad("A trial or sample run has no order lines");
      // I-3 (FP-PR-16): on a production run whose plan die has order lines, every row counts
      // against one. A row without one takes the plan's single line of that cut length; with none
      // or several of that length the station must pick.
      const planRows =
        run.purpose === "production" && run.pressPlanDieId
          ? await ctx.db
              .select({ id: pressPlanLine.id, salesOrderLineId: pressPlanLine.salesOrderLineId, cutLengthMm: pressPlanLine.cutLengthMm })
              .from(pressPlanLine)
              .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanDieId, run.pressPlanDieId)))
          : [];
      const planLines = new Map(planRows.map((r) => [r.id, r.salesOrderLineId]));
      const mapped = input.rows.map((r) => {
        if (r.pressPlanLineId) {
          if (!planLines.has(r.pressPlanLineId)) bad("An order line is not on this run's plan");
          return r;
        }
        if (planRows.length === 0) return r;
        const same = planRows.filter((pl) => pl.cutLengthMm === r.cutLengthMm);
        if (same.length !== 1) bad(`Pick the order line for ${r.cutLengthMm} mm`);
        return { ...r, pressPlanLineId: same[0]!.id };
      });
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const statements = bumpCounting(ctx as Ctx, run.id, seq, at);
      pushChunkedInserts(
        statements,
        (rows) =>
          ctx.db
            .insert(pressRunLine)
            .values(rows)
            .onConflictDoUpdate({
              target: [pressRunLine.pressRunId, pressRunLine.line],
              set: {
                pressPlanLineId: sql`excluded.press_plan_line_id`,
                salesOrderLineId: sql`excluded.sales_order_line_id`,
                cutLengthMm: sql`excluded.cut_length_mm`,
                pcs: sql`excluded.pcs`,
                goodG: sql`excluded.good_g`,
                serverSeq: sql`excluded.server_seq`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        mapped.map((r, i) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          pressRunId: run.id,
          line: i + 1,
          pressPlanLineId: r.pressPlanLineId ?? null,
          salesOrderLineId: r.pressPlanLineId ? planLines.get(r.pressPlanLineId)! : null,
          cutLengthMm: r.cutLengthMm,
          pcs: r.pcs,
          goodG: r.goodG,
          createdBy: userId,
          createdAt: at,
          updatedAt: at,
        })),
      );
      statements.push(
        ctx.db.delete(pressRunLine).where(and(eq(pressRunLine.companyId, ctx.companyId), eq(pressRunLine.pressRunId, run.id), sql`${pressRunLine.line} > ${input.rows.length}`)),
      );
      await writeCounting(ctx as Ctx, run, statements);
      return { success: true, rows: input.rows.length };
    }),

  /** Rejects with reason codes (FP-PR-09, C38): a zero row says "no rejects". */
  qc: actionProcedure("press.run")
    .input(z.object({ id, rows: z.array(qcRow).max(MAX_QC_ROWS) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["counting"], "rejects are entered while counting");
      const codeIds = [...new Set(input.rows.map((r) => r.reasonCodeId).filter((x): x is string => Boolean(x)))];
      if (codeIds.length > 0) {
        const codes = await ctx.db
          .select({ id: reasonCode.id })
          .from(reasonCode)
          .where(and(eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, "qc_reject"), eq(reasonCode.active, true), inArray(reasonCode.id, codeIds)));
        if (codes.length !== codeIds.length) bad("Pick a reject reason from the list");
      }
      const runLines = await ctx.db
        .select({ id: pressRunLine.id, line: pressRunLine.line })
        .from(pressRunLine)
        .where(and(eq(pressRunLine.companyId, ctx.companyId), eq(pressRunLine.pressRunId, run.id)));
      const lineId = new Map(runLines.map((l) => [l.line, l.id]));
      for (const r of input.rows) if (r.runLine != null && !lineId.has(r.runLine)) bad(`There is no cut length row ${r.runLine}`);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const statements = bumpCounting(ctx as Ctx, run.id, seq, at, { rejectG: input.rows.reduce((s, r) => s + r.kgG, 0) });
      pushChunkedInserts(
        statements,
        (rows) =>
          ctx.db
            .insert(qcEntry)
            .values(rows)
            .onConflictDoUpdate({
              target: [qcEntry.pressRunId, qcEntry.line],
              set: {
                pressRunLineId: sql`excluded.press_run_line_id`,
                reasonCodeId: sql`excluded.reason_code_id`,
                pcs: sql`excluded.pcs`,
                kgG: sql`excluded.kg_g`,
                note: sql`excluded.note`,
                serverSeq: sql`excluded.server_seq`,
              },
            }),
        input.rows.map((r, i) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          pressRunId: run.id,
          line: i + 1,
          pressRunLineId: r.runLine != null ? lineId.get(r.runLine)! : null,
          reasonCodeId: r.reasonCodeId ?? null,
          pcs: r.pcs,
          kgG: r.kgG,
          note: r.note?.trim() || null,
          createdBy: userId,
          createdAt: at,
        })),
      );
      statements.push(ctx.db.delete(qcEntry).where(and(eq(qcEntry.companyId, ctx.companyId), eq(qcEntry.pressRunId, run.id), sql`${qcEntry.line} > ${input.rows.length}`)));
      await writeCounting(ctx as Ctx, run, statements);
      return { success: true, rows: input.rows.length };
    }),

  /** Butt (discard) and ends kg, and the pressed length (FP-PR-10). */
  scrap: actionProcedure("press.run")
    .input(z.object({ id, discardG: grams.nullable().optional(), endsG: grams.nullable().optional(), pressedLengthMm: z.number().int().min(1).max(100_000_000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["counting"], "butt and ends are entered while counting");
      const set: Partial<typeof pressRun.$inferInsert> = {};
      if (input.discardG !== undefined) set.discardG = input.discardG;
      if (input.endsG !== undefined) set.endsG = input.endsG;
      if (input.pressedLengthMm !== undefined) set.pressedLengthMm = input.pressedLengthMm;
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await writeCounting(ctx as Ctx, run, bumpCounting(ctx as Ctx, run.id, seq, at, set));
      return { success: true };
    }),

  /** Press remark (about the run) or die remark (about the copy), bound to run + copy (FP-PR-15). */
  remark: actionProcedure("press.run")
    .input(z.object({ id, kind: z.enum(["press", "die"]), body: reason }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (run.status === "voided") bad(`${run.number} is voided`);
      if (input.kind === "die" && !run.dieInstanceId) bad("This run has no die copy yet");
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const remarkId = crypto.randomUUID();
      const statements: SqliteBatchItem[] =
        input.kind === "press"
          ? [
              ctx.db.insert(pressRemark).values({ id: remarkId, companyId: ctx.companyId, serverSeq: seq, pressRunId: run.id, dieInstanceId: run.dieInstanceId, body: input.body, createdBy: userId, createdAt: at }),
              ctx.db.update(pressRun).set({ pressRemark: input.body }).where(and(eq(pressRun.id, run.id), eq(pressRun.companyId, ctx.companyId))),
            ]
          : [
              ctx.db.insert(dieRemark).values({ id: remarkId, companyId: ctx.companyId, serverSeq: seq, dieInstanceId: run.dieInstanceId!, pressRunId: run.id, body: input.body, createdBy: userId, createdAt: at }),
              ctx.db.update(pressRun).set({ dieRemark: input.body }).where(and(eq(pressRun.id, run.id), eq(pressRun.companyId, ctx.companyId))),
            ];
      statements.push(
        auditInsert(ctx, {
          action: input.kind === "press" ? "press_remark.add" : "die_remark.add",
          subjectType: input.kind === "press" ? "press_run" : "die_instance",
          subjectId: input.kind === "press" ? run.id : run.dieInstanceId,
          meta: { remarkId, pressRunId: run.id, number: run.number },
        }),
      );
      await atomicBatch(ctx.db, statements);
      return { id: remarkId };
    }),

  /** Runs and die remarks of one copy, newest first: the die card's Runs tab (FP-PR-15). */
  byCopy: companyProcedure
    .input(z.object({ dieInstanceId: id, limit: z.number().int().min(1).max(100).default(30), before: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.db
        .select({
          id: pressRun.id,
          number: pressRun.number,
          status: pressRun.status,
          productionDay: pressRun.productionDay,
          shiftSeq: pressRun.shiftSeq,
          goodG: pressRun.goodG,
          inputG: pressRun.inputG,
          recoveryBp: pressRun.recoveryBp,
          pressRemark: pressRun.pressRemark,
          dieRemark: pressRun.dieRemark,
          startedAt: pressRun.startedAt,
          createdAt: pressRun.createdAt,
        })
        .from(pressRun)
        .where(
          and(
            eq(pressRun.companyId, ctx.companyId),
            eq(pressRun.dieInstanceId, input.dieInstanceId),
            input.before ? lt(pressRun.createdAt, new Date(input.before)) : undefined,
          ),
        )
        .orderBy(desc(pressRun.createdAt))
        .limit(input.limit);
      const remarks = await ctx.db
        .select({ id: dieRemark.id, body: dieRemark.body, pressRunId: dieRemark.pressRunId, runNumber: pressRun.number, createdAt: dieRemark.createdAt, createdBy: dieRemark.createdBy })
        .from(dieRemark)
        .leftJoin(pressRun, and(eq(pressRun.id, dieRemark.pressRunId), eq(pressRun.companyId, dieRemark.companyId)))
        .where(and(eq(dieRemark.companyId, ctx.companyId), eq(dieRemark.dieInstanceId, input.dieInstanceId)))
        .orderBy(desc(dieRemark.createdAt))
        .limit(input.limit);
      return { runs, remarks };
    }),

  /** Signed link to the section's press drawing (FP-PR-14); `url` null when the section has none. */
  drawing: anyActionProcedure("press.run", "press.close", "die.issue").input(z.object({ id })).query(async ({ ctx, input }) => {
    const run = await loadRun(ctx.db, ctx.companyId, input.id);
    if (!run.drawingKey) return { url: null, expiresAt: null };
    return signDieFileUrl(ctx, ctx.companyId, run.drawingKey);
  }),

  /** Ask a supervisor to confirm the run's times (`press_time`). */
  confirmTime: anyActionProcedure("press.run", "press.close")
    .input(z.object({ id, note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (!run.timeUnconfirmed) bad(`${run.number}'s times are confirmed`);
      const pending = await pendingApproval(ctx.db, ctx.companyId, "press_time", run.id);
      if (pending) return { approvalId: pending.id, replayed: true };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const req = requestApprovalInsert(ctx, {
        kind: "press_time",
        subjectId: run.id,
        serverSeq: seq,
        requestNote: input.note ?? `${run.number}: confirm the start and stop times`,
        meta: { runNumber: run.number, startedAt: ms(run.startedAt), stoppedAt: ms(run.stoppedAt), tappedStartAt: ms(run.tappedStartAt), tappedStopAt: ms(run.tappedStopAt) },
      });
      await atomicBatch(ctx.db, [
        req.statement,
        auditInsert(ctx, { action: "press_run.time_request", subjectType: "press_run", subjectId: run.id, meta: { number: run.number, approvalId: req.id } }),
      ]);
      return { approvalId: req.id, replayed: false };
    }),

  /**
   * Log run (FP-PR-05/11, supervisor, press.close): every gate in one read, then ONE batch: run
   * logged with the server's figures, ledger rows (billet row only while the cast still has the
   * billets), the issue returned or handed to the next queued run of the same copy (C43), a die
   * trial's verdict on the copy, audit. Client figures are ignored.
   */
  close: actionProcedure("press.close")
    .input(z.object({ id, clientMutationId, billetShortReason: reason.optional(), trialResult: z.enum(["pass", "fail"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      if (replayed(run, input.clientMutationId, ["logged"])) {
        return { id: run.id, status: run.status, recoveryBp: run.recoveryBp, balanceG: run.balanceG, replayed: true };
      }
      if (run.purpose !== "die_trial" && input.trialResult) bad("Only a die trial run takes a pass or fail");
      const { errors, figures, castInfo, children } = await evaluateClose(ctx as Ctx, run, input);
      if (errors.length > 0) gateError(errors);
      const billetStore = await resolveBilletStore(ctx.db, ctx.companyId);
      const scrapG = (run.discardG ?? 0) + (run.endsG ?? 0) + figures.rejectG;
      const plantScrap = scrapG > 0 ? await resolvePlantScrap(ctx.db, ctx.companyId) : null;
      const callerId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const streams = scrapG > 0 ? await pressStreams(ctx.db, ctx.companyId, callerId, seq) : null;
      const firstLine = (await lastLedgerLine(ctx.db, ctx.companyId, run.id)) + 1;
      const trialResult = run.purpose === "die_trial" ? (input.trialResult ?? run.trialResult) : null;
      const handoff = await issueAtClose(ctx as Ctx, run, trialResult);
      const trialCopy =
        run.purpose === "die_trial" && run.dieInstanceId
          ? ((
              await ctx.db
                .select({ id: dieInstance.id, code: dieInstance.code, status: dieInstance.status })
                .from(dieInstance)
                .where(and(eq(dieInstance.id, run.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
                .limit(1)
            )[0] ?? null)
          : null;
      const at = clockNow();
      // D22: the full weighed kg is debited; the store must still hold what this read saw, so a
      // shortfall never grows between the read and the write without being recorded.
      const billetGuardG = Math.min(figures.inputG, castInfo.onHandG ?? 0);
      const shortReason = figures.short ? (input.billetShortReason ?? run.billetShortReason) : (input.billetShortReason ?? run.billetShortReason ?? null);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(pressRun)
          .set({
            status: "logged",
            loggedAt: at,
            inputG: figures.inputG,
            inputWeighedG: figures.inputWeighedG,
            goodG: figures.goodG,
            rejectG: figures.rejectG,
            recoveryBp: figures.recoveryBp,
            balanceG: figures.balanceG,
            billetShortReason: shortReason,
            billetShortG: figures.billetShortG,
            supervisorId: run.supervisorId ?? callerId,
            trialResult,
            ...(input.clientMutationId ? { clientMutationId: input.clientMutationId } : {}),
            serverSeq: seq,
            updatedAt: at,
          })
          .where(
            and(
              eq(pressRun.id, run.id),
              eq(pressRun.companyId, ctx.companyId),
              eq(pressRun.status, "counting"),
              eq(pressRun.serverSeq, run.serverSeq),
              // Write-time gates the rows can still break: downtime stopped, approvals in place.
              sql`not exists (select 1 from press_downtime d where d.company_id = ${ctx.companyId} and d.press_run_id = ${run.id} and d.stopped_at is null)`,
              eq(pressRun.timeUnconfirmed, false),
              sql`(${pressRun.lateEntry} = 0 or ${pressRun.lateEntryApprovalId} is not null)`,
            ),
          ),
        pressAbortUnless(ctx.db, runLanded(run.id, seq, "logged")),
      ];
      const ledger = closeLedgerStatements(ctx.db, {
        companyId: ctx.companyId,
        runId: run.id,
        runNumber: run.number,
        castId: run.castId!,
        castNumber: castInfo.number ?? "",
        seq,
        userId: callerId,
        at,
        firstLine,
        billetStoreId: billetStore.id,
        plantScrapLocationId: plantScrap?.id ?? null,
        streams,
        inputG: figures.inputG,
        billetGuardG,
        discardG: run.discardG ?? 0,
        endsG: run.endsG ?? 0,
        rejectG: figures.rejectG,
      });
      statements.push(...ledger.statements, pressAbortUnless(ctx.db, billetPostedSql(ctx.companyId, run.id, ledger.billetLine, seq)));

      // C43: the issue goes back to the rack, or stays open for the next queued run of the copy.
      const runLogged = runLanded(run.id, seq, "logged");
      if (handoff.issue && handoff.carryTo) {
        statements.push(
          ctx.db
            .update(dieIssue)
            .set({ pressRunId: handoff.carryTo.id, serverSeq: seq })
            .where(and(eq(dieIssue.id, handoff.issue.id), eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.status, "issued"), runLogged)),
          ctx.db
            .update(pressRun)
            .set({ dieInstanceId: run.dieInstanceId, status: "die_issued", serverSeq: seq, updatedAt: at })
            .where(and(eq(pressRun.id, handoff.carryTo.id), eq(pressRun.companyId, ctx.companyId), eq(pressRun.status, "queued"), isNull(pressRun.dieInstanceId), runLogged)),
          pressAbortUnless(ctx.db, runLanded(handoff.carryTo.id, seq, "die_issued")),
        );
      } else if (handoff.issue) {
        statements.push(
          ctx.db
            .update(dieIssue)
            .set({ status: "returned", returnedAt: at, returnedBy: callerId, serverSeq: seq })
            .where(and(eq(dieIssue.id, handoff.issue.id), eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.status, "issued"), runLogged)),
        );
        if (trialCopy && trialResult) {
          // die_trial: the copy goes back on trial, and a pass takes it to the rack (lib/dieTrial).
          statements.push(
            ...trialVerdictStatements(ctx, { run: { id: run.id, number: run.number }, copy: trialCopy, verdict: trialResult, seq, returnedIssueId: handoff.issue.id }),
          );
        } else {
          statements.push(
            ctx.db
              .update(dieInstance)
              .set({ status: "available", serverSeq: seq })
              .where(
                and(
                  eq(dieInstance.id, run.dieInstanceId!),
                  eq(dieInstance.companyId, ctx.companyId),
                  eq(dieInstance.status, "in_use"),
                  sql`exists (select 1 from die_issue ri where ri.id = ${handoff.issue.id} and ri.status = 'returned' and ri.server_seq = ${seq})`,
                ),
              ),
          );
        }
      } else if (trialCopy && trialResult) {
        // A trial with no open issue (late entry, or the close after a reopen): the verdict still
        // moves the copy (pass: on_trial → available; fail: available → on_trial).
        statements.push(...trialVerdictStatements(ctx, { run: { id: run.id, number: run.number }, copy: trialCopy, verdict: trialResult, seq, returnedIssueId: null }));
      }
      statements.push(
        auditInsertGuarded(
          ctx,
          {
            action: "press_run.close",
            subjectType: "press_run",
            subjectId: run.id,
            meta: {
              number: run.number,
              inputG: figures.inputG,
              goodG: figures.goodG,
              recoveryBp: figures.recoveryBp,
              balanceG: figures.balanceG,
              balanceWarn: figures.balanceWarn,
              short: figures.short,
              issue: handoff.issue ? (handoff.carryTo ? { carriedTo: handoff.carryTo.number } : "returned") : null,
              trialResult,
              lines: children.lines.length,
            },
          },
          { from: pressRun, where: and(eq(pressRun.id, run.id), eq(pressRun.serverSeq, seq)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isPressAbort(e)) {
          const now = await loadRun(ctx.db, ctx.companyId, run.id);
          if (now.status === "counting" && now.serverSeq === run.serverSeq && run.castId) {
            const onHand = await castOnHand(ctx.db, ctx.companyId, run.castId);
            if ((onHand.onHandG ?? 0) < billetGuardG) {
              throw new TRPCMetaError({
                code: "CONFLICT",
                message: `Only ${((onHand.onHandG ?? 0) / 1000).toFixed(3)} kg of cast ${onHand.number} is left in the billet store now. Check the billets and log again.`,
                meta: { gates: ["billet_short_reason_missing"], billetsOnHandG: onHand.onHandG },
              });
            }
          }
          throw new TRPCError({ code: "CONFLICT", message: `${now.number} changed while it was being logged. Reload and log again.` });
        }
        throw e;
      }
      return {
        id: run.id,
        status: "logged" as const,
        ...figuresOut(figures),
        issue: handoff.issue ? (handoff.carryTo ? ("carried" as const) : ("returned" as const)) : null,
        carriedTo: handoff.carryTo,
        replayed: false,
      };
    }),

  /** Void before the log (queued | die_issued): posts nothing; an issued copy goes back to the rack. */
  void: anyActionProcedure("press.close", "order.plan")
    .input(z.object({ id, reasonCodeId: id, note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["queued", "die_issued"], "only a run that has not started can be voided");
      const [code] = await ctx.db
        .select({ id: reasonCode.id, code: reasonCode.code, requiresNote: reasonCode.requiresNote })
        .from(reasonCode)
        .where(and(eq(reasonCode.id, input.reasonCodeId), eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, "void")))
        .limit(1);
      if (!code) bad("Pick the reason for voiding");
      if ((code!.requiresNote || code!.code === "other") && !input.note) bad("Add a note for Other");
      const at = clockNow();
      const callerId = ctx.session.user.id;
      await moveRun(ctx as Ctx, run, {
        from: ["queued", "die_issued"],
        to: "voided",
        set: { voidedAt: at, voidReasonCodeId: code!.id, voidNote: input.note ?? null },
        where: and(eq(pressRun.serverSeq, run.serverSeq), sql`${pressRun.dieInAt} is null`),
        audit: "press_run.void",
        meta: { reason: code!.code, note: input.note ?? null },
        extra: (seq) =>
          run.dieInstanceId
            ? [
                ctx.db
                  .update(dieIssue)
                  .set({ status: "cancelled", returnedAt: at, returnedBy: callerId, serverSeq: seq })
                  .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, run.dieInstanceId), eq(dieIssue.status, "issued"), runLanded(run.id, seq, "voided"))),
                ctx.db
                  .update(dieInstance)
                  .set({ status: "available", serverSeq: seq })
                  .where(
                    and(
                      eq(dieInstance.id, run.dieInstanceId),
                      eq(dieInstance.companyId, ctx.companyId),
                      eq(dieInstance.status, "in_use"),
                      sql`exists (select 1 from die_issue ci where ci.company_id = ${ctx.companyId} and ci.die_instance_id = ${run.dieInstanceId} and ci.status = 'cancelled' and ci.server_seq = ${seq})`,
                    ),
                  ),
              ]
            : [],
        what: "the void",
      });
      return { id: run.id, status: "voided" as const };
    }),

  /** Ask to reopen a logged run (`press_reopen`; manager / admin / owner decide; applier reverses). */
  reopen: actionProcedure("press.close")
    .input(z.object({ id, reason }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.db, ctx.companyId, input.id);
      requireStatus(run, ["logged"], "only a logged run can be reopened");
      const pending = await pendingApproval(ctx.db, ctx.companyId, "press_reopen", run.id);
      if (pending) throw new TRPCError({ code: "CONFLICT", message: `${run.number} already waits for a reopen decision` });
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const req = requestApprovalInsert(ctx, {
        kind: "press_reopen",
        subjectId: run.id,
        serverSeq: seq,
        requestNote: input.reason,
        meta: { runNumber: run.number, reason: input.reason, goodG: run.goodG, inputG: run.inputG },
      });
      await atomicBatch(ctx.db, [
        req.statement,
        auditInsert(ctx, { action: "press_run.reopen_request", subjectType: "press_run", subjectId: run.id, meta: { number: run.number, approvalId: req.id, reason: input.reason } }),
      ]);
      return { approvalId: req.id };
    }),

  /** Owner gate helper for the queue (purpose press) — exposed for the station's Start banner. */
  ownerCheck: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const run = await loadRun(ctx.db, ctx.companyId, input.id);
    if (!run.dieInstanceId || !run.pressPlanDieId) return { ok: true as const };
    const rows = await ctx.db
      .selectDistinct({ customerId: salesOrder.customerId })
      .from(pressPlanLine)
      .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
      .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
      .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanDieId, run.pressPlanDieId)));
    for (const r of rows) await assertDieAllowed(ctx.db, ctx.companyId, { dieInstanceId: run.dieInstanceId, customerId: r.customerId, purpose: "press" });
    return { ok: true as const };
  }),
});

export { GATE_TEXT as PRESS_GATE_TEXT };
