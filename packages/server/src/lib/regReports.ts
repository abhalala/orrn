/**
 * XE parity lane REG: the registers and views over data orrn already keeps (no copied tables).
 *
 * - `rejectionRegister` (#30): non-zero QC reject rows of logged press runs (die, copy, press, shift,
 *   reason, production day) plus pack rejects (press and shift blank, dated by the company day they were
 *   typed). Paged; totals and the per-reason sums come from SQL over the whole filter.
 * - `recutRegister` (#31): bundles packed shorter than their trolley line (`bundle.recut`), with the
 *   trolley length, the reason typed at pack and the kg lost (`recutLossG`, the same formula in SQL for
 *   the totals).
 * - `orderLineWip` (#32): `wipStages` over the balance strip (`lineStrips`) plus two small reads, the
 *   plan kg whose run is on the press and the released part of the trolley kg.
 * - `planActual` (#53): per released plan die (a plan die has exactly one run) the planned kg against the
 *   good kg of its logged run, by press, section, alloy or shift, with downtime minutes by reason.
 * - `unpackedStock` (#96): released trolley lines' remaining pieces as kg, per section and copy.
 * - `materialReconciliation` (#74): the stock ledger by material class (see `reconcileMaterial`).
 * - `planBilletNeed` (#49): `billetNeed` over a press plan's lines.
 * - `morningFigures` (#81, #82): yesterday's numbers for the owner page and the morning mail.
 *
 * Every join is scoped by company; the shift, day and zone rules are the plant's.
 */
import {
  billetNeed,
  canIssueDie,
  planGap,
  readFloorSettings,
  reconcileMaterial,
  recutLossG,
  wipHeadline,
  wipStages,
  MATERIAL_CLASSES,
  type DieBilletHistory,
  type DieCopyStatus,
  type LedgerPostingRole,
  type MaterialClass,
  type MorningFigures,
} from "@orrn/domain";
import type { LedgerItemKind, LedgerVoucherType } from "@orrn/db/schema/stock";
import { sql, type SQL } from "drizzle-orm";

import { chunk, IN_LIST_CHUNK, type OrrnDb } from "./atomic";
import { companyTimezone, productionDayWindow, zonedMidnightMs, zonedYmd } from "./dayWindow";
import { lineTotals, lineBalancePage, type LineFilter } from "./orders";
import { lineStrips } from "./orderStrip";
import { companySettings } from "./press";
import { pressDaySummary, productionDayBounds } from "./pressReport";
import { ymdMinusDays, ymdOf } from "./orderStrip";

const num = (v: unknown) => (v == null ? 0 : Number(v));
const inList = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/** Company-day range [from, to] (both included) as [startMs, endMs). */
export function dayRangeMs(settings: Record<string, unknown>, from: string, to: string) {
  const tz = companyTimezone(settings);
  const ymd = (d: string) => {
    const [year, month, day] = d.split("-").map(Number) as [number, number, number];
    return { year, month, day };
  };
  const t = ymd(to);
  return { tz, startMs: zonedMidnightMs(tz, ymd(from)), endMs: zonedMidnightMs(tz, { ...t, day: t.day + 1 }) };
}

// ── #30 rejection register ──────────────────────────────────────────────────

export type RejectionFilter = {
  from: string;
  to: string;
  sectionId?: string;
  pressLineId?: string;
  shiftId?: string;
  reason?: string;
  source?: "press" | "pack";
  limit: number;
  offset: number;
};

export async function rejectionRegister(db: OrrnDb, companyId: string, f: RejectionFilter) {
  const settings = await companySettings(db, companyId);
  const { tz, startMs, endMs } = dayRangeMs(settings, f.from, f.to);
  // The reason key: a press reject's reason code id, a pack reject's typed reason text.
  const press = sql`
    select 'press' as source, q.id as id, r.production_day as day, r.logged_at as at, r.id as run_id, r.number as run_number,
      r.section_id as section_id, d.section_code as section_code, di.code as copy_code,
      r.press_line_id as press_line_id, pl.code as press_code, r.shift_id as shift_id, r.shift_seq as shift_seq,
      coalesce(q.reason_code_id, '') as reason_key, rc.code as reason_code, coalesce(rc.label, '') as reason_label,
      q.pcs as pcs, q.kg_g as kg_g, q.note as note
    from qc_entry q
    join press_run r on r.id = q.press_run_id and r.company_id = q.company_id
    join die d on d.id = r.section_id and d.company_id = r.company_id
    left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
    left join press_line pl on pl.id = r.press_line_id and pl.company_id = r.company_id
    left join reason_code rc on rc.id = q.reason_code_id and rc.company_id = q.company_id
    where q.company_id = ${companyId} and r.status = 'logged' and (q.pcs > 0 or q.kg_g > 0)
      and r.production_day >= ${f.from} and r.production_day <= ${f.to}`;
  const pack = sql`
    select 'pack' as source, x.id as id, null as day, x.created_at as at, null as run_id, null as run_number,
      x.die_id as section_id, d.section_code as section_code, di.code as copy_code,
      null as press_line_id, null as press_code, null as shift_id, null as shift_seq,
      x.reason as reason_key, null as reason_code, x.reason as reason_label,
      x.pcs as pcs, coalesce(x.weight_g, 0) as kg_g, null as note
    from pack_reject x
    join die d on d.id = x.die_id and d.company_id = x.company_id
    left join bundle_group g on g.id = x.group_id and g.company_id = x.company_id
    left join die_instance di on di.id = g.die_instance_id and di.company_id = x.company_id
    where x.company_id = ${companyId} and x.created_at >= ${startMs} and x.created_at < ${endMs} and x.pcs > 0`;
  const parts: SQL[] = [];
  if (f.source !== "pack") parts.push(press);
  if (f.source !== "press" && !f.pressLineId && !f.shiftId) parts.push(pack);
  if (parts.length === 0) return { rows: [], total: 0, totals: { pcs: 0, kgG: 0, entries: 0 }, byReason: [], nextOffset: null };
  const where: SQL[] = [sql`1 = 1`];
  if (f.sectionId) where.push(sql`u.section_id = ${f.sectionId}`);
  if (f.pressLineId) where.push(sql`u.press_line_id = ${f.pressLineId}`);
  if (f.shiftId) where.push(sql`u.shift_id = ${f.shiftId}`);
  if (f.reason) where.push(sql`u.reason_key = ${f.reason}`);
  const union = sql`(${sql.join(parts, sql` union all `)}) u where ${sql.join(where, sql` and `)}`;
  const rows = await db.all<Record<string, unknown>>(sql`select u.* from ${union} order by u.at desc, u.id limit ${f.limit + 1} offset ${f.offset}`);
  const [tot] = await db.all<{ n: number; pcs: number; kg_g: number }>(sql`select count(*) as n, coalesce(sum(u.pcs), 0) as pcs, coalesce(sum(u.kg_g), 0) as kg_g from ${union}`);
  const byReason = await db.all<{ reason_key: string; reason_code: string | null; reason_label: string; source: string; n: number; pcs: number; kg_g: number }>(
    sql`select u.reason_key, max(u.reason_code) as reason_code, max(u.reason_label) as reason_label, max(u.source) as source, count(*) as n, coalesce(sum(u.pcs), 0) as pcs, coalesce(sum(u.kg_g), 0) as kg_g from ${union} group by u.reason_key order by kg_g desc, pcs desc limit 50`,
  );
  const shifts = readFloorSettings(settings).shifts;
  const page = rows.slice(0, f.limit);
  return {
    rows: page.map((r) => ({
      source: r.source as "press" | "pack",
      id: String(r.id),
      day: (r.day as string | null) ?? (r.at == null ? null : ymdOf(zonedYmd(tz, num(r.at)))),
      runId: (r.run_id as string | null) ?? null,
      runNumber: (r.run_number as string | null) ?? null,
      sectionId: String(r.section_id),
      sectionCode: String(r.section_code),
      copyCode: (r.copy_code as string | null) ?? null,
      pressLineId: (r.press_line_id as string | null) ?? null,
      pressCode: (r.press_code as string | null) ?? null,
      shiftId: (r.shift_id as string | null) ?? null,
      shiftName: r.shift_id ? (shifts.find((s) => s.id === r.shift_id)?.name ?? null) : r.shift_seq != null ? (shifts.find((s) => s.seq === Number(r.shift_seq))?.name ?? null) : null,
      reasonKey: String(r.reason_key ?? ""),
      reasonCode: (r.reason_code as string | null) ?? null,
      reasonLabel: String(r.reason_label ?? ""),
      pcs: num(r.pcs),
      kgG: num(r.kg_g),
      note: (r.note as string | null) ?? null,
    })),
    total: num(tot?.n),
    totals: { entries: num(tot?.n), pcs: num(tot?.pcs), kgG: num(tot?.kg_g) },
    byReason: byReason.map((r) => ({ reasonKey: r.reason_key, reasonCode: r.reason_code, reasonLabel: r.reason_label, source: r.source as "press" | "pack", entries: num(r.n), pcs: num(r.pcs), kgG: num(r.kg_g) })),
    nextOffset: rows.length > f.limit ? f.offset + f.limit : null,
  };
}

// ── #31 recut register ──────────────────────────────────────────────────────

export async function recutRegister(db: OrrnDb, companyId: string, f: { from: string; to: string; sectionId?: string; limit: number; offset: number }) {
  const settings = await companySettings(db, companyId);
  const { tz, startMs, endMs } = dayRangeMs(settings, f.from, f.to);
  const where = sql`b.company_id = ${companyId} and b.recut = 1 and b.status <> 'void' and b.created_at >= ${startMs} and b.created_at < ${endMs}${f.sectionId ? sql` and b.die_id = ${f.sectionId}` : sql``}`;
  const from = sql`from bundle b
    join die d on d.id = b.die_id and d.company_id = b.company_id
    left join die_instance di on di.id = b.die_instance_id and di.company_id = b.company_id
    left join ageing_row ar on ar.id = b.ageing_row_id and ar.company_id = b.company_id`;
  const rows = await db.all<{ id: string; serial: string; created_at: number; section_id: string; section_code: string; copy_code: string | null; length_mm: number; from_length_mm: number | null; pcs: number; weight_g: number; reason: string | null }>(sql`
    select b.id, b.serial, b.created_at, b.die_id as section_id, d.section_code, di.code as copy_code, b.length_mm, ar.length_mm as from_length_mm, b.quantity as pcs, b.weight_g, b.recut_reason as reason
    ${from} where ${where} order by b.created_at desc, b.id limit ${f.limit + 1} offset ${f.offset}`);
  // The same loss formula as recutLossG, half up, summed over the whole filter.
  const [tot] = await db.all<{ n: number; pcs: number; weight_g: number; loss_g: number }>(sql`
    select count(*) as n, coalesce(sum(b.quantity), 0) as pcs, coalesce(sum(b.weight_g), 0) as weight_g,
      coalesce(sum(case when ar.length_mm > b.length_mm and b.length_mm > 0 and b.weight_g > 0 then cast((b.weight_g * (ar.length_mm - b.length_mm) * 1.0 / b.length_mm) + 0.5 as integer) else 0 end), 0) as loss_g
    ${from} where ${where}`);
  const page = rows.slice(0, f.limit);
  return {
    rows: page.map((r) => ({
      bundleId: r.id,
      serial: r.serial,
      day: ymdOf(zonedYmd(tz, num(r.created_at))),
      sectionId: r.section_id,
      sectionCode: r.section_code,
      copyCode: r.copy_code,
      lengthMm: num(r.length_mm),
      fromLengthMm: r.from_length_mm == null ? null : num(r.from_length_mm),
      pcs: num(r.pcs),
      weightG: num(r.weight_g),
      lossG: recutLossG({ weightG: num(r.weight_g), lengthMm: num(r.length_mm), fromLengthMm: r.from_length_mm == null ? null : num(r.from_length_mm) }),
      reason: r.reason,
    })),
    total: num(tot?.n),
    totals: { bundles: num(tot?.n), pcs: num(tot?.pcs), weightG: num(tot?.weight_g), lossG: num(tot?.loss_g) },
    nextOffset: rows.length > f.limit ? f.offset + f.limit : null,
  };
}

// ── #32 work in progress per order line ─────────────────────────────────────

/** WIP stages for these lines of the company, keyed by line id (at most IN_LIST_CHUNK per read). */
export async function lineWip(db: OrrnDb, companyId: string, lineIds: readonly string[]) {
  const strips = await lineStrips(db, companyId, lineIds);
  const onPress = new Map<string, number>();
  const released = new Map<string, number>();
  for (const ids of chunk([...new Set(lineIds)], IN_LIST_CHUNK)) {
    const press = await db.all<{ line_id: string; g: number }>(sql`
      select pl.sales_order_line_id as line_id, coalesce(sum(pl.kg_g), 0) as g
      from press_plan_line pl
      join press_plan p on p.id = pl.press_plan_id and p.company_id = pl.company_id
      where pl.company_id = ${companyId} and pl.sales_order_line_id in (${inList(ids)}) and p.status = 'released'
        and exists (select 1 from press_run r where r.company_id = pl.company_id and r.press_plan_die_id = pl.press_plan_die_id and r.status in ('running', 'stopped', 'counting'))
      group by pl.sales_order_line_id`);
    for (const r of press) onPress.set(r.line_id, num(r.g));
    // The released part of the trolley kg, prorated by remaining pieces exactly as `agedExpr`.
    const rel = await db.all<{ line_id: string; g: number }>(sql`
      select ar.sales_order_line_id as line_id,
        coalesce(sum(case when ar.pcs > 0 then (ar.kg_g * max(0, ar.pcs - ar.packed_pcs - ar.scrap_pcs - ar.rework_pcs)) / ar.pcs else 0 end), 0) as g
      from ageing_row ar join ageing_batch ab on ab.id = ar.batch_id and ab.company_id = ar.company_id
      where ar.company_id = ${companyId} and ar.sales_order_line_id in (${inList(ids)}) and ar.status = 'released' and ab.status <> 'void' and ar.source <> 'bundle'
      group by ar.sales_order_line_id`);
    for (const r of rel) released.set(r.line_id, num(r.g));
  }
  const out = new Map<string, ReturnType<typeof wipStages> & { stage: ReturnType<typeof wipHeadline> }>();
  for (const [id, s] of strips) {
    const w = wipStages({
      orderedG: s.orderedG,
      plannedG: s.plannedG,
      onPressG: onPress.get(id) ?? 0,
      pressedG: s.pressedG,
      agedG: s.agedG,
      releasedG: released.get(id) ?? 0,
      packedG: s.packedG,
      dispatchedG: s.dispatchedG,
      producedG: s.producedG,
    });
    out.set(id, { ...w, stage: wipHeadline(w) });
  }
  return out;
}

/** The WIP register: open order lines, oldest order first, one page at a time. */
export async function orderLineWip(db: OrrnDb, companyId: string, f: { customerId?: string; orderId?: string; limit: number; offset: number }) {
  const filter: LineFilter = { openOnly: true, withBaki: true, ...(f.customerId ? { customerId: f.customerId } : {}), ...(f.orderId ? { orderId: f.orderId } : {}) };
  const { lines, nextOffset } = await lineBalancePage(db, companyId, filter, { limit: f.limit, offset: f.offset });
  const wip = await lineWip(db, companyId, lines.map((l) => l.lineId));
  const totals = await lineTotals(db, companyId, filter);
  return {
    rows: lines.map((l) => ({
      lineId: l.lineId,
      orderId: l.orderId,
      orderNumber: l.orderNumber,
      orderDate: l.orderDate,
      expectedDate: l.expectedDate,
      poNumber: l.poNumber,
      customerId: l.customerId,
      customerName: l.customerName,
      lineNo: l.lineNo,
      sectionCode: l.sectionCode,
      cutLengthMm: l.cutLengthMm,
      bakiG: l.bakiG,
      wip: wip.get(l.lineId)!,
    })),
    totals: { lines: totals.lines, orderedG: totals.orderedG, dispatchedG: totals.dispatchedG, bakiG: totals.bakiG },
    nextOffset,
  };
}

// ── #53 plan against actual ─────────────────────────────────────────────────

export const PLAN_ACTUAL_GROUPS = ["press", "die", "alloy", "shift"] as const;
export type PlanActualGroup = (typeof PLAN_ACTUAL_GROUPS)[number];

export async function planActual(db: OrrnDb, companyId: string, f: { from: string; to: string; groupBy: PlanActualGroup }) {
  const settings = await companySettings(db, companyId);
  const { startMs, endMs } = dayRangeMs(settings, f.from, f.to);
  // One row per released production plan die whose window starts in the range: its plan kg and its run.
  const units = await db.all<{
    plan_die_id: string;
    planned_g: number;
    run_id: string | null;
    run_status: string | null;
    good_g: number | null;
    press_line_id: string | null;
    press_code: string | null;
    section_id: string;
    section_code: string;
    alloy: string | null;
    shift_id: string | null;
    shift_seq: number | null;
  }>(sql`
    select pd.id as plan_die_id,
      (select coalesce(sum(x.kg_g), 0) from press_plan_line x where x.company_id = pd.company_id and x.press_plan_die_id = pd.id) as planned_g,
      r.id as run_id, r.status as run_status, r.good_g, coalesce(r.press_line_id, p.press_line_id) as press_line_id, pl.code as press_code,
      pd.section_id, d.section_code,
      coalesce((select max(sl.alloy) from press_plan_line x join sales_order_line sl on sl.id = x.sales_order_line_id and sl.company_id = x.company_id where x.company_id = pd.company_id and x.press_plan_die_id = pd.id), d.alloy) as alloy,
      r.shift_id, r.shift_seq
    from press_plan_die pd
    join press_plan p on p.id = pd.press_plan_id and p.company_id = pd.company_id
    join die d on d.id = pd.section_id and d.company_id = pd.company_id
    left join press_run r on r.press_plan_die_id = pd.id and r.company_id = pd.company_id and r.status <> 'voided'
    left join press_line pl on pl.id = coalesce(r.press_line_id, p.press_line_id) and pl.company_id = pd.company_id
    where pd.company_id = ${companyId} and p.status in ('released', 'closed') and p.purpose = 'production'
      and p.window_start >= ${startMs} and p.window_start < ${endMs}`);
  const shifts = readFloorSettings(settings).shifts;
  const keyOf = (u: (typeof units)[number]) => {
    if (f.groupBy === "press") return { key: u.press_line_id ?? "", label: u.press_code ?? "" };
    if (f.groupBy === "die") return { key: u.section_id, label: u.section_code };
    if (f.groupBy === "alloy") return { key: u.alloy ?? "", label: u.alloy ?? "" };
    const id = u.shift_id ?? (u.shift_seq != null ? `seq:${u.shift_seq}` : "");
    return { key: id, label: shifts.find((s) => s.id === u.shift_id)?.name ?? (u.shift_seq != null ? (shifts.find((s) => s.seq === Number(u.shift_seq))?.name ?? String(u.shift_seq)) : "") };
  };
  // Downtime of those runs, by reason (the run's own downtime rows).
  const runIds = units.map((u) => u.run_id).filter((x): x is string => !!x);
  const down = new Map<string, { code: string; label: string; min: number }[]>();
  for (const ids of chunk(runIds, IN_LIST_CHUNK)) {
    const rows = await db.all<{ run_id: string; code: string; label: string; ms: number }>(sql`
      select dt.press_run_id as run_id, rc.code, rc.label, coalesce(sum(coalesce(dt.stopped_at, ${Math.min(Date.now(), endMs)}) - dt.started_at), 0) as ms
      from press_downtime dt join reason_code rc on rc.id = dt.reason_code_id and rc.company_id = dt.company_id
      where dt.company_id = ${companyId} and dt.press_run_id in (${inList(ids)})
      group by dt.press_run_id, rc.code, rc.label`);
    for (const r of rows) {
      const list = down.get(r.run_id) ?? [];
      list.push({ code: r.code, label: r.label, min: Math.max(0, Math.round(num(r.ms) / 60_000)) });
      down.set(r.run_id, list);
    }
  }
  const groups = new Map<string, { key: string; label: string; plannedG: number; actualG: number; planDies: number; loggedRuns: number; downtimeMin: number; reasons: Map<string, { code: string; label: string; min: number }> }>();
  for (const u of units) {
    const k = keyOf(u);
    const g = groups.get(k.key) ?? { ...k, plannedG: 0, actualG: 0, planDies: 0, loggedRuns: 0, downtimeMin: 0, reasons: new Map() };
    g.plannedG += num(u.planned_g);
    g.planDies += 1;
    if (u.run_status === "logged") {
      g.actualG += num(u.good_g);
      g.loggedRuns += 1;
    }
    for (const d of u.run_id ? (down.get(u.run_id) ?? []) : []) {
      g.downtimeMin += d.min;
      const r = g.reasons.get(d.code) ?? { code: d.code, label: d.label, min: 0 };
      r.min += d.min;
      g.reasons.set(d.code, r);
    }
    groups.set(k.key, g);
  }
  const rows = [...groups.values()]
    .map((g) => ({ key: g.key, label: g.label, plannedG: g.plannedG, actualG: g.actualG, ...planGap(g.plannedG, g.actualG), planDies: g.planDies, loggedRuns: g.loggedRuns, downtimeMin: g.downtimeMin, reasons: [...g.reasons.values()].sort((a, b) => b.min - a.min) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const plannedG = rows.reduce((s, r) => s + r.plannedG, 0);
  const actualG = rows.reduce((s, r) => s + r.actualG, 0);
  return { groupBy: f.groupBy, rows, totals: { plannedG, actualG, ...planGap(plannedG, actualG), planDies: rows.reduce((s, r) => s + r.planDies, 0), downtimeMin: rows.reduce((s, r) => s + r.downtimeMin, 0) } };
}

// ── #96 unpacked stock ──────────────────────────────────────────────────────

export async function unpackedStock(db: OrrnDb, companyId: string, f: { sectionId?: string }) {
  const rows = await db.all<{ section_id: string; section_code: string; section_name: string | null; copy_id: string | null; copy_code: string | null; lines: number; pcs: number; kg_g: number; oldest: number | null }>(sql`
    select ar.die_id as section_id, d.section_code, d.name as section_name, ar.die_instance_id as copy_id, di.code as copy_code,
      count(*) as lines,
      coalesce(sum(max(0, ar.pcs - ar.packed_pcs - ar.scrap_pcs - ar.rework_pcs)), 0) as pcs,
      coalesce(sum(case when ar.pcs > 0 then (ar.kg_g * max(0, ar.pcs - ar.packed_pcs - ar.scrap_pcs - ar.rework_pcs)) / ar.pcs else 0 end), 0) as kg_g,
      min(ab.released_at) as oldest
    from ageing_row ar
    join ageing_batch ab on ab.id = ar.batch_id and ab.company_id = ar.company_id
    join die d on d.id = ar.die_id and d.company_id = ar.company_id
    left join die_instance di on di.id = ar.die_instance_id and di.company_id = ar.company_id
    where ar.company_id = ${companyId} and ar.status = 'released' and ab.status <> 'void' and ar.source <> 'bundle'
      and (ar.pcs - ar.packed_pcs - ar.scrap_pcs - ar.rework_pcs) > 0${f.sectionId ? sql` and ar.die_id = ${f.sectionId}` : sql``}
    group by ar.die_id, ar.die_instance_id
    order by d.section_code, di.code`);
  const out = rows.map((r) => ({
    sectionId: r.section_id,
    sectionCode: r.section_code,
    sectionName: r.section_name,
    copyId: r.copy_id,
    copyCode: r.copy_code,
    lines: num(r.lines),
    pcs: num(r.pcs),
    kgG: num(r.kg_g),
    oldestReleasedAt: r.oldest == null ? null : num(r.oldest),
  }));
  return { rows: out, totals: { pcs: out.reduce((s, r) => s + r.pcs, 0), kgG: out.reduce((s, r) => s + r.kgG, 0), lines: out.reduce((s, r) => s + r.lines, 0) } };
}

// ── #74 material reconciliation ─────────────────────────────────────────────

/** The material class of a ledger item kind; store items (milli-units, not grams) are left out. */
export const ITEM_CLASS: Readonly<Record<LedgerItemKind, MaterialClass | null>> = {
  scrap_grade: "metal",
  return_stream: "metal",
  billet: "billet",
  bundle: "bundle",
  store_item: null,
};

/**
 * Each voucher type's role and the document it is counted under (a reversal under what it reverses).
 * Typed over every voucher type: a new one does not compile until it is placed here.
 */
export const VOUCHER_ROLE: Readonly<Record<LedgerVoucherType, { role: LedgerPostingRole; group: string }>> = {
  opening: { role: "adjust", group: "opening" },
  pack: { role: "flow", group: "pack" },
  move: { role: "move", group: "move" },
  void: { role: "adjust", group: "void" },
  restore: { role: "adjust", group: "void" },
  dispatch: { role: "flow", group: "dispatch" },
  purchase_lot: { role: "flow", group: "purchase" },
  dc_note: { role: "flow", group: "purchase" },
  purchase_lot_cancel: { role: "flow", group: "purchase" },
  store_grn: { role: "skip", group: "store" },
  store_mrs: { role: "skip", group: "store" },
  store_grn_cancel: { role: "skip", group: "store" },
  store_mrs_cancel: { role: "skip", group: "store" },
  melt: { role: "flow", group: "melt" },
  melt_cancel: { role: "flow", group: "melt" },
  pack_reject: { role: "flow", group: "pack_reject" },
  press_run: { role: "flow", group: "press" },
  press_run_reopen: { role: "flow", group: "press" },
  cast_tail: { role: "adjust", group: "cast_tail" },
  // XE JOBWORK process steps: inputs used up (process_in) become new output (process_out) and plant
  // scrap (process_scrap); the weight that went nowhere is the step's loss (an adjustment). A send to a
  // vendor and the return are plain `move` rows.
  process_in: { role: "flow", group: "process" },
  process_out: { role: "flow", group: "process" },
  process_scrap: { role: "flow", group: "process" },
  process_loss: { role: "adjust", group: "process_loss" },
  // XE FOUNDRY: bought-in logs come in; a cut turns log weight into billets plus end-cut scrap (the billet
  // class nets the end cut out, the scrap class takes it in); an issue only moves billets to a press floor;
  // a reject takes logs or billets out to a return stream.
  log_receipt: { role: "flow", group: "log_receipt" },
  billet_cut: { role: "flow", group: "billet_cut" },
  billet_issue: { role: "move", group: "move" },
  foundry_reject: { role: "flow", group: "foundry_reject" },
};

export async function materialReconciliation(db: OrrnDb, companyId: string, f: { from: string; to: string }) {
  const settings = await companySettings(db, companyId);
  const { startMs, endMs } = dayRangeMs(settings, f.from, f.to);
  const rows = await db.all<{ item_kind: LedgerItemKind; voucher_type: LedgerVoucherType; before_g: number; period_g: number }>(sql`
    select item_kind, voucher_type,
      coalesce(sum(case when posted_at < ${startMs} then qty_g else 0 end), 0) as before_g,
      coalesce(sum(case when posted_at >= ${startMs} then qty_g else 0 end), 0) as period_g
    from stock_ledger
    where company_id = ${companyId} and item_kind <> 'store_item' and posted_at < ${endMs}
    group by item_kind, voucher_type`);
  const classes = MATERIAL_CLASSES.map((cls) => {
    let openingG = 0;
    let periodG = 0;
    const groups = new Map<string, { group: string; role: "flow" | "adjust"; netG: number }>();
    for (const r of rows) {
      if (ITEM_CLASS[r.item_kind] !== cls) continue;
      openingG += num(r.before_g);
      periodG += num(r.period_g);
      const v = VOUCHER_ROLE[r.voucher_type] ?? { role: "adjust" as const, group: r.voucher_type };
      if (v.role === "move" || v.role === "skip") continue;
      const g = groups.get(v.group) ?? { group: v.group, role: v.role, netG: 0 };
      g.netG += num(r.period_g);
      groups.set(v.group, g);
    }
    // Moves net to zero across locations; whatever they leave is shown in the gap, never hidden.
    const moveG = rows.filter((r) => ITEM_CLASS[r.item_kind] === cls && VOUCHER_ROLE[r.voucher_type]?.role === "move").reduce((s, r) => s + num(r.period_g), 0);
    if (moveG !== 0) groups.set("move", { group: "move", role: "adjust", netG: moveG });
    return { class: cls, ...reconcileMaterial({ openingG, closingG: openingG + periodG, groups: [...groups.values()] }) };
  });
  return { from: f.from, to: f.to, classes };
}

// ── #49 billet need per plan ────────────────────────────────────────────────

export async function planBilletNeed(db: OrrnDb, companyId: string, planId: string) {
  const lines = await db.all<{ line_id: string; section_id: string; section_code: string; alloy: string | null; kg_g: number; purpose: string; run_copy: string | null; run_status: string | null; plan_die_id: string; so_number: string | null; cut_length_mm: number }>(sql`
    select x.id as line_id, pd.section_id, d.section_code, coalesce(sl.alloy, d.alloy) as alloy, x.kg_g, p.purpose,
      r.die_instance_id as run_copy, r.status as run_status, pd.id as plan_die_id, so.number as so_number, x.cut_length_mm
    from press_plan_line x
    join press_plan_die pd on pd.id = x.press_plan_die_id and pd.company_id = x.company_id
    join press_plan p on p.id = x.press_plan_id and p.company_id = x.company_id
    join die d on d.id = pd.section_id and d.company_id = x.company_id
    left join sales_order_line sl on sl.id = x.sales_order_line_id and sl.company_id = x.company_id
    left join sales_order so on so.id = sl.sales_order_id and so.company_id = x.company_id
    left join press_run r on r.press_plan_die_id = pd.id and r.company_id = x.company_id and r.status <> 'voided'
    where x.company_id = ${companyId} and x.press_plan_id = ${planId}
    order by pd.sort_order, pd.created_at, x.created_at, x.id`);
  if (lines.length === 0) return { rows: [], totals: [] };
  const sections = [...new Set(lines.map((l) => l.section_id))];
  const history = new Map<string, DieBilletHistory>();
  const copies = new Map<string, { status: DieCopyStatus; open: boolean }[]>();
  for (const ids of chunk(sections, IN_LIST_CHUNK)) {
    const runs = await db.all<{ section_id: string; input_g: number; good_g: number }>(sql`
      select r.section_id, coalesce(sum(r.input_g), 0) as input_g, coalesce(sum(r.good_g), 0) as good_g
      from press_run r left join press_plan pp on pp.id = r.plan_id and pp.company_id = r.company_id
      where r.company_id = ${companyId} and r.status = 'logged' and coalesce(pp.purpose, 'production') = 'production' and r.section_id in (${inList(ids)})
      group by r.section_id`);
    const billets = await db.all<{ section_id: string; length_mm: number | null; n: number; kg_g: number }>(sql`
      select r.section_id, u.length_mm, coalesce(sum(u.count), 0) as n, coalesce(sum(u.kg_g), 0) as kg_g
      from press_billet_use u join press_run r on r.id = u.press_run_id and r.company_id = u.company_id
      where u.company_id = ${companyId} and r.status = 'logged' and r.section_id in (${inList(ids)})
      group by r.section_id, u.length_mm`);
    for (const r of runs) history.set(r.section_id, { inputG: num(r.input_g), goodG: num(r.good_g), billetLengthMm: null, billetG: null });
    // The die's usual billet: the length it used most pieces of, and that length's average kg per billet.
    for (const s of ids) {
      const mine = billets.filter((b) => b.section_id === s && num(b.n) > 0).sort((a, b) => num(b.n) - num(a.n));
      const top = mine[0];
      if (!top) continue;
      const h = history.get(s) ?? { inputG: 0, goodG: 0, billetLengthMm: null, billetG: null };
      history.set(s, { ...h, billetLengthMm: top.length_mm == null ? null : num(top.length_mm), billetG: Math.round(num(top.kg_g) / num(top.n)) });
    }
    const cs = await db.all<{ section_id: string; status: DieCopyStatus; open: number }>(sql`
      select di.section_id, di.status,
        exists (select 1 from die_issue i where i.company_id = di.company_id and i.die_instance_id = di.id and i.status = 'issued') as open
      from die_instance di where di.company_id = ${companyId} and di.section_id in (${inList(ids)})`);
    for (const c of cs) copies.set(c.section_id, [...(copies.get(c.section_id) ?? []), { status: c.status, open: !!Number(c.open) }]);
  }
  const [plant] = await db.all<{ input_g: number; good_g: number }>(sql`
    select coalesce(sum(r.input_g), 0) as input_g, coalesce(sum(r.good_g), 0) as good_g
    from press_run r left join press_plan pp on pp.id = r.plan_id and pp.company_id = r.company_id
    where r.company_id = ${companyId} and r.status = 'logged' and coalesce(pp.purpose, 'production') = 'production'`);
  const stock = await db.all<{ alloy: string; g: number }>(sql`
    select c.alloy, coalesce(sum(l.qty_g), 0) as g
    from stock_ledger l join ${sql.identifier("cast")} c on c.id = l.item_ref and c.company_id = l.company_id
    where l.company_id = ${companyId} and l.item_kind = 'billet'
    group by c.alloy`);
  // Die ready: the run already holds a copy, or the die room has a copy it may issue (canIssueDie).
  const purposeOf = (p: string) => (p === "die_trial" || p === "sample" || p === "other" ? p : "production") as "production" | "die_trial" | "sample" | "other";
  const need = billetNeed({
    lines: lines.map((l) => ({
      key: l.line_id,
      sectionId: l.section_id,
      alloy: l.alloy,
      kgG: num(l.kg_g),
      dieReady:
        (l.run_copy != null && l.run_status !== "logged") ||
        (copies.get(l.section_id) ?? []).some((c) => canIssueDie({ copy: { status: c.status, sectionId: l.section_id }, openIssueForCopy: c.open, pressLineId: "", purpose: purposeOf(l.purpose) }).ok),
    })),
    history,
    plant: { inputG: num(plant?.input_g), goodG: num(plant?.good_g) },
    stockByAlloy: new Map(stock.map((s) => [s.alloy, Math.max(0, num(s.g))])),
  });
  const meta = new Map(lines.map((l) => [l.line_id, l]));
  return {
    rows: need.rows.map((r) => ({ ...r, planLineId: r.key, sectionCode: meta.get(r.key)!.section_code, soNumber: meta.get(r.key)!.so_number, cutLengthMm: num(meta.get(r.key)!.cut_length_mm), planDieId: meta.get(r.key)!.plan_die_id })),
    totals: need.totals,
  };
}

// ── #81, #82 the morning figures ────────────────────────────────────────────

/** Yesterday's production day of the plant at `at`, and its figures. No rupee figure. */
export async function morningFigures(db: OrrnDb, companyId: string, at: Date, day?: string): Promise<MorningFigures> {
  const settings = await companySettings(db, companyId);
  const today = productionDayWindow(settings, at.getTime()).productionDay;
  const d = day ?? ymdMinusDays(today, 1);
  const s = await pressDaySummary(db, companyId, d, at.getTime());
  const { startMs, endMs } = productionDayBounds(settings, d);
  const [disp] = await db.all<{ n: number; g: number }>(sql`
    select count(distinct d.id) as n, coalesce(sum(b.weight_g), 0) as g
    from dispatch d
    left join dispatch_item i on i.dispatch_id = d.id and i.company_id = d.company_id
    left join bundle b on b.id = i.bundle_id and b.company_id = d.company_id
    where d.company_id = ${companyId} and d.status = 'completed' and d.deleted_at is null and d.completed_at >= ${startMs} and d.completed_at < ${endMs}`);
  const baki = await lineTotals(db, companyId, { openOnly: true, withBaki: true });
  // Casts tested that day whose deciding result (latest live result with numbers) failed.
  const failed = await db.all<{ number: string; alloy: string | null }>(sql`
    select c.number, c.alloy from ${sql.identifier("cast")} c
    where c.company_id = ${companyId}
      and exists (select 1 from spectro_result t where t.company_id = c.company_id and t.cast_id = c.id and t.voided_at is null and t.created_at >= ${startMs} and t.created_at < ${endMs})
      and (select t.verdict from spectro_result t where t.company_id = c.company_id and t.cast_id = c.id and t.voided_at is null and t.values_ppm <> '{}'
           order by t.created_at desc, t.server_seq desc limit 1) = 'fail'
    order by c.number`);
  return {
    day: d,
    pressedG: s.kgG,
    inputG: s.inputG,
    recoveryBp: s.recoveryBp,
    runs: s.productionRuns,
    trialG: s.trialKgG,
    downtime: s.downtimeByReason.map((r) => ({ reason: r.label, minutes: r.min })),
    downtimeMinutes: s.downtimeMin,
    dispatches: num(disp?.n),
    dispatchedG: num(disp?.g),
    openLines: baki.lines,
    bakiG: baki.bakiG,
    failedCasts: failed.map((c) => ({ number: c.number, alloy: c.alloy })),
  };
}
