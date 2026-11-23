/**
 * Plant maintenance (XE parity lane MAINT, rows 63 to 68), module `maintenance`, mounted as `maint`.
 *
 * - `assets` (#63, maint.manage to write): the register, optionally pointing at a press line, furnace or
 *   ageing oven (one asset per master); `addFromMasters` adds one asset for each master not yet in it.
 *   `get` carries the service history (its work orders), the plans with their due figures, the reading
 *   kinds and recent readings, and the spares used.
 * - `plans` (#64): preventive plans by calendar days, run hours or both (whichever comes first). Run
 *   hours need a linked asset (`lib/maintenance.ts planUsageMinutes`). `due` feeds the screens and Today;
 *   `makeWorkOrder` opens the plan's preventive work order (one live per plan). Done resets the plan
 *   (`maintenanceWork.ts move`).
 * - `workOrders`, `spares` (#65, #66): `routers/maintenanceWork.ts`.
 * - `readings` (#68): reading kinds per asset with limits, readings by hand, the out-of-limit list, and
 *   "make work order" from a flagged reading. A device source is reserved (`lib/maintDevice.ts`), not live.
 * - `reports` (#67): downtime minutes, MTBF and MTTR per asset per month, labour and spares; money only
 *   for maint.manage holders. `settings` holds the labour rate (maint.manage).
 * - `today`: counts for the Today tile.
 *
 * The module gate covers mutations at router level (`ROUTER_MODULE.maint`); every read calls
 * `assertModule` itself, so a plant without the module sees nothing. Another plant's id is "Not found".
 */
import {
  MAX_PM_INTERVAL_DAYS,
  MAX_PM_INTERVAL_HOURS,
  labourPaise,
  monthRange,
  priorityFromCriticality,
  readingFlag,
  reliability,
  validReadingLimit,
  type BreakdownEvent,
  type MaintLinkKind,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { ageingOven } from "@orrn/db/schema/ageing";
import { furnace } from "@orrn/db/schema/foundry";
import {
  maintAsset,
  maintAssetKinds,
  maintAssetStatuses,
  maintCriticalities,
  maintLinkKinds,
  maintPlan,
  maintReading,
  maintReadingKind,
  maintSetting,
  maintWorkOrder,
  type MaintAssetRow,
} from "@orrn/db/schema/maintenance";
import { pressLine } from "@orrn/db/schema/press";
import { company } from "@orrn/db/schema/tenant";

import { actionProcedure, router } from "../index";
import { atomicBatch, atomicBatchLast, type OrrnDb } from "../lib/atomic";
import { batchAbortUnlessOn, isBatchAbortOn } from "../lib/orders";
import { auditInsertGuarded } from "../lib/audit";
import { now } from "../lib/clock";
import { companyTimezone, zonedMidnightMs, zonedYmd } from "../lib/dayWindow";
import {
  ASSET_CODE_TAKEN,
  ASSET_NO_RUN_HOURS,
  LINK_TAKEN,
  labourRate,
  loadAsset,
  loadLink,
  notFound,
  dueOfPlan,
  plansDue,
  planUsageMinutes,
  plantDayOf,
  plantTimezone,
} from "../lib/maintenance";
import { assertModule } from "../lib/moduleGate";
import { ctxCan } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { insertWorkOrder, sparesFor, sparesRouter, workOrdersRouter } from "./maintenanceWork";

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();
/** A real calendar day as YYYY-MM-DD (2026-02-30 is refused; 2028-02-29 is a day). */
export function isCalendarDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
const day = z.string().refine(isCalendarDay, "Day as YYYY-MM-DD");
const milli = z.number().int().min(-1_000_000_000).max(1_000_000_000);

export const PLAN_NEEDS_INTERVAL = "A plan needs days, run hours or both";
export const ASSET_HAS_HOURS_PLANS = "Plans on this asset run on run hours. Change them to days before you change or remove the link";
export const LIMIT_INVALID = "Give a low limit, a high limit or both, with the low below the high";
export const READING_KIND_TAKEN = "This asset already reads something by that name";
export const READING_KIND_OFF = "That reading is switched off";
export const READING_IN_LIMIT = "That reading is inside its limits";
export const ASSET_RETIRED = "This asset is retired";
export const LINK_KIND_MISMATCH = "A press asset points at a press, a furnace asset at a furnace and an oven asset at an oven";
export const READING_UNIT_LOCKED = "This reading already has readings in its unit. Add a new reading kind for another unit";
export const PLAN_CHANGED = "This plan changed since you opened it. Open it again.";
export const READING_KIND_CHANGED = "This reading's unit or limits changed just now. Take the reading again";
/** Rows the register list returns at most; past it the screen asks for a search. */
export const ASSET_LIST_CAP = 500;

type Ctx = { db: OrrnDb; companyId: string };
type WriteCtx = Parameters<typeof auditInsertGuarded>[0] & { companyId: string; session: { user: { id: string } } };

const viewProcedure = actionProcedure("maint.view");
const manageProcedure = actionProcedure("maint.manage");
const workProcedure = actionProcedure("maint.workorder");

function isUnique(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if (/UNIQUE constraint failed/.test(cur instanceof Error ? cur.message : String(cur))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const assetFields = {
  code: text(40),
  name: text(120),
  kind: z.enum(maintAssetKinds),
  linkKind: z.enum(maintLinkKinds).nullish(),
  linkId: id.nullish(),
  make: optText(120),
  serialNo: optText(120),
  purchasedOn: day.nullish(),
  warrantyUntil: day.nullish(),
  location: optText(120),
  criticality: z.enum(maintCriticalities),
  status: z.enum(maintAssetStatuses),
  note: optText(1000),
};

function assetOut(row: MaintAssetRow) {
  return { ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
}

async function linkLabel(ctx: Ctx, row: Pick<MaintAssetRow, "linkKind" | "linkId">) {
  if (!row.linkKind || !row.linkId) return null;
  try {
    const l = await loadLink(ctx, row.linkKind, row.linkId);
    return { kind: row.linkKind, id: row.linkId, code: l.code, name: l.name };
  } catch {
    return null;
  }
}

/** Duplicate code or master: the precise refusal after a unique index fired. */
async function explainAssetUnique(ctx: Ctx, code: string, linkKind: MaintLinkKind | null, linkId: string | null, selfId?: string): Promise<never> {
  const [byCode] = await ctx.db
    .select({ id: maintAsset.id })
    .from(maintAsset)
    .where(and(eq(maintAsset.companyId, ctx.companyId), sql`lower(${maintAsset.code}) = lower(${code})`))
    .limit(1);
  if (byCode && byCode.id !== selfId) throw new TRPCError({ code: "CONFLICT", message: ASSET_CODE_TAKEN });
  if (linkKind && linkId) throw new TRPCError({ code: "CONFLICT", message: LINK_TAKEN });
  throw new TRPCError({ code: "CONFLICT", message: ASSET_CODE_TAKEN });
}

function normLink(input: { linkKind?: MaintLinkKind | null; linkId?: string | null }): { linkKind: MaintLinkKind | null; linkId: string | null } {
  if (input.linkKind && input.linkId) return { linkKind: input.linkKind, linkId: input.linkId };
  return { linkKind: null, linkId: null };
}

/** An asset that points at a master is of that master's kind (a compressor never takes a press's run hours). */
function assertLinkKind(kind: string, link: { linkKind: MaintLinkKind | null }) {
  if (link.linkKind && link.linkKind !== kind) throw new TRPCError({ code: "BAD_REQUEST", message: LINK_KIND_MISMATCH });
}

// ---------------------------------------------------------------------------
// Assets (#63)
// ---------------------------------------------------------------------------

const assetsRouter = router({
  list: viewProcedure
    .input(
      z
        .object({ kind: z.enum(maintAssetKinds).optional(), includeRetired: z.boolean().default(false), /** Code or name contains (any case). */ q: z.string().trim().max(80).optional() })
        .default({ includeRetired: false }),
    )
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "maintenance");
      const where: (SQL | undefined)[] = [eq(maintAsset.companyId, ctx.companyId)];
      if (input.kind) where.push(eq(maintAsset.kind, input.kind));
      if (!input.includeRetired) where.push(sql`${maintAsset.status} <> 'retired'`);
      if (input.q) {
        const like = `%${input.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(sql`(lower(${maintAsset.code}) like ${like} escape '\\' or lower(${maintAsset.name}) like ${like} escape '\\')`);
      }
      const rows = await ctx.db
        .select({
          id: maintAsset.id,
          code: maintAsset.code,
          name: maintAsset.name,
          kind: maintAsset.kind,
          linkKind: maintAsset.linkKind,
          linkId: maintAsset.linkId,
          criticality: maintAsset.criticality,
          status: maintAsset.status,
          location: maintAsset.location,
          warrantyUntil: maintAsset.warrantyUntil,
          openWorkOrders: sql<number>`(select count(*) from maint_work_order w where w.company_id = "maint_asset"."company_id" and w.asset_id = "maint_asset"."id" and w.status in ('open', 'in_progress', 'waiting_spares'))`,
        })
        .from(maintAsset)
        .where(and(...where))
        .orderBy(asc(maintAsset.criticality), sql`lower(${maintAsset.code})`)
        .limit(ASSET_LIST_CAP);
      return rows.map((r) => ({ ...r, openWorkOrders: Number(r.openWorkOrders) }));
    }),

  get: viewProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "maintenance");
    const row = await loadAsset(ctx, input.id);
    const nowMs = now().getTime();
    const [history, plans, kinds, readings, spares] = await Promise.all([
      ctx.db
        .select({
          id: maintWorkOrder.id,
          number: maintWorkOrder.number,
          kind: maintWorkOrder.kind,
          status: maintWorkOrder.status,
          title: maintWorkOrder.title,
          createdAt: maintWorkOrder.createdAt,
          finishedAt: maintWorkOrder.finishedAt,
          labourMin: maintWorkOrder.labourMin,
        })
        .from(maintWorkOrder)
        .where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.assetId, row.id)))
        .orderBy(desc(maintWorkOrder.createdAt))
        .limit(100),
      Promise.all([
        ctx.db.select().from(maintPlan).where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.assetId, row.id))).orderBy(asc(maintPlan.createdAt)).limit(100),
        planUsageMinutes(ctx, nowMs, row.id),
        plantTimezone(ctx),
        ctx.db
          .select({ planId: maintWorkOrder.planId, id: maintWorkOrder.id, number: maintWorkOrder.number })
          .from(maintWorkOrder)
          .where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.assetId, row.id), sql`${maintWorkOrder.planId} is not null`, sql`${maintWorkOrder.status} in ('open', 'in_progress', 'waiting_spares')`))
          .limit(100),
      ]),
      ctx.db
        .select()
        .from(maintReadingKind)
        .where(and(eq(maintReadingKind.companyId, ctx.companyId), eq(maintReadingKind.assetId, row.id)))
        .orderBy(sql`lower(${maintReadingKind.name})`)
        .limit(100),
      ctx.db
        .select({
          id: maintReading.id,
          kindId: maintReading.kindId,
          valueMilli: maintReading.valueMilli,
          flag: maintReading.flag,
          minMilli: maintReading.minMilli,
          maxMilli: maintReading.maxMilli,
          source: maintReading.source,
          note: maintReading.note,
          readAt: maintReading.readAt,
          workOrderId: maintReading.workOrderId,
        })
        .from(maintReading)
        .where(and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.assetId, row.id)))
        .orderBy(desc(maintReading.readAt))
        .limit(50),
      sparesFor(ctx, { assetId: row.id }),
    ]);
    // Every plan, inactive ones too (a manager can switch one back on). Due figures come from the plan
    // row returned here, so an interval edited between two reads never shows with the other's figures.
    const [allPlans, usage, tz, liveWos] = plans;
    const dayOf = plantDayOf(tz);
    const liveByPlan = new Map(liveWos.map((w) => [w.planId!, w]));
    const showDue = row.status !== "retired";
    return {
      asset: assetOut(row),
      link: await linkLabel(ctx, row),
      history: history.map((h) => ({ ...h, createdAt: h.createdAt.getTime(), finishedAt: h.finishedAt?.getTime() ?? null })),
      plans: allPlans.map((p) => ({
        id: p.id,
        title: p.title,
        steps: p.steps,
        intervalDays: p.intervalDays,
        intervalHours: p.intervalHours,
        baseAt: p.baseAt.getTime(),
        active: p.active,
        serverSeq: p.serverSeq,
        due: p.active && showDue ? dueOfPlan({ id: p.id, intervalDays: p.intervalDays, intervalHours: p.intervalHours, baseAtMs: p.baseAt.getTime() }, usage, nowMs, dayOf) : null,
        openWorkOrderId: liveByPlan.get(p.id)?.id ?? null,
        openWorkOrderNumber: liveByPlan.get(p.id)?.number ?? null,
      })),
      readingKinds: kinds.map((k) => ({ id: k.id, name: k.name, unit: k.unit, minMilli: k.minMilli, maxMilli: k.maxMilli, active: k.active })),
      readings: readings.map((r) => ({ ...r, readAt: r.readAt.getTime() })),
      spares,
    };
  }),

  /** Presses, furnaces and ovens of this plant, and the asset (if any) that already points at each. */
  linkOptions: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    const [presses, furnaces, ovens, linked] = await Promise.all([
      ctx.db.select({ id: pressLine.id, code: pressLine.code, name: pressLine.name, status: pressLine.status }).from(pressLine).where(eq(pressLine.companyId, ctx.companyId)).limit(200),
      ctx.db.select({ id: furnace.id, code: furnace.code, name: furnace.name, status: furnace.status }).from(furnace).where(eq(furnace.companyId, ctx.companyId)).limit(200),
      ctx.db.select({ id: ageingOven.id, code: ageingOven.code, name: ageingOven.name, status: ageingOven.status }).from(ageingOven).where(eq(ageingOven.companyId, ctx.companyId)).limit(200),
      ctx.db
        .select({ id: maintAsset.id, code: maintAsset.code, linkKind: maintAsset.linkKind, linkId: maintAsset.linkId })
        .from(maintAsset)
        .where(and(eq(maintAsset.companyId, ctx.companyId), sql`${maintAsset.linkId} is not null`))
        .limit(600),
    ]);
    const owner = new Map(linked.map((a) => [`${a.linkKind}:${a.linkId}`, { id: a.id, code: a.code }]));
    const opt = (kind: MaintLinkKind) => (m: { id: string; code: string; name: string | null; status: string }) => ({
      kind,
      id: m.id,
      code: m.code,
      name: m.name,
      retired: m.status === "retired",
      asset: owner.get(`${kind}:${m.id}`) ?? null,
    });
    return [...presses.map(opt("press")), ...furnaces.map(opt("furnace")), ...ovens.map(opt("oven"))];
  }),

  create: manageProcedure.input(z.object(assetFields)).mutation(async ({ ctx, input }) => {
    const link = normLink(input);
    if (link.linkKind) await loadLink(ctx, link.linkKind, link.linkId!);
    assertLinkKind(input.kind, link);
    const assetId = crypto.randomUUID();
    const seq = await nextCompanySeq(ctx, ctx.companyId);
    try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(maintAsset).values({
          id: assetId,
          companyId: ctx.companyId,
          serverSeq: seq,
          code: input.code,
          name: input.name,
          kind: input.kind,
          ...link,
          make: input.make ?? null,
          serialNo: input.serialNo ?? null,
          purchasedOn: input.purchasedOn ?? null,
          warrantyUntil: input.warrantyUntil ?? null,
          location: input.location ?? null,
          criticality: input.criticality,
          status: input.status,
          note: input.note ?? null,
          createdBy: ctx.session.user.id,
        }),
        auditInsertGuarded(
          ctx,
          { action: "maint.asset.create", subjectType: "maint_asset", subjectId: assetId, meta: { code: input.code, kind: input.kind, ...link } },
          { from: maintAsset, where: and(eq(maintAsset.companyId, ctx.companyId), eq(maintAsset.id, assetId)) },
        ),
      ]);
    } catch (e) {
      if (isUnique(e)) await explainAssetUnique(ctx, input.code, link.linkKind, link.linkId);
      throw e;
    }
    return { id: assetId };
  }),

  update: manageProcedure.input(z.object({ id, serverSeq: z.number().int(), ...assetFields })).mutation(async ({ ctx, input }) => {
    const row = await loadAsset(ctx, input.id);
    if (row.serverSeq !== input.serverSeq) throw new TRPCError({ code: "CONFLICT", message: "This asset changed since you opened it. Open it again." });
    const link = normLink(input);
    if (link.linkKind) await loadLink(ctx, link.linkKind, link.linkId!);
    assertLinkKind(input.kind, link);
    // Run hours belong to the master the asset points at. Removing the link, or pointing it at another
    // master, while an active plan runs on run hours is refused: the plan's count would either stop or
    // take the new master's hours from before the move. Change those plans to days first. Checked here
    // and again inside the batch, so a run-hours plan added meanwhile still refuses the change.
    const linkChanges = row.linkKind !== link.linkKind || row.linkId !== link.linkId;
    const noHoursPlan = sql`not exists (select 1 from maint_plan p where p.company_id = ${ctx.companyId} and p.asset_id = ${row.id} and p.active = 1 and p.interval_hours is not null)`;
    if (linkChanges && row.linkKind) {
      const [hoursPlan] = await ctx.db
        .select({ id: maintPlan.id })
        .from(maintPlan)
        .where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.assetId, row.id), eq(maintPlan.active, true), sql`${maintPlan.intervalHours} is not null`))
        .limit(1);
      if (hoursPlan) throw new TRPCError({ code: "BAD_REQUEST", message: ASSET_HAS_HOURS_PLANS });
    }
    const seq = await nextCompanySeq(ctx, ctx.companyId);
    const where = (s: number) => and(eq(maintAsset.companyId, ctx.companyId), eq(maintAsset.id, row.id), eq(maintAsset.serverSeq, s));
    let landed: { id: string }[];
    try {
      landed = await atomicBatchLast<{ id: string }>(ctx.db, [
        ...(linkChanges && row.linkKind ? [batchAbortUnlessOn(ctx.db, maintPlan, noHoursPlan)] : []),
        ctx.db
          .update(maintAsset)
          .set({
            serverSeq: seq,
            code: input.code,
            name: input.name,
            kind: input.kind,
            ...link,
            make: input.make ?? null,
            serialNo: input.serialNo ?? null,
            purchasedOn: input.purchasedOn ?? null,
            warrantyUntil: input.warrantyUntil ?? null,
            location: input.location ?? null,
            criticality: input.criticality,
            status: input.status,
            note: input.note ?? null,
            updatedAt: now(),
          })
          .where(where(input.serverSeq)),
        auditInsertGuarded(
          ctx,
          { action: "maint.asset.update", subjectType: "maint_asset", subjectId: row.id, meta: { code: input.code, status: input.status, ...link } },
          { from: maintAsset, where: where(seq) },
        ),
        ctx.db.select({ id: maintAsset.id }).from(maintAsset).where(where(seq)),
      ]);
    } catch (e) {
      if (isBatchAbortOn(e, "maint_plan")) throw new TRPCError({ code: "BAD_REQUEST", message: ASSET_HAS_HOURS_PLANS });
      if (isUnique(e)) await explainAssetUnique(ctx, input.code, link.linkKind, link.linkId, row.id);
      throw e;
    }
    if (landed.length === 0) throw new TRPCError({ code: "CONFLICT", message: "This asset changed since you opened it. Open it again." });
    return { id: row.id };
  }),

  /** One asset for each press, furnace and oven not yet in the register (code and name from the master). */
  addFromMasters: manageProcedure.mutation(async ({ ctx }) => {
    // Masters already in the register are left out in SQL, before the limit, so a repeat adds the rest.
    const notLinked = (kind: MaintLinkKind, idCol: SQL) =>
      sql`not exists (select 1 from maint_asset x where x.company_id = ${ctx.companyId} and x.link_kind = ${kind} and x.link_id = ${idCol})`;
    const [presses, furnaces, ovens, existing] = await Promise.all([
      ctx.db.select({ id: pressLine.id, code: pressLine.code, name: pressLine.name }).from(pressLine).where(and(eq(pressLine.companyId, ctx.companyId), eq(pressLine.status, "active"), notLinked("press", sql`${pressLine.id}`))).limit(100),
      ctx.db.select({ id: furnace.id, code: furnace.code, name: furnace.name }).from(furnace).where(and(eq(furnace.companyId, ctx.companyId), eq(furnace.status, "active"), notLinked("furnace", sql`${furnace.id}`))).limit(100),
      ctx.db.select({ id: ageingOven.id, code: ageingOven.code, name: ageingOven.name }).from(ageingOven).where(and(eq(ageingOven.companyId, ctx.companyId), sql`${ageingOven.status} <> 'out_of_service'`, notLinked("oven", sql`${ageingOven.id}`))).limit(100),
      ctx.db.select({ code: maintAsset.code, linkKind: maintAsset.linkKind, linkId: maintAsset.linkId }).from(maintAsset).where(eq(maintAsset.companyId, ctx.companyId)).limit(2000),
    ]);
    const linked = new Set(existing.map((a) => `${a.linkKind}:${a.linkId}`));
    const codes = new Set(existing.map((a) => a.code.toLowerCase()));
    const wanted: { kind: MaintLinkKind; id: string; code: string; name: string }[] = [];
    const add = (kind: MaintLinkKind, rows: { id: string; code: string; name: string | null }[]) => {
      for (const r of rows) {
        if (linked.has(`${kind}:${r.id}`)) continue;
        let code = r.code;
        for (let n = 2; codes.has(code.toLowerCase()); n += 1) code = `${r.code}-${n}`;
        codes.add(code.toLowerCase());
        wanted.push({ kind, id: r.id, code, name: r.name?.trim() || r.code });
      }
    };
    add("press", presses);
    add("furnace", furnaces);
    add("oven", ovens);
    if (wanted.length === 0) return { added: 0 };
    const seq = await nextCompanySeq(ctx, ctx.companyId);
    const userId = ctx.session.user.id;
    // 20 columns at most per row are bound; insert one row per statement to stay far below 100 parameters.
    const statements = wanted.map((w) =>
      ctx.db.insert(maintAsset).values({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        code: w.code,
        name: w.name,
        kind: w.kind,
        linkKind: w.kind,
        linkId: w.id,
        criticality: w.kind === "press" || w.kind === "furnace" ? "A" : "B",
        status: "running",
        createdBy: userId,
      }),
    );
    try {
      await atomicBatch(ctx.db, [
        ...statements,
        auditInsertGuarded(ctx, { action: "maint.asset.addFromMasters", subjectType: "maint_asset", subjectId: null, meta: { added: wanted.length, codes: wanted.map((w) => w.code).slice(0, 50) } }, { from: company, where: eq(company.id, ctx.companyId) }),
      ] as never);
    } catch (e) {
      if (isUnique(e)) throw new TRPCError({ code: "CONFLICT", message: "The register changed while adding. Try again." });
      throw e;
    }
    return { added: wanted.length };
  }),
});

// ---------------------------------------------------------------------------
// Preventive plans (#64)
// ---------------------------------------------------------------------------

const planFields = {
  title: text(200),
  steps: optText(2000),
  intervalDays: z.number().int().min(1).max(MAX_PM_INTERVAL_DAYS).nullish(),
  intervalHours: z.number().int().min(1).max(MAX_PM_INTERVAL_HOURS).nullish(),
};

async function assertPlanFits(asset: MaintAssetRow, input: { intervalDays?: number | null; intervalHours?: number | null }) {
  if (input.intervalDays == null && input.intervalHours == null) throw new TRPCError({ code: "BAD_REQUEST", message: PLAN_NEEDS_INTERVAL });
  if (input.intervalHours != null && !asset.linkKind) throw new TRPCError({ code: "BAD_REQUEST", message: ASSET_NO_RUN_HOURS });
}

/**
 * In-batch guard for a plan that runs on run hours: the asset still points at the master it pointed at
 * when the plan was checked. An unlink or relink that commits first fails the plan write (no audit row).
 */
function hoursPlanLinkGuard(ctx: Ctx, asset: MaintAssetRow, input: { intervalHours?: number | null }) {
  if (input.intervalHours == null) return [];
  return [
    batchAbortUnlessOn(
      ctx.db,
      maintAsset,
      sql`exists (select 1 from maint_asset a where a.company_id = ${ctx.companyId} and a.id = ${asset.id} and a.link_kind = ${asset.linkKind} and a.link_id = ${asset.linkId})`,
    ),
  ];
}

function rethrowPlanAbort(e: unknown): never {
  if (isBatchAbortOn(e, "maint_asset")) throw new TRPCError({ code: "BAD_REQUEST", message: ASSET_NO_RUN_HOURS });
  throw e;
}

async function loadPlan(ctx: Ctx, planId: string) {
  const [row] = await ctx.db.select().from(maintPlan).where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, planId))).limit(1);
  if (!row) throw notFound();
  return row;
}

const plansRouter = router({
  /** Every active plan with its due figures, overdue first (Today, the maintenance screen). */
  due: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    return plansDue(ctx, now().getTime());
  }),

  create: manageProcedure
    .input(z.object({ assetId: id, ...planFields, /** Day the plan counts from (default today). */ startOn: day.optional() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAsset(ctx, input.assetId);
      await assertPlanFits(asset, input);
      const at = now();
      let baseAt = at;
      if (input.startOn) {
        const [settings] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
        const [y, m, d] = input.startOn.split("-").map(Number);
        baseAt = new Date(zonedMidnightMs(companyTimezone(settings?.settings), { year: y!, month: m!, day: d! }));
      }
      const planId = crypto.randomUUID();
      const seq = await nextCompanySeq(ctx, ctx.companyId);
      await atomicBatch(ctx.db, [
        ...hoursPlanLinkGuard(ctx, asset, input),
        ctx.db.insert(maintPlan).values({
          id: planId,
          companyId: ctx.companyId,
          serverSeq: seq,
          assetId: asset.id,
          title: input.title,
          steps: input.steps ?? null,
          intervalDays: input.intervalDays ?? null,
          intervalHours: input.intervalHours ?? null,
          baseAt,
          createdBy: ctx.session.user.id,
        }),
        auditInsertGuarded(
          ctx,
          { action: "maint.plan.create", subjectType: "maint_asset", subjectId: asset.id, meta: { planId, code: asset.code, title: input.title, intervalDays: input.intervalDays ?? null, intervalHours: input.intervalHours ?? null } },
          { from: maintPlan, where: and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, planId)) },
        ),
      ]).catch(rethrowPlanAbort);
      return { id: planId };
    }),

  /**
   * Edit a plan. `serverSeq` is the plan's as read: a save over a newer version is a CONFLICT with no
   * audit row. Switching a plan back on restarts its count from now (a plan off for months is not
   * overdue the moment it is back), and forgets its last work order, so editing that old work order's
   * times no longer moves the plan.
   */
  update: manageProcedure
    .input(z.object({ id, serverSeq: z.number().int(), ...planFields, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlan(ctx, input.id);
      if (plan.serverSeq !== input.serverSeq) throw new TRPCError({ code: "CONFLICT", message: PLAN_CHANGED });
      const asset = await loadAsset(ctx, plan.assetId);
      await assertPlanFits(asset, input);
      const at = now();
      const restarts = !plan.active && input.active;
      const seq = await nextCompanySeq(ctx, ctx.companyId);
      const where = (s: number) => and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, plan.id), eq(maintPlan.serverSeq, s));
      const landed = await atomicBatchLast<{ id: string }>(ctx.db, [
        // Only an active plan counts run hours; one switched off may keep its hours interval.
        ...(input.active ? hoursPlanLinkGuard(ctx, asset, input) : []),
        ctx.db
          .update(maintPlan)
          .set({
            serverSeq: seq,
            title: input.title,
            steps: input.steps ?? null,
            intervalDays: input.intervalDays ?? null,
            intervalHours: input.intervalHours ?? null,
            active: input.active,
            ...(restarts ? { baseAt: at, lastWorkOrderId: null } : {}),
            updatedAt: at,
          })
          .where(where(input.serverSeq)),
        auditInsertGuarded(
          ctx,
          {
            action: "maint.plan.update",
            subjectType: "maint_asset",
            subjectId: asset.id,
            meta: { planId: plan.id, code: asset.code, title: input.title, active: input.active, intervalDays: input.intervalDays ?? null, intervalHours: input.intervalHours ?? null, ...(restarts ? { planReset: true } : {}) },
          },
          { from: maintPlan, where: where(seq) },
        ),
        ctx.db.select({ id: maintPlan.id }).from(maintPlan).where(where(seq)),
      ]).catch(rethrowPlanAbort);
      if (landed.length === 0) throw new TRPCError({ code: "CONFLICT", message: PLAN_CHANGED });
      return { id: plan.id };
    }),

  /** Open the plan's preventive work order (the live one comes back if there is one). */
  makeWorkOrder: workProcedure.input(z.object({ planId: id })).mutation(async ({ ctx, input }) => {
    const plan = await loadPlan(ctx, input.planId);
    const asset = await loadAsset(ctx, plan.assetId);
    if (asset.status === "retired") throw new TRPCError({ code: "BAD_REQUEST", message: ASSET_RETIRED });
    return insertWorkOrder(
      ctx as WriteCtx,
      { assetId: asset.id, kind: "preventive", source: "plan", planId: plan.id, title: plan.title, priority: priorityFromCriticality(asset.criticality) },
      async () => {
        const [w] = await ctx.db
          .select()
          .from(maintWorkOrder)
          .where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.planId, plan.id), sql`${maintWorkOrder.status} in ('open', 'in_progress', 'waiting_spares')`))
          .limit(1);
        return w ?? null;
      },
    );
  }),
});

// ---------------------------------------------------------------------------
// Condition readings (#68)
// ---------------------------------------------------------------------------

const kindFields = {
  name: text(80),
  /** As the plant writes it ("°C", "bar"); never translated. */
  unit: text(20),
  minMilli: milli.nullish(),
  maxMilli: milli.nullish(),
};

async function loadKind(ctx: Ctx, kindId: string) {
  const [row] = await ctx.db.select().from(maintReadingKind).where(and(eq(maintReadingKind.companyId, ctx.companyId), eq(maintReadingKind.id, kindId))).limit(1);
  if (!row) throw notFound();
  return row;
}

const readingsRouter = router({
  createKind: manageProcedure.input(z.object({ assetId: id, ...kindFields })).mutation(async ({ ctx, input }) => {
    const asset = await loadAsset(ctx, input.assetId);
    const limit = { minMilli: input.minMilli ?? null, maxMilli: input.maxMilli ?? null };
    if (!validReadingLimit(limit)) throw new TRPCError({ code: "BAD_REQUEST", message: LIMIT_INVALID });
    const kindId = crypto.randomUUID();
    try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(maintReadingKind).values({ id: kindId, companyId: ctx.companyId, assetId: asset.id, name: input.name, unit: input.unit, ...limit, createdBy: ctx.session.user.id }),
        auditInsertGuarded(
          ctx,
          { action: "maint.limit.create", subjectType: "maint_asset", subjectId: asset.id, meta: { code: asset.code, name: input.name, unit: input.unit, ...limit } },
          { from: maintReadingKind, where: and(eq(maintReadingKind.companyId, ctx.companyId), eq(maintReadingKind.id, kindId)) },
        ),
      ]);
    } catch (e) {
      if (isUnique(e)) throw new TRPCError({ code: "CONFLICT", message: READING_KIND_TAKEN });
      throw e;
    }
    return { id: kindId };
  }),

  /** Edit a reading kind. Its unit is fixed once it has readings: stored values and limits are in that unit. */
  updateKind: manageProcedure.input(z.object({ id, ...kindFields, active: z.boolean() })).mutation(async ({ ctx, input }) => {
    const kind = await loadKind(ctx, input.id);
    const limit = { minMilli: input.minMilli ?? null, maxMilli: input.maxMilli ?? null };
    if (!validReadingLimit(limit)) throw new TRPCError({ code: "BAD_REQUEST", message: LIMIT_INVALID });
    if (input.unit !== kind.unit) {
      const [any] = await ctx.db.select({ id: maintReading.id }).from(maintReading).where(and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.kindId, kind.id))).limit(1);
      if (any) throw new TRPCError({ code: "BAD_REQUEST", message: READING_UNIT_LOCKED });
    }
    const where = and(eq(maintReadingKind.companyId, ctx.companyId), eq(maintReadingKind.id, kind.id));
    const unitChanges = input.unit !== kind.unit;
    try {
      await atomicBatch(ctx.db, [
        // A reading recorded since the check above still locks the unit (`record` guards the other side).
        ...(unitChanges
          ? [batchAbortUnlessOn(ctx.db, maintReadingKind, sql`not exists (select 1 from maint_reading r where r.company_id = ${ctx.companyId} and r.kind_id = ${kind.id})`)]
          : []),
        ctx.db.update(maintReadingKind).set({ name: input.name, unit: input.unit, ...limit, active: input.active, updatedAt: now() }).where(where),
        auditInsertGuarded(ctx, { action: "maint.limit.update", subjectType: "maint_asset", subjectId: kind.assetId, meta: { name: input.name, unit: input.unit, active: input.active, ...limit } }, { from: maintReadingKind, where }),
      ]);
    } catch (e) {
      if (isBatchAbortOn(e, "maint_reading_kind")) throw new TRPCError({ code: "BAD_REQUEST", message: READING_UNIT_LOCKED });
      if (isUnique(e)) throw new TRPCError({ code: "CONFLICT", message: READING_KIND_TAKEN });
      throw e;
    }
    return { id: kind.id };
  }),

  /**
   * A reading typed by hand. The server checks it against the kind's limits as they are now. The write
   * lands only while the kind is still on with the unit and limits it was checked against: a kind
   * switched off, re-limited or given another unit meanwhile refuses the reading (no audit row).
   */
  record: workProcedure
    .input(z.object({ kindId: id, valueMilli: milli, note: optText(500) }))
    .mutation(async ({ ctx, input }) => {
      const kind = await loadKind(ctx, input.kindId);
      if (!kind.active) throw new TRPCError({ code: "BAD_REQUEST", message: READING_KIND_OFF });
      const flag = readingFlag(input.valueMilli, kind);
      const readingId = crypto.randomUUID();
      const at = now();
      const kindAsChecked = sql`exists (select 1 from maint_reading_kind k where k.company_id = ${ctx.companyId} and k.id = ${kind.id}
        and k.active = 1 and k.unit = ${kind.unit} and k.min_milli is ${kind.minMilli} and k.max_milli is ${kind.maxMilli})`;
      await atomicBatch(ctx.db, [
        batchAbortUnlessOn(ctx.db, maintReading, kindAsChecked),
        ctx.db.insert(maintReading).values({
          id: readingId,
          companyId: ctx.companyId,
          assetId: kind.assetId,
          kindId: kind.id,
          valueMilli: input.valueMilli,
          minMilli: kind.minMilli,
          maxMilli: kind.maxMilli,
          flag,
          source: "hand",
          note: input.note ?? null,
          readAt: at,
          createdBy: ctx.session.user.id,
        }),
        auditInsertGuarded(
          ctx,
          { action: "maint.reading.record", subjectType: "maint_asset", subjectId: kind.assetId, meta: { readingId, name: kind.name, valueMilli: input.valueMilli, flag } },
          { from: maintReading, where: and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.id, readingId)) },
        ),
      ]).catch(async (e: unknown) => {
        if (!isBatchAbortOn(e, "maint_reading")) throw e;
        const nowKind = await loadKind(ctx, kind.id);
        throw new TRPCError({ code: "BAD_REQUEST", message: nowKind.active ? READING_KIND_CHANGED : READING_KIND_OFF });
      });
      return { id: readingId, flag };
    }),

  list: viewProcedure
    .input(z.object({ assetId: id, kindId: id.optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await assertModule(ctx, "maintenance");
      await loadAsset(ctx, input.assetId);
      const where: (SQL | undefined)[] = [eq(maintReading.companyId, ctx.companyId), eq(maintReading.assetId, input.assetId)];
      if (input.kindId) where.push(eq(maintReading.kindId, input.kindId));
      if (input.cursor) {
        const [msPart, rid] = input.cursor.split(":");
        const at = new Date(Number(msPart));
        if (rid && Number.isFinite(at.getTime())) where.push(or(lt(maintReading.readAt, at), and(eq(maintReading.readAt, at), lt(maintReading.id, rid))));
      }
      const rows = await ctx.db
        .select()
        .from(maintReading)
        .where(and(...where))
        .orderBy(desc(maintReading.readAt), desc(maintReading.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({ ...r, readAt: r.readAt.getTime(), createdAt: r.createdAt.getTime() })),
        nextCursor: rows.length > input.limit && last ? `${last.readAt.getTime()}:${last.id}` : null,
      };
    }),

  /** Out-of-limit readings in the last 30 days, newest first, with the work order made from each. */
  flagged: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    const since = now().getTime() - 30 * 86_400_000;
    const rows = await ctx.db
      .select({
        id: maintReading.id,
        assetId: maintReading.assetId,
        assetCode: maintAsset.code,
        assetName: maintAsset.name,
        kindName: maintReadingKind.name,
        unit: maintReadingKind.unit,
        valueMilli: maintReading.valueMilli,
        minMilli: maintReading.minMilli,
        maxMilli: maintReading.maxMilli,
        flag: maintReading.flag,
        readAt: maintReading.readAt,
        workOrderId: maintReading.workOrderId,
      })
      .from(maintReading)
      .innerJoin(maintAsset, and(eq(maintAsset.id, maintReading.assetId), eq(maintAsset.companyId, maintReading.companyId)))
      .innerJoin(maintReadingKind, and(eq(maintReadingKind.id, maintReading.kindId), eq(maintReadingKind.companyId, maintReading.companyId)))
      .where(and(eq(maintReading.companyId, ctx.companyId), sql`${maintReading.flag} <> 'ok'`, sql`${maintReading.readAt} >= ${since}`))
      .orderBy(desc(maintReading.readAt))
      .limit(100);
    return rows.map((r) => ({ ...r, readAt: r.readAt.getTime() }));
  }),

  /**
   * "Make work order" from an out-of-limit reading: a CONDITION work order on the reading's asset (the
   * asset still runs, so it is not a breakdown); one live or done per reading, a cancelled one frees it.
   */
  makeWorkOrder: workProcedure.input(z.object({ readingId: id })).mutation(async ({ ctx, input }) => {
    const [r] = await ctx.db
      .select({ id: maintReading.id, assetId: maintReading.assetId, flag: maintReading.flag, valueMilli: maintReading.valueMilli, kindName: maintReadingKind.name, unit: maintReadingKind.unit })
      .from(maintReading)
      .innerJoin(maintReadingKind, and(eq(maintReadingKind.id, maintReading.kindId), eq(maintReadingKind.companyId, maintReading.companyId)))
      .where(and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.id, input.readingId)))
      .limit(1);
    if (!r) throw notFound();
    const existing = async () => {
      const [w] = await ctx.db
        .select()
        .from(maintWorkOrder)
        .where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.readingId, r.id), sql`${maintWorkOrder.status} <> 'cancelled'`))
        .limit(1);
      return w ?? null;
    };
    const prior = await existing();
    if (prior) return { id: prior.id, number: prior.number, replayed: true as const };
    if (r.flag === "ok") throw new TRPCError({ code: "BAD_REQUEST", message: READING_IN_LIMIT });
    const asset = await loadAsset(ctx, r.assetId);
    const value = (r.valueMilli / 1000).toString();
    return insertWorkOrder(
      ctx as WriteCtx,
      { assetId: asset.id, kind: "condition", source: "reading", readingId: r.id, title: `${r.kindName} ${value} ${r.unit}`.slice(0, 300), priority: priorityFromCriticality(asset.criticality) },
      existing,
    );
  }),
});

// ---------------------------------------------------------------------------
// Reports and settings (#67)
// ---------------------------------------------------------------------------

/** Rows read per source for one report; past it the report says so (`truncated`) and asks for fewer months. */
export const REPORT_ROW_CAP = 5_000;

/** A breakdown not closed yet (downtime not stopped, or work order not done): shown apart, never counted. */
type StillOpen = { startMs: number; ageMin: number; workOrderId: string | null; workOrderNumber: string | null };

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month as YYYY-MM");

function monthStartMs(tz: string, key: string): number {
  const [y, m] = key.split("-").map(Number);
  return zonedMidnightMs(tz, { year: y!, month: m!, day: 1 });
}

function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

function monthOf(tz: string, ms: number): string {
  const d = zonedYmd(tz, ms);
  return `${d.year}-${String(d.month).padStart(2, "0")}`;
}

const reportsRouter = router({
  /**
   * Per asset per month: breakdowns, downtime minutes, MTTR and MTBF (calendar time), labour minutes and
   * spares entries; money (labour cost, spares value) only for maint.manage holders. A breakdown is ONE
   * event: a press downtime entry with the breakdown reason on a linked press, or a breakdown work order
   * that did not come from such an entry (its start, else its creation, to its finish). Condition work
   * orders (from a reading) are not breakdowns. Only closed breakdowns count: a downtime entry not yet
   * stopped, or a breakdown work order not yet done, is listed per asset under `stillOpen` with its age
   * and left out of every figure until it closes. A breakdown is counted (and its MTTR taken) in the
   * month it started; each month's downtime is clipped to the month. Months are the plant's own
   * (company timezone). `truncated` is true when a source (the assets too) had more than REPORT_ROW_CAP
   * rows in range. Labour and spares of a breakdown work order still open wait for it to close.
   */
  summary: viewProcedure.input(z.object({ from: month, to: month })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "maintenance");
    let months: string[];
    try {
      months = monthRange(input.from, input.to, 12);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
    const showMoney = ctxCan(ctx, "maint.manage");
    const tz = await plantTimezone(ctx);
    const fromMs = monthStartMs(tz, months[0]!);
    const toMs = monthStartMs(tz, nextMonthKey(months[months.length - 1]!));
    const nowMs = now().getTime();
    const endMs = Math.min(toMs, nowMs);
    const c = ctx.companyId;
    const cap = REPORT_ROW_CAP + 1;
    // A breakdown work order still open (or made from a downtime entry not stopped yet) stays out of
    // every figure, its labour and spares too, until it closes; other work orders count as they are.
    const closedBreakdownOnly = sql`(w.kind <> 'breakdown' or (w.status = 'done' and (w.downtime_id is null or exists (
      select 1 from press_downtime dd where dd.company_id = w.company_id and dd.id = w.downtime_id and dd.stopped_at is not null))))`;

    const [assets, downtimeEvents, woEvents, labour, spares, rate] = await Promise.all([
      ctx.db
        .select({ id: maintAsset.id, code: maintAsset.code, name: maintAsset.name, kind: maintAsset.kind, criticality: maintAsset.criticality })
        .from(maintAsset)
        .where(eq(maintAsset.companyId, c))
        .orderBy(sql`lower(${maintAsset.code})`)
        .limit(cap),
      ctx.db.all<{ asset_id: string; started_at: number; stopped_at: number | null; wo_id: string | null; wo_number: string | null }>(sql`
        select a.id as asset_id, d.started_at, d.stopped_at, w.id as wo_id, w.number as wo_number
        from press_downtime d
        join reason_code rc on rc.id = d.reason_code_id and rc.company_id = d.company_id and rc.code = 'breakdown'
        join maint_asset a on a.company_id = d.company_id and a.link_kind = 'press' and a.link_id = d.press_line_id
        left join maint_work_order w on w.company_id = d.company_id and w.downtime_id = d.id and w.status <> 'cancelled'
        where d.company_id = ${c} and d.started_at < ${toMs} and (d.stopped_at is null or d.stopped_at > ${fromMs})
        order by d.started_at
        limit ${cap}`),
      ctx.db.all<{ id: string; number: string; asset_id: string; started_at: number; finished_at: number | null; status: string }>(sql`
        select w.id, w.number, w.asset_id, coalesce(w.started_at, w.created_at) as started_at, w.finished_at, w.status
        from maint_work_order w
        where w.company_id = ${c} and w.kind = 'breakdown' and w.status <> 'cancelled' and w.downtime_id is null
          and coalesce(w.started_at, w.created_at) < ${toMs}
          and (w.status <> 'done' or w.finished_at > ${fromMs})
        order by coalesce(w.started_at, w.created_at)
        limit ${cap}`),
      ctx.db.all<{ asset_id: string; at: number; labour_min: number }>(sql`
        select w.asset_id, coalesce(w.finished_at, w.created_at) as at, w.labour_min
        from maint_work_order w
        where w.company_id = ${c} and w.status <> 'cancelled' and w.labour_min > 0 and ${closedBreakdownOnly}
          and coalesce(w.finished_at, w.created_at) >= ${fromMs} and coalesce(w.finished_at, w.created_at) < ${toMs}
        limit ${cap}`),
      ctx.db.all<{ asset_id: string; at: number }>(sql`
        select w.asset_id, t.created_at as at
        from maint_wo_spare s
        join maint_work_order w on w.id = s.work_order_id and w.company_id = s.company_id
        join store_txn t on t.id = s.store_txn_id and t.company_id = s.company_id and t.cancelled_at is null
        where s.company_id = ${c} and ${closedBreakdownOnly} and t.created_at >= ${fromMs} and t.created_at < ${toMs}
        limit ${cap}`),
      labourRate(ctx),
    ]);
    const truncated = [assets, downtimeEvents, woEvents, labour, spares].some((rows) => rows.length > REPORT_ROW_CAP);
    const keep = <T,>(rows: T[]) => rows.slice(0, REPORT_ROW_CAP);

    const events = new Map<string, BreakdownEvent[]>();
    const open = new Map<string, StillOpen[]>();
    const push = <T,>(map: Map<string, T[]>, assetId: string, e: T) => {
      const list = map.get(assetId) ?? [];
      list.push(e);
      map.set(assetId, list);
    };
    for (const d of keep(downtimeEvents)) {
      const startMs = Number(d.started_at);
      if (d.stopped_at == null) push(open, d.asset_id, { startMs, ageMin: Math.max(0, Math.round((nowMs - startMs) / 60_000)), workOrderId: d.wo_id, workOrderNumber: d.wo_number });
      else push(events, d.asset_id, { startMs, endMs: Number(d.stopped_at) });
    }
    for (const w of keep(woEvents)) {
      const startMs = Number(w.started_at);
      if (w.status !== "done" || w.finished_at == null) push(open, w.asset_id, { startMs, ageMin: Math.max(0, Math.round((nowMs - startMs) / 60_000)), workOrderId: w.id, workOrderNumber: w.number });
      else push(events, w.asset_id, { startMs, endMs: Number(w.finished_at) });
    }

    const labourBy = new Map<string, number>();
    for (const l of keep(labour)) labourBy.set(`${l.asset_id}|${monthOf(tz, Number(l.at))}`, (labourBy.get(`${l.asset_id}|${monthOf(tz, Number(l.at))}`) ?? 0) + Number(l.labour_min));
    const sparesBy = new Map<string, number>();
    for (const s of keep(spares)) sparesBy.set(`${s.asset_id}|${monthOf(tz, Number(s.at))}`, (sparesBy.get(`${s.asset_id}|${monthOf(tz, Number(s.at))}`) ?? 0) + 1);

    const rows = keep(assets).map((a) => {
      const ev = events.get(a.id) ?? [];
      const perMonth = months.map((m) => {
        const mFrom = monthStartMs(tz, m);
        const mTo = Math.min(monthStartMs(tz, nextMonthKey(m)), nowMs);
        const rel = mTo > mFrom ? reliability(ev, mFrom, mTo) : { failures: 0, downtimeMin: 0, mttrMin: null, mtbfMin: null };
        const labourMin = labourBy.get(`${a.id}|${m}`) ?? 0;
        return {
          month: m,
          ...rel,
          labourMin,
          sparesEntries: sparesBy.get(`${a.id}|${m}`) ?? 0,
          labourPaise: showMoney ? labourPaise(labourMin, rate) : null,
          // TODO(xe-store2): spares value through storeIssueValuePaise once lib/storeValue.ts lands.
          sparesValuePaise: null as number | null,
        };
      });
      const total = endMs > fromMs ? reliability(ev, fromMs, endMs) : { failures: 0, downtimeMin: 0, mttrMin: null, mtbfMin: null };
      const labourMin = perMonth.reduce((s, p) => s + p.labourMin, 0);
      return {
        asset: a,
        stillOpen: open.get(a.id) ?? [],
        months: perMonth,
        total: {
          ...total,
          labourMin,
          sparesEntries: perMonth.reduce((s, p) => s + p.sparesEntries, 0),
          labourPaise: showMoney ? labourPaise(labourMin, rate) : null,
          sparesValuePaise: null as number | null,
        },
      };
    });
    return { months, showMoney, labourRatePaisePerHour: showMoney ? rate : null, sparesValueKnown: false, truncated, rows };
  }),
});

const settingsRouter = router({
  get: manageProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    return { labourRatePaisePerHour: await labourRate(ctx) };
  }),
  set: manageProcedure
    .input(z.object({ labourRatePaisePerHour: z.number().int().min(0).max(100_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(maintSetting)
          .values({ companyId: ctx.companyId, labourRatePaisePerHour: input.labourRatePaisePerHour, updatedBy: ctx.session.user.id, updatedAt: now() })
          .onConflictDoUpdate({ target: maintSetting.companyId, set: { labourRatePaisePerHour: input.labourRatePaisePerHour, updatedBy: ctx.session.user.id, updatedAt: now() } }),
        auditInsertGuarded(ctx, { action: "maint.settings.update", subjectType: "company", subjectId: ctx.companyId, meta: { labourRatePaisePerHour: input.labourRatePaisePerHour } }, { from: maintSetting, where: eq(maintSetting.companyId, ctx.companyId) }),
      ]);
      return { labourRatePaisePerHour: input.labourRatePaisePerHour };
    }),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const maintenanceRouter = router({
  assets: assetsRouter,
  plans: plansRouter,
  workOrders: workOrdersRouter,
  spares: sparesRouter,
  readings: readingsRouter,
  reports: reportsRouter,
  settings: settingsRouter,

  /**
   * The Today tile: plans overdue and due soon (with the first five), live work orders, open breakdowns,
   * flagged readings. Null while the register is empty: a plant that never set maintenance up (the
   * module is on by default) sees no new tile.
   */
  today: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    const [anyAsset] = await ctx.db.select({ id: maintAsset.id }).from(maintAsset).where(eq(maintAsset.companyId, ctx.companyId)).limit(1);
    if (!anyAsset) return null;
    const nowMs = now().getTime();
    const due = await plansDue(ctx, nowMs);
    const [counts] = await ctx.db.all<{ live: number; breakdowns: number; flagged: number }>(sql`
      select
        (select count(*) from maint_work_order w where w.company_id = ${ctx.companyId} and w.status in ('open', 'in_progress', 'waiting_spares')) as live,
        (select count(*) from maint_work_order w where w.company_id = ${ctx.companyId} and w.kind = 'breakdown' and w.status in ('open', 'in_progress', 'waiting_spares')) as breakdowns,
        (select count(*) from maint_reading r where r.company_id = ${ctx.companyId} and r.flag <> 'ok' and r.work_order_id is null and r.read_at >= ${nowMs - 7 * 86_400_000}) as flagged`);
    return {
      overdue: due.filter((d) => d.due.state === "overdue").length,
      soon: due.filter((d) => d.due.state === "soon").length,
      liveWorkOrders: Number(counts?.live ?? 0),
      openBreakdowns: Number(counts?.breakdowns ?? 0),
      flaggedReadings: Number(counts?.flagged ?? 0),
      top: due.filter((d) => d.due.state !== "ok").slice(0, 5),
    };
  }),
});

