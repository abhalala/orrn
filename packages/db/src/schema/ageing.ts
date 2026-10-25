import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Ageing (FP-AG, spec `2026-10-24-orrn-fp-ageing-design.md`; W3-AG-C contracts, migration 0038).
 *
 * The oven sits between the press and pack. Cut lengths of a logged press run go onto a painted
 * rack (a trolley); the rack goes into an oven on a cycle recipe for the alloy and temper; the
 * operator records temperatures (typed, a collector, or the dev simulator) and hardness samples;
 * a supervisor releases what passed. Pack draws pieces from released rows (`bundle.ageing_row_id`).
 * A plant that packs first can also age whole bundles (`ageing_row.source = 'bundle'`).
 *
 * Rules (never bent):
 * - No stock-ledger row for load, start, temperature, hardness, release, hold or rework. The oven is
 *   not a stock location; kilograms on a trolley are theoretical (prorated from the press line).
 * - Integers only: temperatures and hardness ×10 (`1850` = 185.0 °C), gas in thousandths of the
 *   meter unit, grams, millimetres, minutes.
 * - The recipe is snapshotted onto the batch at start; a later recipe edit never rewrites a batch.
 *   An active recipe's numbers are not edited in place: publish a new row, archive the old one.
 * - Remaining pieces are computed (`pcs − packed_pcs − scrap_pcs − rework_pcs`), never stored.
 *   Pack (lib/pack.ts) reads these exact column names (`die_id`, `length_mm`, `packed_pcs`, …).
 * - Bulk-inserted columns take SQL defaults (`default(sql\`0\`)`), never JS defaults (D1 100 params).
 * - Statuses are the stored truth; the board phase (heating / soaking) is derived (`ageingBatchPhase`).
 */

// ---------------------------------------------------------------------------
// Masters (FP-AG-01..03): masters.draft saves a draft, masters.publish activates
// ---------------------------------------------------------------------------

export const ageingMasterStatuses = ["draft", "active", "out_of_service"] as const;
export type AgeingMasterStatus = (typeof ageingMasterStatuses)[number];

/** An ageing oven. Capacity is a warning threshold, not a hard block. One batch in it at a time. */
export const ageingOven = sqliteTable(
  "ageing_oven",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Floor name, unique per company, e.g. `OV-1`. */
    code: text("code").notNull(),
    name: text("name"),
    /** Warning threshold in grams (null = no capacity warning). */
    capacityG: integer("capacity_g"),
    /** Highest temperature the oven may be set to, ×10 (null = no limit). A recipe above it is refused at start. */
    maxTempX10: integer("max_temp_x10"),
    /** Display only (`m3`); gas readings are always stored in thousandths of this unit. */
    meterUnit: text("meter_unit").notNull().default("m3"),
    status: text("status", { enum: ageingMasterStatuses }).notNull().default("draft"),
    /** Reserved for the digest Machine table; no foreign key until it exists. */
    machineId: text("machine_id"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ageing_oven_company_code_unique").on(table.companyId, table.code),
    index("ageing_oven_company_status_idx").on(table.companyId, table.status),
    index("ageing_oven_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** The painted rack. Rack and load are different rows: a rack is reused, a batch is not. */
export const trolley = sqliteTable(
  "trolley",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** The number painted on the steel, unique per company, e.g. `T-1`. */
    code: text("code").notNull(),
    capacityG: integer("capacity_g"),
    status: text("status", { enum: ageingMasterStatuses }).notNull().default("draft"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("trolley_company_code_unique").on(table.companyId, table.code),
    index("trolley_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const ageingRecipeKinds = ["full", "top_up"] as const;
export const ageingRecipeStatuses = ["draft", "active", "archived"] as const;
export const hardnessMethods = ["webster", "hb"] as const;
export type AgeingRecipeKind = (typeof ageingRecipeKinds)[number];
export type AgeingRecipeStatus = (typeof ageingRecipeStatuses)[number];
export type HardnessMethod = (typeof hardnessMethods)[number];

/**
 * Cycle recipe per alloy and temper (FP-AG-03). One active row per (alloy, temper, kind).
 * `alloy` uses the same tokens as `cast.alloy` (`6063`); `temper` is commercial text (`T5`, `T6`).
 */
export const ageingRecipe = sqliteTable(
  "ageing_recipe",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    alloy: text("alloy").notNull(),
    temper: text("temper").notNull(),
    kind: text("kind", { enum: ageingRecipeKinds }).notNull().default("full"),
    targetTempX10: integer("target_temp_x10").notNull(),
    /** ± band around the target, ×10 (default 100 = ±10.0 °C). */
    toleranceX10: integer("tolerance_x10").notNull().default(100),
    /** Minutes the load must spend inside the band (time at temperature). */
    soakMin: integer("soak_min").notNull(),
    /** Over-ageing limit: more minutes at temperature than this is over-aged (null = no limit). */
    maxSoakMin: integer("max_soak_min"),
    hardnessMethod: text("hardness_method", { enum: hardnessMethods }).notNull().default("webster"),
    /** A sample below this fails the line. */
    hardnessMinX10: integer("hardness_min_x10").notNull(),
    /** A sample above this warns; it does not fail. */
    hardnessMaxX10: integer("hardness_max_x10"),
    sampleCount: integer("sample_count").notNull().default(3),
    status: text("status", { enum: ageingRecipeStatuses }).notNull().default("draft"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ageing_recipe_active_unique")
      .on(table.companyId, table.alloy, table.temper, table.kind)
      .where(sql`${table.status} = 'active'`),
    index("ageing_recipe_company_status_idx").on(table.companyId, table.status),
    index("ageing_recipe_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Batch (FP-AG-05): one trolley load through one oven cycle
// ---------------------------------------------------------------------------

/**
 * Stored batch status. `loading` → `in_oven` (start) → `out` (take out) → `released` (at least one
 * line passed and may be packed) or `held` (no line may be packed) → `closed` (nothing left on the
 * rack, or rework moved it all). `void` from `loading`, or from `out`/`held` before any pack.
 */
export const ageingBatchStatuses = ["loading", "in_oven", "out", "released", "held", "closed", "void"] as const;
export type AgeingBatchStatus = (typeof ageingBatchStatuses)[number];
/** Batch statuses that still hold the trolley (one unfinished batch per rack). */
export const AGEING_OPEN_BATCH_STATUSES = ["loading", "in_oven", "out", "released", "held"] as const;
export const ageingDispositions = ["rework", "scrapped"] as const;
/** The cycle verdict from the temperature log (`soakCompliance`), stored at take-out and at release. */
export const ageingSoakVerdicts = ["ok", "under_aged", "over_aged", "no_readings"] as const;
export type AgeingSoakVerdict = (typeof ageingSoakVerdicts)[number];
/** The QC verdict at release: pass, fail, or released on an approved `ageing_override`. */
export const ageingQcVerdicts = ["pass", "fail", "override"] as const;
export type AgeingQcVerdict = (typeof ageingQcVerdicts)[number];

export const ageingBatch = sqliteTable(
  "ageing_batch",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `AG-{seq}` from doc series `ageing` (financial year), allocated in the load batch. */
    number: text("number").notNull(),
    status: text("status", { enum: ageingBatchStatuses }).notNull().default("loading"),
    trolleyId: text("trolley_id")
      .notNull()
      .references(() => trolley.id, { onDelete: "restrict" }),
    /** Required at start. */
    ovenId: text("oven_id").references(() => ageingOven.id, { onDelete: "restrict" }),
    /** Required at start (may be picked at load). */
    recipeId: text("recipe_id").references(() => ageingRecipe.id, { onDelete: "restrict" }),
    // Recipe snapshot, copied at start. Null until then.
    alloy: text("alloy"),
    temper: text("temper"),
    targetTempX10: integer("target_temp_x10"),
    toleranceX10: integer("tolerance_x10"),
    soakMin: integer("soak_min"),
    maxSoakMin: integer("max_soak_min"),
    hardnessMethod: text("hardness_method", { enum: hardnessMethods }),
    hardnessMinX10: integer("hardness_min_x10"),
    hardnessMaxX10: integer("hardness_max_x10"),
    sampleCount: integer("sample_count"),
    /** The set-point (same as `target_temp_x10`); actual temperatures live in `ageing_temp_log`. */
    tempCX10: integer("temp_c_x10"),
    /** `company.settings.shifts[].id`, plus the production day and shift seq the start fell in (as press runs). */
    shiftId: text("shift_id"),
    productionDay: text("production_day"),
    shiftSeq: integer("shift_seq"),
    gasStartMilli: integer("gas_start_milli"),
    gasEndMilli: integer("gas_end_milli"),
    /** The operator said the gas meter was replaced (a start below the oven's last end is then not a warning). */
    meterReset: integer("meter_reset", { mode: "boolean" }).notNull().default(sql`0`),
    inAt: integer("in_at", { mode: "timestamp_ms" }),
    outAt: integer("out_at", { mode: "timestamp_ms" }),
    /** First reading inside target ± tolerance. Null until then. */
    soakStartedAt: integer("soak_started_at", { mode: "timestamp_ms" }),
    soakVerdict: text("soak_verdict", { enum: ageingSoakVerdicts }),
    /** Minutes at temperature from the log at take-out / release (evidence; recomputed on read). */
    soakInBandMin: integer("soak_in_band_min"),
    qcVerdict: text("qc_verdict", { enum: ageingQcVerdicts }),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
    /** The approved `ageing_override` a release used (short soak, over-age, failed or untested line). */
    overrideApprovalId: text("override_approval_id"),
    reworkOfBatchId: text("rework_of_batch_id"),
    disposition: text("disposition", { enum: ageingDispositions }),
    /** Void / abort: reason code of kind `ageing_abort` plus the note (required when status is void). */
    voidReasonCodeId: text("void_reason_code_id"),
    voidReason: text("void_reason"),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    /** Native replay key (the `mutation` table's id), unique per company when set. */
    clientMutationId: text("client_mutation_id"),
    note: text("note"),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ageing_batch_company_number_unique").on(table.companyId, table.number),
    // One unfinished batch per trolley (Q6: the rack is free only after close or void).
    uniqueIndex("ageing_batch_trolley_open_unique")
      .on(table.companyId, table.trolleyId)
      .where(sql`${table.status} IN ('loading', 'in_oven', 'out', 'released', 'held')`),
    // One batch in an oven at a time.
    uniqueIndex("ageing_batch_oven_in_unique")
      .on(table.companyId, table.ovenId)
      .where(sql`${table.status} = 'in_oven'`),
    uniqueIndex("ageing_batch_company_client_mutation_unique")
      .on(table.companyId, table.clientMutationId)
      .where(sql`${table.clientMutationId} IS NOT NULL`),
    index("ageing_batch_company_status_idx").on(table.companyId, table.status),
    index("ageing_batch_company_in_at_idx").on(table.companyId, table.inAt),
    index("ageing_batch_company_day_idx").on(table.companyId, table.productionDay),
    index("ageing_batch_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Rows (FP-AG-04, 09): what is on the trolley
// ---------------------------------------------------------------------------

/** `press` = a logged press-run line; `manual` = typed (setting `ageing.manualLoad`); `bundle` = a packed bundle aged whole. */
export const ageingRowSources = ["press", "manual", "bundle"] as const;
export type AgeingRowSource = (typeof ageingRowSources)[number];
export const ageingRowStatuses = ["pending", "held", "released", "closed", "void"] as const;
export type AgeingRowStatus = (typeof ageingRowStatuses)[number];

export const ageingRow = sqliteTable(
  "ageing_row",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    batchId: text("batch_id")
      .notNull()
      .references(() => ageingBatch.id, { onDelete: "cascade" }),
    source: text("source", { enum: ageingRowSources }).notNull().default("press"),
    // App-enforced ids (same style as bundle.cast_id): a press reopen or a bundle void must not be
    // blocked by a foreign key; the reopen blocker and the void rules guard them instead.
    pressRunId: text("press_run_id"),
    pressRunLineId: text("press_run_line_id"),
    bundleId: text("bundle_id"),
    /** The section (die). Pack draws only for this section. */
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    dieInstanceId: text("die_instance_id"),
    castId: text("cast_id"),
    salesOrderId: text("sales_order_id"),
    salesOrderLineId: text("sales_order_line_id"),
    /** Snapshot of `sales_order.po_number` (or typed on a manual row). */
    customerPo: text("customer_po"),
    /** The aged cut length (spec `cut_length_mm`). Pack's re-cut never changes it. */
    lengthMm: integer("length_mm").notNull(),
    /** Loaded pieces. Changes after start only through a split. */
    pcs: integer("pcs").notNull(),
    /** Theoretical grams, prorated from the press line (largest remainder). */
    kgG: integer("kg_g").notNull().default(sql`0`),
    /** Pieces that left through pack (bundles and pack-time rejects). A bundle row starts at pcs. */
    packedPcs: integer("packed_pcs").notNull().default(sql`0`),
    /** Written only by discard-remaining. */
    scrapPcs: integer("scrap_pcs").notNull().default(sql`0`),
    /** Pieces moved to a successor batch. */
    reworkPcs: integer("rework_pcs").notNull().default(sql`0`),
    status: text("status", { enum: ageingRowStatuses }).notNull().default("pending"),
    /** Reason code of kind `ageing_hold` (a hold) or `ageing_reject` (a failed QC verdict at release). */
    holdReasonCodeId: text("hold_reason_code_id"),
    holdNote: text("hold_note"),
    // Hardness summary of the deciding method (median, pass). Null until tested.
    hardnessMethod: text("hardness_method", { enum: hardnessMethods }),
    hardnessReadingX10: integer("hardness_reading_x10"),
    hardnessPass: integer("hardness_pass", { mode: "boolean" }),
    /** The successor row this row's rework pieces went to. */
    reworkRowId: text("rework_row_id"),
    sortOrder: integer("sort_order").notNull().default(sql`0`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ageing_row_company_batch_idx").on(table.companyId, table.batchId),
    index("ageing_row_company_run_line_idx").on(table.companyId, table.pressRunLineId),
    index("ageing_row_company_run_idx").on(table.companyId, table.pressRunId),
    index("ageing_row_company_bundle_idx").on(table.companyId, table.bundleId),
    index("ageing_row_company_so_line_idx").on(table.companyId, table.salesOrderLineId),
    index("ageing_row_company_die_status_idx").on(table.companyId, table.dieId, table.status),
    index("ageing_row_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Readings (FP-AG-06, 17) and hardness samples (FP-AG-07)
// ---------------------------------------------------------------------------

/** `typed` by the operator, `telemetry` from a collector node, `simulator` from OVEN_SIMULATOR (dev only). */
export const ageingTempSources = ["typed", "telemetry", "simulator"] as const;
export type AgeingTempSource = (typeof ageingTempSources)[number];

export const ageingTempLog = sqliteTable(
  "ageing_temp_log",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    batchId: text("batch_id")
      .notNull()
      .references(() => ageingBatch.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    tempCX10: integer("temp_c_x10").notNull(),
    source: text("source", { enum: ageingTempSources }).notNull().default("typed"),
    note: text("note"),
    clientMutationId: text("client_mutation_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("ageing_temp_log_batch_at_idx").on(table.companyId, table.batchId, table.at),
    // A collector or the simulator replaying the same sample changes nothing.
    uniqueIndex("ageing_temp_log_feed_unique")
      .on(table.batchId, table.source, table.at)
      .where(sql`${table.source} <> 'typed'`),
    uniqueIndex("ageing_temp_log_client_mutation_unique")
      .on(table.companyId, table.clientMutationId)
      .where(sql`${table.clientMutationId} IS NOT NULL`),
    index("ageing_temp_log_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const ageingHardness = sqliteTable(
  "ageing_hardness",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    batchId: text("batch_id")
      .notNull()
      .references(() => ageingBatch.id, { onDelete: "cascade" }),
    rowId: text("row_id")
      .notNull()
      .references(() => ageingRow.id, { onDelete: "cascade" }),
    method: text("method", { enum: hardnessMethods }).notNull(),
    readingX10: integer("reading_x10").notNull(),
    /** Against the batch snapshot at insert; a later recipe edit never rewrites it. */
    pass: integer("pass", { mode: "boolean" }).notNull(),
    testedBy: text("tested_by").references(() => user.id, { onDelete: "set null" }),
    testedAt: integer("tested_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("ageing_hardness_company_row_idx").on(table.companyId, table.rowId),
    index("ageing_hardness_company_batch_idx").on(table.companyId, table.batchId),
    index("ageing_hardness_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type AgeingOvenRow = typeof ageingOven.$inferSelect;
export type TrolleyRow = typeof trolley.$inferSelect;
export type AgeingRecipeRow = typeof ageingRecipe.$inferSelect;
export type AgeingBatchRow = typeof ageingBatch.$inferSelect;
export type AgeingRowRow = typeof ageingRow.$inferSelect;
export type AgeingTempLogRow = typeof ageingTempLog.$inferSelect;
export type AgeingHardnessRow = typeof ageingHardness.$inferSelect;
