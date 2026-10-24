/**
 * Reallocating bundles between sales order lines, or to plant stock (FP-OP-08/09; ledger D6:
 * `orders.reallocate` is the only transfer, no `bundle.transfer`; C8, C46, C47).
 *
 * - Same customer, or to plant stock: applied at once.
 * - Another customer's bundles: an `order_reallocate` approval opens (subject = the request's
 *   batch id); nothing moves until it is approved. Its applier (below) moves the bundles that are
 *   still `available` and still on the line they were asked from; a rejection moves nothing.
 * - `bundle_transfer` rows are append-only, written only when a move applies. The stock ledger is
 *   never touched (a reallocation moves no kg between places).
 * - The first move keeps the packed-for line (`bundle.packed_sales_order_line_id`), so the packing
 *   list can still print the original order and PO (FP-OP-07).
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { auditLog } from "@orrn/db/schema/audit";
import { bundle } from "@orrn/db/schema/inventory";
import { bundleTransfer } from "@orrn/db/schema/sales";

import type { ApprovalApplier } from "./approvalApply";
import { chunk, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { createId } from "./id";
import { sqlUuid } from "./ledger";

/** Bundle ids already waiting in a pending `order_reallocate` request (of this company). */
export async function bundlesPendingReallocation(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunk([...new Set(bundleIds)], 80)) {
    const rows = await db
      .select({ id: sql<string>`j.value` })
      .from(sql`${approval} a, json_each(a.meta, '$.bundleIds') j`)
      .where(
        sql`a.company_id = ${companyId} and a.kind = 'order_reallocate' and a.status = 'pending' and j.value in (${sql.join(
          part.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** EXISTS-able SQL: the bundle `b` is in a pending reallocation request of the company. */
export function pendingReallocationOf(companyId: string, bundleIdSql: SQL): SQL {
  return sql`exists (select 1 from approval a, json_each(a.meta, '$.bundleIds') j where a.company_id = ${companyId} and a.kind = 'order_reallocate' and a.status = 'pending' and j.value = ${bundleIdSql})`;
}

/**
 * C8 plant stock: no line on the bundle AND its latest transfer went to no line. (A bundle with no
 * line and no transfer is legacy "unassigned".)
 */
export function isPlantStockSql(companyId: string, b: { id: SQL; line: SQL }): SQL {
  return sql`(${b.line} is null and exists (select 1 from bundle_transfer t where t.company_id = ${companyId} and t.bundle_id = ${b.id}) and (select t.to_sales_order_line_id from bundle_transfer t where t.company_id = ${companyId} and t.bundle_id = ${b.id} order by t.server_seq desc, t.created_at desc limit 1) is null)`;
}

/**
 * The customer a plant-stock bundle came from: the customer of the line its latest transfer moved
 * it from (null for legacy stock, or when that transfer came from no line). Review round 1 m-3.
 */
export function plantOriginCustomerSql(companyId: string, bundleIdSql: SQL): SQL {
  return sql`(select o2.customer_id from bundle_transfer t2 join sales_order_line l2 on l2.id = t2.from_sales_order_line_id and l2.company_id = t2.company_id join sales_order o2 on o2.id = l2.sales_order_id and o2.company_id = l2.company_id where t2.company_id = ${companyId} and t2.bundle_id = ${bundleIdSql} and not exists (select 1 from bundle_transfer t3 where t3.company_id = t2.company_id and t3.bundle_id = t2.bundle_id and (t3.server_seq > t2.server_seq or (t3.server_seq = t2.server_seq and t3.created_at > t2.created_at))) limit 1)`;
}

export type TransferRow = {
  bundleId: string;
  fromLineId: string | null;
  lengthMismatch: boolean;
};

/**
 * The statements that move bundles now (same customer / plant stock). One UPDATE per from-line
 * (each only lands while the bundle is still available on that line), the transfer rows, and the
 * caller adds a count check (`batchAbortUnless`) so a bundle that changed meanwhile fails the call.
 */
export function moveStatements(
  db: OrrnDb,
  input: {
    companyId: string;
    seq: number;
    batchId: string;
    toLineId: string | null;
    reason: string;
    reasonCode: string | null;
    userId: string;
    at: Date;
    rows: readonly TransferRow[];
  },
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  const byFrom = new Map<string | null, string[]>();
  for (const r of input.rows) {
    const list = byFrom.get(r.fromLineId) ?? [];
    list.push(r.bundleId);
    byFrom.set(r.fromLineId, list);
  }
  for (const [from, ids] of byFrom) {
    for (const part of chunk(ids, 80)) {
      out.push(
        db
          .update(bundle)
          .set({
            // The first move remembers the line the bundle was packed for (FP-OP-07).
            packedSalesOrderLineId: sql`coalesce(${bundle.packedSalesOrderLineId}, ${bundle.salesOrderLineId})`,
            salesOrderLineId: input.toLineId,
            serverSeq: input.seq,
          })
          .where(
            and(
              eq(bundle.companyId, input.companyId),
              inArray(bundle.id, part),
              eq(bundle.status, "available"),
              from === null ? sql`${bundle.salesOrderLineId} is null` : eq(bundle.salesOrderLineId, from),
            ),
          ),
      );
    }
  }
  // ~13 bound values per row: 7 rows per statement stays under D1's 100.
  for (const part of chunk([...input.rows], 7)) {
    out.push(
      db.insert(bundleTransfer).values(
        part.map((r) => ({
          id: createId(),
          companyId: input.companyId,
          serverSeq: input.seq,
          bundleId: r.bundleId,
          fromSalesOrderLineId: r.fromLineId,
          toSalesOrderLineId: input.toLineId,
          batchId: input.batchId,
          reason: input.reason,
          reasonCode: input.reasonCode,
          lengthMismatch: r.lengthMismatch,
          approvalId: null,
          createdBy: input.userId,
          createdAt: input.at,
        })),
      ),
    );
  }
  return out;
}

/** What an `order_reallocate` request carries (C46: line ids, bundle ids and kg only; no rates). */
export type ReallocateMeta = {
  bundleIds: string[];
  fromLineIds: string[];
  toLineId: string;
  kgG: number;
  reason: string;
  reasonCode: string | null;
  /** Per bundle: the line it was asked from (null = plant / unassigned). */
  items: { bundleId: string; fromLineId: string | null }[];
  lengthMismatchBundleIds: string[];
  /** Every order touched (from and to), for the order timeline. */
  orderIds: string[];
  /** The `die_owner_override` the requester named (C47), re-checked when the request is decided. */
  dieOwnerApprovalId?: string | null;
};

/**
 * `order_reallocate` decision (cross-customer move). Approved: each bundle still `available` and
 * still on the line it was asked from moves to the target line (if that order is still open); a
 * transfer row records it with this approval. Rejected: nothing moves. Both write an
 * `order.reallocate` audit row naming the orders, so the order timelines show the outcome. Every
 * statement is scoped to the company and guarded by "this decision landed".
 */
export const reallocateDecision: ApprovalApplier = (ctx, row, decision) => {
  const { db, companyId, seq } = ctx;
  const landed = sql`exists (select 1 from approval a where a.id = ${row.id} and a.company_id = ${companyId} and a.server_seq = ${seq} and a.status = ${decision})`;
  const meta = sql`(select a.meta from approval a where a.id = ${row.id} and a.company_id = ${companyId})`;
  const toLine = sql`json_extract(${meta}, '$.toLineId')`;
  const B = (c: string) => sql`${sql.identifier("bundle")}.${sql.identifier(c)}`;
  /** The die's owner (copy owner, else section owner) and the target line's customer. */
  const owner = sql`coalesce((select di.owner_customer_id from die_instance di where di.id = ${B("die_instance_id")} and di.company_id = ${companyId}), (select dd.owner_customer_id from die dd where dd.id = ${B("die_id")} and dd.company_id = ${companyId}))`;
  const targetCustomer = sql`(select o.customer_id from sales_order o where o.id = l.sales_order_id and o.company_id = ${companyId})`;
  const statements: SqliteBatchItem[] = [];
  if (decision === "approved") {
    // Keys follow bundle_transfer's column order (insert-select rule).
    statements.push(
      db.insert(bundleTransfer).select(
        db
          .select({
            id: sqlUuid.as("id"),
            companyId: sql<string>`${companyId}`.as("company_id"),
            serverSeq: sql<number>`${seq}`.as("server_seq"),
            bundleId: sql<string>`${B("id")}`.as("bundle_id"),
            fromSalesOrderLineId: sql<string | null>`${B("sales_order_line_id")}`.as("from_sales_order_line_id"),
            toSalesOrderLineId: sql<string>`l.id`.as("to_sales_order_line_id"),
            batchId: sql<string>`${row.subjectId}`.as("batch_id"),
            reason: sql<string>`coalesce(json_extract(${meta}, '$.reason'), '')`.as("reason"),
            reasonCode: sql<string | null>`json_extract(${meta}, '$.reasonCode')`.as("reason_code"),
            lengthMismatch: sql<number>`case when ${B("length_mm")} <> l.cut_length_mm then 1 else 0 end`.as("length_mismatch"),
            approvalId: sql<string>`${row.id}`.as("approval_id"),
            createdBy: sql<string | null>`${ctx.userId}`.as("created_by"),
            createdAt: sql<number>`${ctx.decidedAt.getTime()}`.as("created_at"),
          })
          .from(bundle)
          .innerJoin(sql`json_each(${meta}, '$.items') j`, sql`json_extract(j.value, '$.bundleId') = ${B("id")}`)
          .innerJoin(
            sql`sales_order_line l`,
            sql`l.id = ${toLine} and l.company_id = ${companyId} and l.die_id = ${B("die_id")} and exists (select 1 from sales_order o where o.id = l.sales_order_id and o.company_id = ${companyId} and o.status in ('booking', 'confirmed', 'dispatching'))`,
          )
          .where(
            and(
              eq(bundle.companyId, companyId),
              eq(bundle.status, "available"),
              sql`coalesce(${B("sales_order_line_id")}, '') = coalesce(json_extract(j.value, '$.fromLineId'), '')`,
              // Review round 1 m-2: the owner gate runs again at the decision. An owned die's bundle
              // moves only to its owner, or under a live (not closed) die_owner_override for the target
              // customer (the one the requester named, when named).
              sql`(${owner} is null or ${owner} = ${targetCustomer} or exists (select 1 from approval g where g.company_id = ${companyId} and g.kind = 'die_owner_override' and g.status = 'approved' and g.subject_id = ${B("die_instance_id")} and json_extract(g.meta, '$.attemptedCustomerId') = ${targetCustomer} and json_extract(g.meta, '$.closedAt') is null and (json_extract(${meta}, '$.dieOwnerApprovalId') is null or g.id = json_extract(${meta}, '$.dieOwnerApprovalId'))))`,
              landed,
            ),
          ),
      ),
      db
        .update(bundle)
        .set({
          packedSalesOrderLineId: sql`coalesce(${bundle.packedSalesOrderLineId}, ${bundle.salesOrderLineId})`,
          salesOrderLineId: sql`(select t.to_sales_order_line_id from bundle_transfer t where t.company_id = ${companyId} and t.approval_id = ${row.id} and t.bundle_id = ${B("id")} and t.server_seq = ${seq})`,
          serverSeq: seq,
        })
        .where(
          and(
            eq(bundle.companyId, companyId),
            sql`exists (select 1 from bundle_transfer t where t.company_id = ${companyId} and t.approval_id = ${row.id} and t.bundle_id = ${B("id")} and t.server_seq = ${seq})`,
          ),
        ),
    );
  }
  // Keys follow audit_log's column order (insert-select rule).
  statements.push(
    db.insert(auditLog).select(
      db
        .select({
          id: sql<string>`${createId()}`.as("id"),
          companyId: sql<string>`${companyId}`.as("company_id"),
          actorId: sql<string | null>`${ctx.userId}`.as("actor_id"),
          impersonatorId: sql<string | null>`null`.as("impersonator_id"),
          action: sql<string>`'order.reallocate'`.as("action"),
          subjectType: sql<string>`'bundle_transfer'`.as("subject_type"),
          subjectId: sql<string>`${row.subjectId}`.as("subject_id"),
          meta: sql<string>`json_object('status', ${decision === "approved" ? "applied" : "rejected"}, 'approvalId', ${row.id}, 'batchId', ${row.subjectId}, 'toLineId', ${toLine}, 'orderIds', json(coalesce(json_extract(${meta}, '$.orderIds'), '[]')), 'moved', (select count(*) from bundle_transfer t where t.company_id = ${companyId} and t.approval_id = ${row.id}), 'asked', json_array_length(${meta}, '$.bundleIds'))`.as(
            "meta",
          ),
          at: sql<number>`${ctx.decidedAt.getTime()}`.as("at"),
        })
        .from(approval)
        .where(and(eq(approval.id, row.id), eq(approval.companyId, companyId), landed))
        .limit(1),
    ),
  );
  return statements;
};
