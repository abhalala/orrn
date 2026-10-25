/**
 * Die room (spec P4/P18, digest Stage 19): the physical copies ("obliques") of a catalogue
 * section, their kg/12ft readings, nitriding log, and the tier re-rank that a manager approves.
 *
 * - The `die` table is the section; `die_instance.section_id` points at it (same company is
 *   enforced here, the foreign key cannot).
 * - The oblique code `{sectionCode}-{n}` and `n` are allocated INSIDE the insert (one
 *   INSERT … SELECT), so two creates can never take the same number and a retired copy keeps its.
 * - A tier is never written directly after creation: `proposeTier` opens an approval (kind
 *   die_rerank) and `approval.decide` applies it in the decision's own batch (lib/approvalApply).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import {
  dieBand,
  dieFile,
  dieInstance,
  dieMaker,
  dieMakerJob,
  dieInstanceStatuses,
  dieTierChange,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema/dies";
import { dieIssue, pressRun } from "@orrn/db/schema/press";
import {
  canEditDieCard,
  DIE_COPY_HAND_STATUSES,
  DIE_OWNER_OVERRIDE_PURPOSES,
  dieCopyNext,
  driftPercentTenths,
  effectiveDieOwner,
  kgPerMetre,
  newCopyStatus,
  normalizeDieCopySearch,
  planTierChange,
  recoveryBp,
  suggestFirstCopy,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, mapInChunks, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import {
  audit,
  bandText,
  copyFigures,
  customerNames,
  dieRoomAbortUnless,
  effectiveBand,
  errorText,
  isDieRoomAbort,
  loadDriftBands,
  loadFloorSettings,
  requireActiveBand,
  requireLiveCustomer,
} from "../lib/dieRoom";
import { signDieFileUrl } from "../lib/dieFiles";
import { checkDieAllowed } from "../lib/dieOwner";
import { loadTrialRun, trialMoveStatements, trialRunCheck } from "../lib/dieTrial";
import { can, canApprove, type CompanyRole } from "../lib/permissions";
import { likeContains } from "../lib/search";
import { nextCompanySeq } from "../lib/sequence";
import { isStoreDrawAbort, loadStoreItem, prepareStoreDraws } from "../lib/store";
import { dieFileRouter } from "./dieFile";
import { dieIssueRouter } from "./dieIssue";
import { dieMakerRouter } from "./dieMaker";

/** kg/12ft in thousandths of a kg (= grams per 12 ft). 500 kg per 12 ft is far beyond any section. */
const kgPer12ftMilli = z.number().int().min(1).max(500_000);
const rank = z.number().int().min(1).max(99);
const hardness = z.number().int().min(1).max(5_000);
const grams = z.number().int().min(0).max(1_000_000_000);

const NOT_FOUND = { code: "NOT_FOUND", message: "Die not found" } as const;

/** One chemical's open / used / close, in grams; close = open - used (digest §8.6). */
const chemical = z
  .object({ openG: grams, usedG: grams, closeG: grams })
  .refine((c) => c.closeG === c.openG - c.usedG, "Close must equal open minus used");

const shortText = (max: number) => z.string().trim().max(max).nullable().optional();

/** The maker's own number on the die and its project number: free text, empty clears. */
const makerNo = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .optional()
  .transform((v) => (v === "" ? null : v));

const dieCardFields = {
  makerDieNo: makerNo,
  makerProjectNo: makerNo,
  supplier: z.string().trim().max(200).nullable().optional(),
  trialKgPer12ftMilli: kgPer12ftMilli.nullable().optional(),
  hardness: hardness.nullable().optional(),
  lifeG: z.number().int().min(1).max(100_000_000_000).nullable().optional(),
  ftr: z.string().trim().max(200).nullable().optional(),
  /** Never `in_use` / `at_maker`: those are written only by die issue and maker jobs. */
  status: z.enum(DIE_COPY_HAND_STATUSES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  // Die card (FP-DR-07/12). Owner: `masters.publish` only, and only the section owner (C2).
  ownerCustomerId: z.string().min(1).nullable().optional(),
  cavityCount: z.number().int().min(1).max(32).nullable().optional(),
  bolster: shortText(40),
  backerNo: shortText(40),
  subBolster: shortText(40),
  rackNo: shortText(20),
  receivedAt: z.number().int().positive().nullable().optional(),
  dieMakerId: z.string().min(1).nullable().optional(),
};

/** Copy owner rule (FP-DR-12, C2): `masters.publish` sets it; under an owned section it must be that owner. */
async function checkCopyOwner(
  ctx: { db: OrrnDb; companyId: string; role: CompanyRole },
  section: { ownerCustomerId: string | null },
  ownerCustomerId: string | null | undefined,
  current: string | null,
): Promise<void> {
  if (ownerCustomerId === undefined || ownerCustomerId === current) return;
  if (!can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager or admin can set who owns a die" });
  }
  // Null = inherit the section owner (never "plant-owned" while the section is owned, C2).
  if (section.ownerCustomerId && ownerCustomerId && ownerCustomerId !== section.ownerCustomerId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This section belongs to a customer; its copies cannot be given to someone else or made plant-owned. Clear the section owner or split the section.",
    });
  }
  if (ownerCustomerId) await requireLiveCustomer(ctx.db, ctx.companyId, ownerCustomerId);
}

async function requireActiveMaker(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select({ id: dieMaker.id })
    .from(dieMaker)
    .where(and(eq(dieMaker.id, id), eq(dieMaker.companyId, companyId), eq(dieMaker.status, "active")))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an active die maker" });
}


/** `die_instance` as the statement sees it, table-qualified for use inside correlated subqueries. */
const outer = (column: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(column)}`;

type Instance = typeof dieInstance.$inferSelect;

async function loadInstance(
  ctx: { db: import("../lib/atomic").OrrnDb; companyId: string },
  id: string,
): Promise<Instance> {
  const [row] = await ctx.db
    .select()
    .from(dieInstance)
    .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(NOT_FOUND);
  return row;
}

function auditCtx(ctx: {
  db: import("../lib/atomic").OrrnDb;
  companyId: string;
  session: Parameters<typeof auditInsert>[0]["session"];
  impersonation: Parameters<typeof auditInsert>[0]["impersonation"];
}) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

/** Nitriding chemical with an optional central-store item (counted in kg) to draw the used grams from. */
const nitridingChemical = z
  .object({ openG: grams, usedG: grams, closeG: grams, storeItemId: z.string().min(1).max(64).optional() })
  .refine((c) => c.closeG === c.openG - c.usedG, "Close must equal open minus used");

/** "12170-1 is issued to a press; it cannot be sent to nitriding". */
function copyBusyMessage(instance: { code: string; status: string }, what: string): string {
  const where: Record<string, string> = {
    in_use: "is issued to a press",
    at_nitriding: "is out at nitriding",
    at_maker: "is at the die maker",
    retired: "is retired",
    available: "is on the rack",
    on_trial: "is on trial",
  };
  return `${instance.code} ${where[instance.status] ?? `is ${instance.status}`}; it cannot be ${what}`;
}

/** FP-DR-08: one row of `dieInstance.runs` (contract for FP-PR). */
export type DieRunRow = {
  pressRunId: string;
  number: string;
  shift: { productionDay: string | null; seq: number | null; shiftId: string | null };
  startedAt: Date | null;
  finishedAt: Date | null;
  inputG: number;
  outputG: number;
  accumulatedG: number;
  recoveryBp: number | null;
  speedMilliPerSec: number | null;
  pressRemark: string | null;
  dieRemark: string | null;
  readingMilli: number | null;
  pctTenth: number | null;
  nitridedAt: Date | null;
};

/** Die card fields (create/update): the die room, or masters holders (manager, admin) per ruling RP7. */
const dieCardEditor = anyActionProcedure("die.card", "masters.publish");

export const dieInstanceRouter = router({
  /**
   * Copies, lightest section code first; filter by section and status. Any member may read. Each
   * row carries the server-computed drift against the copy's own band (`latestMilli`,
   * `percentTenths`, `tone`, `position`, `kgPerMetre`, `bandId`, `bandText`): clients never recompute.
   */
  list: companyProcedure
    .input(
      z
        .object({
          sectionId: z.string().min(1).optional(),
          status: z.enum(dieInstanceStatuses).optional(),
          /** Any of these statuses (the issue form lists copies on the rack and on trial). */
          statuses: z.array(z.enum(dieInstanceStatuses)).min(1).max(6).optional(),
          /** A copy code as the floor writes it: `12170-2`, or `12170/2`. Matches anywhere in the code. */
          search: z.string().trim().max(40).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dieInstance.companyId, ctx.companyId),
        input.sectionId ? eq(dieInstance.sectionId, input.sectionId) : undefined,
        input.status ? eq(dieInstance.status, input.status) : undefined,
        input.statuses ? inArray(dieInstance.status, input.statuses) : undefined,
        input.search ? likeContains(dieInstance.code, normalizeDieCopySearch(input.search)) : undefined,
      );
      const [items, [totalRow]] = await Promise.all([
        ctx.db
          .select({
            id: dieInstance.id,
            companyId: dieInstance.companyId,
            sectionId: dieInstance.sectionId,
            sectionSeries: die.series,
            sectionCode: die.sectionCode,
            seqNo: dieInstance.seqNo,
            code: dieInstance.code,
            supplier: dieInstance.supplier,
            status: dieInstance.status,
            tierRank: dieInstance.tierRank,
            tierSince: dieInstance.tierSince,
            hardness: dieInstance.hardness,
            lifeG: dieInstance.lifeG,
            trialKgPer12ftMilli: dieInstance.trialKgPer12ftMilli,
            latestKgPer12ftMilli: sql<number | null>`(
              select r.kg_per_12ft_milli from die_weight_reading r
              where r.die_instance_id = ${dieInstance.id} and r.company_id = ${dieInstance.companyId}
              order by r.read_at desc limit 1
            )`,
            /** When the latest reading was taken (ms), null for a copy never read. The phone's "no reading in 30 days". */
            latestReadAt: sql<number | null>`(
              select max(r.read_at) from die_weight_reading r
              where r.die_instance_id = ${dieInstance.id} and r.company_id = ${dieInstance.companyId}
            )`,
            sectionWeightMinG: die.weightMinG,
            sectionWeightMaxG: die.weightMaxG,
            band: {
              id: dieBand.id,
              wallTenthMm: dieBand.wallTenthMm,
              weightMinG: dieBand.weightMinG,
              weightMaxG: dieBand.weightMaxG,
              label: dieBand.label,
              active: dieBand.active,
            },
          })
          .from(dieInstance)
          .innerJoin(die, and(eq(die.id, dieInstance.sectionId), eq(die.companyId, dieInstance.companyId)))
          .leftJoin(dieBand, and(eq(dieBand.id, dieInstance.bandId), eq(dieBand.companyId, dieInstance.companyId)))
          .where(where)
          .orderBy(asc(die.sectionCode), asc(dieInstance.seqNo))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(dieInstance).where(where),
      ]);
      const driftBands = await loadDriftBands(ctx.db, ctx.companyId);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return {
        items: items.map(({ sectionWeightMinG, sectionWeightMaxG, band: joined, ...item }) => {
          const band = effectiveBand(
            { wallTenthMm: null, thicknessMm: null, weightMinG: sectionWeightMinG, weightMaxG: sectionWeightMaxG },
            joined?.id ? joined : null,
          );
          const f = copyFigures(item.latestKgPer12ftMilli, band, driftBands);
          return {
            ...item,
            latestMilli: f.currentMilli,
            percentTenths: f.pctTenth,
            tone: f.tone,
            position: f.position,
            kgPerMetre: f.kgPerMetre,
            bandId: band.id,
            bandText: bandText(band),
          };
        }),
        total,
        limit: input.limit,
        offset: input.offset,
        nextOffset: next < total ? next : null,
      };
    }),

  /**
   * The die card (FP-DR-07): the copy, its section, effective band and owner, current weight with
   * percent / tone / band position / kg/m (server-computed), produced grams and life, files, open
   * issue, open maker job, pending tier change, recent readings, nitriding and tier history.
   */
  get: companyProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const instance = await loadInstance(ctx, input.id);
    const [sectionRows, readings, nitriding, tierChanges, files, bandRows, openIssue, openMakerJob, produced, driftBands] = await Promise.all([
      ctx.db
        .select({
          id: die.id,
          series: die.series,
          sectionCode: die.sectionCode,
          name: die.name,
          weightMinG: die.weightMinG,
          weightMaxG: die.weightMaxG,
          wallTenthMm: die.wallTenthMm,
          thicknessMm: die.thicknessMm,
          alloy: die.alloy,
          temper: die.temper,
          profileKind: die.profileKind,
          ownerCustomerId: die.ownerCustomerId,
          cavityCount: die.cavityCount,
          drawingKey: die.drawingKey,
          deletedAt: die.deletedAt,
        })
        .from(die)
        .where(and(eq(die.id, instance.sectionId), eq(die.companyId, ctx.companyId)))
        .limit(1),
      ctx.db
        .select()
        .from(dieWeightReading)
        .where(and(eq(dieWeightReading.companyId, ctx.companyId), eq(dieWeightReading.dieInstanceId, instance.id)))
        .orderBy(desc(dieWeightReading.readAt))
        .limit(20),
      ctx.db
        .select()
        .from(nitridingLog)
        .where(and(eq(nitridingLog.companyId, ctx.companyId), eq(nitridingLog.dieInstanceId, instance.id)))
        .orderBy(desc(nitridingLog.nitridedAt), desc(nitridingLog.createdAt))
        .limit(20),
      ctx.db
        .select()
        .from(dieTierChange)
        .where(and(eq(dieTierChange.companyId, ctx.companyId), eq(dieTierChange.dieInstanceId, instance.id)))
        .orderBy(desc(dieTierChange.createdAt), desc(dieTierChange.serverSeq))
        .limit(50),
      ctx.db
        .select()
        .from(dieFile)
        .where(
          and(
            eq(dieFile.companyId, ctx.companyId),
            eq(dieFile.sectionId, instance.sectionId),
            or(isNull(dieFile.dieInstanceId), eq(dieFile.dieInstanceId, instance.id)),
          ),
        )
        .orderBy(desc(dieFile.createdAt)),
      ctx.db
        .select()
        .from(dieBand)
        .where(and(eq(dieBand.companyId, ctx.companyId), eq(dieBand.sectionId, instance.sectionId))),
      ctx.db
        .select()
        .from(dieIssue)
        .where(and(eq(dieIssue.companyId, ctx.companyId), eq(dieIssue.dieInstanceId, instance.id), eq(dieIssue.status, "issued")))
        .limit(1),
      ctx.db
        .select()
        .from(dieMakerJob)
        .where(and(eq(dieMakerJob.companyId, ctx.companyId), eq(dieMakerJob.dieInstanceId, instance.id), eq(dieMakerJob.status, "sent")))
        .limit(1),
      producedGrams(ctx.db, ctx.companyId, instance.id),
      loadDriftBands(ctx.db, ctx.companyId),
    ]);
    const sectionRow = sectionRows[0] ?? null;
    const section = sectionRow
      ? (({ deletedAt: _d, drawingKey: _k, ...rest }) => ({ ...rest, hasDrawing: Boolean(sectionRow.drawingKey) }))(sectionRow)
      : null;
    const bandById = new Map(bandRows.map((b) => [b.id, b]));
    const band = sectionRow ? effectiveBand(sectionRow, instance.bandId ? bandById.get(instance.bandId) : null) : null;
    const latest = readings[0]?.kgPer12ftMilli ?? null;
    const figures = band ? copyFigures(latest, band, driftBands) : copyFigures(null, { weightMinG: 1, weightMaxG: 1 }, driftBands);
    const ownerId = effectiveDieOwner(instance.ownerCustomerId, sectionRow?.ownerCustomerId);
    const names = await customerNames(ctx.db, ctx.companyId, [ownerId]);
    const pendingTierChange = tierChanges.find((t) => t.status === "pending") ?? null;
    // Each reading against the copy's band now, so the card can chip every row (never stored).
    const readingRunIds = [...new Set(readings.map((r) => r.pressRunId).filter((id): id is string => Boolean(id)))];
    const runNumbers = new Map(
      readingRunIds.length
        ? (
            await ctx.db
              .select({ id: pressRun.id, number: pressRun.number })
              .from(pressRun)
              .where(and(eq(pressRun.companyId, ctx.companyId), inArray(pressRun.id, readingRunIds)))
          ).map((r) => [r.id, r.number] as const)
        : [],
    );
    const readingRows = readings.map((r) => {
      const f = band ? copyFigures(r.kgPer12ftMilli, band, driftBands) : null;
      return { ...r, pressRunNumber: r.pressRunId ? (runNumbers.get(r.pressRunId) ?? null) : null, pctTenth: f?.pctTenth ?? null, tone: f?.tone ?? ("none" as const), position: f?.position ?? null };
    });
    const lifeRemainingG = instance.lifeG == null ? null : instance.lifeG - produced;
    return {
      instance,
      section,
      band: band ? { ...band, text: bandText(band), kgPerMetreMin: kgPerMetre(band.weightMinG), kgPerMetreMax: kgPerMetre(band.weightMaxG) } : null,
      owner: ownerId
        ? { customerId: ownerId, name: names.get(ownerId) ?? null, source: instance.ownerCustomerId ? ("copy" as const) : ("section" as const) }
        : null,
      cavityCount: instance.cavityCount ?? sectionRow?.cavityCount ?? null,
      ...figures,
      producedG: produced,
      lifeRemainingG,
      /** "Life reached": a warning on the card, never a block (the die room retires or lifts). */
      lifeReached: lifeRemainingG != null && lifeRemainingG <= 0,
      openIssue: openIssue[0] ?? null,
      openMakerJob: openMakerJob[0] ?? null,
      pendingTierChange,
      files,
      readings: readingRows,
      nitriding,
      tierChanges,
    };
  }),

  /**
   * New copy of a section. The oblique code and number come from the insert itself (next per
   * section, never reused). A `tierRank` given here is the first placement: an applied history
   * row, no approval (re-ranking an existing copy always needs one).
   */
  create: dieCardEditor
    .input(z.object({ sectionId: z.string().min(1), tierRank: rank.optional(), bandId: z.string().min(1).nullable().optional(), ...dieCardFields }))
    .mutation(async ({ ctx, input }) => {
      const [section] = await ctx.db
        .select({ id: die.id, status: die.status, ownerCustomerId: die.ownerCustomerId, cavityCount: die.cavityCount })
        .from(die)
        .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
        .limit(1);
      if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
      if (section.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This section is archived; no new die copies" });
      }
      if (input.status === "at_nitriding") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A new copy starts on the rack; send it to nitriding from its card" });
      }
      // FP-DR-17: a new copy starts on trial while the plant setting is on. Only a manager (masters.publish)
      // may start one on the rack, and only with the setting on there is anything to skip.
      const floor = await loadFloorSettings(ctx.db, ctx.companyId);
      const startStatus = newCopyStatus(floor);
      if (input.status === "available" && startStatus === "on_trial" && !can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "A new copy starts on trial; a manager can release it once it has passed" });
      }
      const newStatus = input.status ?? startStatus;
      // A copy on another band (FP-DR-03). Never a duplicate: copies on a band are always allowed.
      if (input.bandId) {
        await requireActiveBand(ctx.db, ctx.companyId, section.id, input.bandId, "Pick a band of this section");
      }
      await checkCopyOwner(ctx, section, input.ownerCustomerId, null);
      if (input.dieMakerId) await requireActiveMaker(ctx.db, ctx.companyId, input.dieMakerId);
      // Cavities default from the section when the form leaves them out.
      const cavityCount = input.cavityCount === undefined ? section.cavityCount : input.cavityCount;

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const userId = ctx.session.user.id;
      const dieCol = (c: string) => sql`${sql.identifier("die")}.${sql.identifier(c)}`;
      const nextNo = sql<number>`(coalesce((select max(i.seq_no) from die_instance i where i.company_id = ${dieCol("company_id")} and i.section_id = ${dieCol("id")}), 0) + 1)`;
      const ranked = input.tierRank ?? null;

      const statements: SqliteBatchItem[] = [
        // Keys follow die_instance's column order (insert-select rule).
        ctx.db.insert(dieInstance).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${dieCol("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              sectionId: sql<string>`${dieCol("id")}`.as("section_id"),
              seqNo: nextNo.as("seq_no"),
              code: sql<string>`${dieCol("section_code")} || '-' || ${nextNo}`.as("code"),
              supplier: sql<string | null>`${input.supplier ?? null}`.as("supplier"),
              trialKgPer12ftMilli: sql<number | null>`${input.trialKgPer12ftMilli ?? null}`.as("trial_kg_per_12ft_milli"),
              hardness: sql<number | null>`${input.hardness ?? null}`.as("hardness"),
              lifeG: sql<number | null>`${input.lifeG ?? null}`.as("life_g"),
              ftr: sql<string | null>`${input.ftr ?? null}`.as("ftr"),
              status: sql<string>`${newStatus}`.as("status"),
              tierRank: sql<number | null>`${ranked}`.as("tier_rank"),
              tierSince: sql<number | null>`${ranked === null ? null : at.getTime()}`.as("tier_since"),
              notes: sql<string | null>`${input.notes ?? null}`.as("notes"),
              bandId: sql<string | null>`${input.bandId ?? null}`.as("band_id"),
              ownerCustomerId: sql<string | null>`${input.ownerCustomerId ?? null}`.as("owner_customer_id"),
              cavityCount: sql<number | null>`${cavityCount ?? null}`.as("cavity_count"),
              bolster: sql<string | null>`${input.bolster ?? null}`.as("bolster"),
              backerNo: sql<string | null>`${input.backerNo ?? null}`.as("backer_no"),
              subBolster: sql<string | null>`${input.subBolster ?? null}`.as("sub_bolster"),
              rackNo: sql<string | null>`${input.rackNo ?? null}`.as("rack_no"),
              receivedAt: sql<number | null>`${input.receivedAt ?? null}`.as("received_at"),
              dieMakerId: sql<string | null>`${input.dieMakerId ?? null}`.as("die_maker_id"),
              makerDieNo: sql<string | null>`${input.makerDieNo ?? null}`.as("maker_die_no"),
              makerProjectNo: sql<string | null>`${input.makerProjectNo ?? null}`.as("maker_project_no"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
              updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
            })
            .from(die)
            .where(
              and(
                eq(die.id, input.sectionId),
                eq(die.companyId, ctx.companyId),
                isNull(die.deletedAt),
                eq(die.status, "active"),
              ),
            ),
        ),
      ];
      if (ranked !== null) {
        statements.push(
          ctx.db.insert(dieTierChange).select(
            ctx.db
              .select({
                id: sql<string>`${crypto.randomUUID()}`.as("id"),
                companyId: sql<string>`${outer("company_id")}`.as("company_id"),
                serverSeq: sql<number>`${seq}`.as("server_seq"),
                dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
                fromRank: sql<number | null>`null`.as("from_rank"),
                toRank: sql<number>`${ranked}`.as("to_rank"),
                fromBandId: sql<string | null>`null`.as("from_band_id"),
                toBandId: sql<string | null>`null`.as("to_band_id"),
                isLift: sql<number>`0`.as("is_lift"),
                reason: sql<string | null>`'initial'`.as("reason"),
                status: sql<string>`'applied'`.as("status"),
                approvalId: sql<string | null>`null`.as("approval_id"),
                effectiveAt: sql<number>`${at.getTime()}`.as("effective_at"),
                createdBy: sql<string>`${userId}`.as("created_by"),
                createdAt: sql<number>`${at.getTime()}`.as("created_at"),
                updatedAt: sql<number>`${at.getTime()}`.as("updated_at"),
              })
              .from(dieInstance)
              .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId))),
          ),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_instance.create",
            subjectType: "die_instance",
            subjectId: id,
            meta: { sectionId: input.sectionId, tierRank: ranked, bandId: input.bandId ?? null, status: newStatus },
          },
          { from: dieInstance, where: and(eq(dieInstance.id, id), eq(dieInstance.serverSeq, seq)) },
        ),
      );
      if (input.ownerCustomerId) {
        statements.push(
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "die_owner.set", subjectType: "die_instance", subjectId: id, meta: { from: null, to: input.ownerCustomerId } },
            { from: dieInstance, where: and(eq(dieInstance.id, id), eq(dieInstance.serverSeq, seq)) },
          ),
        );
      }
      await atomicBatch(ctx.db, statements);

      const [created] = await ctx.db
        .select()
        .from(dieInstance)
        .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, ctx.companyId)))
        .limit(1);
      // The section was deleted or archived between the read and the write.
      if (!created) throw new TRPCError({ code: "CONFLICT", message: "The section changed; try again" });
      return { id, code: created.code, seqNo: created.seqNo, status: created.status };
    }),

  /**
   * Die card fields only. The code, section, tier and band are permanent here (tier and band move
   * only by approval, FP-DR-10). Refused while the copy is on a press (`in_use`) or at the maker.
   * Status by hand: available <-> at_nitriding, available -> retired (never from in_use,
   * at_nitriding or at_maker).
   */
  update: dieCardEditor
    .input(z.object({ id: z.string().min(1), ...dieCardFields }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadInstance(ctx, input.id);
      if (!canEditDieCard(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            existing.status === "in_use"
              ? `${existing.code} is issued to a press; return it before editing the card`
              : `${existing.code} is at the die maker; receive it before editing the card`,
        });
      }
      if (input.status !== undefined && input.status !== existing.status) {
        // Nitriding moves only through nitridingOut / nitridingBack (their log and audit, §E1).
        if (input.status === "at_nitriding" || existing.status === "at_nitriding") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              input.status === "at_nitriding"
                ? `Send ${existing.code} to nitriding from its card's nitriding step, not by editing its status`
                : `${existing.code} is out at nitriding; record it back from nitriding first`,
          });
        }
        if (existing.status === "on_trial" && input.status === "available") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${existing.code} is on trial; it becomes available when a trial passes, or a manager releases it`,
          });
        }
        if ((dieCopyNext(existing.status, "retire") ?? dieCopyNext(existing.status, "trialRetire")) !== input.status) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              existing.status === "retired"
                ? `${existing.code} is retired`
                : `${existing.code} is ${existing.status.replace("_", " ")}; it cannot be set to ${input.status.replace("_", " ")} from there`,
          });
        }
      }
      const [section] = await ctx.db
        .select({ ownerCustomerId: die.ownerCustomerId })
        .from(die)
        .where(and(eq(die.id, existing.sectionId), eq(die.companyId, ctx.companyId)))
        .limit(1);
      await checkCopyOwner(ctx, section ?? { ownerCustomerId: null }, input.ownerCustomerId, existing.ownerCustomerId);
      if (input.dieMakerId && input.dieMakerId !== existing.dieMakerId) await requireActiveMaker(ctx.db, ctx.companyId, input.dieMakerId);

      const { id: _id, receivedAt, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof dieInstance.$inferInsert
      >;
      if (receivedAt !== undefined) patch.receivedAt = receivedAt === null ? null : new Date(receivedAt);
      if (Object.keys(patch).length === 0) return { success: true };
      const ownerChanged = input.ownerCustomerId !== undefined && input.ownerCustomerId !== existing.ownerCustomerId;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const landed = and(eq(dieInstance.id, existing.id), eq(dieInstance.serverSeq, seq));
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dieInstance)
          .set({ ...patch, serverSeq: seq })
          // Same status as read: an issue or maker send in between wins, and this edit changes nothing.
          .where(and(eq(dieInstance.id, existing.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, existing.status))),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_instance.update",
            subjectType: "die_instance",
            subjectId: existing.id,
            meta: {
              before: Object.fromEntries(Object.keys(patch).map((k) => [k, existing[k as keyof Instance]])),
              patch,
            },
          },
          { from: dieInstance, where: landed },
        ),
        ...(ownerChanged
          ? [
              auditInsertGuarded(
                auditCtx(ctx),
                { action: "die_owner.set", subjectType: "die_instance", subjectId: existing.id, meta: { from: existing.ownerCustomerId, to: input.ownerCustomerId ?? null } },
                { from: dieInstance, where: landed },
              ),
            ]
          : []),
      ]);
      const [after] = await ctx.db.select({ id: dieInstance.id }).from(dieInstance).where(landed).limit(1);
      if (!after) throw new TRPCError({ code: "CONFLICT", message: `${existing.code} changed meanwhile; open the card again` });
      return { success: true };
    }),

  /**
   * A kg/12ft reading of a copy (press, supervisor, die room). The previous reading of the same
   * copy is stored beside it as `last`, read at write time; `readAt` is strictly after the copy's
   * previous reading, so ordering by time equals ordering by write.
   */
  addReading: actionProcedure("die.reading")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        pressRunId: z.string().trim().min(1).max(64).optional(),
        kgPer12ftMilli,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired; it takes no readings` });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const nowMs = clockNow().getTime();
      const userId = ctx.session.user.id;
      // The copy's previous reading and the instant to stay after, both read at write time.
      const lastValue = sql`select r.kg_per_12ft_milli from die_weight_reading r where r.company_id = ${outer("company_id")} and r.die_instance_id = ${outer("id")} order by r.read_at desc limit 1`;
      const afterLast = sql`select max(r.read_at) + 1 from die_weight_reading r where r.company_id = ${outer("company_id")} and r.die_instance_id = ${outer("id")}`;
      await atomicBatch(ctx.db, [
        ctx.db.insert(dieWeightReading).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${outer("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
              pressRunId: sql<string | null>`${input.pressRunId ?? null}`.as("press_run_id"),
              kgPer12ftMilli: sql<number>`${input.kgPer12ftMilli}`.as("kg_per_12ft_milli"),
              lastKgPer12ftMilli: sql<number | null>`(${lastValue})`.as("last_kg_per_12ft_milli"),
              readAt: sql<number>`max(${nowMs}, coalesce((${afterLast}), 0))`.as("read_at"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${nowMs}`.as("created_at"),
            })
            .from(dieInstance)
            .where(
              and(
                eq(dieInstance.id, instance.id),
                eq(dieInstance.companyId, ctx.companyId),
                ne(dieInstance.status, "retired"),
              ),
            ),
        ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_reading.add",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: { code: instance.code, kgPer12ftMilli: input.kgPer12ftMilli, pressRunId: input.pressRunId ?? null },
          },
          { from: dieWeightReading, where: and(eq(dieWeightReading.id, id), eq(dieWeightReading.serverSeq, seq)) },
        ),
      ]);
      const [row] = await ctx.db
        .select()
        .from(dieWeightReading)
        .where(and(eq(dieWeightReading.id, id), eq(dieWeightReading.companyId, ctx.companyId)))
        .limit(1);
      // Retired between the read and the write.
      if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired; it takes no readings` });
      }
      return {
        id,
        kgPer12ftMilli: row.kgPer12ftMilli,
        lastKgPer12ftMilli: row.lastKgPer12ftMilli,
        readAt: row.readAt,
      };
    }),

  /**
   * One nitriding treatment (die room). Each chemical is optional but, when given, must have all of
   * open / used / close with close = open - used. Chemicals are plain numbers for now; the
   * store issue link (`store_txn_id`) is filled once the central store exists.
   */
  addNitriding: actionProcedure("die.card")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        nitridedAt: z.number().int().positive().optional(),
        hardness: hardness.optional(),
        cr4: chemical.optional(),
        cr2: chemical.optional(),
        k2s: chemical.optional(),
        caustic: chemical.optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      }
      const at = clockNow().getTime();
      // The paper sheet is often filled in later, never ahead of time (a day of clock slack).
      if (input.nitridedAt !== undefined && input.nitridedAt > at + 86_400_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The nitriding date is in the future" });
      }
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const n = <T extends number | string | null>(v: T | undefined) => sql<T | null>`${v ?? null}`;
      await atomicBatch(ctx.db, [
        ctx.db.insert(nitridingLog).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${outer("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
              nitridedAt: sql<number>`${input.nitridedAt ?? at}`.as("nitrided_at"),
              hardness: n(input.hardness).as("hardness"),
              cr4OpenG: n(input.cr4?.openG).as("cr4_open_g"),
              cr4UsedG: n(input.cr4?.usedG).as("cr4_used_g"),
              cr4CloseG: n(input.cr4?.closeG).as("cr4_close_g"),
              cr2OpenG: n(input.cr2?.openG).as("cr2_open_g"),
              cr2UsedG: n(input.cr2?.usedG).as("cr2_used_g"),
              cr2CloseG: n(input.cr2?.closeG).as("cr2_close_g"),
              k2sOpenG: n(input.k2s?.openG).as("k2s_open_g"),
              k2sUsedG: n(input.k2s?.usedG).as("k2s_used_g"),
              k2sCloseG: n(input.k2s?.closeG).as("k2s_close_g"),
              causticOpenG: n(input.caustic?.openG).as("caustic_open_g"),
              causticUsedG: n(input.caustic?.usedG).as("caustic_used_g"),
              causticCloseG: n(input.caustic?.closeG).as("caustic_close_g"),
              storeTxnId: sql<string | null>`null`.as("store_txn_id"),
              notes: n(input.notes).as("notes"),
              signedBy: sql<string>`${userId}`.as("signed_by"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at}`.as("created_at"),
            })
            .from(dieInstance)
            .where(
              and(
                eq(dieInstance.id, instance.id),
                eq(dieInstance.companyId, ctx.companyId),
                ne(dieInstance.status, "retired"),
              ),
            ),
        ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "nitriding.add",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: { code: instance.code, nitridingId: id, hardness: input.hardness ?? null },
          },
          { from: nitridingLog, where: and(eq(nitridingLog.id, id), eq(nitridingLog.serverSeq, seq)) },
        ),
      ]);
      const [row] = await ctx.db
        .select({ id: nitridingLog.id })
        .from(nitridingLog)
        .where(and(eq(nitridingLog.id, id), eq(nitridingLog.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      return { id };
    }),

  /**
   * Die room proposes a tier and/or a band lift for one copy (FP-DR-10). Nothing changes until a
   * manager approves the `die_rerank` request (approval.decide applies rank, and band on a lift).
   * One open proposal per copy (rank or lift). A lift target is always a `die_band` id of the same
   * section; `toBandId: null` with `lift: true` is back to the primary band. A reading above the
   * band never opens a proposal by itself.
   */
  proposeTier: actionProcedure("die.rerank")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        /** Required for a rank change; a lift keeps the current rank when omitted. */
        rank: rank.optional(),
        lift: z.boolean().default(false),
        toBandId: z.string().min(1).nullable().optional(),
        reason: z.string().trim().min(1, "Give a reason").max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (instance.status === "retired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is retired` });
      }
      if (!input.lift && input.toBandId != null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A band is only given with a lift" });
      }
      if (!input.lift && input.rank === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a tier" });
      }
      if (input.lift && input.toBandId) {
        await requireActiveBand(ctx.db, ctx.companyId, instance.sectionId, input.toBandId, "The lift target must be an active band of this section");
      }
      const [open] = await ctx.db
        .select({ id: dieTierChange.id })
        .from(dieTierChange)
        .where(and(eq(dieTierChange.companyId, ctx.companyId), eq(dieTierChange.dieInstanceId, instance.id), eq(dieTierChange.status, "pending")))
        .limit(1);
      const planned = planTierChange({
        copy: { tierRank: instance.tierRank, bandId: instance.bandId },
        toRank: input.rank ?? null,
        lift: input.lift,
        toBandId: input.toBandId ?? null,
        pendingExists: Boolean(open),
      });
      if (!planned.ok) {
        switch (planned.error) {
          case "pending_exists":
            throw new TRPCError({ code: "CONFLICT", message: `${instance.code} already has a tier change waiting for approval` });
          case "bad_rank":
            throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a tier for this copy first" });
          case "nothing_changes":
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: input.lift ? `${instance.code} is already on that band` : `${instance.code} is already tier ${input.rank}`,
            });
        }
      }
      const plan = planned.plan;

      const tierChangeId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const request = requestApprovalInsert(ctx, {
        kind: "die_rerank",
        subjectId: tierChangeId,
        serverSeq: seq,
        requestNote: input.reason,
        meta: {
          dieInstanceId: instance.id,
          sectionId: instance.sectionId,
          code: instance.code,
          fromRank: plan.fromRank,
          toRank: plan.toRank,
          isLift: plan.isLift,
          fromBandId: plan.fromBandId,
          toBandId: plan.toBandId,
        },
      });
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(dieTierChange).values({
            id: tierChangeId,
            companyId: ctx.companyId,
            serverSeq: seq,
            dieInstanceId: instance.id,
            fromRank: plan.fromRank,
            toRank: plan.toRank,
            fromBandId: plan.fromBandId,
            toBandId: plan.toBandId,
            isLift: plan.isLift,
            reason: input.reason,
            status: "pending",
            createdBy: ctx.session.user.id,
          }),
          request.statement,
          auditInsert(auditCtx(ctx), {
            action: "die_tier.propose",
            subjectType: "die_instance",
            subjectId: instance.id,
            meta: {
              code: instance.code,
              fromRank: plan.fromRank,
              toRank: plan.toRank,
              isLift: plan.isLift,
              fromBandId: plan.fromBandId,
              toBandId: plan.toBandId,
              approvalId: request.id,
            },
          }),
        ]);
      } catch (e) {
        if (errorText(e).includes("die_tier_change.die_instance_id")) {
          throw new TRPCError({ code: "CONFLICT", message: `${instance.code} already has a tier change waiting for approval` });
        }
        throw e;
      }
      return { tierChangeId, approvalId: request.id };
    }),

  /**
   * Drift of a section's copies (FP-DR-05/06/15): each copy's latest kg/12ft against ITS band
   * (its `die_band`, else the primary band): position in / above / below by grams, percent in
   * tenths against the band start and the tone from the plant's drift settings, kg/m, and the trend
   * over its last `readings` readings. Lightest first; copies never weighed last.
   * `suggestFirst` (C36): among `available` copies only, the lightest in-band one, then best tier,
   * then copy number; with `bandId` only copies on that band (null = the primary band). It never
   * issues the copy.
   */
  drift: companyProcedure
    .input(
      z.object({
        sectionId: z.string().min(1),
        bandId: z.string().min(1).nullable().optional(),
        readings: z.number().int().min(2).max(20).default(5),
        includeRetired: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => driftOf(ctx, input)),

  /** "Die room would issue 12170-1" (FP-DR-15): the `drift` pick alone, for the press and plan screens. */
  suggestFirst: companyProcedure
    .input(z.object({ sectionId: z.string().min(1), bandId: z.string().min(1).nullable().optional() }))
    .query(async ({ ctx, input }) => (await driftOf(ctx, { ...input, readings: 2, includeRetired: false })).suggestFirst),

  /**
   * Nitriding out (FP-DR-09): the log row and the copy `available -> at_nitriding` in one batch.
   * Refused unless the copy is on the rack (not issued, not at the maker, not retired). HV, when
   * given, also sets the copy's hardness. Each chemical may draw its used grams from a central-store
   * item counted in kg (optional, MRS in the same batch; the store cannot go negative).
   */
  nitridingOut: actionProcedure("die.card")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        nitridedAt: z.number().int().positive().optional(),
        hardness: hardness.optional(),
        cr4: nitridingChemical.optional(),
        cr2: nitridingChemical.optional(),
        k2s: nitridingChemical.optional(),
        caustic: nitridingChemical.optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (dieCopyNext(instance.status, "nitridingOut") === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copyBusyMessage(instance, "sent to nitriding") });
      }
      const at = clockNow();
      if (input.nitridedAt !== undefined && input.nitridedAt > at.getTime() + 86_400_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The nitriding date is in the future" });
      }
      const chemicals = (["cr4", "cr2", "k2s", "caustic"] as const).flatMap((name) => {
        const c = input[name];
        return c?.storeItemId ? [{ name, itemId: c.storeItemId, usedG: c.usedG }] : [];
      });
      for (const c of chemicals) {
        if (c.usedG <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Nothing was used of ${c.name.toUpperCase()}; leave its store item empty` });
        const item = await loadStoreItem(ctx.db, ctx.companyId, c.itemId);
        if (item.unit !== "kg") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is counted in ${item.unit}; pick a store item counted in kg` });
        }
      }

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      // Used grams = the issued quantity (1 g = 1 milli-kg): the MRS lands with the log or not at all.
      const prepared =
        chemicals.length > 0
          ? await prepareStoreDraws(ctx.db, {
              companyId: ctx.companyId,
              userId,
              seq,
              at,
              audit: { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
              source: { type: "nitriding", id },
              draws: chemicals.map((c) => ({
                itemId: c.itemId,
                qtyMilli: c.usedG,
                purpose: "nitriding" as const,
                refId: id,
                note: `Nitriding ${instance.code} ${c.name.toUpperCase()}`,
              })),
            })
          : null;
      const n = <T extends number | string | null>(v: T | undefined) => sql<T | null>`${v ?? null}`;
      const copyAvailable = and(
        eq(dieInstance.id, instance.id),
        eq(dieInstance.companyId, ctx.companyId),
        eq(dieInstance.status, "available"),
        sql`not exists (select 1 from die_issue di where di.company_id = ${ctx.companyId} and di.die_instance_id = ${instance.id} and di.status = 'issued')`,
      );
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(nitridingLog).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${outer("company_id")}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              dieInstanceId: sql<string>`${outer("id")}`.as("die_instance_id"),
              nitridedAt: sql<number>`${input.nitridedAt ?? at.getTime()}`.as("nitrided_at"),
              hardness: n(input.hardness).as("hardness"),
              cr4OpenG: n(input.cr4?.openG).as("cr4_open_g"),
              cr4UsedG: n(input.cr4?.usedG).as("cr4_used_g"),
              cr4CloseG: n(input.cr4?.closeG).as("cr4_close_g"),
              cr2OpenG: n(input.cr2?.openG).as("cr2_open_g"),
              cr2UsedG: n(input.cr2?.usedG).as("cr2_used_g"),
              cr2CloseG: n(input.cr2?.closeG).as("cr2_close_g"),
              k2sOpenG: n(input.k2s?.openG).as("k2s_open_g"),
              k2sUsedG: n(input.k2s?.usedG).as("k2s_used_g"),
              k2sCloseG: n(input.k2s?.closeG).as("k2s_close_g"),
              causticOpenG: n(input.caustic?.openG).as("caustic_open_g"),
              causticUsedG: n(input.caustic?.usedG).as("caustic_used_g"),
              causticCloseG: n(input.caustic?.closeG).as("caustic_close_g"),
              storeTxnId: sql<string | null>`${prepared?.ids[0] ?? null}`.as("store_txn_id"),
              notes: n(input.notes).as("notes"),
              signedBy: sql<string>`${userId}`.as("signed_by"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${at.getTime()}`.as("created_at"),
            })
            .from(dieInstance)
            .where(copyAvailable),
        ),
        ctx.db
          .update(dieInstance)
          .set({ status: "at_nitriding", serverSeq: seq, ...(input.hardness !== undefined ? { hardness: input.hardness } : {}) })
          .where(and(copyAvailable, sql`exists (select 1 from nitriding_log l where l.id = ${id} and l.server_seq = ${seq})`)),
        // Log + status flip land together, or the batch (and any store draw) rolls back.
        dieRoomAbortUnless(
          ctx.db,
          sql`exists (select 1 from die_instance i where i.id = ${instance.id} and i.server_seq = ${seq} and i.status = 'at_nitriding')`,
        ),
        ...(prepared?.statements ?? []),
        audit(ctx, {
          action: "nitriding.out",
          subjectType: "die_instance",
          subjectId: instance.id,
          meta: { code: instance.code, nitridingId: id, hardness: input.hardness ?? null, storeTxnIds: prepared?.ids ?? [], mrs: prepared?.numbers ?? [] },
        }),
      ];
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isDieRoomAbort(e)) {
          const now = await loadInstance(ctx, instance.id);
          throw new TRPCError({ code: "CONFLICT", message: copyBusyMessage(now, "sent to nitriding") });
        }
        if (prepared && isStoreDrawAbort(e)) await prepared.explain();
        throw e;
      }
      return { id, storeTxnIds: prepared?.ids ?? [], mrsNumbers: prepared?.numbers ?? [] };
    }),

  /** Nitriding back (FP-DR-09): `at_nitriding -> available`; HV after treatment sets the copy's hardness. */
  nitridingBack: actionProcedure("die.card")
    .input(z.object({ dieInstanceId: z.string().min(1), hardness: hardness.optional() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      if (dieCopyNext(instance.status, "nitridingBack") === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${instance.code} is not out at nitriding` });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const landed = and(eq(dieInstance.id, instance.id), eq(dieInstance.serverSeq, seq), eq(dieInstance.status, "available"));
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dieInstance)
          .set({ status: "available", serverSeq: seq, ...(input.hardness !== undefined ? { hardness: input.hardness } : {}) })
          .where(and(eq(dieInstance.id, instance.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "at_nitriding"))),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "nitriding.back", subjectType: "die_instance", subjectId: instance.id, meta: { code: instance.code, hardness: input.hardness ?? null } },
          { from: dieInstance, where: landed },
        ),
      ]);
      const [row] = await ctx.db.select({ id: dieInstance.id }).from(dieInstance).where(landed).limit(1);
      if (!row) throw new TRPCError({ code: "CONFLICT", message: `${instance.code} is not out at nitriding` });
      return { success: true };
    }),

  /**
   * Run history of a copy (FP-DR-08 contract for FP-PR), newest first: logged press runs with this
   * copy. `recoveryBp` = round(outputG x 10000 / inputG) (null without input), `accumulatedG` = the
   * copy's output up to and including the row, the reading taken in that run, the latest nitriding
   * at or before the run finished. Empty until press runs are logged (Wave 2).
   */
  runs: companyProcedure
    .input(z.object({ dieInstanceId: z.string().min(1), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }): Promise<DieRunRow[]> => {
      const instance = await loadInstance(ctx, input.dieInstanceId);
      // Table-qualified: inside the subqueries below a bare name would bind to the inner table.
      const R = (c: string) => sql`${sql.identifier("press_run")}.${sql.identifier(c)}`;
      const finished = sql<number | null>`coalesce(${R("die_out_at")}, ${R("stopped_at")}, ${R("logged_at")})`;
      const rows = await ctx.db
        .select({
          pressRunId: pressRun.id,
          number: pressRun.number,
          productionDay: pressRun.productionDay,
          shiftSeq: pressRun.shiftSeq,
          shiftId: pressRun.shiftId,
          startedAt: pressRun.startedAt,
          finishedAt: finished,
          inputG: pressRun.inputG,
          outputG: pressRun.goodG,
          pressRemark: pressRun.pressRemark,
          dieRemark: pressRun.dieRemark,
          readingMilli: sql<number | null>`(select r.kg_per_12ft_milli from die_weight_reading r where r.company_id = ${R("company_id")} and r.die_instance_id = ${instance.id} and r.press_run_id = ${R("id")} order by r.read_at desc limit 1)`,
          nitridedAt: sql<number | null>`(select max(l.nitrided_at) from nitriding_log l where l.company_id = ${R("company_id")} and l.die_instance_id = ${instance.id} and l.nitrided_at <= ${finished})`,
        })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.dieInstanceId, instance.id), eq(pressRun.status, "logged")))
        .orderBy(asc(finished), asc(pressRun.number));
      const [section] = await ctx.db
        .select({ weightMinG: die.weightMinG, weightMaxG: die.weightMaxG, wallTenthMm: die.wallTenthMm, thicknessMm: die.thicknessMm })
        .from(die)
        .where(and(eq(die.id, instance.sectionId), eq(die.companyId, ctx.companyId)))
        .limit(1);
      const [bandRow] = instance.bandId
        ? await ctx.db.select().from(dieBand).where(and(eq(dieBand.id, instance.bandId), eq(dieBand.companyId, ctx.companyId))).limit(1)
        : [];
      const bandStart = section ? effectiveBand(section, bandRow).weightMinG : null;
      let accumulatedG = 0;
      const out: DieRunRow[] = rows.map((r) => {
        const outputG = r.outputG ?? 0;
        accumulatedG += outputG;
        return {
          pressRunId: r.pressRunId,
          number: r.number,
          shift: { productionDay: r.productionDay, seq: r.shiftSeq, shiftId: r.shiftId },
          startedAt: r.startedAt,
          finishedAt: r.finishedAt == null ? null : new Date(Number(r.finishedAt)),
          inputG: r.inputG ?? 0,
          outputG,
          accumulatedG,
          recoveryBp: r.inputG ? recoveryBp(outputG, r.inputG) : null,
          speedMilliPerSec: null,
          pressRemark: r.pressRemark,
          dieRemark: r.dieRemark,
          readingMilli: r.readingMilli,
          pctTenth: r.readingMilli != null && bandStart ? driftPercentTenths(r.readingMilli, bandStart) : null,
          nitridedAt: r.nitridedAt == null ? null : new Date(Number(r.nitridedAt)),
        };
      });
      return out.reverse().slice(0, input.limit);
    }),

  /**
   * Ask for an exception to use a customer-owned copy for another party (FP-DR-12, C4/C5). Subject
   * is the copy only (never a section). Approvers: owner, admin, manager, never the requester. The
   * approved row is the grant until `closeOwnerOverride`; one grant covers plan, press, pack and
   * dispatch for that customer and copy.
   */
  requestOwnerOverride: anyActionProcedure("order.manage", "order.plan", "press.run", "bundle.pack", "dispatch.create")
    .input(
      z.object({
        dieInstanceId: z.string().min(1),
        customerId: z.string().min(1),
        purpose: z.enum(DIE_OWNER_OVERRIDE_PURPOSES),
        note: z.string().trim().min(1, "Say why").max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [copy] = await ctx.db
        .select()
        .from(dieInstance)
        .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, ctx.companyId)))
        .limit(1);
      if (!copy) {
        // A section id is never a subject (C4): ask for the copy.
        const [section] = await ctx.db
          .select({ id: die.id })
          .from(die)
          .where(and(eq(die.id, input.dieInstanceId), eq(die.companyId, ctx.companyId)))
          .limit(1);
        if (section) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the die copy" });
        throw new TRPCError(NOT_FOUND);
      }
      const customerName = await requireLiveCustomer(ctx.db, ctx.companyId, input.customerId);
      const check = await checkDieAllowed(ctx.db, ctx.companyId, {
        dieInstanceId: copy.id,
        customerId: input.customerId,
        purpose: input.purpose,
      });
      if (!check.ownerCustomerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} is plant-owned; no exception is needed` });
      }
      if (check.ownerCustomerId === input.customerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${customerName} owns ${copy.code}; no exception is needed` });
      }
      if (check.ok && check.viaGrant) {
        throw new TRPCError({ code: "CONFLICT", message: `${customerName} already has an open exception on ${copy.code}` });
      }
      const pendingConflict = async () => {
        const [pending] = await ctx.db
          .select({ requestedByName: user.name })
          .from(approval)
          .leftJoin(user, eq(user.id, approval.requestedBy))
          .where(
            and(
              eq(approval.companyId, ctx.companyId),
              eq(approval.kind, "die_owner_override"),
              eq(approval.subjectId, copy.id),
              eq(approval.status, "pending"),
            ),
          )
          .limit(1);
        return pending
          ? new TRPCError({
              code: "CONFLICT",
              message: `${pending.requestedByName ?? "Someone"} already asked for an exception on ${copy.code}; it is waiting for approval`,
            })
          : null;
      };
      const waiting = await pendingConflict();
      if (waiting) throw waiting;

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const request = requestApprovalInsert(ctx, {
        kind: "die_owner_override",
        subjectId: copy.id,
        serverSeq: seq,
        requestNote: input.note,
        // C46: no rate, no party kanta kg, no vendor name.
        meta: {
          attemptedCustomerId: input.customerId,
          purpose: input.purpose,
          closedAt: null,
          code: copy.code,
          sectionId: copy.sectionId,
          ownerCustomerId: check.ownerCustomerId,
        },
      });
      try {
        await atomicBatch(ctx.db, [
          request.statement,
          audit(ctx, {
            action: "die_owner.request",
            subjectType: "die_instance",
            subjectId: copy.id,
            meta: { code: copy.code, attemptedCustomerId: input.customerId, purpose: input.purpose, approvalId: request.id },
          }),
        ]);
      } catch (e) {
        const raced = await pendingConflict();
        if (raced) throw raced;
        throw e;
      }
      return { approvalId: request.id };
    }),

  /** Close a live exception (FP-DR-12): approver roles or `masters.publish`. Sets `meta.closedAt`. */
  closeOwnerOverride: anyActionProcedure("masters.publish")
    .input(z.object({ approvalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!canApprove(ctx.role, "die_owner_override") && !can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      const [row] = await ctx.db
        .select()
        .from(approval)
        .where(and(eq(approval.id, input.approvalId), eq(approval.companyId, ctx.companyId), eq(approval.kind, "die_owner_override")))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (row.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an approved exception can be closed" });
      if ((row.meta as Record<string, unknown>).closedAt != null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This exception is already closed" });
      }
      const closedAt = clockNow().getTime();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const landed = and(eq(approval.id, row.id), eq(approval.serverSeq, seq));
      await atomicBatch(ctx.db, [
        ctx.db
          .update(approval)
          .set({
            meta: sql`json_set(${approval.meta}, '$.closedAt', ${closedAt}, '$.closedBy', ${ctx.session.user.id})`,
            serverSeq: seq,
          })
          .where(
            and(
              eq(approval.id, row.id),
              eq(approval.companyId, ctx.companyId),
              eq(approval.status, "approved"),
              sql`json_extract(${approval.meta}, '$.closedAt') is null`,
            ),
          ),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "die_owner.close",
            subjectType: "die_instance",
            subjectId: row.subjectId,
            meta: { approvalId: row.id, attemptedCustomerId: (row.meta as Record<string, unknown>).attemptedCustomerId ?? null },
          },
          { from: approval, where: landed },
        ),
      ]);
      const [after] = await ctx.db.select({ id: approval.id }).from(approval).where(landed).limit(1);
      if (!after) throw new TRPCError({ code: "BAD_REQUEST", message: "This exception is already closed" });
      return { success: true, closedAt };
    }),

  /** The owner gate as a read (no throw): screens show "This die belongs to …" and the request button. */
  ownerCheck: companyProcedure
    .input(
      z.object({
        dieId: z.string().min(1).optional(),
        dieInstanceId: z.string().min(1).optional(),
        customerId: z.string().min(1).nullable(),
        purpose: z.enum(DIE_OWNER_OVERRIDE_PURPOSES),
      }),
    )
    .query(({ ctx, input }) => checkDieAllowed(ctx.db, ctx.companyId, input)),

  /**
   * The section's press drawing (FP-DR-13): `{ key, url }` with a signed GET valid 10 minutes, or
   * nulls. Any member (the press console calls it). Never accepts an arbitrary key.
   */
  drawing: companyProcedure.input(z.object({ sectionId: z.string().min(1) })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ key: die.drawingKey })
      .from(die)
      .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
    if (!row.key) return { key: null, url: null, expiresAt: null };
    const signed = await signDieFileUrl(ctx, ctx.companyId, row.key);
    return { key: row.key, url: signed.url, expiresAt: signed.expiresAt };
  }),

  /**
   * A copy on trial becomes available (FP-DR-17). Two ways, both audited:
   * - `pressRunId`: the trial run (plan purpose `die_trial`) of this copy is logged with result
   *   `pass` (the press close calls this, or a supervisor does it from the run). Audit `die_trial.pass`.
   * - no run: a manager releases the copy without a trial; `reason` is required. Audit
   *   `die_trial.release`. Only `masters.publish` may.
   */
  trialPass: anyActionProcedure("press.close", "masters.publish")
    .input(
      z.object({
        id: z.string().min(1),
        pressRunId: z.string().min(1).optional(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const copy = await loadInstance(ctx, input.id);
      if (copy.status !== "on_trial") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${copy.code} is not on trial` });
      }
      const manager = can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish");
      let statements: SqliteBatchItem[];
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      if (input.pressRunId) {
        const run = await loadTrialRun(ctx.db, ctx.companyId, input.pressRunId);
        trialRunCheck(run, copy, "pass");
        statements = trialMoveStatements(ctx, {
          copy,
          move: "trialPass",
          seq,
          action: "die_trial.pass",
          meta: { pressRunId: run.id, pressRunNumber: run.number },
        });
      } else {
        if (!manager) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager can release a copy without a passed trial" });
        }
        if (!input.reason || input.reason.length < 3) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Say why this copy is released without a trial" });
        }
        statements = trialMoveStatements(ctx, { copy, move: "trialRelease", seq, action: "die_trial.release", meta: { reason: input.reason } });
      }
      try {
        await atomicBatch(ctx.db, [
          ...statements,
          dieRoomAbortUnless(ctx.db, sql`exists (select 1 from die_instance i where i.id = ${copy.id} and i.status = 'available' and i.server_seq = ${seq})`),
        ]);
      } catch (e) {
        if (isDieRoomAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${copy.code} changed meanwhile; nothing was changed` });
        throw e;
      }
      return { status: "available" as const };
    }),

  /**
   * A failed trial of a copy that is back on trial (its trial run is logged with result `fail`).
   * Audit `die_trial.fail`. `then: "retire"` also retires the copy; `"stay"` keeps it on trial (send it
   * back to the maker from the Maker tab, or try again with a new trial plan).
   */
  trialFail: anyActionProcedure("press.close", "die.card", "masters.publish")
    .input(
      z.object({
        id: z.string().min(1),
        pressRunId: z.string().min(1),
        then: z.enum(["stay", "retire"]).default("stay"),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const copy = await loadInstance(ctx, input.id);
      if (copy.status !== "on_trial") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy.status === "in_use" ? `${copy.code} is still on the press; take the die out and return it first` : `${copy.code} is not on trial`,
        });
      }
      const run = await loadTrialRun(ctx.db, ctx.companyId, input.pressRunId);
      trialRunCheck(run, copy, "fail");
      const editor = can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "die.card")
        || can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish");
      if (input.then === "retire" && !editor) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the die room or a manager can retire a copy" });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const meta = { pressRunId: run.id, pressRunNumber: run.number, then: input.then, note: input.note ?? null };
      const statements: SqliteBatchItem[] =
        input.then === "retire"
          ? trialMoveStatements(ctx, { copy, move: "trialRetire", seq, action: "die_trial.fail", meta })
          : [
              ctx.db
                .update(dieInstance)
                .set({ serverSeq: seq })
                .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.status, "on_trial"))),
              auditInsertGuarded(
                auditCtx(ctx),
                { action: "die_trial.fail", subjectType: "die_instance", subjectId: copy.id, meta: { code: copy.code, from: "on_trial", to: "on_trial", ...meta } },
                { from: dieInstance, where: and(eq(dieInstance.id, copy.id), eq(dieInstance.serverSeq, seq), eq(dieInstance.status, "on_trial")) },
              ),
            ];
      await atomicBatch(ctx.db, statements);
      const [after] = await ctx.db
        .select({ status: dieInstance.status, serverSeq: dieInstance.serverSeq })
        .from(dieInstance)
        .where(and(eq(dieInstance.id, copy.id), eq(dieInstance.companyId, ctx.companyId)))
        .limit(1);
      if (!after || after.serverSeq !== seq) {
        throw new TRPCError({ code: "CONFLICT", message: `${copy.code} changed meanwhile; nothing was changed` });
      }
      return { status: after.status };
    }),

  issues: dieIssueRouter,
  maker: dieMakerRouter,
  files: dieFileRouter,
});

/** Shared by `drift` and `suggestFirst`. */
async function driftOf(
  ctx: { db: OrrnDb; companyId: string },
  input: { sectionId: string; bandId?: string | null; readings: number; includeRetired: boolean },
) {
  const [section] = await ctx.db
    .select({
      id: die.id,
      series: die.series,
      sectionCode: die.sectionCode,
      weightMinG: die.weightMinG,
      weightMaxG: die.weightMaxG,
      wallTenthMm: die.wallTenthMm,
      thicknessMm: die.thicknessMm,
    })
    .from(die)
    .where(and(eq(die.id, input.sectionId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
    .limit(1);
  if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
  if (input.bandId) {
    const [b] = await ctx.db
      .select({ id: dieBand.id })
      .from(dieBand)
      .where(and(eq(dieBand.id, input.bandId), eq(dieBand.companyId, ctx.companyId), eq(dieBand.sectionId, section.id)))
      .limit(1);
    if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Band not found" });
  }

  const [instances, bandRows, driftBands] = await Promise.all([
    ctx.db
      .select({
        id: dieInstance.id,
        code: dieInstance.code,
        seqNo: dieInstance.seqNo,
        status: dieInstance.status,
        tierRank: dieInstance.tierRank,
        bandId: dieInstance.bandId,
      })
      .from(dieInstance)
      .where(
        and(
          eq(dieInstance.companyId, ctx.companyId),
          eq(dieInstance.sectionId, section.id),
          input.includeRetired ? undefined : ne(dieInstance.status, "retired"),
        ),
      )
      .orderBy(asc(dieInstance.seqNo))
      .limit(500),
    ctx.db.select().from(dieBand).where(and(eq(dieBand.companyId, ctx.companyId), eq(dieBand.sectionId, section.id))),
    loadDriftBands(ctx.db, ctx.companyId),
  ]);
  const bandById = new Map(bandRows.map((b) => [b.id, b]));

  // Last N readings per copy (newest first), in id chunks to stay under the bound-parameter cap.
  const windowed = (ids: string[]) => {
    const ranked = ctx.db
      .select({
        dieInstanceId: dieWeightReading.dieInstanceId,
        kgPer12ftMilli: dieWeightReading.kgPer12ftMilli,
        readAt: dieWeightReading.readAt,
        n: sql<number>`row_number() over (partition by ${dieWeightReading.dieInstanceId} order by ${dieWeightReading.readAt} desc)`.as("n"),
      })
      .from(dieWeightReading)
      .where(and(eq(dieWeightReading.companyId, ctx.companyId), inArray(dieWeightReading.dieInstanceId, ids)))
      .as("ranked");
    return ctx.db
      .select({
        dieInstanceId: ranked.dieInstanceId,
        kgPer12ftMilli: ranked.kgPer12ftMilli,
        readAt: ranked.readAt,
      })
      .from(ranked)
      .where(sql`${ranked.n} <= ${input.readings}`)
      .orderBy(asc(ranked.readAt));
  };
  const readingRows = await mapInChunks(
    instances.map((i) => i.id),
    windowed,
    80,
  );
  const byInstance = new Map<string, { kgPer12ftMilli: number; readAt: Date }[]>();
  for (const r of readingRows) {
    const list = byInstance.get(r.dieInstanceId) ?? [];
    list.push({ kgPer12ftMilli: r.kgPer12ftMilli, readAt: r.readAt });
    byInstance.set(r.dieInstanceId, list);
  }

  const items = instances.map((i) => {
    const recent = byInstance.get(i.id) ?? []; // oldest first
    const last = recent[recent.length - 1] ?? null;
    const first = recent[0] ?? null;
    const latest = last ? { kgPer12ftMilli: last.kgPer12ftMilli, readAt: last.readAt } : null;
    const band = effectiveBand(section, i.bandId ? bandById.get(i.bandId) : null);
    const figures = copyFigures(latest?.kgPer12ftMilli, band, driftBands);
    let offBandMilli: number | null = null;
    if (latest) {
      offBandMilli =
        figures.position === "above"
          ? latest.kgPer12ftMilli - band.weightMaxG
          : figures.position === "below"
            ? latest.kgPer12ftMilli - band.weightMinG
            : 0;
    }
    const deltaMilli = last && first && recent.length >= 2 ? last.kgPer12ftMilli - first.kgPer12ftMilli : null;
    // Steady = within half a percent of the latest weight (at least 1 g).
    const noise = latest ? Math.max(1, Math.round(latest.kgPer12ftMilli * 0.005)) : 1;
    const trend: "heavier" | "lighter" | "steady" | "unknown" =
      deltaMilli === null ? "unknown" : deltaMilli > noise ? "heavier" : deltaMilli < -noise ? "lighter" : "steady";
    return {
      dieInstanceId: i.id,
      code: i.code,
      seqNo: i.seqNo,
      status: i.status,
      tierRank: i.tierRank,
      bandId: band.id,
      bandMinG: band.weightMinG,
      bandMaxG: band.weightMaxG,
      latest,
      band: figures.position,
      offBandMilli,
      pctTenth: figures.pctTenth,
      tone: figures.tone,
      kgPerMetre: figures.kgPerMetre,
      deltaMilli,
      trend,
      recent,
    };
  });

  items.sort((a, b) => {
    if (a.latest && b.latest) {
      return a.latest.kgPer12ftMilli - b.latest.kgPer12ftMilli || a.code.localeCompare(b.code, "en", { numeric: true });
    }
    if (a.latest) return -1;
    if (b.latest) return 1;
    return a.code.localeCompare(b.code, "en", { numeric: true });
  });

  // C36: available copies only, in band (colour ignored), optionally one band.
  const pool = items.filter(
    (i) => i.band === "in" && (input.bandId === undefined || i.bandId === (input.bandId ?? null)),
  );
  const pick = suggestFirstCopy(
    pool.map((i) => ({
      id: i.dieInstanceId,
      seqNo: i.seqNo,
      status: i.status,
      tierRank: i.tierRank,
      latestMilli: i.latest?.kgPer12ftMilli ?? null,
      bandMinG: i.bandMinG,
      bandMaxG: i.bandMaxG,
      code: i.code,
    })),
  );
  return {
    section,
    readings: input.readings,
    items,
    suggestFirst: pick ? { dieInstanceId: pick.id, code: pick.code, kgPer12ftMilli: pick.latestMilli! } : null,
  };
}

/** Grams this copy has made: good kg of its logged press runs (0 until press runs log, Wave 2). */
async function producedGrams(db: OrrnDb, companyId: string, dieInstanceId: string): Promise<number> {
  const [row] = await db
    .select({ g: sql<number>`coalesce(sum(${pressRun.goodG}), 0)` })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.dieInstanceId, dieInstanceId), eq(pressRun.status, "logged")));
  return Number(row?.g ?? 0);
}
