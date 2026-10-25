import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { dispatch } from "./dispatch";
import { company, invite } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Customer portal (FP-PF-01..04, Wave 3; C29). A party login is NOT a membership and NOT a 14th
 * company role: it is a `customer_portal_user` row. The portal derives company + customer from this
 * row, never from input. A user may hold portal rows in several plants, but never a membership and a
 * portal row in the same plant (grant and invite acceptance refuse it; portalProcedure re-checks).
 *
 * Life: invited (office grants; the invite email carries a 7-day token) -> active (the party accepts
 * the invite, signed in with a password account) | revoked; active -> revoked -> active (office
 * grants again: straight back to active when the row already has its user).
 */
export const customerPortalUserStatuses = ["invited", "active", "revoked"] as const;
export type CustomerPortalUserStatus = (typeof customerPortalUserStatuses)[number];

export const customerPortalUser = sqliteTable(
  "customer_portal_user",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** Lower-cased invite address; one portal row per address per plant. */
    email: text("email").notNull(),
    /** Null until the invite is accepted (the account may not exist yet). */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: customerPortalUserStatuses }).notNull().default("invited"),
    /** The live invite (kind `portal`) whose token activates this row; the token hash lives on `invite`. */
    inviteId: text("invite_id").references(() => invite.id, { onDelete: "set null" }),
    invitedAt: integer("invited_at", { mode: "timestamp_ms" }),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("customer_portal_user_company_email_unique").on(table.companyId, table.email),
    // One portal row per (plant, user): a party login belongs to one customer in a plant.
    uniqueIndex("customer_portal_user_company_user_unique").on(table.companyId, table.userId),
    index("customer_portal_user_company_customer_idx").on(table.companyId, table.customerId, table.status),
    index("customer_portal_user_user_idx").on(table.userId, table.status),
  ],
);

/**
 * Catalogue dies (sections) a party may see and order beyond the ones it owns. Not an ownership
 * lock: the die-room owner columns are the lock, and a grant never shows a copy another customer
 * owns. Revoke stamps `revoked_at` (history kept); a new grant inserts a new row. At most one live
 * grant per (company, customer, section).
 */
export const customerPortalSection = sqliteTable(
  "customer_portal_section",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** The section (catalogue `die` row). */
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("customer_portal_section_live_unique")
      .on(table.companyId, table.customerId, table.dieId)
      .where(sql`${table.revokedAt} is null`),
    index("customer_portal_section_company_customer_idx").on(table.companyId, table.customerId),
  ],
);

/** How much chemistry the certificate could cite when it was issued (foundry may not have it yet). */
export const testCertificateChemistry = ["pending", "partial", "ready"] as const;
export type TestCertificateChemistry = (typeof testCertificateChemistry)[number];

/**
 * Party test certificate (FP-PF-04, C30): a frozen snapshot per completed dispatch. Number `TC/{FY}/n`
 * from `doc_series` type `cert`; a re-issue keeps the number and adds a revision (old rows kept).
 * The snapshot carries no rate, no party-vs-FC kg and no cast numbers (Q39 extended; see
 * routers/portal.ts). Not a tax document.
 */
export const testCertificate = sqliteTable(
  "test_certificate",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatch.id, { onDelete: "restrict" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** The packing list revision the certificate was issued against (null when none existed). */
    packingListId: text("packing_list_id"),
    period: text("period").notNull(),
    number: text("number").notNull(),
    revision: integer("revision").notNull().default(1),
    supersedesId: text("supersedes_id"),
    chemistry: text("chemistry", { enum: testCertificateChemistry }).notNull().default("pending"),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("test_certificate_company_number_revision_unique").on(table.companyId, table.number, table.revision),
    index("test_certificate_company_dispatch_idx").on(table.companyId, table.dispatchId, table.revision),
    index("test_certificate_company_customer_idx").on(table.companyId, table.customerId),
  ],
);

export type CustomerPortalUserRow = typeof customerPortalUser.$inferSelect;
export type CustomerPortalSectionRow = typeof customerPortalSection.$inferSelect;
export type TestCertificateRow = typeof testCertificate.$inferSelect;
