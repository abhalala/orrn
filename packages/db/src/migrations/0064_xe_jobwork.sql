CREATE TABLE `process_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`step_id` text NOT NULL,
	`reason` text NOT NULL,
	`held_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`released_at` integer,
	`released_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `process_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_hold_open_unique` ON `process_hold` (`company_id`,`bundle_id`) WHERE "process_hold"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `process_hold_company_step_idx` ON `process_hold` (`company_id`,`step_id`);--> statement-breakpoint
CREATE TABLE `process_input` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`step_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`serial` text NOT NULL,
	`die_id` text NOT NULL,
	`weight_g` integer NOT NULL,
	`pcs` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`from_location_id` text,
	`return_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `process_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_input_step_bundle_unique` ON `process_input` (`company_id`,`step_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `process_input_company_bundle_idx` ON `process_input` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE TABLE `process_output` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`return_id` text NOT NULL,
	`step_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`input_bundle_id` text,
	`weight_g` integer NOT NULL,
	`pcs` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`reject_pcs` integer DEFAULT 0 NOT NULL,
	`reject_g` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_id`) REFERENCES `process_return`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `process_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `process_output_company_step_idx` ON `process_output` (`company_id`,`step_id`);--> statement-breakpoint
CREATE INDEX `process_output_company_bundle_idx` ON `process_output` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE TABLE `process_return` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`step_id` text NOT NULL,
	`line` integer NOT NULL,
	`mode` text NOT NULL,
	`received_at` integer NOT NULL,
	`received_by` text,
	`input_g` integer NOT NULL,
	`output_g` integer NOT NULL,
	`output_pcs` integer NOT NULL,
	`reject_g` integer DEFAULT 0 NOT NULL,
	`reject_pcs` integer DEFAULT 0 NOT NULL,
	`scrap_g` integer DEFAULT 0 NOT NULL,
	`loss_g` integer NOT NULL,
	`rate_paise_per_kg` integer,
	`amount_paise` integer DEFAULT 0 NOT NULL,
	`minutes` integer,
	`passes` integer,
	`vendor_doc_no` text,
	`location_id` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `process_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`received_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_return_step_line_unique` ON `process_return` (`company_id`,`step_id`,`line`);--> statement-breakpoint
CREATE INDEX `process_return_company_received_idx` ON `process_return` (`company_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `process_step` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`process` text NOT NULL,
	`ops` text DEFAULT '[]' NOT NULL,
	`vendor_id` text,
	`finish_code` text,
	`expected_return` text,
	`status` text DEFAULT 'open' NOT NULL,
	`input_g` integer DEFAULT 0 NOT NULL,
	`input_pcs` integer DEFAULT 0 NOT NULL,
	`value_paise_per_kg` integer,
	`hsn` text,
	`vehicle_no` text,
	`batch_no` text,
	`chemicals` text DEFAULT '[]' NOT NULL,
	`passes` integer,
	`out_size` text,
	`rate_paise_per_kg` integer,
	`note` text,
	`sent_by` text,
	`sent_at` integer NOT NULL,
	`done_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `process_vendor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sent_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_step_company_number_unique` ON `process_step` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `process_step_company_status_idx` ON `process_step` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `process_step_company_kind_sent_idx` ON `process_step` (`company_id`,`kind`,`sent_at`);--> statement-breakpoint
CREATE INDEX `process_step_company_vendor_idx` ON `process_step` (`company_id`,`vendor_id`,`status`);--> statement-breakpoint
CREATE TABLE `process_vendor` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`gstin` text,
	`address` text,
	`state` text,
	`phone` text,
	`processes` text DEFAULT '[]' NOT NULL,
	`rate_paise_per_kg` integer,
	`location_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_vendor_company_code_unique` ON `process_vendor` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `process_vendor_company_location_idx` ON `process_vendor` (`company_id`,`location_id`);--> statement-breakpoint
ALTER TABLE `bundle` ADD `finish` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `finish_code` text;