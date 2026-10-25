import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { dieInstance } from "./dies";
import { cast } from "./foundry";
import { approval } from "./approval";
import { reasonCode } from "./reasons";
import { salesOrderLine } from "./sales";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Press lines, press plans, press runs and the die issue (Wave 1 contracts; ledger D6: the plan
 * tables and release land now so the press queue has rows). State rules: `@orrn/domain`
 * (`pressRun.ts`, `dieRoom.ts`). Wave 2 contracts (migration 0028) add run lines, billets, QC rows,
 * downtime, remarks, plan purpose (PR-23), late entry (PR-24) and queue order (PR-25).
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

/**
 * FP-PR-23: what a plan presses for. `production` lines name sales order lines; `die_trial`,
 * `sample` and `other` need no order line (good kg goes to plant stock, rejects to plant scrap,
 * baki never moves) and show as their own rows on the press report.
 */
export const pressPlanPurposes = ["production", "die_trial", "sample", "other"] as const;
export type PressPlanPurposeColumn = (typeof pressPlanPurposes)[number];

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
    purpose: text("purpose", { enum: pressPlanPurposes }).notNull().default(sql`'production'`),
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
/** Die trial outcome (FP-PR-23 / DR-17): pass makes an `on_trial` copy available. */
export const pressRunTrialResults = ["pass", "fail"] as const;

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
    /**
     * Discard (butt) kg is `discard_g`; `ends_g` section ends; `reject_g` = Σ qc_entry kg. Wave 2:
     * FP-PR-24 run entered after the fact by a supervisor (approval `press_late_entry`, subject =
     * run id; billets still debit the cast). `late_entry_approval_id` = the approval that cleared it.
     */
    lateEntry: integer("late_entry", { mode: "boolean" }).notNull().default(sql`0`),
    lateEntryApprovalId: text("late_entry_approval_id").references(() => approval.id, { onDelete: "set null" }),
    /** Offline-tolerant create (FP-PR-19 / PR-24): the client's id for the write that made the run. */
    clientMutationId: text("client_mutation_id"),
    /** FP-PR-25 queue order on the line among queued / die_issued runs (lower first; null = by number). */
    queuePos: integer("queue_pos"),
    /** Plan purpose `die_trial`: the supervisor's verdict at close (pass | fail). */
    trialResult: text("trial_result", { enum: pressRunTrialResults }),
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
    /**
     * D22 (0030_press_fixes): grams of the weighed billets the cast's store could not cover at the
     * close (0 when it could; null until logged). The ledger still debits the full weighed kg; the
     * cast shows Σ of its logged runs as "billets short by N kg" for the foundry close-out.
     */
    billetShortG: integer("billet_short_g"),
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
    index("press_run_company_line_queue_idx").on(table.companyId, table.pressLineId, table.queuePos),
    uniqueIndex("press_run_company_mutation_unique")
      .on(table.companyId, table.clientMutationId)
      .where(sql`${table.clientMutationId} IS NOT NULL`),
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
    /**
     * 1 when the copy was `on_trial` as it went out (FP-DR-17, migration 0029). Return and cancel read
     * it: a trial issue comes back `on_trial` unless its run is logged with a passed trial.
     */
    trial: integer("trial").notNull().default(0),
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

// ---------------------------------------------------------------------------
// Wave 2 (press): rows under a run. Written while the run is `counting` (press.run); the close
// (press.close) reads them in one batch. Never edited after `logged` (reopen first).
// ---------------------------------------------------------------------------

/** Most billet rows on one run (spec PR §4 close gates). */
export const PRESS_BILLET_ROWS_MAX = 10;

/**
 * Pieces by cut length (FP-PR-08). One row per cut length (and order line) pressed. `good_g` =
 * weighed good kg of those pieces. `press_plan_line_id` / `sales_order_line_id` name the order line
 * the pieces count toward ("pressed" on the order, FP-PR-16); both null for trial / sample runs.
 */
export const pressRunLine = sqliteTable(
  "press_run_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressRunId: text("press_run_id")
      .notNull()
      .references(() => pressRun.id, { onDelete: "cascade" }),
    /** 1, 2, 3 … within the run. */
    line: integer("line").notNull(),
    pressPlanLineId: text("press_plan_line_id").references(() => pressPlanLine.id, { onDelete: "set null" }),
    salesOrderLineId: text("sales_order_line_id").references(() => salesOrderLine.id),
    cutLengthMm: integer("cut_length_mm").notNull(),
    pcs: integer("pcs").notNull(),
    goodG: integer("good_g").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_run_line_run_line_unique").on(table.pressRunId, table.line),
    index("press_run_line_company_run_idx").on(table.companyId, table.pressRunId),
    index("press_run_line_company_so_line_idx").on(table.companyId, table.salesOrderLineId),
    index("press_run_line_company_plan_line_idx").on(table.companyId, table.pressPlanLineId),
  ],
);

/**
 * Billets by cast and length (FP-PR-07), at most `PRESS_BILLET_ROWS_MAX` per run. Every row's cast
 * must be the run's cast at close. Σ kg is the run's `input_g`; the close posts −input_g of item
 * `billet` (item_ref = cast id) at the BILLET location (voucher `press_run`).
 */
export const pressBilletUse = sqliteTable(
  "press_billet_use",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressRunId: text("press_run_id")
      .notNull()
      .references(() => pressRun.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id),
    /** Billet length, mm (null = not measured). */
    lengthMm: integer("length_mm"),
    count: integer("count").notNull(),
    kgG: integer("kg_g").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_billet_use_run_line_unique").on(table.pressRunId, table.line),
    index("press_billet_use_company_run_idx").on(table.companyId, table.pressRunId),
    index("press_billet_use_company_cast_idx").on(table.companyId, table.castId),
  ],
);

/**
 * QC rows of a run (FP-PR-09, C38): children of the counting step, never a standalone QC document.
 * At least one per run at close; a zero row (pcs 0, kg 0, no reason) says "no rejects". A positive
 * reject needs a `qc_reject` reason code; a code that requires a note (`other`) needs `note`.
 */
export const qcEntry = sqliteTable(
  "qc_entry",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressRunId: text("press_run_id")
      .notNull()
      .references(() => pressRun.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    /** The cut length the rejects came from (optional). */
    pressRunLineId: text("press_run_line_id").references(() => pressRunLine.id, { onDelete: "set null" }),
    /** `reason_code` of kind `qc_reject`; null only on a zero row. */
    reasonCodeId: text("reason_code_id").references(() => reasonCode.id),
    pcs: integer("pcs").notNull().default(sql`0`),
    kgG: integer("kg_g").notNull().default(sql`0`),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("qc_entry_run_line_unique").on(table.pressRunId, table.line),
    index("qc_entry_company_run_idx").on(table.companyId, table.pressRunId),
    index("qc_entry_company_reason_idx").on(table.companyId, table.reasonCodeId),
  ],
);

/**
 * Downtime on a press line (FP-PR-12): rows, never a run state. `reason_code` kind `downtime`.
 * Start / stop are server time. One open downtime per line; the run's close needs every downtime
 * of the run stopped. `press_run_id` null = the line stood with no run (no_order, power).
 */
export const pressDowntime = sqliteTable(
  "press_downtime",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressLineId: text("press_line_id")
      .notNull()
      .references(() => pressLine.id),
    pressRunId: text("press_run_id").references(() => pressRun.id, { onDelete: "cascade" }),
    reasonCodeId: text("reason_code_id")
      .notNull()
      .references(() => reasonCode.id),
    note: text("note"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    stoppedAt: integer("stopped_at", { mode: "timestamp_ms" }),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    stoppedBy: text("stopped_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("press_downtime_line_open_unique")
      .on(table.pressLineId)
      .where(sql`${table.stoppedAt} IS NULL`),
    index("press_downtime_company_run_idx").on(table.companyId, table.pressRunId),
    index("press_downtime_company_line_started_idx").on(table.companyId, table.pressLineId, table.startedAt),
  ],
);

/**
 * Remarks (FP-PR-15), bound to the run AND the copy it pressed. A press remark is about the run
 * (shown on the run and the report); a die remark is about the copy (shown on the die card,
 * newest first). `press_run.press_remark` / `die_remark` keep the latest text as a snapshot for
 * the report and the die card list (written by the same batch that inserts the row).
 */
export const pressRemark = sqliteTable(
  "press_remark",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    pressRunId: text("press_run_id")
      .notNull()
      .references(() => pressRun.id, { onDelete: "cascade" }),
    dieInstanceId: text("die_instance_id").references(() => dieInstance.id),
    body: text("body").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("press_remark_company_run_idx").on(table.companyId, table.pressRunId, table.createdAt),
    index("press_remark_company_copy_idx").on(table.companyId, table.dieInstanceId, table.createdAt),
  ],
);

export const dieRemark = sqliteTable(
  "die_remark",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    /** The run it was written on (null = written on the die card itself). */
    pressRunId: text("press_run_id").references(() => pressRun.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("die_remark_company_copy_idx").on(table.companyId, table.dieInstanceId, table.createdAt),
    index("die_remark_company_run_idx").on(table.companyId, table.pressRunId),
  ],
);

export type PressLineRow = typeof pressLine.$inferSelect;
export type PressPlanRow = typeof pressPlan.$inferSelect;
export type PressPlanDieRow = typeof pressPlanDie.$inferSelect;
export type PressPlanLineRow = typeof pressPlanLine.$inferSelect;
export type PressRunRow = typeof pressRun.$inferSelect;
export type DieIssueRow = typeof dieIssue.$inferSelect;
export type PressRunLineRow = typeof pressRunLine.$inferSelect;
export type PressBilletUseRow = typeof pressBilletUse.$inferSelect;
export type QcEntryRow = typeof qcEntry.$inferSelect;
export type PressDowntimeRow = typeof pressDowntime.$inferSelect;
export type PressRemarkRow = typeof pressRemark.$inferSelect;
export type DieRemarkRow = typeof dieRemark.$inferSelect;
