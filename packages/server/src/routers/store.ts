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
 *   both legs of an exchange go together, a second cancel posts nothing.
 * - `clientRequestId` (RP18) makes receive, issue and exchange idempotent: looked up before a
 *   number is taken, and a unique-index race returns the original entry.
 * - Items: store.txn OR masters.publish create/edit (the storekeeper owns the store screen; same
 *   shape as die cards, RP7). Receive/issue/exchange/cancel: store.txn. Balances and history:
 *   store.txn or masters.publish (= storekeeper, manager, admin, owner). Any member may list items.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  storeCategories,
  storeItem,
  storeTxn,
  storeTxnKinds,
  storeUnits,
  type StoreTxnRow,
} from "@orrn/db/schema/store";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import type { Context } from "../context";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { nameKey } from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";
import {
  assertStoreQty,
  errorText,
  explainStoreWriteLost,
  fmtMilli,
  loadStoreItem,
  MAX_STORE_QTY_MILLI,
  requireStoreBalance,
  resolveStoreLocation,
  storeBalance,
  storeBalanceSql,
  storeCancelMark,
  storeCancelRows,
  storeLedgerInsert,
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadStoreItem(ctx.db, ctx.companyId, input.id);
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
              meta: { before: { name: existing.name, unit: existing.unit, active: existing.active }, patch },
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const want = { kind: "grn", itemId: input.itemId, qtyMilli: input.qtyMilli } as const;
      const replay = (prior: StoreTxnRow) => {
        sameEntry(prior, want);
        return { id: prior.id, number: prior.number, replayed: true as const };
      };
      const earlier = await findByRequest(ctx, input.clientRequestId);
      if (earlier) return replay(earlier);

      const item = await usableItem(ctx, input.itemId, [input.qtyMilli]);
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
      };
      try {
        await atomicBatch(ctx.db, [
          storeTxnInsert(ctx.db, txn),
          storeLedgerInsert(ctx.db, { companyId: ctx.companyId, seq, txnId: id, userId, at }),
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "store.receive",
              subjectType: "store_txn",
              subjectId: id,
              meta: { number: doc.number, itemId: item.id, qtyMilli: input.qtyMilli, grnRef: input.grnRef },
            },
            { from: storeTxn, where: and(eq(storeTxn.id, id), eq(storeTxn.companyId, ctx.companyId)) },
          ),
        ]);
      } catch (e) {
        const prior = REQUEST_UNIQUE.test(errorText(e)) ? await findByRequest(ctx, input.clientRequestId) : null;
        if (prior) return replay(prior);
        throw e;
      }
      if (!(await landed(ctx, id))) await explainStoreWriteLost(ctx.db, ctx.companyId, item.id, null, item.unit);
      return { id, number: doc.number, replayed: false as const };
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
        return { id: prior.id, number: prior.number, replayed: true as const };
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
      return { id, number: doc.number, replayed: false as const };
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
        return { ...legs, replayed: true as const };
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
      return { exchangeId, mrsId, mrsNumber: mrs.number, grnId, grnNumber: grn.number, replayed: false as const };
    }),

  /**
   * Cancel a GRN or MRS (RP15). The entry keeps its number and is marked cancelled; a reversal
   * ledger row (`reversal_of`) undoes its stock effect in the same batch. Cancelling a GRN is
   * refused when its stock was already drawn (the balance would go negative; checked at write
   * time). Either leg of an exchange cancels both. No new number is taken.
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

      const group = txn.exchangeId
        ? await ctx.db
            .select()
            .from(storeTxn)
            .where(and(eq(storeTxn.companyId, ctx.companyId), eq(storeTxn.exchangeId, txn.exchangeId)))
        : [txn];
      const userId = ctx.session.user.id;
      const at = clockNow();
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
      if (!ok) {
        // Lost: cancelled by someone else meanwhile, or undoing it would overdraw the store.
        const [now] = await ctx.db
          .select()
          .from(storeTxn)
          .where(and(eq(storeTxn.id, txn.id), eq(storeTxn.companyId, ctx.companyId)))
          .limit(1);
        if (now?.cancelledAt) throw alreadyCancelled();
        const item = await loadStoreItem(ctx.db, ctx.companyId, txn.itemId);
        const net = group.reduce((sum, g) => sum + (g.kind === "grn" ? g.qtyMilli : -g.qtyMilli), 0);
        const have = await storeBalance(ctx.db, ctx.companyId, txn.itemId, txn.locationId);
        if (have < net) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot cancel ${txn.number}: ${fmtMilli(net)} ${item.unit} of ${item.name} would have to come out, but only ${fmtMilli(Math.max(have, 0))} is in the store`,
          });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "The store changed; try again" });
      }
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
          grnRef: storeTxn.grnRef,
          exchangeId: storeTxn.exchangeId,
          note: storeTxn.note,
          cancelledAt: storeTxn.cancelledAt,
          cancelReason: storeTxn.cancelReason,
          createdBy: storeTxn.createdBy,
          createdAt: storeTxn.createdAt,
        })
        .from(storeTxn)
        .innerJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
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
