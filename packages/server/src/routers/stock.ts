/**
 * Locations and the kg stock ledger (spec P5/P6, §5; digest Stage 13).
 *
 * - `locations.*`: yard 1-6, billet/scrap/central store, plant scrap; masters.publish edits them.
 * - `move`: bundles to a yard location; − at from, + at to under one voucher (lib/ledger.ts).
 * - `balance` / `byLocation`: read the ledger (optionally as of an instant).
 * - `openingBalance`: takes legacy in-stock bundles (no ledger rows yet) onto the ledger.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { bundle, bundleGroup, packReject } from "@orrn/db/schema/inventory";
import { ledgerItemKinds, location, locationKinds, stockLedger } from "@orrn/db/schema/stock";
import { storeItem } from "@orrn/db/schema/store";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import type { Context } from "../context";
import { atomicBatch, atomicBatchLast, mapInChunks, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { now as clockNow } from "../lib/clock";
import { bundleBandTones } from "../lib/bundleBand";
import { resolveCode } from "../lib/codeResolver";
import { canAny } from "../lib/permissions";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import {
  defaultLocationStatements,
  IN_STOCK_STATUSES,
  ledgerScope,
  locationIsEmpty,
  moveRows,
  openingRows,
  type PostingCtx,
} from "../lib/ledger";
import { nextCompanySeq } from "../lib/sequence";

const locationCode = z
  .string()
  .trim()
  .min(1, "Code is required")
  .max(20)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z0-9][A-Z0-9-]*$/.test(s), "Use letters, digits and dashes")
  // Digest Stage 13: legacy data uses location 0 for "unknown"; it is never a real place.
  .refine((s) => !/^0+$/.test(s), "Location 0 is not allowed");

/** Store stock (consumables) is not for the floor: store keepers, publishers and analytics readers. */
function canSeeStoreStock(role: CompanyRole) {
  return canAny({ company: { role }, isPlatformAdmin: false, platformRole: null }, ["store.txn", "masters.publish", "analytics.view"]);
}

/** The audit writer's slice of the request context. */
function auditCtx(ctx: Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string }) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

function isLocationCodeConflict(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    const message = cur instanceof Error ? cur.message : String(cur);
    if (message.includes("UNIQUE constraint failed: location.company_id, location.code")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const locationsRouter = router({
  list: companyProcedure
    .input(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select()
        .from(location)
        .where(and(eq(location.companyId, ctx.companyId), input.includeInactive ? undefined : eq(location.active, true)))
        .orderBy(asc(location.sortOrder), asc(location.code));
      return { items };
    }),

  create: actionProcedure("masters.publish")
    .input(
      z.object({
        code: locationCode,
        name: z.string().trim().min(1, "Name is required").max(100),
        kind: z.enum(locationKinds),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dupe] = await ctx.db
        .select({ id: location.id })
        .from(location)
        .where(and(eq(location.companyId, ctx.companyId), eq(location.code, input.code)))
        .limit(1);
      if (dupe) throw new TRPCError({ code: "CONFLICT", message: `Location ${input.code} already exists` });

      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(location).values({
            id,
            companyId: ctx.companyId,
            serverSeq: seq,
            code: input.code,
            name: input.name,
            kind: input.kind,
            sortOrder: input.sortOrder ?? 0,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(auditCtx(ctx), {
            action: "location.create",
            subjectType: "location",
            subjectId: id,
            meta: { code: input.code, kind: input.kind },
          }),
        ]);
      } catch (e) {
        if (isLocationCodeConflict(e)) {
          throw new TRPCError({ code: "CONFLICT", message: `Location ${input.code} already exists` });
        }
        throw e;
      }
      return { id };
    }),

  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id: z.string(),
        code: locationCode.optional(),
        name: z.string().trim().min(1).max(100).optional(),
        kind: z.enum(locationKinds).optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.location.findFirst({
        where: and(eq(location.id, input.id), eq(location.companyId, ctx.companyId)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });

      if (input.code && input.code !== existing.code) {
        const [dupe] = await ctx.db
          .select({ id: location.id })
          .from(location)
          .where(and(eq(location.companyId, ctx.companyId), eq(location.code, input.code), ne(location.id, existing.id)))
          .limit(1);
        if (dupe) throw new TRPCError({ code: "CONFLICT", message: `Location ${input.code} already exists` });
      }

      const patch = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      };
      // A retired or re-typed location must be empty. The check is part of the UPDATE itself, so a
      // move or pack that lands after our read cannot slip a bundle in underneath it.
      const retiring = input.active === false && existing.active;
      const retyping = input.kind !== undefined && input.kind !== existing.kind;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mine = and(eq(location.id, existing.id), eq(location.companyId, ctx.companyId), eq(location.serverSeq, seq));
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(location)
            .set({ ...patch, serverSeq: seq })
            .where(
              and(
                eq(location.id, existing.id),
                eq(location.companyId, ctx.companyId),
                retiring || retyping ? locationIsEmpty(ctx.db, ctx.companyId, existing.id) : undefined,
              ),
            ),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "location.update",
              subjectType: "location",
              subjectId: existing.id,
              meta: { before: { code: existing.code, kind: existing.kind, active: existing.active }, patch },
            },
            { from: location, where: mine },
          ),
        ]);
      } catch (e) {
        if (isLocationCodeConflict(e)) {
          throw new TRPCError({ code: "CONFLICT", message: `Location ${input.code} already exists` });
        }
        throw e;
      }
      const [landed] = await ctx.db.select({ id: location.id }).from(location).where(mine).limit(1);
      if (!landed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Location ${existing.code} still holds stock; move it out before ${
            retiring ? "retiring" : "changing the kind of"
          } the location`,
        });
      }
      return { success: true };
    }),

  /** Create the default plant locations (Y1-Y6, BILLET, SCRAP, STORE, PLANT-SCRAP) the company lacks. */
  seedDefaults: actionProcedure("masters.publish").mutation(async ({ ctx }) => {
    const countRows = async () => {
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(location)
        .where(eq(location.companyId, ctx.companyId));
      return Number(row?.n ?? 0);
    };
    const before = await countRows();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    await atomicBatch(ctx.db, [
      ...defaultLocationStatements(ctx.db, ctx.companyId, { userId: ctx.session.user.id, seq }),
      auditInsert(auditCtx(ctx), { action: "location.seedDefaults", subjectType: "location" }),
    ]);
    return { created: (await countRows()) - before };
  }),
});

/** Bundle ids for `codes` (scanned/typed numbers, legacy cuids, QR text), company scoped. */
async function resolveCodes(db: OrrnDb, companyId: string, codes: string[]) {
  const ids: string[] = [];
  const notFound: string[] = [];
  const ambiguous: string[] = [];
  const results = await Promise.all(codes.map((code) => resolveCode(db, companyId, code)));
  results.forEach((r, i) => {
    if (r.kind === "bundle") ids.push(r.bundleId);
    else if (r.kind === "ambiguous") ambiguous.push(codes[i]!);
    else notFound.push(codes[i]!);
  });
  return { ids, notFound, ambiguous };
}

export const stockRouter = router({
  locations: locationsRouter,

  /**
   * Move bundles (by id or by scanned code) to a yard location. All or nothing on validation:
   * unknown ids/codes → NOT_FOUND, dispatched/void bundles → BAD_REQUEST. Bundles already at the
   * target are a no-op. Posts − at from and + at to under one `move` voucher.
   */
  move: actionProcedure("stock.move")
    .input(
      z
        .object({
          bundleIds: z.array(z.string().min(1)).max(500).optional(),
          codes: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
          toLocationId: z.string().min(1),
          reason: z.string().max(500).nullable().optional(),
        })
        .refine((v) => (v.bundleIds?.length ?? 0) + (v.codes?.length ?? 0) > 0, "Scan at least one bundle"),
    )
    .mutation(async ({ ctx, input }) => {
      const to = await ctx.db.query.location.findFirst({
        where: and(eq(location.id, input.toLocationId), eq(location.companyId, ctx.companyId)),
      });
      if (!to) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      if (!to.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Location ${to.code} is retired` });
      if (to.kind !== "yard") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Bundles go to a yard location, not ${to.code}` });
      }

      const resolved = input.codes?.length
        ? await resolveCodes(ctx.db, ctx.companyId, input.codes)
        : { ids: [], notFound: [], ambiguous: [] };
      if (resolved.notFound.length > 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bundle not found: ${resolved.notFound.slice(0, 5).join(", ")}` });
      }
      if (resolved.ambiguous.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `More than one bundle matches ${resolved.ambiguous.slice(0, 5).join(", ")}; scan the full number`,
        });
      }

      const wanted = [...new Set([...(input.bundleIds ?? []), ...resolved.ids])];
      const rows = await mapInChunks(wanted, (ids) =>
        ctx.db
          .select({ id: bundle.id, serial: bundle.serial, status: bundle.status, locationId: bundle.locationId })
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
      );
      if (rows.length !== wanted.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      }
      const blocked = rows.filter((b) => b.status === "dispatched" || b.status === "void");
      if (blocked.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot move ${blocked
            .slice(0, 5)
            .map((b) => `${b.serial} (${b.status})`)
            .join(", ")}${blocked.length > 5 ? ` and ${blocked.length - 5} more` : ""}`,
        });
      }

      const toMove = rows.filter((b) => b.locationId !== to.id);
      const unchanged = rows.length - toMove.length;
      if (toMove.length === 0) {
        return { voucherId: null, moved: 0, unchanged, toLocationCode: to.code };
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const voucherId = crypto.randomUUID();
      const posting: PostingCtx = {
        db: ctx.db,
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        seq,
        postedAt: clockNow(),
      };
      const statements: SqliteBatchItem[] = [
        ...moveRows(posting, {
          voucherId,
          bundleIds: toMove.map((b) => b.id),
          toLocationId: to.id,
          reason: input.reason ?? null,
        }),
        // Only if at least one bundle of this request landed (bundles carry the request's seq).
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "stock.move",
            subjectType: "stock_move",
            subjectId: voucherId,
            meta: {
              toLocationId: to.id,
              toLocationCode: to.code,
              requested: toMove.length,
              serials: toMove.slice(0, 50).map((b) => b.serial),
              reason: input.reason ?? null,
            },
          },
          { from: bundle, where: and(eq(bundle.companyId, ctx.companyId), eq(bundle.serverSeq, seq), eq(bundle.locationId, to.id)) },
        ),
      ];
      // What actually landed, counted inside the batch after the writes: bundles another request
      // changed meanwhile (moved, voided, dispatched) are skipped by the write-time predicate, and
      // this request's seq is unique. (A count after the batch could be skewed by a later request.)
      const [landed] = await atomicBatchLast<{ n: number }>(ctx.db, [
        ...statements,
        ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.serverSeq, seq), eq(bundle.locationId, to.id))),
      ]);
      const moved = Number(landed?.n ?? 0);
      if (moved === 0) {
        // Nothing landed: say so plainly if the target stopped being a usable yard meanwhile.
        const [now] = await ctx.db
          .select({ active: location.active, kind: location.kind })
          .from(location)
          .where(and(eq(location.id, to.id), eq(location.companyId, ctx.companyId)))
          .limit(1);
        if (!now?.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Location ${to.code} is retired` });
        if (now.kind !== "yard") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Bundles go to a yard location, not ${to.code}` });
        }
        return { voucherId: null, moved: 0, unchanged: unchanged + toMove.length, toLocationCode: to.code };
      }
      return { voucherId, moved, unchanged: unchanged + (toMove.length - moved), toLocationCode: to.code };
    }),

  /**
   * FP-PK-08: stock by section and cut length (the Lengths tab). In-stock bundles (available, or
   * reserved = still in the yard) grouped by (section, length): bundles, pcs, kg, kg/12 ft weighted
   * by pieces (grams per 12 ft), its band verdict (D15, `lib/bundleBand.ts`) and how many are held
   * on a dispatch. Optional section and yard filters.
   */
  byDieLength: companyProcedure
    .input(
      z
        .object({
          dieId: z.string().min(1).optional(),
          locationId: z.string().min(1).optional(),
          includeReserved: z.boolean().default(true),
          limit: z.number().int().min(1).max(500).default(200),
          offset: z.number().int().min(0).default(0),
        })
        .default({ includeReserved: true, limit: 200, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const statuses = input.includeReserved ? [...IN_STOCK_STATUSES] : ["available" as const];
      const where = and(
        eq(bundle.companyId, ctx.companyId),
        inArray(bundle.status, statuses),
        input.dieId ? eq(bundle.dieId, input.dieId) : undefined,
        input.locationId ? eq(bundle.locationId, input.locationId) : undefined,
      );
      const rows = await ctx.db
        .select({
          dieId: bundle.dieId,
          sectionCode: die.sectionCode,
          series: die.series,
          name: die.name,
          profileKind: die.profileKind,
          lengthMm: bundle.lengthMm,
          bundles: sql<number>`count(*)`,
          pcs: sql<number>`coalesce(sum(${bundle.quantity}), 0)`,
          weightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          reserved: sql<number>`coalesce(sum(case when ${bundle.status} = 'reserved' then 1 else 0 end), 0)`,
          // m-4: weighted by pieces (Σ grams × 3657.6 / (Σ pcs × length)), not a mean of ratios.
          avgKgPer12ftMilli: sql<number | null>`cast(round(sum(${bundle.weightG}) * 3657.6 / nullif(sum(${bundle.quantity}) * ${bundle.lengthMm}, 0)) as integer)`,
          // D15: one copy across the group → its band; mixed or no copy → the section's primary band.
          copyId: sql<string | null>`case when count(distinct ${bundle.dieInstanceId}) = 1 and sum(case when ${bundle.dieInstanceId} is null then 1 else 0 end) = 0 then min(${bundle.dieInstanceId}) end`,
          oldestAt: sql<number>`min(${bundle.createdAt})`,
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(where)
        .groupBy(bundle.dieId, die.sectionCode, die.series, die.name, die.profileKind, bundle.lengthMm)
        .orderBy(asc(die.sectionCode), asc(bundle.lengthMm))
        .limit(input.limit + 1)
        .offset(input.offset);
      const [totals] = await ctx.db
        .select({
          bundles: sql<number>`count(*)`,
          pcs: sql<number>`coalesce(sum(${bundle.quantity}), 0)`,
          weightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
        })
        .from(bundle)
        .where(where);
      const more = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const bands = await bundleBandTones(
        ctx.db,
        ctx.companyId,
        page.map((r) => ({
          dieId: r.dieId,
          dieInstanceId: r.copyId,
          kgPer12ftMilli: r.avgKgPer12ftMilli == null ? null : Number(r.avgKgPer12ftMilli),
        })),
      );
      return {
        items: page.map(({ copyId: _copyId, ...r }, i) => ({
          ...r,
          band: bands[i]!,
          bundles: Number(r.bundles),
          pcs: Number(r.pcs),
          weightG: Number(r.weightG),
          reserved: Number(r.reserved),
          avgKgPer12ftMilli: r.avgKgPer12ftMilli == null ? null : Number(r.avgKgPer12ftMilli),
          oldestAt: new Date(Number(r.oldestAt)),
        })),
        totals: { bundles: Number(totals?.bundles ?? 0), pcs: Number(totals?.pcs ?? 0), weightG: Number(totals?.weightG ?? 0) },
        nextOffset: more ? input.offset + input.limit : null,
      };
    }),

  /**
   * FP-PK-14: pieces rejected at pack (newest first), with the section, the receipt and the reason;
   * totals by reason over the same filter. Weighed kg went to plant scrap (`pack_reject` ledger rows).
   */
  rejections: companyProcedure
    .input(
      z
        .object({
          dieId: z.string().min(1).optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(packReject.companyId, ctx.companyId),
        input.dieId ? eq(packReject.dieId, input.dieId) : undefined,
        input.from !== undefined ? sql`${packReject.createdAt} >= ${input.from}` : undefined,
        input.to !== undefined ? sql`${packReject.createdAt} <= ${input.to}` : undefined,
      );
      const items = await ctx.db
        .select({
          id: packReject.id,
          pcs: packReject.pcs,
          weightG: packReject.weightG,
          reason: packReject.reason,
          createdAt: packReject.createdAt,
          dieId: packReject.dieId,
          sectionCode: die.sectionCode,
          series: die.series,
          groupId: packReject.groupId,
          groupCode: bundleGroup.code,
          ageingRowId: packReject.ageingRowId,
        })
        .from(packReject)
        .innerJoin(die, and(eq(die.id, packReject.dieId), eq(die.companyId, packReject.companyId)))
        .innerJoin(bundleGroup, and(eq(bundleGroup.id, packReject.groupId), eq(bundleGroup.companyId, packReject.companyId)))
        .where(where)
        .orderBy(desc(packReject.createdAt), asc(packReject.id))
        .limit(input.limit)
        .offset(input.offset);
      // Reason code = the stored text up to ": " (the note follows it).
      const byReason = await ctx.db
        .select({
          reasonCode: sql<string>`case when instr(${packReject.reason}, ': ') > 0 then substr(${packReject.reason}, 1, instr(${packReject.reason}, ': ') - 1) else ${packReject.reason} end`,
          lines: sql<number>`count(*)`,
          pcs: sql<number>`coalesce(sum(${packReject.pcs}), 0)`,
          weightG: sql<number>`coalesce(sum(${packReject.weightG}), 0)`,
        })
        .from(packReject)
        .where(where)
        .groupBy(sql`1`)
        .orderBy(sql`3 desc`);
      return {
        items,
        byReason: byReason.map((r) => ({ reasonCode: r.reasonCode, lines: Number(r.lines), pcs: Number(r.pcs), weightG: Number(r.weightG) })),
      };
    }),

  /**
   * Ledger balance per (item kind, item, location), non-zero only. `at` = as of that instant;
   * `locationId: null` = stock whose place is unknown (legacy).
   *
   * Units: bundle, scrap and billet rows are grams in `qtyG`. A `store_item` row is in the item's
   * own unit (kg, litre, piece, …), so it returns `qtyG: null` with `qtyMilli` (1000 = 1 unit) and
   * `unit`; grams are never mixed with milli-units. Store rows are only returned to callers who
   * hold store.txn, masters.publish or analytics.view.
   */
  balance: companyProcedure
    .input(
      z
        .object({
          at: z.number().int().optional(),
          locationId: z.string().nullable().optional(),
          itemKind: z.enum(ledgerItemKinds).optional(),
          itemRef: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [ledgerScope(ctx.companyId, input.at !== undefined ? new Date(input.at) : undefined)];
      if (input.locationId === null) conditions.push(isNull(stockLedger.locationId));
      else if (input.locationId !== undefined) conditions.push(eq(stockLedger.locationId, input.locationId));
      if (input.itemKind) conditions.push(eq(stockLedger.itemKind, input.itemKind));
      if (input.itemRef) conditions.push(eq(stockLedger.itemRef, input.itemRef));
      if (!canSeeStoreStock(ctx.role)) conditions.push(ne(stockLedger.itemKind, "store_item"));

      const rows = await ctx.db
        .select({
          itemKind: stockLedger.itemKind,
          itemRef: stockLedger.itemRef,
          locationId: stockLedger.locationId,
          unit: storeItem.unit,
          qty: sql<number>`sum(${stockLedger.qtyG})`,
        })
        .from(stockLedger)
        .leftJoin(
          storeItem,
          and(
            eq(stockLedger.itemKind, "store_item"),
            eq(storeItem.id, stockLedger.itemRef),
            eq(storeItem.companyId, stockLedger.companyId),
          ),
        )
        .where(and(...conditions))
        .groupBy(stockLedger.itemKind, stockLedger.itemRef, stockLedger.locationId, storeItem.unit)
        .having(sql`sum(${stockLedger.qtyG}) <> 0`)
        .orderBy(asc(stockLedger.itemKind), asc(stockLedger.locationId), asc(stockLedger.itemRef));
      return {
        items: rows.map((r) =>
          r.itemKind === "store_item"
            ? {
                itemKind: r.itemKind,
                itemRef: r.itemRef,
                locationId: r.locationId,
                qtyG: null as number | null,
                qtyMilli: Number(r.qty),
                unit: r.unit,
              }
            : { itemKind: r.itemKind, itemRef: r.itemRef, locationId: r.locationId, qtyG: Number(r.qty) },
        ),
      };
    }),

  /**
   * Stock per location (every company location, plus "unknown"), from the ledger. Totals per item
   * kind: grams in `qtyG`; for `store_item` `qtyG` is null and `byUnit` lists milli-unit totals per
   * unit (kg, litre, piece, …), never one number across units. Store totals are only returned to
   * callers who hold store.txn, masters.publish or analytics.view.
   */
  byLocation: companyProcedure
    .input(z.object({ at: z.number().int().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const scope = and(
        ledgerScope(ctx.companyId, input.at !== undefined ? new Date(input.at) : undefined),
        canSeeStoreStock(ctx.role) ? undefined : ne(stockLedger.itemKind, "store_item"),
      );
      const per = ctx.db
        .select({
          itemKind: stockLedger.itemKind,
          locationId: stockLedger.locationId,
          unit: storeItem.unit,
          qty: sql<number>`sum(${stockLedger.qtyG})`.as("qty"),
        })
        .from(stockLedger)
        .leftJoin(
          storeItem,
          and(
            eq(stockLedger.itemKind, "store_item"),
            eq(storeItem.id, stockLedger.itemRef),
            eq(storeItem.companyId, stockLedger.companyId),
          ),
        )
        .where(scope)
        .groupBy(stockLedger.itemKind, stockLedger.itemRef, stockLedger.locationId, storeItem.unit)
        .having(sql`sum(${stockLedger.qtyG}) <> 0`)
        .as("per");
      const [totals, locations] = await Promise.all([
        ctx.db
          .select({
            locationId: per.locationId,
            itemKind: per.itemKind,
            unit: per.unit,
            itemCount: sql<number>`count(*)`,
            qty: sql<number>`sum(${per.qty})`,
          })
          .from(per)
          .groupBy(per.locationId, per.itemKind, per.unit),
        ctx.db
          .select()
          .from(location)
          .where(eq(location.companyId, ctx.companyId))
          .orderBy(asc(location.sortOrder), asc(location.code)),
      ]);
      type Total =
        | { itemKind: Exclude<(typeof ledgerItemKinds)[number], "store_item">; itemCount: number; qtyG: number }
        | {
            itemKind: "store_item";
            itemCount: number;
            qtyG: null;
            byUnit: { unit: string; itemCount: number; qtyMilli: number }[];
          };
      const totalsFor = (locationId: string | null): Total[] => {
        const out: Total[] = [];
        for (const t of totals.filter((x) => x.locationId === locationId)) {
          if (t.itemKind !== "store_item") {
            out.push({ itemKind: t.itemKind, itemCount: Number(t.itemCount), qtyG: Number(t.qty) });
            continue;
          }
          let store = out.find((x): x is Extract<Total, { itemKind: "store_item" }> => x.itemKind === "store_item");
          if (!store) {
            store = { itemKind: "store_item", itemCount: 0, qtyG: null, byUnit: [] };
            out.push(store);
          }
          store.itemCount += Number(t.itemCount);
          store.byUnit.push({ unit: t.unit ?? "unknown", itemCount: Number(t.itemCount), qtyMilli: Number(t.qty) });
        }
        return out;
      };
      return {
        locations: locations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          kind: l.kind,
          active: l.active,
          totals: totalsFor(l.id),
        })),
        unlocated: totalsFor(null),
      };
    }),

  /**
   * Take every in-stock bundle with no ledger rows (bundles from before the ledger) onto the
   * ledger at its current location: one `opening` voucher. Idempotent.
   */
  openingBalance: actionProcedure("masters.publish").mutation(async ({ ctx }) => {
    const [pending] = await ctx.db
      .select({ n: sql<number>`count(*)`, qtyG: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
      .from(bundle)
      .where(
        and(
          eq(bundle.companyId, ctx.companyId),
          inArray(bundle.status, [...IN_STOCK_STATUSES]),
          notExists(
            ctx.db
              .select({ one: sql`1` })
              .from(stockLedger)
              .where(
                and(
                  eq(stockLedger.companyId, bundle.companyId),
                  eq(stockLedger.itemKind, "bundle"),
                  eq(stockLedger.itemRef, bundle.id),
                ),
              ),
          ),
        ),
      );
    if (Number(pending?.n ?? 0) === 0) return { voucherId: null, posted: 0, qtyG: 0 };

    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const voucherId = crypto.randomUUID();
    const posting: PostingCtx = { db: ctx.db, companyId: ctx.companyId, userId: ctx.session.user.id, seq, postedAt: clockNow() };
    await atomicBatch(ctx.db, [
      openingRows(posting, { voucherId }),
      auditInsert(auditCtx(ctx), {
        action: "stock.openingBalance",
        subjectType: "stock_opening",
        subjectId: voucherId,
        meta: { bundles: Number(pending?.n ?? 0), qtyG: Number(pending?.qtyG ?? 0) },
      }),
    ]);
    const [posted] = await ctx.db
      .select({ n: sql<number>`count(*)`, qtyG: sql<number>`coalesce(sum(${stockLedger.qtyG}), 0)` })
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.companyId, ctx.companyId),
          eq(stockLedger.voucherType, "opening"),
          eq(stockLedger.voucherId, voucherId),
        ),
      );
    return { voucherId, posted: Number(posted?.n ?? 0), qtyG: Number(posted?.qtyG ?? 0) };
  }),
});
