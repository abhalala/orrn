import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { plantMaster } from "./admin";
import { approval } from "./approval";
import { user } from "./auth";
import { company, membership } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * XE parity lane HR (migration 0065; modules `hr` and `payroll`, both opt-in). An employee is NOT a login
 * (CONTRACTS-W3 touchpoint 1): most floor workers never sign in. `hr_employee` links optionally to a
 * membership (self-service) and to the user id press runs record (incentive). Days are `YYYY-MM-DD` in the
 * plant's time zone, months `YYYY-MM`; money is integer paise; days of leave are counted in halves.
 */

export const hrEmploymentKinds = ["permanent", "contract", "apprentice", "casual"] as const;
export const hrEmployeeStatuses = ["active", "left"] as const;

export const hrEmployee = sqliteTable(
  "hr_employee",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    departmentId: text("department_id").references(() => plantMaster.id, { onDelete: "set null" }),
    designationId: text("designation_id").references(() => plantMaster.id, { onDelete: "set null" }),
    joinedOn: text("joined_on").notNull(),
    dob: text("dob"),
    kind: text("kind", { enum: hrEmploymentKinds }).notNull().default("permanent"),
    /** Contract labour: the contractor who supplies the person. */
    contractorName: text("contractor_name"),
    phone: text("phone"),
    membershipId: text("membership_id").references(() => membership.id, { onDelete: "set null" }),
    /** The user id press runs record as operator or relief operator (incentive). */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The person's number on the biometric devices. */
    deviceCode: text("device_code"),
    /** Default shift (`company.settings.shifts[].id`) and weekly off (0 = Sunday; null = the plant rule). */
    shiftId: text("shift_id"),
    weeklyOffDow: integer("weekly_off_dow"),
    bankName: text("bank_name"),
    /** Full number, for the bank sheet only (payroll.view); lists show it masked. */
    bankAccountNo: text("bank_account_no"),
    bankIfsc: text("bank_ifsc"),
    /** Only the last four characters are ever stored. */
    panLast4: text("pan_last4"),
    aadhaarLast4: text("aadhaar_last4"),
    uan: text("uan"),
    esicIp: text("esic_ip"),
    status: text("status", { enum: hrEmployeeStatuses }).notNull().default("active"),
    leftOn: text("left_on"),
    leavingReason: text("leaving_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("hr_employee_company_code_unique").on(t.companyId, t.code),
    uniqueIndex("hr_employee_company_user_unique").on(t.companyId, t.userId).where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("hr_employee_company_membership_unique").on(t.companyId, t.membershipId).where(sql`${t.membershipId} IS NOT NULL`),
    uniqueIndex("hr_employee_company_device_code_unique").on(t.companyId, t.deviceCode).where(sql`${t.deviceCode} IS NOT NULL`),
    index("hr_employee_company_status_idx").on(t.companyId, t.status, t.name),
  ],
);

export const hrChecklistKinds = ["joining", "leaving"] as const;

/** Plant-set checklist items for joining and leaving. Retired, never deleted. */
export const hrChecklistItem = sqliteTable(
  "hr_checklist_item",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: hrChecklistKinds }).notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("hr_checklist_item_company_kind_idx").on(t.companyId, t.kind, t.sortOrder)],
);

export const hrChecklistTick = sqliteTable(
  "hr_checklist_tick",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => hrChecklistItem.id, { onDelete: "cascade" }),
    doneBy: text("done_by").references(() => user.id, { onDelete: "set null" }),
    doneAt: integer("done_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_checklist_tick_unique").on(t.companyId, t.employeeId, t.itemId)],
);

export const hrOpeningStatuses = ["open", "closed"] as const;
export const hrCandidateStages = ["applied", "called", "interviewed", "offered", "joined", "dropped"] as const;

export const hrOpening = sqliteTable(
  "hr_opening",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    departmentId: text("department_id").references(() => plantMaster.id, { onDelete: "set null" }),
    positions: integer("positions").notNull().default(1),
    status: text("status", { enum: hrOpeningStatuses }).notNull().default("open"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("hr_opening_company_status_idx").on(t.companyId, t.status)],
);

export const hrCandidate = sqliteTable(
  "hr_candidate",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    openingId: text("opening_id")
      .notNull()
      .references(() => hrOpening.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    stage: text("stage", { enum: hrCandidateStages }).notNull().default("applied"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("hr_candidate_company_opening_idx").on(t.companyId, t.openingId)],
);

export const hrHoliday = sqliteTable(
  "hr_holiday",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_holiday_company_day_unique").on(t.companyId, t.day)],
);

/** Weekly roster: person x day x shift. `shift_id` null = weekly off that day. */
export const hrRoster = sqliteTable(
  "hr_roster",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    shiftId: text("shift_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_roster_unique").on(t.companyId, t.employeeId, t.day), index("hr_roster_company_day_idx").on(t.companyId, t.day)],
);

export const hrAttendanceStatuses = ["present", "absent", "half_day", "leave", "weekly_off", "holiday"] as const;
export const hrAttendanceSources = ["manual", "punch", "leave"] as const;

/**
 * One row per person per day. `marked_at` is the true time the row was written; a day marked later than
 * the day after is a late entry (`late_entry`, orrn's late-entry pattern: the true time is kept).
 */
export const hrAttendance = sqliteTable(
  "hr_attendance",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    status: text("status", { enum: hrAttendanceStatuses }).notNull(),
    shiftId: text("shift_id"),
    inAt: integer("in_at", { mode: "timestamp_ms" }),
    outAt: integer("out_at", { mode: "timestamp_ms" }),
    workedMin: integer("worked_min"),
    overtimeMin: integer("overtime_min").notNull().default(0),
    source: text("source", { enum: hrAttendanceSources }).notNull().default("manual"),
    leaveRequestId: text("leave_request_id"),
    paidLeave: integer("paid_leave", { mode: "boolean" }),
    lateEntry: integer("late_entry", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    markedBy: text("marked_by").references(() => user.id, { onDelete: "set null" }),
    markedAt: integer("marked_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_attendance_unique").on(t.companyId, t.employeeId, t.day), index("hr_attendance_company_day_idx").on(t.companyId, t.day)],
);

/** A biometric device. `token_hash` authenticates pushes (sha-256 of the token shown once). */
export const hrDevice = sqliteTable(
  "hr_device",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    make: text("make"),
    columnMap: text("column_map", { mode: "json" }).$type<Record<string, unknown>>(),
    tokenHash: text("token_hash"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastPushAt: integer("last_push_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("hr_device_company_idx").on(t.companyId), uniqueIndex("hr_device_token_unique").on(t.tokenHash).where(sql`${t.tokenHash} IS NOT NULL`)],
);

export const hrPunchSources = ["file", "push"] as const;

/** A raw punch. The same device, person code and time is one punch (duplicates ignored). */
export const hrPunch = sqliteTable(
  "hr_punch",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => hrDevice.id, { onDelete: "cascade" }),
    deviceCode: text("device_code").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    source: text("source", { enum: hrPunchSources }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_punch_unique").on(t.companyId, t.deviceId, t.deviceCode, t.at), index("hr_punch_company_code_at_idx").on(t.companyId, t.deviceCode, t.at)],
);

export const hrLeaveKind = sqliteTable(
  "hr_leave_kind",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    paid: integer("paid", { mode: "boolean" }).notNull().default(true),
    quotaHalves: integer("quota_halves").notNull().default(0),
    carryCapHalves: integer("carry_cap_halves").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_leave_kind_company_code_unique").on(t.companyId, t.code)],
);

export const hrLeaveStatuses = ["pending", "approved", "rejected", "cancelled"] as const;

export const hrLeaveRequest = sqliteTable(
  "hr_leave_request",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    kindId: text("kind_id")
      .notNull()
      .references(() => hrLeaveKind.id),
    fromDay: text("from_day").notNull(),
    toDay: text("to_day").notNull(),
    halfDay: integer("half_day", { mode: "boolean" }).notNull().default(false),
    halves: integer("halves").notNull(),
    reason: text("reason"),
    status: text("status", { enum: hrLeaveStatuses }).notNull().default("pending"),
    approvalId: text("approval_id").references(() => approval.id, { onDelete: "set null" }),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("hr_leave_request_company_employee_idx").on(t.companyId, t.employeeId, t.fromDay), index("hr_leave_request_company_status_idx").on(t.companyId, t.status)],
);

export const hrTraining = sqliteTable(
  "hr_training",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    course: text("course").notNull(),
    day: text("day").notNull(),
    trainer: text("trainer"),
    validityMonths: integer("validity_months").notNull().default(0),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("hr_training_company_day_idx").on(t.companyId, t.day)],
);

export const hrTrainingPerson = sqliteTable(
  "hr_training_person",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    trainingId: text("training_id")
      .notNull()
      .references(() => hrTraining.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("hr_training_person_unique").on(t.companyId, t.trainingId, t.employeeId), index("hr_training_person_employee_idx").on(t.companyId, t.employeeId)],
);

/** Performance note: a periodic review record (rating 1 to 5 and remarks). No workflow. */
export const hrReview = sqliteTable(
  "hr_review",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    rating: integer("rating").notNull(),
    remarks: text("remarks"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("hr_review_company_employee_idx").on(t.companyId, t.employeeId)],
);

export const hrSettingKinds = ["statutory", "rules", "incentive"] as const;

/**
 * Dated HR settings: statutory rates (EPF, ESIC, professional tax, bonus, gratuity), plant rules
 * (retirement age, overtime, weekly off) and the incentive rule. The row in force for a month is the
 * latest `effective_from` at or before it; with none, the defaults in `@orrn/domain` apply.
 */
export const hrSetting = sqliteTable(
  "hr_setting",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: hrSettingKinds }).notNull(),
    effectiveFrom: text("effective_from").notNull(),
    value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("hr_setting_unique").on(t.companyId, t.kind, t.effectiveFrom)],
);

/** Salary structure per person, dated by month. Every change is audited (without figures). */
export const payStructure = sqliteTable(
  "pay_structure",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    effectiveFrom: text("effective_from").notNull(),
    basicPaise: integer("basic_paise").notNull(),
    daPaise: integer("da_paise").notNull().default(0),
    hraPaise: integer("hra_paise").notNull().default(0),
    otherPaise: integer("other_paise").notNull().default(0),
    perDay: integer("per_day", { mode: "boolean" }).notNull().default(false),
    pfMember: integer("pf_member", { mode: "boolean" }).notNull().default(true),
    pfOnActual: integer("pf_on_actual", { mode: "boolean" }).notNull().default(false),
    esicMember: integer("esic_member", { mode: "boolean" }).notNull().default(true),
    /** The office's call on the contribution period (null = from the period's first run). */
    esicCovered: integer("esic_covered", { mode: "boolean" }),
    ptApplies: integer("pt_applies", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("pay_structure_unique").on(t.companyId, t.employeeId, t.effectiveFrom)],
);

export const payAdjustmentKinds = ["advance", "canteen", "other", "tds", "earning"] as const;

/** A month's deduction (advance recovery, canteen, other, TDS typed from the CA) or extra earning. */
export const payAdjustment = sqliteTable(
  "pay_adjustment",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    kind: text("kind", { enum: payAdjustmentKinds }).notNull(),
    label: text("label"),
    amountPaise: integer("amount_paise").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("pay_adjustment_company_month_idx").on(t.companyId, t.month, t.employeeId)],
);

export const payRunStatuses = ["draft", "checked", "approved", "locked"] as const;

/** A month's payroll. A locked month never changes; corrections go in the next month. */
export const payRun = sqliteTable(
  "pay_run",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    status: text("status", { enum: payRunStatuses }).notNull().default("draft"),
    headcount: integer("headcount").notNull().default(0),
    grossPaise: integer("gross_paise").notNull().default(0),
    netPaise: integer("net_paise").notNull().default(0),
    /** Bumped on every recompute, so a check or an approval names the figures it saw. */
    version: integer("version").notNull().default(1),
    approvalId: text("approval_id").references(() => approval.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    checkedBy: text("checked_by").references(() => user.id, { onDelete: "set null" }),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
    lockedBy: text("locked_by").references(() => user.id, { onDelete: "set null" }),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("pay_run_company_month_unique").on(t.companyId, t.month)],
);

/** One person's payslip in a run; `figures` is the domain `Payslip` plus names for the print. */
export const paySlip = sqliteTable(
  "pay_slip",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => payRun.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    grossPaise: integer("gross_paise").notNull(),
    netPaise: integer("net_paise").notNull(),
    figures: text("figures", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [uniqueIndex("pay_slip_run_employee_unique").on(t.companyId, t.runId, t.employeeId), index("pay_slip_company_employee_idx").on(t.companyId, t.employeeId, t.month)],
);

export const hrSettlementStatuses = ["draft", "final"] as const;

/** Full and final for a person who left. */
export const hrSettlement = sqliteTable(
  "hr_settlement",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => hrEmployee.id, { onDelete: "cascade" }),
    status: text("status", { enum: hrSettlementStatuses }).notNull().default("draft"),
    netPaise: integer("net_paise").notNull(),
    figures: text("figures", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("hr_settlement_company_employee_unique").on(t.companyId, t.employeeId)],
);
