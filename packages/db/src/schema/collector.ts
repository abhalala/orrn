import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { melt, spectroResult } from "./foundry";
import { pressLine, pressRun } from "./press";
import { edgeNodeDeployment } from "./spool";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Hardware collectors (W4-COLLECTORS, FP-PR-21 / FP-PR-22 / FP-FD-12), migration 0033_collectors.
 *
 * Seams only: an orrn-spool node posts what a press collector or a spectro watcher saw, signed with
 * the node secret. Today the only sources that exist are the spool's simulators (`--press-sim`,
 * `--spectro-sim`); the PLC make/protocol (Q-PR8, OI-01/OI-05) and the spectrometer's export format
 * are owner-only. Every row says whether it came from a simulator, and nothing here ever writes a
 * press run's figures: the collector only annotates (contract in orrn-spool docs/press-collector.md
 * and docs/spectro-watcher.md).
 *
 * Units: integers ×10 (0.1 mm/s, 0.1 °C, 0.1 bar); grams; Unix ms.
 */

/** What the PLC says the press is doing, when it says (`unknown` when the source has no state). */
export const pressCollectorStates = ["idle", "die_prep", "extruding", "dead_cycle", "fault", "unknown"] as const;
export type PressCollectorState = (typeof pressCollectorStates)[number];

/** Metrics a threshold band can watch (FP-PR-22). */
export const pressAlertMetrics = ["ram_speed", "billet_temp", "exit_temp", "container_temp", "pressure"] as const;
export type PressAlertMetric = (typeof pressAlertMetrics)[number];
export const pressAlertDirections = ["low", "high"] as const;

/**
 * One sample from a press collector. Idempotent on (node, seq): the node replays its backlog after
 * an outage and ORRN keeps the first copy. `press_run_id` is the run that was on the line when the
 * frame was sampled (started_at ≤ sampled_at ≤ stopped_at), null when none was.
 */
export const pressCollectorFrame = sqliteTable(
  "press_collector_frame",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    nodeId: text("node_id")
      .notNull()
      .references(() => edgeNodeDeployment.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    pressLineId: text("press_line_id")
      .notNull()
      .references(() => pressLine.id),
    pressRunId: text("press_run_id").references(() => pressRun.id),
    sampledAt: integer("sampled_at", { mode: "timestamp_ms" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(sql`0`),
    state: text("state", { enum: pressCollectorStates }).notNull().default("unknown"),
    ramSpeedX10: integer("ram_speed_x10"),
    billetTempX10: integer("billet_temp_x10"),
    exitTempX10: integer("exit_temp_x10"),
    containerTempX10: integer("container_temp_x10"),
    pressureX10: integer("pressure_x10"),
    outletPressureX10: integer("outlet_pressure_x10"),
    extrusionMs: integer("extrusion_ms"),
    /** Cumulative counters as the PLC/collector keeps them (may reset; ORRN sums positive steps). */
    billetsTotal: integer("billets_total"),
    billetGTotal: integer("billet_g_total"),
    faultCode: text("fault_code"),
  },
  (table) => [
    uniqueIndex("press_collector_frame_node_seq_unique").on(table.nodeId, table.seq),
    index("press_collector_frame_company_run_idx").on(table.companyId, table.pressRunId),
    index("press_collector_frame_company_line_at_idx").on(table.companyId, table.pressLineId, table.sampledAt),
  ],
);

export const collectorVarianceBases = ["weight", "count"] as const;

/**
 * What the collector saw during one run (one row per run, recomputed on ingest). An annotation: the
 * run's typed figures are never changed. `collector_variance` = collector-derived billet kg differs
 * from the run's typed input kg by more than 2 % (Q-09: accept within 2 %).
 */
export const pressRunCollector = sqliteTable(
  "press_run_collector",
  {
    pressRunId: text("press_run_id")
      .primaryKey()
      .references(() => pressRun.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    pressLineId: text("press_line_id")
      .notNull()
      .references(() => pressLine.id),
    frames: integer("frames").notNull().default(sql`0`),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(sql`0`),
    firstFrameAt: integer("first_frame_at", { mode: "timestamp_ms" }),
    lastFrameAt: integer("last_frame_at", { mode: "timestamp_ms" }),
    extrudingFrames: integer("extruding_frames").notNull().default(sql`0`),
    ramSpeedAvgX10: integer("ram_speed_avg_x10"),
    ramSpeedMaxX10: integer("ram_speed_max_x10"),
    billetTempAvgX10: integer("billet_temp_avg_x10"),
    exitTempMaxX10: integer("exit_temp_max_x10"),
    pressureMaxX10: integer("pressure_max_x10"),
    billetsCounted: integer("billets_counted"),
    collectorInputG: integer("collector_input_g"),
    typedInputG: integer("typed_input_g"),
    varianceBasis: text("variance_basis", { enum: collectorVarianceBases }),
    varianceBp: integer("variance_bp"),
    collectorVariance: integer("collector_variance", { mode: "boolean" }).notNull().default(sql`0`),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("press_run_collector_company_line_idx").on(table.companyId, table.pressLineId),
    index("press_run_collector_company_variance_idx").on(table.companyId, table.collectorVariance),
  ],
);

/**
 * Threshold band for one metric (FP-PR-22): on one press line, or every line when
 * `press_line_id` is null (a line's own band wins). min/max ×10; either may be open.
 */
export const pressAlertThreshold = sqliteTable(
  "press_alert_threshold",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    pressLineId: text("press_line_id").references(() => pressLine.id, { onDelete: "cascade" }),
    metric: text("metric", { enum: pressAlertMetrics }).notNull(),
    minX10: integer("min_x10"),
    maxX10: integer("max_x10"),
    active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_alert_threshold_line_metric_unique")
      .on(table.companyId, table.pressLineId, table.metric)
      .where(sql`${table.pressLineId} IS NOT NULL`),
    uniqueIndex("press_alert_threshold_all_metric_unique")
      .on(table.companyId, table.metric)
      .where(sql`${table.pressLineId} IS NULL`),
  ],
);

/**
 * A metric out of its band on a line (FP-PR-22). Consecutive out-of-band frames extend one open
 * alert (`last_at`, `frames`, `peak_x10`); the first in-band frame ends it. At most one open alert
 * per (line, metric). No notification: Today shows a chip with the open count.
 */
export const pressAlert = sqliteTable(
  "press_alert",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    pressLineId: text("press_line_id")
      .notNull()
      .references(() => pressLine.id),
    pressRunId: text("press_run_id").references(() => pressRun.id),
    nodeId: text("node_id").references(() => edgeNodeDeployment.id, { onDelete: "set null" }),
    metric: text("metric", { enum: pressAlertMetrics }).notNull(),
    direction: text("direction", { enum: pressAlertDirections }).notNull(),
    /** The band edge crossed (min for low, max for high) at the time the alert opened. */
    limitX10: integer("limit_x10").notNull(),
    peakX10: integer("peak_x10").notNull(),
    frames: integer("frames").notNull().default(sql`1`),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(sql`0`),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    lastAt: integer("last_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("press_alert_open_unique")
      .on(table.companyId, table.pressLineId, table.metric)
      .where(sql`${table.endedAt} IS NULL`),
    index("press_alert_company_started_idx").on(table.companyId, table.startedAt),
    index("press_alert_company_run_idx").on(table.companyId, table.pressRunId),
  ],
);

export const spectroInboxStatuses = ["uploading", "pending_review", "attached", "dismissed"] as const;
export type SpectroInboxStatus = (typeof spectroInboxStatuses)[number];

/**
 * A results file the plant's spectro watcher uploaded (FP-FD-12). Idempotent on the file's
 * SHA-256 per company. Lands `uploading` (signed PUT outstanding), turns `pending_review` when the
 * bytes arrive and hash-match, and is only ever attached to a melt by a person (`cast.enter`):
 * never auto-attached. Bytes live in R2 under `{companyId}/spectro/{id}`.
 */
export const spectroInbox = sqliteTable(
  "spectro_inbox",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    nodeId: text("node_id").references(() => edgeNodeDeployment.id, { onDelete: "set null" }),
    sha256: text("sha256").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    fileKey: text("file_key").notNull(),
    status: text("status", { enum: spectroInboxStatuses }).notNull().default("uploading"),
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(sql`0`),
    /** When the instrument wrote the file (the watcher's view), if known. */
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
    /** Sample id / heat label as the instrument printed it (free text; never matched automatically). */
    sampleRef: text("sample_ref"),
    instrument: text("instrument"),
    /** Values the watcher parsed from a CSV, ppm per element; a suggestion for the person attaching. */
    valuesPpm: text("values_ppm", { mode: "json" }).$type<Record<string, number>>(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }),
    meltId: text("melt_id").references(() => melt.id),
    spectroResultId: text("spectro_result_id").references(() => spectroResult.id),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    dismissReason: text("dismiss_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("spectro_inbox_company_sha_unique").on(table.companyId, table.sha256),
    index("spectro_inbox_company_status_idx").on(table.companyId, table.status),
  ],
);

export type PressCollectorFrameRow = typeof pressCollectorFrame.$inferSelect;
export type PressRunCollectorRow = typeof pressRunCollector.$inferSelect;
export type PressAlertThresholdRow = typeof pressAlertThreshold.$inferSelect;
export type PressAlertRow = typeof pressAlert.$inferSelect;
export type SpectroInboxRow = typeof spectroInbox.$inferSelect;
