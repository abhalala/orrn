import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { bundle } from "./inventory";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Process steps (XE parity lane JOBWORK, migration 0064). One engine for every step that takes bundles
 * in and gives bundles back: job-work out to a vendor on a delivery challan (anodise, powder coat, PVD,
 * machining), an in-house finishing line, the draw bench and fabrication. Pure rules in
 * `@orrn/domain` `jobwork.ts`; the server in `routers/process.ts` and `lib/process.ts`.
 *
 * Ledger: out to a vendor is a `move` to the vendor's own location (kind `vendor`); the return moves
 * the bundles back to a yard and posts the loss (`process_loss`) and the rejects (`process_scrap`). New
 * output bundles post `process_in` (− the inputs, which go void) and `process_out` (+ the outputs).
 * Rows are never deleted by code; a hold is released by stamping it.
 */

export const processKindValues = ["jobwork", "finish", "draw", "fabricate"] as const;
export const processStepStatusValues = ["open", "partial", "done", "cancelled"] as const;
export const processReturnModeValues = ["same", "new"] as const;
export const processHoldReasons = ["jobwork", "process"] as const;

/** A job-work vendor (anodiser, powder coater, machinist). Each has its own stock location of kind `vendor`. */
export const processVendor = sqliteTable(
  "process_vendor",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    name: text("name").notNull(),
    gstin: text("gstin"),
    address: text("address"),
    /** State name for the challan's place of supply (inter-State movement). */
    state: text("state"),
    phone: text("phone"),
    /** JSON list of finishProcesses this vendor does. */
    processes: text("processes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Default vendor rate per kg in paise (seen only with `jobwork.cost`). */
    ratePaisePerKg: integer("rate_paise_per_kg"),
    /** The vendor's stock location (kind `vendor`): where bundles sit while they are out. */
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("process_vendor_company_code_unique").on(table.companyId, table.code),
    index("process_vendor_company_location_idx").on(table.companyId, table.locationId),
  ],
);

/** One step: a job-work challan (JW/2026-27/n) or an in-house step (PS/2026-27/n). */
export const processStep = sqliteTable(
  "process_step",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    kind: text("kind", { enum: processKindValues }).notNull(),
    /** finishProcesses for jobwork / finish; `draw` / `fabricate` for the other kinds. */
    process: text("process").notNull(),
    /** Fabrication operations (JSON list of fabricationOps), else []. */
    ops: text("ops", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    vendorId: text("vendor_id").references(() => processVendor.id, { onDelete: "restrict" }),
    /** Colour or finish code (RAL 9016, AA15 silver). */
    finishCode: text("finish_code"),
    /** `YYYY-MM-DD` on the plant clock. */
    expectedReturn: text("expected_return"),
    status: text("status", { enum: processStepStatusValues }).notNull().default("open"),
    inputG: integer("input_g").notNull().default(0),
    inputPcs: integer("input_pcs").notNull().default(0),
    /** Declared value per kg in paise for the challan (rule 55 needs a value). */
    valuePaisePerKg: integer("value_paise_per_kg"),
    hsn: text("hsn"),
    vehicleNo: text("vehicle_no"),
    /** In-house: the line's batch, the chemicals used (JSON [{ name, qty }]), passes on the draw bench. */
    batchNo: text("batch_no"),
    chemicals: text("chemicals", { mode: "json" }).$type<{ name: string; qty: string }[]>().notNull().default(sql`'[]'`),
    passes: integer("passes"),
    /** Draw bench: the size it is drawn to (free text: 25 x 1.2 mm tube). */
    outSize: text("out_size"),
    ratePaisePerKg: integer("rate_paise_per_kg"),
    note: text("note"),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    /** When the challan went out, or the in-house step started. */
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelReason: text("cancel_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("process_step_company_number_unique").on(table.companyId, table.number),
    index("process_step_company_status_idx").on(table.companyId, table.status),
    index("process_step_company_kind_sent_idx").on(table.companyId, table.kind, table.sentAt),
    index("process_step_company_vendor_idx").on(table.companyId, table.vendorId, table.status),
  ],
);

/** A bundle that went into a step: weight, pieces and place at send time. `return_id` is set when it came back. */
export const processInput = sqliteTable(
  "process_input",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => processStep.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "restrict" }),
    serial: text("serial").notNull(),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    weightG: integer("weight_g").notNull(),
    pcs: integer("pcs").notNull(),
    lengthMm: integer("length_mm").notNull(),
    fromLocationId: text("from_location_id").references(() => location.id, { onDelete: "restrict" }),
    returnId: text("return_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("process_input_step_bundle_unique").on(table.companyId, table.stepId, table.bundleId),
    index("process_input_company_bundle_idx").on(table.companyId, table.bundleId),
  ],
);

/**
 * The hold that keeps a bundle out of pack, dispatch and moves while it is on a step (CONTRACTS-W2
 * item 3): reason `jobwork` (out at a vendor) or `process` (on an in-house line). At most one open
 * hold per bundle; a return or a cancel stamps `released_at`.
 */
export const processHold = sqliteTable(
  "process_hold",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => processStep.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: processHoldReasons }).notNull(),
    heldAt: integer("held_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("process_hold_open_unique").on(table.companyId, table.bundleId).where(sql`${table.releasedAt} IS NULL`),
    index("process_hold_company_step_idx").on(table.companyId, table.stepId),
  ],
);

/** One receipt against a step (a vendor may send a challan back in parts). */
export const processReturn = sqliteTable(
  "process_return",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    stepId: text("step_id")
      .notNull()
      .references(() => processStep.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    mode: text("mode", { enum: processReturnModeValues }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    receivedBy: text("received_by").references(() => user.id, { onDelete: "set null" }),
    inputG: integer("input_g").notNull(),
    outputG: integer("output_g").notNull(),
    outputPcs: integer("output_pcs").notNull(),
    rejectG: integer("reject_g").notNull().default(0),
    rejectPcs: integer("reject_pcs").notNull().default(0),
    scrapG: integer("scrap_g").notNull().default(0),
    /** input − output − rejects − scrap; negative = the coat added weight. */
    lossG: integer("loss_g").notNull(),
    ratePaisePerKg: integer("rate_paise_per_kg"),
    amountPaise: integer("amount_paise").notNull().default(0),
    /** Minutes the step took (in-house). */
    minutes: integer("minutes"),
    passes: integer("passes"),
    /** The vendor's own challan or bill number on the way back. */
    vendorDocNo: text("vendor_doc_no"),
    locationId: text("location_id").references(() => location.id, { onDelete: "restrict" }),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("process_return_step_line_unique").on(table.companyId, table.stepId, table.line),
    index("process_return_company_received_idx").on(table.companyId, table.receivedAt),
  ],
);

/** The bundles a return gave: the same bundle back (`input_bundle_id` = bundle) or a new output bundle. */
export const processOutput = sqliteTable(
  "process_output",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    returnId: text("return_id")
      .notNull()
      .references(() => processReturn.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => processStep.id, { onDelete: "cascade" }),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundle.id, { onDelete: "restrict" }),
    inputBundleId: text("input_bundle_id"),
    weightG: integer("weight_g").notNull(),
    pcs: integer("pcs").notNull(),
    lengthMm: integer("length_mm").notNull(),
    rejectPcs: integer("reject_pcs").notNull().default(0),
    rejectG: integer("reject_g").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("process_output_company_step_idx").on(table.companyId, table.stepId),
    index("process_output_company_bundle_idx").on(table.companyId, table.bundleId),
  ],
);

export type ProcessStepRow = typeof processStep.$inferSelect;
export type ProcessVendorRow = typeof processVendor.$inferSelect;
