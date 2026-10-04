import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const customer = sqliteTable(
  "customer",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    billingAddress: text("billing_address", { mode: "json" }).$type<Record<string, unknown>>(),
    shippingAddress: text("shipping_address", { mode: "json" }).$type<Record<string, unknown>>(),
    taxId: text("tax_id"),
    notes: text("notes"),
    /**
     * How far past an order line's kg this customer accepts, in basis points (500 = 5 %). Null =
     * the company default (`settings.orderToleranceBp`, else 500). Dispatching beyond it needs a
     * `dispatch_overdraw` approval (Review Focus 5).
     */
    kgToleranceBp: integer("kg_tolerance_bp"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("customer_company_name_idx").on(table.companyId, table.name),
    index("customer_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);
