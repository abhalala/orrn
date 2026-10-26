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
    // FP-PK-13 (C24): regenerate = a new revision under the same number; the old row stays and is
    // pointed at by `supersedes_id`. The current revision of a code = the highest `revision` whose
    // id no later row supersedes. Combine (packingList.combine) writes one list over several
    // dispatches (`packing_list_dispatch`); each folded list gets `combined_into_id`.
    revision: integer("revision").notNull().default(1),
    supersedesId: text("supersedes_id"),
    combinedIntoId: text("combined_into_id"),
    /** Print choices snapshotted with the revision. */
    showBranding: integer("show_branding", { mode: "boolean" }).notNull().default(true),
    showOriginalSo: integer("show_original_so", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    // Was unique per dispatch until 0023: revisions share the dispatch.
    index("packing_list_dispatch_idx").on(table.dispatchId),
    uniqueIndex("packing_list_company_code_revision_unique").on(table.companyId, table.code, table.revision),
    index("packing_list_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** Every dispatch a (combined) packing list covers; a plain list has one row for its own dispatch. */
export const packingListDispatch = sqliteTable(
  "packing_list_dispatch",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    packingListId: text("packing_list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "cascade" }),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatch.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("packing_list_dispatch_list_dispatch_unique").on(table.packingListId, table.dispatchId),
    index("packing_list_dispatch_company_dispatch_idx").on(table.companyId, table.dispatchId),
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
    // PL v2 row snapshot (FP-PK-13): party number, basis, profile kind, the order codes.
    partyNo: text("party_no"),
    kgPer12ftMilli: integer("kg_per_12ft_milli"),
    profileKind: text("profile_kind"),
    salesOrderCode: text("sales_order_code"),
    /** The order it was packed for, when a transfer has since moved it ("original SO"). */
    packedSalesOrderCode: text("packed_sales_order_code"),
  },
  (table) => [index("packing_list_line_company_list_idx").on(table.companyId, table.packingListId)],
);
