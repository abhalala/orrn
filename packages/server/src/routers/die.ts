import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { die, dieProfileKinds, dieStatuses } from "@orrn/db/schema/catalog";
import { dieBand, dieFile, dieInstance, dieInstanceStatuses, dieTierChange } from "@orrn/db/schema/dies";
import {
  DELETED_DIE_CODE_MESSAGE,
  effectiveDieOwner,
  kgPerMetre,
  kgPerMetreToG12ft,
  normalizeDieCopySearch,
  type DriftTone,
} from "@orrn/domain";
import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import {
  bandText,
  copyFigures,
  customerNames,
  effectiveBand,
  latestReadingSql,
  loadDriftBands,
  loadFloorSettings,
  primaryBand,
  requireLiveCustomer,
  sectionWallTenth,
  worstTone,
} from "../lib/dieRoom";
import { dieBandRouter, duplicateBandError, findDuplicateBand } from "./dieBand";
import { likeContains } from "../lib/search";
import { clientRequestIdSchema, replayProbe, replayState, REQUEST_ID_CONFLICT, requestRowIds } from "../lib/importReplay";
import { nextCompanySeq } from "../lib/sequence";

export const dimensionsSchema = z.object({
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  thicknessMm: z.number().optional(),
});

/**
 * Die geometry keeps 0.1 mm precision (the oblique decides the die tier), so decimals are valid;
 * anything finer than 0.1 mm is rounded away.
 */
const dieLength = z
  .number()
  .finite()
  .nonnegative()
  .transform((n) => Math.round(n * 10) / 10);
const optionalDieLength = dieLength.nullable().optional();

/** Weights are stored as whole grams: decimals from forms are rounded, and must still be >= 1 g. */
const dieWeightG = z
  .number()
  .finite()
  .positive()
  .transform((n) => Math.round(n))
  .pipe(z.number().int().min(1));

/** Cap for dies per import call; matches bundle.bulkImport and customer.importCsv. */
const MAX_IMPORT_ROWS = 2000;

export const dieBaseSchema = z.object({
  series: z.string().min(1, "Series is required").max(500),
  sectionCode: z.string().min(1, "Section Code is required").max(500),
  name: z.string().max(500).nullable().optional(),
  legMm: optionalDieLength,
  widthMm: optionalDieLength,
  thicknessMm: optionalDieLength,
  dimensions: dimensionsSchema.default({}),
  weightMinG: dieWeightG,
  weightMaxG: dieWeightG,
  status: z.enum(dieStatuses).default("active"),
  notes: z.string().max(500).nullable().optional(),
});

/**
 * One die updated from an import sheet. Unlike the create schema nothing has a default: a field
 * that is not sent keeps what orrn has (a weight-band sheet must not wipe geometry, name or notes,
 * and a sheet without a Status column must not re-activate an archived die); `null` clears it.
 */
export const dieImportUpdateSchema = z.object({
  existingId: z.string(),
  series: z.string().min(1, "Series is required").max(500),
  sectionCode: z.string().min(1, "Section Code is required").max(500),
  name: z.string().max(500).nullable().optional(),
  legMm: optionalDieLength,
  widthMm: optionalDieLength,
  thicknessMm: optionalDieLength,
  dimensions: dimensionsSchema.optional(),
  weightMinG: dieWeightG,
  weightMaxG: dieWeightG,
  status: z.enum(dieStatuses).optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** The `.set()` of an import update: only the keys that were sent; dimensions are merged, never replaced. */
function dieImportUpdateSet(row: z.infer<typeof dieImportUpdateSchema>, serverSeq: number) {
  const set: SQLiteUpdateSetSource<typeof die> = {
    weightMinG: row.weightMinG,
    weightMaxG: row.weightMaxG,
    serverSeq,
  };
  if (row.name !== undefined) set.name = row.name;
  if (row.legMm !== undefined) set.legMm = row.legMm;
  if (row.widthMm !== undefined) set.widthMm = row.widthMm;
  if (row.thicknessMm !== undefined) set.thicknessMm = row.thicknessMm;
  if (row.status !== undefined) set.status = row.status;
  if (row.notes !== undefined) set.notes = row.notes;

  // dimensions mirrors width/thickness (see create); a null in a JSON merge patch removes the key.
  const patch: Record<string, number | null> = {};
  const width = row.widthMm !== undefined ? row.widthMm : row.dimensions?.widthMm;
  const thickness = row.thicknessMm !== undefined ? row.thicknessMm : row.dimensions?.thicknessMm;
  if (width !== undefined) patch.widthMm = width;
  if (thickness !== undefined) patch.thicknessMm = thickness;
  if (row.dimensions?.heightMm !== undefined) patch.heightMm = row.dimensions.heightMm;
  if (Object.keys(patch).length > 0) {
    set.dimensions = sql`json_patch(coalesce(${die.dimensions}, '{}'), ${JSON.stringify(patch)})`;
  }
  return set;
}

/**
 * Import of a kg/m catalogue (FP-DR-02 rule 4): a row may give `weightMinKgPerM` /
 * `weightMaxKgPerM` instead of grams; they become grams per 12 ft (x 12 x 0.3048, nearest gram)
 * before anything else runs, so a kg/m figure and the same weight per 12 ft are one band.
 */
function kgPerMetreRow(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const row = { ...(raw as Record<string, unknown>) };
  for (const [g, m] of [["weightMinG", "weightMinKgPerM"], ["weightMaxG", "weightMaxKgPerM"]] as const) {
    const perMetre = row[m];
    if (row[g] === undefined && typeof perMetre === "number" && Number.isFinite(perMetre) && perMetre > 0) {
      row[g] = kgPerMetreToG12ft(perMetre);
    }
    delete row[m];
  }
  return row;
}
const dieImportRow = z.preprocess(kgPerMetreRow, dieBaseSchema);
const dieImportUpdateRow = z.preprocess(kgPerMetreRow, dieImportUpdateSchema);

/**
 * The unique index on (company, series, section code) also covers soft-deleted dies, so reusing a
 * deleted die's code used to fail the insert with a 500 (audit S16). Say so instead.
 */
const DELETED_DIE_CONFLICT = {
  code: "CONFLICT",
  message: DELETED_DIE_CODE_MESSAGE,
} as const;

/** Die room columns on the section (FP-DR-12/13/14). Undefined = leave as is; null clears. */
const dieExtraFields = {
  alloy: z.string().trim().max(16).nullable().optional(),
  temper: z.string().trim().max(8).nullable().optional(),
  profileKind: z.enum(dieProfileKinds).nullable().optional(),
  /** Section owner (customer). `masters.publish` only (die_room cannot set an owner). */
  ownerCustomerId: z.string().min(1).nullable().optional(),
  cavityCount: z.number().int().min(1).max(32).nullable().optional(),
  wallTenthMm: z.number().int().min(1).max(10_000).nullable().optional(),
};

const auditOf = (ctx: { db: OrrnDb; companyId: string; session: Parameters<typeof auditInsert>[0]["session"]; impersonation?: Parameters<typeof auditInsert>[0]["impersonation"] }) => ({
  db: ctx.db,
  companyId: ctx.companyId,
  session: ctx.session,
  impersonation: ctx.impersonation,
});

export const dieRouter = router({
  bands: dieBandRouter,

  /**
   * Sections. Search matches series, section code, name, "SERIES CODE", and a copy code
   * (`12170-2`; a typed slash `12170/2` matches too). Each row carries its copy count, owner and
   * the worst drift tone among its available copies (server-computed, never stored).
   */
  list: companyProcedure
    .input(z.object({
      search: z.string().optional(),
      /** Only dies in this status (the Pack picker asks for active ones, so archived dies take no places). */
      status: z.enum(dieStatuses).optional(),
      /** Profile kind of the section. */
      profileKind: z.enum(dieProfileKinds).optional(),
      /** `plant`: no owner; `customer`: owned by a customer. */
      owner: z.enum(["plant", "customer"]).optional(),
      /** `none`: no live copies; `some`: at least one. */
      copies: z.enum(["none", "some"]).optional(),
      /** Sections that have a copy in this status (the board tiles: "On trial", "At maker", ...). */
      copyStatus: z.enum(dieInstanceStatuses).optional(),
      /** `newest` (default), `code` (series, section), `band` (lightest first), `copies` (most first). */
      sort: z.enum(["newest", "code", "band", "copies"]).default("newest"),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      let conditions = [
        eq(die.companyId, ctx.companyId),
        isNull(die.deletedAt)
      ];

      const search = input.search?.trim();
      if (search) {
        // Name, series, section code, or the code as the floor writes it ("PATTI 14701", series and
        // section together), or a copy code. % and _ in the term are matched literally.
        const copySearch = normalizeDieCopySearch(search);
        conditions.push(
          sql`(${likeContains(die.name, search)} OR ${likeContains(die.series, search)} OR ${likeContains(die.sectionCode, search)} OR ${likeContains(sql`${die.series} || ' ' || ${die.sectionCode}`, search)} OR exists (select 1 from die_instance ci where ci.company_id = ${sql.identifier("die")}.${sql.identifier("company_id")} and ci.section_id = ${sql.identifier("die")}.${sql.identifier("id")} and ${likeContains(sql`ci.code`, copySearch)}))`
        );
      }

      if (input.status) {
        conditions.push(eq(die.status, input.status));
      }
      if (input.profileKind) conditions.push(eq(die.profileKind, input.profileKind));
      if (input.owner === "plant") conditions.push(isNull(die.ownerCustomerId));
      if (input.owner === "customer") conditions.push(sql`${die.ownerCustomerId} is not null`);
      const liveCopies = sql`select 1 from die_instance lc where lc.company_id = ${sql.identifier("die")}.${sql.identifier("company_id")} and lc.section_id = ${sql.identifier("die")}.${sql.identifier("id")} and lc.status <> 'retired'`;
      if (input.copies === "none") conditions.push(sql`not exists (${liveCopies})`);
      if (input.copies === "some") conditions.push(sql`exists (${liveCopies})`);
      if (input.copyStatus) {
        conditions.push(
          sql`exists (select 1 from die_instance sc where sc.company_id = ${sql.identifier("die")}.${sql.identifier("company_id")} and sc.section_id = ${sql.identifier("die")}.${sql.identifier("id")} and sc.status = ${input.copyStatus})`,
        );
      }
      const copyCountSql = sql<number>`(select count(*) from die_instance cc where cc.company_id = ${sql.identifier("die")}.${sql.identifier("company_id")} and cc.section_id = ${sql.identifier("die")}.${sql.identifier("id")} and cc.status <> 'retired')`;
      const orderBy =
        input.sort === "code"
          ? [asc(die.series), asc(die.sectionCode), asc(die.id)]
          : input.sort === "band"
            ? [asc(die.weightMinG), asc(die.series), asc(die.sectionCode), asc(die.id)]
            : input.sort === "copies"
              ? [desc(copyCountSql), asc(die.series), asc(die.sectionCode), asc(die.id)]
              : [desc(die.createdAt), asc(die.id)];

      const items = await ctx.db.query.die.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy,
      });

      const result = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(die)
        .where(and(...conditions));

      // Copies of the listed sections (one chunked read, no N+1): count, worst tone of available ones.
      const sectionIds = items.map((d) => d.id);
      const copies = sectionIds.length
        ? await mapInChunks(sectionIds, (slice) =>
            ctx.db
              .select({
                sectionId: dieInstance.sectionId,
                status: dieInstance.status,
                latest: latestReadingSql(),
                bandMinG: dieBand.weightMinG,
                bandMaxG: dieBand.weightMaxG,
                bandActive: dieBand.active,
              })
              .from(dieInstance)
              .leftJoin(dieBand, and(eq(dieBand.id, dieInstance.bandId), eq(dieBand.companyId, dieInstance.companyId)))
              .where(and(eq(dieInstance.companyId, ctx.companyId), inArray(dieInstance.sectionId, slice))),
          )
        : [];
      const bands = await loadDriftBands(ctx.db, ctx.companyId);
      const names = await customerNames(ctx.db, ctx.companyId, items.map((d) => d.ownerCustomerId));
      const bySection = new Map<string, { count: number; tones: DriftTone[] }>();
      const byId = new Map(items.map((d) => [d.id, d]));
      for (const c of copies) {
        const entry = bySection.get(c.sectionId) ?? { count: 0, tones: [] };
        if (c.status !== "retired") entry.count += 1;
        if (c.status === "available") {
          const section = byId.get(c.sectionId)!;
          const start = c.bandActive && c.bandMinG != null ? c.bandMinG : section.weightMinG;
          entry.tones.push(copyFigures(c.latest, { weightMinG: start, weightMaxG: c.bandMaxG ?? section.weightMaxG }, bands).tone);
        }
        bySection.set(c.sectionId, entry);
      }

      return {
        items: items.map((d) => ({
          ...d,
          copyCount: bySection.get(d.id)?.count ?? 0,
          ownerName: d.ownerCustomerId ? (names.get(d.ownerCustomerId) ?? null) : null,
          worstTone: worstTone(bySection.get(d.id)?.tones ?? []),
        })),
        total: result[0]?.count ?? 0,
      };
    }),

  /**
   * The board tiles (FP-DR-01/17): live sections, sections without copies, and copies by status
   * (available, in use, at nitriding, at maker, on trial, retired). Any member. One grouped read each.
   */
  boardCounts: companyProcedure.query(async ({ ctx }) => {
    const [byStatus, sections] = await Promise.all([
      ctx.db
        .select({ status: dieInstance.status, n: sql<number>`count(*)` })
        .from(dieInstance)
        .innerJoin(die, and(eq(die.id, dieInstance.sectionId), eq(die.companyId, dieInstance.companyId)))
        .where(and(eq(dieInstance.companyId, ctx.companyId), isNull(die.deletedAt)))
        .groupBy(dieInstance.status),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
          withoutCopies: sql<number>`coalesce(sum(case when not exists (select 1 from die_instance lc where lc.company_id = ${die.companyId} and lc.section_id = ${die.id} and lc.status <> 'retired') then 1 else 0 end), 0)`,
        })
        .from(die)
        .where(and(eq(die.companyId, ctx.companyId), isNull(die.deletedAt))),
    ]);
    const copies = Object.fromEntries(dieInstanceStatuses.map((status) => [status, 0])) as Record<(typeof dieInstanceStatuses)[number], number>;
    for (const row of byStatus) copies[row.status] = Number(row.n);
    return { sections: Number(sections[0]?.total ?? 0), sectionsWithoutCopies: Number(sections[0]?.withoutCopies ?? 0), copies };
  }),

  /**
   * The section with its bands (primary first), copies (with current weight, percent, tone, band
   * position, kg/m), files and owner. Each band lists copies lifted off it ("Lifted to {band} on
   * {date}") from the applied lift rows, so the empty slot shows.
   */
  get: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.id, input.id),
          eq(die.companyId, ctx.companyId),
          isNull(die.deletedAt)
        ),
      });

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      const [bandRows, copyRows, files, lifts, driftBands] = await Promise.all([
        ctx.db
          .select()
          .from(dieBand)
          .where(and(eq(dieBand.companyId, ctx.companyId), eq(dieBand.sectionId, item.id)))
          .orderBy(asc(dieBand.weightMinG), asc(dieBand.weightMaxG)),
        ctx.db
          .select({
            id: dieInstance.id,
            code: dieInstance.code,
            seqNo: dieInstance.seqNo,
            status: dieInstance.status,
            tierRank: dieInstance.tierRank,
            bandId: dieInstance.bandId,
            ownerCustomerId: dieInstance.ownerCustomerId,
            cavityCount: dieInstance.cavityCount,
            rackNo: dieInstance.rackNo,
            latest: latestReadingSql(),
          })
          .from(dieInstance)
          .where(and(eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.sectionId, item.id)))
          .orderBy(asc(dieInstance.seqNo)),
        ctx.db
          .select()
          .from(dieFile)
          .where(and(eq(dieFile.companyId, ctx.companyId), eq(dieFile.sectionId, item.id)))
          .orderBy(desc(dieFile.createdAt)),
        ctx.db
          .select({
            dieInstanceId: dieTierChange.dieInstanceId,
            code: dieInstance.code,
            fromBandId: dieTierChange.fromBandId,
            toBandId: dieTierChange.toBandId,
            effectiveAt: dieTierChange.effectiveAt,
          })
          .from(dieTierChange)
          .innerJoin(dieInstance, and(eq(dieInstance.id, dieTierChange.dieInstanceId), eq(dieInstance.companyId, dieTierChange.companyId)))
          .where(
            and(
              eq(dieTierChange.companyId, ctx.companyId),
              eq(dieInstance.sectionId, item.id),
              eq(dieTierChange.isLift, true),
              eq(dieTierChange.status, "applied"),
            ),
          )
          .orderBy(desc(dieTierChange.effectiveAt)),
        loadDriftBands(ctx.db, ctx.companyId),
      ]);

      const primary = primaryBand(item);
      const bandById = new Map(bandRows.map((b) => [b.id, b]));
      const names = await customerNames(ctx.db, ctx.companyId, [item.ownerCustomerId, ...copyRows.map((c) => c.ownerCustomerId)]);
      const copies = copyRows.map((c) => {
        const band = effectiveBand(item, c.bandId ? bandById.get(c.bandId) : null);
        const ownerId = effectiveDieOwner(c.ownerCustomerId, item.ownerCustomerId);
        return {
          ...c,
          effectiveBandId: band.id,
          ownerCustomerIdEffective: ownerId,
          ownerName: ownerId ? (names.get(ownerId) ?? null) : null,
          ...copyFigures(c.latest, band, driftBands),
        };
      });
      const liftedOut = (bandId: string | null) =>
        lifts
          .filter((l) => (l.fromBandId ?? null) === bandId)
          .map((l) => {
            const to = l.toBandId ? bandById.get(l.toBandId) : null;
            const toBand = to ? effectiveBand(item, { ...to, active: true }) : primary;
            return { dieInstanceId: l.dieInstanceId, code: l.code, toBandId: l.toBandId, toBand: bandText(toBand), toWeightMinG: toBand.weightMinG, toWeightMaxG: toBand.weightMaxG, at: l.effectiveAt };
          });
      const bandsOut = [
        { ...primary, active: true, primary: true, copyIds: copies.filter((c) => c.effectiveBandId === null).map((c) => c.id), liftedOut: liftedOut(null) },
        ...bandRows.map((b) => ({
          id: b.id,
          wallTenthMm: b.wallTenthMm,
          weightMinG: b.weightMinG,
          weightMaxG: b.weightMaxG,
          label: b.label,
          active: b.active,
          primary: false,
          copyIds: copies.filter((c) => c.effectiveBandId === b.id).map((c) => c.id),
          liftedOut: liftedOut(b.id),
        })),
      ];

      return {
        ...item,
        ownerName: item.ownerCustomerId ? (names.get(item.ownerCustomerId) ?? null) : null,
        wallTenthMmEffective: primary.wallTenthMm,
        primaryKgPerMetre: { min: kgPerMetre(item.weightMinG), max: kgPerMetre(item.weightMaxG) },
        bands: bandsOut,
        copies,
        files,
      };
    }),

  create: actionProcedure("die.create")
    .input(dieBaseSchema.extend(dieExtraFields))
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      // Check duplicate (including soft-deleted dies: they still hold the unique code)
      const existing = await ctx.db.query.die.findFirst({
        where: and(
          eq(die.companyId, ctx.companyId),
          eq(die.series, input.series),
          eq(die.sectionCode, input.sectionCode),
        )
      });

      if (existing?.deletedAt) {
        throw new TRPCError(DELETED_DIE_CONFLICT);
      }
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A die with this series and section code already exists" });
      }

      const ownerCustomerId = input.ownerCustomerId ?? null;
      if (ownerCustomerId) await requireLiveCustomer(ctx.db, ctx.companyId, ownerCustomerId);
      // FP-DR-14: alloy and temper default from the plant settings when the form leaves them out.
      const settings = await loadFloorSettings(ctx.db, ctx.companyId);

      const id = crypto.randomUUID();
      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db.insert(die).values({
          id,
          companyId: ctx.companyId,
          serverSeq,
          series: input.series,
          sectionCode: input.sectionCode,
          name: input.name,
          legMm: input.legMm ?? null,
          widthMm: input.widthMm ?? null,
          thicknessMm: input.thicknessMm ?? null,
          dimensions: {
            ...input.dimensions,
            widthMm: input.widthMm ?? input.dimensions.widthMm,
            thicknessMm: input.thicknessMm ?? input.dimensions.thicknessMm,
          },
          weightMinG: input.weightMinG,
          weightMaxG: input.weightMaxG,
          status: input.status,
          notes: input.notes,
          alloy: input.alloy === undefined ? settings.defaultAlloy : input.alloy,
          temper: input.temper === undefined ? settings.defaultTemper : input.temper,
          profileKind: input.profileKind ?? null,
          ownerCustomerId,
          cavityCount: input.cavityCount ?? null,
          wallTenthMm: input.wallTenthMm ?? null,
        }),
        auditInsert(
          auditOf(ctx),
          {
            action: "die.create",
            subjectType: "die",
            subjectId: id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          },
        ),
        ...(ownerCustomerId
          ? [
              auditInsert(auditOf(ctx), {
                action: "die_owner.set",
                subjectType: "die",
                subjectId: id,
                meta: { from: null, to: ownerCustomerId, sectionCode: input.sectionCode },
              }),
            ]
          : []),
      ]);

      return { success: true, id };
    }),

  update: actionProcedure("die.update")
    .input(dieBaseSchema.extend({ id: z.string(), ...dieExtraFields }))
    .mutation(async ({ ctx, input }) => {
      if (input.weightMinG > input.weightMaxG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Min weight cannot be greater than max weight" });
      }

      const existing = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, input.id), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      if (existing.series !== input.series || existing.sectionCode !== input.sectionCode) {
        const duplicate = await ctx.db.query.die.findFirst({
          where: and(
            eq(die.companyId, ctx.companyId),
            eq(die.series, input.series),
            eq(die.sectionCode, input.sectionCode),
          ),
        });
        if (duplicate?.deletedAt) {
          throw new TRPCError(DELETED_DIE_CONFLICT);
        }
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another die with this series and section code already exists",
          });
        }
      }

      // The primary band takes part in the band duplicate guard (FP-DR-02).
      const next = {
        ...existing,
        series: input.series,
        sectionCode: input.sectionCode,
        thicknessMm: input.thicknessMm ?? null,
        wallTenthMm: input.wallTenthMm === undefined ? existing.wallTenthMm : input.wallTenthMm,
        weightMinG: input.weightMinG,
        weightMaxG: input.weightMaxG,
      };
      const nextKey = { wallTenthMm: sectionWallTenth(next), weightMinG: next.weightMinG, weightMaxG: next.weightMaxG };
      const primaryMoved =
        nextKey.wallTenthMm !== sectionWallTenth(existing) || nextKey.weightMinG !== existing.weightMinG || nextKey.weightMaxG !== existing.weightMaxG;
      if (primaryMoved) {
        const clash = await findDuplicateBand(ctx.db, ctx.companyId, next, nextKey, { skipPrimary: true });
        if (clash) throw duplicateBandError(clash);
      }

      const ownerChanged = input.ownerCustomerId !== undefined && (input.ownerCustomerId ?? null) !== existing.ownerCustomerId;
      if (ownerChanged && input.ownerCustomerId) {
        await requireLiveCustomer(ctx.db, ctx.companyId, input.ownerCustomerId);
        // C2: a copy cannot belong to someone other than the section owner.
        const [clash] = await ctx.db
          .select({ code: dieInstance.code })
          .from(dieInstance)
          .where(
            and(
              eq(dieInstance.companyId, ctx.companyId),
              eq(dieInstance.sectionId, existing.id),
              isNotNull(dieInstance.ownerCustomerId),
              ne(dieInstance.ownerCustomerId, input.ownerCustomerId),
            ),
          )
          .limit(1);
        if (clash) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${clash.code} belongs to another customer; clear that copy's owner first`,
          });
        }
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const pick = <K extends keyof typeof dieExtraFields>(k: K) => (input[k] === undefined ? existing[k] : input[k]);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(die)
          .set({
            series: input.series,
            sectionCode: input.sectionCode,
            name: input.name,
            legMm: input.legMm ?? null,
            widthMm: input.widthMm ?? null,
            thicknessMm: input.thicknessMm ?? null,
            dimensions: {
              ...input.dimensions,
              widthMm: input.widthMm ?? input.dimensions.widthMm,
              thicknessMm: input.thicknessMm ?? input.dimensions.thicknessMm,
            },
            weightMinG: input.weightMinG,
            weightMaxG: input.weightMaxG,
            status: input.status,
            notes: input.notes,
            alloy: pick("alloy"),
            temper: pick("temper"),
            profileKind: pick("profileKind"),
            ownerCustomerId: pick("ownerCustomerId"),
            cavityCount: pick("cavityCount"),
            wallTenthMm: pick("wallTenthMm"),
            serverSeq,
          })
          .where(and(eq(die.id, input.id), eq(die.companyId, ctx.companyId))),
        auditInsert(
          auditOf(ctx),
          {
            action: "die.update",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: input.series, sectionCode: input.sectionCode },
          },
        ),
        ...(ownerChanged
          ? [
              auditInsert(auditOf(ctx), {
                action: "die_owner.set",
                subjectType: "die",
                subjectId: input.id,
                meta: { from: existing.ownerCustomerId, to: input.ownerCustomerId ?? null, sectionCode: input.sectionCode },
              }),
            ]
          : []),
      ]);

      return { success: true };
    }),

  delete: actionProcedure("die.delete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, input.id), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      await atomicBatch(ctx.db, [
        ctx.db
          .update(die)
          .set({
            deletedAt: new Date(),
            serverSeq,
          })
          .where(eq(die.id, input.id)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.delete",
            subjectType: "die",
            subjectId: input.id,
            meta: { series: existing.series, sectionCode: existing.sectionCode },
          },
        ),
      ]);

      return { success: true };
    }),

  validateImport: actionProcedure("die.import")
    .input(z.array(dieImportRow).max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"))
    .mutation(async ({ ctx, input }) => {
      type Row = z.infer<typeof dieBaseSchema>;
      const validRows: Row[] = [];
      const duplicates: (Row & { existingId: string })[] = [];
      // Rows whose code is held by a soft-deleted die: importing them would hit the unique index.
      const errors: (Row & { error: string })[] = [];

      // One chunked lookup (live and deleted dies) instead of a query per row.
      const codes = [...new Set(input.map((row) => row.sectionCode))];
      const found = await mapInChunks(codes, (slice) =>
        ctx.db
          .select({ id: die.id, series: die.series, sectionCode: die.sectionCode, deletedAt: die.deletedAt })
          .from(die)
          .where(and(eq(die.companyId, ctx.companyId), inArray(die.sectionCode, slice))),
      );
      const byKey = new Map(found.map((d) => [`${d.series}\u0000${d.sectionCode}`, d]));

      for (const row of input) {
        const existing = byKey.get(`${row.series}\u0000${row.sectionCode}`);
        if (!existing) {
          validRows.push(row);
        } else if (existing.deletedAt) {
          errors.push({ ...row, error: DELETED_DIE_CONFLICT.message });
        } else {
          duplicates.push({ ...row, existingId: existing.id });
        }
      }

      return { validRows, duplicates, errors };
    }),

  processImport: actionProcedure("die.import")
    .input(z.object({
      newRows: z.array(dieImportRow).max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"),
      updatedRows: z
        .array(dieImportUpdateRow)
        .max(MAX_IMPORT_ROWS, "Max 2000 rows per import — split larger files into batches"),
      /** Same id, same rows: a resend answers `replayed` instead of failing on the new dies' codes (lib/importReplay). */
      clientRequestId: clientRequestIdSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.newRows.length === 0 && input.updatedRows.length === 0) {
        return { success: true, count: 0, replayed: false };
      }

      // New dies get request-derived ids, so a chunk that already landed is recognised; updates are
      // idempotent on their own (same values again), so a chunk of updates only is simply re-applied.
      const count = input.newRows.length + input.updatedRows.length;
      const newIds =
        input.clientRequestId && input.newRows.length > 0
          ? await requestRowIds(ctx.companyId, "die.import", input.clientRequestId, input.newRows.length)
          : null;
      const landed = async (ids: string[]) =>
        replayState(
          ids,
          (
            await ctx.db
              .select({ id: die.id })
              .from(die)
              .where(and(eq(die.companyId, ctx.companyId), inArray(die.id, replayProbe(ids))))
          ).map((r) => r.id),
        );
      if (newIds) {
        const state = await landed(newIds);
        if (state === "replayed") return { success: true, count, replayed: true };
        if (state === "conflict") throw new TRPCError(REQUEST_ID_CONFLICT);
      }

      if (input.newRows.length > 0) {
        const codes = [...new Set(input.newRows.map((row) => row.sectionCode))];
        const deleted = await mapInChunks(codes, (slice) =>
          ctx.db
            .select({ series: die.series, sectionCode: die.sectionCode })
            .from(die)
            .where(
              and(
                eq(die.companyId, ctx.companyId),
                isNotNull(die.deletedAt),
                inArray(die.sectionCode, slice),
              ),
            ),
        );
        const taken = new Set(deleted.map((d) => `${d.series}\u0000${d.sectionCode}`));
        if (input.newRows.some((row) => taken.has(`${row.series}\u0000${row.sectionCode}`))) {
          throw new TRPCError(DELETED_DIE_CONFLICT);
        }
      }

      const serverSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [];

      if (input.newRows.length > 0) {
        // New sections take the plant's default alloy / temper, as `die.create` does (FP-DR-14).
        const settings = await loadFloorSettings(ctx.db, ctx.companyId);
        const values = input.newRows.map((row, i) => ({
          id: newIds?.[i] ?? crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq,
          alloy: settings.defaultAlloy,
          temper: settings.defaultTemper,
          series: row.series,
          sectionCode: row.sectionCode,
          name: row.name,
          legMm: row.legMm ?? null,
          widthMm: row.widthMm ?? null,
          thicknessMm: row.thicknessMm ?? null,
          dimensions: {
            ...row.dimensions,
            widthMm: row.widthMm ?? row.dimensions.widthMm,
            thicknessMm: row.thicknessMm ?? row.dimensions.thicknessMm,
          },
          weightMinG: row.weightMinG,
          weightMaxG: row.weightMaxG,
          status: row.status,
          notes: row.notes,
        }));
        pushChunkedInserts(statements, (rows) => ctx.db.insert(die).values(rows), values);
      }

      for (const row of input.updatedRows) {
        statements.push(
          ctx.db
            .update(die)
            .set(dieImportUpdateSet(row, serverSeq))
            .where(and(eq(die.id, row.existingId), eq(die.companyId, ctx.companyId))),
        );
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "die.import",
            subjectType: "die",
            meta: { newCount: input.newRows.length, updateCount: input.updatedRows.length },
          },
        ),
      );

      try {
        await atomicBatch(ctx.db, statements);
      } catch (error) {
        // An identical request landed a moment earlier: its die ids are taken, so this batch rolled back.
        if (newIds && (await landed(newIds)) === "replayed") return { success: true, count, replayed: true };
        throw error;
      }

      return { success: true, count, replayed: false };
    }),
});
