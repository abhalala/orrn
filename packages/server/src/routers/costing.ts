/**
 * XE parity lane COST: `costing.*` (rows 16, 17, 51, 52, 61, 92). Module `costing`, opt-in: every
 * procedure calls `assertCostingOn` (the router-level gate in `companyProcedure` treats an empty module
 * list as "all on", which is not enough for an opt-in module).
 *
 * Gates: `cost.view` (owner, admin, manager, accountant) reads cost per kg, capacity, the forecast and
 * the dies due; `cost.manage` (owner, admin, manager) sets `company.settings.costing`. A rate or a
 * margin (rate minus cost) is shown only to a caller who also holds `order.price` while the plant has
 * `priceOnSalesOrder` on: `orderLines` leaves the rate and margin fields out for anyone else and
 * `profitability` refuses. All figures are computed here; clients never send one.
 */
import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { pressLine } from "@orrn/db/schema/press";
import { company } from "@orrn/db/schema/tenant";
import {
  addDaysYmd,
  addMonths,
  amountPaise,
  COST_STAGES,
  driftProjection,
  dueEstimate,
  forecastMonths,
  intervalsG,
  marginOf,
  MAX_COST_PAISE,
  minutesFor,
  monthOf,
  pickCost,
  putRateVersion,
  ratesOn,
  scaleByPct,
  weekIndex,
  weekLoads,
  weekMinutes,
  weekStart,
  type CostBasis,
  type LoadItem,
} from "@orrn/domain";

import { actionProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { settingsPatchSql } from "../lib/companySettings";
import {
  assertCostingOn,
  costingCompany,
  costRuns,
  DAY_MS,
  groupRuns,
  ratesAllowed,
  rollup,
  runMonth,
  sectionSpeeds,
  type CostedRun,
} from "../lib/costing";
import { lineBalancePage, type LineBalance } from "../lib/orders";
import { ymd } from "../lib/pricingKit";

const viewProcedure = actionProcedure("cost.view");
const manageProcedure = actionProcedure("cost.manage");

const id = z.string().min(1).max(64);
const paise = z.number().int().min(0).max(MAX_COST_PAISE);
const FORBIDDEN_RATES = "Rates are not shown to you";

const stageRate = z.object({ basis: z.enum(["kg", "hour"]), paise, kgPerHour: z.number().int().min(1).max(1_000_000).nullable().default(null) });

const rangeInput = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "The start date must be before the end date");

/** Default window: the 90 days to today. */
function range(today: string, input: { from?: string; to?: string } | undefined) {
  const to = input?.to ?? today;
  const from = input?.from ?? addDaysYmd(to, -89);
  if (from > to) throw new TRPCError({ code: "BAD_REQUEST", message: "The start date must be before the end date" });
  return { from, to };
}

async function gate(ctx: { db: Parameters<typeof costingCompany>[0]; companyId: string }) {
  const co = await costingCompany(ctx.db, ctx.companyId, clockNow());
  assertCostingOn(co);
  return co;
}

/** What a screen lists for one costed run: the figures and every input used. */
function runView(r: CostedRun) {
  return {
    id: r.id,
    number: r.number,
    productionDay: r.productionDay,
    sectionId: r.sectionId,
    sectionCode: r.sectionCode,
    copyCode: r.copyCode,
    inputG: r.inputG,
    goodG: r.goodG,
    discardG: r.discardG,
    endsG: r.endsG,
    rejectG: r.rejectG,
    minutes: r.minutes,
    metal: {
      basis: r.metal.basis,
      paisePerBilletKg: r.metal.paisePerBilletKg,
      listPaisePerKg: r.metal.listPaisePerKg ?? null,
      meltYieldBp: r.metal.meltYieldBp ?? null,
      boughtShareBp: r.metal.boughtShareBp ?? null,
      rateDate: r.metal.rateDate,
      casts: r.metal.casts,
    },
    ratesFrom: r.ratesFrom,
    ...r.cost,
  };
}

const capacityInput = z
  .object({
    weeks: z.number().int().min(1).max(26).default(8),
    withForecast: z.boolean().default(false),
    scenario: z
      .array(z.object({ customerId: id, pct: z.number().int().min(-100).max(500) }))
      .max(10)
      .default([]),
  })
  .default({ weeks: 8, withForecast: false, scenario: [] });

type HistoryRow = { customer_id: string; die_id: string; m: string; kg_g: number };

/** Ordered kg per (customer, section, month) for the months from `fromMonth` (cancelled orders left out). */
async function orderHistory(db: Parameters<typeof costingCompany>[0], companyId: string, fromMonth: string): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  const LIMIT = 50_000;
  const rows = await db.all<HistoryRow>(sql`
    select o.customer_id, l.die_id, substr(o.order_date, 1, 7) as m, sum(l.kg_g) as kg_g
    from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = l.company_id
    where l.company_id = ${companyId} and o.status <> 'cancelled' and o.order_date >= ${`${fromMonth}-01`}
    group by o.customer_id, l.die_id, substr(o.order_date, 1, 7)
    limit ${LIMIT + 1}`);
  return { rows: rows.slice(0, LIMIT).map((r) => ({ ...r, kg_g: Number(r.kg_g) })), truncated: rows.length > LIMIT };
}

/** Open order lines with work left to press (ordered − packed), at most 5000. */
async function openWork(db: Parameters<typeof costingCompany>[0], companyId: string): Promise<{ lines: LineBalance[]; truncated: boolean }> {
  const lines: LineBalance[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < 5 && offset != null; page++) {
    const got: { lines: LineBalance[]; nextOffset: number | null } = await lineBalancePage(db, companyId, { openOnly: true, withBaki: true }, { limit: 1000, offset });
    lines.push(...got.lines);
    offset = got.nextOffset;
  }
  return { lines, truncated: offset != null };
}

export const costingRouter = router({
  settings: router({
    get: viewProcedure.query(async ({ ctx }) => {
      const co = await gate(ctx);
      const lines = await ctx.db
        .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name, status: pressLine.status })
        .from(pressLine)
        .where(eq(pressLine.companyId, ctx.companyId))
        .orderBy(asc(pressLine.sortOrder), asc(pressLine.code));
      return { ...co.costing, ratesToday: ratesOn(co.costing.rates, co.today), today: co.today, pressLines: lines, metalSource: co.pricing.metalSource };
    }),

    /**
     * cost.manage. Stage rates are effective-dated: `rateVersion` adds (or replaces) the version that
     * starts on its date, so past runs keep the rates of their day. `removeRateFrom` drops a version.
     */
    update: manageProcedure
      .input(
        z.object({
          lowMarginBp: z.number().int().min(0).max(10_000).optional(),
          workDaysPerWeek: z.number().int().min(1).max(7).optional(),
          hoursPerDay: z.number().int().min(1).max(24).optional(),
          downtimeHoursPerWeek: z.number().int().min(0).max(168).optional(),
          lineDowntimeHours: z.record(z.string().min(1).max(64), z.number().int().min(0).max(168)).optional(),
          defaultKgPerHour: z.number().int().min(1).max(100_000).nullable().optional(),
          leadDays: z.number().int().min(0).max(365).optional(),
          nitrideEveryKg: z.number().int().min(1).max(10_000_000).nullable().optional(),
          correctEveryKg: z.number().int().min(1).max(10_000_000).nullable().optional(),
          dieSoonBp: z.number().int().min(0).max(10_000).optional(),
          dieSoonDays: z.number().int().min(0).max(365).optional(),
          rateVersion: z
            .object({
              from: ymd,
              stages: z.object(Object.fromEntries(COST_STAGES.map((s) => [s, stageRate.optional()])) as Record<(typeof COST_STAGES)[number], z.ZodOptional<typeof stageRate>>),
            })
            .optional(),
          removeRateFrom: ymd.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const co = await gate(ctx);
        const { rateVersion, removeRateFrom, lineDowntimeHours, ...plain } = input;
        if (lineDowntimeHours) {
          const ids = new Set(
            (await ctx.db.select({ id: pressLine.id }).from(pressLine).where(eq(pressLine.companyId, ctx.companyId))).map((l) => l.id),
          );
          if (Object.keys(lineDowntimeHours).some((k) => !ids.has(k))) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
        }
        let rates = co.costing.rates;
        if (removeRateFrom) rates = rates.filter((v) => v.from !== removeRateFrom);
        if (rateVersion) {
          const stages: Record<string, { basis: "kg" | "hour"; paise: number; kgPerHour: number | null }> = {};
          for (const s of COST_STAGES) {
            const r = rateVersion.stages[s];
            if (!r) continue;
            if (r.basis === "hour" && s !== "extrusion" && r.kgPerHour == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "An hourly rate needs the kg made in an hour" });
            }
            stages[s] = { basis: r.basis, paise: r.paise, kgPerHour: r.kgPerHour ?? null };
          }
          rates = putRateVersion(rates, { from: rateVersion.from, stages });
        }
        const next = {
          ...co.costing,
          ...Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)),
          ...(lineDowntimeHours ? { lineDowntimeHours } : {}),
          rates,
        };
        await atomicBatch(ctx.db, [
          ctx.db.update(company).set({ settings: settingsPatchSql({ costing: next }) as never }).where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "cost.settings.update", subjectType: "company", subjectId: ctx.companyId, meta: { from: co.costing, to: next } }),
        ]);
        return next;
      }),
  }),

  /** Row 16: cost per kg of each logged production run in the window (newest first), with its inputs. */
  runs: viewProcedure
    .input(
      z
        .object({ from: ymd.optional(), to: ymd.optional(), sectionId: id.optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).max(5000).default(0) })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const co = await gate(ctx);
      const { from, to } = range(co.today, input);
      const { runs, factors } = await costRuns(ctx.db, ctx.companyId, co, { from, to, sectionId: input.sectionId, limit: input.offset + input.limit }, clockNow());
      const page = runs.slice(input.offset, input.offset + input.limit);
      return {
        from,
        to,
        factors,
        items: page.map(runView),
        nextOffset: runs.length > input.offset + input.limit ? input.offset + input.limit : null,
      };
    }),

  /** Row 16: cost per kg per section over the window, good-weighted over its runs, and the plant total. */
  sections: viewProcedure.input(rangeInput.optional()).query(async ({ ctx, input }) => {
    const co = await gate(ctx);
    const { from, to } = range(co.today, input);
    const { runs, truncated, factors } = await costRuns(ctx.db, ctx.companyId, co, { from, to }, clockNow());
    const rows = [...groupRuns(runs, (r) => r.sectionId).entries()]
      .map(([sectionId, list]) => ({ sectionId, sectionCode: list[0]!.sectionCode, ...rollup(list) }))
      .sort((a, b) => b.goodG - a.goodG || (a.sectionCode < b.sectionCode ? -1 : 1));
    const missing = new Set<string>();
    for (const r of runs) for (const m of r.cost.missing) missing.add(m);
    return { from, to, rows, total: rollup(runs), truncated, factors, missing: [...missing], ratesFrom: ratesOn(co.costing.rates, to)?.from ?? null };
  }),

  /**
   * Rows 16 and 17 on the order screen: each line's cost per kg (its own runs, else its section's
   * last 90 days, else the plant's) and, for `order.price` holders on a plant that shows rates,
   * the line rate, margin per kg and %, and the low-margin flag. Others get no rate field at all.
   */
  orderLines: viewProcedure.input(z.object({ orderId: id })).query(async ({ ctx, input }) => {
    const co = await gate(ctx);
    const lines = await ctx.db.all<{ id: string; line_no: number; die_id: string; section_code: string; kg_g: number; rate_paise: number | null; has_breakup: number }>(sql`
      select l.id, l.line_no, l.die_id, d.section_code, l.kg_g, l.rate_paise, case when l.price_breakup is null then 0 else 1 end as has_breakup
      from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = l.company_id
      join die d on d.id = l.die_id and d.company_id = l.company_id
      where l.company_id = ${ctx.companyId} and o.id = ${input.orderId} order by l.line_no`);
    if (lines.length === 0) {
      const [found] = await ctx.db.all<{ id: string }>(sql`select id from sales_order where company_id = ${ctx.companyId} and id = ${input.orderId}`);
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
    }
    const at = clockNow();
    const from = addDaysYmd(co.today, -89);
    const [own, recent, runLines] = await Promise.all([
      costRuns(ctx.db, ctx.companyId, co, { orderId: input.orderId }, at),
      costRuns(ctx.db, ctx.companyId, co, { from, to: co.today }, at),
      ctx.db.all<{ line_id: string; run_id: string; good_g: number }>(sql`
        select prl.sales_order_line_id as line_id, prl.press_run_id as run_id, sum(prl.good_g) as good_g
        from press_run_line prl join sales_order_line l on l.id = prl.sales_order_line_id and l.company_id = prl.company_id
        where prl.company_id = ${ctx.companyId} and l.sales_order_id = ${input.orderId}
        group by prl.sales_order_line_id, prl.press_run_id`),
    ]);
    const runById = new Map(own.runs.map((r) => [r.id, r]));
    const bySection = new Map([...groupRuns(recent.runs, (r) => r.sectionId)].map(([k, v]) => [k, rollup(v).totalPaisePerKg]));
    const plant = rollup(recent.runs).totalPaisePerKg;
    const allowed = ratesAllowed(ctx.role, co);
    return {
      ratesAllowed: allowed,
      lowMarginBp: co.costing.lowMarginBp,
      lines: lines.map((l) => {
        const parts = runLines.filter((x) => x.line_id === l.id && runById.has(x.run_id)).map((x) => ({ goodG: Number(x.good_g), run: runById.get(x.run_id)! }));
        const known = parts.filter((p) => p.run.cost.totalPaisePerKg != null);
        const pressedG = parts.reduce((s, p) => s + p.goodG, 0);
        const actual = known.length > 0 ? Math.round(known.reduce((s, p) => s + p.goodG * p.run.cost.totalPaisePerKg!, 0) / known.reduce((s, p) => s + p.goodG, 0)) : null;
        const picked = pickCost({ actual, section: bySection.get(l.die_id) ?? null, plant });
        const base = {
          lineId: l.id,
          lineNo: Number(l.line_no),
          sectionId: l.die_id,
          sectionCode: l.section_code,
          orderedG: Number(l.kg_g),
          pressedG,
          runs: parts.map((p) => p.run.number),
          costPaisePerKg: picked.paisePerKg,
          costBasis: picked.basis as CostBasis,
        };
        if (!allowed) return base;
        const rate = l.rate_paise == null ? null : Number(l.rate_paise);
        return { ...base, ratePaise: rate, frozen: Number(l.has_breakup) === 1, margin: marginOf(rate, picked.paisePerKg, co.costing.lowMarginBp) };
      }),
    };
  }),

  /**
   * Row 17: profitability of booked orders by section, customer or month (order date in the window).
   * Revenue = ordered kg × line rate; cost = the section's cost per kg in the order's month (else the
   * section's over the window, else the plant's). `order.price` and `priceOnSalesOrder` required.
   */
  profitability: viewProcedure
    .input(z.object({ from: ymd.optional(), to: ymd.optional(), groupBy: z.enum(["section", "customer", "month"]).default("month") }).default({ groupBy: "month" }))
    .query(async ({ ctx, input }) => {
      const co = await gate(ctx);
      if (!ratesAllowed(ctx.role, co)) throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_RATES });
      const to = input.to ?? co.today;
      const from = input.from ?? `${addMonths(monthOf(to), -5)}-01`;
      if (from > to) throw new TRPCError({ code: "BAD_REQUEST", message: "The start date must be before the end date" });
      const LIMIT = 20_000;
      const [lineRows, costed] = await Promise.all([
        ctx.db.all<{ die_id: string; section_code: string; customer_id: string; customer_name: string; m: string; rate_paise: number | null; kg_g: number; lines: number }>(sql`
          select l.die_id, d.section_code, o.customer_id, c.name as customer_name, substr(o.order_date, 1, 7) as m, l.rate_paise, sum(l.kg_g) as kg_g, count(*) as lines
          from sales_order_line l
          join sales_order o on o.id = l.sales_order_id and o.company_id = l.company_id
          join die d on d.id = l.die_id and d.company_id = l.company_id
          join customer c on c.id = o.customer_id and c.company_id = l.company_id
          where l.company_id = ${ctx.companyId} and o.status <> 'cancelled' and o.order_date >= ${from} and o.order_date <= ${to}
          group by l.die_id, d.section_code, o.customer_id, c.name, substr(o.order_date, 1, 7), l.rate_paise
          limit ${LIMIT + 1}`),
        costRuns(ctx.db, ctx.companyId, co, { from: addDaysYmd(from, -90), to }, clockNow()),
      ]);
      const runs = costed.runs;
      const secMonth = new Map([...groupRuns(runs, (r) => `${r.sectionId}|${runMonth(r)}`)].map(([k, v]) => [k, rollup(v).totalPaisePerKg]));
      const sec = new Map([...groupRuns(runs, (r) => r.sectionId)].map(([k, v]) => [k, rollup(v).totalPaisePerKg]));
      const plantMonth = new Map([...groupRuns(runs, runMonth)].map(([k, v]) => [k, rollup(v).totalPaisePerKg]));
      const plant = rollup(runs).totalPaisePerKg;
      type Acc = { key: string; label: string; kgG: number; revenuePaise: number; costPaise: number; costedKgG: number; lowKgG: number; noRateKgG: number; noCostKgG: number; lines: number };
      const groups = new Map<string, Acc>();
      const total: Acc = { key: "total", label: "", kgG: 0, revenuePaise: 0, costPaise: 0, costedKgG: 0, lowKgG: 0, noRateKgG: 0, noCostKgG: 0, lines: 0 };
      const bases: Record<string, number> = {};
      for (const r of lineRows.slice(0, LIMIT)) {
        const key = input.groupBy === "section" ? r.die_id : input.groupBy === "customer" ? r.customer_id : r.m;
        const label = input.groupBy === "section" ? r.section_code : input.groupBy === "customer" ? r.customer_name : r.m;
        const acc = groups.get(key) ?? { key, label, kgG: 0, revenuePaise: 0, costPaise: 0, costedKgG: 0, lowKgG: 0, noRateKgG: 0, noCostKgG: 0, lines: 0 };
        const kgG = Number(r.kg_g);
        const rate = r.rate_paise == null ? null : Number(r.rate_paise);
        const cost = pickCost({ sectionMonth: secMonth.get(`${r.die_id}|${r.m}`) ?? null, section: sec.get(r.die_id) ?? null, plantMonth: plantMonth.get(r.m) ?? null, plant });
        bases[cost.basis] = (bases[cost.basis] ?? 0) + kgG;
        for (const a of [acc, total]) {
          a.kgG += kgG;
          a.lines += Number(r.lines);
          if (rate == null) a.noRateKgG += kgG;
          else if (cost.paisePerKg == null) a.noCostKgG += kgG;
          else {
            a.revenuePaise += amountPaise(kgG, rate);
            a.costPaise += amountPaise(kgG, cost.paisePerKg);
            a.costedKgG += kgG;
            if (marginOf(rate, cost.paisePerKg, co.costing.lowMarginBp)?.low) a.lowKgG += kgG;
          }
        }
        groups.set(key, acc);
      }
      const view = (a: Acc) => {
        const marginPaise = a.revenuePaise - a.costPaise;
        return { ...a, marginPaise, marginBp: a.revenuePaise > 0 ? Math.round((marginPaise * 10_000) / a.revenuePaise) : null };
      };
      const rows = [...groups.values()].map(view).sort((a, b) => (input.groupBy === "month" ? (a.key < b.key ? -1 : 1) : b.kgG - a.kgG || (a.label < b.label ? -1 : 1)));
      return { from, to, groupBy: input.groupBy, lowMarginBp: co.costing.lowMarginBp, rows, total: view(total), costBasisKgG: bases, truncated: lineRows.length > LIMIT || costed.truncated };
    }),

  /**
   * Row 51: press load week by week. Booked = open order lines' kg still to press (ordered − packed),
   * due on the order's expected date (else order date + lead days; late work lands in this week),
   * turned into press hours at the section's own kg per hour (else the plant's, else the setting).
   * Available = press days × hours − planned stops. Optional: a forecast top-up (expected orders not
   * yet booked) and a what-if change per customer.
   * TODO(xe-maint): subtract planned maintenance stops per press once the maintenance lane merges.
   */
  capacity: viewProcedure.input(capacityInput).query(async ({ ctx, input }) => {
    const co = await gate(ctx);
    const at = clockNow();
    const firstWeek = weekStart(co.today);
    const [lines, speeds, work] = await Promise.all([
      ctx.db
        .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name })
        .from(pressLine)
        .where(sql`${pressLine.companyId} = ${ctx.companyId} and ${pressLine.status} = 'active'`)
        .orderBy(asc(pressLine.sortOrder), asc(pressLine.code)),
      sectionSpeeds(ctx.db, ctx.companyId, at),
      openWork(ctx.db, ctx.companyId),
    ]);
    const pct = new Map(input.scenario.map((s) => [s.customerId, s.pct]));
    const speedOf = (sectionId: string) => {
      const s = speeds.section.get(sectionId);
      if (s) return { kgPerHour: s.kgPerHour, basis: "section" as const };
      if (speeds.plant != null) return { kgPerHour: speeds.plant, basis: "plant" as const };
      if (co.costing.defaultKgPerHour != null) return { kgPerHour: co.costing.defaultKgPerHour, basis: "setting" as const };
      return { kgPerHour: null, basis: "none" as const };
    };
    const lineOf = (sectionId: string) => speeds.line.get(sectionId) ?? (lines.length === 1 ? lines[0]!.id : null);
    const items: LoadItem[] = [];
    const unassigned: { ref: string; g: number; minutes: number | null }[] = [];
    const noSpeed: { ref: string; g: number }[] = [];
    const bookedSectionWeek = new Map<string, number>();
    let laterG = 0;
    for (const l of work.lines) {
      const left = Math.max(0, l.orderedG - l.producedG);
      if (left <= 0) continue;
      const g = pct.has(l.customerId) ? scaleByPct(left, pct.get(l.customerId)!) : left;
      const due = l.expectedDate ?? addDaysYmd(l.orderDate, co.costing.leadDays);
      const week = weekIndex(firstWeek, due);
      if (week >= input.weeks) {
        laterG += g;
        continue;
      }
      const ref = `${l.orderNumber}/${l.lineNo} ${l.customerName} ${l.sectionCode}`;
      bookedSectionWeek.set(`${l.sectionId}|${week}`, (bookedSectionWeek.get(`${l.sectionId}|${week}`) ?? 0) + g);
      const sp = speedOf(l.sectionId);
      const minutes = minutesFor(g, sp.kgPerHour);
      const lineId = lineOf(l.sectionId);
      if (minutes == null) noSpeed.push({ ref, g });
      else if (!lineId) unassigned.push({ ref, g, minutes });
      else items.push({ lineId, week, minutes, g, ref });
    }

    let forecastNote: { pairs: number; truncated: boolean } | null = null;
    if (input.withForecast) {
      const curMonth = monthOf(co.today);
      const hist = await orderHistory(ctx.db, ctx.companyId, addMonths(curMonth, -24));
      const recentFrom = addMonths(curMonth, -6);
      const pairs = new Map<string, { customerId: string; sectionId: string; series: { month: string; g: number }[]; recent: boolean }>();
      for (const r of hist.rows) {
        const k = `${r.customer_id}|${r.die_id}`;
        const p = pairs.get(k) ?? { customerId: r.customer_id, sectionId: r.die_id, series: [], recent: false };
        p.series.push({ month: r.m, g: r.kg_g });
        if (r.m >= recentFrom) p.recent = true;
        pairs.set(k, p);
      }
      const fcSectionWeek = new Map<string, number>();
      let n = 0;
      for (const p of pairs.values()) {
        if (!p.recent) continue;
        const f = forecastMonths(p.series, curMonth, Math.ceil(input.weeks / 4) + 2, 0);
        if (f.method === "too_little") continue;
        n++;
        const byMonth = new Map(f.forecast.map((x) => [x.month, x.g]));
        for (let w = 0; w < input.weeks; w++) {
          const start = addDaysYmd(firstWeek, w * 7);
          const mg = byMonth.get(monthOf(start)) ?? 0;
          const wg = Math.round((mg * 7) / 30.4);
          const g = pct.has(p.customerId) ? scaleByPct(wg, pct.get(p.customerId)!) : wg;
          const k = `${p.sectionId}|${w}`;
          fcSectionWeek.set(k, (fcSectionWeek.get(k) ?? 0) + g);
        }
      }
      const codes = new Map(work.lines.map((l) => [l.sectionId, l.sectionCode]));
      const missingCodes = [...new Set([...fcSectionWeek.keys()].map((k) => k.split("|")[0]!))].filter((s) => !codes.has(s));
      if (missingCodes.length > 0) {
        const found = await ctx.db.all<{ id: string; section_code: string }>(sql`select id, section_code from die where company_id = ${ctx.companyId} and deleted_at is null`);
        for (const d of found) if (!codes.has(d.id)) codes.set(d.id, d.section_code);
      }
      for (const [k, fg] of fcSectionWeek) {
        const [sectionId, w] = k.split("|") as [string, string];
        const week = Number(w);
        if (week === 0) continue; // this week's work is what is booked
        const top = Math.max(0, fg - (bookedSectionWeek.get(k) ?? 0));
        if (top <= 0) continue;
        const ref = `forecast ${codes.get(sectionId) ?? sectionId}`;
        const minutes = minutesFor(top, speedOf(sectionId).kgPerHour);
        const lineId = lineOf(sectionId);
        if (minutes == null) noSpeed.push({ ref, g: top });
        else if (!lineId) unassigned.push({ ref, g: top, minutes });
        else items.push({ lineId, week, minutes, g: top, ref });
      }
      forecastNote = { pairs: n, truncated: hist.truncated };
    }

    const loads = weekLoads({ firstWeek, weeks: input.weeks, lines: lines.map((l) => ({ id: l.id, availableMin: weekMinutes(co.costing, l.id) })), items });
    return {
      firstWeek,
      weeks: input.weeks,
      settings: { workDaysPerWeek: co.costing.workDaysPerWeek, hoursPerDay: co.costing.hoursPerDay, downtimeHoursPerWeek: co.costing.downtimeHoursPerWeek, leadDays: co.costing.leadDays },
      plantKgPerHour: speeds.plant,
      lines: lines.map((l) => ({ ...l, weeks: loads.get(l.id) ?? [] })),
      overWeeks: [...loads.values()].reduce((s, ws) => s + ws.filter((w) => w.over).length, 0),
      unassigned: unassigned.slice(0, 50),
      noSpeed: noSpeed.slice(0, 50),
      laterG,
      forecast: forecastNote,
      scenario: input.scenario,
      truncated: work.truncated,
    };
  }),

  /**
   * Row 52: monthly demand forecast per section, per customer, or for the plant, from booked order kg
   * (cancelled orders left out). Method: average of the last three full months; with two years of
   * orders, a seasonal index per calendar month. The backtest shows what it would have said.
   */
  forecast: viewProcedure
    .input(z.object({ groupBy: z.enum(["plant", "section", "customer"]).default("plant"), horizon: z.number().int().min(1).max(6).default(3), limit: z.number().int().min(1).max(100).default(30) }).default({ groupBy: "plant", horizon: 3, limit: 30 }))
    .query(async ({ ctx, input }) => {
      const co = await gate(ctx);
      const curMonth = monthOf(co.today);
      const hist = await orderHistory(ctx.db, ctx.companyId, addMonths(curMonth, -36));
      const series = new Map<string, Map<string, number>>();
      for (const r of hist.rows) {
        const key = input.groupBy === "plant" ? "plant" : input.groupBy === "section" ? r.die_id : r.customer_id;
        const m = series.get(key) ?? new Map<string, number>();
        m.set(r.m, (m.get(r.m) ?? 0) + r.kg_g);
        series.set(key, m);
      }
      const yearFrom = addMonths(curMonth, -12);
      const ranked = [...series.entries()]
        .map(([key, m]) => ({ key, m, last12: [...m.entries()].filter(([mm]) => mm >= yearFrom && mm < curMonth).reduce((s, [, g]) => s + g, 0) }))
        .sort((a, b) => b.last12 - a.last12 || (a.key < b.key ? -1 : 1))
        .slice(0, input.limit);
      const labels = new Map<string, string>();
      if (input.groupBy !== "plant" && ranked.length > 0) {
        const rows =
          input.groupBy === "section"
            ? await ctx.db.all<{ id: string; label: string }>(sql`select id, section_code as label from die where company_id = ${ctx.companyId}`)
            : await ctx.db.all<{ id: string; label: string }>(sql`select id, name as label from customer where company_id = ${ctx.companyId}`);
        for (const r of rows) labels.set(r.id, r.label);
      }
      return {
        groupBy: input.groupBy,
        currentMonth: curMonth,
        truncated: hist.truncated,
        rows: ranked.map(({ key, m, last12 }) => ({
          key,
          label: input.groupBy === "plant" ? "" : (labels.get(key) ?? key),
          last12G: last12,
          history: [...m.entries()].filter(([mm]) => mm >= yearFrom).sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, g]) => ({ month, g })),
          ...forecastMonths([...m.entries()].map(([month, g]) => ({ month, g })), curMonth, input.horizon),
        })),
      };
    }),

  /**
   * Row 61: when each live die copy is next due for nitriding and for correction, from its own history
   * (median kg between past treatments), else its section's, else the plant's, else the setting; plus
   * a straight line through its kg/12ft readings since its last correction against the section band.
   */
  dies: viewProcedure
    .input(z.object({ state: z.enum(["attention", "all"]).default("attention"), limit: z.number().int().min(1).max(500).default(100) }).default({ state: "attention", limit: 100 }))
    .query(async ({ ctx, input }) => {
      const co = await gate(ctx);
      const nowMs = clockNow().getTime();
      const recentFrom = nowMs - 60 * DAY_MS;
      const cid = ctx.companyId;
      const RUN_AT = sql`coalesce(r.stopped_at, r.logged_at)`;
      const cumAt = (copyCol: string, atCol: string) =>
        sql`(select coalesce(sum(r.good_g), 0) from press_run r where r.company_id = ${cid} and r.die_instance_id = ${sql.raw(copyCol)} and r.status = 'logged' and ${RUN_AT} <= ${sql.raw(atCol)})`;
      const [copies, totals, nitrides, corrections, readings] = await Promise.all([
        ctx.db.all<{ id: string; code: string; section_id: string; section_code: string; status: string; weight_min_g: number; weight_max_g: number; tier_rank: number | null }>(sql`
          select di.id, di.code, di.section_id, d.section_code, di.status, d.weight_min_g, d.weight_max_g, di.tier_rank
          from die_instance di join die d on d.id = di.section_id and d.company_id = di.company_id
          where di.company_id = ${cid} and di.status <> 'retired' and d.deleted_at is null
          order by d.section_code, di.seq_no limit 3000`),
        ctx.db.all<{ copy_id: string; total_g: number; recent_g: number }>(sql`
          select r.die_instance_id as copy_id, sum(r.good_g) as total_g, sum(case when ${RUN_AT} >= ${recentFrom} then r.good_g else 0 end) as recent_g
          from press_run r where r.company_id = ${cid} and r.status = 'logged' and r.die_instance_id is not null group by r.die_instance_id`),
        ctx.db.all<{ copy_id: string; section_id: string; at: number; cum_g: number }>(sql`
          select n.die_instance_id as copy_id, di.section_id, n.nitrided_at as at, ${cumAt("n.die_instance_id", "n.nitrided_at")} as cum_g
          from nitriding_log n join die_instance di on di.id = n.die_instance_id and di.company_id = n.company_id
          where n.company_id = ${cid} order by n.die_instance_id, n.nitrided_at`),
        ctx.db.all<{ copy_id: string; section_id: string; at: number; cum_g: number }>(sql`
          select e.copy_id, di.section_id, e.at, ${cumAt("e.copy_id", "e.at")} as cum_g from (
            select w.die_instance_id as copy_id, w.worked_at as at from die_work w where w.company_id = ${cid} and w.kind_code = 'correct'
            union all
            select j.die_instance_id as copy_id, j.received_at as at from die_maker_job j where j.company_id = ${cid} and j.status = 'received' and j.purpose in ('correction', 'repair') and j.received_at is not null
          ) e join die_instance di on di.id = e.copy_id and di.company_id = ${cid}
          order by e.copy_id, e.at`),
        ctx.db.all<{ copy_id: string; at: number; milli: number; cum_g: number }>(sql`
          select x.copy_id, x.at, x.milli, ${cumAt("x.copy_id", "x.at")} as cum_g from (
            select w.die_instance_id as copy_id, w.read_at as at, w.kg_per_12ft_milli as milli,
              row_number() over (partition by w.die_instance_id order by w.read_at desc) as rn
            from die_weight_reading w join die_instance di on di.id = w.die_instance_id and di.company_id = w.company_id
            where w.company_id = ${cid} and di.status <> 'retired'
          ) x where x.rn <= 20 order by x.copy_id, x.at`),
      ]);
      const tot = new Map(totals.map((t) => [t.copy_id, { totalG: Number(t.total_g), recentG: Number(t.recent_g) }]));
      const eventsBy = (rows: { copy_id: string; section_id: string; at: number; cum_g: number }[]) => {
        const copy = new Map<string, { at: number; cumG: number }[]>();
        for (const r of rows) {
          const list = copy.get(r.copy_id) ?? [];
          list.push({ at: Number(r.at), cumG: Number(r.cum_g) });
          copy.set(r.copy_id, list);
        }
        const section = new Map<string, number[]>();
        const plant: number[] = [];
        const sectionOf = new Map(rows.map((r) => [r.copy_id, r.section_id]));
        for (const [copyId, list] of copy) {
          const iv = intervalsG(list.map((e) => e.cumG));
          const s = sectionOf.get(copyId)!;
          section.set(s, [...(section.get(s) ?? []), ...iv]);
          plant.push(...iv);
        }
        return { copy, section, plant };
      };
      const nit = eventsBy(nitrides);
      const cor = eventsBy(corrections);
      const readBy = new Map<string, { at: number; milli: number; cumG: number }[]>();
      for (const r of readings) {
        const list = readBy.get(r.copy_id) ?? [];
        list.push({ at: Number(r.at), milli: Number(r.milli), cumG: Number(r.cum_g) });
        readBy.set(r.copy_id, list);
      }
      const s = co.costing;
      const rows = copies.map((c) => {
        const t = tot.get(c.id) ?? { totalG: 0, recentG: 0 };
        const gPerDay = t.recentG > 0 ? Math.round(t.recentG / 60) : null;
        const est = (ev: ReturnType<typeof eventsBy>, settingKg: number | null) => {
          const own = ev.copy.get(c.id) ?? [];
          const last = own[own.length - 1];
          return {
            lastAt: last?.at ?? null,
            treatments: own.length,
            ...dueEstimate({
              sinceG: Math.max(0, t.totalG - (last?.cumG ?? 0)),
              copyIntervals: intervalsG(own.map((e) => e.cumG)),
              sectionIntervals: ev.section.get(c.section_id) ?? [],
              plantIntervals: ev.plant,
              settingG: settingKg == null ? null : settingKg * 1000,
              gPerDay,
              soonBp: s.dieSoonBp,
              soonDays: s.dieSoonDays,
            }),
          };
        };
        const nitride = est(nit, s.nitrideEveryKg);
        const correct = est(cor, s.correctEveryKg);
        const lastCorrection = correct.lastAt ?? 0;
        const pts = (readBy.get(c.id) ?? []).filter((r) => r.at > lastCorrection).map((r) => ({ cumG: r.cumG, milli: r.milli }));
        const drift = driftProjection(pts, { minMilli: Number(c.weight_min_g), maxMilli: Number(c.weight_max_g) }, t.totalG);
        const rank = (x: { state: string }) => (x.state === "due" ? 0 : x.state === "soon" ? 1 : x.state === "ok" ? 2 : 3);
        return {
          copyId: c.id,
          code: c.code,
          sectionId: c.section_id,
          sectionCode: c.section_code,
          status: c.status,
          tierRank: c.tier_rank,
          pressedG: t.totalG,
          gPerDay,
          nitride,
          correct,
          drift,
          urgency: Math.min(rank(nitride), rank(correct)),
        };
      });
      const attention = rows.filter((r) => r.urgency <= 1 || (r.drift.state !== "too_few" && r.drift.leftG != null && gPerDayDays(r.drift.leftG, r.gPerDay) <= s.dieSoonDays));
      const pick = input.state === "attention" ? attention : rows;
      pick.sort((a, b) => a.urgency - b.urgency || (a.code < b.code ? -1 : 1));
      return {
        due: rows.filter((r) => r.urgency === 0).length,
        soon: rows.filter((r) => r.urgency === 1).length,
        copies: rows.length,
        settings: { dieSoonBp: s.dieSoonBp, dieSoonDays: s.dieSoonDays, nitrideEveryKg: s.nitrideEveryKg, correctEveryKg: s.correctEveryKg },
        items: pick.slice(0, input.limit),
        more: pick.length > input.limit,
      };
    }),
});

function gPerDayDays(leftG: number, gPerDay: number | null): number {
  if (leftG <= 0) return 0;
  return gPerDay != null && gPerDay > 0 ? Math.floor(leftG / gPerDay) : Number.POSITIVE_INFINITY;
}
