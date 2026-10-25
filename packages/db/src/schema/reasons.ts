import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * One reason-code master with a kind (C39), never a table per use. Kinds and the seeded defaults
 * live in `@orrn/domain` (`REASON_CODE_KINDS`, `DEFAULT_REASON_CODES`); the column is text so a
 * later kind (`threshold`) needs no migration. Codes are never deleted: retire with `active`.
 */
export const reasonCodeKinds = [
  "downtime",
  "qc_reject",
  "void",
  "reprint",
  "ageing_hold",
  "ageing_rework",
  "ageing_scrap",
  "reallocate",
  "die_work",
  "melt_correct",
  "cast_tail",
] as const;
export type ReasonCodeKindColumn = (typeof reasonCodeKinds)[number];

export const reasonCode = sqliteTable(
  "reason_code",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: reasonCodeKinds }).notNull(),
    /** Stable key (`die_change`, `other`); seeded codes are shown through `t("reasons.{kind}.{code}")`. */
    code: text("code").notNull(),
    /** English label for a plant-added code (seeded rows carry the default English too). */
    label: text("label").notNull(),
    /** Hindi / Gujarati wording a plant typed for this code (null = the built-in translation, else English). */
    labelHi: text("label_hi"),
    labelGu: text("label_gu"),
    /** `other` (and any plant code marked so) needs a note. */
    requiresNote: integer("requires_note", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("reason_code_company_kind_code_unique").on(table.companyId, table.kind, table.code),
    index("reason_code_company_kind_idx").on(table.companyId, table.kind, table.active),
    index("reason_code_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type ReasonCodeRow = typeof reasonCode.$inferSelect;
