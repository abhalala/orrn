CREATE TABLE `hr_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`shift_id` text,
	`in_at` integer,
	`out_at` integer,
	`worked_min` integer,
	`overtime_min` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`leave_request_id` text,
	`paid_leave` integer,
	`late_entry` integer DEFAULT false NOT NULL,
	`note` text,
	`marked_by` text,
	`marked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_attendance_unique` ON `hr_attendance` (`company_id`,`employee_id`,`day`);--> statement-breakpoint
CREATE INDEX `hr_attendance_company_day_idx` ON `hr_attendance` (`company_id`,`day`);--> statement-breakpoint
CREATE TABLE `hr_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`opening_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`stage` text DEFAULT 'applied' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opening_id`) REFERENCES `hr_opening`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hr_candidate_company_opening_idx` ON `hr_candidate` (`company_id`,`opening_id`);--> statement-breakpoint
CREATE TABLE `hr_checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hr_checklist_item_company_kind_idx` ON `hr_checklist_item` (`company_id`,`kind`,`sort_order`);--> statement-breakpoint
CREATE TABLE `hr_checklist_tick` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`item_id` text NOT NULL,
	`done_by` text,
	`done_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `hr_checklist_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_checklist_tick_unique` ON `hr_checklist_tick` (`company_id`,`employee_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `hr_device` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`make` text,
	`column_map` text,
	`token_hash` text,
	`active` integer DEFAULT true NOT NULL,
	`last_push_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hr_device_company_idx` ON `hr_device` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hr_device_token_unique` ON `hr_device` (`token_hash`) WHERE "hr_device"."token_hash" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `hr_employee` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`department_id` text,
	`designation_id` text,
	`joined_on` text NOT NULL,
	`dob` text,
	`kind` text DEFAULT 'permanent' NOT NULL,
	`contractor_name` text,
	`phone` text,
	`membership_id` text,
	`user_id` text,
	`device_code` text,
	`shift_id` text,
	`weekly_off_dow` integer,
	`bank_name` text,
	`bank_account_no` text,
	`bank_ifsc` text,
	`pan_last4` text,
	`aadhaar_last4` text,
	`uan` text,
	`esic_ip` text,
	`status` text DEFAULT 'active' NOT NULL,
	`left_on` text,
	`leaving_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `plant_master`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`designation_id`) REFERENCES `plant_master`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`membership_id`) REFERENCES `membership`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_employee_company_code_unique` ON `hr_employee` (`company_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `hr_employee_company_user_unique` ON `hr_employee` (`company_id`,`user_id`) WHERE "hr_employee"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `hr_employee_company_membership_unique` ON `hr_employee` (`company_id`,`membership_id`) WHERE "hr_employee"."membership_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `hr_employee_company_device_code_unique` ON `hr_employee` (`company_id`,`device_code`) WHERE "hr_employee"."device_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `hr_employee_company_status_idx` ON `hr_employee` (`company_id`,`status`,`name`);--> statement-breakpoint
CREATE TABLE `hr_holiday` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`day` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_holiday_company_day_unique` ON `hr_holiday` (`company_id`,`day`);--> statement-breakpoint
CREATE TABLE `hr_leave_kind` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`paid` integer DEFAULT true NOT NULL,
	`quota_halves` integer DEFAULT 0 NOT NULL,
	`carry_cap_halves` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_leave_kind_company_code_unique` ON `hr_leave_kind` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `hr_leave_request` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`kind_id` text NOT NULL,
	`from_day` text NOT NULL,
	`to_day` text NOT NULL,
	`half_day` integer DEFAULT false NOT NULL,
	`halves` integer NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approval_id` text,
	`requested_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kind_id`) REFERENCES `hr_leave_kind`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hr_leave_request_company_employee_idx` ON `hr_leave_request` (`company_id`,`employee_id`,`from_day`);--> statement-breakpoint
CREATE INDEX `hr_leave_request_company_status_idx` ON `hr_leave_request` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `hr_opening` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`department_id` text,
	`positions` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `plant_master`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hr_opening_company_status_idx` ON `hr_opening` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `hr_punch` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_code` text NOT NULL,
	`at` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `hr_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_punch_unique` ON `hr_punch` (`company_id`,`device_id`,`device_code`,`at`);--> statement-breakpoint
CREATE INDEX `hr_punch_company_code_at_idx` ON `hr_punch` (`company_id`,`device_code`,`at`);--> statement-breakpoint
CREATE TABLE `hr_review` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`period` text NOT NULL,
	`rating` integer NOT NULL,
	`remarks` text,
	`reviewed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hr_review_company_employee_idx` ON `hr_review` (`company_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `hr_roster` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`day` text NOT NULL,
	`shift_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_roster_unique` ON `hr_roster` (`company_id`,`employee_id`,`day`);--> statement-breakpoint
CREATE INDEX `hr_roster_company_day_idx` ON `hr_roster` (`company_id`,`day`);--> statement-breakpoint
CREATE TABLE `hr_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`effective_from` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_setting_unique` ON `hr_setting` (`company_id`,`kind`,`effective_from`);--> statement-breakpoint
CREATE TABLE `hr_settlement` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`net_paise` integer NOT NULL,
	`figures` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_settlement_company_employee_unique` ON `hr_settlement` (`company_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `hr_training` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`course` text NOT NULL,
	`day` text NOT NULL,
	`trainer` text,
	`validity_months` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hr_training_company_day_idx` ON `hr_training` (`company_id`,`day`);--> statement-breakpoint
CREATE TABLE `hr_training_person` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`training_id` text NOT NULL,
	`employee_id` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`training_id`) REFERENCES `hr_training`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_training_person_unique` ON `hr_training_person` (`company_id`,`training_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `hr_training_person_employee_idx` ON `hr_training_person` (`company_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `pay_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`amount_paise` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pay_adjustment_company_month_idx` ON `pay_adjustment` (`company_id`,`month`,`employee_id`);--> statement-breakpoint
CREATE TABLE `pay_run` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`month` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`headcount` integer DEFAULT 0 NOT NULL,
	`gross_paise` integer DEFAULT 0 NOT NULL,
	`net_paise` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approval_id` text,
	`created_by` text,
	`checked_by` text,
	`checked_at` integer,
	`locked_by` text,
	`locked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`locked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_run_company_month_unique` ON `pay_run` (`company_id`,`month`);--> statement-breakpoint
CREATE TABLE `pay_slip` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`run_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`month` text NOT NULL,
	`gross_paise` integer NOT NULL,
	`net_paise` integer NOT NULL,
	`figures` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `pay_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_slip_run_employee_unique` ON `pay_slip` (`company_id`,`run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `pay_slip_company_employee_idx` ON `pay_slip` (`company_id`,`employee_id`,`month`);--> statement-breakpoint
CREATE TABLE `pay_structure` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`basic_paise` integer NOT NULL,
	`da_paise` integer DEFAULT 0 NOT NULL,
	`hra_paise` integer DEFAULT 0 NOT NULL,
	`other_paise` integer DEFAULT 0 NOT NULL,
	`per_day` integer DEFAULT false NOT NULL,
	`pf_member` integer DEFAULT true NOT NULL,
	`pf_on_actual` integer DEFAULT false NOT NULL,
	`esic_member` integer DEFAULT true NOT NULL,
	`esic_covered` integer,
	`pt_applies` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `hr_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_structure_unique` ON `pay_structure` (`company_id`,`employee_id`,`effective_from`);