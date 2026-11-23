/**
 * XE store (row 69): indents, nested under `store` (`store.indents.*`, gated by the `store` module).
 *
 * A department asks the store to buy items: department, items and quantities, a needed-by day and a
 * reason. Status flow (`nextIndentStatus` in @orrn/domain): open → approved | rejected | cancelled,
 * approved → ordered (a purchase order made from it, `store.po.create` with `indentId`) | cancelled.
 * A cancelled order puts its indent back to approved. Numbers `IND-{n}` per financial year.
 *
 * - raise: `indent.raise` (department heads, the storekeeper, office, managers);
 * - approve / reject: `indent.approve` (manager, admin, owner), by role, as the row asks;
 * - cancel: the person who raised it, or an `indent.approve` holder;
 * - read: any of indent.raise, indent.approve, po.view, po.manage;
 * - `fromReorder`: the storekeeper's one-click indent for an item below its minimum (Today), which
 *   returns the live indent that already has the item instead of raising a second one.
 *
 * Every status change is one UPDATE guarded by the status it expects (write time), plus its audit row.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { rowsPerStatement, chunk } from "@orrn/db/chunk";
import { COUNTABLE_STORE_UNITS, storeItem } from "@orrn/db/schema/store";
import { storeIndent, storeIndentLine, storeIndentStatuses, storePo, type StoreIndentRow } from "@orrn/db/schema/storeBuy";
import { belowMinimum, nextIndentStatus, reorderQtyMilli, STORE_MAX_DOC_LINES, type StoreIndentAction } from "@orrn/domain";

import { actionProcedure, anyActionProcedure, router } from "../index";
import type { Context } from "../context";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { can } from "../lib/permissions";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { nextCompanySeq } from "../lib/sequence";
import { assertStoreQty, loadStoreItem, MAX_STORE_QTY_MILLI, resolveStoreLocation, storeBalance } from "../lib/store";
import { isPlantDay } from "../lib/storeBuy";

type Ctx = Pick<Context, "impersonation"> & {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
  role: NonNullable<Context["role"]>;
};

const reader = anyActionProcedure("indent.raise", "indent.approve", "po.view", "po.manage");

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
const lineInput = z.object({ itemId: id64, qtyMilli: z.number().int().min(1).max(MAX_STORE_QTY_MILLI) });

function auditCtx(ctx: Ctx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

async function loadIndent(ctx: Ctx, id: string): Promise<StoreIndentRow> {
  const [row] = await ctx.db
    .select()
    .from(storeIndent)
    .where(and(eq(storeIndent.id, id), eq(storeIndent.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Indent not found" });
  return row;
}

/** Validate lines: 1 to 40, live items of this plant, quantities right for each unit, no item twice. */
async function checkLines(ctx: Ctx, lines: { itemId: string; qtyMilli: number }[]) {
  if (lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one item" });
  if (lines.length > STORE_MAX_DOC_LINES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${STORE_MAX_DOC_LINES} items on one indent` });
  }
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The same item is on the indent twice" });
  }
  for (const l of lines) assertStoreQty(await loadStoreItem(ctx.db, ctx.companyId, l.itemId), [l.qtyMilli]);
}

type NewIndent = {
  department: string;
  neededBy: string | null;
  reason: string | null;
  source: string | null;
  lines: { itemId: string; qtyMilli: number }[];
};

async function insertIndent(ctx: Ctx, input: NewIndent) {
  const userId = ctx.session.user.id;
  const at = clockNow();
  const doc = await nextDocNumber(ctx.db, ctx.companyId, "indent", at, userId);
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const id = crypto.randomUUID();
  const statements: SqliteBatchItem[] = [
    ctx.db.insert(storeIndent).values({
      id,
      companyId: ctx.companyId,
      serverSeq: seq,
      number: doc.number,
      period: doc.period,
      department: input.department,
      neededBy: input.neededBy,
      reason: input.reason,
      status: "open",
      source: input.source,
      createdBy: userId,
      createdAt: at,
    }),
  ];
  const rows = input.lines.map((l, i) => ({
    id: crypto.randomUUID(),
    companyId: ctx.companyId,
    indentId: id,
    line: i + 1,
    itemId: l.itemId,
    qtyMilli: l.qtyMilli,
  }));
  for (const part of chunk(rows, rowsPerStatement(6))) statements.push(ctx.db.insert(storeIndentLine).values(part));
  statements.push(
    auditInsertGuarded(
      auditCtx(ctx),
      {
        action: "store.indent.create",
        subjectType: "store_indent",
        subjectId: id,
        meta: { number: doc.number, department: input.department, lines: input.lines.length, source: input.source },
      },
      { from: storeIndent, where: and(eq(storeIndent.id, id), eq(storeIndent.companyId, ctx.companyId)) },
    ),
  );
  await atomicBatch(ctx.db, statements);
  return { id, number: doc.number };
}

const DECISION_WORDS: Record<StoreIndentAction, string> = {
  approve: "approved",
  reject: "rejected",
  order: "ordered",
  cancel: "cancelled",
};

/** One status change, guarded by the status it expects; refused with the status as it is now. */
async function decide(ctx: Ctx, id: string, action: Exclude<StoreIndentAction, "order">, note: string | null) {
  const indent = await loadIndent(ctx, id);
  const to = nextIndentStatus(indent.status, action);
  if (!to) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${indent.number} is ${indent.status}; it cannot be ${DECISION_WORDS[action]}` });
  }
  if (action === "cancel" && indent.createdBy !== ctx.session.user.id && !can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "indent.approve")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
  }
  const userId = ctx.session.user.id;
  const at = clockNow();
  const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
  const mine = and(eq(storeIndent.id, id), eq(storeIndent.companyId, ctx.companyId), eq(storeIndent.serverSeq, seq));
  await atomicBatch(ctx.db, [
    ctx.db
      .update(storeIndent)
      .set({
        status: to,
        serverSeq: seq,
        updatedAt: at,
        ...(action === "cancel" ? {} : { decidedBy: userId, decidedAt: at }),
        decisionNote: note,
      })
      .where(and(eq(storeIndent.id, id), eq(storeIndent.companyId, ctx.companyId), eq(storeIndent.status, indent.status))),
    auditInsertGuarded(
      auditCtx(ctx),
      { action: `store.indent.${action}`, subjectType: "store_indent", subjectId: id, meta: { number: indent.number, from: indent.status, to, note } },
      { from: storeIndent, where: mine },
    ),
  ]);
  const [ok] = await ctx.db.select({ id: storeIndent.id }).from(storeIndent).where(mine).limit(1);
  if (!ok) {
    const now = await loadIndent(ctx, id);
    throw new TRPCError({ code: "BAD_REQUEST", message: `${now.number} is ${now.status}; it cannot be ${DECISION_WORDS[action]}` });
  }
  return { id, number: indent.number, status: to };
}

export const storeIndentRouter = router({
  /** Newest first; optional status filter. */
  list: reader
    .input(
      z
        .object({ status: z.enum(storeIndentStatuses).optional(), limit: z.number().int().min(1).max(200).default(50) })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: storeIndent.id,
          number: storeIndent.number,
          department: storeIndent.department,
          neededBy: storeIndent.neededBy,
          reason: storeIndent.reason,
          status: storeIndent.status,
          source: storeIndent.source,
          poId: storeIndent.poId,
          poNumber: storePo.number,
          createdBy: storeIndent.createdBy,
          createdAt: storeIndent.createdAt,
          lines: sql<number>`(select count(*) from ${storeIndentLine} c where c.indent_id = ${storeIndent.id} and c.company_id = ${ctx.companyId})`,
        })
        .from(storeIndent)
        .leftJoin(storePo, and(eq(storePo.id, storeIndent.poId), eq(storePo.companyId, storeIndent.companyId)))
        .where(and(eq(storeIndent.companyId, ctx.companyId), input.status ? eq(storeIndent.status, input.status) : undefined))
        .orderBy(desc(storeIndent.createdAt))
        .limit(input.limit);
      return { items: rows.map((r) => ({ ...r, lines: Number(r.lines) })) };
    }),

  get: reader.input(z.object({ id: id64 })).query(async ({ ctx, input }) => {
    const indent = await loadIndent(ctx, input.id);
    const lines = await ctx.db
      .select({
        id: storeIndentLine.id,
        line: storeIndentLine.line,
        itemId: storeIndentLine.itemId,
        itemName: storeItem.name,
        unit: storeItem.unit,
        qtyMilli: storeIndentLine.qtyMilli,
      })
      .from(storeIndentLine)
      .innerJoin(storeItem, and(eq(storeItem.id, storeIndentLine.itemId), eq(storeItem.companyId, storeIndentLine.companyId)))
      .where(and(eq(storeIndentLine.indentId, indent.id), eq(storeIndentLine.companyId, ctx.companyId)))
      .orderBy(asc(storeIndentLine.line));
    const po = indent.poId
      ? (await ctx.db
          .select({ id: storePo.id, number: storePo.number, status: storePo.status })
          .from(storePo)
          .where(and(eq(storePo.id, indent.poId), eq(storePo.companyId, ctx.companyId)))
          .limit(1))[0] ?? null
      : null;
    return { indent, lines, po };
  }),

  create: actionProcedure("indent.raise")
    .input(
      z.object({
        department: z.string().trim().min(1).max(60),
        neededBy: plantDay,
        reason: text(500),
        lines: z.array(lineInput).min(1).max(STORE_MAX_DOC_LINES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkLines(ctx, input.lines);
      return insertIndent(ctx, { ...input, source: null });
    }),

  /**
   * Today's "make indent" (row 72): one line for an item below its minimum, for the reorder quantity
   * (or up to the minimum). Returns the live indent that already has the item, `existing: true`, so a
   * second click or a second storekeeper makes no duplicate.
   */
  fromReorder: actionProcedure("store.txn")
    .input(z.object({ itemId: id64 }))
    .mutation(async ({ ctx, input }) => {
      const item = await loadStoreItem(ctx.db, ctx.companyId, input.itemId);
      const [live] = await ctx.db
        .select({ id: storeIndent.id, number: storeIndent.number })
        .from(storeIndentLine)
        .innerJoin(storeIndent, and(eq(storeIndent.id, storeIndentLine.indentId), eq(storeIndent.companyId, storeIndentLine.companyId)))
        .leftJoin(storePo, and(eq(storePo.id, storeIndent.poId), eq(storePo.companyId, storeIndent.companyId)))
        .where(
          and(
            eq(storeIndentLine.companyId, ctx.companyId),
            eq(storeIndentLine.itemId, item.id),
            sql`(${storeIndent.status} in ('open', 'approved') or (${storeIndent.status} = 'ordered' and ${storePo.status} in ('draft', 'issued', 'part_received')))`,
          ),
        )
        .limit(1);
      if (live) return { id: live.id, number: live.number, existing: true as const };
      const store = await resolveStoreLocation(ctx.db, ctx.companyId);
      const balanceMilli = await storeBalance(ctx.db, ctx.companyId, item.id, store.id);
      if (!belowMinimum(balanceMilli, item.minMilli)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is not below its minimum` });
      }
      const qtyMilli = reorderQtyMilli({
        balanceMilli,
        minMilli: item.minMilli,
        reorderMilli: item.reorderMilli,
        countable: (COUNTABLE_STORE_UNITS as readonly string[]).includes(item.unit),
      });
      assertStoreQty(item, [qtyMilli]);
      const made = await insertIndent(ctx, {
        department: "Store",
        neededBy: null,
        reason: "Below minimum",
        source: "reorder",
        lines: [{ itemId: item.id, qtyMilli }],
      });
      return { ...made, existing: false as const };
    }),

  approve: actionProcedure("indent.approve")
    .input(z.object({ id: id64, note: text(500) }))
    .mutation(({ ctx, input }) => decide(ctx, input.id, "approve", input.note)),

  reject: actionProcedure("indent.approve")
    .input(z.object({ id: id64, note: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => decide(ctx, input.id, "reject", input.note)),

  /** The raiser, or an approver, withdraws an open or approved indent. */
  cancel: actionProcedure("indent.raise")
    .input(z.object({ id: id64, reason: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => decide(ctx, input.id, "cancel", input.reason)),
});
