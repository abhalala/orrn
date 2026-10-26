CREATE TABLE `die_band` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`section_id` text NOT NULL,
	`wall_tenth_mm` integer NOT NULL,
	`weight_min_g` integer NOT NULL,
	`weight_max_g` integer NOT NULL,
	`label` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_band_active_unique` ON `die_band` (`company_id`,`section_id`,`wall_tenth_mm`,`weight_min_g`,`weight_max_g`) WHERE "die_band"."active" = 1;--> statement-breakpoint
CREATE INDEX `die_band_company_section_idx` ON `die_band` (`company_id`,`section_id`);--> statement-breakpoint
CREATE INDEX `die_band_company_server_seq_idx` ON `die_band` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `die_file` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`section_id` text NOT NULL,
	`die_instance_id` text,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`bytes` integer NOT NULL,
	`press_drawing` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_file_company_section_idx` ON `die_file` (`company_id`,`section_id`);--> statement-breakpoint
CREATE INDEX `die_file_company_instance_idx` ON `die_file` (`company_id`,`die_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `die_file_press_drawing_unique` ON `die_file` (`company_id`,`section_id`) WHERE "die_file"."press_drawing" = 1;--> statement-breakpoint
CREATE TABLE `die_maker` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`phone` text,
	`city` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_maker_company_name_key_unique` ON `die_maker` (`company_id`,`name_key`) WHERE "die_maker"."status" = 'active';--> statement-breakpoint
CREATE INDEX `die_maker_company_server_seq_idx` ON `die_maker` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `die_maker_job` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`die_instance_id` text NOT NULL,
	`die_maker_id` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` integer NOT NULL,
	`received_at` integer,
	`note` text,
	`created_by` text,
	`received_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`die_maker_id`) REFERENCES `die_maker`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`received_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_maker_job_company_number_unique` ON `die_maker_job` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `die_maker_job_open_unique` ON `die_maker_job` (`die_instance_id`) WHERE "die_maker_job"."status" = 'sent';--> statement-breakpoint
CREATE INDEX `die_maker_job_company_instance_idx` ON `die_maker_job` (`company_id`,`die_instance_id`);--> statement-breakpoint
CREATE INDEX `die_maker_job_company_server_seq_idx` ON `die_maker_job` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `transporter` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transporter_company_name_idx` ON `transporter` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `transporter_company_server_seq_idx` ON `transporter` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `pack_reject` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`group_id` text NOT NULL,
	`ageing_row_id` text,
	`die_id` text NOT NULL,
	`pcs` integer NOT NULL,
	`weight_g` integer,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `bundle_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pack_reject_company_created_idx` ON `pack_reject` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pack_reject_company_die_idx` ON `pack_reject` (`company_id`,`die_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pack_reject_company_group_idx` ON `pack_reject` (`company_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `packing_list_dispatch` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`packing_list_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`packing_list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packing_list_dispatch_list_dispatch_unique` ON `packing_list_dispatch` (`packing_list_id`,`dispatch_id`);--> statement-breakpoint
CREATE INDEX `packing_list_dispatch_company_dispatch_idx` ON `packing_list_dispatch` (`company_id`,`dispatch_id`);--> statement-breakpoint
CREATE TABLE `app_release` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`version` text NOT NULL,
	`min_supported_version` text,
	`notes` text,
	`url` text,
	`published_at` integer NOT NULL,
	`published_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`published_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_release_platform_channel_version_unique` ON `app_release` (`platform`,`channel`,`version`);--> statement-breakpoint
CREATE INDEX `app_release_platform_published_idx` ON `app_release` (`platform`,`channel`,`published_at`);--> statement-breakpoint
CREATE TABLE `backup_run` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`r2_key` text,
	`bytes` integer,
	`row_count` integer,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`started_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`started_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backup_run_started_idx` ON `backup_run` (`started_at`);--> statement-breakpoint
CREATE INDEX `backup_run_company_idx` ON `backup_run` (`company_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `support_request` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`screen` text,
	`status` text DEFAULT 'open' NOT NULL,
	`reply` text,
	`replied_at` integer,
	`replied_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `support_request_company_status_idx` ON `support_request` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_request_status_idx` ON `support_request` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `die_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`press_line_id` text NOT NULL,
	`press_run_id` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`issued_at` integer NOT NULL,
	`issued_by` text,
	`returned_at` integer,
	`returned_by` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_issue_open_unique` ON `die_issue` (`die_instance_id`) WHERE "die_issue"."status" = 'issued';--> statement-breakpoint
CREATE INDEX `die_issue_company_instance_idx` ON `die_issue` (`company_id`,`die_instance_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `die_issue_company_run_idx` ON `die_issue` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `die_issue_company_line_idx` ON `die_issue` (`company_id`,`press_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `die_issue_company_server_seq_idx` ON `die_issue` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `press_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`tonnage_t` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_line_company_code_unique` ON `press_line` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `press_line_company_server_seq_idx` ON `press_line` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `press_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`press_line_id` text,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`note` text,
	`released_at` integer,
	`released_by` text,
	`closed_at` integer,
	`cancelled_at` integer,
	`cancelled_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_plan_company_number_unique` ON `press_plan` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `press_plan_company_status_idx` ON `press_plan` (`company_id`,`status`,`window_start`);--> statement-breakpoint
CREATE INDEX `press_plan_company_server_seq_idx` ON `press_plan` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `press_plan_die` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_plan_id` text NOT NULL,
	`section_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`urgent` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_plan_id`) REFERENCES `press_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_plan_die_plan_section_unique` ON `press_plan_die` (`press_plan_id`,`section_id`);--> statement-breakpoint
CREATE INDEX `press_plan_die_company_plan_idx` ON `press_plan_die` (`company_id`,`press_plan_id`);--> statement-breakpoint
CREATE TABLE `press_plan_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_plan_id` text NOT NULL,
	`press_plan_die_id` text NOT NULL,
	`sales_order_line_id` text NOT NULL,
	`cut_length_mm` integer NOT NULL,
	`pcs` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`preferred_die_instance_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_plan_id`) REFERENCES `press_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_plan_die_id`) REFERENCES `press_plan_die`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `press_plan_line_company_plan_idx` ON `press_plan_line` (`company_id`,`press_plan_id`);--> statement-breakpoint
CREATE INDEX `press_plan_line_company_so_line_idx` ON `press_plan_line` (`company_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE TABLE `press_run` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`plan_id` text,
	`press_plan_die_id` text,
	`press_line_id` text,
	`section_id` text NOT NULL,
	`die_instance_id` text,
	`shift_id` text,
	`production_day` text,
	`shift_seq` integer,
	`operator_id` text,
	`relief_operator_id` text,
	`supervisor_id` text,
	`cast_id` text,
	`die_in_at` integer,
	`die_out_at` integer,
	`started_at` integer,
	`stopped_at` integer,
	`tapped_start_at` integer,
	`tapped_stop_at` integer,
	`time_unconfirmed` integer DEFAULT false NOT NULL,
	`discard_g` integer,
	`ends_g` integer,
	`reject_g` integer,
	`input_g` integer,
	`input_weighed_g` integer,
	`good_g` integer,
	`recovery_bp` integer,
	`balance_g` integer,
	`pressed_length_mm` integer,
	`press_remark` text,
	`die_remark` text,
	`source` text DEFAULT 'typed' NOT NULL,
	`billet_short_reason` text,
	`logged_at` integer,
	`voided_at` integer,
	`void_reason_code_id` text,
	`void_note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `press_plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_plan_die_id`) REFERENCES `press_plan_die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`relief_operator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`supervisor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`void_reason_code_id`) REFERENCES `reason_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_run_company_number_unique` ON `press_run` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `press_run_plan_die_live_unique` ON `press_run` (`press_plan_die_id`) WHERE "press_run"."status" <> 'voided' AND "press_run"."press_plan_die_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `press_run_line_running_unique` ON `press_run` (`press_line_id`) WHERE "press_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX `press_run_company_status_idx` ON `press_run` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `press_run_company_line_idx` ON `press_run` (`company_id`,`press_line_id`,`status`);--> statement-breakpoint
CREATE INDEX `press_run_company_plan_idx` ON `press_run` (`company_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `press_run_company_instance_idx` ON `press_run` (`company_id`,`die_instance_id`);--> statement-breakpoint
CREATE INDEX `press_run_company_day_idx` ON `press_run` (`company_id`,`production_day`);--> statement-breakpoint
CREATE INDEX `press_run_company_server_seq_idx` ON `press_run` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `reason_code` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`requires_note` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reason_code_company_kind_code_unique` ON `reason_code` (`company_id`,`kind`,`code`);--> statement-breakpoint
CREATE INDEX `reason_code_company_kind_idx` ON `reason_code` (`company_id`,`kind`,`active`);--> statement-breakpoint
CREATE INDEX `reason_code_company_server_seq_idx` ON `reason_code` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `bundle_transfer` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`bundle_id` text NOT NULL,
	`from_sales_order_line_id` text,
	`to_sales_order_line_id` text,
	`batch_id` text NOT NULL,
	`reason` text NOT NULL,
	`reason_code` text,
	`length_mismatch` integer DEFAULT 0 NOT NULL,
	`approval_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_sales_order_line_id`) REFERENCES `sales_order_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_sales_order_line_id`) REFERENCES `sales_order_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bundle_transfer_company_bundle_idx` ON `bundle_transfer` (`company_id`,`bundle_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bundle_transfer_company_batch_idx` ON `bundle_transfer` (`company_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `bundle_transfer_company_to_line_idx` ON `bundle_transfer` (`company_id`,`to_sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `bundle_transfer_company_server_seq_idx` ON `bundle_transfer` (`company_id`,`server_seq`);--> statement-breakpoint
DROP INDEX `packing_list_dispatch_unique`;--> statement-breakpoint
DROP INDEX `packing_list_company_code_unique`;--> statement-breakpoint
ALTER TABLE `packing_list` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `packing_list` ADD `supersedes_id` text;--> statement-breakpoint
ALTER TABLE `packing_list` ADD `combined_into_id` text;--> statement-breakpoint
ALTER TABLE `packing_list` ADD `show_branding` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `packing_list` ADD `show_original_so` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `packing_list_dispatch_idx` ON `packing_list` (`dispatch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `packing_list_company_code_revision_unique` ON `packing_list` (`company_id`,`code`,`revision`);--> statement-breakpoint
DROP INDEX `doc_series_company_type_period_unique`;--> statement-breakpoint
ALTER TABLE `doc_series` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `doc_series_company_type_period_scope_unique` ON `doc_series` (`company_id`,`doc_type`,`period`,`scope`);--> statement-breakpoint
ALTER TABLE `die` ADD `alloy` text;--> statement-breakpoint
ALTER TABLE `die` ADD `temper` text;--> statement-breakpoint
ALTER TABLE `die` ADD `profile_kind` text;--> statement-breakpoint
ALTER TABLE `die` ADD `owner_customer_id` text REFERENCES customer(id);--> statement-breakpoint
ALTER TABLE `die` ADD `cavity_count` integer;--> statement-breakpoint
ALTER TABLE `die` ADD `drawing_key` text;--> statement-breakpoint
ALTER TABLE `die` ADD `wall_tenth_mm` integer;--> statement-breakpoint
CREATE INDEX `die_company_owner_idx` ON `die` (`company_id`,`owner_customer_id`);--> statement-breakpoint
ALTER TABLE `customer` ADD `bundle_number_policy` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `band_id` text REFERENCES die_band(id);--> statement-breakpoint
ALTER TABLE `die_instance` ADD `owner_customer_id` text REFERENCES customer(id);--> statement-breakpoint
ALTER TABLE `die_instance` ADD `cavity_count` integer;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `bolster` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `backer_no` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `sub_bolster` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `rack_no` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `die_maker_id` text REFERENCES die_maker(id);--> statement-breakpoint
CREATE INDEX `die_instance_company_section_idx` ON `die_instance` (`company_id`,`section_id`,`status`);--> statement-breakpoint
CREATE INDEX `die_instance_company_owner_idx` ON `die_instance` (`company_id`,`owner_customer_id`);--> statement-breakpoint
ALTER TABLE `die_tier_change` ADD `from_band_id` text REFERENCES die_band(id);--> statement-breakpoint
ALTER TABLE `die_tier_change` ADD `to_band_id` text REFERENCES die_band(id);--> statement-breakpoint
ALTER TABLE `die_tier_change` ADD `is_lift` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `transporter_id` text REFERENCES transporter(id);--> statement-breakpoint
ALTER TABLE `dispatch` ADD `transporter_name` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `vehicle_capacity_g` integer;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `capacity_override_reason` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `ageing_row_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `packed_sales_order_line_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `party_no` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `recut` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bundle` ADD `weight_source` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `weight_override_reason` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `scale_reading_g` integer;--> statement-breakpoint
ALTER TABLE `bundle` ADD `bis_standard` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `cml_no` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `show_logo` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `bundle_company_party_no_idx` ON `bundle` (`company_id`,`party_no`);--> statement-breakpoint
CREATE INDEX `bundle_company_instance_idx` ON `bundle` (`company_id`,`die_instance_id`);--> statement-breakpoint
CREATE INDEX `bundle_company_ageing_row_idx` ON `bundle` (`company_id`,`ageing_row_id`);--> statement-breakpoint
ALTER TABLE `bundle_group` ADD `ageing_batch_id` text;--> statement-breakpoint
ALTER TABLE `bundle_group` ADD `die_instance_id` text;--> statement-breakpoint
ALTER TABLE `packing_list_line` ADD `party_no` text;--> statement-breakpoint
ALTER TABLE `packing_list_line` ADD `kg_per_12ft_milli` integer;--> statement-breakpoint
ALTER TABLE `packing_list_line` ADD `profile_kind` text;--> statement-breakpoint
ALTER TABLE `packing_list_line` ADD `sales_order_code` text;--> statement-breakpoint
ALTER TABLE `packing_list_line` ADD `packed_sales_order_code` text;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `expected_date` text;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `finish` text;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `source` text DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `confirmed_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `sales_order` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `closed_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `sales_order` ADD `close_reason` text;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `sales_order` ADD `cancelled_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `sales_order` ADD `cancel_reason` text;--> statement-breakpoint
CREATE INDEX `sales_order_company_customer_po_idx` ON `sales_order` (`company_id`,`customer_id`,`po_number`);--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `die_instance_id` text REFERENCES die_instance(id);--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `tier_rank` integer;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `qty_basis` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `implied_g` integer;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `weight_basis` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `band_start_milli` integer;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `copy_milli` integer;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `reading_id` text REFERENCES die_weight_reading(id);--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `basis_note` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `alloy` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `temper` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `rate_paise` integer;--> statement-breakpoint
ALTER TABLE `device` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `device` ADD `revoked_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `device` ADD `label` text;--> statement-breakpoint
-- Ledger D7: "oblique" is the die-copy suffix, not a dimension. Keep any stored value in the note
-- before the column goes.
UPDATE `die` SET `notes` = CASE WHEN `notes` IS NULL OR trim(`notes`) = '' THEN 'Oblique (legacy): ' || `oblique_mm` || ' mm' ELSE `notes` || char(10) || 'Oblique (legacy): ' || `oblique_mm` || ' mm' END WHERE `oblique_mm` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `die` DROP COLUMN `oblique_mm`;
