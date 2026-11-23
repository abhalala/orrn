/**
 * Plant maintenance reads shared by the router and Today (XE parity lane MAINT). Pure rules live in
 * `@orrn/domain` (`maintenance.ts`); this file reads rows and hands them over.
 *
 * Run hours (row 64) come from what the plant already records, per linked master:
 * - press: press runs on the line (started to stopped; a running run counts to now), minus the run's
 *   cuts: the downtime logged on it and its stop-to-resume pauses, each clipped to the run itself (a
 *   downtime entry logged after the run stopped subtracts nothing), overlaps counted once. A pause is
 *   read from the audit log: a `press_run.resume` row back to the run's latest `press_run.stop` row
 *   before it (server receipt times, the same clock that sets `stopped_at`). A resume with no stop row
 *   before it subtracts nothing, so the plan can only come due earlier, never later. Voided runs never count.
 * - furnace: locked melts on the furnace, from preheat (else charging) start to casting end.
 * - oven: ageing batches in the oven, from in to out (still in: to now); void batches never count.
 * An asset with no link has no run hours, so a plan on it can only run on calendar days.
 * The run totals aggregate in SQL (GROUP BY plan); the press cuts come back as rows already clipped to
 * their run and the plan's base, and are merged per run here (`mergedMinutes`). Every query binds a
 * handful of parameters, never an id list.
 */
import { comparePmDue, dayNumber, mergedMinutes, pmDue, type MaintLinkKind, type PmDue } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import { maintAsset, maintPlan, maintSetting, type MaintAssetRow } from "@orrn/db/schema/maintenance";
import { furnace } from "@orrn/db/schema/foundry";
import { ageingOven } from "@orrn/db/schema/ageing";
import { pressLine } from "@orrn/db/schema/press";
import { company, membership } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "./atomic";
import { companyTimezone, zonedYmd } from "./dayWindow";

type Ctx = { db: OrrnDb; companyId: string };

export const MAINT_NOT_FOUND = "Not found";
export const ASSET_NO_RUN_HOURS = "This asset has no run hours. Link it to a press, furnace or oven, or plan by days";
export const LINK_NOT_FOUND = "That press, furnace or oven is not in this plant";
export const LINK_TAKEN = "Another asset already points at that press, furnace or oven";
export const ASSET_CODE_TAKEN = "Another asset already has that code";
export const ASSIGNEE_NOT_MEMBER = "The person is not a member of this plant";

export function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: MAINT_NOT_FOUND });
}

export async function loadAsset(ctx: Ctx, assetId: string): Promise<MaintAssetRow> {
  const [row] = await ctx.db.select().from(maintAsset).where(and(eq(maintAsset.companyId, ctx.companyId), eq(maintAsset.id, assetId))).limit(1);
  if (!row) throw notFound();
  return row;
}

/** The linked master in this plant, with its code and name; throws BAD_REQUEST when it is not here. */
export async function loadLink(ctx: Ctx, kind: MaintLinkKind, id: string): Promise<{ code: string; name: string | null }> {
  const [row] =
    kind === "press"
      ? await ctx.db.select({ code: pressLine.code, name: pressLine.name }).from(pressLine).where(and(eq(pressLine.companyId, ctx.companyId), eq(pressLine.id, id))).limit(1)
      : kind === "furnace"
        ? await ctx.db.select({ code: furnace.code, name: furnace.name }).from(furnace).where(and(eq(furnace.companyId, ctx.companyId), eq(furnace.id, id))).limit(1)
        : await ctx.db.select({ code: ageingOven.code, name: ageingOven.name }).from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), eq(ageingOven.id, id))).limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: LINK_NOT_FOUND });
  return row;
}

/** A person named on a work order must be a member of this plant. */
export async function assertMember(ctx: Ctx, userId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ id: membership.userId })
    .from(membership)
    .where(and(eq(membership.companyId, ctx.companyId), eq(membership.userId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: ASSIGNEE_NOT_MEMBER });
}

export async function labourRate(ctx: Ctx): Promise<number | null> {
  const [row] = await ctx.db.select({ rate: maintSetting.labourRatePaisePerHour }).from(maintSetting).where(eq(maintSetting.companyId, ctx.companyId)).limit(1);
  return row?.rate ?? null;
}

// ---------------------------------------------------------------------------
// Run minutes since each plan's base
// ---------------------------------------------------------------------------

type Row = { plan_id: string; ms: number | null };
type CutRow = { plan_id: string; run_id: string; s: number; e: number };
type Sql = ReturnType<typeof sql>;

/**
 * The three press queries of `planUsageMinutes`, exported so a test can `EXPLAIN QUERY PLAN` them.
 *
 * Prod D1 has no ANALYZE statistics, so the join order is fixed by hand: SQLite never reorders the
 * tables of a CROSS JOIN. Each query runs plan -> asset -> press_run -> (downtime | audit_log):
 * - press_run is read through `press_run_company_line_end_idx` as a range from the plan's base, so only
 *   runs that end after it (or have not ended) are read. `+p.base_at` drops the column's affinity; with
 *   it, SQLite will not compare against the expression index. The old `runEnd > base` test stays as a
 *   filter, so the rows are the same.
 * - audit_log is reached per run through `audit_subject_idx` (company, subject type, subject id). The
 *   `+` on `at` keeps SQLite off `audit_company_at_idx`, which would walk the whole plant's audit log by time.
 * - The pause rows are MATERIALIZED once, so the "latest stop" subquery runs once per resume row.
 */
export function pressUsageSql(companyId: string, nowMs: number, assetId?: string): { runs: Sql; downtimeCuts: Sql; pauseCuts: Sql } {
  const now = sql`${nowMs}`;
  const assetFilter = assetId ? sql`and p.asset_id = ${assetId}` : sql``;
  const base = sql`p.company_id = ${companyId} and p.active = 1 and p.interval_hours is not null ${assetFilter}`;
  // A downtime entry attaches to the line's latest running OR stopped run, so it may lie after the run
  // stopped: clipping each cut to its run keeps it from eating other runs' hours.
  const runEnd = sql`coalesce(r.stopped_at, ${now})`;
  const runsSinceBase = sql`
    from maint_plan p
    cross join maint_asset a on a.id = p.asset_id and a.company_id = p.company_id and a.link_kind = 'press'
    cross join press_run r on r.company_id = p.company_id and r.press_line_id = a.link_id
      and coalesce(r.stopped_at, 9007199254740991) > +p.base_at
      and r.status <> 'voided' and r.started_at is not null and ${runEnd} > p.base_at`;
  return {
    runs: sql`
      select p.id as plan_id, coalesce(sum(max(0, min(${runEnd}, ${now}) - max(r.started_at, p.base_at))), 0) as ms
      ${runsSinceBase}
      where ${base}
      group by p.id`,
    downtimeCuts: sql`
      select plan_id, run_id, s, e from (
        select p.id as plan_id, r.id as run_id,
          max(d.started_at, r.started_at, p.base_at) as s,
          min(coalesce(d.stopped_at, ${now}), ${runEnd}, ${now}) as e
        ${runsSinceBase}
        cross join press_downtime d on d.company_id = r.company_id and d.press_run_id = r.id
          and coalesce(d.stopped_at, ${now}) > p.base_at
        where ${base}
      ) where e > s`,
    pauseCuts: sql`
      with c as materialized (
        select p.id as plan_id, r.id as run_id,
          max((select max(+st.at) from audit_log st
                 where st.company_id = r.company_id and st.subject_type = 'press_run' and st.subject_id = r.id
                   and st.action = 'press_run.stop' and +st.at <= x.at), r.started_at, p.base_at) as s,
          min(x.at, ${runEnd}, ${now}) as e
        ${runsSinceBase}
        cross join audit_log x on x.company_id = r.company_id and x.subject_type = 'press_run' and x.subject_id = r.id
          and x.action = 'press_run.resume' and +x.at > p.base_at
        where ${base}
      )
      select plan_id, run_id, s, e from c where s is not null and e > s`,
  };
}

/**
 * Run minutes of each active hours plan since its `base_at`, as of `nowMs`, for plans whose asset is
 * linked. `assetId` narrows to one asset. Plans with no link (or no hours interval) are absent.
 */
export async function planUsageMinutes(ctx: Ctx, nowMs: number, assetId?: string): Promise<Map<string, number>> {
  const c = ctx.companyId;
  const now = sql`${nowMs}`;
  const assetFilter = assetId ? sql`and p.asset_id = ${assetId}` : sql``;
  const base = sql`p.company_id = ${c} and p.active = 1 and p.interval_hours is not null ${assetFilter}`;
  const clip = (start: Sql, end: Sql) => sql`coalesce(sum(max(0, min(${end}, ${now}) - max(${start}, p.base_at))), 0)`;
  const press = pressUsageSql(c, nowMs, assetId);

  const [runs, downtimeCuts, pauseCuts, melts, batches] = await Promise.all([
    ctx.db.all<Row>(press.runs),
    ctx.db.all<CutRow>(press.downtimeCuts),
    ctx.db.all<CutRow>(press.pauseCuts),
    ctx.db.all<Row>(sql`
      select p.id as plan_id, ${clip(sql`coalesce(m.preheat_start_at, m.charging_start_at)`, sql`m.casting_end_at`)} as ms
      from maint_plan p
      join maint_asset a on a.id = p.asset_id and a.company_id = p.company_id and a.link_kind = 'furnace'
      join melt m on m.company_id = p.company_id and m.furnace_id = a.link_id and m.status = 'locked'
        and coalesce(m.preheat_start_at, m.charging_start_at) is not null and m.casting_end_at is not null and m.casting_end_at > p.base_at
      where ${base}
      group by p.id`),
    ctx.db.all<Row>(sql`
      select p.id as plan_id, ${clip(sql`b.in_at`, sql`coalesce(b.out_at, ${now})`)} as ms
      from maint_plan p
      join maint_asset a on a.id = p.asset_id and a.company_id = p.company_id and a.link_kind = 'oven'
      join ageing_batch b on b.company_id = p.company_id and b.oven_id = a.link_id and b.status <> 'void'
        and b.in_at is not null and coalesce(b.out_at, ${now}) > p.base_at
      where ${base}
      group by p.id`),
  ]);

  const out = new Map<string, number>();
  const add = (rows: Row[]) => {
    for (const r of rows) out.set(r.plan_id, (out.get(r.plan_id) ?? 0) + Number(r.ms ?? 0));
  };
  add(runs);
  add(melts);
  add(batches);
  // Cuts merged per (plan, run): a downtime entry inside a pause is taken off once.
  const cuts = new Map<string, { plan: string; spans: { startMs: number; endMs: number }[] }>();
  for (const c of [...downtimeCuts, ...pauseCuts]) {
    const key = `${c.plan_id}|${c.run_id}`;
    const entry = cuts.get(key) ?? { plan: c.plan_id, spans: [] };
    entry.spans.push({ startMs: Number(c.s), endMs: Number(c.e) });
    cuts.set(key, entry);
  }
  for (const { plan, spans } of cuts.values()) out.set(plan, (out.get(plan) ?? 0) - mergedMinutes(spans) * 60_000);
  for (const [k, ms] of out) out.set(k, Math.max(0, Math.floor(ms / 60_000)));
  return out;
}

/** The plant's timezone (company settings, Asia/Kolkata by default). */
export async function plantTimezone(ctx: Ctx): Promise<string> {
  const [row] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
  return companyTimezone(row?.settings);
}

/** The plant day of an instant as a day number, on the plant's clock (`pmDue` counts days with it). */
export function plantDayOf(timezone: string): (ms: number) => number {
  return (ms) => dayNumber(zonedYmd(timezone, ms));
}

export type PlanDueRow = {
  planId: string;
  title: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  intervalDays: number | null;
  intervalHours: number | null;
  baseAt: number;
  due: PmDue;
  /** The live preventive work order on this plan, if one is open. */
  openWorkOrderId: string | null;
  openWorkOrderNumber: string | null;
};

/** Every active plan (of one asset, or all), with its due figures, overdue first. */
export async function plansDue(ctx: Ctx, nowMs: number, assetId?: string): Promise<PlanDueRow[]> {
  const [usage, tz] = await Promise.all([planUsageMinutes(ctx, nowMs, assetId), plantTimezone(ctx)]);
  const dayOf = plantDayOf(tz);
  const rows = await ctx.db.all<{
    id: string;
    title: string;
    asset_id: string;
    code: string;
    name: string;
    interval_days: number | null;
    interval_hours: number | null;
    base_at: number;
    wo_id: string | null;
    wo_number: string | null;
  }>(sql`
    select p.id, p.title, p.asset_id, a.code, a.name, p.interval_days, p.interval_hours, p.base_at,
      w.id as wo_id, w.number as wo_number
    from ${maintPlan} p
    join ${maintAsset} a on a.id = p.asset_id and a.company_id = p.company_id
    left join maint_work_order w on w.company_id = p.company_id and w.plan_id = p.id
      and w.status in ('open', 'in_progress', 'waiting_spares')
    where p.company_id = ${ctx.companyId} and p.active = 1 and a.status <> 'retired'
      ${assetId ? sql`and p.asset_id = ${assetId}` : sql``}
    limit 1000`);
  return rows
    .map((r) => ({
      planId: r.id,
      title: r.title,
      assetId: r.asset_id,
      assetCode: r.code,
      assetName: r.name,
      intervalDays: r.interval_days,
      intervalHours: r.interval_hours,
      baseAt: Number(r.base_at),
      due: pmDue({
        intervalDays: r.interval_days,
        intervalHours: r.interval_hours,
        baseAtMs: Number(r.base_at),
        usageMinSinceBase: r.interval_hours != null ? (usage.get(r.id) ?? 0) : null,
        nowMs,
        dayOf,
      }),
      openWorkOrderId: r.wo_id,
      openWorkOrderNumber: r.wo_number,
    }))
    .sort((a, b) => comparePmDue(a.due, b.due));
}
