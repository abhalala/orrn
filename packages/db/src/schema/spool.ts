import {
  defaultEdgeCapabilities,
  type EdgeCapability,
  type EdgeDesiredPrinter,
  edgeNodeStatuses,
} from "@orrn/edge-runtime";
import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export type EdgeNodeStatus = (typeof edgeNodeStatuses)[number];

/** One collector as a node reports it in its heartbeat (orrn-spool docs/press-collector.md §6). */
export type CollectorPresence = {
  kind: "press" | "spectro";
  /** Press line code (press collectors) or null. */
  line: string | null;
  /** `sim`, `modbus`, `opcua`, `watch_dir`, … as the node names its source. */
  source: string;
  configured: boolean;
  simulated: boolean;
  connected: boolean;
  lastFrameAt: string | null;
  /** Frames / files waiting on the node to be sent (outage backlog). */
  backlog: number;
  lastError: string | null;
};

/**
 * Per-tenant edge node deployment record.
 *
 * The SQL table name remains `spool_deployment` for an in-place migration from
 * the previous print-spool product into the broader edge-node runtime.
 */
export const edgeNodeDeployment = sqliteTable(
  "spool_deployment",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull().unique(),
    status: text("status", { enum: edgeNodeStatuses })
      .notNull()
      .default("pending"),
    nodeName: text("node_name").notNull().default("Primary edge node"),
    siteLabel: text("site_label").notNull().default("Main facility"),
    subdomain: text("subdomain").notNull().unique(),
    nodeDomain: text("spool_domain").notNull().unique(),
    /** Cloudflare Tunnel UUID. */
    cfTunnelId: text("cf_tunnel_id"),
    /** AES-GCM wrapped Cloudflare Tunnel token (encrypted with ORRN_MASTER_KEY). */
    cfTunnelTokenWrapped: text("cf_tunnel_token_wrapped").notNull(),
    /** SHA-256 hex digest of the raw shared secret — used for lookup/verification. */
    sharedSecretHash: text("shared_secret_hash").notNull(),
    /** AES-GCM wrapped shared secret — unwrapped at runtime to sign outgoing requests. */
    sharedSecretWrapped: text("shared_secret_wrapped").notNull(),
    runtimeFlavor: text("runtime_flavor").notNull().default("native"),
    runtimePlatform: text("runtime_platform"),
    capabilities: text("capabilities", { mode: "json" })
      .$type<EdgeCapability[]>()
      .notNull()
      .default(defaultEdgeCapabilities),
    fingerprint: text("fingerprint"),
    enrollmentTokenHash: text("enrollment_token_hash"),
    enrollmentIssuedAt: integer("enrollment_issued_at", { mode: "timestamp_ms" }),
    enrollmentExpiresAt: integer("enrollment_expires_at", { mode: "timestamp_ms" }),
    enrollmentUsedAt: integer("enrollment_used_at", { mode: "timestamp_ms" }),
    installId: text("install_id"),
    credentialVersion: integer("credential_version").notNull().default(1),
    pendingCredentialVersion: integer("pending_credential_version"),
    pendingSecretHash: text("pending_secret_hash"),
    pendingSecretWrapped: text("pending_secret_wrapped"),
    configVersion: integer("config_version").notNull().default(1),
    appliedConfigVersion: integer("applied_config_version").notNull().default(0),
    reportedPrinters: text("reported_printers", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
    /** Desired printers for this node; every change bumps `configVersion`. */
    desiredPrinters: text("desired_printers", { mode: "json" }).$type<EdgeDesiredPrinter[]>(),
    /** Latest known runtime version, updated on heartbeat. */
    runtimeVersion: text("spool_version"),
    /** Last successful heartbeat from the node runtime. */
    lastHeartbeatAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
    lastSyncCursor: integer("last_sync_cursor"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    /**
     * Scale presence from the node's last signed heartbeat (null = never reported). True when the
     * node has a scale configured (real or simulated); ORRN never infers it.
     */
    scaleConfigured: integer("scale_configured", { mode: "boolean" }),
    /** Whether that scale is simulated (orrn-spool --scale-sim). */
    scaleSimulated: integer("scale_simulated", { mode: "boolean" }),
    /** Newest frame the node had received from the indicator, as of the last heartbeat. */
    scaleLastFrameAt: integer("scale_last_frame_at", { mode: "timestamp_ms" }),
    /** When the scale fields above were last written (a signed heartbeat). */
    scaleReportedAt: integer("scale_reported_at", { mode: "timestamp_ms" }),
    /**
     * Collector presence from the node's last signed heartbeat (W4-COLLECTORS): one entry per press
     * collector / spectro watcher the node runs, as the node reports it (null = never reported).
     * `simulated` is the node's own word; ORRN never upgrades a simulator to a device.
     */
    collectors: text("collectors", { mode: "json" }).$type<CollectorPresence[]>(),
    /** When `collectors` was last written (a signed heartbeat). */
    collectorsReportedAt: integer("collectors_reported_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("spool_deployment_company_idx").on(table.companyId),
    index("spool_deployment_company_status_idx").on(table.companyId, table.status),
    index("spool_deployment_company_site_idx").on(table.companyId, table.siteLabel),
    uniqueIndex("spool_deployment_instance_id_unique").on(table.instanceId),
    uniqueIndex("spool_deployment_subdomain_unique").on(table.subdomain),
    uniqueIndex("spool_deployment_spool_domain_unique").on(table.nodeDomain),
  ],
);

export const edgeNodeDeploymentRelations = relations(edgeNodeDeployment, ({ one }) => ({
  company: one(company, {
    fields: [edgeNodeDeployment.companyId],
    references: [company.id],
  }),
}));

export const spoolDeploymentStatuses = edgeNodeStatuses;
export type SpoolDeploymentStatus = EdgeNodeStatus;
export const spoolDeployment = edgeNodeDeployment;
export const spoolDeploymentRelations = edgeNodeDeploymentRelations;

export const edgeCommand = sqliteTable(
  "edge_command",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => edgeNodeDeployment.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    jobKey: text("job_key"),
    payloadHash: text("payload_hash"),
    printLogId: text("print_log_id"),
    state: text("state").notNull().default("queued"),
    leaseId: text("lease_id"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    deliveryCount: integer("delivery_count").notNull().default(0),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolutionJson: text("resolution_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("edge_command_deployment_state_idx").on(table.deploymentId, table.state, table.createdAt),
    index("edge_command_company_job_key_idx").on(table.companyId, table.jobKey),
  ],
);

export const edgeEventReceipt = sqliteTable(
  "edge_event_receipt",
  {
    eventId: text("event_id").notNull(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => edgeNodeDeployment.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    responseJson: text("response_json").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("edge_event_receipt_deployment_event_unique").on(table.deploymentId, table.eventId),
  ],
);

export const edgeSnapshot = sqliteTable(
  "edge_snapshot",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    contentSha256: text("content_sha256").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(1),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("edge_snapshot_company_section_idx").on(table.companyId, table.section, table.generatedAt),
  ],
);

export const edgeSnapshotChunk = sqliteTable(
  "edge_snapshot_chunk",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => edgeSnapshot.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    sequence: integer("sequence").notNull(),
    sha256: text("sha256").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    byteLength: integer("byte_length").notNull().default(0),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("edge_snapshot_chunk_snapshot_seq_unique").on(table.snapshotId, table.sequence),
    index("edge_snapshot_chunk_company_section_idx").on(table.companyId, table.section),
  ],
);
