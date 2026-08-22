import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { customer } from "./customers";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;

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
    invoiceNo: text("invoice_no"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    completedBy: text("completed_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("dispatch_company_code_unique").on(table.companyId, table.code),
    index("dispatch_company_status_idx").on(table.companyId, table.status),
    index("dispatch_company_server_seq_idx").on(table.companyId, table.serverSeq),
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
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("dispatch_item_dispatch_bundle_unique").on(table.dispatchId, table.bundleId),
    index("dispatch_item_company_dispatch_idx").on(table.companyId, table.dispatchId),
  ],
);

export type DispatchStatus = (typeof dispatchStatuses)[number];
