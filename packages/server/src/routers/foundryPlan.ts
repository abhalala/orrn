/**
 * Foundry planning and sheets (XE parity lane FOUNDRY): the charge-mix suggestion with its typical
 * chemistry master (#47), the cast data sheet (#45) and the casting plan (#46). Spread into
 * `foundryRouter` (and the data sheet into `foundry.casts`), so the `foundry` module gates mutations.
 */
import { CHARGE_CHEMISTRY_ELEMENTS, suggestChargeMix, type ChargeSource, type SpectroElementKey } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { alloy, alloyLimit, furnace, melt, meltReading, returnStream } from "@orrn/db/schema/foundry";
import { billetCut, chargeChemistry, chargeChemistrySubjects, foundryReject, homogBatch, homogLine, logReceipt } from "@orrn/db/schema/foundryDepth";
import { purchaseLot, scrapGrade, scrapItem, vendor } from "@orrn/db/schema/purchase";
import { reasonCode } from "@orrn/db/schema/reasons";
import { stockLedger } from "@orrn/db/schema/stock";
import { membership } from "@orrn/db/schema/tenant";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, mapInChunks, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { lotDrawnSql, lotStockSql, OUTER_LOT_ID, resolvePlantScrap } from "../lib/foundry";
import { loadCast } from "../lib/foundryKit";
import { ctxCan } from "../lib/permissions";

const id = z.string().min(1).max(64);
const num = (v: unknown) => Number(v ?? 0);
const LOTS_MAX = 500;

const ppmMap = z
  .record(z.string(), z.number().int().min(0).max(1_000_000).nullable())
  .refine((m) => Object.keys(m).every((k) => (CHARGE_CHEMISTRY_ELEMENTS as readonly string[]).includes(k)), "Unknown element");

/** Typical chemistry rows → { subjectId: { si: ppm, … } }. */
async function chemistryOf(ctx: { db: OrrnDb; companyId: string }, kind: "item" | "stream") {
  const rows = await ctx.db
    .select({ subjectId: chargeChemistry.subjectId, element: chargeChemistry.element, ppm: chargeChemistry.ppm })
    .from(chargeChemistry)
    .where(and(eq(chargeChemistry.companyId, ctx.companyId), eq(chargeChemistry.subjectKind, kind)));
  const out = new Map<string, Partial<Record<SpectroElementKey, number>>>();
  for (const r of rows) out.set(r.subjectId, { ...(out.get(r.subjectId) ?? {}), [r.element]: r.ppm });
  return out;
}

const chargeMix = router({
  /** Every scrap item and every charge stream, with the typical chemistry the plant set. Any member. */
  chemistry: companyProcedure.query(async ({ ctx }) => {
    const [items, streams, itemChem, streamChem] = await Promise.all([
      ctx.db
        .select({ id: scrapItem.id, name: scrapItem.name, active: scrapItem.active })
        .from(scrapItem)
        .where(eq(scrapItem.companyId, ctx.companyId))
        .orderBy(asc(scrapItem.sortOrder), asc(scrapItem.name))
        .limit(500),
      ctx.db
        .select({ id: returnStream.id, code: returnStream.code, name: returnStream.name, active: returnStream.active })
        .from(returnStream)
        .where(and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.kind, "charge")))
        .orderBy(asc(returnStream.sortOrder)),
      chemistryOf(ctx, "item"),
      chemistryOf(ctx, "stream"),
    ]);
    return {
      elements: CHARGE_CHEMISTRY_ELEMENTS,
      items: items.map((g) => ({ ...g, ppm: itemChem.get(g.id) ?? null })),
      streams: streams.map((s) => ({ ...s, ppm: streamChem.get(s.id) ?? null })),
    };
  }),

  /** Set the typical chemistry of one scrap item or stream (replaces what was there; null clears an element). */
  setChemistry: actionProcedure("masters.publish")
    .input(z.object({ subjectKind: z.enum(chargeChemistrySubjects), subjectId: id, ppm: ppmMap }))
    .mutation(async ({ ctx, input }) => {
      const [subject] =
        input.subjectKind === "item"
          ? await ctx.db.select({ id: scrapItem.id, label: scrapItem.name }).from(scrapItem).where(and(eq(scrapItem.id, input.subjectId), eq(scrapItem.companyId, ctx.companyId))).limit(1)
          : await ctx.db.select({ id: returnStream.id, label: returnStream.code }).from(returnStream).where(and(eq(returnStream.id, input.subjectId), eq(returnStream.companyId, ctx.companyId))).limit(1);
      if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: input.subjectKind === "item" ? "Scrap item not found" : "Return stream not found" });
      const entries = Object.entries(input.ppm).filter((e): e is [SpectroElementKey, number] => e[1] != null);
      const statements: SqliteBatchItem[] = [
        ctx.db.delete(chargeChemistry).where(and(eq(chargeChemistry.companyId, ctx.companyId), eq(chargeChemistry.subjectKind, input.subjectKind), eq(chargeChemistry.subjectId, subject.id))),
      ];
      if (entries.length > 0) {
        statements.push(
          ctx.db.insert(chargeChemistry).values(
            entries.map(([element, ppm]) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, subjectKind: input.subjectKind, subjectId: subject.id, element, ppm, updatedBy: ctx.session.user.id, updatedAt: new Date() })),
          ),
        );
      }
      statements.push(auditInsert(ctx, { action: "foundry.chemistry.set", subjectType: input.subjectKind === "item" ? "scrap_item" : "return_stream", subjectId: subject.id, meta: { code: subject.label, ppm: Object.fromEntries(entries) } }));
      await atomicBatch(ctx.db, statements);
      return { id: subject.id, elements: entries.length };
    }),

  /**
   * The cheapest mix of available lots and return streams for `targetKgG` of an alloy, inside its limits,
   * from the typical chemistry of each lot's scrap item and of each stream (see `suggestChargeMix`). A suggestion only: the melt screen shows it and
   * nothing is applied. Lot rates price the mix; the cost is returned only to people who read purchase
   * figures (the foundry picks lots without seeing what they cost, RP9).
   */
  suggest: anyActionProcedure("melt.enter", "cast.enter", "masters.publish")
    .input(z.object({ alloyId: id, targetKgG: z.number().int().min(1_000).max(100_000_000) }))
    .query(async ({ ctx, input }) => {
      const [a] = await ctx.db.select().from(alloy).where(and(eq(alloy.id, input.alloyId), eq(alloy.companyId, ctx.companyId))).limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Alloy not found" });
      const limits = await ctx.db.select({ element: alloyLimit.element, minPpm: alloyLimit.minPpm, maxPpm: alloyLimit.maxPpm }).from(alloyLimit).where(and(eq(alloyLimit.companyId, ctx.companyId), eq(alloyLimit.alloyId, a.id)));
      const stock = lotStockSql(ctx.companyId, OUTER_LOT_ID);
      const drawn = lotDrawnSql(ctx.companyId, OUTER_LOT_ID);
      const lots = await ctx.db
        .select({ id: purchaseLot.id, number: purchaseLot.number, itemId: purchaseLot.scrapItemId, gradeCode: scrapGrade.code, itemName: scrapItem.name, ratePaise: purchaseLot.ratePaise, stockG: stock, drawnG: drawn })
        .from(purchaseLot)
        .innerJoin(scrapItem, and(eq(scrapItem.id, purchaseLot.scrapItemId), eq(scrapItem.companyId, purchaseLot.companyId)))
        .innerJoin(scrapGrade, and(eq(scrapGrade.id, purchaseLot.scrapGradeId), eq(scrapGrade.companyId, purchaseLot.companyId)))
        .where(and(eq(purchaseLot.companyId, ctx.companyId), eq(purchaseLot.status, "ok"), sql`${stock} - ${drawn} > 0`))
        .limit(LOTS_MAX);
      const [itemChem, streamChem] = await Promise.all([chemistryOf(ctx, "item"), chemistryOf(ctx, "stream")]);
      const streams = await ctx.db.select().from(returnStream).where(and(eq(returnStream.companyId, ctx.companyId), eq(returnStream.kind, "charge"), eq(returnStream.active, true)));
      let scrapId: string | null = null;
      try {
        scrapId = (await resolvePlantScrap(ctx.db, ctx.companyId)).id;
      } catch {
        scrapId = null;
      }
      // Stream balances at plant scrap: one GROUP BY over the stream rows there.
      const streamBalances = scrapId
        ? await ctx.db
            .select({ id: stockLedger.itemRef, g: sql<number>`sum(${stockLedger.qtyG})` })
            .from(stockLedger)
            .where(and(eq(stockLedger.companyId, ctx.companyId), eq(stockLedger.itemKind, "return_stream"), eq(stockLedger.locationId, scrapId)))
            .groupBy(stockLedger.itemRef)
        : [];
      const balanceOf = new Map(streamBalances.map((b) => [b.id, num(b.g)]));
      const sources: ChargeSource[] = [
        ...lots.map((l) => ({
          key: `lot:${l.id}`,
          kind: "lot" as const,
          label: `${l.number} · ${l.itemName} ${l.gradeCode}`,
          availableG: num(l.stockG) - num(l.drawnG),
          ratePaise: l.ratePaise,
          ppm: itemChem.get(l.itemId) ?? null,
        })),
        ...streams.map((s) => ({ key: `stream:${s.id}`, kind: "stream" as const, label: s.name, availableG: balanceOf.get(s.id) ?? 0, ratePaise: 0, ppm: streamChem.get(s.id) ?? null })),
      ];
      const result = suggestChargeMix({
        targetG: input.targetKgG,
        limits: limits.map((l) => ({ element: l.element as SpectroElementKey, minPpm: l.minPpm, maxPpm: l.maxPpm })),
        sources,
      });
      const seesCost = ctxCan(ctx, "reports.read") || ctxCan(ctx, "purchase.receipt");
      return {
        alloy: a.code,
        targetKgG: input.targetKgG,
        status: result.status,
        lines: result.lines.map((l) => ({ ...l, ref: l.key.slice(l.key.indexOf(":") + 1) })),
        predicted: result.predicted,
        skipped: result.skipped,
        availableG: result.availableG,
        costPaise: seesCost ? result.costPaise : null,
      };
    }),
});

/** `foundry.casts.dataSheet`: what the cast's A4 data sheet needs beyond `casts.get` (names, readings, the log side). */
export const foundryDataSheetProcedures = {
  dataSheet: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const c = await loadCast(ctx, input.id);
    const melts = await ctx.db.select({ id: melt.id, createdBy: melt.createdBy, lockedBy: melt.lockedBy, furnaceId: melt.furnaceId }).from(melt).where(and(eq(melt.companyId, ctx.companyId), eq(melt.castId, c.id)));
    const meltIds = melts.map((m) => m.id);
    const readings = meltIds.length
      ? await mapInChunks(meltIds, (ids) =>
          ctx.db
            .select({ meltId: meltReading.meltId, kind: meltReading.kind, valueX10: meltReading.valueX10, readAt: meltReading.readAt, source: meltReading.source, createdBy: meltReading.createdBy })
            .from(meltReading)
            .where(and(eq(meltReading.companyId, ctx.companyId), inArray(meltReading.meltId, ids)))
            .orderBy(asc(meltReading.readAt)),
        )
      : [];
    const furnaceIds = [...new Set(melts.map((m) => m.furnaceId).filter((v): v is string => Boolean(v)))];
    const furnaces = furnaceIds.length ? await ctx.db.select({ id: furnace.id, code: furnace.code, name: furnace.name }).from(furnace).where(and(eq(furnace.companyId, ctx.companyId), inArray(furnace.id, furnaceIds))) : [];
    const [receipt] = await ctx.db
      .select({ number: logReceipt.number, vendorName: vendor.name, receivedOn: logReceipt.receivedOn, vendorCastNo: logReceipt.vendorCastNo, challanNo: logReceipt.challanNo, pcs: logReceipt.pcs, kgG: logReceipt.kgG, diameterMm: logReceipt.diameterMm, lengthMm: logReceipt.lengthMm, hasMtc: sql<number>`${logReceipt.mtcKey} is not null`, id: logReceipt.id, createdBy: logReceipt.createdBy })
      .from(logReceipt)
      .innerJoin(vendor, and(eq(vendor.id, logReceipt.vendorId), eq(vendor.companyId, logReceipt.companyId)))
      .where(and(eq(logReceipt.companyId, ctx.companyId), eq(logReceipt.castId, c.id)))
      .limit(1);
    const homog = await ctx.db
      .select({ number: homogBatch.number, status: homogBatch.status, targetTempX10: homogBatch.targetTempX10, soakMin: homogBatch.soakMin, soakedMin: homogBatch.soakedMin, inAt: homogBatch.inAt, outAt: homogBatch.outAt, pcs: homogLine.pcs, kgG: homogLine.kgG, releasedBy: homogBatch.releasedBy })
      .from(homogLine)
      .innerJoin(homogBatch, and(eq(homogBatch.id, homogLine.batchId), eq(homogBatch.companyId, homogLine.companyId)))
      .where(and(eq(homogLine.companyId, ctx.companyId), eq(homogLine.castId, c.id)))
      .orderBy(asc(homogBatch.createdAt));
    const cuts = await ctx.db
      .select({ machine: billetCut.machine, logPcs: billetCut.logPcs, logG: billetCut.logG, billetLengthMm: billetCut.billetLengthMm, billetPcs: billetCut.billetPcs, billetG: billetCut.billetG, endG: billetCut.endG, yieldBp: billetCut.yieldBp, cutAt: billetCut.cutAt, createdBy: billetCut.createdBy })
      .from(billetCut)
      .where(and(eq(billetCut.companyId, ctx.companyId), eq(billetCut.castId, c.id)))
      .orderBy(asc(billetCut.cutAt));
    const rejects = await ctx.db
      .select({ kind: foundryReject.kind, reasonCode: reasonCode.code, reasonLabel: reasonCode.label, pcs: foundryReject.pcs, kgG: foundryReject.kgG, rejectedAt: foundryReject.rejectedAt, createdBy: foundryReject.createdBy })
      .from(foundryReject)
      .leftJoin(reasonCode, and(eq(reasonCode.id, foundryReject.reasonCodeId), eq(reasonCode.companyId, foundryReject.companyId)))
      .where(and(eq(foundryReject.companyId, ctx.companyId), eq(foundryReject.castId, c.id)))
      .orderBy(asc(foundryReject.rejectedAt));
    // Names of everyone who did something on the sheet, members of this plant only.
    const actorIds = [
      c.createdBy,
      c.closedBy,
      ...melts.flatMap((m) => [m.createdBy, m.lockedBy]),
      ...readings.map((r) => r.createdBy),
      receipt?.createdBy,
      ...homog.map((h) => h.releasedBy),
      ...cuts.map((x) => x.createdBy),
      ...rejects.map((x) => x.createdBy),
    ].filter((v): v is string => Boolean(v));
    const unique = [...new Set(actorIds)];
    const people = unique.length
      ? await mapInChunks(unique, (ids) =>
          ctx.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .innerJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, ctx.companyId)))
            .where(inArray(user.id, ids)),
        )
      : [];
    return {
      castId: c.id,
      source: c.source,
      people: Object.fromEntries(people.map((p) => [p.id, p.name])),
      melts: melts.map((m) => ({ id: m.id, createdBy: m.createdBy, lockedBy: m.lockedBy, furnace: furnaces.find((f) => f.id === m.furnaceId) ?? null })),
      readings,
      receipt: receipt ? { ...receipt, hasMtc: Boolean(Number(receipt.hasMtc)) } : null,
      homog,
      cuts,
      rejects,
    };
  }),
};

/** Spread into `foundryRouter` (routers/foundry.ts). */
export const foundryPlanRouter = { chargeMix };
