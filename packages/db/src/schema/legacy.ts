import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Old FCMS bundle id (25-char cuid printed on pre-cutover QR labels) to the bundle that replaced
 * it (spec P20). Lets the resolver accept old labels until the bundle is sold.
 */
export const legacyBundleMap = sqliteTable(
  "legacy_bundle_map",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    legacyId: text("legacy_id").notNull(),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("legacy_bundle_map_company_legacy_unique").on(table.companyId, table.legacyId),
    index("legacy_bundle_map_company_bundle_idx").on(table.companyId, table.bundleId),
  ],
);
