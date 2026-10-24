import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Platform rows (FP-PF, Wave 1 contracts). `app_release` and `backup_run` are platform-level (no
 * company scope on `app_release`; a backup run may name one company or none for the whole D1).
 * `support_request` is a tenant row: a plant user asks, platform staff reply.
 */

export const appReleaseChannels = ["stable", "beta"] as const;
export const appReleasePlatforms = ["android", "ios", "web", "edge"] as const;

/** A published app build (`platform.release.publish`). Devices compare `app_version` against it. */
export const appRelease = sqliteTable(
  "app_release",
  {
    id: text("id").primaryKey(),
    platform: text("platform", { enum: appReleasePlatforms }).notNull(),
    channel: text("channel", { enum: appReleaseChannels }).notNull().default("stable"),
    version: text("version").notNull(),
    /** Devices below this version are told to update before syncing. */
    minSupportedVersion: text("min_supported_version"),
    notes: text("notes"),
    url: text("url"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("app_release_platform_channel_version_unique").on(table.platform, table.channel, table.version),
    index("app_release_platform_published_idx").on(table.platform, table.channel, table.publishedAt),
  ],
);

export const backupRunStatuses = ["running", "succeeded", "failed"] as const;
export const backupRunKinds = ["scheduled", "manual"] as const;

/** Metadata of a D1 export to R2 (`platform.backup.run`); never the bytes. */
export const backupRun = sqliteTable(
  "backup_run",
  {
    id: text("id").primaryKey(),
    /** Null = the whole database. */
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    kind: text("kind", { enum: backupRunKinds }).notNull(),
    status: text("status", { enum: backupRunStatuses }).notNull().default("running"),
    r2Key: text("r2_key"),
    bytes: integer("bytes"),
    rowCount: integer("row_count"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("backup_run_started_idx").on(table.startedAt), index("backup_run_company_idx").on(table.companyId, table.startedAt)],
);

export const supportRequestStatuses = ["open", "answered", "closed"] as const;
export type SupportRequestStatus = (typeof supportRequestStatuses)[number];

/** A plant user's help request (`support.request`); platform staff answer (`platform.support.reply`). */
export const supportRequest = sqliteTable(
  "support_request",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** The screen the user was on (route path), for context. */
    screen: text("screen"),
    status: text("status", { enum: supportRequestStatuses }).notNull().default("open"),
    reply: text("reply"),
    repliedAt: integer("replied_at", { mode: "timestamp_ms" }),
    repliedBy: text("replied_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("support_request_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("support_request_status_idx").on(table.status, table.createdAt),
  ],
);

export type AppReleaseRow = typeof appRelease.$inferSelect;
export type BackupRunRow = typeof backupRun.$inferSelect;
export type SupportRequestRow = typeof supportRequest.$inferSelect;
