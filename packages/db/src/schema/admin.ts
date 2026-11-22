import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { dieInstance } from "./dies";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * XE parity lane ADM (migration 0057). Plant masters: departments, designations, modes of packing and
 * die categories (rows 75, 76, 57), bank accounts (20), tooling items and their receive inspections
 * (58, 59), die copy cost and inspection state (59, 60) and the document register (80). Transit
 * insurance (21), tooling minimum counts (62), number formats (77) and approver rules (78) live in
 * `company.settings`.
 */

export const plantMasterKinds = ["department", "designation", "packing_mode", "die_category"] as const;
export type PlantMasterKindDb = (typeof plantMasterKinds)[number];

/**
 * One simple per-plant list per `kind`. Never deleted, only retired (`active` false), so a person, an
 * order line or a die that names one keeps its name. `expected_life_g` is used by `die_category` only.
 */
export const plantMaster = sqliteTable(
  "plant_master",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: plantMasterKinds }).notNull(),
    name: text("name").notNull(),
    /** Die category only: the kg a copy of this category is expected to make, in grams. */
    expectedLifeG: integer("expected_life_g"),
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
    index("plant_master_company_kind_idx").on(table.companyId, table.kind, table.sortOrder),
    // Two live entries of one kind with the same name read as one choice; the index is the race guard.
    uniqueIndex("plant_master_live_name_unique")
      .on(table.companyId, table.kind, sql`lower(trim(${table.name}))`)
      .where(sql`${table.active} = 1`),
  ],
);

/**
 * The plant's bank accounts (row 20). Several per plant, at most one live default (partial unique
 * index), which the proforma and the invoice print (`getPlantBankForPrint`).
 */
export const plantBankAccount = sqliteTable(
  "plant_bank_account",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    bankName: text("bank_name").notNull(),
    branch: text("branch"),
    accountName: text("account_name").notNull(),
    accountNo: text("account_no").notNull(),
    ifsc: text("ifsc").notNull(),
    /** Free text such as "Current account" or "CC limit". */
    note: text("note"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("plant_bank_account_company_idx").on(table.companyId, table.active),
    uniqueIndex("plant_bank_account_one_default").on(table.companyId).where(sql`${table.isDefault} = 1 and ${table.active} = 1`),
  ],
);

export const toolingTypes = ["bolster", "backer", "die_ring", "container", "liner", "other"] as const;
export const toolingStatuses = ["awaiting_inspection", "in_store", "in_use", "at_maker", "failed", "retired"] as const;

/** Tooling items (row 58): bolsters, backers, die rings, containers, liners. One row per physical piece. */
export const toolingItem = sqliteTable(
  "tooling_item",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    type: text("type", { enum: toolingTypes }).notNull(),
    /** The plant's own mark on the piece (`B-12`). Unique per plant among pieces not retired. */
    code: text("code").notNull(),
    /** Free text size (`250 x 120`, `7 inch`). */
    size: text("size"),
    /** Where it is kept (rack, press), free text. */
    location: text("location"),
    status: text("status", { enum: toolingStatuses }).notNull().default("awaiting_inspection"),
    makerName: text("maker_name"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tooling_item_company_type_status_idx").on(table.companyId, table.type, table.status),
    uniqueIndex("tooling_item_live_code_unique")
      .on(table.companyId, sql`lower(trim(${table.code}))`)
      .where(sql`${table.status} != 'retired'`),
  ],
);

export const inspectionSubjects = ["die_copy", "tooling"] as const;
export const inspectionResults = ["pass", "fail"] as const;

/**
 * Receive inspections (row 59): when a die copy or a tooling item comes from the maker. Rows are
 * never changed; the latest one per subject is the state (`die_copy_extra.inspection` for a copy, the
 * item's status for tooling).
 */
export const toolInspection = sqliteTable(
  "tool_inspection",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    subjectType: text("subject_type", { enum: inspectionSubjects }).notNull(),
    /** The die copy id or the tooling item id (checked in code, not a foreign key). */
    subjectId: text("subject_id").notNull(),
    result: text("result", { enum: inspectionResults }).notNull(),
    notes: text("notes"),
    inspectedBy: text("inspected_by").references(() => user.id, { onDelete: "set null" }),
    inspectedAt: integer("inspected_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("tool_inspection_company_subject_idx").on(table.companyId, table.subjectType, table.subjectId, table.inspectedAt)],
);

/**
 * Per-copy extras kept off `die_instance` (rows 59, 60): the purchase cost (money, so it never rides
 * on the copy rows that every role reads) and the latest receive inspection, which the die issue
 * reads in its own INSERT (a failed copy cannot be issued).
 */
export const dieCopyExtra = sqliteTable(
  "die_copy_extra",
  {
    dieInstanceId: text("die_instance_id")
      .primaryKey()
      .references(() => dieInstance.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Purchase cost of the copy in paise. */
    costPaise: integer("cost_paise"),
    /** Latest receive inspection: 'pass', 'fail' or null (none recorded). */
    inspection: text("inspection", { enum: inspectionResults }),
    inspectionId: text("inspection_id"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("die_copy_extra_company_idx").on(table.companyId)],
);

export const plantDocumentKinds = ["procedure", "customer_spec", "drawing", "certificate", "other"] as const;

/**
 * Document register (row 80): ISO procedures, customer specs, drawings. The file goes through the die
 * file path (signed PUT into the `DIE_FILES` bucket under `{companyId}/dies/_docs/{fileId}`); a stage
 * without R2 keeps the row with no file, as die files do.
 */
export const plantDocument = sqliteTable(
  "plant_document",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    title: text("title").notNull(),
    kind: text("kind", { enum: plantDocumentKinds }).notNull(),
    version: text("version"),
    /** Plant calendar day `YYYY-MM-DD` when the document is next due for review. */
    reviewOn: text("review_on"),
    notes: text("notes"),
    r2Key: text("r2_key"),
    filename: text("filename"),
    bytes: integer("bytes"),
    contentType: text("content_type"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("plant_document_company_idx").on(table.companyId, table.active, table.reviewOn),
    index("plant_document_r2_key_idx").on(table.r2Key),
  ],
);
