/**
 * Sales orders and baki (spec P13, digest Stage 15; PL-8). Mounted as `orders`.
 *
 * Writes need `order.manage` (office, manager, owner; digest §4.2). Reads are open to every member:
 * order lines carry no prices, and the floor needs them (Pack suggests the open line for a section,
 * Dispatch links bundles to lines; ruling PL8-R1).
 */
import { confirmBlockers } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import {
  openSalesOrderStatuses,
  salesOrder,
  salesOrderLine,
  salesOrderQtyBases,
  salesOrderStatuses,
  salesOrderWeightBases,
  type SalesOrderStatus,
} from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, chunk, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { now as clockNow } from "../lib/clock";
import { companyTimezone, zonedYmd } from "../lib/dayWindow";
import { nextDocNumber } from "../lib/docNumber";
import {
  batchAbortUnless,
  isBatchAbort,
  kgText,
  lineBalancePage,
  lineBalances,
  lineTotals,
  orderTotals,
  sumBalances,
} from "../lib/orders";
import { nextCompanySeq } from "../lib/sequence";
import { assertDieAllowed } from "../lib/dieOwner";
import { companyFloor, resolveLineEdits, resolveLines, type ResolvedLine } from "../lib/orderLines";
import { can, type Action, type CompanyRole } from "../lib/permissions";
import { assertPoFree, orderDetailExtras, orderFlowProcedures, poRepeatGuard } from "./orderFlow";
import { lineStrips, onReleasedPlan } from "../lib/orderStrip";

const MAX_LINES = 100;

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Not a real date");

const text = (max: number) => z.string().trim().max(max);

export const orderLineInput = z.object({
  /** The section (`die` catalogue row). */
  sectionId: z.string().min(1).max(64),
  /** Target kg/12ft × 1000 (grams per 12 ft). */
  kgPer12ftMilli: z.number().int().min(1).max(500_000).nullable().optional(),
  cutLengthMm: z.number().int().min(1).max(30_000),
  pcs: z.number().int().min(1).max(10_000_000).nullable().optional(),
  /**
   * Ordered weight in grams (≤ 1,000 t). Required unless `qtyBasis` is `pcs` (the server then
   * computes it from the pieces and the weight basis, FP-OP-03).
   */
  kgG: z.number().int().min(1, "Weight must be more than 0").max(1_000_000_000).optional(),
  finish: text(40).nullable().optional(),
  note: text(500).nullable().optional(),
  // FP-OP-02/03/04 (Wave 1). All optional so PL-8 screens keep working; `qtyBasis` switches the
  // line to the server-computed path (basis snapshot, pcs <-> kg, implied kg).
  /** Pin one copy of the section (else the die room picks at issue). */
  dieInstanceId: z.string().min(1).max(64).nullable().optional(),
  /** "This tier or better" instead of a copy. */
  tierRank: z.number().int().min(1).max(99).nullable().optional(),
  qtyBasis: z.enum(salesOrderQtyBases).optional(),
  weightBasis: z.enum(salesOrderWeightBases).optional(),
  alloy: text(16).nullable().optional(),
  temper: text(8).nullable().optional(),
  /** Rs/kg in paise; needs `priceOnSalesOrder` and `order.price` (C23). */
  ratePaise: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

const createInput = z.object({
  customerId: z.string().min(1).max(64),
  poNumber: text(100).nullable().optional(),
  /** Company calendar date; defaults to today on the company clock. */
  orderDate: ymd.optional(),
  /** Only `booking` (or omitted): confirm with `orders.confirm` (D11). */
  status: z.enum(salesOrderStatuses).optional(),
  note: text(1000).nullable().optional(),
  lines: z.array(orderLineInput).min(1, "Add at least one line").max(MAX_LINES, `At most ${MAX_LINES} lines`),
  /**
   * Replay key (T28 rule for write screens): a retry after an unsure answer with the same key returns
   * the order the first call made instead of making a second one with a new SO number.
   */
  clientRequestId: z.string().trim().min(1).max(64).optional(),
});

const updateInput = z.object({
  id: z.string().min(1).max(64),
  /**
   * The order's `serverSeq` as the editor read it (`orders.get`), required (review round 3 m-6): a
   * save over a newer version (another user's save, a status move, a dispatch completing moves it
   * to dispatching) answers CONFLICT instead of silently overwriting it.
   */
  serverSeq: z.number().int().nonnegative(),
  customerId: z.string().min(1).max(64).optional(),
  poNumber: text(100).nullable().optional(),
  orderDate: ymd.optional(),
  note: text(1000).nullable().optional(),
  /** Must equal the order's status when sent: an edit never moves it (D11; confirm / close / cancel do). */
  status: z.enum(salesOrderStatuses).optional(),
  /** The full set of lines: existing ones by id (changed in place), new ones without id; missing ones are removed. */
  lines: z
    .array(orderLineInput.extend({ id: z.string().min(1).max(64).optional() }))
    .min(1, "Add at least one line")
    .max(MAX_LINES, `At most ${MAX_LINES} lines`)
    .optional(),
});

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

/**
 * The order a create request asked for, as a SHA-256 hex (review round 3 m-2). Kept in the
 * `order.create` audit meta so a replay with the same `clientRequestId` but another order (customer,
 * PO, date, status, note or any line field) is a CONFLICT (AGENTS.md RP18), even after later edits.
 */
async function createFingerprint(input: z.infer<typeof createInput>): Promise<string> {
  const order = {
    customerId: input.customerId,
    poNumber: blank(input.poNumber),
    orderDate: input.orderDate ?? null,
    status: input.status ?? "booking",
    note: blank(input.note),
    lines: input.lines.map((l) => [
      l.sectionId,
      l.kgPer12ftMilli ?? null,
      l.cutLengthMm,
      l.pcs ?? null,
      l.kgG ?? null,
      blank(l.finish),
      blank(l.note),
      l.dieInstanceId ?? null,
      l.tierRank ?? null,
      l.qtyBasis ?? null,
      l.weightBasis ?? null,
      blank(l.alloy),
      blank(l.temper),
      l.ratePaise ?? null,
    ]),
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(order)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadOrder(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  return row;
}

async function assertCustomer(db: OrrnDb, companyId: string, customerId: string) {
  const [row] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
}

async function assertSections(db: OrrnDb, companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await mapInChunks(unique, (part) =>
    db
      .select({ id: die.id })
      .from(die)
      .where(and(eq(die.companyId, companyId), inArray(die.id, part), isNull(die.deletedAt))),
  );
  if (found.length !== unique.length) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
}

/** EXISTS: something points at the outer order line (a bundle packed for it or any dispatch item). */
function lineHasLinks(companyId: string, lineId: SQL | string): SQL {
  return sql`(exists (select 1 from bundle b where b.company_id = ${companyId} and b.sales_order_line_id = ${lineId}) or exists (select 1 from dispatch_item di where di.company_id = ${companyId} and di.sales_order_line_id = ${lineId}))`;
}

/** The stored line columns of a resolved line (`undefined` W1 fields stay as they are on update). */
function resolvedColumns(r: ResolvedLine) {
  return {
    kgPer12ftMilli: r.kgPer12ftMilli,
    pcs: r.pcs,
    kgG: r.kgG,
    alloy: r.alloy,
    temper: r.temper,
    dieInstanceId: r.dieInstanceId,
    tierRank: r.tierRank,
    qtyBasis: r.qtyBasis,
    impliedG: r.impliedG,
    weightBasis: r.weightBasis,
    bandStartMilli: r.bandStartMilli,
    copyMilli: r.copyMilli,
    readingId: r.readingId,
    basisNote: r.basisNote,
    ratePaise: r.ratePaise,
  };
}

function lineRow(
  input: z.infer<typeof orderLineInput>,
  resolved: ResolvedLine,
  extra: { id: string; companyId: string; serverSeq: number; salesOrderId: string; lineNo: number; createdBy: string },
) {
  const cols = resolvedColumns(resolved);
  return {
    id: extra.id,
    companyId: extra.companyId,
    serverSeq: extra.serverSeq,
    salesOrderId: extra.salesOrderId,
    lineNo: extra.lineNo,
    dieId: input.sectionId,
    cutLengthMm: input.cutLengthMm,
    finish: blank(input.finish),
    note: blank(input.note),
    createdBy: extra.createdBy,
    ...cols,
    // Inserts bind every key (JS undefined -> NULL); keep the parameter count fixed per row.
    dieInstanceId: cols.dieInstanceId ?? null,
    tierRank: cols.tierRank ?? null,
    qtyBasis: cols.qtyBasis ?? null,
    impliedG: cols.impliedG ?? null,
    weightBasis: cols.weightBasis ?? null,
    bandStartMilli: cols.bandStartMilli ?? null,
    copyMilli: cols.copyMilli ?? null,
    readingId: cols.readingId ?? null,
    basisNote: cols.basisNote ?? null,
    ratePaise: cols.ratePaise ?? null,
  };
}

export const roleCan = (role: CompanyRole, action: Action) => can({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);
const canPrice = (role: CompanyRole) => roleCan(role, "order.price");

export const salesOrderRouter = router({
  // Wave 1 (FP-OP, W1-OP-S): confirm / close / cancel, quote, repriceWeight, timeline, lineBundles,
  // reallocate, plantStock, matchStock, late, suggestLine.
  ...orderFlowProcedures,
  create: actionProcedure("order.manage")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // D11 / review round 1 I-1: a new order is a booking; confirming is `orders.confirm`.
      if (input.status !== undefined && input.status !== "booking") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A new order is saved as a booking. Confirm it with Confirm once it is complete.",
        });
      }
      const fingerprint = await createFingerprint(input);
      /** The order this key already made, if any; CONFLICT when it was made from another request. */
      const byRequest = async () => {
        if (!input.clientRequestId) return null;
        const [row] = await ctx.db
          .select({ id: salesOrder.id, number: salesOrder.number, customerId: salesOrder.customerId })
          .from(salesOrder)
          .where(and(eq(salesOrder.companyId, ctx.companyId), eq(salesOrder.clientRequestId, input.clientRequestId)))
          .limit(1);
        if (!row) return null;
        const [made] = await ctx.db
          .select({ fingerprint: sql<string | null>`json_extract(${auditLog.meta}, '$.fingerprint')` })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.companyId, ctx.companyId),
              eq(auditLog.action, "order.create"),
              eq(auditLog.subjectType, "sales_order"),
              eq(auditLog.subjectId, row.id),
            ),
          )
          .limit(1);
        // Orders made before the fingerprint was kept compare on the customer only.
        const same = made?.fingerprint ? made.fingerprint === fingerprint : row.customerId === input.customerId;
        if (!same) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `This save was already used for another order (${row.number}). Reload the order screen and save again.`,
          });
        }
        return row;
      };
      const prior = await byRequest();
      if (prior) return { id: prior.id, number: prior.number, replayed: true as const };
      await assertCustomer(ctx.db, ctx.companyId, input.customerId);
      await assertSections(ctx.db, ctx.companyId, input.lines.map((l) => l.sectionId));
      const resolved = await resolveLines(ctx.db, ctx.companyId, input.lines, { canPrice: canPrice(ctx.role) });
      const poNumber = blank(input.poNumber);
      if (poNumber) await assertPoFree(ctx.db, ctx.companyId, { customerId: input.customerId, poNumber });

      const at = clockNow();
      const userId = ctx.session.user.id;
      const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
      const today = zonedYmd(companyTimezone(co?.settings), at.getTime());
      const orderDate =
        input.orderDate ?? `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
      // SO numbers restart every financial year: the order keeps the period it was numbered in, and
      // the unique key is (company, period, number).
      const { number, period } = await nextDocNumber(ctx.db, ctx.companyId, "so", at, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const id = crypto.randomUUID();
      const status: SalesOrderStatus = "booking";

      const statements: SqliteBatchItem[] = [
        ctx.db.insert(salesOrder).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          period,
          number,
          customerId: input.customerId,
          poNumber,
          orderDate,
          status,
          note: blank(input.note),
          lineSeq: input.lines.length,
          clientRequestId: input.clientRequestId ?? null,
          statusChangedAt: at,
          statusChangedBy: userId,
          createdBy: userId,
          createdAt: at,
        }),
      ];
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(salesOrderLine).values(rows),
        input.lines.map((l, i) =>
          lineRow(l, resolved[i]!, {
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            salesOrderId: id,
            lineNo: i + 1,
            createdBy: userId,
          }),
        ),
      );
      // Write-time PO repeat check (FP-OP-01): a second order with this PO saved meanwhile fails the batch.
      if (poNumber) statements.push(poRepeatGuard(ctx.db, ctx.companyId, { customerId: input.customerId, poNumber }));
      statements.push(
        auditInsert(ctx, {
          action: "order.create",
          subjectType: "sales_order",
          subjectId: id,
          meta: {
            number,
            period,
            customerId: input.customerId,
            lines: input.lines.length,
            kgG: resolved.reduce((s, l) => s + l.kgG, 0),
            ...(input.clientRequestId ? { fingerprint } : {}),
          },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({ code: "CONFLICT", message: `PO ${poNumber} is already on another order of this customer` });
        }
        // The same key raced in from a retry: the first one's order stands (this number is a gap, R5).
        const won = /UNIQUE constraint failed: sales_order\.company_id, sales_order\.client_request_id/.test(errorText(e))
          ? await byRequest()
          : null;
        if (!won) throw e;
        return { id: won.id, number: won.number, replayed: true as const };
      }
      return { id, number, replayed: false as const };
    }),

  update: actionProcedure("order.manage")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      if (order.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled order can't be changed" });
      }
      // D11 / review round 1 I-1: an edit never moves the status. booking -> confirmed is
      // `orders.confirm` (blockers, PO, owner check), -> closed is `orders.close` (reason while baki
      // is left), -> cancelled is `orders.cancel` (nothing packed / planned / pressed / dispatched);
      // dispatching is set by the first completed dispatch.
      if (input.status !== undefined && input.status !== order.status) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `An edit can't move the order from ${order.status} to ${input.status}. Use Confirm, Close or Cancel.`,
        });
      }
      if (input.serverSeq !== order.serverSeq) {
        throw new TRPCError({ code: "CONFLICT", message: "This order changed while you were editing it. Reload and try again." });
      }
      const userId = ctx.session.user.id;

      const existing = await ctx.db
        .select({ row: salesOrderLine, linked: lineHasLinks(ctx.companyId, sql`${salesOrderLine.id}`) })
        .from(salesOrderLine)
        .where(and(eq(salesOrderLine.companyId, ctx.companyId), eq(salesOrderLine.salesOrderId, order.id)));
      const byId = new Map(existing.map((l) => [l.row.id, { ...l.row, linked: l.linked }]));
      const anyLinked = existing.some((l) => Boolean(l.linked));
      const customerChanged = Boolean(input.customerId && input.customerId !== order.customerId);

      if (customerChanged) {
        if (anyLinked) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bundles are linked to this order; the customer can't change" });
        }
        await assertCustomer(ctx.db, ctx.companyId, input.customerId!);
      }

      // Lines: diff the full set against what is stored.
      const removals: { id: string; lineNo: number }[] = [];
      const changes: (z.infer<typeof orderLineInput> & { id: string; sectionChanged: boolean })[] = [];
      const additions: z.infer<typeof orderLineInput>[] = [];
      if (input.lines) {
        const keep = new Set<string>();
        for (const l of input.lines) {
          if (l.id) {
            const cur = byId.get(l.id);
            if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
            if (keep.has(l.id)) throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${cur.lineNo} is listed twice` });
            keep.add(l.id);
            const sectionChanged = cur.dieId !== l.sectionId;
            if (sectionChanged && cur.linked) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Line ${cur.lineNo} has bundles; its section can't change`,
              });
            }
            changes.push({ ...l, id: l.id, sectionChanged });
          } else {
            additions.push(l);
          }
        }
        for (const cur of existing) {
          if (keep.has(cur.row.id)) continue;
          if (cur.linked) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Line ${cur.row.lineNo} has bundles or dispatches; change its kg instead of removing it`,
            });
          }
          removals.push({ id: cur.row.id, lineNo: cur.row.lineNo });
        }
        if (removals.length > 0) {
          const planned = await mapInChunks(
            removals.map((r) => r.id),
            (part) =>
              ctx.db
                .select({ lineId: sql<string>`pl.sales_order_line_id` })
                .from(sql`press_plan_line pl`)
                .where(sql`pl.company_id = ${ctx.companyId} and pl.sales_order_line_id in (${sql.join(part.map((id) => sql`${id}`), sql`, `)})`),
          );
          if (planned.length > 0) {
            const nos = removals.filter((r) => planned.some((x) => x.lineId === r.id)).map((r) => r.lineNo);
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Line ${nos.join(", ")} is on a press plan; change its kg instead of removing it`,
            });
          }
        }
        await assertSections(ctx.db, ctx.companyId, [...changes.filter((c) => c.sectionChanged), ...additions].map((l) => l.sectionId));
      }
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const priceOk = canPrice(ctx.role);
      // Review round 1 I-4: an edit of a W1 line keeps its locked basis (or re-bases it, audited).
      const edits = await resolveLineEdits(
        ctx.db,
        ctx.companyId,
        changes.map((c) => ({ input: c, stored: byId.get(c.id)! })),
        { canPrice: priceOk, floor },
      );
      const resolvedAdds = await resolveLines(ctx.db, ctx.companyId, additions, { canPrice: priceOk, floor });

      // Figures of a line on a released press plan are fixed (the press has its quantity), and a
      // W1 line can't go below what already left (as `orders.repriceWeight`).
      const figureIds = changes.filter((_, i) => edits[i]!.figuresChanged).map((c) => c.id);
      if (figureIds.length > 0) {
        const released = await mapInChunks(figureIds, (part) =>
          ctx.db
            .select({ id: salesOrderLine.id, lineNo: salesOrderLine.lineNo })
            .from(salesOrderLine)
            .where(and(eq(salesOrderLine.companyId, ctx.companyId), inArray(salesOrderLine.id, part), onReleasedPlan(ctx.companyId, sql`${salesOrderLine.id}`))),
        );
        if (released.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Line ${released.map((r) => r.lineNo).sort((a, b) => a - b).join(", ")} is on a released press plan; its kg, pieces, length and section can't change now`,
          });
        }
        const w1KgIds = changes.filter((c, i) => edits[i]!.w1 && edits[i]!.resolved.kgG !== byId.get(c.id)!.kgG).map((c) => c.id);
        if (w1KgIds.length > 0) {
          const strips = await lineStrips(ctx.db, ctx.companyId, w1KgIds);
          for (const [i, c] of changes.entries()) {
            const strip = strips.get(c.id);
            const next = edits[i]!.resolved.kgG;
            if (strip && strip.dispatchedG > next) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${kgText(strip.dispatchedG)} kg is already dispatched on line ${byId.get(c.id)!.lineNo}, more than the new ${kgText(next)} kg`,
              });
            }
          }
        }
      }

      // FP-OP-01: the PO stays unique per customer among live orders.
      const nextCustomer = input.customerId ?? order.customerId;
      const nextPo = input.poNumber === undefined ? order.poNumber : blank(input.poNumber);
      const poCheck = nextPo && (nextPo !== order.poNumber || nextCustomer !== order.customerId);
      if (poCheck) await assertPoFree(ctx.db, ctx.companyId, { customerId: nextCustomer, poNumber: nextPo, exceptOrderId: order.id });

      // D11: a confirmed (or dispatching) order stays what confirm checked: the confirm blockers on
      // the order as it will be, and the owner check on every pinned copy that changes (or on all
      // of them when the customer changes).
      if (order.status === "confirmed" || order.status === "dispatching") {
        const after = input.lines
          ? input.lines.map((l) => {
              if (l.id) {
                const i = changes.findIndex((c) => c.id === l.id);
                const e = edits[i]!;
                const cur = byId.get(l.id)!;
                return {
                  pcs: e.resolved.pcs,
                  kgG: e.resolved.kgG,
                  cutLengthMm: l.cutLengthMm,
                  alloy: e.resolved.alloy,
                  temper: e.resolved.temper,
                  dieInstanceId: e.pin,
                  tierRank: e.resolved.tierRank !== undefined ? e.resolved.tierRank : cur.tierRank,
                  sectionId: l.sectionId,
                  pinCheck: e.pinChanged,
                };
              }
              const r = resolvedAdds[additions.indexOf(l)]!;
              return {
                pcs: r.pcs,
                kgG: r.kgG,
                cutLengthMm: l.cutLengthMm,
                alloy: r.alloy,
                temper: r.temper,
                dieInstanceId: r.dieInstanceId ?? null,
                tierRank: r.tierRank ?? null,
                sectionId: l.sectionId,
                pinCheck: true,
              };
            })
          : existing.map(({ row }) => ({ ...row, sectionId: row.dieId, pinCheck: false }));
        const blockers = confirmBlockers({ poNumber: nextPo, dieRequired: floor.floor.dieRequiredOnSalesOrder, lines: after });
        if (blockers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This order is ${order.status}; it still needs: ${blockers.join(", ")}`,
          });
        }
        for (const l of after) {
          if (l.dieInstanceId && (l.pinCheck || customerChanged)) {
            await assertDieAllowed(ctx.db, ctx.companyId, {
              dieId: l.sectionId,
              dieInstanceId: l.dieInstanceId,
              customerId: nextCustomer,
              purpose: "plan",
            });
          }
        }
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const lineSeq = Math.max(order.lineSeq, ...existing.map((l) => l.row.lineNo)) + additions.length;
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(salesOrder)
          .set({
            customerId: input.customerId ?? order.customerId,
            poNumber: nextPo,
            orderDate: input.orderDate ?? order.orderDate,
            note: input.note === undefined ? order.note : blank(input.note),
            lineSeq: sql`max(${salesOrder.lineSeq}, ${lineSeq})`,
            serverSeq: seq,
          })
          .where(
            and(
              eq(salesOrder.id, order.id),
              eq(salesOrder.companyId, ctx.companyId),
              // Write-time optimistic version (correctness m-3): only over the version the editor read,
              // and in the status it was checked in.
              eq(salesOrder.serverSeq, input.serverSeq),
              eq(salesOrder.status, order.status),
              customerChanged
                ? sql`not exists (select 1 from sales_order_line l where l.company_id = ${ctx.companyId} and l.sales_order_id = ${order.id} and ${lineHasLinks(ctx.companyId, sql`l.id`)})`
                : undefined,
            ),
          ),
        // Nothing below lands unless the order row above did (one outcome for the whole edit).
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`exists (select 1 from sales_order o where o.id = ${order.id} and o.company_id = ${ctx.companyId} and o.server_seq = ${seq})`,
        ),
      ];
      for (const r of removals) {
        statements.push(
          ctx.db
            .delete(salesOrderLine)
            .where(
              and(
                eq(salesOrderLine.id, r.id),
                eq(salesOrderLine.companyId, ctx.companyId),
                eq(salesOrderLine.salesOrderId, order.id),
                sql`not ${lineHasLinks(ctx.companyId, sql`${salesOrderLine.id}`)}`,
                // A line put on a press plan meanwhile stays (its plan line points at it).
                sql`not exists (select 1 from press_plan_line pl where pl.company_id = ${ctx.companyId} and pl.sales_order_line_id = ${salesOrderLine.id})`,
              ),
            ),
        );
      }
      for (const [ci, c] of changes.entries()) {
        const e = edits[ci]!;
        statements.push(
          ctx.db
            .update(salesOrderLine)
            .set({
              dieId: c.sectionId,
              ...resolvedColumns(e.resolved),
              // A pinned copy belongs to the old section: a section change drops it unless a new one is sent.
              ...(c.sectionChanged && c.dieInstanceId === undefined ? { dieInstanceId: null } : {}),
              cutLengthMm: c.cutLengthMm,
              finish: blank(c.finish),
              note: blank(c.note),
              serverSeq: seq,
            })
            .where(
              and(
                eq(salesOrderLine.id, c.id),
                eq(salesOrderLine.companyId, ctx.companyId),
                eq(salesOrderLine.salesOrderId, order.id),
                c.sectionChanged ? sql`not ${lineHasLinks(ctx.companyId, sql`${salesOrderLine.id}`)}` : undefined,
                // Write-time half of the released-plan rule (I-4): a release landing first fails the edit.
                e.figuresChanged ? sql`not ${onReleasedPlan(ctx.companyId, sql`${salesOrderLine.id}`)}` : undefined,
              ),
            ),
        );
      }
      // A removal or section change refused at write time (a bundle got linked meanwhile) fails the
      // whole edit instead of half-applying it.
      for (const part of chunk(removals.map((r) => r.id), 80)) {
        statements.push(
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`not exists (select 1 from sales_order_line l where l.company_id = ${ctx.companyId} and l.id in (${sql.join(part.map((id) => sql`${id}`), sql`, `)}))`,
          ),
        );
      }
      // Every changed line must carry this edit's seq afterwards: counting them (not "none without
      // it") also fails the edit when a concurrent edit removed one of the lines.
      for (const part of chunk(changes.map((c) => c.id), 80)) {
        statements.push(
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`(select count(*) from sales_order_line l where l.company_id = ${ctx.companyId} and l.sales_order_id = ${order.id} and l.id in (${sql.join(part.map((id) => sql`${id}`), sql`, `)}) and l.server_seq = ${seq}) = ${part.length}`,
          ),
        );
      }
      if (poCheck) statements.push(poRepeatGuard(ctx.db, ctx.companyId, { customerId: nextCustomer, poNumber: nextPo }));
      const firstNew = lineSeq - additions.length + 1;
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(salesOrderLine).values(rows),
        additions.map((l, i) =>
          lineRow(l, resolvedAdds[i]!, {
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            salesOrderId: order.id,
            lineNo: firstNew + i,
            createdBy: userId,
          }),
        ),
      );
      statements.push(
        auditInsert(ctx, {
          action: "order.update",
          subjectType: "sales_order",
          subjectId: order.id,
          meta: {
            number: order.number,
            ...(customerChanged ? { customerId: { from: order.customerId, to: input.customerId } } : {}),
            ...(input.lines
              ? {
                  linesRemoved: removals.map((r) => r.lineNo),
                  linesChanged: changes.length,
                  linesAdded: additions.length,
                  // Ordered kg changes line by line (raising a line's kg lets more leave without an
                  // override, ruling PL8-R15), so the order history shows who changed what.
                  kgChanged: changes.flatMap((c, ci) => {
                    const cur = byId.get(c.id)!;
                    const toG = edits[ci]!.resolved.kgG;
                    return cur.kgG === toG ? [] : [{ lineNo: cur.lineNo, fromG: cur.kgG, toG }];
                  }),
                }
              : {}),
          },
        }),
      );
      // A re-based W1 line is a weight refresh like `orders.repriceWeight` (FP-OP-04 audit).
      for (const [ci, c] of changes.entries()) {
        const e = edits[ci]!;
        if (!e.rebased) continue;
        const cur = byId.get(c.id)!;
        statements.push(
          auditInsert(ctx, {
            action: "order.weight.refresh",
            subjectType: "sales_order_line",
            subjectId: c.id,
            meta: {
              orderId: order.id,
              number: order.number,
              lineNo: cur.lineNo,
              via: "order.update",
              from: { basisMilli: cur.kgPer12ftMilli, weightBasis: cur.weightBasis, kgG: cur.kgG, pcs: cur.pcs },
              to: { basisMilli: e.resolved.kgPer12ftMilli, weightBasis: e.resolved.weightBasis ?? null, kgG: e.resolved.kgG, pcs: e.resolved.pcs },
            },
          }),
        );
      }
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line") || /UNIQUE constraint failed: sales_order_line\.sales_order_id/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "This order changed while you were editing it. Reload and try again." });
        }
        throw e;
      }
      const after = await loadOrder(ctx.db, ctx.companyId, order.id);
      return { success: true as const, status: after.status };
    }),

  get: companyProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      const [cust] = await ctx.db
        .select({ name: customer.name, taxId: customer.taxId })
        .from(customer)
        .where(and(eq(customer.id, order.customerId), eq(customer.companyId, ctx.companyId)))
        .limit(1);
      const lines = await lineBalances(ctx.db, ctx.companyId, { orderId: order.id });
      // Rates only for `order.price` holders while the plant shows prices on orders (C23).
      const showRates = canPrice(ctx.role) && (await companyFloor(ctx.db, ctx.companyId)).floor.priceOnSalesOrder;
      const extras = await orderDetailExtras(ctx.db, ctx.companyId, order, { showRates });
      return {
        order: { ...order, customerName: cust?.name ?? "", customerGstin: cust?.taxId ?? null },
        lines,
        totals: sumBalances(lines),
        ...extras,
      };
    }),

  list: companyProcedure
    .input(
      z.object({
        status: z.enum(salesOrderStatuses).optional(),
        /** Booking, confirmed and dispatching only. */
        openOnly: z.boolean().optional(),
        customerId: z.string().min(1).max(64).optional(),
        search: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions: (SQL | undefined)[] = [eq(salesOrder.companyId, ctx.companyId)];
      if (input.status) conditions.push(eq(salesOrder.status, input.status));
      if (input.openOnly) conditions.push(inArray(salesOrder.status, [...openSalesOrderStatuses]));
      if (input.customerId) conditions.push(eq(salesOrder.customerId, input.customerId));
      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(or(like(salesOrder.number, pattern), like(salesOrder.poNumber, pattern), like(customer.name, pattern)));
      }
      const where = and(...conditions);
      const rows = await ctx.db
        .select({
          id: salesOrder.id,
          period: salesOrder.period,
          number: salesOrder.number,
          customerId: salesOrder.customerId,
          customerName: customer.name,
          poNumber: salesOrder.poNumber,
          orderDate: salesOrder.orderDate,
          status: salesOrder.status,
          createdAt: salesOrder.createdAt,
        })
        .from(salesOrder)
        .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, ctx.companyId)))
        .where(where)
        .orderBy(desc(salesOrder.createdAt), desc(sql`length(${salesOrder.number})`), desc(salesOrder.number))
        .limit(input.limit)
        .offset(input.offset);
      const [totalRow] = await ctx.db
        .select({ n: count() })
        .from(salesOrder)
        .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, ctx.companyId)))
        .where(where);

      // Per-order sums in SQL (GROUP BY order), never from a capped list of lines.
      const sums = await orderTotals(ctx.db, ctx.companyId, rows.map((r) => r.id));
      const items = rows.map((r) => {
        const t = sums.get(r.id) ?? sumBalances([]);
        return { ...r, lines: t.lines, orderedG: t.orderedG, producedG: t.producedG, dispatchedG: t.dispatchedG, bakiG: t.bakiG, overG: t.overG };
      });
      const total = totalRow?.n ?? 0;
      const next = input.offset + rows.length;
      return { items, total, nextOffset: next < total ? next : null };
    }),

  /**
   * Order balance (baki) per line — the "Order balance" report (spec P19): ordered, produced,
   * dispatched and remaining kg and pcs, oldest order first. Open orders by default; `includeClosed`
   * adds closed ones. Cancelled orders never appear. Lines come a page at a time (`limit`, `offset`,
   * `nextOffset` null on the last page); `totals` and `total` always cover every matching line.
   */
  balance: companyProcedure
    .input(
      z.object({
        customerId: z.string().min(1).max(64).optional(),
        orderId: z.string().min(1).max(64).optional(),
        includeClosed: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).default(500),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filter = {
        customerId: input.customerId,
        orderId: input.orderId,
        statuses: input.includeClosed ? [...openSalesOrderStatuses, "closed" as const] : openSalesOrderStatuses,
      };
      const [page, totals] = await Promise.all([
        lineBalancePage(ctx.db, ctx.companyId, filter, { limit: input.limit, offset: input.offset }),
        lineTotals(ctx.db, ctx.companyId, filter),
      ]);
      // FP-OP-05: the balance strip per line (planned, pressed, aged, packed, in stock, over, planable).
      const strips = await lineStrips(ctx.db, ctx.companyId, page.lines.map((l) => l.lineId));
      const lines = page.lines.map((l) => ({ ...l, strip: strips.get(l.lineId)! }));
      return { lines, totals, total: totals.lines, nextOffset: page.nextOffset };
    }),

  /**
   * Open lines that still have baki, oldest order first: what Pack suggests for a section and what
   * the office picks from on a dispatch.
   */
  openLines: companyProcedure
    .input(
      z.object({
        dieId: z.string().min(1).max(64).optional(),
        customerId: z.string().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Baki > 0 is part of the SQL, before the limit: old lines that are fully sent but not closed
      // never crowd out the ones that still need bundles.
      const { lines } = await lineBalancePage(
        ctx.db,
        ctx.companyId,
        { customerId: input.customerId, dieIds: input.dieId ? [input.dieId] : undefined, openOnly: true, withBaki: true },
        { limit: 50 },
      );
      return lines;
    }),
});
