/**
 * Central store (spec P17, digest Stage 18): store items, GRN receipts, MRS issues, old-for-new
 * exchanges and balances for consumables and spares (flux, nitriding chemicals, LDO, gas, bearings).
 *
 * - Quantities are integer milli-units (`qtyMilli`, 1000 = 1 kg / 1 litre / 1 piece) of the item's
 *   unit. Countable units (piece, set, box, bag) take whole numbers only. Capped at 100,000 units.
 * - Every movement = `store_txn` document + one `stock_ledger` row (item_kind `store_item`, at the
 *   active `store` location) + audit row in ONE `atomicBatch` (lib/store.ts). GRN and MRS numbers
 *   come from `doc_series` (`GRN-{n}` / `MRS-{n}`, restarting each financial year).
 * - An issue can never take a balance negative: the balance check is inside the document INSERT
 *   (write time), not only in the read before it, so racing issues cannot both land.
 * - Items: store.txn OR masters.publish create/edit (the storekeeper owns the store screen; same
 *   shape as die cards, RP7). Receive/issue/exchange: store.txn. Balances and history: store.txn
 *   or masters.publish (= storekeeper, manager, admin, owner). Any member may list items.
 * - There is no cancel yet (not in the PL-7 brief): a wrong GRN is undone by an MRS (purpose
 *   "other") and the reverse; both stay on the record.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { location } from "@orrn/db/schema/stock";
import {
  COUNTABLE_STORE_UNITS,
  storeCategories,
  storeItem,
  storeTxn,
  storeTxnKinds,
  storeUnits,
  type StoreItemRow,
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
  fmtMilli,
  MAX_STORE_QTY_MILLI,
  storeBalanceSql,
  storeLedgerInsert,
  storeTxnInsert,
  type StoreTxnInput,
} from "../lib/store";

type Ctx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

const ITEM_NOT_FOUND = { code: "NOT_FOUND", message: "Store item not found" } as const;

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

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

async function loadItem(ctx: Ctx, id: string): Promise<StoreItemRow> {
  const [row] = await ctx.db
    .select()
    .from(storeItem)
    .where(and(eq(storeItem.id, id), eq(storeItem.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(ITEM_NOT_FOUND);
  return row;
}

/** A live item whose quantity is valid for its unit (countable units take whole numbers). */
async function usableItem(ctx: Ctx, id: string, qtys: number[]): Promise<StoreItemRow> {
  const item = await loadItem(ctx, id);
  if (!item.active) throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is retired` });
  if ((COUNTABLE_STORE_UNITS as readonly string[]).includes(item.unit) && qtys.some((q) => q % 1000 !== 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is counted in whole numbers (${item.unit})` });
  }
  return item;
}

const NO_STORE = "Add the central store location first (Stock → Locations)";

/** The store location: the only active `store` location, else the one coded STORE. */
async function storeLocation(ctx: Ctx) {
  const rows = await ctx.db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(and(eq(location.companyId, ctx.companyId), eq(location.kind, "store"), eq(location.active, true)))
    .orderBy(asc(location.sortOrder), asc(location.code))
    .limit(5);
  if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: NO_STORE });
  if (rows.length === 1) return rows[0]!;
  const coded = rows.find((r) => r.code === "STORE");
  if (!coded) throw new TRPCError({ code: "BAD_REQUEST", message: "More than one central store; retire the extra ones" });
  return coded;
}

async function balanceOf(ctx: Ctx, itemId: string, locationId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ b: storeBalanceSql(ctx.companyId, sql`${storeItem.id}`, locationId) })
    .from(storeItem)
    .where(and(eq(storeItem.companyId, ctx.companyId), eq(storeItem.id, itemId)))
    .limit(1);
  return Number(row?.b ?? 0);
}

/** Read before the write: an issue the balance already cannot cover never takes a number. */
async function requireBalance(ctx: Ctx, item: StoreItemRow, locationId: string, needMilli: number) {
  const have = await balanceOf(ctx, item.id, locationId);
  if (have < needMilli) throw shortMessage(item, have);
}

function shortMessage(item: StoreItemRow, have: number) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `Only ${fmtMilli(Math.max(have, 0))} ${item.unit} of ${item.name} in the store`,
  });
}

/** The write did not land: say why from the state as it is now. */
async function explainLostWrite(ctx: Ctx, itemId: string, needBalanceMilli: number | null, unit: string): Promise<never> {
  const item = await loadItem(ctx, itemId);
  if (!item.active) throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is retired` });
  if (item.unit !== unit) throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} changed; open it again` });
  const loc = await storeLocation(ctx); // throws NO_STORE if the store was retired meanwhile
  if (needBalanceMilli !== null) {
    const have = await balanceOf(ctx, item.id, loc.id);
    if (have < needBalanceMilli) throw shortMessage(item, have);
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "The store changed; try again" });
}

async function landed(ctx: Ctx, txnId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: storeTxn.id })
    .from(storeTxn)
    .where(and(eq(storeTxn.id, txnId), eq(storeTxn.companyId, ctx.companyId)))
    .limit(1);
  return Boolean(row);
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
        id: z.string().min(1),
        name: itemName.optional(),
        unit: z.enum(storeUnits).optional(),
        category: z.enum(storeCategories).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadItem(ctx, input.id);
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof storeItem.$inferInsert
      >;
      if (input.name !== undefined) patch.nameKey = nameKey(input.name);
      if (Object.keys(patch).length === 0) return { success: true };
      const changingUnit = input.unit !== undefined && input.unit !== existing.unit;
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
          throw new TRPCError({ code: "CONFLICT", message: "That store item already exists" });
        }
        throw e;
      }
      const [ok] = await ctx.db.select({ id: storeItem.id }).from(storeItem).where(mine).limit(1);
      if (!ok) {
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
        itemId: z.string().min(1),
        qtyMilli,
        note,
        /** The vendor's challan or bill number. */
        grnRef: refText(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await usableItem(ctx, input.itemId, [input.qtyMilli]);
      const store = await storeLocation(ctx);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "grn", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const txn: StoreTxnInput = {
        id, companyId: ctx.companyId, seq, kind: "grn", number: doc.number, period: doc.period,
        itemId: item.id, unit: item.unit, qtyMilli: input.qtyMilli, locationId: store.id,
        purpose: null, refId: null, grnRef: input.grnRef, exchangeId: null, note: input.note ?? null,
        userId, at, guardBalance: false,
      };
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
      if (!(await landed(ctx, id))) await explainLostWrite(ctx, item.id, null, item.unit);
      return { id, number: doc.number };
    }),

  /** MRS: − stock at the store; refused when the balance would go negative. Returns the MRS number. */
  issue: actionProcedure("store.txn")
    .input(
      z.object({
        itemId: z.string().min(1),
        qtyMilli,
        purpose: z.enum(issuePurposes),
        /** The melt, nitriding log or job this issue is for. */
        refId: refText(64),
        note,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await usableItem(ctx, input.itemId, [input.qtyMilli]);
      const store = await storeLocation(ctx);
      await requireBalance(ctx, item, store.id, input.qtyMilli);
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "mrs", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const txn: StoreTxnInput = {
        id, companyId: ctx.companyId, seq, kind: "mrs", number: doc.number, period: doc.period,
        itemId: item.id, unit: item.unit, qtyMilli: input.qtyMilli, locationId: store.id,
        purpose: input.purpose, refId: input.refId, grnRef: null, exchangeId: null, note: input.note ?? null,
        userId, at, guardBalance: true,
      };
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
      if (!(await landed(ctx, id))) await explainLostWrite(ctx, item.id, input.qtyMilli, item.unit);
      return { id, number: doc.number };
    }),

  /**
   * Old for new: the old leaves the store under an MRS (purpose "exchange", guarded like any
   * issue: the old must be in the store) and the new comes in under a GRN. One batch; both
   * documents carry the same `exchangeId`. Takes one MRS number and one GRN number, as the
   * two paper forms would.
   */
  exchange: actionProcedure("store.txn")
    .input(z.object({ itemId: z.string().min(1), qtyOutMilli: qtyMilli, qtyInMilli: qtyMilli, note }))
    .mutation(async ({ ctx, input }) => {
      const item = await usableItem(ctx, input.itemId, [input.qtyOutMilli, input.qtyInMilli]);
      const store = await storeLocation(ctx);
      await requireBalance(ctx, item, store.id, input.qtyOutMilli);
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
        purpose: "exchange", refId: null, grnRef: null, guardBalance: true,
      };
      const inn: StoreTxnInput = {
        ...common, id: grnId, kind: "grn", number: grn.number, period: grn.period, qtyMilli: input.qtyInMilli,
        purpose: null, refId: null, grnRef: null, guardBalance: false,
        // The new comes in only if the old went out.
        and: sql`exists (select 1 from ${storeTxn} o where o.id = ${mrsId} and o.company_id = ${ctx.companyId})`,
      };
      const ledger = { companyId: ctx.companyId, seq, userId, at };
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
      if (!(await landed(ctx, mrsId))) await explainLostWrite(ctx, item.id, input.qtyOutMilli, item.unit);
      if (!(await landed(ctx, grnId))) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The exchange was only half saved" });
      return { exchangeId, mrsId, mrsNumber: mrs.number, grnId, grnNumber: grn.number };
    }),

  /**
   * Balance per item at the store location, from the ledger (milli-units). Active items always
   * (0 when empty); a retired item only while it still holds stock.
   */
  balances: storeReader.query(async ({ ctx }) => {
    const [store] = await ctx.db
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.companyId, ctx.companyId), eq(location.kind, "store"), eq(location.active, true)))
      .orderBy(asc(location.sortOrder), asc(location.code))
      .limit(1);
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

  /** Recent GRNs and MRSs, newest first. */
  txns: storeReader
    .input(
      z
        .object({
          itemId: z.string().min(1).optional(),
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
