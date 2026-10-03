import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const companyStatus = ["pending", "active", "suspended"] as const;
/**
 * Tenant roles (spec P9: the document's 12 plus `viewer`). Stored as text, so
 * adding a value needs no data migration. `admin` = plant admin, `operator` =
 * floor operator. The permission matrix lives in packages/server/src/lib/permissions.ts.
 */
export const companyRoles = [
  "owner",
  "admin",
  "manager",
  "office",
  "accountant",
  "supervisor",
  "packer",
  "foundry",
  "press",
  "storekeeper",
  "die_room",
  "operator",
  "viewer",
] as const;
/** ORRN internal staff roles (orrn.app console). */
export const platformStaffRoles = ["super_admin", "admin", "support"] as const;
export type PlatformStaffRole = (typeof platformStaffRoles)[number];
export const waitlistStatuses = ["pending", "approved", "rejected"] as const;

export const company = sqliteTable(
  "company",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: companyStatus }).notNull().default("pending"),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    auditRetentionDays: integer("audit_retention_days").notNull().default(180),
    spoolBaseUrl: text("spool_base_url"),
    spoolApiKeyWrapped: text("spool_api_key_wrapped"),
    plan: text("plan"),
    modules: text("modules", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("company_status_idx").on(table.status)],
);

export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    role: text("role", { enum: companyRoles }).notNull().default("viewer"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** Set by `company.switch`; the active company without a header is the latest of these. */
    lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // Many plants per person (spec P10, ruling RP1): one membership per (user, company).
    // Its leading user_id column also serves the per-user membership lookup.
    uniqueIndex("membership_user_company_unique").on(table.userId, table.companyId),
    index("membership_company_idx").on(table.companyId),
  ],
);

export const platformAdmin = sqliteTable("platform_admin", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: platformStaffRoles }).notNull().default("support"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
});

export const invite = sqliteTable(
  "invite",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: companyRoles }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("invite_company_idx").on(table.companyId),
    index("invite_email_idx").on(table.email),
  ],
);

export const waitlistRequest = sqliteTable(
  "waitlist_request",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email").notNull(),
    notes: text("notes"),
    status: text("status", { enum: waitlistStatuses }).notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("waitlist_status_idx").on(table.status, table.createdAt)],
);

/** Time-boxed platform-admin impersonation grants (M9). */
export const impersonationGrant = sqliteTable(
  "impersonation_grant",
  {
    id: text("id").primaryKey(),
    platformAdminId: text("platform_admin_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("impersonation_grant_admin_expires_idx").on(table.platformAdminId, table.expiresAt),
    index("impersonation_grant_company_idx").on(table.companyId),
  ],
);

export const companyRelations = relations(company, ({ many }) => ({
  memberships: many(membership),
  invites: many(invite),
}));

export const membershipRelations = relations(membership, ({ one }) => ({
  company: one(company, { fields: [membership.companyId], references: [company.id] }),
  user: one(user, { fields: [membership.userId], references: [user.id] }),
}));

export type CompanyRole = (typeof companyRoles)[number];
export type CompanyStatus = (typeof companyStatus)[number];
