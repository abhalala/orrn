CREATE TABLE `ageing_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'loading' NOT NULL,
	`trolley_id` text NOT NULL,
	`oven_id` text,
	`recipe_id` text,
	`alloy` text,
	`temper` text,
	`target_temp_x10` integer,
	`tolerance_x10` integer,
	`soak_min` integer,
	`max_soak_min` integer,
	`hardness_method` text,
	`hardness_min_x10` integer,
	`hardness_max_x10` integer,
	`sample_count` integer,
	`temp_c_x10` integer,
	`shift_id` text,
	`production_day` text,
	`shift_seq` integer,
	`gas_start_milli` integer,
	`gas_end_milli` integer,
	`meter_reset` integer DEFAULT 0 NOT NULL,
	`in_at` integer,
	`out_at` integer,
	`soak_started_at` integer,
	`soak_verdict` text,
	`soak_in_band_min` integer,
	`qc_verdict` text,
	`released_at` integer,
	`released_by` text,
	`override_approval_id` text,
	`rework_of_batch_id` text,
	`disposition` text,
	`void_reason_code_id` text,
	`void_reason` text,
	`voided_at` integer,
	`voided_by` text,
	`client_mutation_id` text,
	`note` text,
	`started_by` text,
	`closed_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trolley_id`) REFERENCES `trolley`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`oven_id`) REFERENCES `ageing_oven`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipe_id`) REFERENCES `ageing_recipe`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`started_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_batch_company_number_unique` ON `ageing_batch` (`company_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_batch_trolley_open_unique` ON `ageing_batch` (`company_id`,`trolley_id`) WHERE "ageing_batch"."status" IN ('loading', 'in_oven', 'out', 'released', 'held');--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_batch_oven_in_unique` ON `ageing_batch` (`company_id`,`oven_id`) WHERE "ageing_batch"."status" = 'in_oven';--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_batch_company_client_mutation_unique` ON `ageing_batch` (`company_id`,`client_mutation_id`) WHERE "ageing_batch"."client_mutation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `ageing_batch_company_status_idx` ON `ageing_batch` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `ageing_batch_company_in_at_idx` ON `ageing_batch` (`company_id`,`in_at`);--> statement-breakpoint
CREATE INDEX `ageing_batch_company_day_idx` ON `ageing_batch` (`company_id`,`production_day`);--> statement-breakpoint
CREATE INDEX `ageing_batch_company_server_seq_idx` ON `ageing_batch` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `ageing_hardness` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`batch_id` text NOT NULL,
	`row_id` text NOT NULL,
	`method` text NOT NULL,
	`reading_x10` integer NOT NULL,
	`pass` integer NOT NULL,
	`tested_by` text,
	`tested_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `ageing_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`row_id`) REFERENCES `ageing_row`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_row_idx` ON `ageing_hardness` (`company_id`,`row_id`);--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_batch_idx` ON `ageing_hardness` (`company_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_server_seq_idx` ON `ageing_hardness` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `ageing_oven` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text,
	`capacity_g` integer,
	`max_temp_x10` integer,
	`meter_unit` text DEFAULT 'm3' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`machine_id` text,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_oven_company_code_unique` ON `ageing_oven` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `ageing_oven_company_status_idx` ON `ageing_oven` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `ageing_oven_company_server_seq_idx` ON `ageing_oven` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `ageing_recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`alloy` text NOT NULL,
	`temper` text NOT NULL,
	`kind` text DEFAULT 'full' NOT NULL,
	`target_temp_x10` integer NOT NULL,
	`tolerance_x10` integer DEFAULT 100 NOT NULL,
	`soak_min` integer NOT NULL,
	`max_soak_min` integer,
	`hardness_method` text DEFAULT 'webster' NOT NULL,
	`hardness_min_x10` integer NOT NULL,
	`hardness_max_x10` integer,
	`sample_count` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_recipe_active_unique` ON `ageing_recipe` (`company_id`,`alloy`,`temper`,`kind`) WHERE "ageing_recipe"."status" = 'active';--> statement-breakpoint
CREATE INDEX `ageing_recipe_company_status_idx` ON `ageing_recipe` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `ageing_recipe_company_server_seq_idx` ON `ageing_recipe` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `ageing_row` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`batch_id` text NOT NULL,
	`source` text DEFAULT 'press' NOT NULL,
	`press_run_id` text,
	`press_run_line_id` text,
	`bundle_id` text,
	`die_id` text NOT NULL,
	`die_instance_id` text,
	`cast_id` text,
	`sales_order_id` text,
	`sales_order_line_id` text,
	`customer_po` text,
	`length_mm` integer NOT NULL,
	`pcs` integer NOT NULL,
	`kg_g` integer DEFAULT 0 NOT NULL,
	`packed_pcs` integer DEFAULT 0 NOT NULL,
	`scrap_pcs` integer DEFAULT 0 NOT NULL,
	`rework_pcs` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`hold_reason_code_id` text,
	`hold_note` text,
	`hardness_method` text,
	`hardness_reading_x10` integer,
	`hardness_pass` integer,
	`rework_row_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `ageing_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ageing_row_company_batch_idx` ON `ageing_row` (`company_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_run_line_idx` ON `ageing_row` (`company_id`,`press_run_line_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_run_idx` ON `ageing_row` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_bundle_idx` ON `ageing_row` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_so_line_idx` ON `ageing_row` (`company_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_die_status_idx` ON `ageing_row` (`company_id`,`die_id`,`status`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_server_seq_idx` ON `ageing_row` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `ageing_temp_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`batch_id` text NOT NULL,
	`at` integer NOT NULL,
	`temp_c_x10` integer NOT NULL,
	`source` text DEFAULT 'typed' NOT NULL,
	`note` text,
	`client_mutation_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `ageing_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ageing_temp_log_batch_at_idx` ON `ageing_temp_log` (`company_id`,`batch_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_temp_log_feed_unique` ON `ageing_temp_log` (`batch_id`,`source`,`at`) WHERE "ageing_temp_log"."source" <> 'typed';--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_temp_log_client_mutation_unique` ON `ageing_temp_log` (`company_id`,`client_mutation_id`) WHERE "ageing_temp_log"."client_mutation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `ageing_temp_log_company_server_seq_idx` ON `ageing_temp_log` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `trolley` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`capacity_g` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trolley_company_code_unique` ON `trolley` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `trolley_company_server_seq_idx` ON `trolley` (`company_id`,`server_seq`);