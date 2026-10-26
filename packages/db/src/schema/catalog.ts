import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { customer } from "./customers";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const dieStatuses = ["active", "archived"] as const;

/** Profile shape (integration plan §2): picks the BIS pair (`settings.standards`) and the PL summary row. */
export const dieProfileKinds = ["hollow", "solid", "semi"] as const;
export type DieProfileKind = (typeof dieProfileKinds)[number];

export const die = sqliteTable(
  "die",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    series: text("series").notNull(),
    sectionCode: text("section_code").notNull(),
    name: text("name"),
    // `oblique_mm` was dropped in 0023 (ledger D7): "oblique" is the die-copy suffix, not a
    // dimension. Any stored value was appended to `notes` by that migration.
    legMm: integer("leg_mm"),
    widthMm: integer("width_mm"),
    thicknessMm: integer("thickness_mm"),
    dimensions: text("dimensions", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    weightMinG: integer("weight_min_g").notNull(),
    weightMaxG: integer("weight_max_g").notNull(),
    status: text("status", { enum: dieStatuses }).notNull().default("active"),
    notes: text("notes"),
    // Die room (FP-DR-12/13/14): commercial alloy/temper text (not the foundry `alloy` master, C20),
    // profile kind, the section owner (null = plant-owned; a soft-deleted customer still owns it),
    // default cavities for new copies, the press drawing's R2 key, wall in tenths of a mm.
    alloy: text("alloy"),
    temper: text("temper"),
    profileKind: text("profile_kind", { enum: dieProfileKinds }),
    ownerCustomerId: text("owner_customer_id").references(() => customer.id),
    cavityCount: integer("cavity_count"),
    drawingKey: text("drawing_key"),
    wallTenthMm: integer("wall_tenth_mm"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("die_company_series_section_unique").on(table.companyId, table.series, table.sectionCode),
    index("die_company_status_idx").on(table.companyId, table.status),
    index("die_company_server_seq_idx").on(table.companyId, table.serverSeq),
    index("die_company_owner_idx").on(table.companyId, table.ownerCustomerId),
  ],
);
