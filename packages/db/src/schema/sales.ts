import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { dieInstance, dieWeightReading } from "./dies";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Sales order life (spec P13, digest Stage 15): `booking` (taken, not yet firm) → `confirmed` →
 * `dispatching` (set by the first completed dispatch against one of its lines) → `closed` (by the
 * office, with or without baki left). `cancelled` = entered in error, only while nothing has been
 * dispatched against it. `closed` can be reopened to `confirmed`.
 */
export const salesOrderStatuses = ["booking", "confirmed", "dispatching", "closed", "cancelled"] as const;
export type SalesOrderStatus = (typeof salesOrderStatuses)[number];

/** Statuses whose lines still take bundles (pack suggestion, dispatch link, baki report). */
export const openSalesOrderStatuses = ["booking", "confirmed", "dispatching"] as const;

/** `office` or `portal` (C29: portal rows are created in booking only). */
export const salesOrderSources = ["office", "portal"] as const;
/** Line finish (C20: an alloy such as 6061 is never a finish). */
export const salesOrderFinishes = ["none", "anodise", "pvd"] as const;
/** Which side the clerk committed on a line. */
export const salesOrderQtyBases = ["pcs", "kg"] as const;
/** What the line's kg/12ft snapshot was taken from (C21). */
export const salesOrderWeightBases = ["copy_current", "band_start"] as const;

export const salesOrder = sqliteTable(
  "sales_order",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /**
     * The `doc_series` period the number was taken in: the Apr-Mar financial year (`2026-27`). SO
     * numbers restart every FY, so the number is unique only within its period.
     */
    period: text("period").notNull(),
    /** `SO-{n}` per financial year from `doc_series` (never client-side); repeats across FYs. */
    number: text("number").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** The customer's purchase order number; printed on the packing list. */
    poNumber: text("po_number"),
    /** Calendar date on the company wall clock, `YYYY-MM-DD`. */
    orderDate: text("order_date").notNull(),
    status: text("status", { enum: salesOrderStatuses }).notNull().default("booking"),
    note: text("note"),
    // FP-OP-01/07 (Wave 1): expected date (printed, not a plan window), header finish default,
    // source, and who confirmed / closed / cancelled with the reason.
    expectedDate: text("expected_date"),
    finish: text("finish", { enum: salesOrderFinishes }),
    source: text("source", { enum: salesOrderSources }).notNull().default("office"),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "set null" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    /** Required when the order closes with baki left. */
    closeReason: text("close_reason"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    /** Highest line number ever issued on this order, so a removed line's number is never reused. */
    lineSeq: integer("line_seq").notNull().default(0),
    /** Replay key from the client: a retried `orders.create` with the same key returns this order. */
    clientRequestId: text("client_request_id"),
    statusChangedAt: integer("status_changed_at", { mode: "timestamp_ms" }),
    statusChangedBy: text("status_changed_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("sales_order_company_period_number_unique").on(table.companyId, table.period, table.number),
    uniqueIndex("sales_order_company_request_unique").on(table.companyId, table.clientRequestId),
    index("sales_order_company_customer_status_idx").on(table.companyId, table.customerId, table.status),
    index("sales_order_company_status_date_idx").on(table.companyId, table.status, table.orderDate),
    index("sales_order_company_server_seq_idx").on(table.companyId, table.serverSeq),
    // PO repeat check among non-cancelled orders of a customer (enforced at confirm, OP §3).
    index("sales_order_company_customer_po_idx").on(table.companyId, table.customerId, table.poNumber),
  ],
);

/**
 * One line of an order: a section (the `die` row is the section catalogue), cut length, pieces and
 * kg. Baki (balance) = ordered − dispatched, never shown negative (lib/orders.ts). Produced = bundles
 * whose `sales_order_line_id` is this line (set at pack time, and moved to the line a completed
 * dispatch fulfilled). Dispatched = bundles of completed dispatch items linked to this line.
 */
export const salesOrderLine = sqliteTable(
  "sales_order_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    salesOrderId: text("sales_order_id")
      .notNull()
      .references(() => salesOrder.id, { onDelete: "restrict" }),
    /** 1, 2, 3 … within the order; never reused after a line is removed. */
    lineNo: integer("line_no").notNull(),
    /** The section (catalogue row). */
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    /** Target weight per 12 ft piece in grams (= kg/12ft × 1000), when the customer asks for one. */
    kgPer12ftMilli: integer("kg_per_12ft_milli"),
    cutLengthMm: integer("cut_length_mm").notNull(),
    pcs: integer("pcs"),
    kgG: integer("kg_g").notNull(),
    /** none / anodise / pvd / 6061 … (OI-09: recorded and printed only, no job-work flow yet). */
    finish: text("finish"),
    note: text("note"),
    // FP-OP-02/03/04 (Wave 1). Pin a copy OR a tier ("this tier or better"). Weight basis snapshot:
    // `kg_per_12ft_milli` is the locked basis; `band_start_milli` = die.weight_min_g at save,
    // `copy_milli` + `reading_id` = the reading used (null without one), `basis_note` when the line
    // wanted the current weight and fell back. `implied_g` = orderGrams(pcs, length, basis).
    dieInstanceId: text("die_instance_id").references(() => dieInstance.id),
    tierRank: integer("tier_rank"),
    qtyBasis: text("qty_basis", { enum: salesOrderQtyBases }),
    impliedG: integer("implied_g"),
    weightBasis: text("weight_basis", { enum: salesOrderWeightBases }),
    bandStartMilli: integer("band_start_milli"),
    copyMilli: integer("copy_milli"),
    readingId: text("reading_id").references(() => dieWeightReading.id),
    basisNote: text("basis_note"),
    /** Commercial text snapshots from die.alloy / die.temper (overridable; not the foundry alloy, C20). */
    alloy: text("alloy"),
    temper: text("temper"),
    /** Rs per kg in paise; null unless `priceOnSalesOrder` and the writer holds `order.price` (C23). */
    ratePaise: integer("rate_paise"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("sales_order_line_order_no_unique").on(table.salesOrderId, table.lineNo),
    index("sales_order_line_company_order_idx").on(table.companyId, table.salesOrderId),
    index("sales_order_line_company_die_idx").on(table.companyId, table.dieId),
    index("sales_order_line_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * The commercial move of a bundle between sales order lines or to plant stock (FP-OP-08/09,
 * `orders.reallocate`; ledger D6: no `bundle.transfer`). APPEND-ONLY: never updated or deleted; a
 * correction is a transfer the other way. Rows are written only when the move applies: a
 * cross-customer move waits on an `order_reallocate` approval whose meta carries the bundle and
 * line ids, and its applier inserts these rows (`approval_id` set). No stock ledger row.
 * Plant stock = `bundle.sales_order_line_id` null AND the latest transfer's `to` null (C8).
 */
export const bundleTransfer = sqliteTable(
  "bundle_transfer",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id),
    /** Null = it was plant stock or unassigned. */
    fromSalesOrderLineId: text("from_sales_order_line_id").references(() => salesOrderLine.id),
    /** Null = to plant stock. */
    toSalesOrderLineId: text("to_sales_order_line_id").references(() => salesOrderLine.id),
    /** Every bundle moved by one call shares this id. */
    batchId: text("batch_id").notNull(),
    reason: text("reason").notNull(),
    /** Reason code (kind `reallocate`), required when the target line's cut length differs. */
    reasonCode: text("reason_code"),
    /** SQL default: rows are inserted in chunks (see bundle.recut). */
    lengthMismatch: integer("length_mismatch", { mode: "boolean" }).notNull().default(sql`0`),
    /** The `order_reallocate` approval when the move waited on one. */
    approvalId: text("approval_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("bundle_transfer_company_bundle_idx").on(table.companyId, table.bundleId, table.createdAt),
    index("bundle_transfer_company_batch_idx").on(table.companyId, table.batchId),
    index("bundle_transfer_company_to_line_idx").on(table.companyId, table.toSalesOrderLineId),
    index("bundle_transfer_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type SalesOrderRow = typeof salesOrder.$inferSelect;
export type BundleTransferRow = typeof bundleTransfer.$inferSelect;
export type SalesOrderLineRow = typeof salesOrderLine.$inferSelect;
