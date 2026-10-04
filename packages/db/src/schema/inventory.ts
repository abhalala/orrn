import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;

/** How the bundle's number was made: plant monthly series (26I4086) or the BG-000001-B001 style. */
export const bundleNumberStyles = ["plant", "legacy"] as const;
export type BundleNumberStyle = (typeof bundleNumberStyles)[number];

export const bundleGroup = sqliteTable(
  "bundle_group",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    unit: text("unit").notNull(),
    purchaseOrderRef: text("purchase_order_ref"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("bundle_group_company_code_unique").on(table.companyId, table.code),
    index("bundle_group_company_die_idx").on(table.companyId, table.dieId),
    index("bundle_group_company_server_seq_idx").on(table.companyId, table.serverSeq),
    index("bundle_group_company_created_idx").on(table.companyId, table.createdAt),
  ],
);

export const bundle = sqliteTable(
  "bundle",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    groupId: text("group_id")
      .notNull()
      .references(() => bundleGroup.id, { onDelete: "restrict" }),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    serial: text("serial").notNull(),
    poNumber: text("po_number"),
    quantity: integer("quantity").notNull(),
    weightG: integer("weight_g").notNull(),
    lengthMm: integer("length_mm").notNull(),
    status: text("status", { enum: bundleStatuses }).notNull().default("available"),
    currentDispatchId: text("current_dispatch_id"),
    /** Where the bundle sits (spec P6). Required for new bundles once the company has yard locations. */
    locationId: text("location_id").references(() => location.id, { onDelete: "restrict" }),
    // The next three point at tables later plant stages add (die_instance, cast, sales_order_line).
    // SQLite cannot add a foreign key to an existing column, so these stay app-enforced.
    dieInstanceId: text("die_instance_id"),
    castId: text("cast_id"),
    salesOrderLineId: text("sales_order_line_id"),
    /** kg per 12 ft piece × 1000 (i.e. grams per 12 ft), computed with `kgPer12ft` at pack time. */
    kgPer12ftMilli: integer("kg_per_12ft_milli"),
    numberStyle: text("number_style", { enum: bundleNumberStyles }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("bundle_company_serial_unique").on(table.companyId, table.serial),
    index("bundle_company_status_idx").on(table.companyId, table.status),
    index("bundle_company_die_idx").on(table.companyId, table.dieId),
    index("bundle_company_server_seq_idx").on(table.companyId, table.serverSeq),
    index("bundle_company_group_idx").on(table.companyId, table.groupId),
    index("bundle_company_status_die_idx").on(table.companyId, table.status, table.dieId),
    index("bundle_company_dispatch_idx").on(table.companyId, table.currentDispatchId),
    index("bundle_company_location_status_idx").on(table.companyId, table.locationId, table.status),
    // Packed-kg trends and stock ageing by pack time (PL-A1, ruling RP13).
    index("bundle_company_created_idx").on(table.companyId, table.createdAt),
    // Produced kg per sales order line (PL-8 baki).
    index("bundle_company_so_line_idx").on(table.companyId, table.salesOrderLineId),
  ],
);

export const bundleStatusEvent = sqliteTable(
  "bundle_status_event",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: bundleStatuses }),
    toStatus: text("to_status", { enum: bundleStatuses }).notNull(),
    reason: text("reason"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    dispatchId: text("dispatch_id"),
    at: integer("at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("bundle_status_event_company_bundle_idx").on(table.companyId, table.bundleId, table.at)],
);

export type BundleStatus = (typeof bundleStatuses)[number];
