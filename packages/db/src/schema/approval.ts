import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Submits that need a second person (spec P9 "approve" cells):
 * - dc_note: debit/credit note on a short-weighed scrap lot (manager approves).
 * - cast_close: closing a cast whose tail is not explained (foundry/manager).
 * - die_rerank: die room proposes a tier change (manager approves).
 * - dispatch_overdraw: dispatching past an SO line's balance (manager override).
 * - phantom_void: voiding bundles not found at a stock count (manager approves).
 */
export const approvalKinds = [
  "dc_note",
  "cast_close",
  "die_rerank",
  "dispatch_overdraw",
  "phantom_void",
  // Wave 1 (FP). die_owner_override: subject = die copy id; meta { attemptedCustomerId, purpose:
  // plan|press|pack|dispatch, closedAt }. order_reallocate: subject = request id; meta { bundleIds,
  // fromLineIds, toLineId, kgG, reasonCode? } (no rates). press_time / press_reopen: subject = run id.
  // ageing_override: subject = ageing batch id (Wave 3).
  "die_owner_override",
  "order_reallocate",
  "press_time",
  "press_reopen",
  "ageing_override",
  // Wave 2 (FP-PR-24): a press run entered after the fact; subject = run id; meta { reason,
  // productionDay, shiftSeq }. Approvers owner, supervisor, manager; never the requester.
  "press_late_entry",
] as const;
export const approvalStatuses = ["pending", "approved", "rejected"] as const;

export type ApprovalKind = (typeof approvalKinds)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const approval = sqliteTable(
  "approval",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: approvalKinds }).notNull(),
    /** Id of the document awaiting the decision (D/C note, cast, die tier change, dispatch, bundle/count). */
    subjectId: text("subject_id").notNull(),
    status: text("status", { enum: approvalStatuses }).notNull().default("pending"),
    /** Why the requester needs the approval (e.g. the unexplained cast tail). */
    requestNote: text("request_note"),
    /** Kind-specific numbers for the approver (kg differences, tolerance, from/to tier). */
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** The creator of the request (this table's `created_by`). */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    /** The approver's note on the decision. */
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("approval_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("approval_company_subject_idx").on(table.companyId, table.kind, table.subjectId),
    index("approval_company_server_seq_idx").on(table.companyId, table.serverSeq),
    // At most one open request per subject and kind.
    uniqueIndex("approval_company_pending_unique")
      .on(table.companyId, table.kind, table.subjectId)
      .where(sql`${table.status} = 'pending'`),
  ],
);
