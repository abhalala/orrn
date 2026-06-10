import { defaultEdgeCapabilities, type EdgeCapability, edgeNodeStatuses } from "@orrn/edge-runtime";
import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export type EdgeNodeStatus = (typeof edgeNodeStatuses)[number];

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
    /** Latest known runtime version, updated on heartbeat. */
    runtimeVersion: text("spool_version"),
    /** Last successful heartbeat from the node runtime. */
    lastHeartbeatAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
    lastSyncCursor: integer("last_sync_cursor"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
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
