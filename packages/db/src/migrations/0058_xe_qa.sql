CREATE TABLE `qa_alloy_substitute` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`alloy` text NOT NULL,
	`substitute` text NOT NULL,
	`customer_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_alloy_substitute_plant_unique` ON `qa_alloy_substitute` (`company_id`,`alloy`,`substitute`) WHERE "qa_alloy_substitute"."customer_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `qa_alloy_substitute_customer_unique` ON `qa_alloy_substitute` (`company_id`,`alloy`,`substitute`,`customer_id`) WHERE "qa_alloy_substitute"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `qa_check` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`press_run_id` text,
	`bundle_id` text,
	`die_id` text,
	`die_instance_id` text,
	`lot_id` text,
	`cast_id` text,
	`ageing_batch_id` text,
	`subject_number` text DEFAULT '' NOT NULL,
	`stage` text,
	`station_id` text,
	`instrument_id` text,
	`temper_id` text,
	`result` text NOT NULL,
	`values_json` text DEFAULT '{}' NOT NULL,
	`flags_json` text DEFAULT '{}' NOT NULL,
	`standard` text,
	`operator_name` text,
	`note` text,
	`checked_by` text,
	`checked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `qa_station`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`instrument_id`) REFERENCES `qa_instrument`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`temper_id`) REFERENCES `qa_temper`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `qa_check_company_kind_at_idx` ON `qa_check` (`company_id`,`kind`,`checked_at`);--> statement-breakpoint
CREATE INDEX `qa_check_company_subject_idx` ON `qa_check` (`company_id`,`subject_type`,`subject_id`,`kind`,`checked_at`);--> statement-breakpoint
CREATE INDEX `qa_check_company_run_idx` ON `qa_check` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `qa_check_company_bundle_idx` ON `qa_check` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE TABLE `qa_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`reason` text NOT NULL,
	`check_id` text,
	`held_by` text,
	`held_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`released_by` text,
	`released_at` integer,
	`release_note` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`check_id`) REFERENCES `qa_check`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`held_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_hold_open_unique` ON `qa_hold` (`company_id`,`bundle_id`) WHERE "qa_hold"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `qa_hold_company_held_idx` ON `qa_hold` (`company_id`,`held_at`);--> statement-breakpoint
CREATE TABLE `qa_instrument` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`range_text` text,
	`place` text,
	`interval_days` integer,
	`last_calibrated_on` text,
	`next_due_on` text,
	`certificate_key` text,
	`certificate_name` text,
	`active` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_instrument_company_code_unique` ON `qa_instrument` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `qa_instrument_company_due_idx` ON `qa_instrument` (`company_id`,`active`,`next_due_on`);--> statement-breakpoint
CREATE TABLE `qa_place` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`station_id` text NOT NULL,
	`placed_by` text,
	`placed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `qa_station`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`placed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_place_subject_unique` ON `qa_place` (`company_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `qa_place_company_station_idx` ON `qa_place` (`company_id`,`station_id`);--> statement-breakpoint
CREATE TABLE `qa_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`die_id` text NOT NULL,
	`die_instance_id` text,
	`temper_id` text,
	`billet_temp_min_x10` integer,
	`billet_temp_max_x10` integer,
	`exit_temp_min_x10` integer,
	`exit_temp_max_x10` integer,
	`ram_speed_min_x10` integer,
	`ram_speed_max_x10` integer,
	`ageing_temp_x10` integer,
	`ageing_soak_min` integer,
	`every_bundles` integer,
	`every_minutes` integer,
	`dimensions_json` text DEFAULT '[]' NOT NULL,
	`note` text,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`temper_id`) REFERENCES `qa_temper`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_plan_section_unique` ON `qa_plan` (`company_id`,`die_id`) WHERE "qa_plan"."die_instance_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `qa_plan_copy_unique` ON `qa_plan` (`company_id`,`die_instance_id`) WHERE "qa_plan"."die_instance_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `qa_station` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`stage` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_station_company_code_unique` ON `qa_station` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `qa_station_company_stage_idx` ON `qa_station` (`company_id`,`stage`);--> statement-breakpoint
CREATE TABLE `qa_temper` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`alloy` text DEFAULT '' NOT NULL,
	`name` text,
	`hardness_method` text DEFAULT 'webster' NOT NULL,
	`hardness_min_x10` integer,
	`tensile_min_mpa` integer,
	`yield_min_mpa` integer,
	`elongation_min_x10` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_temper_company_code_alloy_unique` ON `qa_temper` (`company_id`,`code`,`alloy`);