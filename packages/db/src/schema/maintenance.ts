import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { pressDowntime } from "./press";
import { storeTxn } from "./store";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Plant maintenance (XE parity lane MAINT, migration 0060, module `maintenance`). Rules live in
 * `@orrn/domain` (`maintenance.ts`); the router is `routers/maintenance.ts` (mounted as `maint`).
 *
 * - `maint_asset` (#63): the asset register. Presses, furnaces and ovens already exist as masters; an
 *   asset points at one of them optionally (`link_kind` + `link_id`, at most one asset per master),
 *   which is where its run hours come from. Compressors, cranes, DG sets and the rest are assets only.
 * - `maint_plan` (#64): preventive plans per asset, by calendar days, run hours or both. `base_at` is
 *   when the plan last reset (the last preventive work order done, else the day it began).
 * - `maint_work_order` (#65): breakdown or preventive; `MWO-{n}` per financial year. One work order per
 *   downtime entry, per out-of-limit reading, and one live preventive work order per plan (partial
 *   unique indexes, so a second tap returns the first).
 * - `maint_wo_spare` (#66): links a store issue (MRS, purpose `maintenance`) to a work order. The store
 *   keeps the entry; this table only says which work order used it. One work order per entry.
 * - `maint_reading_kind` / `maint_reading` (#68): what is read on an asset (name and unit as the plant
 *   types them), its limits, and the readings, flagged low or high against the limit at the time.
 * - `maint_setting` (#67): the labour rate per hour for the cost report (one row per plant).
 */

export const maintAssetKinds = ["press", "furnace", "oven", "compressor", "crane", "dg_set", "other"] as const;
export const maintLinkKinds = ["press", "furnace", "oven"] as const;
export const maintCriticalities = ["A", "B", "C"] as const;
export const maintAssetStatuses = ["running", "standby", "under_repair", "retired"] as const;
export const maintWoKinds = ["breakdown", "preventive", "condition"] as const;
export const maintWoStatuses = ["open", "in_progress", "waiting_spares", "done", "cancelled"] as const;
export const maintWoSources = ["manual", "downtime", "plan", "reading"] as const;
export const maintPriorities = ["high", "medium", "low"] as const;
export const maintReadingFlags = ["ok", "low", "high"] as const;
/** `device` is reserved for the collector input (built, not live: no route writes it yet). */
export const maintReadingSources = ["hand", "device"] as const;

export const maintAsset = sqliteTable(
  "maint_asset",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: maintAssetKinds }).notNull(),
    /** The press line, furnace or ageing oven this asset is (opaque id, checked in code; not a foreign key). */
    linkKind: text("link_kind", { enum: maintLinkKinds }),
    linkId: text("link_id"),
    make: text("make"),
    serialNo: text("serial_no"),
    /** Company days `YYYY-MM-DD`. */
    purchasedOn: text("purchased_on"),
    warrantyUntil: text("warranty_until"),
    location: text("location"),
    criticality: text("criticality", { enum: maintCriticalities }).notNull().default("B"),
    status: text("status", { enum: maintAssetStatuses }).notNull().default("running"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("maint_asset_company_code_unique").on(table.companyId, sql`lower(${table.code})`),
    uniqueIndex("maint_asset_company_link_unique")
      .on(table.companyId, table.linkKind, table.linkId)
      .where(sql`${table.linkId} IS NOT NULL`),
    index("maint_asset_company_kind_idx").on(table.companyId, table.kind),
  ],
);

export const maintPlan = sqliteTable(
  "maint_plan",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    assetId: text("asset_id")
      .notNull()
      .references(() => maintAsset.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** What to do, as the fitter reads it. */
    steps: text("steps"),
    intervalDays: integer("interval_days"),
    intervalHours: integer("interval_hours"),
    /** When the plan last reset: the last preventive work order done, else the day it began. */
    baseAt: integer("base_at", { mode: "timestamp_ms" }).notNull(),
    /** The preventive work order whose finish set `base_at` (null until one is done). */
    lastWorkOrderId: text("last_work_order_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("maint_plan_company_asset_idx").on(table.companyId, table.assetId)],
);

export const maintWorkOrder = sqliteTable(
  "maint_work_order",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => maintAsset.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: maintWoKinds }).notNull(),
    source: text("source", { enum: maintWoSources }).notNull().default("manual"),
    planId: text("plan_id").references(() => maintPlan.id, { onDelete: "set null" }),
    downtimeId: text("downtime_id").references(() => pressDowntime.id, { onDelete: "set null" }),
    /** The out-of-limit reading that raised it (opaque id; the reading points back with `work_order_id`). */
    readingId: text("reading_id"),
    priority: text("priority", { enum: maintPriorities }).notNull(),
    status: text("status", { enum: maintWoStatuses }).notNull().default("open"),
    /** What is wrong, or what the plan asks for. */
    title: text("title").notNull(),
    assignedTo: text("assigned_to").references(() => user.id, { onDelete: "set null" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    cause: text("cause"),
    workDone: text("work_done"),
    /** Labour in minutes (people times time), for the cost report. */
    labourMin: integer("labour_min").notNull().default(0),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("maint_wo_company_number_unique").on(table.companyId, table.period, table.number),
    uniqueIndex("maint_wo_company_downtime_unique")
      .on(table.companyId, table.downtimeId)
      .where(sql`${table.downtimeId} IS NOT NULL AND ${table.status} <> 'cancelled'`),
    uniqueIndex("maint_wo_company_reading_unique")
      .on(table.companyId, table.readingId)
      .where(sql`${table.readingId} IS NOT NULL AND ${table.status} <> 'cancelled'`),
    // One live preventive work order per plan.
    uniqueIndex("maint_wo_company_plan_live_unique")
      .on(table.companyId, table.planId)
      .where(sql`${table.planId} IS NOT NULL AND ${table.status} IN ('open', 'in_progress', 'waiting_spares')`),
    index("maint_wo_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("maint_wo_company_asset_idx").on(table.companyId, table.assetId, table.createdAt),
  ],
);

export const maintWoSpare = sqliteTable(
  "maint_wo_spare",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => maintWorkOrder.id, { onDelete: "cascade" }),
    storeTxnId: text("store_txn_id")
      .notNull()
      .references(() => storeTxn.id, { onDelete: "restrict" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("maint_wo_spare_company_txn_unique").on(table.companyId, table.storeTxnId),
    index("maint_wo_spare_company_wo_idx").on(table.companyId, table.workOrderId),
  ],
);

export const maintReadingKind = sqliteTable(
  "maint_reading_kind",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => maintAsset.id, { onDelete: "cascade" }),
    /** As the plant says it ("Oil temperature"). */
    name: text("name").notNull(),
    /** As the plant writes it ("°C", "bar"); shown beside the value, never translated. */
    unit: text("unit").notNull(),
    /** Thousandths of the unit; null = that side is not checked. */
    minMilli: integer("min_milli"),
    maxMilli: integer("max_milli"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("maint_reading_kind_company_asset_name_unique").on(table.companyId, table.assetId, sql`lower(trim(${table.name}))`)],
);

export const maintReading = sqliteTable(
  "maint_reading",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => maintAsset.id, { onDelete: "cascade" }),
    kindId: text("kind_id")
      .notNull()
      .references(() => maintReadingKind.id, { onDelete: "cascade" }),
    valueMilli: integer("value_milli").notNull(),
    /** The limits as they were when the reading was taken, and the verdict against them. */
    minMilli: integer("min_milli"),
    maxMilli: integer("max_milli"),
    flag: text("flag", { enum: maintReadingFlags }).notNull(),
    source: text("source", { enum: maintReadingSources }).notNull().default("hand"),
    note: text("note"),
    /** The work order made from this reading, if any. */
    workOrderId: text("work_order_id"),
    readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("maint_reading_company_asset_idx").on(table.companyId, table.assetId, table.readAt),
    index("maint_reading_company_flag_idx").on(table.companyId, table.flag, table.readAt),
  ],
);

export const maintSetting = sqliteTable("maint_setting", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  /** Labour rate in paise per hour for the cost report; null = not set (the report shows no labour cost). */
  labourRatePaisePerHour: integer("labour_rate_paise_per_hour"),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
});

export type MaintAssetRow = typeof maintAsset.$inferSelect;
export type MaintPlanRow = typeof maintPlan.$inferSelect;
export type MaintWorkOrderRow = typeof maintWorkOrder.$inferSelect;
export type MaintReadingKindRow = typeof maintReadingKind.$inferSelect;
export type MaintReadingRow = typeof maintReading.$inferSelect;
