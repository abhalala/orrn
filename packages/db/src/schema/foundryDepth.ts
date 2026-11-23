import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { alloy, cast, furnace, returnStream, spectroElements, type SpectroElement } from "./foundry";
import { vendor } from "./purchase";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Foundry depth (XE parity lane FOUNDRY, migration 0061). Logs and billets stay ONE ledger item:
 * `billet`, item_ref = cast id. Where the metal sits says what it is:
 * - `billet_store` (BILLET): logs as they leave the caster or arrive from a vendor;
 * - `billet_rack`: billets cut to length (#44);
 * - `press_floor`: billets issued to one press (#50, `location.press_line_id`).
 * A cut posts −log kg at the store, +billet kg at the rack and the end cuts to a return stream; an issue
 * moves kg from the store or rack to a press floor; a reject posts −kg where it lay and +kg to a return
 * stream. A press run draws from its press's floor when the plant has one, else from the billet store.
 */

// ---------------------------------------------------------------------------
// #41 Homogenizing batches (the ageing batch shape, with logs instead of profiles)
// ---------------------------------------------------------------------------

/** loading → in_furnace → out → released | held; void before release. A held batch releases with a reason. */
export const homogBatchStatuses = ["loading", "in_furnace", "out", "released", "held", "void"] as const;
export type HomogBatchStatus = (typeof homogBatchStatuses)[number];

export const homogBatch = sqliteTable(
  "homog_batch",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `HB-{seq}` per FY (doc series `homog`). */
    number: text("number").notNull(),
    furnaceId: text("furnace_id")
      .notNull()
      .references(() => furnace.id),
    alloyId: text("alloy_id").references(() => alloy.id),
    /** Alloy code snapshot (`6063`). */
    alloy: text("alloy").notNull(),
    /** Recipe, frozen on the batch: soak temperature °C ×10, band ±°C ×10, soak minutes. */
    targetTempX10: integer("target_temp_x10").notNull(),
    toleranceX10: integer("tolerance_x10").notNull(),
    soakMin: integer("soak_min").notNull(),
    status: text("status", { enum: homogBatchStatuses }).notNull().default("loading"),
    loadedAt: integer("loaded_at", { mode: "timestamp_ms" }),
    inAt: integer("in_at", { mode: "timestamp_ms" }),
    outAt: integer("out_at", { mode: "timestamp_ms" }),
    /** Soak verdict computed at take-out (minutes at temperature, ok). */
    soakedMin: integer("soaked_min"),
    soakOk: integer("soak_ok", { mode: "boolean" }),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
    /** Why a held batch was released anyway, or why it was voided. */
    decisionNote: text("decision_note"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("homog_batch_company_number_unique").on(table.companyId, table.number),
    // One batch in a furnace at a time.
    uniqueIndex("homog_batch_one_in_furnace")
      .on(table.companyId, table.furnaceId)
      .where(sql`${table.status} = 'in_furnace'`),
    index("homog_batch_company_status_idx").on(table.companyId, table.status, table.createdAt),
  ],
);

/** Logs of one cast in a batch (pieces and kg). No ledger row: the furnace is not a location. */
export const homogLine = sqliteTable(
  "homog_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => homogBatch.id, { onDelete: "cascade" }),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    pcs: integer("pcs").notNull(),
    kgG: integer("kg_g").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("homog_line_batch_cast_unique").on(table.batchId, table.castId),
    index("homog_line_company_cast_idx").on(table.companyId, table.castId),
  ],
);

/** A typed furnace reading during the soak (°C ×10). */
export const homogReading = sqliteTable(
  "homog_reading",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => homogBatch.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    tempX10: integer("temp_x10").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("homog_reading_batch_at_idx").on(table.batchId, table.at)],
);

// ---------------------------------------------------------------------------
// #42 Bought-in logs
// ---------------------------------------------------------------------------

/**
 * Logs bought from a vendor. Each receipt opens a `cast` row with `source = 'bought_in'` (closed at
 * once, no melts) so billets, press runs, bundles and the trace work unchanged and a bundle traces
 * back to the vendor lot. Ledger: voucher `log_receipt`, + billet (item_ref = that cast) at the billet store.
 */
export const logReceipt = sqliteTable(
  "log_receipt",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `OL-{seq}` per FY (doc series `log_receipt`); also the cast's number. */
    number: text("number").notNull(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    alloyId: text("alloy_id").references(() => alloy.id),
    alloy: text("alloy").notNull(),
    receivedOn: text("received_on").notNull(),
    diameterMm: integer("diameter_mm"),
    lengthMm: integer("length_mm"),
    pcs: integer("pcs").notNull(),
    kgG: integer("kg_g").notNull(),
    /** The vendor's own cast or heat number and their challan / bill number. */
    vendorCastNo: text("vendor_cast_no"),
    challanNo: text("challan_no"),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    /** Mill test certificate in the die-files bucket (`{co}/dies/mtc-{receipt}/{file}`). */
    mtcKey: text("mtc_key"),
    mtcName: text("mtc_name"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("log_receipt_company_number_unique").on(table.companyId, table.number),
    uniqueIndex("log_receipt_cast_unique").on(table.castId),
    index("log_receipt_company_received_idx").on(table.companyId, table.receivedOn),
  ],
);

// ---------------------------------------------------------------------------
// #44 Billet cutting and #50 issue to a press floor
// ---------------------------------------------------------------------------

export const billetCutMachines = ["saw", "hot_shear"] as const;
export type BilletCutMachine = (typeof billetCutMachines)[number];

/** Logs of one cast cut into billets of one length. End cuts = log kg − billet kg, to a return stream. */
export const billetCut = sqliteTable(
  "billet_cut",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    machine: text("machine", { enum: billetCutMachines }).notNull(),
    logPcs: integer("log_pcs").notNull(),
    logG: integer("log_g").notNull(),
    billetLengthMm: integer("billet_length_mm").notNull(),
    billetPcs: integer("billet_pcs").notNull(),
    billetG: integer("billet_g").notNull(),
    endG: integer("end_g").notNull(),
    yieldBp: integer("yield_bp").notNull(),
    fromLocationId: text("from_location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    toLocationId: text("to_location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    endStreamId: text("end_stream_id").references(() => returnStream.id),
    cutAt: integer("cut_at", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("billet_cut_company_cut_idx").on(table.companyId, table.cutAt),
    index("billet_cut_company_cast_idx").on(table.companyId, table.castId),
  ],
);

/** Billets moved from the billet store or rack to one press's floor (voucher `billet_issue`). */
export const billetIssue = sqliteTable(
  "billet_issue",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    /** The press line the floor belongs to (app-enforced id, like `location.press_line_id`). */
    pressLineId: text("press_line_id").notNull(),
    fromLocationId: text("from_location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    toLocationId: text("to_location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    pcs: integer("pcs").notNull(),
    kgG: integer("kg_g").notNull(),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("billet_issue_company_issued_idx").on(table.companyId, table.issuedAt),
    index("billet_issue_company_line_idx").on(table.companyId, table.pressLineId),
  ],
);

// ---------------------------------------------------------------------------
// #43 Log and billet reject registers
// ---------------------------------------------------------------------------

export const foundryRejectKinds = ["log", "billet"] as const;
export type FoundryRejectKind = (typeof foundryRejectKinds)[number];

/** A rejected log or billet: −kg where it lay, +kg to a return stream at plant scrap (voucher `foundry_reject`). */
export const foundryReject = sqliteTable(
  "foundry_reject",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: foundryRejectKinds }).notNull(),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    /** reason_code of kind `log_reject` / `billet_reject` (app-enforced id). */
    reasonCodeId: text("reason_code_id").notNull(),
    reasonNote: text("reason_note"),
    pcs: integer("pcs").notNull(),
    kgG: integer("kg_g").notNull(),
    streamId: text("stream_id")
      .notNull()
      .references(() => returnStream.id),
    rejectedAt: integer("rejected_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("foundry_reject_company_kind_idx").on(table.companyId, table.kind, table.rejectedAt)],
);

// ---------------------------------------------------------------------------
// #46 Casting plan
// ---------------------------------------------------------------------------

/** accepted → opened (a cast was opened from it) | dropped. Proposals are computed, never stored. */
export const castPlanStatuses = ["accepted", "opened", "dropped"] as const;
export type CastPlanStatus = (typeof castPlanStatuses)[number];

export const castPlanLine = sqliteTable(
  "cast_plan_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Plant day the metal is needed by (`YYYY-MM-DD`). */
    day: text("day").notNull(),
    alloyId: text("alloy_id").references(() => alloy.id),
    alloy: text("alloy").notNull(),
    kgG: integer("kg_g").notNull(),
    /** What the proposal said when it was accepted (grams), so an edit stays visible. */
    proposedG: integer("proposed_g").notNull(),
    status: text("status", { enum: castPlanStatuses }).notNull().default("accepted"),
    castId: text("cast_id").references(() => cast.id),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cast_plan_line_company_day_idx").on(table.companyId, table.day),
    uniqueIndex("cast_plan_line_cast_unique")
      .on(table.castId)
      .where(sql`${table.castId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// #47 Typical chemistry per scrap grade and per return stream (for the charge-mix suggestion)
// ---------------------------------------------------------------------------

export const chargeChemistrySubjects = ["grade", "stream"] as const;
export type ChargeChemistrySubject = (typeof chargeChemistrySubjects)[number];

/** One element's typical ppm for a scrap grade (`scrap_grade.id`) or a return stream. Editable per plant. */
export const chargeChemistry = sqliteTable(
  "charge_chemistry",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind", { enum: chargeChemistrySubjects }).notNull(),
    subjectId: text("subject_id").notNull(),
    element: text("element", { enum: spectroElements }).$type<SpectroElement>().notNull(),
    ppm: integer("ppm").notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("charge_chemistry_subject_element_unique").on(table.companyId, table.subjectKind, table.subjectId, table.element)],
);

export type HomogBatchRow = typeof homogBatch.$inferSelect;
export type LogReceiptRow = typeof logReceipt.$inferSelect;
export type BilletCutRow = typeof billetCut.$inferSelect;
export type FoundryRejectRow = typeof foundryReject.$inferSelect;
export type CastPlanLineRow = typeof castPlanLine.$inferSelect;
