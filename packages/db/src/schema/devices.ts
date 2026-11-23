import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { qaCheck } from "./qa";
import { spoolDeployment } from "./spool";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Plant connections (XE parity lane DEVICES, migration 0067_xe_devices, module `devices`, opt-in).
 *
 * - `plant_device`: one weighbridge, scanner, tensile tester or collector device, enrolled on an edge
 *   node (edge v1 `spool_deployment`) with its own token (SHA-256 only; the token is shown once). Revoking
 *   stamps `revoked_*`; the row stays. Last seen, the last seq and the clock skew are written by the edge
 *   routes. `simulated` devices are the edge simulator, labelled sim everywhere.
 * - `device_reading`: append-only. Every ticket, scan and tensile test as it arrived (push from the edge or
 *   a CSV import); never updated, never deleted by code. `dedupe_key` is unique per plant: a push is
 *   (device, token version, epoch, seq), a file row is (kind, device, ticket no / sample + time).
 * - `device_reading_use`: what a reading became, or a typed weight with its reason. A weighbridge ticket on
 *   a scrap lot or a dispatch, a lab reading turned into a quality check, a lab reading set aside. Voiding
 *   stamps `voided_*` (a wrong pick is corrected by a new row); one live use per reading and one live
 *   weigh per subject (partial unique indexes), so one ticket is never counted on two trucks.
 */

export const plantDeviceKinds = ["weighbridge", "profile_scanner", "utm", "spectro", "scale", "plc", "oven"] as const;
export const plantDeviceProtocols = ["modbus_tcp", "opc_ua", "serial", "file", "sim"] as const;
export const deviceReadingKinds = ["weighbridge", "dimension", "mechanical"] as const;
export const deviceReadingSources = ["push", "file"] as const;
export const deviceUseSubjects = ["purchase_lot", "dispatch", "press_run", "bundle", "ageing_batch", "set_aside"] as const;

export const plantDevice = sqliteTable(
  "plant_device",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** The edge node it hangs off; null for a device whose files are only imported by hand. */
    deploymentId: text("deployment_id").references(() => spoolDeployment.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: plantDeviceKinds }).notNull(),
    protocol: text("protocol", { enum: plantDeviceProtocols }).notNull(),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(false),
    /** Adapter map (`@orrn/edge-runtime/devices` deviceAdapterConfigSchema); null for files and the simulator. */
    configJson: text("config_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    heartbeatSec: integer("heartbeat_sec").notNull().default(60),
    tokenHash: text("token_hash"),
    /** Last 4 characters, so a person can tell two tokens apart. */
    tokenHint: text("token_hint"),
    tokenVersion: integer("token_version").notNull().default(1),
    enrolledBy: text("enrolled_by").references(() => user.id, { onDelete: "set null" }),
    enrolledAt: integer("enrolled_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokeReason: text("revoke_reason"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    lastSeq: integer("last_seq"),
    lastEpoch: text("last_epoch"),
    lastSkewMs: integer("last_skew_ms"),
    buffered: integer("buffered"),
    linkState: text("link_state"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("plant_device_company_code_unique").on(table.companyId, table.code),
    index("plant_device_company_kind_idx").on(table.companyId, table.kind),
    index("plant_device_deployment_idx").on(table.deploymentId),
  ],
);

export const deviceReading = sqliteTable(
  "device_reading",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => plantDevice.id, { onDelete: "set null" }),
    kind: text("kind", { enum: deviceReadingKinds }).notNull(),
    source: text("source", { enum: deviceReadingSources }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    seq: integer("seq"),
    epoch: text("epoch"),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(false),
    /** ORRN's time for the sample: the device's time, moved by the measured skew when that was beyond 2 minutes. */
    sampledAt: integer("sampled_at", { mode: "timestamp_ms" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    skewMs: integer("skew_ms"),
    timeUnconfirmed: integer("time_unconfirmed", { mode: "boolean" }).notNull().default(false),
    /** Weighbridge. */
    ticketNo: text("ticket_no"),
    vehicleNo: text("vehicle_no"),
    grossG: integer("gross_g"),
    tareG: integer("tare_g"),
    netG: integer("net_g"),
    /** Lab: the code printed on the sample, normalised (upper case, no spaces). */
    sampleCode: text("sample_code"),
    /** Dimension points or the tensile values, as they arrived. */
    valuesJson: text("values_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    importedBy: text("imported_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("device_reading_company_dedupe_unique").on(table.companyId, table.dedupeKey),
    index("device_reading_company_kind_at_idx").on(table.companyId, table.kind, table.sampledAt),
    index("device_reading_company_vehicle_idx").on(table.companyId, table.vehicleNo, table.sampledAt),
    index("device_reading_company_sample_idx").on(table.companyId, table.sampleCode),
    index("device_reading_device_at_idx").on(table.deviceId, table.sampledAt),
  ],
);

export const deviceReadingUse = sqliteTable(
  "device_reading_use",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** Null for a typed weight (the bridge reading was not used). */
    readingId: text("reading_id").references(() => deviceReading.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", { enum: deviceUseSubjects }).notNull(),
    /** Null only for `set_aside`. */
    subjectId: text("subject_id"),
    /** Weigh uses: the bridge's net (null when typed with no ticket to compare), what was typed, the gap. */
    bridgeG: integer("bridge_g"),
    typedG: integer("typed_g"),
    diffG: integer("diff_g"),
    allowedG: integer("allowed_g"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    /** Why the weight was typed, or why a lab reading was set aside. */
    reason: text("reason"),
    qaCheckId: text("qa_check_id").references(() => qaCheck.id, { onDelete: "set null" }),
    /** Null when the device itself wrote it (auto-capture by sample code). */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("device_reading_use_live_reading_unique").on(table.companyId, table.readingId).where(sql`${table.readingId} IS NOT NULL AND ${table.voidedAt} IS NULL`),
    uniqueIndex("device_reading_use_live_weigh_unique")
      .on(table.companyId, table.subjectType, table.subjectId)
      .where(sql`${table.subjectType} IN ('purchase_lot', 'dispatch') AND ${table.voidedAt} IS NULL`),
    index("device_reading_use_company_subject_idx").on(table.companyId, table.subjectType, table.subjectId),
    index("device_reading_use_company_flagged_idx").on(table.companyId, table.flagged, table.createdAt),
  ],
);

export type PlantDeviceRow = typeof plantDevice.$inferSelect;
export type DeviceReadingRow = typeof deviceReading.$inferSelect;
export type DeviceReadingUseRow = typeof deviceReadingUse.$inferSelect;
