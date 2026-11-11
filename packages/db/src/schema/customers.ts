import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** The party's own bundle numbers (FP-PK-07, C25); null = the company serial. */
export const bundleNumberPolicies = ["monthly", "fy", "lifelong"] as const;
export type BundleNumberPolicyColumn = (typeof bundleNumberPolicies)[number];

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
    /** Changing it never renumbers existing bundles. */
    bundleNumberPolicy: text("bundle_number_policy", { enum: bundleNumberPolicies }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("customer_company_name_idx").on(table.companyId, table.name),
    index("customer_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * Other names a customer goes by in old books ("Shree Ram Alu", "SHRI RAM ALUMINIUM"), mirroring
 * `vendor_alias`. `alias_key` is `nameKey()` of the alias (server/lib/purchase.ts): one live key per
 * plant, so a name never points at two customers. Written by `customer.addAliases` (Infinity Portal).
 */
export const customerAlias = sqliteTable(
  "customer_alias",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasKey: text("alias_key").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("customer_alias_company_key_unique").on(table.companyId, table.aliasKey),
    index("customer_alias_customer_idx").on(table.customerId),
  ],
);
