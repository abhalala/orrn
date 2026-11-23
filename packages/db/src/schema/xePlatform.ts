import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company, companyRoles, membership } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * XE PLATFORM (lane PLATFORM, migration 0066).
 *
 * - `custom_role`: a copy of one fixed role (never the owner) with plant actions switched on or off. Its base
 *   never changes after it is made; `added` / `removed` are action keys (`lib/permissions.ts` `effectiveActions`).
 * - `membership_custom_role`: which members hold a custom role. A member holding one has `membership.role` equal to
 *   the role's base. A separate table so `membership` itself is unchanged.
 * - `api_token`: a plant API token (opt-in module `api`). Shown once; stored as SHA-256(salt + secret).
 * - `api_rate`: one row per token per minute, the rate limit counter.
 * - `webhook_endpoint`: an https URL the plant registered, its events, and its signing secret (AES-GCM wrapped
 *   with ORRN_MASTER_KEY, because signing needs the secret back).
 * - `webhook_delivery`: the outbox. A row is written in the same batch as the event; the cron and `waitUntil`
 *   deliver it.
 */

export const customRole = sqliteTable(
  "custom_role",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lower-cased trimmed name, for the one-name-per-plant rule. */
    nameKey: text("name_key").notNull(),
    baseRole: text("base_role", { enum: companyRoles }).notNull(),
    added: text("added", { mode: "json" }).$type<string[]>().notNull().default([]),
    removed: text("removed", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("custom_role_company_name_idx").on(table.companyId, table.nameKey),
    index("custom_role_company_idx").on(table.companyId, table.id),
  ],
);

export const membershipCustomRole = sqliteTable(
  "membership_custom_role",
  {
    membershipId: text("membership_id")
      .primaryKey()
      .references(() => membership.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    customRoleId: text("custom_role_id")
      .notNull()
      .references(() => customRole.id, { onDelete: "restrict" }),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("membership_custom_role_role_idx").on(table.companyId, table.customRoleId)],
);

export const API_SCOPES = ["orders.read", "stock.read", "dispatch.read", "invoices.read", "prices.read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiToken = sqliteTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<ApiScope[]>().notNull().default([]),
    /** Random per token, hex. The hash is SHA-256(salt + ":" + secret), hex. */
    salt: text("salt").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** The first characters of the secret, shown in the list so a person can tell tokens apart. */
    hint: text("hint").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("api_token_company_idx").on(table.companyId, table.createdAt)],
);

export const apiRate = sqliteTable(
  "api_rate",
  {
    tokenId: text("token_id")
      .notNull()
      .references(() => apiToken.id, { onDelete: "cascade" }),
    /** Unix minute (ms / 60000, floored). */
    minute: integer("minute").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tokenId, table.minute] })],
);

export const WEBHOOK_EVENTS = ["order.confirmed", "dispatch.done", "invoice.issued", "stock.adjusted"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookEndpoint = sqliteTable(
  "webhook_endpoint",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events", { mode: "json" }).$type<WebhookEvent[]>().notNull().default([]),
    secretWrapped: text("secret_wrapped").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("webhook_endpoint_company_idx").on(table.companyId, table.active)],
);

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const webhookDelivery = sqliteTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: "cascade" }),
    event: text("event", { enum: WEBHOOK_EVENTS }).notNull(),
    /** Thin JSON body: ids, numbers and status only, never rates. */
    payload: text("payload").notNull(),
    status: text("status", { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** A claim by one drainer, so two drains never send the same row at once. */
    claimedUntil: integer("claimed_until", { mode: "timestamp_ms" }),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("webhook_delivery_due_idx").on(table.status, table.nextAttemptAt),
    index("webhook_delivery_company_idx").on(table.companyId, table.endpointId, table.createdAt),
  ],
);
