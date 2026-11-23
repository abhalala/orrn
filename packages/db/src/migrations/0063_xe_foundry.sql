-- XE parity lane FOUNDRY (rows 41-47, 50): homogenizing batches, bought-in logs, billet cutting and issue, reject registers, casting plan, typical charge chemistry. Additive: nine new tables, three new columns.
CREATE TABLE `billet_cut` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`cast_id` text NOT NULL,
	`machine` text NOT NULL,
	`log_pcs` integer NOT NULL,
	`log_g` integer NOT NULL,
	`billet_length_mm` integer NOT NULL,
	`billet_pcs` integer NOT NULL,
	`billet_g` integer NOT NULL,
	`end_g` integer NOT NULL,
	`yield_bp` integer NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`end_stream_id` text,
	`cut_at` integer NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`end_stream_id`) REFERENCES `return_stream`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billet_cut_company_cut_idx` ON `billet_cut` (`company_id`,`cut_at`);--> statement-breakpoint
CREATE INDEX `billet_cut_company_cast_idx` ON `billet_cut` (`company_id`,`cast_id`);--> statement-breakpoint
CREATE TABLE `billet_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`cast_id` text NOT NULL,
	`press_line_id` text NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`pcs` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`issued_at` integer NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billet_issue_company_issued_idx` ON `billet_issue` (`company_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `billet_issue_company_line_idx` ON `billet_issue` (`company_id`,`press_line_id`);--> statement-breakpoint
CREATE TABLE `cast_plan_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`day` text NOT NULL,
	`alloy_id` text,
	`alloy` text NOT NULL,
	`kg_g` integer NOT NULL,
	`proposed_g` integer NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`cast_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alloy_id`) REFERENCES `alloy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cast_plan_line_company_day_idx` ON `cast_plan_line` (`company_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `cast_plan_line_cast_unique` ON `cast_plan_line` (`cast_id`) WHERE "cast_plan_line"."cast_id" is not null;--> statement-breakpoint
CREATE TABLE `charge_chemistry` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`element` text NOT NULL,
	`ppm` integer NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charge_chemistry_subject_element_unique` ON `charge_chemistry` (`company_id`,`subject_kind`,`subject_id`,`element`);--> statement-breakpoint
CREATE TABLE `foundry_reject` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`cast_id` text NOT NULL,
	`location_id` text NOT NULL,
	`reason_code_id` text NOT NULL,
	`reason_note` text,
	`pcs` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`stream_id` text NOT NULL,
	`rejected_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stream_id`) REFERENCES `return_stream`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `foundry_reject_company_kind_idx` ON `foundry_reject` (`company_id`,`kind`,`rejected_at`);--> statement-breakpoint
CREATE TABLE `homog_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`furnace_id` text NOT NULL,
	`alloy_id` text,
	`alloy` text NOT NULL,
	`target_temp_x10` integer NOT NULL,
	`tolerance_x10` integer NOT NULL,
	`soak_min` integer NOT NULL,
	`status` text DEFAULT 'loading' NOT NULL,
	`loaded_at` integer,
	`in_at` integer,
	`out_at` integer,
	`soaked_min` integer,
	`soak_ok` integer,
	`released_at` integer,
	`released_by` text,
	`decision_note` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alloy_id`) REFERENCES `alloy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homog_batch_company_number_unique` ON `homog_batch` (`company_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `homog_batch_one_in_furnace` ON `homog_batch` (`company_id`,`furnace_id`) WHERE "homog_batch"."status" = 'in_furnace';--> statement-breakpoint
CREATE INDEX `homog_batch_company_status_idx` ON `homog_batch` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `homog_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`cast_id` text NOT NULL,
	`pcs` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `homog_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homog_line_batch_cast_unique` ON `homog_line` (`batch_id`,`cast_id`);--> statement-breakpoint
CREATE INDEX `homog_line_company_cast_idx` ON `homog_line` (`company_id`,`cast_id`);--> statement-breakpoint
CREATE TABLE `homog_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`at` integer NOT NULL,
	`temp_x10` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `homog_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `homog_reading_batch_at_idx` ON `homog_reading` (`batch_id`,`at`);--> statement-breakpoint
CREATE TABLE `log_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`cast_id` text NOT NULL,
	`alloy_id` text,
	`alloy` text NOT NULL,
	`received_on` text NOT NULL,
	`diameter_mm` integer,
	`length_mm` integer,
	`pcs` integer NOT NULL,
	`kg_g` integer NOT NULL,
	`vendor_cast_no` text,
	`challan_no` text,
	`location_id` text NOT NULL,
	`mtc_key` text,
	`mtc_name` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alloy_id`) REFERENCES `alloy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_receipt_company_number_unique` ON `log_receipt` (`company_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `log_receipt_cast_unique` ON `log_receipt` (`cast_id`);--> statement-breakpoint
CREATE INDEX `log_receipt_company_received_idx` ON `log_receipt` (`company_id`,`received_on`);--> statement-breakpoint
ALTER TABLE `cast` ADD `source` text DEFAULT 'melt' NOT NULL;--> statement-breakpoint
ALTER TABLE `furnace` ADD `kind` text DEFAULT 'melting' NOT NULL;--> statement-breakpoint
ALTER TABLE `location` ADD `press_line_id` text;