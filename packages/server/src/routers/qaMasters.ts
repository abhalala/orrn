/**
 * Quality masters (XE parity lane QA): temper master (row 35), quality plan per section or die copy (28),
 * inspection points (36), allowed alloy substitutes (37) and the instrument register with calibration and
 * certificates (38). Spread into `qa` (routers/qa.ts), so the `qa` module gates every mutation here.
 * Writes need `qa.masters`, except recording a calibration and its certificate (`qa.check`).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { ageingRecipe } from "@orrn/db/schema/ageing";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { cast } from "@orrn/db/schema/foundry";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { stockLedger } from "@orrn/db/schema/stock";
import { qaAlloySubstitute, qaInstrument, qaPlan, qaStages, qaStation, qaTemper, qaHardnessMethods } from "@orrn/db/schema/qa";
import {
  alloyShort,
  calibrationState,
  dimensionInputError,
  isTemperCode,
  MAX_DIMENSIONS,
  MAX_DIMENSION_UM,
  nextCalibrationDue,
  processLimitsError,
  substitutesFor,
  temperLimitsError,
} from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import {
  checkDieFile,
  DIE_FILE_COMMIT_GRACE_MS,
  DIE_FILE_LIMITS,
  DIE_FILE_UPLOAD_TTL_MS,
  dieFileKindOfName,
  dieFileUploadUrl,
  dieFilesBucket,
  readUploadTicket,
  signDieFileUrl,
  signUploadTicket,
  ticketKey,
  type DieUploadTicket,
} from "../lib/dieFiles";
import { lineBalances } from "../lib/orders";
import { companyDay, isQaUnique, readQaPlant } from "../lib/qa";
import { qaRefusal } from "../lib/qaRefusals";

const id = z.string().trim().min(1).max(64);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const x10 = z.number().int().min(0).max(20_000).nullable().optional();
const n = (v: number | null | undefined) => (v === undefined ? null : v);
const audit = (ctx: { db: OrrnDb; companyId: string; session: { user: { id: string } }; impersonation?: unknown }, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>) =>
  auditInsert(ctx as Parameters<typeof auditInsert>[0], { action, subjectType, subjectId, meta });

const CODE = /^[A-Z0-9-]{1,16}$/;
const INSTRUMENT_CODE = /^[A-Z0-9/-]{1,24}$/;
const ALLOY = z.string().trim().min(1).max(16).transform((v) => v.toUpperCase());

/** Instrument certificates sit in the die-files bucket under a 4-part key the purge knows (lib/dieFilesPurge.ts). */
const certSection = (instrumentId: string) => `qa-${instrumentId}`;

// ---------------------------------------------------------------------------
// Temper master (row 35)
// ---------------------------------------------------------------------------

const temperInput = z.object({
  id: id.optional(),
  code: z.string().trim().min(1).max(8).transform((v) => v.toUpperCase()),
  alloy: z.string().trim().max(16).default("").transform((v) => v.toUpperCase()),
  name: z.string().trim().max(60).nullable().optional(),
  hardnessMethod: z.enum(qaHardnessMethods).default("webster"),
  hardnessMinX10: z.number().int().min(0).max(2000).nullable().optional(),
  tensileMinMpa: z.number().int().min(0).max(2000).nullable().optional(),
  yieldMinMpa: z.number().int().min(0).max(2000).nullable().optional(),
  elongationMinX10: z.number().int().min(0).max(1000).nullable().optional(),
  active: z.boolean().default(true),
  note: z.string().trim().max(300).nullable().optional(),
});

const tempers = router({
  /** The temper list with the active ageing recipes of each code (the recipe link is by temper code). */
  list: companyProcedure.input(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false })).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(qaTemper)
      .where(and(eq(qaTemper.companyId, ctx.companyId), input.includeInactive ? undefined : eq(qaTemper.active, true)))
      .orderBy(asc(qaTemper.code), asc(qaTemper.alloy))
      .limit(200);
    const codes = [...new Set(rows.map((r) => r.code))];
    const recipes = codes.length
      ? await ctx.db
          .select({ id: ageingRecipe.id, alloy: ageingRecipe.alloy, temper: ageingRecipe.temper, kind: ageingRecipe.kind, targetTempX10: ageingRecipe.targetTempX10, soakMin: ageingRecipe.soakMin, hardnessMinX10: ageingRecipe.hardnessMinX10 })
          .from(ageingRecipe)
          .where(and(eq(ageingRecipe.companyId, ctx.companyId), eq(ageingRecipe.status, "active"), inArray(ageingRecipe.temper, codes)))
      : [];
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        alloy: r.alloy,
        name: r.name,
        hardnessMethod: r.hardnessMethod,
        hardnessMinX10: r.hardnessMinX10,
        tensileMinMpa: r.tensileMinMpa,
        yieldMinMpa: r.yieldMinMpa,
        elongationMinX10: r.elongationMinX10,
        active: r.active,
        note: r.note,
        recipes: recipes.filter((x) => x.temper === r.code && (!r.alloy || x.alloy === r.alloy)),
      })),
    };
  }),

  save: actionProcedure("qa.masters")
    .input(temperInput)
    .mutation(async ({ ctx, input }) => {
      if (!isTemperCode(input.code)) throw qaRefusal("temper_code");
      const limits = { hardnessMinX10: n(input.hardnessMinX10), tensileMinMpa: n(input.tensileMinMpa), yieldMinMpa: n(input.yieldMinMpa), elongationMinX10: n(input.elongationMinX10) };
      if (temperLimitsError(limits)) throw qaRefusal("temper_yield");
      const values = { code: input.code, alloy: input.alloy, name: input.name ?? null, hardnessMethod: input.hardnessMethod, ...limits, active: input.active, note: input.note ?? null };
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: qaTemper.id }).from(qaTemper).where(and(eq(qaTemper.companyId, ctx.companyId), eq(qaTemper.id, input.id))).limit(1);
        if (!had) throw qaRefusal("subject_not_found");
      }
      try {
        await atomicBatch(ctx.db, [
          input.id
            ? ctx.db.update(qaTemper).set(values).where(and(eq(qaTemper.companyId, ctx.companyId), eq(qaTemper.id, input.id)))
            : ctx.db.insert(qaTemper).values({ id: rowId, companyId: ctx.companyId, createdBy: ctx.session.user.id, ...values }),
          audit(ctx, "qa.temper.save", "qa_temper", rowId, { code: input.code, alloy: input.alloy, ...limits, active: input.active }),
        ]);
      } catch (e) {
        if (isQaUnique(e, "qa_temper")) throw qaRefusal("temper_taken", { code: input.alloy ? `${input.alloy} ${input.code}` : input.code });
        throw e;
      }
      return { id: rowId };
    }),
});

// ---------------------------------------------------------------------------
// Quality plan (row 28)
// ---------------------------------------------------------------------------

const planDimension = z.object({
  name: z.string().trim().min(1).max(40),
  nominalUm: z.number().int().min(1).max(MAX_DIMENSION_UM),
  minusUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
  plusUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
});

const planInput = z.object({
  dieId: id,
  dieInstanceId: id.nullable().optional(),
  temperId: id.nullable().optional(),
  billetTempMinX10: x10,
  billetTempMaxX10: x10,
  exitTempMinX10: x10,
  exitTempMaxX10: x10,
  ramSpeedMinX10: x10,
  ramSpeedMaxX10: x10,
  ageingTempX10: x10,
  ageingSoakMin: z.number().int().min(0).max(24 * 60).nullable().optional(),
  everyBundles: z.number().int().min(1).max(500).nullable().optional(),
  everyMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  dimensions: z.array(planDimension).max(MAX_DIMENSIONS + 1).default([]),
  note: z.string().trim().max(300).nullable().optional(),
});

function planOut(p: typeof qaPlan.$inferSelect) {
  return {
    id: p.id,
    dieId: p.dieId,
    dieInstanceId: p.dieInstanceId,
    temperId: p.temperId,
    billetTempMinX10: p.billetTempMinX10,
    billetTempMaxX10: p.billetTempMaxX10,
    exitTempMinX10: p.exitTempMinX10,
    exitTempMaxX10: p.exitTempMaxX10,
    ramSpeedMinX10: p.ramSpeedMinX10,
    ramSpeedMaxX10: p.ramSpeedMaxX10,
    ageingTempX10: p.ageingTempX10,
    ageingSoakMin: p.ageingSoakMin,
    everyBundles: p.everyBundles,
    everyMinutes: p.everyMinutes,
    dimensions: p.dimensionsJson,
    note: p.note,
  };
}

const plans = router({
  /** The plan in force for a section (and copy): the copy's own, else the section's. */
  get: companyProcedure.input(z.object({ dieId: id, dieInstanceId: id.nullable().optional() })).query(async ({ ctx, input }) => {
    const rows = await ctx.db.select().from(qaPlan).where(and(eq(qaPlan.companyId, ctx.companyId), eq(qaPlan.dieId, input.dieId)));
    const own = input.dieInstanceId ? rows.find((r) => r.dieInstanceId === input.dieInstanceId) : undefined;
    const section = rows.find((r) => r.dieInstanceId == null);
    const p = own ?? section ?? null;
    return { plan: p ? planOut(p) : null, fromCopy: Boolean(own) };
  }),

  list: companyProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).default({ limit: 200 })).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ plan: qaPlan, sectionCode: die.sectionCode, copyCode: dieInstance.code, temperCode: qaTemper.code })
      .from(qaPlan)
      .innerJoin(die, and(eq(die.id, qaPlan.dieId), eq(die.companyId, qaPlan.companyId)))
      .leftJoin(dieInstance, and(eq(dieInstance.id, qaPlan.dieInstanceId), eq(dieInstance.companyId, qaPlan.companyId)))
      .leftJoin(qaTemper, and(eq(qaTemper.id, qaPlan.temperId), eq(qaTemper.companyId, qaPlan.companyId)))
      .where(eq(qaPlan.companyId, ctx.companyId))
      .orderBy(asc(die.sectionCode), asc(dieInstance.code))
      .limit(input.limit);
    return { items: rows.map((r) => ({ ...planOut(r.plan), sectionCode: r.sectionCode, copyCode: r.copyCode, temperCode: r.temperCode })) };
  }),

  save: actionProcedure("qa.masters")
    .input(planInput)
    .mutation(async ({ ctx, input }) => {
      const [section] = await ctx.db.select({ id: die.id, code: die.sectionCode }).from(die).where(and(eq(die.companyId, ctx.companyId), eq(die.id, input.dieId), isNull(die.deletedAt))).limit(1);
      if (!section) throw qaRefusal("subject_not_found");
      if (input.dieInstanceId) {
        const [copy] = await ctx.db.select({ sectionId: dieInstance.sectionId }).from(dieInstance).where(and(eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.id, input.dieInstanceId))).limit(1);
        if (!copy) throw qaRefusal("subject_not_found");
        if (copy.sectionId !== section.id) throw qaRefusal("plan_copy_section");
      }
      if (input.temperId) {
        const [t] = await ctx.db.select({ id: qaTemper.id }).from(qaTemper).where(and(eq(qaTemper.companyId, ctx.companyId), eq(qaTemper.id, input.temperId))).limit(1);
        if (!t) throw qaRefusal("subject_not_found");
      }
      const limits = {
        billetTempMinX10: n(input.billetTempMinX10),
        billetTempMaxX10: n(input.billetTempMaxX10),
        exitTempMinX10: n(input.exitTempMinX10),
        exitTempMaxX10: n(input.exitTempMaxX10),
        ramSpeedMinX10: n(input.ramSpeedMinX10),
        ramSpeedMaxX10: n(input.ramSpeedMaxX10),
      };
      if (processLimitsError(limits)) throw qaRefusal("plan_limits");
      if (input.dimensions.length > 0) {
        const err = dimensionInputError(input.dimensions.map((d) => ({ ...d, measuredUm: d.nominalUm })));
        if (err) throw qaRefusal(`dimensions_${err}` as const, { n: MAX_DIMENSIONS });
      }
      const values = {
        temperId: input.temperId ?? null,
        ...limits,
        ageingTempX10: n(input.ageingTempX10),
        ageingSoakMin: n(input.ageingSoakMin),
        everyBundles: n(input.everyBundles),
        everyMinutes: n(input.everyMinutes),
        dimensionsJson: input.dimensions,
        note: input.note ?? null,
        updatedBy: ctx.session.user.id,
      };
      const copyId = input.dieInstanceId ?? null;
      const [had] = await ctx.db
        .select({ id: qaPlan.id })
        .from(qaPlan)
        .where(and(eq(qaPlan.companyId, ctx.companyId), eq(qaPlan.dieId, section.id), copyId ? eq(qaPlan.dieInstanceId, copyId) : isNull(qaPlan.dieInstanceId)))
        .limit(1);
      const planId = had?.id ?? crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          had
            ? ctx.db.update(qaPlan).set(values).where(and(eq(qaPlan.companyId, ctx.companyId), eq(qaPlan.id, had.id)))
            : ctx.db.insert(qaPlan).values({ id: planId, companyId: ctx.companyId, dieId: section.id, dieInstanceId: copyId, ...values }),
          audit(ctx, "qa.plan.save", "die", section.id, { planId, section: section.code, copyId, ...limits, dimensions: input.dimensions.length }),
        ]);
      } catch (e) {
        // Review N1: two first saves of one section at once; the other landed first.
        if (isQaUnique(e, "qa_plan")) throw qaRefusal("plan_saved_meanwhile");
        throw e;
      }
      return { id: planId };
    }),
});

// ---------------------------------------------------------------------------
// Inspection points (row 36)
// ---------------------------------------------------------------------------

const stations = router({
  list: companyProcedure.input(z.object({ stage: z.enum(qaStages).optional(), includeInactive: z.boolean().default(false) }).default({ includeInactive: false })).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(qaStation)
      .where(and(eq(qaStation.companyId, ctx.companyId), input.stage ? eq(qaStation.stage, input.stage) : undefined, input.includeInactive ? undefined : eq(qaStation.active, true)))
      .orderBy(asc(qaStation.stage), asc(qaStation.code))
      .limit(200);
    return { items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, stage: r.stage, active: r.active })) };
  }),

  save: actionProcedure("qa.masters")
    .input(z.object({ id: id.optional(), code: z.string().trim().min(1).max(16).transform((v) => v.toUpperCase()), name: z.string().trim().min(1).max(60), stage: z.enum(qaStages), active: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      if (!CODE.test(input.code)) throw qaRefusal("station_code");
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: qaStation.id }).from(qaStation).where(and(eq(qaStation.companyId, ctx.companyId), eq(qaStation.id, input.id))).limit(1);
        if (!had) throw qaRefusal("subject_not_found");
      }
      const values = { code: input.code, name: input.name, stage: input.stage, active: input.active };
      try {
        await atomicBatch(ctx.db, [
          input.id
            ? ctx.db.update(qaStation).set(values).where(and(eq(qaStation.companyId, ctx.companyId), eq(qaStation.id, input.id)))
            : ctx.db.insert(qaStation).values({ id: rowId, companyId: ctx.companyId, ...values }),
          audit(ctx, "qa.station.save", "qa_station", rowId, values),
        ]);
      } catch (e) {
        if (isQaUnique(e, "qa_station")) throw qaRefusal("station_taken", { code: input.code });
        throw e;
      }
      return { id: rowId };
    }),
});

// ---------------------------------------------------------------------------
// Alloy substitutes (row 37)
// ---------------------------------------------------------------------------

/** Billets on hand (grams) per cast alloy, for the alloys asked (BILLET ledger, any location, as /foundry/stock). */
async function billetsByAlloy(db: OrrnDb, companyId: string, alloys: readonly string[]): Promise<Map<string, number>> {
  if (alloys.length === 0) return new Map();
  const rows = await db
    .select({ alloy: cast.alloy, g: sql<number>`coalesce(sum(${stockLedger.qtyG}), 0)` })
    .from(stockLedger)
    .innerJoin(cast, and(eq(cast.id, stockLedger.itemRef), eq(cast.companyId, stockLedger.companyId)))
    .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.itemKind, "billet"), inArray(sql`upper(${cast.alloy})`, [...alloys])))
    .groupBy(cast.alloy);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.alloy.toUpperCase(), (out.get(r.alloy.toUpperCase()) ?? 0) + Number(r.g));
  return out;
}

const substitutes = router({
  list: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: qaAlloySubstitute.id, alloy: qaAlloySubstitute.alloy, substitute: qaAlloySubstitute.substitute, customerId: qaAlloySubstitute.customerId, note: qaAlloySubstitute.note, customerName: customer.name })
      .from(qaAlloySubstitute)
      .leftJoin(customer, and(eq(customer.id, qaAlloySubstitute.customerId), eq(customer.companyId, qaAlloySubstitute.companyId)))
      .where(eq(qaAlloySubstitute.companyId, ctx.companyId))
      .orderBy(asc(qaAlloySubstitute.alloy), asc(qaAlloySubstitute.substitute))
      .limit(500);
    return { items: rows };
  }),

  save: actionProcedure("qa.masters")
    .input(z.object({ alloy: ALLOY, substitute: ALLOY, customerId: id.nullable().optional(), note: z.string().trim().max(200).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.alloy === input.substitute) throw qaRefusal("substitute_same");
      if (input.customerId) {
        const [c] = await ctx.db.select({ id: customer.id }).from(customer).where(and(eq(customer.companyId, ctx.companyId), eq(customer.id, input.customerId))).limit(1);
        if (!c) throw qaRefusal("subject_not_found");
      }
      const rowId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(qaAlloySubstitute).values({ id: rowId, companyId: ctx.companyId, alloy: input.alloy, substitute: input.substitute, customerId: input.customerId ?? null, note: input.note ?? null, createdBy: ctx.session.user.id }),
          audit(ctx, "qa.substitute.save", "qa_alloy_substitute", rowId, { alloy: input.alloy, substitute: input.substitute, customerId: input.customerId ?? null }),
        ]);
      } catch (e) {
        if (isQaUnique(e, "qa_alloy_substitute")) throw qaRefusal("substitute_taken", { alloy: input.substitute });
        throw e;
      }
      return { id: rowId };
    }),

  remove: actionProcedure("qa.masters")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [had] = await ctx.db.select().from(qaAlloySubstitute).where(and(eq(qaAlloySubstitute.companyId, ctx.companyId), eq(qaAlloySubstitute.id, input.id))).limit(1);
      if (!had) throw qaRefusal("subject_not_found");
      await atomicBatch(ctx.db, [
        ctx.db.delete(qaAlloySubstitute).where(and(eq(qaAlloySubstitute.companyId, ctx.companyId), eq(qaAlloySubstitute.id, input.id))),
        audit(ctx, "qa.substitute.remove", "qa_alloy_substitute", input.id, { alloy: had.alloy, substitute: had.substitute, customerId: had.customerId }),
      ]);
      return { success: true };
    }),

  /**
   * For an order line: its alloy, the kg still to press, billets on hand of that alloy, whether it is short,
   * and the allowed substitutes with their billets on hand (the customer's own list wins over the plant's).
   */
  forLine: companyProcedure.input(z.object({ lineId: id })).query(async ({ ctx, input }) => {
    const [line] = await ctx.db
      .select({ id: salesOrderLine.id, alloy: salesOrderLine.alloy, dieId: salesOrderLine.dieId, dieAlloy: die.alloy })
      .from(salesOrderLine)
      .leftJoin(die, and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, salesOrderLine.companyId)))
      .where(and(eq(salesOrderLine.companyId, ctx.companyId), eq(salesOrderLine.id, input.lineId)))
      .limit(1);
    if (!line) throw qaRefusal("subject_not_found");
    const alloy = (line.alloy || line.dieAlloy || "").trim().toUpperCase();
    const [bal] = await lineBalances(ctx.db, ctx.companyId, { lineIds: [line.id] });
    if (!alloy || !bal) return { alloy: alloy || null, needG: 0, onHandG: 0, short: false, substitutes: [] as { alloy: string; onHandG: number; note: string | null }[] };
    const needG = Math.max(0, bal.orderedG - bal.producedG);
    const rows = await ctx.db
      .select({ alloy: qaAlloySubstitute.alloy, substitute: qaAlloySubstitute.substitute, customerId: qaAlloySubstitute.customerId, note: qaAlloySubstitute.note })
      .from(qaAlloySubstitute)
      .where(and(eq(qaAlloySubstitute.companyId, ctx.companyId), eq(qaAlloySubstitute.alloy, alloy)));
    const subs = substitutesFor(rows, alloy, bal.customerId);
    const onHand = await billetsByAlloy(ctx.db, ctx.companyId, [alloy, ...subs.map((s) => s.substitute)]);
    const onHandG = onHand.get(alloy) ?? 0;
    return {
      alloy,
      needG,
      onHandG,
      short: alloyShort({ needG, onHandG }),
      substitutes: subs.map((s) => ({ alloy: s.substitute, onHandG: onHand.get(s.substitute) ?? 0, note: s.note })),
    };
  }),
});

// ---------------------------------------------------------------------------
// Instruments and calibration (row 38)
// ---------------------------------------------------------------------------

const instrumentInput = z.object({
  id: id.optional(),
  code: z.string().trim().min(1).max(24).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(80),
  rangeText: z.string().trim().max(60).nullable().optional(),
  place: z.string().trim().max(60).nullable().optional(),
  intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  active: z.boolean().default(true),
  note: z.string().trim().max(300).nullable().optional(),
});

async function ownInstrument(db: OrrnDb, companyId: string, instrumentId: string) {
  const [row] = await db.select().from(qaInstrument).where(and(eq(qaInstrument.companyId, companyId), eq(qaInstrument.id, instrumentId))).limit(1);
  if (!row) throw qaRefusal("subject_not_found");
  return row;
}

const instruments = router({
  /** Instruments with last and next calibration and the state (ok, due soon, overdue, unknown). */
  list: companyProcedure.input(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false })).query(async ({ ctx, input }) => {
    const plant = await readQaPlant(ctx.db, ctx.companyId);
    const today = companyDay(plant.timezone, clockNow().getTime());
    const rows = await ctx.db
      .select()
      .from(qaInstrument)
      .where(and(eq(qaInstrument.companyId, ctx.companyId), input.includeInactive ? undefined : eq(qaInstrument.active, true)))
      .orderBy(asc(qaInstrument.code))
      .limit(500);
    return {
      today,
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        rangeText: r.rangeText,
        place: r.place,
        intervalDays: r.intervalDays,
        lastCalibratedOn: r.lastCalibratedOn,
        nextDueOn: r.nextDueOn,
        state: calibrationState(r.nextDueOn, today),
        hasCertificate: Boolean(r.certificateKey),
        certificateName: r.certificateName,
        active: r.active,
        note: r.note,
      })),
    };
  }),

  save: actionProcedure("qa.masters")
    .input(instrumentInput)
    .mutation(async ({ ctx, input }) => {
      if (!INSTRUMENT_CODE.test(input.code)) throw qaRefusal("instrument_code");
      const rowId = input.id ?? crypto.randomUUID();
      let nextDueOn: string | null = null;
      if (input.id) {
        const had = await ownInstrument(ctx.db, ctx.companyId, input.id);
        nextDueOn = nextCalibrationDue(had.lastCalibratedOn, n(input.intervalDays)) ?? had.nextDueOn;
      }
      const values = { code: input.code, name: input.name, rangeText: input.rangeText ?? null, place: input.place ?? null, intervalDays: n(input.intervalDays), active: input.active, note: input.note ?? null };
      try {
        await atomicBatch(ctx.db, [
          input.id
            ? ctx.db.update(qaInstrument).set({ ...values, nextDueOn }).where(and(eq(qaInstrument.companyId, ctx.companyId), eq(qaInstrument.id, input.id)))
            : ctx.db.insert(qaInstrument).values({ id: rowId, companyId: ctx.companyId, createdBy: ctx.session.user.id, ...values }),
          audit(ctx, "qa.instrument.save", "qa_instrument", rowId, values),
        ]);
      } catch (e) {
        if (isQaUnique(e, "qa_instrument")) throw qaRefusal("instrument_taken", { code: input.code });
        throw e;
      }
      return { id: rowId };
    }),

  /** Record a calibration: the day it was done sets the last date, the interval sets the next due day. */
  calibrate: actionProcedure("qa.check")
    .input(z.object({ id, calibratedOn: ymd, intervalDays: z.number().int().min(1).max(3650).nullable().optional(), note: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const had = await ownInstrument(ctx.db, ctx.companyId, input.id);
      const plant = await readQaPlant(ctx.db, ctx.companyId);
      if (input.calibratedOn > companyDay(plant.timezone, clockNow().getTime())) throw qaRefusal("calibration_future");
      const intervalDays = input.intervalDays === undefined ? had.intervalDays : input.intervalDays;
      const nextDueOn = nextCalibrationDue(input.calibratedOn, intervalDays);
      await atomicBatch(ctx.db, [
        ctx.db.update(qaInstrument).set({ lastCalibratedOn: input.calibratedOn, nextDueOn, intervalDays }).where(and(eq(qaInstrument.companyId, ctx.companyId), eq(qaInstrument.id, had.id))),
        audit(ctx, "qa.instrument.calibrate", "qa_instrument", had.id, { code: had.code, calibratedOn: input.calibratedOn, nextDueOn, note: input.note ?? null }),
      ]);
      return { lastCalibratedOn: input.calibratedOn, nextDueOn };
    }),

  /** Step 1 of a certificate upload (PDF or photo): a signed PUT into the die-files bucket, as die files do. */
  beginCertificate: actionProcedure("qa.check")
    .input(z.object({ id, name: z.string().trim().min(1).max(200), size: z.number().int().min(0).max(DIE_FILE_LIMITS.pdf + 1), mime: z.string().max(100).default("") }))
    .mutation(async ({ ctx, input }) => {
      const had = await ownInstrument(ctx.db, ctx.companyId, input.id);
      const kind = dieFileKindOfName(input.name);
      if (kind !== "pdf" && kind !== "image") throw qaRefusal("certificate_kind");
      const contentType = checkDieFile(kind, { filename: input.name, contentType: input.mime, bytes: input.size });
      dieFilesBucket();
      const fileId = crypto.randomUUID();
      const expiresAt = clockNow().getTime() + DIE_FILE_UPLOAD_TTL_MS;
      const ticket: DieUploadTicket = {
        v: 1,
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        sectionId: certSection(had.id),
        dieInstanceId: null,
        fileId,
        kind,
        name: input.name,
        size: input.size,
        contentType,
        pressDrawing: false,
        exp: expiresAt,
      };
      const uploadId = await signUploadTicket(ticket);
      return { uploadId, uploadUrl: dieFileUploadUrl(ctx, uploadId), method: "PUT" as const, headers: { "content-type": contentType }, expiresAt };
    }),

  /** Step 3: after the PUT, the certificate becomes the instrument's (the object must be there, whole). */
  commitCertificate: actionProcedure("qa.check")
    .input(z.object({ id, uploadId: z.string().min(1).max(4100) }))
    .mutation(async ({ ctx, input }) => {
      const had = await ownInstrument(ctx.db, ctx.companyId, input.id);
      const ticket = await readUploadTicket(input.uploadId, clockNow().getTime(), DIE_FILE_COMMIT_GRACE_MS);
      if (!ticket || ticket.companyId !== ctx.companyId || ticket.userId !== ctx.session.user.id || ticket.sectionId !== certSection(had.id)) {
        throw qaRefusal("subject_not_found");
      }
      const bucket = dieFilesBucket();
      const key = ticketKey(ticket);
      const head = await bucket.head(key);
      if (!head || head.size !== ticket.size) {
        if (head) await bucket.delete(key).catch(() => undefined);
        throw qaRefusal("subject_not_found");
      }
      await atomicBatch(ctx.db, [
        ctx.db.update(qaInstrument).set({ certificateKey: key, certificateName: ticket.name }).where(and(eq(qaInstrument.companyId, ctx.companyId), eq(qaInstrument.id, had.id))),
        audit(ctx, "qa.instrument.certificate", "qa_instrument", had.id, { code: had.code, name: ticket.name, bytes: head.size }),
      ]);
      return { success: true };
    }),

  /** A 10-minute signed link to the certificate (any member). */
  certificateUrl: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const had = await ownInstrument(ctx.db, ctx.companyId, input.id);
    if (!had.certificateKey) throw qaRefusal("subject_not_found");
    return signDieFileUrl(ctx, ctx.companyId, had.certificateKey);
  }),
});

/** Spread into `qaRouter` (routers/qa.ts). */
export const qaMastersRouter = { tempers, plans, stations, substitutes, instruments };
