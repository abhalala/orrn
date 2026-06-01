import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const spoolDeploymentStatuses = ["pending", "active", "revoked"] as const;
export type SpoolDeploymentStatus = (typeof spoolDeploymentStatuses)[number];

/**
 * Per-tenant orrn-spool deployment record.
 *
 * Each row represents a single spool instance provisioned for a company.
 * The shared secret is stored hashed (SHA-256) for verification and
 * AES-GCM wrapped (via @orrn/crypto) so the server can sign outgoing
 * API calls to the spool.
 *
 * Cloudflare Tunnel tokens are also wrapped at rest.
 */
export const spoolDeployment = sqliteTable(
  "spool_deployment",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull().unique(),
    status: text("status", { enum: spoolDeploymentStatuses })
      .notNull()
      .default("pending"),
    subdomain: text("subdomain").notNull().unique(),
    spoolDomain: text("spool_domain").notNull().unique(),
    /** Cloudflare Tunnel UUID. */
    cfTunnelId: text("cf_tunnel_id"),
    /** AES-GCM wrapped Cloudflare Tunnel token (encrypted with ORRN_MASTER_KEY). */
    cfTunnelTokenWrapped: text("cf_tunnel_token_wrapped").notNull(),
    /** SHA-256 hex digest of the raw shared secret — used for lookup/verification. */
    sharedSecretHash: text("shared_secret_hash").notNull(),
    /** AES-GCM wrapped shared secret — unwrapped at runtime to sign outgoing requests. */
    sharedSecretWrapped: text("shared_secret_wrapped").notNull(),
    /** Latest known spool version, updated on heartbeat. */
    spoolVersion: text("spool_version"),
    /** Last successful heartbeat from the spool instance. */
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("spool_deployment_company_idx").on(table.companyId),
    index("spool_deployment_company_status_idx").on(table.companyId, table.status),
    uniqueIndex("spool_deployment_instance_id_unique").on(table.instanceId),
    uniqueIndex("spool_deployment_subdomain_unique").on(table.subdomain),
    uniqueIndex("spool_deployment_spool_domain_unique").on(table.spoolDomain),
  ],
);

export const spoolDeploymentRelations = relations(spoolDeployment, ({ one }) => ({
  company: one(company, {
    fields: [spoolDeployment.companyId],
    references: [company.id],
  }),
}));