CREATE TABLE `alloy` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alloy_company_code_unique` ON `alloy` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `alloy_company_server_seq_idx` ON `alloy` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `alloy_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`alloy_id` text NOT NULL,
	`element` text NOT NULL,
	`min_ppm` integer,
	`max_ppm` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alloy_id`) REFERENCES `alloy`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alloy_limit_alloy_element_unique` ON `alloy_limit` (`alloy_id`,`element`);--> statement-breakpoint
CREATE INDEX `alloy_limit_company_alloy_idx` ON `alloy_limit` (`company_id`,`alloy_id`);--> statement-breakpoint
CREATE TABLE `furnace` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`capacity_g` integer NOT NULL,
	`billet_dia_mm` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `furnace_company_code_unique` ON `furnace` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `furnace_company_server_seq_idx` ON `furnace` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `die_remark` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`press_run_id` text,
	`body` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_remark_company_copy_idx` ON `die_remark` (`company_id`,`die_instance_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `die_remark_company_run_idx` ON `die_remark` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE TABLE `press_billet_use` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_run_id` text NOT NULL,
	`line` integer NOT NULL,
	`cast_id` text NOT NULL,
	`length_mm` integer,
	`count` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_billet_use_run_line_unique` ON `press_billet_use` (`press_run_id`,`line`);--> statement-breakpoint
CREATE INDEX `press_billet_use_company_run_idx` ON `press_billet_use` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `press_billet_use_company_cast_idx` ON `press_billet_use` (`company_id`,`cast_id`);--> statement-breakpoint
CREATE TABLE `press_downtime` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_line_id` text NOT NULL,
	`press_run_id` text,
	`reason_code_id` text NOT NULL,
	`note` text,
	`started_at` integer NOT NULL,
	`stopped_at` integer,
	`started_by` text,
	`stopped_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reason_code_id`) REFERENCES `reason_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stopped_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_downtime_line_open_unique` ON `press_downtime` (`press_line_id`) WHERE "press_downtime"."stopped_at" IS NULL;--> statement-breakpoint
CREATE INDEX `press_downtime_company_run_idx` ON `press_downtime` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `press_downtime_company_line_started_idx` ON `press_downtime` (`company_id`,`press_line_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `press_remark` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_run_id` text NOT NULL,
	`die_instance_id` text,
	`body` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `press_remark_company_run_idx` ON `press_remark` (`company_id`,`press_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `press_remark_company_copy_idx` ON `press_remark` (`company_id`,`die_instance_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `press_run_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_run_id` text NOT NULL,
	`line` integer NOT NULL,
	`press_plan_line_id` text,
	`sales_order_line_id` text,
	`cut_length_mm` integer NOT NULL,
	`pcs` integer NOT NULL,
	`good_g` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_plan_line_id`) REFERENCES `press_plan_line`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sales_order_line_id`) REFERENCES `sales_order_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_run_line_run_line_unique` ON `press_run_line` (`press_run_id`,`line`);--> statement-breakpoint
CREATE INDEX `press_run_line_company_run_idx` ON `press_run_line` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `press_run_line_company_so_line_idx` ON `press_run_line` (`company_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `press_run_line_company_plan_line_idx` ON `press_run_line` (`company_id`,`press_plan_line_id`);--> statement-breakpoint
CREATE TABLE `qc_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`press_run_id` text NOT NULL,
	`line` integer NOT NULL,
	`press_run_line_id` text,
	`reason_code_id` text,
	`pcs` integer DEFAULT 0 NOT NULL,
	`kg_g` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_run_line_id`) REFERENCES `press_run_line`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reason_code_id`) REFERENCES `reason_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qc_entry_run_line_unique` ON `qc_entry` (`press_run_id`,`line`);--> statement-breakpoint
CREATE INDEX `qc_entry_company_run_idx` ON `qc_entry` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `qc_entry_company_reason_idx` ON `qc_entry` (`company_id`,`reason_code_id`);--> statement-breakpoint
-- Wave 2 rebuilds `melt` so a draft can leave its times, LDO dips and figures empty (C18 lock).
-- `melt` has never been deployed (0020 ships with this migration), so the copy below moves no
-- rows anywhere real. Guard: the DROP would cascade-delete melt_input / melt_output /
-- melt_chemical rows (and RESTRICT on spectro_result), so refuse to run on a database that
-- already holds melts (NOT NULL failure on __w2_melt_guard.must_be_empty) instead of losing them.
CREATE TABLE `__w2_melt_guard` (`must_be_empty` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__w2_melt_guard` SELECT NULL FROM `melt` LIMIT 1;--> statement-breakpoint
DROP TABLE `__w2_melt_guard`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_melt` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`cast_id` text NOT NULL,
	`seq` integer NOT NULL,
	`alloy` text NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`furnace_id` text,
	`alloy_id` text,
	`preheat_start_at` integer,
	`charging_start_at` integer,
	`charging_end_at` integer,
	`casting_start_at` integer,
	`casting_end_at` integer,
	`ldo_start_tenth_in` integer,
	`ldo_charging_start_tenth_in` integer,
	`ldo_charging_end_tenth_in` integer,
	`ldo_casting_start_tenth_in` integer,
	`ldo_end_tenth_in` integer,
	`input_g` integer DEFAULT 0 NOT NULL,
	`logs_pcs` integer DEFAULT 0 NOT NULL,
	`logs_length_mm` integer DEFAULT 0 NOT NULL,
	`logs_g` integer DEFAULT 0 NOT NULL,
	`dross_g` integer DEFAULT 0 NOT NULL,
	`fe_g` integer DEFAULT 0 NOT NULL,
	`returns_g` integer DEFAULT 0 NOT NULL,
	`output_g` integer DEFAULT 0 NOT NULL,
	`loss_g` integer DEFAULT 0 NOT NULL,
	`loss_bp` integer DEFAULT 0 NOT NULL,
	`allowed_burn_g` integer DEFAULT 0 NOT NULL,
	`yield_bp` integer,
	`warnings` text DEFAULT '[]' NOT NULL,
	`balance_note` text,
	`spectro_reason` text,
	`notes` text,
	`client_request_id` text,
	`locked_at` integer,
	`locked_by` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alloy_id`) REFERENCES `alloy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`locked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_melt`("id", "company_id", "server_seq", "cast_id", "seq", "alloy", "preheat_start_at", "charging_start_at", "charging_end_at", "casting_start_at", "casting_end_at", "ldo_start_tenth_in", "ldo_charging_start_tenth_in", "ldo_charging_end_tenth_in", "ldo_casting_start_tenth_in", "ldo_end_tenth_in", "input_g", "logs_pcs", "logs_length_mm", "logs_g", "dross_g", "fe_g", "returns_g", "output_g", "loss_g", "loss_bp", "allowed_burn_g", "warnings", "balance_note", "notes", "client_request_id", "cancelled_at", "cancelled_by", "cancel_reason", "created_by", "created_at", "updated_at") SELECT "id", "company_id", "server_seq", "cast_id", "seq", "alloy", "preheat_start_at", "charging_start_at", "charging_end_at", "casting_start_at", "casting_end_at", "ldo_start_tenth_in", "ldo_charging_start_tenth_in", "ldo_charging_end_tenth_in", "ldo_casting_start_tenth_in", "ldo_end_tenth_in", "input_g", "logs_pcs", "logs_length_mm", "logs_g", "dross_g", "fe_g", "returns_g", "output_g", "loss_g", "loss_bp", "allowed_burn_g", "warnings", "balance_note", "notes", "client_request_id", "cancelled_at", "cancelled_by", "cancel_reason", "created_by", "created_at", "updated_at" FROM `melt`;--> statement-breakpoint
DROP TABLE `melt`;--> statement-breakpoint
ALTER TABLE `__new_melt` RENAME TO `melt`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `melt_company_cast_seq_unique` ON `melt` (`company_id`,`cast_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `melt_company_request_unique` ON `melt` (`company_id`,`client_request_id`) WHERE "melt"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX `melt_company_casting_end_idx` ON `melt` (`company_id`,`casting_end_at`);--> statement-breakpoint
CREATE INDEX `melt_company_cast_status_idx` ON `melt` (`company_id`,`cast_id`,`status`);--> statement-breakpoint
CREATE INDEX `melt_company_server_seq_idx` ON `melt` (`company_id`,`server_seq`);--> statement-breakpoint
ALTER TABLE `die_instance` ADD `maker_die_no` text;--> statement-breakpoint
ALTER TABLE `die_instance` ADD `maker_project_no` text;--> statement-breakpoint
ALTER TABLE `cast` ADD `alloy_id` text REFERENCES alloy(id);--> statement-breakpoint
ALTER TABLE `cast` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `cast` ADD `cancelled_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `cast` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `si_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `fe_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `cu_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `mn_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `mg_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `zn_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `ti_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `cr_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `al_ppm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `al_source` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `limits_snapshot` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `file_key` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `voided_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `press_plan` ADD `purpose` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `press_run` ADD `late_entry` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `press_run` ADD `late_entry_approval_id` text REFERENCES approval(id);--> statement-breakpoint
ALTER TABLE `press_run` ADD `client_mutation_id` text;--> statement-breakpoint
ALTER TABLE `press_run` ADD `queue_pos` integer;--> statement-breakpoint
ALTER TABLE `press_run` ADD `trial_result` text;--> statement-breakpoint
CREATE INDEX `press_run_company_line_queue_idx` ON `press_run` (`company_id`,`press_line_id`,`queue_pos`);--> statement-breakpoint
CREATE UNIQUE INDEX `press_run_company_mutation_unique` ON `press_run` (`company_id`,`client_mutation_id`) WHERE "press_run"."client_mutation_id" IS NOT NULL;