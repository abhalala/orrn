import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { customer } from "./customers";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;

/** Transporter master (FP-PK-11). A vehicle is not a master: number and capacity live on the dispatch. */
export const transporter = sqliteTable(
  "transporter",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    phone: text("phone"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("transporter_company_name_idx").on(table.companyId, table.name),
    index("transporter_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const dispatch = sqliteTable(
  "dispatch",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    status: text("status", { enum: dispatchStatuses }).notNull().default("draft"),
    shipDate: integer("ship_date", { mode: "timestamp_ms" }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    completedBy: text("completed_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    // Dispatch header (spec P12, PL-8). The gate fills vehicle and driver; the office links the Tally
    // invoice (invoice.link). `pl_number` comes from the PL book series at completion, once.
    vehicleNo: text("vehicle_no"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),
    transporter: text("transporter"),
    plNumber: text("pl_number"),
    invoiceNumber: text("invoice_number"),
    /** Tally invoice date, company calendar date `YYYY-MM-DD`. */
    invoiceDate: text("invoice_date"),
    // FP-PK-11/12 (Wave 1): transporter master + its name snapshotted (a rename never rewrites a
    // sent PL; `transporter` above stays the free-text field), vehicle capacity (grams; null = no
    // warning) and the reason given to complete over it.
    transporterId: text("transporter_id").references(() => transporter.id),
    transporterName: text("transporter_name"),
    vehicleCapacityG: integer("vehicle_capacity_g"),
    capacityOverrideReason: text("capacity_override_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("dispatch_company_code_unique").on(table.companyId, table.code),
    index("dispatch_company_status_idx").on(table.companyId, table.status),
    index("dispatch_company_server_seq_idx").on(table.companyId, table.serverSeq),
    // Analytics ranges and buckets by completion time (PL-A1, ruling RP13).
    index("dispatch_company_completed_idx").on(table.companyId, table.completedAt),
    uniqueIndex("dispatch_company_pl_number_unique").on(table.companyId, table.plNumber),
  ],
);

export const dispatchItem = sqliteTable(
  "dispatch_item",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatch.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "restrict" }),
    groupLabel: text("group_label"),
    /**
     * The sales order line this bundle fulfils (spec P13). App-enforced (SQLite cannot add a
     * foreign key to an existing table without rebuilding it); validated by dispatch.linkItem.
     */
    salesOrderLineId: text("sales_order_line_id"),
    /**
     * Set when someone unlinked this item on purpose (`dispatch.linkItem` with null): the user id.
     * Completion and a customer change re-suggest a line only for items left unlinked by nobody
     * (PL-8 fix round 2, spec S-2); linking the item again clears it.
     */
    unlinkedBy: text("unlinked_by"),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("dispatch_item_dispatch_bundle_unique").on(table.dispatchId, table.bundleId),
    index("dispatch_item_company_dispatch_idx").on(table.companyId, table.dispatchId),
    index("dispatch_item_company_so_line_idx").on(table.companyId, table.salesOrderLineId),
  ],
);

export type DispatchStatus = (typeof dispatchStatuses)[number];
