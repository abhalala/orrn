/**
 * Press demo for the dev seed (FP-PR), added around the runs the main seed keeps for the e2e specs
 * (PR-1 die issued, PR-2..PR-4 queued, PR-5..PR-7 die trials, PR-8 logged today, PR-9 late entry).
 *
 * Today's board (production day, `clock.dayAt`, never before the day starts):
 *   Press 1   PR-8  logged  (good: the spec's worked example, 75.5 %)         [main seed]
 *             PR-11 logged  (rejects: 38 kg to QC, recovery 71.5 %)
 *             PR-1  die issued, PR-2 / PR-14 / PR-3 / PR-4 queued; PP-3 holds PR-1, PR-2, PR-14
 *   Press 2   PR-12 logged  (downtime: a 62 min breakdown)
 *             PR-10 RUNNING (angle 11250, copy 11250-1 in use)
 *             PR-13 queued, PR-9 late entry waiting for approval [main seed]; PP-4 holds PR-10, PR-13
 *
 * Two released production plans (PP-3 on P1, PP-4 on P2) stand on order lines of SO-7, SO-8 and SO-9,
 * so the orders' balance strips show "planned". The billets all come from cast dev-press-cast-1
 * (paper-era opening balance): the ledger rows of the new logged runs are exactly what
 * `press.runs.close` posts. No melts, no spectro rows (the foundry lane is paused).
 */
import type { auditLog } from "@orrn/db/schema/audit";
import type { dieWeightReading } from "@orrn/db/schema/dies";
import {
  dieIssue,
  dieRemark,
  pressBilletUse,
  pressDowntime,
  pressPlan,
  pressPlanDie,
  pressPlanLine,
  pressRemark,
  pressRun,
  pressRunLine,
  qcEntry,
} from "@orrn/db/schema/press";
import type { salesOrderLine } from "@orrn/db/schema/sales";
import type { stockLedger } from "@orrn/db/schema/stock";
import { orderGrams } from "@orrn/domain";
import { shiftAt } from "@orrn/server/lib/press";

import { LENGTH_12FT_MM, type SeedClock } from "./dev-seed-kit";

type InsertRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export type PressExtras = {
  plans: InsertRow<typeof pressPlan>[];
  planDies: InsertRow<typeof pressPlanDie>[];
  planLines: InsertRow<typeof pressPlanLine>[];
  /** Existing runs of the main seed that join a plan: run id -> plan, plan die. */
  attach: Map<string, { planId: string; pressPlanDieId: string }>;
  runs: InsertRow<typeof pressRun>[];
  issues: InsertRow<typeof dieIssue>[];
  runLines: InsertRow<typeof pressRunLine>[];
  billets: InsertRow<typeof pressBilletUse>[];
  qc: InsertRow<typeof qcEntry>[];
  downtimes: InsertRow<typeof pressDowntime>[];
  pressRemarks: InsertRow<typeof pressRemark>[];
  dieRemarks: InsertRow<typeof dieRemark>[];
  readings: InsertRow<typeof dieWeightReading>[];
  audits: InsertRow<typeof auditLog>[];
  /** The close ledger of the logged runs (`ledgerFor` fills the return stream ids). */
  loggedLedger: {
    runId: string;
    number: string;
    loggedAt: number;
    seq: number;
    inputG: number;
    discardG: number;
    endsG: number;
    rejectG: number;
  }[];
};

export function buildPressExtras(input: {
  companyId: string;
  clock: SeedClock;
  settings: Record<string, unknown>;
  runPeriod: string;
  planPeriod: string;
  /** First free numbers: PR-n and PP-n. */
  firstRunNo: number;
  firstPlanNo: number;
  ownerId: string;
  supervisorId: string;
  pressUserId: string;
  operatorId: string;
  nextSeq: () => number;
  sectionId: (key: string) => string;
  copyId: (code: string) => string;
  /** An order line row of the order book (its basis, cut and ids). */
  orderLine: (order: number, no: number) => InsertRow<typeof salesOrderLine>;
}): PressExtras {
  const { companyId, clock, settings, ownerId, supervisorId, pressUserId, operatorId, nextSeq } = input;
  const cast1 = "dev-press-cast-1";
  const child = { companyId, createdBy: ownerId };
  const runNo = (offset: number) => `PR-${input.firstRunNo + offset}`;
  const planNo = (offset: number) => `PP-${input.firstPlanNo + offset}`;

  // -- Plans -------------------------------------------------------------------------------------
  const planFor = (id: string, number: string, lineId: string) => ({
    id,
    companyId,
    serverSeq: nextSeq(),
    number,
    period: input.planPeriod,
    status: "released" as const,
    purpose: "production" as const,
    pressLineId: lineId,
    windowStart: new Date(clock.day.startMs),
    windowEnd: new Date(clock.day.endMs),
    releasedAt: new Date(clock.dayAt(0.02)),
    releasedBy: ownerId,
    createdBy: ownerId,
  });
  const plans: PressExtras["plans"] = [
    { ...planFor("dev-plan-prod-1", planNo(0), "dev-press-line-1"), note: "Press 1 today: patti for KD, tee for Royal, flat for Tejura" },
    { ...planFor("dev-plan-prod-2", planNo(1), "dev-press-line-2"), note: "Press 2 today: angles for Tejura" },
    // BACKLOG 88: the early plans whose single run is already logged (PR-11, PR-12): 100 % pressed, nothing planned.
    { ...planFor("dev-plan-early-1", planNo(2), "dev-press-line-1"), note: "Press 1, first shift: patti for KD" },
    { ...planFor("dev-plan-early-2", planNo(3), "dev-press-line-2"), note: "Press 2, first shift: flat for Tejura" },
  ];
  const planDie = (id: string, planId: string, key: string, order: number, urgent = false) => ({
    id,
    companyId,
    serverSeq: nextSeq(),
    pressPlanId: planId,
    sectionId: input.sectionId(key),
    sortOrder: order,
    urgent,
    createdBy: ownerId,
  });
  const planDies: PressExtras["planDies"] = [
    planDie("dev-plan-prod-1-die-patti", "dev-plan-prod-1", "patti1", 1, true),
    planDie("dev-plan-prod-1-die-tee", "dev-plan-prod-1", "tee125", 2),
    planDie("dev-plan-prod-1-die-flat", "dev-plan-prod-1", "flat2", 3),
    planDie("dev-plan-prod-2-die-angle", "dev-plan-prod-2", "angle1", 1),
    planDie("dev-plan-prod-2-die-angle125", "dev-plan-prod-2", "angle125", 2),
    planDie("dev-plan-early-1-die-patti", "dev-plan-early-1", "patti1", 1),
    planDie("dev-plan-early-2-die-flat", "dev-plan-early-2", "flat2", 1),
  ];
  const planLine = (id: string, planId: string, dieRowId: string, order: number, no: number, pcs: number): InsertRow<typeof pressPlanLine> => {
    const ol = input.orderLine(order, no);
    const basis = ol.kgPer12ftMilli ?? 0;
    return {
      id,
      companyId,
      serverSeq: nextSeq(),
      pressPlanId: planId,
      pressPlanDieId: dieRowId,
      salesOrderLineId: ol.id!,
      cutLengthMm: ol.cutLengthMm,
      pcs,
      kgG: orderGrams(pcs, ol.cutLengthMm, basis, "inch"),
      createdBy: ownerId,
    };
  };
  const planLines: PressExtras["planLines"] = [
    planLine("dev-plan-prod-1-line-patti", "dev-plan-prod-1", "dev-plan-prod-1-die-patti", 7, 1, 150),
    planLine("dev-plan-prod-1-line-tee", "dev-plan-prod-1", "dev-plan-prod-1-die-tee", 8, 1, 120),
    planLine("dev-plan-prod-1-line-flat", "dev-plan-prod-1", "dev-plan-prod-1-die-flat", 9, 2, 90),
    planLine("dev-plan-prod-2-line-angle", "dev-plan-prod-2", "dev-plan-prod-2-die-angle", 9, 1, 240),
    planLine("dev-plan-prod-2-line-angle125", "dev-plan-prod-2", "dev-plan-prod-2-die-angle125", 9, 5, 100),
    planLine("dev-plan-early-1-line-patti", "dev-plan-early-1", "dev-plan-early-1-die-patti", 7, 1, 80),
    planLine("dev-plan-early-2-line-flat", "dev-plan-early-2", "dev-plan-early-2-die-flat", 9, 2, 77),
  ];
  const attach: PressExtras["attach"] = new Map([
    ["dev-run-14701-1", { planId: "dev-plan-prod-1", pressPlanDieId: "dev-plan-prod-1-die-patti" }],
    ["dev-run-13090-queued", { planId: "dev-plan-prod-1", pressPlanDieId: "dev-plan-prod-1-die-tee" }],
  ]);

  // -- Runs --------------------------------------------------------------------------------------
  const runBase = (n: number) => ({ companyId, serverSeq: nextSeq(), number: runNo(n), period: input.runPeriod, createdBy: ownerId });
  const timing = (startFraction: number, stopFraction: number, loggedFraction: number) => {
    const start = clock.dayAt(startFraction);
    const stop = clock.dayAt(stopFraction);
    return { start, stop, logged: clock.dayAt(loggedFraction), shift: shiftAt(settings, start) };
  };

  // PR-11 (P1): the reject-heavy run, patti on copy 14701-2.
  const t11 = timing(0.52, 0.78, 0.82);
  const pr11 = { ...runBase(1), id: "dev-run-14701-2-rejects" };
  // PR-12 (P2): the downtime run, flat on copy 14730-1.
  const t12 = timing(0.2, 0.5, 0.55);
  const pr12 = { ...runBase(2), id: "dev-run-14730-1-downtime" };
  // PR-10 (P2): running now, angle on 11250-1. Starts late in the day so it follows PR-12 on the line.
  const t10 = timing(0.9, 0.9, 0.9);
  const pr10 = { ...runBase(0), id: "dev-run-11250-1-running" };
  const pr13 = { ...runBase(3), id: "dev-run-11262-queued" };
  const pr14 = { ...runBase(4), id: "dev-run-14730-queued" };

  const logged = (r: typeof pr11, t: ReturnType<typeof timing>, over: Partial<InsertRow<typeof pressRun>> & { sectionId: string }): InsertRow<typeof pressRun> => ({
    ...r,
    status: "logged",
    productionDay: t.shift.productionDay,
    shiftSeq: t.shift.shiftSeq,
    shiftId: t.shift.shiftId,
    operatorId,
    supervisorId,
    castId: cast1,
    dieInAt: new Date(t.start),
    dieOutAt: new Date(t.stop),
    startedAt: new Date(t.start),
    stoppedAt: new Date(t.stop),
    billetShortG: 0,
    loggedAt: new Date(t.logged),
    createdAt: new Date(t.start),
    updatedAt: new Date(t.logged),
    ...over,
  });
  const runs: PressExtras["runs"] = [
    {
      ...pr10,
      status: "running",
      planId: "dev-plan-prod-2",
      pressPlanDieId: "dev-plan-prod-2-die-angle",
      pressLineId: "dev-press-line-2",
      sectionId: input.sectionId("angle1"),
      dieInstanceId: input.copyId("11250-1"),
      productionDay: t10.shift.productionDay,
      shiftSeq: t10.shift.shiftSeq,
      shiftId: t10.shift.shiftId,
      operatorId: pressUserId,
      castId: cast1,
      dieInAt: new Date(t10.start),
      startedAt: new Date(t10.start),
      createdAt: new Date(clock.dayAt(0.05)),
      updatedAt: new Date(t10.start),
    },
    logged(pr11, t11, {
      // BACKLOG 88: PR-11 is the run of PP-5 (the first patti plan of the day), so the plan and the phone
      // plan view count its 211.5 kg. A plan die has one run, so the next patti run (PR-1) sits on PP-3.
      planId: "dev-plan-early-1",
      pressPlanDieId: "dev-plan-early-1-die-patti",
      pressLineId: "dev-press-line-1",
      sectionId: input.sectionId("patti1"),
      dieInstanceId: input.copyId("14701-2"),
      discardG: 24_000,
      endsG: 12_000,
      rejectG: 38_000,
      inputG: 296_000,
      inputWeighedG: 296_000,
      goodG: 211_500,
      recoveryBp: 7_145,
      balanceG: 10_500,
      pressRemark: "Surface lines on the first two billets; die choked at the second leg",
    }),
    logged(pr12, t12, {
      // BACKLOG 88: PR-12 is the run of PP-6 (the first flat plan of the day on Press 2).
      planId: "dev-plan-early-2",
      pressPlanDieId: "dev-plan-early-2-die-flat",
      pressLineId: "dev-press-line-2",
      sectionId: input.sectionId("flat2"),
      dieInstanceId: input.copyId("14730-1"),
      discardG: 22_000,
      endsG: 11_000,
      rejectG: 9_200,
      inputG: 300_000,
      inputWeighedG: 300_000,
      goodG: 238_800,
      recoveryBp: 7_960,
      balanceG: 19_000,
      pressRemark: "Container heater tripped; restarted after 62 minutes",
    }),
    {
      ...pr13,
      status: "queued",
      planId: "dev-plan-prod-2",
      pressPlanDieId: "dev-plan-prod-2-die-angle125",
      pressLineId: "dev-press-line-2",
      sectionId: input.sectionId("angle125"),
      createdAt: new Date(clock.dayAt(0.05)),
      updatedAt: new Date(clock.dayAt(0.05)),
    },
    {
      ...pr14,
      status: "queued",
      planId: "dev-plan-prod-1",
      pressPlanDieId: "dev-plan-prod-1-die-flat",
      pressLineId: "dev-press-line-1",
      sectionId: input.sectionId("flat2"),
      createdAt: new Date(clock.dayAt(0.05)),
      updatedAt: new Date(clock.dayAt(0.05)),
    },
  ];

  const issue = (id: string, runId: string, press: string, copy: string, issuedAt: number, returnedAt: number | null): InsertRow<typeof dieIssue> => ({
    id,
    companyId,
    serverSeq: nextSeq(),
    dieInstanceId: input.copyId(copy),
    pressLineId: press,
    pressRunId: runId,
    status: returnedAt === null ? "issued" : "returned",
    issuedAt: new Date(issuedAt),
    issuedBy: ownerId,
    returnedAt: returnedAt === null ? null : new Date(returnedAt),
    returnedBy: returnedAt === null ? null : ownerId,
    note: returnedAt === null ? "Press 2, now" : null,
  });
  const issues: PressExtras["issues"] = [
    issue("dev-issue-11250-1", pr10.id, "dev-press-line-2", "11250-1", t10.start - 15 * 60_000, null),
    issue("dev-issue-14701-2", pr11.id, "dev-press-line-1", "14701-2", t11.start - 20 * 60_000, t11.logged),
    issue("dev-issue-14730-1", pr12.id, "dev-press-line-2", "14730-1", t12.start - 20 * 60_000, t12.logged),
  ];

  // -- Children of the logged runs ---------------------------------------------------------------
  const runLines: PressExtras["runLines"] = [
    {
      id: `${pr11.id}-line-1`, ...child, serverSeq: nextSeq(), pressRunId: pr11.id, line: 1,
      pressPlanLineId: null, salesOrderLineId: input.orderLine(7, 1).id!, cutLengthMm: LENGTH_12FT_MM, pcs: 80, goodG: 211_500,
    },
    {
      id: `${pr12.id}-line-1`, ...child, serverSeq: nextSeq(), pressRunId: pr12.id, line: 1,
      pressPlanLineId: null, salesOrderLineId: input.orderLine(9, 2).id!, cutLengthMm: LENGTH_12FT_MM, pcs: 77, goodG: 238_800,
    },
  ];
  const billets: PressExtras["billets"] = [
    { id: `${pr11.id}-billet-1`, ...child, serverSeq: nextSeq(), pressRunId: pr11.id, line: 1, castId: cast1, lengthMm: 600, count: 4, kgG: 148_000 },
    { id: `${pr11.id}-billet-2`, ...child, serverSeq: nextSeq(), pressRunId: pr11.id, line: 2, castId: cast1, lengthMm: 600, count: 4, kgG: 148_000 },
    { id: `${pr12.id}-billet-1`, ...child, serverSeq: nextSeq(), pressRunId: pr12.id, line: 1, castId: cast1, lengthMm: 600, count: 4, kgG: 150_000 },
    { id: `${pr12.id}-billet-2`, ...child, serverSeq: nextSeq(), pressRunId: pr12.id, line: 2, castId: cast1, lengthMm: 600, count: 4, kgG: 150_000 },
  ];
  const qc: PressExtras["qc"] = [
    { id: `${pr11.id}-qc-1`, ...child, serverSeq: nextSeq(), pressRunId: pr11.id, line: 1, pressRunLineId: `${pr11.id}-line-1`, reasonCodeId: "dev-reason-qc_reject-surface", pcs: 8, kgG: 26_000 },
    { id: `${pr11.id}-qc-2`, ...child, serverSeq: nextSeq(), pressRunId: pr11.id, line: 2, pressRunLineId: `${pr11.id}-line-1`, reasonCodeId: "dev-reason-qc_reject-crack", pcs: 4, kgG: 12_000 },
    { id: `${pr12.id}-qc-1`, ...child, serverSeq: nextSeq(), pressRunId: pr12.id, line: 1, pressRunLineId: `${pr12.id}-line-1`, reasonCodeId: "dev-reason-qc_reject-dimension", pcs: 3, kgG: 9_200 },
  ];
  const downStart = clock.dayAt(0.3);
  const downtimes: PressExtras["downtimes"] = [
    {
      id: "dev-downtime-2",
      companyId,
      serverSeq: nextSeq(),
      pressLineId: "dev-press-line-2",
      pressRunId: pr12.id,
      reasonCodeId: "dev-reason-downtime-breakdown",
      note: "Container heater tripped",
      startedAt: new Date(downStart),
      // 62 minutes, or whatever fits inside the run when the day is young.
      stoppedAt: new Date(Math.min(downStart + 62 * 60_000, clock.dayAt(0.45))),
      startedBy: operatorId,
      stoppedBy: operatorId,
    },
  ];
  const pressRemarks: PressExtras["pressRemarks"] = [
    { id: `${pr11.id}-remark`, companyId, serverSeq: nextSeq(), pressRunId: pr11.id, dieInstanceId: input.copyId("14701-2"), body: "Surface lines on the first two billets", createdBy: operatorId, createdAt: new Date(t11.logged) },
  ];
  const dieRemarks: PressExtras["dieRemarks"] = [
    { id: `${pr11.id}-die-remark`, companyId, serverSeq: nextSeq(), dieInstanceId: input.copyId("14701-2"), pressRunId: pr11.id, body: "Choked at the second leg: send for polish", createdBy: supervisorId, createdAt: new Date(t11.logged) },
  ];

  // -- Readings that come from the runs, and the audit rows -------------------------------------
  const readings: PressExtras["readings"] = [
    { id: "dev-reading-14701-2-run", companyId, serverSeq: nextSeq(), dieInstanceId: input.copyId("14701-2"), pressRunId: pr11.id, kgPer12ftMilli: 2_650, lastKgPer12ftMilli: 2_640, readAt: new Date(t11.logged), createdBy: supervisorId },
    { id: "dev-reading-14730-1-run", companyId, serverSeq: nextSeq(), dieInstanceId: input.copyId("14730-1"), pressRunId: pr12.id, kgPer12ftMilli: 3_110, lastKgPer12ftMilli: 3_120, readAt: new Date(t12.logged), createdBy: supervisorId },
  ];
  const audits: PressExtras["audits"] = [pr11, pr12].map((r, i) => ({
    id: `dev-audit-${r.id}-logged`,
    companyId,
    actorId: supervisorId,
    action: "press.run.close",
    subjectType: "press_run",
    subjectId: r.id,
    meta: { number: r.number, goodG: i === 0 ? 211_500 : 238_800 },
    at: new Date(i === 0 ? t11.logged : t12.logged),
  }));

  const loggedLedger: PressExtras["loggedLedger"] = [
    { runId: pr11.id, number: pr11.number, loggedAt: t11.logged, seq: pr11.serverSeq, inputG: 296_000, discardG: 24_000, endsG: 12_000, rejectG: 38_000 },
    { runId: pr12.id, number: pr12.number, loggedAt: t12.logged, seq: pr12.serverSeq, inputG: 300_000, discardG: 22_000, endsG: 11_000, rejectG: 9_200 },
  ];

  return {
    plans,
    planDies,
    planLines,
    attach,
    runs,
    issues,
    runLines,
    billets,
    qc,
    downtimes,
    pressRemarks,
    dieRemarks,
    readings,
    audits,
    loggedLedger,
  };
}

/** The close ledger of one logged run, as `press.runs.close` posts it (billet out; butt, ends and rejects in). */
export function pressCloseLedger(
  run: PressExtras["loggedLedger"][number],
  ctx: {
    companyId: string;
    ownerId: string;
    streamId: (code: string) => string;
    location: (code: string) => string;
    castId: string;
  },
): InsertRow<typeof stockLedger>[] {
  const row = (line: number, itemKind: "billet" | "return_stream", itemRef: string, locationCode: string, qtyG: number, reason: string) => ({
    id: `dev-ledger-press-${run.runId}-${line}`,
    companyId: ctx.companyId,
    serverSeq: run.seq,
    voucherType: "press_run" as const,
    voucherId: run.runId,
    line,
    itemKind,
    itemRef,
    locationId: ctx.location(locationCode),
    qtyG,
    postedAt: new Date(run.loggedAt),
    reason,
    createdBy: ctx.ownerId,
  });
  return [
    row(1, "billet", ctx.castId, "BILLET", -run.inputG, `${run.number} billets`),
    row(2, "return_stream", ctx.streamId("DISCARD"), "PLANT-SCRAP", run.discardG, `${run.number} butt`),
    row(3, "return_stream", ctx.streamId("PLANT-SCRAP"), "PLANT-SCRAP", run.endsG, `${run.number} ends`),
    row(4, "return_stream", ctx.streamId("PLANT-SCRAP"), "PLANT-SCRAP", run.rejectG, `${run.number} rejects`),
  ];
}
