CREATE TABLE `cast` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`seq` integer NOT NULL,
	`alloy` text NOT NULL,
	`grade` text,
	`status` text DEFAULT 'open' NOT NULL,
	`melt_count` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`opened_at` integer NOT NULL,
	`close_requested_at` integer,
	`close_requested_by` text,
	`tail_g` integer,
	`tail_bp` integer,
	`tail_reason` text,
	`close_summary` text,
	`close_approval_id` text,
	`closed_at` integer,
	`closed_by` text,
	`client_request_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`close_requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cast_company_period_seq_unique` ON `cast` (`company_id`,`period`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `cast_company_request_unique` ON `cast` (`company_id`,`client_request_id`) WHERE "cast"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX `cast_company_number_idx` ON `cast` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `cast_company_status_idx` ON `cast` (`company_id`,`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `cast_company_opened_idx` ON `cast` (`company_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `cast_company_server_seq_idx` ON `cast` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `melt` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`cast_id` text NOT NULL,
	`seq` integer NOT NULL,
	`alloy` text NOT NULL,
	`preheat_start_at` integer NOT NULL,
	`charging_start_at` integer NOT NULL,
	`charging_end_at` integer NOT NULL,
	`casting_start_at` integer NOT NULL,
	`casting_end_at` integer NOT NULL,
	`ldo_start_tenth_in` integer NOT NULL,
	`ldo_charging_start_tenth_in` integer,
	`ldo_charging_end_tenth_in` integer,
	`ldo_casting_start_tenth_in` integer,
	`ldo_end_tenth_in` integer NOT NULL,
	`input_g` integer NOT NULL,
	`logs_pcs` integer NOT NULL,
	`logs_length_mm` integer NOT NULL,
	`logs_g` integer NOT NULL,
	`dross_g` integer DEFAULT 0 NOT NULL,
	`fe_g` integer DEFAULT 0 NOT NULL,
	`returns_g` integer DEFAULT 0 NOT NULL,
	`output_g` integer NOT NULL,
	`loss_g` integer NOT NULL,
	`loss_bp` integer NOT NULL,
	`allowed_burn_g` integer NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`balance_note` text,
	`notes` text,
	`client_request_id` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `melt_company_cast_seq_unique` ON `melt` (`company_id`,`cast_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `melt_company_request_unique` ON `melt` (`company_id`,`client_request_id`) WHERE "melt"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX `melt_company_casting_end_idx` ON `melt` (`company_id`,`casting_end_at`);--> statement-breakpoint
CREATE INDEX `melt_company_server_seq_idx` ON `melt` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `melt_chemical` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`melt_id` text NOT NULL,
	`line` integer NOT NULL,
	`store_item_id` text,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`open_milli` integer NOT NULL,
	`used_milli` integer NOT NULL,
	`close_milli` integer NOT NULL,
	`store_txn_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_item_id`) REFERENCES `store_item`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `melt_chemical_company_melt_line_unique` ON `melt_chemical` (`company_id`,`melt_id`,`line`);--> statement-breakpoint
CREATE INDEX `melt_chemical_company_item_idx` ON `melt_chemical` (`company_id`,`store_item_id`);--> statement-breakpoint
CREATE TABLE `melt_input` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`melt_id` text NOT NULL,
	`line` integer NOT NULL,
	`kind` text NOT NULL,
	`lot_id` text,
	`return_stream_id` text,
	`item_ref` text NOT NULL,
	`location_id` text NOT NULL,
	`kg_g` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `purchase_lot`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`return_stream_id`) REFERENCES `return_stream`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `melt_input_company_melt_line_unique` ON `melt_input` (`company_id`,`melt_id`,`line`);--> statement-breakpoint
CREATE INDEX `melt_input_company_lot_idx` ON `melt_input` (`company_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `melt_input_company_stream_idx` ON `melt_input` (`company_id`,`return_stream_id`);--> statement-breakpoint
CREATE TABLE `melt_output` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`melt_id` text NOT NULL,
	`line` integer NOT NULL,
	`kind` text NOT NULL,
	`return_stream_id` text,
	`pcs` integer,
	`length_mm` integer,
	`kg_g` integer NOT NULL,
	`location_id` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`return_stream_id`) REFERENCES `return_stream`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `melt_output_company_melt_line_unique` ON `melt_output` (`company_id`,`melt_id`,`line`);--> statement-breakpoint
CREATE INDEX `melt_output_company_stream_idx` ON `melt_output` (`company_id`,`return_stream_id`);--> statement-breakpoint
CREATE TABLE `return_stream` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`kind` text DEFAULT 'charge' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `return_stream_company_code_unique` ON `return_stream` (`company_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `return_stream_company_name_key_unique` ON `return_stream` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `return_stream_company_server_seq_idx` ON `return_stream` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `spectro_result` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`melt_id` text NOT NULL,
	`cast_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`data_base64` text NOT NULL,
	`values_ppm` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cast_id`) REFERENCES `cast`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `spectro_result_company_melt_idx` ON `spectro_result` (`company_id`,`melt_id`);--> statement-breakpoint
CREATE INDEX `spectro_result_company_cast_idx` ON `spectro_result` (`company_id`,`cast_id`);--> statement-breakpoint
CREATE INDEX `spectro_result_company_server_seq_idx` ON `spectro_result` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `bundle_company_cast_idx` ON `bundle` (`company_id`,`cast_id`);