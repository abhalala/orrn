import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const printStatuses = ["queued", "sent", "success", "failed"] as const;
export const labelTemplateKinds = ["bundle"] as const;

export const labelTemplate = sqliteTable(
  "label_template",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    kind: text("kind", { enum: labelTemplateKinds }).notNull().default("bundle"),
    schema: text("schema", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    variables: text("variables", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    spoolTemplateId: text("spool_template_id"),
    spoolPushedAt: integer("spool_pushed_at", { mode: "timestamp_ms" }),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("label_template_company_name_unique").on(table.companyId, table.name),
    index("label_template_company_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const printerProfile = sqliteTable(
  "printer_profile",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    spoolPrinterId: text("spool_printer_id").notNull(),
    templateId: text("template_id")
      .notNull()
      .references(() => labelTemplate.id, { onDelete: "restrict" }),
    defaultCopies: integer("default_copies").notNull().default(1),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("printer_profile_company_name_unique").on(table.companyId, table.name),
    index("printer_profile_company_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const printLog = sqliteTable(
  "print_log",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id").references(() => bundle.id, { onDelete: "set null" }),
    templateId: text("template_id")
      .notNull()
      .references(() => labelTemplate.id, { onDelete: "restrict" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => printerProfile.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    spoolJobId: text("spool_job_id"),
    status: text("status", { enum: printStatuses }).notNull().default("queued"),
    payloadHash: text("payload_hash"),
    responseText: text("response_text"),
    attempt: integer("attempt").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("print_log_company_created_idx").on(table.companyId, table.createdAt),
    index("print_log_company_spool_job_idx").on(table.companyId, table.spoolJobId),
    index("print_log_company_status_idx").on(table.companyId, table.status),
  ],
);

export type PrintStatus = (typeof printStatuses)[number];
