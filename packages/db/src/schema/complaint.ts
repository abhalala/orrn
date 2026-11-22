import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { customer } from "./customers";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Complaint register (XE parity lane REG, rows #18 and #34, migration 0056). A complaint is raised
 * against ONE bundle, by plant staff (bundle page or QR scan) or by the party from the portal. The
 * trace (cast, press run, die copy, ageing batch, packing list) is read at open time and frozen in
 * `trace_json`, so the record keeps what was true when the customer complained. Status moves only
 * through `complaintNext` in `@orrn/domain` (open -> investigating -> replied -> closed). Numbers come
 * from the doc series (`complaint`, `CMP-n` per financial year). The investigation (#34: root cause,
 * corrective action, who and by when) lives on the same row.
 */
export const complaintStatuses = ["open", "investigating", "replied", "closed"] as const;
export type ComplaintStatus = (typeof complaintStatuses)[number];
export const complaintSources = ["staff", "portal"] as const;
export const complaintKinds = ["dimension", "surface", "hardness", "bend", "weight", "packing", "short_supply", "other"] as const;
export type ComplaintKind = (typeof complaintKinds)[number];

export const complaint = sqliteTable(
  "complaint",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    status: text("status", { enum: complaintStatuses }).notNull().default("open"),
    source: text("source", { enum: complaintSources }).notNull(),
    kind: text("kind", { enum: complaintKinds }).notNull(),
    // App-enforced, like bundle.cast_id: a complaint never blocks anything about the bundle.
    bundleId: text("bundle_id").notNull(),
    customerId: text("customer_id").references(() => customer.id, { onDelete: "set null" }),
    dispatchId: text("dispatch_id"),
    description: text("description").notNull(),
    affectedPcs: integer("affected_pcs"),
    traceJson: text("trace_json", { mode: "json" }).$type<Record<string, unknown>>(),
    reply: text("reply"),
    repliedAt: integer("replied_at", { mode: "timestamp_ms" }),
    repliedBy: text("replied_by").references(() => user.id, { onDelete: "set null" }),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
    actionOwnerId: text("action_owner_id").references(() => user.id, { onDelete: "set null" }),
    /** Company day `YYYY-MM-DD` the corrective action is due. */
    actionDue: text("action_due"),
    actionDoneAt: integer("action_done_at", { mode: "timestamp_ms" }),
    investigatedBy: text("investigated_by").references(() => user.id, { onDelete: "set null" }),
    investigatedAt: integer("investigated_at", { mode: "timestamp_ms" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    closeNote: text("close_note"),
    portalUserId: text("portal_user_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("complaint_company_number_unique").on(table.companyId, table.period, table.number),
    index("complaint_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("complaint_company_bundle_idx").on(table.companyId, table.bundleId),
    index("complaint_company_customer_idx").on(table.companyId, table.customerId, table.createdAt),
  ],
);

export type ComplaintRow = typeof complaint.$inferSelect;
