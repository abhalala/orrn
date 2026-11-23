/**
 * Central store (spec P17, digest Stage 18): store items, GRN receipts, MRS issues, old-for-new
 * exchanges, cancels and balances for consumables and spares (flux, nitriding chemicals, LDO, gas,
 * bearings).
 *
 * - Quantities are integer milli-units (`qtyMilli`, 1000 = 1 kg / 1 litre / 1 piece) of the item's
 *   unit. Countable units (piece, set, box, bag) take whole numbers only. Capped at 100,000 units.
 * - Every movement = `store_txn` document + one `stock_ledger` row (item_kind `store_item`, at the
 *   active `store` location) + audit row in ONE `atomicBatch` (lib/store.ts). GRN and MRS numbers
 *   come from `doc_series` (`GRN-{n}` / `MRS-{n}`, restarting each financial year).
 * - An issue can never take a balance negative: the balance check is inside the document INSERT
 *   (write time), not only in the read before it, so racing issues cannot both land.
 * - `cancel` (RP15) keeps the entry and its number, marks it cancelled and posts a reversal ledger
 *   row (`reversal_of`) in the same batch; a GRN cancel is guarded by the balance at write time,
 *   no reversal lands on a retired item or store location, both legs of an exchange go together,
 *   a second cancel posts nothing. Draws another document made (`source_type`) are cancelled only
 *   with that document.
 * - `clientRequestId` (RP18) makes receive, issue and exchange idempotent: looked up before a
 *   number is taken, and a unique-index race returns the original entry. Results say `replayed`
 *   and `cancelled` (a retry after the entry was cancelled must not report the stock as in).
 * - Items: store.txn OR masters.publish create/edit (the storekeeper owns the store screen; same
 *   shape as die cards, RP7). Receive/issue/exchange/cancel: store.txn. Balances and history:
 *   store.txn or masters.publish (= storekeeper, manager, admin, owner). Any member may list items.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  COUNTABLE_STORE_UNITS,
  storeCategories,
  storeItem,
  storeTxn,
  storeTxnKinds,
  storeUnits,
  type StoreTxnRow,
} from "@orrn/db/schema/store";
import { storePo, storePoLine } from "@orrn/db/schema/storeBuy";
import { maxReceivableMilli, poTakesDeliveries, rateFitsQty, STORE_MAX_RATE_PAISE } from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import type { Context } from "../context";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { can } from "../lib/permissions";
import { nameKey } from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";
import { loadPoLineForReceipt, poLineReceiveGuard, poStatusSync, readPoTolerance } from "../lib/storeBuy";
import { storeIndentRouter } from "./storeIndent";
import { storePoRouter } from "./storePo";
import { storeValuationRouter, storeSettingsRouter, storeBelowMinimum } from "./storeValuation";
import {
  assertStoreQty,
  diagnoseStoreCancel,
  errorText,
  explainStoreCancelLost,
  explainStoreWriteLost,
  fmtMilli,
  loadStoreItem,
  MAX_STORE_QTY_MILLI,
  requireStoreBalance,
  resolveStoreLocation,
  storeBalanceSql,
  storeCancelMark,
  storeCancelRows,
  storeLedgerInsert,
  storeSourceLockedError,
  storeTxnInsert,
  type StoreTxnInput,
} from "../lib/store";

type Ctx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

/** Item masters: the storekeeper who owns the store, and publishers. */
const itemEditor = anyActionProcedure("store.txn", "masters.publish");
/** Balances and the movement history. */
const storeReader = anyActionProcedure("store.txn", "masters.publish");

const qtyMilli = z.number().int().min(1).max(MAX_STORE_QTY_MILLI);
const note = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((s) => s || null);
const refText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => s || null);
const itemName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => nameKey(s).length > 0, "Name needs letters or digits");

const issuePurposes = ["melt", "nitriding", "maintenance", "other"] as const;

const id64 = z.string().min(1).max(64);
/** Client-generated key for retries and offline queues (RP18). */
const clientRequestId = z.string().min(1).max(64).optional();

/** "PO-3 line 1 takes at most 2.5 more kg": the order's room under the tolerance. */
function overReceiptError(poNumber: string, line: number, roomMilli: number, unit: string) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `Over the order: ${poNumber} line ${line} takes at most ${fmtMilli(Math.max(roomMilli, 0))} more ${unit}`,
  });
}

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

/** A live item whose quantities are valid for its unit. */
async function usableItem(ctx: Ctx, id: string, qtys: number[]) {
  const item = await loadStoreItem(ctx.db, ctx.companyId, id);
  assertStoreQty(item, qtys);
  return item;
}

async function landed(ctx: Ctx, txnId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: storeTxn.id })
    .from(storeTxn)
    .where(and(eq(storeTxn.id, txnId), eq(storeTxn.companyId, ctx.companyId)))
    .limit(1);
  return Boolean(row);
}

const REQUEST_UNIQUE = /UNIQUE constraint failed: store_txn\.company_id, store_txn\.client_request_id/;

async function findByRequest(ctx: Ctx, clientRequestId: string | null | undefined): Promise<StoreTxnRow | null> {
  if (!clientRequestId) return null;
  const [row] = await ctx.db
    .select()
    .from(storeTxn)
    .where(and(eq(storeTxn.companyId, ctx.companyId), eq(storeTxn.clientRequestId, clientRequestId)))
    .limit(1);
  return row ?? null;
}

/** A replayed key must describe the same entry; anything else is a client bug, not a silent return. */
function sameEntry(prior: StoreTxnRow, want: { kind: string; itemId: string; qtyMilli: number; purpose?: string | null }) {
  if (
    prior.kind !== want.kind ||
    prior.itemId !== want.itemId ||
    prior.qtyMilli !== want.qtyMilli ||
    (want.purpose !== undefined && prior.purpose !== want.purpose)
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "This request id was already used for a different entry" });
  }
}

async function exchangeLegs(ctx: Ctx, outLeg: StoreTxnRow) {
  const [inLeg] = await ctx.db
    .select()
    .from(storeTxn)
    .where(
      and(
        eq(storeTxn.companyId, ctx.companyId),
        eq(storeTxn.exchangeId, outLeg.exchangeId ?? ""),
        eq(storeTxn.kind, "grn"),
      ),
    )
    .limit(1);
  if (!inLeg) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The exchange was only half saved" });
  return {
    exchangeId: outLeg.exchangeId!,
    mrsId: outLeg.id,
    mrsNumber: outLeg.number,
    grnId: inLeg.id,
    grnNumber: inLeg.number,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemsRouter = router({
  /** Every item (active and retired) by name, without balances. Any member may read (foundry and nitriding pick from it). */
  list: companyProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(storeItem)
      .where(eq(storeItem.companyId, ctx.companyId))
      .orderBy(asc(storeItem.name))
      .limit(1000);
    return { items };
  }),

  create: itemEditor
    .input(
      z.object({
        name: itemName,
        unit: z.enum(storeUnits),
        category: z.enum(storeCategories).default("other"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(storeItem).values({
            id,
            companyId: ctx.companyId,
            serverSeq: seq,
            name: input.name,
            nameKey: nameKey(input.name),
            unit: input.unit,
            category: input.category,
            createdBy: ctx.session.user.id,
          }),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "store_item.create", subjectType: "store_item", subjectId: id, meta: { name: input.name, unit: input.unit } },
            { from: storeItem, where: eq(storeItem.id, id) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: store_item/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That store item already exists" });
        }
        throw e;
      }
      return { id };
    }),

  update: itemEditor
    .input(
      z.object({
        id: id64,
        name: itemName.optional(),
        unit: z.enum(storeUnits).optional(),
        category: z.enum(storeCategories).optional(),
        active: z.boolean().optional(),
        /** XE store (row 72): reorder levels in milli-units; null clears them. */
        minMilli: z.number().int().min(0).max(MAX_STORE_QTY_MILLI).nullable().optional(),
        reorderMilli: z.number().int().min(0).max(MAX_STORE_QTY_MILLI).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadStoreItem(ctx.db, ctx.companyId, input.id);
      const unitAfter = input.unit ?? existing.unit;
      const countable = (COUNTABLE_STORE_UNITS as readonly string[]).includes(unitAfter);
      // The levels the row keeps after this update: an omitted level stays, an explicit null clears it.
      const minAfter = input.minMilli === undefined ? existing.minMilli : input.minMilli;
      const reorderAfter = input.reorderMilli === undefined ? existing.reorderMilli : input.reorderMilli;
      for (const level of [minAfter, reorderAfter]) {
        if (level != null && countable && level % 1000 !== 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${existing.name} is counted in whole numbers (${unitAfter})` });
        }
      }
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof storeItem.$inferInsert
      >;
      if (input.name !== undefined) patch.nameKey = nameKey(input.name);
      if (input.active === false && existing.active) patch.retiredAt = clockNow();
      if (input.active === true && !existing.active) patch.retiredAt = null;
      if (Object.keys(patch).length === 0) return { success: true };
      const changingUnit = input.unit !== undefined && input.unit !== existing.unit;
      const retiring = input.active === false && existing.active;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mine = and(eq(storeItem.id, existing.id), eq(storeItem.companyId, ctx.companyId), eq(storeItem.serverSeq, seq));
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(storeItem)
            .set({ ...patch, serverSeq: seq })
            .where(
              and(
                eq(storeItem.id, existing.id),
                eq(storeItem.companyId, ctx.companyId),
                // The unit gives the quantities their meaning: locked from the first movement on.
                changingUnit
                  ? sql`not exists (select 1 from ${storeTxn} t where t.company_id = ${ctx.companyId} and t.item_id = ${existing.id})`
                  : undefined,
                // A retired item cannot be issued, so stock on it would be frozen: retire at 0 only.
                retiring
                  ? sql`coalesce((select sum(l.qty_g) from stock_ledger l where l.company_id = ${ctx.companyId} and l.item_kind = 'store_item' and l.item_ref = ${existing.id}), 0) = 0`
                  : undefined,
              ),
            ),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "store_item.update",
              subjectType: "store_item",
              subjectId: existing.id,
              meta: {
                before: {
                  name: existing.name, unit: existing.unit, active: existing.active,
                  minMilli: existing.minMilli, reorderMilli: existing.reorderMilli,
                },
                patch,
              },
            },
            { from: storeItem, where: mine },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: store_item/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "An active store item already has that name" });
        }
        throw e;
      }
      const [ok] = await ctx.db.select({ id: storeItem.id }).from(storeItem).where(mine).limit(1);
      if (!ok) {
        if (retiring) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${existing.name} still has stock; issue or cancel it before retiring the item`,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${existing.name} already has store entries; its unit can no longer change`,
        });
      }
      return { success: true };
    }),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const storeRouter = router({
  items: itemsRouter,
  /** XE store (row 69): indents. */
  indents: storeIndentRouter,
  /** XE store (rows 70, 71): purchase orders to vendors. */
  po: storePoRouter,
  /** XE store (row 73): average rates and the month-end stock value. */
  valuation: storeValuationRouter,
  /** XE store (row 71): the over-receipt tolerance. */
  settings: storeSettingsRouter,
  /** XE store (row 72): items below their minimum, with any indent already raised for them. */
  belowMinimum: storeBelowMinimum,

  /** GRN: + stock at the store. Returns the GRN number. */
  receive: actionProcedure("store.txn")
    .input(
      z.object({
        itemId: id64,
        qtyMilli,
        note,
        /** The vendor's challan or bill number. */
        grnRef: refText(60),
        clientRequestId,
        /**
         * XE store (row 73): paise per unit of the item's unit. Omitted with a PO line = the line's rate;
         * a different rate needs `store.rate`. Without a PO line, a rate needs `store.rate`; omitted or
         * null = rate pending (valued at the item's average until a `store.rate` holder sets it). From
         * someone without `store.rate`, null is the same as omitted (with a PO line: the line's rate).
         */
        ratePaise: z.number().int().min(0).max(STORE_MAX_RATE_PAISE).nullable().optional(),
        /** XE store (row 71): the purchase order line this delivery is against. */
        poLineId: id64.optional(),
        /** XE store (row 71): what inspection turned back; `qtyMilli` is what was accepted into stock. */
        rejectedMilli: z.number().int().min(0).max(MAX_STORE_QTY_MILLI).optional(),
      }).extend({
        /** Accepted into stock. 0 only with `rejectedMilli` > 0: a fully rejected delivery, kept as a record. */
        qtyMilli: z.number().int().min(0).max(MAX_STORE_QTY_MILLI),
      }).refine((v) => v.qtyMilli > 0 || (v.rejectedMilli ?? 0) > 0, {
        message: "Enter the quantity accepted, or what was rejected",
        path: ["qtyMilli"],
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const want = { kind: "grn", itemId: input.itemId, qtyMilli: input.qtyMilli } as const;
      const replay = (prior: StoreTxnRow) => {
        sameEntry(prior, want);
        return { id: prior.id, number: prior.number, replayed: true as const, cancelled: prior.cancelledAt !== null };
      };
      const earlier = await findByRequest(ctx, input.clientRequestId);
      if (earlier) return replay(earlier);

      const item = await usableItem(ctx, input.itemId, input.qtyMilli > 0 ? [input.qtyMilli] : []);
      if (input.rejectedMilli) assertStoreQty(item, [input.rejectedMilli]);
      // XE store (row 71): against a PO line, the line names the item, the rate and the most it may still take.
      const poLine = input.poLineId ? await loadPoLineForReceipt(ctx.db, ctx.companyId, input.poLineId) : null;
      const toleranceBp = poLine ? await readPoTolerance(ctx.db, ctx.companyId) : 0;
      if (poLine) {
        if (poLine.itemId !== item.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${poLine.poNumber} line ${poLine.line} is for another item` });
        }
        if (!poTakesDeliveries(poLine.poStatus, poLine.poClosedByHand)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${poLine.poNumber} is not open for deliveries` });
        }
        const room = maxReceivableMilli(poLine.orderedMilli, toleranceBp) - poLine.receivedMilli;
        if (input.qtyMilli > room) throw overReceiptError(poLine.poNumber, poLine.line, room, item.unit);
      }
      // XE store (row 73): the storekeeper does not set valuation rates. Against an order the order's
      // rate holds; typing another, or a rate with no order, needs store.rate. With no rate the GRN is
      // valued at the item's average and its rate stays pending for the office.
      const setsRates = can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "store.rate");
      // `ratePaise: null` from someone who does not set rates means "no rate from me", the same as leaving
      // it out: pending with no PO, the order's rate against a PO line (re-check STORE nit 7).
      const sentRate = input.ratePaise === null && !setsRates ? undefined : input.ratePaise;
      const typedRate = sentRate !== undefined && (!poLine || sentRate !== poLine.ratePaise);
      if (typedRate && !setsRates) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: poLine ? "Only the office can change the order's rate" : "Only the office can set a rate; leave it empty and it stays pending",
        });
      }
      const ratePaise = sentRate !== undefined ? sentRate : (poLine?.ratePaise ?? null);
      if (ratePaise !== null && !rateFitsQty(input.qtyMilli, ratePaise)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity times rate is too large for one GRN" });
      }
      const store = await resolveStoreLocation(ctx.db, ctx.companyId);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "grn", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const txn: StoreTxnInput = {
        id, companyId: ctx.companyId, seq, kind: "grn", number: doc.number, period: doc.period,
        itemId: item.id, unit: item.unit, qtyMilli: input.qtyMilli, locationId: store.id,
        purpose: null, refId: null, grnRef: input.grnRef, exchangeId: null, note: input.note ?? null,
        clientRequestId: input.clientRequestId ?? null, userId, at, guardBalance: false,
        ratePaise, ratePending: ratePaise === null, poLineId: poLine?.lineId ?? null, rejectedMilli: input.rejectedMilli ?? null,
        and: poLine
          ? poLineReceiveGuard({ companyId: ctx.companyId, poLineId: poLine.lineId, itemId: item.id, qtyMilli: input.qtyMilli, toleranceBp })
          : undefined,
      };
      try {
        await atomicBatch(ctx.db, [
          storeTxnInsert(ctx.db, txn),
          storeLedgerInsert(ctx.db, { companyId: ctx.companyId, seq, txnId: id, userId, at }),
          ...(poLine ? [poStatusSync(ctx.db, { companyId: ctx.companyId, poId: poLine.poId, seq, at })] : []),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "store.receive",
              subjectType: "store_txn",
              subjectId: id,
              meta: {
                number: doc.number, itemId: item.id, qtyMilli: input.qtyMilli, grnRef: input.grnRef,
                ratePaise, ratePending: ratePaise === null && input.qtyMilli > 0,
                poNumber: poLine?.poNumber ?? null, poLineId: poLine?.lineId ?? null,
                rejectedMilli: input.rejectedMilli ?? null,
                // The order's own rate, so a rate typed over it at the gate shows in the audit.
                poRatePaise: poLine?.ratePaise ?? null,
              },
            },
            { from: storeTxn, where: and(eq(storeTxn.id, id), eq(storeTxn.companyId, ctx.companyId)) },
          ),
        ]);
      } catch (e) {
        const prior = REQUEST_UNIQUE.test(errorText(e)) ? await findByRequest(ctx, input.clientRequestId) : null;
        if (prior) return replay(prior);
        throw e;
      }
      if (!(await landed(ctx, id))) {
        if (poLine) {
          // The order changed between the read and the write: cancelled, closed, or another GRN took the room.
          const now = await loadPoLineForReceipt(ctx.db, ctx.companyId, poLine.lineId);
          if (!poTakesDeliveries(now.poStatus, now.poClosedByHand)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${now.poNumber} is not open for deliveries` });
          }
          const room = maxReceivableMilli(now.orderedMilli, toleranceBp) - now.receivedMilli;
          if (input.qtyMilli > room) throw overReceiptError(now.poNumber, now.line, room, item.unit);
        }
        await explainStoreWriteLost(ctx.db, ctx.companyId, item.id, null, item.unit);
      }
      return { id, number: doc.number, replayed: false as const, cancelled: false };
    }),

  /** MRS: − stock at the store; refused when the balance would go negative. Returns the MRS number. */
  issue: actionProcedure("store.txn")
    .input(
      z.object({
        itemId: id64,
        qtyMilli,
        purpose: z.enum(issuePurposes),
        /** The melt, nitriding log or job this issue is for. */
        refId: refText(64),
        note,
        clientRequestId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const want = { kind: "mrs", itemId: input.itemId, qtyMilli: input.qtyMilli, purpose: input.purpose } as const;
      const replay = (prior: StoreTxnRow) => {
        sameEntry(prior, want);
        return { id: prior.id, number: prior.number, replayed: true as const, cancelled: prior.cancelledAt !== null };
      };
      const earlier = await findByRequest(ctx, input.clientRequestId);
      if (earlier) return replay(earlier);

      const item = await usableItem(ctx, input.itemId, [input.qtyMilli]);
      const store = await resolveStoreLocation(ctx.db, ctx.companyId);
      await requireStoreBalance(ctx.db, ctx.companyId, item, store.id, input.qtyMilli);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "mrs", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const txn: StoreTxnInput = {
        id, companyId: ctx.companyId, seq, kind: "mrs", number: doc.number, period: doc.period,
        itemId: item.id, unit: item.unit, qtyMilli: input.qtyMilli, locationId: store.id,
        purpose: input.purpose, refId: input.refId, grnRef: null, exchangeId: null, note: input.note ?? null,
        clientRequestId: input.clientRequestId ?? null, userId, at, guardBalance: true,
      };
      try {
        await atomicBatch(ctx.db, [
          storeTxnInsert(ctx.db, txn),
          storeLedgerInsert(ctx.db, { companyId: ctx.companyId, seq, txnId: id, userId, at }),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "store.issue",
              subjectType: "store_txn",
              subjectId: id,
              meta: { number: doc.number, itemId: item.id, qtyMilli: input.qtyMilli, purpose: input.purpose, refId: input.refId },
            },
            { from: storeTxn, where: and(eq(storeTxn.id, id), eq(storeTxn.companyId, ctx.companyId)) },
          ),
        ]);
      } catch (e) {
        const prior = REQUEST_UNIQUE.test(errorText(e)) ? await findByRequest(ctx, input.clientRequestId) : null;
        if (prior) return replay(prior);
        throw e;
      }
      if (!(await landed(ctx, id))) await explainStoreWriteLost(ctx.db, ctx.companyId, item.id, input.qtyMilli, item.unit);
      return { id, number: doc.number, replayed: false as const, cancelled: false };
    }),

  /**
   * Old for new: the old leaves the store under an MRS (purpose "exchange", guarded like any
   * issue: the old must be in the store) and the new comes in under a GRN. One batch; both
   * documents carry the same `exchangeId`. Takes one MRS number and one GRN number, as the
   * two paper forms would. `clientRequestId` is stored on the MRS leg.
   */
  exchange: actionProcedure("store.txn")
    .input(z.object({ itemId: id64, qtyOutMilli: qtyMilli, qtyInMilli: qtyMilli, note, clientRequestId }))
    .mutation(async ({ ctx, input }) => {
      const replay = async (prior: StoreTxnRow) => {
        sameEntry(prior, { kind: "mrs", itemId: input.itemId, qtyMilli: input.qtyOutMilli, purpose: "exchange" });
        const legs = await exchangeLegs(ctx, prior);
        const [inLeg] = await ctx.db.select({ q: storeTxn.qtyMilli }).from(storeTxn).where(eq(storeTxn.id, legs.grnId));
        if (inLeg?.q !== input.qtyInMilli) {
          throw new TRPCError({ code: "CONFLICT", message: "This request id was already used for a different entry" });
        }
        // Both legs are cancelled together, so the MRS leg speaks for the exchange.
        return { ...legs, replayed: true as const, cancelled: prior.cancelledAt !== null };
      };
      const earlier = await findByRequest(ctx, input.clientRequestId);
      if (earlier) return replay(earlier);

      const item = await usableItem(ctx, input.itemId, [input.qtyOutMilli, input.qtyInMilli]);
      const store = await resolveStoreLocation(ctx.db, ctx.companyId);
      await requireStoreBalance(ctx.db, ctx.companyId, item, store.id, input.qtyOutMilli);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const mrs = await nextDocNumber(ctx.db, ctx.companyId, "mrs", at, userId);
      const grn = await nextDocNumber(ctx.db, ctx.companyId, "grn", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mrsId = crypto.randomUUID();
      const grnId = crypto.randomUUID();
      const exchangeId = crypto.randomUUID();
      const common = { companyId: ctx.companyId, seq, itemId: item.id, unit: item.unit, locationId: store.id, exchangeId, note: input.note ?? null, userId, at };
      const out: StoreTxnInput = {
        ...common, id: mrsId, kind: "mrs", number: mrs.number, period: mrs.period, qtyMilli: input.qtyOutMilli,
        purpose: "exchange", refId: null, grnRef: null, guardBalance: true, clientRequestId: input.clientRequestId ?? null,
      };
      const inn: StoreTxnInput = {
        ...common, id: grnId, kind: "grn", number: grn.number, period: grn.period, qtyMilli: input.qtyInMilli,
        purpose: null, refId: null, grnRef: null, guardBalance: false,
        // The new comes in only if the old went out.
        and: sql`exists (select 1 from ${storeTxn} o where o.id = ${mrsId} and o.company_id = ${ctx.companyId})`,
        // XE store (row 73): value follows units (`exchangeInTake`): the new leg carries the old leg's
        // money on as many units as came back. Fewer in than out takes old value x in / old rated, the
        // rest is spent like an issue, so the average holds; as many or more in brings all of it back.
        valueSql: sql<number>`coalesce((select case
            when o.rated_milli <= 0 or o.value_paise <= 0 then 0
            when ${input.qtyInMilli} >= o.rated_milli then o.value_paise
            else max(0, cast(round(o.value_paise * 1.0 * ${input.qtyInMilli} / o.rated_milli) as integer))
          end from ${storeTxn} o where o.id = ${mrsId} and o.company_id = ${ctx.companyId}), 0)`,
        // ...and the old leg's rated part, at most the quantity that came in.
        ratedSql: sql<number>`coalesce((select case when o.rated_milli <= 0 then 0 else min(o.rated_milli, ${input.qtyInMilli}) end from ${storeTxn} o where o.id = ${mrsId} and o.company_id = ${ctx.companyId}), 0)`,
      };
      const ledger = { companyId: ctx.companyId, seq, userId, at };
      try {
        await atomicBatch(ctx.db, [
          storeTxnInsert(ctx.db, out),
          storeLedgerInsert(ctx.db, { ...ledger, txnId: mrsId }),
          storeTxnInsert(ctx.db, inn),
          storeLedgerInsert(ctx.db, { ...ledger, txnId: grnId }),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "store.exchange",
              subjectType: "store_txn",
              subjectId: mrsId,
              meta: {
                exchangeId, itemId: item.id, mrsNumber: mrs.number, grnNumber: grn.number,
                qtyOutMilli: input.qtyOutMilli, qtyInMilli: input.qtyInMilli,
              },
            },
            { from: storeTxn, where: and(eq(storeTxn.id, grnId), eq(storeTxn.companyId, ctx.companyId)) },
          ),
        ]);
      } catch (e) {
        const prior = REQUEST_UNIQUE.test(errorText(e)) ? await findByRequest(ctx, input.clientRequestId) : null;
        if (prior) return replay(prior);
        throw e;
      }
      if (!(await landed(ctx, mrsId))) await explainStoreWriteLost(ctx.db, ctx.companyId, item.id, input.qtyOutMilli, item.unit);
      if (!(await landed(ctx, grnId))) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The exchange was only half saved" });
      return { exchangeId, mrsId, mrsNumber: mrs.number, grnId, grnNumber: grn.number, replayed: false as const, cancelled: false };
    }),

  /**
   * Cancel a GRN or MRS (RP15). The entry keeps its number and is marked cancelled; a reversal
   * ledger row (`reversal_of`) undoes its stock effect in the same batch. Cancelling a GRN is
   * refused when its stock was already drawn (the balance would go negative; checked at write
   * time), and any cancel is refused while the item or the entry's store location is retired
   * (reactivate it first). Either leg of an exchange cancels both. No new number is taken.
   * An MRS another document drew in its own batch (a melt's flux, `source_type` set) is refused
   * here: only that document's cancel reverses it, so its consumption and the store agree.
   */
  cancel: actionProcedure("store.txn")
    .input(z.object({ txnId: id64, reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [txn] = await ctx.db
        .select()
        .from(storeTxn)
        .where(and(eq(storeTxn.id, input.txnId), eq(storeTxn.companyId, ctx.companyId)))
        .limit(1);
      if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "Store entry not found" });
      const alreadyCancelled = () =>
        new TRPCError({ code: "BAD_REQUEST", message: `${txn.number} was already cancelled` });
      if (txn.cancelledAt) throw alreadyCancelled();
      // `source_type` never changes after insert, so this read needs no write-time twin.
      if (txn.sourceType) throw storeSourceLockedError(txn);
      // Read time, in the order `diagnoseStoreCancel` explains a lost write: a short balance first, then
      // (XE store row 73) stock that went out after this GRN or an opening rate that rated it, so the
      // store's value stays exact; then a retired item or location. All checked again inside the batch
      // (`storeCancelRows`), so a racing issue cannot slip in.
      const why = await diagnoseStoreCancel(ctx.db, ctx.companyId, txn.id);
      if (why) throw why;

      const group = txn.exchangeId
        ? await ctx.db
            .select()
            .from(storeTxn)
            .where(and(eq(storeTxn.companyId, ctx.companyId), eq(storeTxn.exchangeId, txn.exchangeId)))
        : [txn];
      const userId = ctx.session.user.id;
      const at = clockNow();
      // XE store (row 71): a GRN against an order gives the order back its room; its status follows.
      const poId = txn.poLineId
        ? ((
            await ctx.db
              .select({ poId: storePoLine.poId })
              .from(storePoLine)
              .where(and(eq(storePoLine.id, txn.poLineId), eq(storePoLine.companyId, ctx.companyId)))
              .limit(1)
          )[0]?.poId ?? null)
        : null;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const cancel = { companyId: ctx.companyId, seq, txnId: txn.id, exchangeId: txn.exchangeId, userId, at, reason: input.reason };
      const mine = and(
        eq(storeTxn.id, txn.id),
        eq(storeTxn.companyId, ctx.companyId),
        eq(storeTxn.serverSeq, seq),
        sql`${storeTxn.cancelledAt} is not null`,
      );
      await atomicBatch(ctx.db, [
        storeCancelRows(ctx.db, cancel),
        storeCancelMark(ctx.db, cancel),
        ...(poId ? [poStatusSync(ctx.db, { companyId: ctx.companyId, poId, seq, at })] : []),
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "store.cancel",
            subjectType: "store_txn",
            subjectId: txn.id,
            meta: {
              number: txn.number,
              kind: txn.kind,
              reason: input.reason,
              legs: group.map((g) => ({ id: g.id, number: g.number })),
            },
          },
          { from: storeTxn, where: mine },
        ),
      ]);
      const [ok] = await ctx.db.select({ id: storeTxn.id }).from(storeTxn).where(mine).limit(1);
      // Lost: cancelled by someone else meanwhile, undoing it would overdraw the store, or the item
      // or its store location was retired.
      if (!ok) await explainStoreCancelLost(ctx.db, ctx.companyId, txn.id);
      return { txnId: txn.id, number: txn.number, kind: txn.kind, cancelledIds: group.map((g) => g.id) };
    }),

  /**
   * Balance per item at the store location, from the ledger (milli-units). Active items always
   * (0 when empty); a retired item only while it holds stock (it cannot be retired with stock,
   * so this only covers items retired before that rule).
   */
  balances: storeReader.query(async ({ ctx }) => {
    const store = await resolveStoreLocation(ctx.db, ctx.companyId, { optional: true });
    const locationId = store?.id ?? null;
    const rows = await ctx.db
      .select({
        id: storeItem.id,
        name: storeItem.name,
        unit: storeItem.unit,
        category: storeItem.category,
        active: storeItem.active,
        minMilli: storeItem.minMilli,
        reorderMilli: storeItem.reorderMilli,
        balanceMilli: locationId
          ? storeBalanceSql(ctx.companyId, sql`${storeItem.id}`, locationId)
          : sql<number>`0`,
      })
      .from(storeItem)
      .where(eq(storeItem.companyId, ctx.companyId))
      .orderBy(asc(storeItem.name))
      .limit(1000);
    return {
      locationId,
      items: rows
        .map((r) => ({ ...r, balanceMilli: Number(r.balanceMilli) }))
        .filter((r) => r.active || r.balanceMilli !== 0),
    };
  }),

  /** Recent GRNs and MRSs (cancelled ones included, marked), newest first. */
  txns: storeReader
    .input(
      z
        .object({
          itemId: id64.optional(),
          kind: z.enum(storeTxnKinds).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .default({ limit: 100 }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select({
          id: storeTxn.id,
          kind: storeTxn.kind,
          number: storeTxn.number,
          period: storeTxn.period,
          itemId: storeTxn.itemId,
          itemName: storeItem.name,
          unit: storeItem.unit,
          qtyMilli: storeTxn.qtyMilli,
          purpose: storeTxn.purpose,
          refId: storeTxn.refId,
          /** Set for draws a melt or nitriding log made: cancel those from that document. */
          sourceType: storeTxn.sourceType,
          sourceId: storeTxn.sourceId,
          grnRef: storeTxn.grnRef,
          /** XE store (row 73): null on a GRN = no rate: pending (`ratePending`) or an old GRN. */
          ratePaise: storeTxn.ratePaise,
          ratePending: storeTxn.ratePending,
          valuePaise: storeTxn.valuePaise,
          rejectedMilli: storeTxn.rejectedMilli,
          poLineId: storeTxn.poLineId,
          poId: storePo.id,
          poNumber: storePo.number,
          exchangeId: storeTxn.exchangeId,
          note: storeTxn.note,
          cancelledAt: storeTxn.cancelledAt,
          cancelReason: storeTxn.cancelReason,
          createdBy: storeTxn.createdBy,
          createdAt: storeTxn.createdAt,
        })
        .from(storeTxn)
        .innerJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
        .leftJoin(storePoLine, and(eq(storePoLine.id, storeTxn.poLineId), eq(storePoLine.companyId, storeTxn.companyId)))
        .leftJoin(storePo, and(eq(storePo.id, storePoLine.poId), eq(storePo.companyId, storeTxn.companyId)))
        .where(
          and(
            eq(storeTxn.companyId, ctx.companyId),
            input.itemId ? eq(storeTxn.itemId, input.itemId) : undefined,
            input.kind ? eq(storeTxn.kind, input.kind) : undefined,
          ),
        )
        .orderBy(desc(storeTxn.createdAt), desc(storeTxn.serverSeq))
        .limit(input.limit);
      return { items };
    }),
});
