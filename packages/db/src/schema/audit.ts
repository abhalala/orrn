import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => company.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    impersonatorId: text("impersonator_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    at: integer("at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("audit_company_at_idx").on(table.companyId, table.at),
    index("audit_actor_at_idx").on(table.actorId, table.at),
    index("audit_subject_idx").on(table.companyId, table.subjectType, table.subjectId),
  ],
);
