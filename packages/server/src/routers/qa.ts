/**
 * Quality (XE parity lane QA, migration 0055_xe_qa). One table of checks (`qa_check`) covers incoming
 * inspection of lots and bought-in material (row 22), QA clearance for the next stage (23), the first
 * piece (24), dimensions (25), mechanical tests (26), ultrasonic tests (27) and in-process checks (39).
 * Each register is `checks.list` filtered by kind. The quality hold (29) is `qa_hold`; masters (temper,
 * quality plan, inspection points, alloy substitutes, instruments) are in `qaMasters.ts`.
 *
 * Module `qa` gates every mutation here (ROUTER_MODULE); reads are open to members like every other
 * module. The server computes every verdict: the client sends readings, never a dimension or mechanical
 * result. Refusals come from `lib/qaRefusals.ts`.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { ageingBatch, ageingHardness, ageingRow } from "@orrn/db/schema/ageing";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { cast } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { pressRun } from "@orrn/db/schema/press";
import { pressRunCollector } from "@orrn/db/schema/collector";
import { purchaseLot } from "@orrn/db/schema/purchase";
import { qaCheck, qaHold, qaInstrument, qaPlace, qaPlan, qaStation, qaTemper, qaCheckKinds, qaStages, qaSubjectTypes, type QaCheckFlags } from "@orrn/db/schema/qa";
import { storeTxn } from "@orrn/db/schema/store";
import { company } from "@orrn/db/schema/tenant";
import {
  applyQaSettingsEdit,
  calibrationState,
  dimensionInputError,
  dimensionVerdict,
  inProcessDue,
  inspectionState,
  kindAllowsSubject,
  MAX_DIMENSIONS,
  MAX_DIMENSION_UM,
  mechanicalVerdict,
  planBreaches,
  QA_EVERY_BUNDLES_MAX,
  QA_EVERY_MINUTES_MAX,
  type QaResult,
  type QaSubjectType,
  type TemperLimits,
} from "@orrn/domain";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, mapInChunks } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { companyDay, isQaUnique, latestResults, openHolds, readQaPlant } from "../lib/qa";
import { qaRefusal } from "../lib/qaRefusals";
import { qaMastersRouter } from "./qaMasters";

const id = z.string().trim().min(1).max(64);
const note = z.string().trim().max(500).optional();
const optInt = (max: number) => z.number().int().min(0).max(max).nullable().optional();

const dimensionInput = z.object({
  name: z.string().trim().min(1).max(40),
  nominalUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
  minusUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
  plusUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
  measuredUm: z.number().int().min(0).max(MAX_DIMENSION_UM),
});

/** A typed reading of a first-piece or in-process check: a name and what was seen (free text). */
const readingInput = z.object({ name: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(40) });

const recordInput = z.object({
  kind: z.enum(qaCheckKinds),
  subjectType: z.enum(qaSubjectTypes),
  subjectId: id,
  /** Pass or fail for kinds the person judges (incoming, first piece, in process, clearance, ultrasonic). */
  result: z.enum(["pass", "fail"]).optional(),
  stage: z.enum(qaStages).optional(),
  stationId: id.optional(),
  instrumentId: id.optional(),
  temperId: id.optional(),
  dimensions: z.array(dimensionInput).max(MAX_DIMENSIONS + 1).optional(),
  mechanical: z
    .object({
      tensileMpa: optInt(2000),
      yieldMpa: optInt(2000),
      elongationX10: optInt(1000),
      hardnessX10: optInt(2000),
    })
    .optional(),
  readings: z.array(readingInput).max(20).optional(),
  standard: z.string().trim().max(80).optional(),
  operatorName: z.string().trim().max(80).optional(),
  note,
});

type Subject = {
  number: string;
  pressRunId: string | null;
  bundleId: string | null;
  dieId: string | null;
  dieInstanceId: string | null;
  lotId: string | null;
  castId: string | null;
  ageingBatchId: string | null;
};

/** Load the subject of a check, scoped by company; NOT_FOUND ("Not found") for another plant's row. */
async function loadSubject(db: Parameters<typeof readQaPlant>[0], companyId: string, type: QaSubjectType, subjectId: string): Promise<Subject> {
  const none: Subject = { number: "", pressRunId: null, bundleId: null, dieId: null, dieInstanceId: null, lotId: null, castId: null, ageingBatchId: null };
  if (type === "press_run") {
    const [r] = await db
      .select({ number: pressRun.number, dieId: pressRun.sectionId, dieInstanceId: pressRun.dieInstanceId, castId: pressRun.castId })
      .from(pressRun)
      .where(and(eq(pressRun.companyId, companyId), eq(pressRun.id, subjectId)))
      .limit(1);
    if (r) return { ...none, number: r.number, pressRunId: subjectId, dieId: r.dieId, dieInstanceId: r.dieInstanceId, castId: r.castId };
  } else if (type === "bundle") {
    const [b] = await db
      .select({ serial: bundle.serial, dieId: bundle.dieId, dieInstanceId: bundle.dieInstanceId, castId: bundle.castId, ageingRowId: bundle.ageingRowId })
      .from(bundle)
      .where(and(eq(bundle.companyId, companyId), eq(bundle.id, subjectId)))
      .limit(1);
    if (b) {
      let ageingBatchId: string | null = null;
      if (b.ageingRowId) {
        const [row] = await db.select({ batchId: ageingRow.batchId }).from(ageingRow).where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.id, b.ageingRowId))).limit(1);
        ageingBatchId = row?.batchId ?? null;
      }
      return { ...none, number: b.serial, bundleId: subjectId, dieId: b.dieId, dieInstanceId: b.dieInstanceId, castId: b.castId, ageingBatchId };
    }
  } else if (type === "purchase_lot") {
    const [l] = await db.select({ number: purchaseLot.number }).from(purchaseLot).where(and(eq(purchaseLot.companyId, companyId), eq(purchaseLot.id, subjectId))).limit(1);
    if (l) return { ...none, number: l.number, lotId: subjectId };
  } else if (type === "store_grn") {
    const [g] = await db
      .select({ number: storeTxn.number })
      .from(storeTxn)
      .where(and(eq(storeTxn.companyId, companyId), eq(storeTxn.id, subjectId), eq(storeTxn.kind, "grn")))
      .limit(1);
    if (g) return { ...none, number: g.number };
  } else if (type === "cast") {
    const [c] = await db.select({ number: cast.number }).from(cast).where(and(eq(cast.companyId, companyId), eq(cast.id, subjectId))).limit(1);
    if (c) return { ...none, number: c.number, castId: subjectId };
  } else if (type === "ageing_batch") {
    const [a] = await db.select({ number: ageingBatch.number }).from(ageingBatch).where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.id, subjectId))).limit(1);
    if (a) return { ...none, number: a.number, ageingBatchId: subjectId };
  }
  throw qaRefusal("subject_not_found");
}

/** The temper limits a mechanical check reads: the one picked, else the section's quality plan temper. */
async function temperFor(db: Parameters<typeof readQaPlant>[0], companyId: string, temperId: string | undefined, s: Subject): Promise<{ id: string; limits: TemperLimits } | null> {
  let tid = temperId ?? null;
  if (!tid && s.dieId) {
    const plans = await db
      .select({ temperId: qaPlan.temperId, dieInstanceId: qaPlan.dieInstanceId })
      .from(qaPlan)
      .where(and(eq(qaPlan.companyId, companyId), eq(qaPlan.dieId, s.dieId)));
    const own = plans.find((p) => p.dieInstanceId && p.dieInstanceId === s.dieInstanceId) ?? plans.find((p) => p.dieInstanceId == null);
    tid = own?.temperId ?? null;
  }
  if (!tid) return null;
  const [t] = await db.select().from(qaTemper).where(and(eq(qaTemper.companyId, companyId), eq(qaTemper.id, tid))).limit(1);
  if (!t) throw qaRefusal("subject_not_found");
  return { id: t.id, limits: { hardnessMinX10: t.hardnessMinX10, tensileMinMpa: t.tensileMinMpa, yieldMinMpa: t.yieldMinMpa, elongationMinX10: t.elongationMinX10 } };
}

/** Row 26: hardness already exists at ageing. The lowest deciding sample of the batch, when none was typed. */
async function ageingHardnessX10(db: Parameters<typeof readQaPlant>[0], companyId: string, batchId: string | null): Promise<number | null> {
  if (!batchId) return null;
  const [h] = await db
    .select({ min: sql<number | null>`min(${ageingHardness.readingX10})` })
    .from(ageingHardness)
    .where(and(eq(ageingHardness.companyId, companyId), eq(ageingHardness.batchId, batchId), sql`${ageingHardness.pass} is not null`));
  return h?.min == null ? null : Number(h.min);
}

async function assertOwnRow(db: Parameters<typeof readQaPlant>[0], companyId: string, table: typeof qaStation | typeof qaInstrument, rowId: string | undefined) {
  if (!rowId) return;
  const [r] = await db.select({ id: table.id }).from(table).where(and(eq(table.companyId, companyId), eq(table.id, rowId))).limit(1);
  if (!r) throw qaRefusal("subject_not_found");
}

const PAGE = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.number().int().min(0).optional() });

/** Names of users by id (one query). */
async function userNames(db: Parameters<typeof readQaPlant>[0], ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const rows = await mapInChunks(unique, (part) => db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, part)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const checksRouter = router({
  /** Record one check. Dimensions and mechanical results are computed here; other kinds take `result`. */
  record: actionProcedure("qa.check")
    .input(recordInput)
    .mutation(async ({ ctx, input }) => {
      if (!kindAllowsSubject(input.kind, input.subjectType)) throw qaRefusal("kind_subject");
      const subject = await loadSubject(ctx.db, ctx.companyId, input.subjectType, input.subjectId);
      await assertOwnRow(ctx.db, ctx.companyId, qaStation, input.stationId);
      await assertOwnRow(ctx.db, ctx.companyId, qaInstrument, input.instrumentId);

      let result: QaResult;
      let values: Record<string, unknown> = {};
      let flags: QaCheckFlags = {};
      let temperId: string | null = null;
      if (input.kind === "dimension") {
        const rows = input.dimensions ?? [];
        const err = dimensionInputError(rows);
        if (err) throw qaRefusal(`dimensions_${err}` as const, { n: MAX_DIMENSIONS });
        const v = dimensionVerdict(rows);
        result = v.result;
        values = { dimensions: v.rows };
        flags = { flagged: v.flagged };
      } else if (input.kind === "mechanical") {
        const m = input.mechanical ?? {};
        const typed = { tensileMpa: m.tensileMpa ?? null, yieldMpa: m.yieldMpa ?? null, elongationX10: m.elongationX10 ?? null, hardnessX10: m.hardnessX10 ?? null };
        const fromAgeing = typed.hardnessX10 == null ? await ageingHardnessX10(ctx.db, ctx.companyId, subject.ageingBatchId) : null;
        const mech = { ...typed, hardnessX10: typed.hardnessX10 ?? fromAgeing };
        if (Object.values(mech).every((x) => x == null)) throw qaRefusal("mechanical_none");
        const temper = await temperFor(ctx.db, ctx.companyId, input.temperId, subject);
        temperId = temper?.id ?? null;
        const v = mechanicalVerdict(mech, temper?.limits ?? null);
        result = v.result;
        values = { ...mech, hardnessFromAgeing: fromAgeing != null, limits: temper?.limits ?? null };
        flags = { low: v.low, missing: v.missing };
      } else {
        if (!input.result) throw qaRefusal("result_needed");
        result = input.result;
        values = { readings: input.readings ?? [] };
      }

      const checkId = crypto.randomUUID();
      const at = clockNow();
      await atomicBatch(ctx.db, [
        ctx.db.insert(qaCheck).values({
          id: checkId,
          companyId: ctx.companyId,
          kind: input.kind,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          pressRunId: subject.pressRunId,
          bundleId: subject.bundleId,
          dieId: subject.dieId,
          dieInstanceId: subject.dieInstanceId,
          lotId: subject.lotId,
          castId: subject.castId,
          ageingBatchId: subject.ageingBatchId,
          subjectNumber: subject.number,
          stage: input.kind === "clearance" ? (input.stage ?? null) : null,
          stationId: input.stationId ?? null,
          instrumentId: input.instrumentId ?? null,
          temperId,
          result,
          valuesJson: values,
          flagsJson: flags,
          standard: input.kind === "ultrasonic" ? (input.standard ?? null) : null,
          operatorName: input.operatorName ?? null,
          note: input.note ?? null,
          checkedBy: ctx.session.user.id,
          checkedAt: at,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          { action: "qa.check.record", subjectType: "qa_check", subjectId: checkId, meta: { kind: input.kind, subjectType: input.subjectType, subjectId: input.subjectId, number: subject.number, result, ...(flags.flagged?.length ? { flagged: flags.flagged } : {}), ...(flags.low?.length ? { low: flags.low } : {}) } },
        ),
      ]);
      return { id: checkId, result, flags, values };
    }),

  /**
   * The registers: checks newest first, filtered by kind (incoming, first piece, ...), subject, run,
   * bundle, stage or result. Offset pages (`cursor` = next offset).
   */
  list: companyProcedure
    .input(
      PAGE.extend({
        kind: z.enum(qaCheckKinds).optional(),
        subjectType: z.enum(qaSubjectTypes).optional(),
        subjectId: id.optional(),
        pressRunId: id.optional(),
        bundleId: id.optional(),
        stage: z.enum(qaStages).optional(),
        result: z.enum(["pass", "fail"]).optional(),
      }).default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const offset = input.cursor ?? 0;
      const rows = await ctx.db
        .select()
        .from(qaCheck)
        .where(
          and(
            eq(qaCheck.companyId, ctx.companyId),
            input.kind ? eq(qaCheck.kind, input.kind) : undefined,
            input.subjectType ? eq(qaCheck.subjectType, input.subjectType) : undefined,
            input.subjectId ? eq(qaCheck.subjectId, input.subjectId) : undefined,
            input.pressRunId ? eq(qaCheck.pressRunId, input.pressRunId) : undefined,
            input.bundleId ? eq(qaCheck.bundleId, input.bundleId) : undefined,
            input.stage ? eq(qaCheck.stage, input.stage) : undefined,
            input.result ? eq(qaCheck.result, input.result) : undefined,
          ),
        )
        .orderBy(desc(qaCheck.checkedAt), desc(qaCheck.id))
        .limit(input.limit + 1)
        .offset(offset);
      const page = rows.slice(0, input.limit);
      const names = await userNames(ctx.db, page.map((r) => r.checkedBy));
      const stationIds = [...new Set(page.map((r) => r.stationId).filter((x): x is string => Boolean(x)))];
      const stations = stationIds.length
        ? await ctx.db.select({ id: qaStation.id, code: qaStation.code }).from(qaStation).where(and(eq(qaStation.companyId, ctx.companyId), inArray(qaStation.id, stationIds)))
        : [];
      const stationCode = new Map(stations.map((s) => [s.id, s.code]));
      return {
        items: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          subjectNumber: r.subjectNumber,
          pressRunId: r.pressRunId,
          bundleId: r.bundleId,
          stage: r.stage,
          station: r.stationId ? (stationCode.get(r.stationId) ?? null) : null,
          result: r.result,
          values: r.valuesJson,
          flags: r.flagsJson,
          standard: r.standard,
          operatorName: r.operatorName,
          note: r.note,
          checkedBy: r.checkedBy ? (names.get(r.checkedBy) ?? null) : null,
          checkedAt: r.checkedAt.getTime(),
        })),
        nextCursor: rows.length > input.limit ? offset + input.limit : null,
      };
    }),
});

const holdInput = z.object({ bundleId: id.optional(), serial: z.string().trim().min(1).max(64).optional(), reason: z.string().trim().min(1).max(300), checkId: id.optional() });

const holdsRouter = router({
  /** Row 29: put a bundle in stock on quality hold. The dispatch scan then refuses it until released. */
  hold: actionProcedure("qa.hold")
    .input(holdInput.refine((v) => Boolean(v.bundleId || v.serial), { message: "Pick a bundle", path: ["bundleId"] }))
    .mutation(async ({ ctx, input }) => {
      const [b] = await ctx.db
        .select({ id: bundle.id, serial: bundle.serial, status: bundle.status })
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), input.bundleId ? eq(bundle.id, input.bundleId) : eq(bundle.serial, input.serial!.toUpperCase())))
        .limit(1);
      if (!b) throw qaRefusal("subject_not_found");
      if (b.status === "reserved") throw qaRefusal("bundle_on_load", { serial: b.serial });
      if (b.status !== "available") throw qaRefusal("bundle_not_in_stock", { serial: b.serial });
      if (input.checkId) {
        const [c] = await ctx.db.select({ id: qaCheck.id }).from(qaCheck).where(and(eq(qaCheck.companyId, ctx.companyId), eq(qaCheck.id, input.checkId))).limit(1);
        if (!c) throw qaRefusal("subject_not_found");
      }
      const holdId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(qaHold).values({ id: holdId, companyId: ctx.companyId, bundleId: b.id, reason: input.reason, checkId: input.checkId ?? null, heldBy: ctx.session.user.id, heldAt: clockNow() }),
          auditInsert(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            { action: "qa.hold", subjectType: "bundle", subjectId: b.id, meta: { serial: b.serial, reason: input.reason, holdId } },
          ),
        ]);
      } catch (e) {
        if (isQaUnique(e, "qa_hold")) throw qaRefusal("already_on_hold", { serial: b.serial });
        throw e;
      }
      return { id: holdId, bundleId: b.id, serial: b.serial };
    }),

  /** Release a quality hold, with a note (`qa.release`). The row stays as the hold log. */
  release: actionProcedure("qa.release")
    .input(z.object({ bundleId: id, note: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [b] = await ctx.db.select({ id: bundle.id, serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.id, input.bundleId))).limit(1);
      if (!b) throw qaRefusal("subject_not_found");
      const [open] = await ctx.db
        .select({ id: qaHold.id })
        .from(qaHold)
        .where(and(eq(qaHold.companyId, ctx.companyId), eq(qaHold.bundleId, b.id), isNull(qaHold.releasedAt)))
        .limit(1);
      if (!open) throw qaRefusal("not_on_hold", { serial: b.serial });
      const at = clockNow();
      const me = ctx.session.user.id;
      await atomicBatch(ctx.db, [
        ctx.db
          .update(qaHold)
          .set({ releasedAt: at, releasedBy: me, releaseNote: input.note })
          .where(and(eq(qaHold.companyId, ctx.companyId), eq(qaHold.id, open.id), isNull(qaHold.releasedAt))),
        // Written only when this release landed (a second release racing it writes nothing).
        auditInsertGuarded(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          { action: "qa.release", subjectType: "bundle", subjectId: b.id, meta: { serial: b.serial, note: input.note, holdId: open.id } },
          { from: qaHold, where: and(eq(qaHold.id, open.id), eq(qaHold.releasedBy, me), eq(qaHold.releasedAt, at)) },
        ),
      ]);
      const [after] = await ctx.db.select({ releasedAt: qaHold.releasedAt, releasedBy: qaHold.releasedBy }).from(qaHold).where(and(eq(qaHold.companyId, ctx.companyId), eq(qaHold.id, open.id))).limit(1);
      if (after?.releasedBy !== me || after.releasedAt?.getTime() !== at.getTime()) throw qaRefusal("not_on_hold", { serial: b.serial });
      return { id: open.id };
    }),

  /** "On quality hold" (open) and the hold log (all), newest first. */
  list: companyProcedure
    .input(PAGE.extend({ open: z.boolean().default(true), bundleId: id.optional() }).default({ limit: 50, open: true }))
    .query(async ({ ctx, input }) => {
      const offset = input.cursor ?? 0;
      const rows = await ctx.db
        .select({
          id: qaHold.id,
          bundleId: qaHold.bundleId,
          reason: qaHold.reason,
          heldBy: qaHold.heldBy,
          heldAt: qaHold.heldAt,
          releasedBy: qaHold.releasedBy,
          releasedAt: qaHold.releasedAt,
          releaseNote: qaHold.releaseNote,
          serial: bundle.serial,
          weightG: bundle.weightG,
          status: bundle.status,
          sectionCode: die.sectionCode,
        })
        .from(qaHold)
        .innerJoin(bundle, and(eq(bundle.id, qaHold.bundleId), eq(bundle.companyId, qaHold.companyId)))
        .leftJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(and(eq(qaHold.companyId, ctx.companyId), input.open ? isNull(qaHold.releasedAt) : undefined, input.bundleId ? eq(qaHold.bundleId, input.bundleId) : undefined))
        .orderBy(desc(qaHold.heldAt), desc(qaHold.id))
        .limit(input.limit + 1)
        .offset(offset);
      const page = rows.slice(0, input.limit);
      const names = await userNames(ctx.db, page.flatMap((r) => [r.heldBy, r.releasedBy]));
      return {
        items: page.map((r) => ({
          id: r.id,
          bundleId: r.bundleId,
          serial: r.serial,
          sectionCode: r.sectionCode,
          weightG: r.weightG,
          bundleStatus: r.status,
          reason: r.reason,
          heldBy: r.heldBy ? (names.get(r.heldBy) ?? null) : null,
          heldAt: r.heldAt.getTime(),
          releasedBy: r.releasedBy ? (names.get(r.releasedBy) ?? null) : null,
          releasedAt: r.releasedAt ? r.releasedAt.getTime() : null,
          releaseNote: r.releaseNote,
        })),
        nextCursor: rows.length > input.limit ? offset + input.limit : null,
      };
    }),

  /** The open hold of one bundle, for the bundle page. */
  forBundle: companyProcedure.input(z.object({ bundleId: id })).query(async ({ ctx, input }) => {
    const held = await openHolds(ctx.db, ctx.companyId, [input.bundleId]);
    const h = held.get(input.bundleId);
    return h ? { id: h.id, reason: h.reason, heldAt: h.heldAt.getTime() } : null;
  }),
});

/** Ageing batches waiting for the QC verdict (row 23 reads the ageing release as a clearance). */
const AGEING_WAITING = ["out"] as const;
const RUN_WAITING = ["running", "stopped", "counting"] as const;

const waitingRouter = router({
  /**
   * Row 36: what waits for a check at one stage, with the inspection point each item sits at.
   * incoming = scrap lots without a passed inspection; press = runs on the press without a passed first
   * piece; ageing = batches out of the oven waiting for release; pack = runs logged in the last 3 days
   * without a clearance for pack. At most 100 per stage, newest first.
   */
  list: companyProcedure
    .input(z.object({ stage: z.enum(qaStages), stationId: id.optional() }))
    .query(async ({ ctx, input }) => {
      const plant = await readQaPlant(ctx.db, ctx.companyId);
      type Item = { subjectType: QaSubjectType; subjectId: string; number: string; since: number | null; state: "waiting" | "failed" };
      let items: Item[] = [];
      if (input.stage === "incoming") {
        const since = plant.settings.lotInspectionSince;
        const lots = await ctx.db
          .select({ id: purchaseLot.id, number: purchaseLot.number, lotDate: purchaseLot.lotDate, createdAt: purchaseLot.createdAt })
          .from(purchaseLot)
          .where(and(eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.status, ["unload", "ok"]), since ? gte(purchaseLot.lotDate, since) : undefined))
          .orderBy(desc(purchaseLot.lotDate), desc(purchaseLot.createdAt))
          .limit(300);
        const latest = await latestResults(ctx.db, ctx.companyId, "incoming", "purchase_lot", lots.map((l) => l.id));
        items = lots
          .map((l) => ({ l, state: inspectionState(latest.get(l.id)?.result ?? null) }))
          .filter((x) => x.state !== "passed")
          .map(({ l, state }) => ({ subjectType: "purchase_lot" as const, subjectId: l.id, number: l.number, since: l.createdAt ? l.createdAt.getTime() : null, state: state as "waiting" | "failed" }));
      } else if (input.stage === "press") {
        const runs = await ctx.db
          .select({ id: pressRun.id, number: pressRun.number, startedAt: pressRun.startedAt })
          .from(pressRun)
          .where(and(eq(pressRun.companyId, ctx.companyId), inArray(pressRun.status, [...RUN_WAITING])))
          .orderBy(desc(pressRun.startedAt))
          .limit(200);
        const latest = await latestResults(ctx.db, ctx.companyId, "first_piece", "press_run", runs.map((r) => r.id));
        items = runs
          .map((r) => ({ r, state: inspectionState(latest.get(r.id)?.result ?? null) }))
          .filter((x) => x.state !== "passed")
          .map(({ r, state }) => ({ subjectType: "press_run" as const, subjectId: r.id, number: r.number, since: r.startedAt ? r.startedAt.getTime() : null, state: state as "waiting" | "failed" }));
      } else if (input.stage === "ageing") {
        const batches = await ctx.db
          .select({ id: ageingBatch.id, number: ageingBatch.number, outAt: ageingBatch.outAt })
          .from(ageingBatch)
          .where(and(eq(ageingBatch.companyId, ctx.companyId), inArray(ageingBatch.status, [...AGEING_WAITING])))
          .orderBy(desc(ageingBatch.outAt))
          .limit(200);
        items = batches.map((b) => ({ subjectType: "ageing_batch" as const, subjectId: b.id, number: b.number, since: b.outAt ? b.outAt.getTime() : null, state: "waiting" as const }));
      } else if (input.stage === "pack") {
        const from = new Date(clockNow().getTime() - 3 * 86_400_000);
        const runs = await ctx.db
          .select({ id: pressRun.id, number: pressRun.number, stoppedAt: pressRun.stoppedAt })
          .from(pressRun)
          .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.status, "logged"), gte(pressRun.stoppedAt, from)))
          .orderBy(desc(pressRun.stoppedAt))
          .limit(200);
        const latest = await latestResults(ctx.db, ctx.companyId, "clearance", "press_run", runs.map((r) => r.id));
        items = runs
          .map((r) => ({ r, state: inspectionState(latest.get(r.id)?.result ?? null) }))
          .filter((x) => x.state !== "passed")
          .map(({ r, state }) => ({ subjectType: "press_run" as const, subjectId: r.id, number: r.number, since: r.stoppedAt ? r.stoppedAt.getTime() : null, state: state as "waiting" | "failed" }));
      }
      // dispatch: the hold list is the queue (holds.list); nothing else waits there.
      items = items.slice(0, 100);
      const places = items.length
        ? await mapInChunks(
            items.map((i) => i.subjectId),
            (part) =>
              ctx.db
                .select({ subjectId: qaPlace.subjectId, stationId: qaPlace.stationId, code: qaStation.code, name: qaStation.name })
                .from(qaPlace)
                .innerJoin(qaStation, and(eq(qaStation.id, qaPlace.stationId), eq(qaStation.companyId, qaPlace.companyId)))
                .where(and(eq(qaPlace.companyId, ctx.companyId), inArray(qaPlace.subjectId, part))),
          )
        : [];
      const placeOf = new Map(places.map((p) => [p.subjectId, { id: p.stationId, code: p.code, name: p.name }]));
      const withPlace = items.map((i) => ({ ...i, station: placeOf.get(i.subjectId) ?? null }));
      return { items: input.stationId ? withPlace.filter((i) => i.station?.id === input.stationId) : withPlace };
    }),

  /** Put a waiting lot or run at an inspection point (row 36). Moving it again rewrites its place. */
  place: actionProcedure("qa.check")
    .input(z.object({ subjectType: z.enum(qaSubjectTypes), subjectId: id, stationId: id }))
    .mutation(async ({ ctx, input }) => {
      const subject = await loadSubject(ctx.db, ctx.companyId, input.subjectType, input.subjectId);
      const [st] = await ctx.db.select({ id: qaStation.id, code: qaStation.code }).from(qaStation).where(and(eq(qaStation.companyId, ctx.companyId), eq(qaStation.id, input.stationId), eq(qaStation.active, true))).limit(1);
      if (!st) throw qaRefusal("subject_not_found");
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(qaPlace)
          .values({ id: crypto.randomUUID(), companyId: ctx.companyId, subjectType: input.subjectType, subjectId: input.subjectId, stationId: st.id, placedBy: ctx.session.user.id, placedAt: clockNow() })
          .onConflictDoUpdate({ target: [qaPlace.companyId, qaPlace.subjectType, qaPlace.subjectId], set: { stationId: st.id, placedBy: ctx.session.user.id, placedAt: clockNow() } }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          { action: "qa.place", subjectType: input.subjectType, subjectId: input.subjectId, meta: { number: subject.number, station: st.code } },
        ),
      ]);
      return { success: true };
    }),
});

const settingsInput = z.object({
  firstPieceBlocksPack: z.boolean().optional(),
  requireLotInspection: z.boolean().optional(),
  inProcessEveryBundles: z.number().int().min(1).max(QA_EVERY_BUNDLES_MAX).nullable().optional(),
  inProcessEveryMinutes: z.number().int().min(1).max(QA_EVERY_MINUTES_MAX).nullable().optional(),
});

/** The run a check belongs to, with its first piece, in-process checks and plan flags (rows 24, 28, 39). */
async function runQuality(ctx: { db: Parameters<typeof readQaPlant>[0]; companyId: string }, runId: string) {
  const [run] = await ctx.db
    .select({ id: pressRun.id, number: pressRun.number, status: pressRun.status, sectionId: pressRun.sectionId, dieInstanceId: pressRun.dieInstanceId, startedAt: pressRun.startedAt, stoppedAt: pressRun.stoppedAt })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.id, runId)))
    .limit(1);
  if (!run) throw qaRefusal("subject_not_found");
  const plant = await readQaPlant(ctx.db, ctx.companyId);
  const checks = await ctx.db
    .select({ id: qaCheck.id, kind: qaCheck.kind, result: qaCheck.result, checkedAt: qaCheck.checkedAt, flags: qaCheck.flagsJson })
    .from(qaCheck)
    .where(and(eq(qaCheck.companyId, ctx.companyId), eq(qaCheck.pressRunId, run.id)))
    .orderBy(desc(qaCheck.checkedAt))
    .limit(200);
  const firstPiece = checks.find((c) => c.kind === "first_piece") ?? null;
  const inProcess = checks.filter((c) => c.kind === "in_process");

  // The plan: the copy's own, else the section's (row 28).
  const plans = await ctx.db.select().from(qaPlan).where(and(eq(qaPlan.companyId, ctx.companyId), eq(qaPlan.dieId, run.sectionId)));
  const plan = plans.find((p) => p.dieInstanceId && p.dieInstanceId === run.dieInstanceId) ?? plans.find((p) => p.dieInstanceId == null) ?? null;
  const [readings] = await ctx.db
    .select({ billetTempAvgX10: pressRunCollector.billetTempAvgX10, exitTempMaxX10: pressRunCollector.exitTempMaxX10, ramSpeedAvgX10: pressRunCollector.ramSpeedAvgX10, ramSpeedMaxX10: pressRunCollector.ramSpeedMaxX10 })
    .from(pressRunCollector)
    .where(and(eq(pressRunCollector.companyId, ctx.companyId), eq(pressRunCollector.pressRunId, run.id)))
    .limit(1);
  const breaches = plan && readings ? planBreaches(plan, readings) : [];

  // Row 39: bundles packed on this copy since the last check (or the first piece), minutes since then.
  const lastAt = (inProcess[0] ?? firstPiece)?.checkedAt ?? run.startedAt ?? null;
  let bundlesSince = 0;
  if (run.dieInstanceId && lastAt) {
    const until = run.stoppedAt && run.status === "logged" ? run.stoppedAt : null;
    const [n] = await ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(bundle)
      .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.dieInstanceId, run.dieInstanceId), gte(bundle.createdAt, lastAt), until ? lt(bundle.createdAt, until) : undefined, sql`${bundle.status} <> 'void'`));
    bundlesSince = Number(n?.n ?? 0);
  }
  const everyBundles = plan?.everyBundles ?? plant.settings.inProcessEveryBundles;
  const everyMinutes = plan?.everyMinutes ?? plant.settings.inProcessEveryMinutes;
  const live = (RUN_WAITING as readonly string[]).includes(run.status);
  const due = live && lastAt ? inProcessDue({ everyBundles, everyMinutes, bundlesSinceLast: bundlesSince, minutesSinceLast: Math.floor((clockNow().getTime() - lastAt.getTime()) / 60_000) }) : { due: false, reason: null };
  return {
    run: { id: run.id, number: run.number, status: run.status, sectionId: run.sectionId, dieInstanceId: run.dieInstanceId },
    firstPiece: firstPiece ? { id: firstPiece.id, result: firstPiece.result, checkedAt: firstPiece.checkedAt.getTime() } : null,
    firstPieceState: inspectionState(firstPiece?.result ?? null),
    firstPieceBlocksPack: plant.on && plant.settings.firstPieceBlocksPack,
    inProcess: inProcess.map((c) => ({ id: c.id, result: c.result, checkedAt: c.checkedAt.getTime() })),
    inProcessDue: { ...due, everyBundles, everyMinutes, bundlesSince },
    plan: plan ? { id: plan.id, dimensions: plan.dimensionsJson, temperId: plan.temperId } : null,
    breaches,
  };
}

export const qaRouter = router({
  checks: checksRouter,
  holds: holdsRouter,
  waiting: waitingRouter,

  settings: router({
    get: companyProcedure.query(async ({ ctx }) => {
      const plant = await readQaPlant(ctx.db, ctx.companyId);
      return { ...plant.settings, moduleOn: plant.on };
    }),
    /** Quality switches (`qa.masters`). Turning a gate on stamps today: only lots and runs from today are gated. */
    update: actionProcedure("qa.masters")
      .input(settingsInput)
      .mutation(async ({ ctx, input }) => {
        const plant = await readQaPlant(ctx.db, ctx.companyId);
        const today = companyDay(plant.timezone, clockNow().getTime());
        const next = applyQaSettingsEdit(plant.settings, input, today);
        const settings = { ...plant.raw, qa: next };
        await atomicBatch(ctx.db, [
          ctx.db.update(company).set({ settings }).where(eq(company.id, ctx.companyId)),
          auditInsert(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            { action: "qa.settings.update", subjectType: "company", subjectId: ctx.companyId, meta: { before: plant.settings, after: next } },
          ),
        ]);
        return next;
      }),
  }),

  /** One run's quality: first piece, in-process checks and whether one is due, plan flags. */
  run: companyProcedure.input(z.object({ runId: id })).query(({ ctx, input }) => runQuality(ctx, input.runId)),

  /** Today's quality figures: bundles on hold, lots waiting, instruments overdue or due soon (row 38). */
  today: companyProcedure.query(async ({ ctx }) => {
    const plant = await readQaPlant(ctx.db, ctx.companyId);
    const todayYmd = companyDay(plant.timezone, clockNow().getTime());
    const [held] = await ctx.db.select({ n: sql<number>`count(*)` }).from(qaHold).where(and(eq(qaHold.companyId, ctx.companyId), isNull(qaHold.releasedAt)));
    const instruments = await ctx.db
      .select({ id: qaInstrument.id, code: qaInstrument.code, name: qaInstrument.name, nextDueOn: qaInstrument.nextDueOn })
      .from(qaInstrument)
      .where(and(eq(qaInstrument.companyId, ctx.companyId), eq(qaInstrument.active, true)))
      .orderBy(asc(qaInstrument.nextDueOn))
      .limit(500);
    const states = instruments.map((i) => ({ ...i, state: calibrationState(i.nextDueOn, todayYmd) }));
    return {
      moduleOn: plant.on,
      onHold: Number(held?.n ?? 0),
      overdue: states.filter((s) => s.state === "overdue").map(({ id: iid, code, name, nextDueOn }) => ({ id: iid, code, name, nextDueOn })),
      dueSoon: states.filter((s) => s.state === "due_soon").length,
    };
  }),

  ...qaMastersRouter,
});
