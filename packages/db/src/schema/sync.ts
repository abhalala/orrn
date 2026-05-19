import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const mutationResults = ["applied", "duplicate", "conflict", "rejected"] as const;

export const companySequence = sqliteTable("company_sequence", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  value: integer("value").notNull().default(0),
});

export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    osVersion: text("os_version"),
    appVersion: text("app_version"),
    installId: text("install_id").notNull(),
    pushToken: text("push_token"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("device_company_install_unique").on(table.companyId, table.installId),
    index("device_company_user_idx").on(table.companyId, table.userId),
  ],
);

export const mutation = sqliteTable(
  "mutation",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    clientMutationId: text("client_mutation_id").notNull(),
    entity: text("entity").notNull(),
    op: text("op").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    result: text("result", { enum: mutationResults }).notNull(),
    errorCode: text("error_code"),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("mutation_idempotency_unique").on(table.companyId, table.deviceId, table.clientMutationId),
    index("mutation_company_applied_idx").on(table.companyId, table.appliedAt),
  ],
);

export type MutationResult = (typeof mutationResults)[number];
