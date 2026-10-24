import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { dieInstance } from "./dies";
import { cast } from "./foundry";
import { reasonCode } from "./reasons";
import { salesOrderLine } from "./sales";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Press lines, press plans, press runs and the die issue (Wave 1 contracts; ledger D6: the plan
 * tables and release land now so the press queue has rows). State rules: `@orrn/domain`
 * (`pressRun.ts`, `dieRoom.ts`). Wave 2 (press) adds run lines, billets, downtime and QC rows.
 */

export const pressLineStatuses = ["active", "retired"] as const;

/** A press. FourCubes: one line, `P1` / `Press 1`. Retire is refused while a run on it is open. */
export const pressLine = sqliteTable(
  "press_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Whole tonnes; empty until the plant says (never a demo tonnage). */
    tonnageT: integer("tonnage_t"),
    status: text("status", { enum: pressLineStatuses }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_line_company_code_unique").on(table.companyId, table.code),
    index("press_line_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const pressPlanStatuses = ["draft", "released", "closed", "cancelled"] as const;
export type PressPlanStatusColumn = (typeof pressPlanStatuses)[number];

/** `PP-{seq}` per FY (`doc_series` type `press_plan`). Window at most 24 h. */
export const pressPlan = sqliteTable(
  "press_plan",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    status: text("status", { enum: pressPlanStatuses }).notNull().default("draft"),
    /** Null = the plant's only active line (release refuses when there are two). */
    pressLineId: text("press_line_id").references(() => pressLine.id),
    windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
    windowEnd: integer("window_end", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_plan_company_number_unique").on(table.companyId, table.period, table.number),
    index("press_plan_company_status_idx").on(table.companyId, table.status, table.windowStart),
    index("press_plan_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** One catalogue die (section) on a plan, never a copy: the die room picks the copy at issue. */
export const pressPlanDie = sqliteTable(
  "press_plan_die",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressPlanId: text("press_plan_id")
      .notNull()
      .references(() => pressPlan.id, { onDelete: "cascade" }),
    sectionId: text("section_id")
      .notNull()
      .references(() => die.id),
    /** Lower runs first. */
    sortOrder: integer("sort_order").notNull().default(0),
    urgent: integer("urgent", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("press_plan_die_plan_section_unique").on(table.pressPlanId, table.sectionId),
    index("press_plan_die_company_plan_idx").on(table.companyId, table.pressPlanId),
  ],
);

/** Quantity released to the press for one sales order line (must be <= planable). */
export const pressPlanLine = sqliteTable(
  "press_plan_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressPlanId: text("press_plan_id")
      .notNull()
      .references(() => pressPlan.id, { onDelete: "cascade" }),
    pressPlanDieId: text("press_plan_die_id")
      .notNull()
      .references(() => pressPlanDie.id, { onDelete: "cascade" }),
    salesOrderLineId: text("sales_order_line_id")
      .notNull()
      .references(() => salesOrderLine.id),
    /** Copied from the sales order line at add; never edited here. */
    cutLengthMm: integer("cut_length_mm").notNull(),
    pcs: integer("pcs").notNull(),
    kgG: integer("kg_g").notNull(),
    /** Hint copied from the order line's pinned copy; never sets `press_run.die_instance_id`. */
    preferredDieInstanceId: text("preferred_die_instance_id").references(() => dieInstance.id),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("press_plan_line_company_plan_idx").on(table.companyId, table.pressPlanId),
    index("press_plan_line_company_so_line_idx").on(table.companyId, table.salesOrderLineId),
  ],
);

/** No "ready" (integration plan §2). */
export const pressRunStatuses = ["queued", "die_issued", "running", "stopped", "counting", "logged", "voided"] as const;
export type PressRunStatusColumn = (typeof pressRunStatuses)[number];
export const pressRunSources = ["typed", "telemetry", "import"] as const;

/**
 * A press run: inserted `queued` by `plans.release` (the only insert, C7), `PR-{seq}` per FY.
 * `die_instance_id` null until the die room issues a copy. Shift is (production day, seq) plus
 * the stable `shift_id` from `company.settings.shifts[]`, never a letter (C14). Figures written
 * at log (input/good/recovery/balance) are server-computed snapshots (Wave 2, press).
 */
export const pressRun = sqliteTable(
  "press_run",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    status: text("status", { enum: pressRunStatuses }).notNull().default("queued"),
    planId: text("plan_id").references(() => pressPlan.id),
    pressPlanDieId: text("press_plan_die_id").references(() => pressPlanDie.id),
    pressLineId: text("press_line_id").references(() => pressLine.id),
    sectionId: text("section_id")
      .notNull()
      .references(() => die.id),
    dieInstanceId: text("die_instance_id").references(() => dieInstance.id),
    /** `company.settings.shifts[].id`, snapshotted at start. */
    shiftId: text("shift_id"),
    /** Production day `YYYY-MM-DD` (C15) and the shift's seq at start. */
    productionDay: text("production_day"),
    shiftSeq: integer("shift_seq"),
    operatorId: text("operator_id").references(() => user.id, { onDelete: "set null" }),
    reliefOperatorId: text("relief_operator_id").references(() => user.id, { onDelete: "set null" }),
    supervisorId: text("supervisor_id").references(() => user.id, { onDelete: "set null" }),
    castId: text("cast_id").references(() => cast.id),
    /** Die in / die out (server clock). */
    dieInAt: integer("die_in_at", { mode: "timestamp_ms" }),
    dieOutAt: integer("die_out_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    stoppedAt: integer("stopped_at", { mode: "timestamp_ms" }),
    tappedStartAt: integer("tapped_start_at", { mode: "timestamp_ms" }),
    tappedStopAt: integer("tapped_stop_at", { mode: "timestamp_ms" }),
    timeUnconfirmed: integer("time_unconfirmed", { mode: "boolean" }).notNull().default(false),
    discardG: integer("discard_g"),
    endsG: integer("ends_g"),
    rejectG: integer("reject_g"),
    inputG: integer("input_g"),
    inputWeighedG: integer("input_weighed_g"),
    goodG: integer("good_g"),
    recoveryBp: integer("recovery_bp"),
    balanceG: integer("balance_g"),
    pressedLengthMm: integer("pressed_length_mm"),
    pressRemark: text("press_remark"),
    dieRemark: text("die_remark"),
    source: text("source", { enum: pressRunSources }).notNull().default("typed"),
    billetShortReason: text("billet_short_reason"),
    loggedAt: integer("logged_at", { mode: "timestamp_ms" }),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidReasonCodeId: text("void_reason_code_id").references(() => reasonCode.id),
    voidNote: text("void_note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_run_company_number_unique").on(table.companyId, table.period, table.number),
    // One non-void run per plan die.
    uniqueIndex("press_run_plan_die_live_unique")
      .on(table.pressPlanDieId)
      .where(sql`${table.status} <> 'voided' AND ${table.pressPlanDieId} IS NOT NULL`),
    // One running run per line.
    uniqueIndex("press_run_line_running_unique")
      .on(table.pressLineId)
      .where(sql`${table.status} = 'running'`),
    index("press_run_company_status_idx").on(table.companyId, table.status),
    index("press_run_company_line_idx").on(table.companyId, table.pressLineId, table.status),
    index("press_run_company_plan_idx").on(table.companyId, table.planId),
    index("press_run_company_instance_idx").on(table.companyId, table.dieInstanceId),
    index("press_run_company_day_idx").on(table.companyId, table.productionDay),
    index("press_run_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const dieIssueStatuses = ["issued", "returned", "cancelled"] as const;
export type DieIssueStatusColumn = (typeof dieIssueStatuses)[number];

/**
 * The die room's handoff of a copy to a press line (FP-DR-16; die room owns it, `die.issue`).
 * No document number. One open issue per copy. Issue batch: this row, copy `in_use`,
 * `press_run.die_instance_id` and `queued -> die_issued` together (C6).
 */
export const dieIssue = sqliteTable(
  "die_issue",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    pressLineId: text("press_line_id")
      .notNull()
      .references(() => pressLine.id),
    pressRunId: text("press_run_id").references(() => pressRun.id),
    status: text("status", { enum: dieIssueStatuses }).notNull().default("issued"),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    returnedAt: integer("returned_at", { mode: "timestamp_ms" }),
    returnedBy: text("returned_by").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("die_issue_open_unique")
      .on(table.dieInstanceId)
      .where(sql`${table.status} = 'issued'`),
    index("die_issue_company_instance_idx").on(table.companyId, table.dieInstanceId, table.issuedAt),
    index("die_issue_company_run_idx").on(table.companyId, table.pressRunId),
    index("die_issue_company_line_idx").on(table.companyId, table.pressLineId, table.status),
    index("die_issue_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type PressLineRow = typeof pressLine.$inferSelect;
export type PressPlanRow = typeof pressPlan.$inferSelect;
export type PressPlanDieRow = typeof pressPlanDie.$inferSelect;
export type PressPlanLineRow = typeof pressPlanLine.$inferSelect;
export type PressRunRow = typeof pressRun.$inferSelect;
export type DieIssueRow = typeof dieIssue.$inferSelect;
