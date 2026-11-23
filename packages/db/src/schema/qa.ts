import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { dieInstance } from "./dies";
import { bundle } from "./inventory";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Quality gates (XE parity lane QA, migration 0055_xe_qa). orrn keeps quality as checkpoints on the
 * documents it already has, not as two dozen registers: `qa_check` is one table for every kind of
 * check (incoming, first piece, in process, clearance, dimensions, mechanical, ultrasonic) and each
 * register is a filtered list of it. Verdicts (`result`, `flags_json`) are computed by the server from
 * `@orrn/domain` `qa.ts`; clients never send one for dimensions or mechanical values.
 *
 * Integers only: micrometres for dimensions, MPa, x10 for elongation, hardness and press readings
 * (the collector's units), company-day text `YYYY-MM-DD` for calibration dates.
 *
 * `qa_check` and `qa_hold` rows are never deleted by code. A re-check is a new row; the latest row of a
 * kind on a subject is its state. A hold is released by stamping `released_*`, never by deleting it,
 * so the hold log is the table.
 */

export const qaCheckKinds = ["incoming", "first_piece", "in_process", "clearance", "dimension", "mechanical", "ultrasonic"] as const;
export const qaSubjectTypes = ["press_run", "bundle", "purchase_lot", "store_grn", "cast", "ageing_batch"] as const;
export const qaStages = ["incoming", "press", "ageing", "pack", "dispatch"] as const;
export const qaResults = ["pass", "fail", "unchecked"] as const;
export const qaHardnessMethods = ["webster", "hb"] as const;
export type QaHardnessMethod = (typeof qaHardnessMethods)[number];

/** Temper master (row 35): T4, T5, T6 ... with the minimums a mechanical check reads. */
export const qaTemper = sqliteTable(
  "qa_temper",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    /** '' = any alloy; else the alloy code (6063) these minimums are for. */
    alloy: text("alloy").notNull().default(""),
    name: text("name"),
    hardnessMethod: text("hardness_method", { enum: qaHardnessMethods }).notNull().default("webster"),
    hardnessMinX10: integer("hardness_min_x10"),
    tensileMinMpa: integer("tensile_min_mpa"),
    yieldMinMpa: integer("yield_min_mpa"),
    elongationMinX10: integer("elongation_min_x10"),
    active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("qa_temper_company_code_alloy_unique").on(table.companyId, table.code, table.alloy)],
);

/** One critical dimension of a section's drawing, as the quality plan keeps it. */
export type QaPlanDimension = { name: string; nominalUm: number; minusUm: number; plusUm: number };

/**
 * Quality plan (row 28) for a section, or for one die copy of it (`die_instance_id` set; the copy's own
 * plan wins over the section's). Process limits x10, ageing temperature x10 and soak minutes, the test
 * frequency, the temper and the drawing's critical dimensions.
 */
export const qaPlan = sqliteTable(
  "qa_plan",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "cascade" }),
    dieInstanceId: text("die_instance_id").references(() => dieInstance.id, { onDelete: "cascade" }),
    temperId: text("temper_id").references(() => qaTemper.id, { onDelete: "set null" }),
    billetTempMinX10: integer("billet_temp_min_x10"),
    billetTempMaxX10: integer("billet_temp_max_x10"),
    exitTempMinX10: integer("exit_temp_min_x10"),
    exitTempMaxX10: integer("exit_temp_max_x10"),
    ramSpeedMinX10: integer("ram_speed_min_x10"),
    ramSpeedMaxX10: integer("ram_speed_max_x10"),
    ageingTempX10: integer("ageing_temp_x10"),
    ageingSoakMin: integer("ageing_soak_min"),
    everyBundles: integer("every_bundles"),
    everyMinutes: integer("every_minutes"),
    dimensionsJson: text("dimensions_json", { mode: "json" }).$type<QaPlanDimension[]>().notNull().default([]),
    note: text("note"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("qa_plan_section_unique").on(table.companyId, table.dieId).where(sql`${table.dieInstanceId} IS NULL`),
    uniqueIndex("qa_plan_copy_unique").on(table.companyId, table.dieInstanceId).where(sql`${table.dieInstanceId} IS NOT NULL`),
  ],
);

/** Inspection point (row 36): a named place where lots and runs wait for checks at one stage. */
export const qaStation = sqliteTable(
  "qa_station",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    stage: text("stage", { enum: qaStages }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [uniqueIndex("qa_station_company_code_unique").on(table.companyId, table.code), index("qa_station_company_stage_idx").on(table.companyId, table.stage)],
);

/** Where a waiting lot or run sits (row 36). One place per subject; moving it rewrites the row. */
export const qaPlace = sqliteTable(
  "qa_place",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", { enum: qaSubjectTypes }).notNull(),
    subjectId: text("subject_id").notNull(),
    stationId: text("station_id")
      .notNull()
      .references(() => qaStation.id, { onDelete: "cascade" }),
    placedBy: text("placed_by").references(() => user.id, { onDelete: "set null" }),
    placedAt: integer("placed_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [uniqueIndex("qa_place_subject_unique").on(table.companyId, table.subjectType, table.subjectId), index("qa_place_company_station_idx").on(table.companyId, table.stationId)],
);

/** Instrument and gauge register (row 38). Certificate bytes sit in the die-files bucket (R2 on prod). */
export const qaInstrument = sqliteTable(
  "qa_instrument",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    rangeText: text("range_text"),
    place: text("place"),
    intervalDays: integer("interval_days"),
    lastCalibratedOn: text("last_calibrated_on"),
    nextDueOn: text("next_due_on"),
    certificateKey: text("certificate_key"),
    certificateName: text("certificate_name"),
    active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("qa_instrument_company_code_unique").on(table.companyId, table.code), index("qa_instrument_company_due_idx").on(table.companyId, table.active, table.nextDueOn)],
);

/** Out-of-tolerance and below-minimum flags the server stored with a check. */
export type QaCheckFlags = { flagged?: string[]; low?: string[]; missing?: string[]; unchecked?: string[] };

/** One checkpoint result (rows 22 to 27, 39). */
export const qaCheck = sqliteTable(
  "qa_check",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: qaCheckKinds }).notNull(),
    subjectType: text("subject_type", { enum: qaSubjectTypes }).notNull(),
    subjectId: text("subject_id").notNull(),
    /** Links for the registers (opaque ids, scoped by company in every read). */
    pressRunId: text("press_run_id"),
    bundleId: text("bundle_id"),
    dieId: text("die_id"),
    dieInstanceId: text("die_instance_id"),
    lotId: text("lot_id"),
    castId: text("cast_id"),
    ageingBatchId: text("ageing_batch_id"),
    /** The subject's number at the time (PR-12, LOT-4, a bundle serial), for lists without joins. */
    subjectNumber: text("subject_number").notNull().default(""),
    /** Clearance: the stage it is cleared for. */
    stage: text("stage", { enum: qaStages }),
    stationId: text("station_id").references(() => qaStation.id, { onDelete: "set null" }),
    instrumentId: text("instrument_id").references(() => qaInstrument.id, { onDelete: "set null" }),
    temperId: text("temper_id").references(() => qaTemper.id, { onDelete: "set null" }),
    result: text("result", { enum: qaResults }).notNull(),
    valuesJson: text("values_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    flagsJson: text("flags_json", { mode: "json" }).$type<QaCheckFlags>().notNull().default({}),
    /** Ultrasonic: the standard tested to; free text. */
    standard: text("standard"),
    /** Ultrasonic: the operator's name when it is not the person entering. */
    operatorName: text("operator_name"),
    note: text("note"),
    checkedBy: text("checked_by").references(() => user.id, { onDelete: "set null" }),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("qa_check_company_kind_at_idx").on(table.companyId, table.kind, table.checkedAt),
    index("qa_check_company_subject_idx").on(table.companyId, table.subjectType, table.subjectId, table.kind, table.checkedAt),
    index("qa_check_company_run_idx").on(table.companyId, table.pressRunId),
    index("qa_check_company_bundle_idx").on(table.companyId, table.bundleId),
  ],
);

/**
 * Quality hold on a bundle (row 29), separate from the sales hold (`bundle.held_for_line_id`) and from a
 * dispatch's reserve. At most one open hold per bundle; release stamps the row.
 */
export const qaHold = sqliteTable(
  "qa_hold",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    checkId: text("check_id").references(() => qaCheck.id, { onDelete: "set null" }),
    heldBy: text("held_by").references(() => user.id, { onDelete: "set null" }),
    heldAt: integer("held_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releaseNote: text("release_note"),
  },
  (table) => [
    uniqueIndex("qa_hold_open_unique").on(table.companyId, table.bundleId).where(sql`${table.releasedAt} IS NULL`),
    index("qa_hold_company_held_idx").on(table.companyId, table.heldAt),
  ],
);

/** Allowed alloy substitutes (row 37), for the whole plant or for one customer. */
export const qaAlloySubstitute = sqliteTable(
  "qa_alloy_substitute",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    alloy: text("alloy").notNull(),
    substitute: text("substitute").notNull(),
    customerId: text("customer_id").references(() => customer.id, { onDelete: "cascade" }),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("qa_alloy_substitute_plant_unique").on(table.companyId, table.alloy, table.substitute).where(sql`${table.customerId} IS NULL`),
    uniqueIndex("qa_alloy_substitute_customer_unique").on(table.companyId, table.alloy, table.substitute, table.customerId).where(sql`${table.customerId} IS NOT NULL`),
  ],
);

export type QaCheckRow = typeof qaCheck.$inferSelect;
export type QaHoldRow = typeof qaHold.$inferSelect;
export type QaTemperRow = typeof qaTemper.$inferSelect;
export type QaPlanRow = typeof qaPlan.$inferSelect;
export type QaInstrumentRow = typeof qaInstrument.$inferSelect;
