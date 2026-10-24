import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const docTypes = [
  "bundle",
  "cast",
  "pl",
  "lot",
  "mrs",
  "grn",
  "so",
  "press_run",
  "dc_note",
  "count",
  // Wave 1 (FP): press plans PP-, ageing batches AG-, die maker jobs DM-, test certificates
  // TC/{FY}/{seq}, and the party bundle series (scope = customer id, FP-PK-07).
  "press_plan",
  "ageing",
  "die_maker_job",
  "cert",
  "party_bundle",
] as const;
export type DocType = (typeof docTypes)[number];

/**
 * Document number counters (spec P7): one row per (company, doc_type, period). `period` is the
 * IST month `2026-09` for bundle/cast and the financial year `2026-27` for everything else.
 * `value` is the last sequence handed out; it only ever goes up (no reuse). Allocated with one
 * atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` by `nextDocNumber`.
 * Separate from `company_sequence`, which is the sync cursor (`server_seq`).
 */
export const docSeries = sqliteTable(
  "doc_series",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    docType: text("doc_type", { enum: docTypes }).notNull(),
    period: text("period").notNull(),
    /**
     * Sub-series key inside (company, doc_type, period): '' for company-wide series; the customer
     * id for `party_bundle` (FP-PK-07). Part of the unique key since 0023.
     */
    scope: text("scope").notNull().default(""),
    value: integer("value").notNull().default(0),
    /** Whoever first used this series in this period. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("doc_series_company_type_period_scope_unique").on(table.companyId, table.docType, table.period, table.scope),
  ],
);

export type DocSeriesRow = typeof docSeries.$inferSelect;
