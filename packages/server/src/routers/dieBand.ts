/**
 * Bands under a section (FP-DR-02/03/04), mounted as `die.bands`. The primary band stays on the
 * section (`die.weight_min_g/max_g`) and is never copied here, but it takes part in the duplicate
 * guard: one active band per (section, wall tenths, min g, max g). A second COPY on a band is
 * always allowed; only a second BAND is refused (CONFLICT, `meta.existing` names the band).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dieBand, dieInstance, dieTierChange } from "@orrn/db/schema/dies";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { audit, auditCtx, errorText, loadSection, sectionWallTenth } from "../lib/dieRoom";
import { TRPCMetaError } from "../lib/errorMeta";
import { nextCompanySeq } from "../lib/sequence";
import type { OrrnDb } from "../lib/atomic";

const grams = z.number().int().min(1).max(500_000);
const wallTenth = z.number().int().min(1).max(10_000);

export type BandKey = { wallTenthMm: number; weightMinG: number; weightMaxG: number };

/** What a duplicate guard hit reports (`meta.existing`). */
export type ExistingBand = {
  sectionCode: string;
  series: string;
  wallTenthMm: number;
  weightMinG: number;
  weightMaxG: number;
  bandId: string | "primary";
};

/**
 * The duplicate guard (FP-DR-02): the section's primary band or another active band with the same
 * wall, min and max. `exceptBandId` skips the band being edited. Null = free.
 */
export async function findDuplicateBand(
  db: OrrnDb,
  companyId: string,
  section: { id: string; series: string; sectionCode: string; wallTenthMm: number | null; thicknessMm: number | null; weightMinG: number; weightMaxG: number },
  key: BandKey,
  opts: { exceptBandId?: string; skipPrimary?: boolean } = {},
): Promise<ExistingBand | null> {
  const base = { sectionCode: section.sectionCode, series: section.series, ...key };
  if (
    !opts.skipPrimary &&
    sectionWallTenth(section) === key.wallTenthMm &&
    section.weightMinG === key.weightMinG &&
    section.weightMaxG === key.weightMaxG
  ) {
    return { ...base, bandId: "primary" };
  }
  const [hit] = await db
    .select({ id: dieBand.id })
    .from(dieBand)
    .where(
      and(
        eq(dieBand.companyId, companyId),
        eq(dieBand.sectionId, section.id),
        eq(dieBand.active, true),
        eq(dieBand.wallTenthMm, key.wallTenthMm),
        eq(dieBand.weightMinG, key.weightMinG),
        eq(dieBand.weightMaxG, key.weightMaxG),
        opts.exceptBandId ? ne(dieBand.id, opts.exceptBandId) : undefined,
      ),
    )
    .limit(1);
  return hit ? { ...base, bandId: hit.id } : null;
}

export function duplicateBandError(existing: ExistingBand): TRPCMetaError {
  const where = existing.bandId === "primary" ? "the primary band" : "a band";
  return new TRPCMetaError({
    code: "CONFLICT",
    message: `${existing.sectionCode} already has ${where} ${(existing.weightMinG / 1000).toFixed(3)}-${(existing.weightMaxG / 1000).toFixed(3)} at ${(existing.wallTenthMm / 10).toFixed(1)} mm. Add the copy to that band instead.`,
    meta: { existing },
  });
}

const bandFields = {
  wallTenthMm: wallTenth,
  weightMinG: grams,
  weightMaxG: grams,
  label: z.string().trim().max(40).nullable().optional(),
};
const minMax = [(b: { weightMinG: number; weightMaxG: number }) => b.weightMinG <= b.weightMaxG, { message: "Min weight cannot be greater than max weight" }] as const;

async function loadBand(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db.select().from(dieBand).where(and(eq(dieBand.id, id), eq(dieBand.companyId, companyId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Band not found" });
  return row;
}

export const dieBandRouter = router({
  /** Active bands of a section (retired with `includeRetired`), lightest first. Any member. */
  list: companyProcedure
    .input(z.object({ sectionId: z.string().min(1), includeRetired: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId, { includeDeleted: true });
      const bands = await ctx.db
        .select()
        .from(dieBand)
        .where(
          and(
            eq(dieBand.companyId, ctx.companyId),
            eq(dieBand.sectionId, section.id),
            input.includeRetired ? undefined : eq(dieBand.active, true),
          ),
        )
        .orderBy(asc(dieBand.weightMinG), asc(dieBand.weightMaxG));
      return {
        primary: {
          id: null,
          wallTenthMm: sectionWallTenth(section),
          weightMinG: section.weightMinG,
          weightMaxG: section.weightMaxG,
          label: null,
        },
        bands,
      };
    }),

  create: actionProcedure("die.update")
    .input(z.object({ sectionId: z.string().min(1), ...bandFields }).refine(...minMax))
    .mutation(async ({ ctx, input }) => {
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId);
      const key = { wallTenthMm: input.wallTenthMm, weightMinG: input.weightMinG, weightMaxG: input.weightMaxG };
      const existing = await findDuplicateBand(ctx.db, ctx.companyId, section, key);
      if (existing) throw duplicateBandError(existing);

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(dieBand).values({
            id,
            companyId: ctx.companyId,
            serverSeq: seq,
            sectionId: section.id,
            ...key,
            label: input.label ?? null,
            createdBy: ctx.session.user.id,
          }),
          audit(ctx, {
            action: "die_band.create",
            subjectType: "die_band",
            subjectId: id,
            meta: { sectionId: section.id, sectionCode: section.sectionCode, ...key, label: input.label ?? null },
          }),
        ]);
      } catch (e) {
        // Lost a race with the same band: the partial unique index answers.
        if (errorText(e).includes("die_band.")) {
          const again = await findDuplicateBand(ctx.db, ctx.companyId, section, key);
          if (again) throw duplicateBandError(again);
        }
        throw e;
      }
      return { id };
    }),

  /** Label, wall and grams of an active band. Copies on it move with it (they point at the id). */
  update: actionProcedure("die.update")
    .input(z.object({ id: z.string().min(1), ...bandFields }).refine(...minMax))
    .mutation(async ({ ctx, input }) => {
      const band = await loadBand(ctx.db, ctx.companyId, input.id);
      if (!band.active) throw new TRPCError({ code: "BAD_REQUEST", message: "This band is retired" });
      const section = await loadSection(ctx.db, ctx.companyId, band.sectionId);
      const key = { wallTenthMm: input.wallTenthMm, weightMinG: input.weightMinG, weightMaxG: input.weightMaxG };
      const existing = await findDuplicateBand(ctx.db, ctx.companyId, section, key, { exceptBandId: band.id });
      if (existing) throw duplicateBandError(existing);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(dieBand)
            .set({ ...key, label: input.label === undefined ? band.label : input.label, serverSeq: seq })
            .where(and(eq(dieBand.id, band.id), eq(dieBand.companyId, ctx.companyId), eq(dieBand.active, true))),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "die_band.update",
              subjectType: "die_band",
              subjectId: band.id,
              meta: {
                before: { wallTenthMm: band.wallTenthMm, weightMinG: band.weightMinG, weightMaxG: band.weightMaxG, label: band.label },
                after: { ...key, label: input.label ?? null },
              },
            },
            { from: dieBand, where: and(eq(dieBand.id, band.id), eq(dieBand.serverSeq, seq)) },
          ),
        ]);
      } catch (e) {
        if (errorText(e).includes("die_band.")) {
          const again = await findDuplicateBand(ctx.db, ctx.companyId, section, key, { exceptBandId: band.id });
          if (again) throw duplicateBandError(again);
        }
        throw e;
      }
      return { success: true };
    }),

  /**
   * Retire a band (active = 0; never deleted). Refused while a non-retired copy is on it or a
   * pending lift targets it.
   */
  retire: actionProcedure("die.update")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const band = await loadBand(ctx.db, ctx.companyId, input.id);
      if (!band.active) return { success: true };
      const [onBand] = await ctx.db
        .select({ code: dieInstance.code })
        .from(dieInstance)
        .where(and(eq(dieInstance.companyId, ctx.companyId), eq(dieInstance.bandId, band.id), ne(dieInstance.status, "retired")))
        .limit(1);
      if (onBand) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${onBand.code} is still on this band; lift it to another band first` });
      }
      const [pendingLift] = await ctx.db
        .select({ id: dieTierChange.id })
        .from(dieTierChange)
        .where(and(eq(dieTierChange.companyId, ctx.companyId), eq(dieTierChange.toBandId, band.id), eq(dieTierChange.status, "pending")))
        .limit(1);
      if (pendingLift) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A lift to this band is waiting for approval" });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      // Guarded at write time too: a copy moved onto the band in between keeps it active.
      const noCopy = sql`not exists (select 1 from die_instance i where i.company_id = ${ctx.companyId} and i.band_id = ${band.id} and i.status <> 'retired')`;
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dieBand)
          .set({ active: false, serverSeq: seq })
          .where(and(eq(dieBand.id, band.id), eq(dieBand.companyId, ctx.companyId), eq(dieBand.active, true), noCopy)),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "die_band.retire", subjectType: "die_band", subjectId: band.id, meta: { sectionId: band.sectionId } },
          { from: dieBand, where: and(eq(dieBand.id, band.id), eq(dieBand.serverSeq, seq), eq(dieBand.active, false)) },
        ),
      ]);
      const after = await loadBand(ctx.db, ctx.companyId, band.id);
      if (after.active) throw new TRPCError({ code: "CONFLICT", message: "A copy was put on this band; try again" });
      return { success: true };
    }),
});

/** Section columns `findDuplicateBand` needs. */
export const sectionBandColumns = {
  id: die.id,
  series: die.series,
  sectionCode: die.sectionCode,
  wallTenthMm: die.wallTenthMm,
  thicknessMm: die.thicknessMm,
  weightMinG: die.weightMinG,
  weightMaxG: die.weightMaxG,
};
