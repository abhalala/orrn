/**
 * Cross-module reports (W4-ANALYTICS): recovery by die / copy / press / shift (FP-PR-17/18
 * extension), die life against what each copy has pressed (spec §E1 "Life"), and stock age of the
 * yard (FP-PK-16). Read-only; every figure is computed here and the client only writes it down.
 *
 * - Recovery is always Σ good ÷ Σ input of the runs in a group (never an average of percents), in
 *   basis points by `recoveryBp` (half away from zero) and shown with `bpPercent1`. Production runs
 *   only: logged runs whose plan purpose is production (or that have no plan), the same rule as the
 *   press report's KPI (m-10). Trial, sample and other runs never pull a die's recovery down.
 * - Die life: `die_instance.life_g` against Σ `good_g` of the copy's logged runs (the die card's
 *   `producedG`). "Life reached" at 100 % used warns and never blocks (issue already warns).
 * - Stock age: AVAILABLE bundles only (held on a truck is not "lying in the yard"), age in company
 *   calendar days from the pack date (`bundle.created_at`) to today: 0-7, 8-30, 31-90, over 90. A
 *   bundle on a sales order line belongs to that order's party; one on no line is plant stock.
 * - Every table in every statement is scoped to the company; id lists are chunked (≤ 80 per IN).
 */
import { bpPercent1, readFloorSettings, recoveryBp } from "@orrn/domain";
import { sql } from "drizzle-orm";

import { mapInChunks, type OrrnDb } from "./atomic";
import { companyTimezone } from "./dayWindow";
import { companySettings } from "./press";
import { addDays, localDate, localMidnight } from "./zonedBuckets";

const num = (v: unknown) => (v == null ? 0 : Number(v));
const ID_CHUNK = 80;

// ── recovery ────────────────────────────────────────────────────────────────

export const RECOVERY_GROUPS = ["die", "copy", "press", "shift"] as const;
export type RecoveryGroup = (typeof RECOVERY_GROUPS)[number];

export type RecoveryFilter = {
  from: string;
  to: string;
  groupBy: RecoveryGroup;
  shiftSeq?: number;
  pressLineId?: string;
  planId?: string;
};

export type RecoveryRow = {
  /** Section id, copy id, press line id, or the shift seq as text; "" for runs with none. */
  key: string;
  label: string;
  /** Section name under a die, the line's name under a press; null otherwise. */
  detail: string | null;
  runs: number;
  inputG: number;
  goodG: number;
  /** Butt (discard) + ends + rejects. */
  scrapG: number;
  recoveryBp: number | null;
  /** `bpPercent1(recoveryBp)` ("75.5"); null without input. */
  recoveryPct: string | null;
};

export type RecoverySummary = {
  groupBy: RecoveryGroup;
  rows: RecoveryRow[];
  totals: Omit<RecoveryRow, "key" | "label" | "detail">;
};

function figures(inputG: number, goodG: number) {
  const bp = recoveryBp(goodG, inputG);
  return { recoveryBp: bp, recoveryPct: bp == null ? null : bpPercent1(bp) };
}

/** Logged production runs of the production days from..to, summed per group. */
export async function recoverySummary(db: OrrnDb, companyId: string, filter: RecoveryFilter): Promise<RecoverySummary> {
  const where = [
    sql`r.company_id = ${companyId}`,
    sql`r.status = 'logged'`,
    sql`r.production_day >= ${filter.from}`,
    sql`r.production_day <= ${filter.to}`,
    sql`coalesce(pp.purpose, 'production') = 'production'`,
  ];
  if (filter.shiftSeq != null) where.push(sql`r.shift_seq = ${filter.shiftSeq}`);
  if (filter.pressLineId) where.push(sql`r.press_line_id = ${filter.pressLineId}`);
  if (filter.planId) where.push(sql`r.plan_id = ${filter.planId}`);

  const select = {
    die: sql`r.section_id as k, d.section_code as label, d.name as detail, d.section_code as sort1, 0 as sort2`,
    copy: sql`coalesce(r.die_instance_id, '') as k, coalesce(di.code, '') as label, d.section_code as detail, d.section_code as sort1, coalesce(di.seq_no, 0) as sort2`,
    press: sql`coalesce(r.press_line_id, '') as k, coalesce(pl.code, '') as label, pl.name as detail, coalesce(pl.sort_order, 999999) as sort1, coalesce(pl.code, '') as sort2`,
    shift: sql`coalesce(cast(r.shift_seq as text), '') as k, max(r.shift_id) as label, null as detail, coalesce(r.shift_seq, 99) as sort1, 0 as sort2`,
  }[filter.groupBy];
  const groupBy = {
    die: sql`r.section_id`,
    copy: sql`r.die_instance_id`,
    press: sql`r.press_line_id`,
    shift: sql`r.shift_seq`,
  }[filter.groupBy];

  const rows = await db.all<{ k: string; label: string | null; detail: string | null; runs: number; input_g: number; good_g: number; scrap_g: number }>(sql`
    select ${select}, count(*) as runs, coalesce(sum(r.input_g), 0) as input_g, coalesce(sum(r.good_g), 0) as good_g,
      coalesce(sum(coalesce(r.discard_g, 0) + coalesce(r.ends_g, 0) + coalesce(r.reject_g, 0)), 0) as scrap_g
    from press_run r
    join die d on d.id = r.section_id and d.company_id = r.company_id
    left join press_plan pp on pp.id = r.plan_id and pp.company_id = r.company_id
    left join press_line pl on pl.id = r.press_line_id and pl.company_id = r.company_id
    left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
    where ${sql.join(where, sql` and `)}
    group by ${groupBy}
    order by sort1, sort2, k
  `);

  // Shift names come from the plant's shifts (the run keeps its shift id; seq is the fallback).
  const shifts = filter.groupBy === "shift" ? readFloorSettings(await companySettings(db, companyId)).shifts : [];
  const out: RecoveryRow[] = rows.map((r) => {
    const inputG = num(r.input_g);
    const goodG = num(r.good_g);
    let label = r.label ?? "";
    if (filter.groupBy === "shift") {
      const seq = r.k === "" ? null : Number(r.k);
      label = shifts.find((s) => s.id === r.label)?.name ?? shifts.find((s) => s.seq === seq)?.name ?? (seq == null ? "" : String(seq));
    }
    return { key: r.k ?? "", label, detail: r.detail ?? null, runs: num(r.runs), inputG, goodG, scrapG: num(r.scrap_g), ...figures(inputG, goodG) };
  });
  const inputG = out.reduce((s, r) => s + r.inputG, 0);
  const goodG = out.reduce((s, r) => s + r.goodG, 0);
  return {
    groupBy: filter.groupBy,
    rows: out,
    totals: { runs: out.reduce((s, r) => s + r.runs, 0), inputG, goodG, scrapG: out.reduce((s, r) => s + r.scrapG, 0), ...figures(inputG, goodG) },
  };
}

// ── die life ────────────────────────────────────────────────────────────────

/** From this share of life used a copy is "near" its life (amber); at 100 % it is reached. */
export const DIE_LIFE_NEAR_BP = 9000;

export type DieLifeState = "none" | "ok" | "near" | "reached";

/** Share of life used, half up in basis points; the state the card and the list colour by. */
export function dieLifeUse(lifeG: number | null, producedG: number): { usedBp: number | null; remainingG: number | null; state: DieLifeState; reached: boolean } {
  if (lifeG == null || !(lifeG > 0)) return { usedBp: null, remainingG: null, state: "none", reached: false };
  const usedBp = Math.floor((producedG * 10_000 * 2 + lifeG) / (lifeG * 2));
  const reached = producedG >= lifeG;
  return { usedBp, remainingG: lifeG - producedG, reached, state: reached ? "reached" : usedBp >= DIE_LIFE_NEAR_BP ? "near" : "ok" };
}

export type DieLifeFilter = {
  dieInstanceId?: string;
  sectionId?: string;
  includeRetired?: boolean;
  /** Only copies with a life set. */
  withLife?: boolean;
  limit: number;
  offset: number;
};

export type DieLifeRow = {
  dieInstanceId: string;
  code: string;
  status: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string | null;
  lifeG: number | null;
  producedG: number;
  runs: number;
  lastRunDay: string | null;
  usedBp: number | null;
  /** `bpPercent1(usedBp)`; null without a life. */
  usedPct: string | null;
  remainingG: number | null;
  state: DieLifeState;
  reached: boolean;
};

/**
 * Copies with what they have pressed against their planned life, sorted by share used (highest
 * first), then copies with no life by kg pressed. `counts` are over the whole filter.
 */
export async function dieLife(db: OrrnDb, companyId: string, f: DieLifeFilter) {
  const where = [sql`di.company_id = ${companyId}`];
  if (f.dieInstanceId) where.push(sql`di.id = ${f.dieInstanceId}`);
  if (f.sectionId) where.push(sql`di.section_id = ${f.sectionId}`);
  if (!f.includeRetired && !f.dieInstanceId) where.push(sql`di.status <> 'retired'`);
  if (f.withLife) where.push(sql`di.life_g is not null and di.life_g > 0`);
  const cte = sql`with c as (
      select di.id, di.code, di.status, di.section_id, di.life_g, d.section_code, d.name as section_name, di.seq_no,
        (select coalesce(sum(r.good_g), 0) from press_run r where r.company_id = di.company_id and r.die_instance_id = di.id and r.status = 'logged') as produced_g,
        (select count(*) from press_run r where r.company_id = di.company_id and r.die_instance_id = di.id and r.status = 'logged') as runs,
        (select max(r.production_day) from press_run r where r.company_id = di.company_id and r.die_instance_id = di.id and r.status = 'logged') as last_day
      from die_instance di
      join die d on d.id = di.section_id and d.company_id = di.company_id
      where ${sql.join(where, sql` and `)}
    )`;
  const rows = await db.all<{ id: string; code: string; status: string; section_id: string; life_g: number | null; section_code: string; section_name: string | null; produced_g: number; runs: number; last_day: string | null }>(sql`
    ${cte} select * from c
    order by case when life_g is null or life_g <= 0 then 1 else 0 end, (produced_g * 1.0 / nullif(life_g, 0)) desc, produced_g desc, section_code, seq_no, code
    limit ${f.limit} offset ${f.offset}
  `);
  const [c] = await db.all<{ total: number; with_life: number; reached: number; near: number }>(sql`
    ${cte} select count(*) as total,
      coalesce(sum(case when life_g > 0 then 1 else 0 end), 0) as with_life,
      coalesce(sum(case when life_g > 0 and produced_g >= life_g then 1 else 0 end), 0) as reached,
      coalesce(sum(case when life_g > 0 and produced_g < life_g and produced_g * 10000 >= life_g * ${DIE_LIFE_NEAR_BP} then 1 else 0 end), 0) as near
    from c
  `);
  const items: DieLifeRow[] = rows.map((r) => {
    const lifeG = r.life_g == null ? null : num(r.life_g);
    const producedG = num(r.produced_g);
    const use = dieLifeUse(lifeG, producedG);
    return {
      dieInstanceId: r.id,
      code: r.code,
      status: r.status,
      sectionId: r.section_id,
      sectionCode: r.section_code,
      sectionName: r.section_name,
      lifeG,
      producedG,
      runs: num(r.runs),
      lastRunDay: r.last_day,
      ...use,
      usedPct: use.usedBp == null ? null : bpPercent1(use.usedBp),
    };
  });
  const total = num(c?.total);
  const next = f.offset + items.length;
  return {
    items,
    total,
    nextOffset: next < total ? next : null,
    counts: { copies: total, withLife: num(c?.with_life), reached: num(c?.reached), near: num(c?.near) },
  };
}

// ── stock age ───────────────────────────────────────────────────────────────

export const STOCK_AGE_BUCKETS = [
  { key: "0-7", minDays: 0, maxDays: 7 },
  { key: "8-30", minDays: 8, maxDays: 30 },
  { key: "31-90", minDays: 31, maxDays: 90 },
  { key: "90+", minDays: 91, maxDays: null },
] as const;
export type StockAgeKey = (typeof STOCK_AGE_BUCKETS)[number]["key"];

export type StockAgeCell = { bundles: number; kgG: number };
export type StockAgeRow = {
  /** null = plant stock (on no sales order line). */
  customerId: string | null;
  customerName: string | null;
  buckets: StockAgeCell[];
  bundles: number;
  kgG: number;
};

export type StockAge = {
  asOf: string;
  /** Company calendar day the ages are counted to. */
  today: string;
  buckets: { key: StockAgeKey; minDays: number; maxDays: number | null; bundles: number; kgG: number }[];
  rows: StockAgeRow[];
  totals: StockAgeCell;
  /** Older than 90 days (Today's tile). */
  over90: StockAgeCell;
};

export type StockAgeFilter = { customerId?: string; plantOnly?: boolean };

/** Available bundles by age bucket, per party (plant stock as its own row). */
export async function stockAge(db: OrrnDb, companyId: string, nowMs: number, f: StockAgeFilter = {}): Promise<StockAge> {
  const timezone = companyTimezone(await companySettings(db, companyId));
  const today = localDate(timezone, nowMs);
  // Packed on or after local midnight of (today − N) ⇔ at most N calendar days old. Server-computed
  // integers inlined as literals (the CASE appears in SELECT and GROUP BY).
  const edge = (days: number) => sql.raw(String(localMidnight(timezone, addDays(today, -days))));
  const bucket = sql`case when b.created_at >= ${edge(7)} then 0 when b.created_at >= ${edge(30)} then 1 when b.created_at >= ${edge(90)} then 2 else 3 end`;
  const where = [sql`b.company_id = ${companyId}`, sql`b.status = 'available'`];
  if (f.plantOnly) where.push(sql`so.customer_id is null`);
  else if (f.customerId) where.push(sql`so.customer_id = ${f.customerId}`);
  const rows = await db.all<{ cust: string; bucket: number; bundles: number; kg_g: number }>(sql`
    select coalesce(so.customer_id, '') as cust, ${bucket} as bucket, count(*) as bundles, coalesce(sum(b.weight_g), 0) as kg_g
    from bundle b
    left join sales_order_line sol on sol.id = b.sales_order_line_id and sol.company_id = b.company_id
    left join sales_order so on so.id = sol.sales_order_id and so.company_id = b.company_id
    where ${sql.join(where, sql` and `)}
    group by cust, bucket
  `);
  const custIds = [...new Set(rows.map((r) => r.cust).filter(Boolean))];
  const names = new Map(
    (
      await mapInChunks(
        custIds,
        (part) => db.all<{ id: string; name: string }>(sql`select id, name from customer where company_id = ${companyId} and id in (${sql.join(part.map((id) => sql`${id}`), sql`, `)})`),
        ID_CHUNK,
      )
    ).map((c) => [c.id, c.name] as const),
  );
  const byCust = new Map<string, StockAgeRow>();
  const zero = (): StockAgeCell[] => STOCK_AGE_BUCKETS.map(() => ({ bundles: 0, kgG: 0 }));
  for (const r of rows) {
    const key = r.cust ?? "";
    const row = byCust.get(key) ?? { customerId: key || null, customerName: key ? (names.get(key) ?? null) : null, buckets: zero(), bundles: 0, kgG: 0 };
    const cell = row.buckets[num(r.bucket)]!;
    cell.bundles += num(r.bundles);
    cell.kgG += num(r.kg_g);
    row.bundles += num(r.bundles);
    row.kgG += num(r.kg_g);
    byCust.set(key, row);
  }
  const out = [...byCust.values()].sort(
    (a, b) => b.kgG - a.kgG || (a.customerName ?? "").localeCompare(b.customerName ?? "") || (a.customerId ?? "").localeCompare(b.customerId ?? ""),
  );
  const buckets = STOCK_AGE_BUCKETS.map((d, i) => ({
    ...d,
    bundles: out.reduce((s, r) => s + r.buckets[i]!.bundles, 0),
    kgG: out.reduce((s, r) => s + r.buckets[i]!.kgG, 0),
  }));
  const last = buckets[buckets.length - 1]!;
  return {
    asOf: new Date(nowMs).toISOString(),
    today,
    buckets,
    rows: out,
    totals: { bundles: buckets.reduce((s, b) => s + b.bundles, 0), kgG: buckets.reduce((s, b) => s + b.kgG, 0) },
    over90: { bundles: last.bundles, kgG: last.kgG },
  };
}
