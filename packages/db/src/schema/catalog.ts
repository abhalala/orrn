import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const dieStatuses = ["active", "archived"] as const;

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
    dimensions: text("dimensions", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    weightMinG: integer("weight_min_g").notNull(),
    weightMaxG: integer("weight_max_g").notNull(),
    status: text("status", { enum: dieStatuses }).notNull().default("active"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("die_company_series_section_unique").on(table.companyId, table.series, table.sectionCode),
    index("die_company_status_idx").on(table.companyId, table.status),
    index("die_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);
