/**
 * Press report (FP-PR-17, 17 columns + CSV), daily summary (FP-PR-18) and Today's `pressedToday`.
 * Reads only: logged runs by production day (C15), their rows grouped per run in chunks of ids
 * (≤ 80 per IN list), downtime minutes from `press_downtime`. Recovery is always Σgood/Σinput of
 * the rows shown (never an average of percents). Late share (FP-PR-24): runs entered late over
 * runs logged, per shift and operator.
 */
import { hasStandardWording } from "./reasonCodes";
import { bpPercent1, productionDayStartMin, readFloorSettings, recoveryBp } from "@orrn/domain";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { cast } from "@orrn/db/schema/foundry";
import { pressBilletUse, pressDowntime, pressLine, pressPlan, pressRun, pressRunLine } from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { mapInChunks, type OrrnDb } from "./atomic";
import { companyTimezone, productionDayWindow, zonedWallMs } from "./dayWindow";
import { companySettings } from "./press";

const num = (v: unknown) => Number(v ?? 0);
const ID_CHUNK = 80;

export const PRESS_REPORT_COLUMNS = [
  "runNo",
  "productionDay",
  "shift",
  "line",
  "operator",
  "section",
  "copy",
  "orders",
  "cutLengths",
  "cast",
  "billets",
  "startedStopped",
  "runningMin",
  "downtimeMin",
  "good",
  "scrap",
  "recovery",
] as const;
export type PressReportColumn = (typeof PRESS_REPORT_COLUMNS)[number];

/** English CSV header (the screen uses `press.report.*`). */
const CSV_HEADER: Record<PressReportColumn, string> = {
  runNo: "Run no",
  productionDay: "Production day",
  shift: "Shift",
  line: "Press line",
  operator: "Operator",
  section: "Section",
  copy: "Die copy",
  orders: "Orders",
  cutLengths: "Cut lengths",
  cast: "Cast",
  billets: "Billets",
  startedStopped: "Started to stopped",
  runningMin: "Running min",
  downtimeMin: "Downtime min",
  good: "Good kg and pcs",
  scrap: "Butt, ends and rejects kg",
  recovery: "Recovery %",
};

export type PressReportFilter = {
  from: string;
  to: string;
  shiftSeq?: number;
  pressLineId?: string;
  planId?: string;
  limit?: number;
};

const kg = (g: number) => (g / 1000).toFixed(3);

function hhmm(timezone: string, at: Date | null): string {
  if (!at) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** Minutes of downtime rows (open rows count up to `nowMs`). */
function minutes(startedAt: Date, stoppedAt: Date | null, nowMs: number): number {
  return Math.max(0, Math.round(((stoppedAt?.getTime() ?? nowMs) - startedAt.getTime()) / 60_000));
}

export async function pressReport(db: OrrnDb, companyId: string, filter: PressReportFilter, nowMs = Date.now()) {
  const settings = await companySettings(db, companyId);
  const timezone = companyTimezone(settings);
  const shifts = readFloorSettings(settings).shifts;
  const operator = alias(user, "operator");
  const relief = alias(user, "relief");
  const limit = Math.min(filter.limit ?? 500, 2000);
  const runs = await db
    .select({
      id: pressRun.id,
      number: pressRun.number,
      productionDay: pressRun.productionDay,
      shiftSeq: pressRun.shiftSeq,
      shiftId: pressRun.shiftId,
      pressLineId: pressRun.pressLineId,
      lineCode: pressLine.code,
      operatorId: pressRun.operatorId,
      operatorName: operator.name,
      reliefName: relief.name,
      sectionCode: die.sectionCode,
      sectionName: die.name,
      copyCode: dieInstance.code,
      castNumber: cast.number,
      startedAt: pressRun.startedAt,
      stoppedAt: pressRun.stoppedAt,
      inputG: pressRun.inputG,
      goodG: pressRun.goodG,
      discardG: pressRun.discardG,
      endsG: pressRun.endsG,
      rejectG: pressRun.rejectG,
      recoveryBp: pressRun.recoveryBp,
      balanceG: pressRun.balanceG,
      lateEntry: pressRun.lateEntry,
      planId: pressRun.planId,
      purpose: pressPlan.purpose,
      trialResult: pressRun.trialResult,
    })
    .from(pressRun)
    .innerJoin(die, and(eq(die.id, pressRun.sectionId), eq(die.companyId, pressRun.companyId)))
    .leftJoin(pressLine, and(eq(pressLine.id, pressRun.pressLineId), eq(pressLine.companyId, pressRun.companyId)))
    .leftJoin(dieInstance, and(eq(dieInstance.id, pressRun.dieInstanceId), eq(dieInstance.companyId, pressRun.companyId)))
    .leftJoin(cast, and(eq(cast.id, pressRun.castId), eq(cast.companyId, pressRun.companyId)))
    .leftJoin(pressPlan, and(eq(pressPlan.id, pressRun.planId), eq(pressPlan.companyId, pressRun.companyId)))
    .leftJoin(operator, eq(operator.id, pressRun.operatorId))
    .leftJoin(relief, eq(relief.id, pressRun.reliefOperatorId))
    .where(
      and(
        eq(pressRun.companyId, companyId),
        eq(pressRun.status, "logged"),
        gte(pressRun.productionDay, filter.from),
        sql`${pressRun.productionDay} <= ${filter.to}`,
        filter.shiftSeq != null ? eq(pressRun.shiftSeq, filter.shiftSeq) : undefined,
        filter.pressLineId ? eq(pressRun.pressLineId, filter.pressLineId) : undefined,
        filter.planId ? eq(pressRun.planId, filter.planId) : undefined,
      ),
    )
    .orderBy(asc(pressRun.productionDay), asc(pressRun.shiftSeq), asc(pressRun.startedAt), asc(pressRun.number))
    .limit(limit + 1);
  const more = runs.length > limit;
  const page = runs.slice(0, limit);
  const ids = page.map((r) => r.id);

  const billets = await mapInChunks(
    ids,
    (part) =>
      db
        .select({ runId: pressBilletUse.pressRunId, count: sql<number>`sum(${pressBilletUse.count})`, kgG: sql<number>`sum(${pressBilletUse.kgG})` })
        .from(pressBilletUse)
        .where(and(eq(pressBilletUse.companyId, companyId), inArray(pressBilletUse.pressRunId, part)))
        .groupBy(pressBilletUse.pressRunId),
    ID_CHUNK,
  );
  const lines = await mapInChunks(
    ids,
    (part) =>
      db
        .select({
          runId: pressRunLine.pressRunId,
          cutLengthMm: pressRunLine.cutLengthMm,
          pcs: pressRunLine.pcs,
          orderNumber: sql<string | null>`(select so.number from sales_order_line sl join sales_order so on so.id = sl.sales_order_id and so.company_id = sl.company_id where sl.id = "press_run_line"."sales_order_line_id" and sl.company_id = "press_run_line"."company_id")`,
        })
        .from(pressRunLine)
        .where(and(eq(pressRunLine.companyId, companyId), inArray(pressRunLine.pressRunId, part)))
        .orderBy(asc(pressRunLine.line)),
    ID_CHUNK,
  );
  const downtime = await mapInChunks(
    ids,
    (part) =>
      db
        .select({
          runId: pressDowntime.pressRunId,
          code: reasonCode.code,
          label: reasonCode.label,
          labelHi: reasonCode.labelHi,
          labelGu: reasonCode.labelGu,
          startedAt: pressDowntime.startedAt,
          stoppedAt: pressDowntime.stoppedAt,
        })
        .from(pressDowntime)
        .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
        .where(and(eq(pressDowntime.companyId, companyId), inArray(pressDowntime.pressRunId, part))),
    ID_CHUNK,
  );
  const billetBy = new Map(billets.map((b) => [b.runId, { count: num(b.count), kgG: num(b.kgG) }]));
  const linesBy = new Map<string, { cuts: number[]; pcs: number; orders: string[] }>();
  for (const l of lines) {
    const v = linesBy.get(l.runId) ?? { cuts: [], pcs: 0, orders: [] };
    if (!v.cuts.includes(l.cutLengthMm)) v.cuts.push(l.cutLengthMm);
    v.pcs += l.pcs;
    if (l.orderNumber && !v.orders.includes(l.orderNumber)) v.orders.push(l.orderNumber);
    linesBy.set(l.runId, v);
  }
  type DownReason = { code: string; label: string; labelHi: string | null; labelGu: string | null; standard: boolean };
  const downBy = new Map<string, { min: number; codes: string[]; labels: string[]; reasons: DownReason[] }>();
  for (const d of downtime) {
    if (!d.runId) continue;
    const v = downBy.get(d.runId) ?? { min: 0, codes: [], labels: [], reasons: [] };
    v.min += minutes(d.startedAt, d.stoppedAt, nowMs);
    if (!v.codes.includes(d.code)) {
      v.codes.push(d.code);
      // m-9: the cell shows the reason's label (ORRN wording), the row keeps the codes.
      v.labels.push(d.label);
      // I-2: the screen shows each reason in the reader's language.
      v.reasons.push({ code: d.code, label: d.label, labelHi: d.labelHi, labelGu: d.labelGu, standard: hasStandardWording("downtime", d.code, d.label) });
    }
    downBy.set(d.runId, v);
  }

  const shiftName = (id: string | null, seq: number | null) => shifts.find((s) => s.id === id)?.name ?? (seq != null ? String(seq) : "");
  const rows = page.map((r) => {
    const b = billetBy.get(r.id) ?? { count: 0, kgG: 0 };
    const l = linesBy.get(r.id) ?? { cuts: [], pcs: 0, orders: [] };
    const d = downBy.get(r.id) ?? { min: 0, codes: [], labels: [], reasons: [] as DownReason[] };
    const spanMin = r.startedAt && r.stoppedAt ? Math.max(0, Math.round((r.stoppedAt.getTime() - r.startedAt.getTime()) / 60_000)) : 0;
    const scrapG = num(r.discardG) + num(r.endsG) + num(r.rejectG);
    const purpose = r.purpose ?? "production";
    const cells: Record<PressReportColumn, string> = {
      runNo: r.number,
      productionDay: r.productionDay ?? "",
      shift: shiftName(r.shiftId, r.shiftSeq),
      line: r.lineCode ?? "",
      operator: [r.operatorName, r.reliefName].filter(Boolean).join(" + "),
      section: r.sectionCode,
      copy: r.copyCode ?? "",
      orders: purpose === "production" ? l.orders.join(", ") : purpose,
      cutLengths: l.cuts.join(", "),
      cast: r.castNumber ?? "",
      billets: `${b.count} / ${kg(b.kgG)}`,
      startedStopped: `${hhmm(timezone, r.startedAt)}–${hhmm(timezone, r.stoppedAt)}`,
      runningMin: String(Math.max(0, spanMin - d.min)),
      downtimeMin: d.labels.length ? `${d.min} (${d.labels.join(", ")})` : String(d.min),
      good: `${kg(num(r.goodG))} / ${l.pcs}`,
      scrap: kg(scrapG),
      recovery: r.recoveryBp == null ? "" : bpPercent1(r.recoveryBp),
    };
    return {
      id: r.id,
      number: r.number,
      productionDay: r.productionDay,
      shiftSeq: r.shiftSeq,
      shiftName: cells.shift,
      pressLineId: r.pressLineId,
      lineCode: r.lineCode,
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      reliefName: r.reliefName,
      sectionCode: r.sectionCode,
      copyCode: r.copyCode,
      orders: l.orders,
      cutLengthsMm: l.cuts,
      castNumber: r.castNumber,
      billetCount: b.count,
      billetG: b.kgG,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      runningMin: Math.max(0, spanMin - d.min),
      downtimeMin: d.min,
      downtimeCodes: d.codes,
      downtimeReasons: d.reasons,
      goodG: num(r.goodG),
      pcs: l.pcs,
      inputG: num(r.inputG),
      discardG: num(r.discardG),
      endsG: num(r.endsG),
      rejectG: num(r.rejectG),
      scrapG,
      recoveryBp: r.recoveryBp,
      balanceG: r.balanceG,
      lateEntry: Boolean(r.lateEntry),
      purpose,
      /** Trial / sample / other runs are their own rows (FP-PR-23). */
      trial: purpose !== "production",
      trialResult: r.trialResult,
      planId: r.planId,
      cells,
    };
  });

  const goodG = rows.reduce((s, r) => s + r.goodG, 0);
  const inputG = rows.reduce((s, r) => s + r.inputG, 0);
  const prod = productionFigures(rows);
  const totals = {
    runs: rows.length,
    goodG,
    inputG,
    pcs: rows.reduce((s, r) => s + r.pcs, 0),
    scrapG: rows.reduce((s, r) => s + r.scrapG, 0),
    downtimeMin: rows.reduce((s, r) => s + r.downtimeMin, 0),
    // m-10: recovery is the production KPI; trial, sample and other runs stay as their own rows.
    recoveryBp: prod.recoveryBp,
    productionGoodG: prod.goodG,
    productionInputG: prod.inputG,
    lateRuns: rows.filter((r) => r.lateEntry).length,
    lateShareBp: rows.length ? Math.round((rows.filter((r) => r.lateEntry).length * 10_000) / rows.length) : 0,
  };
  return { columns: PRESS_REPORT_COLUMNS, rows, totals, lateShare: lateShareOf(rows), more };
}

/** Production runs only (m-10): trial, sample and other runs do not pull the recovery KPI down. */
function productionFigures(rows: readonly { purpose: string; goodG: number; inputG: number }[]) {
  const prod = rows.filter((r) => r.purpose === "production");
  const goodG = prod.reduce((s, r) => s + r.goodG, 0);
  const inputG = prod.reduce((s, r) => s + r.inputG, 0);
  return { goodG, inputG, recoveryBp: recoveryBp(goodG, inputG) };
}

/**
 * ONE rule for the summary and Today's tile (BACKLOG 53b, FP-PR-23): pressed kg, its input, pieces
 * and recovery count PRODUCTION runs only, so "Pressed" and its recovery share one base; the good
 * kg of die trial, sample and other runs is its own figure (`trialKgG`, `trialRuns`). Runs, scrap,
 * downtime and the late share count every run.
 */
function dayFigures(rows: readonly { purpose: string; goodG: number; inputG: number; pcs: number }[]) {
  const prod = productionFigures(rows);
  const trial = rows.filter((r) => r.purpose !== "production");
  return {
    kgG: prod.goodG,
    inputG: prod.inputG,
    pcs: rows.filter((r) => r.purpose === "production").reduce((s, r) => s + r.pcs, 0),
    recoveryBp: prod.recoveryBp,
    productionRuns: rows.length - trial.length,
    trialKgG: trial.reduce((s, r) => s + r.goodG, 0),
    trialRuns: trial.length,
  };
}

/** FP-PR-24: late entries per (shift, operator), share by runs. */
export function lateShareOf(rows: readonly { shiftSeq: number | null; shiftName?: string; operatorId: string | null; operatorName: string | null; lateEntry: boolean; goodG: number }[]) {
  const groups = new Map<string, { shiftSeq: number | null; shiftName: string | null; operatorId: string | null; operatorName: string | null; runs: number; lateRuns: number; goodG: number; lateGoodG: number }>();
  for (const r of rows) {
    const key = `${r.shiftSeq ?? ""}|${r.operatorId ?? ""}`;
    const g = groups.get(key) ?? { shiftSeq: r.shiftSeq, shiftName: r.shiftName ?? null, operatorId: r.operatorId, operatorName: r.operatorName, runs: 0, lateRuns: 0, goodG: 0, lateGoodG: 0 };
    g.runs += 1;
    g.goodG += r.goodG;
    if (r.lateEntry) {
      g.lateRuns += 1;
      g.lateGoodG += r.goodG;
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, shareBp: g.runs ? Math.round((g.lateRuns * 10_000) / g.runs) : 0 }))
    .sort((a, b) => (a.shiftSeq ?? 99) - (b.shiftSeq ?? 99) || (a.operatorName ?? "").localeCompare(b.operatorName ?? ""));
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The report as CSV, same 17 columns as the sheet. */
export function pressReportCsv(rows: readonly { cells: Record<PressReportColumn, string> }[]): string {
  const head = PRESS_REPORT_COLUMNS.map((c) => csvCell(CSV_HEADER[c])).join(",");
  return [head, ...rows.map((r) => PRESS_REPORT_COLUMNS.map((c) => csvCell(r.cells[c])).join(","))].join("\n") + "\n";
}

/** [start, end) of a production day `YYYY-MM-DD` on the company's shifts. */
export function productionDayBounds(settings: Record<string, unknown>, day: string): { startMs: number; endMs: number } {
  const tz = companyTimezone(settings);
  const [year, month, d] = day.split("-").map(Number) as [number, number, number];
  const startMin = productionDayStartMin(readFloorSettings(settings).shifts);
  const at = zonedWallMs(tz, { year, month, day: d }, startMin);
  const w = productionDayWindow(settings, at + 60_000);
  return { startMs: w.startMs, endMs: w.endMs };
}

/**
 * Daily summary (FP-PR-18): logged runs of the production day per line and shift, downtime minutes
 * of the day's downtime rows (any line, run or not) by reason, late share.
 */
export async function pressDaySummary(db: OrrnDb, companyId: string, day: string, nowMs = Date.now()) {
  const settings = await companySettings(db, companyId);
  const { startMs, endMs } = productionDayBounds(settings, day);
  const report = await pressReport(db, companyId, { from: day, to: day, limit: 2000 }, nowMs);
  const lines = await db
    .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name, status: pressLine.status })
    .from(pressLine)
    .where(eq(pressLine.companyId, companyId))
    .orderBy(asc(pressLine.sortOrder), asc(pressLine.code));
  const down = await db
    .select({
      pressLineId: pressDowntime.pressLineId,
      code: reasonCode.code,
      label: reasonCode.label,
      labelHi: reasonCode.labelHi,
      labelGu: reasonCode.labelGu,
      startedAt: pressDowntime.startedAt,
      stoppedAt: pressDowntime.stoppedAt,
    })
    .from(pressDowntime)
    .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
    .where(and(eq(pressDowntime.companyId, companyId), gte(pressDowntime.startedAt, new Date(startMs)), lt(pressDowntime.startedAt, new Date(endMs))));
  const downByLine = new Map<string, number>();
  const downByReason = new Map<string, { code: string; label: string; labelHi: string | null; labelGu: string | null; min: number }>();
  let downtimeMin = 0;
  for (const d of down) {
    const m = minutes(d.startedAt, d.stoppedAt, Math.min(nowMs, endMs));
    downtimeMin += m;
    downByLine.set(d.pressLineId, (downByLine.get(d.pressLineId) ?? 0) + m);
    const r = downByReason.get(d.code) ?? { code: d.code, label: d.label, labelHi: d.labelHi, labelGu: d.labelGu, min: 0 };
    r.min += m;
    downByReason.set(d.code, r);
  }
  const byLine = lines
    .map((l) => {
      const rs = report.rows.filter((r) => r.pressLineId === l.id);
      const f = dayFigures(rs);
      return {
        pressLineId: l.id,
        code: l.code,
        name: l.name,
        runs: rs.length,
        kgG: f.kgG,
        trialKgG: f.trialKgG,
        inputG: f.inputG,
        pcs: f.pcs,
        recoveryBp: f.recoveryBp,
        downtimeMin: downByLine.get(l.id) ?? 0,
      };
    })
    .filter((l) => l.runs > 0 || l.downtimeMin > 0 || lines.find((x) => x.id === l.pressLineId)?.status === "active");
  const shiftKeys = [...new Set(report.rows.map((r) => r.shiftSeq))];
  const byShift = shiftKeys.map((seq) => {
    const rs = report.rows.filter((r) => r.shiftSeq === seq);
    const f = dayFigures(rs);
    return { shiftSeq: seq, shiftName: rs[0]?.shiftName ?? null, runs: rs.length, kgG: f.kgG, trialKgG: f.trialKgG, inputG: f.inputG, recoveryBp: f.recoveryBp, lateRuns: rs.filter((r) => r.lateEntry).length };
  });
  const day_ = dayFigures(report.rows);
  return {
    productionDay: day,
    startMs,
    endMs,
    runs: report.totals.runs,
    productionRuns: day_.productionRuns,
    kgG: day_.kgG,
    inputG: day_.inputG,
    pcs: day_.pcs,
    trialKgG: day_.trialKgG,
    trialRuns: day_.trialRuns,
    scrapG: report.totals.scrapG,
    recoveryBp: day_.recoveryBp,
    downtimeMin,
    lateRuns: report.totals.lateRuns,
    lateShareBp: report.totals.lateShareBp,
    byLine,
    byShift,
    downtimeByReason: [...downByReason.values()].sort((a, b) => b.min - a.min).map((r) => ({ ...r, standard: hasStandardWording("downtime", r.code, r.label) })),
    lateShare: report.lateShare,
  };
}

/** Today's tile (C15/C16): the current production day's summary in Today's shape. */
export async function pressedToday(db: OrrnDb, companyId: string, day: string, nowMs = Date.now()) {
  const s = await pressDaySummary(db, companyId, day, nowMs);
  return {
    kgG: s.kgG,
    trialKgG: s.trialKgG,
    recoveryBp: s.recoveryBp,
    downtimeMin: s.downtimeMin,
    runs: s.runs,
    trialRuns: s.trialRuns,
    lateRuns: s.lateRuns,
    lateShareBp: s.lateShareBp,
    byLine: s.byLine.map((l) => ({ pressLineId: l.pressLineId, code: l.code, kgG: l.kgG, trialKgG: l.trialKgG, recoveryBp: l.recoveryBp, runs: l.runs, downtimeMin: l.downtimeMin })),
  };
}
