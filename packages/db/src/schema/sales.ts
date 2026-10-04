import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
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

export const salesOrder = sqliteTable(
  "sales_order",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `SO-{n}` per financial year from `doc_series` (never client-side). */
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
    /** Highest line number ever issued on this order, so a removed line's number is never reused. */
    lineSeq: integer("line_seq").notNull().default(0),
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
    uniqueIndex("sales_order_company_number_unique").on(table.companyId, table.number),
    index("sales_order_company_customer_status_idx").on(table.companyId, table.customerId, table.status),
    index("sales_order_company_status_date_idx").on(table.companyId, table.status, table.orderDate),
    index("sales_order_company_server_seq_idx").on(table.companyId, table.serverSeq),
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

export type SalesOrderRow = typeof salesOrder.$inferSelect;
export type SalesOrderLineRow = typeof salesOrderLine.$inferSelect;
