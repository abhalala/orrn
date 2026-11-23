import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { vendor } from "./purchase";
import { storeItem } from "./store";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * XE store (rows 69, 70): buying store items. A department raises an indent (what it needs and by when),
 * a manager approves or rejects it, and an approved indent becomes a purchase order to a vendor. GRNs
 * (`store_txn` kind grn, `po_line_id`) receive against the order's lines. Quantities are milli-units of
 * the item's unit, money is integer paise, GST is basis points (1800 = 18 %).
 */
export const storeIndentStatuses = ["open", "approved", "rejected", "ordered", "cancelled"] as const;
export type StoreIndentStatus = (typeof storeIndentStatuses)[number];

export const storeIndent = sqliteTable(
  "store_indent",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `IND-{n}` per financial year (`doc_series` type `indent`). */
    number: text("number").notNull(),
    period: text("period").notNull(),
    /** Who is asking: free text ("Foundry", "Die room", "Maintenance"). */
    department: text("department").notNull(),
    /** Plant day `YYYY-MM-DD` the items are needed by; NULL = no date. */
    neededBy: text("needed_by"),
    reason: text("reason"),
    status: text("status", { enum: storeIndentStatuses }).notNull().default("open"),
    /** `reorder` when Today's "make indent" raised it for an item below its minimum. */
    source: text("source"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    decisionNote: text("decision_note"),
    /** Set when status = ordered: the purchase order made from it. */
    poId: text("po_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("store_indent_company_number_unique").on(table.companyId, table.period, table.number),
    index("store_indent_company_status_idx").on(table.companyId, table.status, table.createdAt),
  ],
);

export const storeIndentLine = sqliteTable(
  "store_indent_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    indentId: text("indent_id")
      .notNull()
      .references(() => storeIndent.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => storeItem.id, { onDelete: "restrict" }),
    qtyMilli: integer("qty_milli").notNull(),
  },
  (table) => [
    uniqueIndex("store_indent_line_unique").on(table.indentId, table.line),
    index("store_indent_line_company_item_idx").on(table.companyId, table.itemId),
  ],
);

export const storePoStatuses = ["draft", "issued", "part_received", "closed", "cancelled"] as const;
export type StorePoStatus = (typeof storePoStatuses)[number];

export const storePo = sqliteTable(
  "store_po",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `PO-{n}` per financial year (`doc_series` type `store_po`), taken when the order is made. */
    number: text("number").notNull(),
    period: text("period").notNull(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id, { onDelete: "restrict" }),
    status: text("status", { enum: storePoStatuses }).notNull().default("draft"),
    /** Plant day `YYYY-MM-DD` the vendor should deliver by; NULL = not given. */
    deliveryDate: text("delivery_date"),
    /** Payment, freight and other terms printed on the order. */
    terms: text("terms"),
    note: text("note"),
    /** The indent this order was made from, if any. */
    indentId: text("indent_id"),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }),
    /** Closed by hand while part received (short close); full receipt closes it with no person. */
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    closeNote: text("close_note"),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("store_po_company_number_unique").on(table.companyId, table.period, table.number),
    index("store_po_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("store_po_company_vendor_idx").on(table.companyId, table.vendorId),
  ],
);

export const storePoLine = sqliteTable(
  "store_po_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    poId: text("po_id")
      .notNull()
      .references(() => storePo.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => storeItem.id, { onDelete: "restrict" }),
    qtyMilli: integer("qty_milli").notNull(),
    /** Paise per unit of the item's unit, before GST. */
    ratePaise: integer("rate_paise").notNull(),
    /** GST in basis points (1800 = 18 %). */
    gstBp: integer("gst_bp").notNull().default(0),
  },
  (table) => [
    uniqueIndex("store_po_line_unique").on(table.poId, table.line),
    index("store_po_line_company_item_idx").on(table.companyId, table.itemId),
  ],
);

export type StoreIndentRow = typeof storeIndent.$inferSelect;
export type StoreIndentLineRow = typeof storeIndentLine.$inferSelect;
export type StorePoRow = typeof storePo.$inferSelect;
export type StorePoLineRow = typeof storePoLine.$inferSelect;
