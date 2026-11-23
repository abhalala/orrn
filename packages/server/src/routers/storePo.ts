/**
 * XE store (rows 70, 71): purchase orders for store items, nested under `store` (`store.po.*`, gated by
 * the `store` module). Scrap purchase lots stay in `purchase.ts` (CONTRACTS-W2 item 6); this covers
 * consumables, gas, LDO, spares and packing material.
 *
 * - A PO names a vendor (the `vendor` master), lines of item / quantity / rate in paise per unit / GST
 *   in basis points, terms and a delivery day. Number `PO-{n}` per financial year, taken when it is made.
 * - Status: draft → issued → part received → closed; draft or issued with nothing received → cancelled.
 *   GRNs against its lines (`store.receive` with `poLineId`) move it to part received and closed
 *   (`poStatusSync`); a part received order may be closed short by hand. Cancelling a GRN moves it back.
 * - Made from an approved indent (`indentId`): the indent turns ordered in the same batch, and turns
 *   approved again if the order is cancelled.
 * - read: po.view or po.manage (storekeeper, office, managers, accounts); write: po.manage.
 *   `openLines` (what is still to come) is also open to the storekeeper (store.txn) for the GRN form.
 * - The A4 print is rendered by the web from `get` (lazy); the Worker builds no PDF.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { chunk, rowsPerStatement } from "@orrn/db/chunk";
import { vendor } from "@orrn/db/schema/purchase";
import { storeItem, storeTxn } from "@orrn/db/schema/store";
import { storeIndent, storePo, storePoLine, storePoStatuses, type StorePoRow } from "@orrn/db/schema/storeBuy";
import { company } from "@orrn/db/schema/tenant";
import {
  maxReceivableMilli,
  poCancellable,
  poClosableByHand,
  poLineMoney,
  poTotals,
  rateFitsQty,
  STORE_MAX_DOC_LINES,
  STORE_MAX_GST_BP,
  STORE_MAX_RATE_PAISE,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, router } from "../index";
import type { Context } from "../context";
import { abortBatchUnlessChanged, atomicBatch, isBatchAbort, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { letterhead } from "../lib/packingListSnapshot";
import { nextCompanySeq } from "../lib/sequence";
import { assertStoreQty, loadStoreItem, MAX_STORE_QTY_MILLI } from "../lib/store";
import { isPlantDay, poHasLiveGrnSql, poLineReceivedSql, readPoTolerance } from "../lib/storeBuy";

type Ctx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

const reader = anyActionProcedure("po.view", "po.manage");
const writer = actionProcedure("po.manage");

const id64 = z.string().min(1).max(64);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => s || null);
const plantDay = z
  .string()
  .refine(isPlantDay, "Pick a real date")
  .nullable()
  .optional()
  .transform((s) => s ?? null);
/** For `update`: a field left out stays as it is (undefined); an empty one clears it (null). */
const textPatch = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => (s === undefined ? undefined : s || null));
const plantDayPatch = z.string().refine(isPlantDay, "Pick a real date").nullable().optional();
const lineInput = z.object({
  itemId: id64,
  qtyMilli: z.number().int().min(1).max(MAX_STORE_QTY_MILLI),
  ratePaise: z.number().int().min(0).max(STORE_MAX_RATE_PAISE),
  gstBp: z.number().int().min(0).max(STORE_MAX_GST_BP),
});
type LineInput = z.infer<typeof lineInput>;

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

async function loadPo(ctx: Ctx, id: string): Promise<StorePoRow> {
  const [row] = await ctx.db
    .select()
    .from(storePo)
    .where(and(eq(storePo.id, id), eq(storePo.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
  return row;
}

/** A live vendor of this plant (not a draft, merged or archived one). */
async function usableVendor(ctx: Ctx, vendorId: string) {
  const [v] = await ctx.db
    .select({ id: vendor.id, name: vendor.name, status: vendor.status })
    .from(vendor)
    .where(and(eq(vendor.id, vendorId), eq(vendor.companyId, ctx.companyId)))
    .limit(1);
  if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
  if (v.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: `${v.name} is not a confirmed vendor` });
  return v;
}

async function checkLines(ctx: Ctx, lines: LineInput[]) {
  if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one item" });
  if (lines.length > STORE_MAX_DOC_LINES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${STORE_MAX_DOC_LINES} items on one order` });
  }
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The same item is on the order twice" });
  }
  for (const l of lines) {
    assertStoreQty(await loadStoreItem(ctx.db, ctx.companyId, l.itemId), [l.qtyMilli]);
    if (!rateFitsQty(l.qtyMilli, l.ratePaise)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity times rate is too large for one line" });
    }
  }
}

function lineRows(ctx: Ctx, poId: string, lines: LineInput[]) {
  return lines.map((l, i) => ({
    id: crypto.randomUUID(),
    companyId: ctx.companyId,
    poId,
    line: i + 1,
    itemId: l.itemId,
    qtyMilli: l.qtyMilli,
    ratePaise: l.ratePaise,
    gstBp: l.gstBp,
  }));
}

function lineInserts(ctx: Ctx, poId: string, lines: LineInput[]): SqliteBatchItem[] {
  return chunk(lineRows(ctx, poId, lines), rowsPerStatement(8)).map((part) => ctx.db.insert(storePoLine).values(part));
}

/** Say why a guarded change did not land, from the order as it is now. */
async function refuseFromNow(ctx: Ctx, id: string, wanted: string): Promise<never> {
  const now = await loadPo(ctx, id);
  throw new TRPCError({ code: "BAD_REQUEST", message: `${now.number} is ${now.status.replace("_", " ")}; it cannot be ${wanted}` });
}

const headerInput = {
  vendorId: id64,
  deliveryDate: plantDay,
  terms: text(1000),
  note: text(500),
};

export const storePoRouter = router({
  list: reader
    .input(
      z
        .object({
          status: z.enum(storePoStatuses).optional(),
          vendorId: id64.optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: storePo.id,
          number: storePo.number,
          status: storePo.status,
          vendorId: storePo.vendorId,
          vendorName: vendor.name,
          deliveryDate: storePo.deliveryDate,
          indentId: storePo.indentId,
          createdAt: storePo.createdAt,
          issuedAt: storePo.issuedAt,
          lines: sql<number>`(select count(*) from ${storePoLine} c where c.po_id = ${storePo.id} and c.company_id = ${ctx.companyId})`,
          amountPaise: sql<number>`coalesce((select sum((m.qty_milli * m.rate_paise + 500) / 1000) from ${storePoLine} m where m.po_id = ${storePo.id} and m.company_id = ${ctx.companyId}), 0)`,
        })
        .from(storePo)
        .innerJoin(vendor, and(eq(vendor.id, storePo.vendorId), eq(vendor.companyId, storePo.companyId)))
        .where(
          and(
            eq(storePo.companyId, ctx.companyId),
            input.status ? eq(storePo.status, input.status) : undefined,
            input.vendorId ? eq(storePo.vendorId, input.vendorId) : undefined,
          ),
        )
        .orderBy(desc(storePo.createdAt))
        .limit(input.limit);
      return { items: rows.map((r) => ({ ...r, lines: Number(r.lines), amountPaise: Number(r.amountPaise) })) };
    }),

  /** The order with its lines, what each received, money, its GRNs, the vendor and the plant letterhead (for the print). */
  get: reader.input(z.object({ id: id64 })).query(async ({ ctx, input }) => {
    const po = await loadPo(ctx, input.id);
    const [v] = await ctx.db
      .select({ id: vendor.id, name: vendor.name, gstin: vendor.gstin, phone: vendor.phone, city: vendor.city })
      .from(vendor)
      .where(and(eq(vendor.id, po.vendorId), eq(vendor.companyId, ctx.companyId)))
      .limit(1);
    const rawLines = await ctx.db
      .select({
        id: storePoLine.id,
        line: storePoLine.line,
        itemId: storePoLine.itemId,
        itemName: storeItem.name,
        unit: storeItem.unit,
        qtyMilli: storePoLine.qtyMilli,
        ratePaise: storePoLine.ratePaise,
        gstBp: storePoLine.gstBp,
        receivedMilli: poLineReceivedSql(ctx.companyId, sql`${storePoLine.id}`),
      })
      .from(storePoLine)
      .innerJoin(storeItem, and(eq(storeItem.id, storePoLine.itemId), eq(storeItem.companyId, storePoLine.companyId)))
      .where(and(eq(storePoLine.poId, po.id), eq(storePoLine.companyId, ctx.companyId)))
      .orderBy(asc(storePoLine.line));
    const lines = rawLines.map((l) => ({ ...l, receivedMilli: Number(l.receivedMilli), ...poLineMoney(l) }));
    const grns = lines.length
      ? await ctx.db
          .select({
            id: storeTxn.id,
            number: storeTxn.number,
            poLineId: storeTxn.poLineId,
            qtyMilli: storeTxn.qtyMilli,
            rejectedMilli: storeTxn.rejectedMilli,
            ratePaise: storeTxn.ratePaise,
            grnRef: storeTxn.grnRef,
            cancelledAt: storeTxn.cancelledAt,
            createdAt: storeTxn.createdAt,
          })
          .from(storeTxn)
          .where(
            and(
              eq(storeTxn.companyId, ctx.companyId),
              eq(storeTxn.kind, "grn"),
              inArray(
                storeTxn.poLineId,
                lines.map((l) => l.id),
              ),
            ),
          )
          .orderBy(asc(storeTxn.createdAt))
          .limit(500)
      : [];
    const indent = po.indentId
      ? (await ctx.db
          .select({ id: storeIndent.id, number: storeIndent.number })
          .from(storeIndent)
          .where(and(eq(storeIndent.id, po.indentId), eq(storeIndent.companyId, ctx.companyId)))
          .limit(1))[0] ?? null
      : null;
    const [co] = await ctx.db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
    return {
      po,
      vendor: v ?? null,
      lines,
      totals: poTotals(lines),
      grns,
      indent,
      plant: { name: co?.name ?? "", ...letterhead((co?.settings ?? null) as Record<string, unknown> | null) },
      overReceiptBp: await readPoTolerance(ctx.db, ctx.companyId),
    };
  }),

  /**
   * Lines of issued and part received orders still to come, for the GRN form (optionally one item):
   * ordered, received, and the most this line may still take under the tolerance.
   */
  openLines: anyActionProcedure("store.txn", "po.view", "po.manage")
    .input(z.object({ itemId: id64.optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const bp = await readPoTolerance(ctx.db, ctx.companyId);
      const rows = await ctx.db
        .select({
          lineId: storePoLine.id,
          poId: storePo.id,
          poNumber: storePo.number,
          vendorName: vendor.name,
          line: storePoLine.line,
          itemId: storePoLine.itemId,
          itemName: storeItem.name,
          unit: storeItem.unit,
          orderedMilli: storePoLine.qtyMilli,
          ratePaise: storePoLine.ratePaise,
          receivedMilli: poLineReceivedSql(ctx.companyId, sql`${storePoLine.id}`),
        })
        .from(storePoLine)
        .innerJoin(storePo, and(eq(storePo.id, storePoLine.poId), eq(storePo.companyId, storePoLine.companyId)))
        .innerJoin(vendor, and(eq(vendor.id, storePo.vendorId), eq(vendor.companyId, storePo.companyId)))
        .innerJoin(storeItem, and(eq(storeItem.id, storePoLine.itemId), eq(storeItem.companyId, storePoLine.companyId)))
        .where(
          and(
            eq(storePoLine.companyId, ctx.companyId),
            // An order a full delivery closed still offers its tolerance room for a late top-up.
            sql`(${storePo.status} in ('issued', 'part_received') or (${storePo.status} = 'closed' and ${storePo.closedBy} is null))`,
            input.itemId ? eq(storePoLine.itemId, input.itemId) : undefined,
            // Room left (ordered + tolerance - received > 0) before the limit: full lines never crowd out open ones.
            sql`${poLineReceivedSql(ctx.companyId, sql`${storePoLine.id}`)} < ${storePoLine.qtyMilli} + (${storePoLine.qtyMilli} * ${bp}) / 10000`,
          ),
        )
        .orderBy(asc(storePo.createdAt), asc(storePoLine.line))
        .limit(200);
      return {
        overReceiptBp: bp,
        items: rows
          .map((r) => {
            const receivedMilli = Number(r.receivedMilli);
            return { ...r, receivedMilli, roomMilli: Math.max(0, maxReceivableMilli(r.orderedMilli, bp) - receivedMilli) };
          })
          .filter((r) => r.roomMilli > 0),
      };
    }),

  /** A draft order. With `indentId`, the approved indent turns ordered in the same batch. */
  create: writer
    .input(z.object({ ...headerInput, indentId: id64.optional(), lines: z.array(lineInput).min(1).max(STORE_MAX_DOC_LINES) }))
    .mutation(async ({ ctx, input }) => {
      const v = await usableVendor(ctx, input.vendorId);
      await checkLines(ctx, input.lines);
      let indentNumber: string | null = null;
      if (input.indentId) {
        const [ind] = await ctx.db
          .select({ number: storeIndent.number, status: storeIndent.status })
          .from(storeIndent)
          .where(and(eq(storeIndent.id, input.indentId), eq(storeIndent.companyId, ctx.companyId)))
          .limit(1);
        if (!ind) throw new TRPCError({ code: "NOT_FOUND", message: "Indent not found" });
        if (ind.status !== "approved") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${ind.number} is ${ind.status}; only an approved indent becomes an order` });
        }
        indentNumber = ind.number;
      }
      const userId = ctx.session.user.id;
      const at = clockNow();
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "store_po", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(storePo).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          number: doc.number,
          period: doc.period,
          vendorId: v.id,
          status: "draft",
          deliveryDate: input.deliveryDate,
          terms: input.terms,
          note: input.note,
          indentId: input.indentId ?? null,
          createdBy: userId,
          createdAt: at,
        }),
        ...lineInserts(ctx, id, input.lines),
      ];
      if (input.indentId) {
        statements.push(
          ctx.db
            .update(storeIndent)
            .set({ status: "ordered", poId: id, serverSeq: seq, updatedAt: at })
            .where(and(eq(storeIndent.id, input.indentId), eq(storeIndent.companyId, ctx.companyId), eq(storeIndent.status, "approved"))),
          abortBatchUnlessChanged(ctx.db),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "store.po.create",
            subjectType: "store_po",
            subjectId: id,
            meta: { number: doc.number, vendorId: v.id, lines: input.lines.length, indent: indentNumber },
          },
          { from: storePo, where: and(eq(storePo.id, id), eq(storePo.companyId, ctx.companyId)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${indentNumber} is no longer approved; open it again` });
        }
        throw e;
      }
      return { id, number: doc.number };
    }),

  /** Change a draft: header fields and, when given, all its lines (replaced). */
  update: writer
    .input(
      z.object({
        id: id64,
        vendorId: id64.optional(),
        deliveryDate: plantDayPatch,
        terms: textPatch(1000),
        note: textPatch(500),
        lines: z.array(lineInput).min(1).max(STORE_MAX_DOC_LINES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const po = await loadPo(ctx, input.id);
      if (po.status !== "draft") await refuseFromNow(ctx, po.id, "changed");
      if (input.vendorId) await usableVendor(ctx, input.vendorId);
      if (input.lines) await checkLines(ctx, input.lines);
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(storePo)
          .set({
            // Only a vendor the request names: an omitted one must not write back what this request read.
            ...(input.vendorId ? { vendorId: input.vendorId } : {}),
            ...(input.deliveryDate !== undefined ? { deliveryDate: input.deliveryDate } : {}),
            ...(input.terms !== undefined ? { terms: input.terms } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            serverSeq: seq,
            updatedAt: at,
          })
          .where(and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.status, "draft"))),
        abortBatchUnlessChanged(ctx.db),
      ];
      if (input.lines) {
        statements.push(
          ctx.db.delete(storePoLine).where(and(eq(storePoLine.poId, po.id), eq(storePoLine.companyId, ctx.companyId))),
          ...lineInserts(ctx, po.id, input.lines),
        );
      }
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          {
            action: "store.po.update",
            subjectType: "store_po",
            subjectId: po.id,
            meta: { number: po.number, vendorId: input.vendorId ?? null, vendorBefore: input.vendorId ? po.vendorId : null, lines: input.lines?.length ?? null },
          },
          { from: storePo, where: and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.serverSeq, seq)) },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e)) await refuseFromNow(ctx, po.id, "changed");
        throw e;
      }
      return { id: po.id, number: po.number };
    }),

  /** Draft → issued: the order goes to the vendor (and can be printed as issued). */
  issue: writer.input(z.object({ id: id64 })).mutation(async ({ ctx, input }) => {
    const po = await loadPo(ctx, input.id);
    const userId = ctx.session.user.id;
    const at = clockNow();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    try {
      await atomicBatch(ctx.db, [
        ctx.db
          .update(storePo)
          .set({ status: "issued", issuedBy: userId, issuedAt: at, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(storePo.id, po.id),
              eq(storePo.companyId, ctx.companyId),
              eq(storePo.status, "draft"),
              sql`exists (select 1 from ${storePoLine} l where l.po_id = ${storePo.id} and l.company_id = ${ctx.companyId})`,
            ),
          ),
        abortBatchUnlessChanged(ctx.db),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "store.po.issue", subjectType: "store_po", subjectId: po.id, meta: { number: po.number } },
          { from: storePo, where: and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.serverSeq, seq)) },
        ),
      ]);
    } catch (e) {
      if (isBatchAbort(e)) await refuseFromNow(ctx, po.id, "issued");
      throw e;
    }
    return { id: po.id, number: po.number, status: "issued" as const };
  }),

  /** Part received → closed by hand: the rest will not come (short close). */
  close: writer.input(z.object({ id: id64, note: z.string().trim().min(1).max(500) })).mutation(async ({ ctx, input }) => {
    const po = await loadPo(ctx, input.id);
    if (!poClosableByHand(po.status)) await refuseFromNow(ctx, po.id, "closed");
    const userId = ctx.session.user.id;
    const at = clockNow();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    try {
      await atomicBatch(ctx.db, [
        ctx.db
          .update(storePo)
          .set({ status: "closed", closedBy: userId, closedAt: at, closeNote: input.note, serverSeq: seq, updatedAt: at })
          .where(and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.status, "part_received"))),
        abortBatchUnlessChanged(ctx.db),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "store.po.close", subjectType: "store_po", subjectId: po.id, meta: { number: po.number, note: input.note } },
          { from: storePo, where: and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.serverSeq, seq)) },
        ),
      ]);
    } catch (e) {
      if (isBatchAbort(e)) await refuseFromNow(ctx, po.id, "closed");
      throw e;
    }
    return { id: po.id, number: po.number, status: "closed" as const };
  }),

  /**
   * Draft, or issued with nothing received → cancelled; the number stays used. Refused at write time
   * while any live GRN is against it (close it short instead). Its indent turns approved again.
   */
  cancel: writer.input(z.object({ id: id64, reason: z.string().trim().min(1).max(500) })).mutation(async ({ ctx, input }) => {
    const po = await loadPo(ctx, input.id);
    if (!poCancellable(po.status, false)) await refuseFromNow(ctx, po.id, "cancelled");
    const userId = ctx.session.user.id;
    const at = clockNow();
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [
      ctx.db
        .update(storePo)
        .set({ status: "cancelled", cancelledBy: userId, cancelledAt: at, cancelReason: input.reason, serverSeq: seq, updatedAt: at })
        .where(
          and(
            eq(storePo.id, po.id),
            eq(storePo.companyId, ctx.companyId),
            inArray(storePo.status, ["draft", "issued"]),
            sql`not ${poHasLiveGrnSql(ctx.companyId, sql`${storePo.id}`)}`,
          ),
        ),
      abortBatchUnlessChanged(ctx.db),
    ];
    if (po.indentId) {
      statements.push(
        ctx.db
          .update(storeIndent)
          .set({ status: "approved", poId: null, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(storeIndent.id, po.indentId),
              eq(storeIndent.companyId, ctx.companyId),
              eq(storeIndent.status, "ordered"),
              eq(storeIndent.poId, po.id),
            ),
          ),
      );
    }
    statements.push(
      auditInsertGuarded(
        auditCtx(ctx),
        { action: "store.po.cancel", subjectType: "store_po", subjectId: po.id, meta: { number: po.number, reason: input.reason } },
        { from: storePo, where: and(eq(storePo.id, po.id), eq(storePo.companyId, ctx.companyId), eq(storePo.serverSeq, seq)) },
      ),
    );
    try {
      await atomicBatch(ctx.db, statements);
    } catch (e) {
      if (isBatchAbort(e)) {
        const now = await loadPo(ctx, po.id);
        if (now.status === "issued" || now.status === "part_received") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${now.number} already has goods in; close it short instead` });
        }
        await refuseFromNow(ctx, po.id, "cancelled");
      }
      throw e;
    }
    return { id: po.id, number: po.number, status: "cancelled" as const };
  }),
});
