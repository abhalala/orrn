import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { dispatch } from "./dispatch";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const packingList = sqliteTable(
  "packing_list",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatch.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("packing_list_dispatch_unique").on(table.dispatchId),
    uniqueIndex("packing_list_company_code_unique").on(table.companyId, table.code),
    index("packing_list_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const packingListLine = sqliteTable(
  "packing_list_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    packingListId: text("packing_list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "restrict" }),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    weightG: integer("weight_g").notNull(),
    lengthMm: integer("length_mm").notNull(),
    groupLabel: text("group_label").notNull(),
  },
  (table) => [index("packing_list_line_company_list_idx").on(table.companyId, table.packingListId)],
);
